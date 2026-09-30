import { config } from './booking-config.js';
import { api, configured, formatDate, formatTime, node, status } from './booking-common.js';
const form = document.querySelector('#booking-form');
const message = document.querySelector('#booking-status');
const fields = document.querySelector('#customer-fields');
const slotSection = document.querySelector('#slot-section');
const quoteSection = document.querySelector('#quote-section');
const submit = document.querySelector('#submit-booking');
let services = [], selected = null, settings = {}, requestVersion = 0, captchaWidget;
function renderServices() {
  const root = document.querySelector('#services'); root.replaceChildren();
  for (const service of services) {
    const label = node('label', undefined, 'choice'); const radio = node('input');
    radio.type = 'radio'; radio.name = 'service_id'; radio.value = service.id; radio.required = true;
    const description = node('span'); description.append(node('strong', service.name), node('small', service.booking_mode === 'quote' ? 'Solo cotización · sin apartado' : service.description));
    label.append(radio, description); root.append(label); radio.addEventListener('change', () => chooseService(service));
  }
}
async function chooseService(service) {
  selected = service; const version = ++requestVersion;
  const quote = service.booking_mode === 'quote'; slotSection.hidden = quote; quoteSection.hidden = !quote;
  fields.disabled = true; document.querySelector('#slots').replaceChildren(); submit.textContent = quote ? 'Solicitar cotización ↗' : 'Enviar solicitud ↗';
  if (quote) { fields.disabled = !settings.accepting_requests; return; }
  status(document.querySelector('#slot-status'), 'Consultando horarios…');
  try {
    const catalog = await api('list-public-slots', { service_id: service.id }); if (version !== requestVersion) return;
    settings = catalog.settings; const root = document.querySelector('#slots');
    for (const slot of catalog.slots) {
      const label = node('label', undefined, 'choice'); const radio = node('input'); radio.type = 'radio'; radio.name = 'slot_id'; radio.value = slot.id; radio.required = true;
      const text = node('span'); text.append(node('strong', `${formatDate(slot.starts_at_utc)} · ${formatTime(slot.starts_at_utc)}–${formatTime(slot.ends_at_utc)}`), node('small', [slot.location_label, slot.public_note].filter(Boolean).join(' · ')));
      label.append(radio, text); root.append(label); radio.addEventListener('change', () => { fields.disabled = !settings.accepting_requests; });
    }
    status(document.querySelector('#slot-status'), catalog.slots.length ? 'Selecciona un horario para continuar.' : 'Por ahora no hay fechas disponibles para este servicio. Escríbenos por Instagram y platiquemos.');
  } catch (error) { if (version === requestVersion) status(document.querySelector('#slot-status'), error.message, true); }
}
async function loadCaptcha() {
  if (!config.PUBLIC_TURNSTILE_SITE_KEY) return;
  await new Promise((resolve, reject) => {
    const script = document.createElement('script'); script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'; script.async = true;
    script.onload = resolve; script.onerror = reject; document.head.append(script);
  });
  captchaWidget = window.turnstile.render('#turnstile', { sitekey: config.PUBLIC_TURNSTILE_SITE_KEY, action: 'booking', language: 'es', theme: 'light' });
}
form.addEventListener('submit', async event => {
  event.preventDefault(); if (!selected || !form.reportValidity()) return;
  const data = Object.fromEntries(new FormData(form));
  data.service_id = selected.id; data.privacy_accepted = data.privacy_accepted === 'on'; data.terms_accepted = data.terms_accepted === 'on';
  data.legal_version = settings.legal_version; data.turnstile_token = captchaWidget !== undefined ? window.turnstile.getResponse(captchaWidget) : '';
  if (selected.booking_mode === 'quote') delete data.slot_id;
  else { delete data.preferred_date; if (!data.slot_id) { status(message, 'Elige un horario.', true); return; } }
  submit.disabled = true; form.setAttribute('aria-busy', 'true'); status(message, 'Enviando tu solicitud…');
  try {
    const result = await api('create-reservation', data); form.hidden = true; status(message, '');
    const success = document.querySelector('#booking-success'); success.hidden = false;
    document.querySelector('#public-reference').textContent = result.public_reference;
    document.querySelector('#success-message').textContent = result.kind === 'inquiry' ? 'Tu consulta fue recibida. Prepararemos una propuesta de fotografía. Esta consulta no aparta ni confirma una fecha.' : 'Tu solicitud fue recibida. La fecha queda apartada temporalmente y se confirma únicamente después de la revisión de Castellanos Fotografía.';
    document.querySelector('#hold-message').textContent = result.hold_expires_at ? `Apartado hasta el ${formatDate(result.hold_expires_at)} a las ${formatTime(result.hold_expires_at)}, hora de Guadalajara.` : '';
    success.focus(); success.scrollIntoView({ block: 'start' });
  } catch (error) {
    status(message, error.message, true); message.scrollIntoView({ block: 'center' });
    if (['SLOT_UNAVAILABLE', 'SLOT_CONFLICT'].includes(error.code)) await chooseService(selected);
    if (captchaWidget !== undefined) window.turnstile.reset(captchaWidget);
  } finally { submit.disabled = false; form.removeAttribute('aria-busy'); }
});
async function init() {
  if (!configured) {
    status(message, 'La agenda en línea está en preparación. Mientras tanto, conversemos en Instagram.');
    services = ['Retrato femenino', 'Sesión de cumpleaños', 'Sesión preboda', 'Boda civil', 'Bautizo y evento pequeño', 'Boda — solo fotografía'].map((name, index) => ({ id: String(index), name, description: 'Próximamente', booking_mode: index === 5 ? 'quote' : 'slot' }));
    renderServices(); form.querySelectorAll('input[name=service_id]').forEach(input => { input.disabled = true; }); return;
  }
  try {
    const catalog = await api('list-public-slots'); services = catalog.services; settings = catalog.settings; renderServices();
    status(message, settings.accepting_requests ? `Fechas con al menos ${settings.minimum_notice_hours} horas de anticipación, hasta ${settings.maximum_window_days} días. Elige tu servicio para verlas.` : 'La agenda aún no recibe solicitudes. Escríbenos por Instagram.');
    await loadCaptcha();
  } catch (error) { status(message, error.message || 'No se pudo cargar la verificación. Recarga la página.', true); }
}
init();
