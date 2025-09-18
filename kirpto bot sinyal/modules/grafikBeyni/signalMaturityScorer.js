const GrafikBeyniModuleBase = require('../grafikBeyniModuleBase');

/**
 * Signal Maturity Scorer Module
 * Sinyal olgunluğu ve kalitesini değerlendirme
 * VIVO'ya sinyal geçip geçmeyeceği kararını etkiler
 */
class SignalMaturityScorer extends GrafikBeyniModuleBase {
    constructor() {
        super('signalMaturityScorer');
        this.signalHistory = [];
        this.maturityFactors = {
            timeInFormation: 0.25,
            volumeConfirmation: 0.20,
            multipleIndicatorAlignment: 0.15,
            patternCompleteness: 0.15,
            marketConditionFit: 0.10,
            riskRewardRatio: 0.10,
            historicalSuccess: 0.05
        };
        this.maturityThresholds = {
            mature: 7.5,
            developing: 5.0,
            premature: 2.5
        };
        this.maxHistorySize = 200;
    }

    async analyze(data) {
        try {
            const {
                signalType,
                signalStrength,
                formationDuration,
                volumeConfirmation,
                indicatorAlignment,
                patternCompleteness,
                marketCondition,
                riskRewardRatio,
                supportResistanceLevel,
                trendAlignment,
                momentumSupport,
                volatilityLevel,
                timeframe,
                signalTimestamp,
                priceLevel,
                confirmationCount
            } = data;

            // Veri doğrulama
            if (!signalType || signalStrength === undefined) {
                throw new Error('Missing required signal data for maturity scoring');
            }

            // Maturity factors hesaplama
            const timeMaturity = this.calculateTimeMaturity(formationDuration, timeframe);
            const volumeMaturity = this.calculateVolumeMaturity(volumeConfirmation, signalStrength);
            const indicatorMaturity = this.calculateIndicatorMaturity(indicatorAlignment, confirmationCount);
            const patternMaturity = this.calculatePatternMaturity(patternCompleteness, signalType);
            const marketMaturity = this.calculateMarketMaturity(marketCondition, trendAlignment);
            const riskMaturity = this.calculateRiskMaturity(riskRewardRatio, volatilityLevel);
            const historicalMaturity = this.calculateHistoricalMaturity(signalType, priceLevel);

            // Overall maturity score
            const maturityScore = this.calculateOverallMaturityScore({
                timeMaturity,
                volumeMaturity,
                indicatorMaturity,
                patternMaturity,
                marketMaturity,
                riskMaturity,
                historicalMaturity
            });

            // Maturity level belirleme
            const maturityLevel = this.determineMaturityLevel(maturityScore);

            // Signal quality assessment
            const qualityAssessment = this.assessSignalQuality(data, maturityScore);

            // VIVO recommendation
            const vivoRecommendation = this.generateVivoRecommendation(maturityScore, maturityLevel, qualityAssessment);

            // Confidence calculation
            const confidence = this.calculateConfidence(maturityScore, data);

            // Improvement suggestions
            const improvementSuggestions = this.generateImprovementSuggestions(maturityScore, data);

            // Signal readiness assessment
            const readinessAssessment = this.assessSignalReadiness(maturityScore, maturityLevel, data);

            const result = {
                isSignalMature: maturityScore >= this.maturityThresholds.mature,
                maturityScore: maturityScore,
                maturityLevel: maturityLevel,
                maturityFactors: {
                    timeMaturity: timeMaturity,
                    volumeMaturity: volumeMaturity,
                    indicatorMaturity: indicatorMaturity,
                    patternMaturity: patternMaturity,
                    marketMaturity: marketMaturity,
                    riskMaturity: riskMaturity,
                    historicalMaturity: historicalMaturity
                },
                qualityAssessment: qualityAssessment,
                vivoRecommendation: vivoRecommendation,
                confidence: confidence,
                improvementSuggestions: improvementSuggestions,
                readinessAssessment: readinessAssessment,
                notes: this.generateNotes(maturityScore, maturityLevel, qualityAssessment),
                metadata: {
                    analysisTimestamp: Date.now(),
                    signalAge: this.calculateSignalAge(signalTimestamp),
                    maturityTrend: this.analyzeMaturityTrend(signalType),
                    completionPercentage: this.calculateCompletionPercentage(maturityScore),
                    nextMilestone: this.getNextMilestone(maturityScore)
                }
            };

            // Signal history güncelleme
            this.updateSignalHistory(result, data);

            // Cache ve performance tracking
            this.updateCache(data, result);
            this.trackPerformance(Date.now(), result.isSignalMature);

            return result;

        } catch (error) {
            this.handleError('SignalMaturityScorer analysis failed', error, data);
            return this.getDefaultResult();
        }
    }

    calculateTimeMaturity(formationDuration, timeframe) {
        if (!formationDuration) return 5.0; // Default moderate

        // Timeframe'e göre minimum formation süreleri
        const minimumDurations = {
            '1m': 5,    // 5 dakika
            '5m': 25,   // 25 dakika
            '15m': 75,  // 75 dakika
            '1h': 240,  // 4 saat
            '4h': 960,  // 16 saat
            '1d': 2880  // 2 gün
        };

        const minDuration = minimumDurations[timeframe] || 60;
        
        // Formation süresi maturity hesaplama
        if (formationDuration >= minDuration * 2) {
            return 10.0; // Çok olgun
        } else if (formationDuration >= minDuration * 1.5) {
            return 8.5; // Olgun
        } else if (formationDuration >= minDuration) {
            return 7.0; // Yeterli
        } else if (formationDuration >= minDuration * 0.5) {
            return 4.0; // Gelişen
        } else {
            return 2.0; // Erken
        }
    }

    calculateVolumeMaturity(volumeConfirmation, signalStrength) {
        if (!volumeConfirmation) return 3.0; // Default low

        let volumeScore = 0;

        // Volume confirmation level
        if (volumeConfirmation.level === 'strong') {
            volumeScore += 4.0;
        } else if (volumeConfirmation.level === 'moderate') {
            volumeScore += 2.5;
        } else if (volumeConfirmation.level === 'weak') {
            volumeScore += 1.0;
        }

        // Volume trend
        if (volumeConfirmation.trend === 'increasing') {
            volumeScore += 2.0;
        } else if (volumeConfirmation.trend === 'stable') {
            volumeScore += 1.0;
        }

        // Signal strength ile volume uyumu
        if (signalStrength > 0.7 && volumeConfirmation.level === 'strong') {
            volumeScore += 2.0; // Bonus for alignment
        }

        // Volume consistency
        if (volumeConfirmation.consistency > 0.8) {
            volumeScore += 1.5;
        }

        return Math.min(10, volumeScore);
    }

    calculateIndicatorMaturity(indicatorAlignment, confirmationCount) {
        if (!indicatorAlignment) return 3.0;

        let indicatorScore = 0;

        // Alignment strength
        if (indicatorAlignment.strength > 0.8) {
            indicatorScore += 3.5;
        } else if (indicatorAlignment.strength > 0.6) {
            indicatorScore += 2.5;
        } else if (indicatorAlignment.strength > 0.4) {
            indicatorScore += 1.5;
        }

        // Number of confirming indicators
        if (confirmationCount >= 5) {
            indicatorScore += 3.0;
        } else if (confirmationCount >= 3) {
            indicatorScore += 2.0;
        } else if (confirmationCount >= 2) {
            indicatorScore += 1.0;
        }

        // Alignment consistency
        if (indicatorAlignment.consistency > 0.9) {
            indicatorScore += 2.0;
        } else if (indicatorAlignment.consistency > 0.7) {
            indicatorScore += 1.0;
        }

        // Divergence penalty
        if (indicatorAlignment.divergence > 0.3) {
            indicatorScore -= 2.0;
        }

        return Math.max(0, Math.min(10, indicatorScore));
    }

    calculatePatternMaturity(patternCompleteness, signalType) {
        if (!patternCompleteness) return 4.0;

        let patternScore = 0;

        // Completion percentage
        if (patternCompleteness.percentage >= 0.9) {
            patternScore += 4.0;
        } else if (patternCompleteness.percentage >= 0.75) {
            patternScore += 3.0;
        } else if (patternCompleteness.percentage >= 0.5) {
            patternScore += 2.0;
        } else {
            patternScore += 1.0;
        }

        // Pattern quality
        if (patternCompleteness.quality === 'excellent') {
            patternScore += 3.0;
        } else if (patternCompleteness.quality === 'good') {
            patternScore += 2.0;
        } else if (patternCompleteness.quality === 'fair') {
            patternScore += 1.0;
        }

        // Signal type specific adjustments
        const typeMultipliers = {
            'breakout': 1.2,
            'reversal': 1.1,
            'continuation': 1.0,
            'range': 0.9
        };

        const multiplier = typeMultipliers[signalType] || 1.0;
        patternScore *= multiplier;

        // Pattern confirmation
        if (patternCompleteness.confirmed) {
            patternScore += 1.5;
        }

        return Math.min(10, patternScore);
    }

    calculateMarketMaturity(marketCondition, trendAlignment) {
        if (!marketCondition) return 5.0;

        let marketScore = 5.0; // Base score

        // Market condition assessment
        const conditionScores = {
            'trending': 3.5,
            'ranging': 2.0,
            'volatile': 1.0,
            'stable': 2.5,
            'uncertain': 0.5
        };

        marketScore += conditionScores[marketCondition] || 1.0;

        // Trend alignment
        if (trendAlignment) {
            if (trendAlignment.strength > 0.8) {
                marketScore += 2.0;
            } else if (trendAlignment.strength > 0.6) {
                marketScore += 1.5;
            } else if (trendAlignment.strength > 0.4) {
                marketScore += 1.0;
            }

            // Direction consistency
            if (trendAlignment.consistency > 0.8) {
                marketScore += 1.0;
            }
        }

        return Math.min(10, marketScore);
    }

    calculateRiskMaturity(riskRewardRatio, volatilityLevel) {
        if (!riskRewardRatio) return 3.0;

        let riskScore = 0;

        // Risk/Reward ratio assessment
        if (riskRewardRatio >= 3.0) {
            riskScore += 4.0;
        } else if (riskRewardRatio >= 2.0) {
            riskScore += 3.0;
        } else if (riskRewardRatio >= 1.5) {
            riskScore += 2.0;
        } else if (riskRewardRatio >= 1.0) {
            riskScore += 1.0;
        }

        // Volatility assessment
        if (volatilityLevel !== undefined) {
            if (volatilityLevel < 1.0) {
                riskScore += 2.0; // Low volatility bonus
            } else if (volatilityLevel < 2.0) {
                riskScore += 1.0; // Moderate volatility
            } else if (volatilityLevel > 3.0) {
                riskScore -= 1.0; // High volatility penalty
            }
        }

        // Risk management factors
        riskScore += 2.0; // Base risk management score

        return Math.max(0, Math.min(10, riskScore));
    }

    calculateHistoricalMaturity(signalType, priceLevel) {
        if (!signalType) return 5.0;

        // Historical success rate için signal history kontrol
        const historicalSignals = this.signalHistory.filter(signal => 
            signal.signalType === signalType && 
            Math.abs(signal.priceLevel - priceLevel) / priceLevel < 0.05 // %5 price vicinity
        );

        if (historicalSignals.length === 0) return 5.0; // No history

        const successfulSignals = historicalSignals.filter(signal => 
            signal.outcome === 'successful'
        );

        const successRate = successfulSignals.length / historicalSignals.length;

        // Success rate'e göre scoring
        if (successRate >= 0.8) {
            return 9.0; // Excellent historical performance
        } else if (successRate >= 0.6) {
            return 7.0; // Good historical performance
        } else if (successRate >= 0.4) {
            return 5.0; // Average historical performance
        } else if (successRate >= 0.2) {
            return 3.0; // Poor historical performance
        } else {
            return 1.0; // Very poor historical performance
        }
    }

    calculateOverallMaturityScore(factors) {
        const {
            timeMaturity,
            volumeMaturity,
            indicatorMaturity,
            patternMaturity,
            marketMaturity,
            riskMaturity,
            historicalMaturity
        } = factors;

        const score = 
            (timeMaturity * this.maturityFactors.timeInFormation) +
            (volumeMaturity * this.maturityFactors.volumeConfirmation) +
            (indicatorMaturity * this.maturityFactors.multipleIndicatorAlignment) +
            (patternMaturity * this.maturityFactors.patternCompleteness) +
            (marketMaturity * this.maturityFactors.marketConditionFit) +
            (riskMaturity * this.maturityFactors.riskRewardRatio) +
            (historicalMaturity * this.maturityFactors.historicalSuccess);

        return Math.max(0, Math.min(10, score));
    }

    determineMaturityLevel(maturityScore) {
        if (maturityScore >= this.maturityThresholds.mature) {
            return 'mature';
        } else if (maturityScore >= this.maturityThresholds.developing) {
            return 'developing';
        } else {
            return 'premature';
        }
    }

    assessSignalQuality(data, maturityScore) {
        const { signalStrength, volumeConfirmation, indicatorAlignment } = data;

        let qualityScore = maturityScore * 0.7; // Base from maturity

        // Signal strength contribution
        if (signalStrength > 0.8) {
            qualityScore += 1.0;
        } else if (signalStrength > 0.6) {
            qualityScore += 0.5;
        }

        // Volume confirmation quality
        if (volumeConfirmation && volumeConfirmation.level === 'strong') {
            qualityScore += 1.0;
        }

        // Indicator alignment quality
        if (indicatorAlignment && indicatorAlignment.strength > 0.8) {
            qualityScore += 0.8;
        }

        const normalizedScore = Math.min(10, qualityScore);

        let quality = 'poor';
        if (normalizedScore >= 8.5) quality = 'excellent';
        else if (normalizedScore >= 7.0) quality = 'good';
        else if (normalizedScore >= 5.5) quality = 'fair';
        else if (normalizedScore >= 4.0) quality = 'below_average';

        return {
            score: normalizedScore,
            level: quality,
            factors: {
                maturityContribution: maturityScore * 0.7,
                strengthContribution: signalStrength > 0.8 ? 1.0 : (signalStrength > 0.6 ? 0.5 : 0),
                volumeContribution: volumeConfirmation?.level === 'strong' ? 1.0 : 0,
                indicatorContribution: indicatorAlignment?.strength > 0.8 ? 0.8 : 0
            }
        };
    }

    generateVivoRecommendation(maturityScore, maturityLevel, qualityAssessment) {
        let action = 'hold';
        let priority = 'normal';
        let confidence = 0.5;

        if (maturityLevel === 'mature' && qualityAssessment.level === 'excellent') {
            action = 'proceed_high_priority';
            priority = 'high';
            confidence = 0.9;
        } else if (maturityLevel === 'mature' && qualityAssessment.level === 'good') {
            action = 'proceed_normal';
            priority = 'normal';
            confidence = 0.8;
        } else if (maturityLevel === 'developing' && qualityAssessment.score > 6.0) {
            action = 'proceed_cautious';
            priority = 'low';
            confidence = 0.6;
        } else if (maturityLevel === 'developing') {
            action = 'wait_for_maturity';
            priority = 'hold';
            confidence = 0.4;
        } else {
            action = 'reject_premature';
            priority = 'none';
            confidence = 0.2;
        }

        return {
            action: action,
            priority: priority,
            confidence: confidence,
            reasoning: this.getRecommendationReasoning(maturityLevel, qualityAssessment),
            waitTime: this.calculateWaitTime(maturityScore, maturityLevel)
        };
    }

    generateImprovementSuggestions(maturityScore, data) {
        const suggestions = [];

        // Time maturity improvement
        if (data.formationDuration < 60) {
            suggestions.push({
                factor: 'time',
                suggestion: 'Wait for longer formation development',
                impact: 'medium'
            });
        }

        // Volume confirmation improvement
        if (!data.volumeConfirmation || data.volumeConfirmation.level === 'weak') {
            suggestions.push({
                factor: 'volume',
                suggestion: 'Wait for stronger volume confirmation',
                impact: 'high'
            });
        }

        // Indicator alignment improvement
        if (!data.indicatorAlignment || data.indicatorAlignment.strength < 0.6) {
            suggestions.push({
                factor: 'indicators',
                suggestion: 'Wait for better indicator alignment',
                impact: 'medium'
            });
        }

        // Risk/reward improvement
        if (!data.riskRewardRatio || data.riskRewardRatio < 1.5) {
            suggestions.push({
                factor: 'risk_reward',
                suggestion: 'Improve risk/reward ratio or wait for better entry',
                impact: 'high'
            });
        }

        return suggestions;
    }

    assessSignalReadiness(maturityScore, maturityLevel, data) {
        const readiness = {
            isReady: maturityLevel === 'mature',
            readinessPercentage: (maturityScore / this.maturityThresholds.mature) * 100,
            blockers: [],
            enhancers: []
        };

        // Check for blockers
        if (maturityScore < this.maturityThresholds.developing) {
            readiness.blockers.push('insufficient_overall_maturity');
        }

        if (!data.volumeConfirmation || data.volumeConfirmation.level === 'weak') {
            readiness.blockers.push('weak_volume_confirmation');
        }

        if (!data.riskRewardRatio || data.riskRewardRatio < 1.0) {
            readiness.blockers.push('poor_risk_reward_ratio');
        }

        // Check for enhancers
        if (data.signalStrength > 0.8) {
            readiness.enhancers.push('strong_signal_strength');
        }

        if (data.indicatorAlignment && data.indicatorAlignment.strength > 0.8) {
            readiness.enhancers.push('excellent_indicator_alignment');
        }

        if (data.patternCompleteness && data.patternCompleteness.percentage > 0.9) {
            readiness.enhancers.push('complete_pattern_formation');
        }

        return readiness;
    }

    generateNotes(maturityScore, maturityLevel, qualityAssessment) {
        const notes = [];

        if (maturityLevel === 'mature') {
            notes.push(`Sinyal olgun ve VIVO'ya geçmeye hazır (Skor: ${maturityScore.toFixed(1)})`);
        } else if (maturityLevel === 'developing') {
            notes.push(`Sinyal gelişiyor, daha fazla zaman gerekli (Skor: ${maturityScore.toFixed(1)})`);
        } else {
            notes.push(`Sinyal henüz çok erken (Skor: ${maturityScore.toFixed(1)})`);
        }

        if (qualityAssessment.level === 'excellent') {
            notes.push("Mükemmel sinyal kalitesi");
        } else if (qualityAssessment.level === 'poor') {
            notes.push("Sinyal kalitesi düşük");
        }

        return notes.join('. ');
    }

    updateSignalHistory(result, data) {
        this.signalHistory.push({
            timestamp: Date.now(),
            signalType: data.signalType,
            priceLevel: data.priceLevel,
            maturityScore: result.maturityScore,
            maturityLevel: result.maturityLevel,
            qualityLevel: result.qualityAssessment.level,
            vivoAction: result.vivoRecommendation.action,
            outcome: null // To be updated later based on actual performance
        });

        // History size limit
        if (this.signalHistory.length > this.maxHistorySize) {
            this.signalHistory = this.signalHistory.slice(-this.maxHistorySize);
        }
    }

    calculateSignalAge(signalTimestamp) {
        if (!signalTimestamp) return 0;
        return Date.now() - signalTimestamp;
    }

    analyzeMaturityTrend(signalType) {
        const recentSignals = this.signalHistory
            .filter(signal => signal.signalType === signalType)
            .slice(-10);

        if (recentSignals.length < 3) return 'insufficient_data';

        const scores = recentSignals.map(signal => signal.maturityScore);
        const trend = scores[scores.length - 1] - scores[0];

        if (trend > 1.0) return 'improving';
        if (trend < -1.0) return 'deteriorating';
        return 'stable';
    }

    calculateCompletionPercentage(maturityScore) {
        return Math.min(100, (maturityScore / this.maturityThresholds.mature) * 100);
    }

    getNextMilestone(maturityScore) {
        if (maturityScore < this.maturityThresholds.premature) {
            return { level: 'premature', target: this.maturityThresholds.premature, gap: this.maturityThresholds.premature - maturityScore };
        } else if (maturityScore < this.maturityThresholds.developing) {
            return { level: 'developing', target: this.maturityThresholds.developing, gap: this.maturityThresholds.developing - maturityScore };
        } else if (maturityScore < this.maturityThresholds.mature) {
            return { level: 'mature', target: this.maturityThresholds.mature, gap: this.maturityThresholds.mature - maturityScore };
        } else {
            return { level: 'complete', target: 10, gap: 0 };
        }
    }

    getDefaultResult() {
        return {
            isSignalMature: false,
            maturityScore: 0,
            maturityLevel: 'premature',
            maturityFactors: {
                timeMaturity: 0,
                volumeMaturity: 0,
                indicatorMaturity: 0,
                patternMaturity: 0,
                marketMaturity: 0,
                riskMaturity: 0,
                historicalMaturity: 0
            },
            qualityAssessment: {
                score: 0,
                level: 'poor',
                factors: {}
            },
            vivoRecommendation: {
                action: 'reject_premature',
                priority: 'none',
                confidence: 0,
                reasoning: 'Insufficient data for analysis',
                waitTime: 0
            },
            confidence: 0,
            improvementSuggestions: [],
            readinessAssessment: {
                isReady: false,
                readinessPercentage: 0,
                blockers: ['insufficient_data'],
                enhancers: []
            },
            notes: "Sinyal olgunluk analizi yapılamadı - yetersiz veri",
            metadata: {
                error: true,
                analysisTimestamp: Date.now()
            }
        };
    }

    getModuleInfo() {
        return {
            name: 'SignalMaturityScorer',
            version: '1.0.0',
            description: 'Sinyal olgunluğu ve VIVO geçiş kararı analizi',
            inputs: [
                'signalType', 'signalStrength', 'formationDuration', 'volumeConfirmation',
                'indicatorAlignment', 'patternCompleteness', 'marketCondition', 'riskRewardRatio',
                'supportResistanceLevel', 'trendAlignment', 'momentumSupport', 'volatilityLevel',
                'timeframe', 'signalTimestamp', 'priceLevel', 'confirmationCount'
            ],
            outputs: [
                'isSignalMature', 'maturityScore', 'maturityLevel', 'maturityFactors',
                'qualityAssessment', 'vivoRecommendation', 'confidence', 'improvementSuggestions',
                'readinessAssessment', 'notes', 'metadata'
            ]
        };
    }
}

module.exports = SignalMaturityScorer;
