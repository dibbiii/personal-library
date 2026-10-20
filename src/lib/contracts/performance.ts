import { z } from 'zod';
import { bookSummarySchema } from './books';
import { genreSlugSchema } from './enums';
import {
	contractVersionSchema,
	isoTimestampSchema,
	nonNegativeIntSchema,
	uuidSchema
} from './primitives';
import { dnfBookSchema } from './stats';
import { genreViewResponseSchema } from './rpc';
import { quoteListResponseSchema } from './stats-lists';

export const profileTabSchema = z.enum([
	'overview',
	'stats',
	'activity',
	'wheel',
	'calendar',
	'dnf'
]);
export type ProfileTab = z.infer<typeof profileTabSchema>;
export const libraryCountsSchema = z.object({
	total: nonNegativeIntSchema,
	read: nonNegativeIntSchema,
	reading: nonNegativeIntSchema,
	unread: nonNegativeIntSchema,
	physical: nonNegativeIntSchema,
	physicalUnread: nonNegativeIntSchema,
	digital: nonNegativeIntSchema,
	both: nonNegativeIntSchema,
	englishRead: nonNegativeIntSchema,
	reread: nonNegativeIntSchema
});
export const activityItemSchema = z.object({
	kind: z.enum(['finished', 'started', 'queued', 'dnf']),
	book: bookSummarySchema,
	at: isoTimestampSchema
});
export const profileSummarySchema = z.object({
	contractVersion: contractVersionSchema,
	counts: libraryCountsSchema,
	queueCount: nonNegativeIntSchema,
	quoteCount: nonNegativeIntSchema,
	dnfCount: nonNegativeIntSchema,
	dnfCountForYear: nonNegativeIntSchema,
	favorites: z.array(bookSummarySchema).max(5),
	queue: z.array(bookSummarySchema).max(3),
	reading: z.array(bookSummarySchema).max(3),
	dnf: z.array(dnfBookSchema).max(3),
	activity: z.array(activityItemSchema).max(30)
});
export type ProfileSummary = z.infer<typeof profileSummarySchema>;
export const queueSummarySchema = z.object({
	contractVersion: contractVersionSchema,
	ids: z.array(uuidSchema)
});
export const discoveryContextSchema = z.object({
	contractVersion: contractVersionSchema,
	owned: z.array(z.object({ id: uuidSchema, title: z.string().min(1), author: z.string().min(1) })),
	topGenres: z.array(genreSlugSchema).max(2)
});
export const profileDnfSchema = z.object({
	contractVersion: contractVersionSchema,
	books: z.array(dnfBookSchema)
});
export const quotesPageSchema = quoteListResponseSchema.extend({
	page: z.number().int().positive(),
	pageSize: z.literal(30),
	quotes: quoteListResponseSchema.shape.quotes.max(30),
	books: z.array(z.object({ id: uuidSchema, title: z.string().min(1) }))
});
export const unreadSortSchema = z.enum(['title', 'author', 'pages', 'date']);
export const genrePagesSchema = genreViewResponseSchema.extend({
	unreadSort: unreadSortSchema,
	pages: z.object({
		read: z.number().int().positive(),
		unread: z.number().int().positive(),
		pageSize: z.literal(40)
	})
});
