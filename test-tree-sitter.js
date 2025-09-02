#!/usr/bin/env node

const { TreeSitterLoader } = require('./dist/engine/parsing/TreeSitterLoader.js');

async function test() {
  console.log('🧪 Testing Tree-sitter integration...');
  
  const loader = new TreeSitterLoader(process.cwd());
  
  try {
    await loader.init();
    
    console.log(`📋 Available languages: ${loader.getAvailableLanguages().join(', ')}`);
    
    // Test parsing a simple TypeScript function
    const testCode = `
function calculateTotal(items: Item[]): number {
  return items.reduce((sum, item) => sum + item.price, 0);
}

export class ShoppingCart {
  private items: Item[] = [];
  
  addItem(item: Item): void {
    this.items.push(item);
  }
  
  getTotal(): number {
    return calculateTotal(this.items);
  }
}
`;
    
    console.log('🔍 Extracting symbols from test code...');
    console.log(`   Code lines: ${testCode.split('\n').length}`);
    
    // Debug: check if we can parse the file
    const canParse = loader.canParseFile('test.ts');
    console.log(`   Can parse test.ts: ${canParse}`);
    
    const language = loader.getLanguageForFile('test.ts');
    console.log(`   Detected language: ${language}`);
    
    const symbols = loader.extractSymbols('test.ts', testCode);
    
    console.log(`✅ Found ${symbols.length} symbols:`);
    symbols.forEach(symbol => {
      console.log(`   - ${symbol.type}: ${symbol.name} (lines ${symbol.startLine}-${symbol.endLine})`);
      if (symbol.signature) {
        console.log(`     Signature: ${symbol.signature}`);
      }
    });
    
    await loader.close();
    console.log('✅ Tree-sitter test complete!');
    
  } catch (error) {
    console.error('❌ Tree-sitter test failed:', error);
    process.exit(1);
  }
}

test();