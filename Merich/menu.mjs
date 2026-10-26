export const WHATSAPP_NUMBER='2347085277643';
export const DISPLAY_NUMBER='+234 708 527 7643';
export const MEALS=Object.freeze([
 {id:'jollof',name:'Jollof Rice & Chicken',description:'Richly seasoned jollof rice, paired with chicken.',image:'assets/jollof.webp'},
 {id:'fried-rice',name:'Fried Rice & Fish',description:'Golden vegetable rice with fried fish.',image:'assets/fried-rice.webp'},
 {id:'vegetable-soup',name:'Vegetable Soup & Swallow',description:'Rich green vegetable soup served with swallow.',image:'assets/vegetable-soup.webp'}
]);
export const mealById=id=>MEALS.find(m=>m.id===id);
export const MAX_QUANTITY=20;
export function normalizeCart(value){
 if(!Array.isArray(value))return [];
 const map=new Map();
 for(const line of value.slice(0,100)){
  if(!line||!mealById(line.id)||!Number.isInteger(line.qty)||line.qty<1||line.qty>MAX_QUANTITY)continue;
  map.set(line.id,Math.min(MAX_QUANTITY,(map.get(line.id)||0)+line.qty));
 }
 return [...map].map(([id,qty])=>({id,qty}));
}
const singleLine=v=>String(v??'').replace(/[\x00-\x1f\x7f]/g,' ').replace(/\s+/g,' ').trim();
export function requestText(cart,fields){
 const items=normalizeCart(cart);if(!items.length)throw Error('Choose a meal for your request.');
 const name=singleLine(fields.name),area=singleLine(fields.area),notes=String(fields.notes??'').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g,'').trim();
 if(name.length<2||name.length>80)throw Error('Enter your name, using 2–80 characters.');
 if(area.length<2||area.length>160)throw Error('Enter your delivery area, using 2–160 characters.');
 if(notes.length>500)throw Error('Please keep notes within 500 characters.');
 return ['Hello Merich Foods! I’d like to order:',...items.map(l=>`${l.qty} × ${mealById(l.id).name}`),'',`Name: ${name}`,`Delivery area: ${area}`,...(notes?['Notes: '+notes]:[]),'','Please confirm today’s price, availability and delivery options.'].join('\n');
}
export function whatsappUrl(text){return `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(text)}`;}
export function requestUrl(cart,fields){const url=whatsappUrl(requestText(cart,fields));if(url.length>7500)throw Error('Please shorten your notes before continuing.');return url;}
export const ENQUIRY_URL=whatsappUrl('Hello Merich Foods! I’d like to ask about your menu, today’s prices and delivery options.');
