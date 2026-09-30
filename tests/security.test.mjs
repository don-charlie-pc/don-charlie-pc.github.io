import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { assertAdminIdentity, validateCustomer } from '../supabase/functions/_shared/core.ts';
import { guadalajaraToUtc, formatTime, localInput } from '../assets/js/booking-common.js';
import { encrypt, decrypt, sha256, challenge } from '../supabase/functions/_shared/crypto.ts';
import { handler } from '../supabase/functions/_shared/handler.ts';
const env = { GOOGLE_TOKEN_ENCRYPTION_KEY_BASE64: btoa('0'.repeat(32)), GOOGLE_TOKEN_KEY_VERSION: '1', ALLOWED_ORIGINS: 'http://localhost:8000', SUPABASE_URL: 'https://backend.example.invalid', SUPABASE_SERVICE_ROLE_KEY: 'mock', ADMIN_EMAILS: 'admin@example.invalid' };
globalThis.Deno = { env: { get: key => env[key] } };
const customer = { service_id: '11111111-1111-4111-8111-111111111111', customer_name: 'Persona', customer_email: 'TEST@example.invalid', customer_phone: '+52 (33) 1234-5678', municipality: 'Zapopan', location_type: 'por_definir', privacy_accepted: true, terms_accepted: true, legal_version: 'test' };
test('server normalizes customer inputs and rejects missing consent, invalid phones and oversized text', () => {
  const valid = validateCustomer(customer); assert.equal(valid.customer_phone, '+523312345678'); assert.equal(valid.customer_email, 'test@example.invalid');
  for (const changes of [{ privacy_accepted: false }, { customer_phone: 'abcdefgh' }, { customer_notes: 'x'.repeat(2001) }, { participant_count: 1.5 }]) assert.throws(() => validateCustomer({ ...customer, ...changes }));
});
test('Google login requires allowlisted auth id AND subject AND email', () => {
  const user = { id: 'test-user', email_confirmed_at: 'today', identities: [{ provider: 'google', identity_data: { sub: 'google-subject', email: 'admin@example.invalid', email_verified: true } }] };
  const row = { id: user.id, google_subject: 'google-subject', email: 'admin@example.invalid', is_allowed: true };
  assert.doesNotThrow(() => assertAdminIdentity(user, row, ['admin@example.invalid']));
  for (const change of [{ google_subject: 'forged' }, { is_allowed: false }, { email: 'other@example.invalid' }, { id: 'other-user' }]) assert.throws(() => assertAdminIdentity(user, { ...row, ...change }, ['admin@example.invalid']), /FORBIDDEN/);
  assert.throws(() => assertAdminIdentity(user, undefined, ['admin@example.invalid']), /FORBIDDEN/);
});
test('every privileged endpoint returns 403 for an authenticated, non-admin Google user without reading PII', async () => {
  const originalFetch = globalThis.fetch; const calls = [];
  globalThis.fetch = async url => {
    calls.push(url);
    if (url.endsWith('/auth/v1/user')) return Response.json({ id: customer.service_id, email_confirmed_at: 'today', identities: [{ provider: 'google', identity_data: { sub: 'unlisted', email: 'visitor@example.invalid' } }] });
    if (url.includes('/admin_users?')) return Response.json([]);
    throw new Error('Unauthorized private read');
  };
  try {
    for (const endpoint of ['admin-availability', 'admin-reservations', 'confirm-reservation', 'decline-or-cancel-reservation', 'retry-calendar-sync', 'calendar-connect-start']) {
      const response = await handler(endpoint)(new Request(`https://backend.example.invalid/${endpoint}`, { method: 'POST', headers: { Origin: 'http://localhost:8000', Authorization: 'Bearer mock', 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'list', id: customer.service_id }) }));
      assert.equal(response.status, 403); const data = await response.json(); assert.equal(data.error, 'FORBIDDEN'); assert.ok(data.trace); assert.equal(JSON.stringify(data).includes('visitor@'), false);
    }
    assert.ok(calls.every(url => url.includes('/auth/v1/user') || url.includes('/admin_users?')));
  } finally { globalThis.fetch = originalFetch; }
});
test('CORS rejects unknown origins and never returns wildcard', async () => {
  const response = await handler('admin-reservations')(new Request('https://backend.example.invalid', { method: 'OPTIONS', headers: { Origin: 'https://attacker.example.invalid' } }));
  assert.equal(response.status, 403); assert.equal(response.headers.get('Access-Control-Allow-Origin'), null);
});
test('AES-GCM uses random IVs and authenticates ciphertext and owner', async () => {
  const a = await encrypt('mock-refresh-token', 'calendar:owner'), b = await encrypt('mock-refresh-token', 'calendar:owner');
  assert.notEqual(a.iv, b.iv); assert.notEqual(a.ciphertext, b.ciphertext); assert.equal(await decrypt(a.ciphertext, a.iv, a.version, 'calendar:owner'), 'mock-refresh-token');
  await assert.rejects(decrypt(a.ciphertext, a.iv, a.version, 'calendar:another-owner'));
  assert.equal((await sha256('state')).length, 64); assert.match(await challenge('verifier'), /^[A-Za-z0-9_-]{43}$/);
});
test('Guadalajara formatting and input conversion are independent of browser timezone', () => {
  for (const zone of ['Asia/Tokyo', 'America/New_York', 'Pacific/Honolulu']) {
    process.env.TZ = zone; assert.equal(guadalajaraToUtc('2027-02-10T12:00'), '2027-02-10T18:00:00.000Z');
    assert.equal(localInput('2027-02-10T18:00:00Z'), '2027-02-10T12:00'); assert.match(formatTime('2027-02-10T18:00:00Z'), /12:00/);
  }
});
test('only confirmation flow contains Events.insert, frontend has no Calendar write calls', async () => {
  const source = await readFile(new URL('../supabase/functions/_shared/handler.ts', import.meta.url), 'utf8');
  assert.match(source, /case 'confirm-reservation':result=await confirmReservation/);
  for (const name of ['booking-public.js', 'admin-app.js', 'admin-auth.js']) {
    const file = await readFile(new URL(`../assets/js/${name}`, import.meta.url), 'utf8');
    assert.doesNotMatch(file, /www.googleapis.com\/calendar|innerHTML|provider_token|provider_refresh_token/);
  }
});
