import '../helpers/env';
import { expect, test as base, type Page } from '@playwright/test';
import { closeDb } from '../../src/lib/server/db';
import { createTestUser, closeAdminSql } from '../helpers/users';

const test = base.extend<{ accountReady: void }>({
	accountReady: [
		async ({ page }, use) => {
			const account = await createTestUser('discover-e2e');
			try {
				await login(page, account.email, account.password);
				await use();
			} finally {
				await account.cleanup();
			}
		},
		{ auto: true }
	]
});
test.afterAll(async () => {
	await closeAdminSql();
	await closeDb();
});

/**
 * Esplora (scoperta libri). Open Library non si raggiunge mai: `/api/discover` e
 * `/api/catalog/info` sono simulati. Account temporaneo eliminato a fine prova.
 */

const book = (workId: string, title: string, overrides: Record<string, unknown> = {}) => ({
	workId,
	editionId: null,
	title,
	workTitle: title,
	authors: ['Ada Verdi'],
	year: 2001,
	coverUrl: null,
	rating: 4.2,
	ratingCount: 120,
	language: 'it',
	...overrides
});

async function login(page: Page, email: string, password: string) {
	await page.goto('/auth/login');
	await page.waitForLoadState('networkidle');
	await page.fill('input[name=email]', email);
	await page.fill('input[name=password]', password);
	await page.getByRole('button', { name: /accedi/i }).click();
	await page.waitForURL('**/library');
}

test('Esplora: sezioni, ricerca con filtri e aggiunta dal dettaglio', async ({ page }) => {
	const requests: URLSearchParams[] = [];
	const infoRequests: URLSearchParams[] = [];
	await page.route('**/api/discover?*', async (route) => {
		const params = new URL(route.request().url()).searchParams;
		requests.push(params);
		const section = params.get('section') ?? 'search';
		const books =
			section === 'search'
				? [
						book('OL1W', `Risultato ${params.get('q') ?? ''}`.trim(), {
							...(params.get('lang') === 'en'
								? {
										editionId: 'OL-EN',
										coverUrl: 'https://covers.openlibrary.org/b/id/12-M.jpg',
										language: 'en'
									}
								: {})
						})
					]
				: [
						book(`OL-${section}-1W`, `Libro ${section} uno`),
						book(`OL-${section}-2W`, `Libro ${section} due`)
					];
		await route.fulfill({ json: { books, total: books.length, hasMore: false } });
	});
	await page.route('**/api/catalog/info*', async (route) => {
		infoRequests.push(new URL(route.request().url()).searchParams);
		await route.fulfill({
			json: {
				info: {
					workTitle: 'Risultato drago',
					workUrl: 'https://openlibrary.org/works/OL1W',
					description: null,
					firstSentence: null,
					firstPublishYear: 2001,
					subjects: [],
					people: [],
					places: [],
					times: [],
					rating: null,
					readers: null,
					editionCount: 2,
					pagesMedian: null,
					editions: [
						{
							title: 'Italian edition',
							publisher: 'Italian publisher',
							year: 2001,
							language: 'it',
							pages: 200,
							isbn13: '9780000000000',
							coverUrl: 'https://covers.openlibrary.org/b/id/11-M.jpg',
							url: 'https://openlibrary.org/books/OL-IT'
						},
						{
							title: 'Risultato drago',
							publisher: 'English publisher',
							year: 2001,
							language: 'en',
							pages: 220,
							isbn13: '9780000000001',
							coverUrl: 'https://covers.openlibrary.org/b/id/12-M.jpg',
							url: 'https://openlibrary.org/books/OL-EN'
						}
					],
					author: null,
					authorWorks: [],
					links: []
				}
			}
		});
	});

	await page.goto('/explore');
	await expect(page.getByRole('heading', { name: 'Scopri il tuo prossimo libro' })).toBeVisible();

	for (const name of [
		'Consigliati per te',
		'Novità e uscite recenti',
		'Classici da non perdere',
		'I più popolari',
		'Libri in tendenza',
		'Esplora per tema'
	]) {
		await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
	}
	await expect(page.getByRole('button', { name: /Libro classics uno/ })).toBeVisible();
	expect(requests.some((params) => params.get('section') === 'recommended')).toBe(true);

	// Ricerca dal banner, poi un filtro: la griglia dei risultati usa entrambi
	await page.getByRole('searchbox', { name: 'Cerca per titolo, autore o editore' }).fill('drago');
	await page.keyboard.press('Enter');
	await expect(page.getByRole('heading', { name: 'Risultati per “drago”' })).toBeVisible();
	// Su mobile i filtri stanno dietro al pulsante "Filtri"
	const toggle = page.getByRole('button', { name: /^Filtri/ });
	if (await toggle.isVisible()) await toggle.click();
	await page.getByRole('button', { name: '4 stelle e più' }).click();
	await expect
		.poll(() => requests.some((p) => p.get('q') === 'drago' && p.get('minRating') === '4'))
		.toBe(true);
	await page.getByLabel('Lingua', { exact: true }).selectOption('en');
	await expect
		.poll(() => requests.some((p) => p.get('q') === 'drago' && p.get('lang') === 'en'))
		.toBe(true);

	// Dettaglio e aggiunta: si passa sempre dalla conferma di genere e formato
	await page.getByRole('button', { name: /^Risultato drago/ }).click();
	const detail = page.getByRole('dialog', { name: 'Risultato drago' });
	await expect(detail).toBeVisible();
	await expect.poll(() => infoRequests.some((p) => p.get('language') === 'en')).toBe(true);
	await expect(detail.locator('dl.facts').getByText('Inglese', { exact: true })).toBeVisible();
	await expect(detail.getByRole('button', { name: /Scegli Edizione in inglese/ })).toHaveAttribute(
		'aria-pressed',
		'true'
	);
	await expect(detail.getByRole('button', { name: /Scegli Edizione in italiano/ })).toHaveAttribute(
		'aria-pressed',
		'false'
	);
	await detail.getByRole('button', { name: 'Aggiungi alla mia libreria' }).click();
	const sheet = page.getByRole('dialog', { name: 'Aggiungi alla libreria' });
	await expect(sheet.getByText('Risultato drago')).toBeVisible();
	await expect(sheet.getByText(/Inglese/)).toBeVisible();
	await sheet.getByRole('button', { name: 'Annulla' }).click();
	await expect(sheet).toBeHidden();

	// Torna alle sezioni
	await page.getByRole('button', { name: 'Esplora', exact: true }).click();
	await expect(page.getByRole('heading', { name: 'Consigliati per te' })).toBeVisible();
});
