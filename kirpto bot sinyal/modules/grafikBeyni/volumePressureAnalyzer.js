/**
 * Grafik Beyni - Volume Pressure Analyzer Module
 * 
 * Analyzes volume data to determine whether buyers or sellers are dominant.
 * Reveals the real force behind price movements.
 * Protects the system from traps like "price going up but no volume support".
 */

const GrafikBeyniModuleBase = require('../grafikBeyniModuleBase');

class VolumePressureAnalyzer extends GrafikBeyniModuleBase {
    constructor() {
        super('volumePressureAnalyzer');
        
        // Configuration for volume pressure analysis
        this.config = {
            scoreWeights: {
                volumeDelta: 0.35,      // Volume increase > 50%
                buyVsSellPressure: 0.25, // Buy volume > sell volume
                volumeVsAverage: 0.20,   // Current volume > average
                priceVolumeAlignment: 0.20 // Price change + volume momentum
            },
            thresholds: {
                strongPressure: 0.70,    // Strong volume support
                moderatePressure: 0.50,  // Acceptable volume
                weakPressure: 0.50       // Suppress trades
            },
            volumeThresholds: {
                significantDelta: 0.50,  // 50% volume increase
                significantRatio: 1.20,  // 120% of average volume
                buyDominance: 1.20       // Buy volume 20% higher than sell
            },
            priceThresholds: {
                significantMove: 1.0     // 1% price change
            }
        };
    }

    async analyze(data) {
        try {
            const startTime = Date.now();
            
            if (!this.validateInput(data)) {
                return this.createErrorOutput('Invalid input data for volume pressure analysis');
            }

            // Analyze volume components
            const volumeDeltaAnalysis = this.analyzeVolumeDelta(data.currentVolume, data.averageVolume, data.volumeDelta);
            const buyVsSellAnalysis = this.analyzeBuyVsSellPressure(data.buyVolume, data.sellVolume);
            const volumeRatioAnalysis = this.analyzeVolumeRatio(data.currentVolume, data.averageVolume);
            const priceVolumeAlignment = this.analyzePriceVolumeAlignment(data.priceChangePercent, data.currentVolume, data.averageVolume);

            // Calculate overall pressure score
            const pressureScore = this.calculatePressureScore(
                volumeDeltaAnalysis,
                buyVsSellAnalysis,
                volumeRatioAnalysis,
                priceVolumeAlignment
            );

            // Determine volume pressure direction and reliability
            const volumePressure = this.determineVolumePressure(buyVsSellAnalysis, priceVolumeAlignment, pressureScore);
            const volumeReliability = pressureScore >= this.config.thresholds.moderatePressure;

            // Generate recommendation
            const recommendation = this.generateRecommendation(volumePressure, pressureScore, data);

            // Create modular recommendations
            const modularRecommendations = this.generateModularRecommendations(
                volumePressure,
                pressureScore,
                volumeReliability,
                data
            );

            const result = {
                volumePressure: volumePressure,
                pressureScore: pressureScore,
                volumeReliability: volumeReliability,
                recommendation: recommendation,
                modularRecommendations: modularRecommendations,
                componentAnalysis: {
                    volumeDelta: volumeDeltaAnalysis,
                    buyVsSell: buyVsSellAnalysis,
                    volumeRatio: volumeRatioAnalysis,
                    priceVolumeAlignment: priceVolumeAlignment
                },
                marketConditions: {
                    volumeSupported: pressureScore >= this.config.thresholds.moderatePressure,
                    buyerDominance: buyVsSellAnalysis.buyerDominant,
                    volumeSpike: volumeDeltaAnalysis.isSignificant
                }
            };

            this.cacheResult(data, result);
            this.trackPerformance(startTime);

            return result;

        } catch (error) {
            this.logError('Volume pressure analysis failed', error);
            return this.createErrorOutput(error.message);
        }
    }

    analyzeVolumeDelta(currentVolume, averageVolume, volumeDelta) {
        let score = 0;
        let isSignificant = false;
        let strength = 'weak';

        if (volumeDelta !== undefined && volumeDelta > this.config.volumeThresholds.significantDelta) {
            // Direct volume delta provided
            score = Math.min(1.0, volumeDelta);
            isSignificant = volumeDelta > this.config.volumeThresholds.significantDelta;
            strength = volumeDelta > 1.0 ? 'very-strong' : volumeDelta > 0.7 ? 'strong' : 'moderate';
        } else if (currentVolume && averageVolume) {
            // Calculate from current vs average volume
            const delta = (currentVolume - averageVolume) / averageVolume;
            score = Math.max(0, Math.min(1.0, delta));
            isSignificant = delta > this.config.volumeThresholds.significantDelta;
            strength = delta > 1.0 ? 'very-strong' : delta > 0.5 ? 'strong' : 'moderate';
        }

        return {
            score: score * this.config.scoreWeights.volumeDelta,
            delta: volumeDelta || (currentVolume && averageVolume ? (currentVolume - averageVolume) / averageVolume : 0),
            isSignificant: isSignificant,
            strength: strength
        };
    }

    analyzeBuyVsSellPressure(buyVolume, sellVolume) {
        let score = 0;
        let buyerDominant = false;
        let sellerDominant = false;
        let ratio = 1.0;

        if (buyVolume && sellVolume && buyVolume > 0 && sellVolume > 0) {
            ratio = buyVolume / sellVolume;
            
            if (ratio >= this.config.volumeThresholds.buyDominance) {
                // Buyers dominant
                score = Math.min(1.0, (ratio - 1) * 2); // Scale the dominance
                buyerDominant = true;
            } else if (ratio <= (1 / this.config.volumeThresholds.buyDominance)) {
                // Sellers dominant
                score = Math.min(1.0, (1 / ratio - 1) * 2);
                sellerDominant = true;
            } else {
                // Balanced
                score = 0.3; // Some activity but not dominant
            }
        }

        return {
            score: score * this.config.scoreWeights.buyVsSellPressure,
            buyerDominant: buyerDominant,
            sellerDominant: sellerDominant,
            ratio: ratio,
            buyVolume: buyVolume || 0,
            sellVolume: sellVolume || 0
        };
    }

    analyzeVolumeRatio(currentVolume, averageVolume) {
        let score = 0;
        let ratio = 1.0;
        let isAboveAverage = false;

        if (currentVolume && averageVolume && averageVolume > 0) {
            ratio = currentVolume / averageVolume;
            isAboveAverage = ratio >= this.config.volumeThresholds.significantRatio;
            
            if (isAboveAverage) {
                // Scale score based on how much above average
                score = Math.min(1.0, (ratio - 1) * 2);
            } else {
                // Below average volume reduces score
                score = Math.max(0, ratio * 0.5);
            }
        }

        return {
            score: score * this.config.scoreWeights.volumeVsAverage,
            ratio: ratio,
            isAboveAverage: isAboveAverage,
            currentVolume: currentVolume || 0,
            averageVolume: averageVolume || 0
        };
    }

    analyzePriceVolumeAlignment(priceChangePercent, currentVolume, averageVolume) {
        let score = 0;
        let aligned = false;
        let direction = 'neutral';

        if (priceChangePercent !== undefined && currentVolume && averageVolume) {
            const volumeRatio = currentVolume / averageVolume;
            const significantPriceMove = Math.abs(priceChangePercent) >= this.config.priceThresholds.significantMove;
            const significantVolume = volumeRatio >= this.config.volumeThresholds.significantRatio;

            // Check if price movement is supported by volume
            if (significantPriceMove && significantVolume) {
                score = 1.0;
                aligned = true;
                direction = priceChangePercent > 0 ? 'bullish' : 'bearish';
            } else if (significantPriceMove && !significantVolume) {
                // Price move without volume support - suspicious
                score = 0.2;
                aligned = false;
                direction = 'weak-' + (priceChangePercent > 0 ? 'bullish' : 'bearish');
            } else if (!significantPriceMove && significantVolume) {
                // High volume but no significant price move - accumulation/distribution?
                score = 0.6;
                aligned = true;
                direction = 'consolidation';
            } else {
                // Neither significant price nor volume
                score = 0.4;
                aligned = false;
                direction = 'neutral';
            }
        }

        return {
            score: score * this.config.scoreWeights.priceVolumeAlignment,
            aligned: aligned,
            direction: direction,
            priceChange: priceChangePercent || 0,
            volumeSupport: currentVolume && averageVolume ? currentVolume / averageVolume : 1
        };
    }

    calculatePressureScore(volumeDelta, buyVsSell, volumeRatio, priceVolumeAlignment) {
        const totalScore = 
            volumeDelta.score +
            buyVsSell.score +
            volumeRatio.score +
            priceVolumeAlignment.score;

        return Math.max(0, Math.min(1, totalScore));
    }

    determineVolumePressure(buyVsSell, priceVolumeAlignment, pressureScore) {
        // Determine overall pressure direction
        if (pressureScore >= this.config.thresholds.strongPressure) {
            if (buyVsSell.buyerDominant || priceVolumeAlignment.direction === 'bullish') {
                return 'strong-bullish';
            } else if (buyVsSell.sellerDominant || priceVolumeAlignment.direction === 'bearish') {
                return 'strong-bearish';
            } else {
                return 'strong-neutral';
            }
        } else if (pressureScore >= this.config.thresholds.moderatePressure) {
            if (buyVsSell.buyerDominant || priceVolumeAlignment.direction.includes('bullish')) {
                return 'bullish';
            } else if (buyVsSell.sellerDominant || priceVolumeAlignment.direction.includes('bearish')) {
                return 'bearish';
            } else {
                return 'neutral';
            }
        } else {
            return 'weak';
        }
    }

    generateRecommendation(volumePressure, pressureScore, data) {
        if (pressureScore >= this.config.thresholds.strongPressure) {
            if (volumePressure.includes('bullish')) {
                return 'support-long';
            } else if (volumePressure.includes('bearish')) {
                return 'support-short';
            } else {
                return 'strong-volume-watch';
            }
        } else if (pressureScore >= this.config.thresholds.moderatePressure) {
            return 'moderate-support';
        } else {
            return 'insufficient-volume';
        }
    }

    generateModularRecommendations(volumePressure, pressureScore, volumeReliability, data) {
        const isStrong = pressureScore >= this.config.thresholds.strongPressure;
        const isModerate = pressureScore >= this.config.thresholds.moderatePressure;

        return {
            formationCompletenessJudge: {
                markConfirmed: isStrong && volumeReliability,
                volumeSupport: isModerate,
                requireAdditionalConfirmation: !isModerate
            },
            tpOptimizer: {
                allowAggressiveTP: isStrong,
                allowExtendedTargets: isModerate,
                requireConservativeTP: !isModerate
            },
            entryZoneClassifier: {
                allowFastEntry: isStrong && volumePressure.includes('bullish'),
                requireBetterEntry: !isModerate,
                volumeConfidence: pressureScore
            },
            exitTimingAdvisor: {
                extendHoldTime: isStrong,
                normalHoldTime: isModerate,
                shortenHoldTime: !isModerate
            },
            VIVO: {
                volumeConfirmation: volumeReliability,
                suppressOnLowVolume: !isModerate,
                priorityLevel: isStrong ? 'high' : 'normal'
            },
            confirmationSignalBridge: {
                volumeScore: pressureScore,
                volumeReliable: volumeReliability,
                allowSignal: isModerate
            },
            riskToRewardValidator: {
                volumeSupport: isModerate,
                allowLowerRatio: isStrong,
                requireHigherRatio: !isModerate
            }
        };
    }

    validateInput(data) {
        return data && 
               (data.currentVolume !== undefined || data.volumeDelta !== undefined) &&
               (data.averageVolume !== undefined || data.volumeDelta !== undefined);
    }

    createErrorOutput(message) {
        return {
            volumePressure: 'unknown',
            pressureScore: 0,
            volumeReliability: false,
            recommendation: 'insufficient-data',
            error: message,
            modularRecommendations: {
                formationCompletenessJudge: { markConfirmed: false },
                tpOptimizer: { allowAggressiveTP: false },
                entryZoneClassifier: { allowFastEntry: false },
                VIVO: { volumeConfirmation: false, suppressOnLowVolume: true }
            }
        };
    }
}

module.exports = VolumePressureAnalyzer;
