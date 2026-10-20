import { describe, expect, it } from 'vitest';
import {
	buildMonthGrid,
	buildYearGrid,
	dateKey,
	daySegmentsBackground,
	daysInMonth,
	formatDayLabel,
	isLeapYear,
	localDateKey,
	parseYearParam,
	weekdayMonday,
	yearOptions
} from '../../src/lib/explore/calendar';

describe('anni bisestili e lunghezza dei mesi', () => {
	it.each([
		[2024, true],
		[2026, false],
		[1900, false],
		[2000, true],
		[2100, false]
	])('isLeapYear(%i) = %s', (year, leap) => {
		expect(isLeapYear(year)).toBe(leap);
		expect(daysInMonth(year, 2)).toBe(leap ? 29 : 28);
	});

	it('mesi da 30 e 31 giorni', () => {
		expect(daysInMonth(2026, 4)).toBe(30);
		expect(daysInMonth(2026, 12)).toBe(31);
		const total = buildYearGrid(2026).reduce((sum, m) => sum + m.days.length, 0);
		expect(total).toBe(365);
		expect(buildYearGrid(2024).reduce((sum, m) => sum + m.days.length, 0)).toBe(366);
	});
});

describe('settimana che inizia di lunedi', () => {
	it('gennaio 2026 parte da giovedi (3 celle vuote), come nel mockup', () => {
		expect(weekdayMonday(2026, 1, 1)).toBe(3);
		expect(buildMonthGrid(2026, 1).leading).toBe(3);
	});

	it('casi noti', () => {
		expect(weekdayMonday(2026, 3, 1)).toBe(6); // domenica
		expect(weekdayMonday(2024, 1, 1)).toBe(0); // lunedi
		expect(weekdayMonday(2024, 2, 29)).toBe(3); // giovedi
		expect(weekdayMonday(2026, 9, 30)).toBe(2); // mercoledi
		expect(weekdayMonday(1999, 12, 31)).toBe(4); // venerdi
	});
});

describe('sfondo del pallino', () => {
	it('un genere: tinta unita', () => {
		expect(daySegmentsBackground(['var(--genre-a)'])).toBe('var(--genre-a)');
	});

	it('due generi: meta e meta come nel mockup', () => {
		expect(daySegmentsBackground(['A', 'B'])).toBe('linear-gradient(90deg, A 50%, B 50%)');
	});

	it('tre o piu generi: conic-gradient a segmenti uguali', () => {
		expect(daySegmentsBackground(['A', 'B', 'C'])).toBe(
			'conic-gradient(A 0% 33.333%, B 33.333% 66.667%, C 66.667% 100%)'
		);
		expect(daySegmentsBackground(['A', 'B', 'C', 'D'])).toBe(
			'conic-gradient(A 0% 25%, B 25% 50%, C 50% 75%, D 75% 100%)'
		);
	});

	it('nessun genere: nessuno sfondo', () => {
		expect(daySegmentsBackground([])).toBe('none');
	});
});

describe('date, etichette e anno', () => {
	it('dateKey e localDateKey', () => {
		expect(dateKey(2026, 3, 5)).toBe('2026-03-05');
		expect(localDateKey(new Date(2026, 8, 30, 23, 59))).toBe('2026-09-30');
	});

	it('etichetta accessibile del giorno', () => {
		expect(
			formatDayLabel('2026-03-12', [
				{ slug: 'fantasy-magical-gothic', pagesRead: 10 },
				{ slug: 'classics', pagesRead: 4 }
			])
		).toBe('12 marzo: Fantasy, Classici');
	});

	it('parseYearParam ricade sul fallback', () => {
		expect(parseYearParam('2025', 2026)).toBe(2025);
		expect(parseYearParam(null, 2026)).toBe(2026);
		expect(parseYearParam('abcd', 2026)).toBe(2026);
		expect(parseYearParam('1800', 2026)).toBe(2026);
		expect(parseYearParam('20255', 2026)).toBe(2026);
	});

	it('yearOptions parte dall anno corrente', () => {
		expect(yearOptions(2026, 2)).toEqual([2026, 2025, 2024]);
	});
});
