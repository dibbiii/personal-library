import type { EditionCandidate } from '$lib/contracts/books';
import type { BookSearchRequest } from '$lib/contracts/rpc';
import { firstValidIsbn } from '$lib/catalog/isbn';
import { toIso2 } from '$lib/catalog/language';
import type { BookProvider, ProviderCallOptions } from '$lib/catalog/types';
import { DataAccessError } from '$lib/data/errors';
import type { FetchLike } from './http';

const USER_AGENT = 'Segnalibro/0.1 (libreria personale; contatto: self-hosted)';

/** I code point numerici non validi vengono scartati invece di far fallire l'unescape. */
const codePoint = (value: number) =>
	Number.isInteger(value) && value > 0 && value <= 0x10ffff ? String.fromCodePoint(value) : '';

/** Decodifica le entità XML di MARCXML; `&amp;` per ultimo per non doppio-decodificare. */
const unescapeXml = (value: string) =>
	value
		.replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => codePoint(parseInt(hex, 16)))
		.replace(/&#(\d+);/g, (_, digits: string) => codePoint(Number(digits)))
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'")
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&amp;/g, '&');

/** Valore di un attributo nel testo del tag d'apertura (l'ordine degli attributi non è garantito). */
const attr = (tag: string, name: string) => new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1] ?? '';

const controlfields = (record: string, tag: string) =>
	[...record.matchAll(/<controlfield([^>]*)>([\s\S]*?)<\/controlfield>/g)]
		.filter((field) => attr(field[1] ?? '', 'tag') === tag)
		.map((field) => unescapeXml(field[2] ?? ''));

const control = (record: string, tag: string) => controlfields(record, tag)[0] ?? '';

const subfields = (record: string, tag: string, code: string) =>
	[...record.matchAll(/<datafield([^>]*)>([\s\S]*?)<\/datafield>/g)]
		.filter((field) => attr(field[1] ?? '', 'tag') === tag)
		.flatMap((field) =>
			[...(field[2] ?? '').matchAll(/<subfield([^>]*)>([\s\S]*?)<\/subfield>/g)]
				.filter((subfield) => attr(subfield[1] ?? '', 'code') === code)
				.map((subfield) => unescapeXml(subfield[2] ?? ''))
		);

/** Pulizia come `mapMarc` del bridge SBN: via i caratteri di controllo MARC e la punteggiatura finale. */
const clean = (value: string | undefined) =>
	value
		// I segmenti MARC non-sorting contengono caratteri di controllo.
		// eslint-disable-next-line no-control-regex
		?.replace(/[\x00-\x1f\x7f\x98\x9c]/g, '')
		.replace(/\s*[/,:;=]\s*$/, '')
		.trim() || null;

/** Pulizia dei nomi d'autore: via i caratteri di controllo e la virgola/punto finali. */
const cleanName = (value: string) =>
	value
		// eslint-disable-next-line no-control-regex
		.replace(/[\x00-\x1f\x7f\x98\x9c]/g, '')
		.replace(/[\s,.]+$/, '')
		.trim();

/** Sanitizzazione come `buildQuery` del bridge SBN: l'output finisce tra le virgolette della query CQL. */
const sanitize = (value: string) =>
	value
		.normalize('NFD')
		.replace(/\p{M}/gu, '')
		.replace(/[^\p{L}\p{N}\s.,'-]/gu, ' ')
		.replace(/\s+/g, ' ')
		.trim();

const recordPattern = /<record(?:\s[^>]*)?>[\s\S]*?<\/record>/g;

/**
 * Parsifica una risposta SRU/MARCXML di LOC in candidati edizione (funzione pura, per i test).
 * MARCXML è generato da macchina: il parsing con regex è sufficiente.
 */
export function parseLoc(xml: string, isbn13?: string): EditionCandidate[] {
	// La busta SRU è namespaced: <zs:searchRetrieveResponse ...> (il `<` non fa parte del substring).
	if (!xml.includes('searchRetrieveResponse') || /<(?:zs:)?diagnostics/.test(xml))
		throw new DataAccessError('CONTRACT', 'Risposta LOC non valida');
	const numberOfRecords =
		/<zs:numberOfRecords>\s*([^<]*?)\s*<\/zs:numberOfRecords>/.exec(xml)?.[1] ?? '';
	if (numberOfRecords === '0') return [];
	return [...xml.matchAll(recordPattern)].flatMap((match) => {
		const record = match[0] ?? '';
		// Titolo = 245$a + 245$b; i record senza titolo vanno scartati.
		const title = clean(
			[...subfields(record, '245', 'a'), ...subfields(record, '245', 'b')].join(' ')
		);
		if (!title) return [];
		// LCCN: trim, maiuscole, spazi interni collassati; forma non valida -> null.
		const rawId = control(record, '001').trim().toUpperCase().replace(/\s+/g, ' ');
		const locId = /^[A-Z0-9][A-Z0-9 ]{0,31}$/.test(rawId) ? rawId : null;
		const authors = [
			...new Set(
				[
					...subfields(record, '100', 'a'),
					...subfields(record, '110', 'a'),
					...subfields(record, '700', 'a')
				]
					.map(cleanName)
					.filter(Boolean)
			)
		];
		// La parte tra parentesi ("(pbk.)") non fa parte dell'ISBN.
		const identifiers = subfields(record, '020', 'a').map((value) =>
			firstValidIsbn([value.replace(/\s*\(.*$/, '').trim()])
		);
		const isbn = identifiers.find((id) => id?.isbn13 === isbn13) ?? identifiers.find(Boolean);
		const language =
			subfields(record, '041', 'a')[0] ?? (control(record, '008').slice(35, 38).trim() || null);
		const publication = [...subfields(record, '264', 'c'), ...subfields(record, '260', 'c')][0];
		const pageText = subfields(record, '300', 'a')[0] ?? '';
		const pages = /(?:^|[,;]\s*)(\d{1,5})\s*(?:p\.|pages|pagine)/i.exec(pageText)?.[1];
		return [
			{
				provider: 'loc' as const,
				providerIds: {
					openLibraryWorkId: null,
					openLibraryEditionId: null,
					googleBooksId: null,
					locId
				},
				workTitle: title,
				editionTitle: title,
				authors: authors.length ? authors : ['Autore sconosciuto'],
				isbn10: isbn?.isbn10 ?? null,
				isbn13: isbn?.isbn13 ?? null,
				language: toIso2(language),
				publisher: clean([...subfields(record, '264', 'b'), ...subfields(record, '260', 'b')][0]),
				publishedDate: publication?.match(/\b[12][0-9]{3}\b/)?.[0] ?? null,
				pageCount: pages && Number(pages) > 0 && Number(pages) <= 20000 ? Number(pages) : null,
				coverUrl: null,
				confidence: 0,
				matchReasons: []
			}
		];
	});
}

/**
 * Provider SRU della Library of Congress.
 * Endpoint pubblico: solo http sulla porta 210 (https non disponibile); URL fisso, mai dalla request.
 */
export class LocProvider implements BookProvider {
	readonly id = 'loc' as const;
	private readonly base = new URL('http://lx2.loc.gov:210/lcdb');
	constructor(private readonly fetchImpl: FetchLike = fetch) {}

	/** Parametri SRU comuni a ogni ricerca. */
	private params(query: string) {
		return new URLSearchParams({
			version: '1.1',
			operation: 'searchRetrieve',
			query,
			maximumRecords: '10',
			recordSchema: 'Marcxml'
		});
	}

	/** GET che ritorna l'XML come stringa: il SRU di LOC non supporta `recordSchema=json`. */
	private async get(params: URLSearchParams, signal?: AbortSignal): Promise<string> {
		let response: Response;
		try {
			response = await this.fetchImpl(`${this.base}?${params}`, {
				headers: { accept: 'application/xml', 'user-agent': USER_AGENT },
				signal: signal
					? AbortSignal.any([signal, AbortSignal.timeout(10000)])
					: AbortSignal.timeout(10000),
				redirect: 'error'
			});
		} catch (error) {
			throw new DataAccessError('NETWORK', 'Catalogo LOC non raggiungibile', error);
		}
		if (response.status === 429) throw new DataAccessError('RATE_LIMITED', 'Catalogo LOC occupato');
		if (!response.ok) throw new DataAccessError('NETWORK', 'Catalogo LOC non disponibile');
		try {
			const text = await response.text();
			if (text.length > 2_000_000) throw new Error('risposta troppo grande');
			return text;
		} catch (error) {
			throw new DataAccessError('CONTRACT', 'Risposta LOC non valida', error);
		}
	}

	async search(request: BookSearchRequest, options?: ProviderCallOptions) {
		const title = sanitize(request.title);
		if (title.length < 2) return [];
		const author = request.author ? sanitize(request.author) : '';
		const query = author ? `dc.title="${title}" and dc.author="${author}"` : `dc.title="${title}"`;
		return parseLoc(await this.get(this.params(query), options?.signal));
	}

	async lookupIsbn(isbn13: string, options?: ProviderCallOptions) {
		return parseLoc(await this.get(this.params(`bath.isbn=${isbn13}`), options?.signal), isbn13);
	}
}
