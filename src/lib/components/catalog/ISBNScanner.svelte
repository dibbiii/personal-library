<script lang="ts">
	import { onMount } from 'svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import { parseIsbn, parseScannedCode } from '$lib/catalog/isbn';

	interface Props {
		/** ISBN-13 valido letto dal codice a barre o digitato. */
		onscan: (isbn13: string) => void;
		/** Link alle alternative: chi arriva con una serie precompilata non la perde. */
		searchHref?: string;
		manualHref?: string;
	}

	let { onscan, searchHref = '/add/search', manualHref = '/add/manual' }: Props = $props();

	type Status =
		| 'starting'
		| 'scanning'
		| 'paused'
		| 'insecure'
		| 'unsupported'
		| 'denied'
		| 'no-camera'
		| 'error';

	// Tipi minimi: BarcodeDetector non è nei tipi DOM di TypeScript.
	interface DetectedBarcode {
		rawValue: string;
	}
	interface BarcodeDetectorLike {
		detect(source: HTMLVideoElement): Promise<DetectedBarcode[]>;
	}
	interface BarcodeDetectorCtor {
		new (options?: { formats?: string[] }): BarcodeDetectorLike;
		getSupportedFormats?: () => Promise<string[]>;
	}
	type Detect = (video: HTMLVideoElement) => Promise<string | null>;

	let status = $state<Status>('starting');
	let engine = $state<'native' | 'zxing' | null>(null);
	let torchAvailable = $state(false);
	let torchOn = $state(false);
	let announcement = $state('');
	let hint = $state('');

	let manual = $state('');
	let manualError = $state('');

	let video = $state<HTMLVideoElement>();
	let stream: MediaStream | null = null;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let session = 0; // invalida i cicli di scansione e gli avvii rimasti a metà
	let lastRejected = '';

	const showCamera = $derived(
		status === 'starting' || status === 'scanning' || status === 'paused'
	);

	const problem = $derived.by(() => {
		switch (status) {
			case 'insecure':
				return {
					title: 'La fotocamera richiede una connessione sicura',
					text: 'Il browser abilita la fotocamera solo su HTTPS (o su localhost). Apri l’app da un indirizzo https:// oppure digita l’ISBN qui sotto.'
				};
			case 'unsupported':
				return {
					title: 'Fotocamera non disponibile in questo browser',
					text: 'Puoi digitare l’ISBN che trovi sul retro del libro, oppure cercare per titolo.'
				};
			case 'denied':
				return {
					title: 'Accesso alla fotocamera negato',
					text: 'Per scansionare, consenti la fotocamera per questo sito dalle impostazioni del browser e riprova. Intanto puoi digitare l’ISBN.'
				};
			case 'no-camera':
				return {
					title: 'Nessuna fotocamera trovata',
					text: 'Su questo dispositivo non risulta una fotocamera. Digita l’ISBN o cerca per titolo.'
				};
			case 'error':
				return {
					title: 'Non riesco ad avviare la fotocamera',
					text: 'Potrebbe essere in uso da un’altra app. Riprova, oppure digita l’ISBN.'
				};
			default:
				return null;
		}
	});

	function stopStream() {
		clearTimeout(timer);
		timer = undefined;
		if (stream) {
			for (const track of stream.getTracks()) track.stop();
			stream = null;
		}
		if (video) video.srcObject = null;
		torchAvailable = false;
		torchOn = false;
	}

	async function createDetector(): Promise<{ detect: Detect; engine: 'native' | 'zxing' }> {
		const Native = (globalThis as unknown as { BarcodeDetector?: BarcodeDetectorCtor })
			.BarcodeDetector;
		if (Native) {
			try {
				const formats = (await Native.getSupportedFormats?.()) ?? ['ean_13'];
				if (formats.includes('ean_13')) {
					const detector = new Native({ formats: ['ean_13'] });
					return {
						engine: 'native',
						detect: async (source) => (await detector.detect(source))[0]?.rawValue ?? null
					};
				}
			} catch {
				// si passa a ZXing
			}
		}

		// ZXing solo quando serve: resta fuori dal bundle iniziale.
		const zxing = await import('@zxing/library');
		const reader = new zxing.MultiFormatReader();
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- non reattivo: hint per ZXing
		const hints = new Map<import('@zxing/library').DecodeHintType, unknown>();
		hints.set(zxing.DecodeHintType.POSSIBLE_FORMATS, [zxing.BarcodeFormat.EAN_13]);
		hints.set(zxing.DecodeHintType.TRY_HARDER, true);
		reader.setHints(hints);
		const canvas = document.createElement('canvas');
		const context = canvas.getContext('2d', { willReadFrequently: true });

		return {
			engine: 'zxing',
			detect: async (source) => {
				const element = source as HTMLVideoElement;
				if (!context || !element.videoWidth) return null;
				const scale = Math.min(1, 800 / element.videoWidth);
				canvas.width = Math.round(element.videoWidth * scale);
				canvas.height = Math.round(element.videoHeight * scale);
				context.drawImage(element, 0, 0, canvas.width, canvas.height);
				try {
					const bitmap = new zxing.BinaryBitmap(
						new zxing.HybridBinarizer(new zxing.HTMLCanvasElementLuminanceSource(canvas))
					);
					return reader.decodeWithState(bitmap).getText();
				} catch (error) {
					if (error instanceof zxing.NotFoundException) return null;
					if (error instanceof zxing.ChecksumException || error instanceof zxing.FormatException)
						return null;
					throw error;
				}
			}
		};
	}

	function classify(error: unknown): Status {
		const name = error instanceof DOMException || error instanceof Error ? error.name : '';
		if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError')
			return 'denied';
		if (
			name === 'NotFoundError' ||
			name === 'DevicesNotFoundError' ||
			name === 'OverconstrainedError'
		) {
			return 'no-camera';
		}
		return 'error';
	}

	async function start() {
		const mine = ++session;
		stopStream();
		hint = '';
		lastRejected = '';

		if (!window.isSecureContext) {
			status = 'insecure';
			return;
		}
		if (!navigator.mediaDevices?.getUserMedia) {
			status = 'unsupported';
			return;
		}

		status = 'starting';
		announcement = 'Avvio della fotocamera…';
		let media: MediaStream;
		try {
			media = await navigator.mediaDevices.getUserMedia({
				audio: false,
				video: {
					facingMode: { ideal: 'environment' },
					width: { ideal: 1280 },
					height: { ideal: 720 }
				}
			});
		} catch (error) {
			if (mine === session) {
				status = classify(error);
				announcement = '';
			}
			return;
		}

		// Smontato (o riavviato) mentre si attendeva il permesso: la fotocamera non deve restare accesa.
		if (mine !== session || !video) {
			for (const track of media.getTracks()) track.stop();
			return;
		}

		stream = media;
		video.srcObject = media;
		try {
			await video.play();
		} catch {
			// autoplay bloccato: il video parte comunque al primo frame
		}

		const track = media.getVideoTracks()[0];
		const capabilities = (track?.getCapabilities?.() ?? {}) as { torch?: boolean };
		torchAvailable = Boolean(capabilities.torch);

		let detector: { detect: Detect; engine: 'native' | 'zxing' };
		try {
			detector = await createDetector();
		} catch {
			if (mine === session) {
				stopStream();
				status = 'unsupported';
			}
			return;
		}
		if (mine !== session) return;

		engine = detector.engine;
		status = 'scanning';
		announcement = 'Fotocamera attiva. Inquadra il codice a barre sul retro del libro.';

		const interval = detector.engine === 'native' ? 180 : 260;
		const tick = async () => {
			if (mine !== session || !video) return;
			if (video.readyState >= 2) {
				try {
					const raw = await detector.detect(video);
					if (mine !== session) return;
					if (raw && handleCode(raw)) return;
				} catch {
					// frame non leggibile: si riprova
				}
			}
			timer = setTimeout(tick, interval);
		};
		timer = setTimeout(tick, interval);
	}

	/** true = ISBN trovato (la scansione si ferma). */
	function handleCode(raw: string): boolean {
		const parsed = parseScannedCode(raw);
		if (!parsed) {
			if (raw !== lastRejected) {
				lastRejected = raw;
				hint = 'Questo codice non è un ISBN: cerca quello sul retro del libro, vicino al prezzo.';
			}
			return false;
		}
		session++; // ferma il ciclo
		stopStream();
		status = 'paused';
		announcement = `ISBN ${parsed.isbn13} letto.`;
		navigator.vibrate?.(60);
		onscan(parsed.isbn13);
		return true;
	}

	async function toggleTorch() {
		const track = stream?.getVideoTracks()[0];
		if (!track) return;
		try {
			await track.applyConstraints({
				advanced: [{ torch: !torchOn } as Record<string, unknown>]
			});
			torchOn = !torchOn;
		} catch {
			torchAvailable = false;
		}
	}

	function submitManual(event: SubmitEvent) {
		event.preventDefault();
		const parsed = parseIsbn(manual);
		if (!parsed) {
			manualError = 'ISBN non valido: controlla le cifre (10 o 13, anche con trattini).';
			return;
		}
		manualError = '';
		session++;
		stopStream();
		status = 'paused';
		onscan(parsed.isbn13);
	}

	onMount(() => {
		start();

		// Fotocamera spenta quando la scheda non è visibile; si riaccende al ritorno.
		let pausedByVisibility = false;
		const onVisibility = () => {
			if (document.hidden) {
				if (stream) {
					session++;
					stopStream();
					status = 'paused';
					pausedByVisibility = true;
				}
			} else if (pausedByVisibility) {
				pausedByVisibility = false;
				start();
			}
		};
		const onHide = () => {
			session++;
			stopStream();
		};
		document.addEventListener('visibilitychange', onVisibility);
		window.addEventListener('pagehide', onHide);

		return () => {
			document.removeEventListener('visibilitychange', onVisibility);
			window.removeEventListener('pagehide', onHide);
			session++;
			stopStream();
		};
	});

	/** Riavvio manuale dopo una lettura (es. "Scansiona un altro libro"). */
	export function restart() {
		start();
	}
</script>

<section class="scanner" aria-label="Scansione del codice ISBN">
	<p class="instructions">
		Inquadra il <strong>codice a barre</strong> sul retro del libro (quello vicino al prezzo), con buona
		luce e tenendolo fermo.
	</p>

	{#if showCamera}
		<div class="viewfinder" data-testid="scanner-viewfinder">
			<video bind:this={video} playsinline muted aria-label="Anteprima della fotocamera"></video>
			<div class="frame" aria-hidden="true"><span></span></div>
			{#if status === 'starting'}
				<div class="overlay">
					<p>Avvio della fotocamera…</p>
					<p class="overlay-sub">Se il browser lo chiede, consenti l’accesso.</p>
				</div>
			{:else if status === 'paused'}
				<div class="overlay">
					<p>Fotocamera in pausa</p>
					<Button size="sm" onclick={start}>Riattiva</Button>
				</div>
			{/if}
			{#if torchAvailable}
				<button
					class="torch"
					type="button"
					aria-pressed={torchOn}
					aria-label={torchOn ? 'Spegni la torcia' : 'Accendi la torcia'}
					onclick={toggleTorch}
				>
					<svg
						width="22"
						height="22"
						viewBox="0 0 24 24"
						fill={torchOn ? 'currentColor' : 'none'}
						stroke="currentColor"
						stroke-width="1.9"
						stroke-linecap="round"
						stroke-linejoin="round"
						aria-hidden="true"
					>
						<path d="M13 2 4 14h7l-1 8 9-12h-7z" />
					</svg>
				</button>
			{/if}
		</div>
	{:else if problem}
		<div class="problem" role="alert" data-testid="scanner-problem" data-status={status}>
			<span class="problem-icon" aria-hidden="true"><Icon name="camera" size={26} /></span>
			<h2>{problem.title}</h2>
			<p>{problem.text}</p>
			{#if status === 'denied' || status === 'error'}
				<Button size="sm" variant="secondary" onclick={start}>Riprova</Button>
			{/if}
		</div>
	{/if}

	<p class="sr-only" role="status" aria-live="polite">{announcement}</p>
	{#if hint}<p class="hint" role="status">{hint}</p>{/if}
	{#if engine === 'zxing' && status === 'scanning'}
		<p class="engine">Scansione compatibile attiva</p>
	{/if}

	<form class="manual" method="dialog" onsubmit={submitManual} novalidate>
		<label for="isbn-manual">Oppure digita l’ISBN</label>
		<div class="manual-row">
			<input
				id="isbn-manual"
				name="isbn"
				type="text"
				inputmode="numeric"
				autocomplete="off"
				placeholder="978…"
				bind:value={manual}
				aria-invalid={manualError ? 'true' : undefined}
				aria-describedby={manualError ? 'isbn-manual-error' : undefined}
			/>
			<Button type="submit" size="sm">Cerca</Button>
		</div>
		{#if manualError}<p id="isbn-manual-error" class="error" role="alert">{manualError}</p>{/if}
	</form>

	<p class="alt">
		Preferisci cercare per titolo? <a href={searchHref}>Vai alla ricerca</a> ·
		<a href={manualHref}>Inserisci a mano</a>
	</p>
</section>

<style>
	.scanner {
		display: flex;
		flex-direction: column;
		gap: 14px;
	}

	.instructions {
		margin: 0;
		font-size: 14px;
		line-height: 1.45;
		color: var(--color-text-secondary);
	}

	.instructions strong {
		color: var(--color-text-primary);
	}

	.viewfinder {
		position: relative;
		overflow: hidden;
		aspect-ratio: 4 / 3;
		border-radius: var(--radius-xl);
		background: var(--color-text-primary);
		box-shadow: var(--shadow-card);
	}

	video {
		display: block;
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.frame {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		pointer-events: none;
	}

	.frame span {
		width: 72%;
		height: 40%;
		border: 3px solid var(--color-accent);
		border-radius: 18px;
		box-shadow: 0 0 0 999px color-mix(in srgb, var(--color-text-primary) 38%, transparent);
	}

	.overlay {
		position: absolute;
		inset: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 10px;
		margin: 0;
		background: color-mix(in srgb, var(--color-text-primary) 62%, transparent);
		font-size: 14px;
		font-weight: 600;
		color: var(--color-on-primary);
	}

	.overlay p {
		margin: 0;
	}

	.overlay-sub {
		font-size: 12.5px;
		font-weight: 400;
		opacity: 0.85;
	}

	.torch {
		position: absolute;
		right: 12px;
		bottom: 12px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 48px;
		height: 48px;
		border: 0;
		border-radius: 50%;
		background: color-mix(in srgb, var(--color-background) 92%, transparent);
		color: var(--color-primary);
	}

	.torch[aria-pressed='true'] {
		background: var(--color-accent);
	}

	.problem {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 8px;
		padding: 26px 22px;
		border-radius: var(--radius-xl);
		background: var(--color-surface);
		text-align: center;
	}

	.problem h2 {
		font-size: 20px;
		line-height: 1.2;
	}

	.problem p {
		margin: 0 0 6px;
		font-size: 14px;
		line-height: 1.45;
		color: var(--color-text-secondary);
	}

	.problem-icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 52px;
		height: 52px;
		border-radius: 50%;
		background: var(--color-background);
		color: var(--color-primary);
	}

	.hint {
		margin: 0;
		padding: 10px 14px;
		border-radius: 14px;
		background: var(--color-info-tint);
		font-size: 13px;
		color: var(--color-text-primary);
	}

	.engine {
		margin: 0;
		font-size: 12px;
		color: var(--color-text-muted);
	}

	.manual {
		display: flex;
		flex-direction: column;
		gap: 6px;
		margin-top: 4px;
	}

	.manual label {
		font-size: 14px;
		font-weight: 700;
	}

	.manual-row {
		display: flex;
		gap: 10px;
	}

	.manual input {
		box-sizing: border-box;
		flex: 1;
		min-width: 0;
		min-height: 50px;
		padding: 0 16px;
		border: 1.5px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-card);
		font-size: 16px;
	}

	.manual input[aria-invalid='true'] {
		border-color: var(--color-danger);
	}

	.manual input:focus-visible {
		outline: 2px solid var(--color-primary);
		outline-offset: 1px;
		border-color: var(--color-primary);
	}

	.error {
		margin: 0;
		font-size: 13px;
		color: var(--color-danger);
	}

	.alt {
		margin: 4px 0 0;
		font-size: 13.5px;
		color: var(--color-text-secondary);
	}

	.alt a {
		font-weight: 700;
		color: var(--color-text-link);
	}

	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		margin: -1px;
		padding: 0;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}
</style>
