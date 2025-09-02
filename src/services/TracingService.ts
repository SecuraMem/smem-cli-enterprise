import chalk from 'chalk';

export interface TracingFlags {
    explain: boolean;
    json: boolean;
    dryRun: boolean;
}

export interface TracingResult {
    receipt: any;
    shouldContinue: boolean;
}

export class TracingService {
    private tracer: any;

    constructor(private projectPath: string = process.cwd()) {
        this.initializeTracer();
    }

    private async initializeTracer(): Promise<void> {
        try {
            const { Tracer } = await import('../utils/Trace.js');
            this.tracer = Tracer.create(this.projectPath);
        } catch (error) {
            console.error(chalk.red('Failed to initialize tracer:'), error);
        }
    }

    async ensureTracer(): Promise<void> {
        if (!this.tracer) {
            await this.initializeTracer();
        }
    }

    get flags(): TracingFlags {
        return this.tracer ? {
            explain: this.tracer.flags.explain || false,
            json: this.tracer.flags.json || false,
            dryRun: this.tracer.flags.dryRun || false
        } : {
            explain: false,
            json: false,
            dryRun: false
        };
    }

    async traceCommand(
        command: string, 
        args: any, 
        explanation: string, 
        mirrorCommand: string
    ): Promise<TracingResult> {
        await this.ensureTracer();

        if (this.flags.explain) {
            console.log(chalk.gray(`Explanation: ${explanation}`));
        }

        if (this.flags.json) {
            console.log(JSON.stringify({ 
                op: command, 
                ...args 
            }, null, 2));
        }

        if (this.tracer) {
            this.tracer.plan(command, args);
            this.tracer.mirror(mirrorCommand);
        }

        if (this.flags.dryRun) {
            console.log(chalk.yellow(`DRY-RUN: Skipping ${command}`));
            const receipt = this.writeReceipt(command, args, {}, true);
            this.appendJournal({ 
                cmd: command, 
                args, 
                receipt 
            });
            return {
                receipt,
                shouldContinue: false
            };
        }

        return {
            receipt: null,
            shouldContinue: true
        };
    }

    writeReceipt(
        operation: string, 
        input: any, 
        output: any, 
        success: boolean, 
        error?: string
    ): any {
        if (!this.tracer) return null;

        return this.tracer.writeReceipt(
            operation, 
            input, 
            output, 
            success, 
            error
        );
    }

    appendJournal(entry: any): void {
        if (this.tracer) {
            this.tracer.appendJournal(entry);
        }
    }

    async traceRememberOperation(content: string, options: any): Promise<TracingResult> {
        const args = { 
            context: options.context, 
            type: options.type, 
            length: content.length 
        };
        
        const mirrorCommand = `smem remember ${JSON.stringify(content)} --context ${options.context} --type ${options.type}`;
        
        return this.traceCommand(
            'remember',
            args,
            'stores text locally with context and type labels.',
            mirrorCommand
        );
    }

    async traceRecallOperation(query: string, options: any): Promise<TracingResult> {
        const args = { 
            query, 
            limit: options.limit 
        };
        
        const mirrorCommand = `smem recall ${JSON.stringify(query)} --limit ${options.limit}`;
        
        return this.traceCommand(
            'recall',
            args,
            'searches stored memories by keyword with relevance scoring.',
            mirrorCommand
        );
    }

    writeSuccessReceipt(
        operation: string, 
        input: any, 
        output: any
    ): any {
        return this.writeReceipt(operation, input, output, true);
    }

    writeErrorReceipt(
        operation: string, 
        input: any, 
        error: string
    ): any {
        return this.writeReceipt(operation, input, {}, false, error);
    }

    appendSuccessJournal(cmd: string, args: any, receipt: any): void {
        this.appendJournal({ cmd, args, receipt });
    }

    appendErrorJournal(cmd: string, error: string, receipt: any): void {
        this.appendJournal({ cmd, error, receipt });
    }
}