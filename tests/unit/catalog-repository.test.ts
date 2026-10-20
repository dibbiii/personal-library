import { describe, expect, it, vi } from 'vitest';
import type { EditionCandidate } from '../../src/lib/contracts/books';
import { addBookRequestSchema } from '../../src/lib/catalog/schemas';
import { ServerCatalogRepository } from '../../src/lib/data/catalog-repository';

const knownIsbn = '9780306406157';
const mismatchedIsbn = '9780131103627';
const userId = '11111111-1111-4111-8111-111111111111';

const trustedEdition: EditionCandidate = {
	provider: 'google-books',
	providerIds: {
		openLibraryWorkId: null,
		openLibraryEditionId: null,
		googleBooksId: 'trusted-volume-id'
	},
	workTitle: 'Trusted title',
	editionTitle: 'Trusted title',
	authors: ['Trusted author'],
	isbn10: null,
	isbn13: knownIsbn,
	language: 'en',
	publisher: 'Trusted publisher',
	publishedDate: '2020',
	pageCount: 250,
	coverUrl: null,
	confidence: 1,
	matchReasons: []
};

function addRequest({
	isbn,
	googleBooksId = trustedEdition.providerIds.googleBooksId,
	source = 'isbn'
}: {
	isbn: string | null;
	googleBooksId?: string | null;
	source?: 'isbn' | 'search';
}) {
	return addBookRequestSchema.parse({
		source,
		title: 'Client supplied title',
		author: 'Client supplied author',
		pageCount: 10,
		language: 'it',
		isbn,
		genre: 'dystopia-scifi',
		format: 'physical',
		series: null,
		coverUrl: null,
		edition: {
			provider: 'google-books',
			providerIds: {
				openLibraryWorkId: null,
				openLibraryEditionId: null,
				googleBooksId
			},
			workTitle: 'Trusted title',
			authors: ['Trusted author'],
			publisher: 'Client supplied publisher',
			publishedDate: '2025'
		}
	});
}

function serviceReturning(candidate: EditionCandidate) {
	return {
		lookupIsbn: vi.fn(async () => ({
			candidates: [candidate],
			degraded: false,
			providers: {},
			exactMatch: false
		})),
		search: vi.fn(async () => ({
			candidates: [candidate],
			degraded: false,
			providers: {}
		}))
	};
}

describe('ServerCatalogRepository shared edition writes', () => {
	it('rejects an ISBN that does not belong to the provider edition', async () => {
		const service = serviceReturning(trustedEdition);
		const repository = new ServerCatalogRepository(service as never);

		await expect(
			repository.addBook(userId, addRequest({ isbn: mismatchedIsbn }))
		).rejects.toMatchObject({ code: 'VALIDATION' });
		expect(service.lookupIsbn).toHaveBeenCalledExactlyOnceWith(mismatchedIsbn);
	});

	it('rejects a forged provider id when the server lookup cannot verify it', async () => {
		const service = serviceReturning(trustedEdition);
		const repository = new ServerCatalogRepository(service as never);

		await expect(
			repository.addBook(
				userId,
				addRequest({
					isbn: null,
					googleBooksId: 'forged-volume-id',
					source: 'search'
				})
			)
		).rejects.toMatchObject({ code: 'VALIDATION' });
		expect(service.search).toHaveBeenCalledTimes(1);
		expect(service.lookupIsbn).not.toHaveBeenCalled();
	});
});
