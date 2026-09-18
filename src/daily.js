export { ensurePipelineTables, ensureExtendedTables } from "./tables.js";
import { ensureExtendedTables } from "./tables.js";

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
    .replace(/&/g, "&")
    .replace(/</g, "<")
    .replace(/>/g, ">")
    .replace(/"/g, """)
    .replace(/'/g, "'");
}

function responseText(result) {
  if (!result) return "";
  if (typeof result === "string") return result;
  if (typeof result.response === "string") return result.response;
  if (result.result && typeof result.result.response === "string") return result.result.response;
  const message = result.choices?.[0]?.message;
  if (message) {
    if (typeof message.content === "string") return message.content;
    if (Array.isArray(message.content)) {
      return message.content.map((part) => part?.text || part?.content || "").join("\n");
    }
  }
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

  const system = `You are the story selection engine. Output JSON only.`;
  const user = `articles:\n${JSON.stringify(compact)}`;
  const output = parseJson(await aiCall(env, system, user, 2200));
  const validIds = new Set(articles.map((a) => a.id));
  const groups = Array.isArray(output.groups) ? output.groups : [];
  return groups.map((g) => ({
    ...g,
    article_ids: Array.isArray(g.article_ids) ? g.article_ids.map(Number).filter((id) => validIds.has(id)) : []
  })).filter((g) => g.article_ids.length);
}
