export function readSearch(url) {
  const params = new URL(url).searchParams;
  const page = Number(params.get('page'));
  return {
    query: params.get('q')?.trim() || '',
    page: Number.isSafeInteger(page) && page > 0 ? page : 1,
  };
}

export function searchUrl(url, query, page) {
  const next = new URL(url);
  if (query) next.searchParams.set('q', query);
  else next.searchParams.delete('q');
  if (page > 1) next.searchParams.set('page', String(page));
  else next.searchParams.delete('page');
  return next;
}

export function pageIsOutOfRange(page, total, pageSize) {
  return page > Math.max(1, Math.ceil(total / pageSize));
}

export function responseMatchesSearch(query, page, responseQuery, responseStart, pageSize) {
  return query.trim() === responseQuery && (page - 1) * pageSize === responseStart;
}
