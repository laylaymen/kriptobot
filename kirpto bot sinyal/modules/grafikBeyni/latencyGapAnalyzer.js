const GrafikBeyniModuleBase = require('./grafikBeyniModuleBase');

/**
 * Latency Gap Analyzer Module
 * Fiyat-hacim senkronizasyonu ve likidite bozulmasını tespit eder
 * Gecikme farkları ve asimetrik veri akışını analiz ederek sinyal güvenilirliğini değerlendirir
 */
class LatencyGapAnalyzer extends GrafikBeyniModuleBase {
    constructor() {
        super('latencyGapAnalyzer');
        this.latencyHistory = [];
        this.volumePriceGaps = [];
        this.tickDelay = [];
        this.maxHistorySize = 100;
        this.synchronizationThreshold = 50; // ms
        this.criticalGapThreshold = 200; // ms
    }

    async analyze(data) {
        try {
            const {
                priceTimestamp,
                volumeTimestamp,
                orderBookTimestamp,
                tradeTimestamp,
                currentPrice,
                volume,
                orderBookDepth,
                tickDelay: currentTickDelay,
                marketMicrostructure,
                networkLatency,
                exchangeLoad,
                timeOfDay
            } = data;

            // Veri doğrulama
            if (!priceTimestamp || !volumeTimestamp) {
                throw new Error('Missing required timestamp data for latency gap analysis');
            }

            // Timestamp senkronizasyon analizi
            const timestampGaps = this.calculateTimestampGaps(data);
            
            // Veri akışı gecikme analizi
            const dataFlowLatency = this.analyzeDataFlowLatency(data);
            
            // Fiyat-hacim senkronizasyon skoru
            const syncScore = this.calculateSynchronizationScore(timestampGaps, dataFlowLatency);
            
            // Likidite bozulma tespiti
            const liquidityDegradation = this.detectLiquidityDegradation(data, timestampGaps);
            
            // Sistem yükü etkisi analizi
            const systemLoadImpact = this.analyzeSystemLoadImpact(data);
            
            // Genel latency risk skoru
            const latencyRiskScore = this.calculateLatencyRiskScore(timestampGaps, dataFlowLatency, systemLoadImpact);
            
            // Sinyal güvenilirlik değerlendirmesi
            const signalReliability = this.assessSignalReliability(latencyRiskScore, syncScore);
            
            // Öneriler oluşturma
            const recommendations = this.generateRecommendations(latencyRiskScore, signalReliability, data);

            const result = {
                isLatencyGapDetected: latencyRiskScore > 3.0,
                latencyRiskScore: latencyRiskScore,
                synchronizationScore: syncScore,
                signalReliability: signalReliability,
                timestampGaps: timestampGaps,
                liquidityDegradation: liquidityDegradation,
                systemLoadImpact: systemLoadImpact,
                recommendations: recommendations,
                notes: this.generateNotes(latencyRiskScore, syncScore, liquidityDegradation),
                metadata: {
                    analysisTimestamp: Date.now(),
                    dataFlowQuality: this.assessDataFlowQuality(timestampGaps, dataFlowLatency),
                    marketMicrostructureHealth: this.assessMicrostructureHealth(data),
                    criticalGaps: this.identifyCriticalGaps(timestampGaps)
                }
            };

            // Geçmiş güncelleme
            this.updateLatencyHistory(timestampGaps, latencyRiskScore);
            
            // Cache ve performance tracking
            this.updateCache(data, result);
            this.trackPerformance(Date.now(), result.isLatencyGapDetected);

            return result;

        } catch (error) {
            this.handleError('LatencyGapAnalyzer analysis failed', error, data);
            return this.getDefaultResult();
        }
    }

    calculateTimestampGaps(data) {
        const {
            priceTimestamp,
            volumeTimestamp,
            orderBookTimestamp,
            tradeTimestamp
        } = data;

        const now = Date.now();
        const gaps = {};

        // Fiyat-hacim gecikme farkı
        if (priceTimestamp && volumeTimestamp) {
            gaps.priceVolumeGap = Math.abs(priceTimestamp - volumeTimestamp);
        }

        // OrderBook-trade gecikme farkı
        if (orderBookTimestamp && tradeTimestamp) {
            gaps.orderBookTradeGap = Math.abs(orderBookTimestamp - tradeTimestamp);
        }

        // Genel veri yaşı
        gaps.priceAge = priceTimestamp ? now - priceTimestamp : 0;
        gaps.volumeAge = volumeTimestamp ? now - volumeTimestamp : 0;
        gaps.orderBookAge = orderBookTimestamp ? now - orderBookTimestamp : 0;

        // Maksimum gecikme
        gaps.maxGap = Math.max(
            gaps.priceVolumeGap || 0,
            gaps.orderBookTradeGap || 0,
            gaps.priceAge || 0,
            gaps.volumeAge || 0,
            gaps.orderBookAge || 0
        );

        return gaps;
    }

    analyzeDataFlowLatency(data) {
        const {
            tickDelay,
            networkLatency,
            exchangeLoad,
            processingDelay
        } = data;

        const analysis = {
            networkQuality: this.assessNetworkQuality(networkLatency),
            exchangePerformance: this.assessExchangePerformance(exchangeLoad),
            tickProcessingDelay: tickDelay || 0,
            overallLatency: (networkLatency || 0) + (tickDelay || 0) + (processingDelay || 0)
        };

        // Tick delay history güncelleme
        if (tickDelay !== undefined) {
            this.tickDelay.push({
                timestamp: Date.now(),
                delay: tickDelay
            });

            // History size limit
            if (this.tickDelay.length > this.maxHistorySize) {
                this.tickDelay = this.tickDelay.slice(-this.maxHistorySize);
            }
        }

        return analysis;
    }

    calculateSynchronizationScore(timestampGaps, dataFlowLatency) {
        let score = 10; // Perfect sync başlangıcı

        // Timestamp gap penaltıları
        if (timestampGaps.priceVolumeGap > this.synchronizationThreshold) {
            score -= Math.min(timestampGaps.priceVolumeGap / 100, 3);
        }

        if (timestampGaps.orderBookTradeGap > this.synchronizationThreshold) {
            score -= Math.min(timestampGaps.orderBookTradeGap / 100, 3);
        }

        // Veri yaşı penaltıları
        const maxAge = Math.max(timestampGaps.priceAge, timestampGaps.volumeAge, timestampGaps.orderBookAge);
        if (maxAge > 1000) { // 1 saniyeden eski
            score -= Math.min(maxAge / 1000, 4);
        }

        // Network ve exchange penaltıları
        if (dataFlowLatency.overallLatency > 200) {
            score -= Math.min(dataFlowLatency.overallLatency / 200, 2);
        }

        return Math.max(0, Math.round(score * 10) / 10);
    }

    detectLiquidityDegradation(data, timestampGaps) {
        const {
            orderBookDepth,
            bidAskSpread,
            marketImpact,
            volumeFluctuations
        } = data;

        const degradationFactors = [];
        let degradationScore = 0;

        // Timestamp gap ile likidite korelasyonu
        if (timestampGaps.maxGap > this.criticalGapThreshold) {
            degradationFactors.push('critical_latency');
            degradationScore += 2.0;
        }

        // OrderBook depth stability
        if (orderBookDepth) {
            const depthVariability = this.calculateDepthVariability(orderBookDepth);
            if (depthVariability > 0.7) {
                degradationFactors.push('unstable_depth');
                degradationScore += 1.5;
            }
        }

        // Spread genişlemesi ile gecikme korelasyonu
        if (bidAskSpread && timestampGaps.priceVolumeGap > 100) {
            degradationFactors.push('spread_latency_correlation');
            degradationScore += 1.0;
        }

        // Volume fluctuation ile sync problemi
        if (volumeFluctuations > 2.0 && timestampGaps.priceVolumeGap > 150) {
            degradationFactors.push('volume_sync_issue');
            degradationScore += 1.2;
        }

        return {
            isDetected: degradationScore > 2.0,
            score: degradationScore,
            factors: degradationFactors,
            severity: this.getDegradationSeverity(degradationScore)
        };
    }

    calculateDepthVariability(orderBookDepth) {
        // Basit variability hesaplama - gerçekte daha komplex olabilir
        const totalDepth = (orderBookDepth.buy || 0) + (orderBookDepth.sell || 0);
        const imbalance = Math.abs((orderBookDepth.buy || 0) - (orderBookDepth.sell || 0)) / totalDepth;
        
        return Math.min(imbalance + (totalDepth < 10000 ? 0.3 : 0), 1.0);
    }

    getDegradationSeverity(score) {
        if (score >= 4.0) return 'critical';
        if (score >= 3.0) return 'high';
        if (score >= 2.0) return 'moderate';
        return 'low';
    }

    analyzeSystemLoadImpact(data) {
        const {
            exchangeLoad,
            networkLatency,
            timeOfDay,
            marketVolatility
        } = data;

        const impact = {
            exchangeLoadFactor: this.getExchangeLoadFactor(exchangeLoad),
            networkImpact: this.getNetworkImpact(networkLatency),
            timeBasedRisk: this.getTimeBasedRisk(timeOfDay),
            volatilityImpact: this.getVolatilityImpact(marketVolatility)
        };

        impact.combinedScore = (
            impact.exchangeLoadFactor * 0.3 +
            impact.networkImpact * 0.3 +
            impact.timeBasedRisk * 0.2 +
            impact.volatilityImpact * 0.2
        );

        return impact;
    }

    getExchangeLoadFactor(exchangeLoad) {
        if (!exchangeLoad) return 1.0;
        
        if (exchangeLoad > 0.9) return 3.0; // Very high load
        if (exchangeLoad > 0.7) return 2.0; // High load
        if (exchangeLoad > 0.5) return 1.5; // Moderate load
        return 1.0; // Normal load
    }

    getNetworkImpact(networkLatency) {
        if (!networkLatency) return 1.0;
        
        if (networkLatency > 500) return 3.0; // Very high latency
        if (networkLatency > 200) return 2.0; // High latency
        if (networkLatency > 100) return 1.5; // Moderate latency
        return 1.0; // Good latency
    }

    getTimeBasedRisk(timeOfDay) {
        const riskMap = {
            'market-open': 2.0,
            'high-activity': 1.5,
            'mid-session': 1.0,
            'low-activity': 1.2,
            'market-close': 2.0,
            'after-hours': 2.5
        };
        
        return riskMap[timeOfDay] || 1.0;
    }

    getVolatilityImpact(marketVolatility) {
        if (!marketVolatility) return 1.0;
        
        if (marketVolatility > 2.0) return 2.5; // Very high volatility
        if (marketVolatility > 1.5) return 2.0; // High volatility
        if (marketVolatility > 1.0) return 1.5; // Moderate volatility
        return 1.0; // Low volatility
    }

    calculateLatencyRiskScore(timestampGaps, dataFlowLatency, systemLoadImpact) {
        let score = 0;

        // Timestamp gap contribution
        score += Math.min(timestampGaps.maxGap / 100, 3.0);

        // Data flow latency contribution
        score += Math.min(dataFlowLatency.overallLatency / 200, 2.0);

        // System load contribution
        score += Math.min(systemLoadImpact.combinedScore - 1, 2.0);

        // Critical threshold checks
        if (timestampGaps.maxGap > this.criticalGapThreshold) {
            score += 1.5; // Critical gap penalty
        }

        if (dataFlowLatency.overallLatency > 500) {
            score += 1.0; // Critical latency penalty
        }

        return Math.max(0, score);
    }

    assessSignalReliability(latencyRiskScore, syncScore) {
        let reliability = 'high';
        let confidence = 0.9;

        if (latencyRiskScore > 5.0 || syncScore < 3.0) {
            reliability = 'very_low';
            confidence = 0.1;
        } else if (latencyRiskScore > 3.5 || syncScore < 5.0) {
            reliability = 'low';
            confidence = 0.3;
        } else if (latencyRiskScore > 2.0 || syncScore < 7.0) {
            reliability = 'moderate';
            confidence = 0.6;
        } else if (syncScore > 8.5 && latencyRiskScore < 1.0) {
            reliability = 'very_high';
            confidence = 0.95;
        }

        return {
            level: reliability,
            confidence: confidence,
            recommendation: this.getReliabilityRecommendation(reliability)
        };
    }

    getReliabilityRecommendation(reliability) {
        const recommendations = {
            'very_high': 'Signals are highly reliable, proceed with normal parameters',
            'high': 'Good signal reliability, standard operation recommended',
            'moderate': 'Signal reliability is moderate, use cautious parameters',
            'low': 'Poor signal reliability, increase confirmation requirements',
            'very_low': 'Very poor reliability, consider signal suppression'
        };
        
        return recommendations[reliability] || 'Unknown reliability level';
    }

    generateRecommendations(latencyRiskScore, signalReliability, data) {
        const recommendations = {};

        if (latencyRiskScore > 4.0) {
            recommendations.coreOrchestrator = 'activateLatencyProtection';
            recommendations.vivo = 'suppressAllSignals';
            recommendations.entryGatekeeper = 'blockEntries';
            recommendations.exitTimingAdvisor = 'delayExitSignals';
        } else if (latencyRiskScore > 2.5) {
            recommendations.vivo = 'increaseConfirmationDelay';
            recommendations.entryGatekeeper = 'requireAdditionalConfirmation';
            recommendations.tpOptimizer = 'adjustForLatency';
        } else if (latencyRiskScore > 1.5) {
            recommendations.vivo = 'slightConfirmationDelay';
            recommendations.signalCoordinator = 'enableLatencyMonitoring';
        }

        // Reliability-based recommendations
        if (signalReliability.level === 'very_low' || signalReliability.level === 'low') {
            recommendations.signalMaturityScorer = 'increaseMatureFactor';
            recommendations.falseBreakFilter = 'enableStrictFiltering';
        }

        return recommendations;
    }

    generateNotes(latencyRiskScore, syncScore, liquidityDegradation) {
        const notes = [];

        if (latencyRiskScore > 4.0) {
            notes.push("Kritik gecikme farkları tespit edildi. Sinyal güvenilirliği çok düşük.");
        } else if (latencyRiskScore > 2.5) {
            notes.push("Önemli gecikme sorunları var. Dikkatli işlem önerilir.");
        }

        if (syncScore < 5.0) {
            notes.push("Fiyat-hacim senkronizasyonu zayıf.");
        }

        if (liquidityDegradation.isDetected) {
            notes.push(`Likidite bozulması tespit edildi: ${liquidityDegradation.severity} seviye.`);
        }

        if (notes.length === 0) {
            notes.push("Latency ve senkronizasyon durumu normal.");
        }

        return notes.join(' ');
    }

    assessDataFlowQuality(timestampGaps, dataFlowLatency) {
        const maxGap = timestampGaps.maxGap;
        const overallLatency = dataFlowLatency.overallLatency;

        if (maxGap < 50 && overallLatency < 100) return 'excellent';
        if (maxGap < 100 && overallLatency < 200) return 'good';
        if (maxGap < 200 && overallLatency < 400) return 'fair';
        return 'poor';
    }

    assessMicrostructureHealth(data) {
        const { 
            orderBookDepth,
            bidAskSpread,
            marketMakerPresence,
            tickDelay 
        } = data;

        let healthScore = 10;

        if (!marketMakerPresence) healthScore -= 3;
        if (bidAskSpread > 0.5) healthScore -= 2;
        if (tickDelay > 100) healthScore -= 2;
        if (orderBookDepth && (orderBookDepth.buy + orderBookDepth.sell < 50000)) healthScore -= 2;

        if (healthScore >= 8) return 'healthy';
        if (healthScore >= 6) return 'moderate';
        if (healthScore >= 4) return 'degraded';
        return 'unhealthy';
    }

    identifyCriticalGaps(timestampGaps) {
        const critical = [];

        if (timestampGaps.priceVolumeGap > this.criticalGapThreshold) {
            critical.push({
                type: 'price_volume_gap',
                value: timestampGaps.priceVolumeGap,
                severity: 'critical'
            });
        }

        if (timestampGaps.orderBookTradeGap > this.criticalGapThreshold) {
            critical.push({
                type: 'orderbook_trade_gap',
                value: timestampGaps.orderBookTradeGap,
                severity: 'critical'
            });
        }

        if (timestampGaps.maxGap > this.criticalGapThreshold * 1.5) {
            critical.push({
                type: 'overall_max_gap',
                value: timestampGaps.maxGap,
                severity: 'critical'
            });
        }

        return critical;
    }

    assessNetworkQuality(networkLatency) {
        if (!networkLatency) return 'unknown';
        
        if (networkLatency < 50) return 'excellent';
        if (networkLatency < 100) return 'good';
        if (networkLatency < 200) return 'fair';
        return 'poor';
    }

    assessExchangePerformance(exchangeLoad) {
        if (!exchangeLoad) return 'unknown';
        
        if (exchangeLoad < 0.3) return 'excellent';
        if (exchangeLoad < 0.6) return 'good';
        if (exchangeLoad < 0.8) return 'fair';
        return 'poor';
    }

    updateLatencyHistory(timestampGaps, latencyRiskScore) {
        this.latencyHistory.push({
            timestamp: Date.now(),
            gaps: timestampGaps,
            riskScore: latencyRiskScore
        });

        // History size limit
        if (this.latencyHistory.length > this.maxHistorySize) {
            this.latencyHistory = this.latencyHistory.slice(-this.maxHistorySize);
        }
    }

    getRecentLatencyTrend() {
        if (this.latencyHistory.length < 5) return 'insufficient_data';

        const recent = this.latencyHistory.slice(-10);
        const avgRisk = recent.reduce((sum, item) => sum + item.riskScore, 0) / recent.length;

        if (avgRisk > 3.0) return 'deteriorating';
        if (avgRisk > 1.5) return 'moderate';
        return 'stable';
    }

    getDefaultResult() {
        return {
            isLatencyGapDetected: false,
            latencyRiskScore: 0,
            synchronizationScore: 10,
            signalReliability: {
                level: 'unknown',
                confidence: 0.5,
                recommendation: 'Insufficient data for analysis'
            },
            timestampGaps: {},
            liquidityDegradation: {
                isDetected: false,
                score: 0,
                factors: [],
                severity: 'none'
            },
            systemLoadImpact: {},
            recommendations: {},
            notes: "Latency gap analizi yapılamadı - yetersiz veri",
            metadata: {
                error: true,
                analysisTimestamp: Date.now()
            }
        };
    }

    getModuleInfo() {
        return {
            name: 'LatencyGapAnalyzer',
            version: '1.0.0',
            description: 'Fiyat-hacim senkronizasyonu ve latency gap analizi',
            inputs: [
                'priceTimestamp', 'volumeTimestamp', 'orderBookTimestamp', 'tradeTimestamp',
                'currentPrice', 'volume', 'orderBookDepth', 'tickDelay', 'marketMicrostructure',
                'networkLatency', 'exchangeLoad', 'timeOfDay'
            ],
            outputs: [
                'isLatencyGapDetected', 'latencyRiskScore', 'synchronizationScore',
                'signalReliability', 'timestampGaps', 'liquidityDegradation',
                'systemLoadImpact', 'recommendations', 'notes', 'metadata'
            ]
        };
    }
}

module.exports = LatencyGapAnalyzer;
