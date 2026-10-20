import { createHash, randomBytes } from 'node:crypto';
import postgres from 'postgres';
import { sql, withUser } from '../db/client';
import { deleteUserCovers } from '../storage';
import {
	MAX_PASSWORD_LENGTH,
	MIN_PASSWORD_LENGTH,
	dummyPasswordHash,
	hashPassword,
	verifyPassword
} from './password';

export {
	checkLoginRateLimit,
	clearLoginFailures,
	recordLoginFailure,
	resetLoginRateLimits,
	FailureRateLimiter,
	type RateLimitDecision
} from './rate-limit';
export { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH };

/** Sliding session lifetime. */
export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

export interface AuthUser {
	id: string;
	email: string;
	/** Falls back to the local part of the email for accounts created without a name. */
	displayName: string;
}

export interface Session {
	/** Opaque bearer token for the cookie. Only its sha256 is stored in the database. */
	token: string;
	expiresAt: Date;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class EmailTakenError extends Error {
	constructor(readonly email: string) {
		super('An account with this email already exists');
		this.name = 'EmailTakenError';
	}
}

export type AuthValidationField = 'email' | 'password' | 'displayName';

/** Invalid input to registerUser (the UI maps `field`/`reason` to a message). */
export class AuthValidationError extends Error {
	constructor(
		readonly field: AuthValidationField,
		readonly reason: 'invalid' | 'too_short' | 'too_long' | 'required',
		message?: string
	) {
		super(message ?? `Invalid ${field}: ${reason}`);
		this.name = 'AuthValidationError';
	}
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const MAX_DISPLAY_NAME = 80;

/** Lower-cases and trims. The database enforces the same normalisation. */
export function normalizeEmail(email: string): string {
	return email.trim().toLowerCase();
}

function toUser(row: { id: string; email: string; displayName: string | null }): AuthUser {
	return {
		id: row.id,
		email: row.email,
		displayName: row.displayName ?? row.email.split('@')[0] ?? row.email
	};
}

function hashToken(token: string): string {
	return createHash('sha256').update(token).digest('hex');
}

/** 32 random bytes = 43 base64url characters. */
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

export async function registerUser(input: {
	email: string;
	password: string;
	displayName: string;
}): Promise<AuthUser> {
	const email = normalizeEmail(input.email);
	if (!email) throw new AuthValidationError('email', 'required');
	if (email.length > 254 || !EMAIL_RE.test(email))
		throw new AuthValidationError('email', 'invalid');

	if (input.password.length < MIN_PASSWORD_LENGTH) {
		throw new AuthValidationError('password', 'too_short');
	}
	if (input.password.length > MAX_PASSWORD_LENGTH) {
		throw new AuthValidationError('password', 'too_long');
	}

	const displayName = input.displayName.trim();
	if (!displayName) throw new AuthValidationError('displayName', 'required');
	if (displayName.length > MAX_DISPLAY_NAME)
		throw new AuthValidationError('displayName', 'too_long');

	const passwordHash = await hashPassword(input.password);

	try {
		const [row] = await sql<{ user: { id: string; email: string; displayName: string | null } }[]>`
			select app.register_user(${email}, ${passwordHash}, ${displayName}) as "user"
		`;
		if (!row) throw new Error('register_user returned no row');
		return toUser(row.user);
	} catch (error) {
		if (error instanceof postgres.PostgresError && error.code === '23505') {
			throw new EmailTakenError(email);
		}
		throw error;
	}
}

/** Returns the user for valid credentials, `null` otherwise (same timing either way). */
export async function authenticate(email: string, password: string): Promise<AuthUser | null> {
	const normalized = normalizeEmail(email);
	if (!normalized || password.length === 0 || password.length > MAX_PASSWORD_LENGTH) {
		await verifyPassword(password.slice(0, MAX_PASSWORD_LENGTH), await dummyPasswordHash());
		return null;
	}

	const [row] = await sql<
		{
			user: { id: string; email: string; displayName: string | null; passwordHash: string } | null;
		}[]
	>`select app.find_user_for_login(${normalized}) as "user"`;

	const user = row?.user ?? null;
	const valid = await verifyPassword(password, user?.passwordHash ?? (await dummyPasswordHash()));
	return user && valid ? toUser(user) : null;
}

/**
 * Deletes cover files before the account. If filesystem cleanup fails, the
 * account remains available for a retry; if account deletion fails, its
 * transaction leaves the account usable even though its covers are gone.
 * Deleting the account cascades every row the user owns (library, readings,
 * reviews, sessions, ...).
 * Authorisation is the caller's job (re-check the password first in the UI).
 */
export async function deleteAccount(userId: string): Promise<void> {
	await deleteUserCovers(userId);
	await withUser(userId, async (tx) => {
		await tx`select app.delete_account(${userId}::uuid)`;
	});
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

export async function createSession(userId: string): Promise<Session> {
	const token = randomBytes(32).toString('base64url');
	const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000);

	await sql`select app.create_session(${userId}::uuid, ${hashToken(token)}, ${expiresAt}::timestamptz)`;
	return { token, expiresAt };
}

/**
 * Looks a session token up. Sliding expiration: a session that is used is
 * extended back to 30 days (written at most every 5 minutes). Unknown, expired
 * or malformed tokens give `null`.
 */
export async function validateSession(token: string): Promise<AuthUser | null> {
	return (await validateSessionWithExpiry(token))?.user ?? null;
}

/** Same as {@link validateSession}, also returning the (possibly extended) expiry for the cookie. */
export async function validateSessionWithExpiry(
	token: string
): Promise<{ user: AuthUser; expiresAt: Date } | null> {
	if (!TOKEN_RE.test(token)) return null;

	const [row] = await sql<
		{
			session: { id: string; email: string; displayName: string | null; expiresAt: string } | null;
		}[]
	>`select app.validate_session(${hashToken(token)}, ${SESSION_TTL_SECONDS}::integer) as session`;

	const session = row?.session;
	if (!session) return null;
	return { user: toUser(session), expiresAt: new Date(session.expiresAt) };
}

export async function invalidateSession(token: string): Promise<void> {
	if (!TOKEN_RE.test(token)) return;
	await sql`select app.delete_session(${hashToken(token)})`;
}
