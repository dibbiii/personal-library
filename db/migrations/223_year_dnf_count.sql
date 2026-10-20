create function public.get_year_dnf_count(p_year integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  v_timezone text;
  v_count integer;
begin
  if p_year not between 1900 and 2200 then
    raise exception 'Invalid year';
  end if;

  select coalesce(p.timezone, 'UTC')
    into v_timezone
  from public.profiles p
  where p.id = v_uid;

  -- Count distinct books marked DNF in the profile-local year, including books
  -- that were later resumed and are no longer in the current cemetery.
  select count(distinct r.user_book_id)::integer
    into v_count
  from public.readings r
  where r.user_id = v_uid
    and r.status = 'dnf'
    and extract(year from (r.ended_at at time zone coalesce(v_timezone, 'UTC')))::integer = p_year;

  return jsonb_build_object(
    'contractVersion', 1,
    'year', p_year,
    'count', coalesce(v_count, 0)
  );
end;
$$;

revoke execute on function public.get_year_dnf_count(integer) from public;
grant execute on function public.get_year_dnf_count(integer) to segnalibro_app;
