begin;

create or replace function public.add_completed_reading(
  p_book_id uuid,
  p_started_at timestamptz,
  p_finished_at timestamptz,
  p_final_page integer,
  p_start_page integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_uid();
  v_legacy jsonb;
  v_reading_id uuid;
begin
  if p_start_page is null or p_start_page < 0 then
    raise exception 'start_page must be >= 0';
  end if;

  if p_final_page is null or p_final_page < p_start_page then
    raise exception 'final_page must be >= start_page';
  end if;

  -- Migration 002's historical helper always inserts with start_page = 0.
  -- We invoke it, then immediately set the explicit historical start page in
  -- the same transaction. This preserves all projection triggers/validation.
  v_legacy := private.legacy_add_completed_reading(
    p_book_id,
    p_started_at,
    p_finished_at,
    p_final_page
  );

  v_reading_id := (v_legacy->>'readingId')::uuid;

  update public.readings r
  set start_page = p_start_page
  where r.id = v_reading_id
    and r.user_id = v_uid;

  -- Keep marking the book read and removing it from the queue atomic.
  perform private.legacy_queue_remove(p_book_id);

  return jsonb_build_object(
    'contractVersion', 1,
    'reading', private.contract_reading_json(v_uid, v_reading_id),
    'duplicate', false
  );
end;
$$;

commit;
