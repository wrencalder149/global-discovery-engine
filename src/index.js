const RSS_SOURCES = [
  {
    name: "BBC News - World",
    base_url: "https://www.bbc.com/news/world",
    feed_url: "https://feeds.bbci.co.uk/news/world/rss.xml",
    language: "en",
    country: "GB",
    region: "Europe",
    source_type: "news"
  },
  {
    name: "Al Jazeera",
    base_url: "https://www.aljazeera.com/",
    feed_url: "https://www.aljazeera.com/xml/rss/all.xml",
    language: "en",
    country: "QA",
    region: "Middle East",
    source_type: "news"
  },
  {
    name: "Deutsche Welle",
    base_url: "https://www.dw.com/",
    feed_url: "https://rss.dw.com/xml/rss-en-all",
    language: "en",
    country: "DE",
    region: "Europe",
    source_type: "news"
  },
  {
    name: "Euronews",
    base_url: "https://www.euronews.com/",
    feed_url: "https://www.euronews.com/rss",
    language: "en",
    country: "EU",
    region: "Europe",
    source_type: "news"
  },
  {
    name: "France 24",
    base_url: "https://www.france24.com/",
    feed_url: "https://www.france24.com/en/rss",
    language: "en",
    country: "FR",
    region: "Europe",
    source_type: "news"
  },
  {
    name: "The Guardian - World",
    base_url: "https://www.theguardian.com/world",
    feed_url: "https://www.theguardian.com/world/rss",
    language: "en",
    country: "GB",
    region: "Europe",
    source_type: "news"
  },
  {
    name: "New York Times - World",
    base_url: "https://www.nytimes.com/section/world",
    feed_url: "https://rss.nytimes.com/services/xml/rss/nyt/World.xml",
    language: "en",
    country: "US",
    region: "North America",
    source_type: "news"
  },
  {
    name: "Times of India - World",
    base_url: "https://timesofindia.indiatimes.com/world",
    feed_url: "https://timesofindia.indiatimes.com/rssfeeds/296589292.cms",
    language: "en",
    country: "IN",
    region: "Asia",
    source_type: "news"
  }
];

const GOOGLE_RADAR_SOURCES = [
  { name: "Google News Radar - geopolitics", query: "war OR conflict OR diplomacy OR sanctions OR geopolitics" },
  { name: "Google News Radar - economy", query: "economy OR inflation OR recession OR trade OR \"interest rates\"" },
  { name: "Google News Radar - science", query: "science OR research OR technology OR medicine OR space" },
  { name: "Google News Radar - environment", query: "climate OR biodiversity OR pollution OR wildfire OR drought" },
  { name: "Google News Radar - society", query: "migration OR education OR housing OR inequality OR protest" },
  { name: "Google News Radar - culture", query: "film OR music OR art OR design OR architecture OR literature" }
].map((item) => ({
  ...item,
  base_url: "https://news.google.com/",
  feed_url: `https://news.google.com/rss/search?q=${encodeURIComponent(item.query)}&hl=en-US&gl=US&ceid=US:en&when=1d`,
  language: "en",
  country: "multi",
  region: "global",
  source_type: "radar"
}));

const GDELT_QUERY = '(war OR conflict OR diplomacy OR sanctions OR geopolitics OR economy OR inflation OR recession OR trade OR science OR research OR technology OR medicine OR space OR climate OR biodiversity OR pollution OR wildfire OR drought OR migration OR education OR housing OR inequality OR protest OR film OR music OR art OR design OR architecture OR literature)';
const GDELT_MAX_RECORDS = 250;
const GDELT_TIMESPAN = "24h";
const MANUAL_COLLECTION_COOLDOWN_MS = 6 * 60 * 60 * 1000;
const BATCH_SIZE = 25;
const VERSION = "0.2.0";

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
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/\s+/g, " ")
    .trim();
}

function getTag(xml, name) {
  const escaped = name.replace(":", "\\:");
  const re = new RegExp(`<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)</${escaped}>`, "i");
  const match = xml.match(re);
  return match ? clean(match[1]) : "";
}

function getItems(xml) {
  return [...xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)].map((match) => match[1]);
}

function chunks(items, size) {
  const output = [];
  for (let i = 0; i < items.length; i += size) output.push(items.slice(i, i + size));
  return output;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function ensureRuntimeTables(db) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS collection_runs (
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
  )`).run();

  await db.prepare(`CREATE TABLE IF NOT EXISTS manual_collection_guard (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    last_started_at TEXT
  )`).run();
}

async function ensureSource(db, source) {
  let row = await db.prepare("SELECT id FROM sources WHERE name = ? LIMIT 1").bind(source.name).first();
  if (!row) {
    await db.prepare(`INSERT INTO sources
      (name, base_url, feed_url, language, country, region, source_type, status, first_seen_at, last_seen_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`)
      .bind(source.name, source.base_url, source.feed_url, source.language, source.country, source.region, source.source_type).run();
    row = await db.prepare("SELECT id FROM sources WHERE name = ? LIMIT 1").bind(source.name).first();
  } else {
    await db.prepare("UPDATE sources SET feed_url = ?, last_seen_at = CURRENT_TIMESTAMP WHERE id = ?")
      .bind(source.feed_url, row.id).run();
  }
  if (!row) throw new Error(`Could not create source: ${source.name}`);
  return row.id;
}

async function insertArticles(db, sourceId, items) {
  const statements = [];
  for (const item of items) {
    const title = clean(item.title);
    const url = clean(item.url || item.link || item.guid);
    if (!title || !url) continue;
    statements.push(db.prepare(`INSERT OR IGNORE INTO articles
      (source_id, title, url, canonical_url, language, country, published_at, excerpt, processing_state)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'collected')`)
      .bind(sourceId, title, url, url, item.language || null, item.country || null, item.published_at || null, item.excerpt || null));
  }
  let inserted = 0;
  for (const batch of chunks(statements, BATCH_SIZE)) {
    for (const result of await db.batch(batch)) inserted += result.meta?.changes ?? 0;
  }
  return { prepared: statements.length, inserted };
}

async function collectRSS(db, source) {
  const response = await fetch(source.feed_url, { headers: { "User-Agent": "GlobalDiscoveryEngine/0.2" } });
  if (!response.ok) throw new Error(`RSS ${response.status}: ${source.feed_url}`);
  const xml = await response.text();
  const rawItems = getItems(xml);
  const items = rawItems.map((item) => ({
    title: getTag(item, "title"),
    url: getTag(item, "link") || getTag(item, "guid"),
    published_at: getTag(item, "pubDate") || getTag(item, "dc:date"),
    excerpt: getTag(item, "description"),
    language: source.language,
    country: source.country
  }));
  const sourceId = await ensureSource(db, source);
  const result = await insertArticles(db, sourceId, items);
  return { items_found: rawItems.length, inserted: result.inserted };
}

async function collectGdelt(db) {
  const sourceId = await ensureSource(db, {
    name: "GDELT Global Radar",
    base_url: "https://www.gdeltproject.org/",
    feed_url: "https://api.gdeltproject.org/api/v2/doc/doc",
    language: "multi",
    country: null,
    region: "global",
    source_type: "aggregator"
  });

  const api = new URL("https://api.gdeltproject.org/api/v2/doc/doc");
  api.searchParams.set("query", GDELT_QUERY);
  api.searchParams.set("mode", "artlist");
  api.searchParams.set("format", "json");
  api.searchParams.set("maxrecords", String(GDELT_MAX_RECORDS));
  api.searchParams.set("timespan", GDELT_TIMESPAN);
  api.searchParams.set("sort", "datedesc");

  let response = await fetch(api, { headers: { "User-Agent": "GlobalDiscoveryEngine/0.2" } });
  if (response.status === 429) {
    const retryAfter = Number(response.headers.get("Retry-After"));
    await sleep(Math.min(Number.isFinite(retryAfter) ? retryAfter * 1000 : 5000, 15000));
    response = await fetch(api, { headers: { "User-Agent": "GlobalDiscoveryEngine/0.2" } });
  }
  if (!response.ok) throw new Error(`GDELT ${response.status}`);

  const data = await response.json();
  const articles = Array.isArray(data.articles) ? data.articles : [];
  const items = articles.map((article) => ({
    title: article.title,
    url: article.url,
    published_at: article.seendate || null,
    excerpt: article.domain ? `GDELT domain: ${article.domain}` : null,
    language: article.language || null,
    country: article.sourcecountry || null
  }));
  const result = await insertArticles(db, sourceId, items);
  return { items_found: articles.length, inserted: result.inserted };
}

async function runCollection(db, mode) {
  await ensureRuntimeTables(db);
  const run = await db.prepare("INSERT INTO collection_runs (mode) VALUES (?) RETURNING id").bind(mode).first();
  const runId = run.id;
  const errors = [];
  let rssItemsFound = 0;
  let rssInserted = 0;
  let gdeltItemsFound = 0;
  let gdeltInserted = 0;

  for (const source of [...RSS_SOURCES, ...GOOGLE_RADAR_SOURCES]) {
    try {
      const result = await collectRSS(db, source);
      rssItemsFound += result.items_found;
      rssInserted += result.inserted;
    } catch (error) {
      errors.push({ source: source.name, error: String(error) });
    }
  }

  try {
    const result = await collectGdelt(db);
    gdeltItemsFound = result.items_found;
    gdeltInserted = result.inserted;
  } catch (error) {
    errors.push({ source: "GDELT Global Radar", error: String(error) });
  }

  const status = errors.length === 0 ? "success" : "partial";
  await db.prepare(`UPDATE collection_runs
    SET finished_at = CURRENT_TIMESTAMP, status = ?, rss_items_found = ?, rss_inserted = ?,
        gdelt_items_found = ?, gdelt_inserted = ?, error_count = ?, error_json = ?
    WHERE id = ?`)
    .bind(status, rssItemsFound, rssInserted, gdeltItemsFound, gdeltInserted, errors.length, errors.length ? JSON.stringify(errors) : null, runId).run();

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
}

function statsResponse(db) {
  return Promise.all([
    db.prepare("SELECT COUNT(*) AS count FROM articles").first(),
    db.prepare("SELECT COUNT(*) AS count FROM sources").first(),
    db.prepare("SELECT * FROM collection_runs ORDER BY id DESC LIMIT 10").all()
  ]).then(([articles, sources, runs]) => Response.json({
    articles: Number(articles?.count ?? 0),
    sources: Number(sources?.count ?? 0),
    runs: runs.results
  }));
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
          env.DB.prepare("SELECT * FROM collection_runs ORDER BY id DESC LIMIT 1").first()
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
        const row = await env.DB.prepare("SELECT COUNT(*) AS count FROM articles").first();
        return Response.json({ ok: true, version: VERSION, articles: Number(row?.count ?? 0) });
      }

      if (url.pathname === "/stats") return statsResponse(env.DB);

      if (url.pathname === "/db") {
        const result = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all();
        return Response.json(result.results);
      }

      if (url.pathname === "/collect") {
        if (request.method !== "POST") return Response.json({ ok: false, error: "POST required" }, { status: 405, headers: { Allow: "POST" } });
        const guard = await env.DB.prepare("SELECT last_started_at FROM manual_collection_guard WHERE id = 1").first();
        if (guard?.last_started_at) {
          const last = Date.parse(`${guard.last_started_at.replace(" ", "T")}Z`);
          const elapsed = Date.now() - last;
          if (Number.isFinite(last) && elapsed < MANUAL_COLLECTION_COOLDOWN_MS) {
            return Response.json({ ok: false, error: "Manual collection is rate-limited", retry_after_seconds: Math.ceil((MANUAL_COLLECTION_COOLDOWN_MS - elapsed) / 1000) }, { status: 429 });
          }
        }
        await env.DB.prepare(`INSERT INTO manual_collection_guard (id, last_started_at)
          VALUES (1, CURRENT_TIMESTAMP) ON CONFLICT(id) DO UPDATE SET last_started_at = CURRENT_TIMESTAMP`).run();
        return Response.json({ ok: true, result: await runCollection(env.DB, "manual") });
      }

      return new Response("Not Found", { status: 404 });
    } catch (error) {
      console.error(error);
      return Response.json({ ok: false, error: String(error) }, { status: 500 });
    }
  },

  async scheduled(controller, env, ctx) {
    ctx.waitUntil(runCollection(env.DB, "scheduled"));
  }
};
