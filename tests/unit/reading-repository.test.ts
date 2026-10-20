import { describe, expect, it } from 'vitest';
import type { RpcTransport } from '../../src/lib/data/rpc-client';
import { RpcReadingRepository } from '../../src/lib/data/reading-repository';
import { RPC } from '../../src/lib/data/rpc-names';

describe('RpcReadingRepository', () => {
	it('adds a completed reading with one RPC, so queue-removal errors cannot mask success', async () => {
		const bookId = '22222222-2222-4222-8222-222222222222';
		const calls: string[] = [];
		const transport: RpcTransport = {
			async rpc(functionName) {
				calls.push(functionName);

				if (functionName === RPC.queueRemove) {
					return {
						data: null,
						error: { code: 'XX001', message: 'Queue removal failed' }
					};
				}

				return {
					data: {
						contractVersion: 1,
						reading: {
							id: '11111111-1111-4111-8111-111111111111',
							userBookId: bookId,
							status: 'completed',
							startedAt: '2026-01-01T10:00:00.000Z',
							endedAt: '2026-01-02T10:00:00.000Z',
							startPage: 10,
							currentPage: 42
						},
						duplicate: false
					},
					error: null
				};
			}
		};

		const result = await new RpcReadingRepository(transport).addCompletedReading({
			bookId,
			startedAt: '2026-01-01T10:00:00.000Z',
			finishedAt: '2026-01-02T10:00:00.000Z',
			startPage: 10,
			finalPage: 42
		});

		expect(result.reading.userBookId).toBe(bookId);
		expect(calls).toEqual([RPC.addCompletedReading]);
	});
});
