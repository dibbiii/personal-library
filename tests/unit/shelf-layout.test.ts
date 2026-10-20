import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { layoutShelf } from '../../src/lib/book/shelf-layout';
import type { BookSummary } from '../../src/lib/contracts';

function book(i: number, lifecycleState: BookSummary['lifecycleState'] = 'unread'): BookSummary {
	return {
		id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
		editionId: null,
		title: `Libro ${i}`,
		author: 'Autore',
		pageCount: 300,
		language: 'it',
		format: 'physical',
		source: 'manual',
		genre: { id: 2, slug: 'mythology-epic-retelling', name: 'Mitologia' },
		series: null,
		lifecycleState,
		completedReadingsCount: 0,
		reviewRating: null,
		lastFinishedAt: null,
		lastActivityAt: null,
		cover: { coverUrl: 'https://example.test/c.jpg', coverStoragePath: null }
	};
}

describe('layoutShelf', () => {
	const books = Array.from({ length: 12 }, (_, i) => book(i + 1));

	it('e deterministico e contiene una sola decorazione', () => {
		const a = layoutShelf({ books, genre: 'mythology-epic-retelling', queuedIds: new Set() });
		const b = layoutShelf({ books, genre: 'mythology-epic-retelling', queuedIds: new Set() });
		expect(a).toEqual(b);
		expect(a.filter((i) => i.kind === 'deco')).toHaveLength(1);
		expect(a.filter((i) => i.kind !== 'deco')).toHaveLength(12);
		const deco = a.findIndex((i) => i.kind === 'deco');
		expect(deco).toBeGreaterThanOrEqual(2);
		expect(deco).toBeLessThanOrEqual(5);
	});

	it('al piu un libro appoggiato, sempre prima della decorazione', () => {
		for (let n = 1; n < 40; n++) {
			const list = Array.from({ length: 10 }, (_, i) => book(n * 100 + i));
			const items = layoutShelf({ books: list, genre: 'classics', queuedIds: new Set() });
			const leaning = items.filter((i) => i.kind === 'spine' && i.lean);
			expect(leaning.length).toBeLessThanOrEqual(1);
			if (leaning.length === 1) {
				expect(items[items.findIndex((i) => i.kind === 'deco') - 1]).toBe(leaning[0]);
			}
		}
	});

	it('i libri con stato vanno in testa; in lettura sempre di fronte con badge', () => {
		const list = [book(1), book(2), book(3, 'reading'), book(4)];
		const items = layoutShelf({
			books: list,
			genre: 'dystopia-scifi',
			queuedIds: new Set([list[1]!.id])
		});
		const [first, second] = items;
		expect(first).toMatchObject({ kind: 'cover', status: 'reading' });
		// come in Distopia del mockup: Dune di fronte, il libro in coda e' un dorso con badge sopra
		expect(second).toMatchObject({ kind: 'spine', status: 'next' });
	});

	it('un secondo libro in coda diventa dorso con badge sopra', () => {
		const list = [book(1), book(2), book(3)];
		const items = layoutShelf({
			books: list,
			genre: 'thriller-mystery',
			queuedIds: new Set([list[0]!.id, list[1]!.id])
		});
		expect(items[0]).toMatchObject({ kind: 'cover', status: 'next' });
		expect(items[1]).toMatchObject({ kind: 'spine', status: 'next' });
	});

	it('scaffale vuoto: nessun elemento', () => {
		expect(layoutShelf({ books: [], genre: 'classics', queuedIds: new Set() })).toEqual([]);
	});

	it('mantiene la nicchia ad arco (.niche::before) dietro ai libri nello stacking context dello scaffale', () => {
		const genreShelfCss = readFileSync(
			new URL('../../src/lib/components/library/GenreShelf.svelte', import.meta.url),
			'utf8'
		);
		const shelfGridCss = readFileSync(
			new URL('../../src/lib/components/genre/ShelfGrid.svelte', import.meta.url),
			'utf8'
		);

		// .niche non deve creare uno stacking context locale con z-index: 0 che porterebbe ::before davanti ai libri precedenti
		expect(genreShelfCss).toMatch(/\.niche\s*\{[^}]*position:\s*relative;/);
		expect(genreShelfCss).not.toMatch(/\.niche\s*\{[^}]*z-index:\s*0;/);
		expect(genreShelfCss).toMatch(/\.niche::before\s*\{[^}]*z-index:\s*-1;/);
		expect(genreShelfCss).toMatch(/\.item\s*\{[^}]*z-index:\s*1;/);
		expect(genreShelfCss).toMatch(/\.empty\s*\{[^}]*z-index:\s*1;/);

		expect(shelfGridCss).toMatch(/\.grid\s*\{[^}]*isolation:\s*isolate;/);
		expect(shelfGridCss).not.toMatch(/\.niche\s*\{[^}]*z-index:\s*0;/);
		expect(shelfGridCss).toMatch(/\.niche::before\s*\{[^}]*z-index:\s*-1;/);
		expect(shelfGridCss).toMatch(/\.cell\s*\{[^}]*z-index:\s*1;/);
	});
});
