import { readFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const QUERIES = [
  'travel vaccinations',
  'MBA',
  'master of business administration',
  'flu shots',
  'nursing courses',
  '"flu clinic updates"',
];
const ROWS = 100;
const EVIDENCE_DIR = resolve(ROOT, 'artifacts/search-facet-integration-2026-10-29');

function projectEnv() {
  const values = { ...process.env };
  for (const name of ['.env.local', '.env']) {
    try {
      for (const line of readFileSync(resolve(ROOT, name), 'utf8').split(/\r?\n/)) {
        const match = line.match(/^\s*(PUBLIC_SEARCHSTAX_SEARCH_URL|PUBLIC_SEARCHSTAX_READ_ONLY_TOKEN)\s*=\s*(.*?)\s*$/);
        if (match && !values[match[1]]) values[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
      }
    } catch {}
  }
  return values;
}

function validateEndpoint(raw) {
  let endpoint;
  try { endpoint = new URL(raw); } catch { throw new Error('Configured SearchStax read endpoint is missing or invalid.'); }
  if (endpoint.protocol !== 'https:' || !endpoint.hostname.endsWith('.searchstax.com') || endpoint.search || endpoint.hash)
    throw new Error('Configured endpoint is not an HTTPS SearchStax endpoint.');
  return endpoint;
}

function safeMetadata(metadata, facetCounts) {
  if (!metadata || !Array.isArray(metadata.results) || (metadata.facets !== undefined && !Array.isArray(metadata.facets)))
    throw new Error('Search response omitted expected metadata.');
  const wanted = new Set(['id', 'title', 'url', 'description', 'demo_content_type_s', 'document_type']);
  return {
    results: metadata.results.filter(field => wanted.has(field?.name)).map(field => ({
      name: field.name,
      ...(typeof field.title === 'string' ? { title: field.title } : {}),
      ...(typeof field.result_card === 'string' ? { result_card: field.result_card } : {}),
    })),
    facets: (metadata.facets ?? []).filter(field => typeof field?.name === 'string').map(field => ({
      name:field.name,
      ...(typeof field.label === 'string' ? { label:field.label } : {}),
    })),
    facetCounts: safeFacetCounts(facetCounts),
    sorts: (metadata.sorts ?? []).filter(field => typeof field?.name === 'string').map(field => ({
      name:field.name,
      ...(typeof field.order === 'string' ? { order:field.order } : {}),
      ...(typeof field.label === 'string' ? { label:field.label } : {}),
    })),
  };
}

function safeFacetCounts(value) {
  if (value === undefined) return {};
  const fields = value?.facet_fields;
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) throw new Error('Search response contained malformed facet counts.');
  const safe = {};
  for (const [name, entries] of Object.entries(fields)) {
    if (!Array.isArray(entries) || entries.length % 2 !== 0) throw new Error('Search response contained incomplete facet counts.');
    for (let index = 0; index < entries.length; index += 2) {
      if (typeof entries[index] !== 'string' || !Number.isFinite(entries[index + 1]) || entries[index + 1] < 0)
        throw new Error('Search response contained invalid facet count values.');
    }
    safe[name] = entries.slice();
  }
  return safe;
}

function scalarString(value) {
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && value.length && typeof value[0] === 'string') return value[0];
  return null;
}

function normalizedRecord(doc) {
  const title = scalarString(doc?.title);
  const description = scalarString(doc?.description);
  if (!doc || typeof doc !== 'object' || typeof doc.id !== 'string' || !doc.id ||
      !title || typeof doc.url !== 'string')
    throw new Error('Search response contained an incomplete result record.');
  let url;
  try { url = new URL(doc.url); } catch { throw new Error('Search response contained an invalid result URL.'); }
  if (!['https:', 'http:'].includes(url.protocol)) throw new Error('Search response contained an invalid result URL.');
  return {
    id:doc.id, title, url:url.href, description,
    demo_content_type_s:typeof doc.demo_content_type_s === 'string' ? doc.demo_content_type_s : null,
    document_type:typeof doc.document_type === 'string' ? doc.document_type : null,
  };
}

async function captureQuery(endpoint, token, query, fetcher) {
  let start = 0;
  let expectedTotal;
  let metadata;
  const records = [];
  const ids = new Set();
  const urls = new Set();
  do {
    const requestURL = new URL(endpoint.href);
    requestURL.searchParams.set('q', query);
    requestURL.searchParams.set('start', String(start));
    requestURL.searchParams.set('rows', String(ROWS));
    const response = await fetcher(requestURL, {
      method:'GET',
      headers:{ Accept:'application/json', Authorization:`Token ${token}` },
      signal:AbortSignal.timeout(30000),
    });
    if (!response.ok) throw new Error(`Search request failed with HTTP ${response.status}.`);
    let data;
    try { data = await response.json(); } catch { throw new Error('Search response was not valid JSON.'); }
    if (data?.responseHeader?.status !== 0 || data?.responseHeader?.params?.q !== query ||
        Number(data?.responseHeader?.params?.start) !== start || Number(data?.responseHeader?.params?.rows) !== ROWS ||
        !Number.isSafeInteger(data?.response?.numFound) || data.response.numFound < 0 ||
        data?.response?.start !== start || !Array.isArray(data?.response?.docs))
      throw new Error('Search response did not match the requested query/page.');
    if (expectedTotal === undefined) {
      expectedTotal = data.response.numFound;
      metadata = safeMetadata(data.metadata, data.facet_counts);
    } else if (data.response.numFound !== expectedTotal) {
      throw new Error('Search result count changed during pagination.');
    }
    const page = data.response.docs.map(normalizedRecord);
    const expectedPageLength = Math.min(ROWS, Math.max(0, expectedTotal - start));
    if (page.length !== expectedPageLength) throw new Error('Search response page was incomplete.');
    for (const record of page) {
      if (ids.has(record.id) || urls.has(record.url)) throw new Error('Search response repeated a result identity.');
      ids.add(record.id); urls.add(record.url); records.push(record);
    }
    start += page.length;
  } while (start < expectedTotal);
  if (records.length !== expectedTotal) throw new Error('Search result population was incomplete.');
  return { query, numFound:expectedTotal, start:0, rows:ROWS, records, metadata };
}

export async function collectEvidence({ endpoint, token, queries = QUERIES, fetcher = fetch, stage = 'before' } = {}) {
  if (!['before', 'after'].includes(stage)) throw new Error('Capture stage must be before or after.');
  const searchEndpoint = validateEndpoint(endpoint);
  if (typeof token !== 'string' || token.length < 8) throw new Error('Read-only SearchStax token is missing.');
  const results = [];
  for (const query of queries) results.push(await captureQuery(searchEndpoint, token, query, fetcher));
  return { stage, capturedAt:new Date().toISOString(), sort:'', facetSelection:[], results };
}

function sameRecords(before, after) {
  return before.numFound === after.numFound && before.records.length === after.records.length &&
    before.records.every((record, index) => JSON.stringify(record) === JSON.stringify(after.records[index]));
}

function hasContentTypeFacet(entry) {
  return (entry.metadata?.facets ?? []).some(facet => facet.name === 'demo_content_type_s') ||
    Object.hasOwn(entry.metadata?.facetCounts ?? {}, 'demo_content_type_s');
}

function compareMetadata(before, after) {
  const beforeMetadata = before.metadata ?? {};
  const afterMetadata = after.metadata ?? {};
  const otherFacets = facets => (facets ?? []).filter(facet => facet.name !== 'demo_content_type_s');
  return {
    resultDefinitionsEqual:JSON.stringify(beforeMetadata.results ?? []) === JSON.stringify(afterMetadata.results ?? []),
    nonContentTypeFacetsEqual:JSON.stringify(otherFacets(beforeMetadata.facets)) === JSON.stringify(otherFacets(afterMetadata.facets)),
    beforeContentTypeFacet:(beforeMetadata.facets ?? []).find(facet => facet.name === 'demo_content_type_s') ?? null,
    afterContentTypeFacet:(afterMetadata.facets ?? []).find(facet => facet.name === 'demo_content_type_s') ?? null,
    beforeFacetCountsCaptured:Object.hasOwn(beforeMetadata, 'facetCounts'),
    afterFacetCounts:afterMetadata.facetCounts ?? null,
    beforeSortsCaptured:Object.hasOwn(beforeMetadata, 'sorts'),
    afterSorts:afterMetadata.sorts ?? null,
    facetCountsComparable:Object.hasOwn(beforeMetadata, 'facetCounts'),
    sortsComparable:Object.hasOwn(beforeMetadata, 'sorts'),
  };
}

export function compareEvidence(before, after) {
  if (!before || !after || !Array.isArray(before.results) || !Array.isArray(after.results))
    throw new Error('Comparison requires before and after evidence files.');
  const afterByQuery = new Map(after.results.map(entry => [entry.query, entry]));
  if (afterByQuery.size !== before.results.length || before.results.some(entry => !afterByQuery.has(entry.query)))
    throw new Error('Before and after evidence query sets do not match.');
  return before.results.map(previous => {
    const current = afterByQuery.get(previous.query);
    const recordsEqual = sameRecords(previous, current);
    const facetAdded = !hasContentTypeFacet(previous) && hasContentTypeFacet(current);
    return {
      query:previous.query,
      beforeCount:previous.numFound,
      afterCount:current.numFound,
      orderedRecordsEqual:recordsEqual,
      facetMetadataAdded:facetAdded,
      recordsUnchangedWithFacetDeclarationPresent:recordsEqual && hasContentTypeFacet(current),
      metadata:compareMetadata(previous, current),
    };
  });
}

function parseArgs(args) {
  if (args.includes('--compare')) return { compare:true };
  const stageIndex = args.indexOf('--stage');
  const stage = stageIndex === -1 ? 'before' : args[stageIndex + 1];
  if (!['before', 'after'].includes(stage)) throw new Error('Use --stage before or --stage after.');
  return { stage };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.compare) {
    const before = JSON.parse(readFileSync(resolve(EVIDENCE_DIR, 'before-live.json'), 'utf8'));
    const after = JSON.parse(readFileSync(resolve(EVIDENCE_DIR, 'after-live.json'), 'utf8'));
    const output = resolve(EVIDENCE_DIR, 'comparison.json');
    if (existsSync(output)) throw new Error('Refusing to overwrite existing comparison evidence.');
    const comparison = {
      comparedAt:new Date().toISOString(),
      beforeCapturedAt:before.capturedAt ?? null,
      afterCapturedAt:after.capturedAt ?? null,
      results:compareEvidence(before, after),
    };
    mkdirSync(dirname(output), { recursive:true });
    writeFileSync(output, `${JSON.stringify(comparison, null, 2)}\n`, { mode:0o600, flag:'wx' });
    for (const result of comparison.results) process.stdout.write(`${JSON.stringify({ query:result.query, beforeCount:result.beforeCount, afterCount:result.afterCount, orderedRecordsEqual:result.orderedRecordsEqual, recordsUnchangedWithFacetDeclarationPresent:result.recordsUnchangedWithFacetDeclarationPresent })}\n`);
    process.stdout.write(`Comparison saved: ${output}\n`);
    return;
  }
  const output = resolve(EVIDENCE_DIR, `${args.stage}-live.json`);
  if (existsSync(output)) throw new Error(`Refusing to overwrite existing ${args.stage} evidence.`);
  const env = projectEnv();
  const evidence = await collectEvidence({ endpoint:env.PUBLIC_SEARCHSTAX_SEARCH_URL, token:env.PUBLIC_SEARCHSTAX_READ_ONLY_TOKEN, stage:args.stage });
  mkdirSync(dirname(output), { recursive:true });
  writeFileSync(output, `${JSON.stringify(evidence, null, 2)}\n`, { mode:0o600, flag:'wx' });
  for (const result of evidence.results) process.stdout.write(`${JSON.stringify({ query:result.query, count:result.numFound, records:result.records.length })}\n`);
  process.stdout.write(`Evidence saved: ${output}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
