<script lang="ts">
	import { invalidate } from '$app/navigation';
	import { seriesVolumeLabel, seriesVolumes } from '$lib/client/reading-logic';
	import { buildAddHref } from '$lib/catalog/add-context';
	import { CatalogClientError, updateBookInLibrary } from '$lib/catalog/client';
	import { parseSeriesNumber, validateSeriesFields } from '$lib/catalog/series-form';
	import type { SeriesBook, SeriesRef } from '$lib/contracts';
	import type { BookFormat, GenreSlug } from '$lib/contracts/enums';
	import Button from '$lib/components/ui/Button.svelte';
	import { SvelteURLSearchParams } from 'svelte/reactivity';
	import { untrack } from 'svelte';

	interface Props {
		series: SeriesRef;
		books: SeriesBook[];
		currentBookId: string;
		/** Genere e formato del libro corrente: il totale non li cambia. */
		genre: GenreSlug;
		format: BookFormat;
	}

	let { series, books, currentBookId, genre, format }: Props = $props();

	const orderedBooks = $derived(
		[...books].sort((a, b) => {
			if (a.number === null) return b.number === null ? a.title.localeCompare(b.title, 'it') : 1;
			if (b.number === null) return -1;
			return (
				a.number - b.number || a.title.localeCompare(b.title, 'it') || a.id.localeCompare(b.id)
			);
		})
	);
	const volumes = $derived(seriesVolumes(orderedBooks, series.total));
	const label = $derived(seriesVolumeLabel(series.number, series.total));

	function volumeNumber(number: number): string {
		return String(number).replace('.', ',');
	}

	function addVolumeHref(number: number): string {
		const params = new SvelteURLSearchParams({
			seriesName: series.name,
			seriesNumber: String(number)
		});
		if (series.total !== null) params.set('seriesTotal', String(series.total));
		return buildAddHref('/add/manual', genre, params);
	}

	// ---- Volumi totali: condivisi da tutta la serie (change_book_series) ----------------

	let totalText = $state(untrack(() => (series.total === null ? '' : String(series.total))));
	let totalBusy = $state(false);
	let totalError = $state<string | null>(null);

	// Dopo il salvataggio la scheda si ricarica: il campo segue il totale appena salvato.
	$effect(() => {
		const saved = series.total === null ? '' : String(series.total);
		if (!totalBusy) totalText = saved;
	});

	async function saveTotal(event: SubmitEvent) {
		event.preventDefault();
		if (totalBusy) return;
		totalError = null;

		const total = parseSeriesNumber(totalText);
		const problem = validateSeriesFields(series.name, series.number, total);
		if (problem || total === undefined) {
			totalError = problem ?? 'Il totale dei volumi deve essere un intero tra 1 e 999.';
			return;
		}
		// L'API traduce l'errore 22023 del database in un messaggio generico:
		// il confronto con i volumi già presenti si fa qui, con un messaggio utile.
		const highest = Math.max(0, ...books.map((book) => book.number ?? 0));
		if (total !== null && total < highest) {
			totalError = `Esiste già il volume ${volumeNumber(highest)}: il totale non può essere inferiore.`;
			return;
		}

		totalBusy = true;
		try {
			await updateBookInLibrary(currentBookId, {
				genre,
				format,
				series: { name: series.name, number: series.number, total }
			});
			await invalidate(`app:book:${currentBookId}`);
		} catch (caught) {
			totalError =
				caught instanceof CatalogClientError
					? caught.message
					: 'Non sono riuscito ad aggiornare il totale. Riprova.';
		} finally {
			totalBusy = false;
		}
	}
</script>

<section class="series" aria-label={`Serie ${series.name}`}>
	{#if volumes.length > 0}
		<ol class="spines" aria-label={`Volumi di ${series.name}`} role="list">
			{#each volumes as volume (volume.book?.id ?? `missing-${volume.number}`)}
				<li>
					{#if volume.book}
						<a
							class="spine {volume.book.id === currentBookId ? 'current' : 'present'}"
							href={`/book/${volume.book.id}`}
							aria-label={`Volume ${volumeNumber(volume.number)}: ${volume.book.title}`}
							aria-current={volume.book.id === currentBookId ? 'page' : undefined}
						>
							{volumeNumber(volume.number)}
						</a>
					{:else}
						<a
							class="spine missing"
							href={addVolumeHref(volume.number)}
							aria-label={`Aggiungi volume ${volumeNumber(volume.number)} alla serie ${series.name}`}
						>
							{volumeNumber(volume.number)}
						</a>
					{/if}
				</li>
			{/each}
		</ol>
	{/if}
	<div class="text">
		<p class="vol">Serie: {label ?? series.name}</p>
		{#if label}<p class="name">{series.name}</p>{/if}
	</div>
	<form class="total" onsubmit={saveTotal} novalidate>
		<label class="total-label" for="series-total">Volumi totali</label>
		<div class="total-row">
			<input
				id="series-total"
				type="text"
				inputmode="numeric"
				autocomplete="off"
				bind:value={totalText}
				aria-invalid={totalError ? 'true' : undefined}
			/>
			<Button type="submit" size="sm" loading={totalBusy}>Aggiorna totale</Button>
		</div>
		{#if totalError}<p class="total-error" role="alert">{totalError}</p>{/if}
	</form>
	{#if orderedBooks.length > 0}
		<ol class="book-list" aria-label={`Libri della serie ${series.name}`} role="list">
			{#each orderedBooks as book (book.id)}
				<li>
					<a
						href={`/book/${book.id}`}
						aria-current={book.id === currentBookId ? 'page' : undefined}
					>
						<span class="book-number">
							{book.number === null ? 'Volume non indicato' : `Vol. ${volumeNumber(book.number)}`}
						</span>
						<span>{book.title}</span>
					</a>
				</li>
			{/each}
		</ol>
	{/if}
</section>

<style>
	.series {
		display: grid;
		gap: 10px;
		box-sizing: border-box;
		padding: 12px 16px;
		border-radius: var(--radius-lg);
		background: var(--color-surface);
	}

	.spines {
		display: flex;
		align-items: flex-end;
		gap: 4px;
		height: 54px;
		min-width: 0;
		max-width: 100%;
		margin: 0;
		padding: 2px 0 6px;
		overflow-x: auto;
		list-style: none;
	}

	.spines li {
		flex: none;
	}

	.spine {
		display: flex;
		align-items: center;
		justify-content: center;
		box-sizing: border-box;
		min-width: 28px;
		height: 48px;
		padding: 0 4px;
		border-radius: 3px 5px 5px 3px;
		color: var(--color-text-primary);
		font-size: 11px;
		font-weight: 700;
		text-decoration: none;
	}

	.spine.present {
		background: var(--color-divider);
	}

	.spine.current {
		height: 54px;
		background: var(--genre-current);
		color: var(--genre-current-on);
		box-shadow: 0 0 10px 1px color-mix(in srgb, var(--genre-current) 70%, transparent);
	}

	.spine.missing {
		min-width: max(44px, var(--tap-size));
		border: 1.5px dashed color-mix(in srgb, var(--color-shelf-axis) 45%, transparent);
		background: color-mix(in srgb, var(--color-divider) 30%, transparent);
	}

	.spine:focus-visible,
	.book-list a:focus-visible {
		outline: 2px solid var(--color-text-primary);
		outline-offset: 2px;
	}

	.text {
		min-width: 0;
	}

	p {
		margin: 0;
	}

	.vol {
		font-size: 15px;
		font-weight: 700;
	}

	.name {
		margin-top: 2px;
		font-size: 12.5px;
		line-height: 17px;
		color: var(--color-text-secondary);
	}

	.book-list {
		display: grid;
		gap: 4px;
		max-height: 12rem;
		margin: 0;
		padding: 0;
		overflow-y: auto;
		list-style: none;
	}

	.book-list a {
		display: grid;
		gap: 2px;
		padding: 5px 0;
		color: inherit;
		font-size: 12px;
		line-height: 16px;
		text-decoration: none;
	}

	.book-list a:hover span:last-child {
		text-decoration: underline;
	}

	.book-number {
		color: var(--color-text-secondary);
		font-size: 11px;
	}

	.total {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.total-label {
		font-size: 12.5px;
		font-weight: 600;
		color: var(--color-text-secondary);
	}

	.total-row {
		display: flex;
		gap: 8px;
		align-items: center;
	}

	.total-row input {
		box-sizing: border-box;
		width: 90px;
		min-height: var(--tap-size);
		padding: 0 12px;
		border: 1.5px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-card);
		font-size: 16px;
		color: var(--color-text-primary);
	}

	.total-row input:focus-visible {
		outline: 2px solid var(--color-primary);
		outline-offset: 1px;
		border-color: var(--color-primary);
	}

	.total-error {
		margin: 0;
		font-size: 13px;
		font-weight: 600;
		color: var(--color-danger);
	}
</style>
