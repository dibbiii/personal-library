<script lang="ts">
	import { onDestroy, untrack } from 'svelte';
	import BookSearchResult from './BookSearchResult.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import { CatalogClientError, lookupIsbn, searchBooks } from '$lib/catalog/client';
	import { candidateKey } from '$lib/catalog/draft';
	import { languageLabel, toIso2 } from '$lib/catalog/language';
	import { mergeCandidates } from '$lib/catalog/merge';
	import { parseIsbn } from '$lib/catalog/isbn';
	import type { EditionCandidate } from '$lib/contracts/books';

	interface Props {
		/** Scelta di un candidato (già completato con pagine/editore quando possibile). */
		onselect: (candidate: EditionCandidate, source: 'isbn' | 'search') => void;
		/** Chiave (candidateKey) del candidato mostrato nel dettaglio. */
		selectedKey?: string | null;
		initialQuery?: string;
		/** Preferenza di lingua per il ranking (non è un filtro). */
		language?: string;
		/** Link all'inserimento manuale con il titolo già scritto. */
		manualHref?: (title: string, isbn?: string) => string;
		sbnEnabled?: boolean;
	}

	let {
		onselect,
		selectedKey = null,
		initialQuery = '',
		language = 'it',
		sbnEnabled = false,
		manualHref = (title, isbn) =>
			`/add/manual?${new URLSearchParams({ ...(title ? { title } : {}), ...(isbn ? { isbn } : {}) })}`
	}: Props = $props();

	const DEBOUNCE_MS = 400;
	const MIN_LENGTH = 2;
	const RESULTS_PER_PAGE = 10;
	const PROVIDERS = [
		{ value: 'all', label: 'Tutte le fonti' },
		{ value: 'open-library', label: 'Open Library' },
		{ value: 'google-books', label: 'Google Books' },
		{ value: 'inventaire', label: 'Inventaire' },
		{ value: 'sbn', label: 'SBN' },
		{ value: 'loc', label: 'Library of Congress' },
		{ value: 'isbndb', label: 'ISBNdb' }
	] as const;

	let query = $state(untrack(() => initialQuery));
	let status = $state<'idle' | 'loading' | 'done' | 'error'>('idle');
	let candidates = $state<EditionCandidate[]>([]);
	let degraded = $state(false);
	let serviceWarning = $state(
		'Uno dei servizi non ha risposto: i risultati potrebbero essere incompleti.'
	);
	let lastQuery = $state('');
	let lastWasIsbn = $state(false);
	let isbnExact = $state(false);
	let possibleMatches = $state(false);
	let errorMessage = $state('');
	let pendingKey = $state<string | null>(null);
	let languageFilter = $state<string>('all');
	let providerFilter = $state<(typeof PROVIDERS)[number]['value']>('all');
	let visibleCount = $state(RESULTS_PER_PAGE);
	let author = $state('');
	let selectedCatalog = $state<'primary' | 'sbn' | 'loc'>('primary');

	let timer: ReturnType<typeof setTimeout> | undefined;
	let controller: AbortController | undefined;
	let activeSearchKey: string | null = null;
	let completedSearchKey: string | null = null;

	const trimmed = $derived(query.trim());
	const queryIsbn = $derived(parseIsbn(trimmed));
	const tooShort = $derived(trimmed.length > 0 && trimmed.length < MIN_LENGTH);

	/** Una chip per lingua, solo se i risultati ne hanno più d'una. */
	const languages = $derived.by(() => {
		const codes = [...new Set(candidates.map((item) => toIso2(item.language) ?? '?'))];
		if (codes.length < 2) return [];
		return codes
			.map((code) => ({ code, label: languageLabel(code) ?? 'Lingua sconosciuta' }))
			.sort((a, b) => Number(b.code === language) - Number(a.code === language));
	});

	const visible = $derived(
		candidates.filter(
			(item) =>
				(providerFilter === 'all' || item.provider === providerFilter) &&
				(languageFilter === 'all' || (toIso2(item.language) ?? '?') === languageFilter)
		)
	);

	const shown = $derived(visible.slice(0, visibleCount));

	function filterLanguage(value: string) {
		languageFilter = value;
		visibleCount = RESULTS_PER_PAGE;
	}

	function searchKey(text: string, isbn: ReturnType<typeof parseIsbn>) {
		return isbn
			? JSON.stringify(['isbn', isbn.isbn13])
			: JSON.stringify(['search', text.trim(), author.trim(), language, selectedCatalog]);
	}

	function canReuseSearch(key: string) {
		return (
			(status === 'done' && completedSearchKey === key) ||
			(status === 'loading' && activeSearchKey === key && !controller?.signal.aborted)
		);
	}

	async function run(text: string) {
		const isbn = text === trimmed ? queryIsbn : parseIsbn(text);
		const key = searchKey(text, isbn);
		if (canReuseSearch(key)) return;
		controller?.abort();
		controller = new AbortController();
		const { signal } = controller;
		activeSearchKey = key;
		status = 'loading';
		errorMessage = '';

		try {
			const response = isbn
				? await lookupIsbn(isbn.isbn13, signal)
				: await searchBooks(
						{
							title: text,
							language,
							sort: 'newest',
							source: selectedCatalog,
							...(author.trim() ? { author: author.trim() } : {})
						},
						signal
					);
			if (signal.aborted) return;
			candidates = response.candidates;
			degraded = response.degraded;
			const failures = Object.entries(response.providers)
				.filter(([, status]) => status === 'error' || status === 'rate_limited')
				.map(([id, status]) => {
					const name = PROVIDERS.find((provider) => provider.value === id)?.label ?? id;
					return `${name}: ${status === 'rate_limited' ? 'limite di richieste raggiunto' : 'servizio non disponibile'}.`;
				});
			serviceWarning = failures.length
				? `${failures.join(' ')} I risultati potrebbero essere incompleti.`
				: 'Uno dei servizi non ha risposto: i risultati potrebbero essere incompleti.';
			lastQuery = text;
			lastWasIsbn = Boolean(isbn);
			isbnExact = 'exactMatch' in response && response.exactMatch === true;
			possibleMatches = response.possibleMatches === true;
			languageFilter = 'all';
			visibleCount = RESULTS_PER_PAGE;
			completedSearchKey = key;
			status = 'done';
		} catch (error) {
			if (signal.aborted) return;
			if (error instanceof DOMException && error.name === 'AbortError') return;
			errorMessage =
				error instanceof CatalogClientError
					? error.message
					: 'Non riesco a cercare in questo momento. Riprova.';
			candidates = [];
			completedSearchKey = null;
			status = 'error';
		} finally {
			if (controller?.signal === signal) activeSearchKey = null;
		}
	}

	function schedule() {
		selectedCatalog = 'primary';
		clearTimeout(timer);
		if (trimmed.length >= MIN_LENGTH && canReuseSearch(searchKey(trimmed, queryIsbn))) return;
		controller?.abort();
		if (trimmed.length < MIN_LENGTH) {
			status = 'idle';
			candidates = [];
			completedSearchKey = null;
			return;
		}
		status = 'loading';
		errorMessage = '';
		timer = setTimeout(() => run(trimmed), DEBOUNCE_MS);
	}

	function submitNow(event: SubmitEvent) {
		event.preventDefault();
		clearTimeout(timer);
		if (trimmed.length >= MIN_LENGTH) run(trimmed);
	}

	function clear() {
		query = '';
		schedule();
	}
	function manualLink(text: string) {
		const isbn = text.trim() === trimmed ? queryIsbn : parseIsbn(text);
		return isbn ? manualHref('', isbn.isbn13) : manualHref(text);
	}

	function searchCatalog(source: 'primary' | 'sbn' | 'loc') {
		clearTimeout(timer);
		selectedCatalog = source;
		providerFilter = 'all';
		if (trimmed.length >= MIN_LENGTH && !queryIsbn) run(trimmed);
	}

	// Ricerca iniziale (es. /add/search?q=...)
	$effect(() => {
		const text = initialQuery.trim();
		if (text.length >= MIN_LENGTH) untrack(() => run(text));
	});

	onDestroy(() => {
		clearTimeout(timer);
		controller?.abort();
	});

	/** Completa pagine/editore/cover con il lookup per ISBN, se mancano: i dati restano quelli scelti. */
	async function choose(candidate: EditionCandidate) {
		const source: 'isbn' | 'search' = lastWasIsbn ? 'isbn' : 'search';
		const isbn = candidate.isbn13 ?? candidate.isbn10;
		const missing = candidate.pageCount === null || candidate.coverUrl === null;
		if (!isbn || !missing || !parseIsbn(isbn)) {
			onselect(candidate, source);
			return;
		}

		pendingKey = candidateKey(candidate);
		try {
			const found = await lookupIsbn(parseIsbn(isbn)?.isbn13 ?? isbn);
			const same = found.candidates.find(
				(other) => parseIsbn(other.isbn13 ?? other.isbn10 ?? '')?.isbn13 === parseIsbn(isbn)?.isbn13
			);
			onselect(same ? mergeCandidates(candidate, same) : candidate, source);
		} catch {
			// L'arricchimento è facoltativo: si prosegue con i dati che abbiamo.
			onselect(candidate, source);
		} finally {
			pendingKey = null;
		}
	}
</script>

<section class="search" aria-label="Cerca un libro">
	<form class="field" role="search" method="dialog" onsubmit={submitNow}>
		<label class="sr-only" for="book-search-input">Titolo, autore, editore o ISBN</label>
		<span class="lead" aria-hidden="true"><Icon name="search" size={22} /></span>
		<input
			id="book-search-input"
			name="q"
			type="search"
			autocomplete="off"
			autocapitalize="none"
			spellcheck="false"
			enterkeyhint="search"
			placeholder="Titolo, autore, editore o ISBN"
			bind:value={
				() => query,
				(value) => {
					query = value;
					schedule();
				}
			}
			aria-describedby="book-search-hint"
		/>
		{#if query}
			<button class="clear" type="button" aria-label="Cancella la ricerca" onclick={clear}>
				<Icon name="close" size={18} strokeWidth={2.2} />
			</button>
		{/if}
	</form>
	<p id="book-search-hint" class="hint" class:warn={tooShort}>
		{tooShort
			? 'Scrivi almeno 2 caratteri.'
			: 'Cerco per titolo, autore o editore su Open Library e Google Books.'}
	</p>

	{#if !queryIsbn}
		<details class="advanced">
			<summary>
				<span>Specifica l’autore</span>
				<span class="advanced-chevron" aria-hidden="true">
					<Icon name="chevron-down" size={16} strokeWidth={2} />
				</span>
			</summary>
			<label class="author-field">
				<span>Autore <span class="optional">facoltativo</span></span>
				<input
					type="text"
					name="author"
					autocomplete="off"
					bind:value={
						() => author,
						(value) => {
							author = value;
							schedule();
						}
					}
					maxlength="120"
					placeholder="Nome dell’autore"
				/>
			</label>
		</details>
	{/if}
	{#if !queryIsbn && trimmed.length >= MIN_LENGTH}
		<div class="catalog-actions">
			{#if sbnEnabled}
				<Button
					variant="secondary"
					disabled={status === 'loading'}
					onclick={() => searchCatalog(selectedCatalog === 'sbn' ? 'primary' : 'sbn')}
				>
					{selectedCatalog === 'sbn'
						? 'Torna alla ricerca generale'
						: 'Cerca nel catalogo italiano SBN'}
				</Button>
			{/if}
			<Button
				variant="secondary"
				disabled={status === 'loading'}
				onclick={() => searchCatalog(selectedCatalog === 'loc' ? 'primary' : 'loc')}
			>
				{selectedCatalog === 'loc'
					? 'Torna alla ricerca generale'
					: 'Cerca nel catalogo Library of Congress'}
			</Button>
		</div>
		{#if selectedCatalog === 'sbn'}<p class="hint">
				Risultati dal catalogo delle biblioteche italiane SBN (fino a 10 schede).
			</p>{/if}
		{#if selectedCatalog === 'loc'}<p class="hint">
				Risultati dal catalogo della Library of Congress (fino a 10 schede).
			</p>{/if}
	{/if}

	{#if status === 'done' && candidates.length > 0}
		<div class="filters">
			<div class="chips" role="group" aria-label="Filtra per lingua">
				<button
					type="button"
					class="chip"
					aria-pressed={languageFilter === 'all'}
					onclick={() => filterLanguage('all')}>Tutti</button
				>
				{#each languages as item (item.code)}
					<button
						type="button"
						class="chip"
						aria-pressed={languageFilter === item.code}
						onclick={() => filterLanguage(item.code)}>{item.label}</button
					>
				{/each}
			</div>
			<label class="source">
				<span>Risultati da</span>
				<span class="select">
					<select bind:value={providerFilter} onchange={() => (visibleCount = RESULTS_PER_PAGE)}>
						{#each PROVIDERS as item (item.value)}
							<option value={item.value}>{item.label}</option>
						{/each}
					</select>
					<Icon name="chevron-down" size={16} strokeWidth={2.2} />
				</span>
			</label>
		</div>
	{/if}

	<div class="results" aria-live="polite" aria-busy={status === 'loading'}>
		{#if status === 'loading'}
			<p class="sr-only">Ricerca in corso…</p>
			<ul class="list" aria-hidden="true">
				{#each [0, 1, 2] as n (n)}
					<li class="skeleton">
						<span class="s-cover"></span><span class="s-lines"><i></i><i></i><i></i></span>
					</li>
				{/each}
			</ul>
		{:else if status === 'error'}
			<div class="notice" role="alert">
				<p>{errorMessage}</p>
				<div class="notice-actions">
					<Button size="sm" variant="secondary" onclick={() => run(trimmed)}>Riprova</Button>
					<Button size="sm" variant="ghost" href={manualLink(trimmed)}>Inserisci a mano</Button>
				</div>
			</div>
		{:else if status === 'done' && candidates.length === 0}
			<div class="notice">
				<p class="strong">Nessun risultato per “{lastQuery}”.</p>
				<p>
					Controlla l’ortografia, prova titolo, autore o editore, oppure aggiungi il libro a mano:
					funziona senza servizi esterni.
				</p>
				{#if degraded}
					<p class="warn-text">
						{serviceWarning}
					</p>
				{/if}
				<div class="notice-actions">
					<Button size="sm" href={manualLink(lastQuery)}>Inserisci a mano</Button>
				</div>
			</div>
		{:else if status === 'done'}
			{#if !lastWasIsbn && possibleMatches}<p class="notice-inline" role="status">
					Non ho trovato una corrispondenza forte. Questi risultati sono possibili alternative da
					verificare.
				</p>{/if}
			{#if lastWasIsbn && !isbnExact}<p class="notice-inline" role="status">
					L’ISBN cercato non è confermato. Queste sono possibili alternative: controlla l’edizione
					prima di aggiungerla.
				</p>{/if}
			<p class="count">
				{visible.length > shown.length
					? `Mostrati ${shown.length} di ${visible.length} risultati`
					: visible.length === 1
						? '1 risultato'
						: `${visible.length} risultati`}
			</p>
			{#if degraded}
				<p class="notice-inline" role="status">
					{serviceWarning}
				</p>
			{/if}
			{#if visible.length === 0}
				<p class="empty-filter">Nessun risultato con questi filtri.</p>
			{/if}
			<ul class="list" aria-label="Risultati della ricerca">
				{#each shown as candidate, index (candidateKey(candidate) + index)}
					<li>
						<BookSearchResult
							{candidate}
							selected={selectedKey === candidateKey(candidate)}
							busy={pendingKey === candidateKey(candidate)}
							disabled={pendingKey !== null}
							onselect={choose}
						/>
					</li>
				{/each}
			</ul>
			{#if visible.length > shown.length}
				<div class="more-results">
					<Button variant="secondary" onclick={() => (visibleCount += RESULTS_PER_PAGE)}>
						Mostra altri risultati
					</Button>
				</div>
			{/if}
			<p class="footnote">
				Non è quello che cerchi? <a href={manualLink(lastQuery)}>Inserisci il libro a mano</a>.
			</p>
		{:else}
			<div class="idle">
				<Icon name="book-open" size={28} strokeWidth={1.7} />
				<p>Scrivi titolo, autore, editore o ISBN: ti mostro le edizioni migliori da scegliere.</p>
			</div>
		{/if}
	</div>
</section>

<style>
	.advanced {
		margin: 10px 4px 12px;
		font-size: 0.9rem;
	}
	.advanced summary {
		display: inline-flex;
		align-items: center;
		gap: 10px;
		min-height: 44px;
		padding: 0 12px;
		border-radius: var(--radius-pill);
		color: var(--color-text-secondary);
		font-weight: 600;
		list-style: none;
		cursor: pointer;
	}
	.advanced summary::-webkit-details-marker {
		display: none;
	}
	.advanced summary:hover,
	.advanced[open] summary {
		background: var(--color-surface);
		color: var(--color-primary);
	}
	.advanced summary:focus-visible {
		outline: 2px solid var(--color-primary);
		outline-offset: 2px;
	}
	.advanced-chevron {
		display: inline-flex;
	}
	.advanced[open] .advanced-chevron {
		transform: rotate(180deg);
	}
	.author-field {
		display: grid;
		gap: 10px;
		margin-top: 8px;
		padding: 16px;
		border: 1px solid color-mix(in srgb, var(--color-border) 45%, transparent);
		border-radius: var(--radius-md);
		background: var(--color-card);
		font-size: 13px;
		font-weight: 600;
		color: var(--color-text-primary);
	}
	.optional {
		margin-left: 6px;
		font-weight: 400;
		color: var(--color-text-muted);
	}
	.advanced input {
		min-height: 48px;
		padding: 12px 14px;
		font-size: 16px;
		font-weight: 400;
		color: var(--color-text-primary);
		background: var(--color-background);
		border: 1px solid color-mix(in srgb, var(--color-border) 65%, transparent);
		border-radius: var(--radius-md);
	}
	.search {
		display: flex;
		flex-direction: column;
	}

	.field {
		position: relative;
		display: flex;
		align-items: center;
	}

	.lead {
		position: absolute;
		left: 18px;
		display: inline-flex;
		color: var(--color-text-primary);
		pointer-events: none;
	}

	input {
		box-sizing: border-box;
		width: 100%;
		min-height: 56px;
		padding: 0 52px 0 54px;
		border: 1.5px solid color-mix(in srgb, var(--color-border) 55%, transparent);
		border-radius: var(--radius-pill);
		background: var(--color-background);
		font-size: 18px;
		color: var(--color-text-primary);
		appearance: none;
	}

	input::-webkit-search-cancel-button {
		display: none;
	}

	input::placeholder {
		color: var(--color-text-muted);
	}

	input:focus-visible {
		outline: 2px solid var(--color-primary);
		outline-offset: 1px;
		border-color: var(--color-primary);
	}

	.clear {
		position: absolute;
		right: 6px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: var(--tap-size);
		height: var(--tap-size);
		border: 0;
		border-radius: 50%;
		background: transparent;
		color: var(--color-text-secondary);
	}

	.hint {
		margin: 8px 8px 0;
		font-size: 12.5px;
		color: var(--color-text-secondary);
	}

	.hint.warn {
		color: var(--color-danger);
	}

	.catalog-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 10px;
	}

	.filters {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 10px 16px;
		margin-top: 14px;
	}

	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}

	.chip {
		min-height: 36px;
		padding: 0 16px;
		border: 0;
		border-radius: var(--radius-pill);
		background: var(--color-surface);
		font-size: 14px;
		font-weight: 600;
		color: var(--color-text-primary);
	}

	.chip:hover {
		background: var(--color-surface-pressed);
	}

	.chip[aria-pressed='true'] {
		background: var(--color-primary);
		color: var(--color-on-primary);
	}

	.chip:focus-visible,
	.select:has(select:focus-visible) {
		outline: 2px solid var(--color-primary);
		outline-offset: 2px;
	}

	.source {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 13px;
		color: var(--color-text-secondary);
	}

	.select {
		position: relative;
		display: inline-flex;
		align-items: center;
		color: var(--color-text-primary);
	}

	.select select {
		min-height: 36px;
		padding: 0 34px 0 14px;
		border: 1px solid color-mix(in srgb, var(--color-border) 45%, transparent);
		border-radius: var(--radius-pill);
		background: var(--color-card);
		font: inherit;
		font-size: 14px;
		font-weight: 600;
		color: inherit;
		appearance: none;
		cursor: pointer;
	}

	.select select:focus-visible {
		outline: none;
	}

	.select :global(svg) {
		position: absolute;
		right: 12px;
		pointer-events: none;
	}

	.results {
		margin-top: 16px;
		min-height: 120px;
	}

	.list {
		display: flex;
		flex-direction: column;
		gap: 8px;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.count {
		margin: 0 0 10px 4px;
		font-size: 12.5px;
		font-weight: 700;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--color-nav-inactive);
	}

	.more-results {
		margin-top: 12px;
	}

	.idle {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 10px;
		padding: 36px 24px;
		text-align: center;
		color: var(--color-text-secondary);
	}

	.idle p {
		max-width: 320px;
		margin: 0;
		font-size: 14px;
		line-height: 1.45;
	}

	.empty-filter {
		margin: 0 4px 12px;
		font-size: 14px;
		color: var(--color-text-secondary);
	}

	.notice {
		padding: 18px;
		border-radius: 22px;
		background: var(--color-surface);
		font-size: 14px;
		line-height: 1.45;
		color: var(--color-text-secondary);
	}

	.notice p {
		margin: 0 0 10px;
	}

	.notice .strong {
		font-family: var(--font-display);
		font-size: 18px;
		line-height: 1.25;
		color: var(--color-text-primary);
	}

	.notice-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 10px;
		margin-top: 4px;
	}

	.notice-inline,
	.warn-text {
		margin: 0 0 12px;
		padding: 10px 14px;
		border-radius: 14px;
		background: var(--color-info-tint);
		font-size: 13px;
		color: var(--color-text-primary);
	}

	.footnote {
		margin: 18px 4px 0;
		font-size: 13.5px;
		color: var(--color-text-secondary);
	}

	.footnote a {
		font-weight: 700;
		color: var(--color-text-link);
	}

	.skeleton {
		display: flex;
		gap: 16px;
		padding: 10px;
		border-radius: var(--radius-lg);
		background: var(--color-card);
		animation: pulse 1.4s ease-in-out infinite;
	}

	.s-cover {
		width: 64px;
		height: 96px;
		border-radius: 3px 8px 8px 3px;
		background: var(--color-surface);
	}

	.s-lines {
		display: flex;
		flex: 1;
		flex-direction: column;
		gap: 10px;
		padding-top: 8px;
	}

	.s-lines i {
		display: block;
		height: 12px;
		border-radius: 6px;
		background: var(--color-surface);
	}

	.s-lines i:nth-child(1) {
		width: 70%;
	}
	.s-lines i:nth-child(2) {
		width: 45%;
	}
	.s-lines i:nth-child(3) {
		width: 60%;
	}

	@keyframes pulse {
		50% {
			opacity: 0.55;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.skeleton {
			animation: none;
		}
	}

	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		margin: -1px;
		padding: 0;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}
</style>
