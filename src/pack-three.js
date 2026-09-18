const TEXT_MODEL = "@cf/zai-org/glm-4.7-flash";
const REJECT_RE = /marvel|avengers|box[\s-]?office|blackpink|bts|idol|resident evil|superhero|票房|漫威|韓團|偶像團體|新專輯宣傳/i;
const CULTURE_RE = /film|cinema|music|design|archiv|restor|literat|histor|philosoph|anthrop|museum|classic|exhibit|opera|theatre|typography|建築|電影|音樂|設計|文學|歷史|哲學|人類學|修復|字體|展覽|美術|戲劇|古典|手稿|文物|考古/i;
const NEWS_RE = /elect|war|nato|president|minister|ceasefire|economy|summit|外交|總理|總統|歐盟|選舉|停火|軍事|峰會|制裁|通膨|央行/i;

function clean(value) {
  return String(value || "").replace(/<[^>]+>/g, " ").replace(/&/g, "&").replace(/</g, "<").replace(/>/g, ">").replace(/\s+/g, " ").trim();
}

function taiwanDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

function responseText(result) {
  if (!result) return "";
  if (typeof result === "string") return result;
  if (typeof result.response === "string") return result.response;
  if (result.choices && result.choices[0] && result.choices[0].message) {
    return result.choices[0].message.content || "";
  }
  return "";
}

function bucketOf(row) {
  const text = (row.title || "") + " " + (row.excerpt || "") + " " + (row.source_name || "");
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

const HEADS = {
  briefing: "今日簡報",
  feature: "深度",
  culture: "文化"
};

function compactRows(rows, limit) {
  return rows.slice(0, limit).map((row) => ({
    title: clean(row.title).slice(0, 180),
    source: row.source_name || "unknown",
    language: row.language || "",
    excerpt: clean(row.excerpt || row.raw_content || "").slice(0, 320),
    url: row.url || ""
  }));
}

function looksLikeGoodPack(text) {
  if (!text || text.length < 320) return false;
  // reject known incomplete / dump markers
  if (text.indexOf("小篇 ") >= 0) return false;
  if (text.indexOf("原文：") >= 0) return false;
  if (text.indexOf("待完整編譯") >= 0) return false;
  if (text.indexOf("原文摘要（尚未完整譯寫）") >= 0) return false;
  if (text.indexOf("素材") >= 0 && text.indexOf("來源語言非中文") >= 0) return false;
  if (text.indexOf("今日先收到素材") >= 0) return false;
  if (text.indexOf("用繁中說明來源與重點") >= 0) return false;

  const cjk = (text.match(/[\u4e00-\u9fff]/g) || []).join("").length;
  if (cjk < 280) return false;

  // links must stay at the end; reject early URL dumps
  const linkCount = (text.match(/https?:\/\//g) || []).length;
  if (linkCount >= 10) return false;
  if (linkCount >= 3) {
    const firstLink = text.indexOf("http");
    if (firstLink >= 0 && firstLink < Math.floor(text.length * 0.5)) return false;
  }

  // require structured short entries
  if (!/【\s*\d+\s*】/.test(text) && !/\d+[.、]\s*\S/.test(text)) return false;

  return true;
}

function hasMostlyCjk(s) {
  const t = String(s || "");
  if (!t) return false;
  const cjk = (t.match(/[\u4e00-\u9fff]/g) || []).join("").length;
  return cjk >= Math.min(12, Math.floor(t.length * 0.35));
}

function buildFallback(mode, items, date) {
  // Intentional incomplete marker so isDump / looksLikeDump will reject and trigger rebuild
  const lines = [];
  lines.push(HEADS[mode] + "｜" + date);
  lines.push("");
  lines.push("【系統】AI 編譯未完成，本包仍為待完整編譯狀態，請勿當成正式繁中匯整。");
  lines.push("");
  if (mode === "briefing") {
    lines.push("以下為今日時事合集素材線索（尚未完整譯寫）。");
  } else if (mode === "feature") {
    lines.push("以下為深度與調查合集素材線索（尚未完整譯寫）。");
  } else {
    lines.push("以下為文化與知識合集素材線索（尚未完整譯寫）。");
  }
  lines.push("");

  const links = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const n = i + 1;
    const label = hasMostlyCjk(item.title)
      ? item.title.slice(0, 48)
      : "素材" + n + "（來源語言非中文，待完整編譯）";
    lines.push("【" + n + "】" + label);
    lines.push("來源：" + (item.source || "unknown") + "（目前僅見此來源）");
    const excerpt = item.excerpt || "";
    if (hasMostlyCjk(excerpt) && excerpt.length > 30) {
      lines.push(excerpt.slice(0, 150) + (excerpt.length > 150 ? "…" : ""));
    } else if (excerpt.length > 40) {
      lines.push("原文摘要（尚未完整譯寫）：" + excerpt.slice(0, 100) + "…");
    } else {
      lines.push("此則尚無足夠正文可整理，僅保留來源線索。");
    }
    lines.push("");
    if (item.url) {
      links.push(n + ". " + (item.title ? item.title.slice(0, 40) + " — " : "") + item.url);
    }
  }

  if (links.length) {
    lines.push("——");
    lines.push("原文連結：");
    lines.push(links.join("\n"));
  }

  return {
    title: HEADS[mode] + "｜" + date,
    body: lines.join("\n"),
    count: items.length
  };
}

async function writePack(env, mode, rows, date) {
  const limit = mode === "culture" ? 6 : 8;
  const items = compactRows(rows, limit);
  if (!items.length) {
    return {
      title: HEADS[mode] + "｜" + date,
      body: HEADS[mode] + "｜" + date + "\n\n今日此欄暫無足夠可通過篩選的素材。",
      count: 0
    };
  }

  const system =
    "你是台灣繁體中文資深編輯，只輸出正體中文（台灣用語）。" +
    "任務：把素材寫成一篇「" + HEADS[mode] + "」合集包，不是單篇論文，也不是標題+網址清單。" +
    "格式要求：\n" +
    "1. 開頭一句說明本包性質（時事背景／深度調查／文化知識）。\n" +
    "2. 每則獨立短條：先寫繁中標題（自己重寫，不要貼原文外語標題），再寫 80～160 字背景與脈絡。\n" +
    "3. 單一來源必須寫「目前僅見此來源」。\n" +
    "4. 禁止發明事實；禁止把標題堆在一起；禁止在正文中間放網址。\n" +
    "5. 所有原文連結只能出現在全文最後，用「原文連結：」開頭，每行一條。\n" +
    "6. 直接輸出正文，不要前言、不要 markdown 標題符號。\n" +
    "7. 必須使用【1】【2】這類編號；每則都要有可閱讀的繁中說明，不可只貼外語摘要。";

  if (env.AI && items.length) {
    try {
      const result = await env.AI.run(TEXT_MODEL, {
        messages: [
          { role: "system", content: system },
          {
            role: "user",
            content: JSON.stringify({
              date: date,
              mode: mode,
              pack_name: HEADS[mode],
              items: items
            }).slice(0, 9500)
          }
        ],
        max_completion_tokens: 2800,
        temperature: 0.12
      });
      const text = responseText(result).trim();
      if (looksLikeGoodPack(text)) {
        return {
          title: HEADS[mode] + "｜" + date,
          body: text,
          count: items.length
        };
      }
    } catch (_) {}
  }

  // second attempt with a lighter prompt if first failed
  if (env.AI && items.length) {
    try {
      const lightSystem =
        "只用台灣繁體中文寫「" + HEADS[mode] + "」合集。每則【編號】＋繁中標題＋80字背景。單一來源寫「目前僅見此來源」。連結全部放最後「原文連結：」。禁止外語標題當主文。";
      const result = await env.AI.run(TEXT_MODEL, {
        messages: [
          { role: "system", content: lightSystem },
          {
            role: "user",
            content: JSON.stringify({ date, mode, items: items.slice(0, 6) }).slice(0, 7000)
          }
        ],
        max_completion_tokens: 2200,
        temperature: 0.1
      });
      const text = responseText(result).trim();
      if (looksLikeGoodPack(text)) {
        return {
          title: HEADS[mode] + "｜" + date,
          body: text,
          count: items.length
        };
      }
    } catch (_) {}
  }

  return buildFallback(mode, items, date);
}

export async function packThree(env, runId) {
  const db = env.DB;
  const result = await db
    .prepare(
      "SELECT a.id, a.title, a.url, a.excerpt, a.raw_content, a.language, s.name AS source_name, s.source_type, s.region FROM articles a JOIN sources s ON s.id = a.source_id ORDER BY a.id DESC LIMIT 200"
    )
    .all();
  const rows = uniqueRows(result.results || []).filter((row) => bucketOf(row) !== null);
  if (!rows.length) throw new Error("No collected articles to synthesize");

  const buckets = { briefing: [], feature: [], culture: [] };
  for (const row of rows) {
    const bucket = bucketOf(row);
    if (bucket) buckets[bucket].push(row);
  }
  if (buckets.briefing.length < 3) {
    buckets.briefing.push.apply(buckets.briefing, rows.filter((r) => bucketOf(r) !== "culture").slice(0, 5));
  }
  if (buckets.feature.length < 3) {
    buckets.feature.push.apply(buckets.feature, rows.slice(0, 6));
  }
  if (buckets.culture.length < 2) {
    buckets.culture.push.apply(
      buckets.culture,
      rows.filter((r) => CULTURE_RE.test((r.title || "") + " " + (r.excerpt || ""))).slice(0, 4)
    );
  }

  const date = taiwanDate();
  const saved = [];
  for (const mode of ["briefing", "feature", "culture"]) {
    const item = await writePack(env, mode, buckets[mode], date);
    const story = await db
      .prepare(
        "INSERT INTO stories (title, summary, topic, status, first_seen_at, last_updated_at) VALUES (?, ?, ?, 'selected', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) RETURNING id"
      )
      .bind(item.title, item.title, mode)
      .first();
    const editorial = await db
      .prepare(
        "INSERT INTO editorials (story_id,mode,language,title,body,source_language) VALUES (?, ?, 'zh-TW', ?, ?, 'multi') RETURNING id"
      )
      .bind(story.id, mode, item.title, item.body)
      .first();
    saved.push({ id: editorial.id, mode: mode, title: item.title, pieces: item.count });
  }

  const bundle = await db
    .prepare(
      "INSERT INTO editorials (story_id,mode,language,title,body,source_language) VALUES (NULL,'episode','zh-TW',?,?,'multi') RETURNING id"
    )
    .bind(
      "Global Discovery " + date,
      saved.map((item) => item.title).join("\n")
    )
    .first();

  if (runId) {
    await db
      .prepare(
        "UPDATE daily_pipeline_runs SET candidate_count=?, selected_count=3, editorial_id=?, status='success', stage='complete', finished_at=CURRENT_TIMESTAMP WHERE id=?"
      )
      .bind(rows.length, bundle.id, runId)
      .run();
  }

  return { editorial_id: bundle.id, harvest: rows.length, items: saved };
}
