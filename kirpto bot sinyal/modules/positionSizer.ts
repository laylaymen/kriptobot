/**
 * Position Sizer - PFL-03
 * Advanced position sizing system based on risk, volatility and plan parameters
 * Guides composer's quantity decisions with sophisticated risk management
 */

import { EventEmitter } from 'events';

interface PolicySnapshot {
    riskPerTradePct: number;
    slippageHardBps: number;
    maxLeverage: number;
    minPositionUSD: number;
}

interface MarketVolatilitySnapshot {
    [symbol: string]: {
        atr: number;
        atrBps: number;
        volatilityScore: number;
        timestamp: string;
    };
}

interface OrderPlan {
    correlationId: string;
    symbol: string;
    side: 'long' | 'short';
    entryPrice: number;
    stopLoss: number;
    takeProfit: number;
    entryMode: 'market' | 'limit' | 'gradual';
    slDistanceBps: number;
    tpDistanceBps: number;
}

interface FeesSchedule {
    [symbol: string]: {
        takerBps: number;
        makerBps: number;
        minFeeUSD: number;
    };
}

interface CostForecast {
    symbol: string;
    expectedSlippageBps: number;
    liquidityScore: number;
    impactWarning: boolean;
}

interface PositionSizeSuggestion {
    correlationId: string;
    symbol: string;
    riskUnitUSD: number;
    qty: number;
    maxNotional: number;
    reasonCodes: string[];
    scalingFactors: {
        volatilityAdjustment: number;
        slippageAdjustment: number;
        leverageConstraint: number;
        minQtyConstraint: number;
    };
    confidence: number;
    warnings: string[];
    timestamp: string;
}

interface Config {
    riskPerTradePct: number;
    maxLeverage: number;
    minQty: number;
    volFloorBps: number;
    slDistanceClampBps: {
        min: number;
        max: number;
    };
    gradualFillReduction: number;
    highVolThresholdBps: number;
    maxSlippageToleranceBps: number;
}

class PositionSizer extends EventEmitter {
    private config: Config;
    private logger: any;
    private isInitialized: boolean = false;
    private lastSuggestions: Map<string, PositionSizeSuggestion> = new Map();
    private equityHistory: number[] = [];

    constructor(config: Partial<Config> = {}) {
        super();
        this.config = {
            riskPerTradePct: 0.5,
            maxLeverage: 5,
            minQty: 0.001,
            volFloorBps: 20,
            slDistanceClampBps: {
                min: 25,
                max: 300
            },
            gradualFillReduction: 0.15,
            highVolThresholdBps: 150,
            maxSlippageToleranceBps: 50,
            ...config
        };
    }

    async initialize(logger: any): Promise<boolean> {
        try {
            this.logger = logger;
            this.logger.info('PositionSizer initializing...');
            
            this.isInitialized = true;
            this.logger.info('PositionSizer initialized successfully');
            return true;
        } catch (error) {
            this.logger.error('PositionSizer initialization error:', error);
            return false;
        }
    }

    /**
     * Main processing function - calculates optimal position size
     */
    async process(data: {
        policySnapshot: PolicySnapshot;
        marketVolatilitySnapshot: MarketVolatilitySnapshot;
        orderPlan: OrderPlan;
        feesSchedule: FeesSchedule;
        costForecast?: CostForecast;
        currentEquity: number;
    }): Promise<PositionSizeSuggestion> {
        if (!this.isInitialized) {
            throw new Error('PositionSizer not initialized');
        }

        try {
            const { orderPlan, policySnapshot, marketVolatilitySnapshot, feesSchedule, costForecast, currentEquity } = data;
            
            // Update equity history
            this.equityHistory.push(currentEquity);
            if (this.equityHistory.length > 100) {
                this.equityHistory.shift();
            }

            // Calculate base risk unit
            const effectiveRiskPct = policySnapshot.riskPerTradePct || this.config.riskPerTradePct;
            const riskUnitUSD = currentEquity * (effectiveRiskPct / 100);

            // Get market volatility data
            const volData = marketVolatilitySnapshot[orderPlan.symbol];
            if (!volData) {
                throw new Error(`No volatility data available for ${orderPlan.symbol}`);
            }

            // Clamp stop loss distance
            const clampedSLBps = this.clampStopLossDistance(orderPlan.slDistanceBps);

            // Calculate base position size
            const basePositionSize = this.calculateBasePositionSize(
                riskUnitUSD,
                orderPlan.entryPrice,
                clampedSLBps
            );

            // Apply scaling factors
            const scalingFactors = this.calculateScalingFactors(
                orderPlan,
                volData,
                feesSchedule[orderPlan.symbol],
                costForecast,
                policySnapshot
            );

            // Calculate final quantity
            const adjustedQty = this.applyScalingFactors(basePositionSize, scalingFactors);

            // Apply constraints
            const finalQty = this.applyConstraints(
                adjustedQty,
                orderPlan,
                policySnapshot,
                currentEquity
            );

            // Calculate max notional
            const maxNotional = finalQty * orderPlan.entryPrice;

            // Generate reason codes and warnings
            const { reasonCodes, warnings, confidence } = this.generateReasoningAndWarnings(
                scalingFactors,
                volData,
                orderPlan,
                costForecast
            );

            const suggestion: PositionSizeSuggestion = {
                correlationId: orderPlan.correlationId,
                symbol: orderPlan.symbol,
                riskUnitUSD,
                qty: finalQty,
                maxNotional,
                reasonCodes,
                scalingFactors,
                confidence,
                warnings,
                timestamp: new Date().toISOString()
            };

            // Cache suggestion
            this.lastSuggestions.set(orderPlan.correlationId, suggestion);

            // Emit event
            this.emit('position.size.suggestion', suggestion);

            this.logger.info(`PositionSizer calculated size for ${orderPlan.symbol}: ${finalQty} (${maxNotional.toFixed(2)} USD)`);
            return suggestion;

        } catch (error) {
            this.logger.error('PositionSizer processing error:', error);
            throw error;
        }
    }

    private clampStopLossDistance(slDistanceBps: number): number {
        const { min, max } = this.config.slDistanceClampBps;
        
        if (slDistanceBps < min) {
            return min;
        }
        
        if (slDistanceBps > max) {
            return max;
        }
        
        return slDistanceBps;
    }

    private calculateBasePositionSize(riskUnitUSD: number, entryPrice: number, slDistanceBps: number): number {
        // Position size = Risk USD / (Entry Price * SL Distance %)
        const slDistanceDecimal = slDistanceBps / 10000;
        const riskPerShare = entryPrice * slDistanceDecimal;
        
        if (riskPerShare <= 0) {
            throw new Error('Invalid risk per share calculation');
        }
        
        return riskUnitUSD / riskPerShare;
    }

    private calculateScalingFactors(
        orderPlan: OrderPlan,
        volData: any,
        feeData: any,
        costForecast?: CostForecast,
        policy?: PolicySnapshot
    ): any {
        const factors = {
            volatilityAdjustment: 1.0,
            slippageAdjustment: 1.0,
            leverageConstraint: 1.0,
            minQtyConstraint: 1.0
        };

        // Volatility adjustment
        const volBps = Math.max(volData.atrBps, this.config.volFloorBps);
        if (volBps > this.config.highVolThresholdBps) {
            factors.volatilityAdjustment = 0.8; // Reduce size in high volatility
        } else if (volBps < 50) {
            factors.volatilityAdjustment = 1.1; // Slightly increase in low volatility
        }

        // Slippage adjustment
        if (orderPlan.entryMode === 'market') {
            const expectedSlippage = costForecast?.expectedSlippageBps || 10;
            if (expectedSlippage > this.config.maxSlippageToleranceBps) {
                factors.slippageAdjustment = 1 - this.config.gradualFillReduction;
            }
        }

        // Entry mode adjustment
        if (orderPlan.entryMode === 'gradual') {
            factors.slippageAdjustment *= (1 - this.config.gradualFillReduction);
        }

        return factors;
    }

    private applyScalingFactors(baseSize: number, factors: any): number {
        let adjustedSize = baseSize;
        
        adjustedSize *= factors.volatilityAdjustment;
        adjustedSize *= factors.slippageAdjustment;
        adjustedSize *= factors.leverageConstraint;
        adjustedSize *= factors.minQtyConstraint;
        
        return adjustedSize;
    }

    private applyConstraints(
        qty: number,
        orderPlan: OrderPlan,
        policy: PolicySnapshot,
        currentEquity: number
    ): number {
        let constrainedQty = qty;

        // Minimum quantity constraint
        if (constrainedQty < this.config.minQty) {
            constrainedQty = this.config.minQty;
        }

        // Maximum leverage constraint
        const notionalValue = constrainedQty * orderPlan.entryPrice;
        const maxNotionalByLeverage = currentEquity * this.config.maxLeverage;
        
        if (notionalValue > maxNotionalByLeverage) {
            constrainedQty = maxNotionalByLeverage / orderPlan.entryPrice;
        }

        // Policy maximum leverage
        if (policy.maxLeverage && policy.maxLeverage < this.config.maxLeverage) {
            const policyMaxNotional = currentEquity * policy.maxLeverage;
            if (notionalValue > policyMaxNotional) {
                constrainedQty = policyMaxNotional / orderPlan.entryPrice;
            }
        }

        // Minimum position value
        const minPositionUSD = policy.minPositionUSD || 10;
        const minQtyByValue = minPositionUSD / orderPlan.entryPrice;
        
        if (constrainedQty < minQtyByValue) {
            constrainedQty = minQtyByValue;
        }

        return Math.max(constrainedQty, 0);
    }

    private generateReasoningAndWarnings(
        scalingFactors: any,
        volData: any,
        orderPlan: OrderPlan,
        costForecast?: CostForecast
    ): { reasonCodes: string[]; warnings: string[]; confidence: number } {
        const reasonCodes: string[] = [];
        const warnings: string[] = [];
        let confidence = 1.0;

        // Volatility reasons
        if (scalingFactors.volatilityAdjustment < 1.0) {
            reasonCodes.push('HIGH_VOLATILITY_REDUCTION');
            warnings.push(`High volatility detected: ${volData.atrBps}bps`);
            confidence *= 0.9;
        } else if (scalingFactors.volatilityAdjustment > 1.0) {
            reasonCodes.push('LOW_VOLATILITY_INCREASE');
        }

        // Slippage reasons
        if (scalingFactors.slippageAdjustment < 1.0) {
            reasonCodes.push('SLIPPAGE_REDUCTION');
            if (orderPlan.entryMode === 'market') {
                warnings.push('Market order with high expected slippage');
            }
            confidence *= 0.85;
        }

        // Stop loss distance warnings
        if (orderPlan.slDistanceBps < this.config.slDistanceClampBps.min) {
            reasonCodes.push('SL_DISTANCE_CLAMPED_MIN');
            warnings.push(`Stop loss too tight, clamped to ${this.config.slDistanceClampBps.min}bps`);
            confidence *= 0.8;
        } else if (orderPlan.slDistanceBps > this.config.slDistanceClampBps.max) {
            reasonCodes.push('SL_DISTANCE_CLAMPED_MAX');
            warnings.push(`Stop loss too wide, clamped to ${this.config.slDistanceClampBps.max}bps`);
            confidence *= 0.9;
        }

        // Cost forecast warnings
        if (costForecast?.impactWarning) {
            reasonCodes.push('LIQUIDITY_IMPACT_WARNING');
            warnings.push('Significant market impact expected');
            confidence *= 0.75;
        }

        return { reasonCodes, warnings, confidence };
    }

    /**
     * Get cached position size suggestion
     */
    getSuggestion(correlationId: string): PositionSizeSuggestion | null {
        return this.lastSuggestions.get(correlationId) || null;
    }

    /**
     * Calculate risk metrics for a proposed position
     */
    calculateRiskMetrics(qty: number, entryPrice: number, stopLoss: number, currentEquity: number): {
        riskPct: number;
        leverageRatio: number;
        riskUSD: number;
    } {
        const notional = qty * entryPrice;
        const riskUSD = qty * Math.abs(entryPrice - stopLoss);
        const riskPct = (riskUSD / currentEquity) * 100;
        const leverageRatio = notional / currentEquity;

        return {
            riskPct,
            leverageRatio,
            riskUSD
        };
    }

    /**
     * Validate if a position size meets policy requirements
     */
    validatePositionSize(suggestion: PositionSizeSuggestion, policy: PolicySnapshot): {
        isValid: boolean;
        violations: string[];
    } {
        const violations: string[] = [];

        // Check minimum quantity
        if (suggestion.qty < this.config.minQty) {
            violations.push('BELOW_MIN_QUANTITY');
        }

        // Check confidence threshold
        if (suggestion.confidence < 0.7) {
            violations.push('LOW_CONFIDENCE');
        }

        // Check if there are critical warnings
        const criticalWarnings = suggestion.warnings.filter(w => 
            w.includes('impact') || w.includes('slippage') || w.includes('tight')
        );
        
        if (criticalWarnings.length > 0) {
            violations.push('CRITICAL_WARNINGS');
        }

        return {
            isValid: violations.length === 0,
            violations
        };
    }

    /**
     * Get module status
     */
    getStatus(): any {
        return {
            name: 'PositionSizer',
            initialized: this.isInitialized,
            config: this.config,
            cachedSuggestions: this.lastSuggestions.size,
            equityHistoryLength: this.equityHistory.length,
            lastEquity: this.equityHistory[this.equityHistory.length - 1]
        };
    }

    async shutdown(): Promise<void> {
        try {
            this.logger.info('PositionSizer shutting down...');
            this.removeAllListeners();
            this.lastSuggestions.clear();
            this.equityHistory.length = 0;
            this.isInitialized = false;
            this.logger.info('PositionSizer shutdown complete');
        } catch (error) {
            this.logger.error('PositionSizer shutdown error:', error);
        }
    }
}

export default PositionSizer;
