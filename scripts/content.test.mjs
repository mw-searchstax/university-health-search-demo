import assert from 'node:assert/strict';
import test from 'node:test';
import { pageSchema, validatePages } from '../src/lib/content.ts';

const data = (overrides = {}) => pageSchema.parse({
  slug: 'care', content_type: 'hub', title: 'Care', summary: 'A useful introduction.',
  audience: ['patient'], published_date: '2026-01-01', updated_date: '2026-10-22', related_ids: [], ...overrides,
});
const record = (id, overrides = {}) => ({ id, data: data(overrides), body: 'Meaningful body content.' });

test('rejects invalid dates, future dates, unsafe slugs and missing provider facts', () => {
  for (const overrides of [
    { published_date: '2026-02-30' },
    { updated_date: '2026-13-01' },
    { updated_date: '2027-01-01' },
    { published_date: '2026-10-22', updated_date: '2026-01-01' },
    { slug: '../care' },
    { slug: 'care//bad' },
    { slug: 'care/providers/mara', content_type: 'provider' },
    { slug: 'care/services/cardiology', content_type: 'service' },
    { audience: [] },
    { content_type: 'unknown' },
  ]) assert.throws(() => data(overrides));
});

test('keeps valid calendar dates and explicit service/location relationships', () => {
  const provider = record('provider-mara', {
    slug: 'care/providers/mara', content_type: 'provider', department: 'Teaching', specialty: ['Sleep Medicine'],
    service_ids: ['service-sleep'], location_ids: ['location-sleep'], related_ids: ['hub-care'],
  });
  const pages = [provider, record('hub-care'), record('service-sleep', {
    slug: 'care/services/sleep', content_type: 'service', service_line: 'Teaching',
  }), record('location-sleep', { slug: 'locations/sleep', content_type: 'location' })];
  assert.doesNotThrow(() => validatePages(pages));
  assert.equal(data({ published_date: '2024-02-29' }).published_date, '2024-02-29');
  provider.data.location_ids = ['service-sleep'];
  assert.throws(() => validatePages(pages), /must be a location/);
  provider.data.location_ids = ['location-sleep'];
  provider.data.service_ids = ['location-sleep'];
  assert.throws(() => validatePages(pages), /must be a service/);
});

test('rejects duplicate IDs/URLs, missing references, self-links, blank bodies and duplicate edges', () => {
  assert.throws(() => validatePages([record('same'), record('same', { slug: 'about' })]), /Duplicate record ID/);
  assert.throws(() => validatePages([record('one'), record('two')]), /duplicate or empty collection slug/);
  assert.throws(() => validatePages([record('one', { related_ids: ['missing'] })]), /invalid related_ids/);
  assert.throws(() => validatePages([record('one', { related_ids: ['one'] })]), /invalid related_ids/);
  assert.throws(() => validatePages([{ ...record('one'), body: ' ' }]), /body is empty/);
  assert.throws(() => validatePages([record('one', { related_ids: ['two', 'two'] }), record('two', { slug: 'about' })]), /duplicate related_ids/);
});
