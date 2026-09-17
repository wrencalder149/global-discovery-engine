-- Operational tables created by the Worker at runtime.
-- This migration is kept in source control for reproducibility.

CREATE TABLE IF NOT EXISTS collection_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mode TEXT NOT NULL,
  started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at TEXT,
  status TEXT NOT NULL DEFAULT 'running',
  rss_items_found INTEGER DEFAULT 0,
  rss_inserted INTEGER DEFAULT 0,
  gdelt_items_found INTEGER DEFAULT 0,
  gdelt_inserted INTEGER DEFAULT 0,
  error_count INTEGER DEFAULT 0,
  error_json TEXT
);

CREATE TABLE IF NOT EXISTS manual_collection_guard (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  last_started_at TEXT
);
