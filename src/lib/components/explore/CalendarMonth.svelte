<script lang="ts">
	import type { ReadingCalendarDay } from '$lib/contracts/stats';
	import {
		WEEKDAY_INITIALS,
		buildMonthGrid,
		dateKey,
		daySegmentsBackground,
		formatDayLabel,
		genreColorVar
	} from '$lib/explore/calendar';
	import { GENRE_SHORT_LABELS } from '$lib/genres';

	interface Props {
		year: number;
		month: number;
		/** Giorni con letture dell'anno, indicizzati per data `YYYY-MM-DD`. */
		activity: ReadonlyMap<string, ReadingCalendarDay>;
		/** Data di oggi (`YYYY-MM-DD`), nota solo sul client. */
		today?: string | null;
		/** Data del giorno con il dettaglio aperto. */
		openDate?: string | null;
		ontoggle: (date: string) => void;
	}

	let { year, month, activity, today = null, openDate = null, ontoggle }: Props = $props();

	const grid = $derived(buildMonthGrid(year, month));
	const headingId = $derived(`cal-${year}-${month}`);
</script>

<section class="month" aria-labelledby={headingId}>
	<h3 id={headingId}>{grid.name}</h3>
	<div class="weekdays" aria-hidden="true">
		{#each WEEKDAY_INITIALS as initial, i (i)}<span>{initial}</span>{/each}
	</div>
	<div class="days">
		{#each { length: grid.leading }, i (i)}<span class="blank"></span>{/each}
		{#each grid.days as day (day)}
			{@const key = dateKey(year, month, day)}
			{@const entry = activity.get(key)}
			{@const isToday = today === key}
			{#if entry}
				{@const colors = entry.genres.map((g) => genreColorVar(g.genre.slug))}
				{@const multi = colors.length > 1}
				{@const label = formatDayLabel(
					key,
					entry.genres.map((g) => ({ slug: g.genre.slug, pagesRead: g.pagesRead }))
				)}
				{@const col = (grid.leading + day - 1) % 7}
				<span class="cell">
					<button
						class="dot"
						class:multi
						class:today={isToday}
						type="button"
						style:background={daySegmentsBackground(colors)}
						style:--ink="var(--genre-{entry.genres[0]?.genre.slug}-on-base)"
						aria-label={isToday ? `${label} (oggi)` : label}
						aria-expanded={openDate === key}
						onclick={() => ontoggle(key)}
					>
						<span class="num">{day}</span>
					</button>
					{#if openDate === key}
						<div class="popover" class:left={col <= 1} class:right={col >= 5} role="note">
							<strong>{label.split(':')[0]}</strong>
							<ul>
								{#each entry.genres as g (g.genre.slug)}
									<li style:--g={genreColorVar(g.genre.slug)}>
										<span class="swatch" aria-hidden="true"></span>
										{GENRE_SHORT_LABELS[g.genre.slug]}
										<span class="pages">{g.pagesRead} pag.</span>
									</li>
								{/each}
							</ul>
						</div>
					{/if}
				</span>
			{:else}
				<span class="cell">
					<span class="plain" class:today={isToday} aria-current={isToday ? 'date' : undefined}>
						{day}
					</span>
				</span>
			{/if}
		{/each}
	</div>
</section>

<style>
	.month {
		padding: 12px;
		border-radius: 18px;
		background: var(--color-surface);
	}

	h3 {
		margin: 0 0 6px;
		font-family: var(--font-ui);
		font-size: 14px;
		font-weight: 700;
	}

	.weekdays,
	.days {
		display: grid;
		grid-template-columns: repeat(7, minmax(0, 1fr));
	}

	.weekdays {
		margin-bottom: 2px;
		text-align: center;
		font-size: 10px;
		line-height: 12px;
		font-weight: 600;
		color: var(--color-text-secondary);
	}

	.days {
		gap: 2px;
	}

	.blank,
	.cell {
		height: 24px;
	}

	.cell {
		position: relative;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.plain {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		font-size: 10px;
		font-weight: 600;
		color: var(--color-text-secondary);
	}

	.dot {
		appearance: none;
		position: relative;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		box-sizing: border-box;
		width: 20px;
		height: 20px;
		padding: 0;
		border: 0;
		border-radius: 50%;
		color: var(--ink);
		font-size: 9.5px;
		font-weight: 700;
		line-height: 1;
		cursor: pointer;
	}

	/* Area di tocco più ampia del disco (le celle mensili sono 24px come da mockup) */
	.dot::after {
		content: '';
		position: absolute;
		inset: -4px -6px;
	}

	.dot.multi .num {
		min-width: 14px;
		height: 14px;
		border-radius: 7px;
		background: var(--color-background);
		color: var(--color-text-primary);
		line-height: 14px;
		text-align: center;
	}

	/* Oggi: anello bordeaux (DESIGN_REFERENCE 8.4) */
	.dot.today {
		outline: 2px solid var(--color-primary);
		outline-offset: 1px;
	}

	.plain.today {
		box-sizing: border-box;
		width: 20px;
		height: 20px;
		border: 2px solid var(--color-primary);
		border-radius: 50%;
		color: var(--color-text-primary);
		font-weight: 700;
	}

	.popover {
		position: absolute;
		bottom: calc(100% + 6px);
		left: 50%;
		z-index: 5;
		min-width: 130px;
		padding: 8px 10px;
		border-radius: 12px;
		background: var(--color-background);
		box-shadow: var(--shadow-card);
		border: 1px solid var(--color-surface);
		transform: translateX(-50%);
		font-size: 12px;
		line-height: 16px;
		white-space: nowrap;
	}

	.popover.left {
		left: -4px;
		transform: none;
	}

	.popover.right {
		right: -4px;
		left: auto;
		transform: none;
	}

	.popover ul {
		margin: 4px 0 0;
		padding: 0;
		list-style: none;
	}

	.popover li {
		display: flex;
		align-items: center;
		gap: 6px;
		font-weight: 600;
	}

	.swatch {
		width: 9px;
		height: 9px;
		border-radius: 50%;
		background: var(--g);
	}

	.pages {
		margin-left: auto;
		padding-left: 8px;
		font-weight: 500;
		color: var(--color-text-secondary);
	}
</style>
