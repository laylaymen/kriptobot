const GrafikBeyniModuleBase = require('./grafikBeyniModuleBase');

/**
 * Combo Break Verifier Module
 * Kombine kırılım doğrulayıcısı - RSI + EMA + Orderflow uyumu varken sinyalin başarısız olma oranını analiz eder
 * Multi-indicator confirmation, breakout verification, failure rate analysis, signal validation
 */
class ComboBreakVerifier extends GrafikBeyniModuleBase {
    constructor() {
        super('comboBreakVerifier');
        this.verificationHistory = [];
        this.comboPatterns = [];
        this.indicatorWeights = {
            rsi: 0.25,        // RSI weight
            ema: 0.30,        // EMA weight
            orderflow: 0.35,  // Order flow weight
            volume: 0.10      // Volume weight
        };
        this.thresholds = {
            rsi: {
                oversold: 30,
                overbought: 70,
                neutral: { min: 40, max: 60 }
            },
            ema: {
                bullish_threshold: 0.02,  // 2% above EMA
                bearish_threshold: -0.02, // 2% below EMA
                convergence_threshold: 0.005 // 0.5% for convergence
            },
            orderflow: {
                buy_pressure_threshold: 0.6,  // 60% buy pressure
                sell_pressure_threshold: 0.4, // 40% sell pressure
                imbalance_threshold: 0.2      // 20% imbalance
            },
            volume: {
                surge_multiplier: 1.5,  // 1.5x average volume
                decline_multiplier: 0.7 // 0.7x average volume
            }
        };
        this.comboTypes = {
            bullish_breakout: 'bullish_breakout',
            bearish_breakdown: 'bearish_breakdown',
            continuation: 'continuation',
            reversal: 'reversal',
            false_break: 'false_break'
        };
        this.confidenceLevels = {
            high: 0.8,
            medium: 0.6,
            low: 0.4
        };
        this.maxHistorySize = 1000;
        this.minObservations = 50;
        this.learningRate = 0.1;
        this.decayFactor = 0.95;
    }

    async analyze(data) {
        try {
            const {
                symbol,
                rsiData,
                emaData,
                orderFlowData,
                volumeData,
                priceData,
                signalCandidates,
                historicalBreakouts,
                timeframe,
                marketConditions,
                volatilityData,
                liquidityMetrics,
                supportResistanceLevels,
                trendData,
                sessionData,
                correlationData,
                newsImpact,
                institutionalFlow,
                retailFlow
            } = data;

            // Veri doğrulama
            if (!rsiData || !emaData || !orderFlowData) {
                throw new Error('Insufficient indicator data for combo break verification');
            }

            // Individual indicator analysis
            const rsiAnalysis = this.analyzeRSI(rsiData, priceData, marketConditions);
            const emaAnalysis = this.analyzeEMA(emaData, priceData, trendData);
            const orderFlowAnalysis = this.analyzeOrderFlow(orderFlowData, volumeData, priceData);
            const volumeAnalysis = this.analyzeVolume(volumeData, priceData, volatilityData);

            // Combo pattern identification
            const comboPatternIdentification = this.identifyComboPatterns(rsiAnalysis, emaAnalysis,
                                                                        orderFlowAnalysis, volumeAnalysis);

            // Signal candidate verification
            const signalCandidateVerification = this.verifySignalCandidates(signalCandidates,
                                                                           comboPatternIdentification,
                                                                           marketConditions);

            // Breakout probability analysis
            const breakoutProbabilityAnalysis = this.analyzeBreakoutProbability(comboPatternIdentification,
                                                                               historicalBreakouts,
                                                                               supportResistanceLevels);

            // Failure rate analysis
            const failureRateAnalysis = this.analyzeFailureRates(comboPatternIdentification,
                                                                historicalBreakouts,
                                                                this.verificationHistory);

            // Confluence strength assessment
            const confluenceStrengthAssessment = this.assessConfluenceStrength(rsiAnalysis, emaAnalysis,
                                                                              orderFlowAnalysis, volumeAnalysis);

            // Risk-reward validation
            const riskRewardValidation = this.validateRiskReward(comboPatternIdentification,
                                                               supportResistanceLevels,
                                                               volatilityData);

            // Timing optimization analysis
            const timingOptimizationAnalysis = this.analyzeTimingOptimization(comboPatternIdentification,
                                                                             sessionData,
                                                                             marketConditions);

            // Adaptive threshold calibration
            const adaptiveThresholdCalibration = this.performAdaptiveThresholdCalibration(failureRateAnalysis,
                                                                                         breakoutProbabilityAnalysis);

            // Market condition sensitivity analysis
            const marketConditionSensitivityAnalysis = this.analyzeMarketConditionSensitivity(
                comboPatternIdentification,
                marketConditions,
                this.verificationHistory
            );

            // Performance tracking and learning
            const performanceTrackingAnalysis = this.analyzePerformanceTracking(this.verificationHistory,
                                                                               comboPatternIdentification);

            const result = {
                rsiAnalysis: rsiAnalysis,
                emaAnalysis: emaAnalysis,
                orderFlowAnalysis: orderFlowAnalysis,
                volumeAnalysis: volumeAnalysis,
                comboPatternIdentification: comboPatternIdentification,
                signalCandidateVerification: signalCandidateVerification,
                breakoutProbabilityAnalysis: breakoutProbabilityAnalysis,
                failureRateAnalysis: failureRateAnalysis,
                confluenceStrengthAssessment: confluenceStrengthAssessment,
                riskRewardValidation: riskRewardValidation,
                timingOptimizationAnalysis: timingOptimizationAnalysis,
                adaptiveThresholdCalibration: adaptiveThresholdCalibration,
                marketConditionSensitivityAnalysis: marketConditionSensitivityAnalysis,
                performanceTrackingAnalysis: performanceTrackingAnalysis,
                currentStatus: this.getCurrentStatus(comboPatternIdentification, failureRateAnalysis,
                                                   confluenceStrengthAssessment),
                recommendations: this.generateRecommendations(signalCandidateVerification, 
                                                            failureRateAnalysis,
                                                            adaptiveThresholdCalibration),
                alerts: this.generateAlerts(comboPatternIdentification, failureRateAnalysis,
                                          confluenceStrengthAssessment),
                notes: this.generateNotes(comboPatternIdentification, failureRateAnalysis,
                                        confluenceStrengthAssessment),
                metadata: {
                    analysisTimestamp: Date.now(),
                    symbol: symbol,
                    timeframe: timeframe,
                    comboPatternCount: comboPatternIdentification.patterns.length,
                    verifiedSignalCount: signalCandidateVerification.verifiedSignals.length,
                    averageFailureRate: failureRateAnalysis.averageFailureRate,
                    confluenceStrength: confluenceStrengthAssessment.overallStrength,
                    verificationAccuracy: performanceTrackingAnalysis.accuracy
                }
            };

            // History güncelleme
            this.updateVerificationHistory(result, data);

            // Cache ve performance tracking
            this.updateCache(data, result);
            this.trackPerformance(Date.now(), result.currentStatus.verificationQuality === 'high');

            return result;

        } catch (error) {
            this.handleError('ComboBreakVerifier analysis failed', error, data);
            return this.getDefaultResult();
        }
    }

    analyzeRSI(rsiData, priceData, marketConditions) {
        if (!rsiData || rsiData.length === 0) {
            return this.getDefaultRSIAnalysis();
        }

        const currentRSI = rsiData[rsiData.length - 1];
        const previousRSI = rsiData.length > 1 ? rsiData[rsiData.length - 2] : currentRSI;

        // RSI momentum analysis
        const rsiMomentum = currentRSI - previousRSI;
        const rsiTrend = this.calculateRSITrend(rsiData.slice(-10)); // Last 10 periods

        // RSI divergence analysis
        const rsiDivergence = this.analyzeRSIDivergence(rsiData, priceData);

        // RSI level classification
        const rsiLevel = this.classifyRSILevel(currentRSI);

        // RSI signal strength
        const signalStrength = this.calculateRSISignalStrength(currentRSI, rsiMomentum, rsiTrend);

        // Market condition adjustment
        const adjustedRSI = this.adjustRSIForMarketConditions(currentRSI, marketConditions);

        return {
            currentValue: currentRSI,
            previousValue: previousRSI,
            momentum: rsiMomentum,
            trend: rsiTrend,
            divergence: rsiDivergence,
            level: rsiLevel,
            signalStrength: signalStrength,
            adjustedValue: adjustedRSI,
            bullishSignal: currentRSI < this.thresholds.rsi.oversold && rsiMomentum > 0,
            bearishSignal: currentRSI > this.thresholds.rsi.overbought && rsiMomentum < 0,
            neutralZone: currentRSI >= this.thresholds.rsi.neutral.min && 
                        currentRSI <= this.thresholds.rsi.neutral.max,
            confidence: this.calculateRSIConfidence(currentRSI, rsiMomentum, rsiDivergence)
        };
    }

    analyzeEMA(emaData, priceData, trendData) {
        if (!emaData || emaData.length === 0 || !priceData || priceData.length === 0) {
            return this.getDefaultEMAAnalysis();
        }

        const currentPrice = priceData[priceData.length - 1];
        const currentEMA = emaData[emaData.length - 1];
        const previousEMA = emaData.length > 1 ? emaData[emaData.length - 2] : currentEMA;

        // Price-EMA relationship
        const priceEMADistance = (currentPrice - currentEMA) / currentEMA;
        const pricePosition = this.determinePriceEMAPosition(priceEMADistance);

        // EMA trend analysis
        const emaTrend = this.calculateEMATrend(emaData.slice(-10));
        const emaSlope = (currentEMA - previousEMA) / previousEMA;

        // EMA support/resistance analysis
        const supportResistanceLevel = this.analyzeEMASupportResistance(emaData, priceData);

        // Convergence/divergence analysis
        const convergenceDivergence = this.analyzeEMAConvergenceDivergence(emaData, priceData);

        // Signal generation
        const signals = this.generateEMASignals(priceEMADistance, emaTrend, emaSlope);

        return {
            currentValue: currentEMA,
            currentPrice: currentPrice,
            distance: priceEMADistance,
            position: pricePosition,
            trend: emaTrend,
            slope: emaSlope,
            supportResistanceLevel: supportResistanceLevel,
            convergenceDivergence: convergenceDivergence,
            signals: signals,
            bullishSignal: priceEMADistance > this.thresholds.ema.bullish_threshold && emaTrend === 'rising',
            bearishSignal: priceEMADistance < this.thresholds.ema.bearish_threshold && emaTrend === 'falling',
            convergingSignal: Math.abs(priceEMADistance) < this.thresholds.ema.convergence_threshold,
            confidence: this.calculateEMAConfidence(priceEMADistance, emaTrend, convergenceDivergence)
        };
    }

    analyzeOrderFlow(orderFlowData, volumeData, priceData) {
        if (!orderFlowData) {
            return this.getDefaultOrderFlowAnalysis();
        }

        // Buy/sell pressure analysis
        const buyPressure = orderFlowData.buyVolume / (orderFlowData.buyVolume + orderFlowData.sellVolume);
        const sellPressure = 1 - buyPressure;

        // Order flow imbalance
        const flowImbalance = buyPressure - sellPressure;
        const imbalanceStrength = Math.abs(flowImbalance);

        // Order flow momentum
        const flowMomentum = this.calculateOrderFlowMomentum(orderFlowData);

        // Institutional vs retail flow
        const institutionalFlow = this.analyzeInstitutionalFlow(orderFlowData);
        const retailFlow = this.analyzeRetailFlow(orderFlowData);

        // Order flow divergence with price
        const priceFlowDivergence = this.analyzeOrderFlowPriceDivergence(orderFlowData, priceData);

        // Order flow velocity
        const flowVelocity = this.calculateOrderFlowVelocity(orderFlowData, volumeData);

        return {
            buyPressure: buyPressure,
            sellPressure: sellPressure,
            imbalance: flowImbalance,
            imbalanceStrength: imbalanceStrength,
            momentum: flowMomentum,
            institutionalFlow: institutionalFlow,
            retailFlow: retailFlow,
            priceDivergence: priceFlowDivergence,
            velocity: flowVelocity,
            bullishSignal: buyPressure > this.thresholds.orderflow.buy_pressure_threshold,
            bearishSignal: sellPressure > (1 - this.thresholds.orderflow.sell_pressure_threshold),
            strongImbalance: imbalanceStrength > this.thresholds.orderflow.imbalance_threshold,
            confidence: this.calculateOrderFlowConfidence(imbalanceStrength, flowMomentum, priceFlowDivergence)
        };
    }

    analyzeVolume(volumeData, priceData, volatilityData) {
        if (!volumeData || volumeData.length === 0) {
            return this.getDefaultVolumeAnalysis();
        }

        const currentVolume = volumeData[volumeData.length - 1];
        const averageVolume = this.calculateAverageVolume(volumeData.slice(-20)); // 20-period average

        // Volume surge/decline analysis
        const volumeRatio = currentVolume / averageVolume;
        const volumeCondition = this.classifyVolumeCondition(volumeRatio);

        // Volume-price correlation
        const volumePriceCorrelation = this.calculateVolumePriceCorrelation(volumeData, priceData);

        // Volume momentum
        const volumeMomentum = this.calculateVolumeMomentum(volumeData.slice(-5));

        // Volume distribution analysis
        const volumeDistribution = this.analyzeVolumeDistribution(volumeData);

        // Volume volatility correlation
        const volumeVolatilityCorrelation = volatilityData ? 
                                          this.calculateVolumeVolatilityCorrelation(volumeData, volatilityData) : 0;

        return {
            currentVolume: currentVolume,
            averageVolume: averageVolume,
            ratio: volumeRatio,
            condition: volumeCondition,
            priceCorrelation: volumePriceCorrelation,
            momentum: volumeMomentum,
            distribution: volumeDistribution,
            volatilityCorrelation: volumeVolatilityCorrelation,
            surgingVolume: volumeRatio > this.thresholds.volume.surge_multiplier,
            decliningVolume: volumeRatio < this.thresholds.volume.decline_multiplier,
            normalVolume: volumeRatio >= this.thresholds.volume.decline_multiplier && 
                         volumeRatio <= this.thresholds.volume.surge_multiplier,
confidence: this.calculateVolumeConfidence(volumeRatio, volumeData, volumePriceCorrelation)
        };
    }

    identifyComboPatterns(rsiAnalysis, emaAnalysis, orderFlowAnalysis, volumeAnalysis) {
        const patterns = [];
        
        // Bullish breakout pattern
        const bullishBreakout = this.identifyBullishBreakoutPattern(rsiAnalysis, emaAnalysis, 
                                                                   orderFlowAnalysis, volumeAnalysis);
        if (bullishBreakout) patterns.push(bullishBreakout);

        // Bearish breakdown pattern
        const bearishBreakdown = this.identifyBearishBreakdownPattern(rsiAnalysis, emaAnalysis,
                                                                     orderFlowAnalysis, volumeAnalysis);
        if (bearishBreakdown) patterns.push(bearishBreakdown);

        // Continuation pattern
        const continuationPattern = this.identifyContinuationPattern(rsiAnalysis, emaAnalysis,
                                                                    orderFlowAnalysis, volumeAnalysis);
        if (continuationPattern) patterns.push(continuationPattern);

        // Reversal pattern
        const reversalPattern = this.identifyReversalPattern(rsiAnalysis, emaAnalysis,
                                                            orderFlowAnalysis, volumeAnalysis);
        if (reversalPattern) patterns.push(reversalPattern);

        // False break pattern
        const falseBreakPattern = this.identifyFalseBreakPattern(rsiAnalysis, emaAnalysis,
                                                               orderFlowAnalysis, volumeAnalysis);
        if (falseBreakPattern) patterns.push(falseBreakPattern);

        // Pattern strength analysis
        const patternStrengths = this.calculatePatternStrengths(patterns);
        
        // Pattern confluence analysis
        const patternConfluence = this.analyzePatternConfluence(patterns);

        return {
            patterns: patterns,
            patternStrengths: patternStrengths,
            confluence: patternConfluence,
            dominantPattern: this.findDominantPattern(patterns, patternStrengths),
            patternCount: patterns.length,
            overallStrength: this.calculateOverallPatternStrength(patterns, patternStrengths),
            reliability: this.assessPatternReliability(patterns, patternConfluence)
        };
    }

    verifySignalCandidates(signalCandidates, comboPatternIdentification, marketConditions) {
        if (!signalCandidates || signalCandidates.length === 0) {
            return { verifiedSignals: [], rejectedSignals: [], verificationRate: 0 };
        }

        const verifiedSignals = [];
        const rejectedSignals = [];

        signalCandidates.forEach(signal => {
            const verification = this.verifyIndividualSignal(signal, comboPatternIdentification, marketConditions);
            
            if (verification.verified) {
                verifiedSignals.push({
                    ...signal,
                    verification: verification,
                    enhancedConfidence: verification.confidence
                });
            } else {
                rejectedSignals.push({
                    ...signal,
                    rejectionReason: verification.rejectionReason,
                    rejectionConfidence: verification.confidence
                });
            }
        });

        const verificationRate = signalCandidates.length > 0 ? 
                               verifiedSignals.length / signalCandidates.length : 0;

        return {
            verifiedSignals: verifiedSignals,
            rejectedSignals: rejectedSignals,
            verificationRate: verificationRate,
            verificationQuality: this.assessVerificationQuality(verifiedSignals, rejectedSignals),
            verificationReliability: this.calculateVerificationReliability(verificationRate, 
                                                                          comboPatternIdentification)
        };
    }

    analyzeBreakoutProbability(comboPatternIdentification, historicalBreakouts, supportResistanceLevels) {
        const { patterns, overallStrength } = comboPatternIdentification;
        
        // Historical success rate analysis
        const historicalSuccessRate = this.calculateHistoricalSuccessRate(patterns, historicalBreakouts);
        
        // Pattern-specific probability
        const patternProbabilities = this.calculatePatternProbabilities(patterns, historicalBreakouts);
        
        // Support/resistance impact on probability
        const srImpact = this.analyzeSupportResistanceImpact(patterns, supportResistanceLevels);
        
        // Market condition probability adjustment
        const marketAdjustment = this.calculateMarketConditionAdjustment(patterns);
        
        // Combined probability calculation
        const combinedProbability = this.calculateCombinedBreakoutProbability(
            historicalSuccessRate,
            patternProbabilities,
            srImpact,
            marketAdjustment,
            overallStrength
        );

        return {
            historicalSuccessRate: historicalSuccessRate,
            patternProbabilities: patternProbabilities,
            supportResistanceImpact: srImpact,
            marketAdjustment: marketAdjustment,
            combinedProbability: combinedProbability,
            confidence: this.calculateProbabilityConfidence(combinedProbability, overallStrength),
            riskAssessment: this.assessBreakoutRisk(combinedProbability, patterns)
        };
    }

    analyzeFailureRates(comboPatternIdentification, historicalBreakouts, verificationHistory) {
        const { patterns } = comboPatternIdentification;
        
        // Pattern-specific failure rates
        const patternFailureRates = this.calculatePatternFailureRates(patterns, historicalBreakouts);
        
        // Combo-specific failure rates
        const comboFailureRates = this.calculateComboFailureRates(patterns, verificationHistory);
        
        // Time-based failure analysis
        const timeBasedFailure = this.analyzeTimeBasedFailure(verificationHistory);
        
        // Market condition failure correlation
        const marketConditionFailure = this.analyzeMarketConditionFailure(verificationHistory);
        
        // Failure pattern identification
        const failurePatterns = this.identifyFailurePatterns(patternFailureRates, comboFailureRates);

        return {
            patternFailureRates: patternFailureRates,
            comboFailureRates: comboFailureRates,
            timeBasedFailure: timeBasedFailure,
            marketConditionFailure: marketConditionFailure,
            failurePatterns: failurePatterns,
            averageFailureRate: this.calculateAverageFailureRate(patternFailureRates),
            worstCaseFailureRate: this.findWorstCaseFailureRate(patternFailureRates),
            failureTrend: this.analyzeFailureTrend(verificationHistory),
            riskLevel: this.assessFailureRiskLevel(patternFailureRates, comboFailureRates)
        };
    }

    assessConfluenceStrength(rsiAnalysis, emaAnalysis, orderFlowAnalysis, volumeAnalysis) {
        // Individual indicator strengths
        const rsiStrength = rsiAnalysis.confidence * this.indicatorWeights.rsi;
        const emaStrength = emaAnalysis.confidence * this.indicatorWeights.ema;
        const orderFlowStrength = orderFlowAnalysis.confidence * this.indicatorWeights.orderflow;
        const volumeStrength = volumeAnalysis.confidence * this.indicatorWeights.volume;

        // Signal alignment analysis
        const signalAlignment = this.analyzeSignalAlignment(rsiAnalysis, emaAnalysis, 
                                                           orderFlowAnalysis, volumeAnalysis);

        // Confluence score calculation
        const confluenceScore = this.calculateConfluenceScore(rsiStrength, emaStrength,
                                                             orderFlowStrength, volumeStrength,
                                                             signalAlignment);

        // Confluence quality assessment
        const confluenceQuality = this.assessConfluenceQuality(confluenceScore, signalAlignment);

        return {
            rsiStrength: rsiStrength,
            emaStrength: emaStrength,
            orderFlowStrength: orderFlowStrength,
            volumeStrength: volumeStrength,
            signalAlignment: signalAlignment,
            confluenceScore: confluenceScore,
            confluenceQuality: confluenceQuality,
            overallStrength: confluenceScore,
            reliability: this.calculateConfluenceReliability(confluenceScore, signalAlignment),
            weakestLink: this.identifyWeakestIndicator(rsiStrength, emaStrength, 
                                                      orderFlowStrength, volumeStrength)
        };
    }

    getCurrentStatus(comboPatternIdentification, failureRateAnalysis, confluenceStrengthAssessment) {
        return {
            patternDetected: comboPatternIdentification.patternCount > 0,
            dominantPattern: comboPatternIdentification.dominantPattern,
            patternStrength: comboPatternIdentification.overallStrength,
            failureRisk: failureRateAnalysis.riskLevel,
            confluenceStrength: confluenceStrengthAssessment.overallStrength,
            verificationQuality: this.assessOverallVerificationQuality(comboPatternIdentification, 
                                                                      failureRateAnalysis,
                                                                      confluenceStrengthAssessment),
            recommendedAction: this.determineRecommendedAction(comboPatternIdentification, 
                                                             failureRateAnalysis),
            confidenceLevel: this.calculateOverallConfidence(comboPatternIdentification, 
                                                           confluenceStrengthAssessment)
        };
    }

    // Helper methods for calculations
    calculateRSITrend(rsiValues) {
        if (rsiValues.length < 3) return 'neutral';
        
        const slope = (rsiValues[rsiValues.length - 1] - rsiValues[0]) / (rsiValues.length - 1);
        
        if (slope > 2) return 'strong_rising';
        if (slope > 0.5) return 'rising';
        if (slope < -2) return 'strong_falling';
        if (slope < -0.5) return 'falling';
        return 'neutral';
    }

    analyzeRSIDivergence(rsiData, priceData) {
        if (rsiData.length < 5 || priceData.length < 5) return { type: 'none', strength: 0 };
        
        const recentRSI = rsiData.slice(-5);
        const recentPrices = priceData.slice(-5);
        
        const rsiTrend = recentRSI[4] - recentRSI[0];
        const priceTrend = recentPrices[4] - recentPrices[0];
        
        // Bullish divergence: price falling, RSI rising
        if (priceTrend < 0 && rsiTrend > 0) {
            return { type: 'bullish', strength: Math.abs(rsiTrend) / 10 };
        }
        
        // Bearish divergence: price rising, RSI falling
        if (priceTrend > 0 && rsiTrend < 0) {
            return { type: 'bearish', strength: Math.abs(rsiTrend) / 10 };
        }
        
        return { type: 'none', strength: 0 };
    }

    classifyRSILevel(rsiValue) {
        if (rsiValue <= 20) return 'extremely_oversold';
        if (rsiValue <= 30) return 'oversold';
        if (rsiValue <= 40) return 'weak';
        if (rsiValue <= 60) return 'neutral';
        if (rsiValue <= 70) return 'strong';
        if (rsiValue <= 80) return 'overbought';
        return 'extremely_overbought';
    }

    calculateRSISignalStrength(currentRSI, momentum, trend) {
        let strength = 0;
        
        // Extreme levels provide stronger signals
        if (currentRSI <= 20 || currentRSI >= 80) strength += 0.4;
        else if (currentRSI <= 30 || currentRSI >= 70) strength += 0.2;
        
        // Momentum strength
        strength += Math.min(Math.abs(momentum) / 10, 0.3);
        
        // Trend strength
        const trendStrength = {
            'strong_rising': 0.3, 'rising': 0.2, 'neutral': 0,
            'falling': 0.2, 'strong_falling': 0.3
        };
        strength += trendStrength[trend] || 0;
        
        return Math.min(strength, 1.0);
    }

    calculateRSIConfidence(currentRSI, momentum, divergence) {
        let confidence = 0.5; // Base confidence
        
        // RSI level confidence
        if (currentRSI <= 30 || currentRSI >= 70) confidence += 0.2;
        
        // Momentum confidence
        confidence += Math.min(Math.abs(momentum) / 20, 0.2);
        
        // Divergence confidence
        if (divergence.type !== 'none') {
            confidence += divergence.strength * 0.3;
        }
        
        return Math.min(confidence, 1.0);
    }

    generateRecommendations(signalCandidateVerification, failureRateAnalysis, adaptiveThresholdCalibration) {
        const recommendations = {};

        // Signal verification recommendations
        if (signalCandidateVerification.verificationRate < 0.6) {
            recommendations.verification = {
                action: 'increase_verification_strictness',
                reason: 'Low verification rate detected',
                urgency: 'medium'
            };
        }

        // Failure rate recommendations
        if (failureRateAnalysis.averageFailureRate > 0.4) {
            recommendations.failureReduction = {
                action: 'implement_additional_filters',
                reason: 'High failure rate detected',
                urgency: 'high'
            };
        }

        // Threshold calibration recommendations
        if (adaptiveThresholdCalibration.calibrationNeeded) {
            recommendations.calibration = {
                action: 'adjust_combo_thresholds',
                adjustments: adaptiveThresholdCalibration.recommendations,
                urgency: 'medium'
            };
        }

        return recommendations;
    }

    generateAlerts(comboPatternIdentification, failureRateAnalysis, confluenceStrengthAssessment) {
        const alerts = [];

        // Strong combo pattern alert
        if (comboPatternIdentification.overallStrength > 0.8) {
            alerts.push({
                level: 'info',
                message: 'Güçlü combo pattern tespit edildi',
                action: 'Sinyali değerlendir'
            });
        }

        // High failure rate alert
        if (failureRateAnalysis.averageFailureRate > 0.5) {
            alerts.push({
                level: 'warning',
                message: 'Yüksek başarısızlık oranı',
                action: 'Filtreleri güçlendir'
            });
        }

        // Low confluence alert
        if (confluenceStrengthAssessment.overallStrength < 0.4) {
            alerts.push({
                level: 'warning',
                message: 'Düşük sinyal uyumu',
                action: 'Ek doğrulama gerekli'
            });
        }

        return alerts;
    }

    generateNotes(comboPatternIdentification, failureRateAnalysis, confluenceStrengthAssessment) {
        const notes = [];

        notes.push(`Tespit edilen pattern sayısı: ${comboPatternIdentification.patternCount}`);
        notes.push(`Ortalama başarısızlık oranı: ${(failureRateAnalysis.averageFailureRate * 100).toFixed(1)}%`);
        notes.push(`Confluence gücü: ${(confluenceStrengthAssessment.overallStrength * 100).toFixed(1)}%`);

        if (comboPatternIdentification.dominantPattern) {
            notes.push(`Dominant pattern: ${comboPatternIdentification.dominantPattern}`);
        }

        return notes.join('. ');
    }

    updateVerificationHistory(result, data) {
        this.verificationHistory.push({
            timestamp: Date.now(),
            patternCount: result.metadata.comboPatternCount,
            verifiedSignalCount: result.metadata.verifiedSignalCount,
            failureRate: result.metadata.averageFailureRate,
            confluenceStrength: result.metadata.confluenceStrength,
            verificationAccuracy: result.metadata.verificationAccuracy
        });

        if (this.verificationHistory.length > this.maxHistorySize) {
            this.verificationHistory = this.verificationHistory.slice(-this.maxHistorySize);
        }
    }

    getDefaultResult() {
        return {
            rsiAnalysis: this.getDefaultRSIAnalysis(),
            emaAnalysis: this.getDefaultEMAAnalysis(),
            orderFlowAnalysis: this.getDefaultOrderFlowAnalysis(),
            volumeAnalysis: this.getDefaultVolumeAnalysis(),
            comboPatternIdentification: {
                patterns: [],
                patternStrengths: {},
                confluence: {},
                dominantPattern: null,
                patternCount: 0,
                overallStrength: 0,
                reliability: 0.5
            },
            signalCandidateVerification: {
                verifiedSignals: [],
                rejectedSignals: [],
                verificationRate: 0,
                verificationQuality: 'unknown',
                verificationReliability: 0.5
            },
            breakoutProbabilityAnalysis: {
                historicalSuccessRate: 0.5,
                patternProbabilities: {},
                supportResistanceImpact: {},
                marketAdjustment: 0,
                combinedProbability: 0.5,
                confidence: 0.5,
                riskAssessment: 'medium'
            },
            failureRateAnalysis: {
                patternFailureRates: {},
                comboFailureRates: {},
                timeBasedFailure: {},
                marketConditionFailure: {},
                failurePatterns: {},
                averageFailureRate: 0.3,
                worstCaseFailureRate: 0.5,
                failureTrend: 'stable',
                riskLevel: 'medium'
            },
            confluenceStrengthAssessment: {
                rsiStrength: 0.125,
                emaStrength: 0.15,
                orderFlowStrength: 0.175,
                volumeStrength: 0.05,
                signalAlignment: 0.5,
                confluenceScore: 0.5,
                confluenceQuality: 'medium',
                overallStrength: 0.5,
                reliability: 0.5,
                weakestLink: 'volume'
            },
            riskRewardValidation: {
                riskRewardRatio: 1.0,
                riskAssessment: 'medium',
                rewardPotential: 'medium',
                validationStatus: 'pending'
            },
            timingOptimizationAnalysis: {
                optimalTiming: 'unknown',
                timingConfidence: 0.5,
                sessionImpact: {}
            },
            adaptiveThresholdCalibration: {
                calibrationNeeded: false,
                recommendations: {},
                effectiveness: 0.5
            },
            marketConditionSensitivityAnalysis: {
                sensitivity: 0.5,
                optimalConditions: {},
                conditionImpact: {}
            },
            performanceTrackingAnalysis: {
                accuracy: 0.6,
                improvement: 0,
                learningRate: this.learningRate
            },
            currentStatus: {
                patternDetected: false,
                dominantPattern: null,
                patternStrength: 0,
                failureRisk: 'medium',
                confluenceStrength: 0.5,
                verificationQuality: 'medium',
                recommendedAction: 'monitor',
                confidenceLevel: 0.5
            },
            recommendations: {},
            alerts: [],
            notes: "Combo break doğrulama analizi yapılamadı - yetersiz veri",
            metadata: {
                error: true,
                analysisTimestamp: Date.now()
            }
        };
    }

    getDefaultRSIAnalysis() {
        return {
            currentValue: 50,
            previousValue: 50,
            momentum: 0,
            trend: 'neutral',
            divergence: { type: 'none', strength: 0 },
            level: 'neutral',
            signalStrength: 0,
            adjustedValue: 50,
            bullishSignal: false,
            bearishSignal: false,
            neutralZone: true,
            confidence: 0.5
        };
    }

    getDefaultEMAAnalysis() {
        return {
            currentValue: 0,
            currentPrice: 0,
            distance: 0,
            position: 'neutral',
            trend: 'neutral',
            slope: 0,
            supportResistanceLevel: 'neutral',
            convergenceDivergence: 'neutral',
            signals: {},
            bullishSignal: false,
            bearishSignal: false,
            convergingSignal: false,
            confidence: 0.5
        };
    }

    getDefaultOrderFlowAnalysis() {
        return {
            buyPressure: 0.5,
            sellPressure: 0.5,
            imbalance: 0,
            imbalanceStrength: 0,
            momentum: 0,
            institutionalFlow: {},
            retailFlow: {},
            priceDivergence: 'none',
            velocity: 0,
            bullishSignal: false,
            bearishSignal: false,
            strongImbalance: false,
            confidence: 0.5
        };
    }

    getDefaultVolumeAnalysis() {
        return {
            currentVolume: 0,
            averageVolume: 0,
            ratio: 1.0,
            condition: 'normal',
            priceCorrelation: 0,
            momentum: 0,
            distribution: {},
            volatilityCorrelation: 0,
            surgingVolume: false,
            decliningVolume: false,
            normalVolume: true,
            confidence: 0.5
        };
    }

    getModuleInfo() {
        return {
            name: 'ComboBreakVerifier',
            version: '1.0.0',
            description: 'Kombine kırılım doğrulayıcısı - RSI + EMA + Orderflow uyumu varken sinyalin başarısız olma oranını analiz eder - Multi-indicator confirmation, breakout verification, failure rate analysis, signal validation',
            inputs: [
                'symbol', 'rsiData', 'emaData', 'orderFlowData', 'volumeData', 'priceData', 'signalCandidates',
                'historicalBreakouts', 'timeframe', 'marketConditions', 'volatilityData', 'liquidityMetrics',
                'supportResistanceLevels', 'trendData', 'sessionData', 'correlationData', 'newsImpact',
                'institutionalFlow', 'retailFlow'
            ],
            outputs: [
                'rsiAnalysis', 'emaAnalysis', 'orderFlowAnalysis', 'volumeAnalysis', 'comboPatternIdentification',
                'signalCandidateVerification', 'breakoutProbabilityAnalysis', 'failureRateAnalysis',
                'confluenceStrengthAssessment', 'riskRewardValidation', 'timingOptimizationAnalysis',
                'adaptiveThresholdCalibration', 'marketConditionSensitivityAnalysis', 'performanceTrackingAnalysis',
                'currentStatus', 'recommendations', 'alerts', 'notes', 'metadata'
            ]
        };
    }
}

module.exports = ComboBreakVerifier;
