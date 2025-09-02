import chalk from 'chalk';
import { MemoryEngine } from '../MemoryEngine';

export interface MemoryOptions {
    context?: string;
    type?: string;
}

export interface RecallOptions {
    limit?: string;
}

export interface MemoryOperationResult {
    success: boolean;
    data?: any;
    error?: string;
}

export class MemoryService {
    constructor(private memoryEngine: MemoryEngine) {}

    async storeMemory(content: string, options: MemoryOptions): Promise<MemoryOperationResult> {
        try {
            console.log(chalk.cyan('🛡️ SecuraMem - Secure AI Memory Storage'));

            // Store memory with validation
            const memoryId = await this.memoryEngine.storeMemory(
                content,
                options.context || 'general',
                options.type || 'general'
            );

            // Report usage locally only (no cloud)
            console.log(chalk.gray('📊 Local usage tracking only'));

            console.log(chalk.green('✅ Memory stored successfully'));
            console.log(chalk.gray(`   ID: ${memoryId}`));
            console.log(chalk.gray(`   Context: ${options.context || 'general'}`));
            console.log(chalk.gray(`   Type: ${options.type || 'general'}`));

            return {
                success: true,
                data: {
                    memoryId,
                    content,
                    context: options.context || 'general',
                    type: options.type || 'general'
                }
            };

        } catch (error) {
            console.error(chalk.red('❌ Failed to store memory:'));
            console.error(chalk.red(`   ${error instanceof Error ? error.message : 'Unknown error'}`));
            
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error'
            };
        }
    }

    async recallMemories(query: string, options: RecallOptions): Promise<MemoryOperationResult> {
        try {
            console.log(chalk.cyan('🔍 SecuraMem - Secure AI Memory Recall'));

            const limit = parseInt(options.limit || '10');
            if (isNaN(limit) || limit < 1 || limit > 100) {
                const errorMsg = 'Invalid limit: must be a number between 1 and 100';
                console.error(chalk.red(`❌ ${errorMsg}`));
                return {
                    success: false,
                    error: errorMsg
                };
            }

            const memories = await this.memoryEngine.searchMemories(query, limit);

            console.log(chalk.gray('📊 Local usage tracking only'));

            console.log(chalk.green(`✅ Found ${memories.length} memories for: "${query}"`));
            console.log('');
            console.log(chalk.cyan('📋 Results:'));
            console.log('');

            memories.forEach((memory, index) => {
                console.log(chalk.yellow(`${index + 1}. Memory ID: ${memory.id}`));
                console.log(chalk.gray(`   Date: ${new Date(memory.timestamp).toLocaleDateString()}`));
                console.log(chalk.gray(`   Relevance: ${(memory.relevance * 100).toFixed(1)}%`));
                console.log(`   Content: ${memory.content}`);
                console.log('');
            });

            const resultSummary = memories.length > 0
                ? `Found ${memories.length} memories matching "${query}": ${memories.slice(0, 2).map(m => m.content.substring(0, 50) + '...').join(', ')}`
                : `No memories found matching "${query}". Try different search terms.`;

            return {
                success: true,
                data: {
                    query,
                    limit,
                    memories,
                    resultsCount: memories.length,
                    resultSummary
                }
            };

        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : 'Unknown error';
            console.error(chalk.red('❌ Failed to recall memories:'));
            console.error(chalk.red(`   ${errorMsg}`));
            
            return {
                success: false,
                error: errorMsg
            };
        }
    }

    async cleanup(): Promise<void> {
        try {
            if (this.memoryEngine && this.memoryEngine.database) {
                await this.memoryEngine.database.close();
            }
        } catch (error) {
            // Ignore cleanup errors
        }
    }
}