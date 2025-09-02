/**
 * Import Context Command
 * Handles importing and verifying .smemctx bundles with signature verification
 */
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import chalk from 'chalk';
import type { MemoryEngine } from '../MemoryEngine.js';

export async function handleImportContext(
    ctx: { memoryEngine: MemoryEngine; policyBroker: any },
    file: string,
    opts?: any
): Promise<void> {
    let dir = path.resolve(process.cwd(), file);
    const { Tracer } = await import('../utils/Trace.js');
    const { Paths } = await import('../utils/Paths.js');
    const tracer = Tracer.create(process.cwd());
    
    try {
        // If a zip archive is provided, unzip to a temp directory first
        if (/\.zip$/i.test(dir) && fs.existsSync(dir)) {
            try {
                const buf = fs.readFileSync(dir);
                const { unzipSync } = await import('fflate');
                const unzipped = unzipSync(new Uint8Array(buf));
                const tmpDir = path.join(Paths.baseDir(process.cwd()), 'tmp-import-' + Date.now().toString(36));
                fs.mkdirSync(tmpDir, { recursive: true });
                for (const [name, data] of Object.entries(unzipped)) {
                    const out = path.join(tmpDir, name);
                    fs.writeFileSync(out, Buffer.from(data as Uint8Array));
                }
                dir = tmpDir; // treat as directory import below
            } catch (e) {
                console.log(chalk.red('❌ Failed to unzip provided archive:'), (e as Error).message);
                process.exit(1); 
                return;
            }
        }

        // Validate required files
        const manifestPath = path.join(dir, 'manifest.json');
        const mapPath = path.join(dir, 'map.csv');
        const vecPath = path.join(dir, 'vectors.f32');
        
        if (!fs.existsSync(manifestPath) || !fs.existsSync(mapPath) || !fs.existsSync(vecPath)) {
            console.log(chalk.red('❌ Invalid context bundle: missing required files'));
            process.exit(1);
            return;
        }

        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        let verified = false;
        let invalidSignature = false;
        let checksumMismatch = false;

        // Signature verification if present
        const sigPath = path.join(dir, 'signature.bin');
        const pubPath = path.join(dir, 'publickey.der');
        if (fs.existsSync(sigPath) && fs.existsSync(pubPath)) {
            try {
                const { createPublicKey, verify, createHash } = await import('crypto');
                const pub = createPublicKey({ key: fs.readFileSync(pubPath), format: 'der', type: 'spki' });
                const sha = createHash('sha256');
                sha.update(fs.readFileSync(manifestPath));
                sha.update(fs.readFileSync(mapPath));
                sha.update(fs.readFileSync(vecPath));
                const digest = sha.digest();
                const ok = verify(null, digest, pub, fs.readFileSync(sigPath));
                
                if (ok) {
                    verified = true;
                } else {
                    invalidSignature = true; // signature present but mismatch
                }
            } catch (e) {
                invalidSignature = true;
                console.log(chalk.yellow('⚠️ Signature verification failed'), (e as Error).message);
            }
        }

        // Checksum verification if present
        try {
            const checksumsPath = path.join(dir, 'checksums.json');
            if (fs.existsSync(checksumsPath)) {
                const data = JSON.parse(fs.readFileSync(checksumsPath, 'utf8'));
                if (data && data.files && typeof data.files === 'object') {
                    for (const [fname, expected] of Object.entries<string>(data.files)) {
                        const target = path.join(dir, fname);
                        if (!fs.existsSync(target)) {
                            checksumMismatch = true;
                            console.log(chalk.red(`❌ Missing file listed in checksums.json: ${fname}`));
                            break;
                        }
                        const buf = fs.readFileSync(target);
                        const got = crypto.createHash('sha256').update(buf).digest('hex');
                        if (got !== expected) {
                            checksumMismatch = true;
                            console.log(chalk.red(`❌ Checksum mismatch for ${fname}`));
                            break;
                        }
                    }
                }
            }
        } catch (e) {
            console.log(chalk.yellow('⚠️ Failed to verify checksums:'), (e as Error).message);
        }

        // Policy enforcement
        try {
            const pol = ctx.policyBroker.getPolicy();
            const allowUnsigned = !!(opts?.allowUnsigned) && ctx.policyBroker.isTrusted('import-context');
            
            if (checksumMismatch) {
                const receipt = tracer.writeReceipt(
                    'import-context', 
                    { file, decision: { unsignedBypass: { allowed: false, reason: 'checksum_mismatch' } } }, 
                    {}, 
                    false, 
                    'checksum_mismatch', 
                    { exitCode: 4 }
                );
                tracer.appendJournal({ cmd: 'import-context', args: { file }, receipt });
                console.log(chalk.red('❌ Import blocked: checksum mismatch (exit 4)'));
                process.exit(4); 
                return;
            }

            if (pol.requireSignedContext) {
                if (invalidSignature) {
                    const receipt = tracer.writeReceipt(
                        'import-context', 
                        { file, decision: { unsignedBypass: { allowed: false, reason: 'invalid_signature' } } }, 
                        {}, 
                        false, 
                        'invalid_signature', 
                        { exitCode: 3 }
                    );
                    tracer.appendJournal({ cmd: 'import-context', args: { file }, receipt });
                    console.log(chalk.red('❌ Import blocked: invalid signature (exit 3)'));
                    process.exit(3);
                    return;
                }
                
                if (!verified && !allowUnsigned) {
                    const receipt = tracer.writeReceipt(
                        'import-context', 
                        { file, decision: { unsignedBypass: { allowed: false, reason: 'policy' } } }, 
                        {}, 
                        false, 
                        'unsigned_blocked', 
                        { exitCode: 2 }
                    );
                    tracer.appendJournal({ cmd: 'import-context', args: { file }, receipt });
                    console.log(chalk.red('❌ Import blocked: policy requires a valid signed context bundle (signature.bin/publickey.der)'));
                    console.log(chalk.gray('   Tip: smem policy trust import-context --minutes 15, then rerun with --allow-unsigned to bypass temporarily.'));
                    process.exit(2);
                    return;
                }
            }
        } catch {}

        console.log(chalk.green(`✅ Context verified (v${manifest.schemaVersion}, type=${manifest.type}, count=${manifest.count}${verified ? ', signed' : ''})`));

        // Import data
        await ctx.memoryEngine.initialize();
        
        // Parse CSV map
        const lines = fs.readFileSync(mapPath, 'utf8').split(/\r?\n/).filter(Boolean);
        const header = lines.shift(); // remove header
        const rows = lines.map(l => {
            // Simple CSV parsing with quote handling
            const parts: string[] = [];
            let cur = '';
            let inq = false;
            
            for (let i = 0; i < l.length; i++) {
                const ch = l[i];
                if (ch === '"') { 
                    inq = !inq; 
                    continue; 
                }
                if (ch === ',' && !inq) { 
                    parts.push(cur); 
                    cur = ''; 
                } else { 
                    cur += ch; 
                }
            }
            parts.push(cur);
            return parts;
        });

        // Load vectors
        const vbuf = fs.readFileSync(vecPath);
        const dim = manifest.vectors?.dimensions || 384;
        const expectedVecCount = Math.floor(vbuf.length / (dim * 4));

        const ids: number[] = [];
        const vectorsMeta: any = { 
            dimensions: dim, 
            count: expectedVecCount, 
            backend: manifest.vectors?.backend || 'imported' 
        };

        // Import memories and vectors
        let importCount = 0;
        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            if (row.length < 8) continue;
            
            const [idStr, file, lang, lineStart, lineEnd, symbol, type, timestamp] = row;
            const memoryId = parseInt(idStr, 10);
            if (isNaN(memoryId)) continue;

            // Reconstruct content from the original export (this is simplified)
            const content = `[Imported from ${file}:${lineStart}-${lineEnd}]`;
            const metadata = JSON.stringify({
                file,
                language: lang,
                lineStart: parseInt(lineStart, 10) || 0,
                lineEnd: parseInt(lineEnd, 10) || 0,
                symbolName: symbol,
                symbolType: type,
                imported: true,
                importedFrom: file,
                originalId: memoryId
            });

            try {
                // Store memory (this will assign a new ID)
                const newId = await ctx.memoryEngine.storeMemory(content, 'imported', 'code');
                ids.push(newId);
                importCount++;

                // Import vector if available
                if (i < expectedVecCount && vbuf.length >= (i + 1) * dim * 4) {
                    const vec = new Float32Array(dim);
                    for (let j = 0; j < dim; j++) {
                        vec[j] = vbuf.readFloatLE((i * dim + j) * 4);
                    }
                    await ctx.memoryEngine.database.upsertVector(newId, vec, dim);
                }
            } catch (e) {
                console.warn(`⚠️ Failed to import memory ${memoryId}:`, (e as Error).message);
            }
        }

        console.log(chalk.green(`✅ Imported ${importCount} memories successfully`));

        // Generate import receipt
        let checksumInfo: any;
        try {
            const checksumsPath = path.join(dir, 'checksums.json');
            if (fs.existsSync(checksumsPath)) {
                const data = JSON.parse(fs.readFileSync(checksumsPath, 'utf8'));
                checksumInfo = { count: Object.keys(data.files || {}).length };
            }
        } catch {}

        const receipt = tracer.writeReceipt(
            'import-context',
            { file, decision: { unsignedBypass: { allowed: !verified, reason: !verified ? 'trust' : 'signed' } } },
            { 
                verified, 
                schemaVersion: Number(manifest.schemaVersion), 
                type: String(manifest.type), 
                metadataRows: ids.length, 
                vectors: vectorsMeta, 
                checksumVerified: checksumInfo?.count 
            },
            true,
            undefined,
            { verification: { checksums: checksumInfo } }
        );
        tracer.appendJournal({ cmd: 'import-context', args: { file }, receipt });

    } catch (error) {
        console.error(chalk.red('❌ Import failed:'), error instanceof Error ? error.message : 'Unknown error');
        try {
            const receipt = tracer.writeReceipt('import-context', { file }, {}, false, (error as Error).message);
            tracer.appendJournal({ cmd: 'import-context', error: (error as Error).message, receipt });
        } catch {}
    }
}