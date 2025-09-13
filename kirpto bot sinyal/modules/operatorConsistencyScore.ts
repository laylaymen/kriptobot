/**
 * VIVO-38 · operatorConsistencyScore.ts
 * Operatör seçimlerinin tutarlılık & sonuç skorunu hesaplayıp öneri sıralaması 
 * ve soru derinliği için sinyal üretmek.
 * Operatör performans izleme ve uyarı sistemi.
 */

import { EventEmitter } from "events";

// Input Event Types
export interface OperatorChoiceLog {
  event: "operator.choice.log";
  timestamp: string;
  when: string;
  symbol: string;
  decision: "accept" | "reject" | "modify" | "defer";
  overrides: Array<{
    field: string;
    originalValue: any;
    newValue: any;
    reason?: string;
  }>;
  context: {
    signalStrength: number;
    marketCondition: string;
    variant: string;
    confidence: number;
    timeToDecision: number; // seconds
    sessionId: string;
  };
  audit: {
    operatorId: string;
    source: "manual" | "assisted" | "auto";
  };
}

export interface VivoFeedbackRaw {
  event: "vivo.feedback.raw";
  timestamp: string;
  correlationId: string;
  symbol: string;
  feedback: {
    entryQuality: number; // -1 to 1
    executionTime: number;
    slippage: number;
    markOut: number;
    expectedR: number;
    actualR: number;
  };
  tags: string[];
  variant: string;
}

export interface TradeSummaryClosed {
  event: "trade.summary.closed";
  timestamp: string;
  correlationId: string;
  symbol: string;
  side: "buy" | "sell";
  pnl: number;
  pnlR: number;
  duration: number;
  entryPrice: number;
  exitPrice: number;
  variant: string;
  operatorInvolved: boolean;
  decisions: Array<{
    type: "entry" | "exit" | "modify";
    timestamp: string;
    operatorChoice?: string;
  }>;
}

// Output Event Types
export interface OperatorConsistencyScoreEvent {
  event: "operator.consistency.score";
  timestamp: string;
  score0to1: number;
  horizonDays: number;
  strengthTags: string[]; // ["improving", "degrading", "stable", "inconsistent"]
  explanations: string[];
  breakdown: {
    hit: { score: number; weight: number; };
    expectancy: { score: number; weight: number; };
    discipline: { score: number; weight: number; };
    latency: { score: number; weight: number; };
  };
  trends: {
    recent7d: number;
    recent30d: number;
    improvement: boolean;
  };
  recommendations: string[];
  flags: {
    needsDialog: boolean;
    lowConfidence: boolean;
    inconsistentBehavior: boolean;
  };
}

// Configuration
export interface ConsistencyConfig {
  horizonDays: number;
  weights: {
    hit: number;
    expectancy: number;
    discipline: number;
    latency: number;
  };
  decayHalfLifeDays: number;
  thresholds: {
    low: number;
    high: number;
    latencyWarnSec: number;
    disciplineWarnRate: number;
  };
  tz: string;
}

// Internal state interfaces
interface OperatorSession {
  sessionId: string;
  operatorId: string;
  startTime: Date;
  endTime?: Date;
  decisions: DecisionRecord[];
  performance: {
    totalDecisions: number;
    acceptRate: number;
    avgDecisionTime: number;
    overrideRate: number;
  };
}

interface DecisionRecord {
  timestamp: Date;
  symbol: string;
  decision: string;
  decisionTime: number;
  overrides: number;
  context: any;
  outcome?: {
    pnlR: number;
    entryQuality: number;
    executionTime: number;
    correlationId: string;
  };
}

interface ConsistencyState {
  sessions: Map<string, OperatorSession>; // sessionId -> session
  decisions: DecisionRecord[]; // Recent decisions within horizon
  feedbackMap: Map<string, VivoFeedbackRaw>; // correlationId -> feedback
  tradeOutcomes: Map<string, TradeSummaryClosed>; // correlationId -> trade
  lastScore: OperatorConsistencyScoreEvent | null;
  stats: {
    totalDecisions: number;
    averageScore: number;
    scoreTrend: number[];
    lastCalculation: Date | null;
  };
}

export interface StdError { code:string; message:string; details?:Record<string,unknown>; retriable?:boolean; }

export class OperatorConsistencyScore extends EventEmitter {
  ver="1.0.0"; src="VIVO-38";
  private config: ConsistencyConfig;
  private state: ConsistencyState;
  private scoreInterval?: NodeJS.Timeout;

  constructor(config?: Partial<ConsistencyConfig>) {
    super();
    this.config = {
      horizonDays: 30,
      weights: { 
        hit: 0.4, 
        expectancy: 0.3, 
        discipline: 0.2, 
        latency: 0.1 
      },
      decayHalfLifeDays: 7,
      thresholds: { 
        low: 0.4, 
        high: 0.7,
        latencyWarnSec: 30,
        disciplineWarnRate: 0.2
      },
      tz: "Europe/Istanbul",
      ...config
    };

    this.state = {
      sessions: new Map(),
      decisions: [],
      feedbackMap: new Map(),
      tradeOutcomes: new Map(),
      lastScore: null,
      stats: {
        totalDecisions: 0,
        averageScore: 0,
        scoreTrend: [],
        lastCalculation: null
      }
    };

    this.setupCalculationInterval();
  }

  attach(bus: any, logger: any) {
    bus.on("operator.choice.log", (data: any) => this.handleOperatorChoice(data, logger));
    bus.on("vivo.feedback.raw", (data: any) => this.handleVivoFeedback(data, logger));
    bus.on("trade.summary.closed", (data: any) => this.handleTradeClosed(data, bus, logger));
  }

  private handleOperatorChoice(data: any, logger: any): void {
    try {
      if (data.event !== "operator.choice.log") return;
      
      const choice = data as OperatorChoiceLog;
      this.recordOperatorDecision(choice, logger);

    } catch (error: any) {
      if (logger) logger.error({ error: error.message }, "Operator choice handling failed");
    }
  }

  private handleVivoFeedback(data: any, logger: any): void {
    try {
      if (data.event !== "vivo.feedback.raw") return;
      
      const feedback = data as VivoFeedbackRaw;
      this.state.feedbackMap.set(feedback.correlationId, feedback);

      // Try to match with existing decisions
      this.matchFeedbackToDecisions(feedback, logger);

    } catch (error: any) {
      if (logger) logger.error({ error: error.message }, "Vivo feedback handling failed");
    }
  }

  private handleTradeClosed(data: any, bus: any, logger: any): void {
    try {
      if (data.event !== "trade.summary.closed") return;
      
      const trade = data as TradeSummaryClosed;
      this.state.tradeOutcomes.set(trade.correlationId, trade);

      // Try to match with existing decisions
      this.matchTradeToDecisions(trade, logger);

      // Trigger score calculation if operator was involved
      if (trade.operatorInvolved) {
        this.calculateConsistencyScore(bus, logger);
      }

    } catch (error: any) {
      if (logger) logger.error({ error: error.message }, "Trade closed handling failed");
    }
  }

  private recordOperatorDecision(choice: OperatorChoiceLog, logger: any): void {
    const decision: DecisionRecord = {
      timestamp: new Date(choice.timestamp),
      symbol: choice.symbol,
      decision: choice.decision,
      decisionTime: choice.context.timeToDecision,
      overrides: choice.overrides.length,
      context: choice.context
    };

    // Add to decisions array
    this.state.decisions.push(decision);

    // Maintain session tracking
    let session = this.state.sessions.get(choice.context.sessionId);
    if (!session) {
      session = {
        sessionId: choice.context.sessionId,
        operatorId: choice.audit.operatorId,
        startTime: new Date(choice.timestamp),
        decisions: [],
        performance: {
          totalDecisions: 0,
          acceptRate: 0,
          avgDecisionTime: 0,
          overrideRate: 0
        }
      };
      this.state.sessions.set(choice.context.sessionId, session);
    }

    session.decisions.push(decision);
    this.updateSessionPerformance(session);

    // Clean old decisions beyond horizon
    this.cleanOldDecisions();

    this.state.stats.totalDecisions++;

    if (logger) logger.debug({ 
      decision: choice.decision,
      symbol: choice.symbol,
      decisionTime: choice.context.timeToDecision,
      overrides: choice.overrides.length
    }, "Operator decision recorded");
  }

  private matchFeedbackToDecisions(feedback: VivoFeedbackRaw, logger: any): void {
    // Find decisions that might match this feedback
    const recentDecisions = this.state.decisions.filter(d => 
      d.symbol === feedback.symbol && 
      !d.outcome &&
      Math.abs(new Date(feedback.timestamp).getTime() - d.timestamp.getTime()) < 600000 // 10 minutes
    );

    if (recentDecisions.length > 0) {
      // Match to the most recent decision
      const decision = recentDecisions[recentDecisions.length - 1];
      decision.outcome = {
        pnlR: feedback.feedback.actualR,
        entryQuality: feedback.feedback.entryQuality,
        executionTime: feedback.feedback.executionTime,
        correlationId: feedback.correlationId
      };

      if (logger) logger.debug({ 
        correlationId: feedback.correlationId,
        symbol: feedback.symbol,
        entryQuality: feedback.feedback.entryQuality
      }, "Feedback matched to decision");
    }
  }

  private matchTradeToDecisions(trade: TradeSummaryClosed, logger: any): void {
    // Find decisions that match this trade
    const matchingDecisions = this.state.decisions.filter(d => 
      d.symbol === trade.symbol &&
      (!d.outcome || d.outcome.correlationId === trade.correlationId)
    );

    for (const decision of matchingDecisions) {
      if (!decision.outcome) {
        decision.outcome = {
          pnlR: trade.pnlR,
          entryQuality: 0, // Will be filled by feedback if available
          executionTime: 0,
          correlationId: trade.correlationId
        };
      } else if (decision.outcome.correlationId === trade.correlationId) {
        decision.outcome.pnlR = trade.pnlR;
      }
    }
  }

  private updateSessionPerformance(session: OperatorSession): void {
    const decisions = session.decisions;
    session.performance.totalDecisions = decisions.length;
    
    const acceptCount = decisions.filter(d => d.decision === "accept").length;
    session.performance.acceptRate = acceptCount / decisions.length;
    
    session.performance.avgDecisionTime = decisions.reduce((sum, d) => sum + d.decisionTime, 0) / decisions.length;
    
    const overrideCount = decisions.filter(d => d.overrides > 0).length;
    session.performance.overrideRate = overrideCount / decisions.length;
  }

  private cleanOldDecisions(): void {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - this.config.horizonDays);

    this.state.decisions = this.state.decisions.filter(d => d.timestamp >= cutoff);

    // Clean old sessions
    for (const [sessionId, session] of this.state.sessions.entries()) {
      if (session.endTime && session.endTime < cutoff) {
        this.state.sessions.delete(sessionId);
      }
    }

    // Clean old feedback and trades
    const recentCorrelationIds = new Set(
      this.state.decisions
        .filter(d => d.outcome)
        .map(d => d.outcome!.correlationId)
    );

    for (const correlationId of this.state.feedbackMap.keys()) {
      if (!recentCorrelationIds.has(correlationId)) {
        this.state.feedbackMap.delete(correlationId);
      }
    }

    for (const correlationId of this.state.tradeOutcomes.keys()) {
      if (!recentCorrelationIds.has(correlationId)) {
        this.state.tradeOutcomes.delete(correlationId);
      }
    }
  }

  private setupCalculationInterval(): void {
    // Calculate score every 5 minutes
    this.scoreInterval = setInterval(() => {
      this.calculateConsistencyScore(null, null);
    }, 5 * 60 * 1000);
  }

  private calculateConsistencyScore(bus: any, logger: any): void {
    try {
      if (this.state.decisions.length < 10) {
        // Not enough data
        return;
      }

      const scores = this.calculateSubScores();
      const strengthTags = this.calculateStrengthTags(scores);
      const trends = this.calculateTrends();
      const recommendations = this.generateRecommendations(scores, trends);
      const flags = this.calculateFlags(scores, trends);

      // Calculate weighted overall score
      const overallScore = (
        scores.hit.score * this.config.weights.hit +
        scores.expectancy.score * this.config.weights.expectancy +
        scores.discipline.score * this.config.weights.discipline +
        scores.latency.score * this.config.weights.latency
      );

      const consistencyScore: OperatorConsistencyScoreEvent = {
        event: "operator.consistency.score",
        timestamp: new Date().toISOString(),
        score0to1: Math.max(0, Math.min(1, overallScore)),
        horizonDays: this.config.horizonDays,
        strengthTags,
        explanations: this.generateExplanations(scores, trends),
        breakdown: scores,
        trends,
        recommendations,
        flags
      };

      this.state.lastScore = consistencyScore;
      this.state.stats.averageScore = overallScore;
      this.state.stats.scoreTrend.push(overallScore);
      this.state.stats.lastCalculation = new Date();

      // Keep only last 30 trend points
      if (this.state.stats.scoreTrend.length > 30) {
        this.state.stats.scoreTrend = this.state.stats.scoreTrend.slice(-30);
      }

      this.emit("operator.consistency.score", consistencyScore);
      if (bus) bus.emit("operator.consistency.score", consistencyScore);

      if (logger) logger.info({ 
        score: overallScore.toFixed(3),
        strengthTags,
        flags: Object.entries(flags).filter(([k, v]) => v).map(([k]) => k)
      }, "Consistency score calculated");

    } catch (error: any) {
      if (logger) logger.error({ error: error.message }, "Consistency score calculation failed");
    }
  }

  private calculateSubScores(): any {
    const decisionsWithOutcomes = this.state.decisions.filter(d => d.outcome);
    const now = new Date();

    // Hit rate score (profitable decisions)
    const profitableDecisions = decisionsWithOutcomes.filter(d => d.outcome!.pnlR > 0);
    const hitRate = decisionsWithOutcomes.length > 0 ? profitableDecisions.length / decisionsWithOutcomes.length : 0;
    const hitScore = Math.min(hitRate * 2, 1); // Scale 50% hit rate to 1.0

    // Expectancy score (average R)
    const avgR = decisionsWithOutcomes.length > 0 ? 
      decisionsWithOutcomes.reduce((sum, d) => sum + d.outcome!.pnlR, 0) / decisionsWithOutcomes.length : 0;
    const expectancyScore = Math.max(0, Math.min(1, (avgR + 0.5) / 1.0)); // -0.5 to 0.5 R mapped to 0-1

    // Discipline score (consistency in decision time and override rate)
    const avgDecisionTime = this.state.decisions.reduce((sum, d) => sum + d.decisionTime, 0) / this.state.decisions.length;
    const decisionTimeVariance = this.calculateVariance(this.state.decisions.map(d => d.decisionTime));
    const decisionTimeScore = Math.max(0, 1 - (Math.sqrt(decisionTimeVariance) / 30)); // Penalize high variance

    const overrideRate = this.state.decisions.filter(d => d.overrides > 0).length / this.state.decisions.length;
    const overrideScore = Math.max(0, 1 - (overrideRate / this.config.thresholds.disciplineWarnRate));

    const disciplineScore = (decisionTimeScore * 0.6 + overrideScore * 0.4);

    // Latency score (fast decision making)
    const latencyScore = Math.max(0, 1 - (avgDecisionTime / this.config.thresholds.latencyWarnSec));

    return {
      hit: { score: hitScore, weight: this.config.weights.hit },
      expectancy: { score: expectancyScore, weight: this.config.weights.expectancy },
      discipline: { score: disciplineScore, weight: this.config.weights.discipline },
      latency: { score: latencyScore, weight: this.config.weights.latency }
    };
  }

  private calculateStrengthTags(scores: any): string[] {
    const tags: string[] = [];

    const overallScore = (
      scores.hit.score * scores.hit.weight +
      scores.expectancy.score * scores.expectancy.weight +
      scores.discipline.score * scores.discipline.weight +
      scores.latency.score * scores.latency.weight
    );

    if (overallScore >= this.config.thresholds.high) {
      tags.push("stable");
    } else if (overallScore <= this.config.thresholds.low) {
      tags.push("inconsistent");
    }

    // Check for improvement trend
    if (this.state.stats.scoreTrend.length >= 5) {
      const recent = this.state.stats.scoreTrend.slice(-5);
      const earlier = this.state.stats.scoreTrend.slice(-10, -5);
      
      if (earlier.length === 5) {
        const recentAvg = recent.reduce((a, b) => a + b) / recent.length;
        const earlierAvg = earlier.reduce((a, b) => a + b) / earlier.length;
        
        if (recentAvg > earlierAvg + 0.05) {
          tags.push("improving");
        } else if (recentAvg < earlierAvg - 0.05) {
          tags.push("degrading");
        }
      }
    }

    // Check individual component strengths
    if (scores.hit.score >= 0.8) tags.push("strong_hit");
    if (scores.expectancy.score >= 0.8) tags.push("strong_expectancy");
    if (scores.discipline.score >= 0.8) tags.push("disciplined");
    if (scores.latency.score >= 0.8) tags.push("responsive");

    return tags;
  }

  private calculateTrends(): any {
    const recent7dDecisions = this.state.decisions.filter(d => {
      const age = (new Date().getTime() - d.timestamp.getTime()) / (1000 * 60 * 60 * 24);
      return age <= 7;
    });

    const recent30dDecisions = this.state.decisions;

    const recent7dScore = recent7dDecisions.length > 0 ? this.calculateScoreForDecisions(recent7dDecisions) : 0;
    const recent30dScore = recent30dDecisions.length > 0 ? this.calculateScoreForDecisions(recent30dDecisions) : 0;

    return {
      recent7d: recent7dScore,
      recent30d: recent30dScore,
      improvement: recent7dScore > recent30dScore + 0.05
    };
  }

  private calculateScoreForDecisions(decisions: DecisionRecord[]): number {
    if (decisions.length === 0) return 0;

    const decisionsWithOutcomes = decisions.filter(d => d.outcome);
    if (decisionsWithOutcomes.length === 0) return 0;

    const hitRate = decisionsWithOutcomes.filter(d => d.outcome!.pnlR > 0).length / decisionsWithOutcomes.length;
    const avgR = decisionsWithOutcomes.reduce((sum, d) => sum + d.outcome!.pnlR, 0) / decisionsWithOutcomes.length;

    return Math.min(1, hitRate * 0.6 + Math.max(0, avgR + 0.5) * 0.4);
  }

  private generateRecommendations(scores: any, trends: any): string[] {
    const recommendations: string[] = [];

    if (scores.hit.score < 0.5) {
      recommendations.push("review_signal_quality");
    }

    if (scores.expectancy.score < 0.4) {
      recommendations.push("improve_risk_reward");
    }

    if (scores.discipline.score < 0.6) {
      recommendations.push("standardize_decision_process");
    }

    if (scores.latency.score < 0.5) {
      recommendations.push("reduce_decision_time");
    }

    if (trends.recent7d < trends.recent30d - 0.1) {
      recommendations.push("analyze_recent_performance");
    }

    if (!trends.improvement && scores.hit.score + scores.expectancy.score < 1.0) {
      recommendations.push("consider_training");
    }

    return recommendations;
  }

  private generateExplanations(scores: any, trends: any): string[] {
    const explanations: string[] = [];

    explanations.push(`Hit rate: ${(scores.hit.score * 100).toFixed(1)}% (weight: ${scores.hit.weight})`);
    explanations.push(`Expectancy: ${(scores.expectancy.score * 100).toFixed(1)}% (weight: ${scores.expectancy.weight})`);
    explanations.push(`Discipline: ${(scores.discipline.score * 100).toFixed(1)}% (weight: ${scores.discipline.weight})`);
    explanations.push(`Response time: ${(scores.latency.score * 100).toFixed(1)}% (weight: ${scores.latency.weight})`);

    if (trends.improvement) {
      explanations.push("Recent 7-day performance shows improvement");
    } else if (trends.recent7d < trends.recent30d - 0.05) {
      explanations.push("Recent 7-day performance below 30-day average");
    }

    return explanations;
  }

  private calculateFlags(scores: any, trends: any): any {
    const overallScore = (
      scores.hit.score * scores.hit.weight +
      scores.expectancy.score * scores.expectancy.weight +
      scores.discipline.score * scores.discipline.weight +
      scores.latency.score * scores.latency.weight
    );

    return {
      needsDialog: overallScore < this.config.thresholds.low,
      lowConfidence: scores.hit.score < 0.3 || scores.expectancy.score < 0.2,
      inconsistentBehavior: scores.discipline.score < 0.4
    };
  }

  private calculateVariance(values: number[]): number {
    if (values.length === 0) return 0;
    
    const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
    const squaredDiffs = values.map(val => Math.pow(val - mean, 2));
    return squaredDiffs.reduce((sum, val) => sum + val, 0) / values.length;
  }

  // Public methods
  getStatus(): any {
    return {
      activeSessions: this.state.sessions.size,
      totalDecisions: this.state.stats.totalDecisions,
      decisionsInHorizon: this.state.decisions.length,
      decisionsWithOutcomes: this.state.decisions.filter(d => d.outcome).length,
      lastScore: this.state.lastScore?.score0to1 || null,
      lastCalculation: this.state.stats.lastCalculation,
      scoreTrend: this.state.stats.scoreTrend.slice(-10), // Last 10 scores
      config: {
        horizonDays: this.config.horizonDays,
        thresholds: this.config.thresholds,
        weights: this.config.weights
      }
    };
  }

  updateConfig(updates: Partial<ConsistencyConfig>): void {
    this.config = { ...this.config, ...updates };
  }

  // Force score calculation (for testing)
  forceCalculation(bus: any, logger: any): void {
    this.calculateConsistencyScore(bus, logger);
  }

  // Get current score without recalculation
  getCurrentScore(): OperatorConsistencyScoreEvent | null {
    return this.state.lastScore;
  }

  // Cleanup
  shutdown(): void {
    if (this.scoreInterval) {
      clearInterval(this.scoreInterval);
    }
  }
}
