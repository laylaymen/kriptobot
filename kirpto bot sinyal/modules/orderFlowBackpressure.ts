/**
 * Order Flow Backpressure - SG-05
 * Advanced order traffic pacing and backpressure management system
 * Coordinates rate limits, guard modes, and portfolio directives for intelligent flow control
 */

import { EventEmitter } from 'events';

interface ExchangeRateLimit {
    limit: number;
    used: number;
    resetMs: number;
    endpoint?: string;
}

interface ComposerIntent {
    correlationId: string;
    symbol: string;
    mode: 'market' | 'limit' | 'post_only';
    priority?: number;
    ttlSec?: number;
}

interface ComposerIntentBatch {
    batchId: string;
    intents: ComposerIntent[];
    ttlSec: number;
    timestamp: string;
}

interface LatencySlipGuardDirective {
    mode: string;
    reasonCodes: string[];
    source: string;
}

interface SentryGuardDirective {
    mode: string;
    reasonCodes: string[];
    source: string;
}

interface PortfolioBalanceDirective {
    actions: Array<{
        type: string;
        scope?: string;
        symbol?: string;
    }>;
    reasonCodes: string[];
}

interface OrderFlowPacingPlan {
    slices: number;
    sliceDelayMs: number;
    maxInFlight: number;
    reasonCodes: string[];
    batchId: string;
    effectiveUntil: string;
}

interface FilteredIntentResult {
    correlationId: string;
    status: 'accepted' | 'deferred' | 'dropped';
    reason?: string;
}

interface ComposerIntentFiltered {
    batchId: string;
    accepted: ComposerIntent[];
    deferred: ComposerIntent[];
    dropped: ComposerIntent[];
    reasonCodesById: Record<string, string[]>;
    timestamp: string;
}

interface OrderFlowBackpressureMetrics {
    inFlight: number;
    queueDepth: number;
    deferRate: number;
    dropRate: number;
    windowSec: number;
    rateLimitUtilization: number;
}

interface Config {
    maxInFlight: number;
    queueMax: number;
    burstPerSec: number;
    slowdownFactors: Record<string, number>;
    deferTtlSec: number;
    dropOnHalt: boolean;
    rateLimitBuffer: number;
    windowSec: number;
    tz: string;
}

class OrderFlowBackpressure extends EventEmitter {
    private config: Config;
    private logger: any;
    private isInitialized: boolean = false;
    
    // State tracking
    private currentInFlight: number = 0;
    private queue: Array<{
        intent: ComposerIntent;
        deferredAt: number;
        batchId: string;
    }> = [];
    
    // Guard mode tracking
    private sentryMode: string = 'normal';
    private guardMode: string = 'normal';
    private portfolioDeferred: Set<string> = new Set(); // deferred symbols
    
    // Rate limit tracking
    private currentRateLimit: ExchangeRateLimit | null = null;
    private rateLimitHistory: Array<{
        timestamp: number;
        used: number;
        limit: number;
    }> = [];
    
    // Statistics
    private stats: {
        processed: number;
        accepted: number;
        deferred: number;
        dropped: number;
        windowStart: number;
    } = {
        processed: 0,
        accepted: 0,
        deferred: 0,
        dropped: 0,
        windowStart: Date.now()
    };
    
    // Pacing state
    private lastPacingPlan: OrderFlowPacingPlan | null = null;
    private recentBatches: Map<string, ComposerIntentFiltered> = new Map();

    constructor(config: Partial<Config> = {}) {
        super();
        this.config = {
            maxInFlight: 8,
            queueMax: 200,
            burstPerSec: 5,
            slowdownFactors: {
                normal: 1.0,
                degraded: 0.7,
                slowdown: 0.5,
                block_aggressive: 0.0,
                halt_entry: 0.0,
                streams_panic: 0.0
            },
            deferTtlSec: 120,
            dropOnHalt: true,
            rateLimitBuffer: 0.1, // Keep 10% buffer
            windowSec: 60,
            tz: "Europe/Istanbul",
            ...config
        };

        // Periodically clean expired deferred items
        setInterval(() => {
            this.cleanExpiredDeferred();
        }, 30000);

        // Reset stats window
        setInterval(() => {
            this.rotateStatsWindow();
        }, this.config.windowSec * 1000);
    }

    async initialize(logger: any): Promise<boolean> {
        try {
            this.logger = logger;
            this.logger.info('OrderFlowBackpressure initializing...');
            
            this.isInitialized = true;
            this.logger.info('OrderFlowBackpressure initialized successfully');
            return true;
        } catch (error) {
            this.logger.error('OrderFlowBackpressure initialization error:', error);
            return false;
        }
    }

    /**
     * Process exchange rate limit snapshot
     */
    async processRateLimit(data: ExchangeRateLimit): Promise<void> {
        if (!this.isInitialized) return;

        try {
            this.currentRateLimit = data;
            
            // Track rate limit history
            this.rateLimitHistory.push({
                timestamp: Date.now(),
                used: data.used,
                limit: data.limit
            });

            // Keep only recent history
            const cutoff = Date.now() - (this.config.windowSec * 1000);
            this.rateLimitHistory = this.rateLimitHistory.filter(entry => 
                entry.timestamp > cutoff
            );

        } catch (error) {
            this.logger.error('OrderFlowBackpressure rate limit processing error:', error);
        }
    }

    /**
     * Process composer intent batch
     */
    async processIntentBatch(data: ComposerIntentBatch): Promise<ComposerIntentFiltered> {
        if (!this.isInitialized) {
            throw new Error('OrderFlowBackpressure not initialized');
        }

        try {
            // Check for duplicate batch
            if (this.recentBatches.has(data.batchId)) {
                return this.recentBatches.get(data.batchId)!;
            }

            // Generate pacing plan
            const pacingPlan = this.generatePacingPlan(data);

            // Filter intents based on current conditions
            const filtered = await this.filterIntents(data);

            // Store result for idempotency
            this.recentBatches.set(data.batchId, filtered);
            if (this.recentBatches.size > 100) {
                const oldestKey = this.recentBatches.keys().next().value;
                this.recentBatches.delete(oldestKey);
            }

            // Emit events
            this.emit('orderflow.pacing.plan', pacingPlan);
            this.emit('composer.intent.filtered', filtered);

            // Update statistics
            this.updateStats(filtered);

            this.logger.info(`OrderFlowBackpressure processed batch ${data.batchId}: ${filtered.accepted.length}A/${filtered.deferred.length}D/${filtered.dropped.length}Dr`);
            
            return filtered;

        } catch (error) {
            this.logger.error('OrderFlowBackpressure intent batch processing error:', error);
            throw error;
        }
    }

    /**
     * Process latency slip guard directive
     */
    async processLatencySlipDirective(data: LatencySlipGuardDirective): Promise<void> {
        if (!this.isInitialized) return;

        try {
            this.guardMode = data.mode;
            
            // Log mode change
            this.logger.info(`OrderFlowBackpressure guard mode: ${data.mode}`, {
                reasonCodes: data.reasonCodes
            });

        } catch (error) {
            this.logger.error('OrderFlowBackpressure guard directive processing error:', error);
        }
    }

    /**
     * Process sentry guard directive
     */
    async processSentryDirective(data: SentryGuardDirective): Promise<void> {
        if (!this.isInitialized) return;

        try {
            this.sentryMode = data.mode;
            
            // Log mode change
            this.logger.info(`OrderFlowBackpressure sentry mode: ${data.mode}`, {
                reasonCodes: data.reasonCodes
            });

        } catch (error) {
            this.logger.error('OrderFlowBackpressure sentry directive processing error:', error);
        }
    }

    /**
     * Process portfolio balance directive
     */
    async processPortfolioDirective(data: PortfolioBalanceDirective): Promise<void> {
        if (!this.isInitialized) return;

        try {
            // Update deferred symbols based on defer_new actions
            for (const action of data.actions) {
                if (action.type === 'defer_new') {
                    if (action.scope === 'symbol' && action.symbol) {
                        this.portfolioDeferred.add(action.symbol);
                    } else if (action.scope === 'cluster') {
                        // For cluster deferrals, we would need symbol-to-cluster mapping
                        // For now, just log it
                        this.logger.info(`Cluster defer_new: ${action.symbol || 'all'}`);
                    }
                }
            }

            this.logger.info(`OrderFlowBackpressure portfolio directive: ${this.portfolioDeferred.size} symbols deferred`);

        } catch (error) {
            this.logger.error('OrderFlowBackpressure portfolio directive processing error:', error);
        }
    }

    private generatePacingPlan(batch: ComposerIntentBatch): OrderFlowPacingPlan {
        const reasonCodes: string[] = [];
        
        // Determine effective mode (most restrictive wins)
        const effectiveMode = this.getEffectiveMode();
        const slowdownFactor = this.config.slowdownFactors[effectiveMode] || 1.0;
        
        // Calculate base pacing parameters
        let slices = Math.max(1, Math.ceil(batch.intents.length * slowdownFactor));
        let sliceDelayMs = this.calculateSliceDelay(batch.intents.length, slowdownFactor);
        let maxInFlight = Math.floor(this.config.maxInFlight * slowdownFactor);

        // Rate limit adjustment
        if (this.currentRateLimit) {
            const utilization = this.currentRateLimit.used / this.currentRateLimit.limit;
            const available = this.currentRateLimit.limit - this.currentRateLimit.used;
            const buffer = this.currentRateLimit.limit * this.config.rateLimitBuffer;
            
            if (available < buffer) {
                slices = Math.max(slices, Math.ceil(batch.intents.length / Math.max(1, available - buffer)));
                sliceDelayMs = Math.max(sliceDelayMs, 1000); // Minimum 1s delay when near limit
                reasonCodes.push('RATE_LIMIT_PRESSURE');
            }
        }

        // Mode-specific adjustments
        if (effectiveMode !== 'normal') {
            reasonCodes.push(`MODE_${effectiveMode.toUpperCase()}`);
        }

        if (this.currentInFlight >= this.config.maxInFlight * 0.8) {
            reasonCodes.push('HIGH_IN_FLIGHT');
        }

        if (this.queue.length >= this.config.queueMax * 0.8) {
            reasonCodes.push('HIGH_QUEUE_DEPTH');
        }

        const plan: OrderFlowPacingPlan = {
            slices,
            sliceDelayMs,
            maxInFlight,
            reasonCodes,
            batchId: batch.batchId,
            effectiveUntil: new Date(Date.now() + 300000).toISOString() // 5 minutes
        };

        this.lastPacingPlan = plan;
        return plan;
    }

    private async filterIntents(batch: ComposerIntentBatch): Promise<ComposerIntentFiltered> {
        const accepted: ComposerIntent[] = [];
        const deferred: ComposerIntent[] = [];
        const dropped: ComposerIntent[] = [];
        const reasonCodesById: Record<string, string[]> = {};

        const effectiveMode = this.getEffectiveMode();
        const shouldDropAll = this.config.dropOnHalt && 
                             (effectiveMode === 'halt_entry' || effectiveMode === 'streams_panic');

        for (const intent of batch.intents) {
            const reasons: string[] = [];
            let status: 'accepted' | 'deferred' | 'dropped' = 'accepted';

            // Check for portfolio-level deferral
            if (this.portfolioDeferred.has(intent.symbol)) {
                status = 'deferred';
                reasons.push('PORTFOLIO_DEFER_NEW');
            }
            
            // Check mode-based dropping
            else if (shouldDropAll) {
                status = 'dropped';
                reasons.push(`MODE_${effectiveMode.toUpperCase()}_DROP`);
            }
            
            // Check aggressive blocking
            else if (effectiveMode === 'block_aggressive' && intent.mode === 'market') {
                status = 'dropped';
                reasons.push('BLOCK_AGGRESSIVE_MARKET');
            }
            
            // Check queue capacity
            else if (this.queue.length >= this.config.queueMax) {
                status = 'dropped';
                reasons.push('QUEUE_FULL');
            }
            
            // Check in-flight capacity
            else if (this.currentInFlight >= this.config.maxInFlight) {
                status = 'deferred';
                reasons.push('MAX_IN_FLIGHT');
            }
            
            // Check rate limit pressure
            else if (this.currentRateLimit) {
                const available = this.currentRateLimit.limit - this.currentRateLimit.used;
                const buffer = this.currentRateLimit.limit * this.config.rateLimitBuffer;
                
                if (available <= buffer) {
                    status = 'deferred';
                    reasons.push('RATE_LIMIT_NEAR');
                }
            }

            // Route the intent
            if (status === 'accepted') {
                accepted.push(intent);
                this.currentInFlight++;
            } else if (status === 'deferred') {
                deferred.push(intent);
                this.queue.push({
                    intent,
                    deferredAt: Date.now(),
                    batchId: batch.batchId
                });
            } else {
                dropped.push(intent);
            }

            if (reasons.length > 0) {
                reasonCodesById[intent.correlationId] = reasons;
            }
        }

        return {
            batchId: batch.batchId,
            accepted,
            deferred,
            dropped,
            reasonCodesById,
            timestamp: new Date().toISOString()
        };
    }

    private getEffectiveMode(): string {
        // Most restrictive mode wins
        const modes = [this.sentryMode, this.guardMode];
        const priority = ['halt_entry', 'streams_panic', 'block_aggressive', 'slowdown', 'degraded', 'normal'];
        
        for (const mode of priority) {
            if (modes.includes(mode)) {
                return mode;
            }
        }
        
        return 'normal';
    }

    private calculateSliceDelay(intentCount: number, slowdownFactor: number): number {
        // Base delay calculation
        const baseDelayMs = Math.max(200, 1000 / this.config.burstPerSec);
        
        // Adjust for slowdown
        const adjustedDelay = baseDelayMs / slowdownFactor;
        
        // Additional delay for larger batches
        const batchPenalty = Math.log(intentCount + 1) * 100;
        
        return Math.round(adjustedDelay + batchPenalty);
    }

    private cleanExpiredDeferred(): void {
        const now = Date.now();
        const ttlMs = this.config.deferTtlSec * 1000;
        
        const beforeCount = this.queue.length;
        this.queue = this.queue.filter(item => {
            const age = now - item.deferredAt;
            return age < ttlMs;
        });
        
        const expired = beforeCount - this.queue.length;
        if (expired > 0) {
            this.stats.dropped += expired;
            this.logger.debug(`OrderFlowBackpressure cleaned ${expired} expired deferred intents`);
        }
    }

    private updateStats(filtered: ComposerIntentFiltered): void {
        this.stats.processed += filtered.accepted.length + filtered.deferred.length + filtered.dropped.length;
        this.stats.accepted += filtered.accepted.length;
        this.stats.deferred += filtered.deferred.length;
        this.stats.dropped += filtered.dropped.length;
    }

    private rotateStatsWindow(): void {
        const metrics = this.generateMetrics();
        this.emit('orderflow.backpressure.metrics', metrics);
        
        // Reset stats
        this.stats = {
            processed: 0,
            accepted: 0,
            deferred: 0,
            dropped: 0,
            windowStart: Date.now()
        };
    }

    private generateMetrics(): OrderFlowBackpressureMetrics {
        const windowSec = (Date.now() - this.stats.windowStart) / 1000;
        const total = this.stats.processed || 1; // Avoid division by zero
        
        let rateLimitUtilization = 0;
        if (this.currentRateLimit) {
            rateLimitUtilization = this.currentRateLimit.used / this.currentRateLimit.limit;
        }

        return {
            inFlight: this.currentInFlight,
            queueDepth: this.queue.length,
            deferRate: this.stats.deferred / total,
            dropRate: this.stats.dropped / total,
            windowSec: this.config.windowSec,
            rateLimitUtilization
        };
    }

    /**
     * Manually release in-flight slots (called when orders complete)
     */
    releaseInFlight(count: number = 1): void {
        this.currentInFlight = Math.max(0, this.currentInFlight - count);
    }

    /**
     * Get current queue status
     */
    getQueueStatus(): any {
        return {
            depth: this.queue.length,
            oldestAge: this.queue.length > 0 ? 
                      (Date.now() - this.queue[0].deferredAt) / 1000 : 0,
            bySymbol: this.queue.reduce((acc, item) => {
                acc[item.intent.symbol] = (acc[item.intent.symbol] || 0) + 1;
                return acc;
            }, {} as Record<string, number>)
        };
    }

    /**
     * Get current metrics
     */
    getCurrentMetrics(): OrderFlowBackpressureMetrics {
        return this.generateMetrics();
    }

    /**
     * Get module status
     */
    getStatus(): any {
        return {
            name: 'OrderFlowBackpressure',
            initialized: this.isInitialized,
            effectiveMode: this.getEffectiveMode(),
            sentryMode: this.sentryMode,
            guardMode: this.guardMode,
            inFlight: this.currentInFlight,
            queueDepth: this.queue.length,
            portfolioDeferred: this.portfolioDeferred.size,
            rateLimitUtilization: this.currentRateLimit ? 
                this.currentRateLimit.used / this.currentRateLimit.limit : 0
        };
    }

    async shutdown(): Promise<void> {
        try {
            this.logger.info('OrderFlowBackpressure shutting down...');
            this.removeAllListeners();
            this.queue.length = 0;
            this.portfolioDeferred.clear();
            this.recentBatches.clear();
            this.rateLimitHistory.length = 0;
            this.isInitialized = false;
            this.logger.info('OrderFlowBackpressure shutdown complete');
        } catch (error) {
            this.logger.error('OrderFlowBackpressure shutdown error:', error);
        }
    }
}

export default OrderFlowBackpressure;
