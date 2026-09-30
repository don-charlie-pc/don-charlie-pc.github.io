import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startCalendarOAuth, calendarOAuthCallback } from '../supabase/functions/_shared/oauth.ts';
import { calendarFor } from '../supabase/functions/_shared/calendar.ts';
import { sha256, encrypt } from '../supabase/functions/_shared/crypto.ts';
const values = { GOOGLE_TOKEN_ENCRYPTION_KEY_BASE64: btoa('1'.repeat(32)), GOOGLE_TOKEN_KEY_VERSION: '1', GOOGLE_CALENDAR_CLIENT_ID: 'mock-client', GOOGLE_CALENDAR_CLIENT_SECRET: 'mock-secret', GOOGLE_OAUTH_REDIRECT_URI: 'https://backend.example.invalid/functions/v1/google-calendar-oauth-callback', ADMIN_EMAILS: 'admin@example.invalid', ADMIN_APP_URL: 'https://studio.example.invalid/admin/', ADMIN_APP_ORIGIN: 'https://studio.example.invalid' };
globalThis.Deno = { env: { get: key => values[key] } };
const admin = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', email: 'admin@example.invalid' };
async function fixture() {
  let saved, connection, consumed = false, existing;
  const db = {
    insert: async (_, data) => { saved = data; },
    select: async table => table === 'admin_users' ? [admin] : existing ? [existing] : [],
    rpc: async (name, args) => {
      if (name === 'booking_consume_oauth') {
        assert.equal(args.p_hash, saved.state_hash); if (consumed) throw new Error('INVALID_OAUTH_STATE'); consumed = true; return saved;
      }
      if (name === 'booking_save_connection') connection = args.p_data;
    },
  };
  const result = await startCalendarOAuth(admin, db); const url = new URL(result.url);
  return { db, url, get saved() { return saved; }, get connection() { return connection; }, setExisting: value => { existing = value; } };
}
test('Calendar OAuth uses offline access, PKCE and hashed state; callback encrypts tokens and returns no token to browser', async () => {
  const f = await fixture(); assert.equal(f.url.searchParams.get('access_type'), 'offline'); assert.equal(f.url.searchParams.get('code_challenge_method'), 'S256');
  assert.ok(f.url.searchParams.get('scope').includes('calendar.events')); assert.equal(f.saved.state_hash, await sha256(f.url.searchParams.get('state')));
  assert.notEqual(f.saved.encrypted_code_verifier, f.saved.code_verifier_hash);
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    if (url === 'https://oauth2.googleapis.com/token') {
      assert.equal(await sha256(options.body.get('code_verifier')), f.saved.code_verifier_hash); assert.equal(options.body.get('redirect_uri'), values.GOOGLE_OAUTH_REDIRECT_URI);
      return Response.json({ access_token: 'mock-access', refresh_token: 'mock-refresh-secret', scope: 'openid email https://www.googleapis.com/auth/calendar.events' });
    }
    return Response.json({ sub: 'google-sub', email: 'calendar@example.invalid', email_verified: true });
  };
  try {
    const request = new Request(`${values.GOOGLE_OAUTH_REDIRECT_URI}?code=mock-code&state=${f.url.searchParams.get('state')}`);
    const response = await calendarOAuthCallback(request, f.db); assert.equal(response.status, 303); assert.equal(response.headers.get('Location'), 'https://studio.example.invalid/admin/?calendar=connected');
    assert.ok(f.connection.encrypted_refresh_token); assert.notEqual(f.connection.encrypted_refresh_token, 'mock-refresh-secret'); assert.equal(f.connection.google_email, 'calendar@example.invalid');
    assert.equal(await response.text(), ''); await assert.rejects(calendarOAuthCallback(request, f.db), /INVALID_OAUTH_STATE/);
  } finally { globalThis.fetch = original; }
});
test('reconnection without refresh token preserves valid token of same account', async () => {
  const f = await fixture(); const old = await encrypt('retained-token', `calendar:${admin.id}`);
  f.setExisting({ google_subject: 'google-sub', encrypted_refresh_token: old.ciphertext, token_iv: old.iv, token_key_version: old.version, disconnected_at: null });
  const original = globalThis.fetch;
  globalThis.fetch = async url => Response.json(url.includes('/token') ? { access_token: 'new-access', scope: 'openid email https://www.googleapis.com/auth/calendar.events' } : { sub: 'google-sub', email: 'calendar@example.invalid', email_verified: true });
  try {
    await calendarOAuthCallback(new Request(`${values.GOOGLE_OAUTH_REDIRECT_URI}?code=code&state=${f.url.searchParams.get('state')}`), f.db);
    assert.equal(f.connection.encrypted_refresh_token, old.ciphertext);
  } finally { globalThis.fetch = original; }
});
test('invalid_grant records a safe reconnection error, never the token', async () => {
  const old = await encrypt('private-refresh', `calendar:${admin.id}`); let update;
  const db = { select: async () => [{ id: 'connection', admin_user_id: admin.id, encrypted_refresh_token: old.ciphertext, token_iv: old.iv, token_key_version: old.version }], update: async (_, __, value) => { update = value; } };
  const original = globalThis.fetch; globalThis.fetch = async () => Response.json({ error: 'invalid_grant' }, { status: 400 });
  try {
    await assert.rejects(calendarFor(db, { calendar_connection_id: 'connection', calendar_id_snapshot: 'primary' }), /CALENDAR_RECONNECT/);
    assert.deepEqual(update, { last_error: 'CALENDAR_RECONNECT' });
  } finally { globalThis.fetch = original; }
});
