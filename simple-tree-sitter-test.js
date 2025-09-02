#!/usr/bin/env node

const Parser = require('tree-sitter');
const TypeScript = require('tree-sitter-typescript').typescript;

console.log('🧪 Simple Tree-sitter test...');

const parser = new Parser();
parser.setLanguage(TypeScript);

const code = `function test() { return 42; }`;

try {
  const tree = parser.parse(code);
  console.log('✅ Parsing successful');
  console.log('Root node type:', tree.rootNode.type);
  console.log('Root node text:', tree.rootNode.text);
  console.log('Children count:', tree.rootNode.children.length);
  
  if (tree.rootNode.children.length > 0) {
    console.log('First child type:', tree.rootNode.children[0].type);
  }
  
} catch (error) {
  console.error('❌ Parsing failed:', error);
}