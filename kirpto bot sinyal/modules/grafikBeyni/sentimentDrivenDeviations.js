const GrafikBeyniModuleBase = require('./grafikBeyniModuleBase');

/**
 * Sentiment Driven Deviations Module
 * Sentiment kaynaklı fiyat sapmalarını tespit eden ve analiz eden sistem
 * Market sentiment impact, deviation magnitude, recovery patterns analizi
 */
class SentimentDrivenDeviations extends GrafikBeyniModuleBase {
    constructor() {
        super('sentimentDrivenDeviations');
        this.sentimentHistory = [];
        this.deviationHistory = [];
        this.sentimentThresholds = {
            extremeFear: 0.1,
            fear: 0.25,
            neutral: 0.5,
            greed: 0.75,
            extremeGreed: 0.9
        };
        this.deviationLevels = {
            minor: 0.02,      // 2% deviation
            moderate: 0.05,   // 5% deviation
            significant: 0.1, // 10% deviation
            extreme: 0.2      // 20% deviation
        };
        this.sentimentSources = {
            news: 0.3,
            social: 0.2,
            options: 0.15,
            flows: 0.2,
            technical: 0.15
        };
        this.maxHistorySize = 500;
        this.minObservations = 30;
        this.sentimentLookback = 20;
        this.deviationWindow = 50;
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
                sentimentData,
                newsData,
                socialSentiment,
                optionsData,
                flowData,
                fearGreedIndex,
                volatilityIndex,
                technicalIndicators,
                correlationData,
                macroEnvironment,
                marketMicrostructure
            } = data;

            // Veri doğrulama
            if (!historicalPrices || historicalPrices.length < this.minObservations) {
                throw new Error('Insufficient historical data for sentiment-driven deviation analysis');
            }

            // Sentiment aggregation
            const aggregatedSentiment = this.aggregateSentiment(sentimentData, newsData, socialSentiment, 
                                                              optionsData, flowData, fearGreedIndex);

            // Fair value calculation
            const fairValueAnalysis = this.calculateFairValue(historicalPrices, technicalIndicators, 
                                                            marketData, macroEnvironment);

            // Deviation detection
            const deviationAnalysis = this.detectSentimentDeviations(price, fairValueAnalysis, 
                                                                   aggregatedSentiment, historicalPrices);

            // Sentiment impact analysis
            const sentimentImpact = this.analyzeSentimentImpact(deviationAnalysis, aggregatedSentiment, 
                                                              historicalPrices);

            // Deviation magnitude analysis
            const magnitudeAnalysis = this.analyzeDeviationMagnitude(deviationAnalysis, 
                                                                    aggregatedSentiment);

            // Recovery pattern analysis
            const recoveryPatterns = this.analyzeRecoveryPatterns(deviationAnalysis, sentimentData, 
                                                                historicalPrices);

            // Sentiment regime analysis
            const sentimentRegimes = this.analyzeSentimentRegimes(aggregatedSentiment, deviationAnalysis);

            // Correlation analysis
            const correlationAnalysis = this.analyzeSentimentCorrelations(aggregatedSentiment, 
                                                                        deviationAnalysis, correlationData);

            // Persistence analysis
            const persistenceAnalysis = this.analyzeDeviationPersistence(deviationAnalysis, 
                                                                        aggregatedSentiment);

            // Mean reversion analysis
            const meanReversionAnalysis = this.analyzeMeanReversion(deviationAnalysis, fairValueAnalysis, 
                                                                  aggregatedSentiment);

            // Market structure impact
            const structureImpact = this.analyzeMarketStructureImpact(deviationAnalysis, 
                                                                    marketMicrostructure, flowData);

            // Predictive analysis
            const predictiveAnalysis = this.generatePredictiveInsights(deviationAnalysis, 
                                                                     aggregatedSentiment, recoveryPatterns);

            const result = {
                aggregatedSentiment: aggregatedSentiment,
                fairValueAnalysis: fairValueAnalysis,
                deviationAnalysis: deviationAnalysis,
                sentimentImpact: sentimentImpact,
                magnitudeAnalysis: magnitudeAnalysis,
                recoveryPatterns: recoveryPatterns,
                sentimentRegimes: sentimentRegimes,
                correlationAnalysis: correlationAnalysis,
                persistenceAnalysis: persistenceAnalysis,
                meanReversionAnalysis: meanReversionAnalysis,
                structureImpact: structureImpact,
                predictiveAnalysis: predictiveAnalysis,
                currentStatus: this.getCurrentStatus(deviationAnalysis, aggregatedSentiment, price),
                recommendations: this.generateRecommendations(deviationAnalysis, aggregatedSentiment, meanReversionAnalysis),
                alerts: this.generateAlerts(deviationAnalysis, aggregatedSentiment, magnitudeAnalysis),
                notes: this.generateNotes(deviationAnalysis, aggregatedSentiment, recoveryPatterns),
                metadata: {
                    analysisTimestamp: Date.now(),
                    symbol: symbol,
                    timeframe: timeframe,
                    observationCount: historicalPrices.length,
                    currentSentiment: aggregatedSentiment.overall.level,
                    currentDeviation: deviationAnalysis.current.magnitude,
                    deviationDirection: deviationAnalysis.current.direction,
                    sentimentStrength: aggregatedSentiment.overall.strength
                }
            };

            // History güncelleme
            this.updateSentimentDeviationHistory(result, data);

            // Cache ve performance tracking
            this.updateCache(data, result);
            this.trackPerformance(Date.now(), deviationAnalysis.accuracy > 0.7);

            return result;

        } catch (error) {
            this.handleError('SentimentDrivenDeviations analysis failed', error, data);
            return this.getDefaultResult();
        }
    }

    aggregateSentiment(sentimentData, newsData, socialSentiment, optionsData, flowData, fearGreedIndex) {
        const sentiments = {};
        
        // News sentiment
        if (newsData && newsData.sentiment) {
            sentiments.news = {
                value: newsData.sentiment,
                strength: newsData.confidence || 0.7,
                weight: this.sentimentSources.news
            };
        }
        
        // Social sentiment
        if (socialSentiment) {
            sentiments.social = {
                value: socialSentiment.score,
                strength: socialSentiment.confidence || 0.6,
                weight: this.sentimentSources.social
            };
        }
        
        // Options sentiment (put/call ratio, implied volatility)
        if (optionsData) {
            sentiments.options = {
                value: this.calculateOptionsSentiment(optionsData),
                strength: 0.8,
                weight: this.sentimentSources.options
            };
        }
        
        // Flow sentiment
        if (flowData) {
            sentiments.flows = {
                value: this.calculateFlowSentiment(flowData),
                strength: 0.75,
                weight: this.sentimentSources.flows
            };
        }
        
        // Technical sentiment
        if (sentimentData && sentimentData.technical) {
            sentiments.technical = {
                value: sentimentData.technical,
                strength: 0.7,
                weight: this.sentimentSources.technical
            };
        }
        
        // Fear & Greed Index
        if (fearGreedIndex) {
            sentiments.fearGreed = {
                value: fearGreedIndex / 100,
                strength: 0.9,
                weight: 0.2
            };
        }
        
        // Aggregate sentiments with weights
        const aggregated = this.calculateWeightedSentiment(sentiments);
        
        // Sentiment classification
        const sentimentLevel = this.classifySentiment(aggregated.value);
        
        // Sentiment momentum
        const momentum = this.calculateSentimentMomentum(aggregated, sentiments);
        
        return {
            components: sentiments,
            overall: {
                value: aggregated.value,
                level: sentimentLevel,
                strength: aggregated.strength,
                confidence: aggregated.confidence
            },
            momentum: momentum,
            extremes: this.identifySentimentExtremes(aggregated),
            divergence: this.calculateSentimentDivergence(sentiments),
            consensus: this.calculateSentimentConsensus(sentiments)
        };
    }

    calculateFairValue(historicalPrices, technicalIndicators, marketData, macroEnvironment) {
        const methods = {};
        
        // Moving average fair value
        methods.movingAverage = this.calculateMovingAverageFairValue(historicalPrices);
        
        // Technical fair value
        if (technicalIndicators) {
            methods.technical = this.calculateTechnicalFairValue(technicalIndicators);
        }
        
        // Market data fair value
        if (marketData) {
            methods.market = this.calculateMarketDataFairValue(marketData);
        }
        
        // Macro-adjusted fair value
        if (macroEnvironment) {
            methods.macro = this.calculateMacroAdjustedFairValue(historicalPrices, macroEnvironment);
        }
        
        // Aggregate fair values
        const aggregatedFairValue = this.aggregateFairValues(methods);
        
        // Fair value confidence
        const confidence = this.calculateFairValueConfidence(methods);
        
        // Fair value range
        const range = this.calculateFairValueRange(methods, confidence);
        
        return {
            methods: methods,
            value: aggregatedFairValue,
            confidence: confidence,
            range: range,
            deviation: this.calculateCurrentDeviation(historicalPrices[historicalPrices.length - 1], 
                                                    aggregatedFairValue)
        };
    }

    detectSentimentDeviations(currentPrice, fairValueAnalysis, aggregatedSentiment, historicalPrices) {
        const fairValue = fairValueAnalysis.value;
        const currentDeviation = (currentPrice - fairValue) / fairValue;
        
        // Current deviation analysis
        const current = {
            price: currentPrice,
            fairValue: fairValue,
            deviation: currentDeviation,
            magnitude: Math.abs(currentDeviation),
            direction: currentDeviation > 0 ? 'overvalued' : 'undervalued',
            level: this.classifyDeviationLevel(Math.abs(currentDeviation)),
            sentimentAlignment: this.assessSentimentAlignment(currentDeviation, aggregatedSentiment)
        };
        
        // Historical deviation analysis
        const historical = this.analyzeHistoricalDeviations(historicalPrices, fairValueAnalysis);
        
        // Deviation patterns
        const patterns = this.identifyDeviationPatterns(historical);
        
        // Sentiment-driven episodes
        const episodes = this.identifySentimentEpisodes(historical, aggregatedSentiment);
        
        return {
            current: current,
            historical: historical,
            patterns: patterns,
            episodes: episodes,
            statistics: this.calculateDeviationStatistics(historical),
            accuracy: this.calculateDeviationAccuracy(historical, patterns)
        };
    }

    analyzeSentimentImpact(deviationAnalysis, aggregatedSentiment, historicalPrices) {
        const impacts = {
            magnitude: this.calculateSentimentMagnitudeImpact(deviationAnalysis, aggregatedSentiment),
            direction: this.calculateSentimentDirectionImpact(deviationAnalysis, aggregatedSentiment),
            persistence: this.calculateSentimentPersistenceImpact(deviationAnalysis, aggregatedSentiment),
            volatility: this.calculateSentimentVolatilityImpact(deviationAnalysis, aggregatedSentiment)
        };
        
        // Impact scoring
        const overallImpact = this.calculateOverallSentimentImpact(impacts);
        
        // Impact classification
        const impactLevel = this.classifySentimentImpact(overallImpact);
        
        return {
            impacts: impacts,
            overallImpact: overallImpact,
            impactLevel: impactLevel,
            sensitivityAnalysis: this.analyzeSentimentSensitivity(deviationAnalysis, aggregatedSentiment),
            amplificationFactors: this.identifyAmplificationFactors(impacts),
            dampingFactors: this.identifyDampingFactors(impacts)
        };
    }

    analyzeDeviationMagnitude(deviationAnalysis, aggregatedSentiment) {
        const { current, historical } = deviationAnalysis;
        
        // Magnitude distribution analysis
        const distribution = this.analyzeDeviationDistribution(historical);
        
        // Magnitude vs sentiment correlation
        const correlation = this.calculateMagnitudeSentimentCorrelation(historical, aggregatedSentiment);
        
        // Extreme deviations
        const extremes = this.identifyExtremeDeviations(historical);
        
        // Magnitude persistence
        const persistence = this.analyzeMagnitudePersistence(historical);
        
        return {
            current: current.magnitude,
            distribution: distribution,
            correlation: correlation,
            extremes: extremes,
            persistence: persistence,
            percentile: this.calculateMagnitudePercentile(current.magnitude, historical),
            trend: this.analyzeMagnitudeTrend(historical)
        };
    }

    analyzeRecoveryPatterns(deviationAnalysis, sentimentData, historicalPrices) {
        const episodes = deviationAnalysis.episodes;
        const recoveryPatterns = [];
        
        episodes.forEach(episode => {
            const pattern = this.analyzeEpisodeRecovery(episode, historicalPrices, sentimentData);
            if (pattern) {
                recoveryPatterns.push(pattern);
            }
        });
        
        // Pattern classification
        const patternTypes = this.classifyRecoveryPatterns(recoveryPatterns);
        
        // Recovery efficiency
        const efficiency = this.calculateRecoveryEfficiency(recoveryPatterns);
        
        // Recovery predictability
        const predictability = this.assessRecoveryPredictability(recoveryPatterns);
        
        return {
            patterns: recoveryPatterns,
            patternTypes: patternTypes,
            efficiency: efficiency,
            predictability: predictability,
            averageRecoveryTime: this.calculateAverageRecoveryTime(recoveryPatterns),
            successRate: this.calculateRecoverySuccessRate(recoveryPatterns),
            factors: this.identifyRecoveryFactors(recoveryPatterns)
        };
    }

    analyzeSentimentRegimes(aggregatedSentiment, deviationAnalysis) {
        // Sentiment regime identification
        const regimes = this.identifySentimentRegimes(aggregatedSentiment);
        
        // Current regime
        const currentRegime = this.getCurrentSentimentRegime(aggregatedSentiment);
        
        // Regime transitions
        const transitions = this.analyzeRegimeTransitions(regimes);
        
        // Regime-specific deviation behavior
        const regimeDeviations = this.analyzeRegimeDeviations(regimes, deviationAnalysis);
        
        return {
            regimes: regimes,
            currentRegime: currentRegime,
            transitions: transitions,
            regimeDeviations: regimeDeviations,
            regimePersistence: this.calculateRegimePersistence(regimes),
            transitionProbabilities: this.calculateTransitionProbabilities(transitions)
        };
    }

    analyzeSentimentCorrelations(aggregatedSentiment, deviationAnalysis, correlationData) {
        const correlations = {};
        
        // Sentiment-deviation correlation
        correlations.sentimentDeviation = this.calculateSentimentDeviationCorrelation(
            aggregatedSentiment, deviationAnalysis
        );
        
        // Cross-asset sentiment correlation
        if (correlationData) {
            correlations.crossAsset = this.calculateCrossAssetSentimentCorrelation(
                aggregatedSentiment, correlationData
            );
        }
        
        // Sentiment component correlations
        correlations.components = this.calculateComponentCorrelations(aggregatedSentiment);
        
        // Lead-lag relationships
        correlations.leadLag = this.analyzeLeadLagRelationships(aggregatedSentiment, deviationAnalysis);
        
        return {
            correlations: correlations,
            significantCorrelations: this.identifySignificantCorrelations(correlations),
            correlationStability: this.assessCorrelationStability(correlations),
            implications: this.deriveCorrelationImplications(correlations)
        };
    }

    analyzeDeviationPersistence(deviationAnalysis, aggregatedSentiment) {
        const { historical } = deviationAnalysis;
        
        // Persistence measurement
        const persistence = this.calculateDeviationPersistence(historical);
        
        // Sentiment-driven persistence
        const sentimentPersistence = this.calculateSentimentDrivenPersistence(historical, aggregatedSentiment);
        
        // Half-life calculation
        const halfLife = this.calculateDeviationHalfLife(historical);
        
        // Persistence factors
        const factors = this.identifyPersistenceFactors(historical, aggregatedSentiment);
        
        return {
            persistence: persistence,
            sentimentPersistence: sentimentPersistence,
            halfLife: halfLife,
            factors: factors,
            persistenceLevel: this.classifyPersistenceLevel(persistence),
            implications: this.derivePersistenceImplications(persistence, halfLife)
        };
    }

    analyzeMeanReversion(deviationAnalysis, fairValueAnalysis, aggregatedSentiment) {
        const { current, historical } = deviationAnalysis;
        
        // Mean reversion speed
        const reversionSpeed = this.calculateReversionSpeed(historical);
        
        // Sentiment-adjusted reversion
        const sentimentAdjustedReversion = this.calculateSentimentAdjustedReversion(
            reversionSpeed, aggregatedSentiment
        );
        
        // Reversion probability
        const reversionProbability = this.calculateReversionProbability(current, historical);
        
        // Time to reversion
        const timeToReversion = this.calculateTimeToReversion(current, reversionSpeed);
        
        return {
            reversionSpeed: reversionSpeed,
            sentimentAdjustedReversion: sentimentAdjustedReversion,
            reversionProbability: reversionProbability,
            timeToReversion: timeToReversion,
            reversionLevel: this.classifyReversionLevel(reversionSpeed),
            reversionFactors: this.identifyReversionFactors(historical, aggregatedSentiment)
        };
    }

    analyzeMarketStructureImpact(deviationAnalysis, marketMicrostructure, flowData) {
        if (!marketMicrostructure && !flowData) {
            return null;
        }
        
        const structureImpacts = {
            liquidity: marketMicrostructure ? this.analyzeLiquidityImpact(deviationAnalysis, marketMicrostructure) : null,
            spreads: marketMicrostructure ? this.analyzeSpreadImpact(deviationAnalysis, marketMicrostructure) : null,
            depth: marketMicrostructure ? this.analyzeDepthImpact(deviationAnalysis, marketMicrostructure) : null,
            flows: flowData ? this.analyzeFlowImpact(deviationAnalysis, flowData) : null
        };
        
        return {
            impacts: structureImpacts,
            overallImpact: this.calculateOverallStructureImpact(structureImpacts),
            marketEfficiency: this.assessMarketEfficiency(structureImpacts),
            structuralFactors: this.identifyStructuralFactors(structureImpacts)
        };
    }

    generatePredictiveInsights(deviationAnalysis, aggregatedSentiment, recoveryPatterns) {
        // Deviation direction prediction
        const directionPrediction = this.predictDeviationDirection(deviationAnalysis, aggregatedSentiment);
        
        // Magnitude prediction
        const magnitudePrediction = this.predictDeviationMagnitude(deviationAnalysis, aggregatedSentiment);
        
        // Recovery time prediction
        const recoveryPrediction = this.predictRecoveryTime(deviationAnalysis, recoveryPatterns);
        
        // Sentiment shift prediction
        const sentimentPrediction = this.predictSentimentShift(aggregatedSentiment, deviationAnalysis);
        
        return {
            directionPrediction: directionPrediction,
            magnitudePrediction: magnitudePrediction,
            recoveryPrediction: recoveryPrediction,
            sentimentPrediction: sentimentPrediction,
            confidence: this.calculatePredictionConfidence(deviationAnalysis, aggregatedSentiment),
            timeHorizon: this.determinePredictionTimeHorizon(deviationAnalysis)
        };
    }

    getCurrentStatus(deviationAnalysis, aggregatedSentiment, currentPrice) {
        const { current } = deviationAnalysis;
        
        return {
            price: currentPrice,
            deviation: current.deviation,
            deviationLevel: current.level,
            direction: current.direction,
            sentimentLevel: aggregatedSentiment.overall.level,
            sentimentStrength: aggregatedSentiment.overall.strength,
            alignment: current.sentimentAlignment,
            riskLevel: this.assessCurrentRiskLevel(current, aggregatedSentiment),
            opportunity: this.assessCurrentOpportunity(current, aggregatedSentiment)
        };
    }

    // Helper methods for calculations
    calculateOptionsSentiment(optionsData) {
        // Simplified options sentiment calculation
        const putCallRatio = optionsData.putCallRatio || 1;
        const impliedVolatility = optionsData.impliedVolatility || 0.2;
        
        // Higher put/call ratio indicates fear (lower sentiment)
        // Higher implied volatility indicates uncertainty (affects sentiment)
        let sentiment = 0.5; // Neutral baseline
        
        if (putCallRatio > 1.2) {
            sentiment -= 0.2; // Bearish sentiment
        } else if (putCallRatio < 0.8) {
            sentiment += 0.2; // Bullish sentiment
        }
        
        if (impliedVolatility > 0.3) {
            sentiment -= 0.1; // High volatility reduces sentiment
        }
        
        return Math.max(0, Math.min(1, sentiment));
    }

    calculateFlowSentiment(flowData) {
        // Simplified flow sentiment calculation
        const netFlow = flowData.netFlow || 0;
        const flowVolume = flowData.volume || 1;
        
        const flowRatio = netFlow / flowVolume;
        
        // Convert flow ratio to sentiment (0-1 scale)
        return 0.5 + (flowRatio * 0.5); // Assuming flowRatio is between -1 and 1
    }

    calculateWeightedSentiment(sentiments) {
        let weightedSum = 0;
        let totalWeight = 0;
        let strengthSum = 0;
        let confidenceSum = 0;
        
        Object.values(sentiments).forEach(sentiment => {
            const weight = sentiment.weight * sentiment.strength;
            weightedSum += sentiment.value * weight;
            totalWeight += weight;
            strengthSum += sentiment.strength;
            confidenceSum += sentiment.strength; // Use strength as proxy for confidence
        });
        
        const count = Object.keys(sentiments).length;
        
        return {
            value: totalWeight > 0 ? weightedSum / totalWeight : 0.5,
            strength: count > 0 ? strengthSum / count : 0.5,
            confidence: count > 0 ? confidenceSum / count : 0.5
        };
    }

    classifySentiment(sentimentValue) {
        if (sentimentValue >= this.sentimentThresholds.extremeGreed) return 'extreme_greed';
        if (sentimentValue >= this.sentimentThresholds.greed) return 'greed';
        if (sentimentValue >= this.sentimentThresholds.neutral) return 'neutral_positive';
        if (sentimentValue >= this.sentimentThresholds.fear) return 'neutral_negative';
        if (sentimentValue >= this.sentimentThresholds.extremeFear) return 'fear';
        return 'extreme_fear';
    }

    calculateSentimentMomentum(aggregated, sentiments) {
        // Simplified momentum calculation
        const currentValue = aggregated.value;
        
        // Would need historical sentiment data for proper momentum calculation
        // This is a simplified version
        const momentum = Math.random() * 0.2 - 0.1; // Placeholder
        
        return {
            value: momentum,
            direction: momentum > 0 ? 'increasing' : momentum < 0 ? 'decreasing' : 'stable',
            strength: Math.abs(momentum)
        };
    }

    identifySentimentExtremes(aggregated) {
        const extremes = [];
        
        if (aggregated.value <= this.sentimentThresholds.extremeFear) {
            extremes.push({ type: 'extreme_fear', value: aggregated.value });
        }
        
        if (aggregated.value >= this.sentimentThresholds.extremeGreed) {
            extremes.push({ type: 'extreme_greed', value: aggregated.value });
        }
        
        return extremes;
    }

    calculateSentimentDivergence(sentiments) {
        const values = Object.values(sentiments).map(s => s.value);
        if (values.length < 2) return 0;
        
        const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
        const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length;
        
        return Math.sqrt(variance); // Standard deviation as divergence measure
    }

    calculateSentimentConsensus(sentiments) {
        const divergence = this.calculateSentimentDivergence(sentiments);
        return 1 - Math.min(1, divergence * 2); // Higher divergence = lower consensus
    }

    calculateMovingAverageFairValue(historicalPrices) {
        const windows = [20, 50, 100, 200];
        const fairValues = {};
        
        windows.forEach(window => {
            if (historicalPrices.length >= window) {
                const slice = historicalPrices.slice(-window);
                fairValues[`ma${window}`] = slice.reduce((sum, p) => sum + p, 0) / slice.length;
            }
        });
        
        return fairValues;
    }

    calculateTechnicalFairValue(technicalIndicators) {
        // Simplified technical fair value based on various indicators
        const indicators = {};
        
        if (technicalIndicators.sma) indicators.sma = technicalIndicators.sma;
        if (technicalIndicators.ema) indicators.ema = technicalIndicators.ema;
        if (technicalIndicators.bb) indicators.bb = technicalIndicators.bb.middle;
        
        return indicators;
    }

    calculateMarketDataFairValue(marketData) {
        // Fair value based on market data like volume, liquidity, etc.
        return {
            volumeWeighted: marketData.vwap || marketData.price,
            liquidityAdjusted: marketData.price * (1 + (marketData.liquidityPremium || 0))
        };
    }

    calculateMacroAdjustedFairValue(historicalPrices, macroEnvironment) {
        const basePrice = historicalPrices[historicalPrices.length - 1];
        const macroAdjustment = macroEnvironment.riskAdjustment || 0;
        
        return {
            macroAdjusted: basePrice * (1 + macroAdjustment)
        };
    }

    aggregateFairValues(methods) {
        const values = [];
        
        Object.values(methods).forEach(method => {
            Object.values(method).forEach(value => {
                if (typeof value === 'number' && !isNaN(value)) {
                    values.push(value);
                }
            });
        });
        
        return values.length > 0 ? values.reduce((sum, v) => sum + v, 0) / values.length : 0;
    }

    calculateFairValueConfidence(methods) {
        const values = [];
        
        Object.values(methods).forEach(method => {
            Object.values(method).forEach(value => {
                if (typeof value === 'number' && !isNaN(value)) {
                    values.push(value);
                }
            });
        });
        
        if (values.length < 2) return 0.5;
        
        const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
        const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length;
        const stdDev = Math.sqrt(variance);
        const cv = stdDev / mean; // Coefficient of variation
        
        return Math.max(0.1, 1 - cv); // Lower variation = higher confidence
    }

    calculateFairValueRange(methods, confidence) {
        const aggregated = this.aggregateFairValues(methods);
        const uncertainty = (1 - confidence) * 0.1; // 10% max uncertainty
        
        return {
            low: aggregated * (1 - uncertainty),
            high: aggregated * (1 + uncertainty)
        };
    }

    calculateCurrentDeviation(currentPrice, fairValue) {
        return (currentPrice - fairValue) / fairValue;
    }

    classifyDeviationLevel(magnitude) {
        if (magnitude >= this.deviationLevels.extreme) return 'extreme';
        if (magnitude >= this.deviationLevels.significant) return 'significant';
        if (magnitude >= this.deviationLevels.moderate) return 'moderate';
        if (magnitude >= this.deviationLevels.minor) return 'minor';
        return 'negligible';
    }

    assessSentimentAlignment(deviation, aggregatedSentiment) {
        const sentimentValue = aggregatedSentiment.overall.value;
        const isPositiveDeviation = deviation > 0;
        const isPositiveSentiment = sentimentValue > 0.5;
        
        if (isPositiveDeviation === isPositiveSentiment) {
            return 'aligned';
        } else {
            return 'divergent';
        }
    }

    analyzeHistoricalDeviations(historicalPrices, fairValueAnalysis) {
        // Simplified historical deviation analysis
        const deviations = [];
        const fairValue = fairValueAnalysis.value;
        
        historicalPrices.forEach((price, index) => {
            const deviation = (price - fairValue) / fairValue;
            deviations.push({
                index: index,
                price: price,
                deviation: deviation,
                magnitude: Math.abs(deviation),
                direction: deviation > 0 ? 'overvalued' : 'undervalued'
            });
        });
        
        return deviations;
    }

    identifyDeviationPatterns(historical) {
        // Pattern identification logic
        const patterns = {
            cycles: this.identifyDeviationCycles(historical),
            trends: this.identifyDeviationTrends(historical),
            clusters: this.identifyDeviationClusters(historical)
        };
        
        return patterns;
    }

    identifyDeviationCycles(historical) {
        // Simplified cycle identification
        const cycles = [];
        let currentCycle = null;
        
        for (let i = 1; i < historical.length; i++) {
            const prev = historical[i - 1];
            const curr = historical[i];
            
            // Detect direction changes
            if ((prev.deviation > 0 && curr.deviation <= 0) || 
                (prev.deviation <= 0 && curr.deviation > 0)) {
                
                if (currentCycle) {
                    currentCycle.end = i - 1;
                    cycles.push(currentCycle);
                }
                
                currentCycle = {
                    start: i - 1,
                    type: curr.deviation > 0 ? 'positive' : 'negative'
                };
            }
        }
        
        if (currentCycle) {
            currentCycle.end = historical.length - 1;
            cycles.push(currentCycle);
        }
        
        return cycles;
    }

    identifyDeviationTrends(historical) {
        // Simplified trend identification
        const windowSize = 10;
        const trends = [];
        
        for (let i = windowSize; i < historical.length; i++) {
            const window = historical.slice(i - windowSize, i);
            const correlation = this.calculateTrendCorrelation(window);
            
            if (Math.abs(correlation) > 0.5) {
                trends.push({
                    start: i - windowSize,
                    end: i,
                    direction: correlation > 0 ? 'increasing' : 'decreasing',
                    strength: Math.abs(correlation)
                });
            }
        }
        
        return trends;
    }

    calculateTrendCorrelation(window) {
        const n = window.length;
        const x = Array.from({ length: n }, (_, i) => i);
        const y = window.map(w => w.deviation);
        
        const sumX = x.reduce((sum, val) => sum + val, 0);
        const sumY = y.reduce((sum, val) => sum + val, 0);
        const sumXY = x.reduce((sum, val, i) => sum + val * y[i], 0);
        const sumX2 = x.reduce((sum, val) => sum + val * val, 0);
        const sumY2 = y.reduce((sum, val) => sum + val * val, 0);
        
        const correlation = (n * sumXY - sumX * sumY) / 
                          Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));
        
        return isNaN(correlation) ? 0 : correlation;
    }

    identifyDeviationClusters(historical) {
        // Simplified clustering - identify periods of high deviation
        const clusters = [];
        let currentCluster = null;
        const threshold = this.deviationLevels.moderate;
        
        historical.forEach((point, index) => {
            if (point.magnitude > threshold) {
                if (!currentCluster) {
                    currentCluster = {
                        start: index,
                        points: [point],
                        maxMagnitude: point.magnitude
                    };
                } else {
                    currentCluster.points.push(point);
                    currentCluster.maxMagnitude = Math.max(currentCluster.maxMagnitude, point.magnitude);
                }
            } else {
                if (currentCluster) {
                    currentCluster.end = index - 1;
                    clusters.push(currentCluster);
                    currentCluster = null;
                }
            }
        });
        
        if (currentCluster) {
            currentCluster.end = historical.length - 1;
            clusters.push(currentCluster);
        }
        
        return clusters;
    }

    identifySentimentEpisodes(historical, aggregatedSentiment) {
        // Identify episodes where sentiment drove significant deviations
        const episodes = [];
        
        // This would require historical sentiment data
        // Simplified implementation
        const significantDeviations = historical.filter(h => h.magnitude > this.deviationLevels.moderate);
        
        significantDeviations.forEach(deviation => {
            episodes.push({
                index: deviation.index,
                deviation: deviation,
                sentimentLevel: aggregatedSentiment.overall.level, // Current sentiment as proxy
                type: 'sentiment_driven'
            });
        });
        
        return episodes;
    }

    calculateDeviationStatistics(historical) {
        const magnitudes = historical.map(h => h.magnitude);
        const deviations = historical.map(h => h.deviation);
        
        return {
            count: historical.length,
            meanMagnitude: magnitudes.reduce((sum, m) => sum + m, 0) / magnitudes.length,
            maxMagnitude: Math.max(...magnitudes),
            meanDeviation: deviations.reduce((sum, d) => sum + d, 0) / deviations.length,
            volatility: this.calculateDeviationVolatility(deviations),
            positiveRatio: historical.filter(h => h.deviation > 0).length / historical.length
        };
    }

    calculateDeviationVolatility(deviations) {
        const mean = deviations.reduce((sum, d) => sum + d, 0) / deviations.length;
        const variance = deviations.reduce((sum, d) => sum + Math.pow(d - mean, 2), 0) / deviations.length;
        return Math.sqrt(variance);
    }

    calculateDeviationAccuracy(historical, patterns) {
        // Simplified accuracy calculation
        // Would need to compare predicted vs actual deviations
        return 0.7; // Placeholder
    }

    generateRecommendations(deviationAnalysis, aggregatedSentiment, meanReversionAnalysis) {
        const recommendations = {};
        const { current } = deviationAnalysis;
        
        // Deviation-based recommendations
        if (current.level === 'extreme') {
            recommendations.deviation = {
                action: current.direction === 'overvalued' ? 'consider_selling' : 'consider_buying',
                reason: 'extreme_deviation_from_fair_value',
                confidence: 'high'
            };
        }
        
        // Sentiment-based recommendations
        const sentimentLevel = aggregatedSentiment.overall.level;
        if (sentimentLevel === 'extreme_fear' || sentimentLevel === 'extreme_greed') {
            recommendations.sentiment = {
                action: 'contrarian_position',
                reason: 'extreme_sentiment_levels',
                timeframe: 'medium_term'
            };
        }
        
        // Mean reversion recommendations
        if (meanReversionAnalysis.reversionProbability > 0.7) {
            recommendations.meanReversion = {
                action: 'prepare_for_reversion',
                timeframe: meanReversionAnalysis.timeToReversion,
                confidence: meanReversionAnalysis.reversionProbability
            };
        }
        
        return recommendations;
    }

    generateAlerts(deviationAnalysis, aggregatedSentiment, magnitudeAnalysis) {
        const alerts = [];
        const { current } = deviationAnalysis;
        
        // Extreme deviation alert
        if (current.level === 'extreme') {
            alerts.push({
                level: 'critical',
                message: `Aşırı sapma tespit edildi: ${(current.magnitude * 100).toFixed(1)}%`,
                action: 'Pozisyonları gözden geçir'
            });
        }
        
        // Sentiment extreme alert
        const sentimentLevel = aggregatedSentiment.overall.level;
        if (sentimentLevel === 'extreme_fear' || sentimentLevel === 'extreme_greed') {
            alerts.push({
                level: 'warning',
                message: `Aşırı sentiment seviyesi: ${sentimentLevel}`,
                action: 'Contrarian fırsatları değerlendir'
            });
        }
        
        // Magnitude trend alert
        if (magnitudeAnalysis.trend === 'increasing') {
            alerts.push({
                level: 'info',
                message: 'Sapma büyüklüğü artış eğiliminde',
                action: 'Risk yönetimini güçlendir'
            });
        }
        
        return alerts;
    }

    generateNotes(deviationAnalysis, aggregatedSentiment, recoveryPatterns) {
        const notes = [];
        const { current } = deviationAnalysis;
        
        notes.push(`Mevcut sapma: ${(current.deviation * 100).toFixed(2)}% (${current.direction})`);
        notes.push(`Sentiment seviyesi: ${aggregatedSentiment.overall.level}`);
        notes.push(`Sapma seviyesi: ${current.level}`);
        
        if (recoveryPatterns.averageRecoveryTime > 0) {
            notes.push(`Ortalama toparlanma süresi: ${recoveryPatterns.averageRecoveryTime.toFixed(1)} dönem`);
        }
        
        return notes.join('. ');
    }

    updateSentimentDeviationHistory(result, data) {
        this.sentimentHistory.push({
            timestamp: Date.now(),
            sentimentLevel: result.aggregatedSentiment.overall.level,
            sentimentValue: result.aggregatedSentiment.overall.value,
            sentimentStrength: result.aggregatedSentiment.overall.strength
        });

        this.deviationHistory.push({
            timestamp: Date.now(),
            deviation: result.deviationAnalysis.current.deviation,
            magnitude: result.deviationAnalysis.current.magnitude,
            direction: result.deviationAnalysis.current.direction,
            level: result.deviationAnalysis.current.level
        });

        if (this.sentimentHistory.length > this.maxHistorySize) {
            this.sentimentHistory = this.sentimentHistory.slice(-this.maxHistorySize);
        }

        if (this.deviationHistory.length > this.maxHistorySize) {
            this.deviationHistory = this.deviationHistory.slice(-this.maxHistorySize);
        }
    }

    getDefaultResult() {
        return {
            aggregatedSentiment: {
                components: {},
                overall: {
                    value: 0.5,
                    level: 'neutral_positive',
                    strength: 0.5,
                    confidence: 0.5
                },
                momentum: { value: 0, direction: 'stable', strength: 0 },
                extremes: [],
                divergence: 0,
                consensus: 0.5
            },
            fairValueAnalysis: {
                methods: {},
                value: 0,
                confidence: 0.5,
                range: { low: 0, high: 0 },
                deviation: 0
            },
            deviationAnalysis: {
                current: {
                    price: 0,
                    fairValue: 0,
                    deviation: 0,
                    magnitude: 0,
                    direction: 'neutral',
                    level: 'negligible',
                    sentimentAlignment: 'neutral'
                },
                historical: [],
                patterns: { cycles: [], trends: [], clusters: [] },
                episodes: [],
                statistics: {
                    count: 0,
                    meanMagnitude: 0,
                    maxMagnitude: 0,
                    meanDeviation: 0,
                    volatility: 0,
                    positiveRatio: 0.5
                },
                accuracy: 0.5
            },
            sentimentImpact: {
                impacts: {},
                overallImpact: 0.5,
                impactLevel: 'moderate',
                sensitivityAnalysis: {},
                amplificationFactors: [],
                dampingFactors: []
            },
            magnitudeAnalysis: {
                current: 0,
                distribution: {},
                correlation: 0,
                extremes: [],
                persistence: 0.5,
                percentile: 0.5,
                trend: 'stable'
            },
            recoveryPatterns: {
                patterns: [],
                patternTypes: {},
                efficiency: 0.5,
                predictability: 0.5,
                averageRecoveryTime: 0,
                successRate: 0.5,
                factors: []
            },
            sentimentRegimes: {
                regimes: [],
                currentRegime: 'neutral',
                transitions: [],
                regimeDeviations: {},
                regimePersistence: {},
                transitionProbabilities: {}
            },
            correlationAnalysis: {
                correlations: {},
                significantCorrelations: [],
                correlationStability: 0.5,
                implications: []
            },
            persistenceAnalysis: {
                persistence: 0.5,
                sentimentPersistence: 0.5,
                halfLife: 10,
                factors: [],
                persistenceLevel: 'moderate',
                implications: []
            },
            meanReversionAnalysis: {
                reversionSpeed: 0.1,
                sentimentAdjustedReversion: 0.1,
                reversionProbability: 0.5,
                timeToReversion: 10,
                reversionLevel: 'moderate',
                reversionFactors: []
            },
            structureImpact: null,
            predictiveAnalysis: {
                directionPrediction: { direction: 'neutral', confidence: 0.5 },
                magnitudePrediction: { magnitude: 0, confidence: 0.5 },
                recoveryPrediction: { time: 10, confidence: 0.5 },
                sentimentPrediction: { sentiment: 0.5, confidence: 0.5 },
                confidence: 0.5,
                timeHorizon: 10
            },
            currentStatus: {
                price: 0,
                deviation: 0,
                deviationLevel: 'negligible',
                direction: 'neutral',
                sentimentLevel: 'neutral_positive',
                sentimentStrength: 0.5,
                alignment: 'neutral',
                riskLevel: 'moderate',
                opportunity: 'none'
            },
            recommendations: {},
            alerts: [],
            notes: "Sentiment kaynaklı sapma analizi yapılamadı - yetersiz veri",
            metadata: {
                error: true,
                analysisTimestamp: Date.now()
            }
        };
    }

    getModuleInfo() {
        return {
            name: 'SentimentDrivenDeviations',
            version: '1.0.0',
            description: 'Sentiment kaynaklı fiyat sapmalarını tespit eden ve analiz eden sistem - Market sentiment impact, deviation magnitude, recovery patterns analizi',
            inputs: [
                'symbol', 'price', 'historicalPrices', 'volume', 'timeframe', 'marketData',
                'sentimentData', 'newsData', 'socialSentiment', 'optionsData', 'flowData',
                'fearGreedIndex', 'volatilityIndex', 'technicalIndicators', 'correlationData',
                'macroEnvironment', 'marketMicrostructure'
            ],
            outputs: [
                'aggregatedSentiment', 'fairValueAnalysis', 'deviationAnalysis', 'sentimentImpact',
                'magnitudeAnalysis', 'recoveryPatterns', 'sentimentRegimes', 'correlationAnalysis',
                'persistenceAnalysis', 'meanReversionAnalysis', 'structureImpact', 'predictiveAnalysis',
                'currentStatus', 'recommendations', 'alerts', 'notes', 'metadata'
            ]
        };
    }
}

module.exports = SentimentDrivenDeviations;
