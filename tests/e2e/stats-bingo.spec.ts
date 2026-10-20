import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import postgres from 'postgres';

/**
 * Flusso Statistiche / Bingo / Citazioni / Cimitero DNF con un utente di prova (mai il demo).
 * I dati di partenza si preparano con le RPC come l'utente (set_config app.user_id), in transazione.
 */
const ADMIN_URL =
	process.env.DATABASE_ADMIN_URL ?? 'postgres://postgres:postgres@127.0.0.1:5433/segnalibro';
const YEAR = new Date().getFullYear();

let sql: postgres.Sql;

test.setTimeout(60_000);

/** Naviga e aspetta l'idratazione: i click prima di quel momento non hanno handler. */
async function open(page: Page, url: string) {
	await page.goto(url);
	await page.waitForLoadState('networkidle');
}

function dateInCurrentYear(month: number, day: number): string {
	return `${YEAR}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function timeInCurrentYear(month: number, day: number, hour: number): string {
	return `${dateInCurrentYear(month, day)}T${String(hour).padStart(2, '0')}:00:00+00`;
}

test.beforeAll(() => {
	sql = postgres(ADMIN_URL, { max: 2, onnotice: () => {} });
});

test.afterAll(async () => {
	await sql.end({ timeout: 2 });
});

async function register(page: Page): Promise<{ email: string; userId: string }> {
	const email = `b5-${randomUUID().slice(0, 8)}@test.local`;
	await open(page, '/auth/register');
	await page.getByLabel('Nome').fill('Prova B5');
	await page.getByLabel('Email').fill(email);
	await page.getByLabel('Password').fill('Segnalibro-Prova-1');
	await page.getByRole('button', { name: 'Registrati' }).click();
	await page.waitForURL(/\/library/);
	const [row] = await sql<{ id: string }[]>`select id::text from app.users where email = ${email}`;
	if (!row) throw new Error('utente di prova non trovato');
	return { email, userId: row.id };
}

async function seed(userId: string) {
	const ids = {
		read: randomUUID(),
		unread: randomUUID(),
		dnf: randomUUID(),
		reread: randomUUID()
	};

	await sql.begin(async (tx) => {
		await tx`select set_config('app.user_id', ${userId}, true)`;
		await tx`
			insert into public.user_books (id, user_id, genre_id, title, author_display, page_count, format, source)
			values
				(${ids.read}::uuid, ${userId}::uuid, 2, 'Libro Letto', 'Autrice Prova', 300, 'physical', 'manual'),
				(${ids.unread}::uuid, ${userId}::uuid, 1, 'Libro Non Letto', 'Autore Prova', 200, 'physical', 'manual'),
				(${ids.dnf}::uuid, ${userId}::uuid, 1, 'Libro Lasciato', 'Autore Lasciato', 500, 'physical', 'manual'),
				(${ids.reread}::uuid, ${userId}::uuid, 3, 'Riletto e Lasciato', 'Autore Riletto', 400, 'both', 'manual')
		`;

		await tx`select public.add_completed_reading(${ids.read}::uuid, ${timeInCurrentYear(1, 3, 10)}, ${timeInCurrentYear(1, 20, 20)}, 300, 0)`;
		await tx`select public.add_completed_reading(${ids.reread}::uuid, ${timeInCurrentYear(2, 1, 10)}, ${timeInCurrentYear(2, 10, 20)}, 400, 0)`;

		// DNF senza letture completate: entra nel Cimitero.
		const [start] = await tx<{ id: string }[]>`
			select (public.start_reading(${ids.dnf}::uuid, ${timeInCurrentYear(3, 1, 10)}, 0)->'reading'->>'id') as id`;
		await tx`select public.mark_dnf(${randomUUID()}::uuid, ${start!.id}::uuid, 77, ${timeInCurrentYear(3, 5, 10)}, ${dateInCurrentYear(3, 5)})`;

		// Rilettura abbandonata dopo una lettura completata: NON entra nel Cimitero.
		const [again] = await tx<{ id: string }[]>`
			select (public.start_reading(${ids.reread}::uuid, ${timeInCurrentYear(4, 1, 10)}, 0)->'reading'->>'id') as id`;
		await tx`select public.mark_dnf(${randomUUID()}::uuid, ${again!.id}::uuid, 55, ${timeInCurrentYear(4, 4, 10)}, ${dateInCurrentYear(4, 4)})`;

		await tx`
			insert into public.quotes (user_id, user_book_id, body, page)
			values (${userId}::uuid, ${ids.read}::uuid, 'Una frase lunga abbastanza da andare a capo nella card, per provare il word-wrap e lo scaling automatico del corpo del testo.', 42)
		`;
	});
	return ids;
}

test.describe('Profilo: Statistiche, Bingo, Citazioni, Cimitero', () => {
	let userId: string;

	test.afterEach(async () => {
		if (userId) await sql`delete from app.users where id = ${userId}::uuid`;
	});

	test('stati vuoti e poi dati: cimitero DNF con le regole della spec', async ({ page }) => {
		({ userId } = await register(page));

		// /stats ora porta alla scheda Statistiche del Profilo
		await open(page, '/stats');
		await expect(page).toHaveURL(/\/profile\?tab=stats$/);
		await expect(page.getByRole('heading', { name: 'Prova B5', level: 1 })).toBeVisible();
		await expect(page.getByTestId('stats-empty')).toBeVisible();
		await page.getByRole('link', { name: 'Abbandonati', exact: true }).click();
		await expect(page.getByTestId('dnf-empty')).toBeVisible();
		await expect(
			page.getByText('Libri lasciati a metà, senza rancore. Un fiore per ognuno.')
		).toBeVisible();

		await seed(userId);
		await page.reload();
		await page.waitForLoadState('networkidle');

		await expect(page.getByTestId('physical-unread-stat')).toContainText('1 / 4');
		await expect(page.getByTestId('physical-books-stat')).toContainText('4');
		await expect(page.getByTestId('digital-books-stat')).toContainText('1');
		const currentYearCard = page.getByTestId('current-year-books-stat');
		await expect(currentYearCard).toContainText('2');

		const tombs = page.getByTestId('tombstone');
		await expect(tombs).toHaveCount(1);
		await expect(tombs.first()).toContainText('Libro Lasciato');
		await expect(tombs.first()).toContainText('Riposa a pag. 77');
		await expect(page.getByTestId('dnf-cemetery')).not.toContainText('Riletto e Lasciato');
		await page.getByRole('link', { name: 'Statistiche', exact: true }).click();
		await expect(page.getByTestId('stats-empty')).toHaveCount(0);
		await expect(page.getByText('18.420')).toHaveCount(0);
		await expect(page.getByText(/pagine nel/)).toBeVisible();

		// Cambio anno
		await page.getByTestId('year-pill').click();
		await page.getByRole('link', { name: String(YEAR - 1) }).click();
		await expect(page).toHaveURL(new RegExp(`/profile/${YEAR - 1}\\?tab=stats$`));
		await expect(page.getByTestId('stats-empty')).toBeVisible();
		await expect(currentYearCard).toContainText('2');
	});

	test('bingo: nuova card, assegna e rimuovi un libro letto', async ({ page }) => {
		({ userId } = await register(page));
		await seed(userId);

		await open(page, `/bingo/${YEAR}`);
		await expect(page.getByTestId('bingo-empty')).toBeVisible();
		await page.getByTestId('bingo-create-year').click();
		await expect(page.getByTestId('bingo-cell')).toHaveCount(16);
		await expect(page.getByTestId('bingo-count')).toHaveText('0 su 16');

		// Solo libri letti nella lista
		await page.getByTestId('bingo-cell').first().click();
		const sheet = page.getByTestId('bingo-assign-sheet');
		await expect(sheet.getByTestId('bingo-book').first()).toBeVisible();
		await expect(sheet).toContainText('Libro Letto');
		await expect(sheet).toContainText('Riletto e Lasciato');
		await expect(sheet).not.toContainText('Libro Non Letto');
		await expect(sheet).not.toContainText('Libro Lasciato Autore');

		await sheet.getByRole('button', { name: /Libro Letto/ }).click();
		const first = page.getByTestId('bingo-cell').first();
		await expect(first).toHaveAttribute('aria-pressed', 'true');
		await expect(first).toContainText('Libro Letto');
		await expect(page.getByTestId('bingo-count')).toHaveText('1 su 16');

		await page.reload();
		await page.waitForLoadState('networkidle');
		await expect(page.getByTestId('bingo-count')).toHaveText('1 su 16');

		// Rimozione
		await page.getByTestId('bingo-cell').first().click();
		await page.getByTestId('bingo-remove').click();
		await expect(page.getByTestId('bingo-cell').first()).toHaveAttribute('aria-pressed', 'false');
		await expect(page.getByTestId('bingo-count')).toHaveText('0 su 16');

		// Nuova card per un altro anno
		await page.getByTestId('bingo-new').click();
		await page.getByRole('button', { name: String(YEAR + 1) }).click();
		await page.getByTestId('bingo-create-confirm').click();
		await expect(page).toHaveURL(new RegExp(`/bingo/${YEAR + 1}$`));
		await expect(page.getByTestId('bingo-cell')).toHaveCount(16);
	});

	test('quote card: il PNG esportato è valido e non vuoto', async ({ page }) => {
		({ userId } = await register(page));
		await seed(userId);

		await open(page, '/quotes');
		await expect(page.getByText('Una frase lunga abbastanza')).toBeVisible();
		await page.getByTestId('quote-create').first().click();
		await expect(page.getByTestId('quote-card-canvas')).toBeVisible();

		const [download] = await Promise.all([
			page.waitForEvent('download'),
			page.getByTestId('quote-card-download').click()
		]);
		expect(download.suggestedFilename()).toMatch(/^segnalibro-libro-letto\.png$/);

		const path = await download.path();
		const bytes = await readFile(path);
		expect(bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a'); // firma PNG
		expect(bytes.readUInt32BE(16)).toBe(1080); // IHDR: larghezza
		expect(bytes.readUInt32BE(20)).toBe(1350); // IHDR: altezza
		expect(bytes.length).toBeGreaterThan(20_000); // non è una tela vuota

		// Il codice Canvas non è nel caricamento iniziale della scheda Statistiche
		await open(page, '/profile?tab=stats');
		await expect(page.getByTestId('quote-card-open')).toBeEnabled();
	});
});
