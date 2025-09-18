const GrafikBeyniModuleBase = require('../grafikBeyniModuleBase');

/**
 * Combo Break Detector Module
 * Birden fazla gösterge uyumu varsa sinyal önceliği yükseltilir
 * Multiple confirmation signals ve combo pattern tespiti
 */
class ComboBreakDetector extends GrafikBeyniModuleBase {
    constructor() {
        super('comboBreakDetector');
        this.comboHistory = [];
        this.indicatorWeights = {
            trendAlignment: 0.25,
            volumeConfirmation: 0.20,
            supportResistanceBreak: 0.15,
            momentumConfirmation: 0.15,
            patternCompletion: 0.10,
            volatilitySupport: 0.10,
            sentimentAlignment: 0.05
        };
        this.comboThresholds = {
            elite: 8.5,
            strong: 7.0,
            moderate: 5.5,
            weak: 4.0
        };
        this.maxHistorySize = 100;
    }

    async analyze(data) {
        try {
            const {
                trendAlignment,
                volumeConfirmation,
                supportResistanceBreak,
                momentumConfirmation,
                patternCompletion,
                volatilitySupport,
                sentimentAlignment,
                technicalIndicators,
                priceAction,
                marketCondition,
                timeframe,
                signalStrength,
                confirmationCount,
                riskRewardRatio
            } = data;

            // Veri doğrulama
            if (!trendAlignment && !volumeConfirmation && !supportResistanceBreak) {
                throw new Error('Missing required confirmation signals for combo break detection');
            }

            // Individual confirmation scores hesaplama
            const confirmationScores = this.calculateConfirmationScores(data);

            // Combo strength hesaplama
            const comboStrength = this.calculateComboStrength(confirmationScores);

            // Combo level belirleme
            const comboLevel = this.determineComboLevel(comboStrength);

            // Synergy analysis - göstergeler arası sinerji
            const synergyAnalysis = this.analyzeSynergy(confirmationScores, data);

            // Signal priority calculation
            const signalPriority = this.calculateSignalPriority(comboStrength, synergyAnalysis, data);

            // Quality multiplier - combo kalitesi çarpanı
            const qualityMultiplier = this.calculateQualityMultiplier(comboLevel, synergyAnalysis);

            // Confirmation reliability
            const confirmationReliability = this.assessConfirmationReliability(confirmationScores, data);

            // Combo durability - combo'nun sürdürülebilirliği
            const comboDurability = this.assessComboDurability(data, comboStrength);

            // Market environment compatibility
            const environmentCompatibility = this.assessEnvironmentCompatibility(data, comboLevel);

            // Recommendations oluşturma
            const recommendations = this.generateRecommendations(comboLevel, signalPriority, qualityMultiplier);

            const result = {
                isComboDetected: comboStrength >= this.comboThresholds.weak,
                isStrongCombo: comboStrength >= this.comboThresholds.strong,
                isEliteCombo: comboStrength >= this.comboThresholds.elite,
                comboStrength: comboStrength,
                comboLevel: comboLevel,
                confirmationScores: confirmationScores,
                synergyAnalysis: synergyAnalysis,
                signalPriority: signalPriority,
                qualityMultiplier: qualityMultiplier,
                confirmationReliability: confirmationReliability,
                comboDurability: comboDurability,
                environmentCompatibility: environmentCompatibility,
                recommendations: recommendations,
                notes: this.generateNotes(comboLevel, comboStrength, synergyAnalysis),
                metadata: {
                    analysisTimestamp: Date.now(),
                    confirmationCount: this.countConfirmations(confirmationScores),
                    strongestFactor: this.identifyStrongestFactor(confirmationScores),
                    weakestFactor: this.identifyWeakestFactor(confirmationScores),
                    comboTrend: this.analyzeComboTrend(),
                    historicalPerformance: this.getHistoricalPerformance(comboLevel)
                }
            };

            // Combo history güncelleme
            if (result.isComboDetected) {
                this.updateComboHistory(result, data);
            }

            // Cache ve performance tracking
            this.updateCache(data, result);
            this.trackPerformance(Date.now(), result.isComboDetected);

            return result;

        } catch (error) {
            this.handleError('ComboBreakDetector analysis failed', error, data);
            return this.getDefaultResult();
        }
    }

    calculateConfirmationScores(data) {
        const {
            trendAlignment,
            volumeConfirmation,
            supportResistanceBreak,
            momentumConfirmation,
            patternCompletion,
            volatilitySupport,
            sentimentAlignment
        } = data;

        const scores = {};

        // Trend Alignment Score
        scores.trendAlignment = this.scoreTrendAlignment(trendAlignment);

        // Volume Confirmation Score
        scores.volumeConfirmation = this.scoreVolumeConfirmation(volumeConfirmation);

        // Support/Resistance Break Score
        scores.supportResistanceBreak = this.scoreSupportResistanceBreak(supportResistanceBreak);

        // Momentum Confirmation Score
        scores.momentumConfirmation = this.scoreMomentumConfirmation(momentumConfirmation);

        // Pattern Completion Score
        scores.patternCompletion = this.scorePatternCompletion(patternCompletion);

        // Volatility Support Score
        scores.volatilitySupport = this.scoreVolatilitySupport(volatilitySupport);

        // Sentiment Alignment Score
        scores.sentimentAlignment = this.scoreSentimentAlignment(sentimentAlignment);

        return scores;
    }

    scoreTrendAlignment(trendAlignment) {
        if (!trendAlignment) return 0;

        let score = 0;

        // Trend strength
        if (trendAlignment.strength >= 0.9) score += 4.0;
        else if (trendAlignment.strength >= 0.7) score += 3.0;
        else if (trendAlignment.strength >= 0.5) score += 2.0;
        else if (trendAlignment.strength >= 0.3) score += 1.0;

        // Trend consistency
        if (trendAlignment.consistency >= 0.9) score += 3.0;
        else if (trendAlignment.consistency >= 0.7) score += 2.0;
        else if (trendAlignment.consistency >= 0.5) score += 1.0;

        // Multiple timeframe alignment
        if (trendAlignment.multiTimeframe) score += 2.0;

        // Direction confidence
        if (trendAlignment.directionConfidence >= 0.8) score += 1.0;

        return Math.min(10, score);
    }

    scoreVolumeConfirmation(volumeConfirmation) {
        if (!volumeConfirmation) return 0;

        let score = 0;

        // Volume level
        if (volumeConfirmation.level === 'very_high') score += 4.0;
        else if (volumeConfirmation.level === 'high') score += 3.0;
        else if (volumeConfirmation.level === 'moderate') score += 2.0;
        else if (volumeConfirmation.level === 'low') score += 1.0;

        // Volume trend
        if (volumeConfirmation.trend === 'increasing') score += 2.5;
        else if (volumeConfirmation.trend === 'stable') score += 1.5;

        // Volume surge
        if (volumeConfirmation.surge) score += 2.0;

        // Distribution quality
        if (volumeConfirmation.distributionQuality === 'excellent') score += 1.5;
        else if (volumeConfirmation.distributionQuality === 'good') score += 1.0;

        return Math.min(10, score);
    }

    scoreSupportResistanceBreak(supportResistanceBreak) {
        if (!supportResistanceBreak) return 0;

        let score = 0;

        // Break strength
        if (supportResistanceBreak.strength >= 0.9) score += 4.0;
        else if (supportResistanceBreak.strength >= 0.7) score += 3.0;
        else if (supportResistanceBreak.strength >= 0.5) score += 2.0;
        else if (supportResistanceBreak.strength >= 0.3) score += 1.0;

        // Level significance
        if (supportResistanceBreak.significance === 'major') score += 3.0;
        else if (supportResistanceBreak.significance === 'significant') score += 2.0;
        else if (supportResistanceBreak.significance === 'minor') score += 1.0;

        // Break confirmation
        if (supportResistanceBreak.confirmed) score += 2.0;

        // Retest behavior
        if (supportResistanceBreak.retestSuccess) score += 1.0;

        return Math.min(10, score);
    }

    scoreMomentumConfirmation(momentumConfirmation) {
        if (!momentumConfirmation) return 0;

        let score = 0;

        // Momentum strength
        if (momentumConfirmation.strength >= 0.8) score += 3.5;
        else if (momentumConfirmation.strength >= 0.6) score += 2.5;
        else if (momentumConfirmation.strength >= 0.4) score += 1.5;
        else if (momentumConfirmation.strength >= 0.2) score += 0.5;

        // Momentum acceleration
        if (momentumConfirmation.acceleration > 0.5) score += 2.0;
        else if (momentumConfirmation.acceleration > 0.2) score += 1.0;

        // RSI confirmation
        if (momentumConfirmation.rsiConfirmation) score += 1.5;

        // MACD confirmation
        if (momentumConfirmation.macdConfirmation) score += 1.5;

        // Stochastic confirmation
        if (momentumConfirmation.stochasticConfirmation) score += 1.0;

        return Math.min(10, score);
    }

    scorePatternCompletion(patternCompletion) {
        if (!patternCompletion) return 0;

        let score = 0;

        // Completion percentage
        if (patternCompletion.percentage >= 0.95) score += 4.0;
        else if (patternCompletion.percentage >= 0.85) score += 3.0;
        else if (patternCompletion.percentage >= 0.75) score += 2.0;
        else if (patternCompletion.percentage >= 0.6) score += 1.0;

        // Pattern quality
        if (patternCompletion.quality === 'excellent') score += 3.0;
        else if (patternCompletion.quality === 'good') score += 2.0;
        else if (patternCompletion.quality === 'fair') score += 1.0;

        // Pattern type bonus
        const typeBonus = {
            'head_and_shoulders': 1.5,
            'cup_and_handle': 1.2,
            'triangle': 1.0,
            'flag': 0.8
        };
        score += typeBonus[patternCompletion.type] || 0.5;

        // Confirmation status
        if (patternCompletion.confirmed) score += 1.5;

        return Math.min(10, score);
    }

    scoreVolatilitySupport(volatilitySupport) {
        if (!volatilitySupport) return 0;

        let score = 0;

        // Volatility level appropriateness
        if (volatilitySupport.appropriate) score += 3.0;

        // Volatility trend
        if (volatilitySupport.trend === 'optimal') score += 2.5;
        else if (volatilitySupport.trend === 'acceptable') score += 1.5;

        // ATR confirmation
        if (volatilitySupport.atrConfirmation) score += 2.0;

        // Bollinger bands position
        if (volatilitySupport.bollingerPosition === 'optimal') score += 1.5;
        else if (volatilitySupport.bollingerPosition === 'acceptable') score += 1.0;

        // VIX correlation (if available)
        if (volatilitySupport.vixCorrelation === 'positive') score += 1.0;

        return Math.min(10, score);
    }

    scoreSentimentAlignment(sentimentAlignment) {
        if (!sentimentAlignment) return 0;

        let score = 0;

        // Sentiment strength
        if (sentimentAlignment.strength >= 0.8) score += 3.0;
        else if (sentimentAlignment.strength >= 0.6) score += 2.0;
        else if (sentimentAlignment.strength >= 0.4) score += 1.0;

        // News sentiment
        if (sentimentAlignment.newsAlignment) score += 2.0;

        // Social sentiment
        if (sentimentAlignment.socialAlignment) score += 1.5;

        // Market sentiment
        if (sentimentAlignment.marketAlignment) score += 2.0;

        // Fear/Greed index
        if (sentimentAlignment.fearGreedAlignment) score += 1.5;

        return Math.min(10, score);
    }

    calculateComboStrength(confirmationScores) {
        let totalScore = 0;

        for (const [factor, score] of Object.entries(confirmationScores)) {
            const weight = this.indicatorWeights[factor] || 0;
            totalScore += score * weight;
        }

        return Math.min(10, totalScore);
    }

    determineComboLevel(comboStrength) {
        if (comboStrength >= this.comboThresholds.elite) {
            return 'elite';
        } else if (comboStrength >= this.comboThresholds.strong) {
            return 'strong';
        } else if (comboStrength >= this.comboThresholds.moderate) {
            return 'moderate';
        } else if (comboStrength >= this.comboThresholds.weak) {
            return 'weak';
        } else {
            return 'none';
        }
    }

    analyzeSynergy(confirmationScores, data) {
        const activeConfirmations = Object.entries(confirmationScores)
            .filter(([factor, score]) => score > 0)
            .length;

        const totalScore = Object.values(confirmationScores).reduce((sum, score) => sum + score, 0);
        const averageScore = activeConfirmations > 0 ? totalScore / activeConfirmations : 0;

        // Synergy multiplier hesaplanıyor
        let synergyMultiplier = 1.0;

        if (activeConfirmations >= 6) synergyMultiplier += 0.5; // Full spectrum confirmation
        else if (activeConfirmations >= 5) synergyMultiplier += 0.3;
        else if (activeConfirmations >= 4) synergyMultiplier += 0.2;
        else if (activeConfirmations >= 3) synergyMultiplier += 0.1;

        // High-quality confirmations bonus
        const highQualityConfirmations = Object.values(confirmationScores)
            .filter(score => score >= 7.0).length;

        if (highQualityConfirmations >= 3) synergyMultiplier += 0.3;
        else if (highQualityConfirmations >= 2) synergyMultiplier += 0.2;

        // Balance check - çok farklı skorlar varsa sinerji azalır
        const scoreVariance = this.calculateVariance(Object.values(confirmationScores).filter(s => s > 0));
        if (scoreVariance > 9) synergyMultiplier -= 0.2; // High variance penalty

        return {
            activeConfirmations: activeConfirmations,
            averageScore: averageScore,
            synergyMultiplier: Math.max(1.0, synergyMultiplier),
            highQualityCount: highQualityConfirmations,
            scoreVariance: scoreVariance,
            synergyQuality: this.assessSynergyQuality(synergyMultiplier, activeConfirmations)
        };
    }

    calculateSignalPriority(comboStrength, synergyAnalysis, data) {
        let basePriority = comboStrength;

        // Synergy bonus
        basePriority *= synergyAnalysis.synergyMultiplier;

        // Signal strength bonus
        if (data.signalStrength > 0.8) basePriority += 1.0;
        else if (data.signalStrength > 0.6) basePriority += 0.5;

        // Risk/reward ratio bonus
        if (data.riskRewardRatio >= 3.0) basePriority += 1.0;
        else if (data.riskRewardRatio >= 2.0) basePriority += 0.5;

        // Market condition adjustment
        if (data.marketCondition === 'trending') basePriority += 0.5;
        else if (data.marketCondition === 'volatile') basePriority -= 0.5;

        const normalizedPriority = Math.min(10, basePriority);

        return {
            priority: normalizedPriority,
            level: this.getPriorityLevel(normalizedPriority),
            urgency: this.getUrgencyLevel(normalizedPriority, synergyAnalysis),
            recommendation: this.getPriorityRecommendation(normalizedPriority)
        };
    }

    calculateQualityMultiplier(comboLevel, synergyAnalysis) {
        const baseMultipliers = {
            'elite': 2.0,
            'strong': 1.5,
            'moderate': 1.2,
            'weak': 1.0,
            'none': 0.8
        };

        let multiplier = baseMultipliers[comboLevel] || 1.0;

        // Synergy quality bonus
        if (synergyAnalysis.synergyQuality === 'excellent') multiplier += 0.3;
        else if (synergyAnalysis.synergyQuality === 'good') multiplier += 0.2;
        else if (synergyAnalysis.synergyQuality === 'fair') multiplier += 0.1;

        // Active confirmations bonus
        if (synergyAnalysis.activeConfirmations >= 6) multiplier += 0.2;
        else if (synergyAnalysis.activeConfirmations >= 5) multiplier += 0.1;

        return {
            multiplier: multiplier,
            baseMultiplier: baseMultipliers[comboLevel],
            synergyBonus: multiplier - baseMultipliers[comboLevel],
            effectiveStrength: multiplier * 5 // Scale to 0-10 for comparison
        };
    }

    assessConfirmationReliability(confirmationScores, data) {
        const scores = Object.values(confirmationScores).filter(score => score > 0);
        const averageScore = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
        const minScore = Math.min(...scores, 10);
        const maxScore = Math.max(...scores, 0);

        let reliability = 'low';
        if (averageScore >= 7.5 && minScore >= 5.0) reliability = 'very_high';
        else if (averageScore >= 6.5 && minScore >= 4.0) reliability = 'high';
        else if (averageScore >= 5.5 && minScore >= 3.0) reliability = 'moderate';
        else if (averageScore >= 4.0) reliability = 'low';
        else reliability = 'very_low';

        return {
            level: reliability,
            averageScore: averageScore,
            minScore: minScore,
            maxScore: maxScore,
            consistency: this.calculateConsistency(scores),
            confidence: this.calculateConfidenceLevel(reliability, scores.length)
        };
    }

    generateRecommendations(comboLevel, signalPriority, qualityMultiplier) {
        const recommendations = {};

        switch (comboLevel) {
            case 'elite':
                recommendations.vivo = 'highestPriority';
                recommendations.positionSizing = 'increaseSize';
                recommendations.entryTiming = 'immediate';
                recommendations.riskManagement = 'optimizeForEliteCombo';
                break;

            case 'strong':
                recommendations.vivo = 'highPriority';
                recommendations.positionSizing = 'standardPlusSize';
                recommendations.entryTiming = 'priority';
                recommendations.riskManagement = 'adjustForStrongCombo';
                break;

            case 'moderate':
                recommendations.vivo = 'normalPriority';
                recommendations.positionSizing = 'standard';
                recommendations.entryTiming = 'normal';
                recommendations.riskManagement = 'standardRisk';
                break;

            case 'weak':
                recommendations.vivo = 'lowPriority';
                recommendations.positionSizing = 'reducedSize';
                recommendations.entryTiming = 'careful';
                recommendations.riskManagement = 'conservativeRisk';
                break;

            default:
                recommendations.vivo = 'noAction';
                recommendations.positionSizing = 'noPosition';
                recommendations.entryTiming = 'wait';
                recommendations.riskManagement = 'waitForCombo';
        }

        // Priority-based adjustments
        if (signalPriority.level === 'critical') {
            recommendations.alertLevel = 'immediate';
            recommendations.executionSpeed = 'fast';
        } else if (signalPriority.level === 'high') {
            recommendations.alertLevel = 'high';
            recommendations.executionSpeed = 'normal';
        }

        // Quality multiplier adjustments
        if (qualityMultiplier.multiplier > 1.8) {
            recommendations.confidenceLevel = 'maximum';
            recommendations.riskTolerance = 'increased';
        }

        return recommendations;
    }

    generateNotes(comboLevel, comboStrength, synergyAnalysis) {
        const notes = [];

        if (comboLevel === 'elite') {
            notes.push(`ELİT combo tespit edildi! (Skor: ${comboStrength.toFixed(1)})`);
        } else if (comboLevel === 'strong') {
            notes.push(`Güçlü combo sinyali (Skor: ${comboStrength.toFixed(1)})`);
        } else if (comboLevel === 'moderate') {
            notes.push(`Orta seviye combo sinyali (Skor: ${comboStrength.toFixed(1)})`);
        }

        if (synergyAnalysis.activeConfirmations >= 5) {
            notes.push(`${synergyAnalysis.activeConfirmations} farklı gösterge uyumu`);
        }

        if (synergyAnalysis.synergyQuality === 'excellent') {
            notes.push("Mükemmel sinerji kalitesi");
        }

        return notes.join('. ');
    }

    // Helper methods
    calculateVariance(scores) {
        if (scores.length === 0) return 0;
        const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
        const variance = scores.reduce((acc, score) => acc + Math.pow(score - mean, 2), 0) / scores.length;
        return variance;
    }

    assessSynergyQuality(synergyMultiplier, activeConfirmations) {
        if (synergyMultiplier >= 1.8 && activeConfirmations >= 5) return 'excellent';
        if (synergyMultiplier >= 1.5 && activeConfirmations >= 4) return 'good';
        if (synergyMultiplier >= 1.2 && activeConfirmations >= 3) return 'fair';
        return 'poor';
    }

    getPriorityLevel(priority) {
        if (priority >= 9.0) return 'critical';
        if (priority >= 7.5) return 'high';
        if (priority >= 6.0) return 'medium';
        if (priority >= 4.0) return 'low';
        return 'minimal';
    }

    countConfirmations(confirmationScores) {
        return Object.values(confirmationScores).filter(score => score > 0).length;
    }

    identifyStrongestFactor(confirmationScores) {
        let maxScore = 0;
        let strongestFactor = 'none';

        for (const [factor, score] of Object.entries(confirmationScores)) {
            if (score > maxScore) {
                maxScore = score;
                strongestFactor = factor;
            }
        }

        return { factor: strongestFactor, score: maxScore };
    }

    identifyWeakestFactor(confirmationScores) {
        let minScore = 10;
        let weakestFactor = 'none';

        for (const [factor, score] of Object.entries(confirmationScores)) {
            if (score > 0 && score < minScore) {
                minScore = score;
                weakestFactor = factor;
            }
        }

        return { factor: weakestFactor, score: minScore };
    }

    updateComboHistory(result, data) {
        this.comboHistory.push({
            timestamp: Date.now(),
            comboLevel: result.comboLevel,
            comboStrength: result.comboStrength,
            activeConfirmations: result.synergyAnalysis.activeConfirmations,
            signalPriority: result.signalPriority.priority,
            qualityMultiplier: result.qualityMultiplier.multiplier
        });

        if (this.comboHistory.length > this.maxHistorySize) {
            this.comboHistory = this.comboHistory.slice(-this.maxHistorySize);
        }
    }

    analyzeComboTrend() {
        if (this.comboHistory.length < 5) return 'insufficient_data';

        const recent = this.comboHistory.slice(-10);
        const avgStrength = recent.reduce((sum, combo) => sum + combo.comboStrength, 0) / recent.length;

        if (avgStrength >= 7.5) return 'strong_combo_environment';
        if (avgStrength >= 6.0) return 'moderate_combo_environment';
        if (avgStrength >= 4.0) return 'weak_combo_environment';
        return 'poor_combo_environment';
    }

    getHistoricalPerformance(comboLevel) {
        const historicalCombos = this.comboHistory.filter(combo => combo.comboLevel === comboLevel);
        
        if (historicalCombos.length === 0) return { frequency: 0, avgStrength: 0 };

        const avgStrength = historicalCombos.reduce((sum, combo) => sum + combo.comboStrength, 0) / historicalCombos.length;
        const frequency = historicalCombos.length / this.comboHistory.length;

        return {
            frequency: frequency,
            avgStrength: avgStrength,
            occurrences: historicalCombos.length
        };
    }

    getDefaultResult() {
        return {
            isComboDetected: false,
            isStrongCombo: false,
            isEliteCombo: false,
            comboStrength: 0,
            comboLevel: 'none',
            confirmationScores: {
                trendAlignment: 0,
                volumeConfirmation: 0,
                supportResistanceBreak: 0,
                momentumConfirmation: 0,
                patternCompletion: 0,
                volatilitySupport: 0,
                sentimentAlignment: 0
            },
            synergyAnalysis: {
                activeConfirmations: 0,
                averageScore: 0,
                synergyMultiplier: 1.0,
                highQualityCount: 0,
                scoreVariance: 0,
                synergyQuality: 'poor'
            },
            signalPriority: {
                priority: 0,
                level: 'minimal',
                urgency: 'none',
                recommendation: 'wait'
            },
            qualityMultiplier: {
                multiplier: 1.0,
                baseMultiplier: 1.0,
                synergyBonus: 0,
                effectiveStrength: 0
            },
            confirmationReliability: {
                level: 'very_low',
                averageScore: 0,
                minScore: 0,
                maxScore: 0,
                consistency: 0,
                confidence: 0
            },
            comboDurability: null,
            environmentCompatibility: null,
            recommendations: {},
            notes: "Combo break analizi yapılamadı - yetersiz veri",
            metadata: {
                error: true,
                analysisTimestamp: Date.now()
            }
        };
    }

    getModuleInfo() {
        return {
            name: 'ComboBreakDetector',
            version: '1.0.0',
            description: 'Multiple gösterge uyumu ve combo sinyal tespiti',
            inputs: [
                'trendAlignment', 'volumeConfirmation', 'supportResistanceBreak',
                'momentumConfirmation', 'patternCompletion', 'volatilitySupport',
                'sentimentAlignment', 'technicalIndicators', 'priceAction',
                'marketCondition', 'timeframe', 'signalStrength',
                'confirmationCount', 'riskRewardRatio'
            ],
            outputs: [
                'isComboDetected', 'isStrongCombo', 'isEliteCombo', 'comboStrength',
                'comboLevel', 'confirmationScores', 'synergyAnalysis', 'signalPriority',
                'qualityMultiplier', 'confirmationReliability', 'comboDurability',
                'environmentCompatibility', 'recommendations', 'notes', 'metadata'
            ]
        };
    }
}

module.exports = ComboBreakDetector;
