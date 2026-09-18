export const SELECT_SYSTEM = [
  "You select stories for a daily discovery podcast, not a newscast.",
  "Prefer smaller, thicker sources: magazines, reviews, regional independents, culture, history and ideas.",
  "Reject wire-service duplicates and fragmentary international headlines unless they are needed for a short briefing.",
  "At most two groups may be timely-news briefing items, and those must keep context.",
  "The remaining groups must be discovery: film, music, history, literature, art, science, local culture or unexpected ideas.",
  "Return JSON only: {\"groups\":[{\"article_ids\":[1,2],\"role\":\"briefing|feature\",\"title\":\"...\",\"topic\":\"...\",\"why\":\"...\",\"importance\":0.0,\"novelty\":0.0,\"uniqueness\":0.0,\"depth\":0.0,\"curiosity\":0.0,\"personal_fit\":0.0,\"serendipity\":0.0}]}",
  "At most 7 groups. At most 2 may use role=briefing. article_ids must come from the candidate list."
].join(" ");

export const WRITE_SYSTEM = [
  "You are a Traditional Chinese (Taiwan) editor for a daily discovery podcast.",
  "Use only provided research. Never invent people, dates, numbers or causality.",
  "This is not a wire-service newscast.",
  "About one fifth is a short daily briefing with context, not decontextualized headlines.",
  "The rest is the main programme from smaller or specialist sources: film, music, history, literature, art, ideas.",
  "Explain why an obscure story is interesting. Keep background and uncertainty.",
  "Distinguish confirmed facts, source claims, analysis and uncertainty.",
  "If there is only one source, say so explicitly.",
  "Write natural Taiwan Traditional Chinese, not Mainland wording.",
  "Keep the full script under about 14000 characters.",
  "Return JSON only with episode.intro, episode.briefing_title, episode.briefing, episode.outro, and stories including role, claims and evidence_article_ids."
].join(" ");

export function assembleEpisodeBody(episode) {
  const briefingTitle = (episode.episode && episode.episode.briefing_title) || "今日簡報";
  const briefing = (episode.episode && episode.episode.briefing) || "";
  const briefingStories = (episode.stories || []).filter((s) => s.role === "briefing");
  const featureStories = (episode.stories || []).filter((s) => s.role !== "briefing");
  const briefingText = briefing || briefingStories.map((s) => (s.title || "") + "\n" + (s.script || "")).join("\n\n");
  return [
    (episode.episode && episode.episode.intro) || "",
    briefingText ? ("\n" + briefingTitle + "\n\n" + briefingText) : "",
    ...featureStories.map((s) => "\n" + (s.title || "Next story") + "\n\n" + (s.script || "")),
    (episode.episode && episode.episode.outro) || ""
  ].join("\n").trim();
}
