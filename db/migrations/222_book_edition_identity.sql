begin;

-- Expose the saved edition's provider identity so edit flows can recognize the
-- same Open Library edition without treating it as a metadata change.
create or replace function private.contract_book_summary_json(
  p_user_id uuid,
  p_book_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', ub.id,
    'editionId', case when ub.edition_id is null then null else ub.edition_id::text end,
    'isbn', coalesce(ub.isbn_13, e.isbn_13),
    'openLibraryEditionId', e.open_library_edition_id,
    'title', ub.title,
    'author', ub.author_display,
    'pageCount', ub.page_count,
    'language', ub.language,
    'format', ub.format,
    'source', ub.source,
    'genre', private.user_genre_json(p_user_id, ub.genre_id),
    'series', case when ub.series_name is null then null else jsonb_build_object(
      'name', ub.series_name,
      'number', ub.series_number,
      'total', ub.series_total
    ) end,
    'lifecycleState', ub.lifecycle_state,
    'completedReadingsCount', ub.completed_readings_count,
    'reviewRating', ub.review_rating,
    'lastFinishedAt', ub.last_finished_at,
    'lastActivityAt', ub.last_activity_at,
    'cover', jsonb_build_object(
      'coverUrl', ub.cover_url,
      'coverStoragePath', ub.cover_storage_path
    )
  )
  from public.user_books ub
  left join public.editions e on e.id = ub.edition_id
  where ub.id = p_book_id and ub.user_id = p_user_id
$$;

commit;
