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

const VERSION = "0.1.1";

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

async function ensureSource(db, source) {
  let row = await db
    .prepare("SELECT id FROM sources WHERE name = ? LIMIT 1")
    .bind(source.name)
    .first();

  if (!row) {
    await db
      .prepare(`
        INSERT INTO sources
          (name, base_url, feed_url, language, country, region, source_type,
           status, first_seen_at, last_seen_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `)
      .bind(
        source.name,
        source.base_url,
        source.feed_url,
        source.language,
        source.country,
        source.region,
        source.source_type
      )
      .run();

    row = await db
      .prepare("SELECT id FROM sources WHERE name = ? LIMIT 1")
      .bind(source.name)
      .first();
  } else {
    await db
      .prepare(
        "UPDATE sources SET feed_url = ?, last_seen_at = CURRENT_TIMESTAMP WHERE id = ?"
      )
      .bind(source.feed_url, row.id)
      .run();
  }

  if (!row) throw new Error(`Could not create source: ${source.name}`);
  return row.id;
}

async function collectRSS(db, source) {
  const response = await fetch(source.feed_url, {
    headers: {
      "User-Agent": "GlobalDiscoveryEngine/0.1"
    }
  });

  if (!response.ok) {
    throw new Error(`RSS ${response.status}: ${source.feed_url}`);
  }

  const xml = await response.text();
  const itemList = getItems(xml);
  const sourceId = await ensureSource(db, source);

  let inserted = 0;
  let skipped = 0;

  for (const item of itemList) {
    const title = getTag(item, "title");
    const url = getTag(item, "link") || getTag(item, "guid");
    const publishedAt = getTag(item, "pubDate") || getTag(item, "dc:date");
    const excerpt = getTag(item, "description");

    if (!title || !url) {
      skipped++;
      continue;
    }

    const result = await db
      .prepare(`
        INSERT OR IGNORE INTO articles
          (source_id, title, url, canonical_url, language, country,
           published_at, excerpt, processing_state)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'collected')
      `)
      .bind(
        sourceId,
        title,
        url,
        url,
        source.language,
        source.country,
        publishedAt || null,
        excerpt || null
      )
      .run();

    if ((result.meta?.changes ?? 0) > 0) inserted++;
    else skipped++;
  }

  return {
    source: source.name,
    ok: true,
    feed: source.feed_url,
    items_found: itemList.length,
    inserted,
    skipped
  };
}

async function collectAll(db) {
  const results = [];

  for (const source of RSS_SOURCES) {
    try {
      results.push(await collectRSS(db, source));
    } catch (error) {
      results.push({
        source: source.name,
        ok: false,
        error: String(error)
      });
    }
  }

  return results;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    try {
      if (url.pathname === "/") {
        const row = await env.DB
          .prepare("SELECT COUNT(*) AS count FROM articles")
          .first();

        return Response.json({
          name: "Global Discovery Engine",
          status: "online",
          version: VERSION,
          articles: Number(row?.count ?? 0),
          endpoints: ["/", "/health", "/db", "/collect"]
        });
      }

      if (url.pathname === "/health") {
        const row = await env.DB
          .prepare("SELECT COUNT(*) AS count FROM articles")
          .first();

        return Response.json({
          ok: true,
          version: VERSION,
          articles: Number(row?.count ?? 0)
        });
      }

      if (url.pathname === "/db") {
        const result = await env.DB
          .prepare(
            "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name"
          )
          .all();

        return Response.json(result.results);
      }

      if (url.pathname === "/collect") {
        const results = await collectAll(env.DB);
        return Response.json({ ok: true, version: VERSION, results });
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

  async scheduled(event, env, ctx) {
    ctx.waitUntil(collectAll(env.DB));
  }
};
