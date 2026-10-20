import { DataAccessError } from '$lib/data/errors';
import type { EditionCandidate } from '$lib/contracts/books';
import type { BookSearchRequest } from '$lib/contracts/rpc';
import { CATALOG_TTL, TtlCache } from '$lib/catalog/cache';
import { institutionalCatalogFor, parseIsbn } from '$lib/catalog/isbn';
import { dedupeCandidates } from '$lib/catalog/merge';
import {
	hasIsbnMatch,
	isStrongIsbnMatch,
	rankCandidates,
	topCandidates
} from '$lib/catalog/ranking';
import { normalizeText } from '$lib/catalog/text';
import type {
	BookProvider,
	CatalogProviderId,
	CatalogSearchResult,
	IsbnLookupResult,
	ProviderStatus
} from '$lib/catalog/types';

export interface CatalogServiceOptions {
	/** In ordine di priorità dei campi in caso di fusione (Open Library prima). */
	providers: readonly BookProvider[];
	/** ISBN only, in fallback order. SBN text search requires explicit source=sbn.
	 * SBN e LOC sono i cataloghi istituzionali: per ogni ISBN viene interrogato solo
	 * quello del suo gruppo di registrazione (vedi `institutionalCatalogFor`). */
	fallbackProviders?: readonly BookProvider[];
	/** Limite dei risultati testuali, prima della paginazione nel browser. */
	maxSearchCandidates?: number;
	/** Limite delle alternative nel lookup ISBN. */
	maxCandidates?: number;
	now?: () => number;
}

interface Collected {
	candidates: EditionCandidate[];
	providers: Partial<Record<CatalogProviderId, ProviderStatus>>;
	failures: DataAccessError[];
}

function toDataError(reason: unknown): DataAccessError {
	return reason instanceof DataAccessError
		? reason
		: new DataAccessError('NETWORK', 'Servizio non raggiungibile', reason);
}

/**
 * Orchestra i provider: chiamate in parallelo, un provider giù non blocca l'altro, dedupe per
 * identità forte, ranking, cache con TTL. Nessun accesso a database o utente.
 */
export class CatalogService {
	private readonly searchCache: TtlCache<CatalogSearchResult>;
	private readonly isbnCache: TtlCache<IsbnLookupResult>;
	private readonly maxCandidates: number;
	private readonly maxSearchCandidates: number;

	constructor(private readonly options: CatalogServiceOptions) {
		const now = options.now;
		this.searchCache = new TtlCache({ maxEntries: 500, ...(now ? { now } : {}) });
		this.isbnCache = new TtlCache({ maxEntries: 1000, ...(now ? { now } : {}) });
		this.maxCandidates = options.maxCandidates ?? 5;
		this.maxSearchCandidates = options.maxSearchCandidates ?? 80;
	}

	clearCache(): void {
		this.searchCache.clear();
		this.isbnCache.clear();
	}

	private async collect(
		call: (provider: BookProvider) => Promise<EditionCandidate[]>,
		providers: readonly BookProvider[] = this.options.providers,
		allowAllFailed = false
	): Promise<Collected> {
		const settled = await Promise.allSettled(providers.map((provider) => call(provider)));
		const collected: Collected = { candidates: [], providers: {}, failures: [] };

		settled.forEach((result, index) => {
			const provider = providers[index] as BookProvider;
			if (result.status === 'fulfilled') {
				collected.providers[provider.id] = 'ok';
				collected.candidates.push(...result.value);
			} else {
				const error = toDataError(result.reason);
				collected.providers[provider.id] = error.code === 'RATE_LIMITED' ? 'rate_limited' : 'error';
				collected.failures.push(error);
			}
		});

		if (
			!allowAllFailed &&
			collected.failures.length === providers.length &&
			collected.failures.length > 0
		) {
			const allRateLimited = collected.failures.every((failure) => failure.code === 'RATE_LIMITED');
			throw new DataAccessError(
				allRateLimited ? 'RATE_LIMITED' : 'NETWORK',
				allRateLimited
					? 'I servizi di catalogo sono momentaneamente sovraccarichi'
					: 'I servizi di catalogo non sono raggiungibili',
				collected.failures[0]
			);
		}
		return collected;
	}

	async search(request: BookSearchRequest): Promise<CatalogSearchResult> {
		const sort = request.sort ?? 'relevance';
		const providers =
			request.source === 'sbn'
				? (this.options.fallbackProviders ?? []).filter((provider) => provider.id === 'sbn')
				: this.options.providers;
		if (!providers.length) throw new DataAccessError('VALIDATION', 'Catalogo SBN non configurato');
		const key = [
			request.title,
			request.author ?? '',
			request.language ?? '',
			sort,
			request.source ?? 'primary'
		]
			.map((part) => normalizeText(part))
			.join('|');

		return this.searchCache.getOrLoad(
			`search:v4:${key}`,
			async () => {
				const collected = await this.collect((provider) => provider.search(request), providers);
				const ranked = rankCandidates(dedupeCandidates(collected.candidates), {
					title: request.title,
					// Nel campo unico il testo può identificare autore o editore: il titolo resta
					// comunque il segnale con peso maggiore nel ranking.
					author: request.author ?? request.title,
					publisher: request.title,
					language: request.language,
					sort
				});
				// Niente rumore: si tengono i candidati pertinenti a titolo, autore o editore.
				const relevant = ranked.filter(
					(candidate) =>
						(!request.author || candidate.matchReasons.includes('author-match')) &&
						candidate.matchReasons.some(
							(reason) =>
								reason === 'title-exact' ||
								reason === 'title-match' ||
								reason === 'author-match' ||
								reason === 'publisher-match'
						)
				);
				return {
					possibleMatches:
						!request.author && sort === 'relevance' && relevant.length === 0 && ranked.length > 0,
					candidates: topCandidates(
						sort === 'newest' || request.author || relevant.length > 0 ? relevant : ranked,
						this.maxSearchCandidates
					),
					degraded: collected.failures.length > 0,
					providers: collected.providers
				};
			},
			(value) =>
				value.degraded
					? CATALOG_TTL.degraded
					: value.candidates.length > 0
						? CATALOG_TTL.search
						: CATALOG_TTL.isbnMiss
		);
	}

	async lookupIsbn(input: string): Promise<IsbnLookupResult> {
		const parsed = parseIsbn(input);
		if (!parsed) throw new DataAccessError('VALIDATION', 'ISBN non valido');
		const { isbn13 } = parsed;

		return this.isbnCache.getOrLoad(
			`isbn:v4:${isbn13}`,
			async () => {
				const collected = await this.collect(
					(provider) => provider.lookupIsbn(isbn13),
					this.options.providers,
					true
				);
				const institutional = institutionalCatalogFor(isbn13);
				for (const provider of this.options.fallbackProviders ?? []) {
					const completeExact = dedupeCandidates(collected.candidates).some(
						(candidate) =>
							hasIsbnMatch(candidate, isbn13) &&
							candidate.coverUrl &&
							candidate.pageCount &&
							candidate.publisher &&
							!candidate.authors.includes('Autore sconosciuto')
					);
					if (completeExact) break;
					// SBN (Italia) e LOC (Stati Uniti/Regno Unito) coprono gruppi editoriali diversi:
					// si interroga solo il catalogo del gruppo dell'ISBN cercato.
					if (
						(provider.id === 'sbn' || provider.id === 'loc') &&
						provider.id !== institutional
					)
						continue;
					const fallback = await this.collect((p) => p.lookupIsbn(isbn13), [provider], true);
					collected.candidates.push(...fallback.candidates);
					Object.assign(collected.providers, fallback.providers);
					collected.failures.push(...fallback.failures);
				}
				if (
					Object.keys(collected.providers).length > 0 &&
					Object.values(collected.providers).every((status) => status !== 'ok')
				) {
					throw new DataAccessError(
						collected.failures.every((failure) => failure.code === 'RATE_LIMITED')
							? 'RATE_LIMITED'
							: 'NETWORK',
						'I servizi di catalogo non sono raggiungibili'
					);
				}
				const ranked = rankCandidates(dedupeCandidates(collected.candidates), { isbn13 });
				// Se c'è l'edizione con lo stesso ISBN si mostra solo quella; altrimenti il meglio disponibile.
				const exact = ranked.filter((candidate) => hasIsbnMatch(candidate, isbn13));
				const candidates = topCandidates(exact.length > 0 ? exact : ranked, this.maxCandidates);
				return {
					candidates,
					degraded: collected.failures.length > 0,
					providers: collected.providers,
					exactMatch: isStrongIsbnMatch(candidates, isbn13)
				};
			},
			(value) =>
				value.degraded
					? CATALOG_TTL.degraded
					: value.exactMatch
						? CATALOG_TTL.isbnHit
						: CATALOG_TTL.isbnMiss
		);
	}
}
