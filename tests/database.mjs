import { PGlite } from '@electric-sql/pglite';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';
import { readFile } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
let db, service, quote;
const actor = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const rpc = async (name, args, casts) => (await db.query(`select public.${name}(${args.map((_, i) => `$${i + 1}::${casts[i]}`).join(',')}) as result`, args)).rows[0].result;
const slot = async (days = 3, hour = 12, state = 'active') => {
  const base = new Date(); base.setUTCDate(base.getUTCDate() + days); base.setUTCHours(hour, 0, 0, 0);
  const data = { starts_at_utc: base.toISOString(), ends_at_utc: new Date(base.getTime() + 3600000).toISOString(), status: state, location_type: 'estudio', allowed_service_ids: [service], internal_note: 'PRIVATE INTERNAL NOTE', public_note: 'Luz natural' };
  return (await rpc('booking_admin_slots', [actor, 'save', JSON.stringify([data])], ['uuid', 'text', 'jsonb'])).ids[0];
};
const customer = id => ({ service_id: service, slot_id: id, customer_name: 'Prueba SQL', customer_email: 'private@example.invalid', customer_phone: '+523312345678', municipality: 'Zapopan', location_type: 'estudio', privacy_accepted: true, terms_accepted: true, legal_version: 'test' });
before(async () => {
  db = new PGlite({ extensions: { btree_gist } });
  await db.exec('create role anon; create role authenticated; create role service_role bypassrls;');
  await db.exec(await readFile(new URL('../supabase/migrations/202609300001_booking.sql', import.meta.url), 'utf8'));
  await db.query("insert into public.admin_users(id,google_subject,email,is_allowed) values($1,'mock-subject','admin@example.invalid',true)", [actor]);
  await db.exec("update public.booking_settings set accepting_requests=true,legal_version='test'");
  service = (await db.query("select id from public.service_types where slug='retrato-femenino'")).rows[0].id;
  quote = (await db.query("select id from public.service_types where slug='boda'")).rows[0].id;
});
after(async () => { await db?.close(); });
test('RLS, table revocations and RPC execute revocations protect all private data', async () => {
  const rows = (await db.query("select relname,relrowsecurity from pg_class c join pg_namespace n on c.relnamespace=n.oid where n.nspname='public' and c.relkind='r'")).rows;
  assert.ok(rows.length >= 10); assert.ok(rows.every(row => row.relrowsecurity));
  for (const role of ['anon', 'authenticated']) {
    await db.exec(`set role ${role}`);
    await assert.rejects(db.query('select * from public.reservations'), /permission denied/);
    await assert.rejects(db.query("select public.booking_public_catalog(null)"), /permission denied/);
    await db.exec('reset role');
  }
});
test('public availability is safe, service-compatible and respects 24h/90d boundaries', async () => {
  const open = await slot(3), tooLate = await slot(100), draft = await slot(4, 12, 'draft');
  const soon = { starts_at_utc: new Date(Date.now()+7200000).toISOString(), ends_at_utc: new Date(Date.now()+10800000).toISOString(), status: 'active', allowed_service_ids: [service], location_type: 'estudio' };
  const tooSoon = (await rpc('booking_admin_slots', [actor, 'save', JSON.stringify([soon])], ['uuid','text','jsonb'])).ids[0];
  const result = await rpc('booking_public_catalog', [service], ['uuid']);
  assert.ok(result.slots.some(s => s.id === open)); assert.ok(!result.slots.some(s => [tooSoon, tooLate, draft].includes(s.id)));
  assert.equal(JSON.stringify(result).includes('PRIVATE INTERNAL NOTE'), false);
  assert.equal(JSON.stringify(result).includes('private@example'), false);
  await assert.rejects(rpc('booking_create', [JSON.stringify(customer(tooSoon))], ['jsonb']), /SLOT_UNAVAILABLE/);
});
test('two concurrent submissions have one pending reservation and no Calendar event', async () => {
  const id = await slot(5); const calls = await Promise.allSettled([rpc('booking_create', [JSON.stringify(customer(id))], ['jsonb']), rpc('booking_create', [JSON.stringify(customer(id))], ['jsonb'])]);
  assert.equal(calls.filter(c => c.status === 'fulfilled').length, 1);
  const rows = (await db.query('select * from public.reservations where slot_id=$1', [id])).rows;
  assert.equal(rows.length, 1); assert.equal(rows[0].status, 'pending'); assert.equal(rows[0].google_calendar_event_id, null);
  const publicResult = await rpc('booking_public_catalog', [service], ['uuid']); assert.ok(!publicResult.slots.some(s => s.id === id));
});
test('overlapping publication fails atomically; draft may overlap; occupied slots cannot be edited', async () => {
  const id = await slot(6); await assert.rejects(slot(6), /conflicting key|constraint/); await slot(6, 12, 'draft');
  await rpc('booking_create', [JSON.stringify(customer(id))], ['jsonb']);
  await assert.rejects(rpc('booking_admin_slots', [actor, 'pause', '[]', id], ['uuid', 'text', 'jsonb', 'uuid']), /SLOT_OCCUPIED/);
});
test('expired pending holds release future slots and do not expire ambiguous Calendar writes', async () => {
  const id = await slot(7); await rpc('booking_create', [JSON.stringify(customer(id))], ['jsonb']);
  await db.query("update public.reservations set hold_expires_at=now()-interval '1 minute' where slot_id=$1", [id]);
  const result = await rpc('booking_public_catalog', [service], ['uuid']); assert.ok(result.slots.some(s => s.id === id));
  await rpc('booking_create', [JSON.stringify(customer(id))], ['jsonb']);
  await db.query("update public.reservations set status='confirming',calendar_sync_status='error',hold_expires_at=now()-interval '1 minute' where slot_id=$1 and status='pending'", [id]);
  await rpc('booking_expire', [], []);
  assert.equal((await db.query("select status from public.reservations where slot_id=$1 and status='confirming'", [id])).rows.length, 1);
});
test('quote-only inquiry creates no reservation or slot hold', async () => {
  const result = await rpc('booking_create', [JSON.stringify({ ...customer(null), service_id: quote })], ['jsonb']);
  assert.equal(result.kind, 'inquiry'); assert.match(result.public_reference, /^[a-f0-9-]{36}$/);
  assert.equal((await db.query('select * from public.reservations where public_reference=$1', [result.public_reference])).rows.length, 0);
});
test('OAuth state is single-use, expiring and bound to an allowed administrator', async () => {
  await db.query("insert into public.oauth_states(state_hash,admin_user_id,code_verifier_hash,encrypted_code_verifier,verifier_iv,token_key_version,expires_at) values('hash',$1,'verifier','cipher','iv',1,now()+interval '5 minutes')", [actor]);
  const value = await rpc('booking_consume_oauth', ['hash'], ['text']); assert.equal(value.admin_user_id, actor);
  await assert.rejects(rpc('booking_consume_oauth', ['hash'], ['text']), /INVALID_OAUTH_STATE/);
});
test('database sync lease fences stale writers and marks confirmed only on completion', async () => {
  await db.query("insert into public.google_calendar_connections(admin_user_id,google_subject,google_email,encrypted_refresh_token,token_iv,token_key_version,granted_scopes) values($1,'mock-subject','admin@example.invalid','cipher','iv',1,'{}')", [actor]);
  const id = await slot(8); const created = await rpc('booking_create', [JSON.stringify(customer(id))], ['jsonb']);
  const reservation = (await db.query('select id from public.reservations where public_reference=$1', [created.public_reference])).rows[0].id;
  const job = await rpc('booking_begin_sync', [actor, reservation, 'confirm'], ['uuid', 'uuid', 'text']);
  assert.equal(job.reservation.status, 'confirming'); assert.match(job.reservation.google_calendar_event_id, /^cf[a-f0-9]{32}$/);
  await assert.rejects(rpc('booking_begin_sync', [actor, reservation, 'confirm'], ['uuid', 'uuid', 'text']), /SYNC_BUSY/);
  await assert.rejects(rpc('booking_finish_sync', [actor, reservation, actor, 'confirm', null], ['uuid', 'uuid', 'uuid', 'text', 'text']), /STALE_SYNC/);
  await rpc('booking_finish_sync', [actor, reservation, job.reservation.sync_token, 'confirm', 'CALENDAR_ERROR'], ['uuid', 'uuid', 'uuid', 'text', 'text']);
  assert.equal((await db.query('select status from public.reservations where id=$1', [reservation])).rows[0].status, 'confirming');
  const retry = await rpc('booking_begin_sync', [actor, reservation, 'confirm'], ['uuid', 'uuid', 'text']);
  await rpc('booking_finish_sync', [actor, reservation, retry.reservation.sync_token, 'confirm', null], ['uuid', 'uuid', 'uuid', 'text', 'text']);
  assert.equal((await db.query('select status from public.reservations where id=$1', [reservation])).rows[0].status, 'confirmed');
});
