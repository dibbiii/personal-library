import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import {
	BACKOFF_MAX_MS,
	InProcessLock,
	OutboxEngine,
	backoffDelay,
	compareRecords
} from '../../src/lib/offline/core';
import { classifyResponse } from '../../src/lib/offline/transport';
import {
	readingOpSchema,
	type FailedRecord,
	type OutboxRecord,
	type OutboxStorage,
	type ReadingOp,
	type SendOutcome
} from '../../src/lib/offline/types';

type WorkerRequest = {
	result: unknown;
	onsuccess?: () => void;
	onerror?: () => void;
};

type WorkerStore = {
	get: (key: string) => WorkerRequest;
	index: (name: string) => { getAll: (userId: string) => WorkerRequest };
	delete: (eventId: string) => void;
	put: (record: OutboxRecord) => void;
};

type WorkerTransaction = {
	oncomplete?: () => void;
	onerror?: () => void;
	onabort?: () => void;
	objectStore: (name: string) => WorkerStore;
};

type WorkerSyncEvent = {
	tag: string;
	waitUntil: (promise: Promise<unknown>) => void;
};

const workerScript = readFileSync(resolve(process.cwd(), 'static/sw-outbox.js'), 'utf8');

function workerHarness(
	item: OutboxRecord,
	response: {
		status: number;
		headers: { get: (name: string) => string | null };
		json: () => Promise<unknown>;
	}
) {
	const outbox = new Map([[item.eventId, item]]);
	const request = (result: unknown): WorkerRequest => {
		const req: WorkerRequest = { result };
		queueMicrotask(() => req.onsuccess?.());
		return req;
	};
	const database = {
		transaction: (_stores: string | string[]) => {
			const tx: WorkerTransaction = {
				objectStore: (_name) => ({
					get: (key) => request(key === 'userId' ? { value: USER } : undefined),
					index: (_indexName) => ({
						getAll: (userId) =>
							request([...outbox.values()].filter((record) => record.userId === userId))
					}),
					delete: (eventId) => {
						outbox.delete(eventId);
						queueMicrotask(() => tx.oncomplete?.());
					},
					put: (record) => {
						outbox.set(record.eventId, record);
						queueMicrotask(() => tx.oncomplete?.());
					}
				})
			};
			return tx;
		},
		close: () => {}
	};
	let syncListener: ((event: WorkerSyncEvent) => void) | undefined;
	const self = {
		navigator: {},
		addEventListener: (type: string, listener: (event: WorkerSyncEvent) => void) => {
			if (type === 'sync') syncListener = listener;
		}
	};

	runInNewContext(workerScript, {
		self,
		navigator: {},
		indexedDB: {
			open: () => {
				const req: WorkerRequest = { result: database };
				queueMicrotask(() => req.onsuccess?.());
				return req;
			}
		},
		fetch: async () => response
	});

	return {
		outbox,
		flush: () => {
			if (!syncListener) throw new Error('sync listener was not registered');
			let completion!: Promise<unknown>;
			syncListener({
				tag: 'segnalibro-outbox',
				waitUntil: (promise) => {
					completion = promise;
				}
			});
			return completion;
		}
	};
}

/** Storage in memoria: stessa semantica di IdbOutboxStorage, senza IndexedDB. */
class MemoryStorage implements OutboxStorage {
	outbox = new Map<string, OutboxRecord>();
	failed = new Map<string, FailedRecord>();

	async add(record: OutboxRecord) {
		if (!this.outbox.has(record.eventId)) this.outbox.set(record.eventId, record);
	}
	async get(eventId: string) {
		return this.outbox.get(eventId);
	}
	async listPending(userId: string) {
		return [...this.outbox.values()].filter((r) => r.userId === userId);
	}
	async update(record: OutboxRecord) {
		this.outbox.set(record.eventId, record);
	}
	async remove(eventId: string) {
		this.outbox.delete(eventId);
	}
	async moveToFailed(record: FailedRecord) {
		this.failed.set(record.eventId, record);
		this.outbox.delete(record.eventId);
	}
	async listFailed(userId: string) {
		return [...this.failed.values()].filter((r) => r.userId === userId);
	}
	async requeueFailed(eventId: string) {
		const item = this.failed.get(eventId);
		if (!item) return false;
		this.failed.delete(eventId);
		const { reason: _r, status: _s, failedAt: _f, ...record } = item;
		this.outbox.set(eventId, { ...record, attempts: 0, nextAttemptAt: 0, lastError: null });
		return true;
	}
	async removeFailed(eventId: string) {
		this.failed.delete(eventId);
	}
}

const USER = '11111111-1111-4111-8111-111111111111';
const OTHER_USER = '22222222-2222-4222-8222-222222222222';
const READING_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const READING_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

let counter = 0;
function op(overrides: Partial<ReadingOp> = {}): ReadingOp {
	counter += 1;
	return {
		eventId: `00000000-0000-4000-8000-${String(counter).padStart(12, '0')}`,
		readingId: READING_A,
		page: 10 * counter,
		occurredAt: new Date(Date.UTC(2026, 8, 1, 10, counter)).toISOString(),
		localDate: '2026-09-01',
		operation: 'progress',
		...overrides
	};
}

const ok = (body: unknown = { ok: true }): SendOutcome => ({ kind: 'ok', body });

function setup(
	handler: (record: OutboxRecord, calls: OutboxRecord[]) => SendOutcome | Promise<SendOutcome>
) {
	const storage = new MemoryStorage();
	const calls: OutboxRecord[] = [];
	let clock = 1_000_000;
	const engine = new OutboxEngine({
		storage,
		lock: new InProcessLock(),
		now: () => clock,
		random: () => 0.5,
		send: async (record) => {
			calls.push(record);
			return handler(record, calls);
		}
	});
	return {
		storage,
		engine,
		calls,
		advance: (ms: number) => {
			clock += ms;
		}
	};
}

describe('ordinamento', () => {
	it('ordina per occurredAt e poi per inserimento', async () => {
		const { engine, calls } = setup(() => ok());
		const late = op({ occurredAt: '2026-09-01T12:00:00.000Z' });
		const early = op({ occurredAt: '2026-09-01T08:00:00.000Z' });
		const tieA = op({ occurredAt: '2026-09-01T10:00:00.000Z' });
		const tieB = op({ occurredAt: '2026-09-01T10:00:00.000Z' });

		for (const item of [late, tieA, early, tieB]) await engine.enqueue(USER, item);
		await engine.flush(USER);

		expect(calls.map((c) => c.eventId)).toEqual([early, tieA, tieB, late].map((c) => c.eventId));
	});

	it('compareRecords è stabile anche con createdAt/seq uguali', () => {
		const base = {
			userId: USER,
			createdAt: 1,
			seq: 1,
			attempts: 0,
			nextAttemptAt: 0,
			lastError: null
		};
		const a: OutboxRecord = { ...op(), ...base };
		const b: OutboxRecord = { ...a, eventId: 'ffffffff-ffff-4fff-8fff-ffffffffffff' };
		expect(compareRecords(a, b)).toBeLessThan(0);
		expect(compareRecords(b, a)).toBeGreaterThan(0);
	});
});

describe('ack e rimozione', () => {
	it('rimuove dalla coda solo dopo un ack 2xx', async () => {
		const { engine, storage } = setup(() => ok({ duplicate: false }));
		const item = op();
		await engine.enqueue(USER, item);

		const result = await engine.flush(USER);
		expect(result.delivered.get(item.eventId)).toEqual({ duplicate: false });
		expect(storage.outbox.size).toBe(0);
	});

	it('errore di rete: la voce resta in coda e il flush si ferma', async () => {
		const { engine, storage, calls } = setup(() => ({ kind: 'network' }));
		await engine.enqueue(USER, op());
		await engine.enqueue(USER, op({ readingId: READING_B }));

		const result = await engine.flush(USER);
		expect(result.offline).toBe(true);
		expect(storage.outbox.size).toBe(2);
		expect(calls).toHaveLength(1);
	});

	it('sessione scaduta: niente perdita, niente failed', async () => {
		const { engine, storage } = setup(() => ({ kind: 'auth' }));
		await engine.enqueue(USER, op());
		const result = await engine.flush(USER);
		expect(result.authRequired).toBe(true);
		expect(storage.outbox.size).toBe(1);
		expect(storage.failed.size).toBe(0);
	});

	it('lo stesso eventId accodato due volte viene inviato una volta sola', async () => {
		const { engine, calls } = setup(() => ok());
		const item = op();
		await engine.enqueue(USER, item);
		await engine.enqueue(USER, item);
		await engine.flush(USER);
		expect(calls).toHaveLength(1);
	});
});

describe('errori permanenti e transitori', () => {
	it('un 4xx sposta la voce in failed con il motivo, senza retry', async () => {
		const { engine, storage, calls } = setup(() => ({
			kind: 'rejected',
			status: 409,
			reason: 'Lettura già conclusa',
			code: 'CONFLICT'
		}));
		const item = op();
		await engine.enqueue(USER, item);

		const first = await engine.flush(USER);
		expect(first.rejected.get(item.eventId)).toMatchObject({ status: 409, code: 'CONFLICT' });
		expect(storage.outbox.size).toBe(0);
		expect(storage.failed.get(item.eventId)?.reason).toBe('Lettura già conclusa');

		await engine.flush(USER);
		expect(calls).toHaveLength(1);
	});

	it('un 5xx applica il backoff e blocca solo le voci della stessa lettura', async () => {
		const { engine, storage, calls, advance } = setup((record) =>
			record.readingId === READING_A ? { kind: 'retry', status: 503 } : ok()
		);
		const a1 = op({ readingId: READING_A });
		const a2 = op({ readingId: READING_A });
		const b1 = op({ readingId: READING_B });
		for (const item of [a1, a2, b1]) await engine.enqueue(USER, item);

		const result = await engine.flush(USER);
		expect(calls.map((c) => c.eventId)).toEqual([a1.eventId, b1.eventId]);
		expect(result.delivered.has(b1.eventId)).toBe(true);
		expect(storage.outbox.get(a1.eventId)?.attempts).toBe(1);
		expect(result.nextRetryAt).toBeGreaterThan(1_000_000);

		// Nessun nuovo tentativo finché il backoff non scade.
		calls.length = 0;
		await engine.flush(USER);
		expect(calls).toHaveLength(0);

		advance(60_000);
		await engine.flush(USER);
		expect(calls.map((c) => c.eventId)).toEqual([a1.eventId]);
	});

	it('requeueFailed riporta la voce in coda e viene reinviata', async () => {
		let accept = false;
		const { engine, storage, calls } = setup(() =>
			accept ? ok() : { kind: 'rejected', status: 422, reason: 'Pagina oltre il totale' }
		);
		const item = op();
		await engine.enqueue(USER, item);
		await engine.flush(USER);
		expect(storage.failed.size).toBe(1);

		accept = true;
		await storage.requeueFailed(item.eventId);
		const result = await engine.flush(USER);
		expect(result.delivered.has(item.eventId)).toBe(true);
		expect(calls).toHaveLength(2);
	});
});

describe('isolamento e concorrenza', () => {
	it('non invia eventi di un altro account', async () => {
		const { engine, calls } = setup(() => ok());
		await engine.enqueue(OTHER_USER, op());
		await engine.flush(USER);
		expect(calls).toHaveLength(0);
	});

	it('due flush concorrenti non inviano due volte lo stesso evento', async () => {
		let release!: () => void;
		const gate = new Promise<void>((resolve) => (release = resolve));
		const { engine, calls } = setup(async () => {
			await gate;
			return ok();
		});
		await engine.enqueue(USER, op());

		const first = engine.flush(USER);
		const second = engine.flush(USER); // wait: false -> saltato
		const secondResult = await second;
		expect(secondResult.skipped).toBe(true);

		release();
		const firstResult = await first;
		expect(firstResult.delivered.size).toBe(1);
		expect(calls).toHaveLength(1);
	});

	it('flush con wait:true attende il lock e non reinvia ciò che è già stato confermato', async () => {
		let release!: () => void;
		const gate = new Promise<void>((resolve) => (release = resolve));
		const { engine, calls } = setup(async () => {
			await gate;
			return ok();
		});
		await engine.enqueue(USER, op());

		const first = engine.flush(USER);
		const waiting = engine.flush(USER, { wait: true });
		release();
		await first;
		const waited = await waiting;

		expect(waited.skipped).toBe(false);
		expect(waited.delivered.size).toBe(0);
		expect(calls).toHaveLength(1);
	});
});

describe('backoff', () => {
	it('cresce in modo esponenziale e ha un tetto', () => {
		const mid = () => 0.5;
		expect(backoffDelay(1, mid)).toBe(2_000);
		expect(backoffDelay(2, mid)).toBe(4_000);
		expect(backoffDelay(3, mid)).toBe(8_000);
		expect(backoffDelay(30, mid)).toBe(BACKOFF_MAX_MS);
	});

	it('il jitter resta entro ±20%', () => {
		expect(backoffDelay(3, () => 0)).toBe(Math.round(8_000 * 0.8));
		expect(backoffDelay(3, () => 1)).toBe(Math.round(8_000 * 1.2));
	});
});

describe('classificazione delle risposte HTTP', () => {
	const json = 'application/json; charset=utf-8';
	it('2xx JSON è un ack', () => {
		expect(classifyResponse({ status: 200, contentType: json })).toBe('ok');
		expect(classifyResponse({ status: 201, contentType: json })).toBe('ok');
	});
	it('2xx non JSON (captive portal) non è un ack', () => {
		expect(classifyResponse({ status: 200, contentType: 'text/html' })).toBe('invalid-ok');
	});
	it('redirect al login e 401/403 richiedono autenticazione', () => {
		expect(classifyResponse({ status: 0, type: 'opaqueredirect' })).toBe('auth');
		expect(classifyResponse({ status: 200, redirected: true, contentType: 'text/html' })).toBe(
			'auth'
		);
		expect(classifyResponse({ status: 401 })).toBe('auth');
		expect(classifyResponse({ status: 403 })).toBe('auth');
	});
	it('5xx, 408 e 429 si ritentano; gli altri 4xx sono permanenti', () => {
		for (const status of [500, 502, 503, 408, 429]) {
			expect(classifyResponse({ status })).toBe('retry');
		}
		for (const status of [400, 404, 409, 422]) {
			expect(classifyResponse({ status })).toBe('rejected');
		}
	});
});

describe('service worker outbox', () => {
	const jsonHeaders = { get: () => 'application/json; charset=utf-8' };

	it('ritenta un 2xx JSON malformato senza rimuovere la voce', async () => {
		const item: OutboxRecord = {
			...op(),
			userId: USER,
			createdAt: 1,
			seq: 1,
			attempts: 0,
			nextAttemptAt: 0,
			lastError: null
		};
		const harness = workerHarness(item, {
			status: 200,
			headers: jsonHeaders,
			json: async () => {
				throw new SyntaxError('Invalid JSON');
			}
		});

		await expect(harness.flush()).rejects.toThrow('outbox-retry');
		expect(harness.outbox.get(item.eventId)).toMatchObject({
			attempts: 1,
			lastError: 'HTTP 200'
		});
		expect(harness.outbox.get(item.eventId)?.nextAttemptAt).toBeGreaterThan(Date.now());
	});

	it('rimuove la voce dopo aver letto un 2xx JSON valido', async () => {
		const item: OutboxRecord = {
			...op(),
			userId: USER,
			createdAt: 1,
			seq: 1,
			attempts: 0,
			nextAttemptAt: 0,
			lastError: null
		};
		const harness = workerHarness(item, {
			status: 200,
			headers: jsonHeaders,
			json: async () => ({ ok: true })
		});

		await harness.flush();
		expect(harness.outbox.has(item.eventId)).toBe(false);
	});
});

describe('readingOpSchema', () => {
	it('accetta un evento valido e rifiuta dati malformati', () => {
		expect(readingOpSchema.safeParse(op()).success).toBe(true);
		expect(readingOpSchema.safeParse({ ...op(), eventId: 'non-uuid' }).success).toBe(false);
		expect(readingOpSchema.safeParse({ ...op(), page: -1 }).success).toBe(false);
		expect(readingOpSchema.safeParse({ ...op(), operation: 'delete' }).success).toBe(false);
		expect(readingOpSchema.safeParse({ ...op(), localDate: '01/09/2026' }).success).toBe(false);
	});
});
