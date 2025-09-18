const GrafikBeyniModuleBase = require('../grafikBeyniModuleBase');

/**
 * Liquidity Stress Scanner Module
 * Piyasada gerçek bir likidite olup olmadığını, spread ve emir davranışlarıyla tespit eder
 * Likidite stresi varsa işlem açılmaz, TP/SL noktaları optimize edilir, sistem temkinli moda geçer
 */
class LiquidityStressScanner extends GrafikBeyniModuleBase {
    constructor() {
        super('liquidityStressScanner');
        this.stressHistory = [];
        this.dailyHighStressCount = 0;
        this.lastResetDate = new Date().toDateString();
        this.spreadAdaptationMode = false;
        this.maxDailyHighStress = 3;
        this.stressThresholds = {
            critical: 6.5,
            high: 4.5,
            moderate: 3.2,
            stable: 0
        };
    }

    async analyze(data) {
        try {
            const {
                bidAskSpread,
                spreadDeviation,
                orderBookDepthTop5,
                orderCancellationRate,
                executionRate,
                marketMakerPresence,
                priceJumpRatio,
                volatilityLevel,
                timeOfDay,
                tradingVolume24h,
                averageSpread,
                marketCapRank
            } = data;

            // Veri doğrulama
            if (bidAskSpread === undefined || executionRate === undefined) {
                throw new Error('Missing required data for liquidity stress analysis');
            }

            // Günlük reset kontrolü
            this.checkDailyReset();

            // Liquidity Stress Score hesaplama
            const liquidityStressScore = this.calculateLiquidityStressScore(data);
            
            // Stress level belirleme
            const stressLevel = this.determineStressLevel(liquidityStressScore);
            
            // Stress durumu tespiti
            const isLiquidityStress = stressLevel !== 'Stable';
            
            // Recommendations oluşturma
            const recommendations = this.generateRecommendations(stressLevel, liquidityStressScore, data);
            
            // Liquidity quality assessment
            const liquidityQuality = this.assessLiquidityQuality(data, liquidityStressScore);

            const result = {
                isLiquidityStress: isLiquidityStress,
                stressLevel: stressLevel,
                score: liquidityStressScore,
                liquidityQuality: liquidityQuality,
                recommendations: recommendations,
                notes: this.generateNotes(stressLevel, liquidityStressScore, data),
                spreadAdaptationMode: this.spreadAdaptationMode,
                metadata: {
                    analysisTimestamp: Date.now(),
                    dailyHighStressCount: this.dailyHighStressCount,
                    stressFactors: this.identifyStressFactors(data, liquidityStressScore),
                    marketConditions: this.assessMarketConditions(data),
                    liquidityRisk: this.calculateLiquidityRisk(stressLevel, liquidityStressScore)
                }
            };

            // Stress geçmişi güncelleme
            if (stressLevel === 'High' || stressLevel === 'Critical') {
                this.updateStressHistory(result);
                if (stressLevel === 'High') {
                    this.dailyHighStressCount++;
                    this.checkSpreadAdaptationMode();
                }
            }
            
            // Cache ve performance tracking
            this.updateCache(data, result);
            this.trackPerformance(Date.now(), isLiquidityStress);

            return result;

        } catch (error) {
            this.handleError('LiquidityStressScanner analysis failed', error, data);
            return this.getDefaultResult();
        }
    }

    calculateLiquidityStressScore(data) {
        const {
            bidAskSpread,
            spreadDeviation,
            orderBookDepthTop5,
            orderCancellationRate,
            executionRate,
            marketMakerPresence,
            priceJumpRatio,
            volatilityLevel,
            averageSpread,
            tradingVolume24h
        } = data;

        let score = 0;

        // Bid-Ask Spread faktörü (en kritik)
        if (bidAskSpread !== undefined) {
            // Normalize spread (ortalama spread'e göre)
            const spreadMultiplier = averageSpread ? bidAskSpread / averageSpread : bidAskSpread;
            score += Math.min(spreadMultiplier * 1.5, 3.0);
        }

        // Spread Deviation faktörü
        if (spreadDeviation !== undefined) {
            score += Math.min(spreadDeviation * 0.5, 1.5);
        }

        // Execution Rate faktörü (düşük execution = yüksek stress)
        if (executionRate !== undefined) {
            score += (1 - executionRate) * 2.0;
        }

        // Order Cancellation Rate faktörü
        if (orderCancellationRate !== undefined) {
            score += orderCancellationRate * 1.2;
        }

        // Market Maker Presence faktörü
        if (marketMakerPresence !== undefined) {
            score += marketMakerPresence ? 0 : 1.0; // Market maker yoksa stress artar
        }

        // Price Jump Ratio faktörü
        if (priceJumpRatio !== undefined) {
            score += Math.min(priceJumpRatio / 2, 2.0);
        }

        // Order Book Depth faktörü
        if (orderBookDepthTop5) {
            const totalDepth = (orderBookDepthTop5.buy || 0) + (orderBookDepthTop5.sell || 0);
            const depthStress = this.calculateDepthStress(totalDepth, tradingVolume24h);
            score += depthStress;
        }

        // Volatility Level faktörü
        if (volatilityLevel !== undefined) {
            score += Math.min(volatilityLevel * 0.8, 1.0);
        }

        return Math.max(0, score);
    }

    calculateDepthStress(totalDepth, tradingVolume24h) {
        if (!totalDepth || !tradingVolume24h) return 0.5; // Default moderate stress
        
        // Depth to volume ratio - düşük ratio = yüksek stress
        const depthToVolumeRatio = totalDepth / (tradingVolume24h / 24); // Hourly average
        
        if (depthToVolumeRatio < 0.1) return 1.5; // Very thin
        if (depthToVolumeRatio < 0.3) return 1.0; // Thin
        if (depthToVolumeRatio < 0.7) return 0.5; // Moderate
        return 0.1; // Good depth
    }

    determineStressLevel(liquidityStressScore) {
        if (liquidityStressScore >= this.stressThresholds.critical) {
            return 'Critical';
        } else if (liquidityStressScore >= this.stressThresholds.high) {
            return 'High';
        } else if (liquidityStressScore >= this.stressThresholds.moderate) {
            return 'Moderate';
        } else {
            return 'Stable';
        }
    }

    assessLiquidityQuality(data, liquidityStressScore) {
        const {
            bidAskSpread,
            orderBookDepthTop5,
            executionRate,
            marketMakerPresence,
            averageSpread
        } = data;

        const factors = {
            spreadQuality: this.assessSpreadQuality(bidAskSpread, averageSpread),
            depthQuality: this.assessDepthQuality(orderBookDepthTop5),
            executionQuality: this.assessExecutionQuality(executionRate),
            marketMakerSupport: marketMakerPresence ? 'good' : 'poor',
            overallScore: liquidityStressScore
        };

        let quality = 'unknown';
        if (liquidityStressScore < 2.0 && executionRate > 0.8) {
            quality = 'excellent';
        } else if (liquidityStressScore < 3.5 && executionRate > 0.6) {
            quality = 'good';
        } else if (liquidityStressScore < 5.0) {
            quality = 'fair';
        } else {
            quality = 'poor';
        }

        return {
            overall: quality,
            factors: factors,
            recommendation: this.getLiquidityRecommendation(quality)
        };
    }

    assessSpreadQuality(bidAskSpread, averageSpread) {
        if (!bidAskSpread) return 'unknown';
        
        const spreadRatio = averageSpread ? bidAskSpread / averageSpread : bidAskSpread;
        
        if (spreadRatio <= 0.8) return 'excellent';
        if (spreadRatio <= 1.2) return 'good';
        if (spreadRatio <= 2.0) return 'fair';
        return 'poor';
    }

    assessDepthQuality(orderBookDepthTop5) {
        if (!orderBookDepthTop5) return 'unknown';
        
        const buyDepth = orderBookDepthTop5.buy || 0;
        const sellDepth = orderBookDepthTop5.sell || 0;
        const totalDepth = buyDepth + sellDepth;
        const imbalance = Math.abs(buyDepth - sellDepth) / totalDepth;
        
        if (totalDepth > 100000 && imbalance < 0.2) return 'excellent';
        if (totalDepth > 50000 && imbalance < 0.3) return 'good';
        if (totalDepth > 20000 && imbalance < 0.5) return 'fair';
        return 'poor';
    }

    assessExecutionQuality(executionRate) {
        if (executionRate === undefined) return 'unknown';
        
        if (executionRate >= 0.9) return 'excellent';
        if (executionRate >= 0.7) return 'good';
        if (executionRate >= 0.5) return 'fair';
        return 'poor';
    }

    getLiquidityRecommendation(quality) {
        const recommendations = {
            excellent: 'Normal trading parameters can be used',
            good: 'Slightly conservative approach recommended',
            fair: 'Use conservative parameters and monitor closely',
            poor: 'Avoid trading or use very conservative parameters',
            unknown: 'Insufficient data for recommendation'
        };
        
        return recommendations[quality] || recommendations.unknown;
    }

    generateRecommendations(stressLevel, liquidityStressScore, data) {
        const recommendations = {};

        switch (stressLevel) {
            case 'Critical':
                recommendations.coreOrchestrator = 'emergencyLiquidityProtocol';
                recommendations.vivo = 'blockAllSignals';
                recommendations.tpOptimizer = 'disableTPOptimization';
                recommendations.riskToRewardValidator = 'maxConservativeMode';
                recommendations.entryGatekeeper = 'blockAllEntries';
                break;

            case 'High':
                recommendations.coreOrchestrator = 'limitExecutionSpeed';
                recommendations.vivo = 'reduceSignalAggressiveness';
                recommendations.tpOptimizer = 'applyConservativeTP';
                recommendations.entryGatekeeper = 'delayEntry';
                recommendations.exitTimingAdvisor = 'monitorSpreadImpact';
                break;

            case 'Moderate':
                recommendations.tpOptimizer = 'adjustForSpread';
                recommendations.vivo = 'increaseConfirmationThreshold';
                recommendations.riskToRewardValidator = 'adjustForLiquidity';
                recommendations.exitTimingAdvisor = 'monitorExecutionQuality';
                break;

            case 'Stable':
                recommendations.coreOrchestrator = 'normalOperation';
                recommendations.vivo = 'standardParameters';
                recommendations.tpOptimizer = 'standardTP';
                break;
        }

        // Spread adaptation mode için özel öneriler
        if (this.spreadAdaptationMode) {
            recommendations.vivo = {
                ...recommendations.vivo,
                confirmationThreshold: 3,
                signalSharpness: 'low'
            };
            recommendations.tpOptimizer = {
                ...recommendations.tpOptimizer,
                spreadAdjustment: true,
                expandTPLevels: true
            };
        }

        // Time of day adjustments
        if (data.timeOfDay === 'pre-market' || data.timeOfDay === 'after-hours') {
            recommendations.timeAdjustment = 'applyAfterHoursCaution';
        }

        return recommendations;
    }

    generateNotes(stressLevel, liquidityStressScore, data) {
        const notes = [];
        
        switch (stressLevel) {
            case 'Critical':
                notes.push("Kritik likidite stresi. İşlem yapılmamalı.");
                break;
            case 'High':
                notes.push("Yüksek emir iptali + düşük emir gerçekleşme oranı + açılan spread → gerçek hacim düşüklüğü.");
                break;
            case 'Moderate':
                notes.push("Orta seviye likidite sorunu. Dikkatli işlem önerilir.");
                break;
            case 'Stable':
                notes.push("Likidite koşulları stabil.");
                break;
        }

        if (this.spreadAdaptationMode) {
            notes.push("Sistem yoğun spread adaptasyon modunda.");
        }

        if (data.marketMakerPresence === false) {
            notes.push("Market maker eksikliği tespit edildi.");
        }

        if (data.orderCancellationRate > 0.7) {
            notes.push("Yüksek emir iptal oranı - manipülasyon riski.");
        }

        if (data.executionRate < 0.3) {
            notes.push("Çok düşük emir gerçekleşme oranı - likidite krizi.");
        }

        return notes.join(' ');
    }

    identifyStressFactors(data, liquidityStressScore) {
        const factors = [];
        
        if (data.bidAskSpread > (data.averageSpread || 0.5) * 2) {
            factors.push('wide_spread');
        }
        
        if (data.executionRate < 0.5) {
            factors.push('poor_execution');
        }
        
        if (data.orderCancellationRate > 0.6) {
            factors.push('high_cancellation');
        }
        
        if (!data.marketMakerPresence) {
            factors.push('no_market_maker');
        }
        
        if (data.priceJumpRatio > 2.0) {
            factors.push('price_instability');
        }
        
        if (data.orderBookDepthTop5) {
            const totalDepth = (data.orderBookDepthTop5.buy || 0) + (data.orderBookDepthTop5.sell || 0);
            if (totalDepth < 20000) {
                factors.push('thin_order_book');
            }
        }

        return factors;
    }

    assessMarketConditions(data) {
        return {
            timeRisk: this.getTimeRisk(data.timeOfDay),
            volumeRisk: this.getVolumeRisk(data.tradingVolume24h),
            spreadRisk: this.getSpreadRisk(data.bidAskSpread, data.averageSpread),
            volatilityRisk: this.getVolatilityRisk(data.volatilityLevel)
        };
    }

    getTimeRisk(timeOfDay) {
        const riskMap = {
            'pre-market': 'high',
            'market-open': 'medium',
            'mid-session': 'low',
            'market-close': 'medium',
            'after-hours': 'high'
        };
        return riskMap[timeOfDay] || 'unknown';
    }

    getVolumeRisk(volume24h) {
        if (!volume24h) return 'unknown';
        
        // Bu değerler coin'e göre ayarlanmalı
        if (volume24h < 1000000) return 'high';
        if (volume24h < 10000000) return 'medium';
        return 'low';
    }

    getSpreadRisk(bidAskSpread, averageSpread) {
        if (!bidAskSpread) return 'unknown';
        
        const ratio = averageSpread ? bidAskSpread / averageSpread : bidAskSpread;
        if (ratio > 3.0) return 'high';
        if (ratio > 1.5) return 'medium';
        return 'low';
    }

    getVolatilityRisk(volatilityLevel) {
        if (volatilityLevel === undefined) return 'unknown';
        
        if (volatilityLevel > 2.0) return 'high';
        if (volatilityLevel > 1.0) return 'medium';
        return 'low';
    }

    calculateLiquidityRisk(stressLevel, liquidityStressScore) {
        const baseRisk = {
            'Critical': 5,
            'High': 4,
            'Moderate': 3,
            'Stable': 1
        }[stressLevel] || 3;

        // Score'a göre fine-tuning
        const scoreMultiplier = Math.min(liquidityStressScore / 5.0, 1.5);
        const finalRisk = Math.min(baseRisk * scoreMultiplier, 5);

        if (finalRisk >= 4.5) return 'critical';
        if (finalRisk >= 3.5) return 'high';
        if (finalRisk >= 2.5) return 'medium';
        if (finalRisk >= 1.5) return 'low';
        return 'minimal';
    }

    checkDailyReset() {
        const today = new Date().toDateString();
        if (this.lastResetDate !== today) {
            this.dailyHighStressCount = 0;
            this.lastResetDate = today;
            // Spread adaptation mode günlük resetlenmez, manuel müdahale gerekir
        }
    }

    checkSpreadAdaptationMode() {
        if (this.dailyHighStressCount >= this.maxDailyHighStress && !this.spreadAdaptationMode) {
            this.spreadAdaptationMode = true;
            console.log('LiquidityStressScanner: Spread adaptation mode activated due to repeated high stress');
        }
    }

    updateStressHistory(result) {
        this.stressHistory.push({
            timestamp: Date.now(),
            stressLevel: result.stressLevel,
            score: result.score,
            factors: result.metadata.stressFactors
        });

        // History limit kontrolü (son 100 stress event)
        if (this.stressHistory.length > 100) {
            this.stressHistory = this.stressHistory.slice(-100);
        }
    }

    getRecentStressPattern() {
        const recentWindow = 6 * 60 * 60 * 1000; // 6 saat
        const cutoff = Date.now() - recentWindow;
        
        return this.stressHistory
            .filter(event => event.timestamp >= cutoff)
            .map(event => event.stressLevel);
    }

    getDefaultResult() {
        return {
            isLiquidityStress: false,
            stressLevel: 'Unknown',
            score: 0,
            liquidityQuality: {
                overall: 'unknown',
                factors: {},
                recommendation: 'Insufficient data for analysis'
            },
            recommendations: {},
            notes: "Likidite analizi yapılamadı - yetersiz veri",
            spreadAdaptationMode: this.spreadAdaptationMode,
            metadata: {
                error: true,
                analysisTimestamp: Date.now(),
                dailyHighStressCount: this.dailyHighStressCount
            }
        };
    }

    getModuleInfo() {
        return {
            name: 'LiquidityStressScanner',
            version: '1.0.0',
            description: 'Likidite stresi analizi ve piyasa mikro yapısı değerlendirmesi',
            inputs: [
                'bidAskSpread', 'spreadDeviation', 'orderBookDepthTop5', 'orderCancellationRate',
                'executionRate', 'marketMakerPresence', 'priceJumpRatio', 'volatilityLevel',
                'timeOfDay', 'tradingVolume24h', 'averageSpread', 'marketCapRank'
            ],
            outputs: [
                'isLiquidityStress', 'stressLevel', 'score', 'liquidityQuality',
                'recommendations', 'notes', 'spreadAdaptationMode', 'metadata'
            ]
        };
    }
}

module.exports = LiquidityStressScanner;
