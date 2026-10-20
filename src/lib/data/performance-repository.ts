import type { GenreSlug, GenreSortField, SortDirection } from '../contracts';
import {
	discoveryContextSchema,
	genrePagesSchema,
	profileDnfSchema,
	profileSummarySchema,
	queueSummarySchema,
	quotesPageSchema
} from '../contracts/performance';
import type { RpcTransport } from './rpc-client';
import { callRpc } from './rpc-client';
import { RPC } from './rpc-names';

export class RpcPerformanceRepository {
	constructor(private readonly transport: RpcTransport) {}
	getProfileSummary(collections: boolean, activityLimit: number, year: number) {
		return callRpc(
			this.transport,
			RPC.profileSummary,
			{ p_collections: collections, p_activity_limit: activityLimit, p_year: year },
			profileSummarySchema
		);
	}
	getProfileDnf() {
		return callRpc(this.transport, RPC.profileDnf, {}, profileDnfSchema);
	}
	getQueueSummary() {
		return callRpc(this.transport, RPC.queueSummary, {}, queueSummarySchema);
	}
	getDiscoveryContext() {
		return callRpc(this.transport, RPC.discoveryContext, {}, discoveryContextSchema);
	}
	getQuotesPage(page: number, bookId: string | null) {
		return callRpc(
			this.transport,
			RPC.quotesPage,
			{ p_page: page, p_book_id: bookId },
			quotesPageSchema
		);
	}
	getGenrePages(input: {
		genre: GenreSlug;
		sortField: GenreSortField;
		direction: SortDirection;
		unreadSort: 'title' | 'author' | 'pages' | 'date';
		readPage: number;
		unreadPage: number;
	}) {
		return callRpc(
			this.transport,
			RPC.genrePages,
			{
				p_genre_slug: input.genre,
				p_sort_field: input.sortField,
				p_sort_direction: input.direction,
				p_unread_sort: input.unreadSort,
				p_read_page: input.readPage,
				p_unread_page: input.unreadPage
			},
			genrePagesSchema
		);
	}
}
