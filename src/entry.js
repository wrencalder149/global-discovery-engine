import app from "./index.js";

async function ensureExtendedTables(db) {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS topics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS story_topics (
      story_id INTEGER NOT NULL,
      topic_id INTEGER NOT NULL,
      relation_type TEXT DEFAULT 'primary',
      PRIMARY KEY (story_id, topic_id),
      FOREIGN KEY (story_id) REFERENCES stories(id) ON DELETE CASCADE,
      FOREIGN KEY (topic_id) REFERENCES topics(id) ON DELETE CASCADE
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS claims (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      story_id INTEGER NOT NULL,
      claim_type TEXT NOT NULL,
      text TEXT NOT NULL,
      status TEXT DEFAULT 'unverified',
      confidence REAL,
      attribution TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (story_id) REFERENCES stories(id) ON DELETE CASCADE
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS evidence (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      claim_id INTEGER NOT NULL,
      article_id INTEGER,
      evidence_type TEXT,
      independence_group TEXT,
      strength REAL,
      notes TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (claim_id) REFERENCES claims(id) ON DELETE CASCADE,
      FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE SET NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS editorials (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      story_id INTEGER,
      mode TEXT NOT NULL,
      language TEXT NOT NULL DEFAULT 'zh-TW',
      title TEXT,
      body TEXT,
      source_language TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (story_id) REFERENCES stories(id) ON DELETE SET NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS audio_assets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      editorial_id INTEGER NOT NULL,
      provider TEXT,
      object_key TEXT,
      duration_seconds REAL,
      mime_type TEXT,
      status TEXT DEFAULT 'pending',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (editorial_id) REFERENCES editorials(id) ON DELETE CASCADE
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      story_id INTEGER,
      rating REAL,
      feedback_type TEXT,
      note TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (story_id) REFERENCES stories(id) ON DELETE SET NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS source_observations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_id INTEGER NOT NULL,
      observed_at TEXT DEFAULT CURRENT_TIMESTAMP,
      reliability REAL,
      discovery_value REAL,
      originality REAL,
      locality REAL,
      depth REAL,
      specialization REAL,
      notes TEXT,
      FOREIGN KEY (source_id) REFERENCES sources(id) ON DELETE CASCADE
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS story_candidates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      article_id INTEGER NOT NULL,
      candidate_type TEXT DEFAULT 'discovered',
      novelty REAL,
      importance REAL,
      uniqueness REAL,
      depth REAL,
      curiosity REAL,
      evidence_quality REAL,
      personal_fit REAL,
      serendipity REAL,
      status TEXT DEFAULT 'queued',
      reason TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(article_id),
      FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE
    )`)
  ]);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    await ensureExtendedTables(env.DB);

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
    await ensureExtendedTables(env.DB);
    return app.scheduled(controller, env, ctx);
  }
};
