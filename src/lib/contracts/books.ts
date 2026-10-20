import { z } from 'zod';
import {
	bookFormatSchema,
	bookSourceSchema,
	genreSlugSchema,
	lifecycleStateSchema,
	providerSchema
} from './enums';
import {
	catalogIdSchema,
	isoTimestampSchema,
	nonEmptyTextSchema,
	percentSchema,
	positiveIntSchema,
	ratingSchema,
	uuidSchema
} from './primitives';

export const genreRefSchema = z.object({
	id: z.number().int().positive(),
	slug: genreSlugSchema,
	name: nonEmptyTextSchema
});

export const coverRefSchema = z.object({
	/**
	 * URL esterno (Open Library / Google Books / altra sorgente).
	 * Se esiste coverStoragePath, la UI/repository deve preferire la cover custom.
	 */
	coverUrl: z.string().url().nullable(),
	coverStoragePath: z.string().trim().min(1).nullable()
});

export const seriesRefSchema = z.object({
	name: nonEmptyTextSchema,
	number: z.number().positive().nullable(),
	total: positiveIntSchema.nullable()
});

export const seriesBookSchema = z.object({
	id: uuidSchema,
	title: nonEmptyTextSchema,
	number: z.number().positive().nullable()
});

export const bookSummarySchema = z.object({
	id: uuidSchema,
	editionId: catalogIdSchema.nullable(),

	title: nonEmptyTextSchema,
	author: nonEmptyTextSchema,

	pageCount: positiveIntSchema.nullable(),
	language: z.string().trim().min(1).max(16).nullable(),

	format: bookFormatSchema,
	source: bookSourceSchema,

	genre: genreRefSchema,
	series: seriesRefSchema.nullable(),

	lifecycleState: lifecycleStateSchema,
	completedReadingsCount: z.number().int().nonnegative(),
	reviewRating: ratingSchema.nullable(),

	lastFinishedAt: isoTimestampSchema.nullable(),
	lastActivityAt: isoTimestampSchema.nullable(),

	cover: coverRefSchema
});

export const currentlyReadingBookSchema = z.object({
	book: bookSummarySchema,
	reading: z.object({
		id: uuidSchema,
		currentPage: z.number().int().nonnegative(),
		totalPages: positiveIntSchema.nullable(),
		progressPercent: percentSchema.nullable(),
		startedAt: isoTimestampSchema,
		paused: z.boolean()
	})
});

export const queueBookSchema = z.object({
	position: positiveIntSchema,
	addedAt: isoTimestampSchema,
	book: bookSummarySchema
});

export const shelfSchema = z.object({
	genre: genreRefSchema,
	totalCount: z.number().int().nonnegative(),
	hasMore: z.boolean(),
	books: z.array(bookSummarySchema)
});

export const shelfCursorSchema = z.object({
	createdAt: isoTimestampSchema,
	id: uuidSchema
});

export const shelfPageSchema = z.object({
	genre: genreRefSchema,
	books: z.array(bookSummarySchema),
	hasMore: z.boolean(),
	nextCursor: shelfCursorSchema.nullable()
});

export const genreCountsSchema = z.object({
	total: z.number().int().nonnegative(),
	read: z.number().int().nonnegative(),
	unread: z.number().int().nonnegative()
});

export const genreSectionSchema = z.object({
	key: z.enum(['read', 'unread']),
	count: z.number().int().nonnegative(),
	books: z.array(bookSummarySchema)
});

export const providerIdsSchema = z.object({
	openLibraryWorkId: z.string().nullable(),
	openLibraryEditionId: z.string().nullable(),
	googleBooksId: z.string().nullable(),
	inventaireId: z
		.string()
		.regex(/^(inv:[a-f0-9]{32}|wd:Q[0-9]+)$/)
		.nullable()
		.optional(),
	sbnId: z
		.string()
		.regex(/^[A-Z0-9]{10}$/)
		.nullable()
		.optional(),
	/** Numero di controllo del record LC (MARCXML 001), non persistito sul database. */
	locId: z
		.string()
		.regex(/^[0-9]{5,12}$/)
		.nullable()
		.optional()
});

export const editionCandidateSchema = z.object({
	provider: providerSchema,
	providerIds: providerIdsSchema,

	workTitle: nonEmptyTextSchema,
	editionTitle: nonEmptyTextSchema,
	authors: z.array(nonEmptyTextSchema).min(1),

	isbn10: z
		.string()
		.regex(/^[0-9]{9}[0-9X]$/)
		.nullable(),
	isbn13: z
		.string()
		.regex(/^[0-9]{13}$/)
		.nullable(),

	language: z.string().trim().min(1).max(16).nullable(),
	publisher: z.string().trim().min(1).nullable(),
	publishedDate: z.string().nullable(),
	pageCount: positiveIntSchema.nullable(),

	coverUrl: z.string().url().nullable(),

	/**
	 * 0..1. Serve solo a ordinare i candidati, non per fare merge automatici.
	 */
	confidence: z.number().min(0).max(1),
	matchReasons: z.array(z.string())
});

export type GenreRef = z.infer<typeof genreRefSchema>;
export type CoverRef = z.infer<typeof coverRefSchema>;
export type SeriesRef = z.infer<typeof seriesRefSchema>;
export type SeriesBook = z.infer<typeof seriesBookSchema>;
export type BookSummary = z.infer<typeof bookSummarySchema>;
export type CurrentlyReadingBook = z.infer<typeof currentlyReadingBookSchema>;
export type QueueBook = z.infer<typeof queueBookSchema>;
export type Shelf = z.infer<typeof shelfSchema>;
export type ShelfCursor = z.infer<typeof shelfCursorSchema>;
export type ShelfPage = z.infer<typeof shelfPageSchema>;
export type GenreCounts = z.infer<typeof genreCountsSchema>;
export type GenreSection = z.infer<typeof genreSectionSchema>;
export type EditionCandidate = z.infer<typeof editionCandidateSchema>;
