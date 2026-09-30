import test from 'node:test';
import assert from 'node:assert/strict';
import { CalendarClient } from '../supabase/functions/_shared/calendar.ts';
import { confirmReservation, cancelReservation } from '../supabase/functions/_shared/confirm-flow.ts';
import { AppError } from '../supabase/functions/_shared/core.ts';

function fixture() {
  const state = { status: 'pending', sync: 'not_created', creates: 0, deletes: 0, events: new Map(), failCreate: false, loseCreateResponse: false, loseFinish: false, failDelete: false, busy: false };
  const id = '11111111-1111-4111-8111-111111111111';
  const r = { id, sync_token: 'lease', public_reference: 'folio', customer_name: 'Cliente de prueba', customer_phone: '+523300000000', customer_email: 'test@example.invalid', municipality: 'Guadalajara', location_type: 'estudio', location_detail: '', customer_notes: 'Texto', google_calendar_event_id: `cf${id.replaceAll('-', '')}` };
  const slot = { starts_at_utc: '2027-02-10T18:00:00.000Z', ends_at_utc: '2027-02-10T19:00:00.000Z' };
  const fetcher = async (url, options) => {
    assert.match(url, /sendUpdates=none/); const method = options.method;
    if (method === 'GET') { const event = state.events.get(r.google_calendar_event_id); return new Response(JSON.stringify(event || {}), { status: event ? 200 : 404 }); }
    if (method === 'POST') {
      if (state.failCreate) return new Response('{}', { status: 503 });
      const event = JSON.parse(options.body); assert.equal(event.visibility, 'private'); assert.equal(event.attendees, undefined); assert.equal(event.start.timeZone, 'America/Mexico_City');
      assert.match(event.id, /^[0-9a-v]{5,1024}$/); assert.deepEqual(Object.keys(event.extendedProperties.private), ['reservation_id']);
      if (state.events.has(event.id)) return new Response('{}', { status: 409 });
      state.creates++; state.events.set(event.id, event);
      if (state.loseCreateResponse) { state.loseCreateResponse = false; throw new Error('timeout after Google persisted event'); }
      return Response.json(event);
    }
    if (method === 'DELETE') {
      if (state.failDelete) return new Response('{}', { status: 503 });
      state.deletes++; state.events.delete(r.google_calendar_event_id); return new Response(null, { status: 204 });
    }
    throw new Error(`Unexpected HTTP operation ${method}`);
  };
  const deps = {
    begin: async (_, op) => {
      if (state.busy) throw new AppError('SYNC_BUSY');
      if ((op === 'confirm' && state.status === 'confirmed') || (op === 'cancel' && state.status === 'cancelled_by_admin')) return { done: true, status: state.status };
      state.busy = true; state.status = op === 'confirm' ? 'confirming' : 'cancellation_requested';
      return { done: false, reservation: r, slot, service: 'Retrato femenino' };
    },
    finish: async (_, __, op, error) => {
      state.busy = false;
      if (state.loseFinish && !error) { state.loseFinish = false; throw new Error('database unavailable'); }
      if (error) { state.sync = op === 'confirm' ? 'error' : 'cancellation_pending'; return { ok: false }; }
      state.status = op === 'confirm' ? 'confirmed' : 'cancelled_by_admin'; state.sync = op === 'confirm' ? 'synced' : 'cancelled'; return { ok: true, status: state.status };
    },
    calendar: async () => new CalendarClient('mock-token', 'primary', fetcher),
  };
  return { state, r, slot, deps, id };
}
test('confirmation creates one private event; repeated confirmation creates none', async () => {
  const f = fixture(); await confirmReservation(f.id, f.deps); await confirmReservation(f.id, f.deps);
  assert.equal(f.state.creates, 1); assert.equal(f.state.status, 'confirmed');
});
test('concurrent double click has a single Calendar writer', async () => {
  const f = fixture(); const results = await Promise.allSettled([confirmReservation(f.id, f.deps), confirmReservation(f.id, f.deps)]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1); assert.equal(f.state.creates, 1);
});
test('lost Google response recovers the same event without duplicate insertion', async () => {
  const f = fixture(); f.state.loseCreateResponse = true;
  await assert.rejects(confirmReservation(f.id, f.deps)); assert.equal(f.state.status, 'confirming'); assert.equal(f.state.sync, 'error');
  await confirmReservation(f.id, f.deps); assert.equal(f.state.creates, 1); assert.equal(f.state.status, 'confirmed');
});
test('failed database completion recovers Google event', async () => {
  const f = fixture(); f.state.loseFinish = true; await assert.rejects(confirmReservation(f.id, f.deps)); await confirmReservation(f.id, f.deps);
  assert.equal(f.state.creates, 1); assert.equal(f.state.status, 'confirmed');
});
test('Calendar failure does not confirm and is retryable', async () => {
  const f = fixture(); f.state.failCreate = true; await assert.rejects(confirmReservation(f.id, f.deps));
  assert.equal(f.state.status, 'confirming'); assert.equal(f.state.sync, 'error');
  f.state.failCreate = false; await confirmReservation(f.id, f.deps); assert.equal(f.state.status, 'confirmed');
});
test('cancellation errors keep reservation held; retry and repeated cancel are idempotent', async () => {
  const f = fixture(); await confirmReservation(f.id, f.deps); f.state.failDelete = true;
  await assert.rejects(cancelReservation(f.id, f.deps)); assert.equal(f.state.status, 'cancellation_requested'); assert.equal(f.state.sync, 'cancellation_pending');
  f.state.failDelete = false; await cancelReservation(f.id, f.deps); await cancelReservation(f.id, f.deps);
  assert.equal(f.state.events.size, 0); assert.equal(f.state.deletes, 1); assert.equal(f.state.status, 'cancelled_by_admin');
});
test('event modified in Calendar is not silently confirmed', async () => {
  const f = fixture(); f.state.loseCreateResponse = true; await assert.rejects(confirmReservation(f.id, f.deps));
  f.state.events.get(f.r.google_calendar_event_id).start.dateTime = '2027-02-11T18:00:00.000Z';
  await assert.rejects(confirmReservation(f.id, f.deps), /CALENDAR_EVENT_CONFLICT/); assert.equal(f.state.status, 'confirming');
});
test('ambiguous creation can be cancelled by its deterministic ID', async () => {
  const f = fixture(); f.state.loseCreateResponse = true; await assert.rejects(confirmReservation(f.id, f.deps));
  await cancelReservation(f.id, f.deps); assert.equal(f.state.events.size, 0); assert.equal(f.state.status, 'cancelled_by_admin');
});
