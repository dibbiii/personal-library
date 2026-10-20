import type { EditionCandidate } from '$lib/contracts/books';
import { firstValidIsbn } from '$lib/catalog/isbn';
import { toIso2 } from '$lib/catalog/language';
import type { BookProvider, ProviderCallOptions } from '$lib/catalog/types';
import { DataAccessError } from '$lib/data/errors';
import { fetchText, type FetchLike } from './http';

/** SRU pubblico della Library of Congress (nessuna chiave API). */
const SRU_ENDPOINT = 'https://lx2.loc.gov/sru/lcdb';
/** Numero di controllo del record LC: controlfield MARCXML 001. */
const LOC_ID = /^[0-9]{5,12}$/;

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

function decodeXml(value: string): string {
	return value
		.replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
		.replace(/&#([0-9]+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
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
	if (!/<([\w.-]+:)?searchRetrieveResponse\b/.test(xml))
		throw new DataAccessError('CONTRACT', 'Risposta LOC non valida');
	const candidates: EditionCandidate[] = [];
	for (const match of xml.matchAll(element('recordData'))) {
		const record = parseMarcXmlRecord(match[3] ?? '');
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
		const id = record.control.get('001')?.trim() ?? '';
		if (!title || !LOC_ID.test(id)) continue;
		const authors = [...subfields('100', 'a'), ...subfields('110', 'a')]
			.map((name) => clean(name)?.replace(/\.$/, '') ?? null)
			.filter((name): name is string => Boolean(name));
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
				locId: id
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

/** Fallback istituzionale per i gruppi editoriali angloamericani (978-0, 978-1): solo ISBN. */
export class LocProvider implements BookProvider {
	readonly id = 'loc' as const;
	constructor(private readonly fetchImpl?: FetchLike) {}
	async search(): Promise<EditionCandidate[]> {
		return [];
	}
	async lookupIsbn(isbn13: string, options?: ProviderCallOptions): Promise<EditionCandidate[]> {
		const params = new URLSearchParams({
			operation: 'searchRetrieve',
			version: '1.1',
			query: `bath.isbn=${isbn13}`,
			recordSchema: 'marcxml',
			maximumRecords: '5',
			startRecord: '1'
		});
		const xml = await fetchText(`${SRU_ENDPOINT}?${params}`, {
			allowedHosts: ['lx2.loc.gov'],
			fetch: this.fetchImpl,
			signal: options?.signal
		});
		return xml === null ? [] : parseLocSru(xml, isbn13);
	}
}
