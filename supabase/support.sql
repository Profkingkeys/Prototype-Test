-- Run after schema.sql. These records remain inside the isolated Virex table.
alter table public."Virex" drop constraint if exists "Virex_kind_check";
alter table public."Virex" add constraint "Virex_kind_check" check(kind in ('product','order','visit','audit','rate','settings','message','enquiry','bot_check','faq'));
create index if not exists virex_message_thread on public."Virex" ((data->>'entity_id'),created_at desc) where kind='message';
create unique index if not exists virex_enquiry_request on public."Virex" ((data->>'request_id')) where kind='enquiry';
create index if not exists virex_enquiry_tracking on public."Virex" ((data->>'tracking_hash')) where kind='enquiry';
create index if not exists virex_auth_lookup on public."Virex" ((data->>'type'),(data->>'token_hash')) where kind='settings';
create unique index if not exists virex_bot_session_question on public."Virex" ((data->>'session_id'),(data->>'question_key')) where kind='bot_check';

create or replace function public.virex_inbox(p_kind text,p_query text default '',p_status text default '',p_offset integer default 0)
returns jsonb language sql stable security invoker set search_path='' as $$
with threads as (
 select o.id,o.kind,o.data-'tracking_hash' as data,o.version,o.created_at,o.updated_at,
 (select count(*) from public."Virex" m where m.kind='message' and m.data->>'entity_id'=o.id::text and m.data->>'sender'='buyer' and m.created_at>coalesce((o.data->>'chat_read_at')::timestamptz,'epoch')) unread,
 (select m.data->>'text' from public."Virex" m where m.kind='message' and m.data->>'entity_id'=o.id::text order by m.created_at desc,m.id desc limit 1) preview,
 (select max(m.created_at) from public."Virex" m where m.kind='message' and m.data->>'entity_id'=o.id::text) last_message_at
 from public."Virex" o where (p_kind='order' and o.kind='order' and exists(select 1 from public."Virex" m where m.kind='message' and m.data->>'entity_id'=o.id::text)) or (p_kind in ('enquiry','bot_check') and o.kind=p_kind)
), matched as (
 select * from threads where (p_query='' or (data::text ilike '%'||replace(replace(replace(left(p_query,160),'\','\\'),'%','\%'),'_','\_')||'%'))
 and (p_status='' or (p_status='unread' and unread>0) or data->>'status'=p_status)
), page as(select * from matched order by coalesce(last_message_at,created_at) desc limit 30 offset greatest(p_offset,0))
select jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(page)) from page),'[]'::jsonb),'total',(select count(*) from matched),
'counts',jsonb_build_object('order',(select count(*) from public."Virex" o where o.kind='order' and exists(select 1 from public."Virex" m where m.kind='message' and m.data->>'entity_id'=o.id::text and m.data->>'sender'='buyer' and m.created_at>coalesce((o.data->>'chat_read_at')::timestamptz,'epoch'))),
'enquiry',(select count(*) from public."Virex" where kind='enquiry' and data->>'status'='open'),
'bot_check',(select count(*) from public."Virex" where kind='bot_check' and data->>'status'='open')));
$$;
revoke all on function public.virex_inbox(text,text,text,integer) from public,anon,authenticated;
grant execute on function public.virex_inbox(text,text,text,integer) to service_role;

-- A preview creates a short-lived, one-use challenge tied to the signed-in admin.
-- The cutoff keeps requests created after the preview out of the deletion.
create or replace function public.virex_reset(p_challenge uuid,p_actor text,p_confirmation text,p_products jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare c public."Virex"; cutoff timestamptz; scopes text[]; n bigint; restored integer:=0; product jsonb; restored_version integer;
begin
 if p_confirmation<>'RESET VIREX' or p_actor not in ('offiongv59@gmail.com','kingsleyumoh03@gmail.com') then raise exception 'Confirmation required';end if;
 lock table public."Virex" in share row exclusive mode;
 select * into c from public."Virex" where id=p_challenge and kind='settings' and data->>'type'='reset_challenge' for update;
 if c.id is null or c.data->>'actor'<>p_actor or (c.data->>'expires_at')::timestamptz<now() then raise exception 'Reset preview expired. Open a new preview.';end if;
 cutoff:=(c.data->>'cutoff')::timestamptz;
 scopes:=array['order','message','enquiry','bot_check','visit','audit'];
 if exists(select 1 from public."Virex" where kind in ('order','enquiry','bot_check') and created_at<=cutoff and updated_at>cutoff) then raise exception 'Records changed after this preview. Open a new preview.';end if;
 if exists(select 1 from public."Virex" m join public."Virex" o on o.id::text=m.data->>'entity_id' where m.kind='message' and m.created_at>cutoff and o.kind in ('order','enquiry') and o.created_at<=cutoff) then raise exception 'New messages arrived after this preview. Open a new preview.';end if;
 if c.data->>'scope'='full' then
  if exists(select 1 from public."Virex" where kind in ('product','faq') and updated_at>cutoff) then raise exception 'The catalogue changed after this preview. Open a new preview.';end if;
  if jsonb_typeof(p_products)<>'array' or jsonb_array_length(p_products)<>8 then raise exception 'Original catalogue unavailable';end if;
  select coalesce(max(version),0)+1 into restored_version from public."Virex" where kind='product';
  scopes:=scopes||array['product','faq'];
 end if;
 delete from public."Virex" where kind=any(scopes) and created_at<=cutoff;
 get diagnostics n=row_count;
 if c.data->>'scope'='full' then
  for product in select * from jsonb_array_elements(p_products) loop
   insert into public."Virex" (id,kind,data,version) values ((product->>'id')::uuid,'product',product->'data',restored_version);restored:=restored+1;
  end loop;
 end if;
 delete from public."Virex" where id=p_challenge;
 insert into public."Virex"(kind,data) values('audit',jsonb_build_object('actor',p_actor,'action','Virex reset confirmed manually','entity',c.data->>'scope','deleted_records',n,'restored_products',restored));
 return jsonb_build_object('deleted_records',n,'restored_products',restored,'scope',c.data->>'scope','cutoff',cutoff);
end;
$$;
revoke all on function public.virex_reset(uuid,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.virex_reset(uuid,text,text,jsonb) to service_role;
