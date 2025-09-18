/**
 * Grafik Beyni - Risk to Reward Validator Module
 * 
 * Analyzes the risk/reward ratio of potential trades before they are executed.
 * Prevents the system from opening trades with poor risk/reward ratios.
 * Only allows trades with favorable profit potential relative to stop-loss risk.
 */

const GrafikBeyniModuleBase = require('../grafikBeyniModuleBase');

class RiskToRewardValidator extends GrafikBeyniModuleBase {
    constructor() {
        super('riskToRewardValidator');
        
        // Configuration for risk/reward validation
        this.config = {
            minimumRatios: {
                strict: 2.0,      // Conservative trading
                moderate: 1.6,    // Balanced approach
                aggressive: 1.2   // High frequency trading
            },
            confidenceThresholds: {
                excellent: 3.0,   // R/R ≥ 3.0
                good: 2.0,        // R/R ≥ 2.0
                acceptable: 1.6,  // R/R ≥ 1.6
                poor: 1.6         // R/R < 1.6
            },
            trendAdjustments: {
                strongTrend: 0.2,     // Allow 0.2 lower R/R in strong trends
                weakTrend: 0.3        // Require 0.3 higher R/R in weak trends
            },
            volatilityAdjustments: {
                highVolatility: 0.3,  // Require higher R/R in volatile markets
                lowVolatility: -0.1   // Allow slightly lower R/R in stable markets
            }
        };

        // Risk assessment factors
        this.riskFactors = {
            marketVolatility: 0.25,
            trendStrength: 0.20,
            formationQuality: 0.20,
            supportResistanceDistance: 0.15,
            volumeConfirmation: 0.10,
            timeOfDay: 0.10
        };
    }

    async analyze(data) {
        try {
            const startTime = Date.now();
            
            if (!this.validateInput(data)) {
                return this.createErrorOutput('Invalid input data for risk/reward validation');
            }

            // Calculate basic risk/reward ratio
            const basicRatio = this.calculateBasicRatio(data);

            // Apply market condition adjustments
            const adjustedRatio = this.applyMarketAdjustments(basicRatio, data);

            // Determine trade validity
            const tradeValidity = this.assessTradeValidity(adjustedRatio, data);

            // Calculate confidence score
            const confidenceScore = this.calculateConfidenceScore(adjustedRatio, data);

            // Generate recommendation
            const recommendation = this.generateRecommendation(adjustedRatio, tradeValidity, data);

            // Create module-specific recommendations
            const modularRecommendations = this.generateModularRecommendations(
                adjustedRatio, 
                tradeValidity, 
                confidenceScore, 
                data
            );

            // Analyze risk factors
            const riskAnalysis = this.analyzeRiskFactors(data);

            const result = {
                riskRewardRatio: adjustedRatio.final,
                basicRatio: basicRatio.ratio,
                adjustedRatio: adjustedRatio.final,
                isTradeValid: tradeValidity.isValid,
                confidenceScore: confidenceScore,
                recommendation: recommendation,
                modularRecommendations: modularRecommendations,
                riskAnalysis: riskAnalysis,
                adjustments: adjustedRatio.adjustments,
                thresholds: {
                    used: adjustedRatio.thresholdUsed,
                    minimum: adjustedRatio.minimumRequired
                },
                tradeQualityRating: this.getRatingFromRatio(adjustedRatio.final)
            };

            this.cacheResult(data, result);
            this.trackPerformance(startTime);

            return result;

        } catch (error) {
            this.logError('Risk/reward validation failed', error);
            return this.createErrorOutput(error.message);
        }
    }

    calculateBasicRatio(data) {
        let expectedProfit = 0;
        let potentialLoss = 0;

        // Calculate expected profit (use the nearest TP level)
        if (data.tpLevels && data.tpLevels.length > 0) {
            expectedProfit = Math.min(...data.tpLevels); // Conservative: use closest TP
        } else if (data.expectedProfit) {
            expectedProfit = data.expectedProfit;
        } else {
            expectedProfit = data.resistanceDistance || 2.0; // Default estimate
        }

        // Calculate potential loss (stop loss distance)
        if (data.potentialStopLoss) {
            potentialLoss = data.potentialStopLoss;
        } else if (data.supportDistance) {
            potentialLoss = data.supportDistance;
        } else {
            potentialLoss = expectedProfit * 0.5; // Default: 50% of profit as risk
        }

        const ratio = potentialLoss > 0 ? expectedProfit / potentialLoss : 0;

        return {
            ratio: ratio,
            expectedProfit: expectedProfit,
            potentialLoss: potentialLoss,
            calculation: `${expectedProfit.toFixed(2)} / ${potentialLoss.toFixed(2)} = ${ratio.toFixed(2)}`
        };
    }

    applyMarketAdjustments(basicRatio, data) {
        let adjustedRatio = basicRatio.ratio;
        const adjustments = [];

        // Trend strength adjustment
        if (data.trendStrength !== undefined) {
            if (data.trendStrength > 0.8) {
                adjustedRatio += this.config.trendAdjustments.strongTrend;
                adjustments.push(`Strong trend: +${this.config.trendAdjustments.strongTrend}`);
            } else if (data.trendStrength < 0.5) {
                adjustedRatio -= this.config.trendAdjustments.weakTrend;
                adjustments.push(`Weak trend: -${this.config.trendAdjustments.weakTrend}`);
            }
        }

        // Volatility adjustment
        if (data.marketVolatility !== undefined) {
            if (data.marketVolatility > 0.3) {
                adjustedRatio -= this.config.volatilityAdjustments.highVolatility;
                adjustments.push(`High volatility: -${this.config.volatilityAdjustments.highVolatility}`);
            } else if (data.marketVolatility < 0.1) {
                adjustedRatio += Math.abs(this.config.volatilityAdjustments.lowVolatility);
                adjustments.push(`Low volatility: +${Math.abs(this.config.volatilityAdjustments.lowVolatility)}`);
            }
        }

        // Formation quality adjustment
        if (data.formation && data.formation !== 'none') {
            const qualityBonus = this.getFormationQualityBonus(data.formation);
            adjustedRatio += qualityBonus;
            adjustments.push(`Formation quality: +${qualityBonus}`);
        }

        // Determine threshold to use
        const thresholdType = this.selectThresholdType(data);
        const minimumRequired = this.config.minimumRatios[thresholdType];

        return {
            final: Math.max(0, adjustedRatio),
            original: basicRatio.ratio,
            adjustments: adjustments,
            thresholdUsed: thresholdType,
            minimumRequired: minimumRequired
        };
    }

    selectThresholdType(data) {
        // Select appropriate threshold based on market conditions
        if (data.trendStrength > 0.8 && data.biasDirection === 'strong-bullish') {
            return 'aggressive';
        } else if (data.trendStrength < 0.5 || data.marketVolatility > 0.3) {
            return 'strict';
        } else {
            return 'moderate';
        }
    }

    getFormationQualityBonus(formation) {
        const qualityMap = {
            'head-and-shoulders': 0.15,
            'inverse-head-and-shoulders': 0.15,
            'cup-and-handle': 0.10,
            'ascending-triangle': 0.10,
            'descending-triangle': 0.10,
            'bull-flag': 0.05,
            'bear-flag': 0.05,
            'rising-wedge': 0.05,
            'falling-wedge': 0.05
        };

        return qualityMap[formation] || 0;
    }

    assessTradeValidity(adjustedRatio, data) {
        const minimumRequired = adjustedRatio.minimumRequired;
        const isValid = adjustedRatio.final >= minimumRequired;

        const reasons = [];
        if (!isValid) {
            reasons.push(`R/R ratio ${adjustedRatio.final.toFixed(2)} below minimum ${minimumRequired}`);
        }

        // Additional validity checks
        if (data.supportDistance && data.supportDistance > data.expectedProfit) {
            reasons.push('Stop loss distance exceeds profit target');
        }

        if (data.marketVolatility > 0.5) {
            reasons.push('Market volatility too high for reliable R/R calculation');
        }

        return {
            isValid: isValid && reasons.length === 0,
            reasons: reasons,
            passesMinimum: adjustedRatio.final >= minimumRequired
        };
    }

    calculateConfidenceScore(adjustedRatio, data) {
        const ratio = adjustedRatio.final;
        let score = 0;

        // Base score from R/R ratio
        if (ratio >= this.config.confidenceThresholds.excellent) {
            score = 0.95;
        } else if (ratio >= this.config.confidenceThresholds.good) {
            score = 0.85;
        } else if (ratio >= this.config.confidenceThresholds.acceptable) {
            score = 0.70;
        } else {
            score = Math.max(0.3, ratio / this.config.confidenceThresholds.acceptable * 0.70);
        }

        // Adjust for market conditions
        if (data.trendStrength > 0.8) score += 0.05;
        if (data.volumeSpike === true) score += 0.03;
        if (data.biasDirection && data.biasDirection.includes('strong')) score += 0.02;

        return Math.min(0.98, score);
    }

    generateRecommendation(adjustedRatio, tradeValidity, data) {
        if (!tradeValidity.isValid) {
            return 'reject-trade';
        }

        const ratio = adjustedRatio.final;

        if (ratio >= this.config.confidenceThresholds.excellent) {
            return 'excellent-opportunity';
        } else if (ratio >= this.config.confidenceThresholds.good) {
            return 'good-trade';
        } else if (ratio >= this.config.confidenceThresholds.acceptable) {
            return 'acceptable-risk';
        } else {
            return 'marginal-trade';
        }
    }

    generateModularRecommendations(adjustedRatio, tradeValidity, confidenceScore, data) {
        const ratio = adjustedRatio.final;

        return {
            VIVO: {
                confirmationThreshold: ratio >= 2.0 ? 1 : 2,
                allowSignal: tradeValidity.isValid,
                priorityLevel: ratio >= 3.0 ? 'high' : 'normal'
            },
            tpOptimizer: {
                aggressiveness: ratio >= 2.5 ? 'aggressive' : ratio >= 2.0 ? 'moderate' : 'conservative',
                allowExtendedTargets: ratio >= 2.0,
                multipleTPLevels: ratio >= 2.5
            },
            entryZoneClassifier: {
                approve: tradeValidity.isValid,
                requireBetterEntry: ratio < 2.0,
                stricterCriteria: ratio < 1.8
            },
            exitTimingAdvisor: {
                allowEarlyExit: ratio < 2.0,
                extendHoldTime: ratio >= 2.5,
                riskManagement: ratio < 1.8 ? 'strict' : 'normal'
            },
            formationCompletenessJudge: {
                requireHigherConfidence: ratio < 2.0,
                allowLowerConfidence: ratio >= 3.0
            }
        };
    }

    analyzeRiskFactors(data) {
        const factors = [];
        let totalRisk = 0;

        // Market volatility risk
        if (data.marketVolatility > 0.3) {
            factors.push({ factor: 'High market volatility', weight: 0.3, impact: 'negative' });
            totalRisk += 0.3;
        }

        // Trend strength risk
        if (data.trendStrength < 0.5) {
            factors.push({ factor: 'Weak trend strength', weight: 0.2, impact: 'negative' });
            totalRisk += 0.2;
        }

        // Formation quality risk
        if (!data.formation || data.formation === 'none') {
            factors.push({ factor: 'No clear formation', weight: 0.15, impact: 'negative' });
            totalRisk += 0.15;
        }

        // Volume confirmation risk
        if (data.volumeSpike === false) {
            factors.push({ factor: 'No volume confirmation', weight: 0.1, impact: 'negative' });
            totalRisk += 0.1;
        }

        // Support/resistance distance risk
        if (data.supportDistance && data.resistanceDistance) {
            const asymmetry = Math.abs(data.supportDistance - data.resistanceDistance) / 
                             Math.max(data.supportDistance, data.resistanceDistance);
            if (asymmetry > 0.5) {
                factors.push({ factor: 'Asymmetric support/resistance', weight: 0.1, impact: 'negative' });
                totalRisk += 0.1;
            }
        }

        return {
            totalRiskScore: Math.min(1.0, totalRisk),
            riskLevel: totalRisk > 0.5 ? 'high' : totalRisk > 0.3 ? 'medium' : 'low',
            factors: factors
        };
    }

    getRatingFromRatio(ratio) {
        if (ratio >= 3.0) return 'excellent';
        if (ratio >= 2.5) return 'very-good';
        if (ratio >= 2.0) return 'good';
        if (ratio >= 1.6) return 'acceptable';
        return 'poor';
    }

    validateInput(data) {
        return data && 
               (data.expectedProfit || data.tpLevels || data.resistanceDistance) &&
               (data.potentialStopLoss || data.supportDistance);
    }

    createErrorOutput(message) {
        return {
            riskRewardRatio: 0,
            isTradeValid: false,
            confidenceScore: 0,
            recommendation: 'error',
            error: message,
            modularRecommendations: {
                VIVO: { allowSignal: false },
                tpOptimizer: { aggressiveness: 'conservative' },
                entryZoneClassifier: { approve: false },
                exitTimingAdvisor: { riskManagement: 'strict' }
            }
        };
    }
}

module.exports = RiskToRewardValidator;
