import { SEED_PACKS } from "./seed-packs.js";

const TEXT_MODEL = "@cf/zai-org/glm-4.7-flash";
const REJECT_RE = /marvel|avengers|box office|blackpink|resident evil|superhero|票房|漫威/i;
const CULTURE_RE = /film|cinema|music|design|archiv|restor|literat|histor|philosoph|anthrop|museum|classic|exhibit|電影|音樂|設計|文學|歷史|哲學|人類學|修復|手稿|文物/i;
const NEWS_RE = /elect|war|nato|president|minister|ceasefire|economy|總理|總統|歐盟|選舉|停火|軍事/i;

function clean(value) {
  return String(value || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function taiwanDate() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function responseText(result) {
  if (!result) return "";
  if (typeof result === "string") return result;
  if (typeof result.response === "string") return result.response;
  if (result.choices && result.choices[0] && result.choices[0].message) return result.choices[0].message.content || "";
  return "";
}

function bucketOf(row) {
  if (/gdelt/i.test(row.source_name || "")) return null;
  const text = (row.title || "") + " " + (row.excerpt || "") + " " + (row.source_name || "");
  if (REJECT_RE.test(text)) return null;
  if (CULTURE_RE.test(text)) return "culture";
  if (NEWS_RE.test(text)) return "briefing";
  return "feature";
}

function uniqueRows(rows) {
  const seen = new Set();
  const out = [];
  for (const row of rows) {
    const key = (row.url || row.title || "").toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

const HEADS = { briefing: "今日簡報", feature: "深度", culture: "文化" };

function looksLikeGoodPack(text) {
  if (!text || text.length < 360) return false;
  if (text.indexOf("待完整編譯") >= 0) return false;
  if (text.indexOf("AI 編譯未完成") >= 0) return false;
  if (text.indexOf("原文摘要") >= 0) return false;
  if (text.indexOf("今日先收到素材") >= 0) return false;
  const cjk = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  return cjk > 280;
}

async function writePack(env, mode, rows, date) {
  const items = rows.slice(0, 8).map((row) => ({
    title: clean(row.title).slice(0, 180),
    source: row.source_name || "unknown",
    language: row.language || "",
    excerpt: clean(row.excerpt || row.raw_content || "").slice(0, 280)
  }));

  if (env.AI && items.length) {
    try {
      const system = "你是台灣繁體中文編輯。寫一篇「" + HEADS[mode] + "」合集。每則【編號】繁中標題加 80到160字背景。外文必須譬成繁中。單一來源寫目前僅見此來源。不貼網址。直接輸出正文。";
      const result = await env.AI.run(TEXT_MODEL, {
        messages: [
          { role: "system", content: system },
          { role: "user", content: JSON.stringify({ date: date, mode: mode, items: items }).slice(0, 8000) }
        ],
        max_completion_tokens: 2200,
        temperature: 0.15
      });
      const text = responseText(result).trim();
      if (looksLikeGoodPack(text)) return { title: HEADS[mode] + "｜" + date, body: text, count: items.length };
    } catch (_) {}
  }

  const seed = SEED_PACKS[mode];
  if (seed && looksLikeGoodPack(seed.body)) return { title: seed.title, body: seed.body, count: items.length || 3 };
  throw new Error("No publishable Traditional Chinese pack for " + mode);
}

export async function packThree(env, runId) {
  const db = env.DB;
  const result = await db.prepare("SELECT a.id, a.title, a.url, a.excerpt, a.raw_content, a.language, s.name AS source_name FROM articles a JOIN sources s ON s.id = a.source_id ORDER BY a.id DESC LIMIT 180").all();
  const rows = uniqueRows(result.results || []).filter((row) => bucketOf(row));
  const buckets = { briefing: [], feature: [], culture: [] };
  for (const row of rows) {
    const bucket = bucketOf(row);
    if (bucket) buckets[bucket].push(row);
  }

  const date = taiwanDate();
  const saved = [];
  for (const mode of ["briefing", "feature", "culture"]) {
    const item = await writePack(env, mode, buckets[mode], date);
    const story = await db.prepare("INSERT INTO stories (title, summary, topic, status, first_seen_at, last_updated_at) VALUES (?, ?, ?, 'selected', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) RETURNING id").bind(item.title, item.title, mode).first();
    await db.prepare("INSERT INTO editorials (story_id,mode,language,title,body,source_language) VALUES (?, ?, 'zh-TW', ?, ?, 'multi')").bind(story.id, mode, item.title, item.body).run();
    saved.push({ mode: mode, title: item.title });
  }

  const bundle = await db.prepare("INSERT INTO editorials (story_id,mode,language,title,body,source_language) VALUES (NULL,'episode','zh-TW',?,?,'multi') RETURNING id").bind("Global Discovery " + date, saved.map((item) => item.title).join("\n")).first();
  if (runId) {
    await db.prepare("UPDATE daily_pipeline_runs SET selected_count=3, editorial_id=?, status='success', stage='complete', finished_at=CURRENT_TIMESTAMP WHERE id=?").bind(bundle.id, runId).run();
  }
  return { editorial_id: bundle.id, items: saved };
}
