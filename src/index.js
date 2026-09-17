const SEED_SOURCES = [
  {
    name: "BBC World",
    url: "https://www.bbc.com/news/world",
    feed_url: "https://feeds.bbci.co.uk/news/world/rss.xml",
    language: "en",
    region: "global",
    source_type: "media"
  }
];

function text(value) {
  if (!value) return "";
  return String(value).replace(/<[^>]*>/g, " ").replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();
}

function tag(xml, name) {
  const re = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i");
  const m = xml.match(re);
  return m ? text(m[1]) : "";
}

function items(xml) {
  return [...xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)].map(m => m[1]);
}

function itemValue(item, name) {
  const re = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i");
  const m = item.match(re);
  return m ? text(m[1]) : "";
}

async function seed(db) {
  for (const s of SEED_SOURCES) {
    await db.prepare(`
      INSERT INTO sources (name,url,feed_url,language,region,source_type)
      VALUES (?,?,?,?,?,?)
      ON CONFLICT(name) DO UPDATE SET feed_url=excluded.feed_url, last_seen_at=CURRENT_TIMESTAMP
    `).bind(s.name,s.url,s.feed_url,s.language,s.region,s.source_type).run();
  }
}

async function collectRSS(db, source) {
  const response = await fetch(source.feed_url, { headers: { "User-Agent": "GlobalDiscoveryEngine/0.1" } });
  if (!response.ok) throw new Error(`RSS ${response.status}: ${source.feed_url}`);
  const xml = await response.text();
  const sourceRow = await db.prepare("SELECT id FROM sources WHERE name=?").bind(source.name).first();
  if (!sourceRow) throw new Error(`Source not found: ${source.name}`);

  let inserted = 0;
  for (const item of items(xml)) {
    const title = itemValue(item, "title");
    const url = itemValue(item, "link");
    const published = itemValue(item, "pubDate") || itemValue(item, "dc:date");
    const description = itemValue(item, "description");
    if (!title || !url) continue;
    const result = await db.prepare(`
      INSERT OR IGNORE INTO articles
      (source_id,url,canonical_url,title,language,published_at,excerpt,processing_state)
      VALUES (?,?,?,?,?,?,?,'COLLECTED')
    `).bind(sourceRow.id,url,url,title,source.language,published,description).run();
    inserted += result.meta.changes || 0;
  }
  return { feed: source.feed_url, items_found: items(xml).length, inserted };
}

async function collectAll(db) {
  await seed(db);
  const results = [];
  for (const source of SEED_SOURCES) {
    try { results.push({ source: source.name, ok: true, ...(await collectRSS(db, source)) }); }
    catch (error) { results.push({ source: source.name, ok: false, error: String(error) }); }
  }
  return results;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (url.pathname === "/") {
        return Response.json({
          name: "Global Discovery Engine",
          status: "online",
          version: "0.1",
          endpoints: ["/", "/health", "/db", "/collect"]
        });
      }

      if (url.pathname === "/health") {
        const row = await env.DB.prepare("SELECT COUNT(*) AS count FROM articles").first();
        return Response.json({ ok: true, articles: row.count });
      }

      if (url.pathname === "/db") {
        const result = await env.DB.prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`).all();
        return Response.json(result.results);
      }

      if (url.pathname === "/collect") {
        const results = await collectAll(env.DB);
        return Response.json({ ok: true, results });
      }

      return new Response("Not Found", { status: 404 });
    } catch (error) {
      console.error(error);
      return Response.json({ ok: false, error: String(error) }, { status: 500 });
    }
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(collectAll(env.DB));
  }
};
