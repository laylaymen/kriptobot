const GrafikBeyniModuleBase = require('./grafikBeyniModuleBase');

/**
 * Ascending Triangle Detector Module
 * Yükselen üçgen formasyonu dedektörü - Yatay direnç ve yükselen dipler ile oluşan boğa formasyonu
 * Horizontal resistance with rising lows pattern, breakout analysis, formation completion detection
 */
class AscendingTriangleDetector extends GrafikBeyniModuleBase {
    constructor() {
        super('ascendingTriangleDetector');
        this.formationHistory = [];
        this.detectedFormations = [];
        this.formationCriteria = {
            minTouchPoints: 3,          // Minimum 3 touch points for each line
            maxFormationPeriods: 50,    // Maximum 50 periods for formation
            minFormationPeriods: 10,    // Minimum 10 periods for formation
            resistanceTolerancePercent: 0.5,  // 0.5% tolerance for horizontal resistance
            risingLowsMinSlope: 0.001,  // Minimum slope for rising lows (0.1%)
            volumeDeclineThreshold: 0.7, // Volume should decline to 70% during formation
            breakoutVolumeMultiplier: 1.5, // Breakout volume should be 1.5x average
            rsiRange: { min: 40, max: 65 }, // RSI should be in neutral-bullish range
            minimumFormationHeight: 0.02  // Minimum 2% height for valid formation
        };
        this.breakoutCriteria = {
            priceBreakoutPercent: 0.3,   // 0.3% above resistance for breakout
            volumeConfirmation: true,     // Volume confirmation required
            closeAboveResistance: true,   // Close above resistance required
            consecutivePeriods: 2         // 2 consecutive periods above resistance
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
                rsiData,
                highs,
                lows,
                timeframe,
                marketConditions,
                trendData,
                supportResistanceLevels,
                volatilityData,
                orderFlowData,
                liquidityMetrics,
                institutionalFlow,
                newsImpact,
                correlationData,
                sessionData,
                formationContext
            } = data;

            // Veri doğrulama
            if (!priceData || !highs || !lows || priceData.length < this.formationCriteria.minFormationPeriods) {
                throw new Error('Insufficient data for ascending triangle detection');
            }

            // Horizontal resistance detection
            const horizontalResistanceAnalysis = this.detectHorizontalResistance(highs, priceData, timeframe);

            // Rising lows detection
            const risingLowsAnalysis = this.detectRisingLows(lows, priceData, timeframe);

            // Formation validation
            const formationValidation = this.validateFormation(horizontalResistanceAnalysis,
                                                             risingLowsAnalysis,
                                                             priceData, volumeData);

            // Volume pattern analysis
            const volumePatternAnalysis = this.analyzeVolumePattern(volumeData, formationValidation);

            // RSI validation
            const rsiValidation = this.validateRSI(rsiData, formationValidation);

            // Volatility analysis
            const volatilityAnalysis = this.analyzeVolatilityPattern(volatilityData, formationValidation);

            // Formation completion assessment
            const formationCompletionAssessment = this.assessFormationCompletion(formationValidation,
                                                                                volumePatternAnalysis,
                                                                                rsiValidation);

            // Breakout probability analysis
            const breakoutProbabilityAnalysis = this.analyzeBreakoutProbability(formationValidation,
                                                                               volumePatternAnalysis,
                                                                               marketConditions);

            // Target price calculation
            const targetPriceCalculation = this.calculateTargetPrice(formationValidation,
                                                                    horizontalResistanceAnalysis);

            // Risk assessment
            const riskAssessment = this.assessFormationRisk(formationValidation,
                                                           volatilityAnalysis,
                                                           marketConditions);

            // Formation strength scoring
            const formationStrengthScoring = this.scoreFormationStrength(formationValidation,
                                                                        volumePatternAnalysis,
                                                                        rsiValidation,
                                                                        volatilityAnalysis);

            // Market context analysis
            const marketContextAnalysis = this.analyzeMarketContext(formationValidation,
                                                                   marketConditions,
                                                                   trendData,
                                                                   correlationData);

            const result = {
                horizontalResistanceAnalysis: horizontalResistanceAnalysis,
                risingLowsAnalysis: risingLowsAnalysis,
                formationValidation: formationValidation,
                volumePatternAnalysis: volumePatternAnalysis,
                rsiValidation: rsiValidation,
                volatilityAnalysis: volatilityAnalysis,
                formationCompletionAssessment: formationCompletionAssessment,
                breakoutProbabilityAnalysis: breakoutProbabilityAnalysis,
                targetPriceCalculation: targetPriceCalculation,
                riskAssessment: riskAssessment,
                formationStrengthScoring: formationStrengthScoring,
                marketContextAnalysis: marketContextAnalysis,
                currentStatus: this.getCurrentStatus(formationValidation, formationCompletionAssessment,
                                                   breakoutProbabilityAnalysis),
                recommendations: this.generateRecommendations(formationValidation, breakoutProbabilityAnalysis,
                                                            targetPriceCalculation, riskAssessment),
                alerts: this.generateAlerts(formationValidation, breakoutProbabilityAnalysis,
                                          formationCompletionAssessment),
                notes: this.generateNotes(formationValidation, horizontalResistanceAnalysis,
                                        risingLowsAnalysis, formationStrengthScoring),
                metadata: {
                    analysisTimestamp: Date.now(),
                    symbol: symbol,
                    timeframe: timeframe,
                    formationDetected: formationValidation.isValid,
                    formationStrength: formationStrengthScoring.overallStrength,
                    breakoutProbability: breakoutProbabilityAnalysis.probability,
                    targetPrice: targetPriceCalculation.targetPrice,
                    completionPercentage: formationCompletionAssessment.completionPercentage,
                    riskLevel: riskAssessment.riskLevel
                }
            };

            // History güncelleme
            this.updateFormationHistory(result, data);

            // Cache ve performance tracking
            this.updateCache(data, result);
            this.trackPerformance(Date.now(), result.currentStatus.formationQuality === 'high');

            return result;

        } catch (error) {
            this.handleError('AscendingTriangleDetector analysis failed', error, data);
            return this.getDefaultResult();
        }
    }

    detectHorizontalResistance(highs, priceData, timeframe) {
        const resistanceCandidates = [];
        const tolerance = this.formationCriteria.resistanceTolerancePercent / 100;

        // Find potential resistance levels from recent highs
        const recentHighs = highs.slice(-this.formationCriteria.maxFormationPeriods);
        
        // Group similar highs within tolerance
        const resistanceLevels = this.groupSimilarLevels(recentHighs, tolerance);
        
        // Analyze each potential resistance level
        resistanceLevels.forEach(level => {
            const touchPoints = this.findTouchPoints(level.price, recentHighs, tolerance);
            
            if (touchPoints.length >= this.formationCriteria.minTouchPoints) {
                const resistance = {
                    price: level.price,
                    touchPoints: touchPoints,
                    strength: this.calculateResistanceStrength(touchPoints, recentHighs),
                    timespan: this.calculateTimespan(touchPoints),
                    consistency: this.calculateConsistency(touchPoints, level.price),
                    isValid: touchPoints.length >= this.formationCriteria.minTouchPoints
                };
                
                resistanceCandidates.push(resistance);
            }
        });

        // Find the best resistance level
        const bestResistance = this.findBestResistance(resistanceCandidates);
        
        // Validate resistance persistence
        const resistancePersistence = this.validateResistancePersistence(bestResistance, priceData);

        return {
            candidates: resistanceCandidates,
            bestResistance: bestResistance,
            persistence: resistancePersistence,
            isHorizontal: bestResistance ? this.validateHorizontality(bestResistance) : false,
            resistanceStrength: bestResistance ? bestResistance.strength : 0,
            touchPointCount: bestResistance ? bestResistance.touchPoints.length : 0
        };
    }

    detectRisingLows(lows, priceData, timeframe) {
        const lowPoints = [];
        const minSlope = this.formationCriteria.risingLowsMinSlope;

        // Find significant low points
        const recentLows = lows.slice(-this.formationCriteria.maxFormationPeriods);
        
        // Filter for significant lows with adequate spacing
        const significantLows = this.filterSignificantLows(recentLows);
        
        // Check if lows are rising
        if (significantLows.length >= this.formationCriteria.minTouchPoints) {
            // Calculate trend line through the lows
            const trendLine = this.calculateTrendLine(significantLows);
            
            // Validate rising trend
            const isRising = trendLine.slope >= minSlope;
            
            // Calculate R-squared for trend line fit
            const rSquared = this.calculateRSquared(significantLows, trendLine);
            
            const risingLowsData = {
                lowPoints: significantLows,
                trendLine: trendLine,
                isRising: isRising,
                slope: trendLine.slope,
                rSquared: rSquared,
                quality: this.assessTrendLineQuality(trendLine, rSquared),
                touchPoints: significantLows.length,
                angleInDegrees: this.calculateAngleInDegrees(trendLine.slope)
            };

            return risingLowsData;
        }

        return {
            lowPoints: [],
            trendLine: null,
            isRising: false,
            slope: 0,
            rSquared: 0,
            quality: 'poor',
            touchPoints: 0,
            angleInDegrees: 0
        };
    }

    validateFormation(horizontalResistanceAnalysis, risingLowsAnalysis, priceData, volumeData) {
        const validation = {
            isValid: false,
            resistanceValid: false,
            risingLowsValid: false,
            convergenceValid: false,
            formationHeight: 0,
            formationWidth: 0,
            formationAge: 0,
            convergencePoint: null,
            qualityScore: 0
        };

        // Check horizontal resistance validity
        validation.resistanceValid = horizontalResistanceAnalysis.isHorizontal && 
                                   horizontalResistanceAnalysis.touchPointCount >= this.formationCriteria.minTouchPoints;

        // Check rising lows validity
        validation.risingLowsValid = risingLowsAnalysis.isRising && 
                                   risingLowsAnalysis.touchPoints >= this.formationCriteria.minTouchPoints;

        if (validation.resistanceValid && validation.risingLowsValid) {
            // Calculate formation dimensions
            const resistance = horizontalResistanceAnalysis.bestResistance;
            const trendLine = risingLowsAnalysis.trendLine;
            
            // Formation height (from lowest low to resistance)
            const lowestLow = Math.min(...risingLowsAnalysis.lowPoints.map(p => p.price));
            validation.formationHeight = (resistance.price - lowestLow) / lowestLow;
            
            // Formation width (time span)
            validation.formationWidth = this.calculateFormationWidth(resistance.touchPoints, risingLowsAnalysis.lowPoints);
            
            // Formation age
            validation.formationAge = this.calculateFormationAge(resistance.touchPoints, risingLowsAnalysis.lowPoints);
            
            // Check convergence
            validation.convergencePoint = this.calculateConvergencePoint(resistance, trendLine);
            validation.convergenceValid = validation.convergencePoint !== null;
            
            // Validate minimum formation height
            const minHeightValid = validation.formationHeight >= this.formationCriteria.minimumFormationHeight;
            
            // Overall validation
            validation.isValid = validation.convergenceValid && minHeightValid;
            
            // Quality score
            validation.qualityScore = this.calculateFormationQualityScore(
                horizontalResistanceAnalysis,
                risingLowsAnalysis,
                validation
            );
        }

        return validation;
    }

    analyzeVolumePattern(volumeData, formationValidation) {
        if (!volumeData || !formationValidation.isValid) {
            return this.getDefaultVolumePattern();
        }

        const formationPeriod = formationValidation.formationAge;
        const formationVolume = volumeData.slice(-formationPeriod);
        
        // Calculate average volume before formation
        const preFormationVolume = volumeData.slice(-(formationPeriod * 2), -formationPeriod);
        const preFormationAverage = this.calculateAverage(preFormationVolume);
        
        // Calculate volume trend during formation
        const volumeTrend = this.calculateVolumeTrend(formationVolume);
        
        // Check for volume decline pattern
        const currentAverage = this.calculateAverage(formationVolume);
        const volumeDeclineRatio = currentAverage / preFormationAverage;
        
        const isVolumeDeclined = volumeDeclineRatio <= this.formationCriteria.volumeDeclineThreshold;
        
        return {
            formationVolume: formationVolume,
            preFormationAverage: preFormationAverage,
            currentAverage: currentAverage,
            volumeDeclineRatio: volumeDeclineRatio,
            isVolumeDeclined: isVolumeDeclined,
            volumeTrend: volumeTrend,
            volumeQuality: this.assessVolumeQuality(volumeTrend, isVolumeDeclined),
            volumeScore: this.calculateVolumeScore(isVolumeDeclined, volumeTrend)
        };
    }

    validateRSI(rsiData, formationValidation) {
        if (!rsiData || !formationValidation.isValid) {
            return { isValid: false, currentRSI: 0, rsiScore: 0 };
        }

        const currentRSI = rsiData[rsiData.length - 1];
        const rsiRange = this.formationCriteria.rsiRange;
        
        const isRSIValid = currentRSI >= rsiRange.min && currentRSI <= rsiRange.max;
        
        // Calculate RSI trend during formation
        const formationRSI = rsiData.slice(-formationValidation.formationAge);
        const rsiTrend = this.calculateRSITrend(formationRSI);
        
        return {
            isValid: isRSIValid,
            currentRSI: currentRSI,
            rsiTrend: rsiTrend,
            rsiScore: this.calculateRSIScore(currentRSI, rsiTrend, rsiRange),
            optimalRange: isRSIValid
        };
    }

    analyzeVolatilityPattern(volatilityData, formationValidation) {
        if (!volatilityData || !formationValidation.isValid) {
            return this.getDefaultVolatilityPattern();
        }

        const formationPeriod = formationValidation.formationAge;
        const formationVolatility = volatilityData.slice(-formationPeriod);
        
        // Expected volatility decline during formation
        const volatilityTrend = this.calculateVolatilityTrend(formationVolatility);
        const isVolatilityDeclining = volatilityTrend < 0;
        
        return {
            formationVolatility: formationVolatility,
            volatilityTrend: volatilityTrend,
            isVolatilityDeclining: isVolatilityDeclining,
            volatilityScore: this.calculateVolatilityScore(volatilityTrend, isVolatilityDeclining)
        };
    }

    assessFormationCompletion(formationValidation, volumePatternAnalysis, rsiValidation) {
        if (!formationValidation.isValid) {
            return { completionPercentage: 0, isComplete: false, readiness: 'none' };
        }

        let completionScore = 0;
        const maxScore = 100;

        // Formation structure completion (40%)
        if (formationValidation.resistanceValid) completionScore += 20;
        if (formationValidation.risingLowsValid) completionScore += 20;

        // Volume pattern completion (30%)
        if (volumePatternAnalysis.isVolumeDeclined) completionScore += 15;
        if (volumePatternAnalysis.volumeQuality === 'good') completionScore += 15;

        // RSI validation completion (20%)
        if (rsiValidation.isValid) completionScore += 20;

        // Convergence proximity (10%)
        if (formationValidation.convergenceValid) {
            const convergenceProximity = this.calculateConvergenceProximity(formationValidation.convergencePoint);
            completionScore += convergenceProximity * 10;
        }

        const completionPercentage = completionScore / maxScore;
        const isComplete = completionPercentage >= 0.8;
        const readiness = this.assessFormationReadiness(completionPercentage);

        return {
            completionPercentage: completionPercentage,
            isComplete: isComplete,
            readiness: readiness,
            completionScore: completionScore,
            maxScore: maxScore,
            readinessLevel: this.calculateReadinessLevel(completionPercentage)
        };
    }

    analyzeBreakoutProbability(formationValidation, volumePatternAnalysis, marketConditions) {
        if (!formationValidation.isValid) {
            return { probability: 0, factors: {}, confidence: 0 };
        }

        const factors = {};
        let probabilityScore = 0.5; // Base probability

        // Formation quality factor
        factors.formationQuality = formationValidation.qualityScore;
        probabilityScore += (formationValidation.qualityScore - 0.5) * 0.3;

        // Volume pattern factor
        factors.volumePattern = volumePatternAnalysis.volumeScore;
        probabilityScore += (volumePatternAnalysis.volumeScore - 0.5) * 0.2;

        // Market conditions factor
        if (marketConditions) {
            factors.marketTrend = this.assessMarketTrendFactor(marketConditions);
            probabilityScore += factors.marketTrend * 0.2;
        }

        // Formation maturity factor
        factors.maturity = this.calculateMaturityFactor(formationValidation);
        probabilityScore += factors.maturity * 0.1;

        // Historical success rate factor
        factors.historicalSuccess = this.getHistoricalSuccessRate();
        probabilityScore += (factors.historicalSuccess - 0.5) * 0.2;

        const finalProbability = Math.max(0.1, Math.min(0.9, probabilityScore));
        const confidence = this.calculateProbabilityConfidence(factors);

        return {
            probability: finalProbability,
            factors: factors,
            confidence: confidence,
            riskAdjustedProbability: this.calculateRiskAdjustedProbability(finalProbability, factors)
        };
    }

    calculateTargetPrice(formationValidation, horizontalResistanceAnalysis) {
        if (!formationValidation.isValid || !horizontalResistanceAnalysis.bestResistance) {
            return { targetPrice: 0, projectedGain: 0, distanceToTarget: 0 };
        }

        const resistance = horizontalResistanceAnalysis.bestResistance.price;
        const formationHeight = formationValidation.formationHeight;
        
        // Target price = Resistance + Formation Height
        const targetPrice = resistance * (1 + formationHeight);
        
        // Current price for gain calculation
        const currentPrice = resistance * 0.98; // Assume close to resistance
        const projectedGain = (targetPrice - currentPrice) / currentPrice;
        
        const distanceToTarget = (targetPrice - currentPrice) / currentPrice;

        return {
            targetPrice: targetPrice,
            projectedGain: projectedGain,
            distanceToTarget: distanceToTarget,
            formationHeight: formationHeight,
            resistanceLevel: resistance,
            minimumTarget: resistance * 1.01, // Conservative target
            maximumTarget: resistance * (1 + formationHeight * 1.5) // Aggressive target
        };
    }

    getCurrentStatus(formationValidation, formationCompletionAssessment, breakoutProbabilityAnalysis) {
        return {
            formationDetected: formationValidation.isValid,
            formationQuality: this.assessFormationQuality(formationValidation.qualityScore),
            completionStatus: formationCompletionAssessment.readiness,
            breakoutProbability: breakoutProbabilityAnalysis.probability,
            formationStage: this.determineFormationStage(formationValidation, formationCompletionAssessment),
            tradingRecommendation: this.determineTradingRecommendation(formationValidation, 
                                                                     breakoutProbabilityAnalysis),
            alertLevel: this.calculateAlertLevel(formationValidation, breakoutProbabilityAnalysis),
            confidenceLevel: this.calculateOverallConfidence(formationValidation, 
                                                           formationCompletionAssessment,
                                                           breakoutProbabilityAnalysis)
        };
    }

    // Helper methods for calculations
    groupSimilarLevels(prices, tolerance) {
        const levels = [];
        const sorted = [...prices].sort((a, b) => a.price - b.price);
        
        let currentLevel = { price: sorted[0].price, count: 1, indices: [sorted[0].index] };
        
        for (let i = 1; i < sorted.length; i++) {
            const priceDiff = Math.abs(sorted[i].price - currentLevel.price) / currentLevel.price;
            
            if (priceDiff <= tolerance) {
                currentLevel.count++;
                currentLevel.indices.push(sorted[i].index);
                currentLevel.price = (currentLevel.price + sorted[i].price) / 2; // Average
            } else {
                if (currentLevel.count >= 2) levels.push({ ...currentLevel });
                currentLevel = { price: sorted[i].price, count: 1, indices: [sorted[i].index] };
            }
        }
        
        if (currentLevel.count >= 2) levels.push(currentLevel);
        
        return levels.sort((a, b) => b.count - a.count);
    }

    findTouchPoints(targetPrice, highs, tolerance) {
        return highs.filter(high => {
            const priceDiff = Math.abs(high.price - targetPrice) / targetPrice;
            return priceDiff <= tolerance;
        });
    }

    calculateResistanceStrength(touchPoints, allHighs) {
        const touchPointCount = touchPoints.length;
        const totalHighs = allHighs.length;
        const frequency = touchPointCount / totalHighs;
        
        // Strength based on touch count and frequency
        return Math.min(1.0, frequency * touchPointCount * 0.2);
    }

    calculateTrendLine(points) {
        if (points.length < 2) return { slope: 0, intercept: 0 };
        
        const n = points.length;
        const sumX = points.reduce((sum, p, i) => sum + i, 0);
        const sumY = points.reduce((sum, p) => sum + p.price, 0);
        const sumXY = points.reduce((sum, p, i) => sum + i * p.price, 0);
        const sumX2 = points.reduce((sum, p, i) => sum + i * i, 0);
        
        const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
        const intercept = (sumY - slope * sumX) / n;
        
        return { slope, intercept };
    }

    calculateRSquared(points, trendLine) {
        if (points.length < 2) return 0;
        
        const actualMean = points.reduce((sum, p) => sum + p.price, 0) / points.length;
        
        let totalSumSquares = 0;
        let residualSumSquares = 0;
        
        points.forEach((point, index) => {
            const predictedY = trendLine.slope * index + trendLine.intercept;
            totalSumSquares += Math.pow(point.price - actualMean, 2);
            residualSumSquares += Math.pow(point.price - predictedY, 2);
        });
        
        return 1 - (residualSumSquares / totalSumSquares);
    }

    generateRecommendations(formationValidation, breakoutProbabilityAnalysis, targetPriceCalculation, riskAssessment) {
        const recommendations = {};

        if (formationValidation.isValid && breakoutProbabilityAnalysis.probability > 0.6) {
            recommendations.trading = {
                action: 'prepare_for_breakout',
                entryLevel: targetPriceCalculation.resistanceLevel * 1.003, // 0.3% above resistance
                targetPrice: targetPriceCalculation.targetPrice,
                stopLoss: targetPriceCalculation.resistanceLevel * 0.97, // 3% below resistance
                probability: breakoutProbabilityAnalysis.probability
            };
        }

        if (formationValidation.qualityScore > 0.8) {
            recommendations.monitoring = {
                action: 'monitor_closely',
                reason: 'High quality formation detected',
                watchLevels: [targetPriceCalculation.resistanceLevel]
            };
        }

        return recommendations;
    }

    generateAlerts(formationValidation, breakoutProbabilityAnalysis, formationCompletionAssessment) {
        const alerts = [];

        if (formationValidation.isValid && breakoutProbabilityAnalysis.probability > 0.7) {
            alerts.push({
                level: 'info',
                message: 'Yükselen üçgen formasyonu tespit edildi',
                action: 'Kırılım için hazırlan'
            });
        }

        if (formationCompletionAssessment.isComplete) {
            alerts.push({
                level: 'warning',
                message: 'Formasyon tamamlanma aşamasında',
                action: 'Yakın takip et'
            });
        }

        return alerts;
    }

    generateNotes(formationValidation, horizontalResistanceAnalysis, risingLowsAnalysis, formationStrengthScoring) {
        const notes = [];

        if (formationValidation.isValid) {
            notes.push(`Yükselen üçgen formasyonu: ${(formationValidation.qualityScore * 100).toFixed(1)}% kalite`);
            notes.push(`Direnç seviyesi: ${horizontalResistanceAnalysis.touchPointCount} dokunuş`);
            notes.push(`Yükselen dipler: ${risingLowsAnalysis.touchPoints} nokta`);
            notes.push(`Formasyon gücü: ${(formationStrengthScoring.overallStrength * 100).toFixed(1)}%`);
        } else {
            notes.push('Yükselen üçgen formasyonu tespit edilmedi');
        }

        return notes.join('. ');
    }

    updateFormationHistory(result, data) {
        this.formationHistory.push({
            timestamp: Date.now(),
            formationDetected: result.metadata.formationDetected,
            formationStrength: result.metadata.formationStrength,
            breakoutProbability: result.metadata.breakoutProbability,
            completionPercentage: result.metadata.completionPercentage
        });

        if (this.formationHistory.length > this.maxHistorySize) {
            this.formationHistory = this.formationHistory.slice(-this.maxHistorySize);
        }
    }

    getDefaultResult() {
        return {
            horizontalResistanceAnalysis: {
                candidates: [],
                bestResistance: null,
                persistence: {},
                isHorizontal: false,
                resistanceStrength: 0,
                touchPointCount: 0
            },
            risingLowsAnalysis: {
                lowPoints: [],
                trendLine: null,
                isRising: false,
                slope: 0,
                rSquared: 0,
                quality: 'poor',
                touchPoints: 0,
                angleInDegrees: 0
            },
            formationValidation: {
                isValid: false,
                resistanceValid: false,
                risingLowsValid: false,
                convergenceValid: false,
                formationHeight: 0,
                formationWidth: 0,
                formationAge: 0,
                convergencePoint: null,
                qualityScore: 0
            },
            volumePatternAnalysis: this.getDefaultVolumePattern(),
            rsiValidation: { isValid: false, currentRSI: 0, rsiScore: 0 },
            volatilityAnalysis: this.getDefaultVolatilityPattern(),
            formationCompletionAssessment: {
                completionPercentage: 0,
                isComplete: false,
                readiness: 'none',
                completionScore: 0,
                maxScore: 100,
                readinessLevel: 0
            },
            breakoutProbabilityAnalysis: {
                probability: 0,
                factors: {},
                confidence: 0,
                riskAdjustedProbability: 0
            },
            targetPriceCalculation: {
                targetPrice: 0,
                projectedGain: 0,
                distanceToTarget: 0,
                formationHeight: 0,
                resistanceLevel: 0,
                minimumTarget: 0,
                maximumTarget: 0
            },
            riskAssessment: {
                riskLevel: 'medium',
                riskFactors: {},
                riskScore: 0.5
            },
            formationStrengthScoring: {
                overallStrength: 0,
                componentScores: {},
                strengthCategory: 'weak'
            },
            marketContextAnalysis: {
                marketAlignment: 'neutral',
                contextScore: 0.5,
                supportingFactors: []
            },
            currentStatus: {
                formationDetected: false,
                formationQuality: 'none',
                completionStatus: 'none',
                breakoutProbability: 0,
                formationStage: 'none',
                tradingRecommendation: 'wait',
                alertLevel: 'low',
                confidenceLevel: 0
            },
            recommendations: {},
            alerts: [],
            notes: "Yükselen üçgen analizi yapılamadı - yetersiz veri",
            metadata: {
                error: true,
                analysisTimestamp: Date.now()
            }
        };
    }

    getDefaultVolumePattern() {
        return {
            formationVolume: [],
            preFormationAverage: 0,
            currentAverage: 0,
            volumeDeclineRatio: 1,
            isVolumeDeclined: false,
            volumeTrend: 0,
            volumeQuality: 'unknown',
            volumeScore: 0.5
        };
    }

    getDefaultVolatilityPattern() {
        return {
            formationVolatility: [],
            volatilityTrend: 0,
            isVolatilityDeclining: false,
            volatilityScore: 0.5
        };
    }

    getModuleInfo() {
        return {
            name: 'AscendingTriangleDetector',
            version: '1.0.0',
            description: 'Yükselen üçgen formasyonu dedektörü - Yatay direnç ve yükselen dipler ile oluşan boğa formasyonu - Horizontal resistance with rising lows pattern, breakout analysis, formation completion detection',
            inputs: [
                'symbol', 'priceData', 'volumeData', 'rsiData', 'highs', 'lows', 'timeframe',
                'marketConditions', 'trendData', 'supportResistanceLevels', 'volatilityData',
                'orderFlowData', 'liquidityMetrics', 'institutionalFlow', 'newsImpact',
                'correlationData', 'sessionData', 'formationContext'
            ],
            outputs: [
                'horizontalResistanceAnalysis', 'risingLowsAnalysis', 'formationValidation',
                'volumePatternAnalysis', 'rsiValidation', 'volatilityAnalysis',
                'formationCompletionAssessment', 'breakoutProbabilityAnalysis', 'targetPriceCalculation',
                'riskAssessment', 'formationStrengthScoring', 'marketContextAnalysis',
                'currentStatus', 'recommendations', 'alerts', 'notes', 'metadata'
            ]
        };
    }
}

module.exports = AscendingTriangleDetector;
