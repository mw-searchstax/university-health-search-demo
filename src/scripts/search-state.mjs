export const CONTENT_TYPE_LABELS = Object.freeze({
  hub: 'Overview pages', provider: 'Providers', service: 'Services', location: 'Locations',
  resource: 'Resources', program: 'Education programs', research: 'Research', community: 'Community', news: 'News',
});
export const CONTENT_TYPE_FIELD = 'demo_content_type_s';

export function normalizeTypes(values) {
  const allowed = new Set(Object.keys(CONTENT_TYPE_LABELS));
  const list = Array.isArray(values) ? values : [values];
  return [...new Set(list.filter(value => typeof value === 'string').map(value => value.trim()).filter(value => allowed.has(value)))].sort();
}

export function readSearch(url) {
  const params = new URL(url).searchParams;
  const page = Number(params.get('page'));
  return {
    query: params.get('q')?.trim() || '',
    page: Number.isSafeInteger(page) && page > 0 ? page : 1,
    types: normalizeTypes(params.getAll('type')),
  };
}

export function searchUrl(url, query, page, types = []) {
  const next = new URL(url);
  if (query) next.searchParams.set('q', query);
  else { next.searchParams.delete('q'); next.searchParams.delete('type'); }
  if (page > 1) next.searchParams.set('page', String(page));
  else next.searchParams.delete('page');
  if (query) {
    next.searchParams.delete('type');
    for (const type of normalizeTypes(types)) next.searchParams.append('type', type);
  }
  return next;
}

export function pageIsOutOfRange(page, total, pageSize) {
  return page > Math.max(1, Math.ceil(total / pageSize));
}

export function responseMatchesSearch(query, page, responseQuery, responseStart, pageSize, currentTypes = [], responseTypes = []) {
  const current = normalizeTypes(currentTypes);
  const response = normalizeTypes(responseTypes);
  return query.trim() === responseQuery && (page - 1) * pageSize === responseStart &&
    current.length === response.length && current.every((type, index) => type === response[index]);
}
