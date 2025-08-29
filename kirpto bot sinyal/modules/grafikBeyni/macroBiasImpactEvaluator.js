const GrafikBeyniModuleBase = require('./grafikBeyniModuleBase');

/**
 * Macro Bias Impact Evaluator Module
 * Makro ekonomik göstergelere (döviz kuru, faiz oranı, Google Trends) göre 
 * sinyal güven seviyesini dinamik olarak ayarlar
 */
class MacroBiasImpactEvaluator extends GrafikBeyniModuleBase {
    constructor() {
        super('macroBiasImpactEvaluator');
        this.macroDataHistory = new Map();
        this.normalizationPeriod = 30; // 30 günlük normalisation
        this.riskThresholds = {
            high: 0.7,
            medium: 0.4,
            low: 0.0
        };
    }

    async analyze(data) {
        try {
            const {
                usdtry_rate,
                interest_rate,
                google_macroRisk_trend,
                currentSignalStrength,
                btc_dominance,
                global_fear_greed_index,
                inflation_data,
                unemployment_rate
            } = data;

            // Veri doğrulama
            if (currentSignalStrength === undefined || (!usdtry_rate && !interest_rate)) {
                throw new Error('Missing required macro data for analysis');
            }

            // Macro risk skorunu hesapla
            const macroRiskScore = this.calculateMacroRiskScore(data);
            
            // Sinyal çarpanını belirle
            const signalMultiplier = this.determineSignalMultiplier(macroRiskScore);
            
            // Final sinyal gücünü hesapla
            const finalSignalStrength = currentSignalStrength * signalMultiplier;
            
            // Risk kategorisi belirleme
            const riskCategory = this.categorizeRisk(macroRiskScore);
            
            // Macro trend analizi
            const macroTrend = this.analyzeMacroTrend(data);

            const result = {
                macroRiskScore: macroRiskScore,
                signalMultiplier: signalMultiplier,
                finalSignalStrength: finalSignalStrength,
                riskCategory: riskCategory,
                macroTrend: macroTrend,
                modularRecommendations: this.generateModularRecommendations(macroRiskScore, riskCategory, macroTrend),
                alert: this.generateAlert(macroRiskScore, riskCategory, finalSignalStrength),
                metadata: {
                    analysisTimestamp: Date.now(),
                    originalSignalStrength: currentSignalStrength,
                    adjustmentPercentage: ((signalMultiplier - 1) * 100).toFixed(2),
                    macroFactors: this.identifyDominantFactors(data, macroRiskScore)
                }
            };

            // Macro data geçmişi güncelleme
            this.updateMacroHistory(data);
            
            // Cache ve performance tracking
            this.updateCache(data, result);
            this.trackPerformance(Date.now(), macroRiskScore <= this.riskThresholds.medium);

            return result;

        } catch (error) {
            this.handleError('MacroBiasImpactEvaluator analysis failed', error, data);
            return this.getDefaultResult(data.currentSignalStrength);
        }
    }

    calculateMacroRiskScore(data) {
        let riskScore = 0;
        let totalWeight = 0;

        // USD/TRY oranı riski
        if (data.usdtry_rate) {
            const usdtryRisk = this.normalizeUSDTRY(data.usdtry_rate);
            riskScore += usdtryRisk * 0.25;
            totalWeight += 0.25;
        }

        // Faiz oranı riski
        if (data.interest_rate) {
            const interestRisk = this.normalizeInterestRate(data.interest_rate);
            riskScore += interestRisk * 0.20;
            totalWeight += 0.20;
        }

        // Google Trends makro risk
        if (data.google_macroRisk_trend) {
            const googleRisk = this.normalizeGoogleTrends(data.google_macroRisk_trend);
            riskScore += googleRisk * 0.20;
            totalWeight += 0.20;
        }

        // BTC dominance riski
        if (data.btc_dominance) {
            const btcDominanceRisk = this.normalizeBTCDominance(data.btc_dominance);
            riskScore += btcDominanceRisk * 0.15;
            totalWeight += 0.15;
        }

        // Fear & Greed Index
        if (data.global_fear_greed_index) {
            const fearGreedRisk = this.normalizeFearGreed(data.global_fear_greed_index);
            riskScore += fearGreedRisk * 0.10;
            totalWeight += 0.10;
        }

        // Enflasyon verisi
        if (data.inflation_data) {
            const inflationRisk = this.normalizeInflation(data.inflation_data);
            riskScore += inflationRisk * 0.10;
            totalWeight += 0.10;
        }

        return totalWeight > 0 ? riskScore / totalWeight : 0;
    }

    normalizeUSDTRY(currentRate) {
        const historicalData = this.getMacroHistory('usdtry_rate');
        if (historicalData.length < 5) {
            // Yeterli geçmiş veri yoksa genel threshold kullan
            return currentRate > 30 ? 0.8 : currentRate > 25 ? 0.5 : 0.2;
        }

        const { min, max } = this.calculateMinMax(historicalData);
        const normalized = (currentRate - min) / (max - min);
        
        // Yüksek dolar kuru = yüksek risk
        return Math.max(0, Math.min(1, normalized));
    }

    normalizeInterestRate(currentRate) {
        const historicalData = this.getMacroHistory('interest_rate');
        if (historicalData.length < 5) {
            // Yüksek faiz = belirsizlik = risk
            return currentRate > 40 ? 0.9 : currentRate > 20 ? 0.6 : 0.3;
        }

        const { min, max } = this.calculateMinMax(historicalData);
        const normalized = (currentRate - min) / (max - min);
        
        return Math.max(0, Math.min(1, normalized));
    }

    normalizeGoogleTrends(trendScore) {
        // Google Trends skoru 0-100 arası gelir
        // Yüksek arama = yüksek kaygı = yüksek risk
        return Math.max(0, Math.min(1, trendScore / 100));
    }

    normalizeBTCDominance(dominance) {
        // BTC dominance %40-70 arası normal kabul edilir
        // Çok yüksek veya çok düşük = risk
        if (dominance >= 45 && dominance <= 65) {
            return 0.2; // Normal range
        } else if (dominance > 70 || dominance < 35) {
            return 0.8; // Extreme levels
        } else {
            return 0.5; // Moderate risk
        }
    }

    normalizeFearGreed(fearGreedIndex) {
        // Fear & Greed: 0-100, extreme seviyelerde yüksek risk
        if (fearGreedIndex <= 20 || fearGreedIndex >= 80) {
            return 0.8; // Extreme fear or greed
        } else if (fearGreedIndex <= 40 || fearGreedIndex >= 60) {
            return 0.4; // Moderate levels
        } else {
            return 0.1; // Neutral zone
        }
    }

    normalizeInflation(inflationRate) {
        // Yüksek enflasyon = yüksek risk
        if (inflationRate > 20) return 0.9;
        if (inflationRate > 10) return 0.6;
        if (inflationRate > 5) return 0.3;
        return 0.1;
    }

    getMacroHistory(dataType) {
        const key = `${dataType}_history`;
        return this.macroDataHistory.get(key) || [];
    }

    calculateMinMax(data) {
        if (data.length === 0) return { min: 0, max: 1 };
        
        const values = data.map(item => item.value);
        return {
            min: Math.min(...values),
            max: Math.max(...values)
        };
    }

    determineSignalMultiplier(macroRiskScore) {
        if (macroRiskScore >= this.riskThresholds.high) {
            return 0.65; // Yüksek risk - sinyal gücünü ciddi şekilde azalt
        } else if (macroRiskScore >= this.riskThresholds.medium) {
            return 0.85; // Orta risk - sinyal gücünü azalt
        } else {
            return 1.0; // Düşük risk - sinyal gücünü koru
        }
    }

    categorizeRisk(macroRiskScore) {
        if (macroRiskScore >= this.riskThresholds.high) {
            return 'high';
        } else if (macroRiskScore >= this.riskThresholds.medium) {
            return 'medium';
        } else {
            return 'low';
        }
    }

    analyzeMacroTrend(data) {
        const trends = {};
        
        // USD/TRY trend
        if (data.usdtry_rate) {
            const usdtryHistory = this.getMacroHistory('usdtry_rate');
            trends.usdtry = this.calculateTrend(usdtryHistory, data.usdtry_rate);
        }

        // Interest rate trend
        if (data.interest_rate) {
            const interestHistory = this.getMacroHistory('interest_rate');
            trends.interest = this.calculateTrend(interestHistory, data.interest_rate);
        }

        // BTC dominance trend
        if (data.btc_dominance) {
            const btcHistory = this.getMacroHistory('btc_dominance');
            trends.btcDominance = this.calculateTrend(btcHistory, data.btc_dominance);
        }

        return {
            trends: trends,
            overallDirection: this.determineOverallTrend(trends),
            volatility: this.calculateMacroVolatility(trends)
        };
    }

    calculateTrend(history, currentValue) {
        if (history.length < 3) return 'insufficient_data';
        
        const recent = history.slice(-7); // Son 7 data point
        const older = history.slice(-14, -7); // Önceki 7 data point
        
        if (older.length === 0) return 'insufficient_data';
        
        const recentAvg = recent.reduce((sum, item) => sum + item.value, 0) / recent.length;
        const olderAvg = older.reduce((sum, item) => sum + item.value, 0) / older.length;
        
        const trendChange = (recentAvg - olderAvg) / olderAvg;
        
        if (trendChange > 0.05) return 'increasing';
        if (trendChange < -0.05) return 'decreasing';
        return 'stable';
    }

    determineOverallTrend(trends) {
        const trendValues = Object.values(trends);
        if (trendValues.length === 0) return 'unknown';
        
        const increasing = trendValues.filter(t => t === 'increasing').length;
        const decreasing = trendValues.filter(t => t === 'decreasing').length;
        
        if (increasing > decreasing) return 'risk_increasing';
        if (decreasing > increasing) return 'risk_decreasing';
        return 'stable';
    }

    calculateMacroVolatility(trends) {
        // Basit volatilite hesabı - değişen trend sayısı
        const changingTrends = Object.values(trends).filter(t => t !== 'stable' && t !== 'insufficient_data').length;
        const totalTrends = Object.values(trends).length;
        
        if (totalTrends === 0) return 'unknown';
        
        const volatilityRatio = changingTrends / totalTrends;
        
        if (volatilityRatio > 0.6) return 'high';
        if (volatilityRatio > 0.3) return 'medium';
        return 'low';
    }

    identifyDominantFactors(data, macroRiskScore) {
        const factors = [];
        
        if (data.usdtry_rate && this.normalizeUSDTRY(data.usdtry_rate) > 0.6) {
            factors.push('high_usdtry');
        }
        
        if (data.interest_rate && this.normalizeInterestRate(data.interest_rate) > 0.6) {
            factors.push('high_interest_rate');
        }
        
        if (data.google_macroRisk_trend && this.normalizeGoogleTrends(data.google_macroRisk_trend) > 0.6) {
            factors.push('high_search_anxiety');
        }
        
        if (data.btc_dominance && this.normalizeBTCDominance(data.btc_dominance) > 0.6) {
            factors.push('extreme_btc_dominance');
        }

        return factors;
    }

    generateModularRecommendations(macroRiskScore, riskCategory, macroTrend) {
        const recommendations = {
            trendConfidenceEvaluator: {
                macroAdjustment: true,
                riskMultiplier: macroRiskScore,
                macroTrend: macroTrend.overallDirection
            },
            exitTimingAdvisor: {
                macroRiskLevel: riskCategory,
                recommendEarlyExit: riskCategory === 'high',
                macroVolatility: macroTrend.volatility
            },
            vivo: {
                macroFilter: riskCategory === 'high',
                delaySignals: riskCategory === 'high',
                macroRiskScore: macroRiskScore
            },
            riskToRewardValidator: {
                macroRiskAdjustment: true,
                requireHigherRR: riskCategory === 'high',
                riskMultiplier: macroRiskScore > 0.6 ? 1.5 : 1.0
            }
        };

        // Yüksek risk durumunda özel önlemler
        if (riskCategory === 'high') {
            recommendations.coreOrchestrator = {
                macroRiskOverride: true,
                pauseNewSignals: true,
                reason: 'High macro economic risk detected'
            };
        }

        return recommendations;
    }

    generateAlert(macroRiskScore, riskCategory, finalSignalStrength) {
        const adjustmentPercent = Math.abs((finalSignalStrength / 100) - 1) * 100;
        
        if (riskCategory === 'high') {
            return `⚠️ Yüksek makro risk (${(macroRiskScore * 100).toFixed(1)}%) - Sinyal gücü %${adjustmentPercent.toFixed(1)} azaltıldı`;
        } else if (riskCategory === 'medium') {
            return `📊 Orta seviye makro risk - Sinyal gücü ayarlandı (${finalSignalStrength.toFixed(1)})`;
        } else {
            return `✅ Düşük makro risk - Sinyal gücü korundu (${finalSignalStrength.toFixed(1)})`;
        }
    }

    updateMacroHistory(data) {
        const timestamp = Date.now();
        
        // Her data tipi için geçmiş güncelle
        const dataTypes = ['usdtry_rate', 'interest_rate', 'google_macroRisk_trend', 'btc_dominance', 'global_fear_greed_index', 'inflation_data'];
        
        for (const dataType of dataTypes) {
            if (data[dataType] !== undefined) {
                const key = `${dataType}_history`;
                let history = this.macroDataHistory.get(key) || [];
                
                history.push({
                    timestamp: timestamp,
                    value: data[dataType]
                });
                
                // Son N günlük veri tut
                const cutoff = timestamp - (this.normalizationPeriod * 24 * 60 * 60 * 1000);
                history = history.filter(item => item.timestamp >= cutoff);
                
                this.macroDataHistory.set(key, history);
            }
        }
    }

    getDefaultResult(originalSignalStrength = 0) {
        return {
            macroRiskScore: 0,
            signalMultiplier: 1.0,
            finalSignalStrength: originalSignalStrength,
            riskCategory: 'unknown',
            macroTrend: { trends: {}, overallDirection: 'unknown', volatility: 'unknown' },
            modularRecommendations: {},
            alert: "Makro analiz yapılamadı - yetersiz veri",
            metadata: {
                error: true,
                analysisTimestamp: Date.now(),
                originalSignalStrength: originalSignalStrength
            }
        };
    }

    getModuleInfo() {
        return {
            name: 'MacroBiasImpactEvaluator',
            version: '1.0.0',
            description: 'Makro ekonomik göstergeleri analiz ederek sinyal gücünü ayarlar',
            inputs: [
                'usdtry_rate', 'interest_rate', 'google_macroRisk_trend', 'currentSignalStrength',
                'btc_dominance', 'global_fear_greed_index', 'inflation_data', 'unemployment_rate'
            ],
            outputs: [
                'macroRiskScore', 'signalMultiplier', 'finalSignalStrength', 'riskCategory',
                'macroTrend', 'modularRecommendations', 'alert', 'metadata'
            ]
        };
    }
}

module.exports = MacroBiasImpactEvaluator;
