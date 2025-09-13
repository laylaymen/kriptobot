/**
 * VIVO-21 · executionQualityMonitor.ts
 * Execution kalitesi ölçümü - slippage, fill rate, timing quality analizi.
 * Comprehensive execution performance tracking and optimization insights.
 */

import { EventEmitter } from "events";

// Types for VIVO-21
export interface ExecutionEvent {
  eventId: string;
  correlationId: string;
  symbol: string;
  side: "long"|"short";
  orderType: "market"|"limit"|"stop_market"|"stop_limit";
  timeframe: string;
  strategy: string;
  variant: "base"|"aggressive"|"conservative";
  
  // Order details
  requestedQty: number;
  requestedPrice?: number;     // null for market orders
  filledQty: number;
  avgFillPrice: number;
  
  // Timing metrics
  orderPlacedAt: string;
  firstFillAt?: string;
  lastFillAt?: string;
  fullyFilledAt?: string;
  
  // Market context
  marketPrice: number;         // price when order was placed
  bestBid: number;
  bestAsk: number;
  spread: number;
  
  // Quality metrics
  slippageBps: number;
  fillRate: number;            // 0..1 (filled/requested)
  timingLatencyMs: number;     // order placement to first fill
  completionTimeMs: number;    // order placement to full fill
  
  // Outcome
  status: "filled"|"partial"|"cancelled"|"expired"|"rejected";
  rejectReason?: string;
  timestamp: string;
}

export interface QualityMetrics {
  symbol: string;
  timeframe: string;
  strategy: string;
  period: "1h"|"4h"|"1d"|"7d"|"30d";
  
  // Slippage analysis
  slippage: {
    avgBps: number;
    medianBps: number;
    p95Bps: number;             // 95th percentile
    stdDevBps: number;
    worstBps: number;
    slippageDistribution: Record<string, number>; // ranges -> count
  };
  
  // Fill rate analysis
  fillRate: {
    avgFillRate: number;
    medianFillRate: number;
    fullFillRate: number;       // % of orders filled 100%
    partialFillRate: number;    // % of orders partially filled
    rejectRate: number;         // % of orders rejected
  };
  
  // Timing analysis
  timing: {
    avgLatencyMs: number;
    medianLatencyMs: number;
    p95LatencyMs: number;
    avgCompletionMs: number;
    fastFillRate: number;       // % filled within 1000ms
    slowFillRate: number;       // % taking >5000ms
  };
  
  // Market condition correlation
  marketCorrelation: {
    highVolSlippage: number;    // avg slippage in high vol periods
    lowVolSlippage: number;     // avg slippage in low vol periods
    wideSpreadSlippage: number; // avg slippage when spread >10bps
    tightSpreadSlippage: number;// avg slippage when spread <5bps
  };
  
  // Execution efficiency
  efficiency: {
    executionScore: number;     // 0..1 composite score
    slippageScore: number;      // 0..1 (lower slippage = higher score)
    speedScore: number;         // 0..1 (faster = higher score)
    fillScore: number;          // 0..1 (higher fill rate = higher score)
    consistencyScore: number;   // 0..1 (lower variance = higher score)
  };
  
  // Sample data
  sampleSize: number;
  firstExecution: string;
  lastExecution: string;
  lastUpdate: string;
}

export interface QualityAlert {
  alertId: string;
  symbol: string;
  alertType: "degraded_slippage"|"poor_fill_rate"|"slow_execution"|"high_reject_rate"|"execution_anomaly";
  severity: "low"|"medium"|"high"|"critical";
  
  currentValue: number;
  thresholdValue: number;
  historicalAvg: number;
  
  description: string;
  recommendations: string[];
  
  affectedPeriod: string;
  detectedAt: string;
  
  // Context
  marketConditions: {
    volatility: "low"|"medium"|"high"|"extreme";
    spread: number;
    volume: number;
  };
}

export interface MonitorConfig {
  // Sampling and retention
  maxSamplesPerSymbol: number;        // 10000
  retentionDays: number;              // 30
  metricCalculationIntervalMs: number; // 300000 (5 minutes)
  
  // Slippage thresholds
  slippageWarningBps: number;         // 8
  slippageAlertBps: number;           // 15
  slippageCriticalBps: number;        // 25
  
  // Fill rate thresholds
  fillRateWarningPct: number;         // 85
  fillRateAlertPct: number;           // 75
  fillRateCriticalPct: number;        // 60
  
  // Timing thresholds
  latencyWarningMs: number;           // 2000
  latencyAlertMs: number;             // 5000
  latencyCriticalMs: number;          // 10000
  
  // Rejection rate thresholds
  rejectRateWarningPct: number;       // 5
  rejectRateAlertPct: number;         // 10
  rejectRateCriticalPct: number;      // 20
  
  // Anomaly detection
  anomalyDetectionEnabled: boolean;   // true
  anomalyDeviationThreshold: number;  // 2.5 (standard deviations)
  minSampleSizeForAnomaly: number;    // 20
}

export interface StdError { code:string; message:string; details?:Record<string,unknown>; retriable?:boolean; }

const clamp = (x:number, lo:number, hi:number)=> Math.max(lo, Math.min(hi, x));

export class ExecutionQualityMonitor extends EventEmitter {
  ver="1.0.0"; src="VIVO-21";
  private config: MonitorConfig;
  private executionHistory = new Map<string, ExecutionEvent[]>(); // symbol -> events
  private metricsCache = new Map<string, QualityMetrics>(); // symbol+period -> metrics
  private activeAlerts = new Map<string, QualityAlert>(); // alertId -> alert

  constructor(config?: Partial<MonitorConfig>) {
    super();
    this.config = {
      maxSamplesPerSymbol: 10000,
      retentionDays: 30,
      metricCalculationIntervalMs: 300000,
      slippageWarningBps: 8,
      slippageAlertBps: 15,
      slippageCriticalBps: 25,
      fillRateWarningPct: 85,
      fillRateAlertPct: 75,
      fillRateCriticalPct: 60,
      latencyWarningMs: 2000,
      latencyAlertMs: 5000,
      latencyCriticalMs: 10000,
      rejectRateWarningPct: 5,
      rejectRateAlertPct: 10,
      rejectRateCriticalPct: 20,
      anomalyDetectionEnabled: true,
      anomalyDeviationThreshold: 2.5,
      minSampleSizeForAnomaly: 20,
      ...config
    };
  }

  attach(bus: any, logger: any) {
    // Listen for execution events
    bus.on("order.execution.complete", (event: any) => this.recordExecution(event, logger));
    bus.on("order.fill", (fill: any) => this.recordFill(fill, logger));
    bus.on("order.reject", (reject: any) => this.recordReject(reject, logger));
    
    // Periodic metric calculation
    setInterval(() => this.calculateMetrics(bus, logger), this.config.metricCalculationIntervalMs);
    
    // Cleanup old data
    setInterval(() => this.cleanupOldData(), 3600000); // hourly cleanup
    
    // Anomaly detection
    if (this.config.anomalyDetectionEnabled) {
      setInterval(() => this.detectAnomalies(bus, logger), 60000); // check every minute
    }
  }

  private recordExecution(event: ExecutionEvent, logger: any) {
    try {
      // Validate event
      if (!this.validateExecutionEvent(event)) {
        if (logger) logger.warn({ event }, "VIVO-21 invalid execution event");
        return;
      }

      // Get or create history for symbol
      if (!this.executionHistory.has(event.symbol)) {
        this.executionHistory.set(event.symbol, []);
      }

      const history = this.executionHistory.get(event.symbol)!;
      
      // Add event
      history.push(event);
      
      // Maintain size limit
      if (history.length > this.config.maxSamplesPerSymbol) {
        history.splice(0, history.length - this.config.maxSamplesPerSymbol);
      }

      // Immediate quality check for this execution
      this.checkExecutionQuality(event, logger);

    } catch (e: any) {
      if (logger) logger.error({ e }, "VIVO-21 recordExecution failed");
    }
  }

  private recordFill(fill: any, logger: any) {
    // Convert fill to execution event format
    const executionEvent: ExecutionEvent = {
      eventId: fill.fillId || `fill-${Date.now()}`,
      correlationId: fill.correlationId,
      symbol: fill.symbol,
      side: fill.side,
      orderType: fill.orderType,
      timeframe: fill.timeframe || "unknown",
      strategy: fill.strategy || "unknown",
      variant: fill.variant || "base",
      requestedQty: fill.originalQty,
      requestedPrice: fill.requestedPrice,
      filledQty: fill.filledQty,
      avgFillPrice: fill.fillPrice,
      orderPlacedAt: fill.orderPlacedAt,
      firstFillAt: fill.fillTime,
      lastFillAt: fill.fillTime,
      fullyFilledAt: fill.filledQty === fill.originalQty ? fill.fillTime : undefined,
      marketPrice: fill.marketPriceAtOrder,
      bestBid: fill.bestBid,
      bestAsk: fill.bestAsk,
      spread: fill.bestAsk - fill.bestBid,
      slippageBps: this.calculateSlippage(fill),
      fillRate: fill.filledQty / fill.originalQty,
      timingLatencyMs: new Date(fill.fillTime).getTime() - new Date(fill.orderPlacedAt).getTime(),
      completionTimeMs: new Date(fill.fillTime).getTime() - new Date(fill.orderPlacedAt).getTime(),
      status: fill.filledQty === fill.originalQty ? "filled" : "partial",
      timestamp: fill.fillTime
    };

    this.recordExecution(executionEvent, logger);
  }

  private recordReject(reject: any, logger: any) {
    const executionEvent: ExecutionEvent = {
      eventId: reject.rejectId || `reject-${Date.now()}`,
      correlationId: reject.correlationId,
      symbol: reject.symbol,
      side: reject.side,
      orderType: reject.orderType,
      timeframe: reject.timeframe || "unknown",
      strategy: reject.strategy || "unknown",
      variant: reject.variant || "base",
      requestedQty: reject.requestedQty,
      requestedPrice: reject.requestedPrice,
      filledQty: 0,
      avgFillPrice: 0,
      orderPlacedAt: reject.orderPlacedAt,
      marketPrice: reject.marketPriceAtOrder,
      bestBid: reject.bestBid || 0,
      bestAsk: reject.bestAsk || 0,
      spread: (reject.bestAsk || 0) - (reject.bestBid || 0),
      slippageBps: 0,
      fillRate: 0,
      timingLatencyMs: new Date(reject.rejectTime).getTime() - new Date(reject.orderPlacedAt).getTime(),
      completionTimeMs: new Date(reject.rejectTime).getTime() - new Date(reject.orderPlacedAt).getTime(),
      status: "rejected",
      rejectReason: reject.reason,
      timestamp: reject.rejectTime
    };

    this.recordExecution(executionEvent, logger);
  }

  private calculateSlippage(fill: any): number {
    if (!fill.requestedPrice || fill.orderType === "market") {
      // Market order slippage vs mid price
      const mid = (fill.bestBid + fill.bestAsk) / 2;
      const diff = fill.side === "long" ? 
        fill.fillPrice - mid : 
        mid - fill.fillPrice;
      return (diff / mid) * 10000; // basis points
    } else {
      // Limit order slippage vs requested price
      const diff = fill.side === "long" ? 
        fill.fillPrice - fill.requestedPrice : 
        fill.requestedPrice - fill.fillPrice;
      return (diff / fill.requestedPrice) * 10000; // basis points
    }
  }

  private validateExecutionEvent(event: ExecutionEvent): boolean {
    return !!(event.symbol && event.side && event.correlationId && 
              event.requestedQty > 0 && event.orderPlacedAt && event.timestamp);
  }

  private checkExecutionQuality(event: ExecutionEvent, logger: any) {
    const warnings: string[] = [];

    // Slippage check
    if (event.slippageBps > this.config.slippageCriticalBps) {
      warnings.push(`critical_slippage_${event.slippageBps.toFixed(1)}bps`);
    } else if (event.slippageBps > this.config.slippageAlertBps) {
      warnings.push(`high_slippage_${event.slippageBps.toFixed(1)}bps`);
    }

    // Fill rate check
    if (event.fillRate < this.config.fillRateCriticalPct / 100) {
      warnings.push(`critical_fill_rate_${(event.fillRate * 100).toFixed(1)}%`);
    } else if (event.fillRate < this.config.fillRateAlertPct / 100) {
      warnings.push(`low_fill_rate_${(event.fillRate * 100).toFixed(1)}%`);
    }

    // Timing check
    if (event.timingLatencyMs > this.config.latencyCriticalMs) {
      warnings.push(`critical_latency_${event.timingLatencyMs}ms`);
    } else if (event.timingLatencyMs > this.config.latencyAlertMs) {
      warnings.push(`high_latency_${event.timingLatencyMs}ms`);
    }

    if (warnings.length > 0 && logger) {
      logger.warn({
        symbol: event.symbol,
        correlationId: event.correlationId,
        warnings
      }, "VIVO-21 execution quality warning");
    }
  }

  private calculateMetrics(bus: any, logger: any) {
    try {
      for (const [symbol, history] of this.executionHistory.entries()) {
        if (history.length < 5) continue; // Need minimum samples

        const periods = ["1h", "4h", "1d", "7d", "30d"] as const;
        
        for (const period of periods) {
          const metrics = this.computeMetricsForPeriod(symbol, period, history);
          if (metrics) {
            const cacheKey = `${symbol}-${period}`;
            this.metricsCache.set(cacheKey, metrics);
            
            // Emit metrics update
            bus.emit("execution.quality.metrics", metrics);
            
            // Check for alerts
            this.checkMetricsForAlerts(metrics, bus, logger);
          }
        }
      }
    } catch (e: any) {
      if (logger) logger.error({ e }, "VIVO-21 calculateMetrics failed");
    }
  }

  private computeMetricsForPeriod(symbol: string, period: "1h"|"4h"|"1d"|"7d"|"30d", history: ExecutionEvent[]): QualityMetrics | null {
    const now = new Date().getTime();
    const periodMs = this.getPeriodMs(period);
    const cutoff = now - periodMs;

    const relevantEvents = history.filter(e => new Date(e.timestamp).getTime() > cutoff);
    if (relevantEvents.length < 3) return null;

    // Slippage analysis
    const slippages = relevantEvents.map(e => e.slippageBps).filter(s => !isNaN(s));
    const slippageStats = this.calculateStats(slippages);

    // Fill rate analysis
    const fillRates = relevantEvents.map(e => e.fillRate);
    const fillRateStats = this.calculateStats(fillRates);
    const fullFills = relevantEvents.filter(e => e.fillRate === 1).length;
    const partialFills = relevantEvents.filter(e => e.fillRate > 0 && e.fillRate < 1).length;
    const rejections = relevantEvents.filter(e => e.status === "rejected").length;

    // Timing analysis
    const latencies = relevantEvents.map(e => e.timingLatencyMs).filter(l => !isNaN(l));
    const latencyStats = this.calculateStats(latencies);
    const completions = relevantEvents.map(e => e.completionTimeMs).filter(c => !isNaN(c));
    const fastFills = relevantEvents.filter(e => e.timingLatencyMs <= 1000).length;
    const slowFills = relevantEvents.filter(e => e.timingLatencyMs > 5000).length;

    // Market correlation
    const highVolEvents = relevantEvents.filter(e => e.spread > 10); // >10 bps spread
    const lowVolEvents = relevantEvents.filter(e => e.spread < 5);   // <5 bps spread
    const wideSpreadEvents = relevantEvents.filter(e => e.spread > 10);
    const tightSpreadEvents = relevantEvents.filter(e => e.spread < 5);

    // Efficiency scores
    const slippageScore = Math.max(0, 1 - (slippageStats.avg / 20)); // 20bps = 0 score
    const speedScore = Math.max(0, 1 - (latencyStats.avg / 10000)); // 10s = 0 score
    const fillScore = fillRateStats.avg;
    const consistencyScore = Math.max(0, 1 - (slippageStats.stdDev / 10)); // 10bps stddev = 0

    const executionScore = (slippageScore * 0.3 + speedScore * 0.2 + fillScore * 0.3 + consistencyScore * 0.2);

    return {
      symbol,
      timeframe: "all", // aggregate across timeframes
      strategy: "all",  // aggregate across strategies
      period,
      slippage: {
        avgBps: slippageStats.avg,
        medianBps: slippageStats.median,
        p95Bps: slippageStats.p95,
        stdDevBps: slippageStats.stdDev,
        worstBps: slippageStats.max,
        slippageDistribution: this.calculateSlippageDistribution(slippages)
      },
      fillRate: {
        avgFillRate: fillRateStats.avg,
        medianFillRate: fillRateStats.median,
        fullFillRate: fullFills / relevantEvents.length,
        partialFillRate: partialFills / relevantEvents.length,
        rejectRate: rejections / relevantEvents.length
      },
      timing: {
        avgLatencyMs: latencyStats.avg,
        medianLatencyMs: latencyStats.median,
        p95LatencyMs: latencyStats.p95,
        avgCompletionMs: completions.length > 0 ? completions.reduce((a, b) => a + b, 0) / completions.length : 0,
        fastFillRate: fastFills / relevantEvents.length,
        slowFillRate: slowFills / relevantEvents.length
      },
      marketCorrelation: {
        highVolSlippage: highVolEvents.length > 0 ? 
          highVolEvents.reduce((sum, e) => sum + e.slippageBps, 0) / highVolEvents.length : 0,
        lowVolSlippage: lowVolEvents.length > 0 ? 
          lowVolEvents.reduce((sum, e) => sum + e.slippageBps, 0) / lowVolEvents.length : 0,
        wideSpreadSlippage: wideSpreadEvents.length > 0 ? 
          wideSpreadEvents.reduce((sum, e) => sum + e.slippageBps, 0) / wideSpreadEvents.length : 0,
        tightSpreadSlippage: tightSpreadEvents.length > 0 ? 
          tightSpreadEvents.reduce((sum, e) => sum + e.slippageBps, 0) / tightSpreadEvents.length : 0
      },
      efficiency: {
        executionScore,
        slippageScore,
        speedScore,
        fillScore,
        consistencyScore
      },
      sampleSize: relevantEvents.length,
      firstExecution: relevantEvents[0]?.timestamp || "",
      lastExecution: relevantEvents[relevantEvents.length - 1]?.timestamp || "",
      lastUpdate: new Date().toISOString()
    };
  }

  private calculateStats(values: number[]): {avg: number, median: number, p95: number, stdDev: number, min: number, max: number} {
    if (values.length === 0) return {avg: 0, median: 0, p95: 0, stdDev: 0, min: 0, max: 0};

    const sorted = [...values].sort((a, b) => a - b);
    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    const median = sorted[Math.floor(sorted.length / 2)];
    const p95 = sorted[Math.floor(sorted.length * 0.95)];
    const variance = values.reduce((sum, val) => sum + Math.pow(val - avg, 2), 0) / values.length;
    const stdDev = Math.sqrt(variance);

    return {
      avg,
      median,
      p95,
      stdDev,
      min: sorted[0],
      max: sorted[sorted.length - 1]
    };
  }

  private calculateSlippageDistribution(slippages: number[]): Record<string, number> {
    const ranges = {
      "0-2bps": 0,
      "2-5bps": 0,
      "5-10bps": 0,
      "10-20bps": 0,
      "20-50bps": 0,
      "50+bps": 0
    };

    for (const slip of slippages) {
      if (slip <= 2) ranges["0-2bps"]++;
      else if (slip <= 5) ranges["2-5bps"]++;
      else if (slip <= 10) ranges["5-10bps"]++;
      else if (slip <= 20) ranges["10-20bps"]++;
      else if (slip <= 50) ranges["20-50bps"]++;
      else ranges["50+bps"]++;
    }

    return ranges;
  }

  private getPeriodMs(period: string): number {
    switch (period) {
      case "1h": return 60 * 60 * 1000;
      case "4h": return 4 * 60 * 60 * 1000;
      case "1d": return 24 * 60 * 60 * 1000;
      case "7d": return 7 * 24 * 60 * 60 * 1000;
      case "30d": return 30 * 24 * 60 * 60 * 1000;
      default: return 24 * 60 * 60 * 1000;
    }
  }

  private checkMetricsForAlerts(metrics: QualityMetrics, bus: any, logger: any) {
    const alerts: QualityAlert[] = [];

    // Slippage alerts
    if (metrics.slippage.avgBps > this.config.slippageCriticalBps) {
      alerts.push(this.createAlert(metrics, "degraded_slippage", "critical", 
        metrics.slippage.avgBps, this.config.slippageCriticalBps, 
        "Average slippage is critically high"));
    } else if (metrics.slippage.avgBps > this.config.slippageAlertBps) {
      alerts.push(this.createAlert(metrics, "degraded_slippage", "high", 
        metrics.slippage.avgBps, this.config.slippageAlertBps, 
        "Average slippage is above normal levels"));
    }

    // Fill rate alerts
    const fillRatePct = metrics.fillRate.avgFillRate * 100;
    if (fillRatePct < this.config.fillRateCriticalPct) {
      alerts.push(this.createAlert(metrics, "poor_fill_rate", "critical", 
        fillRatePct, this.config.fillRateCriticalPct, 
        "Fill rate is critically low"));
    } else if (fillRatePct < this.config.fillRateAlertPct) {
      alerts.push(this.createAlert(metrics, "poor_fill_rate", "high", 
        fillRatePct, this.config.fillRateAlertPct, 
        "Fill rate is below expected levels"));
    }

    // Timing alerts
    if (metrics.timing.avgLatencyMs > this.config.latencyCriticalMs) {
      alerts.push(this.createAlert(metrics, "slow_execution", "critical", 
        metrics.timing.avgLatencyMs, this.config.latencyCriticalMs, 
        "Execution latency is critically high"));
    } else if (metrics.timing.avgLatencyMs > this.config.latencyAlertMs) {
      alerts.push(this.createAlert(metrics, "slow_execution", "high", 
        metrics.timing.avgLatencyMs, this.config.latencyAlertMs, 
        "Execution latency is above normal"));
    }

    // Rejection rate alerts
    const rejectRatePct = metrics.fillRate.rejectRate * 100;
    if (rejectRatePct > this.config.rejectRateCriticalPct) {
      alerts.push(this.createAlert(metrics, "high_reject_rate", "critical", 
        rejectRatePct, this.config.rejectRateCriticalPct, 
        "Order rejection rate is critically high"));
    } else if (rejectRatePct > this.config.rejectRateAlertPct) {
      alerts.push(this.createAlert(metrics, "high_reject_rate", "high", 
        rejectRatePct, this.config.rejectRateAlertPct, 
        "Order rejection rate is above normal"));
    }

    // Emit alerts
    for (const alert of alerts) {
      const alertKey = `${alert.symbol}-${alert.alertType}`;
      this.activeAlerts.set(alertKey, alert);
      bus.emit("execution.quality.alert", alert);
      
      if (logger) {
        logger.warn({
          symbol: alert.symbol,
          alertType: alert.alertType,
          severity: alert.severity,
          currentValue: alert.currentValue
        }, "VIVO-21 execution quality alert");
      }
    }
  }

  private createAlert(metrics: QualityMetrics, type: QualityAlert['alertType'], severity: QualityAlert['severity'], 
                     currentValue: number, threshold: number, description: string): QualityAlert {
    return {
      alertId: `${metrics.symbol}-${type}-${Date.now()}`,
      symbol: metrics.symbol,
      alertType: type,
      severity,
      currentValue,
      thresholdValue: threshold,
      historicalAvg: this.getHistoricalAverage(metrics.symbol, type),
      description,
      recommendations: this.getRecommendations(type, currentValue, threshold),
      affectedPeriod: metrics.period,
      detectedAt: new Date().toISOString(),
      marketConditions: {
        volatility: this.classifyVolatility(metrics.slippage.stdDevBps),
        spread: metrics.marketCorrelation.wideSpreadSlippage,
        volume: 0 // Would need volume data
      }
    };
  }

  private getHistoricalAverage(symbol: string, alertType: string): number {
    // Get 30-day average for comparison
    const key = `${symbol}-30d`;
    const metrics = this.metricsCache.get(key);
    if (!metrics) return 0;

    switch (alertType) {
      case "degraded_slippage": return metrics.slippage.avgBps;
      case "poor_fill_rate": return metrics.fillRate.avgFillRate * 100;
      case "slow_execution": return metrics.timing.avgLatencyMs;
      case "high_reject_rate": return metrics.fillRate.rejectRate * 100;
      default: return 0;
    }
  }

  private getRecommendations(alertType: string, currentValue: number, threshold: number): string[] {
    const recommendations: string[] = [];

    switch (alertType) {
      case "degraded_slippage":
        recommendations.push("Consider using limit orders instead of market orders");
        recommendations.push("Reduce position sizes during high volatility");
        recommendations.push("Check for market impact and adjust timing");
        break;
      case "poor_fill_rate":
        recommendations.push("Review price improvement strategies");
        recommendations.push("Consider adjusting time-in-force parameters");
        recommendations.push("Evaluate order splitting strategies");
        break;
      case "slow_execution":
        recommendations.push("Check network connectivity and latency");
        recommendations.push("Review order routing configuration");
        recommendations.push("Consider using different order types");
        break;
      case "high_reject_rate":
        recommendations.push("Review order validation logic");
        recommendations.push("Check account balance and margin requirements");
        recommendations.push("Verify exchange-specific rules compliance");
        break;
    }

    return recommendations;
  }

  private classifyVolatility(stdDev: number): "low"|"medium"|"high"|"extreme" {
    if (stdDev < 2) return "low";
    if (stdDev < 5) return "medium";
    if (stdDev < 10) return "high";
    return "extreme";
  }

  private detectAnomalies(bus: any, logger: any) {
    if (!this.config.anomalyDetectionEnabled) return;

    try {
      for (const [symbol, history] of this.executionHistory.entries()) {
        if (history.length < this.config.minSampleSizeForAnomaly) continue;

        const recent = history.slice(-10); // Last 10 executions
        const historical = history.slice(-100, -10); // Previous 90 executions

        if (historical.length < 20) continue;

        // Check for slippage anomalies
        this.checkSlippageAnomaly(symbol, recent, historical, bus, logger);
        
        // Check for latency anomalies
        this.checkLatencyAnomaly(symbol, recent, historical, bus, logger);
      }
    } catch (e: any) {
      if (logger) logger.error({ e }, "VIVO-21 anomaly detection failed");
    }
  }

  private checkSlippageAnomaly(symbol: string, recent: ExecutionEvent[], historical: ExecutionEvent[], bus: any, logger: any) {
    const recentSlippage = recent.map(e => e.slippageBps).filter(s => !isNaN(s));
    const historicalSlippage = historical.map(e => e.slippageBps).filter(s => !isNaN(s));

    if (recentSlippage.length < 3 || historicalSlippage.length < 10) return;

    const recentAvg = recentSlippage.reduce((a, b) => a + b, 0) / recentSlippage.length;
    const historicalStats = this.calculateStats(historicalSlippage);

    const deviation = Math.abs(recentAvg - historicalStats.avg) / historicalStats.stdDev;

    if (deviation > this.config.anomalyDeviationThreshold) {
      const alert: QualityAlert = {
        alertId: `${symbol}-slippage-anomaly-${Date.now()}`,
        symbol,
        alertType: "execution_anomaly",
        severity: deviation > 4 ? "critical" : "high",
        currentValue: recentAvg,
        thresholdValue: historicalStats.avg + (this.config.anomalyDeviationThreshold * historicalStats.stdDev),
        historicalAvg: historicalStats.avg,
        description: `Slippage anomaly detected: ${deviation.toFixed(1)} standard deviations from normal`,
        recommendations: [
          "Investigate recent market conditions",
          "Check for execution strategy changes",
          "Review order sizing and timing"
        ],
        affectedPeriod: "recent",
        detectedAt: new Date().toISOString(),
        marketConditions: {
          volatility: this.classifyVolatility(historicalStats.stdDev),
          spread: 0,
          volume: 0
        }
      };

      bus.emit("execution.quality.anomaly", alert);
      if (logger) {
        logger.warn({ symbol, deviation, recentAvg, historicalAvg: historicalStats.avg }, 
                    "VIVO-21 slippage anomaly detected");
      }
    }
  }

  private checkLatencyAnomaly(symbol: string, recent: ExecutionEvent[], historical: ExecutionEvent[], bus: any, logger: any) {
    const recentLatency = recent.map(e => e.timingLatencyMs).filter(l => !isNaN(l));
    const historicalLatency = historical.map(e => e.timingLatencyMs).filter(l => !isNaN(l));

    if (recentLatency.length < 3 || historicalLatency.length < 10) return;

    const recentAvg = recentLatency.reduce((a, b) => a + b, 0) / recentLatency.length;
    const historicalStats = this.calculateStats(historicalLatency);

    const deviation = Math.abs(recentAvg - historicalStats.avg) / historicalStats.stdDev;

    if (deviation > this.config.anomalyDeviationThreshold) {
      const alert: QualityAlert = {
        alertId: `${symbol}-latency-anomaly-${Date.now()}`,
        symbol,
        alertType: "execution_anomaly",
        severity: deviation > 4 ? "critical" : "high",
        currentValue: recentAvg,
        thresholdValue: historicalStats.avg + (this.config.anomalyDeviationThreshold * historicalStats.stdDev),
        historicalAvg: historicalStats.avg,
        description: `Latency anomaly detected: ${deviation.toFixed(1)} standard deviations from normal`,
        recommendations: [
          "Check network connectivity",
          "Review exchange API performance",
          "Investigate system resource usage"
        ],
        affectedPeriod: "recent",
        detectedAt: new Date().toISOString(),
        marketConditions: {
          volatility: "medium",
          spread: 0,
          volume: 0
        }
      };

      bus.emit("execution.quality.anomaly", alert);
      if (logger) {
        logger.warn({ symbol, deviation, recentAvg, historicalAvg: historicalStats.avg }, 
                    "VIVO-21 latency anomaly detected");
      }
    }
  }

  private cleanupOldData() {
    const cutoff = Date.now() - (this.config.retentionDays * 24 * 60 * 60 * 1000);

    for (const [symbol, history] of this.executionHistory.entries()) {
      const filtered = history.filter(e => new Date(e.timestamp).getTime() > cutoff);
      this.executionHistory.set(symbol, filtered);
    }

    // Clear old alerts
    for (const [alertId, alert] of this.activeAlerts.entries()) {
      if (new Date(alert.detectedAt).getTime() < cutoff) {
        this.activeAlerts.delete(alertId);
      }
    }
  }

  // Public methods for external access
  getMetrics(symbol: string, period: string = "1d"): QualityMetrics | null {
    return this.metricsCache.get(`${symbol}-${period}`) || null;
  }

  getExecutionHistory(symbol: string, limit: number = 100): ExecutionEvent[] {
    const history = this.executionHistory.get(symbol) || [];
    return history.slice(-limit);
  }

  getActiveAlerts(symbol?: string): QualityAlert[] {
    const alerts = Array.from(this.activeAlerts.values());
    return symbol ? alerts.filter(a => a.symbol === symbol) : alerts;
  }

  getStatus(): any {
    return {
      config: this.config,
      symbolsTracked: this.executionHistory.size,
      totalExecutions: Array.from(this.executionHistory.values()).reduce((sum, h) => sum + h.length, 0),
      metricsGenerated: this.metricsCache.size,
      activeAlerts: this.activeAlerts.size,
      oldestExecution: this.getOldestExecution(),
      newestExecution: this.getNewestExecution()
    };
  }

  private getOldestExecution(): string {
    let oldest = "";
    for (const history of this.executionHistory.values()) {
      if (history.length > 0) {
        const first = history[0].timestamp;
        if (!oldest || first < oldest) {
          oldest = first;
        }
      }
    }
    return oldest;
  }

  private getNewestExecution(): string {
    let newest = "";
    for (const history of this.executionHistory.values()) {
      if (history.length > 0) {
        const last = history[history.length - 1].timestamp;
        if (!newest || last > newest) {
          newest = last;
        }
      }
    }
    return newest;
  }

  updateConfig(updates: Partial<MonitorConfig>): void {
    this.config = { ...this.config, ...updates };
  }

  clearHistory(symbol?: string): void {
    if (symbol) {
      this.executionHistory.delete(symbol);
    } else {
      this.executionHistory.clear();
    }
  }

  dismissAlert(alertId: string): void {
    this.activeAlerts.delete(alertId);
  }
}
