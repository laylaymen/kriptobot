/**
 * Grafik Beyni - Trend Line Validator Module
 * 
 * Validates the quality and reliability of trend lines drawn by the system or users.
 * Checks touch points, deviation levels, RSI correlation, momentum alignment,
 * and breakout characteristics to determine if a trend line is valid.
 */

const GrafikBeyniModuleBase = require('../grafikBeyniModuleBase');

class TrendLineValidator extends GrafikBeyniModuleBase {
    constructor() {
        super('trendLineValidator');
        
        // Configuration for trend line validation
        this.config = {
            scoreWeights: {
                touchPoints: 0.25,         // Number of touch points
                avgDeviation: 0.20,        // Average price deviation from line
                rsiTrendCorrelation: 0.20, // RSI correlation with trend
                breakoutVolumeRatio: 0.15, // Volume on breakout
                momentum: 0.10,            // Overall momentum alignment
                breakoutAngle: 0.10        // Angle of breakout
            },
            thresholds: {
                validTrend: 0.75,          // Trend line is valid
                weakTrend: 0.50,           // Trend line is weak but usable
                invalidTrend: 0.25,        // Trend line should be ignored
                minTouchPoints: 3,         // Minimum touches for validity
                maxDeviation: 1.0,         // Max avg deviation (%)
                minRSICorrelation: 0.60,   // Min RSI correlation
                minMomentum: 0.90,         // Min momentum for trend support
                optimalAngleMin: 30,       // Optimal breakout angle range
                optimalAngleMax: 50
            },
            deviationLimits: {
                excellent: 0.5,            // < 0.5% deviation = excellent
                good: 0.8,                 // < 0.8% deviation = good
                acceptable: 1.0,           // < 1.0% deviation = acceptable
                poor: 1.5                  // > 1.5% deviation = poor
            },
            touchPointBonus: {
                3: 0.6,    // 3 touches = base score
                4: 0.8,    // 4 touches = good
                5: 1.0,    // 5+ touches = excellent
                6: 1.0     // Cap at 5 touches
            }
        };
    }

    async analyze(data) {
        try {
            const startTime = Date.now();
            
            if (!this.validateInput(data)) {
                return this.createErrorOutput('Invalid input data for trend line validation');
            }

            // Analyze individual validation components
            const touchAnalysis = this.analyzeTouchPoints(data.touchPoints);
            const deviationAnalysis = this.analyzeAvgDeviation(data.avgDeviation);
            const rsiAnalysis = this.analyzeRSITrendCorrelation(data.rsiTrendCorrelation);
            const volumeAnalysis = this.analyzeBreakoutVolumeRatio(data.breakoutVolumeRatio);
            const momentumAnalysis = this.analyzeMomentumScore(data.momentumScore);
            const angleAnalysis = this.analyzeBreakoutAngle(data.breakoutAngle);

            // Calculate overall trend score
            const trendScore = this.calculateTrendScore(
                touchAnalysis,
                deviationAnalysis,
                rsiAnalysis,
                volumeAnalysis,
                momentumAnalysis,
                angleAnalysis
            );

            // Determine trend validity
            const trendValid = trendScore >= this.config.thresholds.validTrend;
            const recommendation = this.generateRecommendation(trendScore);

            // Generate quality assessment
            const qualityAssessment = this.generateQualityAssessment(
                trendScore,
                touchAnalysis,
                deviationAnalysis,
                rsiAnalysis
            );

            // Create modular recommendations
            const modularRecommendations = this.generateModularRecommendations(
                trendValid,
                trendScore,
                data
            );

            const result = {
                trendValid: trendValid,
                trendScore: trendScore,
                recommendation: recommendation,
                qualityAssessment: qualityAssessment,
                modularRecommendations: modularRecommendations,
                componentAnalysis: {
                    touchPoints: touchAnalysis,
                    avgDeviation: deviationAnalysis,
                    rsiTrendCorrelation: rsiAnalysis,
                    breakoutVolumeRatio: volumeAnalysis,
                    momentumScore: momentumAnalysis,
                    breakoutAngle: angleAnalysis
                },
                validationCriteria: this.getValidationCriteria(trendScore),
                alert: this.generateAlert(trendValid, trendScore, data.trendType),
                strengthLevel: this.getTrendStrengthLevel(trendScore)
            };

            this.cacheResult(data, result);
            this.trackPerformance(startTime);

            return result;

        } catch (error) {
            this.logError('Trend line validation failed', error);
            return this.createErrorOutput(error.message);
        }
    }

    analyzeTouchPoints(touchPoints) {
        const count = touchPoints || 0;
        const minRequired = this.config.thresholds.minTouchPoints;
        
        let score = 0;
        let analysis = 'insufficient-touches';
        let quality = 'poor';

        if (count >= 6) {
            score = this.config.touchPointBonus[6];
            analysis = 'excellent-touch-count';
            quality = 'excellent';
        } else if (count >= 5) {
            score = this.config.touchPointBonus[5];
            analysis = 'very-good-touch-count';
            quality = 'very-good';
        } else if (count >= 4) {
            score = this.config.touchPointBonus[4];
            analysis = 'good-touch-count';
            quality = 'good';
        } else if (count >= 3) {
            score = this.config.touchPointBonus[3];
            analysis = 'minimum-touch-count';
            quality = 'minimum';
        } else {
            score = 0.2;
            analysis = 'insufficient-touches';
            quality = 'poor';
        }

        return {
            score: score * this.config.scoreWeights.touchPoints,
            count: count,
            required: minRequired,
            analysis: analysis,
            quality: quality,
            isAdequate: count >= minRequired
        };
    }

    analyzeAvgDeviation(avgDeviation) {
        const deviation = avgDeviation || 0;
        
        let score = 0;
        let analysis = 'unknown-deviation';
        let quality = 'unknown';

        if (deviation <= this.config.deviationLimits.excellent) {
            score = 1.0;
            analysis = 'excellent-price-adherence';
            quality = 'excellent';
        } else if (deviation <= this.config.deviationLimits.good) {
            score = 0.8;
            analysis = 'good-price-adherence';
            quality = 'good';
        } else if (deviation <= this.config.deviationLimits.acceptable) {
            score = 0.6;
            analysis = 'acceptable-price-adherence';
            quality = 'acceptable';
        } else if (deviation <= this.config.deviationLimits.poor) {
            score = 0.3;
            analysis = 'poor-price-adherence';
            quality = 'poor';
        } else {
            score = 0.1;
            analysis = 'very-poor-price-adherence';
            quality = 'very-poor';
        }

        return {
            score: score * this.config.scoreWeights.avgDeviation,
            deviation: deviation,
            analysis: analysis,
            quality: quality,
            isAcceptable: deviation <= this.config.thresholds.maxDeviation
        };
    }

    analyzeRSITrendCorrelation(rsiTrendCorrelation) {
        const correlation = rsiTrendCorrelation || 0.5;
        const minCorrelation = this.config.thresholds.minRSICorrelation;
        
        let score = 0;
        let analysis = 'poor-rsi-correlation';
        let alignment = 'poor';

        if (correlation >= 0.85) {
            score = 1.0;
            analysis = 'excellent-rsi-correlation';
            alignment = 'excellent';
        } else if (correlation >= 0.75) {
            score = 0.8;
            analysis = 'good-rsi-correlation';
            alignment = 'good';
        } else if (correlation >= minCorrelation) {
            score = 0.6;
            analysis = 'adequate-rsi-correlation';
            alignment = 'adequate';
        } else if (correlation >= 0.45) {
            score = 0.3;
            analysis = 'weak-rsi-correlation';
            alignment = 'weak';
        } else {
            score = 0.1;
            analysis = 'poor-rsi-correlation';
            alignment = 'poor';
        }

        return {
            score: score * this.config.scoreWeights.rsiTrendCorrelation,
            correlation: correlation,
            analysis: analysis,
            alignment: alignment,
            isAligned: correlation >= minCorrelation
        };
    }

    analyzeBreakoutVolumeRatio(breakoutVolumeRatio) {
        const ratio = breakoutVolumeRatio || 1.0;
        
        let score = 0;
        let analysis = 'no-volume-confirmation';
        let strength = 'none';

        if (ratio >= 2.0) {
            score = 1.0;
            analysis = 'excellent-breakout-volume';
            strength = 'very-strong';
        } else if (ratio >= 1.6) {
            score = 0.8;
            analysis = 'strong-breakout-volume';
            strength = 'strong';
        } else if (ratio >= 1.3) {
            score = 0.6;
            analysis = 'adequate-breakout-volume';
            strength = 'adequate';
        } else if (ratio >= 1.1) {
            score = 0.4;
            analysis = 'weak-breakout-volume';
            strength = 'weak';
        } else {
            score = 0.1;
            analysis = 'no-volume-confirmation';
            strength = 'none';
        }

        return {
            score: score * this.config.scoreWeights.breakoutVolumeRatio,
            ratio: ratio,
            analysis: analysis,
            strength: strength,
            hasConfirmation: ratio >= 1.3
        };
    }

    analyzeMomentumScore(momentumScore) {
        const momentum = momentumScore || 1.0;
        const minMomentum = this.config.thresholds.minMomentum;
        
        let score = 0;
        let analysis = 'weak-momentum';
        let direction = 'uncertain';

        if (momentum >= 1.20) {
            score = 1.0;
            analysis = 'very-strong-momentum';
            direction = 'strong-trend-support';
        } else if (momentum >= 1.10) {
            score = 0.8;
            analysis = 'strong-momentum';
            direction = 'trend-support';
        } else if (momentum >= 1.05) {
            score = 0.6;
            analysis = 'moderate-momentum';
            direction = 'mild-trend-support';
        } else if (momentum >= minMomentum) {
            score = 0.4;
            analysis = 'weak-momentum';
            direction = 'minimal-support';
        } else {
            score = 0.1;
            analysis = 'no-momentum-support';
            direction = 'against-trend';
        }

        return {
            score: score * this.config.scoreWeights.momentum,
            momentum: momentum,
            analysis: analysis,
            direction: direction,
            supportsTrend: momentum >= minMomentum
        };
    }

    analyzeBreakoutAngle(breakoutAngle) {
        if (!breakoutAngle || breakoutAngle <= 0) {
            return {
                score: 0,
                angle: 0,
                analysis: 'no-breakout-angle',
                quality: 'unknown',
                isOptimal: false
            };
        }

        const angle = breakoutAngle;
        const optimalMin = this.config.thresholds.optimalAngleMin;
        const optimalMax = this.config.thresholds.optimalAngleMax;
        
        let score = 0;
        let analysis = 'poor-breakout-angle';
        let quality = 'poor';

        if (angle >= optimalMin && angle <= optimalMax) {
            score = 1.0;
            analysis = 'optimal-breakout-angle';
            quality = 'optimal';
        } else if ((angle >= optimalMin - 10 && angle < optimalMin) || 
                   (angle > optimalMax && angle <= optimalMax + 10)) {
            score = 0.7;
            analysis = 'good-breakout-angle';
            quality = 'good';
        } else if (angle >= 15 && angle <= 65) {
            score = 0.5;
            analysis = 'acceptable-breakout-angle';
            quality = 'acceptable';
        } else {
            score = 0.2;
            analysis = angle < 15 ? 'too-shallow-angle' : 'too-steep-angle';
            quality = 'poor';
        }

        return {
            score: score * this.config.scoreWeights.breakoutAngle,
            angle: angle,
            analysis: analysis,
            quality: quality,
            isOptimal: score >= 0.7
        };
    }

    calculateTrendScore(touch, deviation, rsi, volume, momentum, angle) {
        const totalScore = 
            touch.score +
            deviation.score +
            rsi.score +
            volume.score +
            momentum.score +
            angle.score;

        return Math.max(0, Math.min(1, totalScore));
    }

    generateRecommendation(trendScore) {
        if (trendScore >= this.config.thresholds.validTrend) {
            return 'trend-confirmed';
        } else if (trendScore >= this.config.thresholds.weakTrend) {
            return 'trend-weak-but-usable';
        } else {
            return 'trend-invalid';
        }
    }

    generateQualityAssessment(trendScore, touch, deviation, rsi) {
        const strengths = [];
        const weaknesses = [];

        if (touch.quality === 'excellent' || touch.quality === 'very-good') {
            strengths.push('Multiple confirmation touches');
        } else if (touch.quality === 'poor') {
            weaknesses.push('Insufficient touch points');
        }

        if (deviation.quality === 'excellent' || deviation.quality === 'good') {
            strengths.push('Tight price adherence');
        } else if (deviation.quality === 'poor' || deviation.quality === 'very-poor') {
            weaknesses.push('High price deviation');
        }

        if (rsi.alignment === 'excellent' || rsi.alignment === 'good') {
            strengths.push('Strong RSI correlation');
        } else if (rsi.alignment === 'poor' || rsi.alignment === 'weak') {
            weaknesses.push('Poor RSI alignment');
        }

        return {
            overallQuality: this.getTrendStrengthLevel(trendScore),
            strengths: strengths,
            weaknesses: weaknesses,
            reliability: trendScore >= 0.75 ? 'high' : trendScore >= 0.50 ? 'moderate' : 'low'
        };
    }

    generateModularRecommendations(trendValid, trendScore, data) {
        return {
            trendConfidenceEvaluator: {
                boostConfidence: trendValid,
                trendStrength: trendScore,
                validationComplete: true
            },
            formationCompletenessJudge: {
                allowDependency: trendValid,
                trendSupport: trendScore,
                trendQuality: this.getTrendStrengthLevel(trendScore)
            },
            tpOptimizer: {
                enableWiderTP: trendValid && trendScore > 0.8,
                trendValidation: trendScore,
                allowTrendBasedTargets: trendValid
            },
            exitTimingAdvisor: {
                trendBreakoutExpected: trendValid,
                trendStrength: trendScore,
                monitorTrendLine: trendValid
            },
            supportResistanceReactor: {
                trendLineSupport: trendValid,
                trendReliability: trendScore
            },
            confirmationSignalBridge: {
                trendValidationBonus: trendValid ? 0.2 : 0,
                trendQuality: trendScore
            },
            VIVO: {
                trendLineValid: trendValid,
                trendStrength: trendScore,
                trendType: data.trendType
            }
        };
    }

    getValidationCriteria(trendScore) {
        return {
            passedValidation: trendScore >= this.config.thresholds.validTrend,
            score: trendScore,
            criteriaBreakdown: {
                touchPoints: 'Adequate number of price touches',
                priceAdherence: 'Low deviation from trend line',
                rsiAlignment: 'RSI confirms trend direction',
                volumeConfirmation: 'Breakout supported by volume',
                momentumSupport: 'Momentum aligns with trend',
                angleOptimization: 'Breakout angle is reasonable'
            }
        };
    }

    generateAlert(trendValid, trendScore, trendType) {
        const trendDirection = trendType || 'trend';
        
        if (trendValid) {
            return `Valid ${trendDirection} line detected — signal supported`;
        } else if (trendScore >= this.config.thresholds.weakTrend) {
            return `Weak ${trendDirection} line detected — use with caution`;
        } else {
            return `Invalid ${trendDirection} line detected — signal rejected`;
        }
    }

    getTrendStrengthLevel(trendScore) {
        if (trendScore >= 0.90) return 'excellent';
        if (trendScore >= 0.80) return 'very-good';
        if (trendScore >= 0.70) return 'good';
        if (trendScore >= 0.60) return 'moderate';
        if (trendScore >= 0.50) return 'weak';
        return 'poor';
    }

    validateInput(data) {
        return data && 
               data.touchPoints !== undefined &&
               data.trendType !== undefined;
    }

    createErrorOutput(message) {
        return {
            trendValid: false,
            trendScore: 0,
            recommendation: 'trend-invalid',
            error: message,
            modularRecommendations: {
                trendConfidenceEvaluator: { boostConfidence: false },
                formationCompletenessJudge: { allowDependency: false },
                VIVO: { trendLineValid: false }
            },
            validationCriteria: { passedValidation: false },
            alert: 'Error in trend line validation'
        };
    }

    // Public methods for other modules
    isTrendLineReliable(trendScore) {
        return trendScore >= this.config.thresholds.validTrend;
    }

    getTrendLineQuality(trendScore) {
        return this.getTrendStrengthLevel(trendScore);
    }

    validateTrendLineQuick(touchPoints, avgDeviation) {
        const hasEnoughTouches = touchPoints >= this.config.thresholds.minTouchPoints;
        const hasLowDeviation = avgDeviation <= this.config.thresholds.maxDeviation;
        return hasEnoughTouches && hasLowDeviation;
    }
}

module.exports = TrendLineValidator;
