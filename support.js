import {api,esc,icon,newId,storage,toast,date,statusPill} from './shared.js';
import {assistantReply,questionKey} from './assistant-core.mjs';
const $=s=>document.querySelector(s);
const secret=()=>[...crypto.getRandomValues(new Uint8Array(32))].map(x=>x.toString(16).padStart(2,'0')).join('');
const privateLink=(type,token)=>new URL('./',location.href).href+'#'+type+'='+token;
let hooks,chat=null,timer=null,threadBusy=false,threadSequence=0,pendingMessage=null,enquiryDraft={},enquiryRequest=null,faqs=[],products=[];
let assistantJourney=false;
export const assistantBackActive=()=>assistantJourney;
let botSession=storage('session','virex_bot_session')||newId(),conversation=[],counts=new Map(),reported=new Set();
storage('session','virex_bot_session',botSession);
export const threadHTML=(title='Chat with the Virex team')=>`<section class="private-chat"><div class="row between"><h3>${title}</h3><span class="pill neutral">Private</span></div><p class="tiny muted">The team replies here. Keep your private link to return. Messages do not change your order or payment status.</p><button class="link-button tiny" data-support="older" id="older-messages" hidden>Load earlier messages</button><div id="thread-messages" class="thread-messages" aria-live="polite"><p class="tiny muted">Loading conversation…</p></div><p id="thread-status" class="tiny muted" role="status"></p><form id="thread-form"><label for="thread-text">Your message</label><textarea id="thread-text" name="text" maxlength="2000" required placeholder="Write to the Virex team…"></textarea><p id="thread-error" class="form-error" role="alert"></p><button class="btn primary full" type="submit">Send message ${icon('arrow')}</button></form></section>`;
function drawMessages(){const el=$('#thread-messages');if(!el||!chat)return;const nearBottom=el.scrollHeight-el.scrollTop-el.clientHeight<70;el.innerHTML=chat.messages.length?chat.messages.map(m=>`<article class="message-bubble ${m.sender==='team'?'team':'buyer'}"><strong>${m.sender==='team'?'Virex team':'You'}</strong><p>${esc(m.text)}</p><time>${esc(date(m.created_at))}</time></article>`).join(''):'<p class="tiny muted">Start the conversation. Your message will appear in the team’s inbox.</p>';if(nearBottom)el.scrollTop=el.scrollHeight;$('#older-messages').hidden=!chat.has_more;}
async function loadThread(older=false){
 if(!chat||threadBusy||!$('#thread-messages'))return;threadBusy=true;const sequence=threadSequence,current=chat;
 try{const data=await api(current.kind==='order'?'order_chat':'enquiry_thread',{token:current.token,...(older?{before:current.before}:{})});if(current!==chat||sequence!==threadSequence)return;
  chat.messages=older?[...data.messages,...chat.messages]:[...chat.messages.filter(m=>data.messages.length&&m.created_at<data.messages[0].created_at),...data.messages];
  chat.messages=[...new Map(chat.messages.map(m=>[m.id,m])).values()];if(older||!current.before){chat.before=data.before;chat.has_more=data.has_more;}else if(!chat.messages.length){chat.before=data.before;chat.has_more=data.has_more;}
  drawMessages();$('#thread-status').textContent='Messages up to date · The team replies when available.';
 }catch(e){if(current===chat&&$('#thread-status'))$('#thread-status').textContent=e.message;}finally{threadBusy=false;}
}
export function openPrivateChat(kind,token){stopPrivateChat();chat={kind,token,messages:[],has_more:false,before:null};loadThread();timer=setInterval(()=>{if(!document.hidden&&$('#sheet')?.open&&$('#thread-messages'))loadThread();},10000);}
export function stopPrivateChat(){clearInterval(timer);timer=null;chat=null;pendingMessage=null;threadSequence++;}
export function setAssistantData(data,catalogue){faqs=data||[];products=catalogue||[];}
export function enquiryForm(subject=''){
 hooks.modal('Enquiries & support',`<p class="muted">Tell us what you need help with. Your enquiry goes to the private team inbox, and the team can reply to the email you provide or your private enquiry thread.</p><form id="enquiry-form"><div class="form-grid"><div class="field"><label for="enquiry-name">Full name</label><input id="enquiry-name" name="name" autocomplete="name" required minlength="2" maxlength="120" value="${esc(enquiryDraft.name)}"></div><div class="field"><label for="enquiry-email">Email for replies</label><input id="enquiry-email" name="email" type="email" autocomplete="email" maxlength="200" required value="${esc(enquiryDraft.email)}"></div></div><div class="form-grid"><div class="field"><label for="enquiry-category">Topic</label><select id="enquiry-category" name="category">${['Product question','Sizing','Delivery','Payment','Returns','Other'].map(x=>`<option ${enquiryDraft.category===x?'selected':''}>${x}</option>`).join('')}</select></div><div class="field"><label for="enquiry-order">Order ID (optional)</label><input id="enquiry-order" name="order_reference" maxlength="40" placeholder="VX-…" value="${esc(enquiryDraft.order_reference)}"></div></div><div class="field"><label for="enquiry-subject">Subject</label><input id="enquiry-subject" name="subject" required minlength="3" maxlength="160" value="${esc(subject||enquiryDraft.subject)}"></div><div class="field"><label for="enquiry-message">Your question</label><textarea id="enquiry-message" name="message" required maxlength="2000">${esc(enquiryDraft.message)}</textarea></div><div class="honeypot" aria-hidden="true"><label>Website<input name="website" tabindex="-1" autocomplete="off"></label></div><p class="tiny muted">Please do not include login codes, passwords or private tracking links. Your details are used to respond to this enquiry.</p><p class="form-error" id="enquiry-error" role="alert"></p><button class="btn primary full" type="submit">Send enquiry ${icon('arrow')}</button></form>`);
}
async function enquiryReceipt(data,token){hooks.modal('Your private enquiry',`<p class="eyebrow gold">${esc(data.reference)}</p><h3 class="support-subject">${esc(data.subject)}</h3><p>${statusPill(data.status)}</p><p class="enquiry-original">${esc(data.message)}</p><p class="notice">Keep this private enquiry link. You can return here for replies, and the team can also contact the email you provided.</p><button class="btn full" data-support="copy-enquiry" data-token="${token}">${icon('link')}Copy private enquiry link</button>${threadHTML('Enquiry conversation')}`);openPrivateChat('enquiry',token);}
export async function openEnquiry(token){try{const r=await api('enquiry_thread',{token});enquiryReceipt(r.enquiry,token);}catch(e){toast(e.message,true);}}
function botActions(actions){return `<div class="assistant-actions">${(actions||[]).map(a=>`<button class="btn small" data-support="bot-action" data-go="${esc(a.name)}">${esc(a.label)}</button>`).join('')}</div>`;}
function drawBot(){const el=$('#assistant-messages');if(!el)return;el.innerHTML=conversation.map(m=>`<article class="message-bubble ${m.role==='user'?'buyer':'team'}"><strong>${m.role==='user'?'You':'Virex Assistant'}</strong><p>${esc(m.text)}</p>${m.role==='assistant'?botActions(m.actions):''}</article>`).join('');el.scrollTop=el.scrollHeight;}
export function assistant(){
 assistantJourney=false;
 if(!conversation.length)conversation.push({role:'assistant',text:'Hello, welcome to Virex. I can help with shopping, tracking, order chat and enquiries. What can I help you with?',actions:assistantReply('').actions});
 hooks.modal('Virex Assistant',`<p class="tiny muted">Guided store assistant · For account-specific help, use your private order chat or an enquiry.</p><div class="assistant-messages" id="assistant-messages" aria-live="polite"></div><form id="assistant-form"><label for="assistant-text">Ask Virex</label><div class="row"><input id="assistant-text" name="text" autocomplete="off" required maxlength="500" placeholder="How do I track my order?"><button type="submit" class="icon-btn" aria-label="Send question">${icon('arrow')}</button></div></form>`);drawBot();$('#assistant-text').focus();
}
async function botQuestion(value){
 const question=value.trim();if(!question)return;const reply=assistantReply(question,{faqs,products}),key=questionKey(question);conversation.push({role:'user',text:question});
 const times=(counts.get(key)||0)+1;counts.set(key,times);conversation.push({role:'assistant',...reply});if(conversation.length>60)conversation=conversation.slice(-60);drawBot();
 if(times>1&&!['greeting','thanks','empty'].includes(reply.intent)){
  if(!reported.has(key)){try{await api('bot_check',{session_id:botSession,question,conversation:conversation.slice(-12),reason:reply.intent==='unknown'?'unanswered':'repeated'});reported.add(key);conversation.push({role:'assistant',text:'I’ve added this repeated question to the team’s Bot checks so they can improve my answers. For a personal response, please fill in the enquiry form.',actions:[{name:'enquiry',label:'Send an enquiry for a reply'}]});}catch{conversation.push({role:'assistant',text:'You’ve asked about this again. Please use the enquiry form so the team can help you directly.',actions:[{name:'enquiry',label:'Open enquiry form'}]});}drawBot();
  }else{conversation.push({role:'assistant',text:'This question is already in the team’s Bot checks. Please send an enquiry if you need a direct reply.',actions:[{name:'enquiry',label:'Open enquiry form'}]});drawBot();}
 }
}
export function initSupport(callbacks){hooks=callbacks;
 $('#sheet').addEventListener('close',()=>{stopPrivateChat();assistantJourney=false;});
 document.addEventListener('click',e=>{const b=e.target.closest('[data-support]');if(!b)return;const action=b.dataset.support;if(action==='back-assistant'){assistant();return;}if(action==='enquiry')enquiryForm();if(action==='assistant')assistant();if(action==='older')loadThread(true);if(action==='copy-enquiry'){navigator.clipboard.writeText(privateLink('enquiry',b.dataset.token)).then(()=>toast('Private enquiry link copied.')).catch(()=>hooks.modal('Your private enquiry link',`<p class="tracking-link">${esc(privateLink('enquiry',b.dataset.token))}</p>`));}if(action==='bot-action'){const go=b.dataset.go;if(['track','enquiry','cart'].includes(go))assistantJourney=true;if(go==='track')hooks.trackForm();if(go==='enquiry')enquiryForm();if(go==='cart')hooks.showCart();if(go==='collection'){$('#sheet').close();location.hash='collection';$('#collection').scrollIntoView();}if(go==='terms')location.href='terms.html';}});
 document.addEventListener('submit',async e=>{
  const f=e.target;if(f.id==='assistant-form'){e.preventDefault();const q=f.elements.text.value;f.reset();botQuestion(q);}
  if(f.id==='enquiry-form'){
   e.preventDefault();const btn=f.querySelector('[type=submit]');btn.disabled=true;$('#enquiry-error').textContent='';enquiryDraft=Object.fromEntries(new FormData(f));
   if(!enquiryRequest)enquiryRequest={request_id:newId(),token:secret()};
   try{const r=await api('submit_enquiry',{...enquiryDraft,...enquiryRequest});enquiryDraft={};enquiryRequest=null;storage('local','virex_enquiry_receipts',[{reference:r.enquiry.reference,token:r.token},...(storage('local','virex_enquiry_receipts')||[])].slice(0,10));enquiryReceipt(r.enquiry,r.token);}catch(err){if($('#enquiry-error'))$('#enquiry-error').textContent=err.message;}finally{btn.disabled=false;}
  }
  if(f.id==='thread-form'){
   e.preventDefault();if(!chat)return;const current=chat,btn=f.querySelector('button[type=submit]'),message=f.elements.text.value;btn.disabled=true;$('#thread-error').textContent='';
   if(!pendingMessage||pendingMessage.text!==message||pendingMessage.token!==chat.token)pendingMessage={message_id:newId(),text:message,token:chat.token};
   try{await api(current.kind==='order'?'send_order_message':'send_enquiry_message',pendingMessage);if(current!==chat)return;f.reset();pendingMessage=null;await loadThread();}catch(err){if(current===chat&&$('#thread-error'))$('#thread-error').textContent=err.message;}finally{btn.disabled=false;}
  }
 });
}
