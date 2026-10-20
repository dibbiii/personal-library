import { describe, expect, it, vi } from 'vitest';
import { ellipsize, fitText, wrapText } from '../../src/lib/quotes/layout';
import { quoteCardFileName } from '../../src/lib/quotes/export';
import { paletteTokens } from '../../src/lib/quotes/palette';
import { renderQuoteCard } from '../../src/lib/quotes/render';
import {
	abbreviateAuthor,
	bingoBoardStatus,
	bingoRemaining,
	formatNumber
} from '../../src/lib/components/stats/format';

/** Larghezza finta: 10px per carattere a corpo 10, proporzionale al corpo. */
const measureAt = (fontSize: number) => (text: string) => Array.from(text).length * fontSize;

describe('wrapText', () => {
	it('manda a capo alle parole senza superare la larghezza', () => {
		const lines = wrapText('uno due tre quattro cinque', 100, measureAt(10));
		expect(lines).toEqual(['uno due', 'tre', 'quattro', 'cinque']);
		for (const line of lines) expect(measureAt(10)(line)).toBeLessThanOrEqual(100);
	});

	it('rispetta gli a capo espliciti e non perde testo', () => {
		const lines = wrapText('alfa\nbeta gamma', 1000, measureAt(10));
		expect(lines).toEqual(['alfa', 'beta gamma']);
	});

	it('spezza per caratteri una parola più larga della riga', () => {
		const lines = wrapText('abcdefghijkl', 50, measureAt(10));
		expect(lines).toEqual(['abcde', 'fghij', 'kl']);
		expect(lines.join('')).toBe('abcdefghijkl');
	});

	it('gestisce spazi multipli e testo vuoto', () => {
		expect(wrapText('  a   b  ', 1000, measureAt(10))).toEqual(['a b']);
		expect(wrapText('', 100, measureAt(10))).toEqual(['']);
	});
});

describe('ellipsize', () => {
	it('non tocca il testo che sta già', () => {
		expect(ellipsize('ciao', 100, measureAt(10))).toBe('ciao');
	});

	it('accorcia aggiungendo l’ellissi dentro la larghezza', () => {
		const out = ellipsize('abcdefghij', 55, measureAt(10));
		expect(out.endsWith('…')).toBe(true);
		expect(measureAt(10)(out)).toBeLessThanOrEqual(55);
	});
});

describe('fitText', () => {
	const base = { maxWidth: 300, maxHeight: 200, lineHeight: 1.5, step: 2 };

	it('usa il corpo massimo se il testo è breve', () => {
		const fit = fitText({ ...base, text: 'breve', maxFontSize: 40, minFontSize: 12, measureAt });
		expect(fit.fontSize).toBe(40);
		expect(fit.truncated).toBe(false);
		expect(fit.lines).toEqual(['breve']);
	});

	it('riduce il corpo finché il testo sta nel riquadro', () => {
		const text = 'parola '.repeat(40).trim();
		const fit = fitText({ ...base, text, maxFontSize: 40, minFontSize: 10, measureAt });
		expect(fit.fontSize).toBeLessThan(40);
		expect(fit.fontSize).toBeGreaterThanOrEqual(10);
		expect(fit.height).toBeLessThanOrEqual(base.maxHeight);
		expect(fit.truncated).toBe(false);
		// nessuna parola persa
		expect(fit.lines.join(' ').split(' ').length).toBe(40);
	});

	it('è monotono: più testo non aumenta il corpo', () => {
		const short = fitText({
			...base,
			text: 'a '.repeat(20),
			maxFontSize: 40,
			minFontSize: 10,
			measureAt
		});
		const long = fitText({
			...base,
			text: 'a '.repeat(80),
			maxFontSize: 40,
			minFontSize: 10,
			measureAt
		});
		expect(long.fontSize).toBeLessThanOrEqual(short.fontSize);
	});

	it('tronca con ellissi quando nemmeno il corpo minimo basta', () => {
		const text = 'parola '.repeat(500).trim();
		const fit = fitText({ ...base, text, maxFontSize: 40, minFontSize: 20, measureAt });
		expect(fit.fontSize).toBe(20);
		expect(fit.truncated).toBe(true);
		expect(fit.height).toBeLessThanOrEqual(base.maxHeight);
		expect(fit.lines.at(-1)?.endsWith('…')).toBe(true);
		expect(measureAt(20)(fit.lines.at(-1) ?? '')).toBeLessThanOrEqual(base.maxWidth);
	});
});

describe('stile della card', () => {
	it('deriva i colori dai token del tema, mai da valori letterali', () => {
		for (const style of ['genre', 'light', 'theme', 'paper'] as const) {
			const tokens = paletteTokens(style, 'fantasy-magical-gothic');
			for (const value of Object.values(tokens)) expect(value).toMatch(/^var\(--[a-z-]+\)$/);
		}
	});

	it('il nome file è sicuro e leggibile', () => {
		expect(quoteCardFileName('Il nome del vento')).toBe('segnalibro-il-nome-del-vento.png');
		expect(quoteCardFileName('  Più è meglio! ')).toBe('segnalibro-piu-e-meglio.png');
		expect(quoteCardFileName('???')).toBe('segnalibro-citazione.png');
	});
});

describe('renderQuoteCard', () => {
	it('mostra titolo e autore e non stampa il genere nel footer', () => {
		const drawnText: string[] = [];
		const ctx = {
			beginPath() {},
			arcTo() {},
			closePath() {},
			moveTo() {},
			stroke() {},
			fill() {},
			clearRect() {},
			fillRect() {},
			save() {},
			restore() {},
			fillText(text: string) {
				drawnText.push(text);
			},
			translate() {},
			scale() {},
			measureText(text: string) {
				return { width: Array.from(text).length * 12 };
			}
		} as unknown as CanvasRenderingContext2D;
		const canvas = { getContext: () => ctx } as unknown as HTMLCanvasElement;
		const content = {
			body: 'Una citazione breve.',
			title: 'Il nome del vento',
			author: 'Patrick Rothfuss',
			page: 42,
			genreName: 'Fantasy'
		};

		vi.stubGlobal('Path2D', class {});
		try {
			renderQuoteCard(
				canvas,
				content,
				{ background: '#fff', ink: '#000', accent: '#333' },
				{ display: 'Georgia, serif', ui: 'system-ui, sans-serif' }
			);
		} finally {
			vi.unstubAllGlobals();
		}

		expect(drawnText).toContain('Il nome del vento');
		expect(drawnText).toContain('Patrick Rothfuss · p. 42');
		expect(drawnText).not.toContain('Fantasy');
		expect(drawnText).toContain('«');
		expect(drawnText).toContain('»');
		expect(drawnText).not.toContain('“');
	});
});

describe('formattazione Statistiche', () => {
	it('usa il punto delle migliaia anche a 4 cifre', () => {
		expect(formatNumber(18420)).toBe('18.420');
		expect(formatNumber(1008)).toBe('1.008');
		expect(formatNumber(23)).toBe('23');
	});

	it('abbrevia il nome dell’autore come nel mockup', () => {
		expect(abbreviateAuthor('Patrick Rothfuss')).toBe('P. Rothfuss');
		expect(abbreviateAuthor('J.R.R. Tolkien')).toBe('J.R.R. Tolkien');
		expect(abbreviateAuthor('Cognetti')).toBe('Cognetti');
	});

	it('descrive l’avanzamento del Bingo', () => {
		expect(bingoRemaining(7)).toBe('Ancora 9 caselle per il bingo');
		expect(bingoRemaining(15)).toBe('Ancora 1 casella per il bingo');
		expect(bingoRemaining(16)).toBe('Bingo completo!');
		expect(bingoBoardStatus(16)).toBe('16 su 16 · Bingo completo!');
		expect(bingoBoardStatus(11)).toBe('11 su 16 · Quasi!');
	});
});
