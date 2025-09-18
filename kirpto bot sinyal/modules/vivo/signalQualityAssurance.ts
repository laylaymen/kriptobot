/**
 * VIVO-24 · signalQualityAssurance.ts
 * Sinyal kalite kontrolü ve validasyon sistemi - fail-fast quality gate.
 * Advanced signal QA with schema validation, freshness checks, anomaly detection.
 */

import { EventEmitter } from "events";

// Simple validation schemas (without zod dependency)
interface ValidationError extends Error {
  name: "ValidationError";
}

// Simple validation functions (instead of zod schemas)
function validateRawSignalEnvelope(data: any): any {
  if (!data || typeof data !== 'object') throw new Error('Invalid signal envelope');
  if (data.event !== 'signal.envelope.raw') throw new Error('Invalid event type');
  if (!data.timestamp || !data.symbol || !data.side || !data.timeframe || !data.source) {
    throw new Error('Missing required fields');
  }
  if (!['long', 'short'].includes(data.side)) throw new Error('Invalid side');
  if (!data.features || typeof data.features !== 'object') throw new Error('Invalid features');
  
  const f = data.features;
  if (!isFinite(f.trendStrength) || !isFinite(f.rrScore) || !isFinite(f.volatility) || !isFinite(f.orderflowBias)) {
    throw new Error('Invalid feature values');
  }
  
  return data;
}

function validateMarketRefs(data: any): any {
  if (!data || data.event !== 'market.refs') throw new Error('Invalid market refs');
  if (!data.symbol || !isFinite(data.mid) || !isFinite(data.bestBid) || !isFinite(data.bestAsk)) {
    throw new Error('Invalid market ref fields');
  }
  return data;
}

function validateRegimeSnapshot(data: any): any {
  if (!data || data.event !== 'regime.snapshot') throw new Error('Invalid regime snapshot');
  if (!data.symbol || !data.timeframe || !data.regime) throw new Error('Missing regime fields');
  const validRegimes = ['trend', 'range', 'breakout', 'highVol', 'illiquid'];
  if (!validRegimes.includes(data.regime)) throw new Error('Invalid regime');
  return data;
}

function validateExchangeInfo(data: any): any {
  if (!data || data.event !== 'exchange.info') throw new Error('Invalid exchange info');
  return data;
}

function validateConnectivityHeartbeat(data: any): any {
  if (!data || data.event !== 'connectivity.heartbeat') throw new Error('Invalid heartbeat');
  return data;
}

// Output Event Types
export interface CleanSignalEnvelope {
  event: "signal.envelope";
  timestamp: string;
  symbol: string;
  side: "long" | "short";
  timeframe: string;
  source: string;
  features: {
    trendStrength: number;
    rrScore: number;
    volatility: number;
    orderflowBias: number;
    zScores: {
      trend: number;
      rr: number;
      vol: number;
      of: number;
    };
  };
  vivoHints: {
    confirmationThreshold: number | null;
    signalVariant: "base" | "aggressive" | "conservative" | null;
    biasWeightedTune: {
      trend: number;
      orderflow: number;
      formation: number;
    };
  };
  qa: {
    qualityScore: number;
    tags: string[];
    reasonCodes: string[];
    sourceTier: "core" | "experimental" | "external";
    freshnessMs: number;
  };
  meta: {
    signalId: string;
    formationTag: string | null;
    latencyMs: number | null;
    barState: "open" | "closed" | null;
  };
}

export interface QAReject {
  event: "signal.qa.rejected";
  timestamp: string;
  symbol: string;
  side: "long" | "short";
  timeframe: string;
  source: string;
  signalId: string;
  reasonCodes: string[];
  qa: {
    qualityScore: number;
    tags: string[];
  };
}

export interface QADefer {
  event: "signal.qa.deferred";
  timestamp: string;
  symbol: string;
  side: "long" | "short";
  timeframe: string;
  source: string;
  signalId: string;
  deferUntil: string;
  reasonCodes: string[];
}

export interface QAMetrics {
  event: "signal.qa.metrics";
  timestamp: string;
  p99_ms: number;
  pass_rate: number;
  reject_rate: number;
  defer_rate: number;
  dup_drop_rate: number;
  avg_quality: number;
}

export interface QAAlert {
  event: "signal.qa.alert";
  timestamp: string;
  level: "info" | "warn" | "error";
  message: string;
  context: {
    symbol: string;
    source: string;
    reasonCodes: string[];
  };
}

// Configuration
export interface QAConfig {
  // Freshness windows by timeframe
  freshnessMsByTF: Record<string, number>;
  
  // Open bar policy
  openBarPolicy: {
    mode: "penalize" | "defer" | "block";
    penalty: number;
    deferMs: number;
  };
  
  // Source trust layers
  sourceTiers: Record<string, "core" | "experimental" | "external">;
  minQualityByTier: Record<string, number>;
  
  // Regime/liquidity filters
  illiquidBlock: boolean;
  highVolPenalty: number;
  illiquidPenalty: number;
  
  // Feature normalization
  featureClamp: {
    min: number;
    max: number;
  };
  zScoreWindow: number;
  
  // Anti-duplicate
  dedupe: {
    windowMs: number;
    keyFields: string[];
  };
  
  // Clock skew & latency
  maxClockSkewMs: number;
  highLatencyPenalty: number;
  
  // Quality score weights
  qualityWeights: {
    payload: number;
    freshness: number;
    barClose: number;
    regimeFit: number;
    sourceTrust: number;
    anomalySafe: number;
  };
  
  // Anomaly/outlier thresholds
  outlier: {
    zAbsMax: number;
    rrMin: number;
    rrMax: number;
    trendMin: number;
    trendMax: number;
  };
  
  // Defer waiting
  awaitRefsMaxMs: number;
  
  // Telemetry
  metricsFlushSec: number;
  tz: string;
}

// Baseline statistics for rolling z-score calculation
interface BaselineStats {
  count: number;
  sum: number;
  sumSquares: number;
  mean: number;
  std: number;
  samples: number[];
}

// Deduplication tracking
interface DedupEntry {
  key: string;
  expiresAt: number;
}

// QA state tracking
interface QAState {
  baseline: Map<string, BaselineStats>; // feature baseline stats per symbol
  marketRefs: Map<string, any>;         // latest market refs per symbol
  regimeData: Map<string, any>;         // latest regime data per symbol/timeframe
  dedupSet: Set<string>;                // recent signal keys
  metrics: {
    processed: number;
    passed: number;
    rejected: number;
    deferred: number;
    duplicates: number;
    qualitySum: number;
    processingTimes: number[];
  };
}

export interface StdError { code:string; message:string; details?:Record<string,unknown>; retriable?:boolean; }

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

export class SignalQualityAssurance extends EventEmitter {
  ver="1.0.0"; src="VIVO-24";
  private config: QAConfig;
  private state: QAState;
  private metricsTimer?: NodeJS.Timeout;
  private cleanupTimer?: NodeJS.Timeout;

  constructor(config?: Partial<QAConfig>) {
    super();
    this.config = {
      freshnessMsByTF: {
        "M1": 3000,
        "M5": 5000,
        "M15": 8000,
        "H1": 15000,
        "H4": 30000,
        "D1": 60000
      },
      openBarPolicy: {
        mode: "penalize",
        penalty: 0.04,
        deferMs: 5000
      },
      sourceTiers: {
        "formation.breakout": "core",
        "orderflow.imbalance": "core",
        "ext.alphaX": "experimental",
        "*": "external"
      },
      minQualityByTier: {
        "core": 0.58,
        "experimental": 0.64,
        "external": 0.68
      },
      illiquidBlock: true,
      highVolPenalty: 0.03,
      illiquidPenalty: 0.06,
      featureClamp: {
        min: -3,
        max: 3
      },
      zScoreWindow: 200,
      dedupe: {
        windowMs: 1500,
        keyFields: ["symbol", "side", "timeframe", "source", "meta.signalId"]
      },
      maxClockSkewMs: 2000,
      highLatencyPenalty: 0.03,
      qualityWeights: {
        payload: 0.30,
        freshness: 0.20,
        barClose: 0.10,
        regimeFit: 0.15,
        sourceTrust: 0.15,
        anomalySafe: 0.10
      },
      outlier: {
        zAbsMax: 3.5,
        rrMin: 0.0,
        rrMax: 1.0,
        trendMin: 0.0,
        trendMax: 1.0
      },
      awaitRefsMaxMs: 4000,
      metricsFlushSec: 10,
      tz: "Europe/Istanbul",
      ...config
    };

    this.state = {
      baseline: new Map(),
      marketRefs: new Map(),
      regimeData: new Map(),
      dedupSet: new Set(),
      metrics: {
        processed: 0,
        passed: 0,
        rejected: 0,
        deferred: 0,
        duplicates: 0,
        qualitySum: 0,
        processingTimes: []
      }
    };
  }

  attach(bus: any, logger: any) {
    // Input signal processing
    bus.on("signal.envelope.raw", (data: any) => this.processRawSignal(data, bus, logger));
    
    // Context updates
    bus.on("market.refs", (data: any) => this.updateMarketRefs(data, logger));
    bus.on("regime.snapshot", (data: any) => this.updateRegimeSnapshot(data, logger));
    bus.on("exchange.info", (data: any) => this.updateExchangeInfo(data, logger));
    bus.on("connectivity.heartbeat", (data: any) => this.updateConnectivity(data, logger));

    // Start periodic tasks
    this.startPeriodicTasks(bus, logger);
  }

  private processRawSignal(data: any, bus: any, logger: any) {
    const startTime = Date.now();
    
    try {
      this.state.metrics.processed++;
      
      // Step 1: Schema & Type Validation
      const signal = validateRawSignalEnvelope(data);
      
      // Step 2: De-dupe & Anti-Replay
      const dedupKey = this.generateDedupKey(signal);
      if (this.isDuplicate(dedupKey)) {
        this.state.metrics.duplicates++;
        this.recordProcessingTime(startTime);
        return; // Silent drop for duplicates
      }
      this.addToDedupSet(dedupKey);
      
      // Step 3: Freshness & Clock Skew
      const freshnessCheck = this.checkFreshness(signal);
      if (freshnessCheck.reject) {
        this.rejectSignal(signal, freshnessCheck.reasons, 0, bus, logger);
        this.recordProcessingTime(startTime);
        return;
      }
      
      // Step 4: Open Bar Policy
      const barCheck = this.checkBarPolicy(signal);
      if (barCheck.reject) {
        this.rejectSignal(signal, barCheck.reasons, 0, bus, logger);
        this.recordProcessingTime(startTime);
        return;
      }
      if (barCheck.defer) {
        this.deferSignal(signal, barCheck.reasons, barCheck.deferUntil!, bus, logger);
        this.recordProcessingTime(startTime);
        return;
      }
      
      // Step 5: Market References & Regime
      const contextCheck = this.checkMarketContext(signal);
      if (contextCheck.defer) {
        this.deferSignal(signal, contextCheck.reasons, contextCheck.deferUntil!, bus, logger);
        this.recordProcessingTime(startTime);
        return;
      }
      if (contextCheck.reject) {
        this.rejectSignal(signal, contextCheck.reasons, 0, bus, logger);
        this.recordProcessingTime(startTime);
        return;
      }
      
      // Step 6: Anomaly/Outlier Detection
      const anomalyCheck = this.checkAnomalies(signal);
      if (anomalyCheck.reject) {
        this.rejectSignal(signal, anomalyCheck.reasons, anomalyCheck.qualityScore, bus, logger);
        this.recordProcessingTime(startTime);
        return;
      }
      
      // Step 7: Calculate Quality Score
      const qualityResult = this.calculateQualityScore(signal, {
        freshness: freshnessCheck,
        barPolicy: barCheck,
        context: contextCheck,
        anomaly: anomalyCheck
      });
      
      // Step 8: Source Trust & Quality Threshold
      const sourceTier = this.getSourceTier(signal.source);
      const minQuality = this.config.minQualityByTier[sourceTier];
      
      if (qualityResult.score < minQuality) {
        this.rejectSignal(signal, ["quality_below_tier_min"], qualityResult.score, bus, logger);
        this.recordProcessingTime(startTime);
        return;
      }
      
      // Step 9: Enrich & Publish Clean Signal
      const cleanSignal = this.enrichSignal(signal, qualityResult, sourceTier, freshnessCheck.freshnessMs);
      bus.emit("signal.envelope", cleanSignal);
      
      this.state.metrics.passed++;
      this.state.metrics.qualitySum += qualityResult.score;
      this.recordProcessingTime(startTime);
      
      // Update baseline stats
      this.updateBaseline(signal);
      
    } catch (e: any) {
      if (logger) logger.error({ e, data }, "VIVO-24 signal processing error");
      
      if (e.message.includes('Invalid')) {
        this.rejectSignal({
          symbol: data.symbol || "unknown",
          side: data.side || "long",
          timeframe: data.timeframe || "unknown",
          source: data.source || "unknown",
          meta: { signalId: data.meta?.signalId || "unknown" }
        } as any, ["invalid_payload"], 0, bus, logger);
      }
      
      this.state.metrics.rejected++;
      this.recordProcessingTime(startTime);
    }
  }

  private generateDedupKey(signal: any): string {
    const keyParts: string[] = [];
    
    for (const field of this.config.dedupe.keyFields) {
      const value = this.getNestedValue(signal, field);
      keyParts.push(String(value));
    }
    
    // Add time window for temporal deduplication
    const timeWindow = Math.floor(new Date(signal.timestamp).getTime() / this.config.dedupe.windowMs);
    keyParts.push(String(timeWindow));
    
    return keyParts.join("|");
  }

  private getNestedValue(obj: any, path: string): any {
    return path.split(".").reduce((current, key) => current?.[key], obj);
  }

  private isDuplicate(key: string): boolean {
    return this.state.dedupSet.has(key);
  }

  private addToDedupSet(key: string): void {
    this.state.dedupSet.add(key);
    
    // Cleanup old entries periodically to prevent memory growth
    if (this.state.dedupSet.size > 10000) {
      // Keep only recent half (simple cleanup strategy)
      const entries = Array.from(this.state.dedupSet);
      this.state.dedupSet.clear();
      entries.slice(-5000).forEach(entry => this.state.dedupSet.add(entry));
    }
  }

  private checkFreshness(signal: any): {
    reject: boolean;
    reasons: string[];
    freshnessMs: number;
    clockSkew: number;
  } {
    const now = Date.now();
    const signalTime = new Date(signal.timestamp).getTime();
    const freshnessMs = now - signalTime;
    const clockSkew = Math.abs(signalTime - now);
    
    const maxFreshness = this.config.freshnessMsByTF[signal.timeframe] || 30000;
    
    const reasons: string[] = [];
    
    if (freshnessMs > maxFreshness) {
      reasons.push("stale");
    }
    
    if (clockSkew > this.config.maxClockSkewMs) {
      reasons.push("clock_skew");
    }
    
    return {
      reject: reasons.length > 0,
      reasons,
      freshnessMs,
      clockSkew
    };
  }

  private checkBarPolicy(signal: any): {
    reject: boolean;
    defer: boolean;
    reasons: string[];
    deferUntil?: string;
    penalty: number;
  } {
    if (signal.meta.barState !== "open") {
      return { reject: false, defer: false, reasons: [], penalty: 0 };
    }
    
    const policy = this.config.openBarPolicy;
    
    switch (policy.mode) {
      case "block":
        return { reject: true, defer: false, reasons: ["open_bar"], penalty: 0 };
      
      case "defer":
        const deferUntil = new Date(Date.now() + policy.deferMs).toISOString();
        return { reject: false, defer: true, reasons: ["await_bar_close"], deferUntil, penalty: 0 };
      
      case "penalize":
      default:
        return { reject: false, defer: false, reasons: ["open_bar"], penalty: policy.penalty };
    }
  }

  private checkMarketContext(signal: any): {
    reject: boolean;
    defer: boolean;
    reasons: string[];
    deferUntil?: string;
    regimePenalty: number;
  } {
    const reasons: string[] = [];
    let regimePenalty = 0;
    
    // Check if we have recent market refs
    const marketRef = this.state.marketRefs.get(signal.symbol);
    if (!marketRef || this.isStale(marketRef.timestamp, 30000)) {
      const deferUntil = new Date(Date.now() + this.config.awaitRefsMaxMs).toISOString();
      return { 
        reject: false, 
        defer: true, 
        reasons: ["await_market_refs"], 
        deferUntil, 
        regimePenalty: 0 
      };
    }
    
    // Check regime context
    const regimeKey = `${signal.symbol}:${signal.timeframe}`;
    const regime = this.state.regimeData.get(regimeKey);
    
    if (regime) {
      if (regime.regime === "illiquid") {
        if (this.config.illiquidBlock) {
          reasons.push("illiquid_block");
          return { reject: true, defer: false, reasons, regimePenalty: 0 };
        } else {
          regimePenalty += this.config.illiquidPenalty;
        }
      }
      
      if (regime.regime === "highVol") {
        regimePenalty += this.config.highVolPenalty;
      }
      
      // Formation-regime fit check
      const formationTag = signal.meta.formationTag;
      if (formationTag) {
        if (formationTag === "breakout" && regime.regime === "range") {
          regimePenalty += 0.02; // Minor penalty for mismatched context
        }
        if (formationTag === "meanRevert" && regime.regime === "trend") {
          regimePenalty += 0.02;
        }
        // Bonuses for good fits would be handled in quality score calculation
      }
    }
    
    return { reject: false, defer: false, reasons, regimePenalty };
  }

  private checkAnomalies(signal: any): {
    reject: boolean;
    reasons: string[];
    qualityScore: number;
  } {
    const features = signal.features;
    const reasons: string[] = [];
    
    // Clamp features to valid ranges
    const clampedFeatures = {
      trendStrength: clamp(features.trendStrength, this.config.outlier.trendMin, this.config.outlier.trendMax),
      rrScore: clamp(features.rrScore, this.config.outlier.rrMin, this.config.outlier.rrMax),
      volatility: clamp(features.volatility, 0, 10), // Reasonable volatility range
      orderflowBias: clamp(features.orderflowBias, -1, 1) // Bias range
    };
    
    // Check for major clamping (indicates outlier)
    const clampingPenalty = Object.keys(features).reduce((penalty, key) => {
      const original = features[key as keyof typeof features];
      const clamped = clampedFeatures[key as keyof typeof clampedFeatures];
      return penalty + (Math.abs(original - clamped) > 0.1 ? 0.05 : 0);
    }, 0);
    
    if (clampingPenalty > 0.1) {
      reasons.push("clamp_hit");
    }
    
    // Z-score based anomaly detection
    const baselineKey = signal.symbol;
    const baseline = this.state.baseline.get(baselineKey);
    
    if (baseline) {
      const zScores = this.calculateZScores(features, baseline);
      const maxAbsZ = Math.max(...Object.values(zScores).map((val: unknown) => Math.abs(val as number)));
      
      if (maxAbsZ > this.config.outlier.zAbsMax) {
        reasons.push("anomaly_outlier");
        return { reject: true, reasons, qualityScore: 0.1 };
      }
    }
    
    // Calculate base quality score for anomaly component
    const qualityScore = Math.max(0, 1 - clampingPenalty);
    
    return { reject: false, reasons, qualityScore };
  }

  private calculateQualityScore(signal: any, checks: any): {
    score: number;
    breakdown: Record<string, number>;
    tags: string[];
    reasonCodes: string[];
  } {
    const weights = this.config.qualityWeights;
    const breakdown: Record<string, number> = {};
    const tags: string[] = [];
    const reasonCodes: string[] = [];
    
    // Payload quality (schema compliance, no NaN/Inf)
    breakdown.payload = 1.0; // Passed schema validation
    
    // Freshness quality
    const freshnessScore = Math.max(0, 1 - (checks.freshness.freshnessMs / 60000)); // Decay over 1 minute
    breakdown.freshness = freshnessScore;
    
    if (checks.freshness.clockSkew > 1000) {
      tags.push("clock_skew");
      breakdown.freshness *= 0.8;
    }
    
    // Bar close advantage
    breakdown.barClose = signal.meta.barState === "closed" ? 1.0 : 1.0 - checks.barPolicy.penalty;
    if (signal.meta.barState === "open") {
      tags.push("open_bar");
      reasonCodes.push("open_bar_penalty");
    }
    
    // Regime fit
    breakdown.regimeFit = Math.max(0, 1.0 - checks.context.regimePenalty);
    if (checks.context.regimePenalty > 0) {
      tags.push("regime_mismatch");
    }
    
    // Source trust
    const sourceTier = this.getSourceTier(signal.source);
    breakdown.sourceTrust = sourceTier === "core" ? 1.0 : sourceTier === "experimental" ? 0.8 : 0.6;
    
    // Anomaly safety
    breakdown.anomalySafe = checks.anomaly.qualityScore;
    if (checks.anomaly.reasons.length > 0) {
      tags.push(...checks.anomaly.reasons);
    }
    
    // Calculate weighted score
    const score = Object.keys(weights).reduce((sum, component) => {
      const weight = weights[component as keyof typeof weights];
      const componentScore = breakdown[component] || 0;
      return sum + (weight * componentScore);
    }, 0);
    
    // Add positive signals
    if (score > 0.8) reasonCodes.push("high_quality");
    if (signal.meta.latencyMs && signal.meta.latencyMs < 100) reasonCodes.push("low_latency");
    
    return {
      score: clamp(score, 0, 1),
      breakdown,
      tags,
      reasonCodes
    };
  }

  private enrichSignal(signal: any, quality: any, sourceTier: string, freshnessMs: number): CleanSignalEnvelope {
    // Calculate z-scores for features
    const baseline = this.state.baseline.get(signal.symbol);
    const zScores = baseline ? this.calculateZScores(signal.features, baseline) : {
      trend: 0, rr: 0, vol: 0, of: 0
    };
    
    return {
      event: "signal.envelope",
      timestamp: signal.timestamp,
      symbol: signal.symbol,
      side: signal.side,
      timeframe: signal.timeframe,
      source: signal.source,
      features: {
        ...signal.features,
        zScores
      },
      vivoHints: signal.vivoHints,
      qa: {
        qualityScore: quality.score,
        tags: quality.tags,
        reasonCodes: quality.reasonCodes,
        sourceTier: sourceTier as any,
        freshnessMs
      },
      meta: signal.meta
    };
  }

  private calculateZScores(features: any, baseline: any): any {
    return {
      trend: this.calculateFeatureZScore(features.trendStrength, baseline, "trendStrength"),
      rr: this.calculateFeatureZScore(features.rrScore, baseline, "rrScore"),
      vol: this.calculateFeatureZScore(features.volatility, baseline, "volatility"),
      of: this.calculateFeatureZScore(features.orderflowBias, baseline, "orderflowBias")
    };
  }

  private calculateFeatureZScore(value: number, baseline: any, feature: string): number {
    const key = `${feature}_stats`;
    const stats = baseline[key];
    if (!stats || stats.std === 0) return 0;
    return (value - stats.mean) / stats.std;
  }

  private updateBaseline(signal: any): void {
    const baselineKey = signal.symbol;
    let baseline = this.state.baseline.get(baselineKey);
    
    if (!baseline) {
      baseline = {} as BaselineStats;
      this.state.baseline.set(baselineKey, baseline);
    }
    
    // Update rolling statistics for each feature
    const features = ["trendStrength", "rrScore", "volatility", "orderflowBias"];
    
    for (const feature of features) {
      const value = signal.features[feature];
      const key = `${feature}_stats`;
      
      if (!baseline![key]) {
        baseline![key] = {
          count: 0,
          sum: 0,
          sumSquares: 0,
          mean: 0,
          std: 0,
          samples: []
        };
      }
      
      const stats = baseline![key];
      stats.samples.push(value);
      
      // Keep rolling window
      if (stats.samples.length > this.config.zScoreWindow) {
        stats.samples.shift();
      }
      
      // Recalculate stats
      stats.count = stats.samples.length;
      stats.sum = stats.samples.reduce((a, b) => a + b, 0);
      stats.mean = stats.sum / stats.count;
      stats.sumSquares = stats.samples.reduce((sum, val) => sum + val * val, 0);
      stats.std = Math.sqrt((stats.sumSquares / stats.count) - (stats.mean * stats.mean));
    }
  }

  private getSourceTier(source: string): "core" | "experimental" | "external" {
    return this.config.sourceTiers[source] || this.config.sourceTiers["*"] as any;
  }

  private isStale(timestamp: string, maxAgeMs: number): boolean {
    return (Date.now() - new Date(timestamp).getTime()) > maxAgeMs;
  }

  private rejectSignal(signal: any, reasons: string[], qualityScore: number, bus: any, logger: any): void {
    const reject: QAReject = {
      event: "signal.qa.rejected",
      timestamp: new Date().toISOString(),
      symbol: signal.symbol,
      side: signal.side,
      timeframe: signal.timeframe,
      source: signal.source,
      signalId: signal.meta.signalId,
      reasonCodes: reasons,
      qa: {
        qualityScore,
        tags: reasons
      }
    };
    
    bus.emit("signal.qa.rejected", reject);
    this.state.metrics.rejected++;
    
    if (logger) {
      logger.warn({
        signalId: signal.meta.signalId,
        symbol: signal.symbol,
        reasons
      }, "VIVO-24 signal rejected");
    }
  }

  private deferSignal(signal: any, reasons: string[], deferUntil: string, bus: any, logger: any): void {
    const defer: QADefer = {
      event: "signal.qa.deferred",
      timestamp: new Date().toISOString(),
      symbol: signal.symbol,
      side: signal.side,
      timeframe: signal.timeframe,
      source: signal.source,
      signalId: signal.meta.signalId,
      deferUntil,
      reasonCodes: reasons
    };
    
    bus.emit("signal.qa.deferred", defer);
    this.state.metrics.deferred++;
    
    if (logger) {
      logger.debug({
        signalId: signal.meta.signalId,
        symbol: signal.symbol,
        deferUntil,
        reasons
      }, "VIVO-24 signal deferred");
    }
  }

  // Context update handlers
  private updateMarketRefs(data: any, logger: any): void {
    try {
      const refs = validateMarketRefs(data);
      this.state.marketRefs.set(refs.symbol, refs);
    } catch (e: any) {
      if (logger) logger.error({ e, data }, "VIVO-24 invalid market refs");
    }
  }

  private updateRegimeSnapshot(data: any, logger: any): void {
    try {
      const regime = validateRegimeSnapshot(data);
      const key = `${regime.symbol}:${regime.timeframe}`;
      this.state.regimeData.set(key, regime);
    } catch (e: any) {
      if (logger) logger.error({ e, data }, "VIVO-24 invalid regime snapshot");
    }
  }

  private updateExchangeInfo(data: any, logger: any): void {
    try {
      const info = validateExchangeInfo(data);
      // Store exchange info for potential future validation
    } catch (e: any) {
      if (logger) logger.error({ e, data }, "VIVO-24 invalid exchange info");
    }
  }

  private updateConnectivity(data: any, logger: any): void {
    try {
      const heartbeat = validateConnectivityHeartbeat(data);
      // Update connectivity status for freshness validation
    } catch (e: any) {
      if (logger) logger.error({ e, data }, "VIVO-24 invalid connectivity heartbeat");
    }
  }

  private recordProcessingTime(startTime: number): void {
    const processingTime = Date.now() - startTime;
    this.state.metrics.processingTimes.push(processingTime);
    
    // Keep only recent processing times for p99 calculation
    if (this.state.metrics.processingTimes.length > 1000) {
      this.state.metrics.processingTimes = this.state.metrics.processingTimes.slice(-500);
    }
  }

  private startPeriodicTasks(bus: any, logger: any): void {
    // Metrics emission
    this.metricsTimer = setInterval(() => {
      this.emitMetrics(bus);
    }, this.config.metricsFlushSec * 1000);

    // Cleanup old data
    this.cleanupTimer = setInterval(() => {
      this.cleanup();
    }, 300000); // Every 5 minutes
  }

  private emitMetrics(bus: any): void {
    const metrics = this.state.metrics;
    const total = metrics.processed || 1;
    
    // Calculate p99 processing time
    const sortedTimes = [...metrics.processingTimes].sort((a, b) => a - b);
    const p99Index = Math.floor(sortedTimes.length * 0.99);
    const p99_ms = sortedTimes[p99Index] || 0;
    
    const qaMetrics: QAMetrics = {
      event: "signal.qa.metrics",
      timestamp: new Date().toISOString(),
      p99_ms,
      pass_rate: metrics.passed / total,
      reject_rate: metrics.rejected / total,
      defer_rate: metrics.deferred / total,
      dup_drop_rate: metrics.duplicates / total,
      avg_quality: metrics.qualitySum / (metrics.passed || 1)
    };
    
    bus.emit("signal.qa.metrics", qaMetrics);
    
    // Reset counters
    this.resetMetrics();
  }

  private resetMetrics(): void {
    this.state.metrics = {
      processed: 0,
      passed: 0,
      rejected: 0,
      deferred: 0,
      duplicates: 0,
      qualitySum: 0,
      processingTimes: []
    };
  }

  private cleanup(): void {
    // Clean up old market refs and regime data
    const cutoff = Date.now() - 300000; // 5 minutes
    
    for (const [key, ref] of this.state.marketRefs.entries()) {
      if (new Date(ref.timestamp).getTime() < cutoff) {
        this.state.marketRefs.delete(key);
      }
    }
    
    for (const [key, regime] of this.state.regimeData.entries()) {
      if (new Date(regime.timestamp).getTime() < cutoff) {
        this.state.regimeData.delete(key);
      }
    }
    
    // Trim baseline data if it gets too large
    if (this.state.baseline.size > 100) {
      const entries = Array.from(this.state.baseline.entries());
      this.state.baseline.clear();
      entries.slice(-50).forEach(([key, value]) => this.state.baseline.set(key, value));
    }
  }

  // Public methods
  getStatus(): any {
    return {
      config: this.config,
      baselineSymbols: this.state.baseline.size,
      marketRefsCount: this.state.marketRefs.size,
      regimeDataCount: this.state.regimeData.size,
      dedupSetSize: this.state.dedupSet.size,
      recentMetrics: this.state.metrics
    };
  }

  getQualityDistribution(): Record<string, number> {
    // This would need to be tracked over time for meaningful distribution
    return {
      high: 0,     // 0.8+
      medium: 0,   // 0.6-0.8
      low: 0       // <0.6
    };
  }

  forceCleanBaseline(symbol?: string): void {
    if (symbol) {
      this.state.baseline.delete(symbol);
    } else {
      this.state.baseline.clear();
    }
  }

  updateConfig(updates: Partial<QAConfig>): void {
    this.config = { ...this.config, ...updates };
  }

  destroy(): void {
    if (this.metricsTimer) clearInterval(this.metricsTimer);
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
    this.state.baseline.clear();
    this.state.marketRefs.clear();
    this.state.regimeData.clear();
    this.state.dedupSet.clear();
  }
}
