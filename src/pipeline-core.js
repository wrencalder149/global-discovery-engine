const TEXT_MODEL = "@cf/zai-org/glm-4.7-flash";
const MAX_ARTICLE_TEXT = 12000;
const MAX_DOSSIER_TEXT = 60000;

export function cleanText(value) {
  return String(value || "").replace(/\u0000/g, "").replace(/\s+/g, " ").trim();
}

export function taiwanDate() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function responseText(result) {
  if (!result) return "";
  if (typeof result === "string") return result;
  if (typeof result.response === "string") return result.response;
  if (result.result && typeof result.result.response === "string") return result.result.response;
  if (result.choices?.[0]?.message?.content) return result.choices[0].message.content;
  if (result.choices?.[0]?.text) return result.choices[0].text;
  return "";
}

function parseJson(text) {
  const raw = cleanText(text).replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  try { return JSON.parse(raw); }
  catch (_) {
    const first = raw.indexOf("{");
    const last = raw.lastIndexOf("}");
    if (first >= 0 && last > first) return JSON.parse(raw.slice(first, last + 1));
    throw new Error("AI did not return valid JSON");
  }
}

async function aiCall(env, system, user, maxCompletionTokens) {
  if (!env.AI) throw new Error("Workers AI binding is not available");
  const result = await env.AI.run(TEXT_MODEL, {
    messages: [{ role: "system", content: system }, { role: "user", content: user }],
    max_completion_tokens: maxCompletionTokens,
    temperature: 0.2,
    reasoning_effort: "low"
  });
  const text = responseText(result);
  if (!text) throw new Error("Workers AI returned no text");
  return text;
}

export async function staleCleanup(db) {
  try { await db.prepare("ALTER TABLE daily_pipeline_runs ADD COLUMN workflow_id TEXT").run(); } catch (_) {}
  try { await db.prepare("ALTER TABLE daily_pipeline_runs ADD COLUMN stage TEXT").run(); } catch (_) {}
  await db.prepare("UPDATE daily_pipeline_runs SET status='failed', error='stale run recovered by Workflow', finished_at=CURRENT_TIMESTAMP, stage='recovered' WHERE status='running' AND started_at < datetime('now','-45 minutes')").run();
}

export async function chooseGroups(env, articles) {
  const compact = articles.map((a) => ({
    id: a.id, title: a.title, source: a.source_name,
    region: a.region || a.source_country || a.country || "unknown",
    excerpt: cleanText(a.excerpt || "").slice(0, 500)
  }));
  const system = "Select exactly 3 groups. roles: briefing, feature, culture. briefing=timely with context. feature=deep longform. culture=music/restored film/literature/design/history. Reject Marvel and box office. JSON only: {\"groups\":[{\"article_ids\":[1],\"role\":\"briefing\",\"title\":\"...\",\"topic\":\"...\",\"why\":\"...\"}]}";
  const output = parseJson(await aiCall(env, system, JSON.stringify({ articles: compact }), 2000));
  const validIds = new Set(articles.map((a) => a.id));
  return (Array.isArray(output.groups) ? output.groups : [])
    .map((g) => ({ ...g, article_ids: Array.isArray(g.article_ids) ? g.article_ids.map(Number).filter((id) => validIds.has(id)) : [] }))
    .filter((g) => g.article_ids.length)
    .slice(0, 3);
}

async function fetchArticleText(env, article) {
  if (article.raw_content && article.raw_content.length > 400) return article.raw_content;
  const response = await fetch(article.url, { headers: { "User-Agent": "GlobalDiscoveryEngine/0.4" }, redirect: "follow" });
  if (!response.ok) throw new Error("Article fetch " + response.status);
  const html = await response.text();
  if (env.AI && typeof env.AI.toMarkdown === "function") {
    try {
      const converted = await env.AI.toMarkdown({ name: "article.html", blob: new Blob([html], { type: "text/html" }) }, { conversionOptions: { output: { format: "text" } } });
      if (converted && converted.format !== "error") return cleanText(converted.data).slice(0, MAX_ARTICLE_TEXT);
    } catch (_) {}
  }
  return cleanText(html.replace(/<script[\\s\\S]*?<\\/script>/gi, " ").replace(/<style[\\s\\S]*?<\\/style>/gi, " ").replace(/<[^>]+>/g, " ")).slice(0, MAX_ARTICLE_TEXT);
}

export async function buildDossiers(env, db, groups, articles) {
  const byId = new Map(articles.map((a) => [a.id, a]));
  const dossiers = [];
  for (const group of groups.slice(0, 3)) {
    const members = group.article_ids.map((id) => byId.get(id)).filter(Boolean);
    if (!members.length) continue;
    const primary = members[0];
    let primaryText = cleanText(primary.excerpt || "");
    try {
      primaryText = await fetchArticleText(env, primary);
      await db.prepare("UPDATE articles SET raw_content=?, processing_state='cleaned', fetched_at=CURRENT_TIMESTAMP WHERE id=?").bind(primaryText, primary.id).run();
    } catch (_) {}
    dossiers.push({
      article_ids: group.article_ids,
      role: group.role || group.mode || "feature",
      title: group.title,
      topic: group.topic,
      why: group.why,
      primary: { id: primary.id, source: primary.source_name, title: primary.title, url: primary.url, text: primaryText }
    });
  }
  return dossiers;
}

export async function generateEpisode(env, dossiers) {
  const system = "Write three standalone zh-TW articles. Each story needs mode briefing|feature|culture, title, script, article_ids. Use only provided research. Mark single-source claims. JSON: {\"episode\":{\"title\":\"...\"},\"stories\":[{\"mode\":\"briefing\",\"title\":\"...\",\"script\":\"...\",\"article_ids\":[1]}]}";
  const output = parseJson(await aiCall(env, system, JSON.stringify(dossiers).slice(0, MAX_DOSSIER_TEXT), 7000));
  output.stories = Array.isArray(output.stories) ? output.stories.slice(0, 3) : [];
  return output;
}

export async function saveEpisode(db, runId, selected, episode) {
  const storyIds = [];
  const modes = ["briefing", "feature", "culture"];
  for (const [index, story] of (episode.stories || []).entries()) {
    let ids = Array.isArray(story.article_ids) ? story.article_ids.map(Number).filter((id) => selected.some((a) => a.id === id)) : [];
    if (!ids.length && selected[index]) ids = [selected[index].id];
    if (!ids.length && selected[0]) ids = [selected[0].id];
    const inserted = await db.prepare("INSERT INTO stories (title, summary, topic, status, first_seen_at, last_updated_at) VALUES (?, ?, ?, 'selected', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) RETURNING id").bind(story.title || "Untitled", story.summary || "", story.topic || "").first();
    const storyId = inserted.id;
    for (const articleId of ids) {
      await db.prepare("INSERT OR IGNORE INTO article_stories (article_id, story_id, relation_type) VALUES (?, ?, 'primary')").bind(articleId, storyId).run();
    }
    await db.prepare("INSERT INTO editorials (story_id,mode,language,title,body,source_language) VALUES (?, ?, 'zh-TW', ?, ?, 'multi')").bind(storyId, story.mode || story.role || modes[index] || "feature", story.title || "Untitled", story.script || "").run();
    storyIds.push(storyId);
  }
  const body = (episode.stories || []).map((s) => (s.title || "") + "\n\n" + (s.script || "")).join("\n\n---\n\n");
  const editorial = await db.prepare("INSERT INTO editorials (story_id,mode,language,title,body,source_language) VALUES (NULL,'episode','zh-TW',?,?,'multi') RETURNING id").bind((episode.episode && episode.episode.title) || ("Global Discovery " + taiwanDate()), body).first();
  await db.prepare("UPDATE daily_pipeline_runs SET editorial_id=?, selected_count=?, status='success', stage='complete', finished_at=CURRENT_TIMESTAMP WHERE id=?").bind(editorial.id, storyIds.length, runId).run();
  return { editorial_id: editorial.id, selected_count: storyIds.length };
}
