-- Fixes editing an item's quantity, which 004 shipped broken.

create or replace function public.update_bill(p_bill uuid, p_host_vpa text, p_total_paise integer, p_items jsonb) returns void
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

