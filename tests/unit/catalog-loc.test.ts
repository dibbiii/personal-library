import { describe, expect, it } from 'vitest';
import { LocProvider, parseLoc } from '../../src/lib/server/catalog/loc';
import { editionCandidateSchema } from '../../src/lib/contracts/books';
import { DataAccessError } from '../../src/lib/data/errors';

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
		expect(captured).toContain('recordSchema=Marcxml');
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
		expect(urls[0]).toContain('recordSchema=Marcxml');
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
