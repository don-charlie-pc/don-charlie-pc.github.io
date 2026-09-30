// Run only against a disposable local Supabase/Postgres DB after applying migrations.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
const database = process.env.TEST_DATABASE_URL;
if (!database || !['localhost', '127.0.0.1', '[::1]'].includes(new URL(database).hostname)) throw new Error('TEST_DATABASE_URL must point to a disposable localhost Postgres database.');
function sql(source) {
  return new Promise((resolve, reject) => {
    const child = spawn('psql', [database, '-X', '-qAt', '-v', 'ON_ERROR_STOP=1'], { stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '', error = ''; child.stdout.on('data', c => output += c); child.stderr.on('data', c => error += c); child.on('error', reject);
    child.on('close', code => code ? reject(new Error(error)) : resolve(output.trim())); child.stdin.end(source);
  });
}
test('independent Postgres connections contend for one slot; exactly one commits', async () => {
  const actor = randomUUID(), id = randomUUID();
  try {
    await sql(`insert into public.admin_users(id,google_subject,email,is_allowed) values('${actor}','${actor}','test@example.invalid',true);
      update public.booking_settings set accepting_requests=true,legal_version='concurrency-test';
      insert into public.availability_slots(id,starts_at_utc,ends_at_utc,status,allowed_service_ids,location_type,created_by_admin_id)
      values('${id}',now()+interval '35 days',now()+interval '35 days 1 hour','active',array(select id from public.service_types where slug='retrato-femenino'),'estudio','${actor}');`);
    const statement = `select public.booking_create(jsonb_build_object('slot_id','${id}','service_id',(select id from public.service_types where slug='retrato-femenino'),'customer_name','Concurrent test','customer_email','test@example.invalid','customer_phone','+523312345678','municipality','Zapopan','location_type','estudio','privacy_accepted',true,'terms_accepted',true,'legal_version','concurrency-test'));`;
    const result = await Promise.allSettled([sql(`begin; ${statement} select pg_sleep(1); commit;`), sql(`begin; ${statement} commit;`)]);
    assert.equal(result.filter(r => r.status === 'fulfilled').length, 1);
    assert.equal(await sql(`select count(*) from public.reservations where slot_id='${id}' and status='pending'`), '1');
  } finally {
    await sql(`delete from public.reservations where slot_id='${id}';delete from public.availability_slots where id='${id}';delete from public.admin_users where id='${actor}';update public.booking_settings set accepting_requests=false,legal_version='borrador-2026-09';`);
  }
});
