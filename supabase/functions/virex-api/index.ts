import {virexAuth} from './auth.ts';
import {supportHandlers} from './support.ts';
import { createClient } from 'npm:@supabase/supabase-js@2.95.3';
import { ADMINS, fail, text, uuid, publicProduct, validateProduct, priceOrder, manualOrderUpdate, trackingView } from './domain.mjs';

const URL=Deno.env.get('SUPABASE_URL')!;
const SECRET=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')||'{}').default;
const ANON=Deno.env.get('SUPABASE_ANON_KEY')||JSON.parse(Deno.env.get('SUPABASE_PUBLISHABLE_KEYS')||'{}').default;
const opts={auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}};
const db=createClient(URL,SECRET,opts);
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Access-Control-Allow-Methods':'POST, OPTIONS','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
const hash=async v=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(v)))].map(x=>x.toString(16).padStart(2,'0')).join('');
const authClient=()=>createClient(URL,ANON,opts);
const json=(d,status=200)=>new Response(JSON.stringify(d),{status,headers:{...cors,'Content-Type':'application/json'}});
function checked(r){if(r.error){console.error('Virex database operation:',r.error.code||r.error.status);fail('The request could not be saved. Please try again.',500);}return r.data;}
async function limit(key,max,seconds){if(!checked(await db.rpc('virex_rate_limit',{p_key:key,p_max:max,p_seconds:seconds})))fail('Please wait before trying again.',429);}
async function getRecord(id,kind){if(!uuid(id))fail('Invalid record.');const r=checked(await db.from('Virex').select('*').eq('id',id).eq('kind',kind).maybeSingle());if(!r)fail('Record not found.',404);return r;}
async function audit(actor,action,entity,details={}){checked(await db.from('Virex').insert({kind:'audit',data:{actor,action,entity,...details}}));}
async function saveVersion(old,data){const result=checked(await db.from('Virex').update({data,version:old.version+1,updated_at:new Date().toISOString()}).eq('id',old.id).eq('version',old.version).select().maybeSingle());if(!result)fail('Another admin changed this record. Reload it and try again.',409);return result;}
const auth=virexAuth({db,checked,hash,limit,json,authClient,secret:SECRET});
const requireAdmin=auth.requireAdmin;
const support=supportHandlers({db,checked,hash,limit,json,getRecord,saveVersion,audit,faqId:async id=>{const h=await hash('virex-faq:'+id);return h.slice(0,8)+'-'+h.slice(8,12)+'-4'+h.slice(13,16)+'-8'+h.slice(17,20)+'-'+h.slice(20,32);}});

Deno.serve(async req=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers:cors});
 if(req.method!=='POST')return json({error:'Use POST.'},405);
 try{
  const ip=req.headers.get('cf-connecting-ip')||req.headers.get('x-forwarded-for')?.split(',')[0].trim()||'unknown';
  const ipHash=await hash(ip+':virex:'+new Date().toISOString().slice(0,10));
  const multipart=req.headers.get('content-type')?.includes('multipart/form-data');
  if(multipart){
   const admin=await requireAdmin(req);
   if(Number(req.headers.get('content-length')||0)>300000)fail('Image must be smaller than 256 KB.');
   const f=await req.formData();const file=f.get('file');
   if(!(file instanceof File)||file.size>262144||!['image/jpeg','image/png','image/webp'].includes(file.type))fail('Upload a JPG, PNG or WebP under 256 KB.');
   const bytes=new Uint8Array(await file.arrayBuffer());const valid=(file.type==='image/jpeg'&&bytes[0]===255&&bytes[1]===216)||(file.type==='image/png'&&bytes[0]===137&&bytes[1]===80)||(file.type==='image/webp'&&new TextDecoder().decode(bytes.slice(0,4))==='RIFF'&&new TextDecoder().decode(bytes.slice(8,12))==='WEBP');
   if(!valid)fail('File contents do not match its image type.');
   const path='products/'+crypto.randomUUID()+'.'+(file.type==='image/jpeg'?'jpg':file.type.split('/')[1]);
   checked(await db.storage.from('virex-assets').upload(path,bytes,{contentType:file.type,upsert:false}));
   await audit(admin.email,'Image uploaded',path);
   return json({url:db.storage.from('virex-assets').getPublicUrl(path).data.publicUrl});
  }
  if(Number(req.headers.get('content-length')||0)>100000)fail('Request too large.',413);
  const raw=await req.text();if(raw.length>100000)fail('Request too large.',413);
  let b;try{b=JSON.parse(raw);}catch{fail('Invalid request.');}const action=text(b.action,40);
  if(action==='catalog'){
   const rows=checked(await db.from('Virex').select('*').eq('kind','product').eq('data->>visibility','published').order('created_at').limit(1000));
   const faqs=checked(await db.from('Virex').select('data').eq('kind','faq').eq('data->>visibility','published').limit(100));
   return json({products:rows.map(publicProduct).sort((a,c)=>(a.sort||0)-(c.sort||0)),assistant_faqs:faqs.map(r=>({question:r.data.question,answer:r.data.answer}))});
  }
  const authResult=await auth.action(action,b,ipHash,req);if(authResult)return authResult;
  const supportResult=await support.publicAction(action,b,ipHash);if(supportResult)return supportResult;
  if(action==='place_order'){
   await limit('order:'+ipHash,10,3600);
   const products=checked(await db.from('Virex').select('*').eq('kind','product').eq('data->>visibility','published'));
   const order=priceOrder(b,products);const trackingHash=await hash(b.tracking_token);
   const existing=checked(await db.from('Virex').select('*').eq('kind','order').eq('data->>request_id',b.request_id).maybeSingle());
   if(existing){if(existing.data.tracking_hash!==trackingHash)fail('Duplicate request.',409);return json({order:trackingView(existing),token:b.tracking_token});}
   const id=crypto.randomUUID();const reference='VX-'+id.replaceAll('-','').slice(0,10).toUpperCase();
   const row=checked(await db.from('Virex').insert({id,kind:'order',data:{...order,reference,tracking_hash:trackingHash,history:[{at:new Date().toISOString(),actor:'Customer',changes:{order_status:{from:null,to:'pending_review'},payment_status:{from:null,to:'unpaid'}}}]}}).select().single());
   await audit('Customer','New order received',reference);
   return json({order:trackingView(row),token:b.tracking_token},201);
  }
  if(action==='track_order'){
   await limit('track:'+ipHash,60,300);if(!/^[a-f0-9]{64}$/.test(b.token||''))fail('Invalid private tracking link.',404);
   const row=checked(await db.from('Virex').select('*').eq('kind','order').eq('data->>tracking_hash',await hash(b.token)).maybeSingle());if(!row)fail('Order not found. Check your private tracking link.',404);return json({order:trackingView(row)});
  }
  if(action==='visit'){
   if(!uuid(b.session_id)||!uuid(b.visitor_id))fail('Invalid visitor session.');
   await limit('visit:'+ipHash,100,60);
   const old=checked(await db.from('Virex').select('id,kind,data').eq('id',b.session_id).maybeSingle());
   const ua=req.headers.get('user-agent')||'';if(/bot|spider|crawler|headless/i.test(ua))return json({ok:true});
   const device=/ipad|tablet/i.test(ua)?'Tablet':/mobile|iphone|android/i.test(ua)?'Mobile':'Desktop';
   const browser=/edg/i.test(ua)?'Edge':/firefox/i.test(ua)?'Firefox':/chrome|crios/i.test(ua)?'Chrome':/safari/i.test(ua)?'Safari':'Other';
   const source=['X','WhatsApp','Instagram','Search','Direct','Other'].includes(b.source)?b.source:'Direct';
   const section=['Home','Collection','Craftsmanship','Flagship','Contact'].includes(b.section)?b.section:'Home';
   const data={visitor_id:b.visitor_id,source,device,browser,section,visible:b.visible!==false,ip_hash:ipHash};
   if(old){if(old.kind!=='visit'||old.data.visitor_id!==b.visitor_id)return json({ok:true});checked(await db.from('Virex').update({data:{...old.data,section,visible:data.visible},updated_at:new Date().toISOString()}).eq('id',old.id).eq('kind','visit'));}
   else checked(await db.from('Virex').insert({id:b.session_id,kind:'visit',data}));
   return json({ok:true});
  }
  const admin=await requireAdmin(req);
  const adminResult=await support.adminAction(action,b,admin);if(adminResult)return adminResult;
  if(action==='admin_data'){
   const products=checked(await db.from('Virex').select('*').eq('kind','product').order('created_at').limit(1000));
   const stats=checked(await db.rpc('virex_snapshot',{p_days:[7,30,90,365].includes(b.days)?b.days:7}));
   const orders=checked(await db.rpc('virex_find_orders',{p_query:text(b.query,160),p_status:text(b.status,40),p_payment:text(b.payment,40),p_limit:50,p_offset:Math.max(0,Number(b.offset)||0)}));
   const inbox=checked(await db.rpc('virex_inbox',{p_kind:'order',p_query:'',p_status:'',p_offset:0}));
   return json({admin:{email:admin.email},products,stats,orders,inbox_counts:inbox.counts});
  }
  if(action==='orders_page')return json(checked(await db.rpc('virex_find_orders',{p_query:text(b.query,160),p_status:text(b.status,40),p_payment:text(b.payment,40),p_limit:50,p_offset:Math.max(0,Number(b.offset)||0)})));
  if(action==='save_product'){
   const old=b.id?await getRecord(b.id,'product'):null;
   if(old&&b.version!==old.version)fail('This product changed. Reload before editing.',409);
   const data=validateProduct(b.product,old?.data);
   const row=old?await saveVersion(old,data):checked(await db.from('Virex').insert({kind:'product',data}).select().single());
   await audit(admin.email,old?'Product updated':'Product added',data.name,{record_id:row.id,changes:old?{price:{from:old.data.price,to:data.price},stock:{from:old.data.stock,to:data.stock},visibility:{from:old.data.visibility,to:data.visibility}}:{created:true}});return json({product:row});
  }
  if(action==='save_order'){
   const old=await getRecord(b.id,'order');if(b.version!==old.version)fail('This order changed. Reload before editing.',409);
   const {next,changes}=manualOrderUpdate(b.changes||{},old.data,admin.email,new Date().toISOString());
   if(!Object.keys(changes).length)return json({order:old});
   const row=await saveVersion(old,next);await audit(admin.email,'Order updated manually',old.data.reference,{changes,record_id:row.id});return json({order:row});
  }
  if(action==='order_detail')return json({order:await getRecord(b.id,'order')});
  fail('Action not found.',404);
 }catch(error){const status=error.status||500;if(status===500)console.error('Virex request error:',error.message);return json({error:status===500?'Something went wrong. Please try again.':error.message},status);}
});
