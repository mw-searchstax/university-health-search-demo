import test from 'node:test';
import assert from 'node:assert/strict';
import { createFixtureResponse, createSearchDesignFixtureServer } from './search-design-fixture.mjs';

test('scenario populations preserve fixed local demo outcomes and real nursing records', () => {
  const baseline = createFixtureResponse('http://127.0.0.1/search?q=travel%20vaccinations', 'baseline');
  const changed = createFixtureResponse('http://127.0.0.1/search?q=travel%20vaccinations', 'changed');
  assert.equal(baseline.response.numFound, 1);
  assert.equal(baseline.response.docs[0].title, 'Transit Access | Alder Coast University Health');
  assert.equal(changed.response.numFound, 2);
  assert.deepEqual(changed.response.docs.map(doc => doc.title), [
    'Transit Access | Alder Coast University Health', 'International Health | Alder Coast University Health',
  ]);
  assert.deepEqual(baseline.facet_counts.facet_fields.demo_content_type_s, ['community',1]);
  const nursing = createFixtureResponse('http://127.0.0.1/search?q=nursing%20courses&rows=20');
  assert.equal(nursing.response.numFound, 12);
  assert.deepEqual(nursing.response.docs.slice(0, 3).map(doc => doc.id), [
    'education/nursing-foundations','education/nursing-community-practice','education/nursing-simulation',
  ]);
});

test('OR filter applies before pagination while facet counts retain the unfiltered population', () => {
  const response = createFixtureResponse('http://127.0.0.1/search?q=travel%20vaccinations&rows=1&start=1&fq=demo_content_type_s%3A(%22community%22%20OR%20%22service%22)');
  assert.equal(response.response.numFound, 2);
  assert.deepEqual(response.responseHeader.params.fq, ['demo_content_type_s:("community" OR "service")']);
  assert.equal(response.response.start, 1);
  assert.deepEqual(response.response.docs.map(doc => doc.id), ['care/services/international-health']);
  assert.deepEqual(response.facet_counts.facet_fields.demo_content_type_s, ['community',1,'service',1]);
});

test('SDK single-value and repeated OR fq clauses filter by actual category values', () => {
  const single = createFixtureResponse('http://127.0.0.1/search?q=health&rows=200&fq=demo_content_type_s%3A%22service%22');
  assert.ok(single.response.numFound > 0);
  assert.ok(single.response.docs.every(doc => doc.demo_content_type_s === 'service'));
  assert.deepEqual(single.responseHeader.params.fq, ['demo_content_type_s:"service"']);
  const repeated = createFixtureResponse('http://127.0.0.1/search?q=travel%20vaccinations&rows=10&fq=demo_content_type_s%3A%22community%22&fq=demo_content_type_s%3A%22service%22');
  assert.equal(repeated.response.numFound, 2);
  assert.deepEqual(repeated.response.docs.map(doc => doc.demo_content_type_s), ['community','service']);
  assert.deepEqual(repeated.responseHeader.params.fq, ['demo_content_type_s:"community"','demo_content_type_s:"service"']);
});

test('broad corpus contains six category-free PDFs and preserves quote-containing query state', () => {
  const response = createFixtureResponse('http://127.0.0.1/search?q=%22health%22&rows=200');
  const pdfs = response.response.docs.filter(doc => doc.document_type === 'pdf');
  assert.equal(pdfs.length, 6);
  assert.ok(pdfs.every(doc => doc.demo_content_type_s === null));
  assert.equal(response.responseHeader.params.q, '"health"');
  assert.ok(response.response.docs.every(doc => !doc.title.includes('<script>')));
  assert.equal(response.metadata.facets[0].name, 'demo_content_type_s');
  assert.deepEqual(response.metadata.results.map(field => field.name), ['title','url','description','demo_content_type_s','document_type']);
});

test('zero-result queries and pagination expose exact counts and stable slices', () => {
  const none = createFixtureResponse('http://127.0.0.1/search?q=MBA');
  assert.equal(none.response.numFound, 0);
  assert.deepEqual(none.response.docs, []);
  const first = createFixtureResponse('http://127.0.0.1/search?q=health&rows=2&start=0');
  const second = createFixtureResponse('http://127.0.0.1/search?q=health&rows=2&start=2');
  assert.equal(first.response.numFound, second.response.numFound);
  assert.equal(first.response.docs.length, 2);
  assert.equal(second.response.start, 2);
  assert.notDeepEqual(first.response.docs.map(doc => doc.id), second.response.docs.map(doc => doc.id));
});

test('fixture server provides local launcher, sanitized request log, unavailable state, and loopback CORS', async t => {
  const server = createSearchDesignFixtureServer();
  let base;
  try {
    await new Promise((resolve, reject) => {
      server.once('listening', resolve);
      server.once('error', reject);
      server.listen(0, '127.0.0.1');
    });
    base = `http://127.0.0.1:${server.address().port}`;
  } catch (error) {
    if (error.code === 'EPERM') { t.skip('Sandbox does not permit loopback listeners.'); return; }
    throw error;
  }
  try {
    const proof = await fetch(`${base}/proof`);
    assert.match(await proof.text(), /LOCAL FIXTURE/);
    const rejected = await fetch(`${base}/search?q=health`, { headers:{ origin:'http://localhost:9999' } });
    assert.equal(rejected.status, 403);
    const allowed = await fetch(`${base}/search?q=unavailable`, { headers:{ origin:'http://127.0.0.1:4321' } });
    assert.equal(allowed.status, 503);
    assert.equal(allowed.headers.get('access-control-allow-origin'), 'http://127.0.0.1:4321');
    const log = await (await fetch(`${base}/requests`)).json();
    assert.deepEqual(log, [{ q:'unavailable', start:'0', rows:'10', fq:[], sort:'' }]);
    assert.equal(JSON.stringify(log).toLowerCase().includes('authorization'), false);
    await fetch(`${base}/requests`, { method:'POST' });
    assert.deepEqual(await (await fetch(`${base}/requests`)).json(), []);
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
