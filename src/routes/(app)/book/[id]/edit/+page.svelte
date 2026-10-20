<script lang="ts">
	import { goto } from '$app/navigation';
	import { untrack } from 'svelte';
	import BookCustomizationSheet from '$lib/components/catalog/BookCustomizationSheet.svelte';
	import CandidateDetail from '$lib/components/catalog/CandidateDetail.svelte';
	import IconButton from '$lib/components/ui/IconButton.svelte';
	import { draftFromBook, type BookDraft } from '$lib/catalog/draft';
	import type { BookInfo } from '$lib/catalog/book-info';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	const detail = $derived(data.detail);
	const book = $derived(detail.book);

	let draft = $state<BookDraft>(untrack(() => draftFromBook(data.detail.book)));
	$effect(() => {
		const next = data.detail.book;
		untrack(() => {
			draft = draftFromBook(next);
		});
	});

	let info = $state<BookInfo | null>(null);
	let infoLoading = $state(true);
	let infoFor = '';
	$effect(() => {
		const pending = data.info;
		const id = book.id;
		if (infoFor !== id) {
			info = null;
			infoLoading = true;
			infoFor = id;
		}
		let current = true;
		void Promise.resolve(pending).then((value) => {
			if (!current) return;
			info = value;
			infoLoading = false;
		});
		return () => {
			current = false;
		};
	});

	let sheetDraft = $state<BookDraft | null>(null);
	let sheetOpen = $state(false);

	function continueToCustomization(next: BookDraft) {
		sheetDraft = next;
		sheetOpen = true;
	}

	function returnToBook(reviewScoresReset = false) {
		const notice = reviewScoresReset ? '?reviewScoresReset=1' : '';
		void goto(`/book/${book.id}${notice}`, { invalidateAll: true });
	}
</script>

<svelte:head><title>Modifica {book.title} · Segnalibro</title></svelte:head>

<main class="page">
	<header class="top">
		<IconButton icon="chevron-left" label="Torna al libro" onclick={() => returnToBook()} />
		<div>
			<h1>Modifica il libro</h1>
			<p>Seleziona un’altra edizione o aggiorna i dati della tua copia.</p>
		</div>
	</header>

	<p class="current-edition">
		Edizione attuale: <strong>{book.title}</strong> · {book.author}
	</p>

	<CandidateDetail
		{draft}
		{info}
		{infoLoading}
		onchange={(next) => (draft = next)}
		oncontinue={continueToCustomization}
		actionLabel="Continua alla personalizzazione"
		actionIcon="pencil"
		allowMetadataCustomization={false}
		allowCoverAttachment={true}
	/>
</main>

<BookCustomizationSheet
	mode="edit"
	bookId={book.id}
	open={sheetOpen}
	draft={sheetDraft}
	initialGenre={book.genre.slug}
	initialFormat={book.format}
	initialSeries={book.series}
	onclose={() => (sheetOpen = false)}
	onsaved={returnToBook}
/>

<style>
	.page {
		box-sizing: border-box;
		max-width: 900px;
		margin: 0 auto;
		padding: 24px var(--page-gutter) 40px;
		color: var(--color-text-primary);
	}

	.top {
		display: flex;
		align-items: flex-start;
		gap: 14px;
		margin-bottom: 20px;
	}

	h1 {
		margin: 0;
		font-family: var(--font-display);
		font-size: 28px;
		font-weight: 400;
	}

	.top p {
		margin: 4px 0 0;
		color: var(--color-text-secondary);
		line-height: 1.45;
	}

	.current-edition {
		margin: 0 0 24px;
		padding: 12px 16px;
		border-radius: 14px;
		background: var(--color-surface);
		font-size: 14px;
		line-height: 1.5;
	}
</style>
