import { defineConfig } from 'astro/config';

export default defineConfig({
  site: process.env.DEMO_SITE_ORIGIN || 'https://mw-searchstax.github.io',
  base: '/university-health-search-demo',
  output: 'static',
  trailingSlash: 'always',
  build: { format: 'directory' },
});
