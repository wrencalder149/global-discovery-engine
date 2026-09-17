CREATE TABLE IF NOT EXISTS sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  url TEXT NOT NULL,
  feed_url TEXT,
  language TEXT,
  region TEXT,
  source_type TEXT DEFAULT 'media',
  reliability REAL DEFAULT 0.5,
  discovery_value REAL DEFAULT 0.5,
  originality REAL DEFAULT 0.5,
  locality REAL DEFAULT 0.5,
  depth REAL DEFAULT 0.5,
  specialization REAL DEFAULT 0.5,
  active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TEXT
);

CREATE TABLE IF NOT EXISTS articles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id INTEGER NOT NULL,
  url TEXT NOT NULL UNIQUE,
  canonical_url TEXT,
  title TEXT NOT NULL,
  author TEXT,
  language TEXT,
  published_at TEXT,
  fetched_at TEXT DEFAULT CURRENT_TIMESTAMP,
  excerpt TEXT,
  content TEXT,
  content_hash TEXT,
  processing_state TEXT DEFAULT 'COLLECTED',
  FOREIGN KEY(source_id) REFERENCES sources(id)
);

CREATE TABLE IF NOT EXISTS stories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  summary TEXT,
  topic TEXT,
  state TEXT DEFAULT 'CANDIDATE',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS article_stories (
  article_id INTEGER NOT NULL,
  story_id INTEGER NOT NULL,
  PRIMARY KEY(article_id, story_id),
  FOREIGN KEY(article_id) REFERENCES articles(id),
  FOREIGN KEY(story_id) REFERENCES stories(id)
);

CREATE INDEX IF NOT EXISTS idx_articles_published ON articles(published_at);
CREATE INDEX IF NOT EXISTS idx_articles_source ON articles(source_id);
CREATE INDEX IF NOT EXISTS idx_articles_state ON articles(processing_state);
