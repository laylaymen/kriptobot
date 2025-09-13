/**
 * VIVO-18 · executionIntentThrottler.ts
 * Çok sık sinyal üretme durumunda throttle uygular.
 * VIVO'nun aynı anda çok sinyal üretmesini engeller, cooldown süresi boyunca yeni sinyalleri bekletir.
 */

import { EventEmitter } from "events";

// Types for VIVO-18
export interface ThrottleRule {
  ruleId: string;
  scope: "global"|"symbol"|"source"|"variant"|"timeframe";
  maxSignalsPerWindow: number;
  windowMs: number;
  cooldownMs: number;
  enabled: boolean;
  priority: number; // higher number = higher priority
}

export interface ThrottleWindow {
  scope: string;
  scopeValue: string;
  signalCount: number;
  windowStart: number;
  windowEnd: number;
  lastSignalTime: number;
  isInCooldown: boolean;
  cooldownUntil: number;
}

export interface ThrottleDecision {
  action: "allow"|"defer"|"reject";
  reasonCode: string;
  appliedRule?: ThrottleRule;
  waitTimeMs?: number;
  windowStatus: {
    current: number;
    max: number;
    remaining: number;
    resetAt: string;
  };
  meta: {
    signalId: string;
    symbol: string;
    source: string;
    timestamp: string;
  };
}

export interface DeferredSignal {
  signal: any;
  deferredAt: number;
  releaseAt: number;
  attempts: number;
  maxAttempts: number;
}

export interface ThrottleConfig {
  enabled: boolean;
  defaultRules: ThrottleRule[];
  maxDeferredSignals: number;
  maxDeferredTimeMs: number;
  deferRetryIntervalMs: number;
  emergencyBrakeThreshold: number; // signals/minute before emergency brake
}

export interface StdError { code:string; message:string; details?:Record<string,unknown>; retriable?:boolean; }

const clamp = (x:number, lo:number, hi:number)=> Math.max(lo, Math.min(hi, x));

export class ExecutionIntentThrottler extends EventEmitter {
  ver="1.0.0"; src="VIVO-18";
  private config: ThrottleConfig;
  private rules: Map<string, ThrottleRule> = new Map();
  private windows: Map<string, ThrottleWindow> = new Map();
  private deferredSignals: Map<string, DeferredSignal> = new Map();
  private emergencyBrakeActive = false;
  private lastMinuteSignals: number[] = []; // timestamps for emergency brake

  constructor(config?: Partial<ThrottleConfig>) {
    super();
    this.config = {
      enabled: true,
      defaultRules: [
        {
          ruleId: "global_limit",
          scope: "global",
          maxSignalsPerWindow: 10,
          windowMs: 60000,      // 1 minute
          cooldownMs: 30000,    // 30 second cooldown
          enabled: true,
          priority: 100
        },
        {
          ruleId: "symbol_limit",
          scope: "symbol",
          maxSignalsPerWindow: 3,
          windowMs: 60000,      // 1 minute per symbol
          cooldownMs: 15000,    // 15 second cooldown
          enabled: true,
          priority: 80
        },
        {
          ruleId: "source_limit",
          scope: "source",
          maxSignalsPerWindow: 5,
          windowMs: 60000,      // 1 minute per source
          cooldownMs: 20000,    // 20 second cooldown
          enabled: true,
          priority: 70
        },
        {
          ruleId: "aggressive_variant_limit",
          scope: "variant",
          maxSignalsPerWindow: 2,
          windowMs: 60000,      // 1 minute for aggressive variants
          cooldownMs: 45000,    // 45 second cooldown
          enabled: true,
          priority: 90
        }
      ],
      maxDeferredSignals: 50,
      maxDeferredTimeMs: 300000, // 5 minutes max defer
      deferRetryIntervalMs: 5000, // 5 second retry
      emergencyBrakeThreshold: 20, // 20 signals/minute = emergency
      ...config
    };

    this.initializeRules();
  }

  attach(bus: any, logger: any) {
    if (!this.config.enabled) {
      // Pass-through mode
      bus.on("execution.intent.proposed", (intent: any) => {
        bus.emit("execution.intent.throttled", { ...intent, throttleDecision: { action: "allow", reasonCode: "throttle_disabled" } });
      });
      return;
    }

    // Main throttle processing
    bus.on("execution.intent.proposed", (intent: any) => this.processIntent(intent, bus, logger));
    
    // Deferred signal retry timer
    setInterval(() => this.processDeferredSignals(bus, logger), this.config.deferRetryIntervalMs);
    
    // Window cleanup
    setInterval(() => this.cleanupExpiredWindows(), 30000);
    
    // Emergency brake monitoring
    setInterval(() => this.updateEmergencyBrakeStatus(), 10000);
  }

  private initializeRules() {
    for (const rule of this.config.defaultRules) {
      this.rules.set(rule.ruleId, rule);
    }
  }

  private processIntent(intent: any, bus: any, logger: any) {
    try {
      // Emergency brake check
      if (this.emergencyBrakeActive) {
        this.emitThrottledIntent(intent, {
          action: "reject",
          reasonCode: "emergency_brake_active",
          windowStatus: { current: 0, max: 0, remaining: 0, resetAt: new Date().toISOString() },
          meta: this.extractMeta(intent)
        }, bus);
        return;
      }

      // Track for emergency brake
      this.trackSignalForEmergencyBrake();

      // Apply throttle rules
      const decision = this.evaluateThrottleRules(intent);
      
      if (decision.action === "allow") {
        // Update windows and allow
        this.updateWindows(intent, decision);
        this.emitThrottledIntent(intent, decision, bus);
      } else if (decision.action === "defer") {
        // Add to deferred queue
        this.deferSignal(intent, decision);
        this.emitThrottledIntent(intent, decision, bus);
      } else {
        // Reject
        this.emitThrottledIntent(intent, decision, bus);
      }

    } catch (e: any) {
      if (logger) logger.error({ e }, "VIVO-18 processIntent failed");
      this.emitThrottledIntent(intent, {
        action: "reject",
        reasonCode: "throttle_error",
        windowStatus: { current: 0, max: 0, remaining: 0, resetAt: new Date().toISOString() },
        meta: this.extractMeta(intent)
      }, bus);
    }
  }

  private evaluateThrottleRules(intent: any): ThrottleDecision {
    const now = Date.now();
    const applicableRules = this.getApplicableRules(intent);
    
    // Sort by priority (descending)
    applicableRules.sort((a, b) => b.priority - a.priority);

    for (const rule of applicableRules) {
      const scopeValue = this.getScopeValue(intent, rule.scope);
      const windowKey = `${rule.ruleId}-${scopeValue}`;
      
      let window = this.windows.get(windowKey);
      if (!window || window.windowEnd < now) {
        // Create/reset window
        window = {
          scope: rule.scope,
          scopeValue,
          signalCount: 0,
          windowStart: now,
          windowEnd: now + rule.windowMs,
          lastSignalTime: 0,
          isInCooldown: false,
          cooldownUntil: 0
        };
        this.windows.set(windowKey, window);
      }

      // Cooldown check
      if (window.isInCooldown && window.cooldownUntil > now) {
        return {
          action: "defer",
          reasonCode: "cooldown_active",
          appliedRule: rule,
          waitTimeMs: window.cooldownUntil - now,
          windowStatus: {
            current: window.signalCount,
            max: rule.maxSignalsPerWindow,
            remaining: 0,
            resetAt: new Date(window.cooldownUntil).toISOString()
          },
          meta: this.extractMeta(intent)
        };
      }

      // Rate limit check
      if (window.signalCount >= rule.maxSignalsPerWindow) {
        // Trigger cooldown
        window.isInCooldown = true;
        window.cooldownUntil = now + rule.cooldownMs;
        
        return {
          action: "defer",
          reasonCode: "rate_limit_exceeded",
          appliedRule: rule,
          waitTimeMs: rule.cooldownMs,
          windowStatus: {
            current: window.signalCount,
            max: rule.maxSignalsPerWindow,
            remaining: 0,
            resetAt: new Date(window.cooldownUntil).toISOString()
          },
          meta: this.extractMeta(intent)
        };
      }
    }

    // All rules passed
    const primaryRule = applicableRules[0];
    const scopeValue = primaryRule ? this.getScopeValue(intent, primaryRule.scope) : "global";
    const windowKey = primaryRule ? `${primaryRule.ruleId}-${scopeValue}` : "default";
    const window = this.windows.get(windowKey);

    return {
      action: "allow",
      reasonCode: "rules_passed",
      appliedRule: primaryRule,
      windowStatus: {
        current: window?.signalCount || 0,
        max: primaryRule?.maxSignalsPerWindow || 999,
        remaining: Math.max(0, (primaryRule?.maxSignalsPerWindow || 999) - (window?.signalCount || 0) - 1),
        resetAt: new Date((window?.windowEnd || Date.now()) + 60000).toISOString()
      },
      meta: this.extractMeta(intent)
    };
  }

  private getApplicableRules(intent: any): ThrottleRule[] {
    const applicable: ThrottleRule[] = [];
    
    for (const rule of this.rules.values()) {
      if (!rule.enabled) continue;
      
      // Check if rule applies to this intent
      if (rule.scope === "global") {
        applicable.push(rule);
      } else if (rule.scope === "symbol" && intent.symbol) {
        applicable.push(rule);
      } else if (rule.scope === "source" && intent.upstream?.source) {
        applicable.push(rule);
      } else if (rule.scope === "variant" && intent.selectedVariant) {
        // Special handling for aggressive variant
        if (rule.ruleId === "aggressive_variant_limit" && intent.selectedVariant === "aggressive") {
          applicable.push(rule);
        } else if (rule.ruleId !== "aggressive_variant_limit") {
          applicable.push(rule);
        }
      } else if (rule.scope === "timeframe" && intent.timeframe) {
        applicable.push(rule);
      }
    }
    
    return applicable;
  }

  private getScopeValue(intent: any, scope: string): string {
    switch (scope) {
      case "global": return "global";
      case "symbol": return intent.symbol || "unknown";
      case "source": return intent.upstream?.source || "unknown";
      case "variant": return intent.selectedVariant || "base";
      case "timeframe": return intent.timeframe || "unknown";
      default: return "default";
    }
  }

  private updateWindows(intent: any, decision: ThrottleDecision) {
    if (!decision.appliedRule) return;
    
    const rule = decision.appliedRule;
    const scopeValue = this.getScopeValue(intent, rule.scope);
    const windowKey = `${rule.ruleId}-${scopeValue}`;
    
    const window = this.windows.get(windowKey);
    if (window) {
      window.signalCount++;
      window.lastSignalTime = Date.now();
    }
  }

  private deferSignal(intent: any, decision: ThrottleDecision) {
    if (this.deferredSignals.size >= this.config.maxDeferredSignals) {
      // Queue full - convert to reject
      decision.action = "reject";
      decision.reasonCode = "defer_queue_full";
      return;
    }

    const signalId = intent.correlationId || intent.signalId || `deferred-${Date.now()}`;
    const waitTime = decision.waitTimeMs || this.config.deferRetryIntervalMs;
    
    const deferred: DeferredSignal = {
      signal: intent,
      deferredAt: Date.now(),
      releaseAt: Date.now() + waitTime,
      attempts: 0,
      maxAttempts: 3
    };

    this.deferredSignals.set(signalId, deferred);
  }

  private processDeferredSignals(bus: any, logger: any) {
    const now = Date.now();
    const toProcess: string[] = [];
    
    for (const [signalId, deferred] of this.deferredSignals.entries()) {
      if (deferred.releaseAt <= now) {
        toProcess.push(signalId);
      }
      
      // Cleanup expired deferrals
      if (now - deferred.deferredAt > this.config.maxDeferredTimeMs) {
        this.deferredSignals.delete(signalId);
        if (logger) {
          logger.warn({ signalId }, "VIVO-18 deferred signal expired");
        }
      }
    }

    for (const signalId of toProcess) {
      const deferred = this.deferredSignals.get(signalId);
      if (!deferred) continue;

      deferred.attempts++;
      
      // Re-evaluate
      const decision = this.evaluateThrottleRules(deferred.signal);
      
      if (decision.action === "allow") {
        this.updateWindows(deferred.signal, decision);
        this.emitThrottledIntent(deferred.signal, decision, bus);
        this.deferredSignals.delete(signalId);
      } else if (deferred.attempts >= deferred.maxAttempts) {
        // Max attempts reached - reject
        decision.action = "reject";
        decision.reasonCode = "max_defer_attempts";
        this.emitThrottledIntent(deferred.signal, decision, bus);
        this.deferredSignals.delete(signalId);
      } else {
        // Defer again
        deferred.releaseAt = now + this.config.deferRetryIntervalMs;
      }
    }
  }

  private trackSignalForEmergencyBrake() {
    const now = Date.now();
    const oneMinuteAgo = now - 60000;
    
    // Add current signal
    this.lastMinuteSignals.push(now);
    
    // Remove signals older than 1 minute
    this.lastMinuteSignals = this.lastMinuteSignals.filter(t => t > oneMinuteAgo);
  }

  private updateEmergencyBrakeStatus() {
    const signalsPerMinute = this.lastMinuteSignals.length;
    
    if (!this.emergencyBrakeActive && signalsPerMinute >= this.config.emergencyBrakeThreshold) {
      this.emergencyBrakeActive = true;
      this.emit("emergency.brake.activated", {
        signalsPerMinute,
        threshold: this.config.emergencyBrakeThreshold,
        timestamp: new Date().toISOString()
      });
    } else if (this.emergencyBrakeActive && signalsPerMinute < this.config.emergencyBrakeThreshold * 0.5) {
      this.emergencyBrakeActive = false;
      this.emit("emergency.brake.deactivated", {
        signalsPerMinute,
        timestamp: new Date().toISOString()
      });
    }
  }

  private cleanupExpiredWindows() {
    const now = Date.now();
    
    for (const [windowKey, window] of this.windows.entries()) {
      // Clean up windows that are past their expiry and cooldown
      if (window.windowEnd < now && 
          (!window.isInCooldown || window.cooldownUntil < now)) {
        this.windows.delete(windowKey);
      }
    }
  }

  private emitThrottledIntent(intent: any, decision: ThrottleDecision, bus: any) {
    const throttledIntent = {
      ...intent,
      throttleDecision: decision,
      throttledAt: new Date().toISOString()
    };

    bus.emit("execution.intent.throttled", throttledIntent);
    
    // Emit metrics
    bus.emit("vivo.throttle.metrics", {
      action: decision.action,
      reasonCode: decision.reasonCode,
      appliedRule: decision.appliedRule?.ruleId,
      waitTimeMs: decision.waitTimeMs,
      emergencyBrakeActive: this.emergencyBrakeActive,
      deferredCount: this.deferredSignals.size,
      timestamp: new Date().toISOString()
    });
  }

  private extractMeta(intent: any): ThrottleDecision['meta'] {
    return {
      signalId: intent.correlationId || intent.signalId || "unknown",
      symbol: intent.symbol || "unknown",
      source: intent.upstream?.source || "unknown",
      timestamp: new Date().toISOString()
    };
  }

  // Public methods for management
  addRule(rule: ThrottleRule): void {
    this.rules.set(rule.ruleId, rule);
  }

  removeRule(ruleId: string): void {
    this.rules.delete(ruleId);
  }

  updateRule(ruleId: string, updates: Partial<ThrottleRule>): void {
    const existing = this.rules.get(ruleId);
    if (existing) {
      this.rules.set(ruleId, { ...existing, ...updates });
    }
  }

  getStatus(): any {
    return {
      enabled: this.config.enabled,
      emergencyBrakeActive: this.emergencyBrakeActive,
      signalsPerMinute: this.lastMinuteSignals.length,
      activeWindows: this.windows.size,
      deferredSignals: this.deferredSignals.size,
      activeRules: Array.from(this.rules.values()).filter(r => r.enabled).length,
      windows: Array.from(this.windows.entries()).map(([key, window]) => ({
        key,
        count: window.signalCount,
        cooldown: window.isInCooldown,
        remaining: Math.max(0, window.windowEnd - Date.now())
      }))
    };
  }

  resetEmergencyBrake(): void {
    this.emergencyBrakeActive = false;
    this.lastMinuteSignals = [];
  }

  clearDeferredSignals(): void {
    this.deferredSignals.clear();
  }
}
