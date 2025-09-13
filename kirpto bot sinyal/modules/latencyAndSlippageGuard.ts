/**
 * VIVO-26 · latencyAndSlippageGuard.ts
 * Gerçek zamanlı slipaj ve gecikme ölçümlerine göre işlem akışını geçici olarak kısıtlayan guard sistemi.
 * Advanced latency and slippage monitoring with dynamic trade flow restrictions.
 */

import { EventEmitter } from "events";

// Input Event Types
export interface PlacementResult {
  event: "order.placement.result";
  timestamp: string;
  correlationId: string;
  results: Array<{
    clientOrderId: string;
    exchangeOrderId: string;
    status: "accepted" | "rejected";
    reason: string | null;
    placeLatencyMs: number;
  }>;
  symbol: string;
  side: "long" | "short";
  variant: "base" | "aggressive" | "conservative";
}

export interface OrderUpdate {
  event: "order.update";
  timestamp: string;
  correlationId: string;
  clientOrderId: string;
  exchangeOrderId: string;
  status: "new" | "partially_filled" | "filled" | "canceled" | "expired" | "replaced" | "rejected" | "triggered";
  filledQty: number;
  avgFillPrice: number;
  lastFillSlipBps: number;
  firstFillLatencyMs: number | null;
}

export interface MarketRefs {
  event: "market.refs";
  timestamp: string;
  symbol: string;
  bestBid: number;
  bestAsk: number;
  mid: number;
  spreadBps: number;
  volZScore: number;
}

export interface ConnectivityHeartbeat {
  event: "connectivity.heartbeat";
  timestamp: string;
  latencyMs: number;
  marketStreamAlive: boolean;
  orderStreamAlive: boolean;
}

export interface PolicySnapshot {
  event: "policy.snapshot";
  riskPerTradePct: number;
  kellyCap: number;
  dailyMaxTrades: number;
  confirmationBounds: { min: number; max: number; };
  slippageHardBps: number;
  latencyHardMs: number;
}

export interface OrderPlanProposed {
  event: "order.plan.proposed";
  timestamp: string;
  symbol: string;
  side: "long" | "short";
  entryPlan: {
    mode: "market" | "limit" | "stop_market" | "stop_limit";
    legs: Array<{
      type: string;
      ttlSec: number;
      failover: "none" | "market" | "price_step_escalation";
    }>;
  };
  risk: { maxSlipBps: number; };
  audit: { variant: "base" | "aggressive" | "conservative"; };
}

// Output Event Types
export interface GuardDirective {
  event: "latency_slip.guard.directive";
  timestamp: string;
  mode: "normal" | "slowdown" | "block_aggressive" | "halt_entry" | "cancel_open_orders";
  scope: {
    symbol: string | null;
    variant: "base" | "aggressive" | "conservative" | null;
  };
  expiresAt: string;
  actions: string[];
  limits: { maxSlippageBps?: number; maxNewEntriesPerMin?: number; };
  reasonCodes: string[];
}

export interface ExecutionPolicyOverride {
  event: "execution.policy.override";
  timestamp: string;
  correlationId: string;
  directives: {
    failover?: "none" | "price_step_escalation";
    postOnly?: boolean;
    maxSlippageBps?: number;
  };
  reasonCodes: string[];
}

export interface GuardMetrics {
  event: "latency_slip.guard.metrics";
  timestamp: string;
  ewma: {
    placeMs: number;
    firstFillMs: number;
    slipBps: number;
    spreadBps: number;
  };
  modeRates: {
    normal: number;
    slowdown: number;
    block_aggressive: number;
    halt_entry: number;
  };
  panicCount: number;
}

export interface GuardAlert {
  event: "latency_slip.guard.alert";
  timestamp: string;
  level: "info" | "warn" | "error";
  message: string;
  context: {
    symbol?: string;
    reasonCodes: string[];
  };
}

// Configuration
export interface GuardConfig {
  thresholds: {
    slipWarnBps: { aggressive: number; base: number; conservative: number; };
    slipPanicBps: number;
    placeLatencyWarnMs: number;
    firstFillLatencyWarnMs: number;
    streamLatencyWarnMs: number;
    panicWhenStreamsDeadMs: number;
  };
  hysteresis: {
    exitPct: number;
    minHoldSec: number;
  };
  slowdown: {
    maxNewEntriesPerMin: number;
    expireSec: number;
  };
  ttlSec: {
    block_aggressive: number;
    halt_entry: number;
    cancel_open_orders: number;
  };
  ewmaHalfLife: {
    slip: number;
    placeMs: number;
    firstFillMs: number;
    spread: number;
  };
  overrides: {
    onSlipWarn: string[];
    onSlipPanic: string[];
    onLatencyWarn: string[];
    onStreamsPanic: string[];
  };
  metricsFlushSec: number;
  tz: string;
}

// EWMA Tracker
class EwmaTracker {
  private value = 0;
  private initialized = false;
  private readonly alpha: number;

  constructor(halfLifeMinutes: number) {
    this.alpha = 1 - Math.exp(-Math.log(2) / halfLifeMinutes);
  }

  update(newValue: number): number {
    if (!this.initialized) {
      this.value = newValue;
      this.initialized = true;
    } else {
      this.value = this.alpha * newValue + (1 - this.alpha) * this.value;
    }
    return this.value;
  }

  getValue(): number {
    return this.value;
  }

  isInitialized(): boolean {
    return this.initialized;
  }
}

// Guard State
interface GuardState {
  currentMode: "normal" | "slowdown" | "block_aggressive" | "halt_entry" | "cancel_open_orders";
  enteredAt: string | null;
  expiresAt: string | null;
  reasonCodes: string[];
  ewmaTrackers: {
    [key: string]: { // key: symbol-variant or *-*
      slipBps: EwmaTracker;
      placeMs: EwmaTracker;
      firstFillMs: EwmaTracker;
      spreadBps: EwmaTracker;
    };
  };
  lastHeartbeat: string | null;
  metrics: {
    normal: number;
    slowdown: number;
    block_aggressive: number;
    halt_entry: number;
    panicCount: number;
  };
}

export interface StdError { code:string; message:string; details?:Record<string,unknown>; retriable?:boolean; }

export class LatencyAndSlippageGuard extends EventEmitter {
  ver="1.0.0"; src="VIVO-26";
  private config: GuardConfig;
  private state: GuardState;
  private lastPolicy?: PolicySnapshot;

  constructor(config?: Partial<GuardConfig>) {
    super();
    this.config = {
      thresholds: {
        slipWarnBps: { aggressive: 10, base: 8, conservative: 6 },
        slipPanicBps: 15,
        placeLatencyWarnMs: 800,
        firstFillLatencyWarnMs: 1200,
        streamLatencyWarnMs: 700,
        panicWhenStreamsDeadMs: 8000
      },
      hysteresis: { exitPct: 0.75, minHoldSec: 60 },
      slowdown: { maxNewEntriesPerMin: 1, expireSec: 300 },
      ttlSec: { block_aggressive: 900, halt_entry: 600, cancel_open_orders: 120 },
      ewmaHalfLife: { slip: 10, placeMs: 8, firstFillMs: 8, spread: 6 },
      overrides: {
        onSlipWarn: ["disallow_market_failover", "cap_slippage_bps"],
        onSlipPanic: ["cancel_pending_entries", "defer_new_entries"],
        onLatencyWarn: ["force_post_only", "disallow_market_failover"],
        onStreamsPanic: ["halt_entry", "cancel_open_orders"]
      },
      metricsFlushSec: 10,
      tz: "Europe/Istanbul",
      ...config
    };

    this.state = {
      currentMode: "normal",
      enteredAt: null,
      expiresAt: null,
      reasonCodes: [],
      ewmaTrackers: {},
      lastHeartbeat: null,
      metrics: { normal: 0, slowdown: 0, block_aggressive: 0, halt_entry: 0, panicCount: 0 }
    };

    this.setupMetricsFlush();
  }

  attach(bus: any, logger: any) {
    bus.on("order.placement.result", (data: any) => this.handlePlacementResult(data, bus, logger));
    bus.on("order.update", (data: any) => this.handleOrderUpdate(data, bus, logger));
    bus.on("market.refs", (data: any) => this.handleMarketRefs(data, bus, logger));
    bus.on("connectivity.heartbeat", (data: any) => this.handleHeartbeat(data, bus, logger));
    bus.on("policy.snapshot", (data: any) => this.handlePolicySnapshot(data, logger));
    bus.on("order.plan.proposed", (data: any) => this.handlePlanProposed(data, bus, logger));
  }

  private getTrackerKey(symbol: string, variant: string): string {
    return `${symbol}-${variant}`;
  }

  private getOrCreateTrackers(key: string): any {
    if (!this.state.ewmaTrackers[key]) {
      this.state.ewmaTrackers[key] = {
        slipBps: new EwmaTracker(this.config.ewmaHalfLife.slip),
        placeMs: new EwmaTracker(this.config.ewmaHalfLife.placeMs),
        firstFillMs: new EwmaTracker(this.config.ewmaHalfLife.firstFillMs),
        spreadBps: new EwmaTracker(this.config.ewmaHalfLife.spread)
      };
    }
    return this.state.ewmaTrackers[key];
  }

  private handlePlacementResult(data: any, bus: any, logger: any): void {
    try {
      if (data.event !== "order.placement.result") return;
      
      const result = data as PlacementResult;
      const trackerKey = this.getTrackerKey(result.symbol, result.variant);
      const trackers = this.getOrCreateTrackers(trackerKey);

      // Update placement latency EWMA
      for (const res of result.results) {
        if (res.status === "accepted" && res.placeLatencyMs > 0) {
          trackers.placeMs.update(res.placeLatencyMs);
        }
      }

      this.evaluateAndEmitDirectives(result.symbol, result.variant, bus, logger);

    } catch (e: any) {
      if (logger) logger.error({ e, data }, "VIVO-26 placement result error");
    }
  }

  private handleOrderUpdate(data: any, bus: any, logger: any): void {
    try {
      if (data.event !== "order.update") return;
      
      const update = data as OrderUpdate;
      // Extract symbol/variant from correlationId or context (simplified)
      const symbol = "unknown"; // Would extract from correlationId
      const variant = "base"; // Would extract from correlationId
      
      const trackerKey = this.getTrackerKey(symbol, variant);
      const trackers = this.getOrCreateTrackers(trackerKey);

      // Update slippage EWMA
      if (update.lastFillSlipBps >= 0) {
        trackers.slipBps.update(update.lastFillSlipBps);
      }

      // Update first fill latency EWMA
      if (update.firstFillLatencyMs && update.firstFillLatencyMs > 0) {
        trackers.firstFillMs.update(update.firstFillLatencyMs);
      }

      // Check for panic-level slippage
      if (update.lastFillSlipBps >= this.config.thresholds.slipPanicBps) {
        this.state.metrics.panicCount++;
        this.escalateToMode("block_aggressive", ["slip_panic"], symbol, variant, bus, logger);
      }

      this.evaluateAndEmitDirectives(symbol, variant, bus, logger);

    } catch (e: any) {
      if (logger) logger.error({ e, data }, "VIVO-26 order update error");
    }
  }

  private handleMarketRefs(data: any, bus: any, logger: any): void {
    try {
      if (data.event !== "market.refs") return;
      
      const refs = data as MarketRefs;
      const trackerKey = this.getTrackerKey(refs.symbol, "*");
      const trackers = this.getOrCreateTrackers(trackerKey);

      // Update spread EWMA
      trackers.spreadBps.update(refs.spreadBps);

    } catch (e: any) {
      if (logger) logger.error({ e, data }, "VIVO-26 market refs error");
    }
  }

  private handleHeartbeat(data: any, bus: any, logger: any): void {
    try {
      if (data.event !== "connectivity.heartbeat") return;
      
      const heartbeat = data as ConnectivityHeartbeat;
      this.state.lastHeartbeat = heartbeat.timestamp;

      // Check stream health
      const streamsPanic = !heartbeat.marketStreamAlive || !heartbeat.orderStreamAlive;
      const latencyHigh = heartbeat.latencyMs > this.config.thresholds.streamLatencyWarnMs;

      if (streamsPanic) {
        const timeSinceHeartbeat = Date.now() - new Date(heartbeat.timestamp).getTime();
        if (timeSinceHeartbeat > this.config.thresholds.panicWhenStreamsDeadMs) {
          this.escalateToMode("halt_entry", ["streams_panic"], "*", "*", bus, logger);
          this.emitAlert("error", "Streams panic - halting entries", ["streams_panic"], bus);
        }
      } else if (latencyHigh) {
        this.escalateToMode("slowdown", ["latency_warn"], "*", "*", bus, logger);
      }

    } catch (e: any) {
      if (logger) logger.error({ e, data }, "VIVO-26 heartbeat error");
    }
  }

  private handlePolicySnapshot(data: any, logger: any): void {
    try {
      if (data.event === "policy.snapshot") {
        this.lastPolicy = data as PolicySnapshot;
      }
    } catch (e: any) {
      if (logger) logger.error({ e, data }, "VIVO-26 policy snapshot error");
    }
  }

  private handlePlanProposed(data: any, bus: any, logger: any): void {
    try {
      if (data.event !== "order.plan.proposed") return;
      
      const plan = data as OrderPlanProposed;
      
      // If we're in a restricted mode, emit execution override
      if (this.state.currentMode !== "normal") {
        this.emitExecutionOverride(plan, bus);
      }

    } catch (e: any) {
      if (logger) logger.error({ e, data }, "VIVO-26 plan proposed error");
    }
  }

  private evaluateAndEmitDirectives(symbol: string, variant: string, bus: any, logger: any): void {
    const trackerKey = this.getTrackerKey(symbol, variant);
    const trackers = this.state.ewmaTrackers[trackerKey];
    
    if (!trackers) return;

    const reasonCodes: string[] = [];
    let proposedMode: typeof this.state.currentMode = "normal";

    // Check thresholds
    const variantThreshold = this.config.thresholds.slipWarnBps[variant as keyof typeof this.config.thresholds.slipWarnBps];
    
    if (trackers.slipBps.isInitialized() && trackers.slipBps.getValue() >= this.config.thresholds.slipPanicBps * 0.9) {
      proposedMode = "block_aggressive";
      reasonCodes.push("slip_panic");
    } else if (trackers.slipBps.isInitialized() && trackers.slipBps.getValue() >= variantThreshold) {
      proposedMode = "slowdown";
      reasonCodes.push("slip_warn");
    }

    if (trackers.placeMs.isInitialized() && trackers.placeMs.getValue() >= this.config.thresholds.placeLatencyWarnMs) {
      if (proposedMode === "normal") proposedMode = "slowdown";
      reasonCodes.push("latency_warn");
    }

    if (trackers.firstFillMs.isInitialized() && trackers.firstFillMs.getValue() >= this.config.thresholds.firstFillLatencyWarnMs) {
      if (proposedMode === "normal") proposedMode = "slowdown";
      reasonCodes.push("fill_latency_warn");
    }

    // Apply hysteresis
    if (this.shouldUpdateMode(proposedMode, reasonCodes)) {
      this.escalateToMode(proposedMode, reasonCodes, symbol, variant, bus, logger);
    }
  }

  private shouldUpdateMode(proposedMode: typeof this.state.currentMode, reasonCodes: string[]): boolean {
    // If no issues, check if we can exit current mode
    if (proposedMode === "normal" && this.state.currentMode !== "normal") {
      const minHoldTime = this.config.hysteresis.minHoldSec * 1000;
      const timeSinceEntered = this.state.enteredAt ? Date.now() - new Date(this.state.enteredAt).getTime() : 0;
      
      return timeSinceEntered >= minHoldTime;
    }

    // If proposed mode is more severe, update immediately
    const modesSeverity = { normal: 0, slowdown: 1, block_aggressive: 2, halt_entry: 3, cancel_open_orders: 4 };
    const currentSeverity = modesSeverity[this.state.currentMode];
    const proposedSeverity = modesSeverity[proposedMode];

    return proposedSeverity > currentSeverity;
  }

  private escalateToMode(mode: typeof this.state.currentMode, reasonCodes: string[], symbol: string, variant: string, bus: any, logger: any): void {
    const now = new Date().toISOString();
    const ttl = this.config.ttlSec[mode as keyof typeof this.config.ttlSec] || 300;
    const expiresAt = new Date(Date.now() + ttl * 1000).toISOString();

    this.state.currentMode = mode;
    this.state.enteredAt = now;
    this.state.expiresAt = expiresAt;
    this.state.reasonCodes = reasonCodes;

    // Update metrics
    this.state.metrics[mode]++;

    // Emit directive
    this.emitGuardDirective(mode, symbol, variant, reasonCodes, expiresAt, bus);

    if (logger) {
      logger.warn({ mode, symbol, variant, reasonCodes }, "VIVO-26 mode escalation");
    }
  }

  private emitGuardDirective(mode: typeof this.state.currentMode, symbol: string, variant: string, reasonCodes: string[], expiresAt: string, bus: any): void {
    const actions = this.getActionsForMode(mode, reasonCodes);
    const limits: any = {};

    if (mode === "slowdown") {
      limits.maxNewEntriesPerMin = this.config.slowdown.maxNewEntriesPerMin;
    }

    if (reasonCodes.includes("slip_warn") || reasonCodes.includes("slip_panic")) {
      const variantThreshold = this.config.thresholds.slipWarnBps[variant as keyof typeof this.config.thresholds.slipWarnBps];
      limits.maxSlippageBps = variantThreshold;
    }

    const directive: GuardDirective = {
      event: "latency_slip.guard.directive",
      timestamp: new Date().toISOString(),
      mode,
      scope: { symbol: symbol === "*" ? null : symbol, variant: variant === "*" ? null : variant as any },
      expiresAt,
      actions,
      limits,
      reasonCodes
    };

    bus.emit("latency_slip.guard.directive", directive);
  }

  private getActionsForMode(mode: typeof this.state.currentMode, reasonCodes: string[]): string[] {
    const actions: string[] = [];

    for (const code of reasonCodes) {
      switch (code) {
        case "slip_warn":
          actions.push(...this.config.overrides.onSlipWarn);
          break;
        case "slip_panic":
          actions.push(...this.config.overrides.onSlipPanic);
          break;
        case "latency_warn":
          actions.push(...this.config.overrides.onLatencyWarn);
          break;
        case "streams_panic":
          actions.push(...this.config.overrides.onStreamsPanic);
          break;
      }
    }

    return [...new Set(actions)]; // Remove duplicates
  }

  private emitExecutionOverride(plan: OrderPlanProposed, bus: any): void {
    const directives: any = {};

    if (this.state.reasonCodes.includes("slip_warn") || this.state.reasonCodes.includes("slip_panic")) {
      directives.failover = "none";
      directives.postOnly = true;
      const variantThreshold = this.config.thresholds.slipWarnBps[plan.audit.variant as keyof typeof this.config.thresholds.slipWarnBps];
      directives.maxSlippageBps = Math.min(plan.risk.maxSlipBps, variantThreshold);
    }

    if (this.state.reasonCodes.includes("latency_warn")) {
      directives.postOnly = true;
      directives.failover = "price_step_escalation";
    }

    const override: ExecutionPolicyOverride = {
      event: "execution.policy.override",
      timestamp: new Date().toISOString(),
      correlationId: `${plan.symbol}-${plan.side}-${Date.now()}`,
      directives,
      reasonCodes: [`guard_active_${this.state.currentMode}`]
    };

    bus.emit("execution.policy.override", override);
  }

  private emitAlert(level: "info" | "warn" | "error", message: string, reasonCodes: string[], bus: any): void {
    const alert: GuardAlert = {
      event: "latency_slip.guard.alert",
      timestamp: new Date().toISOString(),
      level,
      message,
      context: { reasonCodes }
    };

    bus.emit("latency_slip.guard.alert", alert);
  }

  private setupMetricsFlush(): void {
    setInterval(() => {
      this.emitMetrics();
    }, this.config.metricsFlushSec * 1000);
  }

  private emitMetrics(): void {
    const globalTrackers = this.state.ewmaTrackers["*-*"];
    
    const metrics: GuardMetrics = {
      event: "latency_slip.guard.metrics",
      timestamp: new Date().toISOString(),
      ewma: {
        placeMs: globalTrackers?.placeMs.getValue() || 0,
        firstFillMs: globalTrackers?.firstFillMs.getValue() || 0,
        slipBps: globalTrackers?.slipBps.getValue() || 0,
        spreadBps: globalTrackers?.spreadBps.getValue() || 0
      },
      modeRates: this.state.metrics,
      panicCount: this.state.metrics.panicCount
    };

    this.emit("latency_slip.guard.metrics", metrics);
  }

  // Public methods
  getStatus(): any {
    return {
      config: this.config,
      state: {
        currentMode: this.state.currentMode,
        enteredAt: this.state.enteredAt,
        expiresAt: this.state.expiresAt,
        reasonCodes: this.state.reasonCodes,
        trackerCount: Object.keys(this.state.ewmaTrackers).length
      },
      metrics: this.state.metrics
    };
  }

  updateConfig(updates: Partial<GuardConfig>): void {
    this.config = { ...this.config, ...updates };
  }

  forceMode(mode: typeof this.state.currentMode, reasonCodes: string[], durationSec: number = 300): void {
    const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + durationSec * 1000).toISOString();
    
    this.state.currentMode = mode;
    this.state.enteredAt = now;
    this.state.expiresAt = expiresAt;
    this.state.reasonCodes = reasonCodes;
  }
}
