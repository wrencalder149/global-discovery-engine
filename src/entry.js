import app from "./index.js";
import { ensureExtendedTables } from "./tables.js";
import {
  episodeResponse,
  podcastResponse,
  audioResponse,
  healthResponse
} from "./publish.js";
import { packThree } from "./pack-three.js";
import { GlobalDiscoveryWorkflow } from "./workflow.js";

export { GlobalDiscoveryWorkflow };

const VERSION = "0.6.0";
const LIVE_WORKFLOW_STATES = new Set(["queued", "running", "waiting", "paused"]);

function taiwanDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

async function pipelineStatus(db) {
  return await db.prepare(
    "SELECT id,run_date,status,stage,started_at,finished_at,collection_run_id,workflow_id,candidate_count,selected_count,editorial_id,error FROM daily_pipeline_runs ORDER BY id DESC LIMIT 1"
  ).first();
}

async function readWorkflow(env, workflowId) {
  if (!env.DAILY_DISCOVERY || !workflowId) return null;
  try {
    return await (await env.DAILY_DISCOVERY.get(workflowId)).status();
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
  if (run && run.status === "success") return { recovered_stale_run: false, new_workflow_id: null };
  const workflow = run ? await readWorkflow(env, run.workflow_id) : null;
  if (workflow && LIVE_WORKFLOW_STATES.has(workflow.status)) return { recovered_stale_run: false, new_workflow_id: null };
  const workflow_id = await startWorkflow(env, run ? "recover" : "bootstrap");
  return { recovered_stale_run: true, new_workflow_id: workflow_id };
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/health") return healthResponse(env.DB);
    if (url.pathname === "/podcast.xml" || url.pathname === "/feed.xml") return podcastResponse(request, env.DB);
    if (url.pathname === "/episode" || url.pathname.startsWith("/episode/")) {
      return episodeResponse(env.DB, url.pathname.split("/")[2]);
    }
    if (url.pathname.startsWith("/audio/")) {
      return audioResponse(request, env, url.pathname.split("/")[2]);
    }
    if (url.pathname === "/rebuild") {
      await ensureExtendedTables(env.DB);
      const packed = await packThree(env.DB, null);
      return Response.json({ ok: true, version: VERSION, packed });
    }
    if (url.pathname === "/run") {
      const extra = await recoverIfNeeded(env);
      return Response.json({ ok: true, version: VERSION, ...extra });
    }
    if (url.pathname === "/status") {
      const pipeline = await pipelineStatus(env.DB);
      const workflow = pipeline ? await readWorkflow(env, pipeline.workflow_id) : null;
      return Response.json({ ok: true, version: VERSION, pipeline, workflow });
    }
    if (url.pathname === "/") {
      return Response.json({
        name: "Global Discovery Engine",
        status: "online",
        version: VERSION,
        rss: "/podcast.xml",
        pipeline: await pipelineStatus(env.DB)
      });
    }
    if (typeof app.fetch === "function") return app.fetch(request, env, ctx);
    return new Response("Not found", { status: 404 });
  },
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(recoverIfNeeded(env));
  }
};
