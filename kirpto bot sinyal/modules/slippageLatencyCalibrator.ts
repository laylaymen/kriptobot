/**
 * Slippage Latency Calibrator - BR-05
 * Fits slip & latency models from real/replay fill data for SG-02/BR-04/VIVO-26 calibration
 * Provides parameterized models and lookup tables for execution simulation
 */

import { EventEmitter } from 'events';

interface OrderJourneyMetrics {
    correlationId: string;
    symbol: string;
    side: 'buy' | 'sell';
    mode: 'market' | 'limit' | 'post_only' | 'twap' | 'iceberg';
    submittedQty: number;
    submittedPrice?: number;
    firstFillMs: number; // Time to first fill
    totalFillTimeMs: number; // Total time to complete
    avgSlipBps: number;
    realizSlipBps: number; // Realized vs expected
    fillCount: number;
    isMakerPct: number; // % of fills that were maker
    timestamp: string;
    marketConditions: {
        volBps: number;
        spreadBps: number;
        depthUSD: number;
        timeOfDay: number; // Hour of day 0-23
    };
}

interface MarketVolatilitySnapshot {
    symbol: string;
    volBps: number; // Recent volatility in basis points
    windowMs: number;
    timestamp: string;
}

interface MarketLiquiditySnapshot {
    symbol: string;
    spreadBps: number;
    depthUSD: number; // Total depth at best bid/ask
    skew: number; // Bid/ask size ratio
    timestamp: string;
}

interface CalibRequest {
    scope: {
        symbol?: string;
        timeframe?: string;
    };
    model: 'linear' | 'gam' | 'tree' | 'table';
    features: string[]; // ["volBps", "spreadBps", "depthUSD", "mode", "timeOfDay"]
    trainWindow: string; // "30d", "7d", etc.
    target: 'slipBps' | 'firstFillMs' | 'both';
}

interface CalibModelFitted {
    event: 'calib.model.fitted';
    timestamp: string;
    scope: CalibRequest['scope'];
    model: string;
    target: string;
    params: {
        [key: string]: any;
    };
    performance: {
        r2: number;
        mae: number;
        samples: number;
    };
    featureImportances?: {
        [feature: string]: number;
    };
}

interface CalibTableExport {
    event: 'calib.table.export';
    timestamp: string;
    version: string;
    scope: CalibRequest['scope'];
    rows: Array<{
        symbol: string;
        volBin: string; // "0-10", "10-20", etc.
        spreadBin: string;
        depthBin: string;
        mode: string;
        expectedSlipBps: number;
        p95LatencyMs: number;
        samples: number;
        confidence: number; // 0-1
    }>;
}

interface CalibAlert {
    event: 'calib.alert';
    timestamp: string;
    level: 'info' | 'warn' | 'error';
    message: string;
    context: any;
}

interface CalibMetrics {
    event: 'calib.metrics';
    timestamp: string;
    modelsActive: number;
    tablesActive: number;
    lastFitDuration: number;
    avgR2: number;
    dataSamples: number;
}

interface Config {
    bins: {
        volBps: number[];
        spreadBps: number[];
        depthUSD: number[];
    };
    regularization: {
        l2: number;
    };
    minSamples: number;
    models: {
        linear: {
            enabled: boolean;
            features: string[];
        };
        table: {
            enabled: boolean;
            fallbackBins: number;
        };
    };
    tz: string;
}

interface DataPoint {
    symbol: string;
    side: string;
    mode: string;
    submittedQty: number;
    slipBps: number;
    firstFillMs: number;
    volBps: number;
    spreadBps: number;
    depthUSD: number;
    timeOfDay: number;
    timestamp: number;
}

interface ModelState {
    id: string;
    scope: CalibRequest['scope'];
    model: string;
    target: string;
    params: any;
    performance: any;
    lastTrained: number;
    samples: number;
}

class SlippageLatencyCalibrator extends EventEmitter {
    private config: Config;
    private logger: any;
    private isInitialized: boolean = false;
    
    // Data storage
    private dataPoints: DataPoint[] = [];
    private maxDataPoints: number = 100000;
    
    // Model states
    private activeModels: Map<string, ModelState> = new Map();
    private activeTables: Map<string, CalibTableExport['rows']> = new Map();
    
    // Market data cache for context
    private volatilityCache: Map<string, MarketVolatilitySnapshot> = new Map();
    private liquidityCache: Map<string, MarketLiquiditySnapshot> = new Map();

    constructor(config: Partial<Config> = {}) {
        super();
        this.config = {
            bins: {
                volBps: [10, 20, 40, 80],
                spreadBps: [5, 10, 20, 50],
                depthUSD: [200000, 500000, 1000000, 2000000]
            },
            regularization: {
                l2: 1.0
            },
            minSamples: 1000,
            models: {
                linear: {
                    enabled: true,
                    features: ['volBps', 'spreadBps', 'depthUSD', 'submittedQty']
                },
                table: {
                    enabled: true,
                    fallbackBins: 5
                }
            },
            tz: 'Europe/Istanbul',
            ...config
        };
    }

    async initialize(logger: any): Promise<boolean> {
        try {
            this.logger = logger;
            this.logger.info('SlippageLatencyCalibrator initializing...');
            
            this.isInitialized = true;
            this.logger.info('SlippageLatencyCalibrator initialized successfully');
            return true;
        } catch (error) {
            this.logger.error('SlippageLatencyCalibrator initialization error:', error);
            return false;
        }
    }

    /**
     * Process order journey metrics for model training
     */
    async processOrderJourneyMetrics(data: OrderJourneyMetrics): Promise<void> {
        if (!this.isInitialized) return;

        try {
            // Convert to internal data point format
            const dataPoint: DataPoint = {
                symbol: data.symbol,
                side: data.side,
                mode: data.mode,
                submittedQty: data.submittedQty,
                slipBps: data.realizSlipBps,
                firstFillMs: data.firstFillMs,
                volBps: data.marketConditions.volBps,
                spreadBps: data.marketConditions.spreadBps,
                depthUSD: data.marketConditions.depthUSD,
                timeOfDay: data.marketConditions.timeOfDay,
                timestamp: new Date(data.timestamp).getTime()
            };

            // Add to dataset
            this.addDataPoint(dataPoint);

        } catch (error) {
            this.logger.error('SlippageLatencyCalibrator journey metrics error:', error);
        }
    }

    /**
     * Process market volatility snapshots
     */
    async processMarketVolatility(data: MarketVolatilitySnapshot): Promise<void> {
        if (!this.isInitialized) return;
        this.volatilityCache.set(data.symbol, data);
    }

    /**
     * Process market liquidity snapshots
     */
    async processMarketLiquidity(data: MarketLiquiditySnapshot): Promise<void> {
        if (!this.isInitialized) return;
        this.liquidityCache.set(data.symbol, data);
    }

    /**
     * Process calibration requests
     */
    async processCalibRequest(data: CalibRequest): Promise<void> {
        if (!this.isInitialized) return;

        try {
            const startTime = Date.now();

            // Filter data based on scope
            const filteredData = this.filterDataByScope(data.scope, data.trainWindow);
            
            if (filteredData.length < this.config.minSamples) {
                await this.emitAlert('warn', `Insufficient samples for ${data.model} model: ${filteredData.length} < ${this.config.minSamples}. Using table fallback.`);
                await this.fitTableModel(data, filteredData);
                return;
            }

            // Fit model based on type
            switch (data.model) {
                case 'linear':
                    await this.fitLinearModel(data, filteredData);
                    break;
                case 'table':
                    await this.fitTableModel(data, filteredData);
                    break;
                case 'gam':
                case 'tree':
                    await this.emitAlert('warn', `Model type ${data.model} not implemented, falling back to linear`);
                    await this.fitLinearModel(data, filteredData);
                    break;
                default:
                    throw new Error(`Unknown model type: ${data.model}`);
            }

            const duration = Date.now() - startTime;
            this.logger.info(`SlippageLatencyCalibrator fitted ${data.model} model in ${duration}ms with ${filteredData.length} samples`);

        } catch (error) {
            this.logger.error('SlippageLatencyCalibrator calibration request error:', error);
            await this.emitAlert('error', `Calibration failed: ${error.message}`);
        }
    }

    private addDataPoint(dataPoint: DataPoint): void {
        this.dataPoints.push(dataPoint);
        
        // Maintain max size by removing oldest
        if (this.dataPoints.length > this.maxDataPoints) {
            this.dataPoints = this.dataPoints.slice(-this.maxDataPoints);
        }
    }

    private filterDataByScope(scope: CalibRequest['scope'], trainWindow: string): DataPoint[] {
        const windowMs = this.parseTimeWindow(trainWindow);
        const cutoffTime = Date.now() - windowMs;
        
        return this.dataPoints.filter(dp => {
            // Time filter
            if (dp.timestamp < cutoffTime) return false;
            
            // Symbol filter
            if (scope.symbol && dp.symbol !== scope.symbol) return false;
            
            // Additional filters can be added here
            
            return true;
        });
    }

    private parseTimeWindow(window: string): number {
        const match = window.match(/^(\d+)([dmh])$/);
        if (!match) return 30 * 24 * 60 * 60 * 1000; // Default 30 days
        
        const value = parseInt(match[1]);
        const unit = match[2];
        
        switch (unit) {
            case 'h': return value * 60 * 60 * 1000;
            case 'd': return value * 24 * 60 * 60 * 1000;
            case 'm': return value * 30 * 24 * 60 * 60 * 1000; // months
            default: return value * 24 * 60 * 60 * 1000;
        }
    }

    private async fitLinearModel(request: CalibRequest, data: DataPoint[]): Promise<void> {
        // Simple linear regression implementation
        const features = request.features.filter(f => this.config.models.linear.features.includes(f));
        const targets = request.target === 'both' ? ['slipBps', 'firstFillMs'] : [request.target];
        
        for (const target of targets) {
            const X = this.extractFeatures(data, features);
            const y = data.map(dp => dp[target as keyof DataPoint] as number);
            
            const coefficients = this.fitLinearRegression(X, y);
            const r2 = this.calculateR2(X, y, coefficients);
            const mae = this.calculateMAE(X, y, coefficients);
            
            const modelId = this.getModelId(request.scope, request.model, target);
            const modelState: ModelState = {
                id: modelId,
                scope: request.scope,
                model: request.model,
                target,
                params: {
                    coefficients,
                    features,
                    intercept: coefficients[0]
                },
                performance: {
                    r2,
                    mae,
                    samples: data.length
                },
                lastTrained: Date.now(),
                samples: data.length
            };

            this.activeModels.set(modelId, modelState);

            // Emit fitted model
            const fitted: CalibModelFitted = {
                event: 'calib.model.fitted',
                timestamp: new Date().toISOString(),
                scope: request.scope,
                model: request.model,
                target,
                params: modelState.params,
                performance: modelState.performance,
                featureImportances: this.calculateFeatureImportances(coefficients, features)
            };

            this.emit('calib.model.fitted', fitted);

            if (r2 < 0.5) {
                await this.emitAlert('warn', `Low R² for ${target} model: ${r2.toFixed(3)}`);
            }
        }
    }

    private async fitTableModel(request: CalibRequest, data: DataPoint[]): Promise<void> {
        const target = request.target === 'both' ? 'slipBps' : request.target;
        const rows: CalibTableExport['rows'] = [];
        
        // Create bins
        const volBins = this.createBins(this.config.bins.volBps, 'volBps');
        const spreadBins = this.createBins(this.config.bins.spreadBps, 'spreadBps');
        const depthBins = this.createBins(this.config.bins.depthUSD, 'depthUSD');
        const modes = [...new Set(data.map(d => d.mode))];
        const symbols = request.scope.symbol ? [request.scope.symbol] : [...new Set(data.map(d => d.symbol))];
        
        for (const symbol of symbols) {
            for (const mode of modes) {
                for (const volBin of volBins) {
                    for (const spreadBin of spreadBins) {
                        for (const depthBin of depthBins) {
                            const binData = this.filterDataByBins(data, symbol, mode, volBin, spreadBin, depthBin);
                            
                            if (binData.length >= 10) { // Minimum samples per bin
                                const slipValues = binData.map(d => d.slipBps);
                                const latencyValues = binData.map(d => d.firstFillMs);
                                
                                rows.push({
                                    symbol,
                                    volBin: this.formatBin(volBin),
                                    spreadBin: this.formatBin(spreadBin),
                                    depthBin: this.formatBin(depthBin),
                                    mode,
                                    expectedSlipBps: this.percentile(slipValues, 0.5), // Median
                                    p95LatencyMs: this.percentile(latencyValues, 0.95),
                                    samples: binData.length,
                                    confidence: Math.min(1, binData.length / 100) // Confidence based on sample size
                                });
                            }
                        }
                    }
                }
            }
        }

        const tableExport: CalibTableExport = {
            event: 'calib.table.export',
            timestamp: new Date().toISOString(),
            version: `${Date.now()}`,
            scope: request.scope,
            rows
        };

        this.emit('calib.table.export', tableExport);

        const tableId = this.getModelId(request.scope, 'table', target);
        this.activeTables.set(tableId, rows);

        this.logger.info(`SlippageLatencyCalibrator created table with ${rows.length} bins from ${data.length} samples`);
    }

    private extractFeatures(data: DataPoint[], features: string[]): number[][] {
        return data.map(dp => {
            return features.map(feature => {
                const value = dp[feature as keyof DataPoint];
                return typeof value === 'number' ? value : 0;
            });
        });
    }

    private fitLinearRegression(X: number[][], y: number[]): number[] {
        // Simple least squares implementation
        // Add intercept column
        const XWithIntercept = X.map(row => [1, ...row]);
        const m = XWithIntercept.length;
        const n = XWithIntercept[0].length;
        
        // Calculate (X'X)^-1 X'y
        const XTX = this.matrixMultiply(this.transpose(XWithIntercept), XWithIntercept);
        const XTy = this.matrixVectorMultiply(this.transpose(XWithIntercept), y);
        
        // Simple 2x2 inverse for now (can be extended)
        if (n === 2) {
            const det = XTX[0][0] * XTX[1][1] - XTX[0][1] * XTX[1][0];
            if (Math.abs(det) < 1e-10) return [0, 0]; // Singular matrix
            
            const inv = [
                [XTX[1][1] / det, -XTX[0][1] / det],
                [-XTX[1][0] / det, XTX[0][0] / det]
            ];
            
            return [
                inv[0][0] * XTy[0] + inv[0][1] * XTy[1],
                inv[1][0] * XTy[0] + inv[1][1] * XTy[1]
            ];
        }
        
        // Fallback to simple correlation for higher dimensions
        return [y.reduce((a, b) => a + b) / y.length, 0]; // Mean as intercept
    }

    private calculateR2(X: number[][], y: number[], coefficients: number[]): number {
        const predictions = X.map(row => {
            return coefficients[0] + row.reduce((sum, val, i) => sum + val * coefficients[i + 1], 0);
        });
        
        const yMean = y.reduce((a, b) => a + b) / y.length;
        const ssRes = y.reduce((sum, val, i) => sum + Math.pow(val - predictions[i], 2), 0);
        const ssTot = y.reduce((sum, val) => sum + Math.pow(val - yMean, 2), 0);
        
        return 1 - (ssRes / ssTot);
    }

    private calculateMAE(X: number[][], y: number[], coefficients: number[]): number {
        const predictions = X.map(row => {
            return coefficients[0] + row.reduce((sum, val, i) => sum + val * coefficients[i + 1], 0);
        });
        
        const errors = y.map((val, i) => Math.abs(val - predictions[i]));
        return errors.reduce((a, b) => a + b) / errors.length;
    }

    private calculateFeatureImportances(coefficients: number[], features: string[]): { [feature: string]: number } {
        const importances: { [feature: string]: number } = {};
        const totalImportance = coefficients.slice(1).reduce((sum, coeff) => sum + Math.abs(coeff), 0);
        
        features.forEach((feature, i) => {
            importances[feature] = Math.abs(coefficients[i + 1]) / totalImportance;
        });
        
        return importances;
    }

    // Utility matrix operations
    private transpose(matrix: number[][]): number[][] {
        return matrix[0].map((_, i) => matrix.map(row => row[i]));
    }

    private matrixMultiply(A: number[][], B: number[][]): number[][] {
        const result = [];
        for (let i = 0; i < A.length; i++) {
            result[i] = [];
            for (let j = 0; j < B[0].length; j++) {
                let sum = 0;
                for (let k = 0; k < A[0].length; k++) {
                    sum += A[i][k] * B[k][j];
                }
                result[i][j] = sum;
            }
        }
        return result;
    }

    private matrixVectorMultiply(matrix: number[][], vector: number[]): number[] {
        return matrix.map(row => row.reduce((sum, val, i) => sum + val * vector[i], 0));
    }

    private createBins(thresholds: number[], field: string): Array<{ min: number; max: number; field: string }> {
        const bins = [];
        
        bins.push({ min: 0, max: thresholds[0], field });
        for (let i = 0; i < thresholds.length - 1; i++) {
            bins.push({ min: thresholds[i], max: thresholds[i + 1], field });
        }
        bins.push({ min: thresholds[thresholds.length - 1], max: Infinity, field });
        
        return bins;
    }

    private filterDataByBins(
        data: DataPoint[], 
        symbol: string, 
        mode: string, 
        volBin: { min: number; max: number },
        spreadBin: { min: number; max: number },
        depthBin: { min: number; max: number }
    ): DataPoint[] {
        return data.filter(dp => 
            dp.symbol === symbol &&
            dp.mode === mode &&
            dp.volBps >= volBin.min && dp.volBps < volBin.max &&
            dp.spreadBps >= spreadBin.min && dp.spreadBps < spreadBin.max &&
            dp.depthUSD >= depthBin.min && dp.depthUSD < depthBin.max
        );
    }

    private formatBin(bin: { min: number; max: number }): string {
        if (bin.max === Infinity) return `${bin.min}+`;
        return `${bin.min}-${bin.max}`;
    }

    private percentile(values: number[], p: number): number {
        const sorted = [...values].sort((a, b) => a - b);
        const index = Math.ceil(sorted.length * p) - 1;
        return sorted[Math.max(0, index)];
    }

    private getModelId(scope: CalibRequest['scope'], model: string, target: string): string {
        const scopeStr = scope.symbol || 'all';
        return `${scopeStr}-${model}-${target}`;
    }

    private async emitAlert(level: 'info' | 'warn' | 'error', message: string, context?: any): Promise<void> {
        const alert: CalibAlert = {
            event: 'calib.alert',
            timestamp: new Date().toISOString(),
            level,
            message,
            context: context || {}
        };

        this.emit('calib.alert', alert);
    }

    /**
     * Get module status
     */
    getStatus(): any {
        return {
            name: 'SlippageLatencyCalibrator',
            initialized: this.isInitialized,
            dataPoints: this.dataPoints.length,
            activeModels: this.activeModels.size,
            activeTables: this.activeTables.size,
            volatilityCache: this.volatilityCache.size,
            liquidityCache: this.liquidityCache.size
        };
    }

    async shutdown(): Promise<void> {
        try {
            this.logger.info('SlippageLatencyCalibrator shutting down...');
            
            this.dataPoints = [];
            this.activeModels.clear();
            this.activeTables.clear();
            this.volatilityCache.clear();
            this.liquidityCache.clear();
            this.removeAllListeners();
            this.isInitialized = false;
            this.logger.info('SlippageLatencyCalibrator shutdown complete');
        } catch (error) {
            this.logger.error('SlippageLatencyCalibrator shutdown error:', error);
        }
    }
}

export default SlippageLatencyCalibrator;
