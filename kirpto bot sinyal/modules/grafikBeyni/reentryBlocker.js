/**
 * Grafik Beyni - Re-entry Blocker Module
 * 
 * Prevents repeated entries in the same price zone within a short timeframe.
 * Blocks signals when multiple trades have occurred in the same area recently,
 * especially after stop losses or in low volatility conditions.
 */

const GrafikBeyniModuleBase = require('./grafikBeyniModuleBase');

class ReentryBlocker extends GrafikBeyniModuleBase {
    constructor() {
        super('reentryBlocker');
        
        // Configuration for re-entry blocking
        this.config = {
            scoreWeights: {
                recentTrades: 0.30,        // Multiple trades in same zone
                stopLossHistory: 0.25,     // Recent SL in this zone
                lowMomentum: 0.20,         // Momentum below threshold
                weakVolatility: 0.15,      // Low volatility indicates ranging
                zoneOveruse: 0.10          // Zone width too narrow
            },
            thresholds: {
                blockEntry: 0.75,          // Block if score >= 0.75
                cautiousEntry: 0.50,       // Be cautious if >= 0.50
                zoneWidthPercent: 0.01,    // 1% zone width is narrow
                maxTradesPerZone: 2,       // Max trades per zone per time window
                timeWindowHours: 1,        // Time window for trade counting
                minTimeBetweenTrades: 35   // Minimum 35 minutes between trades
            },
            momentum: {
                weakThreshold: 1.0,        // Below this is weak momentum
                strongThreshold: 1.3       // Above this overrides some blocks
            },
            volatility: {
                lowThreshold: 1.0,         // Below this is low volatility
                normalThreshold: 1.5       // Above this is normal/high
            }
        };

        // Track recent trades (in production, this would be from database)
        this.recentTrades = [];
    }

    async analyze(data) {
        try {
            const startTime = Date.now();
            
            if (!this.validateInput(data)) {
                return this.createErrorOutput('Invalid input data for re-entry blocking');
            }

            // Clean old trades from memory
            this.cleanOldTrades();

            // Analyze different blocking factors
            const tradeCountAnalysis = this.analyzeRecentTradeCount(data);
            const stopLossAnalysis = this.analyzeStopLossHistory(data);
            const momentumAnalysis = this.analyzeMomentumCondition(data.momentum);
            const volatilityAnalysis = this.analyzeVolatility(data.volatility);
            const zoneAnalysis = this.analyzeZoneOveruse(data.zoneWidth, data.entryAttemptCount);

            // Calculate overall block score
            const blockScore = this.calculateBlockScore(
                tradeCountAnalysis,
                stopLossAnalysis,
                momentumAnalysis,
                volatilityAnalysis,
                zoneAnalysis
            );

            // Determine if re-entry should be blocked
            const blockReentry = blockScore >= this.config.thresholds.blockEntry;
            const reasoning = this.generateReasoning(
                tradeCountAnalysis,
                stopLossAnalysis,
                momentumAnalysis,
                volatilityAnalysis,
                zoneAnalysis
            );

            // Create modular recommendations
            const modularRecommendations = this.generateModularRecommendations(
                blockReentry,
                blockScore,
                data
            );

            // Add this analysis to trade history
            this.recordTradeAttempt(data, blockReentry);

            const result = {
                blockReentry: blockReentry,
                blockScore: blockScore,
                reasoning: reasoning,
                modularRecommendations: modularRecommendations,
                componentAnalysis: {
                    tradeCount: tradeCountAnalysis,
                    stopLoss: stopLossAnalysis,
                    momentum: momentumAnalysis,
                    volatility: volatilityAnalysis,
                    zone: zoneAnalysis
                },
                riskFactors: this.identifyRiskFactors(blockScore, data),
                alert: this.generateAlert(blockReentry, blockScore, data),
                zoneStatus: this.getZoneStatus(data.price, blockScore)
            };

            this.cacheResult(data, result);
            this.trackPerformance(startTime);

            return result;

        } catch (error) {
            this.logError('Re-entry blocking analysis failed', error);
            return this.createErrorOutput(error.message);
        }
    }

    analyzeRecentTradeCount(data) {
        const currentTime = Date.now();
        const timeWindowMs = this.config.thresholds.timeWindowHours * 60 * 60 * 1000;
        const priceZone = this.getPriceZone(data.price, data.zoneWidth);

        // Count recent trades in this zone
        const recentTradesInZone = this.recentTrades.filter(trade => {
            const timeDiff = currentTime - trade.timestamp;
            const isInTimeWindow = timeDiff <= timeWindowMs;
            const isInZone = this.isPriceInZone(trade.price, priceZone);
            return isInTimeWindow && isInZone;
        });

        const tradeCount = recentTradesInZone.length;
        const timeSinceLastTrade = this.getTimeSinceLastTrade(priceZone);

        let score = 0;
        let analysis = 'no-recent-trades';

        if (tradeCount > this.config.thresholds.maxTradesPerZone) {
            score = 1.0;
            analysis = 'excessive-trades-in-zone';
        } else if (tradeCount === this.config.thresholds.maxTradesPerZone) {
            score = 0.7;
            analysis = 'maximum-trades-reached';
        } else if (tradeCount === 1) {
            // Check time since last trade
            if (timeSinceLastTrade < this.config.thresholds.minTimeBetweenTrades * 60 * 1000) {
                score = 0.6;
                analysis = 'recent-trade-too-close';
            } else {
                score = 0.2;
                analysis = 'one-recent-trade';
            }
        }

        return {
            score: score * this.config.scoreWeights.recentTrades,
            tradeCount: tradeCount,
            analysis: analysis,
            timeSinceLastTrade: timeSinceLastTrade,
            recentTrades: recentTradesInZone.map(t => ({ 
                price: t.price, 
                result: t.result, 
                timeAgo: currentTime - t.timestamp 
            }))
        };
    }

    analyzeStopLossHistory(data) {
        if (!data.recentPositions || data.recentPositions.length === 0) {
            return {
                score: 0,
                hasRecentSL: false,
                analysis: 'no-recent-positions',
                slCount: 0
            };
        }

        const priceZone = this.getPriceZone(data.price, data.zoneWidth);
        const slPositions = data.recentPositions.filter(pos => {
            return pos.result === 'SL' && this.isPriceInZone(pos.entry, priceZone);
        });

        const slCount = slPositions.length;
        let score = 0;
        let analysis = 'no-recent-sl';

        if (slCount >= 2) {
            score = 1.0;
            analysis = 'multiple-sl-in-zone';
        } else if (slCount === 1) {
            score = 0.7;
            analysis = 'recent-sl-in-zone';
        }

        return {
            score: score * this.config.scoreWeights.stopLossHistory,
            hasRecentSL: slCount > 0,
            analysis: analysis,
            slCount: slCount,
            slPositions: slPositions
        };
    }

    analyzeMomentumCondition(momentum) {
        if (!momentum) {
            return {
                score: 0.5 * this.config.scoreWeights.lowMomentum,
                momentum: 0,
                analysis: 'momentum-unknown',
                isWeak: true
            };
        }

        let score = 0;
        let analysis = 'normal-momentum';
        let isWeak = false;

        if (momentum < this.config.momentum.weakThreshold) {
            score = 1.0;
            analysis = 'momentum-very-weak';
            isWeak = true;
        } else if (momentum < this.config.momentum.strongThreshold) {
            score = 0.6;
            analysis = 'momentum-moderate';
            isWeak = false;
        } else {
            // Strong momentum can override some blocking factors
            score = 0;
            analysis = 'momentum-strong';
            isWeak = false;
        }

        return {
            score: score * this.config.scoreWeights.lowMomentum,
            momentum: momentum,
            analysis: analysis,
            isWeak: isWeak,
            canOverride: momentum > this.config.momentum.strongThreshold
        };
    }

    analyzeVolatility(volatility) {
        if (!volatility) {
            return {
                score: 0.5 * this.config.scoreWeights.weakVolatility,
                volatility: 0,
                analysis: 'volatility-unknown',
                isLow: true
            };
        }

        let score = 0;
        let analysis = 'normal-volatility';
        let isLow = false;

        if (volatility < this.config.volatility.lowThreshold) {
            score = 1.0;
            analysis = 'volatility-very-low';
            isLow = true;
        } else if (volatility < this.config.volatility.normalThreshold) {
            score = 0.5;
            analysis = 'volatility-below-normal';
            isLow = true;
        } else {
            score = 0;
            analysis = 'volatility-normal-or-high';
            isLow = false;
        }

        return {
            score: score * this.config.scoreWeights.weakVolatility,
            volatility: volatility,
            analysis: analysis,
            isLow: isLow
        };
    }

    analyzeZoneOveruse(zoneWidth, entryAttemptCount) {
        let score = 0;
        let analysis = 'zone-normal';
        let isNarrow = false;

        // Check zone width
        if (zoneWidth && zoneWidth < this.config.thresholds.zoneWidthPercent) {
            score += 0.5;
            isNarrow = true;
            analysis = 'zone-too-narrow';
        }

        // Check entry attempt count
        if (entryAttemptCount && entryAttemptCount >= 3) {
            score += 0.5;
            analysis = isNarrow ? 'zone-narrow-and-overused' : 'zone-overused';
        }

        return {
            score: Math.min(score, 1.0) * this.config.scoreWeights.zoneOveruse,
            zoneWidth: zoneWidth,
            entryAttemptCount: entryAttemptCount || 0,
            analysis: analysis,
            isNarrow: isNarrow,
            isOverused: (entryAttemptCount || 0) >= 3
        };
    }

    calculateBlockScore(tradeCount, stopLoss, momentum, volatility, zone) {
        let totalScore = 
            tradeCount.score +
            stopLoss.score +
            momentum.score +
            volatility.score +
            zone.score;

        // Apply momentum override if very strong
        if (momentum.canOverride && totalScore < 0.9) {
            totalScore *= 0.7; // Reduce block score by 30%
        }

        return Math.max(0, Math.min(1, totalScore));
    }

    generateReasoning(tradeCount, stopLoss, momentum, volatility, zone) {
        const reasoning = [];

        if (tradeCount.tradeCount > this.config.thresholds.maxTradesPerZone) {
            reasoning.push('Multiple trades in same zone within short time');
        }

        if (stopLoss.hasRecentSL) {
            reasoning.push('Recent SL in this zone');
        }

        if (momentum.isWeak) {
            reasoning.push('Low momentum and volatility');
        }

        if (volatility.isLow) {
            reasoning.push('Market ranging/consolidating');
        }

        if (zone.isNarrow) {
            reasoning.push('Price zone too narrow');
        }

        if (zone.isOverused) {
            reasoning.push('Too many entry attempts in zone');
        }

        // Add positive factors
        if (momentum.canOverride) {
            reasoning.push('Strong momentum may override blocks');
        }

        return reasoning;
    }

    generateModularRecommendations(blockReentry, blockScore, data) {
        return {
            confirmationSignalBridge: {
                blockThisZone: blockReentry,
                requireExtraConfirmations: blockScore > this.config.thresholds.cautiousEntry,
                blockScore: blockScore
            },
            entryZoneClassifier: {
                delayAllSignalsInZone: blockReentry,
                reduceZoneScore: blockScore > this.config.thresholds.cautiousEntry,
                zoneOveruse: blockScore
            },
            Otobilinç: {
                markPatternAsRepetitive: blockReentry,
                tradingFatigueDetected: blockScore > 0.8,
                behaviorPattern: 'zone-overuse'
            },
            tpOptimizer: {
                useShorterTargets: blockScore > this.config.thresholds.cautiousEntry,
                conservativeApproach: blockReentry,
                riskAdjustment: blockScore
            },
            riskZoneDefender: {
                amplifyRisk: blockReentry,
                zoneRiskFactor: blockScore
            }
        };
    }

    getPriceZone(price, zoneWidth) {
        const width = zoneWidth || (price * this.config.thresholds.zoneWidthPercent);
        return {
            lower: price - width / 2,
            upper: price + width / 2,
            center: price,
            width: width
        };
    }

    isPriceInZone(price, zone) {
        return price >= zone.lower && price <= zone.upper;
    }

    getTimeSinceLastTrade(priceZone) {
        const currentTime = Date.now();
        const tradesInZone = this.recentTrades.filter(trade => 
            this.isPriceInZone(trade.price, priceZone)
        );

        if (tradesInZone.length === 0) {
            return Infinity;
        }

        const lastTrade = tradesInZone.reduce((latest, trade) => 
            trade.timestamp > latest.timestamp ? trade : latest
        );

        return currentTime - lastTrade.timestamp;
    }

    recordTradeAttempt(data, wasBlocked) {
        this.recentTrades.push({
            price: data.price,
            timestamp: Date.now(),
            result: wasBlocked ? 'BLOCKED' : 'ATTEMPTED',
            momentum: data.momentum,
            volatility: data.volatility
        });

        // Keep only recent trades (last 24 hours)
        this.cleanOldTrades();
    }

    cleanOldTrades() {
        const maxAge = 24 * 60 * 60 * 1000; // 24 hours
        const currentTime = Date.now();
        
        this.recentTrades = this.recentTrades.filter(trade => 
            currentTime - trade.timestamp <= maxAge
        );
    }

    identifyRiskFactors(blockScore, data) {
        const riskFactors = [];

        if (blockScore >= this.config.thresholds.blockEntry) {
            riskFactors.push('zone-overuse-critical');
        }

        if (data.recentPositions && data.recentPositions.some(p => p.result === 'SL')) {
            riskFactors.push('recent-stop-loss');
        }

        if (data.momentum && data.momentum < this.config.momentum.weakThreshold) {
            riskFactors.push('weak-momentum');
        }

        if (data.volatility && data.volatility < this.config.volatility.lowThreshold) {
            riskFactors.push('low-volatility');
        }

        if (data.entryAttemptCount && data.entryAttemptCount >= 3) {
            riskFactors.push('multiple-failed-attempts');
        }

        return riskFactors;
    }

    generateAlert(blockReentry, blockScore, data) {
        if (blockReentry) {
            return 'Zone overused — signal delayed';
        } else if (blockScore > this.config.thresholds.cautiousEntry) {
            return 'Caution: repeated activity in this zone';
        } else {
            return 'Zone clear for new entries';
        }
    }

    getZoneStatus(price, blockScore) {
        if (blockScore >= this.config.thresholds.blockEntry) {
            return 'blocked';
        } else if (blockScore >= this.config.thresholds.cautiousEntry) {
            return 'caution';
        } else {
            return 'clear';
        }
    }

    validateInput(data) {
        return data && 
               data.price !== undefined && 
               data.price > 0;
    }

    createErrorOutput(message) {
        return {
            blockReentry: true, // Block on error for safety
            blockScore: 1.0,
            reasoning: [`Error: ${message}`],
            error: message,
            modularRecommendations: {
                confirmationSignalBridge: { blockThisZone: true },
                entryZoneClassifier: { delayAllSignalsInZone: true },
                Otobilinç: { markPatternAsRepetitive: true }
            },
            riskFactors: ['analysis-error'],
            alert: 'Error in re-entry analysis — blocking for safety'
        };
    }

    // Public methods for other modules
    getRecentTradesInZone(price, zoneWidth) {
        const zone = this.getPriceZone(price, zoneWidth);
        return this.recentTrades.filter(trade => this.isPriceInZone(trade.price, zone));
    }

    getZoneOveruseScore(price, zoneWidth) {
        const zone = this.getPriceZone(price, zoneWidth);
        const tradesInZone = this.getRecentTradesInZone(price, zoneWidth);
        return Math.min(1.0, tradesInZone.length / this.config.thresholds.maxTradesPerZone);
    }

    resetZoneHistory() {
        this.recentTrades = [];
    }
}

module.exports = ReentryBlocker;
