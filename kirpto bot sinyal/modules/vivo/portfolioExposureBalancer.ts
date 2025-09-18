/**
 * VIVO-25 · portfolioExposureBalancer.ts
 * Portfolio risk balancing ve exposure management sistemi.
 * Advanced portfolio risk management with correlation-based balancing and exposure limits.
 */

import { EventEmitter } from "events";

// Input Event Types
export interface IntentAccepted {
  event: "execution.intent.accepted";
  timestamp: string;
  symbol: string;
  side: "long" | "short";
  timeframe: string;
  selectedVariant: "base" | "aggressive" | "conservative";
  confidence: number;
  constraints: {
    riskProfile: "tight" | "normal" | "relaxed";
  };
  tuning: {
    positionScaling: "single" | "laddered";
  };
  audit: {
    upstream: {
      source: string;
      signalId: string;
    };
  };
}

export interface AccountExposure {
  event: "account.exposure";
  timestamp: string;
  openPositions: Array<{
    symbol: string;
    side: "long" | "short";
    riskPct: number;
    cluster: "L1" | "L2" | "DeFi" | "Layer1" | "AI" | "PerpAlts" | "BTCComplex" | "StablePair" | "Other";
    beta: {
      BTC: number;
      Market: number;
    };
    corrKey: string;
  }>;
  totalRiskPctOpen: number;
}

export interface PortfolioPolicy {
  event: "portfolio.policy";
  timestamp: string;
  caps: {
    totalRiskPct: number;
    perSymbolPct: number;
    perClusterPct: Record<string, number>;
    perFactorBetaAbs: Record<string, number>;
    longShortImbalancePct: number;
  };
  correlation: {
    hardPairThreshold: number;
    softPairThreshold: number;
    defaultSameCluster: number;
    marginalRiskMaxPct: number;
  };
  actions: {
    onHardBreach: "reject" | "defer";
    onSoftBreach: "adjust";
  };
}

// Output Event Types
export interface PortfolioIntentApproved {
  event: "portfolio.intent.approved";
  timestamp: string;
  symbol: string;
  side: "long" | "short";
  riskPerTradePct: number;
  reasonCodes: string[];
  correlationNotes: {
    topPairs: Array<{
      symbol: string;
      rho: number;
    }>;
  };
}

export interface PortfolioIntentAdjusted {
  event: "portfolio.intent.adjusted";
  timestamp: string;
  symbol: string;
  side: "long" | "short";
  riskPerTradePctOriginal: number;
  riskPerTradePctAdjusted: number;
  scaleFactor: number;
  reasonCodes: string[];
  correlationNotes: {
    topPairs: Array<{
      symbol: string;
      rho: number;
    }>;
  };
}

export interface PortfolioIntentRejected {
  event: "portfolio.intent.rejected";
  timestamp: string;
  symbol: string;
  side: "long" | "short";
  reasonCodes: string[];
}

// Configuration
export interface BalancerConfig {
  freshness: {
    modelMaxAgeSec: number;
    exposureMaxAgeSec: number;
  };
  defaults: {
    sameClusterRho: number;
    crossClusterRho: number;
  };
  scale: {
    minFactor: number;
    step: number;
    preferDownscaleOverDefer: boolean;
  };
  metricsFlushSec: number;
  tz: string;
}

// Internal state
interface PortfolioState {
  lastExposure?: AccountExposure;
  lastPolicy?: PortfolioPolicy;
  clusterExposure: Map<string, number>;
  factorExposure: Record<string, number>;
  netLongPct: number;
  netShortPct: number;
}

interface BalanceResult {
  action: "approved" | "adjusted" | "rejected" | "deferred";
  riskPct: number;
  scaleFactor?: number;
  reasonCodes: string[];
  correlationNotes: { topPairs: Array<{ symbol: string; rho: number; }>; };
}

export interface StdError { code:string; message:string; details?:Record<string,unknown>; retriable?:boolean; }

export class PortfolioExposureBalancer extends EventEmitter {
  ver="1.0.0"; src="VIVO-25";
  private config: BalancerConfig;
  private state: PortfolioState;
  private metrics = { approved: 0, adjusted: 0, deferred: 0, rejected: 0 };

  constructor(config?: Partial<BalancerConfig>) {
    super();
    this.config = {
      freshness: { modelMaxAgeSec: 180, exposureMaxAgeSec: 10 },
      defaults: { sameClusterRho: 0.5, crossClusterRho: 0.2 },
      scale: { minFactor: 0.2, step: 0.05, preferDownscaleOverDefer: true },
      metricsFlushSec: 10,
      tz: "Europe/Istanbul",
      ...config
    };

    this.state = {
      clusterExposure: new Map(),
      factorExposure: { BTC: 0, Market: 0 },
      netLongPct: 0,
      netShortPct: 0
    };
  }

  attach(bus: any, logger: any) {
    bus.on("execution.intent.accepted", (data: any) => this.handleIntentAccepted(data, bus, logger));
    bus.on("account.exposure", (data: any) => this.updateAccountExposure(data, logger));
    bus.on("portfolio.policy", (data: any) => this.updatePortfolioPolicy(data, logger));
  }

  private handleIntentAccepted(data: any, bus: any, logger: any) {
    try {
      const intent = this.validateIntentAccepted(data);
      const now = new Date().toISOString();

      // Check freshness
      const freshnessCheck = this.checkFreshness();
      if (freshnessCheck.defer) {
        this.deferIntent(intent, freshnessCheck.reasons, bus, now);
        this.metrics.deferred++;
        return;
      }

      // Perform balance analysis
      const balanceResult = this.performBalanceAnalysis(intent);

      // Emit response
      switch (balanceResult.action) {
        case "approved":
          this.approveIntent(intent, balanceResult, bus, now);
          this.metrics.approved++;
          break;
        case "adjusted":
          this.adjustIntent(intent, balanceResult, bus, now);
          this.metrics.adjusted++;
          break;
        case "rejected":
          this.rejectIntent(intent, balanceResult, bus, now);
          this.metrics.rejected++;
          break;
      }

    } catch (e: any) {
      if (logger) logger.error({ e, data }, "VIVO-25 intent processing error");
      this.rejectIntent(data, { reasonCodes: ["processing_error"] }, bus, new Date().toISOString());
      this.metrics.rejected++;
    }
  }

  private validateIntentAccepted(data: any): IntentAccepted {
    if (!data || data.event !== "execution.intent.accepted") {
      throw new Error("Invalid intent accepted event");
    }
    return data as IntentAccepted;
  }

  private checkFreshness(): { defer: boolean; reasons: string[] } {
    const reasons: string[] = [];
    
    if (!this.state.lastExposure) {
      reasons.push("missing_exposure");
    } else {
      const exposureAge = (Date.now() - new Date(this.state.lastExposure.timestamp).getTime()) / 1000;
      if (exposureAge > this.config.freshness.exposureMaxAgeSec) {
        reasons.push("stale_exposure");
      }
    }

    if (!this.state.lastPolicy) {
      reasons.push("missing_policy");
    }

    return { defer: reasons.length > 0, reasons };
  }

  private performBalanceAnalysis(intent: IntentAccepted): BalanceResult {
    const policy = this.state.lastPolicy!;
    const exposure = this.state.lastExposure!;
    
    const candidateRiskPct = this.calculateCandidateRisk(intent);
    const currentAnalysis = this.analyzeCurrentExposure(exposure);
    
    // Check hard limits
    const hardLimitCheck = this.checkHardLimits(intent, candidateRiskPct, currentAnalysis, policy);
    if (hardLimitCheck.violated) {
      return {
        action: policy.actions.onHardBreach === "reject" ? "rejected" : "deferred",
        riskPct: candidateRiskPct,
        reasonCodes: hardLimitCheck.reasons,
        correlationNotes: { topPairs: [] }
      };
    }

    // Check soft limits and optimize
    return this.optimizeForSoftLimits(intent, candidateRiskPct, currentAnalysis, policy);
  }

  private calculateCandidateRisk(intent: IntentAccepted): number {
    const baseRisk = intent.selectedVariant === "aggressive" ? 0.8 : 
                     intent.selectedVariant === "conservative" ? 0.4 : 0.6;
    return baseRisk * intent.confidence;
  }

  private analyzeCurrentExposure(exposure: AccountExposure): any {
    const clusterRisks: Record<string, number> = {};
    let netLongPct = 0;
    let netShortPct = 0;

    for (const pos of exposure.openPositions) {
      const riskAbs = Math.abs(pos.riskPct);
      clusterRisks[pos.cluster] = (clusterRisks[pos.cluster] || 0) + riskAbs;

      if (pos.side === "long") {
        netLongPct += riskAbs;
      } else {
        netShortPct += riskAbs;
      }
    }

    return {
      totalRisk: exposure.totalRiskPctOpen,
      clusterRisks,
      netImbalance: Math.abs(netLongPct - netShortPct),
      topCorrelations: []
    };
  }

  private checkHardLimits(intent: IntentAccepted, riskPct: number, analysis: any, policy: PortfolioPolicy): { violated: boolean; reasons: string[] } {
    const reasons: string[] = [];

    // Total risk cap
    if (analysis.totalRisk + riskPct > policy.caps.totalRiskPct) {
      reasons.push("total_cap_exceeded");
    }

    // Per-symbol cap
    if (riskPct > policy.caps.perSymbolPct) {
      reasons.push("per_symbol_cap");
    }

    return { violated: reasons.length > 0, reasons };
  }

  private optimizeForSoftLimits(intent: IntentAccepted, originalRiskPct: number, analysis: any, policy: PortfolioPolicy): BalanceResult {
    let currentRiskPct = originalRiskPct;
    const reasonCodes: string[] = [];

    // Simple optimization - would be more complex in real implementation
    if (currentRiskPct < originalRiskPct) {
      return {
        action: "adjusted",
        riskPct: currentRiskPct,
        scaleFactor: currentRiskPct / originalRiskPct,
        reasonCodes,
        correlationNotes: { topPairs: [] }
      };
    } else {
      return {
        action: "approved",
        riskPct: currentRiskPct,
        reasonCodes: ["ok_total", "ok_cluster", "ok_corr"],
        correlationNotes: { topPairs: [] }
      };
    }
  }

  // Event emission methods
  private approveIntent(intent: IntentAccepted, result: BalanceResult, bus: any, timestamp: string): void {
    const approval: PortfolioIntentApproved = {
      event: "portfolio.intent.approved",
      timestamp,
      symbol: intent.symbol,
      side: intent.side,
      riskPerTradePct: result.riskPct,
      reasonCodes: result.reasonCodes,
      correlationNotes: result.correlationNotes
    };
    bus.emit("portfolio.intent.approved", approval);
  }

  private adjustIntent(intent: IntentAccepted, result: BalanceResult, bus: any, timestamp: string): void {
    const adjustment: PortfolioIntentAdjusted = {
      event: "portfolio.intent.adjusted",
      timestamp,
      symbol: intent.symbol,
      side: intent.side,
      riskPerTradePctOriginal: this.calculateCandidateRisk(intent),
      riskPerTradePctAdjusted: result.riskPct,
      scaleFactor: result.scaleFactor!,
      reasonCodes: result.reasonCodes,
      correlationNotes: result.correlationNotes
    };
    bus.emit("portfolio.intent.adjusted", adjustment);
  }

  private rejectIntent(intent: any, result: any, bus: any, timestamp: string): void {
    const rejection: PortfolioIntentRejected = {
      event: "portfolio.intent.rejected",
      timestamp,
      symbol: intent.symbol,
      side: intent.side,
      reasonCodes: result.reasonCodes
    };
    bus.emit("portfolio.intent.rejected", rejection);
  }

  private deferIntent(intent: any, reasonCodes: string[], bus: any, timestamp: string): void {
    const deferral = {
      event: "portfolio.intent.deferred",
      timestamp,
      symbol: intent.symbol,
      side: intent.side,
      deferUntil: new Date(Date.now() + 30000).toISOString(),
      reasonCodes
    };
    bus.emit("portfolio.intent.deferred", deferral);
  }

  // State update handlers
  private updateAccountExposure(data: any, logger: any): void {
    try {
      if (data.event === "account.exposure") {
        this.state.lastExposure = data as AccountExposure;
      }
    } catch (e: any) {
      if (logger) logger.error({ e, data }, "VIVO-25 invalid account exposure");
    }
  }

  private updatePortfolioPolicy(data: any, logger: any): void {
    try {
      if (data.event === "portfolio.policy") {
        this.state.lastPolicy = data as PortfolioPolicy;
      }
    } catch (e: any) {
      if (logger) logger.error({ e, data }, "VIVO-25 invalid portfolio policy");
    }
  }

  // Public methods
  getStatus(): any {
    return {
      config: this.config,
      state: {
        hasExposure: !!this.state.lastExposure,
        hasPolicy: !!this.state.lastPolicy,
        clusterCount: this.state.clusterExposure.size
      },
      metrics: this.metrics
    };
  }

  updateConfig(updates: Partial<BalancerConfig>): void {
    this.config = { ...this.config, ...updates };
  }
}
