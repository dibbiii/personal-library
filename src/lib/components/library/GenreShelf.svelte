<script lang="ts">
	import { draggable } from '$lib/actions/drag';
	import BookCover from '$lib/components/book/BookCover.svelte';
	import BookSpine from '$lib/components/book/BookSpine.svelte';
	import { layoutShelf, type DecorationKind } from '$lib/book/shelf-layout';
	import { bookStatus } from '$lib/book/palette';
	import { spineHeight } from '$lib/book/binding';
	import { getThemeController } from '$lib/themes/controller.svelte';
	import { GENRE_LABELS } from '$lib/genres';
	import { buildAddHref } from '$lib/catalog/add-context';
	import Icon from '$lib/components/ui/Icon.svelte';
	import Decoration from './Decoration.svelte';
	import ShelfFrame from './ShelfFrame.svelte';
	import type { HomeState, ShelfState } from './home-state.svelte';
	import type { HomeDnd } from './home-dnd.svelte';
	import type { LibraryView } from './library-filter';
	import { hoverPreview, type HoverPreview } from './hover-preview.svelte';
	import type { BookSummary, GenreSlug } from '$lib/contracts';

	interface Props {
		shelf: ShelfState;
		home: HomeState;
		dnd: HomeDnd;
		/** Libri da mostrare (filtrati/ordinati); di default quelli dello scaffale, con paginazione. */
		books?: BookSummary[] | undefined;
		/** Changes only with the active filter/order, not as more data arrives. */
		filterKey?: string;
		view?: LibraryView;
		preview: HoverPreview;
	}

	let { shelf, home, dnd, books, filterKey = '', view = 'grid', preview }: Props = $props();

	const PAGE_SIZE = 24;
	let visibleLimit = $state(PAGE_SIZE);
	const available = $derived(books ?? shelf.books);
	const shown = $derived(available.slice(0, visibleLimit));
	const paginate = $derived(
		available.length > visibleLimit || (books === undefined && shelf.hasMore)
	);
	$effect(() => {
		void filterKey;
		void view;
		visibleLimit = PAGE_SIZE;
	});

	async function showMore() {
		if (visibleLimit >= available.length && books === undefined) await home.loadMore(slug);
		visibleLimit = Math.min(visibleLimit + PAGE_SIZE, available.length);
	}
	const count = $derived(books ? books.length : shelf.totalCount);
	const pill = $derived(`${count} ${count === 1 ? 'libro' : 'libri'}`);

	const FORMAT_LABELS = { physical: 'Cartaceo', digital: 'Digitale', both: 'Entrambi' } as const;
	/** Oggetti a tema ai due capi dello scaffale (mockup: busto e pianta a sinistra, vaso a destra). */
	const SHELF_ENDS: Record<GenreSlug, readonly [DecorationKind, DecorationKind]> = {
		classics: ['globe', 'fern'],
		'mythology-epic-retelling': ['bust', 'vase'],
		'dystopia-scifi': ['succulent', 'hourglass'],
		'thriller-mystery': ['hourglass', 'lantern'],
		'fantasy-magical-gothic': ['lantern', 'trailing'],
		'romance-ya-na': ['trailing', 'figurine'],
		'contemporary-historical': ['cactus', 'bookends'],
		essays: ['globe', 'fern']
	};

	const theme = getThemeController();
	const slug = $derived(shelf.genre.slug);
	const ends = $derived(SHELF_ENDS[slug]);
	const items = $derived(
		layoutShelf({
			books: shown,
			genre: slug,
			queuedIds: home.queuedIds,
			themeKey: theme?.key
		})
	);

	let scroller = $state<HTMLElement | null>(null);
	let sentinel = $state<HTMLElement | null>(null);

	// Paginazione keyset: quando la coda dello scaffale entra in vista, carica altri libri.
	$effect(() => {
		void available.length;
		void visibleLimit;
		if (view !== 'grid' || !paginate || !scroller || !sentinel || shelf.loading || shelf.failed)
			return;
		const observer = new IntersectionObserver(
			(entries) => {
				if (entries.some((entry) => entry.isIntersecting)) void showMore();
			},
			{ root: scroller, rootMargin: '0px 320px 0px 320px' }
		);
		observer.observe(sentinel);
		return () => observer.disconnect();
	});
</script>

<ShelfFrame
	title={GENRE_LABELS[slug]}
	href="/genre/{slug}"
	accent="var(--genre-{slug})"
	genre={slug}
	{pill}
	height={184}
	list={view === 'list'}
	target={dnd.hover === `genre:${slug}`}
	zone={dnd.genreZone(slug)}
	label="Scaffale {GENRE_LABELS[slug]}, {shelf.totalCount} {shelf.totalCount === 1
		? 'libro'
		: 'libri'}"
	bind:scroller
>
	{#if view === 'list'}
		<ul class="rows">
			{#each shown as book (book.id)}
				{@const status = bookStatus(book, home.queuedIds.has(book.id))}
				<li
					class="row-item"
					class:source={dnd.draggingId === book.id}
					use:draggable={dnd.source({ kind: 'shelf-book', book })}
					use:hoverPreview={{ preview, book }}
				>
					<a class="row-link" href="/book/{book.id}" aria-label="{book.title}, di {book.author}">
						<BookCover {book} size="xs" />
						<span class="meta">
							<span class="row-title">{book.title}</span>
							<span class="row-author">{book.author}</span>
							<span class="row-info">
								{#if status === 'reading'}<span class="tag strong">In lettura</span>
								{:else if status === 'next'}<span class="tag strong">Prossimo</span>{/if}
								<span class="tag">{FORMAT_LABELS[book.format]}</span>
								{#if book.pageCount}<span>{book.pageCount} pagine</span>{/if}
								{#if book.reviewRating}
									<span class="stars" aria-label="Voto {book.reviewRating} su 5">
										★ {book.reviewRating.toLocaleString('it-IT')}
									</span>
								{/if}
							</span>
						</span>
					</a>
				</li>
			{:else}
				<li class="none">Nessun libro in questo scaffale.</li>
			{/each}
		</ul>
	{:else}
		{#if items.length > 0}
			<div class="niche start"><Decoration kind={ends[0]} /></div>
		{/if}
		{#each items as item (item.key)}
			{#if item.kind === 'deco'}
				<Decoration kind={item.deco} />
			{:else}
				<div
					class="item"
					class:source={dnd.draggingId === item.book.id}
					class:cover={item.kind === 'cover'}
					class:previewed={preview.book?.id === item.book.id}
					style:--pw={item.kind === 'spine' ? `${item.spec.spine.width}px` : '84px'}
					style:--ph={item.kind === 'spine' ? `${spineHeight(item.spec)}px` : '124px'}
					use:draggable={dnd.source({ kind: 'shelf-book', book: item.book })}
					use:hoverPreview={{ preview, book: item.book }}
				>
					{#if item.kind === 'spine'}
						<BookSpine
							book={item.book}
							spec={item.spec}
							badge={item.status}
							lean={item.lean}
							href="/book/{item.book.id}"
						/>
					{:else}
						<a
							class="cover-link"
							href="/book/{item.book.id}"
							aria-label="{item.book.title}, di {item.book.author}"
						>
							<BookCover
								book={item.book}
								size="md"
								badge={item.status}
								showFormat
								noImage={item.noImage}
							/>
						</a>
					{/if}
				</div>
			{/if}
		{:else}
			<a
				class="empty"
				href={buildAddHref('/add', slug)}
				aria-label="Aggiungi un libro a {GENRE_LABELS[slug]}, scaffale vuoto"
			>
				<Icon name="book-plus" size={22} strokeWidth={2} />
				<span>Scaffale<br />vuoto</span>
			</a>
			<Decoration kind={ends[0]} />
		{/each}
		<!-- Angolo decorativo in fondo allo scaffale: con spazio libero va a destra. -->
		<div class="niche end"><Decoration kind={ends[1]} /></div>
	{/if}

	{#if paginate}
		<div class="sentinel" class:list-more={view === 'list'} bind:this={sentinel}>
			{#if shelf.failed}
				<button type="button" onclick={showMore}>Riprova</button>
			{:else if shelf.loading && visibleLimit >= available.length}
				<span class="loading" role="status" aria-label="Carico altri libri"></span>
			{:else}
				<button
					type="button"
					onclick={showMore}
					aria-label="Mostra altri libri: {GENRE_LABELS[slug]}">Mostra altri</button
				>
			{/if}
		</div>
	{/if}
</ShelfFrame>

<style>
	.rows {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(min(100%, 300px), 1fr));
		gap: 8px;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.row-item {
		position: relative;
		min-width: 0;
		touch-action: pan-y;
		-webkit-touch-callout: none;
		user-select: none;
	}

	.row-item.source {
		opacity: 0.4;
	}

	.row-link {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 8px 10px;
		border-radius: var(--radius-md);
		background: color-mix(in srgb, var(--color-surface-elevated) 80%, transparent);
		color: var(--color-text-primary);
		text-decoration: none;
		transition: background-color var(--duration-fast) var(--ease-out);
	}

	.row-link:hover {
		background: var(--color-surface-elevated);
	}

	.row-link:focus-visible {
		outline: 2px solid var(--color-primary);
		outline-offset: 2px;
	}

	.meta {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}

	.row-title,
	.row-author {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.row-title {
		font-size: 14px;
		font-weight: 700;
		line-height: 18px;
	}

	.row-author {
		color: var(--color-text-secondary);
		font-size: 12.5px;
		line-height: 16px;
	}

	.row-info {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 4px 8px;
		margin-top: 3px;
		color: var(--color-text-muted);
		font-size: 11.5px;
		line-height: 16px;
	}

	.tag {
		padding: 0 7px;
		border-radius: var(--radius-pill);
		background: var(--color-surface);
		color: var(--color-text-secondary);
		font-weight: 600;
	}

	.tag.strong {
		background: var(--color-primary);
		color: var(--color-on-primary);
	}

	.stars {
		color: var(--g-dark);
		letter-spacing: 1px;
	}

	.none {
		color: var(--color-text-secondary);
		font-size: 13px;
	}

	.niche {
		position: relative;
		display: flex;
		flex: none;
		align-items: flex-end;
		align-self: stretch;
	}

	.niche.start {
		padding-right: 6px;
	}

	.niche.end {
		margin-left: auto;
		padding: 0 4px 0 24px;
	}

	/* Nicchia ad arco dietro l'oggetto, come nel mockup */
	.niche::before {
		content: '';
		position: absolute;
		z-index: -1;
		bottom: 0;
		width: 124px;
		height: 84%;
		border-radius: 62px 62px 0 0;
		background: linear-gradient(
			180deg,
			color-mix(in srgb, var(--color-surface) 70%, transparent),
			color-mix(in srgb, var(--color-surface) 35%, transparent)
		);
	}

	.niche.start::before {
		left: -10px;
	}

	.niche.end::before {
		right: -6px;
	}

	.item {
		position: relative;
		z-index: 1;
		display: flex;
		flex: none;
		touch-action: pan-x pan-y;
		-webkit-touch-callout: none;
		user-select: none;
	}

	.item.cover {
		margin: 0 8px;
	}

	/* Il libro in anteprima si solleva dallo scaffale */
	.item {
		transition: transform var(--duration-fast) var(--ease-out);
	}

	.item.cover:hover,
	.item.previewed {
		z-index: 2;
		transform: translateY(-6px);
	}

	.item.previewed :global(.spine),
	.item.previewed :global(.cover) {
		box-shadow:
			0 12px 18px -8px color-mix(in srgb, var(--color-shadow) 45%, transparent),
			0 0 0 2px color-mix(in srgb, var(--color-primary) 35%, transparent);
	}

	@media (prefers-reduced-motion: reduce) {
		.item {
			transition: none;
		}
	}

	.cover-link {
		display: block;
		border-radius: 3px 8px 8px 3px;
		color: inherit;
		text-decoration: none;
		-webkit-touch-callout: none;
	}

	/* Origine del drag: il libro sparisce e resta il segnaposto tratteggiato della stessa misura */
	.item.source > :global(*) {
		visibility: hidden;
	}

	.item.source::after {
		content: '';
		position: absolute;
		inset: 0;
		box-sizing: border-box;
		width: var(--pw);
		height: var(--ph);
		border: 2px dashed color-mix(in srgb, var(--g-dark) 55%, transparent);
		border-radius: 3px;
		background: color-mix(in srgb, var(--g) 14%, transparent);
	}

	.empty {
		position: relative;
		z-index: 1;
		display: flex;
		flex: none;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 4px;
		box-sizing: border-box;
		width: 72px;
		height: 108px;
		margin: 0 8px;
		border: 2px dashed color-mix(in srgb, var(--color-divider) 70%, transparent);
		border-radius: 8px;
		background: color-mix(in srgb, var(--color-divider) 10%, transparent);
		color: var(--color-text-secondary);
		font-size: 11px;
		font-weight: 600;
		line-height: 13px;
		text-align: center;
		text-decoration: none;
	}

	.empty:focus-visible {
		outline: 2px solid var(--color-primary);
		outline-offset: 3px;
	}

	.sentinel {
		position: relative;
		z-index: 1;
		display: flex;
		flex: none;
		align-items: center;
		justify-content: center;
		align-self: center;
		width: 48px;
		height: 48px;
	}

	.sentinel button {
		min-height: var(--tap-size);
		min-width: var(--tap-size);
		padding: 6px 10px;
		border: 0;
		border-radius: 999px;
		background: var(--color-surface);
		font-size: 12px;
		font-weight: 700;
	}

	.sentinel.list-more {
		width: auto;
		margin-top: 12px;
	}

	.loading {
		width: 18px;
		height: 18px;
		box-sizing: border-box;
		border: 2px solid color-mix(in srgb, var(--g) 35%, transparent);
		border-top-color: var(--g);
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
</style>
