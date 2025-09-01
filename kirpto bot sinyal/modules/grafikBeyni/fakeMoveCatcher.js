const GrafikBeyniModuleBase = require('./grafikBeyniModuleBase');

/**
 * Fake Move Catcher Module
 * Hacimsiz yükseliş ve yanıltıcı fiyat hareketlerini tespit eder
 * Volume confirmation olmayan price action'ları filtreler ve güvensiz sinyal ortamı oluşturur
 */
class FakeMoveCatcher extends GrafikBeyniModuleBase {
    constructor() {
        super('fakeMoveCatcher');
        this.recentMoves = [];
        this.volumeThresholds = {
            minimal: 0.3,
            low: 0.5,
            normal: 1.0,
            high: 1.5
        };
        this.fakeSignalHistory = [];
        this.maxHistorySize = 50;
        this.confirmationTimeWindow = 5 * 60 * 1000; // 5 dakika
    }

    async analyze(data) {
        try {
            const {
                priceChange,
                priceChangePercentage,
                volume,
                averageVolume,
                timeframe,
                priceAction,
                breakoutLevel,
                supportResistanceLevel,
                trendStrength,
                momentumScore,
                marketCondition,
                volatility,
                orderBookImbalance,
                marketCap
            } = data;

            // Veri doğrulama
            if (priceChange === undefined || volume === undefined || averageVolume === undefined) {
                throw new Error('Missing required data for fake move analysis');
            }

            // Volume ratio hesaplama
            const volumeRatio = averageVolume > 0 ? volume / averageVolume : 0;

            // Fake move tespiti
            const fakeMovAnalysis = this.detectFakeMove(data, volumeRatio);

            // Volume-price divergence analizi
            const volumePriceDivergence = this.analyzeVolumePriceDivergence(data, volumeRatio);

            // Breakout validation
            const breakoutValidity = this.validateBreakout(data, volumeRatio);

            // Momentum vs Volume consistency
            const momentumVolumeConsistency = this.analyzeMomentumVolumeConsistency(data, volumeRatio);

            // Market manipulation signals
            const manipulationSignals = this.detectManipulationSignals(data, volumeRatio);

            // Overall fake move score
            const fakeMoveScore = this.calculateFakeMoveScore(fakeMovAnalysis, volumePriceDivergence, breakoutValidity, momentumVolumeConsistency);

            // Signal environment assessment
            const signalEnvironment = this.assessSignalEnvironment(fakeMoveScore, manipulationSignals);

            // Recommendations oluşturma
            const recommendations = this.generateRecommendations(fakeMoveScore, signalEnvironment, data);

            const result = {
                isFakeMoveDetected: fakeMoveScore > 6.0,
                fakeMoveScore: fakeMoveScore,
                volumeRatio: volumeRatio,
                fakeMovAnalysis: fakeMovAnalysis,
                volumePriceDivergence: volumePriceDivergence,
                breakoutValidity: breakoutValidity,
                momentumVolumeConsistency: momentumVolumeConsistency,
                manipulationSignals: manipulationSignals,
                signalEnvironment: signalEnvironment,
                recommendations: recommendations,
                notes: this.generateNotes(fakeMoveScore, fakeMovAnalysis, signalEnvironment),
                metadata: {
                    analysisTimestamp: Date.now(),
                    volumeCategory: this.categorizeVolume(volumeRatio),
                    riskLevel: this.calculateRiskLevel(fakeMoveScore, signalEnvironment),
                    historicalPattern: this.analyzeHistoricalPattern(),
                    confidence: this.calculateConfidence(fakeMoveScore, data)
                }
            };

            // Fake signal history güncelleme
            if (result.isFakeMoveDetected) {
                this.updateFakeSignalHistory(result);
            }

            // Recent moves güncelleme
            this.updateRecentMoves(data, result);

            // Cache ve performance tracking
            this.updateCache(data, result);
            this.trackPerformance(Date.now(), result.isFakeMoveDetected);

            return result;

        } catch (error) {
            this.handleError('FakeMoveCatcher analysis failed', error, data);
            return this.getDefaultResult();
        }
    }

    detectFakeMove(data, volumeRatio) {
        const {
            priceChangePercentage,
            priceAction,
            breakoutLevel,
            trendStrength
        } = data;

        const signals = [];
        let fakeScore = 0;

        // Yüksek fiyat değişimi + düşük volume
        if (Math.abs(priceChangePercentage) > 2.0 && volumeRatio < this.volumeThresholds.minimal) {
            signals.push('high_price_low_volume');
            fakeScore += 3.0;
        }

        // Breakout ama volume desteği yok
        if (breakoutLevel && volumeRatio < this.volumeThresholds.normal) {
            signals.push('unconfirmed_breakout');
            fakeScore += 2.5;
        }

        // Strong trend claim ama volume weak
        if (trendStrength > 0.7 && volumeRatio < this.volumeThresholds.low) {
            signals.push('weak_volume_strong_trend_claim');
            fakeScore += 2.0;
        }

        // Ani fiyat sıçraması
        if (Math.abs(priceChangePercentage) > 5.0 && volumeRatio < this.volumeThresholds.low) {
            signals.push('price_spike_without_volume');
            fakeScore += 4.0;
        }

        // Consistent low volume pattern
        const recentLowVolume = this.checkRecentLowVolumePattern();
        if (recentLowVolume && Math.abs(priceChangePercentage) > 1.0) {
            signals.push('persistent_low_volume_moves');
            fakeScore += 1.5;
        }

        return {
            signals: signals,
            score: fakeScore,
            severity: this.getFakeMoveSeverity(fakeScore),
            description: this.describeFakeMove(signals)
        };
    }

    analyzeVolumePriceDivergence(data, volumeRatio) {
        const {
            priceChangePercentage,
            momentumScore,
            volatility
        } = data;

        const divergenceScore = 0;
        const divergenceType = 'none';

        // Fiyat yükselirken volume azalıyor
        if (priceChangePercentage > 1.0 && volumeRatio < this.volumeThresholds.low) {
            divergenceScore = 2.5;
            divergenceType = 'bearish_divergence';
        }
        // Fiyat düşerken volume azalıyor (bear trap olabilir)
        else if (priceChangePercentage < -1.0 && volumeRatio < this.volumeThresholds.low) {
            divergenceScore = 2.0;
            divergenceType = 'potential_bear_trap';
        }
        // Momentum var ama volume yok
        else if (momentumScore > 0.6 && volumeRatio < this.volumeThresholds.normal) {
            divergenceScore = 1.8;
            divergenceType = 'momentum_volume_mismatch';
        }

        return {
            score: divergenceScore,
            type: divergenceType,
            strength: this.getDivergenceStrength(divergenceScore),
            reliability: this.calculateDivergenceReliability(data, volumeRatio)
        };
    }

    validateBreakout(data, volumeRatio) {
        const {
            breakoutLevel,
            supportResistanceLevel,
            priceChangePercentage,
            volatility
        } = data;

        if (!breakoutLevel && !supportResistanceLevel) {
            return { isValid: true, confidence: 1.0, reason: 'no_breakout_detected' };
        }

        let validityScore = 10; // Başlangıç: geçerli
        const issues = [];

        // Volume confirmation eksikliği
        if (volumeRatio < this.volumeThresholds.normal) {
            validityScore -= 4;
            issues.push('insufficient_volume');
        }

        // Çok zayıf volume ile breakout
        if (volumeRatio < this.volumeThresholds.minimal && Math.abs(priceChangePercentage) > 2.0) {
            validityScore -= 6;
            issues.push('critical_volume_shortage');
        }

        // Volatility ile volume uyumsuzluğu
        if (volatility > 2.0 && volumeRatio < this.volumeThresholds.low) {
            validityScore -= 3;
            issues.push('volatility_volume_mismatch');
        }

        const isValid = validityScore > 5;
        const confidence = Math.max(0, validityScore / 10);

        return {
            isValid: isValid,
            confidence: confidence,
            score: validityScore,
            issues: issues,
            recommendation: this.getBreakoutRecommendation(isValid, confidence)
        };
    }

    analyzeMomentumVolumeConsistency(data, volumeRatio) {
        const {
            momentumScore,
            trendStrength,
            priceChangePercentage
        } = data;

        let consistencyScore = 10; // Perfect consistency başlangıcı
        const inconsistencies = [];

        // Yüksek momentum ama düşük volume
        if (momentumScore > 0.7 && volumeRatio < this.volumeThresholds.normal) {
            consistencyScore -= 3;
            inconsistencies.push('high_momentum_low_volume');
        }

        // Strong trend claim ama volume desteği yok
        if (trendStrength > 0.8 && volumeRatio < this.volumeThresholds.low) {
            consistencyScore -= 4;
            inconsistencies.push('strong_trend_weak_volume');
        }

        // Büyük fiyat hareketi ama momentum/volume uyumsuz
        if (Math.abs(priceChangePercentage) > 3.0 && 
            (momentumScore < 0.5 || volumeRatio < this.volumeThresholds.low)) {
            consistencyScore -= 5;
            inconsistencies.push('price_momentum_volume_mismatch');
        }

        return {
            score: consistencyScore,
            isConsistent: consistencyScore > 6,
            inconsistencies: inconsistencies,
            reliability: this.calculateConsistencyReliability(consistencyScore)
        };
    }

    detectManipulationSignals(data, volumeRatio) {
        const {
            orderBookImbalance,
            priceChangePercentage,
            volatility,
            marketCondition
        } = data;

        const signals = [];
        let manipulationScore = 0;

        // Sudden price spike with minimal volume
        if (Math.abs(priceChangePercentage) > 4.0 && volumeRatio < this.volumeThresholds.minimal) {
            signals.push('artificial_price_spike');
            manipulationScore += 3.0;
        }

        // Order book imbalance ile fiyat manipülasyonu
        if (orderBookImbalance && Math.abs(orderBookImbalance) > 0.7 && volumeRatio < this.volumeThresholds.low) {
            signals.push('order_book_manipulation');
            manipulationScore += 2.5;
        }

        // Volatility spike without volume support
        if (volatility > 3.0 && volumeRatio < this.volumeThresholds.normal) {
            signals.push('artificial_volatility');
            manipulationScore += 2.0;
        }

        // Market condition inconsistency
        if (marketCondition === 'trending' && volumeRatio < this.volumeThresholds.minimal) {
            signals.push('fake_trend_signal');
            manipulationScore += 1.5;
        }

        return {
            signals: signals,
            score: manipulationScore,
            riskLevel: this.getManipulationRiskLevel(manipulationScore),
            confidence: this.calculateManipulationConfidence(signals.length, data)
        };
    }

    calculateFakeMoveScore(fakeMovAnalysis, volumePriceDivergence, breakoutValidity, momentumVolumeConsistency) {
        let totalScore = 0;

        // Fake move analysis weight: 40%
        totalScore += fakeMovAnalysis.score * 0.4;

        // Volume-price divergence weight: 25%
        totalScore += volumePriceDivergence.score * 0.25;

        // Breakout validity (inverse) weight: 20%
        totalScore += (10 - breakoutValidity.score) * 0.2;

        // Momentum-volume consistency (inverse) weight: 15%
        totalScore += (10 - momentumVolumeConsistency.score) * 0.15;

        return Math.max(0, totalScore);
    }

    assessSignalEnvironment(fakeMoveScore, manipulationSignals) {
        let environment = 'safe';
        let trustLevel = 'high';
        let recommendation = 'proceed_normal';

        if (fakeMoveScore > 8.0 || manipulationSignals.score > 4.0) {
            environment = 'dangerous';
            trustLevel = 'very_low';
            recommendation = 'avoid_trading';
        } else if (fakeMoveScore > 6.0 || manipulationSignals.score > 2.5) {
            environment = 'risky';
            trustLevel = 'low';
            recommendation = 'extreme_caution';
        } else if (fakeMoveScore > 4.0 || manipulationSignals.score > 1.5) {
            environment = 'uncertain';
            trustLevel = 'moderate';
            recommendation = 'increase_confirmation';
        }

        return {
            environment: environment,
            trustLevel: trustLevel,
            recommendation: recommendation,
            safetyScore: Math.max(0, 10 - fakeMoveScore - manipulationSignals.score)
        };
    }

    generateRecommendations(fakeMoveScore, signalEnvironment, data) {
        const recommendations = {};

        if (fakeMoveScore > 8.0) {
            recommendations.vivo = 'blockAllSignals';
            recommendations.entryGatekeeper = 'emergencyBlock';
            recommendations.volumeConfirmBreakout = 'requireHighVolume';
            recommendations.tpOptimizer = 'disableOptimization';
        } else if (fakeMoveScore > 6.0) {
            recommendations.vivo = 'requireTripleConfirmation';
            recommendations.entryGatekeeper = 'delayEntry';
            recommendations.volumeConfirmBreakout = 'strictVolumeCheck';
            recommendations.momentumValidator = 'increaseThreshold';
        } else if (fakeMoveScore > 4.0) {
            recommendations.vivo = 'requireAdditionalConfirmation';
            recommendations.volumeConfirmBreakout = 'enhancedVolumeCheck';
            recommendations.falseBreakFilter = 'enableStrictMode';
        }

        // Signal environment based recommendations
        if (signalEnvironment.environment === 'dangerous') {
            recommendations.coreOrchestrator = 'activateEmergencyMode';
            recommendations.liquidityStressScanner = 'maximumVigilance';
        }

        return recommendations;
    }

    generateNotes(fakeMoveScore, fakeMovAnalysis, signalEnvironment) {
        const notes = [];

        if (fakeMoveScore > 8.0) {
            notes.push("Kritik seviye fake move tespit edildi. İşlem yapılmamalı.");
        } else if (fakeMoveScore > 6.0) {
            notes.push("Yüksek fake move riski. Hacimsiz yükseliş/düşüş pattern'i tespit edildi.");
        }

        if (fakeMovAnalysis.signals.includes('high_price_low_volume')) {
            notes.push("Yüksek fiyat değişimi ama volume desteği yok.");
        }

        if (fakeMovAnalysis.signals.includes('unconfirmed_breakout')) {
            notes.push("Breakout volume confirmation eksikliği.");
        }

        if (signalEnvironment.environment === 'dangerous') {
            notes.push("Güvensiz sinyal ortamı - potansiyel manipülasyon.");
        }

        return notes.join(' ');
    }

    // Helper methods
    categorizeVolume(volumeRatio) {
        if (volumeRatio < this.volumeThresholds.minimal) return 'critically_low';
        if (volumeRatio < this.volumeThresholds.low) return 'low';
        if (volumeRatio < this.volumeThresholds.normal) return 'below_average';
        if (volumeRatio < this.volumeThresholds.high) return 'normal';
        return 'high';
    }

    getFakeMoveSeverity(score) {
        if (score > 8) return 'critical';
        if (score > 6) return 'high';
        if (score > 4) return 'moderate';
        if (score > 2) return 'low';
        return 'minimal';
    }

    describeFakeMove(signals) {
        if (signals.includes('high_price_low_volume')) {
            return 'Hacimsiz fiyat hareketi tespit edildi';
        }
        if (signals.includes('unconfirmed_breakout')) {
            return 'Volume desteği olmayan breakout';
        }
        if (signals.includes('price_spike_without_volume')) {
            return 'Volume olmadan ani fiyat sıçraması';
        }
        return 'Genel fake move pattern';
    }

    checkRecentLowVolumePattern() {
        if (this.recentMoves.length < 3) return false;
        
        const recent3 = this.recentMoves.slice(-3);
        return recent3.every(move => move.volumeRatio < this.volumeThresholds.low);
    }

    updateRecentMoves(data, result) {
        this.recentMoves.push({
            timestamp: Date.now(),
            priceChange: data.priceChangePercentage,
            volumeRatio: result.volumeRatio,
            fakeMoveScore: result.fakeMoveScore
        });

        if (this.recentMoves.length > 20) {
            this.recentMoves = this.recentMoves.slice(-20);
        }
    }

    updateFakeSignalHistory(result) {
        this.fakeSignalHistory.push({
            timestamp: Date.now(),
            score: result.fakeMoveScore,
            signals: result.fakeMovAnalysis.signals,
            environment: result.signalEnvironment.environment
        });

        if (this.fakeSignalHistory.length > this.maxHistorySize) {
            this.fakeSignalHistory = this.fakeSignalHistory.slice(-this.maxHistorySize);
        }
    }

    analyzeHistoricalPattern() {
        if (this.fakeSignalHistory.length < 5) return 'insufficient_data';

        const recentFakes = this.fakeSignalHistory.slice(-10);
        const avgScore = recentFakes.reduce((sum, item) => sum + item.score, 0) / recentFakes.length;

        if (avgScore > 7) return 'high_fake_activity';
        if (avgScore > 5) return 'moderate_fake_activity';
        return 'low_fake_activity';
    }

    calculateConfidence(fakeMoveScore, data) {
        let confidence = 0.8; // Base confidence

        // Volume data quality
        if (data.averageVolume > 0) confidence += 0.1;
        
        // Multiple indicators available
        if (data.momentumScore !== undefined && data.trendStrength !== undefined) {
            confidence += 0.1;
        }

        // Clear signal strength
        if (fakeMoveScore > 8 || fakeMoveScore < 2) {
            confidence += 0.1;
        }

        return Math.min(1.0, confidence);
    }

    getDefaultResult() {
        return {
            isFakeMoveDetected: false,
            fakeMoveScore: 0,
            volumeRatio: 1.0,
            fakeMovAnalysis: {
                signals: [],
                score: 0,
                severity: 'minimal',
                description: 'Analiz yapılamadı'
            },
            volumePriceDivergence: {
                score: 0,
                type: 'none',
                strength: 'none',
                reliability: 0
            },
            breakoutValidity: {
                isValid: true,
                confidence: 0.5,
                score: 5,
                issues: [],
                recommendation: 'insufficient_data'
            },
            momentumVolumeConsistency: {
                score: 5,
                isConsistent: true,
                inconsistencies: [],
                reliability: 0.5
            },
            manipulationSignals: {
                signals: [],
                score: 0,
                riskLevel: 'low',
                confidence: 0.5
            },
            signalEnvironment: {
                environment: 'unknown',
                trustLevel: 'moderate',
                recommendation: 'insufficient_data',
                safetyScore: 5
            },
            recommendations: {},
            notes: "Fake move analizi yapılamadı - yetersiz veri",
            metadata: {
                error: true,
                analysisTimestamp: Date.now()
            }
        };
    }

    getModuleInfo() {
        return {
            name: 'FakeMoveCatcher',
            version: '1.0.0',
            description: 'Hacimsiz yükseliş ve yanıltıcı fiyat hareketi tespiti',
            inputs: [
                'priceChange', 'priceChangePercentage', 'volume', 'averageVolume',
                'timeframe', 'priceAction', 'breakoutLevel', 'supportResistanceLevel',
                'trendStrength', 'momentumScore', 'marketCondition', 'volatility',
                'orderBookImbalance', 'marketCap'
            ],
            outputs: [
                'isFakeMoveDetected', 'fakeMoveScore', 'volumeRatio', 'fakeMovAnalysis',
                'volumePriceDivergence', 'breakoutValidity', 'momentumVolumeConsistency',
                'manipulationSignals', 'signalEnvironment', 'recommendations', 'notes', 'metadata'
            ]
        };
    }
}

module.exports = FakeMoveCatcher;
