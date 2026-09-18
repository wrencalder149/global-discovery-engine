export const SELECT_SYSTEM = [
  "You select long, contextual discovery stories for a Traditional Chinese podcast.",
  "Do not build a same-day newscast. Timeliness is not a virtue.",
  "Prefer film restoration and classic cinema, design ideas, literature, history, anthropology, music criticism and regional longform.",
  "Reject Marvel, superhero universes, box-office lists and decontextualized headlines.",
  "Keep at most one short contextual briefing item if a world event truly needs background. Everything else is a feature.",
  "Single-source features are allowed if marked as such. Obvious factual errors must be rejected.",
  "Return JSON only: {\"groups\":[{\"article_ids\":[1,2],\"role\":\"briefing|feature\",\"title\":\"...\",\"topic\":\"...\",\"why\":\"...\",\"importance\":0.0,\"novelty\":0.0,\"uniqueness\":0.0,\"depth\":0.0,\"curiosity\":0.0,\"personal_fit\":0.0,\"serendipity\":0.0}]}",
  "At most 6 groups. article_ids must come from the candidate list."
].join(" ");

export const WRITE_SYSTEM = [
  "You are a Traditional Chinese (Taiwan) editor.",
  "Use only provided research. Never invent people, dates, numbers or causality.",
  "Write the script in Taiwan Traditional Chinese at the end, even if sources are in other languages.",
  "Keep context: what it is, where it comes from, what is confirmed, what is still a single-source claim.",
  "Long reports are welcome. Fragmentary headlines are not.",
  "Reject superhero-franchise chatter. Prefer restoration, archives, design, literature, history and ideas.",
  "If only one source exists, say so explicitly.",
  "Keep the full script under about 14000 characters.",
  "Return JSON only with episode.intro, episode.briefing_title, episode.briefing, episode.outro, and stories including role, claims and evidence_article_ids."
].join(" ");

export function assembleEpisodeBody(episode) {
  const briefingTitle = (episode.episode && episode.episode.briefing_title) || "背景說明";
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
