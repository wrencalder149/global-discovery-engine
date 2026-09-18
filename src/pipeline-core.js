const TEXT_MODEL = "@cf/zai-org/glm-4.7-flash";

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
  const compact = articles.slice(0, 36).map((a) => ({
    id: a.id,
    title: a.title,
    source: a.source_name,
    region: a.region || a.country || "unknown",
    excerpt: cleanText(a.excerpt || a.raw_content || "").slice(0, 280)
  }));
  const system = "Pick exactly 3 items. roles briefing, feature, culture. briefing=timely with context. feature=deep. culture=music/film restoration/literature/design/history. JSON {\"groups\":[{\"article_ids\":[1],\"role\":\"briefing\",\"title\":\"...\"}]}";
  const output = parseJson(await aiCall(env, system, JSON.stringify(compact), 1600));
  const validIds = new Set(articles.map((a) => a.id));
  const groups = (Array.isArray(output.groups) ? output.groups : [])
    .map((g) => ({ ...g, article_ids: Array.isArray(g.article_ids) ? g.article_ids.map(Number).filter((id) => validIds.has(id)) : [] }))
    .filter((g) => g.article_ids.length)
    .slice(0, 3);
  if (groups.length >= 3) return groups;
  const fallback = articles.slice(0, 3).map((a, i) => ({ article_ids: [a.id], role: ["briefing", "feature", "culture"][i], title: a.title }));
  return groups.concat(fallback).slice(0, 3);
}

export async function buildDossiers(env, db, groups, articles) {
  const byId = new Map(articles.map((a) => [a.id, a]));
  return (groups || []).slice(0, 3).map((group) => {
    const primary = (group.article_ids || []).map((id) => byId.get(id)).find(Boolean) || articles[0];
    return {
      article_ids: [primary.id],
      role: group.role || "feature",
      title: group.title || primary.title,
      primary: {
        id: primary.id,
        source: primary.source_name,
        title: primary.title,
        url: primary.url,
        text: cleanText(primary.raw_content || primary.excerpt || primary.title).slice(0, 2500)
      }
    };
  }).filter((row) => row.primary && row.primary.id);
}

export async function generateEpisode(env, dossiers) {
  const system = "Write 3 zh-TW standalone articles. Each needs mode briefing|feature|culture, title, script, article_ids. Use only provided notes. Say if single-source. JSON {\"episode\":{\"title\":\"...\"},\"stories\":[{\"mode\":\"briefing\",\"title\":\"...\",\"script\":\"...\",\"article_ids\":[1]}]}";
  const output = parseJson(await aiCall(env, system, JSON.stringify(dossiers).slice(0, 20000), 5000));
  output.stories = Array.isArray(output.stories) ? output.stories.slice(0, 3) : [];
  if (output.stories.length < 3) {
    for (const [i, d] of dossiers.entries()) {
      if (output.stories.length >= 3) break;
      output.stories.push({ mode: d.role || ["briefing", "feature", "culture"][i], title: d.title, script: d.primary.text, article_ids: d.article_ids });
    }
  }
  return output;
}

export async function saveEpisode(db, runId, selected, episode) {
  const modes = ["briefing", "feature", "culture"];
  let count = 0;
  for (const [index, story] of (episode.stories || []).entries()) {
    let ids = Array.isArray(story.article_ids) ? story.article_ids.map(Number).filter((id) => selected.some((a) => a.id === id)) : [];
    if (!ids.length && selected[index]) ids = [selected[index].id];
    const inserted = await db.prepare("INSERT INTO stories (title, summary, topic, status, first_seen_at, last_updated_at) VALUES (?, ?, ?, 'selected', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) RETURNING id").bind(story.title || "Untitled", "", story.mode || modes[index]).first();
    if (ids[0]) await db.prepare("INSERT OR IGNORE INTO article_stories (article_id, story_id, relation_type) VALUES (?, ?, 'primary')").bind(ids[0], inserted.id).run();
    await db.prepare("INSERT INTO editorials (story_id,mode,language,title,body,source_language) VALUES (?, ?, 'zh-TW', ?, ?, 'multi')").bind(inserted.id, story.mode || story.role || modes[index], story.title || "Untitled", story.script || "").run();
    count += 1;
  }
  const body = (episode.stories || []).map((s) => (s.title || "") + "\n\n" + (s.script || "")).join("\n\n---\n\n");
  const editorial = await db.prepare("INSERT INTO editorials (story_id,mode,language,title,body,source_language) VALUES (NULL,'episode','zh-TW',?,?,'multi') RETURNING id").bind((episode.episode && episode.episode.title) || ("Global Discovery " + taiwanDate()), body).first();
  await db.prepare("UPDATE daily_pipeline_runs SET editorial_id=?, selected_count=?, status='success', stage='complete', finished_at=CURRENT_TIMESTAMP WHERE id=?").bind(editorial.id, count, runId).run();
  return { editorial_id: editorial.id, selected_count: count };
}
