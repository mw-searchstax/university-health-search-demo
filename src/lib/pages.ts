import site from '../data/site.json';
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

const displayLabels: Record<string, string> = {
  ...Object.fromEntries(site.navigation.map(({ slug, label }) => [slug, label])),
  ...site.pageLabels,
};

export function pageLabel(slug: string, title: string) {
  return displayLabels[slug] ?? title;
}
