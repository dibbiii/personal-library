import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { expect, test as base, type BrowserContext, type Page } from '@playwright/test';
import postgres from 'postgres';

/**
 * Aggiunta libri, catalogo e cover. I provider esterni non si raggiungono mai: le risposte
 * degli endpoint `/api/catalog/*` sono intercettate con `page.route`. Ogni worker registra un
 * utente di prova (`b6-…@test.local`) che viene rimosso alla fine.
 */

const ORIGIN = process.env.E2E_BASE_URL ?? 'http://localhost:4173';
const ADMIN_URL =
	process.env.DATABASE_ADMIN_URL ?? 'postgres://postgres:postgres@127.0.0.1:5433/segnalibro';

interface Account {
	state: Awaited<ReturnType<BrowserContext['storageState']>>;
	email: string;
	id: string;
}

const test = base.extend<object, { account: Account }>({
	account: [
		async ({ browser }, use) => {
			const email = `b6-e2e-${randomUUID().slice(0, 8)}@test.local`;
			const context = await browser.newContext({ baseURL: ORIGIN });
			const page = await context.newPage();
			for (let attempt = 0; attempt < 3; attempt++) {
				await page.goto('/auth/register');
				await page.waitForLoadState('networkidle');
				await page.getByLabel('Nome').fill('Prova B6');
				await page.getByLabel('Email').fill(email);
				await page.getByLabel('Password').fill('segnalibro-b6-test');
				await page.getByRole('button', { name: 'Registrati' }).click();
				try {
					await page.waitForURL(/\/library/, { timeout: 45_000 });
					break;
				} catch {
					if (attempt === 2) throw new Error('registrazione utente di prova non riuscita');
				}
			}
			const state = await context.storageState();
			await context.close();

			const admin = postgres(ADMIN_URL, { max: 1, onnotice: () => {} });
			const [row] = await admin<
				{ id: string }[]
			>`select id::text from app.users where email = ${email}`;
			await use({ state, email, id: row?.id ?? '' });
			await admin`delete from app.users where email = ${email}`;
			// come deleteAccount(): anche i file caricati dell'utente di prova
			if (row?.id) {
				await rm(path.resolve(process.env.STORAGE_DIR ?? './storage', 'covers', row.id), {
					recursive: true,
					force: true
				});
			}
			await admin.end();
		},
		{ scope: 'worker', timeout: 180_000 }
	],
	storageState: async ({ account }, use) => {
		await use(account.state);
	}
});

function admin() {
	return postgres(ADMIN_URL, { max: 1, onnotice: () => {} });
}

async function userBooks(userId: string) {
	const sql = admin();
	try {
		return await sql<
			{
				id: string;
				title: string;
				author_display: string;
				slug: string;
				format: string;
				source: string;
				isbn_13: string | null;
				page_count: number | null;
				language: string | null;
				series_name: string | null;
				series_number: string | null;
				series_total: number | null;
				edition_id: string | null;
				cover_url: string | null;
				cover_storage_path: string | null;
			}[]
		>`
			select b.id::text, b.title, b.author_display, g.slug, b.format, b.source, b.isbn_13, b.page_count,
				b.language, b.series_name, b.series_number::text, b.series_total, b.edition_id::text,
				b.cover_url, b.cover_storage_path
			from public.user_books b join public.genres g on g.id = b.genre_id
			where b.user_id = ${userId}::uuid order by b.created_at
		`;
	} finally {
		await sql.end();
	}
}

const candidate = (overrides: Record<string, unknown> = {}) => ({
	provider: 'google-books',
	providerIds: {
		openLibraryWorkId: null,
		openLibraryEditionId: null,
		googleBooksId: `gb-${randomUUID().slice(0, 8)}`
	},
	workTitle: 'La sfida del mago',
	editionTitle: 'La sfida del mago',
	authors: ['Ada Verdi'],
	isbn10: null,
	isbn13: null,
	language: 'it',
	publisher: 'Editore di Prova',
	publishedDate: '2019-11-14',
	pageCount: 320,
	coverUrl: 'https://books.google.com/books/content?id=mock&img=1&zoom=1',
	confidence: 0.9,
	matchReasons: ['title-exact', 'author-match'],
	...overrides
});

/** ISBN-13 validi casuali (prefisso 979-10 + 7 cifre + checksum) per non scontrarsi con altri test. */
function randomIsbn13(): string {
	const body = `97910${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`;
	let sum = 0;
	for (let i = 0; i < 12; i++) sum += Number(body[i]) * (i % 2 === 0 ? 1 : 3);
	return `${body}${(10 - (sum % 10)) % 10}`;
}

const PNG_1X1 = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
	'base64'
);

// Missing-cover fallback must not reach real external services during this suite.
test.beforeEach(async ({ page }) => {
	await page.route('https://covers.openlibrary.org/**', (route) => route.fulfill({ status: 404 }));
});

/** Sceglie un genere o un formato cliccando sulla riga (come farebbe l'utente). */
async function choose(scope: Page | ReturnType<Page['getByRole']>, name: string) {
	const radio = scope.getByRole('radio', { name });
	await radio.locator('xpath=..').click();
	await expect(radio).toBeChecked();
}

async function pickGenreAndAdd(
	page: Page,
	genre: string,
	format: 'Cartaceo' | 'Digitale' = 'Cartaceo'
) {
	await choose(page, genre);
	await choose(page, format);
	await page.getByRole('button', { name: 'Aggiungi', exact: true }).click();
}

// Il profilo demo non si tocca: tutte le mutazioni riguardano l'utente di prova del worker.
test.describe('aggiungi un libro', () => {
	test.describe.configure({ mode: 'serial' });

	test('/add offre i tre modi', async ({ page }) => {
		await page.goto('/add');
		await expect(page.getByRole('heading', { name: 'Aggiungi un libro' })).toBeVisible();
		const modes = page.getByRole('navigation', { name: 'Modi per aggiungere un libro' });
		await expect(modes.getByRole('link', { name: /Scansiona ISBN/ })).toHaveAttribute(
			'href',
			'/add/scan'
		);
		await expect(modes.getByRole('link', { name: /^Cerca/ })).toHaveAttribute(
			'href',
			'/add/search'
		);
		await expect(modes.getByRole('link', { name: /^Cerca/ })).toHaveAttribute(
			'aria-current',
			'page'
		);
		await expect(modes.getByRole('link', { name: /Inserisci manualmente/ })).toHaveAttribute(
			'href',
			'/add/manual'
		);
		await expect(page.getByRole('link', { name: 'Annulla' })).toHaveAttribute('href', '/library');
	});

	test('inserimento manuale senza alcuna rete verso i cataloghi', async ({ page, account }) => {
		await page.route('**/api/catalog/**', (route) => route.abort('internetdisconnected'));
		await page.goto('/add/manual');
		await page.waitForLoadState('networkidle');

		// Validazione dei campi
		await page.getByRole('button', { name: 'Continua' }).click();
		await expect(page.getByText('Scrivi il titolo.')).toBeVisible();
		await expect(page.getByText('Scrivi l’autore.')).toBeVisible();
		await page.getByLabel('Titolo').fill('Il gatto del bibliotecario');
		await page.getByLabel('Autore').fill('Marta Bianchi');
		await page.getByLabel('Pagine').fill('212');
		await page.getByLabel('ISBN (facoltativo)').fill('978-1-23456-789-0');
		await page.getByRole('button', { name: 'Continua' }).click();
		await expect(page.getByText(/ISBN non valido/)).toBeVisible();
		await page.getByLabel('ISBN (facoltativo)').fill('');
		await page.getByRole('button', { name: 'Continua' }).click();

		// Lo sheet chiede sempre genere, formato e serie
		const sheet = page.getByRole('dialog', { name: 'Aggiungi alla libreria' });
		await expect(sheet).toBeVisible();
		await expect(sheet.getByRole('radiogroup', { name: 'Genere' }).getByRole('radio')).toHaveCount(
			8
		);
		await expect(sheet.getByRole('radiogroup', { name: 'Formato' }).getByRole('radio')).toHaveCount(
			3
		);
		await sheet.getByRole('button', { name: 'Aggiungi', exact: true }).click();
		await expect(sheet.getByRole('alert')).toHaveText('Scegli il genere del libro.');

		await choose(sheet, 'Fantasy, Realismo Magico e Gotico');
		await choose(sheet, 'Digitale');
		await sheet.getByLabel('Nome della serie').fill('Le cronache del gatto');
		await sheet.getByLabel('Numero volume').fill('2');
		await sheet.getByLabel('Volumi totali').fill('3');
		await expect(sheet.getByText('Serie: Vol. 2 di 3')).toBeVisible();
		await sheet.getByRole('button', { name: 'Aggiungi', exact: true }).click();

		await page.waitForURL(/\/book\/[0-9a-f-]{36}$/);

		const [book] = await userBooks(account.id);
		expect(book).toMatchObject({
			title: 'Il gatto del bibliotecario',
			author_display: 'Marta Bianchi',
			slug: 'fantasy-magical-gothic',
			format: 'digital',
			source: 'manual',
			page_count: 212,
			language: 'it',
			series_name: 'Le cronache del gatto',
			series_total: 3,
			edition_id: null,
			cover_url: null
		});
		expect(Number(book?.series_number)).toBe(2);
		expect(page.url()).toContain(`/book/${book?.id}`);
	});

	test('ricerca con risultati simulati: sceglie un candidato e lo aggiunge', async ({
		page,
		account
	}) => {
		const isbn = randomIsbn13();
		const results = [
			candidate({ isbn13: isbn, matchReasons: ['title-match'] }),
			candidate({
				editionTitle: 'La sfida del mago (altra edizione)',
				isbn13: null,
				pageCount: null,
				coverUrl: null
			})
		];
		let searches = 0;
		await page.route('**/api/catalog/search*', async (route) => {
			searches++;
			await route.fulfill({
				json: { contractVersion: 1, degraded: false, providers: {}, candidates: results }
			});
		});
		// La selezione tenta di completare i dati per ISBN: simula il provider senza altre informazioni.
		await page.route('**/api/catalog/isbn*', (route) =>
			route.fulfill({
				json: {
					contractVersion: 1,
					degraded: false,
					providers: {},
					exactMatch: false,
					candidates: []
				}
			})
		);
		await page.route('https://books.google.com/**', (route) =>
			route.fulfill({ body: PNG_1X1, contentType: 'image/png' })
		);
		await page.route('**/api/catalog/info*', (route) => route.fulfill({ json: { info: null } }));

		await page.goto('/add/search');
		await page.waitForLoadState('networkidle');
		await page.getByRole('searchbox').fill('l');
		await expect(page.getByText('Scrivi almeno 2 caratteri.')).toBeVisible();
		await page.getByRole('searchbox').fill('sfida del mago');
		await expect(page.getByText('2 risultati', { exact: true })).toBeVisible();
		expect(searches).toBe(1); // debounce: una sola chiamata
		await expect(page.getByRole('button', { name: /La sfida del mago/ })).toHaveCount(2);

		await page
			.getByRole('button', { name: /^La sfida del mago Ada Verdi/ })
			.first()
			.click();
		// Il dettaglio a lato mostra il libro scelto; l'aggiunta passa sempre dalla conferma.
		const detail = page.getByRole('complementary', { name: 'Libro selezionato' });
		await expect(detail.getByRole('heading', { name: 'La sfida del mago' })).toBeVisible();
		await detail.getByRole('button', { name: 'Aggiungi alla mia libreria' }).click();
		const sheet = page.getByRole('dialog', { name: 'Aggiungi alla libreria' });
		await expect(sheet.getByText('Ada Verdi')).toBeVisible();
		await choose(sheet, 'Thriller, Gialli e Mistero');
		await sheet.getByRole('button', { name: 'Aggiungi', exact: true }).click();
		await page.waitForURL(/\/book\/[0-9a-f-]{36}$/);

		const books = await userBooks(account.id);
		const added = books.find((book) => book.title === 'La sfida del mago');
		expect(added).toMatchObject({
			slug: 'thriller-mystery',
			format: 'physical',
			source: 'search',
			isbn_13: isbn,
			page_count: 320,
			language: 'it',
			cover_url: 'https://books.google.com/books/content?id=mock&img=1&zoom=1'
		});
		expect(added?.edition_id).not.toBeNull();
	});

	test('ricerca: mostra altri risultati e filtra il gruppo completo senza nuove chiamate', async ({
		page
	}) => {
		const results = Array.from({ length: 25 }, (_, index) =>
			candidate({
				editionTitle: `Edizione di prova ${index + 1}`,
				language: index >= 20 ? 'en' : 'it',
				provider: index >= 10 ? 'open-library' : 'google-books'
			})
		);
		let searches = 0;
		await page.route('**/api/catalog/search*', (route) => {
			searches++;
			const title = new URL(route.request().url()).searchParams.get('title');
			return route.fulfill({
				json: {
					contractVersion: 1,
					degraded: false,
					providers: {},
					candidates: title === 'Seconda ricerca' ? results.slice(0, 12) : results
				}
			});
		});
		await page.route('https://books.google.com/**', (route) =>
			route.fulfill({ body: PNG_1X1, contentType: 'image/png' })
		);
		await page.goto('/add/search');
		await page.getByRole('searchbox').fill('Edizione di prova');
		const list = page.getByRole('list', { name: 'Risultati della ricerca' });
		await expect(list.getByRole('listitem')).toHaveCount(10);
		await expect(page.getByText('Mostrati 10 di 25 risultati')).toBeVisible();
		const more = page.getByRole('button', { name: 'Mostra altri risultati' });
		await more.click();
		await expect(list.getByRole('listitem')).toHaveCount(20);
		await more.click();
		await expect(list.getByRole('listitem')).toHaveCount(25);
		await expect(more).toHaveCount(0);

		await page.getByRole('button', { name: 'Inglese', exact: true }).click();
		await expect(list.getByRole('listitem')).toHaveCount(5);
		await expect(list.getByRole('button', { name: /^Edizione di prova 25 / })).toBeVisible();
		await page.getByRole('button', { name: 'Tutti', exact: true }).click();
		await expect(list.getByRole('listitem')).toHaveCount(10);
		await page.getByLabel('Risultati da').selectOption('open-library');
		await expect(list.getByRole('listitem')).toHaveCount(10);
		await more.click();
		await expect(list.getByRole('listitem')).toHaveCount(15);
		await page.getByLabel('Risultati da').selectOption('all');
		await expect(list.getByRole('listitem')).toHaveCount(10);
		expect(searches).toBe(1);

		await more.click();
		await page.getByRole('searchbox').fill('Seconda ricerca');
		await expect(page.getByText('Mostrati 10 di 12 risultati')).toBeVisible();
		await expect(list.getByRole('listitem')).toHaveCount(10);
		expect(searches).toBe(2);
	});

	test('ricerca: usa sempre le edizioni più recenti senza selettore di ordinamento', async ({
		page
	}) => {
		const orders: string[] = [];
		await page.route('**/api/catalog/search?**', async (route) => {
			const sort = new URL(route.request().url()).searchParams.get('sort') ?? 'relevance';
			orders.push(sort);
			await route.fulfill({
				json: {
					contractVersion: 1,
					candidates: Array.from({ length: 12 }, (_, i) =>
						candidate({
							editionTitle: `${sort === 'newest' ? 'Nuova' : 'Vecchia'} edizione ${i + 1}`,
							publishedDate: sort === 'newest' ? '2025' : '2000'
						})
					),
					degraded: false,
					providers: { 'google-books': 'ok' }
				}
			});
		});
		await page.goto('/add/search?q=Dune');
		const results = page.getByRole('list', { name: 'Risultati della ricerca' });
		await expect(page.getByLabel('Ordina per')).toHaveCount(0);
		await expect(results.getByRole('listitem')).toHaveCount(10);
		await expect(results.getByText('Nuova edizione 1', { exact: true })).toBeVisible();
		await page.getByRole('button', { name: 'Mostra altri risultati' }).click();
		await expect(results.getByRole('listitem')).toHaveCount(12);
		await page.getByRole('searchbox').fill('Seconda ricerca');
		await expect(results.getByRole('listitem')).toHaveCount(10);
		await expect(results.getByText('Nuova edizione 1', { exact: true })).toBeVisible();
		await expect(results.getByText('Vecchia edizione 1', { exact: true })).toHaveCount(0);
		expect(orders).toEqual(['newest', 'newest']);
	});

	test('ricerca: riusa risultati identici ma cerca di nuovo quando cambia autore', async ({
		page
	}) => {
		const searches: string[] = [];
		await page.route('**/api/catalog/search*', (route) => {
			searches.push(new URL(route.request().url()).searchParams.get('author') ?? '');
			return route.fulfill({
				json: { contractVersion: 1, degraded: false, providers: {}, candidates: [candidate()] }
			});
		});
		await page.goto('/add/search?q=Dune');
		const results = page.getByRole('list', { name: 'Risultati della ricerca' });
		await expect(results.getByRole('listitem')).toHaveCount(1);
		await page.getByRole('searchbox').fill('Dune ');
		await page.getByRole('searchbox').press('Enter');
		await page.getByText('Specifica l’autore', { exact: true }).click();
		await expect(page.locator('input[name="author"]')).toBeVisible();
		expect(searches).toEqual(['']);
		await page.locator('input[name="author"]').fill('Frank Herbert');
		await expect.poll(() => searches).toEqual(['', 'Frank Herbert']);
		await expect(results.getByRole('listitem')).toHaveCount(1);
	});

	test('ricerca: annulla la richiesta superata appena cambia il testo', async ({ page }) => {
		await page.addInitScript(() => {
			const originalFetch = window.fetch;
			(window as Window & { catalogAborted?: boolean }).catalogAborted = false;
			window.fetch = (input, init) => {
				if (String(input).includes('/api/catalog/search')) {
					init?.signal?.addEventListener('abort', () => {
						(window as Window & { catalogAborted?: boolean }).catalogAborted = true;
					});
				}
				return originalFetch(input, init);
			};
		});
		let firstStarted = false;
		let releaseFirst!: () => void;
		const firstResponse = new Promise<void>((resolve) => (releaseFirst = resolve));
		await page.route('**/api/catalog/search*', async (route) => {
			const title = new URL(route.request().url()).searchParams.get('title');
			if (title === 'Prima ricerca') {
				firstStarted = true;
				await firstResponse;
			}
			await route
				.fulfill({
					json: {
						contractVersion: 1,
						degraded: false,
						providers: {},
						candidates: [candidate({ editionTitle: title ?? '' })]
					}
				})
				.catch(() => {});
		});
		await page.goto('/add/search?q=Prima%20ricerca');
		await expect.poll(() => firstStarted).toBe(true);
		const abortedImmediately = await page.getByRole('searchbox').evaluate((element) => {
			(element as HTMLInputElement).value = 'Seconda ricerca';
			element.dispatchEvent(new Event('input', { bubbles: true }));
			return (window as Window & { catalogAborted?: boolean }).catalogAborted;
		});
		expect(abortedImmediately).toBe(true);
		releaseFirst();
		const results = page.getByRole('list', { name: 'Risultati della ricerca' });
		await expect(results.getByText('Seconda ricerca', { exact: true })).toBeVisible();
		await expect(results.getByText('Prima ricerca', { exact: true })).toHaveCount(0);
	});

	test('ricerca: ISBN assente passa al manuale conservando ISBN e genere', async ({ page }) => {
		await page.route('**/api/catalog/isbn*', (route) =>
			route.fulfill({
				json: {
					contractVersion: 1,
					degraded: false,
					providers: {},
					exactMatch: false,
					candidates: []
				}
			})
		);
		await page.goto('/add/search?q=9780441013593&genre=classics');
		await page.getByRole('link', { name: 'Inserisci a mano', exact: true }).click();
		await expect(page.getByLabel('ISBN (facoltativo)')).toHaveValue('9780441013593');
		await expect(page.getByLabel('Titolo', { exact: true })).toHaveValue('');
		expect(new URL(page.url()).searchParams.get('genre')).toBe('classics');
	});

	test('ricerca: nessun risultato ed errore di rete', async ({ page }) => {
		await page.route('**/api/catalog/search*', (route) =>
			route.fulfill({
				json: { contractVersion: 1, degraded: false, providers: {}, candidates: [] }
			})
		);
		await page.goto('/add/search');
		await page.waitForLoadState('networkidle');
		await page.getByRole('searchbox').fill('zzzzzz');
		await expect(page.getByText('Nessun risultato per “zzzzzz”.')).toBeVisible();
		await expect(page.getByRole('link', { name: 'Inserisci a mano' })).toHaveAttribute(
			'href',
			/\/add\/manual\?title=zzzzzz/
		);

		await page.unroute('**/api/catalog/search*');
		await page.route('**/api/catalog/search*', (route) =>
			route.fulfill({
				status: 502,
				json: { code: 'NETWORK', message: 'Servizio momentaneamente non raggiungibile, riprova.' }
			})
		);
		await page.getByRole('searchbox').fill('qualcosa');
		await expect(page.getByRole('alert')).toContainText(
			'Servizio momentaneamente non raggiungibile'
		);
		await expect(page.getByRole('button', { name: 'Riprova' })).toBeVisible();
		await page.unroute('**/api/catalog/search*');
		await page.route('**/api/catalog/search*', (route) =>
			route.fulfill({
				json: { contractVersion: 1, degraded: false, providers: {}, candidates: [] }
			})
		);
		await page.getByRole('button', { name: 'Riprova' }).click();
		await expect(page.getByText(/Nessun risultato per/)).toBeVisible();
	});

	test('SBN: ricerca esplicita e salvataggio della scheda senza ISBN', async ({
		page,
		account
	}) => {
		const sbnId = `TST${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`;
		const sbnTitle = `Libro SBN ${randomUUID().slice(0, 8)}`;
		await page.route('**/api/catalog/search*', (route) => {
			const params = new URL(route.request().url()).searchParams;
			return route.fulfill({
				json: {
					contractVersion: 1,
					degraded: false,
					providers: {},
					candidates:
						params.get('source') === 'sbn'
							? [
									candidate({
										provider: 'sbn',
										workTitle: sbnTitle,
										editionTitle: sbnTitle,
										providerIds: {
											openLibraryWorkId: null,
											openLibraryEditionId: null,
											googleBooksId: null,
											sbnId
										},
										coverUrl: null
									})
								]
							: []
				}
			});
		});
		await page.route('**/api/catalog/info*', (route) => route.fulfill({ json: { info: null } }));
		await page.goto('/add/search?q=Il%20libro%20italiano');
		await expect(page.getByText(/Nessun risultato per/)).toBeVisible();
		const sbn = page.getByRole('button', { name: 'Cerca nel catalogo italiano SBN' });
		test.skip(!(await sbn.count()), 'SBN_BRIDGE_URL non configurato sul server di prova');
		await sbn.click();
		await page.getByRole('list', { name: 'Risultati della ricerca' }).getByRole('button').click();
		await page.getByRole('button', { name: 'Aggiungi alla mia libreria' }).click();
		await pickGenreAndAdd(page, 'Classici');
		await page.waitForURL(/\/book\/[0-9a-f-]{36}$/);
		const db = admin();
		try {
			const [row] =
				await db`select e.sbn_id from public.editions e join public.user_books b on b.edition_id=e.id where b.user_id=${account.id}::uuid and e.sbn_id=${sbnId}`;
			expect(row?.sbn_id).toBe(sbnId);
		} finally {
			await db.end();
		}
	});

	test('LOC: ricerca esplicita e salvataggio della scheda senza ISBN', async ({
		page,
		account
	}) => {
		const locId = `LOC${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`;
		const locTitle = `Libro LOC ${randomUUID().slice(0, 8)}`;
		await page.route('**/api/catalog/search*', (route) => {
			const params = new URL(route.request().url()).searchParams;
			return route.fulfill({
				json: {
					contractVersion: 1,
					degraded: false,
					providers: {},
					candidates:
						params.get('source') === 'loc'
							? [
									candidate({
										provider: 'loc',
										workTitle: locTitle,
										editionTitle: locTitle,
										language: 'en',
										providerIds: {
											openLibraryWorkId: null,
											openLibraryEditionId: null,
											googleBooksId: null,
											locId
										},
										coverUrl: null
									})
								]
							: []
				}
			});
		});
		await page.route('**/api/catalog/info*', (route) => route.fulfill({ json: { info: null } }));
		await page.goto('/add/search?q=Clean%20Code');
		await expect(page.getByText(/Nessun risultato per/)).toBeVisible();
		const locButton = page.getByRole('button', { name: 'Cerca nel catalogo Library of Congress' });
		await expect(locButton).toBeVisible();
		await locButton.click();
		await expect(
			page.getByText('Risultati dal catalogo della Library of Congress (fino a 10 schede).')
		).toBeVisible();
		await page.getByLabel('Risultati da').selectOption('loc');
		const results = page.getByRole('list', { name: 'Risultati della ricerca' });
		await results.getByRole('button').click();
		await page.getByRole('button', { name: 'Aggiungi alla mia libreria' }).click();
		await pickGenreAndAdd(page, 'Classici');
		await page.waitForURL(/\/book\/[0-9a-f-]{36}$/);
		const db = admin();
		try {
			const [row] =
				await db`select e.loc_id from public.editions e join public.user_books b on b.edition_id=e.id where b.user_id=${account.id}::uuid and e.loc_id=${locId}`;
			expect(row?.loc_id).toBe(locId);
		} finally {
			await db.end();
		}
	});

	test('edizioni: carica due pagine e salva l’edizione senza ereditare pagine o copertina', async ({
		page,
		account
	}) => {
		await page.route('**/api/catalog/search*', (route) =>
			route.fulfill({
				json: {
					contractVersion: 1,
					candidates: [
						candidate({
							providerIds: {
								openLibraryWorkId: 'OL1W',
								openLibraryEditionId: 'OL1M',
								googleBooksId: null
							}
						})
					],
					degraded: false,
					providers: {}
				}
			})
		);
		await page.route('**/api/catalog/info*', (route) => route.fulfill({ json: { info: null } }));
		const offsets: string[] = [];
		const isbn = randomIsbn13();
		const title = `Edizione nuova ${randomUUID().slice(0, 8)}`;
		await page.route('**/api/catalog/editions*', (route) => {
			const offset = new URL(route.request().url()).searchParams.get('offset') ?? '0';
			offsets.push(offset);
			return route.fulfill({
				json: {
					total: 41,
					nextOffset: offset === '0' ? 40 : null,
					editions: [
						{
							title: offset === '0' ? title : 'Edizione precedente',
							publisher: 'Editore nuovo',
							year: offset === '0' ? 2025 : 2000,
							language: 'en',
							pages: null,
							isbn13: offset === '0' ? isbn : null,
							coverUrl: null,
							url: `https://openlibrary.org/books/${offset === '0' ? 'OL2M' : 'OL3M'}`
						}
					]
				}
			});
		});
		await page.goto('/add/search?q=Dune');
		await page.getByRole('list', { name: 'Risultati della ricerca' }).getByRole('button').click();
		const detail = page.getByRole('complementary', { name: 'Libro selezionato' });
		await detail.getByRole('button', { name: 'Carica altre edizioni' }).click();
		await expect(
			detail.getByRole('button', { name: /Scegli Edizione in inglese, Editore nuovo, 2025/ })
		).toBeVisible();
		await detail.getByRole('button', { name: 'Carica altre edizioni' }).click();
		await expect(detail.getByRole('button', { name: 'Carica altre edizioni' })).toHaveCount(0);
		expect(offsets).toEqual(['0', '40']);
		await detail.getByLabel('Lingua delle edizioni').selectOption('it');
		await expect(detail.getByText('Nessuna edizione caricata per questa lingua.')).toBeVisible();
		await detail.getByLabel('Lingua delle edizioni').selectOption('en');
		await detail
			.getByRole('button', { name: /Scegli Edizione in inglese, Editore nuovo, 2025/ })
			.click();
		await expect(detail.getByRole('heading', { name: title })).toBeVisible();
		await detail.getByRole('button', { name: 'Aggiungi alla mia libreria' }).click();
		await pickGenreAndAdd(page, 'Classici');
		await page.waitForURL(/\/book\/[0-9a-f-]{36}$/);
		expect((await userBooks(account.id)).find((book) => book.isbn_13 === isbn)).toMatchObject({
			title,
			page_count: null,
			language: 'en',
			cover_url: null
		});
	});

	test('copertina manuale: ritenta upload senza aggiungere un secondo libro', async ({
		page,
		account
	}) => {
		let uploads = 0;
		await page.route('**/api/covers/upload', (route) =>
			++uploads === 1
				? route.fulfill({ status: 502, json: { code: 'NETWORK', message: 'Upload non riuscito' } })
				: route.continue()
		);
		const title = `Foto manuale ${randomUUID().slice(0, 8)}`;
		await page.goto('/add/manual');
		await page.waitForLoadState('networkidle');
		await page.getByLabel('Titolo').fill(title);
		await page.getByLabel('Autore', { exact: true }).fill('Autore Foto');
		await page
			.getByLabel('Carica una copertina')
			.setInputFiles({ name: 'cover.png', mimeType: 'image/png', buffer: PNG_1X1 });
		await expect(page.getByAltText('Anteprima della copertina personale')).toBeVisible();
		await page.getByRole('button', { name: 'Continua' }).click();
		await pickGenreAndAdd(page, 'Classici');
		await expect(page.getByRole('dialog').getByText(/Il libro è stato aggiunto, ma/)).toBeVisible();
		await page.getByRole('button', { name: 'Riprova il caricamento' }).click();
		await page.waitForURL(/\/book\/[0-9a-f-]{36}$/);
		const books = (await userBooks(account.id)).filter((book) => book.title === title);
		expect(books).toHaveLength(1);
		expect(books[0]?.cover_storage_path).toBeTruthy();
		expect(uploads).toBe(2);
	});

	test('scanner: lookup ISBN simulato con preselezione (ISBN esatto)', async ({
		page,
		account
	}) => {
		const isbn = randomIsbn13();
		await page.route('**/api/catalog/isbn*', async (route) => {
			const url = new URL(route.request().url());
			expect(url.searchParams.get('isbn')).toBe(isbn);
			await route.fulfill({
				json: {
					contractVersion: 1,
					degraded: false,
					providers: {},
					exactMatch: true,
					candidates: [
						candidate({
							provider: 'open-library',
							providerIds: {
								openLibraryWorkId: `OLW${randomUUID().slice(0, 6)}`,
								openLibraryEditionId: `OLM${randomUUID().slice(0, 6)}`,
								googleBooksId: null
							},
							editionTitle: 'Il libro scansionato',
							workTitle: 'Il libro scansionato',
							isbn13: isbn,
							matchReasons: ['isbn-exact'],
							coverUrl: null
						})
					]
				}
			});
		});
		await page.route('**/api/catalog/info*', (route) => route.fulfill({ json: { info: null } }));
		await page.goto('/add/scan');
		await page.waitForLoadState('networkidle');
		// Senza fotocamera (o con permesso negato) resta l'inserimento a mano dell'ISBN.
		await page.getByLabel('Oppure digita l’ISBN').fill('9780000000000');
		await page.getByRole('button', { name: 'Cerca' }).click();
		await expect(page.getByText(/ISBN non valido/)).toBeVisible();

		await page.getByLabel('Oppure digita l’ISBN').fill(isbn.replace(/^(\d{3})(\d{2})/, '$1-$2-'));
		await page.getByRole('button', { name: 'Cerca' }).click();

		// ISBN identico: il libro è già selezionato nel dettaglio.
		const detail = page.getByRole('complementary', { name: 'Libro selezionato' });
		await expect(detail.getByRole('heading', { name: 'Il libro scansionato' })).toBeVisible();
		await detail.getByRole('button', { name: 'Aggiungi alla mia libreria' }).click();
		const sheet = page.getByRole('dialog', { name: 'Aggiungi alla libreria' });
		await expect(sheet.getByText('Il libro scansionato')).toBeVisible();
		await choose(sheet, 'Classici');
		await sheet.getByRole('button', { name: 'Aggiungi', exact: true }).click();
		await page.waitForURL(/\/book\/[0-9a-f-]{36}$/);

		const added = (await userBooks(account.id)).find((book) => book.isbn_13 === isbn);
		expect(added).toMatchObject({
			title: 'Il libro scansionato',
			source: 'isbn',
			slug: 'classics'
		});
	});

	test('scanner: ISBN non trovato porta all’inserimento manuale con ISBN', async ({ page }) => {
		await page.route('**/api/catalog/isbn*', (route) =>
			route.fulfill({
				json: {
					contractVersion: 1,
					degraded: false,
					providers: {},
					exactMatch: false,
					candidates: []
				}
			})
		);
		await page.goto('/add/scan');
		await page.waitForLoadState('networkidle');
		await page.getByLabel('Oppure digita l’ISBN').fill('9788804668039');
		await page.getByRole('button', { name: 'Cerca' }).click();
		await expect(page.getByRole('heading', { name: 'Non trovo questo ISBN' })).toBeVisible();
		await page.getByRole('link', { name: 'Inserisci a mano' }).click();
		await expect(page.getByLabel('ISBN (facoltativo)')).toHaveValue('9788804668039');
	});

	test('duplicati: stesso ISBN (esatto) e stesso titolo (forzabile)', async ({ page, account }) => {
		const isbn = randomIsbn13();
		const fill = async (title: string, author: string, withIsbn: boolean) => {
			await page.goto('/add/manual');
			await page.waitForLoadState('networkidle');
			await page.getByLabel('Titolo').fill(title);
			await page.getByLabel('Autore').fill(author);
			if (withIsbn) await page.getByLabel('ISBN (facoltativo)').fill(isbn);
			await page.getByRole('button', { name: 'Continua' }).click();
			await pickGenreAndAdd(page, 'Classici');
		};

		await fill('Doppione di prova', 'Anna Rossi', true);
		await page.waitForURL(/\/book\/[0-9a-f-]{36}$/);
		const firstId = page.url().split('/').pop();

		// Stesso ISBN, titolo diverso: duplicato esatto, si può solo aprire il libro
		await fill('Un altro titolo', 'Un altro autore', true);
		const dialog = page.getByRole('dialog', { name: 'Aggiungi alla libreria' });
		await expect(dialog.getByRole('alert')).toContainText('Questo libro è già in libreria');
		await expect(dialog.getByRole('button', { name: 'Aggiungi comunque' })).toHaveCount(0);
		await expect(dialog.getByRole('link', { name: 'Apri il libro' })).toHaveAttribute(
			'href',
			`/book/${firstId}`
		);

		// Stesso titolo e autore, senza ISBN: avviso + "Aggiungi comunque"
		await fill('Doppione di prova', 'anna rossi', false);
		await expect(dialog.getByRole('alert')).toContainText('Hai già un libro con questo titolo');
		await dialog.getByRole('button', { name: 'Aggiungi comunque' }).click();
		await page.waitForURL(
			(url) => /\/book\/[0-9a-f-]{36}$/.test(url.pathname) && !url.pathname.endsWith(firstId ?? '')
		);

		const copies = (await userBooks(account.id)).filter(
			(book) => book.title === 'Doppione di prova'
		);
		expect(copies).toHaveLength(2);
	});

	test('serie: aggiunge un volume mancante dal gruppo e ne precompila i dati', async ({
		page,
		account
	}) => {
		const seriesName = `Saga gatto ${randomUUID().slice(0, 8)}`;
		const firstTitle = `Volume uno ${randomUUID().slice(0, 6)}`;
		const secondTitle = `Volume due ${randomUUID().slice(0, 6)}`;
		await page.route('**/api/catalog/search*', (route) =>
			route.fulfill({
				json: {
					contractVersion: 1,
					degraded: false,
					providers: {},
					candidates: [
						candidate({
							workTitle: secondTitle,
							editionTitle: secondTitle,
							authors: ['Autore Serie'],
							isbn13: null,
							coverUrl: null
						})
					]
				}
			})
		);
		await page.route('**/api/catalog/info*', (route) => route.fulfill({ json: { info: null } }));

		await page.goto('/add/manual');
		await page.waitForLoadState('networkidle');
		await page.getByLabel('Titolo').fill(firstTitle);
		await page.getByLabel('Autore').fill('Autore Serie');
		await page.getByRole('button', { name: 'Continua' }).click();
		const firstSheet = page.getByRole('dialog', { name: 'Aggiungi alla libreria' });
		await choose(firstSheet, 'Classici');
		await firstSheet.getByLabel('Nome della serie').fill(seriesName);
		await firstSheet.getByLabel('Numero volume').fill('1');
		await firstSheet.getByLabel('Volumi totali').fill('3');
		await firstSheet.getByRole('button', { name: 'Aggiungi', exact: true }).click();
		await page.waitForURL(/\/book\/[0-9a-f-]{36}$/);

		const addSecondVolume = page.getByRole('link', {
			name: `Aggiungi volume 2 alla serie ${seriesName}`
		});
		await expect(addSecondVolume).toBeVisible();
		await addSecondVolume.click();
		await page.waitForURL(/\/add\/search/);
		const addUrl = new URL(page.url());
		expect(addUrl.pathname).toBe('/add/search');
		expect(addUrl.searchParams.get('seriesName')).toBe(seriesName);
		expect(addUrl.searchParams.get('seriesNumber')).toBe('2');
		expect(addUrl.searchParams.get('seriesTotal')).toBe('3');

		await page.getByRole('searchbox').fill(secondTitle);
		await page.getByRole('button', { name: new RegExp(secondTitle) }).click();
		await page
			.getByRole('complementary', { name: 'Libro selezionato' })
			.getByRole('button', { name: 'Aggiungi alla mia libreria' })
			.click();
		const secondSheet = page.getByRole('dialog', { name: 'Aggiungi alla libreria' });
		await expect(secondSheet.getByLabel('Nome della serie')).toHaveValue(seriesName);
		await expect(secondSheet.getByLabel('Numero volume')).toHaveValue('2');
		await expect(secondSheet.getByLabel('Volumi totali')).toHaveValue('3');
		await choose(secondSheet, 'Classici');
		await secondSheet.getByRole('button', { name: 'Aggiungi', exact: true }).click();
		await page.waitForURL(/\/book\/[0-9a-f-]{36}$/);

		const volumes = (await userBooks(account.id))
			.filter((book) => book.series_name === seriesName)
			.sort((a, b) => Number(a.series_number) - Number(b.series_number));
		expect(volumes.map((book) => Number(book.series_number))).toEqual([1, 2]);
		const seriesBooks = page.getByRole('list', { name: `Libri della serie ${seriesName}` });
		await expect(seriesBooks.getByRole('link', { name: new RegExp(firstTitle) })).toBeVisible();
		await expect(seriesBooks.getByRole('link', { name: new RegExp(secondTitle) })).toBeVisible();

		const thirdTitle = `Volume tre ${randomUUID().slice(0, 6)}`;
		await page.goto('/add/manual');
		await page.waitForLoadState('networkidle');
		await page.getByLabel('Titolo').fill(thirdTitle);
		await page.getByLabel('Autore').fill('Autore Serie');
		await page.getByRole('button', { name: 'Continua' }).click();
		const thirdSheet = page.getByRole('dialog', { name: 'Aggiungi alla libreria' });
		await choose(thirdSheet, 'Classici');
		await thirdSheet.getByLabel('Nome della serie').fill(seriesName);
		await thirdSheet.getByLabel('Numero volume').fill('3');
		await thirdSheet.getByRole('button', { name: 'Aggiungi', exact: true }).click();
		await page.waitForURL(/\/book\/[0-9a-f-]{36}$/);
		const allVolumes = (await userBooks(account.id)).filter(
			(book) => book.series_name === seriesName
		);
		expect(allVolumes.map((book) => Number(book.series_number)).sort()).toEqual([1, 2, 3]);
		expect(allVolumes.map((book) => book.series_total)).toEqual([3, 3, 3]);

		await page.getByRole('button', { name: 'Altre azioni' }).click();
		await page.getByRole('menuitem', { name: 'Modifica edizione e dati' }).click();
		await page.waitForURL(/\/book\/[0-9a-f-]{36}\/edit$/);
		await page.getByRole('button', { name: 'Continua alla personalizzazione' }).click();
		const editSheet = page.getByRole('dialog', { name: 'Modifica libro' });
		await editSheet.getByLabel('Volumi totali').fill('5');
		await editSheet.getByRole('button', { name: 'Salva modifiche' }).click();
		await page.waitForURL(/\/book\/[0-9a-f-]{36}$/);
		await expect(
			page.getByRole('link', { name: `Aggiungi volume 5 alla serie ${seriesName}` })
		).toBeVisible();
		const updatedVolumes = (await userBooks(account.id)).filter(
			(book) => book.series_name === seriesName
		);
		expect(updatedVolumes.map((book) => book.series_total)).toEqual([5, 5, 5]);
	});

	test('serie: associa a una serie un libro già inserito', async ({ page, account }) => {
		const title = `Libro già inserito ${randomUUID().slice(0, 8)}`;
		const seriesName = `Serie aggiunta dopo ${randomUUID().slice(0, 8)}`;
		await page.goto('/add/manual');
		await page.waitForLoadState('networkidle');
		await page.getByLabel('Titolo').fill(title);
		await page.getByLabel('Autore').fill('Autore Serie');
		await page.getByRole('button', { name: 'Continua' }).click();
		await pickGenreAndAdd(page, 'Classici');
		await page.waitForURL(/\/book\/[0-9a-f-]{36}$/);

		await page.getByRole('button', { name: 'Altre azioni' }).click();
		await page.getByRole('menuitem', { name: 'Modifica edizione e dati' }).click();
		await page.waitForURL(/\/book\/[0-9a-f-]{36}\/edit$/);
		await page.getByRole('button', { name: 'Continua alla personalizzazione' }).click();
		const sheet = page.getByRole('dialog', { name: 'Modifica libro' });
		await sheet.getByLabel('Nome della serie').fill(seriesName);
		await sheet.getByLabel('Numero volume').fill('2');
		await sheet.getByLabel('Volumi totali').fill('3');
		await sheet.getByLabel('Numero volume').fill('1.234');
		await sheet.getByRole('button', { name: 'Salva modifiche' }).click();
		await expect(sheet.getByRole('alert')).toHaveText(
			'Il numero del volume può avere al massimo due decimali.'
		);
		await sheet.getByLabel('Numero volume').fill('2');
		await sheet.getByRole('button', { name: 'Salva modifiche' }).click();
		await page.waitForURL(/\/book\/[0-9a-f-]{36}$/);

		await expect(page.getByRole('region', { name: `Serie ${seriesName}` })).toBeVisible();
		await expect(page.getByRole('link', { name: `Volume 2: ${title}` })).toBeVisible();
		const row = (await userBooks(account.id)).find((book) => book.title === title);
		expect(row).toMatchObject({
			series_name: seriesName,
			series_total: 3
		});
		expect(Number(row?.series_number)).toBe(2);
	});
});

test.describe('scanner ISBN: fotocamera', () => {
	test('permesso negato: messaggio chiaro e alternative', async ({ page }) => {
		await page.addInitScript(() => {
			navigator.mediaDevices.getUserMedia = () =>
				Promise.reject(new DOMException('denied', 'NotAllowedError'));
		});
		await page.goto('/add/scan');
		const problem = page.getByTestId('scanner-problem');
		await expect(problem).toHaveAttribute('data-status', 'denied');
		await expect(problem).toContainText('Accesso alla fotocamera negato');
		await expect(page.getByRole('link', { name: 'Vai alla ricerca' })).toBeVisible();
		await expect(page.getByLabel('Oppure digita l’ISBN')).toBeVisible();
	});

	test('nessuna fotocamera: fallback', async ({ page }) => {
		await page.addInitScript(() => {
			navigator.mediaDevices.getUserMedia = () =>
				Promise.reject(new DOMException('none', 'NotFoundError'));
		});
		await page.goto('/add/scan');
		await expect(page.getByTestId('scanner-problem')).toHaveAttribute('data-status', 'no-camera');
	});

	test('lo stream viene fermato quando si lascia la pagina', async ({ page }) => {
		await page.addInitScript(() => {
			const w = window as unknown as { __stops: number; __tracks: number };
			w.__stops = 0;
			w.__tracks = 0;
			navigator.mediaDevices.getUserMedia = async () => {
				const canvas = document.createElement('canvas');
				canvas.width = 320;
				canvas.height = 240;
				canvas.getContext('2d')?.fillRect(0, 0, 320, 240);
				const stream = canvas.captureStream(10);
				for (const track of stream.getTracks()) {
					w.__tracks++;
					const stop = track.stop.bind(track);
					track.stop = () => {
						w.__stops++;
						stop();
					};
				}
				return stream;
			};
		});
		await page.goto('/add/scan');
		await expect(page.getByTestId('scanner-viewfinder')).toBeVisible();
		await expect
			.poll(() => page.evaluate(() => (window as unknown as { __tracks: number }).__tracks))
			.toBeGreaterThan(0);
		await page.getByRole('link', { name: 'Annulla' }).click();
		await page.waitForURL('**/library');
		const { stops, tracks } = await page.evaluate(() => {
			const w = window as unknown as { __stops: number; __tracks: number };
			return { stops: w.__stops, tracks: w.__tracks };
		});
		expect(stops).toBeGreaterThanOrEqual(tracks);
	});
});

test.describe('cover', () => {
	test.describe.configure({ mode: 'serial' });
	let bookId = '';

	test('upload: png valido, troppo grande, tipo non valido; ownership e path traversal', async ({
		page,
		account
	}) => {
		// Crea un libro dell'utente di prova
		await page.goto('/add/manual');
		await page.waitForLoadState('networkidle');
		await page.getByLabel('Titolo').fill('Libro con cover');
		await page.getByLabel('Autore').fill('Cora Verdi');
		await page.getByRole('button', { name: 'Continua' }).click();
		await pickGenreAndAdd(page, 'Romance, Young Adult e New Adult');
		await page.waitForURL(/\/book\/[0-9a-f-]{36}$/);
		bookId = page.url().split('/').pop() ?? '';

		const headers = { origin: ORIGIN };
		const upload = (file: { name: string; mimeType: string; buffer: Buffer }, id = bookId) =>
			page.request.post('/api/covers/upload', {
				headers,
				multipart: { bookId: id, file },
				maxRetries: 1
			});

		const ok = await upload({ name: 'cover.png', mimeType: 'image/png', buffer: PNG_1X1 });
		expect(ok.status()).toBe(200);
		const { coverStoragePath } = await ok.json();
		expect(coverStoragePath).toMatch(new RegExp(`^covers/${account.id}/[0-9a-f-]{36}\\.png$`));

		const served = await page.request.get(`/api/covers/${coverStoragePath}`);
		expect(served.status()).toBe(200);
		expect(served.headers()['content-type']).toBe('image/png');
		expect(served.headers()['cache-control']).toContain('private');
		expect(served.headers()['x-content-type-options']).toBe('nosniff');
		expect(Buffer.from(await served.body()).equals(PNG_1X1)).toBe(true);
		for (const width of [128, 320, 768]) {
			const variant = await page.request.get(`/api/covers/${coverStoragePath}?w=${width}`);
			expect(variant.status()).toBe(200);
			expect(variant.headers()['content-type']).toBe('image/webp');
			expect(variant.headers()['cache-control']).toContain('private');
		}
		expect((await page.request.get(`/api/covers/${coverStoragePath}?w=999`)).status()).toBe(404);

		// Troppo grande: sia nel file (5,1 MB) sia oltre il limite della richiesta
		const big = Buffer.concat([PNG_1X1, Buffer.alloc(5 * 1024 * 1024 + 100_000)]);
		expect((await upload({ name: 'big.png', mimeType: 'image/png', buffer: big })).status()).toBe(
			413
		);
		const huge = Buffer.concat([PNG_1X1, Buffer.alloc(7 * 1024 * 1024)]);
		expect((await upload({ name: 'huge.png', mimeType: 'image/png', buffer: huge })).status()).toBe(
			413
		);

		// Tipo non valido: testo, e un file che dichiara un tipo diverso dal contenuto
		const text = await upload({
			name: 'note.txt',
			mimeType: 'text/plain',
			buffer: Buffer.from('ciao')
		});
		expect(text.status()).toBe(415);
		expect((await text.json()).code).toBe('VALIDATION');
		const liar = await upload({ name: 'x.jpg', mimeType: 'image/jpeg', buffer: PNG_1X1 });
		expect(liar.status()).toBe(415);

		// Libro inesistente / di un altro utente, bookId non valido
		expect(
			(
				await upload({ name: 'c.png', mimeType: 'image/png', buffer: PNG_1X1 }, randomUUID())
			).status()
		).toBe(404);
		expect(
			(
				await upload({ name: 'c.png', mimeType: 'image/png', buffer: PNG_1X1 }, 'non-un-uuid')
			).status()
		).toBe(422);

		// Path traversal e cover di altri utenti
		for (const bad of [
			'covers/../../etc/passwd',
			`covers/${account.id}/..%2F..%2Fsecret.png`,
			`covers/${randomUUID()}/${randomUUID()}.png`,
			`covers/${account.id}/${randomUUID()}.png`
		]) {
			expect((await page.request.get(`/api/covers/${bad}`)).status()).toBe(404);
			expect((await page.request.get(`/api/covers/${bad}?w=320`)).status()).toBe(404);
		}

		// Nessuna sessione: nessun accesso
		const anonymous = await page
			.context()
			.browser()!
			.newContext({
				baseURL: ORIGIN,
				storageState: { cookies: [], origins: [] }
			});
		const anon = await anonymous.request.get(`/api/covers/${coverStoragePath}`);
		expect(anon.headers()['content-type']).not.toContain('image/');
		await anonymous.close();

		// Il DB punta al file caricato e il rifiuto non ha lasciato file orfani
		const [book] = (await userBooks(account.id)).filter((row) => row.id === bookId);
		expect(book?.cover_storage_path).toBe(coverStoragePath);
	});

	test('CoverPicker: apertura, caricamento da galleria e rimozione', async ({ page, account }) => {
		await page.route('**/api/covers/alternatives*', (route) =>
			route.fulfill({ json: { alternatives: [], degraded: false } })
		);
		await page.goto(`/book/${bookId}`);
		await page.waitForLoadState('networkidle');
		await page.getByRole('button', { name: 'Altre azioni' }).click();
		await page.getByRole('menuitem', { name: 'Cambia copertina' }).click();

		const sheet = page.getByRole('dialog', { name: 'Cambia copertina' });
		await expect(sheet).toBeVisible();
		await expect(sheet.getByText('Non ho trovato altre copertine')).toBeVisible();

		// Tipo non valido: errore lato client
		await sheet.getByLabel('Scegli un’immagine dalla galleria').setInputFiles({
			name: 'note.txt',
			mimeType: 'text/plain',
			buffer: Buffer.from('ciao')
		});
		await expect(sheet.getByRole('alert')).toContainText('Formato non supportato');

		// File valido
		const before = (await userBooks(account.id)).find(
			(row) => row.id === bookId
		)?.cover_storage_path;
		await sheet.getByLabel('Scegli un’immagine dalla galleria').setInputFiles({
			name: 'nuova.png',
			mimeType: 'image/png',
			buffer: PNG_1X1
		});
		const storagePath = async () =>
			(await userBooks(account.id)).find((row) => row.id === bookId)?.cover_storage_path;
		await expect.poll(storagePath).not.toBe(before);
		await expect(sheet.getByText('personalizzata', { exact: true })).toBeVisible();
		const after = await storagePath();
		expect(after).toBeTruthy();
		// il vecchio file è stato eliminato
		expect((await page.request.get(`/api/covers/${before}`)).status()).toBe(404);

		// Rimozione con conferma
		await sheet.getByRole('button', { name: 'Rimuovi cover personalizzata' }).click();
		await page.getByRole('alertdialog').getByRole('button', { name: 'Rimuovi' }).click();
		await expect(sheet.getByText('nessuna', { exact: true })).toBeVisible();
		expect(
			(await userBooks(account.id)).find((row) => row.id === bookId)?.cover_storage_path
		).toBeNull();
		expect((await page.request.get(`/api/covers/${after}`)).status()).toBe(404);
	});

	test('select: cover di un provider solo da host consentiti', async ({ page, account }) => {
		const post = (data: unknown) =>
			page.request.post('/api/covers/select', { data, headers: { origin: ORIGIN } });
		const bad = await post({
			action: 'provider',
			bookId,
			coverUrl: 'https://evil.example.com/a.jpg'
		});
		expect(bad.status()).toBe(422);
		const ok = await post({
			action: 'provider',
			bookId,
			coverUrl: 'https://covers.openlibrary.org/b/id/123-L.jpg'
		});
		expect(ok.status()).toBe(200);
		expect((await userBooks(account.id)).find((row) => row.id === bookId)?.cover_url).toBe(
			'https://covers.openlibrary.org/b/id/123-L.jpg'
		);
	});
});

for (const originalCover of [null, 'https://books.google.com/books/content?id=broken']) {
	test(`cover ISBN: recupera e salva l'edizione esatta con URL ${originalCover ? 'non funzionante' : 'assente'}`, async ({
		page,
		account
	}) => {
		const isbn = randomIsbn13();
		const cover = `https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg?default=false`;
		const result = candidate({
			isbn13: isbn,
			workTitle: `Copertina ${isbn}`,
			editionTitle: `Copertina ${isbn}`,
			coverUrl: originalCover
		});
		await page.route('**/api/catalog/search*', (route) =>
			route.fulfill({
				json: {
					contractVersion: 1,
					degraded: true,
					providers: { 'google-books': 'rate_limited' },
					candidates: [result]
				}
			})
		);
		await page.route('**/api/catalog/isbn*', (route) =>
			route.fulfill({
				json: {
					contractVersion: 1,
					degraded: false,
					providers: {},
					exactMatch: false,
					candidates: []
				}
			})
		);
		await page.route('**/api/catalog/info*', (route) => route.fulfill({ json: { info: null } }));
		await page.route('https://books.google.com/**', (route) => route.fulfill({ status: 404 }));
		const requested: string[] = [];
		await page.route('https://covers.openlibrary.org/**', (route) => {
			requested.push(route.request().url());
			return route.fulfill({ body: PNG_1X1, contentType: 'image/png' });
		});
		await page.goto('/add/search');
		await page.waitForLoadState('networkidle');
		await page.getByRole('searchbox').fill('copertina recuperata');
		await expect(
			page.getByText(
				'Google Books: limite di richieste raggiunto. I risultati potrebbero essere incompleti.'
			)
		).toBeVisible();
		const row = page.getByRole('button', { name: new RegExp(`^Copertina ${isbn} Ada Verdi`) });
		await expect(row.locator('img')).toHaveAttribute('src', cover);
		await row.click();
		const detail = page.getByRole('complementary', { name: 'Libro selezionato' });
		await expect(detail.locator('.head img')).toHaveAttribute('src', cover);
		await expect
			.poll(() => detail.locator('.head img').evaluate((img) => (img as HTMLImageElement).complete))
			.toBe(true);
		await detail.getByRole('button', { name: 'Aggiungi alla mia libreria' }).click();
		const sheet = page.getByRole('dialog', { name: 'Aggiungi alla libreria' });
		await choose(sheet, 'Classici');
		await sheet.getByRole('button', { name: 'Aggiungi', exact: true }).click();
		await page.waitForURL(/\/book\/[0-9a-f-]{36}$/);
		expect((await userBooks(account.id)).find((book) => book.isbn_13 === isbn)).toMatchObject({
			cover_url: cover,
			title: result.editionTitle,
			author_display: 'Ada Verdi'
		});
		expect(requested.length).toBeGreaterThan(0);
		expect(requested.every((url) => url === cover)).toBe(true);
	});
}

test('cover ISBN assente: mantiene il segnaposto e non ripete il tentativo nel dettaglio', async ({
	page
}) => {
	const isbn = randomIsbn13();
	const result = candidate({ isbn13: isbn, coverUrl: null });
	await page.route('**/api/catalog/search*', (route) =>
		route.fulfill({
			json: {
				contractVersion: 1,
				degraded: false,
				providers: {},
				candidates: [result]
			}
		})
	);
	await page.route('**/api/catalog/isbn*', (route) =>
		route.fulfill({
			json: {
				contractVersion: 1,
				degraded: false,
				providers: {},
				exactMatch: false,
				candidates: []
			}
		})
	);
	await page.route('**/api/catalog/info*', (route) => route.fulfill({ json: { info: null } }));
	let covers = 0;
	await page.route('https://covers.openlibrary.org/**', (route) => {
		covers++;
		return route.fulfill({ status: 404 });
	});
	await page.goto('/add/search');
	await page.waitForLoadState('networkidle');
	await page.getByRole('searchbox').fill('copertina assente');
	const row = page.getByRole('button', { name: /^La sfida del mago Ada Verdi/ });
	await expect(row.locator('.placeholder')).toBeVisible();
	await expect.poll(() => covers).toBe(1);
	await row.click();
	const detail = page.getByRole('complementary', { name: 'Libro selezionato' });
	await expect(detail.locator('.head .placeholder')).toBeVisible();
	await page.waitForLoadState('networkidle');
	expect(covers).toBe(1);
});

test('gli endpoint richiedono la sessione', async ({ browser }) => {
	const context = await browser.newContext({
		baseURL: ORIGIN,
		storageState: { cookies: [], origins: [] }
	});
	for (const path of ['/api/catalog/search?title=dune', '/api/catalog/isbn?isbn=9780441013593']) {
		const response = await context.request.get(path);
		// senza sessione: redirect al login (seguito) oppure 401
		expect(response.status() === 401 || response.url().includes('/auth/login')).toBe(true);
	}
	await context.close();
});
