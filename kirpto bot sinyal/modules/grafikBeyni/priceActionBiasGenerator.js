/**
 * Grafik Beyni - Price Action Bias Generator Module
 * 
 * Analyzes recent price behavior (candle patterns, wick lengths, volume changes, breakout aggression)
 * to determine whether the system should have a bullish or bearish bias.
 * Provides directional framework for VIVO and signal modules.
 */

const GrafikBeyniModuleBase = require('./grafikBeyniModuleBase');

class PriceActionBiasGenerator extends GrafikBeyniModuleBase {
    constructor() {
        super('priceActionBiasGenerator');
        
        // Configuration for bias generation
        this.config = {
            biasScoreThresholds: {
                strongBullish: 0.80,
                moderateBullish: 0.60,
                neutral: 0.40,
                moderateBearish: 0.40,
                strongBearish: 0.20
            },
            weightings: {
                rsiDirection: 0.25,
                volumeChange: 0.20,
                momentum: 0.20,
                candlePatterns: 0.20,
                breakoutStrength: 0.15
            },
            rsiThresholds: {
                bullish: 55,
                bearish: 45
            },
            volumeThresholds: {
                significantIncrease: 1.3,
                significantDecrease: 0.7
            },
            momentumThresholds: {
                strong: 0.03,
                weak: -0.03
            }
        };

        // Candle pattern recognition
        this.candlePatterns = this.initializeCandlePatterns();
    }

    async analyze(data) {
        try {
            const startTime = Date.now();
            
            if (!this.validateInput(data)) {
                return this.createErrorOutput('Invalid input data for price action bias generation');
            }

            // Analyze individual components
            const rsiAnalysis = this.analyzeRSIDirection(data.rsi);
            const volumeAnalysis = this.analyzeVolumeChange(data.volumeChange);
            const momentumAnalysis = this.analyzeMomentum(data.priceMomentum);
            const candleAnalysis = this.analyzeCandlePatterns(data.candlePatterns);
            const breakoutAnalysis = this.analyzeBreakoutStrength(data.previousBreakoutStrength);

            // Calculate overall bias score
            const biasScore = this.calculateBiasScore(
                rsiAnalysis,
                volumeAnalysis,
                momentumAnalysis,
                candleAnalysis,
                breakoutAnalysis
            );

            // Determine bias direction
            const biasDirection = this.determineBiasDirection(biasScore);

            // Identify supporting signals and risk factors
            const supportingSignals = this.identifySupportingSignals(data, biasDirection);
            const riskFactors = this.identifyRiskFactors(data);

            // Generate recommended action
            const recommendedAction = this.generateRecommendedAction(biasScore, biasDirection, riskFactors);

            // Create module-specific outputs
            const outputForModules = this.generateModuleOutputs(biasDirection, biasScore, data);

            const result = {
                biasDirection: biasDirection,
                biasScore: biasScore,
                supportingSignals: supportingSignals,
                riskFactors: riskFactors,
                recommendedAction: recommendedAction,
                outputForModules: outputForModules,
                componentAnalysis: {
                    rsi: rsiAnalysis,
                    volume: volumeAnalysis,
                    momentum: momentumAnalysis,
                    candles: candleAnalysis,
                    breakout: breakoutAnalysis
                }
            };

            this.cacheResult(data, result);
            this.trackPerformance(startTime);

            return result;

        } catch (error) {
            this.logError('Price action bias generation failed', error);
            return this.createErrorOutput(error.message);
        }
    }

    initializeCandlePatterns() {
        return {
            bullish: [
                'bullish-engulfing',
                'hammer',
                'morning-star',
                'piercing-line',
                'long-lower-wick'
            ],
            bearish: [
                'bearish-engulfing',
                'shooting-star',
                'evening-star',
                'dark-cloud-cover',
                'long-upper-wick'
            ],
            neutral: [
                'doji',
                'spinning-top',
                'small-body'
            ]
        };
    }

    analyzeRSIDirection(rsi) {
        if (!rsi || typeof rsi !== 'number') {
            return { score: 0.5, direction: 'neutral', strength: 'unknown' };
        }

        let score = 0.5; // Neutral baseline
        let direction = 'neutral';
        let strength = 'weak';

        if (rsi > this.config.rsiThresholds.bullish) {
            const excess = rsi - this.config.rsiThresholds.bullish;
            score = 0.5 + (excess / (100 - this.config.rsiThresholds.bullish)) * 0.5;
            direction = 'bullish';
            strength = rsi > 70 ? 'strong' : 'moderate';
        } else if (rsi < this.config.rsiThresholds.bearish) {
            const shortfall = this.config.rsiThresholds.bearish - rsi;
            score = 0.5 - (shortfall / this.config.rsiThresholds.bearish) * 0.5;
            direction = 'bearish';
            strength = rsi < 30 ? 'strong' : 'moderate';
        }

        return {
            score: Math.max(0, Math.min(1, score)),
            direction: direction,
            strength: strength,
            value: rsi
        };
    }

    analyzeVolumeChange(volumeChange) {
        if (!volumeChange || typeof volumeChange !== 'number') {
            return { score: 0.5, trend: 'neutral', strength: 'unknown' };
        }

        let score = 0.5;
        let trend = 'neutral';
        let strength = 'weak';

        if (volumeChange >= this.config.volumeThresholds.significantIncrease) {
            const excess = volumeChange - 1;
            score = 0.5 + Math.min(excess * 0.5, 0.5); // Cap at 1.0
            trend = 'increasing';
            strength = volumeChange > 2 ? 'strong' : 'moderate';
        } else if (volumeChange <= this.config.volumeThresholds.significantDecrease) {
            const deficit = 1 - volumeChange;
            score = 0.5 - Math.min(deficit * 0.5, 0.5); // Floor at 0.0
            trend = 'decreasing';
            strength = volumeChange < 0.5 ? 'strong' : 'moderate';
        }

        return {
            score: Math.max(0, Math.min(1, score)),
            trend: trend,
            strength: strength,
            multiplier: volumeChange
        };
    }

    analyzeMomentum(momentum) {
        if (!momentum || typeof momentum !== 'number') {
            return { score: 0.5, direction: 'neutral', strength: 'unknown' };
        }

        let score = 0.5;
        let direction = 'neutral';
        let strength = 'weak';

        if (momentum > this.config.momentumThresholds.strong) {
            score = 0.5 + Math.min(momentum * 10, 0.5); // Scale momentum to bias
            direction = 'positive';
            strength = momentum > 0.05 ? 'strong' : 'moderate';
        } else if (momentum < this.config.momentumThresholds.weak) {
            score = 0.5 + Math.max(momentum * 10, -0.5); // Negative momentum
            direction = 'negative';
            strength = momentum < -0.05 ? 'strong' : 'moderate';
        }

        return {
            score: Math.max(0, Math.min(1, score)),
            direction: direction,
            strength: strength,
            value: momentum
        };
    }

    analyzeCandlePatterns(candlePatterns) {
        if (!candlePatterns || !Array.isArray(candlePatterns)) {
            return { score: 0.5, bias: 'neutral', patterns: [] };
        }

        let bullishCount = 0;
        let bearishCount = 0;
        const recognizedPatterns = [];

        candlePatterns.forEach(pattern => {
            if (this.candlePatterns.bullish.includes(pattern)) {
                bullishCount++;
                recognizedPatterns.push({ pattern, bias: 'bullish' });
            } else if (this.candlePatterns.bearish.includes(pattern)) {
                bearishCount++;
                recognizedPatterns.push({ pattern, bias: 'bearish' });
            } else if (this.candlePatterns.neutral.includes(pattern)) {
                recognizedPatterns.push({ pattern, bias: 'neutral' });
            }
        });

        const totalSignificant = bullishCount + bearishCount;
        let score = 0.5;
        let bias = 'neutral';

        if (totalSignificant > 0) {
            score = (bullishCount / totalSignificant);
            bias = bullishCount > bearishCount ? 'bullish' : 
                   bearishCount > bullishCount ? 'bearish' : 'neutral';
        }

        return {
            score: score,
            bias: bias,
            patterns: recognizedPatterns,
            bullishCount: bullishCount,
            bearishCount: bearishCount
        };
    }

    analyzeBreakoutStrength(breakoutStrength) {
        if (!breakoutStrength || typeof breakoutStrength !== 'number') {
            return { score: 0.5, strength: 'unknown', reliability: 'low' };
        }

        const score = Math.max(0, Math.min(1, breakoutStrength));
        let strength = 'weak';
        let reliability = 'low';

        if (breakoutStrength > 0.8) {
            strength = 'very-strong';
            reliability = 'high';
        } else if (breakoutStrength > 0.6) {
            strength = 'strong';
            reliability = 'moderate';
        } else if (breakoutStrength > 0.4) {
            strength = 'moderate';
            reliability = 'moderate';
        }

        return {
            score: score,
            strength: strength,
            reliability: reliability,
            value: breakoutStrength
        };
    }

    calculateBiasScore(rsi, volume, momentum, candles, breakout) {
        const weights = this.config.weightings;
        
        let totalScore = 0;
        totalScore += rsi.score * weights.rsiDirection;
        totalScore += volume.score * weights.volumeChange;
        totalScore += momentum.score * weights.momentum;
        totalScore += candles.score * weights.candlePatterns;
        totalScore += breakout.score * weights.breakoutStrength;

        return Math.max(0, Math.min(1, totalScore));
    }

    determineBiasDirection(biasScore) {
        const thresholds = this.config.biasScoreThresholds;

        if (biasScore >= thresholds.strongBullish) {
            return 'strong-bullish';
        } else if (biasScore >= thresholds.moderateBullish) {
            return 'bullish';
        } else if (biasScore <= thresholds.strongBearish) {
            return 'strong-bearish';
        } else if (biasScore <= thresholds.moderateBearish) {
            return 'bearish';
        } else {
            return 'neutral';
        }
    }

    identifySupportingSignals(data, biasDirection) {
        const signals = [];

        // RSI support
        if (biasDirection.includes('bullish') && data.rsi > this.config.rsiThresholds.bullish) {
            signals.push(`RSI > ${this.config.rsiThresholds.bullish}`);
        } else if (biasDirection.includes('bearish') && data.rsi < this.config.rsiThresholds.bearish) {
            signals.push(`RSI < ${this.config.rsiThresholds.bearish}`);
        }

        // Volume support
        if (data.volumeChange > this.config.volumeThresholds.significantIncrease) {
            signals.push('Volume rising');
        }

        // Momentum support
        if (data.priceMomentum > this.config.momentumThresholds.strong) {
            signals.push(`Momentum > ${this.config.momentumThresholds.strong}`);
        }

        // Candle pattern support
        if (data.candlePatterns && data.candlePatterns.length > 0) {
            const bullishPatterns = data.candlePatterns.filter(p => 
                this.candlePatterns.bullish.includes(p));
            const bearishPatterns = data.candlePatterns.filter(p => 
                this.candlePatterns.bearish.includes(p));

            if (biasDirection.includes('bullish') && bullishPatterns.length > 0) {
                signals.push('Bullish candle pattern');
            } else if (biasDirection.includes('bearish') && bearishPatterns.length > 0) {
                signals.push('Bearish candle pattern');
            }
        }

        return signals;
    }

    identifyRiskFactors(data) {
        const risks = [];

        // Volatility spike
        if (data.volatilitySpike === true) {
            risks.push('volatilitySpike');
        }

        // Conflicting RSI
        if (data.rsi > 70) {
            risks.push('RSI overbought');
        } else if (data.rsi < 30) {
            risks.push('RSI oversold');
        }

        // Low volume
        if (data.volumeChange < this.config.volumeThresholds.significantDecrease) {
            risks.push('Volume declining');
        }

        // ATR expansion (high volatility)
        if (data.atr && data.atr > 200) { // Assuming ATR values
            risks.push('High volatility (ATR)');
        }

        return risks;
    }

    generateRecommendedAction(biasScore, biasDirection, riskFactors) {
        if (riskFactors.length >= 2) {
            return 'wait-for-clarity';
        }

        if (biasDirection.includes('strong')) {
            return 'act-on-signals';
        } else if (biasDirection !== 'neutral') {
            return 'watch-for-confirmation';
        } else {
            return 'remain-neutral';
        }
    }

    generateModuleOutputs(biasDirection, biasScore, data) {
        return {
            VIVO: {
                direction: biasDirection.includes('bullish') ? 'buy-bias' : 
                          biasDirection.includes('bearish') ? 'sell-bias' : 'neutral',
                biasScore: biasScore,
                confidence: biasDirection.includes('strong') ? 'high' : 'moderate'
            },
            riskToRewardValidator: {
                favorLongEntry: biasDirection.includes('bullish'),
                favorShortEntry: biasDirection.includes('bearish'),
                biasStrength: biasScore
            },
            exitTimingAdvisor: {
                deferShortExit: biasDirection.includes('bullish'),
                deferLongExit: biasDirection.includes('bearish'),
                aggressiveness: biasDirection.includes('strong') ? 'high' : 'moderate'
            },
            formationCompletenessJudge: {
                biasAlignment: biasDirection !== 'neutral',
                requiredConfidence: biasDirection.includes('strong') ? 0.70 : 0.80
            }
        };
    }

    validateInput(data) {
        return data && 
               (data.rsi === undefined || typeof data.rsi === 'number') &&
               (data.volumeChange === undefined || typeof data.volumeChange === 'number') &&
               (data.priceMomentum === undefined || typeof data.priceMomentum === 'number');
    }

    createErrorOutput(message) {
        return {
            biasDirection: 'neutral',
            biasScore: 0.5,
            supportingSignals: [],
            riskFactors: [`Error: ${message}`],
            recommendedAction: 'wait',
            outputForModules: {
                VIVO: { direction: 'neutral', biasScore: 0.5 },
                riskToRewardValidator: { favorLongEntry: false, favorShortEntry: false },
                exitTimingAdvisor: { deferShortExit: false, deferLongExit: false }
            }
        };
    }
}

module.exports = PriceActionBiasGenerator;
