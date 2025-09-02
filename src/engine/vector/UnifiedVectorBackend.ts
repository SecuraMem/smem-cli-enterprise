import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type Database from 'better-sqlite3';

export type BackendType = 'vec' | 'vss' | 'local-js';

export interface VectorBackend {
    backend: BackendType;
    isAvailable(): boolean;
    ensureTable(dim: number): void;
    upsert(id: number, vector: Float32Array): void;
    queryNearest(query: Float32Array, topk: number): Array<{ id: number; distance: number }>;
    count(): number;
    extensionPath?: string;
}

// Dimension validation
function assertDim(v: Float32Array, expected = 384) {
    if (v.length !== expected) {
        throw new Error(`Vector dimension ${v.length} != ${expected}`);
    }
}

class VecBackend implements VectorBackend {
    public backend: BackendType = 'vec';
    private db: Database.Database;
    private loaded: boolean = false;
    private table: string;
    private itemsTable: string;
    private dim: number | null = null;
    public extensionPath?: string;

    constructor(db: Database.Database, table = 'memory_vectors_vec', extensionPath?: string) {
        this.db = db;
        this.table = table;
        this.itemsTable = 'memory_items';
        this.extensionPath = extensionPath;
    }

    isAvailable(): boolean { 
        return this.loaded; 
    }

    ensureTable(dim: number): void {
        if (!this.loaded) return;
        if (this.dim === dim) return;
        try {
            // Set performance pragmas for optimal vector operations
            this.db.pragma('journal_mode = WAL');
            this.db.pragma('synchronous = NORMAL'); 
            this.db.pragma('mmap_size = 268435456'); // 256MB
            this.db.pragma('temp_store = MEMORY');
            this.db.pragma('cache_size = -200000'); // ~200MB cache

            // Create items table for key mapping
            this.db.exec(`
                CREATE TABLE IF NOT EXISTS ${this.itemsTable} (
                    id INTEGER PRIMARY KEY,
                    key TEXT UNIQUE,
                    payload BLOB
                )
            `);

            // Create sqlite-vec virtual table with integer primary key
            this.db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS ${this.table} USING vec0(id INTEGER PRIMARY KEY, embedding F32[${dim}])`);
            
            this.dim = dim;
            console.log(`✅ sqlite-vec tables created with ${dim} dimensions`);
        } catch (e) {
            console.warn('⚠️ Failed to create sqlite-vec tables:', e instanceof Error ? e.message : String(e));
            this.loaded = false;
        }
    }

    // Map external key to integer ID (with RETURNING support)
    private getOrCreateIdForKey(key: string, payload?: Buffer): number {
        try {
            // Fast path (SQLite >= 3.35 with RETURNING)
            const row = this.db.prepare(`
                INSERT INTO ${this.itemsTable}(key, payload) VALUES(?, ?)
                ON CONFLICT(key) DO UPDATE SET payload=coalesce(excluded.payload, ${this.itemsTable}.payload)
                RETURNING id
            `).get(key, payload ?? null) as { id: number };
            return row.id;
        } catch {
            // Fallback for older SQLite without RETURNING
            this.db.prepare(`INSERT OR IGNORE INTO ${this.itemsTable}(key, payload) VALUES(?, ?)`).run(key, payload ?? null);
            const row = this.db.prepare(`SELECT id FROM ${this.itemsTable} WHERE key = ?`).get(key) as { id: number };
            return row.id;
        }
    }

    upsert(id: number, vector: Float32Array): void {
        if (!this.loaded || this.dim == null) return;
        try {
            // Validate dimensions
            assertDim(vector, this.dim);

            // Ensure the ID is actually an integer
            const intId = Math.floor(Number(id));
            if (!Number.isInteger(intId) || intId < 0) {
                throw new Error(`Invalid ID for sqlite-vec: ${id} (must be positive integer)`);
            }

            // Store key mapping for lookup - this creates the mapping and returns the mapped ID
            const key = `memory_${id}`;
            const mappedId = this.getOrCreateIdForKey(key);

            // Convert Float32Array to buffer for sqlite-vec
            const bytes = Buffer.from(new Uint8Array(vector.buffer, vector.byteOffset, vector.byteLength));

            // Use a literal integer for the primary key in the SQL statement
            const sql = `INSERT OR REPLACE INTO ${this.table}(id, embedding) VALUES(${mappedId}, ?)`;
            this.db.prepare(sql).run(bytes);
        } catch (e) {
            console.warn('⚠️ sqlite-vec upsert failed:', e instanceof Error ? e.message : String(e));
            if (e instanceof Error && e.message.includes('dimension')) {
                throw e; // Re-throw dimension errors for proper handling
            }
        }
    }

    queryNearest(query: Float32Array, topk: number): Array<{ id: number; distance: number }> {
        if (!this.loaded || this.dim == null) return [];
        try {
            // Validate query dimensions
            assertDim(query, this.dim);
            
            // Convert Float32Array to buffer
            const bytes = Buffer.from(new Uint8Array(query.buffer, query.byteOffset, query.byteLength));
            
            const stmt = this.db.prepare(`
                SELECT items.key, vec.distance
                FROM ${this.table} vec
                JOIN ${this.itemsTable} items ON items.id = vec.id
                WHERE vec.embedding MATCH ? AND k = ?
                ORDER BY vec.distance 
                LIMIT ?
            `);
            
            const results = stmt.all(bytes, topk, topk) as Array<{ key: string; distance: number }>;
            
            // Map back to original memory IDs by parsing the key
            return results.map(r => ({
                id: parseInt(r.key.replace('memory_', '')),
                distance: r.distance
            }));
        } catch (e) {
            console.warn('⚠️ sqlite-vec query failed:', e instanceof Error ? e.message : String(e));
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

    static tryLoad(db: Database.Database, projectRoot: string): VecBackend | null {
        const platform = os.platform();
        const arch = os.arch();
        const ext = platform === 'win32' ? 'dll' : platform === 'darwin' ? 'dylib' : 'so';

        const manualPath = path.join(projectRoot, '.securamem', 'sqlite-vec', `${platform}-${arch}`, `vec0.${ext}`);
        // Construct npm package path - handle Windows naming inconsistency
        const npmPlatform = platform === 'win32' ? 'windows' : platform;
        const npmPath = path.join(projectRoot, 'node_modules', `sqlite-vec-${npmPlatform}-${arch}`, `vec0.${ext}`);

        const backend = new VecBackend(db, 'memory_vectors_vec', manualPath);

        // Try manual binary first
        try {
            console.log(`[sqlite-vec] Checking manual DLL path: ${manualPath}`);
            if (fs.existsSync(manualPath)) {
                console.log(`🔍 Loading sqlite-vec from ${manualPath}`);
                (db as any).loadExtension(manualPath);
                backend.loaded = true;
                console.log('✅ sqlite-vec extension loaded successfully');
                // Self-test: try creating table and inserting a test vector
                try {
                    backend.ensureTable(384);
                    const testVec = new Float32Array(384).fill(0.1);
                    backend.upsert(999999, testVec);
                    const count = backend.count();
                    if (count >= 1) {
                        console.log('🧪 sqlite-vec self-test passed: native ops available');
                    } else {
                        console.warn('⚠️ sqlite-vec self-test failed: vector not inserted');
                    }
                } catch (selfTestErr) {
                    console.error('❌ sqlite-vec self-test error:', selfTestErr);
                    backend.loaded = false;
                }
                return backend.loaded ? backend : null;
            }
        } catch (e) {
            console.error('⚠️ Failed to load sqlite-vec:', e instanceof Error ? e.stack || e.message : String(e));
        }

        // Fallback: try npm package binary
        try {
            console.log(`[sqlite-vec] Checking npm DLL path: ${npmPath}`);
            if (fs.existsSync(npmPath)) {
                console.log(`🔍 Loading sqlite-vec from npm package: ${npmPath}`);
                (db as any).loadExtension(npmPath);
                backend.loaded = true;
                backend.extensionPath = npmPath;
                console.log('✅ sqlite-vec extension loaded from npm package');
                // Self-test: try creating table and inserting a test vector
                try {
                    backend.ensureTable(384);
                    const testVec = new Float32Array(384).fill(0.1);
                    backend.upsert(999999, testVec);
                    const count = backend.count();
                    if (count >= 1) {
                        console.log('🧪 sqlite-vec self-test passed: native ops available');
                    } else {
                        console.warn('⚠️ sqlite-vec self-test failed: vector not inserted');
                    }
                } catch (selfTestErr) {
                    console.error('❌ sqlite-vec self-test error:', selfTestErr);
                    backend.loaded = false;
                }
                return backend.loaded ? backend : null;
            }
        } catch (e) {
            console.error('⚠️ Failed to load sqlite-vec from npm package:', e instanceof Error ? e.stack || e.message : String(e));
        }

        return null;
    }
}

class VssBackend implements VectorBackend {
    public backend: BackendType = 'vss';
    private db: Database.Database;
    private loaded: boolean = false;
    private table: string;
    private dim: number | null = null;
    public extensionPath?: string;

    constructor(db: Database.Database, table = 'memory_vectors_vss', extensionPath?: string) {
        this.db = db;
        this.table = table;
        this.extensionPath = extensionPath;
    }

    isAvailable(): boolean { 
        return this.loaded; 
    }

    ensureTable(dim: number): void {
        if (!this.loaded) return;
        if (this.dim === dim) return;
        try {
            // sqlite-vss: vss0 virtual table
            this.db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS ${this.table} USING vss0(embedding(${dim}))`);
            this.dim = dim;
            console.log(`✅ sqlite-vss table created with ${dim} dimensions`);
        } catch (e) {
            console.warn('⚠️ Failed to create sqlite-vss table:', e instanceof Error ? e.message : String(e));
            this.loaded = false;
        }
    }

    upsert(id: number, vector: Float32Array): void {
        if (!this.loaded || this.dim == null) return;
        try {
            const buf = Buffer.alloc(vector.byteLength);
            for (let i = 0; i < vector.length; i++) buf.writeFloatLE(vector[i], i * 4);
            const stmt = this.db.prepare(`INSERT OR REPLACE INTO ${this.table}(rowid, embedding) VALUES (?, ?)`);
            stmt.run(id, buf);
        } catch (e) {
            console.warn('⚠️ sqlite-vss upsert failed:', e instanceof Error ? e.message : String(e));
            this.loaded = false;
        }
    }

    queryNearest(query: Float32Array, topk: number): Array<{ id: number; distance: number }> {
        if (!this.loaded || this.dim == null) return [];
        try {
            const buf = Buffer.alloc(query.byteLength);
            for (let i = 0; i < query.length; i++) buf.writeFloatLE(query[i], i * 4);
            const stmt = this.db.prepare(`
                SELECT rowid as id, distance 
                FROM ${this.table}
                WHERE vss_search(embedding, ?)
                ORDER BY distance 
                LIMIT ?
            `);
            return stmt.all(buf, topk) as Array<{ id: number; distance: number }>;
        } catch (e) {
            console.warn('⚠️ sqlite-vss query failed:', e instanceof Error ? e.message : String(e));
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

    static tryLoad(db: Database.Database, projectRoot: string): VssBackend | null {
        const platform = os.platform();
        const arch = os.arch();
        const ext = platform === 'win32' ? 'dll' : platform === 'darwin' ? 'dylib' : 'so';
        
        // Try to load vector0 first (required by sqlite-vss on non-Windows)
        if (platform !== 'win32') {
            const vectorPath = path.join(projectRoot, '.securamem', 'sqlite-vss', `${platform}-${arch}`, `vector0.${ext}`);
            if (fs.existsSync(vectorPath)) {
                try {
                    (db as any).loadExtension(vectorPath);
                } catch (e) {
                    console.log('⚠️ Failed to load vector0:', e instanceof Error ? e.message : String(e));
                    return null;
                }
            } else {
                return null;
            }
        }
        
        const vssPath = path.join(projectRoot, '.securamem', 'sqlite-vss', `${platform}-${arch}`, `vss0.${ext}`);
        
        const backend = new VssBackend(db, 'memory_vectors_vss', vssPath);
        
        try {
            if (fs.existsSync(vssPath)) {
                console.log(`🔍 Loading sqlite-vss from ${vssPath}`);
                (db as any).loadExtension(vssPath);
                backend.loaded = true;
                console.log('✅ sqlite-vss extension loaded successfully');
                return backend;
            }
        } catch (e) {
            console.log('⚠️ Failed to load sqlite-vss:', e instanceof Error ? e.message : String(e));
        }
        
        return null;
    }
}

export class UnifiedVectorBackend {
    private activeBackend: VectorBackend | null = null;
    private db: Database.Database;

    constructor(db: Database.Database) {
        this.db = db;
    }

    static tryLoad(db: Database.Database, projectRoot: string): UnifiedVectorBackend {
        const unified = new UnifiedVectorBackend(db);
        
        console.log('🔍 Detecting vector backend...');
        
        const platform = os.platform();
        
        if (platform === 'win32') {
            // Windows: sqlite-vec primary
            console.log('🪟 Windows detected - trying sqlite-vec first');
            const vecBackend = VecBackend.tryLoad(db, projectRoot);
            if (vecBackend) {
                unified.activeBackend = vecBackend;
                return unified;
            }
        } else {
            // Linux/macOS: try sqlite-vss first, fallback to sqlite-vec
            console.log('🐧 Unix platform - trying sqlite-vss first, sqlite-vec fallback');
            const vssBackend = VssBackend.tryLoad(db, projectRoot);
            if (vssBackend) {
                unified.activeBackend = vssBackend;
                return unified;
            }
            
            const vecBackend = VecBackend.tryLoad(db, projectRoot);
            if (vecBackend) {
                unified.activeBackend = vecBackend;
                return unified;
            }
        }
        
        console.log('⚠️ No native vector backend found - will use local-js fallback');
        return unified;
    }

    isAvailable(): boolean {
        return this.activeBackend?.isAvailable() ?? false;
    }

    getBackendType(): BackendType {
        return this.activeBackend?.backend ?? 'local-js';
    }

    getExtensionPath(): string | undefined {
        return this.activeBackend?.extensionPath;
    }

    ensureTable(dim: number): void {
        this.activeBackend?.ensureTable(dim);
    }

    upsert(id: number, vector: Float32Array): void {
        this.activeBackend?.upsert(id, vector);
    }

    queryNearest(query: Float32Array, topk: number): Array<{ id: number; distance: number }> {
        return this.activeBackend?.queryNearest(query, topk) ?? [];
    }

    count(): number {
        return this.activeBackend?.count() ?? 0;
    }
}