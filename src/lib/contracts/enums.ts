import { z } from 'zod';

export const genreSlugSchema = z.enum([
	'classics',
	'mythology-epic-retelling',
	'dystopia-scifi',
	'thriller-mystery',
	'fantasy-magical-gothic',
	'romance-ya-na',
	'contemporary-historical',
	'essays'
]);

export const bookFormatSchema = z.enum(['physical', 'digital', 'both']);

export const lifecycleStateSchema = z.enum(['unread', 'reading', 'paused', 'finished', 'dnf']);

export const readingStatusSchema = z.enum(['active', 'paused', 'completed', 'dnf']);

export const progressEventTypeSchema = z.enum(['progress', 'correction', 'finish']);

export const bookSourceSchema = z.enum(['manual', 'isbn', 'search', 'import']);

export const shelfModeSchema = z.enum(['hybrid', 'spines', 'covers']);

export const motionPreferenceSchema = z.enum(['system', 'reduce', 'full']);

export const genreSortFieldSchema = z.enum(['title', 'author', 'pages', 'rating', 'date']);

export const sortDirectionSchema = z.enum(['asc', 'desc']);

export const providerSchema = z.enum([
	'open-library',
	'google-books',
	'inventaire',
	'sbn',
	'loc',
	'isbndb',
	'manual'
]);

export type GenreSlug = z.infer<typeof genreSlugSchema>;
export type BookFormat = z.infer<typeof bookFormatSchema>;
export type LifecycleState = z.infer<typeof lifecycleStateSchema>;
export type ReadingStatus = z.infer<typeof readingStatusSchema>;
export type ProgressEventType = z.infer<typeof progressEventTypeSchema>;
export type BookSource = z.infer<typeof bookSourceSchema>;
export type ShelfMode = z.infer<typeof shelfModeSchema>;
export type MotionPreference = z.infer<typeof motionPreferenceSchema>;
export type GenreSortField = z.infer<typeof genreSortFieldSchema>;
export type SortDirection = z.infer<typeof sortDirectionSchema>;
export type BookProvider = z.infer<typeof providerSchema>;
