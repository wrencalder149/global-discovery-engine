import app from "./index.js";
import {
  ensureExtendedTables,
  episodeResponse,
  podcastResponse,
  audioResponse,
  healthResponse
} from "./daily.js";
import { GlobalDiscoveryWorkflow } from "./workflow.js";

export { GlobalDiscoveryWorkflow };

function taiwanDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

async function pipelineStatus(db) {
  const runDate = taiwanDate();
  const row = await db.prepare(
    "SELECT id,run_date,status,started_at,finished_at,collection_run_id,candidate_count,selected_count,editorial_id,error FROM daily_pipeline_runs WHERE run_date=? ORDER BY id DESC LIMIT 1"
  ).bind(runDate).first();
  return row || null;
}

async function startWorkflow(env) {
  const runDate = taiwanDate();
  const id = `manual-${runDate}-${crypto.randomUUID()}`;
  return env.DAILY_DISCOVERY.create({
    id,
    params: { run_date: runDate, trigger: "http" }
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    await ensureExtendedTables(env.DB);

    try {
      if (url.pathname === "/") {
        const current = await pipelineStatus(env.DB);

        if (!current || current.status === "failed") {
          const instance = await startWorkflow(env);
          return Response.json({
            name: "Global Discovery Engine",
            status: "online",
            version: "0.3.0",
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
          version: "0.3.0",
          pipeline: current
        });
      }

      if (url.pathname === "/run") {
        const current = await pipelineStatus(env.DB);
        if (current?.status === "running") {
          return Response.json({ ok: true, status: "already_running", run_id: current.id });
        }
        if (current?.status === "success") {
          return Response.json({ ok: true, status: "already_done", run_id: current.id, editorial_id: current.editorial_id });
        }
        const instance = await startWorkflow(env);
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
        return Response.json({
          ok: true,
          version: "0.3.0",
          pipeline: await pipelineStatus(env.DB)
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
      if (current?.status === "running" || current?.status === "success") return;
      await env.DAILY_DISCOVERY.create({
        id: `scheduled-${taiwanDate()}-${crypto.randomUUID()}`,
        params: { run_date: taiwanDate(), trigger: "cron" }
      });
    } catch (error) {
      console.error("scheduled workflow trigger", error);
    }
  }
};
