import chalk from 'chalk';
import * as fs from 'fs';
import * as path from 'path';
import { MemoryEngine } from '../MemoryEngine';

export async function handleReport(ctx: { memoryEngine: MemoryEngine; cleanup: () => Promise<void>; }, options: { html?: boolean; open?: boolean }) {
  const { Tracer } = await import('../utils/Trace.js');
  const tracer = Tracer.create(process.cwd());
  
  try {
    tracer.plan('report', { format: options.html ? 'html' : 'json', open: options.open });
    tracer.mirror(`smem report${options.html ? ' --html' : ''}${options.open ? ' --open' : ''}`);

    await ctx.memoryEngine.initialize();

    if (options.html) {
      await generateHTMLReport(ctx.memoryEngine, options.open);
    } else {
      await generateJSONReport(ctx.memoryEngine);
    }

    const receipt = tracer.writeReceipt('report', options, { generated: true }, true);
    tracer.appendJournal({ cmd: 'report', args: options, receipt });
  } catch (error) {
    const { Tracer } = await import('../utils/Trace.js');
    const tracer2 = Tracer.create(process.cwd());
    const receipt = tracer2.writeReceipt('report', options, {}, false, (error as Error).message);
    tracer2.appendJournal({ cmd: 'report', error: (error as Error).message, receipt });
    console.error(chalk.red('❌ Failed to generate report:'), error instanceof Error ? error.message : 'Unknown error');
  } finally {
    await ctx.cleanup();
  }
}

async function generateHTMLReport(memoryEngine: MemoryEngine, openBrowser: boolean = false) {
  console.log(chalk.cyan('📊 Generating HTML Compliance Report'));
  
  // Gather all report data
  const reportData = await gatherReportData(memoryEngine);
  
  // Generate HTML
  const htmlContent = await generateHTMLContent(reportData);
  
  // Save report
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const reportPath = path.join(process.cwd(), '.securamem', 'reports', `compliance-report-${timestamp}.html`);
  
  // Ensure reports directory exists
  const reportsDir = path.dirname(reportPath);
  if (!fs.existsSync(reportsDir)) {
    fs.mkdirSync(reportsDir, { recursive: true });
  }
  
  fs.writeFileSync(reportPath, htmlContent, 'utf8');
  
  console.log(chalk.green('✅ HTML Report Generated'));
  console.log(`   Path: ${reportPath}`);
  console.log(`   Size: ${Math.round(fs.statSync(reportPath).size / 1024)} KB`);
  
  if (openBrowser) {
    try {
      const { spawn } = require('child_process');
      const start = process.platform === 'darwin' ? 'open' : 
                   process.platform === 'win32' ? 'start' : 'xdg-open';
      spawn(start, [reportPath], { detached: true });
      console.log(chalk.blue('🌐 Opening report in browser...'));
    } catch (e) {
      console.log(chalk.yellow('⚠️ Could not open browser automatically'));
      console.log(`   Open manually: ${reportPath}`);
    }
  }
}

async function generateJSONReport(memoryEngine: MemoryEngine) {
  console.log(chalk.cyan('📋 Generating JSON Report'));
  
  const reportData = await gatherReportData(memoryEngine);
  
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const reportPath = path.join(process.cwd(), '.securamem', 'reports', `compliance-report-${timestamp}.json`);
  
  const reportsDir = path.dirname(reportPath);
  if (!fs.existsSync(reportsDir)) {
    fs.mkdirSync(reportsDir, { recursive: true });
  }
  
  fs.writeFileSync(reportPath, JSON.stringify(reportData, null, 2), 'utf8');
  
  console.log(chalk.green('✅ JSON Report Generated'));
  console.log(`   Path: ${reportPath}`);
}

async function gatherReportData(memoryEngine: MemoryEngine) {
  console.log('🔍 Gathering system data...');
  
  // Core system stats
  const stats = await memoryEngine.getStatistics();
  const projectInfo = memoryEngine.getProjectInfo();
  
  // Vector backend info
  let vectorInfo = null;
  if ((memoryEngine as any).getVectorBackendInfo) {
    vectorInfo = await (memoryEngine as any).getVectorBackendInfo();
  }
  
  // Recent receipts
  const receiptsDir = path.join(process.cwd(), '.securamem', 'receipts');
  let recentReceipts = [];
  if (fs.existsSync(receiptsDir)) {
    const receiptFiles = fs.readdirSync(receiptsDir)
      .filter(f => f.endsWith('.json'))
      .sort()
      .slice(-20); // Last 20 receipts
      
    recentReceipts = receiptFiles.map(file => {
      try {
        const receiptPath = path.join(receiptsDir, file);
        return JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
      } catch (e) {
        return null;
      }
    }).filter(Boolean);
  }
  
  // Performance data (if available)
  const benchmarkDir = path.join(process.cwd(), '.securamem');
  let performanceData = null;
  if (fs.existsSync(benchmarkDir)) {
    const benchmarkFiles = fs.readdirSync(benchmarkDir)
      .filter(f => f.startsWith('benchmark-') && f.endsWith('.json'))
      .sort()
      .slice(-1); // Latest benchmark
      
    if (benchmarkFiles.length > 0) {
      try {
        const benchmarkPath = path.join(benchmarkDir, benchmarkFiles[0]);
        performanceData = JSON.parse(fs.readFileSync(benchmarkPath, 'utf8'));
      } catch (e) {
        // Ignore benchmark parsing errors
      }
    }
  }
  
  return {
    metadata: {
      generated: new Date().toISOString(),
      version: '1.0.0',
      platform: {
        os: process.platform,
        arch: process.arch,
        node: process.version
      },
      project: projectInfo
    },
    systemStats: stats,
    vectorBackend: vectorInfo,
    recentActivity: recentReceipts,
    performance: performanceData,
    compliance: {
      receiptsGenerated: recentReceipts.length,
      vectorIntegrityVerified: vectorInfo?.complianceReceipt?.integrity === 'VERIFIED',
      lastVerification: vectorInfo?.complianceReceipt?.builtAt || null
    }
  };
}

async function generateHTMLContent(reportData: any): Promise<string> {
  const template = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>SecuraMem Compliance Report</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;
            line-height: 1.6; 
            color: #333; 
            background: #f5f7fa;
            padding: 20px;
        }
        .container { max-width: 1200px; margin: 0 auto; }
        
        .header {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 30px;
            border-radius: 12px;
            margin-bottom: 30px;
            box-shadow: 0 10px 30px rgba(0,0,0,0.1);
        }
        
        .header h1 { font-size: 2.5rem; font-weight: 300; margin-bottom: 10px; }
        .header p { opacity: 0.9; font-size: 1.1rem; }
        
        .grid { 
            display: grid; 
            grid-template-columns: repeat(auto-fit, minmax(350px, 1fr)); 
            gap: 25px; 
            margin-bottom: 30px; 
        }
        
        .card {
            background: white;
            border-radius: 12px;
            padding: 25px;
            box-shadow: 0 5px 15px rgba(0,0,0,0.08);
            border: 1px solid #e1e8ed;
        }
        
        .card h3 {
            color: #2c3e50;
            margin-bottom: 20px;
            font-size: 1.3rem;
            display: flex;
            align-items: center;
            gap: 10px;
        }
        
        .status-item {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 12px 0;
            border-bottom: 1px solid #f0f3f6;
        }
        
        .status-item:last-child { border-bottom: none; }
        .status-item .label { color: #64748b; }
        .status-item .value { font-weight: 600; color: #1e293b; }
        
        .badge {
            padding: 4px 12px;
            border-radius: 20px;
            font-size: 0.85rem;
            font-weight: 600;
            text-transform: uppercase;
        }
        
        .badge.success { background: #d1fae5; color: #065f46; }
        .badge.warning { background: #fef3c7; color: #92400e; }
        .badge.info { background: #dbeafe; color: #1e40af; }
        
        .performance-chart {
            background: #f8fafc;
            border-radius: 8px;
            padding: 20px;
            margin: 15px 0;
        }
        
        .receipts-table {
            width: 100%;
            border-collapse: collapse;
            margin-top: 15px;
        }
        
        .receipts-table th,
        .receipts-table td {
            padding: 12px;
            text-align: left;
            border-bottom: 1px solid #e5e7eb;
        }
        
        .receipts-table th {
            background: #f9fafb;
            font-weight: 600;
            color: #374151;
        }
        
        .receipts-table tr:hover {
            background: #f9fafb;
        }
        
        .footer {
            text-align: center;
            color: #6b7280;
            font-size: 0.9rem;
            margin-top: 40px;
            padding: 20px;
        }
        
        .icon { font-size: 1.2rem; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🧠 SecuraMem Compliance Report</h1>
            <p>Generated: ${reportData.metadata.generated} | Platform: ${reportData.metadata.platform.os}-${reportData.metadata.platform.arch}</p>
        </div>
        
        <div class="grid">
            <div class="card">
                <h3><span class="icon">⚡</span> System Status</h3>
                <div class="status-item">
                    <span class="label">Memory Engine</span>
                    <span class="value badge success">Active</span>
                </div>
                <div class="status-item">
                    <span class="label">Database</span>
                    <span class="value">${reportData.systemStats.databaseSize}</span>
                </div>
                <div class="status-item">
                    <span class="label">Conversations</span>
                    <span class="value">${reportData.systemStats.conversationCount.toLocaleString()}</span>
                </div>
                <div class="status-item">
                    <span class="label">Messages</span>
                    <span class="value">${reportData.systemStats.messageCount.toLocaleString()}</span>
                </div>
                <div class="status-item">
                    <span class="label">Last Activity</span>
                    <span class="value">${reportData.systemStats.lastActivity || 'N/A'}</span>
                </div>
            </div>
            
            <div class="card">
                <h3><span class="icon">🔧</span> Vector Backend</h3>
                ${generateVectorBackendHTML(reportData.vectorBackend)}
            </div>
            
            <div class="card">
                <h3><span class="icon">🔒</span> Compliance Status</h3>
                <div class="status-item">
                    <span class="label">Receipts Generated</span>
                    <span class="value">${reportData.compliance.receiptsGenerated}</span>
                </div>
                <div class="status-item">
                    <span class="label">Vector Integrity</span>
                    <span class="value badge ${reportData.compliance.vectorIntegrityVerified ? 'success' : 'warning'}">
                        ${reportData.compliance.vectorIntegrityVerified ? 'Verified' : 'Pending'}
                    </span>
                </div>
                <div class="status-item">
                    <span class="label">Last Verification</span>
                    <span class="value">${reportData.compliance.lastVerification ? new Date(reportData.compliance.lastVerification).toLocaleString() : 'N/A'}</span>
                </div>
            </div>
            
            ${reportData.performance ? generatePerformanceHTML(reportData.performance) : ''}
        </div>
        
        <div class="card">
            <h3><span class="icon">📋</span> Recent Activity</h3>
            ${generateReceiptsHTML(reportData.recentActivity)}
        </div>
        
        <div class="footer">
            <p>SecuraMem Compliance Report v${reportData.metadata.version} | Generated by AI Memory Engine</p>
            <p>This report contains sensitive system information. Handle according to your organization's security policies.</p>
        </div>
    </div>
</body>
</html>`;
  
  return template;
}

function generateVectorBackendHTML(vectorBackend: any): string {
  if (!vectorBackend) {
    return '<div class="status-item"><span class="label">Status</span><span class="value badge warning">Not Available</span></div>';
  }
  
  return `
    <div class="status-item">
        <span class="label">Backend</span>
        <span class="value badge ${vectorBackend.backend === 'vec' ? 'success' : vectorBackend.backend === 'local-js' ? 'warning' : 'info'}">${vectorBackend.backend}</span>
    </div>
    <div class="status-item">
        <span class="label">Vectors Stored</span>
        <span class="value">${vectorBackend.count?.toLocaleString() || '0'}</span>
    </div>
    <div class="status-item">
        <span class="label">Dimensions</span>
        <span class="value">${vectorBackend.dimensions || 'N/A'}</span>
    </div>
    ${vectorBackend.extensionPath ? `
    <div class="status-item">
        <span class="label">Extension</span>
        <span class="value">${path.basename(vectorBackend.extensionPath)}</span>
    </div>
    <div class="status-item">
        <span class="label">SHA256</span>
        <span class="value">${vectorBackend.sha256?.substring(0, 16)}...</span>
    </div>
    ` : ''}
  `;
}

function generatePerformanceHTML(performance: any): string {
  if (!performance.results) return '';
  
  const backend = Object.keys(performance.results)[0];
  const results = performance.results[backend];
  
  return `
    <div class="card">
        <h3><span class="icon">📈</span> Performance Metrics</h3>
        <div class="performance-chart">
            <h4>Insert Performance (${backend})</h4>
            ${results.insert ? Object.entries(results.insert).map(([size, data]: [string, any]) => `
                <div class="status-item">
                    <span class="label">${size} vectors</span>
                    <span class="value">${data.opsPerSec.toLocaleString()} ops/sec</span>
                </div>
            `).join('') : ''}
            
            ${results.query ? `
                <h4 style="margin-top: 20px;">Query Performance</h4>
                ${Object.entries(results.query).map(([type, data]: [string, any]) => `
                    <div class="status-item">
                        <span class="label">${type}</span>
                        <span class="value">${data.queriesPerSec.toLocaleString()} queries/sec</span>
                    </div>
                `).join('')}
            ` : ''}
        </div>
    </div>
  `;
}

function generateReceiptsHTML(receipts: any[]): string {
  if (!receipts.length) {
    return '<p>No recent receipts found.</p>';
  }
  
  return `
    <table class="receipts-table">
        <thead>
            <tr>
                <th>Command</th>
                <th>Status</th>
                <th>Duration</th>
                <th>Timestamp</th>
            </tr>
        </thead>
        <tbody>
            ${receipts.slice(0, 10).map(receipt => `
                <tr>
                    <td>${receipt.command || 'unknown'}</td>
                    <td><span class="badge ${receipt.success ? 'success' : 'warning'}">${receipt.success ? 'Success' : 'Failed'}</span></td>
                    <td>${receipt.durationMs}ms</td>
                    <td>${new Date(receipt.startTime).toLocaleString()}</td>
                </tr>
            `).join('')}
        </tbody>
    </table>
  `;
}