import type { Repositories } from '$lib/server/repositories';
import { requireRepository } from '$lib/server/repositories';
import { profileTabSchema } from '$lib/contracts/performance';

/** Quanti anni precedenti a quello corrente offre il selettore, oltre a quelli con una card Bingo. */
const EXTRA_YEARS = 4;

export function currentYear(): number {
	return new Date().getFullYear();
}

/** Dati del Profilo per un anno (condivisi da /profile e /profile/[year]). */
export async function loadProfilePage(
	repos: Repositories | null,
	year: number,
	requestedTab: string | null = null,
	requestedCalendarYear = year
) {
	const parsedTab = profileTabSchema.safeParse(requestedTab);
	const tab = parsedTab.success ? parsedTab.data : 'overview';
	const calendarYear = tab === 'calendar' ? requestedCalendarYear : year;
	const stats = requireRepository(repos, 'stats');
	const extras = requireRepository(repos, 'statsExtras');
	const bingo = requireRepository(repos, 'bingo');
	const performance = requireRepository(repos, 'performance');
	const explore = requireRepository(repos, 'explore');

	const thisYear = currentYear();
	// La card annuale resta sull’anno corrente anche navigando uno storico.
	const currentYearStatsRequest = year === thisYear ? null : stats.getYearStats(thisYear);
		const [
			yearStats,
			breakdown,
			boards,
			calendar,
			summary,
			quotes,
			pool,
			dnf,
			selectedYearDnfCount,
			currentYearStats
		] = await Promise.all([
			stats.getYearStats(year),
			extras.getGenreBreakdown(year),
			bingo.listBoards(),
			tab === 'overview' || tab === 'calendar' ? stats.getCalendar(calendarYear) : null,
			performance.getProfileSummary(
				tab === 'overview',
				tab === 'activity' ? 30 : tab === 'overview' ? 4 : 0,
				year
			),
			tab === 'overview' || tab === 'stats' ? extras.listQuotes({ limit: 4 }) : null,
			tab === 'wheel' ? explore.getPool() : [],
			tab === 'dnf' ? performance.getProfileDnf() : null,
			tab === 'stats' ? stats.getYearDnfCount(year) : null,
			currentYearStatsRequest
		]);

	const years = new Set<number>([year, thisYear]);
	for (let offset = 1; offset <= EXTRA_YEARS; offset += 1) years.add(thisYear - offset);
	for (const board of boards.boards) years.add(board.year);

	return {
		tab,
		year,
		calendarYear,
		currentYear: thisYear,
		currentYearBooksRead: (currentYearStats ?? yearStats).stats.booksFinished,
		dnfCount: selectedYearDnfCount?.count ?? 0,
		years: [...years].sort((a, b) => b - a),
		stats: yearStats.stats,
		genreBreakdown: breakdown.genres.map((entry) => ({
			slug: entry.genre.slug,
			count: entry.booksFinished
		})),
		bingo: boards.boards.find((board) => board.year === year) ?? null,
		quotes: quotes?.quotes ?? [],
		dnf: dnf?.books ?? [],
		calendar: calendar?.days ?? [],
		summary,
		pool
	};
}
