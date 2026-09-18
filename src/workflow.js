import { WorkflowEntrypoint } from "cloudflare:workers";
import { ensureExtendedTables } from "./tables.js";
import { runCollectionSteps } from "./daily-steps.js";
import { packThree } from "./pack-three.js";

function taiwanDate() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

export class GlobalDiscoveryWorkflow extends WorkflowEntrypoint {
  async run(event, step) {
    const runDate = (event && event.payload && event.payload.run_date) || taiwanDate();
    await ensureExtendedTables(this.env.DB);

    const current = await this.env.DB.prepare(
      "SELECT id,editorial_id,status,workflow_id FROM daily_pipeline_runs WHERE run_date=? ORDER BY id DESC LIMIT 1"
    ).bind(runDate).first();

    if (current && current.status === "success") {
      const sample = await this.env.DB.prepare(
        "SELECT body FROM editorials WHERE mode IN ('briefing','feature','culture') ORDER BY id DESC LIMIT 1"
      ).first();
      if (sample && sample.body && sample.body.indexOf("小篇 ") === -1 && sample.body.indexOf("連結：") === -1) {
        return { status: "already_done", run_id: current.id, editorial_id: current.editorial_id };
      }
    }

    const sameInstance = current && current.workflow_id === event.instanceId;
    let runId = current && current.id;
    if (current && current.status === "running" && !sameInstance) {
      return { status: "already_running", run_id: current.id, workflow_id: current.workflow_id };
    }
    if (!current || current.status === "success" || current.status === "failed") {
      const run = await this.env.DB.prepare(
        "INSERT INTO daily_pipeline_runs (run_date, workflow_id, stage, status) VALUES (?, ?, 'created', 'running') RETURNING id"
      ).bind(runDate, event.instanceId).first();
      runId = run.id;
    }

    try {
      await runCollectionSteps(this.env, step, runId);
      await this.env.DB.prepare("UPDATE daily_pipeline_runs SET stage='writing_episode' WHERE id=?").bind(runId).run();
      return await step.do("pack three text articles", async () => packThree(this.env, runId));
    } catch (error) {
      await this.env.DB.prepare(
        "UPDATE daily_pipeline_runs SET status='failed', stage='failed', error=?, finished_at=CURRENT_TIMESTAMP WHERE id=?"
      ).bind(String(error), runId).run();
      throw error;
    }
  }
}
