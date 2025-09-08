/**
 * Portfolio Exposure Balancer - PFL-01
 * Advanced portfolio risk management and exposure balancing system
 * Enforces risk ceilings across global/cluster/symbol levels
 */

import { EventEmitter } from 'events';

interface PolicySnapshot {
    riskPerTradePct: number;
    totalRiskPct: number;
    clusterCaps: Record<string, number>;
    symbolCaps: Record<string, number>;
}

interface UniverseSnapshot {
    allowedSymbols: string[];
    blockedSymbols: string[];
    experimentalSymbols: string[];
}

interface Position {
    symbol: string;
    notional: number;
    side: 'long' | 'short';
    cluster: string;
    riskPct: number;
}

interface PositionsSnapshot {
    positions: Position[];
    totalEquity: number;
}

interface StrategySelection {
    decision: string;
    trafficPlan: Record<string, number>;
}

interface DominanceShiftSignal {
    cluster: string;
    direction: 'increase' | 'decrease';
    magnitude: number;
}

interface BalanceAction {
    type: 'scale_symbol' | 'scale_cluster' | 'defer_new' | 'close_rebalance';
    symbol?: string;
    cluster?: string;
    toRiskPct?: number;
    qty?: number;
    scope?: 'cluster' | 'symbol';
}

interface BalanceDirective {
    correlationId: string;
    actions: BalanceAction[];
    mode: 'soft' | 'hard';
    reasonCodes: string[];
    effectiveAt: string;
    timestamp: string;
}

interface BalancerMetrics {
    applicationRates: Record<string, number>;
    deferrals: number;
    breaches: Record<string, number>;
    lastRebalance: string;
}

interface Config {
    ewmaHalfLifeMin: number;
    graceForNewMs: number;
    minScaleStep: number;
    deferTtlSec: number;
    violationHysteresisBps: number;
    tz: string;
}

class PortfolioExposureBalancer extends EventEmitter {
    private config: Config;
    private logger: any;
    private isInitialized: boolean = false;
    private lastDirectives: Map<string, string> = new Map();
    private ewmaRisks: Map<string, number> = new Map();
    private deferredItems: Map<string, number> = new Map(); // symbol/cluster -> expiry timestamp

    constructor(config: Partial<Config> = {}) {
        super();
        this.config = {
            ewmaHalfLifeMin: 10,
            graceForNewMs: 60000,
            minScaleStep: 0.1,
            deferTtlSec: 180,
            violationHysteresisBps: 5,
            tz: "Europe/Istanbul",
            ...config
        };
    }

    async initialize(logger: any): Promise<boolean> {
        try {
            this.logger = logger;
            this.logger.info('PortfolioExposureBalancer initializing...');
            
            this.isInitialized = true;
            this.logger.info('PortfolioExposureBalancer initialized successfully');
            return true;
        } catch (error) {
            this.logger.error('PortfolioExposureBalancer initialization error:', error);
            return false;
        }
    }

    /**
     * Main processing function - analyzes portfolio exposure and generates balance directives
     */
    async process(data: {
        policySnapshot: PolicySnapshot;
        universeSnapshot?: UniverseSnapshot;
        positionsSnapshot: PositionsSnapshot;
        strategySelection?: StrategySelection;
        dominanceShiftSignal?: DominanceShiftSignal;
    }): Promise<BalanceDirective> {
        if (!this.isInitialized) {
            throw new Error('PortfolioExposureBalancer not initialized');
        }

        try {
            const timestamp = new Date().toISOString();
            const correlationId = this.generateCorrelationId(data);

            // Check if we already processed this exact data (idempotency)
            if (this.lastDirectives.has(correlationId)) {
                this.logger.debug('Duplicate processing request, returning cached directive');
                return JSON.parse(this.lastDirectives.get(correlationId)!);
            }

            // Clean expired deferrals
            this.cleanExpiredDeferrals();

            // Calculate current exposures
            const exposures = this.calculateExposures(data.positionsSnapshot, data.policySnapshot);

            // Generate balance actions
            const actions = this.generateBalanceActions(
                exposures,
                data.policySnapshot,
                data.universeSnapshot,
                data.dominanceShiftSignal
            );

            // Determine mode and reason codes
            const { mode, reasonCodes } = this.determineDirectiveMode(actions, exposures);

            const directive: BalanceDirective = {
                correlationId,
                actions,
                mode,
                reasonCodes,
                effectiveAt: new Date(Date.now() + this.config.graceForNewMs).toISOString(),
                timestamp
            };

            // Cache directive for idempotency
            this.lastDirectives.set(correlationId, JSON.stringify(directive));

            // Generate metrics
            const metrics = this.generateMetrics(actions, exposures);

            // Emit events
            this.emit('portfolio.balance.directive', directive);
            this.emit('portfolio.balancer.metrics', metrics);

            this.logger.info(`PortfolioExposureBalancer generated directive with ${actions.length} actions`);
            return directive;

        } catch (error) {
            this.logger.error('PortfolioExposureBalancer processing error:', error);
            throw error;
        }
    }

    private generateCorrelationId(data: any): string {
        const hash = require('crypto')
            .createHash('md5')
            .update(JSON.stringify(data))
            .digest('hex');
        return `peb_${hash.substring(0, 8)}`;
    }

    private cleanExpiredDeferrals(): void {
        const now = Date.now();
        for (const [key, expiry] of this.deferredItems.entries()) {
            if (now > expiry) {
                this.deferredItems.delete(key);
            }
        }
    }

    private calculateExposures(positions: PositionsSnapshot, policy: PolicySnapshot): {
        totalRisk: number;
        clusterRisks: Record<string, number>;
        symbolRisks: Record<string, number>;
    } {
        const clusterRisks: Record<string, number> = {};
        const symbolRisks: Record<string, number> = {};
        let totalRisk = 0;

        for (const position of positions.positions) {
            const riskPct = (position.notional / positions.totalEquity) * 100;
            
            totalRisk += riskPct;
            symbolRisks[position.symbol] = (symbolRisks[position.symbol] || 0) + riskPct;
            clusterRisks[position.cluster] = (clusterRisks[position.cluster] || 0) + riskPct;

            // Update EWMA risks
            this.updateEwmaRisk(position.symbol, riskPct);
            this.updateEwmaRisk(`cluster_${position.cluster}`, riskPct);
        }

        return { totalRisk, clusterRisks, symbolRisks };
    }

    private updateEwmaRisk(key: string, currentRisk: number): void {
        const alpha = 1 - Math.exp(-Math.log(2) / this.config.ewmaHalfLifeMin);
        const previousRisk = this.ewmaRisks.get(key) || 0;
        const ewmaRisk = alpha * currentRisk + (1 - alpha) * previousRisk;
        this.ewmaRisks.set(key, ewmaRisk);
    }

    private generateBalanceActions(
        exposures: any,
        policy: PolicySnapshot,
        universe?: UniverseSnapshot,
        dominanceShift?: DominanceShiftSignal
    ): BalanceAction[] {
        const actions: BalanceAction[] = [];
        const hysteresisBps = this.config.violationHysteresisBps;

        // Check total risk violation
        if (exposures.totalRisk > policy.totalRiskPct * (1 + hysteresisBps / 10000)) {
            actions.push({
                type: 'scale_cluster',
                cluster: 'all',
                toRiskPct: policy.totalRiskPct * 0.9
            });
        }

        // Check cluster caps
        for (const [cluster, currentRisk] of Object.entries(exposures.clusterRisks)) {
            const cap = policy.clusterCaps[cluster];
            const riskValue = typeof currentRisk === 'number' ? currentRisk : 0;
            if (cap && riskValue > cap * (1 + hysteresisBps / 10000)) {
                actions.push({
                    type: 'scale_cluster',
                    cluster,
                    toRiskPct: cap * 0.95
                });
            }
        }

        // Check symbol caps
        for (const [symbol, currentRisk] of Object.entries(exposures.symbolRisks)) {
            const cap = policy.symbolCaps[symbol];
            const riskValue = typeof currentRisk === 'number' ? currentRisk : 0;
            if (cap && riskValue > cap * (1 + hysteresisBps / 10000)) {
                actions.push({
                    type: 'scale_symbol',
                    symbol,
                    toRiskPct: cap * 0.95
                });
            }

            // Handle experimental symbols
            if (universe?.experimentalSymbols.includes(symbol)) {
                const targetRisk = riskValue * 0.5;
                actions.push({
                    type: 'scale_symbol',
                    symbol,
                    toRiskPct: targetRisk
                });
            }
        }

        // Handle dominance shift signals
        if (dominanceShift) {
            const currentClusterRisk = exposures.clusterRisks[dominanceShift.cluster] || 0;
            const multiplier = dominanceShift.direction === 'decrease' ? 0.8 : 1.2;
            const newTargetRisk = currentClusterRisk * multiplier * dominanceShift.magnitude;

            actions.push({
                type: 'scale_cluster',
                cluster: dominanceShift.cluster,
                toRiskPct: newTargetRisk
            });
        }

        // Add deferrals for blocked symbols
        if (universe?.blockedSymbols) {
            for (const symbol of universe.blockedSymbols) {
                actions.push({
                    type: 'defer_new',
                    scope: 'symbol',
                    symbol
                });
                
                const expiryTime = Date.now() + (this.config.deferTtlSec * 1000);
                this.deferredItems.set(symbol, expiryTime);
            }
        }

        return actions;
    }

    private determineDirectiveMode(actions: BalanceAction[], exposures: any): {
        mode: 'soft' | 'hard';
        reasonCodes: string[];
    } {
        const reasonCodes: string[] = [];
        let mode: 'soft' | 'hard' = 'soft';

        // Determine severity based on violations
        const hasEmergencyViolation = actions.some(action => 
            action.type === 'scale_cluster' && action.cluster === 'all'
        );

        const hasClusterViolation = actions.some(action => 
            action.type === 'scale_cluster' && action.cluster !== 'all'
        );

        const hasSymbolViolation = actions.some(action => 
            action.type === 'scale_symbol'
        );

        if (hasEmergencyViolation) {
            mode = 'hard';
            reasonCodes.push('TOTAL_RISK_BREACH');
        }

        if (hasClusterViolation) {
            reasonCodes.push('CLUSTER_CAP_BREACH');
        }

        if (hasSymbolViolation) {
            reasonCodes.push('SYMBOL_CAP_BREACH');
        }

        if (actions.some(a => a.type === 'defer_new')) {
            reasonCodes.push('UNIVERSE_RESTRICTION');
        }

        return { mode, reasonCodes };
    }

    private generateMetrics(actions: BalanceAction[], exposures: any): BalancerMetrics {
        const applicationRates: Record<string, number> = {};
        let deferrals = 0;
        const breaches: Record<string, number> = {};

        for (const action of actions) {
            if (action.type === 'defer_new') {
                deferrals++;
            } else if (action.type.startsWith('scale_')) {
                const scope = action.cluster || action.symbol || 'unknown';
                breaches[scope] = (breaches[scope] || 0) + 1;
            }
        }

        // Calculate application rates (simplified)
        applicationRates['total'] = actions.length > 0 ? 1.0 : 0.0;

        return {
            applicationRates,
            deferrals,
            breaches,
            lastRebalance: new Date().toISOString()
        };
    }

    /**
     * Get current balance status
     */
    getStatus(): any {
        return {
            name: 'PortfolioExposureBalancer',
            initialized: this.isInitialized,
            config: this.config,
            cachedDirectives: this.lastDirectives.size,
            activeDeferrals: this.deferredItems.size,
            ewmaRisks: Object.fromEntries(this.ewmaRisks)
        };
    }

    /**
     * Get latest balance directive
     */
    getLatestDirective(correlationId?: string): BalanceDirective | null {
        if (correlationId && this.lastDirectives.has(correlationId)) {
            return JSON.parse(this.lastDirectives.get(correlationId)!);
        }
        
        // Return most recent directive
        const entries = Array.from(this.lastDirectives.entries());
        if (entries.length > 0) {
            return JSON.parse(entries[entries.length - 1][1]);
        }
        
        return null;
    }

    /**
     * Manual override for emergency situations
     */
    async emergencyRebalance(targetRiskPct: number): Promise<BalanceDirective> {
        const emergency: BalanceDirective = {
            correlationId: `emergency_${Date.now()}`,
            actions: [{
                type: 'scale_cluster',
                cluster: 'all',
                toRiskPct: targetRiskPct
            }],
            mode: 'hard',
            reasonCodes: ['EMERGENCY_OVERRIDE'],
            effectiveAt: new Date().toISOString(),
            timestamp: new Date().toISOString()
        };

        this.emit('portfolio.balance.directive', emergency);
        this.logger.warn(`Emergency rebalance triggered: ${targetRiskPct}%`);
        
        return emergency;
    }

    async shutdown(): Promise<void> {
        try {
            this.logger.info('PortfolioExposureBalancer shutting down...');
            this.removeAllListeners();
            this.lastDirectives.clear();
            this.ewmaRisks.clear();
            this.deferredItems.clear();
            this.isInitialized = false;
            this.logger.info('PortfolioExposureBalancer shutdown complete');
        } catch (error) {
            this.logger.error('PortfolioExposureBalancer shutdown error:', error);
        }
    }
}

export default PortfolioExposureBalancer;
