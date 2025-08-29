/**
 * 📦 priceActionAnalyzer.js
 * 🎯 Fiyat hareketlerini analiz eden kapsamlı modül
 */

const GrafikBeyniModuleBase = require('../grafikBeyniModuleBase');

class PriceActionAnalyzer extends GrafikBeyniModuleBase {
    constructor(config = {}) {
        super('priceActionAnalyzer', {
            ...config,
            scoreThreshold: 0.65,
            candlePatterns: {
                'hammer': { minBodyPercent: 0.3, minWickRatio: 2.0, reversal: 'bullish' },
                'doji': { maxBodyPercent: 0.1, indecision: true },
                'engulfing': { minEngulfPercent: 1.05, reversal: true },
                'shooting_star': { minBodyPercent: 0.3, minWickRatio: 2.0, reversal: 'bearish' },
                'inside_bar': { containment: true, consolidation: true },
                'outside_bar': { expansion: true, volatility: 'high' },
                'pin_bar': { minRejectionRatio: 0.6, keyLevel: true }
            },
            swingAnalysis: {
                minSwingSize: 0.005, // Minimum 0.5% move
                lookbackPeriods: 20,
                confirmationPeriods: 3
            },
            priceStructure: {
                higherHighs: 'bullish',
                lowerLows: 'bearish',
                higherLows: 'consolidation',
                lowerHighs: 'distribution'
            },
            momentum: {
                accelerating: 1.2,
                decelerating: 0.8,
                stable: [0.8, 1.2]
            }
        });

        // Price action tracking
        this.swingHistory = new Map();
        this.candlePatternCache = new Map();
        this.priceStructureCache = new Map();
        this.momentumHistory = new Map();
    }

    async performAnalysis(marketData) {
        try {
            const {
                symbol = 'UNKNOWN',
                timeframe = '15m',
                ohlcData = [],
                priceHistory = [],
                volumeHistory = [],
                currentPrice,
                supportResistanceLevels = [],
                trendDirection = 'neutral',
                volatility = 0.02,
                timestamp = Date.now()
            } = marketData;

            if (ohlcData.length < 10) {
                return { signals: [], metadata: { error: 'Insufficient OHLC data for price action analysis' } };
            }

            // Candlestick pattern analizi
            const candlePatternAnalysis = this.analyzeCandlestickPatterns(
                ohlcData,
                supportResistanceLevels,
                volumeHistory
            );
            
            // Swing analizi
            const swingAnalysis = this.analyzeSwingStructure(
                priceHistory,
                ohlcData,
                volumeHistory
            );
            
            // Price structure analizi
            const priceStructureAnalysis = this.analyzePriceStructure(
                swingAnalysis.swingPoints,
                trendDirection
            );
            
            // Momentum analizi
            const momentumAnalysis = this.analyzePriceMomentum(
                priceHistory,
                volumeHistory,
                ohlcData
            );
            
            // Key level etkileşim analizi
            const keyLevelInteraction = this.analyzeKeyLevelInteraction(
                ohlcData,
                supportResistanceLevels,
                candlePatternAnalysis
            );
            
            // Breakout/reversal potansiyeli
            const breakoutReversalAnalysis = this.analyzeBreakoutReversalPotential(
                candlePatternAnalysis,
                swingAnalysis,
                priceStructureAnalysis,
                keyLevelInteraction
            );
            
            // Overall price action sentiment
            const priceActionSentiment = this.calculatePriceActionSentiment({
                candlePatterns: candlePatternAnalysis,
                swings: swingAnalysis,
                structure: priceStructureAnalysis,
                momentum: momentumAnalysis,
                keyLevels: keyLevelInteraction,
                breakoutReversal: breakoutReversalAnalysis
            });
            
            // Update tracking
            this.updatePriceActionTracking(symbol, {
                swings: swingAnalysis,
                patterns: candlePatternAnalysis,
                structure: priceStructureAnalysis,
                sentiment: priceActionSentiment
            }, timestamp);
            
            // Generate signals
            const signals = this.generatePriceActionSignals(
                priceActionSentiment,
                breakoutReversalAnalysis,
                keyLevelInteraction
            );

            return {
                signals,
                metadata: {
                    moduleName: this.name,
                    priceActionSentiment: priceActionSentiment.overall,
                    candlePatternAnalysis,
                    swingAnalysis,
                    priceStructureAnalysis,
                    momentumAnalysis,
                    keyLevelInteraction,
                    breakoutReversalAnalysis,
                    notify: this.generateNotifications(priceActionSentiment, breakoutReversalAnalysis)
                }
            };

        } catch (error) {
            console.error('❌ PriceActionAnalyzer analysis error:', error);
            return { signals: [], error: error.message };
        }
    }

    /**
     * Candlestick pattern analizi
     */
    analyzeCandlestickPatterns(ohlcData, srLevels, volumeHistory) {
        const patterns = [];
        const recentCandles = ohlcData.slice(-5); // Last 5 candles
        
        // Single candle patterns
        recentCandles.forEach((candle, index) => {
            const globalIndex = ohlcData.length - 5 + index;
            const singlePatterns = this.detectSingleCandlePatterns(candle, srLevels, volumeHistory[globalIndex]);
            patterns.push(...singlePatterns.map(p => ({ ...p, index: globalIndex })));
        });
        
        // Multi-candle patterns
        if (recentCandles.length >= 2) {
            const multiPatterns = this.detectMultiCandlePatterns(recentCandles, srLevels, volumeHistory.slice(-5));
            patterns.push(...multiPatterns);
        }
        
        // Pattern significance scoring
        const significantPatterns = this.scorePatternSignificance(patterns, srLevels, ohlcData);
        
        return {
            allPatterns: patterns,
            significantPatterns,
            dominantPattern: this.selectDominantPattern(significantPatterns),
            overallSentiment: this.calculatePatternSentiment(significantPatterns)
        };
    }

    /**
     * Single candle pattern detection
     */
    detectSingleCandlePatterns(candle, srLevels, volume) {
        const { open, high, low, close } = candle;
        const bodySize = Math.abs(close - open);
        const totalSize = high - low;
        const bodyPercent = bodySize / totalSize;
        const upperWick = high - Math.max(open, close);
        const lowerWick = Math.min(open, close) - low;
        
        const patterns = [];
        
        // Hammer pattern
        if (this.isHammer(bodyPercent, lowerWick, upperWick, totalSize)) {
            const nearSupport = this.isNearKeyLevel(low, srLevels, 'support');
            patterns.push({
                type: 'hammer',
                sentiment: 'bullish',
                strength: nearSupport ? 0.8 : 0.6,
                location: nearSupport ? 'key_support' : 'general',
                candle: candle
            });
        }
        
        // Shooting Star pattern
        if (this.isShootingStar(bodyPercent, upperWick, lowerWick, totalSize)) {
            const nearResistance = this.isNearKeyLevel(high, srLevels, 'resistance');
            patterns.push({
                type: 'shooting_star',
                sentiment: 'bearish',
                strength: nearResistance ? 0.8 : 0.6,
                location: nearResistance ? 'key_resistance' : 'general',
                candle: candle
            });
        }
        
        // Doji pattern
        if (this.isDoji(bodyPercent)) {
            patterns.push({
                type: 'doji',
                sentiment: 'neutral',
                strength: 0.5,
                location: 'general',
                candle: candle,
                indecision: true
            });
        }
        
        // Pin Bar pattern
        if (this.isPinBar(bodyPercent, upperWick, lowerWick, totalSize, srLevels, close)) {
            const direction = lowerWick > upperWick ? 'bullish' : 'bearish';
            const keyLevel = this.isNearKeyLevel(direction === 'bullish' ? low : high, srLevels);
            patterns.push({
                type: 'pin_bar',
                sentiment: direction,
                strength: keyLevel ? 0.9 : 0.7,
                location: keyLevel ? 'key_level' : 'general',
                candle: candle
            });
        }
        
        return patterns;
    }

    /**
     * Multi-candle pattern detection
     */
    detectMultiCandlePatterns(candles, srLevels, volumes) {
        const patterns = [];
        
        if (candles.length < 2) return patterns;
        
        // Engulfing patterns
        for (let i = 1; i < candles.length; i++) {
            const engulfing = this.detectEngulfingPattern(candles[i-1], candles[i]);
            if (engulfing) {
                patterns.push({
                    ...engulfing,
                    index: candles.length - (candles.length - i),
                    candles: [candles[i-1], candles[i]]
                });
            }
        }
        
        // Inside/Outside bars
        for (let i = 1; i < candles.length; i++) {
            const insideOutside = this.detectInsideOutsideBar(candles[i-1], candles[i]);
            if (insideOutside) {
                patterns.push({
                    ...insideOutside,
                    index: candles.length - (candles.length - i),
                    candles: [candles[i-1], candles[i]]
                });
            }
        }
        
        return patterns;
    }

    /**
     * Swing structure analizi
     */
    analyzeSwingStructure(priceHistory, ohlcData, volumeHistory) {
        const swingPoints = this.identifySwingPoints(priceHistory, ohlcData);
        const swingStrength = this.calculateSwingStrength(swingPoints, volumeHistory);
        const swingTrend = this.analyzeSwingTrend(swingPoints);
        
        return {
            swingPoints,
            swingCount: swingPoints.length,
            averageSwingSize: this.calculateAverageSwingSize(swingPoints),
            swingStrength,
            swingTrend,
            lastSwing: swingPoints[swingPoints.length - 1] || null,
            swingMomentum: this.calculateSwingMomentum(swingPoints)
        };
    }

    /**
     * Price structure analizi
     */
    analyzePriceStructure(swingPoints, trendDirection) {
        if (swingPoints.length < 4) {
            return {
                structure: 'insufficient_data',
                higherHighs: false,
                higherLows: false,
                lowerHighs: false,
                lowerLows: false,
                trend: 'unclear'
            };
        }
        
        const highs = swingPoints.filter(s => s.type === 'high').slice(-3);
        const lows = swingPoints.filter(s => s.type === 'low').slice(-3);
        
        const analysis = {
            higherHighs: this.checkHigherHighs(highs),
            higherLows: this.checkHigherLows(lows),
            lowerHighs: this.checkLowerHighs(highs),
            lowerLows: this.checkLowerLows(lows)
        };
        
        // Determine overall structure
        if (analysis.higherHighs && analysis.higherLows) {
            analysis.structure = 'uptrend';
            analysis.trend = 'bullish';
        } else if (analysis.lowerHighs && analysis.lowerLows) {
            analysis.structure = 'downtrend';
            analysis.trend = 'bearish';
        } else if (analysis.higherLows && analysis.lowerHighs) {
            analysis.structure = 'consolidation';
            analysis.trend = 'neutral';
        } else {
            analysis.structure = 'mixed';
            analysis.trend = 'unclear';
        }
        
        // Structure strength
        analysis.structureStrength = this.calculateStructureStrength(analysis);
        
        return analysis;
    }

    /**
     * Price momentum analizi
     */
    analyzePriceMomentum(priceHistory, volumeHistory, ohlcData) {
        const recentPrices = priceHistory.slice(-10);
        const recentVolumes = volumeHistory.slice(-10);
        const recentCandles = ohlcData.slice(-5);
        
        const analysis = {
            shortTermMomentum: this.calculateShortTermMomentum(recentPrices.slice(-3)),
            mediumTermMomentum: this.calculateMediumTermMomentum(recentPrices.slice(-7)),
            volumeMomentum: this.calculateVolumeMomentum(recentVolumes),
            acceleration: this.calculatePriceAcceleration(recentPrices),
            volatilityMomentum: this.calculateVolatilityMomentum(recentCandles)
        };
        
        // Overall momentum classification
        analysis.overall = this.classifyOverallMomentum(analysis);
        analysis.strength = this.calculateMomentumStrength(analysis);
        analysis.direction = this.determineMomentumDirection(analysis);
        
        return analysis;
    }

    /**
     * Key level etkileşim analizi
     */
    analyzeKeyLevelInteraction(ohlcData, srLevels, candlePatterns) {
        const currentCandle = ohlcData[ohlcData.length - 1];
        const interactions = [];
        
        srLevels.forEach(level => {
            const interaction = this.checkLevelInteraction(currentCandle, level, candlePatterns);
            if (interaction) {
                interactions.push(interaction);
            }
        });
        
        return {
            activeInteractions: interactions,
            interactionCount: interactions.length,
            strongestInteraction: interactions.reduce((max, current) => 
                current.strength > (max?.strength || 0) ? current : max, null),
            interactionSentiment: this.calculateInteractionSentiment(interactions)
        };
    }

    /**
     * Price action sentiment hesaplama
     */
    calculatePriceActionSentiment(analyses) {
        const weights = {
            candlePatterns: 0.25,
            swings: 0.20,
            structure: 0.25,
            momentum: 0.20,
            keyLevels: 0.10
        };
        
        let bullishScore = 0;
        let bearishScore = 0;
        
        // Candle pattern sentiment
        if (analyses.candlePatterns.overallSentiment === 'bullish') {
            bullishScore += weights.candlePatterns;
        } else if (analyses.candlePatterns.overallSentiment === 'bearish') {
            bearishScore += weights.candlePatterns;
        }
        
        // Structure sentiment
        if (analyses.structure.trend === 'bullish') {
            bullishScore += weights.structure * analyses.structure.structureStrength;
        } else if (analyses.structure.trend === 'bearish') {
            bearishScore += weights.structure * analyses.structure.structureStrength;
        }
        
        // Momentum sentiment
        if (analyses.momentum.direction === 'bullish') {
            bullishScore += weights.momentum * analyses.momentum.strength;
        } else if (analyses.momentum.direction === 'bearish') {
            bearishScore += weights.momentum * analyses.momentum.strength;
        }
        
        // Key level sentiment
        if (analyses.keyLevels.interactionSentiment === 'bullish') {
            bullishScore += weights.keyLevels;
        } else if (analyses.keyLevels.interactionSentiment === 'bearish') {
            bearishScore += weights.keyLevels;
        }
        
        // Overall sentiment
        const totalScore = bullishScore + bearishScore;
        let overall;
        
        if (totalScore < 0.3) {
            overall = 'neutral';
        } else if (bullishScore > bearishScore) {
            overall = 'bullish';
        } else {
            overall = 'bearish';
        }
        
        return {
            overall,
            bullishScore,
            bearishScore,
            confidence: Math.abs(bullishScore - bearishScore),
            strength: totalScore
        };
    }

    /**
     * Helper Methods (simplified implementations)
     */
    isHammer(bodyPercent, lowerWick, upperWick, totalSize) {
        return bodyPercent <= 0.3 && lowerWick >= totalSize * 0.6 && upperWick <= totalSize * 0.1;
    }

    isShootingStar(bodyPercent, upperWick, lowerWick, totalSize) {
        return bodyPercent <= 0.3 && upperWick >= totalSize * 0.6 && lowerWick <= totalSize * 0.1;
    }

    isDoji(bodyPercent) {
        return bodyPercent <= 0.1;
    }

    isPinBar(bodyPercent, upperWick, lowerWick, totalSize, srLevels, close) {
        const rejection = Math.max(upperWick, lowerWick);
        return bodyPercent <= 0.3 && rejection >= totalSize * 0.6;
    }

    isNearKeyLevel(price, srLevels, type = null) {
        return srLevels.some(level => {
            const distance = Math.abs(price - level.price) / price;
            const typeMatch = !type || level.type.includes(type);
            return distance <= 0.002 && typeMatch; // Within 0.2%
        });
    }

    detectEngulfingPattern(candle1, candle2) {
        const body1 = Math.abs(candle1.close - candle1.open);
        const body2 = Math.abs(candle2.close - candle2.open);
        
        if (body2 <= body1 * 1.05) return null; // Must engulf by at least 5%
        
        const bullishEngulfing = candle1.close < candle1.open && candle2.close > candle2.open &&
                                candle2.open <= candle1.close && candle2.close >= candle1.open;
        
        const bearishEngulfing = candle1.close > candle1.open && candle2.close < candle2.open &&
                                candle2.open >= candle1.close && candle2.close <= candle1.open;
        
        if (bullishEngulfing) {
            return { type: 'bullish_engulfing', sentiment: 'bullish', strength: 0.8 };
        } else if (bearishEngulfing) {
            return { type: 'bearish_engulfing', sentiment: 'bearish', strength: 0.8 };
        }
        
        return null;
    }

    detectInsideOutsideBar(candle1, candle2) {
        // Inside bar
        if (candle2.high <= candle1.high && candle2.low >= candle1.low) {
            return { type: 'inside_bar', sentiment: 'neutral', strength: 0.5, consolidation: true };
        }
        
        // Outside bar
        if (candle2.high > candle1.high && candle2.low < candle1.low) {
            return { type: 'outside_bar', sentiment: 'neutral', strength: 0.6, volatility: 'high' };
        }
        
        return null;
    }

    identifySwingPoints(priceHistory, ohlcData) {
        const swings = [];
        const lookback = 3;
        
        for (let i = lookback; i < ohlcData.length - lookback; i++) {
            const candle = ohlcData[i];
            
            // Check for swing high
            let isSwingHigh = true;
            for (let j = i - lookback; j <= i + lookback; j++) {
                if (j !== i && ohlcData[j].high >= candle.high) {
                    isSwingHigh = false;
                    break;
                }
            }
            
            if (isSwingHigh) {
                swings.push({
                    type: 'high',
                    price: candle.high,
                    index: i,
                    candle: candle
                });
            }
            
            // Check for swing low
            let isSwingLow = true;
            for (let j = i - lookback; j <= i + lookback; j++) {
                if (j !== i && ohlcData[j].low <= candle.low) {
                    isSwingLow = false;
                    break;
                }
            }
            
            if (isSwingLow) {
                swings.push({
                    type: 'low',
                    price: candle.low,
                    index: i,
                    candle: candle
                });
            }
        }
        
        return swings.sort((a, b) => a.index - b.index);
    }

    updatePriceActionTracking(symbol, data, timestamp) {
        // Update various tracking maps
        this.swingHistory.set(symbol, data.swings);
        this.candlePatternCache.set(symbol, data.patterns);
        this.priceStructureCache.set(symbol, data.structure);
    }

    generatePriceActionSignals(sentiment, breakoutReversal, keyLevelInteraction) {
        const signals = [];
        
        if (sentiment.confidence > 0.6) {
            signals.push(this.createSignal(
                'price-action-sentiment',
                sentiment.confidence,
                {
                    variant: sentiment.overall,
                    riskLevel: sentiment.confidence > 0.8 ? 'low' : 'medium',
                    analysis: { sentiment, breakoutReversal, keyLevelInteraction },
                    recommendations: this.generatePriceActionRecommendations(sentiment),
                    confirmationChain: this.buildPriceActionConfirmationChain(sentiment)
                }
            ));
        }
        
        return signals;
    }

    generateNotifications(sentiment, breakoutReversal) {
        return {
            grafikBeyni: {
                priceActionSentiment: sentiment.overall,
                confidence: sentiment.confidence
            },
            candlestickInterpreter: {
                sentiment: sentiment.overall,
                strength: sentiment.strength
            },
            formPatternRecognizer: {
                priceActionAlignment: sentiment.overall,
                confidence: sentiment.confidence
            },
            vivo: {
                priceActionSignal: sentiment.confidence > 0.7,
                direction: sentiment.overall
            }
        };
    }

    // Additional helper methods (simplified)
    scorePatternSignificance(patterns, srLevels, ohlcData) { return patterns.filter(p => p.strength > 0.6); }
    selectDominantPattern(patterns) { return patterns.reduce((max, p) => p.strength > (max?.strength || 0) ? p : max, null); }
    calculatePatternSentiment(patterns) { return 'neutral'; }
    calculateSwingStrength(swings, volumes) { return 0.7; }
    analyzeSwingTrend(swings) { return 'neutral'; }
    calculateAverageSwingSize(swings) { return 0.02; }
    calculateSwingMomentum(swings) { return 0.6; }
    checkHigherHighs(highs) { return false; }
    checkHigherLows(lows) { return false; }
    checkLowerHighs(highs) { return false; }
    checkLowerLows(lows) { return false; }
    calculateStructureStrength(analysis) { return 0.7; }
    calculateShortTermMomentum(prices) { return 0.6; }
    calculateMediumTermMomentum(prices) { return 0.7; }
    calculateVolumeMomentum(volumes) { return 0.5; }
    calculatePriceAcceleration(prices) { return 0.6; }
    calculateVolatilityMomentum(candles) { return 0.5; }
    classifyOverallMomentum(analysis) { return 'neutral'; }
    calculateMomentumStrength(analysis) { return 0.6; }
    determineMomentumDirection(analysis) { return 'neutral'; }
    checkLevelInteraction(candle, level, patterns) { return null; }
    calculateInteractionSentiment(interactions) { return 'neutral'; }
    analyzeBreakoutReversalPotential(candles, swings, structure, keyLevels) { return { potential: 0.5 }; }
    generatePriceActionRecommendations(sentiment) { return [`Price action shows ${sentiment.overall} sentiment`]; }
    buildPriceActionConfirmationChain(sentiment) { return [`price_action_${sentiment.overall}`]; }

    /**
     * Main interface function
     */
    async getPriceActionAnalysis(marketData) {
        const result = await this.analyze(marketData);
        return {
            sentiment: result.metadata?.priceActionSentiment || 'neutral',
            confidence: result.metadata?.sentiment?.confidence || 0.5,
            patterns: result.metadata?.candlePatternAnalysis || {}
        };
    }
}

module.exports = PriceActionAnalyzer;
