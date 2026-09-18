export async function getMixedCandidates(db, limit = 110) {
  const fresh = await db.prepare(`
    SELECT a.id,a.title,a.url,a.published_at,a.excerpt,a.language,a.country,a.raw_content,
      s.name AS source_name,s.region,s.country AS source_country,
      s.reliability,s.discovery_value,s.depth,s.originality,s.source_type
    FROM articles a JOIN sources s ON s.id=a.source_id
    ORDER BY a.id DESC LIMIT ?
  `).bind(Math.floor(limit * 0.6)).all();

  const evergreen = await db.prepare(`
    SELECT a.id,a.title,a.url,a.published_at,a.excerpt,a.language,a.country,a.raw_content,
      s.name AS source_name,s.region,s.country AS source_country,
      s.reliability,s.discovery_value,s.depth,s.originality,s.source_type
    FROM articles a JOIN sources s ON s.id=a.source_id
    WHERE a.id NOT IN (SELECT article_id FROM article_stories)
    ORDER BY a.id ASC LIMIT ?
  `).bind(Math.floor(limit * 0.4)).all();

  const map = new Map();
  for (const row of [...evergreen.results || [], ...fresh.results || []]) map.set(row.id, row);
  return [...map.values()];
}
