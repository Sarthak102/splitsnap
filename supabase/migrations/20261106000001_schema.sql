-- All writes go through the functions below, so tables only need read policies.

create table public.bills (
  id uuid primary key default gen_random_uuid(),
  join_token text not null unique default replace(gen_random_uuid()::text, '-', ''),
  host_id uuid not null references auth.users on delete cascade,
  host_name text not null check (char_length(host_name) between 1 and 60),
  host_vpa text not null check (host_vpa ~ '^[A-Za-z0-9._-]{1,64}@[A-Za-z0-9.-]{1,64}$'),
  total_paise integer not null check (total_paise > 0 and total_paise <= 10000000),
  created_at timestamptz not null default now()
);
create index bills_host_recent on public.bills (host_id, created_at);

create table public.items (
  id uuid primary key default gen_random_uuid(),
  bill_id uuid not null references public.bills on delete cascade,
  position integer not null,
  name text not null check (char_length(name) between 1 and 120),
  quantity numeric not null check (quantity > 0),
  price_paise integer not null check (price_paise >= 0 and price_paise <= 10000000)
);
create index items_bill on public.items (bill_id);

create table public.members (
  bill_id uuid not null references public.bills on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  primary key (bill_id, user_id)
);

-- Change these values to tune the limits without touching code.
create table public.limits (
  id boolean primary key default true check (id),
  parses_per_user_hour integer not null default 5,
  parses_per_day integer not null default 40,
  bills_per_user_hour integer not null default 20
);
insert into public.limits default values;

create table public.parse_log (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users on delete cascade,
  created_at timestamptz not null default now()
);
create index parse_log_recent on public.parse_log (created_at);

alter table public.bills enable row level security;
alter table public.items enable row level security;
alter table public.members enable row level security;
alter table public.limits enable row level security;
alter table public.parse_log enable row level security;

revoke all on public.bills, public.items, public.members, public.limits, public.parse_log from anon, authenticated;
grant select on public.bills, public.items, public.members to authenticated;

create function public.is_member(target_bill uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.members
    where bill_id = target_bill and user_id = (select auth.uid())
  );
$$;

create policy "members read bills" on public.bills for select to authenticated
  using (public.is_member(id));
create policy "members read items" on public.items for select to authenticated
  using (public.is_member(bill_id));
create policy "members read members" on public.members for select to authenticated
  using (public.is_member(bill_id));

create function public.create_bill(p_host_name text, p_host_vpa text, p_total_paise integer, p_items jsonb)
returns text language plpgsql security definer set search_path = '' as $$
declare
  caller uuid := auth.uid();
  new_bill public.bills;
begin
  if caller is null then raise exception 'not_signed_in'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) not between 1 and 100 then
    raise exception 'invalid_items';
  end if;
  if (select count(*) from public.bills where host_id = caller and created_at > now() - interval '1 hour')
     >= (select bills_per_user_hour from public.limits) then
    raise exception 'rate_limited';
  end if;

  insert into public.bills (host_id, host_name, host_vpa, total_paise)
  values (caller, trim(p_host_name), trim(p_host_vpa), p_total_paise)
  returning * into new_bill;

  insert into public.items (bill_id, position, name, quantity, price_paise)
  select new_bill.id, ordinality, trim(item->>'name'), (item->>'quantity')::numeric, (item->>'pricePaise')::integer
  from jsonb_array_elements(p_items) with ordinality as t(item, ordinality);

  insert into public.members (bill_id, user_id, name) values (new_bill.id, caller, trim(p_host_name));
  return new_bill.join_token;
end;
$$;

-- ponytail: anonymous users are cheap, so someone determined can use up the daily cap.
-- Manual entry still works when that happens. Add Turnstile to anonymous sign-in if it does.
create function public.take_parse_slot() returns text
language plpgsql security definer set search_path = '' as $$
declare
  caller uuid := auth.uid();
  limit_row public.limits;
begin
  if caller is null then raise exception 'not_signed_in'; end if;
  perform pg_advisory_xact_lock(hashtext('parse_slots'));
  select * into limit_row from public.limits;

  if (select count(*) from public.parse_log where created_at >= (now() at time zone 'utc')::date)
     >= limit_row.parses_per_day then
    return 'daily_limit';
  end if;
  if (select count(*) from public.parse_log where user_id = caller and created_at > now() - interval '1 hour')
     >= limit_row.parses_per_user_hour then
    return 'user_limit';
  end if;

  insert into public.parse_log (user_id) values (caller);
  return 'ok';
end;
$$;

revoke execute on function public.is_member(uuid), public.create_bill(text, text, integer, jsonb), public.take_parse_slot() from public, anon;
grant execute on function public.is_member(uuid), public.create_bill(text, text, integer, jsonb), public.take_parse_slot() to authenticated;
