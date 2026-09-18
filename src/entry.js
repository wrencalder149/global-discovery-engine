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

const VERSION = "0.4.0";
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
  if (!env.DAILY_DISCOVERY || !workflowId) return null;
  try {
    const instance = await env.DAILY_DISCOVERY.get(workflowId);
    return await instance.status();
  } catch (_) {
    return null;
  }
}

async function startWorkflow(env, reason) {
  const runDate = taiwanDate();
  const instance = await env.DAILY_DISCOVERY.create({
    id: `${reason}-${runDate}-${crypto.randomUUID()}`,
    params: { run_date: runDate, reason }
  });
  return instance.id;
}

async function recoverIfNeeded(env) {
  await ensureExtendedTables(env.DB);
  const run = await pipelineStatus(env.DB);
  if (!run) {
    const workflow_id = await startWorkflow(env, "bootstrap");
    return { recovered_legacy_run: false, recovered_stale_run: false, new_workflow_id: workflow_id };
  }
  const workflow = await readWorkflow(env, run.workflow_id);
  const live = workflow && LIVE_WORKFLOW_STATES.has(workflow.status);
  if (run.status === "success") {
    return { recovered_legacy_run: false, recovered_stale_run: false, new_workflow_id: null };
  }
  if (live) {
    return { recovered_legacy_run: false, recovered_stale_run: false, new_workflow_id: null };
  }
  if (run.status === "failed" || isTimedOut(run) || !live) {
    const workflow_id = await startWorkflow(env, "recover");
    return { recovered_legacy_run: false, recovered_stale_run: true, new_workflow_id: workflow_id };
  }
  return { recovered_legacy_run: false, recovered_stale_run: false, new_workflow_id: null };
}

async function statusPayload(env) {
  const pipeline = await pipelineStatus(env.DB);
  const workflow = pipeline ? await readWorkflow(env, pipeline.workflow_id) : null;
  return {
    ok: true,
    version: VERSION,
    pipeline,
    workflow,
    recovered_legacy_run: false,
    recovered_stale_run: false,
    new_workflow_id: null
  };
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/status") {
      const extra = await recoverIfNeeded(env).catch(() => ({}));
      const payload = await statusPayload(env);
      return Response.json({ ...payload, ...extra });
    }
    if (url.pathname === "/health") return healthResponse(env.DB);
    if (url.pathname === "/podcast.xml" || url.pathname === "/feed.xml") return podcastResponse(request, env.DB);
    if (url.pathname === "/episode" || url.pathname.startsWith("/episode/")) {
      const id = url.pathname.split("/")[2];
      return episodeResponse(env.DB, id);
    }
    if (url.pathname.startsWith("/audio/")) {
      const id = url.pathname.split("/")[2];
      return audioResponse(request, env, id);
    }
    if (url.pathname === "/") {
      const extra = await recoverIfNeeded(env).catch((error) => ({ error: String(error) }));
      return Response.json({
        name: "Global Discovery Engine",
        status: "online",
        version: VERSION,
        pipeline: extra.new_workflow_id ? { status: "started", workflow_id: extra.new_workflow_id, run_date: taiwanDate() } : await pipelineStatus(env.DB),
        rss: "/podcast.xml"
      });
    }
    if (typeof app.fetch === "function") return app.fetch(request, env, ctx);
    return new Response("Not found", { status: 404 });
  },
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(recoverIfNeeded(env));
  }
};
