<script lang="ts">
	import BookCover from '$lib/components/book/BookCover.svelte';
	import { FORMAT_ICONS, FORMAT_LABELS } from '$lib/book/format';
	import { bingoRemaining, countLabel, formatNumber, plural } from '$lib/components/stats/format';
	import QuoteListItem from '$lib/components/stats/QuoteListItem.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import RatingStars from '$lib/components/ui/RatingStars.svelte';
	import type {
		BingoBoardListItem,
		BookSummary,
		QuotePreview,
		ReadingCalendarDay,
		YearStats
	} from '$lib/contracts';
	import {
		pagesByMonth,
		percentOf,
		readingDaysByMonth,
		weekdayMonthMatrix,
		type LibraryCounts
	} from '$lib/profile/overview';
	import ActivityList from './ActivityList.svelte';
	import MonthBars from './MonthBars.svelte';
	import ProfileCard from './ProfileCard.svelte';
	import ReadingHeatmap from './ReadingHeatmap.svelte';
	import ShareBars from './ShareBars.svelte';
	import type { ProfileSummary } from '$lib/contracts/performance';

	interface Props {
		year: number;
		isCurrentYear: boolean;
		stats: YearStats;
		bingo: BingoBoardListItem | null;
		calendar: ReadingCalendarDay[];
		summary: ProfileSummary;
		counts: LibraryCounts;
		quotes: QuotePreview[];
		/** Indirizzo di una scheda del profilo (mantiene l'anno). */
		tabHref: (tab: string) => string;
	}

	let { year, stats, bingo, calendar, summary, counts, quotes, tabHref }: Props = $props();

	const RING = 2 * Math.PI * 52;
	const completed = $derived(bingo?.completedCount ?? 0);
	const favorites = $derived(summary.favorites);
	const activity = $derived(summary.activity);

	const formatTotal = $derived(counts.physical + counts.digital + counts.both);
	const formats = $derived(
		(['physical', 'digital', 'both'] as const).map((key) => ({
			key,
			label: FORMAT_LABELS[key],
			icon: FORMAT_ICONS[key],
			percent: percentOf(counts[key], formatTotal),
			color: 'var(--color-primary)',
			title: countLabel(counts[key], 'libro', 'libri')
		}))
	);

	interface Collection {
		key: string;
		label: string;
		sub: string;
		href: string;
		icon: 'bookmark' | 'book-open' | 'quote' | 'flower';
		books: BookSummary[];
	}

	const collections = $derived<Collection[]>([
		{
			key: 'queue',
			label: 'In coda',
			sub: countLabel(summary.queueCount, 'libro', 'libri'),
			href: '/library',
			icon: 'bookmark',
			books: summary.queue
		},
		{
			key: 'reading',
			label: 'In lettura',
			sub: countLabel(counts.reading, 'libro', 'libri'),
			href: '/library',
			icon: 'book-open',
			books: summary.reading
		},
		{
			key: 'quotes',
			label: 'Citazioni',
			sub: countLabel(summary.quoteCount, 'citazione', 'citazioni'),
			href: '/quotes',
			icon: 'quote',
			books: []
		},
		{
			key: 'dnf',
			label: 'Abbandonati',
			sub: countLabel(summary.dnfCount, 'libro', 'libri'),
			href: tabHref('dnf'),
			icon: 'flower',
			books: summary.dnf.map((entry) => entry.book)
		}
	]);
</script>

<div class="overview" data-testid="profile-overview">
	<ProfileCard icon="bingo-sparkle" title="Bookish Bingo {year}" class="c-bingo">
		<div class="bingo">
			<svg class="progress-ring" viewBox="0 0 120 120" aria-hidden="true">
				<circle class="ring-track" cx="60" cy="60" r="52" />
				<circle
					class="ring-fill"
					cx="60"
					cy="60"
					r="52"
					transform="rotate(-90 60 60)"
					stroke-dasharray={RING}
					stroke-dashoffset={RING * (1 - completed / 16)}
				/>
			</svg>
			<span class="ring-icon"><Icon name="trophy" size={30} strokeWidth={1.8} /></span>
			<div class="bingo-text">
				<p class="big"><strong>{completed}</strong> / 16</p>
				<p class="sub">caselle completate</p>
				<p class="pct">{percentOf(completed, 16)}%</p>
			</div>
			<div class="bingo-side">
				<p>{bingo ? bingoRemaining(completed) : `Nessuna card per il ${year}.`}</p>
				<a class="ghost-link" href="/bingo/{year}">{bingo ? 'Apri la card' : 'Crea la card'}</a>
			</div>
		</div>
	</ProfileCard>

	<ProfileCard icon="globe" title="Libri letti in inglese" class="c-language">
		<p class="hero-num">{formatNumber(counts.englishRead)}</p>
		<p class="sub">{countLabel(counts.englishRead, 'libro completato', 'libri completati')}</p>
	</ProfileCard>

	<ProfileCard icon="flower" title="Libri non finiti" class="c-dnf">
		<p class="hero-num">{formatNumber(summary.dnfCountForYear)}</p>
		<p class="sub">
			{countLabel(summary.dnfCountForYear, 'libro abbandonato', 'libri abbandonati')} nel {year}
		</p>
		<a class="ghost-link" href={tabHref('dnf')}>Apri il cimitero DNF</a>
	</ProfileCard>

	<ProfileCard icon="file-text" title="Pagine lette" class="c-pages">
		<div class="metric">
			<p class="hero-num">{formatNumber(stats.pagesRead)}</p>
			<p class="sub">{plural(stats.pagesRead, 'pagina', 'pagine')} nel {year}</p>
		</div>
		<MonthBars values={pagesByMonth(calendar)} unit="pagine" label="Pagine lette per mese" />
	</ProfileCard>

	<ProfileCard icon="calendar" title="Giorni di lettura" class="c-days">
		<div class="metric">
			<p class="hero-num">{formatNumber(stats.readingDays)}</p>
			<p class="sub">{plural(stats.readingDays, 'giorno', 'giorni')} nel {year}</p>
		</div>
		<MonthBars
			values={readingDaysByMonth(calendar)}
			unit="giorni"
			label="Giorni di lettura per mese"
		/>
	</ProfileCard>

	<ProfileCard
		icon="bookmark"
		title="Libri preferiti"
		href="/library"
		linkLabel="Libreria"
		class="c-fav"
	>
		{#if favorites.length > 0}
			<ul class="favorites">
				{#each favorites as book (book.id)}
					<li>
						<a href="/book/{book.id}">
							<BookCover {book} size="fluid" />
							<span class="fav-title">{book.title}</span>
							<span class="fav-author">{book.author}</span>
						</a>
						<RatingStars value={book.reviewRating} size={13} label="Voto di {book.title}" />
					</li>
				{/each}
			</ul>
		{:else}
			<p class="empty">Recensisci i libri che hai letto: i voti più alti finiscono qui.</p>
		{/if}
	</ProfileCard>

	<ProfileCard icon="book-open" title="Come leggi" class="c-format">
		{#if formatTotal > 0}
			<ShareBars rows={formats} />
			<p class="note">
				{#if counts.reread > 0}
					Hai riletto {countLabel(counts.reread, 'libro', 'libri')}: le storie che tornano.
				{:else}
					Ancora nessuna rilettura: c'è un libro che ti manca?
				{/if}
			</p>
		{:else}
			<p class="empty">Aggiungi libri alla libreria per vedere i tuoi formati.</p>
		{/if}
	</ProfileCard>

	<ProfileCard icon="sun" title="Quando leggi?" class="c-when">
		<ReadingHeatmap matrix={weekdayMonthMatrix(calendar)} />
	</ProfileCard>

	<ProfileCard
		icon="quote"
		title="Citazioni preferite"
		href="/quotes"
		linkLabel="Vedi tutte"
		class="c-quotes"
	>
		{#if quotes.length > 0}
			<div class="quotes">
				{#each quotes.slice(0, 2) as quote (quote.id)}
					<QuoteListItem {quote} />
				{/each}
			</div>
		{:else}
			<p class="empty">Salva le frasi che ami dalla recensione di un libro.</p>
		{/if}
	</ProfileCard>

	<ProfileCard icon="list" title="Le tue raccolte" class="c-lists">
		<ul class="collections">
			{#each collections as collection (collection.key)}
				<li>
					<a href={collection.href}>
						<span class="col-head">
							<Icon name={collection.icon} size={20} strokeWidth={2} />
							<span>
								<strong>{collection.label}</strong>
								<span class="col-sub">{collection.sub}</span>
							</span>
						</span>
						<span class="stack" aria-hidden="true">
							{#each collection.books as book, i (book.id)}
								<span class="stack-item" style:--i={i}>
									<BookCover {book} size={46} />
								</span>
							{:else}
								<span class="stack-empty"><Icon name={collection.icon} size={28} /></span>
							{/each}
						</span>
					</a>
				</li>
			{/each}
		</ul>
	</ProfileCard>

	<ProfileCard
		icon="calendar"
		title="Attività recente"
		href={tabHref('activity')}
		linkLabel="Vedi tutta"
		class="c-activity"
	>
		<ActivityList items={activity} />
	</ProfileCard>
</div>

<style>
	.overview {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 16px;
	}

	@media (min-width: 720px) {
		.overview {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}

		.overview :global(.c-bingo),
		.overview :global(.c-fav),
		.overview :global(.c-lists) {
			grid-column: 1 / -1;
		}
	}

	@media (min-width: 1180px) {
		.overview {
			grid-template-columns: repeat(12, minmax(0, 1fr));
		}

		.overview :global(.c-bingo),
		.overview :global(.c-language),
		.overview :global(.c-dnf),
		.overview :global(.c-pages),
		.overview :global(.c-days) {
			grid-column: span 3;
		}
		.overview :global(.c-fav) {
			grid-column: span 6;
		}
		.overview :global(.c-format) {
			grid-column: span 3;
		}
		.overview :global(.c-when) {
			grid-column: span 3;
		}
		.overview :global(.c-quotes) {
			grid-column: span 3;
		}
		.overview :global(.c-lists) {
			grid-column: span 6;
		}
		.overview :global(.c-activity) {
			grid-column: span 3;
		}
	}

	.hero-num {
		margin: 0;
		color: var(--color-text-primary);
		font-family: var(--font-display);
		font-size: 30px;
		line-height: 1.05;
	}

	.sub,
	.note,
	.empty {
		margin: 0;
		color: var(--color-text-secondary);
		font-size: 13px;
		line-height: 1.45;
	}

	.metric {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	/* ---- Bingo -------------------------------------------------------- */
	.bingo {
		position: relative;
		display: grid;
		grid-template-columns: 112px minmax(0, 1fr);
		align-items: center;
		gap: 12px 18px;
	}

	.progress-ring {
		width: 112px;
		height: 112px;
		overflow: visible;
	}

	.ring-track,
	.ring-fill {
		fill: none;
		stroke-width: 10;
	}

	.ring-track {
		stroke: color-mix(in srgb, var(--color-divider) 55%, transparent);
	}

	.ring-fill {
		stroke: var(--color-primary);
		stroke-linecap: round;
		transition: stroke-dashoffset var(--duration-base) var(--ease-out);
	}

	.ring-icon {
		position: absolute;
		top: 0;
		left: 0;
		display: grid;
		place-items: center;
		width: 112px;
		height: 112px;
		color: var(--color-primary);
	}

	.bingo-text .big {
		margin: 0;
		color: var(--color-text-primary);
		font-size: 18px;
	}

	.bingo-text strong {
		font-family: var(--font-display);
		font-size: 30px;
		font-weight: 400;
	}

	.bingo-text .pct {
		margin: 8px 0 0;
		color: var(--color-text-primary);
		font-size: 16px;
		font-weight: 700;
	}

	.bingo-side {
		grid-column: 1 / -1;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
	}

	.bingo-side p {
		margin: 0;
		color: var(--color-text-secondary);
		font-size: 13px;
	}

	.ghost-link {
		display: inline-flex;
		align-items: center;
		min-height: 40px;
		padding: 0 14px;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-sm);
		color: var(--color-text-primary);
		font-size: 13px;
		font-weight: 600;
		text-decoration: none;
		white-space: nowrap;
	}

	.ghost-link:hover {
		background: var(--color-surface);
	}

	/* ---- Preferiti ---------------------------------------------------- */
	/* Su telefono scorre in orizzontale, da tablet in su riempie la riga. */
	.favorites {
		display: grid;
		grid-auto-columns: 96px;
		grid-auto-flow: column;
		gap: 14px;
		margin: 0 -20px;
		padding: 0 20px 4px;
		overflow-x: auto;
		list-style: none;
		scroll-snap-type: x mandatory;
		scroll-padding-inline: 20px;
		scrollbar-width: none;
	}

	.favorites li {
		scroll-snap-align: start;
	}

	@media (min-width: 720px) {
		.favorites {
			grid-auto-columns: 132px;
			grid-auto-flow: column;
			justify-content: start;
			margin: 0;
			padding: 0;
			overflow: visible;
		}
	}

	.favorites li {
		display: flex;
		flex-direction: column;
		gap: 4px;
		min-width: 0;
	}

	.favorites a {
		display: flex;
		flex-direction: column;
		gap: 2px;
		color: inherit;
		text-decoration: none;
	}

	.favorites a :global(.cover) {
		margin-bottom: 6px;
		border-radius: 6px;
		box-shadow: var(--shadow-cover);
		transition: translate var(--duration-fast) var(--ease-out);
	}

	.favorites a:hover :global(.cover) {
		translate: 0 -3px;
	}

	.fav-title {
		overflow: hidden;
		color: var(--color-text-primary);
		font-size: 13px;
		font-weight: 700;
		line-height: 1.25;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
	}

	.fav-author {
		overflow: hidden;
		color: var(--color-text-secondary);
		font-size: 12px;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	/* ---- Citazioni ---------------------------------------------------- */
	.quotes {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	/* ---- Raccolte ----------------------------------------------------- */
	.collections {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 12px;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	@media (min-width: 720px) {
		.collections {
			grid-template-columns: repeat(4, minmax(0, 1fr));
		}
	}

	.collections a {
		box-sizing: border-box;
		display: flex;
		flex-direction: column;
		justify-content: space-between;
		gap: 12px;
		height: 100%;
		min-height: 150px;
		padding: 12px 12px 0;
		overflow: hidden;
		border: 1px solid color-mix(in srgb, var(--color-border) 55%, transparent);
		border-radius: var(--radius-md);
		background: var(--color-surface);
		color: var(--color-primary);
		text-decoration: none;
		transition: border-color var(--duration-fast) var(--ease-out);
	}

	.collections a:hover {
		border-color: var(--color-primary-outline);
	}

	.col-head {
		display: flex;
		align-items: flex-start;
		gap: 8px;
	}

	.col-head > span {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}

	.col-head strong {
		color: var(--color-text-primary);
		font-size: 13px;
	}

	.col-sub {
		color: var(--color-text-secondary);
		font-size: 12px;
	}

	.stack {
		display: flex;
		justify-content: center;
		align-items: flex-end;
		height: 64px;
	}

	.stack-item {
		margin-left: -14px;
		rotate: calc((var(--i) - 1) * 6deg);
		translate: 0 calc(var(--i) * 2px);
		filter: drop-shadow(var(--shadow-cover));
	}

	.stack-item:first-child {
		margin-left: 0;
	}

	.stack-empty {
		display: grid;
		place-items: center;
		width: 100%;
		height: 56px;
		border-radius: var(--radius-sm) var(--radius-sm) 0 0;
		background: var(--color-primary-tint);
		color: var(--color-primary);
	}
</style>
