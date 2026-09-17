import { WorkflowEntrypoint } from "cloudflare:workers";
import { ensureExtendedTables } from "./daily.js";
import { runCollection } from "./index.js";

const TEXT_MODEL = "@cf/zai-org/glm-4.7-flash";
const MAX_CANDIDATES = 110;
const MAX_FULLTEXT_PER_STORY = 2;
const MAX_ARTICLE_TEXT = 18000;
const MAX_DOSSIER_TEXT = 90000;
const MAX_EPISODE_CHARS = 14000;

function cleanText(value) {
  return String(value || "")
    .replace(/\u0000/g, "")
    .replace(/\s+/g, " ")
    .trim();
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
  const raw = cleanText(text).replace(/^\`\`\`(?:json)?/i, "").replace(/\`\`\`$/i, "").trim();
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

function taiwanDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

async function staleCleanup(db) {
  await db.prepare(
    "UPDATE daily_pipeline_runs SET status='failed', error='stale run recovered by Workflow', finished_at=CURRENT_TIMESTAMP WHERE status='running' AND started_at < datetime('now','-20 minutes')"
  ).run();
  await db.prepare(
    "UPDATE collection_runs SET status='failed', error_json='[{\"stage\":\"recovery\",\"error\":\"stale run recovered by Workflow\"}]', finished_at=CURRENT_TIMESTAMP WHERE status='running' AND started_at < datetime('now','-20 minutes')"
  ).run();
}

async function getCandidates(db) {
  const recent = await db.prepare(`
    SELECT a.id,a.title,a.url,a.published_at,a.excerpt,a.language,a.country,
      a.raw_content,
      s.name AS source_name,s.region,s.country AS source_country,
      s.reliability,s.discovery_value,s.depth,s.originality
    FROM articles a JOIN sources s ON s.id=a.source_id
    ORDER BY a.id DESC LIMIT ?
  `).bind(MAX_CANDIDATES - 15).all();

  const older = await db.prepare(`
    SELECT a.id,a.title,a.url,a.published_at,a.excerpt,a.language,a.country,
      a.raw_content,
      s.name AS source_name,s.region,s.country AS source_country,
      s.reliability,s.discovery_value,s.depth,s.originality
    FROM articles a JOIN sources s ON s.id=a.source_id
    WHERE a.id NOT IN (SELECT id FROM articles ORDER BY id DESC LIMIT ?)
    ORDER BY a.id DESC LIMIT 15
  `).bind(MAX_CANDIDATES - 15).all();

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
    excerpt: cleanText(a.excerpt || "").slice(0, 600),
    discovery_value: a.discovery_value,
    depth: a.depth,
    originality: a.originality
  }));

  const system = `你是全球資訊探索系統的選題引擎。從候選文章找出值得花時間了解的故事單位，而不是熱門新聞排行榜。兼顧世界重要性、資訊增量、獨特性、深度、好奇心、文化價值、地方性、證據潛力與意外性。避免單一國家、議題或來源壟斷；亞洲、非洲、拉丁美洲、中東、歐洲、北美都應有機會出現。文化、科學、設計、影像、音樂與政治經濟同等可被選入。不要因為文章熱門就自動入選。
輸出只能是 JSON：{"groups":[{"article_ids":[1,2],"title":"...","topic":"...","why":"...","importance":0.0,"novelty":0.0,"uniqueness":0.0,"depth":0.0,"curiosity":0.0,"personal_fit":0.0,"serendipity":0.0}]}
最多 8 組。article_ids 必須來自候選清單。`;

  const output = parseJson(await aiCall(env, system, JSON.stringify({ articles: compact }), 2400));
  const validIds = new Set(articles.map((a) => a.id));
  return (Array.isArray(output.groups) ? output.groups : [])
    .map((g) => ({
      ...g,
      article_ids: Array.isArray(g.article_ids)
        ? g.article_ids.map(Number).filter((id) => validIds.has(id))
        : []
    }))
    .filter((g) => g.article_ids.length);
}

async function fetchArticleText(env, article) {
  if (article.raw_content && article.raw_content.length > 400) return article.raw_content;
  const response = await fetch(article.url, {
    headers: { "User-Agent": "GlobalDiscoveryEngine/0.4" },
    redirect: "follow"
  });
  if (!response.ok) throw new Error(`Article fetch ${response.status}: ${article.url}`);

  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("text/html")) {
    throw new Error(`Not HTML: ${contentType}`);
  }

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

  if (converted.format === "error") {
    throw new Error(converted.error || "Markdown conversion failed");
  }

  return cleanText(converted.data).slice(0, MAX_ARTICLE_TEXT);
}

async function buildDossiers(env, db, groups, articles) {
  const byId = new Map(articles.map((a) => [a.id, a]));
  const dossiers = [];

  for (const group of groups) {
    const members = group.article_ids.map((id) => byId.get(id)).filter(Boolean);
    if (!members.length) continue;

    const primary = members[0];
    let primaryText = cleanText(primary.excerpt || "");

    try {
      primaryText = await fetchArticleText(env, primary);
      await db.prepare(
        "UPDATE articles SET raw_content=?, processing_state='cleaned', fetched_at=CURRENT_TIMESTAMP WHERE id=?"
      ).bind(primaryText, primary.id).run();
    } catch (_) {}

    const supporting = [];
    for (const member of members.slice(1, MAX_FULLTEXT_PER_STORY)) {
      let text = cleanText(member.excerpt || "");
      try {
        if (text.length < 300) text = await fetchArticleText(env, member);
      } catch (_) {}
      supporting.push({
        id: member.id,
        source: member.source_name,
        title: member.title,
        url: member.url,
        text: text.slice(0, 9000)
      });
    }

    dossiers.push({
      article_ids: group.article_ids,
      title: group.title,
      topic: group.topic,
      why: group.why,
      importance: group.importance,
      novelty: group.novelty,
      uniqueness: group.uniqueness,
      depth: group.depth,
      curiosity: group.curiosity,
      personal_fit: group.personal_fit,
      serendipity: group.serendipity,
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
  const research = JSON.stringify(dossiers).slice(0, MAX_DOSSIER_TEXT);

  const system = `你是台灣繁體中文的全球資訊 Podcast 主編。根據研究資料製作一天一集、內容密度高但不是流水帳的節目。
嚴格要求：
1. 只能使用提供的資料，不得捏造人物、日期、數字、事件或因果關係。
2. 明確區分已確認事實、來源聲稱、分析與不確定性。
3. 若只有單一來源，必須說明目前只有單一來源支持。
4. 使用自然台灣繁體中文口語，不使用中國大陸慣用詞彙。
5. 解釋為什麼值得知道，而不是只重述標題。
6. 可涵蓋政治、戰爭、經濟、科學、環境、社會、文化、電影、音樂、設計、建築等，不強迫平均分配。
7. 最多 8 個故事，總稿件約不超過 14000 字。
8. 每個故事列出 claims，並提供 evidence_article_ids。
輸出只能是 JSON：{"episode":{"title":"...","intro":"...","outro":"..."},"stories":[{"article_ids":[1,2],"title":"...","topic":"...","summary":"...","mode":"brief|feature|deep_dive","script":"...","claims":[{"claim_type":"FACT|QUOTE|STATISTIC|INTERPRETATION|CAUSAL_CLAIM|PREDICTION|ATTRIBUTION|HISTORICAL_CONTEXT","text":"...","status":"confirmed|supported|partially_supported|single_source|contested|unverified|refuted","confidence":0.0,"attribution":"...","evidence_article_ids":[1,2]}]}]}`;

  const output = parseJson(await aiCall(env, system, research, 8500));
  output.stories = Array.isArray(output.stories) ? output.stories : [];
  output.stories = output.stories.map((story) => ({
    ...story,
    script: cleanText(story.script || "").slice(0, 6500),
    claims: Array.isArray(story.claims) ? story.claims.slice(0, 6) : []
  }));
  return output;
}

async function saveEpisode(db, runId, selected, episode) {
  const storyIds = [];

  for (const story of episode.stories) {
    const ids = Array.isArray(story.article_ids)
      ? story.article_ids.map(Number).filter(Boolean).filter((id) => selected.some((a) => a.id === id))
      : [];

    if (!ids.length) continue;

    const existing = await db.prepare(`
      SELECT s.id
      FROM stories s
      JOIN article_stories asg ON asg.story_id=s.id
      WHERE asg.article_id IN (${ids.map(() => "?").join(",")})
      GROUP BY s.id
      HAVING COUNT(DISTINCT asg.article_id)=?
      LIMIT 1
    `).bind(...ids, ids.length).first();

    let storyId = existing?.id;
    if (!storyId) {
      const inserted = await db.prepare(`
        INSERT INTO stories (title, summary, topic, status, first_seen_at, last_updated_at)
        VALUES (?, ?, ?, 'selected', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        RETURNING id
      `).bind(story.title || "未命名故事", story.summary || "", story.topic || "").first();
      storyId = inserted.id;
    }

    await db.prepare("DELETE FROM article_stories WHERE story_id=?").bind(storyId).run();
    for (const articleId of ids) {
      await db.prepare(
        "INSERT OR IGNORE INTO article_stories (article_id, story_id, relation_type) VALUES (?, ?, 'primary')"
      ).bind(articleId, storyId).run();
    }

    await db.prepare(`
      INSERT OR REPLACE INTO story_candidates
      (article_id,candidate_type,novelty,importance,uniqueness,depth,curiosity,evidence_quality,personal_fit,serendipity,status,reason,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?, 'selected', ?, CURRENT_TIMESTAMP)
    `).bind(
      ids[0], "selected",
      story.novelty || null, story.importance || null, story.uniqueness || null,
      story.depth || null, story.curiosity || null, null, story.personal_fit || null,
      story.serendipity || null, story.summary || story.topic || "selected"
    ).run();

    for (const claim of Array.isArray(story.claims) ? story.claims : []) {
      const insertedClaim = await db.prepare(`
        INSERT INTO claims (story_id,claim_type,text,status,confidence,attribution)
        VALUES (?,?,?,?,?,?)
        RETURNING id
      `).bind(
        storyId,
        claim.claim_type || "FACT",
        claim.text || "",
        claim.status || "unverified",
        Number.isFinite(Number(claim.confidence)) ? Number(claim.confidence) : null,
        claim.attribution || null
      ).first();

      for (const evidenceId of Array.isArray(claim.evidence_article_ids) ? claim.evidence_article_ids : []) {
        const articleId = Number(evidenceId);
        if (!ids.includes(articleId)) continue;
        await db.prepare(`
          INSERT INTO evidence (claim_id,article_id,evidence_type,independence_group,strength,notes)
          VALUES (?,?, 'reporting', ?, ?, ?)
        `).bind(
          insertedClaim.id,
          articleId,
          `source:${articleId}`,
          Number(claim.confidence || 0.5),
          claim.attribution || null
        ).run();
      }
    }

    await db.prepare(`
      INSERT INTO editorials (story_id,mode,language,title,body,source_language)
      VALUES (?, ?, 'zh-TW', ?, ?, 'multi')
    `).bind(
      storyId,
      story.mode || "feature",
      story.title || "Untitled",
      story.script || ""
    ).run();

    storyIds.push(storyId);
  }

  const body = [
    episode.episode?.intro || "",
    ...episode.stories.map((s) => `\n${s.title || "下一個故事"}\n\n${s.script || ""}`),
    episode.episode?.outro || ""
  ].join("\n").trim().slice(0, MAX_EPISODE_CHARS);

  const title = episode.episode?.title || `Global Discovery ${taiwanDate()}`;
  const editorial = await db.prepare(`
    INSERT INTO editorials (story_id,mode,language,title,body,source_language)
    VALUES (NULL,'episode','zh-TW',?,?,'multi')
    RETURNING id
  `).bind(title, body).first();

  await db.prepare(
    "UPDATE daily_pipeline_runs SET editorial_id=?, selected_count=?, status='success', finished_at=CURRENT_TIMESTAMP WHERE id=?"
  ).bind(editorial.id, storyIds.length, runId).run();

  return { editorial_id: editorial.id, selected_count: storyIds.length, title };
}

export class GlobalDiscoveryWorkflow extends WorkflowEntrypoint {
  async run(event, step) {
    const runDate = event?.payload?.run_date || taiwanDate();

    await ensureExtendedTables(this.env.DB);
    await staleCleanup(this.env.DB);

    const current = await this.env.DB.prepare(`
      SELECT id,editorial_id,status,started_at
      FROM daily_pipeline_runs
      WHERE run_date=? ORDER BY id DESC LIMIT 1
    `).bind(runDate).first();

    if (current?.status === "success") {
      return { status: "already_done", run_id: current.id, editorial_id: current.editorial_id };
    }

    if (current?.status === "running") {
      return { status: "already_running", run_id: current.id };
    }

    const run = await this.env.DB.prepare(
      "INSERT INTO daily_pipeline_runs (run_date) VALUES (?) RETURNING id"
    ).bind(runDate).first();
    const runId = run.id;

    try {
      const collection = await step.do("collect global source pool", {
        retries: { limit: 4, delay: "20 seconds", backoff: "exponential" }
      }, async () => {
        return await runCollection(this.env.DB, "workflow");
      });

      await this.env.DB.prepare(
        "UPDATE daily_pipeline_runs SET collection_run_id=? WHERE id=?"
      ).bind(collection.run_id, runId).run();

      const candidates = await step.do("prepare candidate pool", async () => {
        const rows = await getCandidates(this.env.DB);
        await this.env.DB.prepare(
          "UPDATE daily_pipeline_runs SET candidate_count=? WHERE id=?"
        ).bind(rows.length, runId).run();
        if (!rows.length) throw new Error("No article candidates available");
        return rows;
      });

      const groups = await step.do("select stories", {
        retries: { limit: 3, delay: "15 seconds", backoff: "exponential" }
      }, async () => chooseGroups(this.env, candidates));

      const dossiers = await step.do("research selected stories", {
        retries: { limit: 2, delay: "20 seconds", backoff: "exponential" }
      }, async () => buildDossiers(this.env, this.env.DB, groups, candidates));

      if (!dossiers.length) throw new Error("No research dossiers could be built");

      const episode = await step.do("write Traditional Chinese episode", {
        retries: { limit: 3, delay: "20 seconds", backoff: "exponential" }
      }, async () => generateEpisode(this.env, dossiers));

      return await step.do("save episode and claims", {
        retries: { limit: 3, delay: "20 seconds", backoff: "exponential" }
      }, async () => saveEpisode(this.env.DB, runId, candidates, episode));
    } catch (error) {
      await this.env.DB.prepare(
        "UPDATE daily_pipeline_runs SET status='failed', error=?, finished_at=CURRENT_TIMESTAMP WHERE id=?"
      ).bind(String(error), runId).run();
      throw error;
    }
  }
}
