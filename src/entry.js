import app from "./index.js";
import {
  ensureExtendedTables,
  runDailyPipeline,
  episodeResponse,
  podcastResponse,
  audioResponse,
  healthResponse
} from "./daily.js";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    await ensureExtendedTables(env.DB);

    try {
      if (url.pathname === "/") {
        ctx.waitUntil(
          runDailyPipeline(env).catch((error) => console.error("daily pipeline", error))
        );
        return app.fetch(request, env, ctx);
      }

      if (url.pathname === "/run") {
        ctx.waitUntil(
          runDailyPipeline(env).catch((error) => console.error("daily pipeline", error))
        );
        return Response.json({ ok: true, status: "started" });
      }

      if (url.pathname === "/episode") return episodeResponse(env.DB);

      const episodeMatch = url.pathname.match(/^\/episode\/(\d+)$/);
      if (episodeMatch) return episodeResponse(env.DB, episodeMatch[1]);

      if (url.pathname === "/podcast.xml") return podcastResponse(request, env.DB);

      const audioMatch = url.pathname.match(/^\/audio\/(\d+)$/);
      if (audioMatch) return audioResponse(request, env, audioMatch[1]);

      if (url.pathname === "/ai-health") return healthResponse(env.DB);

      return app.fetch(request, env, ctx);
    } catch (error) {
      console.error(error);
      return Response.json({ ok: false, error: String(error) }, { status: 500 });
    }
  },

  async scheduled(controller, env, ctx) {
    await ensureExtendedTables(env.DB);
    ctx.waitUntil(
      runDailyPipeline(env).catch((error) => console.error("scheduled daily pipeline", error))
    );
  }
};
