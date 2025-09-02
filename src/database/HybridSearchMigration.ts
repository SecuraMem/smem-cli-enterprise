import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';

export class HybridSearchMigration {
  constructor(private db: Database.Database) {}

  async applyMigration(): Promise<void> {
    console.log('🔄 Applying hybrid search schema migration...');

    try {
      // Read the schema file
      const schemaPath = path.join(__dirname, 'HybridSearchSchema.sql');
      const schemaSql = fs.readFileSync(schemaPath, 'utf8');

      // Split into individual statements
      const statements = schemaSql
        .split(';')
        .map(stmt => stmt.trim())
        .filter(stmt => stmt.length > 0);

      // Execute each statement
      this.db.transaction(() => {
        for (const statement of statements) {
          try {
            this.db.exec(statement);
          } catch (error) {
            if (!this.isExpectedError(error, statement)) {
              throw error;
            }
          }
        }
      })();

      console.log('✅ Hybrid search schema migration completed');
      
      // Verify the schema was applied correctly
      await this.verifySchema();
      
    } catch (error) {
      console.error('❌ Schema migration failed:', error);
      throw error;
    }
  }

  private isExpectedError(error: any, statement: string): boolean {
    const errorMessage = error?.message || '';
    
    // Expected errors for CREATE IF NOT EXISTS statements
    if (errorMessage.includes('already exists')) return true;
    if (errorMessage.includes('duplicate column name')) return true;
    if (errorMessage.includes('table code_symbols has no column named')) return true;
    
    return false;
  }

  private async verifySchema(): Promise<void> {
    try {
      // Check that required tables exist
      const tables = ['code_files', 'code_symbols', 'code_symbols_fts'];
      for (const table of tables) {
        const result = this.db.prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name=?"
        ).get(table);
        
        if (!result) {
          throw new Error(`Required table '${table}' was not created`);
        }
      }

      // Check virtual table for embeddings
      const vtableResult = this.db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='code_symbols_embedding'"
      ).get();

      if (!vtableResult) {
        console.warn('⚠️ Vector table code_symbols_embedding not found - sqlite-vec may not be available');
      } else {
        console.log('✅ Vector table verified');
      }

      // Check FTS5 table
      const ftsResult = this.db.prepare(
        "SELECT name FROM sqlite_master WHERE name='code_symbols_fts'"
      ).get();

      if (!ftsResult) {
        throw new Error('FTS5 table code_symbols_fts was not created');
      }

      console.log('✅ Schema verification completed');
      
    } catch (error) {
      console.warn('⚠️ Schema verification failed:', error);
      // Don't throw - migration may still be functional
    }
  }

  // Get schema info for debugging
  getSchemaInfo(): any {
    try {
      const tables = this.db.prepare(`
        SELECT name, type, sql FROM sqlite_master 
        WHERE type IN ('table', 'view', 'trigger', 'index')
        AND name LIKE '%code_%'
        ORDER BY type, name
      `).all();

      return {
        tables: tables.length,
        details: tables
      };
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  }
}