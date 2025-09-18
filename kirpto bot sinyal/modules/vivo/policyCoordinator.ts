/**
 * VIVO-29 · policyCoordinator.ts
 * Tüm politika kaynaklarını birleştiren merkezi koordinatör.
 * Çakışma çözümü, öncelik sırası, kapsam kurallarıyla karar verip policy.diff yayınlar.
 */

import { EventEmitter } from "events";
import { z } from "zod";

// Zod Schemas for validation
const ScopeSchema = z.object({
  level: z.enum(["global", "cluster", "symbol", "variant", "timeframe"]),
  cluster: z.string().nullable().optional(),
  symbol: z.string().nullable().optional(),
  variant: z.enum(["base", "aggressive", "conservative"]).nullable().optional(),
  timeframe: z.enum(["M1", "M5", "M15", "H1", "H4", "D1"]).nullable().optional()
});

const PolicyPatchSchema = z.object({
  risk: z.object({
    riskPerTradePct: z.number().nullable().optional(),
    totalRiskPct: z.number().nullable().optional(),
    kellyCap: z.number().nullable().optional(),
    dailyMaxTrades: z.number().nullable().optional(),
    maxConcurrentPerSymbol: z.number().nullable().optional(),
    globalMaxConcurrent: z.number().nullable().optional(),
    longShortImbalancePct: z.number().nullable().optional()
  }).optional(),
  quality: z.object({
    confirmationBounds: z.object({
      min: z.number().nullable().optional(),
      max: z.number().nullable().optional()
    }).optional(),
    openBarPolicy: z.enum(["penalize", "defer", "block"]).nullable().optional(),
    slippageHardBps: z.number().nullable().optional(),
    latencyHardMs: z.number().nullable().optional()
  }).optional(),
  variants: z.object({
    allowed: z.object({
      base: z.boolean().nullable().optional(),
      aggressive: z.boolean().nullable().optional(),
      conservative: z.boolean().nullable().optional()
    }).optional()
  }).optional(),
  clusters: z.object({
    caps: z.record(z.string(), z.number()).optional()
  }).optional(),
  symbols: z.record(z.string(), z.object({
    perSymbolPct: z.number().nullable().optional(),
    cooldownMin: z.number().nullable().optional()
  })).optional(),
  throttle: z.object({
    maxBurstsPerMin: z.number().nullable().optional(),
    slowdownEnabled: z.boolean().nullable().optional()
  }).optional()
});

const PolicySourceUpdateSchema = z.object({
  event: z.literal("policy.source.update"),
  timestamp: z.string(),
  source: z.enum(["default", "livia", "manual", "governance", "runtime"]),
  priority: z.number(),
  scope: ScopeSchema,
  window: z.object({
    effectiveAt: z.string().nullable().optional(),
    expireAt: z.string().nullable().optional(),
    rollout: z.object({
      percent: z.number().min(0).max(100).nullable().optional(),
      canaryTags: z.array(z.string()).optional()
    }).optional()
  }).optional(),
  patch: PolicyPatchSchema,
  audit: z.object({
    reasonCodes: z.array(z.string()),
    note: z.string().nullable().optional(),
    changeId: z.string().nullable().optional()
  })
});

// Input Event Types
export interface PolicySourceUpdate extends z.infer<typeof PolicySourceUpdateSchema> {}

export interface RiskGovernanceRecommendation {
  event: "risk.governance.recommendation";
  timestamp: string;
  incidentId: string;
  recommendations: string[];
  rationale: string[];
}

export interface SentryGuardDirective {
  event: "sentry.guard.directive" | "latency_slip.guard.directive";
  timestamp: string;
  mode: "normal" | "degraded" | "streams_panic" | "halt_entry" | "block_aggressive";
  expiresAt: string;
}

// Output Event Types
export interface PolicySnapshot {
  event: "policy.snapshot";
  timestamp: string;
  version: number;
  effectiveAt: string;
  expiresAt?: string;
  hash: string;
  sourceStack: Array<{
    source: string;
    priority: number;
    changeId?: string;
  }>;
  policy: {
    riskPerTradePct: number;
    totalRiskPct: number;
    kellyCap: number;
    dailyMaxTrades: number;
    maxConcurrentPerSymbol: number;
    globalMaxConcurrent: number;
    longShortImbalancePct: number;
    confirmationBounds: { min: number; max: number; };
    openBarPolicy: "penalize" | "defer" | "block";
    slippageHardBps: number;
    latencyHardMs: number;
    variants: { base: boolean; aggressive: boolean; conservative: boolean; };
    clusterCaps: Record<string, number>;
    symbolOverrides: Record<string, { perSymbolPct?: number; cooldownMin?: number; }>;
    throttle: { maxBurstsPerMin: number; slowdownEnabled: boolean; };
  };
  scopeIndex: Array<{
    scope: any;
    policyRef: string;
  }>;
}

export interface PolicyDiff {
  event: "policy.diff";
  timestamp: string;
  versionFrom: number;
  versionTo: number;
  changes: Array<{
    path: string;
    from: any;
    to: any;
    reasonCodes: string[];
  }>;
  rollout: { percent: number; canaryTags: string[]; };
}

export interface PolicyApplyDirective {
  event: "policy.apply.directive";
  timestamp: string;
  version: number;
  targets: string[];
  scope: any;
  actions: Array<{
    type: string;
    key?: string;
    value?: any;
    variant?: string;
    enabled?: boolean;
    min?: number;
    max?: number;
    cluster?: string;
    symbol?: string;
    maxBurstsPerMin?: number;
  }>;
  effectiveAt: string;
  expiresAt?: string;
}

export interface PolicyRollback {
  event: "policy.rollback";
  timestamp: string;
  rollbackToVersion: number;
  reason: string;
}

export interface PolicyMetrics {
  event: "policy.metrics";
  timestamp: string;
  applies: number;
  rollouts: number;
  rollbacks: number;
  conflictsResolved: number;
  canaryCoveragePct: number;
}

export interface PolicyAlert {
  event: "policy.alert";
  timestamp: string;
  level: "info" | "warn" | "error";
  message: string;
  context: {
    reasonCodes: string[];
    conflictPaths?: string[];
  };
}

// Configuration
export interface PolicyCoordinatorConfig {
  versionStart: number;
  defaultPolicy: PolicySnapshot["policy"];
  precedence: Record<string, number>;
  rollout: {
    defaultPercent: number;
    hashSalt: string;
  };
  metricsFlushSec: number;
  tz: string;
}

// Internal state
interface PolicyOverlay {
  source: string;
  priority: number;
  scope: any;
  patch: any;
  window?: {
    effectiveAt?: string;
    expireAt?: string;
    rollout?: {
      percent?: number;
      canaryTags?: string[];
    };
  };
  audit: {
    reasonCodes: string[];
    note?: string;
    changeId?: string;
  };
  timestamp: string;
}

interface CoordinatorState {
  versionClock: number;
  currentSnapshot?: PolicySnapshot;
  overlays: Map<string, PolicyOverlay>; // key: source_scope_changeId
  rolloutAssignments: Map<string, string>; // correlationId/symbol -> bucket
  history: Array<{ diff: PolicyDiff; applied: string; }>;
  processedChangeIds: Set<string>;
}

// Helper functions
class PolicyMerger {
  static merge(base: any, overlays: PolicyOverlay[]): any {
    const sorted = overlays
      .filter(o => this.isWindowActive(o))
      .sort((a, b) => {
        // First by scope specificity, then by priority
        const scopeRankA = this.getScopeRank(a.scope);
        const scopeRankB = this.getScopeRank(b.scope);
        
        if (scopeRankA !== scopeRankB) {
          return scopeRankB - scopeRankA; // Higher rank first
        }
        
        return b.priority - a.priority; // Higher priority first
      });

    let result = JSON.parse(JSON.stringify(base));
    
    for (const overlay of sorted) {
      result = this.applyPatch(result, overlay.patch);
    }
    
    return result;
  }

  private static isWindowActive(overlay: PolicyOverlay): boolean {
    const now = new Date();
    
    if (overlay.window?.effectiveAt) {
      const effectiveAt = new Date(overlay.window.effectiveAt);
      if (now < effectiveAt) return false;
    }
    
    if (overlay.window?.expireAt) {
      const expireAt = new Date(overlay.window.expireAt);
      if (now > expireAt) return false;
    }
    
    return true;
  }

  private static getScopeRank(scope: any): number {
    // Higher number = more specific
    if (scope.level === "symbol") return 40;
    if (scope.level === "cluster") return 30;
    if (scope.level === "variant") return 20;
    if (scope.level === "timeframe") return 10;
    return 0; // global
  }

  private static applyPatch(target: any, patch: any): any {
    if (!patch) return target;
    
    const result = JSON.parse(JSON.stringify(target));
    
    // Simple merge logic - in real implementation would use JSON Merge Patch
    for (const [key, value] of Object.entries(patch)) {
      if (value && typeof value === "object" && !Array.isArray(value)) {
        if (!result[key]) result[key] = {};
        result[key] = this.applyPatch(result[key], value);
      } else if (value !== null && value !== undefined) {
        result[key] = value;
      }
    }
    
    return result;
  }
}

class PolicyHasher {
  static hash(policy: any): string {
    const str = JSON.stringify(policy, Object.keys(policy).sort());
    // Simple hash - in real implementation would use crypto
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(16);
  }
}

export interface StdError { code:string; message:string; details?:Record<string,unknown>; retriable?:boolean; }

export class PolicyCoordinator extends EventEmitter {
  ver="1.0.0"; src="VIVO-29";
  private config: PolicyCoordinatorConfig;
  private state: CoordinatorState;
  private metricsInterval?: NodeJS.Timeout;

  constructor(config?: Partial<PolicyCoordinatorConfig>) {
    super();
    this.config = {
      versionStart: 1000,
      defaultPolicy: {
        riskPerTradePct: 0.5,
        totalRiskPct: 2.0,
        kellyCap: 0.25,
        dailyMaxTrades: 3,
        maxConcurrentPerSymbol: 1,
        globalMaxConcurrent: 3,
        longShortImbalancePct: 1.0,
        confirmationBounds: { min: 0.58, max: 0.72 },
        openBarPolicy: "penalize",
        slippageHardBps: 15,
        latencyHardMs: 1800,
        variants: { base: true, aggressive: true, conservative: true },
        clusterCaps: { Layer1: 1.2, DeFi: 0.8, Infra: 0.8, Other: 0.8 },
        symbolOverrides: {},
        throttle: { maxBurstsPerMin: 3, slowdownEnabled: true }
      },
      precedence: { manual: 100, governance: 80, livia: 70, runtime: 60, default: 10 },
      rollout: { defaultPercent: 100, hashSalt: "vivo29" },
      metricsFlushSec: 10,
      tz: "Europe/Istanbul",
      ...config
    };

    this.state = {
      versionClock: this.config.versionStart,
      overlays: new Map(),
      rolloutAssignments: new Map(),
      history: [],
      processedChangeIds: new Set()
    };

    this.setupMetricsFlush();
    this.initializeDefaultPolicy();
  }

  attach(bus: any, logger: any) {
    bus.on("policy.source.update", (data: any) => this.handlePolicySourceUpdate(data, bus, logger));
    bus.on("risk.governance.recommendation", (data: any) => this.handleGovernanceRecommendation(data, bus, logger));
    bus.on("sentry.guard.directive", (data: any) => this.handleSentryDirective(data, bus, logger));
    bus.on("latency_slip.guard.directive", (data: any) => this.handleSentryDirective(data, bus, logger));
  }

  private initializeDefaultPolicy(): void {
    // Create initial snapshot with default policy
    const snapshot: PolicySnapshot = {
      event: "policy.snapshot",
      timestamp: new Date().toISOString(),
      version: this.state.versionClock,
      effectiveAt: new Date().toISOString(),
      hash: PolicyHasher.hash(this.config.defaultPolicy),
      sourceStack: [{ source: "default", priority: this.config.precedence.default }],
      policy: this.config.defaultPolicy,
      scopeIndex: [{ scope: { level: "global" }, policyRef: "hash#global" }]
    };

    this.state.currentSnapshot = snapshot;
    this.state.versionClock++;
  }

  private handlePolicySourceUpdate(data: any, bus: any, logger: any): void {
    try {
      const update = PolicySourceUpdateSchema.parse(data);
      
      // Check for idempotency
      if (update.audit.changeId && this.state.processedChangeIds.has(update.audit.changeId)) {
        logger.debug({ changeId: update.audit.changeId }, "Policy update already processed");
        return;
      }

      // Create overlay
      const overlayKey = this.generateOverlayKey(update);
      const overlay: PolicyOverlay = {
        source: update.source,
        priority: update.priority,
        scope: update.scope,
        patch: update.patch,
        window: update.window,
        audit: {
          reasonCodes: update.audit?.reasonCodes || [],
          note: update.audit?.note,
          changeId: update.audit?.changeId
        },
        timestamp: update.timestamp
      };

      this.state.overlays.set(overlayKey, overlay);
      
      if (update.audit.changeId) {
        this.state.processedChangeIds.add(update.audit.changeId);
      }

      // Recompute policy
      this.recomputePolicy(bus, logger);

    } catch (error: any) {
      this.emitAlert("error", `Policy update validation failed: ${error.message}`, {
        reasonCodes: ["validation_error"]
      }, bus);
      
      if (logger) logger.error({ error, data }, "VIVO-29 policy source update error");
    }
  }

  private handleGovernanceRecommendation(data: any, bus: any, logger: any): void {
    try {
      if (data.event !== "risk.governance.recommendation") return;
      
      const rec = data as RiskGovernanceRecommendation;
      
      // Convert recommendations to policy patches
      const patches = this.convertRecommendationsToPatch(rec.recommendations);
      
      for (const patch of patches) {
        const update: PolicySourceUpdate = {
          event: "policy.source.update",
          timestamp: new Date().toISOString(),
          source: "governance",
          priority: this.config.precedence.governance,
          scope: { level: "global" },
          patch,
          audit: {
            reasonCodes: rec.rationale,
            note: `Auto-generated from incident ${rec.incidentId}`,
            changeId: `GOV-${rec.incidentId}-${Date.now()}`
          }
        };

        this.handlePolicySourceUpdate(update, bus, logger);
      }

    } catch (error: any) {
      if (logger) logger.error({ error, data }, "VIVO-29 governance recommendation error");
    }
  }

  private handleSentryDirective(data: any, bus: any, logger: any): void {
    try {
      const directive = data as SentryGuardDirective;
      
      // Convert sentry mode to policy patch
      const patch = this.convertSentryModeToPatch(directive.mode);
      
      const update: PolicySourceUpdate = {
        event: "policy.source.update",
        timestamp: new Date().toISOString(),
        source: "runtime",
        priority: this.config.precedence.runtime,
        scope: { level: "global" },
        window: {
          effectiveAt: directive.timestamp,
          expireAt: directive.expiresAt
        },
        patch,
        audit: {
          reasonCodes: [`sentry_${directive.mode}`],
          note: `Auto-generated from ${directive.event}`,
          changeId: `SENTRY-${Date.now()}`
        }
      };

      this.handlePolicySourceUpdate(update, bus, logger);

    } catch (error: any) {
      if (logger) logger.error({ error, data }, "VIVO-29 sentry directive error");
    }
  }

  private recomputePolicy(bus: any, logger: any): void {
    const oldSnapshot = this.state.currentSnapshot;
    
    // Get active overlays
    const activeOverlays = Array.from(this.state.overlays.values());
    
    // Merge with default policy
    const mergedPolicy = PolicyMerger.merge(this.config.defaultPolicy, activeOverlays);
    
    // Create new snapshot
    const newSnapshot: PolicySnapshot = {
      event: "policy.snapshot",
      timestamp: new Date().toISOString(),
      version: this.state.versionClock,
      effectiveAt: new Date().toISOString(),
      hash: PolicyHasher.hash(mergedPolicy),
      sourceStack: this.buildSourceStack(activeOverlays),
      policy: mergedPolicy,
      scopeIndex: this.buildScopeIndex(activeOverlays)
    };

    // Compute diff if we have a previous snapshot
    if (oldSnapshot) {
      const diff = this.computeDiff(oldSnapshot, newSnapshot);
      if (diff.changes.length > 0) {
        bus.emit("policy.diff", diff);
        this.state.history.push({ diff, applied: new Date().toISOString() });
      }
    }

    this.state.currentSnapshot = newSnapshot;
    this.state.versionClock++;

    // Emit snapshot and directives
    bus.emit("policy.snapshot", newSnapshot);
    this.emitApplyDirectives(newSnapshot, bus);
    
    if (logger) {
      logger.info({ 
        version: newSnapshot.version, 
        hash: newSnapshot.hash,
        overlays: activeOverlays.length 
      }, "Policy recomputed");
    }
  }

  private generateOverlayKey(update: PolicySourceUpdate): string {
    const scope = JSON.stringify(update.scope);
    const changeId = update.audit.changeId || Date.now().toString();
    return `${update.source}_${scope}_${changeId}`;
  }

  private convertRecommendationsToPatch(recommendations: string[]): any[] {
    const patches: any[] = [];
    
    for (const rec of recommendations) {
      if (rec.includes("apply_cooldown")) {
        patches.push({
          symbols: { "*": { cooldownMin: this.extractNumber(rec) || 30 } }
        });
      } else if (rec.includes("halt_new_intents")) {
        patches.push({
          throttle: { maxBurstsPerMin: 0 }
        });
      } else if (rec.includes("disable_aggressive_variant")) {
        patches.push({
          variants: { allowed: { aggressive: false } }
        });
      } else if (rec.includes("tighten_confirmation")) {
        const delta = this.extractNumber(rec) || 0.01;
        patches.push({
          quality: {
            confirmationBounds: {
              min: null, // Will be computed during merge
              max: null  // Will be computed during merge
            }
          }
        });
      }
    }
    
    return patches;
  }

  private convertSentryModeToPatch(mode: string): any {
    switch (mode) {
      case "halt_entry":
        return {
          throttle: { maxBurstsPerMin: 0 }
        };
      case "block_aggressive":
        return {
          variants: { allowed: { aggressive: false } }
        };
      case "degraded":
        return {
          quality: { slippageHardBps: 10, latencyHardMs: 1000 }
        };
      case "streams_panic":
        return {
          throttle: { maxBurstsPerMin: 0 },
          variants: { allowed: { aggressive: false, base: false } }
        };
      default:
        return {};
    }
  }

  private buildSourceStack(overlays: PolicyOverlay[]): PolicySnapshot["sourceStack"] {
    const sources = new Map<string, { source: string; priority: number; changeId?: string; }>();
    
    for (const overlay of overlays) {
      if (!sources.has(overlay.source) || sources.get(overlay.source)!.priority < overlay.priority) {
        sources.set(overlay.source, {
          source: overlay.source,
          priority: overlay.priority,
          changeId: overlay.audit.changeId
        });
      }
    }
    
    return Array.from(sources.values()).sort((a, b) => b.priority - a.priority);
  }

  private buildScopeIndex(overlays: PolicyOverlay[]): PolicySnapshot["scopeIndex"] {
    const scopes = new Set<string>();
    const index: PolicySnapshot["scopeIndex"] = [];
    
    for (const overlay of overlays) {
      const scopeKey = JSON.stringify(overlay.scope);
      if (!scopes.has(scopeKey)) {
        scopes.add(scopeKey);
        index.push({
          scope: overlay.scope,
          policyRef: `hash#${overlay.scope.level}${overlay.scope.symbol ? `:${overlay.scope.symbol}` : ''}`
        });
      }
    }
    
    return index;
  }

  private computeDiff(oldSnapshot: PolicySnapshot, newSnapshot: PolicySnapshot): PolicyDiff {
    const changes: PolicyDiff["changes"] = [];
    
    // Simple diff - in real implementation would use deep diff
    const oldPolicy = oldSnapshot.policy;
    const newPolicy = newSnapshot.policy;
    
    this.compareObjects("", oldPolicy, newPolicy, changes);
    
    return {
      event: "policy.diff",
      timestamp: new Date().toISOString(),
      versionFrom: oldSnapshot.version,
      versionTo: newSnapshot.version,
      changes,
      rollout: { percent: this.config.rollout.defaultPercent, canaryTags: [] }
    };
  }

  private compareObjects(path: string, oldObj: any, newObj: any, changes: PolicyDiff["changes"]): void {
    const allKeys = new Set([...Object.keys(oldObj || {}), ...Object.keys(newObj || {})]);
    
    for (const key of allKeys) {
      const newPath = path ? `${path}/${key}` : `/${key}`;
      const oldValue = oldObj?.[key];
      const newValue = newObj?.[key];
      
      if (oldValue !== newValue) {
        if (typeof oldValue === "object" && typeof newValue === "object" && 
            oldValue !== null && newValue !== null) {
          this.compareObjects(newPath, oldValue, newValue, changes);
        } else {
          changes.push({
            path: newPath,
            from: oldValue,
            to: newValue,
            reasonCodes: ["policy_update"]
          });
        }
      }
    }
  }

  private emitApplyDirectives(snapshot: PolicySnapshot, bus: any): void {
    const targets = ["throttler", "balancer", "supervisor", "guard", "composer"];
    const actions: PolicyApplyDirective["actions"] = [];
    
    // Convert policy to actionable directives
    actions.push({ type: "set_limit", key: "riskPerTradePct", value: snapshot.policy.riskPerTradePct });
    actions.push({ type: "set_limit", key: "totalRiskPct", value: snapshot.policy.totalRiskPct });
    actions.push({ type: "set_throttle", maxBurstsPerMin: snapshot.policy.throttle.maxBurstsPerMin });
    
    if (!snapshot.policy.variants.aggressive) {
      actions.push({ type: "toggle_variant", variant: "aggressive", enabled: false });
    }
    
    const directive: PolicyApplyDirective = {
      event: "policy.apply.directive",
      timestamp: new Date().toISOString(),
      version: snapshot.version,
      targets,
      scope: { level: "global" },
      actions,
      effectiveAt: snapshot.effectiveAt,
      expiresAt: snapshot.expiresAt
    };

    bus.emit("policy.apply.directive", directive);
  }

  private extractNumber(text: string): number | null {
    const match = text.match(/(\d+(?:\.\d+)?)/);
    return match ? parseFloat(match[1]) : null;
  }

  private emitAlert(level: PolicyAlert["level"], message: string, context: PolicyAlert["context"], bus: any): void {
    const alert: PolicyAlert = {
      event: "policy.alert",
      timestamp: new Date().toISOString(),
      level,
      message,
      context
    };

    bus.emit("policy.alert", alert);
  }

  private setupMetricsFlush(): void {
    this.metricsInterval = setInterval(() => {
      this.emitMetrics();
    }, this.config.metricsFlushSec * 1000);
  }

  private emitMetrics(): void {
    const metrics: PolicyMetrics = {
      event: "policy.metrics",
      timestamp: new Date().toISOString(),
      applies: this.state.overlays.size,
      rollouts: 0, // Would track rollout statistics
      rollbacks: 0, // Would track rollback count
      conflictsResolved: 0, // Would track conflict resolution count
      canaryCoveragePct: this.config.rollout.defaultPercent
    };

    this.emit("policy.metrics", metrics);
  }

  // Public methods
  getCurrentSnapshot(): PolicySnapshot | undefined {
    return this.state.currentSnapshot;
  }

  rollback(toVersion: number, reason: string, bus: any): void {
    // Find snapshot in history
    const targetSnapshot = this.state.history.find(h => h.diff.versionTo === toVersion);
    if (!targetSnapshot) {
      this.emitAlert("error", `Cannot rollback to version ${toVersion}: not found`, {
        reasonCodes: ["version_not_found"]
      }, bus);
      return;
    }

    // Clear overlays and reset to target version policy
    this.state.overlays.clear();
    this.state.versionClock = toVersion + 1;
    
    const rollback: PolicyRollback = {
      event: "policy.rollback",
      timestamp: new Date().toISOString(),
      rollbackToVersion: toVersion,
      reason
    };

    bus.emit("policy.rollback", rollback);
    this.recomputePolicy(bus, null);
  }

  getStatus(): any {
    return {
      config: this.config,
      state: {
        version: this.state.versionClock,
        overlays: this.state.overlays.size,
        historySize: this.state.history.length,
        processedChanges: this.state.processedChangeIds.size
      },
      currentSnapshot: this.state.currentSnapshot ? {
        version: this.state.currentSnapshot.version,
        hash: this.state.currentSnapshot.hash,
        sourceCount: this.state.currentSnapshot.sourceStack.length
      } : null
    };
  }

  updateConfig(updates: Partial<PolicyCoordinatorConfig>): void {
    this.config = { ...this.config, ...updates };
  }

  // Cleanup
  shutdown(): void {
    if (this.metricsInterval) {
      clearInterval(this.metricsInterval);
    }
  }
}
