import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { pageSchema } from './lib/content';

const pages = defineCollection({
  loader: glob({
    pattern: '*.md',
    base: './src/content/pages',
    generateId: ({ entry }) => entry.replace(/\.md$/, ''),
  }),
  schema: pageSchema,
});

export const collections = { pages };
