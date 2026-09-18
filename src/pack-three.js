function clean(value) {
  return String(value || "").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
}

function taiwanDate() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

const CULTURE_RE = /film|cinema|music|design|archiv|restor|literat|histor|philosoph|anthrop|museum|font|typeface|classic|album|exhibit|電影|音樂|設計|文學|歷史|哲學|人類學|修復|字體|展覽|美術|戲劇|古典/i;
const NEWS_RE = /elect|war|nato|eu |un |president|minister|strike|ceasefire|economy|market|總理|總統|歐盟|選舉|停火|軍事|經濟/i;

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

function section(row) {
  const excerpt = clean(row.excerpt || row.raw_content || "");
  const lines = [
    "● " + (row.title || "無標題"),
    "來源：" + (row.source_name || "unknown") + (row.language ? "（" + row.language + "）" : "")
  ];
  if (row.url) lines.push("原文：" + row.url);
  if (excerpt) lines.push(excerpt.slice(0, 900));
  lines.push("");
  return lines.join("\n");
}

function synthesize(mode, rows, date) {
  const heads = {
    briefing: "今日簡報",
    feature: "深度發現",
    culture: "文化與知識"
  };
  const intros = {
    briefing: "以下把今天收到、仍需背景的時事收成一篇，不是快訊堆疊。每則保留來源與摘要。",
    feature: "以下把今天值得花時間的長材料與區域故事收成一篇。不追即時性，偏重脈絡。",
    culture: "以下把今天收到的電影修復、音樂、文學、設計、歷史與思想收成一篇。"
  };
  const used = rows.slice(0, 40);
  const body = [
    heads[mode] + "｜" + date,
    "",
    intros[mode],
    "本篇整理了 " + used.length + " 則來源。單一來源的說法先保留為「該媒體的陳述」。",
    "",
    ...used.map(section),
    "編輯說明：這是今日收割後的合集，不是單一家媒體的原文轉貼。"
  ].join("\n");
  const title = heads[mode] + "（" + used.length + " 則）｜" + date;
  return { title, body, count: used.length };
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
  if (buckets.culture.length < 5) buckets.culture.push(...rows.filter((row) => CULTURE_RE.test(`${row.title} ${row.source_name}`) || !buckets.culture.includes(row)).slice(0, 8));
  if (buckets.feature.length < 5) buckets.feature.push(...rows.filter((row) => !buckets.feature.includes(row) && !buckets.briefing.includes(row)).slice(0, 12));

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
    const sourceRows = buckets[mode].slice(0, 40);
    for (const row of sourceRows) {
      await db.prepare(
        "INSERT OR IGNORE INTO article_stories (article_id, story_id, relation_type) VALUES (?, ?, 'primary')"
      ).bind(row.id, story.id).run();
    }
    const editorial = await db.prepare(
      "INSERT INTO editorials (story_id,mode,language,title,body,source_language) VALUES (?, ?, 'zh-TW', ?, ?, 'multi') RETURNING id"
    ).bind(story.id, mode, item.title, item.body).first();
    saved.push({ id: editorial.id, mode, title: item.title, sources: sourceRows.length });
  }

  const bundle = await db.prepare(
    "INSERT INTO editorials (story_id,mode,language,title,body,source_language) VALUES (NULL,'episode','zh-TW',?,?,'multi') RETURNING id"
  ).bind("Global Discovery " + date, saved.map((item) => item.title).join("\n")).first();

  if (runId) {
    await db.prepare(
      "UPDATE daily_pipeline_runs SET candidate_count=?, selected_count=?, editorial_id=?, status='success', stage='complete', finished_at=CURRENT_TIMESTAMP WHERE id=?"
    ).bind(rows.length, saved.reduce((n, item) => n + item.sources, 0), bundle.id, runId).run();
  }

  return { editorial_id: bundle.id, harvest: rows.length, items: saved };
}
