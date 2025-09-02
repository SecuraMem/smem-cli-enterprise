#!/usr/bin/env node

const path = require('path');
const { HybridSearchDatabase } = require('./dist/database/HybridSearchDatabase.js');

async function test() {
  console.log('🧪 Testing Hybrid Search Database...');
  
  const dbPath = path.join(process.cwd(), '.securamem', 'test-hybrid.db');
  const db = new HybridSearchDatabase(dbPath);

  try {
    // Initialize the database
    await db.initialize();
    console.log('✅ Database initialized successfully');

    // Test data - simulate TypeScript symbols
    const testContent = `
export interface Item {
  name: string;
  price: number;
}

/**
 * Calculate the total price of items
 */
function calculateTotal(items: Item[]): number {
  return items.reduce((sum, item) => sum + item.price, 0);
}

export class ShoppingCart {
  private items: Item[] = [];
  
  /**
   * Add an item to the cart
   */
  addItem(item: Item): void {
    this.items.push(item);
  }
  
  getTotal(): number {
    return calculateTotal(this.items);
  }
}
`;

    const symbols = [
      {
        kind: 'interface',
        name: 'Item',
        start_byte: 1,
        end_byte: 50,
        start_line: 1,
        end_line: 4,
        language: 'typescript',
        doc: undefined
      },
      {
        kind: 'function',
        name: 'calculateTotal',
        start_byte: 100,
        end_byte: 200,
        start_line: 9,
        end_line: 11,
        signature: 'function calculateTotal(items: Item[]): number',
        doc: 'Calculate the total price of items',
        language: 'typescript'
      },
      {
        kind: 'class',
        name: 'ShoppingCart',
        start_byte: 250,
        end_byte: 500,
        start_line: 13,
        end_line: 25,
        language: 'typescript'
      },
      {
        kind: 'method',
        name: 'addItem',
        start_byte: 320,
        end_byte: 380,
        start_line: 18,
        end_line: 20,
        signature: 'addItem(item: Item): void',
        doc: 'Add an item to the cart',
        parent_symbol: 'ShoppingCart',
        language: 'typescript'
      },
      {
        kind: 'method',
        name: 'getTotal',
        start_byte: 400,
        end_byte: 450,
        start_line: 22,
        end_line: 24,
        signature: 'getTotal(): number',
        parent_symbol: 'ShoppingCart',
        language: 'typescript'
      }
    ];

    // Index the test file
    console.log('📝 Indexing test symbols...');
    const symbolCount = db.indexFile('test.ts', testContent, symbols);
    console.log(`✅ Indexed ${symbolCount} symbols`);

    // Get database stats
    const stats = db.getStats();
    console.log('📊 Database stats:', JSON.stringify(stats, null, 2));

    // Test text-only search (since we don't have embeddings yet)
    console.log('\n🔍 Testing text search...');
    
    const searchQueries = [
      'calculateTotal',
      'shopping cart',
      'add item',
      'interface'
    ];

    for (const query of searchQueries) {
      console.log(`\n--- Search: "${query}" ---`);
      try {
        // Use the private method for testing
        const results = (db as any).textOnlySearch(query, { topK: 5 });
        
        if (results.length > 0) {
          results.forEach((r, i) => {
            console.log(`${i + 1}. ${r.kind}: ${r.name} (score: ${r.hybrid_score.toFixed(4)})`);
            console.log(`   ${r.path}:${r.start_line}`);
            if (r.signature) console.log(`   ${r.signature}`);
          });
        } else {
          console.log('   No results found');
        }
      } catch (error) {
        console.log(`   Error: ${error.message}`);
      }
    }

    // Test filtered search
    console.log('\n🔍 Testing filtered search...');
    try {
      const functionResults = (db as any).textOnlySearch('calculate', { 
        topK: 5, 
        filterKind: 'function' 
      });
      console.log(`Functions containing 'calculate': ${functionResults.length} results`);
      functionResults.forEach(r => {
        console.log(`  - ${r.name} (${r.kind})`);
      });
    } catch (error) {
      console.log(`   Filter search error: ${error.message}`);
    }

    console.log('\n✅ Hybrid search database test completed!');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
    console.error('Stack:', error.stack);
  } finally {
    db.close();
  }
}

test();