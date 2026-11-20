import { normalizeTypes } from './search-state.mjs';

const PATH_LABELS = Object.freeze({
  care: 'Care', providers: 'Providers', services: 'Services', resources: 'Resources',
  education: 'Education', research: 'Research', community: 'Community',
  locations: 'Locations', news: 'News', documents: 'Documents', pdfs: 'Documents',
});

export function displayResultTitle(title, siteName) {
  // Accept titles indexed just before the rename until the public recrawl completes.
  for (const name of [siteName, 'Alder Coast University Health']) {
    const suffix = ` | ${name}`;
    if (title?.endsWith(suffix)) return title.slice(0, -suffix.length).trimEnd();
  }
  return title;
}

// Presentation only: never change result membership, order, title or destination.
export function resultPresentation(result, basePath) {
  const format = result.allFields?.find(field => field.key === 'document_type')?.value;
  const isPdf = (Array.isArray(format) ? format[0] : format) === 'pdf';
  let breadcrumb = '';
  try {
    const url = new URL(result.url);
    const base = basePath.replace(/\/$/, '') + '/';
    if (url.pathname.startsWith(base)) {
      const parts = url.pathname.slice(base.length).split('/').filter(Boolean);
      parts.pop();
      breadcrumb = ['Home', ...parts.map(part => Object.hasOwn(PATH_LABELS, part) ? PATH_LABELS[part] : part.replaceAll('-', ' '))].join(' / ');
    }
  } catch { /* A missing path does not justify invented metadata. */ }
  return { isPdf, breadcrumb };
}

export function typesFromResponse(response) {
  const fq = response?.responseHeader?.params?.fq;
  const expressions = Array.isArray(fq) ? fq : [fq];
  const values = [];
  for (const expression of expressions) {
    if (typeof expression !== 'string') continue;
    for (const match of expression.matchAll(/demo_content_type_s:\s*(?:\(([^)]*)\)|"([^"]+)"|([^\s)]+))/g)) {
      if (match[1]) values.push(...Array.from(match[1].matchAll(/"([^"]+)"/g), item => item[1]));
      else values.push(match[2] ?? match[3]);
    }
  }
  return normalizeTypes(values);
}
