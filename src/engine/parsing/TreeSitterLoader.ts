import fs from "node:fs";
import path from "node:path";
import Parser from "tree-sitter";

// Import language modules directly 
const Javascript = require('tree-sitter-javascript');
const Python = require('tree-sitter-python');
const TypeScript = require('tree-sitter-typescript').typescript;

export interface ParserConfig {
  name: string;
  language: string;
  extensions: string[];
  wasmFile: string;
  description: string;
  sha256?: string;
  fileSize?: number;
}

export interface ParsedNode {
  type: string;
  startPosition: { row: number; column: number };
  endPosition: { row: number; column: number };
  text: string;
  children?: ParsedNode[];
}

export interface SymbolInfo {
  name: string;
  type: 'function' | 'class' | 'method' | 'variable' | 'interface' | 'type' | 'import';
  startLine: number;
  endLine: number;
  content: string;
  signature?: string;
  docstring?: string;
  parent?: string;
  language: string;
  filePath: string;
}

export class TreeSitterLoader {
  private parsers: Map<string, Parser> = new Map();
  private languages: Map<string, any> = new Map();
  private parserConfigs: Map<string, ParserConfig> = new Map();
  private initialized = false;

  constructor(private root: string) {}

  private parsersDir(): string {
    // Handle case where root might be smem-cli subdirectory
    const actualRoot = this.root.endsWith('smem-cli') ? path.dirname(this.root) : this.root;
    return path.join(actualRoot, ".securamem", "parsers");
  }

  async init(): Promise<void> {
    if (this.initialized) return;

    console.log(`🌳 Loading Tree-sitter parsers from npm packages...`);

    // Initialize parsers with npm packages
    const languageConfigs = [
      { name: 'javascript', language: Javascript, extensions: ['.js', '.jsx', '.mjs'] },
      { name: 'typescript', language: TypeScript, extensions: ['.ts', '.tsx'] },
      { name: 'python', language: Python, extensions: ['.py', '.pyx', '.pyi'] }
    ];

    for (const config of languageConfigs) {
      try {
        const parser = new Parser();
        parser.setLanguage(config.language.language);
        
        this.languages.set(config.name, config.language.language);
        this.parsers.set(config.name, parser);
        this.parserConfigs.set(config.name, {
          name: config.name,
          language: config.name,
          extensions: config.extensions,
          wasmFile: `tree-sitter-${config.name}.wasm`,
          description: `${config.name} parsing`,
          fileSize: 0 // npm package
        });
        
        console.log(`✅ Loaded ${config.name} parser`);
        
      } catch (error) {
        console.warn(`⚠️ Failed to load ${config.name} parser:`, error instanceof Error ? error.message : String(error));
      }
    }

    this.initialized = true;
    console.log(`🎯 Tree-sitter ready: ${this.parsers.size} languages available`);
  }

  getAvailableLanguages(): string[] {
    return Array.from(this.parsers.keys());
  }

  getLanguageForFile(filePath: string): string | null {
    const ext = path.extname(filePath).toLowerCase();
    
    for (const [language, config] of this.parserConfigs) {
      if (config.extensions.includes(ext)) {
        return language;
      }
    }
    
    return null;
  }

  canParseFile(filePath: string): boolean {
    return this.getLanguageForFile(filePath) !== null;
  }

  parseFile(filePath: string, content: string): ParsedNode | null {
    const language = this.getLanguageForFile(filePath);
    if (!language) {
      console.warn(`No language found for ${filePath}`);
      return null;
    }

    const parser = this.parsers.get(language);
    if (!parser) {
      console.warn(`No parser found for language ${language}`);
      return null;
    }

    try {
      // Use input function approach to handle files >32KB
      const tree = parser.parse((index: number, position: any) => {
        if (index < content.length) {
          return content.substring(index, Math.min(index + 8192, content.length));
        }
        return null;
      });
      if (!tree || !tree.rootNode) {
        console.warn(`Failed to parse ${filePath}: no tree/rootNode`);
        return null;
      }
      
      console.log(`✅ Parsed ${filePath} successfully, root node type: ${tree.rootNode.type}`);
      return this.nodeToInterface(tree.rootNode);
    } catch (error) {
      console.warn(`Parse error in ${filePath}:`, error instanceof Error ? error.message : String(error));
      return null;
    }
  }

  extractSymbols(filePath: string, content: string): SymbolInfo[] {
    const language = this.getLanguageForFile(filePath);
    if (!language) return [];

    const parser = this.parsers.get(language);
    if (!parser) return [];

    try {
      console.log(`🔍 Parsing ${filePath}...`);
      // Use input function approach to handle files >32KB  
      const tree = parser.parse((index: number, position: any) => {
        if (index < content.length) {
          return content.substring(index, Math.min(index + 8192, content.length));
        }
        return null;
      });
      if (!tree || !tree.rootNode) {
        console.warn(`❌ No tree or root node for ${filePath}`);
        return [];
      }
      
      console.log(`✅ Tree parsed, root: ${tree.rootNode.type}, children: ${tree.rootNode.childCount}`);
      
      const symbols: SymbolInfo[] = [];
      const lines = content.split('\n');
      console.log(`📝 Content split into ${lines.length} lines`);

      // Traverse using the actual Tree-sitter node, not our interface
      console.log(`🌳 Starting traversal...`);
      this.traverseTreeSitterNode(tree.rootNode, symbols, lines, language, filePath);
      console.log(`🎯 Traversal complete, found ${symbols.length} symbols`);
      return symbols;
      
    } catch (error) {
      console.warn(`Failed to extract symbols from ${filePath}:`, error instanceof Error ? error.message : String(error));
      console.warn('Stack trace:', error instanceof Error ? error.stack : 'No stack');
      return [];
    }
  }

  private nodeToInterface(node: Parser.SyntaxNode): ParsedNode {
    try {
      return {
        type: node.type,
        startPosition: node.startPosition,
        endPosition: node.endPosition,
        text: node.text,
        children: node.children ? node.children.map(child => this.nodeToInterface(child)) : []
      };
    } catch (error) {
      console.warn(`Error converting node to interface:`, error instanceof Error ? error.message : String(error));
      console.warn(`Node details:`, { type: node.type, hasChildren: !!node.children });
      throw error;
    }
  }

  private traverseTreeSitterNode(
    node: Parser.SyntaxNode,
    symbols: SymbolInfo[],
    lines: string[],
    language: string,
    filePath: string,
    parent?: string
  ): void {
    // Extract symbols from this node if it matches our criteria
    this.extractSymbolFromNode(node, symbols, lines, language, filePath, parent);

    // Recursively process children
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child) {
        this.traverseTreeSitterNode(child, symbols, lines, language, filePath, parent);
      }
    }
  }

  private extractSymbolFromNode(
    node: Parser.SyntaxNode,
    symbols: SymbolInfo[],
    lines: string[],
    language: string,
    filePath: string,
    parent?: string
  ): void {
    const startLine = node.startPosition.row;
    const endLine = node.endPosition.row;
    
    // Debug logging
    if (startLine > 50 || endLine > 50) {
      console.warn(`⚠️ High line numbers: ${node.type} at lines ${startLine}-${endLine}, total lines: ${lines.length}`);
    }
    
    // Bounds checking
    if (startLine < 0 || startLine >= lines.length || endLine < 0 || endLine >= lines.length) {
      console.warn(`⚠️ Out of bounds: ${node.type} at lines ${startLine}-${endLine}, total lines: ${lines.length}`);
      return; // Skip nodes that are out of bounds
    }

    let symbolName: string | null = null;
    let symbolType: SymbolInfo['type'] | null = null;

    // Language-specific symbol detection
    switch (language) {
      case 'typescript':
      case 'javascript':
        if (node.type === 'function_declaration') {
          symbolName = this.extractNameFromTSNode(node);
          symbolType = 'function';
        } else if (node.type === 'class_declaration') {
          symbolName = this.extractNameFromTSNode(node);
          symbolType = 'class';
          // Set parent for future traversal
          parent = symbolName || parent;
        } else if (node.type === 'method_definition') {
          symbolName = this.extractNameFromTSNode(node);
          symbolType = 'method';
        } else if (node.type === 'interface_declaration') {
          symbolName = this.extractNameFromTSNode(node);
          symbolType = 'interface';
        } else if (node.type === 'type_alias_declaration') {
          symbolName = this.extractNameFromTSNode(node);
          symbolType = 'type';
        }
        break;
        
      case 'python':
        if (node.type === 'function_definition') {
          symbolName = this.extractNameFromPythonNode(node);
          symbolType = parent ? 'method' : 'function';
        } else if (node.type === 'class_definition') {
          symbolName = this.extractNameFromPythonNode(node);
          symbolType = 'class';
          parent = symbolName || parent;
        }
        break;
    }

    if (symbolName && symbolType) {
      symbols.push({
        name: symbolName,
        type: symbolType,
        startLine,
        endLine,
        content: node.text,
        signature: this.extractSignatureFromNode(node, lines, language),
        parent,
        language,
        filePath
      });
    }
  }

  private extractNameFromTSNode(node: Parser.SyntaxNode): string | null {
    // Look for identifier child node
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child && child.type === 'identifier') {
        return child.text;
      }
      if (child && child.type === 'type_identifier') {
        return child.text;
      }
    }
    return null;
  }

  private extractNameFromPythonNode(node: Parser.SyntaxNode): string | null {
    // Look for identifier child node
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child && child.type === 'identifier') {
        return child.text;
      }
    }
    return null;
  }

  private extractSignatureFromNode(node: Parser.SyntaxNode, lines: string[], language: string): string {
    const startLine = node.startPosition.row;
    if (startLine >= lines.length) return '';
    
    const line = lines[startLine] || '';
    
    switch (language) {
      case 'typescript':
      case 'javascript':
        const braceIndex = line.indexOf('{');
        return braceIndex > 0 ? line.substring(0, braceIndex).trim() : line.trim();
      case 'python':
        const colonIndex = line.indexOf(':');
        return colonIndex > 0 ? line.substring(0, colonIndex + 1).trim() : line.trim();
      default:
        return line.trim();
    }
  }




  // Helper methods for name extraction and content processing
  private extractName(node: ParsedNode, targetType: string): string | null {
    if (node.type === targetType) return node.text;
    
    if (node.children) {
      for (const child of node.children) {
        const name = this.extractName(child, targetType);
        if (name) return name;
      }
    }
    
    return null;
  }

  private getNodeContent(node: ParsedNode, lines: string[]): string {
    const startLine = node.startPosition.row;
    const endLine = node.endPosition.row;
    
    // Bounds checking
    if (startLine < 0 || startLine >= lines.length || endLine < 0 || endLine >= lines.length) {
      console.warn(`Invalid line range: ${startLine}-${endLine}, total lines: ${lines.length}`);
      return node.text || '';
    }
    
    if (startLine === endLine) {
      return lines[startLine]?.substring(
        node.startPosition.column, 
        node.endPosition.column
      ) || '';
    }
    
    const result = [];
    for (let i = startLine; i <= endLine && i < lines.length; i++) {
      if (i === startLine) {
        result.push(lines[i]?.substring(node.startPosition.column) || '');
      } else if (i === endLine) {
        result.push(lines[i]?.substring(0, node.endPosition.column) || '');
      } else {
        result.push(lines[i] || '');
      }
    }
    
    return result.join('\n');
  }

  private extractFunctionSignature(node: ParsedNode, lines: string[]): string {
    // Extract just the function signature line
    const lineIndex = node.startPosition.row;
    if (lineIndex < 0 || lineIndex >= lines.length) return '';
    
    const firstLine = lines[lineIndex] || '';
    const signatureEnd = firstLine.indexOf('{');
    return signatureEnd > 0 ? firstLine.substring(0, signatureEnd).trim() : firstLine.trim();
  }

  private extractPythonFunctionSignature(node: ParsedNode, lines: string[]): string {
    const lineIndex = node.startPosition.row;
    if (lineIndex < 0 || lineIndex >= lines.length) return '';
    
    const firstLine = lines[lineIndex] || '';
    const colonIndex = firstLine.indexOf(':');
    return colonIndex > 0 ? firstLine.substring(0, colonIndex + 1).trim() : firstLine.trim();
  }

  private extractGoFunctionSignature(node: ParsedNode, lines: string[]): string {
    const lineIndex = node.startPosition.row;
    if (lineIndex < 0 || lineIndex >= lines.length) return '';
    
    const firstLine = lines[lineIndex] || '';
    const braceIndex = firstLine.indexOf('{');
    return braceIndex > 0 ? firstLine.substring(0, braceIndex).trim() : firstLine.trim();
  }

  private extractDocstring(lineIndex: number, lines: string[]): string | undefined {
    // Look for JSDoc or comments above the symbol
    if (lineIndex < 0 || lineIndex >= lines.length) return undefined;
    
    const line = lines[lineIndex]?.trim();
    if (line?.startsWith('/**') || line?.startsWith('//')) {
      return line;
    }
    
    return undefined;
  }

  private extractPythonDocstring(node: ParsedNode): string | undefined {
    // Look for string literal as first child (Python docstring pattern)
    if (node.children) {
      for (const child of node.children) {
        if (child.type === 'string' && child.text.startsWith('"""')) {
          return child.text;
        }
      }
    }
    return undefined;
  }

  private extractGoDocstring(lineIndex: number, lines: string[]): string | undefined {
    // Go uses // comments above functions
    if (lineIndex < 0 || lineIndex >= lines.length) return undefined;
    
    const line = lines[lineIndex]?.trim();
    if (line?.startsWith('//')) {
      return line;
    }
    
    return undefined;
  }

  getParserInfo(): { language: string; extensions: string[]; loaded: boolean }[] {
    return Array.from(this.parserConfigs.entries()).map(([language, config]) => ({
      language,
      extensions: config.extensions,
      loaded: this.parsers.has(language)
    }));
  }

  async close(): Promise<void> {
    // Tree-sitter parsers don't need explicit cleanup
    this.parsers.clear();
    this.languages.clear();
    this.initialized = false;
  }
}