import { WorkflowEntrypoint } from "cloudflare:workers";
import { ensureExtendedTables } from "./tables.js";
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
  if (typeof result.reasoning === "string" && result.reasoning.includes("{")) return result.reasoning;
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
    temperature: 0.2,
    reasoning_effort: "low"
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
  try { await db.prepare("ALTER TABLE daily_pipeline_runs ADD COLUMN workflow_id TEXT").run(); } catch (_) {}
  try { await db.prepare("ALTER TABLE daily_pipeline_runs ADD COLUMN stage TEXT").run(); } catch (_) {}
  await db.prepare(
    "UPDATE daily_pipeline_runs SET status='failed', error='stale run recovered by Workflow', finished_at=CURRENT_TIMESTAMP, stage='recovered' WHERE status='running' AND started_at < datetime('now','-45 minutes')"
  ).run();
  await db.prepare(
    "UPDATE collection_runs SET status='failed', error_json='[{\"stage\":\"recovery\",\"error\":\"stale run recovered by Workflow\"}]', finished_at=CURRENT_TIMESTAMP WHERE status='running' AND started_at < datetime('now','-45 minutes')"
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

  const system = [
    "You are the story selection engine for a global discovery system.",
    "Pick story units worth time, not a popularity ranking.",
    "Balance importance, novelty, uniqueness, depth, curiosity, culture, locality and evidence potential.",
    "Do not let one country, topic or source dominate.",
    "Return JSON only: {\"groups\":[{\"article_ids\":[1,2],\"title\":\"...\",\"topic\":\"...\",\"why\":\"...\",\"importance\":0.0,\"novelty\":0.0,\"uniqueness\":0.0,\"depth\":0.0,\"curiosity\":0.0,\"personal_fit\":0.0,\"serendipity\":0.0}]}",
    "At most 8 groups. article_ids must come from the candidate list."
  ].join(" ");

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
  if (!env.AI || typeof env.AI.toMarkdown !== "function") {
    throw new Error("Workers AI Markdown Conversion is not available");
  }

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
  const system = [
    "You are a Traditional Chinese (Taiwan) global-information podcast editor.",
    "Use only provided research. Never invent people, dates, numbers or causality.",
    "Distinguish confirmed facts, source claims, analysis and uncertainty.",
    "If there is only one source, say so explicitly.",
    "Write natural Taiwan Traditional Chinese, not Mainland wording.",
    "At most 8 stories. Keep the full script under about 14000 characters.",
    "Return JSON only with episode and stories, including claims and evidence_article_ids."
  ].join(" ");

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

    let storyId = existing && existing.id;
    if (!storyId) {
      const inserted = await db.prepare(`
        INSERT INTO stories (title, summary, topic, status, first_seen_at, last_updated_at)
        VALUES (?, ?, ?, 'selected', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        RETURNING id
      `).bind(story.title || "Untitled story", story.summary || "", story.topic || "").first();
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
          "source:" + articleId,
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
    (episode.episode && episode.episode.intro) || "",
    ...episode.stories.map((s) => "\n" + (s.title || "Next story") + "\n\n" + (s.script || "")),
    (episode.episode && episode.episode.outro) || ""
  ].join("\n").trim().slice(0, MAX_EPISODE_CHARS);

  const title = (episode.episode && episode.episode.title) || ("Global Discovery " + taiwanDate());
  const editorial = await db.prepare(`
    INSERT INTO editorials (story_id,mode,language,title,body,source_language)
    VALUES (NULL,'episode','zh-TW',?,?,'multi')
    RETURNING id
  `).bind(title, body).first();

  await db.prepare(
    "UPDATE daily_pipeline_runs SET editorial_id=?, selected_count=?, status='success', stage='complete', finished_at=CURRENT_TIMESTAMP WHERE id=?"
  ).bind(editorial.id, storyIds.length, runId).run();

  return { editorial_id: editorial.id, selected_count: storyIds.length, title };
}

export class GlobalDiscoveryWorkflow extends WorkflowEntrypoint {
  async run(event, step) {
    const runDate = (event && event.payload && event.payload.run_date) || taiwanDate();

    await ensureExtendedTables(this.env.DB);
    await staleCleanup(this.env.DB);

    const current = await this.env.DB.prepare(`
      SELECT id,editorial_id,status,started_at,workflow_id
      FROM daily_pipeline_runs
      WHERE run_date=? ORDER BY id DESC LIMIT 1
    `).bind(runDate).first();

    if (current && current.status === "success") {
      return { status: "already_done", run_id: current.id, editorial_id: current.editorial_id };
    }

    let runId = current && current.id;
    const sameInstance = current && current.workflow_id && current.workflow_id === event.instanceId;

    if (current && current.status === "running" && !sameInstance) {
      return { status: "already_running", run_id: current.id, workflow_id: current.workflow_id };
    }

    if (!sameInstance) {
      const run = await this.env.DB.prepare(
        "INSERT INTO daily_pipeline_runs (run_date, workflow_id, stage, status) VALUES (?, ?, 'created', 'running') RETURNING id"
      ).bind(runDate, event.instanceId).first();
      runId = run.id;
    } else {
      await this.env.DB.prepare(
        "UPDATE daily_pipeline_runs SET stage='resumed' WHERE id=?"
      ).bind(runId).run();
    }

    try {
      await this.env.DB.prepare("UPDATE daily_pipeline_runs SET stage='collecting' WHERE id=?").bind(runId).run();
      const collection = await step.do("collect global source pool", {
        retries: { limit: 4, delay: "20 seconds", backoff: "exponential" }
      }, async () => {
        const result = await runCollection(this.env.DB, "workflow");
        return {
          run_id: result.run_id,
          status: result.status,
          rss_inserted: result.rss_inserted,
          gdelt_inserted: result.gdelt_inserted,
          error_count: Array.isArray(result.errors) ? result.errors.length : 0
        };
      });

      await this.env.DB.prepare(
        "UPDATE daily_pipeline_runs SET collection_run_id=? WHERE id=?"
      ).bind(collection.run_id, runId).run();

      await this.env.DB.prepare("UPDATE daily_pipeline_runs SET stage='candidate_selection' WHERE id=?").bind(runId).run();
      const candidates = await step.do("prepare candidate pool", async () => {
        const rows = await getCandidates(this.env.DB);
        await this.env.DB.prepare(
          "UPDATE daily_pipeline_runs SET candidate_count=? WHERE id=?"
        ).bind(rows.length, runId).run();
        if (!rows.length) throw new Error("No article candidates available");
        return rows.map((row) => ({
          id: row.id,
          title: row.title,
          url: row.url,
          published_at: row.published_at,
          excerpt: cleanText(row.excerpt || "").slice(0, 800),
          raw_content: cleanText(row.raw_content || "").slice(0, 4000),
          language: row.language,
          country: row.country,
          source_name: row.source_name,
          region: row.region,
          source_country: row.source_country,
          reliability: row.reliability,
          discovery_value: row.discovery_value,
          depth: row.depth,
          originality: row.originality
        }));
      });

      await this.env.DB.prepare("UPDATE daily_pipeline_runs SET stage='selecting_stories' WHERE id=?").bind(runId).run();
      const groups = await step.do("select stories", {
        retries: { limit: 3, delay: "15 seconds", backoff: "exponential" }
      }, async () => chooseGroups(this.env, candidates));

      await this.env.DB.prepare("UPDATE daily_pipeline_runs SET stage='researching' WHERE id=?").bind(runId).run();
      const dossiers = await step.do("research selected stories", {
        retries: { limit: 2, delay: "20 seconds", backoff: "exponential" }
      }, async () => {
        const built = await buildDossiers(this.env, this.env.DB, groups, candidates);
        return built.map((item) => ({
          ...item,
          primary: {
            ...item.primary,
            text: cleanText(item.primary && item.primary.text).slice(0, 8000)
          },
          supporting: (item.supporting || []).map((s) => ({
            ...s,
            text: cleanText(s.text).slice(0, 4000)
          }))
        }));
      });

      if (!dossiers.length) throw new Error("No research dossiers could be built");

      await this.env.DB.prepare("UPDATE daily_pipeline_runs SET stage='writing_episode' WHERE id=?").bind(runId).run();
      const episode = await step.do("write Traditional Chinese episode", {
        retries: { limit: 3, delay: "20 seconds", backoff: "exponential" }
      }, async () => generateEpisode(this.env, dossiers));

      await this.env.DB.prepare("UPDATE daily_pipeline_runs SET stage='saving_episode' WHERE id=?").bind(runId).run();
      return await step.do("save episode and claims", {
        retries: { limit: 3, delay: "20 seconds", backoff: "exponential" }
      }, async () => saveEpisode(this.env.DB, runId, candidates, episode));
    } catch (error) {
      await this.env.DB.prepare(
        "UPDATE daily_pipeline_runs SET status='failed', stage='failed', error=?, finished_at=CURRENT_TIMESTAMP WHERE id=?"
      ).bind(String(error), runId).run();
      throw error;
    }
  }
}
