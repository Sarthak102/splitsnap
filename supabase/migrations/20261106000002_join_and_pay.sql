
alter table public.bills add column version integer not null default 0;
alter table public.members
  add column paid_at timestamptz,
  add column confirmed_at timestamptz;

create table public.claims (
  bill_id uuid not null references public.bills on delete cascade,
  item_id uuid not null references public.items on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  primary key (item_id, user_id)
);
create index claims_bill on public.claims (bill_id);

alter table public.claims enable row level security;
revoke all on public.claims from anon, authenticated;
grant select on public.claims to authenticated;
create policy "members read claims" on public.claims for select to authenticated
  using (public.is_member(bill_id));

-- Clients refetch when version changes, so realtime only has to watch this one row.
alter publication supabase_realtime add table public.bills;

create or replace function public.create_bill(p_host_name text, p_host_vpa text, p_total_paise integer, p_items jsonb)
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

  -- Charges are shared in proportion to item prices, which needs a non-zero subtotal.
  if (select sum(price_paise) from public.items where bill_id = new_bill.id) = 0 then
    raise exception 'invalid_items';
  end if;

  insert into public.members (bill_id, user_id, name) values (new_bill.id, caller, trim(p_host_name));
  return new_bill.join_token;
end;
$$;

create function public.bill_preview(p_token text)
returns table (host_name text, total_paise integer)
language sql stable security definer set search_path = '' as $$
  select host_name, total_paise from public.bills where join_token = p_token;
$$;

create function public.join_bill(p_token text, p_name text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  caller uuid := auth.uid();
  target public.bills;
begin
  if caller is null then raise exception 'not_signed_in'; end if;
  select * into target from public.bills where join_token = p_token for update;
  if not found then raise exception 'not_found'; end if;
  if (select count(*) from public.members where bill_id = target.id) >= 30 then
    raise exception 'bill_full';
  end if;

  insert into public.members (bill_id, user_id, name) values (target.id, caller, trim(p_name))
  on conflict (bill_id, user_id) do nothing;
  update public.bills set version = version + 1 where id = target.id;
end;
$$;

create function public.set_claim(p_item uuid, p_claimed boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare
  caller uuid := auth.uid();
  target uuid;
begin
  select bill_id into target from public.items where id = p_item;
  if target is null or not exists (select 1 from public.members where bill_id = target and user_id = caller) then
    raise exception 'not_member';
  end if;
  perform 1 from public.bills where id = target for update;
  -- Once someone has paid, a changed claim would change the amount they already sent.
  if exists (select 1 from public.members where bill_id = target and paid_at is not null) then
    raise exception 'locked';
  end if;

  if p_claimed then
    insert into public.claims (bill_id, item_id, user_id) values (target, p_item, caller)
    on conflict do nothing;
  else
    delete from public.claims where item_id = p_item and user_id = caller;
  end if;
  update public.bills set version = version + 1 where id = target;
end;
$$;

create function public.set_paid(p_bill uuid, p_paid boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare
  caller uuid := auth.uid();
  target public.bills;
begin
  select * into target from public.bills where id = p_bill for update;
  if not found or not exists (select 1 from public.members where bill_id = p_bill and user_id = caller) then
    raise exception 'not_member';
  end if;
  if caller = target.host_id then raise exception 'host_cannot_pay'; end if;

  if p_paid then
    if exists (
      select 1 from public.items i
      where i.bill_id = p_bill and not exists (select 1 from public.claims c where c.item_id = i.id)
    ) then
      raise exception 'unclaimed_items';
    end if;
    if not exists (select 1 from public.claims where bill_id = p_bill and user_id = caller) then
      raise exception 'nothing_claimed';
    end if;
    update public.members set paid_at = now()
    where bill_id = p_bill and user_id = caller and paid_at is null;
  else
    update public.members set paid_at = null
    where bill_id = p_bill and user_id = caller and confirmed_at is null;
  end if;
  update public.bills set version = version + 1 where id = p_bill;
end;
$$;

create function public.confirm_paid(p_bill uuid, p_user uuid, p_confirmed boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from public.bills where id = p_bill and host_id = auth.uid() for update;
  if not found then raise exception 'not_host'; end if;

  update public.members
  set confirmed_at = case when p_confirmed then now() end
  where bill_id = p_bill and user_id = p_user and paid_at is not null;
  update public.bills set version = version + 1 where id = p_bill;
end;
$$;

revoke execute on function public.bill_preview(text), public.join_bill(text, text), public.set_claim(uuid, boolean),
  public.set_paid(uuid, boolean), public.confirm_paid(uuid, uuid, boolean) from public, anon;
grant execute on function public.bill_preview(text), public.join_bill(text, text), public.set_claim(uuid, boolean),
  public.set_paid(uuid, boolean), public.confirm_paid(uuid, uuid, boolean) to authenticated;
