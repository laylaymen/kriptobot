/**
 * Drawdown Monitor - PFL-04
 * Advanced equity curve monitoring with automatic risk reduction recommendations
 * Provides governance recommendations when drawdown thresholds are breached
 */

import { EventEmitter } from 'events';

interface EquitySnapshot {
    value: number;
    timestamp: string;
    source: 'real' | 'simulated';
}

interface PnLDaily {
    date: string;
    realized: number;
    unrealized: number;
    total: number;
    trades: number;
    winRate: number;
}

interface PortfolioBalancerMetrics {
    totalExposure: number;
    activePositions: number;
    riskUtilization: number;
    leverage: number;
}

interface RiskGovernanceRecommendation {
    type: 'reduce_total_risk' | 'disable_aggressive_variant' | 'halt_new_intents' | 'emergency_close';
    targetRiskPct?: number;
    duration: string; // ISO 8601 duration
    severity: 'info' | 'warn' | 'error' | 'emergency';
    reason: string;
    effectiveAt: string;
    expiresAt: string;
    correlationId: string;
}

interface DrawdownAlert {
    level: 'info' | 'warn' | 'error' | 'emergency';
    currentDD: number;
    maxDD: number;
    duration: number; // days
    equityPeak: number;
    currentEquity: number;
    recommendations: RiskGovernanceRecommendation[];
    timestamp: string;
    recoveryMetrics?: {
        timeToRecovery?: number;
        expectedRecoveryDays?: number;
        probabilityOfRecovery?: number;
    };
}

interface Config {
    windows: {
        lookbackDays: number;
        decay: number;
    };
    ddLevelsR: {
        warn: number;
        error: number;
        emergency: number;
    };
    coolOff: {
        warn: string; // ISO 8601 duration
        error: string;
        emergency: string;
    };
    minEquityHistory: number;
    recoveryBufferPct: number;
}

class DrawdownMonitor extends EventEmitter {
    private config: Config;
    private logger: any;
    private isInitialized: boolean = false;
    private equityHistory: EquitySnapshot[] = [];
    private pnlHistory: PnLDaily[] = [];
    private lastAlerts: Map<string, DrawdownAlert> = new Map();
    private coolOffPeriods: Map<string, Date> = new Map();
    private currentPeak: number = 0;
    private lastDrawdownCalculation: Date = new Date();

    constructor(config: Partial<Config> = {}) {
        super();
        this.config = {
            windows: {
                lookbackDays: 60,
                decay: 0.97
            },
            ddLevelsR: {
                warn: 2.0,
                error: 3.5,
                emergency: 5.0
            },
            coolOff: {
                warn: 'PT2H',    // 2 hours
                error: 'PT24H',  // 24 hours
                emergency: 'PT72H' // 72 hours
            },
            minEquityHistory: 30,
            recoveryBufferPct: 0.05,
            ...config
        };
    }

    async initialize(logger: any): Promise<boolean> {
        try {
            this.logger = logger;
            this.logger.info('DrawdownMonitor initializing...');
            
            this.isInitialized = true;
            this.logger.info('DrawdownMonitor initialized successfully');
            return true;
        } catch (error) {
            this.logger.error('DrawdownMonitor initialization error:', error);
            return false;
        }
    }

    /**
     * Main processing function - monitors equity and generates recommendations
     */
    async process(data: {
        equitySnapshot: EquitySnapshot;
        pnlDaily?: PnLDaily[];
        portfolioBalancerMetrics?: PortfolioBalancerMetrics;
    }): Promise<{
        recommendations: RiskGovernanceRecommendation[];
        alerts: DrawdownAlert[];
        metrics: any;
    }> {
        if (!this.isInitialized) {
            throw new Error('DrawdownMonitor not initialized');
        }

        try {
            // Update equity history
            this.updateEquityHistory(data.equitySnapshot);

            // Update PnL history if provided
            if (data.pnlDaily) {
                this.updatePnLHistory(data.pnlDaily);
            }

            // Clean expired cool-off periods
            this.cleanExpiredCoolOffs();

            // Calculate current drawdown
            const drawdownMetrics = this.calculateDrawdownMetrics();

            // Generate recommendations and alerts
            const recommendations = this.generateRecommendations(drawdownMetrics, data.portfolioBalancerMetrics);
            const alerts = this.generateAlerts(drawdownMetrics, recommendations);

            // Calculate additional metrics
            const metrics = this.calculateMetrics(drawdownMetrics);

            // Emit events
            for (const recommendation of recommendations) {
                this.emit('risk.governance.recommendation', recommendation);
            }

            for (const alert of alerts) {
                this.emit('drawdown.alert', alert);
            }

            this.logger.info(`DrawdownMonitor: Current DD: ${drawdownMetrics.currentDD.toFixed(2)}%, Max DD: ${drawdownMetrics.maxDD.toFixed(2)}%`);
            
            return { recommendations, alerts, metrics };

        } catch (error) {
            this.logger.error('DrawdownMonitor processing error:', error);
            throw error;
        }
    }

    private updateEquityHistory(snapshot: EquitySnapshot): void {
        this.equityHistory.push(snapshot);

        // Update peak
        if (snapshot.value > this.currentPeak) {
            this.currentPeak = snapshot.value;
        }

        // Maintain window size
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - this.config.windows.lookbackDays);

        this.equityHistory = this.equityHistory.filter(entry => 
            new Date(entry.timestamp) > cutoffDate
        );
    }

    private updatePnLHistory(pnlData: PnLDaily[]): void {
        for (const entry of pnlData) {
            const existingIndex = this.pnlHistory.findIndex(p => p.date === entry.date);
            if (existingIndex >= 0) {
                this.pnlHistory[existingIndex] = entry;
            } else {
                this.pnlHistory.push(entry);
            }
        }

        // Sort by date and maintain window
        this.pnlHistory.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
        
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - this.config.windows.lookbackDays);

        this.pnlHistory = this.pnlHistory.filter(entry => 
            new Date(entry.date) > cutoffDate
        );
    }

    private cleanExpiredCoolOffs(): void {
        const now = new Date();
        for (const [level, expiry] of this.coolOffPeriods.entries()) {
            if (now > expiry) {
                this.coolOffPeriods.delete(level);
            }
        }
    }

    private calculateDrawdownMetrics(): {
        currentDD: number;
        maxDD: number;
        ddDuration: number;
        peak: number;
        trough: number;
        currentEquity: number;
        timeInDD: number;
        recoveryFactor: number;
    } {
        if (this.equityHistory.length < this.config.minEquityHistory) {
            return {
                currentDD: 0,
                maxDD: 0,
                ddDuration: 0,
                peak: this.currentPeak,
                trough: this.currentPeak,
                currentEquity: this.currentPeak,
                timeInDD: 0,
                recoveryFactor: 1
            };
        }

        const currentEquity = this.equityHistory[this.equityHistory.length - 1].value;
        const currentDD = ((this.currentPeak - currentEquity) / this.currentPeak) * 100;

        // Calculate maximum drawdown over the period
        let maxDD = 0;
        let peak = 0;
        let trough = Infinity;
        let ddStartTime: Date | null = null;

        for (const snapshot of this.equityHistory) {
            if (snapshot.value > peak) {
                peak = snapshot.value;
                // Reset drawdown tracking
                if (ddStartTime) {
                    ddStartTime = null;
                }
            } else {
                const dd = ((peak - snapshot.value) / peak) * 100;
                if (dd > maxDD) {
                    maxDD = dd;
                    trough = snapshot.value;
                }
                
                if (!ddStartTime && dd > 0) {
                    ddStartTime = new Date(snapshot.timestamp);
                }
            }
        }

        // Calculate drawdown duration
        const ddDuration = ddStartTime ? 
            (Date.now() - ddStartTime.getTime()) / (1000 * 60 * 60 * 24) : 0;

        // Calculate time in drawdown (days in DD state)
        let timeInDD = 0;
        let inDD = false;
        let ddStart: Date | null = null;

        for (let i = 1; i < this.equityHistory.length; i++) {
            const prevValue = this.equityHistory[i - 1].value;
            const currentValue = this.equityHistory[i].value;
            
            if (currentValue < prevValue && !inDD) {
                inDD = true;
                ddStart = new Date(this.equityHistory[i].timestamp);
            } else if (currentValue >= prevValue * (1 + this.config.recoveryBufferPct) && inDD && ddStart) {
                inDD = false;
                timeInDD += (new Date(this.equityHistory[i].timestamp).getTime() - ddStart.getTime()) / (1000 * 60 * 60 * 24);
                ddStart = null;
            }
        }

        // If still in drawdown
        if (inDD && ddStart) {
            timeInDD += (Date.now() - ddStart.getTime()) / (1000 * 60 * 60 * 24);
        }

        // Recovery factor (how much equity needs to recover)
        const recoveryFactor = this.currentPeak / currentEquity;

        return {
            currentDD,
            maxDD,
            ddDuration,
            peak: this.currentPeak,
            trough,
            currentEquity,
            timeInDD,
            recoveryFactor
        };
    }

    private generateRecommendations(
        ddMetrics: any,
        portfolioMetrics?: PortfolioBalancerMetrics
    ): RiskGovernanceRecommendation[] {
        const recommendations: RiskGovernanceRecommendation[] = [];
        const { currentDD } = ddMetrics;
        const { ddLevelsR, coolOff } = this.config;

        // Check cool-off periods
        const now = new Date();

        // Emergency level (5.0R+)
        if (currentDD >= ddLevelsR.emergency && !this.coolOffPeriods.has('emergency')) {
            recommendations.push({
                type: 'emergency_close',
                duration: coolOff.emergency,
                severity: 'emergency',
                reason: `Critical drawdown: ${currentDD.toFixed(2)}% (≥${ddLevelsR.emergency}R)`,
                effectiveAt: now.toISOString(),
                expiresAt: this.addDuration(now, coolOff.emergency).toISOString(),
                correlationId: `emergency_${Date.now()}`
            });

            this.coolOffPeriods.set('emergency', this.addDuration(now, coolOff.emergency));
        }

        // Error level (3.5R+)
        else if (currentDD >= ddLevelsR.error && !this.coolOffPeriods.has('error')) {
            recommendations.push({
                type: 'reduce_total_risk',
                targetRiskPct: 1.2,
                duration: coolOff.error,
                severity: 'error',
                reason: `Significant drawdown: ${currentDD.toFixed(2)}% (≥${ddLevelsR.error}R)`,
                effectiveAt: now.toISOString(),
                expiresAt: this.addDuration(now, coolOff.error).toISOString(),
                correlationId: `error_${Date.now()}`
            });

            recommendations.push({
                type: 'disable_aggressive_variant',
                duration: 'PT4H',
                severity: 'error',
                reason: 'Disable aggressive strategies during significant drawdown',
                effectiveAt: now.toISOString(),
                expiresAt: this.addDuration(now, 'PT4H').toISOString(),
                correlationId: `error_variant_${Date.now()}`
            });

            this.coolOffPeriods.set('error', this.addDuration(now, coolOff.error));
        }

        // Warning level (2.0R+)
        else if (currentDD >= ddLevelsR.warn && !this.coolOffPeriods.has('warn')) {
            recommendations.push({
                type: 'reduce_total_risk',
                targetRiskPct: 1.8,
                duration: coolOff.warn,
                severity: 'warn',
                reason: `Moderate drawdown: ${currentDD.toFixed(2)}% (≥${ddLevelsR.warn}R)`,
                effectiveAt: now.toISOString(),
                expiresAt: this.addDuration(now, coolOff.warn).toISOString(),
                correlationId: `warn_${Date.now()}`
            });

            recommendations.push({
                type: 'halt_new_intents',
                duration: 'PT20M',
                severity: 'warn',
                reason: 'Temporary halt on new positions during drawdown',
                effectiveAt: now.toISOString(),
                expiresAt: this.addDuration(now, 'PT20M').toISOString(),
                correlationId: `warn_halt_${Date.now()}`
            });

            this.coolOffPeriods.set('warn', this.addDuration(now, coolOff.warn));
        }

        return recommendations;
    }

    private generateAlerts(ddMetrics: any, recommendations: RiskGovernanceRecommendation[]): DrawdownAlert[] {
        const alerts: DrawdownAlert[] = [];
        const { currentDD, maxDD, ddDuration } = ddMetrics;
        const { ddLevelsR } = this.config;

        let alertLevel: 'info' | 'warn' | 'error' | 'emergency' = 'info';

        if (currentDD >= ddLevelsR.emergency) {
            alertLevel = 'emergency';
        } else if (currentDD >= ddLevelsR.error) {
            alertLevel = 'error';
        } else if (currentDD >= ddLevelsR.warn) {
            alertLevel = 'warn';
        }

        if (currentDD > 0 || recommendations.length > 0) {
            const alert: DrawdownAlert = {
                level: alertLevel,
                currentDD,
                maxDD,
                duration: ddDuration,
                equityPeak: ddMetrics.peak,
                currentEquity: ddMetrics.currentEquity,
                recommendations,
                timestamp: new Date().toISOString(),
                recoveryMetrics: this.calculateRecoveryMetrics(ddMetrics)
            };

            alerts.push(alert);
            this.lastAlerts.set(alertLevel, alert);
        }

        return alerts;
    }

    private calculateRecoveryMetrics(ddMetrics: any): any {
        if (this.pnlHistory.length < 10) {
            return undefined;
        }

        // Calculate average daily return
        const dailyReturns = this.pnlHistory.map(p => p.total / ddMetrics.currentEquity);
        const avgDailyReturn = dailyReturns.reduce((sum, r) => sum + r, 0) / dailyReturns.length;

        if (avgDailyReturn <= 0) {
            return {
                timeToRecovery: Infinity,
                expectedRecoveryDays: Infinity,
                probabilityOfRecovery: 0.1
            };
        }

        // Calculate days needed to recover
        const recoveryAmount = ddMetrics.peak - ddMetrics.currentEquity;
        const expectedRecoveryDays = recoveryAmount / (ddMetrics.currentEquity * avgDailyReturn);

        // Calculate probability based on win rate and return consistency
        const avgWinRate = this.pnlHistory.reduce((sum, p) => sum + p.winRate, 0) / this.pnlHistory.length;
        const returnStdDev = this.calculateStandardDeviation(dailyReturns);
        const sharpeRatio = avgDailyReturn / returnStdDev;
        
        let probabilityOfRecovery = Math.min(0.95, Math.max(0.05, avgWinRate * (1 + sharpeRatio * 0.1)));

        return {
            timeToRecovery: ddMetrics.timeInDD,
            expectedRecoveryDays: Math.max(1, expectedRecoveryDays),
            probabilityOfRecovery
        };
    }

    private calculateStandardDeviation(values: number[]): number {
        const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
        const squaredDiffs = values.map(val => Math.pow(val - mean, 2));
        const variance = squaredDiffs.reduce((sum, val) => sum + val, 0) / values.length;
        return Math.sqrt(variance);
    }

    private calculateMetrics(ddMetrics: any): any {
        return {
            drawdownMetrics: ddMetrics,
            equityHistoryLength: this.equityHistory.length,
            pnlHistoryLength: this.pnlHistory.length,
            activeCoolOffs: Array.from(this.coolOffPeriods.keys()),
            lastCalculation: this.lastDrawdownCalculation.toISOString(),
            peak: this.currentPeak,
            alertsCount: this.lastAlerts.size
        };
    }

    private addDuration(date: Date, duration: string): Date {
        const result = new Date(date);
        
        // Parse ISO 8601 duration (simplified)
        if (duration.startsWith('PT')) {
            const hours = duration.match(/(\d+)H/);
            const minutes = duration.match(/(\d+)M/);
            
            if (hours) {
                result.setHours(result.getHours() + parseInt(hours[1]));
            }
            if (minutes) {
                result.setMinutes(result.getMinutes() + parseInt(minutes[1]));
            }
        } else if (duration.startsWith('P')) {
            const days = duration.match(/(\d+)D/);
            if (days) {
                result.setDate(result.getDate() + parseInt(days[1]));
            }
        }
        
        return result;
    }

    /**
     * Get current drawdown status
     */
    getCurrentDrawdown(): any {
        return this.calculateDrawdownMetrics();
    }

    /**
     * Get recent alerts
     */
    getRecentAlerts(level?: string): DrawdownAlert[] {
        if (level) {
            const alert = this.lastAlerts.get(level);
            return alert ? [alert] : [];
        }
        return Array.from(this.lastAlerts.values());
    }

    /**
     * Force reset peak (for testing or manual intervention)
     */
    resetPeak(newPeak?: number): void {
        if (newPeak) {
            this.currentPeak = newPeak;
        } else if (this.equityHistory.length > 0) {
            this.currentPeak = this.equityHistory[this.equityHistory.length - 1].value;
        }
        
        this.logger.warn(`Peak reset to: ${this.currentPeak}`);
    }

    /**
     * Check if cool-off period is active
     */
    isCoolOffActive(level: string): boolean {
        return this.coolOffPeriods.has(level);
    }

    /**
     * Get module status
     */
    getStatus(): any {
        return {
            name: 'DrawdownMonitor',
            initialized: this.isInitialized,
            config: this.config,
            equityHistoryLength: this.equityHistory.length,
            pnlHistoryLength: this.pnlHistory.length,
            currentPeak: this.currentPeak,
            activeCoolOffs: Array.from(this.coolOffPeriods.keys()),
            lastAlerts: Array.from(this.lastAlerts.keys())
        };
    }

    async shutdown(): Promise<void> {
        try {
            this.logger.info('DrawdownMonitor shutting down...');
            this.removeAllListeners();
            this.equityHistory.length = 0;
            this.pnlHistory.length = 0;
            this.lastAlerts.clear();
            this.coolOffPeriods.clear();
            this.isInitialized = false;
            this.logger.info('DrawdownMonitor shutdown complete');
        } catch (error) {
            this.logger.error('DrawdownMonitor shutdown error:', error);
        }
    }
}

export default DrawdownMonitor;
