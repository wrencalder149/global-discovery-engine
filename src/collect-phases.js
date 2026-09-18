import { EXTRA_RSS_SOURCES, EXTRA_GOOGLE_RADARS } from "./source-catalog.js";
import { CULTURE_RSS_SOURCES, CULTURE_GOOGLE_RADARS } from "./culture-sources.js";

const NEWS_SOURCES = [
  { name: "BBC News - World", base_url: "https://www.bbc.com/news/world", feed_url: "https://feeds.bbci.co.uk/news/world/rss.xml", language: "en", country: "GB", region: "Europe", source_type: "news" },
  { name: "Al Jazeera", base_url: "https://www.aljazeera.com/", feed_url: "https://www.aljazeera.com/xml/rss/all.xml", language: "en", country: "QA", region: "Middle East", source_type: "news" },
  { name: "Deutsche Welle", base_url: "https://www.dw.com/", feed_url: "https://rss.dw.com/xml/rss-en-all", language: "en", country: "DE", region: "Europe", source_type: "news" },
  { name: "Euronews", base_url: "https://www.euronews.com/", feed_url: "https://www.euronews.com/rss", language: "en", country: "EU", region: "Europe", source_type: "news" },
  { name: "France 24", base_url: "https://www.france24.com/", feed_url: "https://www.france24.com/en/rss", language: "en", country: "FR", region: "Europe", source_type: "news" },
  { name: "The Guardian - World", base_url: "https://www.theguardian.com/world", feed_url: "https://www.theguardian.com/world/rss", language: "en", country: "GB", region: "Europe", source_type: "news" },
  { name: "New York Times - World", base_url: "https://www.nytimes.com/section/world", feed_url: "https://rss.nytimes.com/services/xml/rss/nyt/World.xml", language: "en", country: "US", region: "North America", source_type: "news" },
  { name: "Times of India - World", base_url: "https://timesofindia.indiatimes.com/world", feed_url: "https://timesofindia.indiatimes.com/rssfeeds/296589292.cms", language: "en", country: "IN", region: "Asia", source_type: "news" }
];

const RADARS = [
  { name: "Google News Radar - geopolitics", query: "war OR conflict OR diplomacy OR sanctions OR geopolitics" },
  { name: "Google News Radar - economy", query: "economy OR inflation OR recession OR trade OR interest rates" },
  { name: "Google News Radar - science", query: "science OR research OR technology OR medicine OR space" },
  { name: "Google News Radar - environment", query: "climate OR biodiversity OR pollution OR wildfire OR drought" },
  { name: "Google News Radar - society", query: "migration OR education OR housing OR inequality OR protest" },
  { name: "Google News Radar - culture", query: "film OR music OR art OR design OR architecture OR literature" },
  ...EXTRA_GOOGLE_RADARS,
  ...CULTURE_GOOGLE_RADARS
].map((item) => ({
  ...item,
  base_url: "https://news.google.com/",
  feed_url: `https://news.google.com/rss/search?q=${encodeURIComponent(item.query)}&hl=en-US&gl=US&ceid=US:en&when=1d`,
  language: "en",
  country: "multi",
  region: "global",
  source_type: "radar"
}));

const EXTRA_FETCH_CAP = 12;
const RADAR_FETCH_CAP = 4;
const BATCH_SIZE = 25;

function clean(value) {
  if (!value) return "";
  return String(value).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, " ").trim();
}

function getTag(xml, name) {
  const escaped = name.replace(":", "\\:");
  const match = xml.match(new RegExp(`<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)</${escaped}>`, "i"));
  return match ? clean(match[1]) : "";
}

function getItems(xml) {
  return [...xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)].map((match) => match[1]);
}

function rotate(list, offset, limit) {
  if (!list.length || limit <= 0) return [];
  const start = Math.abs(offset) % list.length;
  return [...list.slice(start), ...list.slice(0, start)].slice(0, limit);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function ensureSource(db, source) {
  let row = await db.prepare("SELECT id FROM sources WHERE name = ? LIMIT 1").bind(source.name).first();
  if (!row) {
    await db.prepare(`INSERT INTO sources (name, base_url, feed_url, language, country, region, source_type, status, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`)
      .bind(source.name, source.base_url, source.feed_url, source.language, source.country, source.region, source.source_type).run();
    row = await db.prepare("SELECT id FROM sources WHERE name = ? LIMIT 1").bind(source.name).first();
  }
  return row.id;
}

async function insertArticles(db, sourceId, items) {
  const statements = [];
  for (const item of items) {
    const title = clean(item.title);
    const url = clean(item.url || item.link || item.guid);
    if (!title || !url) continue;
    statements.push(db.prepare(`INSERT OR IGNORE INTO articles (source_id, title, url, canonical_url, language, country, published_at, excerpt, processing_state) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'collected')`)
      .bind(sourceId, title, url, url, item.language || null, item.country || null, item.published_at || null, item.excerpt || null));
  }
  let inserted = 0;
  for (let i = 0; i < statements.length; i += BATCH_SIZE) {
    for (const result of await db.batch(statements.slice(i, i + BATCH_SIZE))) inserted += result.meta?.changes ?? 0;
  }
  return { inserted };
}

async function collectRSS(db, source) {
  const response = await fetch(source.feed_url, { headers: { "User-Agent": "GlobalDiscoveryEngine/0.5" } });
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
  return { items_found: rawItems.length, inserted: (await insertArticles(db, await ensureSource(db, source), items)).inserted };
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
  api.searchParams.set("query", "(diplomacy OR research OR cinema OR literature OR music OR archaeology OR climate OR technology)");
  api.searchParams.set("mode", "artlist");
  api.searchParams.set("format", "json");
  api.searchParams.set("maxrecords", "80");
  api.searchParams.set("timespan", "24h");
  api.searchParams.set("sort", "datedesc");
  let response = await fetch(api, { headers: { "User-Agent": "GlobalDiscoveryEngine/0.5" } });
  if (response.status === 429) {
    await sleep(5000);
    response = await fetch(api, { headers: { "User-Agent": "GlobalDiscoveryEngine/0.5" } });
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
  return { items_found: articles.length, inserted: (await insertArticles(db, sourceId, items)).inserted };
}

async function sourcesForPhase(db, phase) {
  const totalRow = await db.prepare("SELECT COUNT(*) AS n FROM collection_runs").first();
  const n = Number(totalRow?.n || 0);
  if (phase === "news") return NEWS_SOURCES;
  if (phase === "culture") return CULTURE_RSS_SOURCES;
  if (phase === "rotate") return [...rotate(RADARS, n * 3, RADAR_FETCH_CAP), ...rotate(EXTRA_RSS_SOURCES, n * 7, EXTRA_FETCH_CAP)];
  return [];
}

export async function runCollectionPhase(db, mode, phase) {
  const run = await db.prepare("INSERT INTO collection_runs (mode) VALUES (?) RETURNING id").bind(`${mode}:${phase}`).first();
  const errors = [];
  let rss_items_found = 0;
  let rss_inserted = 0;
  let gdelt_items_found = 0;
  let gdelt_inserted = 0;
  let source_count = 0;

  try {
    if (phase === "gdelt") {
      const result = await collectGdelt(db);
      gdelt_items_found = result.items_found;
      gdelt_inserted = result.inserted;
    } else {
      const sources = await sourcesForPhase(db, phase);
      source_count = sources.length;
      for (const source of sources) {
        try {
          const result = await collectRSS(db, source);
          rss_items_found += result.items_found;
          rss_inserted += result.inserted;
        } catch (error) {
          errors.push({ source: source.name, error: String(error) });
        }
      }
    }
  } catch (error) {
    errors.push({ source: phase, error: String(error) });
  }

  const status = errors.length === 0 ? "success" : "partial";
  await db.prepare(`UPDATE collection_runs SET finished_at=CURRENT_TIMESTAMP, status=?, rss_items_found=?, rss_inserted=?, gdelt_items_found=?, gdelt_inserted=?, error_count=?, error_json=? WHERE id=?`)
    .bind(status, rss_items_found, rss_inserted, gdelt_items_found, gdelt_inserted, errors.length, errors.length ? JSON.stringify(errors) : null, run.id).run();

  return { run_id: run.id, mode: `${mode}:${phase}`, phase, status, rss_inserted, gdelt_inserted, source_count, errors };
}
