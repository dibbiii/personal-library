import type { GenreSlug } from '../contracts/enums';
import { isGenreSlug } from '../genres';
import { seriesInputSchema } from './schemas';

export type AddPath = '/add' | '/add/manual' | '/add/search' | '/add/scan';

export interface AddSeriesContext {
	name: string;
	number: number | null;
	total: number | null;
}

export function parseAddGenre(value: string | null | undefined): GenreSlug | null {
	return value && isGenreSlug(value) ? value : null;
}

/** Legge i metadati precompilati dalla query, senza fidarsi dei valori ricevuti. */
export function getAddSeriesContext(url: URL): AddSeriesContext | null {
	const name = url.searchParams.get('seriesName');
	if (name === null) return null;

	const parseNumber = (value: string | null): number | null => {
		if (value === null || value.trim() === '') return null;
		return Number(value.trim().replace(',', '.'));
	};
	const series = seriesInputSchema.safeParse({
		name,
		number: parseNumber(url.searchParams.get('seriesNumber')),
		total: parseNumber(url.searchParams.get('seriesTotal'))
	});
	return series.success ? series.data : null;
}

export function getAddSeriesParams(url: URL): URLSearchParams {
	const series = getAddSeriesContext(url);
	const params = new URLSearchParams();
	if (!series) return params;
	params.set('seriesName', series.name);
	if (series.number !== null) params.set('seriesNumber', String(series.number));
	if (series.total !== null) params.set('seriesTotal', String(series.total));
	return params;
}

/** Mantiene titolo, ISBN e query di ricerca quando si cambia modalità. */
export function getAddModeParams(url: URL): URLSearchParams {
	const params = getAddSeriesParams(url);
	for (const key of ['title', 'isbn', 'q'] as const) {
		const value = url.searchParams.get(key);
		if (value !== null) params.set(key, value);
	}
	return params;
}

/** Conserva i dati del fallback (ISBN/titolo), ma non propaga generi non validi. */
export function buildAddHref(
	path: AddPath,
	genre: string | null = null,
	searchParams = new URLSearchParams()
): string {
	const params = new URLSearchParams(searchParams);
	const validGenre = parseAddGenre(genre);
	if (validGenre) params.set('genre', validGenre);
	else params.delete('genre');
	const query = params.toString();
	return query ? `${path}?${query}` : path;
}

export function getAddContext(url: URL): { genre: GenreSlug | null; backHref: string } {
	const genre = parseAddGenre(url.searchParams.get('genre'));
	return {
		genre,
		backHref:
			url.pathname === '/add'
				? genre
					? `/genre/${genre}`
					: '/library'
				: buildAddHref('/add', genre)
	};
}
