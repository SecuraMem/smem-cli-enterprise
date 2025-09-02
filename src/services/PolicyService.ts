import { PolicyBroker } from '../utils/PolicyBroker';

export interface PolicyValidationResult {
    allowed: boolean;
    error?: string;
}

export class PolicyService {
    private policyBroker: PolicyBroker;

    constructor() {
        this.policyBroker = new PolicyBroker();
    }

    /**
     * Enforce policy before command execution
     */
    enforcePolicyBeforeCommand(cmd: string, filePath?: string, envVars?: string[]): PolicyValidationResult {
        try {
            // Always allow help/version
            if (["--help", "-h", "help", "--version", "-V", "version"].includes(cmd)) {
                return { allowed: true };
            }

            if (!this.policyBroker.isCommandAllowed(cmd)) {
                const error = `Command not allowed by policy: ${cmd}. Tip: run 'smem policy allow-command ${cmd}' or 'smem --help'.`;
                return { allowed: false, error };
            }

            // Do not enforce project-level file path here to reduce friction; commands may enforce as needed.
            // Environment variables are not enforced globally at entry to reduce friction.
            // Specific commands may opt-in to strict env checks as needed.

            if (!this.policyBroker.isNetworkAllowed()) {
                // Optionally, block network requests here (implementation depends on your runtime)
            }

            this.policyBroker.logAction('command_executed', { cmd, filePath, envVars });
            
            return { allowed: true };

        } catch (error) {
            return { 
                allowed: false, 
                error: error instanceof Error ? error.message : 'Policy enforcement error' 
            };
        }
    }

    /**
     * Check if command is allowed by policy
     */
    isCommandAllowed(cmd: string): boolean {
        return this.policyBroker.isCommandAllowed(cmd);
    }

    /**
     * Check if network access is allowed
     */
    isNetworkAllowed(): boolean {
        return this.policyBroker.isNetworkAllowed();
    }

    /**
     * Log policy action
     */
    logAction(action: string, metadata: any): void {
        this.policyBroker.logAction(action, metadata);
    }

    /**
     * Get policy broker instance for advanced operations
     */
    getPolicyBroker(): PolicyBroker {
        return this.policyBroker;
    }
}

export class UtilityService {
    /**
     * Build highlight regex for search queries
     */
    static buildHighlightRegex(query: string): RegExp | null {
        const tokens = (query || '').toLowerCase().split(/[^a-z0-9_]+/i).filter(t => t.length >= 3);
        if (!tokens.length) return null;
        const escaped = tokens.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
        return new RegExp(`(${escaped.join('|')})`, 'ig');
    }

    /**
     * Convert glob pattern to regex
     */
    static globToRegex(glob: string): RegExp {
        const re = '^' + glob
            .replace(/[.+^${}()|[\]\\]/g, '\\$&')
            .replace(/\*\*/g, '.*')
            .replace(/\*/g, '[^/]*') + '$';
        return new RegExp(re);
    }

    /**
     * Check if path matches glob patterns
     */
    static pathMatches(globs: string[] | undefined, file: string): boolean {
        if (!globs || !globs.length) return true;
        const unix = file.replace(/\\/g, '/');
        return globs.some(g => UtilityService.globToRegex(g).test(unix));
    }
}