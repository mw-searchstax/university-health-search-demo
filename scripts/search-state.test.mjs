import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readSearch, searchUrl, pageIsOutOfRange, responseMatchesSearch } from '../src/scripts/search-state.mjs';

test('search links preserve queries, pages, and unrelated parameters', () => {
  const start = 'https://example.test/demo/search/?lang=en';
  const next = searchUrl(start, '"flu clinic updates"', 2);
  assert.deepEqual(readSearch(next), { query: '"flu clinic updates"', page: 2 });
  assert.equal(next.searchParams.get('lang'), 'en');
  assert.equal(searchUrl(next, 'nursing', 1).searchParams.has('page'), false);
  assert.deepEqual(readSearch(start), { query: '', page: 1 });
  for (const page of ['0', '-1', '2.5', 'not-a-number', '9007199254740992']) {
    assert.equal(readSearch(`${start}&page=${page}`).page, 1);
  }
});

test('out-of-range pages return to the first page without treating zero results as an error', () => {
  assert.equal(pageIsOutOfRange(2, 13, 10), false);
  assert.equal(pageIsOutOfRange(3, 13, 10), true);
  assert.equal(pageIsOutOfRange(1, 0, 10), false);
  assert.equal(pageIsOutOfRange(2, 0, 10), true);
});

test('late responses cannot correct a different query or page', () => {
  assert.equal(responseMatchesSearch(' cardiology ', 2, 'cardiology', 10, 10), true);
  assert.equal(responseMatchesSearch('nursing', 2, 'cardiology', 10, 10), false);
  assert.equal(responseMatchesSearch('cardiology', 2, 'cardiology', 0, 10), false);
});
