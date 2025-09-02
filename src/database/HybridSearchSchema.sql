-- Enhanced schema for hybrid search (BM25 + vector) with symbol-level indexing
-- Based on GPT-5 documentation for offline-first code search

-- 1) Core tables for structured symbol data
CREATE TABLE IF NOT EXISTS code_files (
  id INTEGER PRIMARY KEY,
  path TEXT UNIQUE,
  sha256 TEXT,
  indexed_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS code_symbols (
  id INTEGER PRIMARY KEY,
  file_id INTEGER NOT NULL REFERENCES code_files(id) ON DELETE CASCADE,
  kind TEXT CHECK(kind IN ('function','method','class','interface','type')),
  name TEXT NOT NULL,
  start_byte INTEGER,
  end_byte INTEGER,
  start_line INTEGER,
  end_line INTEGER,
  signature TEXT,
  doc TEXT,
  parent_symbol TEXT,
  language TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(file_id, name, kind, start_byte)
);

-- 2) Vector embeddings for symbols (sqlite-vec)
CREATE VIRTUAL TABLE IF NOT EXISTS code_symbols_embedding
USING vec0(id INTEGER PRIMARY KEY, embedding F32[384]);

-- 3) FTS5 over symbol text (external content)
CREATE VIRTUAL TABLE IF NOT EXISTS code_symbols_fts
USING fts5(
  name,             -- symbol name
  doc,              -- docstring/comment
  body,             -- symbol body/snippet
  content='code_symbols',
  content_rowid='id'
);

-- 4) Convenience view for symbol text assembly
CREATE VIEW IF NOT EXISTS v_code_symbols_text AS
SELECT
  s.id AS rowid,
  s.name AS name,
  s.doc  AS doc,
  -- Body will be populated by indexer
  '' AS body
FROM code_symbols s;

-- 5) Triggers to keep FTS in sync
CREATE TRIGGER IF NOT EXISTS code_symbols_ai AFTER INSERT ON code_symbols BEGIN
  INSERT INTO code_symbols_fts(rowid, name, doc, body)
  SELECT new.id, new.name, new.doc, '';
END;

CREATE TRIGGER IF NOT EXISTS code_symbols_ad AFTER DELETE ON code_symbols BEGIN
  INSERT INTO code_symbols_fts(code_symbols_fts, rowid, name, doc, body)
  VALUES('delete', old.id, old.name, old.doc, '');
END;

CREATE TRIGGER IF NOT EXISTS code_symbols_au AFTER UPDATE ON code_symbols BEGIN
  INSERT INTO code_symbols_fts(code_symbols_fts, rowid, name, doc, body)
  VALUES('delete', old.id, old.name, old.doc, '');
  INSERT INTO code_symbols_fts(rowid, name, doc, body)
  VALUES(new.id, new.name, new.doc, '');
END;

-- 6) Indexes for performance
CREATE INDEX IF NOT EXISTS idx_code_symbols_file_kind ON code_symbols(file_id, kind);
CREATE INDEX IF NOT EXISTS idx_code_symbols_name ON code_symbols(name);
CREATE INDEX IF NOT EXISTS idx_code_symbols_kind ON code_symbols(kind);
CREATE INDEX IF NOT EXISTS idx_code_files_path ON code_files(path);