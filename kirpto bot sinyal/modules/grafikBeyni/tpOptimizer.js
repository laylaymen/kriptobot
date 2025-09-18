/**
 * 📦 tpOptimizer.js
 * 🎯 Kademeli kâr alma stratejisi oluşturur
 */

const GrafikBeyniModuleBase = require('../grafikBeyniModuleBase');

class TPOptimizer extends GrafikBeyniModuleBase {
    constructor(config = {}) {
        super('tpOptimizer', {
            ...config,
            scoreThreshold: 0.6,
            defaultTPCount: 3,
            maxTPLevels: 5,
            minProfitTarget: 0.005, // %0.5 minimum profit
            aggressivenessFactors: {
                conservative: 0.7,
                moderate: 1.0,
                aggressive: 1.4
            }
        });
    }

    async performAnalysis(marketData) {
        try {
            const {
                expectedProfit = 0.02,
                trendStrength = 0.7,
                formation = 'unknown',
                ATR,
                historicalExitPatterns = [],
                newsImpact = 0,
                resistanceDistance = 0.01,
                currentPrice,
                position
            } = marketData;

            // Market condition analizi
            const marketCondition = this.analyzeMarketCondition(marketData);
            
            // TP stratejisi belirleme
            const tpStrategy = this.determineTPStrategy(
                trendStrength, 
                formation, 
                marketCondition,
                newsImpact
            );
            
            // TP seviyelerini hesapla
            const tpLevels = this.calculateTPLevels(
                currentPrice,
                expectedProfit,
                ATR,
                resistanceDistance,
                tpStrategy,
                marketCondition
            );
            
            // Aggressiveness seviyesi
            const aggressiveness = this.calculateAggressiveness(
                trendStrength,
                marketCondition,
                newsImpact
            );
            
            // Dinamik ayarlamalar
            const adjustments = this.getDynamicAdjustments(
                marketCondition,
                historicalExitPatterns,
                trendStrength
            );
            
            // Sinyal oluştur
            const signal = this.createSignal('tp-optimization', tpStrategy.confidence, {
                variant: tpStrategy.type,
                riskLevel: this.assessRiskLevel(aggressiveness, marketCondition),
                analysis: {
                    tpLevels,
                    tpStrategy: tpStrategy.type,
                    aggressiveness,
                    adjustments,
                    marketCondition
                },
                recommendations: this.generateRecommendations(tpLevels, tpStrategy),
                confirmationChain: this.buildConfirmationChain(
                    trendStrength,
                    formation,
                    marketCondition
                )
            });

            return {
                signals: [signal],
                metadata: {
                    moduleName: this.name,
                    tpLevels,
                    tpStrategy: tpStrategy.type,
                    aggressiveness,
                    adjustments,
                    notify: {
                        vivo: {
                            tpStrategy: tpStrategy.type,
                            levels: tpLevels,
                            aggressiveness
                        },
                        grafikBeyni: {
                            tpOptimized: true,
                            confidence: tpStrategy.confidence
                        }
                    }
                }
            };

        } catch (error) {
            console.error('❌ TPOptimizer analysis error:', error);
            return { signals: [], error: error.message };
        }
    }

    /**
     * TP stratejisi belirleme
     */
    determineTPStrategy(trendStrength, formation, marketCondition, newsImpact) {
        let strategy = { type: 'moderate', confidence: 0.6, tpCount: 3 };
        
        // Trend gücüne göre strateji
        if (trendStrength > 0.8 && marketCondition.trend === 'strong_bullish') {
            strategy.type = 'aggressive';
            strategy.confidence = 0.85;
            strategy.tpCount = 2; // Aggressive: 2 TP
        } else if (trendStrength < 0.5 || marketCondition.volatility === 'high') {
            strategy.type = 'conservative';
            strategy.confidence = 0.65;
            strategy.tpCount = 4; // Conservative: 4 TP
        }
        
        // Formasyon etkisi
        if (formation === 'breakout' || formation === 'triangle') {
            strategy.confidence += 0.1;
        }
        
        // Haber etkisi
        if (Math.abs(newsImpact) > 0.5) {
            strategy.type = 'conservative';
            strategy.tpCount = Math.max(3, strategy.tpCount);
        }
        
        return strategy;
    }

    /**
     * TP seviyelerini hesapla
     */
    calculateTPLevels(currentPrice, expectedProfit, ATR, resistanceDistance, strategy, marketCondition) {
        const levels = [];
        const baseProfit = expectedProfit;
        const tpCount = strategy.tpCount;
        
        // ATR bazlı mesafe hesaplama
        const atrMultiplier = marketCondition.volatility === 'high' ? 2.5 : 
                            marketCondition.volatility === 'low' ? 1.2 : 1.8;
        const baseDistance = ATR ? (ATR * atrMultiplier) : (currentPrice * 0.01);
        
        for (let i = 1; i <= tpCount; i++) {
            // Fibonacci benzeri TP mesafeleri
            const fibMultiplier = this.getFibonacciMultiplier(i, tpCount);
            const distance = baseDistance * fibMultiplier;
            
            // Resistance'a yakınsa ayarlama yap
            let adjustedDistance = distance;
            if (resistanceDistance > 0 && distance > resistanceDistance * 0.8) {
                adjustedDistance = resistanceDistance * 0.95; // Resistance'tan önce
            }
            
            const level = {
                tp: i,
                price: currentPrice + adjustedDistance,
                percentage: (adjustedDistance / currentPrice) * 100,
                confidence: Math.max(0.5, 1 - (i * 0.15)), // Her TP'de confidence azalır
                allocation: this.getTPAllocation(i, tpCount, strategy.type)
            };
            
            levels.push(level);
        }
        
        return levels;
    }

    /**
     * Fibonacci multiplier
     */
    getFibonacciMultiplier(level, totalLevels) {
        const fibSequence = [1, 1.618, 2.618, 4.236, 6.854];
        const index = Math.min(level - 1, fibSequence.length - 1);
        return fibSequence[index];
    }

    /**
     * TP allocation hesaplama
     */
    getTPAllocation(level, totalLevels, strategyType) {
        const allocations = {
            conservative: [0.4, 0.3, 0.2, 0.1], // İlk TP'ye ağırlık
            moderate: [0.35, 0.35, 0.3],
            aggressive: [0.6, 0.4] // Hızlı çıkış
        };
        
        const allocation = allocations[strategyType] || allocations.moderate;
        return allocation[level - 1] || (1 / totalLevels);
    }

    /**
     * Aggressiveness hesaplama
     */
    calculateAggressiveness(trendStrength, marketCondition, newsImpact) {
        let aggressiveness = 0.5;
        
        // Trend etkisi
        aggressiveness += (trendStrength - 0.5) * 0.4;
        
        // Market condition etkisi
        if (marketCondition.trend.includes('strong')) {
            aggressiveness += 0.2;
        }
        if (marketCondition.volatility === 'high') {
            aggressiveness -= 0.3; // Yüksek volatilitede daha temkinli
        }
        
        // News impact etkisi
        aggressiveness += Math.abs(newsImpact) * 0.2;
        
        return Math.max(0.1, Math.min(1.0, aggressiveness));
    }

    /**
     * Dinamik ayarlamalar
     */
    getDynamicAdjustments(marketCondition, historicalExitPatterns, trendStrength) {
        const adjustments = [];
        
        // Market condition ayarlamaları
        if (marketCondition.volatility === 'high') {
            adjustments.push({
                type: 'volatility_adjustment',
                action: 'increase_tp_distances',
                factor: 1.3
            });
        }
        
        if (marketCondition.momentum === 'overbought') {
            adjustments.push({
                type: 'momentum_adjustment',
                action: 'faster_exits',
                factor: 0.8
            });
        }
        
        // Historical pattern ayarlamaları
        if (historicalExitPatterns.length > 0) {
            const avgSuccess = historicalExitPatterns.reduce((sum, p) => sum + p.successRate, 0) / historicalExitPatterns.length;
            if (avgSuccess < 0.6) {
                adjustments.push({
                    type: 'historical_adjustment',
                    action: 'conservative_approach',
                    factor: 0.9
                });
            }
        }
        
        return adjustments;
    }

    /**
     * Risk seviyesi değerlendirme
     */
    assessRiskLevel(aggressiveness, marketCondition) {
        if (aggressiveness > 0.8 || marketCondition.volatility === 'high') {
            return 'high';
        } else if (aggressiveness < 0.4 || marketCondition.trend === 'sideways') {
            return 'low';
        } else {
            return 'medium';
        }
    }

    /**
     * Öneriler oluştur
     */
    generateRecommendations(tpLevels, strategy) {
        const recommendations = [];
        
        recommendations.push(`Use ${strategy.type} TP strategy with ${tpLevels.length} levels`);
        
        if (strategy.type === 'aggressive') {
            recommendations.push('Consider fast exits due to strong trend');
        } else if (strategy.type === 'conservative') {
            recommendations.push('Scale out gradually due to market uncertainty');
        }
        
        const firstTP = tpLevels[0];
        if (firstTP) {
            recommendations.push(`First TP at ${firstTP.price.toFixed(2)} (${firstTP.percentage.toFixed(2)}%)`);
        }
        
        return recommendations;
    }

    /**
     * Confirmation chain oluştur
     */
    buildConfirmationChain(trendStrength, formation, marketCondition) {
        const chain = [];
        
        if (trendStrength > 0.7) chain.push('strong_trend');
        if (formation !== 'unknown') chain.push(`formation_${formation}`);
        if (marketCondition.momentum !== 'neutral') chain.push(`momentum_${marketCondition.momentum}`);
        
        return chain;
    }

    /**
     * Main interface function
     */
    async getTPStrategy(marketData) {
        const result = await this.analyze(marketData);
        return result.metadata || {};
    }
}

module.exports = TPOptimizer;
