/**
 * 📦 trendConfidenceEvaluator.js
 * 🎯 Trend sürdürülebilirlik değerlendirmesi
 */

const GrafikBeyniModuleBase = require('../grafikBeyniModuleBase');

class TrendConfidenceEvaluator extends GrafikBeyniModuleBase {
    constructor(config = {}) {
        super('trendConfidenceEvaluator', {
            ...config,
            scoreThreshold: 0.6,
            emaWeights: {
                ema9: 0.3,
                ema21: 0.25,
                ema50: 0.2,
                ema200: 0.25
            },
            indicatorWeights: {
                ema: 0.25,
                macd: 0.2,
                rsi: 0.15,
                formation: 0.15,
                supportResistance: 0.1,
                priceAction: 0.1,
                news: 0.05
            }
        });

        // Trend confidence history
        this.confidenceHistory = new Map();
    }

    async performAnalysis(marketData) {
        try {
            const {
                symbol = 'UNKNOWN',
                indicators = {},
                formation = 'unknown',
                supportResistance = {},
                priceAction = {},
                trendAngle = 0,
                newsImpact = 0,
                momentum = 0,
                currentPrice
            } = marketData;

            // Market condition analizi
            const marketCondition = this.analyzeMarketCondition(marketData);
            
            // EMA analizi
            const emaAnalysis = this.analyzeEMAs(indicators, currentPrice);
            
            // MACD analizi
            const macdAnalysis = this.analyzeMacd(indicators.macd);
            
            // RSI analizi
            const rsiAnalysis = this.analyzeRSI(indicators.rsi14);
            
            // Formation analizi
            const formationAnalysis = this.analyzeFormation(formation, marketCondition);
            
            // Support/Resistance analizi
            const srAnalysis = this.analyzeSupportResistance(supportResistance, currentPrice);
            
            // Price Action analizi
            const priceActionAnalysis = this.analyzePriceAction(priceAction, trendAngle);
            
            // News Impact analizi
            const newsAnalysis = this.analyzeNewsImpact(newsImpact, marketCondition);
            
            // Trend confidence score hesapla
            const trendConfidenceScore = this.calculateTrendConfidenceScore({
                emaAnalysis,
                macdAnalysis,
                rsiAnalysis,
                formationAnalysis,
                srAnalysis,
                priceActionAnalysis,
                newsAnalysis
            });
            
            // Pozisyon uzatma önerisi
            const shouldExtendPosition = this.evaluatePositionExtension(
                trendConfidenceScore,
                marketCondition,
                emaAnalysis,
                macdAnalysis
            );
            
            // Güç kategorisi
            const strengthCategory = this.categorizeStrength(trendConfidenceScore, marketCondition);
            
            // Uyarılar
            const triggeredAlerts = this.generateAlerts(
                trendConfidenceScore,
                emaAnalysis,
                macdAnalysis,
                rsiAnalysis,
                marketCondition
            );
            
            // Confidence history güncelle
            this.updateConfidenceHistory(symbol, trendConfidenceScore);
            
            // Sinyal oluştur
            const signal = this.createSignal('trend-confidence', trendConfidenceScore, {
                variant: strengthCategory,
                riskLevel: this.assessRiskLevel(trendConfidenceScore, marketCondition),
                analysis: {
                    trendConfidenceScore,
                    shouldExtendPosition,
                    strengthCategory,
                    triggeredAlerts,
                    componentAnalysis: {
                        emaAnalysis,
                        macdAnalysis,
                        rsiAnalysis,
                        formationAnalysis,
                        srAnalysis,
                        priceActionAnalysis,
                        newsAnalysis
                    },
                    marketCondition
                },
                recommendations: this.generateRecommendations(
                    trendConfidenceScore,
                    shouldExtendPosition,
                    strengthCategory,
                    triggeredAlerts
                ),
                confirmationChain: this.buildConfirmationChain(
                    emaAnalysis,
                    macdAnalysis,
                    rsiAnalysis,
                    formationAnalysis
                )
            });

            return {
                signals: [signal],
                metadata: {
                    moduleName: this.name,
                    trendConfidenceScore,
                    shouldExtendPosition,
                    strengthCategory,
                    triggeredAlerts,
                    notify: {
                        vivo: {
                            trendConfidence: trendConfidenceScore,
                            extendPosition: shouldExtendPosition,
                            strength: strengthCategory
                        },
                        exitTimingAdvisor: {
                            trendConfidence: trendConfidenceScore,
                            alerts: triggeredAlerts
                        },
                        grafikBeyni: {
                            trendConfidenceAnalyzed: true,
                            score: trendConfidenceScore,
                            category: strengthCategory
                        }
                    }
                }
            };

        } catch (error) {
            console.error('❌ TrendConfidenceEvaluator analysis error:', error);
            return { signals: [], error: error.message };
        }
    }

    /**
     * EMA analizi
     */
    analyzeEMAs(indicators, currentPrice) {
        const { ema9, ema21, ema50, ema200 } = indicators;
        let score = 0.5;
        let alignment = 'mixed';
        let signals = [];

        if (ema9 && ema21 && ema50) {
            // Bullish alignment
            if (ema9 > ema21 && ema21 > ema50) {
                alignment = 'bullish';
                score += 0.3;
                signals.push('bullish_ema_alignment');
                
                // Strong bullish if price above all EMAs
                if (currentPrice > ema9) {
                    score += 0.1;
                    signals.push('price_above_fast_ema');
                }
            }
            // Bearish alignment
            else if (ema9 < ema21 && ema21 < ema50) {
                alignment = 'bearish';
                score -= 0.3;
                signals.push('bearish_ema_alignment');
                
                if (currentPrice < ema9) {
                    score -= 0.1;
                    signals.push('price_below_fast_ema');
                }
            }
            // Mixed signals
            else {
                alignment = 'mixed';
                signals.push('mixed_ema_signals');
            }

            // EMA slope analysis
            const ema9Slope = this.calculateEMASlope(ema9, indicators.ema9Previous);
            const ema21Slope = this.calculateEMASlope(ema21, indicators.ema21Previous);
            
            if (ema9Slope > 0 && ema21Slope > 0) {
                score += 0.1;
                signals.push('positive_ema_slopes');
            } else if (ema9Slope < 0 && ema21Slope < 0) {
                score -= 0.1;
                signals.push('negative_ema_slopes');
            }
        }

        // Long-term trend (EMA200)
        if (ema200 && currentPrice) {
            if (currentPrice > ema200) {
                score += 0.05;
                signals.push('above_long_term_trend');
            } else {
                score -= 0.05;
                signals.push('below_long_term_trend');
            }
        }

        return {
            score: Math.max(0, Math.min(1, score)),
            alignment,
            signals,
            slopes: {
                ema9: this.calculateEMASlope(ema9, indicators.ema9Previous),
                ema21: this.calculateEMASlope(ema21, indicators.ema21Previous)
            }
        };
    }

    /**
     * MACD analizi
     */
    analyzeMacd(macd) {
        if (!macd) return { score: 0.5, signals: [], status: 'unknown' };

        let score = 0.5;
        let signals = [];
        let status = 'neutral';

        const { line, signal, histogram } = macd;

        // MACD line vs signal line
        if (line > signal) {
            score += 0.2;
            status = 'bullish';
            signals.push('macd_bullish_crossover');
        } else {
            score -= 0.2;
            status = 'bearish';
            signals.push('macd_bearish_crossover');
        }

        // Histogram analysis
        if (histogram > 0) {
            score += 0.1;
            signals.push('positive_histogram');
            
            // Increasing histogram (momentum strengthening)
            if (macd.histogramPrevious && histogram > macd.histogramPrevious) {
                score += 0.1;
                signals.push('increasing_momentum');
            }
        } else {
            score -= 0.1;
            signals.push('negative_histogram');
            
            if (macd.histogramPrevious && histogram < macd.histogramPrevious) {
                score -= 0.1;
                signals.push('decreasing_momentum');
            }
        }

        // Zero line cross
        if (line > 0) {
            score += 0.05;
            signals.push('macd_above_zero');
        } else {
            score -= 0.05;
            signals.push('macd_below_zero');
        }

        return {
            score: Math.max(0, Math.min(1, score)),
            signals,
            status
        };
    }

    /**
     * RSI analizi
     */
    analyzeRSI(rsi) {
        if (!rsi) return { score: 0.5, signals: [], zone: 'unknown' };

        let score = 0.5;
        let signals = [];
        let zone = 'neutral';

        // RSI zones
        if (rsi > 70) {
            zone = 'overbought';
            score -= 0.2; // Trend sürdürülebilirliği azalır
            signals.push('rsi_overbought');
            
            if (rsi > 80) {
                score -= 0.1;
                signals.push('rsi_extremely_overbought');
            }
        } else if (rsi < 30) {
            zone = 'oversold';
            score -= 0.2; // Bearish trend sürdürülebilirliği azalır
            signals.push('rsi_oversold');
            
            if (rsi < 20) {
                score -= 0.1;
                signals.push('rsi_extremely_oversold');
            }
        } else if (rsi > 50 && rsi < 70) {
            zone = 'bullish';
            score += 0.1;
            signals.push('rsi_bullish_zone');
        } else if (rsi > 30 && rsi < 50) {
            zone = 'bearish';
            score -= 0.1;
            signals.push('rsi_bearish_zone');
        }

        // RSI trend
        const rsiTrend = this.calculateRSITrend(rsi);
        if (rsiTrend === 'rising') {
            score += 0.05;
            signals.push('rsi_rising');
        } else if (rsiTrend === 'falling') {
            score -= 0.05;
            signals.push('rsi_falling');
        }

        return {
            score: Math.max(0, Math.min(1, score)),
            signals,
            zone,
            value: rsi
        };
    }

    /**
     * Formation analizi
     */
    analyzeFormation(formation, marketCondition) {
        let score = 0.5;
        let signals = [];
        let strength = 'weak';

        const bullishFormations = ['triangle', 'flag', 'pennant', 'ascending_triangle', 'cup_handle'];
        const bearishFormations = ['head_shoulders', 'descending_triangle', 'bear_flag'];
        const neutralFormations = ['rectangle', 'wedge'];

        if (bullishFormations.includes(formation)) {
            if (marketCondition.trend.includes('bullish')) {
                score += 0.2;
                strength = 'strong';
                signals.push(`${formation}_bullish_confirmation`);
            } else {
                score += 0.1;
                strength = 'moderate';
                signals.push(`${formation}_mixed_signal`);
            }
        } else if (bearishFormations.includes(formation)) {
            if (marketCondition.trend.includes('bearish')) {
                score -= 0.2;
                strength = 'strong';
                signals.push(`${formation}_bearish_confirmation`);
            } else {
                score -= 0.1;
                strength = 'moderate';
                signals.push(`${formation}_mixed_signal`);
            }
        } else if (neutralFormations.includes(formation)) {
            signals.push(`${formation}_neutral_formation`);
        } else {
            signals.push('no_clear_formation');
        }

        return {
            score: Math.max(0, Math.min(1, score)),
            signals,
            formation,
            strength
        };
    }

    /**
     * Support/Resistance analizi
     */
    analyzeSupportResistance(sr, currentPrice) {
        let score = 0.5;
        let signals = [];
        let status = 'neutral';

        if (!sr.support && !sr.resistance) {
            return { score, signals, status: 'no_levels' };
        }

        // Support analizi
        if (sr.support && currentPrice) {
            const supportDistance = (currentPrice - sr.support) / currentPrice;
            
            if (supportDistance > 0 && supportDistance < 0.02) { // %2 üstünde
                score += 0.1;
                signals.push('near_support_bullish');
                status = 'support_holding';
            } else if (supportDistance < 0) { // Support altında
                score -= 0.2;
                signals.push('below_support_bearish');
                status = 'support_broken';
            }
        }

        // Resistance analizi
        if (sr.resistance && currentPrice) {
            const resistanceDistance = (sr.resistance - currentPrice) / currentPrice;
            
            if (resistanceDistance > 0 && resistanceDistance < 0.02) { // %2 altında
                score -= 0.1;
                signals.push('near_resistance_caution');
                status = 'approaching_resistance';
            } else if (resistanceDistance < 0) { // Resistance üstünde
                score += 0.2;
                signals.push('above_resistance_bullish');
                status = 'resistance_broken';
            }
        }

        return {
            score: Math.max(0, Math.min(1, score)),
            signals,
            status
        };
    }

    /**
     * Price Action analizi
     */
    analyzePriceAction(priceAction, trendAngle) {
        let score = 0.5;
        let signals = [];

        // Trend angle analysis
        if (trendAngle > 30) {
            score += 0.1;
            signals.push('steep_bullish_angle');
        } else if (trendAngle < -30) {
            score -= 0.1;
            signals.push('steep_bearish_angle');
        } else if (Math.abs(trendAngle) < 10) {
            score -= 0.05;
            signals.push('flat_trend_angle');
        }

        // Price action patterns
        if (priceAction.pattern) {
            const bullishPatterns = ['higher_highs', 'bull_flag', 'ascending'];
            const bearishPatterns = ['lower_lows', 'bear_flag', 'descending'];
            
            if (bullishPatterns.includes(priceAction.pattern)) {
                score += 0.15;
                signals.push(`bullish_${priceAction.pattern}`);
            } else if (bearishPatterns.includes(priceAction.pattern)) {
                score -= 0.15;
                signals.push(`bearish_${priceAction.pattern}`);
            }
        }

        return {
            score: Math.max(0, Math.min(1, score)),
            signals,
            trendAngle
        };
    }

    /**
     * News Impact analizi
     */
    analyzeNewsImpact(newsImpact, marketCondition) {
        let score = 0.5;
        let signals = [];
        
        const impact = Math.abs(newsImpact);
        
        if (impact > 0.5) {
            if (newsImpact > 0 && marketCondition.trend.includes('bullish')) {
                score += 0.1;
                signals.push('positive_news_bullish_trend');
            } else if (newsImpact < 0 && marketCondition.trend.includes('bearish')) {
                score += 0.1;
                signals.push('negative_news_bearish_trend');
            } else {
                score -= 0.05;
                signals.push('news_trend_conflict');
            }
        }

        return {
            score: Math.max(0, Math.min(1, score)),
            signals,
            impact: newsImpact
        };
    }

    /**
     * Trend confidence score hesaplama
     */
    calculateTrendConfidenceScore(analyses) {
        const weights = this.config.indicatorWeights;
        
        let totalScore = 0;
        totalScore += analyses.emaAnalysis.score * weights.ema;
        totalScore += analyses.macdAnalysis.score * weights.macd;
        totalScore += analyses.rsiAnalysis.score * weights.rsi;
        totalScore += analyses.formationAnalysis.score * weights.formation;
        totalScore += analyses.srAnalysis.score * weights.supportResistance;
        totalScore += analyses.priceActionAnalysis.score * weights.priceAction;
        totalScore += analyses.newsAnalysis.score * weights.news;
        
        return Math.max(0, Math.min(1, totalScore));
    }

    /**
     * Pozisyon uzatma değerlendirmesi
     */
    evaluatePositionExtension(confidenceScore, marketCondition, emaAnalysis, macdAnalysis) {
        let shouldExtend = false;
        let reasons = [];

        // High confidence + bullish conditions
        if (confidenceScore > 0.75 && 
            marketCondition.trend.includes('bullish') &&
            emaAnalysis.alignment === 'bullish' &&
            macdAnalysis.status === 'bullish') {
            shouldExtend = true;
            reasons.push('high_confidence_bullish_alignment');
        }

        // Strong momentum
        if (emaAnalysis.signals.includes('increasing_momentum') &&
            macdAnalysis.signals.includes('positive_histogram')) {
            shouldExtend = true;
            reasons.push('strong_momentum_continuation');
        }

        return {
            shouldExtend,
            reasons,
            confidence: confidenceScore
        };
    }

    /**
     * Güç kategorisi
     */
    categorizeStrength(score, marketCondition) {
        if (score > 0.8) {
            return 'very_strong';
        } else if (score > 0.65) {
            return 'strong';
        } else if (score > 0.5) {
            return 'moderate';
        } else if (score > 0.35) {
            return 'weak';
        } else {
            return 'very_weak';
        }
    }

    /**
     * Uyarı oluşturma
     */
    generateAlerts(confidenceScore, emaAnalysis, macdAnalysis, rsiAnalysis, marketCondition) {
        const alerts = [];

        // Critical alerts
        if (confidenceScore < 0.3) {
            alerts.push({
                type: 'critical',
                message: 'Very low trend confidence - consider exit',
                severity: 'high'
            });
        }

        // Warning alerts
        if (rsiAnalysis.zone === 'overbought' && marketCondition.trend.includes('bullish')) {
            alerts.push({
                type: 'warning',
                message: 'Overbought in bullish trend - monitor for reversal',
                severity: 'medium'
            });
        }

        if (emaAnalysis.alignment === 'mixed') {
            alerts.push({
                type: 'info',
                message: 'Mixed EMA signals - trend direction unclear',
                severity: 'low'
            });
        }

        return alerts;
    }

    /**
     * Helper functions
     */
    calculateEMASlope(current, previous) {
        if (!current || !previous) return 0;
        return (current - previous) / previous;
    }

    calculateRSITrend(currentRSI) {
        // Simplified - in real implementation, compare with previous RSI values
        return 'neutral';
    }

    updateConfidenceHistory(symbol, score) {
        if (!this.confidenceHistory.has(symbol)) {
            this.confidenceHistory.set(symbol, []);
        }
        
        const history = this.confidenceHistory.get(symbol);
        history.push({
            score,
            timestamp: Date.now()
        });
        
        // Keep last 50 records
        if (history.length > 50) {
            history.shift();
        }
    }

    /**
     * Risk seviyesi değerlendirme
     */
    assessRiskLevel(confidenceScore, marketCondition) {
        if (confidenceScore < 0.4 || marketCondition.volatility === 'high') {
            return 'high';
        } else if (confidenceScore > 0.7 && marketCondition.trend.includes('strong')) {
            return 'low';
        } else {
            return 'medium';
        }
    }

    /**
     * Öneriler oluştur
     */
    generateRecommendations(confidenceScore, shouldExtendPosition, strengthCategory, alerts) {
        const recommendations = [];
        
        recommendations.push(`Trend confidence: ${(confidenceScore * 100).toFixed(1)}% (${strengthCategory})`);
        
        if (shouldExtendPosition.shouldExtend) {
            recommendations.push('Consider extending position based on strong trend indicators');
            shouldExtendPosition.reasons.forEach(reason => {
                recommendations.push(`Reason: ${reason.replace('_', ' ')}`);
            });
        } else {
            recommendations.push('Hold current position, monitor for changes');
        }
        
        alerts.forEach(alert => {
            recommendations.push(`${alert.type.toUpperCase()}: ${alert.message}`);
        });
        
        return recommendations;
    }

    /**
     * Confirmation chain oluştur
     */
    buildConfirmationChain(emaAnalysis, macdAnalysis, rsiAnalysis, formationAnalysis) {
        const chain = [];
        
        if (emaAnalysis.alignment === 'bullish') chain.push('ema_bullish');
        if (macdAnalysis.status === 'bullish') chain.push('macd_bullish');
        if (rsiAnalysis.zone === 'bullish') chain.push('rsi_bullish');
        if (formationAnalysis.strength === 'strong') chain.push('formation_strong');
        
        return chain;
    }

    /**
     * Main interface function
     */
    async getTrendConfidence(marketData) {
        const result = await this.analyze(marketData);
        return result.metadata || {};
    }
}

module.exports = TrendConfidenceEvaluator;
