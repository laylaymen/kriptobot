/**
 * Grafik Beyni - Trend Line Integrity Checker Module
 * 
 * Verifies whether trend line breakouts are genuine or false breakouts.
 * Analyzes volume, momentum, candle structure, and closing levels to validate breakouts.
 * Prevents the system from acting on fake breakouts.
 */

const GrafikBeyniModuleBase = require('../grafikBeyniModuleBase');

class TrendLineIntegrityChecker extends GrafikBeyniModuleBase {
    constructor() {
        super('trendLineIntegrityChecker');
        
        // Configuration for trend line integrity checking
        this.config = {
            scoreWeights: {
                candleClose: 0.30,        // Candle close above/below trend line
                breakoutVolume: 0.25,     // High breakout volume
                shadowAnalysis: 0.20,     // Low shadow-to-body ratio
                multipleTouch: 0.15,      // 3+ touches before breakout
                rsiConfirmation: 0.10     // RSI > 60 for bullish breakouts
            },
            thresholds: {
                validBreakout: 0.75,      // Breakout is valid
                cautiousBreakout: 0.50,   // Approach carefully
                falseBreakout: 0.50       // Likely false breakout
            },
            volumeThresholds: {
                significantIncrease: 1.20  // 20% above average
            },
            rsiThresholds: {
                bullishBreakout: 60,
                bearishBreakout: 40
            },
            candleAnalysis: {
                maxShadowToBodyRatio: 3.0,  // Shadow should not be > 3x body
                minBodySize: 0.3             // Minimum body size relative to range
            },
            touchValidation: {
                minimumTouches: 3,
                maxAngleDeviation: 10        // degrees
            }
        };
    }

    async analyze(data) {
        try {
            const startTime = Date.now();
            
            if (!this.validateInput(data)) {
                return this.createErrorOutput('Invalid input data for trend line integrity checking');
            }

            // Analyze breakout components
            const candleAnalysis = this.analyzeCandleClose(data);
            const volumeAnalysis = this.analyzeBreakoutVolume(data.breakoutVolume, data.avgVolume);
            const shadowAnalysis = this.analyzeShadowToBodyRatio(data.shadowSize, data.bodyToShadowRatio);
            const touchAnalysis = this.analyzeTrendLineTouches(data.touchCount, data.trendLineAngle);
            const rsiAnalysis = this.analyzeRSIConfirmation(data.rsi, data.breakoutDirection);

            // Calculate overall integrity score
            const integrityScore = this.calculateIntegrityScore(
                candleAnalysis,
                volumeAnalysis,
                shadowAnalysis,
                touchAnalysis,
                rsiAnalysis
            );

            // Determine breakout validity
            const isBreakoutValid = integrityScore >= this.config.thresholds.validBreakout;
            const recommendation = this.generateRecommendation(integrityScore, data);

            // Generate justifications
            const justifications = this.generateJustifications(
                candleAnalysis,
                volumeAnalysis,
                shadowAnalysis,
                touchAnalysis,
                rsiAnalysis,
                data
            );

            // Create modular recommendations
            const modularRecommendations = this.generateModularRecommendations(
                isBreakoutValid,
                integrityScore,
                data
            );

            const result = {
                breakoutIntegrityScore: integrityScore,
                isBreakoutValid: isBreakoutValid,
                recommendation: recommendation,
                justifications: justifications,
                modularRecommendations: modularRecommendations,
                componentAnalysis: {
                    candleClose: candleAnalysis,
                    volume: volumeAnalysis,
                    shadow: shadowAnalysis,
                    touches: touchAnalysis,
                    rsi: rsiAnalysis
                },
                riskFactors: this.identifyRiskFactors(data, integrityScore),
                breakoutQuality: this.getBreakoutQuality(integrityScore)
            };

            this.cacheResult(data, result);
            this.trackPerformance(startTime);

            return result;

        } catch (error) {
            this.logError('Trend line integrity checking failed', error);
            return this.createErrorOutput(error.message);
        }
    }

    analyzeCandleClose(data) {
        let score = 0;
        let isValidClose = false;
        let analysis = 'unknown';

        if (data.candleCloseAboveLine !== undefined && data.breakoutDirection) {
            if (data.breakoutDirection === 'up' && data.candleCloseAboveLine === true) {
                score = 1.0;
                isValidClose = true;
                analysis = 'close-above-resistance';
            } else if (data.breakoutDirection === 'down' && data.candleCloseAboveLine === false) {
                score = 1.0;
                isValidClose = true;
                analysis = 'close-below-support';
            } else {
                score = 0.2; // Body crossed but didn't close properly
                isValidClose = false;
                analysis = 'weak-close';
            }
        }

        return {
            score: score * this.config.scoreWeights.candleClose,
            isValidClose: isValidClose,
            analysis: analysis
        };
    }

    analyzeBreakoutVolume(breakoutVolume, avgVolume) {
        let score = 0;
        let isSignificant = false;
        let ratio = 1.0;

        if (breakoutVolume && avgVolume && avgVolume > 0) {
            ratio = breakoutVolume / avgVolume;
            
            if (ratio >= this.config.volumeThresholds.significantIncrease) {
                // Scale score based on volume increase
                score = Math.min(1.0, (ratio - 1) * 2);
                isSignificant = true;
            } else {
                // Low volume breakout is suspicious
                score = Math.max(0, ratio * 0.5);
                isSignificant = false;
            }
        }

        return {
            score: score * this.config.scoreWeights.breakoutVolume,
            isSignificant: isSignificant,
            ratio: ratio,
            breakoutVolume: breakoutVolume || 0,
            avgVolume: avgVolume || 0
        };
    }

    analyzeShadowToBodyRatio(shadowSize, bodyToShadowRatio) {
        let score = 0;
        let isHealthy = false;
        let analysis = 'unknown';

        if (bodyToShadowRatio !== undefined) {
            // Higher ratio means smaller shadow relative to body (better)
            if (bodyToShadowRatio >= this.config.candleAnalysis.maxShadowToBodyRatio) {
                score = 1.0;
                isHealthy = true;
                analysis = 'strong-body-small-shadow';
            } else if (bodyToShadowRatio >= 1.0) {
                score = bodyToShadowRatio / this.config.candleAnalysis.maxShadowToBodyRatio;
                isHealthy = bodyToShadowRatio >= 1.5;
                analysis = 'moderate-body-shadow-ratio';
            } else {
                // Shadow larger than body - suspicious
                score = 0.2;
                isHealthy = false;
                analysis = 'large-shadow-weak-body';
            }
        } else if (shadowSize !== undefined) {
            // Direct shadow size analysis
            if (shadowSize <= 0.3) {
                score = 1.0;
                isHealthy = true;
                analysis = 'small-shadow';
            } else if (shadowSize <= 0.6) {
                score = 0.6;
                isHealthy = false;
                analysis = 'moderate-shadow';
            } else {
                score = 0.2;
                isHealthy = false;
                analysis = 'large-shadow';
            }
        }

        return {
            score: score * this.config.scoreWeights.shadowAnalysis,
            isHealthy: isHealthy,
            analysis: analysis,
            shadowSize: shadowSize,
            bodyToShadowRatio: bodyToShadowRatio
        };
    }

    analyzeTrendLineTouches(touchCount, trendLineAngle) {
        let score = 0;
        let isSufficient = false;
        let quality = 'poor';

        if (touchCount !== undefined) {
            if (touchCount >= this.config.touchValidation.minimumTouches) {
                // More touches = stronger trend line
                score = Math.min(1.0, touchCount / 5); // Cap at 5 touches for max score
                isSufficient = true;
                quality = touchCount >= 4 ? 'excellent' : 'good';
            } else {
                score = touchCount / this.config.touchValidation.minimumTouches * 0.5;
                isSufficient = false;
                quality = 'insufficient';
            }
        }

        // Adjust score based on trend line angle (if available)
        if (trendLineAngle !== undefined) {
            if (trendLineAngle > 60 || trendLineAngle < 15) {
                // Too steep or too flat trend lines are less reliable
                score *= 0.8;
                quality = 'questionable-angle';
            }
        }

        return {
            score: score * this.config.scoreWeights.multipleTouch,
            isSufficient: isSufficient,
            quality: quality,
            touchCount: touchCount || 0,
            trendLineAngle: trendLineAngle
        };
    }

    analyzeRSIConfirmation(rsi, breakoutDirection) {
        let score = 0;
        let isConfirmed = false;
        let analysis = 'neutral';

        if (rsi !== undefined && breakoutDirection) {
            if (breakoutDirection === 'up') {
                if (rsi >= this.config.rsiThresholds.bullishBreakout) {
                    score = 1.0;
                    isConfirmed = true;
                    analysis = 'rsi-confirms-bullish-breakout';
                } else if (rsi >= 50) {
                    score = 0.6;
                    isConfirmed = false;
                    analysis = 'rsi-neutral-for-bullish';
                } else {
                    score = 0.2;
                    isConfirmed = false;
                    analysis = 'rsi-against-bullish-breakout';
                }
            } else if (breakoutDirection === 'down') {
                if (rsi <= this.config.rsiThresholds.bearishBreakout) {
                    score = 1.0;
                    isConfirmed = true;
                    analysis = 'rsi-confirms-bearish-breakout';
                } else if (rsi <= 50) {
                    score = 0.6;
                    isConfirmed = false;
                    analysis = 'rsi-neutral-for-bearish';
                } else {
                    score = 0.2;
                    isConfirmed = false;
                    analysis = 'rsi-against-bearish-breakout';
                }
            }
        }

        return {
            score: score * this.config.scoreWeights.rsiConfirmation,
            isConfirmed: isConfirmed,
            analysis: analysis,
            rsi: rsi,
            breakoutDirection: breakoutDirection
        };
    }

    calculateIntegrityScore(candle, volume, shadow, touches, rsi) {
        const totalScore = 
            candle.score +
            volume.score +
            shadow.score +
            touches.score +
            rsi.score;

        return Math.max(0, Math.min(1, totalScore));
    }

    generateRecommendation(integrityScore, data) {
        if (integrityScore >= this.config.thresholds.validBreakout) {
            return 'confirm';
        } else if (integrityScore >= this.config.thresholds.cautiousBreakout) {
            return 'cautious-confirm';
        } else {
            return 'reject';
        }
    }

    generateJustifications(candle, volume, shadow, touches, rsi, data) {
        const justifications = [];

        if (candle.isValidClose) {
            justifications.push('Candle close above trendline');
        }

        if (volume.isSignificant) {
            justifications.push('High breakout volume');
        }

        if (shadow.isHealthy) {
            justifications.push('Low shadow-to-body ratio');
        }

        if (touches.isSufficient) {
            justifications.push('Multiple touches before breakout');
        }

        if (rsi.isConfirmed) {
            justifications.push('RSI confirms breakout direction');
        }

        // Add negative factors
        if (!candle.isValidClose) {
            justifications.push('Weak candle close');
        }

        if (!volume.isSignificant) {
            justifications.push('Low breakout volume');
        }

        if (!shadow.isHealthy) {
            justifications.push('Large shadows indicate uncertainty');
        }

        return justifications;
    }

    generateModularRecommendations(isBreakoutValid, integrityScore, data) {
        return {
            formationCompletenessJudge: {
                markConfirmed: isBreakoutValid,
                integrityScore: integrityScore,
                requireAdditionalConfirmation: !isBreakoutValid
            },
            entryZoneClassifier: {
                allowFastEntry: isBreakoutValid && integrityScore > 0.8,
                requireBetterEntry: !isBreakoutValid,
                breakoutQuality: integrityScore
            },
            supportResistanceReactor: {
                upgradeActionToEnter: isBreakoutValid,
                maintainCaution: !isBreakoutValid,
                breakoutStrength: integrityScore
            },
            tpOptimizer: {
                allowExtendedTargets: isBreakoutValid,
                useConservativeTargets: !isBreakoutValid,
                breakoutConfidence: integrityScore
            },
            VIVO: {
                breakoutConfirmation: isBreakoutValid,
                integrityScore: integrityScore,
                suppressOnFalseBreakout: !isBreakoutValid
            },
            confirmationSignalBridge: {
                breakoutValid: isBreakoutValid,
                integrityConfidence: integrityScore
            }
        };
    }

    identifyRiskFactors(data, integrityScore) {
        const riskFactors = [];

        if (integrityScore < 0.5) {
            riskFactors.push('low-integrity-score');
        }

        if (data.breakoutVolume && data.avgVolume && 
            data.breakoutVolume < data.avgVolume * this.config.volumeThresholds.significantIncrease) {
            riskFactors.push('insufficient-volume');
        }

        if (data.shadowSize && data.shadowSize > 0.5) {
            riskFactors.push('large-shadows');
        }

        if (data.touchCount && data.touchCount < this.config.touchValidation.minimumTouches) {
            riskFactors.push('insufficient-touches');
        }

        if (data.rsi && data.breakoutDirection) {
            if ((data.breakoutDirection === 'up' && data.rsi < 50) ||
                (data.breakoutDirection === 'down' && data.rsi > 50)) {
                riskFactors.push('rsi-divergence');
            }
        }

        return riskFactors;
    }

    getBreakoutQuality(integrityScore) {
        if (integrityScore >= 0.85) return 'excellent';
        if (integrityScore >= 0.75) return 'good';
        if (integrityScore >= 0.60) return 'moderate';
        if (integrityScore >= 0.40) return 'poor';
        return 'very-poor';
    }

    validateInput(data) {
        return data && 
               data.breakoutCandidate !== undefined &&
               data.breakoutDirection !== undefined;
    }

    createErrorOutput(message) {
        return {
            breakoutIntegrityScore: 0,
            isBreakoutValid: false,
            recommendation: 'reject',
            error: message,
            justifications: [`Error: ${message}`],
            modularRecommendations: {
                formationCompletenessJudge: { markConfirmed: false },
                entryZoneClassifier: { allowFastEntry: false },
                supportResistanceReactor: { upgradeActionToEnter: false },
                VIVO: { breakoutConfirmation: false, suppressOnFalseBreakout: true }
            },
            riskFactors: ['analysis-error']
        };
    }
}

module.exports = TrendLineIntegrityChecker;
