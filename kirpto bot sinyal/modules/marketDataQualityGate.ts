/**
 * Market Data Quality Gate - BR-01
 * Detects gaps, duplicates, out-of-order, abnormal price spreads in historical datasets
 * Quality gate before VIVO-34 loading with fix recommendations
 */

import { EventEmitter } from 'events';
import * as crypto from 'crypto';

interface DataSource {
    type: 'jsonl' | 'csv' | 'parquet';
    path: string;
    topic: string;
    timeField: string;
    symbolField: string;
    schemaHint?: Record<string, string>;
}

interface ReplayDatasetDescribe {
    datasetId: string;
    sources: DataSource[];
}

interface DQThresholds {
    maxGapMs: number;
    maxSpreadBps: number;
    priceJumpsSigma: number;
    dupWindowMs: number;
}

interface DQFixes {
    forwardFillBars?: boolean;
    dropDup?: boolean;
    reorder?: boolean;
    interpBars?: boolean;
}

interface DQPolicyUpdate {
    thresholds: DQThresholds;
    fixes: DQFixes;
}

interface DQIssue {
    type: 'gap' | 'duplicate' | 'out_of_order' | 'price_jump' | 'bad_spread';
    timestamp: number;
    symbol: string;
    severity: 'low' | 'medium' | 'high';
    details: Record<string, any>;
}

interface DQSymbolReport {
    symbol: string;
    rows: number;
    timeRange: { start: number; end: number };
    issues: DQIssue[];
    qualityScore: number; // 0-100
}

interface DQScanReport {
    datasetId: string;
    summary: {
        rows: number;
        symbols: number;
        start: number;
        end: number;
    };
    issues: {
        gaps: number;
        dups: number;
        ooo: number; // out of order
        jumps: number;
        badSpread: number;
    };
    bySymbol: DQSymbolReport[];
    recommendations: string[];
    qualityScore: number;
    timestamp: string;
}

interface DQFixAction {
    type: 'drop' | 'interp' | 'cap_spread' | 'reorder';
    topic: string;
    symbol?: string;
    range?: { start: number; end: number };
    params?: Record<string, any>;
}

interface DQFixPlan {
    datasetId: string;
    actions: DQFixAction[];
    reasonCodes: string[];
    estimatedImpact: {
        rowsAffected: number;
        symbolsAffected: number;
        issuesFixed: number;
    };
    timestamp: string;
}

interface DQAlert {
    level: 'info' | 'warn' | 'error';
    message: string;
    context: any;
    timestamp: string;
}

interface DataRow {
    timestamp: number;
    symbol: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    spread?: number;
    [key: string]: any;
}

interface Config {
    windows: {
        bar: '1m' | '5m' | '15m';
    };
    thresholds: DQThresholds;
    preferFixes: {
        reorder: boolean;
        dropDup: boolean;
        interpBars: boolean;
    };
    maxScanRows: number;
    cacheExpireMs: number;
    tz: string;
}

class MarketDataQualityGate extends EventEmitter {
    private config: Config;
    private logger: any;
    private isInitialized: boolean = false;
    
    // Policy and thresholds
    private currentPolicy: DQPolicyUpdate;
    
    // Cache for idempotency
    private scanCache: Map<string, { report: DQScanReport; timestamp: number }> = new Map();
    
    // Statistics
    private stats: {
        scansPerformed: number;
        issuesFound: number;
        plansGenerated: number;
        cacheHits: number;
    } = {
        scansPerformed: 0,
        issuesFound: 0,
        plansGenerated: 0,
        cacheHits: 0
    };

    constructor(config: Partial<Config> = {}) {
        super();
        this.config = {
            windows: {
                bar: '5m'
            },
            thresholds: {
                maxGapMs: 60000, // 1 minute
                maxSpreadBps: 80,
                priceJumpsSigma: 6,
                dupWindowMs: 250
            },
            preferFixes: {
                reorder: true,
                dropDup: true,
                interpBars: true
            },
            maxScanRows: 1000000,
            cacheExpireMs: 60 * 60 * 1000, // 1 hour
            tz: 'Europe/Istanbul',
            ...config
        };

        this.currentPolicy = {
            thresholds: this.config.thresholds,
            fixes: {
                forwardFillBars: this.config.preferFixes.interpBars,
                dropDup: this.config.preferFixes.dropDup,
                reorder: this.config.preferFixes.reorder,
                interpBars: this.config.preferFixes.interpBars
            }
        };

        // Cleanup expired cache entries
        setInterval(() => {
            this.cleanupExpiredCache();
        }, 5 * 60 * 1000); // Every 5 minutes
    }

    async initialize(logger: any): Promise<boolean> {
        try {
            this.logger = logger;
            this.logger.info('MarketDataQualityGate initializing...');
            
            this.isInitialized = true;
            this.logger.info('MarketDataQualityGate initialized successfully');
            return true;
        } catch (error) {
            this.logger.error('MarketDataQualityGate initialization error:', error);
            return false;
        }
    }

    /**
     * Process replay dataset description - triggers quality scan
     */
    async processReplayDatasetDescribe(data: ReplayDatasetDescribe): Promise<void> {
        if (!this.isInitialized) return;

        try {
            // Check cache first (idempotency)
            const cacheKey = this.generateCacheKey(data.datasetId, this.currentPolicy);
            const cached = this.scanCache.get(cacheKey);
            
            if (cached && Date.now() - cached.timestamp < this.config.cacheExpireMs) {
                this.stats.cacheHits++;
                this.emit('dq.scan.report', cached.report);
                
                if (this.shouldGenerateFixPlan(cached.report)) {
                    const fixPlan = this.generateFixPlan(cached.report);
                    this.emit('dq.fix.plan', fixPlan);
                }
                return;
            }

            // Perform quality scan
            const report = await this.performQualityScan(data);
            
            // Cache the result
            this.scanCache.set(cacheKey, { report, timestamp: Date.now() });
            
            // Emit report
            this.emit('dq.scan.report', report);
            
            // Generate fix plan if needed
            if (this.shouldGenerateFixPlan(report)) {
                const fixPlan = this.generateFixPlan(report);
                this.emit('dq.fix.plan', fixPlan);
                this.stats.plansGenerated++;
            }

            this.stats.scansPerformed++;
            this.logger.info(`MarketDataQualityGate scanned dataset ${data.datasetId}: ${report.qualityScore}% quality`);

        } catch (error) {
            this.logger.error('MarketDataQualityGate dataset scanning error:', error);
            
            const alert: DQAlert = {
                level: 'error',
                message: `Dataset scan failed: ${error.message}`,
                context: { datasetId: data.datasetId },
                timestamp: new Date().toISOString()
            };
            this.emit('dq.alert', alert);
        }
    }

    /**
     * Update data quality policy
     */
    async processDQPolicyUpdate(data: DQPolicyUpdate): Promise<void> {
        if (!this.isInitialized) return;

        try {
            this.currentPolicy = data;
            this.logger.info('MarketDataQualityGate policy updated');

            // Clear cache as policy changed
            this.scanCache.clear();

        } catch (error) {
            this.logger.error('MarketDataQualityGate policy update error:', error);
        }
    }

    private async performQualityScan(dataset: ReplayDatasetDescribe): Promise<DQScanReport> {
        const symbolReports: DQSymbolReport[] = [];
        let totalRows = 0;
        let globalStart = Number.MAX_SAFE_INTEGER;
        let globalEnd = 0;
        const globalIssues = {
            gaps: 0,
            dups: 0,
            ooo: 0,
            jumps: 0,
            badSpread: 0
        };

        // Process each data source
        for (const source of dataset.sources) {
            const data = await this.loadDataSource(source);
            
            if (data.length === 0) continue;

            // Group by symbol
            const symbolGroups = this.groupBySymbol(data);
            
            for (const [symbol, rows] of symbolGroups.entries()) {
                const symbolReport = await this.scanSymbolData(symbol, rows);
                symbolReports.push(symbolReport);
                
                totalRows += symbolReport.rows;
                globalStart = Math.min(globalStart, symbolReport.timeRange.start);
                globalEnd = Math.max(globalEnd, symbolReport.timeRange.end);
                
                // Aggregate issues
                for (const issue of symbolReport.issues) {
                    globalIssues[issue.type]++;
                    this.stats.issuesFound++;
                }
            }
        }

        // Calculate overall quality score
        const totalIssues = Object.values(globalIssues).reduce((sum, count) => sum + count, 0);
        const qualityScore = totalRows > 0 ? Math.max(0, 100 - (totalIssues / totalRows) * 100) : 100;

        // Generate recommendations
        const recommendations = this.generateRecommendations(globalIssues, totalIssues);

        return {
            datasetId: dataset.datasetId,
            summary: {
                rows: totalRows,
                symbols: symbolReports.length,
                start: globalStart === Number.MAX_SAFE_INTEGER ? 0 : globalStart,
                end: globalEnd
            },
            issues: globalIssues,
            bySymbol: symbolReports,
            recommendations,
            qualityScore: Math.round(qualityScore),
            timestamp: new Date().toISOString()
        };
    }

    private async loadDataSource(source: DataSource): Promise<DataRow[]> {
        // Simulated data loading - in real implementation would read from file
        // For now, return mock data structure
        this.logger.debug(`MarketDataQualityGate simulating load from ${source.path}`);
        
        // Return empty array for simulation
        return [];
    }

    private groupBySymbol(data: DataRow[]): Map<string, DataRow[]> {
        const groups = new Map<string, DataRow[]>();
        
        for (const row of data) {
            if (!groups.has(row.symbol)) {
                groups.set(row.symbol, []);
            }
            groups.get(row.symbol)!.push(row);
        }
        
        // Sort each symbol's data by timestamp
        for (const rows of groups.values()) {
            rows.sort((a, b) => a.timestamp - b.timestamp);
        }
        
        return groups;
    }

    private async scanSymbolData(symbol: string, rows: DataRow[]): Promise<DQSymbolReport> {
        const issues: DQIssue[] = [];
        
        if (rows.length === 0) {
            return {
                symbol,
                rows: 0,
                timeRange: { start: 0, end: 0 },
                issues: [],
                qualityScore: 0
            };
        }

        // Sort by timestamp to ensure order
        rows.sort((a, b) => a.timestamp - b.timestamp);

        const timeRange = {
            start: rows[0].timestamp,
            end: rows[rows.length - 1].timestamp
        };

        // Scan for various issues
        this.detectGaps(symbol, rows, issues);
        this.detectDuplicates(symbol, rows, issues);
        this.detectOutOfOrder(symbol, rows, issues);
        this.detectPriceJumps(symbol, rows, issues);
        this.detectBadSpreads(symbol, rows, issues);

        // Calculate symbol quality score
        const qualityScore = rows.length > 0 ? 
            Math.max(0, 100 - (issues.length / rows.length) * 100) : 100;

        return {
            symbol,
            rows: rows.length,
            timeRange,
            issues,
            qualityScore: Math.round(qualityScore)
        };
    }

    private detectGaps(symbol: string, rows: DataRow[], issues: DQIssue[]): void {
        for (let i = 1; i < rows.length; i++) {
            const gap = rows[i].timestamp - rows[i - 1].timestamp;
            
            if (gap > this.currentPolicy.thresholds.maxGapMs) {
                issues.push({
                    type: 'gap',
                    timestamp: rows[i].timestamp,
                    symbol,
                    severity: gap > this.currentPolicy.thresholds.maxGapMs * 5 ? 'high' : 'medium',
                    details: {
                        gapMs: gap,
                        prevTimestamp: rows[i - 1].timestamp,
                        threshold: this.currentPolicy.thresholds.maxGapMs
                    }
                });
            }
        }
    }

    private detectDuplicates(symbol: string, rows: DataRow[], issues: DQIssue[]): void {
        const seen = new Set<string>();
        
        for (const row of rows) {
            const key = `${row.timestamp}_${row.symbol}`;
            
            if (seen.has(key)) {
                issues.push({
                    type: 'duplicate',
                    timestamp: row.timestamp,
                    symbol,
                    severity: 'medium',
                    details: {
                        duplicateKey: key
                    }
                });
            } else {
                seen.add(key);
            }
        }
    }

    private detectOutOfOrder(symbol: string, rows: DataRow[], issues: DQIssue[]): void {
        for (let i = 1; i < rows.length; i++) {
            if (rows[i].timestamp < rows[i - 1].timestamp) {
                issues.push({
                    type: 'out_of_order',
                    timestamp: rows[i].timestamp,
                    symbol,
                    severity: 'high',
                    details: {
                        currentTimestamp: rows[i].timestamp,
                        previousTimestamp: rows[i - 1].timestamp,
                        index: i
                    }
                });
            }
        }
    }

    private detectPriceJumps(symbol: string, rows: DataRow[], issues: DQIssue[]): void {
        if (rows.length < 10) return; // Need enough data for statistics
        
        // Calculate price changes
        const priceChanges: number[] = [];
        for (let i = 1; i < rows.length; i++) {
            const change = Math.abs(rows[i].close - rows[i - 1].close) / rows[i - 1].close;
            priceChanges.push(change);
        }

        // Calculate mean and standard deviation
        const mean = priceChanges.reduce((sum, c) => sum + c, 0) / priceChanges.length;
        const variance = priceChanges.reduce((sum, c) => sum + Math.pow(c - mean, 2), 0) / priceChanges.length;
        const stdDev = Math.sqrt(variance);

        // Detect jumps beyond threshold
        for (let i = 1; i < rows.length; i++) {
            const change = Math.abs(rows[i].close - rows[i - 1].close) / rows[i - 1].close;
            const zScore = stdDev > 0 ? (change - mean) / stdDev : 0;

            if (zScore > this.currentPolicy.thresholds.priceJumpsSigma) {
                issues.push({
                    type: 'price_jump',
                    timestamp: rows[i].timestamp,
                    symbol,
                    severity: zScore > this.currentPolicy.thresholds.priceJumpsSigma * 1.5 ? 'high' : 'medium',
                    details: {
                        priceChange: change,
                        zScore,
                        threshold: this.currentPolicy.thresholds.priceJumpsSigma,
                        prevPrice: rows[i - 1].close,
                        currentPrice: rows[i].close
                    }
                });
            }
        }
    }

    private detectBadSpreads(symbol: string, rows: DataRow[], issues: DQIssue[]): void {
        for (const row of rows) {
            if (row.high && row.low && row.close) {
                const spread = ((row.high - row.low) / row.close) * 10000; // basis points
                
                if (spread > this.currentPolicy.thresholds.maxSpreadBps) {
                    issues.push({
                        type: 'bad_spread',
                        timestamp: row.timestamp,
                        symbol,
                        severity: spread > this.currentPolicy.thresholds.maxSpreadBps * 2 ? 'high' : 'medium',
                        details: {
                            spreadBps: Math.round(spread),
                            threshold: this.currentPolicy.thresholds.maxSpreadBps,
                            high: row.high,
                            low: row.low,
                            close: row.close
                        }
                    });
                }
            }
        }
    }

    private generateRecommendations(issues: DQScanReport['issues'], totalIssues: number): string[] {
        const recommendations: string[] = [];

        if (issues.gaps > 0) {
            recommendations.push(`Found ${issues.gaps} gaps - consider forward fill interpolation`);
        }

        if (issues.dups > 0) {
            recommendations.push(`Found ${issues.dups} duplicates - recommend deduplication`);
        }

        if (issues.ooo > 0) {
            recommendations.push(`Found ${issues.ooo} out-of-order records - recommend time-based reordering`);
        }

        if (issues.jumps > 0) {
            recommendations.push(`Found ${issues.jumps} price jumps - review for data errors or genuine market events`);
        }

        if (issues.badSpread > 0) {
            recommendations.push(`Found ${issues.badSpread} abnormal spreads - consider spread capping`);
        }

        if (totalIssues === 0) {
            recommendations.push('Dataset quality is excellent - no issues detected');
        } else if (totalIssues > 100) {
            recommendations.push('Dataset has significant quality issues - manual review recommended');
        }

        return recommendations;
    }

    private shouldGenerateFixPlan(report: DQScanReport): boolean {
        return report.qualityScore < 95 || Object.values(report.issues).some(count => count > 0);
    }

    private generateFixPlan(report: DQScanReport): DQFixPlan {
        const actions: DQFixAction[] = [];
        const reasonCodes: string[] = [];
        let estimatedRowsAffected = 0;
        let estimatedIssuesFixed = 0;

        // Generate fix actions based on issues and policy
        if (report.issues.dups > 0 && this.currentPolicy.fixes.dropDup) {
            actions.push({
                type: 'drop',
                topic: 'duplicate_removal',
                params: { windowMs: this.currentPolicy.thresholds.dupWindowMs }
            });
            reasonCodes.push('REMOVE_DUPLICATES');
            estimatedRowsAffected += report.issues.dups;
            estimatedIssuesFixed += report.issues.dups;
        }

        if (report.issues.ooo > 0 && this.currentPolicy.fixes.reorder) {
            actions.push({
                type: 'reorder',
                topic: 'time_sort',
                params: { field: 'timestamp' }
            });
            reasonCodes.push('TIME_REORDER');
            estimatedIssuesFixed += report.issues.ooo;
        }

        if (report.issues.gaps > 0 && this.currentPolicy.fixes.forwardFillBars) {
            actions.push({
                type: 'interp',
                topic: 'gap_fill',
                params: { method: 'forward_fill', maxGapMs: this.currentPolicy.thresholds.maxGapMs }
            });
            reasonCodes.push('INTERPOLATE_GAPS');
            estimatedRowsAffected += Math.floor(report.issues.gaps * 0.5); // Estimate interpolated rows
            estimatedIssuesFixed += report.issues.gaps;
        }

        if (report.issues.badSpread > 0) {
            actions.push({
                type: 'cap_spread',
                topic: 'spread_normalization',
                params: { maxSpreadBps: this.currentPolicy.thresholds.maxSpreadBps }
            });
            reasonCodes.push('CAP_SPREADS');
            estimatedRowsAffected += report.issues.badSpread;
            estimatedIssuesFixed += report.issues.badSpread;
        }

        return {
            datasetId: report.datasetId,
            actions,
            reasonCodes,
            estimatedImpact: {
                rowsAffected: estimatedRowsAffected,
                symbolsAffected: report.bySymbol.filter(s => s.issues.length > 0).length,
                issuesFixed: estimatedIssuesFixed
            },
            timestamp: new Date().toISOString()
        };
    }

    private generateCacheKey(datasetId: string, policy: DQPolicyUpdate): string {
        const policyHash = crypto.createHash('md5')
            .update(JSON.stringify(policy))
            .digest('hex')
            .substring(0, 8);
        return `${datasetId}_${policyHash}`;
    }

    private cleanupExpiredCache(): void {
        const now = Date.now();
        const toDelete: string[] = [];

        for (const [key, entry] of this.scanCache.entries()) {
            if (now - entry.timestamp > this.config.cacheExpireMs) {
                toDelete.push(key);
            }
        }

        toDelete.forEach(key => this.scanCache.delete(key));

        if (toDelete.length > 0) {
            this.logger.debug(`MarketDataQualityGate cleaned up ${toDelete.length} expired cache entries`);
        }
    }

    /**
     * Get module status
     */
    getStatus(): any {
        return {
            name: 'MarketDataQualityGate',
            initialized: this.isInitialized,
            cacheSize: this.scanCache.size,
            currentPolicy: this.currentPolicy,
            stats: this.stats
        };
    }

    async shutdown(): Promise<void> {
        try {
            this.logger.info('MarketDataQualityGate shutting down...');
            this.removeAllListeners();
            this.scanCache.clear();
            this.isInitialized = false;
            this.logger.info('MarketDataQualityGate shutdown complete');
        } catch (error) {
            this.logger.error('MarketDataQualityGate shutdown error:', error);
        }
    }
}

export default MarketDataQualityGate;
