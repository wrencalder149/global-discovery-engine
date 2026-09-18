function clean(value) {
  return String(value || "").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
}

function taiwanDate() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

const CULTURE_RE = /film|cinema|music|design|archiv|restor|literat|histor|philosoph|anthrop|museum|font|typeface|classic|album|exhibit|電影|音樂|設計|文學|歷史|哲學|人類學|修復|字體|展覽|美術|戲劇|古典/i;
const NEWS_RE = /elect|war|nato|eu |un |president|minister|strike|ceasefire|economy|market|總理|總統|歐盟|選舉|停火|軍事|經潮/i;

function bucketOf(row) {
  const text = `${row.title || ""} ${row.excerpt || ""} ${row.source_name || ""}`;
  if (CULTURE_RE.test(text)) return "culture";
  if (NEWS_RE.test(text)) return "briefing";
  return "feature";
}

function uniqueRows(rows) {
  const seen = new Set();
  const out = [];
  for (const row of rows) {
    const key = (row.canonical_url || row.url || row.title || "").toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

function smallPiece(index, row) {
  const excerpt = clean(row.excerpt || row.raw_content || "");
  return [
    "--------",
    "小篇 " + index,
    row.title || "無標題",
    "來源：" + (row.source_name || "unknown") + (row.language ? " ／ " + row.language : ""),
    row.url ? ("連結：" + row.url) : "",
    excerpt ? excerpt.slice(0, 900) : "目前只有標題，正文尚未取得。",
    ""
  ].join("\n");
}

function synthesize(mode, rows, date) {
  const heads = {
    briefing: "今日簡報",
    feature: "深度發現",
    culture: "文化與知識"
  };
  const intros = {
    briefing: "這一大篇收的是今天需要背景的時事。下面每一小篇是一則，不要當快訊版面刷。",
    feature: "這一大篇收的是長材料與區域故事。下面每一小篇可以單獨看。",
    culture: "這一大篇收的是電影修復、音樂、文學、設計、歷史與思想。下面每一小篇一則。"
  };
  const used = rows.slice(0, 40);
  const pieces = used.map((row, index) => smallPiece(index + 1, row));
  const body = [
    heads[mode] + " ｜ " + date,
    "共 " + used.length + " 小篇",
    "",
    intros[mode],
    "",
    ...pieces,
    "--------",
    "編輯說明：以上是今日收割合集。單一來源先作該媒體陳述，不當成已完全驗證。"
  ].join("\n");
  return {
    title: heads[mode] + "（" + used.length + " 小篇）｜" + date,
    body,
    count: used.length
  };
}

export async function packThree(db, runId) {
  const result = await db.prepare(`
    SELECT a.id, a.title, a.url, a.canonical_url, a.excerpt, a.raw_content, a.language, a.published_at,
           s.name AS source_name, s.source_type, s.region
    FROM articles a
    JOIN sources s ON s.id = a.source_id
    ORDER BY a.id DESC
    LIMIT 220
  `).all();
  const rows = uniqueRows(result.results || []);
  if (!rows.length) throw new Error("No collected articles to synthesize");

  const buckets = { briefing: [], feature: [], culture: [] };
  for (const row of rows) buckets[bucketOf(row)].push(row);
  if (buckets.briefing.length < 5) buckets.briefing.push(...rows.filter((row) => !buckets.briefing.includes(row)).slice(0, 8));
  if (buckets.culture.length < 5) buckets.culture.push(...rows.filter((row) => !buckets.culture.includes(row)).slice(0, 8));
  if (buckets.feature.length < 5) buckets.feature.push(...rows.filter((row) => !buckets.feature.includes(row)).slice(0, 12));

  const date = taiwanDate();
  const packed = {
    briefing: synthesize("briefing", buckets.briefing, date),
    feature: synthesize("feature", buckets.feature, date),
    culture: synthesize("culture", buckets.culture, date)
  };

  const saved = [];
  for (const mode of ["briefing", "feature", "culture"]) {
    const item = packed[mode];
    const story = await db.prepare(
      "INSERT INTO stories (title, summary, topic, status, first_seen_at, last_updated_at) VALUES (?, ?, ?, 'selected', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) RETURNING id"
    ).bind(item.title, item.title, mode).first();
    for (const row of buckets[mode].slice(0, 40)) {
      await db.prepare(
        "INSERT OR IGNORE INTO article_stories (article_id, story_id, relation_type) VALUES (?, ?, 'primary')"
      ).bind(row.id, story.id).run();
    }
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
      "UPDATE daily_pipeline_runs SET candidate_count=?, selected_count=?, editorial_id=?, status='success', stage='complete', finished_at=CURRENT_TIMESTAMP WHERE id=?"
    ).bind(rows.length, saved.reduce((n, item) => n + item.pieces, 0), bundle.id, runId).run();
  }

  return { editorial_id: bundle.id, harvest: rows.length, items: saved };
}
