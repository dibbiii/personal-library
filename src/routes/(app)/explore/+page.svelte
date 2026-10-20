<script lang="ts">
	import { untrack } from 'svelte';
	import { page } from '$app/state';
	import BookCustomizationSheet from '$lib/components/catalog/BookCustomizationSheet.svelte';
	import DiscoverBookSheet from '$lib/components/explore/DiscoverBookSheet.svelte';
	import DiscoverFilters from '$lib/components/explore/DiscoverFilters.svelte';
	import DiscoverResults from '$lib/components/explore/DiscoverResults.svelte';
	import DiscoverShelf from '$lib/components/explore/DiscoverShelf.svelte';
	import ExploreHero from '$lib/components/explore/ExploreHero.svelte';
	import RankedList from '$lib/components/explore/RankedList.svelte';
	import ThemeTiles from '$lib/components/explore/ThemeTiles.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import type { BookDraft } from '$lib/catalog/draft';
	import {
		DISCOVER_TOPICS,
		DISCOVER_TOPIC_KEYS,
		GENRE_TOPICS,
		MAIN_TOPICS,
		activeFilterCount,
		defaultFilters,
		findOwned,
		type DiscoverBook,
		type DiscoverFilters as Filters,
		type DiscoverRequest,
		type DiscoverSection,
		type DiscoverTopic
	} from '$lib/catalog/discover';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const owned = $derived(new Map(data.owned));

	function topicParam(): DiscoverTopic[] {
		const value = page.url.searchParams.get('topic');
		return value && (DISCOVER_TOPIC_KEYS as string[]).includes(value)
			? [value as DiscoverTopic]
			: [];
	}

	// Link da altre pagine: /explore?q=… o /explore?topic=fantasy
	let text = $state(untrack(() => page.url.searchParams.get('q') ?? ''));
	let query = $state(untrack(() => text.trim()));
	let filters = $state<Filters>({
		...defaultFilters(untrack(() => data.currentYear)),
		topics: untrack(topicParam)
	});
	/** "Vedi tutti" di una sezione: elenco completo della sezione. */
	let sectionView = $state<DiscoverSection | null>(null);
	let filtersOpen = $state(false);

	const activeCount = $derived(activeFilterCount(filters, data.currentYear));
	const browsing = $derived(query !== '' || activeCount > 0 || sectionView !== null);

	/** Filtri come parametri dell'API (valgono anche per le sezioni). */
	const filterQuery = $derived<DiscoverRequest>({
		topics: filters.topics,
		minRating: filters.minRating,
		from: filters.from,
		to: filters.to,
		lang: filters.lang,
		cover: filters.cover
	});

	// Consigli: i temi dei generi più presenti in libreria (o, con la libreria vuota, i più amati).
	const recommendedTopics = $derived([
		...new Set(data.topGenres.flatMap((genre) => GENRE_TOPICS[genre]))
	]);

	const SECTION_TITLES: Record<DiscoverSection, string> = {
		recommended: 'Consigliati per te',
		new: 'Novità e uscite recenti',
		classics: 'Classici da non perdere',
		popular: 'I più popolari',
		trending: 'Libri in tendenza',
		search: 'Risultati'
	};

	const resultsQuery = $derived<DiscoverRequest>({
		...filterQuery,
		section: sectionView ?? 'search',
		q: query,
		topics:
			sectionView === 'recommended' && filters.topics.length === 0
				? recommendedTopics
				: filters.topics
	});

	const resultsTitle = $derived.by(() => {
		if (sectionView) return SECTION_TITLES[sectionView];
		if (query) return `Risultati per “${query}”`;
		if (filters.topics.length === 1) return DISCOVER_TOPICS[filters.topics[0]!].label;
		return 'Libri filtrati';
	});

	// ---------- dettaglio e aggiunta ------------------------------------------------------

	let openBook = $state<DiscoverBook | null>(null);
	const openOwnedId = $derived(openBook ? findOwned(openBook, owned) : null);
	let confirmDraft = $state<BookDraft | null>(null);
	let confirmOpen = $state(false);

	function openDetails(book: DiscoverBook) {
		openBook = book;
	}

	function add(draft: BookDraft) {
		openBook = null;
		confirmDraft = draft;
		confirmOpen = true;
	}

	// ---------- navigazione tra le viste ----------------------------------------------------

	function search(value: string) {
		query = value;
		if (value) sectionView = null;
	}

	function toggleChip(topic: DiscoverTopic | null) {
		sectionView = null;
		if (topic === null) filters = { ...filters, topics: [] };
		else if (filters.topics.length === 1 && filters.topics[0] === topic) {
			filters = { ...filters, topics: [] };
		} else filters = { ...filters, topics: [topic] };
	}

	function showSection(section: DiscoverSection) {
		sectionView = section;
		scrollToFeed();
	}

	function showTopic(topic: DiscoverTopic) {
		sectionView = null;
		filters = { ...filters, topics: [topic] };
		scrollToFeed();
	}

	function backToExplore() {
		sectionView = null;
		query = '';
		text = '';
		filters = defaultFilters(data.currentYear);
	}

	let feedEl = $state<HTMLElement>();
	function scrollToFeed() {
		queueMicrotask(() => feedEl?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
	}

	const OTHER_TOPICS = DISCOVER_TOPIC_KEYS.filter((topic) => !MAIN_TOPICS.includes(topic));
	const otherChip = $derived(
		filters.topics.length === 1 && OTHER_TOPICS.includes(filters.topics[0]!)
			? filters.topics[0]!
			: ''
	);
</script>

<svelte:head><title>Esplora · Segnalibro</title></svelte:head>

<div class="explore">
	<div class="main-col">
		<ExploreHero bind:value={text} onsearch={search} />

		<div class="chips-row">
			<div class="chips" role="group" aria-label="Generi">
				<button
					type="button"
					class="chip"
					aria-pressed={filters.topics.length === 0}
					onclick={() => toggleChip(null)}>Tutti</button
				>
				{#each MAIN_TOPICS as topic (topic)}
					<button
						type="button"
						class="chip"
						aria-pressed={filters.topics.length === 1 && filters.topics[0] === topic}
						onclick={() => toggleChip(topic)}>{DISCOVER_TOPICS[topic].label}</button
					>
				{/each}
				<label class="chip select-chip" class:on={otherChip !== ''}>
					<span class="sr-only">Altri generi</span>
					<select
						value={otherChip}
						onchange={(event) => {
							const value = event.currentTarget.value as DiscoverTopic | '';
							toggleChip(value === '' ? null : value);
						}}
					>
						<option value="">Altro</option>
						{#each OTHER_TOPICS as topic (topic)}
							<option value={topic}>{DISCOVER_TOPICS[topic].label}</option>
						{/each}
					</select>
					<Icon name="chevron-down" size={14} strokeWidth={2.4} />
				</label>
			</div>
			<a class="add-link" href="/add/scan" title="Scansiona o inserisci a mano">
				<Icon name="camera" size={18} />
				<span>Scansiona o inserisci</span>
			</a>
		</div>

		<div class="body">
			<button
				type="button"
				class="filters-toggle"
				aria-expanded={filtersOpen}
				aria-controls="explore-filters"
				onclick={() => (filtersOpen = !filtersOpen)}
			>
				<Icon name="sliders" size={18} />
				Filtri
				{#if activeCount > 0}<span class="badge">{activeCount}</span>{/if}
				<Icon name={filtersOpen ? 'chevron-up' : 'chevron-down'} size={16} strokeWidth={2.2} />
			</button>

			<aside class="filters" class:open={filtersOpen} id="explore-filters" aria-label="Filtri">
				<DiscoverFilters
					{filters}
					currentYear={data.currentYear}
					onchange={(next) => {
						filters = next;
						sectionView = null;
					}}
				/>
			</aside>

			<div class="feed" bind:this={feedEl}>
				{#if browsing}
					<DiscoverResults
						title={resultsTitle}
						query={resultsQuery}
						{owned}
						onopen={openDetails}
						onback={backToExplore}
					/>
				{:else}
					<DiscoverShelf
						title="Consigliati per te"
						subtitle={recommendedTopics.length > 0
							? 'Basati sui generi più presenti nella tua libreria.'
							: 'I libri più amati dai lettori: aggiungine qualcuno e i consigli diventano tuoi.'}
						query={{ ...filterQuery, section: 'recommended', topics: recommendedTopics, limit: 20 }}
						{owned}
						hideOwned
						onopen={openDetails}
						onseeall={() => showSection('recommended')}
					/>
					<DiscoverShelf
						title="Novità e uscite recenti"
						subtitle="Gli ultimi libri arrivati nei cataloghi."
						query={{ ...filterQuery, section: 'new', limit: 16 }}
						{owned}
						onopen={openDetails}
						onseeall={() => showSection('new')}
					/>
					<DiscoverShelf
						title="Classici da non perdere"
						subtitle="Le grandi opere che hanno fatto la storia della letteratura."
						query={{ ...filterQuery, section: 'classics', limit: 16 }}
						{owned}
						onopen={openDetails}
						onseeall={() => showSection('classics')}
					/>
				{/if}
			</div>
		</div>
	</div>

	<aside class="side-col" aria-label="In evidenza">
		<RankedList
			title="I più popolari"
			query={{ section: 'popular', lang: 'it', limit: 5 }}
			numbered
			onopen={openDetails}
			onseeall={() => showSection('popular')}
		/>
		<RankedList
			title="Libri in tendenza"
			query={{ section: 'trending', lang: 'it', limit: 5 }}
			onopen={openDetails}
			onseeall={() => showSection('trending')}
		/>
		<ThemeTiles
			onselect={showTopic}
			onseeall={() => {
				filtersOpen = true;
				document.getElementById('explore-filters')?.scrollIntoView({ behavior: 'smooth' });
			}}
		/>
	</aside>
</div>

<DiscoverBookSheet
	book={openBook}
	language={filters.lang === 'all' ? null : filters.lang}
	ownedId={openOwnedId}
	onclose={() => (openBook = null)}
	onadd={add}
/>

<BookCustomizationSheet
	open={confirmOpen}
	draft={confirmDraft}
	onclose={() => (confirmOpen = false)}
/>

<style>
	.explore {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 18px;
		box-sizing: border-box;
		padding: 16px var(--page-gutter) 40px;
		color: var(--color-text-primary);
	}

	.main-col {
		display: flex;
		flex-direction: column;
		gap: 16px;
		min-width: 0;
	}

	.chips-row {
		display: flex;
		align-items: center;
		gap: 12px;
	}

	.chips {
		display: flex;
		flex: 1;
		gap: 8px;
		min-width: 0;
		padding: 2px;
		overflow-x: auto;
		scrollbar-width: none;
	}

	.chips::-webkit-scrollbar {
		display: none;
	}

	.chip {
		position: relative;
		display: inline-flex;
		flex-shrink: 0;
		align-items: center;
		gap: 4px;
		min-height: 36px;
		padding: 0 16px;
		border: 1px solid color-mix(in srgb, var(--color-border) 30%, transparent);
		border-radius: var(--radius-pill);
		background: var(--color-card);
		font-size: 13.5px;
		font-weight: 600;
		color: var(--color-text-primary);
	}

	.chip:hover {
		background: var(--color-surface);
	}

	.chip[aria-pressed='true'],
	.select-chip.on {
		border-color: var(--color-primary);
		background: var(--color-primary);
		color: var(--color-on-primary);
	}

	.select-chip {
		padding: 0 12px 0 0;
	}

	.select-chip select {
		min-height: 34px;
		padding: 0 4px 0 16px;
		border: 0;
		background: transparent;
		font: inherit;
		color: inherit;
		appearance: none;
		cursor: pointer;
	}

	.select-chip select:focus-visible {
		outline: none;
	}

	.chip:focus-visible,
	.select-chip:has(select:focus-visible),
	.add-link:focus-visible,
	.filters-toggle:focus-visible {
		outline: 2px solid var(--color-primary);
		outline-offset: 2px;
	}

	.add-link {
		display: inline-flex;
		flex-shrink: 0;
		align-items: center;
		gap: 8px;
		min-height: 36px;
		padding: 0 14px;
		border-radius: var(--radius-pill);
		background: var(--color-primary);
		font-size: 13.5px;
		font-weight: 700;
		color: var(--color-on-primary);
		text-decoration: none;
	}

	.add-link span {
		display: none;
	}

	.body {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 16px;
		align-items: start;
	}

	.filters-toggle {
		display: inline-flex;
		align-items: center;
		justify-self: start;
		gap: 8px;
		min-height: 40px;
		padding: 0 14px;
		border: 1px solid color-mix(in srgb, var(--color-border) 35%, transparent);
		border-radius: var(--radius-pill);
		background: var(--color-card);
		font-size: 14px;
		font-weight: 700;
		color: var(--color-text-primary);
	}

	.badge {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 20px;
		height: 20px;
		padding: 0 5px;
		border-radius: var(--radius-pill);
		background: var(--color-primary);
		font-size: 12px;
		color: var(--color-on-primary);
	}

	.filters {
		display: none;
		padding: 18px;
		border-radius: var(--radius-xl);
		background: color-mix(in srgb, var(--color-card) 70%, transparent);
		box-shadow: 0 0 0 1px color-mix(in srgb, var(--color-border) 16%, transparent);
	}

	.filters.open {
		display: block;
	}

	.feed {
		display: flex;
		flex-direction: column;
		gap: 16px;
		min-width: 0;
		scroll-margin-top: 16px;
	}

	.side-col {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 16px;
		align-content: start;
	}

	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		margin: -1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}

	@media (min-width: 720px) {
		.explore {
			padding: 24px 24px 48px;
		}

		.add-link span {
			display: inline;
		}

		.side-col {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}

		.side-col > :global(:last-child) {
			grid-column: 1 / -1;
		}
	}

	@media (min-width: 960px) {
		.body {
			grid-template-columns: 190px minmax(0, 1fr);
		}

		.filters-toggle {
			display: none;
		}

		.filters {
			display: block;
		}
	}

	@media (min-width: 1440px) {
		.explore {
			grid-template-columns: minmax(0, 1fr) 316px;
			align-items: start;
		}

		.side-col {
			grid-template-columns: minmax(0, 1fr);
		}
	}
</style>
