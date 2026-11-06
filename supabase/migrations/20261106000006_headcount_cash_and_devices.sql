
alter table public.bills add column people_count integer not null default 2 check (people_count between 1 and 30);
update public.bills b set people_count = (select count(*) from public.members m where m.bill_id = b.id);

alter table public.members
  add column offline boolean not null default false,
  add column paid_method text check (paid_method in ('upi', 'cash'));

-- People with no phone sit on a bill without an account, and seats can move between accounts.
alter table public.members drop constraint members_user_id_fkey;
alter table public.claims drop constraint claims_user_id_fkey;

create table public.host_keys (
  bill_id uuid primary key references public.bills on delete cascade,
  host_key text not null default replace(gen_random_uuid()::text, '-', '')
);
insert into public.host_keys (bill_id) select id from public.bills;
alter table public.host_keys enable row level security;
revoke all on public.host_keys from anon, authenticated;

drop function public.create_bill(text, text, integer, jsonb);
drop function public.set_claim(uuid, integer);
drop function public.set_shared(uuid, boolean);
drop function public.set_paid(uuid, boolean);

create function public.create_bill(p_host_name text, p_host_vpa text, p_total_paise integer, p_items jsonb, p_people integer)
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

  insert into public.bills (host_id, host_name, host_vpa, total_paise, people_count)
  values (caller, trim(p_host_name), trim(p_host_vpa), p_total_paise, p_people)
  returning * into new_bill;

  insert into public.items (bill_id, position, name, quantity, price_paise)
  select new_bill.id, ordinality, trim(item->>'name'), (item->>'quantity')::numeric, (item->>'pricePaise')::integer
  from jsonb_array_elements(p_items) with ordinality as t(item, ordinality);

  if (select sum(price_paise) from public.items where bill_id = new_bill.id) = 0 then
    raise exception 'invalid_items';
  end if;

  insert into public.members (bill_id, user_id, name) values (new_bill.id, caller, trim(p_host_name));
  insert into public.host_keys (bill_id) values (new_bill.id);
  return new_bill.join_token;
end;
$$;

-- Whose claim this is: your own, or a person without a phone if you're the host.
create function public.claim_actor(p_bill uuid, p_for uuid) returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare
  caller uuid := auth.uid();
begin
  if not exists (select 1 from public.members where bill_id = p_bill and user_id = caller) then
    raise exception 'not_member';
  end if;
  if p_for is null or p_for = caller then return caller; end if;
  if not exists (select 1 from public.bills where id = p_bill and host_id = caller)
     or not exists (select 1 from public.members where bill_id = p_bill and user_id = p_for and offline) then
    raise exception 'not_host';
  end if;
  return p_for;
end;
$$;

create function public.set_claim(p_item uuid, p_units integer, p_for uuid default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  target public.items;
  actor uuid;
  counted boolean;
  capacity integer;
begin
  select * into target from public.items where id = p_item;
  if not found then raise exception 'not_member'; end if;
  actor := public.claim_actor(target.bill_id, p_for);
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
    delete from public.claims where item_id = p_item and user_id = actor and not shared;
    update public.claims set units = 0 where item_id = p_item and user_id = actor;
  else
    if counted and (
      select coalesce(sum(units), 0) from public.claims where item_id = p_item and user_id <> actor
    ) + p_units > capacity then
      raise exception 'none_left';
    end if;
    insert into public.claims (bill_id, item_id, user_id, units) values (target.bill_id, p_item, actor, p_units)
    on conflict (item_id, user_id) do update set units = excluded.units;
  end if;
  update public.bills set version = version + 1 where id = target.bill_id;
end;
$$;

create function public.set_shared(p_item uuid, p_shared boolean, p_for uuid default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  target public.items;
  actor uuid;
begin
  select * into target from public.items where id = p_item;
  if not found then raise exception 'not_member'; end if;
  actor := public.claim_actor(target.bill_id, p_for);
  perform 1 from public.bills where id = target.bill_id for update;
  if exists (select 1 from public.bills where id = target.bill_id and split_mode = 'equal') then
    raise exception 'equal_mode';
  end if;
  if exists (select 1 from public.members where bill_id = target.bill_id and paid_at is not null) then
    raise exception 'locked';
  end if;

  if p_shared then
    insert into public.claims (bill_id, item_id, user_id, units, shared) values (target.bill_id, p_item, actor, 0, true)
    on conflict (item_id, user_id) do update set shared = true;
  else
    delete from public.claims where item_id = p_item and user_id = actor and units = 0;
    update public.claims set shared = false where item_id = p_item and user_id = actor;
  end if;
  update public.bills set version = version + 1 where id = target.bill_id;
end;
$$;

-- Shared by guest payments and the host recording cash: the bill has to be final first.
create function public.assert_ready_to_pay(target public.bills, payer uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if (select count(*) from public.members where bill_id = target.id) < target.people_count then
    raise exception 'waiting_for_people';
  end if;
  if target.split_mode = 'items' then
    if exists (
      select 1 from public.items i
      where i.bill_id = target.id
        and not exists (select 1 from public.claims c where c.item_id = i.id and c.shared)
        and (select coalesce(sum(c.units), 0) from public.claims c where c.item_id = i.id)
            < case when i.quantity > 1 and i.quantity = trunc(i.quantity) then i.quantity else 1 end
    ) then
      raise exception 'unclaimed_items';
    end if;
    if not exists (select 1 from public.claims where bill_id = target.id and user_id = payer) then
      raise exception 'nothing_claimed';
    end if;
  end if;
end;
$$;

create function public.set_paid(p_bill uuid, p_paid boolean, p_method text default 'upi') returns void
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
    perform public.assert_ready_to_pay(target, caller);
    update public.members set paid_at = now(), paid_method = p_method
    where bill_id = p_bill and user_id = caller and paid_at is null;
  else
    update public.members set paid_at = null, paid_method = null
    where bill_id = p_bill and user_id = caller and confirmed_at is null;
  end if;
  update public.bills set version = version + 1 where id = p_bill;
end;
$$;

create function public.host_got_cash(p_bill uuid, p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  target public.bills;
begin
  select * into target from public.bills where id = p_bill and host_id = auth.uid() for update;
  if not found then raise exception 'not_host'; end if;
  if p_user = target.host_id then raise exception 'host_cannot_pay'; end if;
  perform public.assert_ready_to_pay(target, p_user);
  update public.members set paid_at = now(), confirmed_at = now(), paid_method = 'cash'
  where bill_id = p_bill and user_id = p_user;
  update public.bills set version = version + 1 where id = p_bill;
end;
$$;

create or replace function public.reject_paid(p_bill uuid, p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from public.bills where id = p_bill and host_id = auth.uid() for update;
  if not found then raise exception 'not_host'; end if;
  update public.members set paid_at = null, confirmed_at = null, paid_method = null
  where bill_id = p_bill and user_id = p_user;
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
  if (select count(*) from public.members where bill_id = target.id) >= target.people_count then
    raise exception 'bill_full';
  end if;
  if exists (select 1 from public.members where bill_id = target.id and lower(name) = lower(trim(p_name))) then
    raise exception 'name_taken';
  end if;

  insert into public.members (bill_id, user_id, name) values (target.id, caller, trim(p_name));
  update public.bills set version = version + 1 where id = target.id;
end;
$$;

-- Lets a guest who changed phone or browser pick their seat back up.
create function public.bill_seats(p_token text)
returns table (user_id uuid, name text)
language sql stable security definer set search_path = '' as $$
  select m.user_id, m.name
  from public.members m join public.bills b on b.id = m.bill_id
  where b.join_token = p_token and m.user_id <> b.host_id and m.paid_at is null
  order by m.name;
$$;

-- ponytail: anyone with the link can take an unpaid seat, which is fine among friends.
-- Paid seats and the host seat can't be taken, and the host confirms every payment.
create function public.take_seat(p_token text, p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  caller uuid := auth.uid();
  target public.bills;
begin
  if caller is null then raise exception 'not_signed_in'; end if;
  select * into target from public.bills where join_token = p_token for update;
  if not found then raise exception 'not_found'; end if;
  if exists (select 1 from public.members where bill_id = target.id and user_id = caller) then
    raise exception 'already_joined';
  end if;
  if p_user = target.host_id
     or not exists (select 1 from public.members where bill_id = target.id and user_id = p_user and paid_at is null) then
    raise exception 'seat_unavailable';
  end if;

  update public.members set user_id = caller, offline = false where bill_id = target.id and user_id = p_user;
  update public.claims set user_id = caller where bill_id = target.id and user_id = p_user;
  update public.bills set version = version + 1 where id = target.id;
end;
$$;

create function public.get_host_key(p_bill uuid) returns text
language sql stable security definer set search_path = '' as $$
  select k.host_key
  from public.host_keys k join public.bills b on b.id = k.bill_id
  where b.id = p_bill and b.host_id = (select auth.uid());
$$;

create function public.take_host(p_token text, p_key text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  caller uuid := auth.uid();
  target public.bills;
begin
  if caller is null then raise exception 'not_signed_in'; end if;
  select * into target from public.bills where join_token = p_token for update;
  if not found or not exists (
    select 1 from public.host_keys where bill_id = target.id and host_key = p_key
  ) then
    raise exception 'bad_host_key';
  end if;
  if target.host_id = caller then return; end if;

  -- This browser may have joined as a guest by accident before opening the host link.
  delete from public.claims where bill_id = target.id and user_id = caller;
  delete from public.members where bill_id = target.id and user_id = caller;
  update public.members set user_id = caller where bill_id = target.id and user_id = target.host_id;
  update public.claims set user_id = caller where bill_id = target.id and user_id = target.host_id;
  update public.bills set host_id = caller, version = version + 1 where id = target.id;
end;
$$;

create function public.set_people(p_bill uuid, p_people integer) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from public.bills where id = p_bill and host_id = auth.uid() for update;
  if not found then raise exception 'not_host'; end if;
  if exists (select 1 from public.members where bill_id = p_bill and paid_at is not null) then
    raise exception 'locked';
  end if;
  if p_people is null or p_people not between 1 and 30
     or p_people < (select count(*) from public.members where bill_id = p_bill) then
    raise exception 'too_few_people';
  end if;
  update public.bills set people_count = p_people, version = version + 1 where id = p_bill;
end;
$$;

create function public.add_person(p_bill uuid, p_name text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  target public.bills;
begin
  select * into target from public.bills where id = p_bill and host_id = auth.uid() for update;
  if not found then raise exception 'not_host'; end if;
  if exists (select 1 from public.members where bill_id = p_bill and paid_at is not null) then
    raise exception 'locked';
  end if;
  if (select count(*) from public.members where bill_id = p_bill) >= target.people_count then
    raise exception 'bill_full';
  end if;
  if exists (select 1 from public.members where bill_id = p_bill and lower(name) = lower(trim(p_name))) then
    raise exception 'name_taken';
  end if;
  insert into public.members (bill_id, user_id, name, offline) values (p_bill, gen_random_uuid(), trim(p_name), true);
  update public.bills set version = version + 1 where id = p_bill;
end;
$$;

revoke execute on function public.create_bill(text, text, integer, jsonb, integer), public.claim_actor(uuid, uuid),
  public.set_claim(uuid, integer, uuid), public.set_shared(uuid, boolean, uuid),
  public.assert_ready_to_pay(public.bills, uuid), public.set_paid(uuid, boolean, text),
  public.host_got_cash(uuid, uuid), public.bill_seats(text), public.take_seat(text, uuid),
  public.get_host_key(uuid), public.take_host(text, text), public.set_people(uuid, integer),
  public.add_person(uuid, text) from public, anon;
grant execute on function public.create_bill(text, text, integer, jsonb, integer),
  public.set_claim(uuid, integer, uuid), public.set_shared(uuid, boolean, uuid), public.set_paid(uuid, boolean, text),
  public.host_got_cash(uuid, uuid), public.bill_seats(text), public.take_seat(text, uuid),
  public.get_host_key(uuid), public.take_host(text, text), public.set_people(uuid, integer),
  public.add_person(uuid, text) to authenticated;
