/**
 * Grafik Beyni - Inverse Head and Shoulders Detector Module
 * 
 * Detects the inverse head and shoulders pattern - a bullish reversal pattern
 * formed by three valleys with the middle valley (head) lower than the side valleys (shoulders).
 * This is the mirror image of the classic head and shoulders pattern.
 */

const GrafikBeyniModuleBase = require('../grafikBeyniModuleBase');

class InverseHeadAndShouldersDetector extends GrafikBeyniModuleBase {
    constructor() {
        super('inverseHeadAndShouldersDetector');
        
        // Configuration for inverse head and shoulders pattern
        this.config = {
            shoulderSymmetryTolerance: 0.15, // 15% tolerance for shoulder depth difference
            headDepth: 0.03, // Head must be at least 3% lower than shoulders
            necklineDeviation: 0.5, // Max % deviation for neckline touches
            volumeValidation: {
                rightShoulderIncrease: 1.2, // Right shoulder volume should be 120% of left
                breakoutMultiplier: 1.5
            },
            rsiValidation: {
                minAtHead: 30,
                breakoutAbove: 55
            },
            timingValidation: {
                minCandlesBetweenValleys: 5,
                maxPatternLength: 50
            }
        };

        // Sub-modules simulation (would be separate files in production)
        this.bottomPatternRecognizer = this.createBottomPatternRecognizer();
        this.necklineCalculator = this.createNecklineCalculator();
        this.volumeAscentDetector = this.createVolumeAscentDetector();
        this.rsiTriggerWatcher = this.createRsiTriggerWatcher();
        this.breakoutValidator = this.createBreakoutValidator();
    }

    async analyze(data) {
        try {
            const startTime = Date.now();
            
            if (!this.validateInput(data)) {
                return this.createErrorOutput('Invalid input data for inverse head and shoulders detection');
            }

            // Detect significant valleys (bottom patterns)
            const valleys = this.bottomPatternRecognizer.findValleys(data.priceData);
            if (valleys.length < 3) {
                return this.createNeutralOutput('Insufficient valleys for pattern formation');
            }

            // Find potential inverse head and shoulders combinations
            const patterns = this.findInverseHeadShouldersCombinations(valleys, data.priceData);
            if (patterns.length === 0) {
                return this.createNeutralOutput('No valid inverse head and shoulders patterns found');
            }

            // Select best pattern
            const bestPattern = this.selectBestPattern(patterns, data);

            // Validate shoulder symmetry and head depth
            const shoulderValidation = this.validateShoulders(bestPattern);
            if (!shoulderValidation.isValid) {
                return this.createNeutralOutput('Shoulder validation failed: ' + shoulderValidation.reason);
            }

            // Calculate neckline from peaks between valleys
            const neckline = this.necklineCalculator.calculate(bestPattern, data.priceData);
            if (!neckline.isValid) {
                return this.createNeutralOutput('Invalid neckline formation');
            }

            // Analyze volume ascent pattern
            const volumePattern = this.volumeAscentDetector.analyze(bestPattern, data.volume);

            // Check RSI trigger conditions
            const rsiTrigger = this.rsiTriggerWatcher.check(data.rsi, bestPattern);

            // Check breakout conditions
            const breakoutStatus = this.breakoutValidator.check(
                data,
                neckline,
                volumePattern,
                rsiTrigger
            );

            // Calculate confidence score
            const confidenceScore = this.calculateConfidenceScore(
                shoulderValidation,
                neckline,
                volumePattern,
                rsiTrigger,
                breakoutStatus,
                data
            );

            const result = {
                formationDetected: true,
                formationType: 'inverse-head-and-shoulders',
                confidenceScore: confidenceScore,
                leftShoulder: {
                    index: bestPattern.leftShoulder.index,
                    price: bestPattern.leftShoulder.price,
                    volume: bestPattern.leftShoulder.volume
                },
                head: {
                    index: bestPattern.head.index,
                    price: bestPattern.head.price,
                    volume: bestPattern.head.volume
                },
                rightShoulder: {
                    index: bestPattern.rightShoulder.index,
                    price: bestPattern.rightShoulder.price,
                    volume: bestPattern.rightShoulder.volume
                },
                neckline: {
                    slope: neckline.slope,
                    intercept: neckline.intercept,
                    leftPoint: neckline.leftPoint,
                    rightPoint: neckline.rightPoint
                },
                shoulderSymmetry: shoulderValidation.symmetryScore,
                headDepth: shoulderValidation.headDepth,
                volumePattern: volumePattern.pattern,
                volumeAscent: volumePattern.isIncreasing,
                rsiZone: rsiTrigger.zone,
                rsiAbove50: rsiTrigger.above50,
                breakoutTrigger: breakoutStatus.triggered,
                breakoutDirection: 'up',
                breakoutConditions: {
                    priceAboveNeckline: breakoutStatus.priceAboveNeckline,
                    volumeSpike: breakoutStatus.volumeSpike,
                    rsiConfirmation: breakoutStatus.rsiConfirms
                },
                modularFlags: {
                    passesShoulderTest: shoulderValidation.isValid,
                    passesNeckline: neckline.isValid,
                    passesVolume: volumePattern.isValid,
                    passesRSI: rsiTrigger.isValid
                }
            };

            this.cacheResult(data, result);
            this.trackPerformance(startTime);

            return result;

        } catch (error) {
            this.logError('Inverse head and shoulders detection failed', error);
            return this.createErrorOutput(error.message);
        }
    }

    createBottomPatternRecognizer() {
        return {
            findValleys: (priceData) => {
                const valleys = [];
                const lookback = 3; // Look 3 candles back and forward

                for (let i = lookback; i < priceData.length - lookback; i++) {
                    const current = priceData[i];
                    let isValley = true;

                    // Check if current low is lower than surrounding lows
                    for (let j = i - lookback; j <= i + lookback; j++) {
                        if (j !== i && priceData[j].low <= current.low) {
                            isValley = false;
                            break;
                        }
                    }

                    if (isValley) {
                        valleys.push({
                            index: i,
                            price: current.low,
                            volume: current.volume || 0,
                            timestamp: current.timestamp
                        });
                    }
                }

                return valleys;
            }
        };
    }

    createNecklineCalculator() {
        return {
            calculate: (pattern, priceData) => {
                // Find peaks between valleys
                const leftPeak = this.findPeakBetween(
                    priceData,
                    pattern.leftShoulder.index,
                    pattern.head.index
                );

                const rightPeak = this.findPeakBetween(
                    priceData,
                    pattern.head.index,
                    pattern.rightShoulder.index
                );

                if (!leftPeak || !rightPeak) {
                    return { isValid: false, reason: 'Cannot find peaks for neckline' };
                }

                // Calculate neckline slope and intercept
                const deltaX = rightPeak.index - leftPeak.index;
                const deltaY = rightPeak.price - leftPeak.price;
                
                const slope = deltaX !== 0 ? deltaY / deltaX : 0;
                const intercept = leftPeak.price - slope * leftPeak.index;

                // Validate neckline touches
                const isValid = this.validateNecklineTouches(
                    priceData,
                    leftPeak,
                    rightPeak,
                    slope,
                    intercept
                );

                return {
                    isValid: isValid,
                    slope: slope,
                    intercept: intercept,
                    leftPoint: leftPeak,
                    rightPoint: rightPeak
                };
            }
        };
    }

    createVolumeAscentDetector() {
        return {
            analyze: (pattern, volumeData) => {
                if (!volumeData || volumeData.length === 0) {
                    return { pattern: 'no-data', isValid: false, isIncreasing: false };
                }

                const leftShoulderVolume = volumeData[pattern.leftShoulder.index] || 0;
                const headVolume = volumeData[pattern.head.index] || 0;
                const rightShoulderVolume = volumeData[pattern.rightShoulder.index] || 0;

                // In inverse H&S, volume should increase towards right shoulder
                const isIncreasing = rightShoulderVolume > leftShoulderVolume * this.config.volumeValidation.rightShoulderIncrease;

                // Check volume trend throughout pattern
                const patternStart = pattern.leftShoulder.index;
                const patternEnd = pattern.rightShoulder.index;
                const patternVolume = volumeData.slice(patternStart, patternEnd + 1);

                let increasingTrend = 0;
                for (let i = 1; i < patternVolume.length; i++) {
                    if (patternVolume[i] > patternVolume[i-1]) increasingTrend++;
                }

                const trendScore = increasingTrend / (patternVolume.length - 1);

                return {
                    pattern: trendScore > 0.6 ? 'increasing' : 'mixed',
                    isValid: isIncreasing,
                    isIncreasing: isIncreasing,
                    leftShoulderVolume: leftShoulderVolume,
                    headVolume: headVolume,
                    rightShoulderVolume: rightShoulderVolume,
                    volumeRatio: rightShoulderVolume / leftShoulderVolume,
                    trendScore: trendScore
                };
            }
        };
    }

    createRsiTriggerWatcher() {
        return {
            check: (rsiData, pattern) => {
                if (!rsiData || rsiData.length === 0) {
                    return { isValid: false, zone: 'unknown', above50: false };
                }

                const currentRSI = rsiData[rsiData.length - 1];
                const headRSI = rsiData[pattern.head.index] || currentRSI;

                // RSI should be above 50 for bullish confirmation
                const above50 = currentRSI > 50;
                
                // RSI at head should have been in oversold territory
                const headWasOversold = headRSI < this.config.rsiValidation.minAtHead;

                let zone = 'neutral';
                if (currentRSI < 30) zone = 'oversold';
                else if (currentRSI > 70) zone = 'overbought';
                else if (currentRSI > 50) zone = 'bullish';
                else zone = 'bearish';

                return {
                    isValid: above50 && headWasOversold,
                    zone: zone,
                    above50: above50,
                    currentRSI: currentRSI,
                    headRSI: headRSI,
                    headWasOversold: headWasOversold
                };
            }
        };
    }

    createBreakoutValidator() {
        return {
            check: (data, neckline, volumePattern, rsiTrigger) => {
                const currentPrice = data.priceData[data.priceData.length - 1];
                const currentVolume = data.volume[data.volume.length - 1];
                const currentIndex = data.priceData.length - 1;

                // Calculate current neckline value
                const necklineValue = neckline.slope * currentIndex + neckline.intercept;

                // Check if price broke above neckline
                const priceAboveNeckline = currentPrice.close > necklineValue;

                // Check volume spike
                const avgRecentVolume = data.volume.slice(-10).reduce((sum, vol) => sum + vol, 0) / 10;
                const volumeSpike = currentVolume > avgRecentVolume * this.config.volumeValidation.breakoutMultiplier;

                // Check RSI confirmation
                const rsiConfirms = this.checkRSIBreakout(data.rsi);

                return {
                    triggered: priceAboveNeckline && volumeSpike && rsiConfirms,
                    priceAboveNeckline: priceAboveNeckline,
                    volumeSpike: volumeSpike,
                    rsiConfirms: rsiConfirms,
                    necklineValue: necklineValue,
                    currentPrice: currentPrice.close
                };
            }
        };
    }

    findInverseHeadShouldersCombinations(valleys, priceData) {
        const combinations = [];

        for (let i = 0; i < valleys.length - 2; i++) {
            for (let j = i + 1; j < valleys.length - 1; j++) {
                for (let k = j + 1; k < valleys.length; k++) {
                    const leftShoulder = valleys[i];
                    const head = valleys[j];
                    const rightShoulder = valleys[k];

                    // Basic validation: head should be lower than shoulders
                    if (head.price < leftShoulder.price && head.price < rightShoulder.price) {
                        // Check pattern length
                        const patternLength = rightShoulder.index - leftShoulder.index;
                        if (patternLength <= this.config.timingValidation.maxPatternLength) {
                            combinations.push({
                                leftShoulder: leftShoulder,
                                head: head,
                                rightShoulder: rightShoulder,
                                patternLength: patternLength
                            });
                        }
                    }
                }
            }
        }

        return combinations;
    }

    selectBestPattern(patterns, data) {
        let bestPattern = null;
        let bestScore = 0;

        for (let pattern of patterns) {
            const shoulderValidation = this.validateShoulders(pattern);
            if (shoulderValidation.isValid) {
                // Score based on symmetry and head depth
                const score = shoulderValidation.symmetryScore * 0.6 + 
                             shoulderValidation.headDepth * 0.4;
                
                if (score > bestScore) {
                    bestScore = score;
                    bestPattern = pattern;
                }
            }
        }

        return bestPattern;
    }

    validateShoulders(pattern) {
        const leftShoulder = pattern.leftShoulder;
        const head = pattern.head;
        const rightShoulder = pattern.rightShoulder;

        // Check head depth (how much lower the head is compared to shoulders)
        const headDepth = Math.min(
            (leftShoulder.price - head.price) / leftShoulder.price,
            (rightShoulder.price - head.price) / rightShoulder.price
        );

        if (headDepth < this.config.headDepth) {
            return {
                isValid: false,
                reason: 'Head not deep enough',
                headDepth: headDepth,
                symmetryScore: 0
            };
        }

        // Check shoulder symmetry
        const shoulderDifference = Math.abs(leftShoulder.price - rightShoulder.price);
        const averageShoulderPrice = (leftShoulder.price + rightShoulder.price) / 2;
        const symmetryScore = 1 - (shoulderDifference / averageShoulderPrice);

        if (symmetryScore < (1 - this.config.shoulderSymmetryTolerance)) {
            return {
                isValid: false,
                reason: 'Shoulders not symmetrical enough',
                headDepth: headDepth,
                symmetryScore: symmetryScore
            };
        }

        // Check timing between valleys
        const leftToHeadDistance = head.index - leftShoulder.index;
        const headToRightDistance = rightShoulder.index - head.index;

        if (leftToHeadDistance < this.config.timingValidation.minCandlesBetweenValleys ||
            headToRightDistance < this.config.timingValidation.minCandlesBetweenValleys) {
            return {
                isValid: false,
                reason: 'Valleys too close together',
                headDepth: headDepth,
                symmetryScore: symmetryScore
            };
        }

        return {
            isValid: true,
            headDepth: headDepth,
            symmetryScore: symmetryScore,
            timingValid: true
        };
    }

    findPeakBetween(priceData, startIndex, endIndex) {
        let highestPrice = -Infinity;
        let peakIndex = -1;

        for (let i = startIndex + 1; i < endIndex; i++) {
            if (priceData[i].high > highestPrice) {
                highestPrice = priceData[i].high;
                peakIndex = i;
            }
        }

        return peakIndex !== -1 ? {
            index: peakIndex,
            price: highestPrice
        } : null;
    }

    validateNecklineTouches(priceData, leftPeak, rightPeak, slope, intercept) {
        // Check if price actually touches the neckline at calculated points
        const leftExpected = slope * leftPeak.index + intercept;
        const rightExpected = slope * rightPeak.index + intercept;

        const leftDeviation = Math.abs(leftPeak.price - leftExpected) / leftExpected * 100;
        const rightDeviation = Math.abs(rightPeak.price - rightExpected) / rightExpected * 100;

        return leftDeviation <= this.config.necklineDeviation && 
               rightDeviation <= this.config.necklineDeviation;
    }

    checkRSIBreakout(rsi) {
        if (!rsi || rsi.length === 0) return false;
        
        const currentRSI = rsi[rsi.length - 1];
        return currentRSI > this.config.rsiValidation.breakoutAbove;
    }

    calculateConfidenceScore(shoulderValidation, neckline, volumePattern, rsiTrigger, breakoutStatus, data) {
        let score = 0;

        // Shoulder validation (35%)
        if (shoulderValidation.isValid) {
            score += 0.35 * shoulderValidation.symmetryScore;
        }

        // Neckline quality (25%)
        if (neckline.isValid) {
            score += 0.25;
        }

        // Volume pattern (20%)
        if (volumePattern.isValid) {
            score += 0.20;
        }

        // RSI validation (15%)
        if (rsiTrigger.isValid) {
            score += 0.15;
        }

        // Breakout confirmation (5%)
        if (breakoutStatus.triggered) {
            score += 0.05;
        }

        return Math.min(score, 0.95);
    }

    validateInput(data) {
        return data && 
               data.priceData && Array.isArray(data.priceData) && data.priceData.length >= 20 &&
               data.volume && Array.isArray(data.volume) &&
               data.rsi && Array.isArray(data.rsi);
    }

    createNeutralOutput(reason) {
        return {
            formationDetected: false,
            formationType: 'no-inverse-head-shoulders',
            confidenceScore: 0,
            reason: reason,
            breakoutTrigger: false,
            modularFlags: {
                passesShoulderTest: false,
                passesNeckline: false,
                passesVolume: false,
                passesRSI: false
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
                passesShoulderTest: false,
                passesNeckline: false,
                passesVolume: false,
                passesRSI: false
            }
        };
    }
}

module.exports = InverseHeadAndShouldersDetector;
