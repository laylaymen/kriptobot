/**
 * 📦 exitTimingAdvisor.js
 * 🎯 TP sonrası çıkış zamanlaması önerisi
 */

const GrafikBeyniModuleBase = require('../grafikBeyniModuleBase');

class ExitTimingAdvisor extends GrafikBeyniModuleBase {
    constructor(config = {}) {
        super('exitTimingAdvisor', {
            ...config,
            scoreThreshold: 0.65,
            delayThresholdMinutes: 15,
            trendBreakThreshold: 0.3,
            momentumWeakThreshold: 0.4,
            newsImpactThreshold: 0.6
        });

        // Exit timing state
        this.exitDecisions = new Map();
        this.delayTracker = new Map();
    }

    async performAnalysis(marketData) {
        try {
            const {
                symbol,
                currentPrice,
                tp1Price,
                tp1Hit = false,
                priceMovementAfterTP1 = 0,
                momentum,
                trendStrength,
                supportResistance = {},
                newsImpact = 0,
                psychologicalFatigue = 0,
                position,
                timeInPosition = 0
            } = marketData;

            // Market condition analizi
            const marketCondition = this.analyzeMarketCondition(marketData);
            
            // Delay detection
            const delayAnalysis = this.detectDelay(symbol, tp1Hit, timeInPosition, marketCondition);
            
            // Trend degradation check
            const trendAnalysis = this.analyzeTrendDegradation(trendStrength, momentum, marketCondition);
            
            // Resistance collision check
            const resistanceAnalysis = this.analyzeResistanceCollision(
                currentPrice, 
                supportResistance,
                priceMovementAfterTP1
            );
            
            // News impact assessment
            const newsAnalysis = this.assessNewsImpact(newsImpact, marketCondition);
            
            // Psychological fatigue check
            const fatigueAnalysis = this.assessPsychologicalFatigue(
                psychologicalFatigue,
                timeInPosition,
                marketCondition
            );
            
            // Exit recommendation
            const exitRecommendation = this.generateExitRecommendation(
                delayAnalysis,
                trendAnalysis,
                resistanceAnalysis,
                newsAnalysis,
                fatigueAnalysis,
                marketCondition
            );
            
            // Sinyal oluştur
            const signal = this.createSignal('exit-timing', exitRecommendation.confidence, {
                variant: exitRecommendation.recommendedExitType,
                riskLevel: this.assessRiskLevel(exitRecommendation, marketCondition),
                analysis: {
                    exitRecommendation,
                    delayAnalysis,
                    trendAnalysis,
                    resistanceAnalysis,
                    newsAnalysis,
                    fatigueAnalysis,
                    marketCondition
                },
                recommendations: this.generateRecommendations(exitRecommendation),
                confirmationChain: this.buildConfirmationChain(
                    delayAnalysis,
                    trendAnalysis,
                    resistanceAnalysis
                )
            });

            return {
                signals: [signal],
                metadata: {
                    moduleName: this.name,
                    recommendedExitType: exitRecommendation.recommendedExitType,
                    urgency: exitRecommendation.urgency,
                    confidence: exitRecommendation.confidence,
                    notify: {
                        vivo: {
                            exitAdvice: exitRecommendation.recommendedExitType,
                            urgency: exitRecommendation.urgency
                        },
                        grafikBeyni: {
                            exitTimingAnalyzed: true,
                            recommendation: exitRecommendation.recommendedExitType
                        }
                    }
                }
            };

        } catch (error) {
            console.error('❌ ExitTimingAdvisor analysis error:', error);
            return { signals: [], error: error.message };
        }
    }

    /**
     * Gecikme tespiti
     */
    detectDelay(symbol, tp1Hit, timeInPosition, marketCondition) {
        const delayMinutes = timeInPosition / 60000; // ms to minutes
        
        let delayDetected = false;
        let delayScore = 0;
        let delayReasons = [];

        // TP1 hit olmamışsa ve zaman geçmişse
        if (!tp1Hit && delayMinutes > this.config.delayThresholdMinutes) {
            delayDetected = true;
            delayScore = Math.min(1.0, delayMinutes / 60); // 1 saatte max skor
            delayReasons.push('tp1_not_hit_timeout');
        }

        // Market condition'a göre beklenen hareket süresi
        const expectedMoveTime = this.getExpectedMoveTime(marketCondition);
        if (delayMinutes > expectedMoveTime) {
            delayDetected = true;
            delayScore = Math.max(delayScore, 0.7);
            delayReasons.push('market_condition_timeout');
        }

        // Volatilite düşükse ve hareket yoksa
        if (marketCondition.volatility === 'low' && delayMinutes > 30) {
            delayDetected = true;
            delayScore = Math.max(delayScore, 0.6);
            delayReasons.push('low_volatility_stagnation');
        }

        return {
            delayDetected,
            delayScore,
            delayReasons,
            timeInPosition: delayMinutes
        };
    }

    /**
     * Trend bozulma analizi
     */
    analyzeTrendDegradation(trendStrength, momentum, marketCondition) {
        let trendBroken = false;
        let degradationScore = 0;
        let degradationReasons = [];

        // Trend gücü zayıflaması
        if (trendStrength < this.config.trendBreakThreshold) {
            trendBroken = true;
            degradationScore = 1 - trendStrength;
            degradationReasons.push('trend_strength_weak');
        }

        // Momentum zayıflaması
        if (momentum && momentum < this.config.momentumWeakThreshold) {
            degradationScore = Math.max(degradationScore, 0.7);
            degradationReasons.push('momentum_weak');
        }

        // Market condition değişimi
        if (marketCondition.trend === 'bearish' || marketCondition.trend === 'sideways') {
            trendBroken = true;
            degradationScore = Math.max(degradationScore, 0.8);
            degradationReasons.push('market_condition_changed');
        }

        // Momentum overbought/oversold
        if (marketCondition.momentum === 'overbought' || marketCondition.momentum === 'oversold') {
            degradationScore = Math.max(degradationScore, 0.6);
            degradationReasons.push(`momentum_${marketCondition.momentum}`);
        }

        return {
            trendBroken,
            degradationScore,
            degradationReasons,
            currentTrendStrength: trendStrength
        };
    }

    /**
     * Resistance collision analizi
     */
    analyzeResistanceCollision(currentPrice, supportResistance, priceMovementAfterTP1) {
        let resistanceHit = false;
        let collisionScore = 0;
        let resistanceLevel = null;

        if (supportResistance.resistance) {
            const distanceToResistance = Math.abs(currentPrice - supportResistance.resistance) / currentPrice;
            
            // Resistance'a çok yakın
            if (distanceToResistance < 0.005) { // %0.5'ten yakın
                resistanceHit = true;
                collisionScore = 0.9;
                resistanceLevel = supportResistance.resistance;
            }
            // Resistance vicinity
            else if (distanceToResistance < 0.01) { // %1'den yakın
                collisionScore = 0.6;
                resistanceLevel = supportResistance.resistance;
            }
        }

        // TP1 sonrası hareket analizi
        let movementStalled = false;
        if (priceMovementAfterTP1 !== null && Math.abs(priceMovementAfterTP1) < 0.002) { // %0.2'den az hareket
            movementStalled = true;
            collisionScore = Math.max(collisionScore, 0.5);
        }

        return {
            resistanceHit,
            movementStalled,
            collisionScore,
            resistanceLevel,
            distanceToResistance: supportResistance.resistance ? 
                Math.abs(currentPrice - supportResistance.resistance) / currentPrice : null
        };
    }

    /**
     * Haber etkisi değerlendirmesi
     */
    assessNewsImpact(newsImpact, marketCondition) {
        let significantNews = false;
        let newsScore = Math.abs(newsImpact);
        let newsDirection = newsImpact > 0 ? 'positive' : newsImpact < 0 ? 'negative' : 'neutral';
        
        if (newsScore > this.config.newsImpactThreshold) {
            significantNews = true;
        }

        // Market condition ile news uyumsuzluğu
        let newsConflict = false;
        if (newsDirection === 'negative' && marketCondition.trend.includes('bullish')) {
            newsConflict = true;
            newsScore += 0.2;
        }

        return {
            significantNews,
            newsConflict,
            newsScore,
            newsDirection
        };
    }

    /**
     * Psikolojik yorgunluk değerlendirmesi
     */
    assessPsychologicalFatigue(fatigue, timeInPosition, marketCondition) {
        const hoursInPosition = timeInPosition / 3600000; // ms to hours
        
        let fatigueDetected = fatigue > 0.6;
        let fatigueScore = fatigue;
        
        // Uzun pozisyon süresi yorgunluğu
        if (hoursInPosition > 4) {
            fatigueDetected = true;
            fatigueScore = Math.max(fatigueScore, 0.5 + (hoursInPosition - 4) * 0.1);
        }

        // Volatilite yorgunluğu
        if (marketCondition.volatility === 'high' && hoursInPosition > 2) {
            fatigueScore = Math.max(fatigueScore, 0.7);
        }

        return {
            fatigueDetected,
            fatigueScore,
            hoursInPosition
        };
    }

    /**
     * Exit recommendation oluştur
     */
    generateExitRecommendation(delayAnalysis, trendAnalysis, resistanceAnalysis, newsAnalysis, fatigueAnalysis, marketCondition) {
        let exitType = 'hold-longer';
        let confidence = 0.5;
        let urgency = 'low';
        let reasons = [];

        // Critical exit conditions
        if (trendAnalysis.trendBroken && trendAnalysis.degradationScore > 0.8) {
            exitType = 'full-exit';
            confidence = 0.9;
            urgency = 'high';
            reasons.push('trend_completely_broken');
        }
        else if (newsAnalysis.significantNews && newsAnalysis.newsConflict) {
            exitType = 'partial-exit';
            confidence = 0.8;
            urgency = 'high';
            reasons.push('conflicting_news_impact');
        }
        else if (resistanceAnalysis.resistanceHit) {
            exitType = 'partial-exit';
            confidence = 0.85;
            urgency = 'medium';
            reasons.push('resistance_collision');
        }
        // Medium priority conditions
        else if (delayAnalysis.delayDetected && delayAnalysis.delayScore > 0.7) {
            exitType = 'partial-exit';
            confidence = 0.7;
            urgency = 'medium';
            reasons.push('significant_delay');
        }
        else if (fatigueAnalysis.fatigueDetected && fatigueAnalysis.fatigueScore > 0.8) {
            exitType = 'partial-exit';
            confidence = 0.6;
            urgency = 'low';
            reasons.push('psychological_fatigue');
        }
        // Low priority conditions
        else if (trendAnalysis.degradationScore > 0.5 || delayAnalysis.delayScore > 0.5) {
            exitType = 'hold-longer';
            confidence = 0.6;
            urgency = 'low';
            reasons.push('monitor_closely');
        }

        return {
            recommendedExitType: exitType,
            confidence,
            urgency,
            reasons
        };
    }

    /**
     * Beklenen hareket süresi
     */
    getExpectedMoveTime(marketCondition) {
        const baseTimes = {
            'high': 20,     // High volatility: fast moves
            'normal': 45,   // Normal volatility: medium time
            'low': 90       // Low volatility: slower moves
        };

        const volatilityTime = baseTimes[marketCondition.volatility] || 45;
        
        // Trend strength modifier
        const trendModifier = marketCondition.strength > 0.8 ? 0.7 : 
                            marketCondition.strength < 0.4 ? 1.5 : 1.0;

        return volatilityTime * trendModifier;
    }

    /**
     * Risk seviyesi değerlendirme
     */
    assessRiskLevel(exitRecommendation, marketCondition) {
        if (exitRecommendation.urgency === 'high' || exitRecommendation.recommendedExitType === 'full-exit') {
            return 'high';
        } else if (exitRecommendation.urgency === 'medium') {
            return 'medium';
        } else {
            return 'low';
        }
    }

    /**
     * Öneriler oluştur
     */
    generateRecommendations(exitRecommendation) {
        const recommendations = [];
        
        recommendations.push(`Recommended action: ${exitRecommendation.recommendedExitType}`);
        recommendations.push(`Urgency level: ${exitRecommendation.urgency}`);
        
        exitRecommendation.reasons.forEach(reason => {
            recommendations.push(`Reason: ${reason.replace('_', ' ')}`);
        });

        if (exitRecommendation.recommendedExitType === 'partial-exit') {
            recommendations.push('Consider exiting 50% of position');
        } else if (exitRecommendation.recommendedExitType === 'full-exit') {
            recommendations.push('Exit entire position immediately');
        }
        
        return recommendations;
    }

    /**
     * Confirmation chain oluştur
     */
    buildConfirmationChain(delayAnalysis, trendAnalysis, resistanceAnalysis) {
        const chain = [];
        
        if (delayAnalysis.delayDetected) chain.push('delay_detected');
        if (trendAnalysis.trendBroken) chain.push('trend_broken');
        if (resistanceAnalysis.resistanceHit) chain.push('resistance_hit');
        
        return chain;
    }

    /**
     * Main interface function
     */
    async getExitAdvice(marketData) {
        const result = await this.analyze(marketData);
        return result.metadata || {};
    }
}

module.exports = ExitTimingAdvisor;
