import { withUser } from './client';

/**
 * Input of {@link upsertCatalogEdition}. Only `title` is required.
 * Identifiers must already be normalised (ISBN without hyphens, upper-case X).
 */
export interface CatalogEditionInput {
	title: string;
	/** Author display names in order. */
	authors?: string[];
	originalTitle?: string | null;
	firstPublishedYear?: number | null;
	openLibraryWorkId?: string | null;
	/** Open Library author ids, aligned by index with `authors` (same length or shorter). */
	openLibraryAuthorIds?: (string | null)[] | null;
	/** Attach the edition to this existing work (catalog id as string) instead of creating one. */
	workId?: string | null;
	isbn10?: string | null;
	isbn13?: string | null;
	language?: string | null;
	publisher?: string | null;
	/** ISO date (YYYY-MM-DD). */
	publishedDate?: string | null;
	publishedYear?: number | null;
	pageCount?: number | null;
	googleBooksId?: string | null;
	openLibraryEditionId?: string | null;
	inventaireId?: string | null;
	sbnId?: string | null;
	/** Library of Congress control number (LCCN normalizzato). */
	locId?: string | null;
	coverProvider?: string | null;
	coverRef?: string | null;
	coverUrl?: string | null;
}

export interface CatalogEditionResult {
	/** bigint ids as strings, per the API contract. */
	workId: string;
	editionId: string;
	/** false when an existing edition was matched by ISBN / provider id (and only enriched). */
	created: boolean;
}

/**
 * The ONLY write path into the shared catalog (works / authors / editions):
 * the runtime role has no INSERT/UPDATE on those tables. See migration 007 for
 * the matching rules (strong identifiers only; title + author never merge).
 */
export async function upsertCatalogEdition(
	userId: string,
	input: CatalogEditionInput
): Promise<CatalogEditionResult> {
	const authorIds = (input.openLibraryAuthorIds ?? []).map((id) => id ?? '');

	return withUser(userId, async (tx) => {
		const rows = await tx<{ result: CatalogEditionResult }[]>`
			select app.catalog_upsert_edition_v3(
				p_title                   => ${input.title},
				p_authors                 => ${input.authors ?? []}::text[],
				p_original_title          => ${input.originalTitle ?? null},
				p_first_published_year    => ${input.firstPublishedYear ?? null}::smallint,
				p_open_library_work_id    => ${input.openLibraryWorkId ?? null},
				p_open_library_author_ids => ${authorIds.length ? authorIds : null}::text[],
				p_work_id                 => ${input.workId ?? null}::bigint,
				p_isbn_10                 => ${input.isbn10 ?? null},
				p_isbn_13                 => ${input.isbn13 ?? null},
				p_language                => ${input.language ?? null},
				p_publisher               => ${input.publisher ?? null},
				p_published_date          => ${input.publishedDate ?? null}::date,
				p_published_year          => ${input.publishedYear ?? null}::smallint,
				p_page_count              => ${input.pageCount ?? null}::integer,
				p_google_books_id         => ${input.googleBooksId ?? null},
				p_open_library_edition_id => ${input.openLibraryEditionId ?? null},
				p_cover_provider          => ${input.coverProvider ?? null},
				p_cover_ref               => ${input.coverRef ?? null},
				p_cover_url               => ${input.coverUrl ?? null},
				p_inventaire_id           => ${input.inventaireId ?? null},
				p_sbn_id                  => ${input.sbnId ?? null},
				p_loc_id                  => ${input.locId ?? null}
			) as result
		`;
		const row = rows[0];
		if (!row) throw new Error('catalog_upsert_edition returned no row');
		return row.result;
	});
}
