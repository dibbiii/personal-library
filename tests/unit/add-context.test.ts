import { describe, expect, it } from 'vitest';
import {
	buildAddHref,
	getAddContext,
	getAddModeParams,
	getAddSeriesContext,
	getAddSeriesParams,
	parseAddGenre
} from '../../src/lib/catalog/add-context';
import { GENRE_ORDER } from '../../src/lib/genres';

const paths = ['/add/manual', '/add/search', '/add/scan'] as const;
const url = (path: string) => new URL(path, 'https://segnalibro.test');

describe('contesto del flusso aggiunta', () => {
	it('accetta Saggi come genere del flusso', () => {
		expect(parseAddGenre('essays')).toBe('essays');
		expect(buildAddHref('/add', 'essays')).toBe('/add?genre=essays');
	});

	it.each(GENRE_ORDER)('accetta il genere %s senza modificarlo', (genre) => {
		expect(parseAddGenre(genre)).toBe(genre);
		expect(buildAddHref('/add', genre)).toBe(`/add?genre=${genre}`);
	});

	it.each([null, undefined, '', 'unknown', 'Classics', ' classics ', '../library'])(
		'ignora un genere assente o non valido: %s',
		(genre) => {
			expect(parseAddGenre(genre)).toBeNull();
		}
	);

	it('il flusso generico non preseleziona il genere e torna alla libreria', () => {
		expect(getAddContext(url('/add'))).toEqual({ genre: null, backHref: '/library' });
		for (const path of paths) {
			expect(buildAddHref(path)).toBe(path);
			expect(getAddContext(url(path))).toEqual({ genre: null, backHref: '/add' });
		}
	});

	it.each(GENRE_ORDER)('conserva %s nelle tre opzioni e nei link indietro', (genre) => {
		const entry = getAddContext(url(buildAddHref('/add', genre)));
		expect(entry).toEqual({ genre, backHref: `/genre/${genre}` });
		for (const path of paths) {
			const optionHref = buildAddHref(path, entry.genre);
			expect(optionHref).toBe(`${path}?genre=${genre}`);
			const option = getAddContext(url(optionHref));
			expect(option).toEqual({ genre, backHref: `/add?genre=${genre}` });
			expect(getAddContext(url(option.backHref))).toEqual(entry);
		}
	});

	it.each(['/add', ...paths])('non propaga un genere non valido da %s', (path) => {
		const context = getAddContext(url(`${path}?genre=unknown`));
		expect(context.genre).toBeNull();
		expect(context.backHref).toBe(path === '/add' ? '/library' : '/add');
		expect(buildAddHref('/add/manual', 'unknown')).toBe('/add/manual');
	});

	it('conserva ISBN e titolo nei fallback senza mutare i parametri originali', () => {
		const params = new URLSearchParams({
			isbn: '9788804678378',
			title: 'Titolo & autore / edizione',
			genre: 'unknown'
		});
		const href = buildAddHref('/add/manual', 'classics', params);
		expect(url(href).searchParams.get('isbn')).toBe('9788804678378');
		expect(url(href).searchParams.get('title')).toBe('Titolo & autore / edizione');
		expect(url(href).searchParams.getAll('genre')).toEqual(['classics']);
		expect(getAddContext(url(href))).toEqual({
			genre: 'classics',
			backHref: '/add?genre=classics'
		});
		expect(params.get('genre')).toBe('unknown');
	});

	it('rilegge il genere quando la query cambia sulla stessa URL', () => {
		const current = url('/add/search?genre=classics&q=Odissea');
		expect(getAddContext(current).genre).toBe('classics');
		current.searchParams.set('genre', 'dystopia-scifi');
		expect(getAddContext(current)).toEqual({
			genre: 'dystopia-scifi',
			backHref: '/add?genre=dystopia-scifi'
		});
		current.searchParams.set('genre', 'unknown');
		expect(getAddContext(current)).toEqual({ genre: null, backHref: '/add' });
		expect(current.searchParams.get('q')).toBe('Odissea');
		current.searchParams.delete('genre');
		expect(getAddContext(current)).toEqual({ genre: null, backHref: '/add' });
	});

	it('rimuove generi duplicati o non validi, lasciando i dati del fallback', () => {
		const params = new URLSearchParams('genre=unknown&genre=classics&isbn=123');
		expect(buildAddHref('/add/manual', null, params)).toBe('/add/manual?isbn=123');
		const selected = url(buildAddHref('/add/manual', 'classics', params));
		expect(selected.searchParams.getAll('genre')).toEqual(['classics']);
	});

	it('legge i dati della serie precompilati nel flusso di aggiunta', () => {
		expect(
			getAddSeriesContext(
				url('/add/search?seriesName=Le%20cronache%20del%20gatto&seriesNumber=2&seriesTotal=4')
			)
		).toEqual({
			name: 'Le cronache del gatto',
			number: 2,
			total: 4
		});
	});

	it('conserva i dati validi della serie passando tra le modalità di aggiunta', () => {
		const params = getAddSeriesParams(
			url('/add/search?seriesName=Saga%20del%20gatto&seriesNumber=2&seriesTotal=4&q=Gatto')
		);
		const destination = url(buildAddHref('/add/manual', 'classics', params));

		expect(getAddSeriesContext(destination)).toEqual({
			name: 'Saga del gatto',
			number: 2,
			total: 4
		});
		expect(destination.searchParams.get('genre')).toBe('classics');
		expect(destination.searchParams.has('q')).toBe(false);
	});

	it('conserva titolo, ISBN e ricerca nei link tra le modalità', () => {
		const params = getAddModeParams(
			url(
				'/add/search?seriesName=Saga%20del%20gatto&seriesNumber=2&seriesTotal=4&title=Il%20gatto%20%26%20il%20libro&isbn=9788804678378&q=ricerca%20iniziale'
			)
		);

		for (const path of paths) {
			const destination = url(buildAddHref(path, 'classics', params));
			expect(destination.searchParams.get('title')).toBe('Il gatto & il libro');
			expect(destination.searchParams.get('isbn')).toBe('9788804678378');
			expect(destination.searchParams.get('q')).toBe('ricerca iniziale');
			expect(destination.searchParams.get('seriesName')).toBe('Saga del gatto');
			expect(destination.searchParams.get('genre')).toBe('classics');
		}
	});

	it.each([
		'/add/search?seriesName=%20%20&seriesNumber=2&seriesTotal=4',
		'/add/search?seriesName=Saga&seriesNumber=tre&seriesTotal=4',
		'/add/search?seriesName=Saga&seriesNumber=2&seriesTotal=2.5',
		'/add/search?seriesName=Saga&seriesNumber=3&seriesTotal=2'
	])('ignora metadati di serie non validi: %s', (path) => {
		expect(getAddSeriesContext(url(path))).toBeNull();
	});
});
