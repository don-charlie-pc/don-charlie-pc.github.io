import { AppError, Database, env, secret, timedFetch, type Data } from './core.ts';
import { decrypt } from './crypto.ts';
export class CalendarClient {
  constructor(private accessToken:string,public calendarId:string,private fetcher:typeof fetch=timedFetch){}
  async request(method:string,eventId:string,body?:Data):Promise<Data|null>{
    const suffix=eventId?`/${encodeURIComponent(eventId)}`:'';
    const url=`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(this.calendarId)}/events${suffix}?sendUpdates=none`;
    const response=await this.fetcher(url,{method,headers:{Authorization:`Bearer ${this.accessToken}`,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
    if([404,410].includes(response.status))return null;
    if(response.status===409)throw new AppError('EVENT_EXISTS',409);
    if(!response.ok)throw new AppError(response.status===401?'CALENDAR_RECONNECT':'CALENDAR_ERROR',502);
    return response.status===204?{}:await response.json();
  }
  get(id:string):Promise<Data|null>{return this.request('GET',id);}
  async remove(id:string):Promise<void>{await this.request('DELETE',id);}
}
export async function calendarFor(db:Database,reservation:Data):Promise<CalendarClient>{
  const [connection]=await db.select('google_calendar_connections',`id=eq.${reservation.calendar_connection_id}&select=*`);
  if(!connection || connection.disconnected_at)throw new AppError('CALENDAR_DISCONNECTED',409);
  const refresh=await decrypt(connection.encrypted_refresh_token,connection.token_iv,connection.token_key_version,`calendar:${connection.admin_user_id}`);
  const response=await timedFetch('https://oauth2.googleapis.com/token',{
    method:'POST',body:new URLSearchParams({client_id:secret('GOOGLE_CALENDAR_CLIENT_ID'),client_secret:secret('GOOGLE_CALENDAR_CLIENT_SECRET'),grant_type:'refresh_token',refresh_token:refresh}),
  });
  const result=await response.json();
  if(!response.ok || !result.access_token){
    const error=result.error==='invalid_grant'?'CALENDAR_RECONNECT':'CALENDAR_ERROR';
    await db.update('google_calendar_connections',`id=eq.${connection.id}`,{last_error:error});
    throw new AppError(error,502);
  }
  if(env('BUSINESS_TIMEZONE','America/Mexico_City')!=='America/Mexico_City')throw new AppError('SERVER_CONFIGURATION',503);
  return new CalendarClient(result.access_token,reservation.calendar_id_snapshot);
}
