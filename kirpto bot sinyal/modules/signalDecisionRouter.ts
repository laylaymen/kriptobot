/**
 * VIVO-16 · signalDecisionRouter.ts
 * Aynı enstrüman ve yönde birden çok sinyal geldiğinde tek karar üretmek.
 * VIVO'nun rol sözleşmesine uygun şekilde confirmationThreshold, signalVariant, biasWeightedTune değerlerini nihai karara bağlamak.
 */

import { EventEmitter } from "events";

// Types for VIVO-16
export interface SignalEnvelope {
  timestamp: string;
  symbol: string;
  side: "long"|"short";
  timeframe: string;
  source: string;
  features: {
    trendStrength: number;
    rrScore: number;
    volatility: number;
    orderflowBias: number;
  };
  vivoHints: {
    confirmationThreshold: number;
    signalVariant: "base"|"aggressive"|"conservative";
    biasWeightedTune: {
      trend: number;
      orderflow: number;
      formation: number;
    };
  };
  liviaGate: {
    safetyGate: "pass"|"hold";
    riskLimitAdvice: "tight"|"normal"|"relaxed";
    cooldownActive: boolean;
  };
  otobilinc: {
    psychologyStability: number; // 0..1
    fatigueScore: number;        // 0..1
    biasFlags: string[];
  };
  meta: {
    signalId: string;
    formationTag?: string;
    latencyMs: number;
  };
}

export interface RouterDecision {
  decision: "approve"|"reject"|"defer";
  reasonCodes: string[];
  selectedVariant: "base"|"aggressive"|"conservative";
  confidence: number; // 0..1
  routing: {
    busTopic: "execution.intent.proposed"|"execution.intent.rejected"|"execution.intent.deferred";
    correlationId: string;
  };
  constraints: {
    cooldownMs: number;
    maxConcurrentPositions: number;
    riskProfile: "tight"|"normal"|"relaxed";
  };
  tuning: {
    entryNudge: number; // bps
    tpSlStyle: "ATR"|"range"|"hybrid";
    positionScaling: "single"|"laddered";
  };
  audit: {
    symbol: string;
    side: "long"|"short";
    receivedAt: string;
    processedAt: string;
    upstream: { source: string; signalId: string };
  };
}

export interface RouterConfig {
  decisionWindowMs: number;     // aynı sembol-yön için pencere
  duplicateKey: string[];       // ["symbol","side","timeframe"]
  minConfidence: number;        // 0.62
  defaultVariant: "base"|"aggressive"|"conservative";
  cooldownMs: {
    approve: number;
    reject: number;
    defer: number;
  };
  conflictPolicy: "higherConfidenceWins"|"latestWins";
  maxConcurrentPerSymbol: number;
}

export interface StdError { code:string; message:string; details?:Record<string,unknown>; retriable?:boolean; }

const clamp = (x:number, lo:number, hi:number)=> Math.max(lo, Math.min(hi, x));

interface WindowStore {
  key: string;
  signals: SignalEnvelope[];
  expiresAt: number;
}

export class SignalDecisionRouter extends EventEmitter {
  ver="1.0.0"; src="VIVO-16";
  private config: RouterConfig;
  private windows = new Map<string, WindowStore>();

  constructor(config?: Partial<RouterConfig>) {
    super();
    this.config = {
      decisionWindowMs: 1500,
      duplicateKey: ["symbol","side","timeframe"],
      minConfidence: 0.62,
      defaultVariant: "base",
      cooldownMs: {
        approve: 30000,
        reject: 10000,
        defer: 15000
      },
      conflictPolicy: "higherConfidenceWins",
      maxConcurrentPerSymbol: 1,
      ...config
    };
  }

  attach(bus: any, logger: any) {
    bus.on("signal.envelope", (envelope: any) => this.processSignal(envelope, bus, logger));
    bus.on("livia.gate", (gate: any) => this.updateLiviaState(gate));
    bus.on("psy.state", (state: any) => this.updatePsyState(state));
    
    // Periyodik temizlik
    setInterval(() => this.cleanupExpiredWindows(), 5000);
  }

  private processSignal(envelope: SignalEnvelope, bus: any, logger: any) {
    try {
      const validation = this.validateSignal(envelope);
      if (validation) {
        this.emitRejection(envelope, [validation], bus);
        return;
      }

      const windowKey = this.getWindowKey(envelope);
      const now = Date.now();

      // Pencere kontrol et
      let window = this.windows.get(windowKey);
      if (!window || window.expiresAt < now) {
        window = {
          key: windowKey,
          signals: [],
          expiresAt: now + this.config.decisionWindowMs
        };
        this.windows.set(windowKey, window);
      }

      // Duplicate kontrol
      if (this.isDuplicate(envelope, window.signals)) {
        this.emitRejection(envelope, ["duplicate_id"], bus);
        return;
      }

      // Pencereye ekle
      window.signals.push(envelope);

      // Karar ver (pencere dolduğunda veya timeout'ta)
      setTimeout(() => this.makeDecision(windowKey, bus, logger), this.config.decisionWindowMs);

    } catch (e: any) {
      if (logger) logger.error({ e }, "VIVO-16 processSignal failed");
      this.emitRejection(envelope, ["processing_error"], bus);
    }
  }

  private validateSignal(envelope: SignalEnvelope): string | null {
    if (!envelope?.timestamp || !envelope?.symbol || !envelope?.side) {
      return "invalid_payload";
    }

    // Zaman skew kontrolü
    const signalTime = new Date(envelope.timestamp).getTime();
    const now = Date.now();
    if (Math.abs(now - signalTime) > 2000) {
      return "clock_skew";
    }

    // Latency kontrolü  
    if (envelope.meta?.latencyMs > 1000) {
      return "stale_signal";
    }

    return null;
  }

  private getWindowKey(envelope: SignalEnvelope): string {
    const parts = this.config.duplicateKey.map(key => {
      switch(key) {
        case "symbol": return envelope.symbol;
        case "side": return envelope.side;
        case "timeframe": return envelope.timeframe;
        default: return key;
      }
    });
    return parts.join("|");
  }

  private isDuplicate(envelope: SignalEnvelope, signals: SignalEnvelope[]): boolean {
    return signals.some(s => s.meta.signalId === envelope.meta.signalId);
  }

  private makeDecision(windowKey: string, bus: any, logger: any) {
    const window = this.windows.get(windowKey);
    if (!window || !window.signals.length) return;

    try {
      // En iyi sinyali seç
      const bestSignal = this.selectBestSignal(window.signals);
      if (!bestSignal) {
        for (const signal of window.signals) {
          this.emitRejection(signal, ["no_viable_signal"], bus);
        }
        this.windows.delete(windowKey);
        return;
      }

      // Karar üret
      const decision = this.generateDecision(bestSignal);
      
      // Yayınla
      this.emitDecision(bestSignal, decision, bus);

      // Reddedilen sinyalleri bildir
      for (const signal of window.signals) {
        if (signal.meta.signalId !== bestSignal.meta.signalId) {
          this.emitRejection(signal, ["conflicting_signal"], bus);
        }
      }

      this.windows.delete(windowKey);

    } catch (e: any) {
      if (logger) logger.error({ e }, "VIVO-16 makeDecision failed");
      this.windows.delete(windowKey);
    }
  }

  private selectBestSignal(signals: SignalEnvelope[]): SignalEnvelope | null {
    let best: SignalEnvelope | null = null;
    let bestScore = 0;

    for (const signal of signals) {
      // LIVIA gate kontrolü
      if (signal.liviaGate.safetyGate === "hold") {
        continue; // bu sinyal defer edilecek
      }

      const score = this.calculateSignalScore(signal);
      
      if (score >= this.config.minConfidence) {
        if (this.config.conflictPolicy === "higherConfidenceWins") {
          if (score > bestScore) {
            best = signal;
            bestScore = score;
          }
        } else { // latestWins
          best = signal;
        }
      }
    }

    return best;
  }

  private calculateSignalScore(signal: SignalEnvelope): number {
    const features = signal.features;
    
    // Base score
    let score = 0.4 * features.trendStrength + 
                0.3 * features.rrScore + 
                0.3 * features.orderflowBias;

    // Volatilite ayarı
    const volZ = features.volatility;
    if (volZ > 1.5) score += 0.03;
    else if (volZ < 0.5) score -= 0.03;

    // BiasWeightedTune uygula
    const tune = signal.vivoHints.biasWeightedTune;
    const formationPresence = signal.meta.formationTag ? 0.05 : 0;
    const adj = tune.trend * features.trendStrength + 
                tune.orderflow * features.orderflowBias + 
                tune.formation * formationPresence;
    score += adj * 0.1;

    // Psychology penalty
    if (signal.otobilinc.psychologyStability < 0.4) score -= 0.08;
    if (signal.otobilinc.fatigueScore > 0.7) score -= 0.05;

    // Clock skew penalty
    const signalTime = new Date(signal.timestamp).getTime();
    const now = Date.now();
    if (Math.abs(now - signalTime) > 1000) score -= 0.05;

    // Latency penalty
    if (signal.meta.latencyMs > 500) score -= 0.03;

    // Open bar penalty (if source indicates)
    if (signal.source.includes("open_bar")) score -= 0.04;

    return clamp(score, 0, 1);
  }

  private generateDecision(signal: SignalEnvelope): RouterDecision {
    const now = new Date().toISOString();
    const score = this.calculateSignalScore(signal);
    
    // Variant seçimi
    let variant = signal.vivoHints.signalVariant;
    
    if (signal.features.rrScore >= 0.65 && 
        signal.features.trendStrength >= 0.6 && 
        signal.otobilinc.psychologyStability >= 0.5) {
      variant = "aggressive";
    } else if (signal.otobilinc.psychologyStability < 0.4 || 
               signal.liviaGate.riskLimitAdvice === "tight") {
      variant = "conservative";
    }

    // Karar
    let decision: "approve"|"reject"|"defer" = "reject";
    let reasonCodes: string[] = [];
    let cooldownMs = this.config.cooldownMs.reject;

    if (signal.liviaGate.safetyGate === "hold") {
      decision = "defer";
      reasonCodes = ["livia_hold"];
      cooldownMs = this.config.cooldownMs.defer;
    } else if (score >= this.config.minConfidence) {
      decision = "approve";
      reasonCodes = ["score_ok", "livia_pass"];
      cooldownMs = this.config.cooldownMs.approve;
    } else {
      reasonCodes = ["score_low"];
    }

    const correlationId = `${signal.symbol}-${signal.side}-${signal.timeframe}-${Date.now()}`;

    return {
      decision,
      reasonCodes,
      selectedVariant: variant,
      confidence: score,
      routing: {
        busTopic: decision === "approve" ? "execution.intent.proposed" :
                  decision === "defer" ? "execution.intent.deferred" : "execution.intent.rejected",
        correlationId
      },
      constraints: {
        cooldownMs,
        maxConcurrentPositions: this.config.maxConcurrentPerSymbol,
        riskProfile: signal.liviaGate.riskLimitAdvice
      },
      tuning: {
        entryNudge: variant === "aggressive" ? 3 : variant === "conservative" ? 6 : 4,
        tpSlStyle: signal.meta.formationTag ? "ATR" : "hybrid",
        positionScaling: variant === "aggressive" ? "laddered" : "single"
      },
      audit: {
        symbol: signal.symbol,
        side: signal.side,
        receivedAt: signal.timestamp,
        processedAt: now,
        upstream: {
          source: signal.source,
          signalId: signal.meta.signalId
        }
      }
    };
  }

  private emitDecision(signal: SignalEnvelope, decision: RouterDecision, bus: any) {
    const event = {
      ...decision,
      timestamp: new Date().toISOString(),
      symbol: signal.symbol,
      side: signal.side,
      timeframe: signal.timeframe,
      selectedVariant: decision.selectedVariant,
      confidence: decision.confidence
    };

    bus.emit(decision.routing.busTopic, event);
    bus.emit("vivo.router.metrics", {
      decision: decision.decision,
      confidence: decision.confidence,
      variant: decision.selectedVariant,
      latencyMs: Date.now() - new Date(signal.timestamp).getTime()
    });
  }

  private emitRejection(signal: SignalEnvelope, reasons: string[], bus: any) {
    const rejection = {
      event: "execution.intent.rejected",
      timestamp: new Date().toISOString(),
      symbol: signal.symbol,
      side: signal.side,
      reasonCodes: reasons,
      correlationId: `rejected-${signal.meta.signalId}`
    };

    bus.emit("execution.intent.rejected", rejection);
  }

  private updateLiviaState(gate: any) {
    // LIVIA state güncellemeleri için
  }

  private updatePsyState(state: any) {
    // Psychology state güncellemeleri için
  }

  private cleanupExpiredWindows() {
    const now = Date.now();
    for (const [key, window] of this.windows.entries()) {
      if (window.expiresAt < now) {
        this.windows.delete(key);
      }
    }
  }
}
