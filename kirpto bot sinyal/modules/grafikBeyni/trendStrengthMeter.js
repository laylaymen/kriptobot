/**
 * 📦 trendStrengthMeter.js
 * 🎯 Trend gücünü çok boyutlu analiz eden modül
 */

const GrafikBeyniModuleBase = require('../grafikBeyniModuleBase');

class TrendStrengthMeter extends GrafikBeyniModuleBase {
    constructor(config = {}) {
        super('trendStrengthMeter', {
            ...config,
            scoreThreshold: 0.6,
            trendIndicators: {
                'price_action': {
                    weight: 0.25,
                    components: ['swing_structure', 'price_momentum', 'continuation_patterns']
                },
                'volume_analysis': {
                    weight: 0.20,
                    components: ['volume_trend', 'volume_confirmation', 'accumulation_distribution']
                },
                'technical_indicators': {
                    weight: 0.25,
                    components: ['moving_averages', 'momentum_oscillators', 'trend_indicators']
                },
                'market_structure': {
                    weight: 0.15,
                    components: ['support_resistance', 'breakouts', 'range_expansion']
                },
                'time_analysis': {
                    weight: 0.15,
                    components: ['trend_duration', 'pullback_frequency', 'momentum_acceleration']
                }
            },
            strengthLevels: {
                'very_strong': { min: 0.85, max: 1.0, reliability: 0.95 },
                'strong': { min: 0.70, max: 0.84, reliability: 0.85 },
                'moderate': { min: 0.55, max: 0.69, reliability: 0.70 },
                'weak': { min: 0.40, max: 0.54, reliability: 0.50 },
                'very_weak': { min: 0.0, max: 0.39, reliability: 0.30 }
            },
            timeframes: {
                'short': { periods: 10, weight: 0.2 },
                'medium': { periods: 25, weight: 0.5 },
                'long': { periods: 50, weight: 0.3 }
            }
        });

        // Trend tracking
        this.trendHistory = new Map();
        this.strengthHistory = new Map();
        this.momentumHistory = new Map();
        this.divergenceTracker = new Map();
    }

    async performAnalysis(marketData) {
        try {
            const {
                symbol = 'UNKNOWN',
                timeframe = '15m',
                priceHistory = [],
                volumeHistory = [],
                ohlcData = [],
                technicalIndicators = {},
                supportResistanceLevels = [],
                movingAverages = {},
                currentPrice,
                trendDirection = 'neutral',
                timestamp = Date.now()
            } = marketData;

            if (priceHistory.length < 50) {
                return { signals: [], metadata: { error: 'Insufficient data for trend strength analysis' } };
            }

            // Price action strength analizi
            const priceActionStrength = this.analyzePriceActionStrength(
                priceHistory,
                ohlcData,
                supportResistanceLevels
            );
            
            // Volume strength analizi
            const volumeStrength = this.analyzeVolumeStrength(
                volumeHistory,
                priceHistory,
                trendDirection
            );
            
            // Technical indicator strength
            const technicalStrength = this.analyzeTechnicalIndicatorStrength(
                technicalIndicators,
                movingAverages,
                priceHistory
            );
            
            // Market structure strength
            const marketStructureStrength = this.analyzeMarketStructureStrength(
                supportResistanceLevels,
                priceHistory,
                ohlcData
            );
            
            // Time-based strength analysis
            const timeBasedStrength = this.analyzeTimeBasedStrength(
                priceHistory,
                volumeHistory,
                symbol
            );
            
            // Multi-timeframe strength
            const multiTimeframeStrength = this.analyzeMultiTimeframeStrength({
                priceAction: priceActionStrength,
                volume: volumeStrength,
                technical: technicalStrength,
                structure: marketStructureStrength,
                time: timeBasedStrength
            });
            
            // Trend divergence analysis
            const divergenceAnalysis = this.analyzeTrendDivergence(
                priceHistory,
                volumeHistory,
                technicalIndicators,
                symbol
            );
            
            // Overall trend strength calculation
            const overallStrength = this.calculateOverallTrendStrength({
                priceAction: priceActionStrength,
                volume: volumeStrength,
                technical: technicalStrength,
                structure: marketStructureStrength,
                time: timeBasedStrength,
                multiTimeframe: multiTimeframeStrength,
                divergence: divergenceAnalysis
            });
            
            // Trend sustainability assessment
            const sustainabilityAssessment = this.assessTrendSustainability(
                overallStrength,
                divergenceAnalysis,
                timeBasedStrength
            );
            
            // Update tracking
            this.updateTrendTracking(symbol, {
                strength: overallStrength,
                sustainability: sustainabilityAssessment,
                components: {
                    priceAction: priceActionStrength,
                    volume: volumeStrength,
                    technical: technicalStrength,
                    structure: marketStructureStrength,
                    time: timeBasedStrength
                }
            }, timestamp);
            
            // Generate signals
            const signals = this.generateTrendStrengthSignals(
                overallStrength,
                sustainabilityAssessment,
                divergenceAnalysis
            );

            return {
                signals,
                metadata: {
                    moduleName: this.name,
                    overallStrength: overallStrength.level,
                    strengthScore: overallStrength.score,
                    trendDirection: overallStrength.direction,
                    sustainability: sustainabilityAssessment.level,
                    priceActionStrength,
                    volumeStrength,
                    technicalStrength,
                    marketStructureStrength,
                    timeBasedStrength,
                    multiTimeframeStrength,
                    divergenceAnalysis,
                    notify: this.generateNotifications(overallStrength, sustainabilityAssessment)
                }
            };

        } catch (error) {
            console.error('❌ TrendStrengthMeter analysis error:', error);
            return { signals: [], error: error.message };
        }
    }

    /**
     * Price action strength analizi
     */
    analyzePriceActionStrength(priceHistory, ohlcData, srLevels) {
        const analysis = {
            swingStructure: this.analyzeSwingStructure(priceHistory, ohlcData),
            priceMomentum: this.analyzePriceMomentum(priceHistory),
            continuationPatterns: this.analyzeContinuationPatterns(ohlcData),
            breakoutStrength: this.analyzeBreakoutStrength(priceHistory, srLevels)
        };
        
        // Calculate weighted score
        const weights = { swingStructure: 0.3, priceMomentum: 0.3, continuationPatterns: 0.2, breakoutStrength: 0.2 };
        const score = Object.keys(weights).reduce((sum, key) => 
            sum + (analysis[key].score * weights[key]), 0);
        
        return {
            score,
            level: this.classifyStrengthLevel(score),
            components: analysis,
            direction: this.determinePriceActionDirection(analysis),
            confidence: this.calculatePriceActionConfidence(analysis)
        };
    }

    /**
     * Volume strength analizi
     */
    analyzeVolumeStrength(volumeHistory, priceHistory, trendDirection) {
        const analysis = {
            volumeTrend: this.analyzeVolumeTrend(volumeHistory),
            volumeConfirmation: this.analyzeVolumeConfirmation(volumeHistory, priceHistory, trendDirection),
            accumulationDistribution: this.analyzeAccumulationDistribution(volumeHistory, priceHistory),
            volumeMomentum: this.analyzeVolumeMomentum(volumeHistory)
        };
        
        const weights = { volumeTrend: 0.25, volumeConfirmation: 0.35, accumulationDistribution: 0.25, volumeMomentum: 0.15 };
        const score = Object.keys(weights).reduce((sum, key) => 
            sum + (analysis[key].score * weights[key]), 0);
        
        return {
            score,
            level: this.classifyStrengthLevel(score),
            components: analysis,
            supportsTrend: this.doesVolumeSupportTrend(analysis, trendDirection),
            divergenceRisk: this.assessVolumeDivergenceRisk(analysis)
        };
    }

    /**
     * Technical indicator strength analizi
     */
    analyzeTechnicalIndicatorStrength(indicators, movingAverages, priceHistory) {
        const analysis = {
            movingAverageAlignment: this.analyzeMAAlignment(movingAverages, priceHistory),
            momentumOscillators: this.analyzeMomentumOscillators(indicators),
            trendIndicators: this.analyzeTrendIndicators(indicators),
            volatilityIndicators: this.analyzeVolatilityIndicators(indicators)
        };
        
        const weights = { movingAverageAlignment: 0.4, momentumOscillators: 0.25, trendIndicators: 0.25, volatilityIndicators: 0.1 };
        const score = Object.keys(weights).reduce((sum, key) => 
            sum + (analysis[key].score * weights[key]), 0);
        
        return {
            score,
            level: this.classifyStrengthLevel(score),
            components: analysis,
            consensus: this.calculateIndicatorConsensus(analysis),
            divergences: this.identifyIndicatorDivergences(analysis, priceHistory)
        };
    }

    /**
     * Market structure strength analizi
     */
    analyzeMarketStructureStrength(srLevels, priceHistory, ohlcData) {
        const analysis = {
            supportResistanceQuality: this.analyzeSRQuality(srLevels, priceHistory),
            breakoutFrequency: this.analyzeBreakoutFrequency(srLevels, priceHistory),
            rangeExpansion: this.analyzeRangeExpansion(ohlcData),
            structuralShifts: this.analyzeStructuralShifts(priceHistory, srLevels)
        };
        
        const weights = { supportResistanceQuality: 0.3, breakoutFrequency: 0.3, rangeExpansion: 0.2, structuralShifts: 0.2 };
        const score = Object.keys(weights).reduce((sum, key) => 
            sum + (analysis[key].score * weights[key]), 0);
        
        return {
            score,
            level: this.classifyStrengthLevel(score),
            components: analysis,
            structuralBias: this.determineStructuralBias(analysis),
            breakoutPotential: this.assessBreakoutPotential(analysis)
        };
    }

    /**
     * Time-based strength analizi
     */
    analyzeTimeBasedStrength(priceHistory, volumeHistory, symbol) {
        const analysis = {
            trendDuration: this.analyzeTrendDuration(priceHistory, symbol),
            pullbackFrequency: this.analyzePullbackFrequency(priceHistory),
            momentumAcceleration: this.analyzeMomentumAcceleration(priceHistory),
            cyclicalPatterns: this.analyzeCyclicalPatterns(priceHistory, symbol)
        };
        
        const weights = { trendDuration: 0.3, pullbackFrequency: 0.25, momentumAcceleration: 0.25, cyclicalPatterns: 0.2 };
        const score = Object.keys(weights).reduce((sum, key) => 
            sum + (analysis[key].score * weights[key]), 0);
        
        return {
            score,
            level: this.classifyStrengthLevel(score),
            components: analysis,
            maturity: this.assessTrendMaturity(analysis),
            exhaustionRisk: this.assessExhaustionRisk(analysis)
        };
    }

    /**
     * Multi-timeframe strength analizi
     */
    analyzeMultiTimeframeStrength(components) {
        const timeframes = this.config.timeframes;
        const mtfScores = {};
        
        Object.keys(timeframes).forEach(tf => {
            const tfWeight = timeframes[tf].weight;
            const tfScore = Object.keys(components).reduce((sum, component) => {
                return sum + (components[component].score * 0.2); // Equal weight for simplification
            }, 0);
            
            mtfScores[tf] = tfScore * tfWeight;
        });
        
        const overallMTFScore = Object.values(mtfScores).reduce((sum, score) => sum + score, 0);
        
        return {
            score: overallMTFScore,
            level: this.classifyStrengthLevel(overallMTFScore),
            timeframeScores: mtfScores,
            alignment: this.assessTimeframeAlignment(mtfScores),
            conflictLevel: this.calculateTimeframeConflict(mtfScores)
        };
    }

    /**
     * Trend divergence analizi
     */
    analyzeTrendDivergence(priceHistory, volumeHistory, indicators, symbol) {
        const divergences = {
            priceVolume: this.analyzePriceVolumeDivergence(priceHistory, volumeHistory),
            priceIndicator: this.analyzePriceIndicatorDivergence(priceHistory, indicators),
            interIndicator: this.analyzeInterIndicatorDivergence(indicators),
            timeframeDivergence: this.analyzeTimeframeDivergence(symbol)
        };
        
        const divergenceScore = this.calculateDivergenceScore(divergences);
        const riskLevel = this.assessDivergenceRisk(divergences);
        
        return {
            divergences,
            score: divergenceScore,
            riskLevel,
            significance: this.assessDivergenceSignificance(divergences),
            warningLevel: this.calculateDivergenceWarningLevel(divergences)
        };
    }

    /**
     * Overall trend strength hesaplama
     */
    calculateOverallTrendStrength(analyses) {
        const weights = this.config.trendIndicators;
        
        let overallScore = 0;
        overallScore += analyses.priceAction.score * weights.price_action.weight;
        overallScore += analyses.volume.score * weights.volume_analysis.weight;
        overallScore += analyses.technical.score * weights.technical_indicators.weight;
        overallScore += analyses.structure.score * weights.market_structure.weight;
        overallScore += analyses.time.score * weights.time_analysis.weight;
        
        // Apply divergence penalty
        const divergencePenalty = analyses.divergence.score * 0.1;
        overallScore = Math.max(0, overallScore - divergencePenalty);
        
        const strengthLevel = this.classifyStrengthLevel(overallScore);
        const direction = this.determineOverallDirection(analyses);
        const reliability = this.calculateReliability(overallScore, analyses.divergence.riskLevel);
        
        return {
            score: overallScore,
            level: strengthLevel,
            direction,
            reliability,
            components: {
                priceAction: analyses.priceAction.score,
                volume: analyses.volume.score,
                technical: analyses.technical.score,
                structure: analyses.structure.score,
                time: analyses.time.score
            },
            adjustments: {
                divergencePenalty,
                multiTimeframeBonus: analyses.multiTimeframe.alignment > 0.7 ? 0.05 : 0
            }
        };
    }

    /**
     * Trend sustainability değerlendirmesi
     */
    assessTrendSustainability(overallStrength, divergenceAnalysis, timeBasedStrength) {
        let sustainabilityScore = overallStrength.score;
        
        // Time-based adjustments
        if (timeBasedStrength.exhaustionRisk > 0.7) {
            sustainabilityScore -= 0.2;
        } else if (timeBasedStrength.maturity < 0.3) {
            sustainabilityScore += 0.1; // Young trends more sustainable
        }
        
        // Divergence adjustments
        if (divergenceAnalysis.warningLevel > 0.6) {
            sustainabilityScore -= 0.15;
        }
        
        // Reliability adjustment
        sustainabilityScore *= overallStrength.reliability;
        
        const level = this.classifyStrengthLevel(sustainabilityScore);
        
        return {
            score: sustainabilityScore,
            level,
            factors: {
                baseStrength: overallStrength.score,
                exhaustionRisk: timeBasedStrength.exhaustionRisk,
                divergenceRisk: divergenceAnalysis.warningLevel,
                reliability: overallStrength.reliability
            },
            outlook: this.generateSustainabilityOutlook(sustainabilityScore, timeBasedStrength),
            timeHorizon: this.estimateTimeHorizon(sustainabilityScore, timeBasedStrength)
        };
    }

    /**
     * Helper Methods (simplified implementations)
     */
    classifyStrengthLevel(score) {
        const levels = this.config.strengthLevels;
        for (const [level, range] of Object.entries(levels)) {
            if (score >= range.min && score <= range.max) {
                return level;
            }
        }
        return 'weak';
    }

    analyzeSwingStructure(priceHistory, ohlcData) { return { score: 0.7, quality: 'good' }; }
    analyzePriceMomentum(priceHistory) { return { score: 0.6, direction: 'bullish' }; }
    analyzeContinuationPatterns(ohlcData) { return { score: 0.5, count: 2 }; }
    analyzeBreakoutStrength(priceHistory, srLevels) { return { score: 0.8, recent: true }; }
    determinePriceActionDirection(analysis) { return 'bullish'; }
    calculatePriceActionConfidence(analysis) { return 0.7; }
    analyzeVolumeTrend(volumeHistory) { return { score: 0.6, trend: 'increasing' }; }
    analyzeVolumeConfirmation(volumeHistory, priceHistory, trendDirection) { return { score: 0.7, confirmed: true }; }
    analyzeAccumulationDistribution(volumeHistory, priceHistory) { return { score: 0.6, bias: 'accumulation' }; }
    analyzeVolumeMomentum(volumeHistory) { return { score: 0.5, momentum: 'stable' }; }
    doesVolumeSupportTrend(analysis, trendDirection) { return true; }
    assessVolumeDivergenceRisk(analysis) { return 0.3; }
    analyzeMAAlignment(movingAverages, priceHistory) { return { score: 0.8, alignment: 'bullish' }; }
    analyzeMomentumOscillators(indicators) { return { score: 0.6, consensus: 'bullish' }; }
    analyzeTrendIndicators(indicators) { return { score: 0.7, trend: 'bullish' }; }
    analyzeVolatilityIndicators(indicators) { return { score: 0.5, volatility: 'normal' }; }
    calculateIndicatorConsensus(analysis) { return 0.7; }
    identifyIndicatorDivergences(analysis, priceHistory) { return []; }
    analyzeSRQuality(srLevels, priceHistory) { return { score: 0.6, quality: 'good' }; }
    analyzeBreakoutFrequency(srLevels, priceHistory) { return { score: 0.7, frequency: 'optimal' }; }
    analyzeRangeExpansion(ohlcData) { return { score: 0.6, expanding: true }; }
    analyzeStructuralShifts(priceHistory, srLevels) { return { score: 0.5, stable: true }; }
    determineStructuralBias(analysis) { return 'bullish'; }
    assessBreakoutPotential(analysis) { return 0.7; }
    analyzeTrendDuration(priceHistory, symbol) { return { score: 0.6, duration: 'medium' }; }
    analyzePullbackFrequency(priceHistory) { return { score: 0.7, frequency: 'healthy' }; }
    analyzeMomentumAcceleration(priceHistory) { return { score: 0.6, accelerating: true }; }
    analyzeCyclicalPatterns(priceHistory, symbol) { return { score: 0.5, patterns: [] }; }
    assessTrendMaturity(analysis) { return 0.6; }
    assessExhaustionRisk(analysis) { return 0.3; }
    assessTimeframeAlignment(mtfScores) { return 0.8; }
    calculateTimeframeConflict(mtfScores) { return 0.2; }
    analyzePriceVolumeDivergence(priceHistory, volumeHistory) { return { detected: false, severity: 0 }; }
    analyzePriceIndicatorDivergence(priceHistory, indicators) { return { detected: false, severity: 0 }; }
    analyzeInterIndicatorDivergence(indicators) { return { detected: false, severity: 0 }; }
    analyzeTimeframeDivergence(symbol) { return { detected: false, severity: 0 }; }
    calculateDivergenceScore(divergences) { return 0.2; }
    assessDivergenceRisk(divergences) { return 'low'; }
    assessDivergenceSignificance(divergences) { return 'minor'; }
    calculateDivergenceWarningLevel(divergences) { return 0.3; }
    determineOverallDirection(analyses) { return 'bullish'; }
    calculateReliability(score, divergenceRisk) { return 0.8; }
    generateSustainabilityOutlook(score, timeAnalysis) { return 'positive'; }
    estimateTimeHorizon(score, timeAnalysis) { return 'medium_term'; }

    updateTrendTracking(symbol, data, timestamp) {
        if (!this.trendHistory.has(symbol)) {
            this.trendHistory.set(symbol, []);
        }
        
        const history = this.trendHistory.get(symbol);
        history.push({
            timestamp,
            strength: data.strength,
            sustainability: data.sustainability
        });
        
        // Keep last 50 readings
        if (history.length > 50) {
            history.shift();
        }
    }

    generateTrendStrengthSignals(overallStrength, sustainability, divergence) {
        const signals = [];
        
        if (overallStrength.score > 0.7 && sustainability.score > 0.6) {
            signals.push(this.createSignal(
                'strong-trend',
                overallStrength.score,
                {
                    variant: `${overallStrength.direction}_${overallStrength.level}`,
                    riskLevel: overallStrength.reliability > 0.8 ? 'low' : 'medium',
                    analysis: { overallStrength, sustainability, divergence },
                    recommendations: this.generateStrengthRecommendations(overallStrength, sustainability),
                    confirmationChain: this.buildStrengthConfirmationChain(overallStrength)
                }
            ));
        }
        
        if (divergence.warningLevel > 0.7) {
            signals.push(this.createSignal(
                'trend-divergence-warning',
                divergence.warningLevel,
                {
                    variant: 'divergence_risk',
                    riskLevel: 'high',
                    analysis: { divergence },
                    recommendations: ['Monitor for trend weakness', 'Consider position adjustment'],
                    confirmationChain: ['trend_divergence_warning']
                }
            ));
        }
        
        return signals;
    }

    generateNotifications(overallStrength, sustainability) {
        return {
            grafikBeyni: {
                trendStrength: overallStrength.level,
                trendDirection: overallStrength.direction,
                sustainability: sustainability.level
            },
            trendConfidenceEvaluator: {
                strengthScore: overallStrength.score,
                reliability: overallStrength.reliability
            },
            exitTimingAdvisor: {
                trendStrength: overallStrength.level,
                sustainability: sustainability.score
            },
            tpOptimizer: {
                trendStrength: overallStrength.level,
                direction: overallStrength.direction
            },
            vivo: {
                strongTrend: overallStrength.score > 0.7,
                trendDirection: overallStrength.direction,
                confidence: overallStrength.reliability
            }
        };
    }

    generateStrengthRecommendations(strength, sustainability) {
        const recommendations = [];
        
        recommendations.push(`Trend strength: ${strength.level}`);
        recommendations.push(`Direction: ${strength.direction}`);
        recommendations.push(`Sustainability: ${sustainability.level}`);
        
        if (strength.score > 0.8 && sustainability.score > 0.7) {
            recommendations.push('Strong trend with high sustainability - suitable for trend following');
        } else if (strength.score > 0.6 && sustainability.score < 0.5) {
            recommendations.push('Strong trend but low sustainability - consider shorter time horizons');
        }
        
        return recommendations;
    }

    buildStrengthConfirmationChain(strength) {
        const chain = [];
        
        chain.push(`trend_${strength.direction}`);
        chain.push(`strength_${strength.level}`);
        
        if (strength.reliability > 0.8) chain.push('high_reliability');
        if (strength.score > 0.8) chain.push('very_strong_trend');
        
        return chain;
    }

    /**
     * Main interface function
     */
    async getTrendStrength(marketData) {
        const result = await this.analyze(marketData);
        return {
            strength: result.metadata?.overallStrength || 'weak',
            score: result.metadata?.strengthScore || 0.5,
            direction: result.metadata?.trendDirection || 'neutral',
            sustainability: result.metadata?.sustainability || 'weak'
        };
    }
}

module.exports = TrendStrengthMeter;
