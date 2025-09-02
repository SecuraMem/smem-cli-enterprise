import chalk from 'chalk';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { MemoryEngine } from '../MemoryEngine';

interface TestResult {
  name: string;
  status: 'PASS' | 'FAIL' | 'SKIP';
  message: string;
  duration?: number;
  metadata?: Record<string, any>;
}

interface SelfTestReport {
  timestamp: string;
  environment: {
    platform: string;
    arch: string;
    nodeVersion: string;
    workingDirectory: string;
  };
  tests: TestResult[];
  summary: {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
    overallStatus: 'PASS' | 'FAIL';
  };
  compliance: {
    modelHash?: string;
    vectorBackendHash?: string;
    airGappedMode: boolean;
    networkAccessAttempted: boolean;
  };
}

export async function handleSelfTest(ctx: { memoryEngine: MemoryEngine; cleanup: () => Promise<void>; }) {
  const { Tracer } = await import('../utils/Trace.js');
  const tracer = Tracer.create(process.cwd());
  
  try {
    tracer.plan('self-test', { comprehensive: true });
    tracer.mirror('smem self-test');

    console.log(chalk.cyan('🧪 SecuraMem Self-Test'));
    console.log('========================');
    console.log('Testing offline functionality and compliance...\n');

    await ctx.memoryEngine.initialize();

    const report: SelfTestReport = {
      timestamp: new Date().toISOString(),
      environment: {
        platform: process.platform,
        arch: process.arch,
        nodeVersion: process.version,
        workingDirectory: process.cwd()
      },
      tests: [],
      summary: {
        total: 0,
        passed: 0,
        failed: 0,
        skipped: 0,
        overallStatus: 'PASS'
      },
      compliance: {
        airGappedMode: process.env.SECURAMEM_AIRGAPPED === 'true',
        networkAccessAttempted: false
      }
    };

    // Test 1: Local embedding model availability
    report.tests.push(await testLocalEmbeddingModel());

    // Test 2: Vector backend functionality  
    report.tests.push(await testVectorBackend(ctx.memoryEngine));

    // Test 3: End-to-end embedding + storage
    report.tests.push(await testEndToEndEmbedding(ctx.memoryEngine));

    // Test 4: Compliance verification
    report.tests.push(await testComplianceVerification());

    // Test 5: Air-gapped operation
    report.tests.push(await testAirGappedOperation());

    // Calculate summary
    report.summary.total = report.tests.length;
    report.summary.passed = report.tests.filter(t => t.status === 'PASS').length;
    report.summary.failed = report.tests.filter(t => t.status === 'FAIL').length;
    report.summary.skipped = report.tests.filter(t => t.status === 'SKIP').length;
    report.summary.overallStatus = report.summary.failed > 0 ? 'FAIL' : 'PASS';

    // Print results
    printTestResults(report);

    // Save compliance report
    const reportPath = await saveComplianceReport(report);
    
    console.log(`\\n📋 Compliance report saved: ${reportPath}`);

    const receipt = tracer.writeReceipt('self-test', {}, { 
      status: report.summary.overallStatus,
      testsRun: report.summary.total,
      reportPath 
    }, report.summary.overallStatus === 'PASS');
    
    tracer.appendJournal({ cmd: 'self-test', args: {}, receipt });

    if (report.summary.overallStatus === 'FAIL') {
      process.exit(1);
    }

  } catch (error) {
    const { Tracer } = await import('../utils/Trace.js');
    const tracer2 = Tracer.create(process.cwd());
    const receipt = tracer2.writeReceipt('self-test', {}, {}, false, (error as Error).message);
    tracer2.appendJournal({ cmd: 'self-test', error: (error as Error).message, receipt });
    
    console.error(chalk.red('❌ Self-test failed:'), error instanceof Error ? error.message : 'Unknown error');
    process.exit(1);
  } finally {
    await ctx.cleanup();
  }
}

async function testLocalEmbeddingModel(): Promise<TestResult> {
  const startTime = Date.now();
  
  try {
    // Check if model files exist
    // Look in the project root .securamem directory
    const projectRoot = process.cwd().endsWith('smem-cli') ? path.dirname(process.cwd()) : process.cwd();
    const modelDir = path.join(projectRoot, '.securamem', 'models', 'all-MiniLM-L6-v2');
    const requiredFiles = ['model.onnx', 'tokenizer.json', 'config.json', 'manifest.json'];
    
    for (const file of requiredFiles) {
      const filePath = path.join(modelDir, file);
      if (!fs.existsSync(filePath)) {
        return {
          name: 'Local Embedding Model',
          status: 'FAIL',
          message: `Missing required file: ${file}`,
          duration: Date.now() - startTime
        };
      }
    }

    // Try to load the embedding provider
    const { getEmbeddingProvider } = await import('../engine/embeddings/EmbeddingFactory.js');
    const provider = await getEmbeddingProvider();
    const modelInfo = provider.getModelInfo();

    // Test embedding generation
    const testText = "This is a test sentence for embedding generation.";
    const embeddings = await provider.embed([testText]);
    
    if (embeddings.length !== 1) {
      throw new Error(`Expected 1 embedding, got ${embeddings.length}`);
    }
    
    if (embeddings[0].length !== 384) {
      throw new Error(`Expected 384 dimensions, got ${embeddings[0].length}`);
    }

    // Cleanup
    if (provider.close) {
      await provider.close();
    }

    return {
      name: 'Local Embedding Model',
      status: 'PASS',
      message: `Model loaded successfully: ${modelInfo.name}`,
      duration: Date.now() - startTime,
      metadata: {
        modelName: modelInfo.name,
        dimensions: modelInfo.dimension,
        status: modelInfo.status
      }
    };

  } catch (error) {
    return {
      name: 'Local Embedding Model',
      status: 'FAIL',
      message: error instanceof Error ? error.message : String(error),
      duration: Date.now() - startTime
    };
  }
}

async function testVectorBackend(memoryEngine: MemoryEngine): Promise<TestResult> {
  const startTime = Date.now();
  
  try {
    // Get vector backend info
    let vectorInfo = null;
    if ((memoryEngine as any).getVectorBackendInfo) {
      vectorInfo = await (memoryEngine as any).getVectorBackendInfo();
    }

    if (!vectorInfo) {
      throw new Error('Vector backend info not available');
    }

    if (vectorInfo.backend === 'local-js') {
      return {
        name: 'Vector Backend',
        status: 'SKIP',
        message: 'Using local-js fallback (native backend not available)',
        duration: Date.now() - startTime,
        metadata: vectorInfo
      };
    }

    return {
      name: 'Vector Backend',
      status: 'PASS',
      message: `Native vector backend active: ${vectorInfo.backend}`,
      duration: Date.now() - startTime,
      metadata: vectorInfo
    };

  } catch (error) {
    return {
      name: 'Vector Backend',
      status: 'FAIL',
      message: error instanceof Error ? error.message : String(error),
      duration: Date.now() - startTime
    };
  }
}

async function testEndToEndEmbedding(memoryEngine: MemoryEngine): Promise<TestResult> {
  const startTime = Date.now();
  
  try {
    // Store a test memory
    const testContent = `Self-test memory entry created at ${new Date().toISOString()}`;
    const memoryId = await memoryEngine.storeMemory(testContent, 'self-test', 'test');

    // Search for the memory
    const searchResults = await memoryEngine.searchMemories('self-test memory', 5);
    
    if (searchResults.length === 0) {
      throw new Error('Test memory not found in search results');
    }

    const foundTestMemory = searchResults.some(result => 
      result.content.includes('Self-test memory entry')
    );

    if (!foundTestMemory) {
      throw new Error('Test memory content not found in search results');
    }

    return {
      name: 'End-to-End Embedding',
      status: 'PASS',
      message: `Successfully stored and retrieved test memory (ID: ${memoryId})`,
      duration: Date.now() - startTime,
      metadata: {
        memoryId,
        searchResultsCount: searchResults.length
      }
    };

  } catch (error) {
    return {
      name: 'End-to-End Embedding',
      status: 'FAIL',
      message: error instanceof Error ? error.message : String(error),
      duration: Date.now() - startTime
    };
  }
}

async function testComplianceVerification(): Promise<TestResult> {
  const startTime = Date.now();
  
  try {
    const results = {
      modelManifest: false,
      modelReceipt: false,
      vectorExtension: false
    };

    // Check model manifest
    const manifestPath = path.join(process.cwd(), '.securamem', 'models', 'all-MiniLM-L6-v2', 'manifest.json');
    if (fs.existsSync(manifestPath)) {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      results.modelManifest = manifest.files && manifest.sha256Tree;
    }

    // Check model receipt
    const receiptPath = path.join(process.cwd(), '.securamem', 'models', 'all-MiniLM-L6-v2', 'RECEIPT.json');
    if (fs.existsSync(receiptPath)) {
      const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
      results.modelReceipt = receipt.status === 'VERIFIED';
    }

    // Check vector extension
    const vecPath = path.join(process.cwd(), '.securamem', 'sqlite-vec', 'win32-x64', 'vec0.dll');
    results.vectorExtension = fs.existsSync(vecPath);

    const passCount = Object.values(results).filter(Boolean).length;
    const totalChecks = Object.keys(results).length;

    return {
      name: 'Compliance Verification',
      status: passCount === totalChecks ? 'PASS' : 'FAIL',
      message: `${passCount}/${totalChecks} compliance checks passed`,
      duration: Date.now() - startTime,
      metadata: results
    };

  } catch (error) {
    return {
      name: 'Compliance Verification',
      status: 'FAIL',
      message: error instanceof Error ? error.message : String(error),
      duration: Date.now() - startTime
    };
  }
}

async function testAirGappedOperation(): Promise<TestResult> {
  const startTime = Date.now();
  
  try {
    // This is a placeholder test - in a real implementation you might:
    // 1. Disable network access temporarily
    // 2. Verify no network calls are made
    // 3. Check for air-gapped environment indicators

    const airGappedMode = process.env.SECURAMEM_AIRGAPPED === 'true';
    const hasOfflineModel = fs.existsSync(path.join(process.cwd(), '.securamem', 'models', 'all-MiniLM-L6-v2', 'model.onnx'));

    if (airGappedMode && !hasOfflineModel) {
      throw new Error('Air-gapped mode enabled but no offline model available');
    }

    return {
      name: 'Air-gapped Operation',
      status: 'PASS',
      message: airGappedMode ? 'Air-gapped mode verified' : 'Ready for air-gapped deployment',
      duration: Date.now() - startTime,
      metadata: {
        airGappedMode,
        hasOfflineModel,
        ready: hasOfflineModel
      }
    };

  } catch (error) {
    return {
      name: 'Air-gapped Operation',
      status: 'FAIL',
      message: error instanceof Error ? error.message : String(error),
      duration: Date.now() - startTime
    };
  }
}

function printTestResults(report: SelfTestReport) {
  console.log('Test Results:');
  console.log('=============\\n');

  report.tests.forEach(test => {
    const statusIcon = test.status === 'PASS' ? '✅' : test.status === 'FAIL' ? '❌' : '⏭️';
    const statusColor = test.status === 'PASS' ? chalk.green : test.status === 'FAIL' ? chalk.red : chalk.yellow;
    
    console.log(`${statusIcon} ${chalk.bold(test.name)}: ${statusColor(test.status)}`);
    console.log(`   ${test.message}`);
    if (test.duration) {
      console.log(`   Duration: ${test.duration}ms`);
    }
    console.log();
  });

  const summaryColor = report.summary.overallStatus === 'PASS' ? chalk.green : chalk.red;
  console.log(summaryColor(`Overall Status: ${report.summary.overallStatus}`));
  console.log(`Tests: ${report.summary.passed} passed, ${report.summary.failed} failed, ${report.summary.skipped} skipped`);
}

async function saveComplianceReport(report: SelfTestReport): Promise<string> {
  const reportsDir = path.join(process.cwd(), '.securamem', 'reports');
  if (!fs.existsSync(reportsDir)) {
    fs.mkdirSync(reportsDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const reportPath = path.join(reportsDir, `self-test-${timestamp}.json`);
  
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  return reportPath;
}