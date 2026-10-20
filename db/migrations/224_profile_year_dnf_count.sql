-- Keep the profile summary's DNF total lifetime-scoped while exposing a
-- separate count for the year selected in the profile.
create function public.get_profile_summary(
  p_collections boolean,
  p_activity_limit integer,
  p_year integer
)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_uid();
begin
  return public.get_profile_summary(p_collections, p_activity_limit) ||
    jsonb_build_object(
      'dnfCountForYear',
      (
        select count(*)
        from public.user_books ub
        join lateral (
          select r.ended_at
          from public.readings r
          where r.user_id = v_uid
            and r.user_book_id = ub.id
            and r.status = 'dnf'
          order by r.ended_at desc, r.id
          limit 1
        ) r on true
        where ub.user_id = v_uid
          and ub.lifecycle_state = 'dnf'
          and ub.completed_readings_count = 0
          and extract(year from r.ended_at)::integer = p_year
      )
    );
end $$;

revoke execute on function public.get_profile_summary(boolean, integer, integer) from public;
grant execute on function public.get_profile_summary(boolean, integer, integer) to segnalibro_app;
