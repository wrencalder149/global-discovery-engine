const TEXT_MODEL = "@cf/zai-org/glm-4.7-flash";
const REJECT_RE = /marvel|avengers|box office|blackpink|resident evil|superhero|票房|漫威/i;
const CULTURE_RE = /film|cinema|music|design|archiv|restor|literat|histor|philosoph|anthrop|museum|classic|exhibit|電影|音樂|設計|文學|歷史|哲學|人類學|修復|字體|展覽|美術|戲劇|古典/i;
const NEWS_RE = /elect|war|nato|president|minister|ceasefire|economy|總理|總統|歐盟|選舉|停火|軍事/i;

function clean(value) {
  return String(value || "").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
}

function taiwanDate() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function responseText(result) {
  if (!result) return "";
  if (typeof result === "string") return result;
  if (typeof result.response === "string") return result.response;
  if (result.choices?.[0]?.message?.content) return result.choices[0].message.content;
  return "";
}

function bucketOf(row) {
  const text = `${row.title || ""} ${row.excerpt || ""} ${row.source_name || ""}`;
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

const HEADS = { briefing: "今日簡報", feature: "深度發現", culture: "文化與知識" };

function compactRows(rows, limit) {
  return rows.slice(0, limit).map((row) => ({
    title: row.title,
    source: row.source_name,
    language: row.language || "",
    excerpt: clean(row.excerpt || row.raw_content || "").slice(0, 280),
    url: row.url || ""
  }));
}

async function writePack(env, mode, rows, date) {
  const items = compactRows(rows, 10);
  const system = [
    "你是台灣繁體中文編輯。",
    "把下面素材寫成一篇「" + HEADS[mode] + "」匯整。",
    "不要貼原文標題堂。不要以網址當主文。",
    "每則用繁中寫標題與 80到160字的背景說明。",
    "若原文不是中文，必須譬成台灣繁中。",
    "單一來源就寫「目前僅見此來源」。",
    "連結只能放在段落最後一行。",
    "禁止漫威、超級英雄、票房、偶像通稿。",
    "直接輸出正文，不要 JSON。"
  ].join("");

  if (env.AI && items.length) {
    try {
      const result = await env.AI.run(TEXT_MODEL, {
        messages: [
          { role: "system", content: system },
          { role: "user", content: JSON.stringify({ date, mode, items }).slice(0, 9000) }
        ],
        max_completion_tokens: 2200,
        temperature: 0.2
      });
      const text = responseText(result).trim();
      if (text && !text.includes("小篇 ") && text.length > 200) {
        return { title: HEADS[mode] + "｜" + date, body: text, count: items.length };
      }
    } catch (_) {}
  }

  const fallback = [
    HEADS[mode] + " ｜ " + date,
    "今日先收到素材，以下用繁中說明來源與重點，不以原文標題堂代替內容。",
    ""
  ];
  items.forEach((item, i) => {
    fallback.push((i + 1) + ". " + (item.title || "無標題"));
    fallback.push("來源：" + (item.source || "unknown") + (「（目前僅見此來源）」));
    fallback.push(item.excerpt || "此則尚無足夠正文可整理。");
    fallback.push("");
  });
  return { title: HEADS[mode] + "｜" + date, body: fallback.join("\n"), count: items.length };
}

export async function packThree(env, runId) {
  const db = env.DB;
  const result = await db.prepare(`
    SELECT a.id, a.title, a.url, a.excerpt, a.raw_content, a.language,
           s.name AS source_name, s.source_type, s.region
    FROM articles a JOIN sources s ON s.id = a.source_id
    ORDER BY a.id DESC LIMIT 180
  `).all();
  const rows = uniqueRows(result.results || []).filter((row) => bucketOf(row));
  if (!rows.length) throw new Error("No collected articles to synthesize");

  const buckets = { briefing: [], feature: [], culture: [] };
  for (const row of rows) {
    const bucket = bucketOf(row);
    if (bucket) buckets[bucket].push(row);
  }
  if (buckets.briefing.length < 4) buckets.briefing.push(...rows.slice(0, 6));
  if (buckets.feature.length < 4) buckets.feature.push(...rows.slice(0, 8));
  if (buckets.culture.length < 4) buckets.culture.push(...rows.filter((row) => CULTURE_RE.test(`${row.title} ${row.excerpt}`)).slice(0, 6));

  const date = taiwanDate();
  const saved = [];
  for (const mode of ["briefing", "feature", "culture"]) {
    const item = await writePack(env, mode, buckets[mode], date);
    const story = await db.prepare(
      "INSERT INTO stories (title, summary, topic, status, first_seen_at, last_updated_at) VALUES (?, ?, ?, 'selected', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) RETURNING id"
    ).bind(item.title, item.title, mode).first();
    const editorial = await db.prepare(
      "INSERT INTO editorials (story_id,mode,language,title,body,source_language) VALUES (?, ?, 'zh-TW', ?, ?, 'multi') RETURNING id"
    ).bind(story.id, mode, item.title, item.body).first();
    saved.push({ id: editorial.id, mode, title: item.title, pieces: item.count });
  }

  const bundle = await db.prepare(
    "INSERT INTO editorials (story_id,mode,language,title,body,source_language) VALUES (NULL,'episode','zh-TW',?,?,'multi') RETURNING id"
  ).bind("Global Discovery " + date, saved.map((item) => item.title).join("\n")).first();

  if (runId) {
    await db.prepare(
      "UPDATE daily_pipeline_runs SET candidate_count=?, selected_count=3, editorial_id=?, status='success', stage='complete', finished_at=CURRENT_TIMESTAMP WHERE id=?"
    ).bind(rows.length, bundle.id, runId).run();
  }
  return { editorial_id: bundle.id, harvest: rows.length, items: saved };
}
