import { AppError, Database, clean, env, jsonBody, requireAdmin, uuid, validateCustomer, type Data } from './core.ts';
import { guardPublic } from './antispam.ts';
import { calendarFor } from './calendar.ts';
import { cancelReservation, confirmReservation } from './confirm-flow.ts';
import { calendarOAuthCallback, startCalendarOAuth } from './oauth.ts';

const messages:Record<string,string>={
  UNAUTHORIZED:'Inicia sesión de nuevo.',FORBIDDEN:'Esta cuenta no tiene permiso de administración.',
  SLOT_UNAVAILABLE:'Ese horario ya no está disponible. Elige otro.',SLOT_CONFLICT:'El horario se solapa o ya tiene una solicitud.',SLOT_OCCUPIED:'El horario tiene una reserva activa.',
  SLOT_NOT_FUTURE:'El horario debe estar en el futuro.',SYNC_BUSY:'Ya hay una sincronización en curso. Espera tres minutos antes de reintentar.',
  INVALID_STATE:'Esta acción no está disponible en el estado actual.',CONSENT_REQUIRED:'Acepta el aviso y los términos vigentes.',
  BOOKING_CLOSED:'Las solicitudes en línea aún no están habilitadas. Escríbenos por Instagram.',
  CALENDAR_DISCONNECTED:'Conecta Google Calendar antes de continuar.',CALENDAR_RECONNECT:'Reconectar Google Calendar: la autorización dejó de ser válida.',
  CALENDAR_ERROR:'No se pudo verificar Calendar. El horario sigue apartado; puedes reintentar.',
  CALENDAR_EVENT_CONFLICT:'El evento de Calendar fue modificado o eliminado. Revisa Calendar antes de recuperar la reserva.',
  CALENDAR_ACCOUNT_IN_USE:'Hay reservas ligadas a esta cuenta de Calendar. Cancélalas antes de cambiar de cuenta.',
  RATE_LIMITED:'Demasiados intentos. Inténtalo dentro de una hora.',CAPTCHA_REQUIRED:'Completa de nuevo la verificación de seguridad.',
  INVALID_OAUTH_STATE:'La conexión caducó o ya se utilizó. Vuelve al panel e inicia la conexión.',
  INVALID_INPUT:'Revisa los campos del formulario.',SERVER_CONFIGURATION:'El servicio aún requiere configuración.',
};
function cors(request:Request,callback:boolean):Headers{
  const headers=new Headers({'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',Vary:'Origin'});
  const origin=request.headers.get('origin');
  const allowed=env('ALLOWED_ORIGINS').split(',').map(s=>s.trim()).filter(Boolean);
  if(origin && !allowed.includes(origin))throw new AppError('FORBIDDEN',403);
  if(!origin && !callback)throw new AppError('FORBIDDEN',403);
  if(origin){headers.set('Access-Control-Allow-Origin',origin);headers.set('Access-Control-Allow-Headers','authorization, apikey, content-type');headers.set('Access-Control-Allow-Methods','POST, OPTIONS');}
  return headers;
}
function validateSlots(input:unknown):Data[]{
  if(!Array.isArray(input)||input.length<1||input.length>60)throw new AppError('INVALID_INPUT');
  return input.map(item=>{
    if(!item || typeof item!=='object')throw new AppError('INVALID_INPUT');
    const start=clean(item.starts_at_utc,40,20),end=clean(item.ends_at_utc,40,20);
    if(!start.endsWith('Z')||!end.endsWith('Z')||!Number.isFinite(Date.parse(start))||!Number.isFinite(Date.parse(end))||Date.parse(end)<=Date.parse(start))throw new AppError('INVALID_INPUT');
    if(!['active','draft','paused'].includes(item.status)||!['estudio','exterior','domicilio','por_definir'].includes(item.location_type)||!Array.isArray(item.allowed_service_ids)||item.allowed_service_ids.length<1||item.allowed_service_ids.length>30)throw new AppError('INVALID_INPUT');
    return {id:item.id?uuid(item.id):null,starts_at_utc:start,ends_at_utc:end,status:item.status,
      allowed_service_ids:item.allowed_service_ids.map(uuid),location_type:item.location_type,
      location_label:clean(item.location_label,160),public_note:clean(item.public_note,500),internal_note:clean(item.internal_note,2000)};
  });
}
async function adminAvailability(data:Data,admin:Data,db:Database):Promise<Data>{
  if(data.action==='list'){
    const [slots,services,settings]=await Promise.all([
      db.select('availability_slots','status=neq.archived&select=*&order=starts_at_utc.asc&limit=1000'),
      db.select('service_types','select=*&order=sort_order.asc'),db.select('booking_settings','select=*')]);
    return {slots,services,settings:settings[0]};
  }
  return db.rpc('booking_admin_slots',{p_actor:admin.id,p_action:clean(data.action,20,1),p_slots:data.action==='save'?validateSlots(data.slots):[],p_id:data.id?uuid(data.id):null});
}
async function adminReservations(data:Data,admin:Data,db:Database):Promise<Data>{
  if(data.action==='list'){
    await db.rpc('booking_expire');
    const query=new URLSearchParams({select:'*,availability_slots!inner(starts_at_utc,ends_at_utc,location_label),service_types(name)',order:'created_at.desc',limit:'100',offset:String(Math.max(0,Math.min(10000,Number(data.page)||0))*100)});
    if(data.status){if(!['pending','confirming','confirmed','completed','no_show','declined','expired','cancellation_requested','cancelled_by_admin','released'].includes(data.status))throw new AppError('INVALID_INPUT');query.set('status',`eq.${data.status}`);}
    if(data.service_id)query.set('service_id',`eq.${uuid(data.service_id)}`);
    if(data.sync){if(!['not_created','creating','synced','error','cancellation_pending','cancelled'].includes(data.sync))throw new AppError('INVALID_INPUT');query.set('calendar_sync_status',`eq.${data.sync}`);}
    for(const [field,op] of [['date_from','gte'],['date_to','lt']])if(data[field]){
      if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(data[field]))throw new AppError('INVALID_INPUT');query.append('availability_slots.starts_at_utc',`${op}.${data[field]}`);
    }
    const [reservations,inquiries,connections]=await Promise.all([
      db.select('reservations',query.toString()),db.select('booking_inquiries','select=*,service_types(name)&order=created_at.desc&limit=100'),
      db.select('google_calendar_connections',`admin_user_id=eq.${admin.id}&select=google_email,calendar_id,calendar_name,connected_at,disconnected_at,last_error`)]);
    return {reservations,inquiries,connection:connections[0]||null,has_more:reservations.length===100};
  }
  if(data.action==='calendar_settings'){
    const id=clean(data.calendar_id,254,1),name=clean(data.calendar_name,120,1);
    // Snapshots on existing reservations keep their original target calendar.
    await db.update('google_calendar_connections',`admin_user_id=eq.${admin.id}`,{calendar_id:id,calendar_name:name});
    await db.insert('audit_log',{actor_type:'admin',actor_id:admin.id,action:'calendar.settings'});return {ok:true};
  }
  if(data.action==='disconnect'){
    await db.update('google_calendar_connections',`admin_user_id=eq.${admin.id}`,{disconnected_at:new Date().toISOString(),encrypted_refresh_token:'',token_iv:'',last_error:'CALENDAR_DISCONNECTED'});
    await db.insert('audit_log',{actor_type:'admin',actor_id:admin.id,action:'calendar.disconnect'});return {ok:true};
  }
  return db.rpc('booking_reservation_action',{p_actor:admin.id,p_id:uuid(data.id),p_action:clean(data.action,30,1),p_note:clean(data.note,2000)});
}
export function handler(endpoint:string):(request:Request)=>Promise<Response>{
  return async(request:Request)=>{
    const trace=crypto.randomUUID();let headers=new Headers({'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'});
    try{
      const callback=endpoint==='google-calendar-oauth-callback';headers=cors(request,callback);
      if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
      if(request.method!==(callback?'GET':'POST'))throw new AppError('METHOD_NOT_ALLOWED',405);
      const db=new Database();
      if(callback)return await calendarOAuthCallback(request,db);
      const data=await jsonBody(request);let result:Data;
      if(endpoint==='list-public-slots')result=await db.rpc('booking_public_catalog',{p_service:data.service_id?uuid(data.service_id):null});
      else if(endpoint==='create-reservation'){
        await guardPublic(request,data,db);result=await db.rpc('booking_create',{p_data:validateCustomer(data)});
      }else{
        const admin=await requireAdmin(request,db);
        const deps={begin:(id:string,operation:string)=>db.rpc('booking_begin_sync',{p_actor:admin.id,p_id:id,p_operation:operation}),
          finish:(id:string,token:string,operation:string,error:string|null)=>db.rpc('booking_finish_sync',{p_actor:admin.id,p_id:id,p_token:token,p_operation:operation,p_error:error}),
          calendar:(r:Data)=>calendarFor(db,r)};
        switch(endpoint){
          case 'admin-availability':result=await adminAvailability(data,admin,db);break;
          case 'admin-reservations':result=await adminReservations(data,admin,db);break;
          case 'calendar-connect-start':result=await startCalendarOAuth(admin,db);break;
          case 'confirm-reservation':result=await confirmReservation(uuid(data.id),deps);break;
          case 'decline-or-cancel-reservation':{
            const [r]=await db.select('reservations',`id=eq.${uuid(data.id)}&select=status`);
            if(!r)throw new AppError('NOT_FOUND',404);
            if(data.action==='decline'||r.status==='pending')result=await db.rpc('booking_reservation_action',{p_actor:admin.id,p_id:data.id,p_action:data.action==='decline'?'decline':'cancel',p_note:clean(data.note,500)});
            else result=await cancelReservation(data.id,deps);break;
          }
          case 'retry-calendar-sync':
            // Creation retries must use the explicit confirm endpoint/button, never a background job.
            result=await cancelReservation(uuid(data.id),deps);break;
          default:throw new AppError('NOT_FOUND',404);
        }
      }
      headers.set('Content-Type','application/json');return new Response(JSON.stringify(result),{headers});
    }catch(error){
      const code=error instanceof AppError?error.code:'SERVICE_UNAVAILABLE';const status=error instanceof AppError?error.status:503;
      console.error(JSON.stringify({trace,endpoint,code})); // No payloads, OAuth URLs, tokens or PII.
      headers.set('Content-Type','application/json');
      return new Response(JSON.stringify({error:code,message:messages[code]||'No se pudo completar la operación. Intenta de nuevo.',trace}),{status,headers});
    }
  };
}
