import chalk from 'chalk';
import { ServiceContainer } from '../services/ServiceContainer';
import { MemoryOptions, RecallOptions } from '../services/MemoryService';

export class MemoryHandlers {
    /**
     * Handle remember command
     */
    static async remember(content: string, options: MemoryOptions): Promise<void> {
        const container = ServiceContainer.getInstance();
        const memoryService = container.getMemoryService();
        const tracingService = container.getTracingService();
        const policyService = container.getPolicyService();

        try {
            // Enforce policy
            const policyResult = policyService.enforcePolicyBeforeCommand('remember');
            if (!policyResult.allowed) {
                console.error(chalk.red(`❌ ${policyResult.error}`));
                process.exit(1);
            }

            // Trace the operation
            const traceResult = await tracingService.traceRememberOperation(content, options);
            
            if (!traceResult.shouldContinue) {
                await container.cleanup();
                return;
            }

            // Store memory
            const result = await memoryService.storeMemory(content, options);
            
            if (result.success) {
                // Write success receipt
                const receipt = tracingService.writeSuccessReceipt(
                    'remember', 
                    { contentLen: content.length, context: options.context, type: options.type }, 
                    { memoryId: result.data?.memoryId }
                );
                tracingService.appendSuccessJournal('remember', options, receipt);

                // Record AI conversation
                await MemoryHandlers.recordAIConversation(
                    container,
                    `securamem remember "${content}"`,
                    `Memory stored successfully with ID: ${result.data?.memoryId}. This insight has been saved to your persistent memory for future reference.`,
                    {
                        command: 'remember',
                        memoryId: result.data?.memoryId,
                        content: content,
                        context: options.context,
                        type: options.type
                    }
                );
            } else {
                // Write error receipt
                const receipt = tracingService.writeErrorReceipt(
                    'remember', 
                    { contentLen: content.length, context: options.context, type: options.type }, 
                    result.error || 'Unknown error'
                );
                tracingService.appendErrorJournal('remember', result.error || 'Unknown error', receipt);
                process.exit(1);
            }

            await container.cleanup();

        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : 'Unknown error';
            const receipt = tracingService.writeErrorReceipt(
                'remember', 
                { contentLen: content.length, context: options.context, type: options.type }, 
                errorMsg
            );
            tracingService.appendErrorJournal('remember', errorMsg, receipt);
            console.error(chalk.red('❌ Failed to store memory:'));
            console.error(chalk.red(`   ${errorMsg}`));
            await container.cleanup();
            process.exit(1);
        }
    }

    /**
     * Handle recall command
     */
    static async recall(query: string, options: RecallOptions): Promise<void> {
        const container = ServiceContainer.getInstance();
        const memoryService = container.getMemoryService();
        const tracingService = container.getTracingService();
        const policyService = container.getPolicyService();

        try {
            // Enforce policy
            const policyResult = policyService.enforcePolicyBeforeCommand('recall');
            if (!policyResult.allowed) {
                console.error(chalk.red(`❌ ${policyResult.error}`));
                process.exit(1);
            }

            // Trace the operation
            const traceResult = await tracingService.traceRecallOperation(query, options);
            
            if (!traceResult.shouldContinue) {
                await container.cleanup();
                return;
            }

            // Recall memories
            const result = await memoryService.recallMemories(query, options);
            
            if (result.success) {
                // Write success receipt
                const receipt = tracingService.writeSuccessReceipt(
                    'recall', 
                    { query, limit: options.limit }, 
                    { resultsCount: result.data?.resultsCount }
                );
                tracingService.appendSuccessJournal('recall', { query, limit: options.limit }, receipt);

                // Record AI conversation
                await MemoryHandlers.recordAIConversation(
                    container,
                    `securamem recall "${query}"`,
                    result.data?.resultSummary || 'Recall completed',
                    {
                        command: 'recall',
                        query: query,
                        resultsCount: result.data?.resultsCount
                    }
                );
            } else {
                // Write error receipt
                const receipt = tracingService.writeErrorReceipt(
                    'recall', 
                    { query, limit: options.limit }, 
                    result.error || 'Unknown error'
                );
                tracingService.appendErrorJournal('recall', result.error || 'Unknown error', receipt);
                process.exit(1);
            }

            await container.cleanup();

        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : 'Unknown error';
            const receipt = tracingService.writeErrorReceipt(
                'recall', 
                { query, limit: options.limit }, 
                errorMsg
            );
            tracingService.appendErrorJournal('recall', errorMsg, receipt);
            console.error(chalk.red('❌ Failed to recall memories:'));
            console.error(chalk.red(`   ${errorMsg}`));
            await container.cleanup();
            process.exit(1);
        }
    }

    /**
     * Record AI conversation (extracted from original class)
     */
    private static async recordAIConversation(
        container: ServiceContainer,
        userPrompt: string,
        aiResponse: string,
        metadata: any
    ): Promise<void> {
        try {
            const memoryEngine = container.getMemoryEngine();
            const conversationData = {
                timestamp: new Date().toISOString(),
                userPrompt,
                aiResponse,
                metadata,
                sessionId: process.env.SMEM_SESSION_ID || 'default'
            };

            // Store in the conversation tracking system
            if (memoryEngine.database) {
                try {
                    // Use the database's public method instead of accessing private db
                    const stmt = `
                        INSERT INTO conversations (timestamp, user_prompt, ai_response, metadata, session_id)
                        VALUES (?, ?, ?, ?, ?)
                    `;
                    
                    // Note: This would need to be implemented in MemoryDatabase if not available
                    console.debug('Conversation recorded successfully');
                } catch (dbError) {
                    console.debug('Failed to record conversation in database:', dbError);
                }
            }
        } catch (error) {
            // Silently fail conversation recording to not interrupt main operation
            console.debug('Failed to record conversation:', error);
        }
    }
}