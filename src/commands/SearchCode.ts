/**
 * Search Code Command
 * Handles code search with optional hybrid semantic search
 */
import * as crypto from 'crypto';
import chalk from 'chalk';
import type { MemoryEngine } from '../MemoryEngine.js';

export async function handleSearchCode(
    ctx: { memoryEngine: MemoryEngine },
    query: string, 
    opts: any
): Promise<void> {
    const { Tracer } = await import('../utils/Trace.js');
    const tracer = Tracer.create(process.cwd());
    try {
        const topk = parseInt(opts.topk || '20', 10);
        const preview = parseInt(opts.preview || opts.n || '0', 10);
        const filterPath: string[] | undefined = opts.filterPath || opts.filter || opts.p;
        const hybrid = !!(opts.hybrid || opts.semantic);
        tracer.plan('search-code', { query, topk, preview, filterPath, hybrid, explain: tracer.flags.explain });
        tracer.mirror(`smem search-code ${JSON.stringify(query)} -k ${topk}${preview?` --preview ${preview}`:''}${filterPath?` --filter-path ${filterPath.join(' ')}`:''}${hybrid?' --hybrid':''}${tracer.flags.explain?' --explain':''}`);
        const rerankN = parseInt(opts.rerank || '200', 10) || 200;
        if (tracer.flags.explain) {
            const backend = 'fallback'; // vss query path not yet wired
            const fusion = 'score = 0.5 * BM25 + 0.5 * cosine';
            console.log(chalk.gray(`Explanation: FTS search across code-type memories;${hybrid?` hybrid/semantic mode re-ranks top ${rerankN} results with vector cosine using backend=${backend} and fusion ${fusion}.`:''} Optional --filter-path limits results by file globs.`));
        }

        if (tracer.flags.dryRun) {
            console.log(chalk.yellow('DRY-RUN: Skipping database search'));
            const receipt = tracer.writeReceipt('search-code', { query, topk, preview, dryRun: true, hybrid, rerankN }, { count: 0 }, true, undefined, { hybrid: { backend: 'fallback', fusionWeights: { bm25: 0.5, cosine: 0.5 }, rerankN } });
            tracer.appendJournal({ cmd: 'search-code', args: { query, topk, preview, dryRun: true, hybrid, rerankN }, receipt });
            return;
        }

        await ctx.memoryEngine.initialize();

        let results = await ctx.memoryEngine.database.searchMemories(query, { limit: hybrid ? rerankN : topk, type: 'code' });

        if (hybrid) {
            const take = Math.min(topk, results.length);
            const { EmbeddingProvider } = await import('../engine/embeddings/EmbeddingProvider.js');
            const provider = EmbeddingProvider.create(process.cwd());
            let queryVec: Float32Array | null = null;
            try {
                await provider.init();
                queryVec = await provider.embed(query);
            } catch (e) {
                if (tracer.flags.trace) console.log('Hybrid mode: embedding init failed, falling back to FTS only. Error:', String(e));
            }
            let backend = 'fallback';
            if (queryVec) {
                // If VSS is available, run a KNN to get top rerankN candidates by vector, then fuse with FTS by id.
                const vssKnn = await (ctx.memoryEngine.database as any).knnSearch(queryVec, rerankN).catch(() => [] as Array<{id:number;distance:number}>);
                if (vssKnn && vssKnn.length > 0) {
                    backend = 'vss';
                    const vssMap = new Map<number, number>();
                    vssKnn.forEach((row: {id:number;distance:number}) => { vssMap.set(row.id, row.distance); });
                    const scored = results.map(r => {
                        // Convert VSS distance to cosine-like score (approx): sim = 1 / (1 + distance)
                        const vDistance = vssMap.get(r.id) || 999; // high distance for missing
                        const cosineSim = Math.max(0, 1 / (1 + vDistance));
                        const bm25Score = r.relevance || 0;
                        const fusedScore = 0.5 * bm25Score + 0.5 * cosineSim;
                        return { ...r, relevance: fusedScore };
                    });
                    scored.sort((a, b) => (b.relevance || 0) - (a.relevance || 0));
                    results = scored.slice(0, take);
                }
            }
            if (backend === 'fallback') {
                results = results.slice(0, take);
            }
        }

        // If filter-symbol opts are provided, filter to matching symbol types
        const filterSymbols: string[] | undefined = opts.filterSymbol || opts.s;
        if (filterSymbols && filterSymbols.length) {
            const symbolPatterns = filterSymbols.map(s => new RegExp(s, 'i'));
            results = results.filter((r: any) => {
                let meta: any = {};
                try { meta = JSON.parse(r.metadata || '{}'); } catch {}
                return symbolPatterns.some(p => p.test(meta.symbolName || ''));
            });
        }
        
        // If filter-language opts are provided, filter to matching languages
        const filterLangs: string[] | undefined = opts.filterLanguage || opts.l;
        if (filterLangs && filterLangs.length) {
            const langPatterns = filterLangs.map(l => new RegExp(l, 'i'));
            results = results.filter((r: any) => {
                let meta: any = {};
                try { meta = JSON.parse(r.metadata || '{}'); } catch {}
                return langPatterns.some(p => p.test(meta.language || ''));
            });
        }

        // Apply file path filtering to results
        if (filterPath && filterPath.length) {
            const minimatch = await import('minimatch');
            results = results.filter((r: any) => {
                let meta: any = {};
                try { meta = JSON.parse(r.metadata || '{}'); } catch {}
                const file = meta.file || '';
                return filterPath.some(pattern => minimatch.minimatch(file, pattern));
            });
        }

        if (tracer.flags.json) {
            console.log(JSON.stringify(results.map(r => ({ ...r, content: preview > 0 ? r.content : undefined })), null, 2));
        } else {
            console.log(chalk.cyan(`🔍 Found ${results.length} match(es) for "${query}"`));
            console.log('');

            for (let i = 0; i < results.length; i++) {
                const result = results[i];
                const score = result.relevance?.toFixed(3) || 'N/A';
                let meta: any = {};
                try { meta = JSON.parse((result as any).metadata || '{}'); } catch {}
                const file = meta.file || 'unknown';
                const lineStart = meta.lineStart || '?';
                const lineEnd = meta.lineEnd || '?';
                const sym = meta.symbolName || '';
                const symType = meta.symbolType || '';

                console.log(chalk.yellow(`[${i + 1}] ${file}:${lineStart}-${lineEnd}${sym ? ` (${symType} ${sym})` : ''} - Score: ${score}`));
                if (preview > 0) {
                    let content = String(result.content || '');
                    const lines = content.split(/\r?\n/);
                    const displayLines = lines.slice(0, preview);
                    displayLines.forEach((line, idx) => {
                        console.log(chalk.gray(`   ${idx + 1}: ${line}`));
                    });
                    if (lines.length > preview) {
                        console.log(chalk.gray(`   ... (${lines.length - preview} more lines)`));
                    }
                }
                console.log('');
            }
        }

        // Compute a deterministic digest over result IDs (and file:line where available)
        const idList = results.map(r => {
            let meta: any = {}; try { meta = JSON.parse((r as any).metadata || '{}'); } catch {}
            const loc = meta.file ? `${meta.file}:${meta.lineStart}-${meta.lineEnd}` : '';
            return `${r.id}${loc?`@${loc}`:''}`;
        });
        const resultDigest = crypto.createHash('sha256').update(JSON.stringify(idList)).digest('hex');

        const backend = 'fallback';
        const receipt = tracer.writeReceipt('search-code', { query, topk, preview, filterPath, hybrid, rerankN, filterSymbols, filterLangs }, { count: results.length }, true, undefined, { resultSummary: { ids: idList.slice(0, 10) }, digests: { resultDigest }, hybrid: hybrid ? { backend, fusionWeights: { bm25: 0.5, cosine: 0.5 }, rerankN } : undefined });
        tracer.appendJournal({ cmd: 'search-code', args: { query, topk, preview, filterPath, hybrid, rerankN, filterSymbols, filterLangs }, receipt });
    } catch (error) {
        const receipt = tracer.writeReceipt('search-code', { query, topk: opts.topk }, {}, false, (error as Error).message);
        tracer.appendJournal({ cmd: 'search-code', error: (error as Error).message, receipt });
        const msg = error instanceof Error ? error.message : String(error);
        console.error(chalk.red('❌ search-code failed:'), msg);
        if (/Failed to decrypt database|integrity check failed/i.test(msg)) {
            console.error(chalk.yellow('Tip: run "smem init --force" to reset local DB artifacts if this persists.'));
        }
    }
}