
-- shared means "I also share whatever nobody counted". It works alongside a count.
alter table public.claims add column shared boolean not null default false;
alter table public.claims drop constraint claims_units_check;
alter table public.claims add constraint claims_has_portion check (units >= 0 and (units > 0 or shared));
alter table public.items add constraint items_quantity_max check (quantity <= 9999);

create or replace function public.set_claim(p_item uuid, p_units integer) returns void
language plpgsql security definer set search_path = '' as $$
declare
  caller uuid := auth.uid();
  target public.items;
  counted boolean;
  capacity integer;
begin
  select * into target from public.items where id = p_item;
  if not found or not exists (select 1 from public.members where bill_id = target.bill_id and user_id = caller) then
    raise exception 'not_member';
  end if;
  perform 1 from public.bills where id = target.bill_id for update;
  if exists (select 1 from public.bills where id = target.bill_id and split_mode = 'equal') then
    raise exception 'equal_mode';
  end if;
  -- Once someone has paid, a changed claim would change the amount they already sent.
  if exists (select 1 from public.members where bill_id = target.bill_id and paid_at is not null) then
    raise exception 'locked';
  end if;

  counted := target.quantity > 1 and target.quantity = trunc(target.quantity);
  capacity := case when counted then target.quantity::integer else 1 end;
  if p_units is null or p_units not between 0 and capacity then raise exception 'invalid_units'; end if;

  if p_units = 0 then
    delete from public.claims where item_id = p_item and user_id = caller and not shared;
    update public.claims set units = 0 where item_id = p_item and user_id = caller;
  else
    if counted and (
      select coalesce(sum(units), 0) from public.claims where item_id = p_item and user_id <> caller
    ) + p_units > capacity then
      raise exception 'none_left';
    end if;
    insert into public.claims (bill_id, item_id, user_id, units) values (target.bill_id, p_item, caller, p_units)
    on conflict (item_id, user_id) do update set units = excluded.units;
  end if;
  update public.bills set version = version + 1 where id = target.bill_id;
end;
$$;

create function public.set_shared(p_item uuid, p_shared boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare
  caller uuid := auth.uid();
  target public.items;
begin
  select * into target from public.items where id = p_item;
  if not found or not exists (select 1 from public.members where bill_id = target.bill_id and user_id = caller) then
    raise exception 'not_member';
  end if;
  perform 1 from public.bills where id = target.bill_id for update;
  if exists (select 1 from public.bills where id = target.bill_id and split_mode = 'equal') then
    raise exception 'equal_mode';
  end if;
  if exists (select 1 from public.members where bill_id = target.bill_id and paid_at is not null) then
    raise exception 'locked';
  end if;

  if p_shared then
    insert into public.claims (bill_id, item_id, user_id, units, shared) values (target.bill_id, p_item, caller, 0, true)
    on conflict (item_id, user_id) do update set shared = true;
  else
    delete from public.claims where item_id = p_item and user_id = caller and units = 0;
    update public.claims set shared = false where item_id = p_item and user_id = caller;
  end if;
  update public.bills set version = version + 1 where id = target.bill_id;
end;
$$;

-- Lets the host unblock a bill when an item is left over, for example a shared starter.
create function public.split_unclaimed(p_bill uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from public.bills where id = p_bill and host_id = auth.uid() for update;
  if not found then raise exception 'not_host'; end if;
  if exists (select 1 from public.members where bill_id = p_bill and paid_at is not null) then
    raise exception 'locked';
  end if;

  insert into public.claims (bill_id, item_id, user_id, units, shared)
  select p_bill, i.id, m.user_id, 0, true
  from public.items i
  cross join public.members m
  where i.bill_id = p_bill and m.bill_id = p_bill
    and not exists (select 1 from public.claims c where c.item_id = i.id and c.shared)
    and (select coalesce(sum(c.units), 0) from public.claims c where c.item_id = i.id)
        < case when i.quantity > 1 and i.quantity = trunc(i.quantity) then i.quantity else 1 end
  on conflict (item_id, user_id) do update set shared = true;

  update public.bills set version = version + 1 where id = p_bill;
end;
$$;

create or replace function public.set_paid(p_bill uuid, p_paid boolean) returns void
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
    if target.split_mode = 'items' then
      if exists (
        select 1 from public.items i
        where i.bill_id = p_bill
          and not exists (select 1 from public.claims c where c.item_id = i.id and c.shared)
          and (select coalesce(sum(c.units), 0) from public.claims c where c.item_id = i.id)
              < case when i.quantity > 1 and i.quantity = trunc(i.quantity) then i.quantity else 1 end
      ) then
        raise exception 'unclaimed_items';
      end if;
      if not exists (select 1 from public.claims where bill_id = p_bill and user_id = caller) then
        raise exception 'nothing_claimed';
      end if;
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

create or replace function public.join_bill(p_token text, p_name text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  caller uuid := auth.uid();
  target public.bills;
begin
  if caller is null then raise exception 'not_signed_in'; end if;
  select * into target from public.bills where join_token = p_token for update;
  if not found then raise exception 'not_found'; end if;
  if exists (select 1 from public.members where bill_id = target.id and user_id = caller) then return; end if;
  if (select count(*) from public.members where bill_id = target.id) >= 30 then
    raise exception 'bill_full';
  end if;
  -- A new person changes every equal share, so nobody can join after someone has paid.
  if target.split_mode = 'equal'
     and exists (select 1 from public.members where bill_id = target.id and paid_at is not null) then
    raise exception 'locked_equal';
  end if;
  if exists (select 1 from public.members where bill_id = target.id and lower(name) = lower(trim(p_name))) then
    raise exception 'name_taken';
  end if;

  insert into public.members (bill_id, user_id, name) values (target.id, caller, trim(p_name));
  update public.bills set version = version + 1 where id = target.id;
end;
$$;

create function public.remove_member(p_bill uuid, p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  target public.bills;
begin
  select * into target from public.bills where id = p_bill and host_id = auth.uid() for update;
  if not found then raise exception 'not_host'; end if;
  if p_user = target.host_id then raise exception 'host_cannot_leave'; end if;
  if exists (select 1 from public.members where bill_id = p_bill and paid_at is not null) then
    raise exception 'locked';
  end if;

  delete from public.claims where bill_id = p_bill and user_id = p_user;
  delete from public.members where bill_id = p_bill and user_id = p_user;
  update public.bills set version = version + 1 where id = p_bill;
end;
$$;

create function public.reject_paid(p_bill uuid, p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from public.bills where id = p_bill and host_id = auth.uid() for update;
  if not found then raise exception 'not_host'; end if;
  update public.members set paid_at = null, confirmed_at = null where bill_id = p_bill and user_id = p_user;
  update public.bills set version = version + 1 where id = p_bill;
end;
$$;

create function public.update_bill(p_bill uuid, p_host_vpa text, p_total_paise integer, p_items jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  entry jsonb;
  position_number bigint;
  existing_item uuid;
  old_quantity numeric;
begin
  perform 1 from public.bills where id = p_bill and host_id = auth.uid() for update;
  if not found then raise exception 'not_host'; end if;
  if exists (select 1 from public.members where bill_id = p_bill and paid_at is not null) then
    raise exception 'locked';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) not between 1 and 100 then
    raise exception 'invalid_items';
  end if;

  update public.bills set host_vpa = trim(p_host_vpa), total_paise = p_total_paise where id = p_bill;

  delete from public.items
  where bill_id = p_bill
    and id::text not in (select coalesce(e->>'id', '') from jsonb_array_elements(p_items) e);

  for entry, position_number in select e, o from jsonb_array_elements(p_items) with ordinality as t(e, o) loop
    existing_item := null;
    select id, quantity into existing_item, old_quantity from public.items
    where bill_id = p_bill and id::text = entry->>'id';

    if existing_item is null then
      insert into public.items (bill_id, position, name, quantity, price_paise)
      values (p_bill, position_number, trim(entry->>'name'), (entry->>'quantity')::numeric, (entry->>'pricePaise')::integer);
    else
      -- Counts no longer mean anything once the quantity changes, so people claim again.
      if old_quantity <> (entry->>'quantity')::numeric then
        delete from public.claims where item_id = existing_item;
      end if;
      update public.items
      set position = position_number, name = trim(entry->>'name'),
          quantity = (entry->>'quantity')::numeric, price_paise = (entry->>'pricePaise')::integer
      where id = existing_item;
    end if;
  end loop;

  if (select sum(price_paise) from public.items where bill_id = p_bill) = 0 then
    raise exception 'invalid_items';
  end if;
  update public.bills set version = version + 1 where id = p_bill;
end;
$$;

revoke execute on function public.set_shared(uuid, boolean), public.split_unclaimed(uuid), public.remove_member(uuid, uuid),
  public.reject_paid(uuid, uuid), public.update_bill(uuid, text, integer, jsonb) from public, anon;
grant execute on function public.set_shared(uuid, boolean), public.split_unclaimed(uuid), public.remove_member(uuid, uuid),
  public.reject_paid(uuid, uuid), public.update_bill(uuid, text, integer, jsonb) to authenticated;

-- Bills hold names and UPI IDs, so they don't stay forever.
create extension if not exists pg_cron with schema pg_catalog;
select cron.schedule('splitsnap-cleanup', '30 20 * * *', $job$
  delete from public.bills where created_at < now() - interval '30 days';
  delete from public.parse_log where created_at < now() - interval '2 days';
  delete from auth.users
  where is_anonymous and created_at < now() - interval '30 days'
    and id not in (select user_id from public.members);
$job$);
