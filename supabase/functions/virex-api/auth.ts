import {ADMINS,fail,text,uuid,validEmail} from './domain.mjs';

// Virex login grants are separate from the other apps using Supabase Auth.
// A Supabase token issued by another app is insufficient to open this dashboard.
export function virexAuth(ctx){
 const {db,checked,hash,limit,json,authClient,secret}=ctx;
 const bearer=req=>(req.headers.get('authorization')||'').replace(/^Bearer /i,'');
 function sessionId(token){try{const middle=token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/');return JSON.parse(atob(middle)).session_id;}catch{fail('Please sign in again.',401);}}
 async function grantFor(session){
  const sid=sessionId(session.access_token);if(!uuid(sid))fail('Please sign in again.',401);
  const grant=checked(await db.from('Virex').select('*').eq('kind','settings').eq('data->>type','admin_session').eq('data->>token_hash',await hash('virex-session:'+sid)).maybeSingle());
  const expires=Date.parse(grant?.data?.expires_at||'');
  if(!grant||!Number.isFinite(expires)||expires<Date.now())fail('Please sign in to Virex again.',401);return grant;
 }
 async function requireAdmin(req){
  const token=bearer(req);if(!token)fail('Please sign in.',401);
  const {data,error}=await db.auth.getUser(token);
  if(error||!data.user||!data.user.email_confirmed_at||!ADMINS.includes((data.user.email||'').toLowerCase()))fail('Admin access required.',403);
  const grant=await grantFor({access_token:token});if(grant.data.email!==data.user.email.toLowerCase())fail('Admin access required.',403);
  return {...data.user,virex_grant:grant.id};
 }
 const encryptionKey=async()=>crypto.subtle.importKey('raw',new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode('virex-email:'+secret))),{name:'AES-GCM'},false,['encrypt','decrypt']);
 async function mailConfig(){
  const envKey=Deno.env.get('VIREX_RESEND_API_KEY'),envFrom=Deno.env.get('VIREX_EMAIL_FROM');if(envKey&&envFrom)return {key:envKey,from:envFrom};
  const row=checked(await db.from('Virex').select('data').eq('kind','settings').eq('data->>type','email_sender').maybeSingle());if(!row)return null;
  try{const bytes=Uint8Array.from(atob(row.data.encrypted_key),x=>x.charCodeAt(0)),iv=Uint8Array.from(atob(row.data.iv),x=>x.charCodeAt(0));const value=await crypto.subtle.decrypt({name:'AES-GCM',iv},await encryptionKey(),bytes);return {from:row.data.from,key:new TextDecoder().decode(value)};}catch{fail('The Virex sender needs to be configured again.',503);}
 }
 async function sendCode(config,email,code){
  const r=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+config.key,'Content-Type':'application/json'},body:JSON.stringify({from:'Virex <'+config.from+'>',to:[email],subject:'Your Virex admin login code',html:`<div style="background:#f7f0e4;padding:35px;font-family:Arial;color:#211b12"><p style="letter-spacing:5px;color:#946c27">VIREX</p><h1 style="font-family:Georgia;font-size:32px">Your private admin login</h1><p>Enter this one-time code on the Virex admin page:</p><p style="font-size:34px;letter-spacing:8px;font-weight:bold">${code}</p><p>This Virex request expires in 10 minutes. It is separate from your other applications.</p><p>If you did not request this code, ignore this email. Never share your code.</p></div>`,text:`VIREX\nYour Virex admin login code: ${code}\nThis request expires in 10 minutes. Use it only on the Virex admin page. Never share this code.`})});
  if(!r.ok){console.error('Virex mail provider status:',r.status);fail('The Virex email provider could not send your code. Check Email settings or try again shortly.',503);}
 }
 return {requireAdmin,async action(action,b,ipHash,req){
  if(action==='auth_info'){const config=await mailConfig();return json({dedicated_sender:!!config});}
  if(action==='request_otp'){
   const email=text(b.email,200).toLowerCase();if(!ADMINS.includes(email))fail('This email is not authorised for Virex admin access.',403);
   await limit('otp-ip:'+ipHash,8,3600);await limit('otp-email:'+email,1,60);
   const created=await db.auth.admin.createUser({email,email_confirm:true});if(created.error&&!/already|registered|exists/i.test(created.error.message))fail('Admin account could not be prepared.',503);
   const id=crypto.randomUUID(),config=await mailConfig();let code_hash=null;
   if(config){
    const r=await db.auth.admin.generateLink({type:'magiclink',email});if(r.error||!r.data?.properties?.email_otp)fail('Could not prepare the Virex login code.',503);
    const code=r.data.properties.email_otp;code_hash=await hash('virex-otp:'+id+':'+email+':'+code+':'+secret);await sendCode(config,email,code);
   }else{
    const {error}=await authClient().auth.signInWithOtp({email,options:{shouldCreateUser:false,emailRedirectTo:'https://profkingkeys.github.io/Prototype-Test/admin.html'}});
    if(error){console.error('Virex OTP:',error.code,error.status);fail('The email provider could not send a code. Please try again shortly.',503);}
   }
   // Creating a fresh request invalidates older Virex challenges for this email.
   checked(await db.from('Virex').delete().eq('kind','settings').eq('data->>type','otp_challenge').eq('data->>email',email));
   checked(await db.from('Virex').insert({id,kind:'settings',data:{type:'otp_challenge',email,code_hash,expires_at:new Date(Date.now()+600000).toISOString()}}));
   return json({allowed:true,challenge:id,dedicated_sender:!!config,message:'A Virex login code has been requested for your admin email.'});
  }
  if(action==='verify_otp'){
   const email=text(b.email,200).toLowerCase();if(!ADMINS.includes(email)||!uuid(b.challenge)||!/^\d{6,10}$/.test(b.code||''))fail('The Virex code could not be verified.');
   await limit('verify:'+ipHash,12,600);await limit('verify-challenge:'+b.challenge,6,600);
   const c=checked(await db.from('Virex').select('*').eq('id',b.challenge).eq('kind','settings').eq('data->>type','otp_challenge').maybeSingle());
   if(!c||c.data.email!==email||new Date(c.data.expires_at).getTime()<Date.now())fail('Your Virex request expired. Request a new code.');
   if(c.data.code_hash&&c.data.code_hash!==await hash('virex-otp:'+b.challenge+':'+email+':'+b.code+':'+secret))fail('Invalid Virex code.');
   const {data,error}=await authClient().auth.verifyOtp({email,token:b.code,type:'email'});if(error||!data.session)fail('Invalid or expired code. Request a new code.');
   const consumed=checked(await db.from('Virex').delete().eq('id',c.id).eq('kind','settings').select('id'));if(!consumed.length)fail('This request has already been used.');
   checked(await db.from('Virex').insert({kind:'settings',data:{type:'admin_session',token_hash:await hash('virex-session:'+sessionId(data.session.access_token)),email,expires_at:new Date(Date.now()+86400000).toISOString()}}));
   return json({session:data.session});
  }
  if(action==='refresh_session'){
   const {data,error}=await authClient().auth.refreshSession({refresh_token:text(b.refresh_token,1000)});if(error||!data.session||!ADMINS.includes((data.user?.email||'').toLowerCase()))fail('Please sign in again.',401);
   await grantFor(data.session);return json({session:data.session});
  }
  if(action==='mail_settings'||action==='save_mail_settings'||action==='sign_out'){
   const admin=await requireAdmin(req);
   if(action==='sign_out'){checked(await db.from('Virex').delete().eq('id',admin.virex_grant).eq('kind','settings'));await db.auth.admin.signOut(bearer(req),'local');return json({ok:true});}
   if(action==='mail_settings'){const config=await mailConfig();return json({configured:!!config,from:config?.from||''});}
   const from=text(b.from,200).toLowerCase(),key=text(b.key,500);if(!validEmail(from)||!/^re_[A-Za-z0-9_-]+$/.test(key))fail('Enter a verified sender email and a valid Resend API key.');
   const iv=crypto.getRandomValues(new Uint8Array(12)),encrypted=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv},await encryptionKey(),new TextEncoder().encode(key)));
   const old=checked(await db.from('Virex').select('id').eq('kind','settings').eq('data->>type','email_sender').maybeSingle());
   checked(await db.from('Virex').upsert({id:old?.id||crypto.randomUUID(),kind:'settings',data:{type:'email_sender',from,iv:btoa(String.fromCharCode(...iv)),encrypted_key:btoa(String.fromCharCode(...encrypted))}}));
   return json({configured:true,from});
  }
  return null;
 }};
}
