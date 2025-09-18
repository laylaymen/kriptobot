/**
 * Grafik Beyni - Cup and Handle Detector Module
 * 
 * Detects the cup and handle pattern - a bullish continuation pattern that consists of
 * a symmetrical, wide, U-shaped "cup" followed by a smaller downward "handle" on the right side.
 * This pattern indicates a potential upward breakout when the handle resistance is broken.
 */

const GrafikBeyniModuleBase = require('../grafikBeyniModuleBase');

class CupAndHandleDetector extends GrafikBeyniModuleBase {
    constructor() {
        super('cupAndHandleDetector');
        
        // Configuration for cup and handle pattern
        this.config = {
            cupValidation: {
                minDepthPercent: 0.12, // Cup should be at least 12% deep
                maxDepthPercent: 0.50, // Cup should not be more than 50% deep
                symmetryTolerance: 0.20, // 20% tolerance for cup symmetry
                minWidthCandles: 10 // Minimum candles for cup width
            },
            handleValidation: {
                maxDepthPercent: 0.15, // Handle should not be deeper than 15% of cup
                minSlopeNegative: -4, // Handle slope between -1 and -4
                maxSlopeNegative: -1,
                maxWidthCandles: 15, // Handle should be shorter than cup
                volumeDropRequired: true
            },
            volumeValidation: {
                cupVolumeDecrease: 0.7, // Volume should decrease during cup formation
                handleVolumeDecrease: 0.6, // Volume should be even lower in handle
                breakoutMultiplier: 1.5
            },
            rsiValidation: {
                minRange: 50,
                maxRange: 65,
                breakoutAbove: 60
            }
        };

        // Sub-modules simulation (would be separate files in production)
        this.cupShapeAnalyzer = this.createCupShapeAnalyzer();
        this.handleDetector = this.createHandleDetector();
        this.volumeTrendValidator = this.createVolumeTrendValidator();
        this.rsiZoneValidator = this.createRsiZoneValidator();
        this.breakoutValidator = this.createBreakoutValidator();
    }

    async analyze(data) {
        try {
            const startTime = Date.now();
            
            if (!this.validateInput(data)) {
                return this.createErrorOutput('Invalid input data for cup and handle detection');
            }

            // Analyze cup shape and structure
            const cupAnalysis = this.cupShapeAnalyzer.analyze(data.priceData, data.volume);
            if (!cupAnalysis.isValid) {
                return this.createNeutralOutput('Invalid cup formation: ' + cupAnalysis.reason);
            }

            // Detect handle formation
            const handleAnalysis = this.handleDetector.detect(
                data.priceData,
                data.volume,
                cupAnalysis.cupEnd
            );
            if (!handleAnalysis.isValid) {
                return this.createNeutralOutput('Invalid handle formation: ' + handleAnalysis.reason);
            }

            // Validate volume trend throughout pattern
            const volumeTrend = this.volumeTrendValidator.validate(
                data.volume,
                cupAnalysis,
                handleAnalysis
            );

            // Check RSI zone validation
            const rsiValidation = this.rsiZoneValidator.check(data.rsi, handleAnalysis);

            // Check breakout conditions
            const breakoutStatus = this.breakoutValidator.check(
                data,
                handleAnalysis,
                volumeTrend,
                rsiValidation
            );

            // Calculate confidence score
            const confidenceScore = this.calculateConfidenceScore(
                cupAnalysis,
                handleAnalysis,
                volumeTrend,
                rsiValidation,
                breakoutStatus
            );

            const result = {
                formationDetected: true,
                formationType: 'cup-and-handle',
                confidenceScore: confidenceScore,
                cupShape: cupAnalysis.shape,
                cupDepth: cupAnalysis.depth,
                cupWidth: cupAnalysis.width,
                cupSymmetry: cupAnalysis.symmetryScore,
                handleRange: [handleAnalysis.startPrice, handleAnalysis.endPrice],
                handleSlope: handleAnalysis.slope,
                handleDepth: handleAnalysis.depth,
                volumePattern: volumeTrend.pattern,
                volumeContracting: volumeTrend.isContracting,
                rsiZone: rsiValidation.zone,
                rsiInRange: rsiValidation.inRange,
                breakoutTrigger: breakoutStatus.triggered,
                breakoutDirection: 'up',
                breakoutConditions: {
                    priceAboveHandle: breakoutStatus.priceAboveHandle,
                    rsiAbove60: breakoutStatus.rsiAbove60,
                    volumeSpike: breakoutStatus.volumeSpike
                },
                modularFlags: {
                    passesShapeCriteria: cupAnalysis.isValid,
                    passesVolumeCriteria: volumeTrend.isValid,
                    passesRSI: rsiValidation.isValid,
                    passesHandle: handleAnalysis.isValid
                }
            };

            this.cacheResult(data, result);
            this.trackPerformance(startTime);

            return result;

        } catch (error) {
            this.logError('Cup and handle detection failed', error);
            return this.createErrorOutput(error.message);
        }
    }

    createCupShapeAnalyzer() {
        return {
            analyze: (priceData, volumeData) => {
                // Find significant lows for cup formation
                const lows = this.findSignificantLows(priceData);
                if (lows.length < 3) {
                    return { isValid: false, reason: 'Insufficient lows for cup formation' };
                }

                // Find the deepest low (cup bottom)
                let cupBottom = lows[0];
                for (let low of lows) {
                    if (low.price < cupBottom.price) {
                        cupBottom = low;
                    }
                }

                // Find cup boundaries (left and right rims)
                const leftRim = this.findLeftRim(priceData, cupBottom.index);
                const rightRim = this.findRightRim(priceData, cupBottom.index);

                if (!leftRim || !rightRim) {
                    return { isValid: false, reason: 'Cannot identify cup rims' };
                }

                // Validate cup characteristics
                const cupDepth = Math.max(
                    (leftRim.price - cupBottom.price) / leftRim.price,
                    (rightRim.price - cupBottom.price) / rightRim.price
                );

                const cupWidth = rightRim.index - leftRim.index;

                // Check depth constraints
                if (cupDepth < this.config.cupValidation.minDepthPercent ||
                    cupDepth > this.config.cupValidation.maxDepthPercent) {
                    return { 
                        isValid: false, 
                        reason: `Cup depth ${(cupDepth * 100).toFixed(1)}% outside valid range` 
                    };
                }

                // Check width constraints
                if (cupWidth < this.config.cupValidation.minWidthCandles) {
                    return { 
                        isValid: false, 
                        reason: `Cup width ${cupWidth} candles too narrow` 
                    };
                }

                // Check cup symmetry
                const leftSide = cupBottom.index - leftRim.index;
                const rightSide = rightRim.index - cupBottom.index;
                const symmetryRatio = Math.min(leftSide, rightSide) / Math.max(leftSide, rightSide);
                const symmetryScore = symmetryRatio;

                if (symmetryScore < (1 - this.config.cupValidation.symmetryTolerance)) {
                    return { 
                        isValid: false, 
                        reason: `Cup asymmetry too high: ${(symmetryScore * 100).toFixed(1)}%` 
                    };
                }

                // Validate U-shape
                const shapeScore = this.validateUShape(priceData, leftRim, cupBottom, rightRim);

                return {
                    isValid: shapeScore > 0.7,
                    shape: shapeScore > 0.85 ? 'symmetrical' : 'acceptable',
                    depth: cupDepth,
                    width: cupWidth,
                    symmetryScore: symmetryScore,
                    shapeScore: shapeScore,
                    leftRim: leftRim,
                    rightRim: rightRim,
                    cupBottom: cupBottom,
                    cupEnd: rightRim.index
                };
            }
        };
    }

    createHandleDetector() {
        return {
            detect: (priceData, volumeData, cupEndIndex) => {
                if (cupEndIndex >= priceData.length - 5) {
                    return { isValid: false, reason: 'Insufficient data after cup for handle formation' };
                }

                // Handle should start near cup end
                const handleStart = cupEndIndex;
                const handleData = priceData.slice(handleStart);

                if (handleData.length < 3) {
                    return { isValid: false, reason: 'Insufficient data for handle' };
                }

                // Find handle range
                const handleHigh = Math.max(...handleData.map(candle => candle.high));
                const handleLow = Math.min(...handleData.map(candle => candle.low));
                const cupRimPrice = priceData[cupEndIndex].high;

                // Calculate handle characteristics
                const handleDepth = (handleHigh - handleLow) / handleHigh;
                const handleSlope = this.calculateHandleSlope(handleData);
                const handleWidth = handleData.length;

                // Validate handle depth
                if (handleDepth > this.config.handleValidation.maxDepthPercent) {
                    return { 
                        isValid: false, 
                        reason: `Handle too deep: ${(handleDepth * 100).toFixed(1)}%` 
                    };
                }

                // Validate handle slope (should be negative but not too steep)
                if (handleSlope > this.config.handleValidation.maxSlopeNegative ||
                    handleSlope < this.config.handleValidation.minSlopeNegative) {
                    return { 
                        isValid: false, 
                        reason: `Handle slope ${handleSlope.toFixed(2)} outside valid range` 
                    };
                }

                // Validate handle width
                if (handleWidth > this.config.handleValidation.maxWidthCandles) {
                    return { 
                        isValid: false, 
                        reason: `Handle too wide: ${handleWidth} candles` 
                    };
                }

                return {
                    isValid: true,
                    startIndex: handleStart,
                    endIndex: handleStart + handleWidth - 1,
                    startPrice: handleHigh,
                    endPrice: handleData[handleData.length - 1].close,
                    slope: handleSlope,
                    depth: handleDepth,
                    width: handleWidth,
                    resistance: handleHigh
                };
            }
        };
    }

    createVolumeTrendValidator() {
        return {
            validate: (volumeData, cupAnalysis, handleAnalysis) => {
                if (!volumeData || volumeData.length === 0) {
                    return { isValid: false, pattern: 'no-data', isContracting: false };
                }

                // Analyze volume during cup formation
                const cupVolume = volumeData.slice(
                    cupAnalysis.leftRim.index,
                    cupAnalysis.rightRim.index + 1
                );

                // Analyze volume during handle formation
                const handleVolume = volumeData.slice(
                    handleAnalysis.startIndex,
                    handleAnalysis.endIndex + 1
                );

                // Calculate average volumes
                const cupAvgVolume = cupVolume.reduce((sum, vol) => sum + vol, 0) / cupVolume.length;
                const handleAvgVolume = handleVolume.reduce((sum, vol) => sum + vol, 0) / handleVolume.length;

                // Volume should decrease from cup to handle
                const volumeContracting = handleAvgVolume < cupAvgVolume * this.config.volumeValidation.handleVolumeDecrease;

                // Check overall volume trend
                let decreasingTrend = 0;
                const combinedVolume = [...cupVolume, ...handleVolume];
                
                for (let i = 1; i < combinedVolume.length; i++) {
                    if (combinedVolume[i] < combinedVolume[i-1]) decreasingTrend++;
                }

                const trendScore = decreasingTrend / (combinedVolume.length - 1);
                const pattern = trendScore > 0.6 ? 'contracting' : 'mixed';

                return {
                    isValid: volumeContracting,
                    pattern: pattern,
                    isContracting: volumeContracting,
                    cupAvgVolume: cupAvgVolume,
                    handleAvgVolume: handleAvgVolume,
                    contractionRatio: handleAvgVolume / cupAvgVolume,
                    trendScore: trendScore
                };
            }
        };
    }

    createRsiZoneValidator() {
        return {
            check: (rsiData, handleAnalysis) => {
                if (!rsiData || rsiData.length === 0) {
                    return { isValid: false, zone: 'unknown', inRange: false };
                }

                const currentRSI = rsiData[rsiData.length - 1];
                
                // RSI should be in the 50-65 range for optimal setup
                const inRange = currentRSI >= this.config.rsiValidation.minRange && 
                               currentRSI <= this.config.rsiValidation.maxRange;

                let zone = 'neutral';
                if (currentRSI < 30) zone = 'oversold';
                else if (currentRSI > 70) zone = 'overbought';
                else if (currentRSI >= 50 && currentRSI <= 65) zone = '50–65';
                else if (currentRSI > 50) zone = 'bullish';
                else zone = 'bearish';

                return {
                    isValid: inRange,
                    zone: zone,
                    inRange: inRange,
                    currentRSI: currentRSI
                };
            }
        };
    }

    createBreakoutValidator() {
        return {
            check: (data, handleAnalysis, volumeTrend, rsiValidation) => {
                const currentPrice = data.priceData[data.priceData.length - 1];
                const currentVolume = data.volume[data.volume.length - 1];

                // Check if price broke above handle resistance
                const priceAboveHandle = currentPrice.close > handleAnalysis.resistance;

                // Check RSI above 60 for breakout confirmation
                const currentRSI = data.rsi[data.rsi.length - 1];
                const rsiAbove60 = currentRSI > this.config.rsiValidation.breakoutAbove;

                // Check volume spike
                const avgRecentVolume = volumeTrend.handleAvgVolume;
                const volumeSpike = currentVolume > avgRecentVolume * this.config.volumeValidation.breakoutMultiplier;

                return {
                    triggered: priceAboveHandle && rsiAbove60 && volumeSpike,
                    priceAboveHandle: priceAboveHandle,
                    rsiAbove60: rsiAbove60,
                    volumeSpike: volumeSpike,
                    resistance: handleAnalysis.resistance,
                    currentPrice: currentPrice.close,
                    currentRSI: currentRSI
                };
            }
        };
    }

    findSignificantLows(priceData) {
        const lows = [];
        const lookback = 5;

        for (let i = lookback; i < priceData.length - lookback; i++) {
            const current = priceData[i];
            let isLow = true;

            for (let j = i - lookback; j <= i + lookback; j++) {
                if (j !== i && priceData[j].low <= current.low) {
                    isLow = false;
                    break;
                }
            }

            if (isLow) {
                lows.push({
                    index: i,
                    price: current.low
                });
            }
        }

        return lows;
    }

    findLeftRim(priceData, cupBottomIndex) {
        // Look for a significant high before the cup bottom
        let highestPrice = -Infinity;
        let rimIndex = -1;

        const searchStart = Math.max(0, cupBottomIndex - 30);
        for (let i = searchStart; i < cupBottomIndex - 5; i++) {
            if (priceData[i].high > highestPrice) {
                highestPrice = priceData[i].high;
                rimIndex = i;
            }
        }

        return rimIndex !== -1 ? { index: rimIndex, price: highestPrice } : null;
    }

    findRightRim(priceData, cupBottomIndex) {
        // Look for a significant high after the cup bottom
        let highestPrice = -Infinity;
        let rimIndex = -1;

        const searchEnd = Math.min(priceData.length, cupBottomIndex + 30);
        for (let i = cupBottomIndex + 5; i < searchEnd; i++) {
            if (priceData[i].high > highestPrice) {
                highestPrice = priceData[i].high;
                rimIndex = i;
            }
        }

        return rimIndex !== -1 ? { index: rimIndex, price: highestPrice } : null;
    }

    validateUShape(priceData, leftRim, cupBottom, rightRim) {
        // Check if the cup has a smooth U-shape
        const leftSide = priceData.slice(leftRim.index, cupBottom.index + 1);
        const rightSide = priceData.slice(cupBottom.index, rightRim.index + 1);

        // Calculate smoothness score based on price movement
        let leftScore = this.calculateSideScore(leftSide, false); // Should go down
        let rightScore = this.calculateSideScore(rightSide, true); // Should go up

        return (leftScore + rightScore) / 2;
    }

    calculateSideScore(sideData, shouldGoUp) {
        if (sideData.length < 3) return 0;

        let correctMovements = 0;
        for (let i = 1; i < sideData.length; i++) {
            const movement = sideData[i].close > sideData[i-1].close;
            if ((shouldGoUp && movement) || (!shouldGoUp && !movement)) {
                correctMovements++;
            }
        }

        return correctMovements / (sideData.length - 1);
    }

    calculateHandleSlope(handleData) {
        if (handleData.length < 2) return 0;

        const n = handleData.length;
        let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;

        for (let i = 0; i < n; i++) {
            const x = i;
            const y = handleData[i].close;
            sumX += x;
            sumY += y;
            sumXY += x * y;
            sumXX += x * x;
        }

        const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
        return slope;
    }

    calculateConfidenceScore(cupAnalysis, handleAnalysis, volumeTrend, rsiValidation, breakoutStatus) {
        let score = 0;

        // Cup shape quality (40%)
        if (cupAnalysis.isValid) {
            score += 0.40 * cupAnalysis.shapeScore;
        }

        // Handle quality (25%)
        if (handleAnalysis.isValid) {
            const handleQuality = Math.max(0, 1 - Math.abs(handleAnalysis.slope + 2.5) / 1.5);
            score += 0.25 * handleQuality;
        }

        // Volume pattern (20%)
        if (volumeTrend.isValid) {
            score += 0.20;
        }

        // RSI validation (10%)
        if (rsiValidation.isValid) {
            score += 0.10;
        }

        // Breakout confirmation (5%)
        if (breakoutStatus.triggered) {
            score += 0.05;
        }

        return Math.min(score, 0.95);
    }

    validateInput(data) {
        return data && 
               data.priceData && Array.isArray(data.priceData) && data.priceData.length >= 30 &&
               data.volume && Array.isArray(data.volume) &&
               data.rsi && Array.isArray(data.rsi);
    }

    createNeutralOutput(reason) {
        return {
            formationDetected: false,
            formationType: 'no-cup-handle',
            confidenceScore: 0,
            reason: reason,
            breakoutTrigger: false,
            modularFlags: {
                passesShapeCriteria: false,
                passesVolumeCriteria: false,
                passesRSI: false,
                passesHandle: false
            }
        };
    }

    createErrorOutput(message) {
        return {
            formationDetected: false,
            formationType: 'error',
            confidenceScore: 0,
            error: message,
            breakoutTrigger: false,
            modularFlags: {
                passesShapeCriteria: false,
                passesVolumeCriteria: false,
                passesRSI: false,
                passesHandle: false
            }
        };
    }
}

module.exports = CupAndHandleDetector;
