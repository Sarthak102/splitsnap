-- Lets the host pick items for any guest, not only people with no phone.

create or replace function public.claim_actor(p_bill uuid, p_for uuid) returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare
  caller uuid := auth.uid();
begin
  if not exists (select 1 from public.members where bill_id = p_bill and user_id = caller) then
    raise exception 'not_member';
  end if;
  if p_for is null or p_for = caller then return caller; end if;
  if not exists (select 1 from public.bills where id = p_bill and host_id = caller)
     or not exists (select 1 from public.members where bill_id = p_bill and user_id = p_for) then
    raise exception 'not_host';
  end if;
  return p_for;
end;
$$;
