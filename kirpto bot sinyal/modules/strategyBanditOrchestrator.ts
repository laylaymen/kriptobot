/**
 * VIVO-30 · strategyBanditOrchestrator.ts
 * Strateji/variant/formation kolları arasında güvenli keşif–istismar (multi-armed bandit) orkestrasyonu.
 * Policy tavanları, risk/guard sinyalleri ve rejim uyumu ile bandit seçimini kısıtlar.
 */

import { EventEmitter } from "events";
import { z } from "zod";

// Zod Schemas for validation
const StrategyCatalogSchema = z.object({
  event: z.literal("strategy.catalog"),
  timestamp: z.string(),
  arms: z.array(z.object({
    name: z.string(),
    variant: z.enum(["base", "aggressive", "conservative"]),
    formationTag: z.string().nullable().optional(),
    timeframes: z.array(z.string()),
    fits: z.array(z.enum(["trend", "range", "breakout", "highVol", "illiquid"])),
    riskClass: z.enum(["low", "mid", "high"]),
    minSamplesToUnlock: z.number(),
    trafficCapPct: z.number()
  }))
});

const ExecutionIntentRequestSchema = z.object({
  event: z.literal("execution.intent.request"),
  timestamp: z.string(),
  symbol: z.string(),
  timeframe: z.string(),
  context: z.object({
    regime: z.string(),
    confidence: z.number().min(0).max(1)
  }),
  audit: z.object({
    requestId: z.string()
  })
});

// Input Event Types
export interface StrategyCatalog extends z.infer<typeof StrategyCatalogSchema> {}

export interface PolicySnapshot {
  event: "policy.snapshot";
  timestamp: string;
  version: number;
  policy: {
    variants: { base: boolean; aggressive: boolean; conservative: boolean; };
    confirmationBounds: { min: number; max: number; };
    dailyMaxTrades: number;
  };
}

export interface RegimeSnapshot {
  event: "regime.snapshot";
  timestamp: string;
  symbol: string;
  timeframe: string;
  regime: "trend" | "range" | "breakout" | "highVol" | "illiquid";
}

export interface FeedbackRaw {
  event: "vivo.feedback.raw";
  timestamp: string;
  scope: {
    symbol: string;
    timeframe: string;
    variant: string;
    formationTag?: string;
  };
  kpis: {
    hit: 0 | 1;
    profitFactor: number;
    rMultiple: number;
    slippageBps: number;
    fees: number;
  };
  samples: { fills: number; };
}

export interface IncidentEvent {
  event: "vivo.feedback.incident" | "risk.incident.open" | "risk.incident.update" | "risk.incident.closed";
  timestamp: string;
  type: "series_loss" | "drawdown_breach" | "execution_anomaly" | "data_staleness" | "exposure_breach";
  severity: "low" | "medium" | "high" | "critical";
  scope: {
    symbol?: string;
    timeframe?: string;
    variant?: string;
  };
}

export interface GuardDirective {
  event: "latency_slip.guard.directive" | "sentry.guard.directive";
  timestamp: string;
  mode: "normal" | "slowdown" | "block_aggressive" | "halt_entry" | "degraded" | "streams_panic";
  expiresAt: string;
}

export interface ExecutionIntentRequest extends z.infer<typeof ExecutionIntentRequestSchema> {}

// Output Event Types
export interface StrategySelectionDecision {
  event: "strategy.selection.decision";
  timestamp: string;
  requestId: string;
  symbol: string;
  timeframe: string;
  mode: "explore" | "exploit" | "safe_fallback" | "blocked";
  selectedArm: {
    name: string;
    variant: "base" | "aggressive" | "conservative";
    formationTag?: string;
  };
  allocationPct: number;
  policyVersion: number;
  reasonCodes: string[];
  constraints: {
    minConfirm: number;
    haltEntry: boolean;
  };
}

export interface StrategyTrafficPlan {
  event: "strategy.traffic.plan";
  timestamp: string;
  symbol: string;
  timeframe: string;
  allocations: Array<{
    arm: string;
    pct: number;
  }>;
  mode: "explore_mix" | "exploit_dominant";
  ttlSec: number;
  reasonCodes: string[];
}

export interface StrategyBanditState {
  event: "strategy.bandit.state";
  timestamp: string;
  arms: Array<{
    arm: string;
    posteriors: {
      hitRate: { alpha: number; beta: number; };
      rMean: { mu: number; sigma: number; };
    };
    trafficSharePct: number;
    safety: {
      cooldownUntil?: string;
      blocked: boolean;
    };
  }>;
}

export interface StrategyBanditMetrics {
  event: "strategy.bandit.metrics";
  timestamp: string;
  exploreRate: number;
  blockedRate: number;
  avgSamplesPerArm: number;
  coldStartActive: boolean;
}

export interface StrategyBanditAlert {
  event: "strategy.bandit.alert";
  timestamp: string;
  level: "info" | "warn" | "error";
  message: string;
  context: {
    arm?: string;
    reasonCodes: string[];
  };
}

// Configuration
export interface BanditOrchestratorConfig {
  bandit: {
    mode: "thompson_ucb_hybrid";
    exploreFloorPct: number;
    exploreCapPct: number;
    coldStartTrafficPct: number;
    minSamplesToExploit: number;
    ucbConfidenceZ: number;
  };
  safety: {
    blockAggressiveWhenGuard: boolean;
    blockWhenStreamsPanic: boolean;
    cooldownOnIncident: Record<string, string>;
  };
  regimeFit: {
    matchBonus: number;
    mismatchPenalty: number;
    highVolPenalty: number;
    illiquidBlock: boolean;
  };
  traffic: {
    rebalanceTtlSec: number;
    perArmCapPct: number;
    perVariantCapPct: Record<string, number>;
  };
  priors: {
    hitRate: { alpha: number; beta: number; };
    rMean: { mu: number; sigma: number; };
  };
  seed: string;
  metricsFlushSec: number;
  tz: string;
}

// Internal state
interface ArmState {
  posteriors: {
    hitRate: { alpha: number; beta: number; };
    rMean: { mu: number; sigma: number; };
  };
  samples: number;
  trafficSharePct: number;
  safety: {
    cooldownUntil?: string;
    blocked: boolean;
  };
  lastUpdateAt: string;
}

interface BanditState {
  arms: Map<string, ArmState>; // ArmKey -> State
  policyVersion: number;
  lastRegimeByTF: Map<string, string>; // symbol:timeframe -> regime
  activeTrafficPlans: Map<string, { plan: StrategyTrafficPlan; expiresAt: Date; }>;
  processedRequestIds: Set<string>;
  guardMode: string;
  guardExpiresAt?: Date;
  catalog?: StrategyCatalog;
}

// Helper classes
class BetaDistribution {
  static sample(alpha: number, beta: number, rng: () => number): number {
    // Simple Beta approximation using Gamma
    const gamma1 = this.gammaApprox(alpha, rng);
    const gamma2 = this.gammaApprox(beta, rng);
    return gamma1 / (gamma1 + gamma2);
  }

  private static gammaApprox(alpha: number, rng: () => number): number {
    // Simple Gamma approximation for alpha > 0
    if (alpha < 1) {
      return Math.pow(rng(), 1 / alpha) * this.gammaApprox(1 + alpha, rng);
    }
    
    const d = alpha - 1/3;
    const c = 1 / Math.sqrt(9 * d);
    
    while (true) {
      let x, v;
      do {
        x = this.normalSample(rng);
        v = 1 + c * x;
      } while (v <= 0);
      
      v = v * v * v;
      const u = rng();
      
      if (u < 1 - 0.0331 * x * x * x * x) {
        return d * v;
      }
      
      if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) {
        return d * v;
      }
    }
  }

  private static normalSample(rng: () => number): number {
    // Box-Muller transform
    const u1 = rng();
    const u2 = rng();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }
}

class GaussianDistribution {
  static sample(mu: number, sigma: number, rng: () => number): number {
    return mu + sigma * BetaDistribution["normalSample"](rng);
  }

  static update(oldMu: number, oldSigma: number, newValue: number, n: number): { mu: number; sigma: number; } {
    // Online Welford-style update
    const newMu = oldMu + (newValue - oldMu) / n;
    const newSigmaSquared = Math.max(0.01, oldSigma * oldSigma + ((newValue - oldMu) * (newValue - newMu) - oldSigma * oldSigma) / n);
    return { mu: newMu, sigma: Math.sqrt(newSigmaSquared) };
  }
}

class DeterministicRNG {
  private seed: number;

  constructor(seedStr: string) {
    this.seed = this.hashSeed(seedStr);
  }

  next(): number {
    // Simple LCG
    this.seed = (this.seed * 1664525 + 1013904223) % Math.pow(2, 32);
    return this.seed / Math.pow(2, 32);
  }

  private hashSeed(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash);
  }
}

export interface StdError { code:string; message:string; details?:Record<string,unknown>; retriable?:boolean; }

export class StrategyBanditOrchestrator extends EventEmitter {
  ver="1.0.0"; src="VIVO-30";
  private config: BanditOrchestratorConfig;
  private state: BanditState;
  private metricsInterval?: NodeJS.Timeout;

  constructor(config?: Partial<BanditOrchestratorConfig>) {
    super();
    this.config = {
      bandit: {
        mode: "thompson_ucb_hybrid",
        exploreFloorPct: 10,
        exploreCapPct: 35,
        coldStartTrafficPct: 20,
        minSamplesToExploit: 30,
        ucbConfidenceZ: 1.0
      },
      safety: {
        blockAggressiveWhenGuard: true,
        blockWhenStreamsPanic: true,
        cooldownOnIncident: {
          "series_loss": "PT30M",
          "drawdown_breach": "PT2H",
          "execution_anomaly": "PT20M"
        }
      },
      regimeFit: {
        matchBonus: 0.02,
        mismatchPenalty: 0.03,
        highVolPenalty: 0.04,
        illiquidBlock: true
      },
      traffic: {
        rebalanceTtlSec: 300,
        perArmCapPct: 60,
        perVariantCapPct: { aggressive: 0, base: 70, conservative: 70 }
      },
      priors: {
        hitRate: { alpha: 2, beta: 3 },
        rMean: { mu: 0.2, sigma: 0.6 }
      },
      seed: "vivo30-bandit",
      metricsFlushSec: 10,
      tz: "Europe/Istanbul",
      ...config
    };

    this.state = {
      arms: new Map(),
      policyVersion: 0,
      lastRegimeByTF: new Map(),
      activeTrafficPlans: new Map(),
      processedRequestIds: new Set(),
      guardMode: "normal"
    };

    this.setupMetricsFlush();
  }

  attach(bus: any, logger: any) {
    bus.on("strategy.catalog", (data: any) => this.handleStrategyCatalog(data, logger));
    bus.on("policy.snapshot", (data: any) => this.handlePolicySnapshot(data, logger));
    bus.on("regime.snapshot", (data: any) => this.handleRegimeSnapshot(data, logger));
    bus.on("vivo.feedback.raw", (data: any) => this.handleFeedbackRaw(data, bus, logger));
    bus.on("risk.incident.open", (data: any) => this.handleIncident(data, logger));
    bus.on("risk.incident.update", (data: any) => this.handleIncident(data, logger));
    bus.on("latency_slip.guard.directive", (data: any) => this.handleGuardDirective(data, logger));
    bus.on("sentry.guard.directive", (data: any) => this.handleGuardDirective(data, logger));
    bus.on("execution.intent.request", (data: any) => this.handleExecutionIntentRequest(data, bus, logger));
  }

  private handleStrategyCatalog(data: any, logger: any): void {
    try {
      const catalog = StrategyCatalogSchema.parse(data);
      this.state.catalog = catalog;
      
      // Initialize arms if not exist
      for (const arm of catalog.arms) {
        for (const timeframe of arm.timeframes) {
          const armKey = this.generateArmKey(arm.name, arm.variant, arm.formationTag, timeframe);
          if (!this.state.arms.has(armKey)) {
            this.state.arms.set(armKey, {
              posteriors: {
                hitRate: { ...this.config.priors.hitRate },
                rMean: { ...this.config.priors.rMean }
              },
              samples: 0,
              trafficSharePct: this.config.bandit.coldStartTrafficPct,
              safety: { blocked: false },
              lastUpdateAt: new Date().toISOString()
            });
          }
        }
      }

      if (logger) logger.info({ arms: catalog.arms.length }, "Strategy catalog updated");

    } catch (error: any) {
      if (logger) logger.error({ error, data }, "VIVO-30 strategy catalog error");
    }
  }

  private handlePolicySnapshot(data: any, logger: any): void {
    try {
      if (data.event === "policy.snapshot") {
        const policy = data as PolicySnapshot;
        this.state.policyVersion = policy.version;
        
        // Update arm safety based on policy
        if (!policy.policy.variants.aggressive) {
          for (const [armKey, armState] of this.state.arms.entries()) {
            if (armKey.includes(":aggressive:")) {
              armState.safety.blocked = true;
            }
          }
        }
      }
    } catch (error: any) {
      if (logger) logger.error({ error, data }, "VIVO-30 policy snapshot error");
    }
  }

  private handleRegimeSnapshot(data: any, logger: any): void {
    try {
      if (data.event === "regime.snapshot") {
        const regime = data as RegimeSnapshot;
        const tfKey = `${regime.symbol}:${regime.timeframe}`;
        this.state.lastRegimeByTF.set(tfKey, regime.regime);
      }
    } catch (error: any) {
      if (logger) logger.error({ error, data }, "VIVO-30 regime snapshot error");
    }
  }

  private handleFeedbackRaw(data: any, bus: any, logger: any): void {
    try {
      if (data.event !== "vivo.feedback.raw") return;
      
      const feedback = data as FeedbackRaw;
      const armKey = this.generateArmKey(
        feedback.scope.symbol, // Assuming symbol is used as strategy name
        feedback.scope.variant,
        feedback.scope.formationTag,
        feedback.scope.timeframe
      );

      const armState = this.state.arms.get(armKey);
      if (!armState) {
        if (logger) logger.warn({ armKey }, "Feedback for unknown arm");
        return;
      }

      // Update posteriors
      armState.posteriors.hitRate.alpha += feedback.kpis.hit;
      armState.posteriors.hitRate.beta += (1 - feedback.kpis.hit);
      
      armState.samples++;
      const newGaussian = GaussianDistribution.update(
        armState.posteriors.rMean.mu,
        armState.posteriors.rMean.sigma,
        feedback.kpis.rMultiple,
        armState.samples
      );
      armState.posteriors.rMean = newGaussian;
      armState.lastUpdateAt = new Date().toISOString();

      // Emit updated state
      this.emitBanditState(bus);

      if (logger) {
        logger.info({ 
          armKey, 
          hit: feedback.kpis.hit, 
          rMultiple: feedback.kpis.rMultiple,
          samples: armState.samples 
        }, "Arm updated with feedback");
      }

    } catch (error: any) {
      if (logger) logger.error({ error, data }, "VIVO-30 feedback raw error");
    }
  }

  private handleIncident(data: any, logger: any): void {
    try {
      const incident = data as IncidentEvent;
      const cooldownDuration = this.config.safety.cooldownOnIncident[incident.type];
      
      if (cooldownDuration && incident.scope.variant) {
        const cooldownUntil = this.addDuration(new Date(), cooldownDuration).toISOString();
        
        // Apply cooldown to matching arms
        for (const [armKey, armState] of this.state.arms.entries()) {
          if (armKey.includes(`:${incident.scope.variant}:`)) {
            armState.safety.cooldownUntil = cooldownUntil;
            if (logger) logger.info({ armKey, cooldownUntil }, "Arm cooldown applied");
          }
        }
      }

    } catch (error: any) {
      if (logger) logger.error({ error, data }, "VIVO-30 incident error");
    }
  }

  private handleGuardDirective(data: any, logger: any): void {
    try {
      const directive = data as GuardDirective;
      this.state.guardMode = directive.mode;
      this.state.guardExpiresAt = new Date(directive.expiresAt);
      
      if (logger) logger.info({ mode: directive.mode, expiresAt: directive.expiresAt }, "Guard directive updated");

    } catch (error: any) {
      if (logger) logger.error({ error, data }, "VIVO-30 guard directive error");
    }
  }

  private handleExecutionIntentRequest(data: any, bus: any, logger: any): void {
    try {
      const request = ExecutionIntentRequestSchema.parse(data);
      
      // Check for idempotency
      if (this.state.processedRequestIds.has(request.audit.requestId)) {
        if (logger) logger.debug({ requestId: request.audit.requestId }, "Request already processed");
        return;
      }

      const decision = this.makeSelection(request, logger);
      bus.emit("strategy.selection.decision", decision);
      
      this.state.processedRequestIds.add(request.audit.requestId);

    } catch (error: any) {
      if (logger) logger.error({ error, data }, "VIVO-30 execution intent request error");
    }
  }

  private makeSelection(request: ExecutionIntentRequest, logger: any): StrategySelectionDecision {
    const { symbol, timeframe, context } = request;
    const reasonCodes: string[] = [];

    // Check guard conditions
    if (this.state.guardMode === "halt_entry" || this.state.guardMode === "streams_panic") {
      return {
        event: "strategy.selection.decision",
        timestamp: new Date().toISOString(),
        requestId: request.audit.requestId,
        symbol,
        timeframe,
        mode: "blocked",
        selectedArm: { name: "blocked", variant: "base" },
        allocationPct: 0,
        policyVersion: this.state.policyVersion,
        reasonCodes: ["guard_blocked"],
        constraints: { minConfirm: 0.5, haltEntry: true }
      };
    }

    // Get eligible arms
    const eligibleArms = this.getEligibleArms(symbol, timeframe, context.regime);
    if (eligibleArms.length === 0) {
      reasonCodes.push("no_eligible_arms");
      return this.safeFallbackDecision(request, reasonCodes);
    }

    // Calculate scores using Thompson Sampling + UCB hybrid
    const armScores = this.calculateArmScores(eligibleArms, symbol, timeframe, context.regime, request.audit.requestId);
    
    // Select best arm
    const bestArm = armScores.reduce((best, current) => current.score > best.score ? current : best);
    
    // Determine mode
    const mode = bestArm.samples < this.config.bandit.minSamplesToExploit ? "explore" : "exploit";
    reasonCodes.push(mode === "explore" ? "thompson_explore" : "thompson_exploit");
    
    if (context.regime === "trend") reasonCodes.push("regime_match");

    return {
      event: "strategy.selection.decision",
      timestamp: new Date().toISOString(),
      requestId: request.audit.requestId,
      symbol,
      timeframe,
      mode,
      selectedArm: {
        name: bestArm.name,
        variant: bestArm.variant,
        formationTag: bestArm.formationTag
      },
      allocationPct: Math.min(100, bestArm.trafficSharePct),
      policyVersion: this.state.policyVersion,
      reasonCodes,
      constraints: {
        minConfirm: 0.58, // Would come from policy
        haltEntry: false
      }
    };
  }

  private getEligibleArms(symbol: string, timeframe: string, regime: string): Array<any> {
    if (!this.state.catalog) return [];

    const eligible: Array<any> = [];
    const now = new Date();

    for (const arm of this.state.catalog.arms) {
      if (!arm.timeframes.includes(timeframe)) continue;
      
      const armKey = this.generateArmKey(arm.name, arm.variant, arm.formationTag, timeframe);
      const armState = this.state.arms.get(armKey);
      if (!armState) continue;

      // Check safety constraints
      if (armState.safety.blocked) continue;
      if (armState.safety.cooldownUntil && new Date(armState.safety.cooldownUntil) > now) continue;

      // Check regime constraints
      if (regime === "illiquid" && this.config.regimeFit.illiquidBlock) continue;

      // Check variant constraints based on guard
      if (arm.variant === "aggressive" && 
          (this.state.guardMode === "block_aggressive" || this.config.safety.blockAggressiveWhenGuard)) {
        continue;
      }

      eligible.push({
        ...arm,
        armKey,
        armState,
        fits: arm.fits
      });
    }

    return eligible;
  }

  private calculateArmScores(eligibleArms: any[], symbol: string, timeframe: string, regime: string, requestId: string): Array<any> {
    const rng = new DeterministicRNG(`${this.config.seed}-${symbol}-${timeframe}-${requestId}`);
    
    return eligibleArms.map(arm => {
      const { posteriors, samples, trafficSharePct } = arm.armState;
      
      // Thompson Sampling
      const hitRate = BetaDistribution.sample(posteriors.hitRate.alpha, posteriors.hitRate.beta, () => rng.next());
      const rMean = GaussianDistribution.sample(posteriors.rMean.mu, posteriors.rMean.sigma, () => rng.next());
      const tsScore = hitRate * Math.max(0, rMean);
      
      // UCB
      const confidence = samples > 0 ? this.config.bandit.ucbConfidenceZ * posteriors.rMean.sigma / Math.sqrt(samples) : 1.0;
      const ucbScore = posteriors.rMean.mu + confidence;
      
      // Hybrid score
      let hybridScore = 0.7 * tsScore + 0.3 * Math.max(0, ucbScore);
      
      // Regime fit adjustment
      if (arm.fits.includes(regime)) {
        hybridScore += this.config.regimeFit.matchBonus;
      } else {
        hybridScore -= this.config.regimeFit.mismatchPenalty;
      }
      
      if (regime === "highVol") {
        hybridScore -= this.config.regimeFit.highVolPenalty;
      }

      return {
        ...arm,
        score: hybridScore,
        tsScore,
        ucbScore,
        samples,
        trafficSharePct
      };
    });
  }

  private safeFallbackDecision(request: ExecutionIntentRequest, reasonCodes: string[]): StrategySelectionDecision {
    return {
      event: "strategy.selection.decision",
      timestamp: new Date().toISOString(),
      requestId: request.audit.requestId,
      symbol: request.symbol,
      timeframe: request.timeframe,
      mode: "safe_fallback",
      selectedArm: { name: "momentum_pullback_M5", variant: "conservative" }, // Conservative fallback
      allocationPct: 50, // Reduced allocation for safety
      policyVersion: this.state.policyVersion,
      reasonCodes: [...reasonCodes, "safe_fallback"],
      constraints: { minConfirm: 0.65, haltEntry: false } // Higher confirmation for safety
    };
  }

  private emitBanditState(bus: any): void {
    const arms: StrategyBanditState["arms"] = [];
    
    for (const [armKey, armState] of this.state.arms.entries()) {
      arms.push({
        arm: armKey,
        posteriors: armState.posteriors,
        trafficSharePct: armState.trafficSharePct,
        safety: armState.safety
      });
    }

    const state: StrategyBanditState = {
      event: "strategy.bandit.state",
      timestamp: new Date().toISOString(),
      arms
    };

    bus.emit("strategy.bandit.state", state);
  }

  private generateArmKey(name: string, variant: string, formationTag?: string, timeframe?: string): string {
    const parts = [name, variant];
    if (formationTag) parts.push(formationTag);
    if (timeframe) parts.push(timeframe);
    return parts.join(":");
  }

  private addDuration(date: Date, duration: string): Date {
    // Simple PT duration parser (PT30M, PT2H)
    const result = new Date(date);
    const match = duration.match(/PT(\d+)([MH])/);
    if (match) {
      const value = parseInt(match[1]);
      const unit = match[2];
      if (unit === 'M') {
        result.setMinutes(result.getMinutes() + value);
      } else if (unit === 'H') {
        result.setHours(result.getHours() + value);
      }
    }
    return result;
  }

  private setupMetricsFlush(): void {
    this.metricsInterval = setInterval(() => {
      this.emitMetrics();
    }, this.config.metricsFlushSec * 1000);
  }

  private emitMetrics(): void {
    const totalArms = this.state.arms.size;
    const blockedArms = Array.from(this.state.arms.values()).filter(arm => arm.safety.blocked).length;
    const coldStartArms = Array.from(this.state.arms.values()).filter(arm => arm.samples < this.config.bandit.minSamplesToExploit).length;
    const avgSamples = Array.from(this.state.arms.values()).reduce((sum, arm) => sum + arm.samples, 0) / Math.max(1, totalArms);

    const metrics: StrategyBanditMetrics = {
      event: "strategy.bandit.metrics",
      timestamp: new Date().toISOString(),
      exploreRate: coldStartArms / Math.max(1, totalArms),
      blockedRate: blockedArms / Math.max(1, totalArms),
      avgSamplesPerArm: avgSamples,
      coldStartActive: coldStartArms > 0
    };

    this.emit("strategy.bandit.metrics", metrics);
  }

  // Public methods
  getStatus(): any {
    return {
      config: this.config,
      state: {
        arms: this.state.arms.size,
        policyVersion: this.state.policyVersion,
        guardMode: this.state.guardMode,
        processedRequests: this.state.processedRequestIds.size
      }
    };
  }

  updateConfig(updates: Partial<BanditOrchestratorConfig>): void {
    this.config = { ...this.config, ...updates };
  }

  // Cleanup
  shutdown(): void {
    if (this.metricsInterval) {
      clearInterval(this.metricsInterval);
    }
  }
}
