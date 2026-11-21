import './styles.css';
import { WEBSITE_URL } from './config.js';
import { logoUrl, BRAND, MARK, LOCKUP, TAGLINE } from './brand.js';
import { supabase, configured } from './supabase.js';
import { MOTIONS, DAYPARTS, DEFAULT_MIXES, fromRow, configFromRow, playlist, createStage, readability, daypartNow } from './mixes.js';
import { DEFAULT_CONTENT, contentFromRows, OFFER_KINDS, LOGO_VIDEOS, WEEK } from './content.js';
import { mountReel } from './reel.js';
import {
  esc, parse, today, nowTime, addDays, addMonths, diffDays, mKey, curMonth, shiftMonth,
  fmtDate, fmtShort, fmtMonth, fmtMonthS, barChart, pairChart, lineChart, dualChart, donut, gauge, heatmap, funnel, toCsv, download,
} from './lib.js';

/* ======================================================================
   Constants
   ====================================================================== */
const STAFF_ROLES = ['owner', 'manager', 'trainer', 'receptionist'];
const ROLE_LABEL = { owner: 'Owner / Admin', manager: 'Manager', trainer: 'Trainer', receptionist: 'Receptionist', member: 'Member', pending: 'Waiting for approval', expired: 'Access expired' };
const ALL = STAFF_ROLES, MGR = ['owner', 'manager'], OWN = ['owner'];
// [key, label, roles allowed]
const VIEWS = [
  ['overview', 'Dashboard', ALL],
  ['approvals', 'Approvals', OWN],
  ['me', 'My Work', ALL],
  ['clients', 'My Clients', ALL],
  ['members', 'Members', ALL],
  ['attendance', 'Check-ins', ALL],
  ['renewals', 'Renewals', ALL],
  ['enquiries', 'Enquiries', ['owner', 'manager', 'receptionist']],
  ['offers', 'Offers', ['owner', 'manager', 'receptionist']],
  ['finance', 'Income & Expenses', OWN],
  ['payroll', 'Payroll', OWN],
  ['staff', 'Team', MGR],
  ['targets', 'Targets', MGR],
  ['equipment', 'Equipment', ALL],
  ['team', 'Logins & Access', OWN],
  ['content', 'Website content', MGR],
  ['themes', 'Themes & visuals', MGR],
  ['backup', 'Backup & restore', OWN],
];
const PLANS = { 'Monthly': 1, 'Quarterly': 3, 'Half-yearly': 6, 'Annual': 12 };
const JOB_TITLES = ['Owner / Admin', 'Manager', 'Trainer', 'Receptionist', 'Housekeeping', 'Other'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const EQ_CATS = ['Cardio', 'Strength machine', 'Free weights', 'Functional', 'Other'];
const EQ_STATES = ['Working', 'Under repair', 'Out of order'];
const GOALS = ['Weight loss', 'Muscle gain', 'General fitness', 'Strength', 'Endurance', 'Flexibility & mobility', 'Rehab / injury recovery', 'Sports performance', 'Other'];
const SOURCES = ['Walk-in', 'Referral', 'Instagram', 'Facebook', 'Google search', 'Google Maps', 'WhatsApp', 'Website', 'Flyer / banner', 'Corporate tie-up', 'Returning member', 'Other'];
const PAY_MODES = ['UPI', 'Cash', 'Card', 'Bank transfer', 'Cheque'];
const EXPENSE_CATS = ['Electricity (current bill)', 'Rent', 'Water', 'Internet & phone', 'Equipment purchase', 'Equipment maintenance', 'Cleaning & supplies', 'Marketing', 'Staff welfare', 'Taxes & fees', 'Software & subscriptions', 'Other'];
const ENQ_STATUS = ['New', 'Contacted', 'Trial booked', 'Joined', 'Not interested'];
const AUD = { public: 'Website only', members: 'Members only', both: 'Website + members' };
const FIELD_LABELS = { name: 'Name', phone: 'Phone', email: 'Email', height_cm: 'Height', weight_kg: 'Weight', goal: 'Goal', source: 'Source', referred_by: 'Referred by', offer: 'Offer', plan: 'Plan', fee: 'Fee', join_date: 'Start date', expiry_date: 'Expiry date', trainer_id: 'Trainer', frozen: 'Frozen', notes: 'Notes', brought_by: 'Brought in by' };
// form key -> db column. Personal fields need the owner's approval when changed by anyone else.
const PERSONAL = { name: 'name', phone: 'phone', email: 'email', heightCm: 'height_cm', goal: 'goal', source: 'source', referredBy: 'referred_by', joinDate: 'join_date', notes: 'notes', broughtBy: 'brought_by' };
const DIRECT = { weightKg: 'weight_kg', trainerId: 'trainer_id', plan: 'plan', fee: 'fee', expiryDate: 'expiry_date', frozen: 'frozen', offer: 'offer' };
const DEFAULT_SETTINGS = { gymName: BRAND, currency: '₹', memberPrefix: 'JFS', employeePrefix: 'JFS-E', registrationFee: 500, paidLeaves: 2, offerWindow: 30, reminder: 'Hi {name}, your {plan} membership at {gym} {when} on {date}. Renew at the front desk to keep training without a break!' };

const S = { members: {}, attendance: {}, staff: {}, pay: {}, staffAtt: [], staffTargets: [], payroll: [], targets: {}, equipment: {}, offers: [], memberOffers: [], enquiries: [], expenses: [], requests: [], invitations: [], profiles: [], themes: [], themeCfg: null, content: contentFromRows([]), settings: { ...DEFAULT_SETTINGS } };
const ui = { mixPreview: null, enqSource: 'all', restore: null, as: '', meMonth: null, clientSeg: 'all', enqFilter: 'open', memberId: null, history: null, historyFor: null, q: '', memberFilter: 'all', attDate: null, attQ: '', renewSeg: 'due7', payMonth: null, finMonth: null, tMonth: null, staffMonth: null, eqFilter: 'all', staffView: null };
let session = null, me = null, view = 'overview', loading = true, recovery = false;

const $ = s => document.querySelector(s);
const root = $('#root');

/* ======================================================================
   Who am I / permissions
   ====================================================================== */
const roleOf = p => (p && p.access_until && p.access_until < today() && p.role !== 'owner') ? 'expired' : (p ? p.role : 'none');
const myRole = () => roleOf(me);
const isOwner = () => myRole() === 'owner';
const isManager = () => ['owner', 'manager'].includes(myRole());
const canOffer = () => ['owner', 'manager', 'trainer'].includes(myRole());
const allowed = k => { const v = VIEWS.find(x => x[0] === k); return v ? v[2].includes(myRole()) : true; };
const myStaff = () => { const e = Object.entries(S.staff).find(([, v]) => v.profileId === me.id); return e ? { id: e[0], ...e[1] } : null; };
// The "context" a dashboard is drawn for: yourself, or (owner only) any employee.
function ctx() {
  if (isOwner() && ui.as && S.staff[ui.as]) {
    const st = S.staff[ui.as]; const p = S.profiles.find(x => x.id === st.profileId);
    return { self: false, staffId: ui.as, profileId: st.profileId, name: st.name, role: p ? roleOf(p) : titleRole(st.title), title: st.title, code: st.code };
  }
  const st = myStaff();
  return { self: true, staffId: st ? st.id : null, profileId: me.id, name: me.full_name || me.email, role: myRole(), title: st ? st.title : ROLE_LABEL[myRole()], code: st ? st.code : '' };
}
const titleRole = t => ({ 'Owner / Admin': 'owner', Manager: 'manager', Trainer: 'trainer', Receptionist: 'receptionist' }[t] || 'receptionist');

/* ======================================================================
   Formatting & derived data
   ====================================================================== */
const money = n => { const v = Math.round(Number(n || 0)); return (v < 0 ? '−' : '') + (S.settings.currency || '') + Math.abs(v).toLocaleString('en-IN'); };
const moneyK = n => {
  n = Number(n || 0); const c = S.settings.currency || ''; const neg = n < 0; n = Math.abs(n);
  const t = (v, u) => (neg ? '−' : '') + c + (v >= 100 ? Math.round(v) : Number(v.toFixed(1))) + u;
  if (c === '₹') { if (n >= 1e7) return t(n / 1e7, 'Cr'); if (n >= 1e5) return t(n / 1e5, 'L'); } else if (n >= 1e6) return t(n / 1e6, 'M');
  return n >= 1000 ? t(n / 1000, 'k') : (neg ? '−' : '') + c + Math.round(n);
};
const list = col => Object.entries(S[col]).map(([id, v]) => ({ id, ...v }));
const staffName = id => (id && S.staff[id] ? S.staff[id].name : '');
const personName = profileId => { if (!profileId) return ''; const st = Object.values(S.staff).find(s => s.profileId === profileId); if (st) return st.name; const p = S.profiles.find(x => x.id === profileId); return p ? (p.full_name || p.email) : (profileId === me.id ? (me.full_name || 'You') : 'Staff member'); };
const t5 = x => x ? String(x).slice(0, 5) : '—';

function bmi(m) { const h = Number(m.heightCm), w = Number(m.weightKg); if (!h || !w) return null; const v = w / ((h / 100) ** 2); const c = v < 18.5 ? ['Underweight', 'warn'] : v < 25 ? ['Healthy', 'good'] : v < 30 ? ['Overweight', 'warn'] : ['Obese', 'bad']; return { v: Math.round(v * 10) / 10, label: c[0], cls: c[1] }; }
const memberHay = m => [m.code, m.name, m.phone, m.email, m.plan, staffName(m.trainerId), m.goal, m.source].join(' ').toLowerCase();
function memberState(m) {
  const left = m.expiryDate ? diffDays(m.expiryDate, today()) : -9999;
  if (m.frozen) return { key: 'frozen', label: 'Frozen', cls: 'neutral', left };
  if (left < 0) return { key: 'expired', label: `Expired ${-left}d ago`, cls: 'bad', left };
  if (left <= 7) return { key: 'due', label: left === 0 ? 'Expires today' : `${left}d left`, cls: 'warn', left };
  if (left <= 30) return { key: 'soon', label: `${left}d left`, cls: 'neutral', left };
  return { key: 'active', label: 'Active', cls: 'good', left };
}
const isActive = m => !m.frozen && m.expiryDate && diffDays(m.expiryDate, today()) >= 0;
const members = () => list('members').sort((a, b) => a.name.localeCompare(b.name));
const activeMembers = () => members().filter(isActive);
const inOfferWindow = m => m.expiryDate && diffDays(m.expiryDate, today()) <= Number(S.settings.offerWindow || 30);
const offersFor = id => S.memberOffers.filter(o => o.member_id === id && o.status === 'active' && (!o.valid_until || o.valid_until >= today()));
function payments(month) { const out = []; for (const m of members()) for (const p of m.payments) if (!month || mKey(p.date) === month) out.push({ ...p, member: m.name, memberId: m.id }); return out; }
const checkins = date => (S.attendance[date]?.checkins) || [];
function monthCheckins(month) { let n = 0; for (const [d, v] of Object.entries(S.attendance)) if (mKey(d) === month) n += v.checkins.length; return n; }
function achieved(month) { const ps = payments(month); return { newMembers: ps.filter(p => p.type === 'new').length, renewals: ps.filter(p => p.type === 'renewal').length, revenue: ps.reduce((s, p) => s + Number(p.amount || 0), 0), checkins: monthCheckins(month) }; }
function personalAchieved(profileId, month) { const ps = payments(month).filter(p => p.by && p.by === profileId); return { newMembers: ps.filter(p => p.type === 'new').length, renewals: ps.filter(p => p.type === 'renewal').length, revenue: ps.reduce((s, p) => s + Number(p.amount || 0), 0) }; }
const lastVisit = id => { let d = ''; for (const [day, v] of Object.entries(S.attendance)) if (day > d && v.checkins.some(c => c.id === id)) d = day; return d; };
const nextService = e => e.lastService ? addDays(e.lastService, Number(e.intervalDays || 90)) : null;
function eqState(e) {
  if (e.status === 'Out of order') return { label: 'Out of order', cls: 'bad' };
  if (e.status === 'Under repair') return { label: 'Under repair', cls: 'warn' };
  const n = nextService(e); if (!n) return { label: 'No service date', cls: 'neutral' };
  const d = diffDays(n, today());
  if (d < 0) return { label: `Service overdue ${-d}d`, cls: 'bad' };
  if (d <= 14) return { label: d === 0 ? 'Service due today' : `Service in ${d}d`, cls: 'warn' };
  return { label: 'Serviced', cls: 'good' };
}
function renewalBuckets(pool = members()) {
  const t = today(), o = { expired: [], due7: [], due30: [] };
  for (const m of pool) { if (m.frozen || !m.expiryDate) continue; const d = diffDays(m.expiryDate, t); if (d < 0 && d >= -60) o.expired.push(m); else if (d >= 0 && d <= 7) o.due7.push(m); else if (d > 7 && d <= 30) o.due30.push(m); }
  for (const k in o) o[k].sort((a, b) => a.expiryDate.localeCompare(b.expiryDate));
  return o;
}
function reminderText(m) {
  const s = memberState(m); const o = offersFor(m.id)[0];
  let t = (S.settings.reminder || DEFAULT_SETTINGS.reminder).replace(/\{name\}/g, m.name.split(' ')[0]).replace(/\{plan\}/g, m.plan || '').replace(/\{gym\}/g, S.settings.gymName || BRAND).replace(/\{date\}/g, fmtDate(m.expiryDate)).replace(/\{when\}/g, s.left < 0 ? 'expired' : 'expires');
  if (o) t += ` Special renewal offer for you: ${o.title}${o.details ? ' (' + o.details + ')' : ''}${o.valid_until ? ', valid till ' + fmtDate(o.valid_until) : ''}.`;
  return t;
}
const waLink = (phone, text) => { let ph = String(phone || '').replace(/\D/g, ''); if (ph.length === 10) ph = '91' + ph; return ph ? `https://wa.me/${ph}?text=${encodeURIComponent(text)}` : ''; };
const myClients = c => members().filter(m => (c.profileId && m.broughtBy === c.profileId) || (c.staffId && m.trainerId === c.staffId));

/* ---------------- payroll ---------------- */
const targetFor = (staffId, month) => S.staffTargets.find(t => t.staff_id === staffId && t.month === month) || {};
function payrollFor(staffId, month) {
  const st = S.staff[staffId]; const salary = Number(S.pay[staffId] || 0);
  const [y, mo] = month.split('-').map(Number); const dim = new Date(y, mo, 0).getDate();
  const td = today(); const join = st.joinDate || '';
  const rec = {}; for (const a of S.staffAtt) if (a.staff_id === staffId && mKey(a.work_date) === month) rec[a.work_date] = a;
  let fullDays = 0, eligible = 0, elapsed = 0, present = 0; const days = [];
  for (let d = 1; d <= dim; d++) {
    const iso = `${month}-${String(d).padStart(2, '0')}`;
    const off = st.weeklyOff && WEEKDAYS[parse(iso).getDay()] === st.weeklyOff;
    if (off) { days.push({ iso, kind: 'off' }); continue; }
    fullDays++;
    if (join && iso < join) { days.push({ iso, kind: 'before' }); continue; }
    eligible++;
    const r = rec[iso]; const val = r ? (r.status === 'leave' ? 0 : r.status === 'half' ? 0.5 : (r.clock_in || r.status === 'present') ? 1 : 0) : 0;
    if (iso < td || (iso === td && val > 0)) { elapsed++; present += val; days.push({ iso, kind: val === 1 ? 'present' : val === 0.5 ? 'half' : 'absent', r }); }
    else days.push({ iso, kind: 'future' });
  }
  const absent = Math.max(0, elapsed - present);
  const allowance = Number(S.settings.paidLeaves ?? 2);
  const paidLeave = Math.min(absent, allowance); const lop = Math.max(0, absent - paidLeave);
  // mark which absent days are covered by paid leave (first ones)
  let cover = paidLeave; for (const d of days) { if (d.kind === 'absent' && cover >= 1) { d.kind = 'paidleave'; cover -= 1; } else if (d.kind === 'half' && cover >= 0.5) { cover -= 0.5; } }
  const base = fullDays ? Math.round(salary * eligible / fullDays) : 0;
  const perDay = fullDays ? salary / fullDays : 0;
  const lopAmt = Math.round(lop * perDay);
  const tg = targetFor(staffId, month);
  const ach = st.profileId ? personalAchieved(st.profileId, month) : { newMembers: 0, renewals: 0, revenue: 0 };
  const checks = [['new_members', 'newMembers'], ['renewals', 'renewals'], ['revenue', 'revenue']].filter(([k]) => Number(tg[k]) > 0);
  const met = checks.length > 0 && checks.every(([k, a]) => ach[a] >= Number(tg[k]));
  const potential = Number(tg.incentive_amount || 0); const incentive = met ? potential : 0;
  const saved = S.payroll.find(p => p.staff_id === staffId && p.month === month) || null;
  return { st, salary, base, fullDays, eligible, elapsed, present, absent, allowance, paidLeave, leaveLeft: Math.max(0, allowance - paidLeave), lop, perDay, lopAmt, tg, ach, met, checks, potential, incentive, net: Math.max(0, base - lopAmt + incentive), saved, days, remaining: eligible - elapsed, future: month > curMonth() };
}

/* ======================================================================
   Data loading
   ====================================================================== */
function friendly(error) {
  const msg = (error && (error.message || error.error_description)) || String(error);
  if (/OWNER_APPROVAL_REQUIRED/.test(msg)) return 'Personal details need the owner’s approval. Your change was not saved.';
  if (/row-level security|permission denied/i.test(msg)) return 'Your login doesn’t have permission for this. Ask the owner if you need access.';
  if (/Failed to fetch|NetworkError/i.test(msg)) return 'Could not reach the server. Check your internet connection and try again.';
  if (/rate limit|too many/i.test(msg)) return 'Too many emails sent recently (Supabase limit). Wait an hour, or set up your own email service (see README).';
  return msg;
}
async function q(promise) { const { data, error } = await promise; if (error) throw error; return data; }

async function loadAll() {
  const since = addDays(today(), -400);
  const [mem, pay, att, eq, logs, tg, st, staff, spay, satt, stg, prl, offers, moff, enq, exp, req, inv, prof, themes, tcfg, content] = await Promise.all([
    q(supabase.from('members').select('*')),
    q(supabase.from('payments').select('*')),
    q(supabase.from('attendance').select('id,member_id,visit_date,visit_time').gte('visit_date', since).limit(100000)),
    q(supabase.from('equipment').select('*')),
    q(supabase.from('service_logs').select('*')),
    q(supabase.from('targets').select('*')),
    q(supabase.from('settings').select('*').eq('id', 1).maybeSingle()),
    q(supabase.from('staff').select('*')),
    q(supabase.from('staff_pay').select('*')),
    q(supabase.from('staff_attendance').select('*').gte('work_date', since)),
    q(supabase.from('staff_targets').select('*')),
    q(supabase.from('payroll').select('*')),
    q(supabase.from('offers').select('*').order('created_at', { ascending: false })),
    q(supabase.from('member_offers').select('*').order('created_at', { ascending: false })),
    isManager() || myRole() === 'receptionist' ? q(supabase.from('enquiries').select('*').order('created_at', { ascending: false }).limit(500)) : [],
    isOwner() ? q(supabase.from('expenses').select('*').order('spent_on', { ascending: false })) : [],
    q(supabase.from('change_requests').select('*').order('created_at', { ascending: false }).limit(300)),
    isOwner() ? q(supabase.from('invitations').select('*').order('created_at', { ascending: false })) : [],
    isOwner() ? q(supabase.from('profiles').select('*').order('created_at')) : [],
    q(supabase.from('site_themes').select('*').order('sort')).catch(() => []),
    q(supabase.from('site_theme_config').select('*').eq('id', 1).maybeSingle()).catch(() => null),
    q(supabase.from('site_content').select('key,value')).catch(() => []),
  ]);
  const M = {};
  for (const m of mem) M[m.id] = { code: m.member_code || '', name: m.name, phone: m.phone, email: m.email, heightCm: m.height_cm, weightKg: m.weight_kg, goal: m.goal, source: m.source, referredBy: m.referred_by, offer: m.offer, plan: m.plan, fee: Number(m.fee), joinDate: m.join_date, expiryDate: m.expiry_date, trainerId: m.trainer_id, broughtBy: m.brought_by, frozen: m.frozen, notes: m.notes, createdAt: m.created_at, payments: [] };
  for (const p of pay) if (M[p.member_id]) M[p.member_id].payments.push({ id: p.id, date: p.paid_on, amount: Number(p.amount), type: p.type, plan: p.plan, offer: p.offer, mode: p.mode, by: p.created_by });
  const A = {};
  for (const a of att) (A[a.visit_date] ||= { checkins: [] }).checkins.push({ rowId: a.id, id: a.member_id, name: M[a.member_id]?.name || 'Former member', time: String(a.visit_time).slice(0, 5) });
  const E = {};
  for (const e of eq) E[e.id] = { name: e.name, category: e.category, brand: e.brand, purchaseDate: e.purchase_date, vendor: e.vendor, lastService: e.last_service, intervalDays: e.interval_days, status: e.status, notes: e.notes, logs: [] };
  for (const l of logs) if (E[l.equipment_id]) E[l.equipment_id].logs.push({ id: l.id, date: l.serviced_on, cost: Number(l.cost), tech: l.technician, work: l.work });
  const T = {}; for (const t of tg) T[t.month] = { revenue: t.revenue, newMembers: t.new_members, renewals: t.renewals, checkins: t.checkins };
  const SF = {}; for (const s of staff) SF[s.id] = { code: s.employee_code || '', name: s.name, title: s.role, phone: s.phone, email: s.email, joinDate: s.join_date, shift: s.shift, weeklyOff: s.weekly_off, active: s.active, notes: s.notes, profileId: s.profile_id };
  const P = {}; for (const p of spay) P[p.staff_id] = Number(p.monthly_salary);
  Object.assign(S, { members: M, attendance: A, equipment: E, targets: T, staff: SF, pay: P, staffAtt: satt, staffTargets: stg, payroll: prl, offers, memberOffers: moff, enquiries: enq, expenses: exp, requests: req, invitations: inv, profiles: prof, themes: (themes || []).map(fromRow), themeCfg: configFromRow(tcfg), content: contentFromRows(content) });
  if (st) S.settings = { gymName: st.gym_name, currency: st.currency, memberPrefix: st.member_prefix, employeePrefix: st.employee_prefix, registrationFee: Number(st.registration_fee), paidLeaves: Number(st.paid_leaves_per_month), offerWindow: Number(st.renewal_offer_window_days), reminder: st.reminder };
  if (view === 'member' && ui.memberId) await loadHistory(ui.memberId);
  loading = false; render();
}
async function loadHistory(id) {
  try { ui.history = await q(supabase.from('member_history').select('*').eq('member_id', id).order('changed_at', { ascending: false })); }
  catch (e) { ui.history = []; }
  ui.historyFor = id;
}
let reloadTimer = null;
function scheduleReload() { clearTimeout(reloadTimer); reloadTimer = setTimeout(() => loadAll().catch(e => toast(friendly(e))), 400); }
let channel = null;
function subscribeLive() {
  if (channel) supabase.removeChannel(channel);
  channel = supabase.channel('jfs-live');
  for (const t of ['members', 'payments', 'attendance', 'member_offers', 'change_requests', 'staff', 'staff_pay', 'staff_attendance', 'staff_targets', 'payroll', 'targets', 'equipment', 'service_logs', 'expenses', 'offers', 'enquiries', 'settings', 'invitations', 'profiles', 'site_themes', 'site_theme_config', 'site_content'])
    channel.on('postgres_changes', { event: '*', schema: 'public', table: t }, scheduleReload);
  channel.subscribe();
}
async function mutate(work, okMsg) {
  try { await work(); if (okMsg) toast(okMsg); await loadAll(); return true; }
  catch (e) { toast(friendly(e)); return false; }
}
const numOrNull = v => v === '' || v == null ? null : Number(v);

/* ======================================================================
   Small UI helpers
   ====================================================================== */
const header = (title, sub, actions = '') => `<div class="head"><div><h1>${esc(title)}</h1>${sub ? `<div class="sub">${sub}</div>` : ''}</div><div class="actions">${actions}</div></div>`;
function progressRow(label, actual, target, fmt = v => v) {
  target = Number(target || 0); const pct = target ? Math.min(100, Math.round(actual / target * 100)) : 0;
  return `<div class="tgt"><div class="tgt-top"><span>${esc(label)}</span><span class="meta">${target ? pct + '%' : 'no target'}</span></div><div class="tgt-top"><b>${esc(fmt(actual))}</b><span class="meta">of ${target ? esc(fmt(target)) : '—'}</span></div><div class="progress ${target && actual >= target ? 'done' : ''}"><i style="width:${pct}%"></i></div></div>`;
}
const kpi = (lbl, val, note = '', { href, alert, style = '' } = {}) => `<${href ? `a href="${href}"` : 'div'} class="kpi ${alert ? 'alert' : ''}"><span class="lbl">${lbl}</span><span class="val" style="${style}">${val}</span><span class="note">${note}</span></${href ? 'a' : 'div'}>`;
function last14() { const out = []; for (let i = 13; i >= 0; i--) { const d = addDays(today(), -i); out.push({ label: fmtShort(d), tick: i % 2 === 0 ? String(parse(d).getDate()) : '', v: checkins(d).length, hl: i === 0 }); } return out; }
const offerPills = id => offersFor(id).map(o => `<span class="pill-offer" title="${esc(o.details || '')}">🎁 ${esc(o.title)}</span>`).join(' ');
function renewalRow(m, { offerBtn = true } = {}) {
  const s = memberState(m); const wa = waLink(m.phone, reminderText(m));
  return `<div class="li"><div><a class="who" href="#member-${m.id}">${esc(m.name)}</a><div class="meta"><span class="mid">${esc(m.code)}</span> · ${esc(m.plan)} · expires ${esc(fmtDate(m.expiryDate))}</div>${offersFor(m.id).length ? `<div style="margin-top:4px">${offerPills(m.id)}</div>` : ''}</div>
  <div class="actions"><span class="chip ${s.cls}">${esc(s.label)}</span>${offerBtn && canOffer() && inOfferWindow(m) ? `<button class="btn sm" data-act="addMemberOffer" data-id="${m.id}">Add offer</button>` : ''}${wa ? `<a class="btn sm" href="${wa}" target="_blank" rel="noopener">WhatsApp</a>` : `<button class="btn sm" data-act="copyReminder" data-id="${m.id}">Copy reminder</button>`}<button class="btn sm primary" data-act="renew" data-id="${m.id}">Renew</button></div></div>`;
}
function viewAsBar() {
  if (!isOwner()) return '';
  const linked = list('staff').filter(s => s.profileId && s.profileId !== me.id).sort((a, b) => a.name.localeCompare(b.name));
  return `<div class="viewas"><span>${ui.as && S.staff[ui.as] ? `Viewing <b>${esc(S.staff[ui.as].name)}</b>’s dashboard (${esc(ROLE_LABEL[ctx().role] || '')}).` : 'You are viewing your <b>Owner / Admin</b> dashboard.'} Owners can open any employee’s dashboard.</span>
  <select class="field-inline" data-act-change="viewAs" aria-label="View dashboard as"><option value="">Owner / Admin (me)</option>${linked.map(s => { const p = S.profiles.find(x => x.id === s.profileId); return `<option value="${s.id}" ${ui.as === s.id ? 'selected' : ''}>${esc(s.name)} · ${esc(p ? ROLE_LABEL[roleOf(p)] : s.title)}</option>`; }).join('')}${linked.length ? '' : '<option disabled>No employees linked to logins yet</option>'}</select></div>`;
}
const pendingApprovals = () => S.requests.filter(r => r.status === 'pending').length + S.profiles.filter(p => p.extension_requested_at && p.id !== me.id).length;

/* ======================================================================
   Graphical insights
   ====================================================================== */
const COL = { active: 'var(--good)', due: 'var(--warn)', soon: 'var(--accent)', expired: 'var(--bad)', frozen: 'var(--bar2)' };
function memberDonut(pool = members(), sub = 'members') {
  const c = { active: 0, soon: 0, due: 0, expired: 0, frozen: 0 }; for (const m of pool) c[memberState(m).key] = (c[memberState(m).key] || 0) + 1;
  return donut([{ label: 'Active', v: c.active, color: COL.active }, { label: 'Renew in 8–30 days', v: c.soon, color: COL.soon }, { label: 'Renew within 7 days', v: c.due, color: COL.due }, { label: 'Expired', v: c.expired, color: COL.expired }, { label: 'Frozen', v: c.frozen, color: COL.frozen }], { center: pool.length, sub });
}
function targetGauges(month = curMonth()) {
  const a = achieved(month), t = S.targets[month] || {};
  const g = (label, val, tg, fmt = v => v) => Number(tg) > 0 ? gauge(val / Number(tg) * 100, { label, sub: `${fmt(val)} of ${fmt(Number(tg))}` }) : gauge(0, { label, sub: 'no target set' });
  return `<div class="gauges">${g('Revenue', a.revenue, t.revenue, moneyK)}${g('New members', a.newMembers, t.newMembers)}${g('Renewals', a.renewals, t.renewals)}</div>`;
}
const SLOTS = [[5, '5a'], [7, '7a'], [9, '9a'], [11, '11a'], [13, '1p'], [15, '3p'], [17, '5p'], [19, '7p'], [21, '9p']];
function peakHours(days = 60) {
  const since = addDays(today(), -days); const M = Array.from({ length: 7 }, () => SLOTS.map(() => 0));
  for (const [d, v] of Object.entries(S.attendance)) {
    if (d < since) continue; const wd = (parse(d).getDay() + 6) % 7;
    for (const c of v.checkins) { const h = Number(String(c.time).slice(0, 2)); let i = SLOTS.findIndex(([s], k) => h >= s && (k === SLOTS.length - 1 || h < SLOTS[k + 1][0])); if (i < 0) i = h < 5 ? 0 : SLOTS.length - 1; M[wd][i]++; }
  }
  return heatmap(M, ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'], SLOTS.map(x => x[1]));
}
function enquiryFunnel(days = 90) {
  const since = addDays(today(), -days); const e = S.enquiries.filter(x => String(x.created_at).slice(0, 10) >= since);
  const reached = x => ['Contacted', 'Trial booked', 'Joined'].includes(x.status); const trial = x => ['Trial booked', 'Joined'].includes(x.status);
  const bot = e.filter(x => x.source === 'Chatbot').length;
  return funnel([{ label: 'Enquiries', v: e.length, note: `${bot} via chatbot` }, { label: 'Contacted', v: e.filter(reached).length }, { label: 'Trial booked', v: e.filter(trial).length }, { label: 'Joined', v: e.filter(x => x.status === 'Joined').length, note: e.length ? Math.round(e.filter(x => x.status === 'Joined').length / e.length * 100) + '% conversion' : '' }]);
}
function insightsRow() {
  return `<div class="grid3"><section class="panel"><div class="panel-head"><h2>Members at a glance</h2><a class="btn sm" href="#members">Members</a></div>${memberDonut()}</section>
    <section class="panel"><div class="panel-head"><h2>Targets · ${esc(fmtMonthS(curMonth()))}</h2><a class="btn sm" href="#targets">Targets</a></div>${targetGauges()}</section></div>
  <div class="grid2"><section class="panel"><div class="panel-head"><h2>Peak hours · last 60 days</h2><span class="meta">member check-ins</span></div>${peakHours()}</section>
    ${S.enquiries.length || isManager() ? `<section class="panel"><div class="panel-head"><h2>Enquiry funnel · 90 days</h2><a class="btn sm" href="#enquiries">Enquiries</a></div>${enquiryFunnel()}</section>` : ''}</div>`;
}

/* ======================================================================
   DASHBOARDS (one per role)
   ====================================================================== */
function vOverview() {
  const c = ctx(); const r = c.role;
  const body = r === 'owner' ? dashOwner() : r === 'manager' ? dashManager() : r === 'trainer' ? dashTrainer(c) : dashReception(c);
  return viewAsBar() + body;
}
function financeMonth(month) {
  const income = payments(month).reduce((s, p) => s + Number(p.amount || 0), 0);
  const exp = S.expenses.filter(e => mKey(e.spent_on) === month);
  const expTotal = exp.reduce((s, e) => s + Number(e.amount || 0), 0);
  const sal = S.payroll.filter(p => p.month === month).reduce((s, p) => s + Number(p.net_pay || 0), 0);
  return { income, expTotal, sal, out: expTotal + sal, net: income - expTotal - sal, exp };
}
function dashOwner() {
  const m = curMonth(), f = financeMonth(m), rb = renewalBuckets(), a = achieved(m), tg = S.targets[m] || {};
  const team = list('staff').filter(s => s.active !== false); const present = team.filter(s => S.staffAtt.some(x => x.staff_id === s.id && x.work_date === today() && x.clock_in));
  const eqs = list('equipment').filter(e => ['bad', 'warn'].includes(eqState(e).cls));
  const hist = []; for (let i = 5; i >= 0; i--) { const k = shiftMonth(m, -i); const fm = financeMonth(k); hist.push({ tick: fmtMonthS(k), a: fm.income, b: fm.out, hl: i === 0 }); }
  const projPayroll = team.reduce((s, x) => s + (S.pay[x.id] ? payrollFor(x.id, m).net : 0), 0);
  const newEnq = S.enquiries.filter(e => e.status === 'New').length; const pa = pendingApprovals();
  return header(S.settings.gymName || BRAND, `Owner / Admin dashboard · ${parse(today()).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}`, `<button class="btn" data-act="addExpense">Add expense</button><button class="btn primary" data-act="addMember">Register member</button>`)
    + `<div class="kpis">
      ${kpi(`Income · ${esc(fmtMonthS(m))}`, esc(moneyK(f.income)), `${a.newMembers} new · ${a.renewals} renewals`, { href: '#finance' })}
      ${kpi(`Expenses · ${esc(fmtMonthS(m))}`, esc(moneyK(f.out)), `${esc(moneyK(f.expTotal))} bills + ${esc(moneyK(f.sal))} salaries`, { href: '#finance' })}
      ${kpi('Net profit', `<span class="${f.net >= 0 ? 'pos' : 'negv'}">${esc(moneyK(f.net))}</span>`, f.income ? (f.net >= 0 ? Math.round(f.net / f.income * 100) + '% margin' : 'expenses exceed income') : 'no income yet', { href: '#finance' })}
      ${kpi('Active members', activeMembers().length, `${rb.due7.length} renewals due this week`, { href: '#members' })}
      ${kpi('Waiting for you', pa, pa ? 'approvals to review' : 'nothing pending', { href: '#approvals', alert: pa > 0 })}
    </div>
    ${insightsRow()}
    <section class="panel"><div class="panel-head"><h2>Income vs expenses · 6 months</h2><span class="legend"><span><i style="background:var(--good)"></i>Income</span><span><i style="background:var(--accent-2)"></i>Expenses</span></span></div>${dualChart(hist, { fmt: moneyK, labels: ['Income', 'Expenses'], h: 200 })}</section>
    <div class="grid2">
      <section class="panel"><div class="panel-head"><h2>Team today</h2><span class="meta">${present.length} of ${team.length} clocked in</span></div>
        <div class="list">${team.map(s => { const x = S.staffAtt.find(a => a.staff_id === s.id && a.work_date === today()); return `<div class="li"><div><div class="who">${esc(s.name)}</div><div class="meta"><span class="empcode">${esc(s.code)}</span> · ${esc(s.title)}</div></div>${x && x.clock_in ? `<span class="chip good">In ${esc(t5(x.clock_in))}${x.clock_out ? ' · out ' + esc(t5(x.clock_out)) : ''}</span>` : s.weeklyOff === WEEKDAYS[new Date().getDay()] ? '<span class="chip neutral">Weekly off</span>' : '<span class="chip warn">Not in</span>'}</div>`; }).join('') || '<div class="empty">Add your team in Team.</div>'}</div></section>
      <section class="panel"><div class="panel-head"><h2>Payroll · ${esc(fmtMonth(m))}</h2><a class="btn sm" href="#payroll">Payroll</a></div>
        <div class="kpis">${kpi('Expected payroll', esc(moneyK(projPayroll)), 'after leave & incentives')}${kpi('Paid', `${S.payroll.filter(p => p.month === m).length} / ${team.filter(s => S.pay[s.id]).length}`, 'employees this month')}</div>
        <div class="meta">${newEnq} new website enquiries · ${eqs.length} machines need attention</div></section>
    </div>
    <section class="panel"><div class="panel-head"><h2>Renewals due this week</h2><a class="btn sm" href="#renewals">All renewals</a></div>${rb.due7.length ? `<div class="list">${rb.due7.map(x => renewalRow(x)).join('')}</div>` : '<div class="empty">No memberships expire in the next 7 days.</div>'}</section>`;
}
function dashManager() {
  const m = curMonth(), rb = renewalBuckets(), a = achieved(m), tg = S.targets[m] || {};
  const team = list('staff').filter(s => s.active !== false); const present = team.filter(s => S.staffAtt.some(x => x.staff_id === s.id && x.work_date === today() && x.clock_in));
  const eqs = list('equipment').filter(e => ['bad', 'warn'].includes(eqState(e).cls));
  return header('Manager dashboard', parse(today()).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' }), `<button class="btn" data-act="checkinPick">Check in member</button><button class="btn primary" data-act="addMember">Register member</button>`)
    + `<div class="kpis">
      ${kpi('Active members', activeMembers().length, `of ${members().length} on record`, { href: '#members' })}
      ${kpi('Check-ins today', checkins(today()).length, `${monthCheckins(m)} this month`, { href: '#attendance' })}
      ${kpi('Renewals · 7 days', rb.due7.length, `${rb.expired.length} lapsed recently`, { href: '#renewals', alert: rb.due7.length > 0 })}
      ${kpi('New enquiries', S.enquiries.filter(e => e.status === 'New').length, 'from the website', { href: '#enquiries' })}
      ${kpi('Team in today', `${present.length}/${team.length}`, 'clocked in', { href: '#staff' })}
      ${kpi('Equipment alerts', eqs.length, 'need service or repair', { href: '#equipment', alert: eqs.some(e => eqState(e).cls === 'bad') })}
    </div>
    ${insightsRow()}
    <section class="panel"><div class="panel-head"><h2>Member check-ins · 14 days</h2></div>${barChart(last14(), { h: 180 })}</section>
    <div class="grid2"><section class="panel"><div class="panel-head"><h2>Renewals due</h2><a class="btn sm" href="#renewals">All</a></div>${rb.due7.length ? `<div class="list">${rb.due7.map(x => renewalRow(x)).join('')}</div>` : '<div class="empty">No memberships expire this week.</div>'}</section>
      <section class="panel"><div class="panel-head"><h2>Team today</h2><span class="meta">${present.length} in</span></div><div class="list">${team.map(s => { const x = S.staffAtt.find(a => a.staff_id === s.id && a.work_date === today()); return `<div class="li"><span><b>${esc(s.name)}</b> <span class="meta">${esc(s.title)}</span></span>${x && x.clock_in ? `<span class="chip good">In ${esc(t5(x.clock_in))}</span>` : '<span class="chip warn">Not in</span>'}</div>`; }).join('') || '<div class="empty">No team members yet.</div>'}</div></section></div>`;
}
function dashTrainer(c) {
  const mine = myClients(c); const training = mine.filter(m => m.trainerId === c.staffId); const act = mine.filter(isActive);
  const due = mine.filter(m => !m.frozen && m.expiryDate && diffDays(m.expiryDate, today()) <= 30 && diffDays(m.expiryDate, today()) >= -30).sort((a, b) => a.expiryDate.localeCompare(b.expiryDate));
  const inToday = new Set(checkins(today()).map(x => x.id)); const here = mine.filter(m => inToday.has(m.id));
  const quiet = act.filter(m => { const lv = lastVisit(m.id); return !lv || diffDays(today(), lv) >= 7; });
  const p = c.staffId ? payrollFor(c.staffId, curMonth()) : null;
  return header(`Trainer dashboard${c.self ? '' : ' · ' + esc(c.name)}`, `${esc(c.name)}${c.code ? ` · <span class="empcode">${esc(c.code)}</span>` : ''}`, `<a class="btn" href="#clients">My clients</a><a class="btn primary" href="#me">My Work</a>`)
    + `<div class="kpis">
      ${kpi('My active clients', act.length, `${training.length} training with me`, { href: '#clients' })}
      ${kpi('Renewals to chase', due.length, 'next 30 days & lapsed', { alert: due.length > 0 })}
      ${kpi('My clients in today', here.length, 'checked in')}
      ${kpi('Not seen 7+ days', quiet.length, 'active clients to motivate')}
      ${p ? kpi('Expected pay', esc(moneyK(p.net)), `${p.leaveLeft} leave day${p.leaveLeft === 1 ? '' : 's'} left · ${p.met ? 'incentive earned' : p.potential ? 'incentive pending' : 'no incentive set'}`, { href: '#me' }) : ''}
    </div>
    <div class="grid3"><section class="panel"><div class="panel-head"><h2>My clients</h2><a class="btn sm" href="#clients">All clients</a></div>${memberDonut(mine, 'clients')}</section>
      <section class="panel"><div class="panel-head"><h2>When my clients train</h2><span class="meta">all members · 60 days</span></div>${peakHours()}</section></div>
    <section class="panel"><div class="panel-head"><h2>Renewals to chase · add a personal offer</h2><span class="meta">offers allowed within ${Number(S.settings.offerWindow)} days of renewal</span></div>${due.length ? `<div class="list">${due.map(x => renewalRow(x)).join('')}</div>` : '<div class="empty">None of your clients are due for renewal soon.</div>'}</section>
    <div class="grid2"><section class="panel"><h2>My clients in today</h2><div class="list">${here.map(m => `<div class="li"><a class="who" href="#member-${m.id}">${esc(m.name)}</a><span class="meta">${esc(m.goal || '')}</span></div>`).join('') || '<div class="empty">None of your clients have checked in yet today.</div>'}</div></section>
      <section class="panel"><h2>Not seen for a week</h2><div class="list">${quiet.slice(0, 8).map(m => { const lv = lastVisit(m.id); const wa = waLink(m.phone, `Hi ${m.name.split(' ')[0]}, we miss you at ${S.settings.gymName}! Shall I book your next session?`); return `<div class="li"><div><a class="who" href="#member-${m.id}">${esc(m.name)}</a><div class="meta">${lv ? 'last visit ' + esc(fmtShort(lv)) : 'no visits yet'}</div></div>${wa ? `<a class="btn sm" href="${wa}" target="_blank" rel="noopener">WhatsApp</a>` : ''}</div>`; }).join('') || '<div class="empty">All your active clients came in this week. 💪</div>'}</div></section></div>`;
}
function dashReception(c) {
  const t = today(), rb = renewalBuckets(); const todays = payments().filter(p => p.date === t);
  const regs = todays.filter(p => p.type === 'new').length; const coll = todays.reduce((s, p) => s + Number(p.amount || 0), 0);
  const newEnq = S.enquiries.filter(e => e.status === 'New');
  const ci = checkins(t); const inSet = new Set(ci.map(x => x.id)); const qq = ui.attQ.trim().toLowerCase();
  const exact = qq ? activeMembers().filter(m => m.code.toLowerCase() === qq) : [];
  const cands = exact.length ? exact : activeMembers().filter(m => !qq || memberHay(m).includes(qq)).slice(0, 8);
  return header(`Front desk${c.self ? '' : ' · ' + esc(c.name)}`, parse(t).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' }), `<button class="btn primary" data-act="addMember">Register member</button>`)
    + `<div class="kpis">
      ${kpi('Check-ins today', ci.length, 'members in so far', { href: '#attendance' })}
      ${kpi('Registered today', regs, 'new members')}
      ${kpi('Collected today', esc(moneyK(coll)), `${todays.length} payments`)}
      ${kpi('Renewals · 7 days', rb.due7.length, `${rb.expired.length} lapsed`, { href: '#renewals', alert: rb.due7.length > 0 })}
      ${kpi('New enquiries', newEnq.length, 'call them back', { href: '#enquiries', alert: newEnq.length > 0 })}
    </div>
    <div class="grid2">
      <section class="panel"><div class="panel-head"><h2>Quick check-in</h2><span class="meta">type a name, phone or ID</span></div>
        <input type="search" id="attSearch" class="field-inline" placeholder="Membership ID, name or phone" value="${esc(ui.attQ)}" data-bind="attQ" aria-label="Find member">
        <div class="list">${cands.map(m => `<div class="li"><div><div class="who">${esc(m.name)}</div><div class="meta"><span class="mid">${esc(m.code)}</span> · ${esc(m.plan)}</div></div>${inSet.has(m.id) ? '<span class="chip good">Checked in</span>' : `<button class="btn sm primary" data-act="checkin" data-id="${m.id}">Check in</button>`}</div>`).join('') || '<div class="empty">No active members match.</div>'}</div></section>
      <section class="panel"><div class="panel-head"><h2>New enquiries</h2><a class="btn sm" href="#enquiries">All</a></div>
        <div class="list">${newEnq.slice(0, 6).map(e => { const wa = waLink(e.phone, `Hi ${e.name.split(' ')[0]}, this is ${S.settings.gymName}. Thanks for your free-trial request! When would you like to come in?`); return `<div class="li"><div><div class="who">${esc(e.name)}</div><div class="meta">${esc(e.interest || '')} · ${esc(e.preferred_time || '')}</div></div><div class="actions">${wa ? `<a class="btn sm" href="${wa}" target="_blank" rel="noopener">WhatsApp</a>` : ''}<button class="btn sm primary" data-act="enqRegister" data-id="${e.id}">Register</button></div></div>`; }).join('') || '<div class="empty">No new enquiries.</div>'}</div></section>
    </div>
    <section class="panel"><div class="panel-head"><h2>Renewals due this week</h2><a class="btn sm" href="#renewals">All renewals</a></div>${rb.due7.length ? `<div class="list">${rb.due7.map(x => renewalRow(x)).join('')}</div>` : '<div class="empty">No memberships expire in the next 7 days.</div>'}</section>`;
}

/* ======================================================================
   MY WORK — personal payroll dashboard
   ====================================================================== */
function attCalendar(p) {
  const first = parse(p.days[0].iso); const lead = (first.getDay() + 6) % 7; let cells = '';
  for (let i = 0; i < lead; i++) cells += '<span class="cal-d empty"></span>';
  const cls = { present: 'hit', half: 'half', absent: 'abs', paidleave: 'paidleave', off: 'off', before: 'empty', future: '' };
  const tip = { present: 'Present', half: 'Half day', absent: 'Absent (loss of pay)', paidleave: 'Absent (paid leave)', off: 'Weekly off', before: 'Before joining', future: '' };
  for (const d of p.days) cells += `<span class="cal-d ${cls[d.kind]} ${d.iso === today() ? 'now' : ''}" title="${tip[d.kind]}${d.r && d.r.clock_in ? ' · ' + t5(d.r.clock_in) + '–' + t5(d.r.clock_out) : ''}">${parse(d.iso).getDate()}</span>`;
  return `<div class="cal">${['M', 'T', 'W', 'T', 'F', 'S', 'S'].map(x => `<span class="cal-h">${x}</span>`).join('')}${cells}</div>
  <div class="cal-legend"><span><i style="background:#D98E58"></i>Present</span><span><i style="background:linear-gradient(135deg,#C77B49 50%,var(--surface-2) 50%)"></i>Half day</span><span><i style="background:var(--warn-soft);border:1px solid var(--warn)"></i>Paid leave</span><span><i style="background:var(--bad-soft);border:1px solid var(--bad)"></i>Loss of pay</span><span><i style="border:1px dashed var(--line)"></i>Weekly off</span></div>`;
}
function vMe() {
  const c = ctx(); const m = ui.meMonth || curMonth();
  const head = header(c.self ? 'My Work' : `${c.name} · payroll dashboard`, `${esc(c.name)}${c.code ? ` · <span class="empcode">${esc(c.code)}</span>` : ''} · ${esc(c.title || '')}`, `<input type="month" id="meMonth" class="field-inline" value="${m}" data-bind="meMonth" aria-label="Month">`);
  if (!c.staffId) return viewAsBar() + head + `<section class="panel"><div class="empty">${c.self ? 'Your login isn’t linked to an employee record yet, so there’s no attendance, salary or target to show.' : 'This person has no employee record.'}<br>${isOwner() ? 'Link it in <a href="#team">Logins &amp; Access</a> → <b>Employee record</b>.' : 'Ask the owner to link your login to your employee record.'}</div></section>`;
  const p = payrollFor(c.staffId, m); const td = today();
  const rec = S.staffAtt.find(a => a.staff_id === c.staffId && a.work_date === td);
  const clock = !c.self ? '' : !rec || !rec.clock_in
    ? `<button class="btn primary" data-act="clockIn" data-id="${c.staffId}" style="font-size:16px;padding:12px 22px">Clock in now</button><span class="meta">You haven't clocked in today.</span>`
    : !rec.clock_out ? `<button class="btn primary" data-act="clockOut" data-id="${rec.id}" style="font-size:16px;padding:12px 22px">Clock out</button><span class="chip good">Clocked in at ${esc(t5(rec.clock_in))}</span>`
      : `<span class="chip good">Done for today · ${esc(t5(rec.clock_in))} – ${esc(t5(rec.clock_out))}</span>`;
  const slips = S.payroll.filter(x => x.staff_id === c.staffId).sort((a, b) => b.month.localeCompare(a.month));
  const status = p.saved ? `<span class="chip good">Paid ${esc(fmtShort(p.saved.paid_on))} · ${esc(money(p.saved.net_pay))}</span>` : p.future ? '<span class="chip neutral">Upcoming</span>' : m < curMonth() ? '<span class="chip warn">Awaiting payment</span>' : '<span class="chip neutral">In progress</span>';
  return viewAsBar() + head + (c.self ? `<section class="panel" style="flex-direction:row;flex-wrap:wrap;align-items:center;gap:14px;justify-content:space-between"><div><h2>Today · ${esc(fmtDate(td))}</h2><div class="meta">${esc(p.st.shift ? 'Shift ' + p.st.shift : '')}${p.st.weeklyOff ? ' · weekly off ' + esc(p.st.weeklyOff) : ''}</div></div><div class="actions">${clock}</div></section>` : '')
    + `<div class="kpis">
      ${kpi(`${m === curMonth() ? 'Expected' : 'Calculated'} pay · ${esc(fmtMonthS(m))}`, esc(moneyK(p.saved ? p.saved.net_pay : p.net)), status)}
      ${kpi('Days present', `${p.present}<span style="font-size:18px"> / ${p.elapsed}</span>`, `${p.remaining > 0 ? p.remaining + ' working days left' : 'month complete'}`)}
      ${kpi('Leave balance', `${p.leaveLeft}<span style="font-size:18px"> / ${p.allowance}</span>`, 'paid days off this month · no carry forward', { alert: p.lop > 0 })}
      ${kpi('Loss of pay', p.lop ? `<span class="negv">${p.lop}d</span>` : '0', p.lop ? `− ${esc(money(p.lopAmt))} from salary` : 'no deduction')}
      ${kpi('Incentive', p.potential ? (p.met ? `<span class="pos">${esc(moneyK(p.potential))}</span>` : esc(moneyK(p.potential))) : '—', p.potential ? (p.met ? 'earned: all targets met' : 'meet every target to earn it') : 'no incentive set')}
    </div>
    <div class="grid2">
      <section class="panel"><div class="panel-head"><h2>Targets · ${esc(fmtMonth(m))}</h2>${p.potential ? `<span class="chip ${p.met ? 'good' : 'neutral'}">Incentive ${esc(money(p.potential))}</span>` : ''}</div>
        ${p.checks.length ? `<div class="tgt-grid">${progressRow('New members registered', p.ach.newMembers, p.tg.new_members)}${progressRow('Renewals recorded', p.ach.renewals, p.tg.renewals)}${progressRow('Revenue collected', p.ach.revenue, p.tg.revenue, money)}</div>` : '<div class="empty">No personal targets set for this month yet.</div>'}
        ${p.tg.note ? `<div class="meta">Note from owner: ${esc(p.tg.note)}</div>` : ''}<div class="meta">Counted automatically from registrations and renewals saved under ${c.self ? 'your' : 'their'} login.</div></section>
      <section class="panel"><div class="panel-head"><h2>Salary breakdown</h2>${status}</div>
        <div class="payline"><span>Monthly salary</span><b>${esc(money(p.salary))}</b></div>
        ${p.base !== p.salary ? `<div class="payline"><span>Pro-rated (joined ${esc(fmtDate(p.st.joinDate))})</span><b>${esc(money(p.base))}</b></div>` : ''}
        <div class="payline"><span>Absent ${p.absent}d · paid leave ${p.paidLeave}d</span><b>${p.lop ? '− ' + esc(money(p.lopAmt)) : '—'}</b></div>
        <div class="meta" style="margin:-4px 0 4px">${p.allowance} paid leave days a month. Each extra day costs ${esc(money(Math.round(p.perDay)))} (salary ÷ ${p.fullDays} working days).</div>
        <div class="payline"><span>Incentive</span><b>${p.incentive ? '+ ' + esc(money(p.incentive)) : '—'}</b></div>
        ${p.saved && Number(p.saved.adjustment) ? `<div class="payline"><span>Adjustment${p.saved.adjustment_note ? ' · ' + esc(p.saved.adjustment_note) : ''}</span><b>${Number(p.saved.adjustment) > 0 ? '+ ' : '− '}${esc(money(Math.abs(p.saved.adjustment)))}</b></div>` : ''}
        <div class="payline total"><span>${p.saved ? 'Paid' : 'Expected net pay'}</span><b>${esc(money(p.saved ? p.saved.net_pay : p.net))}</b></div></section>
    </div>
    <div class="grid2">
      <section class="panel"><div class="panel-head"><h2>Attendance · ${esc(fmtMonth(m))}</h2><span class="meta">${p.present} present · ${p.absent} absent</span></div>${attCalendar(p)}<div class="meta">Forgot to clock in or out? Ask a manager to correct it.</div></section>
      <section class="panel"><h2>Payslips</h2>${slips.length ? `<div class="tbl-wrap"><table><thead><tr><th>Month</th><th class="num">Present</th><th class="num">LOP</th><th class="num">Incentive</th><th class="num">Net paid</th></tr></thead><tbody>${slips.map(s => `<tr><td>${esc(fmtMonth(s.month))}<div class="meta">${esc(fmtDate(s.paid_on))} · ${esc(s.mode || '')}</div></td><td class="num">${Number(s.present_days)}</td><td class="num">${Number(s.lop_days) ? Number(s.lop_days) + 'd' : '—'}</td><td class="num">${Number(s.incentive) ? esc(money(s.incentive)) : '—'}</td><td class="num"><b>${esc(money(s.net_pay))}</b></td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">No payslips yet.</div>'}</section>
    </div>`;
}

/* ======================================================================
   MY CLIENTS — members you brought in or train
   ====================================================================== */
function vClients() {
  const c = ctx(); const all = myClients(c).map(m => ({ ...m, st: memberState(m), lv: lastVisit(m.id), rel: [m.broughtBy === c.profileId ? 'Brought in' : '', m.trainerId === c.staffId ? 'Training' : ''].filter(Boolean).join(' · ') }));
  const segs = { all: all, active: all.filter(m => ['active', 'soon', 'due'].includes(m.st.key)), due: all.filter(m => ['due', 'soon'].includes(m.st.key)), inactive: all.filter(m => ['expired', 'frozen'].includes(m.st.key)) };
  const rows = segs[ui.clientSeg] || all;
  return viewAsBar() + header(c.self ? 'My Clients' : `${c.name}’s clients`, 'Members you brought in or train, with their renewal status for follow-up.')
    + `<div class="kpis">${kpi('Active', segs.active.length, 'currently training')}${kpi('Renewal due ≤ 30 days', segs.due.length, 'follow up now', { alert: segs.due.length > 0 })}${kpi('Inactive', segs.inactive.length, 'expired or frozen · win them back')}${kpi('Total', all.length, 'clients linked to you')}</div>
    <section class="panel"><div class="toolbar"><div class="seg" role="group" aria-label="Filter">${[['all', 'All'], ['active', 'Active'], ['due', 'Due soon'], ['inactive', 'Inactive']].map(([k, l]) => `<button data-act="clientSeg" data-v="${k}" aria-pressed="${ui.clientSeg === k}">${l} <span class="meta">${segs[k].length}</span></button>`).join('')}</div></div>
    <div class="tbl-wrap"><table><thead><tr><th>ID</th><th>Member</th><th>Link</th><th>Plan</th><th>Expires</th><th>Status</th><th>Last visit</th><th></th></tr></thead><tbody>
    ${rows.map(m => { const msg = m.st.key === 'expired' ? `Hi ${m.name.split(' ')[0]}, we miss you at ${S.settings.gymName}! Come back this week. Shall I renew your membership?` : reminderText(m); const wa = waLink(m.phone, msg);
      return `<tr><td><a class="mid who" href="#member-${m.id}">${esc(m.code)}</a></td><td><a class="who" href="#member-${m.id}">${esc(m.name)}</a><div class="meta">${esc(m.phone || '')}</div>${offersFor(m.id).length ? offerPills(m.id) : ''}</td><td>${esc(m.rel)}</td><td>${esc(m.plan)}</td><td>${esc(fmtDate(m.expiryDate))}</td><td><span class="chip ${m.st.cls}">${esc(m.st.label)}</span></td><td>${m.lv ? esc(fmtShort(m.lv)) : '—'}</td>
      <td><div class="row-actions">${canOffer() && inOfferWindow(m) ? `<button class="btn sm" data-act="addMemberOffer" data-id="${m.id}">Add offer</button>` : ''}${wa ? `<a class="btn sm" href="${wa}" target="_blank" rel="noopener">Follow up</a>` : ''}<button class="btn sm primary" data-act="renew" data-id="${m.id}">Renew</button></div></td></tr>`; }).join('')}
    </tbody></table>${rows.length ? '' : `<div class="empty">${all.length ? 'Nobody in this group.' : 'No clients linked yet. Members you register are linked to you automatically; members are also linked when you are set as their trainer.'}</div>`}</div></section>`;
}

/* ======================================================================
   MEMBERS
   ====================================================================== */
function sourcesPanel() {
  const m = curMonth(); const all = members(); const joined = all.filter(x => x.payments.some(p => p.type === 'new' && mKey(p.date) === m));
  const count = arr => { const c = {}; for (const x of arr) { const k = x || 'Not recorded'; c[k] = (c[k] || 0) + 1; } return Object.entries(c).sort((a, b) => b[1] - a[1]); };
  const rows = (pairs, total) => pairs.slice(0, 6).map(([k, n]) => `<div class="srcbar"><span>${esc(k)}</span><div class="progress"><i style="width:${Math.round(n / total * 100)}%"></i></div><b style="text-align:right">${n}</b></div>`).join('');
  const goals = count(all.filter(x => x.goal).map(x => x.goal));
  return `<div class="grid2"><section class="panel"><div class="panel-head"><h2>Where new members came from · ${esc(fmtMonthS(m))}</h2><span class="meta">${joined.length} joined</span></div>${joined.length ? rows(count(joined.map(x => x.source)), joined.length) : '<div class="empty">No new members yet this month.</div>'}</section>
  <section class="panel"><div class="panel-head"><h2>Member goals</h2></div>${goals.length ? rows(goals, goals.reduce((s, x) => s + x[1], 0)) : '<div class="empty">Add goals to member profiles to see this.</div>'}</section></div>`;
}
function myExportApproval() { return S.requests.find(r => r.kind === 'export_members' && r.requested_by === me.id && r.status === 'approved' && !r.used_at && (Date.now() - new Date(r.decided_at).getTime()) < 48 * 3600e3); }
function vMembers() {
  const qq = ui.q.trim().toLowerCase();
  let rows = members().map(m => ({ ...m, st: memberState(m) }));
  const counts = { all: rows.length, active: rows.filter(r => ['active', 'soon', 'due'].includes(r.st.key)).length, due: rows.filter(r => r.st.key === 'due').length, expired: rows.filter(r => r.st.key === 'expired').length };
  if (ui.memberFilter === 'active') rows = rows.filter(r => ['active', 'soon', 'due'].includes(r.st.key));
  if (ui.memberFilter === 'due') rows = rows.filter(r => r.st.key === 'due');
  if (ui.memberFilter === 'expired') rows = rows.filter(r => r.st.key === 'expired');
  if (qq) rows = rows.filter(r => memberHay(r).includes(qq));
  const mth = curMonth(); const visits = {}; for (const [d, v] of Object.entries(S.attendance)) if (mKey(d) === mth) for (const x of v.checkins) visits[x.id] = (visits[x.id] || 0) + 1;
  const pendingExport = S.requests.find(r => r.kind === 'export_members' && r.requested_by === me.id && r.status === 'pending');
  const approved = myExportApproval();
  const exportBtn = isOwner() ? `<button class="btn" data-act="exportMembers">Export CSV</button>` : approved ? `<button class="btn" data-act="downloadApproved" data-id="${approved.id}">Download approved export</button>` : pendingExport ? `<button class="btn" disabled>Export requested</button>` : `<button class="btn" data-act="requestExport">Request export</button>`;
  return header('Members', `${counts.active} active · ${counts.all} on record`, `${exportBtn}<button class="btn primary" data-act="addMember">Register member</button>`)
    + `<section class="panel"><div class="toolbar"><input type="search" id="memberSearch" class="field-inline" placeholder="Search ID, name, phone, email" value="${esc(ui.q)}" data-bind="q" aria-label="Search members">
      <div class="seg" role="group" aria-label="Filter">${[['all', 'All'], ['active', 'Active'], ['due', 'Due in 7d'], ['expired', 'Expired']].map(([k, l]) => `<button data-act="memberFilter" data-v="${k}" aria-pressed="${ui.memberFilter === k}">${l} <span class="meta">${counts[k]}</span></button>`).join('')}</div></div>
    <div class="tbl-wrap"><table><thead><tr><th>ID</th><th>Member</th><th>Plan</th><th>Trainer</th><th>Expires</th><th>Status</th><th class="num">Visits (${esc(fmtMonthS(mth))})</th><th></th></tr></thead><tbody>
    ${rows.map(m => `<tr><td><a class="mid who" href="#member-${m.id}">${esc(m.code)}</a></td><td><a class="who" href="#member-${m.id}">${esc(m.name)}</a><div class="meta">${esc(m.phone || '')}</div></td><td>${esc(m.plan || '')}<div class="meta">${esc(money(m.fee))}</div></td><td>${esc(staffName(m.trainerId) || '—')}</td><td>${esc(fmtDate(m.expiryDate))}</td>
      <td><span class="chip ${m.st.cls}">${esc(m.st.label)}</span> ${offersFor(m.id).length ? '<span class="pill-offer">🎁 offer</span>' : ''}</td><td class="num">${visits[m.id] || 0}</td>
      <td><div class="row-actions"><button class="btn sm primary" data-act="renew" data-id="${m.id}">Renew</button><a class="btn sm" href="#member-${m.id}">Profile</a></div></td></tr>`).join('')}
    </tbody></table>${rows.length ? '' : `<div class="empty">${counts.all ? 'No members match this filter.' : 'No members yet. Use Register member to add your first one.'}</div>`}</div>
    ${isOwner() ? '' : '<div class="meta">Downloading member details and changing personal details need the owner’s approval.</div>'}</section>` + (isManager() ? sourcesPanel() : '');
}
function fmtField(k, v) {
  if (v === null || v === undefined || v === '') return '—';
  if (k === 'fee') return money(v); if (k === 'join_date' || k === 'expiry_date') return fmtDate(v);
  if (k === 'height_cm') return v + ' cm'; if (k === 'weight_kg') return v + ' kg'; if (k === 'frozen') return v ? 'Yes' : 'No';
  if (k === 'trainer_id') return staffName(v) || 'Removed'; if (k === 'brought_by') return personName(v);
  return String(v);
}
function vMember() {
  const id = ui.memberId; const m = S.members[id];
  if (!m) return header('Member not found', '') + `<section class="panel"><div class="empty">This member may have been deleted. <a href="#members">Back to members</a></div></section>`;
  const st = memberState(m); const b = bmi(m);
  const visits = []; for (const [d, v] of Object.entries(S.attendance)) for (const x of v.checkins) if (x.id === id) visits.push(d); visits.sort();
  const paid = m.payments.reduce((s, p) => s + Number(p.amount || 0), 0);
  const hist = ui.historyFor === id ? ui.history : null;
  const wpts = []; if (hist) for (const h of hist.slice().reverse()) { const x = h.changes && h.changes.weight_kg; if (x && x[1] != null) wpts.push({ label: fmtShort(String(h.changed_at).slice(0, 10)), v: Number(x[1]) }); }
  if (!wpts.length && m.weightKg) wpts.push({ label: 'Now', v: Number(m.weightKg) });
  const wDelta = wpts.length > 1 ? Math.round((wpts[wpts.length - 1].v - wpts[0].v) * 10) / 10 : null;
  const dl = pairs => `<dl class="dl">${pairs.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join('')}</dl>`;
  const ph = String(m.phone || '').replace(/\D/g, '');
  const pend = S.requests.filter(r => r.kind === 'edit_member' && r.member_id === id && r.status === 'pending');
  const mo = S.memberOffers.filter(o => o.member_id === id);
  return header(m.name, `<span class="mid">${esc(m.code)}</span> · member since ${esc(fmtDate(m.joinDate))}`,
    `<a class="btn" href="#members">All members</a>${visits.includes(today()) ? '<span class="chip good">Checked in today</span>' : `<button class="btn" data-act="checkinToday" data-id="${id}">Check in today</button>`}<button class="btn" data-act="editMember" data-id="${id}">Edit</button><button class="btn primary" data-act="renew" data-id="${id}">Renew</button>`)
    + (pend.length ? `<div class="banner">${pend.length} change${pend.length > 1 ? 's' : ''} to personal details ${pend.length > 1 ? 'are' : 'is'} waiting for the owner’s approval.${isOwner() ? ' <a href="#approvals">Review</a>' : ''}</div>` : '')
    + `<div class="kpis">
      ${kpi('Membership', `<span class="chip ${st.cls}" style="font-size:14px">${esc(st.label)}</span>`, `${esc(m.plan)} · expires ${esc(fmtDate(m.expiryDate))}`, { style: 'font-size:24px' })}
      ${kpi('Visits', visits.filter(d => mKey(d) === curMonth()).length, `this month · ${visits.length} in the last year${visits.length ? ' · last ' + esc(fmtShort(visits[visits.length - 1])) : ''}`)}
      ${kpi('Weight', m.weightKg ? esc(m.weightKg) + '<span style="font-size:18px"> kg</span>' : '—', wDelta !== null ? (wDelta > 0 ? '+' : '') + wDelta + ' kg since first record' : 'record weight to track progress')}
      ${kpi('BMI', b ? b.v : '—', b ? `<span class="chip ${b.cls}">${b.label}</span>` : 'needs height and weight')}
      ${kpi('Total paid', esc(moneyK(paid)), `${m.payments.length} payments`)}
    </div>
    <div class="grid2">
      <section class="panel"><div class="panel-head"><h2>Member details</h2><button class="btn sm" data-act="editMember" data-id="${id}">Edit</button></div>
        ${dl([['Membership ID', `<span class="mid">${esc(m.code)}</span>`], ['Phone', esc(m.phone || '—') + (ph ? ` · <a href="${waLink(m.phone, 'Hi ' + m.name.split(' ')[0] + ',')}" target="_blank" rel="noopener">WhatsApp</a>` : '')], ['Email', esc(m.email || '—')], ['Height', m.heightCm ? esc(m.heightCm) + ' cm' : '—'], ['Weight', m.weightKg ? esc(m.weightKg) + ' kg' : '—'], ['Goal', esc(m.goal || '—')], ['Trainer', esc(staffName(m.trainerId) || '—')], ['Source', esc(m.source || '—') + (m.referredBy ? ' · referred by ' + esc(m.referredBy) : '')], ['Brought in by', esc(personName(m.broughtBy) || '—')], ['Joining offer', esc(m.offer || '—')], ['Plan', esc(m.plan) + ' · ' + esc(money(m.fee))], ['Notes', esc(m.notes || '—')]])}
        ${isOwner() ? '' : '<div class="meta">Personal details (name, phone, email, height, goal, source, notes) change only with the owner’s approval. Weight, trainer and membership changes save straight away.</div>'}</section>
      <section class="panel"><div class="panel-head"><h2>Renewal offers</h2>${canOffer() && inOfferWindow(m) ? `<button class="btn sm primary" data-act="addMemberOffer" data-id="${id}">Add offer</button>` : ''}</div>
        ${mo.length ? `<div class="list">${mo.map(o => `<div class="li"><div><b>${esc(o.title)}</b>${o.details ? `<div class="meta">${esc(o.details)}</div>` : ''}<div class="meta">by ${esc(o.created_by_name || 'staff')} · ${esc(fmtShort(String(o.created_at).slice(0, 10)))}${o.valid_until ? ' · valid till ' + esc(fmtDate(o.valid_until)) : ''}</div></div><div class="actions"><span class="chip ${o.status === 'active' ? 'good' : 'neutral'}">${esc(o.status)}</span>${o.status === 'active' ? `<button class="btn sm" data-act="withdrawOffer" data-id="${o.id}">Withdraw</button>` : ''}</div></div>`).join('')}</div>` : `<div class="empty">${inOfferWindow(m) ? 'No personal offer yet. Add one to encourage renewal.' : `Offers can be added from ${Number(S.settings.offerWindow)} days before renewal (from ${esc(fmtDate(addDays(m.expiryDate, -Number(S.settings.offerWindow))))}).`}</div>`}</section>
    </div>
    <div class="grid2">
      <section class="panel"><div class="panel-head"><h2>Weight progress</h2><span class="meta">${wpts.length} record${wpts.length === 1 ? '' : 's'}</span></div>${wpts.length > 1 ? lineChart(wpts) : `<div class="empty">${wpts.length ? 'One weight recorded so far. Update it in Edit at each check-up to see progress.' : 'No weight recorded yet.'}</div>`}</section>
      <section class="panel"><h2>Payments</h2>${m.payments.length ? `<div class="tbl-wrap"><table><thead><tr><th>Date</th><th>Type</th><th>Offer</th><th class="num">Amount</th></tr></thead><tbody>${m.payments.slice().sort((a, x) => x.date.localeCompare(a.date)).map(p => `<tr><td>${esc(fmtDate(p.date))}<div class="meta">${esc(p.mode || '')}</div></td><td>${p.type === 'registration' ? 'Registration fee' : p.type === 'new' ? 'Joining · ' + esc(p.plan || '') : 'Renewal · ' + esc(p.plan || '')}</td><td>${esc(p.offer || '—')}</td><td class="num">${esc(money(p.amount))}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">No payments recorded.</div>'}</section>
    </div>
    <section class="panel"><div class="panel-head"><h2>Change history</h2><span class="meta">every edit, with who made it</span></div>
      ${hist === null ? '<div class="empty">Loading history…</div>' : hist.length ? `<div class="timeline">${hist.map(h => { const ch = Object.entries(h.changes || {}); const when = new Date(h.changed_at);
        return `<div class="tl ${h.event}"><i></i><div><div><b>${h.event === 'created' ? 'Registered' : 'Updated'}</b> <span class="meta">· ${esc(when.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }))} ${esc(when.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }))} · by ${esc(h.changed_by_name || 'system')}</span></div>${h.event === 'created' ? `<div class="meta">${ch.length} details recorded at registration</div>` : `<ul>${ch.map(([k, [o, n]]) => `<li><b>${esc(FIELD_LABELS[k] || k)}</b>: <span class="old">${esc(fmtField(k, o))}</span> → ${esc(fmtField(k, n))}</li>`).join('')}</ul>`}</div></div>`; }).join('')}</div>` : '<div class="empty">No changes recorded yet.</div>'}</section>
    ${isOwner() ? `<div class="actions" style="justify-content:flex-end"><button class="btn danger" data-act="delete" data-col="members" data-id="${id}">Delete member</button></div>` : ''}`;
}

/* ---------------- check-ins & renewals ---------------- */
function vAttendance() {
  const d = ui.attDate || today(); const log = checkins(d).slice().sort((a, b) => b.time.localeCompare(a.time));
  const inSet = new Set(log.map(c => c.id)); const qq = ui.attQ.trim().toLowerCase();
  const exact = qq ? activeMembers().filter(m => m.code.toLowerCase() === qq) : [];
  const cands = exact.length ? exact : activeMembers().filter(m => !qq || memberHay(m).includes(qq)).slice(0, 12);
  const m = mKey(d); const tally = {}; for (const [day, v] of Object.entries(S.attendance)) if (mKey(day) === m) for (const c of v.checkins) { tally[c.id] ||= { name: c.name, n: 0 }; tally[c.id].n++; }
  const top = Object.values(tally).sort((a, b) => b.n - a.n).slice(0, 6);
  return header('Member check-ins', `${log.length} check-ins on ${esc(fmtDate(d))}`, `<input type="date" id="attDate" class="field-inline" value="${d}" data-bind="attDate" aria-label="Date">`)
    + `<div class="grid2"><section class="panel"><div class="panel-head"><h2>Quick check-in</h2><span class="meta">Active members only</span></div>
      <input type="search" id="attSearch" class="field-inline" placeholder="Membership ID, name or phone" value="${esc(ui.attQ)}" data-bind="attQ" aria-label="Find member">
      <div class="list">${cands.map(x => `<div class="li"><div><div class="who">${esc(x.name)}</div><div class="meta"><span class="mid">${esc(x.code)}</span> · ${esc(x.plan)} · ${esc(x.phone || '')}</div></div>${inSet.has(x.id) ? '<span class="chip good">Checked in</span>' : `<button class="btn sm primary" data-act="checkin" data-id="${x.id}">Check in</button>`}</div>`).join('') || '<div class="empty">No active members match.</div>'}</div></section>
    <section class="panel"><div class="panel-head"><h2>Log · ${esc(fmtShort(d))}</h2><span class="meta">${log.length} visits</span></div>
      <div class="list">${log.map(c => `<div class="li"><div><div class="who">${esc(c.name)}</div><div class="meta">${esc(c.time)}</div></div><button class="btn sm danger" data-act="uncheck" data-id="${c.rowId}">Remove</button></div>`).join('') || '<div class="empty">No check-ins recorded for this day.</div>'}</div></section></div>
    <div class="grid3"><section class="panel"><div class="panel-head"><h2>Daily check-ins · 14 days</h2></div>${barChart(last14())}</section>
    <section class="panel"><div class="panel-head"><h2>Most regular · ${esc(fmtMonthS(m))}</h2></div><div class="list">${top.map(t => `<div class="li"><span>${esc(t.name)}</span><b>${t.n}</b></div>`).join('') || '<div class="empty">No visits this month yet.</div>'}</div></section></div>`;
}
function vRenewals() {
  const b = renewalBuckets(); const seg = ui.renewSeg; const rows = b[seg];
  const labels = { due7: 'Due in 7 days', due30: 'Due in 8–30 days', expired: 'Lapsed (last 60 days)' };
  return header('Renewals', `Send reminders and record renewals. ${canOffer() ? `You can add a personal offer within ${Number(S.settings.offerWindow)} days of a member’s renewal date.` : ''}`)
    + `<section class="panel"><div class="toolbar"><div class="seg" role="group" aria-label="Renewal window">${Object.entries(labels).map(([k, l]) => `<button data-act="renewSeg" data-v="${k}" aria-pressed="${seg === k}">${l} <span class="meta">${b[k].length}</span></button>`).join('')}</div></div>
    ${rows.length ? `<div class="list">${rows.map(m => renewalRow(m)).join('')}</div>` : '<div class="empty">Nobody in this window.</div>'}
    <div class="meta">The WhatsApp message includes the member’s personal offer when there is one. Reminder wording is in Gym settings.</div></section>`;
}

/* ---------------- enquiries & offers ---------------- */
function vEnquiries() {
  const all = S.enquiries.filter(e => ui.enqSource === 'all' || (e.source || 'Website form') === ui.enqSource); const open = all.filter(e => !['Joined', 'Not interested'].includes(e.status)); const rows = ui.enqFilter === 'open' ? open : all;
  const bySrc = k => S.enquiries.filter(e => (e.source || 'Website form') === k).length;
  return header('Enquiries', 'Free-trial requests from the website.')
    + `<div class="kpis">${kpi('New', all.filter(e => e.status === 'New').length, 'not contacted yet', { alert: all.some(e => e.status === 'New') })}${kpi('Trials booked', all.filter(e => e.status === 'Trial booked').length, 'awaiting visit')}${kpi(`Joined · ${esc(fmtMonthS(curMonth()))}`, all.filter(e => e.status === 'Joined' && mKey(String(e.created_at).slice(0, 10)) === curMonth()).length, 'from this month’s enquiries')}</div>
    <div class="grid2"><section class="panel"><h2>Funnel · 90 days</h2>${enquiryFunnel()}</section>
      <section class="panel"><h2>Where enquiries come from</h2>${donut([{ label: 'Chatbot', v: bySrc('Chatbot'), color: 'var(--accent)' }, { label: 'Website form', v: bySrc('Website form'), color: 'var(--accent-2)' }, { label: 'Other', v: S.enquiries.length - bySrc('Chatbot') - bySrc('Website form'), color: 'var(--bar2)' }], { sub: 'enquiries' })}</section></div>
    <section class="panel"><div class="toolbar"><div class="seg" role="group" aria-label="Filter">${[['open', 'Open'], ['all', 'All']].map(([k, l]) => `<button data-act="enqFilter" data-v="${k}" aria-pressed="${ui.enqFilter === k}">${l} <span class="meta">${k === 'open' ? open.length : all.length}</span></button>`).join('')}</div>
      <div class="seg" role="group" aria-label="Source">${[['all', 'All sources'], ['Chatbot', 'Chatbot'], ['Website form', 'Website form']].map(([k, l]) => `<button data-act="enqSource" data-v="${k}" aria-pressed="${ui.enqSource === k}">${l}</button>`).join('')}</div></div>
    <div class="tbl-wrap"><table><thead><tr><th>Received</th><th>Source</th><th>Name</th><th>Interested in</th><th>Best time</th><th>Message</th><th>Status</th><th></th></tr></thead><tbody>
    ${rows.map(e => { const when = new Date(e.created_at); const wa = waLink(e.phone, `Hi ${e.name.split(' ')[0]}, this is ${S.settings.gymName}. Thanks for your free-trial request! When would you like to come in?`);
      return `<tr><td>${esc(when.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }))}<div class="meta">${esc(when.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }))}</div></td><td><span class="src ${e.source === 'Chatbot' ? 'bot' : ''}">${e.source === 'Chatbot' ? '💬 Chatbot' : esc(e.source || 'Website form')}</span></td><td><div class="who">${esc(e.name)}</div><div class="meta">${esc(e.phone)}${e.email ? ' · ' + esc(e.email) : ''}</div></td><td>${esc(e.interest || '—')}</td><td>${esc(e.preferred_time || '—')}</td><td style="max-width:280px">${esc(e.message || '—')}</td>
      <td><select class="field-inline" data-act-change="enqStatus" data-id="${e.id}" aria-label="Status for ${esc(e.name)}">${ENQ_STATUS.map(x => `<option ${x === e.status ? 'selected' : ''}>${x}</option>`).join('')}</select></td>
      <td><div class="row-actions">${e.transcript ? `<button class="btn sm" data-act="enqChat" data-id="${e.id}">Read chat</button>` : ''}${wa ? `<a class="btn sm" href="${wa}" target="_blank" rel="noopener">WhatsApp</a>` : ''}${e.status !== 'Joined' ? `<button class="btn sm primary" data-act="enqRegister" data-id="${e.id}">Register</button>` : ''}${isManager() ? `<button class="btn sm danger" data-act="enqDelete" data-id="${e.id}">Delete</button>` : ''}</div></td></tr>`; }).join('')}
    </tbody></table>${rows.length ? '' : '<div class="empty">No enquiries here. Requests from the website’s free-trial form appear here.</div>'}</div></section>`;
}
function offerState(o) { if (!o.active) return { label: 'Hidden', cls: 'neutral' }; if (o.valid_until && o.valid_until < today()) return { label: 'Expired', cls: 'bad' }; return { label: 'Live', cls: 'good' }; }
function vOffers() {
  const os = S.offers; const personal = S.memberOffers.filter(o => o.status === 'active');
  return header('Offers', 'Website & member offers, plus personal renewal offers.', isManager() ? `<button class="btn primary" data-act="addOffer">Add offer</button>` : '')
    + `<section class="panel"><h2>Website & member offers</h2><div class="tbl-wrap"><table><thead><tr><th>Offer</th><th>Type</th><th>Badge</th><th>Shown to</th><th>Valid till</th><th>Status</th><th></th></tr></thead><tbody>
    ${os.slice().sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0)).map(o => { const s = offerState(o); return `<tr><td><div class="who">${esc(o.title)}</div><div class="meta">${esc(o.highlight ? o.highlight + ' · ' : '')}${esc(o.details || '')}</div>${(o.price_rows || []).length ? `<div class="meta">${(o.price_rows || []).map(r => `${esc(r.label)}: ${r.was ? '<s>₹' + Number(r.was).toLocaleString('en-IN') + '</s> ' : ''}₹${Number(r.now).toLocaleString('en-IN')}`).join(' · ')}</div>` : ''}</td><td>${esc(OFFER_KINDS[o.kind || 'seasonal'] || o.kind)}</td><td>${o.tag ? `<span class="chip neutral">${esc(o.tag)}</span>` : '—'}</td><td>${esc(AUD[o.audience] || o.audience)}</td><td>${esc(o.valid_until ? fmtDate(o.valid_until) : 'No end date')}</td><td><span class="chip ${s.cls}">${s.label}</span></td><td><div class="row-actions">${isManager() ? `<button class="btn sm" data-act="editOffer" data-id="${o.id}">Edit</button><button class="btn sm danger" data-act="delOffer" data-id="${o.id}">Delete</button>` : ''}</div></td></tr>`; }).join('')}
    </tbody></table>${os.length ? '' : '<div class="empty">No offers yet.</div>'}</div></section>
    <section class="panel"><h2>Personal renewal offers (active)</h2>${personal.length ? `<div class="tbl-wrap"><table><thead><tr><th>Member</th><th>Offer</th><th>By</th><th>Valid till</th><th>Renewal date</th></tr></thead><tbody>${personal.map(o => { const m = S.members[o.member_id]; return m ? `<tr><td><a class="who" href="#member-${m.id}">${esc(m.name)}</a> <span class="mid">${esc(m.code)}</span></td><td>${esc(o.title)}<div class="meta">${esc(o.details || '')}</div></td><td>${esc(o.created_by_name || '')}</td><td>${esc(o.valid_until ? fmtDate(o.valid_until) : '—')}</td><td>${esc(fmtDate(m.expiryDate))}</td></tr>` : ''; }).join('')}</tbody></table></div>` : '<div class="empty">No personal offers right now. Add them from Renewals or a member’s profile.</div>'}</section>`;
}

/* ======================================================================
   OWNER: approvals, finance, payroll, team & access
   ====================================================================== */
function vApprovals() {
  const pend = S.requests.filter(r => r.status === 'pending'); const ext = S.profiles.filter(p => p.extension_requested_at && p.id !== me.id);
  const done = S.requests.filter(r => r.status !== 'pending').slice(0, 15);
  const memberPayloadKey = { name: 'name', phone: 'phone', email: 'email', height_cm: 'heightCm', goal: 'goal', source: 'source', referred_by: 'referredBy', join_date: 'joinDate', notes: 'notes', brought_by: 'broughtBy' };
  return header('Approvals', 'Requests that need the owner’s decision.')
    + `<section class="panel"><div class="panel-head"><h2>Member detail changes & exports</h2><span class="meta">${pend.length} pending</span></div>
    ${pend.length ? `<div class="list">${pend.map(r => { const m = r.member_id ? S.members[r.member_id] : null;
      const body = r.kind === 'edit_member' ? `<ul class="diff">${Object.entries(r.payload || {}).map(([k, v]) => `<li><b>${esc(FIELD_LABELS[k] || k)}</b>: <span class="old">${esc(fmtField(k, m ? m[memberPayloadKey[k]] : ''))}</span> → ${esc(fmtField(k, v))}</li>`).join('')}</ul>` : '<div>Download a CSV of all members’ details (one download, valid 48 hours).</div>';
      return `<div class="li" style="align-items:flex-start"><div><b>${r.kind === 'edit_member' ? `Edit ${m ? esc(m.name) + ' <span class="mid">' + esc(m.code) + '</span>' : 'member'}` : 'Export member list'}</b><div class="meta">Requested by ${esc(r.requested_by_name || 'staff')} · ${esc(new Date(r.created_at).toLocaleString())}${r.reason ? ' · “' + esc(r.reason) + '”' : ''}</div>${body}</div>
      <div class="actions"><button class="btn sm" data-act="decide" data-id="${r.id}" data-v="0">Reject</button><button class="btn sm primary" data-act="decide" data-id="${r.id}" data-v="1">Approve</button></div></div>`; }).join('')}</div>` : '<div class="empty">Nothing waiting. 🎉</div>'}</section>
    <section class="panel"><div class="panel-head"><h2>Access extension requests</h2><span class="meta">${ext.length} pending</span></div>
    ${ext.length ? `<div class="list">${ext.map(p => `<div class="li"><div><b>${esc(p.full_name || p.email)}</b> <span class="meta">${esc(ROLE_LABEL[p.role] || p.role)} · ${esc(p.email)}</span><div class="meta">Access ${p.access_until ? 'ended ' + esc(fmtDate(p.access_until)) : 'has no end date'} · asked ${esc(new Date(p.extension_requested_at).toLocaleDateString())}${p.extension_note ? ' · “' + esc(p.extension_note) + '”' : ''}</div></div>
      <div class="actions">${[['3', '+3 months'], ['6', '+6 months'], ['12', '+1 year']].map(([n, l]) => `<button class="btn sm primary" data-act="extendAccess" data-id="${p.id}" data-v="${n}">${l}</button>`).join('')}<button class="btn sm" data-act="dismissExtension" data-id="${p.id}">Decline</button></div></div>`).join('')}</div>` : '<div class="empty">No extension requests.</div>'}</section>
    <section class="panel"><h2>Recently decided</h2>${done.length ? `<div class="tbl-wrap"><table><thead><tr><th>Request</th><th>By</th><th>Decision</th><th>When</th></tr></thead><tbody>${done.map(r => `<tr><td>${r.kind === 'edit_member' ? 'Edit ' + esc(S.members[r.member_id]?.name || 'member') : 'Export members'}</td><td>${esc(r.requested_by_name || '')}</td><td><span class="chip ${r.status === 'approved' ? 'good' : 'bad'}">${esc(r.status)}</span>${r.kind === 'export_members' && r.used_at ? ' <span class="meta">downloaded</span>' : ''}</td><td>${esc(r.decided_at ? new Date(r.decided_at).toLocaleString() : '')}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">No decisions yet.</div>'}</section>`;
}

function vFinance() {
  const m = ui.finMonth || curMonth(); const f = financeMonth(m);
  const ps = payments(m); const byType = { registration: 0, new: 0, renewal: 0 }; for (const p of ps) byType[p.type] = (byType[p.type] || 0) + Number(p.amount || 0);
  const cats = {}; for (const e of f.exp) cats[e.category] = (cats[e.category] || 0) + Number(e.amount || 0); if (f.sal) cats['Salaries (payroll)'] = f.sal;
  const catRows = Object.entries(cats).sort((a, b) => b[1] - a[1]);
  const hist = []; for (let i = 5; i >= 0; i--) { const k = shiftMonth(m, -i); const fm = financeMonth(k); hist.push({ k, tick: fmtMonthS(k), a: fm.income, b: fm.out, net: fm.net, hl: i === 0 }); }
  const max = Math.max(f.income, f.out, 1); const projPayroll = list('staff').filter(s => S.pay[s.id] && !S.payroll.some(p => p.staff_id === s.id && p.month === m)).reduce((s, x) => s + payrollFor(x.id, m).net, 0);
  return header('Income & Expenses', `Owner view · ${esc(fmtMonth(m))}`, `<input type="month" id="finMonth" class="field-inline" value="${m}" data-bind="finMonth" aria-label="Month"><button class="btn" data-act="exportFinance">Export CSV</button><button class="btn primary" data-act="addExpense">Add expense</button>`)
    + `<div class="grid2">
      <section class="panel"><h2>This month at a glance</h2><div class="cmp">
        <div class="cmp-row"><span>Income</span><div><div class="bar inc" style="width:${(f.income / max * 100).toFixed(1)}%"></div></div><b class="pos">${esc(money(f.income))}</b></div>
        <div class="cmp-row"><span>Expenses</span><div><div class="bar exp" style="width:${(f.out / max * 100).toFixed(1)}%"></div></div><b>${esc(money(f.out))}</b></div>
        <div class="net"><span>${f.net >= 0 ? 'Profit' : 'Loss'} for ${esc(fmtMonthS(m))}${f.income && f.net >= 0 ? ` · ${Math.round(f.net / f.income * 100)}% margin` : ''}</span><b class="${f.net >= 0 ? 'pos' : 'negv'}">${esc(money(f.net))}</b></div>
        ${projPayroll ? `<div class="meta">Salaries not yet paid this month: about ${esc(money(projPayroll))}. They count once you mark them paid in Payroll.</div>` : ''}
      </div></section>
      <section class="panel"><div class="panel-head"><h2>6-month trend</h2><span class="legend"><span><i style="background:var(--good)"></i>Income</span><span><i style="background:var(--accent-2)"></i>Expenses</span></span></div>${dualChart(hist, { fmt: moneyK, labels: ['Income', 'Expenses'] })}
        <div class="meta">${hist.map(h => `${esc(h.tick)}: <b class="${h.net >= 0 ? 'pos' : 'negv'}">${esc(moneyK(h.net))}</b>`).join(' · ')}</div></section>
    </div>
    <div class="grid2">
      <section class="panel"><h2>Income breakdown</h2><div class="breakdown">${[['Registration fees', byType.registration], ['New memberships', byType.new], ['Renewals', byType.renewal]].map(([k, v]) => `<div class="srcbar"><span>${k}</span><div class="progress"><i style="width:${f.income ? Math.round(v / f.income * 100) : 0}%;background:var(--good)"></i></div><b style="text-align:right">${esc(moneyK(v))}</b></div>`).join('')}</div><div class="meta">${ps.length} payments recorded this month.</div></section>
      <section class="panel"><h2>Expense breakdown</h2>${catRows.length ? `<div class="breakdown">${catRows.map(([k, v]) => `<div class="srcbar"><span>${esc(k)}</span><div class="progress"><i style="width:${Math.round(v / f.out * 100)}%;background:var(--accent-2)"></i></div><b style="text-align:right">${esc(moneyK(v))}</b></div>`).join('')}</div>` : '<div class="empty">No expenses this month yet.</div>'}</section>
    </div>
    <section class="panel"><div class="panel-head"><h2>Expenses · ${esc(fmtMonth(m))}</h2><span class="meta">${f.exp.length} entries · ${esc(money(f.expTotal))}</span></div>
      ${f.exp.length ? `<div class="tbl-wrap"><table><thead><tr><th>Date</th><th>Category</th><th>Description</th><th>Paid to</th><th>Mode</th><th class="num">Amount</th><th></th></tr></thead><tbody>${f.exp.map(e => `<tr><td>${esc(fmtDate(e.spent_on))}</td><td>${esc(e.category)}</td><td>${esc(e.description || '—')}</td><td>${esc(e.vendor || '—')}</td><td>${esc(e.mode || '—')}</td><td class="num">${esc(money(e.amount))}</td><td><div class="row-actions"><button class="btn sm" data-act="editExpense" data-id="${e.id}">Edit</button><button class="btn sm danger" data-act="delExpense" data-id="${e.id}">Delete</button></div></td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">No expenses recorded for this month. Use Add expense for bills like electricity, rent and water.</div>'}
    </section>`;
}

function vPayroll() {
  const m = ui.payMonth || curMonth(); const team = list('staff').filter(s => s.active !== false || S.payroll.some(p => p.staff_id === s.id && p.month === m)).sort((a, b) => a.code.localeCompare(b.code));
  const rows = team.map(s => ({ s, p: payrollFor(s.id, m) }));
  const total = rows.reduce((t, r) => t + (r.p.saved ? Number(r.p.saved.net_pay) : r.p.net), 0); const paid = rows.filter(r => r.p.saved);
  return header('Payroll', `${esc(fmtMonth(m))} · ${Number(S.settings.paidLeaves)} paid leave days per employee per month, no carry forward`, `<input type="month" id="payMonth" class="field-inline" value="${m}" data-bind="payMonth" aria-label="Payroll month"><button class="btn" data-act="exportPayroll">Export CSV</button>`)
    + `<div class="kpis">${kpi('Total payroll', esc(moneyK(total)), 'after leave deductions & incentives')}${kpi('Paid', `${paid.length} / ${rows.length}`, esc(money(paid.reduce((t, r) => t + Number(r.p.saved.net_pay), 0))))}${kpi('Loss-of-pay days', rows.reduce((t, r) => t + r.p.lop, 0), 'across the team')}${kpi('Incentives earned', esc(moneyK(rows.reduce((t, r) => t + r.p.incentive, 0))), `${rows.filter(r => r.p.met).length} people hit all targets`)}</div>
    <section class="panel"><div class="tbl-wrap"><table><thead><tr><th>Employee</th><th class="num">Salary</th><th class="num">Present</th><th class="num">Absent</th><th class="num">Paid leave</th><th class="num">LOP</th><th class="num">Incentive</th><th class="num">Net pay</th><th>Status</th><th></th></tr></thead><tbody>
    ${rows.map(({ s, p }) => `<tr><td><div class="who">${esc(s.name)}</div><div class="meta"><span class="empcode">${esc(s.code)}</span> · ${esc(s.title)}${s.weeklyOff ? ' · off ' + esc(s.weeklyOff.slice(0, 3)) : ''}</div></td>
      <td class="num">${p.salary ? esc(money(p.salary)) : '<span class="meta">not set</span>'}</td><td class="num">${p.present}/${p.elapsed}</td><td class="num">${p.absent}</td><td class="num">${p.paidLeave}/${p.allowance}</td>
      <td class="num">${p.lop ? `<span class="negv">${p.lop}d · −${esc(moneyK(p.lopAmt))}</span>` : '—'}</td><td class="num">${p.incentive ? `<span class="pos">${esc(money(p.incentive))}</span>` : p.potential ? `<span class="meta">${esc(money(p.potential))} if met</span>` : '—'}</td>
      <td class="num"><b>${esc(money(p.saved ? p.saved.net_pay : p.net))}</b></td><td>${p.saved ? `<span class="chip good">Paid ${esc(fmtShort(p.saved.paid_on))}</span>` : m < curMonth() ? '<span class="chip warn">Due</span>' : '<span class="chip neutral">In progress</span>'}</td>
      <td><div class="row-actions">${p.saved ? `<button class="btn sm" data-act="unpay" data-id="${p.saved.id}">Undo</button>` : `<button class="btn sm primary" data-act="pay" data-id="${s.id}" ${p.salary ? '' : 'disabled'}>Review &amp; pay</button>`}${s.profileId ? `<button class="btn sm" data-act="viewEmp" data-id="${s.id}">Dashboard</button>` : ''}</div></td></tr>`).join('')}
    </tbody></table>${rows.length ? '' : '<div class="empty">No employees yet. Add them in Team.</div>'}</div>
    <div class="meta">Net pay = salary (pro-rated if they joined this month) − loss of pay + incentive. Loss of pay = absent days beyond the ${Number(S.settings.paidLeaves)} paid leave days × salary ÷ working days. Weekly offs aren’t counted as absences. Change the leave allowance in Gym settings.</div></section>`;
}

function vStaff() {
  const m = ui.staffMonth || curMonth(); const staff = list('staff').sort((a, b) => a.code.localeCompare(b.code));
  return header('Team', `${staff.filter(s => s.active !== false).length} active employees`, `<input type="month" id="staffMonth" class="field-inline" value="${m}" data-bind="staffMonth" aria-label="Month">${isOwner() ? '<button class="btn primary" data-act="addStaff">Add employee</button>' : ''}`)
    + `<section class="panel"><div class="tbl-wrap"><table><thead><tr><th>Employee</th><th>Phone</th><th>Shift</th><th>Weekly off</th><th>Login</th><th class="num">Present · ${esc(fmtMonthS(m))}</th>${isOwner() ? '<th class="num">Salary</th>' : ''}<th></th></tr></thead><tbody>
    ${staff.map(s => { const p = S.profiles.find(x => x.id === s.profileId); const days = S.staffAtt.filter(a => a.staff_id === s.id && mKey(a.work_date) === m).reduce((t, a) => t + (a.status === 'leave' ? 0 : a.status === 'half' ? 0.5 : a.clock_in || a.status === 'present' ? 1 : 0), 0);
      return `<tr><td><div class="who">${esc(s.name)}${s.active === false ? ' <span class="chip neutral">inactive</span>' : ''}</div><div class="meta"><span class="empcode">${esc(s.code)}</span> · ${esc(s.title)}${s.joinDate ? ' · joined ' + esc(fmtDate(s.joinDate)) : ''}</div></td><td>${esc(s.phone || '—')}</td><td>${esc(s.shift || '—')}</td><td>${esc(s.weeklyOff || 'None')}</td>
      <td>${s.profileId ? `<span class="chip good">${esc(p ? ROLE_LABEL[roleOf(p)] : 'Linked')}</span>` : '<span class="chip warn">No login</span>'}</td><td class="num">${days}</td>${isOwner() ? `<td class="num">${S.pay[s.id] ? esc(money(S.pay[s.id])) : '—'}</td>` : ''}
      <td><div class="row-actions"><button class="btn sm" data-act="staffAtt" data-id="${s.id}">Attendance</button>${isOwner() ? `<button class="btn sm" data-act="staffTarget" data-id="${s.id}">Targets</button><button class="btn sm" data-act="editStaff" data-id="${s.id}">Edit</button>${s.profileId ? `<button class="btn sm" data-act="viewEmp" data-id="${s.id}">Dashboard</button>` : ''}` : ''}</div></td></tr>`; }).join('')}
    </tbody></table>${staff.length ? '' : `<div class="empty">No employees yet.${isOwner() ? ' Use Add employee. Each one gets an Employee ID automatically.' : ''}</div>`}</div></section>`;
}

function vTargets() {
  const m = ui.tMonth || curMonth(); const a = achieved(m), t = S.targets[m] || {};
  const hist = []; for (let i = 5; i >= 0; i--) { const k = shiftMonth(m, -i); hist.push({ k, tick: fmtMonthS(k), target: Number((S.targets[k] || {}).revenue || 0), actual: achieved(k).revenue, hl: i === 0 }); }
  const team = list('staff').filter(s => s.active !== false).sort((x, y) => x.code.localeCompare(y.code));
  return header('Targets', `Gym and team targets · ${esc(fmtMonth(m))}`, `<input type="month" id="tMonth" class="field-inline" value="${m}" data-bind="tMonth" aria-label="Month">${isManager() ? `<button class="btn primary" data-act="setTargets">Set gym targets</button>` : ''}`)
    + `<section class="panel"><h2>Gym targets</h2><div class="tgt-grid">${progressRow('Revenue collected', a.revenue, t.revenue, money)}${progressRow('New members', a.newMembers, t.newMembers)}${progressRow('Renewals', a.renewals, t.renewals)}${progressRow('Total check-ins', a.checkins, t.checkins)}</div></section>
    <section class="panel"><div class="panel-head"><h2>Team targets & incentives</h2>${isOwner() ? '<span class="meta">Only the owner sets personal targets and incentives</span>' : ''}</div><div class="tbl-wrap"><table><thead><tr><th>Employee</th><th class="num">New members</th><th class="num">Renewals</th><th class="num">Revenue</th><th class="num">Incentive</th><th></th></tr></thead><tbody>
    ${team.map(s => { const tg = targetFor(s.id, m); const ach = s.profileId ? personalAchieved(s.profileId, m) : { newMembers: 0, renewals: 0, revenue: 0 }; const p = payrollFor(s.id, m);
      return `<tr><td><div class="who">${esc(s.name)}</div><div class="meta"><span class="empcode">${esc(s.code)}</span> · ${esc(s.title)}</div></td><td class="num">${ach.newMembers}${tg.new_members ? ' / ' + tg.new_members : ''}</td><td class="num">${ach.renewals}${tg.renewals ? ' / ' + tg.renewals : ''}</td><td class="num">${esc(moneyK(ach.revenue))}${tg.revenue ? ' / ' + esc(moneyK(tg.revenue)) : ''}</td><td class="num">${p.potential ? `<span class="chip ${p.met ? 'good' : 'neutral'}">${esc(money(p.potential))}${p.met ? ' earned' : ''}</span>` : '—'}</td><td>${isOwner() ? `<button class="btn sm" data-act="staffTarget" data-id="${s.id}">Set</button>` : ''}</td></tr>`; }).join('')}
    </tbody></table>${team.length ? '' : '<div class="empty">No employees yet.</div>'}</div></section>
    <section class="panel"><div class="panel-head"><h2>Revenue · 6 months</h2><span class="legend"><span><i style="background:var(--surface-2);border:1px dashed var(--bar2)"></i>Target</span><span><i style="background:var(--bar2)"></i>Achieved</span></span></div>${pairChart(hist, { fmt: moneyK })}</section>`;
}

function vEquipment() {
  let rows = list('equipment').map(e => ({ ...e, st: eqState(e), next: nextService(e) })).sort((a, b) => (a.next || '9').localeCompare(b.next || '9'));
  const c = { all: rows.length, attention: rows.filter(r => ['bad', 'warn'].includes(r.st.cls)).length }; if (ui.eqFilter === 'attention') rows = rows.filter(r => ['bad', 'warn'].includes(r.st.cls));
  return header('Equipment', `${c.all} machines tracked`, `<button class="btn primary" data-act="addEquipment">Add equipment</button>`)
    + `<section class="panel"><div class="toolbar"><div class="seg" role="group" aria-label="Filter">${[['all', 'All'], ['attention', 'Needs attention']].map(([k, l]) => `<button data-act="eqFilter" data-v="${k}" aria-pressed="${ui.eqFilter === k}">${l} <span class="meta">${c[k]}</span></button>`).join('')}</div></div>
    <div class="tbl-wrap"><table><thead><tr><th>Equipment</th><th>Category</th><th>Last service</th><th>Next service</th><th>Status</th><th></th></tr></thead><tbody>
    ${rows.map(e => `<tr><td><div class="who">${esc(e.name)}</div><div class="meta">${esc([e.brand, e.vendor && ('Vendor: ' + e.vendor)].filter(Boolean).join(' · '))}</div></td><td>${esc(e.category || '')}</td><td>${esc(fmtDate(e.lastService))}</td><td>${esc(fmtDate(e.next))} <span class="meta">every ${Number(e.intervalDays || 90)}d</span></td><td><span class="chip ${e.st.cls}">${esc(e.st.label)}</span></td>
      <td><div class="row-actions"><button class="btn sm primary" data-act="logService" data-id="${e.id}">Log service</button><button class="btn sm" data-act="eqHistory" data-id="${e.id}">History</button><button class="btn sm" data-act="editEquipment" data-id="${e.id}">Edit</button>${isManager() ? `<button class="btn sm danger" data-act="delete" data-col="equipment" data-id="${e.id}">Delete</button>` : ''}</div></td></tr>`).join('')}
    </tbody></table>${rows.length ? '' : `<div class="empty">${c.all ? 'Nothing needs attention.' : 'No equipment yet.'}</div>`}</div></section>`;
}

function accessChip(p) {
  if (!p.access_until) return '<span class="chip neutral">No end date</span>';
  const d = diffDays(p.access_until, today());
  return d < 0 ? `<span class="chip bad">Expired ${esc(fmtShort(p.access_until))}</span>` : d <= 14 ? `<span class="chip warn">Ends in ${d}d</span>` : `<span class="chip good">Until ${esc(fmtDate(p.access_until))}</span>`;
}
function vTeam() {
  const staffLogins = S.profiles.filter(p => p.role !== 'member' && !(p.role === 'pending' && p.portal === 'member'));
  const pending = staffLogins.filter(p => p.role === 'pending');
  const active = staffLogins.filter(p => p.role !== 'pending');
  const memberLogins = S.profiles.filter(p => p.role === 'member' || (p.role === 'pending' && p.portal === 'member'));
  const staffList = list('staff').sort((a, b) => a.code.localeCompare(b.code)); const linkedTo = pid => staffList.find(s => s.profileId === pid);
  const inv = S.invitations.filter(i => i.status === 'pending');
  const roleSel = (p, attr) => `<select class="field-inline" ${attr} aria-label="Role">${['pending', ...STAFF_ROLES].map(r => `<option value="${r}" ${p.role === r ? 'selected' : ''}>${ROLE_LABEL[r]}</option>`).join('')}</select>`;
  const empSel = p => { const ln = linkedTo(p.id); return `<select class="field-inline" data-act-change="linkStaff" data-id="${p.id}" aria-label="Employee record"><option value="">Not linked</option>${staffList.map(s => `<option value="${s.id}" ${ln && ln.id === s.id ? 'selected' : ''} ${s.profileId && s.profileId !== p.id ? 'disabled' : ''}>${esc(s.code)} · ${esc(s.name)}</option>`).join('')}</select>`; };
  return header('Logins & Access', 'Invite people, choose their role and how long their access lasts.', `<button class="btn" data-act="inviteMember">Invite member</button><button class="btn primary" data-act="inviteStaff">Invite team member</button>`)
    + `<div class="kpis">${kpi('Team logins', active.length, 'Owner/Admin, Manager, Trainer, Receptionist')}${kpi('Waiting for approval', pending.length, 'signed up themselves', { alert: pending.length > 0 })}${kpi('Invitations sent', inv.length, 'not accepted yet')}${kpi('Member logins', memberLogins.filter(p => p.role === 'member').length, 'using the Member portal')}</div>
    ${pending.length ? `<section class="panel"><h2>Waiting for approval</h2><div class="tbl-wrap"><table><thead><tr><th>Name</th><th>Email</th><th>Signed up</th><th>Give role</th></tr></thead><tbody>${pending.map(p => `<tr><td class="who">${esc(p.full_name || '')}</td><td>${esc(p.email)}</td><td>${esc(fmtDate(String(p.created_at).slice(0, 10)))}</td><td>${roleSel(p, `data-act-change="setRole" data-id="${p.id}"`)}</td></tr>`).join('')}</tbody></table></div><div class="meta">Approving a self sign-up gives access with no end date. Set an end date afterwards, or use <b>Invite team member</b> to choose the period up front.</div></section>` : ''}
    <section class="panel"><h2>Team logins</h2><div class="tbl-wrap"><table><thead><tr><th>Name</th><th>Role & dashboard</th><th>Employee record</th><th>Access until</th><th></th></tr></thead><tbody>
    ${active.map(p => { const self = p.id === me.id; return `<tr><td><div class="who">${esc(p.full_name || '')}${self ? ' <span class="meta">(you)</span>' : ''}</div><div class="meta">${esc(p.email)}</div>${p.extension_requested_at ? '<span class="chip warn">Asked for extension</span>' : ''}</td>
      <td>${self ? `<span class="chip neutral">${ROLE_LABEL[p.role]}</span>` : roleSel(p, `data-act-change="setRole" data-id="${p.id}"`)}</td><td>${empSel(p)}</td>
      <td>${self ? accessChip(p) : `<div class="actions">${accessChip(p)}<input type="date" class="field-inline" value="${p.access_until || ''}" data-act-change="setAccess" data-id="${p.id}" aria-label="Access until"><button class="btn sm" data-act="clearAccess" data-id="${p.id}" title="Remove end date">No end</button></div>`}</td>
      <td>${!self && linkedTo(p.id) ? `<button class="btn sm" data-act="viewEmp" data-id="${linkedTo(p.id).id}">View dashboard</button>` : ''}</td></tr>`; }).join('')}
    </tbody></table></div></section>
    ${inv.length ? `<section class="panel"><h2>Invitations not yet accepted</h2><div class="tbl-wrap"><table><thead><tr><th>Email</th><th>Role</th><th>Access until</th><th>Sent</th><th></th></tr></thead><tbody>${inv.map(i => `<tr><td>${esc(i.email)}<div class="meta">${esc(i.full_name || '')}</div></td><td>${esc(ROLE_LABEL[i.role])}${i.member_id && S.members[i.member_id] ? ' · ' + esc(S.members[i.member_id].code) : ''}</td><td>${esc(i.access_until ? fmtDate(i.access_until) : 'No end date')}</td><td>${esc(fmtDate(String(i.created_at).slice(0, 10)))}</td><td><div class="row-actions"><button class="btn sm" data-act="resendInvite" data-id="${i.id}">Resend email</button><button class="btn sm danger" data-act="cancelInvite" data-id="${i.id}">Cancel</button></div></td></tr>`).join('')}</tbody></table></div></section>` : ''}
    <section class="panel"><h2>Member logins</h2><div class="tbl-wrap"><table><thead><tr><th>Name</th><th>Membership</th><th>Status</th><th>Access until</th><th></th></tr></thead><tbody>
    ${memberLogins.map(p => { const m = p.member_id && S.members[p.member_id]; return `<tr><td><div class="who">${esc(p.full_name || '')}</div><div class="meta">${esc(p.email)}</div></td><td>${m ? `<a class="mid who" href="#member-${p.member_id}">${esc(m.code)}</a> ${esc(m.name)}` : '—'}</td><td>${p.role === 'member' ? '<span class="chip good">Linked</span>' : '<span class="chip warn">Not linked</span>'}${p.extension_requested_at ? ' <span class="chip warn">Asked for extension</span>' : ''}</td>
      <td>${p.role === 'member' ? `<div class="actions">${accessChip(p)}<input type="date" class="field-inline" value="${p.access_until || ''}" data-act-change="setAccess" data-id="${p.id}" aria-label="Access until"></div>` : '—'}</td><td>${p.role === 'member' ? `<button class="btn sm danger" data-act="unlinkMember" data-id="${p.id}">Remove access</button>` : ''}</td></tr>`; }).join('')}
    </tbody></table>${memberLogins.length ? '' : '<div class="empty">No member logins yet. Use Invite member, or members can sign up from the website and link with their Membership ID.</div>'}</div></section>`;
}

/* ======================================================================
   OWNER: website themes ("workout mixes")
   ====================================================================== */
const INTERVALS = [[15, '15 seconds'], [30, '30 seconds'], [40, '40 seconds'], [60, '1 minute'], [120, '2 minutes'], [300, '5 minutes'], [900, '15 minutes'], [3600, '1 hour']];
const MODES = [['rotate', 'Rotate all'], ['daypart', 'Follow time of day'], ['pinned', 'Pin one mix']];
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
let themeStage = null, themeCanvas = null;
const allMixes = () => (S.themes.length ? S.themes : DEFAULT_MIXES.map((m, i) => ({ ...m, enabled: true, sort: i + 1, builtin: true }))).slice().sort((a, b) => a.sort - b.sort);
function previewMix() { const all = allMixes(); return all.find(m => m.id === ui.mixPreview) || playlist(all, S.themeCfg || {})[0]; }
function mountThemeStage() {
  const c = document.getElementById('themeStage');
  if (!c) { if (themeStage) { themeStage.destroy(); themeStage = null; themeCanvas = null; } return; }
  if (c !== themeCanvas) { if (themeStage) themeStage.destroy(); themeCanvas = c; themeStage = createStage(c, { reduced: reducedMotion, maxDpr: 1 }); }
  themeStage.setMix(previewMix());
}
const cover = m => `background:linear-gradient(135deg,${m.a} 0%,${m.c} 55%,${m.b} 100%)`;
function vThemes() {
  const all = allMixes(); const cfg = S.themeCfg || configFromRow(null); const live = playlist(all, cfg); const pm = previewMix();
  const dp = daypartNow();
  const liveNote = cfg.mode === 'pinned' ? `Pinned to <b>${esc(live[0].name)}</b>.` : cfg.mode === 'daypart' ? `It’s ${esc(DAYPARTS[dp].split(' (')[0].toLowerCase())} now, so the website plays ${live.map(m => `<b>${esc(m.name)}</b>`).join(', ')}.` : `Rotating ${live.length} mix${live.length === 1 ? '' : 'es'}, one every ${esc((INTERVALS.find(i => i[0] === cfg.intervalSec) || [0, cfg.intervalSec + ' seconds'])[1])}.`;
  return header('Themes & visuals', 'Workout themes play behind your website and colour the Employee Dashboard, like playlists. Choose which ones play, how often they change, and which logo animations rotate. Changes go live straight away.', `<button class="btn primary" data-act="mixNew">New theme</button>`)
    + `<div class="mix-hero"><section class="panel mix-stage-wrap"><canvas id="themeStage" aria-label="Preview of ${esc(pm.name)}"></canvas>
        <div class="mix-stage-cap"><span class="mix-cover sm" style="${cover(pm)}"></span><div><small>${ui.mixPreview ? 'Previewing' : 'On the website now'}</small><b>${esc(pm.name)}</b><span>${pm.bpm} BPM · ${esc(MOTIONS[pm.motion].split(':')[0])}</span></div></div></section>
      <section class="panel"><h2>Playback rules</h2><p class="meta" style="margin:0 0 14px">${liveNote}</p>
        <label class="lbl">How the website picks a mix</label><div class="seg" role="group" aria-label="Mode">${MODES.map(([k, l]) => `<button data-act="mixMode" data-v="${k}" aria-pressed="${cfg.mode === k}">${l}</button>`).join('')}</div>
        ${cfg.mode === 'pinned' ? `<label class="lbl" for="mixPinned">Pinned mix</label><select id="mixPinned" class="field-inline" data-act-change="mixPinned">${all.filter(m => m.enabled).map(m => `<option value="${esc(m.id)}" ${m.id === (cfg.pinned || live[0].id) ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}</select>` : `<label class="lbl" for="mixInterval">Change every</label><select id="mixInterval" class="field-inline" data-act-change="mixInterval">${(INTERVALS.some(i => i[0] === cfg.intervalSec) ? INTERVALS : [...INTERVALS, [cfg.intervalSec, cfg.intervalSec + ' seconds']].sort((x, y) => x[0] - y[0])).map(([v, l]) => `<option value="${v}" ${v === cfg.intervalSec ? 'selected' : ''}>${l}</option>`).join('')}</select>`}
        <label class="lbl" style="display:flex;gap:8px;align-items:center;margin-top:16px"><input type="checkbox" data-act-change="mixVisitor" ${cfg.visitorControls ? 'checked' : ''}> Let visitors skip and pause mixes</label>
        <p class="meta">Visitors can always pause the moving background, because some people find motion distracting.</p></section></div>
    ${visualsPanels()}
    <section class="panel"><div class="panel-head"><h2>Your mixes</h2><span class="meta">${all.filter(m => m.enabled).length} of ${all.length} playing</span></div>
      <div class="mix-grid">${all.map((m, i) => { const r = readability(m); const isLive = live.some(x => x.id === m.id);
        return `<article class="mix ${m.enabled ? '' : 'off'} ${pm.id === m.id ? 'sel' : ''}">
          <button class="mix-cover" style="${cover(m)}" data-act="mixPreview" data-id="${esc(m.id)}" aria-label="Preview ${esc(m.name)}"><span class="mix-bars"><i></i><i></i><i></i></span><b>${esc(m.name)}</b>${isLive && m.enabled ? '<span class="mix-live">Playing</span>' : ''}</button>
          <div class="mix-body"><div class="who">${esc(m.name)}</div><div class="meta">${esc(m.tagline || '')}</div>
            <div class="mix-tags"><span class="chip neutral">${m.bpm} BPM</span><span class="chip neutral">${esc(MOTIONS[m.motion].split(':')[0])}</span><span class="chip neutral">${esc(DAYPARTS[m.daypart].split(' (')[0])}</span>${r.ok ? '' : '<span class="chip bad" title="Accent colour is hard to read on the dark page">Low contrast</span>'}</div>
            <div class="row-actions"><label class="switch"><input type="checkbox" data-act-change="mixEnabled" data-id="${esc(m.id)}" ${m.enabled ? 'checked' : ''}><span>${m.enabled ? 'On' : 'Off'}</span></label>
              <button class="btn sm" data-act="mixMove" data-id="${esc(m.id)}" data-v="-1" ${i === 0 ? 'disabled' : ''} aria-label="Move ${esc(m.name)} earlier">↑</button><button class="btn sm" data-act="mixMove" data-id="${esc(m.id)}" data-v="1" ${i === all.length - 1 ? 'disabled' : ''} aria-label="Move ${esc(m.name)} later">↓</button>
              <button class="btn sm" data-act="mixEdit" data-id="${esc(m.id)}">Edit</button>${m.builtin ? '' : `<button class="btn sm danger" data-act="mixDelete" data-id="${esc(m.id)}">Delete</button>`}</div></div></article>`; }).join('')}</div></section>`;
}
const slug = s => String(s).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32) || 'mix';
function mixValues(form) { const v = formValues(form); return { id: 'draft', name: v.name || 'New mix', tagline: v.tagline || '', a: v.a, b: v.b, c: v.c, motion: v.motion, bpm: Math.min(200, Math.max(50, Number(v.bpm) || 120)), daypart: v.daypart, enabled: !!v.enabled }; }
let modalStage = null;
function updateMixPreview() {
  const form = $('#modalForm'); const c = $('#mixPrev'); if (!form || !c) return;
  if (!modalStage || modalStage.canvas !== c) { if (modalStage) modalStage.stage.destroy(); modalStage = { canvas: c, stage: createStage(c, { reduced: reducedMotion, maxDpr: 1 }) }; }
  const m = mixValues(form); modalStage.stage.setMix({ ...m, id: m.a + m.b + m.c + m.motion + m.bpm }, { instant: true });
  const r = readability(m);
  $('#mixCheck').innerHTML = r.ok ? `<span class="chip good">Readable</span> <span class="meta">Accent contrast ${r.onPage.toFixed(1)}:1 on the page, ${r.onButton.toFixed(1)}:1 on buttons.</span>` : `<span class="chip bad">Too dark to read</span> <span class="meta">The accent colour needs at least 4.5:1 contrast (now ${Math.min(r.onPage, r.onButton).toFixed(1)}:1). Pick a lighter accent.</span>`;
}
function mixForm(id) {
  const m = id ? allMixes().find(x => x.id === id) : { name: '', tagline: '', a: '#E8A272', b: '#B86B3C', c: '#FF7A33', motion: 'ember', bpm: 128, daypart: 'any', enabled: true };
  if (!m) return;
  openModal(id ? `Edit mix · ${m.name}` : 'New mix', `<canvas id="mixPrev" class="mix-prev" aria-hidden="true"></canvas><div id="mixCheck" style="margin:8px 0 4px"></div>` + fieldsHtml([
    { k: 'name', label: 'Mix name', req: true, ph: 'e.g. Leg Day Thunder' }, { k: 'tagline', label: 'Tagline', ph: 'One short line, shown on the website' },
    { sec: 'Colours' }, { k: 'a', label: 'Accent (buttons, highlights)', type: 'color' }, { k: 'b', label: 'Deep shade', type: 'color' }, { k: 'c', label: 'Glow', type: 'color' },
    { sec: 'Feel' }, { k: 'motion', label: 'Motion', type: 'select', options: Object.entries(MOTIONS) }, { k: 'bpm', label: 'Tempo (BPM, 50–200)', type: 'number', hint: 'Higher tempo, faster motion' },
    { k: 'daypart', label: 'Best time of day', type: 'select', options: Object.entries(DAYPARTS), hint: 'Used when the website follows the time of day' },
    { k: 'enabled', label: 'Play this mix on the website', type: 'checkbox', full: true }], m), {
    submitLabel: id ? 'Save mix' : 'Add mix',
    submit: v => {
      const mv = { name: (v.name || '').slice(0, 40), tagline: (v.tagline || '').slice(0, 90) || null, color_a: v.a, color_b: v.b, color_c: v.c, motion: v.motion, bpm: Math.min(200, Math.max(50, Number(v.bpm) || 120)), daypart: v.daypart, enabled: !!v.enabled };
      if (!mv.name) return toast('Give the mix a name.');
      const r = readability({ a: v.a }); if (!r.ok) { toast('That accent colour is too dark to read on the website. Pick a lighter accent.'); return mixForm(id); }
      if (id) return mutate(() => q(supabase.from('site_themes').update(mv).eq('id', id)), 'Mix saved · live on the website');
      const taken = new Set(allMixes().map(x => x.id)); let nid = slug(mv.name), n = 2; while (taken.has(nid)) nid = `${slug(mv.name).slice(0, 28)}-${n++}`;
      const sort = Math.max(0, ...allMixes().map(x => x.sort || 0)) + 1;
      return mutate(() => q(supabase.from('site_themes').insert({ id: nid, ...mv, sort, builtin: false })), 'Mix added · live on the website');
    },
  });
  updateMixPreview();
}
const setThemeCfg = (patch, msg = 'Website updated') => mutate(() => q(supabase.from('site_theme_config').update(patch).eq('id', 1)), msg);

/* ---------- dashboard theme (staff) ---------- */
const DASH_MODES = [['follow', 'Same as website'], ['fixed', 'One theme for everyone'], ['personal', 'Each person picks'], ['off', 'Plain (no theme)']];
let dashStage = null, dashSig = '';
const dashKey = () => 'jarin-dash-mix-' + (me && me.id);
function dashMix() {
  const cfg = S.themeCfg || configFromRow(null); const all = allMixes().filter(m => m.enabled !== false);
  const mode = cfg.dashboardMode || 'follow';
  if (mode === 'off') return null;
  if (mode === 'fixed') return all.find(m => m.id === cfg.dashboardTheme) || playlist(allMixes(), cfg)[0];
  if (mode === 'personal') { let pick = null; try { pick = localStorage.getItem(dashKey()); } catch (e) { /* ignore */ } if (pick === 'none') return null; const f = all.find(m => m.id === pick); if (f) return f; }
  return playlist(allMixes(), cfg)[0];
}
function applyDashTheme() {
  const m = dashMix(); const r = document.documentElement;
  const wrap = document.getElementById('myThemeWrap'); const cfg = S.themeCfg || configFromRow(null);
  if (wrap) {
    wrap.hidden = cfg.dashboardMode !== 'personal';
    if (!wrap.hidden) { let pick = ''; try { pick = localStorage.getItem(dashKey()) || ''; } catch (e) { /* ignore */ } $('#myTheme').innerHTML = `<option value="">Same as website</option><option value="none" ${pick === 'none' ? 'selected' : ''}>Plain (no theme)</option>` + allMixes().filter(x => x.enabled !== false).map(x => `<option value="${esc(x.id)}" ${pick === x.id ? 'selected' : ''}>${esc(x.name)}</option>`).join(''); }
  }
  let c = document.getElementById('dashStage');
  if (!m) { for (const k of ['--accent', '--accent-2', '--accent-soft']) r.style.removeProperty(k); if (c) c.hidden = true; if (dashStage) dashStage.pause(); dashSig = ''; return; }
  r.style.setProperty('--accent', m.a); r.style.setProperty('--accent-2', m.b); r.style.setProperty('--accent-soft', `color-mix(in srgb, ${m.a} 16%, #0B0908)`);
  if (!c) { c = document.createElement('canvas'); c.id = 'dashStage'; c.setAttribute('aria-hidden', 'true'); document.body.prepend(c); dashStage = createStage(c, { reduced: reducedMotion, maxDpr: 1 }); }
  c.hidden = false; const sig = [m.id, m.a, m.b, m.c, m.motion, m.bpm].join('|');
  if (sig !== dashSig) { dashSig = sig; dashStage.setMix(m); dashStage.play(); }
}
const reelCfg = () => S.content.logo_reel || DEFAULT_CONTENT.logo_reel;
const saveContent = (key, value, msg = 'Website updated') => mutate(() => q(supabase.from('site_content').upsert({ key, value })), msg);
function visualsPanels() {
  const cfg = S.themeCfg || configFromRow(null); const all = allMixes().filter(m => m.enabled !== false); const rc = reelCfg(); const vids = rc.videos || [];
  return `<div class="grid2">
    <section class="panel"><h2>Employee dashboard theme</h2><p class="meta" style="margin:0 0 12px">The dashboard takes the theme’s colours and a calm moving background. Charts and buttons follow the theme.</p>
      <div class="seg wrap" role="group" aria-label="Dashboard theme">${DASH_MODES.map(([k, l]) => `<button data-act="dashMode" data-v="${k}" aria-pressed="${(cfg.dashboardMode || 'follow') === k}">${l}</button>`).join('')}</div>
      ${cfg.dashboardMode === 'fixed' ? `<label class="lbl" for="dashTheme">Theme for everyone</label><select id="dashTheme" class="field-inline" data-act-change="dashTheme">${all.map(m => `<option value="${esc(m.id)}" ${m.id === cfg.dashboardTheme ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}</select>` : ''}
      ${cfg.dashboardMode === 'personal' ? '<p class="meta">Each person chooses under “My theme” at the bottom of the menu. Their choice stays on their own device.</p>' : ''}</section>
    <section class="panel"><h2>Logo animations</h2><p class="meta" style="margin:0 0 10px">Your animated logos play one after another in the website’s hero${rc.dashboard !== false ? ' and on the dashboard sign-in screen' : ''}.</p>
      <label class="lbl" style="display:flex;gap:8px;align-items:center"><input type="checkbox" data-act-change="reelOn" ${rc.enabled !== false ? 'checked' : ''}> Show logo animations on the website</label>
      <label class="lbl" style="display:flex;gap:8px;align-items:center;margin-top:6px"><input type="checkbox" data-act-change="reelDash" ${rc.dashboard !== false ? 'checked' : ''}> Also show on the dashboard sign-in screen</label>
      <div class="reel-list">${vids.map((v, i) => `<div class="reel-item ${v.enabled === false ? 'off' : ''}"><button class="reel-thumb" data-act="reelPreview" data-id="${esc(v.id)}" aria-label="Play ${esc(v.name)}"><img src="/media/${esc(v.id)}.jpg" alt="" loading="lazy"></button>
        <div><b>${esc(v.name || LOGO_VIDEOS[v.id] || v.id)}</b><div class="row-actions"><label class="switch"><input type="checkbox" data-act-change="reelVid" data-id="${esc(v.id)}" ${v.enabled !== false ? 'checked' : ''}><span>${v.enabled !== false ? 'On' : 'Off'}</span></label>
        <button class="btn sm" data-act="reelMove" data-id="${esc(v.id)}" data-v="-1" ${i === 0 ? 'disabled' : ''} aria-label="Play ${esc(v.name)} earlier">↑</button><button class="btn sm" data-act="reelMove" data-id="${esc(v.id)}" data-v="1" ${i === vids.length - 1 ? 'disabled' : ''} aria-label="Play ${esc(v.name)} later">↓</button></div></div></div>`).join('')}</div></section></div>`;
}

/* ---------- WEBSITE CONTENT (owner + manager) ---------- */
const lines = t => String(t || '').split('\n').map(x => x.trim()).filter(Boolean);
const num = v => Number(String(v ?? '').replace(/[^\d.]/g, '')) || 0;
const cm = n => '₹' + Number(n || 0).toLocaleString('en-IN');
function contentCard(key, title, body, extra = '') {
  return `<section class="panel ccard"><div class="panel-head"><h2>${esc(title)}</h2><div class="row-actions">${extra}<button class="btn sm" data-act="cEdit" data-k="${key}">Edit</button><button class="btn sm" data-act="cReset" data-k="${key}" title="Go back to the fee guide values">Reset</button></div></div>${body}</section>`;
}
function vContent() {
  const c = S.content; const f = c.fees; const fmtT = t => { const [h, m] = String(t).split(':').map(Number); return `${((h + 11) % 12) + 1}:${String(m || 0).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`; };
  return header('Website content', 'Everything visitors read about plans, prices and services. Changes appear on the website and in the chat assistant within seconds.', `<a class="btn" href="${WEBSITE_URL}" target="_blank" rel="noopener">View website</a>`)
    + `<div class="grid2">`
    + contentCard('fees', 'Fees', `<div class="kv"><span>Registration (one time)</span><b>${cm(f.registration)}</b><span>Personal trainer</span><b>${cm(f.ptMonthly)} / month</b><span>One-day trial pass</span><b>${f.trialPass ? cm(f.trialPass) : 'Free'}</b><span>Personal locker</span><b>${cm(f.locker)} / month</b><span>Top banner</span><b>${esc(f.banner || '—')}</b></div>`)
    + contentCard('hours', 'Opening hours', `<div class="kv"><span>Open</span><b>${fmtT(c.hours.open)} – ${fmtT(c.hours.close)}</b><span>Closed on</span><b>${esc((c.hours.closed || []).join(', ') || 'Never')}</b><span>Note</span><b>${esc(c.hours.note || '—')}</b></div>`)
    + `</div>`
    + `<section class="panel"><div class="panel-head"><h2>Membership plans</h2><div class="row-actions"><button class="btn sm primary" data-act="planEdit">Add plan</button><button class="btn sm" data-act="cReset" data-k="plans">Reset</button></div></div>
      <div class="tbl-wrap"><table><thead><tr><th>Plan</th><th class="num">Price</th><th class="num">Months</th><th class="num">Per month</th><th>Cult app</th><th>Badge</th><th>Status</th><th></th></tr></thead><tbody>
      ${c.plans.map((p, i) => `<tr><td class="who">${esc(p.name)}</td><td class="num">${cm(p.price)}</td><td class="num">${p.months}</td><td class="num">${cm(Math.round(p.price / Math.max(1, p.months)))}</td><td>${p.cult ? '<span class="chip good">Included</span>' : '—'}</td><td>${p.popular ? '<span class="chip neutral">Most chosen</span>' : '—'}</td><td><span class="chip ${p.enabled !== false ? 'good' : 'neutral'}">${p.enabled !== false ? 'On website' : 'Hidden'}</span></td>
        <td><div class="row-actions"><button class="btn sm" data-act="planMove" data-i="${i}" data-v="-1" ${i === 0 ? 'disabled' : ''} aria-label="Move up">↑</button><button class="btn sm" data-act="planMove" data-i="${i}" data-v="1" ${i === c.plans.length - 1 ? 'disabled' : ''} aria-label="Move down">↓</button><button class="btn sm" data-act="planEdit" data-i="${i}">Edit</button><button class="btn sm danger" data-act="planDelete" data-i="${i}">Delete</button></div></td></tr>`).join('')}
      </tbody></table></div><p class="meta">The registration fee is added on top of every plan. Plans with “Cult app” get the Cult app row in the benefits table.</p></section>`
    + `<div class="grid2">`
    + contentCard('facts', 'Hero facts (4)', `<div class="kv">${c.facts.map(x => `<span>${esc(x.value)}</span><b>${esc(x.label)}</b>`).join('')}</div><p class="meta">Shown once, under the headline. Other sections don’t repeat them.</p>`)
    + contentCard('benefits', 'What you get', `<ul class="clist">${c.benefits.map(b => `<li>${esc(b.text)} <span class="chip ${b.who === 'all' ? 'neutral' : 'good'}">${b.who === 'all' ? 'Every plan' : 'Cult app plans'}</span></li>`).join('')}</ul>`)
    + `</div>`
    + `<section class="panel"><div class="panel-head"><h2>Go further: extra services</h2><div class="row-actions"><button class="btn sm primary" data-act="svcEdit">Add group</button><button class="btn sm" data-act="cReset" data-k="services">Reset</button></div></div>
      <div class="svc-grid">${c.services.map((g, i) => `<div class="svc"><div class="panel-head"><b>${esc(g.title)}</b><div class="row-actions"><button class="btn sm" data-act="svcEdit" data-i="${i}">Edit</button><button class="btn sm danger" data-act="svcDelete" data-i="${i}">Delete</button></div></div><ul class="clist">${(g.items || []).map(([n, pr]) => `<li><span>${esc(n)}</span><b>${cm(pr)}</b></li>`).join('')}</ul>${g.note ? `<div class="meta">${esc(g.note)}</div>` : ''}</div>`).join('')}</div></section>`
    + contentCard('terms', 'Good to know', `<ul class="clist">${c.terms.map(t => `<li>${esc(t)}</li>`).join('')}<li class="meta">${esc(f.gstNote)}</li></ul>`);
}
function contentForm(key) {
  const c = S.content;
  if (key === 'fees') return openModal('Fees', fieldsHtml([{ k: 'registration', label: 'One-time registration fee', type: 'number', req: true }, { k: 'ptMonthly', label: 'Personal trainer, per month', type: 'number' }, { k: 'trialPass', label: 'One-day trial pass (0 = free)', type: 'number' }, { k: 'locker', label: 'Personal locker, per month', type: 'number' }, { k: 'banner', label: 'Top banner on the website', full: true, hint: 'Leave empty to hide. e.g. Grand opening · December 2026' }, { k: 'gstNote', label: 'Tax note', full: true }], c.fees),
    { submit: v => saveContent('fees', { registration: num(v.registration), ptMonthly: num(v.ptMonthly), trialPass: num(v.trialPass), locker: num(v.locker), banner: v.banner || '', gstNote: v.gstNote || '' }, 'Fees updated') });
  if (key === 'hours') return openModal('Opening hours', fieldsHtml([{ k: 'open', label: 'Opens', type: 'time', req: true }, { k: 'close', label: 'Closes', type: 'time', req: true }, { sec: 'Closed on' }, ...WEEK.map(d => ({ k: 'closed_' + d, label: d, type: 'checkbox' })), { k: 'note', label: 'Note (optional)', full: true, ph: 'e.g. Closed on 26 January' }],
    { open: c.hours.open, close: c.hours.close, note: c.hours.note, ...Object.fromEntries(WEEK.map(d => ['closed_' + d, (c.hours.closed || []).includes(d)])) }),
    { submit: v => { if (!v.open || !v.close || v.close <= v.open) return toast('Closing time must be after opening time.'); return saveContent('hours', { open: v.open, close: v.close, closed: WEEK.filter(d => v['closed_' + d]), note: v.note || '' }, 'Opening hours updated'); } });
  if (key === 'facts') return openModal('Hero facts', fieldsHtml(c.facts.slice(0, 4).concat(Array(4).fill({ value: '', label: '' })).slice(0, 4).flatMap((x, i) => [{ k: 'v' + i, label: `Fact ${i + 1}: big text`, def: x.value }, { k: 'l' + i, label: 'Small text', def: x.label }])),
    { submit: v => saveContent('facts', [0, 1, 2, 3].map(i => ({ value: v['v' + i], label: v['l' + i] })).filter(x => x.value), 'Hero facts updated') });
  if (key === 'benefits') return openModal('What you get', fieldsHtml([{ k: 'all', label: 'Included with every plan (one per line)', type: 'textarea', full: true }, { k: 'annual', label: 'Only with plans that include the Cult app (one per line)', type: 'textarea', full: true }],
    { all: c.benefits.filter(b => b.who === 'all').map(b => b.text).join('\n'), annual: c.benefits.filter(b => b.who !== 'all').map(b => b.text).join('\n') }),
    { submit: v => saveContent('benefits', [...lines(v.all).map(t => ({ text: t, who: 'all' })), ...lines(v.annual).map(t => ({ text: t, who: 'annual' }))], 'Benefits updated') });
  if (key === 'terms') return openModal('Good to know', fieldsHtml([{ k: 'terms', label: 'Terms (one per line)', type: 'textarea', full: true, hint: 'The tax note from Fees is added automatically.' }], { terms: c.terms.join('\n') }), { submit: v => saveContent('terms', lines(v.terms), 'Terms updated') });
}
function planForm(i) {
  const list = S.content.plans.slice(); const p = i == null ? { name: '', price: 0, months: 1, cult: false, popular: false, enabled: true } : list[i];
  openModal(i == null ? 'Add plan' : `Edit plan · ${p.name}`, fieldsHtml([{ k: 'name', label: 'Plan name', req: true }, { k: 'price', label: 'Price (₹)', type: 'number', req: true }, { k: 'months', label: 'Length in months', type: 'number', req: true }, { k: 'cult', label: 'Includes the Cult app', type: 'checkbox', full: true }, { k: 'popular', label: 'Show “Most chosen” badge', type: 'checkbox', full: true }, { k: 'enabled', label: 'Show on the website', type: 'checkbox', full: true }], p), {
    submit: v => { if (!v.name || !num(v.price) || !num(v.months)) return toast('Fill in the plan name, price and months.');
      const row = { id: p.id || v.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), name: v.name, price: num(v.price), months: Math.max(1, Math.round(num(v.months))), cult: !!v.cult, popular: !!v.popular, enabled: !!v.enabled };
      if (row.popular) list.forEach(x => { x.popular = false; });
      if (i == null) list.push(row); else list[i] = row; return saveContent('plans', list, 'Plan saved'); },
  });
}
function svcForm(i) {
  const list = S.content.services.slice(); const g = i == null ? { title: '', note: '', items: [] } : list[i];
  openModal(i == null ? 'Add service group' : `Edit · ${g.title}`, fieldsHtml([{ k: 'title', label: 'Group name', req: true, full: true }, { k: 'items', label: 'Items with prices, one per line', type: 'textarea', full: true, hint: 'Write: Item name | price   e.g.  Protein shake | 180' }, { k: 'note', label: 'Small print', full: true }], { title: g.title, note: g.note, items: (g.items || []).map(([n, pr]) => `${n} | ${pr}`).join('\n') }), {
    submit: v => { if (!v.title) return toast('Give the group a name.'); const items = lines(v.items).map(l => { const k = l.lastIndexOf('|'); return k > 0 ? [l.slice(0, k).trim(), num(l.slice(k + 1))] : [l, 0]; }).filter(x => x[0]);
      const row = { title: v.title, note: v.note || '', items }; if (i == null) list.push(row); else list[i] = row; return saveContent('services', list, 'Services updated'); },
  });
}


/* ======================================================================
   OWNER: backup & restore (Excel)
   ====================================================================== */
const BACKUP_TABLES = ['settings', 'members', 'payments', 'attendance', 'member_history', 'member_offers', 'staff', 'staff_pay', 'staff_attendance', 'staff_targets', 'payroll', 'targets', 'equipment', 'service_logs', 'expenses', 'offers', 'enquiries', 'site_themes'];
const JSON_COLS = new Set(['changes', 'payload']);
function vBackup() {
  const r = ui.restore;
  return header('Backup & restore', 'Keep a safe copy of every record as an Excel file, and load it back if data is lost or you move to a new website.')
    + `<div class="grid2">
      <section class="panel"><h2>Download a backup</h2><p class="meta">One Excel workbook with a sheet per table: members, payments, visits, history, offers, staff, attendance, payroll, targets, equipment, expenses and enquiries. Logins and passwords are never included.</p>
        <div><button class="btn primary" data-act="backupDownload">Download Excel backup</button></div>
        <p class="meta">Tip: download one at the end of every month and keep it in OneDrive or Google Drive. Store it safely, because it contains members’ personal details.</p></section>
      <section class="panel"><h2>Restore from a backup</h2><p class="meta">Upload a JARIN backup workbook. Records already in this database are skipped, so uploading the same file twice is safe. People need to be invited again afterwards.</p>
        <label class="drop" id="dropZone"><input type="file" id="restoreFile" accept=".xlsx" hidden><b>Choose a backup file (.xlsx)</b><span class="meta">or drop it here</span></label></section>
    </div>
    ${r ? `<section class="panel"><div class="panel-head"><h2>Ready to restore: ${esc(r.name)}</h2><span class="meta">${r.format ? esc(r.format) : 'unknown format'}</span></div>
      <div class="tbl-wrap"><table class="restore-table"><thead><tr><th>Sheet</th><th class="num">Rows in file</th>${r.result ? '<th class="num">Added</th>' : ''}</tr></thead><tbody>${Object.entries(r.counts).map(([t, n]) => `<tr><td>${esc(t)}</td><td class="num">${n}</td>${r.result ? `<td class="num">${r.result[t] ?? (t === 'settings' ? 'updated' : 0)}</td>` : ''}</tr>`).join('')}</tbody></table></div>
      ${r.result ? '<div class="banner">Restore finished. Rows that already existed were skipped.</div>' : `<div class="actions"><button class="btn" data-act="restoreCancel">Cancel</button><button class="btn primary" data-act="restoreRun">Restore these records</button></div>`}</section>` : ''}`;
}
async function backupDownload() {
  toast('Preparing backup…');
  try {
    const { default: ExcelJS } = await import('exceljs');
    const wb = new ExcelJS.Workbook(); wb.creator = BRAND; wb.created = new Date();
    const readme = wb.addWorksheet('README'); const counts = {};
    const sheets = {};
    for (const t of BACKUP_TABLES) {
      const rows = []; let from = 0;
      for (;;) { const { data, error } = await supabase.from(t).select('*').range(from, from + 999); if (error) throw error; rows.push(...data); if (data.length < 1000) break; from += 1000; }
      counts[t] = rows.length; sheets[t] = rows;
    }
    readme.addRows([[`${BRAND} · data backup`], ['Created', new Date().toLocaleString()], ['Format', 'jarin-backup-v1 — one sheet per table, first row = column names'], [], ['How to restore', 'Employee Dashboard → Backup & restore → Restore from a backup.'], ['Do not', 'rename sheets or column headers, or change ids.'], [], ['Sheet', 'Rows'], ...BACKUP_TABLES.map(t => [t, counts[t]])]);
    readme.getColumn(1).width = 18; readme.getColumn(2).width = 90; readme.getCell('A1').font = { bold: true, size: 14 };
    for (const t of BACKUP_TABLES) {
      const ws = wb.addWorksheet(t); const rows = sheets[t]; const cols = rows.length ? Object.keys(rows[0]) : [];
      if (!cols.length) { ws.addRow(['(no rows)']); continue; }
      ws.addRow(cols); ws.getRow(1).font = { bold: true }; ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8A272' } };
      for (const r of rows) ws.addRow(cols.map(c => (r[c] !== null && typeof r[c] === 'object') ? JSON.stringify(r[c]) : r[c]));
      cols.forEach((c, i) => { ws.getColumn(i + 1).width = Math.min(48, Math.max(10, c.length + 2)); });
      ws.views = [{ state: 'frozen', ySplit: 1 }];
    }
    const meta = wb.addWorksheet('_meta', { state: 'hidden' }); meta.addRows([['format', 'jarin-backup-v1'], ['created', new Date().toISOString()]]);
    const buf = await wb.xlsx.writeBuffer();
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    a.download = `JARIN-backup-${today()}.xlsx`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    toast('Backup downloaded');
  } catch (e) { toast('Backup failed: ' + friendly(e)); }
}
async function restoreRead(file) {
  try {
    const { default: ExcelJS } = await import('exceljs');
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(await file.arrayBuffer());
    const data = {}; const counts = {}; let format = '';
    const metaWs = wb.getWorksheet('_meta'); if (metaWs) metaWs.eachRow(r => { if (r.getCell(1).value === 'format') format = String(r.getCell(2).value); });
    for (const t of BACKUP_TABLES) {
      const ws = wb.getWorksheet(t); if (!ws) continue;
      const head = []; ws.getRow(1).eachCell({ includeEmpty: false }, (c, i) => { head[i] = String(c.value); });
      if (!head.length || head[1] === '(no rows)') { data[t] = []; counts[t] = 0; continue; }
      const rows = [];
      ws.eachRow((row, n) => {
        if (n === 1) return; const o = {}; let any = false;
        head.forEach((h, i) => { if (!h) return; let v = row.getCell(i).value; if (v && typeof v === 'object' && !(v instanceof Date)) v = v.text ?? v.result ?? v.richText?.map(x => x.text).join('') ?? null;
          if (v instanceof Date) v = v.toISOString(); if (v === '' || v === undefined) v = null;
          if (v !== null && JSON_COLS.has(h) && typeof v === 'string') { try { v = JSON.parse(v); } catch { /* keep text */ } }
          if (v !== null) any = true; o[h] = v; });
        if (any) rows.push(o);
      });
      data[t] = rows; counts[t] = rows.length;
    }
    if (!Object.keys(counts).length) { toast('This file has no JARIN backup sheets. Choose a file made by “Download Excel backup”.'); return; }
    ui.restore = { name: file.name, format, counts, data, result: null }; render();
  } catch (e) { toast('Could not read that file. Make sure it is an .xlsx backup.'); }
}
async function restoreRun() {
  const r = ui.restore; if (!r) return;
  const { data, error } = await supabase.rpc('restore_backup', { p: r.data });
  if (error || !data || !data.ok) { toast(error ? friendly(error) : 'Only the owner can restore backups.'); return; }
  r.result = data.inserted; toast('Restore finished'); await loadAll();
}

const VIEW_FN = { content: vContent, themes: vThemes, backup: vBackup, overview: vOverview, approvals: vApprovals, me: vMe, clients: vClients, member: vMember, members: vMembers, attendance: vAttendance, renewals: vRenewals, enquiries: vEnquiries, offers: vOffers, finance: vFinance, payroll: vPayroll, staff: vStaff, targets: vTargets, equipment: vEquipment, team: vTeam };

/* ======================================================================
   App shell & auth screens
   ====================================================================== */
function renderApp() {
  if (!$('#main')) {
    root.innerHTML = `<div class="app"><aside class="rail">
      <a class="brand" href="#overview" style="text-decoration:none;color:inherit" aria-label="${BRAND} dashboard">${LOCKUP}</a>
      <nav class="views" id="nav" aria-label="Sections"></nav>
      <div class="rail-foot"><label class="mytheme" id="myThemeWrap" hidden><span>My theme</span><select id="myTheme" data-act-change="myTheme" aria-label="My dashboard theme"></select></label><div class="tagline">${TAGLINE}</div><div class="me"><b id="meName"></b><span id="meRole"></span></div>
        ${''}<button class="btn sm" data-act="settings">Gym settings</button><a class="btn sm" href="${WEBSITE_URL}" target="_blank" rel="noopener">View website</a><button class="btn sm" data-act="signOut">Sign out</button></div>
    </aside><main id="main"></main></div>`;
  }
  const main = $('#main'); const a = document.activeElement; const fid = a && a.id && main.contains(a) ? a.id : null; let ss = null;
  try { ss = fid ? a.selectionStart : null; } catch (e) { /* ignore */ }
  const needPw = session.user.user_metadata && session.user.user_metadata.invited_role && !session.user.user_metadata.password_set;
  main.innerHTML = (needPw ? `<div class="banner" style="display:flex;justify-content:space-between;gap:10px;align-items:center;flex-wrap:wrap"><span>You signed in with an email link. Set a password so you can sign in normally next time.</span><button class="btn sm primary" data-act="setPassword">Set password</button></div>` : '') + (loading ? '<div class="empty">Loading your gym records…</div>' : VIEW_FN[view]());
  const rb = renewalBuckets();
  const badges = { renewals: rb.due7.length, equipment: list('equipment').filter(e => eqState(e).cls === 'bad').length, enquiries: S.enquiries.filter(e => e.status === 'New').length, approvals: isOwner() ? pendingApprovals() : 0, team: S.profiles.filter(p => p.role === 'pending' && p.portal !== 'member').length };
  $('#nav').innerHTML = VIEWS.filter(([k]) => allowed(k)).map(([k, l]) => `<a href="#${k}" ${k === view || (view === 'member' && k === 'members') ? 'aria-current="page"' : ''}><span>${l}</span>${badges[k] ? `<span class="count">${badges[k]}</span>` : ''}</a>`).join('')
    + `<a href="#" data-act="settings" class="mobile-only"><span>Settings</span></a><a href="#" data-act="signOut" class="mobile-only"><span>Sign out</span></a>`;
  mountThemeStage(); applyDashTheme();
  document.body.classList.remove('authpage');
  $('#meName').textContent = me.full_name || me.email;
  const st = myStaff(); $('#meRole').innerHTML = `${esc(ROLE_LABEL[myRole()] || '')}${st ? ` · <span class="empcode">${esc(st.code)}</span>` : ''}`;
  document.title = 'Employee Dashboard · ' + (S.settings.gymName || BRAND);
  if (fid) { const el = document.getElementById(fid); if (el) { el.focus(); try { if (ss !== null) el.setSelectionRange(ss, ss); } catch (e) { /* ignore */ } } }
}
function authCard(inner) {
  document.body.classList.add('authpage');
  setTimeout(mountAuthReel, 0);
  root.innerHTML = `<div class="auth"><div class="auth-card"><div class="auth-reel" id="authReel" aria-hidden="true"></div><img class="auth-logo" src="${logoUrl}" alt="${BRAND} – ${TAGLINE}" width="1000" height="375"><div class="meta" style="font-size:13px;font-weight:600">Employee Dashboard</div>${inner}<a class="meta" href="${WEBSITE_URL}" style="text-decoration:none">Go to the JARIN website</a></div></div>`;
}let authReelCfg = null;
function mountAuthReel() {
  const el = document.getElementById('authReel'); if (!el) return;
  const cfg = authReelCfg; const on = cfg && cfg.enabled !== false && cfg.dashboard !== false && (cfg.videos || []).some(v => v.enabled !== false);
  el.hidden = !on; document.querySelector('.auth-card')?.classList.toggle('with-reel', !!on);
  if (on) mountReel(el, cfg);
}
if (configured) supabase.from('site_content').select('value').eq('key', 'logo_reel').maybeSingle().then(({ data }) => { authReelCfg = data ? data.value : DEFAULT_CONTENT.logo_reel; mountAuthReel(); }, () => {});

function renderLogin(mode = 'signin', msg = '') {
  const signup = mode === 'signup', forgot = mode === 'forgot';
  authCard(`<h2>${signup ? 'Create your account' : forgot ? 'Reset your password' : 'Employee sign in'}</h2>
  ${signup ? '<p class="meta" style="margin:0">If the owner invited you, use the link in your invitation email instead. Otherwise create an account and the owner will approve it.</p>' : ''}
  <form id="authForm" class="form" data-mode="${mode}">${signup ? `<label for="a_name">Full name<input id="a_name" name="name" required autocomplete="name"></label>` : ''}
    <label for="a_email">Email<input id="a_email" name="email" type="email" required autocomplete="email"></label>
    ${forgot ? '' : `<label for="a_pw">Password<input id="a_pw" name="password" type="password" required minlength="8" autocomplete="${signup ? 'new-password' : 'current-password'}">${signup ? '<span class="hint">At least 8 characters</span>' : ''}</label>`}
    <div id="authMsg">${msg}</div><button class="btn primary" type="submit">${signup ? 'Create account' : forgot ? 'Send reset link' : 'Sign in'}</button></form>
  <div class="meta" style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap">${signup || forgot ? `<button class="linkbtn" data-auth="signin">Back to sign in</button>` : `<button class="linkbtn" data-auth="signup">Create account</button><button class="linkbtn" data-auth="forgot">Forgot password?</button>`}</div>`);
}
const renderPending = () => authCard(`<h2>Waiting for approval</h2><p>Hi ${esc(me.full_name || '')}, your account has been created. The owner needs to approve it before you can see any records. Ask them to open <b>Logins &amp; Access</b>.</p><div class="actions"><button class="btn" data-act="recheck">Check again</button><button class="btn" data-act="signOut">Sign out</button></div>`);
const renderMemberAccount = () => authCard(`<h2>This is a member login</h2><p>${esc(me.email)} is a gym member account, so it opens the Member portal.</p><div class="actions"><a class="btn primary" href="${WEBSITE_URL}/member">Go to Member portal</a><button class="btn" data-act="signOut">Sign out</button></div>`);
function renderExpired() {
  const asked = me.extension_requested_at;
  authCard(`<h2>Your access has ended</h2><p>Your access to the Employee portal ended on <b>${esc(fmtDate(me.access_until))}</b>. The owner can extend it.</p>
  ${asked ? `<div class="ok">Extension requested on ${esc(new Date(asked).toLocaleDateString())}. You’ll be able to sign in as soon as the owner approves it.</div>` : `<form id="extForm" class="form"><label for="x_note">Message to the owner (optional)<textarea id="x_note" name="note" maxlength="300" placeholder="e.g. Please extend my access for the next 6 months"></textarea></label><div id="authMsg"></div><button class="btn primary" type="submit">Request extension</button></form>`}
  <div class="actions"><button class="btn" data-act="recheck">Check again</button><button class="btn" data-act="signOut">Sign out</button></div>`);
}
const renderNewPassword = () => authCard(`<h2>Choose a new password</h2><form id="pwForm" class="form"><label for="np">New password<input id="np" name="password" type="password" minlength="8" required autocomplete="new-password"></label><div id="authMsg"></div><button class="btn primary" type="submit">Save password</button></form>`);

function render() {
  if (!configured) return authCard(`<h2>Almost there</h2><p>This website isn’t connected to its database yet. Add <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> in Vercel, then redeploy.</p>`);
  if (recovery) return renderNewPassword();
  if (!session) return renderLogin();
  if (!me) return authCard('<div class="empty">Signing you in…</div>');
  const r = myRole();
  if (r === 'member' || (r === 'pending' && me.portal === 'member')) return renderMemberAccount();
  if (r === 'expired') return me.role === 'member' ? renderMemberAccount() : renderExpired();
  if (!STAFF_ROLES.includes(r)) return renderPending();
  renderApp();
}
function route() {
  const h = location.hash.slice(1);
  if (h.startsWith('member-')) { view = 'member'; const id = h.slice(7); if (ui.memberId !== id) { ui.memberId = id; ui.history = null; ui.historyFor = null; } if (session && !loading) loadHistory(id).then(render); }
  else view = VIEW_FN[h] && h !== 'member' ? h : 'overview';
  if (me && view !== 'member' && !allowed(view)) view = 'overview';
  render(); window.scrollTo(0, 0);
}
window.addEventListener('hashchange', route);

async function loadMe() {
  const { data } = await supabase.from('profiles').select('*').eq('id', session.user.id).maybeSingle();
  me = data || { id: session.user.id, email: session.user.email, full_name: '', role: 'pending' };
}
let sessionUser = null;
async function onSession(s) {
  const uid = s ? s.user.id : null;
  if (uid && uid === sessionUser && me) { session = s; return; }
  sessionUser = uid; session = s;
  if (!session) { me = null; loading = true; if (channel) { supabase.removeChannel(channel); channel = null; } render(); return; }
  await loadMe();
  if (!STAFF_ROLES.includes(myRole())) {   // apply an invitation if the owner sent one
    try { const { data } = await supabase.rpc('claim_invitation'); if (data && data.ok) await loadMe(); } catch (e) { /* ignore */ }
  }
  if (STAFF_ROLES.includes(myRole())) { route(); try { await loadAll(); subscribeLive(); } catch (e) { toast(friendly(e)); loading = false; render(); } }
  else render();
}

/* ======================================================================
   Modal & forms
   ====================================================================== */
let modalSubmit = null;
function closeModal() { $('#modalRoot').innerHTML = ''; modalSubmit = null; if (typeof modalStage !== 'undefined' && modalStage) { modalStage.stage.destroy(); modalStage = null; } }
function openModal(title, body, { submit, submitLabel = 'Save', danger = false } = {}) {
  modalSubmit = submit || null;
  $('#modalRoot').innerHTML = `<div class="overlay" data-act="overlay"><form class="modal" id="modalForm" role="dialog" aria-modal="true" aria-label="${esc(title)}"><h2>${esc(title)}</h2>${body}
  <div class="modal-foot"><button type="button" class="btn" data-act="closeModal">${submit ? 'Cancel' : 'Close'}</button>${submit ? `<button type="submit" class="btn primary" ${danger ? 'style="background:var(--bad);border-color:var(--bad);color:#fff"' : ''}>${esc(submitLabel)}</button>` : ''}</div></form></div>`;
  const first = $('#modalForm').querySelector('input:not([type=hidden]),select,textarea'); if (first) first.focus();
}
function fieldsHtml(fields, v = {}) {
  return `<div class="form">${fields.map(f => {
    if (f.sec) return `<div class="sec">${esc(f.sec)}</div>`;
    if (f.calc) return `<div class="calc" id="${f.calc}"></div>`;
    if (f.html) return `<div class="full">${f.html}</div>`;
    const id = 'f_' + f.k; const val = v[f.k] ?? f.def ?? ''; const cls = f.full ? 'full' : '';
    let inp;
    if (f.type === 'select') inp = `<select id="${id}" name="${f.k}">${f.blank ? `<option value="">${esc(f.blank === true ? '— Select —' : f.blank)}</option>` : ''}${f.options.map(o => { const [ov, ol] = Array.isArray(o) ? o : [o, o]; return `<option value="${esc(ov)}" ${String(ov) === String(val) ? 'selected' : ''}>${esc(ol)}</option>`; }).join('')}</select>`;
    else if (f.type === 'textarea') inp = `<textarea id="${id}" name="${f.k}" ${f.req ? 'required' : ''} ${f.ph ? `placeholder="${esc(f.ph)}"` : ''}>${esc(val)}</textarea>`;
    else if (f.type === 'checkbox') return `<label class="${cls}" style="flex-direction:row;align-items:center;gap:8px"><input type="checkbox" id="${id}" name="${f.k}" ${val ? 'checked' : ''} style="width:auto"> ${esc(f.label)}</label>`;
    else inp = `<input id="${id}" name="${f.k}" type="${f.type || 'text'}" value="${esc(val)}" ${f.req ? 'required' : ''} ${f.type === 'number' ? `${f.allowNeg ? '' : 'min="0"'} step="${f.step || 'any'}"` : ''} ${f.ph ? `placeholder="${esc(f.ph)}"` : ''}>`;
    return `<label class="${cls}" for="${id}">${esc(f.label)}${f.req ? ' *' : ''}${inp}${f.hint ? `<span class="hint">${esc(f.hint)}</span>` : ''}</label>`;
  }).join('')}</div>`;
}
function formValues(form) { const o = {}; for (const el of form.elements) { if (!el.name) continue; o[el.name] = el.type === 'checkbox' ? el.checked : el.type === 'number' ? (el.value === '' ? '' : Number(el.value)) : el.value.trim(); } return o; }
const trainerOptions = () => list('staff').filter(s => s.active !== false && /trainer|owner|manager/i.test(s.title)).sort((a, b) => a.name.localeCompare(b.name)).map(s => [s.id, `${s.name} (${s.title})`]);
const staffLoginOptions = (current) => {
  const opts = [[me.id, `Me (${me.full_name || 'owner'})`], ...list('staff').filter(s => s.profileId && s.profileId !== me.id).map(s => [s.profileId, `${s.name} (${s.code})`])];
  if (current && !opts.some(o => o[0] === current)) opts.push([current, personName(current)]);
  return opts;
};

function memberFields(isNew, current) {
  return [
    { sec: 'Contact' }, { k: 'name', label: 'Full name', req: true, full: true }, { k: 'phone', label: 'Phone', type: 'tel', req: true, hint: 'With country code for WhatsApp, e.g. +91 98765 43210' }, { k: 'email', label: 'Email', type: 'email', hint: 'Needed for the Member portal' },
    { sec: 'Body & goal' }, { k: 'heightCm', label: 'Height (cm)', type: 'number', step: '0.1' }, { k: 'weightKg', label: 'Weight (kg)', type: 'number', step: '0.1', hint: 'Update at each check-up' }, { calc: 'bmiCalc' },
    { k: 'goal', label: 'Fitness goal', type: 'select', options: GOALS, blank: true }, { k: 'trainerId', label: 'Assigned trainer', type: 'select', options: trainerOptions(), blank: 'No trainer' },
    { sec: 'How they found us' }, { k: 'source', label: 'Source', type: 'select', options: SOURCES, blank: true }, { k: 'referredBy', label: 'Referred by', hint: 'Name or Membership ID' },
    ...(isOwner() ? [{ k: 'broughtBy', label: 'Brought in by (credited employee)', type: 'select', options: staffLoginOptions(current), full: true, hint: 'Counts towards their targets and My Clients' }] : []),
    { k: 'offer', label: 'Joining offer', full: true, ph: 'e.g. Diwali 20% off' },
    { sec: 'Membership' }, { k: 'plan', label: 'Plan', type: 'select', options: Object.keys(PLANS) }, { k: 'fee', label: 'Plan fee paid', type: 'number', req: true },
    ...(isNew ? [{ k: 'chargeReg', label: `Charge one-time registration fee`, type: 'checkbox' }, { k: 'regFee', label: 'Registration fee', type: 'number' }, { k: 'mode', label: 'Payment mode', type: 'select', options: PAY_MODES }] : []),
    { k: 'joinDate', label: 'Start date', type: 'date', req: true }, { k: 'expiryDate', label: 'Expiry date', type: 'date', hint: 'Leave blank to calculate from the plan' },
    { k: 'frozen', label: 'Membership frozen (paused)', type: 'checkbox', full: true }, { k: 'notes', label: 'Notes', type: 'textarea', full: true, hint: 'Medical conditions, injuries, preferences' },
  ];
}
const memberRow = v => ({ name: v.name, phone: v.phone || null, email: v.email || null, height_cm: numOrNull(v.heightCm), weight_kg: numOrNull(v.weightKg), goal: v.goal || null, source: v.source || null, referred_by: v.referredBy || null, offer: v.offer || null, plan: v.plan, fee: Number(v.fee || 0), join_date: v.joinDate, expiry_date: v.expiryDate, trainer_id: v.trainerId || null, frozen: !!v.frozen, notes: v.notes || null });
function memberForm(id, prefill = null, enquiryId = null) {
  const isNew = !id; const m = id ? S.members[id] : (prefill || { plan: 'Monthly', joinDate: today() });
  const v0 = { ...m, chargeReg: isNew ? true : false, regFee: S.settings.registrationFee, mode: 'UPI', broughtBy: isNew ? me.id : (m.broughtBy || me.id) };
  openModal(isNew ? 'Register new member' : `Edit ${m.name} · ${m.code}`, (isNew ? `<div class="meta">A Membership ID (e.g. ${esc(S.settings.memberPrefix)}-0001) is assigned automatically.</div>` : isOwner() ? '' : '<div class="banner">Changes to <b>personal details</b> (name, phone, email, height, goal, source, referral, start date, notes) are sent to the owner for approval. Weight, trainer and membership changes save straight away.</div>') + fieldsHtml(memberFields(isNew, isNew ? null : m.broughtBy), v0), {
    submitLabel: isNew ? 'Register member' : 'Save changes',
    submit: async v => {
      if (!v.expiryDate) v.expiryDate = addDays(addMonths(v.joinDate, PLANS[v.plan] || 1), -1);
      if (isNew) {
        let newId = null, code = '';
        const ok = await mutate(async () => {
          const row = { ...memberRow(v) }; if (isOwner() && v.broughtBy && v.broughtBy !== me.id) row.brought_by = v.broughtBy;
          const r = await q(supabase.from('members').insert(row).select('id,member_code').single()); newId = r.id; code = r.member_code;
          const pays = [{ member_id: r.id, paid_on: v.joinDate, amount: Number(v.fee || 0), type: 'new', plan: v.plan, offer: v.offer || null, mode: v.mode }];
          if (v.chargeReg && Number(v.regFee) > 0) pays.unshift({ member_id: r.id, paid_on: v.joinDate, amount: Number(v.regFee), type: 'registration', mode: v.mode });
          await q(supabase.from('payments').insert(pays));
          if (enquiryId) await q(supabase.from('enquiries').update({ status: 'Joined' }).eq('id', enquiryId));
        });
        if (ok && newId) { toast(`Registered · Membership ID ${code}`); location.hash = 'member-' + newId; }
        return;
      }
      const row = memberRow(v); if (isOwner()) row.brought_by = v.broughtBy || m.broughtBy || me.id;
      const current = { name: m.name, phone: m.phone, email: m.email, height_cm: m.heightCm, goal: m.goal, source: m.source, referred_by: m.referredBy, join_date: m.joinDate, notes: m.notes, brought_by: m.broughtBy };
      const norm = x => (x === undefined || x === null || x === '') ? null : String(x);
      if (isOwner()) { await mutate(() => q(supabase.from('members').update(row).eq('id', id)), 'Member updated'); if (view === 'member') loadHistory(id).then(render); return; }
      const changed = {}; for (const col of Object.values(PERSONAL)) if (col !== 'brought_by' && norm(row[col]) !== norm(current[col])) changed[col] = row[col];
      const direct = {}; for (const col of Object.values(DIRECT)) direct[col] = row[col];
      await mutate(async () => {
        await q(supabase.from('members').update(direct).eq('id', id));
        if (Object.keys(changed).length) await q(supabase.from('change_requests').insert({ kind: 'edit_member', member_id: id, payload: changed }));
      }, Object.keys(changed).length ? 'Saved. Personal detail changes were sent to the owner for approval.' : 'Member updated');
      if (view === 'member') loadHistory(id).then(render);
    },
  });
  updateBmi();
}
function updateBmi() { const el = document.getElementById('bmiCalc'); if (!el) return; const b = bmi({ heightCm: document.getElementById('f_heightCm')?.value, weightKg: document.getElementById('f_weightKg')?.value }); el.innerHTML = b ? `BMI <b>${b.v}</b> · <span class="chip ${b.cls}">${b.label}</span>` : 'Enter height and weight to see BMI.'; }
function renewForm(id) {
  const m = S.members[id]; if (!m) return; const start = m.expiryDate && diffDays(m.expiryDate, today()) >= 0 ? addDays(m.expiryDate, 1) : today();
  const offs = offersFor(id);
  openModal(`Renew ${m.name}`, `<div class="meta">Current expiry: ${esc(fmtDate(m.expiryDate))}</div>` + fieldsHtml([
    { k: 'plan', label: 'Plan', type: 'select', options: Object.keys(PLANS) }, { k: 'amount', label: 'Amount received', type: 'number', req: true },
    { k: 'start', label: 'New period starts', type: 'date', req: true }, { k: 'paidOn', label: 'Payment date', type: 'date', req: true }, { k: 'mode', label: 'Payment mode', type: 'select', options: PAY_MODES },
    ...(offs.length ? [{ k: 'memberOffer', label: 'Apply personal offer', type: 'select', options: offs.map(o => [o.id, o.title]), blank: 'No offer', full: true }] : []),
    { k: 'offer', label: 'Other offer applied', full: true, ph: 'e.g. Renewal discount 10%' }], { plan: m.plan, amount: m.fee, start, paidOn: today(), mode: 'UPI', memberOffer: offs[0] ? offs[0].id : '' }), {
    submitLabel: 'Record renewal',
    submit: v => {
      const exp = addDays(addMonths(v.start, PLANS[v.plan] || 1), -1); const mo = offs.find(o => o.id === v.memberOffer);
      return mutate(async () => {
        await q(supabase.from('members').update({ plan: v.plan, fee: Number(v.amount || 0), expiry_date: exp, frozen: false }).eq('id', id));
        await q(supabase.from('payments').insert({ member_id: id, paid_on: v.paidOn, amount: Number(v.amount || 0), type: 'renewal', plan: v.plan, mode: v.mode, offer: [mo ? mo.title : '', v.offer].filter(Boolean).join(' + ') || null, member_offer_id: mo ? mo.id : null }));
        if (mo) await q(supabase.from('member_offers').update({ status: 'used' }).eq('id', mo.id));
      }, `Renewed until ${fmtDate(exp)}`).then(ok => { if (ok && view === 'member') loadHistory(id).then(render); });
    },
  });
}
function memberOfferForm(id) {
  const m = S.members[id]; if (!m) return;
  openModal(`Personal renewal offer · ${m.name}`, `<div class="meta">Renewal date: <b>${esc(fmtDate(m.expiryDate))}</b>. The offer shows in their Member portal and in the WhatsApp reminder.</div>` + fieldsHtml([
    { k: 'title', label: 'Offer', req: true, full: true, ph: 'e.g. 10% off if you renew this week' }, { k: 'details', label: 'Details', type: 'textarea', full: true, ph: 'e.g. Valid on Quarterly or Annual plans. Includes 1 free PT session.' },
    { k: 'validUntil', label: 'Valid till', type: 'date' }], { validUntil: addDays(m.expiryDate, 7) }), {
    submitLabel: 'Add offer',
    submit: v => mutate(() => q(supabase.from('member_offers').insert({ member_id: id, title: v.title, details: v.details || null, valid_until: v.validUntil || null })), 'Offer added'),
  });
}
const STAFF_FIELDS = () => [{ k: 'name', label: 'Full name', req: true, full: true }, { k: 'title', label: 'Job title', type: 'select', options: JOB_TITLES }, { k: 'phone', label: 'Phone', type: 'tel' }, { k: 'email', label: 'Email', type: 'email' }, { k: 'joinDate', label: 'Joining date', type: 'date' },
  { k: 'salary', label: 'Monthly salary', type: 'number', req: true }, { k: 'shift', label: 'Shift', ph: 'e.g. 6 AM – 2 PM' }, { k: 'weeklyOff', label: 'Weekly off', type: 'select', options: WEEKDAYS.slice(1).concat('Sunday'), blank: 'No fixed weekly off', hint: 'Not counted as an absence' },
  { k: 'active', label: 'Currently employed', type: 'checkbox', full: true }, { k: 'notes', label: 'Notes', type: 'textarea', full: true }];
async function saveStaff(id, v) {
  const row = { name: v.name, role: v.title, phone: v.phone || null, email: v.email || null, join_date: v.joinDate || null, shift: v.shift || null, weekly_off: v.weeklyOff || null, active: !!v.active, notes: v.notes || null };
  let sid = id;
  if (id) await q(supabase.from('staff').update(row).eq('id', id)); else sid = (await q(supabase.from('staff').insert(row).select('id').single())).id;
  await q(supabase.from('staff_pay').upsert({ staff_id: sid, monthly_salary: Number(v.salary || 0), updated_at: new Date().toISOString() }));
  return sid;
}
function staffForm(id) {
  const s = id ? { ...S.staff[id], salary: S.pay[id] } : { title: 'Trainer', joinDate: today(), active: true };
  openModal(id ? `Edit ${s.name} · ${s.code}` : 'Add employee', (id ? '' : `<div class="meta">An Employee ID (e.g. ${esc(S.settings.employeePrefix)}001) is assigned automatically.</div>`) + fieldsHtml(STAFF_FIELDS(), s), {
    submit: v => mutate(() => saveStaff(id, v), id ? 'Employee updated' : 'Employee added'),
  });
}
const EQ_FIELDS = [{ k: 'name', label: 'Equipment name', req: true, full: true }, { k: 'category', label: 'Category', type: 'select', options: EQ_CATS }, { k: 'brand', label: 'Brand / model' }, { k: 'purchaseDate', label: 'Purchase date', type: 'date' }, { k: 'vendor', label: 'Service vendor' }, { k: 'lastService', label: 'Last service date', type: 'date' }, { k: 'intervalDays', label: 'Service every (days)', type: 'number', def: 90 }, { k: 'status', label: 'Condition', type: 'select', options: EQ_STATES }, { k: 'notes', label: 'Notes', type: 'textarea', full: true }];
const eqRow = v => ({ name: v.name, category: v.category, brand: v.brand || null, purchase_date: v.purchaseDate || null, vendor: v.vendor || null, last_service: v.lastService || null, interval_days: Number(v.intervalDays || 90), status: v.status, notes: v.notes || null });
function eqForm(id) { const e = id ? S.equipment[id] : { category: 'Cardio', intervalDays: 90, status: 'Working' }; openModal(id ? 'Edit equipment' : 'Add equipment', fieldsHtml(EQ_FIELDS, e), { submit: v => mutate(() => id ? q(supabase.from('equipment').update(eqRow(v)).eq('id', id)) : q(supabase.from('equipment').insert(eqRow(v))), id ? 'Equipment updated' : 'Equipment added') }); }
function serviceForm(id) {
  const e = S.equipment[id]; if (!e) return;
  openModal(`Log service · ${e.name}`, fieldsHtml([{ k: 'date', label: 'Service date', type: 'date', req: true }, { k: 'cost', label: 'Cost', type: 'number' }, { k: 'tech', label: 'Technician / vendor', def: e.vendor || '' }, { k: 'status', label: 'Condition after service', type: 'select', options: EQ_STATES }, { k: 'work', label: 'Work done', type: 'textarea', full: true, req: true }, ...(isOwner() ? [{ k: 'asExpense', label: 'Also record the cost as an expense', type: 'checkbox', full: true }] : [])], { date: today(), status: 'Working', asExpense: true }), {
    submitLabel: 'Save service record',
    submit: v => mutate(async () => {
      await q(supabase.from('service_logs').insert({ equipment_id: id, serviced_on: v.date, cost: Number(v.cost || 0), technician: v.tech || null, work: v.work }));
      const upd = { status: v.status }; if (!e.lastService || v.date >= e.lastService) upd.last_service = v.date; await q(supabase.from('equipment').update(upd).eq('id', id));
      if (isOwner() && v.asExpense && Number(v.cost) > 0) await q(supabase.from('expenses').insert({ spent_on: v.date, category: 'Equipment maintenance', description: `${e.name}: ${v.work}`, vendor: v.tech || null, amount: Number(v.cost) }));
    }, 'Service recorded'),
  });
}
function eqHistory(id) { const e = S.equipment[id]; if (!e) return; const logs = e.logs.slice().sort((a, b) => b.date.localeCompare(a.date)); openModal(`${e.name} · service history`, logs.length ? `<div class="tbl-wrap"><table><thead><tr><th>Date</th><th>Work done</th><th>By</th><th class="num">Cost</th></tr></thead><tbody>${logs.map(l => `<tr><td>${esc(fmtDate(l.date))}</td><td>${esc(l.work)}</td><td>${esc(l.tech || '—')}</td><td class="num">${esc(money(l.cost))}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">No services logged yet.</div>'); }
function offerForm(id) {
  const o = id ? S.offers.find(x => x.id === id) : { audience: 'both', active: true, kind: 'seasonal', price_rows: [], sort: (S.offers.length + 1) };
  openModal(id ? 'Edit offer' : 'Add offer', fieldsHtml([{ k: 'title', label: 'Offer title', req: true, full: true }, { k: 'kind', label: 'Type', type: 'select', options: Object.entries(OFFER_KINDS) }, { k: 'tag', label: 'Badge (short)', ph: 'e.g. 35% OFF' },
    { k: 'highlight', label: 'Highlight chip', ph: 'e.g. First 150 registrations' }, { k: 'sort', label: 'Order on the website', type: 'number' },
    { k: 'startsOn', label: 'Starts on', type: 'date', hint: 'Shown as “Starts …” until then' }, { k: 'validUntil', label: 'Valid till', type: 'date' },
    { k: 'rows', label: 'Prices (one per line)', type: 'textarea', full: true, hint: 'Write: Plan | old price | offer price   e.g.  12 months + Cult app | 18000 | 11700' },
    { k: 'details', label: 'Details', type: 'textarea', full: true }, { k: 'audience', label: 'Show to', type: 'select', options: Object.entries(AUD), full: true }, { k: 'active', label: 'Live', type: 'checkbox', full: true }],
    { title: o.title, tag: o.tag, details: o.details, audience: o.audience, validUntil: o.valid_until, active: o.active, kind: o.kind || 'seasonal', highlight: o.highlight, sort: o.sort ?? 0, startsOn: o.starts_on, rows: (o.price_rows || []).map(r => `${r.label} | ${r.was || ''} | ${r.now}`).join('\n') }), {
    submit: v => {
      const price_rows = String(v.rows || '').split('\n').map(l => l.split('|').map(x => x.trim())).filter(p => p[0] && p.length >= 2).map(p => p.length >= 3 ? { label: p[0], was: Number(p[1].replace(/[^\d.]/g, '')) || null, now: Number(p[2].replace(/[^\d.]/g, '')) || 0 } : { label: p[0], was: null, now: Number(p[1].replace(/[^\d.]/g, '')) || 0 });
      const row = { title: v.title, tag: v.tag || null, details: v.details || null, audience: v.audience || 'both', valid_until: v.validUntil || null, active: !!v.active, kind: v.kind || 'seasonal', highlight: v.highlight || null, sort: Number(v.sort) || 0, starts_on: v.startsOn || null, price_rows };
      if (row.starts_on && row.valid_until && row.valid_until < row.starts_on) return toast('“Valid till” must be after the start date.');
      return mutate(() => id ? q(supabase.from('offers').update(row).eq('id', id)) : q(supabase.from('offers').insert(row)), id ? 'Offer updated' : 'Offer added'); },
  });
}
function expenseForm(id) {
  const e = id ? S.expenses.find(x => x.id === id) : { spent_on: today(), category: EXPENSE_CATS[0], mode: 'UPI' };
  openModal(id ? 'Edit expense' : 'Add expense', fieldsHtml([{ k: 'spent_on', label: 'Date', type: 'date', req: true }, { k: 'category', label: 'Category', type: 'select', options: EXPENSE_CATS }, { k: 'amount', label: 'Amount', type: 'number', req: true }, { k: 'mode', label: 'Paid by', type: 'select', options: PAY_MODES }, { k: 'description', label: 'Description', full: true, ph: 'e.g. KSEB bill Oct–Nov, consumer no. 1234' }, { k: 'vendor', label: 'Paid to', full: true, ph: 'e.g. KSEB, landlord, cleaning agency' }], e), {
    submit: v => { const row = { spent_on: v.spent_on, category: v.category, amount: Number(v.amount || 0), mode: v.mode, description: v.description || null, vendor: v.vendor || null }; return mutate(() => id ? q(supabase.from('expenses').update(row).eq('id', id)) : q(supabase.from('expenses').insert(row)), id ? 'Expense updated' : 'Expense added'); },
  });
}
function staffTargetForm(staffId) {
  const st = S.staff[staffId]; const m = ui.tMonth || ui.staffMonth || curMonth(); const t = targetFor(staffId, m); const ach = st.profileId ? personalAchieved(st.profileId, m) : null;
  openModal(`Targets & incentive · ${st.name} · ${fmtMonth(m)}`, (ach ? `<div class="meta">So far: ${ach.newMembers} new members, ${ach.renewals} renewals, ${money(ach.revenue)} collected.</div>` : '<div class="meta">No login linked, so achievements can’t be counted yet.</div>')
    + fieldsHtml([{ k: 'newMembers', label: 'New members', type: 'number' }, { k: 'renewals', label: 'Renewals', type: 'number' }, { k: 'revenue', label: 'Revenue to collect', type: 'number' }, { k: 'incentive', label: 'Incentive if all targets are met', type: 'number', hint: 'Added to that month’s salary automatically' }, { k: 'note', label: 'Note for the employee', full: true }], { newMembers: t.new_members, renewals: t.renewals, revenue: t.revenue, incentive: t.incentive_amount, note: t.note }), {
    submit: v => mutate(() => q(supabase.from('staff_targets').upsert({ staff_id: staffId, month: m, new_members: numOrNull(v.newMembers), renewals: numOrNull(v.renewals), revenue: numOrNull(v.revenue), incentive_amount: numOrNull(v.incentive), note: v.note || null }, { onConflict: 'staff_id,month' })), 'Targets saved'),
  });
}
function staffAttModal(staffId) {
  const st = S.staff[staffId]; const m = ui.staffMonth || curMonth(); const p = payrollFor(staffId, m); const att = S.staffAtt.filter(a => a.staff_id === staffId && mKey(a.work_date) === m).sort((a, b) => b.work_date.localeCompare(a.work_date));
  openModal(`${st.name} · attendance ${fmtMonth(m)}`, `<div class="meta">${p.present} present · ${p.absent} absent · ${p.paidLeave} paid leave · ${p.lop} loss of pay</div>${attCalendar(p)}
    ${att.length ? `<div class="tbl-wrap"><table><thead><tr><th>Date</th><th>Status</th><th>In</th><th>Out</th><th></th></tr></thead><tbody>${att.map(a => `<tr><td>${esc(parse(a.work_date).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }))}</td><td>${esc(a.status)}</td><td>${esc(t5(a.clock_in))}</td><td>${esc(t5(a.clock_out))}</td><td><button type="button" class="btn sm" data-act="attEdit" data-sid="${staffId}" data-date="${a.work_date}">Edit</button></td></tr>`).join('')}</tbody></table></div>` : ''}
    <div><button type="button" class="btn sm primary" data-act="attEdit" data-sid="${staffId}" data-date="">Add or correct a day</button></div>`);
}
function staffAttForm(staffId, date) {
  const st = S.staff[staffId]; const a = date ? S.staffAtt.find(x => x.staff_id === staffId && x.work_date === date) : null;
  openModal(`${st.name} · attendance`, fieldsHtml([{ k: 'date', label: 'Date', type: 'date', req: true }, { k: 'status', label: 'Status', type: 'select', options: [['present', 'Present'], ['half', 'Half day'], ['leave', 'On leave (counts as a day off)']] }, { k: 'in', label: 'Clock in', type: 'time' }, { k: 'out', label: 'Clock out', type: 'time' }, { k: 'note', label: 'Note', full: true }], { date: date || today(), status: a ? a.status : 'present', in: a ? t5(a.clock_in) : '', out: a ? t5(a.clock_out) : '', note: a ? a.note : '' }), {
    submit: v => mutate(() => q(supabase.from('staff_attendance').upsert({ staff_id: staffId, work_date: v.date, status: v.status, clock_in: v.in || null, clock_out: v.out || null, note: v.note || null }, { onConflict: 'staff_id,work_date' })), 'Attendance saved'),
  });
}
function payForm(staffId) {
  const m = ui.payMonth || curMonth(); const p = payrollFor(staffId, m); const st = S.staff[staffId];
  openModal(`Pay ${st.name} · ${fmtMonth(m)}`, `<div class="payline"><span>Salary${p.base !== p.salary ? ' (pro-rated)' : ''}</span><b>${esc(money(p.base))}</b></div>
    <div class="payline"><span>Working days ${p.eligible} · present ${p.present} · absent ${p.absent}</span><span></span></div>
    <div class="payline"><span>Paid leave used ${p.paidLeave} of ${p.allowance} · loss of pay ${p.lop}d</span><b>${p.lop ? '− ' + esc(money(p.lopAmt)) : '—'}</b></div>
    <div class="payline"><span>Incentive ${p.potential ? (p.met ? '(all targets met)' : '(targets not met)') : ''}</span><b>${p.incentive ? '+ ' + esc(money(p.incentive)) : '—'}</b></div>
    <div class="payline total"><span>Calculated net pay</span><b>${esc(money(p.net))}</b></div>
    ${p.remaining > 0 ? `<div class="banner">${p.remaining} working day${p.remaining > 1 ? 's are' : ' is'} still to come this month. Paying now uses attendance so far.</div>` : ''}`
    + fieldsHtml([{ k: 'adjustment', label: 'Adjustment (+ bonus / − deduction)', type: 'number', allowNeg: true, def: 0 }, { k: 'adjNote', label: 'Reason for adjustment' }, { k: 'paidOn', label: 'Paid on', type: 'date', req: true }, { k: 'mode', label: 'Mode', type: 'select', options: PAY_MODES }], { adjustment: 0, paidOn: today(), mode: 'Bank transfer' }), {
    submitLabel: 'Approve & mark paid',
    submit: v => { const adj = Number(v.adjustment || 0); return mutate(() => q(supabase.from('payroll').upsert({ staff_id: staffId, month: m, base_salary: p.base, working_days: p.eligible, present_days: p.present, absent_days: p.absent, paid_leave_used: p.paidLeave, lop_days: p.lop, lop_amount: p.lopAmt, incentive: p.incentive, adjustment: adj, adjustment_note: v.adjNote || null, net_pay: Math.max(0, p.net + adj), paid_on: v.paidOn, mode: v.mode }, { onConflict: 'staff_id,month' })), 'Salary approved and marked paid'); },
  });
}
function targetsForm() { const m = ui.tMonth || curMonth(); const t = S.targets[m] || {}; openModal(`Gym targets · ${fmtMonth(m)}`, fieldsHtml([{ k: 'revenue', label: 'Revenue target', type: 'number' }, { k: 'newMembers', label: 'New members', type: 'number' }, { k: 'renewals', label: 'Renewals', type: 'number' }, { k: 'checkins', label: 'Total check-ins', type: 'number' }], t), { submit: v => mutate(() => q(supabase.from('targets').upsert({ month: m, revenue: numOrNull(v.revenue), new_members: numOrNull(v.newMembers), renewals: numOrNull(v.renewals), checkins: numOrNull(v.checkins) })), 'Targets saved') }); }
function settingsForm() {
  openModal('Gym settings', fieldsHtml([{ k: 'gymName', label: 'Gym name', full: true }, { k: 'currency', label: 'Currency symbol' }, { k: 'registrationFee', label: 'One-time registration fee', type: 'number' },
    { k: 'memberPrefix', label: 'Membership ID prefix', hint: 'e.g. JFS → JFS-0001' }, { k: 'employeePrefix', label: 'Employee ID prefix', hint: 'e.g. JFS-E → JFS-E001' },
    { k: 'paidLeaves', label: 'Paid leave days per employee per month', type: 'number', step: '0.5', hint: 'Unused days don’t carry forward' }, { k: 'offerWindow', label: 'Personal renewal offers allowed from (days before renewal)', type: 'number' },
    { k: 'reminder', label: 'Renewal reminder message', type: 'textarea', full: true, hint: 'Placeholders: {name} {plan} {gym} {date} {when}' }], S.settings) + (isOwner() ? '' : '<div class="meta">Only the owner can change gym settings.</div>'), {
    submit: isOwner() ? v => mutate(() => q(supabase.from('settings').update({ gym_name: v.gymName || BRAND, currency: v.currency || '₹', registration_fee: Number(v.registrationFee || 0), member_prefix: (v.memberPrefix || 'JFS').toUpperCase().replace(/[^A-Z0-9]/g, '') || 'JFS', employee_prefix: (v.employeePrefix || 'JFS-E').toUpperCase().replace(/[^A-Z0-9-]/g, '') || 'JFS-E', paid_leaves_per_month: Number(v.paidLeaves || 0), renewal_offer_window_days: Math.max(1, Number(v.offerWindow || 30)), reminder: v.reminder || DEFAULT_SETTINGS.reminder }).eq('id', 1)), 'Settings saved') : null,
  });
}
function confirmDelete(col, id) {
  const o = S[col][id]; if (!o) return;
  openModal('Delete record?', `<p>This permanently removes <b>${esc(o.name)}</b>${col === 'members' ? ' with their payments, visits and history' : col === 'staff' ? ' with their attendance, targets and payslips' : ' and its service history'}. It can’t be undone.</p>`, { danger: true, submitLabel: 'Delete', submit: () => mutate(() => q(supabase.from(col).delete().eq('id', id)), 'Deleted').then(ok => { if (ok && view === 'member') location.hash = 'members'; }) });
}
const periodDate = (p, custom) => p === 'none' ? null : p === 'custom' ? (custom || null) : addMonths(today(), Number(p));
const PERIODS = [['3', '3 months'], ['6', '6 months'], ['12', '1 year'], ['none', 'No end date'], ['custom', 'Custom date']];
async function sendInviteEmail(inv) {
  const portal = inv.role === 'member' ? 'member' : 'staff';
  const { error } = await supabase.auth.signInWithOtp({ email: inv.email, options: { shouldCreateUser: true, emailRedirectTo: portal === 'member' ? `${WEBSITE_URL}/member` : `${location.origin}/`, data: { full_name: inv.full_name || '', portal, invited_role: inv.role, access_until: inv.access_until || 'no end date' } } });
  return error;
}
function inviteStaffForm() {
  const free = list('staff').filter(s => !s.profileId).sort((a, b) => a.code.localeCompare(b.code));
  openModal('Invite team member', '<div class="meta">They get an email with a sign-in link. Their role and access period apply as soon as they sign in. When the period ends, they must ask you for an extension.</div>' + fieldsHtml([
    { k: 'name', label: 'Full name', req: true }, { k: 'email', label: 'Email', type: 'email', req: true },
    { k: 'role', label: 'Role (decides their dashboard)', type: 'select', options: STAFF_ROLES.map(r => [r, ROLE_LABEL[r]]) },
    { k: 'staffId', label: 'Employee record', type: 'select', options: [['new', 'Create a new employee record'], ...free.map(s => [s.id, `${s.code} · ${s.name}`])] },
    { k: 'salary', label: 'Monthly salary (for a new record)', type: 'number' }, { k: 'weeklyOff', label: 'Weekly off (for a new record)', type: 'select', options: WEEKDAYS.slice(1).concat('Sunday'), blank: 'No fixed weekly off' },
    { k: 'period', label: 'Access period', type: 'select', options: PERIODS }, { k: 'custom', label: 'Custom end date', type: 'date', hint: 'Only used with “Custom date”' }], { role: 'trainer', staffId: 'new', period: '12' }), {
    submitLabel: 'Send invitation',
    submit: async v => {
      if (!v.email || !v.name) return toast('Name and email are required.');
      const access = periodDate(v.period, v.custom); let emailErr = null;
      const ok = await mutate(async () => {
        let sid = v.staffId === 'new' ? null : v.staffId;
        if (!sid) sid = await saveStaff(null, { name: v.name, title: ROLE_LABEL[v.role], email: v.email, joinDate: today(), salary: v.salary || 0, weeklyOff: v.weeklyOff, active: true });
        const inv = { email: v.email.toLowerCase(), full_name: v.name, role: v.role, staff_id: sid, access_until: access };
        await q(supabase.from('invitations').insert(inv));
        emailErr = await sendInviteEmail(inv);
      });
      if (ok) toast(emailErr ? `Invitation saved, but the email couldn’t be sent (${friendly(emailErr)}). They can sign up with ${v.email} and it applies automatically.` : `Invitation emailed to ${v.email}`);
    },
  });
}
function inviteMemberForm() {
  const linked = new Set(S.profiles.filter(p => p.member_id).map(p => p.member_id)); const pend = new Set(S.invitations.filter(i => i.status === 'pending' && i.member_id).map(i => i.member_id));
  const opts = members().filter(m => m.email && !linked.has(m.id) && !pend.has(m.id)).map(m => [m.id, `${m.code} · ${m.name} · ${m.email}`]);
  if (!opts.length) { openModal('Invite member', '<div class="empty">Every member with an email already has a login or an invitation. Add an email to a member first (Members → Edit).</div>'); return; }
  openModal('Invite member to the Member portal', '<div class="meta">They get an email with a sign-in link to their membership card, visits, payments and offers.</div>' + fieldsHtml([{ k: 'memberId', label: 'Member', type: 'select', options: opts, full: true }, { k: 'period', label: 'Portal access period', type: 'select', options: PERIODS }, { k: 'custom', label: 'Custom end date', type: 'date' }], { period: 'none' }), {
    submitLabel: 'Send invitation',
    submit: async v => {
      const m = S.members[v.memberId]; if (!m) return; const access = periodDate(v.period, v.custom); let emailErr = null;
      const ok = await mutate(async () => { const inv = { email: m.email.toLowerCase(), full_name: m.name, role: 'member', member_id: m.id, access_until: access }; await q(supabase.from('invitations').insert(inv)); emailErr = await sendInviteEmail(inv); });
      if (ok) toast(emailErr ? `Invitation saved, but the email couldn’t be sent (${friendly(emailErr)}).` : `Invitation emailed to ${m.email}`);
    },
  });
}
function requestExportForm() {
  openModal('Request member export', '<div class="meta">Downloading member details needs the owner’s approval. Once approved, you can download it once within 48 hours.</div>' + fieldsHtml([{ k: 'reason', label: 'Why do you need it?', type: 'textarea', full: true, req: true }]), {
    submitLabel: 'Send request', submit: v => mutate(() => q(supabase.from('change_requests').insert({ kind: 'export_members', reason: v.reason })), 'Request sent to the owner'),
  });
}
function membersCsv() {
  const rows = [['Membership ID', 'Name', 'Phone', 'Email', 'Height (cm)', 'Weight (kg)', 'BMI', 'Goal', 'Trainer', 'Source', 'Referred by', 'Brought in by', 'Plan', 'Fee', 'Start date', 'Expiry date', 'Status', 'Notes']];
  for (const m of members().sort((a, b) => a.code.localeCompare(b.code))) rows.push([m.code, m.name, m.phone, m.email, m.heightCm, m.weightKg, bmi(m)?.v ?? '', m.goal, staffName(m.trainerId), m.source, m.referredBy, personName(m.broughtBy), m.plan, m.fee, m.joinDate, m.expiryDate, memberState(m).label, m.notes]);
  download(`members-${today()}.csv`, toCsv(rows));
}

/* ======================================================================
   Actions
   ====================================================================== */
const ACT = {
  addMember: () => memberForm(), editMember: d => memberForm(d.id), renew: d => renewForm(d.id), addMemberOffer: d => memberOfferForm(d.id),
  withdrawOffer: d => mutate(() => q(supabase.from('member_offers').update({ status: 'withdrawn' }).eq('id', d.id)), 'Offer withdrawn'),
  addStaff: () => staffForm(), editStaff: d => staffForm(d.id), pay: d => payForm(d.id),
  unpay: d => openModal('Undo payment?', '<p>This removes the payslip so you can recalculate and pay again.</p>', { danger: true, submitLabel: 'Undo', submit: () => mutate(() => q(supabase.from('payroll').delete().eq('id', d.id)), 'Payslip removed') }),
  addEquipment: () => eqForm(), editEquipment: d => eqForm(d.id), logService: d => serviceForm(d.id), eqHistory: d => eqHistory(d.id),
  setTargets: () => targetsForm(), settings: () => settingsForm(), delete: d => confirmDelete(d.col, d.id),
  addExpense: () => expenseForm(), editExpense: d => expenseForm(d.id),
  delExpense: d => openModal('Delete expense?', '<p>This removes the expense permanently.</p>', { danger: true, submitLabel: 'Delete', submit: () => mutate(() => q(supabase.from('expenses').delete().eq('id', d.id)), 'Expense deleted') }),
  checkin: d => { const m = S.members[d.id]; const date = ui.attDate || today(); return mutate(() => q(supabase.from('attendance').insert({ member_id: d.id, visit_date: date, visit_time: date === today() ? nowTime() : '12:00' })), `${m ? m.name : 'Member'} checked in`); },
  checkinToday: d => { const m = S.members[d.id]; return mutate(() => q(supabase.from('attendance').insert({ member_id: d.id, visit_date: today(), visit_time: nowTime() })), `${m ? m.name : 'Member'} checked in`); },
  uncheck: d => mutate(() => q(supabase.from('attendance').delete().eq('id', d.id))),
  checkinPick: () => { ui.attDate = today(); location.hash = 'attendance'; setTimeout(() => { const s = $('#attSearch'); if (s) s.focus(); }, 50); },
  memberFilter: d => { ui.memberFilter = d.v; render(); }, renewSeg: d => { ui.renewSeg = d.v; render(); }, eqFilter: d => { ui.eqFilter = d.v; render(); }, enqFilter: d => { ui.enqFilter = d.v; render(); }, clientSeg: d => { ui.clientSeg = d.v; render(); },
  copyReminder: async d => { const txt = reminderText(S.members[d.id]); try { await navigator.clipboard.writeText(txt); toast('Reminder copied'); } catch (e) { openModal('Reminder message', `<textarea class="field-inline" style="width:100%;min-height:110px" id="remTxt" readonly>${esc(txt)}</textarea>`); $('#remTxt').select(); } },
  exportMembers: () => { if (isOwner()) membersCsv(); },
  requestExport: () => requestExportForm(),
  downloadApproved: async d => { const { data, error } = await supabase.rpc('use_export_approval', { p_id: d.id }); if (error || !data || !data.ok) { toast('This approval has expired or was already used. Request a new export.'); return; } membersCsv(); toast('Downloaded. This approval is now used.'); scheduleReload(); },
  decide: d => mutate(async () => { const { data, error } = await supabase.rpc('decide_change_request', { p_id: d.id, p_approve: d.v === '1', p_note: null }); if (error) throw error; if (!data.ok) throw new Error('This request was already decided.'); }, d.v === '1' ? 'Approved' : 'Rejected'),
  extendAccess: d => { const p = S.profiles.find(x => x.id === d.id); const base = p && p.access_until && p.access_until > today() ? p.access_until : today(); return mutate(() => q(supabase.from('profiles').update({ access_until: addMonths(base, Number(d.v)), extension_requested_at: null, extension_note: null }).eq('id', d.id)), 'Access extended'); },
  dismissExtension: d => mutate(() => q(supabase.from('profiles').update({ extension_requested_at: null, extension_note: null }).eq('id', d.id)), 'Request declined'),
  clearAccess: d => mutate(() => q(supabase.from('profiles').update({ access_until: null, extension_requested_at: null }).eq('id', d.id)), 'Access has no end date now'),
  inviteStaff: () => inviteStaffForm(), inviteMember: () => inviteMemberForm(),
  resendInvite: async d => { const inv = S.invitations.find(i => i.id === d.id); if (!inv) return; const err = await sendInviteEmail(inv); toast(err ? friendly(err) : `Invitation re-sent to ${inv.email}`); },
  cancelInvite: d => mutate(() => q(supabase.from('invitations').update({ status: 'cancelled' }).eq('id', d.id)), 'Invitation cancelled'),
  unlinkMember: d => openModal('Remove member access?', '<p>They will no longer see their membership in the Member portal. Their membership record isn’t changed.</p>', { danger: true, submitLabel: 'Remove access', submit: () => mutate(() => q(supabase.from('profiles').update({ role: 'pending', member_id: null }).eq('id', d.id)), 'Access removed') }),
  viewEmp: d => { ui.as = d.id; location.hash = 'overview'; render(); },
  enqRegister: d => { const e = S.enquiries.find(x => x.id === d.id); if (e) memberForm(null, { name: e.name, phone: e.phone, email: e.email || '', source: 'Website', notes: [e.interest, e.message].filter(Boolean).join(' · '), plan: 'Monthly', joinDate: today() }, e.id); },
  enqDelete: d => openModal('Delete enquiry?', '<p>This removes the enquiry permanently.</p>', { danger: true, submitLabel: 'Delete', submit: () => mutate(() => q(supabase.from('enquiries').delete().eq('id', d.id)), 'Enquiry deleted') }),
  addOffer: () => offerForm(), editOffer: d => offerForm(d.id),
  delOffer: d => openModal('Delete offer?', '<p>It disappears from the website and Member portal straight away.</p>', { danger: true, submitLabel: 'Delete', submit: () => mutate(() => q(supabase.from('offers').delete().eq('id', d.id)), 'Offer deleted') }),
  clockIn: d => mutate(() => q(supabase.from('staff_attendance').upsert({ staff_id: d.id, work_date: today(), clock_in: nowTime(), status: 'present' }, { onConflict: 'staff_id,work_date' })), `Clocked in at ${nowTime()}`),
  clockOut: d => mutate(() => q(supabase.from('staff_attendance').update({ clock_out: nowTime() }).eq('id', d.id)), `Clocked out at ${nowTime()}`),
  staffAtt: d => staffAttModal(d.id), staffTarget: d => staffTargetForm(d.id), attEdit: d => staffAttForm(d.sid, d.date),
  exportPayroll: () => { const m = ui.payMonth || curMonth(); const rows = [['Employee ID', 'Name', 'Title', 'Month', 'Salary', 'Working days', 'Present', 'Absent', 'Paid leave', 'LOP days', 'LOP amount', 'Incentive', 'Adjustment', 'Net pay', 'Paid on', 'Mode']]; for (const s of list('staff')) { const p = payrollFor(s.id, m); const sv = p.saved; rows.push([s.code, s.name, s.title, m, p.salary, p.eligible, p.present, p.absent, p.paidLeave, p.lop, p.lopAmt, p.incentive, sv ? sv.adjustment : '', sv ? sv.net_pay : p.net, sv ? sv.paid_on : '', sv ? sv.mode : '']); } download(`payroll-${m}.csv`, toCsv(rows)); },
  exportFinance: () => { const m = ui.finMonth || curMonth(); const rows = [['Date', 'Type', 'Category', 'Description', 'Amount']]; for (const p of payments(m)) rows.push([p.date, 'Income', p.type === 'registration' ? 'Registration fee' : p.type === 'new' ? 'New membership' : 'Renewal', `${p.member} · ${p.plan || ''}`, p.amount]); for (const e of S.expenses.filter(x => mKey(x.spent_on) === m)) rows.push([e.spent_on, 'Expense', e.category, e.description || '', -Number(e.amount)]); for (const p of S.payroll.filter(x => x.month === m)) rows.push([p.paid_on, 'Expense', 'Salaries (payroll)', staffName(p.staff_id), -Number(p.net_pay)]); download(`income-expenses-${m}.csv`, toCsv(rows)); },
  setPassword: () => openModal('Set your password', fieldsHtml([{ k: 'pw', label: 'New password', type: 'password', req: true, hint: 'At least 8 characters' }]), { submit: async v => { if ((v.pw || '').length < 8) return toast('Use at least 8 characters.'); const { error } = await supabase.auth.updateUser({ password: v.pw, data: { password_set: true } }); if (error) return toast(friendly(error)); const { data } = await supabase.auth.getSession(); session = data.session || session; toast('Password saved'); render(); } }),
  signOut: async () => { closeModal(); await supabase.auth.signOut(); location.hash = ''; me = null; sessionUser = null; session = null; render(); },
  recheck: async () => { me = null; sessionUser = null; await onSession(session); },
  enqSource: d => { ui.enqSource = d.v; render(); },
  enqChat: d => { const e = S.enquiries.find(x => x.id === d.id); if (e) openModal(`Chat with ${e.name}`, `<div class="meta">${esc(new Date(e.created_at).toLocaleString())} · ${esc(e.phone)}</div><div class="transcript">${esc(e.transcript || '')}</div>`); },
  backupDownload: () => backupDownload(), restoreRun: () => restoreRun(), restoreCancel: () => { ui.restore = null; render(); },
  mixNew: () => mixForm(), mixEdit: d => mixForm(d.id),
  mixPreview: d => { ui.mixPreview = ui.mixPreview === d.id ? null : d.id; render(); },
  mixMode: d => setThemeCfg(d.v === 'pinned' ? { mode: 'pinned', pinned: (S.themeCfg && S.themeCfg.pinned) || playlist(allMixes(), S.themeCfg || {})[0].id } : { mode: d.v }),
  mixMove: d => { const all = allMixes(); const i = all.findIndex(m => m.id === d.id); const j = i + Number(d.v); if (i < 0 || j < 0 || j >= all.length) return; const [x, y] = [all[i], all[j]];
    return mutate(async () => { await q(supabase.from('site_themes').update({ sort: j + 1 }).eq('id', x.id)); await q(supabase.from('site_themes').update({ sort: i + 1 }).eq('id', y.id)); }, 'Order updated'); },
  mixDelete: d => { const m = allMixes().find(x => x.id === d.id); if (m) openModal('Delete mix?', `<p><b>${esc(m.name)}</b> will stop playing on the website and be removed.</p>`, { danger: true, submitLabel: 'Delete', submit: () => mutate(() => q(supabase.from('site_themes').delete().eq('id', d.id)), 'Mix deleted') }); },
  dashMode: d => setThemeCfg(d.v === 'fixed' ? { dashboard_mode: 'fixed', dashboard_theme: (S.themeCfg && S.themeCfg.dashboardTheme) || playlist(allMixes(), S.themeCfg || {})[0].id } : { dashboard_mode: d.v }, 'Dashboard theme updated'),
  reelMove: d => { const rc = { ...reelCfg(), videos: reelCfg().videos.slice() }; const i = rc.videos.findIndex(v => v.id === d.id); const j = i + Number(d.v); if (i < 0 || j < 0 || j >= rc.videos.length) return; [rc.videos[i], rc.videos[j]] = [rc.videos[j], rc.videos[i]]; return saveContent('logo_reel', rc, 'Order updated'); },
  reelPreview: d => openModal(LOGO_VIDEOS[d.id] || 'Logo animation', `<video class="reel-preview" src="/media/${esc(d.id)}.mp4" poster="/media/${esc(d.id)}.jpg" autoplay muted playsinline controls></video>`),
  cEdit: d => contentForm(d.k),
  cReset: d => openModal('Reset to the fee guide?', `<p>This replaces the current <b>${esc(d.k)}</b> on the website with the values from the JARIN fee guide.</p>`, { submitLabel: 'Reset', submit: () => saveContent(d.k, DEFAULT_CONTENT[d.k], 'Reset to the fee guide') }),
  planEdit: d => planForm(d.i == null ? null : Number(d.i)),
  planMove: d => { const l = S.content.plans.slice(); const i = Number(d.i), j = i + Number(d.v); if (j < 0 || j >= l.length) return; [l[i], l[j]] = [l[j], l[i]]; return saveContent('plans', l, 'Order updated'); },
  planDelete: d => { const l = S.content.plans.slice(); const p = l[Number(d.i)]; if (!p) return; if (l.length <= 1) return toast('Keep at least one plan.'); openModal('Delete plan?', `<p><b>${esc(p.name)}</b> will be removed from the website. Existing members on this plan aren’t affected.</p>`, { danger: true, submitLabel: 'Delete', submit: () => { l.splice(Number(d.i), 1); return saveContent('plans', l, 'Plan deleted'); } }); },
  svcEdit: d => svcForm(d.i == null ? null : Number(d.i)),
  svcDelete: d => { const l = S.content.services.slice(); const g = l[Number(d.i)]; if (g) openModal('Delete group?', `<p><b>${esc(g.title)}</b> will be removed from the website.</p>`, { danger: true, submitLabel: 'Delete', submit: () => { l.splice(Number(d.i), 1); return saveContent('services', l, 'Group deleted'); } }); },
  closeModal: () => closeModal(),
};

document.addEventListener('click', e => {
  const auth = e.target.closest('[data-auth]'); if (auth) { e.preventDefault(); renderLogin(auth.dataset.auth); return; }
  const el = e.target.closest('[data-act]'); if (!el) return;
  if (el.dataset.act === 'overlay') { if (e.target === el) closeModal(); return; }
  const fn = ACT[el.dataset.act]; if (fn) { e.preventDefault(); fn(el.dataset); }
});
document.addEventListener('change', e => {
  if (e.target.id === 'restoreFile' && e.target.files[0]) { restoreRead(e.target.files[0]); return; }
  const el = e.target; const a = el.dataset && el.dataset.actChange;
  if (a === 'viewAs') { ui.as = el.value; render(); return; }
  if (a === 'mixEnabled') { const on = el.checked; if (!on && allMixes().filter(m => m.enabled).length <= 1) { el.checked = true; toast('Keep at least one mix playing.'); return; } mutate(() => q(supabase.from('site_themes').update({ enabled: on }).eq('id', el.dataset.id)), on ? 'Mix is playing on the website' : 'Mix taken off the website'); return; }
  if (a === 'myTheme') { try { if (el.value) localStorage.setItem(dashKey(), el.value); else localStorage.removeItem(dashKey()); } catch (e) { /* ignore */ } applyDashTheme(); toast('Your dashboard theme is saved on this device'); return; }
  if (a === 'dashTheme') { setThemeCfg({ dashboard_theme: el.value }, 'Dashboard theme updated'); return; }
  if (a === 'reelOn' || a === 'reelDash') { saveContent('logo_reel', { ...reelCfg(), [a === 'reelOn' ? 'enabled' : 'dashboard']: el.checked }, 'Logo animations updated'); return; }
  if (a === 'reelVid') { const rc = reelCfg(); if (!el.checked && rc.videos.filter(v => v.enabled !== false).length <= 1) { el.checked = true; toast('Keep at least one animation on, or switch the reel off above.'); return; } saveContent('logo_reel', { ...rc, videos: rc.videos.map(v => v.id === el.dataset.id ? { ...v, enabled: el.checked } : v) }, el.checked ? 'Animation added to the reel' : 'Animation removed from the reel'); return; }
  if (a === 'mixInterval') { setThemeCfg({ interval_sec: Number(el.value) }); return; }
  if (a === 'mixPinned') { setThemeCfg({ pinned: el.value }, 'Pinned mix updated'); return; }
  if (a === 'mixVisitor') { setThemeCfg({ visitor_controls: el.checked }); return; }
  if (a === 'enqStatus') { mutate(() => q(supabase.from('enquiries').update({ status: el.value }).eq('id', el.dataset.id)), 'Status updated'); return; }
  if (a === 'setRole') { mutate(() => q(supabase.from('profiles').update({ role: el.value, portal: 'staff' }).eq('id', el.dataset.id)), 'Role updated'); return; }
  if (a === 'setAccess') { mutate(() => q(supabase.from('profiles').update({ access_until: el.value || null, extension_requested_at: null }).eq('id', el.dataset.id)), el.value ? `Access until ${fmtDate(el.value)}` : 'Access has no end date'); return; }
  if (a === 'linkStaff') { const pid = el.dataset.id, sid = el.value; mutate(async () => { const prev = list('staff').find(s => s.profileId === pid); if (prev && prev.id !== sid) await q(supabase.from('staff').update({ profile_id: null }).eq('id', prev.id)); if (sid) await q(supabase.from('staff').update({ profile_id: pid }).eq('id', sid)); }, sid ? 'Login linked to employee record' : 'Link removed'); return; }
  const k = el.dataset && el.dataset.bind; if (!k || el.type === 'search') return; ui[k] = el.value || null; render();
});
document.addEventListener('input', e => {
  if (e.target.id === 'f_heightCm' || e.target.id === 'f_weightKg') updateBmi();
  if ($('#mixPrev') && e.target.closest('#modalForm')) updateMixPreview();
  const k = e.target.dataset && e.target.dataset.bind; if (!k || e.target.type !== 'search') return; ui[k] = e.target.value; render();
});
document.addEventListener('keydown', e => { if (e.key === 'Escape' && $('#modalRoot').innerHTML) closeModal(); });
document.addEventListener('dragover', e => { const z = e.target.closest && e.target.closest('#dropZone'); if (z) { e.preventDefault(); z.classList.add('over'); } });
document.addEventListener('dragleave', e => { const z = e.target.closest && e.target.closest('#dropZone'); if (z) z.classList.remove('over'); });
document.addEventListener('drop', e => { const z = e.target.closest && e.target.closest('#dropZone'); if (z) { e.preventDefault(); z.classList.remove('over'); const f = e.dataTransfer.files[0]; if (f) restoreRead(f); } });
document.addEventListener('submit', async e => {
  const form = e.target;
  if (form.id === 'modalForm') { e.preventDefault(); const fn = modalSubmit; const v = formValues(form); closeModal(); if (fn) await fn(v); return; }
  if (form.id === 'authForm') {
    e.preventDefault(); const v = formValues(form); const msg = $('#authMsg'); const btn = form.querySelector('[type=submit]'); btn.disabled = true; msg.innerHTML = '';
    try {
      if (form.dataset.mode === 'signup') { const { data, error } = await supabase.auth.signUp({ email: v.email, password: v.password, options: { data: { full_name: v.name, portal: 'staff' }, emailRedirectTo: location.origin + '/' } }); if (error) throw error; if (!data.session) { renderLogin('signin', `<div class="ok">Account created. Open the confirmation link sent to ${esc(v.email)}, then sign in.</div>`); return; } }
      else if (form.dataset.mode === 'forgot') { const { error } = await supabase.auth.resetPasswordForEmail(v.email, { redirectTo: location.origin + '/' }); if (error) throw error; msg.innerHTML = `<div class="ok">If ${esc(v.email)} has an account, a reset link is on its way.</div>`; }
      else { const { error } = await supabase.auth.signInWithPassword({ email: v.email, password: v.password }); if (error) throw error; }
    } catch (err) { msg.innerHTML = `<div class="err">${esc(/Invalid login/i.test(err.message) ? 'That email and password don’t match. If you were invited, use the link in your invitation email, or reset your password.' : friendly(err))}</div>`; }
    finally { btn.disabled = false; }
    return;
  }
  if (form.id === 'extForm') { e.preventDefault(); const v = formValues(form); const { error } = await supabase.rpc('request_access_extension', { p_note: v.note || null }); if (error) { $('#authMsg').innerHTML = `<div class="err">${esc(friendly(error))}</div>`; return; } await loadMe(); render(); return; }
  if (form.id === 'pwForm') { e.preventDefault(); const v = formValues(form); const { error } = await supabase.auth.updateUser({ password: v.password, data: { password_set: true } }); if (error) { $('#authMsg').innerHTML = `<div class="err">${esc(friendly(error))}</div>`; return; } recovery = false; toast('Password updated'); me = null; sessionUser = null; await onSession(session); }
});
let toastT;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, 3800); }

/* ======================================================================
   Boot
   ====================================================================== */
if (!configured) render();
else {
  authCard('<div class="empty">Loading…</div>');
  supabase.auth.onAuthStateChange((event, s) => {
    if (event === 'PASSWORD_RECOVERY') { session = s; recovery = true; render(); return; }
    if (event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') { session = s; return; }
    setTimeout(() => onSession(s), 0);
  });
}
