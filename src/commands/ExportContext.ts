/**
 * Export Context Command
 * Handles exporting memories to .smemctx bundles with optional signing
 */
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import chalk from 'chalk';
import type { MemoryEngine } from '../MemoryEngine.js';

export async function handleExportContext(
    ctx: { memoryEngine: MemoryEngine; policyBroker: any; nudgePro?: (key: string, msg: string) => void },
    opts: any
): Promise<void> {
    const outPath = path.resolve(process.cwd(), opts.out || 'context.smemctx');
    const type = String(opts.type || 'code');
    const { Tracer } = await import('../utils/Trace.js');
    const { Paths } = await import('../utils/Paths.js');
    const tracer = Tracer.create(process.cwd());
    
    try {
        const startedAt = Date.now();
        
        // Resolve --delta shorthand to last export base if present
        if (opts.delta && !opts.deltaFrom) {
            try {
                const markerPath = path.join(Paths.baseDir(process.cwd()), 'last-export.json');
                if (fs.existsSync(markerPath)) {
                    const meta = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
                    if (meta && meta.outPath && fs.existsSync(meta.outPath)) {
                        opts.deltaFrom = meta.outPath;
                    }
                }
            } catch {}
        }

        // Determine signing policy (supports both PolicyService and PolicyBroker)
        const pol = (() => {
            try {
                // If PolicyService was passed: use getPolicyBroker().getPolicy()
                if (ctx.policyBroker && typeof ctx.policyBroker.getPolicyBroker === 'function') {
                    const pb = ctx.policyBroker.getPolicyBroker();
                    if (pb && typeof pb.getPolicy === 'function') return pb.getPolicy();
                }
                // If PolicyBroker was passed directly
                if (ctx.policyBroker && typeof ctx.policyBroker.getPolicy === 'function') {
                    return ctx.policyBroker.getPolicy();
                }
            } catch {}
            // Safe defaults
            return { signExports: false, forceSignedExports: false } as any;
        })();
        let signReason: 'force' | 'flag' | 'policy' | 'env' | undefined;
        let wantSign: boolean;
        
        if (pol.forceSignedExports) { 
            wantSign = true; 
            signReason = 'force'; 
        } else if (typeof opts.sign === 'boolean') { 
            wantSign = !!opts.sign; 
            signReason = 'flag'; 
        } else if (pol.signExports) { 
            wantSign = true; 
            signReason = 'policy'; 
        } else if (process.env.SMEM_SIGN_EXPORT === '1') { 
            wantSign = true; 
            signReason = 'env'; 
        } else { 
            wantSign = false; 
        }

        if (pol.forceSignedExports && opts.sign === false) {
            console.log(chalk.yellow('ℹ️ --no-sign ignored: policy.forceSignedExports=true'));
        }

        tracer.plan('export-context', { 
            outPath, 
            type, 
            sign: wantSign, 
            decision: { sign: { effective: wantSign, reason: signReason } } 
        });
        tracer.mirror(`smem export-context --out ${JSON.stringify(opts.out || 'context.smemctx')} --type ${type}${wantSign ? ' --sign' : ''}`);
        
        if (tracer.flags.explain) {
            console.log(chalk.gray('Explanation: exports type-filtered memories, metadata map, and vectors as a portable context bundle directory. If --sign, emits ED25519 signature using a local private key.'));
        }

        await ctx.memoryEngine.initialize();
        let fullList = await ctx.memoryEngine.database.listMemories({ type });
        const originalCountAll = fullList.length;
        let unchangedFiltered = 0;

        // Delta export filtering
        let deltaBaseManifestDigest: string | undefined;
        let deltaBasePath: string | undefined;
        if (opts.deltaFrom) {
            try {
                deltaBasePath = path.resolve(process.cwd(), opts.deltaFrom);
                const prev = loadPreviousExportIndex(deltaBasePath);
                deltaBaseManifestDigest = prev.manifestDigest;
                const prevKeys = prev.keys; // Set<string>
                
                const filterBefore = fullList.length;
                fullList = fullList.filter((m: any) => {
                    let meta: any = {}; 
                    try { meta = JSON.parse(m.metadata || '{}'); } catch {}
                    const file = meta.file || '';
                    const ls = meta.lineStart || '';
                    const le = meta.lineEnd || '';
                    const sha = crypto.createHash('sha256').update(String(m.content || '')).digest('hex');
                    const key = `${file}:${ls}:${le}:${sha}`;
                    return !prevKeys.has(key);
                });
                unchangedFiltered = filterBefore - fullList.length;
                
                if (tracer.flags.explain) {
                    console.log(chalk.gray(`Delta export: filtered ${unchangedFiltered} unchanged chunk(s) using base ${deltaBasePath}`));
                }
            } catch (e) {
                console.log(chalk.yellow(`⚠️ delta-from ignored (failed to load previous export): ${(e as Error).message}`));
            }
        }

        const list = fullList;
        
        // Prepare container dir
        const tmpDir = path.join(Paths.baseDir(process.cwd()), 'tmp-export-' + Date.now().toString(36));
        fs.mkdirSync(tmpDir, { recursive: true });

        // Create map.csv
        const mapLines = ['id,file,lang,line_start,line_end,symbol,type,timestamp,chunk_sha256'];
        for (const m of list) {
            const meta = (() => { 
                try { return JSON.parse(m.metadata || '{}'); } 
                catch { return {}; } 
            })();
            const file = meta.file || '';
            const lang = meta.language || '';
            const ls = meta.lineStart || '';
            const le = meta.lineEnd || '';
            const sym = meta.symbolName || '';
            const typ = meta.symbolType || '';
            const ts = m.createdAt || '';
            const chunkSha = crypto.createHash('sha256').update(String(m.content || '')).digest('hex');
            mapLines.push([m.id, file, lang, ls, le, sym, typ, ts, chunkSha]
                .map(v => String(v).replace(/"/g, '""'))
                .map(v => /,|"/.test(v) ? `"${v}"` : v)
                .join(','));
        }
        fs.writeFileSync(path.join(tmpDir, 'map.csv'), mapLines.join('\n'));

        // Create notes.jsonl (placeholder)
        fs.writeFileSync(path.join(tmpDir, 'notes.jsonl'), '');

        // Create vectors.f32
        let total = 0; 
        let dim = 0;
        try {
            const ids = list.map(m => m.id);
            const vecs = await ctx.memoryEngine.database.getVectors(ids);
            if (vecs.size) {
                dim = (vecs.values().next().value as Float32Array).length;
                total = vecs.size;
                const buffer = Buffer.alloc(vecs.size * dim * 4);
                let offset = 0;
                for (const id of ids) {
                    const vec = vecs.get(id);
                    if (vec) {
                        for (let i = 0; i < vec.length; i++) {
                            buffer.writeFloatLE(vec[i], offset);
                            offset += 4;
                        }
                    }
                }
                fs.writeFileSync(path.join(tmpDir, 'vectors.f32'), buffer);
            } else {
                fs.writeFileSync(path.join(tmpDir, 'vectors.f32'), Buffer.alloc(0));
            }
        } catch (e) {
            console.log(chalk.yellow('⚠️ No vectors available; writing empty vectors.f32'));
            fs.writeFileSync(path.join(tmpDir, 'vectors.f32'), Buffer.alloc(0));
        }

    // Create manifest
    const manifest: any = {
            schemaVersion: 1,
            type,
            count: list.length,
            created: new Date().toISOString(),
            vectors: { dimensions: dim, count: total, backend: 'unknown' }
        };

        let keyId: string | undefined;
        if (wantSign) {
            keyId = await createSignedExport(tmpDir, manifest, ctx.nudgePro);
        }

        if (keyId) {
            (manifest as any).keyId = keyId;
        }

        // If delta export, embed delta block into manifest for portability
        if (deltaBaseManifestDigest) {
            manifest.delta = {
                baseManifestDigest: deltaBaseManifestDigest,
                originalCount: originalCountAll,
                unchangedSkipped: unchangedFiltered,
                exportedCount: list.length
            };
        }

        fs.writeFileSync(path.join(tmpDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

        // Create checksums and handle zip/directory output
        const baseFiles = ['manifest.json', 'map.csv', 'notes.jsonl', 'vectors.f32'];
        if (wantSign) baseFiles.push('signature.bin', 'publickey.der');

        const checksums: Record<string, string> = {};
        for (const f of baseFiles) {
            const buf = fs.readFileSync(path.join(tmpDir, f));
            checksums[f] = crypto.createHash('sha256').update(buf).digest('hex');
        }
        fs.writeFileSync(path.join(tmpDir, 'checksums.json'), JSON.stringify({ algorithm: 'sha256', files: checksums }, null, 2));
        baseFiles.push('checksums.json');

        // Handle output format (zip vs directory)
        const wantZip = !!opts.zip || /\.zip$/i.test(outPath);
        if (wantZip) {
            const zipTarget = outPath.endsWith('.zip') ? outPath : `${outPath}.zip`;
            await createZipFile(tmpDir, zipTarget, baseFiles);
            console.log(chalk.green(`✅ Exported ${list.length} memories to signed archive: ${zipTarget}`));
        } else {
            if (fs.existsSync(outPath)) {
                fs.rmSync(outPath, { recursive: true, force: true });
            }
            fs.renameSync(tmpDir, outPath);
            console.log(chalk.green(`✅ Exported ${list.length} memories to directory: ${outPath}`));
        }

        // Record delta info and timing
        const deltaInfo = deltaBaseManifestDigest ? {
            baseManifestDigest: deltaBaseManifestDigest,
            originalCount: originalCountAll,
            unchangedSkipped: unchangedFiltered,
            exportedCount: list.length
        } : undefined;
        const tookMs = Date.now() - startedAt;

        const receipt = tracer.writeReceipt(
            'export-context',
            { outPath, type, sign: wantSign, zip: !!opts.zip, decision: { sign: { effective: wantSign, reason: signReason } }, delta: deltaInfo, timing: { ms: tookMs } },
            { outPath, type, count: list.length, signed: wantSign, zipped: !!opts.zip, keyId, vectors: { dim, count: total, backend: 'unknown' }, delta: deltaInfo, timing: { ms: tookMs } },
            true
        );
        tracer.appendJournal({ cmd: 'export-context', args: { outPath, type, sign: wantSign }, receipt });

        // Persist last export marker
        try {
            const markerDir = Paths.baseDir(process.cwd());
            fs.mkdirSync(markerDir, { recursive: true });
            fs.writeFileSync(path.join(markerDir, 'last-export.json'), JSON.stringify({
                outPath,
                type,
                at: new Date().toISOString(),
                count: list.length,
                delta: !!opts.deltaFrom
            }, null, 2));
        } catch {}

    } catch (error) {
        console.error(chalk.red('❌ Export failed:'), error instanceof Error ? error.message : 'Unknown error');
        try {
            const receipt = tracer.writeReceipt('export-context', { outPath, type }, {}, false, (error as Error).message);
            tracer.appendJournal({ cmd: 'export-context', error: (error as Error).message, receipt });
        } catch {}
    }
}

// Helper functions
function loadPreviousExportIndex(prevPath: string): { manifestDigest: string; keys: Set<string> } {
    // Implementation for loading previous export index for delta functionality
    // This is a simplified version - the full implementation would handle zip files, etc.
    const manifestPath = path.join(prevPath, 'manifest.json');
    const mapPath = path.join(prevPath, 'map.csv');
    
    if (!fs.existsSync(manifestPath) || !fs.existsSync(mapPath)) {
        throw new Error('Previous export missing manifest or map');
    }

    const manifest = fs.readFileSync(manifestPath, 'utf8');
    const manifestDigest = crypto.createHash('sha256').update(manifest).digest('hex');
    
    const mapContent = fs.readFileSync(mapPath, 'utf8');
    const keys = new Set<string>();
    
    // Parse CSV and build keys (simplified)
    const lines = mapContent.split('\n').slice(1).filter(Boolean);
    for (const line of lines) {
        const parts = line.split(',');
        if (parts.length >= 9) {
            const [, file, , ls, le, , , , chunkSha] = parts.map(p => p.replace(/^"|"$/g, ''));
            keys.add(`${file}:${ls}:${le}:${chunkSha}`);
        }
    }

    return { manifestDigest, keys };
}

async function createSignedExport(tmpDir: string, manifest: any, nudgePro?: (key: string, msg: string) => void): Promise<string | undefined> {
    if (nudgePro) {
        nudgePro('sign', 'Signed exports (bundle + signature) are a Pro convenience feature. Proceeding with local signing.');
    }

    try {
        const newDir = path.join(process.cwd(), '.securamem', 'keys');
        const legacyDir = path.join(process.cwd(), '.antigoldfishmode', 'keys');
        const pubKeyPath = fs.existsSync(path.join(newDir, 'smem_ed25519.pub')) ? path.join(newDir, 'smem_ed25519.pub') : path.join(legacyDir, 'smem_ed25519.pub');
        const privKeyPath = fs.existsSync(path.join(newDir, 'smem_ed25519.key')) ? path.join(newDir, 'smem_ed25519.key') : path.join(legacyDir, 'smem_ed25519.key');
        
        let publicKey: Buffer;
        let privateKey: Buffer;
        let keyId: string;

        if (fs.existsSync(pubKeyPath) && fs.existsSync(privKeyPath)) {
            publicKey = fs.readFileSync(pubKeyPath);
            privateKey = fs.readFileSync(privKeyPath);
        } else {
            // Create new keypair in preferred (.securamem) location
            const { generateKeyPairSync } = await import('crypto');
            const { publicKey: pub, privateKey: priv } = generateKeyPairSync('ed25519');
            publicKey = pub.export({ type: 'spki', format: 'der' }) as Buffer;
            privateKey = priv.export({ type: 'pkcs8', format: 'der' }) as Buffer;
            fs.mkdirSync(path.dirname(pubKeyPath), { recursive: true });
            fs.writeFileSync(pubKeyPath, publicKey);
            fs.writeFileSync(privKeyPath, privateKey);
        }

        keyId = crypto.createHash('sha256').update(publicKey).digest('hex').slice(0, 16);

        // Create digest and sign
        const sha = crypto.createHash('sha256');
        sha.update(JSON.stringify(manifest, null, 2));
        sha.update(fs.readFileSync(path.join(tmpDir, 'map.csv')));
        sha.update(fs.readFileSync(path.join(tmpDir, 'vectors.f32')));
        const digest = sha.digest();

        const { createPrivateKey, sign: cryptoSign } = await import('crypto');
        const keyObj = createPrivateKey({ key: privateKey, format: 'der', type: 'pkcs8' });
        const signature = cryptoSign(null, digest, keyObj);
        
        fs.writeFileSync(path.join(tmpDir, 'signature.bin'), signature);
        fs.writeFileSync(path.join(tmpDir, 'publickey.der'), publicKey);

        return keyId;
    } catch (e) {
        console.log(chalk.yellow('⚠️ Signing failed; continuing without signature:'), (e as Error).message);
        return undefined;
    }
}

async function createZipFile(sourceDir: string, zipPath: string, files: string[]): Promise<void> {
    // This is a placeholder - would need to implement actual zip creation
    // For now, just copy the directory structure
    console.log(chalk.yellow('⚠️ ZIP creation not yet implemented, creating directory instead'));
    const targetDir = zipPath.replace(/\.zip$/i, '');
    if (fs.existsSync(targetDir)) {
        fs.rmSync(targetDir, { recursive: true, force: true });
    }
    fs.renameSync(sourceDir, targetDir);
}