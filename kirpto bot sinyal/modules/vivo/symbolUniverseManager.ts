/**
 * VIVO-31 · symbolUniverseManager.ts
 * İşlem yapılabilir sembol evrenini dinamik yönetir.
 * Whitelist/blacklist, likidite & kalite eşikleri, dönemsel rotasyon, canary/deneysel kümeler.
 */

import { EventEmitter } from "events";

// Input Event Types
export interface ExchangeSymbolsCatalog {
  event: "exchange.symbols.catalog";
  timestamp: string;
  exchange: string;
  symbols: Array<{
    symbol: string;
    status: "TRADING" | "BREAK" | "HALT";
    base: string;
    quote: string;
    filters: {
      minNotional: number;
      tickSize: number;
      stepSize: number;
    };
  }>;
}

export interface MarketLiquiditySnapshot {
  event: "market.liquidity.snapshot";
  timestamp: string;
  symbol: string;
  windowMin: number;
  metrics: {
    volUSD: number;
    avgSpreadBps: number;
    p10DepthUSD: number;
    uptimePct: number;
    msgRatePerSec: number;
  };
}

export interface DailyPerformance {
  event: "vivo.performance.daily";
  date: string;
  scope: {
    symbol: string;
    timeframe: string;
    variant: string;
    formationTag?: string;
  };
  kpis: {
    trades: number;
    wins: number;
    hitRate: number;
    profitFactor: number;
    avgR: number;
    expectancyR: number;
    avgSlipBps: number;
    maxDD_R: number;
  };
}

export interface CostForecastUpdate {
  event: "cost.forecast.update";
  timestamp: string;
  symbol: string;
  tradeMode: "spot" | "usdm" | "coinm";
  fee: {
    effectiveMakerBp: number;
    effectiveTakerBp: number;
  };
  funding?: {
    period: "8h" | "4h" | "1h";
    predictedNextRateBp?: number;
    windowMinutesToFunding: number;
    signHint: string;
  };
  derived: {
    basisBpAnnual?: number;
    riskLevel: "low" | "elevated" | "high";
  };
}

export interface IncidentEvent {
  event: "risk.incident.open" | "risk.incident.update" | "risk.incident.closed";
  timestamp: string;
  type: "exposure_breach" | "execution_anomaly" | "data_staleness" | "series_loss" | "drawdown_breach";
  severity: "low" | "medium" | "high" | "critical";
  scope: {
    symbol?: string;
  };
}

export interface SentryGuardDirective {
  event: "sentry.guard.directive";
  timestamp: string;
  mode: "normal" | "degraded" | "streams_panic";
  expiresAt: string;
  reasonCodes: string[];
}

export interface MappingMeta {
  event: "mapping.meta";
  overrides: Record<string, {
    cluster: string;
    beta: Record<string, number>;
  }>;
}

export interface PolicySnapshot {
  event: "policy.snapshot";
  timestamp: string;
  version: number;
  policy: {
    clusterCaps: Record<string, number>;
    variants: {
      base: boolean;
      aggressive: boolean;
      conservative: boolean;
    };
    openBarPolicy: "penalize" | "defer" | "block";
  };
}

export interface ExternalUniverseCommand {
  event: "external.universe.command";
  timestamp: string;
  action: "whitelist_add" | "whitelist_remove" | "blacklist_add" | "blacklist_remove" | "watch_add" | "watch_remove" | "rotate_now";
  symbols: string[];
}

// Output Event Types
export interface UniverseSnapshot {
  event: "universe.snapshot";
  timestamp: string;
  version: number;
  hash: string;
  exchange: string;
  summary: {
    totalSymbols: number;
    allowed: number;
    experimental: number;
    blacklisted: number;
  };
  universe: Array<{
    symbol: string;
    status: "allowed" | "experimental" | "blocked";
    cluster: string;
    score: {
      liquidity: number;
      performance: number;
      cost: number;
      riskPenalty: number;
      composite: number;
    };
    tags: string[];
    limits?: {
      maxRiskPct?: number;
      maxConcurrent?: number;
    };
  }>;
}

export interface UniverseDiff {
  event: "universe.diff";
  timestamp: string;
  versionFrom: number;
  versionTo: number;
  added: string[];
  removed: string[];
  statusChanges: Array<{
    symbol: string;
    from: string;
    to: string;
    reasonCodes: string[];
  }>;
}

export interface UniverseApplyDirective {
  event: "universe.apply.directive";
  timestamp: string;
  version: number;
  targets: string[];
  actions: Array<{
    type: "allow_symbols" | "block_symbols" | "experimental_symbols" | "set_symbol_limit";
    symbols?: string[];
    symbol?: string;
    maxRiskPct?: number;
  }>;
  effectiveAt: string;
}

export interface UniverseAlert {
  event: "universe.alert";
  timestamp: string;
  level: "info" | "warn" | "error";
  message: string;
  context: {
    reasonCodes: string[];
    symbols?: string[];
  };
}

export interface UniverseMetrics {
  event: "universe.metrics";
  timestamp: string;
  scores: {
    avgLiquidity: number;
    avgPerf: number;
    avgCost: number;
  };
  counts: {
    allowed: number;
    experimental: number;
    blocked: number;
  };
  rotation: {
    lastAt: string;
    added: number;
    removed: number;
  };
}

// Configuration
export interface UniverseManagerConfig {
  freshness: {
    liquidityMaxAgeSec: number;
    perfMaxAgeHours: number;
    costMaxAgeMin: number;
  };
  liquidityMin: {
    volUSD: number;
    p10DepthUSD: number;
    uptimePct: number;
  };
  spreadMaxBpsAvg: number;
  filters: {
    minNotional: number;
    minTickPrecision: number;
    minStepPrecision: number;
  };
  weights: {
    liquidity: number;
    performance: number;
    cost: number;
    riskPenalty: number;
  };
  perfNorm: {
    hitRateRef: number;
    expectancyRef: number;
    slipPenaltyScale: number;
  };
  costNorm: {
    feeBpRef: number;
    fundingRiskRefBp: number;
  };
  incidentPenalty: {
    low: number;
    medium: number;
    high: number;
    critical: number;
    decayHalfLifeMin: number;
  };
  quotas: {
    maxAllowed: number;
    maxExperimental: number;
    perClusterMax: Record<string, number>;
  };
  rotation: {
    periodMin: number;
    hysteresisBps: number;
    promoteThreshold: number;
    demoteThreshold: number;
  };
  experimental: {
    candidateTopK: number;
    canaryPercent: number;
    holdMinPeriodMin: number;
  };
  manual: {
    whitelistWins: boolean;
    blacklistWins: boolean;
  };
  metricsFlushSec: number;
  tz: string;
  seed: string;
}

// Internal state
interface SymbolEntry {
  symbol: string;
  status: "allowed" | "experimental" | "blocked";
  cluster: string;
  score: {
    liquidity: number;
    performance: number;
    cost: number;
    riskPenalty: number;
    composite: number;
  };
  tags: string[];
  limits?: {
    maxRiskPct?: number;
    maxConcurrent?: number;
  };
  lastUpdate: string;
  statusSince: string;
}

interface SymbolData {
  lastLiquidity?: { data: MarketLiquiditySnapshot; receivedAt: Date; };
  lastPerformance?: { data: DailyPerformance; receivedAt: Date; };
  lastCost?: { data: CostForecastUpdate; receivedAt: Date; };
  incidentPenalties: Array<{
    severity: string;
    penalty: number;
    timestamp: Date;
  }>;
}

interface UniverseState {
  catalog?: ExchangeSymbolsCatalog;
  symbolData: Map<string, SymbolData>;
  currentUniverse: Map<string, SymbolEntry>;
  version: number;
  lastRotationAt: Date;
  manualLists: {
    whitelist: Set<string>;
    blacklist: Set<string>;
    watchlist: Set<string>;
  };
  quotaTracker: Record<string, number>;
  policyVersion: number;
  mappingMeta?: MappingMeta;
  guardMode: string;
  guardExpiresAt?: Date;
}

// Helper classes
class UniverseHasher {
  static hash(universe: Map<string, SymbolEntry>): string {
    const entries = Array.from(universe.entries()).sort();
    const str = JSON.stringify(entries);
    // Simple hash implementation
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(16);
  }
}

class DeterministicRNG {
  private seed: number;

  constructor(seedStr: string) {
    this.seed = this.hashSeed(seedStr);
  }

  next(): number {
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

export class SymbolUniverseManager extends EventEmitter {
  ver="1.0.0"; src="VIVO-31";
  private config: UniverseManagerConfig;
  private state: UniverseState;
  private metricsInterval?: NodeJS.Timeout;

  constructor(config?: Partial<UniverseManagerConfig>) {
    super();
    this.config = {
      freshness: {
        liquidityMaxAgeSec: 180,
        perfMaxAgeHours: 36,
        costMaxAgeMin: 60
      },
      liquidityMin: {
        volUSD: 2e6,
        p10DepthUSD: 5e5,
        uptimePct: 0.97
      },
      spreadMaxBpsAvg: 25,
      filters: {
        minNotional: 10,
        minTickPrecision: 1e-6,
        minStepPrecision: 1e-6
      },
      weights: {
        liquidity: 0.45,
        performance: 0.30,
        cost: 0.10,
        riskPenalty: 0.15
      },
      perfNorm: {
        hitRateRef: 0.5,
        expectancyRef: 0.15,
        slipPenaltyScale: 0.02
      },
      costNorm: {
        feeBpRef: 4.0,
        fundingRiskRefBp: 15
      },
      incidentPenalty: {
        low: 0.02,
        medium: 0.05,
        high: 0.10,
        critical: 0.20,
        decayHalfLifeMin: 180
      },
      quotas: {
        maxAllowed: 40,
        maxExperimental: 8,
        perClusterMax: { Layer1: 12, DeFi: 10, Infra: 8, Other: 10 }
      },
      rotation: {
        periodMin: 60,
        hysteresisBps: 5,
        promoteThreshold: 0.62,
        demoteThreshold: 0.55
      },
      experimental: {
        candidateTopK: 20,
        canaryPercent: 20,
        holdMinPeriodMin: 120
      },
      manual: {
        whitelistWins: true,
        blacklistWins: true
      },
      metricsFlushSec: 10,
      tz: "Europe/Istanbul",
      seed: "vivo31-universe",
      ...config
    };

    this.state = {
      symbolData: new Map(),
      currentUniverse: new Map(),
      version: 1000,
      lastRotationAt: new Date(),
      manualLists: {
        whitelist: new Set(),
        blacklist: new Set(),
        watchlist: new Set()
      },
      quotaTracker: {},
      policyVersion: 0,
      guardMode: "normal"
    };

    this.setupMetricsFlush();
  }

  attach(bus: any, logger: any) {
    bus.on("exchange.symbols.catalog", (data: any) => this.handleExchangeCatalog(data, bus, logger));
    bus.on("market.liquidity.snapshot", (data: any) => this.handleLiquiditySnapshot(data, bus, logger));
    bus.on("vivo.performance.daily", (data: any) => this.handlePerformanceDaily(data, bus, logger));
    bus.on("cost.forecast.update", (data: any) => this.handleCostForecast(data, bus, logger));
    bus.on("risk.incident.open", (data: any) => this.handleIncident(data, bus, logger));
    bus.on("risk.incident.update", (data: any) => this.handleIncident(data, bus, logger));
    bus.on("sentry.guard.directive", (data: any) => this.handleGuardDirective(data, logger));
    bus.on("mapping.meta", (data: any) => this.handleMappingMeta(data, logger));
    bus.on("policy.snapshot", (data: any) => this.handlePolicySnapshot(data, logger));
    bus.on("external.universe.command", (data: any) => this.handleExternalCommand(data, bus, logger));
  }

  private handleExchangeCatalog(data: any, bus: any, logger: any): void {
    try {
      if (data.event !== "exchange.symbols.catalog") return;
      
      const catalog = data as ExchangeSymbolsCatalog;
      this.state.catalog = catalog;
      
      // Trigger universe recomputation
      this.recomputeUniverse(bus, logger);

      if (logger) logger.info({ symbols: catalog.symbols.length }, "Exchange catalog updated");

    } catch (error: any) {
      this.emitAlert("error", `Exchange catalog validation failed: ${error.message}`, {
        reasonCodes: ["validation_error"]
      }, bus);
      
      if (logger) logger.error({ error, data }, "VIVO-31 exchange catalog error");
    }
  }

  private handleLiquiditySnapshot(data: any, bus: any, logger: any): void {
    try {
      if (data.event !== "market.liquidity.snapshot") return;
      
      const snapshot = data as MarketLiquiditySnapshot;
      
      let symbolData = this.state.symbolData.get(snapshot.symbol);
      if (!symbolData) {
        symbolData = { incidentPenalties: [] };
        this.state.symbolData.set(snapshot.symbol, symbolData);
      }
      
      symbolData.lastLiquidity = { data: snapshot, receivedAt: new Date() };
      
      // Trigger recomputation if significant change
      this.recomputeUniverse(bus, logger);

    } catch (error: any) {
      if (logger) logger.error({ error, data }, "VIVO-31 liquidity snapshot error");
    }
  }

  private handlePerformanceDaily(data: any, bus: any, logger: any): void {
    try {
      if (data.event !== "vivo.performance.daily") return;
      
      const perf = data as DailyPerformance;
      
      let symbolData = this.state.symbolData.get(perf.scope.symbol);
      if (!symbolData) {
        symbolData = { incidentPenalties: [] };
        this.state.symbolData.set(perf.scope.symbol, symbolData);
      }
      
      symbolData.lastPerformance = { data: perf, receivedAt: new Date() };
      
      this.recomputeUniverse(bus, logger);

    } catch (error: any) {
      if (logger) logger.error({ error, data }, "VIVO-31 performance daily error");
    }
  }

  private handleCostForecast(data: any, bus: any, logger: any): void {
    try {
      if (data.event !== "cost.forecast.update") return;
      
      const cost = data as CostForecastUpdate;
      
      let symbolData = this.state.symbolData.get(cost.symbol);
      if (!symbolData) {
        symbolData = { incidentPenalties: [] };
        this.state.symbolData.set(cost.symbol, symbolData);
      }
      
      symbolData.lastCost = { data: cost, receivedAt: new Date() };
      
      this.recomputeUniverse(bus, logger);

    } catch (error: any) {
      if (logger) logger.error({ error, data }, "VIVO-31 cost forecast error");
    }
  }

  private handleIncident(data: any, bus: any, logger: any): void {
    try {
      const incident = data as IncidentEvent;
      
      if (incident.scope.symbol) {
        let symbolData = this.state.symbolData.get(incident.scope.symbol);
        if (!symbolData) {
          symbolData = { incidentPenalties: [] };
          this.state.symbolData.set(incident.scope.symbol, symbolData);
        }
        
        // Add incident penalty
        const penaltyValue = this.config.incidentPenalty[incident.severity];
        symbolData.incidentPenalties.push({
          severity: incident.severity,
          penalty: penaltyValue,
          timestamp: new Date()
        });
        
        // Clean old penalties
        const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000); // 24 hours
        symbolData.incidentPenalties = symbolData.incidentPenalties.filter(p => p.timestamp > cutoff);
        
        this.recomputeUniverse(bus, logger);
      }

    } catch (error: any) {
      if (logger) logger.error({ error, data }, "VIVO-31 incident error");
    }
  }

  private handleGuardDirective(data: any, logger: any): void {
    try {
      const directive = data as SentryGuardDirective;
      this.state.guardMode = directive.mode;
      this.state.guardExpiresAt = new Date(directive.expiresAt);
      
      if (logger) logger.info({ mode: directive.mode }, "Guard directive updated");

    } catch (error: any) {
      if (logger) logger.error({ error, data }, "VIVO-31 guard directive error");
    }
  }

  private handleMappingMeta(data: any, logger: any): void {
    try {
      if (data.event === "mapping.meta") {
        this.state.mappingMeta = data as MappingMeta;
      }
    } catch (error: any) {
      if (logger) logger.error({ error, data }, "VIVO-31 mapping meta error");
    }
  }

  private handlePolicySnapshot(data: any, logger: any): void {
    try {
      if (data.event === "policy.snapshot") {
        const policy = data as PolicySnapshot;
        this.state.policyVersion = policy.version;
        
        // Update quota tracker based on policy cluster caps
        this.state.quotaTracker = { ...policy.policy.clusterCaps };
      }
    } catch (error: any) {
      if (logger) logger.error({ error, data }, "VIVO-31 policy snapshot error");
    }
  }

  private handleExternalCommand(data: any, bus: any, logger: any): void {
    try {
      const command = data as ExternalUniverseCommand;
      
      switch (command.action) {
        case "whitelist_add":
          command.symbols.forEach(s => this.state.manualLists.whitelist.add(s));
          break;
        case "whitelist_remove":
          command.symbols.forEach(s => this.state.manualLists.whitelist.delete(s));
          break;
        case "blacklist_add":
          command.symbols.forEach(s => this.state.manualLists.blacklist.add(s));
          break;
        case "blacklist_remove":
          command.symbols.forEach(s => this.state.manualLists.blacklist.delete(s));
          break;
        case "watch_add":
          command.symbols.forEach(s => this.state.manualLists.watchlist.add(s));
          break;
        case "watch_remove":
          command.symbols.forEach(s => this.state.manualLists.watchlist.delete(s));
          break;
        case "rotate_now":
          this.state.lastRotationAt = new Date(0); // Force rotation
          break;
      }
      
      this.recomputeUniverse(bus, logger);
      
      if (logger) logger.info({ action: command.action, symbols: command.symbols }, "External command processed");

    } catch (error: any) {
      if (logger) logger.error({ error, data }, "VIVO-31 external command error");
    }
  }

  private recomputeUniverse(bus: any, logger: any): void {
    if (!this.state.catalog) {
      this.emitAlert("warn", "Cannot recompute universe: no exchange catalog", {
        reasonCodes: ["missing_catalog"]
      }, bus);
      return;
    }

    const oldUniverse = new Map(this.state.currentUniverse);
    const newUniverse = new Map<string, SymbolEntry>();

    // Process each symbol from catalog
    for (const symbolInfo of this.state.catalog.symbols) {
      const entry = this.processSymbol(symbolInfo);
      if (entry) {
        newUniverse.set(entry.symbol, entry);
      }
    }

    // Apply quotas and constraints
    this.applyQuotasAndConstraints(newUniverse);

    // Check if rotation is needed
    this.checkRotation(newUniverse);

    // Update state
    this.state.currentUniverse = newUniverse;
    this.state.version++;

    // Emit events
    this.emitUniverseSnapshot(bus);
    this.emitUniverseDiff(oldUniverse, newUniverse, bus);
    this.emitApplyDirectives(bus);

    if (logger) {
      logger.info({ 
        version: this.state.version,
        symbols: newUniverse.size,
        allowed: Array.from(newUniverse.values()).filter(e => e.status === "allowed").length
      }, "Universe recomputed");
    }
  }

  private processSymbol(symbolInfo: any): SymbolEntry | null {
    const symbol = symbolInfo.symbol;
    
    // Basic filters
    if (symbolInfo.status !== "TRADING") return null;
    if (symbolInfo.filters.minNotional < this.config.filters.minNotional) return null;
    if (symbolInfo.filters.tickSize < this.config.filters.minTickPrecision) return null;
    if (symbolInfo.filters.stepSize < this.config.filters.minStepPrecision) return null;

    // Manual lists override
    if (this.config.manual.blacklistWins && this.state.manualLists.blacklist.has(symbol)) {
      return this.createSymbolEntry(symbol, "blocked", ["blacklisted"]);
    }

    // Calculate scores
    const scores = this.calculateScores(symbol);
    const cluster = this.getSymbolCluster(symbol);
    const tags = this.generateTags(symbol, scores);

    // Determine status
    let status: "allowed" | "experimental" | "blocked" = "blocked";
    
    if (this.config.manual.whitelistWins && this.state.manualLists.whitelist.has(symbol)) {
      status = "allowed";
    } else if (scores.composite >= this.config.rotation.promoteThreshold) {
      status = "allowed";
    } else if (scores.composite >= this.config.rotation.demoteThreshold) {
      status = "experimental";
    }

    return {
      symbol,
      status,
      cluster,
      score: scores,
      tags,
      lastUpdate: new Date().toISOString(),
      statusSince: new Date().toISOString() // Would track actual status changes
    };
  }

  private calculateScores(symbol: string): SymbolEntry["score"] {
    const symbolData = this.state.symbolData.get(symbol);
    
    // Liquidity score
    const liquidityScore = this.calculateLiquidityScore(symbolData?.lastLiquidity?.data);
    
    // Performance score  
    const performanceScore = this.calculatePerformanceScore(symbolData?.lastPerformance?.data);
    
    // Cost score
    const costScore = this.calculateCostScore(symbolData?.lastCost?.data);
    
    // Risk penalty
    const riskPenalty = this.calculateRiskPenalty(symbolData?.incidentPenalties || []);

    // Composite score
    const composite = 
      this.config.weights.liquidity * liquidityScore +
      this.config.weights.performance * performanceScore +
      this.config.weights.cost * costScore +
      this.config.weights.riskPenalty * riskPenalty;

    return {
      liquidity: liquidityScore,
      performance: performanceScore,
      cost: costScore,
      riskPenalty,
      composite: Math.max(0, Math.min(1, composite))
    };
  }

  private calculateLiquidityScore(liquidity?: MarketLiquiditySnapshot): number {
    if (!liquidity) return 0;

    const volScore = Math.min(1, liquidity.metrics.volUSD / this.config.liquidityMin.volUSD);
    const depthScore = Math.min(1, liquidity.metrics.p10DepthUSD / this.config.liquidityMin.p10DepthUSD);
    const spreadScore = Math.max(0, 1 - liquidity.metrics.avgSpreadBps / this.config.spreadMaxBpsAvg);
    const uptimeScore = liquidity.metrics.uptimePct;

    return 0.3 * volScore + 0.3 * depthScore + 0.2 * spreadScore + 0.2 * uptimeScore;
  }

  private calculatePerformanceScore(performance?: DailyPerformance): number {
    if (!performance) return 0.5; // Neutral score for missing data

    const hitNorm = Math.max(0, Math.min(1, (performance.kpis.hitRate - 0.35) / (0.6 - 0.35)));
    const expNorm = Math.max(0, Math.min(1, (performance.kpis.expectancyR - 0.05) / (0.25 - 0.05)));
    const slipNorm = Math.max(0, Math.min(1, performance.kpis.avgSlipBps / (2 * this.config.perfNorm.slipPenaltyScale * 100)));

    return 0.5 * hitNorm + 0.4 * expNorm + 0.1 * (1 - slipNorm);
  }

  private calculateCostScore(cost?: CostForecastUpdate): number {
    if (!cost) return 0.5; // Neutral score for missing data

    const feesScore = Math.max(0, 1 - cost.fee.effectiveTakerBp / this.config.costNorm.feeBpRef);
    
    let fundScore = 1;
    if (cost.derived.riskLevel === "high") fundScore = 0;
    else if (cost.derived.riskLevel === "elevated") fundScore = 0.5;

    return 0.6 * feesScore + 0.4 * fundScore;
  }

  private calculateRiskPenalty(penalties: Array<{ severity: string; penalty: number; timestamp: Date; }>): number {
    const now = new Date();
    let totalPenalty = 0;

    for (const p of penalties) {
      const ageMin = (now.getTime() - p.timestamp.getTime()) / (1000 * 60);
      const decayFactor = Math.exp(-Math.log(2) * ageMin / this.config.incidentPenalty.decayHalfLifeMin);
      totalPenalty += p.penalty * decayFactor;
    }

    return Math.max(0, 1 - totalPenalty);
  }

  private getSymbolCluster(symbol: string): string {
    if (this.state.mappingMeta?.overrides[symbol]) {
      return this.state.mappingMeta.overrides[symbol].cluster;
    }
    
    // Simple cluster assignment based on symbol
    if (symbol.includes("BTC") || symbol.includes("ETH")) return "Layer1";
    if (symbol.includes("UNI") || symbol.includes("SUSHI")) return "DeFi";
    return "Other";
  }

  private generateTags(symbol: string, scores: SymbolEntry["score"]): string[] {
    const tags: string[] = [];
    
    if (scores.liquidity > 0.8 && scores.performance > 0.6) tags.push("core");
    if (scores.composite > 0.4 && scores.composite < 0.7) tags.push("experimental");
    
    const symbolData = this.state.symbolData.get(symbol);
    if (symbolData?.incidentPenalties.length) tags.push("recent_incident");
    
    if (symbolData?.lastCost?.data.derived.riskLevel === "high") tags.push("funding_high_window");
    if (symbolData?.lastLiquidity?.data.metrics?.avgSpreadBps && symbolData.lastLiquidity.data.metrics.avgSpreadBps < 15) {
      tags.push("quiet_ok");
    }

    return tags;
  }

  private createSymbolEntry(symbol: string, status: "allowed" | "experimental" | "blocked", tags: string[]): SymbolEntry {
    return {
      symbol,
      status,
      cluster: this.getSymbolCluster(symbol),
      score: { liquidity: 0, performance: 0, cost: 0, riskPenalty: 0, composite: 0 },
      tags,
      lastUpdate: new Date().toISOString(),
      statusSince: new Date().toISOString()
    };
  }

  private applyQuotasAndConstraints(universe: Map<string, SymbolEntry>): void {
    // Count by cluster
    const clusterCounts = new Map<string, number>();
    let allowedCount = 0;
    let experimentalCount = 0;

    for (const entry of universe.values()) {
      if (entry.status === "allowed") {
        allowedCount++;
        clusterCounts.set(entry.cluster, (clusterCounts.get(entry.cluster) || 0) + 1);
      } else if (entry.status === "experimental") {
        experimentalCount++;
      }
    }

    // Apply global quotas
    if (allowedCount > this.config.quotas.maxAllowed) {
      this.demoteExcessAllowed(universe, allowedCount - this.config.quotas.maxAllowed);
    }

    if (experimentalCount > this.config.quotas.maxExperimental) {
      this.demoteExcessExperimental(universe, experimentalCount - this.config.quotas.maxExperimental);
    }

    // Apply cluster quotas
    for (const [cluster, max] of Object.entries(this.config.quotas.perClusterMax)) {
      const count = clusterCounts.get(cluster) || 0;
      if (count > max) {
        this.demoteExcessCluster(universe, cluster, count - max);
      }
    }
  }

  private demoteExcessAllowed(universe: Map<string, SymbolEntry>, excess: number): void {
    const allowed = Array.from(universe.values())
      .filter(e => e.status === "allowed")
      .sort((a, b) => a.score.composite - b.score.composite); // Lowest scores first

    for (let i = 0; i < Math.min(excess, allowed.length); i++) {
      allowed[i].status = "experimental";
    }
  }

  private demoteExcessExperimental(universe: Map<string, SymbolEntry>, excess: number): void {
    const experimental = Array.from(universe.values())
      .filter(e => e.status === "experimental")
      .sort((a, b) => a.score.composite - b.score.composite); // Lowest scores first

    for (let i = 0; i < Math.min(excess, experimental.length); i++) {
      experimental[i].status = "blocked";
    }
  }

  private demoteExcessCluster(universe: Map<string, SymbolEntry>, cluster: string, excess: number): void {
    const clusterSymbols = Array.from(universe.values())
      .filter(e => e.cluster === cluster && e.status === "allowed")
      .sort((a, b) => a.score.composite - b.score.composite); // Lowest scores first

    for (let i = 0; i < Math.min(excess, clusterSymbols.length); i++) {
      clusterSymbols[i].status = "experimental";
    }
  }

  private checkRotation(universe: Map<string, SymbolEntry>): void {
    const now = new Date();
    const timeSinceRotation = (now.getTime() - this.state.lastRotationAt.getTime()) / (1000 * 60);
    
    if (timeSinceRotation < this.config.rotation.periodMin) {
      return; // Too soon for rotation
    }

    // Simple rotation logic - in real implementation would be more sophisticated
    this.state.lastRotationAt = now;
  }

  private emitUniverseSnapshot(bus: any): void {
    const universeArray = Array.from(this.state.currentUniverse.values());
    
    const summary = {
      totalSymbols: universeArray.length,
      allowed: universeArray.filter(e => e.status === "allowed").length,
      experimental: universeArray.filter(e => e.status === "experimental").length,
      blacklisted: universeArray.filter(e => e.status === "blocked").length
    };

    const snapshot: UniverseSnapshot = {
      event: "universe.snapshot",
      timestamp: new Date().toISOString(),
      version: this.state.version,
      hash: UniverseHasher.hash(this.state.currentUniverse),
      exchange: this.state.catalog?.exchange || "binance",
      summary,
      universe: universeArray
    };

    bus.emit("universe.snapshot", snapshot);
  }

  private emitUniverseDiff(oldUniverse: Map<string, SymbolEntry>, newUniverse: Map<string, SymbolEntry>, bus: any): void {
    const added: string[] = [];
    const removed: string[] = [];
    const statusChanges: UniverseDiff["statusChanges"] = [];

    // Find added symbols
    for (const symbol of newUniverse.keys()) {
      if (!oldUniverse.has(symbol)) {
        added.push(symbol);
      }
    }

    // Find removed symbols and status changes
    for (const [symbol, oldEntry] of oldUniverse.entries()) {
      const newEntry = newUniverse.get(symbol);
      if (!newEntry) {
        removed.push(symbol);
      } else if (oldEntry.status !== newEntry.status) {
        statusChanges.push({
          symbol,
          from: oldEntry.status,
          to: newEntry.status,
          reasonCodes: ["score_change"] // Would be more specific in real implementation
        });
      }
    }

    if (added.length > 0 || removed.length > 0 || statusChanges.length > 0) {
      const diff: UniverseDiff = {
        event: "universe.diff",
        timestamp: new Date().toISOString(),
        versionFrom: this.state.version - 1,
        versionTo: this.state.version,
        added,
        removed,
        statusChanges
      };

      bus.emit("universe.diff", diff);
    }
  }

  private emitApplyDirectives(bus: any): void {
    const allowed = Array.from(this.state.currentUniverse.values())
      .filter(e => e.status === "allowed")
      .map(e => e.symbol);
    
    const experimental = Array.from(this.state.currentUniverse.values())
      .filter(e => e.status === "experimental")
      .map(e => e.symbol);
    
    const blocked = Array.from(this.state.currentUniverse.values())
      .filter(e => e.status === "blocked")
      .map(e => e.symbol);

    const directive: UniverseApplyDirective = {
      event: "universe.apply.directive",
      timestamp: new Date().toISOString(),
      version: this.state.version,
      targets: ["throttler", "qa", "balancer", "bandit", "router"],
      actions: [
        { type: "allow_symbols", symbols: allowed },
        { type: "experimental_symbols", symbols: experimental },
        { type: "block_symbols", symbols: blocked }
      ],
      effectiveAt: new Date().toISOString()
    };

    bus.emit("universe.apply.directive", directive);
  }

  private emitAlert(level: UniverseAlert["level"], message: string, context: UniverseAlert["context"], bus: any): void {
    const alert: UniverseAlert = {
      event: "universe.alert",
      timestamp: new Date().toISOString(),
      level,
      message,
      context
    };

    bus.emit("universe.alert", alert);
  }

  private setupMetricsFlush(): void {
    this.metricsInterval = setInterval(() => {
      this.emitMetrics();
    }, this.config.metricsFlushSec * 1000);
  }

  private emitMetrics(): void {
    const universeArray = Array.from(this.state.currentUniverse.values());
    
    const avgLiquidity = universeArray.reduce((sum, e) => sum + e.score.liquidity, 0) / Math.max(1, universeArray.length);
    const avgPerf = universeArray.reduce((sum, e) => sum + e.score.performance, 0) / Math.max(1, universeArray.length);
    const avgCost = universeArray.reduce((sum, e) => sum + e.score.cost, 0) / Math.max(1, universeArray.length);

    const metrics: UniverseMetrics = {
      event: "universe.metrics",
      timestamp: new Date().toISOString(),
      scores: {
        avgLiquidity,
        avgPerf,
        avgCost
      },
      counts: {
        allowed: universeArray.filter(e => e.status === "allowed").length,
        experimental: universeArray.filter(e => e.status === "experimental").length,
        blocked: universeArray.filter(e => e.status === "blocked").length
      },
      rotation: {
        lastAt: this.state.lastRotationAt.toISOString(),
        added: 0, // Would track rotation statistics
        removed: 0
      }
    };

    this.emit("universe.metrics", metrics);
  }

  // Public methods
  getStatus(): any {
    return {
      config: this.config,
      state: {
        version: this.state.version,
        symbolsTracked: this.state.symbolData.size,
        universeSize: this.state.currentUniverse.size,
        guardMode: this.state.guardMode,
        policyVersion: this.state.policyVersion
      }
    };
  }

  getCurrentUniverse(): UniverseSnapshot["universe"] {
    return Array.from(this.state.currentUniverse.values());
  }

  updateConfig(updates: Partial<UniverseManagerConfig>): void {
    this.config = { ...this.config, ...updates };
  }

  // Cleanup
  shutdown(): void {
    if (this.metricsInterval) {
      clearInterval(this.metricsInterval);
    }
  }
}
