import { describe, expect, it } from 'vitest';
import {
	buildUpdateBookRequest,
	draftFromBook,
	draftWithEdition
} from '../../src/lib/catalog/draft';
import { updateBookRequestSchema } from '../../src/lib/catalog/schemas';
import type { BookInfo } from '../../src/lib/catalog/book-info';
import type { BookSummary } from '../../src/lib/contracts/books';

const BOOK_ID = '11111111-1111-4111-8111-111111111111';

const book: BookSummary = {
	id: BOOK_ID,
	editionId: null,
	title: 'Dune',
	author: 'Frank Herbert',
	pageCount: 412,
	language: 'en',
	format: 'physical',
	source: 'manual',
	genre: { id: 1, slug: 'dystopia-scifi', name: 'Distopia e fantascienza' },
	series: { name: 'Dune', number: 1, total: 6 },
	lifecycleState: 'unread',
	completedReadingsCount: 0,
	reviewRating: null,
	lastFinishedAt: null,
	lastActivityAt: null,
	cover: { coverUrl: null, coverStoragePath: null }
};

const choices = {
	genre: 'dystopia-scifi',
	format: 'digital',
	series: { name: 'Dune', number: 1, total: 6 }
} as const;

const edition: BookInfo['editions'][number] = {
	title: 'Dune (edizione tascabile)',
	publisher: 'Ace',
	year: 2024,
	language: 'en',
	pages: 400,
	isbn13: '9780441172719',
	coverUrl: 'https://covers.openlibrary.org/b/id/123-L.jpg',
	url: 'https://openlibrary.org/books/OL123M'
};

describe('draftFromBook', () => {
	it('precompila i dati esistenti senza inventare un’edizione catalogata', () => {
		expect(draftFromBook(book)).toMatchObject({
			source: 'manual',
			title: 'Dune',
			author: 'Frank Herbert',
			pageCount: 412,
			language: 'en',
			isbn: null,
			edition: null
		});
	});

	it('preserves current-edition identity and leaves the draft untouched when it is reselected', () => {
		const coverFile = { name: 'custom-cover.jpg' } as File;
		const currentBook: BookSummary = {
			...book,
			editionId: '42',
			isbn: '9780441172719',
			openLibraryEditionId: 'OL123M'
		};
		const draft = {
			...draftFromBook(currentBook),
			title: 'My custom title',
			pageCount: 417,
			coverFile
		};

		expect(draft).toMatchObject({
			isbn: '9780441172719',
			openLibraryEditionId: 'OL123M'
		});
		expect(draftWithEdition(draft, edition, 'https://openlibrary.org/works/OL1W', 'Dune')).toBe(
			draft
		);
		expect(draft.title).toBe('My custom title');
		expect(draft.pageCount).toBe(417);
		expect(draft.coverFile).toBe(coverFile);

		const identityOnlyBook: BookSummary = {
			...currentBook,
			isbn: null
		};
		const identityOnlyDraft = {
			...draftFromBook(identityOnlyBook),
			coverFile
		};
		expect(
			draftWithEdition(
				identityOnlyDraft,
				{ ...edition, isbn13: null },
				'https://openlibrary.org/works/OL1W',
				'Dune'
			)
		).toBe(identityOnlyDraft);
		expect(identityOnlyDraft.coverFile).toBe(coverFile);
	});
});

describe('updateBookRequestSchema', () => {
	it('accetta una modifica di personalizzazione senza sostituire l’edizione esistente', () => {
		expect(updateBookRequestSchema.parse(choices)).toEqual(choices);
	});

	it('richiede i dati del libro quando viene selezionata una nuova edizione', () => {
		const partial = { ...choices, edition: { provider: 'open-library' } };
		expect(updateBookRequestSchema.safeParse(partial).success).toBe(false);

		const draft = draftWithEdition(
			draftFromBook(book),
			edition,
			'https://openlibrary.org/works/OL1W',
			'Dune'
		);
		expect(updateBookRequestSchema.safeParse(buildUpdateBookRequest(draft, choices)).success).toBe(
			true
		);
	});

	it('non accetta campi di sessione o identità nel payload', () => {
		expect(updateBookRequestSchema.safeParse({ ...choices, userId: BOOK_ID }).success).toBe(false);
	});
});

describe('buildUpdateBookRequest', () => {
	it('invia solo i campi di personalizzazione se l’edizione non è cambiata', () => {
		expect(buildUpdateBookRequest(draftFromBook(book), choices)).toEqual(choices);
	});

	it('include i metadati della nuova edizione senza cambiare i dati di personalizzazione', () => {
		const draft = draftWithEdition(
			draftFromBook(book),
			edition,
			'https://openlibrary.org/works/OL1W',
			'Dune'
		);

		expect(buildUpdateBookRequest(draft, choices)).toMatchObject({
			...choices,
			title: 'Dune (edizione tascabile)',
			author: 'Frank Herbert',
			pageCount: 400,
			language: 'en',
			isbn: '9780441172719',
			coverUrl: 'https://covers.openlibrary.org/b/id/123-L.jpg',
			edition: {
				provider: 'open-library',
				providerIds: {
					openLibraryWorkId: 'OL1W',
					openLibraryEditionId: 'OL123M',
					googleBooksId: null
				},
				workTitle: 'Dune'
			}
		});
	});
});
