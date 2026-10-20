import { z } from 'zod';
import type { GenreSlug } from '../contracts/enums';
import type { Review } from '../contracts/reviews';
import { ratingSchema, uuidSchema } from '../contracts/primitives';
import { ADJECTIVE_MAX_LENGTH, areAdjectivesValid } from './adjectives';
import { dimensionKeysForGenre, scoresForGenre, type DimensionScores } from './dimensions';
import { filterActiveThemeTagSlugs } from './tags';

/** Stato editabile della recensione lato UI (i tag sono identificati per slug). */
export interface ReviewDraft {
	rating: number | null;
	adjectives: string[];
	scores: DimensionScores;
	tags: string[];
}

export function emptyDraft(): ReviewDraft {
	return { rating: null, adjectives: [], scores: {}, tags: [] };
}

export function draftFromReview(review: Review | null, genre: GenreSlug): ReviewDraft {
	if (!review) return emptyDraft();
	return {
		rating: review.rating,
		adjectives: [...review.adjectives],
		scores: scoresForGenre(
			Object.fromEntries(review.scores.map((s) => [s.dimensionKey, s.score])),
			genre
		),
		tags: filterActiveThemeTagSlugs(review.tags.map((t) => t.slug))
	};
}

function sortedEntries(scores: DimensionScores): [string, number][] {
	return Object.entries(scores).sort(([a], [b]) => a.localeCompare(b));
}

export function draftsEqual(a: ReviewDraft, b: ReviewDraft): boolean {
	return (
		a.rating === b.rating &&
		a.adjectives.length === b.adjectives.length &&
		a.adjectives.every((v, i) => v === b.adjectives[i]) &&
		JSON.stringify(sortedEntries(a.scores)) === JSON.stringify(sortedEntries(b.scores)) &&
		JSON.stringify([...a.tags].sort()) === JSON.stringify([...b.tags].sort())
	);
}

export type MissingField = 'adjectives' | 'rating';

/** `save_review` richiede il voto generale; gli aggettivi sono facoltativi ma validati. */
export function missingFields(draft: ReviewDraft): MissingField[] {
	const missing: MissingField[] = [];
	if (draft.rating === null) missing.push('rating');
	return missing;
}

export function canSave(draft: ReviewDraft): boolean {
	return missingFields(draft).length === 0 && areAdjectivesValid(draft.adjectives);
}

/** Testo per la bozza non ancora salvabile. */
export function missingMessage(missing: readonly MissingField[]): string {
	const parts = missing.map((m) => (m === 'adjectives' ? 'gli aggettivi' : 'il voto'));
	if (parts.length === 1) return `Bozza non ancora salvata: manca ${parts[0]}.`;
	return parts.length ? `Bozza non ancora salvata: mancano ${parts.join(' e ')}.` : '';
}

// ---------------------------------------------------------------------------
// Richiesta a /api/review (condivisa tra client e server)
// ---------------------------------------------------------------------------

export const saveReviewRequestSchema = z.object({
	bookId: uuidSchema,
	rating: ratingSchema,
	adjectives: z
		.array(z.string().trim().min(1).max(ADJECTIVE_MAX_LENGTH))
		.max(3)
		.refine(
			(values) =>
				new Set(values.map((value) => value.normalize('NFC').toLocaleLowerCase('it'))).size ===
				values.length,
			'Gli aggettivi devono essere distinti.'
		),
	scores: z
		.array(z.object({ dimensionKey: z.string().trim().min(1).max(120), score: ratingSchema }))
		.max(10),
	tagSlugs: z.array(z.string().trim().min(1).max(60)).max(40)
});

export type SaveReviewRequest = z.infer<typeof saveReviewRequestSchema>;

/** Converte la bozza in richiesta; `null` se manca il voto o gli aggettivi non sono validi. */
export function toSaveRequest(
	bookId: string,
	genre: GenreSlug,
	draft: ReviewDraft
): SaveReviewRequest | null {
	if (!canSave(draft) || draft.rating === null) return null;
	const order = dimensionKeysForGenre(genre);
	return {
		bookId,
		rating: draft.rating,
		adjectives: [...draft.adjectives],
		scores: order
			.filter((key) => draft.scores[key] !== undefined)
			.map((key) => ({ dimensionKey: key, score: draft.scores[key] as number })),
		tagSlugs: filterActiveThemeTagSlugs(draft.tags)
	};
}

export function formatRating(rating: number | null, max = 5): string {
	return `${rating ?? 0}/${max}`;
}
