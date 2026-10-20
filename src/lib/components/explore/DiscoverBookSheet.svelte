<script lang="ts">
	import { untrack } from 'svelte';
	import CandidateDetail from '$lib/components/catalog/CandidateDetail.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import Modal from '$lib/components/ui/Modal.svelte';
	import type { BookInfo } from '$lib/catalog/book-info';
	import { fetchBookInfo } from '$lib/catalog/client';
	import { discoverCandidate, type DiscoverBook } from '$lib/catalog/discover';
	import { draftFromCandidate, draftWithEdition, type BookDraft } from '$lib/catalog/draft';

	interface Props {
		/** Libro aperto; null = chiuso. */
		book: DiscoverBook | null;
		/** Lingua applicata ai risultati; null quando il filtro è "Tutte". */
		language: string | null;
		/** Id del libro se è già in libreria. */
		ownedId: string | null;
		onclose: () => void;
		onadd: (draft: BookDraft) => void;
	}

	let { book, language, ownedId, onclose, onadd }: Props = $props();

	const uid = $props.id();

	let draft = $state<BookDraft | null>(null);
	let info = $state<BookInfo | null>(null);
	let infoLoading = $state(false);
	let wide = $state(true);

	$effect(() => {
		const current = book;
		if (!current) return;
		untrack(() => {
			wide = matchMedia('(min-width: 720px)').matches;
			draft = draftFromCandidate(discoverCandidate(current), 'search');
			info = null;
			infoLoading = true;
		});

		const controller = new AbortController();
		fetchBookInfo(
			{
				title: current.workTitle,
				author: current.authors[0] ?? '',
				language
			},
			controller.signal
		)
			.then((result) => {
				info = result;
				const usableEditions =
					result?.editions.filter((item) => item.isbn13 && item.coverUrl) ?? [];
				const preferredLanguage = current.language ?? language;
				const discoveredEdition = current.editionId
					? usableEditions.find(
							(item) =>
								item.url.endsWith(`/books/${current.editionId}`) &&
								(!preferredLanguage || !item.language || item.language === preferredLanguage)
						)
					: undefined;
				// Preferisci l'edizione scoperta, poi una nella lingua selezionata. Se il risultato
				// identifica già un'edizione con copertina e lingua, non sostituirla con un'altra lingua.
				const edition =
					discoveredEdition ??
					usableEditions.find((item) => preferredLanguage && item.language === preferredLanguage) ??
					(current.editionId && current.coverUrl && preferredLanguage
						? undefined
						: usableEditions[0]);
				if (result && edition && draft && !draft.isbn) {
					draft = draftWithEdition(draft, edition, result.workUrl);
				}
			})
			.catch(() => {
				info = null;
			})
			.finally(() => {
				if (!controller.signal.aborted) infoLoading = false;
			});
		return () => controller.abort();
	});
</script>

<Modal
	open={book !== null && draft !== null}
	placement={wide ? 'center' : 'bottom'}
	wide
	labelledby="{uid}-title"
	{onclose}
>
	<button type="button" class="close" aria-label="Chiudi" onclick={onclose}>
		<Icon name="close" size={20} strokeWidth={2.2} />
	</button>
	{#if draft}
		<div class="body">
			<CandidateDetail
				{draft}
				{info}
				{infoLoading}
				headingId="{uid}-title"
				ownedHref={ownedId ? `/book/${ownedId}` : null}
				onchange={(next) => (draft = next)}
				oncontinue={onadd}
			/>
		</div>
	{/if}
</Modal>

<style>
	.close {
		position: absolute;
		top: 14px;
		right: 14px;
		z-index: 1;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: var(--tap-size);
		height: var(--tap-size);
		border: 0;
		border-radius: 50%;
		background: var(--color-surface);
		color: var(--color-text-primary);
	}

	.close:hover {
		background: var(--color-surface-pressed);
	}

	/* Il titolo non finisce sotto il pulsante di chiusura. */
	.body :global(.head-text) {
		padding-right: 40px;
	}

	.close:focus-visible {
		outline: 2px solid var(--color-primary);
		outline-offset: 2px;
	}
</style>
