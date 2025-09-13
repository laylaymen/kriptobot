/**
 * VIVO-17 · executionFeedbackLooper.ts
 * Execution sonuçlarını yakalayıp orijinal sinyalin doğruluk oranını öğrenmek.
 * Başarılı işlem sonrasında VIVO'da öğrenme döngüsü kurarak bir sonraki sinyalde daha iyi karar almak.
 */

import { EventEmitter } from "events";

// Types for VIVO-17
export interface ExecutionOutcome {
  correlationId: string;
  orderId: string;
  symbol: string;
  side: "long"|"short";
  outcome: "filled"|"cancelled"|"rejected"|"partial";
  fill: {
    price: number;
    quantity: number;
    fillTime: string;
    slippage: number; // bps
  };
  performance: {
    maxGain: number;    // peak unrealized pnl bps
    maxLoss: number;    // peak drawdown bps  
    finalPnl: number;   // final realized pnl bps
    holdingMinutes: number;
    exitReason: "tp"|"sl"|"manual"|"timeout";
  };
  meta: {
    signalId: string;
    originSource: string;
    variant: "base"|"aggressive"|"conservative";
    confidence: number;
    timestamp: string;
  };
}

export interface SignalAccuracy {
  signalId: string;
  symbol: string;
  side: "long"|"short";
  source: string;
  variant: "base"|"aggressive"|"conservative";
  confidence: number;
  issuedAt: string;
  accuracy: {
    directionCorrect: boolean;    // yön doğru mu
    magnitudeScore: number;       // 0..1, hareket büyüklüğü tahmin doğruluğu
    timingScore: number;          // 0..1, zamanlama doğruluğu
    overallScore: number;         // weighted composite
  };
  performance: {
    realizedPnlBps: number;
    maxGainBps: number;
    maxLossBps: number;
    holdingMinutes: number;
  };
  feedback: {
    wasSlCorrect: boolean;        // SL seviyesi uygun muydu
    wasTpCorrect: boolean;        // TP seviyesi uygun muydu
    entrySlippageOk: boolean;     // entry slippage kabul edilebilir miydi
    exitQualityOk: boolean;       // exit kalitesi iyi miydi
  };
}

export interface LearningUpdate {
  source: string;
  variant: "base"|"aggressive"|"conservative";
  symbol: string;
  timeframe: string;
  learningType: "accuracy"|"timing"|"risk"|"slippage";
  adjustment: {
    field: string;               // "confirmationThreshold", "biasWeight", etc
    delta: number;               // +/- value to adjust
    reason: string;
    confidence: number;          // 0..1
  };
  meta: {
    sampleSize: number;
    avgAccuracy: number;
    timestamp: string;
  };
}

export interface FeedbackConfig {
  minSampleSize: number;          // minimum trade count for learning
  learningRate: number;           // 0.05 (5% adjustment per update)
  accuracyThreshold: number;      // 0.65 (65% accuracy required)
  maxLookbackDays: number;        // 7 days
  confidenceDecay: number;        // 0.95 (confidence decay per day)
  minHoldingMinutes: number;      // 5 minutes
}

export interface StdError { code:string; message:string; details?:Record<string,unknown>; retriable?:boolean; }

const clamp = (x:number, lo:number, hi:number)=> Math.max(lo, Math.min(hi, x));

interface SignalTracker {
  signalId: string;
  symbol: string;
  side: "long"|"short";
  source: string;
  variant: "base"|"aggressive"|"conservative";
  confidence: number;
  issuedAt: number;
  correlationId?: string;
  executionOutcome?: ExecutionOutcome;
  accuracy?: SignalAccuracy;
}

export class ExecutionFeedbackLooper extends EventEmitter {
  ver="1.0.0"; src="VIVO-17";
  private config: FeedbackConfig;
  private activeSignals = new Map<string, SignalTracker>();  // correlationId -> tracker
  private signalHistory: SignalAccuracy[] = [];
  private pendingUpdates = new Map<string, LearningUpdate[]>(); // source -> updates

  constructor(config?: Partial<FeedbackConfig>) {
    super();
    this.config = {
      minSampleSize: 10,
      learningRate: 0.05,
      accuracyThreshold: 0.65,
      maxLookbackDays: 7,
      confidenceDecay: 0.95,
      minHoldingMinutes: 5,
      ...config
    };
  }

  attach(bus: any, logger: any) {
    // Signal tracking başlat
    bus.on("execution.intent.proposed", (intent: any) => this.trackSignal(intent));
    
    // Execution outcome yakala
    bus.on("execution.outcome", (outcome: any) => this.processOutcome(outcome, logger));
    
    // Periodic learning updates
    setInterval(() => this.generateLearningUpdates(bus, logger), 60000); // 1 minute
    
    // Cleanup old signals
    setInterval(() => this.cleanupOldSignals(), 300000); // 5 minutes
  }

  private trackSignal(intent: any) {
    try {
      const tracker: SignalTracker = {
        signalId: intent.upstream?.signalId || intent.correlationId,
        symbol: intent.symbol,
        side: intent.side,
        source: intent.upstream?.source || "unknown",
        variant: intent.selectedVariant || "base",
        confidence: intent.confidence || 0.5,
        issuedAt: new Date(intent.timestamp).getTime(),
        correlationId: intent.correlationId
      };

      this.activeSignals.set(intent.correlationId, tracker);

    } catch (e: any) {
      // Silent fail - tracking is optional
    }
  }

  private processOutcome(outcome: ExecutionOutcome, logger: any) {
    try {
      const tracker = this.activeSignals.get(outcome.correlationId);
      if (!tracker) {
        return; // No tracked signal for this outcome
      }

      tracker.executionOutcome = outcome;

      // Calculate accuracy
      const accuracy = this.calculateAccuracy(tracker, outcome);
      tracker.accuracy = accuracy;

      // Save to history
      this.signalHistory.push(accuracy);

      // Remove from active
      this.activeSignals.delete(outcome.correlationId);

      // Emit accuracy update
      this.emit("signal.accuracy", accuracy);

      // Queue learning update
      this.queueLearningUpdate(tracker, accuracy);

    } catch (e: any) {
      if (logger) logger.error({ e }, "VIVO-17 processOutcome failed");
    }
  }

  private calculateAccuracy(tracker: SignalTracker, outcome: ExecutionOutcome): SignalAccuracy {
    const perf = outcome.performance;
    
    // Direction accuracy
    const directionCorrect = 
      (tracker.side === "long" && perf.finalPnl > 0) ||
      (tracker.side === "short" && perf.finalPnl > 0);

    // Magnitude score (did we capture expected move?)
    let magnitudeScore = 0;
    if (directionCorrect) {
      const gainPct = Math.abs(perf.maxGain) / 100; // bps to decimal
      if (gainPct >= 0.02) magnitudeScore = 1.0;       // 2%+ move captured
      else if (gainPct >= 0.01) magnitudeScore = 0.8;  // 1%+ move
      else if (gainPct >= 0.005) magnitudeScore = 0.6; // 0.5%+ move
      else magnitudeScore = 0.3;
    } else {
      magnitudeScore = 0.1; // wrong direction = very low magnitude score
    }

    // Timing score (quick resolution is better)
    let timingScore = 1.0;
    if (perf.holdingMinutes > 60) timingScore = 0.8;      // held > 1hr
    else if (perf.holdingMinutes > 30) timingScore = 0.9; // held > 30min
    else if (perf.holdingMinutes < 5) timingScore = 0.7;  // too quick (< 5min)

    // Overall score (weighted)
    const overallScore = 
      0.5 * (directionCorrect ? 1.0 : 0.0) +
      0.3 * magnitudeScore +
      0.2 * timingScore;

    // Feedback assessment
    const feedback = {
      wasSlCorrect: perf.exitReason !== "sl" || Math.abs(perf.finalPnl) < 50, // SL hit but small loss = ok
      wasTpCorrect: perf.exitReason === "tp" || perf.maxGain >= 100,          // TP hit or big gain = ok
      entrySlippageOk: outcome.fill.slippage <= 5,                            // <=5bps slippage ok
      exitQualityOk: perf.exitReason !== "timeout"                           // timeout = poor exit
    };

    return {
      signalId: tracker.signalId,
      symbol: tracker.symbol,
      side: tracker.side,
      source: tracker.source,
      variant: tracker.variant,
      confidence: tracker.confidence,
      issuedAt: new Date(tracker.issuedAt).toISOString(),
      accuracy: {
        directionCorrect,
        magnitudeScore,
        timingScore,
        overallScore: clamp(overallScore, 0, 1)
      },
      performance: {
        realizedPnlBps: perf.finalPnl,
        maxGainBps: perf.maxGain,
        maxLossBps: perf.maxLoss,
        holdingMinutes: perf.holdingMinutes
      },
      feedback
    };
  }

  private queueLearningUpdate(tracker: SignalTracker, accuracy: SignalAccuracy) {
    const source = tracker.source;
    if (!this.pendingUpdates.has(source)) {
      this.pendingUpdates.set(source, []);
    }

    const updates = this.pendingUpdates.get(source)!;

    // Generate learning adjustments based on accuracy
    if (accuracy.accuracy.overallScore < 0.4) {
      // Very poor performance - reduce confidence
      updates.push({
        source,
        variant: tracker.variant,
        symbol: tracker.symbol,
        timeframe: "all", // could be extracted from signal
        learningType: "accuracy",
        adjustment: {
          field: "confirmationThreshold",
          delta: 0.05, // increase threshold (harder to trigger)
          reason: "poor_accuracy",
          confidence: 0.8
        },
        meta: {
          sampleSize: 1,
          avgAccuracy: accuracy.accuracy.overallScore,
          timestamp: new Date().toISOString()
        }
      });
    }

    if (!accuracy.feedback.entrySlippageOk) {
      // High slippage - be more conservative on entry
      updates.push({
        source,
        variant: tracker.variant,
        symbol: tracker.symbol,
        timeframe: "all",
        learningType: "slippage",
        adjustment: {
          field: "entryNudge",
          delta: 1.0, // increase entry nudge by 1 bps
          reason: "high_slippage",
          confidence: 0.6
        },
        meta: {
          sampleSize: 1,
          avgAccuracy: accuracy.accuracy.overallScore,
          timestamp: new Date().toISOString()
        }
      });
    }

    if (accuracy.accuracy.timingScore < 0.5) {
      // Poor timing - adjust timeframe preference
      updates.push({
        source,
        variant: tracker.variant,
        symbol: tracker.symbol,
        timeframe: "all",
        learningType: "timing",
        adjustment: {
          field: "timeframeBias",
          delta: tracker.variant === "aggressive" ? -0.1 : 0.1,
          reason: "poor_timing",
          confidence: 0.5
        },
        meta: {
          sampleSize: 1,
          avgAccuracy: accuracy.accuracy.overallScore,
          timestamp: new Date().toISOString()
        }
      });
    }
  }

  private generateLearningUpdates(bus: any, logger: any) {
    try {
      for (const [source, updates] of this.pendingUpdates.entries()) {
        if (updates.length === 0) continue;

        // Aggregate updates for this source
        const aggregated = this.aggregateUpdates(source, updates);
        
        // Check if we have enough sample size
        const recentHistory = this.getRecentHistory(source);
        if (recentHistory.length >= this.config.minSampleSize) {
          // Emit consolidated learning update
          for (const update of aggregated) {
            update.meta.sampleSize = recentHistory.length;
            update.meta.avgAccuracy = this.calculateAvgAccuracy(recentHistory);
            
            bus.emit("vivo.learning.update", update);
            
            if (logger) {
              logger.info({
                source: update.source,
                field: update.adjustment.field,
                delta: update.adjustment.delta,
                accuracy: update.meta.avgAccuracy
              }, "VIVO-17 learning update");
            }
          }
        }

        // Clear processed updates
        this.pendingUpdates.set(source, []);
      }

    } catch (e: any) {
      if (logger) logger.error({ e }, "VIVO-17 generateLearningUpdates failed");
    }
  }

  private aggregateUpdates(source: string, updates: LearningUpdate[]): LearningUpdate[] {
    const grouped = new Map<string, LearningUpdate[]>();
    
    // Group by field
    for (const update of updates) {
      const key = `${update.adjustment.field}-${update.variant}-${update.symbol}`;
      if (!grouped.has(key)) {
        grouped.set(key, []);
      }
      grouped.get(key)!.push(update);
    }

    // Aggregate each group
    const aggregated: LearningUpdate[] = [];
    for (const [key, group] of grouped.entries()) {
      if (group.length === 0) continue;

      const first = group[0];
      const avgDelta = group.reduce((sum, u) => sum + u.adjustment.delta, 0) / group.length;
      const avgConfidence = group.reduce((sum, u) => sum + u.adjustment.confidence, 0) / group.length;

      aggregated.push({
        ...first,
        adjustment: {
          ...first.adjustment,
          delta: avgDelta * this.config.learningRate, // Apply learning rate
          confidence: avgConfidence
        }
      });
    }

    return aggregated;
  }

  private getRecentHistory(source: string): SignalAccuracy[] {
    const cutoff = Date.now() - (this.config.maxLookbackDays * 24 * 60 * 60 * 1000);
    return this.signalHistory.filter(h => 
      h.source === source && 
      new Date(h.issuedAt).getTime() > cutoff
    );
  }

  private calculateAvgAccuracy(history: SignalAccuracy[]): number {
    if (history.length === 0) return 0;
    return history.reduce((sum, h) => sum + h.accuracy.overallScore, 0) / history.length;
  }

  private cleanupOldSignals() {
    const cutoff = Date.now() - (this.config.maxLookbackDays * 24 * 60 * 60 * 1000);
    
    // Clean active signals
    for (const [correlationId, tracker] of this.activeSignals.entries()) {
      if (tracker.issuedAt < cutoff) {
        this.activeSignals.delete(correlationId);
      }
    }

    // Clean signal history
    this.signalHistory = this.signalHistory.filter(h => 
      new Date(h.issuedAt).getTime() > cutoff
    );
  }

  // Public methods for diagnostics
  getAccuracyStats(source?: string): any {
    const history = source ? 
      this.signalHistory.filter(h => h.source === source) : 
      this.signalHistory;

    if (history.length === 0) {
      return { sampleSize: 0, avgAccuracy: 0, directionAccuracy: 0 };
    }

    const avgAccuracy = this.calculateAvgAccuracy(history);
    const directionAccuracy = history.filter(h => h.accuracy.directionCorrect).length / history.length;

    return {
      sampleSize: history.length,
      avgAccuracy,
      directionAccuracy,
      byVariant: this.getVariantStats(history),
      bySymbol: this.getSymbolStats(history)
    };
  }

  private getVariantStats(history: SignalAccuracy[]): Record<string, any> {
    const variants = ["base", "aggressive", "conservative"];
    const stats: Record<string, any> = {};

    for (const variant of variants) {
      const variantHistory = history.filter(h => h.variant === variant);
      if (variantHistory.length > 0) {
        stats[variant] = {
          count: variantHistory.length,
          avgAccuracy: this.calculateAvgAccuracy(variantHistory),
          directionAccuracy: variantHistory.filter(h => h.accuracy.directionCorrect).length / variantHistory.length
        };
      }
    }

    return stats;
  }

  private getSymbolStats(history: SignalAccuracy[]): Record<string, any> {
    const symbols = [...new Set(history.map(h => h.symbol))];
    const stats: Record<string, any> = {};

    for (const symbol of symbols) {
      const symbolHistory = history.filter(h => h.symbol === symbol);
      stats[symbol] = {
        count: symbolHistory.length,
        avgAccuracy: this.calculateAvgAccuracy(symbolHistory),
        directionAccuracy: symbolHistory.filter(h => h.accuracy.directionCorrect).length / symbolHistory.length
      };
    }

    return stats;
  }
}
