import { WorkflowEntrypoint } from "cloudflare:workers";
import { ensureExtendedTables } from "./tables.js";
import { runCollectionSteps } from "./daily-steps.js";
import { getMixedCandidates } from "./candidates.js";
import { staleCleanup, chooseGroups, buildDossiers, generateEpisode, saveEpisode, cleanText, taiwanDate } from "./pipeline-core.js";

export class GlobalDiscoveryWorkflow extends WorkflowEntrypoint {
  async run(event, step) {
    const runDate = (event && event.payload && event.payload.run_date) || taiwanDate();

    await ensureExtendedTables(this.env.DB);
    await staleCleanup(this.env.DB);

    const current = await this.env.DB.prepare(`
      SELECT id,editorial_id,status,started_at,workflow_id
      FROM daily_pipeline_runs
      WHERE run_date=? ORDER BY id DESC LIMIT 1
    `).bind(runDate).first();

    if (current && current.status === "success") {
      return { status: "already_done", run_id: current.id, editorial_id: current.editorial_id };
    }

    let runId = current && current.id;
    const sameInstance = current && current.workflow_id && current.workflow_id === event.instanceId;

    if (current && current.status === "running" && !sameInstance) {
      return { status: "already_running", run_id: current.id, workflow_id: current.workflow_id };
    }

    if (!sameInstance) {
      const run = await this.env.DB.prepare(
        "INSERT INTO daily_pipeline_runs (run_date, workflow_id, stage, status) VALUES (?, ?, 'created', 'running') RETURNING id"
      ).bind(runDate, event.instanceId).first();
      runId = run.id;
    } else {
      await this.env.DB.prepare(
        "UPDATE daily_pipeline_runs SET stage='resumed' WHERE id=?"
      ).bind(runId).run();
    }

    try {
      await runCollectionSteps(this.env, step, runId);

      await this.env.DB.prepare("UPDATE daily_pipeline_runs SET stage='candidate_selection' WHERE id=?").bind(runId).run();
      const candidates = await step.do("prepare candidate pool", async () => {
        const rows = await getMixedCandidates(this.env.DB);
        await this.env.DB.prepare(
          "UPDATE daily_pipeline_runs SET candidate_count=? WHERE id=?"
        ).bind(rows.length, runId).run();
        if (!rows.length) throw new Error("No article candidates available");
        return rows.map((row) => ({
          id: row.id,
          title: row.title,
          url: row.url,
          published_at: row.published_at,
          excerpt: cleanText(row.excerpt || "").slice(0, 800),
          raw_content: cleanText(row.raw_content || "").slice(0, 4000),
          language: row.language,
          country: row.country,
          source_name: row.source_name,
          region: row.region,
          source_country: row.source_country,
          reliability: row.reliability,
          discovery_value: row.discovery_value,
          depth: row.depth,
          originality: row.originality
        }));
      });

      await this.env.DB.prepare("UPDATE daily_pipeline_runs SET stage='selecting_stories' WHERE id=?").bind(runId).run();
      const groups = await step.do("select stories", {
        retries: { limit: 3, delay: "20 seconds", backoff: "exponential" }
      }, async () => chooseGroups(this.env, candidates));

      await this.env.DB.prepare("UPDATE daily_pipeline_runs SET stage='researching' WHERE id=?").bind(runId).run();
      const dossiers = await step.do("research selected stories", {
        retries: { limit: 2, delay: "20 seconds", backoff: "exponential" }
      }, async () => {
        const built = await buildDossiers(this.env, this.env.DB, groups, candidates);
        return built.map((item) => ({
          ...item,
          primary: { ...item.primary, text: cleanText(item.primary && item.primary.text).slice(0, 8000) },
          supporting: (item.supporting || []).map((s) => ({ ...s, text: cleanText(s.text).slice(0, 4000) }))
        }));
      });

      if (!dossiers.length) throw new Error("No research dossiers could be built");

      await this.env.DB.prepare("UPDATE daily_pipeline_runs SET stage='writing_episode' WHERE id=?").bind(runId).run();
      const episode = await step.do("write Traditional Chinese articles", {
        retries: { limit: 3, delay: "20 seconds", backoff: "exponential" }
      }, async () => generateEpisode(this.env, dossiers));

      await this.env.DB.prepare("UPDATE daily_pipeline_runs SET stage='saving_episode' WHERE id=?").bind(runId).run();
      return await step.do("save articles", {
        retries: { limit: 3, delay: "20 seconds", backoff: "exponential" }
      }, async () => saveEpisode(this.env.DB, runId, candidates, episode));
    } catch (error) {
      await this.env.DB.prepare(
        "UPDATE daily_pipeline_runs SET status='failed', stage='failed', error=?, finished_at=CURRENT_TIMESTAMP WHERE id=?"
      ).bind(String(error), runId).run();
      throw error;
    }
  }
}
