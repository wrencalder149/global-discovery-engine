export async function ensurePipelineTables(db) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS daily_pipeline_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_date TEXT NOT NULL,
    started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    finished_at TEXT,
    status TEXT NOT NULL DEFAULT 'running',
    collection_run_id INTEGER,
    candidate_count INTEGER DEFAULT 0,
    selected_count INTEGER DEFAULT 0,
    editorial_id INTEGER,
    error TEXT
  )`).run();

  try {
    await db.prepare("ALTER TABLE daily_pipeline_runs ADD COLUMN workflow_id TEXT").run();
  } catch (_) {}
  try {
    await db.prepare("ALTER TABLE daily_pipeline_runs ADD COLUMN stage TEXT").run();
  } catch (_) {}

  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_daily_pipeline_run_date
    ON daily_pipeline_runs(run_date)`).run();
}

export async function ensureExtendedTables(db) {
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
  await ensurePipelineTables(db);
}
