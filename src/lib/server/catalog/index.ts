import { GoogleBooksProvider } from './google-books';
import { OpenLibraryProvider } from './open-library';
import { CatalogService } from './service';
import { BookInfoService } from './book-info';
import { DiscoverService } from './discover';
import { serverEnv } from '../db/env';
import { InventaireProvider } from './inventaire';
import { SbnProvider } from './sbn';
import { LocProvider } from './loc';
import { IsbnDbProvider } from './isbndb';

export { CatalogService } from './service';
export { OpenLibraryProvider } from './open-library';
export { GoogleBooksProvider } from './google-books';
export { RateLimiter } from './rate-limit';
export { BookInfoService } from './book-info';
export { DiscoverService } from './discover';
export { LocProvider } from './loc';
export { IsbnDbProvider } from './isbndb';

const globalKey = Symbol.for('segnalibro.catalogService.v4');
const globals = globalThis as unknown as Record<symbol, CatalogService | undefined>;

/**
 * Servizio di catalogo condiviso dal processo (la cache vive qui, anche oltre l'HMR in sviluppo).
 * `GOOGLE_BOOKS_API_KEY` si legge solo sul server e non viene mai inviata al browser.
 */
export function getCatalogService(): CatalogService {
	return (globals[globalKey] ??= new CatalogService({
		providers: [
			new OpenLibraryProvider(),
			new GoogleBooksProvider({ apiKey: serverEnv('GOOGLE_BOOKS_API_KEY') })
		],
		fallbackProviders: [
			new InventaireProvider(),
			new LocProvider(),
			...(serverEnv('SBN_BRIDGE_URL') ? [new SbnProvider(serverEnv('SBN_BRIDGE_URL')!)] : []),
			...(serverEnv('ISBNDB_API_KEY') ? [new IsbnDbProvider(serverEnv('ISBNDB_API_KEY')!)] : [])
		]
	}));
}

const infoKey = Symbol.for('segnalibro.bookInfoService');
const infoGlobals = globalThis as unknown as Record<symbol, BookInfoService | undefined>;

/** Informazioni pubbliche sui libri (Open Library; Google Books solo con chiave API). */
export function getBookInfoService(): BookInfoService {
	return (infoGlobals[infoKey] ??= new BookInfoService({
		googleApiKey: serverEnv('GOOGLE_BOOKS_API_KEY')
	}));
}

const discoverKey = Symbol.for('segnalibro.discoverService');
const discoverGlobals = globalThis as unknown as Record<symbol, DiscoverService | undefined>;

/** Libri da scoprire per Esplora (Open Library). */
export function getDiscoverService(): DiscoverService {
	return (discoverGlobals[discoverKey] ??= new DiscoverService());
}
