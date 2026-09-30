import { AppError, Database, env, secret, timedFetch, type Data } from './core.ts';
import { sha256 } from './crypto.ts';
export async function guardPublic(request:Request,data:Data,db:Database):Promise<void>{
  // Only use a header overwritten by the trusted ingress, never a caller-provided body value.
  // Hash before persistence; absent headers share a restrictive bucket instead of bypassing limits.
  const ip=(request.headers.get(env('CLIENT_IP_HEADER','x-forwarded-for'))||'unknown').split(',').pop()!.trim();
  const bucket=await sha256(`${secret('RATE_LIMIT_SALT')}:ip:${ip}`);
  if(!await db.rpc('booking_rate_limit',{p_key:bucket,p_limit:5}))throw new AppError('RATE_LIMITED',429);
  if(data.website)throw new AppError('SPAM_REJECTED',400);
  const email=String(data.customer_email||'').trim().toLowerCase();
  if(!await db.rpc('booking_rate_limit',{p_key:await sha256(`${secret('RATE_LIMIT_SALT')}:email:${email}`),p_limit:3}))throw new AppError('RATE_LIMITED',429);
  const captchaSecret=env('TURNSTILE_SECRET_KEY');
  if(!captchaSecret){if(env('REQUIRE_TURNSTILE','true')!=='false')throw new AppError('SERVER_CONFIGURATION',503);return;}
  if(typeof data.turnstile_token!=='string' || data.turnstile_token.length>2048)throw new AppError('CAPTCHA_REQUIRED');
  const response=await timedFetch('https://challenges.cloudflare.com/turnstile/v0/siteverify',{
    method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({secret:captchaSecret,response:data.turnstile_token}),
  });
  const result=await response.json();
  if(!response.ok || !result.success || result.action!=='booking' || !secret('TURNSTILE_HOSTNAMES').split(',').map(s=>s.trim()).includes(result.hostname))throw new AppError('CAPTCHA_REQUIRED');
}
