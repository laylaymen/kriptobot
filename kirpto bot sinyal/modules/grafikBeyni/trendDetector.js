/**
 * 📦 trendDetector.js
 * 🎯 Trendin yönünü ve başlangıcını tanıyan ana motor
 */

const GrafikBeyniModuleBase = require('../grafikBeyniModuleBase');

class TrendDetector extends GrafikBeyniModuleBase {
    constructor(config = {}) {
        super('trendDetector', {
            ...config,
            scoreThreshold: 0.65,
            emaWeights: {
                ema21: 0.4,
                ema50: 0.35,
                ema9: 0.25
            },
            volumeThreshold: 1.5,
            rsiOverboughtLevel: 80,
            rsiOversoldLevel: 20,
            minCandleConfirmation: 2
        });

        // Trend detection state
        this.trendHistory = new Map();
        this.lastTrendDetection = new Map();
    }

    async performAnalysis(marketData) {
        try {
            const {
                symbol = 'UNKNOWN',
                timeframe = '5m',
                prices = [],
                indicators = {},
                volume = 1.0,
                volatility = 1.0,
                candlePatterns = []
            } = marketData;

            // Market condition analizi
            const marketCondition = this.analyzeMarketCondition(marketData);
            
            // EMA kesişim analizi
            const emaAnalysis = this.analyzeEMACrossings(indicators, prices);
            
            // MACD sinyal analizi
            const macdAnalysis = this.analyzeMACDSignals(indicators.MACD || indicators.macd);
            
            // RSI destekleyici analizi
            const rsiAnalysis = this.analyzeRSISupport(indicators.RSI || indicators.rsi14);
            
            // Mum ve volatilite teyidi
            const candleVolumeAnalysis = this.analyzeCandleVolume(candlePatterns, volume, volatility);
            
            // Trend tespiti
            const trendDetection = this.detectTrend(
                emaAnalysis,
                macdAnalysis,
                rsiAnalysis,
                candleVolumeAnalysis,
                marketCondition
            );
            
            // Confidence score hesaplama
            const confidenceScore = this.calculateConfidenceScore(
                emaAnalysis,
                macdAnalysis,
                rsiAnalysis,
                candleVolumeAnalysis
            );
            
            // Trend history güncelle
            this.updateTrendHistory(symbol, trendDetection, confidenceScore);
            
            // Notification objesi oluştur
            const notifications = this.generateNotifications(
                trendDetection,
                confidenceScore,
                emaAnalysis,
                macdAnalysis
            );
            
            // Sinyal oluştur
            const signal = this.createSignal('trend-detection', confidenceScore, {
                variant: trendDetection.trendType,
                riskLevel: this.assessRiskLevel(trendDetection, confidenceScore, marketCondition),
                analysis: {
                    trendDetected: trendDetection.detected,
                    trendType: trendDetection.trendType,
                    confidenceScore,
                    reasons: trendDetection.reasons,
                    emaAnalysis,
                    macdAnalysis,
                    rsiAnalysis,
                    candleVolumeAnalysis,
                    marketCondition
                },
                recommendations: this.generateRecommendations(trendDetection, confidenceScore),
                confirmationChain: this.buildConfirmationChain(
                    emaAnalysis,
                    macdAnalysis,
                    rsiAnalysis,
                    candleVolumeAnalysis
                )
            });

            return {
                signals: [signal],
                metadata: {
                    moduleName: this.name,
                    trendDetected: trendDetection.detected,
                    trendType: trendDetection.trendType,
                    confidenceScore,
                    reasons: trendDetection.reasons,
                    notify: notifications
                }
            };

        } catch (error) {
            console.error('❌ TrendDetector analysis error:', error);
            return { signals: [], error: error.message };
        }
    }

    /**
     * EMA kesişim analizi
     */
    analyzeEMACrossings(indicators, prices) {
        const { EMA21, EMA50, ema21, ema50, ema9 } = indicators;
        const ema21Val = EMA21 || ema21;
        const ema50Val = EMA50 || ema50;
        const ema9Val = ema9;
        
        let signals = [];
        let crossingType = 'none';
        let strength = 0.5;
        
        if (!ema21Val || !ema50Val) {
            return { signals: ['missing_ema_data'], crossingType, strength };
        }

        // Ana EMA kesişimi
        if (ema21Val > ema50Val) {
            crossingType = 'bullish';
            strength += 0.3;
            signals.push('EMA21 > EMA50');
            
            // EMA9 confirmation
            if (ema9Val && ema9Val > ema21Val) {
                strength += 0.2;
                signals.push('EMA9 > EMA21 confirmation');
            }
        } else if (ema21Val < ema50Val) {
            crossingType = 'bearish';
            strength -= 0.3;
            signals.push('EMA21 < EMA50');
            
            if (ema9Val && ema9Val < ema21Val) {
                strength -= 0.2;
                signals.push('EMA9 < EMA21 confirmation');
            }
        }

        // Price vs EMA position
        const currentPrice = prices.length > 0 ? prices[prices.length - 1] : null;
        if (currentPrice && ema21Val) {
            if (currentPrice > ema21Val && crossingType === 'bullish') {
                strength += 0.1;
                signals.push('Price above EMA21');
            } else if (currentPrice < ema21Val && crossingType === 'bearish') {
                strength -= 0.1;
                signals.push('Price below EMA21');
            }
        }

        // EMA slope analysis
        const emaSlope = this.calculateEMASlope(ema21Val, indicators.ema21Previous);
        if (emaSlope > 0.001 && crossingType === 'bullish') {
            strength += 0.1;
            signals.push('Positive EMA slope');
        } else if (emaSlope < -0.001 && crossingType === 'bearish') {
            strength -= 0.1;
            signals.push('Negative EMA slope');
        }

        return {
            signals,
            crossingType,
            strength: Math.max(0, Math.min(1, strength)),
            emaValues: { ema9: ema9Val, ema21: ema21Val, ema50: ema50Val }
        };
    }

    /**
     * MACD sinyal analizi
     */
    analyzeMACDSignals(macd) {
        if (!macd) {
            return { signals: ['missing_macd_data'], status: 'unknown', strength: 0.5 };
        }

        const { histogram, signalCrossed, line, signal } = macd;
        let signals = [];
        let status = 'neutral';
        let strength = 0.5;

        // MACD histogram analizi
        if (histogram > 0) {
            status = 'bullish';
            strength += 0.2;
            signals.push('MACD histogram pozitif');
            
            // Signal line crossover
            if (signalCrossed === true || (line && signal && line > signal)) {
                strength += 0.2;
                signals.push('MACD signalCrossed = true');
            }
        } else if (histogram < 0) {
            status = 'bearish';
            strength -= 0.2;
            signals.push('MACD histogram negatif');
            
            if (signalCrossed === false || (line && signal && line < signal)) {
                strength -= 0.2;
                signals.push('MACD bearish cross');
            }
        }

        // MACD momentum analizi
        if (macd.histogramPrevious) {
            const momentumChange = histogram - macd.histogramPrevious;
            if (momentumChange > 0 && status === 'bullish') {
                strength += 0.1;
                signals.push('MACD momentum artıyor');
            } else if (momentumChange < 0 && status === 'bearish') {
                strength -= 0.1;
                signals.push('MACD momentum azalıyor');
            }
        }

        // Zero line cross
        if (line && line > 0 && status === 'bullish') {
            strength += 0.1;
            signals.push('MACD zero line üstünde');
        } else if (line && line < 0 && status === 'bearish') {
            strength -= 0.1;
            signals.push('MACD zero line altında');
        }

        return {
            signals,
            status,
            strength: Math.max(0, Math.min(1, strength)),
            values: macd
        };
    }

    /**
     * RSI destekleyici analizi
     */
    analyzeRSISupport(rsi) {
        if (!rsi) {
            return { signals: ['missing_rsi_data'], zone: 'unknown', strength: 0.5 };
        }

        let signals = [];
        let zone = 'neutral';
        let strength = 0.5;

        // RSI zone analysis
        if (rsi >= 60 && rsi <= 75) {
            zone = 'güvenli yükseliş';
            strength += 0.15;
            signals.push('RSI 60–75 güvenli yükseliş');
        } else if (rsi > this.config.rsiOverboughtLevel) {
            zone = 'aşırı alım';
            strength -= 0.2;
            signals.push('RSI > 80 aşırı alım → teyitsiz trend');
        } else if (rsi < this.config.rsiOversoldLevel) {
            zone = 'aşırı satım';
            strength -= 0.2;
            signals.push('RSI < 20 aşırı satım');
        } else if (rsi >= 50 && rsi < 60) {
            zone = 'orta yükseliş';
            strength += 0.1;
            signals.push('RSI 50-60 orta yükseliş');
        } else if (rsi > 25 && rsi < 50) {
            zone = 'orta düşüş';
            strength -= 0.1;
            signals.push('RSI 25-50 orta düşüş');
        }

        // RSI divergence (simplified)
        const rsiTrend = this.calculateRSITrend(rsi);
        if (rsiTrend === 'rising' && zone !== 'aşırı alım') {
            strength += 0.05;
            signals.push('RSI yükselen trend');
        } else if (rsiTrend === 'falling' && zone !== 'aşırı satım') {
            strength -= 0.05;
            signals.push('RSI düşen trend');
        }

        return {
            signals,
            zone,
            strength: Math.max(0, Math.min(1, strength)),
            value: rsi
        };
    }

    /**
     * Mum ve hacim teyidi analizi
     */
    analyzeCandleVolume(candlePatterns, volume, volatility) {
        let signals = [];
        let strength = 0.5;
        let volumeConfirmed = false;
        let candleConfirmed = false;

        // Volume analizi
        if (volume > this.config.volumeThreshold) {
            volumeConfirmed = true;
            strength += 0.15;
            signals.push(`vol > ${this.config.volumeThreshold} → hareket ciddi`);
        } else if (volume < 0.8) {
            strength -= 0.1;
            signals.push('Düşük hacim → hareket şüpheli');
        }

        // Candle pattern analizi
        const bullishPatterns = candlePatterns.filter(p => 
            ['bullish', 'marubozu', 'hammer', 'doji_bullish'].includes(p)
        );
        const bearishPatterns = candlePatterns.filter(p => 
            ['bearish', 'shooting_star', 'doji_bearish'].includes(p)
        );

        if (bullishPatterns.length >= this.config.minCandleConfirmation) {
            candleConfirmed = true;
            strength += 0.1;
            signals.push(`${bullishPatterns.length}+ bullish mum teyidi`);
        } else if (bearishPatterns.length >= this.config.minCandleConfirmation) {
            candleConfirmed = true;
            strength -= 0.1;
            signals.push(`${bearishPatterns.length}+ bearish mum teyidi`);
        }

        // Volatilite analizi
        if (volatility > 1.2) {
            strength += 0.05;
            signals.push('Yüksek volatilite → güçlü hareket');
        } else if (volatility < 0.8) {
            strength -= 0.05;
            signals.push('Düşük volatilite → zayıf hareket');
        }

        // Combined confirmation
        if (volumeConfirmed && candleConfirmed) {
            strength += 0.1;
            signals.push('Hacim + mum teyidi kombine');
        }

        return {
            signals,
            strength: Math.max(0, Math.min(1, strength)),
            volumeConfirmed,
            candleConfirmed,
            values: { volume, volatility }
        };
    }

    /**
     * Trend tespiti
     */
    detectTrend(emaAnalysis, macdAnalysis, rsiAnalysis, candleVolumeAnalysis, marketCondition) {
        let detected = false;
        let trendType = 'sideways';
        let reasons = [];
        let confidence = 0.5;

        // Primary trend signals
        const emaSignal = emaAnalysis.crossingType;
        const macdSignal = macdAnalysis.status;
        
        // Bullish trend detection
        if (emaSignal === 'bullish' && macdSignal === 'bullish') {
            detected = true;
            trendType = 'uptrend';
            confidence += 0.3;
            reasons.push('EMA21 > EMA50', 'MACD histogram pozitif ve kesişim var');
            
            // Additional confirmations
            if (candleVolumeAnalysis.volumeConfirmed && candleVolumeAnalysis.candleConfirmed) {
                confidence += 0.2;
                reasons.push('Bullish candle + volüm artışı');
            }
            
            if (rsiAnalysis.zone === 'güvenli yükseliş' || rsiAnalysis.zone === 'orta yükseliş') {
                confidence += 0.1;
                reasons.push('RSI destekleyici pozisyon');
            }
        }
        // Bearish trend detection
        else if (emaSignal === 'bearish' && macdSignal === 'bearish') {
            detected = true;
            trendType = 'downtrend';
            confidence += 0.3;
            reasons.push('EMA21 < EMA50', 'MACD histogram negatif');
            
            if (candleVolumeAnalysis.volumeConfirmed) {
                confidence += 0.2;
                reasons.push('Bearish candle + volüm artışı');
            }
            
            if (rsiAnalysis.zone === 'orta düşüş') {
                confidence += 0.1;
                reasons.push('RSI bearish destekleyici');
            }
        }
        // Mixed signals - potential consolidation or weak trend
        else if (emaSignal !== 'none' || macdSignal !== 'neutral') {
            detected = false;
            trendType = 'mixed_signals';
            reasons.push('Karışık sinyaller - trend belirsiz');
        }

        // Invalidation conditions
        if (detected) {
            // RSI extreme levels invalidate trend
            if (rsiAnalysis.zone === 'aşırı alım' && trendType === 'uptrend') {
                if (!candleVolumeAnalysis.volumeConfirmed) {
                    detected = false;
                    trendType = 'invalidated';
                    confidence *= 0.5;
                    reasons.push('RSI aşırı alım + hacim düşük → sinyal baskılanır');
                }
            }
            
            // Weak MACD + poor RSI
            if (macdAnalysis.strength < 0.6 && rsiAnalysis.value < 55 && trendType === 'uptrend') {
                detected = false;
                trendType = 'exit_signal';
                reasons.push('MACD zayıf + RSI < 55 → exitTimingAdvisor uyarılır');
            }
        }

        return {
            detected,
            trendType,
            reasons,
            confidence: Math.max(0, Math.min(1, confidence))
        };
    }

    /**
     * Confidence score hesaplama
     */
    calculateConfidenceScore(emaAnalysis, macdAnalysis, rsiAnalysis, candleVolumeAnalysis) {
        const weights = this.config.emaWeights;
        
        let score = 0.5; // Base score
        
        // EMA contribution
        score += emaAnalysis.strength * 0.35;
        
        // MACD contribution
        score += (macdAnalysis.strength - 0.5) * 0.25;
        
        // RSI contribution
        score += (rsiAnalysis.strength - 0.5) * 0.2;
        
        // Volume/Candle contribution
        score += (candleVolumeAnalysis.strength - 0.5) * 0.2;
        
        return Math.max(0, Math.min(1, score));
    }

    /**
     * Notifications oluştur
     */
    generateNotifications(trendDetection, confidenceScore, emaAnalysis, macdAnalysis) {
        return {
            grafikBeyni: {
                trendType: trendDetection.trendType,
                confidenceScore: confidenceScore
            },
            vivo: {
                trendReady: trendDetection.detected && confidenceScore > 0.7,
                trendType: trendDetection.trendType,
                confidence: confidenceScore
            },
            trendConfidenceEvaluator: {
                rawTrendSignal: trendDetection.detected,
                trendType: trendDetection.trendType,
                emaData: emaAnalysis,
                macdData: macdAnalysis
            },
            exitTimingAdvisor: trendDetection.trendType === 'exit_signal' ? {
                exitSignal: true,
                reason: 'trend_weakness_detected'
            } : {}
        };
    }

    /**
     * Trend history güncelle
     */
    updateTrendHistory(symbol, trendDetection, confidenceScore) {
        if (!this.trendHistory.has(symbol)) {
            this.trendHistory.set(symbol, []);
        }
        
        const history = this.trendHistory.get(symbol);
        history.push({
            ...trendDetection,
            confidenceScore,
            timestamp: Date.now()
        });
        
        // Keep last 20 records
        if (history.length > 20) {
            history.shift();
        }
        
        this.lastTrendDetection.set(symbol, {
            ...trendDetection,
            confidenceScore,
            timestamp: Date.now()
        });
    }

    /**
     * Helper functions
     */
    calculateEMASlope(current, previous) {
        if (!current || !previous) return 0;
        return (current - previous) / previous;
    }

    calculateRSITrend(currentRSI) {
        // Simplified - in real implementation, use RSI history
        return 'neutral';
    }

    /**
     * Risk seviyesi değerlendirme
     */
    assessRiskLevel(trendDetection, confidenceScore, marketCondition) {
        if (!trendDetection.detected || confidenceScore < 0.5) {
            return 'high';
        } else if (confidenceScore > 0.8 && trendDetection.trendType !== 'mixed_signals') {
            return 'low';
        } else {
            return 'medium';
        }
    }

    /**
     * Öneriler oluştur
     */
    generateRecommendations(trendDetection, confidenceScore) {
        const recommendations = [];
        
        if (trendDetection.detected) {
            recommendations.push(`Trend detected: ${trendDetection.trendType}`);
            recommendations.push(`Confidence: ${(confidenceScore * 100).toFixed(1)}%`);
            
            trendDetection.reasons.forEach(reason => {
                recommendations.push(`Signal: ${reason}`);
            });
            
            if (confidenceScore > 0.8) {
                recommendations.push('High confidence - consider position entry');
            } else if (confidenceScore > 0.6) {
                recommendations.push('Moderate confidence - wait for additional confirmation');
            } else {
                recommendations.push('Low confidence - monitor for strengthening signals');
            }
        } else {
            recommendations.push('No clear trend detected');
            recommendations.push('Monitor for stronger signals or wait for market clarity');
        }
        
        return recommendations;
    }

    /**
     * Confirmation chain oluştur
     */
    buildConfirmationChain(emaAnalysis, macdAnalysis, rsiAnalysis, candleVolumeAnalysis) {
        const chain = [];
        
        if (emaAnalysis.crossingType === 'bullish') chain.push('ema_bullish');
        if (macdAnalysis.status === 'bullish') chain.push('macd_bullish');
        if (rsiAnalysis.zone.includes('yükseliş')) chain.push('rsi_bullish');
        if (candleVolumeAnalysis.volumeConfirmed) chain.push('volume_confirmed');
        if (candleVolumeAnalysis.candleConfirmed) chain.push('candle_confirmed');
        
        return chain;
    }

    /**
     * Trend history get
     */
    getTrendHistory(symbol) {
        return this.trendHistory.get(symbol) || [];
    }

    /**
     * Last trend detection get
     */
    getLastTrendDetection(symbol) {
        return this.lastTrendDetection.get(symbol) || null;
    }
}

module.exports = TrendDetector;
