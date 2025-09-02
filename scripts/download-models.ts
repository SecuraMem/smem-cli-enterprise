#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const ROOT = process.cwd();
const MODELS_DIR = path.join(ROOT, ".securamem", "models");
const MODEL_NAME = "all-MiniLM-L6-v2";
const MODEL_DIR = path.join(MODELS_DIR, MODEL_NAME);

async function sha256(p: string): Promise<string> {
  const buf = fs.readFileSync(p);
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function ensureDirs() {
  fs.mkdirSync(MODELS_DIR, { recursive: true });
  fs.mkdirSync(MODEL_DIR, { recursive: true });
}

// In an air-gapped site: instruct ops to copy files into MODEL_DIR manually.
// In a connected staging env: you could add a downloader here.
async function verifyOrExit() {
  const required = ["model.onnx", "tokenizer.json", "config.json", "LICENSE"];
  const missing = [];
  
  for (const f of required) {
    const p = path.join(MODEL_DIR, f);
    if (!fs.existsSync(p)) {
      missing.push(f);
    }
  }
  
  if (missing.length > 0) {
    console.error(`❌ Missing files in ${MODEL_DIR}:`);
    missing.forEach(f => console.error(`   - ${f}`));
    console.error('');
    console.error('For air-gapped deployment:');
    console.error(`   1. Copy model files to: ${MODEL_DIR}`);
    console.error('   2. Run: npm run download-models');
    console.error('');
    console.error('Required files:');
    required.forEach(f => console.error(`   - ${f}`));
    process.exit(2);
  }
}

async function writeManifests() {
  const files = ["model.onnx", "tokenizer.json", "config.json", "LICENSE"];
  const entries = await Promise.all(files.map(async f => {
    const p = path.join(MODEL_DIR, f);
    return { path: f, sha256: await sha256(p) };
  }));

  const manifest = {
    name: MODEL_NAME,
    format: "onnx",
    dimension: 384,
    files: entries,
    builtAt: new Date().toISOString(),
    license: "Apache-2.0"
  };
  
  const manifestPath = path.join(MODEL_DIR, "manifest.json");
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  
  // Add manifest to entries for receipt
  entries.push({ path: "manifest.json", sha256: await sha256(manifestPath) });

  const receipt = {
    component: "embedding-model",
    name: MODEL_NAME,
    artifactRoot: `.securamem/models/${MODEL_NAME}`,
    sha256Tree: Object.fromEntries(entries.map(e => [e.path, e.sha256])),
    sbom: { 
      runtime: "onnxruntime-node", 
      version: "1.x", 
      notes: "No network required" 
    },
    status: "VERIFIED",
    verifiedAt: new Date().toISOString()
  };
  
  fs.writeFileSync(path.join(MODEL_DIR, "RECEIPT.json"), JSON.stringify(receipt, null, 2));
  
  console.log('✅ Model verification complete');
  console.log(`📁 Model directory: ${MODEL_DIR}`);
  console.log(`📋 Files verified: ${entries.length}`);
  console.log('🔒 Receipts generated for compliance audit');
}

(async () => {
  try {
    console.log('🚀 SecuraMem Model Preparation');
    console.log('==============================');
    
    ensureDirs();
    await verifyOrExit();
    await writeManifests();
    
    console.log('');
    console.log(`✅ Model ready: ${MODEL_DIR}`);
    console.log('Next: Run "smem self-test" to verify offline embedding functionality');
  } catch (error) {
    console.error('❌ Model preparation failed:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
})();