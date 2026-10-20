import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { GENRE_ORDER } from '../../src/lib/genres';
import {
	ADJECTIVE_MAX_LENGTH,
	DIMENSIONS_BY_GENRE,
	THEME_TAGS,
	addAdjective,
	areAdjectivesValid,
	canSave,
	dimensionKeysForGenre,
	draftFromReview,
	draftsEqual,
	emptyDraft,
	missingFields,
	missingMessage,
	normalizeAdjective,
	orderTagsForDisplay,
	parseQuoteForm,
	removeAdjective,
	resolveTagIds,
	saveReviewRequestSchema,
	scoresForGenre,
	toSaveRequest,
	toggleTag,
	visibleTags,
	wouldResetScores,
	normalizeQuoteBody
} from '../../src/lib/review';

const migration004 = readFileSync(
	path.resolve(process.cwd(), 'db/migrations/004_reference_data.sql'),
	'utf8'
);
const migration216 = readFileSync(
	path.resolve(process.cwd(), 'db/migrations/216_essays_shelf.sql'),
	'utf8'
);
const migration203 = readFileSync(
	path.resolve(process.cwd(), 'db/migrations/203_canonical_italian_tags.sql'),
	'utf8'
);
const migration218 = readFileSync(
	path.resolve(process.cwd(), 'db/migrations/218_spicy_psychological_thriller_tags.sql'),
	'utf8'
);

describe('dimensioni per genere', () => {
	it('ogni genere ha 5 dimensioni con chiavi uniche e prefisso coerente', () => {
		const all = new Set<string>();
		for (const slug of GENRE_ORDER) {
			const keys = dimensionKeysForGenre(slug);
			expect(keys).toHaveLength(5);
			const prefix = keys[0]!.split('.')[0];
			expect(keys.every((k) => k.startsWith(`${prefix}.`))).toBe(true);
			for (const key of keys) {
				expect(all.has(key)).toBe(false);
				all.add(key);
			}
		}
		expect(all.size).toBe(40);
	});

	it('definisce cinque valutazioni specifiche per Saggi', () => {
		const dimensions = (
			DIMENSIONS_BY_GENRE as Record<
				string,
				readonly { key: string; label: string; shortLabel: string }[]
			>
		).essays;

		expect(dimensions?.map(({ key, label, shortLabel }) => ({ key, label, shortLabel }))).toEqual([
			{ key: 'essays.clarity', label: 'Chiarezza', shortLabel: 'Chiarezza' },
			{ key: 'essays.depth', label: 'Approfondimento', shortLabel: 'Approfondimento' },
			{ key: 'essays.rigor', label: 'Rigore', shortLabel: 'Rigore' },
			{ key: 'essays.style', label: 'Stile', shortLabel: 'Stile' },
			{ key: 'essays.impact', label: 'Impatto', shortLabel: 'Impatto' }
		]);
	});

	it('coincidono con rating_dimensions delle migration 004 e 216 (chiave, etichetta, ordine)', () => {
		const rows = [
			...`${migration004}\n${migration216}`.matchAll(
				/\('([a-z0-9._-]+)',\s*(\d+),\s*'([^']+)',\s*(\d+),\s*1,\s*true\)/g
			)
		].map((m) => ({ key: m[1]!, label: m[3]!, order: Number(m[4]) }));
		const defined = GENRE_ORDER.flatMap((slug) =>
			DIMENSIONS_BY_GENRE[slug].map((d, i) => ({ key: d.key, label: d.label, order: i + 1 }))
		);
		expect(rows.filter((r) => r.key.includes('.'))).toHaveLength(40);
		expect(defined).toEqual(expect.arrayContaining(rows));
		expect(rows).toEqual(expect.arrayContaining(defined));
	});

	it("usa l'etichetta breve del mockup per il sistema magico", () => {
		const magic = DIMENSIONS_BY_GENRE['fantasy-magical-gothic'].find(
			(d) => d.key === 'fantasy.magic'
		);
		expect(magic?.shortLabel).toBe('Sistema magico');
		expect(magic?.label).toBe('Elemento fantastico / Sistema magico');
	});

	it('cambiando genere nessun punteggio precedente sopravvive', () => {
		const scores = { 'fantasy.worldbuilding': 5, 'fantasy.pacing': 3 };
		expect(scoresForGenre(scores, 'fantasy-magical-gothic')).toEqual(scores);
		expect(scoresForGenre(scores, 'thriller-mystery')).toEqual({});
		expect(wouldResetScores(scores, 'thriller-mystery')).toBe(true);
		expect(wouldResetScores(scores, 'fantasy-magical-gothic')).toBe(false);
		expect(wouldResetScores({}, 'classics')).toBe(false);
	});
});

describe('aggettivi facoltativi', () => {
	it('normalizza spazi e maiuscola iniziale', () => {
		expect(normalizeAdjective('  epico ')).toBe('Epico');
		expect(normalizeAdjective('fuori   dal tempo')).toBe('Fuori dal tempo');
		expect(normalizeAdjective('   ')).toBe('');
		expect(normalizeAdjective('élite')).toBe('Élite');
	});

	it('rifiuta vuoti, duplicati case-insensitive, troppo lunghi e il quarto', () => {
		expect(addAdjective([], '  ')).toEqual({ ok: false, error: 'empty' });
		expect(addAdjective(['Epico'], 'EPICO')).toEqual({ ok: false, error: 'duplicate' });
		expect(addAdjective(['Épico'], 'épico')).toEqual({ ok: false, error: 'duplicate' });
		expect(addAdjective([], 'a'.repeat(ADJECTIVE_MAX_LENGTH + 1))).toEqual({
			ok: false,
			error: 'too-long'
		});
		expect(addAdjective(['A', 'B', 'C'], 'D')).toEqual({ ok: false, error: 'full' });
	});

	it('aggiunge e rimuove mantenendo l ordine', () => {
		const first = addAdjective([], 'epico');
		expect(first).toEqual({ ok: true, adjectives: ['Epico'] });
		const second = addAdjective(['Epico'], 'malinconico');
		expect(second.ok && second.adjectives).toEqual(['Epico', 'Malinconico']);
		expect(removeAdjective(['A', 'B', 'C'], 1)).toEqual(['A', 'C']);
	});

	it('sono validi da 0 a 3 se non vuoti e distinti', () => {
		expect(areAdjectivesValid([])).toBe(true);
		expect(areAdjectivesValid(['A'])).toBe(true);
		expect(areAdjectivesValid(['A', 'B'])).toBe(true);
		expect(areAdjectivesValid(['A', 'B', 'C'])).toBe(true);
		expect(areAdjectivesValid(['A', 'a', 'C'])).toBe(false);
		expect(areAdjectivesValid(['A', '', 'C'])).toBe(false);
		expect(areAdjectivesValid(['A', 'B', 'C', 'D'])).toBe(false);
	});
});

describe('tag tematici', () => {
	it('sono i 20 canonici e coincidono con le migration 203 e 218', () => {
		expect(THEME_TAGS).toHaveLength(20);
		const rows = [
			...`${migration203}\n${migration218}`.matchAll(
				/\('([a-z-]+)',\s*'([^']+)',\s*(\d+),\s*true\)/g
			)
		].map((m) => ({ slug: m[1]!, label: m[2]!, order: Number(m[3]) }));
		const defined = THEME_TAGS.map((t, i) => ({ slug: t.slug, label: t.label, order: i + 1 }));
		expect(rows).toEqual(defined);
	});

	it('toggle aggiunge e toglie', () => {
		expect(toggleTag([], 'magic')).toEqual(['magic']);
		expect(toggleTag(['magic', 'music'], 'magic')).toEqual(['music']);
	});

	it('risolve gli slug in id e segnala quelli sconosciuti', () => {
		const reference = [
			{ id: 9, slug: 'magic' },
			{ id: 2, slug: 'romantico' }
		];
		expect(resolveTagIds(['magic', 'romantico', 'magic'], reference)).toEqual({
			ids: [9, 2],
			unknown: []
		});
		expect(resolveTagIds(['magic', 'nope'], reference).unknown).toEqual(['nope']);
	});

	it('mostra i selezionati per primi e poi i suggeriti, senza spostare i chip', () => {
		const ordered = orderTagsForDisplay(['magic', 'slow-burn', 'romantico']);
		expect(ordered.slice(0, 9).map((t) => t.label)).toEqual([
			'Romantico',
			'Slow burn',
			'Magia',
			'Plot twist',
			'Inquietante',
			'Dark academia',
			'Disturbante',
			'Contorto',
			'Claustrofobico'
		]);
		expect(visibleTags(ordered, [], false)).toHaveLength(9);
		expect(visibleTags(ordered, [], true)).toHaveLength(20);
		// un tag scelto dopo l'espansione resta visibile anche se richiudi
		expect(visibleTags(ordered, ['doppia-linea-temporale'], false).map((t) => t.slug)).toContain(
			'doppia-linea-temporale'
		);
	});
});

describe('bozza e salvataggio', () => {
	const review = {
		id: '33333333-3333-4333-8333-333333333333',
		userBookId: '11111111-1111-4111-8111-111111111111',
		rating: 4,
		adjectives: ['Epico', 'Malinconico', 'Immersivo'] as [string, string, string],
		scores: [
			{ dimensionKey: 'fantasy.worldbuilding', label: 'Worldbuilding', score: 5 },
			{ dimensionKey: 'fantasy.pacing', label: 'Ritmo', score: 3 }
		],
		tags: [{ id: 9, slug: 'magic', label: 'Magia' }],
		createdAt: '2026-01-18T20:01:00+00:00',
		updatedAt: '2026-01-18T20:01:00+00:00'
	};

	it('legge la recensione salvata ignorando punteggi di un altro genere', () => {
		const draft = draftFromReview(review, 'fantasy-magical-gothic');
		expect(draft).toEqual({
			rating: 4,
			adjectives: ['Epico', 'Malinconico', 'Immersivo'],
			scores: { 'fantasy.worldbuilding': 5, 'fantasy.pacing': 3 },
			tags: ['magic']
		});
		expect(draftFromReview(review, 'thriller-mystery').scores).toEqual({});
		expect(draftFromReview(null, 'classics')).toEqual(emptyDraft());
	});

	it('scarta i tag legacy inattivi dal draft e dalla richiesta di salvataggio', () => {
		const reviewWithLegacyTag = {
			...review,
			tags: [...review.tags, { id: 10, slug: 'adventure', label: 'Adventure' }]
		};
		const draft = draftFromReview(reviewWithLegacyTag, 'fantasy-magical-gothic');

		expect(draft.tags).toEqual(['magic']);
		expect(toSaveRequest(review.userBookId, 'fantasy-magical-gothic', draft)?.tagSlugs).toEqual([
			'magic'
		]);
		expect(
			saveReviewRequestSchema.safeParse(
				toSaveRequest(review.userBookId, 'fantasy-magical-gothic', draft)
			).success
		).toBe(true);

		// Anche una bozza locale precedente che conserva uno slug nascosto non lo reinvia.
		const staleDraft = { ...draft, tags: [...draft.tags, 'adventure'] };
		expect(
			toSaveRequest(review.userBookId, 'fantasy-magical-gothic', staleDraft)?.tagSlugs
		).toEqual(['magic']);
	});

	it('richiede solo il voto e conserva 0-3 aggettivi nella richiesta', () => {
		expect(missingFields(emptyDraft())).toEqual(['rating']);
		expect(missingFields({ ...emptyDraft(), rating: 3 })).toEqual([]);
		for (const adjectives of [[], ['A'], ['A', 'B'], ['A', 'B', 'C']]) {
			const draft = { ...emptyDraft(), rating: 3, adjectives };
			expect(canSave(draft)).toBe(true);
			expect(toSaveRequest('11111111-1111-4111-8111-111111111111', 'classics', draft)?.adjectives).toEqual(
				adjectives
			);
		}
		expect(missingMessage(['rating'])).toBe('Bozza non ancora salvata: manca il voto.');
	});

	it('confronta le bozze ignorando l ordine di tag e punteggi', () => {
		const a = { ...emptyDraft(), tags: ['a', 'b'], scores: { x: 1, y: 2 } };
		const b = { ...emptyDraft(), tags: ['b', 'a'], scores: { y: 2, x: 1 } };
		expect(draftsEqual(a, b)).toBe(true);
		expect(draftsEqual(a, { ...b, rating: 2 })).toBe(false);
	});

	it('costruisce una richiesta valida con i soli punteggi del genere, nell ordine della spec', () => {
		const draft = {
			rating: 4,
			adjectives: ['Epico', 'Malinconico', 'Immersivo'],
			scores: { 'fantasy.pacing': 3, 'fantasy.worldbuilding': 5, 'thriller.tension': 4 },
			tags: ['magic']
		};
		const request = toSaveRequest(review.userBookId, 'fantasy-magical-gothic', draft);
		expect(request).not.toBeNull();
		expect(request?.scores.map((s) => s.dimensionKey)).toEqual([
			'fantasy.worldbuilding',
			'fantasy.pacing'
		]);
		expect(saveReviewRequestSchema.safeParse(request).success).toBe(true);
		expect(toSaveRequest(review.userBookId, 'classics', emptyDraft())).toBeNull();
	});
});

describe('citazioni', () => {
	it('toglie le virgolette scritte dall utente', () => {
		expect(normalizeQuoteBody('  «Ciao mondo»  ')).toBe('Ciao mondo');
		expect(normalizeQuoteBody('"Ciao"')).toBe('Ciao');
		expect(normalizeQuoteBody('Ciao « dentro » mondo')).toBe('Ciao « dentro » mondo');
	});

	it('valida testo e pagina facoltativa', () => {
		expect(parseQuoteForm('Una frase', '')).toEqual({ ok: true, body: 'Una frase', page: null });
		expect(parseQuoteForm('Una frase', ' 48 ')).toEqual({ ok: true, body: 'Una frase', page: 48 });
		expect(parseQuoteForm('   ', '')).toEqual({ ok: false, error: 'body-empty' });
		expect(parseQuoteForm('x', '0')).toEqual({ ok: false, error: 'page-invalid' });
		expect(parseQuoteForm('x', '4.5')).toEqual({ ok: false, error: 'page-invalid' });
		expect(parseQuoteForm('x'.repeat(5001), '')).toEqual({ ok: false, error: 'body-too-long' });
	});
});
