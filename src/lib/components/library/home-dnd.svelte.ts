import { mount, unmount } from 'svelte';
import type { DraggableOptions, DropTarget, DropZoneOptions } from '$lib/actions/drag';
import BookCover from '$lib/components/book/BookCover.svelte';
	import { addToQueue, moveInQueue, removeFromQueue } from '$lib/client/queue.svelte';
	import { refreshData } from '$lib/client/refresh-data';
import { GENRE_LABELS } from '$lib/genres';
import type { BookSummary, GenreSlug } from '$lib/contracts';
import type { HomeState } from './home-state.svelte';

export type DragPayload =
	| { kind: 'shelf-book'; book: BookSummary }
	| { kind: 'queue-book'; book: BookSummary; position: number };

type ZoneData =
	{ kind: 'genre'; slug: GenreSlug } | { kind: 'queue' } | { kind: 'queue-slot'; position: number };

function errorText(error: unknown): string {
	return error instanceof Error && error.message ? error.message : 'Operazione non riuscita.';
}

/** Orchestra il drag & drop della Home: stato visivo (origine, bersaglio) e azioni al rilascio. */
export class HomeDnd {
	/** Libro in trascinamento (origine = placeholder tratteggiato). */
	dragging = $state<DragPayload | null>(null);
	/** Chiave del bersaglio sotto il puntatore: `genre:<slug>`, `queue`, `slot:<n>`. */
	hover = $state<string | null>(null);

	constructor(private readonly home: HomeState) {}

	get draggingId(): string | null {
		return this.dragging?.book.id ?? null;
	}

	/** Opzioni di `draggable` per un libro di scaffale o della coda. */
	source(payload: DragPayload): DraggableOptions<DragPayload> {
		return {
			data: payload,
			ghost: (container) => {
				const cover = mount(BookCover, {
					target: container,
					props: { book: payload.book, size: 'md' }
				});
				return () => void unmount(cover);
			},
			onstart: (p) => (this.dragging = p),
			ondrop: (target, p) => void this.drop(target, p),
			onend: () => {
				this.dragging = null;
				this.hover = null;
			}
		};
	}

	genreZone(slug: GenreSlug): DropZoneOptions<DragPayload> {
		return {
			data: { kind: 'genre', slug } satisfies ZoneData,
			accepts: (p) => p.book.genre.slug !== slug,
			onhover: (active) => (this.hover = active ? `genre:${slug}` : null)
		};
	}

	queueZone(): DropZoneOptions<DragPayload> {
		return {
			data: { kind: 'queue' } satisfies ZoneData,
			accepts: (p) =>
				p.kind === 'shelf-book' &&
				p.book.lifecycleState !== 'reading' &&
				!this.home.queuedIds.has(p.book.id),
			onhover: (active) => (this.hover = active ? 'queue' : null)
		};
	}

	slotZone(position: number): DropZoneOptions<DragPayload> {
		return {
			data: { kind: 'queue-slot', position } satisfies ZoneData,
			accepts: (p) => p.kind === 'queue-book' && p.position !== position,
			onhover: (active) => (this.hover = active ? `slot:${position}` : null)
		};
	}

	private async drop(target: DropTarget, payload: DragPayload) {
		const zone = target.data as ZoneData;
		if (zone.kind === 'genre') return this.changeGenre(payload.book, zone.slug);
		if (zone.kind === 'queue' && payload.kind === 'shelf-book')
			return this.addToQueue(payload.book);
		if (zone.kind === 'queue-slot' && payload.kind === 'queue-book') {
			return this.reorder(payload.book, zone.position);
		}
	}

	async changeGenre(book: BookSummary, slug: GenreSlug) {
		const undo = this.home.moveToGenre(book.id, slug);
		if (!undo) return;
		try {
			const response = await fetch(`/api/books/${book.id}/genre`, {
				method: 'PATCH',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ genreSlug: slug })
			});
			if (!response.ok) {
				const body = (await response.json().catch(() => null)) as { message?: string } | null;
				throw new Error(body?.message ?? 'Impossibile spostare il libro.');
			}
			const result = (await response.json()) as { reviewScoresReset?: boolean };
			void refreshData(['app:profile', 'app:library']);
			this.home.notify(
				result.reviewScoresReset
					? `Spostato in ${GENRE_LABELS[slug]}. I voti specifici sono stati azzerati.`
					: `Spostato in ${GENRE_LABELS[slug]}.`
			);
		} catch (error) {
			undo();
			this.home.notify(errorText(error));
		}
	}

	async addToQueue(book: BookSummary) {
		try {
			const result = await addToQueue(book.id, { genre: book.genre.slug, skipInvalidate: true });
			if (result.status === 'cancelled') return;
			this.home.setQueue(result.queue);
			this.home.notify(
				result.status === 'alreadyQueued' ? 'Il libro è già nei prossimi.' : 'Aggiunto ai prossimi.'
			);
		} catch (error) {
			this.home.notify(errorText(error));
		}
	}

	async reorder(book: BookSummary, position: number) {
		const before = $state.snapshot(this.home.queue);
		try {
			this.home.setQueue(await moveInQueue(book.id, position, { skipInvalidate: true }));
		} catch (error) {
			this.home.setQueue(before as typeof this.home.queue);
			this.home.notify(errorText(error));
		}
	}

	async remove(book: BookSummary) {
		try {
			this.home.setQueue(await removeFromQueue(book.id, { skipInvalidate: true }));
			this.home.notify('Tolto dai prossimi.');
		} catch (error) {
			this.home.notify(errorText(error));
		}
	}
}
