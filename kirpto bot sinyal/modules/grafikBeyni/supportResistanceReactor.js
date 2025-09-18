/**
 * Grafik Beyni - Support Resistance Reactor Module
 * 
 * Determines how to react when price approaches support or resistance levels.
 * Analyzes whether a level is likely to hold (bounce) or break (breakout).
 * Provides strategic guidance for positioning around key levels.
 */

const GrafikBeyniModuleBase = require('../grafikBeyniModuleBase');

class SupportResistanceReactor extends GrafikBeyniModuleBase {
    constructor() {
        super('supportResistanceReactor');
        
        // Configuration for support/resistance reaction analysis
        this.config = {
            scoreWeights: {
                zoneStrength: 0.25,        // Historical importance of level
                breakoutVolume: 0.25,      // Volume supporting breakout
                rsiMomentum: 0.15,         // RSI alignment with direction
                momentum: 0.15,            // Overall momentum
                previousReactions: 0.10,   // Historical behavior at level
                formationContext: 0.10     // Formation that led to this level
            },
            thresholds: {
                strongReaction: 0.75,      // High confidence in reaction type
                moderateReaction: 0.50,    // Moderate confidence
                weakReaction: 0.25,        // Low confidence
                volumeSignificance: 1.4,   // 40% above average = significant
                proximityThreshold: 0.005  // 0.5% distance to be "at level"
            },
            rsiLevels: {
                oversold: 30,
                overbought: 70,
                neutral: 50
            },
            reactionTypes: {
                bounce: 'bounce',          // Expect price to reverse at level
                breakout: 'breakout',      // Expect price to break through
                uncertain: 'uncertain'     // Not enough data to decide
            }
        };
    }

    async analyze(data) {
        try {
            const startTime = Date.now();
            
            if (!this.validateInput(data)) {
                return this.createErrorOutput('Invalid input data for support/resistance reaction');
            }

            // Determine proximity to the zone
            const proximityAnalysis = this.analyzeProximityToZone(data.price, data.distanceToZone);
            
            // Only proceed if price is near the zone
            if (!proximityAnalysis.isNearZone) {
                return this.createDistantOutput(proximityAnalysis);
            }

            // Analyze different reaction factors
            const zoneAnalysis = this.analyzeZoneStrength(data.zoneStrength, data.zoneType);
            const volumeAnalysis = this.analyzeBreakoutVolume(data.breakoutVolume, data.avgVolume);
            const rsiAnalysis = this.analyzeRSIAlignment(data.rsi, data.zoneType);
            const momentumAnalysis = this.analyzeMomentumDirection(data.momentum, data.zoneType);
            const historyAnalysis = this.analyzePreviousReactions(data.previousReactions);
            const contextAnalysis = this.analyzeFormationContext(data.reactionContext);

            // Calculate overall reaction confidence
            const reactionConfidence = this.calculateReactionConfidence(
                zoneAnalysis,
                volumeAnalysis,
                rsiAnalysis,
                momentumAnalysis,
                historyAnalysis,
                contextAnalysis
            );

            // Determine expected reaction type
            const expectedReaction = this.determineReactionType(
                reactionConfidence,
                zoneAnalysis,
                volumeAnalysis,
                data.zoneType
            );

            // Generate action recommendation
            const actionRecommendation = this.generateActionRecommendation(
                expectedReaction,
                reactionConfidence,
                data.zoneType
            );

            // Create modular recommendations
            const modularRecommendations = this.generateModularRecommendations(
                expectedReaction,
                reactionConfidence,
                actionRecommendation,
                data
            );

            const result = {
                expectedReaction: expectedReaction,
                reactionConfidence: reactionConfidence,
                actionRecommendation: actionRecommendation,
                modularRecommendations: modularRecommendations,
                componentAnalysis: {
                    zone: zoneAnalysis,
                    volume: volumeAnalysis,
                    rsi: rsiAnalysis,
                    momentum: momentumAnalysis,
                    history: historyAnalysis,
                    context: contextAnalysis,
                    proximity: proximityAnalysis
                },
                riskFactors: this.identifyRiskFactors(expectedReaction, reactionConfidence, data),
                alert: this.generateAlert(expectedReaction, reactionConfidence, data.zoneType),
                strategicGuidance: this.generateStrategicGuidance(expectedReaction, reactionConfidence, data)
            };

            this.cacheResult(data, result);
            this.trackPerformance(startTime);

            return result;

        } catch (error) {
            this.logError('Support/resistance reaction analysis failed', error);
            return this.createErrorOutput(error.message);
        }
    }

    analyzeProximityToZone(price, distanceToZone) {
        const distancePercent = Math.abs(distanceToZone) / 100; // Assuming distance in basis points
        const isNearZone = distancePercent <= this.config.thresholds.proximityThreshold;
        
        return {
            isNearZone: isNearZone,
            distancePercent: distancePercent,
            urgency: isNearZone ? 'immediate' : 'watch',
            timeToZone: isNearZone ? 'at-zone' : 'approaching'
        };
    }

    analyzeZoneStrength(zoneStrength, zoneType) {
        const strength = zoneStrength || 0.5;
        
        let score = 0;
        let analysis = 'weak-zone';
        let expectedBehavior = 'uncertain';

        if (strength >= 0.85) {
            score = 1.0;
            analysis = 'very-strong-zone';
            expectedBehavior = zoneType === 'resistance' ? 'strong-rejection' : 'strong-support';
        } else if (strength >= 0.70) {
            score = 0.8;
            analysis = 'strong-zone';
            expectedBehavior = zoneType === 'resistance' ? 'likely-rejection' : 'likely-support';
        } else if (strength >= 0.50) {
            score = 0.5;
            analysis = 'moderate-zone';
            expectedBehavior = 'moderate-reaction';
        } else {
            score = 0.2;
            analysis = 'weak-zone';
            expectedBehavior = 'breakout-likely';
        }

        return {
            score: score * this.config.scoreWeights.zoneStrength,
            strength: strength,
            analysis: analysis,
            expectedBehavior: expectedBehavior,
            zoneType: zoneType
        };
    }

    analyzeBreakoutVolume(breakoutVolume, avgVolume) {
        if (!breakoutVolume || !avgVolume || avgVolume <= 0) {
            return {
                score: 0,
                ratio: 1.0,
                analysis: 'insufficient-volume-data',
                supportsBreakout: false
            };
        }

        const volumeRatio = breakoutVolume / avgVolume;
        let score = 0;
        let analysis = 'normal-volume';
        let supportsBreakout = false;

        if (volumeRatio >= this.config.thresholds.volumeSignificance * 1.5) {
            score = 1.0;
            analysis = 'very-high-volume';
            supportsBreakout = true;
        } else if (volumeRatio >= this.config.thresholds.volumeSignificance) {
            score = 0.8;
            analysis = 'high-volume';
            supportsBreakout = true;
        } else if (volumeRatio >= 1.0) {
            score = 0.4;
            analysis = 'normal-volume';
            supportsBreakout = false;
        } else {
            score = 0.1;
            analysis = 'low-volume';
            supportsBreakout = false;
        }

        return {
            score: score * this.config.scoreWeights.breakoutVolume,
            ratio: volumeRatio,
            analysis: analysis,
            supportsBreakout: supportsBreakout,
            breakoutVolume: breakoutVolume,
            avgVolume: avgVolume
        };
    }

    analyzeRSIAlignment(rsi, zoneType) {
        if (!rsi) {
            return {
                score: 0,
                analysis: 'rsi-unavailable',
                alignment: 'unknown',
                rsi: 0
            };
        }

        let score = 0;
        let analysis = 'neutral';
        let alignment = 'neutral';

        if (zoneType === 'resistance') {
            // At resistance, overbought RSI suggests rejection
            if (rsi >= this.config.rsiLevels.overbought) {
                score = 1.0;
                analysis = 'overbought-at-resistance';
                alignment = 'supports-rejection';
            } else if (rsi >= 60) {
                score = 0.6;
                analysis = 'elevated-at-resistance';
                alignment = 'mild-rejection-bias';
            } else if (rsi >= this.config.rsiLevels.neutral) {
                score = 0.3;
                analysis = 'neutral-at-resistance';
                alignment = 'uncertain';
            } else {
                score = 0.1;
                analysis = 'oversold-at-resistance';
                alignment = 'supports-breakout';
            }
        } else if (zoneType === 'support') {
            // At support, oversold RSI suggests bounce
            if (rsi <= this.config.rsiLevels.oversold) {
                score = 1.0;
                analysis = 'oversold-at-support';
                alignment = 'supports-bounce';
            } else if (rsi <= 40) {
                score = 0.6;
                analysis = 'low-at-support';
                alignment = 'mild-bounce-bias';
            } else if (rsi <= this.config.rsiLevels.neutral) {
                score = 0.3;
                analysis = 'neutral-at-support';
                alignment = 'uncertain';
            } else {
                score = 0.1;
                analysis = 'overbought-at-support';
                alignment = 'supports-breakdown';
            }
        }

        return {
            score: score * this.config.scoreWeights.rsiMomentum,
            analysis: analysis,
            alignment: alignment,
            rsi: rsi
        };
    }

    analyzeMomentumDirection(momentum, zoneType) {
        if (!momentum) {
            return {
                score: 0,
                analysis: 'momentum-unavailable',
                direction: 'unknown',
                momentum: 0
            };
        }

        let score = 0;
        let analysis = 'weak-momentum';
        let direction = 'uncertain';

        if (momentum > 1.3) {
            score = 1.0;
            analysis = 'very-strong-momentum';
            direction = 'supports-breakout';
        } else if (momentum > 1.1) {
            score = 0.7;
            analysis = 'strong-momentum';
            direction = 'leans-breakout';
        } else if (momentum > 0.9) {
            score = 0.4;
            analysis = 'moderate-momentum';
            direction = 'uncertain';
        } else {
            score = 0.1;
            analysis = 'weak-momentum';
            direction = 'supports-reversal';
        }

        return {
            score: score * this.config.scoreWeights.momentum,
            analysis: analysis,
            direction: direction,
            momentum: momentum
        };
    }

    analyzePreviousReactions(previousReactions) {
        if (!previousReactions || previousReactions.length === 0) {
            return {
                score: 0,
                analysis: 'no-history',
                pattern: 'unknown',
                reactionCount: 0
            };
        }

        const totalReactions = previousReactions.length;
        const rejections = previousReactions.filter(r => r === 'rejection').length;
        const breakouts = previousReactions.filter(r => r === 'breakout').length;
        
        const rejectionRate = rejections / totalReactions;
        
        let score = 0;
        let analysis = 'mixed-history';
        let pattern = 'inconsistent';

        if (rejectionRate >= 0.8) {
            score = 0.9;
            analysis = 'strong-rejection-history';
            pattern = 'reliable-level';
        } else if (rejectionRate >= 0.6) {
            score = 0.6;
            analysis = 'moderate-rejection-history';
            pattern = 'tends-to-hold';
        } else if (rejectionRate <= 0.2) {
            score = 0.3;
            analysis = 'breakout-history';
            pattern = 'weak-level';
        } else {
            score = 0.4;
            analysis = 'mixed-history';
            pattern = 'inconsistent';
        }

        return {
            score: score * this.config.scoreWeights.previousReactions,
            analysis: analysis,
            pattern: pattern,
            reactionCount: totalReactions,
            rejectionRate: rejectionRate,
            breakoutRate: breakouts / totalReactions
        };
    }

    analyzeFormationContext(reactionContext) {
        if (!reactionContext) {
            return {
                score: 0,
                analysis: 'no-formation-context',
                contextStrength: 'unknown'
            };
        }

        let score = 0;
        let analysis = 'unknown-formation';
        let contextStrength = 'weak';

        // Map formation types to breakout likelihood
        const formationBreakoutBias = {
            'bull-flag': 0.8,
            'bear-flag': 0.8,
            'ascending-triangle': 0.7,
            'descending-triangle': 0.7,
            'symmetrical-triangle': 0.5,
            'wedge': 0.6,
            'rectangle': 0.4,
            'head-shoulders': 0.8,
            'inverse-head-shoulders': 0.8
        };

        const breakoutBias = formationBreakoutBias[reactionContext] || 0.5;
        
        if (breakoutBias >= 0.7) {
            score = 0.8;
            analysis = 'strong-breakout-formation';
            contextStrength = 'strong';
        } else if (breakoutBias >= 0.5) {
            score = 0.5;
            analysis = 'neutral-formation';
            contextStrength = 'moderate';
        } else {
            score = 0.2;
            analysis = 'weak-breakout-formation';
            contextStrength = 'weak';
        }

        return {
            score: score * this.config.scoreWeights.formationContext,
            analysis: analysis,
            contextStrength: contextStrength,
            formationType: reactionContext,
            breakoutBias: breakoutBias
        };
    }

    calculateReactionConfidence(zone, volume, rsi, momentum, history, context) {
        const totalScore = 
            zone.score +
            volume.score +
            rsi.score +
            momentum.score +
            history.score +
            context.score;

        return Math.max(0, Math.min(1, totalScore));
    }

    determineReactionType(confidence, zoneAnalysis, volumeAnalysis, zoneType) {
        // High volume + strong momentum typically means breakout
        if (volumeAnalysis.supportsBreakout && confidence > 0.7) {
            return this.config.reactionTypes.breakout;
        }
        
        // Very strong zone with low confidence suggests bounce
        if (zoneAnalysis.strength > 0.8 && confidence < 0.6) {
            return this.config.reactionTypes.bounce;
        }
        
        // Use confidence level and zone strength to decide
        if (confidence >= this.config.thresholds.strongReaction) {
            if (zoneAnalysis.strength > 0.7) {
                return this.config.reactionTypes.bounce;
            } else {
                return this.config.reactionTypes.breakout;
            }
        } else if (confidence >= this.config.thresholds.moderateReaction) {
            // Moderate confidence - lean towards zone strength
            return zoneAnalysis.strength > 0.6 ? 
                this.config.reactionTypes.bounce : 
                this.config.reactionTypes.breakout;
        } else {
            return this.config.reactionTypes.uncertain;
        }
    }

    generateActionRecommendation(expectedReaction, confidence, zoneType) {
        if (expectedReaction === this.config.reactionTypes.breakout) {
            if (zoneType === 'resistance') {
                return confidence > 0.75 ? 'prepare-long-entry' : 'watch-for-breakout';
            } else {
                return confidence > 0.75 ? 'prepare-short-entry' : 'watch-for-breakdown';
            }
        } else if (expectedReaction === this.config.reactionTypes.bounce) {
            if (zoneType === 'resistance') {
                return confidence > 0.75 ? 'prepare-short-entry' : 'watch-for-rejection';
            } else {
                return confidence > 0.75 ? 'prepare-long-entry' : 'watch-for-bounce';
            }
        } else {
            return 'wait-for-clarity';
        }
    }

    generateModularRecommendations(expectedReaction, confidence, actionRecommendation, data) {
        const isBreakoutExpected = expectedReaction === this.config.reactionTypes.breakout;
        const isBounceExpected = expectedReaction === this.config.reactionTypes.bounce;
        const isHighConfidence = confidence > 0.75;

        return {
            entryZoneClassifier: {
                markAsHotZone: isHighConfidence,
                zoneQuality: confidence,
                expectedReaction: expectedReaction,
                actionReady: actionRecommendation.includes('prepare')
            },
            tpOptimizer: {
                allowExtendedTP: isBreakoutExpected && isHighConfidence,
                useConservativeTP: isBounceExpected || !isHighConfidence,
                reactionType: expectedReaction,
                confidence: confidence
            },
            exitTimingAdvisor: {
                watchVolatilitySpike: isBreakoutExpected,
                prepareForReversal: isBounceExpected,
                monitorCloselyAtLevel: confidence > 0.5
            },
            confirmationSignalBridge: {
                enhanceSignal: isHighConfidence,
                requireAdditionalConfirmation: confidence < 0.5,
                reactionExpectation: expectedReaction
            },
            trendLineIntegrityChecker: {
                expectBreakout: isBreakoutExpected && isHighConfidence,
                expectRejection: isBounceExpected && isHighConfidence
            },
            supportResistanceReactor: {
                reactionConfidence: confidence,
                expectedReaction: expectedReaction,
                actionRecommendation: actionRecommendation
            }
        };
    }

    identifyRiskFactors(expectedReaction, confidence, data) {
        const riskFactors = [];

        if (confidence < 0.5) {
            riskFactors.push('low-reaction-confidence');
        }

        if (expectedReaction === this.config.reactionTypes.uncertain) {
            riskFactors.push('uncertain-reaction-type');
        }

        if (data.zoneStrength && data.zoneStrength < 0.5) {
            riskFactors.push('weak-support-resistance-level');
        }

        if (data.breakoutVolume && data.avgVolume && 
            data.breakoutVolume < data.avgVolume) {
            riskFactors.push('insufficient-volume-for-breakout');
        }

        if (data.previousReactions && data.previousReactions.length < 2) {
            riskFactors.push('limited-historical-data');
        }

        return riskFactors;
    }

    generateAlert(expectedReaction, confidence, zoneType) {
        const confidenceLevel = confidence > 0.75 ? 'High' : confidence > 0.5 ? 'Moderate' : 'Low';
        
        if (expectedReaction === this.config.reactionTypes.breakout) {
            return `${confidenceLevel} breakout potential at ${zoneType} — monitor closely`;
        } else if (expectedReaction === this.config.reactionTypes.bounce) {
            return `${confidenceLevel} bounce potential at ${zoneType} — prepare for reversal`;
        } else {
            return `Uncertain reaction at ${zoneType} — wait for clarity`;
        }
    }

    generateStrategicGuidance(expectedReaction, confidence, data) {
        return {
            primaryStrategy: expectedReaction,
            confidence: confidence,
            alternativeScenario: expectedReaction === 'breakout' ? 'bounce' : 'breakout',
            positionSize: confidence > 0.75 ? 'normal' : 'reduced',
            stopLossPlacement: data.zoneType === 'resistance' ? 'above-zone' : 'below-zone',
            targetSelection: expectedReaction === 'breakout' ? 'extended' : 'quick-profit',
            timeframe: confidence > 0.75 ? 'immediate' : 'wait-for-confirmation'
        };
    }

    createDistantOutput(proximityAnalysis) {
        return {
            expectedReaction: 'watching',
            reactionConfidence: 0,
            actionRecommendation: 'monitor-approach',
            modularRecommendations: {
                entryZoneClassifier: { watchForApproach: true },
                confirmationSignalBridge: { prepareForSignal: true }
            },
            alert: 'Price not yet at support/resistance level',
            proximity: proximityAnalysis
        };
    }

    validateInput(data) {
        return data && 
               data.price !== undefined &&
               data.zoneType !== undefined &&
               data.distanceToZone !== undefined;
    }

    createErrorOutput(message) {
        return {
            expectedReaction: 'uncertain',
            reactionConfidence: 0,
            actionRecommendation: 'wait-for-clarity',
            error: message,
            modularRecommendations: {
                entryZoneClassifier: { markAsUncertain: true },
                confirmationSignalBridge: { requireAdditionalConfirmation: true }
            },
            riskFactors: ['analysis-error'],
            alert: 'Error in support/resistance analysis'
        };
    }
}

module.exports = SupportResistanceReactor;
