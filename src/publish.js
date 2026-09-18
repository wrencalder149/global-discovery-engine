const TTS_MODEL = "@cf/myshell-ai/melotts";

function cleanText(value) {
  return String(value || "")
    .replace(/\u0000/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function xmlEscape(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export async function episodeResponse(db, id) {
  let editorial;
  if (id) {
    editorial = await db.prepare("SELECT id,mode,language,title,body,created_at FROM editorials WHERE id = ? LIMIT 1").bind(Number(id)).first();
  } else {
    editorial = await db.prepare("SELECT id,mode,language,title,body,created_at FROM editorials WHERE mode='episode' ORDER BY id DESC LIMIT 1").first();
  }
  if (!editorial) return Response.json({ ok: false, error: "No episode yet" }, { status: 404 });
  return Response.json({ ok: true, editorial });
}

export async function podcastResponse(request, db) {
  const rows = await db.prepare("SELECT id,title,body,created_at FROM editorials WHERE mode='episode' ORDER BY id DESC LIMIT 10").all();
  const origin = new URL(request.url).origin;
  const now = new Date().toUTCString();
  const items = rows.results.map((row) => {
    const date = row.created_at ? new Date(row.created_at.replace(" ", "T") + "Z").toUTCString() : now;
    return `\n<item>\n<title>${xmlEscape(row.title || "Global Discovery")}</title>\n<description>${xmlEscape((row.body || "").slice(0, 4000))}</description>\n<pubDate>${date}</pubDate>\n<guid isPermaLink="false">global-discovery-episode-${row.id}</guid>\n<enclosure url="${origin}/audio/${row.id}" type="audio/mpeg" />\n<link>${origin}/episode/${row.id}</link>\n</item>`;
  }).join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0">\n<channel>\n<title>Global Discovery Engine</title>\n<description>Global information discovery in Traditional Chinese</description>\n<link>${origin}/</link>\n<lastBuildDate>${now}</lastBuildDate>${items}\n</channel>\n</rss>`;
  return new Response(xml, { headers: { "content-type": "application/rss+xml; charset=utf-8", "cache-control": "public, max-age=300" } });
}

export async function audioResponse(request, env, editorialId) {
  const editorial = await env.DB.prepare("SELECT id,title,body FROM editorials WHERE id=? AND mode='episode' LIMIT 1").bind(Number(editorialId)).first();
  if (!editorial) return new Response("Episode not found", { status: 404 });
  if (!env.AI) return new Response("Workers AI binding unavailable", { status: 503 });

  const url = new URL(request.url);
  const cacheKey = new Request(`${url.origin}/audio/${editorial.id}`, { method: "GET" });
  const cache = caches.default;
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  const script = cleanText(editorial.body).slice(0, 8000);
  const chunks = [];
  let remaining = script;
  while (remaining.length) {
    let cut = Math.min(500, remaining.length);
    if (cut < remaining.length) {
      const window = remaining.slice(0, cut);
      const punct = Math.max(window.lastIndexOf("。"), window.lastIndexOf("！"), window.lastIndexOf("？"), window.lastIndexOf("\n"), window.lastIndexOf("，"));
      if (punct > 80) cut = punct + 1;
    }
    chunks.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut);
    if (chunks.length >= 8) break;
  }

  const parts = [];
  for (const chunk of chunks.filter(Boolean)) {
    const audio = await env.AI.run(TTS_MODEL, { prompt: chunk, lang: "zh" });
    let bytes = null;
    if (audio instanceof ArrayBuffer) bytes = new Uint8Array(audio);
    else if (audio instanceof Uint8Array) bytes = audio;
    else if (audio?.audio instanceof ArrayBuffer) bytes = new Uint8Array(audio.audio);
    else if (audio?.audio instanceof Uint8Array) bytes = audio.audio;
    else if (typeof audio === "string") {
      try { bytes = Uint8Array.from(atob(audio), (c) => c.charCodeAt(0)); } catch (_) {}
    }
    if (bytes) parts.push(bytes);
  }
  if (!parts.length) return new Response("TTS generation failed", { status: 502 });

  let total = 0;
  for (const part of parts) total += part.byteLength;
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    merged.set(part, offset);
    offset += part.byteLength;
  }
  const response = new Response(merged);

  const output = new Response(response.body, {
    status: response.status,
    headers: {
      "content-type": "audio/mpeg",
      "cache-control": "public, max-age=86400"
    }
  });
  await cache.put(cacheKey, output.clone());
  return output;
}

export async function healthResponse(db) {
  const [pipeline, episodes] = await Promise.all([
    db.prepare("SELECT * FROM daily_pipeline_runs ORDER BY id DESC LIMIT 5").all(),
    db.prepare("SELECT COUNT(*) AS count FROM editorials WHERE mode='episode'").first()
  ]);
  return Response.json({ ok: true, episodes: Number(episodes?.count || 0), runs: pipeline.results });
}
