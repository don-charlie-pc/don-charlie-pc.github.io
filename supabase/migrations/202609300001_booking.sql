-- All Data API access is server-only. Browser authentication grants no table rights.
create extension if not exists btree_gist;
create schema if not exists booking_private;
revoke all on schema booking_private from public, anon, authenticated;

create table public.service_types (
  id uuid primary key default gen_random_uuid(), slug text unique not null,
  name text not null check (length(name) between 1 and 120), description text not null default '',
  visible boolean not null default true, booking_mode text not null check (booking_mode in ('slot','quote')),
  default_duration_minutes integer not null check (default_duration_minutes between 15 and 1440),
  price_label text not null default 'Cotización personalizada', sort_order integer not null default 0,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.booking_settings (
  id boolean primary key default true check (id), minimum_notice_hours integer not null default 24 check (minimum_notice_hours between 1 and 8760),
  maximum_window_days integer not null default 90 check (maximum_window_days between 1 and 730),
  hold_hours integer not null default 24 check (hold_hours between 1 and 168),
  hold_cutoff_hours integer not null default 24 check (hold_cutoff_hours between 0 and 8760),
  accepting_requests boolean not null default false, legal_version text not null default 'borrador-2026-09'
);
insert into public.booking_settings default values;
create table public.admin_users (
  id uuid primary key, google_subject text unique not null, email text not null,
  is_allowed boolean not null default false, display_name text,
  created_at timestamptz not null default now(), last_login_at timestamptz
);
create table public.availability_slots (
  id uuid primary key default gen_random_uuid(), starts_at_utc timestamptz not null, ends_at_utc timestamptz not null,
  timezone text not null default 'America/Mexico_City' check (timezone = 'America/Mexico_City'),
  status text not null default 'draft' check (status in ('draft','active','paused','archived')),
  allowed_service_ids uuid[] not null check (cardinality(allowed_service_ids) > 0),
  location_type text not null check (location_type in ('estudio','exterior','domicilio','por_definir')),
  location_label text not null default '' check (length(location_label) <= 160),
  public_note text not null default '' check (length(public_note) <= 500),
  internal_note text not null default '' check (length(internal_note) <= 2000),
  created_by_admin_id uuid not null references public.admin_users(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check (ends_at_utc > starts_at_utc), check (ends_at_utc <= starts_at_utc + interval '24 hours'),
  exclude using gist (tstzrange(starts_at_utc, ends_at_utc, '[)') with &&) where (status = 'active')
);
create table public.google_calendar_connections (
  id uuid primary key default gen_random_uuid(), admin_user_id uuid unique not null references public.admin_users(id),
  google_subject text not null, google_email text not null, calendar_id text not null default 'primary', calendar_name text not null default 'Principal',
  encrypted_refresh_token text not null, token_iv text not null, token_key_version integer not null,
  granted_scopes text[] not null, connected_at timestamptz not null default now(), disconnected_at timestamptz, last_error text
);
create table public.reservations (
  id uuid primary key default gen_random_uuid(), public_reference uuid unique not null default gen_random_uuid(),
  slot_id uuid not null references public.availability_slots(id), service_id uuid not null references public.service_types(id),
  status text not null default 'pending' check (status in ('pending','confirming','confirmed','completed','no_show','declined','expired','cancellation_requested','cancelled_by_admin','released')),
  customer_name text not null check (length(customer_name) between 2 and 120),
  customer_email text not null check (length(customer_email) between 3 and 254),
  customer_phone text not null check (length(customer_phone) between 8 and 16),
  preferred_contact_method text not null default 'whatsapp' check (preferred_contact_method in ('whatsapp','email')),
  municipality text not null check (length(municipality) between 2 and 100),
  location_type text not null check (location_type in ('estudio','exterior','domicilio','por_definir')),
  location_detail text not null default '' check (length(location_detail) <= 300),
  participant_count integer check (participant_count between 1 and 10000),
  customer_notes text not null default '' check (length(customer_notes) <= 2000),
  privacy_accepted_at timestamptz not null, terms_accepted_at timestamptz not null, legal_version text not null,
  hold_expires_at timestamptz not null, confirmed_at timestamptz, cancelled_at timestamptz,
  cancellation_reason text check (length(cancellation_reason) <= 500), admin_notes text not null default '' check (length(admin_notes) <= 2000),
  google_calendar_event_id text, calendar_connection_id uuid references public.google_calendar_connections(id), calendar_id_snapshot text,
  calendar_sync_status text not null default 'not_created' check (calendar_sync_status in ('not_created','creating','synced','error','cancellation_pending','cancelled')),
  calendar_sync_error text, sync_attempt_count integer not null default 0,
  sync_token uuid, sync_lease_until timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check (status <> 'confirmed' or (google_calendar_event_id is not null and calendar_sync_status = 'synced'))
);
create unique index one_active_reservation_per_slot on public.reservations(slot_id)
  where status in ('pending','confirming','confirmed','cancellation_requested');
create index reservations_hold on public.reservations(hold_expires_at) where status = 'pending';
create table public.booking_inquiries (
  id uuid primary key default gen_random_uuid(), public_reference uuid unique not null default gen_random_uuid(),
  service_id uuid not null references public.service_types(id), customer_name text not null check (length(customer_name) between 2 and 120),
  customer_email text not null check (length(customer_email) <= 254), customer_phone text not null check (length(customer_phone) <= 16),
  municipality text not null check (length(municipality) between 2 and 100), location_type text not null,
  location_detail text not null default '' check (length(location_detail) <= 300), participant_count integer check (participant_count between 1 and 10000),
  customer_notes text not null default '' check (length(customer_notes) <= 2000), preferred_date date,
  privacy_accepted_at timestamptz not null, terms_accepted_at timestamptz not null, legal_version text not null,
  status text not null default 'new' check (status in ('new','contacted','closed')), created_at timestamptz not null default now()
);
create table public.oauth_states (
  id uuid primary key default gen_random_uuid(), state_hash text unique not null,
  admin_user_id uuid not null references public.admin_users(id), code_verifier_hash text not null,
  encrypted_code_verifier text not null, verifier_iv text not null, token_key_version integer not null,
  expires_at timestamptz not null, used_at timestamptz, created_at timestamptz not null default now()
);
create table public.audit_log (
  id bigint generated always as identity primary key, actor_type text not null, actor_id uuid,
  reservation_id uuid, action text not null, before_state jsonb, after_state jsonb, created_at timestamptz not null default now()
);
create table public.booking_rate_limits (
  key_hash text primary key, window_start timestamptz not null default now(), attempts integer not null default 1
);

create function booking_private.assert_admin(p_actor uuid) returns void language plpgsql set search_path = '' as $$
begin
  if not exists(select 1 from public.admin_users where id = p_actor and is_allowed) then raise exception 'FORBIDDEN'; end if;
end $$;
create function booking_private.audit(p_actor uuid, p_id uuid, p_action text, p_before text, p_after text)
returns void language sql set search_path = '' as $$
  insert into public.audit_log(actor_type,actor_id,reservation_id,action,before_state,after_state)
  values(case when p_actor is null then 'system' else 'admin' end,p_actor,p_id,p_action,jsonb_build_object('status',p_before),jsonb_build_object('status',p_after));
$$;
create function booking_private.validate_slot() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.status = 'active' and new.starts_at_utc <= now() then raise exception 'SLOT_NOT_FUTURE'; end if;
  if exists(select 1 from unnest(new.allowed_service_ids) x where not exists(select 1 from public.service_types s where s.id=x and s.booking_mode='slot')) then raise exception 'INVALID_SERVICE'; end if;
  new.updated_at = now(); return new;
end $$;
create trigger validate_slot before insert or update on public.availability_slots for each row execute function booking_private.validate_slot();

create function public.booking_expire() returns void language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  -- Never release ambiguous Calendar writes or reservations with a sync operation.
  for r in update public.reservations set status='expired',updated_at=now()
    where status='pending' and calendar_sync_status='not_created' and hold_expires_at<=now() returning id loop
    perform booking_private.audit(null,r.id,'expire','pending','expired');
  end loop;
  delete from public.booking_rate_limits where window_start < now()-interval '2 days';
  delete from public.oauth_states where expires_at < now()-interval '1 day';
end $$;

create function public.booking_public_catalog(p_service uuid default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare cfg public.booking_settings; result jsonb;
begin
  perform public.booking_expire(); select * into cfg from public.booking_settings where id;
  select jsonb_build_object(
    'settings',jsonb_build_object('minimum_notice_hours',cfg.minimum_notice_hours,'maximum_window_days',cfg.maximum_window_days,'accepting_requests',cfg.accepting_requests,'legal_version',cfg.legal_version),
    'services',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'slug',slug,'description',description,'booking_mode',booking_mode,'price_label',price_label) order by sort_order) from public.service_types where visible),'[]'::jsonb),
    'slots',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'starts_at_utc',a.starts_at_utc,'ends_at_utc',a.ends_at_utc,'timezone',a.timezone,'location_type',a.location_type,'location_label',a.location_label,'public_note',a.public_note) order by a.starts_at_utc)
      from public.availability_slots a where cfg.accepting_requests and a.status='active'
      and a.starts_at_utc > now()+make_interval(hours=>cfg.minimum_notice_hours)
      and a.starts_at_utc > now()+make_interval(hours=>cfg.hold_cutoff_hours)
      and a.starts_at_utc <= now()+make_interval(days=>cfg.maximum_window_days)
      and p_service=any(a.allowed_service_ids) and exists(select 1 from public.service_types where id=p_service and visible and booking_mode='slot')
      and not exists(select 1 from public.reservations r where r.slot_id=a.id and r.status in ('pending','confirming','confirmed','cancellation_requested'))),'[]'::jsonb)
  ) into result; return result;
end $$;

create function public.booking_rate_limit(p_key text, p_limit integer default 5) returns boolean
language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  if length(p_key)<>64 or p_limit not between 1 and 100 then raise exception 'INVALID_INPUT'; end if;
  insert into public.booking_rate_limits as b(key_hash) values(p_key)
  on conflict(key_hash) do update set
    attempts=case when b.window_start<now()-interval '1 hour' then 1 else b.attempts+1 end,
    window_start=case when b.window_start<now()-interval '1 hour' then now() else b.window_start end returning attempts into n;
  return n<=p_limit;
end $$;

create function public.booking_create(p_data jsonb) returns jsonb language plpgsql security definer set search_path = '' as $$
declare cfg public.booking_settings; s public.service_types; a public.availability_slots; ref uuid; new_id uuid; expires timestamptz;
begin
  select * into cfg from public.booking_settings where id;
  if not cfg.accepting_requests then raise exception 'BOOKING_CLOSED'; end if;
  if p_data->>'legal_version' is distinct from cfg.legal_version or p_data->>'privacy_accepted' is distinct from 'true' or p_data->>'terms_accepted' is distinct from 'true' then raise exception 'CONSENT_REQUIRED'; end if;
  if length(p_data->>'customer_name') not between 2 and 120 or p_data->>'customer_email' !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or p_data->>'customer_phone' !~ '^\+?[0-9]{8,15}$' or p_data->>'location_type' not in ('estudio','exterior','domicilio','por_definir') then raise exception 'INVALID_INPUT'; end if;
  select * into s from public.service_types where id=(p_data->>'service_id')::uuid and visible;
  if not found then raise exception 'INVALID_SERVICE'; end if;
  if s.booking_mode='quote' then
    if nullif(p_data->>'slot_id','') is not null then raise exception 'INVALID_INPUT'; end if;
    insert into public.booking_inquiries(service_id,customer_name,customer_email,customer_phone,municipality,location_type,location_detail,participant_count,customer_notes,preferred_date,privacy_accepted_at,terms_accepted_at,legal_version)
    values(s.id,p_data->>'customer_name',lower(p_data->>'customer_email'),p_data->>'customer_phone',p_data->>'municipality',p_data->>'location_type',coalesce(p_data->>'location_detail',''),nullif(p_data->>'participant_count','')::integer,coalesce(p_data->>'customer_notes',''),nullif(p_data->>'preferred_date','')::date,now(),now(),cfg.legal_version) returning public_reference into ref;
    perform booking_private.audit(null,null,'inquiry.create',null,'new');
    return jsonb_build_object('public_reference',ref,'kind','inquiry');
  end if;
  select * into a from public.availability_slots where id=(p_data->>'slot_id')::uuid for update;
  if not found or a.status<>'active' or not s.id=any(a.allowed_service_ids) or a.starts_at_utc<=now()+make_interval(hours=>cfg.minimum_notice_hours) or a.starts_at_utc>now()+make_interval(days=>cfg.maximum_window_days) then raise exception 'SLOT_UNAVAILABLE'; end if;
  perform public.booking_expire();
  if exists(select 1 from public.reservations where slot_id=a.id and status in ('pending','confirming','confirmed','cancellation_requested')) then raise exception 'SLOT_UNAVAILABLE'; end if;
  expires=least(now()+make_interval(hours=>cfg.hold_hours),a.starts_at_utc-make_interval(hours=>cfg.hold_cutoff_hours));
  if expires<=now() then raise exception 'SLOT_UNAVAILABLE'; end if;
  insert into public.reservations(slot_id,service_id,customer_name,customer_email,customer_phone,preferred_contact_method,municipality,location_type,location_detail,participant_count,customer_notes,privacy_accepted_at,terms_accepted_at,legal_version,hold_expires_at)
  values(a.id,s.id,p_data->>'customer_name',lower(p_data->>'customer_email'),p_data->>'customer_phone',coalesce(p_data->>'preferred_contact_method','whatsapp'),p_data->>'municipality',p_data->>'location_type',coalesce(p_data->>'location_detail',''),nullif(p_data->>'participant_count','')::integer,coalesce(p_data->>'customer_notes',''),now(),now(),cfg.legal_version,expires) returning public_reference,id into ref,new_id;
  perform booking_private.audit(null,new_id,'request.create',null,'pending');
  return jsonb_build_object('public_reference',ref,'kind','reservation','hold_expires_at',expires);
end $$;

create function public.booking_admin_slots(p_actor uuid, p_action text, p_slots jsonb default '[]', p_id uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare item jsonb; a public.availability_slots; ids uuid[]='{}'; sid uuid;
begin
  perform booking_private.assert_admin(p_actor); perform public.booking_expire();
  if p_action='save' then
    if jsonb_typeof(p_slots)<>'array' or jsonb_array_length(p_slots) not between 1 and 60 then raise exception 'INVALID_INPUT'; end if;
    for item in select * from jsonb_array_elements(p_slots) loop
      sid=nullif(item->>'id','')::uuid;
      if sid is not null then
        select * into a from public.availability_slots where id=sid for update;
        if not found then raise exception 'NOT_FOUND'; end if;
        if exists(select 1 from public.reservations where slot_id=sid and status in ('pending','confirming','confirmed','cancellation_requested')) then raise exception 'SLOT_OCCUPIED'; end if;
        update public.availability_slots set starts_at_utc=(item->>'starts_at_utc')::timestamptz,ends_at_utc=(item->>'ends_at_utc')::timestamptz,
          status=item->>'status',allowed_service_ids=array(select jsonb_array_elements_text(item->'allowed_service_ids')::uuid),location_type=item->>'location_type',location_label=coalesce(item->>'location_label',''),public_note=coalesce(item->>'public_note',''),internal_note=coalesce(item->>'internal_note','') where id=sid;
      else
        insert into public.availability_slots(starts_at_utc,ends_at_utc,status,allowed_service_ids,location_type,location_label,public_note,internal_note,created_by_admin_id)
        values((item->>'starts_at_utc')::timestamptz,(item->>'ends_at_utc')::timestamptz,item->>'status',array(select jsonb_array_elements_text(item->'allowed_service_ids')::uuid),item->>'location_type',coalesce(item->>'location_label',''),coalesce(item->>'public_note',''),coalesce(item->>'internal_note',''),p_actor) returning id into sid;
      end if;
      ids=array_append(ids,sid); perform booking_private.audit(p_actor,null,'slot.save',null,item->>'status');
    end loop;
  elsif p_action in ('pause','delete','activate') then
    select * into a from public.availability_slots where id=p_id for update;
    if not found then raise exception 'NOT_FOUND'; end if;
    if exists(select 1 from public.reservations where slot_id=p_id and status in ('pending','confirming','confirmed','cancellation_requested')) then raise exception 'SLOT_OCCUPIED'; end if;
    update public.availability_slots set status=case p_action when 'pause' then 'paused' when 'delete' then 'archived' else 'active' end where id=p_id;
    perform booking_private.audit(p_actor,null,'slot.'||p_action,a.status,null);
  else raise exception 'INVALID_ACTION'; end if;
  return jsonb_build_object('ok',true,'ids',ids);
end $$;

create function public.booking_begin_sync(p_actor uuid,p_id uuid,p_operation text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r public.reservations; c public.google_calendar_connections; token uuid;
begin
  perform booking_private.assert_admin(p_actor);
  select * into r from public.reservations where id=p_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if r.sync_lease_until>now() then raise exception 'SYNC_BUSY'; end if;
  if p_operation='confirm' then
    if r.status='confirmed' then return jsonb_build_object('done',true,'status','confirmed'); end if;
    if r.status not in ('pending','confirming') or (r.status='pending' and r.hold_expires_at<=now()) then raise exception 'INVALID_STATE'; end if;
    if (select starts_at_utc from public.availability_slots where id=r.slot_id)<=now() then raise exception 'SLOT_NOT_FUTURE'; end if;
  elsif p_operation='cancel' then
    if r.status in ('cancelled_by_admin','declined','expired','released') then return jsonb_build_object('done',true,'status',r.status); end if;
    if r.status not in ('confirming','confirmed','cancellation_requested') then raise exception 'INVALID_STATE'; end if;
  else raise exception 'INVALID_ACTION'; end if;
  select * into c from public.google_calendar_connections
    where (r.calendar_connection_id is null and admin_user_id=p_actor or id=r.calendar_connection_id) and disconnected_at is null for update;
  if not found then raise exception 'CALENDAR_DISCONNECTED'; end if;
  token=gen_random_uuid();
  update public.reservations set status=case p_operation when 'confirm' then 'confirming' else 'cancellation_requested' end,
    calendar_sync_status=case p_operation when 'confirm' then 'creating' else 'cancellation_pending' end,
    calendar_connection_id=c.id,calendar_id_snapshot=coalesce(calendar_id_snapshot,c.calendar_id),
    google_calendar_event_id=coalesce(google_calendar_event_id,'cf'||replace(id::text,'-','')),
    sync_token=token,sync_lease_until=now()+interval '3 minutes',sync_attempt_count=sync_attempt_count+1,calendar_sync_error=null,updated_at=now()
    where id=p_id returning * into r;
  perform booking_private.audit(p_actor,r.id,'calendar.'||p_operation,null,r.status);
  return jsonb_build_object('done',false,'reservation',to_jsonb(r),'slot',(select to_jsonb(a) from public.availability_slots a where id=r.slot_id),'service',(select name from public.service_types where id=r.service_id));
end $$;

create function public.booking_finish_sync(p_actor uuid,p_id uuid,p_token uuid,p_operation text,p_error text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.reservations; next_status text;
begin
  perform booking_private.assert_admin(p_actor);
  select * into r from public.reservations where id=p_id for update;
  if not found or r.sync_token is distinct from p_token then raise exception 'STALE_SYNC'; end if;
  if p_operation not in ('confirm','cancel') or (p_operation='confirm' and r.status<>'confirming') or (p_operation='cancel' and r.status<>'cancellation_requested') then raise exception 'INVALID_STATE'; end if;
  next_status=case when p_error is not null then r.status when p_operation='confirm' then 'confirmed' else 'cancelled_by_admin' end;
  update public.reservations set status=next_status,
    calendar_sync_status=case when p_error is not null then case p_operation when 'cancel' then 'cancellation_pending' else 'error' end when p_operation='confirm' then 'synced' else 'cancelled' end,
    calendar_sync_error=left(p_error,100),confirmed_at=case when p_error is null and p_operation='confirm' then now() else confirmed_at end,
    cancelled_at=case when p_error is null and p_operation='cancel' then now() else cancelled_at end,
    sync_token=null,sync_lease_until=null,updated_at=now() where id=p_id;
  perform booking_private.audit(p_actor,p_id,'calendar.'||case when p_error is null then 'success' else 'error' end,r.status,next_status);
  return jsonb_build_object('status',next_status,'ok',p_error is null);
end $$;

create function public.booking_reservation_action(p_actor uuid,p_id uuid,p_action text,p_note text default '') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r public.reservations; next_status text;
begin
  perform booking_private.assert_admin(p_actor);
  if length(p_note)>2000 then raise exception 'INVALID_INPUT'; end if;
  if p_action in ('inquiry_contacted','inquiry_closed') then
    update public.booking_inquiries set status=case p_action when 'inquiry_contacted' then 'contacted' else 'closed' end where id=p_id;
    if not found then raise exception 'NOT_FOUND'; end if;
    perform booking_private.audit(p_actor,null,p_action,null,null); return jsonb_build_object('ok',true);
  end if;
  select * into r from public.reservations where id=p_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if r.sync_lease_until>now() then raise exception 'SYNC_BUSY'; end if;
  if p_action='notes' then
    update public.reservations set admin_notes=p_note,updated_at=now() where id=p_id;
    perform booking_private.audit(p_actor,p_id,'notes',null,null); return jsonb_build_object('ok',true);
  elsif p_action='decline' and r.status='pending' and r.calendar_sync_status='not_created' then next_status='declined';
  elsif p_action='cancel' and r.status='pending' and r.calendar_sync_status='not_created' then next_status='cancelled_by_admin';
  elsif p_action='release' and r.status in ('confirming','cancellation_requested') and length(trim(p_note))>=10 then next_status='released';
  elsif p_action in ('completed','no_show') and r.status='confirmed' and (select ends_at_utc from public.availability_slots where id=r.slot_id)<=now() then next_status=p_action;
  else raise exception 'INVALID_STATE'; end if;
  update public.reservations set status=next_status,cancellation_reason=left(p_note,500),cancelled_at=case when next_status in ('declined','cancelled_by_admin','released') then now() else cancelled_at end,updated_at=now() where id=p_id;
  perform booking_private.audit(p_actor,p_id,p_action,r.status,next_status);
  return jsonb_build_object('ok',true,'status',next_status);
end $$;

create function public.booking_consume_oauth(p_hash text) returns jsonb language plpgsql security definer set search_path = '' as $$
declare result jsonb;
begin
  update public.oauth_states set used_at=now() where state_hash=p_hash and used_at is null and expires_at>now()
    and exists(select 1 from public.admin_users where id=admin_user_id and is_allowed) returning to_jsonb(oauth_states.*) into result;
  if result is null then raise exception 'INVALID_OAUTH_STATE'; end if; return result;
end $$;

create function public.booking_save_connection(p_actor uuid,p_data jsonb) returns void language plpgsql security definer set search_path = '' as $$
declare c public.google_calendar_connections;
begin
  perform booking_private.assert_admin(p_actor);
  perform pg_advisory_xact_lock(hashtext(p_actor::text));
  select * into c from public.google_calendar_connections where admin_user_id=p_actor for update;
  if found and c.google_subject<>p_data->>'google_subject' and exists(select 1 from public.reservations where calendar_connection_id=c.id and status in ('confirming','confirmed','cancellation_requested')) then raise exception 'CALENDAR_ACCOUNT_IN_USE'; end if;
  insert into public.google_calendar_connections(admin_user_id,google_subject,google_email,calendar_id,calendar_name,encrypted_refresh_token,token_iv,token_key_version,granted_scopes)
  values(p_actor,p_data->>'google_subject',p_data->>'google_email',p_data->>'calendar_id',p_data->>'calendar_name',p_data->>'encrypted_refresh_token',p_data->>'token_iv',(p_data->>'token_key_version')::integer,array(select jsonb_array_elements_text(p_data->'granted_scopes')))
  on conflict(admin_user_id) do update set google_subject=excluded.google_subject,google_email=excluded.google_email,encrypted_refresh_token=excluded.encrypted_refresh_token,token_iv=excluded.token_iv,token_key_version=excluded.token_key_version,granted_scopes=excluded.granted_scopes,connected_at=now(),disconnected_at=null,last_error=null;
  perform booking_private.audit(p_actor,null,'calendar.connect',null,null);
end $$;

insert into public.service_types(slug,name,description,booking_mode,default_duration_minutes,sort_order) values
('retrato-femenino','Retrato femenino','Un espacio para mirarte con calma.','slot',60,1),
('cumpleanos','Sesión de cumpleaños','Celebremos una nueva vuelta al sol.','slot',60,2),
('preboda','Sesión preboda','Su historia, antes del gran día.','slot',90,3),
('boda-civil','Boda civil','Lo esencial de un sí.','slot',120,4),
('bautizo-evento','Bautizo y evento pequeño','Los encuentros que se quedan.','slot',120,5),
('boda','Boda — solo fotografía','Cuéntanos sobre tu celebración para preparar una propuesta.','quote',480,6);

-- RLS is enabled without browser policies. Service role is the ONLY Data API caller.
do $$ declare t text; f record; begin
  foreach t in array array['service_types','booking_settings','admin_users','availability_slots','google_calendar_connections','reservations','booking_inquiries','oauth_states','audit_log','booking_rate_limits'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public,anon,authenticated',t);
    execute format('grant all on public.%I to service_role',t);
  end loop;
  for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'booking_%' loop
    execute format('revoke all on function %s from public,anon,authenticated',f.signature);
    execute format('grant execute on function %s to service_role',f.signature);
  end loop;
end $$;
revoke all on all functions in schema booking_private from public,anon,authenticated;
revoke all on sequence public.audit_log_id_seq from public,anon,authenticated;
grant usage,select on sequence public.audit_log_id_seq to service_role;
