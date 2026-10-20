import type { BookSummary, EditionCandidate } from '$lib/contracts/books';
import type { BookInfo } from './book-info';
import type { BookFormat, GenreSlug } from '$lib/contracts/enums';
import { languageLabel } from './language';
import type { AddBookRequest, UpdateBookRequest } from './schemas';

/** Libro da confermare nello sheet: proviene da un candidato dei provider o dal form manuale. */
export interface BookDraft {
	source: 'manual' | 'isbn' | 'search';
	title: string;
	author: string;
	pageCount: number | null;
	language: string | null;
	isbn: string | null;
	coverUrl: string | null;
	publisher: string | null;
	publishedDate: string | null;
	edition: AddBookRequest['edition'];
	/** Browser-only file; uploaded after the book has an id. Never part of JSON. */
	coverFile?: File | null;
}

export interface DraftChoices {
	genre: GenreSlug;
	format: BookFormat;
	series: { name: string; number: number | null; total: number | null } | null;
}

export function draftFromBook(book: BookSummary): BookDraft {
	return {
		source: book.source === 'manual' ? 'manual' : book.source === 'isbn' ? 'isbn' : 'search',
		title: book.title,
		author: book.author,
		pageCount: book.pageCount,
		language: book.language,
		isbn: null,
		coverUrl: book.cover.coverUrl,
		publisher: null,
		publishedDate: null,
		edition: null
	};
}

export function draftFromCandidate(
	candidate: EditionCandidate,
	source: 'isbn' | 'search'
): BookDraft {
	return {
		source,
		title: candidate.editionTitle,
		author: candidate.authors.join(', '),
		pageCount: candidate.pageCount,
		language: candidate.language,
		isbn: candidate.isbn13 ?? candidate.isbn10,
		coverUrl: candidate.coverUrl,
		publisher: candidate.publisher,
		publishedDate: candidate.publishedDate,
		edition: {
			provider: candidate.provider,
			providerIds: candidate.providerIds,
			workTitle: candidate.workTitle,
			authors: candidate.authors,
			publisher: candidate.publisher,
			publishedDate: candidate.publishedDate
		}
	};
}

export function buildAddRequest(
	draft: BookDraft,
	choices: DraftChoices,
	force = false
): AddBookRequest {
	return {
		source: draft.source,
		title: draft.title,
		author: draft.author,
		pageCount: draft.pageCount,
		language: draft.language,
		isbn: draft.isbn,
		genre: choices.genre,
		format: choices.format,
		series: choices.series,
		coverUrl: draft.coverUrl,
		edition: draft.edition,
		force
	};
}

export function buildUpdateBookRequest(draft: BookDraft, choices: DraftChoices): UpdateBookRequest {
	if (!draft.edition) return choices;
	return {
		...choices,
		title: draft.title,
		author: draft.author,
		pageCount: draft.pageCount,
		language: draft.language,
		isbn: draft.isbn,
		coverUrl: draft.coverUrl,
		edition: draft.edition
	};
}

/** "Mondadori · 2019 · 544 pag. · Italiano" per le righe dei risultati. */
export function candidateMeta(candidate: {
	publisher: string | null;
	publishedDate: string | null;
	pageCount: number | null;
	language: string | null;
}): string {
	const year = /\d{4}/.exec(candidate.publishedDate ?? '')?.[0];
	return [
		candidate.publisher,
		year,
		candidate.pageCount ? `${candidate.pageCount} pag.` : null,
		languageLabel(candidate.language)
	]
		.filter(Boolean)
		.join(' · ');
}

export function seriesLabel(number: number | null, total: number | null): string | null {
	if (number === null) return null;
	return total === null ? `Vol. ${number}` : `Vol. ${number} di ${total}`;
}

/** Chiave stabile di un candidato (per liste e selezione). */
export function candidateKey(candidate: EditionCandidate): string {
	const ids = candidate.providerIds;
	return (
		candidate.isbn13 ??
		ids.googleBooksId ??
		ids.openLibraryEditionId ??
		ids.inventaireId ??
		ids.sbnId ??
		ids.locId ??
		ids.openLibraryWorkId ??
		candidate.editionTitle
	);
}

type InfoEdition = BookInfo['editions'][number];

function lastSegment(url: string): string | null {
	return url.split('/').filter(Boolean).pop() ?? null;
}

/**
 * Passa a un'altra edizione dello stesso libro (dalle edizioni di Open Library):
 * editore, anno, pagine, ISBN e copertina sono quelli dell'edizione scelta.
 */
export function draftWithEdition(
	draft: BookDraft,
	edition: InfoEdition,
	workUrl: string,
	workTitle?: string
): BookDraft {
	const publishedDate = edition.year ? String(edition.year) : null;
	return {
		...draft,
		coverFile: null,
		title: edition.title === 'Senza titolo' ? draft.title : edition.title,
		pageCount: edition.pages,
		language: edition.language,
		isbn: edition.isbn13,
		// Le miniature delle edizioni sono medie: per la libreria si usa la grande.
		coverUrl: edition.coverUrl?.replace(/-M\.jpg$/, '-L.jpg') ?? null,
		publisher: edition.publisher,
		publishedDate,
		edition: {
			provider: 'open-library',
			providerIds: {
				openLibraryWorkId: lastSegment(workUrl),
				openLibraryEditionId: lastSegment(edition.url),
				googleBooksId: null
			},
			workTitle: workTitle ?? draft.edition?.workTitle ?? draft.title,
			authors: draft.edition?.authors ?? [draft.author],
			publisher: edition.publisher,
			publishedDate
		}
	};
}
