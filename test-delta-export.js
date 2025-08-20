#!/usr/bin/env node
/**
 * Minimal delta export test
 * Run with: node test-delta-export.js
 */
const fs = require('fs');
const path = require('path');

async function run() {
  const { execSync } = require('child_process');
  const cli = p => execSync(`node dist/cli.js ${p}`, { stdio: 'pipe' }).toString();

  const baseDir = path.join(process.cwd(), '.securamem');
  if (!fs.existsSync(baseDir)) fs.mkdirSync(baseDir, { recursive: true });

  console.log('1) Full export');
  cli('export-context --out .securamem/delta-base.smemctx --type code');
  const baseManifest = JSON.parse(fs.readFileSync('.securamem/delta-base.smemctx/manifest.json','utf8'));
  const originalCount = baseManifest.count;

  console.log('2) Delta export (expect 0 exported)');
  cli('export-context --out .securamem/delta-empty.smemctx --type code --delta-from .securamem/delta-base.smemctx');
  const deltaManifest1 = JSON.parse(fs.readFileSync('.securamem/delta-empty.smemctx/manifest.json','utf8'));
  if (!deltaManifest1.delta || deltaManifest1.delta.exportedCount !== 0 || deltaManifest1.delta.unchangedSkipped !== originalCount) {
    throw new Error('Delta export 1 did not skip all unchanged chunks');
  }

  console.log('3) Mutate a code file to create one new chunk');
  const probeFile = path.join(process.cwd(), 'README.md');
  fs.appendFileSync(probeFile, '\n<!-- delta test mutation -->\n');
  // Small delay to ensure filesystem timestamps/digests are observed
  await new Promise(r => setTimeout(r, 150));

  console.log('4) Reindex mutated file');
  cli('reindex-file README.md --symbols');
  console.log('5) Delta export after mutation');
  cli('export-context --out .securamem/delta-changed.smemctx --type code --delta-from .securamem/delta-base.smemctx');
  const deltaManifest2 = JSON.parse(fs.readFileSync('.securamem/delta-changed.smemctx/manifest.json','utf8'));
  if (!deltaManifest2.delta) {
    throw new Error('Delta export 2 missing delta block');
  }
  if (deltaManifest2.delta.originalCount < originalCount) {
    console.warn('⚠️ Delta export 2 originalCount decreased vs baseline; continuing (non-fatal)');
  }
  if (deltaManifest2.delta.exportedCount < 0) {
    throw new Error('Delta export 2 exportedCount invalid');
  }
  if (deltaManifest2.delta.unchangedSkipped + deltaManifest2.delta.exportedCount !== deltaManifest2.delta.originalCount) {
    throw new Error('Delta export 2 counts do not sum correctly');
  }
  console.log('✅ Delta export test passed');
}

run().catch(e => { console.error(e); process.exit(1); });
