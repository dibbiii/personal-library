// Registered by db.contracts.test.ts: schema, roles and privileges of the migrated database.
import { randomUUID } from 'node:crypto';
import {
	copyFileSync,
	mkdtempSync,
	mkdirSync,
	readdirSync,
	rmSync
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations, migrationStatus } from '../../scripts/db-migrate.mjs';
import { GENRE_ORDER } from '../../src/lib/genres';
import { DATABASE_ADMIN_URL, runDb } from '../helpers/env';
import { adminSql } from '../helpers/users';
import { sql, withUser } from '../../src/lib/server/db';
import { createTestUser, type TestUser } from '../helpers/users';

const EXPECTED_MIGRATIONS = readdirSync(new URL('../../db/migrations', import.meta.url))
	.filter((name) => name.endsWith('.sql'))
	.sort();
const SERIES_MIGRATION = '216_change_book_series.sql';

const USER_OWNED_TABLES = [
	'profiles',
	'user_preferences',
	'custom_themes',
	'user_genre_shelves',
	'user_books',
	'reading_queue',
	'readings',
	'reading_progress_events',
	'reviews',
	'review_scores',
	'user_book_tags',
	'quotes',
	'bingo_boards',
	'bingo_cells',
	'friendships',
	'friend_invites'
];

(runDb ? describe : describe.skip)('migrations, roles and privileges', () => {
	describe('empty database', () => {
		const scratch = `segnalibro_mig_${randomUUID().slice(0, 8)}`;
		let admin: postgres.Sql;
		let scratchSql: postgres.Sql;

		beforeAll(async () => {
			admin = adminSql();
			await admin.unsafe(`create database ${scratch}`);
			const url = new URL(DATABASE_ADMIN_URL);
			url.pathname = `/${scratch}`;
			scratchSql = postgres(url.toString(), { max: 1, onnotice: () => {} });
		});

		afterAll(async () => {
			await scratchSql?.end({ timeout: 2 });
			await admin?.unsafe(`drop database if exists ${scratch} with (force)`);
		});

		it('applies every migration from scratch, in order, exactly once', async () => {
			const applied = await runMigrations(scratchSql);
			expect(applied).toEqual(EXPECTED_MIGRATIONS);

			const rows = await scratchSql<{ filename: string }[]>`
				select filename from public.schema_migrations order by filename
			`;
			expect(rows.map((r) => r.filename)).toEqual(EXPECTED_MIGRATIONS);

			expect(await runMigrations(scratchSql)).toEqual([]);
			const status = await migrationStatus(scratchSql);
			expect(status.every((s: { state: string }) => s.state === 'applied')).toBe(true);
		});

		it('migration 216 reconciles existing series totals per user', async () => {
			const databaseName = `segnalibro_series_${randomUUID().replaceAll('-', '').slice(0, 8)}`;
			const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'segnalibro-series-migration-'));
			const beforeDir = path.join(tempRoot, 'before');
			const finalDir = path.join(tempRoot, 'final');
			mkdirSync(beforeDir);
			mkdirSync(finalDir);

			const migrationSource = new URL('../../db/migrations/', import.meta.url);
			for (const filename of EXPECTED_MIGRATIONS.filter((name) => name < SERIES_MIGRATION)) {
				copyFileSync(new URL(filename, migrationSource), path.join(beforeDir, filename));
			}
			copyFileSync(
				new URL(SERIES_MIGRATION, migrationSource),
				path.join(finalDir, SERIES_MIGRATION)
			);

			let db: postgres.Sql | undefined;
			try {
				await admin.unsafe(`create database ${databaseName}`);
				const url = new URL(DATABASE_ADMIN_URL);
				url.pathname = `/${databaseName}`;
				db = postgres(url.toString(), { max: 1, onnotice: () => {} });
				expect(await runMigrations(db, { dir: beforeDir })).toEqual(
					EXPECTED_MIGRATIONS.filter((name) => name < SERIES_MIGRATION)
				);

				const userId = randomUUID();
				const otherUserId = randomUUID();
				const suffix = randomUUID().slice(0, 8);
				await db`
					insert into app.users (id, email, password_hash) values
						(${userId}::uuid, ${`series-backfill-${suffix}@example.test`}, 'test-hash'),
						(${otherUserId}::uuid, ${`series-backfill-other-${suffix}@example.test`}, 'test-hash')
				`;
				await db`
					insert into public.user_books (
						user_id, genre_id, title, author_display, format,
						series_name, series_number, series_total
					) values
						(${userId}::uuid, 5, 'Alba 1', 'Autore', 'physical', 'Saga Alba', 1, 2),
						(${userId}::uuid, 5, 'Alba 2', 'Autore', 'physical', ' saga alba ', 2, 4),
						(${otherUserId}::uuid, 5, 'Alba altra', 'Autore', 'physical', 'saga alba', 1, 7),
						(${userId}::uuid, 5, 'Scura 1', 'Autore', 'physical', 'Saga Scura', 1, 2),
						(${userId}::uuid, 5, 'Scura 3', 'Autore', 'physical', 'saga scura ', 3, null),
						(${userId}::uuid, 5, 'Saga non numerata', 'Autore', 'physical', 'Saga senza numero', null, 5)
				`;

				expect(await runMigrations(db, { dir: finalDir })).toEqual([SERIES_MIGRATION]);
				const groups = await db<{ series_key: string; total: number | null; count: number }[]>`
					select lower(btrim(series_name)) as series_key, max(series_total)::smallint as total,
						count(*)::int as count
					from public.user_books
					where user_id = ${userId}::uuid
					group by lower(btrim(series_name))
					order by lower(btrim(series_name))
				`;
				const otherTotals = await db<{ total: number | null }[]>`
					select series_total as total
					from public.user_books
					where user_id = ${otherUserId}::uuid
				`;

				expect(groups).toEqual([
					{ series_key: 'saga alba', total: 4, count: 2 },
					{ series_key: 'saga scura', total: null, count: 2 },
					{ series_key: 'saga senza numero', total: 5, count: 1 }
				]);
				expect(otherTotals).toEqual([{ total: 7 }]);
			} finally {
				await db?.end({ timeout: 2 });
				await admin.unsafe(`drop database if exists ${databaseName} with (force)`);
				rmSync(tempRoot, { recursive: true, force: true });
			}
		});

		it('refuses to run when an applied migration was modified', async () => {
			await scratchSql`update public.schema_migrations set checksum = 'tampered' where filename = '004_reference_data.sql'`;
			await expect(runMigrations(scratchSql)).rejects.toThrow(/modified after being applied/);
			await scratchSql`
				update public.schema_migrations set checksum = (
					select checksum from public.schema_migrations where filename = '003_rpc_contract_alignment.sql'
				) where filename = '004_reference_data.sql'
			`;
		});

		it('loads the reference data', async () => {
			const [counts] = await scratchSql<{ genres: number; dims: number; tags: number; activeTags: number }[]>`
				select
					(select count(*)::int from public.genres) as genres,
					(select count(*)::int from public.rating_dimensions) as dims,
					(select count(*)::int from public.tags) as tags,
					(select count(*)::int from public.tags where is_active) as "activeTags"
			`;
			expect(counts).toEqual({ genres: 8, dims: 40, tags: 43, activeTags: 20 });
		});

		it('persists and reorders all eight personal shelves', async () => {
			const userId = randomUUID();
			await scratchSql`
				insert into app.users (id, email, password_hash)
				values (${userId}::uuid, ${`shelves-${userId}@example.test`}, 'test-hash')
			`;

			const input = [...GENRE_ORDER]
				.reverse()
				.map((slug, index) => ({
					slug,
					name: slug === 'essays' ? 'Saggi personalizzato' : slug,
					sort_order: index + 1
				}));
			const result = await scratchSql.begin(async (tx) => {
				await tx`select set_config('app.user_id', ${userId}, true)`;
				const [row] = await tx<{ shelves: { genres: { slug: string; name: string; sortOrder: number }[] } }[]>`
					select public.update_user_genre_shelves(${tx.json(input)}) as shelves
				`;
				return row?.shelves;
			});

			expect(result?.genres.map((genre) => genre.slug)).toEqual([...GENRE_ORDER].reverse());
			expect(result?.genres[0]).toMatchObject({
				slug: 'essays',
				name: 'Saggi personalizzato',
				sortOrder: 1
			});
		});

		it('moves a book to Saggi and returns it on the dedicated shelf', async () => {
			const userId = randomUUID();
			const bookId = randomUUID();
			await scratchSql`
				insert into app.users (id, email, password_hash)
				values (${userId}::uuid, ${`book-${userId}@example.test`}, 'test-hash')
			`;
			await scratchSql`
				insert into public.user_books (id, user_id, genre_id, title, author_display, format)
				values (${bookId}::uuid, ${userId}::uuid, 1, 'Saggio di test', 'Autore di test', 'physical')
			`;

			const result = await scratchSql.begin(async (tx) => {
				await tx`select set_config('app.user_id', ${userId}, true)`;
				const [changed] = await tx<{
					result: { book: { genre: { slug: string } } };
				}[]>`
					select public.change_book_genre(${bookId}::uuid, 'essays') as result
				`;
				const [loaded] = await tx<{
					home: {
						shelves: {
							genre: { slug: string; name: string };
							totalCount: number;
							books: { id: string }[];
						}[];
					};
				}[]>`
					select public.get_library_home(24) as home
				`;
				return { changed: changed?.result, home: loaded?.home };
			});

			expect(result.changed?.book.genre.slug).toBe('essays');
			const essaysShelf = result.home?.shelves.find((shelf) => shelf.genre.slug === 'essays');
			expect(essaysShelf).toMatchObject({ genre: { name: 'Saggi' }, totalCount: 1 });
			expect(essaysShelf?.books.map((book) => book.id)).toContain(bookId);
		});
	});

	describe('runtime role', () => {
		let a: TestUser;

		beforeAll(async () => {
			a = await createTestUser('priv');
		});
		afterAll(async () => {
			await a?.cleanup();
		});

		it('segnalibro_app is a plain login role that cannot bypass RLS', async () => {
			const [role] = await adminSql()<
				{ rolsuper: boolean; rolbypassrls: boolean; rolcanlogin: boolean; rolcreaterole: boolean; rolcreatedb: boolean }[]
			>`select rolsuper, rolbypassrls, rolcanlogin, rolcreaterole, rolcreatedb from pg_roles where rolname = 'segnalibro_app'`;
			expect(role).toEqual({
				rolsuper: false,
				rolbypassrls: false,
				rolcanlogin: true,
				rolcreaterole: false,
				rolcreatedb: false
			});

			const [me] = await sql<{ user: string; super: string }[]>`
				select current_user as user, current_setting('is_superuser') as super
			`;
			expect(me).toEqual({ user: 'segnalibro_app', super: 'off' });
		});

		it('every user-owned table has RLS enabled and forced', async () => {
			const rows = await adminSql()<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }[]>`
				select c.relname, c.relrowsecurity, c.relforcerowsecurity
				from pg_class c join pg_namespace n on n.oid = c.relnamespace
				where n.nspname = 'public' and c.relname = any(${USER_OWNED_TABLES})
			`;
			expect(rows).toHaveLength(USER_OWNED_TABLES.length);
			for (const row of rows) {
				expect(row.relrowsecurity, `${row.relname} RLS`).toBe(true);
				expect(row.relforcerowsecurity, `${row.relname} FORCE RLS`).toBe(true);
			}
		});

		it('no function is executable by PUBLIC (RPCs are granted to segnalibro_app only)', async () => {
			const rows = await adminSql()<{ fn: string; is_public: boolean; is_app: boolean }[]>`
				select n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as fn,
				       has_function_privilege('public', p.oid, 'execute') as is_public,
				       has_function_privilege('segnalibro_app', p.oid, 'execute') as is_app
				from pg_proc p join pg_namespace n on n.oid = p.pronamespace
				where n.nspname in ('public', 'private', 'app')
			`;
			expect(rows.length).toBeGreaterThan(50);
			expect(rows.filter((r) => r.is_public).map((r) => r.fn)).toEqual([]);

			const exposed = rows.filter((r) => r.is_app).map((r) => r.fn.split('(')[0]);
			expect(exposed.filter((f) => f?.startsWith('private.'))).toEqual([]);
			for (const rpc of [
				'public.get_library_home',
				'public.queue_add',
				'public.record_progress',
				'public.save_review',
				'public.assign_bingo_book',
				'public.set_theme_selection',
				'app.current_user_id',
				'app.validate_session',
				'app.catalog_upsert_edition'
			]) {
				expect(exposed, rpc).toContain(rpc);
			}
			expect(exposed).not.toContain('app.purge_expired_sessions');
		});

		it('private helpers and the legacy implementations are unreachable', async () => {
			await expect(
				withUser(a.id, (tx) => tx`select private.legacy_get_library_home(24)`)
			).rejects.toMatchObject({ code: '42501' });
			await expect(
				withUser(a.id, (tx) => tx`select private.require_uid()`)
			).rejects.toMatchObject({ code: '42501' });
			await expect(
				withUser(a.id, (tx) => tx`select public.legacy_get_library_home(24)`)
			).rejects.toMatchObject({ code: '42883' }); // undefined_function
		});

		it('accounts, sessions and catalog writes are closed to direct SQL', async () => {
			await expect(sql`select * from app.users`).rejects.toMatchObject({ code: '42501' });
			await expect(sql`select * from app.sessions`).rejects.toMatchObject({ code: '42501' });
			await expect(sql`select password_hash from app.users limit 1`).rejects.toMatchObject({ code: '42501' });
			await expect(sql`select app.purge_expired_sessions()`).rejects.toMatchObject({ code: '42501' });

			await expect(
				withUser(a.id, (tx) => tx`insert into public.works (title) values ('x')`)
			).rejects.toMatchObject({ code: '42501' });
			await expect(
				withUser(a.id, (tx) => tx`insert into public.editions (work_id) values (1)`)
			).rejects.toMatchObject({ code: '42501' });
			await expect(
				withUser(a.id, (tx) => tx`update public.genres set name_it = 'x'`)
			).rejects.toMatchObject({ code: '42501' });
			await expect(
				withUser(a.id, (tx) => tx`insert into public.tags (slug, label_it, sort_order) values ('x','x',1)`)
			).rejects.toMatchObject({ code: '42501' });

			// the catalog itself is readable
			const [{ n }] = (await sql`select count(*)::int as n from public.genres`) as unknown as [{ n: number }];
			expect(n).toBe(8);
		});

		it('the runtime role cannot create objects or change its own privileges', async () => {
			await expect(sql`create table public.evil (id int)`).rejects.toMatchObject({ code: '42501' });
			await expect(sql`create schema evil`).rejects.toMatchObject({ code: '42501' });
			await expect(sql`grant all on app.users to public`).rejects.toMatchObject({ code: '42501' });
			await expect(sql`set role postgres`).rejects.toMatchObject({ code: '42501' });
			await expect(sql`alter table public.user_books disable row level security`).rejects.toThrow();
		});
	});
});
