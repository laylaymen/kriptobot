/**
 * VIVO-41 · strategyStabilityScore.ts
 * Stratejiler için istikrar skoru; Bandit/Composer için düşük istikrarı işaretle.
 * Strateji performans varyansı analizi ve stabilite değerlendirmesi.
 */

import { EventEmitter } from "events";

// Input Event Types
export interface VivoFeedbackRaw {
  event: "vivo.feedback.raw";
  timestamp: string;
  correlationId: string;
  symbol: string;
  strategy: string;
  arm: string; // Strategy arm/variant identifier
  feedback: {
    entryQuality: number; // -1 to 1
    executionTime: number; // seconds
    slippage: number; // bps
    markOut: number; // bps
    expectedR: number;
    actualR: number;
    fillRate: number; // 0 to 1
    latency: number; // ms
  };
  tags: string[];
  variant: "conservative" | "base" | "aggressive";
  context: {
    marketCondition: string;
    volatility: number;
    spread: number;
    volume: number;
  };
}

export interface TradeSummaryClosed {
  event: "trade.summary.closed";
  timestamp: string;
  correlationId: string;
  symbol: string;
  strategy: string;
  arm: string;
  side: "buy" | "sell";
  pnl: number;
  pnlR: number;
  duration: number; // seconds
  entryPrice: number;
  exitPrice: number;
  variant: string;
  slippage: number;
  fees: number;
  maxFavorable: number;
  maxAdverse: number;
  exitReason: "tp" | "sl" | "timeout" | "manual" | "risk";
}

// Output Event Types
export interface StrategyStabilityScores {
  event: "strategy.stability.scores";
  timestamp: string;
  scores: Array<{
    arm: string;
    strategy: string;
    score0to1: number;
    samples: number;
    flags: string[]; // ["volatile", "stable", "insufficient_data", "degrading", "improving"]
    notes: string[];
    breakdown: {
      stdR: { value: number; score: number; weight: number; };
      winVar: { value: number; score: number; weight: number; };
      slipVar: { value: number; score: number; weight: number; };
      durationVar: { value: number; score: number; weight: number; };
    };
    trends: {
      recent: number; // Last 10 trades score
      overall: number; // All window trades score
      direction: "improving" | "degrading" | "stable";
    };
    riskFactors: string[];
  }>;
  summary: {
    totalArms: number;
    avgStability: number;
    volatileArms: number;
    stableArms: number;
    recommendedActions: string[];
  };
}

// Configuration
export interface StabilityConfig {
  windowTrades: number;
  weights: {
    stdR: number;
    winVar: number;
    slipVar: number;
    durationVar: number;
  };
  thresholds: {
    volatile: number;
    stable: number;
    minSamples: number;
    degradingThreshold: number;
  };
  normalization: {
    maxStdR: number;
    maxWinVar: number;
    maxSlipVar: number;
    maxDurationVar: number;
  };
  tz: string;
}

// Internal state interfaces
interface StrategyArm {
  arm: string;
  strategy: string;
  trades: TradeRecord[];
  feedback: FeedbackRecord[];
  stats: {
    totalTrades: number;
    avgR: number;
    stdR: number;
    winRate: number;
    avgDuration: number;
    avgSlippage: number;
    lastUpdate: Date;
  };
  scores: {
    current: number;
    history: Array<{ date: Date; score: number; samples: number; }>;
  };
}

interface TradeRecord {
  timestamp: Date;
  correlationId: string;
  pnlR: number;
  duration: number;
  slippage: number;
  variant: string;
  exitReason: string;
  marketCondition: string;
}

interface FeedbackRecord {
  timestamp: Date;
  correlationId: string;
  entryQuality: number;
  executionTime: number;
  markOut: number;
  expectedR: number;
  actualR: number;
  fillRate: number;
  latency: number;
  variant: string;
}

interface StabilityState {
  strategyArms: Map<string, StrategyArm>; // arm -> StrategyArm
  lastScores: StrategyStabilityScores | null;
  recentCalculations: Array<{ timestamp: Date; armCount: number; avgStability: number; }>;
  stats: {
    totalCalculations: number;
    avgProcessingTime: number;
    lastCalculation: Date | null;
  };
}

export interface StdError { code:string; message:string; details?:Record<string,unknown>; retriable?:boolean; }

export class StrategyStabilityScore extends EventEmitter {
  ver="1.0.0"; src="VIVO-41";
  private config: StabilityConfig;
  private state: StabilityState;
  private scoreInterval?: NodeJS.Timeout;

  constructor(config?: Partial<StabilityConfig>) {
    super();
    this.config = {
      windowTrades: 50,
      weights: { 
        stdR: 0.4, 
        winVar: 0.3, 
        slipVar: 0.2, 
        durationVar: 0.1 
      },
      thresholds: { 
        volatile: 0.35, 
        stable: 0.7,
        minSamples: 10,
        degradingThreshold: 0.1
      },
      normalization: {
        maxStdR: 2.0,
        maxWinVar: 0.5,
        maxSlipVar: 50.0, // bps
        maxDurationVar: 3600.0 // seconds
      },
      tz: "Europe/Istanbul",
      ...config
    };

    this.state = {
      strategyArms: new Map(),
      lastScores: null,
      recentCalculations: [],
      stats: {
        totalCalculations: 0,
        avgProcessingTime: 0,
        lastCalculation: null
      }
    };

    this.setupCalculationInterval();
  }

  attach(bus: any, logger: any) {
    bus.on("vivo.feedback.raw", (data: any) => this.handleVivoFeedback(data, logger));
    bus.on("trade.summary.closed", (data: any) => this.handleTradeClosed(data, bus, logger));
  }

  private handleVivoFeedback(data: any, logger: any): void {
    try {
      if (data.event !== "vivo.feedback.raw") return;
      
      const feedback = data as VivoFeedbackRaw;
      this.recordFeedback(feedback, logger);

    } catch (error: any) {
      if (logger) logger.error({ error: error.message }, "Vivo feedback handling failed");
    }
  }

  private handleTradeClosed(data: any, bus: any, logger: any): void {
    try {
      if (data.event !== "trade.summary.closed") return;
      
      const trade = data as TradeSummaryClosed;
      this.recordTrade(trade, logger);
      
      // Trigger calculation if we have enough new data
      const arm = this.state.strategyArms.get(trade.arm);
      if (arm && arm.trades.length % 5 === 0) { // Every 5 trades
        this.calculateStabilityScores(bus, logger);
      }

    } catch (error: any) {
      if (logger) logger.error({ error: error.message }, "Trade closed handling failed");
    }
  }

  private recordFeedback(feedback: VivoFeedbackRaw, logger: any): void {
    const armId = feedback.arm;
    
    let arm = this.state.strategyArms.get(armId);
    if (!arm) {
      arm = this.createNewArm(armId, feedback.strategy);
      this.state.strategyArms.set(armId, arm);
    }

    const feedbackRecord: FeedbackRecord = {
      timestamp: new Date(feedback.timestamp),
      correlationId: feedback.correlationId,
      entryQuality: feedback.feedback.entryQuality,
      executionTime: feedback.feedback.executionTime,
      markOut: feedback.feedback.markOut,
      expectedR: feedback.feedback.expectedR,
      actualR: feedback.feedback.actualR,
      fillRate: feedback.feedback.fillRate,
      latency: feedback.feedback.latency,
      variant: feedback.variant
    };

    arm.feedback.push(feedbackRecord);
    
    // Keep only window size
    if (arm.feedback.length > this.config.windowTrades) {
      arm.feedback = arm.feedback.slice(-this.config.windowTrades);
    }

    arm.stats.lastUpdate = new Date();

    if (logger) logger.debug({ 
      arm: armId, 
      feedbackCount: arm.feedback.length,
      actualR: feedback.feedback.actualR
    }, "Feedback recorded for strategy arm");
  }

  private recordTrade(trade: TradeSummaryClosed, logger: any): void {
    const armId = trade.arm;
    
    let arm = this.state.strategyArms.get(armId);
    if (!arm) {
      arm = this.createNewArm(armId, trade.strategy);
      this.state.strategyArms.set(armId, arm);
    }

    const tradeRecord: TradeRecord = {
      timestamp: new Date(trade.timestamp),
      correlationId: trade.correlationId,
      pnlR: trade.pnlR,
      duration: trade.duration,
      slippage: trade.slippage,
      variant: trade.variant,
      exitReason: trade.exitReason,
      marketCondition: "normal" // Could be enriched from context
    };

    arm.trades.push(tradeRecord);
    
    // Keep only window size
    if (arm.trades.length > this.config.windowTrades) {
      arm.trades = arm.trades.slice(-this.config.windowTrades);
    }

    // Update basic stats
    this.updateArmStats(arm);

    if (logger) logger.debug({ 
      arm: armId, 
      tradeCount: arm.trades.length,
      pnlR: trade.pnlR
    }, "Trade recorded for strategy arm");
  }

  private createNewArm(armId: string, strategy: string): StrategyArm {
    return {
      arm: armId,
      strategy,
      trades: [],
      feedback: [],
      stats: {
        totalTrades: 0,
        avgR: 0,
        stdR: 0,
        winRate: 0,
        avgDuration: 0,
        avgSlippage: 0,
        lastUpdate: new Date()
      },
      scores: {
        current: 0,
        history: []
      }
    };
  }

  private updateArmStats(arm: StrategyArm): void {
    if (arm.trades.length === 0) return;

    const trades = arm.trades;
    
    // Calculate basic stats
    arm.stats.totalTrades = trades.length;
    arm.stats.avgR = trades.reduce((sum, t) => sum + t.pnlR, 0) / trades.length;
    
    // Calculate standard deviation of R
    const variance = trades.reduce((sum, t) => sum + Math.pow(t.pnlR - arm.stats.avgR, 2), 0) / trades.length;
    arm.stats.stdR = Math.sqrt(variance);
    
    // Win rate
    arm.stats.winRate = trades.filter(t => t.pnlR > 0).length / trades.length;
    
    // Average duration
    arm.stats.avgDuration = trades.reduce((sum, t) => sum + t.duration, 0) / trades.length;
    
    // Average slippage
    arm.stats.avgSlippage = trades.reduce((sum, t) => sum + Math.abs(t.slippage), 0) / trades.length;
  }

  private setupCalculationInterval(): void {
    // Calculate scores every 10 minutes
    this.scoreInterval = setInterval(() => {
      if (this.state.strategyArms.size > 0) {
        this.calculateStabilityScores(null, null);
      }
    }, 10 * 60 * 1000);
  }

  private calculateStabilityScores(bus: any, logger: any): void {
    try {
      const startTime = Date.now();
      const scores: Array<any> = [];

      for (const [armId, arm] of this.state.strategyArms.entries()) {
        if (arm.trades.length < this.config.thresholds.minSamples) {
          // Skip arms with insufficient data but record warning
          scores.push(this.createInsufficientDataScore(arm));
          continue;
        }

        const armScore = this.calculateArmStability(arm);
        scores.push(armScore);
      }

      const summary = this.calculateSummary(scores);

      const stabilityScores: StrategyStabilityScores = {
        event: "strategy.stability.scores",
        timestamp: new Date().toISOString(),
        scores,
        summary
      };

      this.state.lastScores = stabilityScores;
      
      // Update calculation stats
      const processingTime = Date.now() - startTime;
      this.updateCalculationStats(processingTime);

      this.emit("strategy.stability.scores", stabilityScores);
      if (bus) bus.emit("strategy.stability.scores", stabilityScores);

      if (logger) logger.info({
        armsAnalyzed: scores.length,
        avgStability: summary.avgStability,
        volatileArms: summary.volatileArms,
        processingTimeMs: processingTime
      }, "Strategy stability scores calculated");

    } catch (error: any) {
      if (logger) logger.error({ error: error.message }, "Stability score calculation failed");
    }
  }

  private calculateArmStability(arm: StrategyArm): any {
    const breakdown = this.calculateStabilityBreakdown(arm);
    const overallScore = this.calculateOverallScore(breakdown);
    const trends = this.calculateTrends(arm);
    const flags = this.generateFlags(arm, overallScore, trends);
    const notes = this.generateNotes(arm, breakdown);
    const riskFactors = this.identifyRiskFactors(arm, breakdown);

    // Update arm's score history
    arm.scores.current = overallScore;
    arm.scores.history.push({
      date: new Date(),
      score: overallScore,
      samples: arm.trades.length
    });

    // Keep only last 30 scores
    if (arm.scores.history.length > 30) {
      arm.scores.history = arm.scores.history.slice(-30);
    }

    return {
      arm: arm.arm,
      strategy: arm.strategy,
      score0to1: overallScore,
      samples: arm.trades.length,
      flags,
      notes,
      breakdown,
      trends,
      riskFactors
    };
  }

  private calculateStabilityBreakdown(arm: StrategyArm): any {
    const trades = arm.trades;
    
    // Standard deviation of R (normalized inverse score)
    const stdRNormalized = Math.min(arm.stats.stdR / this.config.normalization.maxStdR, 1.0);
    const stdRScore = 1.0 - stdRNormalized;

    // Win rate variance (coefficient of variation)
    const winRateVar = this.calculateWinRateVariance(trades);
    const winVarNormalized = Math.min(winRateVar / this.config.normalization.maxWinVar, 1.0);
    const winVarScore = 1.0 - winVarNormalized;

    // Slippage variance
    const slippageVar = this.calculateSlippageVariance(trades);
    const slipVarNormalized = Math.min(slippageVar / this.config.normalization.maxSlipVar, 1.0);
    const slipVarScore = 1.0 - slipVarNormalized;

    // Duration variance
    const durationVar = this.calculateDurationVariance(trades);
    const durationVarNormalized = Math.min(durationVar / this.config.normalization.maxDurationVar, 1.0);
    const durationVarScore = 1.0 - durationVarNormalized;

    return {
      stdR: { value: arm.stats.stdR, score: stdRScore, weight: this.config.weights.stdR },
      winVar: { value: winRateVar, score: winVarScore, weight: this.config.weights.winVar },
      slipVar: { value: slippageVar, score: slipVarScore, weight: this.config.weights.slipVar },
      durationVar: { value: durationVar, score: durationVarScore, weight: this.config.weights.durationVar }
    };
  }

  private calculateWinRateVariance(trades: TradeRecord[]): number {
    if (trades.length < 10) return 0;

    // Calculate rolling win rate over windows of 10 trades
    const windowSize = 10;
    const winRates: number[] = [];

    for (let i = 0; i <= trades.length - windowSize; i++) {
      const window = trades.slice(i, i + windowSize);
      const winRate = window.filter(t => t.pnlR > 0).length / windowSize;
      winRates.push(winRate);
    }

    if (winRates.length < 2) return 0;

    const avgWinRate = winRates.reduce((sum, wr) => sum + wr, 0) / winRates.length;
    const variance = winRates.reduce((sum, wr) => sum + Math.pow(wr - avgWinRate, 2), 0) / winRates.length;
    
    return Math.sqrt(variance);
  }

  private calculateSlippageVariance(trades: TradeRecord[]): number {
    if (trades.length < 2) return 0;

    const slippages = trades.map(t => Math.abs(t.slippage));
    const avgSlippage = slippages.reduce((sum, s) => sum + s, 0) / slippages.length;
    const variance = slippages.reduce((sum, s) => sum + Math.pow(s - avgSlippage, 2), 0) / slippages.length;
    
    return Math.sqrt(variance);
  }

  private calculateDurationVariance(trades: TradeRecord[]): number {
    if (trades.length < 2) return 0;

    const durations = trades.map(t => t.duration);
    const avgDuration = durations.reduce((sum, d) => sum + d, 0) / durations.length;
    const variance = durations.reduce((sum, d) => sum + Math.pow(d - avgDuration, 2), 0) / durations.length;
    
    return Math.sqrt(variance);
  }

  private calculateOverallScore(breakdown: any): number {
    return (
      breakdown.stdR.score * breakdown.stdR.weight +
      breakdown.winVar.score * breakdown.winVar.weight +
      breakdown.slipVar.score * breakdown.slipVar.weight +
      breakdown.durationVar.score * breakdown.durationVar.weight
    );
  }

  private calculateTrends(arm: StrategyArm): any {
    const allTrades = arm.trades;
    if (allTrades.length < 10) {
      return {
        recent: 0,
        overall: 0,
        direction: "stable"
      };
    }

    // Recent trades (last 10)
    const recentTrades = allTrades.slice(-10);
    const recentArm = { ...arm, trades: recentTrades };
    this.updateArmStats(recentArm);
    const recentBreakdown = this.calculateStabilityBreakdown(recentArm);
    const recentScore = this.calculateOverallScore(recentBreakdown);

    // Overall score
    const overallBreakdown = this.calculateStabilityBreakdown(arm);
    const overallScore = this.calculateOverallScore(overallBreakdown);

    // Determine trend direction
    let direction: "improving" | "degrading" | "stable" = "stable";
    const scoreDiff = recentScore - overallScore;
    
    if (scoreDiff > this.config.thresholds.degradingThreshold) {
      direction = "improving";
    } else if (scoreDiff < -this.config.thresholds.degradingThreshold) {
      direction = "degrading";
    }

    return {
      recent: recentScore,
      overall: overallScore,
      direction
    };
  }

  private generateFlags(arm: StrategyArm, score: number, trends: any): string[] {
    const flags: string[] = [];

    if (arm.trades.length < this.config.thresholds.minSamples) {
      flags.push("insufficient_data");
    }

    if (score <= this.config.thresholds.volatile) {
      flags.push("volatile");
    } else if (score >= this.config.thresholds.stable) {
      flags.push("stable");
    }

    if (trends.direction === "degrading") {
      flags.push("degrading");
    } else if (trends.direction === "improving") {
      flags.push("improving");
    }

    // Additional flags based on specific metrics
    if (arm.stats.stdR > 1.5) {
      flags.push("high_variance");
    }

    if (arm.stats.winRate < 0.3) {
      flags.push("low_winrate");
    }

    return flags;
  }

  private generateNotes(arm: StrategyArm, breakdown: any): string[] {
    const notes: string[] = [];

    notes.push(`${arm.trades.length} trades analyzed`);
    notes.push(`Std R: ${breakdown.stdR.value.toFixed(3)} (score: ${(breakdown.stdR.score * 100).toFixed(1)}%)`);
    notes.push(`Win rate: ${(arm.stats.winRate * 100).toFixed(1)}%`);
    notes.push(`Avg duration: ${(arm.stats.avgDuration / 60).toFixed(1)} min`);

    if (breakdown.slipVar.value > 10) {
      notes.push(`High slippage variance: ${breakdown.slipVar.value.toFixed(1)} bps`);
    }

    return notes;
  }

  private identifyRiskFactors(arm: StrategyArm, breakdown: any): string[] {
    const factors: string[] = [];

    if (breakdown.stdR.value > 2.0) {
      factors.push("Extremely high R variance");
    }

    if (breakdown.slipVar.value > 30) {
      factors.push("High execution variance");
    }

    if (arm.stats.winRate < 0.25) {
      factors.push("Very low win rate");
    }

    if (breakdown.durationVar.value > 2000) {
      factors.push("Inconsistent trade duration");
    }

    return factors;
  }

  private createInsufficientDataScore(arm: StrategyArm): any {
    return {
      arm: arm.arm,
      strategy: arm.strategy,
      score0to1: 0,
      samples: arm.trades.length,
      flags: ["insufficient_data"],
      notes: [`Only ${arm.trades.length} trades, need ${this.config.thresholds.minSamples} minimum`],
      breakdown: {
        stdR: { value: 0, score: 0, weight: this.config.weights.stdR },
        winVar: { value: 0, score: 0, weight: this.config.weights.winVar },
        slipVar: { value: 0, score: 0, weight: this.config.weights.slipVar },
        durationVar: { value: 0, score: 0, weight: this.config.weights.durationVar }
      },
      trends: {
        recent: 0,
        overall: 0,
        direction: "stable"
      },
      riskFactors: ["Insufficient data for analysis"]
    };
  }

  private calculateSummary(scores: Array<any>): any {
    const validScores = scores.filter(s => s.samples >= this.config.thresholds.minSamples);
    
    const totalArms = scores.length;
    const avgStability = validScores.length > 0 ? 
      validScores.reduce((sum, s) => sum + s.score0to1, 0) / validScores.length : 0;
    
    const volatileArms = scores.filter(s => s.flags.includes("volatile")).length;
    const stableArms = scores.filter(s => s.flags.includes("stable")).length;

    const recommendedActions: string[] = [];
    
    if (volatileArms > totalArms * 0.3) {
      recommendedActions.push("review_volatile_strategies");
    }
    
    if (avgStability < 0.5) {
      recommendedActions.push("reduce_position_sizes");
    }

    const degradingArms = scores.filter(s => s.flags.includes("degrading")).length;
    if (degradingArms > 0) {
      recommendedActions.push("investigate_degrading_performance");
    }

    return {
      totalArms,
      avgStability,
      volatileArms,
      stableArms,
      recommendedActions
    };
  }

  private updateCalculationStats(processingTimeMs: number): void {
    this.state.stats.totalCalculations++;
    this.state.stats.avgProcessingTime = (
      (this.state.stats.avgProcessingTime * (this.state.stats.totalCalculations - 1)) + processingTimeMs
    ) / this.state.stats.totalCalculations;
    this.state.stats.lastCalculation = new Date();

    // Update recent calculations
    this.state.recentCalculations.push({
      timestamp: new Date(),
      armCount: this.state.strategyArms.size,
      avgStability: this.state.lastScores?.summary.avgStability || 0
    });

    // Keep only last 24 hours
    const cutoff = new Date();
    cutoff.setHours(cutoff.getHours() - 24);
    this.state.recentCalculations = this.state.recentCalculations.filter(c => c.timestamp >= cutoff);
  }

  // Public methods
  getStatus(): any {
    return {
      totalArms: this.state.strategyArms.size,
      lastScores: this.state.lastScores ? {
        timestamp: this.state.lastScores.timestamp,
        avgStability: this.state.lastScores.summary.avgStability,
        volatileArms: this.state.lastScores.summary.volatileArms,
        stableArms: this.state.lastScores.summary.stableArms
      } : null,
      stats: { ...this.state.stats },
      config: {
        windowTrades: this.config.windowTrades,
        thresholds: this.config.thresholds,
        weights: this.config.weights
      },
      recentCalculations: this.state.recentCalculations.slice(-5)
    };
  }

  updateConfig(updates: Partial<StabilityConfig>): void {
    this.config = { ...this.config, ...updates };
  }

  // Force calculation (for testing)
  forceCalculation(bus: any, logger: any): void {
    this.calculateStabilityScores(bus, logger);
  }

  // Get current scores without recalculation
  getCurrentScores(): StrategyStabilityScores | null {
    return this.state.lastScores;
  }

  // Get arm details
  getArmDetails(armId: string): StrategyArm | null {
    return this.state.strategyArms.get(armId) || null;
  }

  // Cleanup
  shutdown(): void {
    if (this.scoreInterval) {
      clearInterval(this.scoreInterval);
    }
  }
}
