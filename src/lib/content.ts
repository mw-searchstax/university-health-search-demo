import { z } from 'astro/zod';

export const editorialCutoff = '2026-10-22';
const text = z.string().trim().min(1);
const recordId = z.string().regex(/^[a-z][a-z0-9-]*$/);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}, 'Use a real ISO calendar date');

const routePrefixes = {
  provider: 'care/providers/',
  service: 'care/services/',
  location: 'locations/',
  resource: 'care/resources/',
  program: 'education/',
  research: 'research/',
  community: 'community/',
  news: 'news/',
};

export const pageSchema = z.object({
  slug: z.string().regex(/^(?:[a-z0-9]+(?:-[a-z0-9]+)*(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)*)?$/),
  content_type: z.enum(['hub', 'provider', 'service', 'location', 'resource', 'program', 'research', 'community', 'news']),
  title: text,
  summary: text,
  audience: z.array(z.enum(['patient', 'student', 'faculty', 'community'])).min(1),
  published_date: date,
  updated_date: date,
  related_ids: z.array(recordId),
  department: text.optional(),
  service_line: text.optional(),
  specialty: z.array(text).default([]),
  service_ids: z.array(recordId).default([]),
  location_ids: z.array(recordId).default([]),
  keywords: z.array(text).default([]),
}).strict().superRefine((page, ctx) => {
  const issue = (path: string, message: string) => ctx.addIssue({ code: 'custom', path: [path], message });
  if (page.published_date > page.updated_date) issue('updated_date', 'Updated date precedes publication');
  if (page.updated_date > editorialCutoff) issue('updated_date', `Date exceeds editorial cutoff ${editorialCutoff}`);
  if (page.content_type === 'hub') {
    if (!['', 'about', 'care', 'education', 'research', 'locations', 'community', 'news'].includes(page.slug)) {
      issue('slug', 'Unknown institutional hub route');
    }
  } else {
    const prefix = routePrefixes[page.content_type];
    if (!page.slug.startsWith(prefix) || page.slug.slice(prefix.length).includes('/') || page.slug === prefix) {
      issue('slug', `Expected one detail slug under ${prefix}`);
    }
  }
  if (page.content_type === 'provider') {
    if (!page.department) issue('department', 'Providers need a department');
    for (const field of ['specialty', 'service_ids', 'location_ids'] as const) {
      if (!page[field].length) issue(field, 'Providers need at least one value');
    }
  }
  if (page.content_type === 'service' && !page.service_line) issue('service_line', 'Services need a service line');
  if (['resource', 'program', 'research', 'community', 'news'].includes(page.content_type) && !page.related_ids.length) {
    issue('related_ids', 'This page type needs a related record');
  }
});

export type PageData = z.infer<typeof pageSchema>;
export type PageRecord = { id: string; data: PageData; body?: string };

export function validatePages(pages: PageRecord[]) {
  const ids = new Map(pages.map((page) => [page.id, page]));
  if (ids.size !== pages.length) throw new Error('Duplicate record ID');
  const slugs = new Set<string>();
  for (const page of pages) {
    recordId.parse(page.id);
    pageSchema.parse(page.data);
    if (!page.data.slug || slugs.has(page.data.slug)) throw new Error(`${page.id}: duplicate or empty collection slug`);
    slugs.add(page.data.slug);
    if (!page.body?.trim()) throw new Error(`${page.id}: body is empty`);
    for (const field of ['related_ids', 'service_ids', 'location_ids'] as const) {
      const refs = page.data[field];
      if (new Set(refs).size !== refs.length) throw new Error(`${page.id}: duplicate ${field}`);
      for (const id of refs) {
        const target = ids.get(id);
        if (!target || id === page.id) throw new Error(`${page.id}: invalid ${field} reference ${id}`);
        const expected = field === 'service_ids' ? 'service' : field === 'location_ids' ? 'location' : null;
        if (expected && target.data.content_type !== expected) throw new Error(`${page.id}: ${id} must be a ${expected}`);
      }
    }
  }
}
