/**
 * VIVO-20 · positionSizeOptimizer.ts
 * Pozisyon boyutu optimizasyonu - Kelly Criterion, volatilite ayarı, risk bütçesi bazlı boyutlandırma.
 * Advanced position sizing with risk management, volatility adjustment, and equity curve optimization.
 */

import { EventEmitter } from "events";

// Types for VIVO-20
export interface SizingRequest {
  requestId: string;
  symbol: string;
  side: "long"|"short";
  entryPrice: number;
  stopLoss: number;
  takeProfit: number[];
  confidence: number;        // 0..1 signal confidence
  timeframe: string;
  strategy: string;
  variant: "base"|"aggressive"|"conservative";
  marketCondition: "trending"|"ranging"|"volatile"|"quiet";
  correlationId: string;
  timestamp: string;
}

export interface PortfolioState {
  totalEquity: number;
  availableEquity: number;
  unrealizedPnl: number;
  openPositions: number;
  dailyPnl: number;
  weeklyPnl: number;
  monthlyPnl: number;
  maxDrawdown: number;
  winRate: number;           // last 100 trades
  avgWin: number;
  avgLoss: number;
  sharpeRatio: number;
  lastUpdate: string;
}

export interface MarketVolatility {
  symbol: string;
  atr14: number;
  atr21: number;
  realizedVol: number;       // historical volatility
  impliedVol?: number;       // if available
  volRank: number;           // 0..1 percentile
  regimeVol: "low"|"medium"|"high"|"extreme";
  timestamp: string;
}

export interface SizingResult {
  originalRequest: SizingRequest;
  recommendedSize: {
    baseAmount: number;        // in base currency
    quoteAmount: number;       // in quote currency
    riskAmount: number;        // amount at risk (equity * %)
    riskPercentage: number;    // % of equity at risk
    leverageUsed: number;      // if applicable
  };
  calculations: {
    kellyPercentage: number;   // Kelly optimal %
    kellyAdjusted: number;     // Kelly with safety factor
    volatilityAdjustment: number; // multiplier based on vol
    confidenceAdjustment: number; // multiplier based on signal confidence
    portfolioHeatAdjustment: number; // reduction based on current heat
    finalMultiplier: number;   // combined adjustment
  };
  riskMetrics: {
    stopLossDistance: number;  // in price units
    stopLossPercentage: number; // % from entry
    riskRewardRatio: number;   // avg TP distance / SL distance
    expectedValue: number;     // statistical expected return
    maxLossEquity: number;     // max equity loss if SL hit
    positionHeat: number;      // position contribution to portfolio heat
  };
  constraints: {
    maxRiskPerTrade: number;   // configured maximum
    maxPositionSize: number;   // exchange/equity limits
    minPositionSize: number;   // minimum viable size
    emergencyReduction: number; // reduction due to emergency conditions
  };
  warnings: string[];
  adjustmentReasons: string[];
  audit: {
    method: "kelly"|"fixed_percentage"|"volatility_scaled"|"emergency";
    portfolioHeat: number;
    winRate: number;
    avgRR: number;
    calculationTime: string;
  };
}

export interface SizerConfig {
  // Base risk parameters
  baseRiskPercentage: number;      // 1.0 (1% of equity per trade)
  maxRiskPercentage: number;       // 2.5 (max 2.5% per trade)
  minRiskPercentage: number;       // 0.1 (min 0.1% per trade)
  
  // Kelly parameters
  kellyEnabled: boolean;           // true
  kellyLookbackTrades: number;     // 100 trades for win/loss calculation
  kellySafetyFactor: number;       // 0.25 (use 25% of Kelly recommendation)
  kellyMaxPercentage: number;      // 4.0 (never exceed 4% even if Kelly suggests more)
  
  // Volatility adjustments
  volAdjustmentEnabled: boolean;   // true
  lowVolMultiplier: number;        // 1.2 (increase size in low vol)
  mediumVolMultiplier: number;     // 1.0 (neutral)
  highVolMultiplier: number;       // 0.8 (reduce size in high vol)
  extremeVolMultiplier: number;    // 0.5 (heavy reduction in extreme vol)
  
  // Confidence adjustments
  confidenceScaling: boolean;      // true
  minConfidenceMultiplier: number; // 0.5 (50% size at 0 confidence)
  maxConfidenceMultiplier: number; // 1.5 (150% size at 1.0 confidence)
  
  // Portfolio heat management
  portfolioHeatLimit: number;      // 10.0 (10% total portfolio heat limit)
  heatReductionFactor: number;     // 0.7 (reduce size by 30% when approaching limit)
  emergencyHeatLimit: number;      // 15.0 (emergency stop at 15%)
  
  // Position limits
  maxPositionsTotal: number;       // 20
  maxCorrelatedPositions: number;  // 5 (max positions in correlated assets)
  
  // Market condition adjustments
  trendingMarketMultiplier: number; // 1.1
  rangingMarketMultiplier: number;  // 0.9
  volatileMarketMultiplier: number; // 0.8
  quietMarketMultiplier: number;    // 1.0
}

export interface StdError { code:string; message:string; details?:Record<string,unknown>; retriable?:boolean; }

const clamp = (x:number, lo:number, hi:number)=> Math.max(lo, Math.min(hi, x));

export class PositionSizeOptimizer extends EventEmitter {
  ver="1.0.0"; src="VIVO-20";
  private config: SizerConfig;
  private portfolioState: PortfolioState | null = null;
  private recentTrades: any[] = []; // for Kelly calculation
  private volatilityCache = new Map<string, MarketVolatility>();

  constructor(config?: Partial<SizerConfig>) {
    super();
    this.config = {
      baseRiskPercentage: 1.0,
      maxRiskPercentage: 2.5,
      minRiskPercentage: 0.1,
      kellyEnabled: true,
      kellyLookbackTrades: 100,
      kellySafetyFactor: 0.25,
      kellyMaxPercentage: 4.0,
      volAdjustmentEnabled: true,
      lowVolMultiplier: 1.2,
      mediumVolMultiplier: 1.0,
      highVolMultiplier: 0.8,
      extremeVolMultiplier: 0.5,
      confidenceScaling: true,
      minConfidenceMultiplier: 0.5,
      maxConfidenceMultiplier: 1.5,
      portfolioHeatLimit: 10.0,
      heatReductionFactor: 0.7,
      emergencyHeatLimit: 15.0,
      maxPositionsTotal: 20,
      maxCorrelatedPositions: 5,
      trendingMarketMultiplier: 1.1,
      rangingMarketMultiplier: 0.9,
      volatileMarketMultiplier: 0.8,
      quietMarketMultiplier: 1.0,
      ...config
    };
  }

  attach(bus: any, logger: any) {
    // Main sizing requests
    bus.on("position.sizing.request", (request: any) => this.calculateOptimalSize(request, bus, logger));
    
    // Portfolio state updates
    bus.on("portfolio.state.update", (state: any) => this.updatePortfolioState(state));
    
    // Trade results for Kelly calculation
    bus.on("trade.closed", (trade: any) => this.recordTradeResult(trade));
    
    // Volatility updates
    bus.on("market.volatility.update", (vol: any) => this.updateVolatility(vol));
    
    // Emergency conditions
    bus.on("emergency.risk.event", (event: any) => this.handleEmergency(event, bus, logger));
  }

  private calculateOptimalSize(request: SizingRequest, bus: any, logger: any) {
    try {
      if (!this.portfolioState) {
        this.emitSizingResult(request, this.createEmergencyResult(request, "no_portfolio_state"), bus);
        return;
      }

      // Validate request
      const validation = this.validateRequest(request);
      if (validation) {
        this.emitSizingResult(request, this.createEmergencyResult(request, validation), bus);
        return;
      }

      // Get market volatility
      const volatility = this.volatilityCache.get(request.symbol);
      if (!volatility) {
        this.emitSizingResult(request, this.createEmergencyResult(request, "no_volatility_data"), bus);
        return;
      }

      // Calculate base risk metrics
      const stopLossDistance = Math.abs(request.entryPrice - request.stopLoss);
      const stopLossPercentage = stopLossDistance / request.entryPrice;
      
      const avgTpDistance = request.takeProfit.reduce((sum, tp) => 
        sum + Math.abs(tp - request.entryPrice), 0) / request.takeProfit.length;
      const riskRewardRatio = avgTpDistance / stopLossDistance;

      // Start with base risk percentage
      let riskPercentage = this.config.baseRiskPercentage;

      // Kelly Criterion adjustment
      let kellyPercentage = 0;
      let kellyAdjusted = 0;
      if (this.config.kellyEnabled && this.recentTrades.length >= 20) {
        kellyPercentage = this.calculateKellyPercentage();
        kellyAdjusted = kellyPercentage * this.config.kellySafetyFactor;
        kellyAdjusted = clamp(kellyAdjusted, 0, this.config.kellyMaxPercentage);
        
        if (kellyAdjusted > 0) {
          riskPercentage = Math.max(riskPercentage, kellyAdjusted);
        }
      }

      // Volatility adjustment
      const volAdjustment = this.getVolatilityAdjustment(volatility);
      riskPercentage *= volAdjustment;

      // Confidence adjustment
      const confidenceAdjustment = this.getConfidenceAdjustment(request.confidence);
      riskPercentage *= confidenceAdjustment;

      // Market condition adjustment
      const marketAdjustment = this.getMarketConditionAdjustment(request.marketCondition);
      riskPercentage *= marketAdjustment;

      // Portfolio heat adjustment
      const portfolioHeat = this.calculatePortfolioHeat();
      const heatAdjustment = this.getHeatAdjustment(portfolioHeat);
      riskPercentage *= heatAdjustment;

      // Apply limits
      riskPercentage = clamp(riskPercentage, this.config.minRiskPercentage, this.config.maxRiskPercentage);

      // Emergency reduction
      let emergencyReduction = 1.0;
      if (portfolioHeat > this.config.emergencyHeatLimit) {
        emergencyReduction = 0.3; // Reduce to 30% of normal size
        riskPercentage *= emergencyReduction;
      }

      // Calculate position size
      const riskAmount = this.portfolioState.availableEquity * (riskPercentage / 100);
      const baseAmount = riskAmount / stopLossDistance;
      const quoteAmount = baseAmount * request.entryPrice;

      // Exchange limits check
      const maxPositionSize = this.portfolioState.availableEquity * 0.20; // Max 20% in one position
      const finalQuoteAmount = Math.min(quoteAmount, maxPositionSize);
      const finalBaseAmount = finalQuoteAmount / request.entryPrice;
      const finalRiskAmount = finalBaseAmount * stopLossDistance;
      const finalRiskPercentage = (finalRiskAmount / this.portfolioState.totalEquity) * 100;

      // Expected value calculation
      const winRate = this.portfolioState.winRate || 0.5;
      const avgWin = this.portfolioState.avgWin || 1.0;
      const avgLoss = this.portfolioState.avgLoss || -1.0;
      const expectedValue = (winRate * avgWin) + ((1 - winRate) * avgLoss);

      // Create result
      const result: SizingResult = {
        originalRequest: request,
        recommendedSize: {
          baseAmount: finalBaseAmount,
          quoteAmount: finalQuoteAmount,
          riskAmount: finalRiskAmount,
          riskPercentage: finalRiskPercentage,
          leverageUsed: 1.0 // Spot trading default
        },
        calculations: {
          kellyPercentage,
          kellyAdjusted,
          volatilityAdjustment: volAdjustment,
          confidenceAdjustment: confidenceAdjustment,
          portfolioHeatAdjustment: heatAdjustment,
          finalMultiplier: volAdjustment * confidenceAdjustment * marketAdjustment * heatAdjustment
        },
        riskMetrics: {
          stopLossDistance,
          stopLossPercentage,
          riskRewardRatio,
          expectedValue,
          maxLossEquity: finalRiskAmount,
          positionHeat: finalRiskPercentage
        },
        constraints: {
          maxRiskPerTrade: this.config.maxRiskPercentage,
          maxPositionSize,
          minPositionSize: this.portfolioState.totalEquity * (this.config.minRiskPercentage / 100),
          emergencyReduction
        },
        warnings: this.generateWarnings(portfolioHeat, riskPercentage, volatility),
        adjustmentReasons: this.generateAdjustmentReasons(volAdjustment, confidenceAdjustment, heatAdjustment),
        audit: {
          method: this.config.kellyEnabled && kellyAdjusted > 0 ? "kelly" : "fixed_percentage",
          portfolioHeat,
          winRate: this.portfolioState.winRate,
          avgRR: riskRewardRatio,
          calculationTime: new Date().toISOString()
        }
      };

      this.emitSizingResult(request, result, bus);

    } catch (e: any) {
      if (logger) logger.error({ e }, "VIVO-20 calculateOptimalSize failed");
      this.emitSizingResult(request, this.createEmergencyResult(request, "calculation_error"), bus);
    }
  }

  private validateRequest(request: SizingRequest): string | null {
    if (!request.symbol || !request.side || !request.entryPrice || !request.stopLoss) {
      return "invalid_request_data";
    }

    if (request.entryPrice <= 0 || request.stopLoss <= 0) {
      return "invalid_prices";
    }

    if (request.confidence < 0 || request.confidence > 1) {
      return "invalid_confidence";
    }

    if (request.takeProfit.length === 0) {
      return "no_take_profit";
    }

    return null;
  }

  private calculateKellyPercentage(): number {
    if (this.recentTrades.length < 10) return 0;

    const wins = this.recentTrades.filter(t => t.pnl > 0);
    const losses = this.recentTrades.filter(t => t.pnl <= 0);

    if (losses.length === 0) return this.config.kellyMaxPercentage; // All wins - use max

    const winRate = wins.length / this.recentTrades.length;
    const avgWin = wins.reduce((sum, t) => sum + Math.abs(t.pnl), 0) / wins.length;
    const avgLoss = losses.reduce((sum, t) => sum + Math.abs(t.pnl), 0) / losses.length;

    const winLossRatio = avgWin / avgLoss;
    const kellyF = winRate - ((1 - winRate) / winLossRatio);

    return Math.max(0, kellyF * 100); // Convert to percentage
  }

  private getVolatilityAdjustment(volatility: MarketVolatility): number {
    if (!this.config.volAdjustmentEnabled) return 1.0;

    switch (volatility.regimeVol) {
      case "low": return this.config.lowVolMultiplier;
      case "medium": return this.config.mediumVolMultiplier;
      case "high": return this.config.highVolMultiplier;
      case "extreme": return this.config.extremeVolMultiplier;
      default: return 1.0;
    }
  }

  private getConfidenceAdjustment(confidence: number): number {
    if (!this.config.confidenceScaling) return 1.0;

    return this.config.minConfidenceMultiplier + 
           (confidence * (this.config.maxConfidenceMultiplier - this.config.minConfidenceMultiplier));
  }

  private getMarketConditionAdjustment(condition: string): number {
    switch (condition) {
      case "trending": return this.config.trendingMarketMultiplier;
      case "ranging": return this.config.rangingMarketMultiplier;
      case "volatile": return this.config.volatileMarketMultiplier;
      case "quiet": return this.config.quietMarketMultiplier;
      default: return 1.0;
    }
  }

  private calculatePortfolioHeat(): number {
    if (!this.portfolioState) return 0;

    // Portfolio heat = current open risk / total equity
    const maxLossFromOpenPositions = Math.abs(Math.min(0, this.portfolioState.unrealizedPnl));
    return (maxLossFromOpenPositions / this.portfolioState.totalEquity) * 100;
  }

  private getHeatAdjustment(portfolioHeat: number): number {
    if (portfolioHeat < this.config.portfolioHeatLimit * 0.5) {
      return 1.0; // Normal sizing
    } else if (portfolioHeat < this.config.portfolioHeatLimit) {
      return this.config.heatReductionFactor; // Reduce size
    } else {
      return 0.5; // Heavy reduction
    }
  }

  private generateWarnings(portfolioHeat: number, riskPercentage: number, volatility: MarketVolatility): string[] {
    const warnings: string[] = [];

    if (portfolioHeat > this.config.portfolioHeatLimit) {
      warnings.push("portfolio_heat_high");
    }

    if (riskPercentage > this.config.maxRiskPercentage * 0.8) {
      warnings.push("high_risk_percentage");
    }

    if (volatility.regimeVol === "extreme") {
      warnings.push("extreme_volatility");
    }

    if (this.portfolioState && this.portfolioState.maxDrawdown > 0.1) {
      warnings.push("high_drawdown_period");
    }

    return warnings;
  }

  private generateAdjustmentReasons(volAdj: number, confAdj: number, heatAdj: number): string[] {
    const reasons: string[] = [];

    if (volAdj < 1.0) reasons.push("reduced_for_high_volatility");
    if (volAdj > 1.0) reasons.push("increased_for_low_volatility");
    if (confAdj < 1.0) reasons.push("reduced_for_low_confidence");
    if (confAdj > 1.0) reasons.push("increased_for_high_confidence");
    if (heatAdj < 1.0) reasons.push("reduced_for_portfolio_heat");

    return reasons;
  }

  private createEmergencyResult(request: SizingRequest, reason: string): SizingResult {
    return {
      originalRequest: request,
      recommendedSize: {
        baseAmount: 0,
        quoteAmount: 0,
        riskAmount: 0,
        riskPercentage: 0,
        leverageUsed: 0
      },
      calculations: {
        kellyPercentage: 0,
        kellyAdjusted: 0,
        volatilityAdjustment: 0,
        confidenceAdjustment: 0,
        portfolioHeatAdjustment: 0,
        finalMultiplier: 0
      },
      riskMetrics: {
        stopLossDistance: 0,
        stopLossPercentage: 0,
        riskRewardRatio: 0,
        expectedValue: 0,
        maxLossEquity: 0,
        positionHeat: 0
      },
      constraints: {
        maxRiskPerTrade: this.config.maxRiskPercentage,
        maxPositionSize: 0,
        minPositionSize: 0,
        emergencyReduction: 0
      },
      warnings: ["emergency_sizing", reason],
      adjustmentReasons: ["emergency_mode"],
      audit: {
        method: "emergency",
        portfolioHeat: 0,
        winRate: 0,
        avgRR: 0,
        calculationTime: new Date().toISOString()
      }
    };
  }

  private emitSizingResult(request: SizingRequest, result: SizingResult, bus: any) {
    bus.emit("position.sizing.result", result);
    
    // Emit metrics
    bus.emit("vivo.position_sizing.metrics", {
      symbol: request.symbol,
      recommendedRiskPct: result.recommendedSize.riskPercentage,
      portfolioHeat: this.calculatePortfolioHeat(),
      kellyEnabled: this.config.kellyEnabled,
      volatilityRegime: this.volatilityCache.get(request.symbol)?.regimeVol,
      adjustmentFactors: result.calculations.finalMultiplier,
      warningCount: result.warnings.length,
      timestamp: new Date().toISOString()
    });
  }

  private updatePortfolioState(state: PortfolioState) {
    this.portfolioState = state;
  }

  private recordTradeResult(trade: any) {
    this.recentTrades.push({
      symbol: trade.symbol,
      pnl: trade.realizedPnl,
      riskAmount: trade.riskAmount,
      returnPct: (trade.realizedPnl / trade.riskAmount) * 100,
      timestamp: trade.closeTime
    });

    // Keep only recent trades
    if (this.recentTrades.length > this.config.kellyLookbackTrades) {
      this.recentTrades = this.recentTrades.slice(-this.config.kellyLookbackTrades);
    }
  }

  private updateVolatility(vol: MarketVolatility) {
    this.volatilityCache.set(vol.symbol, vol);
  }

  private handleEmergency(event: any, bus: any, logger: any) {
    // Temporarily reduce all position sizes
    this.config.maxRiskPercentage *= 0.5;
    this.config.baseRiskPercentage *= 0.5;

    if (logger) {
      logger.warn({ event }, "VIVO-20 emergency risk reduction activated");
    }

    // Reset after cooldown period
    setTimeout(() => {
      this.config.maxRiskPercentage *= 2;
      this.config.baseRiskPercentage *= 2;
    }, 300000); // 5 minutes
  }

  // Public methods for external access
  getStatus(): any {
    return {
      config: this.config,
      portfolioState: this.portfolioState,
      recentTradesCount: this.recentTrades.length,
      volatilityCacheSize: this.volatilityCache.size,
      kellyPercentage: this.recentTrades.length >= 20 ? this.calculateKellyPercentage() : 0,
      currentPortfolioHeat: this.calculatePortfolioHeat()
    };
  }

  updateConfig(updates: Partial<SizerConfig>): void {
    this.config = { ...this.config, ...updates };
  }

  clearTradeHistory(): void {
    this.recentTrades = [];
  }

  getKellyRecommendation(): number {
    return this.recentTrades.length >= 20 ? this.calculateKellyPercentage() : 0;
  }
}
