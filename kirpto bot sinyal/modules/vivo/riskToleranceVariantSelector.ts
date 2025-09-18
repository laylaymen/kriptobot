/**
 * VIVO-43 · riskToleranceVariantSelector.ts
 * Kullanıcı/hesap geçmişine göre otomatik variant öner (base/aggressive/conservative).
 * Performance analizi ve histerezis ile kademeli yükseltme/düşürme sistemi.
 */

import { EventEmitter } from "events";

// Input Event Types
export interface PerformanceWindow15 {
  event: "performance.window15";
  timestamp: string;
  operator: string;
  period: string; // "15trades"
  stats: {
    avgDrawdownR: number;
    maxDD_R: number;
    avgHoldMin: number;
    abortRate: number; // 0..1
    hitRate: number; // 0..1
    expectancyR: number;
    totalTrades: number;
    avgR: number;
    stdR: number;
    sharpe: number;
    winLossRatio: number;
    profitFactor: number;
  };
  trades: Array<{
    timestamp: string;
    symbol: string;
    strategy: string;
    variant: string;
    pnlR: number;
    duration: number; // minutes
    exitReason: string;
    drawdown: number;
    aborted: boolean;
  }>;
  context: {
    marketCondition: string;
    volatility: number;
    sessionDuration: number;
  };
}

export interface PolicySnapshot {
  event: "policy.snapshot";
  timestamp: string;
  version: string;
  rules: {
    allowedVariants: Array<"conservative" | "base" | "aggressive">;
    maxRisk: number;
    maxExposure: number;
    volatilityThreshold: number;
    emergency: boolean;
  };
  context: {
    marketCondition: string;
    timeOfDay: string;
    session: string;
  };
}

export interface OperatorConsistencyScore {
  event: "operator.consistency.score";
  timestamp: string;
  operator: string;
  period: string;
  score: number; // 0..1
  breakdown: {
    entryTiming: number;
    exitTiming: number;
    sizeConsistency: number;
    ruleFollowing: number;
  };
  flags: string[];
  notes: string[];
}

// Output Event Types
export interface VariantSuggestion {
  event: "variant.suggestion";
  timestamp: string;
  operator: string;
  period: string;
  suggestion: {
    current: "conservative" | "base" | "aggressive";
    suggested: "conservative" | "base" | "aggressive";
    confidence: number; // 0..1
    reasonCodes: string[];
    ruleMatches: Array<{
      rule: string;
      condition: string;
      value: number;
      threshold: number;
      satisfied: boolean;
      weight: number;
    }>;
  };
  hysteresis: {
    consecutiveGood: number;
    consecutivePoor: number;
    promoteReady: boolean;
    demoteTriggered: boolean;
    lastChange: string | null;
    tradesUntilReview: number;
  };
  policy: {
    compliant: boolean;
    restricted: boolean;
    overrides: string[];
  };
  metadata: {
    totalTrades: number;
    avgPerformance: number;
    riskProfile: string;
    confidenceFactors: string[];
    processingTimeMs: number;
  };
}

// Configuration
export interface SelectorConfig {
  rules: {
    highDD: { maxDD_R_gt: number; to: "conservative" | "base" | "aggressive"; weight: number; };
    strongEdge: { hit_gt: number; expR_gt: number; to: "conservative" | "base" | "aggressive"; weight: number; };
    slowStyle: { avgHold_gt_min: number; to: "conservative" | "base" | "aggressive"; weight: number; };
    highAbort: { abortRate_gt: number; to: "conservative" | "base" | "aggressive"; weight: number; };
    lowConsistency: { consistency_lt: number; to: "conservative" | "base" | "aggressive"; weight: number; };
    highVolatility: { stdR_gt: number; to: "conservative" | "base" | "aggressive"; weight: number; };
    newTrader: { totalTrades_lt: number; to: "conservative" | "base" | "aggressive"; weight: number; };
  };
  hysteresis: {
    promoteAfterTrades: number;
    demoteAfterTrades: number;
    requirementWindow: number; // trades to consider
    goodPerformanceThreshold: number; // R threshold for "good" trade
    poorPerformanceThreshold: number; // R threshold for "poor" trade
  };
  weights: {
    performanceWeight: number;
    riskWeight: number;
    consistencyWeight: number;
    policyWeight: number;
  };
  confidence: {
    minTrades: number;
    maxConfidence: number;
    baseConfidence: number;
    ruleMatchBonus: number;
  };
  tz: string;
}

// Internal state interfaces
interface OperatorState {
  operator: string;
  currentVariant: "conservative" | "base" | "aggressive";
  lastPerformance: PerformanceWindow15 | null;
  lastConsistency: OperatorConsistencyScore | null;
  history: Array<{
    timestamp: Date;
    variant: string;
    performance: any;
    reason: string;
  }>;
  hysteresis: {
    consecutiveGood: number;
    consecutivePoor: number;
    lastChange: Date | null;
    lastVariant: string | null;
  };
  stats: {
    totalSuggestions: number;
    promotions: number;
    demotions: number;
    lastUpdate: Date;
  };
}

interface SelectorState {
  operators: Map<string, OperatorState>;
  lastPolicy: PolicySnapshot | null;
  recentSuggestions: Array<{
    timestamp: Date;
    operator: string;
    suggested: string;
    confidence: number;
    reasonCodes: string[];
  }>;
  stats: {
    totalSuggestions: number;
    avgProcessingTime: number;
    lastProcessing: Date | null;
  };
}

export interface StdError { code:string; message:string; details?:Record<string,unknown>; retriable?:boolean; }

export class RiskToleranceVariantSelector extends EventEmitter {
  ver="1.0.0"; src="VIVO-43";
  private config: SelectorConfig;
  private state: SelectorState;

  constructor(config?: Partial<SelectorConfig>) {
    super();
    this.config = {
      rules: {
        highDD: { maxDD_R_gt: 3.0, to: "conservative", weight: 1.0 },
        strongEdge: { hit_gt: 0.56, expR_gt: 0.2, to: "aggressive", weight: 1.2 },
        slowStyle: { avgHold_gt_min: 120, to: "base", weight: 0.8 },
        highAbort: { abortRate_gt: 0.3, to: "conservative", weight: 1.1 },
        lowConsistency: { consistency_lt: 0.4, to: "conservative", weight: 1.3 },
        highVolatility: { stdR_gt: 2.0, to: "conservative", weight: 1.0 },
        newTrader: { totalTrades_lt: 50, to: "conservative", weight: 0.9 }
      },
      hysteresis: {
        promoteAfterTrades: 10,
        demoteAfterTrades: 5,
        requirementWindow: 15,
        goodPerformanceThreshold: 0.5, // R > 0.5 is "good"
        poorPerformanceThreshold: -0.3 // R < -0.3 is "poor"
      },
      weights: {
        performanceWeight: 0.4,
        riskWeight: 0.3,
        consistencyWeight: 0.2,
        policyWeight: 0.1
      },
      confidence: {
        minTrades: 10,
        maxConfidence: 0.95,
        baseConfidence: 0.6,
        ruleMatchBonus: 0.1
      },
      tz: "Europe/Istanbul",
      ...config
    };

    this.state = {
      operators: new Map(),
      lastPolicy: null,
      recentSuggestions: [],
      stats: {
        totalSuggestions: 0,
        avgProcessingTime: 0,
        lastProcessing: null
      }
    };
  }

  attach(bus: any, logger: any) {
    bus.on("performance.window15", (data: any) => this.handlePerformanceWindow(data, bus, logger));
    bus.on("policy.snapshot", (data: any) => this.handlePolicySnapshot(data, logger));
    bus.on("operator.consistency.score", (data: any) => this.handleConsistencyScore(data, logger));
  }

  private handlePerformanceWindow(data: any, bus: any, logger: any): void {
    try {
      if (data.event !== "performance.window15") return;
      
      const performance = data as PerformanceWindow15;
      const startTime = Date.now();

      const suggestion = this.generateVariantSuggestion(performance, logger);
      const processingTime = Date.now() - startTime;

      this.updateOperatorState(performance);
      this.updateGlobalStats(processingTime);
      this.recordRecentSuggestion(suggestion);

      this.emit("variant.suggestion", suggestion);
      if (bus) bus.emit("variant.suggestion", suggestion);

      if (logger) logger.info({
        operator: performance.operator,
        current: suggestion.suggestion.current,
        suggested: suggestion.suggestion.suggested,
        confidence: suggestion.suggestion.confidence,
        reasonCodes: suggestion.suggestion.reasonCodes,
        processingTimeMs: processingTime
      }, "Variant suggestion generated");

    } catch (error: any) {
      if (logger) logger.error({ error: error.message }, "Performance window handling failed");
    }
  }

  private handlePolicySnapshot(data: any, logger: any): void {
    try {
      if (data.event !== "policy.snapshot") return;
      
      this.state.lastPolicy = data as PolicySnapshot;

      if (logger) logger.debug({ 
        version: data.version,
        allowedVariants: data.rules.allowedVariants,
        emergency: data.rules.emergency
      }, "Policy snapshot updated");

    } catch (error: any) {
      if (logger) logger.error({ error: error.message }, "Policy snapshot handling failed");
    }
  }

  private handleConsistencyScore(data: any, logger: any): void {
    try {
      if (data.event !== "operator.consistency.score") return;
      
      const consistency = data as OperatorConsistencyScore;
      
      let operatorState = this.state.operators.get(consistency.operator);
      if (!operatorState) {
        operatorState = this.createOperatorState(consistency.operator);
        this.state.operators.set(consistency.operator, operatorState);
      }

      operatorState.lastConsistency = consistency;

      if (logger) logger.debug({ 
        operator: consistency.operator,
        score: consistency.score,
        flags: consistency.flags
      }, "Consistency score updated");

    } catch (error: any) {
      if (logger) logger.error({ error: error.message }, "Consistency score handling failed");
    }
  }

  private generateVariantSuggestion(performance: PerformanceWindow15, logger: any): VariantSuggestion {
    let operatorState = this.state.operators.get(performance.operator);
    if (!operatorState) {
      operatorState = this.createOperatorState(performance.operator);
      this.state.operators.set(performance.operator, operatorState);
    }

    operatorState.lastPerformance = performance;

    // Analyze rules
    const ruleAnalysis = this.analyzeRules(performance, operatorState);
    
    // Calculate hysteresis
    const hysteresisAnalysis = this.analyzeHysteresis(performance, operatorState);
    
    // Apply policy constraints
    const policyAnalysis = this.applyPolicyConstraints(ruleAnalysis.suggestedVariant);
    
    // Calculate final suggestion
    const finalSuggestion = this.calculateFinalSuggestion(
      ruleAnalysis, hysteresisAnalysis, policyAnalysis, operatorState
    );

    const suggestion: VariantSuggestion = {
      event: "variant.suggestion",
      timestamp: new Date().toISOString(),
      operator: performance.operator,
      period: performance.period,
      suggestion: finalSuggestion,
      hysteresis: hysteresisAnalysis,
      policy: policyAnalysis,
      metadata: {
        totalTrades: performance.stats.totalTrades,
        avgPerformance: performance.stats.avgR,
        riskProfile: this.calculateRiskProfile(performance),
        confidenceFactors: this.identifyConfidenceFactors(performance, ruleAnalysis),
        processingTimeMs: 0 // Will be filled later
      }
    };

    return suggestion;
  }

  private analyzeRules(performance: PerformanceWindow15, operatorState: OperatorState): any {
    const ruleMatches: Array<any> = [];
    const reasonCodes: string[] = [];
    let totalScore = 0;
    let totalWeight = 0;
    const variantVotes: Map<string, number> = new Map();

    // Initialize votes
    variantVotes.set("conservative", 0);
    variantVotes.set("base", 0);
    variantVotes.set("aggressive", 0);

    // Check each rule
    for (const [ruleName, rule] of Object.entries(this.config.rules)) {
      const ruleMatch = this.evaluateRule(ruleName, rule, performance, operatorState);
      ruleMatches.push(ruleMatch);

      if (ruleMatch.satisfied) {
        const currentVote = variantVotes.get(rule.to) || 0;
        variantVotes.set(rule.to, currentVote + rule.weight);
        totalScore += rule.weight;
        reasonCodes.push(`${ruleName}_triggered`);
      }
      
      totalWeight += rule.weight;
    }

    // Find highest voted variant
    let suggestedVariant: "conservative" | "base" | "aggressive" = "base";
    let maxVotes = 0;
    
    for (const [variant, votes] of variantVotes.entries()) {
      if (votes > maxVotes) {
        maxVotes = votes;
        suggestedVariant = variant as any;
      }
    }

    // Calculate confidence based on rule strength
    const confidence = Math.min(
      this.config.confidence.baseConfidence + 
      (totalScore / totalWeight) * this.config.confidence.ruleMatchBonus,
      this.config.confidence.maxConfidence
    );

    return {
      suggestedVariant,
      confidence,
      reasonCodes,
      ruleMatches,
      totalScore,
      totalWeight
    };
  }

  private evaluateRule(ruleName: string, rule: any, performance: PerformanceWindow15, operatorState: OperatorState): any {
    const stats = performance.stats;
    const consistency = operatorState.lastConsistency?.score || 1.0;

    switch (ruleName) {
      case "highDD":
        return {
          rule: ruleName,
          condition: "maxDD_R > threshold",
          value: stats.maxDD_R,
          threshold: rule.maxDD_R_gt,
          satisfied: stats.maxDD_R > rule.maxDD_R_gt,
          weight: rule.weight
        };

      case "strongEdge":
        return {
          rule: ruleName,
          condition: "hitRate > threshold AND expectancyR > threshold",
          value: stats.hitRate,
          threshold: rule.hit_gt,
          satisfied: stats.hitRate > rule.hit_gt && stats.expectancyR > rule.expR_gt,
          weight: rule.weight
        };

      case "slowStyle":
        return {
          rule: ruleName,
          condition: "avgHoldMin > threshold",
          value: stats.avgHoldMin,
          threshold: rule.avgHold_gt_min,
          satisfied: stats.avgHoldMin > rule.avgHold_gt_min,
          weight: rule.weight
        };

      case "highAbort":
        return {
          rule: ruleName,
          condition: "abortRate > threshold",
          value: stats.abortRate,
          threshold: rule.abortRate_gt,
          satisfied: stats.abortRate > rule.abortRate_gt,
          weight: rule.weight
        };

      case "lowConsistency":
        return {
          rule: ruleName,
          condition: "consistency < threshold",
          value: consistency,
          threshold: rule.consistency_lt,
          satisfied: consistency < rule.consistency_lt,
          weight: rule.weight
        };

      case "highVolatility":
        return {
          rule: ruleName,
          condition: "stdR > threshold",
          value: stats.stdR,
          threshold: rule.stdR_gt,
          satisfied: stats.stdR > rule.stdR_gt,
          weight: rule.weight
        };

      case "newTrader":
        return {
          rule: ruleName,
          condition: "totalTrades < threshold",
          value: stats.totalTrades,
          threshold: rule.totalTrades_lt,
          satisfied: stats.totalTrades < rule.totalTrades_lt,
          weight: rule.weight
        };

      default:
        return {
          rule: ruleName,
          condition: "unknown",
          value: 0,
          threshold: 0,
          satisfied: false,
          weight: 0
        };
    }
  }

  private analyzeHysteresis(performance: PerformanceWindow15, operatorState: OperatorState): any {
    // Count recent good/poor trades
    const recentTrades = performance.trades.slice(-this.config.hysteresis.requirementWindow);
    
    let consecutiveGood = 0;
    let consecutivePoor = 0;
    
    // Count from end backwards for consecutive
    for (let i = recentTrades.length - 1; i >= 0; i--) {
      const trade = recentTrades[i];
      if (trade.pnlR >= this.config.hysteresis.goodPerformanceThreshold) {
        if (consecutivePoor === 0) consecutiveGood++;
        else break;
      } else if (trade.pnlR <= this.config.hysteresis.poorPerformanceThreshold) {
        if (consecutiveGood === 0) consecutivePoor++;
        else break;
      } else {
        break; // Neutral trade breaks streak
      }
    }

    operatorState.hysteresis.consecutiveGood = consecutiveGood;
    operatorState.hysteresis.consecutivePoor = consecutivePoor;

    const promoteReady = consecutiveGood >= this.config.hysteresis.promoteAfterTrades;
    const demoteTriggered = consecutivePoor >= this.config.hysteresis.demoteAfterTrades;

    const tradesUntilReview = Math.max(
      this.config.hysteresis.promoteAfterTrades - consecutiveGood,
      this.config.hysteresis.demoteAfterTrades - consecutivePoor,
      0
    );

    return {
      consecutiveGood,
      consecutivePoor,
      promoteReady,
      demoteTriggered,
      lastChange: operatorState.hysteresis.lastChange?.toISOString() || null,
      tradesUntilReview
    };
  }

  private applyPolicyConstraints(suggestedVariant: string): any {
    if (!this.state.lastPolicy) {
      return { compliant: true, restricted: false, overrides: [] };
    }

    const policy = this.state.lastPolicy;
    const compliant = policy.rules.allowedVariants.includes(suggestedVariant as any);
    const restricted = policy.rules.emergency || policy.rules.allowedVariants.length < 3;
    const overrides: string[] = [];

    if (!compliant) {
      overrides.push("variant_not_allowed");
    }

    if (policy.rules.emergency) {
      overrides.push("emergency_mode");
    }

    return { compliant, restricted, overrides };
  }

  private calculateFinalSuggestion(ruleAnalysis: any, hysteresisAnalysis: any, policyAnalysis: any, operatorState: OperatorState): any {
    let suggested = ruleAnalysis.suggestedVariant;
    let confidence = ruleAnalysis.confidence;
    const reasonCodes = [...ruleAnalysis.reasonCodes];

    // Apply hysteresis logic
    if (hysteresisAnalysis.demoteTriggered) {
      suggested = this.demoteVariant(operatorState.currentVariant);
      reasonCodes.push("hysteresis_demote");
      confidence *= 0.9;
    } else if (hysteresisAnalysis.promoteReady && suggested !== "conservative") {
      suggested = this.promoteVariant(operatorState.currentVariant);
      reasonCodes.push("hysteresis_promote");
      confidence *= 1.1;
    }

    // Apply policy constraints
    if (!policyAnalysis.compliant) {
      suggested = this.findCompliantVariant(suggested, policyAnalysis);
      reasonCodes.push(...policyAnalysis.overrides);
      confidence *= 0.8;
    }

    // Adjust confidence based on trade count
    if (operatorState.lastPerformance && operatorState.lastPerformance.stats.totalTrades < this.config.confidence.minTrades) {
      confidence *= 0.7;
      reasonCodes.push("insufficient_history");
    }

    return {
      current: operatorState.currentVariant,
      suggested: suggested as "conservative" | "base" | "aggressive",
      confidence: Math.max(Math.min(confidence, this.config.confidence.maxConfidence), 0.1),
      reasonCodes,
      ruleMatches: ruleAnalysis.ruleMatches
    };
  }

  private demoteVariant(current: string): "conservative" | "base" | "aggressive" {
    switch (current) {
      case "aggressive": return "base";
      case "base": return "conservative";
      case "conservative": return "conservative";
      default: return "conservative";
    }
  }

  private promoteVariant(current: string): "conservative" | "base" | "aggressive" {
    switch (current) {
      case "conservative": return "base";
      case "base": return "aggressive";
      case "aggressive": return "aggressive";
      default: return "base";
    }
  }

  private findCompliantVariant(suggested: string, policyAnalysis: any): "conservative" | "base" | "aggressive" {
    if (!this.state.lastPolicy) return suggested as any;

    const allowed = this.state.lastPolicy.rules.allowedVariants;
    
    // Try to find closest allowed variant
    if (suggested === "aggressive" && !allowed.includes("aggressive")) {
      return allowed.includes("base") ? "base" : "conservative";
    }
    
    if (suggested === "base" && !allowed.includes("base")) {
      return allowed.includes("conservative") ? "conservative" : "aggressive";
    }
    
    return allowed[0] || "conservative";
  }

  private calculateRiskProfile(performance: PerformanceWindow15): string {
    const stats = performance.stats;
    
    if (stats.maxDD_R > 3.0 || stats.stdR > 2.0) return "high_risk";
    if (stats.maxDD_R < 1.0 && stats.stdR < 0.8) return "low_risk";
    return "medium_risk";
  }

  private identifyConfidenceFactors(performance: PerformanceWindow15, ruleAnalysis: any): string[] {
    const factors: string[] = [];
    
    if (performance.stats.totalTrades >= this.config.confidence.minTrades) {
      factors.push("sufficient_history");
    }
    
    if (ruleAnalysis.totalScore > ruleAnalysis.totalWeight * 0.5) {
      factors.push("strong_rule_signals");
    }
    
    if (performance.stats.sharpe > 1.0) {
      factors.push("good_risk_adjusted_returns");
    }
    
    return factors;
  }

  private createOperatorState(operator: string): OperatorState {
    return {
      operator,
      currentVariant: "base", // Default starting variant
      lastPerformance: null,
      lastConsistency: null,
      history: [],
      hysteresis: {
        consecutiveGood: 0,
        consecutivePoor: 0,
        lastChange: null,
        lastVariant: null
      },
      stats: {
        totalSuggestions: 0,
        promotions: 0,
        demotions: 0,
        lastUpdate: new Date()
      }
    };
  }

  private updateOperatorState(performance: PerformanceWindow15): void {
    const operatorState = this.state.operators.get(performance.operator);
    if (!operatorState) return;

    operatorState.history.push({
      timestamp: new Date(),
      variant: operatorState.currentVariant,
      performance: {
        avgR: performance.stats.avgR,
        hitRate: performance.stats.hitRate,
        maxDD_R: performance.stats.maxDD_R
      },
      reason: "performance_update"
    });

    // Keep only last 50 history entries
    if (operatorState.history.length > 50) {
      operatorState.history = operatorState.history.slice(-50);
    }

    operatorState.stats.totalSuggestions++;
    operatorState.stats.lastUpdate = new Date();
  }

  private updateGlobalStats(processingTime: number): void {
    this.state.stats.totalSuggestions++;
    this.state.stats.avgProcessingTime = (
      (this.state.stats.avgProcessingTime * (this.state.stats.totalSuggestions - 1)) + processingTime
    ) / this.state.stats.totalSuggestions;
    this.state.stats.lastProcessing = new Date();
  }

  private recordRecentSuggestion(suggestion: VariantSuggestion): void {
    this.state.recentSuggestions.push({
      timestamp: new Date(suggestion.timestamp),
      operator: suggestion.operator,
      suggested: suggestion.suggestion.suggested,
      confidence: suggestion.suggestion.confidence,
      reasonCodes: suggestion.suggestion.reasonCodes
    });

    // Keep only last 100 suggestions
    if (this.state.recentSuggestions.length > 100) {
      this.state.recentSuggestions = this.state.recentSuggestions.slice(-100);
    }
  }

  // Public methods
  getStatus(): any {
    return {
      operators: Array.from(this.state.operators.entries()).map(([operator, state]) => ({
        operator,
        currentVariant: state.currentVariant,
        totalSuggestions: state.stats.totalSuggestions,
        lastUpdate: state.stats.lastUpdate,
        consecutiveGood: state.hysteresis.consecutiveGood,
        consecutivePoor: state.hysteresis.consecutivePoor
      })),
      globalStats: { ...this.state.stats },
      recentSuggestions: this.state.recentSuggestions.slice(-10),
      config: {
        rules: this.config.rules,
        hysteresis: this.config.hysteresis,
        confidence: this.config.confidence
      }
    };
  }

  updateConfig(updates: Partial<SelectorConfig>): void {
    this.config = { ...this.config, ...updates };
  }

  // Force suggestion for testing
  forceSuggestion(performanceData: any, bus: any, logger: any): void {
    this.handlePerformanceWindow(performanceData, bus, logger);
  }

  // Get operator details
  getOperatorState(operator: string): OperatorState | null {
    return this.state.operators.get(operator) || null;
  }

  // Set operator current variant (for initialization)
  setOperatorVariant(operator: string, variant: "conservative" | "base" | "aggressive"): void {
    let operatorState = this.state.operators.get(operator);
    if (!operatorState) {
      operatorState = this.createOperatorState(operator);
      this.state.operators.set(operator, operatorState);
    }
    
    operatorState.currentVariant = variant;
    operatorState.hysteresis.lastChange = new Date();
    operatorState.hysteresis.lastVariant = variant;
  }
}
