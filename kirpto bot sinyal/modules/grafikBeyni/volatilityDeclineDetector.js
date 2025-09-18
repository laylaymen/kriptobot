const GrafikBeyniModuleBase = require('../grafikBeyniModuleBase');

/**
 * Volatility Decline Detector Module
 * Volatilite düşüşü dedektörü - Volatility compression and decline detection
 * Systematic monitoring of volatility patterns for breakout prediction
 */
class VolatilityDeclineDetector extends GrafikBeyniModuleBase {
    constructor() {
        super('volatilityDeclineDetector');
        this.volatilityHistory = [];
        this.compressionHistory = [];
        this.analysisParams = {
            lookbackPeriods: 50,        // Periods to analyze
            compressionThreshold: 0.3,   // 30% decline for compression
            declineThreshold: 0.2,       // 20% decline threshold
            trendPeriods: 14,           // Periods for trend calculation
            extremeCompressionThreshold: 0.15,  // 15% for extreme compression
            breakoutPredictionPeriods: 5,       // Periods to predict breakout
            historicalComparisonPeriods: 100,   // Periods for historical comparison
            percentileThreshold: 20      // 20th percentile for low volatility
        };
        this.volatilityMeasures = {
            ATR: 'atr',                 // Average True Range
            BOLLINGER_WIDTH: 'bb_width', // Bollinger Band Width
            RANGE_RATIO: 'range_ratio',  // High-Low Range Ratio
            STANDARD_DEV: 'std_dev',     // Standard Deviation
            REALIZED_VOL: 'realized_vol' // Realized Volatility
        };
        this.compressionLevels = {
            NORMAL: { min: 0.8, max: 1.2 },
            MODERATE: { min: 0.5, max: 0.8 },
            HIGH: { min: 0.3, max: 0.5 },
            EXTREME: { min: 0.0, max: 0.3 }
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
                ohlcData,
                volumeData,
                timeframe,
                atrData,
                bollingerBands,
                volatilityData,
                impliedVolatility,
                marketConditions,
                technicalIndicators,
                supportResistanceLevels,
                formationContext,
                trendData,
                sessionData,
                correlationData,
                newsImpact,
                liquidityMetrics
            } = data;

            // Veri doğrulama
            if (!priceData || !ohlcData || priceData.length < this.analysisParams.lookbackPeriods) {
                throw new Error('Insufficient data for volatility decline detection');
            }

            // Multiple volatility calculations
            const multipleVolatilityCalculations = this.calculateMultipleVolatilityMeasures(priceData, ohlcData,
                                                                                           atrData, bollingerBands,
                                                                                           volatilityData);

            // Volatility trend analysis
            const volatilityTrendAnalysis = this.analyzeVolatilityTrend(multipleVolatilityCalculations, timeframe);

            // Volatility compression detection
            const volatilityCompressionDetection = this.detectVolatilityCompression(multipleVolatilityCalculations,
                                                                                   volatilityTrendAnalysis);

            // Historical volatility comparison
            const historicalVolatilityComparison = this.compareWithHistoricalVolatility(multipleVolatilityCalculations,
                                                                                       priceData, ohlcData);

            // Volatility percentile analysis
            const volatilityPercentileAnalysis = this.analyzeVolatilityPercentiles(multipleVolatilityCalculations,
                                                                                  historicalVolatilityComparison);

            // Compression duration tracking
            const compressionDurationTracking = this.trackCompressionDuration(volatilityCompressionDetection,
                                                                             volatilityTrendAnalysis);

            // Breakout probability assessment
            const breakoutProbabilityAssessment = this.assessBreakoutProbability(volatilityCompressionDetection,
                                                                                compressionDurationTracking,
                                                                                marketConditions);

            // Volume-volatility relationship
            const volumeVolatilityRelationship = this.analyzeVolumeVolatilityRelationship(volumeData,
                                                                                         multipleVolatilityCalculations);

            // Intraday volatility patterns
            const intradayVolatilityPatterns = this.analyzeIntradayVolatilityPatterns(ohlcData,
                                                                                     sessionData,
                                                                                     timeframe);

            // Volatility squeeze detection
            const volatilitySqueezeDetection = this.detectVolatilitySqueeze(multipleVolatilityCalculations,
                                                                           bollingerBands,
                                                                           supportResistanceLevels);

            // Market regime analysis
            const marketRegimeAnalysis = this.analyzeMarketRegime(volatilityTrendAnalysis,
                                                                 marketConditions,
                                                                 correlationData);

            // Breakout direction prediction
            const breakoutDirectionPrediction = this.predictBreakoutDirection(volatilityCompressionDetection,
                                                                             trendData,
                                                                             formationContext,
                                                                             supportResistanceLevels);

            const result = {
                multipleVolatilityCalculations: multipleVolatilityCalculations,
                volatilityTrendAnalysis: volatilityTrendAnalysis,
                volatilityCompressionDetection: volatilityCompressionDetection,
                historicalVolatilityComparison: historicalVolatilityComparison,
                volatilityPercentileAnalysis: volatilityPercentileAnalysis,
                compressionDurationTracking: compressionDurationTracking,
                breakoutProbabilityAssessment: breakoutProbabilityAssessment,
                volumeVolatilityRelationship: volumeVolatilityRelationship,
                intradayVolatilityPatterns: intradayVolatilityPatterns,
                volatilitySqueezeDetection: volatilitySqueezeDetection,
                marketRegimeAnalysis: marketRegimeAnalysis,
                breakoutDirectionPrediction: breakoutDirectionPrediction,
                currentVolatilityState: this.assessCurrentVolatilityState(multipleVolatilityCalculations,
                                                                         volatilityCompressionDetection),
                compressionLevel: this.determineCompressionLevel(volatilityCompressionDetection),
                breakoutImminence: this.assessBreakoutImminence(breakoutProbabilityAssessment,
                                                               compressionDurationTracking),
                tradingImplications: this.deriveTradingImplications(volatilityCompressionDetection,
                                                                   breakoutProbabilityAssessment,
                                                                   breakoutDirectionPrediction),
                recommendations: this.generateRecommendations(volatilityCompressionDetection,
                                                            breakoutProbabilityAssessment,
                                                            breakoutDirectionPrediction),
                alerts: this.generateAlerts(volatilityCompressionDetection, breakoutProbabilityAssessment),
                notes: this.generateNotes(volatilityTrendAnalysis, volatilityCompressionDetection,
                                        breakoutProbabilityAssessment),
                metadata: {
                    analysisTimestamp: Date.now(),
                    symbol: symbol,
                    timeframe: timeframe,
                    currentVolatilityLevel: this.getCurrentVolatilityLevel(multipleVolatilityCalculations),
                    compressionLevel: this.determineCompressionLevel(volatilityCompressionDetection),
                    breakoutProbability: breakoutProbabilityAssessment.overallProbability,
                    breakoutDirection: breakoutDirectionPrediction.predictedDirection,
                    volatilityTrend: volatilityTrendAnalysis.overallTrend
                }
            };

            // History güncelleme
            this.updateVolatilityHistory(result, data);

            // Cache ve performance tracking
            this.updateCache(data, result);
            this.trackPerformance(Date.now(), result.compressionLevel !== 'NORMAL');

            return result;

        } catch (error) {
            this.handleError('VolatilityDeclineDetector analysis failed', error, data);
            return this.getDefaultResult();
        }
    }

    calculateMultipleVolatilityMeasures(priceData, ohlcData, atrData, bollingerBands, volatilityData) {
        const recentPrices = priceData.slice(-this.analysisParams.lookbackPeriods);
        const recentOHLC = ohlcData.slice(-this.analysisParams.lookbackPeriods);
        
        // ATR-based volatility
        const atrVolatility = this.calculateATRVolatility(recentOHLC, atrData);
        
        // Standard deviation volatility
        const stdDevVolatility = this.calculateStandardDeviationVolatility(recentPrices);
        
        // Range-based volatility
        const rangeVolatility = this.calculateRangeVolatility(recentOHLC);
        
        // Bollinger Band width volatility
        const bbWidthVolatility = this.calculateBollingerBandWidthVolatility(bollingerBands);
        
        // Realized volatility
        const realizedVolatility = this.calculateRealizedVolatility(recentPrices);
        
        // Parkinson volatility (high-low estimator)
        const parkinsonVolatility = this.calculateParkinsonVolatility(recentOHLC);
        
        // Garman-Klass volatility
        const garmanKlassVolatility = this.calculateGarmanKlassVolatility(recentOHLC);
        
        return {
            atrVolatility: atrVolatility,
            stdDevVolatility: stdDevVolatility,
            rangeVolatility: rangeVolatility,
            bbWidthVolatility: bbWidthVolatility,
            realizedVolatility: realizedVolatility,
            parkinsonVolatility: parkinsonVolatility,
            garmanKlassVolatility: garmanKlassVolatility,
            compositeVolatility: this.calculateCompositeVolatility([
                atrVolatility, stdDevVolatility, rangeVolatility, realizedVolatility
            ])
        };
    }

    analyzeVolatilityTrend(volatilityMeasures, timeframe) {
        const trendAnalysis = {};
        
        Object.keys(volatilityMeasures).forEach(measure => {
            if (Array.isArray(volatilityMeasures[measure])) {
                const data = volatilityMeasures[measure];
                const trend = this.calculateLinearTrend(data.slice(-this.analysisParams.trendPeriods));
                
                trendAnalysis[measure] = {
                    trend: trend,
                    direction: trend.slope < 0 ? 'declining' : 'increasing',
                    strength: Math.abs(trend.slope),
                    acceleration: this.calculateVolatilityAcceleration(data),
                    momentum: this.calculateVolatilityMomentum(data)
                };
            }
        });

        // Overall trend assessment
        const overallTrend = this.assessOverallVolatilityTrend(trendAnalysis);
        
        return {
            individualTrends: trendAnalysis,
            overallTrend: overallTrend,
            trendConsistency: this.calculateTrendConsistency(trendAnalysis),
            trendStrength: this.calculateOverallTrendStrength(trendAnalysis)
        };
    }

    detectVolatilityCompression(volatilityMeasures, trendAnalysis) {
        const compressionAnalysis = {};
        
        Object.keys(volatilityMeasures).forEach(measure => {
            if (Array.isArray(volatilityMeasures[measure])) {
                const data = volatilityMeasures[measure];
                const currentValue = data[data.length - 1];
                const baselineValue = this.calculateAverage(data);
                
                const compressionRatio = currentValue / baselineValue;
                const isCompressed = compressionRatio <= this.analysisParams.compressionThreshold;
                const compressionLevel = this.determineSpecificCompressionLevel(compressionRatio);
                
                compressionAnalysis[measure] = {
                    currentValue: currentValue,
                    baselineValue: baselineValue,
                    compressionRatio: compressionRatio,
                    isCompressed: isCompressed,
                    compressionLevel: compressionLevel,
                    compressionStrength: this.calculateCompressionStrength(compressionRatio)
                };
            }
        });

        // Overall compression assessment
        const overallCompression = this.assessOverallCompression(compressionAnalysis);
        
        // Compression convergence analysis
        const compressionConvergence = this.analyzeCompressionConvergence(compressionAnalysis);
        
        return {
            individualCompression: compressionAnalysis,
            overallCompression: overallCompression,
            compressionConvergence: compressionConvergence,
            compressionConsistency: this.calculateCompressionConsistency(compressionAnalysis),
            extremeCompression: this.detectExtremeCompression(compressionAnalysis)
        };
    }

    compareWithHistoricalVolatility(volatilityMeasures, priceData, ohlcData) {
        const historicalPeriods = this.analysisParams.historicalComparisonPeriods;
        const historicalPrices = priceData.slice(-historicalPeriods);
        const historicalOHLC = ohlcData.slice(-historicalPeriods);
        
        // Calculate historical volatility measures
        const historicalVolatility = this.calculateHistoricalVolatilityMeasures(historicalPrices, historicalOHLC);
        
        // Compare current vs historical
        const comparison = {};
        Object.keys(volatilityMeasures).forEach(measure => {
            if (Array.isArray(volatilityMeasures[measure]) && Array.isArray(historicalVolatility[measure])) {
                const currentValue = volatilityMeasures[measure][volatilityMeasures[measure].length - 1];
                const historicalValues = historicalVolatility[measure];
                
                comparison[measure] = {
                    currentValue: currentValue,
                    historicalMean: this.calculateAverage(historicalValues),
                    historicalMedian: this.calculateMedian(historicalValues),
                    historicalStd: this.calculateStandardDeviation(historicalValues),
                    percentileRank: this.calculatePercentileRank(currentValue, historicalValues),
                    zScore: this.calculateZScore(currentValue, historicalValues),
                    isHistoricallyLow: this.isHistoricallyLow(currentValue, historicalValues)
                };
            }
        });

        return {
            comparison: comparison,
            overallHistoricalPosition: this.assessOverallHistoricalPosition(comparison),
            historicalExtremes: this.identifyHistoricalExtremes(comparison)
        };
    }

    analyzeVolatilityPercentiles(volatilityMeasures, historicalComparison) {
        const percentileAnalysis = {};
        
        Object.keys(historicalComparison.comparison).forEach(measure => {
            const data = historicalComparison.comparison[measure];
            const percentile = data.percentileRank;
            
            percentileAnalysis[measure] = {
                percentile: percentile,
                isLowVolatility: percentile <= this.analysisParams.percentileThreshold,
                isExtremelyLow: percentile <= 10,
                isHigh: percentile >= 80,
                isExtremelyHigh: percentile >= 95,
                percentileCategory: this.categorizeVolatilityPercentile(percentile)
            };
        });

        return {
            individualPercentiles: percentileAnalysis,
            overallPercentileStatus: this.assessOverallPercentileStatus(percentileAnalysis),
            lowVolatilityCount: this.countLowVolatilityMeasures(percentileAnalysis)
        };
    }

    trackCompressionDuration(compressionDetection, trendAnalysis) {
        // Track how long volatility has been compressed
        const compressionDuration = this.calculateCompressionDuration(compressionDetection);
        
        // Analyze compression persistence
        const compressionPersistence = this.analyzeCompressionPersistence(compressionDetection, trendAnalysis);
        
        // Compression stability
        const compressionStability = this.assessCompressionStability(compressionDetection);
        
        return {
            duration: compressionDuration,
            persistence: compressionPersistence,
            stability: compressionStability,
            durationCategory: this.categorizeDuration(compressionDuration),
            compressionMaturity: this.assessCompressionMaturity(compressionDuration, compressionPersistence)
        };
    }

    assessBreakoutProbability(compressionDetection, durationTracking, marketConditions) {
        let probabilityFactors = {};
        let probabilityScore = 0;

        // Compression level factor (30%)
        const compressionFactor = this.calculateCompressionFactor(compressionDetection);
        probabilityFactors.compression = compressionFactor;
        probabilityScore += compressionFactor * 0.3;

        // Duration factor (25%)
        const durationFactor = this.calculateDurationFactor(durationTracking);
        probabilityFactors.duration = durationFactor;
        probabilityScore += durationFactor * 0.25;

        // Historical pattern factor (20%)
        const historicalFactor = this.calculateHistoricalBreakoutFactor();
        probabilityFactors.historical = historicalFactor;
        probabilityScore += historicalFactor * 0.2;

        // Market condition factor (15%)
        const marketFactor = this.calculateMarketConditionFactor(marketConditions);
        probabilityFactors.market = marketFactor;
        probabilityScore += marketFactor * 0.15;

        // Convergence factor (10%)
        const convergenceFactor = this.calculateConvergenceFactor(compressionDetection);
        probabilityFactors.convergence = convergenceFactor;
        probabilityScore += convergenceFactor * 0.1;

        const overallProbability = Math.min(0.95, Math.max(0.05, probabilityScore));

        return {
            probabilityFactors: probabilityFactors,
            overallProbability: overallProbability,
            probabilityCategory: this.categorizeBreakoutProbability(overallProbability),
            timeframe: this.estimateBreakoutTimeframe(durationTracking, overallProbability),
            confidence: this.calculateProbabilityConfidence(probabilityFactors)
        };
    }

    predictBreakoutDirection(compressionDetection, trendData, formationContext, supportResistanceLevels) {
        const directionFactors = {};
        let directionScore = 0; // Positive = up, Negative = down

        // Trend factor
        if (trendData) {
            const trendFactor = this.calculateTrendDirectionFactor(trendData);
            directionFactors.trend = trendFactor;
            directionScore += trendFactor;
        }

        // Formation context factor
        if (formationContext) {
            const formationFactor = this.calculateFormationDirectionFactor(formationContext);
            directionFactors.formation = formationFactor;
            directionScore += formationFactor;
        }

        // Support/Resistance factor
        if (supportResistanceLevels) {
            const srFactor = this.calculateSupportResistanceFactor(supportResistanceLevels);
            directionFactors.supportResistance = srFactor;
            directionScore += srFactor;
        }

        // Volume profile factor
        const volumeFactor = this.calculateVolumeDirectionFactor(compressionDetection);
        directionFactors.volume = volumeFactor;
        directionScore += volumeFactor;

        const predictedDirection = directionScore > 0.1 ? 'up' : 
                                 directionScore < -0.1 ? 'down' : 'neutral';

        return {
            directionFactors: directionFactors,
            directionScore: directionScore,
            predictedDirection: predictedDirection,
            directionConfidence: Math.abs(directionScore),
            directionStrength: this.categorizeDirectionStrength(Math.abs(directionScore))
        };
    }

    generateRecommendations(compressionDetection, breakoutProbability, directionPrediction) {
        const recommendations = {};

        if (compressionDetection.overallCompression.isCompressed && 
            breakoutProbability.overallProbability > 0.6) {
            
            recommendations.preparation = {
                action: 'prepare_for_breakout',
                probability: breakoutProbability.overallProbability,
                direction: directionPrediction.predictedDirection,
                timeframe: breakoutProbability.timeframe
            };
        }

        if (compressionDetection.extremeCompression.isExtreme) {
            recommendations.immediate = {
                action: 'monitor_closely',
                reason: 'Extreme volatility compression detected',
                urgency: 'high'
            };
        }

        if (breakoutProbability.overallProbability > 0.8) {
            recommendations.trading = {
                action: 'position_for_breakout',
                direction: directionPrediction.predictedDirection,
                confidence: directionPrediction.directionConfidence,
                stopLoss: 'Tight stops recommended due to compression'
            };
        }

        return recommendations;
    }

    generateAlerts(compressionDetection, breakoutProbability) {
        const alerts = [];

        if (compressionDetection.overallCompression.isCompressed) {
            alerts.push({
                level: 'info',
                message: 'Volatilite daralması tespit edildi',
                compressionLevel: compressionDetection.overallCompression.level
            });
        }

        if (compressionDetection.extremeCompression.isExtreme) {
            alerts.push({
                level: 'warning',
                message: 'Aşırı volatilite daralması',
                action: 'Kırılım için hazırlan'
            });
        }

        if (breakoutProbability.overallProbability > 0.7) {
            alerts.push({
                level: 'urgent',
                message: 'Yüksek kırılım olasılığı',
                probability: breakoutProbability.overallProbability
            });
        }

        return alerts;
    }

    generateNotes(trendAnalysis, compressionDetection, breakoutProbability) {
        const notes = [];

        if (compressionDetection.overallCompression.isCompressed) {
            notes.push(`Volatilite daralması seviyesi: ${compressionDetection.overallCompression.level}`);
        }

        notes.push(`Genel volatilite trendi: ${trendAnalysis.overallTrend}`);
        notes.push(`Kırılım olasılığı: ${(breakoutProbability.overallProbability * 100).toFixed(1)}%`);

        return notes.join('. ');
    }

    // Helper methods
    calculateLinearTrend(data) {
        if (data.length < 2) return { slope: 0, intercept: 0 };
        
        const n = data.length;
        const sumX = (n * (n - 1)) / 2;
        const sumY = data.reduce((a, b) => a + b, 0);
        const sumXY = data.reduce((sum, y, x) => sum + x * y, 0);
        const sumX2 = data.reduce((sum, _, x) => sum + x * x, 0);
        
        const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
        const intercept = (sumY - slope * sumX) / n;
        
        return { slope, intercept };
    }

    calculateATRVolatility(ohlcData, atrData) {
        if (atrData && atrData.length > 0) return atrData;
        
        // Calculate ATR manually if not provided
        const atr = [];
        for (let i = 1; i < ohlcData.length; i++) {
            const current = ohlcData[i];
            const previous = ohlcData[i - 1];
            
            const tr = Math.max(
                current.high - current.low,
                Math.abs(current.high - previous.close),
                Math.abs(current.low - previous.close)
            );
            
            atr.push(tr);
        }
        
        return this.calculateSMA(atr, 14);
    }

    calculateStandardDeviationVolatility(priceData) {
        const returns = [];
        for (let i = 1; i < priceData.length; i++) {
            returns.push((priceData[i] - priceData[i - 1]) / priceData[i - 1]);
        }
        
        const volatility = [];
        const period = 20;
        
        for (let i = period; i < returns.length; i++) {
            const periodReturns = returns.slice(i - period, i);
            const std = this.calculateStandardDeviation(periodReturns);
            volatility.push(std);
        }
        
        return volatility;
    }

    calculateSMA(data, period) {
        const result = [];
        for (let i = period - 1; i < data.length; i++) {
            const sum = data.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0);
            result.push(sum / period);
        }
        return result;
    }

    updateVolatilityHistory(result, data) {
        this.volatilityHistory.push({
            timestamp: Date.now(),
            currentVolatilityLevel: result.metadata.currentVolatilityLevel,
            compressionLevel: result.metadata.compressionLevel,
            breakoutProbability: result.metadata.breakoutProbability,
            breakoutDirection: result.metadata.breakoutDirection,
            volatilityTrend: result.metadata.volatilityTrend
        });

        if (this.volatilityHistory.length > this.maxHistorySize) {
            this.volatilityHistory = this.volatilityHistory.slice(-this.maxHistorySize);
        }
    }

    getDefaultResult() {
        return {
            multipleVolatilityCalculations: {},
            volatilityTrendAnalysis: { overallTrend: 'unknown', trendStrength: 0 },
            volatilityCompressionDetection: { 
                overallCompression: { isCompressed: false, level: 'NORMAL' },
                extremeCompression: { isExtreme: false }
            },
            historicalVolatilityComparison: { overallHistoricalPosition: 'unknown' },
            volatilityPercentileAnalysis: { overallPercentileStatus: 'unknown' },
            compressionDurationTracking: { duration: 0, durationCategory: 'short' },
            breakoutProbabilityAssessment: { 
                overallProbability: 0,
                probabilityCategory: 'low',
                timeframe: 'unknown'
            },
            volumeVolatilityRelationship: {},
            intradayVolatilityPatterns: {},
            volatilitySqueezeDetection: {},
            marketRegimeAnalysis: {},
            breakoutDirectionPrediction: { 
                predictedDirection: 'neutral',
                directionConfidence: 0
            },
            currentVolatilityState: 'unknown',
            compressionLevel: 'NORMAL',
            breakoutImminence: 'low',
            tradingImplications: {},
            recommendations: {},
            alerts: [],
            notes: "Volatilite düşüş analizi yapılamadı - yetersiz veri",
            metadata: {
                error: true,
                analysisTimestamp: Date.now(),
                currentVolatilityLevel: 'unknown',
                compressionLevel: 'NORMAL',
                breakoutProbability: 0,
                breakoutDirection: 'neutral',
                volatilityTrend: 'unknown'
            }
        };
    }

    getModuleInfo() {
        return {
            name: 'VolatilityDeclineDetector',
            version: '1.0.0',
            description: 'Volatilite düşüşü dedektörü - Volatility compression and decline detection - Systematic monitoring of volatility patterns for breakout prediction',
            inputs: [
                'symbol', 'priceData', 'ohlcData', 'volumeData', 'timeframe', 'atrData',
                'bollingerBands', 'volatilityData', 'impliedVolatility', 'marketConditions',
                'technicalIndicators', 'supportResistanceLevels', 'formationContext', 'trendData',
                'sessionData', 'correlationData', 'newsImpact', 'liquidityMetrics'
            ],
            outputs: [
                'multipleVolatilityCalculations', 'volatilityTrendAnalysis', 'volatilityCompressionDetection',
                'historicalVolatilityComparison', 'volatilityPercentileAnalysis', 'compressionDurationTracking',
                'breakoutProbabilityAssessment', 'volumeVolatilityRelationship', 'intradayVolatilityPatterns',
                'volatilitySqueezeDetection', 'marketRegimeAnalysis', 'breakoutDirectionPrediction',
                'currentVolatilityState', 'compressionLevel', 'breakoutImminence', 'tradingImplications',
                'recommendations', 'alerts', 'notes', 'metadata'
            ]
        };
    }
}

module.exports = VolatilityDeclineDetector;
