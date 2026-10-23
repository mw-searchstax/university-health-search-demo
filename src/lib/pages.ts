import { getCollection } from 'astro:content';
import { validatePages } from './content';

export async function getPages() {
  const pages = await getCollection('pages');
  validatePages(pages);
  return pages.sort((a, b) => a.data.slug.localeCompare(b.data.slug));
}

export function pageHref(slug = '') {
  return fileHref(slug ? `${slug}/` : '');
}

export function fileHref(path: string) {
  return `${import.meta.env.BASE_URL.replace(/\/$/, '')}/${path}`;
}

export const typeLabels = {
  hub: 'Explore',
  provider: 'Provider profile',
  service: 'Clinical service',
  location: 'Location',
  resource: 'Patient resource',
  program: 'Education',
  research: 'Research',
  community: 'Community program',
  news: 'News archive',
};
