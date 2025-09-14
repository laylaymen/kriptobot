/**
 * VIVO-42 · biasWeightedSignalTuner.ts
 * LIVIA/öznel bias ağırlıklarına ve QA tag'lerine göre sinyal varyantını otomatik ayarlama.
 * Psikolojik bias'lara dayalı risk profili ayarlaması.
 */

import { EventEmitter } from "events";

// Input Event Types
export interface LiviaBiasWeights {
  event: "livia.bias.weights";
  timestamp: string;
  correlationId: string;
  operator: string;
  session: string;
  biases: {
    overconfidence: number; // 0..1
    lossAversion: number; // 0..1
    riskSeeking: number; // 0..1
    anchoring: number; // 0..1
    confirmationBias: number; // 0..1
    fomo: number; // 0..1
  };
  confidence: number; // Analysis confidence
  context: {
    sessionDuration: number; // minutes
    recentLosses: number;
    recentWins: number;
    marketCondition: string;
  };
  tags: string[];
}

export interface QaTags {
  event: "qa.tags";
  timestamp: string;
  correlationId: string;
  symbol: string;
  strategy: string;
  tags: Array<{
    category: "execution" | "signal" | "risk" | "market" | "operator";
    tag: string;
    severity: "low" | "medium" | "high";
    confidence: number;
    description: string;
  }>;
  summary: {
    riskScore: number; // 0..1
    qualityScore: number; // 0..1
    operatorScore: number; // 0..1
    flags: string[];
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

// Output Event Types
export interface SignalVariantTuned {
  event: "signal.variant.tuned";
  timestamp: string;
  correlationId: string;
  operator: string;
  symbol: string;
  strategy: string;
  tuning: {
    originalVariant: "conservative" | "base" | "aggressive";
    adjustedVariant: "conservative" | "base" | "aggressive";
    confidence: number;
    reasonCodes: string[];
    biasImpacts: Array<{
      bias: string;
      weight: number;
      impact: string;
      adjustment: string;
    }>;
  };
  policy: {
    compliant: boolean;
    restricted: boolean;
    overrides: string[];
  };
  clamps: {
    tpClamped: boolean;
    slClamped: boolean;
    sizeClamped: boolean;
    variantForced: boolean;
  };
  metadata: {
    sessionDuration: number;
    operatorConsistency: number;
    qaRiskScore: number;
    processingTimeMs: number;
  };
}

// Configuration
export interface TunerConfig {
  rules: {
    overconfidenceThreshold: number;
    lossAversionThreshold: number;
    riskSeekingThreshold: number;
    fomoThreshold: number;
    anchoringThreshold: number;
    confirmationThreshold: number;
  };
  adjustments: {
    overconfidenceHigh: { to: "conservative" | "base" | "aggressive"; clampTP: boolean; };
    lossAversionHigh: { to: "conservative" | "base" | "aggressive"; clampTP: boolean; };
    riskSeekingHigh: { to: "conservative" | "base" | "aggressive"; };
    fomoHigh: { to: "conservative" | "base" | "aggressive"; clampSL: boolean; };
    lowConsistency: { to: "conservative" | "base" | "aggressive"; };
    highQaRisk: { to: "conservative" | "base" | "aggressive"; };
    volatileMarket: { to: "conservative" | "base" | "aggressive"; };
  };
  thresholds: {
    consistencyLow: number;
    qaRiskHigh: number;
    sessionLong: number; // minutes
    recentLossesHigh: number;
  };
  weights: {
    biasWeight: number;
    consistencyWeight: number;
    qaWeight: number;
    policyWeight: number;
  };
  clamps: {
    tpReductionPct: number;
    slTightenPct: number;
    sizeReductionPct: number;
  };
  tz: string;
}

// Internal state interfaces
interface TuningState {
  lastBiases: LiviaBiasWeights | null;
  lastQaTags: QaTags | null;
  lastConsistency: OperatorConsistencyScore | null;
  lastPolicy: PolicySnapshot | null;
  recentTunings: Array<{
    timestamp: Date;
    operator: string;
    originalVariant: string;
    adjustedVariant: string;
    reasonCodes: string[];
  }>;
  stats: {
    totalTunings: number;
    conservativeAdjustments: number;
    baseAdjustments: number;
    aggressiveAdjustments: number;
    avgProcessingTime: number;
    lastProcessing: Date | null;
  };
}

export interface StdError { code:string; message:string; details?:Record<string,unknown>; retriable?:boolean; }

export class BiasWeightedSignalTuner extends EventEmitter {
  ver="1.0.0"; src="VIVO-42";
  private config: TunerConfig;
  private state: TuningState;

  constructor(config?: Partial<TunerConfig>) {
    super();
    this.config = {
      rules: {
        overconfidenceThreshold: 0.6,
        lossAversionThreshold: 0.7,
        riskSeekingThreshold: 0.8,
        fomoThreshold: 0.7,
        anchoringThreshold: 0.6,
        confirmationThreshold: 0.5
      },
      adjustments: {
        overconfidenceHigh: { to: "conservative", clampTP: true },
        lossAversionHigh: { to: "base", clampTP: true },
        riskSeekingHigh: { to: "conservative" },
        fomoHigh: { to: "conservative", clampSL: true },
        lowConsistency: { to: "conservative" },
        highQaRisk: { to: "conservative" },
        volatileMarket: { to: "conservative" }
      },
      thresholds: {
        consistencyLow: 0.4,
        qaRiskHigh: 0.7,
        sessionLong: 240, // 4 hours
        recentLossesHigh: 3
      },
      weights: {
        biasWeight: 0.4,
        consistencyWeight: 0.3,
        qaWeight: 0.2,
        policyWeight: 0.1
      },
      clamps: {
        tpReductionPct: 20,
        slTightenPct: 15,
        sizeReductionPct: 25
      },
      tz: "Europe/Istanbul",
      ...config
    };

    this.state = {
      lastBiases: null,
      lastQaTags: null,
      lastConsistency: null,
      lastPolicy: null,
      recentTunings: [],
      stats: {
        totalTunings: 0,
        conservativeAdjustments: 0,
        baseAdjustments: 0,
        aggressiveAdjustments: 0,
        avgProcessingTime: 0,
        lastProcessing: null
      }
    };
  }

  attach(bus: any, logger: any) {
    bus.on("livia.bias.weights", (data: any) => this.handleBiasWeights(data, logger));
    bus.on("qa.tags", (data: any) => this.handleQaTags(data, logger));
    bus.on("operator.consistency.score", (data: any) => this.handleConsistencyScore(data, logger));
    bus.on("policy.snapshot", (data: any) => this.handlePolicySnapshot(data, logger));
    
    // Listen for signal requests to tune
    bus.on("signal.request", (data: any) => this.tuneSignalVariant(data, bus, logger));
  }

  private handleBiasWeights(data: any, logger: any): void {
    try {
      if (data.event !== "livia.bias.weights") return;
      
      this.state.lastBiases = data as LiviaBiasWeights;

      if (logger) logger.debug({ 
        operator: data.operator,
        overconfidence: data.biases.overconfidence,
        lossAversion: data.biases.lossAversion,
        riskSeeking: data.biases.riskSeeking
      }, "Bias weights updated");

    } catch (error: any) {
      if (logger) logger.error({ error: error.message }, "Bias weights handling failed");
    }
  }

  private handleQaTags(data: any, logger: any): void {
    try {
      if (data.event !== "qa.tags") return;
      
      this.state.lastQaTags = data as QaTags;

      if (logger) logger.debug({ 
        symbol: data.symbol,
        riskScore: data.summary.riskScore,
        qualityScore: data.summary.qualityScore,
        tagCount: data.tags.length
      }, "QA tags updated");

    } catch (error: any) {
      if (logger) logger.error({ error: error.message }, "QA tags handling failed");
    }
  }

  private handleConsistencyScore(data: any, logger: any): void {
    try {
      if (data.event !== "operator.consistency.score") return;
      
      this.state.lastConsistency = data as OperatorConsistencyScore;

      if (logger) logger.debug({ 
        operator: data.operator,
        score: data.score,
        flags: data.flags
      }, "Consistency score updated");

    } catch (error: any) {
      if (logger) logger.error({ error: error.message }, "Consistency score handling failed");
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

  private tuneSignalVariant(signalData: any, bus: any, logger: any): void {
    try {
      if (!signalData.variant || !signalData.operator) return;

      const startTime = Date.now();
      const tuning = this.performVariantTuning(signalData, logger);
      const processingTime = Date.now() - startTime;

      const tunedSignal: SignalVariantTuned = {
        event: "signal.variant.tuned",
        timestamp: new Date().toISOString(),
        correlationId: signalData.correlationId || this.generateCorrelationId(),
        operator: signalData.operator,
        symbol: signalData.symbol || "UNKNOWN",
        strategy: signalData.strategy || "UNKNOWN",
        tuning,
        policy: this.evaluatePolicyCompliance(tuning.adjustedVariant),
        clamps: this.determineClamps(tuning),
        metadata: {
          sessionDuration: this.getSessionDuration(),
          operatorConsistency: this.state.lastConsistency?.score || 0,
          qaRiskScore: this.state.lastQaTags?.summary.riskScore || 0,
          processingTimeMs: processingTime
        }
      };

      this.updateTuningStats(tuning, processingTime);
      this.recordRecentTuning(tunedSignal);

      this.emit("signal.variant.tuned", tunedSignal);
      if (bus) bus.emit("signal.variant.tuned", tunedSignal);

      if (logger) logger.info({
        operator: signalData.operator,
        original: tuning.originalVariant,
        adjusted: tuning.adjustedVariant,
        reasonCodes: tuning.reasonCodes,
        processingTimeMs: processingTime
      }, "Signal variant tuned");

    } catch (error: any) {
      if (logger) logger.error({ error: error.message }, "Signal variant tuning failed");
    }
  }

  private performVariantTuning(signalData: any, logger: any): any {
    const originalVariant = signalData.variant;
    let adjustedVariant = originalVariant;
    const reasonCodes: string[] = [];
    const biasImpacts: Array<any> = [];
    let confidence = 1.0;

    // Analyze biases if available
    if (this.state.lastBiases) {
      const biasAnalysis = this.analyzeBiasImpacts(this.state.lastBiases);
      biasImpacts.push(...biasAnalysis.impacts);
      
      if (biasAnalysis.suggestedVariant !== originalVariant) {
        adjustedVariant = biasAnalysis.suggestedVariant;
        reasonCodes.push(...biasAnalysis.reasons);
        confidence *= 0.9; // Reduce confidence when adjusting
      }
    }

    // Analyze operator consistency
    if (this.state.lastConsistency) {
      const consistencyAdjustment = this.analyzeConsistencyImpact(this.state.lastConsistency);
      if (consistencyAdjustment.adjustment) {
        adjustedVariant = this.combineVariantAdjustments(adjustedVariant, consistencyAdjustment.suggestedVariant);
        reasonCodes.push(...consistencyAdjustment.reasons);
        confidence *= 0.85;
      }
    }

    // Analyze QA risk
    if (this.state.lastQaTags) {
      const qaAdjustment = this.analyzeQaRiskImpact(this.state.lastQaTags);
      if (qaAdjustment.adjustment) {
        adjustedVariant = this.combineVariantAdjustments(adjustedVariant, qaAdjustment.suggestedVariant);
        reasonCodes.push(...qaAdjustment.reasons);
        confidence *= 0.8;
      }
    }

    // Apply policy constraints
    if (this.state.lastPolicy) {
      const policyAdjustment = this.applyPolicyConstraints(adjustedVariant, this.state.lastPolicy);
      if (policyAdjustment.forced) {
        adjustedVariant = policyAdjustment.variant;
        reasonCodes.push(...policyAdjustment.reasons);
        confidence *= 0.7;
      }
    }

    return {
      originalVariant,
      adjustedVariant,
      confidence: Math.max(confidence, 0.1),
      reasonCodes,
      biasImpacts
    };
  }

  private analyzeBiasImpacts(biases: LiviaBiasWeights): any {
    const impacts: Array<any> = [];
    const reasons: string[] = [];
    let suggestedVariant = "base";
    
    // Analyze overconfidence
    if (biases.biases.overconfidence >= this.config.rules.overconfidenceThreshold) {
      impacts.push({
        bias: "overconfidence",
        weight: biases.biases.overconfidence,
        impact: "high_risk_tendency",
        adjustment: "reduce_to_conservative"
      });
      suggestedVariant = this.config.adjustments.overconfidenceHigh.to;
      reasons.push("overconfidence_detected");
    }

    // Analyze loss aversion
    if (biases.biases.lossAversion >= this.config.rules.lossAversionThreshold) {
      impacts.push({
        bias: "lossAversion",
        weight: biases.biases.lossAversion,
        impact: "exit_too_early",
        adjustment: "clamp_tp_wider"
      });
      suggestedVariant = this.combineVariantAdjustments(suggestedVariant, this.config.adjustments.lossAversionHigh.to);
      reasons.push("loss_aversion_high");
    }

    // Analyze risk seeking
    if (biases.biases.riskSeeking >= this.config.rules.riskSeekingThreshold) {
      impacts.push({
        bias: "riskSeeking",
        weight: biases.biases.riskSeeking,
        impact: "excessive_risk_taking",
        adjustment: "force_conservative"
      });
      suggestedVariant = this.config.adjustments.riskSeekingHigh.to;
      reasons.push("risk_seeking_excessive");
    }

    // Analyze FOMO
    if (biases.biases.fomo >= this.config.rules.fomoThreshold) {
      impacts.push({
        bias: "fomo",
        weight: biases.biases.fomo,
        impact: "late_entries",
        adjustment: "tighten_stops"
      });
      suggestedVariant = this.combineVariantAdjustments(suggestedVariant, this.config.adjustments.fomoHigh.to);
      reasons.push("fomo_detected");
    }

    // Check session fatigue
    if (biases.context.sessionDuration >= this.config.thresholds.sessionLong) {
      impacts.push({
        bias: "fatigue",
        weight: Math.min(biases.context.sessionDuration / this.config.thresholds.sessionLong, 1.0),
        impact: "degraded_decision_making",
        adjustment: "reduce_complexity"
      });
      suggestedVariant = "conservative";
      reasons.push("session_fatigue");
    }

    // Check recent losses
    if (biases.context.recentLosses >= this.config.thresholds.recentLossesHigh) {
      impacts.push({
        bias: "revenge_trading",
        weight: Math.min(biases.context.recentLosses / this.config.thresholds.recentLossesHigh, 1.0),
        impact: "emotional_decisions",
        adjustment: "force_conservative"
      });
      suggestedVariant = "conservative";
      reasons.push("recent_losses_high");
    }

    return {
      impacts,
      reasons,
      suggestedVariant
    };
  }

  private analyzeConsistencyImpact(consistency: OperatorConsistencyScore): any {
    if (consistency.score >= this.config.thresholds.consistencyLow) {
      return { adjustment: false, suggestedVariant: "base", reasons: [] };
    }

    return {
      adjustment: true,
      suggestedVariant: this.config.adjustments.lowConsistency.to,
      reasons: ["operator_consistency_low", ...consistency.flags]
    };
  }

  private analyzeQaRiskImpact(qaTags: QaTags): any {
    if (qaTags.summary.riskScore < this.config.thresholds.qaRiskHigh) {
      return { adjustment: false, suggestedVariant: "base", reasons: [] };
    }

    const highRiskTags = qaTags.tags.filter(tag => tag.severity === "high");
    const reasons = ["qa_risk_high", ...highRiskTags.map(tag => `qa_${tag.tag}`)];

    return {
      adjustment: true,
      suggestedVariant: this.config.adjustments.highQaRisk.to,
      reasons
    };
  }

  private applyPolicyConstraints(variant: string, policy: PolicySnapshot): any {
    if (policy.rules.allowedVariants.includes(variant as any)) {
      return { forced: false, variant, reasons: [] };
    }

    // If aggressive is not allowed but variant is aggressive
    if (variant === "aggressive" && !policy.rules.allowedVariants.includes("aggressive")) {
      const fallback = policy.rules.allowedVariants.includes("base") ? "base" : "conservative";
      return {
        forced: true,
        variant: fallback,
        reasons: ["policy_aggressive_blocked", `fallback_to_${fallback}`]
      };
    }

    // If only conservative is allowed
    if (policy.rules.allowedVariants.length === 1 && policy.rules.allowedVariants[0] === "conservative") {
      return {
        forced: true,
        variant: "conservative",
        reasons: ["policy_conservative_only"]
      };
    }

    // Emergency mode
    if (policy.rules.emergency) {
      return {
        forced: true,
        variant: "conservative",
        reasons: ["emergency_mode_active"]
      };
    }

    return { forced: false, variant, reasons: [] };
  }

  private combineVariantAdjustments(current: string, suggested: string): string {
    // Conservative always wins
    if (current === "conservative" || suggested === "conservative") {
      return "conservative";
    }
    
    // Base beats aggressive in case of conflict
    if ((current === "base" && suggested === "aggressive") || 
        (current === "aggressive" && suggested === "base")) {
      return "base";
    }
    
    return suggested;
  }

  private evaluatePolicyCompliance(variant: string): any {
    if (!this.state.lastPolicy) {
      return { compliant: true, restricted: false, overrides: [] };
    }

    const policy = this.state.lastPolicy;
    const compliant = policy.rules.allowedVariants.includes(variant as any);
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

  private determineClamps(tuning: any): any {
    const clamps = {
      tpClamped: false,
      slClamped: false,
      sizeClamped: false,
      variantForced: false
    };

    // Check if variant was forced due to biases
    if (tuning.originalVariant !== tuning.adjustedVariant) {
      clamps.variantForced = true;
    }

    // Check bias-specific clamps
    for (const impact of tuning.biasImpacts) {
      if (impact.adjustment.includes("clamp_tp") || impact.adjustment.includes("tp_wider")) {
        clamps.tpClamped = true;
      }
      if (impact.adjustment.includes("tighten_stops") || impact.adjustment.includes("clamp_sl")) {
        clamps.slClamped = true;
      }
      if (impact.adjustment.includes("reduce_size")) {
        clamps.sizeClamped = true;
      }
    }

    return clamps;
  }

  private getSessionDuration(): number {
    return this.state.lastBiases?.context.sessionDuration || 0;
  }

  private generateCorrelationId(): string {
    return `tuner_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private updateTuningStats(tuning: any, processingTime: number): void {
    this.state.stats.totalTunings++;
    
    switch (tuning.adjustedVariant) {
      case "conservative":
        this.state.stats.conservativeAdjustments++;
        break;
      case "base":
        this.state.stats.baseAdjustments++;
        break;
      case "aggressive":
        this.state.stats.aggressiveAdjustments++;
        break;
    }

    this.state.stats.avgProcessingTime = (
      (this.state.stats.avgProcessingTime * (this.state.stats.totalTunings - 1)) + processingTime
    ) / this.state.stats.totalTunings;

    this.state.stats.lastProcessing = new Date();
  }

  private recordRecentTuning(tunedSignal: SignalVariantTuned): void {
    this.state.recentTunings.push({
      timestamp: new Date(tunedSignal.timestamp),
      operator: tunedSignal.operator,
      originalVariant: tunedSignal.tuning.originalVariant,
      adjustedVariant: tunedSignal.tuning.adjustedVariant,
      reasonCodes: tunedSignal.tuning.reasonCodes
    });

    // Keep only last 50 tunings
    if (this.state.recentTunings.length > 50) {
      this.state.recentTunings = this.state.recentTunings.slice(-50);
    }
  }

  // Public methods
  getStatus(): any {
    return {
      state: {
        hasBiases: !!this.state.lastBiases,
        hasQaTags: !!this.state.lastQaTags,
        hasConsistency: !!this.state.lastConsistency,
        hasPolicy: !!this.state.lastPolicy
      },
      stats: { ...this.state.stats },
      recentTunings: this.state.recentTunings.slice(-10),
      config: {
        rules: this.config.rules,
        thresholds: this.config.thresholds,
        weights: this.config.weights
      }
    };
  }

  updateConfig(updates: Partial<TunerConfig>): void {
    this.config = { ...this.config, ...updates };
  }

  // Force tuning for testing
  forceTuning(signalData: any, bus: any, logger: any): void {
    this.tuneSignalVariant(signalData, bus, logger);
  }

  // Get current bias state
  getCurrentBiases(): LiviaBiasWeights | null {
    return this.state.lastBiases;
  }

  // Get tuning recommendations without applying
  getTuningRecommendation(signalData: any): any {
    return this.performVariantTuning(signalData, null);
  }
}
