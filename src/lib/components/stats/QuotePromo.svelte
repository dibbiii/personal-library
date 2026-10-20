<script lang="ts">
	import Icon from '$lib/components/ui/Icon.svelte';
	import type { GenreSlug, QuotePreview } from '$lib/contracts';
	import { abbreviateAuthor } from './format';

	interface Props {
		quotes: QuotePreview[];
		oncreate: () => void;
	}

	let { quotes, oncreate }: Props = $props();

	interface Sample {
		text: string;
		title: string;
		author: string;
		genre: GenreSlug;
	}

	// Anteprima decorativa: citazioni reali se ci sono, altrimenti le frasi d'esempio del mockup.
	const fallback: Sample[] = [
		{
			text: 'Non ho scelto di restare: sono rimasta.',
			title: 'Circe',
			author: 'Madeline Miller',
			genre: 'mythology-epic-retelling'
		},
		{
			text: 'Certe montagne si salgono per tornare.',
			title: 'Le otto montagne',
			author: 'Paolo Cognetti',
			genre: 'contemporary-historical'
		}
	];

	function toSample(quote: QuotePreview | undefined, index: number): Sample {
		const sample = fallback[index] ?? fallback[0]!;
		if (!quote) return sample;
		return {
			text: quote.body,
			title: quote.bookTitle,
			author: quote.author,
			genre: quote.genre.slug
		};
	}

	const first = $derived(toSample(quotes[0], 0));
	const second = $derived(toSample(quotes[1] ?? quotes[0], 1));
</script>

<div class="promo">
	<div class="copy">
		<h3>Condividi una citazione</h3>
		<p>Scegli una frase e trasformala in una card nei colori del genere.</p>
		<button
			type="button"
			class="create"
			onclick={oncreate}
			disabled={quotes.length === 0}
			data-testid="quote-card-open"
		>
			<Icon name="image" size={20} strokeWidth={1.9} />
			Crea Quote Card
		</button>
		{#if quotes.length === 0}
			<p class="hint">Aggiungi una citazione dal dettaglio di un libro letto.</p>
		{/if}
	</div>

	<div class="preview" aria-hidden="true">
		<div
			class="mini a"
			style="--base: var(--genre-{first.genre}); --ink: var(--genre-{first.genre}-on-base)"
		>
			<span class="text">«{first.text}»</span>
			<span class="caption">{first.title}<br />{abbreviateAuthor(first.author)}</span>
		</div>
		<div
			class="mini b"
			style="--base: var(--genre-{second.genre}); --light: var(--genre-{second.genre}-light); --dark: var(--genre-{second.genre}-dark)"
		>
			<span class="text">«{second.text}»</span>
			<span class="caption">{second.title}<br />{abbreviateAuthor(second.author)}</span>
		</div>
	</div>
</div>

<style>
	.promo {
		display: flex;
		align-items: center;
		gap: 8px;
		box-sizing: border-box;
		margin-top: 12px;
		padding: 16px;
		border-radius: 22px;
		background: var(--color-surface);
		overflow: hidden;
	}

	.copy {
		flex: 1;
		min-width: 0;
	}

	h3 {
		font-family: var(--font-ui);
		font-size: 15px;
		font-weight: 700;
		color: var(--color-text-primary);
	}

	p {
		margin: 4px 0 0;
		font-size: 13px;
		line-height: 18px;
		color: var(--color-text-secondary);
	}

	.hint {
		margin-top: 8px;
	}

	.create {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 8px;
		box-sizing: border-box;
		min-height: 46px;
		margin-top: 12px;
		padding: 0 16px;
		border: 0;
		border-radius: 16px;
		background: var(--color-primary);
		color: var(--color-on-primary);
		font-size: 14.5px;
		font-weight: 700;
		line-height: 1.15;
		text-align: center;
	}

	.create:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.preview {
		position: relative;
		width: 150px;
		height: 150px;
		margin-left: -10px;
		flex-shrink: 0;
	}

	.mini {
		position: absolute;
		display: flex;
		flex-direction: column;
		justify-content: space-between;
		box-sizing: border-box;
		width: 96px;
		height: 128px;
		padding: 12px 10px;
		border-radius: 10px;
		box-shadow: 0 8px 14px -6px color-mix(in srgb, var(--color-text-primary) 45%, transparent);
	}

	.mini.a {
		left: 0;
		top: 14px;
		transform: rotate(-6deg);
		background: var(--base);
		color: var(--ink);
	}

	.mini.b {
		left: 54px;
		top: 0;
		transform: rotate(5deg);
		background: var(--light);
		border: 1px solid color-mix(in srgb, var(--base) 60%, transparent);
		color: var(--dark);
	}

	.mini .text {
		display: -webkit-box;
		-webkit-line-clamp: 5;
		line-clamp: 5;
		-webkit-box-orient: vertical;
		overflow: hidden;
		font-family: var(--font-display);
		font-size: 10.5px;
		line-height: 14px;
	}

	.mini .caption {
		font-size: 8.5px;
		font-weight: 700;
		line-height: 11px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	@media (max-width: 359px) {
		.preview {
			display: none;
		}
	}
</style>
