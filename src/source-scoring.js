function clamp(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0.5;
  return Math.max(0.05, Math.min(0.95, n));
}

export async function applyStorySourceScores(db, stories, selectedArticles) {
  const byId = new Map((selectedArticles || []).map((row) => [Number(row.id), row]));
  const tally = new Map();

  for (const story of stories || []) {
    const ids = Array.isArray(story.article_ids) ? story.article_ids.map(Number).filter((id) => byId.has(id)) : [];
    if (!ids.length) continue;
    const uniqueSources = new Set(ids.map((id) => byId.get(id).source_name));
    const multi = uniqueSources.size > 1;
    const claims = Array.isArray(story.claims) ? story.claims : [];
    const singleSourceClaims = claims.filter((claim) => String(claim.status || "").includes("single")).length;

    for (const articleId of ids) {
      const article = byId.get(articleId);
      const current = tally.get(article.source_name) || {
        source_name: article.source_name,
        selected: 0,
        multi: 0,
        single: 0
      };
      current.selected += 1;
      if (multi) current.multi += 1;
      else current.single += 1;
      current.single += singleSourceClaims > 0 ? 1 : 0;
      tally.set(article.source_name, current);
    }
  }

  for (const item of tally.values()) {
    const source = await db.prepare("SELECT id,reliability,discovery_value,originality,depth FROM sources WHERE name=? LIMIT 1")
      .bind(item.source_name).first();
    if (!source) continue;

    const reliabilityDelta = item.multi * 0.03 - item.single * 0.015;
    const discoveryDelta = item.selected * 0.02;
    const nextReliability = clamp(source.reliability + reliabilityDelta);
    const nextDiscovery = clamp(source.discovery_value + discoveryDelta);
    const nextOriginality = clamp(source.originality + (item.multi ? 0.01 : -0.005));

    await db.prepare(`
      UPDATE sources
      SET reliability=?, discovery_value=?, originality=?
      WHERE id=?
    `).bind(nextReliability, nextDiscovery, nextOriginality, source.id).run();

    await db.prepare(`
      INSERT INTO source_observations
        (source_id,reliability,discovery_value,originality,depth,notes)
      VALUES (?,?,?,?,?,?)
    `).bind(
      source.id,
      nextReliability,
      nextDiscovery,
      nextOriginality,
      source.depth,
      `selected=${item.selected};multi=${item.multi};single=${item.single}`
    ).run();
  }

  return { sources_scored: tally.size };
}
