import {fail,text,uuid,messageText,validateEnquiry,publicMessage,validateBotCheck,redactConversation} from './domain.mjs';
import originals from './original-catalog.json' with {type:'json'};

export function supportHandlers(ctx){
 const {db,checked,hash,limit,json,getRecord,saveVersion,audit}=ctx;
 const tokenRecord=async(kind,token)=>{
  if(!/^[a-f0-9]{64}$/.test(token||''))fail('Invalid private link.',404);
  const row=checked(await db.from('Virex').select('*').eq('kind',kind).eq('data->>tracking_hash',await hash(token)).maybeSingle());
  if(!row)fail('This private link was not found. Check it or send an enquiry.',404);return row;
 };
 async function thread(id,before){
  let q=db.from('Virex').select('*').eq('kind','message').eq('data->>entity_id',id).order('created_at',{ascending:false}).order('id',{ascending:false}).limit(51);
  if(before){if(!/^\d{4}-\d{2}-\d{2}T/.test(before))fail('Invalid message page.');q=q.lt('created_at',before);}
  const rows=checked(await q);return {messages:rows.slice(0,50).reverse().map(publicMessage),has_more:rows.length>50,before:rows[49]?.created_at||null};
 }
 async function addMessage(row,b,sender){
  if(!uuid(b.message_id))fail('Refresh the page and try again.');const value=messageText(b.text);
  const old=checked(await db.from('Virex').select('*').eq('id',b.message_id).maybeSingle());
  if(old){if(old.kind!=='message'||old.data.entity_id!==row.id||old.data.sender!==sender||old.data.text!==value)fail('Message request conflict.',409);return publicMessage(old);}
  const result=await db.from('Virex').insert({id:b.message_id,kind:'message',data:{entity_id:row.id,channel:row.kind,sender,text:value}}).select().single();
  if(result.error?.code==='23505'){const found=checked(await db.from('Virex').select('*').eq('id',b.message_id).single());if(found.kind==='message'&&found.data.entity_id===row.id&&found.data.sender===sender&&found.data.text===value)return publicMessage(found);fail('Message request conflict.',409);}
  return publicMessage(checked(result));
 }
 const enquiryView=r=>({reference:r.data.reference,subject:r.data.subject,category:r.data.category,message:r.data.message,status:r.data.status,created_at:r.created_at});
 return {
  async publicAction(action,b,ipHash){
   if(action==='order_chat'||action==='send_order_message'){
    await limit('chat-ip:'+ipHash,100,300);const row=await tokenRecord('order',b.token);
    if(action==='send_order_message'){await limit('chat:'+row.id,20,300);return json({message:await addMessage(row,b,'buyer')},201);}
    return json(await thread(row.id,b.before));
   }
   if(action==='submit_enquiry'){
    await limit('enquiry:'+ipHash,6,3600);const data=validateEnquiry(b),tracking_hash=await hash(b.token);
    const old=checked(await db.from('Virex').select('*').eq('kind','enquiry').eq('data->>request_id',data.request_id).maybeSingle());
    if(old){if(old.data.tracking_hash!==tracking_hash)fail('Duplicate enquiry.',409);return json({enquiry:enquiryView(old),token:b.token});}
    const id=crypto.randomUUID(),reference='VE-'+id.replaceAll('-','').slice(0,10).toUpperCase();
    const row=checked(await db.from('Virex').insert({id,kind:'enquiry',data:{...data,reference,tracking_hash}}).select().single());
    await audit('Customer','New enquiry',reference);return json({enquiry:enquiryView(row),token:b.token},201);
   }
   if(action==='enquiry_thread'||action==='send_enquiry_message'){
    await limit('enquiry-chat:'+ipHash,100,300);const row=await tokenRecord('enquiry',b.token);
    if(action==='send_enquiry_message'){await limit('enquiry-message:'+row.id,20,300);return json({message:await addMessage(row,b,'buyer')},201);}
    return json({enquiry:enquiryView(row),...await thread(row.id,b.before)});
   }
   if(action==='bot_check'){
    await limit('bot:'+ipHash,20,3600);const data=validateBotCheck(b),question_key=await hash(data.question.toLowerCase().replace(/[^\p{L}\p{N} ]/gu,'').replace(/\s+/g,' ').trim());
    const found=checked(await db.from('Virex').select('id').eq('kind','bot_check').eq('data->>session_id',data.session_id).eq('data->>question_key',question_key).maybeSingle());
    if(found)return json({recorded:true});
    const r=await db.from('Virex').insert({kind:'bot_check',data:{...data,question_key}});if(r.error?.code!=='23505')checked(r);
    return json({recorded:true});
   }
   return null;
  },
  async adminAction(action,b,admin){
   if(action==='inbox')return json(checked(await db.rpc('virex_inbox',{p_kind:['order','enquiry','bot_check'].includes(b.kind)?b.kind:'order',p_query:text(b.query,160),p_status:text(b.status,30),p_offset:Math.max(0,Number(b.offset)||0)})));
   if(action==='admin_thread'||action==='reply_thread'){
    if(!['order','enquiry'].includes(b.kind))fail('Invalid conversation.');const row=await getRecord(b.id,b.kind);
    if(action==='reply_thread'){const message=await addMessage(row,b,'team');await audit(admin.email,'Team message sent',row.data.reference);return json({message},201);}
    // Read receipts are communication metadata, independent of business statuses.
    if(!b.before){checked(await db.from('Virex').update({data:{...row.data,chat_read_at:new Date().toISOString()}}).eq('id',row.id).eq('version',row.version));}
    return json({record:{...row,data:{...row.data,tracking_hash:undefined}},...await thread(row.id,b.before)});
   }
   if(action==='save_enquiry'){
    const old=await getRecord(b.id,'enquiry');if(b.version!==old.version)fail('This enquiry changed. Reopen it before saving.',409);
    if(!['open','in_progress','resolved'].includes(b.status))fail('Choose a valid enquiry status.');
    const row=await saveVersion(old,{...old.data,status:b.status,internal_note:text(b.internal_note,2000)});await audit(admin.email,'Enquiry updated',old.data.reference);return json({enquiry:row});
   }
   if(action==='save_bot_check'){
    const old=await getRecord(b.id,'bot_check');if(b.version!==old.version)fail('This question changed. Reopen it before saving.',409);
    if(!['open','reviewed'].includes(b.status))fail('Choose a valid review status.');const answer=text(b.answer,1500);
    if(b.publish&&!answer)fail('Write an answer to publish.');
    if(b.publish){
     const id=old.id;checked(await db.from('Virex').upsert({id:await ctx.faqId(id),kind:'faq',data:{question:redactConversation(old.data.question),answer,visibility:'published',source_id:id}}));
    }else if(b.publish===false){checked(await db.from('Virex').delete().eq('id',await ctx.faqId(old.id)).eq('kind','faq'));}
    const row=await saveVersion(old,{...old.data,status:b.status,resolution:text(b.resolution,2000),answer,published:!!b.publish,reviewed_by:admin.email});await audit(admin.email,'Assistant question reviewed',old.data.question);return json({check:row});
   }
   if(action==='preview_reset'){
    const scope=b.scope==='full'?'full':'activity',cutoff=new Date().toISOString(),expires_at=new Date(Date.now()+120000).toISOString();
    const kinds=['order','message','enquiry','bot_check','visit','audit',...(scope==='full'?['product','faq']:[])];
    const counts={};for(const kind of kinds){const r=await db.from('Virex').select('*',{head:true,count:'exact'}).eq('kind',kind).lte('created_at',cutoff);checked(r);counts[kind]=r.count;}
    const row=checked(await db.from('Virex').insert({kind:'settings',data:{type:'reset_challenge',actor:admin.email,scope,cutoff,expires_at,counts}}).select().single());
    return json({challenge:row.id,scope,cutoff,expires_at,counts});
   }
   if(action==='reset_store'){
    if(!uuid(b.challenge)||b.confirmation!=='RESET VIREX')fail('Type RESET VIREX to confirm.');
    const result=checked(await db.rpc('virex_reset',{p_challenge:b.challenge,p_actor:admin.email,p_confirmation:b.confirmation,p_products:originals}));
    let files_removed=0,files_warning=false;
    if(result.scope==='full'){
     try{let more=true;while(more){const files=checked(await db.storage.from('virex-assets').list('products',{limit:100,sortBy:{column:'created_at',order:'asc'}}));const old=files.filter(f=>f.id&&f.created_at<=result.cutoff);if(!old.length)break;checked(await db.storage.from('virex-assets').remove(old.map(f=>'products/'+f.name)));files_removed+=old.length;more=files.length===100;}}catch{files_warning=true;}
    }
    return json({...result,files_removed,files_warning});
   }
   return null;
  }
 };
}
