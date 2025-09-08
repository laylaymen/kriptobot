/**
 * Exchange Connectivity Sentry - SG-01
 * Advanced exchange connection health monitoring and guard directive system
 * Monitors ping, message rates, gaps, and reconnections to declare connectivity modes
 */

import { EventEmitter } from 'events';

interface ConnectivityPingTick {
    rttMs: number;
    endpoint: string;
    transport: 'ws' | 'rest';
    ok: boolean;
    timestamp: string;
}

interface MarketStreamTick {
    msgsPerSec: number;
    lastSeq: number;
    gapMs: number;
    topic: string;
    endpoint: string;
    timestamp: string;
}

interface OrderStreamTick {
    msgsPerSec: number;
    gapMs: number;
    endpoint: string;
    timestamp: string;
}

interface ExchangeRateLimit {
    used: number;
    limit: number;
    resetMs: number;
    endpoint: string;
}

interface EndpointCatalog {
    primary: string;
    secondary: string[];
    geoHints: string[];
    weight: Record<string, number>;
}

interface ReplayClockTick {
    virtualTime: string;
    speed: number;
    mode: 'replay' | 'live';
}

interface SentryGuardDirective {
    mode: 'normal' | 'degraded' | 'streams_panic' | 'halt_entry';
    expiresAt: string;
    reasonCodes: string[];
    timestamp: string;
    source: 'connectivity_sentry';
}

interface SentryFailoverRecommendation {
    from: string;
    to: string;
    scoreFrom: number;
    scoreTo: number;
    reasonCodes: string[];
    timestamp: string;
}

interface SentryMetrics {
    ewma: {
        pingMs: number;
        wsMsgsPerSec: number;
    };
    gaps: {
        count: number;
        avgGapMs: number;
    };
    reconnects: number;
    endpointSwitches: number;
}

interface Config {
    ewmaAlpha: number;
    thresholds: {
        pingP99Ms: number;
        gapWarnMs: number;
        panicGapMs: number;
        msgsFloor: number;
    };
    degradedBudgetSec: number;
    panicHoldSec: number;
    haltEntryOnNoOrderStreamSec: number;
    failoverMinIntervalSec: number;
    healthWeights: {
        ping: number;
        gaps: number;
        msgs: number;
        rl: number;
    };
    tz: string;
}

class ExchangeConnectivitySentry extends EventEmitter {
    private config: Config;
    private logger: any;
    private isInitialized: boolean = false;
    
    // EWMA tracking
    private ewmaPing: number = 0;
    private ewmaMessages: number = 0;
    
    // Health metrics
    private pingHistory: number[] = [];
    private gapHistory: number[] = [];
    private reconnectCount: number = 0;
    private endpointSwitchCount: number = 0;
    
    // State management
    private currentMode: string = 'normal';
    private modeStartTime: number = Date.now();
    private lastOrderStreamTime: number = Date.now();
    private lastFailoverTime: number = 0;
    
    // Endpoint tracking
    private endpointScores: Map<string, number> = new Map();
    private lastDirective: SentryGuardDirective | null = null;

    constructor(config: Partial<Config> = {}) {
        super();
        this.config = {
            ewmaAlpha: 0.2,
            thresholds: {
                pingP99Ms: 1500,
                gapWarnMs: 500,
                panicGapMs: 2000,
                msgsFloor: 10
            },
            degradedBudgetSec: 60,
            panicHoldSec: 120,
            haltEntryOnNoOrderStreamSec: 20,
            failoverMinIntervalSec: 300,
            healthWeights: {
                ping: 0.4,
                gaps: 0.3,
                msgs: 0.2,
                rl: 0.1
            },
            tz: "Europe/Istanbul",
            ...config
        };
    }

    async initialize(logger: any): Promise<boolean> {
        try {
            this.logger = logger;
            this.logger.info('ExchangeConnectivitySentry initializing...');
            
            this.isInitialized = true;
            this.logger.info('ExchangeConnectivitySentry initialized successfully');
            return true;
        } catch (error) {
            this.logger.error('ExchangeConnectivitySentry initialization error:', error);
            return false;
        }
    }

    /**
     * Process connectivity ping tick
     */
    async processPingTick(data: ConnectivityPingTick): Promise<void> {
        if (!this.isInitialized) return;

        try {
            // Update EWMA for ping
            this.ewmaPing = this.config.ewmaAlpha * data.rttMs + 
                           (1 - this.config.ewmaAlpha) * this.ewmaPing;

            // Track ping history for P99 calculation
            this.pingHistory.push(data.rttMs);
            if (this.pingHistory.length > 1000) {
                this.pingHistory.shift();
            }

            // Update endpoint score
            const score = data.ok ? Math.max(0, 1 - data.rttMs / 2000) : 0;
            this.endpointScores.set(data.endpoint, score);

            // Check for health evaluation
            await this.evaluateHealth();

        } catch (error) {
            this.logger.error('ExchangeConnectivitySentry ping processing error:', error);
        }
    }

    /**
     * Process market stream tick
     */
    async processMarketStream(data: MarketStreamTick): Promise<void> {
        if (!this.isInitialized) return;

        try {
            // Update EWMA for messages
            this.ewmaMessages = this.config.ewmaAlpha * data.msgsPerSec + 
                               (1 - this.config.ewmaAlpha) * this.ewmaMessages;

            // Track gaps
            if (data.gapMs > 0) {
                this.gapHistory.push(data.gapMs);
                if (this.gapHistory.length > 500) {
                    this.gapHistory.shift();
                }
            }

            // Check for health evaluation
            await this.evaluateHealth();

        } catch (error) {
            this.logger.error('ExchangeConnectivitySentry market stream processing error:', error);
        }
    }

    /**
     * Process order stream tick
     */
    async processOrderStream(data: OrderStreamTick): Promise<void> {
        if (!this.isInitialized) return;

        try {
            this.lastOrderStreamTime = Date.now();

            // Check for health evaluation
            await this.evaluateHealth();

        } catch (error) {
            this.logger.error('ExchangeConnectivitySentry order stream processing error:', error);
        }
    }

    /**
     * Process rate limit snapshot
     */
    async processRateLimit(data: ExchangeRateLimit): Promise<void> {
        if (!this.isInitialized) return;

        try {
            // Update endpoint score based on rate limit utilization
            const utilization = data.used / data.limit;
            const rateLimitScore = Math.max(0, 1 - utilization);
            
            const currentScore = this.endpointScores.get(data.endpoint) || 0;
            const weightedScore = currentScore * (1 - this.config.healthWeights.rl) + 
                                 rateLimitScore * this.config.healthWeights.rl;
            
            this.endpointScores.set(data.endpoint, weightedScore);

        } catch (error) {
            this.logger.error('ExchangeConnectivitySentry rate limit processing error:', error);
        }
    }

    /**
     * Main health evaluation function
     */
    private async evaluateHealth(): Promise<void> {
        const now = Date.now();
        const healthScore = this.calculateHealthScore();
        const newMode = this.determineMode(healthScore);

        // Check for mode change with hysteresis
        if (this.shouldChangeMode(newMode)) {
            await this.transitionToMode(newMode);
        }

        // Check for failover recommendation
        await this.checkFailoverNeed();

        // Emit metrics
        this.emitMetrics();
    }

    private calculateHealthScore(): number {
        const weights = this.config.healthWeights;
        let score = 0;

        // Ping component
        const pingP99 = this.calculateP99(this.pingHistory);
        const pingScore = Math.max(0, 1 - pingP99 / this.config.thresholds.pingP99Ms);
        score += weights.ping * pingScore;

        // Gaps component
        const avgGap = this.gapHistory.length > 0 ? 
                      this.gapHistory.reduce((sum, gap) => sum + gap, 0) / this.gapHistory.length : 0;
        const gapScore = Math.max(0, 1 - avgGap / this.config.thresholds.gapWarnMs);
        score += weights.gaps * gapScore;

        // Messages component
        const msgScore = Math.min(1, this.ewmaMessages / this.config.thresholds.msgsFloor);
        score += weights.msgs * msgScore;

        // Rate limit component (average of all endpoints)
        const rlScores = Array.from(this.endpointScores.values());
        const avgRlScore = rlScores.length > 0 ? 
                          rlScores.reduce((sum, s) => sum + s, 0) / rlScores.length : 1;
        score += weights.rl * avgRlScore;

        return Math.max(0, Math.min(1, score));
    }

    private determineMode(healthScore: number): string {
        const now = Date.now();
        const pingP99 = this.calculateP99(this.pingHistory);
        const maxGap = this.gapHistory.length > 0 ? Math.max(...this.gapHistory) : 0;
        const orderStreamAge = now - this.lastOrderStreamTime;

        // Emergency conditions
        if (orderStreamAge > this.config.haltEntryOnNoOrderStreamSec * 1000) {
            return 'halt_entry';
        }

        if (pingP99 > this.config.thresholds.pingP99Ms || 
            maxGap >= this.config.thresholds.panicGapMs) {
            return 'streams_panic';
        }

        // Degraded conditions
        if (this.ewmaMessages < this.config.thresholds.msgsFloor ||
            maxGap >= this.config.thresholds.gapWarnMs) {
            return 'degraded';
        }

        // Normal state
        if (healthScore > 0.8) {
            return 'normal';
        }

        return this.currentMode; // Keep current mode if uncertain
    }

    private shouldChangeMode(newMode: string): boolean {
        const now = Date.now();
        const modeAge = (now - this.modeStartTime) / 1000;

        // Panic mode has minimum hold time
        if (this.currentMode === 'streams_panic' && 
            modeAge < this.config.panicHoldSec) {
            return false;
        }

        // Degraded mode has budget time
        if (this.currentMode === 'degraded' && 
            newMode === 'streams_panic' &&
            modeAge < this.config.degradedBudgetSec) {
            return false;
        }

        return newMode !== this.currentMode;
    }

    private async transitionToMode(newMode: string): Promise<void> {
        const now = Date.now();
        const reasonCodes = this.generateReasonCodes(newMode);

        this.currentMode = newMode;
        this.modeStartTime = now;

        const directive: SentryGuardDirective = {
            mode: newMode as any,
            expiresAt: new Date(now + 300000).toISOString(), // 5 minutes default
            reasonCodes,
            timestamp: new Date(now).toISOString(),
            source: 'connectivity_sentry'
        };

        // Avoid duplicate directives
        if (!this.lastDirective || 
            this.lastDirective.mode !== directive.mode ||
            JSON.stringify(this.lastDirective.reasonCodes) !== JSON.stringify(directive.reasonCodes)) {
            
            this.lastDirective = directive;
            this.emit('sentry.guard.directive', directive);
            
            this.logger.warn(`ExchangeConnectivitySentry mode change: ${newMode}`, {
                reasonCodes,
                healthScore: this.calculateHealthScore()
            });
        }
    }

    private async checkFailoverNeed(): Promise<void> {
        const now = Date.now();
        
        if (now - this.lastFailoverTime < this.config.failoverMinIntervalSec * 1000) {
            return; // Too soon for another failover
        }

        const scores = Array.from(this.endpointScores.entries());
        if (scores.length < 2) return;

        scores.sort((a, b) => b[1] - a[1]); // Sort by score desc
        const [best, current] = scores;

        // Recommend failover if significant score difference
        if (best[1] - current[1] > 0.3 && best[1] > 0.6) {
            const recommendation: SentryFailoverRecommendation = {
                from: current[0],
                to: best[0],
                scoreFrom: current[1],
                scoreTo: best[1],
                reasonCodes: ['HEALTH_SCORE_IMPROVEMENT'],
                timestamp: new Date().toISOString()
            };

            this.emit('sentry.failover.recommendation', recommendation);
            this.lastFailoverTime = now;
            this.endpointSwitchCount++;
        }
    }

    private generateReasonCodes(mode: string): string[] {
        const codes: string[] = [];
        
        const pingP99 = this.calculateP99(this.pingHistory);
        const maxGap = this.gapHistory.length > 0 ? Math.max(...this.gapHistory) : 0;
        const orderStreamAge = (Date.now() - this.lastOrderStreamTime) / 1000;

        if (pingP99 > this.config.thresholds.pingP99Ms) {
            codes.push('HIGH_PING_LATENCY');
        }

        if (maxGap >= this.config.thresholds.panicGapMs) {
            codes.push('PANIC_LEVEL_GAPS');
        } else if (maxGap >= this.config.thresholds.gapWarnMs) {
            codes.push('WARNING_LEVEL_GAPS');
        }

        if (this.ewmaMessages < this.config.thresholds.msgsFloor) {
            codes.push('LOW_MESSAGE_RATE');
        }

        if (orderStreamAge > this.config.haltEntryOnNoOrderStreamSec) {
            codes.push('ORDER_STREAM_TIMEOUT');
        }

        return codes;
    }

    private calculateP99(values: number[]): number {
        if (values.length === 0) return 0;
        
        const sorted = [...values].sort((a, b) => a - b);
        const index = Math.ceil(sorted.length * 0.99) - 1;
        return sorted[Math.max(0, index)];
    }

    private emitMetrics(): void {
        const metrics: SentryMetrics = {
            ewma: {
                pingMs: this.ewmaPing,
                wsMsgsPerSec: this.ewmaMessages
            },
            gaps: {
                count: this.gapHistory.length,
                avgGapMs: this.gapHistory.length > 0 ? 
                         this.gapHistory.reduce((sum, gap) => sum + gap, 0) / this.gapHistory.length : 0
            },
            reconnects: this.reconnectCount,
            endpointSwitches: this.endpointSwitchCount
        };

        this.emit('sentry.metrics', metrics);
    }

    /**
     * Get current connectivity status
     */
    getStatus(): any {
        return {
            name: 'ExchangeConnectivitySentry',
            initialized: this.isInitialized,
            currentMode: this.currentMode,
            healthScore: this.calculateHealthScore(),
            endpointScores: Object.fromEntries(this.endpointScores),
            ewmaMetrics: {
                ping: this.ewmaPing,
                messages: this.ewmaMessages
            },
            modeAge: (Date.now() - this.modeStartTime) / 1000
        };
    }

    /**
     * Force mode change (for testing/emergency)
     */
    async forceMode(mode: string, reason: string = 'MANUAL_OVERRIDE'): Promise<void> {
        await this.transitionToMode(mode);
        this.logger.warn(`ExchangeConnectivitySentry forced to mode: ${mode}`, { reason });
    }

    async shutdown(): Promise<void> {
        try {
            this.logger.info('ExchangeConnectivitySentry shutting down...');
            this.removeAllListeners();
            this.endpointScores.clear();
            this.pingHistory.length = 0;
            this.gapHistory.length = 0;
            this.isInitialized = false;
            this.logger.info('ExchangeConnectivitySentry shutdown complete');
        } catch (error) {
            this.logger.error('ExchangeConnectivitySentry shutdown error:', error);
        }
    }
}

export default ExchangeConnectivitySentry;
