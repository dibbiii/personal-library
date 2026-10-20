import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	authenticate: vi.fn(),
	checkLoginRateLimit: vi.fn(),
	clearLoginFailures: vi.fn(),
	createSession: vi.fn(),
	recordLoginFailure: vi.fn(),
	setSessionCookie: vi.fn()
}));

vi.mock('$lib/server/auth', () => ({
	authenticate: mocks.authenticate,
	checkLoginRateLimit: mocks.checkLoginRateLimit,
	clearLoginFailures: mocks.clearLoginFailures,
	createSession: mocks.createSession,
	recordLoginFailure: mocks.recordLoginFailure
}));

vi.mock('$lib/server/session-cookie', () => ({
	setSessionCookie: mocks.setSessionCookie
}));

import { actions } from '../../src/routes/auth/login/+page.server';

const EMAIL = 'reader@example.test';
const IP = '192.0.2.10';
type LoginEvent = Parameters<NonNullable<(typeof actions)['default']>>[0];

function loginEvent(): { event: LoginEvent; getClientAddress: ReturnType<typeof vi.fn> } {
	const form = new FormData();
	form.set('email', EMAIL);
	form.set('password', 'correct horse battery');
	const getClientAddress = vi.fn(() => IP);

	return {
		event: {
			request: new Request('http://localhost/auth/login?next=%2Fprofile', {
				method: 'POST',
				body: form
			}),
			cookies: {},
			url: new URL('http://localhost/auth/login?next=%2Fprofile'),
			getClientAddress
		} as unknown as LoginEvent,
		getClientAddress
	};
}

beforeEach(() => {
	vi.resetAllMocks();
	mocks.checkLoginRateLimit.mockReturnValue({
		allowed: true,
		retryAfterSeconds: 0,
		remaining: 5
	});
	mocks.authenticate.mockResolvedValue(null);
	mocks.createSession.mockResolvedValue({
		token: 'test-session-token',
		expiresAt: new Date('2030-01-01T00:00:00.000Z')
	});
});

describe('POST /auth/login', () => {
	it('blocks limited requests before authenticating', async () => {
		mocks.checkLoginRateLimit.mockReturnValue({
			allowed: false,
			retryAfterSeconds: 60,
			remaining: 0
		});
		const { event, getClientAddress } = loginEvent();

		const result = await actions.default!(event);

		expect(result).toMatchObject({
			status: 429,
			data: {
				email: EMAIL,
				message: expect.any(String),
				fieldErrors: null,
				retryAfterSeconds: 60
			}
		});
		expect(getClientAddress).toHaveBeenCalledOnce();
		expect(mocks.checkLoginRateLimit).toHaveBeenCalledExactlyOnceWith(EMAIL, IP);
		expect(mocks.authenticate).not.toHaveBeenCalled();
	});

	it('records failed credentials against the email and client IP', async () => {
		const { event } = loginEvent();

		const result = await actions.default!(event);

		expect(result).toMatchObject({ status: 400 });
		expect(mocks.checkLoginRateLimit).toHaveBeenCalledExactlyOnceWith(EMAIL, IP);
		expect(mocks.recordLoginFailure).toHaveBeenCalledExactlyOnceWith(EMAIL, IP);
		expect(mocks.clearLoginFailures).not.toHaveBeenCalled();
	});

	it('clears failures after successful authentication', async () => {
		mocks.authenticate.mockResolvedValue({
			id: 'user-id',
			email: EMAIL,
			displayName: 'Reader'
		});
		const { event } = loginEvent();

		await expect(actions.default!(event)).rejects.toMatchObject({
			status: 303,
			location: '/profile'
		});

		expect(mocks.checkLoginRateLimit).toHaveBeenCalledExactlyOnceWith(EMAIL, IP);
		expect(mocks.clearLoginFailures).toHaveBeenCalledExactlyOnceWith(EMAIL, IP);
		expect(mocks.recordLoginFailure).not.toHaveBeenCalled();
		expect(mocks.setSessionCookie).toHaveBeenCalledExactlyOnceWith(
			event.cookies,
			'test-session-token',
			new Date('2030-01-01T00:00:00.000Z')
		);
	});
});
