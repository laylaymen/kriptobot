/**
 * VIVO-32 · telemetryDashboardEmitter.ts
 * Sistemdeki tüm modüllerden gelen metrik bilgilerini toplayıp dashboard-friendly formatta yayınlar.
 * Prometheus (pull, /metrics), TSDB satır-protokolü (push; Influx/Quest/ClickHouse).
 */

import { EventEmitter } from "events";

// Input Event Types
export interface QaMetrics {
  event: "signal.qa.metrics";
  timestamp: string;
  p99_ms: number;
  pass_rate: number;
  reject_rate: number;
  defer_rate: number;
  dup_drop_rate: number;
  avg_quality: number;
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

export interface SentryMetrics {
  event: "sentry.metrics";
  timestamp: string;
  ewma: {
    pingMs: number;
    wsMsgsPerSec: number;
  };
  gaps: {
    count: number;
    avgGap: number;
  };
  reconnects: number;
  endpointSwitches: number;
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

export interface PortfolioBalancerMetrics {
  event: "portfolio.balancer.metrics";
  timestamp: string;
  approved: number;
  adjusted: number;
  deferred: number;
  rejected: number;
  avg_scale: number;
  top_corr_pair: string;
}

export interface BanditMetrics {
  event: "strategy.bandit.metrics";
  timestamp: string;
  exploreRate: number;
  blockedRate: number;
  avgSamplesPerArm: number;
  coldStartActive: boolean;
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

export interface CostForecasterMetrics {
  event: "cost.forecaster.metrics";
  timestamp: string;
  avgAdviceMs: number;
  adviceRates: {
    info: number;
    warn: number;
    block: number;
  };
  makerUsageSuggestRate: number;
  fundingWindowAvoidRate: number;
}

export interface LoggerMetrics {
  event: "vivo.logger.metrics";
  timestamp: string;
  p99_ingest_ms: number;
  rows_appended: number;
  summaries_published: number;
  anomalies: number;
}

export interface ConnectivityHeartbeat {
  event: "connectivity.heartbeat";
  timestamp: string;
  latencyMs: number;
  marketStreamAlive: boolean;
  orderStreamAlive: boolean;
  wsEndpoint: string;
  clockSkewMs: number;
}

export interface IncidentAlert {
  event: "risk.incident.alert";
  timestamp: string;
  level: "warn" | "error";
  message: string;
  context: {
    type: string;
  };
}

// Output Event Types
export interface PromDump {
  event: "telemetry.prom.dump";
  timestamp: string;
  contentType: string;
  body: string;
}

export interface TsdbBatch {
  event: "telemetry.tsdb.batch";
  timestamp: string;
  lines: string[];
  target: "primary" | "secondary";
}

export interface SloStatus {
  event: "telemetry.slo.status";
  timestamp: string;
  service: string;
  slo: string;
  window: string;
  target: number;
  sli: number;
  status: "ok" | "breach" | "at_risk";
  errorBudgetUsedPct: number;
}

export interface TelemetryAlert {
  event: "telemetry.alert";
  timestamp: string;
  level: "info" | "warn" | "error";
  message: string;
  context: {
    service?: string;
    slo?: string;
    reasonCodes: string[];
  };
}

export interface EmitterHeartbeat {
  event: "telemetry.emitter.heartbeat";
  timestamp: string;
  p95_emit_ms: number;
  exporterQueueDepth: number;
  scrapeCount: number;
}

// Configuration
export interface TelemetryDashboardConfig {
  prom: {
    enabled: boolean;
    httpPort: number;
    path: string;
    histogramBucketsMs: number[];
    slipBucketsBps: number[];
  };
  tsdb: {
    enabled: boolean;
    protocol: "line" | "json";
    endpointPrimary: string;
    endpointSecondary: string;
    batchMaxSize: number;
    batchMaxWaitMs: number;
    retryBackoffMs: number[];
  };
  slo: Record<string, Record<string, {
    target: number;
    window: string;
    targetMs?: number;
  }>>;
  sampling: {
    metricsEveryNth: number;
    heavySeriesEveryNth: number;
  };
  labels: {
    env: string;
    service: string;
    instance: string;
  };
  metricsFlushSec: number;
  emitterHeartbeatSec: number;
  tz: string;
}

// Internal state
interface MetricEntry {
  name: string;
  type: "counter" | "gauge" | "histogram" | "summary";
  value: number;
  labels: Record<string, string>;
  timestamp: Date;
}

interface SloEntry {
  service: string;
  slo: string;
  sli?: number;
  window: string;
  target: number;
  values: Array<{ timestamp: Date; value: number; }>;
  status: "ok" | "breach" | "at_risk";
  errorBudgetUsedPct: number;
}

interface TelemetryState {
  metrics: Map<string, MetricEntry>;
  slos: Map<string, SloEntry>;
  tsdbQueue: string[];
  scrapeCount: number;
  lastFlush: Date;
  processingTimes: number[];
}

// Helper classes
class QuantileEstimator {
  private values: number[] = [];
  private maxSize = 1000;

  addValue(value: number): void {
    this.values.push(value);
    if (this.values.length > this.maxSize) {
      this.values.shift();
    }
  }

  getQuantile(q: number): number {
    if (this.values.length === 0) return 0;
    
    const sorted = [...this.values].sort((a, b) => a - b);
    const index = Math.floor(q * (sorted.length - 1));
    return sorted[index] || 0;
  }
}

class LineProtocolFormatter {
  static format(metric: MetricEntry, globalLabels: Record<string, string>): string {
    const allLabels = { ...globalLabels, ...metric.labels };
    const labelString = Object.entries(allLabels)
      .map(([k, v]) => `${k}=${v}`)
      .join(',');
    
    const timestamp = metric.timestamp.getTime() * 1000000; // nanoseconds
    return `${metric.name}${labelString ? ',' + labelString : ''} value=${metric.value} ${timestamp}`;
  }
}

class SloTracker {
  static calculateSli(values: Array<{ timestamp: Date; value: number; }>, window: string): number {
    const now = new Date();
    const windowMs = this.parseWindow(window);
    const cutoff = new Date(now.getTime() - windowMs);
    
    const recentValues = values.filter(v => v.timestamp > cutoff);
    if (recentValues.length === 0) return 1.0;
    
    return recentValues.reduce((sum, v) => sum + v.value, 0) / recentValues.length;
  }

  static calculateErrorBudget(sli: number, target: number): number {
    const errorBudget = 1 - target;
    const actualError = 1 - sli;
    return Math.min(100, (actualError / errorBudget) * 100);
  }

  private static parseWindow(window: string): number {
    const match = window.match(/(\d+)([hmd])/);
    if (!match) return 3600000; // 1h default
    
    const value = parseInt(match[1]);
    const unit = match[2];
    
    switch (unit) {
      case 'm': return value * 60 * 1000;
      case 'h': return value * 60 * 60 * 1000;
      case 'd': return value * 24 * 60 * 60 * 1000;
      default: return 3600000;
    }
  }
}

export interface StdError { code:string; message:string; details?:Record<string,unknown>; retriable?:boolean; }

export class TelemetryDashboardEmitter extends EventEmitter {
  ver="1.0.0"; src="VIVO-32";
  private config: TelemetryDashboardConfig;
  private state: TelemetryState;
  private quantileEstimators: Map<string, QuantileEstimator>;
  private metricsInterval?: NodeJS.Timeout;
  private heartbeatInterval?: NodeJS.Timeout;

  constructor(config?: Partial<TelemetryDashboardConfig>) {
    super();
    this.config = {
      prom: {
        enabled: true,
        httpPort: 9108,
        path: "/metrics",
        histogramBucketsMs: [1, 2, 5, 10, 25, 50, 100, 250, 500, 1000, 2000],
        slipBucketsBps: [1, 2, 4, 6, 8, 10, 12, 15, 20, 30]
      },
      tsdb: {
        enabled: true,
        protocol: "line",
        endpointPrimary: "http://tsdb:8086/write",
        endpointSecondary: "http://tsdb-b:8086/write",
        batchMaxSize: 1000,
        batchMaxWaitMs: 1000,
        retryBackoffMs: [250, 500, 1000, 2000]
      },
      slo: {
        qa: { 
          availability: { target: 0.995, window: "24h" }, 
          latency_p99: { target: 0.992, targetMs: 8, window: "1h" } 
        },
        sentry: { 
          availability: { target: 0.995, window: "24h" }, 
          latency_p99: { target: 0.99, targetMs: 1500, window: "1h" } 
        },
        guard: { 
          decision_success_rate: { target: 0.98, window: "24h" } 
        },
        bandit: { 
          decision_latency_p99: { target: 0.99, targetMs: 3, window: "1h" } 
        },
        balancer: { 
          approve_or_adjust_rate: { target: 0.8, window: "24h" } 
        },
        policy: { 
          apply_success_rate: { target: 0.99, window: "24h" } 
        }
      },
      sampling: {
        metricsEveryNth: 1,
        heavySeriesEveryNth: 3
      },
      labels: {
        env: "prod",
        service: "vivo",
        instance: "vivo32-01"
      },
      metricsFlushSec: 10,
      emitterHeartbeatSec: 30,
      tz: "Europe/Istanbul",
      ...config
    };

    this.state = {
      metrics: new Map(),
      slos: new Map(),
      tsdbQueue: [],
      scrapeCount: 0,
      lastFlush: new Date(),
      processingTimes: []
    };

    this.quantileEstimators = new Map();

    this.setupIntervals();
  }

  attach(bus: any, logger: any) {
    bus.on("signal.qa.metrics", (data: any) => this.handleQaMetrics(data, logger));
    bus.on("latency_slip.guard.metrics", (data: any) => this.handleGuardMetrics(data, logger));
    bus.on("sentry.metrics", (data: any) => this.handleSentryMetrics(data, logger));
    bus.on("policy.metrics", (data: any) => this.handlePolicyMetrics(data, logger));
    bus.on("portfolio.balancer.metrics", (data: any) => this.handleBalancerMetrics(data, logger));
    bus.on("strategy.bandit.metrics", (data: any) => this.handleBanditMetrics(data, logger));
    bus.on("universe.metrics", (data: any) => this.handleUniverseMetrics(data, logger));
    bus.on("cost.forecaster.metrics", (data: any) => this.handleCostMetrics(data, logger));
    bus.on("vivo.logger.metrics", (data: any) => this.handleLoggerMetrics(data, logger));
    bus.on("connectivity.heartbeat", (data: any) => this.handleConnectivityHeartbeat(data, logger));
    bus.on("risk.incident.alert", (data: any) => this.handleIncidentAlert(data, bus, logger));
  }

  private handleQaMetrics(data: any, logger: any): void {
    try {
      if (data.event !== "signal.qa.metrics") return;
      
      const metrics = data as QaMetrics;
      const timestamp = new Date(metrics.timestamp);
      
      this.recordMetric("vivo_qa_pass_rate", "gauge", metrics.pass_rate, {}, timestamp);
      this.recordMetric("vivo_qa_reject_rate", "gauge", metrics.reject_rate, {}, timestamp);
      this.recordMetric("vivo_qa_defer_rate", "gauge", metrics.defer_rate, {}, timestamp);
      this.recordMetric("vivo_qa_p99_ms", "gauge", metrics.p99_ms, {}, timestamp);
      this.recordMetric("vivo_qa_avg_quality", "gauge", metrics.avg_quality, {}, timestamp);

      // Update SLO
      this.updateSlo("qa", "availability", metrics.pass_rate + metrics.defer_rate, timestamp);
      this.updateSlo("qa", "latency_p99", metrics.p99_ms <= 8 ? 1 : 0, timestamp);

      if (logger) logger.debug({ metrics }, "QA metrics recorded");

    } catch (error: any) {
      if (logger) logger.error({ error, data }, "VIVO-32 QA metrics error");
    }
  }

  private handleGuardMetrics(data: any, logger: any): void {
    try {
      if (data.event !== "latency_slip.guard.metrics") return;
      
      const metrics = data as GuardMetrics;
      const timestamp = new Date(metrics.timestamp);
      
      this.recordMetric("vivo_guard_slip_ewma_bps", "gauge", metrics.ewma.slipBps, {}, timestamp);
      this.recordMetric("vivo_guard_place_ewma_ms", "gauge", metrics.ewma.placeMs, {}, timestamp);
      this.recordMetric("vivo_guard_spread_ewma_bps", "gauge", metrics.ewma.spreadBps, {}, timestamp);
      this.recordMetric("vivo_guard_panic_count", "counter", metrics.panicCount, {}, timestamp);

      // Mode rates
      for (const [mode, rate] of Object.entries(metrics.modeRates)) {
        this.recordMetric("vivo_guard_mode_rate", "gauge", rate, { mode }, timestamp);
      }

      // Update SLO
      const successRate = metrics.modeRates.normal + metrics.modeRates.slowdown;
      this.updateSlo("guard", "decision_success_rate", successRate, timestamp);

    } catch (error: any) {
      if (logger) logger.error({ error, data }, "VIVO-32 guard metrics error");
    }
  }

  private handleSentryMetrics(data: any, logger: any): void {
    try {
      if (data.event !== "sentry.metrics") return;
      
      const metrics = data as SentryMetrics;
      const timestamp = new Date(metrics.timestamp);
      
      this.recordMetric("vivo_sentry_ping_ms", "gauge", metrics.ewma.pingMs, {}, timestamp);
      this.recordMetric("vivo_sentry_ws_msgs_per_sec", "gauge", metrics.ewma.wsMsgsPerSec, {}, timestamp);
      this.recordMetric("vivo_sentry_gaps_count", "counter", metrics.gaps.count, {}, timestamp);
      this.recordMetric("vivo_sentry_reconnects", "counter", metrics.reconnects, {}, timestamp);
      this.recordMetric("vivo_sentry_endpoint_switches", "counter", metrics.endpointSwitches, {}, timestamp);

      // Update SLO - availability based on ping and gaps
      const availability = metrics.ewma.pingMs < 2000 && metrics.gaps.count < 5 ? 1 : 0;
      this.updateSlo("sentry", "availability", availability, timestamp);
      this.updateSlo("sentry", "latency_p99", metrics.ewma.pingMs <= 1500 ? 1 : 0, timestamp);

    } catch (error: any) {
      if (logger) logger.error({ error, data }, "VIVO-32 sentry metrics error");
    }
  }

  private handlePolicyMetrics(data: any, logger: any): void {
    try {
      if (data.event !== "policy.metrics") return;
      
      const metrics = data as PolicyMetrics;
      const timestamp = new Date(metrics.timestamp);
      
      this.recordMetric("vivo_policy_applies", "counter", metrics.applies, {}, timestamp);
      this.recordMetric("vivo_policy_rollouts", "counter", metrics.rollouts, {}, timestamp);
      this.recordMetric("vivo_policy_rollbacks", "counter", metrics.rollbacks, {}, timestamp);
      this.recordMetric("vivo_policy_conflicts_resolved", "counter", metrics.conflictsResolved, {}, timestamp);
      this.recordMetric("vivo_policy_canary_coverage_pct", "gauge", metrics.canaryCoveragePct, {}, timestamp);

      // Update SLO
      const successRate = metrics.rollbacks === 0 ? 1 : 0.8; // Simple success rate
      this.updateSlo("policy", "apply_success_rate", successRate, timestamp);

    } catch (error: any) {
      if (logger) logger.error({ error, data }, "VIVO-32 policy metrics error");
    }
  }

  private handleBalancerMetrics(data: any, logger: any): void {
    try {
      if (data.event !== "portfolio.balancer.metrics") return;
      
      const metrics = data as PortfolioBalancerMetrics;
      const timestamp = new Date(metrics.timestamp);
      
      this.recordMetric("vivo_balancer_approved", "counter", metrics.approved, {}, timestamp);
      this.recordMetric("vivo_balancer_adjusted", "counter", metrics.adjusted, {}, timestamp);
      this.recordMetric("vivo_balancer_deferred", "counter", metrics.deferred, {}, timestamp);
      this.recordMetric("vivo_balancer_rejected", "counter", metrics.rejected, {}, timestamp);
      this.recordMetric("vivo_balancer_avg_scale", "gauge", metrics.avg_scale, {}, timestamp);

      // Update SLO
      const total = metrics.approved + metrics.adjusted + metrics.deferred + metrics.rejected;
      const successRate = total > 0 ? (metrics.approved + metrics.adjusted) / total : 1;
      this.updateSlo("balancer", "approve_or_adjust_rate", successRate, timestamp);

    } catch (error: any) {
      if (logger) logger.error({ error, data }, "VIVO-32 balancer metrics error");
    }
  }

  private handleBanditMetrics(data: any, logger: any): void {
    try {
      if (data.event !== "strategy.bandit.metrics") return;
      
      const metrics = data as BanditMetrics;
      const timestamp = new Date(metrics.timestamp);
      
      this.recordMetric("vivo_bandit_explore_rate", "gauge", metrics.exploreRate, {}, timestamp);
      this.recordMetric("vivo_bandit_blocked_rate", "gauge", metrics.blockedRate, {}, timestamp);
      this.recordMetric("vivo_bandit_avg_samples_per_arm", "gauge", metrics.avgSamplesPerArm, {}, timestamp);
      this.recordMetric("vivo_bandit_cold_start_active", "gauge", metrics.coldStartActive ? 1 : 0, {}, timestamp);

      // Update SLO - decision latency (simulated)
      const decisionLatency = 2; // Simulated decision time in ms
      this.updateSlo("bandit", "decision_latency_p99", decisionLatency <= 3 ? 1 : 0, timestamp);

    } catch (error: any) {
      if (logger) logger.error({ error, data }, "VIVO-32 bandit metrics error");
    }
  }

  private handleUniverseMetrics(data: any, logger: any): void {
    try {
      if (data.event !== "universe.metrics") return;
      
      const metrics = data as UniverseMetrics;
      const timestamp = new Date(metrics.timestamp);
      
      this.recordMetric("vivo_universe_avg_liquidity", "gauge", metrics.scores.avgLiquidity, {}, timestamp);
      this.recordMetric("vivo_universe_avg_perf", "gauge", metrics.scores.avgPerf, {}, timestamp);
      this.recordMetric("vivo_universe_avg_cost", "gauge", metrics.scores.avgCost, {}, timestamp);
      
      this.recordMetric("vivo_universe_allowed_count", "gauge", metrics.counts.allowed, {}, timestamp);
      this.recordMetric("vivo_universe_experimental_count", "gauge", metrics.counts.experimental, {}, timestamp);
      this.recordMetric("vivo_universe_blocked_count", "gauge", metrics.counts.blocked, {}, timestamp);

    } catch (error: any) {
      if (logger) logger.error({ error, data }, "VIVO-32 universe metrics error");
    }
  }

  private handleCostMetrics(data: any, logger: any): void {
    try {
      if (data.event !== "cost.forecaster.metrics") return;
      
      const metrics = data as CostForecasterMetrics;
      const timestamp = new Date(metrics.timestamp);
      
      this.recordMetric("vivo_cost_avg_advice_ms", "gauge", metrics.avgAdviceMs, {}, timestamp);
      this.recordMetric("vivo_cost_maker_usage_suggest_rate", "gauge", metrics.makerUsageSuggestRate, {}, timestamp);
      this.recordMetric("vivo_cost_funding_window_avoid_rate", "gauge", metrics.fundingWindowAvoidRate, {}, timestamp);

      // Advice rates
      for (const [level, rate] of Object.entries(metrics.adviceRates)) {
        this.recordMetric("vivo_cost_advice_rate", "gauge", rate, { level }, timestamp);
      }

    } catch (error: any) {
      if (logger) logger.error({ error, data }, "VIVO-32 cost metrics error");
    }
  }

  private handleLoggerMetrics(data: any, logger: any): void {
    try {
      if (data.event !== "vivo.logger.metrics") return;
      
      const metrics = data as LoggerMetrics;
      const timestamp = new Date(metrics.timestamp);
      
      this.recordMetric("vivo_logger_p99_ingest_ms", "gauge", metrics.p99_ingest_ms, {}, timestamp);
      this.recordMetric("vivo_logger_rows_appended", "counter", metrics.rows_appended, {}, timestamp);
      this.recordMetric("vivo_logger_summaries_published", "counter", metrics.summaries_published, {}, timestamp);
      this.recordMetric("vivo_logger_anomalies", "counter", metrics.anomalies, {}, timestamp);

    } catch (error: any) {
      if (logger) logger.error({ error, data }, "VIVO-32 logger metrics error");
    }
  }

  private handleConnectivityHeartbeat(data: any, logger: any): void {
    try {
      if (data.event !== "connectivity.heartbeat") return;
      
      const heartbeat = data as ConnectivityHeartbeat;
      const timestamp = new Date(heartbeat.timestamp);
      
      this.recordMetric("vivo_connectivity_latency_ms", "gauge", heartbeat.latencyMs, {}, timestamp);
      this.recordMetric("vivo_connectivity_market_stream_alive", "gauge", heartbeat.marketStreamAlive ? 1 : 0, {}, timestamp);
      this.recordMetric("vivo_connectivity_order_stream_alive", "gauge", heartbeat.orderStreamAlive ? 1 : 0, {}, timestamp);
      this.recordMetric("vivo_connectivity_clock_skew_ms", "gauge", heartbeat.clockSkewMs, {}, timestamp);

    } catch (error: any) {
      if (logger) logger.error({ error, data }, "VIVO-32 connectivity heartbeat error");
    }
  }

  private handleIncidentAlert(data: any, bus: any, logger: any): void {
    try {
      if (data.event !== "risk.incident.alert") return;
      
      const alert = data as IncidentAlert;
      const timestamp = new Date(alert.timestamp);
      
      this.recordMetric("vivo_incidents_total", "counter", 1, { 
        level: alert.level, 
        type: alert.context.type 
      }, timestamp);

      // Emit telemetry alert
      this.emitAlert("warn", `Incident reported: ${alert.message}`, {
        service: "incident_tracker",
        reasonCodes: ["incident_received", alert.context.type]
      }, bus);

    } catch (error: any) {
      if (logger) logger.error({ error, data }, "VIVO-32 incident alert error");
    }
  }

  private recordMetric(name: string, type: MetricEntry["type"], value: number, labels: Record<string, string>, timestamp: Date): void {
    if (!isFinite(value)) {
      this.emitAlert("warn", `Invalid metric value: ${name}=${value}`, {
        reasonCodes: ["invalid_metric"]
      }, null);
      return;
    }

    const key = `${name}_${JSON.stringify(labels)}`;
    this.state.metrics.set(key, {
      name,
      type,
      value,
      labels,
      timestamp
    });

    // Update quantile estimator for histogram types
    if (type === "histogram" || type === "summary") {
      let estimator = this.quantileEstimators.get(key);
      if (!estimator) {
        estimator = new QuantileEstimator();
        this.quantileEstimators.set(key, estimator);
      }
      estimator.addValue(value);
    }
  }

  private updateSlo(service: string, slo: string, value: number, timestamp: Date): void {
    const key = `${service}_${slo}`;
    let sloEntry = this.state.slos.get(key);
    
    if (!sloEntry) {
      const sloConfig = this.config.slo[service]?.[slo];
      if (!sloConfig) return;
      
      sloEntry = {
        service,
        slo,
        window: sloConfig.window,
        target: sloConfig.target,
        values: [],
        status: "ok",
        errorBudgetUsedPct: 0
      };
      this.state.slos.set(key, sloEntry);
    }

    sloEntry.values.push({ timestamp, value });
    
    // Keep only values within window
    const windowMs = this.parseWindow(sloEntry.window);
    const cutoff = new Date(timestamp.getTime() - windowMs);
    sloEntry.values = sloEntry.values.filter(v => v.timestamp > cutoff);
  }

  private parseWindow(window: string): number {
    const match = window.match(/(\d+)([hmd])/);
    if (!match) return 3600000; // 1h default
    
    const value = parseInt(match[1]);
    const unit = match[2];
    
    switch (unit) {
      case 'm': return value * 60 * 1000;
      case 'h': return value * 60 * 60 * 1000;
      case 'd': return value * 24 * 60 * 60 * 1000;
      default: return 3600000;
    }
  }

  private setupIntervals(): void {
    this.metricsInterval = setInterval(() => {
      this.flush();
    }, this.config.metricsFlushSec * 1000);

    this.heartbeatInterval = setInterval(() => {
      this.emitHeartbeat();
    }, this.config.emitterHeartbeatSec * 1000);
  }

  private flush(): void {
    const startTime = Date.now();
    
    try {
      // Check SLOs
      this.checkSlos();
      
      // Generate Prometheus dump
      if (this.config.prom.enabled) {
        this.generatePromDump();
      }
      
      // Generate TSDB batch
      if (this.config.tsdb.enabled) {
        this.generateTsdbBatch();
      }
      
      this.state.lastFlush = new Date();
      
      // Track processing time
      const processingTime = Date.now() - startTime;
      this.state.processingTimes.push(processingTime);
      if (this.state.processingTimes.length > 100) {
        this.state.processingTimes.shift();
      }

    } catch (error: any) {
      this.emitAlert("error", `Telemetry flush failed: ${error.message}`, {
        reasonCodes: ["flush_error"]
      }, null);
    }
  }

  private checkSlos(): void {
    for (const [key, sloEntry] of this.state.slos.entries()) {
      const sli = SloTracker.calculateSli(sloEntry.values, sloEntry.window);
      const errorBudgetUsed = SloTracker.calculateErrorBudget(sli, sloEntry.target);
      
      let status: SloStatus["status"] = "ok";
      if (sli < sloEntry.target) {
        status = "breach";
      } else if (errorBudgetUsed > 50) {
        status = "at_risk";
      }
      
      sloEntry.sli = sli;
      sloEntry.status = status;
      sloEntry.errorBudgetUsedPct = errorBudgetUsed;

      // Emit SLO status
      const sloStatus: SloStatus = {
        event: "telemetry.slo.status",
        timestamp: new Date().toISOString(),
        service: sloEntry.service,
        slo: sloEntry.slo,
        window: sloEntry.window,
        target: sloEntry.target,
        sli,
        status,
        errorBudgetUsedPct: errorBudgetUsed
      };

      this.emit("telemetry.slo.status", sloStatus);

      // Emit alert for breaches
      if (status === "breach") {
        this.emitAlert("error", `SLO breach: ${sloEntry.service}.${sloEntry.slo}`, {
          service: sloEntry.service,
          slo: sloEntry.slo,
          reasonCodes: ["slo_breach"]
        }, null);
      }
    }
  }

  private generatePromDump(): void {
    const lines: string[] = [];
    const globalLabels = this.config.labels;
    
    for (const metric of this.state.metrics.values()) {
      const allLabels = { ...globalLabels, ...metric.labels };
      const labelString = Object.entries(allLabels)
        .map(([k, v]) => `${k}="${v}"`)
        .join(',');
      
      const metricLine = labelString 
        ? `${metric.name}{${labelString}} ${metric.value}`
        : `${metric.name} ${metric.value}`;
      
      lines.push(metricLine);
    }

    const dump: PromDump = {
      event: "telemetry.prom.dump",
      timestamp: new Date().toISOString(),
      contentType: "text/plain; version=0.0.4",
      body: lines.join('\n')
    };

    this.emit("telemetry.prom.dump", dump);
    this.state.scrapeCount++;
  }

  private generateTsdbBatch(): void {
    const lines: string[] = [];
    const globalLabels = this.config.labels;
    
    for (const metric of this.state.metrics.values()) {
      const line = LineProtocolFormatter.format(metric, globalLabels);
      lines.push(line);
    }

    if (lines.length > 0) {
      const batch: TsdbBatch = {
        event: "telemetry.tsdb.batch",
        timestamp: new Date().toISOString(),
        lines: lines.slice(0, this.config.tsdb.batchMaxSize),
        target: "primary"
      };

      this.emit("telemetry.tsdb.batch", batch);
      this.state.tsdbQueue.push(...lines);
    }
  }

  private emitHeartbeat(): void {
    const p95 = this.calculateP95ProcessingTime();
    
    const heartbeat: EmitterHeartbeat = {
      event: "telemetry.emitter.heartbeat",
      timestamp: new Date().toISOString(),
      p95_emit_ms: p95,
      exporterQueueDepth: this.state.tsdbQueue.length,
      scrapeCount: this.state.scrapeCount
    };

    this.emit("telemetry.emitter.heartbeat", heartbeat);
  }

  private calculateP95ProcessingTime(): number {
    if (this.state.processingTimes.length === 0) return 0;
    
    const sorted = [...this.state.processingTimes].sort((a, b) => a - b);
    const index = Math.floor(0.95 * (sorted.length - 1));
    return sorted[index] || 0;
  }

  private emitAlert(level: TelemetryAlert["level"], message: string, context: TelemetryAlert["context"], bus: any): void {
    const alert: TelemetryAlert = {
      event: "telemetry.alert",
      timestamp: new Date().toISOString(),
      level,
      message,
      context
    };

    this.emit("telemetry.alert", alert);
    if (bus) bus.emit("telemetry.alert", alert);
  }

  // Public methods
  getStatus(): any {
    return {
      config: this.config,
      state: {
        metricsCount: this.state.metrics.size,
        slosCount: this.state.slos.size,
        tsdbQueueDepth: this.state.tsdbQueue.length,
        scrapeCount: this.state.scrapeCount,
        lastFlush: this.state.lastFlush,
        avgProcessingTime: this.state.processingTimes.reduce((sum, t) => sum + t, 0) / Math.max(1, this.state.processingTimes.length)
      }
    };
  }

  getMetrics(): Record<string, any> {
    const result: Record<string, any> = {};
    for (const [key, metric] of this.state.metrics.entries()) {
      result[key] = {
        name: metric.name,
        type: metric.type,
        value: metric.value,
        labels: metric.labels,
        timestamp: metric.timestamp
      };
    }
    return result;
  }

  getSlos(): Record<string, any> {
    const result: Record<string, any> = {};
    for (const [key, slo] of this.state.slos.entries()) {
      result[key] = {
        service: slo.service,
        slo: slo.slo,
        target: slo.target,
        sli: slo.sli,
        status: slo.status,
        errorBudgetUsedPct: slo.errorBudgetUsedPct
      };
    }
    return result;
  }

  updateConfig(updates: Partial<TelemetryDashboardConfig>): void {
    this.config = { ...this.config, ...updates };
  }

  // Cleanup
  shutdown(): void {
    if (this.metricsInterval) {
      clearInterval(this.metricsInterval);
    }
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }
  }
}
