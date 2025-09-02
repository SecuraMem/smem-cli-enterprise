import * as fs from 'fs';
import * as path from 'path';
import { CodeIndexer, CodeChunkMetadata, IndexOptions } from './CodeIndexer.js';
import { TreeSitterLoader, SymbolInfo } from '../engine/parsing/TreeSitterLoader.js';

export interface EnhancedCodeChunkMetadata extends CodeChunkMetadata {
  // Enhanced metadata from Tree-sitter parsing
  symbolName?: string;
  symbolType?: 'function' | 'class' | 'method' | 'variable' | 'interface' | 'type' | 'import';
  signature?: string;
  docstring?: string;
  parentSymbol?: string;
  isTreeSitterParsed?: boolean;
  parseMode?: 'ast' | 'heuristic' | 'fallback';
}

export interface EnhancedIndexOptions extends IndexOptions {
  // Tree-sitter specific options
  useTreeSitter?: boolean;
  symbolsOnly?: boolean; // Only index functions, classes, etc. (not arbitrary chunks)
  includeDocstrings?: boolean;
  includeSignatures?: boolean;
  astFallback?: boolean; // Fall back to heuristic if Tree-sitter fails
}

export class EnhancedCodeIndexer extends CodeIndexer {
  private treeSitter: TreeSitterLoader;
  private initialized = false;

  constructor(projectRoot: string) {
    super(projectRoot);
    this.treeSitter = new TreeSitterLoader(projectRoot);
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    
    try {
      await this.treeSitter.init();
      this.initialized = true;
      console.log('✅ Enhanced CodeIndexer ready with Tree-sitter parsing');
    } catch (error) {
      console.warn('⚠️ Tree-sitter initialization failed, using enhanced heuristic parsing instead:', 
        error instanceof Error ? error.message : String(error));
      this.initialized = false; // Will use enhanced heuristic parsing
    }
  }

  getAvailableLanguages(): string[] {
    if (!this.initialized) return [];
    return this.treeSitter.getAvailableLanguages();
  }

  getParserInfo() {
    if (!this.initialized) return [];
    return this.treeSitter.getParserInfo();
  }

  // Enhanced chunking with Tree-sitter AST-based symbol extraction
  chunkFileWithTreeSitter(
    fullPath: string, 
    options: EnhancedIndexOptions
  ): Array<{ text: string; meta: EnhancedCodeChunkMetadata }> {
    
    const text = fs.readFileSync(fullPath, 'utf8');
    const relativeFile = path.relative(this.getProjectRoot(), fullPath).replace(/\\/g, '/');
    const language = (this as any).detectLanguage(fullPath);

    // Use enhanced heuristic parsing (Tree-sitter temporarily disabled due to npm package issues)
    console.log(`🔍 Using enhanced heuristic parsing for ${relativeFile}`);
    return this.enhancedHeuristicChunking(fullPath, text, options);

    const chunks: Array<{ text: string; meta: EnhancedCodeChunkMetadata }> = [];

    try {
      // Extract symbols using Tree-sitter
      const symbols = this.treeSitter.extractSymbols(fullPath, text);
      
      if (symbols.length === 0) {
        // No symbols found, fall back to line-based chunking if allowed
        if (options.astFallback !== false) {
          console.log(`📝 No symbols found, falling back to line chunking for ${relativeFile}`);
          return this.fallbackToHeuristicChunking(fullPath, text, options);
        } else {
          return [];
        }
      }

      console.log(`🌳 Extracted ${symbols.length} symbols from ${relativeFile}`);

      // Create chunks from symbols
      for (const symbol of symbols) {
        const meta: EnhancedCodeChunkMetadata = {
          file: relativeFile,
          language,
          lineStart: symbol.startLine + 1, // Convert to 1-based
          lineEnd: symbol.endLine + 1,
          symbol: symbol.name,
          symbolName: symbol.name,
          symbolType: symbol.type,
          signature: options.includeSignatures !== false ? symbol.signature : undefined,
          docstring: options.includeDocstrings !== false ? symbol.docstring : undefined,
          parentSymbol: symbol.parent,
          isTreeSitterParsed: true,
          parseMode: 'ast',
          tags: this.generateTagsForSymbol(symbol)
        };

        // Prepare chunk text
        let chunkText = symbol.content;
        
        // Optionally include docstring and signature in searchable content
        if (options.includeDocstrings && symbol.docstring) {
          chunkText = `${symbol.docstring}\\n${chunkText}`;
        }
        
        chunks.push({ text: chunkText, meta });
      }

      return chunks;

    } catch (error: any) {
      console.warn(`⚠️ Tree-sitter parsing failed for ${relativeFile}:`, 
        error instanceof Error ? error.message : String(error));
      
      if (options.astFallback !== false) {
        return this.fallbackToHeuristicChunking(fullPath, text, options);
      } else {
        return [];
      }
    }
  }

  // Enhanced heuristic parsing with better symbol detection
  private enhancedHeuristicChunking(
    fullPath: string, 
    text: string, 
    options: EnhancedIndexOptions
  ): Array<{ text: string; meta: EnhancedCodeChunkMetadata }> {
    
    const lines = text.split(/\r?\n/);
    const chunks: Array<{ text: string; meta: EnhancedCodeChunkMetadata }> = [];
    const relativeFile = path.relative(this.getProjectRoot(), fullPath).replace(/\\/g, '/');
    const language = (this as any).detectLanguage(fullPath);

    // Extract symbols using regex patterns
    const symbols = this.extractSymbolsHeuristically(text, language, relativeFile);

    if (symbols.length > 0) {
      console.log(`🔍 Found ${symbols.length} symbols via heuristic parsing`);
      
      // Create chunks from detected symbols
      for (const symbol of symbols) {
        const meta: EnhancedCodeChunkMetadata = {
          file: relativeFile,
          language,
          lineStart: symbol.startLine,
          lineEnd: symbol.endLine,
          symbol: symbol.name,
          symbolName: symbol.name,
          symbolType: symbol.type,
          signature: symbol.signature,
          docstring: symbol.docstring,
          parentSymbol: symbol.parent,
          isTreeSitterParsed: false,
          parseMode: 'heuristic',
          tags: this.generateHeuristicTags(symbol)
        };

        chunks.push({ text: symbol.content, meta });
      }

      return chunks;
    }

    // Fallback to line-based chunking
    return this.fallbackToHeuristicChunking(fullPath, text, options);
  }

  // Fallback to original line-based chunking
  private fallbackToHeuristicChunking(
    fullPath: string, 
    text: string, 
    options: EnhancedIndexOptions
  ): Array<{ text: string; meta: EnhancedCodeChunkMetadata }> {
    
    const lines = text.split(/\r?\n/);
    const chunks: Array<{ text: string; meta: EnhancedCodeChunkMetadata }> = [];
    const maxLines = options.maxChunkLines ?? 200;
    const relativeFile = path.relative(this.getProjectRoot(), fullPath).replace(/\\/g, '/');

    for (let i = 0; i < lines.length; i += maxLines) {
      const slice = lines.slice(i, Math.min(i + maxLines, lines.length));
      
      const meta: EnhancedCodeChunkMetadata = {
        file: relativeFile,
        language: (this as any).detectLanguage(fullPath),
        lineStart: i + 1,
        lineEnd: Math.min(i + maxLines, lines.length),
        isTreeSitterParsed: false,
        parseMode: 'heuristic',
        tags: ['heuristic-chunk']
      };

      chunks.push({ text: slice.join('\n'), meta });
    }

    return chunks;
  }

  // Extract symbols using regex patterns (heuristic approach)
  private extractSymbolsHeuristically(text: string, language: string | undefined, filePath: string): Array<{
    name: string;
    type: 'function' | 'class' | 'method' | 'interface' | 'type';
    startLine: number;
    endLine: number;
    content: string;
    signature?: string;
    docstring?: string;
    parent?: string;
  }> {
    const symbols: Array<{
      name: string;
      type: 'function' | 'class' | 'method' | 'interface' | 'type';
      startLine: number;
      endLine: number;
      content: string;
      signature?: string;
      docstring?: string;
      parent?: string;
    }> = [];

    const lines = text.split(/\r?\n/);
    
    if (language === 'typescript' || language === 'javascript') {
      this.extractTypeScriptSymbols(lines, symbols);
    } else if (language === 'python') {
      this.extractPythonSymbolsHeuristic(lines, symbols);
    }

    return symbols;
  }

  // TypeScript/JavaScript heuristic symbol extraction
  private extractTypeScriptSymbols(lines: string[], symbols: Array<any>): void {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      // Function declarations
      const funcMatch = trimmed.match(/^(export\s+)?(async\s+)?function\s+(\w+)/);
      if (funcMatch) {
        const name = funcMatch[3];
        const endLine = this.findBlockEnd(lines, i);
        symbols.push({
          name,
          type: 'function' as const,
          startLine: i + 1,
          endLine: endLine + 1,
          content: lines.slice(i, endLine + 1).join('\n'),
          signature: trimmed.split('{')[0]?.trim(),
        });
        continue;
      }

      // Class declarations
      const classMatch = trimmed.match(/^(export\s+)?(abstract\s+)?class\s+(\w+)/);
      if (classMatch) {
        const name = classMatch[3];
        const endLine = this.findBlockEnd(lines, i);
        symbols.push({
          name,
          type: 'class' as const,
          startLine: i + 1,
          endLine: endLine + 1,
          content: lines.slice(i, endLine + 1).join('\n'),
        });
        continue;
      }

      // Interface declarations
      const interfaceMatch = trimmed.match(/^(export\s+)?interface\s+(\w+)/);
      if (interfaceMatch) {
        const name = interfaceMatch[2];
        const endLine = this.findBlockEnd(lines, i);
        symbols.push({
          name,
          type: 'interface' as const,
          startLine: i + 1,
          endLine: endLine + 1,
          content: lines.slice(i, endLine + 1).join('\n'),
        });
        continue;
      }

      // Method definitions (inside classes)
      const methodMatch = trimmed.match(/^(public|private|protected|static)?\s*(async\s+)?(\w+)\s*\(/);
      if (methodMatch && !trimmed.includes('function') && !trimmed.includes('=')) {
        const name = methodMatch[3];
        if (name && !['if', 'for', 'while', 'switch', 'catch'].includes(name)) {
          const endLine = this.findBlockEnd(lines, i);
          symbols.push({
            name,
            type: 'method' as const,
            startLine: i + 1,
            endLine: endLine + 1,
            content: lines.slice(i, endLine + 1).join('\n'),
            signature: trimmed.split('{')[0]?.trim(),
          });
        }
      }
    }
  }

  // Python heuristic symbol extraction
  private extractPythonSymbolsHeuristic(lines: string[], symbols: Array<any>): void {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      // Function/method definitions
      const funcMatch = trimmed.match(/^def\s+(\w+)/);
      if (funcMatch) {
        const name = funcMatch[1];
        const endLine = this.findPythonBlockEnd(lines, i);
        const isMethod = this.isInsidePythonClass(lines, i);
        symbols.push({
          name,
          type: isMethod ? 'method' as const : 'function' as const,
          startLine: i + 1,
          endLine: endLine + 1,
          content: lines.slice(i, endLine + 1).join('\n'),
          signature: trimmed,
        });
        continue;
      }

      // Class definitions
      const classMatch = trimmed.match(/^class\s+(\w+)/);
      if (classMatch) {
        const name = classMatch[1];
        const endLine = this.findPythonBlockEnd(lines, i);
        symbols.push({
          name,
          type: 'class' as const,
          startLine: i + 1,
          endLine: endLine + 1,
          content: lines.slice(i, endLine + 1).join('\n'),
        });
      }
    }
  }

  // Find the end of a block (JavaScript/TypeScript)
  private findBlockEnd(lines: string[], startIndex: number): number {
    let braceCount = 0;
    let inBlock = false;
    
    for (let i = startIndex; i < lines.length; i++) {
      const line = lines[i];
      for (const char of line) {
        if (char === '{') {
          braceCount++;
          inBlock = true;
        } else if (char === '}') {
          braceCount--;
          if (inBlock && braceCount === 0) {
            return i;
          }
        }
      }
    }
    
    return Math.min(startIndex + 50, lines.length - 1); // Fallback
  }

  // Find the end of a Python block
  private findPythonBlockEnd(lines: string[], startIndex: number): number {
    if (startIndex >= lines.length) return startIndex;
    
    const startIndent = this.getIndentLevel(lines[startIndex]);
    
    for (let i = startIndex + 1; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();
      
      if (trimmed === '') continue; // Skip empty lines
      
      const indent = this.getIndentLevel(line);
      if (indent <= startIndent) {
        return i - 1;
      }
    }
    
    return lines.length - 1;
  }

  // Check if a line is inside a Python class
  private isInsidePythonClass(lines: string[], lineIndex: number): boolean {
    for (let i = lineIndex - 1; i >= 0; i--) {
      const trimmed = lines[i].trim();
      if (trimmed.startsWith('class ')) return true;
      if (trimmed.startsWith('def ') && this.getIndentLevel(lines[i]) === 0) return false;
    }
    return false;
  }

  // Get indentation level
  private getIndentLevel(line: string): number {
    let count = 0;
    for (const char of line) {
      if (char === ' ') count++;
      else if (char === '\t') count += 4; // Treat tab as 4 spaces
      else break;
    }
    return count;
  }

  // Generate tags for heuristically parsed symbols
  private generateHeuristicTags(symbol: any): string[] {
    const tags = [symbol.type, 'heuristic-parsed'];
    if (symbol.parent) {
      tags.push('nested');
      tags.push(`parent:${symbol.parent}`);
    } else {
      tags.push('top-level');
    }
    return tags;
  }

  // Enhanced indexing with Tree-sitter support
  async indexFilesWithTreeSitter(
    opts: EnhancedIndexOptions, 
    onChunk: (chunk: { text: string; meta: EnhancedCodeChunkMetadata }) => Promise<void> | void
  ): Promise<number> {
    
    if (opts.useTreeSitter !== false) {
      await this.initialize();
    }

    let count = 0;
    const files = Array.from((this as any).walkFiles(this.getProjectRoot(), opts));
    
    console.log(`🚀 Indexing ${files.length} files with enhanced parsing...`);
    
    for (const file of files) {
      let chunks: Array<{ text: string; meta: EnhancedCodeChunkMetadata }>;

      if (opts.useTreeSitter !== false) {
        chunks = this.chunkFileWithTreeSitter(file as string, opts);
      } else {
        // Use original chunking but with enhanced metadata
        const originalChunks = this.chunkFile(file as string, opts.maxChunkLines ?? 200);
        chunks = originalChunks.map(chunk => ({
          ...chunk,
          meta: {
            ...chunk.meta,
            isTreeSitterParsed: false,
            parseMode: 'fallback' as const,
            tags: ['fallback-chunk']
          }
        }));
      }

      for (const chunk of chunks) {
        await onChunk(chunk);
        count++;
      }
    }

    console.log(`✅ Enhanced indexing complete: ${count} chunks processed`);
    return count;
  }

  // Generate contextual tags for symbols
  private generateTagsForSymbol(symbol: SymbolInfo): string[] {
    const tags: string[] = [];
    
    // Symbol type tag
    tags.push(symbol.type);
    
    // Language tag  
    tags.push(symbol.language);
    
    // Scope tags
    if (symbol.parent) {
      tags.push('nested');
      tags.push(`parent:${symbol.parent}`);
    } else {
      tags.push('top-level');
    }
    
    // Naming convention tags
    if (symbol.name.startsWith('_')) {
      tags.push('private');
    }
    if (symbol.name.toUpperCase() === symbol.name) {
      tags.push('constant');
    }
    if (symbol.name.includes('Test') || symbol.name.includes('test')) {
      tags.push('test');
    }
    
    // Documentation tags
    if (symbol.docstring) {
      tags.push('documented');
    }
    
    // Tree-sitter parsing tag
    tags.push('ast-parsed');
    
    return tags;
  }

  // Backwards compatibility - expose original methods
  chunkFile(fullPath: string, maxChunkLines: number): Array<{ text: string; meta: CodeChunkMetadata }> {
    return super.chunkFile(fullPath, maxChunkLines);
  }

  indexFiles(opts: IndexOptions, onChunk: (chunk: { text: string; meta: CodeChunkMetadata }) => Promise<void> | void): number {
    return super.indexFiles(opts, onChunk);
  }

  // Helper to access protected methods
  private getProjectRoot(): string {
    return (this as any).projectRoot;
  }


  async close(): Promise<void> {
    if (this.initialized) {
      await this.treeSitter.close();
      this.initialized = false;
    }
  }
}