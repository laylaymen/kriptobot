/**
 * Grafik Beyni - Price Deviation Scanner Module
 * 
 * Analyzes how much price has deviated from key averages (EMA21, EMA50, Bollinger Bands).
 * Prevents entries when price is overextended and likely to reverse.
 * Helps maintain disciplined entries by avoiding FOMO situations.
 */

const GrafikBeyniModuleBase = require('../grafikBeyniModuleBase');

class PriceDeviationScanner extends GrafikBeyniModuleBase {
    constructor() {
        super('priceDeviationScanner');
        
        // Configuration for price deviation analysis
        this.config = {
            deviationThresholds: {
                ema21: {
                    minor: 0.015,      // 1.5% deviation is minor
                    moderate: 0.025,   // 2.5% is moderate
                    critical: 0.040    // 4.0% is critical
                },
                ema50: {
                    minor: 0.020,      // 2.0% deviation is minor
                    moderate: 0.035,   // 3.5% is moderate
                    critical: 0.055    // 5.5% is critical
                },
                bollinger: {
                    outsideUpper: 0.30,    // Being outside upper band
                    outsideLower: 0.30,    // Being outside lower band
                    nearBands: 0.15        // Being very close to bands
                }
            },
            scoreWeights: {
                ema21Deviation: 0.30,      // EMA21 is most important
                ema50Deviation: 0.25,      // EMA50 secondary
                bollingerDeviation: 0.25,  // Bollinger band position
                atrMomentumRatio: 0.20     // ATR vs momentum analysis
            },
            criticalThreshold: 0.75,       // Above this = deviation is critical
            moderateThreshold: 0.50,       // Above this = be cautious
            momentumTolerance: 1.2,        // If momentum > 1.2, allow some deviation
            atrVolatilityFactor: 2.0       // ATR multiplier for volatility adjustment
        };
    }

    async analyze(data) {
        try {
            const startTime = Date.now();
            
            if (!this.validateInput(data)) {
                return this.createErrorOutput('Invalid input data for price deviation scanning');
            }

            // Calculate individual deviation components
            const ema21Analysis = this.analyzeEMA21Deviation(data.price, data.ema21);
            const ema50Analysis = this.analyzeEMA50Deviation(data.price, data.ema50);
            const bollingerAnalysis = this.analyzeBollingerDeviation(
                data.price, 
                data.bollingerUpper, 
                data.bollingerLower
            );
            const atrMomentumAnalysis = this.analyzeATRMomentumRatio(
                data.atr, 
                data.momentum, 
                data.direction
            );

            // Calculate overall deviation score
            const deviationScore = this.calculateDeviationScore(
                ema21Analysis,
                ema50Analysis,
                bollingerAnalysis,
                atrMomentumAnalysis
            );

            // Determine if deviation is critical
            const isDeviationCritical = deviationScore >= this.config.criticalThreshold;
            const recommendation = this.generateRecommendation(deviationScore, data.momentum);

            // Generate detailed analysis
            const deviationBreakdown = this.generateDeviationBreakdown(
                ema21Analysis,
                ema50Analysis,
                bollingerAnalysis,
                atrMomentumAnalysis
            );

            // Create modular recommendations
            const modularRecommendations = this.generateModularRecommendations(
                isDeviationCritical,
                deviationScore,
                data
            );

            const result = {
                deviationScore: deviationScore,
                isDeviationCritical: isDeviationCritical,
                recommendation: recommendation,
                deviationBreakdown: deviationBreakdown,
                modularRecommendations: modularRecommendations,
                componentAnalysis: {
                    ema21: ema21Analysis,
                    ema50: ema50Analysis,
                    bollinger: bollingerAnalysis,
                    atrMomentum: atrMomentumAnalysis
                },
                riskFactors: this.identifyRiskFactors(deviationScore, data),
                alert: this.generateAlert(isDeviationCritical, deviationScore, data)
            };

            this.cacheResult(data, result);
            this.trackPerformance(startTime);

            return result;

        } catch (error) {
            this.logError('Price deviation scanning failed', error);
            return this.createErrorOutput(error.message);
        }
    }

    analyzeEMA21Deviation(price, ema21) {
        if (!price || !ema21 || ema21 <= 0) {
            return { score: 0, deviation: 0, level: 'unknown', direction: 'none' };
        }

        const deviation = Math.abs(price - ema21) / ema21;
        const direction = price > ema21 ? 'above' : 'below';
        
        let score = 0;
        let level = 'normal';

        if (deviation >= this.config.deviationThresholds.ema21.critical) {
            score = 1.0;
            level = 'critical';
        } else if (deviation >= this.config.deviationThresholds.ema21.moderate) {
            score = 0.7;
            level = 'moderate';
        } else if (deviation >= this.config.deviationThresholds.ema21.minor) {
            score = 0.4;
            level = 'minor';
        } else {
            score = 0.1;
            level = 'normal';
        }

        return {
            score: score * this.config.scoreWeights.ema21Deviation,
            deviation: deviation,
            level: level,
            direction: direction,
            percentage: deviation * 100
        };
    }

    analyzeEMA50Deviation(price, ema50) {
        if (!price || !ema50 || ema50 <= 0) {
            return { score: 0, deviation: 0, level: 'unknown', direction: 'none' };
        }

        const deviation = Math.abs(price - ema50) / ema50;
        const direction = price > ema50 ? 'above' : 'below';
        
        let score = 0;
        let level = 'normal';

        if (deviation >= this.config.deviationThresholds.ema50.critical) {
            score = 1.0;
            level = 'critical';
        } else if (deviation >= this.config.deviationThresholds.ema50.moderate) {
            score = 0.7;
            level = 'moderate';
        } else if (deviation >= this.config.deviationThresholds.ema50.minor) {
            score = 0.4;
            level = 'minor';
        } else {
            score = 0.1;
            level = 'normal';
        }

        return {
            score: score * this.config.scoreWeights.ema50Deviation,
            deviation: deviation,
            level: level,
            direction: direction,
            percentage: deviation * 100
        };
    }

    analyzeBollingerDeviation(price, upperBand, lowerBand) {
        if (!price || !upperBand || !lowerBand || upperBand <= lowerBand) {
            return { score: 0, position: 'unknown', level: 'normal' };
        }

        const bandWidth = upperBand - lowerBand;
        const midPoint = (upperBand + lowerBand) / 2;
        
        let score = 0;
        let position = 'middle';
        let level = 'normal';

        if (price > upperBand) {
            // Price above upper band
            const deviation = (price - upperBand) / bandWidth;
            score = this.config.deviationThresholds.bollinger.outsideUpper + (deviation * 0.3);
            position = 'above-upper';
            level = 'critical';
        } else if (price < lowerBand) {
            // Price below lower band
            const deviation = (lowerBand - price) / bandWidth;
            score = this.config.deviationThresholds.bollinger.outsideLower + (deviation * 0.3);
            position = 'below-lower';
            level = 'critical';
        } else {
            // Price within bands
            const distanceFromMid = Math.abs(price - midPoint) / (bandWidth / 2);
            
            if (distanceFromMid > 0.8) {
                score = this.config.deviationThresholds.bollinger.nearBands;
                position = price > midPoint ? 'near-upper' : 'near-lower';
                level = 'moderate';
            } else if (distanceFromMid > 0.6) {
                score = 0.1;
                position = price > midPoint ? 'upper-middle' : 'lower-middle';
                level = 'minor';
            } else {
                score = 0;
                position = 'middle';
                level = 'normal';
            }
        }

        return {
            score: Math.min(score, 1.0) * this.config.scoreWeights.bollingerDeviation,
            position: position,
            level: level,
            distanceFromUpper: upperBand - price,
            distanceFromLower: price - lowerBand,
            bandWidth: bandWidth
        };
    }

    analyzeATRMomentumRatio(atr, momentum, direction) {
        if (!atr || !momentum) {
            return { score: 0, analysis: 'insufficient-data', adjustment: 0 };
        }

        let score = 0;
        let analysis = 'balanced';
        let adjustment = 0;

        // High ATR with high momentum is acceptable (volatile but trending)
        if (atr > 150 && momentum > this.config.momentumTolerance) {
            score = 0.1; // Reduce penalty due to strong momentum
            analysis = 'high-volatility-strong-momentum';
            adjustment = -0.1; // Slight reduction in overall deviation score
        }
        // High ATR with low momentum is concerning
        else if (atr > 150 && momentum < 1.0) {
            score = 0.8;
            analysis = 'high-volatility-weak-momentum';
            adjustment = 0.1; // Increase overall deviation concern
        }
        // Normal ATR with strong momentum
        else if (atr <= 150 && momentum > this.config.momentumTolerance) {
            score = 0;
            analysis = 'normal-volatility-strong-momentum';
            adjustment = -0.05; // Slight bonus for good conditions
        }
        // Normal conditions
        else {
            score = 0.2;
            analysis = 'normal-conditions';
            adjustment = 0;
        }

        return {
            score: score * this.config.scoreWeights.atrMomentumRatio,
            analysis: analysis,
            adjustment: adjustment,
            atr: atr,
            momentum: momentum,
            isVolatile: atr > 150
        };
    }

    calculateDeviationScore(ema21, ema50, bollinger, atrMomentum) {
        let totalScore = ema21.score + ema50.score + bollinger.score + atrMomentum.score;
        
        // Apply ATR momentum adjustment
        totalScore += atrMomentum.adjustment;
        
        // Ensure score stays within bounds
        return Math.max(0, Math.min(1, totalScore));
    }

    generateRecommendation(deviationScore, momentum) {
        if (deviationScore >= this.config.criticalThreshold) {
            return 'watch-or-delay';
        } else if (deviationScore >= this.config.moderateThreshold) {
            // Check if momentum can override moderate deviation
            if (momentum && momentum > this.config.momentumTolerance) {
                return 'cautious-proceed';
            } else {
                return 'reduce-position-size';
            }
        } else {
            return 'proceed-normal';
        }
    }

    generateDeviationBreakdown(ema21, ema50, bollinger, atrMomentum) {
        const breakdown = [];

        if (ema21.level !== 'normal') {
            breakdown.push(`Price ${ema21.percentage.toFixed(1)}% ${ema21.direction} EMA21 (${ema21.level})`);
        }

        if (ema50.level !== 'normal') {
            breakdown.push(`Price ${ema50.percentage.toFixed(1)}% ${ema50.direction} EMA50 (${ema50.level})`);
        }

        if (bollinger.level !== 'normal') {
            breakdown.push(`Price ${bollinger.position.replace('-', ' ')} (${bollinger.level})`);
        }

        if (atrMomentum.analysis !== 'normal-conditions') {
            breakdown.push(`${atrMomentum.analysis.replace('-', ' ')}`);
        }

        return breakdown;
    }

    generateModularRecommendations(isDeviationCritical, deviationScore, data) {
        return {
            entryZoneClassifier: {
                delayEntry: isDeviationCritical,
                reduceZoneScore: deviationScore > this.config.moderateThreshold,
                deviationPenalty: deviationScore
            },
            riskZoneDefender: {
                amplifyRisk: isDeviationCritical,
                increaseRiskScore: deviationScore > this.config.moderateThreshold,
                deviationRiskFactor: deviationScore
            },
            confirmationSignalBridge: {
                reduceSignalConfidence: isDeviationCritical,
                requireAdditionalConfirmations: deviationScore > this.config.moderateThreshold,
                deviationScore: deviationScore
            },
            tpOptimizer: {
                useConservativeTargets: isDeviationCritical,
                shortenTP: deviationScore > this.config.moderateThreshold,
                deviationAdjustment: deviationScore
            },
            momentumValidator: {
                requireStrongerMomentum: isDeviationCritical,
                momentumThreshold: this.config.momentumTolerance + (deviationScore * 0.3)
            },
            formationCompletenessJudge: {
                disableDeviationPenalty: data.momentum > this.config.momentumTolerance,
                allowOverride: data.momentum > 1.4 && deviationScore < 0.9
            }
        };
    }

    identifyRiskFactors(deviationScore, data) {
        const riskFactors = [];

        if (deviationScore >= this.config.criticalThreshold) {
            riskFactors.push('critical-price-deviation');
        }

        if (data.price && data.ema21 && Math.abs(data.price - data.ema21) / data.ema21 > 0.03) {
            riskFactors.push('overextended-from-ema21');
        }

        if (data.bollingerUpper && data.price > data.bollingerUpper) {
            riskFactors.push('price-above-bollinger-upper');
        }

        if (data.bollingerLower && data.price < data.bollingerLower) {
            riskFactors.push('price-below-bollinger-lower');
        }

        if (data.atr > 200 && (!data.momentum || data.momentum < 1.1)) {
            riskFactors.push('high-volatility-weak-momentum');
        }

        return riskFactors;
    }

    generateAlert(isDeviationCritical, deviationScore, data) {
        if (isDeviationCritical) {
            return 'Price deviated heavily from EMA/Bollinger — entry delayed';
        } else if (deviationScore > this.config.moderateThreshold) {
            return 'Moderate price deviation detected — proceed with caution';
        } else {
            return 'Price deviation within normal range';
        }
    }

    validateInput(data) {
        return data && 
               data.price !== undefined && 
               data.price > 0;
    }

    createErrorOutput(message) {
        return {
            deviationScore: 1.0, // Max risk when error
            isDeviationCritical: true,
            recommendation: 'watch-or-delay',
            error: message,
            deviationBreakdown: [`Error: ${message}`],
            modularRecommendations: {
                entryZoneClassifier: { delayEntry: true },
                riskZoneDefender: { amplifyRisk: true },
                confirmationSignalBridge: { reduceSignalConfidence: true }
            },
            riskFactors: ['analysis-error'],
            alert: 'Error in deviation analysis — avoid entry'
        };
    }
}

module.exports = PriceDeviationScanner;
