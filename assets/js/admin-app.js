import { formatDate, formatTime, guadalajaraToUtc, localInput, node, stateLabels, status } from './booking-common.js';
import { adminApi, clearSession, login, logout, restore } from './admin-auth.js';
const $ = selector => document.querySelector(selector);
const message = $('#admin-status'); let services = [], page = 0, listVersion = 0;
const label = state => stateLabels[state] || state;
function badge(state) { const b = node('span', label(state), 'badge'); b.dataset.state = state; return b; }
function actionButton(text, action, danger = false) {
  const button = node('button', text, `secondary-button${danger ? ' danger-button' : ''}`); button.type = 'button';
  button.addEventListener('click', () => run(action, button)); return button;
}
async function run(action, button) {
  if (button) button.disabled = true;
  try { await action(); } catch (error) { status(message, error.message, true); }
  finally { if (button) button.disabled = false; }
}
function ask(text, needsNote = false) {
  const dialog = $('#confirm-dialog'); $('#dialog-message').textContent = text; $('#dialog-note-field').hidden = !needsNote;
  $('#dialog-note').value = ''; $('#dialog-note').required = needsNote; $('#dialog-note').minLength = needsNote ? 10 : 0;
  dialog.returnValue = 'cancel'; dialog.showModal();
  return new Promise(resolve => dialog.addEventListener('close', () => resolve(dialog.returnValue === 'confirm' ? { note: $('#dialog-note').value } : null), { once: true }));
}
function wipe() {
  $('#admin-panel').hidden = true; $('#login-panel').hidden = false; $('#logout').hidden = true;
  for (const id of ['#reservations', '#inquiries', '#availability', '#calendar-status', '#admin-identity', '#slot-services']) $(id).replaceChildren();
  $('#calendar-form').reset(); $('#slot-form').reset(); $('#slot-id').value = ''; services = []; ++listVersion;
}
window.addEventListener('admin-signed-out', wipe);
$('#login').addEventListener('click', () => run(login, $('#login')));
$('#logout').addEventListener('click', () => run(async () => { await logout(); status(message, 'Sesión cerrada.'); }, $('#logout')));
$('#connect-calendar').addEventListener('click', () => run(async () => {
  const result = await adminApi('calendar-connect-start', {}); location.assign(result.url);
}, $('#connect-calendar')));
$('#disconnect-calendar').addEventListener('click', () => run(async () => {
  if (!await ask('Se borrará la autorización local. Las reservas y eventos existentes se conservan; necesitarás reconectar la misma cuenta para cancelarlos. Puedes revocar además el acceso en tu cuenta de Google. ¿Desconectar?')) return;
  await adminApi('admin-reservations', { action: 'disconnect' }); await loadReservations(); status(message, 'Calendar desconectado.');
}, $('#disconnect-calendar')));
$('#calendar-form').addEventListener('submit', event => { event.preventDefault(); run(async () => {
  await adminApi('admin-reservations', { action: 'calendar_settings', ...Object.fromEntries(new FormData(event.target)) }); await loadReservations(); status(message, 'Calendario guardado para próximas confirmaciones.');
}, event.submitter); });
function detailsList(entries) {
  const dl = node('dl'); for (const [key, value] of entries) { dl.append(node('dt', key), node('dd', value == null || value === '' ? '—' : String(value))); } return dl;
}
async function reservationAction(r, endpoint, action, text, needsNote = false) {
  const result = await ask(text, needsNote); if (!result) return;
  status(message, 'Procesando… El horario permanece apartado durante la sincronización.');
  try { await adminApi(endpoint, { id: r.id, action, note: result.note }); status(message, 'Acción completada. Revisa el estado actualizado.'); }
  finally { await loadReservations(); }
}
function renderReservation(r) {
  const card = node('article', undefined, 'admin-card'); const slot = r.availability_slots;
  card.append(node('h3', `${r.service_types.name} · ${r.customer_name}`), badge(r.status), badge(r.calendar_sync_status), node('p', `${formatDate(slot.starts_at_utc)} · ${formatTime(slot.starts_at_utc)}–${formatTime(slot.ends_at_utc)} · Guadalajara`));
  card.append(detailsList([['Folio', r.public_reference], ['WhatsApp', r.customer_phone], ['Correo', r.customer_email], ['Contacto preferido', r.preferred_contact_method], ['Zona / locación', `${r.municipality} · ${r.location_type} · ${r.location_detail}`], ['Personas', r.participant_count], ['Notas del cliente', r.customer_notes], ['Apartado hasta', `${formatDate(r.hold_expires_at)} · ${formatTime(r.hold_expires_at)}`]]));
  if (r.calendar_sync_error) card.append(node('p', `Calendar: ${r.calendar_sync_error}. Si la autorización venció, usa Reconectar Google Calendar.`, 'notice is-error'));
  const notes = node('details'); notes.append(node('summary', 'Notas internas'));
  const noteLabel = node('label', 'Notas de operación'); const noteInput = node('textarea'); noteInput.value = r.admin_notes; noteInput.maxLength = 2000; noteLabel.append(noteInput); notes.append(noteLabel, actionButton('Guardar notas', async () => { await adminApi('admin-reservations', { action: 'notes', id: r.id, note: noteInput.value }); status(message, 'Notas guardadas.'); })); card.append(notes);
  const actions = node('div', undefined, 'admin-actions');
  if (['pending', 'confirming'].includes(r.status)) actions.append(actionButton('Confirmar y añadir a Google Calendar', () => reservationAction(r, 'confirm-reservation', 'confirm', '¿Revisaste los detalles y los acuerdos comerciales de esta solicitud? La reserva se confirmará únicamente si Calendar registra el evento.')));
  if (r.status === 'pending') actions.append(actionButton('Rechazar solicitud', () => reservationAction(r, 'decline-or-cancel-reservation', 'decline', '¿Rechazar la solicitud y liberar el horario?'), true));
  if (['pending', 'confirming', 'confirmed'].includes(r.status)) actions.append(actionButton('Cancelar reserva', () => reservationAction(r, 'decline-or-cancel-reservation', 'cancel', '¿Cancelar esta reserva? Si hay un evento, el horario se liberará después de comprobar su eliminación en Calendar.'), true));
  if (r.status === 'cancellation_requested') actions.append(actionButton('Reintentar cancelación de Calendar', () => reservationAction(r, 'retry-calendar-sync', 'cancel', '¿Reintentar la eliminación del evento? El horario seguirá apartado hasta completar la cancelación.')));
  if (['confirming', 'cancellation_requested'].includes(r.status)) actions.append(actionButton('Recuperación: liberar manualmente', () => reservationAction(r, 'admin-reservations', 'release', 'Acción de recuperación: comprueba y elimina manualmente el evento en Google Calendar antes de liberar. Puede existir un evento aunque el último intento haya fallado. Esta acción deja registro y no elimina el evento. Explica lo que verificaste.', true), true));
  if (r.status === 'confirmed' && Date.parse(slot.ends_at_utc) <= Date.now()) for (const state of ['completed', 'no_show']) actions.append(actionButton(label(state), () => reservationAction(r, 'admin-reservations', state, `¿Marcar como ${label(state).toLowerCase()}?`)));
  card.append(actions); return card;
}
function renderInquiry(r) {
  const card = node('article', undefined, 'admin-card'); card.append(node('h3', `${r.service_types.name} · ${r.customer_name}`), badge(r.status));
  card.append(detailsList([['Folio', r.public_reference], ['Fecha sugerida', r.preferred_date], ['WhatsApp', r.customer_phone], ['Correo', r.customer_email], ['Locación', `${r.municipality} · ${r.location_type} · ${r.location_detail}`], ['Invitados', r.participant_count], ['Notas', r.customer_notes]]));
  const actions = node('div', undefined, 'admin-actions'); for (const [action, title] of [['inquiry_contacted', 'Marcar contactada'], ['inquiry_closed', 'Cerrar consulta']]) actions.append(actionButton(title, async () => { await adminApi('admin-reservations', { action, id: r.id }); await loadReservations(); })); card.append(actions); return card;
}
async function loadReservations() {
  const version = ++listVersion; const filters = Object.fromEntries(new FormData($('#filters')));
  if (filters.from) filters.date_from = guadalajaraToUtc(`${filters.from}T00:00`);
  if (filters.to) { const next = new Date(`${filters.to}T00:00:00Z`); next.setUTCDate(next.getUTCDate() + 1); filters.date_to = guadalajaraToUtc(`${next.toISOString().slice(0, 10)}T00:00`); }
  const result = await adminApi('admin-reservations', { action: 'list', ...filters, page }); if (version !== listVersion) return;
  $('#reservations').replaceChildren(...result.reservations.map(renderReservation)); if (!result.reservations.length) $('#reservations').append(node('p', 'No hay solicitudes con estos filtros.', 'notice'));
  $('#inquiries').replaceChildren(...result.inquiries.map(renderInquiry)); if (!result.inquiries.length) $('#inquiries').append(node('p', 'Todavía no hay consultas de cotización.'));
  $('#prev-page').disabled = page === 0; $('#next-page').disabled = !result.has_more; $('#page-label').textContent = `Página ${page + 1}`;
  const connection = result.connection; const connected = connection && !connection.disconnected_at;
  $('#calendar-status').textContent = connected ? `${connection.google_email} · ${connection.calendar_name} (${connection.calendar_id})${connection.last_error ? ' · Reconexión necesaria' : ' · Conectado'}` : 'Sin conexión. Puedes revisar solicitudes; para confirmar debes conectar Calendar.';
  $('#connect-calendar').textContent = connected ? 'Reconectar Google Calendar' : 'Conectar Google Calendar'; $('#disconnect-calendar').hidden = !connected;
  if (connection) { $('#calendar-id').value = connection.calendar_id; $('#calendar-name').value = connection.calendar_name; }
}
$('#filters').addEventListener('submit', event => { event.preventDefault(); page = 0; run(loadReservations, event.submitter); });
$('#prev-page').addEventListener('click', () => { page = Math.max(0, page - 1); run(loadReservations); });
$('#next-page').addEventListener('click', () => { page++; run(loadReservations); });
function editSlot(slot) {
  const form = $('#slot-form'); form.elements.id.value = slot.id; form.elements.start.value = localInput(slot.starts_at_utc); form.elements.end.value = localInput(slot.ends_at_utc);
  for (const key of ['location_type', 'location_label', 'public_note', 'internal_note', 'status']) form.elements[key].value = slot[key];
  form.querySelectorAll('[name=allowed_service_ids]').forEach(input => { input.checked = slot.allowed_service_ids.includes(input.value); });
  $('#bulk-fields').hidden = true; $('#slot-form-title').textContent = 'Editar horario'; form.scrollIntoView({ block: 'center' }); form.elements.start.focus();
}
function resetSlot() { $('#slot-form').reset(); $('#slot-id').value = ''; $('#bulk-fields').hidden = false; $('#slot-form-title').textContent = 'Crear horarios'; }
$('#reset-slot').addEventListener('click', resetSlot);
async function loadAvailability() {
  const result = await adminApi('admin-availability', { action: 'list' }); services = result.services;
  $('#slot-services').replaceChildren(); const selectedService = $('#filter-service').value;
  $('#filter-service').replaceChildren(new Option('Todos', ''));
  for (const service of services) {
    $('#filter-service').append(new Option(service.name, service.id));
    if (service.booking_mode !== 'slot') continue;
    const label = node('label'); const input = node('input'); input.type = 'checkbox'; input.name = 'allowed_service_ids'; input.value = service.id; label.append(input, document.createTextNode(service.name)); $('#slot-services').append(label);
  }
  $('#filter-service').value = selectedService;
  $('#availability').replaceChildren();
  for (const slot of result.slots) {
    const card = node('article', undefined, 'admin-card'); card.append(node('h3', formatDate(slot.starts_at_utc)), badge(slot.status), node('p', `${formatTime(slot.starts_at_utc)}–${formatTime(slot.ends_at_utc)} · ${slot.location_label || 'Locación por definir'}`), node('p', slot.public_note), node('p', `Nota interna: ${slot.internal_note || '—'}`));
    const actions = node('div', undefined, 'admin-actions'); actions.append(actionButton('Editar', () => editSlot(slot)));
    for (const [action, title] of [['activate', 'Activar'], ['pause', 'Pausar'], ['delete', 'Eliminar']]) actions.append(actionButton(title, async () => {
      if (action !== 'activate' && !await ask(`¿${title} este horario? Solo se permite si no tiene una reserva activa. Eliminar lo archiva y conserva el historial.`)) return;
      await adminApi('admin-availability', { action, id: slot.id }); await loadAvailability(); status(message, `Horario actualizado. No se creó ningún evento de Calendar.`);
    }, action === 'delete')); card.append(actions); $('#availability').append(card);
  }
  if (!result.slots.length) $('#availability').append(node('p', 'Crea tu primer horario. Puedes guardarlo como borrador antes de publicarlo.', 'notice'));
}
$('#slot-form').addEventListener('submit', event => {
  event.preventDefault(); run(async () => {
    const form = event.target, data = Object.fromEntries(new FormData(form)), serviceIds = new FormData(form).getAll('allowed_service_ids');
    if (!serviceIds.length) throw new Error('Selecciona al menos un servicio para el horario.');
    const baseStart = guadalajaraToUtc(data.start), baseEnd = guadalajaraToUtc(data.end), duration = Date.parse(baseEnd) - Date.parse(baseStart);
    if (duration <= 0) throw new Error('El fin debe ser posterior al inicio.');
    const count = data.id ? 1 : Number(data.count); const slots = [];
    for (let i = 0; i < count; i++) {
      let start, end;
      if (data.repeat === 'adjacent') { start = new Date(Date.parse(baseStart) + duration * i).toISOString(); end = new Date(Date.parse(baseEnd) + duration * i).toISOString(); }
      else {
        const offset = i * (data.repeat === 'week' ? 7 : 1); const shift = wall => { const date = new Date(`${wall}:00Z`); date.setUTCDate(date.getUTCDate() + offset); return guadalajaraToUtc(date.toISOString().slice(0, 16)); };
        start = shift(data.start); end = shift(data.end);
      }
      slots.push({ id: data.id || null, starts_at_utc: start, ends_at_utc: end, allowed_service_ids: serviceIds, status: data.status, location_type: data.location_type, location_label: data.location_label, public_note: data.public_note, internal_note: data.internal_note });
    }
    await adminApi('admin-availability', { action: 'save', slots }); resetSlot(); await loadAvailability(); status(message, `${slots.length} horario(s) guardado(s). No se creó ningún evento de Calendar.`);
  }, event.submitter);
});
async function init() {
  try {
    const calendarResult = new URL(location.href).searchParams.get('calendar');
    if (!await restore()) { status(message, 'Acceso exclusivo para la cuenta autorizada.'); return; }
    // Every read reaches requireAdmin before private data is returned or rendered.
    await loadAvailability(); await loadReservations(); $('#admin-panel').hidden = false; $('#login-panel').hidden = true; $('#logout').hidden = false;
    status(message, calendarResult === 'connected' ? 'Calendar conectado. Revisa la cuenta y el calendario de destino.' : calendarResult === 'denied' ? 'La conexión de Calendar no fue autorizada.' : 'Panel listo. Los horarios se muestran en hora de Guadalajara.');
    history.replaceState(null, '', location.pathname);
  } catch (error) { clearSession(); status(message, error.message, true); }
}
init();
