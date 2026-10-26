-- Virex is intentionally isolated from all other applications in this project.
create table if not exists public."Virex" (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('product','order','visit','audit','rate','settings')),
  data jsonb not null default '{}'::jsonb check (jsonb_typeof(data) = 'object'),
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists virex_kind_created on public."Virex" (kind, created_at desc);
create index if not exists virex_kind_updated on public."Virex" (kind, updated_at desc);
create unique index if not exists virex_product_slug on public."Virex" ((data->>'slug')) where kind='product';
create unique index if not exists virex_order_request on public."Virex" ((data->>'request_id')) where kind='order';
create index if not exists virex_order_tracking on public."Virex" ((data->>'tracking_hash')) where kind='order';
alter table public."Virex" enable row level security;
revoke all on table public."Virex" from anon, authenticated;
-- All reads pass through the authenticated Edge API; no direct browser grants.
grant all on table public."Virex" to service_role;
drop policy if exists virex_admin_read on public."Virex";
-- Default-deny RLS: all admin access is authorised by the Edge API.

-- Only the server can write. No browser role can insert orders, spoof events,
-- change prices, mark payments or update stock directly through the Data API.
create or replace function public.virex_rate_limit(p_key text, p_max integer, p_seconds integer)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare r uuid; ok uuid;
begin
  if p_max < 1 or p_seconds < 1 then return false; end if;
  r := md5('virex:' || p_key || ':' || floor(extract(epoch from now())/p_seconds)::text)::uuid;
  insert into public."Virex" (id,kind,data)
  values (r,'rate',jsonb_build_object('count',1))
  on conflict (id) do update set
    data=jsonb_build_object('count',(public."Virex".data->>'count')::integer+1), updated_at=now()
  where (public."Virex".data->>'count')::integer < p_max
  returning id into ok;
  return ok is not null;
end;
$$;
revoke all on function public.virex_rate_limit(text,integer,integer) from public,anon,authenticated;
grant execute on function public.virex_rate_limit(text,integer,integer) to service_role;

insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('virex-assets','virex-assets',true,262144,array['image/jpeg','image/png','image/webp'])
on conflict(id) do nothing;
-- Uploads pass through the authenticated virex-api function. No public upload
-- policy is introduced and no other bucket or application's policies change.
drop policy if exists virex_assets_insert_guard on storage.objects;
create policy virex_assets_insert_guard on storage.objects as restrictive for insert to anon,authenticated with check(bucket_id <> 'virex-assets');
drop policy if exists virex_assets_update_guard on storage.objects;
create policy virex_assets_update_guard on storage.objects as restrictive for update to anon,authenticated using(bucket_id <> 'virex-assets') with check(bucket_id <> 'virex-assets');
drop policy if exists virex_assets_delete_guard on storage.objects;
create policy virex_assets_delete_guard on storage.objects as restrictive for delete to anon,authenticated using(bucket_id <> 'virex-assets');

create or replace function public.virex_find_orders(p_query text default '', p_status text default '', p_payment text default '', p_limit integer default 50, p_offset integer default 0)
returns jsonb language sql stable security invoker set search_path='' as $$
with matched as (
 select * from public."Virex" where kind='order'
 and (p_query='' or data::text ilike '%'||replace(replace(replace(left(p_query,160),'\','\\'),'%','\%'),'_','\_')||'%')
 and (p_status='' or (p_status='needs_action' and data->>'order_status' in ('pending_review','needs_details')) or data->>'order_status'=p_status)
 and (p_payment='' or data->>'payment_status'=p_payment)
), page as (select * from matched order by created_at desc limit least(greatest(p_limit,1),100) offset greatest(p_offset,0))
select jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(page)) from page),'[]'::jsonb),'total',(select count(*) from matched));
$$;
revoke all on function public.virex_find_orders(text,text,text,integer,integer) from public,anon,authenticated;
grant execute on function public.virex_find_orders(text,text,text,integer,integer) to service_role;

create or replace function public.virex_snapshot(p_days integer default 7)
returns jsonb language sql stable security invoker set search_path='' as $$
with visits as (select * from public."Virex" where kind='visit'),
recent as (select * from visits where created_at >= now()-make_interval(days=>greatest(1,least(p_days,365)))),
orders as (select * from public."Virex" where kind='order'),
paid as (select *,greatest(0,(data->>'subtotal')::numeric-coalesce((data->>'refund_amount')::numeric,0)) net from orders where data->>'payment_status'='paid'),
period_paid as (select * from paid where coalesce((data->>'payment_confirmed_at')::timestamptz,updated_at)>=now()-make_interval(days=>greatest(1,least(p_days,365)))),
sources as (select coalesce(data->>'source','Direct') name,count(*) value from recent group by 1 order by 2 desc),
devices as (select coalesce(data->>'device','Other') name,count(*) value from recent group by 1 order by 2 desc),
days as (select generate_series((now() at time zone 'Africa/Lagos')::date-greatest(0,least(p_days,365)-1),(now() at time zone 'Africa/Lagos')::date,'1 day')::date as d),
daily as (select d as bucket,(select count(*) from visits v where (v.created_at at time zone 'Africa/Lagos')::date=d) visits,(select coalesce(sum(net),0) from paid o where (coalesce((o.data->>'payment_confirmed_at')::timestamptz,o.updated_at) at time zone 'Africa/Lagos')::date=d) revenue from days),
active as (select id,data-'ip_hash' as data,created_at,updated_at from visits where updated_at>now()-interval '65 seconds' and coalesce((data->>'visible')::boolean,false) order by updated_at desc limit 100),
activity as (select id,data,created_at from public."Virex" where kind='audit' order by created_at desc limit 15)
select jsonb_build_object(
 'total_visits',(select count(*) from visits),
 'unique_visitors',(select count(distinct data->>'visitor_id') from visits),
 'visits_today',(select count(*) from visits where (created_at at time zone 'Africa/Lagos')::date=(now() at time zone 'Africa/Lagos')::date),
 'online_now',(select count(distinct data->>'visitor_id') from visits where updated_at>now()-interval '65 seconds' and coalesce((data->>'visible')::boolean,false)),
 'revenue',(select coalesce(sum(net),0) from period_paid),
 'revenue_all_time',(select coalesce(sum(net),0) from paid),
 'paid_orders',(select count(*) from period_paid),
 'pending_orders',(select count(*) from orders where data->>'order_status' in ('pending_review','needs_details')),
 'order_counts',(select coalesce(jsonb_object_agg(status,n),'{}'::jsonb) from (select data->>'order_status' status,count(*) n from orders group by 1) q),
 'triage_counts',(select coalesce(jsonb_object_agg(status,n),'{}'::jsonb) from (select data->>'triage' status,count(*) n from orders where data->>'order_status' in ('pending_review','needs_details') group by 1) q),
 'sources',coalesce((select jsonb_agg(to_jsonb(sources)) from sources),'[]'::jsonb),
 'devices',coalesce((select jsonb_agg(to_jsonb(devices)) from devices),'[]'::jsonb),
 'daily',coalesce((select jsonb_agg(to_jsonb(daily) order by bucket) from daily),'[]'::jsonb),
 'active',coalesce((select jsonb_agg(to_jsonb(active)) from active),'[]'::jsonb),
 'activity',coalesce((select jsonb_agg(to_jsonb(activity)) from activity),'[]'::jsonb)
);
$$;
revoke all on function public.virex_snapshot(integer) from public,anon,authenticated;
grant execute on function public.virex_snapshot(integer) to service_role;
