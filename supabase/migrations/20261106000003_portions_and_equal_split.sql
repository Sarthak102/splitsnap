
alter table public.claims add column units integer not null default 1 check (units > 0);
alter table public.bills add column split_mode text not null default 'items' check (split_mode in ('items', 'equal'));

drop function public.set_claim(uuid, boolean);

-- Whole quantities above 1 (5 rotis) are claimed by count. Anything else is shared equally by whoever taps it.
create function public.set_claim(p_item uuid, p_units integer) returns void
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
    delete from public.claims where item_id = p_item and user_id = caller;
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

create function public.set_split_mode(p_bill uuid, p_mode text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from public.bills where id = p_bill and host_id = auth.uid() for update;
  if not found then raise exception 'not_host'; end if;
  if exists (select 1 from public.members where bill_id = p_bill and paid_at is not null) then
    raise exception 'locked';
  end if;
  update public.bills set split_mode = p_mode, version = version + 1 where id = p_bill;
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

  insert into public.members (bill_id, user_id, name) values (target.id, caller, trim(p_name));
  update public.bills set version = version + 1 where id = target.id;
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
        where i.bill_id = p_bill and (
          select coalesce(sum(c.units), 0) from public.claims c where c.item_id = i.id
        ) < case when i.quantity > 1 and i.quantity = trunc(i.quantity) then i.quantity else 1 end
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

revoke execute on function public.set_claim(uuid, integer), public.set_split_mode(uuid, text) from public, anon;
grant execute on function public.set_claim(uuid, integer), public.set_split_mode(uuid, text) to authenticated;
