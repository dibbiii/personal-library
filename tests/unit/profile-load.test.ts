import { describe, expect, it, vi } from 'vitest';
import type { Repositories } from '../../src/lib/server/repositories';
import { currentYear, loadProfilePage } from '../../src/routes/(app)/profile/profile-load.server';

describe('loadProfilePage', () => {
	it('loads the selected year DNF count without loading the cemetery on the stats tab', async () => {
		const year = currentYear() - 2;
		const getYearDnfCount = vi.fn(async (requestedYear: number) => ({
			contractVersion: 1 as const,
			year: requestedYear,
			count: 3
		}));
		const getProfileDnf = vi.fn();
		const repos = {
			stats: {
				getYearStats: vi.fn(async (requestedYear: number) => ({
					contractVersion: 1 as const,
					stats: { year: requestedYear, booksFinished: 4 }
				})),
				getYearDnfCount,
				getCalendar: vi.fn(),
				getDashboard: vi.fn()
			},
			statsExtras: {
				getGenreBreakdown: vi.fn(async () => ({ genres: [] })),
				listQuotes: vi.fn(async () => ({ quotes: [] }))
			},
			bingo: { listBoards: vi.fn(async () => ({ boards: [] })) },
			performance: {
				getProfileSummary: vi.fn(async () => ({})),
				getProfileDnf
			},
			explore: { getPool: vi.fn() }
		} as unknown as Repositories;

		const data = await loadProfilePage(repos, year, 'stats');

		expect(data.dnfCount).toBe(3);
		expect(getYearDnfCount).toHaveBeenCalledWith(year);
		expect(getProfileDnf).not.toHaveBeenCalled();
		expect(data.dnf).toEqual([]);
	});
});
