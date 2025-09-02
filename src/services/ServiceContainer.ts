import { MemoryEngine } from '../MemoryEngine';
import { MemoryService } from './MemoryService';
import { PolicyService } from './PolicyService';
import { TracingService } from './TracingService';

export interface ServiceDependencies {
    projectPath?: string;
    skipValidation?: boolean;
    devMode?: boolean;
    secureMode?: boolean;
}

export class ServiceContainer {
    private static instance: ServiceContainer | null = null;
    
    private memoryEngine: MemoryEngine;
    private memoryService: MemoryService;
    private policyService: PolicyService;
    private tracingService: TracingService;

    constructor(dependencies: ServiceDependencies = {}) {
        const {
            projectPath = process.cwd(),
            skipValidation = false,
            devMode = false,
            secureMode = false
        } = dependencies;

        // Initialize core engine
        this.memoryEngine = new MemoryEngine(projectPath, skipValidation, devMode, secureMode);
        
        // Initialize services with dependencies
        this.memoryService = new MemoryService(this.memoryEngine);
        this.policyService = new PolicyService();
        this.tracingService = new TracingService(projectPath);
    }

    /**
     * Get singleton instance
     */
    static getInstance(dependencies?: ServiceDependencies): ServiceContainer {
        if (!ServiceContainer.instance) {
            ServiceContainer.instance = new ServiceContainer(dependencies);
        }
        return ServiceContainer.instance;
    }

    /**
     * Reset singleton instance (useful for testing)
     */
    static resetInstance(): void {
        ServiceContainer.instance = null;
    }

    /**
     * Get MemoryEngine instance
     */
    getMemoryEngine(): MemoryEngine {
        return this.memoryEngine;
    }

    /**
     * Get MemoryService instance
     */
    getMemoryService(): MemoryService {
        return this.memoryService;
    }

    /**
     * Get PolicyService instance
     */
    getPolicyService(): PolicyService {
        return this.policyService;
    }

    /**
     * Get TracingService instance
     */
    getTracingService(): TracingService {
        return this.tracingService;
    }

    /**
     * Initialize all services
     */
    async initialize(): Promise<void> {
        // Ensure tracer is initialized
        await this.tracingService.ensureTracer();
        
        // Additional initialization can be added here
    }

    /**
     * Cleanup all services
     */
    async cleanup(): Promise<void> {
        await this.memoryService.cleanup();
        // Additional cleanup can be added here
    }

    /**
     * Health check for all services
     */
    async healthCheck(): Promise<{ [service: string]: boolean }> {
        const health = {
            memoryEngine: false,
            memoryService: false,
            policyService: false,
            tracingService: false
        };

        try {
            // Check memory engine
            if (this.memoryEngine) {
                health.memoryEngine = true;
            }

            // Check memory service
            if (this.memoryService) {
                health.memoryService = true;
            }

            // Check policy service
            if (this.policyService) {
                health.policyService = true;
            }

            // Check tracing service
            if (this.tracingService) {
                health.tracingService = true;
            }

        } catch (error) {
            console.error('Health check error:', error);
        }

        return health;
    }
}