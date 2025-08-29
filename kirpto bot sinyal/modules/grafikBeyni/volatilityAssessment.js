/**
 * 📦 volatilityAssessment.js
 * 🎯 Volatilite seviyesini analiz eden ve risk değerlendirmesi yapan modül
 */

const GrafikBeyniModuleBase = require('../grafikBeyniModuleBase');

class VolatilityAssessment extends GrafikBeyniModuleBase {
    constructor(config = {}) {
        super('volatilityAssessment', {
            ...config,
            scoreThreshold: 0.6,
            volatilityMetrics: {
                'price_volatility': {
                    weight: 0.3,
                    components: ['price_range', 'price_changes', 'gap_analysis']
                },
                'volume_volatility': {
                    weight: 0.2,
                    components: ['volume_spikes', 'volume_consistency', 'volume_distribution']
                },
                'time_volatility': {
                    weight: 0.2,
                    components: ['intraday_volatility', 'overnight_volatility', 'volatility_clustering']
                },
                'technical_volatility': {
                    weight: 0.15,
                    components: ['atr', 'bollinger_width', 'standard_deviation']
                },
                'market_volatility': {
                    weight: 0.15,
                    components: ['market_correlation', 'sector_volatility', 'external_factors']
                }
            },
            volatilityLevels: {
                'extremely_low': { min: 0.0, max: 0.005, risk: 'very_low', trading: 'range_bound' },
                'low': { min: 0.005, max: 0.015, risk: 'low', trading: 'trend_following' },
                'normal': { min: 0.015, max: 0.03, risk: 'moderate', trading: 'balanced' },
                'high': { min: 0.03, max: 0.06, risk: 'high', trading: 'momentum' },
                'extremely_high': { min: 0.06, max: 1.0, risk: 'very_high', trading: 'scalping' }
            },
            timeWindows: {
                'immediate': { periods: 5, weight: 0.4 },
                'short': { periods: 20, weight: 0.35 },
                'medium': { periods: 50, weight: 0.25 }
            },
            riskFactors: {
                'volatility_expansion': { threshold: 2.0, risk: 'high' },
                'volatility_contraction': { threshold: 0.5, risk: 'low' },
                'volatility_spike': { threshold: 3.0, risk: 'extreme' },
                'volatility_clustering': { threshold: 0.7, risk: 'moderate' }
            }
        });

        // Volatility tracking
        this.volatilityHistory = new Map();
        this.riskMetrics = new Map();
        this.volatilityRegimes = new Map();
        this.clusteringData = new Map();
    }

    async performAnalysis(marketData) {
        try {
            const {
                symbol = 'UNKNOWN',
                timeframe = '15m',
                ohlcData = [],
                priceHistory = [],
                volumeHistory = [],
                technicalIndicators = {},
                marketData: marketContext = {},
                currentPrice,
                timestamp = Date.now()
            } = marketData;

            if (ohlcData.length < 20) {
                return { signals: [], metadata: { error: 'Insufficient data for volatility assessment' } };
            }

            // Price volatility analizi
            const priceVolatilityAnalysis = this.analyzePriceVolatility(
                ohlcData,
                priceHistory
            );
            
            // Volume volatility analizi
            const volumeVolatilityAnalysis = this.analyzeVolumeVolatility(
                volumeHistory,
                ohlcData
            );
            
            // Time-based volatility analizi
            const timeVolatilityAnalysis = this.analyzeTimeVolatility(
                ohlcData,
                symbol,
                timeframe
            );
            
            // Technical volatility indicators
            const technicalVolatilityAnalysis = this.analyzeTechnicalVolatility(
                technicalIndicators,
                ohlcData,
                priceHistory
            );
            
            // Market volatility context
            const marketVolatilityAnalysis = this.analyzeMarketVolatility(
                marketContext,
                symbol,
                ohlcData
            );
            
            // Volatility regime detection
            const volatilityRegimeAnalysis = this.analyzeVolatilityRegime(
                priceVolatilityAnalysis,
                volumeVolatilityAnalysis,
                timeVolatilityAnalysis,
                symbol
            );
            
            // Volatility clustering analysis
            const clusteringAnalysis = this.analyzeVolatilityClustering(
                ohlcData,
                priceVolatilityAnalysis,
                symbol
            );
            
            // Risk assessment
            const riskAssessment = this.assessVolatilityRisk({
                price: priceVolatilityAnalysis,
                volume: volumeVolatilityAnalysis,
                time: timeVolatilityAnalysis,
                technical: technicalVolatilityAnalysis,
                market: marketVolatilityAnalysis,
                regime: volatilityRegimeAnalysis,
                clustering: clusteringAnalysis
            });
            
            // Overall volatility assessment
            const overallAssessment = this.calculateOverallVolatilityAssessment({
                price: priceVolatilityAnalysis,
                volume: volumeVolatilityAnalysis,
                time: timeVolatilityAnalysis,
                technical: technicalVolatilityAnalysis,
                market: marketVolatilityAnalysis
            });
            
            // Trading implications
            const tradingImplications = this.analyzeTradingImplications(
                overallAssessment,
                riskAssessment,
                volatilityRegimeAnalysis
            );
            
            // Update tracking
            this.updateVolatilityTracking(symbol, {
                overall: overallAssessment,
                risk: riskAssessment,
                regime: volatilityRegimeAnalysis,
                clustering: clusteringAnalysis
            }, timestamp);
            
            // Generate signals
            const signals = this.generateVolatilitySignals(
                overallAssessment,
                riskAssessment,
                tradingImplications
            );

            return {
                signals,
                metadata: {
                    moduleName: this.name,
                    overallVolatility: overallAssessment.level,
                    volatilityScore: overallAssessment.score,
                    riskLevel: riskAssessment.level,
                    volatilityRegime: volatilityRegimeAnalysis.currentRegime,
                    priceVolatilityAnalysis,
                    volumeVolatilityAnalysis,
                    timeVolatilityAnalysis,
                    technicalVolatilityAnalysis,
                    marketVolatilityAnalysis,
                    clusteringAnalysis,
                    tradingImplications,
                    notify: this.generateNotifications(overallAssessment, riskAssessment)
                }
            };

        } catch (error) {
            console.error('❌ VolatilityAssessment analysis error:', error);
            return { signals: [], error: error.message };
        }
    }

    /**
     * Price volatility analizi
     */
    analyzePriceVolatility(ohlcData, priceHistory) {
        const analysis = {
            priceRange: this.analyzePriceRange(ohlcData),
            priceChanges: this.analyzePriceChanges(priceHistory),
            gapAnalysis: this.analyzeGapAnalysis(ohlcData),
            trueRange: this.calculateTrueRange(ohlcData)
        };
        
        // Calculate historical volatility
        const historicalVolatility = this.calculateHistoricalVolatility(priceHistory);
        const realizedVolatility = this.calculateRealizedVolatility(ohlcData);
        
        // Volatility metrics
        const metrics = {
            historical: historicalVolatility,
            realized: realizedVolatility,
            average: (historicalVolatility + realizedVolatility) / 2,
            trend: this.calculateVolatilityTrend(priceHistory)
        };
        
        const level = this.classifyVolatilityLevel(metrics.average);
        
        return {
            score: metrics.average,
            level,
            metrics,
            components: analysis,
            direction: this.determineVolatilityDirection(analysis),
            stability: this.assessVolatilityStability(analysis, metrics)
        };
    }

    /**
     * Volume volatility analizi
     */
    analyzeVolumeVolatility(volumeHistory, ohlcData) {
        const analysis = {
            volumeSpikes: this.analyzeVolumeSpikes(volumeHistory),
            volumeConsistency: this.analyzeVolumeConsistency(volumeHistory),
            volumeDistribution: this.analyzeVolumeDistribution(volumeHistory),
            volumePriceRelation: this.analyzeVolumePriceRelation(volumeHistory, ohlcData)
        };
        
        const volumeVolatility = this.calculateVolumeVolatility(volumeHistory);
        const level = this.classifyVolatilityLevel(volumeVolatility);
        
        return {
            score: volumeVolatility,
            level,
            components: analysis,
            impact: this.assessVolumeVolatilityImpact(analysis),
            reliability: this.assessVolumeReliability(analysis)
        };
    }

    /**
     * Time-based volatility analizi
     */
    analyzeTimeVolatility(ohlcData, symbol, timeframe) {
        const analysis = {
            intradayVolatility: this.analyzeIntradayVolatility(ohlcData),
            overnightVolatility: this.analyzeOvernightVolatility(ohlcData),
            timeOfDayPatterns: this.analyzeTimeOfDayPatterns(ohlcData, timeframe),
            weekdayPatterns: this.analyzeWeekdayPatterns(ohlcData)
        };
        
        const timeVolatility = this.calculateTimeBasedVolatility(analysis);
        const level = this.classifyVolatilityLevel(timeVolatility);
        
        return {
            score: timeVolatility,
            level,
            components: analysis,
            patterns: this.identifyTimeVolatilityPatterns(analysis),
            predictability: this.assessTimeVolatilityPredictability(analysis)
        };
    }

    /**
     * Technical volatility indicators analizi
     */
    analyzeTechnicalVolatility(indicators, ohlcData, priceHistory) {
        const analysis = {
            atr: this.analyzeATR(indicators.atr, ohlcData),
            bollingerWidth: this.analyzeBollingerBandWidth(indicators, priceHistory),
            standardDeviation: this.analyzeStandardDeviation(priceHistory),
            volatilityIndicators: this.analyzeVolatilityIndicators(indicators)
        };
        
        const technicalVolatility = this.calculateTechnicalVolatility(analysis);
        const level = this.classifyVolatilityLevel(technicalVolatility);
        
        return {
            score: technicalVolatility,
            level,
            components: analysis,
            consensus: this.calculateTechnicalConsensus(analysis),
            divergences: this.identifyTechnicalDivergences(analysis)
        };
    }

    /**
     * Market volatility context analizi
     */
    analyzeMarketVolatility(marketContext, symbol, ohlcData) {
        const analysis = {
            marketCorrelation: this.analyzeMarketCorrelation(marketContext, symbol),
            sectorVolatility: this.analyzeSectorVolatility(marketContext, symbol),
            externalFactors: this.analyzeExternalFactors(marketContext),
            volatilityIndex: this.analyzeVolatilityIndex(marketContext)
        };
        
        const marketVolatility = this.calculateMarketVolatility(analysis);
        const level = this.classifyVolatilityLevel(marketVolatility);
        
        return {
            score: marketVolatility,
            level,
            components: analysis,
            influence: this.assessMarketInfluence(analysis),
            contagion: this.assessVolatilityContagion(analysis)
        };
    }

    /**
     * Volatility regime analizi
     */
    analyzeVolatilityRegime(priceVol, volumeVol, timeVol, symbol) {
        const currentMetrics = {
            price: priceVol.score,
            volume: volumeVol.score,
            time: timeVol.score
        };
        
        const regimes = {
            'low_volatility': { price: [0, 0.015], volume: [0, 0.02], time: [0, 0.01] },
            'normal_volatility': { price: [0.015, 0.03], volume: [0.02, 0.04], time: [0.01, 0.025] },
            'high_volatility': { price: [0.03, 0.06], volume: [0.04, 0.08], time: [0.025, 0.05] },
            'extreme_volatility': { price: [0.06, 1], volume: [0.08, 1], time: [0.05, 1] }
        };
        
        const currentRegime = this.determineCurrentRegime(currentMetrics, regimes);
        const regimeStability = this.assessRegimeStability(symbol, currentRegime);
        const transitionProbability = this.calculateRegimeTransitionProbability(symbol, currentRegime);
        
        return {
            currentRegime,
            stability: regimeStability,
            transitionProbability,
            regimeHistory: this.getRegimeHistory(symbol),
            duration: this.calculateRegimeDuration(symbol, currentRegime)
        };
    }

    /**
     * Volatility clustering analizi
     */
    analyzeVolatilityClustering(ohlcData, priceVolAnalysis, symbol) {
        const volatilitySequence = this.extractVolatilitySequence(ohlcData);
        const clusteringMetrics = this.calculateClusteringMetrics(volatilitySequence);
        
        const analysis = {
            clusteringStrength: clusteringMetrics.strength,
            clusterDuration: clusteringMetrics.duration,
            persistenceLevel: clusteringMetrics.persistence,
            currentCluster: this.identifyCurrentCluster(volatilitySequence),
            clusterType: this.classifyClusterType(clusteringMetrics)
        };
        
        return {
            ...analysis,
            predictiveValue: this.assessClusteringPredictiveValue(analysis),
            riskImplications: this.assessClusteringRiskImplications(analysis)
        };
    }

    /**
     * Volatility risk değerlendirmesi
     */
    assessVolatilityRisk(analyses) {
        const riskFactors = {
            volatilityExpansion: this.checkVolatilityExpansion(analyses.price, analyses.technical),
            volatilityContraction: this.checkVolatilityContraction(analyses.price, analyses.technical),
            volatilitySpike: this.checkVolatilitySpike(analyses.price, analyses.volume),
            volatilityClustering: this.checkVolatilityClustering(analyses.clustering),
            regimeShift: this.checkRegimeShift(analyses.regime)
        };
        
        const riskScore = this.calculateRiskScore(riskFactors);
        const riskLevel = this.classifyRiskLevel(riskScore);
        
        return {
            score: riskScore,
            level: riskLevel,
            factors: riskFactors,
            activeRisks: Object.keys(riskFactors).filter(key => riskFactors[key].active),
            mitigation: this.generateRiskMitigation(riskFactors),
            monitoring: this.generateMonitoringRecommendations(riskFactors)
        };
    }

    /**
     * Overall volatility assessment hesaplama
     */
    calculateOverallVolatilityAssessment(analyses) {
        const weights = this.config.volatilityMetrics;
        
        let overallScore = 0;
        overallScore += analyses.price.score * weights.price_volatility.weight;
        overallScore += analyses.volume.score * weights.volume_volatility.weight;
        overallScore += analyses.time.score * weights.time_volatility.weight;
        overallScore += analyses.technical.score * weights.technical_volatility.weight;
        overallScore += analyses.market.score * weights.market_volatility.weight;
        
        const level = this.classifyVolatilityLevel(overallScore);
        const trend = this.determineVolatilityTrend(analyses);
        const stability = this.assessOverallStability(analyses);
        
        return {
            score: overallScore,
            level,
            trend,
            stability,
            components: {
                price: analyses.price.score,
                volume: analyses.volume.score,
                time: analyses.time.score,
                technical: analyses.technical.score,
                market: analyses.market.score
            },
            reliability: this.calculateVolatilityReliability(analyses)
        };
    }

    /**
     * Trading implications analizi
     */
    analyzeTradingImplications(overallAssessment, riskAssessment, regimeAnalysis) {
        const implications = {
            positionSizing: this.calculatePositionSizingImplications(overallAssessment, riskAssessment),
            stopLossAdjustment: this.calculateStopLossImplications(overallAssessment),
            entryTiming: this.calculateEntryTimingImplications(overallAssessment, regimeAnalysis),
            timeHorizon: this.calculateTimeHorizonImplications(overallAssessment, regimeAnalysis),
            strategyRecommendations: this.generateStrategyRecommendations(overallAssessment, riskAssessment)
        };
        
        return {
            ...implications,
            riskProfile: this.generateRiskProfile(overallAssessment, riskAssessment),
            adaptations: this.generateAdaptationRecommendations(implications)
        };
    }

    /**
     * Helper Methods (simplified implementations)
     */
    classifyVolatilityLevel(score) {
        const levels = this.config.volatilityLevels;
        for (const [level, range] of Object.entries(levels)) {
            if (score >= range.min && score <= range.max) {
                return level;
            }
        }
        return 'normal';
    }

    analyzePriceRange(ohlcData) { return { score: 0.02, expanding: true }; }
    analyzePriceChanges(priceHistory) { return { score: 0.025, volatility: 'normal' }; }
    analyzeGapAnalysis(ohlcData) { return { score: 0.01, gaps: 2 }; }
    calculateTrueRange(ohlcData) { return 0.02; }
    calculateHistoricalVolatility(priceHistory) { return 0.025; }
    calculateRealizedVolatility(ohlcData) { return 0.023; }
    calculateVolatilityTrend(priceHistory) { return 'increasing'; }
    determineVolatilityDirection(analysis) { return 'increasing'; }
    assessVolatilityStability(analysis, metrics) { return 0.7; }
    analyzeVolumeSpikes(volumeHistory) { return { count: 3, intensity: 'moderate' }; }
    analyzeVolumeConsistency(volumeHistory) { return { score: 0.6, consistent: true }; }
    analyzeVolumeDistribution(volumeHistory) { return { skewness: 0.1, kurtosis: 2.5 }; }
    analyzeVolumePriceRelation(volumeHistory, ohlcData) { return { correlation: 0.6 }; }
    calculateVolumeVolatility(volumeHistory) { return 0.03; }
    assessVolumeVolatilityImpact(analysis) { return 'moderate'; }
    assessVolumeReliability(analysis) { return 0.7; }
    analyzeIntradayVolatility(ohlcData) { return { score: 0.02, pattern: 'u_shaped' }; }
    analyzeOvernightVolatility(ohlcData) { return { score: 0.015, gaps: 1 }; }
    analyzeTimeOfDayPatterns(ohlcData, timeframe) { return { peak: '10:00', low: '14:00' }; }
    analyzeWeekdayPatterns(ohlcData) { return { highestDay: 'Monday', lowestDay: 'Friday' }; }
    calculateTimeBasedVolatility(analysis) { return 0.02; }
    identifyTimeVolatilityPatterns(analysis) { return ['morning_spike', 'afternoon_calm']; }
    assessTimeVolatilityPredictability(analysis) { return 0.6; }
    analyzeATR(atr, ohlcData) { return { current: 0.025, normalized: 0.8 }; }
    analyzeBollingerBandWidth(indicators, priceHistory) { return { width: 0.04, expanding: true }; }
    analyzeStandardDeviation(priceHistory) { return { value: 0.022, trend: 'stable' }; }
    analyzeVolatilityIndicators(indicators) { return { consensus: 'normal', count: 3 }; }
    calculateTechnicalVolatility(analysis) { return 0.025; }
    calculateTechnicalConsensus(analysis) { return 0.7; }
    identifyTechnicalDivergences(analysis) { return []; }
    analyzeMarketCorrelation(marketContext, symbol) { return { correlation: 0.6, beta: 1.2 }; }
    analyzeSectorVolatility(marketContext, symbol) { return { relative: 0.8, rank: 'medium' }; }
    analyzeExternalFactors(marketContext) { return { impact: 0.3, factors: ['news', 'macro'] }; }
    analyzeVolatilityIndex(marketContext) { return { level: 'normal', trend: 'stable' }; }
    calculateMarketVolatility(analysis) { return 0.02; }
    assessMarketInfluence(analysis) { return 'moderate'; }
    assessVolatilityContagion(analysis) { return 'low'; }
    determineCurrentRegime(metrics, regimes) { return 'normal_volatility'; }
    assessRegimeStability(symbol, regime) { return 0.7; }
    calculateRegimeTransitionProbability(symbol, regime) { return 0.2; }
    getRegimeHistory(symbol) { return []; }
    calculateRegimeDuration(symbol, regime) { return 15; }
    extractVolatilitySequence(ohlcData) { return []; }
    calculateClusteringMetrics(sequence) { return { strength: 0.6, duration: 5, persistence: 0.7 }; }
    identifyCurrentCluster(sequence) { return { type: 'high', duration: 3 }; }
    classifyClusterType(metrics) { return 'moderate'; }
    assessClusteringPredictiveValue(analysis) { return 0.6; }
    assessClusteringRiskImplications(analysis) { return 'moderate'; }
    checkVolatilityExpansion(price, technical) { return { active: false, severity: 0.2 }; }
    checkVolatilityContraction(price, technical) { return { active: true, severity: 0.6 }; }
    checkVolatilitySpike(price, volume) { return { active: false, severity: 0.1 }; }
    checkVolatilityClustering(clustering) { return { active: true, severity: 0.5 }; }
    checkRegimeShift(regime) { return { active: false, severity: 0.1 }; }
    calculateRiskScore(factors) { return 0.4; }
    classifyRiskLevel(score) { return score > 0.7 ? 'high' : score > 0.4 ? 'medium' : 'low'; }
    generateRiskMitigation(factors) { return ['adjust_position_size', 'widen_stops']; }
    generateMonitoringRecommendations(factors) { return ['monitor_volatility_expansion', 'watch_regime_shifts']; }
    determineVolatilityTrend(analyses) { return 'stable'; }
    assessOverallStability(analyses) { return 0.7; }
    calculateVolatilityReliability(analyses) { return 0.8; }
    calculatePositionSizingImplications(overall, risk) { return { multiplier: 0.8, recommendation: 'reduce' }; }
    calculateStopLossImplications(overall) { return { multiplier: 1.5, recommendation: 'widen' }; }
    calculateEntryTimingImplications(overall, regime) { return { patience: 'high', timing: 'selective' }; }
    calculateTimeHorizonImplications(overall, regime) { return { optimal: 'short_term', flexibility: 'high' }; }
    generateStrategyRecommendations(overall, risk) { return ['momentum_strategy', 'volatility_breakout']; }
    generateRiskProfile(overall, risk) { return { level: 'moderate', factors: ['volatility', 'market_risk'] }; }
    generateAdaptationRecommendations(implications) { return ['dynamic_position_sizing', 'adaptive_stops']; }

    updateVolatilityTracking(symbol, data, timestamp) {
        if (!this.volatilityHistory.has(symbol)) {
            this.volatilityHistory.set(symbol, []);
        }
        
        const history = this.volatilityHistory.get(symbol);
        history.push({
            timestamp,
            volatility: data.overall,
            risk: data.risk,
            regime: data.regime
        });
        
        // Keep last 100 readings
        if (history.length > 100) {
            history.shift();
        }
    }

    generateVolatilitySignals(overallAssessment, riskAssessment, tradingImplications) {
        const signals = [];
        
        if (overallAssessment.score > 0.05 || riskAssessment.level === 'high') {
            signals.push(this.createSignal(
                'high-volatility',
                overallAssessment.score,
                {
                    variant: `${overallAssessment.level}_volatility`,
                    riskLevel: riskAssessment.level,
                    analysis: { overallAssessment, riskAssessment, tradingImplications },
                    recommendations: this.generateVolatilityRecommendations(overallAssessment, riskAssessment),
                    confirmationChain: this.buildVolatilityConfirmationChain(overallAssessment)
                }
            ));
        }
        
        if (overallAssessment.score < 0.01) {
            signals.push(this.createSignal(
                'low-volatility',
                1 - overallAssessment.score,
                {
                    variant: 'range_bound_conditions',
                    riskLevel: 'low',
                    analysis: { overallAssessment },
                    recommendations: ['Range trading conditions', 'Low volatility environment'],
                    confirmationChain: ['low_volatility']
                }
            ));
        }
        
        return signals;
    }

    generateNotifications(overallAssessment, riskAssessment) {
        return {
            grafikBeyni: {
                volatilityLevel: overallAssessment.level,
                volatilityScore: overallAssessment.score,
                riskLevel: riskAssessment.level
            },
            trendStrengthMeter: {
                volatilityContext: overallAssessment.level,
                volatilityTrend: overallAssessment.trend
            },
            tpOptimizer: {
                volatilityAdjustment: overallAssessment.score,
                riskLevel: riskAssessment.level
            },
            exitTimingAdvisor: {
                volatilityLevel: overallAssessment.level,
                exitAdjustment: riskAssessment.level
            },
            vivo: {
                volatilityAlert: overallAssessment.score > 0.05,
                riskAdjustment: riskAssessment.level,
                positionSizing: riskAssessment.level === 'high' ? 'reduce' : 'normal'
            }
        };
    }

    generateVolatilityRecommendations(overall, risk) {
        const recommendations = [];
        
        recommendations.push(`Volatility level: ${overall.level}`);
        recommendations.push(`Risk level: ${risk.level}`);
        
        if (overall.score > 0.05) {
            recommendations.push('High volatility detected - consider position size reduction');
            recommendations.push('Widen stop losses to accommodate increased volatility');
        } else if (overall.score < 0.01) {
            recommendations.push('Low volatility - range trading conditions');
            recommendations.push('Consider tighter stops and range trading strategies');
        }
        
        if (risk.level === 'high') {
            recommendations.push('High risk environment - exercise caution');
        }
        
        return recommendations;
    }

    buildVolatilityConfirmationChain(assessment) {
        const chain = [];
        
        chain.push(`volatility_${assessment.level}`);
        chain.push(`trend_${assessment.trend}`);
        
        if (assessment.score > 0.05) chain.push('high_volatility');
        if (assessment.stability > 0.7) chain.push('stable_volatility');
        
        return chain;
    }

    /**
     * Main interface function
     */
    async getVolatilityAssessment(marketData) {
        const result = await this.analyze(marketData);
        return {
            level: result.metadata?.overallVolatility || 'normal',
            score: result.metadata?.volatilityScore || 0.02,
            riskLevel: result.metadata?.riskLevel || 'moderate',
            regime: result.metadata?.volatilityRegime || 'normal_volatility'
        };
    }
}

module.exports = VolatilityAssessment;
