import test from 'node:test';
import assert from 'node:assert/strict';
import { resultPresentation, typesFromResponse } from '../src/scripts/search-presentation.mjs';

test('result labels and breadcrumbs use returned metadata without changing source result', () => {
  const item = { title: 'International Health', url: 'https://example.test/demo/care/services/international-health/', description: 'Original description.', allFields: [{key:'demo_content_type_s',value:['service']}] };
  const before = structuredClone(item);
  assert.deepEqual(resultPresentation(item, '/demo/'), { typeLabel:'Services', breadcrumb:'Home / Care / Services' });
  assert.deepEqual(item, before);
  assert.deepEqual(resultPresentation({url:'https://example.test/demo/pdfs/guide.pdf', allFields:[{key:'document_type',value:'pdf'}]}, '/demo/'), {typeLabel:'PDF', breadcrumb:'Home / Documents'});
  assert.deepEqual(resultPresentation({url:'invalid', allFields:[{key:'demo_content_type_s',value:'constructor'}]}, '/demo/'), {typeLabel:'',breadcrumb:''});
});

test('response identity reads SDK single and OR filter clauses, ignores unrelated and unknown fields', () => {
  const parse = fq => typesFromResponse({responseHeader:{params:{fq}}});
  assert.deepEqual(parse('demo_content_type_s:"service"'), ['service']);
  assert.deepEqual(parse('demo_content_type_s:"service" OR demo_content_type_s:"community"'), ['community','service']);
  assert.deepEqual(parse(['{!tag=content}demo_content_type_s:("service" OR "community")','other_s:"news"']), ['community','service']);
  assert.deepEqual(parse('demo_content_type_s:"unknown"'), []);
  assert.deepEqual(typesFromResponse({}), []);
});
