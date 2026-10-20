import type { EditionCandidate } from '$lib/contracts/books';
import type { BookSearchRequest } from '$lib/contracts/rpc';

/** Provider di metadati supportati (lato server). */
export type CatalogProviderId =
	| 'open-library'
	| 'google-books'
	| 'inventaire'
	| 'sbn'
	| 'loc'
	| 'isbndb';

export interface ProviderCallOptions {
	signal?: AbortSignal | undefined;
}

/**
 * Sorgente di metadati bibliografici. Le implementazioni reali stanno in
 * `$lib/server/catalog`; i test usano fixture o doppioni in memoria.
 * Gli errori di rete devono diventare `DataAccessError('NETWORK' | 'RATE_LIMITED')`.
 */
export interface BookProvider {
	readonly id: CatalogProviderId;
	search(request: BookSearchRequest, options?: ProviderCallOptions): Promise<EditionCandidate[]>;
	/** `isbn13` è già normalizzato e con checksum valido. */
	lookupIsbn(isbn13: string, options?: ProviderCallOptions): Promise<EditionCandidate[]>;
}

export type ProviderStatus = 'ok' | 'error' | 'rate_limited';

export interface CatalogSearchResult {
	candidates: EditionCandidate[];
	/** true se almeno un provider non ha risposto (risultati parziali) */
	degraded: boolean;
	possibleMatches?: boolean;
	providers: Partial<Record<CatalogProviderId, ProviderStatus>>;
}

export interface IsbnLookupResult extends CatalogSearchResult {
	/** candidates[0] ha lo stesso ISBN cercato: unico caso in cui si può preselezionare */
	exactMatch: boolean;
}
