import { runDb } from '../helpers/env';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminSql, closeAdminSql, createTestUser, type TestUser } from '../helpers/users';
import { RpcPerformanceRepository } from '../../src/lib/data/performance-repository';
import { RpcLibraryRepository } from '../../src/lib/data/example-library-repository';
import { createPgRpcClient } from '../../src/lib/server/db';
import { mkdir, writeFile } from 'node:fs/promises';

(runDb ? describe : describe.skip)('bounded performance read models', () => {
	let alice: TestUser;
	let bob: TestUser;
	let repo: RpcPerformanceRepository;
	let bookId: string;
	beforeAll(async () => {
		alice = await createTestUser('performance');
		bob = await createTestUser('performance-other');
		repo = new RpcPerformanceRepository(alice.rpc);
		await adminSql()`insert into public.user_books(user_id,genre_id,title,author_display,page_count,language,format,source,completed_readings_count,lifecycle_state,review_rating)
			select ${alice.id}::uuid,1,'Libro '||n,'Autore '||n,case when n%10=0 then null else 200 end,
			'it','physical','manual',case when n<=2500 then 1 else 0 end,case when n<=2500 then 'finished' else 'unread' end,
			case when n<=2500 then 4 else null end from generate_series(1,5000) n`;
		const [book] =
			await adminSql()`select id from public.user_books where user_id=${alice.id}::uuid and title='Libro 1'`;
		bookId = book!.id;
		await adminSql()`insert into public.quotes(user_id,user_book_id,body)
			select ${alice.id}::uuid,${bookId}::uuid,'Citazione '||n from generate_series(1,601) n`;
	});
	afterAll(async () => {
		await alice?.cleanup();
		await bob?.cleanup();
		await closeAdminSql();
	});
	it('counts all 5000 books but sends only five favorites and four activities', async () => {
		const result = await repo.getProfileSummary(true, 4, 2026);
		expect(result.counts).toMatchObject({
			total: 5000,
			read: 2500,
			unread: 2500,
			physical: 5000,
			physicalUnread: 2500
		});
		expect(result.favorites).toHaveLength(5);
		expect(result.quoteCount).toBe(601);
		expect(result.dnfCountForYear).toBe(0);
		expect(result.activity.length).toBeLessThanOrEqual(4);
		const minimal = await repo.getProfileSummary(false, 0, 2026);
		expect(minimal.favorites).toHaveLength(0);
		expect(minimal.activity).toHaveLength(0);
	});
	it('discovery includes books beyond the previous shelf limit and remains user scoped', async () => {
		expect((await repo.getDiscoveryContext()).owned).toHaveLength(5000);
		expect((await new RpcPerformanceRepository(bob.rpc).getDiscoveryContext()).owned).toHaveLength(
			0
		);
	});
	it('paginates more than 500 quotes, with stable ties and globally complete book filters', async () => {
		const first = await repo.getQuotesPage(1, null);
		const second = await repo.getQuotesPage(2, null);
		expect(first.total).toBe(601);
		expect(first.quotes).toHaveLength(30);
		expect(second.quotes).toHaveLength(30);
		expect(second.quotes.some((q) => first.quotes.some((p) => p.id === q.id))).toBe(false);
		expect(first.books).toEqual([{ id: bookId, title: 'Libro 1' }]);
		const last = await repo.getQuotesPage(1000000, null);
		expect(last.page).toBe(21);
		expect(last.quotes).toHaveLength(1);
		expect((await new RpcPerformanceRepository(bob.rpc).getQuotesPage(1, bookId)).total).toBe(0);
	});
	it('paginates read and unread books independently beyond 200, including numeric Italian order', async () => {
		const input = {
			genre: 'classics',
			sortField: 'rating',
			direction: 'desc',
			unreadSort: 'title',
			readPage: 1,
			unreadPage: 1
		} as const;
		const first = await repo.getGenrePages(input);
		const second = await repo.getGenrePages({ ...input, unreadPage: 2 });
		expect(first.counts).toEqual({ total: 5000, read: 2500, unread: 2500 });
		expect(first.sections.map((s) => s.books.length)).toEqual([40, 40]);
		expect(second.sections[0].books).toEqual(first.sections[0].books);
		expect(
			second.sections[1].books.some((b) => first.sections[1].books.some((a) => a.id === b.id))
		).toBe(false);
		expect(first.sections[1].books[0]?.title).toBe('Libro 2501');
		const last = await repo.getGenrePages({ ...input, readPage: 1000000, unreadPage: 1000000 });
		expect(last.pages).toMatchObject({ read: 63, unread: 63 });
		expect(last.sections.map((s) => s.books.length)).toEqual([20, 20]);
	});
	it('rejects anonymous calls through the runtime role', async () => {
		await expect(
			new RpcPerformanceRepository(createPgRpcClient(null)).getQueueSummary()
		).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
	});
	it('preserves microsecond shelf cursors without skipping books with tied timestamps', async () => {
		await adminSql()`update public.user_books set created_at='2026-01-01T00:00:00.123456Z'::timestamptz where user_id=${alice.id}::uuid`;
		const library = new RpcLibraryRepository(alice.rpc);
		const first = await library.getShelfPage({ genre: 'classics', limit: 100 });
		expect(first.data.nextCursor?.createdAt).toContain('.123456');
		const second = await library.getShelfPage({ genre: 'classics', limit: 100, cursor: first.data.nextCursor! });
		expect(second.data.books).toHaveLength(100);
		expect(second.data.hasMore).toBe(true);
		expect(second.data.books.some((book) => first.data.books.some((previous) => previous.id === book.id))).toBe(false);
	});
	it('records representative query plans and five-sample payload/timing comparisons', async () => {
		// Fresh fixture rows need current planner statistics before measuring query plans.
		await adminSql()`analyze public.user_books`;
		await adminSql()`analyze public.quotes`;
		const timings: Record<string, { ms: number; bytes: number }[]> = {
			oldHome: [], summary: [], discovery: [], genreFirst: [], genreLast: [], quotesFirst: [], quotesLast: []
		};
		for (let n = 0; n < 5; n++) {
			for (const [label, name, args] of [
				['oldHome', 'get_library_home', { p_shelf_limit: 100 }],
				['summary', 'get_profile_summary', { p_collections: true, p_activity_limit: 4, p_year: 2026 }],
				['discovery', 'get_discovery_context', {}],
				['genreFirst', 'get_genre_pages', { p_genre_slug: 'classics', p_read_page: 1, p_unread_page: 1 }],
				['genreLast', 'get_genre_pages', { p_genre_slug: 'classics', p_read_page: 63, p_unread_page: 63 }],
				['quotesFirst', 'get_quotes_page', { p_page: 1 }],
				['quotesLast', 'get_quotes_page', { p_page: 21 }]
			] as const) {
				const start = performance.now();
				const result = await alice.rpc.rpc(name, args);
				expect(result.error).toBeNull();
				timings[label]!.push({
					ms: performance.now() - start,
					bytes: Buffer.byteLength(JSON.stringify(result.data))
				});
			}
		}
		const plans = await adminSql().begin(async (tx) => {
			await tx`set local role segnalibro_app`;
			await tx`select set_config('app.user_id',${alice.id},true)`;
			return {
				genre:
					await tx`explain (analyze,buffers,format json) select id from public.user_books where user_id=${alice.id}::uuid and genre_id=1 and completed_readings_count>0 order by review_rating desc nulls last,id limit 40`,
				quotes:
					await tx`explain (analyze,buffers,format json) select id from public.quotes where user_id=${alice.id}::uuid order by created_at desc,id desc limit 30`
			};
		});
		await mkdir('.tempo/performance', { recursive: true });
		await writeFile(
			'.tempo/performance/db-read-models.json',
			JSON.stringify({ fixture: { books: 5000, quotes: 601 }, timings, plans }, null, 2)
		);
	});
});
