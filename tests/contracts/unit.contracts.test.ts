import { describe, expect, it } from 'vitest';
import {
  bingoBoardResponseSchema,
  bookDetailResponseSchema,
  bookFormatSchema,
  genreViewResponseSchema,
  libraryHomeResponseSchema,
  queueAddResponseSchema,
  readingCalendarResponseSchema,
  readingMutationResultSchema,
  reviewSaveResultSchema,
  shelfPageResponseSchema,
  statsDashboardResponseSchema,
  themeDefinitionSchema,
  yearStatsResponseSchema,
} from '../../src/lib/contracts';
import { profileSummarySchema } from '../../src/lib/contracts/performance';
import { segnalibroTheme } from '../../src/lib/themes';

const genre = {
  id: 5,
  slug: 'fantasy-magical-gothic' as const,
  name: 'Fantasy, Realismo Magico e Gotico',
};

const book = {
  id: '11111111-1111-4111-8111-111111111111',
  editionId: '42',
  title: 'Il nome del vento',
  author: 'Patrick Rothfuss',
  pageCount: 662,
  language: 'it',
  format: 'physical' as const,
  source: 'search' as const,
  genre,
  series: {
    name: "Le Cronache dell'Assassino del Re",
    number: 1,
    total: 3,
  },
  lifecycleState: 'finished' as const,
  completedReadingsCount: 1,
  reviewRating: 4,
  lastFinishedAt: '2026-01-18T20:00:00+00:00',
  lastActivityAt: '2026-01-18T20:00:00+00:00',
  cover: {
    coverUrl: 'https://covers.openlibrary.org/b/id/12345-L.jpg',
    coverStoragePath: null,
  },
};

const reading = {
  id: '22222222-2222-4222-8222-222222222222',
  userBookId: book.id,
  status: 'completed' as const,
  startedAt: '2026-01-03T20:00:00+00:00',
  endedAt: '2026-01-18T20:00:00+00:00',
  startPage: 0,
  currentPage: 662,
};

const review = {
  id: '33333333-3333-4333-8333-333333333333',
  userBookId: book.id,
  rating: 4,
  adjectives: ['Epico', 'Malinconico', 'Immersivo'] as const,
  scores: [
    {
      dimensionKey: 'fantasy.worldbuilding',
      label: 'Worldbuilding',
      score: 5,
    },
  ],
  tags: [{ id: 1, slug: 'magic', label: 'Magia' }],
  createdAt: '2026-01-18T20:01:00+00:00',
  updatedAt: '2026-01-18T20:01:00+00:00',
};

describe('contract schemas', () => {
  it('validates the default theme definition', () => {
    expect(themeDefinitionSchema.parse(segnalibroTheme)).toEqual(segnalibroTheme);
  });

  it('validates Library Home', () => {
    const value = {
      contractVersion: 1,
      currentlyReading: [],
      queue: [{ position: 1, addedAt: '2026-01-01T12:00:00+00:00', book }],
      shelves: [{ genre, totalCount: 1, hasMore: false, books: [book] }],
    };

    expect(libraryHomeResponseSchema.parse(value)).toEqual(value);
  });

  it('validates shelf pagination', () => {
    const value = {
      contractVersion: 1,
      data: {
        genre,
        books: [book],
        hasMore: true,
        nextCursor: {
          createdAt: '2026-01-01T12:00:00+00:00',
          id: book.id,
        },
      },
    };
    expect(shelfPageResponseSchema.parse(value)).toEqual(value);
  });

  it('validates genre view with fixed section order', () => {
    const value = {
      contractVersion: 1,
      genre,
      counts: { total: 1, read: 1, unread: 0 },
      sort: { field: 'rating', direction: 'desc' },
      sections: [
        { key: 'read', count: 1, books: [book] },
        { key: 'unread', count: 0, books: [] },
      ],
    };
    expect(genreViewResponseSchema.parse(value)).toEqual(value);
  });

  it('accepts a book owned in both formats', () => {
    expect(bookFormatSchema.parse('both')).toBe('both');
  });

  it('validates book detail', () => {
    const value = {
      contractVersion: 1,
      book,
      queuePosition: null,
      currentReading: null,
      readings: [{ ...reading, sequence: 1 }],
      review,
      quotes: [],
      seriesBooks: [{ id: book.id, title: book.title, number: 1 }],
    };
    expect(bookDetailResponseSchema.parse(value)).toEqual(value);
  });

  it('validates reading mutation', () => {
    const value = { contractVersion: 1, reading, duplicate: false };
    expect(readingMutationResultSchema.parse(value)).toEqual(value);
  });

  it('validates review mutation', () => {
    const value = { contractVersion: 1, review };
    expect(reviewSaveResultSchema.parse(value)).toEqual(value);
  });

  it('validates queue soft-limit response', () => {
    const value = {
      contractVersion: 1,
      status: 'requiresConfirmation',
      currentCount: 3,
      position: null,
      queue: [],
    };
    expect(queueAddResponseSchema.parse(value)).toEqual(value);
  });

  it('validates reading calendar', () => {
    const value = {
      contractVersion: 1,
      year: 2026,
      days: [
        {
          date: '2026-01-18',
          pagesRead: 35,
          genres: [{ genre, pagesRead: 35 }],
        },
      ],
    };
    expect(readingCalendarResponseSchema.parse(value)).toEqual(value);
  });

  it('validates year stats', () => {
    const stats = {
      year: 2026,
      booksFinished: 1,
      pagesRead: 662,
      readingDays: 4,
      currentStreak: 0,
      recordStreak: 4,
      topGenre: { genre, booksFinished: 1 },
      topAuthor: { name: 'Patrick Rothfuss', booksFinished: 1 },
      goldenMonth: { month: 1, booksFinished: 1 },
      topTags: [{ id: 1, slug: 'magic', label: 'Magia', count: 1 }],
    };
    expect(yearStatsResponseSchema.parse({ contractVersion: 1, stats }).stats).toEqual(stats);
  });

  it('keeps lifetime and selected-year DNF counts distinct in profile summaries', () => {
    const summary = {
      contractVersion: 1,
      counts: {
        total: 0,
        read: 0,
        reading: 0,
        unread: 0,
        physical: 0,
        physicalUnread: 0,
        digital: 0,
        both: 0,
        englishRead: 0,
        reread: 0,
      },
      queueCount: 0,
      quoteCount: 0,
      dnfCount: 3,
      dnfCountForYear: 1,
      favorites: [],
      queue: [],
      reading: [],
      dnf: [],
      activity: [],
    };

    expect(profileSummarySchema.parse(summary)).toEqual(summary);
  });

  it('validates stats dashboard', () => {
    const stats = {
      year: 2026,
      booksFinished: 0,
      pagesRead: 0,
      readingDays: 0,
      currentStreak: 0,
      recordStreak: 0,
      topGenre: null,
      topAuthor: null,
      goldenMonth: null,
      topTags: [],
    };

    const value = {
      contractVersion: 1,
      stats,
      bingo: {
        boardId: '44444444-4444-4444-8444-444444444444',
        year: 2026,
        completedCount: 0,
        totalCount: 16,
      },
      quotePreviews: [],
      dnf: [],
    };
    expect(statsDashboardResponseSchema.parse(value)).toEqual(value);
  });

  it('validates a 16-cell bingo board', () => {
    const cells = Array.from({ length: 16 }, (_, index) => ({
      id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      position: index + 1,
      challenge: `Sfida ${index + 1}`,
      completedAt: null,
      book: null,
    }));

    const value = {
      contractVersion: 1,
      board: {
        id: '44444444-4444-4444-8444-444444444444',
        year: 2026,
        title: 'La card del 2026',
        completedCount: 0,
        cells,
      },
    };

    expect(bingoBoardResponseSchema.parse(value)).toEqual(value);
  });
});
