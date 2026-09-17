# Global Discovery Engine

Cloud-native daily global information discovery system.

## Current stage: v0.1.2

The current pipeline is designed to run without a local computer:

- Cloudflare Worker
- Cloudflare D1 (`global-discovery`)
- Daily Cron Trigger at 05:00 Taiwan time (21:00 UTC)
- RSS ingestion
- GDELT DOC API ingestion across six broad discovery domains
- URL-level deduplication
- Source registry
- Collection run history and error recording
- Health and stats endpoints

The current direct RSS smoke-test source is BBC World. GDELT is used as the broad discovery radar so the engine is not dependent on a fixed media list.

## Runtime endpoints

- `/` — status, article/source counts, latest collection
- `/health` — lightweight health check
- `/stats` — recent collection runs
- `/db` — database table check
- `/collect` — manual POST collection, rate-limited to one run per 6 hours

The scheduled handler runs the same collection pipeline automatically every day.

## Cloudflare configuration

The Worker expects a D1 binding named `DB` pointing to the `global-discovery` database.

`wrangler.toml` is the deployment source of truth. The production Git branch is `main`.

## Data model

The D1 core tables are:

- `sources`
- `articles`
- `stories`
- `article_stories`

The Worker creates two lightweight operational tables automatically on first run:

- `collection_runs`
- `manual_collection_guard`

## Next stages

The collection layer is intentionally built before the expensive semantic layers. Planned stages are:

1. Story clustering
2. Candidate selection and diversity control
3. Research dossiers and claim/evidence tracking
4. Faithful translation and spoken editorial
5. TTS and podcast RSS delivery
6. Dynamic source discovery and source-quality history

No API keys are stored in the repository. External AI/search/TTS credentials should be added through Cloudflare secrets when those stages are introduced.
