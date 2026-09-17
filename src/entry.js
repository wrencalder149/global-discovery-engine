import app from "./index.js";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // A normal browser visit can kick off the first collection run.
    // The existing /collect endpoint remains rate-limited to prevent abuse.
    if (url.pathname === "/") {
      const trigger = new Request(new URL("/collect", url), {
        method: "POST",
        headers: request.headers
      });
      ctx.waitUntil(app.fetch(trigger, env, ctx));
    }

    return app.fetch(request, env, ctx);
  },

  async scheduled(controller, env, ctx) {
    return app.scheduled(controller, env, ctx);
  }
};
