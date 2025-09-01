const GrafikBeyniModuleBase = require('./grafikBeyniModuleBase');

/**
 * Micro Manipulation Detector Module
 * HFT etkisi, micro manipülasyon ve algoritmik müdahale tespiti
 * Piyasa mikro yapısındaki anormal davranışları tespit eder ve sistem uyarılır
 */
class MicroManipulationDetector extends GrafikBeyniModuleBase {
    constructor() {
        super('microManipulationDetector');
        this.tickData = [];
        this.orderSequence = [];
        this.pricePatterns = [];
        this.maxTickHistory = 1000;
        this.suspiciousPatterns = new Map();
        this.hftIndicators = {
            rapidOrderChanges: 0,
            microsecondPatterns: 0,
            artificialSpreads: 0
        };
    }

    async analyze(data) {
        try {
            const {
                tickData,
                orderBookData,
                tradeSequence,
                bidAskSpread,
                spreadVariation,
                orderSize,
                orderFrequency,
                priceMovementPattern,
                volumeDistribution,
                marketDepth,
                latency,
                timestamp,
                exchangeId,
                tradingPair
            } = data;

            // Veri doğrulama
            if (!tickData && !orderBookData && !tradeSequence) {
                throw new Error('Missing required microstructure data for manipulation detection');
            }

            // Tick data analysis
            const tickAnalysis = this.analyzeTickPatterns(tickData, timestamp);

            // Order book manipulation tespiti
            const orderBookManipulation = this.detectOrderBookManipulation(orderBookData, orderSize, orderFrequency);

            // HFT activity tespiti
            const hftActivity = this.detectHFTActivity(data);

            // Spread manipulation analizi
            const spreadManipulation = this.analyzeSpreadManipulation(bidAskSpread, spreadVariation, marketDepth);

            // Trade sequence anomaly tespiti
            const tradeAnomalies = this.detectTradeSequenceAnomalies(tradeSequence, volumeDistribution);

            // Layering ve spoofing tespiti
            const layeringSpoofing = this.detectLayeringSpoofing(orderBookData, orderSequence);

            // Market impact manipulation
            const marketImpactManipulation = this.analyzeMarketImpactManipulation(data);

            // Overall manipulation score
            const manipulationScore = this.calculateManipulationScore(
                tickAnalysis,
                orderBookManipulation,
                hftActivity,
                spreadManipulation,
                tradeAnomalies,
                layeringSpoofing,
                marketImpactManipulation
            );

            // Risk assessment
            const riskAssessment = this.assessManipulationRisk(manipulationScore, data);

            // System alert level
            const alertLevel = this.determineAlertLevel(manipulationScore, riskAssessment);

            // Recommendations oluşturma
            const recommendations = this.generateRecommendations(manipulationScore, alertLevel, riskAssessment);

            const result = {
                isManipulationDetected: manipulationScore > 6.0,
                manipulationScore: manipulationScore,
                alertLevel: alertLevel,
                tickAnalysis: tickAnalysis,
                orderBookManipulation: orderBookManipulation,
                hftActivity: hftActivity,
                spreadManipulation: spreadManipulation,
                tradeAnomalies: tradeAnomalies,
                layeringSpoofing: layeringSpoofing,
                marketImpactManipulation: marketImpactManipulation,
                riskAssessment: riskAssessment,
                recommendations: recommendations,
                notes: this.generateNotes(manipulationScore, alertLevel, riskAssessment),
                metadata: {
                    analysisTimestamp: Date.now(),
                    detectionConfidence: this.calculateDetectionConfidence(manipulationScore, data),
                    manipulationTypes: this.identifyManipulationTypes(manipulationScore, data),
                    systemImpact: this.assessSystemImpact(alertLevel),
                    historicalContext: this.getHistoricalContext()
                }
            };

            // Update internal state
            this.updateTickData(tickData, timestamp);
            this.updateSuspiciousPatterns(result);
            this.updateHFTIndicators(hftActivity);

            // Cache ve performance tracking
            this.updateCache(data, result);
            this.trackPerformance(Date.now(), result.isManipulationDetected);

            return result;

        } catch (error) {
            this.handleError('MicroManipulationDetector analysis failed', error, data);
            return this.getDefaultResult();
        }
    }

    analyzeTickPatterns(tickData, timestamp) {
        if (!tickData || tickData.length === 0) {
            return { patterns: [], score: 0, anomalies: [] };
        }

        const patterns = [];
        const anomalies = [];
        let score = 0;

        // Microsecond pattern detection
        const microPatterns = this.detectMicrosecondPatterns(tickData);
        if (microPatterns.count > 5) {
            patterns.push('microsecond_timing');
            score += 2.0;
            anomalies.push('unusual_timing_precision');
        }

        // Price ping-pong detection
        const pingPongPattern = this.detectPingPongPattern(tickData);
        if (pingPongPattern.detected) {
            patterns.push('price_ping_pong');
            score += 3.0;
            anomalies.push('rapid_price_oscillation');
        }

        // Artificial tick generation
        const artificialTicks = this.detectArtificialTicks(tickData);
        if (artificialTicks.ratio > 0.3) {
            patterns.push('artificial_tick_generation');
            score += 2.5;
            anomalies.push('non_natural_tick_spacing');
        }

        // Quote stuffing
        const quoteStuffing = this.detectQuoteStuffing(tickData);
        if (quoteStuffing.detected) {
            patterns.push('quote_stuffing');
            score += 4.0;
            anomalies.push('excessive_quote_updates');
        }

        return {
            patterns: patterns,
            score: score,
            anomalies: anomalies,
            microPatterns: microPatterns,
            pingPongPattern: pingPongPattern,
            artificialTicks: artificialTicks,
            quoteStuffing: quoteStuffing
        };
    }

    detectOrderBookManipulation(orderBookData, orderSize, orderFrequency) {
        if (!orderBookData) {
            return { manipulation: [], score: 0, confidence: 0 };
        }

        const manipulation = [];
        let score = 0;

        // Large order disappearance (iceberg detection)
        const icebergActivity = this.detectIcebergActivity(orderBookData, orderSize);
        if (icebergActivity.detected) {
            manipulation.push('iceberg_orders');
            score += 1.5;
        }

        // Rapid order placement/cancellation
        const rapidChanges = this.detectRapidOrderChanges(orderBookData, orderFrequency);
        if (rapidChanges.ratio > 0.7) {
            manipulation.push('rapid_order_changes');
            score += 2.5;
        }

        // Order book imbalance manipulation
        const imbalanceManipulation = this.detectImbalanceManipulation(orderBookData);
        if (imbalanceManipulation.detected) {
            manipulation.push('imbalance_manipulation');
            score += 3.0;
        }

        // Phantom liquidity
        const phantomLiquidity = this.detectPhantomLiquidity(orderBookData);
        if (phantomLiquidity.detected) {
            manipulation.push('phantom_liquidity');
            score += 3.5;
        }

        return {
            manipulation: manipulation,
            score: score,
            confidence: this.calculateOrderBookConfidence(manipulation.length, orderBookData),
            details: {
                icebergActivity: icebergActivity,
                rapidChanges: rapidChanges,
                imbalanceManipulation: imbalanceManipulation,
                phantomLiquidity: phantomLiquidity
            }
        };
    }

    detectHFTActivity(data) {
        const {
            orderFrequency,
            latency,
            volumeDistribution,
            priceMovementPattern
        } = data;

        const indicators = [];
        let score = 0;

        // Ultra-high frequency trading
        if (orderFrequency > 1000) { // 1000+ orders per second
            indicators.push('ultra_high_frequency');
            score += 2.0;
        }

        // Sub-millisecond latency
        if (latency < 1) { // Less than 1ms
            indicators.push('sub_millisecond_latency');
            score += 1.5;
        }

        // Volume clustering in small sizes
        if (volumeDistribution && this.detectVolumeFragmentation(volumeDistribution)) {
            indicators.push('volume_fragmentation');
            score += 1.0;
        }

        // Algorithmic price movement patterns
        if (this.detectAlgorithmicPatterns(priceMovementPattern)) {
            indicators.push('algorithmic_patterns');
            score += 2.5;
        }

        // Co-location advantages
        const colocationAdvantage = this.detectColocationAdvantage(data);
        if (colocationAdvantage.detected) {
            indicators.push('colocation_advantage');
            score += 1.5;
        }

        return {
            indicators: indicators,
            score: score,
            intensity: this.calculateHFTIntensity(score, orderFrequency),
            impact: this.assessHFTImpact(indicators, data)
        };
    }

    analyzeSpreadManipulation(bidAskSpread, spreadVariation, marketDepth) {
        if (!bidAskSpread || !spreadVariation) {
            return { manipulation: false, score: 0, type: 'none' };
        }

        let score = 0;
        const manipulations = [];

        // Artificial spread widening
        if (spreadVariation > 2.0 && marketDepth > 100000) {
            manipulations.push('artificial_spread_widening');
            score += 2.0;
        }

        // Spread compression manipulation
        if (bidAskSpread < 0.001 && spreadVariation > 1.5) {
            manipulations.push('spread_compression');
            score += 1.5;
        }

        // Tick size manipulation
        const tickManipulation = this.detectTickSizeManipulation(bidAskSpread);
        if (tickManipulation.detected) {
            manipulations.push('tick_size_manipulation');
            score += tickManipulation.severity;
        }

        return {
            manipulation: manipulations.length > 0,
            score: score,
            type: manipulations.length > 0 ? manipulations[0] : 'none',
            manipulations: manipulations,
            confidence: this.calculateSpreadConfidence(score, bidAskSpread)
        };
    }

    detectTradeSequenceAnomalies(tradeSequence, volumeDistribution) {
        if (!tradeSequence || tradeSequence.length === 0) {
            return { anomalies: [], score: 0 };
        }

        const anomalies = [];
        let score = 0;

        // Wash trading detection
        const washTrading = this.detectWashTrading(tradeSequence);
        if (washTrading.detected) {
            anomalies.push('wash_trading');
            score += 4.0;
        }

        // Circular trading patterns
        const circularTrading = this.detectCircularTrading(tradeSequence);
        if (circularTrading.detected) {
            anomalies.push('circular_trading');
            score += 3.5;
        }

        // Volume velocity anomalies
        const velocityAnomalies = this.detectVolumeVelocityAnomalies(tradeSequence, volumeDistribution);
        if (velocityAnomalies.detected) {
            anomalies.push('volume_velocity_anomaly');
            score += 2.0;
        }

        // Trade timing patterns
        const timingPatterns = this.detectSuspiciousTimingPatterns(tradeSequence);
        if (timingPatterns.detected) {
            anomalies.push('suspicious_timing_patterns');
            score += 1.5;
        }

        return {
            anomalies: anomalies,
            score: score,
            details: {
                washTrading: washTrading,
                circularTrading: circularTrading,
                velocityAnomalies: velocityAnomalies,
                timingPatterns: timingPatterns
            }
        };
    }

    detectLayeringSpoofing(orderBookData, orderSequence) {
        if (!orderBookData || !orderSequence) {
            return { detected: false, score: 0, type: 'none' };
        }

        let score = 0;
        const detectedTypes = [];

        // Layering detection - multiple large orders on one side
        const layering = this.detectLayering(orderBookData);
        if (layering.detected) {
            detectedTypes.push('layering');
            score += 3.0;
        }

        // Spoofing detection - large orders that get cancelled
        const spoofing = this.detectSpoofing(orderSequence);
        if (spoofing.detected) {
            detectedTypes.push('spoofing');
            score += 4.0;
        }

        // Order book manipulation through fake depth
        const fakeDepth = this.detectFakeDepth(orderBookData);
        if (fakeDepth.detected) {
            detectedTypes.push('fake_depth');
            score += 2.5;
        }

        return {
            detected: detectedTypes.length > 0,
            score: score,
            type: detectedTypes.length > 0 ? detectedTypes[0] : 'none',
            detectedTypes: detectedTypes,
            confidence: this.calculateLayeringConfidence(score, orderBookData)
        };
    }

    analyzeMarketImpactManipulation(data) {
        const {
            volumeDistribution,
            priceMovementPattern,
            marketDepth,
            orderSize
        } = data;

        let score = 0;
        const manipulations = [];

        // Disproportionate market impact
        const disproportionateImpact = this.detectDisproportionateImpact(orderSize, priceMovementPattern, marketDepth);
        if (disproportionateImpact.detected) {
            manipulations.push('disproportionate_impact');
            score += 2.5;
        }

        // Market cornering attempts
        const corneringAttempt = this.detectCorneringAttempt(volumeDistribution, marketDepth);
        if (corneringAttempt.detected) {
            manipulations.push('cornering_attempt');
            score += 3.5;
        }

        // Momentum ignition
        const momentumIgnition = this.detectMomentumIgnition(priceMovementPattern, volumeDistribution);
        if (momentumIgnition.detected) {
            manipulations.push('momentum_ignition');
            score += 3.0;
        }

        return {
            manipulations: manipulations,
            score: score,
            confidence: this.calculateImpactConfidence(score, data)
        };
    }

    calculateManipulationScore(tickAnalysis, orderBookManipulation, hftActivity, spreadManipulation, tradeAnomalies, layeringSpoofing, marketImpactManipulation) {
        const weights = {
            tick: 0.20,
            orderBook: 0.25,
            hft: 0.15,
            spread: 0.10,
            trade: 0.15,
            layering: 0.10,
            impact: 0.05
        };

        const score = 
            (tickAnalysis.score * weights.tick) +
            (orderBookManipulation.score * weights.orderBook) +
            (hftActivity.score * weights.hft) +
            (spreadManipulation.score * weights.spread) +
            (tradeAnomalies.score * weights.trade) +
            (layeringSpoofing.score * weights.layering) +
            (marketImpactManipulation.score * weights.impact);

        return Math.min(10, score);
    }

    assessManipulationRisk(manipulationScore, data) {
        let riskLevel = 'low';
        let impact = 'minimal';
        let urgency = 'none';

        if (manipulationScore > 8.0) {
            riskLevel = 'critical';
            impact = 'severe';
            urgency = 'immediate';
        } else if (manipulationScore > 6.0) {
            riskLevel = 'high';
            impact = 'significant';
            urgency = 'high';
        } else if (manipulationScore > 4.0) {
            riskLevel = 'moderate';
            impact = 'moderate';
            urgency = 'medium';
        } else if (manipulationScore > 2.0) {
            riskLevel = 'low';
            impact = 'minimal';
            urgency = 'low';
        }

        return {
            riskLevel: riskLevel,
            impact: impact,
            urgency: urgency,
            confidence: this.calculateRiskConfidence(manipulationScore, data),
            recommendation: this.getRiskRecommendation(riskLevel)
        };
    }

    determineAlertLevel(manipulationScore, riskAssessment) {
        if (manipulationScore > 8.0 || riskAssessment.urgency === 'immediate') {
            return 'red'; // Emergency
        } else if (manipulationScore > 6.0 || riskAssessment.urgency === 'high') {
            return 'orange'; // High alert
        } else if (manipulationScore > 4.0 || riskAssessment.urgency === 'medium') {
            return 'yellow'; // Caution
        } else if (manipulationScore > 2.0) {
            return 'blue'; // Information
        } else {
            return 'green'; // Normal
        }
    }

    generateRecommendations(manipulationScore, alertLevel, riskAssessment) {
        const recommendations = {};

        switch (alertLevel) {
            case 'red':
                recommendations.coreOrchestrator = 'emergencyHalt';
                recommendations.vivo = 'blockAllSignals';
                recommendations.entryGatekeeper = 'emergencyBlock';
                recommendations.liquidityStressScanner = 'maximumAlert';
                recommendations.fakeMoveCatcher = 'strictValidation';
                break;

            case 'orange':
                recommendations.coreOrchestrator = 'highAlert';
                recommendations.vivo = 'requireTripleConfirmation';
                recommendations.entryGatekeeper = 'strictValidation';
                recommendations.latencyGapAnalyzer = 'enhancedMonitoring';
                break;

            case 'yellow':
                recommendations.vivo = 'requireAdditionalConfirmation';
                recommendations.entryGatekeeper = 'increasedCaution';
                recommendations.volumeConfirmBreakout = 'strictVolumeCheck';
                break;

            case 'blue':
                recommendations.vivo = 'enableManipulationFilter';
                recommendations.entryGatekeeper = 'standardPlusCaution';
                break;

            case 'green':
                recommendations.coreOrchestrator = 'normalOperation';
                break;
        }

        // Risk-specific recommendations
        if (riskAssessment.impact === 'severe') {
            recommendations.alertSystem = 'notifyAdministrator';
            recommendations.dataLogger = 'logManipulationEvent';
        }

        return recommendations;
    }

    generateNotes(manipulationScore, alertLevel, riskAssessment) {
        const notes = [];

        if (manipulationScore > 8.0) {
            notes.push("Kritik seviye micro manipülasyon tespit edildi.");
        } else if (manipulationScore > 6.0) {
            notes.push("Yüksek seviye HFT/manipülasyon aktivitesi.");
        }

        if (alertLevel === 'red') {
            notes.push("ACIL: Sistem durdurulmalı.");
        } else if (alertLevel === 'orange') {
            notes.push("UYARI: Yüksek manipülasyon riski.");
        }

        if (riskAssessment.urgency === 'immediate') {
            notes.push("Anında müdahale gerekli.");
        }

        return notes.join(' ');
    }

    // Helper methods (Simplified implementations - real implementations would be more complex)
    detectMicrosecondPatterns(tickData) {
        // Simplified: Count sub-millisecond timing patterns
        let count = 0;
        for (let i = 1; i < tickData.length; i++) {
            const timeDiff = tickData[i].timestamp - tickData[i-1].timestamp;
            if (timeDiff < 1) count++;
        }
        return { count: count, detected: count > 5 };
    }

    detectPingPongPattern(tickData) {
        // Simplified: Look for rapid price oscillations
        let oscillations = 0;
        for (let i = 2; i < tickData.length; i++) {
            const prev2 = tickData[i-2].price;
            const prev1 = tickData[i-1].price;
            const curr = tickData[i].price;
            
            if ((prev2 < prev1 && prev1 > curr) || (prev2 > prev1 && prev1 < curr)) {
                oscillations++;
            }
        }
        return { detected: oscillations > tickData.length * 0.3, oscillations: oscillations };
    }

    detectArtificialTicks(tickData) {
        // Simplified: Check for unnaturally regular tick spacing
        if (tickData.length < 10) return { ratio: 0, detected: false };
        
        const intervals = [];
        for (let i = 1; i < tickData.length; i++) {
            intervals.push(tickData[i].timestamp - tickData[i-1].timestamp);
        }
        
        const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
        const regularIntervals = intervals.filter(interval => 
            Math.abs(interval - avgInterval) < avgInterval * 0.1
        ).length;
        
        const ratio = regularIntervals / intervals.length;
        return { ratio: ratio, detected: ratio > 0.7 };
    }

    detectQuoteStuffing(tickData) {
        // Simplified: Excessive quote updates without trades
        const quoteUpdates = tickData.filter(tick => tick.type === 'quote').length;
        const trades = tickData.filter(tick => tick.type === 'trade').length;
        const ratio = trades > 0 ? quoteUpdates / trades : quoteUpdates;
        
        return { detected: ratio > 10, ratio: ratio };
    }

    updateTickData(tickData, timestamp) {
        if (tickData) {
            this.tickData.push(...tickData.map(tick => ({ ...tick, analysisTimestamp: timestamp })));
            
            if (this.tickData.length > this.maxTickHistory) {
                this.tickData = this.tickData.slice(-this.maxTickHistory);
            }
        }
    }

    updateSuspiciousPatterns(result) {
        const key = `${Date.now()}_${result.manipulationScore}`;
        this.suspiciousPatterns.set(key, {
            score: result.manipulationScore,
            alertLevel: result.alertLevel,
            timestamp: Date.now()
        });

        // Keep only recent patterns (last hour)
        const oneHourAgo = Date.now() - (60 * 60 * 1000);
        for (const [key, pattern] of this.suspiciousPatterns.entries()) {
            if (pattern.timestamp < oneHourAgo) {
                this.suspiciousPatterns.delete(key);
            }
        }
    }

    updateHFTIndicators(hftActivity) {
        if (hftActivity.indicators.includes('ultra_high_frequency')) {
            this.hftIndicators.rapidOrderChanges++;
        }
        if (hftActivity.indicators.includes('sub_millisecond_latency')) {
            this.hftIndicators.microsecondPatterns++;
        }
        if (hftActivity.indicators.includes('algorithmic_patterns')) {
            this.hftIndicators.artificialSpreads++;
        }
    }

    getHistoricalContext() {
        const recentPatterns = Array.from(this.suspiciousPatterns.values());
        const avgScore = recentPatterns.length > 0 ? 
            recentPatterns.reduce((sum, p) => sum + p.score, 0) / recentPatterns.length : 0;
        
        return {
            recentPatternsCount: recentPatterns.length,
            averageScore: avgScore,
            trend: this.calculateTrend(recentPatterns)
        };
    }

    calculateTrend(patterns) {
        if (patterns.length < 2) return 'stable';
        
        const recent = patterns.slice(-5);
        const older = patterns.slice(-10, -5);
        
        const recentAvg = recent.reduce((sum, p) => sum + p.score, 0) / recent.length;
        const olderAvg = older.length > 0 ? older.reduce((sum, p) => sum + p.score, 0) / older.length : recentAvg;
        
        if (recentAvg > olderAvg * 1.2) return 'increasing';
        if (recentAvg < olderAvg * 0.8) return 'decreasing';
        return 'stable';
    }

    getDefaultResult() {
        return {
            isManipulationDetected: false,
            manipulationScore: 0,
            alertLevel: 'green',
            tickAnalysis: { patterns: [], score: 0, anomalies: [] },
            orderBookManipulation: { manipulation: [], score: 0, confidence: 0 },
            hftActivity: { indicators: [], score: 0, intensity: 'low', impact: 'minimal' },
            spreadManipulation: { manipulation: false, score: 0, type: 'none' },
            tradeAnomalies: { anomalies: [], score: 0 },
            layeringSpoofing: { detected: false, score: 0, type: 'none' },
            marketImpactManipulation: { manipulations: [], score: 0, confidence: 0 },
            riskAssessment: {
                riskLevel: 'unknown',
                impact: 'unknown',
                urgency: 'none',
                confidence: 0,
                recommendation: 'insufficient_data'
            },
            recommendations: {},
            notes: "Micro manipülasyon analizi yapılamadı - yetersiz veri",
            metadata: {
                error: true,
                analysisTimestamp: Date.now()
            }
        };
    }

    getModuleInfo() {
        return {
            name: 'MicroManipulationDetector',
            version: '1.0.0',
            description: 'HFT etkisi ve micro manipülasyon tespiti',
            inputs: [
                'tickData', 'orderBookData', 'tradeSequence', 'bidAskSpread',
                'spreadVariation', 'orderSize', 'orderFrequency', 'priceMovementPattern',
                'volumeDistribution', 'marketDepth', 'latency', 'timestamp',
                'exchangeId', 'tradingPair'
            ],
            outputs: [
                'isManipulationDetected', 'manipulationScore', 'alertLevel',
                'tickAnalysis', 'orderBookManipulation', 'hftActivity',
                'spreadManipulation', 'tradeAnomalies', 'layeringSpoofing',
                'marketImpactManipulation', 'riskAssessment', 'recommendations',
                'notes', 'metadata'
            ]
        };
    }
}

module.exports = MicroManipulationDetector;
