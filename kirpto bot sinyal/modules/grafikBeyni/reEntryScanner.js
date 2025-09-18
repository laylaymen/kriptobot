const GrafikBeyniModuleBase = require('../grafikBeyniModuleBase');

/**
 * Re-Entry Scanner Module
 * Giriş kaçırıldıysa veya TP sonrası yeni fırsat arıyorsa devreye girer
 * TrendScore, pullback ve sapma skoruna göre yeniden giriş önerir
 * Yeni entryZone üretir ve modüllerle yeniden paylaşır
 */
class ReEntryScanner extends GrafikBeyniModuleBase {
    constructor() {
        super('reEntryScanner');
        this.lastSignalTime = null;
        this.lastBreakoutPrice = null;
        this.pulledbackFromBreakout = false;
        this.reentryAttempts = 0;
        this.maxReentryAttempts = 3;
        this.timeWindow = 30 * 60 * 1000; // 30 dakika
    }

    async analyze(data) {
        try {
            const {
                price,
                ohlcv,
                trendScore,
                formationType,
                formationActive,
                breakoutPrice,
                timeFromBreakout,
                deviationScore,
                pullbackLevel
            } = data;

            // Veri doğrulama
            if (!price || !ohlcv || !trendScore || !formationType) {
                throw new Error('Missing required data for re-entry analysis');
            }

            // Geçmiş giriş kontrolü
            const missedEntry = this.checkMissedEntry(data);
            const pullbackOpportunity = this.analyzePullback(data);
            const tpClosureOpportunity = this.checkTPClosure(data);

            // Re-entry confidence hesaplama
            const reentryConfidence = this.calculateReentryConfidence({
                trendScore,
                deviationScore,
                formationActive,
                timeFromBreakout,
                pullbackLevel,
                missedEntry,
                pullbackOpportunity
            });

            // Entry zone yeniden tanımlama
            const newEntryZone = this.defineNewEntryZone(data, reentryConfidence);

            const result = {
                reEntryAllowed: reentryConfidence >= 0.75,
                reentryConfidence,
                entryZone: newEntryZone,
                reasoning: this.generateReasoning({
                    trendScore,
                    deviationScore,
                    formationActive,
                    timeFromBreakout,
                    pullbackOpportunity,
                    missedEntry
                }),
                modularRecommendations: this.generateModularRecommendations(reentryConfidence, newEntryZone),
                alert: this.generateAlert(reentryConfidence, pullbackOpportunity),
                metadata: {
                    analysisTimestamp: Date.now(),
                    reentryAttempts: this.reentryAttempts,
                    timeFromLastSignal: this.lastSignalTime ? Date.now() - this.lastSignalTime : null
                }
            };

            // Cache ve performance tracking
            this.updateCache(data, result);
            this.trackPerformance(Date.now(), result.reEntryAllowed);

            return result;

        } catch (error) {
            this.handleError('ReEntryScanner analysis failed', error, data);
            return this.getDefaultResult();
        }
    }

    checkMissedEntry(data) {
        const { price, breakoutPrice, timeFromBreakout } = data;
        
        if (!breakoutPrice || !timeFromBreakout) return false;

        // Breakout'tan çok geç kalındı mı?
        const tooLateThreshold = 0.02; // %2
        const priceDeviation = Math.abs(price - breakoutPrice) / breakoutPrice;
        
        return {
            missed: priceDeviation > tooLateThreshold && timeFromBreakout > 5,
            deviationFromBreakout: priceDeviation,
            timePassed: timeFromBreakout
        };
    }

    analyzePullback(data) {
        const { price, pullbackLevel, trendScore, ohlcv } = data;
        
        if (!pullbackLevel || !ohlcv || ohlcv.length < 5) {
            return { detected: false };
        }

        // Son 5 mumda geri çekilme var mı?
        const recentCandles = ohlcv.slice(-5);
        const pullbackDepth = this.calculatePullbackDepth(recentCandles, pullbackLevel);
        const pullbackVolume = this.analyzePullbackVolume(recentCandles);

        return {
            detected: pullbackDepth > 0.005 && pullbackDepth < 0.03, // %0.5 - %3 arası
            depth: pullbackDepth,
            volumeSupport: pullbackVolume.supportive,
            testing: Math.abs(price - pullbackLevel) / pullbackLevel < 0.01, // %1 tolerans
            trendIntact: trendScore > 0.7
        };
    }

    calculatePullbackDepth(candles, pullbackLevel) {
        if (!candles || candles.length === 0) return 0;
        
        const highestHigh = Math.max(...candles.map(c => c.high));
        const currentLow = candles[candles.length - 1].low;
        
        return Math.abs(highestHigh - currentLow) / highestHigh;
    }

    analyzePullbackVolume(candles) {
        if (candles.length < 3) return { supportive: false };
        
        const avgVolume = candles.reduce((sum, c) => sum + c.volume, 0) / candles.length;
        const lastVolume = candles[candles.length - 1].volume;
        
        return {
            supportive: lastVolume < avgVolume * 0.8, // Düşük hacimli pullback = sağlıklı
            volumeRatio: lastVolume / avgVolume
        };
    }

    checkTPClosure(data) {
        const { recentTPClosure, timeFromTPClosure, formationActive } = data;
        
        return {
            recentTPHit: recentTPClosure && timeFromTPClosure < this.timeWindow,
            formationStillActive: formationActive,
            readyForReentry: recentTPClosure && timeFromTPClosure > 5 * 60 * 1000 // 5 dk sonra
        };
    }

    calculateReentryConfidence(params) {
        const {
            trendScore,
            deviationScore,
            formationActive,
            timeFromBreakout,
            pullbackLevel,
            missedEntry,
            pullbackOpportunity
        } = params;

        let confidence = 0;

        // Pullback bölgesi test ediliyor
        if (pullbackOpportunity.detected && pullbackOpportunity.testing) {
            confidence += 0.30;
        }

        // Trend güçlü
        if (trendScore >= 0.75) {
            confidence += 0.20;
        }

        // Sapma skoru iyi
        if (deviationScore <= 0.45) {
            confidence += 0.15;
        }

        // Zaman penceresi uygun
        if (timeFromBreakout && timeFromBreakout < 30) {
            confidence += 0.10;
        }

        // Formasyon hâlâ aktif
        if (formationActive) {
            confidence += 0.25;
        }

        // Geç kalma cezası
        if (missedEntry && missedEntry.deviationFromBreakout > 0.02) {
            confidence -= 0.20;
        }

        // Çok fazla deneme cezası
        if (this.reentryAttempts >= 2) {
            confidence -= 0.15;
        }

        return Math.max(0, Math.min(1, confidence));
    }

    defineNewEntryZone(data, confidence) {
        const { price, pullbackLevel, breakoutPrice, formationType } = data;
        
        if (!pullbackLevel && !breakoutPrice) {
            return {
                low: price * 0.995,
                high: price * 1.005
            };
        }

        let zoneCenter = pullbackLevel || breakoutPrice;
        let zoneWidth = confidence > 0.8 ? 0.005 : 0.008; // Yüksek güvende dar zone

        // Formasyon tipine göre ayarlama
        if (formationType === 'ascending-triangle' || formationType === 'bullish') {
            zoneCenter = pullbackLevel || price * 0.998;
        } else if (formationType === 'descending-triangle' || formationType === 'bearish') {
            zoneCenter = pullbackLevel || price * 1.002;
        }

        return {
            low: zoneCenter * (1 - zoneWidth),
            high: zoneCenter * (1 + zoneWidth)
        };
    }

    generateReasoning(params) {
        const reasoning = [];
        
        if (params.pullbackOpportunity.detected) {
            reasoning.push("Pullback bölgesi test ediliyor");
        }
        
        if (params.trendScore > 0.75) {
            reasoning.push("Trend güçlü, formasyon bozulmadı");
        }
        
        if (params.deviationScore <= 0.45) {
            reasoning.push("Volatilite dengeli");
        }
        
        if (params.timeFromBreakout && params.timeFromBreakout < 30) {
            reasoning.push("Zaman penceresi uygun");
        }
        
        if (params.missedEntry && params.missedEntry.missed) {
            reasoning.push("İlk giriş kaçırıldı, ikinci şans değerlendiriliyor");
        }

        return reasoning.length > 0 ? reasoning : ["Re-entry koşulları analiz ediliyor"];
    }

    generateModularRecommendations(confidence, entryZone) {
        const recommendations = {
            entryZoneClassifier: {
                defineZone: confidence >= 0.75,
                newZone: entryZone
            },
            confirmationSignalBridge: {
                confirmAgain: confidence >= 0.8,
                confidenceModifier: confidence > 0.8 ? 0.05 : -0.05
            },
            tpOptimizer: {
                applyMidTPStrategy: confidence >= 0.75,
                adjustTPForReentry: true
            },
            riskToRewardValidator: {
                recalculateRR: true,
                reentryMode: true
            }
        };

        if (confidence < 0.5) {
            recommendations.coreOrchestrator = {
                blockReentry: true,
                reason: "Confidence too low for re-entry"
            };
        }

        return recommendations;
    }

    generateAlert(confidence, pullbackOpportunity) {
        if (confidence >= 0.85) {
            return "Geri giriş fırsatı bulundu — işlem için ikinci şans";
        } else if (confidence >= 0.75) {
            return "Pullback testi devam ediyor — giriş bekleniyor";
        } else if (pullbackOpportunity.detected) {
            return "Pullback izleniyor — henüz giriş sinyali yok";
        } else {
            return "Re-entry koşulları henüz oluşmadı";
        }
    }

    updateReentryAttempts() {
        this.reentryAttempts += 1;
        this.lastSignalTime = Date.now();
        
        // Reset attempts after time window
        setTimeout(() => {
            this.reentryAttempts = Math.max(0, this.reentryAttempts - 1);
        }, this.timeWindow);
    }

    getDefaultResult() {
        return {
            reEntryAllowed: false,
            reentryConfidence: 0,
            entryZone: null,
            reasoning: ["Analysis failed - insufficient data"],
            modularRecommendations: {},
            alert: "Re-entry analizi yapılamadı",
            metadata: {
                error: true,
                analysisTimestamp: Date.now()
            }
        };
    }

    getModuleInfo() {
        return {
            name: 'ReEntryScanner',
            version: '1.0.0',
            description: 'Giriş kaçırma veya TP sonrası yeniden giriş fırsatlarını analiz eder',
            inputs: [
                'price', 'ohlcv', 'trendScore', 'formationType', 'formationActive',
                'breakoutPrice', 'timeFromBreakout', 'deviationScore', 'pullbackLevel'
            ],
            outputs: [
                'reEntryAllowed', 'reentryConfidence', 'entryZone', 'reasoning',
                'modularRecommendations', 'alert', 'metadata'
            ]
        };
    }
}

module.exports = ReEntryScanner;
