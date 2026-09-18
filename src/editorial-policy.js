export const SELECT_SYSTEM = [
  "Select exactly 3 story groups for a Traditional Chinese text RSS.",
  "roles must be exactly: briefing, feature, culture.",
  "briefing: one short contextual note on a timely world event. Keep background. No headline dump.",
  "feature: one deep report or idea piece. Length is welcome. Not breaking news.",
  "culture: one piece on music, classic/restored film, literature, design, history or anthropology.",
  "Reject Marvel, box office, decontextualized wires. Single-source is allowed if marked.",
  "Reject obvious factual errors.",
  "Return JSON only: {\"groups\":[{\"article_ids\":[1],\"role\":\"briefing|feature|culture\",\"title\":\"...\",\"topic\":\"...\",\"why\":\"...\",\"importance\":0.0,\"novelty\":0.0,\"uniqueness\":0.0,\"depth\":0.0,\"curiosity\":0.0,\"personal_fit\":0.0,\"serendipity\":0.0}]}"
].join(" ");

export const WRITE_SYSTEM = [
  "Write three standalone Traditional Chinese (Taiwan) articles, not one podcast script.",
  "Each story must include mode equal to briefing, feature or culture, plus title and script.",
  "briefing: shorter, still with context. feature: long investigative or idea essay. culture: music/film restoration/literature/design/history.",
  "Translate into zh-TW only at the end. Use only provided research. Do not invent facts.",
  "If a claim has one source, say so. Obvious errors must be dropped.",
  "No audio directions. No host banter.",
  "Return JSON: {\"episode\":{\"title\":\"...\"},\"stories\":[{\"mode\":\"briefing\",\"title\":\"...\",\"script\":\"...\",\"claims\":[],\"evidence_article_ids\":[]}]}"
].join(" ");

export function assembleEpisodeBody(episode) {
  const stories = episode.stories || [];
  return stories.map((s) => {
    const mode = s.mode || s.role || "feature";
    return "【" + mode + "】" + (s.title || "") + "\n\n" + (s.script || "");
  }).join("\n\n---\n\n").trim();
}
