<script lang="ts">
	import { page } from '$app/state';
	import YearPicker from '$lib/components/stats/YearPicker.svelte';
	import type {
		BookSummary,
		BingoBoardListItem,
		DnfBook,
		GenreSlug,
		QuotePreview,
		ReadingCalendarDay,
		YearStats
	} from '$lib/contracts';
	import { genreShares } from '$lib/profile/overview';
	import type { ProfileSummary, ProfileTab } from '$lib/contracts/performance';
	import ActivityList from './ActivityList.svelte';
	import ProfileCard from './ProfileCard.svelte';
	import ProfileHero from './ProfileHero.svelte';
	import ProfileOverview from './ProfileOverview.svelte';

	interface Props {
		year: number;
		calendarYear: number;
		currentYear: number;
		currentYearBooksRead: number;
		years: number[];
		stats: YearStats;
		genreBreakdown: { slug: GenreSlug; count: number }[];
		bingo: BingoBoardListItem | null;
		quotes: QuotePreview[];
		dnf: DnfBook[];
		calendar: ReadingCalendarDay[];
		summary: ProfileSummary;
		tab: ProfileTab;
		components: Awaited<
			ReturnType<typeof import('$lib/profile/load-components').loadProfileComponents>
		>['components'];
		/** Libri non letti, per la Ruota della fortuna. */
		pool: BookSummary[];
	}

	let props: Props = $props();

	const TABS = [
		{ key: 'overview', label: 'Panoramica' },
		{ key: 'stats', label: 'Statistiche' },
		{ key: 'activity', label: 'Attività' },
		{ key: 'wheel', label: 'Ruota della fortuna' },
		{ key: 'calendar', label: 'Calendario' },
		{ key: 'dnf', label: 'Abbandonati' }
	] as const;
	const tab = $derived(props.tab);
	const StatsView = $derived(props.components.stats);
	const WheelSection = $derived(props.components.wheel);
	const ReadingCalendar = $derived(props.components.calendar);
	const DnfCemetery = $derived(props.components.dnf);

	const user = $derived(page.data.user);
	const name = $derived(user?.displayName ?? user?.email ?? 'Lettore');
	const counts = $derived(props.summary.counts);

	function yearPath(year: number): string {
		return year === props.currentYear ? '/profile' : `/profile/${year}`;
	}

	function tabHref(key: string, year = props.year): string {
		return key === 'overview' ? yearPath(year) : `${yearPath(year)}?tab=${key}`;
	}
</script>

<div class="profile" data-testid="profile-page">
	<ProfileHero
		{name}
		email={user?.email ?? null}
		year={props.year}
		{counts}
		genres={genreShares(props.genreBreakdown)}
		readingDays={props.stats.readingDays}
	/>

	<div class="tabbar">
		<nav aria-label="Sezioni del profilo">
			<ul>
				{#each TABS as t (t.key)}
					<li>
						<a
							href={tabHref(t.key)}
							class:active={tab === t.key}
							aria-current={tab === t.key ? 'page' : undefined}
							data-sveltekit-noscroll
							data-sveltekit-replacestate
							data-sveltekit-preload-data="tap"
							data-sveltekit-preload-code="hover"
						>
							{t.label}
						</a>
					</li>
				{/each}
			</ul>
		</nav>
		<YearPicker year={props.year} years={props.years} href={(y) => tabHref(tab, y)} />
	</div>

	{#if tab === 'overview'}
		<ProfileOverview
			year={props.year}
			isCurrentYear={props.year === props.currentYear}
			stats={props.stats}
			bingo={props.bingo}
			calendar={props.calendar}
			summary={props.summary}
			{counts}
			quotes={props.quotes}
			tabHref={(key) => tabHref(key)}
		/>
	{:else if tab === 'stats' && StatsView}
		<StatsView
			year={props.year}
			stats={props.stats}
			currentYear={props.currentYear}
			currentYearBooksRead={props.currentYearBooksRead}
			physicalBooksUnread={counts.physicalUnread}
			physicalBooks={counts.physical}
			digitalBooks={counts.digital}
			totalBooks={counts.total}
			genreBreakdown={props.genreBreakdown}
			bingo={props.bingo}
			quotes={props.quotes}
			dnf={props.dnf}
			englishBooks={counts.englishRead}
			showDnf={false}
		/>
	{:else if tab === 'activity'}
		<ProfileCard icon="calendar" title="Attività recente" class="activity-full">
			<ActivityList items={props.summary.activity} />
		</ProfileCard>
	{:else if tab === 'wheel' && WheelSection}
		<div class="tool">
			<WheelSection pool={props.pool} />
		</div>
	{:else if tab === 'calendar' && ReadingCalendar}
		<ReadingCalendar
			year={props.calendarYear}
			defaultYear={props.year}
			days={props.calendar}
			currentYear={props.currentYear}
		/>
	{:else if DnfCemetery}
		<DnfCemetery books={props.dnf} />
	{/if}
</div>

<style>
	.profile {
		display: flex;
		flex-direction: column;
		gap: 20px;
		box-sizing: border-box;
		width: 100%;
		max-width: var(--content-max);
		margin: 0 auto;
		padding: 16px var(--page-gutter) 32px;
	}

	.tool {
		width: 100%;
		max-width: 520px;
		margin-inline: auto;
	}

	.tabbar {
		display: flex;
		align-items: center;
		gap: 12px;
		border-bottom: 1px solid var(--color-divider);
	}

	nav {
		flex: 1;
		min-width: 0;
		overflow-x: auto;
		scrollbar-width: none;
	}

	ul {
		display: flex;
		gap: 4px;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	nav a {
		position: relative;
		display: flex;
		align-items: center;
		min-height: 48px;
		padding: 0 14px;
		color: var(--color-text-secondary);
		font-size: 14px;
		font-weight: 600;
		text-decoration: none;
		white-space: nowrap;
	}

	nav a:hover {
		color: var(--color-text-primary);
	}

	nav a.active {
		color: var(--color-primary);
		font-weight: 700;
	}

	nav a.active::after {
		content: '';
		position: absolute;
		inset: auto 8px -1px;
		height: 3px;
		border-radius: 3px 3px 0 0;
		background: var(--color-primary);
	}

	.profile :global(.activity-full) {
		max-width: 720px;
	}

	@media (min-width: 1024px) {
		.profile {
			gap: 24px;
			padding-top: 24px;
		}
	}
</style>
