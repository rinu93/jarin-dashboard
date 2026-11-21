-- =====================================================================
-- JARIN Fitness Studio — complete database (fresh install) · v3
-- Run this whole file once in Supabase: SQL Editor -> New query -> Run.
-- Safe to re-run: it only creates what is missing and replaces rules.
--
-- Roles: owner (Owner/Admin), manager, trainer, receptionist, member, pending
-- Includes: members & IDs, payments (incl. registration fee), visits,
-- member history, owner approvals for member edits/exports, renewal
-- offers per member, staff with Employee IDs, attendance, leave-based
-- payroll, targets & incentives, expenses, income vs expense, offers,
-- website enquiries, invitations with access periods.
-- =====================================================================

create extension if not exists pgcrypto;

-- =========================== LOGINS ===================================
create table if not exists public.profiles (
  id                      uuid primary key references auth.users(id) on delete cascade,
  email                   text,
  full_name               text,
  role                    text not null default 'pending'
                          check (role in ('owner','manager','trainer','receptionist','member','pending')),
  portal                  text,                  -- 'staff' or 'member' (where they signed up)
  member_id               uuid,                  -- set for member logins
  access_until            date,                  -- null = no end date
  extension_requested_at  timestamptz,
  extension_note          text,
  created_at              timestamptz not null default now()
);

-- Effective role: an expired access period behaves as 'expired'.
create or replace function public.my_role() returns text
language sql stable security definer set search_path = public as $$
  select coalesce((
    select case when access_until is not null and access_until < current_date then 'expired' else role end
    from public.profiles where id = auth.uid()), 'none')
$$;
create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select public.my_role() in ('owner','manager','trainer','receptionist') $$;
create or replace function public.is_owner() returns boolean
language sql stable security definer set search_path = public as $$
  select public.my_role() = 'owner' $$;
create or replace function public.is_manager() returns boolean
language sql stable security definer set search_path = public as $$
  select public.my_role() in ('owner','manager') $$;
create or replace function public.my_member_id() returns uuid
language sql stable security definer set search_path = public as $$
  select member_id from public.profiles where id = auth.uid() and public.my_role() = 'member' $$;

-- New sign-ups: the very first account becomes the owner; everyone else waits for approval.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name, role, portal)
  values (
    new.id, new.email,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    case when exists (select 1 from public.profiles where role = 'owner') then 'pending' else 'owner' end,
    case when new.raw_user_meta_data->>'portal' = 'member' then 'member' else 'staff' end
  ) on conflict (id) do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- =========================== SETTINGS =================================
create table if not exists public.settings (
  id                          int primary key default 1 check (id = 1),
  gym_name                    text not null default 'JARIN Fitness Studio',
  currency                    text not null default '₹',
  member_prefix               text not null default 'JFS',
  employee_prefix             text not null default 'JFS-E',
  registration_fee            numeric(12,2) not null default 500,
  paid_leaves_per_month       numeric(4,1) not null default 2,
  renewal_offer_window_days   int not null default 30,
  reminder                    text not null default 'Hi {name}, your {plan} membership at {gym} {when} on {date}. Renew at the front desk to keep training without a break!'
);
insert into public.settings (id) values (1) on conflict do nothing;

-- =========================== STAFF ====================================
create sequence if not exists public.employee_code_seq;
create table if not exists public.staff (
  id             uuid primary key default gen_random_uuid(),
  employee_code  text unique,
  name           text not null,
  role           text not null default 'Trainer',          -- job title shown on payslips
  phone          text,
  email          text,
  join_date      date,
  shift          text,
  weekly_off     text check (weekly_off is null or weekly_off in ('Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday')),
  active         boolean not null default true,
  notes          text,
  profile_id     uuid unique references public.profiles(id) on delete set null,
  created_at     timestamptz not null default now()
);
create or replace function public.assign_employee_code() returns trigger
language plpgsql security definer set search_path = public as $$
declare p text;
begin
  if tg_op = 'INSERT' then
    if new.employee_code is null or trim(new.employee_code) = '' then
      select coalesce(nullif(trim(employee_prefix), ''), 'JFS-E') into p from public.settings where id = 1;
      new.employee_code := coalesce(p, 'JFS-E') || lpad(nextval('public.employee_code_seq')::text, 3, '0');
    end if;
  else
    new.employee_code := old.employee_code;
  end if;
  return new;
end $$;
drop trigger if exists staff_assign_code on public.staff;
create trigger staff_assign_code before insert or update on public.staff
  for each row execute function public.assign_employee_code();

create or replace function public.my_staff_id() returns uuid
language sql stable security definer set search_path = public as $$
  select id from public.staff where profile_id = auth.uid() and public.is_staff() limit 1 $$;

-- Salaries live apart from staff details so managers can see the team but not their pay.
create table if not exists public.staff_pay (
  staff_id        uuid primary key references public.staff(id) on delete cascade,
  monthly_salary  numeric(12,2) not null default 0,
  updated_at      timestamptz not null default now()
);

create table if not exists public.staff_attendance (
  id         uuid primary key default gen_random_uuid(),
  staff_id   uuid not null references public.staff(id) on delete cascade,
  work_date  date not null,
  clock_in   time,
  clock_out  time,
  status     text not null default 'present' check (status in ('present','half','leave')),
  note       text,
  created_at timestamptz not null default now(),
  unique (staff_id, work_date)
);

create table if not exists public.staff_targets (
  id                uuid primary key default gen_random_uuid(),
  staff_id          uuid not null references public.staff(id) on delete cascade,
  month             text not null check (month ~ '^\d{4}-\d{2}$'),
  new_members       int,
  renewals          int,
  revenue           numeric(12,2),
  incentive_amount  numeric(12,2),        -- paid when every target set for the month is met
  note              text,
  unique (staff_id, month)
);

-- Approved payslips (a snapshot of the calculation the owner approved)
create table if not exists public.payroll (
  id               uuid primary key default gen_random_uuid(),
  staff_id         uuid not null references public.staff(id) on delete cascade,
  month            text not null check (month ~ '^\d{4}-\d{2}$'),
  base_salary      numeric(12,2) not null default 0,
  working_days     numeric(5,1) not null default 0,
  present_days     numeric(5,1) not null default 0,
  absent_days      numeric(5,1) not null default 0,
  paid_leave_used  numeric(5,1) not null default 0,
  lop_days         numeric(5,1) not null default 0,
  lop_amount       numeric(12,2) not null default 0,
  incentive        numeric(12,2) not null default 0,
  adjustment       numeric(12,2) not null default 0,
  adjustment_note  text,
  net_pay          numeric(12,2) not null default 0,
  paid_on          date,
  mode             text,
  approved_by      uuid default auth.uid(),
  created_at       timestamptz not null default now(),
  unique (staff_id, month)
);

-- =========================== MEMBERS ==================================
create sequence if not exists public.member_code_seq;
create table if not exists public.members (
  id           uuid primary key default gen_random_uuid(),
  member_code  text unique,
  name         text not null,
  phone        text,
  email        text,
  height_cm    numeric(5,1),
  weight_kg    numeric(5,1),
  goal         text,
  source       text,
  referred_by  text,
  offer        text,
  plan         text not null default 'Monthly',
  fee          numeric(12,2) not null default 0,
  join_date    date not null default current_date,
  expiry_date  date,
  trainer_id   uuid references public.staff(id) on delete set null,
  brought_by   uuid default auth.uid() references public.profiles(id) on delete set null,
  frozen       boolean not null default false,
  notes        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_member_id_fkey') then
    alter table public.profiles add constraint profiles_member_id_fkey foreign key (member_id) references public.members(id) on delete set null;
  end if;
end $$;
create unique index if not exists profiles_member_id_key on public.profiles (member_id) where member_id is not null;

create or replace function public.assign_member_code() returns trigger
language plpgsql security definer set search_path = public as $$
declare p text;
begin
  if tg_op = 'INSERT' then
    if current_setting('jfs.restoring', true) = 'on' then return new; end if;
    -- only the owner may credit a registration to someone else
    if auth.uid() is not null and not public.is_owner() then new.brought_by := auth.uid(); end if;
    if new.member_code is null or trim(new.member_code) = '' then
      select coalesce(nullif(trim(member_prefix), ''), 'JFS') into p from public.settings where id = 1;
      new.member_code := coalesce(p, 'JFS') || '-' || lpad(nextval('public.member_code_seq')::text, 4, '0');
    end if;
  else
    new.member_code := old.member_code;
    new.updated_at := now();
  end if;
  return new;
end $$;
drop trigger if exists members_assign_code on public.members;
create trigger members_assign_code before insert or update on public.members
  for each row execute function public.assign_member_code();

-- Personal details can only change with the owner's approval.
create or replace function public.protect_member_details() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or public.is_owner() then return new; end if;
  if (new.name, new.phone, new.email, new.height_cm, new.goal, new.source, new.referred_by, new.join_date, new.notes, new.brought_by)
     is distinct from
     (old.name, old.phone, old.email, old.height_cm, old.goal, old.source, old.referred_by, old.join_date, old.notes, old.brought_by) then
    if current_setting('jfs.restoring', true) = 'on' then return new; end if;
    raise exception 'OWNER_APPROVAL_REQUIRED: member personal details can only be changed with the owner''s approval';
  end if;
  return new;
end $$;
drop trigger if exists members_protect on public.members;
create trigger members_protect before update on public.members
  for each row execute function public.protect_member_details();

create table if not exists public.payments (
  id              uuid primary key default gen_random_uuid(),
  member_id       uuid not null references public.members(id) on delete cascade,
  paid_on         date not null default current_date,
  amount          numeric(12,2) not null default 0,
  type            text not null check (type in ('registration','new','renewal')),
  plan            text,
  offer           text,
  member_offer_id uuid,
  mode            text,
  created_by      uuid default auth.uid(),
  created_at      timestamptz not null default now()
);
create index if not exists payments_paid_on_idx on public.payments (paid_on);
create or replace function public.stamp_payment_author() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if current_setting('jfs.restoring', true) = 'on' then return new; end if;
  if auth.uid() is not null then new.created_by := auth.uid(); end if;
  return new;
end $$;
drop trigger if exists payments_author on public.payments;
create trigger payments_author before insert on public.payments
  for each row execute function public.stamp_payment_author();
create index if not exists payments_member_idx on public.payments (member_id);

create table if not exists public.attendance (
  id          uuid primary key default gen_random_uuid(),
  member_id   uuid not null references public.members(id) on delete cascade,
  visit_date  date not null default current_date,
  visit_time  time not null default localtime,
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now()
);
create index if not exists attendance_date_idx on public.attendance (visit_date);

create table if not exists public.member_history (
  id               uuid primary key default gen_random_uuid(),
  member_id        uuid not null references public.members(id) on delete cascade,
  changed_at       timestamptz not null default now(),
  changed_by       uuid,
  changed_by_name  text,
  event            text not null check (event in ('created','updated')),
  changes          jsonb not null default '{}'::jsonb
);
create index if not exists member_history_member_idx on public.member_history (member_id, changed_at);

create or replace function public.log_member_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  tracked text[] := array['name','phone','email','height_cm','weight_kg','goal','source','referred_by','offer',
                          'plan','fee','join_date','expiry_date','trainer_id','frozen','notes'];
  k text; o jsonb; n jsonb; diff jsonb := '{}'::jsonb; who text;
begin
  if current_setting('jfs.restoring', true) = 'on' then return null; end if;
  select full_name into who from public.profiles where id = auth.uid();
  if tg_op = 'INSERT' then
    foreach k in array tracked loop
      n := to_jsonb(new) -> k;
      if n is not null and n <> 'null'::jsonb and n <> '""'::jsonb then diff := diff || jsonb_build_object(k, jsonb_build_array(null, n)); end if;
    end loop;
    insert into public.member_history (member_id, changed_by, changed_by_name, event, changes) values (new.id, auth.uid(), who, 'created', diff);
  else
    foreach k in array tracked loop
      o := to_jsonb(old) -> k; n := to_jsonb(new) -> k;
      if o is distinct from n then diff := diff || jsonb_build_object(k, jsonb_build_array(o, n)); end if;
    end loop;
    if diff <> '{}'::jsonb then
      insert into public.member_history (member_id, changed_by, changed_by_name, event, changes) values (new.id, auth.uid(), who, 'updated', diff);
    end if;
  end if;
  return null;
end $$;
drop trigger if exists members_log_change on public.members;
create trigger members_log_change after insert or update on public.members
  for each row execute function public.log_member_change();

-- Personal renewal offers for members close to their renewal date
create table if not exists public.member_offers (
  id               uuid primary key default gen_random_uuid(),
  member_id        uuid not null references public.members(id) on delete cascade,
  title            text not null check (char_length(title) between 1 and 120),
  details          text,
  valid_until      date,
  status           text not null default 'active' check (status in ('active','used','withdrawn')),
  created_by       uuid default auth.uid(),
  created_by_name  text,
  created_at       timestamptz not null default now()
);
create or replace function public.stamp_offer_author() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if current_setting('jfs.restoring', true) = 'on' then return new; end if;
  new.created_by := auth.uid();
  select full_name into new.created_by_name from public.profiles where id = auth.uid();
  return new;
end $$;
drop trigger if exists member_offers_author on public.member_offers;
create trigger member_offers_author before insert on public.member_offers
  for each row execute function public.stamp_offer_author();

-- =========================== OWNER APPROVALS ==========================
create table if not exists public.change_requests (
  id                 uuid primary key default gen_random_uuid(),
  kind               text not null check (kind in ('edit_member','export_members')),
  member_id          uuid references public.members(id) on delete cascade,
  payload            jsonb not null default '{}'::jsonb,
  reason             text,
  requested_by       uuid default auth.uid(),
  requested_by_name  text,
  status             text not null default 'pending' check (status in ('pending','approved','rejected')),
  decided_by         uuid,
  decided_at         timestamptz,
  decision_note      text,
  used_at            timestamptz,
  created_at         timestamptz not null default now()
);
create or replace function public.stamp_request_author() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.requested_by := auth.uid();
  select full_name into new.requested_by_name from public.profiles where id = auth.uid();
  new.status := 'pending'; new.decided_by := null; new.decided_at := null; new.used_at := null;
  return new;
end $$;
drop trigger if exists change_requests_author on public.change_requests;
create trigger change_requests_author before insert on public.change_requests
  for each row execute function public.stamp_request_author();

create or replace function public.decide_change_request(p_id uuid, p_approve boolean, p_note text default null) returns json
language plpgsql security definer set search_path = public as $$
declare r record; j jsonb;
begin
  if not public.is_owner() then return json_build_object('ok', false, 'reason', 'not_owner'); end if;
  select * into r from public.change_requests where id = p_id for update;
  if not found or r.status <> 'pending' then return json_build_object('ok', false, 'reason', 'not_pending'); end if;
  if p_approve and r.kind = 'edit_member' then
    j := r.payload;
    update public.members m set
      name        = case when j ? 'name'        then j->>'name'                    else m.name end,
      phone       = case when j ? 'phone'       then j->>'phone'                   else m.phone end,
      email       = case when j ? 'email'       then j->>'email'                   else m.email end,
      height_cm   = case when j ? 'height_cm'   then (j->>'height_cm')::numeric    else m.height_cm end,
      goal        = case when j ? 'goal'        then j->>'goal'                    else m.goal end,
      source      = case when j ? 'source'      then j->>'source'                  else m.source end,
      referred_by = case when j ? 'referred_by' then j->>'referred_by'             else m.referred_by end,
      join_date   = case when j ? 'join_date'   then (j->>'join_date')::date       else m.join_date end,
      notes       = case when j ? 'notes'       then j->>'notes'                   else m.notes end,
      brought_by  = case when j ? 'brought_by'  then (j->>'brought_by')::uuid      else m.brought_by end
    where m.id = r.member_id;
  end if;
  update public.change_requests
     set status = case when p_approve then 'approved' else 'rejected' end,
         decided_by = auth.uid(), decided_at = now(), decision_note = p_note
   where id = p_id;
  return json_build_object('ok', true);
end $$;

-- A one-time download after the owner approves an export request (valid 48 hours).
create or replace function public.use_export_approval(p_id uuid) returns json
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  select * into r from public.change_requests where id = p_id for update;
  if not found or r.kind <> 'export_members' or r.requested_by <> auth.uid() or r.status <> 'approved'
     or r.used_at is not null or r.decided_at < now() - interval '48 hours' or not public.is_staff() then
    return json_build_object('ok', false);
  end if;
  update public.change_requests set used_at = now() where id = p_id;
  return json_build_object('ok', true);
end $$;

-- =========================== INVITATIONS & ACCESS =====================
create table if not exists public.invitations (
  id            uuid primary key default gen_random_uuid(),
  email         text not null,
  full_name     text,
  role          text not null check (role in ('owner','manager','trainer','receptionist','member')),
  staff_id      uuid references public.staff(id) on delete set null,
  member_id     uuid references public.members(id) on delete cascade,
  access_until  date,
  status        text not null default 'pending' check (status in ('pending','accepted','cancelled')),
  invited_by    uuid default auth.uid(),
  created_at    timestamptz not null default now(),
  accepted_at   timestamptz
);
create index if not exists invitations_email_idx on public.invitations (lower(email));

-- Called after sign-in: applies a pending invitation for this (confirmed) email.
create or replace function public.claim_invitation() returns json
language plpgsql security definer set search_path = public as $$
declare u record; inv record;
begin
  select email, email_confirmed_at into u from auth.users where id = auth.uid();
  if not found then return json_build_object('ok', false, 'reason', 'not_signed_in'); end if;
  if u.email_confirmed_at is null then return json_build_object('ok', false, 'reason', 'email_not_confirmed'); end if;
  select * into inv from public.invitations where lower(email) = lower(u.email) and status = 'pending' order by created_at desc limit 1;
  if not found then return json_build_object('ok', false, 'reason', 'no_invitation'); end if;
  if inv.role = 'member' and exists (select 1 from public.profiles where member_id = inv.member_id and id <> auth.uid()) then
    return json_build_object('ok', false, 'reason', 'already_linked');
  end if;
  -- An existing owner keeps the owner role; only the employee link is applied.
  if public.my_role() = 'owner' then
    if inv.staff_id is not null then
      update public.staff set profile_id = null where profile_id = auth.uid() and id <> inv.staff_id;
      update public.staff set profile_id = auth.uid() where id = inv.staff_id;
    end if;
    update public.invitations set status = 'accepted', accepted_at = now() where id = inv.id;
    return json_build_object('ok', true, 'role', 'owner', 'note', 'owner_kept');
  end if;
  update public.profiles set
    role = inv.role,
    access_until = inv.access_until,
    portal = case when inv.role = 'member' then 'member' else 'staff' end,
    member_id = case when inv.role = 'member' then inv.member_id else null end,
    full_name = coalesce(nullif(full_name, ''), inv.full_name),
    extension_requested_at = null
  where id = auth.uid();
  if inv.staff_id is not null then
    update public.staff set profile_id = null where profile_id = auth.uid() and id <> inv.staff_id;
    update public.staff set profile_id = auth.uid() where id = inv.staff_id;
  end if;
  update public.invitations set status = 'accepted', accepted_at = now() where id = inv.id;
  return json_build_object('ok', true, 'role', inv.role);
end $$;

-- A member who signed up themselves links with their Membership ID (emails must match).
create or replace function public.link_my_membership(p_code text) returns json
language plpgsql security definer set search_path = public as $$
declare u record; m record; r text;
begin
  select email, email_confirmed_at into u from auth.users where id = auth.uid();
  if not found then return json_build_object('ok', false, 'reason', 'not_signed_in'); end if;
  select role into r from public.profiles where id = auth.uid();
  if r in ('owner','manager','trainer','receptionist') then return json_build_object('ok', false, 'reason', 'staff_account'); end if;
  if u.email_confirmed_at is null then return json_build_object('ok', false, 'reason', 'email_not_confirmed'); end if;
  select id, email into m from public.members where upper(member_code) = upper(trim(p_code));
  if not found or lower(coalesce(m.email, '')) <> lower(u.email) then return json_build_object('ok', false, 'reason', 'no_match'); end if;
  if exists (select 1 from public.profiles where member_id = m.id and id <> auth.uid()) then
    return json_build_object('ok', false, 'reason', 'already_linked');
  end if;
  update public.profiles set role = 'member', member_id = m.id, portal = 'member' where id = auth.uid();
  return json_build_object('ok', true);
end $$;

-- Someone whose access period has ended asks the owner for more time.
create or replace function public.request_access_extension(p_note text default null) returns json
language plpgsql security definer set search_path = public as $$
begin
  update public.profiles set extension_requested_at = now(), extension_note = left(p_note, 300) where id = auth.uid();
  return json_build_object('ok', true);
end $$;

revoke all on function public.claim_invitation() from public, anon;
revoke all on function public.link_my_membership(text) from public, anon;
revoke all on function public.request_access_extension(text) from public, anon;
revoke all on function public.decide_change_request(uuid, boolean, text) from public, anon;
revoke all on function public.use_export_approval(uuid) from public, anon;
grant execute on function public.claim_invitation() to authenticated;
grant execute on function public.link_my_membership(text) to authenticated;
grant execute on function public.request_access_extension(text) to authenticated;
grant execute on function public.decide_change_request(uuid, boolean, text) to authenticated;
grant execute on function public.use_export_approval(uuid) to authenticated;

-- =========================== OPERATIONS ===============================
create table if not exists public.targets (
  month        text primary key check (month ~ '^\d{4}-\d{2}$'),
  revenue      numeric(12,2),
  new_members  int,
  renewals     int,
  checkins     int
);

create table if not exists public.equipment (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  category       text,
  brand          text,
  purchase_date  date,
  vendor         text,
  last_service   date,
  interval_days  int not null default 90,
  status         text not null default 'Working' check (status in ('Working','Under repair','Out of order')),
  notes          text,
  created_at     timestamptz not null default now()
);
create table if not exists public.service_logs (
  id            uuid primary key default gen_random_uuid(),
  equipment_id  uuid not null references public.equipment(id) on delete cascade,
  serviced_on   date not null default current_date,
  cost          numeric(12,2) not null default 0,
  technician    text,
  work          text not null,
  created_at    timestamptz not null default now()
);

create table if not exists public.expenses (
  id           uuid primary key default gen_random_uuid(),
  spent_on     date not null default current_date,
  category     text not null,
  description  text,
  vendor       text,
  amount       numeric(12,2) not null check (amount >= 0),
  mode         text,
  created_by   uuid default auth.uid(),
  created_at   timestamptz not null default now()
);
create index if not exists expenses_spent_on_idx on public.expenses (spent_on);

create table if not exists public.offers (
  id           uuid primary key default gen_random_uuid(),
  title        text not null,
  details      text,
  tag          text,
  audience     text not null default 'both' check (audience in ('public','members','both')),
  valid_until  date,
  active       boolean not null default true,
  created_at   timestamptz not null default now()
);

create table if not exists public.enquiries (
  id              uuid primary key default gen_random_uuid(),
  name            text not null check (char_length(name) between 1 and 100),
  phone           text not null check (char_length(phone) between 6 and 30),
  email           text check (email is null or char_length(email) <= 200),
  interest        text check (interest is null or char_length(interest) <= 100),
  preferred_time  text check (preferred_time is null or char_length(preferred_time) <= 100),
  message         text check (message is null or char_length(message) <= 1000),
  status          text not null default 'New' check (status in ('New','Contacted','Trial booked','Joined','Not interested')),
  notes           text,
  source          text not null default 'Website form' check (source in ('Website form','Chatbot','Walk-in','Phone','WhatsApp','Other')),
  transcript      text check (transcript is null or char_length(transcript) <= 12000),
  created_at      timestamptz not null default now()
);
alter table public.enquiries add column if not exists source text not null default 'Website form';
alter table public.enquiries add column if not exists transcript text;
create index if not exists enquiries_created_idx on public.enquiries (created_at desc);

-- =========================== BACKUP RESTORE ===========================
-- Owner-only. Loads a backup (JSON built from the Excel backup file). Rows whose id already
-- exists are skipped, so uploading the same backup twice is harmless. Links to logins that
-- don't exist in this database are cleared (people are invited again).
create or replace function public.restore_backup(p jsonb) returns json
language plpgsql security definer set search_path = public as $$
declare
  t text; n int; cols text; counts jsonb := '{}'::jsonb;
  tables text[] := array['staff','staff_pay','staff_attendance','staff_targets','payroll','members','payments','attendance',
                         'member_history','member_offers','targets','equipment','service_logs','expenses','offers','enquiries','site_themes'];
begin
  if not public.is_owner() then return json_build_object('ok', false, 'reason', 'not_owner'); end if;
  perform set_config('jfs.restoring', 'on', true);
  if jsonb_typeof(p->'settings') = 'array' and jsonb_array_length(p->'settings') > 0 then
    update public.settings s set
      gym_name = coalesce(x.gym_name, s.gym_name), currency = coalesce(x.currency, s.currency),
      member_prefix = coalesce(x.member_prefix, s.member_prefix), employee_prefix = coalesce(x.employee_prefix, s.employee_prefix),
      registration_fee = coalesce(x.registration_fee, s.registration_fee), paid_leaves_per_month = coalesce(x.paid_leaves_per_month, s.paid_leaves_per_month),
      renewal_offer_window_days = coalesce(x.renewal_offer_window_days, s.renewal_offer_window_days), reminder = coalesce(x.reminder, s.reminder)
    from jsonb_populate_recordset(null::public.settings, p->'settings') x where s.id = 1;
  end if;
  foreach t in array tables loop
    if jsonb_typeof(p->t) <> 'array' then continue; end if;
    execute format('create temp table _r on commit drop as select * from jsonb_populate_recordset(null::public.%I, $1)', t) using p->t;
    if t = 'staff' then update _r set profile_id = null where profile_id is not null and not exists (select 1 from public.profiles x where x.id = _r.profile_id); end if;
    if t = 'members' then
      update _r set brought_by = null where brought_by is not null and not exists (select 1 from public.profiles x where x.id = _r.brought_by);
      update _r set trainer_id = null where trainer_id is not null and not exists (select 1 from public.staff x where x.id = _r.trainer_id);
    end if;
    -- columns missing from older backups get their default value
    select string_agg(case when c.column_default is not null then format('coalesce(%I, %s)', c.column_name, c.column_default) else quote_ident(c.column_name) end, ', ' order by c.ordinal_position)
      into cols from information_schema.columns c where c.table_schema = 'public' and c.table_name = t;
    execute format('insert into public.%I select %s from _r on conflict do nothing', t, cols);
    get diagnostics n = row_count;
    counts := counts || jsonb_build_object(t, n);
    drop table _r;
  end loop;
  perform setval('public.member_code_seq', greatest(1, coalesce((select max(nullif(regexp_replace(member_code, '\D', '', 'g'), '')::bigint) from public.members), 0)), true)
    where exists (select 1 from public.members);
  perform setval('public.employee_code_seq', greatest(1, coalesce((select max(nullif(regexp_replace(employee_code, '^.*?(\d+)$', '\1'), '')::bigint) from public.staff), 0)), true)
    where exists (select 1 from public.staff);
  perform set_config('jfs.restoring', 'off', true);
  return json_build_object('ok', true, 'inserted', counts);
end $$;
revoke all on function public.restore_backup(jsonb) from public, anon;
grant execute on function public.restore_backup(jsonb) to authenticated;

-- =========================== ACCESS RULES =============================
alter table public.profiles          enable row level security;
alter table public.settings          enable row level security;
alter table public.staff             enable row level security;
alter table public.staff_pay         enable row level security;
alter table public.staff_attendance  enable row level security;
alter table public.staff_targets     enable row level security;
alter table public.payroll           enable row level security;
alter table public.members           enable row level security;
alter table public.payments          enable row level security;
alter table public.attendance        enable row level security;
alter table public.member_history    enable row level security;
alter table public.member_offers     enable row level security;
alter table public.change_requests   enable row level security;
alter table public.invitations       enable row level security;
alter table public.targets           enable row level security;
alter table public.equipment         enable row level security;
alter table public.service_logs      enable row level security;
alter table public.expenses          enable row level security;
alter table public.offers            enable row level security;
alter table public.enquiries         enable row level security;

-- helper to (re)create a policy
create or replace function public._jfs_pol(t text, n text, body text) returns void language plpgsql as $$
begin
  execute format('drop policy if exists %I on public.%I', n, t);
  execute format('create policy %I on public.%I %s', n, t, body);
end $$;

-- profiles: own row; the owner sees and manages everyone
select public._jfs_pol('profiles', 'profiles_select', 'for select using (id = auth.uid() or public.is_owner())');
select public._jfs_pol('profiles', 'profiles_owner_update', 'for update using (public.is_owner()) with check (public.is_owner())');
select public._jfs_pol('profiles', 'profiles_owner_delete', 'for delete using (public.is_owner() and id <> auth.uid())');

-- settings: staff and members read; owner changes
select public._jfs_pol('settings', 'settings_read', 'for select using (public.is_staff() or public.my_member_id() is not null)');
select public._jfs_pol('settings', 'settings_write', 'for update using (public.is_owner()) with check (public.is_owner())');

-- staff records: whole team can see names/roles; only the owner edits
select public._jfs_pol('staff', 'staff_read', 'for select using (public.is_staff())');
select public._jfs_pol('staff', 'staff_owner', 'for all using (public.is_owner()) with check (public.is_owner())');
-- salaries: owner, and each employee their own
select public._jfs_pol('staff_pay', 'staff_pay_owner', 'for all using (public.is_owner()) with check (public.is_owner())');
select public._jfs_pol('staff_pay', 'staff_pay_self', 'for select using (staff_id = public.my_staff_id())');
-- staff attendance: owner/manager manage; employees clock in/out for themselves (yesterday..tomorrow only)
select public._jfs_pol('staff_attendance', 'satt_manage', 'for all using (public.is_manager()) with check (public.is_manager())');
select public._jfs_pol('staff_attendance', 'satt_self_read', 'for select using (staff_id = public.my_staff_id())');
select public._jfs_pol('staff_attendance', 'satt_self_insert', $p$for insert with check (staff_id = public.my_staff_id() and status = 'present' and work_date between current_date - 1 and current_date + 1)$p$);
select public._jfs_pol('staff_attendance', 'satt_self_update', $p$for update using (staff_id = public.my_staff_id() and work_date between current_date - 1 and current_date + 1) with check (staff_id = public.my_staff_id() and status = 'present' and work_date between current_date - 1 and current_date + 1)$p$);
-- targets & incentives: owner sets; managers see the team's; employees see their own
select public._jfs_pol('staff_targets', 'stg_owner', 'for all using (public.is_owner()) with check (public.is_owner())');
select public._jfs_pol('staff_targets', 'stg_read', 'for select using (public.is_manager() or staff_id = public.my_staff_id())');
-- payroll: owner; employees see their own payslips
select public._jfs_pol('payroll', 'payroll_owner', 'for all using (public.is_owner()) with check (public.is_owner())');
select public._jfs_pol('payroll', 'payroll_self', 'for select using (staff_id = public.my_staff_id())');

-- members: staff read/add/update (personal fields guarded by trigger); only owner deletes; members see themselves
select public._jfs_pol('members', 'members_read', 'for select using (public.is_staff() or id = public.my_member_id())');
select public._jfs_pol('members', 'members_insert', 'for insert with check (public.is_staff())');
select public._jfs_pol('members', 'members_update', 'for update using (public.is_staff()) with check (public.is_staff())');
select public._jfs_pol('members', 'members_delete', 'for delete using (public.is_owner())');
-- payments: staff record; only owner corrects or deletes
select public._jfs_pol('payments', 'payments_read', 'for select using (public.is_staff() or member_id = public.my_member_id())');
select public._jfs_pol('payments', 'payments_insert', 'for insert with check (public.is_staff())');
select public._jfs_pol('payments', 'payments_owner_update', 'for update using (public.is_owner()) with check (public.is_owner())');
select public._jfs_pol('payments', 'payments_owner_delete', 'for delete using (public.is_owner())');
-- member visits
select public._jfs_pol('attendance', 'attendance_read', 'for select using (public.is_staff() or member_id = public.my_member_id())');
select public._jfs_pol('attendance', 'attendance_insert', 'for insert with check (public.is_staff())');
select public._jfs_pol('attendance', 'attendance_delete', 'for delete using (public.is_staff())');
-- history: read only
select public._jfs_pol('member_history', 'history_read', 'for select using (public.is_staff() or member_id = public.my_member_id())');
-- renewal offers: owner/manager/trainer add them only inside the renewal window; staff can mark used/withdrawn
select public._jfs_pol('member_offers', 'moffer_read', 'for select using (public.is_staff() or member_id = public.my_member_id())');
select public._jfs_pol('member_offers', 'moffer_insert', $p$for insert with check (
  public.my_role() in ('owner','manager','trainer') and status = 'active'
  and exists (select 1 from public.members m, public.settings s where m.id = member_id and s.id = 1
              and m.expiry_date is not null and m.expiry_date <= current_date + s.renewal_offer_window_days))$p$);
select public._jfs_pol('member_offers', 'moffer_update', 'for update using (public.is_staff()) with check (public.is_staff())');
select public._jfs_pol('member_offers', 'moffer_delete', 'for delete using (public.is_owner())');
-- approvals: any staff may ask; the owner sees all and decides (through decide_change_request)
select public._jfs_pol('change_requests', 'cr_insert', $p$for insert with check (public.is_staff() and status = 'pending')$p$);
select public._jfs_pol('change_requests', 'cr_read', 'for select using (public.is_owner() or requested_by = auth.uid())');
select public._jfs_pol('change_requests', 'cr_owner_delete', 'for delete using (public.is_owner())');
-- invitations: owner only
select public._jfs_pol('invitations', 'inv_owner', 'for all using (public.is_owner()) with check (public.is_owner())');
-- gym targets
select public._jfs_pol('targets', 'targets_read', 'for select using (public.is_staff())');
select public._jfs_pol('targets', 'targets_write', 'for all using (public.is_manager()) with check (public.is_manager())');
-- equipment
select public._jfs_pol('equipment', 'equipment_read', 'for select using (public.is_staff())');
select public._jfs_pol('equipment', 'equipment_insert', 'for insert with check (public.is_staff())');
select public._jfs_pol('equipment', 'equipment_update', 'for update using (public.is_staff()) with check (public.is_staff())');
select public._jfs_pol('equipment', 'equipment_delete', 'for delete using (public.is_manager())');
select public._jfs_pol('service_logs', 'slogs_read', 'for select using (public.is_staff())');
select public._jfs_pol('service_logs', 'slogs_insert', 'for insert with check (public.is_staff())');
select public._jfs_pol('service_logs', 'slogs_delete', 'for delete using (public.is_manager())');
-- expenses: owner only
select public._jfs_pol('expenses', 'expenses_owner', 'for all using (public.is_owner()) with check (public.is_owner())');
-- public offers
select public._jfs_pol('offers', 'offers_public_read', $p$for select to anon, authenticated using (active and audience in ('public','both') and (valid_until is null or valid_until >= current_date))$p$);
select public._jfs_pol('offers', 'offers_member_read', $p$for select using (public.my_member_id() is not null and active and audience in ('members','both') and (valid_until is null or valid_until >= current_date))$p$);
select public._jfs_pol('offers', 'offers_staff_read', 'for select using (public.is_staff())');
select public._jfs_pol('offers', 'offers_manage', 'for all using (public.is_manager()) with check (public.is_manager())');
-- website enquiries: anyone can send; staff read/update; managers delete
select public._jfs_pol('enquiries', 'enq_public_insert', $p$for insert to anon, authenticated with check (status = 'New' and notes is null and source in ('Website form','Chatbot'))$p$);
select public._jfs_pol('enquiries', 'enq_staff_read', 'for select using (public.is_staff())');
select public._jfs_pol('enquiries', 'enq_staff_update', 'for update using (public.is_staff()) with check (public.is_staff())');
select public._jfs_pol('enquiries', 'enq_manager_delete', 'for delete using (public.is_manager())');

drop function if exists public._jfs_pol(text, text, text);

-- =========================== LIVE UPDATES =============================
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['members','payments','attendance','member_history','member_offers','change_requests','staff','staff_pay',
                             'staff_attendance','staff_targets','payroll','targets','equipment','service_logs','expenses','offers','enquiries','settings','invitations','profiles'] loop
      if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;

-- Trigger functions run automatically; nobody needs to call them through the API.
do $$ declare f text; begin
  foreach f in array array['assign_employee_code()','assign_member_code()','handle_new_user()','log_member_change()','protect_member_details()','stamp_offer_author()','stamp_payment_author()','stamp_request_author()'] loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', f);
  end loop;
end $$;
-- =========================== WEBSITE THEMES ("workout mixes") ===========================
-- The website background rotates through these mixes. The owner manages them from the
-- Employee Dashboard → Website themes. Anyone can read enabled mixes; only the owner edits.
create table if not exists public.site_themes (
  id         text primary key check (id ~ '^[a-z0-9-]{2,40}$'),
  name       text not null check (char_length(name) between 1 and 40),
  tagline    text check (tagline is null or char_length(tagline) <= 90),
  color_a    text not null check (color_a ~ '^#[0-9A-Fa-f]{6}$'),
  color_b    text not null check (color_b ~ '^#[0-9A-Fa-f]{6}$'),
  color_c    text not null check (color_c ~ '^#[0-9A-Fa-f]{6}$'),
  motion     text not null default 'ember' check (motion in ('ember','pulse','flow','grid','aurora')),
  bpm        int  not null default 120 check (bpm between 50 and 200),
  daypart    text not null default 'any' check (daypart in ('any','morning','midday','evening','night')),
  enabled    boolean not null default true,
  sort       int  not null default 0,
  builtin    boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid()
);
create table if not exists public.site_theme_config (
  id               int primary key default 1 check (id = 1),
  mode             text not null default 'rotate' check (mode in ('rotate','pinned','daypart')),
  interval_sec     int  not null default 40 check (interval_sec between 10 and 3600),
  pinned           text references public.site_themes(id) on delete set null,
  visitor_controls boolean not null default true,
  updated_at       timestamptz not null default now()
);
insert into public.site_themes (id, name, tagline, color_a, color_b, color_c, motion, bpm, daypart, sort, builtin) values
  ('beast-mode',      'Beast Mode',      'Heavy compound lifts. Copper heat.',      '#E8A272', '#B86B3C', '#FF7A33', 'ember',  138, 'evening', 1, true),
  ('cardio-rush',     'Cardio Rush',     'Intervals, sprints and a racing heart.',  '#FF8A8A', '#C2334A', '#FF3D6E', 'pulse',  165, 'morning', 2, true),
  ('sunrise-session', 'Sunrise Session', 'First light, first rep.',                 '#FFC56B', '#D9822B', '#FF9A5B', 'aurora', 108, 'morning', 3, true),
  ('zen-stretch',     'Zen Stretch',     'Mobility, breath and recovery.',          '#7FE0C8', '#2F8F7E', '#8FD3FF', 'flow',    72, 'midday',  4, true),
  ('iron-steel',      'Iron & Steel',    'Cold steel, clean form.',                 '#9CC4FF', '#4A6FA5', '#D6E6FF', 'pulse',  120, 'midday',  5, true),
  ('night-grind',     'Night Grind',     'After hours. Neon on the floor.',         '#B9A0FF', '#6A4FD8', '#FF6BD6', 'grid',   128, 'night',   6, true)
on conflict (id) do nothing;
insert into public.site_theme_config (id) values (1) on conflict (id) do nothing;

create or replace function public.stamp_theme() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  if tg_table_name = 'site_themes' and auth.uid() is not null then new.updated_by := auth.uid(); end if;
  return new;
end $$;
revoke execute on function public.stamp_theme() from public, anon, authenticated;
drop trigger if exists stamp_site_themes on public.site_themes;
create trigger stamp_site_themes before insert or update on public.site_themes for each row execute function public.stamp_theme();
drop trigger if exists stamp_site_theme_config on public.site_theme_config;
create trigger stamp_site_theme_config before update on public.site_theme_config for each row execute function public.stamp_theme();

alter table public.site_themes enable row level security;
alter table public.site_theme_config enable row level security;
drop policy if exists themes_public_read on public.site_themes;
create policy themes_public_read on public.site_themes for select to anon, authenticated using (enabled or public.is_owner());
drop policy if exists themes_owner_write on public.site_themes;
create policy themes_owner_write on public.site_themes for all to authenticated using (public.is_owner()) with check (public.is_owner());
drop policy if exists theme_config_read on public.site_theme_config;
create policy theme_config_read on public.site_theme_config for select to anon, authenticated using (true);
drop policy if exists theme_config_write on public.site_theme_config;
create policy theme_config_write on public.site_theme_config for update to authenticated using (public.is_owner()) with check (public.is_owner());
grant select on public.site_themes, public.site_theme_config to anon, authenticated;
grant insert, update, delete on public.site_themes to authenticated;
grant update on public.site_theme_config to authenticated;
do $$ declare t text; begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['site_themes','site_theme_config'] loop
      if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;
