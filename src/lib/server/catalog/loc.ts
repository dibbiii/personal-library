import type { EditionCandidate } from '$lib/contracts/books';
import type { BookSearchRequest } from '$lib/contracts/rpc';
import { firstValidIsbn } from '$lib/catalog/isbn';
import { toIso2 } from '$lib/catalog/language';
import type { BookProvider, ProviderCallOptions } from '$lib/catalog/types';
import { DataAccessError } from '$lib/data/errors';
import { fetchText, type FetchLike } from './http';

/** SRU pubblico della Library of Congress (nessuna chiave API). */
const SRU_ENDPOINT = 'https://lx2.loc.gov/sru/lcdb';
/** Identificatore del record LC: controlfield MARCXML 001. */
const LOC_ID = /^[A-Z0-9][A-Z0-9 ]{0,31}$/;

interface MarcDatafield {
	tag: string;
	subfields: { code: string; value: string }[];
}

interface MarcRecord {
	control: Map<string, string>;
	datafields: MarcDatafield[];
}

/** Elemento MARCXML/SRU con prefisso di namespace qualsiasi (zs:, marc:, nessuno). */
function element(name: string) {
	return new RegExp(`<([\\w.-]+:)?${name}\\b([^>]*)>([\\s\\S]*?)</([\\w.-]+:)?${name}>`, 'g');
}

function attribute(source: string, name: string): string | null {
	return new RegExp(`\\b${name}="([^"]*)"`).exec(source)?.[1] ?? null;
}

const codePoint = (value: number) =>
	Number.isInteger(value) && value > 0 && value <= 0x10ffff ? String.fromCodePoint(value) : '';

function decodeXml(value: string): string {
	return value
		.replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => codePoint(parseInt(hex, 16)))
		.replace(/&#([0-9]+);/g, (_, dec: string) => codePoint(Number(dec)))
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'")
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&amp;/g, '&');
}

/** Un blocco `recordData` SRU -> campi MARC (controlfield + datafield/subfield). */
function parseMarcXmlRecord(inner: string): MarcRecord {
	const record: MarcRecord = { control: new Map(), datafields: [] };
	for (const match of inner.matchAll(element('controlfield'))) {
		const tag = attribute(match[2] ?? '', 'tag');
		if (tag) record.control.set(tag, decodeXml(match[3] ?? ''));
	}
	for (const match of inner.matchAll(element('datafield'))) {
		const tag = attribute(match[2] ?? '', 'tag');
		if (!tag) continue;
		const subfields: { code: string; value: string }[] = [];
		for (const sub of (match[3] ?? '').matchAll(element('subfield'))) {
			const code = attribute(sub[2] ?? '', 'code');
			if (code) subfields.push({ code, value: decodeXml(sub[3] ?? '') });
		}
		record.datafields.push({ tag, subfields });
	}
	return record;
}

/** Come `mapMarc` del bridge SBN (`services/sbn/bridge.mjs`), su MARCXML invece di ISO 2709. */
export function parseLocSru(xml: string, isbn13?: string): EditionCandidate[] {
	if (
		!/<([\w.-]+:)?searchRetrieveResponse\b/.test(xml) ||
		/<([\w.-]+:)?diagnostics\b/.test(xml)
	)
		throw new DataAccessError('CONTRACT', 'Risposta LOC non valida');
	if (/<([\w.-]+:)?numberOfRecords>\s*0\s*</.test(xml)) return [];
	const recordData = [...xml.matchAll(element('recordData'))].map((match) => match[3] ?? '');
	const records = recordData.length
		? recordData
		: [...xml.matchAll(element('record'))].map((match) => match[3] ?? '');
	const candidates: EditionCandidate[] = [];
	for (const recordXml of records) {
		const record = parseMarcXmlRecord(recordXml);
		const subfields = (tag: string, code: string) =>
			record.datafields
				.filter((field) => field.tag === tag)
				.flatMap((field) => field.subfields.filter((s) => s.code === code).map((s) => s.value));
		const clean = (value: string | undefined) =>
				// MARC non-sorting segments contain control characters.
				// eslint-disable-next-line no-control-regex
				value?.replace(/[\x00-\x1f\x7f\x98\x9c]/g, '')
					.replace(/\s*[/,:;=]\s*$/, '')
					.trim() || null;
		const title = clean([...subfields('245', 'a'), ...subfields('245', 'b')].join(' '));
		const locId = record.control.get('001')?.trim().toUpperCase().replace(/\s+/g, ' ') ?? '';
		if (!title || !LOC_ID.test(locId)) continue;
		const authors = [
			...new Set(
				[...subfields('100', 'a'), ...subfields('110', 'a'), ...subfields('700', 'a')]
					.map((name) => clean(name)?.replace(/[\s,.]+$/, '') ?? '')
					.filter(Boolean)
			)
		];
		// 020$a può portare qualifiche tra parentesi: "9780441013593 (pbk.)".
		const identifiers = subfields('020', 'a').map((raw) =>
			firstValidIsbn([raw.replace(/\s*\(.*/, '').trim()])
		);
		const isbn =
			identifiers.find((parsed) => parsed?.isbn13 === isbn13) ?? identifiers.find(Boolean);
		const publication = [...subfields('264', 'c'), ...subfields('260', 'c')][0];
		const pageText = subfields('300', 'a')[0] ?? '';
		const pages = /(?:^|[,;]\s*)(\d{1,5})\s*(?:p\.|pages|pagine)/i.exec(pageText)?.[1];
		candidates.push({
			provider: 'loc',
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
			language: toIso2(
				subfields('041', 'a')[0] ?? (record.control.get('008')?.slice(35, 38).trim() || null)
			),
			publisher: clean([...subfields('264', 'b'), ...subfields('260', 'b')][0]),
			publishedDate: publication?.match(/\b[12][0-9]{3}\b/)?.[0] ?? null,
			pageCount: pages && Number(pages) > 0 && Number(pages) <= 20000 ? Number(pages) : null,
			// LOC non fornisce copertine: solo metadati bibliografici.
			coverUrl: null,
			confidence: 0,
			matchReasons: []
		});
	}
	return candidates;
}

/** Compatibilita con il nome usato dalla prima implementazione locale. */
export const parseLoc = parseLocSru;

const sanitize = (value: string) =>
	value
		.normalize('NFD')
		.replace(/\p{M}/gu, '')
		.replace(/[^\p{L}\p{N}\s.,'-]/gu, ' ')
		.replace(/\s+/g, ' ')
		.trim();

/** Fallback ISBN istituzionale e ricerca testuale esplicita nella Library of Congress. */
export class LocProvider implements BookProvider {
	readonly id = 'loc' as const;
	constructor(private readonly fetchImpl?: FetchLike) {}

	private async query(
		query: string,
		options?: ProviderCallOptions,
		isbn13?: string
	): Promise<EditionCandidate[]> {
		const params = new URLSearchParams({
			operation: 'searchRetrieve',
			version: '1.1',
			query,
			recordSchema: 'marcxml',
			maximumRecords: '10',
			startRecord: '1'
		});
		const xml = await fetchText(SRU_ENDPOINT + '?' + params, {
			allowedHosts: ['lx2.loc.gov'],
			fetch: this.fetchImpl,
			signal: options?.signal
		});
		return xml === null ? [] : parseLocSru(xml, isbn13);
	}

	async search(request: BookSearchRequest, options?: ProviderCallOptions) {
		const title = sanitize(request.title);
		if (title.length < 2) return [];
		const author = request.author ? sanitize(request.author) : '';
		const query = author
			? 'dc.title="' + title + '" and dc.author="' + author + '"'
			: 'dc.title="' + title + '"';
		return this.query(query, options);
	}

	async lookupIsbn(isbn13: string, options?: ProviderCallOptions): Promise<EditionCandidate[]> {
		return this.query('bath.isbn=' + isbn13, options, isbn13);
	}
}
