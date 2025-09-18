const GrafikBeyniModuleBase = require('../grafikBeyniModuleBase');

/**
 * Breakout Validator Module
 * Kırılım validatörü - Breakout validation and confirmation system
 * Comprehensive breakout analysis with multiple confirmation criteria
 */
class BreakoutValidator extends GrafikBeyniModuleBase {
    constructor() {
        super('breakoutValidator');
        this.breakoutHistory = [];
        this.validationHistory = [];
        this.validationCriteria = {
            priceThreshold: 0.3,        // 0.3% price movement threshold
            volumeMultiplier: 1.5,      // Volume should be 1.5x average
            consecutivePeriods: 2,      // 2 consecutive periods above/below
            retestTolerance: 0.5,       // 0.5% tolerance for retest
            sustainedPeriods: 3,        // 3 periods for sustained breakout
            falseBreakoutThreshold: 0.2, // 0.2% for false breakout detection
            minimumStrength: 0.6,       // Minimum 60% strength for valid breakout
            confirmationTimeframe: 5    // 5 periods for confirmation
        };
        this.breakoutTypes = {
            RESISTANCE_BREAKOUT: 'resistance_breakout',
            SUPPORT_BREAKDOWN: 'support_breakdown',
            PATTERN_BREAKOUT: 'pattern_breakout',
            TRENDLINE_BREAK: 'trendline_break',
            RANGE_BREAKOUT: 'range_breakout',
            SQUEEZE_BREAKOUT: 'squeeze_breakout'
        };
        this.validationStages = {
            INITIAL: 'initial',           // First price movement
            VOLUME_CONFIRM: 'volume_confirm', // Volume confirmation
            SUSTAINED: 'sustained',       // Sustained movement
            RETEST: 'retest',            // Successful retest
            VALIDATED: 'validated',       // Fully validated
            FAILED: 'failed'             // Failed validation
        };
        this.maxHistorySize = 200;
        this.learningRate = 0.1;
        this.confidenceThreshold = 0.7;
    }

    async analyze(data) {
        try {
            const {
                symbol,
                priceData,
                volumeData,
                ohlcData,
                timeframe,
                supportResistanceLevels,
                trendLines,
                formationContext,
                patternData,
                technicalIndicators,
                volatilityData,
                orderFlowData,
                liquidityMetrics,
                marketConditions,
                institutionalFlow,
                sessionData,
                correlationData,
                newsImpact,
                priceAction
            } = data;

            // Veri doğrulama
            if (!priceData || !volumeData || !ohlcData || priceData.length < 10) {
                throw new Error('Insufficient data for breakout validation');
            }

            // Potential breakout detection
            const potentialBreakoutDetection = this.detectPotentialBreakouts(priceData, ohlcData,
                                                                            supportResistanceLevels,
                                                                            trendLines, formationContext);

            // Price movement validation
            const priceMovementValidation = this.validatePriceMovement(potentialBreakoutDetection.breakouts,
                                                                      priceData, ohlcData);

            // Volume confirmation analysis
            const volumeConfirmationAnalysis = this.analyzeVolumeConfirmation(potentialBreakoutDetection.breakouts,
                                                                             volumeData, priceData);

            // Momentum validation
            const momentumValidation = this.validateMomentum(potentialBreakoutDetection.breakouts,
                                                           technicalIndicators, priceData);

            // Sustainability assessment
            const sustainabilityAssessment = this.assessBreakoutSustainability(potentialBreakoutDetection.breakouts,
                                                                              priceData, ohlcData, volumeData);

            // False breakout detection
            const falseBreakoutDetection = this.detectFalseBreakouts(potentialBreakoutDetection.breakouts,
                                                                    priceData, volumeData);

            // Retest analysis
            const retestAnalysis = this.analyzeRetests(potentialBreakoutDetection.breakouts,
                                                      priceData, ohlcData, supportResistanceLevels);

            // Institutional confirmation
            const institutionalConfirmation = this.confirmInstitutionalActivity(potentialBreakoutDetection.breakouts,
                                                                               institutionalFlow, orderFlowData,
                                                                               liquidityMetrics);

            // Market context validation
            const marketContextValidation = this.validateMarketContext(potentialBreakoutDetection.breakouts,
                                                                      marketConditions, correlationData,
                                                                      newsImpact);

            // Breakout strength scoring
            const breakoutStrengthScoring = this.scoreBreakoutStrength(potentialBreakoutDetection.breakouts,
                                                                      priceMovementValidation,
                                                                      volumeConfirmationAnalysis,
                                                                      momentumValidation);

            // Final validation decision
            const finalValidationDecision = this.makeFinalValidationDecision(potentialBreakoutDetection.breakouts,
                                                                            priceMovementValidation,
                                                                            volumeConfirmationAnalysis,
                                                                            sustainabilityAssessment,
                                                                            breakoutStrengthScoring);

            // Target projection
            const targetProjection = this.projectBreakoutTargets(finalValidationDecision.validatedBreakouts,
                                                                supportResistanceLevels, formationContext);

            const result = {
                potentialBreakoutDetection: potentialBreakoutDetection,
                priceMovementValidation: priceMovementValidation,
                volumeConfirmationAnalysis: volumeConfirmationAnalysis,
                momentumValidation: momentumValidation,
                sustainabilityAssessment: sustainabilityAssessment,
                falseBreakoutDetection: falseBreakoutDetection,
                retestAnalysis: retestAnalysis,
                institutionalConfirmation: institutionalConfirmation,
                marketContextValidation: marketContextValidation,
                breakoutStrengthScoring: breakoutStrengthScoring,
                finalValidationDecision: finalValidationDecision,
                targetProjection: targetProjection,
                validatedBreakouts: finalValidationDecision.validatedBreakouts,
                breakoutCount: finalValidationDecision.validatedBreakouts.length,
                strongestBreakout: this.findStrongestBreakout(finalValidationDecision.validatedBreakouts,
                                                            breakoutStrengthScoring),
                breakoutSummary: this.createBreakoutSummary(finalValidationDecision.validatedBreakouts),
                tradingSignals: this.generateTradingSignals(finalValidationDecision.validatedBreakouts,
                                                          targetProjection),
                recommendations: this.generateRecommendations(finalValidationDecision.validatedBreakouts,
                                                            breakoutStrengthScoring, targetProjection),
                alerts: this.generateAlerts(finalValidationDecision.validatedBreakouts, breakoutStrengthScoring),
                notes: this.generateNotes(potentialBreakoutDetection, finalValidationDecision,
                                        breakoutStrengthScoring),
                metadata: {
                    analysisTimestamp: Date.now(),
                    symbol: symbol,
                    timeframe: timeframe,
                    breakoutsDetected: potentialBreakoutDetection.breakouts.length,
                    validatedBreakouts: finalValidationDecision.validatedBreakouts.length,
                    strongestBreakoutStrength: this.findStrongestBreakout(finalValidationDecision.validatedBreakouts,
                                                                         breakoutStrengthScoring)?.strength || 0,
                    breakoutTypes: this.getBreakoutTypes(finalValidationDecision.validatedBreakouts),
                    overallValidationScore: finalValidationDecision.overallValidationScore
                }
            };

            // History güncelleme
            this.updateBreakoutHistory(result, data);

            // Cache ve performance tracking
            this.updateCache(data, result);
            this.trackPerformance(Date.now(), result.breakoutCount > 0);

            return result;

        } catch (error) {
            this.handleError('BreakoutValidator analysis failed', error, data);
            return this.getDefaultResult();
        }
    }

    detectPotentialBreakouts(priceData, ohlcData, supportResistanceLevels, trendLines, formationContext) {
        const breakouts = [];
        const currentPrice = priceData[priceData.length - 1];
        const currentCandle = ohlcData[ohlcData.length - 1];
        
        // Check resistance breakouts
        if (supportResistanceLevels && supportResistanceLevels.resistanceLevels) {
            supportResistanceLevels.resistanceLevels.forEach(level => {
                const breakoutDistance = (currentPrice - level.price) / level.price;
                
                if (breakoutDistance > this.validationCriteria.priceThreshold / 100) {
                    breakouts.push({
                        type: this.breakoutTypes.RESISTANCE_BREAKOUT,
                        level: level.price,
                        currentPrice: currentPrice,
                        distance: breakoutDistance,
                        strength: level.strength || 0.5,
                        direction: 'up',
                        timestamp: Date.now(),
                        levelData: level
                    });
                }
            });
        }

        // Check support breakdowns
        if (supportResistanceLevels && supportResistanceLevels.supportLevels) {
            supportResistanceLevels.supportLevels.forEach(level => {
                const breakdownDistance = (level.price - currentPrice) / level.price;
                
                if (breakdownDistance > this.validationCriteria.priceThreshold / 100) {
                    breakouts.push({
                        type: this.breakoutTypes.SUPPORT_BREAKDOWN,
                        level: level.price,
                        currentPrice: currentPrice,
                        distance: breakdownDistance,
                        strength: level.strength || 0.5,
                        direction: 'down',
                        timestamp: Date.now(),
                        levelData: level
                    });
                }
            });
        }

        // Check trendline breaks
        if (trendLines && trendLines.length > 0) {
            trendLines.forEach(trendLine => {
                const trendLinePrice = this.calculateTrendLinePrice(trendLine, priceData.length - 1);
                const breakDistance = Math.abs(currentPrice - trendLinePrice) / trendLinePrice;
                
                if (breakDistance > this.validationCriteria.priceThreshold / 100) {
                    breakouts.push({
                        type: this.breakoutTypes.TRENDLINE_BREAK,
                        level: trendLinePrice,
                        currentPrice: currentPrice,
                        distance: breakDistance,
                        direction: currentPrice > trendLinePrice ? 'up' : 'down',
                        timestamp: Date.now(),
                        trendLineData: trendLine
                    });
                }
            });
        }

        // Check pattern breakouts
        if (formationContext && formationContext.patterns) {
            formationContext.patterns.forEach(pattern => {
                const patternBreakout = this.checkPatternBreakout(pattern, currentPrice, currentCandle);
                if (patternBreakout) {
                    breakouts.push({
                        type: this.breakoutTypes.PATTERN_BREAKOUT,
                        ...patternBreakout,
                        timestamp: Date.now(),
                        patternData: pattern
                    });
                }
            });
        }

        return {
            breakouts: breakouts,
            breakoutCount: breakouts.length,
            breakoutTypes: this.categorizeBreakoutTypes(breakouts),
            detectionSummary: this.createDetectionSummary(breakouts)
        };
    }

    validatePriceMovement(breakouts, priceData, ohlcData) {
        const validation = {};

        breakouts.forEach((breakout, index) => {
            const recentPrices = priceData.slice(-this.validationCriteria.confirmationTimeframe);
            const recentCandles = ohlcData.slice(-this.validationCriteria.confirmationTimeframe);
            
            // Check consecutive periods
            const consecutiveValidation = this.checkConsecutivePeriods(breakout, recentPrices, recentCandles);
            
            // Check price momentum
            const momentumValidation = this.checkPriceMomentum(breakout, recentPrices);
            
            // Check sustainability
            const sustainabilityCheck = this.checkInitialSustainability(breakout, recentPrices);
            
            validation[index] = {
                breakout: breakout,
                consecutiveValidation: consecutiveValidation,
                momentumValidation: momentumValidation,
                sustainabilityCheck: sustainabilityCheck,
                overallPriceValidation: this.calculateOverallPriceValidation(consecutiveValidation,
                                                                           momentumValidation,
                                                                           sustainabilityCheck),
                validationStage: this.determinePriceValidationStage(consecutiveValidation, momentumValidation)
            };
        });

        return validation;
    }

    analyzeVolumeConfirmation(breakouts, volumeData, priceData) {
        const confirmation = {};
        const recentVolume = volumeData.slice(-20); // Last 20 periods for baseline
        const avgVolume = this.calculateAverage(recentVolume);

        breakouts.forEach((breakout, index) => {
            const breakoutPeriodVolume = volumeData[volumeData.length - 1];
            const volumeRatio = breakoutPeriodVolume / avgVolume;
            
            // Volume spike analysis
            const volumeSpike = volumeRatio >= this.validationCriteria.volumeMultiplier;
            
            // Volume trend analysis
            const volumeTrend = this.analyzeVolumeBreakoutTrend(volumeData, breakout);
            
            // Volume distribution analysis
            const volumeDistribution = this.analyzeBreakoutVolumeDistribution(volumeData, priceData, breakout);
            
            confirmation[index] = {
                breakout: breakout,
                breakoutVolume: breakoutPeriodVolume,
                avgVolume: avgVolume,
                volumeRatio: volumeRatio,
                volumeSpike: volumeSpike,
                volumeTrend: volumeTrend,
                volumeDistribution: volumeDistribution,
                volumeConfirmationScore: this.calculateVolumeConfirmationScore(volumeSpike, volumeTrend,
                                                                              volumeDistribution),
                hasVolumeConfirmation: volumeSpike && volumeTrend.isPositive
            };
        });

        return confirmation;
    }

    validateMomentum(breakouts, technicalIndicators, priceData) {
        const momentumValidation = {};

        breakouts.forEach((breakout, index) => {
            const momentum = {
                rsi: null,
                macd: null,
                stochastic: null,
                williams: null
            };

            // RSI momentum
            if (technicalIndicators && technicalIndicators.rsi) {
                momentum.rsi = this.validateRSIMomentum(breakout, technicalIndicators.rsi);
            }

            // MACD momentum
            if (technicalIndicators && technicalIndicators.macd) {
                momentum.macd = this.validateMACDMomentum(breakout, technicalIndicators.macd);
            }

            // Price momentum
            const priceMomentum = this.calculatePriceMomentum(priceData, breakout);

            momentumValidation[index] = {
                breakout: breakout,
                individualMomentum: momentum,
                priceMomentum: priceMomentum,
                overallMomentumScore: this.calculateOverallMomentumScore(momentum, priceMomentum),
                momentumAlignment: this.assessMomentumAlignment(momentum, breakout.direction),
                hasMomentumConfirmation: this.hasMomentumConfirmation(momentum, breakout.direction)
            };
        });

        return momentumValidation;
    }

    assessBreakoutSustainability(breakouts, priceData, ohlcData, volumeData) {
        const sustainability = {};

        breakouts.forEach((breakout, index) => {
            const sustainedPeriods = this.countSustainedPeriods(breakout, priceData, ohlcData);
            const retracementAnalysis = this.analyzeRetracement(breakout, priceData);
            const volumeSustainability = this.analyzeVolumeSustainability(breakout, volumeData);
            
            sustainability[index] = {
                breakout: breakout,
                sustainedPeriods: sustainedPeriods,
                retracementAnalysis: retracementAnalysis,
                volumeSustainability: volumeSustainability,
                sustainabilityScore: this.calculateSustainabilityScore(sustainedPeriods, retracementAnalysis,
                                                                      volumeSustainability),
                isSustained: sustainedPeriods >= this.validationCriteria.sustainedPeriods,
                sustainabilityCategory: this.categorizeSustainability(sustainedPeriods, retracementAnalysis)
            };
        });

        return sustainability;
    }

    detectFalseBreakouts(breakouts, priceData, volumeData) {
        const falseBreakoutAnalysis = {};

        breakouts.forEach((breakout, index) => {
            // Check for immediate reversal
            const immediateReversal = this.checkImmediateReversal(breakout, priceData);
            
            // Check volume characteristics of false breakouts
            const volumeCharacteristics = this.analyzeFalseBreakoutVolumeCharacteristics(breakout, volumeData);
            
            // Check follow-through failure
            const followThroughFailure = this.checkFollowThroughFailure(breakout, priceData);
            
            falseBreakoutAnalysis[index] = {
                breakout: breakout,
                immediateReversal: immediateReversal,
                volumeCharacteristics: volumeCharacteristics,
                followThroughFailure: followThroughFailure,
                falseBreakoutProbability: this.calculateFalseBreakoutProbability(immediateReversal,
                                                                                volumeCharacteristics,
                                                                                followThroughFailure),
                isFalseBreakout: this.determineFalseBreakout(immediateReversal, volumeCharacteristics,
                                                           followThroughFailure)
            };
        });

        return falseBreakoutAnalysis;
    }

    makeFinalValidationDecision(breakouts, priceValidation, volumeConfirmation, sustainability, strengthScoring) {
        const validatedBreakouts = [];
        const rejectedBreakouts = [];
        const validationScores = [];

        breakouts.forEach((breakout, index) => {
            const priceScore = priceValidation[index]?.overallPriceValidation || 0;
            const volumeScore = volumeConfirmation[index]?.volumeConfirmationScore || 0;
            const sustainabilityScore = sustainability[index]?.sustainabilityScore || 0;
            const strengthScore = strengthScoring[index]?.strengthScore || 0;

            // Weighted validation score
            const validationScore = (priceScore * 0.3) + (volumeScore * 0.25) + 
                                  (sustainabilityScore * 0.25) + (strengthScore * 0.2);

            validationScores.push(validationScore);

            const validationDecision = {
                breakout: breakout,
                validationScore: validationScore,
                priceScore: priceScore,
                volumeScore: volumeScore,
                sustainabilityScore: sustainabilityScore,
                strengthScore: strengthScore,
                isValidated: validationScore >= this.validationCriteria.minimumStrength,
                validationLevel: this.categorizeValidationLevel(validationScore),
                confidence: this.calculateValidationConfidence(validationScore)
            };

            if (validationDecision.isValidated) {
                validatedBreakouts.push(validationDecision);
            } else {
                rejectedBreakouts.push({
                    ...validationDecision,
                    rejectionReasons: this.identifyRejectionReasons(priceScore, volumeScore,
                                                                   sustainabilityScore, strengthScore)
                });
            }
        });

        return {
            validatedBreakouts: validatedBreakouts,
            rejectedBreakouts: rejectedBreakouts,
            validationScores: validationScores,
            overallValidationScore: validationScores.length > 0 ? this.calculateAverage(validationScores) : 0,
            validationSummary: {
                totalBreakouts: breakouts.length,
                validatedCount: validatedBreakouts.length,
                rejectedCount: rejectedBreakouts.length,
                validationRate: validatedBreakouts.length / breakouts.length
            }
        };
    }

    projectBreakoutTargets(validatedBreakouts, supportResistanceLevels, formationContext) {
        const projections = [];

        validatedBreakouts.forEach(breakoutDecision => {
            const breakout = breakoutDecision.breakout;
            
            // Calculate target based on breakout type
            const targets = this.calculateBreakoutTargets(breakout, supportResistanceLevels, formationContext);
            
            // Calculate stop loss levels
            const stopLoss = this.calculateStopLossLevels(breakout, supportResistanceLevels);
            
            // Risk-reward analysis
            const riskReward = this.calculateRiskReward(targets, stopLoss, breakout.currentPrice);
            
            projections.push({
                breakout: breakout,
                targets: targets,
                stopLoss: stopLoss,
                riskReward: riskReward,
                projectionConfidence: breakoutDecision.confidence,
                timeframe: this.estimateTargetTimeframe(breakout, targets)
            });
        });

        return projections;
    }

    generateTradingSignals(validatedBreakouts, targetProjections) {
        const signals = [];

        validatedBreakouts.forEach((breakoutDecision, index) => {
            const breakout = breakoutDecision.breakout;
            const projection = targetProjections[index];

            const signal = {
                type: 'BREAKOUT',
                direction: breakout.direction.toUpperCase(),
                entry: breakout.currentPrice,
                targets: projection.targets,
                stopLoss: projection.stopLoss.recommended,
                strength: breakoutDecision.validationScore,
                confidence: breakoutDecision.confidence,
                riskReward: projection.riskReward.ratio,
                timeframe: projection.timeframe,
                breakoutType: breakout.type,
                timestamp: Date.now()
            };

            signals.push(signal);
        });

        return signals;
    }

    generateRecommendations(validatedBreakouts, strengthScoring, targetProjections) {
        const recommendations = {};

        if (validatedBreakouts.length > 0) {
            const strongest = this.findStrongestBreakout(validatedBreakouts, strengthScoring);
            
            recommendations.primary = {
                action: `follow_${strongest.breakout.direction}_breakout`,
                level: strongest.breakout.level,
                strength: strongest.validationScore,
                confidence: strongest.confidence,
                type: strongest.breakout.type
            };

            if (validatedBreakouts.length > 1) {
                recommendations.secondary = {
                    action: 'monitor_multiple_breakouts',
                    count: validatedBreakouts.length,
                    averageStrength: this.calculateAverage(validatedBreakouts.map(b => b.validationScore))
                };
            }
        }

        return recommendations;
    }

    generateAlerts(validatedBreakouts, strengthScoring) {
        const alerts = [];

        validatedBreakouts.forEach(breakoutDecision => {
            const breakout = breakoutDecision.breakout;
            
            alerts.push({
                level: breakoutDecision.validationScore > 0.8 ? 'urgent' : 'info',
                message: `${breakout.type} kırılımı onaylandı`,
                direction: breakout.direction,
                level: breakout.level,
                strength: breakoutDecision.validationScore,
                action: `${breakout.direction === 'up' ? 'Yukarı' : 'Aşağı'} kırılım takip et`
            });
        });

        if (validatedBreakouts.length > 1) {
            alerts.push({
                level: 'warning',
                message: `${validatedBreakouts.length} eşzamanlı kırılım`,
                action: 'Çoklu kırılım analizini gözden geçir'
            });
        }

        return alerts;
    }

    generateNotes(potentialDetection, finalDecision, strengthScoring) {
        const notes = [];

        if (potentialDetection.breakoutCount > 0) {
            notes.push(`${potentialDetection.breakoutCount} potansiyel kırılım tespit edildi`);
            
            if (finalDecision.validatedBreakouts.length > 0) {
                notes.push(`${finalDecision.validatedBreakouts.length} kırılım onaylandı`);
                
                const avgStrength = this.calculateAverage(finalDecision.validatedBreakouts.map(b => b.validationScore));
                notes.push(`Ortalama güç: ${(avgStrength * 100).toFixed(1)}%`);
            } else {
                notes.push('Hiçbir kırılım onaylanamadı');
            }
        } else {
            notes.push('Kırılım tespit edilmedi');
        }

        return notes.join('. ');
    }

    // Helper methods
    calculateTrendLinePrice(trendLine, index) {
        return trendLine.slope * index + trendLine.intercept;
    }

    checkConsecutivePeriods(breakout, recentPrices, recentCandles) {
        let consecutiveCount = 0;
        const threshold = breakout.level;
        
        for (let i = recentPrices.length - 1; i >= 0; i--) {
            const price = recentPrices[i];
            const isValid = breakout.direction === 'up' ? 
                          price > threshold : price < threshold;
            
            if (isValid) {
                consecutiveCount++;
            } else {
                break;
            }
        }

        return {
            consecutiveCount: consecutiveCount,
            isValid: consecutiveCount >= this.validationCriteria.consecutivePeriods,
            validationStrength: Math.min(1.0, consecutiveCount / this.validationCriteria.consecutivePeriods)
        };
    }

    updateBreakoutHistory(result, data) {
        this.breakoutHistory.push({
            timestamp: Date.now(),
            breakoutsDetected: result.metadata.breakoutsDetected,
            validatedBreakouts: result.metadata.validatedBreakouts,
            strongestBreakoutStrength: result.metadata.strongestBreakoutStrength,
            overallValidationScore: result.metadata.overallValidationScore
        });

        if (this.breakoutHistory.length > this.maxHistorySize) {
            this.breakoutHistory = this.breakoutHistory.slice(-this.maxHistorySize);
        }
    }

    getDefaultResult() {
        return {
            potentialBreakoutDetection: { breakouts: [], breakoutCount: 0 },
            priceMovementValidation: {},
            volumeConfirmationAnalysis: {},
            momentumValidation: {},
            sustainabilityAssessment: {},
            falseBreakoutDetection: {},
            retestAnalysis: {},
            institutionalConfirmation: {},
            marketContextValidation: {},
            breakoutStrengthScoring: {},
            finalValidationDecision: {
                validatedBreakouts: [],
                rejectedBreakouts: [],
                overallValidationScore: 0,
                validationSummary: { totalBreakouts: 0, validatedCount: 0, rejectedCount: 0, validationRate: 0 }
            },
            targetProjection: [],
            validatedBreakouts: [],
            breakoutCount: 0,
            strongestBreakout: null,
            breakoutSummary: {},
            tradingSignals: [],
            recommendations: {},
            alerts: [],
            notes: "Kırılım validasyon analizi yapılamadı - yetersiz veri",
            metadata: {
                error: true,
                analysisTimestamp: Date.now(),
                breakoutsDetected: 0,
                validatedBreakouts: 0,
                strongestBreakoutStrength: 0,
                breakoutTypes: [],
                overallValidationScore: 0
            }
        };
    }

    getModuleInfo() {
        return {
            name: 'BreakoutValidator',
            version: '1.0.0',
            description: 'Kırılım validatörü - Breakout validation and confirmation system - Comprehensive breakout analysis with multiple confirmation criteria',
            inputs: [
                'symbol', 'priceData', 'volumeData', 'ohlcData', 'timeframe', 'supportResistanceLevels',
                'trendLines', 'formationContext', 'patternData', 'technicalIndicators', 'volatilityData',
                'orderFlowData', 'liquidityMetrics', 'marketConditions', 'institutionalFlow',
                'sessionData', 'correlationData', 'newsImpact', 'priceAction'
            ],
            outputs: [
                'potentialBreakoutDetection', 'priceMovementValidation', 'volumeConfirmationAnalysis',
                'momentumValidation', 'sustainabilityAssessment', 'falseBreakoutDetection', 'retestAnalysis',
                'institutionalConfirmation', 'marketContextValidation', 'breakoutStrengthScoring',
                'finalValidationDecision', 'targetProjection', 'validatedBreakouts', 'breakoutCount',
                'strongestBreakout', 'breakoutSummary', 'tradingSignals', 'recommendations', 'alerts',
                'notes', 'metadata'
            ]
        };
    }
}

module.exports = BreakoutValidator;
