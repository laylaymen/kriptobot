/**
 * Grafik Beyni - Entry Zone Classifier Module
 * 
 * Classifies price zones as suitable for entry, risky, or neutral.
 * Determines optimal entry areas based on formations, trend strength, volatility,
 * and support/resistance distances. Provides zone-based entry guidance.
 */

const GrafikBeyniModuleBase = require('./grafikBeyniModuleBase');

class EntryZoneClassifier extends GrafikBeyniModuleBase {
    constructor() {
        super('entryZoneClassifier');
        
        // Configuration for entry zone classification
        this.config = {
            scoreWeights: {
                trendStrength: 0.20,       // Trend quality weight
                volatilityIndex: 0.15,     // Volatility appropriateness
                zoneSuccessRate: 0.25,     // Historical success of this zone type
                supportResistanceBalance: 0.15, // Distance to S/R levels
                formationQuality: 0.25     // Formation readiness and quality
            },
            thresholds: {
                entryAllowed: 0.75,        // Zone is excellent for entry
                cautious: 0.50,            // Zone requires caution
                avoid: 0.25,               // Zone should be avoided
                maxZoneWidth: 0.025,       // 2.5% max zone width
                minZoneWidth: 0.003,       // 0.3% min zone width
                idealVolatility: 1.3       // Ideal volatility level
            },
            zoneTypes: {
                'breakout': { baseWidth: 0.015, confidenceBonus: 0.1 },
                'pullback': { baseWidth: 0.012, confidenceBonus: 0.05 },
                'consolidation': { baseWidth: 0.008, confidenceBonus: 0.15 },
                'trend-continuation': { baseWidth: 0.010, confidenceBonus: 0.12 }
            },
            distanceFactors: {
                optimalSupportDistance: 2.0,   // Ideal distance from support
                optimalResistanceDistance: 3.0, // Ideal distance from resistance
                minSafeDistance: 0.5,          // Minimum safe distance
                maxEffectiveDistance: 5.0      // Maximum effective distance
            }
        };
    }

    async analyze(data) {
        try {
            const startTime = Date.now();
            
            if (!this.validateInput(data)) {
                return this.createErrorOutput('Invalid input data for entry zone classification');
            }

            // Analyze different zone quality factors
            const trendAnalysis = this.analyzeTrendStrength(data.trendScore);
            const volatilityAnalysis = this.analyzeVolatility(data.volatilityIndex);
            const successAnalysis = this.analyzeHistoricalSuccess(data.historicalZoneSuccessRate);
            const distanceAnalysis = this.analyzeSupportResistanceDistances(
                data.supportDistance, 
                data.resistanceDistance
            );
            const formationAnalysis = this.analyzeFormationQuality(
                data.formationType, 
                data.breakoutPrice
            );

            // Calculate zone parameters
            const zoneCalculation = this.calculateEntryZone(data, formationAnalysis);
            
            // Calculate overall zone confidence
            const zoneConfidence = this.calculateZoneConfidence(
                trendAnalysis,
                volatilityAnalysis,
                successAnalysis,
                distanceAnalysis,
                formationAnalysis
            );

            // Determine if entry is allowed
            const allowEntry = zoneConfidence >= this.config.thresholds.entryAllowed;
            const entryType = this.determineEntryType(data.formationType, zoneConfidence);

            // Create modular recommendations
            const modularRecommendations = this.generateModularRecommendations(
                allowEntry,
                zoneConfidence,
                zoneCalculation,
                data
            );

            const result = {
                entryZone: zoneCalculation.zone,
                zoneWidth: zoneCalculation.width,
                zoneConfidence: zoneConfidence,
                allowEntry: allowEntry,
                entryType: entryType,
                modularRecommendations: modularRecommendations,
                componentAnalysis: {
                    trend: trendAnalysis,
                    volatility: volatilityAnalysis,
                    success: successAnalysis,
                    distance: distanceAnalysis,
                    formation: formationAnalysis
                },
                riskFactors: this.identifyRiskFactors(zoneConfidence, data),
                alert: this.generateAlert(allowEntry, zoneConfidence, entryType),
                strategicGuidance: this.generateStrategicGuidance(allowEntry, zoneConfidence, data)
            };

            this.cacheResult(data, result);
            this.trackPerformance(startTime);

            return result;

        } catch (error) {
            this.logError('Entry zone classification failed', error);
            return this.createErrorOutput(error.message);
        }
    }

    analyzeTrendStrength(trendScore) {
        const score = trendScore || 0.5;
        
        let analysis = 'moderate-trend';
        let quality = 'moderate';
        let contribution = 0;

        if (score >= 0.80) {
            contribution = 1.0;
            analysis = 'very-strong-trend';
            quality = 'excellent';
        } else if (score >= 0.65) {
            contribution = 0.8;
            analysis = 'strong-trend';
            quality = 'good';
        } else if (score >= 0.50) {
            contribution = 0.5;
            analysis = 'moderate-trend';
            quality = 'moderate';
        } else {
            contribution = 0.2;
            analysis = 'weak-trend';
            quality = 'poor';
        }

        return {
            score: contribution * this.config.scoreWeights.trendStrength,
            trendScore: score,
            analysis: analysis,
            quality: quality,
            contribution: contribution
        };
    }

    analyzeVolatility(volatilityIndex) {
        const volatility = volatilityIndex || 1.0;
        
        let score = 0;
        let analysis = 'normal-volatility';
        let suitability = 'moderate';

        // Ideal volatility is around 1.3 - not too low, not too high
        const deviation = Math.abs(volatility - this.config.thresholds.idealVolatility);
        
        if (deviation <= 0.2) {
            score = 1.0;
            analysis = 'ideal-volatility';
            suitability = 'excellent';
        } else if (deviation <= 0.4) {
            score = 0.7;
            analysis = 'good-volatility';
            suitability = 'good';
        } else if (deviation <= 0.6) {
            score = 0.4;
            analysis = 'moderate-volatility';
            suitability = 'moderate';
        } else {
            score = 0.1;
            analysis = volatility > this.config.thresholds.idealVolatility ? 'high-volatility' : 'low-volatility';
            suitability = 'poor';
        }

        return {
            score: score * this.config.scoreWeights.volatilityIndex,
            volatilityIndex: volatility,
            analysis: analysis,
            suitability: suitability,
            deviation: deviation
        };
    }

    analyzeHistoricalSuccess(successRate) {
        const rate = successRate || 0.5;
        
        let score = 0;
        let analysis = 'average-success';
        let reliability = 'moderate';

        if (rate >= 0.80) {
            score = 1.0;
            analysis = 'excellent-success-rate';
            reliability = 'very-high';
        } else if (rate >= 0.70) {
            score = 0.8;
            analysis = 'good-success-rate';
            reliability = 'high';
        } else if (rate >= 0.60) {
            score = 0.6;
            analysis = 'moderate-success-rate';
            reliability = 'moderate';
        } else if (rate >= 0.50) {
            score = 0.4;
            analysis = 'below-average-success';
            reliability = 'low';
        } else {
            score = 0.1;
            analysis = 'poor-success-rate';
            reliability = 'very-low';
        }

        return {
            score: score * this.config.scoreWeights.zoneSuccessRate,
            successRate: rate,
            analysis: analysis,
            reliability: reliability
        };
    }

    analyzeSupportResistanceDistances(supportDistance, resistanceDistance) {
        const supDist = supportDistance || 0;
        const resDist = resistanceDistance || 0;
        
        let score = 0;
        let analysis = 'unknown-distances';
        let balance = 'unknown';

        if (supDist > 0 && resDist > 0) {
            // Check if distances are in optimal range
            const supOptimal = this.isDistanceOptimal(supDist, this.config.distanceFactors.optimalSupportDistance);
            const resOptimal = this.isDistanceOptimal(resDist, this.config.distanceFactors.optimalResistanceDistance);
            
            if (supOptimal && resOptimal) {
                score = 1.0;
                analysis = 'optimal-sr-distances';
                balance = 'excellent';
            } else if (supOptimal || resOptimal) {
                score = 0.7;
                analysis = 'good-sr-distance';
                balance = 'good';
            } else {
                // Check if at least they're safe distances
                const supSafe = supDist >= this.config.distanceFactors.minSafeDistance;
                const resSafe = resDist >= this.config.distanceFactors.minSafeDistance;
                
                if (supSafe && resSafe) {
                    score = 0.5;
                    analysis = 'safe-sr-distances';
                    balance = 'moderate';
                } else {
                    score = 0.2;
                    analysis = 'risky-sr-distances';
                    balance = 'poor';
                }
            }
        }

        return {
            score: score * this.config.scoreWeights.supportResistanceBalance,
            supportDistance: supDist,
            resistanceDistance: resDist,
            analysis: analysis,
            balance: balance
        };
    }

    isDistanceOptimal(distance, optimal) {
        const tolerance = optimal * 0.3; // 30% tolerance
        return distance >= (optimal - tolerance) && distance <= (optimal + tolerance);
    }

    analyzeFormationQuality(formationType, breakoutPrice) {
        if (!formationType) {
            return {
                score: 0,
                formationType: 'unknown',
                analysis: 'no-formation-data',
                quality: 'unknown'
            };
        }

        // Formation quality mapping
        const formationQualities = {
            'cup-handle': 0.85,
            'ascending-triangle': 0.80,
            'bull-flag': 0.75,
            'inverse-head-shoulders': 0.80,
            'descending-triangle': 0.75,
            'bear-flag': 0.75,
            'head-shoulders': 0.80,
            'symmetrical-triangle': 0.65,
            'rectangle': 0.60,
            'wedge': 0.70
        };

        const baseQuality = formationQualities[formationType] || 0.50;
        let adjustedQuality = baseQuality;
        let analysis = `${formationType}-formation`;
        let quality = 'moderate';

        // Adjust for breakout confirmation
        if (breakoutPrice && breakoutPrice > 0) {
            adjustedQuality += 0.10; // Breakout confirmed
            analysis += '-with-breakout';
        }

        if (adjustedQuality >= 0.80) {
            quality = 'excellent';
        } else if (adjustedQuality >= 0.65) {
            quality = 'good';
        } else if (adjustedQuality >= 0.50) {
            quality = 'moderate';
        } else {
            quality = 'poor';
        }

        return {
            score: adjustedQuality * this.config.scoreWeights.formationQuality,
            formationType: formationType,
            analysis: analysis,
            quality: quality,
            baseQuality: baseQuality,
            hasBreakout: !!breakoutPrice
        };
    }

    calculateEntryZone(data, formationAnalysis) {
        const breakoutPrice = data.breakoutPrice || data.currentPrice || 100;
        
        // Get base zone width for formation type
        const zoneConfig = this.config.zoneTypes[this.getZoneType(data.formationType)] || 
                          this.config.zoneTypes['breakout'];
        
        let zoneWidth = breakoutPrice * zoneConfig.baseWidth;
        
        // Adjust zone width based on volatility
        if (data.volatilityIndex) {
            const volatilityAdjustment = Math.max(0.5, Math.min(2.0, data.volatilityIndex));
            zoneWidth *= volatilityAdjustment;
        }
        
        // Ensure zone width is within limits
        const maxWidth = breakoutPrice * this.config.thresholds.maxZoneWidth;
        const minWidth = breakoutPrice * this.config.thresholds.minZoneWidth;
        zoneWidth = Math.max(minWidth, Math.min(maxWidth, zoneWidth));
        
        // Calculate zone boundaries
        const zoneLow = breakoutPrice + (zoneWidth * 0.2); // Slightly above breakout
        const zoneHigh = breakoutPrice + zoneWidth;
        
        return {
            zone: {
                low: parseFloat(zoneLow.toFixed(2)),
                high: parseFloat(zoneHigh.toFixed(2))
            },
            width: parseFloat(zoneWidth.toFixed(2)),
            center: parseFloat(((zoneLow + zoneHigh) / 2).toFixed(2)),
            type: this.getZoneType(data.formationType)
        };
    }

    getZoneType(formationType) {
        const breakoutFormations = ['cup-handle', 'ascending-triangle', 'bull-flag', 'inverse-head-shoulders'];
        const pullbackFormations = ['bear-flag', 'descending-triangle'];
        const continuationFormations = ['symmetrical-triangle', 'wedge'];
        
        if (breakoutFormations.includes(formationType)) {
            return 'breakout';
        } else if (pullbackFormations.includes(formationType)) {
            return 'pullback';
        } else if (continuationFormations.includes(formationType)) {
            return 'trend-continuation';
        } else {
            return 'consolidation';
        }
    }

    calculateZoneConfidence(trend, volatility, success, distance, formation) {
        const totalScore = 
            trend.score +
            volatility.score +
            success.score +
            distance.score +
            formation.score;

        return Math.max(0, Math.min(1, totalScore));
    }

    determineEntryType(formationType, confidence) {
        if (confidence >= this.config.thresholds.entryAllowed) {
            return 'strong-entry-zone';
        } else if (confidence >= this.config.thresholds.cautious) {
            return 'cautious-entry-zone';
        } else {
            return 'weak-entry-zone';
        }
    }

    generateModularRecommendations(allowEntry, zoneConfidence, zoneCalculation, data) {
        return {
            riskToRewardValidator: {
                useCurrentZone: allowEntry,
                zoneBasedCalculation: true,
                entryPrice: zoneCalculation.center,
                zoneConfidence: zoneConfidence
            },
            confirmationSignalBridge: {
                liftZoneLock: allowEntry,
                zoneQuality: zoneConfidence,
                entryZoneReady: allowEntry
            },
            tpOptimizer: {
                adjustTPForZone: true,
                zoneWidth: zoneCalculation.width,
                entryZoneStrength: zoneConfidence
            },
            supportResistanceReactor: {
                consideredInZone: allowEntry,
                zoneParameters: zoneCalculation.zone
            },
            priceDeviationScanner: {
                allowZoneDeviation: allowEntry && zoneConfidence > 0.8,
                zoneToleranceBonus: zoneConfidence * 0.1
            },
            VIVO: {
                entryZoneActive: allowEntry,
                entryZone: zoneCalculation.zone,
                zoneConfidence: zoneConfidence,
                entryType: this.determineEntryType(data.formationType, zoneConfidence)
            }
        };
    }

    identifyRiskFactors(zoneConfidence, data) {
        const riskFactors = [];

        if (zoneConfidence < this.config.thresholds.cautious) {
            riskFactors.push('low-zone-confidence');
        }

        if (data.volatilityIndex && data.volatilityIndex > 2.0) {
            riskFactors.push('excessive-volatility');
        }

        if (data.supportDistance && data.supportDistance < this.config.distanceFactors.minSafeDistance) {
            riskFactors.push('too-close-to-support');
        }

        if (data.resistanceDistance && data.resistanceDistance < this.config.distanceFactors.minSafeDistance) {
            riskFactors.push('too-close-to-resistance');
        }

        if (data.historicalZoneSuccessRate && data.historicalZoneSuccessRate < 0.50) {
            riskFactors.push('poor-historical-performance');
        }

        if (data.trendScore && data.trendScore < 0.50) {
            riskFactors.push('weak-trend-support');
        }

        return riskFactors;
    }

    generateAlert(allowEntry, zoneConfidence, entryType) {
        if (allowEntry) {
            return 'Giriş bölgesi tanımlandı — VIVO sinyal onayı hazır';
        } else if (zoneConfidence >= this.config.thresholds.cautious) {
            return 'Dikkat: Giriş bölgesi riskli — ek onay gerekli';
        } else {
            return 'Giriş bölgesi yetersiz — pozisyon reddedildi';
        }
    }

    generateStrategicGuidance(allowEntry, zoneConfidence, data) {
        return {
            entryDecision: allowEntry ? 'proceed' : 'wait',
            confidenceLevel: zoneConfidence,
            positionSizing: zoneConfidence > 0.8 ? 'full' : zoneConfidence > 0.6 ? 'reduced' : 'minimal',
            entryMethod: zoneConfidence > 0.75 ? 'immediate' : 'staged',
            monitoringRequired: zoneConfidence < 0.7,
            fallbackPlan: zoneConfidence < 0.5 ? 'wait-for-better-setup' : 'proceed-with-caution'
        };
    }

    validateInput(data) {
        return data && 
               (data.breakoutPrice !== undefined || data.currentPrice !== undefined) &&
               data.formationType !== undefined;
    }

    createErrorOutput(message) {
        return {
            entryZone: { low: 0, high: 0 },
            zoneWidth: 0,
            zoneConfidence: 0,
            allowEntry: false,
            entryType: 'error',
            error: message,
            modularRecommendations: {
                riskToRewardValidator: { useCurrentZone: false },
                confirmationSignalBridge: { liftZoneLock: false },
                VIVO: { entryZoneActive: false }
            },
            riskFactors: ['analysis-error'],
            alert: 'Error in entry zone analysis — entry blocked'
        };
    }

    // Public methods for other modules
    isInEntryZone(price, zone) {
        return zone && price >= zone.low && price <= zone.high;
    }

    getZoneQuality(zoneConfidence) {
        if (zoneConfidence >= this.config.thresholds.entryAllowed) return 'excellent';
        if (zoneConfidence >= this.config.thresholds.cautious) return 'good';
        if (zoneConfidence >= this.config.thresholds.avoid) return 'poor';
        return 'very-poor';
    }

    calculateZoneRisk(zoneConfidence, volatilityIndex) {
        const baseRisk = 1 - zoneConfidence;
        const volatilityRisk = volatilityIndex > 1.5 ? (volatilityIndex - 1.5) * 0.2 : 0;
        return Math.min(1, baseRisk + volatilityRisk);
    }
}

module.exports = EntryZoneClassifier;
