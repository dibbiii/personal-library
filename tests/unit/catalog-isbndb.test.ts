import { describe, expect, it } from 'vitest';
import { IsbnDbProvider, parseIsbnDb } from '../../src/lib/server/catalog/isbndb';
import { editionCandidateSchema } from '../../src/lib/contracts/books';
import { DataAccessError } from '../../src/lib/data/errors';

const payload = {
	book: {
		isbn13: '9780132350884',
		isbn10: '0132350882',
		title: 'Clean Code',
		titleLong: 'Clean Code: A Handbook of Agile Software Craftsmanship',
		authors: ['Robert C. Martin'],
		publisher: 'Prentice Hall',
		datePublished: '2009-08-01',
		pages: 431,
		language: 'en',
		image: 'https://covers.openlibrary.org/b/id/8303711-L.jpg'
	}
};

describe('ISBNdb ISBN', () => {
	it('mappa il libro in un candidato valido, preferendo title a titleLong', () => {
		const [candidate] = parseIsbnDb(payload, '9780132350884');
		expect(editionCandidateSchema.safeParse(candidate).success).toBe(true);
		expect(candidate).toMatchObject({
			provider: 'isbndb',
			workTitle: 'Clean Code',
			editionTitle: 'Clean Code',
			authors: ['Robert C. Martin'],
			isbn13: '9780132350884',
			isbn10: '0132350882',
			publisher: 'Prentice Hall',
			publishedDate: '2009-08-01',
			language: 'en',
			pageCount: 431,
			coverUrl: 'https://covers.openlibrary.org/b/id/8303711-L.jpg',
			providerIds: { openLibraryWorkId: null, openLibraryEditionId: null, googleBooksId: null },
			confidence: 0,
			matchReasons: []
		});
	});
	it('gestisce i casi degradati senza inventare dati', () => {
		expect(parseIsbnDb(payload, '9782070116270')).toEqual([]);
		const senzaTitoloBreve = { book: { ...payload.book, title: null } };
		expect(parseIsbnDb(senzaTitoloBreve, '9780132350884')[0]?.editionTitle).toBe(
			'Clean Code: A Handbook of Agile Software Craftsmanship'
		);
		const senzaTitoli = { book: { ...payload.book, title: null, titleLong: null } };
		expect(parseIsbnDb(senzaTitoli, '9780132350884')).toEqual([]);
		const conPagineNonValide = { book: { ...payload.book, pages: 0 } };
		expect(parseIsbnDb(conPagineNonValide, '9780132350884')[0]?.pageCount).toBeNull();
		const conImmagineMalformata = { book: { ...payload.book, image: 'http://[' } };
		expect(parseIsbnDb(conImmagineMalformata, '9780132350884')[0]?.coverUrl).toBeNull();
		const senzaAutori = { book: { ...payload.book, authors: [] } };
		expect(parseIsbnDb(senzaAutori, '9780132350884')[0]?.authors).toEqual(['Autore sconosciuto']);
	});
	it('scarta un payload malformato con errore CONTRACT', () => {
		const malformato = () => parseIsbnDb({}, '9780132350884');
		expect(malformato).toThrow(DataAccessError);
		try {
			malformato();
		} catch (error) {
			expect((error as DataAccessError).code).toBe('CONTRACT');
		}
	});
	it('richiede una chiave API non vuota', () => {
		expect(() => new IsbnDbProvider('')).toThrow('ISBNDB_API_KEY mancante');
	});
	it("invia la chiave API nell'header X-API-Key verso /book/{isbn}", async () => {
		let richiestoUrl = '';
		let inviateHeaders: Record<string, string> | undefined;
		const provider = new IsbnDbProvider(
			'chiave-di-prova',
			async (url: string, init?: RequestInit) => {
				richiestoUrl = url;
				inviateHeaders = init?.headers as Record<string, string>;
				return new Response(JSON.stringify(payload), {
					status: 200,
					headers: { 'content-type': 'application/json' }
				});
			}
		);
		const candidates = await provider.lookupIsbn('9782070116270');
		expect(richiestoUrl).toContain('/book/9782070116270');
		expect(inviateHeaders?.['X-API-Key']).toBe('chiave-di-prova');
		expect(candidates).toEqual([]);
	});
	it('distinte assenza (404), rate limit (429) ed errore di servizio (500)', async () => {
		const assente = new IsbnDbProvider(
			'chiave',
			async () => new Response('not found', { status: 404 })
		);
		await expect(assente.lookupIsbn('9780132350884')).resolves.toEqual([]);
		const limitato = new IsbnDbProvider(
			'chiave',
			async () => new Response('busy', { status: 429 })
		);
		await expect(limitato.lookupIsbn('9780132350884')).rejects.toMatchObject({
			code: 'RATE_LIMITED'
		});
		const inErrore = new IsbnDbProvider(
			'chiave',
			async () => new Response('boom', { status: 500 })
		);
		await expect(inErrore.lookupIsbn('9780132350884')).rejects.toMatchObject({ code: 'NETWORK' });
	});
});
