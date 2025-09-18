/**
 * VIVO-40 · dominanceShiftWatcher.ts
 * BTC/ETH dominans kaymalarını ve beta rejimini izleyip 
 * varyant/simge ağırlık önerisi çıkarmak.
 * Kripto dominans rejim analizi ve portfolio optimizasyonu.
 */

import { EventEmitter } from "events";

// Input Event Types
export interface MarketDominance {
  event: "market.dominance";
  timestamp: string;
  btcD: number; // BTC dominance percentage
  ethD: number; // ETH dominance percentage
  altD: number; // Alt dominance percentage
  zScores: {
    btcD: number;
    ethD: number;
    altD: number;
  };
  trends: {
    btcD_1d: number;
    ethD_1d: number;
    btcD_7d: number;
    ethD_7d: number;
  };
  momentum: {
    btcD: "up" | "down" | "stable";
    ethD: "up" | "down" | "stable";
  };
}

export interface PortfolioCorrelation {
  event: "portfolio.correlation";
  timestamp: string;
  topPairs: Array<{
    symbol1: string;
    symbol2: string;
    correlation: number;
    significance: number;
  }>;
  betaByCluster: {
    Layer1: { beta: number; rsquared: number; symbols: string[]; };
    DeFi: { beta: number; rsquared: number; symbols: string[]; };
    Meme: { beta: number; rsquared: number; symbols: string[]; };
    Infrastructure: { beta: number; rsquared: number; symbols: string[]; };
    Gaming: { beta: number; rsquared: number; symbols: string[]; };
    AI: { beta: number; rsquared: number; symbols: string[]; };
  };
  overallCorrelation: number;
  diversificationScore: number;
}

export interface UniverseSnapshot {
  event: "universe.snapshot";
  timestamp: string;
  symbols: Array<{
    symbol: string;
    cluster: string;
    marketCapUSD: number;
    volumeUSD24h: number;
    beta: number;
    dominanceCorr: number; // Correlation with BTC dominance
    weight: number;
    tier: "tier1" | "tier2" | "tier3";
  }>;
  clusters: {
    Layer1: { count: number; totalWeight: number; avgBeta: number; };
    DeFi: { count: number; totalWeight: number; avgBeta: number; };
    Meme: { count: number; totalWeight: number; avgBeta: number; };
    Infrastructure: { count: number; totalWeight: number; avgBeta: number; };
    Gaming: { count: number; totalWeight: number; avgBeta: number; };
    AI: { count: number; totalWeight: number; avgBeta: number; };
  };
  totalSymbols: number;
}

// Output Event Types
export interface DominanceShiftSignal {
  event: "dominance.shift.signal";
  timestamp: string;
  regime: "btc-led" | "alt-led" | "neutral" | "eth-led" | "rotation";
  regimeStrength: number; // 0 to 1
  suggest: {
    variant?: "conservative" | "base" | "aggressive";
    reduceCluster?: {
      Layer1?: number;
      DeFi?: number;
      Meme?: number;
      Infrastructure?: number;
      Gaming?: number;
      AI?: number;
    };
    increaseCluster?: {
      Layer1?: number;
      DeFi?: number;
      Meme?: number;
      Infrastructure?: number;
      Gaming?: number;
      AI?: number;
    };
    overallExposure?: "reduce" | "increase" | "maintain";
  };
  reasonCodes: string[];
  confidence: number;
  timeframe: "short" | "medium" | "long";
  audit: {
    btcDominance: number;
    ethDominance: number;
    dominanceDelta: number;
    zScoreDiff: number;
    correlationBreakdown: Record<string, number>;
    regimeHistory: string[];
  };
}

// Configuration
export interface DominanceConfig {
  zThr: {
    shift: number;
    strong: number;
    extreme: number;
  };
  hysteresis: number;
  maxReducePerStep: number;
  regimeFilters: {
    minDurationMin: number;
    confirmationThreshold: number;
    volatilityFilter: boolean;
  };
  clusterWeights: {
    Layer1: number;
    DeFi: number;
    Meme: number;
    Infrastructure: number;
    Gaming: number;
    AI: number;
  };
  tz: string;
}

// Internal state interfaces
interface RegimeState {
  currentRegime: "btc-led" | "alt-led" | "neutral" | "eth-led" | "rotation";
  regimeStartTime: Date;
  regimeStrength: number;
  lastSignalTime: Date | null;
  confidenceScore: number;
  pendingRegime: string | null;
  pendingConfirmations: number;
}

interface DominanceHistory {
  timestamp: Date;
  btcD: number;
  ethD: number;
  altD: number;
  zScores: { btcD: number; ethD: number; altD: number; };
  regime: string;
}

interface DominanceState {
  currentDominance: MarketDominance | null;
  currentCorrelation: PortfolioCorrelation | null;
  currentUniverse: UniverseSnapshot | null;
  regimeState: RegimeState;
  dominanceHistory: DominanceHistory[];
  recentSignals: DominanceShiftSignal[];
  clusterBetas: Map<string, number>; // cluster -> beta
  hysteresisBuffer: Map<string, number>; // regime -> buffer value
  stats: {
    regimeSwitches: number;
    avgRegimeDuration: number;
    signalAccuracy: number;
    lastCalculation: Date | null;
  };
}

export interface StdError { code:string; message:string; details?:Record<string,unknown>; retriable?:boolean; }

export class DominanceShiftWatcher extends EventEmitter {
  ver="1.0.0"; src="VIVO-40";
  private config: DominanceConfig;
  private state: DominanceState;

  constructor(config?: Partial<DominanceConfig>) {
    super();
    this.config = {
      zThr: { 
        shift: 1.2, 
        strong: 2.0,
        extreme: 3.0 
      },
      hysteresis: 0.3,
      maxReducePerStep: 0.2,
      regimeFilters: {
        minDurationMin: 15,
        confirmationThreshold: 3,
        volatilityFilter: true
      },
      clusterWeights: {
        Layer1: 1.0,
        DeFi: 0.8,
        Meme: 0.6,
        Infrastructure: 0.9,
        Gaming: 0.7,
        AI: 0.8
      },
      tz: "Europe/Istanbul",
      ...config
    };

    this.state = {
      currentDominance: null,
      currentCorrelation: null,
      currentUniverse: null,
      regimeState: {
        currentRegime: "neutral",
        regimeStartTime: new Date(),
        regimeStrength: 0,
        lastSignalTime: null,
        confidenceScore: 0,
        pendingRegime: null,
        pendingConfirmations: 0
      },
      dominanceHistory: [],
      recentSignals: [],
      clusterBetas: new Map(),
      hysteresisBuffer: new Map([
        ["btc-led", 0],
        ["alt-led", 0],
        ["eth-led", 0],
        ["neutral", 0],
        ["rotation", 0]
      ]),
      stats: {
        regimeSwitches: 0,
        avgRegimeDuration: 0,
        signalAccuracy: 0,
        lastCalculation: null
      }
    };
  }

  attach(bus: any, logger: any) {
    bus.on("market.dominance", (data: any) => this.handleMarketDominance(data, bus, logger));
    bus.on("portfolio.correlation", (data: any) => this.handlePortfolioCorrelation(data, logger));
    bus.on("universe.snapshot", (data: any) => this.handleUniverseSnapshot(data, logger));
  }

  private handleMarketDominance(data: any, bus: any, logger: any): void {
    try {
      if (data.event !== "market.dominance") return;
      
      this.state.currentDominance = data as MarketDominance;
      this.updateDominanceHistory(data);
      
      // Analyze regime change
      this.analyzeRegimeShift(bus, logger);

    } catch (error: any) {
      if (logger) logger.error({ error: error.message }, "Market dominance handling failed");
    }
  }

  private handlePortfolioCorrelation(data: any, logger: any): void {
    try {
      if (data.event !== "portfolio.correlation") return;
      
      this.state.currentCorrelation = data as PortfolioCorrelation;
      this.updateClusterBetas(data);

    } catch (error: any) {
      if (logger) logger.error({ error: error.message }, "Portfolio correlation handling failed");
    }
  }

  private handleUniverseSnapshot(data: any, logger: any): void {
    try {
      if (data.event !== "universe.snapshot") return;
      
      this.state.currentUniverse = data as UniverseSnapshot;

    } catch (error: any) {
      if (logger) logger.error({ error: error.message }, "Universe snapshot handling failed");
    }
  }

  private updateDominanceHistory(dominance: MarketDominance): void {
    const historyEntry: DominanceHistory = {
      timestamp: new Date(dominance.timestamp),
      btcD: dominance.btcD,
      ethD: dominance.ethD,
      altD: dominance.altD,
      zScores: { ...dominance.zScores },
      regime: this.state.regimeState.currentRegime
    };

    this.state.dominanceHistory.push(historyEntry);

    // Keep only last 24 hours of history
    const cutoff = new Date();
    cutoff.setHours(cutoff.getHours() - 24);
    this.state.dominanceHistory = this.state.dominanceHistory.filter(h => h.timestamp >= cutoff);
  }

  private updateClusterBetas(correlation: PortfolioCorrelation): void {
    this.state.clusterBetas.clear();
    
    for (const [cluster, data] of Object.entries(correlation.betaByCluster)) {
      this.state.clusterBetas.set(cluster, data.beta);
    }
  }

  private analyzeRegimeShift(bus: any, logger: any): void {
    if (!this.state.currentDominance) return;

    const dominance = this.state.currentDominance;
    const zScoreDiff = dominance.zScores.btcD - dominance.zScores.ethD;
    
    // Determine potential new regime
    const potentialRegime = this.classifyRegime(dominance, zScoreDiff);
    
    // Apply hysteresis and confirmation logic
    const shouldChangeRegime = this.shouldChangeRegime(potentialRegime, zScoreDiff);
    
    if (shouldChangeRegime) {
      this.executeRegimeChange(potentialRegime, bus, logger);
    } else {
      // Update regime strength without changing regime
      this.updateRegimeStrength(zScoreDiff);
    }

    this.state.stats.lastCalculation = new Date();
  }

  private classifyRegime(dominance: MarketDominance, zScoreDiff: number): string {
    const { zThr } = this.config;
    
    // Strong BTC dominance
    if (dominance.zScores.btcD >= zThr.strong && zScoreDiff >= zThr.shift) {
      return "btc-led";
    }
    
    // Strong ETH dominance
    if (dominance.zScores.ethD >= zThr.strong && zScoreDiff <= -zThr.shift) {
      return "eth-led";
    }
    
    // Strong alt season (both BTC and ETH declining)
    if (dominance.zScores.btcD <= -zThr.shift && dominance.zScores.ethD <= -zThr.shift) {
      return "alt-led";
    }
    
    // Rotation regime (high volatility in dominance)
    if (Math.abs(zScoreDiff) >= zThr.extreme) {
      return "rotation";
    }
    
    // Default neutral
    return "neutral";
  }

  private shouldChangeRegime(potentialRegime: string, zScoreDiff: number): boolean {
    const currentRegime = this.state.regimeState.currentRegime;
    
    if (potentialRegime === currentRegime) {
      // Reset pending confirmations if we're staying in same regime
      this.state.regimeState.pendingRegime = null;
      this.state.regimeState.pendingConfirmations = 0;
      return false;
    }

    // Apply hysteresis
    const hysteresisValue = this.state.hysteresisBuffer.get(currentRegime) || 0;
    const adjustedThreshold = this.config.zThr.shift + (hysteresisValue * this.config.hysteresis);
    
    if (Math.abs(zScoreDiff) < adjustedThreshold) {
      return false; // Not strong enough to overcome hysteresis
    }

    // Check minimum duration
    const regimeDuration = (new Date().getTime() - this.state.regimeState.regimeStartTime.getTime()) / (1000 * 60);
    if (regimeDuration < this.config.regimeFilters.minDurationMin) {
      return false; // Too soon to change
    }

    // Confirmation logic
    if (this.state.regimeState.pendingRegime === potentialRegime) {
      this.state.regimeState.pendingConfirmations++;
    } else {
      this.state.regimeState.pendingRegime = potentialRegime;
      this.state.regimeState.pendingConfirmations = 1;
    }

    return this.state.regimeState.pendingConfirmations >= this.config.regimeFilters.confirmationThreshold;
  }

  private executeRegimeChange(newRegime: string, bus: any, logger: any): void {
    const oldRegime = this.state.regimeState.currentRegime;
    
    // Update regime state
    this.state.regimeState.currentRegime = newRegime as any;
    this.state.regimeState.regimeStartTime = new Date();
    this.state.regimeState.pendingRegime = null;
    this.state.regimeState.pendingConfirmations = 0;
    
    // Update hysteresis buffer
    this.state.hysteresisBuffer.set(oldRegime, 1.0);
    
    // Decay other hysteresis values
    for (const [regime, value] of this.state.hysteresisBuffer.entries()) {
      if (regime !== oldRegime) {
        this.state.hysteresisBuffer.set(regime, value * 0.9);
      }
    }

    // Update stats
    this.state.stats.regimeSwitches++;
    this.updateAverageRegimeDuration();

    // Generate signal
    this.generateDominanceSignal(newRegime, bus, logger);

    if (logger) logger.info({
      oldRegime,
      newRegime,
      btcD: this.state.currentDominance?.btcD,
      ethD: this.state.currentDominance?.ethD,
      zScoreDiff: this.state.currentDominance ? 
        this.state.currentDominance.zScores.btcD - this.state.currentDominance.zScores.ethD : 0
    }, "Dominance regime changed");
  }

  private updateRegimeStrength(zScoreDiff: number): void {
    const absZScore = Math.abs(zScoreDiff);
    this.state.regimeState.regimeStrength = Math.min(1.0, absZScore / this.config.zThr.extreme);
    this.state.regimeState.confidenceScore = this.calculateConfidence();
  }

  private calculateConfidence(): number {
    if (!this.state.currentDominance || !this.state.currentCorrelation) return 0.5;

    let confidence = 0.5;

    // Factor 1: Z-score strength
    const zScoreDiff = this.state.currentDominance.zScores.btcD - this.state.currentDominance.zScores.ethD;
    const zStrength = Math.min(1.0, Math.abs(zScoreDiff) / this.config.zThr.extreme);
    confidence += zStrength * 0.3;

    // Factor 2: Regime duration (more stable = higher confidence)
    const regimeDuration = (new Date().getTime() - this.state.regimeState.regimeStartTime.getTime()) / (1000 * 60 * 60);
    const durationScore = Math.min(1.0, regimeDuration / 24); // Max confidence after 24 hours
    confidence += durationScore * 0.2;

    // Factor 3: Correlation consistency
    const correlationScore = 1 - this.state.currentCorrelation.overallCorrelation;
    confidence += correlationScore * 0.3;

    return Math.max(0, Math.min(1, confidence));
  }

  private generateDominanceSignal(regime: string, bus: any, logger: any): void {
    if (!this.state.currentDominance || !this.state.currentCorrelation) return;

    const suggestions = this.calculateSuggestions(regime);
    const reasonCodes = this.generateReasonCodes(regime);
    const timeframe = this.determineTimeframe(regime);

    const signal: DominanceShiftSignal = {
      event: "dominance.shift.signal",
      timestamp: new Date().toISOString(),
      regime: regime as any,
      regimeStrength: this.state.regimeState.regimeStrength,
      suggest: suggestions,
      reasonCodes,
      confidence: this.state.regimeState.confidenceScore,
      timeframe,
      audit: {
        btcDominance: this.state.currentDominance.btcD,
        ethDominance: this.state.currentDominance.ethD,
        dominanceDelta: this.state.currentDominance.btcD - this.state.currentDominance.ethD,
        zScoreDiff: this.state.currentDominance.zScores.btcD - this.state.currentDominance.zScores.ethD,
        correlationBreakdown: this.getCorrelationBreakdown(),
        regimeHistory: this.getRecentRegimeHistory()
      }
    };

    this.state.recentSignals.push(signal);
    
    // Keep only last 20 signals
    if (this.state.recentSignals.length > 20) {
      this.state.recentSignals = this.state.recentSignals.slice(-20);
    }

    this.state.regimeState.lastSignalTime = new Date();

    this.emit("dominance.shift.signal", signal);
    if (bus) bus.emit("dominance.shift.signal", signal);

    if (logger) logger.info({
      regime,
      variant: suggestions.variant,
      confidence: signal.confidence,
      reasonCodes
    }, "Dominance shift signal generated");
  }

  private calculateSuggestions(regime: string): any {
    const suggestions: any = {};

    switch (regime) {
      case "btc-led":
        suggestions.variant = "conservative";
        suggestions.reduceCluster = {
          Layer1: Math.min(this.config.maxReducePerStep, 0.3),
          DeFi: Math.min(this.config.maxReducePerStep, 0.2)
        };
        suggestions.overallExposure = "reduce";
        break;

      case "eth-led":
        suggestions.variant = "base";
        suggestions.increaseCluster = {
          Layer1: 0.1,
          DeFi: 0.15
        };
        suggestions.reduceCluster = {
          Meme: this.config.maxReducePerStep
        };
        break;

      case "alt-led":
        suggestions.variant = "aggressive";
        suggestions.reduceCluster = {
          Layer1: this.config.maxReducePerStep
        };
        suggestions.increaseCluster = {
          DeFi: 0.15,
          AI: 0.1,
          Gaming: 0.05
        };
        suggestions.overallExposure = "increase";
        break;

      case "rotation":
        suggestions.variant = "conservative";
        suggestions.overallExposure = "reduce";
        // Reduce all clusters slightly during high volatility
        suggestions.reduceCluster = {
          Layer1: 0.1,
          DeFi: 0.1,
          Meme: 0.15
        };
        break;

      case "neutral":
      default:
        suggestions.variant = "base";
        suggestions.overallExposure = "maintain";
        break;
    }

    return suggestions;
  }

  private generateReasonCodes(regime: string): string[] {
    const codes: string[] = [regime + "_regime"];

    if (!this.state.currentDominance) return codes;

    const dominance = this.state.currentDominance;
    
    if (dominance.zScores.btcD >= this.config.zThr.strong) {
      codes.push("strong_btc_dominance");
    }
    
    if (dominance.zScores.ethD >= this.config.zThr.strong) {
      codes.push("strong_eth_dominance");
    }

    if (dominance.zScores.btcD <= -this.config.zThr.shift) {
      codes.push("btc_dominance_decline");
    }

    if (Math.abs(dominance.zScores.btcD - dominance.zScores.ethD) >= this.config.zThr.extreme) {
      codes.push("extreme_dominance_shift");
    }

    if (this.state.currentCorrelation && this.state.currentCorrelation.overallCorrelation > 0.8) {
      codes.push("high_correlation");
    }

    return codes;
  }

  private determineTimeframe(regime: string): "short" | "medium" | "long" {
    const regimeStrength = this.state.regimeState.regimeStrength;
    
    if (regimeStrength >= 0.8) return "long";
    if (regimeStrength >= 0.5) return "medium";
    return "short";
  }

  private getCorrelationBreakdown(): Record<string, number> {
    if (!this.state.currentCorrelation) return {};

    const breakdown: Record<string, number> = {};
    
    for (const [cluster, data] of Object.entries(this.state.currentCorrelation.betaByCluster)) {
      breakdown[cluster + "_beta"] = data.beta;
      breakdown[cluster + "_rsquared"] = data.rsquared;
    }

    return breakdown;
  }

  private getRecentRegimeHistory(): string[] {
    return this.state.dominanceHistory
      .slice(-10)
      .map(h => h.regime);
  }

  private updateAverageRegimeDuration(): void {
    if (this.state.dominanceHistory.length < 2) return;

    const regimeChanges = this.state.dominanceHistory.filter((h, i) => 
      i > 0 && h.regime !== this.state.dominanceHistory[i - 1].regime
    );

    if (regimeChanges.length === 0) return;

    let totalDuration = 0;
    for (let i = 1; i < regimeChanges.length; i++) {
      const duration = regimeChanges[i].timestamp.getTime() - regimeChanges[i - 1].timestamp.getTime();
      totalDuration += duration;
    }

    this.state.stats.avgRegimeDuration = totalDuration / (regimeChanges.length - 1) / (1000 * 60 * 60); // Hours
  }

  // Public methods
  getStatus(): any {
    return {
      currentRegime: this.state.regimeState.currentRegime,
      regimeStrength: this.state.regimeState.regimeStrength,
      confidenceScore: this.state.regimeState.confidenceScore,
      regimeDuration: this.state.regimeState.regimeStartTime ? 
        (new Date().getTime() - this.state.regimeState.regimeStartTime.getTime()) / (1000 * 60 * 60) : 0,
      lastSignal: this.state.recentSignals.length > 0 ? 
        this.state.recentSignals[this.state.recentSignals.length - 1] : null,
      stats: { ...this.state.stats },
      dominanceData: this.state.currentDominance ? {
        btcD: this.state.currentDominance.btcD,
        ethD: this.state.currentDominance.ethD,
        zScores: this.state.currentDominance.zScores
      } : null,
      clusterBetas: Object.fromEntries(this.state.clusterBetas),
      config: {
        zThresholds: this.config.zThr,
        hysteresis: this.config.hysteresis,
        maxReducePerStep: this.config.maxReducePerStep
      }
    };
  }

  updateConfig(updates: Partial<DominanceConfig>): void {
    this.config = { ...this.config, ...updates };
  }

  // Force regime analysis (for testing)
  forceAnalyze(bus: any, logger: any): void {
    this.analyzeRegimeShift(bus, logger);
  }

  // Get recent signals
  getRecentSignals(count: number = 5): DominanceShiftSignal[] {
    return this.state.recentSignals.slice(-count);
  }

  // Reset regime state (for testing)
  resetRegimeState(): void {
    this.state.regimeState = {
      currentRegime: "neutral",
      regimeStartTime: new Date(),
      regimeStrength: 0,
      lastSignalTime: null,
      confidenceScore: 0,
      pendingRegime: null,
      pendingConfirmations: 0
    };
  }
}
