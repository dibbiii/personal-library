import type {
	BookDetailResponse,
	BookSearchRequest,
	BookSearchResponse,
	ChangeBookFormatInput,
	ChangeBookGenreInput,
	GenreViewResponse,
	IsbnLookupRequest,
	LibraryHomeResponse,
	RecordProgressInput,
	ReadingCalendarResponse,
	SaveReviewInput,
	SetThemeInput,
	ShelfPageResponse,
	StartReadingInput,
	StatsDashboardResponse,
	YearDnfCountResponse,
	YearStatsResponse,
	AddCompletedReadingInput,
	FinishReadingInput,
	MarkDnfInput,
	QueueMoveInput,
	QueueAddResponse
} from '../contracts/rpc';

import type { GenreSortField, GenreSlug, SortDirection } from '../contracts/enums';

import type { ReadingMutationResult } from '../contracts/readings';
import type { BookRemovalResult } from '../contracts/library-mutations';

import type {
	AddQuoteInput,
	Quote,
	ReviewReferenceResponse,
	ReviewSaveResult,
	UpdateQuoteInput
} from '../contracts/reviews';

import type { BingoBoard } from '../contracts/stats';

import type {
	BingoBoardListResponse,
	CompletedBooksResponse,
	QuoteListResponse,
	YearGenreBreakdownResponse
} from '../contracts/stats-lists';

import type { ShelfCursor, QueueBook, BookSummary } from '../contracts/books';

import type { ThemeDefinition, ThemeSelection } from '../contracts/themes';

import type {
	UpdateSettingsInput,
	UpdateUserGenreShelvesInput,
	UserExport,
	UserGenreShelvesResponse,
	UserSettings
} from '../contracts/settings';
import type {
	CreateFriendInviteResponse,
	DeleteFriendshipInput,
	FriendPrivacy,
	FriendProfile,
	FriendLibraryVisibilityResponse,
	FriendshipsResponse,
	RedeemFriendInviteInput,
	RedeemFriendInviteResponse,
	SetFriendLibraryVisibilityInput
} from '../contracts/friendships';

export interface LibraryRepository {
	getHome(options?: { shelfLimit?: number }): Promise<LibraryHomeResponse>;

	getShelfPage(input: {
		genre: GenreSlug;
		cursor?: ShelfCursor;
		limit?: number;
	}): Promise<ShelfPageResponse>;

	getGenreView(input: {
		genre: GenreSlug;
		sortField: GenreSortField;
		direction: SortDirection;
		limit?: number;
		offset?: number;
	}): Promise<GenreViewResponse>;

	getBookDetail(bookId: string): Promise<BookDetailResponse>;

	removeBook(bookId: string): Promise<BookRemovalResult>;

	changeGenre(input: ChangeBookGenreInput): Promise<{
		book: BookSummary;
		reviewScoresReset: boolean;
	}>;

	changeFormat(input: ChangeBookFormatInput): Promise<BookSummary>;
}

export interface QueueRepository {
	add(bookId: string, options?: { force?: boolean }): Promise<QueueAddResponse>;
	remove(bookId: string): Promise<QueueBook[]>;
	move(input: QueueMoveInput): Promise<QueueBook[]>;
}

export interface ReadingRepository {
	start(input: StartReadingInput): Promise<ReadingMutationResult>;

	pause(readingId: string): Promise<ReadingMutationResult>;
	resume(readingId: string): Promise<ReadingMutationResult>;

	recordProgress(input: RecordProgressInput): Promise<ReadingMutationResult>;

	correctProgress(input: RecordProgressInput): Promise<ReadingMutationResult>;

	finish(input: FinishReadingInput): Promise<ReadingMutationResult>;

	markDnf(input: MarkDnfInput): Promise<ReadingMutationResult>;

	addCompletedReading(input: AddCompletedReadingInput): Promise<ReadingMutationResult>;
}

export interface ReviewRepository {
	save(input: SaveReviewInput): Promise<ReviewSaveResult>;
	/** Tag e dimensioni di rating attivi (con gli id dei tag, necessari a `save`). */
	getReference(): Promise<ReviewReferenceResponse>;
}

export interface QuotesRepository {
	add(input: AddQuoteInput): Promise<Quote>;
	update(input: UpdateQuoteInput): Promise<Quote>;
	remove(quoteId: string): Promise<void>;
}

export interface ExploreRepository {
	getPool(input?: { genres?: GenreSlug[] }): Promise<BookSummary[]>;
}

export interface StatsRepository {
	getCalendar(year: number): Promise<ReadingCalendarResponse>;
	getYearStats(year: number): Promise<YearStatsResponse>;
	getYearDnfCount(year: number): Promise<YearDnfCountResponse>;
	getDashboard(year: number): Promise<StatsDashboardResponse>;
}

export interface BingoRepository {
	getBoard(year: number): Promise<BingoBoard>;
	assignBook(input: { cellId: string; bookId: string | null }): Promise<BingoBoard>;
	listBoards(): Promise<BingoBoardListResponse>;
	/** Crea la card dell'anno con le 16 sfide di default (CONFLICT se esiste già). */
	createBoard(year: number): Promise<BingoBoard>;
	updateBoard(input: { year: number; title: string; challenges: string[] }): Promise<BingoBoard>;
	deleteBoard(year: number): Promise<void>;
}

/** Letture di Statistiche non coperte da StatsRepository: elenco citazioni e ripartizione generi. */
export interface StatsExtrasRepository {
	listQuotes(input?: {
		bookId?: string;
		limit?: number;
		offset?: number;
	}): Promise<QuoteListResponse>;
	getGenreBreakdown(year: number): Promise<YearGenreBreakdownResponse>;
	/** Libri con almeno una lettura completata, con ricerca opzionale su titolo/autore. */
	listCompletedBooks(input?: { query?: string; limit?: number }): Promise<CompletedBooksResponse>;
}

export interface CatalogRepository {
	search(input: BookSearchRequest): Promise<BookSearchResponse>;
	lookupIsbn(input: IsbnLookupRequest): Promise<BookSearchResponse>;
}

export interface ThemeRepository {
	getSelection(): Promise<ThemeSelection>;
	setSelection(input: SetThemeInput): Promise<ThemeSelection>;

	listBuiltins(): Promise<ThemeDefinition[]>;
	listCustom(): Promise<ThemeDefinition[]>;

	saveCustom(theme: ThemeDefinition): Promise<ThemeDefinition>;
	deleteCustom(themeId: string): Promise<void>;
}

/** Impostazioni account (nome, scaffali, movimento) e export dati (privacy, spec §41). */
export interface SettingsRepository {
	get(): Promise<UserSettings>;
	update(input: UpdateSettingsInput): Promise<UserSettings>;
	exportData(): Promise<UserExport>;
	getGenreShelves(): Promise<UserGenreShelvesResponse>;
	updateGenreShelves(input: UpdateUserGenreShelvesInput): Promise<UserGenreShelvesResponse>;
}

export interface FriendshipsRepository {
	getAll(): Promise<FriendshipsResponse>;
	createInvite(): Promise<CreateFriendInviteResponse>;
	redeemInvite(input: RedeemFriendInviteInput): Promise<RedeemFriendInviteResponse>;
	remove(input: DeleteFriendshipInput): Promise<void>;
	setLibraryVisibility(
		input: SetFriendLibraryVisibilityInput
	): Promise<FriendLibraryVisibilityResponse>;
	getPrivacy(): Promise<FriendPrivacy>;
	setVisibility(input: Partial<Omit<FriendPrivacy, 'contractVersion'>>): Promise<FriendPrivacy>;
	getProfile(friendId: string): Promise<FriendProfile>;
}

export interface SegnalibroRepositories {
	performance: import('./performance-repository').RpcPerformanceRepository;
	settings: SettingsRepository;
	friendships: FriendshipsRepository;
	library: LibraryRepository;
	queue: QueueRepository;
	reading: ReadingRepository;
	review: ReviewRepository;
	quotes: QuotesRepository;
	explore: ExploreRepository;
	stats: StatsRepository;
	bingo: BingoRepository;
	statsExtras: StatsExtrasRepository;
	catalog: CatalogRepository;
	themes: ThemeRepository;
}
