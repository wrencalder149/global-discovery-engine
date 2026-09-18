function xmlEscape(value) {
  return String(value || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function slotLabel(mode) {
  if (mode === "briefing") return "今日簡報";
  if (mode === "feature") return "深度";
  if (mode === "culture") return "文化";
  return mode || "匯整";
}

function isDump(body) {
  const text = String(body || "");
  return text.indexOf("小篇 ") >= 0 || (text.split("http").length > 8 && text.length < 2500);
}

async function latestPacks(db) {
  const rows = await db.prepare(
    "SELECT id,mode,title,body,created_at FROM editorials WHERE mode IN ('briefing','feature','culture') ORDER BY id DESC LIMIT 30"
  ).all();
  const picked = {};
  for (const row of rows.results || []) {
    if (picked[row.mode]) continue;
    if (isDump(row.body)) continue;
    picked[row.mode] = row;
  }
  const ordered = ["briefing", "feature", "culture"].map((mode) => picked[mode]).filter(Boolean);
  if (ordered.length) return ordered;
  return (rows.results || []).slice(0, 3);
}

export async function episodeResponse(db, id) {
  if (id) {
    const editorial = await db.prepare("SELECT id,mode,language,title,body,created_at FROM editorials WHERE id = ? LIMIT 1").bind(Number(id)).first();
    if (!editorial) return Response.json({ ok: false, error: "No article yet" }, { status: 404 });
    return Response.json({ ok: true, editorial });
  }
  const articles = await latestPacks(db);
  if (!articles.length) return Response.json({ ok: false, error: "No article yet" }, { status: 404 });
  return Response.json({ ok: true, articles });
}

export async function podcastResponse(request, db) {
  const rows = await latestPacks(db);
  const origin = new URL(request.url).origin;
  const now = new Date().toUTCString();
  const items = rows.map((row) => {
    const date = row.created_at ? new Date(String(row.created_at).replace(" ", "T") + "Z").toUTCString() : now;
    const title = "【" + slotLabel(row.mode) + "】" + (row.title || "Global Discovery");
    return "\n<item>\n<title>" + xmlEscape(title) + "</title>\n<description>" + xmlEscape(row.body || "") + "</description>\n<pubDate>" + date + "</pubDate>\n<guid isPermaLink=\"false\">global-discovery-" + row.mode + "-" + row.id + "</guid>\n<link>" + origin + "/episode/" + row.id + "</link>\n</item>";
  }).join("\n");
  const xml = "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<rss version=\"2.0\">\n<channel>\n<title>Global Discovery</title>\n<description>每日三包繁體中文匯整：今日簡報、深度、文化</description>\n<link>" + origin + "/</link>\n<lastBuildDate>" + now + "</lastBuildDate>" + items + "\n</channel>\n</rss>";
  return new Response(xml, { headers: { "content-type": "application/rss+xml; charset=utf-8", "cache-control": "public, max-age=120" } });
}

export async function audioResponse() {
  return new Response("Audio postponed", { status: 501 });
}

export async function healthResponse(db) {
  const [pipeline, packs] = await Promise.all([
    db.prepare("SELECT * FROM daily_pipeline_runs ORDER BY id DESC LIMIT 5").all(),
    latestPacks(db)
  ]);
  return Response.json({ ok: true, packs: packs.map((row) => ({ id: row.id, mode: row.mode, title: row.title })), runs: pipeline.results });
}
