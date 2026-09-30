import { AppError, env, secret } from './core.ts';
const encoder=new TextEncoder();
export const base64=(data:Uint8Array):string=>btoa(String.fromCharCode(...data));
export const unbase64=(value:string):Uint8Array<ArrayBuffer>=>Uint8Array.from(atob(value),c=>c.charCodeAt(0));
export const randomToken=():string=>base64(crypto.getRandomValues(new Uint8Array(32))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
export async function sha256(value:string):Promise<string>{return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(value))),b=>b.toString(16).padStart(2,'0')).join('');}
export async function challenge(value:string):Promise<string>{return base64(new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(value)))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}
async function key(version:number):Promise<CryptoKey>{
  const current=Number(env('GOOGLE_TOKEN_KEY_VERSION','1'));
  const raw=unbase64(secret(version===current?'GOOGLE_TOKEN_ENCRYPTION_KEY_BASE64':`GOOGLE_TOKEN_ENCRYPTION_KEY_V${version}_BASE64`));
  if(raw.length!==32)throw new AppError('SERVER_CONFIGURATION',503);
  return await crypto.subtle.importKey('raw',raw,'AES-GCM',false,['encrypt','decrypt']);
}
export async function encrypt(value:string,context:string):Promise<{ciphertext:string;iv:string;version:number}>{
  const iv=crypto.getRandomValues(new Uint8Array(12));const version=Number(env('GOOGLE_TOKEN_KEY_VERSION','1'));
  const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:encoder.encode(context)},await key(version),encoder.encode(value));
  return {ciphertext:base64(new Uint8Array(ciphertext)),iv:base64(iv),version};
}
export async function decrypt(ciphertext:string,iv:string,version:number,context:string):Promise<string>{
  return new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:unbase64(iv),additionalData:encoder.encode(context)},await key(version),unbase64(ciphertext)));
}
