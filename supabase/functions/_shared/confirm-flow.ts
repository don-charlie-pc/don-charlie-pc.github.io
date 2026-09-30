import { AppError, type Data } from './core.ts';
import type { CalendarClient } from './calendar.ts';
export type SyncDependencies={
  begin:(id:string,operation:string)=>Promise<Data>;
  finish:(id:string,token:string,operation:string,error:string|null)=>Promise<Data>;
  calendar:(reservation:Data)=>Promise<CalendarClient>;
};
function verifyEvent(event:Data,reservation:Data,slot:Data):void{
  if(event.status==='cancelled' || event.extendedProperties?.private?.reservation_id!==reservation.id ||
    Date.parse(event.start?.dateTime)!==Date.parse(slot.starts_at_utc) || Date.parse(event.end?.dateTime)!==Date.parse(slot.ends_at_utc))throw new AppError('CALENDAR_EVENT_CONFLICT',409);
}
// This is the only Events.insert call in the application. Reconfirming uses this same path.
export async function confirmReservation(id:string,deps:SyncDependencies):Promise<Data>{
  const job=await deps.begin(id,'confirm');if(job.done)return job;
  const r=job.reservation,slot=job.slot;
  try{
    const calendar=await deps.calendar(r);
    let event=await calendar.get(r.google_calendar_event_id);
    if(!event){
      const payload={id:r.google_calendar_event_id,summary:`Castellanos Fotografía — ${job.service} — ${r.public_reference}`,
        description:`Folio: ${r.public_reference}\nCliente: ${r.customer_name}\nTeléfono: ${r.customer_phone}\nCorreo: ${r.customer_email}\nLocación: ${r.municipality}, ${r.location_type}, ${r.location_detail}\nNotas: ${r.customer_notes}`,
        start:{dateTime:slot.starts_at_utc,timeZone:'America/Mexico_City'},end:{dateTime:slot.ends_at_utc,timeZone:'America/Mexico_City'},
        visibility:'private',extendedProperties:{private:{reservation_id:r.id}},reminders:{useDefault:false},
      };
      try{event=await calendar.request('POST','',payload);}catch(error){
        if(error instanceof AppError && error.code==='EVENT_EXISTS')event=await calendar.get(r.google_calendar_event_id);else throw error;
      }
    }
    if(!event)throw new AppError('CALENDAR_ERROR',502);verifyEvent(event,r,slot);
    return await deps.finish(id,r.sync_token,'confirm',null);
  }catch(error){
    const code=error instanceof AppError?error.code:'CALENDAR_ERROR';
    await deps.finish(id,r.sync_token,'confirm',code);
    throw new AppError(code,502);
  }
}
export async function cancelReservation(id:string,deps:SyncDependencies):Promise<Data>{
  const job=await deps.begin(id,'cancel');if(job.done)return job;
  const r=job.reservation;
  try{
    const calendar=await deps.calendar(r);
    const event=await calendar.get(r.google_calendar_event_id);
    if(event && event.status!=='cancelled'){
      if(event.extendedProperties?.private?.reservation_id!==r.id)throw new AppError('CALENDAR_EVENT_CONFLICT',409);
      await calendar.remove(r.google_calendar_event_id);
    }
    return await deps.finish(id,r.sync_token,'cancel',null);
  }catch(error){
    const code=error instanceof AppError?error.code:'CALENDAR_ERROR';await deps.finish(id,r.sync_token,'cancel',code);throw new AppError(code,502);
  }
}
