/**
 * Log Ingest Router - LT-02
 * Routes raw log records through normalization, sampling, privacy classification
 * Feeds VIVO-35 data.ingest pipeline and multiple sink adapters
 */

import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';

interface LogRaw {
    source: string;
    level: 'debug' | 'info' | 'warn' | 'error';
    ts: string;
    msg: string;
    kv?: Record<string, any>;
    traceId?: string;
    spanId?: string;
}

interface RouterRule {
    match: {
        source?: string;
        level?: string;
        contains?: string;
    };
    action: {
        drop?: boolean;
        samplePct?: number;
        addTags?: Record<string, string>;
        sink?: string[];
    };
}

interface RouterRuleUpdate {
    routes: RouterRule[];
}

interface PrivacyPolicyUpdate {
    defaultClassification: string;
    rules: Array<{
        pattern: string;
        classification: string;
    }>;
}

interface DataIngest {
    source: string;
    topic: string;
    payload: any;
    data: {
        tags: {
            classification: string;
            subjectId?: string;
            labels: string[];
        };
    };
    audit: {
        producer: string;
        eventId: string;
    };
    timestamp: string;
}

interface LogSinkBatch {
    sink: string;
    lines: string[];
    codec: 'jsonl' | 'lp';
    timestamp: string;
}

interface LogRouterMetrics {
    in: number;
    out: number;
    dropped: number;
    sampled: number;
    byLevel: Record<string, number>;
    bySink: Record<string, number>;
    windowSec: number;
}

interface LogRouterAlert {
    level: 'info' | 'warn' | 'error';
    message: string;
    context: any;
    timestamp: string;
}

interface NormalizedLog {
    ts: string;
    msg: string;
    level: string;
    source: string;
    kv: Record<string, any>;
    traceId?: string;
    spanId?: string;
    classification: string;
    tags: string[];
}

interface SinkConfig {
    file?: {
        path: string;
        maxSizeMB?: number;
        maxFiles?: number;
    };
    s3?: {
        bucket: string;
        prefix: string;
        region?: string;
    };
    click?: {
        endpoint: string;
        table: string;
    };
}

interface Config {
    sampling: {
        defaultPct: number;
        errorPct: number;
        warnPct: number;
        infoPct: number;
        debugPct: number;
    };
    sinks: SinkConfig;
    privacyDefaultClass: string;
    maxBatch: number;
    maxWaitMs: number;
    backpressureThreshold: number;
    tz: string;
}

class LogIngestRouter extends EventEmitter {
    private config: Config;
    private logger: any;
    private isInitialized: boolean = false;
    
    // Routing rules
    private routingRules: RouterRule[] = [];
    private privacyRules: Array<{ pattern: RegExp; classification: string }> = [];
    
    // Batching for sinks
    private sinkBatches: Map<string, string[]> = new Map();
    private batchTimers: Map<string, NodeJS.Timeout> = new Map();
    
    // Backpressure tracking
    private inFlightCount: number = 0;
    private lastBackpressureAlert: number = 0;
    
    // Statistics
    private stats: {
        in: number;
        out: number;
        dropped: number;
        sampled: number;
        byLevel: Record<string, number>;
        bySink: Record<string, number>;
        windowStart: number;
    } = {
        in: 0,
        out: 0,
        dropped: 0,
        sampled: 0,
        byLevel: {},
        bySink: {},
        windowStart: Date.now()
    };

    constructor(config: Partial<Config> = {}) {
        super();
        this.config = {
            sampling: {
                defaultPct: 100,
                errorPct: 100,
                warnPct: 50,
                infoPct: 10,
                debugPct: 1
            },
            sinks: {
                file: {
                    path: 'logs/app-%Y%m%d.log',
                    maxSizeMB: 100,
                    maxFiles: 30
                },
                s3: {
                    bucket: 'vivo-logs',
                    prefix: '%Y/%m/%d/',
                    region: 'eu-west-1'
                }
            },
            privacyDefaultClass: 'SENSITIVE_LOW',
            maxBatch: 1000,
            maxWaitMs: 1000,
            backpressureThreshold: 10000,
            tz: 'Europe/Istanbul',
            ...config
        };

        // Initialize sink batches
        this.initializeSinks();

        // Metrics emission
        setInterval(() => {
            this.emitMetrics();
        }, 60000);
    }

    async initialize(logger: any): Promise<boolean> {
        try {
            this.logger = logger;
            this.logger.info('LogIngestRouter initializing...');
            
            // Ensure log directories exist
            await this.ensureLogDirectories();
            
            this.isInitialized = true;
            this.logger.info('LogIngestRouter initialized successfully');
            return true;
        } catch (error) {
            this.logger.error('LogIngestRouter initialization error:', error);
            return false;
        }
    }

    /**
     * Process raw log entry
     */
    async processLogRaw(data: LogRaw): Promise<void> {
        if (!this.isInitialized) return;

        try {
            this.stats.in++;
            this.stats.byLevel[data.level] = (this.stats.byLevel[data.level] || 0) + 1;

            // Check backpressure
            if (this.inFlightCount > this.config.backpressureThreshold) {
                await this.handleBackpressure();
                return;
            }

            this.inFlightCount++;

            // Apply routing rules
            const routingDecision = this.applyRoutingRules(data);
            
            if (routingDecision.drop) {
                this.stats.dropped++;
                this.inFlightCount--;
                return;
            }

            // Apply sampling
            if (!this.shouldSample(data.level, routingDecision.samplePct)) {
                this.stats.sampled++;
                this.inFlightCount--;
                return;
            }

            // Normalize log entry
            const normalized = await this.normalizeLog(data, routingDecision);

            // Send to data.ingest pipeline
            await this.sendToDataIngest(normalized);

            // Send to configured sinks
            for (const sink of routingDecision.sinks) {
                await this.sendToSink(normalized, sink);
            }

            this.stats.out++;
            this.inFlightCount--;

        } catch (error) {
            this.logger.error('LogIngestRouter log processing error:', error);
            this.inFlightCount--;
        }
    }

    /**
     * Update routing rules
     */
    async processRouterRuleUpdate(data: RouterRuleUpdate): Promise<void> {
        if (!this.isInitialized) return;

        try {
            this.routingRules = data.routes;
            this.logger.info(`LogIngestRouter updated with ${data.routes.length} routing rules`);

        } catch (error) {
            this.logger.error('LogIngestRouter rule update error:', error);
        }
    }

    /**
     * Update privacy policy
     */
    async processPrivacyPolicyUpdate(data: PrivacyPolicyUpdate): Promise<void> {
        if (!this.isInitialized) return;

        try {
            this.config.privacyDefaultClass = data.defaultClassification;
            
            // Compile regex patterns for privacy rules
            this.privacyRules = data.rules.map(rule => ({
                pattern: new RegExp(rule.pattern, 'i'),
                classification: rule.classification
            }));

            this.logger.info(`LogIngestRouter updated privacy policy with ${data.rules.length} rules`);

        } catch (error) {
            this.logger.error('LogIngestRouter privacy policy update error:', error);
        }
    }

    private applyRoutingRules(data: LogRaw): {
        drop: boolean;
        samplePct?: number;
        addTags: Record<string, string>;
        sinks: string[];
    } {
        let drop = false;
        let samplePct: number | undefined;
        let addTags: Record<string, string> = {};
        let sinks: string[] = ['file']; // Default sink

        for (const rule of this.routingRules) {
            if (this.matchesRule(data, rule.match)) {
                if (rule.action.drop) {
                    drop = true;
                    break;
                }
                
                if (rule.action.samplePct !== undefined) {
                    samplePct = rule.action.samplePct;
                }
                
                if (rule.action.addTags) {
                    addTags = { ...addTags, ...rule.action.addTags };
                }
                
                if (rule.action.sink) {
                    sinks = [...new Set([...sinks, ...rule.action.sink])];
                }
            }
        }

        return { drop, samplePct, addTags, sinks };
    }

    private matchesRule(data: LogRaw, match: RouterRule['match']): boolean {
        if (match.source && data.source !== match.source) {
            return false;
        }
        
        if (match.level && data.level !== match.level) {
            return false;
        }
        
        if (match.contains && !data.msg.toLowerCase().includes(match.contains.toLowerCase())) {
            return false;
        }
        
        return true;
    }

    private shouldSample(level: string, customSamplePct?: number): boolean {
        const samplePct = customSamplePct !== undefined 
            ? customSamplePct 
            : this.config.sampling[level as keyof typeof this.config.sampling] || this.config.sampling.defaultPct;
        
        return Math.random() * 100 < samplePct;
    }

    private async normalizeLog(data: LogRaw, routingDecision: any): Promise<NormalizedLog> {
        // Normalize timestamp
        const ts = this.normalizeTimestamp(data.ts);
        
        // Apply privacy classification
        const classification = this.classifyPrivacy(data);
        
        // Create normalized log
        const normalized: NormalizedLog = {
            ts,
            msg: data.msg,
            level: data.level,
            source: data.source,
            kv: data.kv || {},
            traceId: data.traceId,
            spanId: data.spanId,
            classification,
            tags: ['log', ...Object.keys(routingDecision.addTags)]
        };

        // Add routing tags to kv
        normalized.kv = { ...normalized.kv, ...routingDecision.addTags };

        return normalized;
    }

    private normalizeTimestamp(ts: string): string {
        try {
            // Try to parse the timestamp
            const date = new Date(ts);
            if (isNaN(date.getTime())) {
                // Fallback to current time
                return new Date().toISOString();
            }
            return date.toISOString();
        } catch {
            return new Date().toISOString();
        }
    }

    private classifyPrivacy(data: LogRaw): string {
        // Check privacy rules
        for (const rule of this.privacyRules) {
            if (rule.pattern.test(data.msg) || 
                (data.kv && JSON.stringify(data.kv).match(rule.pattern))) {
                return rule.classification;
            }
        }
        
        // Default classification
        return this.config.privacyDefaultClass;
    }

    private async sendToDataIngest(normalized: NormalizedLog): Promise<void> {
        const dataIngest: DataIngest = {
            source: 'logger',
            topic: 'log',
            payload: {
                ts: normalized.ts,
                level: normalized.level,
                msg: normalized.msg,
                source: normalized.source,
                kv: normalized.kv,
                traceId: normalized.traceId,
                spanId: normalized.spanId
            },
            data: {
                tags: {
                    classification: normalized.classification,
                    subjectId: normalized.kv.userId || null,
                    labels: normalized.tags
                }
            },
            audit: {
                producer: 'log.router',
                eventId: this.generateEventId()
            },
            timestamp: normalized.ts
        };

        this.emit('data.ingest', dataIngest);
    }

    private async sendToSink(normalized: NormalizedLog, sink: string): Promise<void> {
        try {
            const line = this.formatForSink(normalized, sink);
            
            if (!this.sinkBatches.has(sink)) {
                this.sinkBatches.set(sink, []);
            }
            
            const batch = this.sinkBatches.get(sink)!;
            batch.push(line);
            
            this.stats.bySink[sink] = (this.stats.bySink[sink] || 0) + 1;

            // Check if batch is ready to flush
            if (batch.length >= this.config.maxBatch) {
                await this.flushSinkBatch(sink);
            } else if (!this.batchTimers.has(sink)) {
                // Set timer for batch flush
                const timer = setTimeout(() => {
                    this.flushSinkBatch(sink);
                }, this.config.maxWaitMs);
                this.batchTimers.set(sink, timer);
            }

        } catch (error) {
            this.logger.error(`LogIngestRouter sink ${sink} error:`, error);
        }
    }

    private formatForSink(normalized: NormalizedLog, sink: string): string {
        switch (sink) {
            case 'file':
            case 's3':
            default:
                // JSON Lines format
                return JSON.stringify({
                    '@timestamp': normalized.ts,
                    level: normalized.level,
                    message: normalized.msg,
                    source: normalized.source,
                    fields: normalized.kv,
                    trace_id: normalized.traceId,
                    span_id: normalized.spanId,
                    classification: normalized.classification,
                    tags: normalized.tags
                });
                
            case 'click':
                // ClickHouse line protocol format
                return `log,source=${normalized.source},level=${normalized.level} ` +
                       `message="${normalized.msg.replace(/"/g, '\\"')}",` +
                       `classification="${normalized.classification}" ` +
                       `${new Date(normalized.ts).getTime()}000000`;
        }
    }

    private async flushSinkBatch(sink: string): Promise<void> {
        const batch = this.sinkBatches.get(sink);
        if (!batch || batch.length === 0) return;

        try {
            // Clear timer
            const timer = this.batchTimers.get(sink);
            if (timer) {
                clearTimeout(timer);
                this.batchTimers.delete(sink);
            }

            // Create batch event
            const sinkBatch: LogSinkBatch = {
                sink,
                lines: [...batch],
                codec: sink === 'click' ? 'lp' : 'jsonl',
                timestamp: new Date().toISOString()
            };

            // Clear the batch
            this.sinkBatches.set(sink, []);

            // Emit batch event
            this.emit('log.sink.batch', sinkBatch);

            // For file sink, also write directly
            if (sink === 'file' && this.config.sinks.file) {
                await this.writeToFile(sinkBatch);
            }

        } catch (error) {
            this.logger.error(`LogIngestRouter flush ${sink} error:`, error);
        }
    }

    private async writeToFile(batch: LogSinkBatch): Promise<void> {
        if (!this.config.sinks.file) return;

        try {
            const filename = this.formatPath(this.config.sinks.file.path);
            const content = batch.lines.join('\n') + '\n';
            
            await fs.promises.appendFile(filename, content, 'utf8');

        } catch (error) {
            this.logger.error('LogIngestRouter file write error:', error);
        }
    }

    private formatPath(pathTemplate: string): string {
        const now = new Date();
        return pathTemplate
            .replace('%Y', now.getFullYear().toString())
            .replace('%m', (now.getMonth() + 1).toString().padStart(2, '0'))
            .replace('%d', now.getDate().toString().padStart(2, '0'));
    }

    private async ensureLogDirectories(): Promise<void> {
        if (this.config.sinks.file) {
            const filename = this.formatPath(this.config.sinks.file.path);
            const dir = path.dirname(filename);
            
            try {
                await fs.promises.mkdir(dir, { recursive: true });
            } catch (error) {
                this.logger.warn('LogIngestRouter could not create log directory:', error);
            }
        }
    }

    private initializeSinks(): void {
        // Initialize default sinks
        const sinks = ['file', 's3', 'click'];
        for (const sink of sinks) {
            this.sinkBatches.set(sink, []);
        }
    }

    private async handleBackpressure(): Promise<void> {
        const now = Date.now();
        
        // Rate limit backpressure alerts
        if (now - this.lastBackpressureAlert < 30000) {
            return;
        }

        this.lastBackpressureAlert = now;

        // Increase sampling rates to reduce load
        this.config.sampling.debugPct = Math.max(0.1, this.config.sampling.debugPct * 0.5);
        this.config.sampling.infoPct = Math.max(1, this.config.sampling.infoPct * 0.7);

        // Emit alert
        const alert: LogRouterAlert = {
            level: 'warn',
            message: `LogIngestRouter backpressure: ${this.inFlightCount} in-flight logs`,
            context: {
                inFlight: this.inFlightCount,
                threshold: this.config.backpressureThreshold,
                newSampling: this.config.sampling
            },
            timestamp: new Date().toISOString()
        };

        this.emit('log.router.alert', alert);
    }

    private generateEventId(): string {
        return `log-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }

    private emitMetrics(): void {
        const metrics: LogRouterMetrics = {
            in: this.stats.in,
            out: this.stats.out,
            dropped: this.stats.dropped,
            sampled: this.stats.sampled,
            byLevel: { ...this.stats.byLevel },
            bySink: { ...this.stats.bySink },
            windowSec: 60
        };

        this.emit('log.router.metrics', metrics);

        // Reset stats
        this.stats = {
            in: 0,
            out: 0,
            dropped: 0,
            sampled: 0,
            byLevel: {},
            bySink: {},
            windowStart: Date.now()
        };
    }

    /**
     * Get module status
     */
    getStatus(): any {
        return {
            name: 'LogIngestRouter',
            initialized: this.isInitialized,
            inFlight: this.inFlightCount,
            routingRules: this.routingRules.length,
            privacyRules: this.privacyRules.length,
            activeBatches: Array.from(this.sinkBatches.entries()).map(([sink, batch]) => ({
                sink,
                pending: batch.length
            })),
            stats: this.stats
        };
    }

    async shutdown(): Promise<void> {
        try {
            this.logger.info('LogIngestRouter shutting down...');
            
            // Flush all pending batches
            const flushPromises = Array.from(this.sinkBatches.keys()).map(sink => 
                this.flushSinkBatch(sink)
            );
            await Promise.all(flushPromises);
            
            // Clear timers
            for (const timer of this.batchTimers.values()) {
                clearTimeout(timer);
            }
            this.batchTimers.clear();
            
            this.removeAllListeners();
            this.sinkBatches.clear();
            this.isInitialized = false;
            this.logger.info('LogIngestRouter shutdown complete');
        } catch (error) {
            this.logger.error('LogIngestRouter shutdown error:', error);
        }
    }
}

export default LogIngestRouter;
