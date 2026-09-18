const TEXT_MODEL = "@cf/zai-org/glm-4.7-flash";
const TTS_MODEL = "@cf/myshell-ai/melotts";
const MAX_CANDIDATES = 110;
const MAX_FULLTEXT_ARTICLES = 2;
const MAX_ARTICLE_TEXT = 18000;
const MAX_DOSSIER_TEXT = 90000;
const MAX_EPISODE_CHARS = 14000;

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

function responseText(result) {
  if (!result) return "";
  if (typeof result === "string") return result;
  if (typeof result.response === "string") return result.response;
  if (result.result && typeof result.result.response === "string") return result.result.response;
  if (result.choices?.[0]?.message?.content) return result.choices[0].message.content;
  if (result.choices?.[0]?.text) return result.choices[0].text;
  if (typeof result.output_text === "string") return result.output_text;
  return "";
}

function parseJson(text) {
  const raw = cleanText(text).replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  try {
    return JSON.parse(raw);
  } catch (_) {
    const first = raw.indexOf("{");
    const last = raw.lastIndexOf("}");
    if (first >= 0 && last > first) return JSON.parse(raw.slice(first, last + 1));
    throw new Error("AI did not return valid JSON");
  }
}

async function aiCall(env, system, user, maxCompletionTokens) {
  if (!env.AI) throw new Error("Workers AI binding is not available");
  const result = await env.AI.run(TEXT_MODEL, {
    messages: [
      { role: "system", content: system },
      { role: "user", content: user }
    ],
    max_completion_tokens: maxCompletionTokens,
    temperature: 0.2
  });
  const text = responseText(result);
  if (!text) throw new Error("Workers AI returned no text");
  return text;
}

export async function ensurePipelineTables(db) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS daily_pipeline_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_date TEXT NOT NULL,
    started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    finished_at TEXT,
    status TEXT NOT NULL DEFAULT 'running',
    collection_run_id INTEGER,
    candidate_count INTEGER DEFAULT 0,
    selected_count INTEGER DEFAULT 0,
    editorial_id INTEGER,
    error TEXT
  )`).run();
  try {
    await db.prepare("ALTER TABLE daily_pipeline_runs ADD COLUMN workflow_id TEXT").run();
  } catch (_) {}
  try {
    await db.prepare("ALTER TABLE daily_pipeline_runs ADD COLUMN stage TEXT").run();
  } catch (_) {}
  await db.prepare(`CREATE TABLE IF NOT EXISTS daily_pipeline_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_date TEXT NOT NULL,
    started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    finished_at TEXT,
    status TEXT NOT NULL DEFAULT 'running',
    collection_run_id INTEGER,
    candidate_count INTEGER DEFAULT 0,
    selected_count INTEGER DEFAULT 0,
    editorial_id INTEGER,
    error TEXT
  )`).run();

  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_daily_pipeline_run_date
    ON daily_pipeline_runs(run_date)`).run();
}

export async function ensureExtendedTables(db) {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS topics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS story_topics (
      story_id INTEGER NOT NULL,
      topic_id INTEGER NOT NULL,
      relation_type TEXT DEFAULT 'primary',
      PRIMARY KEY (story_id, topic_id),
      FOREIGN KEY (story_id) REFERENCES stories(id) ON DELETE CASCADE,
      FOREIGN KEY (topic_id) REFERENCES topics(id) ON DELETE CASCADE
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS claims (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      story_id INTEGER NOT NULL,
      claim_type TEXT NOT NULL,
      text TEXT NOT NULL,
      status TEXT DEFAULT 'unverified',
      confidence REAL,
      attribution TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (story_id) REFERENCES stories(id) ON DELETE CASCADE
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS evidence (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      claim_id INTEGER NOT NULL,
      article_id INTEGER,
      evidence_type TEXT,
      independence_group TEXT,
      strength REAL,
      notes TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (claim_id) REFERENCES claims(id) ON DELETE CASCADE,
      FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE SET NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS editorials (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      story_id INTEGER,
      mode TEXT NOT NULL,
      language TEXT NOT NULL DEFAULT 'zh-TW',
      title TEXT,
      body TEXT,
      source_language TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (story_id) REFERENCES stories(id) ON DELETE SET NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS audio_assets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      editorial_id INTEGER NOT NULL,
      provider TEXT,
      object_key TEXT,
      duration_seconds REAL,
      mime_type TEXT,
      status TEXT DEFAULT 'pending',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (editorial_id) REFERENCES editorials(id) ON DELETE CASCADE
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      story_id INTEGER,
      rating REAL,
      feedback_type TEXT,
      note TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (story_id) REFERENCES stories(id) ON DELETE SET NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS source_observations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_id INTEGER NOT NULL,
      observed_at TEXT DEFAULT CURRENT_TIMESTAMP,
      reliability REAL,
      discovery_value REAL,
      originality REAL,
      locality REAL,
      depth REAL,
      specialization REAL,
      notes TEXT,
      FOREIGN KEY (source_id) REFERENCES sources(id) ON DELETE CASCADE
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS story_candidates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      article_id INTEGER NOT NULL,
      candidate_type TEXT DEFAULT 'discovered',
      novelty REAL,
      importance REAL,
      uniqueness REAL,
      depth REAL,
      curiosity REAL,
      evidence_quality REAL,
      personal_fit REAL,
      serendipity REAL,
      status TEXT DEFAULT 'queued',
      reason TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(article_id),
      FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE
    )`)
  ]);
  await ensurePipelineTables(db);
}

async function latestCandidates(db) {
  const recent = await db.prepare(`SELECT a.id,a.title,a.url,a.published_at,a.excerpt,a.language,a.country,
      s.name AS source_name,s.region,s.country AS source_country,s.reliability,s.discovery_value,s.depth,s.originality
    FROM articles a JOIN sources s ON s.id=a.source_id
    ORDER BY a.id DESC LIMIT ?`).bind(MAX_CANDIDATES - 15).all();

  const older = await db.prepare(`SELECT a.id,a.title,a.url,a.published_at,a.excerpt,a.language,a.country,
      s.name AS source_name,s.region,s.country AS source_country,s.reliability,s.discovery_value,s.depth,s.originality
    FROM articles a JOIN sources s ON s.id=a.source_id
    WHERE a.id NOT IN (SELECT id FROM articles ORDER BY id DESC LIMIT ?)
    ORDER BY a.id DESC LIMIT 15`).bind(MAX_CANDIDATES - 15).all();

  const map = new Map();
  for (const row of [...recent.results, ...older.results]) map.set(row.id, row);
  return [...map.values()];
}

async function chooseGroups(env, articles) {
  const compact = articles.map((a) => ({
    id: a.id,
    title: a.title,
    source: a.source_name,
    region: a.region || a.source_country || a.country || "unknown",
    published_at: a.published_at || null,
    excerpt: cleanText(a.excerpt || "").slice(0, 500),
    discovery_value: a.discovery_value,
    depth: a.depth,
    originality: a.originality
  }));

  const system = `你是全球資訊探索系統的選題引擎。你的任務不是做熱門新聞排行榜，而是從候選文章中找出真正值得人花時間了解的「故事單位」。需要兼顧世界重要性、資訊增量、獨特性、深度、好奇心、文化價值、地方性、證據潛力與意外性。不要讓單一國家、單一議題或同一新聞源壟斷結果。亞洲、非洲、拉丁美洲、中東、歐洲、北美都應有機會出現；文化、科學、設計、影像、音樂等也應與政治經濟並列考慮。
輸出只能是 JSON，不要 Markdown。格式：{"groups":[{"article_ids":[1,2],"title":"...","topic":"...","why":"...","importance":0.0,"novelty":0.0,"uniqueness":0.0,"depth":0.0,"curiosity":0.0,"personal_fit":0.0,"serendipity":0.0}]}。最多 8 組。article_ids 必須來自候選清單。`;

  const user = `今天的候選文章：\n${JSON.stringify(compact)}`;
  const output = parseJson(await aiCall(env, system, user, 2200));
  const validIds = new Set(articles.map((a) => a.id));
  const groups = Array.isArray(output.groups) ? output.groups : [];
  return groups.map((g) => ({
    ...g,
    article_ids: Array.isArray(g.article_ids) ? g.article_ids.filter((id) => validIds.has(id)) : []
  })).filter((g) => g.article_ids.length);
}

async function fetchArticleText(env, article) {
  if (article.raw_content && article.raw_content.length > 400) return article.raw_content;
  const response = await fetch(article.url, {
    headers: { "User-Agent": "GlobalDiscoveryEngine/0.3" },
    redirect: "follow"
  });
  if (!response.ok) throw new Error(`Article fetch ${response.status}: ${article.url}`);
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("text/html")) throw new Error(`Not HTML: ${contentType}`);
  const html = await response.text();
  if (!env.AI?.toMarkdown) throw new Error("Workers AI Markdown Conversion is not available");
  const converted = await env.AI.toMarkdown(
    {
      name: "article.html",
      blob: new Blob([html], { type: "text/html" })
    },
    {
      conversionOptions: {
        html: { hostname: new URL(article.url).hostname },
        output: { format: "text" }
      }
    }
  );
  if (converted.format === "error") throw new Error(converted.error || "Markdown conversion failed");
  return cleanText(converted.data).slice(0, MAX_ARTICLE_TEXT);
}

async function buildDossiers(env, db, groups, articles) {
  const byId = new Map(articles.map((a) => [a.id, a]));
  const dossiers = [];

  for (const group of groups) {
    const members = group.article_ids.map((id) => byId.get(id)).filter(Boolean);
    const primary = members[0];
    let primaryText = "";
    try {
      primaryText = await fetchArticleText(env, primary);
      await db.prepare("UPDATE articles SET raw_content = ?, processing_state = 'cleaned', fetched_at = CURRENT_TIMESTAMP WHERE id = ?")
        .bind(primaryText, primary.id).run();
    } catch (error) {
      primaryText = cleanText(primary.excerpt || "");
    }

    const supporting = [];
    for (const member of members.slice(1, MAX_FULLTEXT_ARTICLES)) {
      let text = cleanText(member.excerpt || "");
      try {
        if (text.length < 300) text = await fetchArticleText(env, member);
      } catch (_) {}
      supporting.push({ id: member.id, source: member.source_name, title: member.title, url: member.url, text: text.slice(0, 9000) });
    }

    dossiers.push({
      ...group,
      primary: {
        id: primary.id,
        source: primary.source_name,
        title: primary.title,
        url: primary.url,
        region: primary.region || primary.source_country,
        text: primaryText
      },
      supporting
    });
  }

  return dossiers;
}

async function generateEpisode(env, dossiers) {
  const compact = JSON.stringify(dossiers).slice(0, MAX_DOSSIER_TEXT);
  const system = `你是台灣繁體中文的全球資訊 Podcast 主編。請根據提供的研究資料製作一集每天一次、內容密度高但不是流水帳的節目。
嚴格要求：
1. 只使用提供的資料，不得捏造資料、日期、人物、數字或因果關係。
2. 明確區分已確認事實、來源聲稱、分析與不確定性；不要把單一來源說法寫成確定事實。
3. 每個故事都指出主要來源與可交叉比對的來源；若只有單一來源，明說「目前只有單一來源支持」。
4. 以自然的台灣繁體中文口語呈現，不使用中國大陸常見詞彙。
5. 節目不是新聞主播念稿，要解釋「為什麼值得知道」以及各資訊之間的關係。
6. 可以包含政治、戰爭、經濟、科學、環境、社會、文化、電影、音樂、設計、建築等；不要強迫每類都出現。
7. 最多 8 個故事；篇幅可變，但總腳本不超過約 14000 個中文字。
8. 請另外列出每個故事的關鍵 claims，並為每個 claim 指示 evidence_article_ids。\n輸出只能是 JSON：{"episode":{"title":"...","intro":"...","outro":"..."},"stories":[{"article_ids":[1,2],"title":"...","topic":"...","summary":"...","mode":"brief|feature|deep_dive","script":"...","claims":[{"claim_type":"FACT|QUOTE|STATISTIC|INTERPRETATION|CAUSAL_CLAIM|PREDICTION|ATTRIBUTION|HISTORICAL_CONTEXT","text":"...","status":"confirmed|supported|partially_supported|single_source|contested|unverified|refuted","confidence":0.0,"attribution":"...","evidence_article_ids":[1,2]}]}]}`;
  const user = `研究資料如下：\n${compact}`;
  const output = parseJson(await aiCall(env, system, user, 8000));
  output.stories = Array.isArray(output.stories) ? output.stories : [];
  output.stories = output.stories.map((story) => ({
    ...story,
    script: cleanText(story.script || "").slice(0, 6000),
    claims: Array.isArray(story.claims) ? story.claims.slice(0, 6) : []
  }));
  return output;
}

async function saveEpisode(env, db, runId, selected, dossierMap, episode) {
  const storyIdByKey = new Map();
  let selectedCount = 0;

  for (const story of episode.stories) {
    const ids = Array.isArray(story.article_ids) ? story.article_ids.map(Number).filter(Boolean) : [];
    const validIds = ids.filter((id) => selected.some((a) => a.id === id));
    if (!validIds.length) continue;

    const articleSetKey = validIds.sort((a, b) => a - b).join(",");
    if (storyIdByKey.has(articleSetKey)) continue;

    const existing = await db.prepare(`SELECT s.id FROM stories s JOIN article_stories asg ON asg.story_id=s.id
      WHERE asg.article_id IN (${validIds.map(() => "?").join(",")}) GROUP BY s.id HAVING COUNT(DISTINCT asg.article_id)=? LIMIT 1`)
      .bind(...validIds, validIds.length).first();

    let storyId = existing?.id;
    if (!storyId) {
      const inserted = await db.prepare(`INSERT INTO stories (title, summary, topic, status, first_seen_at, last_updated_at)
        VALUES (?, ?, ?, 'selected', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) RETURNING id`)
        .bind(story.title || "未命名故事", story.summary || "", story.topic || "",).first();
      storyId = inserted.id;
    }

    storyIdByKey.set(articleSetKey, storyId);
    selectedCount++;

    await db.prepare("DELETE FROM article_stories WHERE story_id = ?").bind(storyId).run();
    for (const articleId of validIds) {
      await db.prepare("INSERT OR IGNORE INTO article_stories (article_id, story_id, relation_type) VALUES (?, ?, 'primary')")
        .bind(articleId, storyId).run();
    }

    await db.prepare(`INSERT OR REPLACE INTO story_candidates
      (article_id, candidate_type, novelty, importance, uniqueness, depth, curiosity, evidence_quality, personal_fit, serendipity, status, reason, updated_at)
      VALUES (?, 'selected', ?, ?, ?, ?, ?, ?, ?, ?, 'selected', ?, CURRENT_TIMESTAMP)`)
      .bind(validIds[0], story.novelty || null, story.importance || null, story.uniqueness || null, story.depth || null,
        story.curiosity || null, story.evidence_quality || null, story.personal_fit || null, story.serendipity || null,
        story.summary || story.topic || "selected").run();

    const claims = Array.isArray(story.claims) ? story.claims : [];
    for (const claim of claims) {
      const insertedClaim = await db.prepare(`INSERT INTO claims (story_id, claim_type, text, status, confidence, attribution)
        VALUES (?, ?, ?, ?, ?, ?) RETURNING id`)
        .bind(storyId, claim.claim_type || "FACT", claim.text || "", claim.status || "unverified",
          Number.isFinite(Number(claim.confidence)) ? Number(claim.confidence) : null, claim.attribution || null).first();
      const evidenceIds = Array.isArray(claim.evidence_article_ids) ? claim.evidence_article_ids : [];
      for (const evidenceArticleId of evidenceIds) {
        if (!validIds.includes(Number(evidenceArticleId))) continue;
        await db.prepare(`INSERT INTO evidence (claim_id, article_id, evidence_type, independence_group, strength, notes)
          VALUES (?, ?, 'reporting', ?, ?, ?)`)
          .bind(insertedClaim.id, Number(evidenceArticleId), `source:${Number(evidenceArticleId)}`, Number(claim.confidence || 0.5), claim.attribution || null).run();
      }
    }

    await db.prepare(`INSERT INTO editorials (story_id, mode, language, title, body, source_language)
      VALUES (?, ?, 'zh-TW', ?, ?, 'multi')`).bind(storyId, story.mode || "feature", story.title, story.script || "").run();
  }

  const episodeBody = [
    episode.episode?.intro || "",
    ...episode.stories.map((s) => `\n${s.title || "下一個故事"}\n\n${s.script || ""}`),
    episode.episode?.outro || ""
  ].join("\n").trim().slice(0, MAX_EPISODE_CHARS);

  const editorial = await db.prepare(`INSERT INTO editorials (story_id, mode, language, title, body, source_language)
    VALUES (NULL, 'episode', 'zh-TW', ?, ?, 'multi') RETURNING id`)
    .bind(episode.episode?.title || `Global Discovery ${new Date().toISOString().slice(0,10)}`, episodeBody).first();

  await db.prepare("UPDATE daily_pipeline_runs SET editorial_id = ?, selected_count = ?, status = 'success', finished_at = CURRENT_TIMESTAMP WHERE id = ?")
    .bind(editorial.id, selectedCount, runId).run();

  return { editorial_id: editorial.id, selected_count: selectedCount };
}

export async function runDailyPipeline(env) {
  await ensureExtendedTables(env.DB);
  const runDate = new Date().toISOString().slice(0, 10);

  const existing = await env.DB.prepare(`SELECT id,editorial_id,status FROM daily_pipeline_runs
    WHERE run_date = ? AND status = 'success' ORDER BY id DESC LIMIT 1`).bind(runDate).first();
  if (existing) return { status: "already_done", ...existing };

  const running = await env.DB.prepare(`SELECT id FROM daily_pipeline_runs
    WHERE run_date = ? AND status = 'running' ORDER BY id DESC LIMIT 1`).bind(runDate).first();
  if (running) return { status: "already_running", id: running.id };

  const run = await env.DB.prepare("INSERT INTO daily_pipeline_runs (run_date) VALUES (?) RETURNING id").bind(runDate).first();
  const runId = run.id;

  try {
    const collection = await import("./index.js");
    const collectionResult = await collection.runCollection(env.DB, "pipeline");
    await env.DB.prepare("UPDATE daily_pipeline_runs SET collection_run_id = ? WHERE id = ?")
      .bind(collectionResult.run_id, runId).run();

    const candidates = await latestCandidates(env.DB);
    await env.DB.prepare("UPDATE daily_pipeline_runs SET candidate_count = ? WHERE id = ?")
      .bind(candidates.length, runId).run();

    if (!candidates.length) throw new Error("No article candidates available");
    const groups = await chooseGroups(env, candidates);
    const dossiers = await buildDossiers(env, env.DB, groups, candidates);
    const episode = await generateEpisode(env, dossiers);
    const saved = await saveEpisode(env, env.DB, runId, candidates, new Map(dossiers.map((d) => [d.title, d])), episode);
    return { status: "success", run_id: runId, collection: collectionResult, ...saved };
  } catch (error) {
    await env.DB.prepare("UPDATE daily_pipeline_runs SET status='failed', error=?, finished_at=CURRENT_TIMESTAMP WHERE id=?")
      .bind(String(error), runId).run();
    throw error;
  }
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

  const script = cleanText(editorial.body).slice(0, 12000);
  let audio = await env.AI.run(TTS_MODEL, { prompt: script, lang: "zh" });

  let response;
  if (audio instanceof Response) {
    response = audio;
  } else if (audio instanceof ReadableStream) {
    response = new Response(audio);
  } else if (audio instanceof ArrayBuffer || audio instanceof Uint8Array) {
    response = new Response(audio);
  } else if (audio?.audio instanceof ArrayBuffer || audio?.audio instanceof Uint8Array) {
    response = new Response(audio.audio);
  } else if (typeof audio === "string") {
    try {
      const binary = Uint8Array.from(atob(audio), (c) => c.charCodeAt(0));
      response = new Response(binary);
    } catch (_) {
      response = new Response(audio);
    }
  } else {
    response = new Response(JSON.stringify(audio));
  }

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
