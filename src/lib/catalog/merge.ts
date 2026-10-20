import type { EditionCandidate } from '$lib/contracts/books';
import { isbn10To13 } from './isbn';

/**
 * Identità di un'edizione = ISBN o id del provider. Titolo + autore NON sono mai una chiave
 * (spec sez. 19): due edizioni con lo stesso titolo restano candidati distinti.
 */
export function identityKeys(candidate: EditionCandidate): string[] {
	const keys: string[] = [];
	const isbn13 = candidate.isbn13 ?? (candidate.isbn10 ? isbn10To13(candidate.isbn10) : null);
	if (isbn13) keys.push(`isbn13:${isbn13}`);
	const ids = candidate.providerIds;
	if (ids.openLibraryEditionId) keys.push(`ol-edition:${ids.openLibraryEditionId}`);
	if (ids.googleBooksId) keys.push(`gb:${ids.googleBooksId}`);
	if (ids.inventaireId) keys.push(`inv:${ids.inventaireId}`);
	if (ids.sbnId) keys.push(`sbn:${ids.sbnId}`);
	if (ids.locId) keys.push(`loc:${ids.locId}`);
	return keys;
}

function pick<T>(a: T | null, b: T | null): T | null {
	return a !== null && a !== '' ? a : b;
}

/** Unisce due rappresentazioni della STESSA edizione: `primary` vince, `secondary` riempie i vuoti. */
export function mergeCandidates(
	primary: EditionCandidate,
	secondary: EditionCandidate
): EditionCandidate {
	return {
		provider: primary.provider,
		providerIds: {
			openLibraryWorkId: pick(
				primary.providerIds.openLibraryWorkId,
				secondary.providerIds.openLibraryWorkId
			),
			openLibraryEditionId: pick(
				primary.providerIds.openLibraryEditionId,
				secondary.providerIds.openLibraryEditionId
			),
			googleBooksId: pick(primary.providerIds.googleBooksId, secondary.providerIds.googleBooksId),
			...(primary.providerIds.inventaireId || secondary.providerIds.inventaireId
				? { inventaireId: primary.providerIds.inventaireId ?? secondary.providerIds.inventaireId }
				: {}),
			...(primary.providerIds.sbnId || secondary.providerIds.sbnId
				? { sbnId: primary.providerIds.sbnId ?? secondary.providerIds.sbnId }
				: {}),
			...(primary.providerIds.locId || secondary.providerIds.locId
				? { locId: primary.providerIds.locId ?? secondary.providerIds.locId }
				: {})
		},
		workTitle: primary.workTitle,
		editionTitle: primary.editionTitle,
		authors:
			primary.authors.length === 1 && primary.authors[0] === 'Autore sconosciuto'
				? secondary.authors
				: primary.authors,
		isbn10: pick(primary.isbn10, secondary.isbn10),
		isbn13: pick(primary.isbn13, secondary.isbn13),
		language: pick(primary.language, secondary.language),
		publisher: pick(primary.publisher, secondary.publisher),
		publishedDate: pick(primary.publishedDate, secondary.publishedDate),
		pageCount: pick(primary.pageCount, secondary.pageCount),
		coverUrl: pick(primary.coverUrl, secondary.coverUrl),
		confidence: Math.max(primary.confidence, secondary.confidence),
		matchReasons: [...new Set([...primary.matchReasons, ...secondary.matchReasons])]
	};
}

/**
 * Rimuove i duplicati fra provider: due candidati si fondono solo se condividono almeno una
 * chiave d'identità forte (stesso ISBN-13/10 oppure stesso id provider). L'ordine d'ingresso
 * decide la priorità dei campi e la posizione del risultato.
 */
export function dedupeCandidates(candidates: readonly EditionCandidate[]): EditionCandidate[] {
	const groups: { candidate: EditionCandidate; keys: Set<string> }[] = [];

	for (const candidate of candidates) {
		const keys = identityKeys(candidate);
		const candidateIsbn =
			candidate.isbn13 ?? (candidate.isbn10 ? isbn10To13(candidate.isbn10) : null);
		const existing =
			keys.length > 0
				? groups.find((group) => {
						const otherIsbn =
							group.candidate.isbn13 ??
							(group.candidate.isbn10 ? isbn10To13(group.candidate.isbn10) : null);
						// Conflicting ISBNs are distinct editions even when a provider reuses an id.
						return (
							!(candidateIsbn && otherIsbn && candidateIsbn !== otherIsbn) &&
							keys.some((key) => group.keys.has(key))
						);
					})
				: undefined;

		if (existing) {
			existing.candidate = mergeCandidates(existing.candidate, candidate);
			for (const key of keys) existing.keys.add(key);
			for (const key of identityKeys(existing.candidate)) existing.keys.add(key);
		} else {
			groups.push({ candidate, keys: new Set(keys) });
		}
	}

	return groups.map((group) => group.candidate);
}
