<script lang="ts">
	import { onDestroy, tick } from 'svelte';
	import { page } from '$app/state';
	import { SvelteURLSearchParams } from 'svelte/reactivity';
	import {
		buildAddHref,
		getAddContext,
		getAddSeriesContext,
		getAddSeriesParams,
		type AddPath
	} from '$lib/catalog/add-context';
	import { CatalogClientError, fetchBookInfo, lookupIsbn } from '$lib/catalog/client';
	import { candidateKey, draftFromCandidate, type BookDraft } from '$lib/catalog/draft';
	import type { BookInfo } from '$lib/catalog/book-info';
	import type { EditionCandidate } from '$lib/contracts/books';
	import Button from '$lib/components/ui/Button.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import type { IconName } from '$lib/components/ui/icons';
	import BookCustomizationSheet from './BookCustomizationSheet.svelte';
	import BookSearch from './BookSearch.svelte';
	import BookSearchResult from './BookSearchResult.svelte';
	import CandidateDetail from './CandidateDetail.svelte';
	import ISBNScanner from './ISBNScanner.svelte';
	import ManualBookForm from './ManualBookForm.svelte';

	type Mode = 'search' | 'scan' | 'manual';

	interface Props {
		mode: Mode;
	}

	let { mode }: Props = $props();

	const context = $derived(getAddContext(page.url));
	const initialSeries = $derived(getAddSeriesContext(page.url));
	const seriesParams = $derived(getAddSeriesParams(page.url));
	/** "Annulla" esce dall'aggiunta: torna allo scaffale di partenza o alla libreria. */
	const exitHref = $derived(context.genre ? `/genre/${context.genre}` : '/library');

	const tabs: { mode: Mode; href: AddPath; icon: IconName; title: string; text: string }[] = [
		{
			mode: 'search',
			href: '/add/search',
			icon: 'search',
			title: 'Cerca',
			text: 'Titolo, autore o ISBN'
		},
		{
			mode: 'scan',
			href: '/add/scan',
			icon: 'camera',
			title: 'Scansiona ISBN',
			text: 'Inquadra il codice a barre'
		},
		{
			mode: 'manual',
			href: '/add/manual',
			icon: 'file-text',
			title: 'Inserisci manualmente',
			text: 'Titolo, autore e altri dettagli'
		}
	];

	// ---------- libro scelto: bozza + informazioni pubbliche ---------------------------

	let draft = $state<BookDraft | null>(null);
	let selectedKey = $state<string | null>(null);
	let info = $state<BookInfo | null>(null);
	let infoLoading = $state(false);
	let infoController: AbortController | undefined;
	let detailEl = $state<HTMLElement>();

	let sheetDraft = $state<BookDraft | null>(null);
	let sheetOpen = $state(false);

	async function select(candidate: EditionCandidate, source: 'isbn' | 'search') {
		draft = draftFromCandidate(candidate, source);
		selectedKey = candidateKey(candidate);
		loadInfo(candidate);
		// Su una colonna sola il dettaglio è sotto i risultati: lo si porta in vista.
		if (matchMedia('(max-width: 1023px)').matches) {
			await tick();
			detailEl?.scrollIntoView({ behavior: 'smooth', block: 'start' });
		}
	}

	async function loadInfo(candidate: EditionCandidate) {
		infoController?.abort();
		infoController = new AbortController();
		const { signal } = infoController;
		info = null;
		infoLoading = true;
		try {
			const result = await fetchBookInfo(
				{
					title: candidate.workTitle,
					author: candidate.authors[0] ?? '',
					language: candidate.language
				},
				signal
			);
			if (!signal.aborted) info = result;
		} catch (error) {
			if (signal.aborted) return;
			if (error instanceof DOMException && error.name === 'AbortError') return;
			// Le informazioni sono un extra: senza, il libro si aggiunge lo stesso.
			info = null;
		} finally {
			if (!signal.aborted) infoLoading = false;
		}
	}

	function openConfirm(next: BookDraft) {
		sheetDraft = next;
		sheetOpen = true;
	}

	onDestroy(() => infoController?.abort());

	// ---------- scansione ----------------------------------------------------------------

	let scanPhase = $state<'scan' | 'lookup' | 'results' | 'notfound' | 'error'>('scan');
	let isbn = $state('');
	let scanCandidates = $state<EditionCandidate[]>([]);
	let scanDegraded = $state(false);
	let scanExact = $state(false);
	let scanError = $state('');
	function manualAddHref(title: string, nextIsbn?: string): string {
		const params = new SvelteURLSearchParams(seriesParams);
		if (title) params.set('title', title);
		if (nextIsbn) params.set('isbn', nextIsbn);
		return buildAddHref('/add/manual', context.genre, params);
	}
	const manualIsbnHref = $derived(manualAddHref('', isbn));

	async function onscan(code: string) {
		isbn = code;
		scanPhase = 'lookup';
		scanError = '';
		try {
			const response = await lookupIsbn(code);
			scanCandidates = response.candidates;
			scanDegraded = response.degraded;
			scanExact = response.exactMatch;
			if (scanCandidates.length === 0) {
				scanPhase = 'notfound';
				return;
			}
			scanPhase = 'results';
			// Preselezione solo con ISBN identico: l'aggiunta va comunque confermata.
			const best = scanCandidates[0];
			if (response.exactMatch && best) select(best, 'isbn');
		} catch (error) {
			scanError =
				error instanceof CatalogClientError ? error.message : 'Non riesco a cercare questo ISBN.';
			scanPhase = 'error';
		}
	}

	function scanAgain() {
		sheetOpen = false;
		draft = null;
		selectedKey = null;
		scanPhase = 'scan';
	}

	const initialQuery = $derived(page.url.searchParams.get('q') ?? '');
	const manualInitial = $derived({
		title: page.url.searchParams.get('title') ?? '',
		isbn: page.url.searchParams.get('isbn') ?? ''
	});
</script>

<div class="page">
	<header class="top">
		<div>
			<h1>Aggiungi un libro</h1>
			<p class="subtitle">Cerca un libro, scansiona il codice ISBN o inseriscilo manualmente.</p>
			{#if initialSeries}
				<p class="series-context" data-testid="add-series-context">
					{#if initialSeries.number === null}
						Aggiungi un volume di {initialSeries.name}
					{:else}
						Aggiungi volume {String(initialSeries.number).replace('.', ',')} di {initialSeries.name}
					{/if}
				</p>
			{/if}
		</div>
		<a class="cancel" href={exitHref}>
			Annulla
			<Icon name="close" size={18} strokeWidth={2.2} />
		</a>
	</header>

	<nav class="tabs" aria-label="Modi per aggiungere un libro">
		{#each tabs as tab (tab.mode)}
			<a
				class="tab"
				href={buildAddHref(tab.href, context.genre, seriesParams)}
				aria-current={tab.mode === mode ? 'page' : undefined}
			>
				<span class="tab-icon"><Icon name={tab.icon} size={22} /></span>
				<span class="tab-text">
					<span class="tab-title">{tab.title}</span>
					<span class="tab-desc">{tab.text}</span>
				</span>
			</a>
		{/each}
	</nav>

	<div class="layout" class:single={mode === 'manual'}>
		<section class="panel main" aria-label={tabs.find((tab) => tab.mode === mode)?.title}>
			{#if mode === 'search'}
				{#key initialQuery}
					<BookSearch
						sbnEnabled={page.data.catalogSbnEnabled}
						{initialQuery}
						{selectedKey}
						onselect={select}
						manualHref={manualAddHref}
					/>
				{/key}
			{:else if mode === 'scan'}
				{#if scanPhase === 'scan'}
					<ISBNScanner
						{onscan}
						searchHref={buildAddHref('/add/search', context.genre, seriesParams)}
						manualHref={manualAddHref('')}
					/>
				{:else if scanPhase === 'lookup'}
					<p class="status" role="status" aria-live="polite">
						<span class="spinner" aria-hidden="true"></span>
						Cerco l’ISBN {isbn}…
					</p>
				{:else if scanPhase === 'results'}
					<p class="status-line" role="status">ISBN <strong>{isbn}</strong></p>
					{#if !scanExact}<p class="inline-note">
							L’ISBN cercato non è confermato. Controlla queste possibili alternative prima di
							aggiungere il libro.
						</p>{/if}
					{#if scanDegraded}
						<p class="inline-note">
							Uno dei servizi non ha risposto: i dati potrebbero essere incompleti.
						</p>
					{/if}
					<ul class="list">
						{#each scanCandidates as candidate, index (candidateKey(candidate) + index)}
							<li>
								<BookSearchResult
									{candidate}
									selected={selectedKey === candidateKey(candidate)}
									onselect={(picked) => select(picked, 'isbn')}
								/>
							</li>
						{/each}
					</ul>
					<div class="scan-actions">
						<Button variant="secondary" onclick={scanAgain}>Scansiona un altro libro</Button>
						<Button variant="ghost" href={manualIsbnHref}>Non è questo: inserisci a mano</Button>
					</div>
				{:else if scanPhase === 'notfound'}
					<div class="notice" role="status">
						<h2>Non trovo questo ISBN</h2>
						<p>
							L’ISBN <strong>{isbn}</strong> non è nei cataloghi che consulto. Puoi aggiungerlo a mano:
							lo conserverò insieme al libro.
						</p>
						<div class="scan-actions">
							<Button href={manualIsbnHref}>Inserisci a mano</Button>
							<Button variant="secondary" onclick={scanAgain}>Scansiona di nuovo</Button>
						</div>
					</div>
				{:else}
					<div class="notice" role="alert">
						<h2>Ricerca non riuscita</h2>
						<p>{scanError}</p>
						<div class="scan-actions">
							<Button onclick={() => onscan(isbn)}>Riprova</Button>
							<Button variant="secondary" href={manualIsbnHref}>
								Inserisci a mano con questo ISBN
							</Button>
							<Button variant="ghost" onclick={scanAgain}>Scansiona di nuovo</Button>
						</div>
					</div>
				{/if}
			{:else}
				<div class="manual">
					<h2 class="manual-title">Bastano titolo e autore</h2>
					<p class="manual-text">
						Il resto è facoltativo. Al passo successivo scegli genere, formato ed eventuale serie,
						così il libro finisce subito sullo scaffale giusto.
					</p>
					{#key JSON.stringify(manualInitial)}
						<ManualBookForm initial={manualInitial} onsubmit={openConfirm} />
					{/key}
				</div>
			{/if}
		</section>

		{#if mode !== 'manual'}
			<aside class="panel side" aria-label="Libro selezionato" bind:this={detailEl}>
				{#if draft}
					<CandidateDetail
						{draft}
						{info}
						{infoLoading}
						onchange={(next) => (draft = next)}
						oncontinue={openConfirm}
					/>
				{:else}
					<div class="placeholder">
						<span class="placeholder-icon"
							><Icon name="book-plus" size={30} strokeWidth={1.6} /></span
						>
						<h2>Nessun libro selezionato</h2>
						<p>
							{mode === 'scan'
								? 'Scansiona un codice ISBN: qui vedrai copertina, descrizione ed edizioni disponibili.'
								: 'Scegli un risultato: qui vedrai copertina, descrizione ed edizioni disponibili.'}
						</p>
					</div>
				{/if}
			</aside>
		{/if}
	</div>
</div>

<BookCustomizationSheet
	open={sheetOpen}
	draft={sheetDraft}
	initialGenre={context.genre}
	{initialSeries}
	onclose={() => (sheetOpen = false)}
/>

<style>
	.page {
		box-sizing: border-box;
		padding: 20px var(--page-gutter) 40px;
		color: var(--color-text-primary);
	}

	.top {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 16px;
	}

	h1 {
		margin: 0;
		font-family: var(--font-display);
		font-size: clamp(30px, 5vw, 44px);
		font-weight: 400;
		line-height: 1.05;
		color: var(--color-primary);
	}

	.subtitle {
		margin: 10px 0 0;
		font-size: 16px;
		line-height: 1.4;
		color: var(--color-text-secondary);
	}

	.series-context {
		margin: 8px 0 0;
		font-size: 15px;
		font-weight: 700;
		color: var(--color-primary);
	}

	.cancel {
		display: inline-flex;
		flex-shrink: 0;
		align-items: center;
		gap: 10px;
		min-height: var(--tap-size);
		padding: 0 16px 0 20px;
		border: 1px solid color-mix(in srgb, var(--color-border) 45%, transparent);
		border-radius: var(--radius-pill);
		background: var(--color-card);
		font-size: 15px;
		font-weight: 600;
		color: var(--color-text-primary);
		text-decoration: none;
	}

	.cancel:hover {
		background: var(--color-surface);
	}

	.tabs {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 6px;
		margin-top: 24px;
		padding: 6px;
		border-radius: var(--radius-xl);
		background: color-mix(in srgb, var(--color-surface) 70%, transparent);
	}

	.tab {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 6px;
		min-height: var(--tap-size);
		padding: 10px 8px;
		border-radius: var(--radius-lg);
		text-align: center;
		text-decoration: none;
		color: var(--color-text-primary);
		transition: background-color var(--duration-fast) var(--ease-out);
	}

	.tab:hover {
		background: color-mix(in srgb, var(--color-card) 55%, transparent);
	}

	.tab[aria-current='page'] {
		background: var(--color-card);
		box-shadow: var(--shadow-card);
	}

	.tab:focus-visible,
	.cancel:focus-visible {
		outline: 2px solid var(--color-primary);
		outline-offset: 2px;
	}

	.tab-icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 40px;
		height: 40px;
		border-radius: 50%;
		background: var(--color-surface);
		color: var(--color-text-primary);
	}

	.tab[aria-current='page'] .tab-icon {
		color: var(--color-primary);
	}

	.tab-text {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}

	.tab-title {
		font-size: 14px;
		font-weight: 700;
		line-height: 1.2;
	}

	.tab-desc {
		display: none;
		font-size: 13px;
		color: var(--color-text-secondary);
	}

	.layout {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 20px;
		margin-top: 20px;
	}

	.panel {
		box-sizing: border-box;
		min-width: 0;
		padding: 16px;
		border-radius: var(--radius-xl);
		background: color-mix(in srgb, var(--color-card) 70%, transparent);
		box-shadow: 0 0 0 1px color-mix(in srgb, var(--color-border) 18%, transparent);
	}

	.side {
		scroll-margin-top: 16px;
	}

	.placeholder {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 10px;
		padding: 40px 20px;
		text-align: center;
	}

	.placeholder-icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 64px;
		height: 64px;
		border-radius: 50%;
		background: var(--color-surface);
		color: var(--color-primary);
	}

	.placeholder h2 {
		margin: 6px 0 0;
		font-family: var(--font-display);
		font-size: 22px;
		font-weight: 400;
	}

	.placeholder p {
		max-width: 340px;
		margin: 0;
		font-size: 14px;
		line-height: 1.45;
		color: var(--color-text-secondary);
	}

	.manual {
		max-width: 620px;
		margin-inline: auto;
	}

	.manual-title {
		margin: 4px 0 0;
		font-family: var(--font-display);
		font-size: 24px;
		font-weight: 400;
	}

	.manual-text {
		margin: 6px 0 16px;
		font-size: 14px;
		line-height: 1.45;
		color: var(--color-text-secondary);
	}

	.list {
		display: flex;
		flex-direction: column;
		gap: 8px;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.status,
	.status-line {
		display: flex;
		align-items: center;
		gap: 10px;
		margin: 0 0 14px;
		font-size: 14px;
		color: var(--color-text-secondary);
	}

	.spinner {
		width: 20px;
		height: 20px;
		border: 2.5px solid var(--color-divider);
		border-top-color: var(--color-primary);
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.spinner {
			animation-duration: 2.4s;
		}
	}

	.inline-note {
		margin: 0 0 12px;
		padding: 10px 14px;
		border-radius: 14px;
		background: var(--color-info-tint);
		font-size: 13px;
	}

	.notice {
		padding: 22px;
		border-radius: var(--radius-xl);
		background: var(--color-surface);
	}

	.notice h2 {
		margin: 0;
		font-size: 21px;
		line-height: 1.2;
	}

	.notice p {
		margin: 8px 0 16px;
		font-size: 14px;
		line-height: 1.45;
		color: var(--color-text-secondary);
	}

	.scan-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 10px;
		margin-top: 18px;
	}

	.notice .scan-actions {
		margin-top: 0;
	}

	@media (max-width: 559px) {
		.top {
			flex-direction: column-reverse;
		}

		.cancel {
			align-self: flex-end;
		}
	}

	@media (min-width: 720px) {
		.page {
			padding: 32px 32px 48px;
		}

		.tab {
			flex-direction: row;
			gap: 14px;
			padding: 14px 18px;
			text-align: left;
		}

		.tab-icon {
			width: 44px;
			height: 44px;
		}

		.tab-title {
			font-size: 16px;
		}

		.tab-desc {
			display: block;
		}

		.panel {
			padding: 20px;
		}
	}

	@media (min-width: 1024px) {
		.layout {
			grid-template-columns: minmax(0, 4fr) minmax(380px, 3fr);
			align-items: start;
		}

		.layout.single {
			grid-template-columns: minmax(0, 1fr);
		}
	}
</style>
