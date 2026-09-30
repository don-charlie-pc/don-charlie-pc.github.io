import { config } from './booking-config.js';
import { api, configured } from './booking-common.js';
const storageKey = 'cf-admin-session';
let session;
try { session = JSON.parse(sessionStorage.getItem(storageKey) || 'null'); } catch { session = null; }
function save(data) {
  // Store ONLY Supabase session tokens, never Google provider tokens returned by Auth.
  session = { access_token: data.access_token, refresh_token: data.refresh_token, expires_at: Math.floor(Date.now() / 1000) + data.expires_in };
  sessionStorage.setItem(storageKey, JSON.stringify(session));
}
async function authRequest(path, body, token) {
  const response = await fetch(`${config.PUBLIC_SUPABASE_URL}/auth/v1/${path}`, {
    method: 'POST', headers: { apikey: config.PUBLIC_SUPABASE_PUBLISHABLE_KEY, 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error('No se pudo iniciar o renovar la sesión. Vuelve a iniciar sesión con Google.');
  return response.status === 204 ? null : await response.json();
}
export async function login() {
  if (!configured) throw new Error('Configura Supabase y el proveedor Google antes de iniciar sesión.');
  if (config.PUBLIC_APP_ORIGIN && config.PUBLIC_APP_ORIGIN !== location.origin) throw new Error('Este origen no coincide con la configuración pública.');
  const verifier = Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, '0')).join('');
  sessionStorage.setItem('cf-auth-verifier', verifier);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  const challenge = btoa(String.fromCharCode(...digest)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const redirect = new URL('./', location.href); redirect.search = ''; redirect.hash = '';
  const url = new URL(`${config.PUBLIC_SUPABASE_URL}/auth/v1/authorize`);
  url.search = new URLSearchParams({ provider: 'google', redirect_to: redirect.href, scopes: 'openid email profile', code_challenge: challenge, code_challenge_method: 's256' }).toString();
  location.assign(url.href);
}
export async function restore() {
  const url = new URL(location.href); const code = url.searchParams.get('code');
  if (code) {
    const verifier = sessionStorage.getItem('cf-auth-verifier'); sessionStorage.removeItem('cf-auth-verifier');
    history.replaceState(null, '', location.pathname);
    if (!verifier) throw new Error('La sesión de acceso caducó. Inicia sesión de nuevo.');
    save(await authRequest('token?grant_type=pkce', { auth_code: code, code_verifier: verifier }));
  }
  if (url.searchParams.has('error') || location.hash.includes('error=')) { history.replaceState(null, '', location.pathname); throw new Error('El acceso con Google no se completó.'); }
  return Boolean(session);
}
export function clearSession() { session = null; sessionStorage.removeItem(storageKey); window.dispatchEvent(new Event('admin-signed-out')); }
export async function logout() {
  const token = session?.access_token; clearSession();
  if (token) await authRequest('logout?scope=local', null, token);
}
export async function adminApi(endpoint, data) {
  if (!session) throw new Error('Inicia sesión con Google.');
  if (session.expires_at <= Date.now() / 1000 + 60) {
    try { save(await authRequest('token?grant_type=refresh_token', { refresh_token: session.refresh_token })); }
    catch (error) { clearSession(); throw error; }
  }
  try { return await api(endpoint, data, session.access_token); }
  catch (error) { if (error.status === 401 || error.status === 403) clearSession(); throw error; }
}
