import { ICONS } from '$lib/components/ui/icons';
import { ellipsize, fitText, wrapText } from './layout';
import type { CardPalette } from './palette';

export const CARD_WIDTH = 1080;
export const CARD_HEIGHT = 1350;

export type CardCanvas = HTMLCanvasElement | OffscreenCanvas;
type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export interface QuoteCardContent {
	body: string;
	title: string;
	author: string;
	page: number | null;
}

export interface CardFonts {
	display: string;
	ui: string;
}

const MARGIN = 120;
const TEXT_WIDTH = CARD_WIDTH - MARGIN * 2;

/** Attende `document.fonts.ready` e il caricamento dei corpi usati dalla card. */
export async function ensureCardFonts(fonts: CardFonts): Promise<void> {
	if (typeof document === 'undefined' || !document.fonts) return;
	await document.fonts.ready;
	await Promise.allSettled([
		document.fonts.load(`400 64px ${fonts.display}`),
		document.fonts.load(`400 34px ${fonts.ui}`),
		document.fonts.load(`700 40px ${fonts.ui}`)
	]);
}

/** OffscreenCanvas dove esiste, altrimenti un <canvas> fuori dal DOM. */
export function createCardCanvas(width = CARD_WIDTH, height = CARD_HEIGHT): CardCanvas {
	if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
	const canvas = document.createElement('canvas');
	canvas.width = width;
	canvas.height = height;
	return canvas;
}

function context(canvas: CardCanvas): Ctx {
	const ctx = canvas.getContext('2d');
	if (!ctx) throw new Error('Canvas 2D non disponibile');
	return ctx as Ctx;
}

function roundedRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
	ctx.beginPath();
	ctx.moveTo(x + r, y);
	ctx.arcTo(x + w, y, x + w, y + h, r);
	ctx.arcTo(x + w, y + h, x, y + h, r);
	ctx.arcTo(x, y + h, x, y, r);
	ctx.arcTo(x, y, x + w, y, r);
	ctx.closePath();
}

/** Disegna la card 1080x1350: citazione, titolo, autore e marchio Segnalibro. */
export function renderQuoteCard(
	target: CardCanvas,
	content: QuoteCardContent,
	palette: CardPalette,
	fonts: CardFonts
): void {
	target.width = CARD_WIDTH;
	target.height = CARD_HEIGHT;
	const ctx = context(target);

	ctx.clearRect(0, 0, CARD_WIDTH, CARD_HEIGHT);
	ctx.fillStyle = palette.background;
	ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);

	// Cornice sottile
	ctx.save();
	ctx.globalAlpha = 0.35;
	ctx.strokeStyle = palette.accent;
	ctx.lineWidth = 4;
	roundedRect(ctx, 48, 48, CARD_WIDTH - 96, CARD_HEIGHT - 96, 44);
	ctx.stroke();
	ctx.restore();

	// Virgolette grandi: aperta a sinistra, chiusa specchiata a destra
	ctx.save();
	ctx.globalAlpha = 0.5;
	ctx.fillStyle = palette.accent;
	ctx.font = `400 260px ${fonts.display}`;
	ctx.textBaseline = 'alphabetic';
	ctx.textAlign = 'left';
	ctx.fillText('«', MARGIN - 10, 330);
	ctx.textAlign = 'right';
	ctx.fillText('»', CARD_WIDTH - MARGIN + 10, 330);
	ctx.restore();

	// Citazione: corpo adattato al riquadro
	const quoteTop = 360;
	const quoteBottom = 1000;
	const fit = fitText({
		text: content.body,
		maxWidth: TEXT_WIDTH,
		maxHeight: quoteBottom - quoteTop,
		maxFontSize: 72,
		minFontSize: 34,
		lineHeight: 1.3,
		step: 2,
		measureAt: (size) => {
			ctx.font = `400 ${size}px ${fonts.display}`;
			return (text) => ctx.measureText(text).width;
		}
	});

	ctx.fillStyle = palette.ink;
	ctx.font = `400 ${fit.fontSize}px ${fonts.display}`;
	ctx.textAlign = 'left';
	ctx.textBaseline = 'top';
	// Centratura verticale morbida nel riquadro quando il testo è corto
	const offset = Math.max(0, (quoteBottom - quoteTop - fit.height) / 2) * 0.5;
	fit.lines.forEach((line, index) => {
		ctx.fillText(line, MARGIN, quoteTop + offset + index * fit.lineHeight);
	});

	// Filetto
	ctx.fillStyle = palette.accent;
	roundedRect(ctx, MARGIN, 1040, 96, 6, 3);
	ctx.fill();

	// Titolo e autore
	ctx.fillStyle = palette.ink;
	ctx.textBaseline = 'alphabetic';
	ctx.font = `700 42px ${fonts.ui}`;
	const measureUi = (text: string) => ctx.measureText(text).width;
	const wrappedTitle = wrapText(content.title, TEXT_WIDTH, measureUi);
	const titleLines = wrappedTitle.slice(0, 2);
	if (wrappedTitle.length > 2) {
		titleLines[1] = ellipsize(wrappedTitle.slice(1).join(' '), TEXT_WIDTH, measureUi);
	}
	let y = 1112;
	for (const line of titleLines) {
		ctx.fillText(line, MARGIN, y);
		y += 52;
	}

	ctx.font = `400 34px ${fonts.ui}`;
	const meta = content.page ? `${content.author} · p. ${content.page}` : content.author;
	ctx.fillText(ellipsize(meta, TEXT_WIDTH, measureUi), MARGIN, y + 6);

	// Marchio: segnalibro + nome
	ctx.save();
	ctx.translate(MARGIN, 1236);
	ctx.scale(2.4, 2.4);
	ctx.strokeStyle = palette.ink;
	ctx.lineWidth = 2;
	ctx.lineJoin = 'round';
	ctx.lineCap = 'round';
	ctx.globalAlpha = 0.9;
	ctx.stroke(new Path2D(bookmarkPath()));
	ctx.restore();

	ctx.fillStyle = palette.ink;
	ctx.globalAlpha = 0.9;
	ctx.font = `400 40px ${fonts.display}`;
	ctx.textBaseline = 'alphabetic';
	ctx.fillText('Segnalibro', MARGIN + 66, 1276);
	ctx.globalAlpha = 1;
}

/** Path del segnalibro dalla stessa icona usata nell'interfaccia. */
function bookmarkPath(): string {
	const match = /d="([^"]+)"/.exec(ICONS.bookmark);
	return match?.[1] ?? '';
}
