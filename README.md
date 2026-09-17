# Global Discovery Engine

Cloud-native daily global information discovery system.

## Current stage

v0.1 establishes the cloud foundation:

- Cloudflare Worker
- Cloudflare D1 (`global-discovery`)
- RSS collection
- URL deduplication
- Source registry
- Article storage
- Daily Cron entry point

The first collector is BBC World RSS as a smoke test. GDELT, source discovery, story clustering, verification, translation, editorial, TTS and podcast delivery are intentionally staged after the ingestion path is stable.

## Cloudflare setup

The Worker expects a D1 binding named `DB` pointing to the `global-discovery` database.

`wrangler.toml` contains the D1 database ID and a daily 05:00 Asia/Taipei equivalent Cron schedule (21:00 UTC).

## Local files

- `src/index.js` — Worker and scheduled ingestion
- `schema.sql` — D1 schema
- `wrangler.toml` — Worker configuration
- `sources.json` — seed source registry
- `.gitignore` — local-only files

## Security

No API keys or account credentials belong in this repository. Use Cloudflare secrets/environment variables for credentials once paid or external APIs are introduced.
