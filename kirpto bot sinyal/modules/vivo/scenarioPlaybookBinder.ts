/**
 * VIVO-37 · scenarioPlaybookBinder.ts
 * Rejim/news/liquidity etiketlerini uygun plan şablonlarına bağlayıp 
 * VIVO-19'a varyant + exec style önerisi üretmek.
 * Senaryo-tabanlı otomatik strateji seçimi.
 */

import { EventEmitter } from "events";

// Input Event Types
export interface RegimenSnapshot {
  event: "gb.regime.snapshot";
  timestamp: string;
  symbol: string;
  timeframe: string;
  tags: string[]; // ["highVol","range","trend","newsWindow","thinLiq","lowVol","breakout","reversal"]
  confidence: number;
  strength: number;
  context: {
    volatility: number;
    volume: number;
    trend: "up" | "down" | "sideways";
    support: number;
    resistance: number;
  };
}

export interface QATags {
  event: "qa.tags";
  timestamp: string;
  symbol: string;
  tags: string[]; // ["open-bar","highVol","gap-open","thin-book","wide-spread","news-pending"]
  source: "market" | "news" | "technical" | "fundamental";
  severity: "low" | "medium" | "high";
  expiresAt?: string;
}

export interface PlaybookCatalog {
  event: "playbook.catalog";
  timestamp: string;
  playbooks: PlaybookEntry[];
  version: number;
}

export interface PlaybookEntry {
  id: string;
  name: string;
  description: string;
  variant: "conservative" | "base" | "aggressive";
  exec: "market" | "limit" | "twap" | "iceberg" | "time_weighted";
  params: {
    offsetBps?: number;
    displayPct?: number;
    timeSpanSec?: number;
    maxSliceSizePct?: number;
    postOnly?: boolean;
    reduceOnly?: boolean;
  };
  guards: {
    maxPositionSizePct?: number;
    maxSlippageBps?: number;
    requireConfirmation?: boolean;
  };
  applicableScenarios: string[];
  priority: number;
}

export interface PolicySnapshot {
  event: "policy.snapshot";
  timestamp: string;
  risk: {
    maxPositionSize: number;
    maxDailyLoss: number;
    allowedVariants: string[];
    emergencyOnly: boolean;
  };
  execution: {
    allowMarketOrders: boolean;
    maxSlippageBps: number;
    requireConfirmation: boolean;
  };
}

export interface GuardDirective {
  event: "guard.directive";
  timestamp: string;
  directive: "normal" | "halt_entry" | "reduce_only" | "emergency_only";
  symbols: string[];
  reasonCodes: string[];
  expiresAt?: string;
}

// Output Event Types
export interface CompositionPlaybookChoice {
  event: "composition.playbook.choice";
  timestamp: string;
  symbol: string;
  timeframe: string;
  playbookId: string;
  variant: "conservative" | "base" | "aggressive";
  exec: "market" | "limit" | "twap" | "iceberg" | "time_weighted";
  params: {
    offsetBps?: number;
    displayPct?: number;
    timeSpanSec?: number;
    maxSliceSizePct?: number;
    postOnly?: boolean;
    reduceOnly?: boolean;
  };
  constraints: {
    maxPositionSizePct?: number;
    maxSlippageBps?: number;
    requireConfirmation?: boolean;
  };
  reasonCodes: string[];
  confidence: number;
  audit: {
    matchedTags: string[];
    fallbackUsed: boolean;
    policyAdjustments: string[];
    guardOverrides: string[];
  };
}

// Configuration
export interface PlaybookBinderConfig {
  matrix: Record<string, {
    variant?: "conservative" | "base" | "aggressive";
    exec?: "market" | "limit" | "twap" | "iceberg" | "time_weighted";
    params?: Record<string, any>;
    constraints?: Record<string, any>;
    priority?: number;
  }>;
  fallback: {
    variant: "conservative" | "base" | "aggressive";
    exec: "market" | "limit" | "twap" | "iceberg" | "time_weighted";
    params?: Record<string, any>;
  };
  priorityWeights: {
    regime: number;
    qa: number;
    liquidity: number;
    news: number;
  };
  tz: string;
}

// Internal state interfaces
interface ScenarioMatch {
  tag: string;
  source: "regime" | "qa";
  priority: number;
  config: any;
  confidence: number;
}

interface PlaybookState {
  currentRegime: RegimenSnapshot | null;
  qaTags: Map<string, QATags>; // symbol -> latest QA tags
  playbooks: Map<string, PlaybookEntry>; // id -> playbook
  currentPolicy: PolicySnapshot | null;
  guardDirective: GuardDirective | null;
  recentChoices: Map<string, { choice: CompositionPlaybookChoice; timestamp: Date; }>; // symbol -> recent choice
  stats: {
    totalChoices: number;
    fallbackUsed: number;
    policyOverrides: number;
    guardOverrides: number;
    byVariant: Record<string, number>;
    byExec: Record<string, number>;
  };
}

export interface StdError { code:string; message:string; details?:Record<string,unknown>; retriable?:boolean; }

export class ScenarioPlaybookBinder extends EventEmitter {
  ver="1.0.0"; src="VIVO-37";
  private config: PlaybookBinderConfig;
  private state: PlaybookState;

  constructor(config?: Partial<PlaybookBinderConfig>) {
    super();
    this.config = {
      matrix: {
        // News/Event scenarios
        "newsWindow": { 
          variant: "conservative", 
          exec: "twap", 
          constraints: { postOnly: true },
          params: { timeSpanSec: 300 },
          priority: 10 
        },
        "news-pending": {
          variant: "conservative",
          exec: "limit",
          params: { offsetBps: 8 },
          priority: 9
        },
        
        // Volatility scenarios
        "highVol": { 
          variant: "conservative", 
          exec: "limit", 
          params: { offsetBps: 5 },
          priority: 8
        },
        "lowVol": {
          variant: "base",
          exec: "market",
          priority: 3
        },
        
        // Liquidity scenarios
        "thinLiq": { 
          exec: "iceberg", 
          params: { displayPct: 0.2, maxSliceSizePct: 0.1 },
          priority: 9
        },
        "thin-book": {
          exec: "twap",
          params: { timeSpanSec: 180, displayPct: 0.15 },
          priority: 8
        },
        "wide-spread": {
          variant: "conservative",
          exec: "limit",
          params: { offsetBps: 3 },
          priority: 7
        },
        
        // Market structure scenarios
        "trend": { 
          variant: "base",
          exec: "limit",
          params: { offsetBps: 2 },
          priority: 6
        },
        "range": { 
          variant: "conservative",
          exec: "limit",
          params: { offsetBps: 4, postOnly: true },
          priority: 6
        },
        "breakout": {
          variant: "aggressive",
          exec: "market",
          priority: 7
        },
        "reversal": {
          variant: "conservative",
          exec: "limit",
          params: { offsetBps: 6 },
          priority: 5
        },
        
        // Market timing scenarios
        "open-bar": {
          variant: "conservative",
          exec: "twap",
          params: { timeSpanSec: 120 },
          priority: 6
        },
        "gap-open": {
          variant: "conservative",
          exec: "limit",
          params: { offsetBps: 10 },
          priority: 8
        }
      },
      fallback: { 
        variant: "base", 
        exec: "limit",
        params: { offsetBps: 3 }
      },
      priorityWeights: {
        regime: 1.0,
        qa: 0.8,
        liquidity: 0.9,
        news: 1.2
      },
      tz: "Europe/Istanbul",
      ...config
    };

    this.state = {
      currentRegime: null,
      qaTags: new Map(),
      playbooks: new Map(),
      currentPolicy: null,
      guardDirective: null,
      recentChoices: new Map(),
      stats: {
        totalChoices: 0,
        fallbackUsed: 0,
        policyOverrides: 0,
        guardOverrides: 0,
        byVariant: { conservative: 0, base: 0, aggressive: 0 },
        byExec: { market: 0, limit: 0, twap: 0, iceberg: 0, time_weighted: 0 }
      }
    };
  }

  attach(bus: any, logger: any) {
    bus.on("gb.regime.snapshot", (data: any) => this.handleRegimenSnapshot(data, bus, logger));
    bus.on("qa.tags", (data: any) => this.handleQATags(data, bus, logger));
    bus.on("playbook.catalog", (data: any) => this.handlePlaybookCatalog(data, logger));
    bus.on("policy.snapshot", (data: any) => this.handlePolicySnapshot(data, logger));
    bus.on("guard.directive", (data: any) => this.handleGuardDirective(data, logger));
    
    // Trigger choice generation when regime or QA changes
    bus.on("gb.regime.snapshot", (data: any) => this.triggerPlaybookChoice(data.symbol, data.timeframe, bus, logger));
    bus.on("qa.tags", (data: any) => this.triggerPlaybookChoice(data.symbol, "1m", bus, logger));
  }

  private handleRegimenSnapshot(data: any, bus: any, logger: any): void {
    try {
      if (data.event !== "gb.regime.snapshot") return;
      
      this.state.currentRegime = data as RegimenSnapshot;
      
      if (logger) logger.debug({ 
        symbol: data.symbol, 
        tags: data.tags,
        confidence: data.confidence 
      }, "Regime snapshot updated");

    } catch (error: any) {
      if (logger) logger.error({ error: error.message }, "Regime snapshot handling failed");
    }
  }

  private handleQATags(data: any, bus: any, logger: any): void {
    try {
      if (data.event !== "qa.tags") return;
      
      const qaTags = data as QATags;
      this.state.qaTags.set(qaTags.symbol, qaTags);
      
      if (logger) logger.debug({ 
        symbol: qaTags.symbol, 
        tags: qaTags.tags,
        severity: qaTags.severity 
      }, "QA tags updated");

    } catch (error: any) {
      if (logger) logger.error({ error: error.message }, "QA tags handling failed");
    }
  }

  private handlePlaybookCatalog(data: any, logger: any): void {
    try {
      if (data.event !== "playbook.catalog") return;
      
      const catalog = data as PlaybookCatalog;
      this.state.playbooks.clear();
      
      for (const playbook of catalog.playbooks) {
        this.state.playbooks.set(playbook.id, playbook);
      }
      
      if (logger) logger.info({ 
        count: catalog.playbooks.length,
        version: catalog.version 
      }, "Playbook catalog updated");

    } catch (error: any) {
      if (logger) logger.error({ error: error.message }, "Playbook catalog handling failed");
    }
  }

  private handlePolicySnapshot(data: any, logger: any): void {
    try {
      if (data.event !== "policy.snapshot") return;
      
      this.state.currentPolicy = data as PolicySnapshot;

    } catch (error: any) {
      if (logger) logger.error({ error: error.message }, "Policy snapshot handling failed");
    }
  }

  private handleGuardDirective(data: any, logger: any): void {
    try {
      if (data.event !== "guard.directive") return;
      
      this.state.guardDirective = data as GuardDirective;

    } catch (error: any) {
      if (logger) logger.error({ error: error.message }, "Guard directive handling failed");
    }
  }

  private triggerPlaybookChoice(symbol: string, timeframe: string, bus: any, logger: any): void {
    // Check if we recently made a choice for this symbol
    const recent = this.state.recentChoices.get(symbol);
    if (recent && (Date.now() - recent.timestamp.getTime()) < 30000) { // 30 second cooldown
      return;
    }

    try {
      const choice = this.generatePlaybookChoice(symbol, timeframe, logger);
      if (choice) {
        this.state.recentChoices.set(symbol, { choice, timestamp: new Date() });
        
        this.emit("composition.playbook.choice", choice);
        if (bus) bus.emit("composition.playbook.choice", choice);
        
        if (logger) logger.info({
          symbol,
          playbookId: choice.playbookId,
          variant: choice.variant,
          exec: choice.exec,
          reasonCodes: choice.reasonCodes
        }, "Playbook choice generated");
      }
    } catch (error: any) {
      if (logger) logger.error({ error: error.message, symbol }, "Playbook choice generation failed");
    }
  }

  private generatePlaybookChoice(symbol: string, timeframe: string, logger?: any): CompositionPlaybookChoice | null {
    // Collect all scenario matches
    const matches = this.collectScenarioMatches(symbol);
    
    if (matches.length === 0) {
      return this.createFallbackChoice(symbol, timeframe, "no_matches");
    }

    // Sort matches by weighted priority
    matches.sort((a, b) => {
      const weightA = this.getSourceWeight(a.source) * a.priority * a.confidence;
      const weightB = this.getSourceWeight(b.source) * b.priority * b.confidence;
      return weightB - weightA; // Descending
    });

    // Find best matching playbook
    const bestMatch = matches[0];
    const playbookId = this.findMatchingPlaybook(bestMatch);
    
    if (!playbookId) {
      return this.createFallbackChoice(symbol, timeframe, "no_playbook_match");
    }

    const playbook = this.state.playbooks.get(playbookId);
    if (!playbook) {
      return this.createFallbackChoice(symbol, timeframe, "playbook_not_found");
    }

    // Merge configuration from matrix and playbook
    const matrixConfig = bestMatch.config;
    let variant = matrixConfig.variant || playbook.variant;
    let exec = matrixConfig.exec || playbook.exec;
    let params = { ...playbook.params, ...matrixConfig.params };
    let constraints = { ...playbook.guards, ...matrixConfig.constraints };

    // Apply policy constraints
    const policyAdjustments: string[] = [];
    const guardOverrides: string[] = [];

    // Policy variant restrictions
    if (this.state.currentPolicy?.risk.allowedVariants && 
        !this.state.currentPolicy.risk.allowedVariants.includes(variant)) {
      variant = "conservative";
      policyAdjustments.push("variant_restricted");
      this.state.stats.policyOverrides++;
    }

    // Emergency mode restrictions
    if (this.state.currentPolicy?.risk.emergencyOnly) {
      variant = "conservative";
      exec = "limit";
      params.reduceOnly = true;
      policyAdjustments.push("emergency_mode");
    }

    // Market order restrictions
    if (!this.state.currentPolicy?.execution.allowMarketOrders && exec === "market") {
      exec = "limit";
      params.offsetBps = params.offsetBps || 3;
      policyAdjustments.push("market_orders_disabled");
    }

    // Guard directive overrides
    if (this.state.guardDirective) {
      switch (this.state.guardDirective.directive) {
        case "halt_entry":
          params.reduceOnly = true;
          guardOverrides.push("halt_entry");
          this.state.stats.guardOverrides++;
          break;
        case "reduce_only":
          params.reduceOnly = true;
          guardOverrides.push("reduce_only");
          break;
        case "emergency_only":
          variant = "conservative";
          exec = "limit";
          params.reduceOnly = true;
          guardOverrides.push("emergency_only");
          break;
      }
    }

    // Calculate confidence based on match quality
    const confidence = this.calculateConfidence(matches, bestMatch);

    const choice: CompositionPlaybookChoice = {
      event: "composition.playbook.choice",
      timestamp: new Date().toISOString(),
      symbol,
      timeframe,
      playbookId,
      variant,
      exec,
      params,
      constraints,
      reasonCodes: matches.map(m => m.tag),
      confidence,
      audit: {
        matchedTags: matches.map(m => m.tag),
        fallbackUsed: false,
        policyAdjustments,
        guardOverrides
      }
    };

    // Update stats
    this.state.stats.totalChoices++;
    this.state.stats.byVariant[variant]++;
    this.state.stats.byExec[exec]++;

    return choice;
  }

  private collectScenarioMatches(symbol: string): ScenarioMatch[] {
    const matches: ScenarioMatch[] = [];

    // Collect regime tags
    if (this.state.currentRegime && this.state.currentRegime.symbol === symbol) {
      for (const tag of this.state.currentRegime.tags) {
        const config = this.config.matrix[tag];
        if (config) {
          matches.push({
            tag,
            source: "regime",
            priority: config.priority || 5,
            config,
            confidence: this.state.currentRegime.confidence || 0.8
          });
        }
      }
    }

    // Collect QA tags
    const qaTags = this.state.qaTags.get(symbol);
    if (qaTags) {
      for (const tag of qaTags.tags) {
        const config = this.config.matrix[tag];
        if (config) {
          const severityConfidence = qaTags.severity === "high" ? 0.9 : 
                                   qaTags.severity === "medium" ? 0.7 : 0.5;
          matches.push({
            tag,
            source: "qa",
            priority: config.priority || 5,
            config,
            confidence: severityConfidence
          });
        }
      }
    }

    return matches;
  }

  private getSourceWeight(source: "regime" | "qa"): number {
    switch (source) {
      case "regime":
        return this.config.priorityWeights.regime;
      case "qa":
        return this.config.priorityWeights.qa;
      default:
        return 1.0;
    }
  }

  private findMatchingPlaybook(match: ScenarioMatch): string | null {
    // Look for playbooks that handle this scenario
    for (const [id, playbook] of this.state.playbooks.entries()) {
      if (playbook.applicableScenarios.includes(match.tag)) {
        return id;
      }
    }

    // Fallback to generic playbooks
    for (const [id, playbook] of this.state.playbooks.entries()) {
      if (playbook.applicableScenarios.includes("generic") || 
          playbook.applicableScenarios.length === 0) {
        return id;
      }
    }

    return null;
  }

  private calculateConfidence(matches: ScenarioMatch[], bestMatch: ScenarioMatch): number {
    if (matches.length === 0) return 0.1;
    
    const totalWeight = matches.reduce((sum, match) => 
      sum + (this.getSourceWeight(match.source) * match.priority * match.confidence), 0);
    
    const bestWeight = this.getSourceWeight(bestMatch.source) * bestMatch.priority * bestMatch.confidence;
    
    // Confidence based on how dominant the best match is
    const dominance = bestWeight / totalWeight;
    
    // Also factor in the number of supporting matches
    const support = Math.min(matches.length / 3, 1.0);
    
    return Math.min(dominance * 0.7 + support * 0.3, 1.0);
  }

  private createFallbackChoice(symbol: string, timeframe: string, reason: string): CompositionPlaybookChoice {
    this.state.stats.totalChoices++;
    this.state.stats.fallbackUsed++;
    this.state.stats.byVariant[this.config.fallback.variant]++;
    this.state.stats.byExec[this.config.fallback.exec]++;

    return {
      event: "composition.playbook.choice",
      timestamp: new Date().toISOString(),
      symbol,
      timeframe,
      playbookId: "fallback",
      variant: this.config.fallback.variant,
      exec: this.config.fallback.exec,
      params: this.config.fallback.params || {},
      constraints: {},
      reasonCodes: ["fallback", reason],
      confidence: 0.3,
      audit: {
        matchedTags: [],
        fallbackUsed: true,
        policyAdjustments: [],
        guardOverrides: []
      }
    };
  }

  // Public methods
  getStatus(): any {
    return {
      currentRegime: this.state.currentRegime ? {
        symbol: this.state.currentRegime.symbol,
        tags: this.state.currentRegime.tags,
        confidence: this.state.currentRegime.confidence
      } : null,
      qaTags: Array.from(this.state.qaTags.entries()).map(([symbol, tags]) => ({
        symbol,
        tags: tags.tags,
        severity: tags.severity
      })),
      playbooks: this.state.playbooks.size,
      recentChoices: this.state.recentChoices.size,
      stats: { ...this.state.stats },
      policy: this.state.currentPolicy ? {
        allowedVariants: this.state.currentPolicy.risk.allowedVariants,
        emergencyOnly: this.state.currentPolicy.risk.emergencyOnly
      } : null,
      guard: this.state.guardDirective?.directive || "normal"
    };
  }

  updateConfig(updates: Partial<PlaybookBinderConfig>): void {
    this.config = { ...this.config, ...updates };
  }

  // Force generate choice for testing
  forceGenerateChoice(symbol: string, timeframe: string, logger?: any): CompositionPlaybookChoice | null {
    return this.generatePlaybookChoice(symbol, timeframe, logger);
  }

  // Get available scenarios for symbol
  getAvailableScenarios(symbol: string): string[] {
    const matches = this.collectScenarioMatches(symbol);
    return matches.map(m => m.tag);
  }

  // Clear recent choices (for testing)
  clearRecentChoices(): void {
    this.state.recentChoices.clear();
  }
}
