const GrafikBeyniModuleBase = require('../grafikBeyniModuleBase');

/**
 * Descending Triangle Detector Module
 * Alçalan üçgen formasyonu dedektörü - Yatay destek ve alçalan zirveler ile oluşan ayı formasyonu
 * Horizontal support with falling highs pattern, breakdown analysis, formation completion detection
 */
class DescendingTriangleDetector extends GrafikBeyniModuleBase {
    constructor() {
        super('descendingTriangleDetector');
        this.formationHistory = [];
        this.detectedFormations = [];
        this.formationCriteria = {
            minTouchPoints: 3,          // Minimum 3 touch points for each line
            maxFormationPeriods: 50,    // Maximum 50 periods for formation
            minFormationPeriods: 10,    // Minimum 10 periods for formation
            supportTolerancePercent: 0.5,     // 0.5% tolerance for horizontal support
            fallingHighsMaxSlope: -0.001,     // Maximum slope for falling highs (-0.1%)
            volumeDeclineThreshold: 0.7,      // Volume should decline to 70% during formation
            breakdownVolumeMultiplier: 1.5,   // Breakdown volume should be 1.5x average
            rsiRange: { min: 35, max: 60 },   // RSI should be in neutral-bearish range
            minimumFormationHeight: 0.02      // Minimum 2% height for valid formation
        };
        this.breakdownCriteria = {
            priceBreakdownPercent: 0.3,       // 0.3% below support for breakdown
            volumeConfirmation: true,         // Volume confirmation required
            closeBelowSupport: true,          // Close below support required
            consecutivePeriods: 2             // 2 consecutive periods below support
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
                throw new Error('Insufficient data for descending triangle detection');
            }

            // Horizontal support detection
            const horizontalSupportAnalysis = this.detectHorizontalSupport(lows, priceData, timeframe);

            // Falling highs detection
            const fallingHighsAnalysis = this.detectFallingHighs(highs, priceData, timeframe);

            // Formation validation
            const formationValidation = this.validateFormation(horizontalSupportAnalysis,
                                                             fallingHighsAnalysis,
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

            // Breakdown probability analysis
            const breakdownProbabilityAnalysis = this.analyzeBreakdownProbability(formationValidation,
                                                                                 volumePatternAnalysis,
                                                                                 marketConditions);

            // Target price calculation
            const targetPriceCalculation = this.calculateTargetPrice(formationValidation,
                                                                    horizontalSupportAnalysis);

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
                horizontalSupportAnalysis: horizontalSupportAnalysis,
                fallingHighsAnalysis: fallingHighsAnalysis,
                formationValidation: formationValidation,
                volumePatternAnalysis: volumePatternAnalysis,
                rsiValidation: rsiValidation,
                volatilityAnalysis: volatilityAnalysis,
                formationCompletionAssessment: formationCompletionAssessment,
                breakdownProbabilityAnalysis: breakdownProbabilityAnalysis,
                targetPriceCalculation: targetPriceCalculation,
                riskAssessment: riskAssessment,
                formationStrengthScoring: formationStrengthScoring,
                marketContextAnalysis: marketContextAnalysis,
                currentStatus: this.getCurrentStatus(formationValidation, formationCompletionAssessment,
                                                   breakdownProbabilityAnalysis),
                recommendations: this.generateRecommendations(formationValidation, breakdownProbabilityAnalysis,
                                                            targetPriceCalculation, riskAssessment),
                alerts: this.generateAlerts(formationValidation, breakdownProbabilityAnalysis,
                                          formationCompletionAssessment),
                notes: this.generateNotes(formationValidation, horizontalSupportAnalysis,
                                        fallingHighsAnalysis, formationStrengthScoring),
                metadata: {
                    analysisTimestamp: Date.now(),
                    symbol: symbol,
                    timeframe: timeframe,
                    formationDetected: formationValidation.isValid,
                    formationStrength: formationStrengthScoring.overallStrength,
                    breakdownProbability: breakdownProbabilityAnalysis.probability,
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
            this.handleError('DescendingTriangleDetector analysis failed', error, data);
            return this.getDefaultResult();
        }
    }

    detectHorizontalSupport(lows, priceData, timeframe) {
        const supportCandidates = [];
        const tolerance = this.formationCriteria.supportTolerancePercent / 100;

        // Find potential support levels from recent lows
        const recentLows = lows.slice(-this.formationCriteria.maxFormationPeriods);
        
        // Group similar lows within tolerance
        const supportLevels = this.groupSimilarLevels(recentLows, tolerance);
        
        // Analyze each potential support level
        supportLevels.forEach(level => {
            const touchPoints = this.findTouchPoints(level.price, recentLows, tolerance);
            
            if (touchPoints.length >= this.formationCriteria.minTouchPoints) {
                const support = {
                    price: level.price,
                    touchPoints: touchPoints,
                    strength: this.calculateSupportStrength(touchPoints, recentLows),
                    timespan: this.calculateTimespan(touchPoints),
                    consistency: this.calculateConsistency(touchPoints, level.price),
                    isValid: touchPoints.length >= this.formationCriteria.minTouchPoints
                };
                
                supportCandidates.push(support);
            }
        });

        // Find the best support level
        const bestSupport = this.findBestSupport(supportCandidates);
        
        // Validate support persistence
        const supportPersistence = this.validateSupportPersistence(bestSupport, priceData);

        return {
            candidates: supportCandidates,
            bestSupport: bestSupport,
            persistence: supportPersistence,
            isHorizontal: bestSupport ? this.validateHorizontality(bestSupport) : false,
            supportStrength: bestSupport ? bestSupport.strength : 0,
            touchPointCount: bestSupport ? bestSupport.touchPoints.length : 0
        };
    }

    detectFallingHighs(highs, priceData, timeframe) {
        const highPoints = [];
        const maxSlope = this.formationCriteria.fallingHighsMaxSlope;

        // Find significant high points
        const recentHighs = highs.slice(-this.formationCriteria.maxFormationPeriods);
        
        // Filter for significant highs with adequate spacing
        const significantHighs = this.filterSignificantHighs(recentHighs);
        
        // Check if highs are falling
        if (significantHighs.length >= this.formationCriteria.minTouchPoints) {
            // Calculate trend line through the highs
            const trendLine = this.calculateTrendLine(significantHighs);
            
            // Validate falling trend
            const isFalling = trendLine.slope <= maxSlope;
            
            // Calculate R-squared for trend line fit
            const rSquared = this.calculateRSquared(significantHighs, trendLine);
            
            const fallingHighsData = {
                highPoints: significantHighs,
                trendLine: trendLine,
                isFalling: isFalling,
                slope: trendLine.slope,
                rSquared: rSquared,
                quality: this.assessTrendLineQuality(trendLine, rSquared),
                touchPoints: significantHighs.length,
                angleInDegrees: this.calculateAngleInDegrees(trendLine.slope)
            };

            return fallingHighsData;
        }

        return {
            highPoints: [],
            trendLine: null,
            isFalling: false,
            slope: 0,
            rSquared: 0,
            quality: 'poor',
            touchPoints: 0,
            angleInDegrees: 0
        };
    }

    validateFormation(horizontalSupportAnalysis, fallingHighsAnalysis, priceData, volumeData) {
        const validation = {
            isValid: false,
            supportValid: false,
            fallingHighsValid: false,
            convergenceValid: false,
            formationHeight: 0,
            formationWidth: 0,
            formationAge: 0,
            convergencePoint: null,
            qualityScore: 0
        };

        // Check horizontal support validity
        validation.supportValid = horizontalSupportAnalysis.isHorizontal && 
                                 horizontalSupportAnalysis.touchPointCount >= this.formationCriteria.minTouchPoints;

        // Check falling highs validity
        validation.fallingHighsValid = fallingHighsAnalysis.isFalling && 
                                     fallingHighsAnalysis.touchPoints >= this.formationCriteria.minTouchPoints;

        if (validation.supportValid && validation.fallingHighsValid) {
            // Calculate formation dimensions
            const support = horizontalSupportAnalysis.bestSupport;
            const trendLine = fallingHighsAnalysis.trendLine;
            
            // Formation height (from support to highest high)
            const highestHigh = Math.max(...fallingHighsAnalysis.highPoints.map(p => p.price));
            validation.formationHeight = (highestHigh - support.price) / support.price;
            
            // Formation width (time span)
            validation.formationWidth = this.calculateFormationWidth(support.touchPoints, fallingHighsAnalysis.highPoints);
            
            // Formation age
            validation.formationAge = this.calculateFormationAge(support.touchPoints, fallingHighsAnalysis.highPoints);
            
            // Check convergence
            validation.convergencePoint = this.calculateConvergencePoint(support, trendLine);
            validation.convergenceValid = validation.convergencePoint !== null;
            
            // Validate minimum formation height
            const minHeightValid = validation.formationHeight >= this.formationCriteria.minimumFormationHeight;
            
            // Overall validation
            validation.isValid = validation.convergenceValid && minHeightValid;
            
            // Quality score
            validation.qualityScore = this.calculateFormationQualityScore(
                horizontalSupportAnalysis,
                fallingHighsAnalysis,
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
        
        // Analyze volume distribution pattern
        const volumeDistribution = this.analyzeVolumeDistribution(formationVolume);
        
        return {
            formationVolume: formationVolume,
            preFormationAverage: preFormationAverage,
            currentAverage: currentAverage,
            volumeDeclineRatio: volumeDeclineRatio,
            isVolumeDeclined: isVolumeDeclined,
            volumeTrend: volumeTrend,
            volumeDistribution: volumeDistribution,
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
        
        // RSI divergence analysis
        const rsiDivergence = this.analyzeRSIDivergence(formationRSI, formationValidation);
        
        return {
            isValid: isRSIValid,
            currentRSI: currentRSI,
            rsiTrend: rsiTrend,
            rsiDivergence: rsiDivergence,
            rsiScore: this.calculateRSIScore(currentRSI, rsiTrend, rsiRange),
            optimalRange: isRSIValid,
            bearishDivergence: rsiDivergence.type === 'bearish'
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
        
        // Volatility compression analysis
        const volatilityCompression = this.analyzeVolatilityCompression(formationVolatility);
        
        return {
            formationVolatility: formationVolatility,
            volatilityTrend: volatilityTrend,
            isVolatilityDeclining: isVolatilityDeclining,
            volatilityCompression: volatilityCompression,
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
        if (formationValidation.supportValid) completionScore += 20;
        if (formationValidation.fallingHighsValid) completionScore += 20;

        // Volume pattern completion (30%)
        if (volumePatternAnalysis.isVolumeDeclined) completionScore += 15;
        if (volumePatternAnalysis.volumeQuality === 'good') completionScore += 15;

        // RSI validation completion (20%)
        if (rsiValidation.isValid) completionScore += 10;
        if (rsiValidation.bearishDivergence) completionScore += 10;

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
            readinessLevel: this.calculateReadinessLevel(completionPercentage),
            breakdownImminence: this.assessBreakdownImminence(formationValidation, volumePatternAnalysis)
        };
    }

    analyzeBreakdownProbability(formationValidation, volumePatternAnalysis, marketConditions) {
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

        // Market conditions factor (bearish favors breakdown)
        if (marketConditions) {
            factors.marketTrend = this.assessBearishMarketTrendFactor(marketConditions);
            probabilityScore += factors.marketTrend * 0.2;
        }

        // Formation maturity factor
        factors.maturity = this.calculateMaturityFactor(formationValidation);
        probabilityScore += factors.maturity * 0.1;

        // Historical success rate factor
        factors.historicalSuccess = this.getHistoricalBreakdownSuccessRate();
        probabilityScore += (factors.historicalSuccess - 0.5) * 0.2;

        // Selling pressure factor
        factors.sellingPressure = this.assessSellingPressure(volumePatternAnalysis);
        probabilityScore += factors.sellingPressure * 0.1;

        const finalProbability = Math.max(0.1, Math.min(0.9, probabilityScore));
        const confidence = this.calculateProbabilityConfidence(factors);

        return {
            probability: finalProbability,
            factors: factors,
            confidence: confidence,
            riskAdjustedProbability: this.calculateRiskAdjustedProbability(finalProbability, factors),
            breakdownImmediacy: this.calculateBreakdownImmediacy(factors)
        };
    }

    calculateTargetPrice(formationValidation, horizontalSupportAnalysis) {
        if (!formationValidation.isValid || !horizontalSupportAnalysis.bestSupport) {
            return { targetPrice: 0, projectedLoss: 0, distanceToTarget: 0 };
        }

        const support = horizontalSupportAnalysis.bestSupport.price;
        const formationHeight = formationValidation.formationHeight;
        
        // Target price = Support - Formation Height
        const targetPrice = support * (1 - formationHeight);
        
        // Current price for loss calculation
        const currentPrice = support * 1.02; // Assume close to support
        const projectedLoss = (currentPrice - targetPrice) / currentPrice;
        
        const distanceToTarget = (currentPrice - targetPrice) / currentPrice;

        return {
            targetPrice: targetPrice,
            projectedLoss: projectedLoss,
            distanceToTarget: distanceToTarget,
            formationHeight: formationHeight,
            supportLevel: support,
            minimumTarget: support * 0.99, // Conservative target
            maximumTarget: support * (1 - formationHeight * 1.5), // Aggressive target
            supportBreakLevel: support * 0.997 // 0.3% below support
        };
    }

    getCurrentStatus(formationValidation, formationCompletionAssessment, breakdownProbabilityAnalysis) {
        return {
            formationDetected: formationValidation.isValid,
            formationQuality: this.assessFormationQuality(formationValidation.qualityScore),
            completionStatus: formationCompletionAssessment.readiness,
            breakdownProbability: breakdownProbabilityAnalysis.probability,
            formationStage: this.determineFormationStage(formationValidation, formationCompletionAssessment),
            tradingRecommendation: this.determineBearishTradingRecommendation(formationValidation, 
                                                                            breakdownProbabilityAnalysis),
            alertLevel: this.calculateAlertLevel(formationValidation, breakdownProbabilityAnalysis),
            confidenceLevel: this.calculateOverallConfidence(formationValidation, 
                                                           formationCompletionAssessment,
                                                           breakdownProbabilityAnalysis),
            breakdownImminence: formationCompletionAssessment.breakdownImminence
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

    findTouchPoints(targetPrice, lows, tolerance) {
        return lows.filter(low => {
            const priceDiff = Math.abs(low.price - targetPrice) / targetPrice;
            return priceDiff <= tolerance;
        });
    }

    calculateSupportStrength(touchPoints, allLows) {
        const touchPointCount = touchPoints.length;
        const totalLows = allLows.length;
        const frequency = touchPointCount / totalLows;
        
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

    analyzeRSIDivergence(formationRSI, formationValidation) {
        if (formationRSI.length < 5) return { type: 'none', strength: 0 };
        
        // Look for bearish divergence: price makes lower highs, RSI makes higher lows
        const priceHighs = this.findLocalHighs(formationValidation);
        const rsiLows = this.findLocalLows(formationRSI);
        
        if (priceHighs.length >= 2 && rsiLows.length >= 2) {
            const priceIsDescending = priceHighs[priceHighs.length - 1] < priceHighs[priceHighs.length - 2];
            const rsiIsAscending = rsiLows[rsiLows.length - 1] > rsiLows[rsiLows.length - 2];
            
            if (priceIsDescending && rsiIsAscending) {
                return { type: 'bearish', strength: 0.8 };
            }
        }
        
        return { type: 'none', strength: 0 };
    }

    assessBreakdownImminence(formationValidation, volumePatternAnalysis) {
        if (!formationValidation.isValid) return 'low';
        
        let imminenceScore = 0;
        
        // Convergence proximity
        if (formationValidation.convergencePoint) {
            const proximityScore = this.calculateConvergenceProximity(formationValidation.convergencePoint);
            imminenceScore += proximityScore * 0.4;
        }
        
        // Volume pattern
        if (volumePatternAnalysis.isVolumeDeclined) imminenceScore += 0.3;
        
        // Formation completion
        const completionFactor = Math.min(1, formationValidation.formationAge / this.formationCriteria.maxFormationPeriods);
        imminenceScore += completionFactor * 0.3;
        
        if (imminenceScore > 0.7) return 'high';
        if (imminenceScore > 0.4) return 'medium';
        return 'low';
    }

    assessSellingPressure(volumePatternAnalysis) {
        let pressure = 0.5; // Base pressure
        
        if (volumePatternAnalysis.isVolumeDeclined) pressure += 0.2;
        if (volumePatternAnalysis.volumeTrend < 0) pressure += 0.1;
        if (volumePatternAnalysis.volumeDistribution) {
            // More volume on down moves indicates selling pressure
            pressure += volumePatternAnalysis.volumeDistribution.downVolumeRatio * 0.2;
        }
        
        return Math.min(1.0, pressure);
    }

    generateRecommendations(formationValidation, breakdownProbabilityAnalysis, targetPriceCalculation, riskAssessment) {
        const recommendations = {};

        if (formationValidation.isValid && breakdownProbabilityAnalysis.probability > 0.6) {
            recommendations.trading = {
                action: 'prepare_for_breakdown',
                entryLevel: targetPriceCalculation.supportBreakLevel,
                targetPrice: targetPriceCalculation.targetPrice,
                stopLoss: targetPriceCalculation.supportLevel * 1.03, // 3% above support
                probability: breakdownProbabilityAnalysis.probability,
                direction: 'short'
            };
        }

        if (formationValidation.qualityScore > 0.8) {
            recommendations.monitoring = {
                action: 'monitor_closely',
                reason: 'High quality descending triangle detected',
                watchLevels: [targetPriceCalculation.supportLevel]
            };
        }

        return recommendations;
    }

    generateAlerts(formationValidation, breakdownProbabilityAnalysis, formationCompletionAssessment) {
        const alerts = [];

        if (formationValidation.isValid && breakdownProbabilityAnalysis.probability > 0.7) {
            alerts.push({
                level: 'info',
                message: 'Alçalan üçgen formasyonu tespit edildi',
                action: 'Düşüş kırılımı için hazırlan'
            });
        }

        if (formationCompletionAssessment.isComplete) {
            alerts.push({
                level: 'warning',
                message: 'Formasyon tamamlanma aşamasında',
                action: 'Kırılım yakın takip et'
            });
        }

        if (formationCompletionAssessment.breakdownImminence === 'high') {
            alerts.push({
                level: 'urgent',
                message: 'Kırılım riski yüksek',
                action: 'Acil pozisyon gözden geçir'
            });
        }

        return alerts;
    }

    generateNotes(formationValidation, horizontalSupportAnalysis, fallingHighsAnalysis, formationStrengthScoring) {
        const notes = [];

        if (formationValidation.isValid) {
            notes.push(`Alçalan üçgen formasyonu: ${(formationValidation.qualityScore * 100).toFixed(1)}% kalite`);
            notes.push(`Destek seviyesi: ${horizontalSupportAnalysis.touchPointCount} dokunuş`);
            notes.push(`Alçalan zirveler: ${fallingHighsAnalysis.touchPoints} nokta`);
            notes.push(`Formasyon gücü: ${(formationStrengthScoring.overallStrength * 100).toFixed(1)}%`);
        } else {
            notes.push('Alçalan üçgen formasyonu tespit edilmedi');
        }

        return notes.join('. ');
    }

    updateFormationHistory(result, data) {
        this.formationHistory.push({
            timestamp: Date.now(),
            formationDetected: result.metadata.formationDetected,
            formationStrength: result.metadata.formationStrength,
            breakdownProbability: result.metadata.breakdownProbability,
            completionPercentage: result.metadata.completionPercentage
        });

        if (this.formationHistory.length > this.maxHistorySize) {
            this.formationHistory = this.formationHistory.slice(-this.maxHistorySize);
        }
    }

    getDefaultResult() {
        return {
            horizontalSupportAnalysis: {
                candidates: [],
                bestSupport: null,
                persistence: {},
                isHorizontal: false,
                supportStrength: 0,
                touchPointCount: 0
            },
            fallingHighsAnalysis: {
                highPoints: [],
                trendLine: null,
                isFalling: false,
                slope: 0,
                rSquared: 0,
                quality: 'poor',
                touchPoints: 0,
                angleInDegrees: 0
            },
            formationValidation: {
                isValid: false,
                supportValid: false,
                fallingHighsValid: false,
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
                readinessLevel: 0,
                breakdownImminence: 'low'
            },
            breakdownProbabilityAnalysis: {
                probability: 0,
                factors: {},
                confidence: 0,
                riskAdjustedProbability: 0,
                breakdownImmediacy: 0
            },
            targetPriceCalculation: {
                targetPrice: 0,
                projectedLoss: 0,
                distanceToTarget: 0,
                formationHeight: 0,
                supportLevel: 0,
                minimumTarget: 0,
                maximumTarget: 0,
                supportBreakLevel: 0
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
                breakdownProbability: 0,
                formationStage: 'none',
                tradingRecommendation: 'wait',
                alertLevel: 'low',
                confidenceLevel: 0,
                breakdownImminence: 'low'
            },
            recommendations: {},
            alerts: [],
            notes: "Alçalan üçgen analizi yapılamadı - yetersiz veri",
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
            volumeDistribution: { downVolumeRatio: 0.5 },
            volumeQuality: 'unknown',
            volumeScore: 0.5
        };
    }

    getDefaultVolatilityPattern() {
        return {
            formationVolatility: [],
            volatilityTrend: 0,
            isVolatilityDeclining: false,
            volatilityCompression: { isCompressed: false, compressionRatio: 1 },
            volatilityScore: 0.5
        };
    }

    getModuleInfo() {
        return {
            name: 'DescendingTriangleDetector',
            version: '1.0.0',
            description: 'Alçalan üçgen formasyonu dedektörü - Yatay destek ve alçalan zirveler ile oluşan ayı formasyonu - Horizontal support with falling highs pattern, breakdown analysis, formation completion detection',
            inputs: [
                'symbol', 'priceData', 'volumeData', 'rsiData', 'highs', 'lows', 'timeframe',
                'marketConditions', 'trendData', 'supportResistanceLevels', 'volatilityData',
                'orderFlowData', 'liquidityMetrics', 'institutionalFlow', 'newsImpact',
                'correlationData', 'sessionData', 'formationContext'
            ],
            outputs: [
                'horizontalSupportAnalysis', 'fallingHighsAnalysis', 'formationValidation',
                'volumePatternAnalysis', 'rsiValidation', 'volatilityAnalysis',
                'formationCompletionAssessment', 'breakdownProbabilityAnalysis', 'targetPriceCalculation',
                'riskAssessment', 'formationStrengthScoring', 'marketContextAnalysis',
                'currentStatus', 'recommendations', 'alerts', 'notes', 'metadata'
            ]
        };
    }
}

module.exports = DescendingTriangleDetector;
