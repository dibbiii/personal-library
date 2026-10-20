import { z } from 'zod';
import type { EditionCandidate } from '$lib/contracts/books';
import { firstValidIsbn } from '$lib/catalog/isbn';
import { toIso2 } from '$lib/catalog/language';
import { normalizeCoverUrl } from '$lib/catalog/covers';
import type { BookProvider, ProviderCallOptions } from '$lib/catalog/types';
import { DataAccessError } from '$lib/data/errors';
import { fetchJson, type FetchLike } from './http';

const bookSchema = z.object({
	isbn13: z.string().nullish(),
	isbn10: z.string().nullish(),
	title: z.string().nullish(),
	titleLong: z.string().nullish(),
	authors: z.array(z.string()).nullish(),
	publisher: z.string().nullish(),
	datePublished: z.string().nullish(),
	pages: z.number().nullish(),
	language: z.string().nullish(),
	image: z.string().nullish()
});
const responseSchema = z.object({ book: bookSchema });

export function parseIsbnDb(payload: unknown, isbn13: string): EditionCandidate[] {
	const response = responseSchema.safeParse(payload);
	if (!response.success) throw new DataAccessError('CONTRACT', 'Risposta ISBNdb non valida');
	const book = response.data.book;
	const title = book.title?.trim() || book.titleLong?.trim();
	if (!title) return [];
	const isbn = firstValidIsbn([book.isbn13 ?? '', book.isbn10 ?? '']);
	if (!isbn || isbn.isbn13 !== isbn13) return [];
	const authors = (book.authors ?? []).map((name) => name.trim()).filter((name) => name.length > 0);
	let coverUrl: string | null = null;
	try {
		coverUrl = book.image ? normalizeCoverUrl(book.image) : null;
	} catch {
		/* Una cover malformata non deve scartare i dati bibliografici. */
	}
	return [
		{
			provider: 'isbndb',
			// L'ISBN è l'identità dell'edizione: nessun id aggiuntivo necessario.
			providerIds: { openLibraryWorkId: null, openLibraryEditionId: null, googleBooksId: null },
			workTitle: title,
			editionTitle: title,
			authors: authors.length ? authors : ['Autore sconosciuto'],
			isbn13: isbn.isbn13,
			isbn10: isbn.isbn10,
			language: toIso2(book.language),
			publisher: book.publisher?.trim() || null,
			publishedDate: book.datePublished?.trim() || null,
			pageCount:
				typeof book.pages === 'number' &&
				Number.isInteger(book.pages) &&
				book.pages > 0 &&
				book.pages <= 20000
					? book.pages
					: null,
			coverUrl,
			confidence: 0,
			matchReasons: []
		}
	];
}

export class IsbnDbProvider implements BookProvider {
	readonly id = 'isbndb' as const;
	constructor(
		private readonly apiKey: string,
		private readonly fetchImpl?: FetchLike
	) {
		if (!apiKey) throw new Error('ISBNDB_API_KEY mancante');
	}
	async search(): Promise<EditionCandidate[]> {
		// Ricerca testuale non prevista: il provider è solo fallback per ISBN.
		return [];
	}
	async lookupIsbn(isbn13: string, options?: ProviderCallOptions): Promise<EditionCandidate[]> {
		const raw = await fetchJson(`https://api.isbndb.com/book/${isbn13}`, {
			allowedHosts: ['api.isbndb.com'],
			headers: { 'X-API-Key': this.apiKey },
			fetch: this.fetchImpl,
			signal: options?.signal
		});
		return raw === null ? [] : parseIsbnDb(raw, isbn13);
	}
}
