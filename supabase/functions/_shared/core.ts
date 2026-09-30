export type Data = Record<string, any>;
export class AppError extends Error {
  constructor(public code: string, public status = 400) { super(code); }
}
export function env(key: string, fallback = ''): string { return Deno.env.get(key) || fallback; }
export function secret(key: string): string {
  const value = env(key); if (!value) throw new AppError('SERVER_CONFIGURATION', 503); return value;
}
export async function timedFetch(url: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  return await fetch(url, { ...init, signal: AbortSignal.timeout(15000) });
}
export class Database {
  async request(path: string, method = 'GET', body?: unknown): Promise<any> {
    const response = await timedFetch(`${secret('SUPABASE_URL')}/rest/v1/${path}`, {
      method, headers: { apikey: secret('SUPABASE_SERVICE_ROLE_KEY'), Authorization: `Bearer ${secret('SUPABASE_SERVICE_ROLE_KEY')}`,
        'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      const known = ['FORBIDDEN','SLOT_UNAVAILABLE','SLOT_OCCUPIED','SLOT_NOT_FUTURE','SYNC_BUSY','STALE_SYNC','INVALID_STATE','INVALID_ACTION','INVALID_SERVICE','INVALID_INPUT','CONSENT_REQUIRED','NOT_FOUND','BOOKING_CLOSED','INVALID_OAUTH_STATE','CALENDAR_DISCONNECTED','CALENDAR_ACCOUNT_IN_USE'];
      if (known.includes(error.message)) throw new AppError(error.message, error.message === 'FORBIDDEN' ? 403 : 409);
      if (['23505','23P01'].includes(error.code)) throw new AppError('SLOT_CONFLICT',409);
      if (['23514','23502','22P02','22007','22008'].includes(error.code)) throw new AppError('INVALID_INPUT',400);
      throw new AppError('DATABASE_ERROR',503);
    }
    return response.status === 204 ? null : await response.json();
  }
  rpc(name: string, args: Data = {}): Promise<any> { return this.request(`rpc/${name}`, 'POST', args); }
  select(table: string, query: string): Promise<Data[]> { return this.request(`${table}?${query}`); }
  insert(table: string, data: Data): Promise<Data[]> { return this.request(table,'POST',data); }
  update(table: string, query: string, data: Data): Promise<Data[]> { return this.request(`${table}?${query}`,'PATCH',data); }
}
export function assertAdminIdentity(user: Data, row: Data | undefined, emails: string[]): void {
  const google = user.identities?.find((identity: Data) => identity.provider === 'google');
  const subject = google?.identity_data?.sub;
  const email = String(google?.identity_data?.email || '').toLowerCase();
  if (!user.email_confirmed_at || !google || google.identity_data?.email_verified === false || !subject ||
      !row?.is_allowed || row.id !== user.id || row.google_subject !== subject ||
      row.email.toLowerCase() !== email || !emails.includes(email)) throw new AppError('FORBIDDEN',403);
}
export async function requireAdmin(request: Request, db: Database): Promise<Data> {
  const authorization = request.headers.get('authorization') || '';
  if (!/^Bearer [^ ]+$/.test(authorization)) throw new AppError('UNAUTHORIZED',401);
  const response = await timedFetch(`${secret('SUPABASE_URL')}/auth/v1/user`, {
    headers: { apikey: secret('SUPABASE_SERVICE_ROLE_KEY'), Authorization: authorization },
  });
  if (!response.ok) throw new AppError('UNAUTHORIZED',401);
  const user = await response.json();
  if (!isUuid(user.id)) throw new AppError('UNAUTHORIZED',401);
  const rows = await db.select('admin_users',`id=eq.${user.id}&select=id,google_subject,email,is_allowed,display_name`);
  assertAdminIdentity(user,rows[0],secret('ADMIN_EMAILS').split(',').map(s=>s.trim().toLowerCase()));
  await db.update('admin_users',`id=eq.${user.id}`,{last_login_at:new Date().toISOString()});
  return rows[0];
}
export function isUuid(value: unknown): value is string { return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value); }
export function uuid(value: unknown): string { if (!isUuid(value)) throw new AppError('INVALID_INPUT'); return value; }
export function clean(value: unknown, max: number, min = 0): string {
  if (typeof value !== 'string') { if (min === 0 && (value === undefined || value === null)) return ''; throw new AppError('INVALID_INPUT'); }
  const text = value.normalize('NFC').trim().replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g,'');
  if (text.length < min || text.length > max) throw new AppError('INVALID_INPUT'); return text;
}
export function validateCustomer(input: Data): Data {
  if (input.privacy_accepted !== true || input.terms_accepted !== true) throw new AppError('CONSENT_REQUIRED');
  const email = clean(input.customer_email,254,3).toLowerCase();
  const phone = clean(input.customer_phone,30,8).replace(/[\s()-]/g,'');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !/^\+?\d{8,15}$/.test(phone)) throw new AppError('INVALID_INPUT');
  if (!['estudio','exterior','domicilio','por_definir'].includes(input.location_type)) throw new AppError('INVALID_INPUT');
  const count = input.participant_count == null || input.participant_count === '' ? null : Number(input.participant_count);
  if (count !== null && (!Number.isInteger(count) || count < 1 || count > 10000)) throw new AppError('INVALID_INPUT');
  const preferredDate = clean(input.preferred_date,10);
  if (preferredDate && (!/^\d{4}-\d{2}-\d{2}$/.test(preferredDate) || !Number.isFinite(Date.parse(preferredDate)))) throw new AppError('INVALID_INPUT');
  return { service_id: uuid(input.service_id), slot_id: input.slot_id ? uuid(input.slot_id) : null,
    customer_name: clean(input.customer_name,120,2),customer_email:email,customer_phone:phone,
    preferred_contact_method: input.preferred_contact_method === 'email' ? 'email' : 'whatsapp',
    municipality:clean(input.municipality,100,2),location_type:input.location_type,
    location_detail:clean(input.location_detail,300),participant_count:count,customer_notes:clean(input.customer_notes,2000),
    preferred_date:preferredDate || null, privacy_accepted:true,terms_accepted:true,legal_version:clean(input.legal_version,80,1) };
}
export async function jsonBody(request: Request): Promise<Data> {
  if (!request.headers.get('content-type')?.startsWith('application/json')) throw new AppError('INVALID_INPUT',415);
  // Bound streaming input, including chunked requests without Content-Length.
  const reader = request.body?.getReader(); if (!reader) throw new AppError('INVALID_INPUT');
  let size=0; const chunks: Uint8Array[]=[];
  while (true) { const {value,done}=await reader.read(); if(done) break; size+=value.byteLength;
    if(size>65536) { await reader.cancel(); throw new AppError('REQUEST_TOO_LARGE',413); } chunks.push(value); }
  const bytes = new Uint8Array(size); let offset=0; for(const c of chunks){bytes.set(c,offset);offset+=c.length;}
  try { const value=JSON.parse(new TextDecoder().decode(bytes)); if(!value || Array.isArray(value) || typeof value!=='object') throw new Error(); return value; }
  catch { throw new AppError('INVALID_INPUT'); }
}
