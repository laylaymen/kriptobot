const GrafikBeyniModuleBase = require('./grafikBeyniModuleBase');

/**
 * Price Anomaly Watcher Module (Ultra Advanced Version)
 * Ani fiyat hareketlerinin sadece varlığını değil, nedenini, bağlamsal uyumsuzluğunu 
 * ve stratejik etkisini analiz ederek sistemin reaksiyonlarını akıllıca yönlendirir
 */
class PriceAnomalyWatcher extends GrafikBeyniModuleBase {
    constructor() {
        super('priceAnomalyWatcher');
        this.anomalyHistory = [];
        this.dailyAnomalyCount = 0;
        this.lastResetDate = new Date().toDateString();
        this.maxDailyAnomalies = 3;
        this.slowModeActive = false;
        this.freezeThresholds = {
            thin_liquidity: 15,
            news_panic: 10,
            pattern_mismatch: 20,
            unclassified: 25
        };
    }

    async analyze(data) {
        try {
            const {
                priceChange1min,
                priceChange5min,
                volumeChange1min,
                trendStrength,
                formationCompleteness,
                liquidityDepth,
                historicalVolatility,
                newsImpactScore,
                macroBias,
                psychologyStability,
                priceDeviationFromEMA,
                timeOfDay,
                historicalAnomalyPatternMatch,
                avgVolume,
                currentVolume
            } = data;

            // Veri doğrulama
            if (priceChange1min === undefined || trendStrength === undefined) {
                throw new Error('Missing required data for price anomaly analysis');
            }

            // Günlük reset kontrolü
            this.checkDailyReset();

            // Bağlamsal anomali skoru hesaplama
            const anomalyScore = this.calculateContextualAnomalyScore(data);
            
            // Anomali tespiti
            const isAnomaly = anomalyScore > 1.3;
            
            // Anomali türü sınıflandırma
            const anomalyType = this.classifyAnomalyType(data, anomalyScore);
            
            // Freeze duration hesaplama
            const freezeDuration = this.calculateFreezeDuration(anomalyType, anomalyScore);
            
            // Recommended actions oluşturma
            const recommendedActions = this.generateRecommendedActions(anomalyType, anomalyScore, data);

            const result = {
                isAnomaly: isAnomaly,
                anomalyType: anomalyType,
                anomalyScore: anomalyScore,
                freezeDuration: freezeDuration,
                recommendedActions: recommendedActions,
                notes: this.generateNotes(anomalyType, anomalyScore, data),
                slowModeActive: this.slowModeActive,
                metadata: {
                    analysisTimestamp: Date.now(),
                    dailyAnomalyCount: this.dailyAnomalyCount,
                    contextualFactors: this.analyzeContextualFactors(data),
                    riskLevel: this.calculateRiskLevel(anomalyScore, anomalyType),
                    timeOfDay: timeOfDay
                }
            };

            // Anomali geçmişi güncelleme
            if (isAnomaly) {
                this.updateAnomalyHistory(result);
                this.dailyAnomalyCount++;
                this.checkSlowModeActivation();
            }
            
            // Cache ve performance tracking
            this.updateCache(data, result);
            this.trackPerformance(Date.now(), isAnomaly);

            return result;

        } catch (error) {
            this.handleError('PriceAnomalyWatcher analysis failed', error, data);
            return this.getDefaultResult();
        }
    }

    calculateContextualAnomalyScore(data) {
        const {
            priceChange1min,
            priceChange5min,
            volumeChange1min,
            trendStrength,
            formationCompleteness,
            liquidityDepth,
            historicalVolatility,
            psychologyStability,
            priceDeviationFromEMA,
            historicalAnomalyPatternMatch,
            avgVolume,
            currentVolume
        } = data;

        let score = 0;

        // Price change vs historical volatility (en önemli faktör)
        if (historicalVolatility && historicalVolatility > 0) {
            score += (Math.abs(priceChange1min) / historicalVolatility) * 0.25;
        } else {
            // Fallback: direct price change evaluation
            score += Math.abs(priceChange1min) / 5.0 * 0.25;
        }

        // Volume change vs average volume
        if (avgVolume && avgVolume > 0 && currentVolume) {
            const volumeRatio = currentVolume / avgVolume;
            score += Math.min(volumeRatio / 3.0, 2.0) * 0.20;
        } else if (volumeChange1min !== undefined) {
            score += Math.min(volumeChange1min / 150, 2.0) * 0.20;
        }

        // Trend strength inconsistency
        if (trendStrength !== undefined) {
            score += (1 - trendStrength) * 0.10;
        }

        // Formation completeness inconsistency
        if (formationCompleteness !== undefined) {
            score += (1 - formationCompleteness) * 0.10;
        }

        // Liquidity depth factor
        if (liquidityDepth !== undefined) {
            score += (1 - liquidityDepth) * 0.10;
        }

        // Price deviation from EMA
        if (priceDeviationFromEMA !== undefined) {
            score += Math.min(Math.abs(priceDeviationFromEMA) / 2, 1.0) * 0.10;
        }

        // Psychology stability factor
        if (psychologyStability !== undefined) {
            score += (1 - psychologyStability) * 0.10;
        }

        // Historical pattern mismatch
        if (historicalAnomalyPatternMatch !== undefined) {
            score += (1 - historicalAnomalyPatternMatch) * 0.05;
        }

        return Math.max(0, score);
    }

    classifyAnomalyType(data, anomalyScore) {
        const {
            liquidityDepth,
            priceChange1min,
            newsImpactScore,
            macroBias,
            historicalAnomalyPatternMatch,
            formationCompleteness,
            volumeChange1min,
            psychologyStability
        } = data;

        // Thin Liquidity Spike
        if (liquidityDepth !== undefined && liquidityDepth < 1.0 && Math.abs(priceChange1min) > 3.5) {
            return 'Thin Liquidity Spike';
        }

        // News-Driven Panic
        if (newsImpactScore !== undefined && newsImpactScore < -0.3 && macroBias === 'bearish') {
            return 'News-Driven Panic Drop';
        }

        // Historical Pattern Mismatch
        if (historicalAnomalyPatternMatch !== undefined && historicalAnomalyPatternMatch > 0.7 && 
            formationCompleteness !== undefined && formationCompleteness < 0.6) {
            return 'Historical Pattern Mismatch';
        }

        // Volume Manipulation Spike
        if (volumeChange1min !== undefined && volumeChange1min > 200 && 
            psychologyStability !== undefined && psychologyStability > 0.8) {
            return 'Volume Manipulation Spike';
        }

        // Extreme Volatility Burst
        if (Math.abs(priceChange1min) > 5.0 && anomalyScore > 2.0) {
            return 'Extreme Volatility Burst';
        }

        // Market Structure Break
        if (liquidityDepth !== undefined && liquidityDepth < 0.5 && 
            formationCompleteness !== undefined && formationCompleteness > 0.8) {
            return 'Market Structure Break';
        }

        return 'Unclassified Shock';
    }

    calculateFreezeDuration(anomalyType, anomalyScore) {
        const baseThreshold = this.freezeThresholds[anomalyType.toLowerCase().replace(/\s+/g, '_')] || 
                            this.freezeThresholds.unclassified;
        
        // Anomaly score'a göre süreyi ayarla
        const multiplier = Math.min(anomalyScore / 1.5, 2.0);
        const duration = Math.round(baseThreshold * multiplier);
        
        // Slow mode aktifse süreyi uzat
        return this.slowModeActive ? duration * 1.5 : duration;
    }

    generateRecommendedActions(anomalyType, anomalyScore, data) {
        const actions = {};

        switch (anomalyType) {
            case 'Thin Liquidity Spike':
                actions.vivo = 'pauseSignals';
                actions.coreOrchestrator = 'initiateDefensiveMode';
                actions.liquidityStressScanner = 'enhancedMonitoring';
                actions.tpOptimizer = 'applyLiquidityAdjustment';
                break;

            case 'News-Driven Panic Drop':
                actions.tpOptimizer = 'accelerateExit';
                actions.exitTimingAdvisor = 'immediateExitWatch';
                actions.marketEmotionInterpreter = 'trackPanicLevels';
                actions.newsReactionRouter = 'validateNewsImpact';
                break;

            case 'Historical Pattern Mismatch':
                actions.formationCompletenessJudge = 'recalculate';
                actions.patternRecognizer = 'resetAnalysis';
                actions.trendConfidenceEvaluator = 'reassessConfidence';
                break;

            case 'Volume Manipulation Spike':
                actions.volumeShiftAnalyzer = 'detectManipulation';
                actions.coreOrchestrator = 'enableManipulationFilter';
                actions.vivo = 'requireExtraConfirmation';
                break;

            case 'Extreme Volatility Burst':
                actions.volatilityAssessment = 'recalculateRisk';
                actions.riskToRewardValidator = 'tightenParameters';
                actions.coreOrchestrator = 'enableVolatilityProtection';
                break;

            case 'Market Structure Break':
                actions.supportResistanceScanner = 'recalculateLevels';
                actions.trendLineConstructor = 'reconstructTrendLines';
                actions.coreOrchestrator = 'initiateStructuralRecalibration';
                break;

            default:
                actions.coreOrchestrator = 'generalAnomalyProtocol';
                actions.vivo = 'increaseConfirmationThreshold';
        }

        // High anomaly score için ek aksiyonlar
        if (anomalyScore > 2.0) {
            actions.systemWide = 'emergencyProtocolActivated';
            actions.allModules = 'conservativeMode';
        }

        return actions;
    }

    generateNotes(anomalyType, anomalyScore, data) {
        const notes = [];
        
        switch (anomalyType) {
            case 'Thin Liquidity Spike':
                notes.push("Likidite zayıf, yüksek fiyat atlaması. Sahte pump olasılığı.");
                break;
            case 'News-Driven Panic Drop':
                notes.push("Haber kaynaklı panik satış. Trend tersine dönebilir.");
                break;
            case 'Historical Pattern Mismatch':
                notes.push("Geçmiş patternlerle uyumsuzluk. Formasyon geçersiz olabilir.");
                break;
            case 'Volume Manipulation Spike':
                notes.push("Anormal hacim artışı. Manipülasyon şüphesi yüksek.");
                break;
            case 'Extreme Volatility Burst':
                notes.push("Aşırı volatilite patlaması. Sistem korunma modunda.");
                break;
            case 'Market Structure Break':
                notes.push("Piyasa yapısı bozulması. Teknik seviyeler geçersiz olabilir.");
                break;
            default:
                notes.push("Sınıflandırılamayan anomali tespit edildi.");
        }

        if (anomalyScore > 2.5) {
            notes.push("Kritik seviye anomali - acil müdahale gerekli.");
        }

        if (this.slowModeActive) {
            notes.push("Sistem akıllı yavaş modda - ek güvenlik önlemleri aktif.");
        }

        if (data.timeOfDay === 'pre-market' || data.timeOfDay === 'after-hours') {
            notes.push("Düşük likidite saati - anomali riski yüksek.");
        }

        return notes.join(' ');
    }

    analyzeContextualFactors(data) {
        return {
            volatilityContext: this.assessVolatilityContext(data),
            liquidityContext: this.assessLiquidityContext(data),
            newsContext: this.assessNewsContext(data),
            timeContext: this.assessTimeContext(data),
            patternContext: this.assessPatternContext(data)
        };
    }

    assessVolatilityContext(data) {
        const { historicalVolatility, priceChange1min } = data;
        if (!historicalVolatility) return 'unknown';
        
        const ratio = Math.abs(priceChange1min) / historicalVolatility;
        if (ratio > 3.0) return 'extreme';
        if (ratio > 2.0) return 'high';
        if (ratio > 1.5) return 'elevated';
        return 'normal';
    }

    assessLiquidityContext(data) {
        const { liquidityDepth } = data;
        if (liquidityDepth === undefined) return 'unknown';
        
        if (liquidityDepth > 1.2) return 'abundant';
        if (liquidityDepth > 0.8) return 'adequate';
        if (liquidityDepth > 0.5) return 'thin';
        return 'critical';
    }

    assessNewsContext(data) {
        const { newsImpactScore } = data;
        if (newsImpactScore === undefined) return 'unknown';
        
        if (newsImpactScore > 0.5) return 'strong_positive';
        if (newsImpactScore > 0.2) return 'positive';
        if (newsImpactScore > -0.2) return 'neutral';
        if (newsImpactScore > -0.5) return 'negative';
        return 'strong_negative';
    }

    assessTimeContext(data) {
        const { timeOfDay } = data;
        if (!timeOfDay) return 'unknown';
        
        const riskMap = {
            'pre-market': 'high_risk',
            'market-open': 'medium_risk',
            'mid-session': 'low_risk',
            'market-close': 'medium_risk',
            'after-hours': 'high_risk'
        };
        
        return riskMap[timeOfDay] || 'unknown';
    }

    assessPatternContext(data) {
        const { formationCompleteness, historicalAnomalyPatternMatch } = data;
        
        if (formationCompleteness === undefined || historicalAnomalyPatternMatch === undefined) {
            return 'unknown';
        }
        
        if (formationCompleteness > 0.8 && historicalAnomalyPatternMatch > 0.8) return 'strong_pattern';
        if (formationCompleteness > 0.6 && historicalAnomalyPatternMatch > 0.6) return 'moderate_pattern';
        if (formationCompleteness < 0.4 || historicalAnomalyPatternMatch < 0.4) return 'weak_pattern';
        return 'mixed_pattern';
    }

    calculateRiskLevel(anomalyScore, anomalyType) {
        let riskLevel = 'low';
        
        if (anomalyScore > 2.5) {
            riskLevel = 'critical';
        } else if (anomalyScore > 2.0) {
            riskLevel = 'very_high';
        } else if (anomalyScore > 1.7) {
            riskLevel = 'high';
        } else if (anomalyScore > 1.3) {
            riskLevel = 'medium';
        }

        // Certain anomaly types increase risk regardless of score
        const highRiskTypes = ['Extreme Volatility Burst', 'Market Structure Break', 'Volume Manipulation Spike'];
        if (highRiskTypes.includes(anomalyType) && riskLevel === 'medium') {
            riskLevel = 'high';
        }

        return riskLevel;
    }

    checkDailyReset() {
        const today = new Date().toDateString();
        if (this.lastResetDate !== today) {
            this.dailyAnomalyCount = 0;
            this.lastResetDate = today;
            this.slowModeActive = false; // Daily reset ile slow mode'u da sıfırla
        }
    }

    checkSlowModeActivation() {
        if (this.dailyAnomalyCount >= this.maxDailyAnomalies && !this.slowModeActive) {
            this.slowModeActive = true;
            console.log('PriceAnomalyWatcher: Intelligent slow mode activated due to excessive anomalies');
        }
    }

    updateAnomalyHistory(result) {
        this.anomalyHistory.push({
            timestamp: Date.now(),
            type: result.anomalyType,
            score: result.anomalyScore,
            freezeDuration: result.freezeDuration
        });

        // History limit kontrolü (son 100 anomali)
        if (this.anomalyHistory.length > 100) {
            this.anomalyHistory = this.anomalyHistory.slice(-100);
        }
    }

    getRecentAnomalyPattern() {
        const recentWindow = 24 * 60 * 60 * 1000; // 24 saat
        const cutoff = Date.now() - recentWindow;
        
        return this.anomalyHistory
            .filter(anomaly => anomaly.timestamp >= cutoff)
            .map(anomaly => anomaly.type);
    }

    getDefaultResult() {
        return {
            isAnomaly: false,
            anomalyType: 'none',
            anomalyScore: 0,
            freezeDuration: 0,
            recommendedActions: {},
            notes: "Anomali analizi yapılamadı - yetersiz veri",
            slowModeActive: this.slowModeActive,
            metadata: {
                error: true,
                analysisTimestamp: Date.now(),
                dailyAnomalyCount: this.dailyAnomalyCount
            }
        };
    }

    getModuleInfo() {
        return {
            name: 'PriceAnomalyWatcher',
            version: '2.0.0',
            description: 'Ultra gelişmiş fiyat anomali tespiti ve bağlamsal analiz sistemi',
            inputs: [
                'priceChange1min', 'priceChange5min', 'volumeChange1min', 'trendStrength',
                'formationCompleteness', 'liquidityDepth', 'historicalVolatility', 'newsImpactScore',
                'macroBias', 'psychologyStability', 'priceDeviationFromEMA', 'timeOfDay',
                'historicalAnomalyPatternMatch', 'avgVolume', 'currentVolume'
            ],
            outputs: [
                'isAnomaly', 'anomalyType', 'anomalyScore', 'freezeDuration',
                'recommendedActions', 'notes', 'slowModeActive', 'metadata'
            ]
        };
    }
}

module.exports = PriceAnomalyWatcher;
