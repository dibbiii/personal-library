<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { replaceState } from '$app/navigation';
	import { page } from '$app/state';
	import { readingCalendarResponseSchema } from '$lib/contracts/rpc';
	import type { ReadingCalendarDay } from '$lib/contracts/stats';
	import BottomSheet from '$lib/components/ui/BottomSheet.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import { localDateKey, yearOptions } from '$lib/explore/calendar';
	import { GENRE_ORDER, GENRE_SHORT_LABELS } from '$lib/genres';
	import CalendarMonth from './CalendarMonth.svelte';

	interface Props {
		year: number;
		/** Anno della pagina Profilo, usato come valore predefinito senza override `?year=`. */
		defaultYear: number;
		days: readonly ReadingCalendarDay[];
		/** Anno corrente del server: limite superiore del selettore. */
		currentYear: number;
	}

	let { year: initialYear, defaultYear, days: initialDays, currentYear }: Props = $props();

	// Il calendario parte dai dati del server e carica dal client solo dopo un cambio anno.
	// svelte-ignore state_referenced_locally
	let year = $state(initialYear);
	// svelte-ignore state_referenced_locally
	let days = $state.raw<readonly ReadingCalendarDay[]>(initialDays);
	let loading = $state(false);
	let failedYear = $state<number | null>(null);
	let sheetOpen = $state(false);
	let openDate = $state<string | null>(null);
	let today = $state<string | null>(null);
	let requestId = 0;

	const months = Array.from({ length: 12 }, (_, i) => i + 1);
	const options = $derived(yearOptions(currentYear, 9));
	const activity = $derived(new Map(days.map((day) => [day.date, day])));

	// Una nuova risposta server deve sostituire anche lo stato locale del periodo selezionato.
	$effect(() => {
		const nextYear = initialYear;
		const nextDays = initialDays;
		const [stateYear, stateDays] = untrack(() => [year, days] as const);
		if (nextYear === stateYear && nextDays === stateDays) return;
		requestId += 1;
		year = nextYear;
		days = nextDays;
		loading = false;
		failedYear = null;
		sheetOpen = false;
		openDate = null;
	});

	// "Oggi" solo sul client: evita differenze di fuso tra server e dispositivo.
	onMount(() => {
		today = localDateKey(new Date());
	});

	async function loadYear(target: number) {
		sheetOpen = false;
		if (target === year) {
			failedYear = null;
			return;
		}
		openDate = null;
		const id = ++requestId;
		const previous = year;
		year = target;
		loading = true;
		failedYear = null;
		try {
			const response = await fetch(`/api/explore/calendar?year=${target}`);
			if (!response.ok) throw new Error(String(response.status));
			const parsed = readingCalendarResponseSchema.parse(await response.json());
			if (id !== requestId) return;
			days = parsed.days;
			const url = new URL(page.url);
			if (target === defaultYear) url.searchParams.delete('year');
			else url.searchParams.set('year', String(target));
			replaceState(url, page.state);
		} catch {
			if (id !== requestId) return;
			failedYear = target;
			year = previous;
		} finally {
			if (id === requestId) loading = false;
		}
	}

	function toggleDay(date: string) {
		openDate = openDate === date ? null : date;
	}

	function onWindowClick(event: MouseEvent) {
		if (openDate && !(event.target as Element | null)?.closest('.dot, .popover')) openDate = null;
	}

	function onWindowKey(event: KeyboardEvent) {
		if (event.key === 'Escape') openDate = null;
	}
</script>

<svelte:window onclick={onWindowClick} onkeydown={onWindowKey} />

<section class="calendar" aria-labelledby="calendar-title">
	<div class="head">
		<h2 id="calendar-title">Calendario {year}</h2>
		<button
			class="year-pill"
			type="button"
			aria-haspopup="dialog"
			aria-label="Anno del calendario: {year}. Cambia anno"
			onclick={() => (sheetOpen = true)}
		>
			{year}
			<Icon name="chevron-down" size={14} strokeWidth={2.4} />
		</button>
	</div>
	<p class="lead">
		Un pallino per ogni giorno di lettura. Se hai letto più generi lo stesso giorno, il pallino è
		diviso a metà con due generi e in spicchi uguali con tre o più generi.
	</p>

	<ul class="legend" aria-label="Legenda dei generi">
		{#each GENRE_ORDER as slug (slug)}
			<li style:--g="var(--genre-{slug})">
				<span class="swatch" aria-hidden="true"></span>
				{GENRE_SHORT_LABELS[slug]}
			</li>
		{/each}
	</ul>

	{#if failedYear !== null}
		<div class="error" role="alert">
			<p>Non riesco a caricare il calendario del {failedYear}.</p>
			<Button size="sm" variant="secondary" onclick={() => failedYear && loadYear(failedYear)}>
				Riprova
			</Button>
		</div>
	{/if}

	<div class="months" class:loading aria-busy={loading}>
		{#each months as month (month)}
			<CalendarMonth {year} {month} {activity} {today} {openDate} ontoggle={toggleDay} />
		{/each}
	</div>

	{#if !loading && failedYear === null && days.length === 0}
		<p class="none">Nessuna lettura registrata nel {year}.</p>
	{/if}
</section>

<BottomSheet open={sheetOpen} title="Scegli l'anno" onclose={() => (sheetOpen = false)}>
	<div class="years" role="radiogroup" aria-label="Anno">
		{#each options as option (option)}
			<button
				class="year-row"
				class:selected={option === year}
				type="button"
				role="radio"
				aria-checked={option === year}
				onclick={() => loadYear(option)}
			>
				<span class="radio" aria-hidden="true"></span>
				{option}
			</button>
		{/each}
	</div>
</BottomSheet>

<style>
	.calendar {
		padding: 32px var(--page-gutter) 0;
	}

	.head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
	}

	h2 {
		font-size: 24px;
		line-height: 1.2;
	}

	.year-pill {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		flex: none;
		position: relative;
		height: 32px;
		padding: 0 12px 0 14px;
		border: 0;
		border-radius: 16px;
		background: var(--color-surface);
		color: var(--color-text-primary);
		font-size: 13px;
		font-weight: 600;
	}

	.year-pill::after {
		content: '';
		position: absolute;
		inset: -6px -4px;
	}

	.lead {
		margin: 4px 0 0;
		font-size: 14px;
		line-height: 20px;
		color: var(--color-text-secondary);
	}

	.legend {
		display: flex;
		flex-wrap: wrap;
		gap: 6px 14px;
		margin: 12px 0 0;
		padding: 0;
		list-style: none;
		font-size: 12px;
	}

	.legend li {
		display: inline-flex;
		align-items: center;
		gap: 6px;
	}

	.swatch {
		width: 10px;
		height: 10px;
		border-radius: 50%;
		background: var(--g);
	}

	.months {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 12px;
		margin-top: 16px;
		transition: opacity var(--duration-base) var(--ease-out);
	}

	.months.loading {
		opacity: 0.45;
	}

	.error {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		margin-top: 12px;
		padding: 10px 14px;
		border-radius: 14px;
		background: var(--color-surface);
		font-size: 14px;
	}

	.error p,
	.none {
		margin: 0;
	}

	.none {
		margin-top: 12px;
		font-size: 14px;
		color: var(--color-text-secondary);
		text-align: center;
	}

	.years {
		display: flex;
		flex-direction: column;
		gap: 4px;
		padding-bottom: 12px;
	}

	.year-row {
		display: flex;
		align-items: center;
		gap: 14px;
		height: 48px;
		padding: 0 12px;
		border: 0;
		border-radius: 14px;
		background: transparent;
		font-size: 16px;
		text-align: left;
	}

	.year-row.selected {
		background: color-mix(in srgb, var(--color-accent) 40%, transparent);
		font-weight: 700;
	}

	.radio {
		display: inline-block;
		box-sizing: border-box;
		width: 24px;
		height: 24px;
		border: 2px solid color-mix(in srgb, var(--color-shelf-axis) 50%, transparent);
		border-radius: 50%;
	}

	.selected .radio {
		border-color: var(--color-primary);
		background: radial-gradient(circle, var(--color-primary) 0 5px, transparent 6px);
	}

	@media (min-width: 1024px) {
		.calendar {
			padding-top: 10px;
		}

		.months {
			grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
		}
	}
</style>
