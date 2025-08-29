const GrafikBeyniModuleBase = require('./grafikBeyniModuleBase');

/**
 * Market Bias Interpreter Module
 * Haber akışı + makro veri + trend yönü + psikolojik haber etkilerini birleştirir
 * İşlem önerisine yönsel önyargı (bias) üretir
 * "Yükselişe mi oynuyoruz? Yoksa uzak mı durmalıyız?" sorusuna cevap verir
 */
class MarketBiasInterpreter extends GrafikBeyniModuleBase {
    constructor() {
        super('marketBiasInterpreter');
        this.newsCache = new Map();
        this.macroEventSchedule = new Map();
        this.biasHistory = [];
        this.maxHistoryLength = 50;
    }

    async analyze(data) {
        try {
            const {
                newsSentiment,
                macroEventImpact,
                eventTimeProximity,
                trendDirection,
                formationType,
                formationBias,
                socialSentiment,
                marketVolatility,
                priceAction
            } = data;

            // Veri doğrulama
            if (!newsSentiment || !trendDirection || !formationType) {
                throw new Error('Missing required data for bias interpretation');
            }

            // Bias skoru hesaplama
            const biasScore = this.calculateBiasScore(data);
            
            // Bias yönü belirleme
            const biasDirection = this.determineBiasDirection(data, biasScore);
            
            // Alignment kontrolü
            const alignment = this.checkAlignment(data, biasDirection);
            
            // Reasoning oluşturma
            const reasoning = this.generateReasoning(data, biasScore, alignment);

            const result = {
                biasScore,
                biasDirection,
                alignment,
                reasoning,
                modularRecommendations: this.generateModularRecommendations(biasScore, biasDirection, alignment),
                alert: this.generateAlert(biasScore, biasDirection, alignment),
                metadata: {
                    analysisTimestamp: Date.now(),
                    sentimentSources: this.identifySentimentSources(data),
                    conflictingSignals: this.detectConflicts(data),
                    confidenceFactors: this.analyzeConfidenceFactors(data)
                }
            };

            // Bias geçmişi güncelleme
            this.updateBiasHistory(result);
            
            // Cache ve performance tracking
            this.updateCache(data, result);
            this.trackPerformance(Date.now(), biasScore >= 0.75);

            return result;

        } catch (error) {
            this.handleError('MarketBiasInterpreter analysis failed', error, data);
            return this.getDefaultResult();
        }
    }

    calculateBiasScore(data) {
        const {
            newsSentiment,
            macroEventImpact,
            eventTimeProximity,
            trendDirection,
            formationType,
            formationBias,
            socialSentiment,
            marketVolatility
        } = data;

        let score = 0;

        // News sentiment ve formation bias uyumu
        if (this.isSentimentAligned(newsSentiment, formationBias)) {
            score += 0.25;
        }

        // Trend direction ve formation bias uyumu  
        if (this.isTrendAligned(trendDirection, formationBias)) {
            score += 0.20;
        }

        // Makro etki etkisi
        if (macroEventImpact === 'neutral') {
            score += 0.10;
        } else if (macroEventImpact === 'positive' && formationBias === 'bullish') {
            score += 0.15;
        } else if (macroEventImpact === 'negative' && formationBias === 'bearish') {
            score += 0.15;
        } else if (macroEventImpact && macroEventImpact !== 'neutral') {
            score -= 0.10; // Çelişki cezası
        }

        // Event proximity riski
        if (eventTimeProximity && eventTimeProximity < 5) {
            score -= 0.20; // Yakın zamanda önemli haber varsa risk
        } else if (eventTimeProximity && eventTimeProximity > 30) {
            score += 0.05; // Uzak zamanda haber varsa nötr
        }

        // Social sentiment desteği
        if (socialSentiment && this.isSentimentAligned(socialSentiment, formationBias)) {
            score += 0.15;
        }

        // Volatilite etkisi
        if (marketVolatility === 'low') {
            score += 0.10; // Düşük volatilite = güvenli ortam
        } else if (marketVolatility === 'high') {
            score -= 0.15; // Yüksek volatilite = risk
        }

        // Sentiment + Formation çelişkisi
        if (this.hasConflictingSentiment(newsSentiment, formationBias)) {
            score -= 0.30;
        }

        // Geçmiş bias başarı oranı
        const historicalSuccess = this.calculateHistoricalBiasSuccess();
        score += historicalSuccess * 0.10;

        return Math.max(0, Math.min(1, score));
    }

    isSentimentAligned(sentiment, bias) {
        const positiveMap = ['positive', 'bullish', 'optimistic', 'upward'];
        const negativeMap = ['negative', 'bearish', 'pessimistic', 'downward'];
        
        const sentimentType = positiveMap.includes(sentiment?.toLowerCase()) ? 'bullish' :
                             negativeMap.includes(sentiment?.toLowerCase()) ? 'bearish' : 'neutral';
        
        return sentimentType === bias;
    }

    isTrendAligned(trendDirection, formationBias) {
        const trendMap = {
            'up': 'bullish',
            'upward': 'bullish', 
            'ascending': 'bullish',
            'down': 'bearish',
            'downward': 'bearish',
            'descending': 'bearish'
        };
        
        return trendMap[trendDirection?.toLowerCase()] === formationBias;
    }

    hasConflictingSentiment(sentiment, bias) {
        return (sentiment === 'positive' && bias === 'bearish') ||
               (sentiment === 'negative' && bias === 'bullish');
    }

    determineBiasDirection(data, biasScore) {
        const { newsSentiment, trendDirection, formationBias, socialSentiment } = data;
        
        // Güçlü bias varsa formation yönünü takip et
        if (biasScore >= 0.75) {
            return formationBias;
        }
        
        // Orta bias varsa çoğunluk oyunu
        const signals = [
            this.sentimentToBias(newsSentiment),
            this.trendToBias(trendDirection),
            formationBias,
            this.sentimentToBias(socialSentiment)
        ].filter(Boolean);
        
        const bullishCount = signals.filter(s => s === 'bullish').length;
        const bearishCount = signals.filter(s => s === 'bearish').length;
        
        if (bullishCount > bearishCount) {
            return 'bullish';
        } else if (bearishCount > bullishCount) {
            return 'bearish';
        }
        
        return 'neutral';
    }

    sentimentToBias(sentiment) {
        if (!sentiment) return null;
        const s = sentiment.toLowerCase();
        if (['positive', 'bullish', 'optimistic'].includes(s)) return 'bullish';
        if (['negative', 'bearish', 'pessimistic'].includes(s)) return 'bearish';
        return 'neutral';
    }

    trendToBias(trend) {
        if (!trend) return null;
        const t = trend.toLowerCase();
        if (['up', 'upward', 'ascending'].includes(t)) return 'bullish';
        if (['down', 'downward', 'descending'].includes(t)) return 'bearish';
        return 'neutral';
    }

    checkAlignment(data, biasDirection) {
        const { trendDirection, formationBias, newsSentiment } = data;
        
        const trendBias = this.trendToBias(trendDirection);
        const sentimentBias = this.sentimentToBias(newsSentiment);
        
        // Alignment = Kaç tane aynı yöne bakıyor
        const alignments = [trendBias, formationBias, sentimentBias]
            .filter(bias => bias === biasDirection).length;
            
        return alignments >= 2; // En az 2/3 uyum varsa true
    }

    generateReasoning(data, biasScore, alignment) {
        const reasoning = [];
        const { newsSentiment, formationBias, trendDirection, macroEventImpact, eventTimeProximity } = data;
        
        if (this.isSentimentAligned(newsSentiment, formationBias)) {
            reasoning.push(`${newsSentiment} sentiment aligns with ${formationBias} formation`);
        }
        
        if (macroEventImpact === 'neutral') {
            reasoning.push("No critical macro data scheduled soon");
        } else if (macroEventImpact) {
            reasoning.push(`Macro impact: ${macroEventImpact}`);
        }
        
        if (this.isTrendAligned(trendDirection, formationBias)) {
            reasoning.push(`${trendDirection} confirms directional bias`);
        }
        
        if (eventTimeProximity && eventTimeProximity < 5) {
            reasoning.push("High event risk - major news approaching");
        }
        
        if (!alignment) {
            reasoning.push("Conflicting signals detected - mixed bias");
        }
        
        if (biasScore >= 0.85) {
            reasoning.push("Strong bias confirmation across multiple factors");
        }

        return reasoning.length > 0 ? reasoning : ["Bias analysis completed"];
    }

    generateModularRecommendations(biasScore, biasDirection, alignment) {
        const recommendations = {
            tpOptimizer: {
                allowExtendedTP: biasScore >= 0.80 && alignment,
                biasDirection: biasDirection,
                aggressiveness: biasScore >= 0.85 ? 'high' : 'moderate'
            },
            confirmationSignalBridge: {
                confidenceBoost: biasScore >= 0.75 ? 0.05 : 0,
                biasInfluence: biasScore,
                requireStrongerConfirmation: !alignment
            },
            coreOrchestrator: {
                biasOverride: biasScore >= 0.90,
                biasDirection: biasDirection,
                riskAdjustment: alignment ? 'standard' : 'conservative'
            },
            riskToRewardValidator: {
                biasAdjustment: true,
                toleranceModifier: biasScore >= 0.80 ? 0.1 : 0,
                conflictPenalty: !alignment ? 0.2 : 0
            }
        };

        // Düşük bias skoru durumunda konservatif öneriler
        if (biasScore < 0.50) {
            recommendations.coreOrchestrator.blockSignal = true;
            recommendations.coreOrchestrator.reason = "Low market bias confidence";
        }

        return recommendations;
    }

    generateAlert(biasScore, biasDirection, alignment) {
        if (biasScore >= 0.85 && alignment) {
            return `${biasDirection === 'bullish' ? 'Yükseliş' : 'Düşüş'} yönlü işlem için haber akışı güçlü destek veriyor`;
        } else if (biasScore >= 0.75) {
            return `${biasDirection === 'bullish' ? 'Yükseliş' : 'Düşüş'} yönlü bias tespit edildi - orta güven`;
        } else if (!alignment) {
            return "Çelişkili haber akışı - sinyal beklemek daha güvenli";
        } else if (biasScore < 0.50) {
            return "Haber akışı net yön vermiyor - teknik analize odaklan";
        } else {
            return "Market bias analizi tamamlandı - nötr koşullar";
        }
    }

    identifySentimentSources(data) {
        const sources = [];
        if (data.newsSentiment) sources.push('news');
        if (data.socialSentiment) sources.push('social');
        if (data.macroEventImpact) sources.push('macro');
        return sources;
    }

    detectConflicts(data) {
        const conflicts = [];
        const { newsSentiment, formationBias, trendDirection, socialSentiment } = data;
        
        if (this.hasConflictingSentiment(newsSentiment, formationBias)) {
            conflicts.push('news-formation');
        }
        
        if (!this.isTrendAligned(trendDirection, formationBias)) {
            conflicts.push('trend-formation');
        }
        
        if (newsSentiment && socialSentiment && 
            this.sentimentToBias(newsSentiment) !== this.sentimentToBias(socialSentiment)) {
            conflicts.push('news-social');
        }
        
        return conflicts;
    }

    analyzeConfidenceFactors(data) {
        return {
            sentimentStrength: this.calculateSentimentStrength(data),
            alignmentScore: this.calculateAlignmentScore(data),
            timeFactors: this.analyzeTimeFactors(data),
            historicalAccuracy: this.calculateHistoricalBiasSuccess()
        };
    }

    calculateSentimentStrength(data) {
        const { newsSentiment, socialSentiment, macroEventImpact } = data;
        let strength = 0;
        
        if (newsSentiment && newsSentiment !== 'neutral') strength += 0.4;
        if (socialSentiment && socialSentiment !== 'neutral') strength += 0.3;
        if (macroEventImpact && macroEventImpact !== 'neutral') strength += 0.3;
        
        return Math.min(1, strength);
    }

    calculateAlignmentScore(data) {
        const { newsSentiment, trendDirection, formationBias, socialSentiment } = data;
        const biases = [
            this.sentimentToBias(newsSentiment),
            this.trendToBias(trendDirection),
            formationBias,
            this.sentimentToBias(socialSentiment)
        ].filter(Boolean);
        
        if (biases.length === 0) return 0;
        
        const bullishCount = biases.filter(b => b === 'bullish').length;
        const bearishCount = biases.filter(b => b === 'bearish').length;
        
        return Math.max(bullishCount, bearishCount) / biases.length;
    }

    analyzeTimeFactors(data) {
        const { eventTimeProximity } = data;
        
        return {
            eventRisk: eventTimeProximity ? (eventTimeProximity < 5 ? 'high' : 'low') : 'none',
            timeWindow: eventTimeProximity || null
        };
    }

    updateBiasHistory(result) {
        this.biasHistory.push({
            timestamp: Date.now(),
            biasScore: result.biasScore,
            biasDirection: result.biasDirection,
            alignment: result.alignment
        });
        
        // History limit kontrolü
        if (this.biasHistory.length > this.maxHistoryLength) {
            this.biasHistory = this.biasHistory.slice(-this.maxHistoryLength);
        }
    }

    calculateHistoricalBiasSuccess() {
        if (this.biasHistory.length < 5) return 0;
        
        // Son 10 bias analizi başarısını simüle et (gerçek implementasyonda outcome tracking gerekir)
        const recentBias = this.biasHistory.slice(-10);
        const successfulBias = recentBias.filter(bias => bias.biasScore >= 0.75 && bias.alignment);
        
        return successfulBias.length / recentBias.length;
    }

    getDefaultResult() {
        return {
            biasScore: 0,
            biasDirection: 'neutral',
            alignment: false,
            reasoning: ["Analysis failed - insufficient data"],
            modularRecommendations: {},
            alert: "Market bias analizi yapılamadı",
            metadata: {
                error: true,
                analysisTimestamp: Date.now()
            }
        };
    }

    getModuleInfo() {
        return {
            name: 'MarketBiasInterpreter',
            version: '1.0.0',
            description: 'Haber akışı, makro data ve psikolojik faktörleri analiz ederek market bias üretir',
            inputs: [
                'newsSentiment', 'macroEventImpact', 'eventTimeProximity', 'trendDirection',
                'formationType', 'formationBias', 'socialSentiment', 'marketVolatility'
            ],
            outputs: [
                'biasScore', 'biasDirection', 'alignment', 'reasoning',
                'modularRecommendations', 'alert', 'metadata'
            ]
        };
    }
}

module.exports = MarketBiasInterpreter;
