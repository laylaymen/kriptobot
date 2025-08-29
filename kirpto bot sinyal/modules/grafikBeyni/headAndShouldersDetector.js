/**
 * Grafik Beyni - Head and Shoulders Detector Module
 * 
 * Detects the classic head and shoulders reversal pattern - a bearish pattern 
 * formed by three peaks with the middle peak (head) higher than the side peaks (shoulders).
 * Includes neckline analysis and breakout validation.
 */

const GrafikBeyniModuleBase = require('./grafikBeyniModuleBase');

class HeadAndShouldersDetector extends GrafikBeyniModuleBase {
    constructor() {
        super('headAndShouldersDetector');
        
        // Configuration for head and shoulders pattern
        this.config = {
            shoulderSymmetryTolerance: 0.15, // 15% tolerance for shoulder height difference
            headProminence: 0.03, // Head must be at least 3% higher than shoulders
            necklineDeviation: 0.5, // Max % deviation for neckline touches
            volumeValidation: {
                rightShoulderDecrease: 0.8, // Right shoulder volume should be 80% of left
                breakoutMultiplier: 1.5
            },
            rsiValidation: {
                maxAtHead: 70,
                breakoutBelow: 45
            },
            timingValidation: {
                minCandlesBetweenPeaks: 5,
                maxPatternLength: 50
            }
        };

        // Sub-modules simulation
        this.peakDetector = this.createPeakDetector();
        this.shoulderValidator = this.createShoulderValidator();
        this.necklineCalculator = this.createNecklineCalculator();
        this.volumeAnalyzer = this.createVolumeAnalyzer();
        this.breakoutValidator = this.createBreakoutValidator();
    }

    async analyze(data) {
        try {
            const startTime = Date.now();
            
            if (!this.validateInput(data)) {
                return this.createErrorOutput('Invalid input data for head and shoulders detection');
            }

            // Detect significant peaks
            const peaks = this.peakDetector.findPeaks(data.priceData);
            if (peaks.length < 3) {
                return this.createNeutralOutput('Insufficient peaks for pattern formation');
            }

            // Find potential head and shoulders combinations
            const patterns = this.findHeadShouldersCombinations(peaks, data.priceData);
            if (patterns.length === 0) {
                return this.createNeutralOutput('No valid head and shoulders patterns found');
            }

            // Select best pattern
            const bestPattern = this.selectBestPattern(patterns, data);

            // Validate shoulder symmetry and head prominence
            const shoulderValidation = this.shoulderValidator.validate(bestPattern);
            if (!shoulderValidation.isValid) {
                return this.createNeutralOutput('Shoulder validation failed: ' + shoulderValidation.reason);
            }

            // Calculate neckline
            const neckline = this.necklineCalculator.calculate(bestPattern, data.priceData);
            if (!neckline.isValid) {
                return this.createNeutralOutput('Invalid neckline formation');
            }

            // Analyze volume pattern
            const volumePattern = this.volumeAnalyzer.analyze(bestPattern, data.volume);

            // Check breakout conditions
            const breakoutStatus = this.breakoutValidator.check(
                data,
                neckline,
                volumePattern
            );

            // Calculate confidence score
            const confidenceScore = this.calculateConfidenceScore(
                shoulderValidation,
                neckline,
                volumePattern,
                breakoutStatus,
                data
            );

            const result = {
                formationDetected: true,
                formationType: 'head-and-shoulders',
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
                headProminence: shoulderValidation.headProminence,
                volumePattern: volumePattern.pattern,
                volumeConfirmation: volumePattern.isDecreasing,
                breakoutTrigger: breakoutStatus.triggered,
                breakoutDirection: 'down',
                breakoutConditions: {
                    priceBelowNeckline: breakoutStatus.priceBelowNeckline,
                    volumeSpike: breakoutStatus.volumeSpike,
                    rsiConfirmation: breakoutStatus.rsiConfirms
                },
                modularFlags: {
                    passesShoulderTest: shoulderValidation.isValid,
                    passesNeckline: neckline.isValid,
                    passesVolume: volumePattern.isValid,
                    passesRSI: this.validateRSI(data.rsi, breakoutStatus.triggered)
                }
            };

            this.cacheResult(data, result);
            this.trackPerformance(startTime);

            return result;

        } catch (error) {
            this.logError('Head and shoulders detection failed', error);
            return this.createErrorOutput(error.message);
        }
    }

    createPeakDetector() {
        return {
            findPeaks: (priceData) => {
                const peaks = [];
                const lookback = 3; // Look 3 candles back and forward

                for (let i = lookback; i < priceData.length - lookback; i++) {
                    const current = priceData[i];
                    let isPeak = true;

                    // Check if current high is higher than surrounding highs
                    for (let j = i - lookback; j <= i + lookback; j++) {
                        if (j !== i && priceData[j].high >= current.high) {
                            isPeak = false;
                            break;
                        }
                    }

                    if (isPeak) {
                        peaks.push({
                            index: i,
                            price: current.high,
                            volume: current.volume || 0,
                            timestamp: current.timestamp
                        });
                    }
                }

                return peaks;
            }
        };
    }

    createShoulderValidator() {
        return {
            validate: (pattern) => {
                const leftShoulder = pattern.leftShoulder;
                const head = pattern.head;
                const rightShoulder = pattern.rightShoulder;

                // Check head prominence
                const headProminence = Math.min(
                    (head.price - leftShoulder.price) / leftShoulder.price,
                    (head.price - rightShoulder.price) / rightShoulder.price
                );

                if (headProminence < this.config.headProminence) {
                    return {
                        isValid: false,
                        reason: 'Head not prominent enough',
                        headProminence: headProminence,
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
                        headProminence: headProminence,
                        symmetryScore: symmetryScore
                    };
                }

                // Check timing between peaks
                const leftToHeadDistance = head.index - leftShoulder.index;
                const headToRightDistance = rightShoulder.index - head.index;

                if (leftToHeadDistance < this.config.timingValidation.minCandlesBetweenPeaks ||
                    headToRightDistance < this.config.timingValidation.minCandlesBetweenPeaks) {
                    return {
                        isValid: false,
                        reason: 'Peaks too close together',
                        headProminence: headProminence,
                        symmetryScore: symmetryScore
                    };
                }

                return {
                    isValid: true,
                    headProminence: headProminence,
                    symmetryScore: symmetryScore,
                    timingValid: true
                };
            }
        };
    }

    createNecklineCalculator() {
        return {
            calculate: (pattern, priceData) => {
                // Find valleys between shoulders and head
                const leftValley = this.findValleyBetween(
                    priceData,
                    pattern.leftShoulder.index,
                    pattern.head.index
                );

                const rightValley = this.findValleyBetween(
                    priceData,
                    pattern.head.index,
                    pattern.rightShoulder.index
                );

                if (!leftValley || !rightValley) {
                    return { isValid: false, reason: 'Cannot find valleys for neckline' };
                }

                // Calculate neckline slope and intercept
                const deltaX = rightValley.index - leftValley.index;
                const deltaY = rightValley.price - leftValley.price;
                
                const slope = deltaX !== 0 ? deltaY / deltaX : 0;
                const intercept = leftValley.price - slope * leftValley.index;

                // Validate neckline touches
                const isValid = this.validateNecklineTouches(
                    priceData,
                    leftValley,
                    rightValley,
                    slope,
                    intercept
                );

                return {
                    isValid: isValid,
                    slope: slope,
                    intercept: intercept,
                    leftPoint: leftValley,
                    rightPoint: rightValley
                };
            }
        };
    }

    createVolumeAnalyzer() {
        return {
            analyze: (pattern, volumeData) => {
                if (!volumeData || volumeData.length === 0) {
                    return { pattern: 'no-data', isValid: false, isDecreasing: false };
                }

                const leftShoulderVolume = volumeData[pattern.leftShoulder.index] || 0;
                const headVolume = volumeData[pattern.head.index] || 0;
                const rightShoulderVolume = volumeData[pattern.rightShoulder.index] || 0;

                // Classic pattern: volume decreases from left shoulder to right shoulder
                const isDecreasing = rightShoulderVolume < leftShoulderVolume * this.config.volumeValidation.rightShoulderDecrease;

                // Check volume trend throughout pattern
                const patternStart = pattern.leftShoulder.index;
                const patternEnd = pattern.rightShoulder.index;
                const patternVolume = volumeData.slice(patternStart, patternEnd + 1);

                let decreasingTrend = 0;
                for (let i = 1; i < patternVolume.length; i++) {
                    if (patternVolume[i] < patternVolume[i-1]) decreasingTrend++;
                }

                const trendScore = decreasingTrend / (patternVolume.length - 1);

                return {
                    pattern: trendScore > 0.6 ? 'decreasing' : 'mixed',
                    isValid: isDecreasing,
                    isDecreasing: isDecreasing,
                    leftShoulderVolume: leftShoulderVolume,
                    headVolume: headVolume,
                    rightShoulderVolume: rightShoulderVolume,
                    volumeRatio: rightShoulderVolume / leftShoulderVolume,
                    trendScore: trendScore
                };
            }
        };
    }

    createBreakoutValidator() {
        return {
            check: (data, neckline, volumePattern) => {
                const currentPrice = data.priceData[data.priceData.length - 1];
                const currentVolume = data.volume[data.volume.length - 1];
                const currentIndex = data.priceData.length - 1;

                // Calculate current neckline value
                const necklineValue = neckline.slope * currentIndex + neckline.intercept;

                // Check if price broke below neckline
                const priceBelowNeckline = currentPrice.close < necklineValue;

                // Check volume spike
                const avgRecentVolume = data.volume.slice(-10).reduce((sum, vol) => sum + vol, 0) / 10;
                const volumeSpike = currentVolume > avgRecentVolume * this.config.volumeValidation.breakoutMultiplier;

                // Check RSI confirmation
                const rsiConfirms = this.checkRSIBreakout(data.rsi);

                return {
                    triggered: priceBelowNeckline && volumeSpike && rsiConfirms,
                    priceBelowNeckline: priceBelowNeckline,
                    volumeSpike: volumeSpike,
                    rsiConfirms: rsiConfirms,
                    necklineValue: necklineValue,
                    currentPrice: currentPrice.close
                };
            }
        };
    }

    findHeadShouldersCombinations(peaks, priceData) {
        const combinations = [];

        for (let i = 0; i < peaks.length - 2; i++) {
            for (let j = i + 1; j < peaks.length - 1; j++) {
                for (let k = j + 1; k < peaks.length; k++) {
                    const leftShoulder = peaks[i];
                    const head = peaks[j];
                    const rightShoulder = peaks[k];

                    // Basic validation: head should be higher than shoulders
                    if (head.price > leftShoulder.price && head.price > rightShoulder.price) {
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
            const shoulderValidation = this.shoulderValidator.validate(pattern);
            if (shoulderValidation.isValid) {
                // Score based on symmetry and head prominence
                const score = shoulderValidation.symmetryScore * 0.6 + 
                             shoulderValidation.headProminence * 0.4;
                
                if (score > bestScore) {
                    bestScore = score;
                    bestPattern = pattern;
                }
            }
        }

        return bestPattern;
    }

    findValleyBetween(priceData, startIndex, endIndex) {
        let lowestPrice = Infinity;
        let valleyIndex = -1;

        for (let i = startIndex + 1; i < endIndex; i++) {
            if (priceData[i].low < lowestPrice) {
                lowestPrice = priceData[i].low;
                valleyIndex = i;
            }
        }

        return valleyIndex !== -1 ? {
            index: valleyIndex,
            price: lowestPrice
        } : null;
    }

    validateNecklineTouches(priceData, leftValley, rightValley, slope, intercept) {
        // Check if price actually touches the neckline at calculated points
        const leftExpected = slope * leftValley.index + intercept;
        const rightExpected = slope * rightValley.index + intercept;

        const leftDeviation = Math.abs(leftValley.price - leftExpected) / leftExpected * 100;
        const rightDeviation = Math.abs(rightValley.price - rightExpected) / rightExpected * 100;

        return leftDeviation <= this.config.necklineDeviation && 
               rightDeviation <= this.config.necklineDeviation;
    }

    checkRSIBreakout(rsi) {
        if (!rsi || rsi.length === 0) return false;
        
        const currentRSI = rsi[rsi.length - 1];
        return currentRSI < this.config.rsiValidation.breakoutBelow;
    }

    validateRSI(rsi, breakoutTriggered) {
        if (!rsi || rsi.length === 0) return false;

        const currentRSI = rsi[rsi.length - 1];
        
        if (breakoutTriggered) {
            return currentRSI < this.config.rsiValidation.breakoutBelow;
        } else {
            return currentRSI < this.config.rsiValidation.maxAtHead;
        }
    }

    calculateConfidenceScore(shoulderValidation, neckline, volumePattern, breakoutStatus, data) {
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
        if (this.validateRSI(data.rsi, breakoutStatus.triggered)) {
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
            formationType: 'no-head-shoulders',
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

module.exports = HeadAndShouldersDetector;
