<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { BookSummary } from '$lib/contracts';
	import type { DecorationKind } from '$lib/book/shelf-layout';
	import { bookStatus } from '$lib/book/palette';
	import BookCover from '$lib/components/book/BookCover.svelte';
	import Decoration from '$lib/components/library/Decoration.svelte';
	import RatingStars from '$lib/components/ui/RatingStars.svelte';

	interface Props {
		title: string;
		books: BookSummary[];
		count: number;
		caption: string;
		/** Id dei libri nella coda "I prossimi" (badge "Prossimo"). */
		queuedIds: ReadonlySet<string>;
		emptyText: string;
		/** I primi libri della pagina sono above the fold: caricamento immediato. */
		priorityCount?: number;
		/** Oggetti in fondo all'ultima mensola (il secondo solo su schermi larghi). */
		decor?: readonly DecorationKind[];
		/** Griglia con mensole (default) oppure elenco compatto. */
		view?: 'grid' | 'list';
		/** Per i libri ancora da leggere il voto non ha senso. */
		showRating?: boolean;
		/** Controlli (ordine, vista) sotto l'intestazione. */
		controls?: Snippet;
	}

	const FORMAT_LABELS = { physical: 'Cartaceo', digital: 'Digitale', both: 'Entrambi' } as const;

	let {
		title,
		books,
		count,
		caption,
		queuedIds,
		emptyText,
		priorityCount = 0,
		decor = [],
		view = 'grid',
		showRating = true,
		controls
	}: Props = $props();

	const headingId = $props.id();
	// Su mobile (3 colonne) gli oggetti compaiono solo se c'e' posto nell'ultima mensola.
	const freeOnMobile = $derived((3 - (books.length % 3)) % 3);
</script>

<section class="section" aria-labelledby={headingId}>
	<div class="head">
		<span class="dot" aria-hidden="true"></span>
		<h2 id={headingId}>
			{title}
			<span class="count" aria-label="{count} {count === 1 ? 'libro' : 'libri'}">{count}</span>
		</h2>
		<span class="caption">{caption}</span>
	</div>

	{#if controls}<div class="controls">{@render controls()}</div>{/if}

	{#if books.length === 0}
		<p class="empty">{emptyText}</p>
	{:else if view === 'list'}
		<ul class="rows" role="list">
			{#each books as book, index (book.id)}
				<li>
					<a class="row" href="/book/{book.id}" data-book-id={book.id}>
						<BookCover {book} size="xs" priority={index < priorityCount} />
						<span class="row-text">
							<span class="title">{book.title}</span>
							<span class="meta">{book.author}</span>
							<span class="row-info">
								{#if queuedIds.has(book.id)}<span class="tag strong">Prossimo</span>{/if}
								<span class="tag">{FORMAT_LABELS[book.format]}</span>
								{#if book.pageCount}<span>{book.pageCount} pag.</span>{/if}
								{#if showRating && book.reviewRating}
									<span class="stars-inline">
										<RatingStars value={book.reviewRating} size={13} />
									</span>
								{/if}
							</span>
						</span>
					</a>
				</li>
			{/each}
		</ul>
	{:else}
		<div class="shelf">
			<ul class="grid" role="list">
				{#each books as book, index (book.id)}
					<li class="cell">
						<a class="book" href="/book/{book.id}" data-book-id={book.id}>
							<span class="lift">
								<BookCover
									{book}
									size="fluid"
									badge={bookStatus(book, queuedIds.has(book.id))}
									showFormat
									priority={index < priorityCount}
								/>
							</span>
							<span class="text">
								<span class="title">{book.title}</span>
								<span class="meta">{book.author}</span>
								{#if book.pageCount}<span class="meta">{book.pageCount} pag.</span>{/if}
								{#if showRating && book.reviewRating}
									<span class="stars"><RatingStars value={book.reviewRating} size={13} /></span>
								{/if}
							</span>
						</a>
					</li>
				{/each}
				{#each decor as kind, index (index)}
					<li class="cell deco" class:wide-only={index >= freeOnMobile} aria-hidden="true">
						<span class="niche"><Decoration {kind} /></span>
					</li>
				{/each}
			</ul>
		</div>
	{/if}
</section>

<style>
	/* Card come gli scaffali della Libreria */
	.section {
		box-sizing: border-box;
		padding: 14px 0 6px;
		border-radius: var(--radius-sheet);
		background:
			radial-gradient(
				ellipse 70% 60% at 50% 100%,
				color-mix(in srgb, var(--color-surface-elevated) 60%, transparent),
				transparent 70%
			),
			color-mix(in srgb, var(--color-surface-elevated) 55%, var(--color-background-shelf));
		box-shadow:
			0 0 0 1px color-mix(in srgb, var(--color-border) 18%, transparent),
			0 10px 30px -18px color-mix(in srgb, var(--color-shadow) 25%, transparent);
		color: var(--color-text-primary);
	}

	.head {
		display: flex;
		align-items: center;
		gap: 10px;
		min-height: 44px;
		padding: 0 18px 0 20px;
	}

	.dot {
		flex: none;
		width: 14px;
		height: 14px;
		border-radius: 50%;
		background: var(--genre-current);
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--genre-current) 18%, transparent);
	}

	h2 {
		display: flex;
		align-items: center;
		gap: 10px;
		margin: 0;
		color: var(--color-text-primary);
		font-family: var(--font-display);
		font-size: 21px;
		font-weight: 400;
		line-height: 1.15;
	}

	.count {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 28px;
		height: 28px;
		padding: 0 10px;
		box-sizing: border-box;
		border-radius: var(--radius-pill);
		background: color-mix(in srgb, var(--color-surface-elevated) 85%, transparent);
		box-shadow: 0 1px 0 color-mix(in srgb, var(--color-border) 30%, transparent);
		color: var(--color-text-primary);
		font-family: var(--font-ui);
		font-size: 12.5px;
		font-weight: 700;
	}

	.caption {
		margin-left: auto;
		color: var(--color-text-secondary);
		font-size: 12.5px;
		text-align: right;
	}

	.controls {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px 12px;
		padding: 4px 20px 6px;
	}

	.rows {
		display: flex;
		flex-direction: column;
		margin: 6px 0 0;
		padding: 0 12px 10px;
		list-style: none;
	}

	.row {
		display: flex;
		align-items: center;
		gap: 14px;
		min-height: 56px;
		padding: 8px;
		border-radius: var(--radius-md);
		color: inherit;
		text-decoration: none;
	}

	.row:hover {
		background: color-mix(in srgb, var(--color-surface) 70%, transparent);
	}

	.row:focus-visible {
		outline: 2px solid var(--color-primary);
		outline-offset: 2px;
	}

	.row-text {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}

	.row-info {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 4px 8px;
		margin-top: 4px;
		color: var(--color-text-secondary);
		font-size: 12px;
	}

	.tag {
		padding: 1px 8px;
		border-radius: var(--radius-pill);
		background: var(--color-surface);
		font-weight: 600;
	}

	.tag.strong {
		background: var(--genre-current);
		color: var(--genre-current-on, var(--color-on-primary));
	}

	.stars-inline {
		line-height: 0;
	}

	.empty {
		margin: 0;
		padding: 6px 20px 14px;
		color: var(--color-text-secondary);
		font-size: 14px;
		line-height: 20px;
	}

	/*
	 * Scaffali: la griglia ha un passo fisso (copertina + testo), quindi ogni riga riceve la sua
	 * mensola 3D come livelli di sfondo ripetuti (ombra sul muro, piano, bordo frontale, ombra portata),
	 * corretti per qualunque numero di colonne. La copertina e' fluida (34:50).
	 */
	.shelf {
		container-type: inline-size;
		--pad: 18px;
		--gap: 14px;
		--col: calc((100cqw - 2 * var(--pad) - 2 * var(--gap)) / 3);
		margin: 10px -6px 0;
	}

	.grid {
		--top: 16px;
		--cover-h: calc(var(--col) * 50 / 34);
		--line: calc(var(--top) + var(--cover-h));
		--pitch: calc(var(--cover-h) + 138px);
		isolation: isolate;
		display: grid;
		grid-template-columns: repeat(3, var(--col));
		grid-auto-rows: var(--pitch);
		gap: 0 var(--gap);
		align-items: start;
		margin: 0;
		padding: 0 calc(var(--pad) + 6px);
		list-style: none;
		background:
			/* ombra di contatto sul muro */
			linear-gradient(
				to bottom,
				transparent calc(var(--line) - 44px),
				color-mix(in srgb, var(--color-wood-ink) 11%, transparent) calc(var(--line) - 8px),
				transparent calc(var(--line) - 8px)
			),
			/* piano superiore, su cui poggiano le copertine */
			linear-gradient(
					to bottom,
					transparent calc(var(--line) - 8px),
					color-mix(in srgb, var(--color-wood-detail-mid) 80%, var(--color-wood-ink))
						calc(var(--line) - 8px),
					var(--color-wood-detail-top) calc(var(--line) + 2px),
					transparent calc(var(--line) + 2px)
				),
			/* bordo frontale con filo di luce */
			linear-gradient(
					to bottom,
					transparent calc(var(--line) + 2px),
					color-mix(in srgb, var(--color-on-genre-white) 60%, var(--color-wood-detail-top))
						calc(var(--line) + 2px),
					var(--color-wood-detail-top) calc(var(--line) + 4px),
					var(--color-wood-detail-mid) calc(var(--line) + 12px),
					var(--color-wood-detail-bottom) calc(var(--line) + 19px),
					color-mix(in srgb, var(--color-wood-detail-bottom) 75%, var(--color-wood-ink))
						calc(var(--line) + 19px),
					color-mix(in srgb, var(--color-wood-detail-bottom) 75%, var(--color-wood-ink))
						calc(var(--line) + 21px),
					transparent calc(var(--line) + 21px)
				),
			/* ombra portata sotto la mensola */
			linear-gradient(
					to bottom,
					transparent calc(var(--line) + 21px),
					color-mix(in srgb, var(--color-wood-ink) 20%, transparent) calc(var(--line) + 21px),
					transparent calc(var(--line) + 36px)
				);
		background-size: 100% var(--pitch);
		background-repeat: repeat-y;
	}

	.cell {
		position: relative;
		z-index: 1;
		min-width: 0;
		padding-top: var(--top);
	}

	.book {
		display: block;
		min-width: 0;
		border-radius: 3px 8px 8px 3px;
		color: inherit;
		text-decoration: none;
	}

	.book:focus-visible {
		outline: 2px solid var(--color-primary);
		outline-offset: 4px;
	}

	.lift {
		display: block;
		transition: transform var(--duration-fast) var(--ease-out);
	}

	@media (hover: hover) {
		.book:hover .lift {
			transform: translateY(-8px);
		}
	}

	.text {
		display: block;
		margin-top: 32px;
	}

	.title {
		display: block;
		overflow: hidden;
		color: var(--color-text-primary);
		font-size: 13px;
		font-weight: 700;
		line-height: 16px;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.meta {
		display: block;
		margin-top: 1px;
		overflow: hidden;
		color: var(--color-text-secondary);
		font-size: 12px;
		line-height: 15px;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.stars {
		display: block;
		height: 14px;
		margin-top: 4px;
		line-height: 0;
	}

	/* Oggetti in fondo all'ultima mensola, in una nicchia ad arco */
	.deco {
		z-index: 0;
		display: flex;
		align-items: flex-end;
		justify-content: center;
		box-sizing: border-box;
		height: var(--line);
	}

	.niche {
		position: relative;
		display: flex;
		align-items: flex-end;
		justify-content: center;
		width: 100%;
		height: 88%;
	}

	.niche::before {
		content: '';
		position: absolute;
		z-index: -1;
		bottom: 0;
		left: 50%;
		width: min(100%, 124px);
		height: 100%;
		border-radius: 62px 62px 0 0;
		background: linear-gradient(
			180deg,
			color-mix(in srgb, var(--color-surface) 70%, transparent),
			color-mix(in srgb, var(--color-surface) 35%, transparent)
		);
		transform: translateX(-50%);
	}

	.wide-only {
		display: none;
	}

	@media (min-width: 768px) {
		.shelf {
			--pad: 22px;
			--gap: 26px;
			--col: 128px;
		}

		.grid {
			grid-template-columns: repeat(auto-fill, var(--col));
			justify-content: start;
		}

		.wide-only {
			display: flex;
		}
	}

	@media (min-width: 1024px) {
		.head {
			padding: 0 24px;
		}

		h2 {
			font-size: 23px;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.lift {
			transition: none;
		}
	}
</style>
