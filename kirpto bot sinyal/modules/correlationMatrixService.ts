/**
 * Correlation Matrix Service - PFL-02
 * Continuous correlation & beta matrix generation for portfolio analysis
 * Provides correlation alerts and cluster utilization metrics
 */

import { EventEmitter } from 'events';

interface MarketRefs {
    [symbol: string]: {
        mid: number;
        returns: number[];
        timestamp: string;
    };
}

interface Position {
    symbol: string;
    notional: number;
    side: 'long' | 'short';
    cluster: string;
}

interface PositionsSnapshot {
    positions: Position[];
    totalEquity: number;
}

interface UniverseSnapshot {
    activeSymbols: string[];
    clusterMapping?: Record<string, string>;
}

interface CorrelationSnapshot {
    rho: Record<string, Record<string, number>>;
    betaTo: Record<string, { BTC: number; Market: number }>;
    topPairs: Array<{ symbol1: string; symbol2: string; correlation: number }>;
    clusters: Record<string, { capUtil: number; symbols: string[] }>;
    timestamp: string;
    sampleSize: number;
}

interface CorrelationAlert {
    type: 'high_correlation_cluster' | 'beta_divergence' | 'insufficient_data';
    severity: 'info' | 'warn' | 'error';
    pairs: Array<{ symbol1: string; symbol2: string; correlation: number }>;
    clusters: string[];
    message: string;
    timestamp: string;
}

interface Config {
    windowMin: number;
    stepMin: number;
    minCommonBars: number;
    shrinkage: number;
    alertThreshold: number;
    maxPairs: number;
    betaWindow: number;
}

class CorrelationMatrixService extends EventEmitter {
    private config: Config;
    private logger: any;
    private isInitialized: boolean = false;
    private priceHistory: Map<string, number[]> = new Map();
    private returnHistory: Map<string, number[]> = new Map();
    private lastSnapshot: CorrelationSnapshot | null = null;
    private alertHistory: CorrelationAlert[] = [];

    constructor(config: Partial<Config> = {}) {
        super();
        this.config = {
            windowMin: 240,
            stepMin: 5,
            minCommonBars: 120,
            shrinkage: 0.1,
            alertThreshold: 0.85,
            maxPairs: 50,
            betaWindow: 100,
            ...config
        };
    }

    async initialize(logger: any): Promise<boolean> {
        try {
            this.logger = logger;
            this.logger.info('CorrelationMatrixService initializing...');
            
            this.isInitialized = true;
            this.logger.info('CorrelationMatrixService initialized successfully');
            return true;
        } catch (error) {
            this.logger.error('CorrelationMatrixService initialization error:', error);
            return false;
        }
    }

    /**
     * Main processing function - generates correlation matrix and alerts
     */
    async process(data: {
        marketRefs: MarketRefs;
        universeSnapshot: UniverseSnapshot;
        positionsSnapshot?: PositionsSnapshot;
    }): Promise<{
        snapshot: CorrelationSnapshot;
        alerts: CorrelationAlert[];
    }> {
        if (!this.isInitialized) {
            throw new Error('CorrelationMatrixService not initialized');
        }

        try {
            // Update return history
            this.updateReturnsHistory(data.marketRefs);

            // Calculate correlation matrix
            const correlationMatrix = this.calculateCorrelationMatrix(data.universeSnapshot.activeSymbols);

            // Calculate beta values
            const betaValues = this.calculateBetaValues(data.universeSnapshot.activeSymbols);

            // Find top correlated pairs
            const topPairs = this.findTopCorrelatedPairs(correlationMatrix);

            // Calculate cluster utilization
            const clusters = this.calculateClusterUtilization(
                data.universeSnapshot,
                data.positionsSnapshot,
                correlationMatrix
            );

            // Create snapshot
            const snapshot: CorrelationSnapshot = {
                rho: correlationMatrix,
                betaTo: betaValues,
                topPairs,
                clusters,
                timestamp: new Date().toISOString(),
                sampleSize: this.getMinSampleSize(data.universeSnapshot.activeSymbols)
            };

            // Generate alerts
            const alerts = this.generateAlerts(snapshot, data.universeSnapshot);

            // Cache snapshot
            this.lastSnapshot = snapshot;

            // Emit events
            this.emit('portfolio.correlation.snapshot', snapshot);
            for (const alert of alerts) {
                this.emit('correlation.alert', alert);
            }

            this.logger.info(`CorrelationMatrixService generated snapshot for ${data.universeSnapshot.activeSymbols.length} symbols`);
            return { snapshot, alerts };

        } catch (error) {
            this.logger.error('CorrelationMatrixService processing error:', error);
            throw error;
        }
    }

    private updateReturnsHistory(marketRefs: MarketRefs): void {
        for (const [symbol, data] of Object.entries(marketRefs)) {
            if (!this.priceHistory.has(symbol)) {
                this.priceHistory.set(symbol, []);
                this.returnHistory.set(symbol, []);
            }

            const prices = this.priceHistory.get(symbol)!;
            const returns = this.returnHistory.get(symbol)!;

            // Add new price
            prices.push(data.mid);

            // Calculate return if we have previous price
            if (prices.length > 1) {
                const previousPrice = prices[prices.length - 2];
                const returnValue = (data.mid - previousPrice) / previousPrice;
                returns.push(returnValue);
            }

            // Maintain window size
            if (prices.length > this.config.windowMin) {
                prices.shift();
            }
            if (returns.length > this.config.windowMin - 1) {
                returns.shift();
            }
        }
    }

    private calculateCorrelationMatrix(symbols: string[]): Record<string, Record<string, number>> {
        const matrix: Record<string, Record<string, number>> = {};

        for (const symbol1 of symbols) {
            matrix[symbol1] = {};
            
            for (const symbol2 of symbols) {
                if (symbol1 === symbol2) {
                    matrix[symbol1][symbol2] = 1.0;
                } else {
                    const correlation = this.calculatePairwiseCorrelation(symbol1, symbol2);
                    matrix[symbol1][symbol2] = correlation;
                }
            }
        }

        // Apply Ledoit-Wolf shrinkage
        return this.applyShrinkage(matrix, symbols);
    }

    private calculatePairwiseCorrelation(symbol1: string, symbol2: string): number {
        const returns1 = this.returnHistory.get(symbol1) || [];
        const returns2 = this.returnHistory.get(symbol2) || [];

        if (returns1.length < this.config.minCommonBars || returns2.length < this.config.minCommonBars) {
            return 0; // Insufficient data
        }

        // Align returns by taking the shorter length
        const minLength = Math.min(returns1.length, returns2.length);
        const alignedReturns1 = returns1.slice(-minLength);
        const alignedReturns2 = returns2.slice(-minLength);

        if (minLength < this.config.minCommonBars) {
            return 0;
        }

        // Calculate correlation
        const mean1 = alignedReturns1.reduce((sum, r) => sum + r, 0) / minLength;
        const mean2 = alignedReturns2.reduce((sum, r) => sum + r, 0) / minLength;

        let numerator = 0;
        let sumSq1 = 0;
        let sumSq2 = 0;

        for (let i = 0; i < minLength; i++) {
            const diff1 = alignedReturns1[i] - mean1;
            const diff2 = alignedReturns2[i] - mean2;
            
            numerator += diff1 * diff2;
            sumSq1 += diff1 * diff1;
            sumSq2 += diff2 * diff2;
        }

        const denominator = Math.sqrt(sumSq1 * sumSq2);
        
        if (denominator === 0) {
            return 0;
        }

        return numerator / denominator;
    }

    private applyShrinkage(matrix: Record<string, Record<string, number>>, symbols: string[]): Record<string, Record<string, number>> {
        const shrunkMatrix: Record<string, Record<string, number>> = {};
        const targetCorrelation = this.calculateAverageCorrelation(matrix, symbols);

        for (const symbol1 of symbols) {
            shrunkMatrix[symbol1] = {};
            
            for (const symbol2 of symbols) {
                if (symbol1 === symbol2) {
                    shrunkMatrix[symbol1][symbol2] = 1.0;
                } else {
                    const originalCorr = matrix[symbol1][symbol2];
                    const shrunkCorr = (1 - this.config.shrinkage) * originalCorr + 
                                      this.config.shrinkage * targetCorrelation;
                    shrunkMatrix[symbol1][symbol2] = shrunkCorr;
                }
            }
        }

        return shrunkMatrix;
    }

    private calculateAverageCorrelation(matrix: Record<string, Record<string, number>>, symbols: string[]): number {
        let sum = 0;
        let count = 0;

        for (const symbol1 of symbols) {
            for (const symbol2 of symbols) {
                if (symbol1 !== symbol2) {
                    sum += Math.abs(matrix[symbol1][symbol2]);
                    count++;
                }
            }
        }

        return count > 0 ? sum / count : 0;
    }

    private calculateBetaValues(symbols: string[]): Record<string, { BTC: number; Market: number }> {
        const betaValues: Record<string, { BTC: number; Market: number }> = {};
        
        const btcReturns = this.returnHistory.get('BTCUSDT') || [];
        const marketReturns = this.calculateMarketReturns(symbols);

        for (const symbol of symbols) {
            const symbolReturns = this.returnHistory.get(symbol) || [];
            
            const btcBeta = this.calculateBeta(symbolReturns, btcReturns);
            const marketBeta = this.calculateBeta(symbolReturns, marketReturns);

            betaValues[symbol] = {
                BTC: btcBeta,
                Market: marketBeta
            };
        }

        return betaValues;
    }

    private calculateMarketReturns(symbols: string[]): number[] {
        const marketReturns: number[] = [];
        const allReturns = symbols.map(symbol => this.returnHistory.get(symbol) || []);
        
        if (allReturns.length === 0) return [];

        const minLength = Math.min(...allReturns.map(returns => returns.length));
        
        for (let i = 0; i < minLength; i++) {
            const periodReturns = allReturns.map(returns => returns[returns.length - minLength + i]);
            const averageReturn = periodReturns.reduce((sum, r) => sum + r, 0) / periodReturns.length;
            marketReturns.push(averageReturn);
        }

        return marketReturns;
    }

    private calculateBeta(assetReturns: number[], benchmarkReturns: number[]): number {
        if (assetReturns.length < this.config.minCommonBars || benchmarkReturns.length < this.config.minCommonBars) {
            return 1.0; // Default beta
        }

        const minLength = Math.min(assetReturns.length, benchmarkReturns.length, this.config.betaWindow);
        const alignedAsset = assetReturns.slice(-minLength);
        const alignedBenchmark = benchmarkReturns.slice(-minLength);

        const assetMean = alignedAsset.reduce((sum, r) => sum + r, 0) / minLength;
        const benchmarkMean = alignedBenchmark.reduce((sum, r) => sum + r, 0) / minLength;

        let covariance = 0;
        let benchmarkVariance = 0;

        for (let i = 0; i < minLength; i++) {
            const assetDiff = alignedAsset[i] - assetMean;
            const benchmarkDiff = alignedBenchmark[i] - benchmarkMean;
            
            covariance += assetDiff * benchmarkDiff;
            benchmarkVariance += benchmarkDiff * benchmarkDiff;
        }

        if (benchmarkVariance === 0) {
            return 1.0;
        }

        return covariance / benchmarkVariance;
    }

    private findTopCorrelatedPairs(matrix: Record<string, Record<string, number>>): Array<{ symbol1: string; symbol2: string; correlation: number }> {
        const pairs: Array<{ symbol1: string; symbol2: string; correlation: number }> = [];

        const symbols = Object.keys(matrix);
        for (let i = 0; i < symbols.length; i++) {
            for (let j = i + 1; j < symbols.length; j++) {
                const symbol1 = symbols[i];
                const symbol2 = symbols[j];
                const correlation = Math.abs(matrix[symbol1][symbol2]);
                
                pairs.push({ symbol1, symbol2, correlation });
            }
        }

        // Sort by correlation and take top pairs
        pairs.sort((a, b) => b.correlation - a.correlation);
        return pairs.slice(0, this.config.maxPairs);
    }

    private calculateClusterUtilization(
        universe: UniverseSnapshot,
        positions?: PositionsSnapshot,
        correlationMatrix?: Record<string, Record<string, number>>
    ): Record<string, { capUtil: number; symbols: string[] }> {
        const clusters: Record<string, { capUtil: number; symbols: string[] }> = {};

        // Group symbols by cluster
        for (const symbol of universe.activeSymbols) {
            const cluster = universe.clusterMapping?.[symbol] || 'default';
            
            if (!clusters[cluster]) {
                clusters[cluster] = { capUtil: 0, symbols: [] };
            }
            
            clusters[cluster].symbols.push(symbol);
        }

        // Calculate utilization based on positions
        if (positions) {
            for (const position of positions.positions) {
                const cluster = universe.clusterMapping?.[position.symbol] || 'default';
                if (clusters[cluster]) {
                    const utilization = position.notional / positions.totalEquity;
                    clusters[cluster].capUtil += utilization;
                }
            }
        }

        return clusters;
    }

    private generateAlerts(snapshot: CorrelationSnapshot, universe: UniverseSnapshot): CorrelationAlert[] {
        const alerts: CorrelationAlert[] = [];

        // Check for high correlation clusters
        const highCorrPairs = snapshot.topPairs.filter(pair => pair.correlation > this.config.alertThreshold);
        
        if (highCorrPairs.length > 5) {
            alerts.push({
                type: 'high_correlation_cluster',
                severity: 'warn',
                pairs: highCorrPairs.slice(0, 10),
                clusters: Object.keys(snapshot.clusters),
                message: `High correlation detected: ${highCorrPairs.length} pairs above ${this.config.alertThreshold}`,
                timestamp: new Date().toISOString()
            });
        }

        // Check for insufficient data
        if (snapshot.sampleSize < this.config.minCommonBars) {
            alerts.push({
                type: 'insufficient_data',
                severity: 'info',
                pairs: [],
                clusters: [],
                message: `Insufficient data for reliable correlation: ${snapshot.sampleSize} < ${this.config.minCommonBars}`,
                timestamp: new Date().toISOString()
            });
        }

        // Store alerts in history
        this.alertHistory.push(...alerts);
        if (this.alertHistory.length > 100) {
            this.alertHistory = this.alertHistory.slice(-100);
        }

        return alerts;
    }

    private getMinSampleSize(symbols: string[]): number {
        let minSize = Infinity;
        
        for (const symbol of symbols) {
            const returns = this.returnHistory.get(symbol) || [];
            minSize = Math.min(minSize, returns.length);
        }
        
        return minSize === Infinity ? 0 : minSize;
    }

    /**
     * Get current correlation snapshot
     */
    getCurrentSnapshot(): CorrelationSnapshot | null {
        return this.lastSnapshot;
    }

    /**
     * Get correlation between two symbols
     */
    getCorrelation(symbol1: string, symbol2: string): number {
        if (!this.lastSnapshot) return 0;
        return this.lastSnapshot.rho[symbol1]?.[symbol2] || 0;
    }

    /**
     * Get beta values for a symbol
     */
    getBeta(symbol: string): { BTC: number; Market: number } | null {
        if (!this.lastSnapshot) return null;
        return this.lastSnapshot.betaTo[symbol] || null;
    }

    /**
     * Get recent alerts
     */
    getRecentAlerts(limit: number = 10): CorrelationAlert[] {
        return this.alertHistory.slice(-limit);
    }

    /**
     * Get module status
     */
    getStatus(): any {
        return {
            name: 'CorrelationMatrixService',
            initialized: this.isInitialized,
            config: this.config,
            dataPoints: this.priceHistory.size,
            lastSnapshot: this.lastSnapshot?.timestamp,
            alertCount: this.alertHistory.length
        };
    }

    async shutdown(): Promise<void> {
        try {
            this.logger.info('CorrelationMatrixService shutting down...');
            this.removeAllListeners();
            this.priceHistory.clear();
            this.returnHistory.clear();
            this.alertHistory.length = 0;
            this.lastSnapshot = null;
            this.isInitialized = false;
            this.logger.info('CorrelationMatrixService shutdown complete');
        } catch (error) {
            this.logger.error('CorrelationMatrixService shutdown error:', error);
        }
    }
}

export default CorrelationMatrixService;
