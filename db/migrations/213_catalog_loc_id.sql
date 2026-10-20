-- Library of Congress edition identifier (LCCN, MARC 001). v2 stays available
-- for older containers during rollout; the runtime calls v3 with p_loc_id.
begin;
alter table public.editions add column loc_id text;
alter table public.editions add constraint editions_loc_id_chk check (loc_id is null or loc_id ~ '^[A-Z0-9][A-Z0-9 ]{0,31}$');
create unique index editions_loc_uidx on public.editions(loc_id) where loc_id is not null;
create or replace function app.catalog_upsert_edition_v3(
  p_title                    text,
  p_authors                  text[]   default '{}',
  p_original_title           text     default null,
  p_first_published_year     smallint default null,
  p_open_library_work_id     text     default null,
  p_open_library_author_ids  text[]   default null,
  p_work_id                  bigint   default null,
  p_isbn_10                  text     default null,
  p_isbn_13                  text     default null,
  p_language                 text     default null,
  p_publisher                text     default null,
  p_published_date           date     default null,
  p_published_year           smallint default null,
  p_page_count               integer  default null,
  p_google_books_id          text     default null,
  p_open_library_edition_id  text     default null,
  p_cover_provider           text     default null,
  p_cover_ref                text     default null,
  p_cover_url                text     default null,
  p_inventaire_id            text     default null,
  p_sbn_id                   text     default null,
  p_loc_id                   text     default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_edition     public.editions%rowtype;
  v_work_id     bigint;
  v_author_id   bigint;
  v_name        text;
  v_ol_id       text;
  v_pos         integer;
  v_created     boolean := false;
begin
  if app.current_user_id() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if p_title is null or btrim(p_title) = '' then
    raise exception 'title is required' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('segnalibro.catalog_upsert', 0)
  );

  -- 1. existing edition by strong identifier (priority order)
  select e.* into v_edition
  from public.editions e
  where (p_isbn_13 is not null and e.isbn_13 = p_isbn_13)
     or (p_isbn_10 is not null and e.isbn_10 = p_isbn_10)
     or (p_open_library_edition_id is not null
         and e.open_library_edition_id = p_open_library_edition_id and (p_isbn_13 is null or e.isbn_13 is null or e.isbn_13 = p_isbn_13))
     or (p_google_books_id is not null and e.google_books_id = p_google_books_id and (p_isbn_13 is null or e.isbn_13 is null or e.isbn_13 = p_isbn_13))
     or (p_inventaire_id is not null and e.inventaire_id = p_inventaire_id and (p_isbn_13 is null or e.isbn_13 is null or e.isbn_13 = p_isbn_13))
     or (p_sbn_id is not null and e.sbn_id = p_sbn_id and (p_isbn_13 is null or e.isbn_13 is null or e.isbn_13 = p_isbn_13))
     or (p_loc_id is not null and e.loc_id = p_loc_id and (p_isbn_13 is null or e.isbn_13 is null or e.isbn_13 = p_isbn_13))
  order by
    (e.isbn_13 is not distinct from p_isbn_13 and p_isbn_13 is not null) desc,
    (e.isbn_10 is not distinct from p_isbn_10 and p_isbn_10 is not null) desc,
    e.id
  limit 1;

  if found then
    update public.editions e
    set
      isbn_10 = coalesce(e.isbn_10, case
        when p_isbn_10 is not null and not exists (
          select 1 from public.editions o where o.isbn_10 = p_isbn_10 and o.id <> e.id
        ) then p_isbn_10 end),
      isbn_13 = coalesce(e.isbn_13, case
        when p_isbn_13 is not null and not exists (
          select 1 from public.editions o where o.isbn_13 = p_isbn_13 and o.id <> e.id
        ) then p_isbn_13 end),
      google_books_id = coalesce(e.google_books_id, case
        when p_google_books_id is not null and not exists (
          select 1 from public.editions o
          where o.google_books_id = p_google_books_id and o.id <> e.id
        ) then p_google_books_id end),
      open_library_edition_id = coalesce(e.open_library_edition_id, case
        when p_open_library_edition_id is not null and not exists (
          select 1 from public.editions o
          where o.open_library_edition_id = p_open_library_edition_id and o.id <> e.id
        ) then p_open_library_edition_id end),
      inventaire_id = coalesce(e.inventaire_id, case when p_inventaire_id is not null and not exists (select 1 from public.editions o where o.inventaire_id = p_inventaire_id and o.id <> e.id) then p_inventaire_id end),
      sbn_id = coalesce(e.sbn_id, case when p_sbn_id is not null and not exists (select 1 from public.editions o where o.sbn_id = p_sbn_id and o.id <> e.id) then p_sbn_id end),
      loc_id = coalesce(e.loc_id, case when p_loc_id is not null and not exists (select 1 from public.editions o where o.loc_id = p_loc_id and o.id <> e.id) then p_loc_id end),
      language        = coalesce(e.language, p_language),
      publisher       = coalesce(e.publisher, p_publisher),
      published_date  = coalesce(e.published_date, p_published_date),
      published_year  = coalesce(e.published_year, p_published_year),
      page_count      = coalesce(e.page_count, p_page_count),
      cover_provider  = coalesce(e.cover_provider, p_cover_provider),
      cover_ref       = coalesce(e.cover_ref, p_cover_ref),
      cover_url       = coalesce(e.cover_url, p_cover_url)
    where e.id = v_edition.id;

    return jsonb_build_object(
      'workId', v_edition.work_id::text,
      'editionId', v_edition.id::text,
      'created', false
    );
  end if;

  -- 2. choose / create the work
  if p_work_id is not null then
    select w.id into v_work_id from public.works w where w.id = p_work_id;
    if v_work_id is null then
      raise exception 'Work not found' using errcode = 'P0002';
    end if;
  elsif p_open_library_work_id is not null then
    select w.id into v_work_id
    from public.works w
    where w.open_library_work_id = p_open_library_work_id;
  end if;

  if v_work_id is null then
    insert into public.works (
      title, original_title, first_published_year, open_library_work_id
    )
    values (
      btrim(p_title),
      nullif(btrim(p_original_title), ''),
      p_first_published_year,
      p_open_library_work_id
    )
    returning id into v_work_id;

    v_pos := 0;
    foreach v_name in array coalesce(p_authors, '{}'::text[])
    loop
      v_pos := v_pos + 1;
      v_name := btrim(v_name);
      continue when v_name is null or v_name = '';

      v_ol_id := null;
      if p_open_library_author_ids is not null then
        v_ol_id := nullif(btrim(p_open_library_author_ids[v_pos]), '');
      end if;

      v_author_id := null;
      if v_ol_id is not null then
        select a.id into v_author_id
        from public.authors a
        where a.open_library_author_id = v_ol_id;
      end if;

      if v_author_id is null then
        select a.id into v_author_id
        from public.authors a
        where lower(a.name) = lower(v_name)
          and (a.open_library_author_id is null or v_ol_id is null)
        order by a.id
        limit 1;
      end if;

      if v_author_id is null then
        insert into public.authors (name, open_library_author_id)
        values (v_name, v_ol_id)
        returning id into v_author_id;
      end if;

      insert into public.work_authors (work_id, author_id, position)
      values (v_work_id, v_author_id, v_pos)
      on conflict do nothing;
    end loop;
  end if;

  insert into public.editions (
    work_id, isbn_10, isbn_13, language, publisher, published_date,
    published_year, page_count, google_books_id, open_library_edition_id,
    cover_provider, cover_ref, cover_url, inventaire_id, sbn_id, loc_id
  )
  values (
    v_work_id, p_isbn_10, p_isbn_13, p_language, p_publisher, p_published_date,
    p_published_year, p_page_count,
    case when not exists (select 1 from public.editions e where e.google_books_id = p_google_books_id) then p_google_books_id end,
    case when not exists (select 1 from public.editions e where e.open_library_edition_id = p_open_library_edition_id) then p_open_library_edition_id end,
    p_cover_provider, p_cover_ref, p_cover_url,
    case when not exists (select 1 from public.editions e where e.inventaire_id = p_inventaire_id) then p_inventaire_id end,
    case when not exists (select 1 from public.editions e where e.sbn_id = p_sbn_id) then p_sbn_id end,
    case when not exists (select 1 from public.editions e where e.loc_id = p_loc_id) then p_loc_id end
  )
  returning * into v_edition;

  v_created := true;

  return jsonb_build_object(
    'workId', v_work_id::text,
    'editionId', v_edition.id::text,
    'created', v_created
  );
end;
$$;

revoke all on function app.catalog_upsert_edition_v3(text, text[], text, smallint, text, text[], bigint, text, text, text, text, date, smallint, integer, text, text, text, text, text, text, text, text) from public;
grant execute on function app.catalog_upsert_edition_v3(text, text[], text, smallint, text, text[], bigint, text, text, text, text, date, smallint, integer, text, text, text, text, text, text, text, text) to segnalibro_app;
commit;
