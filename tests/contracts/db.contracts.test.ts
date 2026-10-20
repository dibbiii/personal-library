import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  bingoBoardResponseSchema,
  bookDetailResponseSchema,
  explorePoolResponseSchema,
  bookFormatChangeResponseSchema,
  bookSeriesChangeResponseSchema,
  genreChangeResponseSchema,
  genreViewResponseSchema,
  libraryHomeResponseSchema,
  queueAddResponseSchema,
  queueMutationResponseSchema,
  readingCalendarResponseSchema,
  readingMutationResultSchema,
  reviewSaveResultSchema,
  shelfPageResponseSchema,
  statsDashboardResponseSchema,
  themeMutationResponseSchema,
  yearStatsResponseSchema,
  userGenreShelvesResponseSchema,
} from '../../src/lib/contracts';
import { runDb } from '../helpers/env'; // first: sets DATABASE_URL defaults
import { createContractFixture, type ContractFixture } from '../helpers/fixture';
import { expectRpcContract } from '../helpers/rpc';
import { closeAdminSql, createTestUser } from '../helpers/users';
import { profileSummarySchema } from '../../src/lib/contracts/performance';
import './migrations.contracts';
import './auth.contracts';
import './rls.contracts';
import './catalog.contracts';
import './friendships.contracts';
import './seed.contracts';

(runDb ? describe : describe.skip)('PostgreSQL RPC contract v1', () => {
  let fx: ContractFixture;
  let fantasyReadingId: string;

  beforeAll(async () => {
    fx = await createContractFixture();
  });

  afterAll(async () => {
    if (fx) await fx.cleanup();
  });

  it('get_library_home matches the Zod contract', async () => {
    const home = await expectRpcContract(
      fx.client,
      'get_library_home',
      { p_shelf_limit: 24 },
      libraryHomeResponseSchema,
    );

    expect(home.contractVersion).toBe(1);
    expect(home.shelves).toHaveLength(8);
  });

  it('renames and reorders the eight personal shelves without changing home/view contracts', async () => {
    const initial = await expectRpcContract(
      fx.client,
      'get_user_genre_shelves',
      {},
      userGenreShelvesResponseSchema,
    );
    expect(initial.genres).toHaveLength(8);
    const genres = initial.genres.map((genre, index) => ({
      slug: genre.slug,
      name: genre.slug === 'fantasy-magical-gothic' ? 'Mondi fantastici' : genre.name,
      sort_order: initial.genres.length - index,
    }));
    const saved = await expectRpcContract(
      fx.client,
      'update_user_genre_shelves',
      { p_genres: genres },
      userGenreShelvesResponseSchema,
    );

    expect(saved.genres[0]?.slug).toBe(initial.genres[initial.genres.length - 1]?.slug);
    expect(saved.genres.find((genre) => genre.slug === 'fantasy-magical-gothic')?.name).toBe('Mondi fantastici');

    const home = await expectRpcContract(fx.client, 'get_library_home', { p_shelf_limit: 24 }, libraryHomeResponseSchema);
    expect(home.shelves[0]?.genre.slug).toBe(initial.genres[initial.genres.length - 1]?.slug);
    const view = await expectRpcContract(
      fx.client,
      'get_genre_view',
      { p_genre_slug: 'fantasy-magical-gothic', p_sort_field: 'title', p_sort_direction: 'asc', p_limit: 48, p_offset: 0 },
      genreViewResponseSchema,
    );
    expect(view.genre.name).toBe('Mondi fantastici');
  });

  it('get_shelf_page uses the keyset contract', async () => {
    const page = await expectRpcContract(
      fx.client,
      'get_shelf_page',
      {
        p_genre_slug: 'fantasy-magical-gothic',
        p_cursor_created_at: null,
        p_cursor_id: null,
        p_limit: 1,
      },
      shelfPageResponseSchema,
    );

    expect(page.data.genre.slug).toBe('fantasy-magical-gothic');
    expect(page.data.books[0]?.id).toBe(fx.books.fantasy);
  });

  it('implements the soft queue limit without corrupting the queue', async () => {
    for (const bookId of [fx.books.mythology, fx.books.classic, fx.books.romance]) {
      const result = await expectRpcContract(
        fx.client,
        'queue_add',
        { p_book_id: bookId, p_force: false },
        queueAddResponseSchema,
      );
      expect(result.status).toBe('added');
    }

    const confirmation = await expectRpcContract(
      fx.client,
      'queue_add',
      { p_book_id: fx.books.thriller, p_force: false },
      queueAddResponseSchema,
    );

    expect(confirmation.status).toBe('requiresConfirmation');
    expect(confirmation.currentCount).toBe(3);
    expect(confirmation.position).toBeNull();

    const forced = await expectRpcContract(
      fx.client,
      'queue_add',
      { p_book_id: fx.books.thriller, p_force: true },
      queueAddResponseSchema,
    );

    expect(forced.status).toBe('added');
    expect(forced.queue).toHaveLength(4);

    const moved = await expectRpcContract(
      fx.client,
      'queue_move',
      { p_book_id: fx.books.thriller, p_new_position: 1 },
      queueMutationResponseSchema,
    );
    expect(moved.queue[0]?.book.id).toBe(fx.books.thriller);
  });

  it('start/pause/resume/progress/correction/finish all return one reading contract', async () => {
    const started = await expectRpcContract(
      fx.client,
      'start_reading',
      {
        p_book_id: fx.books.fantasy,
        p_started_at: '2026-01-03T18:00:00+00:00',
        p_start_page: 0,
      },
      readingMutationResultSchema,
    );

    fantasyReadingId = started.reading.id;
    expect(started.reading.status).toBe('active');

    const p1Event = randomUUID();
    const progress = await expectRpcContract(
      fx.client,
      'record_progress',
      {
        p_event_id: p1Event,
        p_reading_id: fantasyReadingId,
        p_page: 120,
        p_occurred_at: '2026-01-04T20:00:00+00:00',
        p_local_date: '2026-01-04',
      },
      readingMutationResultSchema,
    );
    expect(progress.reading.currentPage).toBe(120);

    const duplicate = await expectRpcContract(
      fx.client,
      'record_progress',
      {
        p_event_id: p1Event,
        p_reading_id: fantasyReadingId,
        p_page: 120,
        p_occurred_at: '2026-01-04T20:00:00+00:00',
        p_local_date: '2026-01-04',
      },
      readingMutationResultSchema,
    );
    expect(duplicate.duplicate).toBe(true);

    const corrected = await expectRpcContract(
      fx.client,
      'correct_progress',
      {
        p_event_id: randomUUID(),
        p_reading_id: fantasyReadingId,
        p_page: 110,
        p_occurred_at: '2026-01-05T08:00:00+00:00',
        p_local_date: null,
      },
      readingMutationResultSchema,
    );
    expect(corrected.reading.currentPage).toBe(110);

    const paused = await expectRpcContract(
      fx.client,
      'pause_reading',
      { p_reading_id: fantasyReadingId },
      readingMutationResultSchema,
    );
    expect(paused.reading.status).toBe('paused');

    const resumed = await expectRpcContract(
      fx.client,
      'resume_reading',
      { p_reading_id: fantasyReadingId },
      readingMutationResultSchema,
    );
    expect(resumed.reading.status).toBe('active');

    const finished = await expectRpcContract(
      fx.client,
      'finish_reading',
      {
        p_event_id: randomUUID(),
        p_reading_id: fantasyReadingId,
        p_page: 662,
        p_occurred_at: '2026-01-18T21:00:00+00:00',
        p_local_date: '2026-01-18',
      },
      readingMutationResultSchema,
    );

    expect(finished.reading.status).toBe('completed');
    expect(finished.reading.endedAt).not.toBeNull();
  });

  it('save_review returns the complete review read model', async () => {
    const saved = await expectRpcContract(
      fx.client,
      'save_review',
      {
        p_book_id: fx.books.fantasy,
        p_rating: 4,
        p_adjectives: ['Epico', 'Malinconico', 'Immersivo'],
        p_scores: [
          { dimension_key: 'fantasy.worldbuilding', score: 5 },
          { dimension_key: 'fantasy.characters', score: 4 },
        ],
        p_tag_ids: [fx.tags.magic, fx.tags.romantico],
      },
      reviewSaveResultSchema,
    );

    expect(saved.review.rating).toBe(4);
    expect(saved.review.adjectives).toEqual(['Epico', 'Malinconico', 'Immersivo']);
    expect(saved.review.scores).toHaveLength(2);
  });

  it('get_book_detail returns the full aggregate', async () => {
    const detail = await expectRpcContract(
      fx.client,
      'get_book_detail',
      { p_book_id: fx.books.fantasy },
      bookDetailResponseSchema,
    );

    expect(detail.book.id).toBe(fx.books.fantasy);
    expect(detail.readings[0]?.sequence).toBe(1);
    expect(detail.review?.rating).toBe(4);
    expect(detail.seriesBooks).toEqual([
      { id: fx.books.fantasy, title: 'Il nome del vento', number: 1 }
    ]);
  });

  it('get_book_detail orders actual series books numerically by volume', async () => {
    const seriesName = `Serie ${randomUUID()}`;
    const variantSeriesName = `${seriesName.toUpperCase()}   `;
    const volumeOneId = randomUUID();
    const volumeTwoId = randomUUID();
    const volumeTenId = randomUUID();
    await fx.sql`
      insert into public.user_books (
        id, user_id, genre_id, title, author_display, format, series_name, series_number, series_total
      ) values
        (
          ${volumeTenId}::uuid, ${fx.userId}::uuid, 5, 'Volume dieci', 'Autore',
          'physical', ${seriesName}, 10, 10
        ),
        (
          ${volumeTwoId}::uuid, ${fx.userId}::uuid, 5, 'Volume due', 'Autore',
          'physical', ${variantSeriesName}, 2, 10
        ),
        (
          ${volumeOneId}::uuid, ${fx.userId}::uuid, 5, 'Volume uno', 'Autore',
          'physical', ${seriesName}, 1, 10
        )
    `;

    const detail = await expectRpcContract(
      fx.client,
      'get_book_detail',
      { p_book_id: volumeTenId },
      bookDetailResponseSchema
    );

    expect(detail.seriesBooks.map(({ id, number }) => [id, number])).toEqual([
      [volumeOneId, 1],
      [volumeTwoId, 2],
      [volumeTenId, 10]
    ]);
  });

  it('change_book_series updates the shared total across the user series', async () => {
    const volumeOneId = randomUUID();
    const volumeThreeId = randomUUID();
    const otherVolumeId = randomUUID();
    const seriesName = `Serie ${randomUUID()}`;
    const variantSeriesName = `${seriesName.toUpperCase()}   `;
    const otherUser = await createTestUser('series');
    try {
      await fx.sql`
        insert into public.user_books (
          id, user_id, genre_id, title, author_display, format, series_name, series_number, series_total
        ) values
          (
            ${volumeOneId}::uuid, ${fx.userId}::uuid, 5, 'Volume uno', 'Autore',
            'physical', ${seriesName}, 1, 3
          ),
          (
            ${volumeThreeId}::uuid, ${fx.userId}::uuid, 5, 'Volume tre', 'Autore',
            'physical', ${variantSeriesName}, 3, 3
          ),
          (
            ${otherVolumeId}::uuid, ${otherUser.id}::uuid, 5, 'Altro volume', 'Autore',
            'physical', ${seriesName}, 2, 3
          )
      `;

      const changed = await expectRpcContract(
        fx.client,
        'change_book_series',
        {
          p_book_id: volumeOneId,
          p_series_name: seriesName,
          p_series_number: 1,
          p_series_total: 5
        },
        bookSeriesChangeResponseSchema
      );
      const rows = await fx.sql<{ series_total: number }[]>`
        select series_total
        from public.user_books
        where user_id = ${fx.userId}::uuid
          and lower(btrim(series_name)) = lower(btrim(${seriesName}))
        order by series_number
      `;
      const otherRows = await fx.sql<{ series_total: number }[]>`
        select series_total
        from public.user_books
        where id = ${otherVolumeId}::uuid
      `;

      expect(changed.book.series).toEqual({ name: seriesName, number: 1, total: 5 });
      expect(rows.map(({ series_total }) => series_total)).toEqual([5, 5]);
      expect(otherRows.map(({ series_total }) => series_total)).toEqual([3]);
    } finally {
      await otherUser.cleanup();
    }
  });

  it('change_book_series preserves an existing destination total when moving volumes', async () => {
    const destinationVolumeOneId = randomUUID();
    const destinationVolumeEightId = randomUUID();
    const knownTotalBookId = randomUUID();
    const unknownTotalBookId = randomUUID();
    const destinationSeries = `Serie destinazione ${randomUUID()}`;
    const sourceSeries = `Serie origine ${randomUUID()}`;
    await fx.sql`
      insert into public.user_books (
        id, user_id, genre_id, title, author_display, format, series_name, series_number, series_total
      ) values
        (
          ${destinationVolumeOneId}::uuid, ${fx.userId}::uuid, 5, 'Destinazione uno', 'Autore',
          'physical', ${destinationSeries}, 1, 8
        ),
        (
          ${destinationVolumeEightId}::uuid, ${fx.userId}::uuid, 5, 'Destinazione otto', 'Autore',
          'physical', ${destinationSeries}, 8, 8
        ),
        (
          ${knownTotalBookId}::uuid, ${fx.userId}::uuid, 5, 'Volume con totale noto', 'Autore',
          'physical', ${sourceSeries}, 5, 5
        ),
        (
          ${unknownTotalBookId}::uuid, ${fx.userId}::uuid, 5, 'Volume senza totale', 'Autore',
          'physical', null, null, null
        )
    `;

    const movedFromKnownTotal = await expectRpcContract(
      fx.client,
      'change_book_series',
      {
        p_book_id: knownTotalBookId,
        p_series_name: destinationSeries,
        p_series_number: 6,
        p_series_total: 5
      },
      bookSeriesChangeResponseSchema
    );
    const movedFromUnknownTotal = await expectRpcContract(
      fx.client,
      'change_book_series',
      {
        p_book_id: unknownTotalBookId,
        p_series_name: destinationSeries,
        p_series_number: 7,
        p_series_total: null
      },
      bookSeriesChangeResponseSchema
    );
    const destinationRows = await fx.sql<{ series_number: number; series_total: number }[]>`
      select series_number::int as series_number, series_total
      from public.user_books
      where user_id = ${fx.userId}::uuid
        and lower(btrim(series_name)) = lower(btrim(${destinationSeries}))
      order by series_number
    `;

    expect(movedFromKnownTotal.book.series?.total).toBe(8);
    expect(movedFromUnknownTotal.book.series?.total).toBe(8);
    expect(destinationRows).toEqual([
      { series_number: 1, series_total: 8 },
      { series_number: 6, series_total: 8 },
      { series_number: 7, series_total: 8 },
      { series_number: 8, series_total: 8 }
    ]);
  });

  it('change_book_series applies a renamed series total only to the moved book', async () => {
    const movedBookId = randomUUID();
    const remainingBookId = randomUUID();
    const sourceSeries = `Serie originale ${randomUUID()}`;
    const newSeries = `Serie rinominata ${randomUUID()}`;
    await fx.sql`
      insert into public.user_books (
        id, user_id, genre_id, title, author_display, format, series_name, series_number, series_total
      ) values
        (
          ${movedBookId}::uuid, ${fx.userId}::uuid, 5, 'Volume spostato', 'Autore',
          'physical', ${sourceSeries}, 1, 5
        ),
        (
          ${remainingBookId}::uuid, ${fx.userId}::uuid, 5, 'Volume rimasto', 'Autore',
          'physical', ${sourceSeries}, 2, 5
        )
    `;

    const changed = await expectRpcContract(
      fx.client,
      'change_book_series',
      {
        p_book_id: movedBookId,
        p_series_name: newSeries,
        p_series_number: 1,
        p_series_total: 8
      },
      bookSeriesChangeResponseSchema
    );
    const rows = await fx.sql<{
      id: string;
      series_name: string;
      series_total: number;
    }[]>`
      select id::text, series_name, series_total
      from public.user_books
      where id in (${movedBookId}::uuid, ${remainingBookId}::uuid)
    `;

    expect(changed.book.series).toEqual({ name: newSeries, number: 1, total: 8 });
    expect(Object.fromEntries(rows.map(({ id, series_name, series_total }) => [
      id,
      { series_name, series_total }
    ]))).toEqual({
      [movedBookId]: { series_name: newSeries, series_total: 8 },
      [remainingBookId]: { series_name: sourceSeries, series_total: 5 }
    });
  });

  it('change_book_series rejects totals below existing volumes without partial updates', async () => {
    const volumeOneId = randomUUID();
    const volumeThreeId = randomUUID();
    const seriesName = `Serie ${randomUUID()}`;
    await fx.sql`
      insert into public.user_books (
        id, user_id, genre_id, title, author_display, format, series_name, series_number, series_total
      ) values
        (
          ${volumeOneId}::uuid, ${fx.userId}::uuid, 5, 'Volume uno', 'Autore',
          'physical', ${seriesName}, 1, 3
        ),
        (
          ${volumeThreeId}::uuid, ${fx.userId}::uuid, 5, 'Volume tre', 'Autore',
          'physical', ${seriesName}, 3, 3
        )
    `;

    const { error } = await fx.client.rpc('change_book_series', {
      p_book_id: volumeOneId,
      p_series_name: seriesName,
      p_series_number: 1,
      p_series_total: 2
    });
    const rows = await fx.sql<{ series_total: number }[]>`
      select series_total
      from public.user_books
      where user_id = ${fx.userId}::uuid
        and lower(btrim(series_name)) = lower(btrim(${seriesName}))
      order by series_number
    `;

    expect(error?.code).toBe('22023');
    expect(rows.map(({ series_total }) => series_total)).toEqual([3, 3]);
  });

  it('change_book_series rejects volume numbers that the database would round', async () => {
    const bookId = randomUUID();
    await fx.sql`
      insert into public.user_books (
        id, user_id, genre_id, title, author_display, format
      ) values (
        ${bookId}::uuid, ${fx.userId}::uuid, 5, 'Volume preciso', 'Autore', 'physical'
      )
    `;

    const { error } = await fx.client.rpc('change_book_series', {
      p_book_id: bookId,
      p_series_name: `Serie ${randomUUID()}`,
      p_series_number: 1.234,
      p_series_total: 3
    });
    const [row] = await fx.sql<{
      series_name: string | null;
      series_number: string | null;
      series_total: number | null;
    }[]>`
      select series_name, series_number::text, series_total
      from public.user_books
      where id = ${bookId}::uuid
    `;

    expect(error?.code).toBe('22023');
    expect(row).toEqual({ series_name: null, series_number: null, series_total: null });
  });

  it('get_genre_view preserves read/unread sections', async () => {
    const genre = await expectRpcContract(
      fx.client,
      'get_genre_view',
      {
        p_genre_slug: 'fantasy-magical-gothic',
        p_sort_field: 'rating',
        p_sort_direction: 'desc',
        p_limit: 48,
        p_offset: 0,
      },
      genreViewResponseSchema,
    );

    expect(genre.sections[0].key).toBe('read');
    expect(genre.sections[0].books[0]?.id).toBe(fx.books.fantasy);
  });

  it('historical completed reading removes its queued book in the same mutation', async () => {
    const queued = await expectRpcContract(
      fx.client,
      'queue_add',
      { p_book_id: fx.books.mythology, p_force: true },
      queueAddResponseSchema,
    );
    expect(queued.queue.some((entry) => entry.book.id === fx.books.mythology)).toBe(true);

    const result = await expectRpcContract(
      fx.client,
      'add_completed_reading',
      {
        p_book_id: fx.books.mythology,
        p_started_at: '2026-03-01T09:00:00+00:00',
        p_finished_at: '2026-03-10T20:00:00+00:00',
        p_final_page: 432,
        p_start_page: 10,
      },
      readingMutationResultSchema,
    );

    expect(result.reading.startPage).toBe(10);
    expect(result.reading.status).toBe('completed');

    const [{ count }] = (await fx.sql`
      select count(*)::int as count
      from public.reading_queue
      where user_id = ${fx.userId}::uuid
        and user_book_id = ${fx.books.mythology}::uuid
    `) as unknown as [{ count: number }];
    expect(count).toBe(0);
  });

  it('DNF is idempotent and appears in dashboard cemetery', async () => {
    // starting the queued thriller automatically removes it from the queue
    const started = await expectRpcContract(
      fx.client,
      'start_reading',
      {
        p_book_id: fx.books.thriller,
        p_started_at: '2026-04-01T18:00:00+00:00',
        p_start_page: 0,
      },
      readingMutationResultSchema,
    );

    const eventId = randomUUID();
    const dnf = await expectRpcContract(
      fx.client,
      'mark_dnf',
      {
        p_event_id: eventId,
        p_reading_id: started.reading.id,
        p_page: 58,
        p_occurred_at: '2026-04-03T19:00:00+00:00',
        p_local_date: '2026-04-03',
      },
      readingMutationResultSchema,
    );

    expect(dnf.reading.status).toBe('dnf');

    const summary2026 = await expectRpcContract(
      fx.client,
      'get_profile_summary',
      { p_collections: false, p_activity_limit: 0, p_year: 2026 },
      profileSummarySchema,
    );
    expect(summary2026.dnfCount).toBe(1);
    expect(summary2026.dnfCountForYear).toBe(1);

    const summary2025 = await expectRpcContract(
      fx.client,
      'get_profile_summary',
      { p_collections: false, p_activity_limit: 0, p_year: 2025 },
      profileSummarySchema,
    );
    expect(summary2025.dnfCount).toBe(1);
    expect(summary2025.dnfCountForYear).toBe(0);
  });

  it('calendar and annual statistics validate against their contracts', async () => {
    const calendar = await expectRpcContract(
      fx.client,
      'get_reading_calendar',
      { p_year: 2026 },
      readingCalendarResponseSchema,
    );
    expect(calendar.year).toBe(2026);

    const stats = await expectRpcContract(
      fx.client,
      'get_year_stats',
      { p_year: 2026 },
      yearStatsResponseSchema,
    );
    expect(stats.stats.booksFinished).toBeGreaterThanOrEqual(2);
  });

  it('explore pool contains only eligible unread books', async () => {
    const pool = await expectRpcContract(
      fx.client,
      'get_explore_pool',
      { p_genre_slugs: null },
      explorePoolResponseSchema,
    );

    expect(pool.books.every((book) => book.lifecycleState === 'unread')).toBe(true);
  });

  it('bingo read model and assignment mutation share one contract', async () => {
    const initial = await expectRpcContract(
      fx.client,
      'get_bingo_board',
      { p_year: 2026 },
      bingoBoardResponseSchema,
    );
    expect(initial.board.cells).toHaveLength(16);

    const assigned = await expectRpcContract(
      fx.client,
      'assign_bingo_book',
      {
        p_cell_id: fx.bingo.firstCellId,
        p_book_id: fx.books.fantasy,
      },
      bingoBoardResponseSchema,
    );

    expect(assigned.board.completedCount).toBe(1);
    expect(assigned.board.cells[0]?.book?.id).toBe(fx.books.fantasy);
  });

  it('genre change to Saggi persists in its own view and returns a reset signal', async () => {
    const changed = await expectRpcContract(
      fx.client,
      'change_book_genre',
      {
        p_book_id: fx.books.fantasy,
        p_genre_slug: 'essays',
      },
      genreChangeResponseSchema,
    );

    expect(changed.book.genre.slug).toBe('essays');
    expect(changed.reviewScoresReset).toBe(true);

    const view = await expectRpcContract(
      fx.client,
      'get_genre_view',
      {
        p_genre_slug: 'essays',
        p_sort_field: 'title',
        p_sort_direction: 'asc',
        p_limit: 48,
        p_offset: 0,
      },
      genreViewResponseSchema,
    );
    expect(view.genre).toMatchObject({ id: 8, slug: 'essays', name: 'Saggi' });
    expect(view.sections.flatMap((section) => section.books).map((book) => book.id)).toContain(
      fx.books.fantasy,
    );
  });

  it('book format accepts both owned formats and returns the summary contract', async () => {
    const changed = await expectRpcContract(
      fx.client,
      'change_book_format',
      { p_book_id: fx.books.classic, p_format: 'both' },
      bookFormatChangeResponseSchema,
    );

    expect(changed.book.format).toBe('both');
  });

  it('stats dashboard returns nested v1 read models', async () => {
    await fx.sql`
      insert into public.quotes (user_id, user_book_id, body, page)
      values (
        ${fx.userId}::uuid,
        ${fx.books.fantasy}::uuid,
        'Una citazione di contract test.',
        48
      )
    `;

    const dashboard = await expectRpcContract(
      fx.client,
      'get_stats_dashboard',
      { p_year: 2026 },
      statsDashboardResponseSchema,
    );

    expect(dashboard.bingo?.totalCount).toBe(16);
    expect(dashboard.dnf.some((entry) => entry.book.id === fx.books.thriller)).toBe(true);
  });

  it('theme selection is a versioned RPC contract', async () => {
    const current = await expectRpcContract(
      fx.client,
      'get_theme_selection',
      undefined,
      themeMutationResponseSchema,
    );
    expect(current.selection).toEqual({ kind: 'builtin', key: 'segnalibro' });

    const changed = await expectRpcContract(
      fx.client,
      'set_theme_selection',
      {
        p_kind: 'builtin',
        p_key: 'segnalibro',
        p_custom_theme_id: null,
      },
      themeMutationResponseSchema,
    );
    expect(changed.selection).toEqual({ kind: 'builtin', key: 'segnalibro' });
  });

  it('queue_remove compacts positions and keeps the contract', async () => {
    const before = await expectRpcContract(
      fx.client,
      'queue_move',
      { p_book_id: fx.books.classic, p_new_position: 1 },
      queueMutationResponseSchema,
    );
    expect(before.queue[0]?.book.id).toBe(fx.books.classic);

    const after = await expectRpcContract(
      fx.client,
      'queue_remove',
      { p_book_id: fx.books.classic },
      queueMutationResponseSchema,
    );
    expect(after.queue.some((entry) => entry.book.id === fx.books.classic)).toBe(false);
    expect(after.queue.map((entry) => entry.position)).toEqual(
      after.queue.map((_, index) => index + 1),
    );
  });

  it('record_progress is idempotent per eventId, also under concurrent retries', async () => {
    const started = await expectRpcContract(
      fx.client,
      'start_reading',
      {
        p_book_id: fx.books.classic,
        p_started_at: '2026-06-01T08:00:00+00:00',
        p_start_page: 0,
      },
      readingMutationResultSchema,
    );
    const readingId = started.reading.id;
    const eventId = randomUUID();
    const args = {
      p_event_id: eventId,
      p_reading_id: readingId,
      p_page: 50,
      p_occurred_at: '2026-06-01T20:00:00+00:00',
      p_local_date: '2026-06-01',
    };

    // The same offline event is flushed three times at once.
    const results = await Promise.all(
      [1, 2, 3].map(() => fx.client.rpc('record_progress', args)),
    );
    for (const result of results) expect(result.error).toBeNull();
    const parsed = results.map((r) => readingMutationResultSchema.parse(r.data));
    expect(parsed.filter((r) => !r.duplicate)).toHaveLength(1);
    expect(parsed.filter((r) => r.duplicate)).toHaveLength(2);
    expect(parsed.every((r) => r.reading.currentPage === 50)).toBe(true);

    const [stored] = await fx.sql<{ events: number; delta: number }[]>`
      select count(*)::int as events, coalesce(sum(page_delta), 0)::int as delta
      from public.reading_progress_events
      where reading_id = ${readingId}::uuid
    `;
    expect(stored).toEqual({ events: 1, delta: 50 });

    // A later retry with a different page but the same eventId changes nothing.
    const retry = await expectRpcContract(
      fx.client,
      'record_progress',
      { ...args, p_page: 99 },
      readingMutationResultSchema,
    );
    expect(retry.duplicate).toBe(true);
    expect(retry.reading.currentPage).toBe(50);

    // Re-using the event id for a different reading is a conflict, not a silent no-op.
    const other = await fx.client.rpc('record_progress', {
      ...args,
      p_reading_id: fantasyReadingId,
    });
    expect(other.error).not.toBeNull();
    expect(other.error?.code).toBe('23505');
  });

  it('queue soft limit: the 4th book needs confirmation and nothing is written', async () => {
    // Fresh user: the main flow above already reshuffled the fixture queue.
    const user = await createTestUser('queue');
    try {
      const ids: string[] = [];
      for (let i = 0; i < 4; i += 1) {
        const id = randomUUID();
        ids.push(id);
        await fx.sql`
          insert into public.user_books (id, user_id, genre_id, title, author_display, format)
          values (${id}::uuid, ${user.id}::uuid, 1, ${`Libro ${i}`}, 'Autore', 'physical')
        `;
      }

      for (const id of ids.slice(0, 3)) {
        const added = await expectRpcContract(
          user.rpc, 'queue_add', { p_book_id: id, p_force: false }, queueAddResponseSchema,
        );
        expect(added.status).toBe('added');
      }

      const again = await expectRpcContract(
        user.rpc, 'queue_add', { p_book_id: ids[0], p_force: false }, queueAddResponseSchema,
      );
      expect(again.status).toBe('alreadyQueued');

      const fourth = await expectRpcContract(
        user.rpc, 'queue_add', { p_book_id: ids[3], p_force: false }, queueAddResponseSchema,
      );
      expect(fourth.status).toBe('requiresConfirmation');
      expect(fourth.currentCount).toBe(3);
      expect(fourth.queue).toHaveLength(3);

      const [{ count }] = (await fx.sql`
        select count(*)::int as count from public.reading_queue where user_id = ${user.id}::uuid
      `) as unknown as [{ count: number }];
      expect(count).toBe(3);

      const forced = await expectRpcContract(
        user.rpc, 'queue_add', { p_book_id: ids[3], p_force: true }, queueAddResponseSchema,
      );
      expect(forced.status).toBe('added');
      expect(forced.position).toBe(4);
      expect(forced.queue.map((q) => q.position)).toEqual([1, 2, 3, 4]);
    } finally {
      await user.cleanup();
    }
  });
});

afterAll(async () => {
  await closeAdminSql();
  const { closeDb } = await import('../../src/lib/server/db');
  await closeDb();
});
