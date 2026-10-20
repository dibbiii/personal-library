<script lang="ts">
	import { goto } from '$app/navigation';
	import { untrack } from 'svelte';
	import { parseAddGenre, type AddSeriesContext } from '$lib/catalog/add-context';
	import BottomSheet from '$lib/components/ui/BottomSheet.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import CoverImage from './CoverImage.svelte';
	import { FORMAT_ICONS, FORMAT_LABELS } from '$lib/book/format';
	import {
		addBookToLibrary,
		CatalogClientError,
		updateBookInLibrary,
		uploadCover
	} from '$lib/catalog/client';
	import {
		buildAddRequest,
		buildUpdateBookRequest,
		candidateMeta,
		seriesLabel,
		type BookDraft
	} from '$lib/catalog/draft';
	import {
		parseSeriesNumber,
		seriesRefFromFields,
		validateSeriesFields
	} from '$lib/catalog/series-form';
	import { GENRE_LABELS, GENRE_ORDER, isGenreSlug } from '$lib/genres';
	import type { BookFormat, GenreSlug } from '$lib/contracts/enums';

	interface Props {
		mode?: 'add' | 'edit';
		open: boolean;
		draft: BookDraft | null;
		/** Genere di partenza, sempre modificabile prima della conferma. */
		initialGenre?: string | null;
		initialFormat?: BookFormat;
		/** Serie e volume da precompilare, ad esempio dallo slot mancante di una serie. */
		initialSeries?: AddSeriesContext | null;
		bookId?: string;
		onclose: () => void;
		/** Dopo l'inserimento. Senza handler si apre la scheda del libro. */
		onadded?: (bookId: string) => void;
		/** Dopo un aggiornamento, torna alla scheda aggiornata. */
		onsaved?: (reviewScoresReset: boolean) => void;
	}

	let {
		mode = 'add',
		open,
		draft,
		initialGenre = null,
		initialFormat = 'physical',
		initialSeries = null,
		bookId,
		onclose,
		onadded,
		onsaved
	}: Props = $props();

	const uid = $props.id();

	let genre = $state<GenreSlug | null>(untrack(() => parseAddGenre(initialGenre)));
	let format = $state<BookFormat | null>('physical');
	let seriesName = $state('');
	let seriesNumber = $state('');
	let seriesTotal = $state('');
	let busy = $state(false);
	let error = $state('');
	let addedBookId = $state<string | null>(null);
	let fieldError = $state<{ genre?: string; series?: string }>({});
	let duplicate = $state<{ id: string; title: string; author: string; exact: boolean } | null>(
		null
	);

	// Ogni volta che si apre per un libro diverso si riparte da capo: la scelta va sempre confermata.
	$effect(() => {
		if (!open) return;
		void draft;
		genre = untrack(() => parseAddGenre(initialGenre));
		format = mode === 'edit' ? initialFormat : 'physical';
		seriesName = initialSeries?.name ?? '';
		seriesNumber = initialSeries?.number == null ? '' : String(initialSeries.number);
		seriesTotal = initialSeries?.total == null ? '' : String(initialSeries.total);
		busy = false;
		error = '';
		fieldError = {};
		duplicate = null;
		addedBookId = null;
	});

	const numberValue = $derived(parseSeriesNumber(seriesNumber));
	const totalValue = $derived(parseSeriesNumber(seriesTotal));
	const preview = $derived(
		seriesName.trim() && numberValue !== undefined
			? seriesLabel(numberValue, totalValue ?? null)
			: null
	);

	function validate(): boolean {
		const next: typeof fieldError = {};
		if (!genre || !isGenreSlug(genre)) next.genre = 'Scegli il genere del libro.';
		const seriesError = validateSeriesFields(seriesName, numberValue, totalValue);
		if (seriesError) next.series = seriesError;
		fieldError = next;
		return Object.keys(next).length === 0;
	}

	function closeIfNotBusy() {
		if (!busy) onclose();
	}

	async function submit(force = false) {
		if (!draft || busy) return;
		error = '';
		if (!validate() || !genre || !format) {
			queueMicrotask(() =>
				document.getElementById(`${uid}-problem`)?.scrollIntoView({ block: 'center' })
			);
			return;
		}
		if (mode === 'edit' && !bookId) {
			error = 'Non riesco a trovare il libro da aggiornare.';
			return;
		}

		busy = true;
		let saved = false; // aggiornamento riuscito: un errore successivo riguarda solo la copertina
		try {
			const series = seriesRefFromFields(seriesName, numberValue, totalValue);
			if (mode === 'edit' && bookId) {
				const result = await updateBookInLibrary(
					bookId,
					buildUpdateBookRequest(draft, { genre, format, series })
				);
				if (result.status === 'duplicate') {
					duplicate = { ...result.existing, exact: true };
					return;
				}
				saved = true;
				if (draft.coverFile) await uploadCover(bookId, draft.coverFile);
				onclose();
				onsaved?.(result.reviewScoresReset);
				return;
			}

			const result = addedBookId
				? { status: 'added' as const, bookId: addedBookId }
				: await addBookToLibrary(buildAddRequest(draft, { genre, format, series }, force));
			if (result.status === 'duplicate') {
				duplicate = { ...result.existing, exact: result.exact };
				return;
			}
			addedBookId = result.bookId;
			if (draft.coverFile) await uploadCover(result.bookId, draft.coverFile);
			if (onadded) onadded(result.bookId);
			else await goto(`/book/${result.bookId}`);
		} catch (caught) {
			error =
				mode === 'add' && addedBookId
					? 'Il libro è stato aggiunto, ma la copertina non è stata caricata. Puoi riprovare oppure aprire il libro.'
					: mode === 'edit' && saved
						? 'Le modifiche sono state salvate, ma la copertina non è stata caricata. Puoi riprovare.'
						: caught instanceof CatalogClientError
							? caught.message
							: mode === 'edit'
								? 'Non sono riuscito a salvare le modifiche. Riprova.'
								: 'Non sono riuscito ad aggiungere il libro. Riprova.';
		} finally {
			busy = false;
		}
	}

	const meta = $derived(draft ? candidateMeta(draft) : '');
</script>

<BottomSheet
	{open}
	title={mode === 'edit' ? 'Modifica libro' : 'Aggiungi alla libreria'}
	subtitle={mode === 'edit' ? 'Conferma le modifiche' : 'Conferma come vuoi averlo'}
	onclose={closeIfNotBusy}
>
	{#if draft}
		<div class="preview">
			<CoverImage src={draft.coverUrl} width={64} height={96} />
			<div class="preview-text">
				<p class="title">{draft.title}</p>
				<p class="author">{draft.author}</p>
				{#if meta}<p class="meta">{meta}</p>{/if}
			</div>
		</div>

		{#if duplicate}
			<div class="duplicate" role="alert">
				<h3>
					{duplicate.exact
						? 'Questo libro è già in libreria'
						: 'Hai già un libro con questo titolo'}
				</h3>
				<p>
					<strong>{duplicate.title}</strong> di {duplicate.author}
					{duplicate.exact
						? 'ha lo stesso ISBN o la stessa edizione.'
						: 'è già nella tua libreria. Potrebbe essere un’altra edizione.'}
				</p>
				<div class="actions">
					<Button href={`/book/${duplicate.id}`} fullWidth>Apri il libro</Button>
					{#if !duplicate.exact}
						<Button variant="secondary" fullWidth loading={busy} onclick={() => submit(true)}>
							Aggiungi comunque
						</Button>
					{/if}
					<Button variant="ghost" fullWidth disabled={busy} onclick={closeIfNotBusy}>
						Annulla
					</Button>
				</div>
			</div>
		{:else}
			<form
				class="form"
				method="dialog"
				novalidate
				onsubmit={(event) => {
					event.preventDefault();
					submit();
				}}
			>
				<fieldset class="group">
					<legend>Genere</legend>
					<div
						class="genres"
						role="radiogroup"
						aria-label="Genere"
						aria-describedby={fieldError.genre ? `${uid}-problem` : undefined}
					>
						{#each GENRE_ORDER as slug (slug)}
							<label class="genre-row" style:--dot="var(--genre-{slug})">
								<input type="radio" name="{uid}-genre" value={slug} bind:group={genre} />
								<span class="dot" aria-hidden="true"></span>
								<span class="label">{GENRE_LABELS[slug]}</span>
								<span class="tick" aria-hidden="true"
									><Icon name="check" size={18} strokeWidth={2.6} /></span
								>
							</label>
						{/each}
					</div>
				</fieldset>

				<fieldset class="group">
					<legend>Formato</legend>
					<div class="formats" role="radiogroup" aria-label="Formato">
						{#each ['physical', 'digital', 'both'] as const as option (option)}
							<label class="format">
								<input type="radio" name="{uid}-format" value={option} bind:group={format} />
								<Icon name={FORMAT_ICONS[option]} size={18} strokeWidth={2} />
								{FORMAT_LABELS[option]}
							</label>
						{/each}
					</div>
				</fieldset>

				<fieldset class="group">
					<legend>Serie <span class="optional">(facoltativa)</span></legend>
					<div class="series">
						<label class="field">
							<span>Nome della serie</span>
							<input
								type="text"
								bind:value={seriesName}
								autocomplete="off"
								maxlength="160"
								placeholder="es. Le Cronache dell’Assassino del Re"
							/>
						</label>
						<div class="pair">
							<label class="field">
								<span>Numero volume</span>
								<input
									type="text"
									inputmode="decimal"
									bind:value={seriesNumber}
									autocomplete="off"
									placeholder="es. 2"
								/>
							</label>
							<label class="field">
								<span>Volumi totali</span>
								<input
									type="text"
									inputmode="numeric"
									bind:value={seriesTotal}
									autocomplete="off"
									placeholder="es. 3"
								/>
							</label>
						</div>
						{#if preview}<p class="series-preview" aria-live="polite">Serie: {preview}</p>{/if}
					</div>
				</fieldset>

				{#if fieldError.genre || fieldError.series || error}
					<p id="{uid}-problem" class="problem" role="alert">
						{fieldError.genre ?? fieldError.series ?? error}
					</p>
				{/if}

				<div class="actions row">
					<Button variant="secondary" fullWidth disabled={busy} onclick={closeIfNotBusy}>
						Annulla
					</Button>
					<Button type="submit" fullWidth loading={busy}
						>{mode === 'edit'
							? 'Salva modifiche'
							: addedBookId
								? 'Riprova il caricamento'
								: 'Aggiungi'}</Button
					>
					{#if addedBookId}<Button variant="ghost" href={`/book/${addedBookId}`}
							>Apri il libro</Button
						>{/if}
				</div>
			</form>
		{/if}
	{/if}
</BottomSheet>

<style>
	.preview {
		display: flex;
		align-items: center;
		gap: 14px;
		margin: 6px 0 8px;
		padding: 12px;
		border-radius: 20px;
		background: var(--color-surface);
	}

	.preview-text {
		min-width: 0;
	}

	.preview-text p {
		margin: 0;
	}

	.title {
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
		font-family: var(--font-display);
		font-size: 18px;
		line-height: 1.2;
	}

	.author {
		margin-top: 2px !important;
		font-size: 13.5px;
		font-weight: 600;
		color: var(--color-text-link);
	}

	.meta {
		margin-top: 4px !important;
		font-size: 12px;
		color: var(--color-text-secondary);
	}

	.form {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.group {
		min-width: 0;
		margin: 14px 0 0;
		padding: 0;
		border: 0;
	}

	legend {
		padding: 0;
		margin-bottom: 8px;
		font-size: 14px;
		font-weight: 700;
	}

	.optional {
		font-weight: 500;
		color: var(--color-text-secondary);
	}

	.genres {
		padding: 6px;
		border-radius: 16px;
		background: var(--color-surface);
	}

	.genre-row {
		position: relative;
		display: flex;
		align-items: center;
		gap: 12px;
		min-height: var(--tap-size);
		padding: 6px 12px;
		border-radius: 12px;
		font-size: 14.5px;
		font-weight: 500;
		cursor: pointer;
	}

	.genre-row input,
	.format input {
		position: absolute;
		opacity: 0;
		inset: 0;
		margin: 0;
		cursor: pointer;
	}

	.dot {
		flex-shrink: 0;
		width: 16px;
		height: 16px;
		border-radius: 50%;
		background: var(--dot);
		box-shadow: 0 0 8px 1px color-mix(in srgb, var(--dot) 60%, transparent);
	}

	.label {
		flex: 1;
		line-height: 1.25;
	}

	.tick {
		display: none;
		color: var(--color-primary);
	}

	.genre-row:has(input:checked) {
		background: color-mix(in srgb, var(--color-accent) 40%, transparent);
		font-weight: 700;
	}

	.genre-row:has(input:checked) .tick {
		display: inline-flex;
	}

	.genre-row:has(input:focus-visible),
	.format:has(input:focus-visible) {
		outline: 2px solid var(--color-primary);
		outline-offset: 1px;
	}

	.formats {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 10px;
	}

	.format {
		position: relative;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 8px;
		min-height: 48px;
		border: 1.5px solid color-mix(in srgb, var(--color-nav-inactive) 30%, transparent);
		border-radius: 24px;
		font-size: 15px;
		font-weight: 600;
		cursor: pointer;
	}

	.format:has(input:checked) {
		border-color: var(--color-primary);
		background: var(--color-primary);
		color: var(--color-on-primary);
		font-weight: 700;
	}

	.series {
		display: flex;
		flex-direction: column;
		gap: 10px;
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

	.field input {
		box-sizing: border-box;
		width: 100%;
		min-height: var(--tap-size);
		padding: 0 14px;
		border: 1.5px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-card);
		font-size: 16px;
		font-weight: 400;
		color: var(--color-text-primary);
	}

	.field input::placeholder {
		color: var(--color-text-muted);
	}

	.field input:focus-visible {
		outline: 2px solid var(--color-primary);
		outline-offset: 1px;
		border-color: var(--color-primary);
	}

	.series-preview {
		margin: 0;
		font-size: 15px;
		font-weight: 700;
		color: var(--color-text-primary);
	}

	.problem {
		margin: 14px 0 0;
		padding: 10px 14px;
		border-radius: 14px;
		background: color-mix(in srgb, var(--color-danger) 12%, transparent);
		font-size: 13.5px;
		font-weight: 600;
		color: var(--color-danger);
	}

	.actions {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.actions.row {
		flex-direction: row;
		position: sticky;
		bottom: 0;
		margin-top: 18px;
		padding-top: 12px;
		background: linear-gradient(to top, var(--color-background) 78%, transparent);
	}

	.duplicate {
		margin-top: 6px;
		padding: 18px;
		border-radius: 22px;
		background: var(--color-surface);
	}

	.duplicate h3 {
		margin: 0 0 8px;
		font-size: 19px;
		line-height: 1.25;
	}

	.duplicate p {
		margin: 0 0 16px;
		font-size: 14px;
		line-height: 1.45;
		color: var(--color-text-secondary);
	}
</style>
