/**
 * Latency Slip Guard - SG-02
 * Advanced order journey monitoring for latency and slippage protection
 * Generates guard directives based on execution performance metrics
 */

import { EventEmitter } from 'events';

interface OrderJourneyMetrics {
    correlationId: string;
    placeMs: number;
    ackMs: number;
    firstFillMs: number;
    fullFillMs: number;
    slipBps: number;
    side: 'buy' | 'sell';
    symbol: string;
    mode: 'market' | 'limit' | 'post_only';
    timestamp: string;
}

interface QATags {
    tags: string[];
    context?: any;
}

interface PolicySnapshot {
    slippageHardBps: number;
    latencyHardMs: number;
    variants: string[];
}

interface SentryGuardDirective {
    mode: string;
    expiresAt: string;
    reasonCodes: string[];
    source: string;
}

interface CostForecastUpdate {
    symbol: string;
    expectedSlippageBps: number;
    takerRisk: number;
    makerRisk: number;
}

interface LatencySlipGuardDirective {
    mode: 'normal' | 'slowdown' | 'block_aggressive' | 'halt_entry';
    expiresAt: string;
    reasonCodes: string[];
    timestamp: string;
    source: 'latency_slip_guard';
}

interface GuardAdviceComposer {
    prefer: 'limit' | 'post_only' | 'twap';
    maxSlices: number;
    sliceDelayMs: number;
    reasoning: string[];
}

interface LatencySlipMetrics {
    ewma: {
        placeMs: number;
        firstFillMs: number;
        slipBps: number;
        spreadBps: number;
    };
    modeRates: Record<string, number>;
    panicCount: number;
}

interface Config {
    ewmaAlpha: number;
    slowdown: {
        placeMs: number;
        firstFillMs: number;
        slipBps: number;
    };
    blockAggressive: {
        placeMs: number;
        slipBps: number;
    };
    halt: {
        firstFillMs: number;
        slipBps: number;
    };
    decayToNormalSec: number;
    highVolTightenPct: number;
    advice: {
        defaultSlices: number;
        maxSlicesCap: number;
        minDelayMs: number;
    };
    tz: string;
}

class LatencySlipGuard extends EventEmitter {
    private config: Config;
    private logger: any;
    private isInitialized: boolean = false;
    
    // EWMA tracking
    private ewmaPlaceMs: number = 0;
    private ewmaFirstFillMs: number = 0;
    private ewmaSlipBps: number = 0;
    private ewmaSpreadBps: number = 0;
    
    // State tracking
    private currentMode: string = 'normal';
    private modeStartTime: number = Date.now();
    private panicCount: number = 0;
    private modeHistory: Array<{ mode: string; timestamp: number; reasonCodes: string[] }> = [];
    
    // Performance tracking
    private recentJourneys: OrderJourneyMetrics[] = [];
    private sentryMode: string = 'normal';
    private tightenFactors: number = 1.0;
    
    private lastDirective: LatencySlipGuardDirective | null = null;
    private lastAdvice: GuardAdviceComposer | null = null;

    constructor(config: Partial<Config> = {}) {
        super();
        this.config = {
            ewmaAlpha: 0.3,
            slowdown: {
                placeMs: 800,
                firstFillMs: 1500,
                slipBps: 10
            },
            blockAggressive: {
                placeMs: 1200,
                slipBps: 15
            },
            halt: {
                firstFillMs: 3000,
                slipBps: 25
            },
            decayToNormalSec: 180,
            highVolTightenPct: 0.8,
            advice: {
                defaultSlices: 3,
                maxSlicesCap: 8,
                minDelayMs: 200
            },
            tz: "Europe/Istanbul",
            ...config
        };
    }

    async initialize(logger: any): Promise<boolean> {
        try {
            this.logger = logger;
            this.logger.info('LatencySlipGuard initializing...');
            
            this.isInitialized = true;
            this.logger.info('LatencySlipGuard initialized successfully');
            return true;
        } catch (error) {
            this.logger.error('LatencySlipGuard initialization error:', error);
            return false;
        }
    }

    /**
     * Process order journey metrics
     */
    async processOrderJourney(data: OrderJourneyMetrics): Promise<void> {
        if (!this.isInitialized) return;

        try {
            // Update EWMA metrics
            this.updateEWMAMetrics(data);
            
            // Store recent journey
            this.recentJourneys.push(data);
            if (this.recentJourneys.length > 100) {
                this.recentJourneys.shift();
            }

            // Evaluate guard mode
            await this.evaluateGuardMode(data);

            // Generate composer advice
            await this.generateComposerAdvice();

        } catch (error) {
            this.logger.error('LatencySlipGuard journey processing error:', error);
        }
    }

    /**
     * Process QA tags for market conditions
     */
    async processQATags(data: QATags): Promise<void> {
        if (!this.isInitialized) return;

        try {
            // Adjust tighten factors based on market conditions
            this.tightenFactors = 1.0;
            
            if (data.tags.includes('highVol')) {
                this.tightenFactors *= this.config.highVolTightenPct;
            }
            
            if (data.tags.includes('open-bar')) {
                this.tightenFactors *= this.config.highVolTightenPct;
            }

            // Re-evaluate mode with new factors
            await this.evaluateGuardModeFromHistory();

        } catch (error) {
            this.logger.error('LatencySlipGuard QA tags processing error:', error);
        }
    }

    /**
     * Process policy snapshot
     */
    async processPolicySnapshot(data: PolicySnapshot): Promise<void> {
        if (!this.isInitialized) return;

        try {
            // Policy changes might affect thresholds - re-evaluate
            await this.evaluateGuardModeFromHistory();

        } catch (error) {
            this.logger.error('LatencySlipGuard policy processing error:', error);
        }
    }

    /**
     * Process sentry guard directive for coordination
     */
    async processSentryDirective(data: SentryGuardDirective): Promise<void> {
        if (!this.isInitialized) return;

        try {
            this.sentryMode = data.mode;
            
            // If sentry is in panic/halt, we should be more restrictive
            if (data.mode === 'streams_panic' || data.mode === 'halt_entry') {
                await this.forceMode('halt_entry', ['SENTRY_OVERRIDE']);
            }

        } catch (error) {
            this.logger.error('LatencySlipGuard sentry directive processing error:', error);
        }
    }

    private updateEWMAMetrics(journey: OrderJourneyMetrics): void {
        const alpha = this.config.ewmaAlpha;
        
        this.ewmaPlaceMs = alpha * journey.placeMs + (1 - alpha) * this.ewmaPlaceMs;
        this.ewmaFirstFillMs = alpha * journey.firstFillMs + (1 - alpha) * this.ewmaFirstFillMs;
        this.ewmaSlipBps = alpha * journey.slipBps + (1 - alpha) * this.ewmaSlipBps;
        
        // Estimate spread (simplified)
        const estimatedSpread = journey.slipBps * 2; // rough approximation
        this.ewmaSpreadBps = alpha * estimatedSpread + (1 - alpha) * this.ewmaSpreadBps;
    }

    private async evaluateGuardMode(journey?: OrderJourneyMetrics): Promise<void> {
        const thresholds = this.getAdjustedThresholds();
        const newMode = this.determineMode(thresholds);
        
        if (this.shouldChangeMode(newMode)) {
            await this.transitionToMode(newMode);
        }

        // Check for decay to normal
        await this.checkDecayToNormal();
    }

    private async evaluateGuardModeFromHistory(): Promise<void> {
        if (this.recentJourneys.length > 0) {
            const latest = this.recentJourneys[this.recentJourneys.length - 1];
            await this.evaluateGuardMode(latest);
        }
    }

    private getAdjustedThresholds(): any {
        const base = this.config;
        const factor = this.tightenFactors;
        
        return {
            slowdown: {
                placeMs: base.slowdown.placeMs * factor,
                firstFillMs: base.slowdown.firstFillMs * factor,
                slipBps: base.slowdown.slipBps * factor
            },
            blockAggressive: {
                placeMs: base.blockAggressive.placeMs * factor,
                slipBps: base.blockAggressive.slipBps * factor
            },
            halt: {
                firstFillMs: base.halt.firstFillMs * factor,
                slipBps: base.halt.slipBps * factor
            }
        };
    }

    private determineMode(thresholds: any): string {
        // Sentry override
        if (this.sentryMode === 'halt_entry' || this.sentryMode === 'streams_panic') {
            return 'halt_entry';
        }

        // Check halt conditions
        if (this.ewmaFirstFillMs >= thresholds.halt.firstFillMs ||
            this.ewmaSlipBps >= thresholds.halt.slipBps) {
            return 'halt_entry';
        }

        // Check block aggressive conditions
        if (this.ewmaPlaceMs >= thresholds.blockAggressive.placeMs ||
            this.ewmaSlipBps >= thresholds.blockAggressive.slipBps) {
            return 'block_aggressive';
        }

        // Check slowdown conditions
        if (this.ewmaPlaceMs >= thresholds.slowdown.placeMs ||
            this.ewmaFirstFillMs >= thresholds.slowdown.firstFillMs ||
            this.ewmaSlipBps >= thresholds.slowdown.slipBps) {
            return 'slowdown';
        }

        return 'normal';
    }

    private shouldChangeMode(newMode: string): boolean {
        return newMode !== this.currentMode;
    }

    private async transitionToMode(newMode: string): Promise<void> {
        const now = Date.now();
        const reasonCodes = this.generateReasonCodes(newMode);

        this.currentMode = newMode;
        this.modeStartTime = now;

        if (newMode === 'halt_entry') {
            this.panicCount++;
        }

        // Store in history
        this.modeHistory.push({
            mode: newMode,
            timestamp: now,
            reasonCodes: [...reasonCodes]
        });

        if (this.modeHistory.length > 50) {
            this.modeHistory.shift();
        }

        const directive: LatencySlipGuardDirective = {
            mode: newMode as any,
            expiresAt: new Date(now + 300000).toISOString(), // 5 minutes
            reasonCodes,
            timestamp: new Date(now).toISOString(),
            source: 'latency_slip_guard'
        };

        // Avoid duplicate directives
        if (!this.lastDirective || 
            this.lastDirective.mode !== directive.mode ||
            JSON.stringify(this.lastDirective.reasonCodes) !== JSON.stringify(directive.reasonCodes)) {
            
            this.lastDirective = directive;
            this.emit('latency_slip.guard.directive', directive);
            
            this.logger.warn(`LatencySlipGuard mode change: ${newMode}`, {
                reasonCodes,
                ewmaMetrics: {
                    place: this.ewmaPlaceMs,
                    firstFill: this.ewmaFirstFillMs,
                    slip: this.ewmaSlipBps
                }
            });
        }
    }

    private async checkDecayToNormal(): Promise<void> {
        if (this.currentMode === 'normal') return;

        const now = Date.now();
        const modeAge = (now - this.modeStartTime) / 1000;

        if (modeAge >= this.config.decayToNormalSec) {
            // Check if conditions have improved
            const thresholds = this.getAdjustedThresholds();
            
            const isImproved = this.ewmaPlaceMs < thresholds.slowdown.placeMs * 0.8 &&
                              this.ewmaFirstFillMs < thresholds.slowdown.firstFillMs * 0.8 &&
                              this.ewmaSlipBps < thresholds.slowdown.slipBps * 0.8;

            if (isImproved) {
                await this.transitionToMode('normal');
            }
        }
    }

    private generateReasonCodes(mode: string): string[] {
        const codes: string[] = [];
        const thresholds = this.getAdjustedThresholds();

        if (this.sentryMode === 'halt_entry' || this.sentryMode === 'streams_panic') {
            codes.push('SENTRY_OVERRIDE');
        }

        if (this.ewmaPlaceMs >= thresholds.slowdown.placeMs) {
            codes.push('HIGH_PLACE_LATENCY');
        }

        if (this.ewmaFirstFillMs >= thresholds.slowdown.firstFillMs) {
            codes.push('HIGH_FILL_LATENCY');
        }

        if (this.ewmaSlipBps >= thresholds.slowdown.slipBps) {
            codes.push('HIGH_SLIPPAGE');
        }

        if (this.tightenFactors < 1.0) {
            codes.push('HIGH_VOLATILITY_TIGHTENING');
        }

        return codes;
    }

    private async generateComposerAdvice(): Promise<void> {
        const advice = this.calculateComposerAdvice();
        
        if (!this.lastAdvice || 
            this.lastAdvice.prefer !== advice.prefer ||
            this.lastAdvice.maxSlices !== advice.maxSlices) {
            
            this.lastAdvice = advice;
            this.emit('guard.advice.composer', advice);
        }
    }

    private calculateComposerAdvice(): GuardAdviceComposer {
        const baseSlices = this.config.advice.defaultSlices;
        const reasoning: string[] = [];
        let prefer: 'limit' | 'post_only' | 'twap' = 'limit';
        let maxSlices = baseSlices;
        let sliceDelayMs = this.config.advice.minDelayMs;

        switch (this.currentMode) {
            case 'slowdown':
                prefer = 'limit';
                maxSlices = Math.min(this.config.advice.maxSlicesCap, baseSlices + 2);
                sliceDelayMs = this.config.advice.minDelayMs * 1.5;
                reasoning.push('Increased slicing due to slowdown mode');
                break;

            case 'block_aggressive':
                prefer = 'post_only';
                maxSlices = Math.min(this.config.advice.maxSlicesCap, baseSlices + 4);
                sliceDelayMs = this.config.advice.minDelayMs * 2;
                reasoning.push('Post-only preferred due to aggressive blocking');
                break;

            case 'halt_entry':
                prefer = 'twap';
                maxSlices = this.config.advice.maxSlicesCap;
                sliceDelayMs = this.config.advice.minDelayMs * 3;
                reasoning.push('TWAP required due to halt entry mode');
                break;

            default:
                reasoning.push('Normal execution mode');
        }

        if (this.ewmaSlipBps > 5) {
            maxSlices = Math.min(this.config.advice.maxSlicesCap, maxSlices + 1);
            reasoning.push('Additional slicing due to high slippage');
        }

        return {
            prefer,
            maxSlices,
            sliceDelayMs,
            reasoning
        };
    }

    /**
     * Force mode change
     */
    async forceMode(mode: string, reasonCodes: string[] = ['MANUAL_OVERRIDE']): Promise<void> {
        this.currentMode = mode;
        this.modeStartTime = Date.now();
        
        const directive: LatencySlipGuardDirective = {
            mode: mode as any,
            expiresAt: new Date(Date.now() + 300000).toISOString(),
            reasonCodes,
            timestamp: new Date().toISOString(),
            source: 'latency_slip_guard'
        };

        this.emit('latency_slip.guard.directive', directive);
        this.logger.warn(`LatencySlipGuard forced to mode: ${mode}`, { reasonCodes });
    }

    /**
     * Get current metrics
     */
    getMetrics(): LatencySlipMetrics {
        const modeRates: Record<string, number> = {};
        
        // Calculate mode rates from history
        if (this.modeHistory.length > 0) {
            for (const entry of this.modeHistory) {
                modeRates[entry.mode] = (modeRates[entry.mode] || 0) + 1;
            }
            
            const total = this.modeHistory.length;
            for (const mode of Object.keys(modeRates)) {
                modeRates[mode] = modeRates[mode] / total;
            }
        }

        return {
            ewma: {
                placeMs: this.ewmaPlaceMs,
                firstFillMs: this.ewmaFirstFillMs,
                slipBps: this.ewmaSlipBps,
                spreadBps: this.ewmaSpreadBps
            },
            modeRates,
            panicCount: this.panicCount
        };
    }

    /**
     * Get status
     */
    getStatus(): any {
        return {
            name: 'LatencySlipGuard',
            initialized: this.isInitialized,
            currentMode: this.currentMode,
            modeAge: (Date.now() - this.modeStartTime) / 1000,
            tightenFactors: this.tightenFactors,
            sentryMode: this.sentryMode,
            recentJourneys: this.recentJourneys.length,
            panicCount: this.panicCount
        };
    }

    async shutdown(): Promise<void> {
        try {
            this.logger.info('LatencySlipGuard shutting down...');
            this.removeAllListeners();
            this.recentJourneys.length = 0;
            this.modeHistory.length = 0;
            this.isInitialized = false;
            this.logger.info('LatencySlipGuard shutdown complete');
        } catch (error) {
            this.logger.error('LatencySlipGuard shutdown error:', error);
        }
    }
}

export default LatencySlipGuard;
