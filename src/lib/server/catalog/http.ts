import { DataAccessError } from '$lib/data/errors';
import { setTimeout as delay } from 'node:timers/promises';
import { ProviderGate } from './provider-gate';

export const PROVIDER_TIMEOUT_MS = 7000;
const MAX_BODY_CHARS = 2_000_000;
const USER_AGENT = 'Segnalibro/0.1 (libreria personale; contatto: self-hosted)';
const gates = new Map<string, ProviderGate>();
function gateFor(host: string) {
	let gate = gates.get(host);
	if (!gate) {
		gate = new ProviderGate(host === 'openlibrary.org' ? 1000 : host === 'inventaire.io' ? 500 : 0);
		gates.set(host, gate);
	}
	return gate;
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface FetchJsonOptions {
	fetch?: FetchLike | undefined;
	/** Solo questi host (nessun fetch di URL arbitrari) */
	allowedHosts: readonly string[];
	signal?: AbortSignal | undefined;
	timeoutMs?: number | undefined;
}

interface FetchCoreOptions extends FetchJsonOptions {
	/** Intestazione `accept` della richiesta (JSON per impostazione predefinita). */
	accept: string;
}

/**
 * GET verso un host in allow-list, con timeout. `null` su 404 (risorsa assente).
 * Errori mappati: 429 -> RATE_LIMITED, timeout/rete/5xx -> NETWORK, altro -> SERVER.
 */
async function fetchAllowlisted(url: string, options: FetchCoreOptions): Promise<Response | null> {
	const parsed = new URL(url);
	if (
		parsed.protocol !== 'https:' ||
		parsed.username ||
		parsed.password ||
		(parsed.port && parsed.port !== '443') ||
		!options.allowedHosts.includes(parsed.hostname)
	) {
		throw new DataAccessError('VALIDATION', `Host non consentito: ${parsed.hostname}`);
	}

	const timeout = AbortSignal.timeout(options.timeoutMs ?? PROVIDER_TIMEOUT_MS);
	const signal = options.signal ? AbortSignal.any([timeout, options.signal]) : timeout;
	const doFetch: FetchLike = options.fetch ?? ((input, init) => fetch(input, init));

	let response: Response;
	try {
		if (!options.fetch) {
			const wait = gateFor(parsed.hostname).reserve();
			if (wait) await delay(wait, undefined, { signal });
			gateFor(parsed.hostname).check();
		}
		response = await doFetch(url, {
			headers: { accept: options.accept, 'user-agent': USER_AGENT },
			signal,
			redirect: 'manual'
		});
		for (let hops = 0; response.status >= 300 && response.status < 400; hops++) {
			const location = response.headers.get('location');
			if (!location || hops >= 3)
				throw new DataAccessError('CONTRACT', 'Redirect del catalogo non valido');
			const target = new URL(location, url);
			if (
				target.protocol !== 'https:' ||
				target.username ||
				target.password ||
				(target.port && target.port !== '443') ||
				!options.allowedHosts.includes(target.hostname)
			)
				throw new DataAccessError('VALIDATION', 'Redirect non consentito');
			await response.body?.cancel();
			url = target.toString();
			if (!options.fetch) {
				const wait = gateFor(target.hostname).reserve();
				if (wait) await delay(wait, undefined, { signal });
				gateFor(target.hostname).check();
			}
			response = await doFetch(url, {
				headers: { accept: options.accept, 'user-agent': USER_AGENT },
				signal,
				redirect: 'manual'
			});
		}
	} catch (error) {
		if (error instanceof DataAccessError) throw error;
		const aborted =
			error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
		throw new DataAccessError(
			'NETWORK',
			aborted ? 'Il servizio non ha risposto in tempo' : 'Servizio non raggiungibile',
			error
		);
	}

	// Un redirect non deve portarci fuori dall'allow-list.
	if (response.url) {
		try {
			const finalHost = new URL(response.url).hostname;
			if (!options.allowedHosts.includes(finalHost)) {
				throw new DataAccessError('VALIDATION', `Redirect non consentito: ${finalHost}`);
			}
		} catch (error) {
			if (error instanceof DataAccessError) throw error;
		}
	}

	if (response.status === 404) return null;
	if (response.status === 429) {
		if (!options.fetch) gateFor(parsed.hostname).pause(response.headers.get('retry-after'));
		throw new DataAccessError('RATE_LIMITED', 'Troppe richieste al servizio di catalogo');
	}
	if (response.status >= 500) {
		throw new DataAccessError('NETWORK', `Il servizio ha risposto ${response.status}`);
	}
	if (!response.ok) {
		throw new DataAccessError('SERVER', `Il servizio ha risposto ${response.status}`);
	}
	return response;
}

async function readBody(response: Response): Promise<string> {
	try {
		const text = await response.text();
		if (text.length > MAX_BODY_CHARS) throw new Error('risposta troppo grande');
		return text;
	} catch (error) {
		throw new DataAccessError('CONTRACT', 'Risposta del catalogo non valida', error);
	}
}

/** GET JSON verso un host in allow-list, con timeout. `null` su 404 (risorsa assente). */
export async function fetchJson(url: string, options: FetchJsonOptions): Promise<unknown | null> {
	const response = await fetchAllowlisted(url, { ...options, accept: 'application/json' });
	if (response === null) return null;
	try {
		return JSON.parse(await readBody(response)) as unknown;
	} catch (error) {
		if (error instanceof DataAccessError) throw error;
		throw new DataAccessError('CONTRACT', 'Risposta del catalogo non valida', error);
	}
}

/** Come `fetchJson`, ma per risposte testuali (SRU/MARCXML). `null` su 404. */
export async function fetchText(url: string, options: FetchJsonOptions): Promise<string | null> {
	const response = await fetchAllowlisted(url, { ...options, accept: 'application/xml' });
	if (response === null) return null;
	return readBody(response);
}
