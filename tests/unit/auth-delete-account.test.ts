import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Tx } from '../../src/lib/server/db/client';
import { withUser } from '../../src/lib/server/db/client';
import { deleteUserCovers } from '../../src/lib/server/storage';
import { deleteAccount } from '../../src/lib/server/auth';

vi.mock('../../src/lib/server/db/client', () => ({ sql: vi.fn(), withUser: vi.fn() }));
vi.mock('../../src/lib/server/storage', () => ({ deleteUserCovers: vi.fn() }));

const USER_ID = '11111111-1111-4111-8111-111111111111';
const runWithUser = vi.mocked(withUser);
const removeCovers = vi.mocked(deleteUserCovers);

beforeEach(() => {
	runWithUser.mockReset();
	removeCovers.mockReset().mockResolvedValue();
});

describe('deleteAccount', () => {
	it('leaves the account untouched when cover cleanup fails', async () => {
		const cleanupError = new Error('filesystem unavailable');
		removeCovers.mockRejectedValue(cleanupError);

		await expect(deleteAccount(USER_ID)).rejects.toBe(cleanupError);

		expect(removeCovers).toHaveBeenCalledExactlyOnceWith(USER_ID);
		expect(runWithUser).not.toHaveBeenCalled();
	});

	it('removes covers first and leaves the account usable if database deletion fails', async () => {
		const deleteError = new Error('database unavailable');
		const operations: string[] = [];
		let accountExists = true;
		removeCovers.mockImplementation(async () => {
			operations.push('covers');
		});

		const tx = vi.fn(async () => {
			operations.push('account');
			accountExists = false;
			throw deleteError;
		}) as unknown as Tx;
		runWithUser.mockImplementation(async (_userId, callback) => {
			const accountAtTransactionStart = accountExists;
			try {
				return await callback(tx);
			} catch (error) {
				// A failed database transaction rolls back the account deletion.
				accountExists = accountAtTransactionStart;
				throw error;
			}
		});

		await expect(deleteAccount(USER_ID)).rejects.toBe(deleteError);

		expect(operations).toEqual(['covers', 'account']);
		expect(accountExists).toBe(true);
	});
});
