import { runCollectionPhase } from "./collect-phases.js";

export async function runCollectionSteps(env, step, runId) {
  await env.DB.prepare("UPDATE daily_pipeline_runs SET stage='collecting' WHERE id=?").bind(runId).run();

  const news = await step.do("collect news sources", {
    retries: { limit: 3, delay: "20 seconds", backoff: "exponential" }
  }, async () => runCollectionPhase(env.DB, "workflow", "news"));

  await step.do("collect culture sources", {
    retries: { limit: 3, delay: "20 seconds", backoff: "exponential" }
  }, async () => runCollectionPhase(env.DB, "workflow", "culture"));

  await step.do("collect rotating sources", {
    retries: { limit: 3, delay: "20 seconds", backoff: "exponential" }
  }, async () => runCollectionPhase(env.DB, "workflow", "rotate"));

  const gdelt = await step.do("collect gdelt radar", {
    retries: { limit: 3, delay: "20 seconds", backoff: "exponential" }
  }, async () => runCollectionPhase(env.DB, "workflow", "gdelt"));

  await env.DB.prepare(
    "UPDATE daily_pipeline_runs SET collection_run_id=? WHERE id=?"
  ).bind(gdelt.run_id || news.run_id, runId).run();

  return { news, gdelt };
}
