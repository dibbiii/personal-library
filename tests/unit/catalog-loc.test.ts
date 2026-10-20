import { describe, expect, it, vi } from 'vitest';
import { LocProvider, parseLoc, parseLocSru } from '../../src/lib/server/catalog/loc';
import { editionCandidateSchema } from '../../src/lib/contracts/books';
import { DataAccessError } from '../../src/lib/data/errors';
import { institutionalCatalogFor } from '../../src/lib/catalog/isbn';

// Campo 008 MARC: le posizioni 35-37 contengono il codice lingua ISO 639-2 ('eng').
const field008 = (place: string) => `080904s2009    ${place}`.padEnd(35, ' ') + 'eng  ';

const cleanCodeRecord = `<record xmlns="http://www.loc.gov/MARC21/slim">
	<leader>00000nam a2200000 a 4500</leader>
	<controlfield tag="001">   15315370 </controlfield>
	<controlfield tag="008">${field008('cau')}</controlfield>
	<datafield tag="100" ind1="1" ind2=" ">
		<subfield code="a">Martin, Robert C.</subfield>
	</datafield>
	<datafield tag="700" ind1="1" ind2=" ">
		<subfield code="a">Martin, Robert C.</subfield>
	</datafield>
	<datafield tag="245" ind1="1" ind2="0">
		<subfield code="a">Clean code :</subfield>
		<subfield code="b">a handbook of agile software craftsmanship /</subfield>
	</datafield>
	<datafield tag="260" ind1=" " ind2=" ">
		<subfield code="a">Upper Saddle River, NJ :</subfield>
		<subfield code="b">Prentice Hall,</subfield>
		<subfield code="c">c2009.</subfield>
	</datafield>
	<datafield tag="300" ind1=" " ind2=" ">
		<subfield code="a">xxix, 431 p. :</subfield>
		<subfield code="b">illustrazioni ;</subfield>
		<subfield code="c">24 cm</subfield>
	</datafield>
	<datafield tag="020" ind1=" " ind2=" ">
		<subfield code="a">9780132350884 (pbk.)</subfield>
	</datafield>
	<datafield tag="020" ind1=" " ind2=" ">
		<subfield code="a">0132350882</subfield>
	</datafield>
</record>`;

const codersRecord = `<record xmlns="http://www.loc.gov/MARC21/slim">
	<leader>00000nam a2200000 a 4500</leader>
	<controlfield tag="001">2009288262</controlfield>
	<controlfield tag="008">${field008('nju')}</controlfield>
	<datafield tag="100" ind1="1" ind2=" ">
		<subfield code="a">Seibel, Peter.</subfield>
	</datafield>
	<datafield tag="245" ind1="1" ind2="0">
		<subfield code="a">Coders at work &amp; other crafts &#39;field notes&#39; /</subfield>
	</datafield>
</record>`;

const sruResponse = (numberOfRecords: number, records: string) =>
	`<?xml version="1.0" encoding="UTF-8"?>
<zs:searchRetrieveResponse xmlns:zs="http://www.loc.gov/zing/srw/">
	<zs:version>1.1</zs:version>
	<zs:numberOfRecords>${numberOfRecords}</zs:numberOfRecords>
	<zs:records>
${records}
	</zs:records>
</zs:searchRetrieveResponse>`;

describe('Catalogo LOC (SRU/MARCXML)', () => {
	it("lookupIsbn: risolve il record con l'ISBN richiesto e valida lo schema", async () => {
		let captured = '';
		const provider = new LocProvider(async (url) => {
			captured = url;
			return new Response(sruResponse(2, `${cleanCodeRecord}\n${codersRecord}`), { status: 200 });
		});
		const candidates = await provider.lookupIsbn('9780132350884');
		expect(new URL(captured).searchParams.get('query')).toBe('bath.isbn=9780132350884');
		expect(captured).toContain('bath.isbn');
		expect(captured).toContain('maximumRecords=10');
		expect(captured).toContain('recordSchema=marcxml');
		expect(candidates).toHaveLength(2);
		const [cleanCode, coders] = candidates;
		expect(editionCandidateSchema.safeParse(cleanCode).success).toBe(true);
		expect(editionCandidateSchema.safeParse(coders).success).toBe(true);
		expect(cleanCode).toMatchObject({
			provider: 'loc',
			providerIds: {
				locId: '15315370',
				openLibraryWorkId: null,
				openLibraryEditionId: null,
				googleBooksId: null
			},
			isbn13: '9780132350884',
			isbn10: '0132350882',
			workTitle: 'Clean code : a handbook of agile software craftsmanship',
			editionTitle: 'Clean code : a handbook of agile software craftsmanship',
			authors: ['Martin, Robert C'],
			language: 'en',
			publisher: 'Prentice Hall',
			// \b non combacia in "c2009." ('c' e '2' sono entrambe parole): null, come nel bridge SBN.
			publishedDate: null,
			pageCount: 431,
			coverUrl: null
		});
		expect(coders).toMatchObject({
			isbn13: null,
			isbn10: null,
			providerIds: { locId: '2009288262' }
		});
	});

	it('search: query CQL ripulita, parametri SRU comuni e pulizia di titoli e autori', async () => {
		const urls: string[] = [];
		const provider = new LocProvider(async (url) => {
			urls.push(url);
			return new Response(sruResponse(1, cleanCodeRecord), { status: 200 });
		});
		const candidates = await provider.search({
			title: '  Clean   Code! ',
			author: 'Robert  C. Martin'
		});
		const query = new URL(urls[0] ?? '').searchParams.get('query') ?? '';
		expect(query).toBe('dc.title="Clean Code" and dc.author="Robert C. Martin"');
		expect(urls[0]).toContain('version=1.1');
		expect(urls[0]).toContain('operation=searchRetrieve');
		expect(urls[0]).toContain('maximumRecords=10');
		expect(urls[0]).toContain('recordSchema=marcxml');
		expect(candidates[0]).toMatchObject({
			editionTitle: 'Clean code : a handbook of agile software craftsmanship',
			authors: ['Martin, Robert C']
		});
		// Titolo troppo corto dopo la pulizia: nessuna richiesta di rete.
		expect(await provider.search({ title: 'a' })).toEqual([]);
		expect(urls).toHaveLength(1);
	});

	it('numberOfRecords 0 o nessun record: nessun candidato', () => {
		expect(parseLoc(sruResponse(0, ''))).toEqual([]);
	});

	it('diagnostics o busta SRU mancante: CONTRACT', () => {
		const diagnostics = `<?xml version="1.0" encoding="UTF-8"?>
<zs:searchRetrieveResponse xmlns:zs="http://www.loc.gov/zing/srw/">
	<zs:version>1.1</zs:version>
	<zs:numberOfRecords>0</zs:numberOfRecords>
	<zs:diagnostics>
		<diagnostic xmlns="http://www.loc.gov/zing/srw/diagnostic/">
			<uri>info:srw/diagnostic/1/16</uri>
			<message>Unsupported index</message>
		</diagnostic>
	</zs:diagnostics>
</zs:searchRetrieveResponse>`;
		expect(() => parseLoc(diagnostics)).toThrow(DataAccessError);
		expect(() => parseLoc(diagnostics)).toThrow('Risposta LOC non valida');
		expect(() => parseLoc('<html><body>Service unavailable</body></html>')).toThrow(
			DataAccessError
		);
		expect(() => parseLoc('')).toThrow(DataAccessError);
	});

	it('429 -> RATE_LIMITED, 500 -> NETWORK', async () => {
		const busy = new LocProvider(async () => new Response('busy', { status: 429 }));
		await expect(busy.lookupIsbn('9780132350884')).rejects.toMatchObject({
			code: 'RATE_LIMITED'
		});
		const down = new LocProvider(async () => new Response('down', { status: 500 }));
		await expect(down.lookupIsbn('9780132350884')).rejects.toMatchObject({ code: 'NETWORK' });
	});

	it('entità XML decodificate nel titolo', () => {
		const [candidate] = parseLoc(sruResponse(1, codersRecord));
		expect(candidate?.editionTitle).toBe("Coders at work & other crafts 'field notes'");
	});
});

/** Risposta SRU reale (lx2.loc.gov, bath.isbn=9780441013593) ridotta ai campi rilevanti. */
const SRU_DUNE = `<?xml version="1.0"?>
<zs:searchRetrieveResponse xmlns:zs="http://www.loc.gov/zing/srw/"><zs:version>1.1</zs:version><zs:numberOfRecords>1</zs:numberOfRecords><zs:records><zs:record>
<zs:recordSchema>marcxml</zs:recordSchema><zs:recordPacking>xml</zs:recordPacking><zs:recordData><record xmlns="http://www.loc.gov/MARC21/slim">
  <leader>01395cam a2200361 a 4500</leader>
  <controlfield tag="001">14353350</controlfield>
  <controlfield tag="005">20250607012733.1</controlfield>
  <controlfield tag="008">060425r20051965nyu           000 1 eng d</controlfield>
  <datafield tag="010" ind1=" " ind2=" ">
    <subfield code="a">  2006274831</subfield>
  </datafield>
  <datafield tag="020" ind1=" " ind2=" ">
    <subfield code="a">0441013597</subfield>
    <subfield code="q">pbk.</subfield>
  </datafield>
  <datafield tag="020" ind1=" " ind2=" ">
    <subfield code="a">9780441013593 (pbk.)</subfield>
  </datafield>
  <datafield tag="100" ind1="1" ind2=" ">
    <subfield code="a">Herbert, Frank.</subfield>
  </datafield>
  <datafield tag="245" ind1="1" ind2="0">
    <subfield code="a">Dune /</subfield>
    <subfield code="c">Frank Herbert.</subfield>
  </datafield>
  <datafield tag="260" ind1=" " ind2=" ">
    <subfield code="a">New York :</subfield>
    <subfield code="b">Ace Books,</subfield>
    <subfield code="c">2005, c1965.</subfield>
  </datafield>
  <datafield tag="300" ind1=" " ind2=" ">
    <subfield code="a">528 p. :</subfield>
    <subfield code="c">23 cm.</subfield>
  </datafield>
</record></zs:recordData><zs:recordPosition>1</zs:recordPosition></zs:record></zs:records></zs:searchRetrieveResponse>`;

const SRU_EMPTY = `<?xml version="1.0"?>
<zs:searchRetrieveResponse xmlns:zs="http://www.loc.gov/zing/srw/"><zs:version>1.1</zs:version><zs:numberOfRecords>0</zs:numberOfRecords><zs:records/></zs:searchRetrieveResponse>`;

describe('parser LOC SRU', () => {
	it('mappa il MARCXML su un candidato valido per il contratto', () => {
		const [candidate] = parseLocSru(SRU_DUNE, '9780441013593');
		expect(editionCandidateSchema.safeParse(candidate).success).toBe(true);
		expect(candidate).toMatchObject({
			provider: 'loc',
			providerIds: { openLibraryWorkId: null, openLibraryEditionId: null, googleBooksId: null, locId: '14353350' },
			workTitle: 'Dune',
			editionTitle: 'Dune',
			authors: ['Herbert, Frank'],
			isbn13: '9780441013593',
			isbn10: '0441013597',
			language: 'en',
			publisher: 'Ace Books',
			publishedDate: '2005',
			pageCount: 528,
			// LOC non fornisce copertine
			coverUrl: null
		});
	});

	it('non attribuisce l’ISBN richiesto a una scheda che non lo dichiara', () => {
		const [candidate] = parseLocSru(SRU_DUNE, '9788804678106');
		expect(candidate?.isbn13).toBe('9780441013593');
	});

	it('decodifica le entità XML e ignora le schede senza id valido', () => {
		const xml = SRU_DUNE.replace(
			'<subfield code="a">Dune /</subfield>',
			'<subfield code="a">Crime &amp; punishment /</subfield>'
		).replace('<controlfield tag="001">14353350</controlfield>', '<controlfield tag="001">no-id</controlfield>');
		expect(parseLocSru(xml, '9780441013593')).toEqual([]);
		const withEntities = SRU_DUNE.replace(
			'<subfield code="a">Dune /</subfield>',
			'<subfield code="a">Crime &amp; punishment /</subfield>'
		);
		expect(parseLocSru(withEntities, '9780441013593')[0]?.editionTitle).toBe('Crime & punishment');
	});

	it('catalogo vuoto e risposta malformata si distinguono', () => {
		expect(parseLocSru(SRU_EMPTY, '9780441013593')).toEqual([]);
		expect(() => parseLocSru('<html>maintenance</html>', '9780441013593')).toThrow();
	});
});

describe('LocProvider', () => {
	it('interroga SRU con searchRetrieve/CQL e recordSchema marcxml', async () => {
		const fetchImpl = vi.fn(async (input: string) => {
			expect(input).toContain('https://lx2.loc.gov/sru/lcdb');
			return new Response(SRU_DUNE);
		});
		const candidates = await new LocProvider(fetchImpl).lookupIsbn('9780441013593');
		expect(candidates).toHaveLength(1);
		const requestUrl = fetchImpl.mock.calls[0]?.[0];
		if (!requestUrl) throw new Error('La richiesta SRU non è stata inviata');
		const url = new URL(requestUrl);
		expect(url.hostname).toBe('lx2.loc.gov');
		expect(url.pathname).toBe('/sru/lcdb');
		expect(url.searchParams.get('operation')).toBe('searchRetrieve');
		expect(url.searchParams.get('query')).toBe('bath.isbn=9780441013593');
		expect(url.searchParams.get('recordSchema')).toBe('marcxml');
	});

	it('mappa 429 su RATE_LIMITED e 404 su catalogo vuoto', async () => {
		await expect(
			new LocProvider(async () => new Response('busy', { status: 429 })).lookupIsbn('9780441013593')
		).rejects.toMatchObject({ code: 'RATE_LIMITED' });
		await expect(
			new LocProvider(async () => new Response('gone', { status: 404 })).lookupIsbn('9780441013593')
		).resolves.toEqual([]);
	});
});

describe('scelta del catalogo istituzionale per gruppo ISBN', () => {
	it('978-0/978-1 -> LOC; 978-88/979-12 -> SBN; altri gruppi -> SBN come prima', () => {
		expect(institutionalCatalogFor('9780441013593')).toBe('loc'); // 978-0
		expect(institutionalCatalogFor('9781594200113')).toBe('loc'); // 978-1
		expect(institutionalCatalogFor('9788804678106')).toBe('sbn'); // 978-88
		expect(institutionalCatalogFor('9791255125006')).toBe('sbn'); // 979-12
		expect(institutionalCatalogFor('9782070116270')).toBe('sbn'); // 978-2, invariato
		expect(institutionalCatalogFor('9798742920014')).toBe('sbn'); // altro 979, invariato
	});
});
