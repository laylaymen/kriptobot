/**
 * Grafik Beyni - Momentum Validator Module
 * 
 * Measures the strength of current price movement momentum.
 * Determines if the trend can continue or if it's losing strength.
 * Decides whether to enter/exit trades based on momentum quality.
 */

const GrafikBeyniModuleBase = require('./grafikBeyniModuleBase');

class MomentumValidator extends GrafikBeyniModuleBase {
    constructor() {
        super('momentumValidator');
        
        // Configuration for momentum validation
        this.config = {
            scoreWeights: {
                rsi: 0.25,           // RSI > 65 for bullish momentum
                macdHistogram: 0.30, // MACD histogram positive and rising
                volume: 0.20,        // Volume increase
                trendStrength: 0.15, // TrendStrength > 0.70
                momentum: 0.10       // Momentum > 1.2
            },
            thresholds: {
                strongMomentum: 0.75,    // Strong trend continuation
                moderateMomentum: 0.50,  // Worth watching
                weakMomentum: 0.50       // Suppress signals
            },
            rsiThresholds: {
                bullish: 65,
                bearish: 35
            },
            momentumThresholds: {
                strong: 1.2,
                weak: 0.8
            },
            volumeThresholds: {
                significantIncrease: 1.2
            },
            trendThresholds: {
                strong: 0.70
            }
        };
    }

    async analyze(data) {
        try {
            const startTime = Date.now();
            
            if (!this.validateInput(data)) {
                return this.createErrorOutput('Invalid input data for momentum validation');
            }

            // Analyze individual momentum components
            const rsiMomentum = this.analyzeRSIMomentum(data.rsi, data.breakoutStatus);
            const macdMomentum = this.analyzeMACDMomentum(data.macdHistogram);
            const volumeMomentum = this.analyzeVolumeMomentum(data.volume);
            const trendMomentum = this.analyzeTrendMomentum(data.trendStrength);
            const priceMomentum = this.analyzePriceMomentum(data.momentum);

            // Calculate overall momentum score
            const momentumScore = this.calculateMomentumScore(
                rsiMomentum,
                macdMomentum,
                volumeMomentum,
                trendMomentum,
                priceMomentum
            );

            // Determine momentum validity and trend
            const momentumTrend = this.determineMomentumTrend(data, momentumScore);
            const isMomentumValid = momentumScore >= this.config.thresholds.weakMomentum;

            // Generate recommendation
            const recommendation = this.generateRecommendation(momentumScore, momentumTrend);

            // Create modular recommendations
            const modularRecommendations = this.generateModularRecommendations(
                momentumScore,
                isMomentumValid,
                momentumTrend
            );

            // Identify any flags
            const flags = this.identifyFlags(data, momentumScore);

            const result = {
                momentumScore: momentumScore,
                isMomentumValid: isMomentumValid,
                momentumTrend: momentumTrend,
                recommendation: recommendation,
                modularRecommendations: modularRecommendations,
                flags: flags,
                componentAnalysis: {
                    rsi: rsiMomentum,
                    macd: macdMomentum,
                    volume: volumeMomentum,
                    trend: trendMomentum,
                    price: priceMomentum
                },
                thresholdAnalysis: {
                    isStrong: momentumScore >= this.config.thresholds.strongMomentum,
                    isModerate: momentumScore >= this.config.thresholds.moderateMomentum,
                    isWeak: momentumScore < this.config.thresholds.weakMomentum
                }
            };

            this.cacheResult(data, result);
            this.trackPerformance(startTime);

            return result;

        } catch (error) {
            this.logError('Momentum validation failed', error);
            return this.createErrorOutput(error.message);
        }
    }

    analyzeRSIMomentum(rsi, breakoutStatus) {
        if (!rsi || typeof rsi !== 'number') {
            return { score: 0, strength: 'unknown', trend: 'neutral' };
        }

        let score = 0;
        let strength = 'weak';
        let trend = 'neutral';

        // Bullish momentum check
        if (rsi >= this.config.rsiThresholds.bullish) {
            score = 0.25;
            strength = rsi > 75 ? 'very-strong' : 'strong';
            trend = 'bullish';
        }
        // Bearish momentum check
        else if (rsi <= this.config.rsiThresholds.bearish) {
            score = 0.25; // Still valid momentum, just bearish
            strength = rsi < 25 ? 'very-strong' : 'strong';
            trend = 'bearish';
        }
        // Moderate RSI (35-65)
        else if (rsi > this.config.rsiThresholds.bearish && rsi < this.config.rsiThresholds.bullish) {
            score = 0.10; // Some momentum, but not strong
            strength = 'moderate';
            trend = rsi > 50 ? 'slightly-bullish' : 'slightly-bearish';
        }

        // Bonus for confirmed breakouts
        if (breakoutStatus === 'confirmed' && score > 0) {
            score += 0.05;
            strength = 'breakout-confirmed';
        }

        return {
            score: score,
            strength: strength,
            trend: trend,
            value: rsi
        };
    }

    analyzeMACDMomentum(macdHistogram) {
        if (!macdHistogram || typeof macdHistogram !== 'number') {
            return { score: 0, trend: 'neutral', strength: 'unknown' };
        }

        let score = 0;
        let trend = 'neutral';
        let strength = 'weak';

        // Positive MACD histogram indicates bullish momentum
        if (macdHistogram > 0) {
            // Scale the score based on histogram value
            score = Math.min(0.30, macdHistogram * 0.15); // Cap at 0.30
            trend = 'bullish';
            
            if (macdHistogram > 1.5) {
                strength = 'very-strong';
            } else if (macdHistogram > 1.0) {
                strength = 'strong';
            } else {
                strength = 'moderate';
            }
        }
        // Negative MACD histogram indicates bearish momentum
        else if (macdHistogram < 0) {
            score = Math.min(0.30, Math.abs(macdHistogram) * 0.15);
            trend = 'bearish';
            
            if (macdHistogram < -1.5) {
                strength = 'very-strong';
            } else if (macdHistogram < -1.0) {
                strength = 'strong';
            } else {
                strength = 'moderate';
            }
        }

        return {
            score: score,
            trend: trend,
            strength: strength,
            value: macdHistogram
        };
    }

    analyzeVolumeMomentum(volume) {
        if (!volume || typeof volume !== 'number') {
            return { score: 0, trend: 'neutral', strength: 'unknown' };
        }

        let score = 0;
        let trend = 'neutral';
        let strength = 'weak';

        // Volume above threshold indicates strong momentum
        if (volume >= this.config.volumeThresholds.significantIncrease) {
            const volumeMultiplier = volume / this.config.volumeThresholds.significantIncrease;
            score = Math.min(0.20, volumeMultiplier * 0.10); // Cap at 0.20
            trend = 'increasing';
            
            if (volume > 2.0) {
                strength = 'very-high';
            } else if (volume > 1.5) {
                strength = 'high';
            } else {
                strength = 'moderate';
            }
        } else {
            // Low volume reduces momentum score
            score = 0.05;
            trend = 'decreasing';
            strength = 'low';
        }

        return {
            score: score,
            trend: trend,
            strength: strength,
            multiplier: volume
        };
    }

    analyzeTrendMomentum(trendStrength) {
        if (!trendStrength || typeof trendStrength !== 'number') {
            return { score: 0, strength: 'unknown', direction: 'neutral' };
        }

        let score = 0;
        let strength = 'weak';
        let direction = 'neutral';

        if (trendStrength >= this.config.trendThresholds.strong) {
            score = 0.15;
            direction = 'strong';
            
            if (trendStrength > 0.85) {
                strength = 'very-strong';
            } else {
                strength = 'strong';
            }
        } else if (trendStrength >= 0.50) {
            score = 0.10;
            strength = 'moderate';
            direction = 'moderate';
        } else {
            score = 0.02;
            strength = 'weak';
            direction = 'weak';
        }

        return {
            score: score,
            strength: strength,
            direction: direction,
            value: trendStrength
        };
    }

    analyzePriceMomentum(momentum) {
        if (!momentum || typeof momentum !== 'number') {
            return { score: 0, direction: 'neutral', strength: 'unknown' };
        }

        let score = 0;
        let direction = 'neutral';
        let strength = 'weak';

        if (momentum >= this.config.momentumThresholds.strong) {
            score = 0.10;
            direction = 'positive';
            strength = momentum > 1.5 ? 'very-strong' : 'strong';
        } else if (momentum <= this.config.momentumThresholds.weak) {
            score = 0.05; // Still some momentum, but weak
            direction = 'negative';
            strength = momentum < 0.5 ? 'very-weak' : 'weak';
        } else {
            score = 0.03;
            direction = 'neutral';
            strength = 'moderate';
        }

        return {
            score: score,
            direction: direction,
            strength: strength,
            value: momentum
        };
    }

    calculateMomentumScore(rsi, macd, volume, trend, price) {
        const weights = this.config.scoreWeights;
        
        const totalScore = 
            (rsi.score * weights.rsi) +
            (macd.score * weights.macdHistogram) +
            (volume.score * weights.volume) +
            (trend.score * weights.trendStrength) +
            (price.score * weights.momentum);

        return Math.max(0, Math.min(1, totalScore));
    }

    determineMomentumTrend(data, momentumScore) {
        // Determine overall trend based on individual components and score
        if (momentumScore >= this.config.thresholds.strongMomentum) {
            // Determine if bullish or bearish based on RSI and MACD
            if (data.rsi > 50 && data.macdHistogram > 0) {
                return 'strong-bullish';
            } else if (data.rsi < 50 && data.macdHistogram < 0) {
                return 'strong-bearish';
            } else {
                return 'bullish'; // Default to bullish for strong momentum
            }
        } else if (momentumScore >= this.config.thresholds.moderateMomentum) {
            if (data.rsi > 50) {
                return 'bullish';
            } else {
                return 'bearish';
            }
        } else {
            return 'weak';
        }
    }

    generateRecommendation(momentumScore, momentumTrend) {
        if (momentumScore >= this.config.thresholds.strongMomentum) {
            return 'continue-trend';
        } else if (momentumScore >= this.config.thresholds.moderateMomentum) {
            return 'watch-carefully';
        } else {
            return 'suppress-signals';
        }
    }

    generateModularRecommendations(momentumScore, isMomentumValid, momentumTrend) {
        return {
            tpOptimizer: {
                allowExtendedTP: momentumScore >= this.config.thresholds.strongMomentum,
                aggressiveness: momentumScore >= 0.80 ? 'high' : 
                               momentumScore >= 0.60 ? 'moderate' : 'conservative'
            },
            riskToRewardValidator: {
                increaseConfidence: momentumScore >= this.config.thresholds.strongMomentum,
                allowLowerRatio: momentumScore >= 0.85,
                requireHigherRatio: momentumScore < this.config.thresholds.moderateMomentum
            },
            VIVO: {
                momentumConfirm: isMomentumValid,
                suppressSignal: !isMomentumValid,
                priorityLevel: momentumScore >= 0.80 ? 'high' : 'normal'
            },
            exitTimingAdvisor: {
                deferExit: momentumScore >= this.config.thresholds.strongMomentum,
                prepareEarlyExit: momentumScore < this.config.thresholds.moderateMomentum,
                aggressiveness: momentumTrend.includes('strong') ? 'patient' : 'quick'
            },
            confirmationSignalBridge: {
                momentumConfidence: momentumScore,
                allowSignal: isMomentumValid
            }
        };
    }

    identifyFlags(data, momentumScore) {
        const flags = [];

        // Momentum divergence flags
        if (data.rsi > 70 && momentumScore < 0.6) {
            flags.push('rsi-momentum-divergence');
        }

        if (data.volume < 1.0 && momentumScore > 0.7) {
            flags.push('volume-momentum-mismatch');
        }

        // Trend-momentum mismatch
        if (data.trendStrength < 0.5 && momentumScore > 0.8) {
            flags.push('weak-trend-strong-momentum');
        }

        // Breakout without momentum
        if (data.breakoutStatus === 'confirmed' && momentumScore < 0.6) {
            flags.push('breakout-weak-momentum');
        }

        return flags;
    }

    validateInput(data) {
        return data && 
               (data.rsi === undefined || typeof data.rsi === 'number') &&
               (data.volume === undefined || typeof data.volume === 'number') &&
               (data.momentum === undefined || typeof data.momentum === 'number') &&
               (data.trendStrength === undefined || typeof data.trendStrength === 'number');
    }

    createErrorOutput(message) {
        return {
            momentumScore: 0,
            isMomentumValid: false,
            momentumTrend: 'error',
            recommendation: 'suppress-signals',
            error: message,
            modularRecommendations: {
                tpOptimizer: { allowExtendedTP: false },
                VIVO: { momentumConfirm: false, suppressSignal: true },
                exitTimingAdvisor: { prepareEarlyExit: true }
            },
            flags: ['analysis-error']
        };
    }
}

module.exports = MomentumValidator;
