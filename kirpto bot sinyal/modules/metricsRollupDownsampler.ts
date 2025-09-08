/**
 * Metrics Rollup Downsampler - LT-03
 * Rollup high-volume metrics into 1m/5m/1h intervals for storage efficiency
 * Produces Prometheus/TSDB compatible aggregation sets
 */

import { EventEmitter } from 'events';

interface TelemetryTSDBBatch {
    lines: string[];
    format: 'line_protocol' | 'json';
    timestamp: string;
}

interface TelemetryPromDump {
    metrics: Array<{
        name: string;
        type: 'gauge' | 'counter' | 'histogram' | 'summary';
        value: number;
        labels: Record<string, string>;
        timestamp: number;
    }>;
}

interface RollupRule {
    match: {
        metric: string; // regex pattern
    };
    aggs: Array<'min' | 'max' | 'avg' | 'p50' | 'p95' | 'p99' | 'sum' | 'count'>;
    intervals: Array<'1m' | '5m' | '1h'>;
    ttl: {
        raw: string;
        m1: string;
        h1: string;
    };
}

interface RollupPolicyUpdate {
    rules: RollupRule[];
}

interface TelemetryRollupBatch {
    interval: '1m' | '5m' | '1h';
    lines: string[];
    timestamp: string;
}

interface RollupMetrics {
    rawIn: number;
    m1Out: number;
    m5Out: number;
    h1Out: number;
    droppedByTtl: number;
    windowSec: number;
}

interface RollupAlert {
    level: 'info' | 'warn' | 'error';
    message: string;
    context: any;
    timestamp: string;
}

interface SeriesKey {
    metric: string;
    labels: Record<string, string>;
}

interface DataPoint {
    value: number;
    timestamp: number;
}

interface SeriesBuffer {
    key: SeriesKey;
    points: DataPoint[];
    lastSeen: number;
    rule?: RollupRule;
}

interface WindowState {
    interval: '1m' | '5m' | '1h';
    windowStart: number;
    windowEnd: number;
    intervalMs: number;
    series: Map<string, SeriesBuffer>;
}

interface Config {
    intervals: Array<'1m' | '5m' | '1h'>;
    defaultAggs: Array<'min' | 'max' | 'avg' | 'p95'>;
    maxSeries: number;
    ttl: {
        raw: string;
        '1m': string;
        '1h': string;
    };
    flushIntervalMs: number;
    cardinalityLimit: number;
    tz: string;
}

class MetricsRollupDownsampler extends EventEmitter {
    private config: Config;
    private logger: any;
    private isInitialized: boolean = false;
    
    // Rollup rules
    private rollupRules: RollupRule[] = [];
    private compiledRules: Array<{ pattern: RegExp; rule: RollupRule }> = [];
    
    // Window states for each interval
    private windowStates: Map<string, WindowState> = new Map();
    
    // TTL tracking
    private ttlTimestamps: Map<string, number> = new Map();
    
    // Cardinality tracking
    private seriesCardinality: Set<string> = new Set();
    private lastCardinalityAlert: number = 0;
    
    // Statistics
    private stats: {
        rawIn: number;
        m1Out: number;
        m5Out: number;
        h1Out: number;
        droppedByTtl: number;
        droppedByCardinality: number;
        windowStart: number;
    } = {
        rawIn: 0,
        m1Out: 0,
        m5Out: 0,
        h1Out: 0,
        droppedByTtl: 0,
        droppedByCardinality: 0,
        windowStart: Date.now()
    };

    constructor(config: Partial<Config> = {}) {
        super();
        this.config = {
            intervals: ['1m', '5m', '1h'],
            defaultAggs: ['min', 'max', 'avg', 'p95'],
            maxSeries: 200000,
            ttl: {
                raw: '14d',
                '1m': '90d',
                '1h': '365d'
            },
            flushIntervalMs: 30000, // Flush every 30 seconds
            cardinalityLimit: 100000,
            tz: 'Europe/Istanbul',
            ...config
        };

        this.initializeWindows();

        // Periodic flush of completed windows
        setInterval(() => {
            this.flushCompletedWindows();
        }, this.config.flushIntervalMs);

        // Periodic cleanup
        setInterval(() => {
            this.cleanupExpiredData();
        }, 5 * 60 * 1000); // Every 5 minutes

        // Metrics emission
        setInterval(() => {
            this.emitMetrics();
        }, 60000);
    }

    async initialize(logger: any): Promise<boolean> {
        try {
            this.logger = logger;
            this.logger.info('MetricsRollupDownsampler initializing...');
            
            this.isInitialized = true;
            this.logger.info('MetricsRollupDownsampler initialized successfully');
            return true;
        } catch (error) {
            this.logger.error('MetricsRollupDownsampler initialization error:', error);
            return false;
        }
    }

    /**
     * Process telemetry TSDB batch
     */
    async processTelemetryTSDBBatch(data: TelemetryTSDBBatch): Promise<void> {
        if (!this.isInitialized) return;

        try {
            for (const line of data.lines) {
                await this.processMetricLine(line, data.format);
            }

        } catch (error) {
            this.logger.error('MetricsRollupDownsampler TSDB batch processing error:', error);
        }
    }

    /**
     * Process telemetry Prometheus dump
     */
    async processTelemetryPromDump(data: TelemetryPromDump): Promise<void> {
        if (!this.isInitialized) return;

        try {
            for (const metric of data.metrics) {
                await this.processPromMetric(metric);
            }

        } catch (error) {
            this.logger.error('MetricsRollupDownsampler Prom dump processing error:', error);
        }
    }

    /**
     * Update rollup policy
     */
    async processRollupPolicyUpdate(data: RollupPolicyUpdate): Promise<void> {
        if (!this.isInitialized) return;

        try {
            this.rollupRules = data.rules;
            this.compileRules();
            this.logger.info(`MetricsRollupDownsampler updated with ${data.rules.length} rollup rules`);

        } catch (error) {
            this.logger.error('MetricsRollupDownsampler policy update error:', error);
        }
    }

    private initializeWindows(): void {
        for (const interval of this.config.intervals) {
            const intervalMs = this.parseInterval(interval);
            const now = Date.now();
            const windowStart = Math.floor(now / intervalMs) * intervalMs;
            
            const windowState: WindowState = {
                interval,
                windowStart,
                windowEnd: windowStart + intervalMs,
                intervalMs,
                series: new Map()
            };
            
            this.windowStates.set(interval, windowState);
        }
    }

    private parseInterval(interval: string): number {
        switch (interval) {
            case '1m': return 60 * 1000;
            case '5m': return 5 * 60 * 1000;
            case '1h': return 60 * 60 * 1000;
            default: return 60 * 1000;
        }
    }

    private compileRules(): void {
        this.compiledRules = this.rollupRules.map(rule => ({
            pattern: new RegExp(rule.match.metric),
            rule
        }));
    }

    private async processMetricLine(line: string, format: 'line_protocol' | 'json'): Promise<void> {
        try {
            let seriesKey: SeriesKey;
            let value: number;
            let timestamp: number;

            if (format === 'line_protocol') {
                const parsed = this.parseLineProtocol(line);
                if (!parsed) return;
                seriesKey = { metric: parsed.metric, labels: parsed.labels };
                value = parsed.value;
                timestamp = parsed.timestamp;
            } else {
                const parsed = JSON.parse(line);
                seriesKey = { metric: parsed.metric, labels: parsed.labels || {} };
                value = parsed.value;
                timestamp = parsed.timestamp || Date.now();
            }

            await this.ingestDataPoint(seriesKey, value, timestamp);

        } catch (error) {
            this.logger.debug('MetricsRollupDownsampler failed to parse metric line:', line);
        }
    }

    private async processPromMetric(metric: any): Promise<void> {
        const seriesKey: SeriesKey = {
            metric: metric.name,
            labels: metric.labels
        };

        await this.ingestDataPoint(seriesKey, metric.value, metric.timestamp);
    }

    private async ingestDataPoint(seriesKey: SeriesKey, value: number, timestamp: number): Promise<void> {
        this.stats.rawIn++;

        // Check TTL
        if (this.isExpiredByTTL(timestamp)) {
            this.stats.droppedByTtl++;
            return;
        }

        // Check cardinality
        const seriesId = this.getSeriesId(seriesKey);
        if (!this.seriesCardinality.has(seriesId)) {
            if (this.seriesCardinality.size >= this.config.cardinalityLimit) {
                await this.handleCardinalityLimit();
                this.stats.droppedByCardinality++;
                return;
            }
            this.seriesCardinality.add(seriesId);
        }

        // Find matching rule
        const matchingRule = this.findMatchingRule(seriesKey.metric);

        // Ingest into all relevant windows
        for (const [intervalKey, windowState] of this.windowStates.entries()) {
            if (!matchingRule || matchingRule.intervals.includes(windowState.interval)) {
                await this.ingestIntoWindow(windowState, seriesKey, value, timestamp, matchingRule);
            }
        }
    }

    private async ingestIntoWindow(
        windowState: WindowState, 
        seriesKey: SeriesKey, 
        value: number, 
        timestamp: number,
        rule?: RollupRule
    ): Promise<void> {
        // Check if we need to advance the window
        if (timestamp >= windowState.windowEnd) {
            await this.flushWindow(windowState);
            this.advanceWindow(windowState, timestamp);
        }

        // Get or create series buffer
        const seriesId = this.getSeriesId(seriesKey);
        let seriesBuffer = windowState.series.get(seriesId);
        
        if (!seriesBuffer) {
            seriesBuffer = {
                key: seriesKey,
                points: [],
                lastSeen: timestamp,
                rule
            };
            windowState.series.set(seriesId, seriesBuffer);
        }

        // Add data point
        seriesBuffer.points.push({ value, timestamp });
        seriesBuffer.lastSeen = timestamp;

        // Keep points sorted by timestamp
        if (seriesBuffer.points.length > 1) {
            seriesBuffer.points.sort((a, b) => a.timestamp - b.timestamp);
        }
    }

    private findMatchingRule(metric: string): RollupRule | undefined {
        for (const compiled of this.compiledRules) {
            if (compiled.pattern.test(metric)) {
                return compiled.rule;
            }
        }
        return undefined;
    }

    private async flushWindow(windowState: WindowState): Promise<void> {
        if (windowState.series.size === 0) return;

        const rollupLines: string[] = [];

        for (const [seriesId, seriesBuffer] of windowState.series.entries()) {
            if (seriesBuffer.points.length === 0) continue;

            const aggregates = this.calculateAggregates(seriesBuffer);
            const lines = this.formatRollupLines(seriesBuffer, aggregates, windowState);
            rollupLines.push(...lines);
        }

        if (rollupLines.length > 0) {
            const batch: TelemetryRollupBatch = {
                interval: windowState.interval,
                lines: rollupLines,
                timestamp: new Date().toISOString()
            };

            this.emit('telemetry.rollup.batch', batch);

            // Update stats
            switch (windowState.interval) {
                case '1m': this.stats.m1Out += rollupLines.length; break;
                case '5m': this.stats.m5Out += rollupLines.length; break;
                case '1h': this.stats.h1Out += rollupLines.length; break;
            }
        }

        // Clear the window
        windowState.series.clear();
    }

    private calculateAggregates(seriesBuffer: SeriesBuffer): Record<string, number> {
        const values = seriesBuffer.points.map(p => p.value);
        const rule = seriesBuffer.rule;
        const aggs = rule?.aggs || this.config.defaultAggs;
        
        const result: Record<string, number> = {};

        for (const agg of aggs) {
            switch (agg) {
                case 'min':
                    result.min = Math.min(...values);
                    break;
                case 'max':
                    result.max = Math.max(...values);
                    break;
                case 'avg':
                    result.avg = values.reduce((sum, v) => sum + v, 0) / values.length;
                    break;
                case 'sum':
                    result.sum = values.reduce((sum, v) => sum + v, 0);
                    break;
                case 'count':
                    result.count = values.length;
                    break;
                case 'p50':
                    result.p50 = this.calculatePercentile(values, 0.5);
                    break;
                case 'p95':
                    result.p95 = this.calculatePercentile(values, 0.95);
                    break;
                case 'p99':
                    result.p99 = this.calculatePercentile(values, 0.99);
                    break;
            }
        }

        return result;
    }

    private calculatePercentile(values: number[], percentile: number): number {
        if (values.length === 0) return 0;
        
        const sorted = [...values].sort((a, b) => a - b);
        const index = Math.ceil(sorted.length * percentile) - 1;
        return sorted[Math.max(0, index)];
    }

    private formatRollupLines(
        seriesBuffer: SeriesBuffer, 
        aggregates: Record<string, number>,
        windowState: WindowState
    ): string[] {
        const lines: string[] = [];
        const baseMetric = seriesBuffer.key.metric;
        const labelsStr = this.formatLabels(seriesBuffer.key.labels);
        const timestamp = windowState.windowEnd;

        for (const [agg, value] of Object.entries(aggregates)) {
            const metricName = `${baseMetric}_${agg}_${windowState.interval}`;
            const line = `${metricName}${labelsStr} value=${value} ${timestamp}000000`;
            lines.push(line);
        }

        return lines;
    }

    private formatLabels(labels: Record<string, string>): string {
        const labelPairs = Object.entries(labels)
            .map(([k, v]) => `${k}="${v}"`)
            .join(',');
        return labelPairs ? `,${labelPairs}` : '';
    }

    private advanceWindow(windowState: WindowState, currentTimestamp: number): void {
        const windowsToAdvance = Math.floor((currentTimestamp - windowState.windowStart) / windowState.intervalMs);
        windowState.windowStart += windowsToAdvance * windowState.intervalMs;
        windowState.windowEnd = windowState.windowStart + windowState.intervalMs;
    }

    private flushCompletedWindows(): void {
        const now = Date.now();
        
        for (const windowState of this.windowStates.values()) {
            if (now >= windowState.windowEnd) {
                this.flushWindow(windowState);
                this.advanceWindow(windowState, now);
            }
        }
    }

    private isExpiredByTTL(timestamp: number): boolean {
        const now = Date.now();
        const rawTtlMs = this.parseTTL(this.config.ttl.raw);
        return (now - timestamp) > rawTtlMs;
    }

    private parseTTL(ttl: string): number {
        const match = ttl.match(/^(\d+)([dhm])$/);
        if (!match) return 14 * 24 * 60 * 60 * 1000; // Default 14 days
        
        const value = parseInt(match[1]);
        const unit = match[2];
        
        switch (unit) {
            case 'm': return value * 60 * 1000;
            case 'h': return value * 60 * 60 * 1000;
            case 'd': return value * 24 * 60 * 60 * 1000;
            default: return 14 * 24 * 60 * 60 * 1000;
        }
    }

    private async handleCardinalityLimit(): Promise<void> {
        const now = Date.now();
        
        // Rate limit alerts
        if (now - this.lastCardinalityAlert < 60000) {
            return;
        }

        this.lastCardinalityAlert = now;

        const alert: RollupAlert = {
            level: 'warn',
            message: `MetricsRollupDownsampler cardinality limit reached: ${this.seriesCardinality.size}`,
            context: {
                currentCardinality: this.seriesCardinality.size,
                limit: this.config.cardinalityLimit,
                action: 'dropping_new_series'
            },
            timestamp: new Date().toISOString()
        };

        this.emit('rollup.alert', alert);
    }

    private cleanupExpiredData(): void {
        const now = Date.now();
        const cleanupAge = 60 * 60 * 1000; // 1 hour

        // Clean up cardinality tracking for very old series
        // In a production system, you'd want more sophisticated cleanup
        if (this.seriesCardinality.size > this.config.cardinalityLimit * 0.9) {
            // Reset cardinality tracking periodically to prevent memory leaks
            this.seriesCardinality.clear();
        }

        // Clean up window states of very old series
        for (const windowState of this.windowStates.values()) {
            const toDelete: string[] = [];
            
            for (const [seriesId, seriesBuffer] of windowState.series.entries()) {
                if (now - seriesBuffer.lastSeen > cleanupAge) {
                    toDelete.push(seriesId);
                }
            }
            
            toDelete.forEach(id => windowState.series.delete(id));
        }
    }

    private parseLineProtocol(line: string): { metric: string; labels: Record<string, string>; value: number; timestamp: number } | null {
        try {
            // Simple line protocol parser: metric,tag1=value1,tag2=value2 field=value timestamp
            const parts = line.trim().split(' ');
            if (parts.length < 2) return null;

            const metricAndTags = parts[0];
            const fieldsStr = parts[1];
            const timestamp = parts[2] ? parseInt(parts[2]) / 1000000 : Date.now(); // Convert nanoseconds to milliseconds

            // Parse metric and tags
            const metricParts = metricAndTags.split(',');
            const metric = metricParts[0];
            const labels: Record<string, string> = {};

            for (let i = 1; i < metricParts.length; i++) {
                const [key, value] = metricParts[i].split('=');
                if (key && value) {
                    labels[key] = value;
                }
            }

            // Parse field (assume single field for simplicity)
            const fieldMatch = fieldsStr.match(/(\w+)=([0-9.-]+)/);
            if (!fieldMatch) return null;

            const value = parseFloat(fieldMatch[2]);

            return { metric, labels, value, timestamp };

        } catch (error) {
            return null;
        }
    }

    private getSeriesId(seriesKey: SeriesKey): string {
        const labelStr = Object.entries(seriesKey.labels)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([k, v]) => `${k}=${v}`)
            .join(',');
        return `${seriesKey.metric}{${labelStr}}`;
    }

    private emitMetrics(): void {
        const metrics: RollupMetrics = {
            rawIn: this.stats.rawIn,
            m1Out: this.stats.m1Out,
            m5Out: this.stats.m5Out,
            h1Out: this.stats.h1Out,
            droppedByTtl: this.stats.droppedByTtl,
            windowSec: 60
        };

        this.emit('rollup.metrics', metrics);

        // Reset stats
        this.stats = {
            rawIn: 0,
            m1Out: 0,
            m5Out: 0,
            h1Out: 0,
            droppedByTtl: 0,
            droppedByCardinality: 0,
            windowStart: Date.now()
        };
    }

    /**
     * Get module status
     */
    getStatus(): any {
        return {
            name: 'MetricsRollupDownsampler',
            initialized: this.isInitialized,
            rollupRules: this.rollupRules.length,
            cardinality: this.seriesCardinality.size,
            windowStates: Array.from(this.windowStates.entries()).map(([interval, state]) => ({
                interval,
                activeSeries: state.series.size,
                windowStart: new Date(state.windowStart).toISOString(),
                windowEnd: new Date(state.windowEnd).toISOString()
            })),
            stats: this.stats
        };
    }

    async shutdown(): Promise<void> {
        try {
            this.logger.info('MetricsRollupDownsampler shutting down...');
            
            // Flush all pending windows
            for (const windowState of this.windowStates.values()) {
                await this.flushWindow(windowState);
            }
            
            this.removeAllListeners();
            this.windowStates.clear();
            this.seriesCardinality.clear();
            this.ttlTimestamps.clear();
            this.isInitialized = false;
            this.logger.info('MetricsRollupDownsampler shutdown complete');
        } catch (error) {
            this.logger.error('MetricsRollupDownsampler shutdown error:', error);
        }
    }
}

export default MetricsRollupDownsampler;
