import { describe, expect, it, vi } from 'vitest';
import { LocProvider, parseLocSru } from '../../src/lib/server/catalog/loc';
import { editionCandidateSchema } from '../../src/lib/contracts/books';
import { institutionalCatalogFor } from '../../src/lib/catalog/isbn';

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
		const fetchImpl = vi.fn(async () => new Response(SRU_DUNE));
		const candidates = await new LocProvider(fetchImpl).lookupIsbn('9780441013593');
		expect(candidates).toHaveLength(1);
		const url = new URL(fetchImpl.mock.calls[0]?.[0] as string);
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
