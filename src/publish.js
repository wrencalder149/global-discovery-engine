const TTS_MODEL = "@cf/myshell-ai/melotts";
const ARTICLE_MODES = ["briefing", "feature", "culture"];

function cleanText(value) {
  return String(value || "").replace(/\u0000/g, "").replace(/\s+/g, " ").trim();
}

function xmlEscape(value) {
  return String(value || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function slotLabel(mode) {
  if (mode === "briefing") return "今日簡報";
  if (mode === "feature") return "深度";
  if (mode === "culture") return "文化";
  return mode || "文章";
}

async function latestArticles(db, limit = 30) {
  const rows = await db.prepare(
    "SELECT id,mode,title,body,created_at FROM editorials WHERE mode IN ('briefing','feature','culture') ORDER BY id DESC LIMIT ?"
  ).bind(limit).all();
  if (rows.results && rows.results.length) return rows.results;
  const fallback = await db.prepare(
    "SELECT id,mode,title,body,created_at FROM editorials WHERE mode='episode' ORDER BY id DESC LIMIT 10"
  ).all();
  return fallback.results || [];
}

export async function episodeResponse(db, id) {
  if (id) {
    const editorial = await db.prepare("SELECT id,mode,language,title,body,created_at FROM editorials WHERE id = ? LIMIT 1").bind(Number(id)).first();
    if (!editorial) return Response.json({ ok: false, error: "No article yet" }, { status: 404 });
    return Response.json({ ok: true, editorial });
  }
  const articles = await latestArticles(db, 3);
  if (!articles.length) return Response.json({ ok: false, error: "No article yet" }, { status: 404 });
  return Response.json({ ok: true, articles });
}

export async function podcastResponse(request, db) {
  const rows = await latestArticles(db, 30);
  const origin = new URL(request.url).origin;
  const now = new Date().toUTCString();
  const items = rows.map((row) => {
    const date = row.created_at ? new Date(row.created_at.replace(" ", "T") + "Z").toUTCString() : now;
    const title = "【" + slotLabel(row.mode) + "】" + (row.title || "Global Discovery");
    return "\n<item>\n<title>" + xmlEscape(title) + "</title>\n<description>" + xmlEscape(row.body || "") + "</description>\n<pubDate>" + date + "</pubDate>\n<guid isPermaLink=\"false\">global-discovery-" + row.mode + "-" + row.id + "</guid>\n<link>" + origin + "/episode/" + row.id + "</link>\n</item>";
  }).join("\n");

  const xml = "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<rss version=\"2.0\">\n<channel>\n<title>Global Discovery</title>\n<description>每日三篇繁體中文：今日簡報、深度長文、文化音樂影視設計</description>\n<link>" + origin + "/</link>\n<lastBuildDate>" + now + "</lastBuildDate>" + items + "\n</channel>\n</rss>";
  return new Response(xml, { headers: { "content-type": "application/rss+xml; charset=utf-8", "cache-control": "public, max-age=300" } });
}

export async function audioResponse(request, env, editorialId) {
  const editorial = await env.DB.prepare("SELECT id,title,body FROM editorials WHERE id=? LIMIT 1").bind(Number(editorialId)).first();
  if (!editorial) return new Response("Article not found", { status: 404 });
  if (!env.AI) return new Response("Workers AI binding unavailable", { status: 503 });
  const url = new URL(request.url);
  const cacheKey = new Request(url.origin + "/audio/" + editorial.id, { method: "GET" });
  const cache = caches.default;
  const cached = await cache.match(cacheKey);
  if (cached) return cached;
  const script = cleanText(editorial.body).slice(0, 4000);
  const audio = await env.AI.run(TTS_MODEL, { prompt: script, lang: "zh" });
  let bytes = null;
  if (audio instanceof ArrayBuffer) bytes = new Uint8Array(audio);
  else if (audio instanceof Uint8Array) bytes = audio;
  else if (audio?.audio instanceof ArrayBuffer) bytes = new Uint8Array(audio.audio);
  else if (audio?.audio instanceof Uint8Array) bytes = audio.audio;
  if (!bytes) return new Response("TTS generation failed", { status: 502 });
  const output = new Response(bytes, { headers: { "content-type": "audio/mpeg", "cache-control": "public, max-age=86400" } });
  await cache.put(cacheKey, output.clone());
  return output;
}

export async function healthResponse(db) {
  const [pipeline, articles] = await Promise.all([
    db.prepare("SELECT * FROM daily_pipeline_runs ORDER BY id DESC LIMIT 5").all(),
    db.prepare("SELECT COUNT(*) AS count FROM editorials WHERE mode IN ('briefing','feature','culture','episode')").first()
  ]);
  return Response.json({ ok: true, articles: Number(articles?.count || 0), runs: pipeline.results });
}
