import * as ort from "onnxruntime-node";
import fs from "node:fs";
import path from "node:path";

export type Embeddings = Float32Array;

interface TokenizerConfig {
  model: {
    vocab: Record<string, number>;
    unk_token: string;
    cls_token: string;
    sep_token: string;
    pad_token: string;
    max_len: number;
  };
}

export class LocalOnnxProvider {
  private session?: ort.InferenceSession;
  private tokenizer?: TokenizerConfig;
  private vocab?: Map<string, number>;
  private specialTokens?: Map<string, number>;

  constructor(private root: string, private modelName = "all-MiniLM-L6-v2") {}

  private modelDir() {
    // Handle case where root might be smem-cli subdirectory
    const actualRoot = this.root.endsWith('smem-cli') ? path.dirname(this.root) : this.root;
    return path.join(actualRoot, ".securamem", "models", this.modelName);
  }

  async init() {
    const dir = this.modelDir();
    const onnxPath = path.join(dir, "model.onnx");
    const tokenizerPath = path.join(dir, "tokenizer.json");
    
    if (!fs.existsSync(onnxPath) || !fs.existsSync(tokenizerPath)) {
      throw new Error(`Local model missing in ${dir}. Run: npm run download-models`);
    }

    // Load ONNX model
    this.session = await ort.InferenceSession.create(onnxPath, { 
      executionProviders: ["cpu"],
      logSeverityLevel: 3 // Only errors
    });
    
    // Load tokenizer
    this.tokenizer = JSON.parse(fs.readFileSync(tokenizerPath, "utf8"));
    this.vocab = new Map(Object.entries(this.tokenizer!.model.vocab));
    
    // Common special tokens for sentence transformers
    this.specialTokens = new Map([
      ["[CLS]", 101],
      ["[SEP]", 102], 
      ["[PAD]", 0],
      ["[UNK]", 100],
      ["[MASK]", 103]
    ]);

    console.log(`✅ Local ONNX model loaded: ${this.modelName}`);
  }

  // Simple WordPiece-style tokenizer for sentence transformers
  private encode(text: string): { input_ids: number[]; attention_mask: number[] } {
    if (!this.vocab || !this.specialTokens) {
      throw new Error("Tokenizer not initialized");
    }

    // Basic preprocessing
    text = text.toLowerCase().trim();
    
    // Simple word-level tokenization (not full WordPiece, but functional for demo)
    const words = text.split(/\\s+/);
    const tokens: number[] = [this.specialTokens.get("[CLS]")!]; // Start with CLS
    
    for (const word of words) {
      // Try exact match first
      if (this.vocab.has(word)) {
        tokens.push(this.vocab.get(word)!);
      } else {
        // Simple fallback: try subwords or use UNK
        let found = false;
        for (let i = word.length; i > 0 && !found; i--) {
          const subword = word.substring(0, i);
          if (this.vocab.has(subword)) {
            tokens.push(this.vocab.get(subword)!);
            found = true;
            // In full WordPiece, we'd continue with the rest of the word
          }
        }
        if (!found) {
          tokens.push(this.specialTokens.get("[UNK]")!);
        }
      }
    }
    
    tokens.push(this.specialTokens.get("[SEP]")!); // End with SEP
    
    // Limit sequence length (common max is 512)
    const maxLen = Math.min(tokens.length, 512);
    const input_ids = tokens.slice(0, maxLen);
    const attention_mask = new Array(maxLen).fill(1);
    
    // Pad to consistent length for batching
    while (input_ids.length < 32) { // Small pad for demo
      input_ids.push(this.specialTokens.get("[PAD]")!);
      attention_mask.push(0);
    }

    return { input_ids, attention_mask };
  }

  async embed(texts: string[]): Promise<Embeddings[]> {
    if (!this.session) await this.init();
    
    const embeddings: Embeddings[] = [];
    
    for (const text of texts) {
      const { input_ids, attention_mask } = this.encode(text);
      
      // Convert to int64 tensors for ONNX
      const inputTensor = new ort.Tensor("int64", BigInt64Array.from(input_ids.map(id => BigInt(id))), [1, input_ids.length]);
      const maskTensor = new ort.Tensor("int64", BigInt64Array.from(attention_mask.map(mask => BigInt(mask))), [1, attention_mask.length]);
      
      const feeds: Record<string, ort.Tensor> = {
        "input_ids": inputTensor,
        "attention_mask": maskTensor,
      };
      
      try {
        const results = await this.session!.run(feeds);
        
        // Common output names for sentence transformers
        let outputTensor = results["last_hidden_state"] || results["sentence_embedding"] || results[Object.keys(results)[0]];
        
        if (!outputTensor) {
          throw new Error("No valid output tensor found");
        }
        
        // Mean pooling across tokens to get sentence embedding
        const data = outputTensor.data as Float32Array;
        const [batch, seqLen, hiddenSize] = outputTensor.dims;
        
        const embedding = new Float32Array(hiddenSize);
        let validTokens = 0;
        
        // Mean pool over non-padding tokens
        for (let i = 0; i < seqLen; i++) {
          if (attention_mask[i] === 1) {
            validTokens++;
            for (let j = 0; j < hiddenSize; j++) {
              embedding[j] += data[i * hiddenSize + j];
            }
          }
        }
        
        // Normalize by number of valid tokens
        if (validTokens > 0) {
          for (let j = 0; j < hiddenSize; j++) {
            embedding[j] /= validTokens;
          }
        }
        
        embeddings.push(embedding);
        
      } catch (error) {
        console.error(`Failed to embed text: "${text.substring(0, 50)}..."`, error);
        // Return zero vector as fallback
        embeddings.push(new Float32Array(384));
      }
    }
    
    return embeddings;
  }

  async close() {
    if (this.session) {
      await this.session.release();
      this.session = undefined;
    }
  }

  getDimensions(): number {
    return 384; // all-MiniLM-L6-v2 standard dimension
  }

  getModelInfo(): { name: string; dimension: number; status: string } {
    return {
      name: this.modelName,
      dimension: this.getDimensions(),
      status: this.session ? "loaded" : "not_loaded"
    };
  }
}