import { LocalOnnxProvider } from "./LocalOnnxProvider.js";

export interface EmbeddingProvider {
  embed(texts: string[]): Promise<Float32Array[]>;
  getDimensions(): number;
  getModelInfo(): { name: string; dimension: number; status: string };
  close?(): Promise<void>;
}

// Wrapper for @xenova/transformers fallback (dev environments only)
class XenovaProvider implements EmbeddingProvider {
  private pipeline: any;

  constructor(pipeline: any) {
    this.pipeline = pipeline;
  }

  async embed(texts: string[]): Promise<Float32Array[]> {
    const results = [];
    for (const text of texts) {
      const result = await this.pipeline(text, { pooling: 'mean', normalize: true });
      results.push(new Float32Array(result.data));
    }
    return results;
  }

  getDimensions(): number {
    return 384;
  }

  getModelInfo() {
    return {
      name: "all-MiniLM-L6-v2 (xenova)",
      dimension: 384,
      status: "network_fallback"
    };
  }
}

export async function getEmbeddingProvider(root = process.cwd()): Promise<EmbeddingProvider> {
  console.log('🔍 Initializing embedding provider...');
  
  // Try local ONNX provider first (air-gapped friendly)
  try {
    const localProvider = new LocalOnnxProvider(root);
    await localProvider.init();
    console.log('✅ Using local ONNX embedding model (air-gapped ready)');
    return localProvider;
  } catch (error) {
    console.warn('⚠️ Local ONNX model not available:', error instanceof Error ? error.message : String(error));
    
    // Check if we're in an air-gapped environment
    const isAirGapped = process.env.SECURAMEM_AIRGAPPED === 'true' || 
                       process.env.NODE_ENV === 'production';
    
    if (isAirGapped) {
      console.error('❌ Air-gapped mode enabled but no local model available');
      console.error('   Run: npm run download-models');
      console.error('   Then copy model files to .securamem/models/all-MiniLM-L6-v2/');
      throw new Error('No offline model found and network fallback disabled in air-gapped mode');
    }
    
    // Development fallback to @xenova/transformers (network required)
    try {
      console.log('🌐 Falling back to network-based embedding model (dev mode only)');
      
      // Dynamic import to avoid bundling in air-gapped builds
      const { pipeline } = await import("@xenova/transformers");
      const transformerPipeline = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2");
      
      console.log('✅ Using @xenova/transformers fallback (requires network)');
      return new XenovaProvider(transformerPipeline);
      
    } catch (fallbackError) {
      console.error('❌ Network fallback also failed:', fallbackError instanceof Error ? fallbackError.message : String(fallbackError));
      throw new Error(`No embedding provider available: local model missing and network fallback failed`);
    }
  }
}

export { LocalOnnxProvider };