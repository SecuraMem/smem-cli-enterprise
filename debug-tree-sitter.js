#!/usr/bin/env node

const Parser = require('tree-sitter');
const TypeScript = require('tree-sitter-typescript').typescript;

console.log('🔍 Debug Tree-sitter parsing...');

const parser = new Parser();
parser.setLanguage(TypeScript);

const code = `
function calculateTotal(items: Item[]): number {
  return items.reduce((sum, item) => sum + item.price, 0);
}

export class ShoppingCart {
  private items: Item[] = [];
  
  addItem(item: Item): void {
    this.items.push(item);
  }
}
`;

try {
  const tree = parser.parse(code);
  console.log('✅ Parsing successful');
  console.log('Root node:', tree.rootNode.type);
  console.log('Children count:', tree.rootNode.children.length);
  
  function walkNode(node, depth = 0) {
    const indent = '  '.repeat(depth);
    console.log(`${indent}${node.type} (${node.startPosition.row}:${node.startPosition.column} - ${node.endPosition.row}:${node.endPosition.column})`);
    
    if (node.type === 'function_declaration' || node.type === 'class_declaration') {
      console.log(`${indent}  -> Found symbol: ${node.type}`);
      // Find the name
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child.type === 'identifier' || child.type === 'type_identifier') {
          console.log(`${indent}     Name: ${child.text}`);
          break;
        }
      }
    }
    
    for (let i = 0; i < node.childCount && depth < 3; i++) {
      const child = node.child(i);
      if (child) {
        walkNode(child, depth + 1);
      }
    }
  }
  
  console.log('\n🌳 AST Structure:');
  walkNode(tree.rootNode);
  
} catch (error) {
  console.error('❌ Parsing failed:', error);
}