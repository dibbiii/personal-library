// Registered by db.contracts.test.ts: the only write path into the shared catalog.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ServerCatalogRepository } from '../../src/lib/data/catalog-repository';
import { sql, upsertCatalogEdition } from '../../src/lib/server/db';
import type { AddBookInput, AddBookResponse, UpdateBookInput } from '../../src/lib/catalog/schemas';
import { runDb } from '../helpers/env';
import { adminSql, createTestUser, type TestUser } from '../helpers/users';

(runDb ? describe : describe.skip)('catalog writes (app.catalog_upsert_edition)', () => {
	let user: TestUser;
	const tag = randomUUID().slice(0, 8);
	const digits = () => String(Math.floor(Math.random() * 1e9)).padStart(9, '0');
	const isbn13 = () => `979${digits()}0`;
	const validIsbn13 = () => {
		const body = `979${digits()}`;
		const sum = [...body].reduce(
			(total, digit, index) => total + Number(digit) * (index % 2 === 0 ? 1 : 3),
			0
		);
		return `${body}${(10 - (sum % 10)) % 10}`;
	};

	beforeAll(async () => {
		user = await createTestUser('catalog');
	});

	afterAll(async () => {
		const db = adminSql();
		await db`delete from public.works where title like ${`Contract ${tag}%`} or open_library_work_id like ${`OLW-${tag}%`}`;
		await db`delete from public.authors where name like ${`Contract ${tag}%`} or open_library_author_id like ${`OLA-${tag}%`}`;
		await user?.cleanup();
	});

	it('creates work, authors (ordered) and edition, ids as strings', async () => {
		const isbn = isbn13();
		const result = await upsertCatalogEdition(user.id, {
			title: `Contract ${tag} Dune`,
			authors: [`Contract ${tag} Herbert`, `Contract ${tag} Anderson`],
			openLibraryWorkId: `OLW-${tag}-dune`,
			openLibraryAuthorIds: [`OLA-${tag}-h`, null],
			firstPublishedYear: 1965,
			isbn13: isbn,
			language: 'it',
			pageCount: 712,
			coverProvider: 'open-library',
			coverUrl: 'https://covers.openlibrary.org/b/id/1-L.jpg'
		});
		expect(result.created).toBe(true);
		expect(result.workId).toMatch(/^\d+$/);
		expect(result.editionId).toMatch(/^\d+$/);

		const authors = await adminSql()<{ name: string; position: number; ol: string | null }[]>`
			select a.name, wa.position, a.open_library_author_id as ol
			from public.work_authors wa join public.authors a on a.id = wa.author_id
			where wa.work_id = ${result.workId}::bigint order by wa.position
		`;
		expect(authors).toEqual([
			{ name: `Contract ${tag} Herbert`, position: 1, ol: `OLA-${tag}-h` },
			{ name: `Contract ${tag} Anderson`, position: 2, ol: null }
		]);

		// readable by the runtime role, which cannot write the tables directly
		const [row] = await sql<{ page_count: number }[]>`select page_count from public.editions where id = ${result.editionId}::bigint`;
		expect(row?.page_count).toBe(712);
	});

	it('matches an existing edition by ISBN, only fills NULL columns and never overwrites', async () => {
		const isbn = isbn13();
		const first = await upsertCatalogEdition(user.id, {
			title: `Contract ${tag} Match`,
			authors: [`Contract ${tag} Autore`],
			isbn13: isbn,
			publisher: 'Prima'
		});
		const second = await upsertCatalogEdition(user.id, {
			title: `Contract ${tag} Match (altro titolo)`,
			isbn13: isbn,
			publisher: 'Seconda',
			pageCount: 321,
			googleBooksId: `gb-${tag}-1`
		});
		expect(second).toEqual({ workId: first.workId, editionId: first.editionId, created: false });

		const [row] = await adminSql()<{ publisher: string; page_count: number; google_books_id: string }[]>`
			select publisher, page_count, google_books_id from public.editions where id = ${first.editionId}::bigint
		`;
		expect(row).toEqual({ publisher: 'Prima', page_count: 321, google_books_id: `gb-${tag}-1` });

		// found again through another strong identifier
		const third = await upsertCatalogEdition(user.id, { title: 'irrilevante', googleBooksId: `gb-${tag}-1` });
		expect(third.editionId).toBe(first.editionId);
	});

	it('never merges editions by title + author alone', async () => {
		const a = await upsertCatalogEdition(user.id, { title: `Contract ${tag} Stesso`, authors: [`Contract ${tag} X`], isbn13: isbn13() });
		const b = await upsertCatalogEdition(user.id, { title: `Contract ${tag} Stesso`, authors: [`Contract ${tag} X`], isbn13: isbn13() });
		expect(b.created).toBe(true);
		expect(b.editionId).not.toBe(a.editionId);
		expect(b.workId).not.toBe(a.workId);

		// an explicit workId attaches a second edition to the same work
		const c = await upsertCatalogEdition(user.id, { title: 'ignored', workId: a.workId, isbn13: isbn13(), language: 'en' });
		expect(c.workId).toBe(a.workId);
		expect(c.editionId).not.toBe(a.editionId);

		// the same Open Library work id reuses the work (and its authors)
		const d = await upsertCatalogEdition(user.id, { title: `Contract ${tag} OL`, openLibraryWorkId: `OLW-${tag}-same`, isbn13: isbn13() });
		const e = await upsertCatalogEdition(user.id, { title: `Contract ${tag} OL`, openLibraryWorkId: `OLW-${tag}-same`, isbn13: isbn13() });
		expect(e.workId).toBe(d.workId);
		expect(e.editionId).not.toBe(d.editionId);
	});

	it('reuses SBN and Inventaire records without ISBN, enriches only missing fields', async () => {
		const sbnId = `TST${digits().slice(0, 7)}`;
		const invId = `inv:${randomUUID().replaceAll('-', '')}`;
		const first = await upsertCatalogEdition(user.id, { title: `Contract ${tag} New sources`, authors: [`Contract ${tag} X`], sbnId, publisher: 'Original' });
		const second = await upsertCatalogEdition(user.id, { title: 'irrelevant', sbnId, inventaireId: invId, publisher: 'Other', pageCount: 200 });
		expect(second).toEqual({ ...first, created: false });
		const third = await upsertCatalogEdition(user.id, { title: 'irrelevant', inventaireId: invId });
		expect(third.editionId).toBe(first.editionId);
		const [row] = await adminSql()`select sbn_id, inventaire_id, publisher, page_count from public.editions where id = ${first.editionId}::bigint`;
		expect(row).toEqual({ sbn_id: sbnId, inventaire_id: invId, publisher: 'Original', page_count: 200 });
	});

	it('keeps different ISBN editions separate when a provider reuses an id', async () => {
		const id = `gb-${tag}-conflict`;
		const firstIsbn = isbn13(); const secondIsbn = isbn13();
		const first = await upsertCatalogEdition(user.id, { title: `Contract ${tag} Provider conflict`, googleBooksId: id, isbn13: firstIsbn, publishedYear: 2000 });
		const second = await upsertCatalogEdition(user.id, { title: `Contract ${tag} Provider conflict new`, googleBooksId: id, isbn13: secondIsbn, publishedYear: 2025 });
		expect(second.created).toBe(true); expect(second.editionId).not.toBe(first.editionId);
		const [row] = await adminSql()`select isbn_13, google_books_id, published_year from public.editions where id=${second.editionId}::bigint`;
		expect(row).toEqual({ isbn_13: secondIsbn, google_books_id: null, published_year: 2025 });
	});

	it('updates an existing library row and rejects an exact-edition duplicate', async () => {
		const bookId = randomUUID();
		const duplicateBookId = randomUUID();
		const title = `Contract ${tag} edited book`;
		const author = `Contract ${tag} author`;
		const isbn = validIsbn13();
		const workId = `OLW-${tag}-edit`;
		const input: UpdateBookInput = {
			genre: 'dystopia-scifi',
			format: 'digital',
			series: { name: `Contract ${tag} series`, number: 2, total: 5 },
			title: `${title} edition`,
			author,
			pageCount: 280,
			language: 'en',
			isbn,
			coverUrl: null,
			edition: {
				provider: 'open-library',
				providerIds: {
					openLibraryWorkId: workId,
					openLibraryEditionId: `OLE-${tag}-edit`,
					googleBooksId: null
				},
				workTitle: `${title} work`,
				authors: [author],
				publisher: `Contract ${tag} publisher`,
				publishedDate: '2024'
			}
		};
		const trustedEdition = {
			provider: 'open-library',
			providerIds: input.edition?.providerIds,
			workTitle: `${title} work`,
			editionTitle: `${title} edition`,
			authors: [author],
			isbn10: null,
			isbn13: isbn,
			language: 'en',
			publisher: `Contract ${tag} publisher`,
			publishedDate: '2024',
			pageCount: 280,
			coverUrl: null,
			confidence: 1,
			matchReasons: []
		};
		const repository = new ServerCatalogRepository({
			lookupIsbn: async () => ({
				candidates: [trustedEdition],
				degraded: false,
				providers: {},
				exactMatch: true
			})
		} as never);

		await expect(repository.updateBook(user.id, randomUUID(), input)).rejects.toMatchObject({
			code: 'NOT_FOUND'
		});
		const [missingWork] = await adminSql()<{ count: number }[]>`
			select count(*)::int as count
			from public.works
			where open_library_work_id = ${workId}`;
		expect(missingWork?.count).toBe(0);

		await adminSql()`insert into public.user_books
			(id, user_id, genre_id, title, author_display, page_count, language, format, source)
			values
				(${bookId}::uuid, ${user.id}::uuid, 1, ${title}, ${author}, 200, 'it', 'physical', 'manual'),
				(${duplicateBookId}::uuid, ${user.id}::uuid, 1, ${`Contract ${tag} second`}, ${author}, 200, 'it', 'physical', 'manual')`;

		await expect(repository.updateBook(user.id, bookId, input)).resolves.toEqual({
			status: 'updated',
			bookId,
			reviewScoresReset: false
		});
		// The current book is excluded from duplicate detection when it keeps its edition.
		await expect(repository.updateBook(user.id, bookId, input)).resolves.toEqual({
			status: 'updated',
			bookId,
			reviewScoresReset: false
		});
		await expect(repository.updateBook(user.id, duplicateBookId, input)).resolves.toMatchObject({
			status: 'duplicate',
			exact: true,
			existing: { id: bookId, title: `${title} edition`, author }
		});

		const [updated] = await adminSql()<{
			id: string;
			title: string;
			format: string;
			genre: string;
			edition_id: string;
		}[]>`
			select b.id::text, b.title, b.format, g.slug as genre, b.edition_id::text
			from public.user_books b join public.genres g on g.id = b.genre_id
			where b.id = ${bookId}::uuid`;
		expect(updated).toMatchObject({
			id: bookId,
			title: `${title} edition`,
			format: 'digital',
			genre: 'dystopia-scifi'
		});
		expect(updated?.edition_id).toMatch(/^\d+$/);

		const [unchanged] = await adminSql()<{
			title: string;
			format: string;
			edition_id: string | null;
		}[]>`
			select title, format, edition_id::text
			from public.user_books where id = ${duplicateBookId}::uuid`;
		expect(unchanged).toEqual({ title: `Contract ${tag} second`, format: 'physical', edition_id: null });
	});

	it('keeps concurrent adds of the same ISBN to one library entry', async () => {
		const repository = new ServerCatalogRepository({} as never);
		const isbn = validIsbn13();
		const input: AddBookInput = {
			source: 'manual',
			title: `Contract ${tag} concurrent add`,
			author: `Contract ${tag} concurrent author`,
			pageCount: 240,
			language: 'it',
			isbn,
			genre: 'dystopia-scifi',
			format: 'physical',
			series: null,
			coverUrl: null,
			edition: null,
			force: false
		};

		const results = await Promise.all(
			Array.from({ length: 6 }, () => repository.addBook(user.id, input))
		);
		const added = results.filter((result) => result.status === 'added');
		const duplicates = results.filter(
			(result): result is Extract<AddBookResponse, { status: 'duplicate' }> =>
				result.status === 'duplicate'
		);

		expect(added).toHaveLength(1);
		expect(duplicates).toHaveLength(5);
		const inserted = added[0];
		if (!inserted || inserted.status !== 'added') throw new Error('Expected one inserted book');
		expect(duplicates.every((result) => result.exact)).toBe(true);
		expect(duplicates.map((result) => result.existing.id)).toEqual(
			Array.from({ length: 5 }, () => inserted.bookId)
		);
	});

	it('is safe under concurrent imports of the same book', async () => {
		const isbn = isbn13();
		const results = await Promise.all(
			Array.from({ length: 6 }, () =>
				upsertCatalogEdition(user.id, {
					title: `Contract ${tag} Concurrent`,
					authors: [`Contract ${tag} Conc`],
					openLibraryWorkId: `OLW-${tag}-conc`,
					isbn13: isbn
				})
			)
		);
		expect(new Set(results.map((r) => r.editionId)).size).toBe(1);
		expect(results.filter((r) => r.created)).toHaveLength(1);
		const [{ n }] = (await adminSql()`select count(*)::int as n from public.works where open_library_work_id = ${`OLW-${tag}-conc`}`) as unknown as [{ n: number }];
		expect(n).toBe(1);
	});

	it('requires an identity and valid input', async () => {
		await expect(sql`select app.catalog_upsert_edition(p_title => 'x')`).rejects.toMatchObject({ code: '42501' });
		await expect(upsertCatalogEdition(user.id, { title: '   ' })).rejects.toMatchObject({ code: '22023' });
		await expect(upsertCatalogEdition(user.id, { title: 'x', isbn13: 'not-an-isbn' })).rejects.toMatchObject({ code: '23514' });
		await expect(upsertCatalogEdition(user.id, { title: 'x', workId: '999999999' })).rejects.toMatchObject({ code: 'P0002' });
	});
});
