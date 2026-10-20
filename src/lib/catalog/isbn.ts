/**
 * Normalizzazione e validazione ISBN / EAN-13 (logica pura, usabile anche nel browser).
 * Gli ISBN sono sempre senza trattini e con la X finale maiuscola.
 */

/** Toglie spazi, trattini e prefisso "ISBN"; la X finale dell'ISBN-10 resta maiuscola. */
export function normalizeIsbn(input: string): string {
	return input
		.trim()
		.replace(/^isbn(?:-?1[03])?\s*:?\s*/i, '')
		.replace(/[\s‐-―-]/g, '')
		.toUpperCase();
}

export function isValidIsbn10(value: string): boolean {
	if (!/^[0-9]{9}[0-9X]$/.test(value)) return false;
	let sum = 0;
	for (let i = 0; i < 10; i++) {
		const char = value[i] as string;
		const digit = char === 'X' ? 10 : Number(char);
		sum += digit * (10 - i);
	}
	return sum % 11 === 0;
}

function ean13CheckDigit(first12: string): number {
	let sum = 0;
	for (let i = 0; i < 12; i++) sum += Number(first12[i]) * (i % 2 === 0 ? 1 : 3);
	return (10 - (sum % 10)) % 10;
}

/** Checksum EAN-13 valido (qualunque prefisso). */
export function isValidEan13(value: string): boolean {
	if (!/^[0-9]{13}$/.test(value)) return false;
	return ean13CheckDigit(value.slice(0, 12)) === Number(value[12]);
}

/** EAN-13 "Bookland": prefisso 978 o 979. */
export function hasBooklandPrefix(value: string): boolean {
	return /^97[89]/.test(value);
}

/** ISBN-13 valido = EAN-13 valido con prefisso 978/979. */
export function isValidIsbn13(value: string): boolean {
	return hasBooklandPrefix(value) && isValidEan13(value);
}

export function isbn10To13(isbn10: string): string | null {
	if (!isValidIsbn10(isbn10)) return null;
	const body = `978${isbn10.slice(0, 9)}`;
	return `${body}${ean13CheckDigit(body)}`;
}

/** Solo i 978 hanno un equivalente a 10 cifre. */
export function isbn13To10(isbn13: string): string | null {
	if (!isValidIsbn13(isbn13) || !isbn13.startsWith('978')) return null;
	const body = isbn13.slice(3, 12);
	let sum = 0;
	for (let i = 0; i < 9; i++) sum += Number(body[i]) * (10 - i);
	const check = (11 - (sum % 11)) % 11;
	return `${body}${check === 10 ? 'X' : check}`;
}

export interface ParsedIsbn {
	isbn13: string;
	/** null per i 979, che non hanno un ISBN-10 */
	isbn10: string | null;
}

/** ISBN-10 o ISBN-13 (con o senza trattini) -> forma canonica, `null` se il checksum non torna. */
export function parseIsbn(input: string): ParsedIsbn | null {
	const value = normalizeIsbn(input);
	if (value.length === 10) {
		const isbn13 = isbn10To13(value);
		return isbn13 ? { isbn13, isbn10: value } : null;
	}
	if (value.length === 13 && isValidIsbn13(value)) {
		return { isbn13: value, isbn10: isbn13To10(value) };
	}
	return null;
}

/** Il valore letto da un codice a barre è un ISBN? (EAN-13 978/979 con checksum corretto). */
export function parseScannedCode(raw: string): ParsedIsbn | null {
	const value = raw.trim().replace(/\s/g, '');
	if (!/^[0-9]{13}$/.test(value)) return null;
	return parseIsbn(value);
}

/**
 * Estrae il primo ISBN valido da una lista di identificatori (con o senza trattini).
 * Restituisce la coppia canonica.
 */
export function firstValidIsbn(values: readonly string[] | null | undefined): ParsedIsbn | null {
	for (const value of values ?? []) {
		const parsed = parseIsbn(value);
		if (parsed) return parsed;
	}
	return null;
}

export type InstitutionalCatalogId = 'sbn' | 'loc';

/**
 * Catalogo istituzionale del fallback ISBN, scelto dal gruppo di registrazione dell'ISBN-13
 * (non dalla lingua dell'utente): editoria italiana (978-88, 979-12) -> SBN;
 * editoria angloamericana (978-0, 978-1) -> Library of Congress; ogni altro gruppo -> SBN,
 * come avveniva prima dell'aggiunta di LOC.
 */
export function institutionalCatalogFor(isbn13: string): InstitutionalCatalogId {
	if (/^(97888|97912)/.test(isbn13)) return 'sbn';
	if (/^978[01]/.test(isbn13)) return 'loc';
	return 'sbn';
}
