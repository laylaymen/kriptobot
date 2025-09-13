/**
 * VIVO-23 · riskBreachIncidentReporter.ts
 * Risk ve politika ihlallerini anında tespit eden olay yönetim sistemi.
 * Advanced incident detection, classification, and governance recommendation engine.
 */

import { EventEmitter } from "events";
import { z } from "zod";

// Input Event Schemas
export const PolicySnapshotSchema = z.object({
  event: z.literal("policy.snapshot"),
  riskPerTradePct: z.number(),
  dailyMaxTrades: z.number(),
  kellyCap: z.number(),
  maxConcurrentPerSymbol: z.number(),
  globalMaxConcurrent: z.number(),
  confirmationBounds: z.object({
    min: z.number(),
    max: z.number()
  })
});

export const LiviaGuardSchema = z.object({
  event: z.literal("livia.guard"),
  cooldownActive: z.boolean(),
  seriesLoss: z.object({
    lastN: z.number(),
    lossCount: z.number()
  }),
  emergency: z.enum(["none", "slowdown", "halt"])
});

export const AccountExposureSchema = z.object({
  event: z.literal("account.exposure"),
  timestamp: z.string(),
  openPositions: z.array(z.object({
    symbol: z.string(),
    side: z.enum(["long", "short"]),
    qty: z.number(),
    riskPct: z.number()
  })),
  totalRiskPctOpen: z.number()
});

export const IntentDecisionSchema = z.object({
  event: z.enum(["execution.intent.rejected", "execution.intent.deferred"]),
  timestamp: z.string(),
  symbol: z.string(),
  side: z.enum(["long", "short"]),
  reasonCodes: z.array(z.string()),
  correlationId: z.string()
});

export const ExecErrorSchema = z.object({
  event: z.literal("order.execution.error"),
  timestamp: z.string(),
  correlationId: z.string(),
  stage: z.enum(["placing_entry", "placing_bracket", "monitoring", "cancel_replace", "failover"]),
  code: z.enum(["network", "ratelimit", "percent_price", "min_notional", "insufficient_margin", "unknown"]),
  detail: z.string()
});

export const SupervisorAlertSchema = z.object({
  event: z.literal("vivo.supervisor.alert"),
  timestamp: z.string(),
  level: z.enum(["info", "warn", "error"]),
  message: z.string(),
  correlationId: z.string(),
  context: z.object({
    symbol: z.string(),
    reasonCodes: z.array(z.string())
  })
});

export const TradeSummaryClosedSchema = z.object({
  event: z.literal("trade.summary.closed"),
  timestamp: z.string(),
  tradeId: z.string(),
  symbol: z.string(),
  timeframe: z.string(),
  variant: z.enum(["base", "aggressive", "conservative"]),
  rMultiple: z.number(),
  pnl: z.object({
    gross: z.number(),
    fees: z.number(),
    net: z.number()
  }),
  path: z.object({
    peakR: z.number(),
    ddFromPeakR: z.number()
  }),
  flags: z.array(z.string())
});

export const MarketTelemetrySchema = z.object({
  event: z.literal("telemetry.market"),
  timestamp: z.string(),
  symbol: z.string(),
  spreadBps: z.number(),
  volZScore: z.number(),
  liquidityClass: z.enum(["low", "mid", "high"])
});

// Output Event Types
export interface RiskIncidentOpen {
  event: "risk.incident.open";
  timestamp: string;
  incidentId: string;
  type: IncidentType;
  severity: Severity;
  scope: {
    symbol: string | null;
    timeframe: string | null;
    variant: string | null;
  };
  correlationId: string | null;
  rootCause: {
    trigger: string;
    immediate: string;
    contributing: string[];
  };
  metrics: {
    totalRiskPctOpen?: number;
    ddFromPeakR?: number;
    slipBps?: number;
  };
  openReasonCodes: string[];
}

export interface RiskIncidentUpdate {
  event: "risk.incident.update";
  timestamp: string;
  incidentId: string;
  severity: Severity;
  appendReasonCodes: string[];
  metrics: {
    totalRiskPctOpen?: number;
    ddFromPeakR?: number;
    slipBps?: number;
  };
  notes: string;
}

export interface RiskIncidentClosed {
  event: "risk.incident.closed";
  timestamp: string;
  incidentId: string;
  resolution: "auto_recovered" | "manual_intervention" | "policy_applied" | "timeout";
  durationSec: number;
  finalNotes: string;
}

export interface GovernanceRecommendation {
  event: "risk.governance.recommendation";
  timestamp: string;
  incidentId: string;
  recommendations: string[];
  rationale: string[];
}

export interface IncidentFeedback {
  event: "vivo.feedback.incident";
  timestamp: string;
  type: string;
  severity: Severity;
  scope: {
    symbol: string | null;
    timeframe: string | null;
    variant: string | null;
  };
  reasonCodes: string[];
}

export type IncidentType = 
  | "policy_violation"
  | "exposure_breach" 
  | "series_loss"
  | "drawdown_breach"
  | "limit_breach"
  | "execution_anomaly"
  | "data_staleness"
  | "emergency_halt"
  | "governance_override";

export type Severity = "low" | "medium" | "high" | "critical";

export interface IncidentKey {
  type: IncidentType;
  symbol: string;
  timeframe: string;
}

export interface IncidentRecord {
  incidentId: string;
  key: IncidentKey;
  severity: Severity;
  openedAt: string;
  lastUpdatedAt: string;
  reasonCodes: string[];
  updateCount: number;
  metrics: Record<string, number>;
  correlationId?: string;
}

export interface IncidentConfig {
  // Thresholds
  maxTotalRiskPctOpen: number;
  seriesLoss: {
    window: number;
    minLosses: number;
  };
  ddFromPeakR: {
    aggressive: number;
    base: number;
    conservative: number;
  };
  slippageBpsHard: number;
  spreadBpsPanic: number;
  volZPanic: number;
  
  // Incident lifecycle
  dedupeWindowSec: number;
  autoCloseQuietSec: number;
  escalateAfterRepeats: number;
  
  // Recommendation profiles
  recommendationProfiles: Record<string, string[]>;
  
  // Telemetry
  metricsFlushSec: number;
  tz: string;
}

export interface StdError { code:string; message:string; details?:Record<string,unknown>; retriable?:boolean; }

const reasonToTypeMap: Record<string, IncidentType> = {
  // Policy violations
  "daily_limit_hit": "policy_violation",
  "per_symbol_concurrency": "policy_violation", 
  "burst_limit": "policy_violation",
  "confirmation_out_of_bounds": "policy_violation",
  
  // Exposure breaches
  "risk_cap_reached": "exposure_breach",
  "total_risk_exceeded": "exposure_breach",
  
  // Series loss
  "series_loss_detected": "series_loss",
  
  // Drawdown breaches
  "drawdown_breach": "drawdown_breach",
  
  // Limit breaches
  "percent_price": "limit_breach",
  "min_notional": "limit_breach",
  "insufficient_margin": "limit_breach",
  
  // Execution anomalies
  "ratelimit": "execution_anomaly",
  "network": "execution_anomaly",
  "failover_excess": "execution_anomaly",
  "slippage_excess": "execution_anomaly",
  
  // Data staleness
  "data_stale_panic": "data_staleness",
  "heartbeat_missing": "data_staleness",
  
  // Emergency halt
  "emergency_halt": "emergency_halt"
};

export class RiskBreachIncidentReporter extends EventEmitter {
  ver="1.0.0"; src="VIVO-23";
  private config: IncidentConfig;
  private incidentStore = new Map<string, IncidentRecord>();
  private incidentCounter = 0;
  private metricsTimer?: NodeJS.Timeout;
  private autoCloseTimer?: NodeJS.Timeout;

  constructor(config?: Partial<IncidentConfig>) {
    super();
    this.config = {
      maxTotalRiskPctOpen: 2.0,
      seriesLoss: { window: 5, minLosses: 3 },
      ddFromPeakR: { aggressive: 0.25, base: 0.35, conservative: 0.45 },
      slippageBpsHard: 15,
      spreadBpsPanic: 35,
      volZPanic: 2.2,
      dedupeWindowSec: 600,
      autoCloseQuietSec: 1800,
      escalateAfterRepeats: 2,
      recommendationProfiles: {
        "series_loss": ["apply_cooldown_30m", "disable_aggressive_variant_2h"],
        "exposure_breach": ["halt_new_intents_10m", "reduce_risk_per_trade_to_0.5pct"],
        "data_staleness": ["halt_new_intents_10m"],
        "execution_anomaly": ["tighten_confirmation_by_0.01"],
        "emergency_halt": ["halt_all_activities", "review_positions"],
        "drawdown_breach": ["apply_cooldown_60m", "reduce_position_sizes"]
      },
      metricsFlushSec: 10,
      tz: "Europe/Istanbul",
      ...config
    };
  }

  attach(bus: any, logger: any) {
    // Input event listeners
    bus.on("policy.snapshot", (data: any) => this.handlePolicySnapshot(data, bus, logger));
    bus.on("livia.guard", (data: any) => this.handleLiviaGuard(data, bus, logger));
    bus.on("account.exposure", (data: any) => this.handleAccountExposure(data, bus, logger));
    bus.on("execution.intent.rejected", (data: any) => this.handleIntentDecision(data, bus, logger));
    bus.on("execution.intent.deferred", (data: any) => this.handleIntentDecision(data, bus, logger));
    bus.on("order.execution.error", (data: any) => this.handleExecError(data, bus, logger));
    bus.on("vivo.supervisor.alert", (data: any) => this.handleSupervisorAlert(data, bus, logger));
    bus.on("trade.summary.closed", (data: any) => this.handleTradeClosed(data, bus, logger));
    bus.on("telemetry.market", (data: any) => this.handleMarketTelemetry(data, bus, logger));

    // Start periodic tasks
    this.startPeriodicTasks(bus, logger);
  }

  private handlePolicySnapshot(data: any, bus: any, logger: any) {
    try {
      const policy = PolicySnapshotSchema.parse(data);
      // Store current policy for reference in breach detection
      // This would be used to check if current state violates policy
    } catch (e: any) {
      if (logger) logger.error({ e, data }, "VIVO-23 invalid policy snapshot");
    }
  }

  private handleLiviaGuard(data: any, bus: any, logger: any) {
    try {
      const guard = LiviaGuardSchema.parse(data);
      
      // Check for series loss incident
      if (guard.seriesLoss.lossCount >= this.config.seriesLoss.minLosses) {
        this.processIncident({
          type: "series_loss",
          reasonCodes: ["series_loss_detected"],
          severity: "high",
          scope: { symbol: null, timeframe: null, variant: null },
          metrics: { seriesLossCount: guard.seriesLoss.lossCount },
          correlationId: null,
          trigger: `${guard.seriesLoss.lossCount} losses in last ${guard.seriesLoss.lastN} trades`
        }, bus, logger);
      }

      // Check for emergency halt
      if (guard.emergency === "halt") {
        this.processIncident({
          type: "emergency_halt",
          reasonCodes: ["emergency_halt"],
          severity: "critical",
          scope: { symbol: null, timeframe: null, variant: null },
          metrics: {},
          correlationId: null,
          trigger: "LIVIA emergency halt triggered"
        }, bus, logger);
      }

    } catch (e: any) {
      if (logger) logger.error({ e, data }, "VIVO-23 invalid livia guard");
    }
  }

  private handleAccountExposure(data: any, bus: any, logger: any) {
    try {
      const exposure = AccountExposureSchema.parse(data);
      
      // Check for exposure breach
      if (exposure.totalRiskPctOpen > this.config.maxTotalRiskPctOpen) {
        this.processIncident({
          type: "exposure_breach",
          reasonCodes: ["total_risk_exceeded"],
          severity: this.calculateExposureSeverity(exposure.totalRiskPctOpen),
          scope: { symbol: null, timeframe: null, variant: null },
          metrics: { totalRiskPctOpen: exposure.totalRiskPctOpen },
          correlationId: null,
          trigger: `Total risk ${exposure.totalRiskPctOpen}% exceeds limit ${this.config.maxTotalRiskPctOpen}%`
        }, bus, logger);
      }

    } catch (e: any) {
      if (logger) logger.error({ e, data }, "VIVO-23 invalid account exposure");
    }
  }

  private handleIntentDecision(data: any, bus: any, logger: any) {
    try {
      const decision = IntentDecisionSchema.parse(data);
      
      // Map reason codes to incident types
      for (const reason of decision.reasonCodes) {
        const incidentType = this.mapReasonToType(reason);
        
        this.processIncident({
          type: incidentType,
          reasonCodes: [reason],
          severity: this.calculatePolicySeverity(reason),
          scope: { symbol: decision.symbol, timeframe: null, variant: null },
          metrics: {},
          correlationId: decision.correlationId,
          trigger: `Intent ${decision.event} due to ${reason}`
        }, bus, logger);
      }

    } catch (e: any) {
      if (logger) logger.error({ e, data }, "VIVO-23 invalid intent decision");
    }
  }

  private handleExecError(data: any, bus: any, logger: any) {
    try {
      const error = ExecErrorSchema.parse(data);
      
      const incidentType = this.mapReasonToType(error.code);
      
      this.processIncident({
        type: incidentType,
        reasonCodes: [error.code],
        severity: this.calculateExecErrorSeverity(error.code, error.stage),
        scope: { symbol: null, timeframe: null, variant: null },
        metrics: {},
        correlationId: error.correlationId,
        trigger: `Execution error in ${error.stage}: ${error.code}`
      }, bus, logger);

    } catch (e: any) {
      if (logger) logger.error({ e, data }, "VIVO-23 invalid exec error");
    }
  }

  private handleSupervisorAlert(data: any, bus: any, logger: any) {
    try {
      const alert = SupervisorAlertSchema.parse(data);
      
      // Process each reason code
      for (const reason of alert.context.reasonCodes) {
        const incidentType = this.mapReasonToType(reason);
        
        this.processIncident({
          type: incidentType,
          reasonCodes: [reason],
          severity: this.mapAlertLevelToSeverity(alert.level),
          scope: { symbol: alert.context.symbol, timeframe: null, variant: null },
          metrics: {},
          correlationId: alert.correlationId,
          trigger: `Supervisor alert: ${reason}`
        }, bus, logger);
      }

    } catch (e: any) {
      if (logger) logger.error({ e, data }, "VIVO-23 invalid supervisor alert");
    }
  }

  private handleTradeClosed(data: any, bus: any, logger: any) {
    try {
      const trade = TradeSummaryClosedSchema.parse(data);
      
      // Check for drawdown breach
      const ddThreshold = this.config.ddFromPeakR[trade.variant as keyof typeof this.config.ddFromPeakR];
      if (trade.path.ddFromPeakR >= ddThreshold) {
        this.processIncident({
          type: "drawdown_breach",
          reasonCodes: ["drawdown_breach"],
          severity: this.calculateDrawdownSeverity(trade.path.ddFromPeakR, ddThreshold),
          scope: { symbol: trade.symbol, timeframe: trade.timeframe, variant: trade.variant },
          metrics: { ddFromPeakR: trade.path.ddFromPeakR, rMultiple: trade.rMultiple },
          correlationId: trade.tradeId,
          trigger: `Drawdown ${trade.path.ddFromPeakR} exceeds ${ddThreshold} for ${trade.variant}`
        }, bus, logger);
      }

    } catch (e: any) {
      if (logger) logger.error({ e, data }, "VIVO-23 invalid trade closed");
    }
  }

  private handleMarketTelemetry(data: any, bus: any, logger: any) {
    try {
      const telemetry = MarketTelemetrySchema.parse(data);
      
      // Check for market stress conditions
      const contributing: string[] = [];
      
      if (telemetry.spreadBps > this.config.spreadBpsPanic) {
        contributing.push("abnormal_spread");
      }
      
      if (Math.abs(telemetry.volZScore) > this.config.volZPanic) {
        contributing.push("abnormal_volatility");
      }
      
      if (telemetry.liquidityClass === "low") {
        contributing.push("low_liquidity");
      }

      // These are stored as contributing factors for other incidents
      // but could trigger their own incidents if severe enough
      if (contributing.length >= 2) {
        this.processIncident({
          type: "execution_anomaly",
          reasonCodes: contributing,
          severity: "medium",
          scope: { symbol: telemetry.symbol, timeframe: null, variant: null },
          metrics: { 
            spreadBps: telemetry.spreadBps, 
            volZScore: telemetry.volZScore 
          },
          correlationId: null,
          trigger: "Market stress conditions detected"
        }, bus, logger);
      }

    } catch (e: any) {
      if (logger) logger.error({ e, data }, "VIVO-23 invalid market telemetry");
    }
  }

  private processIncident(incident: {
    type: IncidentType;
    reasonCodes: string[];
    severity: Severity;
    scope: { symbol: string | null; timeframe: string | null; variant: string | null };
    metrics: Record<string, number>;
    correlationId: string | null;
    trigger: string;
  }, bus: any, logger: any) {
    
    const now = new Date().toISOString();
    const incidentKey = this.generateIncidentKey(incident.type, incident.scope);
    const keyStr = this.incidentKeyToString(incidentKey);
    
    // Check for existing incident (deduplication)
    const existing = this.incidentStore.get(keyStr);
    
    if (existing && this.isWithinDedupeWindow(existing.lastUpdatedAt)) {
      // Update existing incident
      existing.lastUpdatedAt = now;
      existing.updateCount++;
      existing.reasonCodes = [...new Set([...existing.reasonCodes, ...incident.reasonCodes])];
      existing.metrics = { ...existing.metrics, ...incident.metrics };
      
      // Escalate severity if needed
      if (existing.updateCount >= this.config.escalateAfterRepeats) {
        existing.severity = this.escalateSeverity(existing.severity);
      }
      
      // Emit update
      const updateEvent: RiskIncidentUpdate = {
        event: "risk.incident.update",
        timestamp: now,
        incidentId: existing.incidentId,
        severity: existing.severity,
        appendReasonCodes: incident.reasonCodes,
        metrics: incident.metrics,
        notes: `Update #${existing.updateCount}: ${incident.trigger}`
      };
      
      bus.emit("risk.incident.update", updateEvent);
      
      // Generate updated recommendations
      this.generateRecommendations(existing, bus, now);
      
    } else {
      // Create new incident
      const incidentId = this.generateIncidentId(incident.type, incident.scope, now);
      
      const record: IncidentRecord = {
        incidentId,
        key: incidentKey,
        severity: incident.severity,
        openedAt: now,
        lastUpdatedAt: now,
        reasonCodes: incident.reasonCodes,
        updateCount: 0,
        metrics: incident.metrics,
        correlationId: incident.correlationId || undefined
      };
      
      this.incidentStore.set(keyStr, record);
      
      // Emit new incident
      const openEvent: RiskIncidentOpen = {
        event: "risk.incident.open",
        timestamp: now,
        incidentId,
        type: incident.type,
        severity: incident.severity,
        scope: incident.scope,
        correlationId: incident.correlationId,
        rootCause: {
          trigger: incident.trigger,
          immediate: incident.reasonCodes[0] || "unknown",
          contributing: incident.reasonCodes.slice(1)
        },
        metrics: incident.metrics,
        openReasonCodes: incident.reasonCodes
      };
      
      bus.emit("risk.incident.open", openEvent);
      
      // Generate recommendations
      this.generateRecommendations(record, bus, now);
      
      // Emit feedback for learning
      const feedbackEvent: IncidentFeedback = {
        event: "vivo.feedback.incident",
        timestamp: now,
        type: incident.type,
        severity: incident.severity,
        scope: incident.scope,
        reasonCodes: incident.reasonCodes
      };
      
      bus.emit("vivo.feedback.incident", feedbackEvent);
      
      if (logger) {
        logger.warn({
          incidentId,
          type: incident.type,
          severity: incident.severity,
          trigger: incident.trigger
        }, "VIVO-23 risk incident opened");
      }
    }
  }

  private generateRecommendations(record: IncidentRecord, bus: any, timestamp: string) {
    const profile = this.config.recommendationProfiles[record.key.type] || [];
    const recommendations = [...profile];
    const rationale: string[] = [];
    
    // Add severity-based recommendations
    if (record.severity === "critical") {
      recommendations.push("halt_new_intents_10m");
      rationale.push("critical_severity_detected");
    }
    
    // Add variant-specific recommendations
    if (record.key.symbol && record.updateCount > 0) {
      recommendations.push("disable_aggressive_variant_2h");
      rationale.push("repeated_symbol_issues");
    }
    
    // Add metric-based rationale
    if (record.metrics.totalRiskPctOpen) {
      rationale.push(`open_risk_${record.metrics.totalRiskPctOpen}pct_over_${this.config.maxTotalRiskPctOpen}pct`);
    }
    
    if (record.metrics.ddFromPeakR) {
      rationale.push(`drawdown_${record.metrics.ddFromPeakR}_detected`);
    }

    const recommendation: GovernanceRecommendation = {
      event: "risk.governance.recommendation",
      timestamp,
      incidentId: record.incidentId,
      recommendations: [...new Set(recommendations)], // Remove duplicates
      rationale
    };

    bus.emit("risk.governance.recommendation", recommendation);
  }

  private startPeriodicTasks(bus: any, logger: any) {
    // Metrics emission
    this.metricsTimer = setInterval(() => {
      this.emitMetrics(bus);
    }, this.config.metricsFlushSec * 1000);

    // Auto-close quiet incidents
    this.autoCloseTimer = setInterval(() => {
      this.autoCloseQuietIncidents(bus, logger);
    }, 60000); // Check every minute
  }

  private emitMetrics(bus: any) {
    const openIncidents = this.incidentStore.size;
    const criticalCount = Array.from(this.incidentStore.values())
      .filter(i => i.severity === "critical").length;
    
    const totalUpdates = Array.from(this.incidentStore.values())
      .reduce((sum, i) => sum + i.updateCount, 0);

    bus.emit("risk.incident.metrics", {
      event: "risk.incident.metrics",
      timestamp: new Date().toISOString(),
      open_incidents: openIncidents,
      critical_incidents: criticalCount,
      total_updates: totalUpdates,
      critical_rate: openIncidents > 0 ? criticalCount / openIncidents : 0
    });
  }

  private autoCloseQuietIncidents(bus: any, logger: any) {
    const now = Date.now();
    const cutoff = now - (this.config.autoCloseQuietSec * 1000);
    
    for (const [keyStr, record] of this.incidentStore.entries()) {
      const lastUpdate = new Date(record.lastUpdatedAt).getTime();
      
      if (lastUpdate < cutoff) {
        const durationSec = (now - new Date(record.openedAt).getTime()) / 1000;
        
        const closeEvent: RiskIncidentClosed = {
          event: "risk.incident.closed",
          timestamp: new Date().toISOString(),
          incidentId: record.incidentId,
          resolution: "auto_recovered",
          durationSec: Math.round(durationSec),
          finalNotes: `Auto-closed after ${this.config.autoCloseQuietSec}s quiet period`
        };
        
        bus.emit("risk.incident.closed", closeEvent);
        this.incidentStore.delete(keyStr);
        
        if (logger) {
          logger.info({
            incidentId: record.incidentId,
            type: record.key.type,
            durationSec
          }, "VIVO-23 auto-closed quiet incident");
        }
      }
    }
  }

  // Helper methods
  private mapReasonToType(reason: string): IncidentType {
    return reasonToTypeMap[reason] || "execution_anomaly";
  }

  private calculateExposureSeverity(riskPct: number): Severity {
    const limit = this.config.maxTotalRiskPctOpen;
    const excess = riskPct - limit;
    
    if (excess >= limit * 0.5) return "critical"; // 50% over limit
    if (excess >= limit * 0.25) return "high";    // 25% over limit
    if (excess >= limit * 0.1) return "medium";   // 10% over limit
    return "low";
  }

  private calculatePolicySeverity(reason: string): Severity {
    const criticalReasons = ["daily_limit_hit", "burst_limit"];
    const highReasons = ["per_symbol_concurrency", "risk_cap_reached"];
    
    if (criticalReasons.includes(reason)) return "critical";
    if (highReasons.includes(reason)) return "high";
    return "medium";
  }

  private calculateExecErrorSeverity(code: string, stage: string): Severity {
    if (code === "network" && stage === "placing_entry") return "high";
    if (code === "ratelimit") return "medium";
    if (code === "insufficient_margin") return "high";
    return "low";
  }

  private calculateDrawdownSeverity(actual: number, threshold: number): Severity {
    const excess = actual - threshold;
    
    if (excess >= threshold * 0.5) return "critical";
    if (excess >= threshold * 0.25) return "high";
    return "medium";
  }

  private mapAlertLevelToSeverity(level: string): Severity {
    switch (level) {
      case "error": return "high";
      case "warn": return "medium";
      default: return "low";
    }
  }

  private escalateSeverity(current: Severity): Severity {
    switch (current) {
      case "low": return "medium";
      case "medium": return "high";
      case "high": return "critical";
      default: return current;
    }
  }

  private generateIncidentKey(type: IncidentType, scope: any): IncidentKey {
    return {
      type,
      symbol: scope.symbol || "*",
      timeframe: scope.timeframe || "*"
    };
  }

  private incidentKeyToString(key: IncidentKey): string {
    return `${key.type}:${key.symbol}:${key.timeframe}`;
  }

  private generateIncidentId(type: IncidentType, scope: any, timestamp: string): string {
    const date = timestamp.substring(0, 10).replace(/-/g, "");
    const symbol = scope.symbol || "GLOBAL";
    const counter = (++this.incidentCounter).toString().padStart(4, "0");
    return `RIS-${date}-${symbol}-${counter}`;
  }

  private isWithinDedupeWindow(lastUpdate: string): boolean {
    const now = Date.now();
    const last = new Date(lastUpdate).getTime();
    return (now - last) < (this.config.dedupeWindowSec * 1000);
  }

  // Public methods
  getOpenIncidents(): IncidentRecord[] {
    return Array.from(this.incidentStore.values());
  }

  getIncidentById(incidentId: string): IncidentRecord | null {
    return Array.from(this.incidentStore.values())
      .find(i => i.incidentId === incidentId) || null;
  }

  forceCloseIncident(incidentId: string, resolution: string, notes: string): boolean {
    const record = this.getIncidentById(incidentId);
    if (!record) return false;

    const keyStr = this.incidentKeyToString(record.key);
    const durationSec = (Date.now() - new Date(record.openedAt).getTime()) / 1000;

    const closeEvent: RiskIncidentClosed = {
      event: "risk.incident.closed",
      timestamp: new Date().toISOString(),
      incidentId,
      resolution: resolution as any,
      durationSec: Math.round(durationSec),
      finalNotes: notes
    };

    this.emit("risk.incident.closed", closeEvent);
    this.incidentStore.delete(keyStr);
    return true;
  }

  getStatus(): any {
    const incidents = Array.from(this.incidentStore.values());
    
    return {
      config: this.config,
      openIncidents: incidents.length,
      severityDistribution: {
        low: incidents.filter(i => i.severity === "low").length,
        medium: incidents.filter(i => i.severity === "medium").length,
        high: incidents.filter(i => i.severity === "high").length,
        critical: incidents.filter(i => i.severity === "critical").length
      },
      typeDistribution: incidents.reduce((acc, i) => {
        acc[i.key.type] = (acc[i.key.type] || 0) + 1;
        return acc;
      }, {} as Record<string, number>),
      oldestIncident: incidents.length > 0 ? 
        Math.min(...incidents.map(i => new Date(i.openedAt).getTime())) : null,
      totalIncidentsGenerated: this.incidentCounter
    };
  }

  updateConfig(updates: Partial<IncidentConfig>): void {
    this.config = { ...this.config, ...updates };
  }

  destroy(): void {
    if (this.metricsTimer) clearInterval(this.metricsTimer);
    if (this.autoCloseTimer) clearInterval(this.autoCloseTimer);
    this.incidentStore.clear();
  }
}
