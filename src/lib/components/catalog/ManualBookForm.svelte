<script lang="ts">
	import { untrack } from 'svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import TextField from '$lib/components/ui/TextField.svelte';
	import { parseIsbn } from '$lib/catalog/isbn';
	import { LANGUAGE_LABELS } from '$lib/catalog/language';
	import type { BookDraft } from '$lib/catalog/draft';
	import CoverAttachment from './CoverAttachment.svelte';

	interface Props {
		initial?: { title?: string; author?: string; isbn?: string };
		/** Dati validi: il chiamante apre lo sheet di conferma. */
		onsubmit: (draft: BookDraft) => void;
	}

	let { initial = {}, onsubmit }: Props = $props();

	let title = $state(untrack(() => initial.title ?? ''));
	let author = $state(untrack(() => initial.author ?? ''));
	let pages = $state('');
	let isbn = $state(untrack(() => initial.isbn ?? ''));
	let language = $state('it');
	let coverFile = $state<File | null>(null);
	let coverBusy = $state(false);
	let errors = $state<{ title?: string; author?: string; pages?: string; isbn?: string }>({});

	const languages = Object.entries(LANGUAGE_LABELS);

	function validate() {
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
		if (isbn.trim() && !parseIsbn(isbn)) {
			next.isbn = 'ISBN non valido: controlla le cifre (10 o 13, anche con trattini).';
		}
		errors = next;
		return Object.keys(next).length === 0;
	}

	function submit(event: SubmitEvent) {
		event.preventDefault();
		if (coverBusy) return;
		if (!validate()) {
			queueMicrotask(() =>
				(document.querySelector('[aria-invalid="true"]') as HTMLElement | null)?.focus()
			);
			return;
		}
		const parsed = isbn.trim() ? parseIsbn(isbn) : null;
		onsubmit({
			source: 'manual',
			title: title.trim(),
			author: author.trim(),
			pageCount: pages.trim() ? Number(pages.trim()) : null,
			language,
			isbn: parsed?.isbn13 ?? null,
			openLibraryEditionId: null,
			coverUrl: null,
			publisher: null,
			publishedDate: null,
			edition: null,
			coverFile
		});
	}
</script>

<form class="form" method="dialog" novalidate onsubmit={submit}>
	<TextField
		label="Titolo"
		name="title"
		bind:value={title}
		error={errors.title ?? null}
		autocomplete="off"
		required
		maxlength={300}
	/>
	<TextField
		label="Autore"
		name="author"
		bind:value={author}
		error={errors.author ?? null}
		hint="Più autori? Separali con una virgola."
		autocomplete="off"
		required
		maxlength={300}
	/>
	<div class="pair">
		<TextField
			label="Pagine"
			name="pages"
			bind:value={pages}
			error={errors.pages ?? null}
			inputmode="numeric"
			autocomplete="off"
			placeholder="es. 320"
		/>
		<div class="select-field">
			<label for="manual-language">Lingua</label>
			<select id="manual-language" name="language" bind:value={language}>
				{#each languages as [code, label] (code)}
					<option value={code}>{label}</option>
				{/each}
			</select>
		</div>
	</div>
	<TextField
		label="ISBN (facoltativo)"
		name="isbn"
		bind:value={isbn}
		error={errors.isbn ?? null}
		hint="Serve a riconoscere l’edizione ed evitare doppioni."
		inputmode="numeric"
		autocomplete="off"
		placeholder="978…"
	/>
	<CoverAttachment
		onchange={(file) => (coverFile = file)}
		onbusychange={(busy) => (coverBusy = busy)}
	/>
	<Button type="submit" size="lg" fullWidth disabled={coverBusy}>Continua</Button>
</form>

<style>
	.form {
		display: flex;
		flex-direction: column;
		gap: 18px;
	}

	.pair {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 12px;
		align-items: start;
	}

	.select-field {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.select-field label {
		font-size: 14px;
		font-weight: 700;
		color: var(--color-text-primary);
	}

	select {
		box-sizing: border-box;
		width: 100%;
		min-height: 50px;
		padding: 0 12px;
		border: 1.5px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-card);
		font-size: 16px;
		color: var(--color-text-primary);
	}

	select:focus-visible {
		outline: 2px solid var(--color-primary);
		outline-offset: 1px;
		border-color: var(--color-primary);
	}
</style>
