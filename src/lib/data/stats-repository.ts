import {
	readingCalendarResponseSchema,
	statsDashboardResponseSchema,
	yearDnfCountResponseSchema,
	yearStatsResponseSchema
} from '../contracts/rpc';

import type { StatsRepository } from './repositories';
import type { RpcTransport } from './rpc-client';
import { callRpc } from './rpc-client';
import { RPC } from './rpc-names';

/**
 * Statistiche, calendario di lettura e dashboard. Usato da Esplora (calendario)
 * e da Statistiche/Bingo (getYearStats, getDashboard).
 */
export class RpcStatsRepository implements StatsRepository {
	constructor(private readonly transport: RpcTransport) {}

	async getCalendar(year: number) {
		return callRpc(
			this.transport,
			RPC.readingCalendar,
			{ p_year: year },
			readingCalendarResponseSchema
		);
	}

	async getYearStats(year: number) {
		return callRpc(this.transport, RPC.yearStats, { p_year: year }, yearStatsResponseSchema);
	}

	async getYearDnfCount(year: number) {
		return callRpc(this.transport, RPC.yearDnfCount, { p_year: year }, yearDnfCountResponseSchema);
	}

	async getDashboard(year: number) {
		return callRpc(
			this.transport,
			RPC.statsDashboard,
			{ p_year: year },
			statsDashboardResponseSchema
		);
	}
}
