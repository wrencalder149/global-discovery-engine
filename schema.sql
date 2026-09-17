-- Matches the D1 schema already created in Cloudflare for global-discovery.

CREATE TABLE IF NOT EXISTS sources (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    base_url TEXT,
    feed_url TEXT,
    language TEXT,
    country TEXT,
    region TEXT,
    source_type TEXT,
    reliability REAL DEFAULT 0.5,
    discovery_value REAL DEFAULT 0.5,
    originality REAL DEFAULT 0.5,
    locality REAL DEFAULT 0.5,
    depth REAL DEFAULT 0.5,
    specialization REAL DEFAULT 0.5,
    status TEXT DEFAULT 'active',
    first_seen_at TEXT,
    last_seen_at TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS articles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    url TEXT NOT NULL,
    canonical_url TEXT,
    author TEXT,
    language TEXT,
    country TEXT,
    published_at TEXT,
    fetched_at TEXT DEFAULT CURRENT_TIMESTAMP,
    excerpt TEXT,
    raw_content TEXT,
    content_hash TEXT,
    processing_state TEXT DEFAULT 'collected',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (source_id) REFERENCES sources(id)
);

CREATE TABLE IF NOT EXISTS stories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    summary TEXT,
    topic TEXT,
    status TEXT DEFAULT 'candidate',
    first_seen_at TEXT,
    last_updated_at TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS article_stories (
    article_id INTEGER NOT NULL,
    story_id INTEGER NOT NULL,
    relation_type TEXT DEFAULT 'primary',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (article_id, story_id),
    FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE,
    FOREIGN KEY (story_id) REFERENCES stories(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_articles_canonical_url
    ON articles(canonical_url);
CREATE INDEX IF NOT EXISTS idx_articles_source_id
    ON articles(source_id);
CREATE INDEX IF NOT EXISTS idx_articles_published_at
    ON articles(published_at);
CREATE INDEX IF NOT EXISTS idx_articles_content_hash
    ON articles(content_hash);
CREATE INDEX IF NOT EXISTS idx_articles_processing_state
    ON articles(processing_state);
CREATE INDEX IF NOT EXISTS idx_stories_status
    ON stories(status);
CREATE INDEX IF NOT EXISTS idx_article_stories_story_id
    ON article_stories(story_id);
