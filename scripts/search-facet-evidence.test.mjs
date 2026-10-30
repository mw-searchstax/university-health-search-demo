import test from 'node:test';
import assert from 'node:assert/strict';
import { collectEvidence, compareEvidence } from './search-facet-evidence.mjs';

const endpoint = 'https://fixture.searchstax.com/app/search';
const token = 'offline-test-token';

function response(query, start, docs, { total = docs.length, facets = [] } = {}) {
  return new Response(JSON.stringify({
    responseHeader:{ status:0, params:{ q:query, start:String(start), rows:'100' } },
    response:{ numFound:total, start, docs },
    metadata:{ results:[{ name:'title', title:'Title' }], facets, sorts:[{ name:'published', order:'desc', label:'Newest' }] },
    facet_counts:{ facet_fields:{ demo_content_type_s:['service',3] } },
  }), { status:200, headers:{ 'content-type':'application/json' } });
}

function record(id) {
  return { id, title:[`Title ${id}`], url:`https://example.test/${id}`, description:['Description'], demo_content_type_s:'service', document_type:'html' };
}

test('collector stores sanitized facet counts and sort metadata without changing record state', async () => {
  const evidence = await collectEvidence({ endpoint, token, queries:['sample'], fetcher:async () => response('sample', 0, [record('one')], {
    facets:[{ name:'demo_content_type_s', label:'Content type' }, { name:'unrelated', label:'Unrelated' }],
  }) });
  assert.equal(evidence.stage, 'before');
  assert.deepEqual(evidence.results[0].metadata.facets, [
    { name:'demo_content_type_s', label:'Content type' }, { name:'unrelated', label:'Unrelated' },
  ]);
  assert.deepEqual(evidence.results[0].metadata.facetCounts, { demo_content_type_s:['service',3] });
  assert.deepEqual(evidence.results[0].metadata.sorts, [{ name:'published', order:'desc', label:'Newest' }]);
});

test('collector rejects incomplete pages and duplicate identities across pages', async () => {
  await assert.rejects(collectEvidence({ endpoint, token, queries:['sample'], fetcher:async () => response('sample', 0, [], { total:1 }) }), /page was incomplete/);
  const firstPage = Array.from({ length:100 }, (_, index) => record(`id-${index}`));
  await assert.rejects(collectEvidence({ endpoint, token, queries:['sample'], fetcher:async request => {
    const start = Number(new URL(request).searchParams.get('start'));
    return start === 0 ? response('sample', 0, firstPage, { total:101 }) : response('sample', 100, [record('id-0')], { total:101 });
  } }), /repeated a result identity/);
});

test('comparison detects record-order changes and marks uncaptured baseline facet data unknown', () => {
  const baseEntry = { query:'sample', numFound:2, records:[record('one'),record('two')], metadata:{ results:[{ name:'title' }], facets:[] } };
  const addedFacet = { ...baseEntry, metadata:{ results:[{ name:'title' }], facets:[{ name:'demo_content_type_s', label:'Content type' }], facetCounts:{ demo_content_type_s:['service',2] }, sorts:[] } };
  const same = compareEvidence({ results:[baseEntry] }, { results:[addedFacet] });
  assert.equal(same[0].orderedRecordsEqual, true);
  assert.equal(same[0].facetMetadataAdded, true);
  assert.equal(same[0].recordsUnchangedWithFacetDeclarationPresent, true);
  assert.equal(same[0].metadata.resultDefinitionsEqual, true);
  assert.equal(same[0].metadata.beforeFacetCountsCaptured, false);
  assert.equal(same[0].metadata.facetCountsComparable, false);
  assert.equal(same[0].metadata.sortsComparable, false);
  const reordered = { ...addedFacet, records:[record('two'),record('one')] };
  const changed = compareEvidence({ results:[baseEntry] }, { results:[reordered] });
  assert.equal(changed[0].orderedRecordsEqual, false);
  assert.equal(changed[0].recordsUnchangedWithFacetDeclarationPresent, false);
});
