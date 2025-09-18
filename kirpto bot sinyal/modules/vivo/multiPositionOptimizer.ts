/**
 * VIVO-19 · multiPositionOptimizer.ts
 * Çoklu pozisyon optimizasyonu - aynı sembollerde birden fazla pozisyon açma kuralları ve optimizasyonu.
 * Overlapping positions, correlation management, risk concentration control.
 */

import { EventEmitter } from "events";

// Types for VIVO-19
export interface PositionIntent {
  intentId: string;
  symbol: string;
  side: "long"|"short";
  baseQty: number;
  entryPrice: number;
  stopLoss: number;
  takeProfit: number[];
  timeframe: string;
  source: string;
  variant: "base"|"aggressive"|"conservative";
  riskAllocation: number; // percentage of total risk
  confidence: number;
  correlationId: string;
  timestamp: string;
}

export interface ExistingPosition {
  positionId: string;
  symbol: string;
  side: "long"|"short";
  qty: number;
  avgEntryPrice: number;
  currentPrice: number;
  unrealizedPnl: number;
  realizedPnl: number;
  stopLoss?: number;
  takeProfit?: number[];
  openTime: string;
  timeframe: string;
  source: string;
  riskAllocation: number;
  status: "active"|"closing"|"closed";
}

export interface OptimizationDecision {
  action: "approve"|"reject"|"modify"|"merge"|"defer";
  reasonCodes: string[];
  originalIntent: PositionIntent;
  modifications?: {
    adjustedQty?: number;
    adjustedEntry?: number;
    adjustedSL?: number;
    adjustedTP?: number[];
    mergeWithPosition?: string;
    scalingFactor?: number;
  };
  riskAssessment: {
    concentrationRisk: number;      // 0..1
    correlationRisk: number;        // 0..1
    totalExposure: number;          // quote currency
    diversificationScore: number;   // 0..1
    hedgeQuality: number;          // 0..1 if positions offset each other
  };
  constraints: {
    maxPositionsPerSymbol: number;
    maxConcentrationPct: number;
    minDiversificationScore: number;
    cooldownBetweenMs: number;
  };
  audit: {
    existingPositions: number;
    totalRiskAllocation: number;
    decisionTime: string;
    calculationLatencyMs: number;
  };
}

export interface CorrelationMatrix {
  pairs: Record<string, Record<string, number>>; // symbol1 -> symbol2 -> correlation [-1,1]
  lastUpdate: string;
  sampleSize: number;
  lookbackDays: number;
}

export interface OptimizerConfig {
  maxPositionsPerSymbol: number;        // 3
  maxTotalPositions: number;            // 15
  maxConcentrationPct: number;          // 25% of total equity in one symbol
  minDiversificationScore: number;      // 0.3
  correlationThreshold: number;         // 0.7 (avoid highly correlated positions)
  cooldownBetweenSameSymbolMs: number;  // 300000 (5 minutes)
  hedgeDetectionThreshold: number;      // 0.8 (opposite positions that hedge)
  riskReductionOnOverlap: number;       // 0.7 (reduce size when overlapping)
  emergencyCloseThreshold: number;      // 0.15 (15% total portfolio loss)
}

export interface StdError { code:string; message:string; details?:Record<string,unknown>; retriable?:boolean; }

const clamp = (x:number, lo:number, hi:number)=> Math.max(lo, Math.min(hi, x));

export class MultiPositionOptimizer extends EventEmitter {
  ver="1.0.0"; src="VIVO-19";
  private config: OptimizerConfig;
  private positions = new Map<string, ExistingPosition>();
  private correlationMatrix: CorrelationMatrix | null = null;
  private lastDecisions = new Map<string, number>(); // symbol -> timestamp
  private portfolioEquity = 100000; // will be updated from external source

  constructor(config?: Partial<OptimizerConfig>) {
    super();
    this.config = {
      maxPositionsPerSymbol: 3,
      maxTotalPositions: 15,
      maxConcentrationPct: 25,
      minDiversificationScore: 0.3,
      correlationThreshold: 0.7,
      cooldownBetweenSameSymbolMs: 300000,
      hedgeDetectionThreshold: 0.8,
      riskReductionOnOverlap: 0.7,
      emergencyCloseThreshold: 0.15,
      ...config
    };
  }

  attach(bus: any, logger: any) {
    // Listen for position intents
    bus.on("execution.intent.approved", (intent: any) => this.evaluateIntent(intent, bus, logger));
    
    // Update existing positions
    bus.on("position.update", (position: any) => this.updatePosition(position));
    bus.on("position.closed", (position: any) => this.removePosition(position.positionId));
    
    // Update correlation matrix
    bus.on("correlation.matrix.update", (matrix: any) => this.updateCorrelationMatrix(matrix));
    
    // Update portfolio equity
    bus.on("portfolio.equity.update", (equity: any) => this.updateEquity(equity.total));
    
    // Emergency position check
    setInterval(() => this.checkEmergencyClose(bus, logger), 30000);
  }

  private evaluateIntent(intent: PositionIntent, bus: any, logger: any) {
    try {
      const startTime = Date.now();
      
      // Basic validation
      const validation = this.validateIntent(intent);
      if (validation) {
        this.emitDecision(intent, "reject", [validation], {}, bus);
        return;
      }

      // Get existing positions for this symbol
      const existingForSymbol = this.getPositionsForSymbol(intent.symbol);
      
      // Check position limits
      if (existingForSymbol.length >= this.config.maxPositionsPerSymbol) {
        this.emitDecision(intent, "reject", ["max_positions_per_symbol"], {}, bus);
        return;
      }

      if (this.positions.size >= this.config.maxTotalPositions) {
        this.emitDecision(intent, "reject", ["max_total_positions"], {}, bus);
        return;
      }

      // Check cooldown
      const lastDecision = this.lastDecisions.get(intent.symbol);
      if (lastDecision && Date.now() - lastDecision < this.config.cooldownBetweenSameSymbolMs) {
        this.emitDecision(intent, "defer", ["cooldown_active"], {}, bus);
        return;
      }

      // Risk assessment
      const riskAssessment = this.calculateRiskAssessment(intent, existingForSymbol);
      
      // Concentration check
      if (riskAssessment.concentrationRisk > this.config.maxConcentrationPct / 100) {
        // Try to reduce size
        const reductionFactor = (this.config.maxConcentrationPct / 100) / riskAssessment.concentrationRisk;
        if (reductionFactor > 0.5) { // If reduction is reasonable
          this.emitDecision(intent, "modify", ["concentration_risk_reduce"], {
            adjustedQty: intent.baseQty * reductionFactor,
            scalingFactor: reductionFactor
          }, bus);
        } else {
          this.emitDecision(intent, "reject", ["concentration_risk_high"], {}, bus);
        }
        return;
      }

      // Correlation check
      if (riskAssessment.correlationRisk > this.config.correlationThreshold) {
        this.emitDecision(intent, "reject", ["correlation_risk_high"], {}, bus);
        return;
      }

      // Diversification check
      if (riskAssessment.diversificationScore < this.config.minDiversificationScore) {
        this.emitDecision(intent, "reject", ["diversification_insufficient"], {}, bus);
        return;
      }

      // Check for hedge opportunities
      const hedgeOpportunity = this.detectHedgeOpportunity(intent, existingForSymbol);
      if (hedgeOpportunity) {
        this.emitDecision(intent, "approve", ["hedge_detected"], {
          mergeWithPosition: hedgeOpportunity.positionId
        }, bus);
        return;
      }

      // Check for overlap optimization
      const overlapOptimization = this.optimizeOverlap(intent, existingForSymbol);
      if (overlapOptimization.shouldModify) {
        this.emitDecision(intent, "modify", ["overlap_optimization"], {
          adjustedQty: overlapOptimization.adjustedQty,
          adjustedEntry: overlapOptimization.adjustedEntry,
          scalingFactor: overlapOptimization.scalingFactor
        }, bus);
        return;
      }

      // All checks passed - approve
      this.emitDecision(intent, "approve", ["risk_acceptable"], {}, bus);
      
      // Record decision time for cooldown
      this.lastDecisions.set(intent.symbol, Date.now());

      // Emit metrics
      bus.emit("vivo.multi_position.metrics", {
        processingTimeMs: Date.now() - startTime,
        totalPositions: this.positions.size,
        positionsForSymbol: existingForSymbol.length,
        concentrationRisk: riskAssessment.concentrationRisk,
        correlationRisk: riskAssessment.correlationRisk,
        diversificationScore: riskAssessment.diversificationScore
      });

    } catch (e: any) {
      if (logger) logger.error({ e }, "VIVO-19 evaluateIntent failed");
      this.emitDecision(intent, "reject", ["processing_error"], {}, bus);
    }
  }

  private validateIntent(intent: PositionIntent): string | null {
    if (!intent.symbol || !intent.side || !intent.baseQty || !intent.entryPrice) {
      return "invalid_intent_data";
    }

    if (intent.baseQty <= 0 || intent.entryPrice <= 0) {
      return "invalid_numeric_values";
    }

    if (intent.riskAllocation <= 0 || intent.riskAllocation > 100) {
      return "invalid_risk_allocation";
    }

    if (intent.confidence < 0 || intent.confidence > 1) {
      return "invalid_confidence";
    }

    return null;
  }

  private getPositionsForSymbol(symbol: string): ExistingPosition[] {
    return Array.from(this.positions.values()).filter(p => 
      p.symbol === symbol && p.status === "active"
    );
  }

  private calculateRiskAssessment(intent: PositionIntent, existingForSymbol: ExistingPosition[]): OptimizationDecision['riskAssessment'] {
    // Calculate concentration risk
    const intentNotional = intent.baseQty * intent.entryPrice;
    const existingNotional = existingForSymbol.reduce((sum, p) => sum + (p.qty * p.avgEntryPrice), 0);
    const totalNotional = intentNotional + existingNotional;
    const concentrationRisk = totalNotional / this.portfolioEquity;

    // Calculate correlation risk
    let correlationRisk = 0;
    if (this.correlationMatrix) {
      const correlatedPositions = Array.from(this.positions.values()).filter(p => {
        const correlation = this.correlationMatrix?.pairs[intent.symbol]?.[p.symbol];
        return correlation && Math.abs(correlation) > this.config.correlationThreshold;
      });
      correlationRisk = correlatedPositions.length > 0 ? 
        Math.max(...correlatedPositions.map(p => Math.abs(this.correlationMatrix!.pairs[intent.symbol][p.symbol]))) : 0;
    }

    // Calculate total exposure
    const allPositions = Array.from(this.positions.values());
    const totalExposure = allPositions.reduce((sum, p) => sum + (p.qty * p.currentPrice), 0) + intentNotional;

    // Calculate diversification score
    const uniqueSymbols = new Set([...allPositions.map(p => p.symbol), intent.symbol]);
    const diversificationScore = Math.min(1, uniqueSymbols.size / 10); // Target 10+ symbols for max diversification

    // Calculate hedge quality
    const oppositePositions = existingForSymbol.filter(p => p.side !== intent.side);
    const hedgeQuality = oppositePositions.length > 0 ? 
      Math.min(1, oppositePositions.reduce((sum, p) => sum + p.qty, 0) / intent.baseQty) : 0;

    return {
      concentrationRisk,
      correlationRisk,
      totalExposure,
      diversificationScore,
      hedgeQuality
    };
  }

  private detectHedgeOpportunity(intent: PositionIntent, existingForSymbol: ExistingPosition[]): ExistingPosition | null {
    // Look for opposite side positions that could be hedged
    const oppositePositions = existingForSymbol.filter(p => 
      p.side !== intent.side && p.status === "active"
    );

    for (const position of oppositePositions) {
      const hedgeRatio = Math.min(intent.baseQty, position.qty) / Math.max(intent.baseQty, position.qty);
      if (hedgeRatio >= this.config.hedgeDetectionThreshold) {
        return position;
      }
    }

    return null;
  }

  private optimizeOverlap(intent: PositionIntent, existingForSymbol: ExistingPosition[]): {
    shouldModify: boolean;
    adjustedQty?: number;
    adjustedEntry?: number;
    scalingFactor?: number;
  } {
    const sameDirectionPositions = existingForSymbol.filter(p => 
      p.side === intent.side && p.status === "active"
    );

    if (sameDirectionPositions.length === 0) {
      return { shouldModify: false };
    }

    // Calculate overlap and suggest reduction
    const totalExistingQty = sameDirectionPositions.reduce((sum, p) => sum + p.qty, 0);
    const scalingFactor = this.config.riskReductionOnOverlap;
    
    // Reduce new position size when there's overlap
    const adjustedQty = intent.baseQty * scalingFactor;
    
    // Price improvement suggestion (average with existing positions)
    const avgExistingPrice = sameDirectionPositions.reduce((sum, p) => sum + p.avgEntryPrice, 0) / sameDirectionPositions.length;
    const adjustedEntry = (intent.entryPrice + avgExistingPrice) / 2;

    return {
      shouldModify: true,
      adjustedQty,
      adjustedEntry,
      scalingFactor
    };
  }

  private emitDecision(
    intent: PositionIntent, 
    action: OptimizationDecision['action'], 
    reasonCodes: string[], 
    modifications: OptimizationDecision['modifications'], 
    bus: any
  ) {
    const existingForSymbol = this.getPositionsForSymbol(intent.symbol);
    const riskAssessment = this.calculateRiskAssessment(intent, existingForSymbol);
    
    const decision: OptimizationDecision = {
      action,
      reasonCodes,
      originalIntent: intent,
      modifications,
      riskAssessment,
      constraints: {
        maxPositionsPerSymbol: this.config.maxPositionsPerSymbol,
        maxConcentrationPct: this.config.maxConcentrationPct,
        minDiversificationScore: this.config.minDiversificationScore,
        cooldownBetweenMs: this.config.cooldownBetweenSameSymbolMs
      },
      audit: {
        existingPositions: this.positions.size,
        totalRiskAllocation: Array.from(this.positions.values()).reduce((sum, p) => sum + p.riskAllocation, 0),
        decisionTime: new Date().toISOString(),
        calculationLatencyMs: 0
      }
    };

    bus.emit("vivo.multi_position.decision", decision);
    
    // Route to next stage based on decision
    const routingEvent = action === "approve" || action === "modify" ? 
      "execution.intent.optimized" : 
      "execution.intent.position_rejected";
    
    bus.emit(routingEvent, {
      ...intent,
      optimizationDecision: decision,
      timestamp: new Date().toISOString()
    });
  }

  private updatePosition(position: ExistingPosition) {
    this.positions.set(position.positionId, position);
  }

  private removePosition(positionId: string) {
    this.positions.delete(positionId);
  }

  private updateCorrelationMatrix(matrix: CorrelationMatrix) {
    this.correlationMatrix = matrix;
  }

  private updateEquity(equity: number) {
    this.portfolioEquity = equity;
  }

  private checkEmergencyClose(bus: any, logger: any) {
    try {
      const totalUnrealizedPnl = Array.from(this.positions.values())
        .reduce((sum, p) => sum + p.unrealizedPnl, 0);
      
      const portfolioLoss = Math.abs(totalUnrealizedPnl) / this.portfolioEquity;
      
      if (portfolioLoss > this.config.emergencyCloseThreshold) {
        bus.emit("emergency.position.close", {
          trigger: "multi_position_optimizer",
          portfolioLoss,
          threshold: this.config.emergencyCloseThreshold,
          affectedPositions: Array.from(this.positions.keys()),
          timestamp: new Date().toISOString()
        });
        
        if (logger) {
          logger.warn({
            portfolioLoss,
            threshold: this.config.emergencyCloseThreshold,
            positionCount: this.positions.size
          }, "VIVO-19 emergency close triggered");
        }
      }
    } catch (e: any) {
      if (logger) logger.error({ e }, "VIVO-19 emergency check failed");
    }
  }

  // Public methods for external monitoring
  getStatus(): any {
    const positions = Array.from(this.positions.values());
    const symbols = new Set(positions.map(p => p.symbol));
    
    return {
      totalPositions: positions.length,
      uniqueSymbols: symbols.size,
      totalExposure: positions.reduce((sum, p) => sum + (p.qty * p.currentPrice), 0),
      totalUnrealizedPnl: positions.reduce((sum, p) => sum + p.unrealizedPnl, 0),
      concentrationBySymbol: this.getConcentrationBySymbol(),
      correlationMatrixAge: this.correlationMatrix ? 
        Date.now() - new Date(this.correlationMatrix.lastUpdate).getTime() : null,
      config: this.config
    };
  }

  private getConcentrationBySymbol(): Record<string, number> {
    const bySymbol: Record<string, number> = {};
    for (const position of this.positions.values()) {
      if (!bySymbol[position.symbol]) bySymbol[position.symbol] = 0;
      bySymbol[position.symbol] += position.qty * position.currentPrice;
    }
    
    // Convert to percentages
    for (const symbol in bySymbol) {
      bySymbol[symbol] = (bySymbol[symbol] / this.portfolioEquity) * 100;
    }
    
    return bySymbol;
  }

  updateConfig(updates: Partial<OptimizerConfig>): void {
    this.config = { ...this.config, ...updates };
  }

  forceClosePosition(positionId: string, reason: string): void {
    const position = this.positions.get(positionId);
    if (position) {
      this.emit("force.close.position", {
        positionId,
        reason,
        position,
        timestamp: new Date().toISOString()
      });
    }
  }
}
