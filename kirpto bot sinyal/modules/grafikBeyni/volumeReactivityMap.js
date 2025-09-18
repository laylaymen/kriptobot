const GrafikBeyniModuleBase = require('../grafikBeyniModuleBase');

/**
 * Volume Reactivity Map Module
 * Hacim reaktivite haritası - Fiyatın belirli hacim değişimlerine nasıl tepki verdiğini haritalandırır
 * Volume-price reaction mapping, reactivity patterns, sensitivity analysis, volume impact modeling
 */
class VolumeReactivityMap extends GrafikBeyniModuleBase {
    constructor() {
        super('volumeReactivityMap');
        this.reactivityHistory = [];
        this.volumeReactionMaps = {};
        this.volumeThresholds = {
            low: 0.5,      // 50% of average volume
            normal: 1.0,   // Average volume
            high: 2.0,     // 2x average volume
            extreme: 5.0   // 5x average volume
        };
        this.priceReactionLevels = {
            minimal: 0.005,   // 0.5% price reaction
            small: 0.01,      // 1% price reaction
            medium: 0.025,    // 2.5% price reaction
            large: 0.05,      // 5% price reaction
            extreme: 0.1      // 10% price reaction
        };
        this.timeHorizons = {
            immediate: 1,     // 1 period
            short: 5,         // 5 periods
            medium: 15,       // 15 periods
            long: 60          // 60 periods
        };
        this.volumeCategories = {
            buy_volume: 'buy_dominated',
            sell_volume: 'sell_dominated',
            neutral_volume: 'neutral',
            institutional: 'institutional',
            retail: 'retail',
            algorithmic: 'algorithmic'
        };
        this.maxHistorySize = 2000;
        this.minObservations = 100;
        this.learningRate = 0.08;
        this.adaptationSpeed = 0.12;
        this.confidenceThreshold = 0.65;
    }

    async analyze(data) {
        try {
            const {
                symbol,
                volumeData,
                priceData,
                orderFlowData,
                timeframe,
                marketConditions,
                liquidityMetrics,
                bidAskData,
                tradeData,
                institutionalFlow,
                retailFlow,
                algorithmicActivity,
                marketDepth,
                sessionData,
                volatilityData,
                correlationData,
                newsImpact,
                economicEvents,
                technicalIndicators
            } = data;

            // Veri doğrulama
            if (!volumeData || !priceData || volumeData.length < this.minObservations) {
                throw new Error('Insufficient volume or price data for reactivity mapping');
            }

            // Volume categorization and analysis
            const volumeCategorizationAnalysis = this.categorizeVolumeData(volumeData, orderFlowData,
                                                                          institutionalFlow, algorithmicActivity);

            // Price reaction analysis for different volume levels
            const priceReactionAnalysis = this.analyzePriceReactions(volumeData, priceData,
                                                                    volumeCategorizationAnalysis);

            // Volume-price reactivity mapping
            const reactivityMappingAnalysis = this.createReactivityMaps(priceReactionAnalysis,
                                                                       volumeCategorizationAnalysis,
                                                                       marketConditions);

            // Sensitivity analysis across different market conditions
            const sensitivityAnalysis = this.performSensitivityAnalysis(reactivityMappingAnalysis,
                                                                       marketConditions,
                                                                       volatilityData);

            // Pattern identification in volume-price reactions
            const reactionPatternIdentification = this.identifyReactionPatterns(priceReactionAnalysis,
                                                                               this.reactivityHistory);

            // Time-based reactivity analysis
            const timeBasedReactivityAnalysis = this.analyzeTimeBasedReactivity(priceReactionAnalysis,
                                                                               sessionData,
                                                                               marketConditions);

            // Predictive reactivity modeling
            const predictiveReactivityModeling = this.buildPredictiveReactivityModels(reactivityMappingAnalysis,
                                                                                     reactionPatternIdentification);

            // Anomaly detection in volume reactions
            const volumeReactionAnomalyDetection = this.detectVolumeReactionAnomalies(priceReactionAnalysis,
                                                                                     reactivityMappingAnalysis);

            // Market microstructure impact analysis
            const microstructureImpactAnalysis = this.analyzeMarketMicrostructureImpact(bidAskData,
                                                                                       marketDepth,
                                                                                       volumeData,
                                                                                       priceReactionAnalysis);

            // Cross-asset volume reactivity comparison
            const crossAssetReactivityComparison = this.performCrossAssetReactivityComparison(
                reactivityMappingAnalysis,
                correlationData,
                marketConditions
            );

            // Adaptive threshold calibration
            const adaptiveThresholdCalibration = this.performAdaptiveThresholdCalibration(reactivityMappingAnalysis,
                                                                                         sensitivityAnalysis);

            const result = {
                volumeCategorizationAnalysis: volumeCategorizationAnalysis,
                priceReactionAnalysis: priceReactionAnalysis,
                reactivityMappingAnalysis: reactivityMappingAnalysis,
                sensitivityAnalysis: sensitivityAnalysis,
                reactionPatternIdentification: reactionPatternIdentification,
                timeBasedReactivityAnalysis: timeBasedReactivityAnalysis,
                predictiveReactivityModeling: predictiveReactivityModeling,
                volumeReactionAnomalyDetection: volumeReactionAnomalyDetection,
                microstructureImpactAnalysis: microstructureImpactAnalysis,
                crossAssetReactivityComparison: crossAssetReactivityComparison,
                adaptiveThresholdCalibration: adaptiveThresholdCalibration,
                currentStatus: this.getCurrentStatus(reactivityMappingAnalysis, sensitivityAnalysis,
                                                   predictiveReactivityModeling),
                recommendations: this.generateRecommendations(reactivityMappingAnalysis, 
                                                            sensitivityAnalysis,
                                                            predictiveReactivityModeling),
                alerts: this.generateAlerts(volumeReactionAnomalyDetection, sensitivityAnalysis,
                                          reactivityMappingAnalysis),
                notes: this.generateNotes(reactivityMappingAnalysis, reactionPatternIdentification,
                                        sensitivityAnalysis),
                metadata: {
                    analysisTimestamp: Date.now(),
                    symbol: symbol,
                    timeframe: timeframe,
                    volumeDataPoints: volumeData.length,
                    priceDataPoints: priceData.length,
                    identifiedPatterns: reactionPatternIdentification.patterns.length,
                    reactivityScore: reactivityMappingAnalysis.overallReactivity,
                    sensitivityLevel: sensitivityAnalysis.overallSensitivity,
                    predictionAccuracy: predictiveReactivityModeling.accuracy
                }
            };

            // History güncelleme
            this.updateReactivityHistory(result, data);

            // Cache ve performance tracking
            this.updateCache(data, result);
            this.trackPerformance(Date.now(), result.currentStatus.mappingQuality === 'high');

            return result;

        } catch (error) {
            this.handleError('VolumeReactivityMap analysis failed', error, data);
            return this.getDefaultResult();
        }
    }

    categorizeVolumeData(volumeData, orderFlowData, institutionalFlow, algorithmicActivity) {
        const categorization = {
            bySize: {},
            byType: {},
            byTimeHorizon: {},
            categoryStats: {}
        };

        // Calculate average volume for reference
        const averageVolume = this.calculateAverageVolume(volumeData);

        // Categorize by volume size
        volumeData.forEach((volume, index) => {
            const volumeRatio = volume / averageVolume;
            let sizeCategory;

            if (volumeRatio >= this.volumeThresholds.extreme) sizeCategory = 'extreme';
            else if (volumeRatio >= this.volumeThresholds.high) sizeCategory = 'high';
            else if (volumeRatio >= this.volumeThresholds.normal) sizeCategory = 'normal';
            else sizeCategory = 'low';

            if (!categorization.bySize[sizeCategory]) categorization.bySize[sizeCategory] = [];
            categorization.bySize[sizeCategory].push({ index, volume, ratio: volumeRatio });
        });

        // Categorize by volume type (if order flow data available)
        if (orderFlowData) {
            orderFlowData.forEach((flow, index) => {
                let typeCategory;
                const buyRatio = flow.buyVolume / (flow.buyVolume + flow.sellVolume);

                if (buyRatio > 0.7) typeCategory = this.volumeCategories.buy_volume;
                else if (buyRatio < 0.3) typeCategory = this.volumeCategories.sell_volume;
                else typeCategory = this.volumeCategories.neutral_volume;

                if (!categorization.byType[typeCategory]) categorization.byType[typeCategory] = [];
                categorization.byType[typeCategory].push({ index, flow, buyRatio });
            });
        }

        // Categorize by institutional/retail if available
        if (institutionalFlow && institutionalFlow.length > 0) {
            institutionalFlow.forEach((flow, index) => {
                const category = flow.isInstitutional ? 
                               this.volumeCategories.institutional : 
                               this.volumeCategories.retail;

                if (!categorization.byType[category]) categorization.byType[category] = [];
                categorization.byType[category].push({ index, flow });
            });
        }

        // Calculate category statistics
        categorization.categoryStats = this.calculateCategoryStatistics(categorization);

        return {
            categorization: categorization,
            averageVolume: averageVolume,
            volumeDistribution: this.analyzeVolumeDistribution(categorization),
            dominantCategory: this.findDominantVolumeCategory(categorization),
            categoryConsistency: this.assessCategoryConsistency(categorization)
        };
    }

    analyzePriceReactions(volumeData, priceData, volumeCategorizationAnalysis) {
        const reactions = [];
        const reactionsByVolumeLevel = {};
        const reactionsByTimeHorizon = {};

        // Analyze price reactions for each volume event
        for (let i = 1; i < Math.min(volumeData.length, priceData.length); i++) {
            const volumeChange = (volumeData[i] - volumeData[i-1]) / volumeData[i-1];
            const volumeLevel = this.classifyVolumeLevel(volumeData[i], volumeCategorizationAnalysis.averageVolume);

            // Calculate price reactions across different time horizons
            const reactionData = {
                index: i,
                volume: volumeData[i],
                volumeLevel: volumeLevel,
                volumeChange: volumeChange,
                priceReactions: {}
            };

            // Calculate reactions for each time horizon
            Object.entries(this.timeHorizons).forEach(([horizon, periods]) => {
                if (i + periods < priceData.length) {
                    const priceChange = (priceData[i + periods] - priceData[i]) / priceData[i];
                    const reactionMagnitude = Math.abs(priceChange);
                    const reactionDirection = priceChange > 0 ? 'positive' : 'negative';

                    reactionData.priceReactions[horizon] = {
                        priceChange: priceChange,
                        magnitude: reactionMagnitude,
                        direction: reactionDirection,
                        reactionLevel: this.classifyReactionLevel(reactionMagnitude)
                    };
                }
            });

            reactions.push(reactionData);

            // Group by volume level
            if (!reactionsByVolumeLevel[volumeLevel]) reactionsByVolumeLevel[volumeLevel] = [];
            reactionsByVolumeLevel[volumeLevel].push(reactionData);
        }

        // Analyze reaction patterns
        const reactionPatterns = this.analyzeReactionPatterns(reactions);
        
        // Calculate reaction statistics
        const reactionStatistics = this.calculateReactionStatistics(reactions, reactionsByVolumeLevel);

        return {
            reactions: reactions,
            reactionsByVolumeLevel: reactionsByVolumeLevel,
            reactionsByTimeHorizon: reactionsByTimeHorizon,
            reactionPatterns: reactionPatterns,
            reactionStatistics: reactionStatistics,
            totalReactions: reactions.length,
            averageReactionMagnitude: this.calculateAverageReactionMagnitude(reactions),
            strongestReactions: this.findStrongestReactions(reactions),
            reactionConsistency: this.assessReactionConsistency(reactions)
        };
    }

    createReactivityMaps(priceReactionAnalysis, volumeCategorizationAnalysis, marketConditions) {
        const maps = {
            volumeLevelMaps: {},
            volumeTypeMaps: {},
            timeHorizonMaps: {},
            conditionalMaps: {}
        };

        // Create volume level reactivity maps
        Object.entries(priceReactionAnalysis.reactionsByVolumeLevel).forEach(([level, reactions]) => {
            maps.volumeLevelMaps[level] = this.createVolumeLevelMap(level, reactions);
        });

        // Create time horizon reactivity maps
        Object.entries(this.timeHorizons).forEach(([horizon, periods]) => {
            maps.timeHorizonMaps[horizon] = this.createTimeHorizonMap(horizon, priceReactionAnalysis.reactions);
        });

        // Create market condition conditional maps
        maps.conditionalMaps = this.createConditionalMaps(priceReactionAnalysis, marketConditions);

        // Calculate overall reactivity metrics
        const overallReactivity = this.calculateOverallReactivity(maps);
        
        // Assess map quality and reliability
        const mapQuality = this.assessMapQuality(maps, priceReactionAnalysis.reactions.length);

        return {
            maps: maps,
            overallReactivity: overallReactivity,
            mapQuality: mapQuality,
            reactivityStrength: this.calculateReactivityStrength(maps),
            mapConsistency: this.assessMapConsistency(maps),
            predictivePower: this.assessPredictivePower(maps, priceReactionAnalysis)
        };
    }

    performSensitivityAnalysis(reactivityMappingAnalysis, marketConditions, volatilityData) {
        const sensitivity = {
            volumeSensitivity: {},
            marketConditionSensitivity: {},
            volatilitySensitivity: {},
            timeSensitivity: {}
        };

        // Volume sensitivity analysis
        sensitivity.volumeSensitivity = this.analyzeVolumeSensitivity(reactivityMappingAnalysis.maps);

        // Market condition sensitivity
        if (marketConditions) {
            sensitivity.marketConditionSensitivity = this.analyzeMarketConditionSensitivity(
                reactivityMappingAnalysis,
                marketConditions
            );
        }

        // Volatility sensitivity
        if (volatilityData) {
            sensitivity.volatilitySensitivity = this.analyzeVolatilitySensitivity(
                reactivityMappingAnalysis,
                volatilityData
            );
        }

        // Time sensitivity analysis
        sensitivity.timeSensitivity = this.analyzeTimeSensitivity(reactivityMappingAnalysis.maps);

        return {
            sensitivity: sensitivity,
            overallSensitivity: this.calculateOverallSensitivity(sensitivity),
            sensitivityStability: this.assessSensitivityStability(sensitivity),
            sensitivityPredictability: this.assessSensitivityPredictability(sensitivity),
            criticalSensitivityLevels: this.identifyCriticalSensitivityLevels(sensitivity)
        };
    }

    identifyReactionPatterns(priceReactionAnalysis, reactivityHistory) {
        const patterns = [];
        const patternTypes = {
            linear: 'linear_reaction',
            exponential: 'exponential_reaction',
            logarithmic: 'logarithmic_reaction',
            threshold: 'threshold_reaction',
            delayed: 'delayed_reaction',
            diminishing: 'diminishing_reaction'
        };

        // Analyze current reaction patterns
        const currentPatterns = this.analyzeCurrentReactionPatterns(priceReactionAnalysis.reactions);
        patterns.push(...currentPatterns);

        // Compare with historical patterns
        if (reactivityHistory.length > 0) {
            const historicalPatterns = this.compareWithHistoricalPatterns(currentPatterns, reactivityHistory);
            patterns.push(...historicalPatterns);
        }

        // Pattern persistence analysis
        const patternPersistence = this.analyzePatternPersistence(patterns, reactivityHistory);

        // Pattern reliability assessment
        const patternReliability = this.assessPatternReliability(patterns);

        return {
            patterns: patterns,
            patternTypes: this.classifyPatternTypes(patterns),
            persistence: patternPersistence,
            reliability: patternReliability,
            dominantPattern: this.findDominantPattern(patterns),
            patternStrength: this.calculatePatternStrength(patterns),
            patternConsistency: this.assessPatternConsistency(patterns)
        };
    }

    analyzeTimeBasedReactivity(priceReactionAnalysis, sessionData, marketConditions) {
        const timeAnalysis = {
            sessionReactivity: {},
            hourlyReactivity: {},
            dayOfWeekReactivity: {},
            marketPhaseReactivity: {}
        };

        // Session-based analysis (if session data available)
        if (sessionData) {
            timeAnalysis.sessionReactivity = this.analyzeSessionReactivity(priceReactionAnalysis, sessionData);
        }

        // Hourly reactivity patterns
        timeAnalysis.hourlyReactivity = this.analyzeHourlyReactivity(priceReactionAnalysis);

        // Day of week patterns
        timeAnalysis.dayOfWeekReactivity = this.analyzeDayOfWeekReactivity(priceReactionAnalysis);

        // Market phase reactivity (opening, mid-day, closing)
        timeAnalysis.marketPhaseReactivity = this.analyzeMarketPhaseReactivity(priceReactionAnalysis, marketConditions);

        return {
            timeAnalysis: timeAnalysis,
            optimalReactivityWindows: this.identifyOptimalReactivityWindows(timeAnalysis),
            timeBasedRecommendations: this.generateTimeBasedRecommendations(timeAnalysis),
            temporalConsistency: this.assessTemporalConsistency(timeAnalysis),
            timeEfficiencyScore: this.calculateTimeEfficiencyScore(timeAnalysis)
        };
    }

    buildPredictiveReactivityModels(reactivityMappingAnalysis, reactionPatternIdentification) {
        const models = {
            volumeReactionModel: {},
            patternBasedModel: {},
            thresholdModel: {},
            timeBasedModel: {}
        };

        // Volume-based reaction prediction model
        models.volumeReactionModel = this.buildVolumeReactionModel(reactivityMappingAnalysis);

        // Pattern-based prediction model
        models.patternBasedModel = this.buildPatternBasedModel(reactionPatternIdentification);

        // Threshold-based model
        models.thresholdModel = this.buildThresholdModel(reactivityMappingAnalysis);

        // Time-based prediction model
        models.timeBasedModel = this.buildTimeBasedModel(reactivityMappingAnalysis);

        // Model ensemble and validation
        const modelEnsemble = this.createModelEnsemble(models);
        const modelValidation = this.validatePredictiveModels(models, this.reactivityHistory);

        return {
            models: models,
            ensemble: modelEnsemble,
            validation: modelValidation,
            accuracy: modelValidation.overallAccuracy,
            reliability: modelValidation.reliability,
            predictivePower: this.assessPredictivePower(models, modelValidation)
        };
    }

    detectVolumeReactionAnomalies(priceReactionAnalysis, reactivityMappingAnalysis) {
        const anomalies = [];
        const anomalyTypes = {
            unexpected_strong: 'unexpected_strong_reaction',
            unexpected_weak: 'unexpected_weak_reaction',
            reversed_reaction: 'reversed_reaction',
            delayed_reaction: 'delayed_reaction',
            persistent_reaction: 'persistent_reaction'
        };

        // Analyze each reaction for anomalies
        priceReactionAnalysis.reactions.forEach(reaction => {
            const expectedReaction = this.calculateExpectedReaction(reaction, reactivityMappingAnalysis);
            const anomaly = this.detectReactionAnomaly(reaction, expectedReaction);
            
            if (anomaly.isAnomaly) {
                anomalies.push({
                    ...reaction,
                    anomaly: anomaly,
                    severity: this.calculateAnomalySeverity(anomaly),
                    impact: this.assessAnomalyImpact(anomaly, reaction)
                });
            }
        });

        // Anomaly clustering analysis
        const anomalyClusters = this.analyzeAnomalyClusters(anomalies);
        
        // Anomaly trend analysis
        const anomalyTrends = this.analyzeAnomalyTrends(anomalies, this.reactivityHistory);

        return {
            anomalies: anomalies,
            anomalyCount: anomalies.length,
            anomalyClusters: anomalyClusters,
            anomalyTrends: anomalyTrends,
            anomalyRate: anomalies.length / priceReactionAnalysis.reactions.length,
            severityDistribution: this.analyzeSeverityDistribution(anomalies),
            anomalyImpact: this.calculateOverallAnomalyImpact(anomalies)
        };
    }

    getCurrentStatus(reactivityMappingAnalysis, sensitivityAnalysis, predictiveReactivityModeling) {
        return {
            mappingQuality: this.assessMappingQuality(reactivityMappingAnalysis),
            reactivityLevel: this.classifyReactivityLevel(reactivityMappingAnalysis.overallReactivity),
            sensitivityLevel: this.classifySensitivityLevel(sensitivityAnalysis.overallSensitivity),
            predictionAccuracy: predictiveReactivityModeling.accuracy,
            mappingReliability: reactivityMappingAnalysis.mapQuality.reliability,
            overallPerformance: this.calculateOverallPerformance(reactivityMappingAnalysis, 
                                                               sensitivityAnalysis,
                                                               predictiveReactivityModeling),
            recommendedAction: this.determineRecommendedAction(reactivityMappingAnalysis, sensitivityAnalysis),
            confidenceLevel: this.calculateOverallConfidence(reactivityMappingAnalysis, predictiveReactivityModeling)
        };
    }

    // Helper methods for calculations
    calculateAverageVolume(volumeData) {
        if (!volumeData || volumeData.length === 0) return 0;
        return volumeData.reduce((sum, volume) => sum + volume, 0) / volumeData.length;
    }

    classifyVolumeLevel(volume, averageVolume) {
        const ratio = volume / averageVolume;
        
        if (ratio >= this.volumeThresholds.extreme) return 'extreme';
        if (ratio >= this.volumeThresholds.high) return 'high';
        if (ratio >= this.volumeThresholds.normal) return 'normal';
        return 'low';
    }

    classifyReactionLevel(reactionMagnitude) {
        if (reactionMagnitude >= this.priceReactionLevels.extreme) return 'extreme';
        if (reactionMagnitude >= this.priceReactionLevels.large) return 'large';
        if (reactionMagnitude >= this.priceReactionLevels.medium) return 'medium';
        if (reactionMagnitude >= this.priceReactionLevels.small) return 'small';
        return 'minimal';
    }

    calculateAverageReactionMagnitude(reactions) {
        if (!reactions || reactions.length === 0) return 0;
        
        const totalMagnitude = reactions.reduce((sum, reaction) => {
            const immediateReaction = reaction.priceReactions.immediate;
            return sum + (immediateReaction ? immediateReaction.magnitude : 0);
        }, 0);
        
        return totalMagnitude / reactions.length;
    }

    createVolumeLevelMap(level, reactions) {
        const map = {
            level: level,
            reactionCount: reactions.length,
            averageReaction: {},
            reactionDistribution: {},
            reliability: 0
        };

        // Calculate average reactions for each time horizon
        Object.keys(this.timeHorizons).forEach(horizon => {
            const horizonReactions = reactions
                .map(r => r.priceReactions[horizon])
                .filter(r => r !== undefined);

            if (horizonReactions.length > 0) {
                const avgMagnitude = horizonReactions.reduce((sum, r) => sum + r.magnitude, 0) / horizonReactions.length;
                const avgChange = horizonReactions.reduce((sum, r) => sum + r.priceChange, 0) / horizonReactions.length;
                
                map.averageReaction[horizon] = {
                    magnitude: avgMagnitude,
                    priceChange: avgChange,
                    sampleSize: horizonReactions.length
                };
            }
        });

        // Calculate reliability based on sample size and consistency
        map.reliability = this.calculateMapReliability(reactions.length, map.averageReaction);

        return map;
    }

    calculateMapReliability(sampleSize, averageReactions) {
        let reliability = Math.min(sampleSize / 100, 1.0); // Base reliability from sample size
        
        // Adjust for consistency across time horizons
        const reactionVariances = Object.values(averageReactions).map(r => r.magnitude);
        if (reactionVariances.length > 1) {
            const variance = this.calculateVariance(reactionVariances);
            reliability *= Math.max(0.5, 1 - variance); // Penalize high variance
        }
        
        return reliability;
    }

    calculateVariance(values) {
        if (values.length === 0) return 0;
        const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
        const squaredDiffs = values.map(val => Math.pow(val - mean, 2));
        return squaredDiffs.reduce((sum, diff) => sum + diff, 0) / values.length;
    }

    generateRecommendations(reactivityMappingAnalysis, sensitivityAnalysis, predictiveReactivityModeling) {
        const recommendations = {};

        // Mapping quality recommendations
        if (reactivityMappingAnalysis.mapQuality.reliability < 0.7) {
            recommendations.mapping = {
                action: 'improve_mapping_quality',
                reason: 'Low mapping reliability detected',
                urgency: 'medium'
            };
        }

        // Sensitivity recommendations
        if (sensitivityAnalysis.overallSensitivity > 0.8) {
            recommendations.sensitivity = {
                action: 'adjust_for_high_sensitivity',
                reason: 'High volume sensitivity detected',
                urgency: 'high'
            };
        }

        // Prediction accuracy recommendations
        if (predictiveReactivityModeling.accuracy < 0.6) {
            recommendations.prediction = {
                action: 'enhance_prediction_models',
                reason: 'Low prediction accuracy',
                urgency: 'medium'
            };
        }

        return recommendations;
    }

    generateAlerts(volumeReactionAnomalyDetection, sensitivityAnalysis, reactivityMappingAnalysis) {
        const alerts = [];

        // High anomaly rate alert
        if (volumeReactionAnomalyDetection.anomalyRate > 0.2) {
            alerts.push({
                level: 'warning',
                message: 'Yüksek anomali oranı tespit edildi',
                action: 'Reaktivite kalıplarını gözden geçir'
            });
        }

        // Extreme sensitivity alert
        if (sensitivityAnalysis.overallSensitivity > 0.9) {
            alerts.push({
                level: 'critical',
                message: 'Aşırı hacim hassasiyeti',
                action: 'Risk parametrelerini ayarla'
            });
        }

        // Low mapping quality alert
        if (reactivityMappingAnalysis.mapQuality.reliability < 0.5) {
            alerts.push({
                level: 'warning',
                message: 'Düşük haritalama kalitesi',
                action: 'Veri kalitesini kontrol et'
            });
        }

        return alerts;
    }

    generateNotes(reactivityMappingAnalysis, reactionPatternIdentification, sensitivityAnalysis) {
        const notes = [];

        notes.push(`Reaktivite seviyesi: ${reactivityMappingAnalysis.reactivityStrength.toFixed(2)}`);
        notes.push(`Tespit edilen pattern sayısı: ${reactionPatternIdentification.patterns.length}`);
        notes.push(`Genel hassasiyet: ${(sensitivityAnalysis.overallSensitivity * 100).toFixed(1)}%`);

        if (reactionPatternIdentification.dominantPattern) {
            notes.push(`Dominant pattern: ${reactionPatternIdentification.dominantPattern}`);
        }

        return notes.join('. ');
    }

    updateReactivityHistory(result, data) {
        this.reactivityHistory.push({
            timestamp: Date.now(),
            overallReactivity: result.metadata.reactivityScore,
            sensitivityLevel: result.metadata.sensitivityLevel,
            patternCount: result.metadata.identifiedPatterns,
            mappingQuality: result.currentStatus.mappingQuality,
            predictionAccuracy: result.metadata.predictionAccuracy
        });

        if (this.reactivityHistory.length > this.maxHistorySize) {
            this.reactivityHistory = this.reactivityHistory.slice(-this.maxHistorySize);
        }
    }

    getDefaultResult() {
        return {
            volumeCategorizationAnalysis: {
                categorization: { bySize: {}, byType: {}, byTimeHorizon: {}, categoryStats: {} },
                averageVolume: 0,
                volumeDistribution: {},
                dominantCategory: 'normal',
                categoryConsistency: 0.5
            },
            priceReactionAnalysis: {
                reactions: [],
                reactionsByVolumeLevel: {},
                reactionsByTimeHorizon: {},
                reactionPatterns: {},
                reactionStatistics: {},
                totalReactions: 0,
                averageReactionMagnitude: 0,
                strongestReactions: [],
                reactionConsistency: 0.5
            },
            reactivityMappingAnalysis: {
                maps: { volumeLevelMaps: {}, volumeTypeMaps: {}, timeHorizonMaps: {}, conditionalMaps: {} },
                overallReactivity: 0.5,
                mapQuality: { reliability: 0.5 },
                reactivityStrength: 0.5,
                mapConsistency: 0.5,
                predictivePower: 0.5
            },
            sensitivityAnalysis: {
                sensitivity: { volumeSensitivity: {}, marketConditionSensitivity: {}, volatilitySensitivity: {}, timeSensitivity: {} },
                overallSensitivity: 0.5,
                sensitivityStability: 0.5,
                sensitivityPredictability: 0.5,
                criticalSensitivityLevels: {}
            },
            reactionPatternIdentification: {
                patterns: [],
                patternTypes: {},
                persistence: {},
                reliability: 0.5,
                dominantPattern: null,
                patternStrength: 0.5,
                patternConsistency: 0.5
            },
            timeBasedReactivityAnalysis: {
                timeAnalysis: { sessionReactivity: {}, hourlyReactivity: {}, dayOfWeekReactivity: {}, marketPhaseReactivity: {} },
                optimalReactivityWindows: {},
                timeBasedRecommendations: {},
                temporalConsistency: 0.5,
                timeEfficiencyScore: 0.5
            },
            predictiveReactivityModeling: {
                models: { volumeReactionModel: {}, patternBasedModel: {}, thresholdModel: {}, timeBasedModel: {} },
                ensemble: {},
                validation: { overallAccuracy: 0.6 },
                accuracy: 0.6,
                reliability: 0.5,
                predictivePower: 0.5
            },
            volumeReactionAnomalyDetection: {
                anomalies: [],
                anomalyCount: 0,
                anomalyClusters: {},
                anomalyTrends: {},
                anomalyRate: 0,
                severityDistribution: {},
                anomalyImpact: 0
            },
            microstructureImpactAnalysis: {
                bidAskImpact: {},
                depthImpact: {},
                spreadImpact: {},
                liquidityImpact: {}
            },
            crossAssetReactivityComparison: {
                correlatedAssets: {},
                reactivityComparison: {},
                relativeSensitivity: {}
            },
            adaptiveThresholdCalibration: {
                calibrationNeeded: false,
                recommendedThresholds: {},
                calibrationQuality: 0.5
            },
            currentStatus: {
                mappingQuality: 'medium',
                reactivityLevel: 'medium',
                sensitivityLevel: 'medium',
                predictionAccuracy: 0.6,
                mappingReliability: 0.5,
                overallPerformance: 0.5,
                recommendedAction: 'monitor',
                confidenceLevel: 0.5
            },
            recommendations: {},
            alerts: [],
            notes: "Hacim reaktivite analizi yapılamadı - yetersiz veri",
            metadata: {
                error: true,
                analysisTimestamp: Date.now()
            }
        };
    }

    getModuleInfo() {
        return {
            name: 'VolumeReactivityMap',
            version: '1.0.0',
            description: 'Hacim reaktivite haritası - Fiyatın belirli hacim değişimlerine nasıl tepki verdiğini haritalandırır - Volume-price reaction mapping, reactivity patterns, sensitivity analysis, volume impact modeling',
            inputs: [
                'symbol', 'volumeData', 'priceData', 'orderFlowData', 'timeframe', 'marketConditions',
                'liquidityMetrics', 'bidAskData', 'tradeData', 'institutionalFlow', 'retailFlow',
                'algorithmicActivity', 'marketDepth', 'sessionData', 'volatilityData', 'correlationData',
                'newsImpact', 'economicEvents', 'technicalIndicators'
            ],
            outputs: [
                'volumeCategorizationAnalysis', 'priceReactionAnalysis', 'reactivityMappingAnalysis',
                'sensitivityAnalysis', 'reactionPatternIdentification', 'timeBasedReactivityAnalysis',
                'predictiveReactivityModeling', 'volumeReactionAnomalyDetection', 'microstructureImpactAnalysis',
                'crossAssetReactivityComparison', 'adaptiveThresholdCalibration', 'currentStatus',
                'recommendations', 'alerts', 'notes', 'metadata'
            ]
        };
    }
}

module.exports = VolumeReactivityMap;
