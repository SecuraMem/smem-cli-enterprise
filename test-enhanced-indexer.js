#!/usr/bin/env node

const { EnhancedCodeIndexer } = require('./dist/codeindex/EnhancedCodeIndexer.js');

async function test() {
  console.log('🧪 Testing Enhanced Code Indexer...');
  
  const indexer = new EnhancedCodeIndexer(process.cwd());
  
  try {
    await indexer.initialize();
    
    // Test with TypeScript code
    const testCode = `
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

    const options = {
      useTreeSitter: true,
      symbolsOnly: true,
      includeDocstrings: true,
      includeSignatures: true,
      astFallback: true
    };

    console.log('🔍 Chunking TypeScript code...');
    const chunks = indexer.chunkFileWithTreeSitter('test.ts', options);
    
    console.log(`✅ Found ${chunks.length} chunks:`);
    chunks.forEach((chunk, i) => {
      const meta = chunk.meta;
      console.log(`\n--- Chunk ${i + 1} ---`);
      console.log(`Symbol: ${meta.symbolName} (${meta.symbolType})`);
      console.log(`Lines: ${meta.lineStart}-${meta.lineEnd}`);
      console.log(`Parse mode: ${meta.parseMode}`);
      console.log(`Signature: ${meta.signature || 'none'}`);
      console.log(`Tags: ${meta.tags?.join(', ') || 'none'}`);
      console.log(`Content preview: ${chunk.text.substring(0, 100)}...`);
    });

    // Test the enhanced indexing
    console.log('\n🚀 Testing enhanced indexing...');
    let chunkCount = 0;
    
    await indexer.indexFilesWithTreeSitter(
      { 
        include: ['test.ts'], 
        useTreeSitter: true,
        symbolsOnly: true 
      },
      (chunk) => {
        chunkCount++;
        console.log(`Processed chunk: ${chunk.meta.symbolName} (${chunk.meta.symbolType})`);
      }
    );
    
    console.log(`✅ Enhanced indexer test complete! Processed ${chunkCount} chunks`);
    
  } catch (error) {
    console.error('❌ Enhanced indexer test failed:', error);
    process.exit(1);
  }
}

test();