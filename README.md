# Central County University Health

A fictional public university health system in Oregon, created for Site Search training. The local corpus contains **97 content pages and six text-based PDFs**, plus a search page that stays out of the crawl. The site has no real clinical services, contact channels, patient data or submission forms.

**Fictional demonstration website. Not a real healthcare provider.**

## Run locally

Use Node 26.8.2 and Python 3.12.14, matching the deployment workflow. Astro is pinned in the npm lockfile; the existing PDF generation and validation libraries are pinned in `requirements-pdf.txt`.

```sh
npm ci
python3 -m venv .venv
. .venv/bin/activate
python -m pip install -r requirements-pdf.txt
npm run check
npm run preview -- --port 4321
```

Open the project path `/university-health-search-demo/` at the Local URL printed by Astro. `npm run check` runs the schema and checker tests, generates the PDFs, builds Astro and validates the complete output. For source editing, use `npm run dev`.

## Content and deployment

The [corpus manifest](docs/checkpoint-3-corpus-manifest.json) preserves the original 86-page / six-PDF inventory. The [supplemental fixture manifest](src/data/script-fixtures.json) adds eleven HTML records; validators check the exact combined inventory. The 96 Markdown page records live in `src/content/pages/`; the standalone homepage uses `src/data/site.json`. Reviewable PDF sources live in `src/content/documents/`, with their parent links and output paths in `src/data/documents.json`.

The GitHub Actions [deployment workflow](.github/workflows/deploy.yml) installs the pinned dependencies, runs the complete check suite and deploys only `dist/` to GitHub Pages. The project base path is `/university-health-search-demo/`. Operational planning and local QA evidence are preserved outside the public Git file set.

For a private staging build, set `DEMO_SITE_ORIGIN` to the protected host's origin, without the project path. Run the build and checks with that same value so internal canonical URLs point to staging. Use the dedicated staging Search App's read-only endpoint and browser token for `PUBLIC_SEARCHSTAX_SEARCH_URL` and `PUBLIC_SEARCHSTAX_READ_ONLY_TOKEN`.

Source metadata and the `.search-body` region support SearchStax extraction. Run ingestion and the lesson queries against the target Search App to verify the indexed fields and ranking.
