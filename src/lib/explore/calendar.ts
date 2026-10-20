/**
 * Logica pura del calendario di lettura: griglia dei mesi (settimana da lunedì, anni bisestili),
 * sfondo dei giorni con più generi e testi accessibili. Le date sono sempre `YYYY-MM-DD` locali,
 * senza passare da fusi orari.
 */
import type { GenreSlug } from '../contracts/enums';
import { GENRE_SHORT_LABELS } from '../genres';

export const MONTH_NAMES = [
	'Gennaio',
	'Febbraio',
	'Marzo',
	'Aprile',
	'Maggio',
	'Giugno',
	'Luglio',
	'Agosto',
	'Settembre',
	'Ottobre',
	'Novembre',
	'Dicembre'
] as const;

/** Intestazione dei giorni, settimana che inizia di lunedì. */
export const WEEKDAY_INITIALS = ['L', 'M', 'M', 'G', 'V', 'S', 'D'] as const;

export const MIN_YEAR = 1900;
export const MAX_YEAR = 2200;

export function isLeapYear(year: number): boolean {
	return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** `month` è 1-12. */
export function daysInMonth(year: number, month: number): number {
	if (month === 2) return isLeapYear(year) ? 29 : 28;
	return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

/** Giorno della settimana con lunedì = 0 ... domenica = 6. `month` è 1-12. */
export function weekdayMonday(year: number, month: number, day: number): number {
	const date = new Date(Date.UTC(2000, month - 1, day));
	date.setUTCFullYear(year);
	return (date.getUTCDay() + 6) % 7;
}

export interface MonthGrid {
	month: number;
	name: string;
	/** Celle vuote prima del giorno 1. */
	leading: number;
	days: number[];
}

export function buildMonthGrid(year: number, month: number): MonthGrid {
	return {
		month,
		name: MONTH_NAMES[month - 1] ?? '',
		leading: weekdayMonday(year, month, 1),
		days: Array.from({ length: daysInMonth(year, month) }, (_, i) => i + 1)
	};
}

export function buildYearGrid(year: number): MonthGrid[] {
	return Array.from({ length: 12 }, (_, i) => buildMonthGrid(year, i + 1));
}

const pad = (n: number, size = 2) => String(n).padStart(size, '0');

export function dateKey(year: number, month: number, day: number): string {
	return `${pad(year, 4)}-${pad(month)}-${pad(day)}`;
}

/** Data locale del dispositivo come `YYYY-MM-DD`. */
export function localDateKey(date: Date): string {
	return dateKey(date.getFullYear(), date.getMonth() + 1, date.getDate());
}

/** Anno richiesto da `?year=`; valori non validi ricadono sull'anno corrente. */
export function parseYearParam(value: string | null, fallback: number): number {
	if (value === null || !/^\d{4}$/.test(value)) return fallback;
	const year = Number(value);
	return year >= MIN_YEAR && year <= MAX_YEAR ? year : fallback;
}

/** Anni selezionabili, dal più recente: dall'anno corrente a `span` anni fa. */
export function yearOptions(currentYear: number, span = 9): number[] {
	return Array.from({ length: span + 1 }, (_, i) => currentYear - i).filter((y) => y >= MIN_YEAR);
}

// ---------------------------------------------------------------------------
// Pallino del giorno
// ---------------------------------------------------------------------------

/** Colore base del genere (solo token del tema). */
export function genreColorVar(slug: GenreSlug): string {
	return `var(--genre-${slug})`;
}

const round = (n: number) => Math.round(n * 1000) / 1000;

/**
 * Sfondo del pallino:
 * - 1 genere: tinta unita;
 * - 2 generi: metà e metà (`linear-gradient(90deg)`, come nel mockup);
 * - 3+ generi: `conic-gradient` a segmenti uguali (estensione dello stesso stile).
 */
export function daySegmentsBackground(colors: readonly string[]): string {
	const n = colors.length;
	if (n === 0) return 'none';
	if (n === 1) return colors[0] as string;
	if (n === 2) return `linear-gradient(90deg, ${colors[0]} 50%, ${colors[1]} 50%)`;
	const stops = colors.map((color, i) => {
		const start = round((i / n) * 100);
		const end = round(((i + 1) / n) * 100);
		return `${color} ${start}% ${end}%`;
	});
	return `conic-gradient(${stops.join(', ')})`;
}

export interface DayGenre {
	slug: GenreSlug;
	pagesRead: number;
}

/** "12 marzo: Fantasy, Classici" */
export function formatDayLabel(date: string, genres: readonly DayGenre[]): string {
	const [, month, day] = date.split('-').map(Number);
	const monthName = (MONTH_NAMES[(month ?? 1) - 1] ?? '').toLowerCase();
	const names = genres.map((g) => GENRE_SHORT_LABELS[g.slug]).join(', ');
	return `${day} ${monthName}: ${names}`;
}
