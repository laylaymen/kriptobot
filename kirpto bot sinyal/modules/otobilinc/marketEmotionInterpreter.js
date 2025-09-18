const GrafikBeyniModuleBase = require('../grafikBeyniModuleBase');

/**
 * Market Emotion Interpreter Module
 * Piyasanın genel psikolojik durumunu ölçer
 * FOMO, FUD, aşırı güven veya panik gibi duyguların teknik analiz sonuçlarını 
 * nasıl etkileyebileceğini değerlendirer
 * Karar süreçlerine "irrasyonel davranış filtresi" entegre eder
 */
class MarketEmotionInterpreter extends GrafikBeyniModuleBase {
    constructor() {
        super('marketEmotionInterpreter');
        this.emotionHistory = [];
        this.maxHistoryLength = 100;
        this.emotionThresholds = {
            fomo: 0.70,
            fud: 0.75,
            stable: 0.40
        };
    }

    async analyze(data) {
        try {
            const {
                btcDominance,
                usdtFundingRate,
                cryptoFearGreedIndex,
                newsSentimentScore,
                volumeSpike,
                socialSentiment,
                orderBookImbalance,
                marketCap24hChange,
                altcoinPerformance
            } = data;

            // Veri doğrulama
            if (btcDominance === undefined && cryptoFearGreedIndex === undefined) {
                throw new Error('Missing required data for market emotion analysis');
            }

            // Market emotion skorları hesapla
            const fearScore = this.calculateFearScore(data);
            const fomoScore = this.calculateFomoScore(data);
            const stabilityScore = this.calculateStabilityScore(data);

            // Dominant emotion belirleme
            const marketEmotion = this.determineMarketEmotion(fearScore, fomoScore, stabilityScore);
            
            // Emotion intensity hesaplama
            const emotionScore = this.calculateEmotionIntensity(marketEmotion, fearScore, fomoScore, stabilityScore);
            
            // Market phase analizi
            const marketPhase = this.analyzeMarketPhase(data, marketEmotion);

            const result = {
                marketEmotion: marketEmotion,
                emotionScore: emotionScore,
                emotionBreakdown: {
                    fear: fearScore,
                    fomo: fomoScore,
                    stability: stabilityScore
                },
                marketPhase: marketPhase,
                adjustmentRecommendations: this.generateAdjustmentRecommendations(marketEmotion, emotionScore, marketPhase),
                alert: this.generateAlert(marketEmotion, emotionScore, marketPhase),
                notes: this.generateNotes(marketEmotion, emotionScore, data),
                metadata: {
                    analysisTimestamp: Date.now(),
                    dataQuality: this.assessDataQuality(data),
                    emotionTrend: this.analyzeEmotionTrend(),
                    riskLevel: this.calculateEmotionRisk(marketEmotion, emotionScore)
                }
            };

            // Emotion geçmişi güncelleme
            this.updateEmotionHistory(result);
            
            // Cache ve performance tracking
            this.updateCache(data, result);
            this.trackPerformance(Date.now(), marketEmotion !== 'unknown');

            return result;

        } catch (error) {
            this.handleError('MarketEmotionInterpreter analysis failed', error, data);
            return this.getDefaultResult();
        }
    }

    calculateFearScore(data) {
        const {
            btcDominance,
            usdtFundingRate,
            cryptoFearGreedIndex,
            newsSentimentScore,
            volumeSpike,
            orderBookImbalance,
            marketCap24hChange
        } = data;

        let fearScore = 0;
        let totalWeight = 0;

        // Fear & Greed Index (ana gösterge)
        if (cryptoFearGreedIndex !== undefined) {
            // Düşük değerler korku gösterir (0-100 skala)
            const fearFromIndex = Math.max(0, (50 - cryptoFearGreedIndex) / 50);
            fearScore += fearFromIndex * 0.35;
            totalWeight += 0.35;
        }

        // BTC Dominance artışı (altcoin'lerden kaçış)
        if (btcDominance !== undefined) {
            // %60 üzeri dominance = korku göstergesi
            const fearFromDominance = btcDominance > 60 ? Math.min((btcDominance - 60) / 20, 1) : 0;
            fearScore += fearFromDominance * 0.20;
            totalWeight += 0.20;
        }

        // Negatif funding rate (short pozisyon fazlalığı)
        if (usdtFundingRate !== undefined) {
            const fearFromFunding = usdtFundingRate < -0.01 ? Math.min(Math.abs(usdtFundingRate) / 0.05, 1) : 0;
            fearScore += fearFromFunding * 0.15;
            totalWeight += 0.15;
        }

        // Negatif haber sentimenti
        if (newsSentimentScore !== undefined) {
            const fearFromNews = newsSentimentScore < -0.3 ? Math.min(Math.abs(newsSentimentScore + 0.3) / 0.7, 1) : 0;
            fearScore += fearFromNews * 0.15;
            totalWeight += 0.15;
        }

        // Volume spike ile negatif hareket (panik satış)
        if (volumeSpike === true && marketCap24hChange !== undefined && marketCap24hChange < -5) {
            fearScore += 0.10;
            totalWeight += 0.10;
        }

        // Order book imbalance (sell yönünde)
        if (orderBookImbalance !== undefined && orderBookImbalance < -0.2) {
            fearScore += Math.min(Math.abs(orderBookImbalance) / 0.5, 1) * 0.05;
            totalWeight += 0.05;
        }

        return totalWeight > 0 ? fearScore / totalWeight : 0;
    }

    calculateFomoScore(data) {
        const {
            btcDominance,
            usdtFundingRate,
            cryptoFearGreedIndex,
            newsSentimentScore,
            volumeSpike,
            orderBookImbalance,
            marketCap24hChange,
            altcoinPerformance
        } = data;

        let fomoScore = 0;
        let totalWeight = 0;

        // Fear & Greed Index (yüksek değerler aç gözlülük)
        if (cryptoFearGreedIndex !== undefined) {
            const fomoFromIndex = cryptoFearGreedIndex > 70 ? Math.min((cryptoFearGreedIndex - 70) / 30, 1) : 0;
            fomoScore += fomoFromIndex * 0.30;
            totalWeight += 0.30;
        }

        // Pozitif funding rate (long pozisyon fazlalığı)
        if (usdtFundingRate !== undefined) {
            const fomoFromFunding = usdtFundingRate > 0.02 ? Math.min(usdtFundingRate / 0.08, 1) : 0;
            fomoScore += fomoFromFunding * 0.20;
            totalWeight += 0.20;
        }

        // Pozitif haber sentimenti
        if (newsSentimentScore !== undefined) {
            const fomoFromNews = newsSentimentScore > 0.5 ? Math.min((newsSentimentScore - 0.5) / 0.5, 1) : 0;
            fomoScore += fomoFromNews * 0.15;
            totalWeight += 0.15;
        }

        // Volume spike ile pozitif hareket (FOMO alım)
        if (volumeSpike === true && marketCap24hChange !== undefined && marketCap24hChange > 10) {
            fomoScore += 0.15;
            totalWeight += 0.15;
        }

        // Order book imbalance (buy yönünde)
        if (orderBookImbalance !== undefined && orderBookImbalance > 0.3) {
            fomoScore += Math.min(orderBookImbalance / 0.5, 1) * 0.10;
            totalWeight += 0.10;
        }

        // Altcoin outperformance (risk iştahı artışı)
        if (altcoinPerformance !== undefined && altcoinPerformance > 15) {
            fomoScore += Math.min(altcoinPerformance / 30, 1) * 0.10;
            totalWeight += 0.10;
        }

        return totalWeight > 0 ? fomoScore / totalWeight : 0;
    }

    calculateStabilityScore(data) {
        const {
            btcDominance,
            usdtFundingRate,
            cryptoFearGreedIndex,
            newsSentimentScore,
            volumeSpike,
            orderBookImbalance
        } = data;

        let stabilityScore = 0;
        let totalWeight = 0;

        // Fear & Greed Index dengelilik
        if (cryptoFearGreedIndex !== undefined) {
            // 40-60 arası dengeli kabul edilir
            const stabilityFromIndex = cryptoFearGreedIndex >= 40 && cryptoFearGreedIndex <= 60 ? 1 : 
                                     Math.max(0, 1 - Math.abs(cryptoFearGreedIndex - 50) / 50);
            stabilityScore += stabilityFromIndex * 0.30;
            totalWeight += 0.30;
        }

        // BTC Dominance dengelilik (%45-65 normal)
        if (btcDominance !== undefined) {
            const stabilityFromDominance = btcDominance >= 45 && btcDominance <= 65 ? 1 : 
                                          Math.max(0, 1 - Math.abs(btcDominance - 55) / 20);
            stabilityScore += stabilityFromDominance * 0.25;
            totalWeight += 0.25;
        }

        // Funding rate dengelilik (-0.01 ile +0.01 arası)
        if (usdtFundingRate !== undefined) {
            const stabilityFromFunding = Math.abs(usdtFundingRate) <= 0.01 ? 1 : 
                                        Math.max(0, 1 - Math.abs(usdtFundingRate) / 0.05);
            stabilityScore += stabilityFromFunding * 0.20;
            totalWeight += 0.20;
        }

        // News sentiment nötrallik
        if (newsSentimentScore !== undefined) {
            const stabilityFromNews = Math.abs(newsSentimentScore) <= 0.2 ? 1 : 
                                     Math.max(0, 1 - Math.abs(newsSentimentScore) / 0.8);
            stabilityScore += stabilityFromNews * 0.15;
            totalWeight += 0.15;
        }

        // Volume spike yokluğu (istikrar)
        if (volumeSpike !== undefined) {
            stabilityScore += (volumeSpike === false ? 1 : 0) * 0.10;
            totalWeight += 0.10;
        }

        return totalWeight > 0 ? stabilityScore / totalWeight : 0;
    }

    determineMarketEmotion(fearScore, fomoScore, stabilityScore) {
        // En yüksek skora sahip emotion'ı seç ama threshold kontrolü yap
        const emotions = [
            { name: 'fud', score: fearScore, threshold: this.emotionThresholds.fud },
            { name: 'fomo', score: fomoScore, threshold: this.emotionThresholds.fomo },
            { name: 'stable', score: stabilityScore, threshold: this.emotionThresholds.stable }
        ];

        // Threshold'u geçen en yüksek skoru bul
        const validEmotions = emotions.filter(e => e.score >= e.threshold);
        
        if (validEmotions.length > 0) {
            return validEmotions.reduce((max, current) => max.score > current.score ? max : current).name;
        }

        // Hiçbiri threshold'u geçmezse en yüksek skoru döndür
        const maxEmotion = emotions.reduce((max, current) => max.score > current.score ? max : current);
        return maxEmotion.score > 0.3 ? maxEmotion.name : 'neutral';
    }

    calculateEmotionIntensity(marketEmotion, fearScore, fomoScore, stabilityScore) {
        switch (marketEmotion) {
            case 'fud':
                return fearScore;
            case 'fomo':
                return fomoScore;
            case 'stable':
                return stabilityScore;
            default:
                return Math.max(fearScore, fomoScore, stabilityScore);
        }
    }

    analyzeMarketPhase(data, marketEmotion) {
        const { marketCap24hChange, altcoinPerformance, btcDominance } = data;
        
        // Market phase belirleme
        let phase = 'unknown';
        
        if (marketEmotion === 'fomo' && marketCap24hChange > 5) {
            phase = 'euphoria';
        } else if (marketEmotion === 'fud' && marketCap24hChange < -10) {
            phase = 'capitulation';
        } else if (marketEmotion === 'stable' && Math.abs(marketCap24hChange || 0) < 3) {
            phase = 'consolidation';
        } else if (btcDominance > 65 && marketCap24hChange < 0) {
            phase = 'flight_to_safety';
        } else if (altcoinPerformance > 20) {
            phase = 'risk_on';
        } else {
            phase = 'transition';
        }

        return {
            phase: phase,
            confidence: this.calculatePhaseConfidence(phase, data),
            characteristics: this.getPhaseCharacteristics(phase)
        };
    }

    calculatePhaseConfidence(phase, data) {
        // Phase confidence basit algoritma ile hesaplanır
        const indicators = [];
        
        if (data.btcDominance !== undefined) indicators.push(1);
        if (data.marketCap24hChange !== undefined) indicators.push(1);
        if (data.altcoinPerformance !== undefined) indicators.push(1);
        if (data.cryptoFearGreedIndex !== undefined) indicators.push(1);
        
        return indicators.length / 4; // 4 ana gösterge
    }

    getPhaseCharacteristics(phase) {
        const characteristics = {
            euphoria: ['Yüksek risk iştahı', 'Altcoin rallisi', 'Aşırı iyimserlik'],
            capitulation: ['Panik satış', 'Likidite krizi', 'Aşırı kötümserlik'],
            consolidation: ['Yön arayışı', 'Düşük volatilite', 'Bekleme modu'],
            flight_to_safety: ['BTC\'ye kaçış', 'Risk azaltma', 'Güvenli liman'],
            risk_on: ['Altcoin performansı', 'Risk alma', 'Büyüme arayışı'],
            transition: ['Belirsizlik', 'Karma sinyaller', 'Trend değişimi']
        };
        
        return characteristics[phase] || ['Belirsiz piyasa koşulları'];
    }

    generateAdjustmentRecommendations(marketEmotion, emotionScore, marketPhase) {
        const recommendations = {};

        switch (marketEmotion) {
            case 'fud':
                recommendations.riskToRewardValidator = 'increaseRiskSensitivity';
                recommendations.exitTimingAdvisor = 'watchEarlyExitSignals';
                recommendations.vivo = 'delaySignalConfirmation';
                recommendations.tpOptimizer = 'useConservativeTP';
                break;
                
            case 'fomo':
                recommendations.riskToRewardValidator = 'requireHigherRR';
                recommendations.exitTimingAdvisor = 'watchOverextension';
                recommendations.tpOptimizer = 'limitTPLevels';
                recommendations.confirmationSignalBridge = 'requireExtraConfirmation';
                break;
                
            case 'stable':
                recommendations.riskToRewardValidator = 'normalParameters';
                recommendations.exitTimingAdvisor = 'standardTiming';
                recommendations.vivo = 'normalOperation';
                recommendations.tpOptimizer = 'standardTP';
                break;
                
            default:
                recommendations.all = 'useDefaultParameters';
        }

        // Market phase'e göre ek ayarlamalar
        if (marketPhase.phase === 'euphoria') {
            recommendations.coreOrchestrator = 'enableConservativeMode';
        } else if (marketPhase.phase === 'capitulation') {
            recommendations.coreOrchestrator = 'enableOpportunityMode';
        }

        return recommendations;
    }

    generateAlert(marketEmotion, emotionScore, marketPhase) {
        const intensity = emotionScore > 0.8 ? 'yüksek' : emotionScore > 0.6 ? 'orta' : 'düşük';
        
        switch (marketEmotion) {
            case 'fud':
                return `⚠️ ${intensity} seviye korku ortamı tespit edildi (${marketPhase.phase}). Panik satışlar olası.`;
            case 'fomo':
                return `🔥 ${intensity} seviye FOMO ortamı (${marketPhase.phase}). Aşırı alım riski yüksek.`;
            case 'stable':
                return `✅ Dengeli piyasa koşulları (${marketPhase.phase}). Normal işlem parametreleri uygun.`;
            default:
                return `📊 Karma piyasa duygusu (${marketPhase.phase}). Dikkatli izleme gerekli.`;
        }
    }

    generateNotes(marketEmotion, emotionScore, data) {
        const notes = [];
        
        if (marketEmotion === 'fud' && emotionScore > 0.75) {
            notes.push("Yüksek korku ortamı. Panik satışlar olası. Erken çıkış tetikleyicileri izlenmeli.");
        }
        
        if (marketEmotion === 'fomo' && emotionScore > 0.70) {
            notes.push("Aşırı iyimserlik. Bubble riski. TP3 seviyesi kısa tutulmalı.");
        }
        
        if (data.volumeSpike && marketEmotion !== 'stable') {
            notes.push("Volume spike ile emotion kombinasyonu. Ani hareket riski yüksek.");
        }
        
        if (data.btcDominance > 65) {
            notes.push("Yüksek BTC dominansı. Altcoin zayıflığı devam edebilir.");
        }

        return notes.length > 0 ? notes.join(' ') : "Market emotion analizi tamamlandı.";
    }

    assessDataQuality(data) {
        const requiredFields = ['btcDominance', 'cryptoFearGreedIndex', 'usdtFundingRate', 'newsSentimentScore'];
        const availableFields = requiredFields.filter(field => data[field] !== undefined);
        
        const quality = availableFields.length / requiredFields.length;
        
        if (quality >= 0.75) return 'high';
        if (quality >= 0.50) return 'medium';
        return 'low';
    }

    analyzeEmotionTrend() {
        if (this.emotionHistory.length < 5) return 'insufficient_data';
        
        const recent = this.emotionHistory.slice(-5);
        const emotions = recent.map(e => e.marketEmotion);
        
        const fearCount = emotions.filter(e => e === 'fud').length;
        const fomoCount = emotions.filter(e => e === 'fomo').length;
        const stableCount = emotions.filter(e => e === 'stable').length;
        
        if (fearCount >= 3) return 'increasing_fear';
        if (fomoCount >= 3) return 'increasing_fomo';
        if (stableCount >= 3) return 'stabilizing';
        return 'volatile';
    }

    calculateEmotionRisk(marketEmotion, emotionScore) {
        if (marketEmotion === 'fud' && emotionScore > 0.8) return 'very_high';
        if (marketEmotion === 'fomo' && emotionScore > 0.8) return 'very_high';
        if ((marketEmotion === 'fud' || marketEmotion === 'fomo') && emotionScore > 0.6) return 'high';
        if (marketEmotion === 'stable') return 'low';
        return 'medium';
    }

    updateEmotionHistory(result) {
        this.emotionHistory.push({
            timestamp: Date.now(),
            marketEmotion: result.marketEmotion,
            emotionScore: result.emotionScore,
            marketPhase: result.marketPhase.phase
        });

        // History limit kontrolü
        if (this.emotionHistory.length > this.maxHistoryLength) {
            this.emotionHistory = this.emotionHistory.slice(-this.maxHistoryLength);
        }
    }

    getDefaultResult() {
        return {
            marketEmotion: 'unknown',
            emotionScore: 0,
            emotionBreakdown: {
                fear: 0,
                fomo: 0,
                stability: 0
            },
            marketPhase: {
                phase: 'unknown',
                confidence: 0,
                characteristics: []
            },
            adjustmentRecommendations: {},
            alert: "Market emotion analizi yapılamadı",
            notes: "Yetersiz veri nedeniyle emotion analizi gerçekleştirilemedi.",
            metadata: {
                error: true,
                analysisTimestamp: Date.now()
            }
        };
    }

    getModuleInfo() {
        return {
            name: 'MarketEmotionInterpreter',
            version: '1.0.0',
            description: 'Piyasa psikolojisini analiz ederek FOMO, FUD ve stabilite durumlarını tespit eder',
            inputs: [
                'btcDominance', 'usdtFundingRate', 'cryptoFearGreedIndex', 'newsSentimentScore',
                'volumeSpike', 'socialSentiment', 'orderBookImbalance', 'marketCap24hChange', 'altcoinPerformance'
            ],
            outputs: [
                'marketEmotion', 'emotionScore', 'emotionBreakdown', 'marketPhase',
                'adjustmentRecommendations', 'alert', 'notes', 'metadata'
            ]
        };
    }
}

module.exports = MarketEmotionInterpreter;
