/**
 * Stream Integrity Verifier - SG-03
 * Advanced market and order stream integrity verification system
 * Detects duplicates, out-of-order events, stale data, and timestamp skew
 */

import { EventEmitter } from 'events';

interface MarketRefTick {
    sequence: number;
    ts: string;
    symbol: string;
    data: any;
    source: 'market.refs' | 'trade.tick';
}

interface OrderStreamEvent {
    sequence: number;
    ts: string;
    orderId: string;
    eventType: string;
    data: any;
}

interface ClockSyncInfo {
    localSkewMs: number;
    source: 'ntp' | 'exchange';
    lastSync: string;
    confidence: number;
}

interface SentryGuardDirective {
    mode: string;
    reasonCodes: string[];
    source: string;
}

interface StreamIntegrityAlert {
    level: 'info' | 'warn' | 'error';
    type: 'dup' | 'oOO' | 'stale' | 'ts_skew';
    count: number;
    windowSec: number;
    reason: string[];
    symbol?: string;
    topic?: string;
    timestamp: string;
}

interface StreamFilterStats {
    droppedDup: number;
    fixedReorder: number;
    staleSuppressed: number;
    tsSkewAdjusted: number;
    windowSec: number;
}

interface Config {
    reorderFixWindowMs: number;
    staleMaxLagMs: number;
    dupBloomSize: number;
    skewWarnMs: number;
    degradedOnErrorRate: number;
    windowSec: number;
    tz: string;
}

class StreamIntegrityVerifier extends EventEmitter {
    private config: Config;
    private logger: any;
    private isInitialized: boolean = false;
    
    // Sequence tracking per topic/symbol
    private sequenceTrackers: Map<string, {
        expectedSeq: number;
        reorderBuffer: Map<number, any>;
        reorderTimeout: NodeJS.Timeout | null;
    }> = new Map();
    
    // Duplicate detection (simplified bloom filter simulation)
    private duplicateFilter: Set<string> = new Set();
    
    // Statistics tracking
    private stats: StreamFilterStats = {
        droppedDup: 0,
        fixedReorder: 0,
        staleSuppressed: 0,
        tsSkewAdjusted: 0,
        windowSec: 60
    };
    
    // Integrity violation tracking
    private violationHistory: Array<{
        type: string;
        timestamp: number;
        details: any;
    }> = [];
    
    // Clock sync tracking
    private clockSkew: number = 0;
    private lastClockSync: Date = new Date();
    
    // Alert rate limiting
    private lastAlerts: Map<string, number> = new Map();

    constructor(config: Partial<Config> = {}) {
        super();
        this.config = {
            reorderFixWindowMs: 150,
            staleMaxLagMs: 2000,
            dupBloomSize: 1_000_000,
            skewWarnMs: 1000,
            degradedOnErrorRate: 0.02,
            windowSec: 60,
            tz: "Europe/Istanbul",
            ...config
        };
    }

    async initialize(logger: any): Promise<boolean> {
        try {
            this.logger = logger;
            this.logger.info('StreamIntegrityVerifier initializing...');
            
            // Reset stats window periodically
            setInterval(() => {
                this.rotateStatsWindow();
            }, this.config.windowSec * 1000);
            
            this.isInitialized = true;
            this.logger.info('StreamIntegrityVerifier initialized successfully');
            return true;
        } catch (error) {
            this.logger.error('StreamIntegrityVerifier initialization error:', error);
            return false;
        }
    }

    /**
     * Process market reference tick
     */
    async processMarketTick(data: MarketRefTick): Promise<boolean> {
        if (!this.isInitialized) return true;

        try {
            const key = `${data.source}:${data.symbol}`;
            const eventId = this.generateEventId(data);
            
            // Check for duplicates
            if (this.isDuplicate(eventId)) {
                this.stats.droppedDup++;
                this.recordViolation('dup', { key, sequence: data.sequence });
                return false; // Drop duplicate
            }

            // Check for staleness
            if (this.isStale(data.ts)) {
                this.stats.staleSuppressed++;
                this.recordViolation('stale', { key, ts: data.ts, lag: this.calculateLag(data.ts) });
                return false; // Drop stale data
            }

            // Check sequence order
            const orderResult = await this.checkSequenceOrder(key, data);
            if (orderResult.action === 'drop') {
                return false;
            } else if (orderResult.action === 'buffer') {
                return false; // Will be processed later
            }

            // Add to duplicate filter
            this.addToDuplicateFilter(eventId);

            // Check for integrity violations
            await this.checkIntegrityViolations();

            return true; // Event is valid

        } catch (error) {
            this.logger.error('StreamIntegrityVerifier market tick processing error:', error);
            return true; // Don't drop on errors
        }
    }

    /**
     * Process order stream event
     */
    async processOrderStreamEvent(data: OrderStreamEvent): Promise<boolean> {
        if (!this.isInitialized) return true;

        try {
            const key = `order:${data.orderId}`;
            const eventId = this.generateEventId(data);
            
            // Check for duplicates
            if (this.isDuplicate(eventId)) {
                this.stats.droppedDup++;
                this.recordViolation('dup', { key, sequence: data.sequence });
                return false;
            }

            // Check for staleness
            if (this.isStale(data.ts)) {
                this.stats.staleSuppressed++;
                this.recordViolation('stale', { key, ts: data.ts });
                return false;
            }

            // Check sequence order
            const orderResult = await this.checkSequenceOrder(key, data);
            if (orderResult.action === 'drop') {
                return false;
            } else if (orderResult.action === 'buffer') {
                return false;
            }

            // Add to duplicate filter
            this.addToDuplicateFilter(eventId);

            return true;

        } catch (error) {
            this.logger.error('StreamIntegrityVerifier order event processing error:', error);
            return true;
        }
    }

    /**
     * Process clock sync information
     */
    async processClockSync(data: ClockSyncInfo): Promise<void> {
        if (!this.isInitialized) return;

        try {
            this.clockSkew = data.localSkewMs;
            this.lastClockSync = new Date();

            // Check for significant clock skew
            if (Math.abs(data.localSkewMs) > this.config.skewWarnMs) {
                await this.emitAlert({
                    level: 'warn',
                    type: 'ts_skew',
                    count: 1,
                    windowSec: this.config.windowSec,
                    reason: [`Clock skew detected: ${data.localSkewMs}ms from ${data.source}`],
                    timestamp: new Date().toISOString()
                });
            }

        } catch (error) {
            this.logger.error('StreamIntegrityVerifier clock sync processing error:', error);
        }
    }

    /**
     * Process sentry guard directive for coordination
     */
    async processSentryDirective(data: SentryGuardDirective): Promise<void> {
        if (!this.isInitialized) return;

        try {
            // If sentry is in panic/degraded mode, be more lenient with violations
            // to avoid cascading failures
            if (data.mode === 'streams_panic' || data.mode === 'degraded') {
                // Temporarily reduce sensitivity
            }

        } catch (error) {
            this.logger.error('StreamIntegrityVerifier sentry directive processing error:', error);
        }
    }

    private generateEventId(event: any): string {
        // Create a unique identifier for the event
        const key = `${event.sequence || 0}_${event.ts}_${event.symbol || event.orderId || 'unknown'}`;
        return require('crypto').createHash('md5').update(key).digest('hex');
    }

    private isDuplicate(eventId: string): boolean {
        if (this.duplicateFilter.has(eventId)) {
            return true;
        }
        return false;
    }

    private addToDuplicateFilter(eventId: string): void {
        this.duplicateFilter.add(eventId);
        
        // Simple cleanup when filter gets too large
        if (this.duplicateFilter.size > this.config.dupBloomSize) {
            // Remove oldest entries (simplified - in reality would use proper bloom filter)
            const entries = Array.from(this.duplicateFilter);
            this.duplicateFilter.clear();
            for (let i = entries.length - this.config.dupBloomSize / 2; i < entries.length; i++) {
                this.duplicateFilter.add(entries[i]);
            }
        }
    }

    private isStale(timestamp: string): boolean {
        const eventTime = new Date(timestamp).getTime();
        const now = Date.now();
        const lag = now - eventTime;
        
        return lag > this.config.staleMaxLagMs;
    }

    private calculateLag(timestamp: string): number {
        const eventTime = new Date(timestamp).getTime();
        const now = Date.now();
        return now - eventTime;
    }

    private async checkSequenceOrder(key: string, event: any): Promise<{ action: 'process' | 'buffer' | 'drop' }> {
        if (!event.sequence) {
            return { action: 'process' }; // No sequence tracking
        }

        let tracker = this.sequenceTrackers.get(key);
        if (!tracker) {
            tracker = {
                expectedSeq: event.sequence + 1,
                reorderBuffer: new Map(),
                reorderTimeout: null
            };
            this.sequenceTrackers.set(key, tracker);
            return { action: 'process' };
        }

        const sequence = event.sequence;
        const expected = tracker.expectedSeq;

        if (sequence === expected) {
            // Perfect order
            tracker.expectedSeq = sequence + 1;
            
            // Check if buffered events can now be processed
            await this.processBufferedEvents(key, tracker);
            
            return { action: 'process' };
        } else if (sequence < expected) {
            // Late arrival - might be duplicate or very delayed
            if (sequence < expected - 10) {
                // Too old, likely duplicate
                this.recordViolation('oOO', { key, sequence, expected, action: 'drop' });
                return { action: 'drop' };
            } else {
                // Recent, might still be useful
                this.stats.fixedReorder++;
                this.recordViolation('oOO', { key, sequence, expected, action: 'process_late' });
                return { action: 'process' };
            }
        } else {
            // Future event - buffer for reordering
            if (sequence - expected <= 5) {
                // Reasonable gap, buffer it
                tracker.reorderBuffer.set(sequence, event);
                
                // Set timeout to flush buffer
                if (!tracker.reorderTimeout) {
                    tracker.reorderTimeout = setTimeout(() => {
                        this.flushReorderBuffer(key);
                    }, this.config.reorderFixWindowMs);
                }
                
                this.recordViolation('oOO', { key, sequence, expected, action: 'buffer' });
                return { action: 'buffer' };
            } else {
                // Gap too large, probably lost messages
                this.recordViolation('oOO', { key, sequence, expected, action: 'gap_too_large' });
                tracker.expectedSeq = sequence + 1;
                return { action: 'process' };
            }
        }
    }

    private async processBufferedEvents(key: string, tracker: any): Promise<void> {
        let processed = 0;
        
        while (tracker.reorderBuffer.has(tracker.expectedSeq)) {
            const event = tracker.reorderBuffer.get(tracker.expectedSeq);
            tracker.reorderBuffer.delete(tracker.expectedSeq);
            tracker.expectedSeq++;
            processed++;
            
            // Re-emit the buffered event for processing
            if (event.symbol) {
                this.emit('market.refs.reordered', event);
            } else {
                this.emit('order.stream.reordered', event);
            }
        }
        
        if (processed > 0) {
            this.stats.fixedReorder += processed;
        }
    }

    private flushReorderBuffer(key: string): void {
        const tracker = this.sequenceTrackers.get(key);
        if (!tracker) return;

        // Process all buffered events regardless of order
        for (const [sequence, event] of tracker.reorderBuffer.entries()) {
            if (event.symbol) {
                this.emit('market.refs.reordered', event);
            } else {
                this.emit('order.stream.reordered', event);
            }
        }

        tracker.reorderBuffer.clear();
        tracker.reorderTimeout = null;
    }

    private recordViolation(type: string, details: any): void {
        this.violationHistory.push({
            type,
            timestamp: Date.now(),
            details
        });

        // Keep only recent violations
        const cutoff = Date.now() - (this.config.windowSec * 1000);
        this.violationHistory = this.violationHistory.filter(v => v.timestamp > cutoff);
    }

    private async checkIntegrityViolations(): Promise<void> {
        const now = Date.now();
        const windowMs = this.config.windowSec * 1000;
        const recentViolations = this.violationHistory.filter(v => 
            now - v.timestamp < windowMs
        );

        if (recentViolations.length === 0) return;

        // Calculate violation rate
        const totalEvents = recentViolations.length + 1000; // Estimate total events
        const violationRate = recentViolations.length / totalEvents;

        if (violationRate >= this.config.degradedOnErrorRate) {
            // Emit high violation rate alert
            await this.emitAlert({
                level: 'error',
                type: 'oOO', // Most common type
                count: recentViolations.length,
                windowSec: this.config.windowSec,
                reason: [
                    `High violation rate: ${(violationRate * 100).toFixed(2)}%`,
                    `Violations: ${recentViolations.length} in ${this.config.windowSec}s`
                ],
                timestamp: new Date().toISOString()
            });

            // Suggest degraded mode to sentry
            this.emit('sentry.guard.directive', {
                mode: 'degraded',
                reasonCodes: ['HIGH_STREAM_INTEGRITY_VIOLATIONS'],
                source: 'stream_integrity_verifier',
                expiresAt: new Date(now + 180000).toISOString() // 3 minutes
            });
        }
    }

    private async emitAlert(alert: StreamIntegrityAlert): Promise<void> {
        const alertKey = `${alert.type}_${alert.level}`;
        const now = Date.now();
        const lastAlert = this.lastAlerts.get(alertKey) || 0;

        // Rate limit alerts (max 1 per minute per type/level)
        if (now - lastAlert < 60000) {
            return;
        }

        this.lastAlerts.set(alertKey, now);
        this.emit('stream.integrity.alert', alert);
    }

    private rotateStatsWindow(): void {
        // Reset stats for new window
        this.stats = {
            droppedDup: 0,
            fixedReorder: 0,
            staleSuppressed: 0,
            tsSkewAdjusted: 0,
            windowSec: this.config.windowSec
        };

        // Emit current stats before reset
        this.emit('stream.filter.stats', { ...this.stats });
    }

    /**
     * Get current filter statistics
     */
    getFilterStats(): StreamFilterStats {
        return { ...this.stats };
    }

    /**
     * Get violation summary
     */
    getViolationSummary(): any {
        const now = Date.now();
        const windowMs = this.config.windowSec * 1000;
        const recentViolations = this.violationHistory.filter(v => 
            now - v.timestamp < windowMs
        );

        const summary: Record<string, number> = {};
        for (const violation of recentViolations) {
            summary[violation.type] = (summary[violation.type] || 0) + 1;
        }

        return {
            totalViolations: recentViolations.length,
            byType: summary,
            windowSec: this.config.windowSec,
            violationRate: recentViolations.length / (recentViolations.length + 1000) // Rough estimate
        };
    }

    /**
     * Reset integrity state (for testing)
     */
    resetState(): void {
        this.sequenceTrackers.clear();
        this.duplicateFilter.clear();
        this.violationHistory.length = 0;
        this.stats = {
            droppedDup: 0,
            fixedReorder: 0,
            staleSuppressed: 0,
            tsSkewAdjusted: 0,
            windowSec: this.config.windowSec
        };
        
        this.logger.info('StreamIntegrityVerifier state reset');
    }

    /**
     * Get module status
     */
    getStatus(): any {
        return {
            name: 'StreamIntegrityVerifier',
            initialized: this.isInitialized,
            config: this.config,
            trackedStreams: this.sequenceTrackers.size,
            duplicateFilterSize: this.duplicateFilter.size,
            recentViolations: this.violationHistory.length,
            clockSkew: this.clockSkew,
            lastClockSync: this.lastClockSync.toISOString()
        };
    }

    async shutdown(): Promise<void> {
        try {
            this.logger.info('StreamIntegrityVerifier shutting down...');
            
            // Clear all timeouts
            for (const tracker of this.sequenceTrackers.values()) {
                if (tracker.reorderTimeout) {
                    clearTimeout(tracker.reorderTimeout);
                }
            }
            
            this.removeAllListeners();
            this.sequenceTrackers.clear();
            this.duplicateFilter.clear();
            this.violationHistory.length = 0;
            this.lastAlerts.clear();
            this.isInitialized = false;
            this.logger.info('StreamIntegrityVerifier shutdown complete');
        } catch (error) {
            this.logger.error('StreamIntegrityVerifier shutdown error:', error);
        }
    }
}

export default StreamIntegrityVerifier;
