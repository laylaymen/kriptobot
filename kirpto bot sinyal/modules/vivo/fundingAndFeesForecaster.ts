/**
 * VIVO-28 · fundingAndFeesForecaster.ts
 * Perp funding ve işlem ücretleri tahmin sistemi.
 * Advanced funding and fees forecasting with cost-benefit analysis for trading decisions.
 */

import { EventEmitter } from "events";

// Input Event Types
export interface FundingSnapshot {
  event: "funding.snapshot";
  timestamp: string;
  symbol: string;
  period: "8h" | "4h" | "1h";
  lastFundingRateBp: number;
  nextFundingTime: string;
  predictedNextRateBp?: number;
  basisBp?: number;
  oiChangePct?: number;
}

export interface FeesSchedule {
  event: "fees.schedule";
  timestamp: string;
  tradeMode: "spot" | "usdm" | "coinm";
  vipTier: number;
  makerFeeBp: number;
  takerFeeBp: number;
  discounts?: {
    token?: string;
    enabled: boolean;
    extraMakerBp: number;
    extraTakerBp: number;
  };
}

export interface AccountTradingStats {
  event: "account.tradingStats";
  timestamp: string;
  last30dVolumeUSD: number;
  projectedVipTierInHours?: number;
}

export interface OrderPlanProposed {
  event: "order.plan.proposed";
  timestamp: string;
  symbol: string;
  side: "long" | "short";
  tradeMode: "spot" | "usdm" | "coinm";
  entryPlan: {
    mode: "market" | "limit" | "stop_market" | "stop_limit";
    legs: Array<{
      type: string;
      qty: number;
      price?: number;
      ttlSec: number;
    }>;
  };
  protection: {
    stopLoss: { price: number; };
    takeProfit: Array<{ ratio: number; price: number; }>;
  };
  risk: {
    riskPerTradePct: number;
    plannedRR: number;
  };
  audit: {
    variant: "base" | "aggressive" | "conservative";
    tpSlStyle: "ATR" | "range" | "hybrid";
  };
}

export interface PositionSnapshot {
  event: "position.snapshot";
  timestamp: string;
  symbol: string;
  side: "long" | "short";
  tradeId: string;
  qtyOpen: number;
  avgPrice: number;
  tradeMode: "usdm" | "coinm" | "spot";
  entryTime: string;
}

export interface MarketRefs {
  event: "market.refs";
  timestamp: string;
  symbol: string;
  mid: number;
  spreadBps: number;
  volZScore: number;
}

// Output Event Types
export interface CostForecastUpdate {
  event: "cost.forecast.update";
  timestamp: string;
  symbol: string;
  tradeMode: "spot" | "usdm" | "coinm";
  fee: {
    makerBp: number;
    takerBp: number;
    effectiveMakerBp: number;
    effectiveTakerBp: number;
  };
  funding?: {
    period: "8h" | "4h" | "1h";
    nextFundingTime: string;
    predictedNextRateBp?: number;
    windowMinutesToFunding: number;
    signHint: "pay_long" | "pay_short" | "neutral";
  };
  derived: {
    basisBpAnnual?: number;
    riskLevel: "low" | "elevated" | "high";
  };
}

export interface CostBudgetAdvice {
  event: "cost.budget.advice";
  timestamp: string;
  correlationId?: string;
  symbol: string;
  side: "long" | "short";
  plannedRR: number;
  assumptions: {
    fillStyle: "maker" | "taker" | "mixed";
    expectedHoldMinutes: number;
  };
  expectedCosts: {
    feesBp: number;
    fundingBp: number;
    totalBp: number;
    totalPctOfPlannedR: number;
  };
  recommendations: string[];
  severity: "info" | "warn" | "block";
  reasonCodes: string[];
}

export interface CostWindowSupervisorHint {
  event: "cost.window.supervisorHint";
  timestamp: string;
  symbol: string;
  tradeId: string;
  minutesToFunding: number;
  suggest: string[];
  reasonCodes: string[];
}

export interface CostAlert {
  event: "cost.alert";
  timestamp: string;
  level: "info" | "warn" | "error";
  message: string;
  context: {
    symbol?: string;
    correlationId?: string;
    reasonCodes: string[];
  };
}

export interface CostForecasterMetrics {
  event: "cost.forecaster.metrics";
  timestamp: string;
  avgAdviceMs: number;
  adviceRates: {
    info: number;
    warn: number;
    block: number;
  };
  makerUsageSuggestRate: number;
  fundingWindowAvoidRate: number;
}

// Configuration
export interface ForecasterConfig {
  fundingWindow: {
    warnMin: number;
    blockMin: number;
  };
  fundingRiskBp: {
    elevated: number;
    high: number;
  };
  defaultFillStyle: "maker" | "taker" | "mixed";
  makerShare: number;
  takerShare: number;
  holdEstimator: {
    fallbackMin: number;
    useSupervisorPath: boolean;
  };
  costAsPctOfPlannedR: {
    warn: number;
    block: number;
  };
  suggestSpotIfCostly: boolean;
  tierProjectionHorizonMin: number;
  metricsFlushSec: number;
  tz: string;
}

// Internal state
interface CostState {
  fundingSnapshots: Map<string, FundingSnapshot>;
  feesSchedules: Map<string, FeesSchedule>; // key: tradeMode
  accountStats?: AccountTradingStats;
  marketRefs: Map<string, MarketRefs>;
  metrics: {
    avgAdviceMs: number;
    adviceRates: { info: number; warn: number; block: number; };
    makerUsageSuggestRate: number;
    fundingWindowAvoidRate: number;
  };
  processedAdvice: Set<string>; // for idempotency
}

// Helper functions
class EffectiveFeeCalculator {
  static calculate(schedule: FeesSchedule): { effectiveMakerBp: number; effectiveTakerBp: number; } {
    const makerDiscount = schedule.discounts?.enabled ? schedule.discounts.extraMakerBp : 0;
    const takerDiscount = schedule.discounts?.enabled ? schedule.discounts.extraTakerBp : 0;
    
    return {
      effectiveMakerBp: schedule.makerFeeBp + makerDiscount,
      effectiveTakerBp: schedule.takerFeeBp + takerDiscount
    };
  }
}

class FundingCalculator {
  static calculateCost(
    fundingRateBp: number,
    holdMinutes: number,
    periodMinutes: number,
    side: "long" | "short"
  ): number {
    const holdPeriods = holdMinutes / periodMinutes;
    const unsignedCost = Math.abs(fundingRateBp) * holdPeriods;
    
    // Long pays when rate is positive, short pays when rate is negative
    if (side === "long") {
      return fundingRateBp > 0 ? unsignedCost : -unsignedCost;
    } else {
      return fundingRateBp > 0 ? -unsignedCost : unsignedCost;
    }
  }

  static getPeriodMinutes(period: string): number {
    switch (period) {
      case "8h": return 480;
      case "4h": return 240;
      case "1h": return 60;
      default: return 480;
    }
  }
}

export interface StdError { code:string; message:string; details?:Record<string,unknown>; retriable?:boolean; }

export class FundingAndFeesForecaster extends EventEmitter {
  ver="1.0.0"; src="VIVO-28";
  private config: ForecasterConfig;
  private state: CostState;
  private metricsInterval?: NodeJS.Timeout;

  constructor(config?: Partial<ForecasterConfig>) {
    super();
    this.config = {
      fundingWindow: { warnMin: 30, blockMin: 10 },
      fundingRiskBp: { elevated: 20, high: 35 },
      defaultFillStyle: "mixed",
      makerShare: 0.4,
      takerShare: 0.6,
      holdEstimator: { fallbackMin: 90, useSupervisorPath: true },
      costAsPctOfPlannedR: { warn: 0.25, block: 0.45 },
      suggestSpotIfCostly: true,
      tierProjectionHorizonMin: 240,
      metricsFlushSec: 10,
      tz: "Europe/Istanbul",
      ...config
    };

    this.state = {
      fundingSnapshots: new Map(),
      feesSchedules: new Map(),
      marketRefs: new Map(),
      metrics: { avgAdviceMs: 0, adviceRates: { info: 0, warn: 0, block: 0 }, makerUsageSuggestRate: 0, fundingWindowAvoidRate: 0 },
      processedAdvice: new Set()
    };

    this.setupMetricsFlush();
  }

  attach(bus: any, logger: any) {
    bus.on("funding.snapshot", (data: any) => this.handleFundingSnapshot(data, bus, logger));
    bus.on("fees.schedule", (data: any) => this.handleFeesSchedule(data, bus, logger));
    bus.on("account.tradingStats", (data: any) => this.handleTradingStats(data, logger));
    bus.on("order.plan.proposed", (data: any) => this.handlePlanProposed(data, bus, logger));
    bus.on("position.snapshot", (data: any) => this.handlePositionSnapshot(data, bus, logger));
    bus.on("market.refs", (data: any) => this.handleMarketRefs(data, logger));
  }

  private handleFundingSnapshot(data: any, bus: any, logger: any): void {
    try {
      if (data.event !== "funding.snapshot") return;
      
      const snapshot = data as FundingSnapshot;
      this.state.fundingSnapshots.set(snapshot.symbol, snapshot);
      
      // Emit forecast update
      this.emitForecastUpdate(snapshot, bus);

    } catch (e: any) {
      if (logger) logger.error({ e, data }, "VIVO-28 funding snapshot error");
    }
  }

  private handleFeesSchedule(data: any, bus: any, logger: any): void {
    try {
      if (data.event !== "fees.schedule") return;
      
      const schedule = data as FeesSchedule;
      this.state.feesSchedules.set(schedule.tradeMode, schedule);
      
      // Update all forecasts with new fee info
      this.updateAllForecasts(bus);

    } catch (e: any) {
      if (logger) logger.error({ e, data }, "VIVO-28 fees schedule error");
    }
  }

  private handleTradingStats(data: any, logger: any): void {
    try {
      if (data.event === "account.tradingStats") {
        this.state.accountStats = data as AccountTradingStats;
      }
    } catch (e: any) {
      if (logger) logger.error({ e, data }, "VIVO-28 trading stats error");
    }
  }

  private handlePlanProposed(data: any, bus: any, logger: any): void {
    try {
      if (data.event !== "order.plan.proposed") return;
      
      const plan = data as OrderPlanProposed;
      
      // Generate cost advice for this plan
      this.generateCostAdvice(plan, bus, logger);

    } catch (e: any) {
      if (logger) logger.error({ e, data }, "VIVO-28 plan proposed error");
    }
  }

  private handlePositionSnapshot(data: any, bus: any, logger: any): void {
    try {
      if (data.event !== "position.snapshot") return;
      
      const position = data as PositionSnapshot;
      
      // Check for funding window warnings on open positions
      this.checkPositionFundingWindow(position, bus, logger);

    } catch (e: any) {
      if (logger) logger.error({ e, data }, "VIVO-28 position snapshot error");
    }
  }

  private handleMarketRefs(data: any, logger: any): void {
    try {
      if (data.event === "market.refs") {
        const refs = data as MarketRefs;
        this.state.marketRefs.set(refs.symbol, refs);
      }
    } catch (e: any) {
      if (logger) logger.error({ e, data }, "VIVO-28 market refs error");
    }
  }

  private emitForecastUpdate(snapshot: FundingSnapshot, bus: any): void {
    const schedule = this.state.feesSchedules.get(snapshot.symbol.includes("USDT") ? "usdm" : "coinm");
    if (!schedule) return;

    const effectiveFees = EffectiveFeeCalculator.calculate(schedule);
    const minutesToFunding = this.getMinutesToFunding(snapshot.nextFundingTime);
    const riskLevel = this.assessFundingRisk(snapshot.predictedNextRateBp || snapshot.lastFundingRateBp);

    const forecast: CostForecastUpdate = {
      event: "cost.forecast.update",
      timestamp: new Date().toISOString(),
      symbol: snapshot.symbol,
      tradeMode: schedule.tradeMode,
      fee: {
        makerBp: schedule.makerFeeBp,
        takerBp: schedule.takerFeeBp,
        effectiveMakerBp: effectiveFees.effectiveMakerBp,
        effectiveTakerBp: effectiveFees.effectiveTakerBp
      },
      funding: {
        period: snapshot.period,
        nextFundingTime: snapshot.nextFundingTime,
        predictedNextRateBp: snapshot.predictedNextRateBp,
        windowMinutesToFunding: minutesToFunding,
        signHint: this.getFundingSignHint(snapshot.predictedNextRateBp || snapshot.lastFundingRateBp)
      },
      derived: {
        basisBpAnnual: snapshot.basisBp,
        riskLevel
      }
    };

    bus.emit("cost.forecast.update", forecast);
  }

  private generateCostAdvice(plan: OrderPlanProposed, bus: any, logger: any): void {
    const startTime = Date.now();
    
    try {
      const fundingSnapshot = this.state.fundingSnapshots.get(plan.symbol);
      const schedule = this.state.feesSchedules.get(plan.tradeMode);
      
      if (!fundingSnapshot || !schedule) {
        this.emitAlert("warn", "Missing funding or fees data for cost advice", {
          symbol: plan.symbol,
          reasonCodes: ["incomplete_data"]
        }, bus);
        return;
      }

      // Generate unique ID for idempotency
      const adviceId = `${plan.symbol}_${plan.side}_${plan.timestamp}_${plan.risk.plannedRR}`;
      if (this.state.processedAdvice.has(adviceId)) {
        return; // Already processed
      }

      const fillStyle = this.determineFillStyle(plan);
      const expectedHoldMinutes = this.estimateHoldTime(plan);
      const costs = this.calculateCosts(plan, fundingSnapshot, schedule, fillStyle, expectedHoldMinutes);
      const recommendations = this.generateRecommendations(plan, fundingSnapshot, costs);
      const severity = this.determineSeverity(costs, plan);

      const advice: CostBudgetAdvice = {
        event: "cost.budget.advice",
        timestamp: new Date().toISOString(),
        correlationId: adviceId,
        symbol: plan.symbol,
        side: plan.side,
        plannedRR: plan.risk.plannedRR,
        assumptions: {
          fillStyle,
          expectedHoldMinutes
        },
        expectedCosts: costs,
        recommendations,
        severity,
        reasonCodes: this.generateReasonCodes(costs, fundingSnapshot, recommendations)
      };

      bus.emit("cost.budget.advice", advice);
      this.state.processedAdvice.add(adviceId);
      
      // Update metrics
      this.state.metrics.adviceRates[severity]++;
      if (recommendations.includes("prefer_maker_post_only")) {
        this.state.metrics.makerUsageSuggestRate++;
      }
      if (recommendations.some(r => r.includes("funding"))) {
        this.state.metrics.fundingWindowAvoidRate++;
      }

      const processingTime = Date.now() - startTime;
      this.state.metrics.avgAdviceMs = (this.state.metrics.avgAdviceMs + processingTime) / 2;

    } catch (e: any) {
      if (logger) logger.error({ e, plan }, "VIVO-28 cost advice generation error");
    }
  }

  private checkPositionFundingWindow(position: PositionSnapshot, bus: any, logger: any): void {
    if (position.tradeMode === "spot") return;

    const fundingSnapshot = this.state.fundingSnapshots.get(position.symbol);
    if (!fundingSnapshot) return;

    const minutesToFunding = this.getMinutesToFunding(fundingSnapshot.nextFundingTime);
    const riskLevel = this.assessFundingRisk(fundingSnapshot.predictedNextRateBp || fundingSnapshot.lastFundingRateBp);

    if (minutesToFunding <= this.config.fundingWindow.warnMin && riskLevel !== "low") {
      const suggestions = this.generatePositionSuggestions(minutesToFunding, riskLevel);
      
      const hint: CostWindowSupervisorHint = {
        event: "cost.window.supervisorHint",
        timestamp: new Date().toISOString(),
        symbol: position.symbol,
        tradeId: position.tradeId,
        minutesToFunding,
        suggest: suggestions,
        reasonCodes: ["funding_spike_risk"]
      };

      bus.emit("cost.window.supervisorHint", hint);
    }
  }

  private updateAllForecasts(bus: any): void {
    for (const snapshot of this.state.fundingSnapshots.values()) {
      this.emitForecastUpdate(snapshot, bus);
    }
  }

  private determineFillStyle(plan: OrderPlanProposed): "maker" | "taker" | "mixed" {
    if (plan.entryPlan.mode === "market") return "taker";
    if (plan.entryPlan.mode === "limit") return "maker";
    return this.config.defaultFillStyle;
  }

  private estimateHoldTime(plan: OrderPlanProposed): number {
    // Simple estimation - in real implementation would use VIVO-21 data
    return this.config.holdEstimator.fallbackMin;
  }

  private calculateCosts(
    plan: OrderPlanProposed,
    fundingSnapshot: FundingSnapshot,
    schedule: FeesSchedule,
    fillStyle: string,
    holdMinutes: number
  ): CostBudgetAdvice["expectedCosts"] {
    const effectiveFees = EffectiveFeeCalculator.calculate(schedule);
    
    // Calculate fees
    let feesBp: number;
    if (fillStyle === "maker") {
      feesBp = effectiveFees.effectiveMakerBp;
    } else if (fillStyle === "taker") {
      feesBp = effectiveFees.effectiveTakerBp;
    } else {
      feesBp = effectiveFees.effectiveMakerBp * this.config.makerShare + 
               effectiveFees.effectiveTakerBp * this.config.takerShare;
    }

    // Calculate funding
    const fundingRateBp = fundingSnapshot.predictedNextRateBp || fundingSnapshot.lastFundingRateBp;
    const periodMinutes = FundingCalculator.getPeriodMinutes(fundingSnapshot.period);
    const fundingBp = plan.tradeMode === "spot" ? 0 : 
      FundingCalculator.calculateCost(fundingRateBp, holdMinutes, periodMinutes, plan.side);

    const totalBp = feesBp + Math.abs(fundingBp);
    const totalPctOfPlannedR = totalBp / (plan.risk.plannedRR * 100); // Simplified normalization

    return {
      feesBp,
      fundingBp,
      totalBp,
      totalPctOfPlannedR
    };
  }

  private generateRecommendations(
    plan: OrderPlanProposed,
    fundingSnapshot: FundingSnapshot,
    costs: CostBudgetAdvice["expectedCosts"]
  ): string[] {
    const recommendations: string[] = [];
    const minutesToFunding = this.getMinutesToFunding(fundingSnapshot.nextFundingTime);
    const riskLevel = this.assessFundingRisk(fundingSnapshot.predictedNextRateBp || fundingSnapshot.lastFundingRateBp);

    // Funding window recommendations
    if (minutesToFunding <= this.config.fundingWindow.blockMin && riskLevel === "high") {
      recommendations.push(`avoid_opening_within_${this.config.fundingWindow.blockMin}m_to_funding`);
    } else if (minutesToFunding <= this.config.fundingWindow.warnMin && riskLevel !== "low") {
      recommendations.push(`avoid_opening_within_${this.config.fundingWindow.warnMin}m_to_funding`);
    }

    // Fee optimization
    if (costs.feesBp > 3) { // High taker fees
      recommendations.push("prefer_maker_post_only");
    }

    // Hold time optimization
    if (costs.fundingBp > 5) {
      recommendations.push("reduce_hold_to_45m");
    }

    // Spot alternative
    if (this.config.suggestSpotIfCostly && costs.totalPctOfPlannedR > this.config.costAsPctOfPlannedR.block && plan.tradeMode !== "spot") {
      recommendations.push("switch_to_spot_if_possible");
    }

    // VIP tier timing
    if (this.state.accountStats?.projectedVipTierInHours && 
        this.state.accountStats.projectedVipTierInHours <= this.config.tierProjectionHorizonMin / 60) {
      recommendations.push("defer_for_tier_upgrade");
    }

    return recommendations;
  }

  private determineSeverity(costs: CostBudgetAdvice["expectedCosts"], plan: OrderPlanProposed): "info" | "warn" | "block" {
    if (costs.totalPctOfPlannedR >= this.config.costAsPctOfPlannedR.block) {
      return "block";
    } else if (costs.totalPctOfPlannedR >= this.config.costAsPctOfPlannedR.warn) {
      return "warn";
    }
    return "info";
  }

  private generateReasonCodes(
    costs: CostBudgetAdvice["expectedCosts"],
    fundingSnapshot: FundingSnapshot,
    recommendations: string[]
  ): string[] {
    const codes: string[] = [];
    
    if (this.getMinutesToFunding(fundingSnapshot.nextFundingTime) <= this.config.fundingWindow.blockMin) {
      codes.push("high_funding_window");
    }
    
    if (costs.feesBp > 3) {
      codes.push("high_taker_fee");
    }
    
    if (costs.totalPctOfPlannedR >= this.config.costAsPctOfPlannedR.warn) {
      codes.push("rr_eroded");
    }

    return codes;
  }

  private generatePositionSuggestions(minutesToFunding: number, riskLevel: string): string[] {
    const suggestions: string[] = [];
    
    if (riskLevel === "high") {
      if (minutesToFunding <= this.config.fundingWindow.blockMin) {
        suggestions.push("close_before_funding", "scale_out_50");
      } else {
        suggestions.push("tighten_trailing", "scale_out_25");
      }
    } else if (riskLevel === "elevated") {
      suggestions.push("tighten_trailing");
    }

    return suggestions;
  }

  private getMinutesToFunding(nextFundingTime: string): number {
    const now = new Date();
    const fundingTime = new Date(nextFundingTime);
    return Math.max(0, (fundingTime.getTime() - now.getTime()) / (1000 * 60));
  }

  private assessFundingRisk(fundingRateBp: number): "low" | "elevated" | "high" {
    const absBp = Math.abs(fundingRateBp);
    
    if (absBp >= this.config.fundingRiskBp.high) return "high";
    if (absBp >= this.config.fundingRiskBp.elevated) return "elevated";
    return "low";
  }

  private getFundingSignHint(fundingRateBp: number): "pay_long" | "pay_short" | "neutral" {
    if (Math.abs(fundingRateBp) < 1) return "neutral";
    return fundingRateBp > 0 ? "pay_long" : "pay_short";
  }

  private emitAlert(level: CostAlert["level"], message: string, context: CostAlert["context"], bus: any): void {
    const alert: CostAlert = {
      event: "cost.alert",
      timestamp: new Date().toISOString(),
      level,
      message,
      context
    };

    bus.emit("cost.alert", alert);
  }

  private setupMetricsFlush(): void {
    this.metricsInterval = setInterval(() => {
      this.emitMetrics();
    }, this.config.metricsFlushSec * 1000);
  }

  private emitMetrics(): void {
    const metrics: CostForecasterMetrics = {
      event: "cost.forecaster.metrics",
      timestamp: new Date().toISOString(),
      avgAdviceMs: this.state.metrics.avgAdviceMs,
      adviceRates: this.state.metrics.adviceRates,
      makerUsageSuggestRate: this.state.metrics.makerUsageSuggestRate,
      fundingWindowAvoidRate: this.state.metrics.fundingWindowAvoidRate
    };

    this.emit("cost.forecaster.metrics", metrics);
  }

  // Public methods
  getStatus(): any {
    return {
      config: this.config,
      state: {
        fundingSnapshots: this.state.fundingSnapshots.size,
        feesSchedules: this.state.feesSchedules.size,
        hasAccountStats: !!this.state.accountStats,
        processedAdviceCount: this.state.processedAdvice.size
      },
      metrics: this.state.metrics
    };
  }

  updateConfig(updates: Partial<ForecasterConfig>): void {
    this.config = { ...this.config, ...updates };
  }

  // Cleanup
  shutdown(): void {
    if (this.metricsInterval) {
      clearInterval(this.metricsInterval);
    }
  }
}
