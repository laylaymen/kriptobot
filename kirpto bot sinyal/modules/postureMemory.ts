/**
 * Posture Memory - VIVO-04
 * Geçmiş plan performanslarını ve piyasa koşullarını analiz ederek
 * hangi planın (A/B/C) hangi piyasa durumunda daha başarılı olduğunu öğrenir
 */

import { EventEmitter } from 'events';

export interface MarketCondition {
    timestamp: string;
    volatility: "LOW" | "MEDIUM" | "HIGH" | "EXTREME";
    trend: "BULLISH" | "BEARISH" | "SIDEWAYS" | "CHOPPY";
    volume: "LOW" | "NORMAL" | "HIGH" | "MASSIVE";
    sentiment: "FEAR" | "GREED" | "NEUTRAL" | "PANIC";
    news: "POSITIVE" | "NEGATIVE" | "NEUTRAL" | "MIXED";
    correlations: "HIGH" | "MEDIUM" | "LOW" | "DIVERGING"; // asset korelasyonları
}

export interface PlanExecution {
    sessionId: string;
    planId: "A" | "B" | "C";
    timestamp: string;
    symbols: string[];
    totalNotionalUsd: number;
    entryType: "MARKET" | "LIMIT" | "IOC" | "POST_ONLY";
    marketCondition: MarketCondition;
    outcome: PlanOutcome;
}

export interface PlanOutcome {
    status: "COMPLETED" | "PARTIAL" | "FAILED" | "CANCELLED";
    executionTimeMs: number;
    fillRate: number;           // [0..1] ne kadarı gerçekleşti
    avgSlippageBps: number;     // ortalama slippage
    realizedPnlUsd: number;     // gerçekleşen P&L
    unrealizedPnlUsd?: number;  // henüz açık pozisyonlar
    maxDrawdownPct: number;     // maksimum düşüş
    sharpeRatio?: number;       // risk-adjusted return
    fees: number;               // komisyon maliyetleri
    notes?: string[];
}

export interface MemoryRecord {
    conditionHash: string;      // piyasa koşulu özeti hash'i
    planPerformance: Record<"A" | "B" | "C", PlanStats>;
    lastUpdated: string;
    sampleCount: number;
    confidence: number;         // [0..1] güven seviyesi
}

export interface PlanStats {
    totalExecutions: number;
    successRate: number;        // [0..1] başarılı execution oranı
    avgPnlUsd: number;
    avgFillRate: number;
    avgSlippageBps: number;
    avgExecutionTimeMs: number;
    avgSharpeRatio?: number;
    bestOutcome?: PlanOutcome;
    worstOutcome?: PlanOutcome;
    lastExecution?: string;     // timestamp
}

export interface MemoryQuery {
    currentCondition: MarketCondition;
    symbols?: string[];         // hangi semboller için tavsiye
    riskTolerance: "LOW" | "MEDIUM" | "HIGH";
    lookbackDays?: number;      // varsayılan 30 gün
    minConfidence?: number;     // varsayılan 0.6
}

export interface MemoryRecommendation {
    recommendedPlan: "A" | "B" | "C" | "MIXED" | "NONE";
    confidence: number;         // [0..1]
    reasoning: string[];
    alternativePlans?: Array<{
        planId: "A" | "B" | "C";
        score: number;
        pros: string[];
        cons: string[];
    }>;
    marketAnalysis: {
        conditionMatch: number;  // mevcut koşulların geçmişle eşleşme oranı
        volatilityTrend: "INCREASING" | "DECREASING" | "STABLE";
        riskLevel: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
    };
    timestamp: string;
}

export interface MemoryInput {
    query?: MemoryQuery;
    execution?: PlanExecution;  // yeni execution kaydı (öğrenme)
    operation: "LEARN" | "RECOMMEND" | "ANALYZE" | "EXPORT";
}

export interface MemoryError { 
    code: string; 
    message: string; 
    details?: Record<string, unknown>; 
    retriable?: boolean; 
}

class PostureMemory extends EventEmitter {
    private ver = "1.0.0";
    private src = "VIVO-04";
    private logger: any;
    private isInitialized: boolean = false;
    private memoryStore = new Map<string, MemoryRecord>();
    private executionHistory: PlanExecution[] = [];
    private maxHistorySize = 10000;

    constructor() {
        super();
    }

    async initialize(logger: any): Promise<boolean> {
        try {
            this.logger = logger;
            this.logger.info('PostureMemory initializing...');
            
            // Load existing memory from storage (mock implementation)
            await this.loadMemoryFromStorage();
            
            this.isInitialized = true;
            this.logger.info('PostureMemory initialized successfully');
            return true;
        } catch (error) {
            this.logger.error('PostureMemory initialization error:', error);
            return false;
        }
    }

    private async loadMemoryFromStorage(): Promise<void> {
        // Mock data loading - in production this would load from database/file
        this.logger.info('Loading memory data...');
        
        // Initialize with some sample memory records
        const sampleCondition: MarketCondition = {
            timestamp: new Date().toISOString(),
            volatility: "MEDIUM",
            trend: "BULLISH",
            volume: "HIGH",
            sentiment: "GREED",
            news: "POSITIVE",
            correlations: "HIGH"
        };

        const conditionHash = this.hashCondition(sampleCondition);
        this.memoryStore.set(conditionHash, {
            conditionHash,
            planPerformance: {
                A: {
                    totalExecutions: 15,
                    successRate: 0.73,
                    avgPnlUsd: 1250.50,
                    avgFillRate: 0.92,
                    avgSlippageBps: 2.3,
                    avgExecutionTimeMs: 1800,
                    avgSharpeRatio: 1.45
                },
                B: {
                    totalExecutions: 12,
                    successRate: 0.83,
                    avgPnlUsd: 890.20,
                    avgFillRate: 0.95,
                    avgSlippageBps: 1.8,
                    avgExecutionTimeMs: 2100,
                    avgSharpeRatio: 1.72
                },
                C: {
                    totalExecutions: 8,
                    successRate: 0.62,
                    avgPnlUsd: 2100.80,
                    avgFillRate: 0.88,
                    avgSlippageBps: 4.1,
                    avgExecutionTimeMs: 1200,
                    avgSharpeRatio: 1.20
                }
            },
            lastUpdated: new Date().toISOString(),
            sampleCount: 35,
            confidence: 0.78
        });
    }

    async run(x: MemoryInput): Promise<MemoryRecommendation | { learned: boolean } | { error: MemoryError }> {
        if (!this.isInitialized) {
            return this.err("NOT_INITIALIZED", "Module not initialized");
        }

        try {
            switch (x.operation) {
                case "LEARN":
                    if (!x.execution) {
                        return this.err("MISSING_EXECUTION", "Execution data required for LEARN operation");
                    }
                    return await this.learnFromExecution(x.execution);

                case "RECOMMEND":
                    if (!x.query) {
                        return this.err("MISSING_QUERY", "Query data required for RECOMMEND operation");
                    }
                    return await this.generateRecommendation(x.query);

                case "ANALYZE":
                    return await this.analyzeMemoryPatterns();

                case "EXPORT":
                    return await this.exportMemoryData();

                default:
                    return this.err("INVALID_OPERATION", `Unknown operation: ${x.operation}`);
            }

        } catch (e: any) {
            return this.err("MEMORY_FAILED", e?.message || "unknown", { stack: e?.stack });
        }
    }

    private async learnFromExecution(execution: PlanExecution): Promise<{ learned: boolean }> {
        // Add to execution history
        this.executionHistory.push(execution);
        if (this.executionHistory.length > this.maxHistorySize) {
            this.executionHistory.shift(); // Remove oldest
        }

        // Update memory records
        const conditionHash = this.hashCondition(execution.marketCondition);
        let record = this.memoryStore.get(conditionHash);

        if (!record) {
            record = {
                conditionHash,
                planPerformance: {
                    A: this.createEmptyStats(),
                    B: this.createEmptyStats(),
                    C: this.createEmptyStats()
                },
                lastUpdated: new Date().toISOString(),
                sampleCount: 0,
                confidence: 0
            };
        }

        // Update plan stats
        const planStats = record.planPerformance[execution.planId];
        this.updatePlanStats(planStats, execution);
        record.sampleCount++;
        record.confidence = Math.min(0.95, record.sampleCount / 50); // Confidence increases with sample size
        record.lastUpdated = new Date().toISOString();

        this.memoryStore.set(conditionHash, record);

        this.logger.info({ 
            sessionId: execution.sessionId, 
            planId: execution.planId, 
            confidence: record.confidence 
        }, "Learned from execution");

        this.emit('memory.learned', { execution, record });

        // Persist to storage (mock)
        await this.saveMemoryToStorage();

        return { learned: true };
    }

    private async generateRecommendation(query: MemoryQuery): Promise<MemoryRecommendation> {
        const conditionHash = this.hashCondition(query.currentCondition);
        const record = this.memoryStore.get(conditionHash);

        if (!record || record.confidence < (query.minConfidence || 0.6)) {
            return this.generateFallbackRecommendation(query);
        }

        // Score each plan based on performance metrics
        const planScores = this.scorePlans(record, query);
        const topPlan = planScores[0];

        const recommendation: MemoryRecommendation = {
            recommendedPlan: topPlan.planId,
            confidence: Math.min(record.confidence, topPlan.score),
            reasoning: this.generateReasoning(topPlan, record),
            alternativePlans: planScores.slice(1),
            marketAnalysis: {
                conditionMatch: this.calculateConditionMatch(query.currentCondition),
                volatilityTrend: this.analyzeVolatilityTrend(query.currentCondition),
                riskLevel: this.assessRiskLevel(query.currentCondition, query.riskTolerance)
            },
            timestamp: new Date().toISOString()
        };

        this.emit('memory.recommendation', recommendation);
        return recommendation;
    }

    private generateFallbackRecommendation(query: MemoryQuery): MemoryRecommendation {
        // Conservative fallback when insufficient data
        let recommendedPlan: "A" | "B" | "C" = "B"; // Default to middle-ground plan

        if (query.riskTolerance === "LOW") {
            recommendedPlan = "A"; // Assume plan A is most conservative
        } else if (query.riskTolerance === "HIGH") {
            recommendedPlan = "C"; // Assume plan C is most aggressive
        }

        return {
            recommendedPlan,
            confidence: 0.3, // Low confidence fallback
            reasoning: [
                "Insufficient historical data for this market condition",
                `Fallback to plan ${recommendedPlan} based on risk tolerance: ${query.riskTolerance}`,
                "Recommendation will improve as more execution data is collected"
            ],
            marketAnalysis: {
                conditionMatch: 0.2,
                volatilityTrend: "STABLE",
                riskLevel: this.assessRiskLevel(query.currentCondition, query.riskTolerance)
            },
            timestamp: new Date().toISOString()
        };
    }

    private scorePlans(record: MemoryRecord, query: MemoryQuery): Array<{
        planId: "A" | "B" | "C";
        score: number;
        pros: string[];
        cons: string[];
    }> {
        const results: Array<{ planId: "A" | "B" | "C"; score: number; pros: string[]; cons: string[]; }> = [];

        for (const [planId, stats] of Object.entries(record.planPerformance)) {
            const id = planId as "A" | "B" | "C";
            let score = 0;

            // Weight factors based on risk tolerance
            const successWeight = query.riskTolerance === "LOW" ? 0.4 : 0.3;
            const pnlWeight = 0.3;
            const fillWeight = 0.2;
            const sharpeWeight = query.riskTolerance === "HIGH" ? 0.1 : 0.2;

            score += stats.successRate * successWeight;
            score += Math.max(0, stats.avgPnlUsd / 1000) * pnlWeight; // Normalize P&L
            score += stats.avgFillRate * fillWeight;
            score += (stats.avgSharpeRatio || 1) / 2 * sharpeWeight; // Normalize Sharpe

            const pros: string[] = [];
            const cons: string[] = [];

            if (stats.successRate > 0.8) pros.push("High success rate");
            if (stats.avgPnlUsd > 1000) pros.push("Strong profit performance");
            if (stats.avgFillRate > 0.9) pros.push("Excellent fill rate");
            if (stats.avgSlippageBps < 3) pros.push("Low slippage");

            if (stats.successRate < 0.6) cons.push("Below average success rate");
            if (stats.avgSlippageBps > 5) cons.push("High slippage risk");
            if (stats.totalExecutions < 10) cons.push("Limited sample size");

            results.push({ planId: id, score, pros, cons });
        }

        return results.sort((a, b) => b.score - a.score);
    }

    private generateReasoning(topPlan: any, record: MemoryRecord): string[] {
        const stats = record.planPerformance[topPlan.planId];
        const reasoning: string[] = [];

        reasoning.push(`Plan ${topPlan.planId} has the highest score (${(topPlan.score * 100).toFixed(1)}%) for current market conditions`);
        reasoning.push(`Historical success rate: ${(stats.successRate * 100).toFixed(1)}% over ${stats.totalExecutions} executions`);
        reasoning.push(`Average P&L: $${stats.avgPnlUsd.toFixed(2)} with ${stats.avgSlippageBps.toFixed(1)}bps slippage`);
        
        if (stats.avgSharpeRatio && stats.avgSharpeRatio > 1.5) {
            reasoning.push(`Strong risk-adjusted returns (Sharpe: ${stats.avgSharpeRatio.toFixed(2)})`);
        }

        return reasoning;
    }

    private hashCondition(condition: MarketCondition): string {
        // Create a hash representing similar market conditions
        const key = `${condition.volatility}_${condition.trend}_${condition.volume}_${condition.sentiment}`;
        return Buffer.from(key).toString('base64').substring(0, 16);
    }

    private createEmptyStats(): PlanStats {
        return {
            totalExecutions: 0,
            successRate: 0,
            avgPnlUsd: 0,
            avgFillRate: 0,
            avgSlippageBps: 0,
            avgExecutionTimeMs: 0
        };
    }

    private updatePlanStats(stats: PlanStats, execution: PlanExecution): void {
        const oldCount = stats.totalExecutions;
        const newCount = oldCount + 1;

        // Update running averages
        stats.avgPnlUsd = (stats.avgPnlUsd * oldCount + execution.outcome.realizedPnlUsd) / newCount;
        stats.avgFillRate = (stats.avgFillRate * oldCount + execution.outcome.fillRate) / newCount;
        stats.avgSlippageBps = (stats.avgSlippageBps * oldCount + execution.outcome.avgSlippageBps) / newCount;
        stats.avgExecutionTimeMs = (stats.avgExecutionTimeMs * oldCount + execution.outcome.executionTimeMs) / newCount;

        if (execution.outcome.sharpeRatio) {
            stats.avgSharpeRatio = ((stats.avgSharpeRatio || 0) * oldCount + execution.outcome.sharpeRatio) / newCount;
        }

        // Update success rate
        const isSuccess = execution.outcome.status === "COMPLETED" && execution.outcome.fillRate > 0.8;
        stats.successRate = (stats.successRate * oldCount + (isSuccess ? 1 : 0)) / newCount;

        stats.totalExecutions = newCount;
        stats.lastExecution = execution.timestamp;

        // Update best/worst outcomes
        if (!stats.bestOutcome || execution.outcome.realizedPnlUsd > stats.bestOutcome.realizedPnlUsd) {
            stats.bestOutcome = execution.outcome;
        }
        if (!stats.worstOutcome || execution.outcome.realizedPnlUsd < stats.worstOutcome.realizedPnlUsd) {
            stats.worstOutcome = execution.outcome;
        }
    }

    private calculateConditionMatch(condition: MarketCondition): number {
        // Calculate how well current conditions match historical data
        const similarConditions = Array.from(this.memoryStore.values()).filter(record => {
            // This is a simplified match - in reality would use more sophisticated comparison
            return record.sampleCount > 5;
        });

        return similarConditions.length > 0 ? 0.8 : 0.2; // Mock implementation
    }

    private analyzeVolatilityTrend(condition: MarketCondition): "INCREASING" | "DECREASING" | "STABLE" {
        // Mock volatility trend analysis
        if (condition.volatility === "EXTREME" || condition.volume === "MASSIVE") {
            return "INCREASING";
        } else if (condition.volatility === "LOW" && condition.volume === "LOW") {
            return "DECREASING";
        }
        return "STABLE";
    }

    private assessRiskLevel(condition: MarketCondition, tolerance: string): "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" {
        let riskScore = 0;

        if (condition.volatility === "EXTREME") riskScore += 3;
        else if (condition.volatility === "HIGH") riskScore += 2;
        else if (condition.volatility === "MEDIUM") riskScore += 1;

        if (condition.sentiment === "PANIC") riskScore += 2;
        else if (condition.sentiment === "FEAR") riskScore += 1;

        if (condition.news === "NEGATIVE") riskScore += 1;

        if (tolerance === "LOW" && riskScore >= 2) riskScore += 1;

        if (riskScore >= 5) return "CRITICAL";
        if (riskScore >= 3) return "HIGH";
        if (riskScore >= 1) return "MEDIUM";
        return "LOW";
    }

    private async analyzeMemoryPatterns(): Promise<any> {
        const analysis = {
            totalRecords: this.memoryStore.size,
            totalExecutions: this.executionHistory.length,
            averageConfidence: 0,
            planSuccessRates: { A: 0, B: 0, C: 0 },
            marketConditionDistribution: {},
            timestamp: new Date().toISOString()
        };

        // Calculate average confidence and plan performance
        let totalConfidence = 0;
        const planStats: { A: number[], B: number[], C: number[] } = { A: [], B: [], C: [] };

        for (const record of this.memoryStore.values()) {
            totalConfidence += record.confidence;
            planStats.A.push(record.planPerformance.A.successRate);
            planStats.B.push(record.planPerformance.B.successRate);
            planStats.C.push(record.planPerformance.C.successRate);
        }

        analysis.averageConfidence = totalConfidence / this.memoryStore.size;
        analysis.planSuccessRates.A = planStats.A.reduce((a, b) => a + b, 0) / planStats.A.length;
        analysis.planSuccessRates.B = planStats.B.reduce((a, b) => a + b, 0) / planStats.B.length;
        analysis.planSuccessRates.C = planStats.C.reduce((a, b) => a + b, 0) / planStats.C.length;

        return analysis;
    }

    private async exportMemoryData(): Promise<any> {
        return {
            memoryRecords: Array.from(this.memoryStore.entries()),
            executionHistory: this.executionHistory.slice(-100), // Last 100 executions
            metadata: {
                exportTime: new Date().toISOString(),
                version: this.ver,
                totalRecords: this.memoryStore.size
            }
        };
    }

    private async saveMemoryToStorage(): Promise<void> {
        // Mock implementation - in production would save to database/file
        this.logger.debug('Memory data saved to storage');
    }

    // --- Hata ---
    private err(code: string, message: string, details?: any): { error: MemoryError } {
        const e = { code, message, details, retriable: false };
        this.logger?.error({ code, details }, message);
        this.emit('audit.log', { 
            asOf: new Date().toISOString(), 
            ver: this.ver, 
            src: this.src, 
            payload: { error: e } 
        });
        return { error: e };
    }

    /**
     * Get module status
     */
    getStatus(): any {
        return {
            name: 'PostureMemory',
            version: this.ver,
            initialized: this.isInitialized,
            memoryRecords: this.memoryStore.size,
            executionHistory: this.executionHistory.length,
            memoryUtilization: `${((this.executionHistory.length / this.maxHistorySize) * 100).toFixed(1)}%`
        };
    }

    async shutdown(): Promise<void> {
        try {
            this.logger?.info('PostureMemory shutting down...');
            await this.saveMemoryToStorage();
            this.memoryStore.clear();
            this.executionHistory = [];
            this.removeAllListeners();
            this.isInitialized = false;
            this.logger?.info('PostureMemory shutdown complete');
        } catch (error) {
            this.logger?.error('PostureMemory shutdown error:', error);
        }
    }
}

export default PostureMemory;
