// owner-recovery — lets a Manager restore the Owner's login with the Owner's recovery PIN.
// The PIN is checked in the database (hashed, 5 wrong tries lock it for 30 minutes) using the
// Manager's own login; only then does this function use the service key to change the Owner's
// login. Every attempt is written to recovery_log, which only the Owner can read.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ ok: false, reason: 'method' }, 405);
  const url = Deno.env.get('SUPABASE_URL')!;
  const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const auth = req.headers.get('Authorization') || '';
  let body: { pin?: string; action?: string; new_email?: string; new_password?: string; redirect_to?: string };
  try { body = await req.json(); } catch { return json({ ok: false, reason: 'bad_request' }, 400); }

  const asManager = createClient(url, anon, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
  const admin = createClient(url, service, { auth: { persistSession: false } });

  const { data: check, error } = await asManager.rpc('use_recovery_pin', { p_pin: String(body.pin || '') });
  if (error) return json({ ok: false, reason: 'check_failed' }, 400);
  if (!check?.ok) return json(check);
  const { data: who } = await asManager.auth.getUser();
  const log = (action: string, ok: boolean, detail: string) => admin.from('recovery_log').insert({ manager_id: who?.user?.id ?? null, manager_name: check.manager_name, action, ok, detail });

  if (body.action === 'reset_link') {
    const { error: e } = await admin.auth.resetPasswordForEmail(check.owner_email, { redirectTo: body.redirect_to || undefined });
    await log('reset_link', !e, e ? e.message : `Password reset link sent to the owner's email`);
    return json(e ? { ok: false, reason: 'send_failed' } : { ok: true, sent_to: check.owner_email.replace(/^(.).*(@.*)$/, '$1•••$2') });
  }
  if (body.action === 'set_login') {
    const pw = String(body.new_password || '');
    const email = String(body.new_email || '').trim().toLowerCase();
    if (pw.length < 10) return json({ ok: false, reason: 'weak_password' });
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ ok: false, reason: 'bad_email' });
    const patch: Record<string, unknown> = { password: pw };
    if (email && email !== check.owner_email) { patch.email = email; patch.email_confirm = true; }
    const { error: e } = await admin.auth.admin.updateUserById(check.owner_id, patch);
    if (!e && patch.email) await admin.from('profiles').update({ email }).eq('id', check.owner_id);
    await log('set_login', !e, e ? e.message : (patch.email ? 'Owner email and password changed' : 'Owner password changed'));
    return json(e ? { ok: false, reason: e.message.includes('already') ? 'email_taken' : 'update_failed' } : { ok: true, email_changed: !!patch.email });
  }
  return json({ ok: true, verified: true });
});
