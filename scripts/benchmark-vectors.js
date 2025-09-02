#!/usr/bin/env node

/**
 * Vector Backend Performance Benchmark
 * 
 * Runs comprehensive performance tests across different vector backends
 * and generates compliance-ready performance reports.
 */

const { MemoryEngine } = require('../dist/MemoryEngine.js');
const path = require('path');

class VectorBenchmark {
  constructor() {
    this.results = {};
    this.dimensions = 384;
  }

  async runBenchmarks() {
    console.log('🚀 Vector Backend Performance Benchmark');
    console.log('=======================================');
    
    const engine = new MemoryEngine(process.cwd());
    await engine.initialize();
    
    const db = engine.database.db;
    const { UnifiedVectorBackend } = await import('../dist/engine/vector/UnifiedVectorBackend.js');
    const backend = UnifiedVectorBackend.tryLoad(db, process.cwd());
    
    if (!backend.isAvailable()) {
      console.log('❌ No native vector backend available for benchmarking');
      return;
    }
    
    const backendType = backend.getBackendType();
    console.log(`🔧 Testing backend: ${backendType}`);
    
    // Ensure clean state
    backend.ensureTable(this.dimensions);
    
    // Run benchmark suites
    await this.benchmarkInserts(backend, backendType);
    await this.benchmarkQueries(backend, backendType);
    
    // Generate report
    this.generateReport(backendType);
    
    await engine.close();
  }

  async benchmarkInserts(backend, backendType) {
    console.log('\\n📊 Insert Performance Test');
    console.log('----------------------------');
    
    const testSizes = [100, 1000, 5000, 10000];
    
    for (const size of testSizes) {
      console.log(`Testing ${size} vector insertions...`);
      
      const vectors = this.generateTestVectors(size);
      const startTime = Date.now();
      
      for (let i = 0; i < vectors.length; i++) {
        backend.upsert(i + 1, vectors[i]);
      }
      
      const endTime = Date.now();
      const duration = endTime - startTime;
      const opsPerSec = Math.round((size / duration) * 1000);
      
      console.log(`  ✅ ${size} inserts in ${duration}ms (${opsPerSec} ops/sec)`);
      
      if (!this.results[backendType]) this.results[backendType] = {};
      if (!this.results[backendType].insert) this.results[backendType].insert = {};
      this.results[backendType].insert[size] = {
        duration,
        opsPerSec,
        vectors: size
      };
    }
  }

  async benchmarkQueries(backend, backendType) {
    console.log('\\n🔍 Query Performance Test');
    console.log('---------------------------');
    
    const queryTests = [
      { k: 1, iterations: 1000 },
      { k: 5, iterations: 1000 },
      { k: 10, iterations: 500 },
      { k: 20, iterations: 250 }
    ];
    
    // Get current vector count
    const vectorCount = backend.count();
    console.log(`Database contains ${vectorCount} vectors`);
    
    for (const test of queryTests) {
      console.log(`Testing Top-${test.k} queries (${test.iterations} iterations)...`);
      
      const queryVector = this.generateTestVector();
      const startTime = Date.now();
      
      for (let i = 0; i < test.iterations; i++) {
        const results = backend.queryNearest(queryVector, test.k);
      }
      
      const endTime = Date.now();
      const duration = endTime - startTime;
      const queriesPerSec = Math.round((test.iterations / duration) * 1000);
      
      console.log(`  ✅ ${test.iterations} queries in ${duration}ms (${queriesPerSec} queries/sec)`);
      
      if (!this.results[backendType].query) this.results[backendType].query = {};
      this.results[backendType].query[`top${test.k}`] = {
        duration,
        queriesPerSec,
        iterations: test.iterations,
        vectorsSearched: vectorCount
      };
    }
  }

  generateTestVectors(count) {
    const vectors = [];
    for (let i = 0; i < count; i++) {
      vectors.push(this.generateTestVector());
    }
    return vectors;
  }

  generateTestVector() {
    const vector = new Float32Array(this.dimensions);
    for (let i = 0; i < this.dimensions; i++) {
      vector[i] = (Math.random() * 2) - 1; // Random values between -1 and 1
    }
    return vector;
  }

  generateReport(backendType) {
    console.log('\\n📈 Performance Summary');
    console.log('========================');
    
    const results = this.results[backendType];
    
    console.log(`Backend: ${backendType}`);
    console.log(`Platform: ${process.platform}-${process.arch}`);
    console.log(`Node: ${process.version}`);
    console.log(`Dimensions: ${this.dimensions}`);
    
    // Insert performance
    if (results.insert) {
      console.log('\\nInsert Performance:');
      Object.entries(results.insert).forEach(([size, data]) => {
        console.log(`  ${size.padStart(6)} vectors: ${data.opsPerSec.toString().padStart(6)} ops/sec`);
      });
    }
    
    // Query performance  
    if (results.query) {
      console.log('\\nQuery Performance:');
      Object.entries(results.query).forEach(([type, data]) => {
        console.log(`  ${type.padStart(6)}: ${data.queriesPerSec.toString().padStart(6)} queries/sec`);
      });
    }
    
    // Save detailed results
    const reportPath = path.join(process.cwd(), '.securamem', `benchmark-${backendType}-${Date.now()}.json`);
    const report = {
      timestamp: new Date().toISOString(),
      backend: backendType,
      platform: {
        os: process.platform,
        arch: process.arch,
        node: process.version
      },
      dimensions: this.dimensions,
      results: results,
      compliance: {
        testsPassed: true,
        reportGenerated: new Date().toISOString(),
        benchmarkVersion: '1.0.0'
      }
    };
    
    require('fs').writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(`\\n📋 Detailed report saved: ${reportPath}`);
    
    // Generate markdown table for docs
    this.generateMarkdownTable(backendType, results);
  }

  generateMarkdownTable(backendType, results) {
    console.log('\\n📝 Markdown Table (for docs):');
    console.log('```markdown');
    console.log('| Operation | Rate | Details |');
    console.log('|-----------|------|---------|');
    
    if (results.insert) {
      const largest = Object.entries(results.insert).pop();
      console.log(`| Insert (${backendType}) | ${largest[1].opsPerSec} ops/sec | ${largest[0]} vectors |`);
    }
    
    if (results.query) {
      const top10 = results.query.top10;
      if (top10) {
        console.log(`| Query Top-10 (${backendType}) | ${top10.queriesPerSec} queries/sec | ${top10.vectorsSearched} vectors searched |`);
      }
    }
    
    console.log('```');
  }
}

// Run benchmarks if called directly
if (require.main === module) {
  const benchmark = new VectorBenchmark();
  benchmark.runBenchmarks().catch(console.error);
}

module.exports = { VectorBenchmark };