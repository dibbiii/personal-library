<script lang="ts">
	import { formatNumber, MONTH_NAMES } from '$lib/components/stats/format';

	interface Props {
		/** 12 valori, gennaio..dicembre. */
		values: number[];
		/** Unità per tooltip e descrizione: "pagine", "giorni". */
		unit: string;
		label: string;
	}

	let { values, unit, label }: Props = $props();

	const max = $derived(Math.max(1, ...values));
	const peak = $derived(values.indexOf(Math.max(...values)));
	const monthlyValues = $derived(
		values
			.map(
				(value, i) =>
					`${MONTH_NAMES[i]?.toLowerCase() ?? `mese ${i + 1}`}: ${formatNumber(value)} ${unit}`
			)
			.join('; ')
	);
	const peakSummary = $derived(
		values.some((v) => v > 0)
			? `picco a ${MONTH_NAMES[peak]?.toLowerCase()} con ${formatNumber(values[peak] ?? 0)} ${unit}`
			: 'nessun dato'
	);
	const summary = $derived(`${label}: ${peakSummary}. Valori mensili: ${monthlyValues}`);
</script>

<figure class="bars" aria-label={summary}>
	{#each values as value, i (i)}
		{@const month = MONTH_NAMES[i] ?? ''}
		<div class="col" title="{month}: {formatNumber(value)} {unit}">
			<span class="track">
				<span
					class="bar"
					class:peak={i === peak && value > 0}
					style:height="{value > 0 ? Math.max(6, (value / max) * 100) : 0}%"
				></span>
			</span>
			<span class="month" aria-hidden="true">{month.slice(0, 3)}</span>
		</div>
	{/each}
</figure>

<style>
	.bars {
		display: grid;
		grid-template-columns: repeat(12, minmax(0, 1fr));
		gap: 2px;
		height: 96px;
		margin: 0;
	}

	.col {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 4px;
		min-width: 0;
	}

	.track {
		display: flex;
		align-items: flex-end;
		justify-content: center;
		flex: 1;
		width: 100%;
		border-bottom: 1px solid var(--color-divider);
	}

	.bar {
		width: min(12px, 70%);
		border-radius: 4px 4px 0 0;
		background: color-mix(in srgb, var(--color-primary) 55%, var(--color-surface));
		transition: background-color var(--duration-fast) var(--ease-out);
	}

	.bar.peak,
	.col:hover .bar {
		background: var(--color-primary);
	}

	.month {
		color: var(--color-text-muted);
		font-size: 9px;
		line-height: 1;
	}
</style>
