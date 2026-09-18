import app from "./index.js";
import { ensureExtendedTables } from "./tables.js";
import {
  episodeResponse,
  podcastResponse,
  audioResponse,
  healthResponse
} from "./publish.js";
import { GlobalDiscoveryWorkflow } from "./workflow.js";

export { GlobalDiscoveryWorkflow };

const VERSION = "0.3.5";
const STALE_AFTER_MS = 45 * 60 * 1000;
const LIVE_WORKFLOW_STATES = new Set(["queued", "running", "waiting", "paused"]);

function taiwanDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

function isTimedOut(run) {
  if (!run || run.status !== "running" || !run.started_at) return false;
  const started = Date.parse(`${String(run.started_at).replace(" ", "T")}Z`);
  return Number.isFinite(started) && Date.now() - started > STALE_AFTER_MS;
}

async function pipelineStatus(db) {
  const runDate = taiwanDate();
  const row = await db.prepare(
    "SELECT id,run_date,status,stage,started_at,finished_at,collection_run_id,workflow_id,candidate_count,selected_count,editorial_id,error FROM daily_pipeline_runs WHERE run_date=? ORDER BY id DESC LIMIT 1"
  ).bind(runDate).first();
  return row || null;
}

async function readWorkflow(env, workflowId) {
  if (!workflowId || !env.DAILY_DISCOVERY) return null;
  try {
    const instance = await env.DAILY_DISCOVERY.get(workflowId);
    return await instance.status();
  } catch (error) {
    return { status: "unknown", error: String(error) };
  }
}

function workflowAlive(workflow) {
  const status = String(workflow?.status || "").toLowerCase();
  return LIVE_WORKFLOW_STATES.has(status);
}

function workflowDead(workflow) {
  if (!workflow) return true;
  const status = String(workflow.status || "").toLowerCase();
  return status === "errored" || status === "terminated" || status === "unknown" || status === "cancelled" || status === "complete";
}

async function startWorkflow(env, trigger = "http") {
  const runDate = taiwanDate();
  const id = `${trigger}-${runDate}-${crypto.randomUUID()}`;
  return env.DAILY_DISCOVERY.create({
    id,
    params: { run_date: runDate, trigger }
  });
}

async function markRecovered(db, runId, reason) {
  await db.prepare(
    "UPDATE daily_pipeline_runs SET status='failed', stage='recovered', error=?, finished_at=CURRENT_TIMESTAMP WHERE id=?"
  ).bind(reason, runId).run();
}

async function recoverIfNeeded(env, pipeline) {
  if (!pipeline || pipeline.status === "success") {
    return { pipeline, recovered: false };
  }

  if (pipeline.status !== "running") {
    return { pipeline, recovered: false };
  }

  const workflow = await readWorkflow(env, pipeline.workflow_id);

  if (pipeline.workflow_id && workflowAlive(workflow)) {
    return { pipeline, workflow, recovered: false };
  }

  if (String(workflow?.status || "").toLowerCase() === "complete" && pipeline.status === "running") {
    const latest = await pipelineStatus(env.DB);
    if (latest?.status === "success") return { pipeline: latest, workflow, recovered: false };
  }

  const missingId = pipeline.status === "running" && !pipeline.workflow_id;
  const dead = pipeline.workflow_id && workflowDead(workflow);
  const timedOut = isTimedOut(pipeline) && !workflowAlive(workflow);

  if (!missingId && !dead && !timedOut) {
    return { pipeline, workflow, recovered: false };
  }

  const reason = missingId
    ? "legacy run without Workflow instance ID"
    : dead
      ? `workflow ${workflow?.status || "missing"} recovered by /status`
      : "stale run recovered by /status";

  await markRecovered(env.DB, pipeline.id, reason);
  const instance = await startWorkflow(env, "recovery");
  const next = await pipelineStatus(env.DB);
  return {
    pipeline: next,
    workflow: { status: "started", id: instance.id },
    recovered: true,
    recovered_legacy_run: missingId,
    recovered_stale_run: timedOut || dead,
    new_workflow_id: instance.id
  };
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    await ensureExtendedTables(env.DB);

    try {
      if (url.pathname === "/") {
        const current = await pipelineStatus(env.DB);
        const recovered = await recoverIfNeeded(env, current);

        if (recovered.recovered) {
          return Response.json({
            name: "Global Discovery Engine",
            status: "online",
            version: VERSION,
            pipeline: {
              status: "started",
              workflow_id: recovered.new_workflow_id,
              run_date: taiwanDate(),
              recovered_stale_run: Boolean(recovered.recovered_stale_run),
              recovered_legacy_run: Boolean(recovered.recovered_legacy_run)
            }
          });
        }

        if (!current || current.status === "failed") {
          const instance = await startWorkflow(env, "bootstrap");
          return Response.json({
            name: "Global Discovery Engine",
            status: "online",
            version: VERSION,
            pipeline: {
              status: "started",
              workflow_id: instance.id,
              run_date: taiwanDate()
            }
          });
        }

        return Response.json({
          name: "Global Discovery Engine",
          status: "online",
          version: VERSION,
          pipeline: current
        });
      }

      if (url.pathname === "/run") {
        const current = await pipelineStatus(env.DB);
        const recovered = await recoverIfNeeded(env, current);
        if (recovered.recovered) {
          return Response.json({
            ok: true,
            status: "started",
            workflow_id: recovered.new_workflow_id,
            recovered: true
          });
        }
        if (current?.status === "running") {
          return Response.json({ ok: true, status: "already_running", run_id: current.id, workflow_id: current.workflow_id, stage: current.stage });
        }
        if (current?.status === "success") {
          return Response.json({ ok: true, status: "already_done", run_id: current.id, editorial_id: current.editorial_id });
        }
        const instance = await startWorkflow(env, "manual");
        return Response.json({ ok: true, status: "started", workflow_id: instance.id });
      }

      if (url.pathname === "/episode") return episodeResponse(env.DB);

      const episodeMatch = url.pathname.match(/^\/episode\/(\d+)$/);
      if (episodeMatch) return episodeResponse(env.DB, episodeMatch[1]);

      if (url.pathname === "/podcast.xml") return podcastResponse(request, env.DB);

      const audioMatch = url.pathname.match(/^\/audio\/(\d+)$/);
      if (audioMatch) return audioResponse(request, env, audioMatch[1]);

      if (url.pathname === "/ai-health") return healthResponse(env.DB);

      if (url.pathname === "/status") {
        const current = await pipelineStatus(env.DB);
        const recovered = await recoverIfNeeded(env, current);
        const workflow = recovered.workflow || await readWorkflow(env, recovered.pipeline?.workflow_id);

        return Response.json({
          ok: true,
          version: VERSION,
          pipeline: recovered.pipeline,
          workflow,
          recovered_legacy_run: Boolean(recovered.recovered_legacy_run),
          recovered_stale_run: Boolean(recovered.recovered_stale_run),
          new_workflow_id: recovered.new_workflow_id || null
        });
      }

      return app.fetch(request, env, ctx);
    } catch (error) {
      console.error(error);
      return Response.json({ ok: false, error: String(error) }, { status: 500 });
    }
  },

  async scheduled(controller, env, ctx) {
    await ensureExtendedTables(env.DB);
    try {
      const current = await pipelineStatus(env.DB);
      const recovered = await recoverIfNeeded(env, current);
      if (recovered.recovered) return;
      if (current?.status === "success" || current?.status === "running") return;

      await startWorkflow(env, "cron");
    } catch (error) {
      console.error("scheduled workflow trigger", error);
    }
  }
};
