import Database from 'better-sqlite3';
import path from 'path';
import crypto from 'crypto';
import { HybridSearchMigration } from './HybridSearchMigration.js';

export interface CodeFile {
  id?: number;
  path: string;
  sha256: string;
  indexed_at?: string;
}

export interface CodeSymbol {
  id?: number;
  file_id: number;
  kind: 'function' | 'method' | 'class' | 'interface' | 'type';
  name: string;
  start_byte: number;
  end_byte: number;
  start_line: number;
  end_line: number;
  signature?: string;
  doc?: string;
  parent_symbol?: string;
  language?: string;
}

export interface HybridSearchResult {
  id: number;
  name: string;
  kind: string;
  path: string;
  text_score: number;
  vec_score: number;
  hybrid_score: number;
  start_line: number;
  end_line: number;
  signature?: string;
  doc?: string;
}

export class HybridSearchDatabase {
  private db: Database.Database;
  private migration: HybridSearchMigration;

  // Prepared statements for performance
  private upsertFile!: Database.Statement;
  private upsertSymbol!: Database.Statement;
  private upsertEmbedding!: Database.Statement;
  private upsertFts!: Database.Statement;
  private hybridSearchStmt!: Database.Statement;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.pragma('cache_size = 10000');

    this.migration = new HybridSearchMigration(this.db);
    this.initializeStatements();
  }

  async initialize(): Promise<void> {
    await this.migration.applyMigration();
    console.log('🗄️ Hybrid search database initialized');
  }

  private initializeStatements(): void {
    // File management
    this.upsertFile = this.db.prepare(`
      INSERT INTO code_files(path, sha256, indexed_at) 
      VALUES(?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(path) DO UPDATE SET 
        sha256=excluded.sha256,
        indexed_at=excluded.indexed_at
      RETURNING id
    `);

    // Symbol management
    this.upsertSymbol = this.db.prepare(`
      INSERT INTO code_symbols(
        file_id, kind, name, start_byte, end_byte, 
        start_line, end_line, signature, doc, parent_symbol, language
      )
      VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(file_id, name, kind, start_byte) DO UPDATE SET
        end_byte=excluded.end_byte,
        end_line=excluded.end_line,
        signature=excluded.signature,
        doc=COALESCE(excluded.doc, code_symbols.doc),
        parent_symbol=excluded.parent_symbol,
        language=excluded.language
      RETURNING id
    `);

    // Vector embedding
    this.upsertEmbedding = this.db.prepare(`
      INSERT INTO code_symbols_embedding(id, embedding) 
      VALUES(?, ?)
      ON CONFLICT(id) DO UPDATE SET embedding=excluded.embedding
    `);

    // FTS5 text indexing
    this.upsertFts = this.db.prepare(`
      INSERT INTO code_symbols_fts(rowid, name, doc, body)
      VALUES(?, ?, ?, ?)
      ON CONFLICT(rowid) DO UPDATE SET
        name=excluded.name,
        doc=excluded.doc,
        body=excluded.body
    `);

    // Hybrid search (BM25 + vector)
    this.hybridSearchStmt = this.db.prepare(`
      WITH
      text_hits AS (
        SELECT rowid AS id, bm25(code_symbols_fts) AS bm25_raw
        FROM code_symbols_fts
        WHERE code_symbols_fts MATCH ?
        ORDER BY bm25_raw
        LIMIT ?
      ),
      text_norm AS (
        SELECT id, 1.0/(1.0+bm25_raw) AS text_score FROM text_hits
      ),
      vec_hits AS (
        SELECT rowid AS id, distance
        FROM vec_search(code_symbols_embedding, ?, ?)
      ),
      vec_norm AS (
        SELECT id, 1.0/(1.0+distance) AS vec_score FROM vec_hits
      ),
      joined AS (
        SELECT
          s.id, s.name, s.kind, f.path,
          s.start_line, s.end_line, s.signature, s.doc,
          COALESCE(t.text_score, 0.0) AS text_score,
          COALESCE(v.vec_score, 0.0) AS vec_score,
          (? * COALESCE(v.vec_score, 0.0) + (1.0 - ?) * COALESCE(t.text_score, 0.0)) AS hybrid_score
        FROM code_symbols s
        JOIN code_files f ON f.id = s.file_id
        LEFT JOIN text_norm t ON t.id = s.id
        LEFT JOIN vec_norm v ON v.id = s.id
        WHERE (? IS NULL OR s.kind = ?)
      )
      SELECT *
      FROM joined
      ORDER BY hybrid_score DESC
      LIMIT ?
    `);
  }

  // Index a file and its symbols
  indexFile(
    filePath: string, 
    content: string, 
    symbols: Array<{
      kind: CodeSymbol['kind'];
      name: string;
      start_byte: number;
      end_byte: number;
      start_line: number;
      end_line: number;
      signature?: string;
      doc?: string;
      parent_symbol?: string;
      language?: string;
      embedding?: Float32Array;
    }>
  ): number {
    const sha256 = crypto.createHash('sha256').update(content).digest('hex');
    
    return this.db.transaction(() => {
      // Upsert file
      const fileResult = this.upsertFile.get(filePath, sha256) as { id: number };
      const fileId = fileResult.id;

      let symbolCount = 0;
      
      for (const symbol of symbols) {
        // Upsert symbol
        const symbolResult = this.upsertSymbol.get(
          fileId,
          symbol.kind,
          symbol.name,
          symbol.start_byte,
          symbol.end_byte,
          symbol.start_line,
          symbol.end_line,
          symbol.signature || null,
          symbol.doc || null,
          symbol.parent_symbol || null,
          symbol.language || null
        ) as { id: number };
        
        const symbolId = symbolResult.id;
        symbolCount++;

        // Upsert embedding if provided
        if (symbol.embedding) {
          const embeddingBuffer = Buffer.from(new Uint8Array(symbol.embedding.buffer));
          this.upsertEmbedding.run(symbolId, embeddingBuffer);
        }

        // Upsert FTS text
        const body = content.slice(
          symbol.start_byte, 
          Math.min(symbol.end_byte, symbol.start_byte + 2000)
        );
        
        this.upsertFts.run(
          symbolId,
          symbol.name,
          symbol.doc || '',
          body
        );
      }

      return symbolCount;
    })();
  }

  // Sanitize query for FTS5 MATCH
  private sanitizeQuery(query: string): string {
    // Remove problematic characters, collapse whitespace, escape quotes
    let sanitized = query.replace(/["'`]/g, ' ');
    sanitized = sanitized.replace(/[*^~]/g, ' '); // Remove wildcards and fuzzy ops
    sanitized = sanitized.replace(/\s+/g, ' ').trim();
    // Optionally, split multi-term queries and join with AND
    if (sanitized.includes(' ')) {
      sanitized = sanitized.split(' ').map(term => term).join(' AND ');
    }
    return sanitized;
  }

  // Perform hybrid search
  hybridSearch(
    query: string,
    queryEmbedding: Float32Array,
    options: {
      topK?: number;
      alpha?: number; // Weight for vector score vs text score
      filterKind?: string;
      limitMultiplier?: number;
    } = {}
  ): HybridSearchResult[] {
    const {
      topK = 20,
      alpha = 0.6,
      filterKind = null,
      limitMultiplier = 8
    } = options;

    const embeddingBuffer = Buffer.from(new Uint8Array(queryEmbedding.buffer));
    const limitX = topK * limitMultiplier;
    const sanitizedQuery = this.sanitizeQuery(query);

    try {
      return this.hybridSearchStmt.all(
        sanitizedQuery,           // FTS5 query
        limitX,          // text hits limit
        embeddingBuffer, // query vector
        limitX,          // vector hits limit
        alpha,           // alpha weight
        alpha,           // alpha weight (duplicate for formula)
        filterKind,      // filter kind
        filterKind,      // filter kind (duplicate for WHERE)
        topK             // final limit
      ) as HybridSearchResult[];
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      if (/fts5|syntax|token|malformed/i.test(errorMsg)) {
        console.warn(`⚠️ Hybrid search query error: ${errorMsg}\nQuery: '${sanitizedQuery}'`);
      } else {
        console.warn('⚠️ Hybrid search failed, falling back to text-only search:', errorMsg);
      }
      return this.textOnlySearch(query, { topK, filterKind: filterKind || undefined });
    }
  }

  // Fallback text-only search with query sanitization and error handling
  private textOnlySearch(
    query: string,
    options: { topK?: number; filterKind?: string } = {}
  ): HybridSearchResult[] {
    const { topK = 20, filterKind } = options;
    const filterValue = filterKind || null;
    const sanitizedQuery = this.sanitizeQuery(query);

    try {
      const textOnlyStmt = this.db.prepare(`
        SELECT
          s.id, s.name, s.kind, f.path,
          s.start_line, s.end_line, s.signature, s.doc,
          1.0/(1.0+bm25(code_symbols_fts)) as text_score,
          0.0 as vec_score,
          1.0/(1.0+bm25(code_symbols_fts)) as hybrid_score
        FROM code_symbols_fts
        JOIN code_symbols s ON s.id = code_symbols_fts.rowid
        JOIN code_files f ON f.id = s.file_id
        WHERE code_symbols_fts MATCH ?
          AND (? IS NULL OR s.kind = ?)
        ORDER BY hybrid_score DESC
        LIMIT ?
      `);
      return textOnlyStmt.all(sanitizedQuery, filterKind, filterKind, topK) as HybridSearchResult[];
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.warn(`⚠️ Text-only search query error: ${errorMsg}\nQuery: '${sanitizedQuery}'`);
      return [];
    }
  }

  // Get database statistics
  getStats(): any {
    try {
      const fileCount = this.db.prepare('SELECT COUNT(*) as count FROM code_files').get() as { count: number };
      const symbolCount = this.db.prepare('SELECT COUNT(*) as count FROM code_symbols').get() as { count: number };
      const embeddingCount = this.db.prepare('SELECT COUNT(*) as count FROM code_symbols_embedding').get() as { count: number };
      const ftsCount = this.db.prepare('SELECT COUNT(*) as count FROM code_symbols_fts').get() as { count: number };

      const kindStats = this.db.prepare(`
        SELECT kind, COUNT(*) as count 
        FROM code_symbols 
        GROUP BY kind 
        ORDER BY count DESC
      `).all();

      return {
        files: fileCount.count,
        symbols: symbolCount.count,
        embeddings: embeddingCount.count,
        fts_entries: ftsCount.count,
        symbol_types: kindStats,
        schema_info: this.migration.getSchemaInfo()
      };
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  }

  close(): void {
    this.db.close();
  }
}