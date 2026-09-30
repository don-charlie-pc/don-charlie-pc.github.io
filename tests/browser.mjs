// Dependency-free Chrome smoke test via the DevTools Protocol. No real credentials.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, extname } from 'node:path';
const root = resolve(import.meta.dirname, '..'), screenshots = resolve(root, 'test-results');
const chromePath = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const service = { id: '11111111-1111-4111-8111-111111111111', name: 'Retrato femenino', description: 'Un espacio para mirarte con calma.', booking_mode: 'slot' };
const wedding = { id: '22222222-2222-4222-8222-222222222222', name: 'Boda — solo fotografía', description: 'Tu historia.', booking_mode: 'quote' };
const slot = { id: '33333333-3333-4333-8333-333333333333', starts_at_utc: '2027-02-10T18:00:00.000Z', ends_at_utc: '2027-02-10T19:00:00.000Z', timezone: 'America/Mexico_City', location_label: 'Guadalajara', public_note: 'Luz de tarde', internal_note: 'Nota privada', location_type: 'estudio', status: 'active', allowed_service_ids: [service.id] };
const settings = { accepting_requests: true, minimum_notice_hours: 24, maximum_window_days: 90, legal_version: 'test' };
let submitted = null, mockEnabled = false, adminDenied = false, confirms = 0, base;
const server = createServer(async (req, res) => {
  try {
    const path = new URL(req.url, base).pathname;
    if (mockEnabled && path === '/assets/js/booking-config.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(`export const config = ${JSON.stringify({ PUBLIC_SUPABASE_URL: base, PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'mock-public-key', PUBLIC_TURNSTILE_SITE_KEY: '', PUBLIC_APP_ORIGIN: base })};`); return; }
    if (path.startsWith('/functions/v1/')) {
      let body = ''; for await (const chunk of req) body += chunk; const data = JSON.parse(body); res.setHeader('Content-Type', 'application/json');
      if (path.endsWith('list-public-slots')) res.end(JSON.stringify({ services: [service, wedding], settings, slots: data.service_id === service.id ? [slot] : [] }));
      else if (path.endsWith('create-reservation')) { submitted = data; res.end(JSON.stringify({ kind: data.service_id === wedding.id ? 'inquiry' : 'reservation', public_reference: '44444444-4444-4444-8444-444444444444', hold_expires_at: '2027-02-09T18:00:00Z' })); }
      else if (adminDenied) { res.statusCode = 403; res.end(JSON.stringify({ error: 'FORBIDDEN', message: 'Esta cuenta no tiene permiso de administración.' })); }
      else if (path.endsWith('admin-availability')) res.end(JSON.stringify({ slots: [slot], services: [service, wedding], settings }));
      else if (path.endsWith('confirm-reservation')) { confirms++; res.end(JSON.stringify({ status: 'confirmed', ok: true })); }
      else if (path.endsWith('admin-reservations')) res.end(JSON.stringify({ reservations: [{ id: '55555555-5555-4555-8555-555555555555', public_reference: '44444444-4444-4444-8444-444444444444', customer_name: '<img src=x onerror=alert(1)>', customer_email: 'test@example.invalid', customer_phone: '+523312345678', municipality: 'Zapopan', location_type: 'estudio', location_detail: 'Centro', customer_notes: '<script>alert(1)</script>', participant_count: 2, admin_notes: 'Por revisar', preferred_contact_method: 'whatsapp', hold_expires_at: '2027-02-09T18:00:00Z', status: confirms ? 'confirmed' : 'pending', calendar_sync_status: confirms ? 'synced' : 'not_created', availability_slots: slot, service_types: service }], inquiries: [], connection: null, has_more: false }));
      else { res.statusCode = 404; res.end('{}'); } return;
    }
    const file = resolve(root, 'public', `.${path.endsWith('/') ? path + 'index.html' : path}`);
    if (!file.startsWith(resolve(root, 'public') + '/')) throw new Error('Invalid path');
    const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml' };
    res.setHeader('Content-Type', types[extname(file)] || 'application/octet-stream'); res.end(await readFile(file));
  } catch { res.statusCode = 404; res.end('Not found'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); base = `http://127.0.0.1:${server.address().port}`;
const profile = await mkdtemp(resolve(tmpdir(), 'castellanos-browser-')); await mkdir(screenshots, { recursive: true });
const browser = spawn(chromePath, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-extensions', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
let errors = [];
try {
  const wsUrl = await new Promise((resolve, reject) => {
    let stderr = ''; const timer = setTimeout(() => reject(new Error('Chrome did not start in 15 seconds')), 15000);
    browser.on('error', reject); browser.stderr.on('data', data => { stderr += data; const match = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/); if (match) { clearTimeout(timer); resolve(match[1]); } });
  });
  const ws = new WebSocket(wsUrl); await new Promise(resolve => ws.addEventListener('open', resolve, { once: true }));
  let sequence = 0; const pending = new Map();
  ws.addEventListener('message', event => {
    const data = JSON.parse(event.data); if (data.id && pending.has(data.id)) { const { resolve, reject, timer } = pending.get(data.id); clearTimeout(timer); pending.delete(data.id); data.error ? reject(new Error(JSON.stringify(data.error))) : resolve(data.result); }
    if (data.method === 'Runtime.exceptionThrown') errors.push(data.params.exceptionDetails.text);
  });
  function send(method, params = {}, sessionId) { return new Promise((resolve, reject) => { const id = ++sequence; const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 15000); pending.set(id, { resolve, reject, timer }); ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })); }); }
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' }); const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  const cdp = (method, params) => send(method, params, sessionId);
  await cdp('Page.enable'); await cdp('Runtime.enable'); await cdp('Emulation.setTimezoneOverride', { timezoneId: 'Asia/Tokyo' });
  async function evaluate(expression) { const result = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails)); return result.result.value; }
  async function waitFor(expression) { for (let i = 0; i < 80; i++) { if (await evaluate(expression)) return; await new Promise(resolve => setTimeout(resolve, 50)); } throw new Error(`Timed out: ${expression}`); }
  const navigate = async path => { await cdp('Page.navigate', { url: `${base}${path}` }); await waitFor('document.readyState === "complete"'); };
  const shot = async name => { const { data } = await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }); await writeFile(resolve(screenshots, name), Buffer.from(data, 'base64')); };
  const overflow = async () => assert.equal(await evaluate('document.documentElement.scrollWidth > window.innerWidth'), false, 'Horizontal overflow');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await navigate('/reservar/'); await waitFor('document.querySelector("#booking-status").textContent.includes("preparación")'); await shot('booking-unconfigured-desktop.png'); await overflow();
  await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
  await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
  assert.equal(await evaluate('document.activeElement.className'), 'skip-link');
  assert.notEqual(await evaluate('getComputedStyle(document.activeElement).outlineStyle'), 'none');
  await navigate('/'); assert.equal(await evaluate(`Array.from(document.links).some(a => a.getAttribute('href') === 'reservar/')`), true); await shot('portfolio-desktop.png');
  mockEnabled = true; await navigate('/reservar/'); await waitFor('document.querySelectorAll("#services input").length === 2');
  await evaluate('document.querySelector("#services input").click()'); await waitFor('document.querySelectorAll("#slots input").length === 1');
  assert.match(await evaluate('document.querySelector("#slots").textContent'), /12:00/);
  await evaluate('document.querySelector("#slots input").click()');
  assert.equal(await evaluate('document.querySelector("#customer-fields").disabled'), false);
  const accessibility = await cdp('Accessibility.getFullAXTree');
  const textboxes = accessibility.nodes.filter(n => n.role?.value === 'textbox').map(n => n.name?.value.toLowerCase());
  assert.ok(textboxes.includes('nombre completo'), `Accessible input names: ${JSON.stringify(textboxes)}`);
  assert.ok(textboxes.includes('whatsapp'));
  await shot('booking-configured-desktop.png');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true }); await overflow(); await shot('booking-mobile.png');
  await evaluate(`(() => { const f=document.querySelector('#booking-form'); const values={customer_name:'Prueba de navegador',customer_phone:'+523312345678',customer_email:'test@example.invalid',municipality:'Zapopan',location_type:'estudio'}; for(const [key,value] of Object.entries(values))f.elements[key].value=value; f.elements.privacy_accepted.checked=true;f.elements.terms_accepted.checked=true;f.requestSubmit(); })()`);
  await waitFor('!document.querySelector("#booking-success").hidden'); assert.equal(submitted.slot_id, slot.id); assert.equal(submitted.privacy_accepted, true); assert.equal(submitted.terms_accepted, true); await shot('booking-success-mobile.png');
  await navigate('/reservar/'); await waitFor('document.querySelectorAll("#services input").length === 2');
  await evaluate('document.querySelectorAll("#services input")[1].click()');
  assert.equal(await evaluate('document.querySelector("#slot-section").hidden'), true); assert.equal(await evaluate('document.querySelector("#quote-section").hidden'), false);
  await evaluate(`(() => { const f=document.querySelector('#booking-form'); const values={customer_name:'Consulta de boda',customer_phone:'+523312345678',customer_email:'test@example.invalid',municipality:'Zapopan',location_type:'por_definir'}; for(const [key,value] of Object.entries(values))f.elements[key].value=value; f.elements.privacy_accepted.checked=true;f.elements.terms_accepted.checked=true;f.requestSubmit(); })()`);
  await waitFor('!document.querySelector("#booking-success").hidden'); assert.equal(submitted.slot_id, undefined); assert.equal(submitted.service_id, wedding.id);
  assert.match(await evaluate('document.querySelector("#success-message").textContent'), /no aparta ni confirma/);
  await navigate('/admin/'); await waitFor('!!document.querySelector("#login")'); assert.equal(await evaluate('document.querySelector("#admin-panel").hidden'), true);
  await evaluate(`sessionStorage.setItem('cf-admin-session',${JSON.stringify(JSON.stringify({ access_token: 'mock', refresh_token: 'mock-refresh', expires_at: Math.floor(Date.now() / 1000) + 3600 }))})`);
  await navigate('/admin/'); await waitFor('!document.querySelector("#admin-panel").hidden'); await overflow();
  assert.equal(await evaluate('document.querySelectorAll("#reservations img, #reservations script").length'), 0);
  await shot('admin-mobile.png');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false }); await shot('admin-desktop.png');
  await evaluate('Array.from(document.querySelectorAll("#reservations button")).find(b=>b.textContent==="Confirmar y añadir a Google Calendar").click()'); await waitFor('document.querySelector("#confirm-dialog").open');
  await evaluate('document.querySelector("#confirm-dialog button[value=confirm]").click()'); await waitFor('document.querySelector("#reservations").textContent.includes("Confirmada")'); assert.equal(confirms, 1);
  adminDenied = true; await navigate('/admin/'); await waitFor('document.querySelector("#admin-status").textContent.includes("permiso")'); assert.equal(await evaluate('document.querySelector("#reservations").textContent'), '');
  assert.equal(await evaluate('sessionStorage.getItem("cf-admin-session")'), null);
  assert.deepEqual(errors, []); ws.close();
  console.log('Browser QA passed: desktop/mobile, timezone Tokyo, request submission, quote flow, safe text rendering, confirmation dialog and unauthorized admin. Screenshots in test-results/.');
} finally { browser.kill(); server.close(); }
