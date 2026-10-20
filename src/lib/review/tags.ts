import type { Tag } from '../contracts/reviews';

/**
 * I 20 tag tematici canonici, nell'ordine del DB (`tags.sort_order`).
 * Gli id numerici li decide il DB: la UI lavora sugli slug, il server li risolve in id.
 */
export interface ThemeTagDef {
	slug: string;
	label: string;
}

export const THEME_TAGS: readonly ThemeTagDef[] = [
	{ slug: 'romantico', label: 'Romantico' },
	{ slug: 'dark-academia', label: 'Dark academia' },
	{ slug: 'plot-twist', label: 'Plot twist' },
	{ slug: 'inquietante', label: 'Inquietante' },
	{ slug: 'disturbante', label: 'Disturbante' },
	{ slug: 'contorto', label: 'Contorto' },
	{ slug: 'claustrofobico', label: 'Claustrofobico' },
	{ slug: 'cupo', label: 'Cupo' },
	{ slug: 'narratore-inaffidabile', label: 'Narratore inaffidabile' },
	{ slug: 'character-development', label: 'Character development' },
	{ slug: 'critica-sociale', label: 'Critica sociale' },
	{ slug: 'slow-burn', label: 'Slow burn' },
	{ slug: 'enemies-to-lovers', label: 'Enemies to lovers' },
	{ slug: 'friends-to-lovers', label: 'Friends to lovers' },
	{ slug: 'multi-pov', label: 'Multi-POV' },
	{ slug: 'doppia-linea-temporale', label: 'Doppia linea temporale' },
	{ slug: 'crescita-personale', label: 'Crescita personale' },
	{ slug: 'magic', label: 'Magia' },
	{ slug: 'spicy', label: 'Spicy' },
	{ slug: 'thriller-psicologico', label: 'Thriller psicologico' }
];

const ACTIVE_THEME_TAG_SLUGS = new Set(THEME_TAGS.map(({ slug }) => slug));

/** Conserva solo gli slug presenti nel catalogo canonico dei tag attivi. */
export function filterActiveThemeTagSlugs(slugs: readonly string[]): string[] {
	return slugs.filter((slug) => ACTIVE_THEME_TAG_SLUGS.has(slug));
}

export function toggleTag(selected: readonly string[], slug: string): string[] {
	return selected.includes(slug) ? selected.filter((s) => s !== slug) : [...selected, slug];
}

/** Slug -> id del DB. Gli slug sconosciuti vengono segnalati, non ignorati in silenzio. */
export function resolveTagIds(
	slugs: readonly string[],
	reference: readonly Pick<Tag, 'id' | 'slug'>[]
): { ids: number[]; unknown: string[] } {
	const byslug = new Map(reference.map((t) => [t.slug, t.id]));
	const ids: number[] = [];
	const unknown: string[] = [];
	for (const slug of new Set(slugs)) {
		const id = byslug.get(slug);
		if (id === undefined) unknown.push(slug);
		else ids.push(id);
	}
	return { ids, unknown };
}

/** Numero di tag mostrati prima di "Mostra tutti" (come nel mockup 05). */
export const TAG_COLLAPSED_COUNT = 9;

/** Tag proposti per primi quando non selezionati (ordine del mockup 05). */
const SUGGESTED_SLUGS = ['plot-twist', 'slow-burn', 'inquietante', 'romantico', 'magic'];

/**
 * Ordine di visualizzazione fissato all'apertura: prima i tag già selezionati (ordine della spec),
 * poi i suggeriti, poi gli altri. Non cambia mentre l'utente seleziona, così i chip non saltano.
 */
export function orderTagsForDisplay(initiallySelected: readonly string[]): ThemeTagDef[] {
	const selected = new Set(initiallySelected);
	const rank = (slug: string) => {
		if (selected.has(slug)) return 0;
		const suggested = SUGGESTED_SLUGS.indexOf(slug);
		return suggested >= 0 ? 1 + suggested : 100;
	};
	const indexOf = (slug: string) => THEME_TAGS.findIndex((t) => t.slug === slug);
	return [...THEME_TAGS].sort(
		(a, b) => rank(a.slug) - rank(b.slug) || indexOf(a.slug) - indexOf(b.slug)
	);
}

/** Tag visibili da chiusi: i primi N più tutti quelli selezionati. */
export function visibleTags(
	ordered: readonly ThemeTagDef[],
	selected: readonly string[],
	expanded: boolean,
	collapsedCount = TAG_COLLAPSED_COUNT
): ThemeTagDef[] {
	if (expanded) return [...ordered];
	return ordered.filter((t, i) => i < collapsedCount || selected.includes(t.slug));
}
