# Global Discovery Engine

Cloud-native daily global information discovery system.

## Current stage

The cloud collection foundation is deployed through GitHub -> Cloudflare Workers -> D1.

Current components:

- Cloudflare Worker
- Cloudflare D1 (`global-discovery`)
- Daily Cron Trigger at 05:00 Taiwan time (21:00 UTC)
- RSS ingestion (BBC World smoke-test source)
- GDELT DOC API across six broad discovery domains
- URL-level deduplication
- Source registry
- Collection run history and error recording
- Health and stats endpoints
- Browser bootstrap: visiting the Worker root also triggers a rate-limited collection run

## Runtime endpoints

- `/` — status, article/source counts, latest collection; also kicks off a collection run when allowed
- `/health` — lightweight health check
- `/stats` — recent collection runs and source counts
- `/db` — database table check
- `/collect` — manual collection endpoint, rate-limited to one run per 6 hours

The scheduled handler runs the same collection pipeline automatically every day.

## Cloudflare configuration

The Worker expects a D1 binding named `DB` pointing to `global-discovery`.

`wrangler.toml` is the deployment source of truth. The production Git branch is `main`.

`src/entry.js` wraps the existing application so the first normal browser visit can start the collection without curl, DevTools, or a local computer.

## Data model

The D1 core tables are:

- `sources`
- `articles`
- `stories`
- `article_stories`

The Worker creates two lightweight operational tables automatically on first run:

- `collection_runs`
- `manual_collection_guard`

## Next engineering stages

1. Story clustering
2. Candidate selection and diversity control
3. Research dossiers and claim/evidence tracking
4. Faithful translation and spoken editorial
5. TTS and podcast RSS delivery
6. Dynamic source discovery and source-quality history

No API keys are stored in the repository. External AI/search/TTS credentials should be added through Cloudflare secrets when those stages are introduced.
