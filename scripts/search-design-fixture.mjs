import http from 'node:http';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const PUBLIC_BASE = 'https://mw-searchstax.github.io/university-health-search-demo/';
const ALLOWED_ORIGIN = 'http://127.0.0.1:4321';
const TYPES = ['hub','provider','service','location','resource','program','research','community','news'];
const NURSING_ORDER = ['education/nursing-foundations','education/nursing-community-practice','education/nursing-simulation'];
const PDFs = [
  ['appointment-preparation','Appointment Packet Guide','Appointment packet materials and document roles.'],
  ['cardiology-visit-overview','Heart Center Collection Guide','A fictional guide to cardiology teaching exhibits.'],
  ['community-screening-overview','Community Screening Reading Collection','A reading collection of public-health vocabulary materials.'],
  ['nursing-program-overview','Nursing Classroom Materials','Invented classroom props for fictional nursing education.'],
  ['research-participation-overview','Research Document Vocabulary','Labels used in a fictional research information set.'],
  ['sleep-visit-overview','Sleep Center Demonstration Rooms','A room guide for fictional teaching spaces.'],
];

function frontmatter(source) {
  const fields = {};
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return { fields, body: source };
  for (const line of match[1].split(/\r?\n/)) {
    const field = line.match(/^([a-z_]+):\s*(.*)$/);
    if (field) fields[field[1]] = field[2].trim().replace(/^(["'])(.*)\1$/, '$2');
  }
  return { fields, body: source.slice(match[0].length) };
}

function loadRecords() {
  const pages = readdirSync(join(ROOT, 'src/content/pages')).filter(file => file.endsWith('.md')).map(file => {
    const parsed = frontmatter(readFileSync(join(ROOT, 'src/content/pages', file), 'utf8'));
    const { slug, title, summary, content_type: type } = parsed.fields;
    if (!slug || !title || !summary || !TYPES.includes(type)) return null;
    return { id: slug, slug, title, description: summary, body: `${summary} ${parsed.body}`, type, documentType: 'html', url: new URL(`${slug}/`, PUBLIC_BASE).href };
  }).filter(Boolean);
  const documents = PDFs.map(([id, title, description]) => ({ id: `pdfs/${id}.pdf`, slug: `pdfs/${id}.pdf`, title, description, body: `${title} ${description}`, type: null, documentType: 'pdf', url: new URL(`pdfs/${id}.pdf`, PUBLIC_BASE).href }));
  return [...pages, ...documents];
}

const RECORDS = loadRecords();
const bySlug = new Map(RECORDS.map(record => [record.slug, record]));

function parseFq(params) {
  return params.getAll('fq').flatMap(fq => {
    const match = fq.match(/demo_content_type_s\s*:\s*(.*)/);
    if (!match) return [];
    return [...match[1].matchAll(/"((?:\\.|[^"\\])*)"/g)].map(value => value[1].replace(/\\([\\"])/g, '$1')).filter(value => TYPES.includes(value));
  });
}
function queryRecords(query) {
  const normalized = query.trim().toLowerCase();
  const clean = normalized.replace(/^"|"$/g, '');
  if (!clean || clean === '*' || clean === 'health') return RECORDS;
  if (normalized === 'travel vaccinations') return ['community/transit-access','care/services/international-health'].map(id => bySlug.get(id)).filter(Boolean);
  if (normalized === 'nursing courses') {
    const priority = new Map(NURSING_ORDER.map((id, index) => [id, index]));
    const matches = RECORDS.filter(record => record.documentType === 'html' && `${record.title} ${record.description} ${record.body}`.toLowerCase().includes('nursing'));
    const continuing = bySlug.get('education/continuing-education');
    if (continuing && !matches.includes(continuing)) matches.push(continuing);
    return matches
      .sort((a, b) => (priority.get(a.slug) ?? 10) - (priority.get(b.slug) ?? 10));
  }
  if (normalized === 'mba' || normalized === 'no-such-result') return [];
  if (normalized === 'unavailable') return RECORDS;
  const terms = normalized.replace(/^"|"$/g, '').split(/\s+/).filter(Boolean);
  return RECORDS.filter(record => terms.some(term => `${record.title} ${record.description} ${record.body}`.toLowerCase().includes(term)));
}

export function createFixtureResponse(url, scenario = 'changed') {
  const parsed = url instanceof URL ? url : new URL(url, 'http://127.0.0.1:4174');
  const query = parsed.searchParams.get('q') || '';
  const rows = Math.max(1, Math.min(500, Number(parsed.searchParams.get('rows')) || 10));
  const start = Math.max(0, Number(parsed.searchParams.get('start')) || 0);
  const types = parseFq(parsed.searchParams);
  let population = queryRecords(query);
  if (query.trim().toLowerCase() === 'travel vaccinations' && scenario === 'baseline') population = population.slice(0, 1);
  let matches = population;
  if (types.length) matches = matches.filter(record => types.includes(record.type));
  const docs = matches.slice(start, start + rows).map(record => ({
    id: record.id,
    title: `${record.title} | Alder Coast University Health`,
    url: record.url,
    description: record.description,
    demo_content_type_s: record.type,
    document_type: record.documentType,
  }));
  const facetCounts = new Map();
  for (const record of population) if (record.type) facetCounts.set(record.type, (facetCounts.get(record.type) || 0) + 1);
  const facetValues = [...facetCounts].flatMap(([value, count]) => [value, count]);
  return {
    responseHeader: { status:0, QTime:1, params:{ q:query, rows:String(rows), start:String(start), fq:parsed.searchParams.getAll('fq'), uniqueId:'id', model:'default' } },
    response: { numFound:matches.length, start, numFoundExact:true, docs },
    facet_counts: { facet_fields:{ demo_content_type_s:facetValues } },
    metadata: {
      results:[
        { name:'title', title:'Title', result_card:'title' }, { name:'url', title:'URL', result_card:'url' },
        { name:'description', title:'Description', result_card:'description' },
        { name:'demo_content_type_s', title:'Content type' }, { name:'document_type', title:'Document type' },
      ],
      facets:[{ name:'demo_content_type_s', label:'Content type' }], sorts:[],
    },
    highlighting:{}, spellcheck:{ suggestions:[], correctlySpelled:true },
  };
}

const log = [];
let activeScenario = 'changed';
const launcher = `<!doctype html><meta charset="utf-8"><title>Local search proof</title><main><h1>LOCAL FIXTURE</h1><p>This local fixture supports design proof only. It does not change SearchStax settings.</p><ul><li><a href="/proof/baseline">Baseline results</a></li><li><a href="/proof/changed">Changed results</a></li><li><a href="/proof/multiple">Multiple content types</a></li><li><a href="/proof/mixed">Mixed results including PDFs</a></li></ul></main>`;

export function createSearchDesignFixtureServer({ delayMs = 0, cacheDelayMs = delayMs } = {}) {
  return http.createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1:4174');
    const origin = req.headers.origin;
    if (origin && origin !== ALLOWED_ORIGIN) { res.writeHead(403); return res.end(); }
    if (origin === ALLOWED_ORIGIN) res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
    res.setHeader('Vary', 'Origin');
    if (req.method === 'OPTIONS') { res.setHeader('Access-Control-Allow-Methods','GET, POST, OPTIONS'); res.setHeader('Access-Control-Allow-Headers','Content-Type, Authorization'); res.writeHead(204); return res.end(); }
    if (url.pathname === '/proof' && req.method === 'GET') { res.writeHead(200, {'content-type':'text/html; charset=utf-8'}); return res.end(launcher); }
    if (url.pathname.startsWith('/proof/') && req.method === 'GET') {
      const stage = url.pathname.slice('/proof/'.length);
      if (!['baseline','changed','multiple','mixed'].includes(stage)) { res.writeHead(404); return res.end(); }
      activeScenario = stage === 'baseline' ? 'baseline' : 'changed';
      const query = stage === 'mixed' ? 'health' : stage === 'multiple' ? 'travel vaccinations' : 'travel vaccinations';
      res.writeHead(302, { location:`http://127.0.0.1:4321/university-health-search-demo/search/?q=${encodeURIComponent(query)}` }); return res.end();
    }
    if (url.pathname === '/requests' && req.method === 'GET') { res.writeHead(200, {'content-type':'application/json'}); return res.end(JSON.stringify(log)); }
    if (url.pathname === '/requests' && req.method === 'POST') { log.length = 0; res.writeHead(204); return res.end(); }
    if (url.pathname === '/search' && req.method === 'GET') {
      const entry = { q:url.searchParams.get('q') || '', start:url.searchParams.get('start') || '0', rows:url.searchParams.get('rows') || '10', fq:url.searchParams.getAll('fq'), sort:url.searchParams.get('sort') || '' };
      log.push(entry);
      if (entry.q.trim().toLowerCase() === 'unavailable') { res.writeHead(503, {'content-type':'application/json'}); return res.end(JSON.stringify({ error:'Local fixture unavailable state' })); }
      const body = JSON.stringify(createFixtureResponse(url, activeScenario));
      const send = () => { res.writeHead(200, {'content-type':'application/json; charset=utf-8'}); res.end(body); };
      const delay = url.searchParams.has('rows') ? delayMs : cacheDelayMs;
      if (delay > 0) setTimeout(send, Math.min(delay, 10000));
      else send();
      return;
    }
    res.writeHead(404); res.end();
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const server = createSearchDesignFixtureServer({ delayMs: Number(process.env.SEARCH_DESIGN_DELAY_MS) || 0, cacheDelayMs: Number(process.env.SEARCH_DESIGN_CACHE_DELAY_MS) || 0 });
  server.listen(4174, '127.0.0.1', () => process.stdout.write('Search design fixture listening on http://127.0.0.1:4174/proof\n'));
}
