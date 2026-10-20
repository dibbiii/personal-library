# Aggiunta libri, catalogo esterno e cover

Tre modi per aggiungere un libro (MASTER_SPEC sez. 18-20): scanner ISBN, ricerca titolo/autore,
inserimento manuale. In ogni flusso l'utente conferma sempre genere, formato, serie e numero volume
nello sheet `AddBookConfirmSheet`; poi si apre `/book/<id>`.

## Route e componenti

| Route         | Contenuto                                                                              |
| ------------- | -------------------------------------------------------------------------------------- |
| `/add`        | scelta dei tre modi                                                                    |
| `/add/scan`   | `ISBNScanner` + lookup per ISBN (`?` nessun parametro)                                 |
| `/add/search` | `BookSearch` (input con debounce 400 ms), accetta `?q=`; un ISBN digitato fa un lookup |
| `/add/manual` | `ManualBookForm` (funziona senza API esterne), accetta `?title=` e `?isbn=`            |

Componenti in `src/lib/components/catalog/`: `BookSearch`, `BookSearchResult`, `ISBNScanner`,
`AddBookConfirmSheet`, `ManualBookForm`, `CoverPicker`, `CoverImage` (cover con placeholder locale).

### ISBNScanner

`BarcodeDetector` se supporta `ean_13`, altrimenti `@zxing/library` con `import()` dinamico (chunk
separato, mai nel bundle iniziale). Solo contesto sicuro (HTTPS o localhost); altrimenti, o con
permesso negato, nessuna fotocamera, errore: messaggio chiaro e alternative (ISBN digitato, ricerca,
manuale). Torcia se la traccia la espone. Lo stream viene fermato: allo smontaggio, con la scheda
nascosta (`visibilitychange`), su `pagehide`, dopo una lettura. Un codice EAN che non è un ISBN
(prefisso diverso da 978/979 o checksum errato) non viene accettato. Istruzioni testuali e live region.

### CoverPicker

```svelte
<CoverPicker
  bookId={string}
  cover={{ coverUrl: string | null; coverStoragePath: string | null }}
  onchanged={() => void}
  bind:open        <!-- opzionale: apertura controllata dal chiamante -->
  showTrigger={true} <!-- opzionale: false se l'apertura è del chiamante -->
/>
```

Bottom sheet "Cambia copertina": cover attuale, upload da galleria o fotocamera (le foto oltre 5 MB
sono ridimensionate nel browser), cover alternative dei provider, "Rimuovi cover personalizzata".
Dopo ogni modifica chiama `onchanged` e `invalidateAll()`.

Helper per mostrare una cover rispettando la precedenza **custom > provider > placeholder**:
`coverSrc(cover)` in `$lib/catalog/covers` (restituisce `/api/covers/<coverStoragePath>`, l'URL del
provider o `null` = placeholder).

## Endpoint (tutti richiedono la sessione; errori `{ code, message, field? }`)

| Metodo e path                                          | Descrizione                                                                                      |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| `GET /api/catalog/search?title=&author=&language=`     | fino a 80 candidati (`catalogSearchResponseSchema`: contratto + `degraded` + `providers`)        |
| `GET /api/catalog/isbn?isbn=`                          | candidati per ISBN + `exactMatch` (true = preselezionabile)                                      |
| `POST /api/library/add` (JSON)                         | `{ status: 'added', bookId }` (201) oppure `{ status: 'duplicate', exact, existing }` (200)      |
| `POST /api/covers/upload` (multipart `bookId`, `file`) | cover personalizzata: png/jpeg/webp, max 5 MB, tipo dai magic bytes                              |
| `POST /api/covers/select` (JSON)                       | `{action:'provider', bookId, coverUrl}` o `{action:'remove-custom', bookId}`                     |
| `GET /api/covers/alternatives?bookId=`                 | cover dei provider per ISBN e titolo/autore di quel libro                                        |
| `GET /api/covers/<coverStoragePath>`                   | serve la cover dell'utente (`Cache-Control: private`, `nosniff`); path altrui o malformati = 404 |

Rate limit in memoria per utente (ricerca 40/min, aggiunta 20/min, cover 15/min) -> 429 con `Retry-After`.
Mappa errori: AUTH_REQUIRED 401, NOT_FOUND 404, CONFLICT 409, VALIDATION 422 (413/415 per i file),
RATE_LIMITED 429, NETWORK/CONTRACT 502, SERVER 500.

## Provider e cache (`src/lib/server/catalog`, logica pura in `src/lib/catalog`)

Interfaccia `BookProvider { id; search(); lookupIsbn() }`. Implementazioni reali: `OpenLibraryProvider`
(`search.json` con `editions.*`, `/isbn/<isbn>.json`, cover `covers.openlibrary.org`) e
`GoogleBooksProvider` (`volumes?q=isbn:` / `intitle+inauthor`, chiave opzionale
`GOOGLE_BOOKS_API_KEY`, solo server). Le richieste bibliografiche passano dal server; le immagini sono caricate dal browser dagli host consentiti. `fetchJson` accetta
solo HTTPS verso host in allow-list, con timeout 7 s (`AbortSignal`), errori mappati in
`DataAccessError` (`NETWORK`, `RATE_LIMITED`, ...). Se un provider è giù l'altro continua
(`degraded: true`); se sono tutti giù la richiesta fallisce con `NETWORK`/`RATE_LIMITED`.
Google Books senza chiave ha una quota anonima condivisa molto bassa: va spesso in 429, che è gestito.

### Recupero delle copertine mancanti per ISBN

`CoverImage` accetta un ISBN opzionale. Nei risultati della ricerca e nelle edizioni del dettaglio, se manca l'URL o l'immagine remota fallisce, tenta una sola alternativa Open Library basata sull'ISBN-13 validato della stessa edizione, con `default=false`. Le copertine personalizzate mantengono la precedenza e non vengono sostituite. La ricerca non aspetta questa immagine; nei risultati il caricamento resta lazy. Una cover recuperata nel dettaglio viene inserita nella bozza di conferma e salvata, senza sostituire titolo/autore o perdere personalizzazioni in corso.

`src/lib/catalog/cover-fallback.ts` conserva fino a 250 URL nella sessione browser, con cache positiva di 12 ore, negativa di un minuto e prenotazione degli URL in corso per 30 secondi. Le immagini usano il normale caricamento e la cache HTTP del browser: il modulo condivide URL e budget, non promette una singola richiesta di rete fra tutti i componenti. Il budget ammette fino a 80 nuovi URL per cinque minuti nella sessione. Non è un limite globale per IP: più schede o dispositivi possono ancora raggiungere il limite del fornitore. Non viene richiesto l'intero catalogo per ogni risultato e non vengono cercate copertine di altri ISBN.

Il messaggio di ricerca parziale nomina ora i fornitori con stato `error` o `rate_limited`, distinguendo indisponibilità e limite di richieste. Nell'ambiente locale verificato l'8 ottobre 2026 manca `GOOGLE_BOOKS_API_KEY`; una chiamata anonima di prova ha restituito 429. La configurazione del sito pubblico non è stata verificata né modificata. Configurare una chiave del proprio progetto Google sul server resta necessario per usare una quota identificata; non garantisce copertine presenti o quota illimitata.

La verifica diretta di due ISBN delle schermate, `9781962251488` e `9798742920014`, ha restituito 404 dalla Covers API con `default=false`: per quelle edizioni il fallback mantiene correttamente il segnaposto. Il comportamento è verificato anche quando la copertina esiste con risposte simulate e salvataggio effettivo nel database di un account di prova.

Fonti: [Open Library Covers API](https://openlibrary.org/dev/docs/api/covers), che documenta URL per ISBN, risposta 404 con `default=false` e limite per IP, e [Google Books: utilizzo dell'API](https://developers.google.com/books/docs/v1/using), per configurazione e identificazione delle richieste. I test browser simulano immagini presenti e mancanti, senza chiamare i cataloghi reali.

Verifica finale della correzione, 8 ottobre 2026:

- `npx vitest run tests/unit/cover-fallback.test.ts tests/unit/catalog-providers.test.ts tests/unit/catalog-cache.test.ts`: 39 test superati, inclusi validazione ISBN, cache negativa e budget.
- `npx playwright test tests/e2e/add-book.spec.ts --workers=2 --retries=0` sulla build di produzione: 48 superati in 3,3 minuti; 2 esclusi perché il bridge SBN non è configurato. I sei nuovi casi mobile/desktop verificano URL assente, URL guasto, salvataggio con ISBN e metadati corretti, avviso della quota e mancata ripetizione immediata di una cover assente.
- `npm run check`: 0 errori e 0 warning. Build, ESLint dei file modificati, controllo colori e formattazione superati.
- La prima verifica ampia in sviluppo è stata interrotta dopo un conflitto di titoli nelle nuove fixture e un errore nell'anteprima dell'upload manuale. Le fixture ora hanno titoli univoci; l'errore dell'anteprima non si è riprodotto nella suite finale di produzione. Non è stata modificata la logica dell'upload per nascondere quel risultato. I log sono in `.tempo/performance/cover-fallback-*.log` e sono ignorati dal versionamento.

La revisione finale controlla che il recupero non sostituisca copertine personali o metadati, che i percorsi delle varianti restino invariati e che l'URL recuperato sia salvato solo dopo il caricamento riuscito. Non sono state aggiunte dipendenze, migration o nuove API. Il sito pubblico non è stato aggiornato da questo intervento.

Ranking (`ranking.ts`): ISBN esatto (precedenza assoluta) > titolo > autore > lingua (preferenza, mai
filtro) > cover > pagine/editore/data. **Titolo + autore non bastano a fondere due edizioni**:
`dedupeCandidates` unisce solo con ISBN-13/10 o id provider in comune. La preselezione automatica
(`exactMatch`) avviene solo con ISBN identico; il lookup ISBN è limitato a 5 candidati.

La ricerca testuale richiede fino a 40 risultati per provider e restituisce fino a 80 candidati
deduplicati e ordinati. Open Library riceve `lang` come preferenza, senza filtro `language:`:
i libri in altre lingue restano ricercabili. `BookSearch` mostra 10 risultati alla volta;
"Mostra altri risultati" rivela quelli già ricevuti senza nuove chiamate. I filtri lingua/fonte
si applicano prima della paginazione; una nuova ricerca o un cambio filtro riparte dai primi 10.
Il gruppo raccolto non rappresenta l'intero catalogo disponibile nelle fonti esterne.

`sort=relevance` (predefinito) ordina per pertinenza e, a parità di punteggio, anno dell'edizione.
`sort=newest` dà precedenza alla lingua preferita, poi all'anno dell'edizione decrescente e
alla pertinenza; le date sconosciute vengono dopo quelle note nella stessa lingua. In questa
modalità i candidati senza corrispondenze con titolo, autore o editore vengono esclusi.
Google Books riceve `orderBy=newest`, recuperando anche volumi assenti dal gruppo per pertinenza.
Open Library mantiene la ricerca delle opere per pertinenza: si ordina la data dell'edizione
ricevuta, senza usare la prima pubblicazione dell'opera. Nel dettaglio si possono caricare altre
edizioni dell'opera, 40 record per pagina, tramite `GET /api/catalog/editions?workId=OL…W&offset=0`.
Filtri lingua e ordine per anno si applicano ai record caricati; non all'intero catalogo remoto.
Il pulsante continua fino all'ultima pagina (limite operativo offset 10.000), senza nascondere
il caricamento dietro un'etichetta "tutte". Gli errori mantengono la lista e permettono di riprovare.
La ricerca nell'interfaccia usa sempre `sort=newest`, senza selettore di ordinamento.
Ogni nuova ricerca riparte dai primi 10 risultati; il lookup ISBN mantiene la priorità dell'edizione esatta.
La cache distingue i due ordini; il parametro omesso equivale a `relevance`.

Cache (`TtlCache`, LRU in memoria di processo, niente Redis): ricerca 12 h, ISBN positivo 30 giorni,
ISBN senza risultati 15 min, risposte degradate 60 s. Richieste concorrenti identiche condividono
una sola chiamata.

### Fallback ISBN e catalogo italiano

Google Books e Open Library sono interrogati in parallelo. Se manca una scheda con ISBN esatto,
autore, editore, pagine e cover, si prova Inventaire, poi un catalogo istituzionale scelto dal gruppo
di registrazione dell'ISBN (non dalla lingua dell'utente): 978-88 e 979-12 restano su SBN se configurato,
978-0 e 978-1 vanno alla Library of Congress, gli altri gruppi restano su SBN come prima. LOC non ha
copertine e non richiede chiavi o variabili d'ambiente. Le fonti successive
arricchiscono solo la stessa edizione, riconosciuta da ISBN o identificatori forti. Un titolo
identico non giustifica una fusione. Si restituiscono solo le corrispondenze ISBN esatte quando
presenti; altrimenti la UI segnala chiaramente che i risultati sono alternative da verificare.
Le alternative senza ISBN esatto hanno una cache breve (15 minuti), non quella positiva di 30 giorni.

Inventaire usa `/api/entities/by-uris`, pseudo-URI `isbn:…` e le entità collegate di opera,
autore ed editore. Vengono accettati solo ISBN dichiarati dalle schede. Le copertine relative
sono risolte su `https://inventaire.io`; URL di altri host non ammessi vengono scartati.

SBN usa il bridge interno `services/sbn`: YAZ Z39.50 verso `opac.sbn.it:2100/nopac`,
MARC21 e UTF-8. Un record per richiesta Present, fino a 10 schede; timeout 18 secondi.
Il bridge non pubblica porte in Compose, non è collegato alla rete proxy e gira come utente `node`.
Una ricerca attiva alla volta e distanza minima di un secondo; sovraccarico -> 429.
La ricerca testuale SBN avviene solo premendo "Cerca nel catalogo italiano SBN" (`source=sbn`).
Il pulsante è disponibile quando `SBN_BRIDGE_URL` è configurata. L'autore facoltativo viene inviato
come campo strutturato alle fonti. La ricerca normale non contatta SBN, Inventaire o LOC.

LOC usa SRU su `https://lx2.loc.gov/sru/lcdb` (`searchRetrieve`, CQL `bath.isbn`, `recordSchema=marcxml`),
senza chiave API. Il MARCXML è letto nell'app con la stessa mappatura dei campi del bridge SBN
(245 titolo, 100/110 autori, 020 ISBN, 264/260 editore e data, 300 pagine, 041/008 lingua);
non si esegue YAZ. Timeout 7 secondi, stessa pausa dopo 429 degli altri provider HTTP, niente retry.

Open Library è limitata a una richiesta al secondo per processo. I provider HTTP condividono
una pausa dopo 429, rispettando `Retry-After` fino a 5 minuti, con coda limitata; niente retry
automatici in ciclo. I redirect sono verificati prima di seguirli e mantengono HTTPS/allow-list.

La copertina può essere caricata o fotografata nel form manuale e nel dettaglio del candidato.
Il file rimane nel browser fino alla conferma; si usa l'endpoint upload esistente dopo aver
ottenuto l'id del libro. Se l'upload fallisce, "Riprova il caricamento" ripete solo l'upload;
"Apri il libro" permette di proseguire. Non si crea una seconda copia.

### Installazione e verifica

1. Eseguire `docker compose build app sbn` per costruire le nuove immagini.
2. Applicare le migrazioni con `node scripts/db-migrate.mjs` su una macchina con accesso al DB
   e `DATABASE_ADMIN_URL` configurata. La migrazione `211_catalog_sources.sql` aggiunge
   `inventaire_id`, `sbn_id`, indici unici e `app.catalog_upsert_edition_v2`.
   La funzione v1 resta disponibile per i container precedenti durante il rollout.
   `212_catalog_isbn_identity.sql` impedisce di fondere ISBN diversi tramite un identificatore
   del provider riutilizzato: l'edizione nuova conserva l'ISBN, scartando l'id in conflitto.
3. Avviare con `docker compose up -d app sbn`. L'app usa `SBN_BRIDGE_URL=http://sbn:8080`.
   In sviluppo si può pubblicare il bridge **solo su loopback** (`127.0.0.1:8081:8080`) e
   	impostare `SBN_BRIDGE_URL=http://127.0.0.1:8081`. Senza bridge, Google/Open Library/Inventaire/LOC funzionano.
4. Per testare: `npm run check`, `npx vitest run tests/unit`, `node --test services/sbn/bridge.test.mjs`,
   `RUN_DB_CONTRACT_TESTS=1 npx vitest run tests/contracts/db.contracts.test.ts -t 'catalog writes'`,
   `npx playwright test tests/e2e/add-book.spec.ts`. In PowerShell assegnare la variabile tramite `$env:RUN_DB_CONTRACT_TESTS='1'`.
   I test browser usano dati simulati delle fonti e utenti temporanei; configurare il server
   con `DATABASE_URL`, `ORIGIN=http://localhost:4173`, `BODY_SIZE_LIMIT=6M` e, per il test SBN, `SBN_BRIDGE_URL`.

Riferimenti ufficiali: [Google Books list](https://developers.google.com/books/docs/v1/reference/volumes/list),
[Open Library Search](https://openlibrary.org/dev/docs/api/search),
[Open Library REST (edizioni paginate)](https://openlibrary.org/dev/docs/restful_api),
[limiti Open Library](https://openlibrary.org/developers/api),
[Inventaire OpenAPI](https://inventaire.io/public/api_specs.json),
[SBN Z39.50](https://opac.sbn.it/accesso-z39.50-a-opac-sbn),
[YAZ client](https://software.indexdata.com/yaz/doc/yaz-client.html),
[LOC SRU](https://www.loc.gov/standards/sru/),
[MARC21](https://www.loc.gov/marc/bibliographic/).
Nessuna fonte garantisce tutte le edizioni o tutte le copertine: il fallback manuale resta necessario.

## Scrittura nel database

`ServerCatalogRepository` (`src/lib/data/catalog-repository.ts`, registrato in `repositories.ts`):
`search`, `lookupIsbn` (interfaccia `CatalogRepository`) più `searchDetailed`, `lookupIsbnDetailed`,
`addBook`, `listCoverAlternatives`, `selectProviderCover`, `setCustomCover`, `removeCustomCover`.
I metodi di scrittura ricevono l'id utente della sessione. L'aggiunta usa
`upsertCatalogEdition` (unica scrittura del catalogo) e un INSERT su `public.user_books` con le
colonne ammesse dalla migration 006; le cover aggiornano `cover_url` / `cover_storage_path`
(UPDATE di colonna già concesso). Duplicati: stesso ISBN o stessa edizione = duplicato esatto (si
apre il libro esistente); stesso titolo e autore (senza distinzione di maiuscole) = avviso con
"Aggiungi comunque".

Un candidato arriva dal browser e viene rivalidato (Zod, checksum ISBN, host cover in allow-list); i
campi servono solo a popolare il catalogo, che l'app legge ma non mostra ad altri utenti.

## Variabili d'ambiente

- `GOOGLE_BOOKS_API_KEY` (opzionale, solo server).
- `STORAGE_DIR` per i file caricati.
- Produzione con `adapter-node`: il corpo delle richieste è limitato a 512 kB di default; per
  l'upload delle cover impostare `BODY_SIZE_LIMIT=6M`.

## Test

- Unit: `tests/unit/catalog-*.test.ts` (ISBN, ranking/merge, cache TTL, provider con fixture in
  `tests/fixtures/catalog/`, service, schemi). `npx vitest run tests/unit/catalog`.
- E2E: `tests/e2e/add-book.spec.ts` (provider simulati con `page.route`; crea e rimuove un utente di
  prova `b6-e2e-*@test.local`; richiede un server e il DB; `E2E_BASE_URL` indica il server).
