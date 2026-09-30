import { config } from './booking-config.js';
export const timezone = 'America/Mexico_City';
export const configured = Boolean(config.PUBLIC_SUPABASE_URL && config.PUBLIC_SUPABASE_PUBLISHABLE_KEY);
export function formatDate(value, options = {}) {
  return new Intl.DateTimeFormat('es-MX', { timeZone: timezone, weekday: 'long', day: 'numeric', month: 'long', ...options }).format(new Date(value));
}
export function formatTime(value) { return formatDate(value, { weekday: undefined, day: undefined, month: undefined, hour: '2-digit', minute: '2-digit', hour12: true }); }
export function localInput(value) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(value));
  const p = Object.fromEntries(parts.map(item => [item.type, item.value])); return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}
// Resolve wall time using IANA timezone data; never use the browser's local timezone.
export function guadalajaraToUtc(value) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) throw new Error('Introduce fecha y hora válidas.');
  const wall = Date.parse(`${value}:00Z`); let instant = wall;
  for (let i = 0; i < 3; i++) instant += wall - Date.parse(`${localInput(instant)}:00Z`);
  if (localInput(instant) !== value) throw new Error('La hora no existe en Guadalajara.'); return new Date(instant).toISOString();
}
export async function api(endpoint, body = {}, token) {
  if (!configured) throw new Error('La agenda en línea está en preparación. Puedes escribirnos por Instagram.');
  let response;
  try {
    response = await fetch(`${config.PUBLIC_SUPABASE_URL.replace(/\/$/, '')}/functions/v1/${endpoint}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', apikey: config.PUBLIC_SUPABASE_PUBLISHABLE_KEY, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body), signal: AbortSignal.timeout(65000), cache: 'no-store',
    });
  } catch { throw new Error('No se pudo comprobar el resultado. Revisa tu conexión. Si enviaste una solicitud, consulta con el estudio antes de repetirla.'); }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(`${data.message || 'No se pudo completar la operación.'}${data.trace ? ` Referencia de soporte: ${data.trace}` : ''}`);
    error.code = data.error; error.status = response.status; throw error;
  }
  return data;
}
export function node(tag, text, className) {
  const element = document.createElement(tag); if (text !== undefined) element.textContent = text; if (className) element.className = className; return element;
}
export function status(element, message, error = false) {
  element.textContent = message; element.classList.toggle('is-error', error); element.setAttribute('role', error ? 'alert' : 'status');
}
export const stateLabels = { pending: 'Pendiente de revisión', confirming: 'Confirmación en proceso', confirmed: 'Confirmada', declined: 'Rechazada', expired: 'Apartado vencido', cancellation_requested: 'Cancelación en proceso', cancelled_by_admin: 'Cancelada', completed: 'Realizada', no_show: 'No asistió', released: 'Liberada manualmente', not_created: 'Sin evento', creating: 'Creando evento', synced: 'Sincronizado', error: 'Error recuperable', cancellation_pending: 'Cancelación pendiente', cancelled: 'Evento cancelado', new: 'Nueva consulta', contacted: 'Contactada', closed: 'Cerrada', active: 'Activo', draft: 'Borrador', paused: 'Pausado' };
