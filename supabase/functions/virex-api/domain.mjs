export const ADMINS = ['offiongv59@gmail.com', 'kingsleyumoh03@gmail.com'];
export const SIZES = ['M','L','XL','XXL','XXXL'];
export const ORDER_STATES = ['pending_review','needs_details','accepted','preparing','dispatched','completed','cancelled'];
export const PAYMENT_STATES = ['unpaid','awaiting_confirmation','paid','refunded'];
export const TRIAGE_STATES = ['review','ready_to_accept','needs_details','stock_check','on_hold'];
export function fail(message, status=400) { throw Object.assign(new Error(message), {status}); }
export const text = (v, max=200) => String(v??'').trim().slice(0,max);
export const cash = v => { const n=Number(v); if(!Number.isFinite(n)||n<0||n>100000000) fail('Enter a valid non-negative amount.'); return Math.round(n*100)/100; };
export const uuid = v => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v||'');
export function publicProduct(row) {
 const d=row.data; return {id:row.id,version:row.version,created_at:row.created_at,...d};
}
export function validateProduct(input, old={}) {
 const name=text(input.name,120), slug=text(input.slug||old.slug||name.toLowerCase().replace(/[^a-z0-9]+/g,'-'),120);
 if(name.length<3 || !/^[a-z0-9-]+$/.test(slug)) fail('A product name and valid slug are required.');
 const images=(Array.isArray(input.images)?input.images:[]).slice(0,12).map(x=>text(x,1200));
 if(!images.length || images.some(x=>!(/^(https:\/\/|assets\/products\/)/.test(x)))) fail('Add at least one valid product image.');
 const stock={}; for(const s of SIZES){ const n=input.stock?.[s]; if(n===null||n===''||n===undefined) stock[s]=null;else {if(!Number.isSafeInteger(Number(n))||Number(n)<0||Number(n)>100000)fail('Stock must be a whole number.');stock[s]=Number(n);} }
 const visibility=['published','draft','archived'].includes(input.visibility)?input.visibility:'draft';
 return {slug,name,description:text(input.description,2000),price:cash(input.price),images,category:text(input.category||'Kaftans',80),tag:text(input.tag||'Signature',30),featured:!!input.featured,visibility,track_stock:!!input.track_stock,stock,sort:Number.isFinite(Number(input.sort))?Number(input.sort):99};
}
export function priceOrder(input, products) {
 if(!uuid(input.request_id)||!/^[a-f0-9]{64}$/.test(input.tracking_token||'')) fail('Invalid order request. Refresh and try again.');
 const c=input.customer||{};const customer={name:text(c.name,120),email:text(c.email,200).toLowerCase(),address:text(c.address,600),notes:text(c.notes,1500)};
 if(customer.name.length<2||!validEmail(customer.email)||customer.address.length<8)fail('Enter your name, email and delivery address.');
 if(input.website)fail('Unable to submit this order.');
 if(!Array.isArray(input.items)||!input.items.length||input.items.length>20)fail('Choose between 1 and 20 items.');
 const merged=new Map();
 for(const l of input.items){if(!uuid(l.product_id)||!SIZES.includes(l.size)||!Number.isInteger(l.qty)||l.qty<1||l.qty>20)fail('Check item sizes and quantities.');const k=l.product_id+':'+l.size;const current=merged.get(k);if(current)current.qty+=l.qty;else merged.set(k,{...l});}
 const items=[...merged.values()].map(l=>{if(l.qty>20)fail('Maximum 20 of one size per order.');const p=products.find(r=>r.id===l.product_id&&r.data.visibility==='published');if(!p)fail('A selected garment is no longer available.');const d=p.data;if(l.expected_price!==undefined && Number(l.expected_price)!==Number(d.price))fail('A product price has changed. Refresh the collection and review your order.',409);if(d.track_stock && Number(d.stock?.[l.size]??0)<l.qty)fail(d.name+' is unavailable in size '+l.size+'.');return {product_id:p.id,name:d.name,image:d.images[0],size:l.size,qty:l.qty,unit_price:d.price,line_total:cash(d.price*l.qty)};});
 return {request_id:input.request_id,customer,items,subtotal:cash(items.reduce((s,l)=>s+l.line_total,0)),delivery_fee:0,delivery_confirmed:false,order_status:'pending_review',payment_status:'unpaid',triage:'review',refund_amount:0,public_note:'',internal_note:'',history:[]};
}
export function manualOrderUpdate(input, old, actor, now) {
 // There is intentionally no state machine, background transition or payment
 // inference. All business fields below require an explicit admin save.
 const next={...old};
 for(const [key,states] of [['order_status',ORDER_STATES],['payment_status',PAYMENT_STATES],['triage',TRIAGE_STATES]]){
   if(input[key]!==undefined){if(!states.includes(input[key]))fail('Invalid '+key);next[key]=input[key];}
 }
 if(input.delivery_fee!==undefined)next.delivery_fee=cash(input.delivery_fee);
 if(input.delivery_confirmed!==undefined)next.delivery_confirmed=!!input.delivery_confirmed;
 if(input.refund_amount!==undefined){next.refund_amount=cash(input.refund_amount);if(next.refund_amount>old.subtotal)fail('Product refund cannot exceed item subtotal.');}
 for(const k of ['internal_note','public_note'])if(input[k]!==undefined)next[k]=text(input[k],3000);
 const changes={}; for(const k of ['order_status','payment_status','triage','delivery_fee','delivery_confirmed','refund_amount','internal_note','public_note'])if(next[k]!==old[k])changes[k]={from:old[k],to:next[k]};
 next.history=[...(old.history||[]),{at:now,actor,changes}];
 if(next.payment_status==='paid'&&old.payment_status!=='paid')next.payment_confirmed_at=now;
 if(next.history.length>500)fail('Order history limit reached; contact support.');
 return {next,changes};
}
export function revenue(order){return order.payment_status==='paid'?Math.max(0,order.subtotal-(order.refund_amount||0)):0;}
export function trackingView(row){const d=row.data;return {reference:d.reference,created_at:row.created_at,updated_at:row.updated_at,items:d.items,subtotal:d.subtotal,delivery_fee:d.delivery_fee,delivery_confirmed:d.delivery_confirmed,order_status:d.order_status,payment_status:d.payment_status,public_note:d.public_note,refund_amount:d.refund_amount};}
export const validEmail=v=>typeof v==='string'&&v.length<=200&&/^[^\s@<>\r\n]+@[^\s@<>\r\n]+\.[^\s@<>\r\n]+$/.test(v);
export function messageText(value){if(typeof value!=='string'||value.length>2000)fail('Use a message between 1 and 2,000 characters.');const v=text(value,2000);if(!v)fail('Write a message first.');return v;}
export function validateEnquiry(b){
 const name=text(b.name,120),email=text(b.email,200).toLowerCase(),subject=text(b.subject,160),message=messageText(b.message);
 if(name.length<2||!validEmail(email)||subject.length<3||b.website)fail('Enter your name, email, subject and message.');
 if(!uuid(b.request_id)||!/^[a-f0-9]{64}$/.test(b.token||''))fail('Refresh the page and try again.');
 const category=['Product question','Sizing','Delivery','Payment','Returns','Other'].includes(b.category)?b.category:'Other';
 return {request_id:b.request_id,name,email,subject,message,category,order_reference:text(b.order_reference,40),status:'open'};
}
export const publicMessage=r=>({id:r.id,text:r.data.text,sender:r.data.sender==='team'?'team':'buyer',created_at:r.created_at});
export function redactConversation(value){return text(value,2000).replace(/https?:\/\/\S+/gi,'[link removed]').replace(/[a-f0-9]{64}/gi,'[private link removed]').replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g,'[email removed]').replace(/(?:\+?\d[\d ()-]{6,}\d)/g,'[number removed]');}
export function validateBotCheck(b){
 if(!uuid(b.session_id))fail('Invalid assistant session.');
 const question=redactConversation(b.question).slice(0,500);if(question.length<2)fail('Add a question.');
 const conversation=(Array.isArray(b.conversation)?b.conversation:[]).slice(-12).map(m=>({role:m.role==='user'?'user':'assistant',text:redactConversation(m.text)}));
 return {session_id:b.session_id,question,conversation,reason:b.reason==='unanswered'?'unanswered':'repeated',status:'open',resolution:''};
}
