/**
 * VIVO-36 · planSafetyNet.ts
 * Operatör onayı + bracket kurulumundan ilk 60–180 saniye içinde negatif mark-out 
 * ve/veya aşırı slip görülürse trim/cancel/tighten aksiyonlarıyla erken kaybı sınırlamak.
 * İlk dakika kritik risk yönetimi sistemi.
 */

import { EventEmitter } from "events";

// Input Event Types
export interface BracketReady {
  event: "order.bracket.ready";
  timestamp: string;
  correlationId: string;
  symbol: string;
  side: "buy" | "sell";
  qty: number;
  slOrderId: string;
  tpOrderIds: string[];
  variant: "conservative" | "base" | "aggressive";
  bracket: {
    entry: {
      price: number;
      orderId: string;
    };
    stopLoss: {
      price: number;
      orderId: string;
    };
    takeProfit: Array<{
      price: number;
      orderId: string;
      qty: number;
    }>;
  };
}

export interface MarkoutTick {
  event: "trade.markout.tick";
  timestamp: string;
  correlationId: string;
  dtSecFromEntry: number;
  markOutBps: number; // Positive = good, negative = bad
  slipBps: number;
  mid: number;
  spreadBps: number;
  liquidity: {
    depth: number;
    impact: number;
  };
}

export interface OrderUpdate {
  event: "order.update";
  timestamp: string;
  orderId: string;
  symbol: string;
  status: "NEW" | "PARTIALLY_FILLED" | "FILLED" | "CANCELED" | "REJECTED";
  qty: number;
  filledQty: number;
  avgPrice: number;
  correlationId?: string;
}

export interface SupervisorState {
  event: "supervisor.state";
  timestamp: string;
  positions: Record<string, {
    symbol: string;
    side: "long" | "short";
    qty: number;
    entryPrice: number;
    unrealizedPnl: number;
    markPrice: number;
  }>;
  activeBrackets: Array<{
    correlationId: string;
    symbol: string;
    status: "pending" | "active" | "partial" | "completed" | "failed";
  }>;
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
  safetyNet: {
    enabled: boolean;
    maxAutoTrim: number;
    allowTighten: boolean;
  };
}

export interface LatencySlipGuardDirective {
  event: "latency_slip.guard.directive";
  timestamp: string;
  directive: "normal" | "halt_entry" | "streams_panic" | "emergency_only";
  symbols: string[];
  reasonCodes: string[];
  expiresAt?: string;
}

// Output Event Types
export interface PlanSafetyAction {
  event: "plan.safety.action";
  timestamp: string;
  correlationId: string;
  symbol: string;
  action: "none" | "trim" | "cancel_all" | "tighten_sl";
  params: {
    trimPct?: number;
    newSL?: number;
    note?: string;
    ordersToCancel?: string[];
    newSLOrderId?: string;
  };
  reasonCodes: string[];
  audit: {
    originalEntry: number;
    currentMid: number;
    worstMarkOut: number;
    maxSlip: number;
    timeElapsed: number;
    actionCount: number;
  };
}

export interface PlanSafetyMetrics {
  event: "plan.safety.metrics";
  timestamp: string;
  symbol: string;
  correlationId: string;
  windowSec: number;
  worstMarkOutBps: number;
  maxSlipBps: number;
  avgSpreadBps: number;
  actions: {
    trim: number;
    cancel: number;
    tighten: number;
    none: number;
  };
  finalOutcome: "completed" | "trimmed" | "canceled" | "tightened";
}

// Configuration
export interface PlanSafetyConfig {
  windowSec: {
    min: number;
    max: number;
  };
  thresholds: {
    markOutWarnBps: number;
    markOutCutBps: number;
    slipCutBps: number;
    spreadWarnBps: number;
  };
  trim: {
    pct: number;
    minQty: number;
  };
  tightenSL: {
    addTightenBps: number;
    maxTimes: number;
  };
  cooldownMin: number;
  idempotencyTtlSec: number;
  tz: string;
}

// Internal state interfaces
interface WatchedBracket {
  correlationId: string;
  symbol: string;
  side: "buy" | "sell";
  qty: number;
  variant: string;
  startTime: Date;
  entryPrice: number;
  bracket: {
    slOrderId: string;
    tpOrderIds: string[];
    slPrice: number;
  };
  tracking: {
    worstMarkOut: number;
    maxSlip: number;
    avgSpread: number;
    tickCount: number;
    lastTick: Date;
  };
  actions: {
    trimCount: number;
    tightenCount: number;
    canceled: boolean;
  };
  idempotencyKeys: Set<string>;
}

interface SafetyState {
  watchedBrackets: Map<string, WatchedBracket>;
  supervisorState: SupervisorState | null;
  currentPolicy: PolicySnapshot | null;
  guardDirective: LatencySlipGuardDirective | null;
  completedActions: Map<string, Date>; // correlationId -> completion time
  stats: {
    totalBrackets: number;
    actionsTaken: number;
    trimCount: number;
    cancelCount: number;
    tightenCount: number;
    avgResponseTimeMs: number;
  };
}

export interface StdError { code:string; message:string; details?:Record<string,unknown>; retriable?:boolean; }

export class PlanSafetyNet extends EventEmitter {
  ver="1.0.0"; src="VIVO-36";
  private config: PlanSafetyConfig;
  private state: SafetyState;
  private cleanupInterval?: NodeJS.Timeout;

  constructor(config?: Partial<PlanSafetyConfig>) {
    super();
    this.config = {
      windowSec: {
        min: 60,
        max: 180
      },
      thresholds: {
        markOutWarnBps: -6,
        markOutCutBps: -12,
        slipCutBps: 15,
        spreadWarnBps: 25
      },
      trim: {
        pct: 0.33,
        minQty: 0.001
      },
      tightenSL: {
        addTightenBps: 6,
        maxTimes: 2
      },
      cooldownMin: 5,
      idempotencyTtlSec: 300,
      tz: "Europe/Istanbul",
      ...config
    };

    this.state = {
      watchedBrackets: new Map(),
      supervisorState: null,
      currentPolicy: null,
      guardDirective: null,
      completedActions: new Map(),
      stats: {
        totalBrackets: 0,
        actionsTaken: 0,
        trimCount: 0,
        cancelCount: 0,
        tightenCount: 0,
        avgResponseTimeMs: 0
      }
    };

    this.setupCleanup();
  }

  attach(bus: any, logger: any) {
    bus.on("order.bracket.ready", (data: any) => this.handleBracketReady(data, bus, logger));
    bus.on("trade.markout.tick", (data: any) => this.handleMarkoutTick(data, bus, logger));
    bus.on("order.update", (data: any) => this.handleOrderUpdate(data, logger));
    bus.on("supervisor.state", (data: any) => this.handleSupervisorState(data, logger));
    bus.on("policy.snapshot", (data: any) => this.handlePolicySnapshot(data, logger));
    bus.on("latency_slip.guard.directive", (data: any) => this.handleGuardDirective(data, logger));
  }

  private handleBracketReady(data: any, bus: any, logger: any): void {
    try {
      if (data.event !== "order.bracket.ready") return;
      
      const bracket = data as BracketReady;
      this.startWatching(bracket, bus, logger);

    } catch (error: any) {
      if (logger) logger.error({ error: error.message, correlationId: data.correlationId }, "Bracket ready handling failed");
    }
  }

  private handleMarkoutTick(data: any, bus: any, logger: any): void {
    try {
      if (data.event !== "trade.markout.tick") return;
      
      const tick = data as MarkoutTick;
      this.processMarkoutTick(tick, bus, logger);

    } catch (error: any) {
      if (logger) logger.error({ error: error.message, correlationId: data.correlationId }, "Markout tick handling failed");
    }
  }

  private handleOrderUpdate(data: any, logger: any): void {
    try {
      if (data.event !== "order.update") return;
      
      const update = data as OrderUpdate;
      this.processOrderUpdate(update, logger);

    } catch (error: any) {
      if (logger) logger.error({ error: error.message, orderId: data.orderId }, "Order update handling failed");
    }
  }

  private handleSupervisorState(data: any, logger: any): void {
    try {
      if (data.event !== "supervisor.state") return;
      
      this.state.supervisorState = data as SupervisorState;

    } catch (error: any) {
      if (logger) logger.error({ error: error.message }, "Supervisor state handling failed");
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
      if (data.event !== "latency_slip.guard.directive") return;
      
      this.state.guardDirective = data as LatencySlipGuardDirective;

    } catch (error: any) {
      if (logger) logger.error({ error: error.message }, "Guard directive handling failed");
    }
  }

  private startWatching(bracket: BracketReady, bus: any, logger: any): void {
    // Check if safety net is enabled
    if (!this.state.currentPolicy?.safetyNet?.enabled) {
      if (logger) logger.debug({ correlationId: bracket.correlationId }, "Safety net disabled, skipping watch");
      return;
    }

    // Check if we're already watching this bracket
    if (this.state.watchedBrackets.has(bracket.correlationId)) {
      if (logger) logger.warn({ correlationId: bracket.correlationId }, "Bracket already being watched");
      return;
    }

    const watchedBracket: WatchedBracket = {
      correlationId: bracket.correlationId,
      symbol: bracket.symbol,
      side: bracket.side,
      qty: bracket.qty,
      variant: bracket.variant,
      startTime: new Date(),
      entryPrice: bracket.bracket.entry.price,
      bracket: {
        slOrderId: bracket.slOrderId,
        tpOrderIds: bracket.tpOrderIds,
        slPrice: bracket.bracket.stopLoss.price
      },
      tracking: {
        worstMarkOut: 0,
        maxSlip: 0,
        avgSpread: 0,
        tickCount: 0,
        lastTick: new Date()
      },
      actions: {
        trimCount: 0,
        tightenCount: 0,
        canceled: false
      },
      idempotencyKeys: new Set()
    };

    this.state.watchedBrackets.set(bracket.correlationId, watchedBracket);
    this.state.stats.totalBrackets++;

    if (logger) logger.info({ 
      correlationId: bracket.correlationId, 
      symbol: bracket.symbol,
      entryPrice: bracket.bracket.entry.price,
      windowSec: this.config.windowSec.max
    }, "Started safety net watch");

    // Schedule window expiration
    setTimeout(() => {
      this.expireWatch(bracket.correlationId, bus, logger);
    }, this.config.windowSec.max * 1000);
  }

  private processMarkoutTick(tick: MarkoutTick, bus: any, logger: any): void {
    const watched = this.state.watchedBrackets.get(tick.correlationId);
    if (!watched) return;

    const now = new Date();
    const elapsedSec = (now.getTime() - watched.startTime.getTime()) / 1000;

    // Check if we're still within the watch window
    if (elapsedSec > this.config.windowSec.max) {
      return; // Window expired
    }

    // Update tracking
    watched.tracking.worstMarkOut = Math.min(watched.tracking.worstMarkOut, tick.markOutBps);
    watched.tracking.maxSlip = Math.max(watched.tracking.maxSlip, tick.slipBps);
    watched.tracking.avgSpread = ((watched.tracking.avgSpread * watched.tracking.tickCount) + tick.spreadBps) / (watched.tracking.tickCount + 1);
    watched.tracking.tickCount++;
    watched.tracking.lastTick = now;

    // Check for action triggers
    this.checkActionTriggers(watched, tick, bus, logger);
  }

  private checkActionTriggers(watched: WatchedBracket, tick: MarkoutTick, bus: any, logger: any): void {
    const reasonCodes: string[] = [];
    let action: "none" | "trim" | "cancel_all" | "tighten_sl" = "none";
    const params: any = {};

    // Check if guard directive limits actions
    const guardDirective = this.state.guardDirective?.directive;
    const isGuardRestricted = guardDirective === "halt_entry" || guardDirective === "streams_panic";

    // Critical mark-out: Cancel all
    if (tick.markOutBps <= this.config.thresholds.markOutCutBps && !watched.actions.canceled) {
      action = "cancel_all";
      reasonCodes.push("critical_markout");
      params.note = `Critical mark-out: ${tick.markOutBps} bps`;
      params.ordersToCancel = [watched.bracket.slOrderId, ...watched.bracket.tpOrderIds];
      
    } 
    // Warning mark-out: Trim position
    else if (tick.markOutBps <= this.config.thresholds.markOutWarnBps && 
             watched.actions.trimCount === 0 && 
             !watched.actions.canceled &&
             !isGuardRestricted) {
      
      const trimQty = watched.qty * this.config.trim.pct;
      if (trimQty >= this.config.trim.minQty) {
        action = "trim";
        reasonCodes.push("warn_markout");
        params.trimPct = this.config.trim.pct;
        params.note = `Mark-out warning: ${tick.markOutBps} bps`;
      }
    }
    // High slippage: Tighten stop loss
    else if (tick.slipBps >= this.config.thresholds.slipCutBps && 
             watched.actions.tightenCount < this.config.tightenSL.maxTimes &&
             !watched.actions.canceled &&
             (this.state.currentPolicy?.safetyNet?.allowTighten !== false)) {
      
      action = "tighten_sl";
      reasonCodes.push("high_slippage");
      params.note = `High slippage: ${tick.slipBps} bps`;
      
      // Calculate new stop loss
      const tightenBps = this.config.tightenSL.addTightenBps;
      if (watched.side === "buy") {
        params.newSL = watched.bracket.slPrice + (watched.entryPrice * tightenBps / 10000);
      } else {
        params.newSL = watched.bracket.slPrice - (watched.entryPrice * tightenBps / 10000);
      }
    }

    // Execute action if needed
    if (action !== "none") {
      this.executeAction(watched, action, params, reasonCodes, tick, bus, logger);
    }
  }

  private executeAction(
    watched: WatchedBracket, 
    action: "trim" | "cancel_all" | "tighten_sl", 
    params: any, 
    reasonCodes: string[], 
    tick: MarkoutTick,
    bus: any, 
    logger: any
  ): void {
    // Generate idempotency key
    const idempotencyKey = `${action}_${Date.now()}`;
    
    // Check for recent duplicate actions
    if (watched.idempotencyKeys.has(idempotencyKey)) {
      return; // Already processed
    }

    // Check cooldown
    const lastActionTime = this.state.completedActions.get(watched.correlationId);
    if (lastActionTime) {
      const timeSinceLastAction = (new Date().getTime() - lastActionTime.getTime()) / 1000 / 60;
      if (timeSinceLastAction < this.config.cooldownMin) {
        if (logger) logger.debug({ correlationId: watched.correlationId }, "Action skipped due to cooldown");
        return;
      }
    }

    watched.idempotencyKeys.add(idempotencyKey);

    // Update action counters
    switch (action) {
      case "trim":
        watched.actions.trimCount++;
        this.state.stats.trimCount++;
        break;
      case "cancel_all":
        watched.actions.canceled = true;
        this.state.stats.cancelCount++;
        break;
      case "tighten_sl":
        watched.actions.tightenCount++;
        this.state.stats.tightenCount++;
        break;
    }

    this.state.stats.actionsTaken++;

    // Create action event
    const safetyAction: PlanSafetyAction = {
      event: "plan.safety.action",
      timestamp: new Date().toISOString(),
      correlationId: watched.correlationId,
      symbol: watched.symbol,
      action,
      params,
      reasonCodes,
      audit: {
        originalEntry: watched.entryPrice,
        currentMid: tick.mid,
        worstMarkOut: watched.tracking.worstMarkOut,
        maxSlip: watched.tracking.maxSlip,
        timeElapsed: (new Date().getTime() - watched.startTime.getTime()) / 1000,
        actionCount: watched.actions.trimCount + watched.actions.tightenCount + (watched.actions.canceled ? 1 : 0)
      }
    };

    // Emit action
    this.emit("plan.safety.action", safetyAction);
    if (bus) bus.emit("plan.safety.action", safetyAction);

    // Record action completion time
    this.state.completedActions.set(watched.correlationId, new Date());

    if (logger) logger.warn({
      correlationId: watched.correlationId,
      action,
      reasonCodes,
      markOut: tick.markOutBps,
      slip: tick.slipBps
    }, "Safety net action executed");
  }

  private processOrderUpdate(update: OrderUpdate, logger: any): void {
    if (!update.correlationId) return;

    const watched = this.state.watchedBrackets.get(update.correlationId);
    if (!watched) return;

    // Check if this is a bracket order completion
    if (update.status === "FILLED" || update.status === "CANCELED") {
      if (update.orderId === watched.bracket.slOrderId || 
          watched.bracket.tpOrderIds.includes(update.orderId)) {
        
        // Check if all bracket orders are completed
        if (logger) logger.debug({ 
          correlationId: update.correlationId, 
          orderId: update.orderId,
          status: update.status 
        }, "Bracket order completed");
      }
    }
  }

  private expireWatch(correlationId: string, bus: any, logger: any): void {
    const watched = this.state.watchedBrackets.get(correlationId);
    if (!watched) return;

    // Generate final metrics
    const metrics: PlanSafetyMetrics = {
      event: "plan.safety.metrics",
      timestamp: new Date().toISOString(),
      symbol: watched.symbol,
      correlationId,
      windowSec: this.config.windowSec.max,
      worstMarkOutBps: watched.tracking.worstMarkOut,
      maxSlipBps: watched.tracking.maxSlip,
      avgSpreadBps: watched.tracking.avgSpread,
      actions: {
        trim: watched.actions.trimCount,
        cancel: watched.actions.canceled ? 1 : 0,
        tighten: watched.actions.tightenCount,
        none: (watched.actions.trimCount + watched.actions.tightenCount + (watched.actions.canceled ? 1 : 0)) === 0 ? 1 : 0
      },
      finalOutcome: watched.actions.canceled ? "canceled" :
                   watched.actions.trimCount > 0 ? "trimmed" :
                   watched.actions.tightenCount > 0 ? "tightened" : "completed"
    };

    this.emit("plan.safety.metrics", metrics);
    if (bus) bus.emit("plan.safety.metrics", metrics);

    // Clean up
    this.state.watchedBrackets.delete(correlationId);

    if (logger) logger.info({ 
      correlationId, 
      outcome: metrics.finalOutcome,
      worstMarkOut: metrics.worstMarkOutBps,
      maxSlip: metrics.maxSlipBps
    }, "Safety net watch expired");
  }

  private setupCleanup(): void {
    // Clean up expired actions and old data
    this.cleanupInterval = setInterval(() => {
      const now = new Date();
      const ttlMs = this.config.idempotencyTtlSec * 1000;

      // Clean up completed actions
      for (const [correlationId, completionTime] of this.state.completedActions.entries()) {
        if (now.getTime() - completionTime.getTime() > ttlMs) {
          this.state.completedActions.delete(correlationId);
        }
      }

      // Clean up any stuck watches (shouldn't happen but safety measure)
      for (const [correlationId, watched] of this.state.watchedBrackets.entries()) {
        const elapsedMs = now.getTime() - watched.startTime.getTime();
        if (elapsedMs > (this.config.windowSec.max + 60) * 1000) { // Grace period
          this.state.watchedBrackets.delete(correlationId);
        }
      }
      
    }, 60000); // Every minute
  }

  // Public methods
  getStatus(): any {
    return {
      watchedBrackets: this.state.watchedBrackets.size,
      completedActions: this.state.completedActions.size,
      stats: { ...this.state.stats },
      config: {
        thresholds: this.config.thresholds,
        windowSec: this.config.windowSec
      },
      currentPolicy: this.state.currentPolicy?.safetyNet || null,
      guardDirective: this.state.guardDirective?.directive || "normal"
    };
  }

  updateConfig(updates: Partial<PlanSafetyConfig>): void {
    this.config = { ...this.config, ...updates };
  }

  // Force expire a specific watch (for testing or manual intervention)
  forceExpire(correlationId: string, bus: any, logger: any): boolean {
    if (this.state.watchedBrackets.has(correlationId)) {
      this.expireWatch(correlationId, bus, logger);
      return true;
    }
    return false;
  }

  // Get current watch details
  getWatchDetails(correlationId: string): WatchedBracket | null {
    return this.state.watchedBrackets.get(correlationId) || null;
  }

  // Cleanup
  shutdown(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }

    // Expire all active watches
    for (const correlationId of this.state.watchedBrackets.keys()) {
      this.expireWatch(correlationId, null, null);
    }
  }
}
