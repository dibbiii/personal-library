<script lang="ts">
	import { onDestroy, untrack } from 'svelte';
	import { fetchEditions } from '$lib/catalog/client';
	import CoverImage from './CoverImage.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import RatingStars from '$lib/components/ui/RatingStars.svelte';
	import CoverAttachment from './CoverAttachment.svelte';
	import type { BookInfo } from '$lib/catalog/book-info';
	import { draftWithEdition, isSameEdition, type BookDraft } from '$lib/catalog/draft';
	import { parsePublishedDate } from '$lib/catalog/published-date';
	import { LANGUAGE_LABELS, languageLabel } from '$lib/catalog/language';
	import type { IconName } from '$lib/components/ui/icons';

	interface Props {
		draft: BookDraft;
		/** Informazioni pubbliche (Open Library); null se non trovate o non ancora arrivate. */
		info: BookInfo | null;
		infoLoading: boolean;
		/** Cambio di edizione: il chiamante sostituisce la bozza. */
		onchange: (draft: BookDraft) => void;
		/** Bozza definitiva: il chiamante apre il passo successivo. */
		oncontinue: (draft: BookDraft) => void;
		/** Id del titolo, se un dialogo lo usa come etichetta. */
		headingId?: string;
		/** Scheda del libro se è già in libreria. */
		ownedHref?: string | null;
		actionLabel?: string;
		actionIcon?: IconName;
		allowMetadataCustomization?: boolean;
		allowCoverAttachment?: boolean;
	}

	let {
		draft,
		info,
		infoLoading,
		onchange,
		oncontinue,
		headingId,
		ownedHref = null,
		actionLabel,
		actionIcon = 'plus',
		allowMetadataCustomization = true,
		allowCoverAttachment = true
	}: Props = $props();

	const uid = $props.id();
	const titleId = $derived(headingId ?? `${uid}-title`);
	const numbers = new Intl.NumberFormat('it-IT', { notation: 'compact', maximumFractionDigits: 1 });
	const EDITIONS_PREVIEW = 4;

	let descriptionOpen = $state(false);
	let allEditions = $state(false);
	let loadedEditions = $state<BookInfo['editions']>([]);
	let nextOffset = $state<number | null>(0);
	let editionsLoading = $state(false);
	let editionsError = $state('');
	let editionLanguage = $state('all');
	let editionOrder = $state('newest');
	let editionController: AbortController | undefined;
	const workId = $derived(
		draft.edition?.providerIds.openLibraryWorkId ??
			info?.workUrl.match(/\/(OL[0-9]+W)$/)?.[1] ??
			null
	);
	$effect(() => {
		void workId;
		untrack(() => {
			editionController?.abort();
			loadedEditions = [];
			nextOffset = 0;
			editionsError = '';
			editionsLoading = false;
			allEditions = false;
			editionLanguage = 'all';
		});
	});
	onDestroy(() => editionController?.abort());
	async function loadMoreEditions() {
		if (!workId || nextOffset === null || editionsLoading) return;
		editionController = new AbortController();
		const { signal } = editionController;
		editionsLoading = true;
		editionsError = '';
		try {
			const result = await fetchEditions(workId, nextOffset, signal);
			if (signal.aborted) return;
			loadedEditions = [
				...new Map([...loadedEditions, ...result.editions].map((e) => [e.url, e])).values()
			];
			nextOffset = result.nextOffset;
			allEditions = true;
		} catch {
			if (!signal.aborted) editionsError = 'Non riesco a caricare altre edizioni. Riprova.';
		} finally {
			if (!signal.aborted) editionsLoading = false;
		}
	}
	let customizing = $state(false);
	let title = $state('');
	let author = $state('');
	let pages = $state('');
	let language = $state('');
	let coverFile = $state<File | null>(null);
	let coverBusy = $state(false);
	let recoveredCover = $state<{ isbn: string | null; primary: string | null; url: string } | null>(
		null
	);
	let errors = $state<{ title?: string; author?: string; pages?: string }>({});

	// Ogni bozza nuova (altro libro o altra edizione) riparte dai suoi dati.
	$effect(() => {
		const next = draft;
		untrack(() => {
			title = next.title;
			author = next.author;
			pages = next.pageCount ? String(next.pageCount) : '';
			language = next.language ?? '';
			coverFile = next.coverFile ?? null;
			coverBusy = false;
			errors = {};
		});
	});

	const editionYear = $derived(parsePublishedDate(draft.publishedDate).year);
	const firstPublishYear = $derived(info?.firstPublishYear ?? null);
	const pageCount = $derived(draft.pageCount);
	const subjects = $derived(info?.subjects.slice(0, 3) ?? []);
	const editions = $derived.by(() => {
		const infoMatchesWork = !workId || info?.workUrl.endsWith(`/works/${workId}`);
		const entries = [
			...new Map(
				[...(infoMatchesWork ? (info?.editions ?? []) : []), ...loadedEditions].map((e) => [
					e.url,
					e
				])
			).values()
		];
		return entries
			.filter((e) => editionLanguage === 'all' || e.language === editionLanguage)
			.sort(
				(a, b) =>
					(editionOrder === 'newest'
						? (b.year ?? 0) - (a.year ?? 0)
						: (a.year ?? 9999) - (b.year ?? 9999)) || a.url.localeCompare(b.url)
			);
	});
	const shownEditions = $derived(allEditions ? editions : editions.slice(0, EDITIONS_PREVIEW));
	const languages = $derived.by(() => {
		const entries = Object.entries(LANGUAGE_LABELS);
		if (draft.language && !LANGUAGE_LABELS[draft.language]) {
			entries.push([draft.language, languageLabel(draft.language) ?? draft.language]);
		}
		return entries;
	});

	function editionLabel(edition: BookInfo['editions'][number]): string {
		// Solo le lingue note: un codice grezzo ("bel") non dice nulla.
		const label = LANGUAGE_LABELS[edition.language ?? ''];
		return label ? `Edizione in ${label.toLowerCase()}` : edition.title;
	}

	function isCurrent(edition: BookInfo['editions'][number]): boolean {
		return isSameEdition(draft, edition);
	}

	function pickEdition(edition: BookInfo['editions'][number]) {
		if (!workId || isCurrent(edition)) return;
		onchange(
			draftWithEdition(draft, edition, `https://openlibrary.org/works/${workId}`, info?.workTitle)
		);
	}

	function validate(): boolean {
		const next: typeof errors = {};
		if (!title.trim()) next.title = 'Scrivi il titolo.';
		if (!author.trim()) next.author = 'Scrivi l’autore.';
		const pageText = pages.trim();
		if (pageText) {
			const count = Number(pageText);
			if (!Number.isInteger(count) || count < 1 || count > 20000) {
				next.pages = 'Inserisci un numero di pagine tra 1 e 20000.';
			}
		}
		errors = next;
		return Object.keys(next).length === 0;
	}

	function continueWithDraft() {
		if (coverBusy) return;
		const coverUrl =
			recoveredCover?.isbn === draft.isbn && recoveredCover?.primary === draft.coverUrl
				? recoveredCover.url
				: draft.coverUrl;
		if (!customizing) {
			oncontinue({ ...draft, coverUrl, coverFile });
			return;
		}
		if (!validate()) return;
		oncontinue({
			...draft,
			coverUrl,
			coverFile,
			title: title.trim(),
			author: author.trim(),
			pageCount: pages.trim() ? Number(pages.trim()) : null,
			language: language || null
		});
	}
</script>

<article class="detail" aria-labelledby={titleId}>
	<header class="head">
		<CoverImage
			src={draft.coverUrl}
			isbn={draft.isbn}
			width={156}
			height={234}
			alt=""
			eager
			onresolved={(url) => {
				recoveredCover = { isbn: draft.isbn, primary: draft.coverUrl, url };
			}}
		/>
		<div class="head-text">
			<h2 id={titleId}>{draft.title}</h2>
			<p class="author">{draft.author}</p>

			{#if info?.rating}
				<p class="rating">
					<RatingStars value={Math.round(info.rating.average)} size={18} label="Voto medio" />
					<span>
						<strong>{info.rating.average.toLocaleString('it-IT')}</strong>
						({numbers.format(info.rating.count)} voti)
					</span>
				</p>
			{/if}

			{#if subjects.length > 0}
				<ul class="chips" aria-label="Temi">
					{#each subjects as subject (subject)}<li>{subject}</li>{/each}
				</ul>
			{:else if infoLoading}
				<div class="chips" aria-hidden="true">
					<span class="chip-skeleton"></span><span class="chip-skeleton"></span>
				</div>
			{/if}

			<dl class="facts">
				{#if pageCount}
					<div>
						<Icon name="book-open" size={20} />
						<dt>pagine</dt>
						<dd>{pageCount}</dd>
					</div>
				{/if}
				{#if editionYear}
					<div>
						<Icon name="calendar" size={20} />
						<dt>Anno dell’edizione</dt>
						<dd>{editionYear}</dd>
					</div>
				{/if}
				{#if firstPublishYear}
					<div>
						<Icon name="calendar" size={20} />
						<dt>Prima pubblicazione dell’opera</dt>
						<dd>{firstPublishYear}</dd>
					</div>
				{/if}
				{#if languageLabel(draft.language)}
					<div>
						<Icon name="globe" size={20} />
						<dt>Lingua</dt>
						<dd>{languageLabel(draft.language)}</dd>
					</div>
				{/if}
			</dl>
		</div>
	</header>

	<section class="block" aria-labelledby="{uid}-about">
		<h3 id="{uid}-about">Descrizione</h3>
		{#if info?.description}
			<p class="description" class:open={descriptionOpen} id="{uid}-description">
				{info.description.text}
			</p>
			<div class="more-row">
				{#if info.description.language && info.description.language !== 'it'}
					<span class="lang"
						>Testo in {languageLabel(info.description.language)?.toLowerCase()}</span
					>
				{/if}
				<button
					type="button"
					class="more"
					aria-expanded={descriptionOpen}
					aria-controls="{uid}-description"
					aria-label={descriptionOpen ? 'Mostra meno' : 'Mostra tutta la descrizione'}
					onclick={() => (descriptionOpen = !descriptionOpen)}
				>
					<Icon name={descriptionOpen ? 'chevron-up' : 'chevron-down'} size={18} />
				</button>
			</div>
		{:else if infoLoading}
			<div class="lines" aria-busy="true" aria-label="Carico la descrizione">
				<i></i><i></i><i></i>
			</div>
		{:else}
			<p class="muted">Nessuna descrizione disponibile.</p>
		{/if}
	</section>

	{#if editions.length > 0 || infoLoading || workId}
		<section class="block" aria-labelledby="{uid}-editions">
			<div class="block-head">
				<h3 id="{uid}-editions">Edizioni disponibili</h3>
				{#if editions.length > EDITIONS_PREVIEW}
					<button type="button" class="see-all" onclick={() => (allEditions = !allEditions)}>
						{allEditions ? 'Mostra meno' : `Mostra le ${editions.length} edizioni caricate`}
						<Icon name={allEditions ? 'chevron-up' : 'arrow-right'} size={16} strokeWidth={2.2} />
					</button>
				{/if}
			</div>
			<div class="edition-controls">
				<label
					>Lingua delle edizioni <select bind:value={editionLanguage}
						><option value="all">Tutte le lingue</option
						>{#each Object.entries(LANGUAGE_LABELS) as [code, label] (code)}<option value={code}
								>{label}</option
							>{/each}</select
					></label
				>
				<label
					>Ordine delle edizioni <select bind:value={editionOrder}
						><option value="newest">Più recenti</option><option value="oldest">Meno recenti</option
						></select
					></label
				>
			</div>
			{#if editions.length > 0}
				<ul class="editions">
					{#each shownEditions as edition (edition.url)}
						<li>
							<button
								type="button"
								class="edition"
								aria-pressed={isCurrent(edition)}
								aria-label="Scegli {editionLabel(edition)}{edition.publisher
									? `, ${edition.publisher}`
									: ''}{edition.year ? `, ${edition.year}` : ''}"
								onclick={() => pickEdition(edition)}
							>
								<CoverImage src={edition.coverUrl} isbn={edition.isbn13} width={88} height={124} />
								<span class="edition-label">{editionLabel(edition)}</span>
								<span class="edition-meta">
									{[edition.publisher, edition.year].filter(Boolean).join(', ')}
								</span>
							</button>
						</li>
					{/each}
				</ul>
			{:else if infoLoading}
				<div class="editions" aria-hidden="true">
					{#each [0, 1, 2, 3] as n (n)}<span class="edition-skeleton"></span>{/each}
				</div>
			{:else}<p class="muted">Nessuna edizione caricata per questa lingua.</p>
			{/if}
			{#if workId && nextOffset !== null}<Button
					variant="secondary"
					disabled={editionsLoading}
					onclick={loadMoreEditions}
					>{editionsLoading ? 'Carico le edizioni…' : 'Carica altre edizioni'}</Button
				>{/if}
			{#if editionsError}<p role="alert">{editionsError}</p>{/if}
		</section>
	{/if}

	<div class="actions">
		{#if allowCoverAttachment}
			{#key draft.edition?.providerIds.openLibraryEditionId ?? draft.isbn ?? draft.title}
				<CoverAttachment
					onchange={(file) => (coverFile = file)}
					onbusychange={(busy) => (coverBusy = busy)}
				/>
			{/key}
		{/if}
		{#if ownedHref}
			<p class="owned">
				<Icon name="check" size={18} strokeWidth={2.4} />
				<span>Questo libro è già nella tua libreria.</span>
				<a href={ownedHref}>Apri il libro</a>
			</p>
		{/if}
		<Button
			size="lg"
			fullWidth
			disabled={coverBusy}
			variant={ownedHref ? 'secondary' : 'primary'}
			onclick={continueWithDraft}
		>
			{#snippet icon()}<Icon name={actionIcon} size={20} strokeWidth={2.2} />{/snippet}
			{actionLabel ?? (ownedHref ? 'Aggiungi un’altra copia' : 'Aggiungi alla mia libreria')}
		</Button>

		{#if allowMetadataCustomization}
			<button
				type="button"
				class="customize"
				aria-expanded={customizing}
				aria-controls="{uid}-custom"
				onclick={() => (customizing = !customizing)}
			>
				<Icon name="pencil" size={20} />
				<span>Personalizza prima di aggiungere</span>
				<Icon name={customizing ? 'chevron-up' : 'chevron-down'} size={18} />
			</button>

			{#if customizing}
				<div class="custom" id="{uid}-custom">
					<label class="field">
						<span>Titolo</span>
						<input
							type="text"
							bind:value={title}
							maxlength="300"
							aria-invalid={errors.title ? 'true' : undefined}
						/>
						{#if errors.title}<em role="alert">{errors.title}</em>{/if}
					</label>
					<label class="field">
						<span>Autore</span>
						<input
							type="text"
							bind:value={author}
							maxlength="300"
							aria-invalid={errors.author ? 'true' : undefined}
						/>
						{#if errors.author}<em role="alert">{errors.author}</em>{/if}
					</label>
					<div class="pair">
						<label class="field">
							<span>Pagine</span>
							<input
								type="text"
								inputmode="numeric"
								bind:value={pages}
								aria-invalid={errors.pages ? 'true' : undefined}
							/>
						</label>
						<label class="field">
							<span>Lingua</span>
							<select bind:value={language}>
								<option value="">Non indicata</option>
								{#each languages as [code, label] (code)}
									<option value={code}>{label}</option>
								{/each}
							</select>
						</label>
					</div>
					{#if errors.pages}<em class="pair-error" role="alert">{errors.pages}</em>{/if}
					<p class="custom-note">
						Genere, formato e serie li scegli al passo successivo; la copertina puoi cambiarla dalla
						scheda del libro.
					</p>
				</div>
			{/if}
		{/if}
	</div>
</article>

<style>
	.edition-controls {
		display: flex;
		flex-wrap: wrap;
		gap: 12px;
		margin-bottom: 12px;
	}
	.edition-controls label {
		display: grid;
		gap: 6px;
		font-size: 0.85rem;
	}
	.edition-controls select {
		padding: 8px;
		color: var(--color-text-primary);
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
	}
	.detail {
		display: flex;
		flex-direction: column;
		gap: 22px;
		color: var(--color-text-primary);
	}

	.head {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr);
		align-items: start;
		gap: 22px;
		padding-bottom: 22px;
		border-bottom: 1px solid color-mix(in srgb, var(--color-border) 30%, transparent);
	}

	.head-text {
		display: flex;
		flex-direction: column;
		gap: 12px;
		min-width: 0;
	}

	h2 {
		margin: 0;
		font-family: var(--font-display);
		font-size: 30px;
		font-weight: 400;
		line-height: 1.1;
		color: var(--color-primary);
		overflow-wrap: anywhere;
	}

	.author {
		margin: -6px 0 0;
		font-size: 17px;
		color: var(--color-text-secondary);
	}

	.rating {
		--genre-current: var(--color-flame);
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px;
		margin: 0;
		font-size: 14px;
		color: var(--color-text-secondary);
	}

	.rating strong {
		color: var(--color-text-primary);
	}

	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.chips li,
	.chip-skeleton {
		display: inline-flex;
		align-items: center;
		min-height: 32px;
		padding: 0 14px;
		border-radius: var(--radius-pill);
		background: var(--color-surface);
		font-size: 13px;
		font-weight: 600;
	}

	.chip-skeleton {
		width: 84px;
		padding: 0;
	}

	.facts {
		display: flex;
		flex-wrap: wrap;
		gap: 12px 22px;
		margin: 4px 0 0;
	}

	.facts > div {
		display: grid;
		grid-template-columns: auto auto;
		grid-template-areas: 'icon value' 'label label';
		align-items: center;
		justify-content: start;
		column-gap: 8px;
	}

	.facts :global(svg) {
		grid-area: icon;
		color: var(--color-text-secondary);
	}

	.facts dd {
		grid-area: value;
		margin: 0;
		font-size: 16px;
		font-weight: 700;
	}

	.facts dt {
		grid-area: label;
		margin-top: 2px;
		font-size: 12px;
		color: var(--color-text-secondary);
	}

	.block {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.block-head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 12px;
	}

	h3 {
		margin: 0;
		font-size: 17px;
		font-weight: 700;
	}

	.description {
		display: -webkit-box;
		-webkit-line-clamp: 3;
		line-clamp: 3;
		-webkit-box-orient: vertical;
		overflow: hidden;
		margin: 0;
		font-size: 15px;
		line-height: 1.55;
		white-space: pre-line;
	}

	.description.open {
		display: block;
	}

	.more-row {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 12px;
		margin-top: -6px;
	}

	.lang {
		margin-right: auto;
		font-size: 12.5px;
		color: var(--color-text-muted);
	}

	.more,
	.see-all {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		min-height: 32px;
		border: 0;
		background: transparent;
		color: var(--color-primary);
		font-size: 14px;
		font-weight: 700;
	}

	.more {
		justify-content: center;
		width: 36px;
		border-radius: 50%;
		color: var(--color-text-secondary);
	}

	.more:hover {
		background: var(--color-surface);
	}

	.muted {
		margin: 0;
		font-size: 14px;
		color: var(--color-text-secondary);
	}

	.lines {
		display: flex;
		flex-direction: column;
		gap: 9px;
	}

	.lines i {
		display: block;
		height: 12px;
		border-radius: 6px;
		background: var(--color-surface);
	}

	.lines i:nth-child(2) {
		width: 88%;
	}

	.lines i:nth-child(3) {
		width: 60%;
	}

	.editions {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
		gap: 14px 12px;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.edition {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 4px;
		width: 100%;
		padding: 6px;
		border: 1.5px solid transparent;
		border-radius: var(--radius-md);
		background: transparent;
		text-align: left;
		color: inherit;
	}

	.edition:hover {
		background: var(--color-surface);
	}

	.edition[aria-pressed='true'] {
		border-color: var(--color-primary-outline);
		background: color-mix(in srgb, var(--color-primary) 7%, transparent);
	}

	.edition :global(.cover) {
		margin-bottom: 6px;
	}

	.edition-label {
		font-size: 13px;
		font-weight: 700;
		line-height: 1.25;
	}

	.edition-meta {
		font-size: 12px;
		line-height: 1.3;
		color: var(--color-text-secondary);
	}

	.edition-skeleton {
		height: 160px;
		border-radius: var(--radius-md);
		background: var(--color-surface);
	}

	.chip-skeleton,
	.lines,
	.edition-skeleton {
		animation: pulse 1.4s ease-in-out infinite;
	}

	@keyframes pulse {
		50% {
			opacity: 0.55;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.chip-skeleton,
		.lines,
		.edition-skeleton {
			animation: none;
		}
	}

	.actions {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	.actions :global(.btn.lg) {
		border-radius: var(--radius-pill);
	}

	.owned {
		display: flex;
		align-items: center;
		gap: 10px;
		margin: 0;
		padding: 12px 16px;
		border-radius: var(--radius-lg);
		background: var(--color-primary-tint);
		font-size: 14px;
		font-weight: 600;
	}

	.owned span {
		flex: 1;
	}

	.owned a {
		font-weight: 700;
		color: var(--color-primary);
	}

	.customize {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 12px;
		min-height: 52px;
		padding: 0 20px;
		border: 1px solid color-mix(in srgb, var(--color-border) 40%, transparent);
		border-radius: var(--radius-pill);
		background: var(--color-surface);
		font-size: 16px;
		font-weight: 600;
		color: var(--color-text-primary);
	}

	.customize:hover {
		background: var(--color-surface-pressed);
	}

	.customize span {
		flex: 0 1 auto;
	}

	.customize :global(svg:last-child) {
		margin-left: 8px;
	}

	.customize:focus-visible,
	.edition:focus-visible,
	.more:focus-visible,
	.see-all:focus-visible {
		outline: 2px solid var(--color-primary);
		outline-offset: 2px;
	}

	.custom {
		display: flex;
		flex-direction: column;
		gap: 12px;
		padding: 16px;
		border-radius: var(--radius-lg);
		background: var(--color-surface);
	}

	.pair {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 10px;
	}

	.field {
		display: flex;
		flex-direction: column;
		gap: 4px;
		font-size: 12.5px;
		font-weight: 600;
		color: var(--color-text-secondary);
	}

	.field input,
	.field select {
		box-sizing: border-box;
		width: 100%;
		min-height: var(--tap-size);
		padding: 0 14px;
		border: 1.5px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-card);
		font: inherit;
		font-size: 16px;
		font-weight: 400;
		color: var(--color-text-primary);
	}

	.field input:focus-visible,
	.field select:focus-visible {
		outline: 2px solid var(--color-primary);
		outline-offset: 1px;
		border-color: var(--color-primary);
	}

	.field input[aria-invalid='true'] {
		border-color: var(--color-danger);
	}

	.field em,
	.pair-error {
		font-size: 12.5px;
		font-style: normal;
		font-weight: 600;
		color: var(--color-danger);
	}

	.custom-note {
		margin: 0;
		font-size: 13px;
		line-height: 1.45;
		color: var(--color-text-secondary);
	}

	@media (max-width: 520px) {
		.head {
			grid-template-columns: 1fr;
			justify-items: center;
			text-align: center;
		}

		.head-text {
			align-items: center;
		}

		.chips,
		.facts,
		.rating {
			justify-content: center;
		}

		.customize {
			font-size: 15px;
		}
	}
</style>
