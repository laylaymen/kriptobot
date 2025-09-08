/**
 * Telemetry Anomaly Detector - LT-01
 * Advanced statistical anomaly detection for all *.metrics streams
 * Detects spikes, drops, drifts, flatlines, and gaps with early warning
 */

import { EventEmitter } from 'events';

interface MetricsInput {
    series: string;
    labels: Record<string, string>;
    value: number;
    timestamp: number;
}

interface SLOStatus {
    service: string;
    slo: string;
    status: 'healthy' | 'degraded' | 'breached';
    burnRate: number;
    errorBudgetPct: number;
    windowSec: number;
}

interface ConnectivityHeartbeat {
    source: string;
    timestamp: number;
    status: 'active' | 'stale' | 'down';
}

interface AnomalySignal {
    series: string;
    labels: Record<string, string>;
    score: number;
    kind: 'spike' | 'drop' | 'drift' | 'flatline' | 'gap';
    severity: 'low' | 'medium' | 'high';
    window: '1m' | '5m' | '1h';
    baseline: {
        mean: number;
        mad?: number;
        stdev?: number;
    };
    value: number;
    delta: number;
    reasonCodes: string[];
    timestamp: string;
}

interface TelemetryAlert {
    level: 'info' | 'warn' | 'error';
    message: string;
    context: {
        series: string;
        kind: string;
        severity: string;
    };
    timestamp: string;
}

interface AnomalyMetrics {
    evaluated: number;
    flagged: number;
    flatlines: number;
    gaps: number;
    windowSec: number;
}

interface DetectorWindow {
    span: string;
    step: string;
    spanMs: number;
    stepMs: number;
}

interface SeriesBaseline {
    median: number;
    mad: number;
    mean: number;
    stdev: number;
    ewmaValue: number;
    ewmaAlpha: number;
    lastUpdate: number;
    pointCount: number;
    history: Array<{ value: number; timestamp: number }>;
}

interface Config {
    windows: Array<{ span: string; step: string }>;
    detectors: {
        method: 'robust_z' | 'ewma_holt';
        zHi: number;
        zWarn: number;
        driftEwmaAlpha: number;
        flatlineStaleSec: number;
        gapStaleSec: number;
    };
    minPoints: number;
    severityMap: {
        high: number;
        medium: number;
    };
    mute: {
        series: string[];
        labels: Record<string, string>;
    };
    tz: string;
}

class TelemetryAnomalyDetector extends EventEmitter {
    private config: Config;
    private logger: any;
    private isInitialized: boolean = false;
    
    // Detection windows
    private windows: DetectorWindow[] = [];
    
    // Series baselines by window
    private baselines: Map<string, Map<string, SeriesBaseline>> = new Map();
    
    // SLO context for weight adjustment
    private sloStatuses: Map<string, SLOStatus> = new Map();
    
    // Connectivity tracking for gap/flatline detection
    private lastHeartbeats: Map<string, number> = new Map();
    
    // Idempotency tracking
    private recentSignals: Map<string, { timestamp: number; kind: string }> = new Map();
    
    // Statistics
    private stats: {
        evaluated: number;
        flagged: number;
        flatlines: number;
        gaps: number;
        windowStart: number;
    } = {
        evaluated: 0,
        flagged: 0,
        flatlines: 0,
        gaps: 0,
        windowStart: Date.now()
    };

    constructor(config: Partial<Config> = {}) {
        super();
        this.config = {
            windows: [
                { span: '1m', step: '10s' },
                { span: '5m', step: '30s' },
                { span: '1h', step: '5m' }
            ],
            detectors: {
                method: 'robust_z',
                zHi: 3.5,
                zWarn: 2.5,
                driftEwmaAlpha: 0.2,
                flatlineStaleSec: 90,
                gapStaleSec: 60
            },
            minPoints: 20,
            severityMap: {
                high: 5.0,
                medium: 3.5
            },
            mute: {
                series: [],
                labels: {}
            },
            tz: 'Europe/Istanbul',
            ...config
        };

        // Parse time windows
        this.parseWindows();

        // Cleanup expired data periodically
        setInterval(() => {
            this.cleanupExpiredBaselines();
            this.cleanupExpiredSignals();
        }, 30000);

        // Reset stats window
        setInterval(() => {
            this.emitMetrics();
        }, 60000);
    }

    async initialize(logger: any): Promise<boolean> {
        try {
            this.logger = logger;
            this.logger.info('TelemetryAnomalyDetector initializing...');
            
            this.isInitialized = true;
            this.logger.info('TelemetryAnomalyDetector initialized successfully');
            return true;
        } catch (error) {
            this.logger.error('TelemetryAnomalyDetector initialization error:', error);
            return false;
        }
    }

    /**
     * Process metrics input
     */
    async processMetrics(data: MetricsInput): Promise<void> {
        if (!this.isInitialized) return;

        try {
            // Check if series is muted
            if (this.isSeriesMuted(data.series, data.labels)) {
                return;
            }

            this.stats.evaluated++;

            // Process each detection window
            for (const window of this.windows) {
                await this.processMetricsForWindow(data, window);
            }

        } catch (error) {
            this.logger.error('TelemetryAnomalyDetector metrics processing error:', error);
        }
    }

    /**
     * Process SLO status for context weighting
     */
    async processSLOStatus(data: SLOStatus): Promise<void> {
        if (!this.isInitialized) return;

        try {
            const key = `${data.service}:${data.slo}`;
            this.sloStatuses.set(key, data);

            // Clean old SLO statuses
            if (this.sloStatuses.size > 1000) {
                const oldestKey = this.sloStatuses.keys().next().value;
                this.sloStatuses.delete(oldestKey);
            }

        } catch (error) {
            this.logger.error('TelemetryAnomalyDetector SLO status processing error:', error);
        }
    }

    /**
     * Process connectivity heartbeat for gap/flatline detection
     */
    async processConnectivityHeartbeat(data: ConnectivityHeartbeat): Promise<void> {
        if (!this.isInitialized) return;

        try {
            this.lastHeartbeats.set(data.source, data.timestamp);

            // Detect gaps in heartbeat sources
            const now = Date.now();
            for (const [source, lastTs] of this.lastHeartbeats.entries()) {
                const ageMs = now - lastTs;
                
                if (ageMs > this.config.detectors.gapStaleSec * 1000) {
                    await this.emitGapAnomaly(source, ageMs);
                }
            }

        } catch (error) {
            this.logger.error('TelemetryAnomalyDetector heartbeat processing error:', error);
        }
    }

    private parseWindows(): void {
        this.windows = this.config.windows.map(w => {
            const spanMs = this.parseTimespan(w.span);
            const stepMs = this.parseTimespan(w.step);
            return {
                span: w.span,
                step: w.step,
                spanMs,
                stepMs
            };
        });
    }

    private parseTimespan(timespan: string): number {
        const match = timespan.match(/^(\d+)([smh])$/);
        if (!match) return 60000; // Default 1m
        
        const value = parseInt(match[1]);
        const unit = match[2];
        
        switch (unit) {
            case 's': return value * 1000;
            case 'm': return value * 60 * 1000;
            case 'h': return value * 60 * 60 * 1000;
            default: return 60000;
        }
    }

    private async processMetricsForWindow(data: MetricsInput, window: DetectorWindow): Promise<void> {
        const windowKey = window.span;
        const seriesKey = this.getSeriesKey(data.series, data.labels);
        
        // Get or create baseline for this series+window
        if (!this.baselines.has(windowKey)) {
            this.baselines.set(windowKey, new Map());
        }
        
        const windowBaselines = this.baselines.get(windowKey)!;
        let baseline = windowBaselines.get(seriesKey);
        
        if (!baseline) {
            baseline = this.createBaseline();
            windowBaselines.set(seriesKey, baseline);
        }

        // Update baseline with new data point
        this.updateBaseline(baseline, data.value, data.timestamp);

        // Skip detection if not enough points
        if (baseline.pointCount < this.config.minPoints) {
            return;
        }

        // Detect anomalies
        const anomaly = this.detectAnomaly(data, baseline, window);
        if (anomaly) {
            await this.emitAnomaly(anomaly);
        }
    }

    private createBaseline(): SeriesBaseline {
        return {
            median: 0,
            mad: 0,
            mean: 0,
            stdev: 0,
            ewmaValue: 0,
            ewmaAlpha: this.config.detectors.driftEwmaAlpha,
            lastUpdate: 0,
            pointCount: 0,
            history: []
        };
    }

    private updateBaseline(baseline: SeriesBaseline, value: number, timestamp: number): void {
        // Add to history
        baseline.history.push({ value, timestamp });
        baseline.pointCount++;
        baseline.lastUpdate = timestamp;

        // Keep only recent history (window size + buffer)
        const maxHistoryPoints = Math.max(100, this.config.minPoints * 2);
        if (baseline.history.length > maxHistoryPoints) {
            baseline.history = baseline.history.slice(-maxHistoryPoints);
        }

        // Update statistics
        const values = baseline.history.map(h => h.value);
        baseline.mean = this.calculateMean(values);
        baseline.median = this.calculateMedian(values);
        baseline.mad = this.calculateMAD(values, baseline.median);
        baseline.stdev = this.calculateStdev(values, baseline.mean);

        // Update EWMA
        if (baseline.ewmaValue === 0) {
            baseline.ewmaValue = value;
        } else {
            baseline.ewmaValue = baseline.ewmaAlpha * value + (1 - baseline.ewmaAlpha) * baseline.ewmaValue;
        }
    }

    private detectAnomaly(data: MetricsInput, baseline: SeriesBaseline, window: DetectorWindow): AnomalySignal | null {
        const now = Date.now();
        const ageMs = now - data.timestamp;

        // Check for flatline (same value for too long)
        const recentValues = baseline.history.slice(-10).map(h => h.value);
        const isFlat = recentValues.length >= 5 && 
                      new Set(recentValues).size === 1 &&
                      ageMs < this.config.detectors.flatlineStaleSec * 1000;

        if (isFlat) {
            this.stats.flatlines++;
            return this.createAnomalySignal(data, baseline, window, 'flatline', 1.0, 'medium', ['FLATLINE_DETECTED']);
        }

        // Check for gap (no data for too long)
        if (ageMs > this.config.detectors.gapStaleSec * 1000) {
            this.stats.gaps++;
            return this.createAnomalySignal(data, baseline, window, 'gap', 1.0, 'medium', ['DATA_GAP']);
        }

        // Statistical anomaly detection
        let zScore = 0;
        let method = '';

        if (this.config.detectors.method === 'robust_z') {
            // Robust z-score using median and MAD
            if (baseline.mad > 0) {
                zScore = Math.abs(data.value - baseline.median) / baseline.mad;
                method = 'ROBUST_Z';
            }
        } else if (this.config.detectors.method === 'ewma_holt') {
            // EWMA-based detection
            if (baseline.stdev > 0) {
                zScore = Math.abs(data.value - baseline.ewmaValue) / baseline.stdev;
                method = 'EWMA_HOLT';
            }
        }

        if (zScore === 0) return null;

        // Determine anomaly type and severity
        const delta = data.value - baseline.mean;
        let kind: 'spike' | 'drop' | 'drift';
        let severity: 'low' | 'medium' | 'high';
        const reasonCodes = [method];

        if (Math.abs(delta) > baseline.stdev * 2) {
            kind = delta > 0 ? 'spike' : 'drop';
        } else {
            kind = 'drift';
        }

        if (zScore >= this.config.severityMap.high) {
            severity = 'high';
        } else if (zScore >= this.config.severityMap.medium) {
            severity = 'medium';
        } else if (zScore >= this.config.detectors.zWarn) {
            severity = 'low';
        } else {
            return null; // Below warning threshold
        }

        // Adjust severity based on SLO context
        const sloWeight = this.getSLOWeight(data.series, data.labels);
        if (sloWeight > 1.0) {
            if (severity === 'low') severity = 'medium';
            else if (severity === 'medium') severity = 'high';
            reasonCodes.push('SLO_PRESSURE');
        }

        this.stats.flagged++;
        return this.createAnomalySignal(data, baseline, window, kind, zScore, severity, reasonCodes);
    }

    private createAnomalySignal(
        data: MetricsInput, 
        baseline: SeriesBaseline, 
        window: DetectorWindow,
        kind: 'spike' | 'drop' | 'drift' | 'flatline' | 'gap',
        score: number,
        severity: 'low' | 'medium' | 'high',
        reasonCodes: string[]
    ): AnomalySignal {
        return {
            series: data.series,
            labels: data.labels,
            score,
            kind,
            severity,
            window: window.span as '1m' | '5m' | '1h',
            baseline: {
                mean: baseline.mean,
                mad: baseline.mad,
                stdev: baseline.stdev
            },
            value: data.value,
            delta: data.value - baseline.mean,
            reasonCodes,
            timestamp: new Date(data.timestamp).toISOString()
        };
    }

    private async emitAnomaly(anomaly: AnomalySignal): Promise<void> {
        // Check for idempotency (same series+kind within window)
        const idempotencyKey = `${anomaly.series}:${anomaly.kind}:${anomaly.window}`;
        const now = Date.now();
        const windowMs = this.parseTimespan(anomaly.window);
        
        const recent = this.recentSignals.get(idempotencyKey);
        if (recent && now - recent.timestamp < windowMs) {
            return; // Skip duplicate
        }

        this.recentSignals.set(idempotencyKey, { timestamp: now, kind: anomaly.kind });

        // Emit anomaly signal
        this.emit('telemetry.anomaly.signal', anomaly);

        // Create alert for high severity
        if (anomaly.severity === 'high') {
            const alert: TelemetryAlert = {
                level: 'error',
                message: `${anomaly.kind} anomaly detected in ${anomaly.series} (score: ${anomaly.score.toFixed(2)})`,
                context: {
                    series: anomaly.series,
                    kind: anomaly.kind,
                    severity: anomaly.severity
                },
                timestamp: new Date().toISOString()
            };
            this.emit('telemetry.alert', alert);
        }
    }

    private async emitGapAnomaly(source: string, ageMs: number): Promise<void> {
        const anomaly: AnomalySignal = {
            series: `connectivity.${source}`,
            labels: { source },
            score: ageMs / 1000, // Age in seconds as score
            kind: 'gap',
            severity: ageMs > 300000 ? 'high' : 'medium', // 5 minutes = high
            window: '1m',
            baseline: { mean: 0, mad: 0, stdev: 0 },
            value: 0,
            delta: 0,
            reasonCodes: ['CONNECTIVITY_GAP'],
            timestamp: new Date().toISOString()
        };

        await this.emitAnomaly(anomaly);
    }

    private getSLOWeight(series: string, labels: Record<string, string>): number {
        // Check if this series is related to any SLO under pressure
        for (const [key, slo] of this.sloStatuses.entries()) {
            if (slo.status !== 'healthy' && slo.burnRate > 1.0) {
                // Simple heuristic: if series contains service name and SLO is under pressure
                if (series.includes(slo.service) || Object.values(labels).some(v => v.includes(slo.service))) {
                    return 1.0 + (slo.burnRate - 1.0) * 0.5; // Up to 50% weight increase
                }
            }
        }
        return 1.0;
    }

    private isSeriesMuted(series: string, labels: Record<string, string>): boolean {
        // Check series blacklist
        if (this.config.mute.series.includes(series)) {
            return true;
        }

        // Check label-based muting
        for (const [key, value] of Object.entries(this.config.mute.labels)) {
            if (labels[key] === value) {
                return true;
            }
        }

        return false;
    }

    private getSeriesKey(series: string, labels: Record<string, string>): string {
        const labelStr = Object.entries(labels)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([k, v]) => `${k}=${v}`)
            .join(',');
        return `${series}{${labelStr}}`;
    }

    // Statistical helper functions
    private calculateMean(values: number[]): number {
        return values.reduce((sum, v) => sum + v, 0) / values.length;
    }

    private calculateMedian(values: number[]): number {
        const sorted = [...values].sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        return sorted.length % 2 === 0 
            ? (sorted[mid - 1] + sorted[mid]) / 2
            : sorted[mid];
    }

    private calculateMAD(values: number[], median: number): number {
        const deviations = values.map(v => Math.abs(v - median));
        return this.calculateMedian(deviations);
    }

    private calculateStdev(values: number[], mean: number): number {
        const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length;
        return Math.sqrt(variance);
    }

    private cleanupExpiredBaselines(): void {
        const now = Date.now();
        const maxAge = 24 * 60 * 60 * 1000; // 24 hours

        for (const [windowKey, windowBaselines] of this.baselines.entries()) {
            const toDelete: string[] = [];
            
            for (const [seriesKey, baseline] of windowBaselines.entries()) {
                if (now - baseline.lastUpdate > maxAge) {
                    toDelete.push(seriesKey);
                }
            }
            
            toDelete.forEach(key => windowBaselines.delete(key));
        }
    }

    private cleanupExpiredSignals(): void {
        const now = Date.now();
        const maxAge = 60 * 60 * 1000; // 1 hour
        
        const toDelete: string[] = [];
        for (const [key, signal] of this.recentSignals.entries()) {
            if (now - signal.timestamp > maxAge) {
                toDelete.push(key);
            }
        }
        
        toDelete.forEach(key => this.recentSignals.delete(key));
    }

    private emitMetrics(): void {
        const metrics: AnomalyMetrics = {
            evaluated: this.stats.evaluated,
            flagged: this.stats.flagged,
            flatlines: this.stats.flatlines,
            gaps: this.stats.gaps,
            windowSec: 60
        };

        this.emit('telemetry.anomaly.metrics', metrics);

        // Reset stats
        this.stats = {
            evaluated: 0,
            flagged: 0,
            flatlines: 0,
            gaps: 0,
            windowStart: Date.now()
        };
    }

    /**
     * Get module status
     */
    getStatus(): any {
        return {
            name: 'TelemetryAnomalyDetector',
            initialized: this.isInitialized,
            baselines: Array.from(this.baselines.entries()).map(([window, series]) => ({
                window,
                seriesCount: series.size
            })),
            sloContexts: this.sloStatuses.size,
            recentSignals: this.recentSignals.size,
            stats: this.stats
        };
    }

    async shutdown(): Promise<void> {
        try {
            this.logger.info('TelemetryAnomalyDetector shutting down...');
            this.removeAllListeners();
            this.baselines.clear();
            this.sloStatuses.clear();
            this.lastHeartbeats.clear();
            this.recentSignals.clear();
            this.isInitialized = false;
            this.logger.info('TelemetryAnomalyDetector shutdown complete');
        } catch (error) {
            this.logger.error('TelemetryAnomalyDetector shutdown error:', error);
        }
    }
}

export default TelemetryAnomalyDetector;
