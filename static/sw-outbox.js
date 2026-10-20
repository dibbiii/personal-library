/*
 * Background Sync per la outbox offline (MASTER_SPEC §9). Caricato dal service worker generato
 * da vite-plugin-pwa tramite workbox.importScripts (vite.config.ts).
 *
 * Quando il browser riconquista la rete e c'è un sync registrato dalla pagina
 * ('segnalibro-outbox') invia gli eventi in coda con la stessa regola della pagina:
 * rimozione dalla outbox solo dopo un ack 2xx, 4xx permanente -> store `failed`.
 * Lo schema IndexedDB è quello di src/lib/offline/idb-storage.ts.
 */
const OUTBOX_DB = 'segnalibro-offline';
const OUTBOX_TAG = 'segnalibro-outbox';
const OUTBOX_LOCK = 'segnalibro-outbox-flush';
const OUTBOX_ENDPOINT = '/api/reading/event';

self.addEventListener('sync', (event) => {
	if (event.tag === OUTBOX_TAG) event.waitUntil(flushOutboxFromWorker());
});

function idbRequest(request) {
	return new Promise((resolve, reject) => {
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	});
}

function idbTransactionDone(tx) {
	return new Promise((resolve, reject) => {
		tx.oncomplete = () => resolve();
		tx.onerror = () => reject(tx.error);
		tx.onabort = () => reject(tx.error);
	});
}

function openOutbox() {
	return new Promise((resolve, reject) => {
		const request = indexedDB.open(OUTBOX_DB);
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
		// Se il database non esiste ancora non c'è nulla da inviare.
		request.onupgradeneeded = () => {
			request.transaction.abort();
			reject(new Error('outbox-empty'));
		};
	});
}

function compareRecords(a, b) {
	const ta = Date.parse(a.occurredAt);
	const tb = Date.parse(b.occurredAt);
	if (ta !== tb) return ta - tb;
	if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
	return (a.seq || 0) - (b.seq || 0);
}

function backoff(attempts) {
	return Math.min(5 * 60000, 2000 * 2 ** Math.max(0, attempts - 1));
}

async function flushOutboxFromWorker() {
	let db;
	try {
		db = await openOutbox();
	} catch {
		return;
	}

	const run = async () => {
		const meta = await idbRequest(db.transaction('meta').objectStore('meta').get('userId'));
		const userId = meta && meta.value;
		if (!userId) return;

		const pending = await idbRequest(
			db.transaction('outbox').objectStore('outbox').index('by-user').getAll(userId)
		);
		pending.sort(compareRecords);

		const blocked = new Set();
		const delivered = [];
		let mustRetry = false;

		for (const item of pending) {
			if (blocked.has(item.readingId)) continue;
			if (item.nextAttemptAt > Date.now()) {
				blocked.add(item.readingId);
				mustRetry = true;
				continue;
			}

			let response;
			try {
				response = await fetch(OUTBOX_ENDPOINT, {
					method: 'POST',
					headers: { 'content-type': 'application/json', accept: 'application/json' },
					body: JSON.stringify({
						eventId: item.eventId,
						readingId: item.readingId,
						page: item.page,
						occurredAt: item.occurredAt,
						localDate: item.localDate,
						operation: item.operation
					}),
					credentials: 'same-origin',
					redirect: 'manual'
				});
			} catch {
				mustRetry = true;
				break;
			}

			const status = response.status;
			const isJson = (response.headers.get('content-type') || '').includes('json');

			if (response.type === 'opaqueredirect' || status === 401 || status === 403) break;

			let acknowledged = false;
			if (status >= 200 && status < 300 && isJson) {
				try {
					await response.json();
					acknowledged = true;
				} catch {
					// A 2xx response with an unreadable JSON body is not a valid ack; retry below.
				}
			}

			if (acknowledged) {
				const tx = db.transaction('outbox', 'readwrite');
				tx.objectStore('outbox').delete(item.eventId);
				await idbTransactionDone(tx);
				delivered.push(item.eventId);
				continue;
			}

			if (status >= 500 || status === 408 || status === 425 || status === 429 || status < 400) {
				const attempts = (item.attempts || 0) + 1;
				const tx = db.transaction('outbox', 'readwrite');
				tx.objectStore('outbox').put({
					...item,
					attempts,
					nextAttemptAt: Date.now() + backoff(attempts),
					lastError: 'HTTP ' + status
				});
				await idbTransactionDone(tx);
				blocked.add(item.readingId);
				mustRetry = true;
				continue;
			}

			let reason = "Il server ha rifiutato l'aggiornamento (HTTP " + status + ')';
			try {
				const body = await response.json();
				if (body && typeof body.message === 'string') reason = body.message;
			} catch {
				// corpo non JSON
			}
			const tx = db.transaction(['outbox', 'failed'], 'readwrite');
			tx.objectStore('failed').put({
				...item,
				attempts: (item.attempts || 0) + 1,
				lastError: reason,
				reason,
				status,
				failedAt: Date.now()
			});
			tx.objectStore('outbox').delete(item.eventId);
			await idbTransactionDone(tx);
		}

		if (delivered.length && typeof BroadcastChannel !== 'undefined') {
			const channel = new BroadcastChannel('segnalibro-outbox');
			channel.postMessage({ type: 'synced', eventIds: delivered });
			channel.close();
		}

		// Un errore fa riprovare il Background Sync più tardi (con il backoff del browser).
		if (mustRetry) throw new Error('outbox-retry');
	};

	try {
		// Stesso lock della pagina: mai due invii contemporanei dello stesso evento.
		if (self.navigator && navigator.locks) {
			await navigator.locks.request(OUTBOX_LOCK, run);
		} else {
			await run();
		}
	} finally {
		db.close();
	}
}
