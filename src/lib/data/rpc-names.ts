/**
 * Un'unica source of truth per i nomi delle RPC.
 * I componenti non devono conoscere questi nomi.
 */
export const RPC = {
	profileSummary: 'get_profile_summary',
	profileDnf: 'get_profile_dnf',
	queueSummary: 'get_queue_summary',
	discoveryContext: 'get_discovery_context',
	quotesPage: 'get_quotes_page',
	genrePages: 'get_genre_pages',
	libraryHome: 'get_library_home',
	shelfPage: 'get_shelf_page',
	genreView: 'get_genre_view',
	bookDetail: 'get_book_detail',
	removeBook: 'remove_book',

	explorePool: 'get_explore_pool',

	readingCalendar: 'get_reading_calendar',
	yearStats: 'get_year_stats',
	yearDnfCount: 'get_year_dnf_count',
	statsDashboard: 'get_stats_dashboard',

	bingoBoard: 'get_bingo_board',
	bingoAssignBook: 'assign_bingo_book',
	bingoListBoards: 'list_bingo_boards',
	bingoCreateBoard: 'create_bingo_board',
	bingoUpdateBoard: 'update_bingo_board',
	bingoDeleteBoard: 'delete_bingo_board',

	listQuotes: 'list_quotes',
	listCompletedBooks: 'list_completed_books',
	yearGenreBreakdown: 'get_year_genre_breakdown',

	queueAdd: 'queue_add',
	queueRemove: 'queue_remove',
	queueMove: 'queue_move',

	startReading: 'start_reading',
	pauseReading: 'pause_reading',
	resumeReading: 'resume_reading',
	recordProgress: 'record_progress',
	correctProgress: 'correct_progress',
	finishReading: 'finish_reading',
	markDnf: 'mark_dnf',
	addCompletedReading: 'add_completed_reading',

	changeBookGenre: 'change_book_genre',
	changeBookFormat: 'change_book_format',
	changeBookSeries: 'change_book_series',
	saveReview: 'save_review',
	reviewReference: 'get_review_reference',
	addQuote: 'add_quote',
	updateQuote: 'update_quote',
	deleteQuote: 'delete_quote',

	getThemeSelection: 'get_theme_selection',
	setThemeSelection: 'set_theme_selection',

	getUserSettings: 'get_user_settings',
	updateUserSettings: 'update_user_settings',
	listCustomThemes: 'list_custom_themes',
	saveCustomTheme: 'save_custom_theme',
	deleteCustomTheme: 'delete_custom_theme',
	exportUserData: 'export_user_data',
	getUserGenreShelves: 'get_user_genre_shelves',
	updateUserGenreShelves: 'update_user_genre_shelves',

	getFriendships: 'get_friendships',
	createFriendInvite: 'create_friend_invite',
	redeemFriendInvite: 'redeem_friend_invite',
	deleteFriendship: 'delete_friendship',
	setFriendLibraryVisibility: 'set_friend_library_visibility',
	getFriendPrivacy: 'get_friend_privacy',
	setFriendVisibility: 'set_friend_visibility',
	getFriendProfile: 'get_friend_profile'
} as const;

export type RpcName = (typeof RPC)[keyof typeof RPC];
