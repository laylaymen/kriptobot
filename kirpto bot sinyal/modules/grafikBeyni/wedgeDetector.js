/**
 * Grafik Beyni - Wedge Detector Module
 * 
 * Detects rising and falling wedge patterns with converging trend lines.
 * Rising wedges are typically bearish reversal patterns (after uptrends) or 
 * bearish continuation patterns (after downtrends).
 * Falling wedges are typically bullish reversal patterns.
 */

const GrafikBeyniModuleBase = require('../grafikBeyniModuleBase');

class WedgeDetector extends GrafikBeyniModuleBase {
    constructor() {
        super('wedgeDetector');
        
        // Configuration for wedge detection
        this.config = {
            minTouchPoints: 4, // Minimum points touching both lines
            maxTouchDeviation: 0.5, // Max % deviation for valid touch
            convergenceAngle: {
                min: 10, // Minimum angle for convergence
                max: 60  // Maximum angle for convergence
            },
            volumeValidation: {
                decreasingRequired: true,
                breakoutMultiplier: 1.5
            },
            rsiValidation: {
                risingWedge: { max: 70, breakoutBelow: 45 },
                fallingWedge: { min: 30, breakoutAbove: 55 }
            }
        };
        
        // Sub-modules simulation (would be separate files in production)
        this.trendLineDrawer = this.createTrendLineDrawer();
        this.convergenceCalculator = this.createConvergenceCalculator();
        this.touchPointValidator = this.createTouchPointValidator();
        this.volumePatternAnalyzer = this.createVolumePatternAnalyzer();
        this.breakoutValidator = this.createBreakoutValidator();
    }

    async analyze(data) {
        try {
            const startTime = Date.now();
            
            // Input validation
            if (!this.validateInput(data)) {
                return this.createErrorOutput('Invalid input data for wedge detection');
            }

            // Extract trend lines from price data
            const trendLines = this.trendLineDrawer.extract(data.priceData);
            if (!trendLines.upper || !trendLines.lower) {
                return this.createNeutralOutput('No valid trend lines found');
            }

            // Calculate convergence
            const convergence = this.convergenceCalculator.analyze(trendLines);
            if (!convergence.isConverging) {
                return this.createNeutralOutput('Lines not converging properly');
            }

            // Validate touch points
            const touchValidation = this.touchPointValidator.validate(
                data.priceData,
                trendLines,
                this.config.minTouchPoints
            );

            // Analyze volume pattern
            const volumePattern = this.volumePatternAnalyzer.analyze(
                data.volume,
                data.priceData.length
            );

            // Determine wedge type
            const wedgeType = this.determineWedgeType(trendLines, data.trendDirection);

            // Check breakout conditions
            const breakoutStatus = this.breakoutValidator.check(
                data,
                trendLines,
                wedgeType,
                volumePattern
            );

            // Calculate confidence score
            const confidenceScore = this.calculateConfidenceScore(
                touchValidation,
                convergence,
                volumePattern,
                breakoutStatus,
                data
            );

            // Generate output
            const result = {
                formationDetected: touchValidation.isValid && convergence.isConverging,
                formationType: wedgeType,
                confidenceScore: confidenceScore,
                upperTrendLine: {
                    slope: trendLines.upper.slope,
                    intercept: trendLines.upper.intercept,
                    touchPoints: trendLines.upper.touchPoints
                },
                lowerTrendLine: {
                    slope: trendLines.lower.slope,
                    intercept: trendLines.lower.intercept,
                    touchPoints: trendLines.lower.touchPoints
                },
                convergenceAngle: convergence.angle,
                convergencePoint: convergence.convergencePoint,
                volumePattern: volumePattern.pattern,
                volumeDecreasing: volumePattern.isDecreasing,
                breakoutTrigger: breakoutStatus.triggered,
                breakoutDirection: breakoutStatus.direction,
                breakoutConditions: {
                    priceBreaksLine: breakoutStatus.priceBreaks,
                    volumeSpike: breakoutStatus.volumeSpike,
                    rsiConfirmation: breakoutStatus.rsiConfirms
                },
                modularFlags: {
                    passesTrendLines: touchValidation.isValid,
                    passesConvergence: convergence.isConverging,
                    passesVolume: volumePattern.isValid,
                    passesRSI: this.validateRSI(data.rsi, wedgeType, breakoutStatus.triggered)
                }
            };

            // Cache result and track performance
            this.cacheResult(data, result);
            this.trackPerformance(startTime);

            return result;

        } catch (error) {
            this.logError('Wedge detection analysis failed', error);
            return this.createErrorOutput(error.message);
        }
    }

    createTrendLineDrawer() {
        return {
            extract: (priceData) => {
                const highs = [];
                const lows = [];
                
                // Find significant highs and lows
                for (let i = 2; i < priceData.length - 2; i++) {
                    const current = priceData[i];
                    const prev1 = priceData[i-1];
                    const prev2 = priceData[i-2];
                    const next1 = priceData[i+1];
                    const next2 = priceData[i+2];
                    
                    // Local high
                    if (current.high > prev1.high && current.high > prev2.high &&
                        current.high > next1.high && current.high > next2.high) {
                        highs.push({ index: i, price: current.high });
                    }
                    
                    // Local low
                    if (current.low < prev1.low && current.low < prev2.low &&
                        current.low < next1.low && current.low < next2.low) {
                        lows.push({ index: i, price: current.low });
                    }
                }

                if (highs.length < 2 || lows.length < 2) {
                    return { upper: null, lower: null };
                }

                // Calculate trend lines using linear regression
                const upperLine = this.calculateTrendLine(highs);
                const lowerLine = this.calculateTrendLine(lows);

                return {
                    upper: {
                        slope: upperLine.slope,
                        intercept: upperLine.intercept,
                        touchPoints: highs.length,
                        points: highs
                    },
                    lower: {
                        slope: lowerLine.slope,
                        intercept: lowerLine.intercept,
                        touchPoints: lows.length,
                        points: lows
                    }
                };
            }
        };
    }

    createConvergenceCalculator() {
        return {
            analyze: (trendLines) => {
                const upperSlope = trendLines.upper.slope;
                const lowerSlope = trendLines.lower.slope;
                
                // Lines must have opposite directions or one flat
                const isConverging = (upperSlope > lowerSlope) && 
                                   Math.abs(upperSlope - lowerSlope) > 0.001;
                
                if (!isConverging) {
                    return { isConverging: false, angle: 0, convergencePoint: null };
                }

                // Calculate convergence angle
                const angle = Math.abs(Math.atan(upperSlope) - Math.atan(lowerSlope)) * (180 / Math.PI);
                
                // Calculate convergence point
                const convergenceX = (trendLines.lower.intercept - trendLines.upper.intercept) / 
                                   (upperSlope - lowerSlope);
                
                const convergenceY = upperSlope * convergenceX + trendLines.upper.intercept;

                return {
                    isConverging: angle >= this.config.convergenceAngle.min && 
                                 angle <= this.config.convergenceAngle.max,
                    angle: angle,
                    convergencePoint: { x: convergenceX, y: convergenceY }
                };
            }
        };
    }

    createTouchPointValidator() {
        return {
            validate: (priceData, trendLines, minPoints) => {
                let upperTouches = 0;
                let lowerTouches = 0;

                for (let i = 0; i < priceData.length; i++) {
                    const expectedUpper = trendLines.upper.slope * i + trendLines.upper.intercept;
                    const expectedLower = trendLines.lower.slope * i + trendLines.lower.intercept;

                    // Check upper line touches
                    const upperDeviation = Math.abs(priceData[i].high - expectedUpper) / expectedUpper * 100;
                    if (upperDeviation <= this.config.maxTouchDeviation) {
                        upperTouches++;
                    }

                    // Check lower line touches
                    const lowerDeviation = Math.abs(priceData[i].low - expectedLower) / expectedLower * 100;
                    if (lowerDeviation <= this.config.maxTouchDeviation) {
                        lowerTouches++;
                    }
                }

                return {
                    isValid: upperTouches >= minPoints && lowerTouches >= minPoints,
                    upperTouches: upperTouches,
                    lowerTouches: lowerTouches
                };
            }
        };
    }

    createVolumePatternAnalyzer() {
        return {
            analyze: (volumeData, priceLength) => {
                if (!volumeData || volumeData.length < 10) {
                    return { pattern: 'insufficient-data', isDecreasing: false, isValid: false };
                }

                const recentVolume = volumeData.slice(-10);
                const earlierVolume = volumeData.slice(-20, -10);

                const recentAvg = recentVolume.reduce((sum, vol) => sum + vol, 0) / recentVolume.length;
                const earlierAvg = earlierVolume.reduce((sum, vol) => sum + vol, 0) / earlierVolume.length;

                const isDecreasing = recentAvg < earlierAvg * 0.8;

                // Check for volume trend
                let increasingCount = 0;
                let decreasingCount = 0;

                for (let i = 1; i < recentVolume.length; i++) {
                    if (recentVolume[i] > recentVolume[i-1]) increasingCount++;
                    else if (recentVolume[i] < recentVolume[i-1]) decreasingCount++;
                }

                const pattern = decreasingCount > increasingCount ? 'decreasing' : 
                               increasingCount > decreasingCount ? 'increasing' : 'mixed';

                return {
                    pattern: pattern,
                    isDecreasing: isDecreasing,
                    isValid: this.config.volumeValidation.decreasingRequired ? isDecreasing : true,
                    recentAverage: recentAvg,
                    earlierAverage: earlierAvg
                };
            }
        };
    }

    createBreakoutValidator() {
        return {
            check: (data, trendLines, wedgeType, volumePattern) => {
                const currentPrice = data.priceData[data.priceData.length - 1];
                const currentVolume = data.volume[data.volume.length - 1];
                const avgVolume = volumePattern.recentAverage;

                // Calculate current trend line values
                const currentIndex = data.priceData.length - 1;
                const upperLineValue = trendLines.upper.slope * currentIndex + trendLines.upper.intercept;
                const lowerLineValue = trendLines.lower.slope * currentIndex + trendLines.lower.intercept;

                let priceBreaks = false;
                let expectedDirection = null;

                // Determine breakout based on wedge type
                if (wedgeType === 'rising-wedge') {
                    priceBreaks = currentPrice.close < lowerLineValue;
                    expectedDirection = 'down';
                } else if (wedgeType === 'falling-wedge') {
                    priceBreaks = currentPrice.close > upperLineValue;
                    expectedDirection = 'up';
                }

                // Volume spike check
                const volumeSpike = currentVolume > avgVolume * this.config.volumeValidation.breakoutMultiplier;

                // RSI confirmation
                const rsiConfirms = this.checkRSIConfirmation(data.rsi, wedgeType, expectedDirection);

                return {
                    triggered: priceBreaks && volumeSpike && rsiConfirms,
                    direction: expectedDirection,
                    priceBreaks: priceBreaks,
                    volumeSpike: volumeSpike,
                    rsiConfirms: rsiConfirms
                };
            }
        };
    }

    determineWedgeType(trendLines, trendDirection) {
        const upperSlope = trendLines.upper.slope;
        const lowerSlope = trendLines.lower.slope;

        // Rising wedge: both lines rising, upper steeper
        if (upperSlope > 0 && lowerSlope > 0 && upperSlope > lowerSlope) {
            return 'rising-wedge';
        }
        
        // Falling wedge: both lines falling, lower steeper (more negative)
        if (upperSlope < 0 && lowerSlope < 0 && lowerSlope < upperSlope) {
            return 'falling-wedge';
        }

        return 'undefined-wedge';
    }

    checkRSIConfirmation(rsi, wedgeType, direction) {
        if (!rsi || rsi.length === 0) return false;

        const currentRSI = rsi[rsi.length - 1];

        if (wedgeType === 'rising-wedge' && direction === 'down') {
            return currentRSI < this.config.rsiValidation.risingWedge.breakoutBelow;
        } else if (wedgeType === 'falling-wedge' && direction === 'up') {
            return currentRSI > this.config.rsiValidation.fallingWedge.breakoutAbove;
        }

        return false;
    }

    validateRSI(rsi, wedgeType, breakoutTriggered) {
        if (!rsi || rsi.length === 0) return false;

        const currentRSI = rsi[rsi.length - 1];

        if (wedgeType === 'rising-wedge') {
            return breakoutTriggered ? 
                currentRSI < this.config.rsiValidation.risingWedge.breakoutBelow :
                currentRSI < this.config.rsiValidation.risingWedge.max;
        } else if (wedgeType === 'falling-wedge') {
            return breakoutTriggered ?
                currentRSI > this.config.rsiValidation.fallingWedge.breakoutAbove :
                currentRSI > this.config.rsiValidation.fallingWedge.min;
        }

        return true;
    }

    calculateTrendLine(points) {
        const n = points.length;
        let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;

        for (let point of points) {
            sumX += point.index;
            sumY += point.price;
            sumXY += point.index * point.price;
            sumXX += point.index * point.index;
        }

        const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
        const intercept = (sumY - slope * sumX) / n;

        return { slope, intercept };
    }

    calculateConfidenceScore(touchValidation, convergence, volumePattern, breakoutStatus, data) {
        let score = 0;

        // Touch points validation (30%)
        if (touchValidation.isValid) score += 0.3;

        // Convergence quality (25%)
        if (convergence.isConverging) {
            const angleScore = Math.min(convergence.angle / this.config.convergenceAngle.max, 1);
            score += 0.25 * angleScore;
        }

        // Volume pattern (20%)
        if (volumePattern.isValid) score += 0.2;

        // RSI confirmation (15%)
        if (this.validateRSI(data.rsi, this.determineWedgeType({ 
            upper: { slope: 1 }, lower: { slope: 0.5 } 
        }, data.trendDirection), breakoutStatus.triggered)) {
            score += 0.15;
        }

        // Breakout quality (10%)
        if (breakoutStatus.triggered) score += 0.1;

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
            formationType: 'no-wedge',
            confidenceScore: 0,
            reason: reason,
            breakoutTrigger: false,
            modularFlags: {
                passesTrendLines: false,
                passesConvergence: false,
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
                passesTrendLines: false,
                passesConvergence: false,
                passesVolume: false,
                passesRSI: false
            }
        };
    }
}

module.exports = WedgeDetector;
