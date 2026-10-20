import { z } from 'zod';
import {
	bookSummarySchema,
	currentlyReadingBookSchema,
	genreCountsSchema,
	genreRefSchema,
	genreSectionSchema,
	queueBookSchema,
	shelfPageSchema,
	shelfSchema,
	editionCandidateSchema,
	seriesBookSchema
} from './books';
import {
	bookFormatSchema,
	genreSortFieldSchema,
	genreSlugSchema,
	sortDirectionSchema
} from './enums';
import { readingHistoryItemSchema, readingMutationResultSchema, readingSchema } from './readings';
import { quoteSchema, reviewSchema, reviewSaveResultSchema } from './reviews';
import {
	bingoBoardSchema,
	bingoSummarySchema,
	dnfBookSchema,
	quotePreviewSchema,
	readingCalendarDaySchema,
	yearStatsSchema
} from './stats';
import {
	contractVersionSchema,
	isoTimestampSchema,
	localDateSchema,
	nonEmptyTextSchema,
	pageNumberSchema,
	positiveIntSchema,
	ratingSchema,
	uuidSchema
} from './primitives';
import { themeDefinitionSchema, themeSelectionSchema } from './themes';

// ---------------------------------------------------------------------------
// READ MODELS
// ---------------------------------------------------------------------------

export const libraryHomeResponseSchema = z.object({
	contractVersion: contractVersionSchema,
	currentlyReading: z.array(currentlyReadingBookSchema),
	queue: z.array(queueBookSchema),
	shelves: z.array(shelfSchema)
});

export const shelfPageResponseSchema = z.object({
	contractVersion: contractVersionSchema,
	data: shelfPageSchema
});

export const genreViewResponseSchema = z.object({
	contractVersion: contractVersionSchema,

	genre: genreRefSchema,
	counts: genreCountsSchema,

	sort: z.object({
		field: genreSortFieldSchema,
		direction: sortDirectionSchema
	}),

	sections: z.tuple([
		genreSectionSchema.extend({ key: z.literal('read') }),
		genreSectionSchema.extend({ key: z.literal('unread') })
	])
});

export const bookDetailResponseSchema = z.object({
	contractVersion: contractVersionSchema,

	book: bookSummarySchema,
	seriesBooks: z.array(seriesBookSchema),

	queuePosition: positiveIntSchema.nullable(),
	currentReading: readingSchema.nullable(),

	readings: z.array(readingHistoryItemSchema),

	review: reviewSchema.nullable(),
	quotes: z.array(quoteSchema)
});

export const explorePoolResponseSchema = z.object({
	contractVersion: contractVersionSchema,
	books: z.array(bookSummarySchema)
});

export const readingCalendarResponseSchema = z.object({
	contractVersion: contractVersionSchema,
	year: z.number().int().min(1900).max(2200),
	days: z.array(readingCalendarDaySchema)
});

export const yearStatsResponseSchema = z.object({
	contractVersion: contractVersionSchema,
	stats: yearStatsSchema
});

export const statsDashboardResponseSchema = z.object({
	contractVersion: contractVersionSchema,

	stats: yearStatsSchema,
	bingo: bingoSummarySchema.nullable(),

	quotePreviews: z.array(quotePreviewSchema),
	dnf: z.array(dnfBookSchema)
});

export const bingoBoardResponseSchema = z.object({
	contractVersion: contractVersionSchema,
	board: bingoBoardSchema
});

// ---------------------------------------------------------------------------
// MUTATION INPUTS
// ---------------------------------------------------------------------------

export const startReadingInputSchema = z.object({
	bookId: uuidSchema,
	startedAt: isoTimestampSchema.optional(),
	startPage: pageNumberSchema.default(0)
});

export const readingIdInputSchema = z.object({
	readingId: uuidSchema
});

export const recordProgressInputSchema = z.object({
	eventId: uuidSchema,
	readingId: uuidSchema,
	page: pageNumberSchema,
	occurredAt: isoTimestampSchema.optional(),
	/**
	 * Va passato dal client quando l'evento nasce offline. Se omesso il server
	 * può derivarlo dalla timezone profilo.
	 */
	localDate: localDateSchema.optional()
});

export const finishReadingInputSchema = recordProgressInputSchema;

export const markDnfInputSchema = z.object({
	eventId: uuidSchema,
	readingId: uuidSchema,
	page: pageNumberSchema,
	occurredAt: isoTimestampSchema.optional(),
	localDate: localDateSchema.optional()
});

export const addCompletedReadingInputSchema = z.object({
	bookId: uuidSchema,
	startedAt: isoTimestampSchema,
	finishedAt: isoTimestampSchema,
	finalPage: pageNumberSchema,
	startPage: pageNumberSchema.default(0)
});

export const queueAddInputSchema = z.object({
	bookId: uuidSchema,
	force: z.boolean().default(false)
});

export const queueMoveInputSchema = z.object({
	bookId: uuidSchema,
	newPosition: positiveIntSchema
});

export const changeBookGenreInputSchema = z.object({
	bookId: uuidSchema,
	genreSlug: genreSlugSchema
});

export const changeBookFormatInputSchema = z.object({
	bookId: uuidSchema,
	format: bookFormatSchema
});

export const saveReviewInputSchema = z.object({
	bookId: uuidSchema,
	rating: ratingSchema,

	adjectives: z
		.array(nonEmptyTextSchema.max(24))
		.max(3)
		.refine(
			(values) =>
				new Set(values.map((value) => value.normalize('NFC').toLocaleLowerCase('it'))).size ===
				values.length,
			'Gli aggettivi devono essere distinti.'
		),

	scores: z.array(
		z.object({
			dimensionKey: z.string().trim().min(1).max(120),
			score: ratingSchema
		})
	),

	tagIds: z.array(positiveIntSchema)
});

export const bingoAssignInputSchema = z.object({
	cellId: uuidSchema,
	bookId: uuidSchema.nullable()
});

export const setThemeInputSchema = z.object({
	selection: themeSelectionSchema
});

export const saveCustomThemeInputSchema = z.object({
	id: uuidSchema.optional(),
	theme: themeDefinitionSchema
});

// ---------------------------------------------------------------------------
// MUTATION OUTPUTS
// ---------------------------------------------------------------------------

export const basicMutationResponseSchema = z.object({
	contractVersion: contractVersionSchema,
	ok: z.literal(true)
});

export const queueMutationResponseSchema = z.object({
	contractVersion: contractVersionSchema,
	queue: z.array(queueBookSchema)
});

export const queueAddResponseSchema = z.object({
	contractVersion: contractVersionSchema,
	status: z.enum(['added', 'alreadyQueued', 'requiresConfirmation']),
	currentCount: z.number().int().nonnegative(),
	position: positiveIntSchema.nullable(),
	queue: z.array(queueBookSchema)
});

export const genreChangeResponseSchema = z.object({
	contractVersion: contractVersionSchema,
	book: bookSummarySchema,
	reviewScoresReset: z.boolean()
});

export const bookFormatChangeResponseSchema = z.object({
	contractVersion: contractVersionSchema,
	book: bookSummarySchema
});

export const bookSeriesChangeResponseSchema = z.object({
	contractVersion: contractVersionSchema,
	book: bookSummarySchema
});

export const themeMutationResponseSchema = z.object({
	contractVersion: contractVersionSchema,
	selection: themeSelectionSchema
});

// ---------------------------------------------------------------------------
// BOOK METADATA API CONTRACTS
// Questi endpoint sono SvelteKit server endpoints, non RPC Postgres.
// ---------------------------------------------------------------------------

export const bookSearchSortSchema = z.enum(['relevance', 'newest']);
export type BookSearchSort = z.infer<typeof bookSearchSortSchema>;

export const bookSearchRequestSchema = z.object({
	title: nonEmptyTextSchema,
	author: z.string().trim().min(1).optional(),
	language: z.string().trim().min(1).max(16).optional(),
	sort: bookSearchSortSchema.optional(),
	source: z.enum(['primary', 'sbn', 'loc']).optional()
});

export const isbnLookupRequestSchema = z.object({
	isbn: z
		.string()
		.trim()
		.transform((v) => v.replace(/[-\s]/g, ''))
		.pipe(z.union([z.string().regex(/^[0-9]{13}$/), z.string().regex(/^[0-9]{9}[0-9X]$/)]))
});

export const bookSearchResponseSchema = z.object({
	contractVersion: contractVersionSchema,
	candidates: z.array(editionCandidateSchema)
});

// ---------------------------------------------------------------------------
// EXPORTED TYPES
// ---------------------------------------------------------------------------

export type LibraryHomeResponse = z.infer<typeof libraryHomeResponseSchema>;
export type ShelfPageResponse = z.infer<typeof shelfPageResponseSchema>;
export type GenreViewResponse = z.infer<typeof genreViewResponseSchema>;
export type BookDetailResponse = z.infer<typeof bookDetailResponseSchema>;
export type ExplorePoolResponse = z.infer<typeof explorePoolResponseSchema>;
export type ReadingCalendarResponse = z.infer<typeof readingCalendarResponseSchema>;
export type YearStatsResponse = z.infer<typeof yearStatsResponseSchema>;
export type StatsDashboardResponse = z.infer<typeof statsDashboardResponseSchema>;
export type BingoBoardResponse = z.infer<typeof bingoBoardResponseSchema>;

export type StartReadingInput = z.infer<typeof startReadingInputSchema>;
export type ReadingIdInput = z.infer<typeof readingIdInputSchema>;
export type RecordProgressInput = z.infer<typeof recordProgressInputSchema>;
export type FinishReadingInput = z.infer<typeof finishReadingInputSchema>;
export type MarkDnfInput = z.infer<typeof markDnfInputSchema>;
export type AddCompletedReadingInput = z.infer<typeof addCompletedReadingInputSchema>;

export type QueueAddInput = z.infer<typeof queueAddInputSchema>;
export type QueueAddResponse = z.infer<typeof queueAddResponseSchema>;
export type QueueMoveInput = z.infer<typeof queueMoveInputSchema>;

export type ChangeBookGenreInput = z.infer<typeof changeBookGenreInputSchema>;
export type ChangeBookFormatInput = z.infer<typeof changeBookFormatInputSchema>;
export type SaveReviewInput = z.infer<typeof saveReviewInputSchema>;

export type BingoAssignInput = z.infer<typeof bingoAssignInputSchema>;
export type SetThemeInput = z.infer<typeof setThemeInputSchema>;
export type SaveCustomThemeInput = z.infer<typeof saveCustomThemeInputSchema>;

export type BookSearchRequest = z.infer<typeof bookSearchRequestSchema>;
export type IsbnLookupRequest = z.infer<typeof isbnLookupRequestSchema>;
export type BookSearchResponse = z.infer<typeof bookSearchResponseSchema>;

export { readingMutationResultSchema, reviewSaveResultSchema };
