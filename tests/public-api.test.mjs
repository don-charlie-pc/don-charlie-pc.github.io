import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handler } from '../supabase/functions/_shared/handler.ts';
const values = { ALLOWED_ORIGINS: 'http://localhost:8000', SUPABASE_URL: 'https://backend.example.invalid', SUPABASE_SERVICE_ROLE_KEY: 'server-key', RATE_LIMIT_SALT: 'test-salt', REQUIRE_TURNSTILE: 'false' };
globalThis.Deno = { env: { get: key => values[key] } };
const customer = { service_id: '11111111-1111-4111-8111-111111111111', slot_id: '22222222-2222-4222-8222-222222222222', customer_name: 'Prueba', customer_email: 'private@example.invalid', customer_phone: '+523312345678', municipality: 'Zapopan', location_type: 'estudio', privacy_accepted: true, terms_accepted: true, legal_version: 'test' };
const request = body => new Request('https://backend.example.invalid/functions/v1/create-reservation', { method: 'POST', headers: { Origin: 'http://localhost:8000', 'Content-Type': 'application/json', 'x-forwarded-for': '192.0.2.1' }, body: JSON.stringify(body) });
test('creating a pending request calls only rate limit and transactional booking RPCs, never Calendar', async () => {
  const original = globalThis.fetch; const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push(url);
    if (url.endsWith('/booking_rate_limit')) { const data = JSON.parse(options.body); assert.match(data.p_key, /^[0-9a-f]{64}$/); return Response.json(true); }
    if (url.endsWith('/booking_create')) return Response.json({ public_reference: '44444444-4444-4444-8444-444444444444', kind: 'reservation', hold_expires_at: '2027-02-09T18:00:00Z' });
    throw new Error('Unexpected external call');
  };
  try {
    const response = await handler('create-reservation')(request(customer)); assert.equal(response.status, 200); const data = await response.json();
    assert.deepEqual(Object.keys(data).sort(), ['hold_expires_at', 'kind', 'public_reference']); assert.equal(JSON.stringify(data).includes('private@'), false);
    assert.equal(calls.length, 3); assert.ok(calls.every(url => url.startsWith('https://backend.example.invalid/rest/v1/rpc/booking_')));
  } finally { globalThis.fetch = original; }
});
test('honeypot and persistent rate limit reject submission before reservation RPC', async () => {
  const original = globalThis.fetch; let allowed = true;
  globalThis.fetch = async url => { assert.match(url, /booking_rate_limit$/); return Response.json(allowed); };
  try {
    assert.equal((await handler('create-reservation')(request({ ...customer, website: 'spam' }))).status, 400);
    allowed = false; assert.equal((await handler('create-reservation')(request(customer))).status, 429);
  } finally { globalThis.fetch = original; }
});
test('Turnstile must match both hostname and booking action', async () => {
  values.TURNSTILE_SECRET_KEY = 'mock'; values.TURNSTILE_HOSTNAMES = 'studio.example.invalid';
  const original = globalThis.fetch; globalThis.fetch = async url => url.includes('siteverify') ? Response.json({ success: true, hostname: 'attacker.example.invalid', action: 'booking' }) : Response.json(true);
  try { assert.equal((await handler('create-reservation')(request({ ...customer, turnstile_token: 'test' }))).status, 400); }
  finally { delete values.TURNSTILE_SECRET_KEY; delete values.TURNSTILE_HOSTNAMES; globalThis.fetch = original; }
});
