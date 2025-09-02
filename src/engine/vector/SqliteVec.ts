import * as fs from 'fs';
import * as path from 'path';
import type Database from 'better-sqlite3';

export class SqliteVec {
  private db: Database.Database;
  private loaded: boolean = false;
  private table: string;
  private dim: number | null = null;

  private constructor(db: Database.Database, table = 'memories_vec') {
    this.db = db;
    this.table = table;
  }

  static tryLoad(db: Database.Database, projectRoot: string, table?: string): SqliteVec {
    const vec = new SqliteVec(db, table);
    try {
      // Try to load sqlite-vec from node_modules first
      try {
        console.log('🔍 Attempting to load sqlite-vec from npm package...');
        const { load } = require('sqlite-vec');
        load(db);
        vec.loaded = true;
        console.log('✅ Loaded sqlite-vec extension from npm package');
        return vec;
      } catch (e) {
        console.log('⚠️ Failed to load sqlite-vec from npm package:', e instanceof Error ? e.message : String(e));
        // Fall back to manual loading if npm package fails
      }

      // Manual fallback: look for platform-specific binary
      const platform = process.platform; // 'win32' | 'darwin' | 'linux'
      const arch = process.arch; // 'x64' | 'arm64' | ...
      const ext = platform === 'win32' ? 'dll' : platform === 'darwin' ? 'dylib' : 'so';
      
      // Check if we have the sqlite-vec binary placed as vss0 for compatibility
      const baseDir = path.join(projectRoot, '.securamem', 'sqlite-vss', `${platform}-${arch}`);
      const candidate = path.join(baseDir, `vss0.${ext}`);
      if (fs.existsSync(candidate)) {
        // @ts-ignore better-sqlite3 loadExtension exists at runtime
        (db as any).loadExtension(candidate);
        vec.loaded = true;
        console.log(`✅ Loaded sqlite-vec extension from ${candidate}`);
      }
    } catch (e) {
      // Silently fallback; we'll use JS path
      vec.loaded = false;
    }
    return vec;
  }

  isAvailable(): boolean { return this.loaded; }

  ensureTable(dim: number): void {
    if (!this.loaded) return;
    if (this.dim === dim) return;
    try {
      // sqlite-vec: vec0 virtual table with vector column
      this.db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS ${this.table} USING vec0(embedding float[${dim}]);`);
      this.dim = dim;
    } catch (e) {
      // If table creation fails, disable Vec for this session
      this.loaded = false;
      console.warn('⚠️ Failed to create sqlite-vec table:', e);
    }
  }

  upsert(id: number, vec: Float32Array): void {
    if (!this.loaded || this.dim == null) return;
    try {
      // sqlite-vec expects JSON array format for vectors
      const vecJson = JSON.stringify(Array.from(vec));
      const stmt = this.db.prepare(`INSERT OR REPLACE INTO ${this.table}(rowid, embedding) VALUES (?, ?)`);
      stmt.run(id, vecJson);
    } catch (e) {
      // Disable on operational error
      this.loaded = false;
      console.warn('⚠️ sqlite-vec upsert failed:', e);
    }
  }

  // Vector-only nearest neighbors via sqlite-vec
  queryNearest(vec: Float32Array, topk: number): Array<{ id: number; distance: number }> {
    if (!this.loaded || this.dim == null) return [];
    try {
      const vecJson = JSON.stringify(Array.from(vec));
      const stmt = this.db.prepare(`
        SELECT rowid as id, distance 
        FROM ${this.table}
        WHERE embedding MATCH ? 
        ORDER BY distance 
        LIMIT ?
      `);
      const results = stmt.all(vecJson, topk) as Array<{ id: number; distance: number }>;
      return results;
    } catch (e) {
      console.warn('⚠️ sqlite-vec query failed:', e);
      return [];
    }
  }

  count(): number {
    if (!this.loaded) return 0;
    try {
      const stmt = this.db.prepare(`SELECT COUNT(*) as count FROM ${this.table}`);
      const result = stmt.get() as { count: number };
      return result.count;
    } catch (e) {
      return 0;
    }
  }
}