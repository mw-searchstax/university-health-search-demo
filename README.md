# Alder Coast University Health

A fictional public university health system in Alder Coast, Oregon, created as content for Site Search training. The local corpus contains **96 static HTML pages and six text-based PDFs**. It has no visitor-facing search interface, real clinical services, contact channels, patient data or submission forms. This count describes local source and output, not verified public or indexed coverage.

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

The [corpus manifest](docs/checkpoint-3-corpus-manifest.json) preserves the original 86-page / six-PDF inventory. The [supplemental fixture manifest](src/data/script-fixtures.json) adds ten HTML records; validators check the exact combined inventory. The 95 Markdown page records live in `src/content/pages/`; the standalone homepage uses `src/data/site.json`. Reviewable PDF sources live in `src/content/documents/`, with their parent links and output paths in `src/data/documents.json`.

The GitHub Actions [deployment workflow](.github/workflows/deploy.yml) installs the pinned dependencies, runs the complete check suite and deploys only `dist/` to GitHub Pages. The project base path is `/university-health-search-demo/`. Operational planning and local QA evidence are preserved outside the public Git file set.

Source metadata and controlled search-body regions support later extraction and ranking experiments. Their presence does not establish SearchStax indexing, field types, synonym behavior or ranking outcomes.
