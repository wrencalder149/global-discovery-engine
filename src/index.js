const RSS_SOURCES = [
  {
    name: "BBC News - World",
    base_url: "https://www.bbc.com/news/world",
    feed_url: "https://feeds.bbci.co.uk/news/world/rss.xml",
    language: "en",
    country: "GB",
    region: "Europe",
    source_type: "news"
  }
];

const GDELT_QUERIES = [
  { name: "geopolitics", query: '(war OR conflict OR diplomacy OR sanctions OR "foreign policy")' },
  { name: "economy", query: '(economy OR inflation OR recession OR trade OR "interest rates")' },
  { name: "science", query: '(science OR research OR technology OR medicine OR space)' },
  { name: "environment", query: '(climate OR biodiversity OR pollution OR wildfire OR drought)' },
  { name: "society", query: '(migration OR education OR housing OR inequality OR protest)' },
  { name: "culture", query: '(film OR music OR art OR design OR architecture OR literature)' }
];

const GDELT_MAX_RECORDS = 25;
const GDELT_TIMESPAN = "24h";
const MANUAL_COLLECTION_COOLDOWN_MS = 6 * 60 * 60 * 1000;
const BATCH_SIZE = 25;
const VERSION = "0.1.3";

function clean(value) {
  if (!value) return "";
  return String(value)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function getTag(xml, name) {
  const escaped = name.replace(":", "\\:");
  const re = new RegExp(
    `<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)</${escaped}>`,
    "i"
  );
  const match = xml.match(re);
  return match ? clean(match[1]) : "";
}

function getItems(xml) {
  return [...xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)]
    .map((match) => match[1]);
}

function chunks(items, size) {
  const output = [];
  for (let i = 0; i < items.length; i += size) {
    output.push(items.slice(i, i + size));
  }
  return output;
}

async function ensureRuntimeTables(db) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS collection_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mode TEXT NOT NULL,
      started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      finished_at TEXT,
      status TEXT NOT NULL DEFAULT 'running',
      rss_items_found INTEGER DEFAULT 0,
      rss_inserted INTEGER DEFAULT 0,
      gdelt_items_found INTEGER DEFAULT 0,
      gdelt_inserted INTEGER DEFAULT 0,
      error_count INTEGER DEFAULT 0,
      error_json TEXT
    )
  `).run();

  await db.prepare(`
    CREATE TABLE IF NOT EXISTS manual_collection_guard (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      last_started_at TEXT
    )
  `).run();
}

async function ensureSource(db, source) {
  let row = await db
    .prepare("SELECT id FROM sources WHERE name = ? LIMIT 1")
    .bind(source.name)
    .first();

  if (!row) {
    await db.prepare(`
      INSERT INTO sources
        (name, base_url, feed_url, language, country, region, source_type,
         status, first_seen_at, last_seen_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `).bind(
      source.name,
      source.base_url,
      source.feed_url,
      source.language,
      source.country,
      source.region,
      source.source_type
    ).run();

    row = await db
      .prepare("SELECT id FROM sources WHERE name = ? LIMIT 1")
      .bind(source.name)
      .first();
  } else {
    await db.prepare(
      "UPDATE sources SET feed_url = ?, last_seen_at = CURRENT_TIMESTAMP WHERE id = ?"
    ).bind(source.feed_url, row.id).run();
  }

  if (!row) throw new Error(`Could not create source: ${source.name}`);
  return row.id;
}

async function ensureGdeltSource(db) {
  const name = "GDELT Global Radar";

  let row = await db
    .prepare("SELECT id FROM sources WHERE name = ? LIMIT 1")
    .bind(name)
    .first();

  if (!row) {
    await db.prepare(`
      INSERT INTO sources
        (name, base_url, language, country, region, source_type,
         status, first_seen_at, last_seen_at)
      VALUES (?, ?, ?, ?, ?, 'aggregator',
              'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `).bind(
      name,
      "https://www.gdeltproject.org/",
      "multi",
      null,
      "global"
    ).run();

    row = await db
      .prepare("SELECT id FROM sources WHERE name = ? LIMIT 1")
      .bind(name)
      .first();
  }

  if (!row) throw new Error("Could not create GDELT source");
  return row.id;
}

async function collectRSS(db, source) {
  const response = await fetch(source.feed_url, {
    headers: { "User-Agent": "GlobalDiscoveryEngine/0.1" }
  });

  if (!response.ok) {
    throw new Error(`RSS ${response.status}: ${source.feed_url}`);
  }

  const xml = await response.text();
  const itemList = getItems(xml);
  const sourceId = await ensureSource(db, source);

  let inserted = 0;
  let skipped = 0;
  const statements = [];

  for (const item of itemList) {
    const title = getTag(item, "title");
    const url = getTag(item, "link") || getTag(item, "guid");
    const publishedAt = getTag(item, "pubDate") || getTag(item, "dc:date");
    const excerpt = getTag(item, "description");

    if (!title || !url) {
      skipped++;
      continue;
    }

    statements.push(
      db.prepare(`
        INSERT OR IGNORE INTO articles
          (source_id, title, url, canonical_url, language, country,
           published_at, excerpt, processing_state)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'collected')
      `).bind(
        sourceId,
        title,
        url,
        url,
        source.language,
        source.country,
        publishedAt || null,
        excerpt || null
      )
    );
  }

  for (const batch of chunks(statements, BATCH_SIZE)) {
    const results = await db.batch(batch);
    for (const result of results) {
      inserted += result.meta?.changes ?? 0;
    }
  }

  skipped += statements.length - inserted;

  return {
    items_found: itemList.length,
    inserted,
    skipped
  };
}

async function collectGdelt(db) {
  const results = [];
  const sourceId = await ensureGdeltSource(db);

  for (const spec of GDELT_QUERIES) {
    const api = new URL("https://api.gdeltproject.org/api/v2/doc/doc");
    api.searchParams.set("query", spec.query);
    api.searchParams.set("mode", "artlist");
    api.searchParams.set("format", "json");
    api.searchParams.set("maxrecords", String(GDELT_MAX_RECORDS));
    api.searchParams.set("timespan", GDELT_TIMESPAN);
    api.searchParams.set("sort", "datedesc");

    try {
      const response = await fetch(api, {
        headers: { "User-Agent": "GlobalDiscoveryEngine/0.1" }
      });

      if (!response.ok) {
        throw new Error(`GDELT ${response.status}`);
      }

      const data = await response.json();
      const articles = Array.isArray(data.articles) ? data.articles : [];
      const statements = [];

      for (const article of articles) {
        const url = article.url || "";
        const title = clean(article.title || "");

        if (!url || !title) continue;

        statements.push(
          db.prepare(`
            INSERT OR IGNORE INTO articles
              (source_id, title, url, canonical_url, language, country,
               published_at, excerpt, processing_state)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'collected')
          `).bind(
            sourceId,
            title,
            url,
            url,
            article.language || null,
            article.sourcecountry || null,
            article.seendate || null,
            article.domain ? `GDELT domain: ${article.domain}` : null
          )
        );
      }

      let inserted = 0;
      for (const batch of chunks(statements, BATCH_SIZE)) {
        const batchResults = await db.batch(batch);
        for (const result of batchResults) {
          inserted += result.meta?.changes ?? 0;
        }
      }

      results.push({
        topic: spec.name,
        ok: true,
        items_found: articles.length,
        prepared: statements.length,
        inserted
      });
    } catch (error) {
      results.push({
        topic: spec.name,
        ok: false,
        error: String(error)
      });
    }
  }

  return results;
}

async function runCollection(db, mode) {
  await ensureRuntimeTables(db);

  const run = await db.prepare(
    "INSERT INTO collection_runs (mode) VALUES (?) RETURNING id"
  ).bind(mode).first();

  const runId = run.id;
  const errors = [];
  let rssItemsFound = 0;
  let rssInserted = 0;
  let gdeltItemsFound = 0;
  let gdeltInserted = 0;

  try {
    for (const source of RSS_SOURCES) {
      try {
        const result = await collectRSS(db, source);
        rssItemsFound += result.items_found;
        rssInserted += result.inserted;
      } catch (error) {
        errors.push({ source: source.name, error: String(error) });
      }
    }

    const gdeltResults = await collectGdelt(db);

    for (const result of gdeltResults) {
      gdeltItemsFound += result.items_found || 0;
      gdeltInserted += result.inserted || 0;
      if (!result.ok) errors.push(result);
    }

    const status = errors.length === 0 ? "success" : "partial";

    await db.prepare(`
      UPDATE collection_runs
      SET finished_at = CURRENT_TIMESTAMP,
          status = ?,
          rss_items_found = ?,
          rss_inserted = ?,
          gdelt_items_found = ?,
          gdelt_inserted = ?,
          error_count = ?,
          error_json = ?
      WHERE id = ?
    `).bind(
      status,
      rssItemsFound,
      rssInserted,
      gdeltItemsFound,
      gdeltInserted,
      errors.length,
      errors.length ? JSON.stringify(errors) : null,
      runId
    ).run();

    return {
      run_id: runId,
      mode,
      status,
      rss_items_found: rssItemsFound,
      rss_inserted: rssInserted,
      gdelt_items_found: gdeltItemsFound,
      gdelt_inserted: gdeltInserted,
      errors
    };
  } catch (error) {
    errors.push({ stage: "collection", error: String(error) });

    await db.prepare(`
      UPDATE collection_runs
      SET finished_at = CURRENT_TIMESTAMP,
          status = 'failed',
          error_count = ?,
          error_json = ?
      WHERE id = ?
    `).bind(
      errors.length,
      JSON.stringify(errors),
      runId
    ).run();

    throw error;
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    try {
      await ensureRuntimeTables(env.DB);

      if (url.pathname === "/") {
        const [articleRow, sourceRow, runRow] = await Promise.all([
          env.DB.prepare("SELECT COUNT(*) AS count FROM articles").first(),
          env.DB.prepare("SELECT COUNT(*) AS count FROM sources").first(),
          env.DB.prepare(
            "SELECT * FROM collection_runs ORDER BY id DESC LIMIT 1"
          ).first()
        ]);

        return Response.json({
          name: "Global Discovery Engine",
          status: "online",
          version: VERSION,
          articles: Number(articleRow?.count ?? 0),
          sources: Number(sourceRow?.count ?? 0),
          last_collection: runRow || null,
          endpoints: ["/", "/health", "/db", "/stats", "/collect"]
        });
      }

      if (url.pathname === "/health") {
        const row = await env.DB.prepare(
          "SELECT COUNT(*) AS count FROM articles"
        ).first();

        return Response.json({
          ok: true,
          version: VERSION,
          articles: Number(row?.count ?? 0)
        });
      }

      if (url.pathname === "/stats") {
        const [articles, sources, runs] = await Promise.all([
          env.DB.prepare("SELECT COUNT(*) AS count FROM articles").first(),
          env.DB.prepare("SELECT COUNT(*) AS count FROM sources").first(),
          env.DB.prepare(
            "SELECT * FROM collection_runs ORDER BY id DESC LIMIT 10"
          ).all()
        ]);

        return Response.json({
          articles: Number(articles?.count ?? 0),
          sources: Number(sources?.count ?? 0),
          runs: runs.results
        });
      }

      if (url.pathname === "/db") {
        const result = await env.DB.prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name"
        ).all();

        return Response.json(result.results);
      }

      if (url.pathname === "/collect") {
        if (request.method !== "POST") {
          return Response.json(
            { ok: false, error: "POST required" },
            { status: 405, headers: { Allow: "POST" } }
          );
        }

        const guard = await env.DB.prepare(
          "SELECT last_started_at FROM manual_collection_guard WHERE id = 1"
        ).first();

        if (guard?.last_started_at) {
          const last = Date.parse(
            `${guard.last_started_at.replace(" ", "T")}Z`
          );
          const elapsed = Date.now() - last;

          if (Number.isFinite(last) && elapsed < MANUAL_COLLECTION_COOLDOWN_MS) {
            return Response.json(
              {
                ok: false,
                error: "Manual collection is rate-limited",
                retry_after_seconds: Math.ceil(
                  (MANUAL_COLLECTION_COOLDOWN_MS - elapsed) / 1000
                )
              },
              { status: 429 }
            );
          }
        }

        await env.DB.prepare(`
          INSERT INTO manual_collection_guard (id, last_started_at)
          VALUES (1, CURRENT_TIMESTAMP)
          ON CONFLICT(id) DO UPDATE SET last_started_at = CURRENT_TIMESTAMP
        `).run();

        const result = await runCollection(env.DB, "manual");
        return Response.json({ ok: true, result });
      }

      return new Response("Not Found", { status: 404 });
    } catch (error) {
      console.error(error);
      return Response.json(
        { ok: false, error: String(error) },
        { status: 500 }
      );
    }
  },

  async scheduled(controller, env, ctx) {
    ctx.waitUntil(runCollection(env.DB, "scheduled"));
  }
};
