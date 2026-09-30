import { AppError, Database, env, secret, timedFetch, type Data } from './core.ts';
import { challenge, decrypt, encrypt, randomToken, sha256 } from './crypto.ts';
const calendarScope='https://www.googleapis.com/auth/calendar.events';
export async function startCalendarOAuth(admin:Data,db:Database):Promise<Data>{
  const state=randomToken(), verifier=randomToken(), encrypted=await encrypt(verifier,`oauth:${admin.id}`);
  await db.insert('oauth_states',{state_hash:await sha256(state),admin_user_id:admin.id,code_verifier_hash:await sha256(verifier),
    encrypted_code_verifier:encrypted.ciphertext,verifier_iv:encrypted.iv,token_key_version:encrypted.version,expires_at:new Date(Date.now()+600000).toISOString()});
  const url=new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.search=new URLSearchParams({client_id:secret('GOOGLE_CALENDAR_CLIENT_ID'),redirect_uri:secret('GOOGLE_OAUTH_REDIRECT_URI'),response_type:'code',
    scope:`openid email ${calendarScope}`,access_type:'offline',prompt:'consent',state,code_challenge:await challenge(verifier),code_challenge_method:'S256'}).toString();
  return {url:url.href};
}
export async function calendarOAuthCallback(request:Request,db:Database):Promise<Response>{
  const url=new URL(request.url);const state=url.searchParams.get('state');
  if(!state || state.length>200)throw new AppError('INVALID_OAUTH_STATE');
  const saved=await db.rpc('booking_consume_oauth',{p_hash:await sha256(state)});
  const [admin]=await db.select('admin_users',`id=eq.${saved.admin_user_id}&is_allowed=eq.true&select=id,email`);
  if(!admin || !secret('ADMIN_EMAILS').toLowerCase().split(',').map(s=>s.trim()).includes(admin.email.toLowerCase()))throw new AppError('FORBIDDEN',403);
  if(url.searchParams.has('error'))return redirect('denied');
  const code=url.searchParams.get('code');if(!code || code.length>4096)throw new AppError('INVALID_OAUTH_STATE');
  const verifier=await decrypt(saved.encrypted_code_verifier,saved.verifier_iv,saved.token_key_version,`oauth:${admin.id}`);
  if(await sha256(verifier)!==saved.code_verifier_hash)throw new AppError('INVALID_OAUTH_STATE');
  const response=await timedFetch('https://oauth2.googleapis.com/token',{method:'POST',body:new URLSearchParams({
    client_id:secret('GOOGLE_CALENDAR_CLIENT_ID'),client_secret:secret('GOOGLE_CALENDAR_CLIENT_SECRET'),redirect_uri:secret('GOOGLE_OAUTH_REDIRECT_URI'),grant_type:'authorization_code',code,code_verifier:verifier,
  })});
  const token=await response.json();if(!response.ok || !token.access_token)throw new AppError('CALENDAR_RECONNECT',502);
  const scopes=String(token.scope||'').split(' ');if(!scopes.includes(calendarScope))throw new AppError('CALENDAR_SCOPE_REQUIRED');
  // Identity is fetched with the newly issued server token, not decoded from an unverified JWT.
  const identityResponse=await timedFetch('https://openidconnect.googleapis.com/v1/userinfo',{headers:{Authorization:`Bearer ${token.access_token}`}});
  const identity=await identityResponse.json();if(!identityResponse.ok || !identity.sub || !identity.email_verified)throw new AppError('CALENDAR_RECONNECT');
  const [existing]=await db.select('google_calendar_connections',`admin_user_id=eq.${admin.id}&select=*`);
  let encrypted;
  if(token.refresh_token)encrypted=await encrypt(token.refresh_token,`calendar:${admin.id}`);
  else if(existing && existing.google_subject===identity.sub && !existing.disconnected_at && existing.last_error!=='CALENDAR_RECONNECT'){
    encrypted={ciphertext:existing.encrypted_refresh_token,iv:existing.token_iv,version:existing.token_key_version};
  }else throw new AppError('CALENDAR_RECONNECT');
  await db.rpc('booking_save_connection',{p_actor:admin.id,p_data:{google_subject:identity.sub,google_email:identity.email,
    calendar_id:env('GOOGLE_CALENDAR_DEFAULT_ID','primary'),calendar_name:'Principal',encrypted_refresh_token:encrypted.ciphertext,token_iv:encrypted.iv,token_key_version:encrypted.version,granted_scopes:scopes}});
  return redirect('connected');
}
function redirect(result:string):Response{
  const destination=new URL(secret('ADMIN_APP_URL'));
  if(destination.origin!==secret('ADMIN_APP_ORIGIN'))throw new AppError('SERVER_CONFIGURATION',503);
  destination.searchParams.set('calendar',result);
  return new Response(null,{status:303,headers:{Location:destination.href,'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});
}
