/**
 * Grafik Beyni - Formation Completeness Judge Module
 * 
 * Evaluates whether a detected formation is truly mature and ready for trading.
 * Prevents the system from opening trades on incomplete formations.
 * Acts as a second validation layer against fake breakouts.
 */

const GrafikBeyniModuleBase = require('../grafikBeyniModuleBase');

class FormationCompletenessJudge extends GrafikBeyniModuleBase {
    constructor() {
        super('formationCompletenessJudge');
        
        // Configuration for formation completeness validation
        this.config = {
            completenessThresholds: {
                structureCompletenessScore: 0.80,
                patternSymmetryScore: 0.85,
                volumeSpike: true,
                fakeoutRiskScore: 0.30 // Should be below this
            },
            rsiRequirements: {
                bullish: { min: 60 },
                bearish: { max: 45 }
            },
            waitTimeEstimates: {
                incomplete: '5–15 min',
                forming: '10–30 min',
                nearComplete: '2–10 min'
            },
            actionThresholds: {
                readyToTrade: 0.85,
                needsWatching: 0.70,
                tooEarly: 0.50
            }
        };
    }

    async analyze(data) {
        try {
            const startTime = Date.now();
            
            if (!this.validateInput(data)) {
                return this.createErrorOutput('Invalid input data for formation completeness evaluation');
            }

            // Analyze formation structure completeness
            const structureAnalysis = this.analyzeStructureCompleteness(data);

            // Evaluate pattern symmetry and quality
            const symmetryAnalysis = this.evaluatePatternSymmetry(data);

            // Check volume confirmation
            const volumeAnalysis = this.analyzeVolumeConfirmation(data);

            // Assess RSI alignment
            const rsiAnalysis = this.assessRSIAlignment(data);

            // Calculate fake-out risk
            const fakeoutRisk = this.calculateFakeoutRisk(data);

            // Determine overall completeness score
            const completenessScore = this.calculateCompletenessScore(
                structureAnalysis,
                symmetryAnalysis,
                volumeAnalysis,
                rsiAnalysis,
                fakeoutRisk
            );

            // Make formation readiness decision
            const readinessDecision = this.makeReadinessDecision(completenessScore, data);

            // Generate implications for other modules
            const implications = this.generateModuleImplications(readinessDecision, data);

            const result = {
                formationReady: readinessDecision.isReady,
                reason: readinessDecision.reason,
                completenessScore: completenessScore,
                waitTimeEstimate: readinessDecision.waitTime,
                action: readinessDecision.action,
                structureCompleteness: structureAnalysis.score,
                patternSymmetry: symmetryAnalysis.score,
                volumeConfirmation: volumeAnalysis.confirmed,
                rsiAlignment: rsiAnalysis.aligned,
                fakeoutRiskScore: fakeoutRisk.score,
                implications: implications,
                detailedAnalysis: {
                    structure: structureAnalysis,
                    symmetry: symmetryAnalysis,
                    volume: volumeAnalysis,
                    rsi: rsiAnalysis,
                    fakeoutRisk: fakeoutRisk
                }
            };

            this.cacheResult(data, result);
            this.trackPerformance(startTime);

            return result;

        } catch (error) {
            this.logError('Formation completeness evaluation failed', error);
            return this.createErrorOutput(error.message);
        }
    }

    analyzeStructureCompleteness(data) {
        let score = 0;
        const factors = [];

        // Check if formation type has necessary structural elements
        if (data.formationType && data.formationType !== 'none') {
            score += 0.3;
            factors.push('Formation type identified');
        }

        // Check breakout trigger status
        if (data.breakoutTrigger === true) {
            score += 0.3;
            factors.push('Breakout trigger active');
        } else if (data.breakoutTrigger === false) {
            factors.push('Breakout trigger not active');
        }

        // Check trend alignment
        if (data.trendAlignment === true) {
            score += 0.2;
            factors.push('Trend alignment confirmed');
        }

        // Check confidence score
        if (data.confidenceScore && data.confidenceScore > 0.75) {
            score += 0.2;
            factors.push('High confidence formation');
        } else if (data.confidenceScore && data.confidenceScore > 0.65) {
            score += 0.1;
            factors.push('Moderate confidence formation');
        }

        return {
            score: Math.min(score, 1.0),
            factors: factors,
            isComplete: score >= this.config.completenessThresholds.structureCompletenessScore
        };
    }

    evaluatePatternSymmetry(data) {
        let score = 0;
        const factors = [];

        // Use provided symmetry score if available
        if (data.patternSymmetryScore !== undefined) {
            score = data.patternSymmetryScore;
            factors.push(`Pattern symmetry: ${(score * 100).toFixed(1)}%`);
        } else {
            // Estimate symmetry based on formation type and confidence
            switch (data.formationType) {
                case 'ascending-triangle':
                case 'descending-triangle':
                    score = 0.85; // Triangles typically have good symmetry
                    factors.push('Triangle formation - good symmetry expected');
                    break;
                case 'head-and-shoulders':
                case 'inverse-head-and-shoulders':
                    score = data.confidenceScore || 0.7; // H&S symmetry varies
                    factors.push('H&S formation - symmetry varies');
                    break;
                case 'cup-and-handle':
                    score = 0.80; // Cup usually symmetric
                    factors.push('Cup formation - generally symmetric');
                    break;
                default:
                    score = data.confidenceScore || 0.75;
                    factors.push('Default symmetry estimation');
            }
        }

        return {
            score: score,
            factors: factors,
            isAcceptable: score >= this.config.completenessThresholds.patternSymmetryScore
        };
    }

    analyzeVolumeConfirmation(data) {
        let confirmed = false;
        const factors = [];

        // Check for volume spike
        if (data.volumeSpike === true) {
            confirmed = true;
            factors.push('Volume spike confirmed');
        } else if (data.volumeSpike === false) {
            factors.push('Volume spike missing');
        }

        // Check volume trend if available
        if (data.volumeTrend) {
            if (data.volumeTrend === 'increasing') {
                confirmed = true;
                factors.push('Volume trend increasing');
            } else if (data.volumeTrend === 'decreasing') {
                factors.push('Volume trend decreasing');
            }
        }

        return {
            confirmed: confirmed,
            factors: factors,
            meetsRequirement: confirmed === this.config.completenessThresholds.volumeSpike
        };
    }

    assessRSIAlignment(data) {
        let aligned = false;
        const factors = [];

        if (!data.rsi) {
            return {
                aligned: true, // Default to true if no RSI data
                factors: ['No RSI data available'],
                meetsRequirement: true
            };
        }

        const rsi = data.rsi;
        const bullishFormations = ['ascending-triangle', 'bull-flag', 'cup-and-handle', 'inverse-head-and-shoulders'];
        const bearishFormations = ['descending-triangle', 'bear-flag', 'head-and-shoulders', 'rising-wedge'];

        if (bullishFormations.includes(data.formationType)) {
            aligned = rsi >= this.config.rsiRequirements.bullish.min;
            factors.push(`Bullish formation: RSI ${rsi} ${aligned ? '≥' : '<'} ${this.config.rsiRequirements.bullish.min}`);
        } else if (bearishFormations.includes(data.formationType)) {
            aligned = rsi <= this.config.rsiRequirements.bearish.max;
            factors.push(`Bearish formation: RSI ${rsi} ${aligned ? '≤' : '>'} ${this.config.rsiRequirements.bearish.max}`);
        } else {
            aligned = true; // Neutral formations
            factors.push('Neutral formation - RSI requirement waived');
        }

        return {
            aligned: aligned,
            factors: factors,
            meetsRequirement: aligned
        };
    }

    calculateFakeoutRisk(data) {
        let riskScore = 0;
        const riskFactors = [];

        // High volume reduces fake-out risk
        if (data.volumeSpike === false) {
            riskScore += 0.3;
            riskFactors.push('No volume spike increases fake-out risk');
        }

        // Low confidence increases fake-out risk
        if (data.confidenceScore && data.confidenceScore < 0.7) {
            riskScore += 0.2;
            riskFactors.push('Low confidence increases fake-out risk');
        }

        // Weak trend increases fake-out risk
        if (data.trendStrength && data.trendStrength < 0.6) {
            riskScore += 0.25;
            riskFactors.push('Weak trend increases fake-out risk');
        }

        // No breakout trigger increases fake-out risk
        if (data.breakoutTrigger === false) {
            riskScore += 0.15;
            riskFactors.push('No breakout trigger increases fake-out risk');
        }

        // RSI misalignment increases fake-out risk
        const rsiAnalysis = this.assessRSIAlignment(data);
        if (!rsiAnalysis.aligned) {
            riskScore += 0.1;
            riskFactors.push('RSI misalignment increases fake-out risk');
        }

        return {
            score: Math.min(riskScore, 1.0),
            factors: riskFactors,
            isAcceptable: riskScore <= this.config.completenessThresholds.fakeoutRiskScore
        };
    }

    calculateCompletenessScore(structure, symmetry, volume, rsi, fakeout) {
        let score = 0;

        // Structure completeness (40%)
        score += structure.score * 0.40;

        // Pattern symmetry (25%)
        score += symmetry.score * 0.25;

        // Volume confirmation (20%)
        if (volume.confirmed) score += 0.20;

        // RSI alignment (10%)
        if (rsi.aligned) score += 0.10;

        // Fake-out risk penalty (5%)
        if (fakeout.isAcceptable) score += 0.05;

        return Math.min(score, 1.0);
    }

    makeReadinessDecision(completenessScore, data) {
        const thresholds = this.config.actionThresholds;

        if (completenessScore >= thresholds.readyToTrade) {
            return {
                isReady: true,
                action: 'proceed',
                waitTime: 'immediate',
                reason: 'Formation is complete and ready for trading'
            };
        } else if (completenessScore >= thresholds.needsWatching) {
            return {
                isReady: false,
                action: 'wait-and-watch',
                waitTime: this.config.waitTimeEstimates.nearComplete,
                reason: 'Formation nearly complete - wait for final confirmation'
            };
        } else if (completenessScore >= thresholds.tooEarly) {
            return {
                isReady: false,
                action: 'wait',
                waitTime: this.config.waitTimeEstimates.forming,
                reason: 'Formation still developing - patience required'
            };
        } else {
            return {
                isReady: false,
                action: 'ignore',
                waitTime: this.config.waitTimeEstimates.incomplete,
                reason: 'Formation too early or unreliable'
            };
        }
    }

    generateModuleImplications(decision, data) {
        const implications = {};

        // VIVO implications
        implications.VIVO = {
            suppressSignal: !decision.isReady,
            waitForConfirmation: decision.action === 'wait-and-watch'
        };

        // exitTimingAdvisor implications
        implications.exitTimingAdvisor = {
            deferCountdown: !decision.isReady,
            extendWatchTime: decision.action === 'wait-and-watch'
        };

        // tpOptimizer implications
        implications.tpOptimizer = {
            pauseGeneration: !decision.isReady,
            requireHigherConfidence: decision.action === 'wait'
        };

        // riskToRewardValidator implications
        implications.riskToRewardValidator = {
            applyStricterCriteria: !decision.isReady,
            requireBetterRatio: decision.action === 'wait'
        };

        return implications;
    }

    validateInput(data) {
        return data && 
               data.formationType &&
               typeof data.breakoutTrigger === 'boolean' &&
               typeof data.confidenceScore === 'number';
    }

    createErrorOutput(message) {
        return {
            formationReady: false,
            reason: `Error: ${message}`,
            completenessScore: 0,
            waitTimeEstimate: 'unknown',
            action: 'error',
            implications: {
                VIVO: { suppressSignal: true },
                exitTimingAdvisor: { deferCountdown: true },
                tpOptimizer: { pauseGeneration: true }
            }
        };
    }
}

module.exports = FormationCompletenessJudge;
