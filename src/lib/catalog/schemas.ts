import { z } from 'zod';
import {
	bookFormatSchema,
	bookSourceSchema,
	editionCandidateSchema,
	genreSlugSchema,
	providerIdsSchema,
	providerSchema
} from '$lib/contracts';
import { bookSearchRequestSchema, bookSearchResponseSchema } from '$lib/contracts/rpc';
import { isAllowedCoverUrl } from './covers';
import { parseIsbn } from './isbn';

/** Lunghezze massime dei campi testuali (il DB non ne ha, ma UI e payload sì). */
export const LIMITS = { title: 300, author: 300, series: 160, publisher: 200 } as const;

// --- Ricerca e lookup ISBN (risposte dell'endpoint = contratto + metadati) ----------------------

export const catalogSearchQuerySchema = bookSearchRequestSchema.extend({
	title: z.string().trim().min(2, 'Scrivi almeno 2 caratteri').max(200),
	author: z.string().trim().min(1).max(120).optional(),
	language: z.string().trim().min(2).max(16).optional()
});

export const providerStatusSchema = z.enum(['ok', 'error', 'rate_limited']);

const providerStatusMapSchema = z.object({
	'open-library': providerStatusSchema.optional(),
	'google-books': providerStatusSchema.optional(),
	inventaire: providerStatusSchema.optional(),
	sbn: providerStatusSchema.optional(),
	loc: providerStatusSchema.optional()
});

export const catalogSearchResponseSchema = bookSearchResponseSchema.extend({
	/** true se un provider non ha risposto: i risultati possono essere incompleti */
	degraded: z.boolean(),
	possibleMatches: z.boolean().optional(),
	providers: providerStatusMapSchema
});

export const isbnQuerySchema = z.object({
	isbn: z
		.string()
		.trim()
		.min(10)
		.max(24)
		.refine((value) => parseIsbn(value) !== null, 'ISBN non valido')
});

export const isbnLookupResponseSchema = catalogSearchResponseSchema.extend({
	exactMatch: z.boolean()
});

// --- Aggiunta alla libreria ---------------------------------------------------------------------

const text = (max: number) => z.string().trim().min(1).max(max);

/** Verifica la precisione del campo `numeric(6,2)` senza introdurre errori di arrotondamento binario. */
export function hasAtMostTwoDecimals(value: number): boolean {
	const [coefficient, exponent = '0'] = String(value).toLowerCase().split('e');
	const decimalPlaces = (coefficient?.split('.')[1]?.length ?? 0) - Number(exponent);
	return decimalPlaces <= 2;
}

export const seriesInputSchema = z
	.object({
		name: text(LIMITS.series),
		/** numeric(6,2): anche 1.5 per i volumi intermedi, senza arrotondamenti. */
		number: z
			.number()
			.positive()
			.max(9999)
			.refine(hasAtMostTwoDecimals, 'Il numero del volume può avere al massimo due decimali.')
			.nullable(),
		total: z.number().int().positive().max(999).nullable()
	})
	.refine(
		(series) => series.number === null || series.total === null || series.number <= series.total,
		{
			message: 'Il numero del volume non può superare il totale',
			path: ['number']
		}
	);

export const editionInputSchema = z.object({
	provider: providerSchema,
	providerIds: providerIdsSchema,
	workTitle: text(LIMITS.title),
	authors: z.array(text(LIMITS.author)).min(1).max(10),
	publisher: text(LIMITS.publisher).nullable(),
	publishedDate: z.string().trim().max(40).nullable()
});

export const addBookRequestSchema = z
	.object({
		source: bookSourceSchema.exclude(['import']),
		title: text(LIMITS.title),
		author: text(LIMITS.author),
		pageCount: z.number().int().positive().max(20000).nullable(),
		language: z.string().trim().min(2).max(16).nullable(),
		/** ISBN-10/13 in qualunque forma; il server lo riduce alla forma canonica */
		isbn: z.string().trim().max(24).nullable(),
		genre: genreSlugSchema,
		format: bookFormatSchema,
		series: seriesInputSchema.nullable(),
		coverUrl: z
			.string()
			.max(600)
			.refine((value) => isAllowedCoverUrl(value), 'Host della cover non consentito')
			.nullable(),
		/** Dati del candidato scelto; null per l'inserimento manuale */
		edition: editionInputSchema.nullable(),
		/** Aggiunge anche se esiste già un libro con lo stesso titolo e autore (non per lo stesso ISBN) */
		force: z.boolean().default(false)
	})
	.superRefine((value, ctx) => {
		if (value.isbn !== null && value.isbn !== '' && parseIsbn(value.isbn) === null) {
			ctx.addIssue({ code: 'custom', path: ['isbn'], message: 'ISBN non valido' });
		}
		if (value.source === 'manual' && value.edition !== null) {
			ctx.addIssue({
				code: 'custom',
				path: ['edition'],
				message: 'Un libro manuale non ha edizione'
			});
		}
		if (value.source !== 'manual' && value.edition === null) {
			ctx.addIssue({ code: 'custom', path: ['edition'], message: 'Edizione mancante' });
		}
	});

export const updateBookRequestSchema = z
	.object({
		genre: genreSlugSchema,
		format: bookFormatSchema,
		series: seriesInputSchema.nullable(),
		/** Presente solo quando l'utente sceglie una nuova edizione. */
		edition: editionInputSchema.optional(),
		title: text(LIMITS.title).optional(),
		author: text(LIMITS.author).optional(),
		pageCount: z.number().int().positive().max(20000).nullable().optional(),
		language: z.string().trim().min(2).max(16).nullable().optional(),
		isbn: z.string().trim().max(24).nullable().optional(),
		coverUrl: z
			.string()
			.max(600)
			.refine((value) => isAllowedCoverUrl(value), 'Host della cover non consentito')
			.nullable()
			.optional()
	})
	.strict()
	.superRefine((value, ctx) => {
		const metadata = ['title', 'author', 'pageCount', 'language', 'isbn', 'coverUrl'] as const;
		const hasMetadata = metadata.some((field) => value[field] !== undefined);

		if (value.edition === undefined && hasMetadata) {
			ctx.addIssue({
				code: 'custom',
				path: ['edition'],
				message: 'I dati dell’edizione richiedono una nuova edizione'
			});
		}
		if (value.edition !== undefined) {
			for (const field of metadata) {
				if (value[field] === undefined) {
					ctx.addIssue({
						code: 'custom',
						path: [field],
						message: 'Dato richiesto per la nuova edizione'
					});
				}
			}
		}
		if (
			value.isbn !== null &&
			value.isbn !== undefined &&
			value.isbn !== '' &&
			parseIsbn(value.isbn) === null
		) {
			ctx.addIssue({ code: 'custom', path: ['isbn'], message: 'ISBN non valido' });
		}
	});

export const existingBookSchema = z.object({
	id: z.string().uuid(),
	title: z.string(),
	author: z.string()
});

export const addBookResponseSchema = z.discriminatedUnion('status', [
	z.object({ status: z.literal('added'), bookId: z.string().uuid() }),
	z.object({
		status: z.literal('duplicate'),
		/** true = stesso ISBN/edizione (non si può forzare); false = stesso titolo e autore */
		exact: z.boolean(),
		existing: existingBookSchema
	})
]);

export const updateBookResponseSchema = z.discriminatedUnion('status', [
	z.object({
		status: z.literal('updated'),
		bookId: z.string().uuid(),
		reviewScoresReset: z.boolean()
	}),
	z.object({
		status: z.literal('duplicate'),
		exact: z.literal(true),
		existing: existingBookSchema
	})
]);

// --- Cover --------------------------------------------------------------------------------------

export const coverAlternativeSchema = z.object({
	url: z.string().url(),
	provider: providerSchema,
	label: z.string()
});

export const coverAlternativesResponseSchema = z.object({
	alternatives: z.array(coverAlternativeSchema),
	degraded: z.boolean()
});

export const coverSelectRequestSchema = z.discriminatedUnion('action', [
	z.object({
		action: z.literal('provider'),
		bookId: z.string().uuid(),
		coverUrl: z
			.string()
			.max(600)
			.refine((value) => isAllowedCoverUrl(value), 'Host della cover non consentito')
	}),
	z.object({ action: z.literal('remove-custom'), bookId: z.string().uuid() })
]);

export const coverChangedResponseSchema = z.object({
	coverUrl: z.string().nullable(),
	coverStoragePath: z.string().nullable()
});

export const apiErrorSchema = z.object({
	code: z.enum([
		'AUTH_REQUIRED',
		'NOT_FOUND',
		'CONFLICT',
		'VALIDATION',
		'RATE_LIMITED',
		'NETWORK',
		'SERVER',
		'CONTRACT'
	]),
	message: z.string(),
	field: z.string().optional()
});

export type CatalogSearchResponse = z.infer<typeof catalogSearchResponseSchema>;
export type IsbnLookupResponse = z.infer<typeof isbnLookupResponseSchema>;
export type AddBookRequest = z.input<typeof addBookRequestSchema>;
export type AddBookInput = z.output<typeof addBookRequestSchema>;
export type AddBookResponse = z.infer<typeof addBookResponseSchema>;
export type UpdateBookRequest = z.input<typeof updateBookRequestSchema>;
export type UpdateBookInput = z.output<typeof updateBookRequestSchema>;
export type UpdateBookResponse = z.infer<typeof updateBookResponseSchema>;
export type CoverAlternative = z.infer<typeof coverAlternativeSchema>;
export type CoverSelectRequest = z.infer<typeof coverSelectRequestSchema>;
export type ApiError = z.infer<typeof apiErrorSchema>;
export { editionCandidateSchema };
