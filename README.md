# Global Discovery Engine

Cloud-native daily global information discovery system.

## Current stage

The system now has a cloud collection foundation plus an end-to-end AI editorial and podcast path.

Current components:

- Cloudflare Worker
- Cloudflare D1 (`global-discovery`)
- Workers AI binding (`AI`)
- Daily Cron Trigger at 05:00 Taiwan time (21:00 UTC)
- Multi-source RSS ingestion across major global/world feeds
- Google News RSS radar fallback across geopolitics, economy, science, environment, society, and culture
- GDELT DOC global radar with one broad request per run and 250-record capacity
- URL-level deduplication
- Source registry
- Collection run history and error recording
- AI candidate selection with multidimensional story criteria
- Article full-text extraction through Workers AI Markdown Conversion when available
- Claim/evidence storage and source attribution
- Traditional Chinese episode generation
- Podcast RSS feed
- On-demand MP3 generation through multilingual MeloTTS
- Browser bootstrap: visiting the Worker root starts the daily pipeline when today's episode does not yet exist

## Runtime endpoints

- `/` — status, article/source counts, latest collection; also bootstraps today's pipeline when needed
- `/health` — lightweight health check
- `/stats` — recent collection runs and source counts
- `/db` — database table check
- `/collect` — manual collection endpoint, rate-limited to one run per 6 hours
- `/run` — starts today's end-to-end daily pipeline
- `/episode` — latest episode as JSON
- `/episode/<id>` — a specific episode as JSON
- `/podcast.xml` — podcast RSS feed
- `/audio/<id>` — on-demand MP3 audio for an episode
- `/ai-health` — recent daily pipeline status and episode count

## Collection strategy

The collector is intentionally broad. Fixed RSS sources provide direct feeds from multiple regions; Google News RSS supplies additional discovery coverage; GDELT acts as a global radar. Individual source failures are recorded without stopping the rest of the run.

GDELT is queried once per run rather than making six back-to-back requests. This reduces the chance of upstream throttling and still gives the engine a broad global article pool. The GDELT DOC API supports up to 250 records for Article List queries.

## AI pipeline

After collection, the daily pipeline passes a compact global candidate pool to `@cf/zai-org/glm-4.7-flash`. The model is instructed to preserve diversity, avoid a single black-box ranking, and select story units using importance, novelty, uniqueness, depth, curiosity, personal fit, evidence potential, and serendipity.

Selected articles are fetched and converted to plain text with Workers AI Markdown Conversion. The final editorial pass produces Taiwan Traditional Chinese, keeps attribution and uncertainty explicit, and stores claims with evidence article references.

The episode audio route uses `@cf/myshell-ai/melotts` with Chinese language output. Audio is generated on demand and cached at the edge, so the repository does not need to store MP3 binaries in Git.

## Cloudflare configuration

The Worker expects:

- D1 binding `DB` -> `global-discovery`
- Workers AI binding `AI`

`wrangler.toml` is the deployment source of truth. The production Git branch is `main`.

`src/entry.js` is the public entry point. It initializes semantic tables, exposes the episode/podcast routes, and starts the daily pipeline through Cloudflare background execution.

## Data model

The D1 core tables are:

- `sources`
- `articles`
- `stories`
- `article_stories`

The semantic/publishing layer also uses:

- `topics`
- `story_topics`
- `claims`
- `evidence`
- `editorials`
- `audio_assets`
- `feedback`
- `source_observations`
- `story_candidates`
- `collection_runs`
- `manual_collection_guard`
- `daily_pipeline_runs`

## Cost posture

The text model is Cloudflare-hosted and the current GLM-4.7-Flash model is listed as available on Workers AI Free. Workers AI also supports paid usage when free allocation is exceeded. The multilingual MeloTTS model is billed per generated audio minute. citeturn668235search5turn657627view0

No API keys are stored in the repository.
