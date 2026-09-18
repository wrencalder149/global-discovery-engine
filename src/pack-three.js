function clean(value) {
  return String(value || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function taiwanDate() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

const CULTURE = /film|cinema|music|design|archiv|restor|literat|histor|philosoph|anthrop|museum|font|typeface|電影|音樂|設計|文學|歷史|哲學|人類學|修復|字體|展覽/i;

function score(row, kind) {
  const text = `${row.title || ""} ${row.excerpt || ""} ${row.source_name || ""}`;
  if (kind === "culture") return CULTURE.test(text) ? 3 : 0;
  if (kind === "feature") return Math.min(2, Math.floor(clean(row.excerpt).length / 180));
  return /zh|tw|hant/i.test(row.language || "") ? 1 : 0;
}

function pick(rows) {
  const unused = [...rows];
  function take(kind) {
    unused.sort((a, b) => score(b, kind) - score(a, kind));
    return unused.shift();
  }
  return {
    briefing: take("briefing"),
    feature: take("feature"),
    culture: take("culture")
  };
}

function articleBody(mode, row) {
  const excerpt = clean(row.excerpt || row.raw_content || "源站未提供摘要。");
  const heads = {
    briefing: "今日簡報",
    feature: "深度",
    culture: "文化"
  };
  return [
    heads[mode] + "：" + (row.title || "無標題"),
    "",
    "來源：" + (row.source_name || "unknown"),
    row.url ? ("原文：" + row.url) : "",
    "",
    excerpt || "目前只收到標題，正文尚未取得。",
    "",
    "說明：這篇先依單一來源整理，未做完整交叉驗證。若有明顯事實誤差，後續會下架。"
  ].filter((line) => line !== undefined).join("\n");
}

export async function packThree(db, runId) {
  const result = await db.prepare(`
    SELECT a.id, a.title, a.url, a.excerpt, a.raw_content, a.language, a.published_at,
           s.name AS source_name, s.source_type
    FROM articles a
    JOIN sources s ON s.id = a.source_id
    ORDER BY a.id DESC
    LIMIT 80
  `).all();
  const rows = result.results || [];
  if (rows.length < 3) throw new Error("Not enough collected articles to pack");

  const picked = pick(rows);
  const slots = [
    ["briefing", picked.briefing],
    ["feature", picked.feature],
    ["culture", picked.culture]
  ];

  const saved = [];
  for (const [mode, row] of slots) {
    const title = row.title || mode;
    const body = articleBody(mode, row);
    const story = await db.prepare(
      "INSERT INTO stories (title, summary, topic, status, first_seen_at, last_updated_at) VALUES (?, ?, ?, 'selected', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) RETURNING id"
    ).bind(title, clean(row.excerpt).slice(0, 240), mode).first();
    await db.prepare(
      "INSERT OR IGNORE INTO article_stories (article_id, story_id, relation_type) VALUES (?, ?, 'primary')"
    ).bind(row.id, story.id).run();
    const editorial = await db.prepare(
      "INSERT INTO editorials (story_id,mode,language,title,body,source_language) VALUES (?, ?, 'zh-TW', ?, ?, ?) RETURNING id"
    ).bind(story.id, mode, title, body, row.language || "multi").first();
    saved.push({ id: editorial.id, mode, title });
  }

  const bundle = await db.prepare(
    "INSERT INTO editorials (story_id,mode,language,title,body,source_language) VALUES (NULL,'episode','zh-TW',?,?,'multi') RETURNING id"
  ).bind("Global Discovery " + taiwanDate(), saved.map((item) => item.title).join(" / ")).first();

  await db.prepare(
    "UPDATE daily_pipeline_runs SET candidate_count=?, selected_count=?, editorial_id=?, status='success', stage='complete', finished_at=CURRENT_TIMESTAMP WHERE id=?"
  ).bind(rows.length, saved.length, bundle.id, runId).run();

  return { editorial_id: bundle.id, selected_count: saved.length, items: saved };
}
