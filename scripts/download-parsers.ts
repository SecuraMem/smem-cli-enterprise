#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const ROOT = process.cwd();
const PARSERS_DIR = path.join(ROOT, ".securamem", "parsers");

// Tree-sitter parsers we want to bundle for precision code parsing
const SUPPORTED_PARSERS = [
  {
    name: "typescript",
    language: "typescript",
    extensions: [".ts", ".tsx"],
    wasmFile: "tree-sitter-typescript.wasm",
    description: "TypeScript and TSX parsing"
  },
  {
    name: "javascript", 
    language: "javascript",
    extensions: [".js", ".jsx", ".mjs"],
    wasmFile: "tree-sitter-javascript.wasm",
    description: "JavaScript and JSX parsing"
  },
  {
    name: "python",
    language: "python", 
    extensions: [".py", ".pyx", ".pyi"],
    wasmFile: "tree-sitter-python.wasm",
    description: "Python parsing"
  },
  {
    name: "go",
    language: "go",
    extensions: [".go"],
    wasmFile: "tree-sitter-go.wasm", 
    description: "Go language parsing"
  }
];

async function sha256(p: string): Promise<string> {
  const buf = fs.readFileSync(p);
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function ensureDirs() {
  fs.mkdirSync(PARSERS_DIR, { recursive: true });
}

async function verifyOrExit() {
  const missing = [];
  
  for (const parser of SUPPORTED_PARSERS) {
    const wasmPath = path.join(PARSERS_DIR, parser.wasmFile);
    if (!fs.existsSync(wasmPath)) {
      missing.push(parser);
    }
  }
  
  if (missing.length > 0) {
    console.error(`❌ Missing Tree-sitter WASM parsers in ${PARSERS_DIR}:`);
    missing.forEach(p => console.error(`   - ${p.wasmFile} (${p.description})`));
    console.error('');
    console.error('For air-gapped deployment:');
    console.error(`   1. Copy WASM parser files to: ${PARSERS_DIR}`);
    console.error('   2. Run: npm run download-parsers');
    console.error('');
    console.error('To generate WASM parsers:');
    console.error('   npm install tree-sitter-cli');
    console.error('   tree-sitter build-wasm node_modules/tree-sitter-typescript');
    console.error('   # Repeat for each language');
    console.error('');
    console.error('Required WASM files:');
    SUPPORTED_PARSERS.forEach(p => console.error(`   - ${p.wasmFile}`));
    process.exit(2);
  }
}

async function writeManifests() {
  const parsers = [];
  
  for (const parserConfig of SUPPORTED_PARSERS) {
    const wasmPath = path.join(PARSERS_DIR, parserConfig.wasmFile);
    const hash = await sha256(wasmPath);
    const stats = fs.statSync(wasmPath);
    
    parsers.push({
      ...parserConfig,
      sha256: hash,
      fileSize: stats.size,
      verifiedAt: new Date().toISOString()
    });
  }

  const manifest = {
    version: "1.0",
    parsers: parsers.map(p => ({
      name: p.name,
      language: p.language,
      extensions: p.extensions,
      wasmFile: p.wasmFile,
      sha256: p.sha256,
      fileSize: p.fileSize,
      description: p.description
    })),
    builtAt: new Date().toISOString(),
    totalParsers: parsers.length,
    notes: "Tree-sitter WASM parsers for offline code analysis"
  };
  
  const manifestPath = path.join(PARSERS_DIR, "manifest.json");
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  const receipt = {
    component: "tree-sitter-parsers",
    name: "tree-sitter-wasm-bundle",
    artifactRoot: ".securamem/parsers",
    sha256Tree: Object.fromEntries([
      ...parsers.map(p => [p.wasmFile, p.sha256]),
      ["manifest.json", await sha256(manifestPath)]
    ]),
    sbom: {
      runtime: "tree-sitter-wasm",
      version: "0.20+",
      parsers: parsers.map(p => ({ language: p.language, version: "latest" })),
      notes: "No network access required for parsing"
    },
    status: "VERIFIED",
    verifiedAt: new Date().toISOString(),
    supportedLanguages: parsers.map(p => p.language),
    totalFileSize: parsers.reduce((sum, p) => sum + p.fileSize, 0)
  };
  
  fs.writeFileSync(path.join(PARSERS_DIR, "RECEIPT.json"), JSON.stringify(receipt, null, 2));
  
  console.log('✅ Parser verification complete');
  console.log(`📁 Parser directory: ${PARSERS_DIR}`);
  console.log(`📋 Languages supported: ${parsers.map(p => p.language).join(', ')}`);
  console.log(`💾 Total size: ${Math.round(receipt.totalFileSize / 1024)} KB`);
  console.log('🔒 Receipts generated for compliance audit');
}

(async () => {
  try {
    console.log('🚀 SecuraMem Tree-sitter Parser Preparation');
    console.log('===========================================');
    
    ensureDirs();
    await verifyOrExit();
    await writeManifests();
    
    console.log('');
    console.log(`✅ Parsers ready: ${PARSERS_DIR}`);
    console.log('Next: Run "smem self-test" to verify offline parsing functionality');
  } catch (error) {
    console.error('❌ Parser preparation failed:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
})();