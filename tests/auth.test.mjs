import test from 'node:test';
import assert from 'node:assert/strict';
import {virexAuth} from '../supabase/functions/virex-api/auth.ts';
import {adminIdentity,adminFromIdentity} from '../supabase/functions/virex-api/domain.mjs';
const sid='6aa130fa-4159-4c4b-b8cb-69757b73accc';
const token='prefix.'+Buffer.from(JSON.stringify({session_id:sid})).toString('base64url')+'.signature';
function setup({email='offiongv59@gmail.com',grant=null,otherApp=false}={}){
 let authCalls=0;
 const chain={select(){return this;},eq(){return this;},maybeSingle:async()=>({data:grant,error:null})};
 const db={from:()=>chain,auth:{getUser:async()=>{authCalls++;return {data:{user:{email:otherApp?email:adminIdentity(email),email_confirmed_at:'2026-10-26'}},error:null};}}};
 const ctx={db,checked:r=>r.data,hash:async x=>x,limit:async()=>{},json:x=>x,authClient:()=>{throw Error('Unexpected mail request');},secret:'test-server-only'};
 return {auth:virexAuth(ctx),calls:()=>authCalls};
}
test('unapproved emails cannot request a code or proceed to the code step',async()=>{const {auth}=setup();await assert.rejects(()=>auth.action('request_otp',{email:'pharmweb3@gmail.com'},'ip',new Request('https://example.invalid')),e=>e.status===403);});
test('a valid Supabase login from another app does not grant Virex access',async()=>{const {auth}=setup({otherApp:true});await assert.rejects(()=>auth.requireAdmin(new Request('https://example.invalid',{headers:{Authorization:'Bearer '+token}})),/Admin access required/);});
test('even a Virex identity needs its own active login grant',async()=>{const {auth}=setup();await assert.rejects(()=>auth.requireAdmin(new Request('https://example.invalid',{headers:{Authorization:'Bearer '+token}})),/sign in to Virex again/);});
test('only the fixed two inboxes map to isolated Virex auth identities',()=>{assert.equal(adminIdentity('Offiongv59@gmail.com'),'offiongv59+virex-admin@gmail.com');assert.equal(adminFromIdentity('kingsleyumoh03+virex-admin@gmail.com'),'kingsleyumoh03@gmail.com');assert.equal(adminIdentity('pharmweb3@gmail.com'),null);assert.equal(adminFromIdentity('offiongv59@gmail.com'),null);assert.equal(adminFromIdentity('pharmweb3+virex-admin@gmail.com'),null);});
test('both approved emails can use their own active Virex login grant',async()=>{for(const email of ['offiongv59@gmail.com','kingsleyumoh03@gmail.com']){const {auth}=setup({email,grant:{id:sid,data:{email,expires_at:'2099-01-01'}}});const user=await auth.requireAdmin(new Request('https://example.invalid',{headers:{Authorization:'Bearer '+token}}));assert.equal(user.email,email);}});
test('expired grants and mismatched accounts are refused',async()=>{for(const data of [{email:'offiongv59@gmail.com',expires_at:'2020-01-01'},{email:'someone@example.invalid',expires_at:'2099-01-01'}]){const {auth}=setup({grant:{id:sid,data}});await assert.rejects(()=>auth.requireAdmin(new Request('https://example.invalid',{headers:{Authorization:'Bearer '+token}})));}});
test('verification requires a Virex challenge rather than a code alone',async()=>{const {auth}=setup();await assert.rejects(()=>auth.action('verify_otp',{email:'offiongv59@gmail.com',code:'123456'},'ip',new Request('https://example.invalid')),/could not be verified/);});
