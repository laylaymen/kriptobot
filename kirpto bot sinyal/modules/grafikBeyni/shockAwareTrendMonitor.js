const GrafikBeyniModuleBase = require('./grafikBeyniModuleBase');

/**
 * Shock Aware Trend Monitor Module
 * Şok durumlarında trend davranışını izleyen ve trend kalitesini değerlendiren sistem
 * Trend shock resistance, recovery patterns ve trend continuation analizi
 */
class ShockAwareTrendMonitor extends GrafikBeyniModuleBase {
    constructor() {
        super('shockAwareTrendMonitor');
        this.shockHistory = [];
        this.trendHistory = [];
        this.shockThresholds = {
            mild: 0.03,      // 3% price movement
            moderate: 0.05,   // 5% price movement
            severe: 0.08,     // 8% price movement
            extreme: 0.12     // 12% price movement
        };
        this.trendStrengthLevels = {
            weak: 0.3,
            moderate: 0.6,
            strong: 0.8,
            veryStrong: 0.95
        };
        this.recoveryTimeframes = {
            immediate: 1,     // 1 period
            short: 5,         // 5 periods
            medium: 20,       // 20 periods
            long: 50          // 50 periods
        };
        this.maxHistorySize = 1000;
        this.minObservations = 30;
        this.shockDetectionWindow = 10;
        this.trendEvaluationWindow = 50;
    }

    async analyze(data) {
        try {
            const {
                symbol,
                price,
                historicalPrices,
                volume,
                timeframe,
                marketData,
                technicalIndicators,
                volatilityData,
                liquidityMetrics,
                orderbook,
                newsEvents,
                macroEvents,
                marketSentiment,
                correlationData,
                flowData,
                microstructureData
            } = data;

            // Veri doğrulama
            if (!historicalPrices || historicalPrices.length < this.minObservations) {
                throw new Error('Insufficient historical data for shock-aware trend analysis');
            }

            // Price returns calculation
            const returns = this.calculateReturns(historicalPrices);
            
            // Shock detection
            const shockAnalysis = this.detectPriceShocks(returns, historicalPrices);

            // Trend analysis
            const trendAnalysis = this.analyzeTrendBehavior(historicalPrices, returns);

            // Shock impact on trends
            const shockImpactAnalysis = this.analyzeShockImpactOnTrends(shockAnalysis, trendAnalysis);

            // Trend recovery patterns
            const recoveryPatterns = this.analyzeRecoveryPatterns(shockAnalysis, trendAnalysis, historicalPrices);

            // Trend continuation probability
            const continuationAnalysis = this.analyzeTrendContinuation(trendAnalysis, shockAnalysis);

            // Shock resistance analysis
            const shockResistanceAnalysis = this.analyzeShockResistance(trendAnalysis, shockAnalysis);

            // Market structure impact
            const structureImpact = this.analyzeMarketStructureImpact(shockAnalysis, liquidityMetrics, microstructureData);

            // News and event correlation
            const eventCorrelation = this.analyzeEventCorrelation(shockAnalysis, newsEvents, macroEvents);

            // Trend quality assessment
            const trendQuality = this.assessTrendQuality(trendAnalysis, shockResistanceAnalysis, recoveryPatterns);

            // Risk assessment
            const riskAssessment = this.assessTrendRisk(trendAnalysis, shockAnalysis, volatilityData);

            // Predictive analysis
            const predictiveAnalysis = this.generatePredictiveInsights(trendAnalysis, shockAnalysis, recoveryPatterns);

            const result = {
                shockAnalysis: shockAnalysis,
                trendAnalysis: trendAnalysis,
                shockImpactAnalysis: shockImpactAnalysis,
                recoveryPatterns: recoveryPatterns,
                continuationAnalysis: continuationAnalysis,
                shockResistanceAnalysis: shockResistanceAnalysis,
                structureImpact: structureImpact,
                eventCorrelation: eventCorrelation,
                trendQuality: trendQuality,
                riskAssessment: riskAssessment,
                predictiveAnalysis: predictiveAnalysis,
                currentStatus: this.getCurrentStatus(trendAnalysis, shockAnalysis),
                recommendations: this.generateRecommendations(trendAnalysis, shockAnalysis, trendQuality),
                alerts: this.generateAlerts(shockAnalysis, trendAnalysis, riskAssessment),
                notes: this.generateNotes(trendAnalysis, shockAnalysis, trendQuality),
                metadata: {
                    analysisTimestamp: Date.now(),
                    symbol: symbol,
                    timeframe: timeframe,
                    observationCount: historicalPrices.length,
                    currentTrend: trendAnalysis.currentTrend,
                    shockCount: shockAnalysis.totalShocks,
                    trendStrength: trendAnalysis.strength,
                    shockResistance: shockResistanceAnalysis.overallResistance
                }
            };

            // History güncelleme
            this.updateShockTrendHistory(result, data);

            // Cache ve performance tracking
            this.updateCache(data, result);
            this.trackPerformance(Date.now(), trendQuality.score > 0.7);

            return result;

        } catch (error) {
            this.handleError('ShockAwareTrendMonitor analysis failed', error, data);
            return this.getDefaultResult();
        }
    }

    calculateReturns(prices) {
        const returns = [];
        
        for (let i = 1; i < prices.length; i++) {
            const return_ = (prices[i] - prices[i - 1]) / prices[i - 1];
            returns.push(return_);
        }
        
        return returns;
    }

    detectPriceShocks(returns, prices) {
        const shocks = [];
        const recentVolatility = this.calculateRollingVolatility(returns, 20);
        
        for (let i = 1; i < returns.length; i++) {
            const return_ = Math.abs(returns[i]);
            const expectedVol = recentVolatility[i] || this.calculateVolatility(returns.slice(0, i + 1));
            
            // Shock detection based on multiple standard deviations from expected volatility
            const shockLevel = this.classifyShockLevel(return_, expectedVol);
            
            if (shockLevel !== 'normal') {
                const shock = {
                    index: i,
                    timestamp: Date.now() - (returns.length - i) * 60000, // Simplified timestamp
                    return: returns[i],
                    absoluteReturn: return_,
                    price: prices[i],
                    shockLevel: shockLevel,
                    direction: returns[i] > 0 ? 'positive' : 'negative',
                    magnitude: return_ / expectedVol,
                    context: this.getShockContext(i, returns, prices)
                };
                
                shocks.push(shock);
            }
        }
        
        // Shock clustering analysis
        const shockClusters = this.identifyShockClusters(shocks);
        
        // Shock frequency analysis
        const frequencyAnalysis = this.analyzeShockFrequency(shocks, returns.length);
        
        return {
            shocks: shocks,
            shockClusters: shockClusters,
            frequencyAnalysis: frequencyAnalysis,
            totalShocks: shocks.length,
            recentShocks: shocks.filter(s => s.index > returns.length - 20),
            shockIntensity: this.calculateOverallShockIntensity(shocks),
            shockTrend: this.analyzeShockTrend(shocks)
        };
    }

    analyzeTrendBehavior(prices, returns) {
        // Multiple timeframe trend analysis
        const trendWindows = [10, 20, 50, 100];
        const trends = {};
        
        trendWindows.forEach(window => {
            if (prices.length >= window) {
                trends[`trend_${window}`] = this.calculateTrend(prices.slice(-window));
            }
        });
        
        // Overall trend determination
        const currentTrend = this.determineTrend(trends);
        
        // Trend strength calculation
        const trendStrength = this.calculateTrendStrength(prices, returns, currentTrend);
        
        // Trend consistency analysis
        const trendConsistency = this.analyzeTrendConsistency(trends);
        
        // Trend momentum
        const trendMomentum = this.calculateTrendMomentum(prices, returns);
        
        // Support and resistance levels
        const supportResistance = this.identifySupportResistanceLevels(prices);
        
        return {
            trends: trends,
            currentTrend: currentTrend,
            strength: trendStrength,
            consistency: trendConsistency,
            momentum: trendMomentum,
            supportResistance: supportResistance,
            trendAge: this.calculateTrendAge(prices, currentTrend),
            trendVelocity: this.calculateTrendVelocity(prices),
            trendAcceleration: this.calculateTrendAcceleration(prices)
        };
    }

    analyzeShockImpactOnTrends(shockAnalysis, trendAnalysis) {
        const impacts = [];
        
        shockAnalysis.shocks.forEach(shock => {
            // Analyze trend before and after shock
            const preShockTrend = this.getTrendAtIndex(shock.index - 10, shock.index);
            const postShockTrend = this.getTrendAtIndex(shock.index, shock.index + 10);
            
            const impact = {
                shockIndex: shock.index,
                shockLevel: shock.shockLevel,
                preShockTrend: preShockTrend,
                postShockTrend: postShockTrend,
                trendContinuation: this.assessTrendContinuation(preShockTrend, postShockTrend),
                trendReversal: this.assessTrendReversal(preShockTrend, postShockTrend),
                impactMagnitude: this.calculateImpactMagnitude(preShockTrend, postShockTrend, shock),
                recoveryTime: this.calculateRecoveryTime(shock.index, postShockTrend)
            };
            
            impacts.push(impact);
        });
        
        // Overall impact analysis
        const overallImpact = this.calculateOverallShockImpact(impacts);
        
        return {
            individualImpacts: impacts,
            overallImpact: overallImpact,
            impactPatterns: this.identifyImpactPatterns(impacts),
            trendVulnerability: this.assessTrendVulnerability(impacts, trendAnalysis)
        };
    }

    analyzeRecoveryPatterns(shockAnalysis, trendAnalysis, prices) {
        const recoveryPatterns = [];
        
        shockAnalysis.shocks.forEach(shock => {
            const recoveryPattern = this.analyzeIndividualRecovery(shock, prices, trendAnalysis);
            if (recoveryPattern) {
                recoveryPatterns.push(recoveryPattern);
            }
        });
        
        // Pattern classification
        const patternTypes = this.classifyRecoveryPatterns(recoveryPatterns);
        
        // Recovery efficiency analysis
        const recoveryEfficiency = this.analyzeRecoveryEfficiency(recoveryPatterns);
        
        return {
            patterns: recoveryPatterns,
            patternTypes: patternTypes,
            efficiency: recoveryEfficiency,
            averageRecoveryTime: this.calculateAverageRecoveryTime(recoveryPatterns),
            recoverySuccess: this.calculateRecoverySuccessRate(recoveryPatterns),
            recoveryPredictability: this.assessRecoveryPredictability(recoveryPatterns)
        };
    }

    analyzeTrendContinuation(trendAnalysis, shockAnalysis) {
        const continuationFactors = {
            trendStrength: trendAnalysis.strength,
            trendConsistency: trendAnalysis.consistency,
            recentShocks: shockAnalysis.recentShocks.length,
            shockResistance: this.calculateShockResistance(trendAnalysis, shockAnalysis),
            momentum: trendAnalysis.momentum
        };
        
        // Continuation probability calculation
        const continuationProbability = this.calculateContinuationProbability(continuationFactors);
        
        // Key risk factors
        const riskFactors = this.identifyTrendRiskFactors(continuationFactors, shockAnalysis);
        
        // Continuation confidence
        const confidence = this.calculateContinuationConfidence(continuationFactors);
        
        return {
            probability: continuationProbability,
            confidence: confidence,
            factors: continuationFactors,
            riskFactors: riskFactors,
            outlook: this.determineTrendOutlook(continuationProbability, confidence),
            keyDrivers: this.identifyKeyDrivers(continuationFactors)
        };
    }

    analyzeShockResistance(trendAnalysis, shockAnalysis) {
        const resistanceMetrics = {};
        
        // Resistance by shock level
        ['mild', 'moderate', 'severe', 'extreme'].forEach(level => {
            const levelShocks = shockAnalysis.shocks.filter(s => s.shockLevel === level);
            if (levelShocks.length > 0) {
                resistanceMetrics[level] = this.calculateResistanceForLevel(levelShocks, trendAnalysis);
            }
        });
        
        // Overall resistance score
        const overallResistance = this.calculateOverallResistance(resistanceMetrics);
        
        // Resistance trends
        const resistanceTrends = this.analyzeResistanceTrends(shockAnalysis, trendAnalysis);
        
        return {
            byLevel: resistanceMetrics,
            overallResistance: overallResistance,
            resistanceTrends: resistanceTrends,
            weakestPoints: this.identifyWeakestPoints(resistanceMetrics),
            strengthFactors: this.identifyStrengthFactors(resistanceMetrics, trendAnalysis)
        };
    }

    analyzeMarketStructureImpact(shockAnalysis, liquidityMetrics, microstructureData) {
        if (!liquidityMetrics && !microstructureData) {
            return null;
        }
        
        const structureImpacts = shockAnalysis.shocks.map(shock => {
            return {
                shockIndex: shock.index,
                liquidityImpact: liquidityMetrics ? this.analyzeLiquidityImpact(shock, liquidityMetrics) : null,
                microstructureImpact: microstructureData ? this.analyzeMicrostructureImpact(shock, microstructureData) : null,
                spreadImpact: this.analyzeSpreadImpact(shock),
                depthImpact: this.analyzeDepthImpact(shock)
            };
        });
        
        return {
            individualImpacts: structureImpacts,
            overallStructureImpact: this.calculateOverallStructureImpact(structureImpacts),
            liquidityFragility: this.assessLiquidityFragility(structureImpacts),
            marketResilience: this.assessMarketResilience(structureImpacts)
        };
    }

    analyzeEventCorrelation(shockAnalysis, newsEvents, macroEvents) {
        if (!newsEvents && !macroEvents) {
            return null;
        }
        
        const correlations = [];
        
        shockAnalysis.shocks.forEach(shock => {
            const correlation = {
                shockIndex: shock.index,
                newsCorrelation: newsEvents ? this.findNewsCorrelation(shock, newsEvents) : null,
                macroCorrelation: macroEvents ? this.findMacroCorrelation(shock, macroEvents) : null,
                eventDriven: false
            };
            
            correlation.eventDriven = correlation.newsCorrelation || correlation.macroCorrelation;
            correlations.push(correlation);
        });
        
        const eventDrivenShocks = correlations.filter(c => c.eventDriven);
        
        return {
            correlations: correlations,
            eventDrivenShocks: eventDrivenShocks,
            eventSensitivity: eventDrivenShocks.length / correlations.length,
            unexplainedShocks: correlations.filter(c => !c.eventDriven)
        };
    }

    assessTrendQuality(trendAnalysis, shockResistanceAnalysis, recoveryPatterns) {
        const qualityFactors = {
            strength: trendAnalysis.strength,
            consistency: trendAnalysis.consistency,
            momentum: trendAnalysis.momentum,
            shockResistance: shockResistanceAnalysis.overallResistance,
            recoveryEfficiency: recoveryPatterns.efficiency,
            age: this.normalizeTrendAge(trendAnalysis.trendAge)
        };
        
        // Weight the factors
        const weights = {
            strength: 0.25,
            consistency: 0.20,
            momentum: 0.15,
            shockResistance: 0.20,
            recoveryEfficiency: 0.15,
            age: 0.05
        };
        
        // Calculate weighted score
        const score = Object.keys(qualityFactors).reduce((sum, factor) => {
            return sum + (qualityFactors[factor] * weights[factor]);
        }, 0);
        
        const grade = this.classifyTrendQuality(score);
        
        return {
            score: score,
            grade: grade,
            factors: qualityFactors,
            weights: weights,
            strengths: this.identifyTrendStrengths(qualityFactors),
            weaknesses: this.identifyTrendWeaknesses(qualityFactors),
            improvement: this.suggestTrendImprovement(qualityFactors)
        };
    }

    assessTrendRisk(trendAnalysis, shockAnalysis, volatilityData) {
        const riskFactors = {
            shockFrequency: shockAnalysis.frequencyAnalysis.frequency,
            shockIntensity: shockAnalysis.shockIntensity,
            trendWeakness: 1 - trendAnalysis.strength,
            volatility: volatilityData ? volatilityData.current : this.estimateVolatility(shockAnalysis),
            trendAge: trendAnalysis.trendAge,
            momentum: trendAnalysis.momentum
        };
        
        // Risk score calculation
        const riskScore = this.calculateTrendRiskScore(riskFactors);
        
        // Risk level classification
        const riskLevel = this.classifyRiskLevel(riskScore);
        
        // Risk scenarios
        const scenarios = this.generateRiskScenarios(riskFactors, trendAnalysis);
        
        return {
            riskScore: riskScore,
            riskLevel: riskLevel,
            factors: riskFactors,
            scenarios: scenarios,
            mitigation: this.suggestRiskMitigation(riskFactors, riskLevel),
            monitoring: this.suggestRiskMonitoring(riskFactors)
        };
    }

    generatePredictiveInsights(trendAnalysis, shockAnalysis, recoveryPatterns) {
        // Shock probability prediction
        const shockProbability = this.predictShockProbability(shockAnalysis);
        
        // Trend reversal probability
        const reversalProbability = this.predictReversalProbability(trendAnalysis, shockAnalysis);
        
        // Recovery time prediction
        const recoveryTimePrediction = this.predictRecoveryTime(recoveryPatterns);
        
        // Market behavior prediction
        const behaviorPrediction = this.predictMarketBehavior(trendAnalysis, shockAnalysis);
        
        return {
            shockProbability: shockProbability,
            reversalProbability: reversalProbability,
            recoveryTimePrediction: recoveryTimePrediction,
            behaviorPrediction: behaviorPrediction,
            confidence: this.calculatePredictionConfidence(trendAnalysis, shockAnalysis),
            timeHorizon: this.determinePredictionTimeHorizon(trendAnalysis)
        };
    }

    getCurrentStatus(trendAnalysis, shockAnalysis) {
        const recentShocks = shockAnalysis.recentShocks;
        const currentTrend = trendAnalysis.currentTrend;
        
        return {
            trend: currentTrend,
            trendStrength: trendAnalysis.strength,
            recentShockCount: recentShocks.length,
            shockLevel: recentShocks.length > 0 ? recentShocks[recentShocks.length - 1].shockLevel : 'normal',
            trendHealth: this.assessTrendHealth(trendAnalysis, shockAnalysis),
            marketState: this.determineMarketState(trendAnalysis, shockAnalysis)
        };
    }

    // Helper methods for calculations
    calculateRollingVolatility(returns, window) {
        const volatilities = [];
        
        for (let i = window; i < returns.length; i++) {
            const slice = returns.slice(i - window, i);
            const volatility = this.calculateVolatility(slice);
            volatilities[i] = volatility;
        }
        
        return volatilities;
    }

    calculateVolatility(returns) {
        const mean = returns.reduce((sum, r) => sum + r, 0) / returns.length;
        const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / (returns.length - 1);
        return Math.sqrt(variance);
    }

    classifyShockLevel(return_, expectedVol) {
        const normalizedReturn = Math.abs(return_) / expectedVol;
        
        if (normalizedReturn > 4) return 'extreme';
        if (normalizedReturn > 3) return 'severe';
        if (normalizedReturn > 2.5) return 'moderate';
        if (normalizedReturn > 2) return 'mild';
        return 'normal';
    }

    getShockContext(index, returns, prices) {
        const contextWindow = 5;
        const start = Math.max(0, index - contextWindow);
        const end = Math.min(returns.length, index + contextWindow);
        
        return {
            precedingReturns: returns.slice(start, index),
            followingReturns: returns.slice(index + 1, end),
            priceLevel: prices[index],
            relativePosition: index / returns.length
        };
    }

    identifyShockClusters(shocks) {
        const clusters = [];
        let currentCluster = null;
        const maxGap = 5; // Maximum gap between shocks in a cluster
        
        shocks.forEach(shock => {
            if (!currentCluster || shock.index - currentCluster.lastIndex > maxGap) {
                if (currentCluster) {
                    clusters.push(currentCluster);
                }
                currentCluster = {
                    start: shock.index,
                    end: shock.index,
                    lastIndex: shock.index,
                    shocks: [shock],
                    intensity: shock.magnitude
                };
            } else {
                currentCluster.end = shock.index;
                currentCluster.lastIndex = shock.index;
                currentCluster.shocks.push(shock);
                currentCluster.intensity = Math.max(currentCluster.intensity, shock.magnitude);
            }
        });
        
        if (currentCluster) {
            clusters.push(currentCluster);
        }
        
        return clusters;
    }

    analyzeShockFrequency(shocks, totalPeriods) {
        const frequency = shocks.length / totalPeriods;
        const recentFrequency = shocks.filter(s => s.index > totalPeriods - 50).length / 50;
        
        return {
            frequency: frequency,
            recentFrequency: recentFrequency,
            trend: recentFrequency > frequency ? 'increasing' : recentFrequency < frequency ? 'decreasing' : 'stable',
            classification: this.classifyShockFrequency(frequency)
        };
    }

    classifyShockFrequency(frequency) {
        if (frequency > 0.1) return 'very_high';
        if (frequency > 0.05) return 'high';
        if (frequency > 0.02) return 'moderate';
        if (frequency > 0.01) return 'low';
        return 'very_low';
    }

    calculateOverallShockIntensity(shocks) {
        if (shocks.length === 0) return 0;
        
        const averageIntensity = shocks.reduce((sum, s) => sum + s.magnitude, 0) / shocks.length;
        const maxIntensity = Math.max(...shocks.map(s => s.magnitude));
        
        return {
            average: averageIntensity,
            maximum: maxIntensity,
            classification: this.classifyShockIntensity(averageIntensity)
        };
    }

    classifyShockIntensity(intensity) {
        if (intensity > 5) return 'extreme';
        if (intensity > 4) return 'very_high';
        if (intensity > 3) return 'high';
        if (intensity > 2.5) return 'moderate';
        return 'low';
    }

    analyzeShockTrend(shocks) {
        if (shocks.length < 3) return 'insufficient_data';
        
        const recentShocks = shocks.slice(-10);
        const olderShocks = shocks.slice(0, -10);
        
        if (olderShocks.length === 0) return 'insufficient_data';
        
        const recentAvgIntensity = recentShocks.reduce((sum, s) => sum + s.magnitude, 0) / recentShocks.length;
        const olderAvgIntensity = olderShocks.reduce((sum, s) => sum + s.magnitude, 0) / olderShocks.length;
        
        const intensityRatio = recentAvgIntensity / olderAvgIntensity;
        
        if (intensityRatio > 1.2) return 'intensifying';
        if (intensityRatio < 0.8) return 'diminishing';
        return 'stable';
    }

    calculateTrend(prices) {
        const n = prices.length;
        if (n < 2) return { direction: 'neutral', slope: 0, correlation: 0 };
        
        // Linear regression
        const x = Array.from({ length: n }, (_, i) => i);
        const y = prices;
        
        const sumX = x.reduce((sum, val) => sum + val, 0);
        const sumY = y.reduce((sum, val) => sum + val, 0);
        const sumXY = x.reduce((sum, val, i) => sum + val * y[i], 0);
        const sumX2 = x.reduce((sum, val) => sum + val * val, 0);
        const sumY2 = y.reduce((sum, val) => sum + val * val, 0);
        
        const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
        const correlation = (n * sumXY - sumX * sumY) / 
                          Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));
        
        const direction = slope > 0.001 ? 'upward' : slope < -0.001 ? 'downward' : 'neutral';
        
        return {
            direction: direction,
            slope: slope,
            correlation: Math.abs(correlation) || 0,
            strength: Math.abs(slope) * Math.abs(correlation)
        };
    }

    determineTrend(trends) {
        const trendVotes = {};
        const weights = { trend_10: 0.4, trend_20: 0.3, trend_50: 0.2, trend_100: 0.1 };
        
        Object.keys(trends).forEach(key => {
            const trend = trends[key];
            const weight = weights[key] || 0.1;
            
            if (!trendVotes[trend.direction]) {
                trendVotes[trend.direction] = 0;
            }
            trendVotes[trend.direction] += weight * trend.strength;
        });
        
        return Object.keys(trendVotes).reduce((a, b) => trendVotes[a] > trendVotes[b] ? a : b);
    }

    calculateTrendStrength(prices, returns, currentTrend) {
        // Multiple factors for trend strength
        const factors = {
            consistency: this.calculateTrendConsistency(prices, currentTrend),
            momentum: this.calculateMomentum(returns),
            volume: 0.5, // Simplified - would need volume data
            persistence: this.calculateTrendPersistence(prices, currentTrend)
        };
        
        return Object.values(factors).reduce((sum, val) => sum + val, 0) / Object.keys(factors).length;
    }

    calculateTrendConsistency(prices, currentTrend) {
        if (currentTrend === 'neutral') return 0.5;
        
        const windows = [5, 10, 20];
        let consistentWindows = 0;
        
        windows.forEach(window => {
            if (prices.length >= window) {
                const windowTrend = this.calculateTrend(prices.slice(-window));
                if (windowTrend.direction === currentTrend) {
                    consistentWindows++;
                }
            }
        });
        
        return consistentWindows / windows.length;
    }

    calculateMomentum(returns) {
        const recentReturns = returns.slice(-10);
        if (recentReturns.length === 0) return 0;
        
        const avgReturn = recentReturns.reduce((sum, r) => sum + r, 0) / recentReturns.length;
        return Math.min(1, Math.abs(avgReturn) * 100); // Normalized momentum
    }

    calculateTrendPersistence(prices, currentTrend) {
        if (currentTrend === 'neutral') return 0.5;
        
        let persistentPeriods = 0;
        let totalPeriods = 0;
        
        for (let i = 5; i < prices.length; i += 5) {
            const windowTrend = this.calculateTrend(prices.slice(i - 5, i));
            totalPeriods++;
            if (windowTrend.direction === currentTrend) {
                persistentPeriods++;
            }
        }
        
        return totalPeriods > 0 ? persistentPeriods / totalPeriods : 0.5;
    }

    analyzeTrendConsistency(trends) {
        const directions = Object.values(trends).map(t => t.direction);
        const uniqueDirections = [...new Set(directions)];
        
        if (uniqueDirections.length === 1) return 1; // Perfect consistency
        if (uniqueDirections.length === 2) return 0.5; // Moderate consistency
        return 0; // Low consistency
    }

    calculateTrendMomentum(prices, returns) {
        const recentReturns = returns.slice(-5);
        const momentum = recentReturns.reduce((sum, r) => sum + r, 0);
        
        return {
            value: momentum,
            direction: momentum > 0 ? 'positive' : momentum < 0 ? 'negative' : 'neutral',
            strength: Math.abs(momentum)
        };
    }

    identifySupportResistanceLevels(prices) {
        // Simplified support/resistance identification
        const highs = [];
        const lows = [];
        
        for (let i = 1; i < prices.length - 1; i++) {
            if (prices[i] > prices[i - 1] && prices[i] > prices[i + 1]) {
                highs.push({ price: prices[i], index: i });
            }
            if (prices[i] < prices[i - 1] && prices[i] < prices[i + 1]) {
                lows.push({ price: prices[i], index: i });
            }
        }
        
        return {
            resistance: highs.slice(-3), // Last 3 resistance levels
            support: lows.slice(-3),     // Last 3 support levels
            currentPrice: prices[prices.length - 1]
        };
    }

    calculateTrendAge(prices, currentTrend) {
        let age = 0;
        
        for (let i = prices.length - 5; i >= 5; i -= 5) {
            const windowTrend = this.calculateTrend(prices.slice(i - 5, i));
            if (windowTrend.direction === currentTrend) {
                age += 5;
            } else {
                break;
            }
        }
        
        return age;
    }

    calculateTrendVelocity(prices) {
        if (prices.length < 2) return 0;
        
        const recentChange = prices[prices.length - 1] - prices[prices.length - 2];
        const relativeChange = recentChange / prices[prices.length - 2];
        
        return relativeChange;
    }

    calculateTrendAcceleration(prices) {
        if (prices.length < 3) return 0;
        
        const velocity1 = (prices[prices.length - 1] - prices[prices.length - 2]) / prices[prices.length - 2];
        const velocity2 = (prices[prices.length - 2] - prices[prices.length - 3]) / prices[prices.length - 3];
        
        return velocity1 - velocity2;
    }

    generateRecommendations(trendAnalysis, shockAnalysis, trendQuality) {
        const recommendations = {};
        
        // Trend-based recommendations
        if (trendAnalysis.strength > this.trendStrengthLevels.strong) {
            recommendations.trend = {
                action: 'follow_trend',
                confidence: 'high',
                strategy: 'trend_following'
            };
        } else if (trendAnalysis.strength < this.trendStrengthLevels.weak) {
            recommendations.trend = {
                action: 'avoid_trend_following',
                confidence: 'medium',
                strategy: 'range_trading'
            };
        }
        
        // Shock-based recommendations
        if (shockAnalysis.recentShocks.length > 3) {
            recommendations.shock = {
                action: 'reduce_position_size',
                reason: 'high_shock_frequency',
                timeframe: 'short_term'
            };
        }
        
        // Quality-based recommendations
        if (trendQuality.grade === 'poor') {
            recommendations.quality = {
                action: 'wait_for_confirmation',
                reason: 'poor_trend_quality',
                monitoring: 'enhanced'
            };
        }
        
        return recommendations;
    }

    generateAlerts(shockAnalysis, trendAnalysis, riskAssessment) {
        const alerts = [];
        
        // Extreme shock alert
        const extremeShocks = shockAnalysis.recentShocks.filter(s => s.shockLevel === 'extreme');
        if (extremeShocks.length > 0) {
            alerts.push({
                level: 'critical',
                message: 'Aşırı şok tespit edildi',
                action: 'Pozisyonları gözden geçir'
            });
        }
        
        // High risk alert
        if (riskAssessment.riskLevel === 'high' || riskAssessment.riskLevel === 'very_high') {
            alerts.push({
                level: 'warning',
                message: 'Yüksek trend riski',
                action: 'Risk yönetimi stratejilerini güçlendir'
            });
        }
        
        // Trend weakness alert
        if (trendAnalysis.strength < this.trendStrengthLevels.weak) {
            alerts.push({
                level: 'info',
                message: 'Zayıf trend tespit edildi',
                action: 'Trend takip stratejilerini ertele'
            });
        }
        
        return alerts;
    }

    generateNotes(trendAnalysis, shockAnalysis, trendQuality) {
        const notes = [];
        
        notes.push(`Trend: ${trendAnalysis.currentTrend} (güç: ${(trendAnalysis.strength * 100).toFixed(1)}%)`);
        notes.push(`Şok sayısı: ${shockAnalysis.totalShocks} (son dönem: ${shockAnalysis.recentShocks.length})`);
        notes.push(`Trend kalitesi: ${trendQuality.grade} (skor: ${(trendQuality.score * 100).toFixed(1)}%)`);
        
        if (shockAnalysis.shockIntensity.classification !== 'low') {
            notes.push(`Yüksek şok yoğunluğu: ${shockAnalysis.shockIntensity.classification}`);
        }
        
        return notes.join('. ');
    }

    // Additional helper methods
    getTrendAtIndex(startIndex, endIndex) {
        // This would need access to historical prices at specific indices
        // Simplified implementation
        return 'upward'; // Placeholder
    }

    assessTrendContinuation(preShockTrend, postShockTrend) {
        return preShockTrend === postShockTrend;
    }

    assessTrendReversal(preShockTrend, postShockTrend) {
        const opposites = {
            'upward': 'downward',
            'downward': 'upward',
            'neutral': 'neutral'
        };
        
        return postShockTrend === opposites[preShockTrend];
    }

    calculateImpactMagnitude(preShockTrend, postShockTrend, shock) {
        // Simplified impact magnitude calculation
        let magnitude = shock.magnitude;
        
        if (this.assessTrendReversal(preShockTrend, postShockTrend)) {
            magnitude *= 2; // Reversal increases impact
        }
        
        return magnitude;
    }

    calculateRecoveryTime(shockIndex, postShockTrend) {
        // Simplified recovery time calculation
        return Math.random() * 10; // Placeholder - would need actual implementation
    }

    calculateOverallShockImpact(impacts) {
        if (impacts.length === 0) return { magnitude: 0, pattern: 'none' };
        
        const avgMagnitude = impacts.reduce((sum, i) => sum + i.impactMagnitude, 0) / impacts.length;
        const reversalRate = impacts.filter(i => i.trendReversal).length / impacts.length;
        
        return {
            averageMagnitude: avgMagnitude,
            reversalRate: reversalRate,
            impactPattern: reversalRate > 0.5 ? 'disruptive' : 'contained'
        };
    }

    identifyImpactPatterns(impacts) {
        // Pattern identification logic
        return {
            reversalTendency: impacts.filter(i => i.trendReversal).length / impacts.length,
            recoveryConsistency: impacts.filter(i => i.recoveryTime < 5).length / impacts.length,
            magnitudeConsistency: this.calculateMagnitudeConsistency(impacts)
        };
    }

    calculateMagnitudeConsistency(impacts) {
        if (impacts.length === 0) return 0;
        
        const magnitudes = impacts.map(i => i.impactMagnitude);
        const mean = magnitudes.reduce((sum, m) => sum + m, 0) / magnitudes.length;
        const variance = magnitudes.reduce((sum, m) => sum + Math.pow(m - mean, 2), 0) / magnitudes.length;
        
        return 1 / (1 + variance); // Consistency inversely related to variance
    }

    assessTrendVulnerability(impacts, trendAnalysis) {
        const reversalRate = impacts.filter(i => i.trendReversal).length / impacts.length;
        const avgRecoveryTime = impacts.reduce((sum, i) => sum + i.recoveryTime, 0) / impacts.length;
        
        let vulnerability = 'low';
        
        if (reversalRate > 0.5 || avgRecoveryTime > 10) {
            vulnerability = 'high';
        } else if (reversalRate > 0.3 || avgRecoveryTime > 5) {
            vulnerability = 'moderate';
        }
        
        return {
            level: vulnerability,
            reversalRate: reversalRate,
            avgRecoveryTime: avgRecoveryTime,
            factors: this.identifyVulnerabilityFactors(trendAnalysis, impacts)
        };
    }

    identifyVulnerabilityFactors(trendAnalysis, impacts) {
        const factors = [];
        
        if (trendAnalysis.strength < this.trendStrengthLevels.moderate) {
            factors.push('weak_trend_strength');
        }
        
        if (trendAnalysis.consistency < 0.6) {
            factors.push('low_consistency');
        }
        
        const highImpactShocks = impacts.filter(i => i.impactMagnitude > 3);
        if (highImpactShocks.length > impacts.length * 0.3) {
            factors.push('high_impact_sensitivity');
        }
        
        return factors;
    }

    updateShockTrendHistory(result, data) {
        this.shockHistory.push({
            timestamp: Date.now(),
            shockCount: result.shockAnalysis.totalShocks,
            recentShocks: result.shockAnalysis.recentShocks.length,
            trendStrength: result.trendAnalysis.strength,
            trendQuality: result.trendQuality.score
        });

        this.trendHistory.push({
            timestamp: Date.now(),
            trend: result.trendAnalysis.currentTrend,
            strength: result.trendAnalysis.strength,
            consistency: result.trendAnalysis.consistency,
            momentum: result.trendAnalysis.momentum
        });

        if (this.shockHistory.length > this.maxHistorySize) {
            this.shockHistory = this.shockHistory.slice(-this.maxHistorySize);
        }

        if (this.trendHistory.length > this.maxHistorySize) {
            this.trendHistory = this.trendHistory.slice(-this.maxHistorySize);
        }
    }

    getDefaultResult() {
        return {
            shockAnalysis: {
                shocks: [],
                shockClusters: [],
                frequencyAnalysis: { frequency: 0, classification: 'very_low' },
                totalShocks: 0,
                recentShocks: [],
                shockIntensity: { average: 0, maximum: 0, classification: 'low' },
                shockTrend: 'insufficient_data'
            },
            trendAnalysis: {
                trends: {},
                currentTrend: 'neutral',
                strength: 0.5,
                consistency: 0.5,
                momentum: { value: 0, direction: 'neutral', strength: 0 },
                supportResistance: { resistance: [], support: [], currentPrice: 0 },
                trendAge: 0,
                trendVelocity: 0,
                trendAcceleration: 0
            },
            shockImpactAnalysis: {
                individualImpacts: [],
                overallImpact: { averageMagnitude: 0, reversalRate: 0, impactPattern: 'none' },
                impactPatterns: { reversalTendency: 0, recoveryConsistency: 0, magnitudeConsistency: 0 },
                trendVulnerability: { level: 'low', reversalRate: 0, avgRecoveryTime: 0, factors: [] }
            },
            recoveryPatterns: {
                patterns: [],
                patternTypes: {},
                efficiency: 0.5,
                averageRecoveryTime: 0,
                recoverySuccess: 0.5,
                recoveryPredictability: 0.5
            },
            continuationAnalysis: {
                probability: 0.5,
                confidence: 0.5,
                factors: {},
                riskFactors: [],
                outlook: 'neutral',
                keyDrivers: []
            },
            shockResistanceAnalysis: {
                byLevel: {},
                overallResistance: 0.5,
                resistanceTrends: {},
                weakestPoints: [],
                strengthFactors: []
            },
            structureImpact: null,
            eventCorrelation: null,
            trendQuality: {
                score: 0.5,
                grade: 'fair',
                factors: {},
                weights: {},
                strengths: [],
                weaknesses: [],
                improvement: []
            },
            riskAssessment: {
                riskScore: 0.5,
                riskLevel: 'moderate',
                factors: {},
                scenarios: [],
                mitigation: [],
                monitoring: []
            },
            predictiveAnalysis: {
                shockProbability: 0.5,
                reversalProbability: 0.5,
                recoveryTimePrediction: 5,
                behaviorPrediction: {},
                confidence: 0.5,
                timeHorizon: 10
            },
            currentStatus: {
                trend: 'neutral',
                trendStrength: 0.5,
                recentShockCount: 0,
                shockLevel: 'normal',
                trendHealth: 'fair',
                marketState: 'normal'
            },
            recommendations: {},
            alerts: [],
            notes: "Şok durumları için trend analizi yapılamadı - yetersiz veri",
            metadata: {
                error: true,
                analysisTimestamp: Date.now()
            }
        };
    }

    getModuleInfo() {
        return {
            name: 'ShockAwareTrendMonitor',
            version: '1.0.0',
            description: 'Şok durumlarında trend davranışını izleyen ve trend kalitesini değerlendiren sistem - Trend shock resistance, recovery patterns ve trend continuation analizi',
            inputs: [
                'symbol', 'price', 'historicalPrices', 'volume', 'timeframe', 'marketData',
                'technicalIndicators', 'volatilityData', 'liquidityMetrics', 'orderbook',
                'newsEvents', 'macroEvents', 'marketSentiment', 'correlationData', 'flowData', 'microstructureData'
            ],
            outputs: [
                'shockAnalysis', 'trendAnalysis', 'shockImpactAnalysis', 'recoveryPatterns',
                'continuationAnalysis', 'shockResistanceAnalysis', 'structureImpact', 'eventCorrelation',
                'trendQuality', 'riskAssessment', 'predictiveAnalysis', 'currentStatus',
                'recommendations', 'alerts', 'notes', 'metadata'
            ]
        };
    }
}

module.exports = ShockAwareTrendMonitor;
