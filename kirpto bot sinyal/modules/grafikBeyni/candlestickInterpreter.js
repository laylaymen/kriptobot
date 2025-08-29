/**
 * 📦 candlestickInterpreter.js
 * 🎯 Mum kalıplarını yorumlayan ve sinyal üreten detaylı modül
 */

const GrafikBeyniModuleBase = require('../grafikBeyniModuleBase');

class CandlestickInterpreter extends GrafikBeyniModuleBase {
    constructor(config = {}) {
        super('candlestickInterpreter', {
            ...config,
            scoreThreshold: 0.6,
            candleTypes: {
                'doji': {
                    maxBodyPercent: 0.1,
                    significance: 'reversal_indecision',
                    strength: 0.6
                },
                'hammer': {
                    maxBodyPercent: 0.3,
                    minLowerWickRatio: 2.0,
                    maxUpperWickRatio: 0.3,
                    significance: 'bullish_reversal',
                    strength: 0.8
                },
                'hanging_man': {
                    maxBodyPercent: 0.3,
                    minLowerWickRatio: 2.0,
                    maxUpperWickRatio: 0.3,
                    significance: 'bearish_reversal',
                    strength: 0.8,
                    contextRequired: 'uptrend'
                },
                'shooting_star': {
                    maxBodyPercent: 0.3,
                    minUpperWickRatio: 2.0,
                    maxLowerWickRatio: 0.3,
                    significance: 'bearish_reversal',
                    strength: 0.8
                },
                'inverted_hammer': {
                    maxBodyPercent: 0.3,
                    minUpperWickRatio: 2.0,
                    maxLowerWickRatio: 0.3,
                    significance: 'bullish_reversal',
                    strength: 0.7,
                    contextRequired: 'downtrend'
                },
                'marubozu': {
                    minBodyPercent: 0.95,
                    significance: 'strong_momentum',
                    strength: 0.9
                }
            },
            multiCandlePatterns: {
                'engulfing': {
                    candleCount: 2,
                    significance: 'strong_reversal',
                    strength: 0.9
                },
                'harami': {
                    candleCount: 2,
                    significance: 'reversal_warning',
                    strength: 0.6
                },
                'piercing_line': {
                    candleCount: 2,
                    significance: 'bullish_reversal',
                    strength: 0.7
                },
                'dark_cloud_cover': {
                    candleCount: 2,
                    significance: 'bearish_reversal',
                    strength: 0.7
                },
                'morning_star': {
                    candleCount: 3,
                    significance: 'strong_bullish_reversal',
                    strength: 0.9
                },
                'evening_star': {
                    candleCount: 3,
                    significance: 'strong_bearish_reversal',
                    strength: 0.9
                },
                'three_white_soldiers': {
                    candleCount: 3,
                    significance: 'strong_bullish_continuation',
                    strength: 0.8
                },
                'three_black_crows': {
                    candleCount: 3,
                    significance: 'strong_bearish_continuation',
                    strength: 0.8
                }
            },
            contextFactors: {
                atKeyLevel: 1.3,
                afterTrend: 1.2,
                withVolume: 1.4,
                multipleConfirmation: 1.5
            }
        });

        // Pattern tracking
        this.patternHistory = new Map();
        this.contextCache = new Map();
        this.reliabilityMetrics = new Map();
    }

    async performAnalysis(marketData) {
        try {
            const {
                symbol = 'UNKNOWN',
                timeframe = '15m',
                ohlcData = [],
                volumeHistory = [],
                supportResistanceLevels = [],
                trendDirection = 'neutral',
                trendStrength = 0.5,
                priceActionSentiment = 'neutral',
                timestamp = Date.now()
            } = marketData;

            if (ohlcData.length < 5) {
                return { signals: [], metadata: { error: 'Insufficient candle data' } };
            }

            // Single candle pattern analysis
            const singleCandleAnalysis = this.analyzeSingleCandlePatterns(
                ohlcData,
                supportResistanceLevels,
                volumeHistory,
                trendDirection
            );
            
            // Multi-candle pattern analysis
            const multiCandleAnalysis = this.analyzeMultiCandlePatterns(
                ohlcData,
                supportResistanceLevels,
                volumeHistory,
                trendDirection
            );
            
            // Context analysis
            const contextAnalysis = this.analyzePatternContext(
                [...singleCandleAnalysis.patterns, ...multiCandleAnalysis.patterns],
                supportResistanceLevels,
                trendDirection,
                trendStrength,
                priceActionSentiment
            );
            
            // Pattern confirmation analysis
            const confirmationAnalysis = this.analyzePatternConfirmation(
                contextAnalysis.contextualPatterns,
                ohlcData,
                volumeHistory
            );
            
            // Reliability scoring
            const reliabilityAnalysis = this.analyzePatternReliability(
                confirmationAnalysis.confirmedPatterns,
                symbol,
                timeframe
            );
            
            // Pattern sequence analysis
            const sequenceAnalysis = this.analyzePatternSequence(
                ohlcData,
                reliabilityAnalysis.reliablePatterns
            );
            
            // Generate overall interpretation
            const interpretation = this.generateOverallInterpretation({
                singleCandles: singleCandleAnalysis,
                multiCandles: multiCandleAnalysis,
                context: contextAnalysis,
                confirmation: confirmationAnalysis,
                reliability: reliabilityAnalysis,
                sequence: sequenceAnalysis
            });
            
            // Update tracking
            this.updatePatternTracking(symbol, interpretation, timestamp);
            
            // Generate signals
            const signals = this.generateCandlestickSignals(
                interpretation,
                reliabilityAnalysis,
                confirmationAnalysis
            );

            return {
                signals,
                metadata: {
                    moduleName: this.name,
                    interpretation: interpretation.overall,
                    singleCandleAnalysis,
                    multiCandleAnalysis,
                    contextAnalysis,
                    confirmationAnalysis,
                    reliabilityAnalysis,
                    sequenceAnalysis,
                    notify: this.generateNotifications(interpretation, reliabilityAnalysis)
                }
            };

        } catch (error) {
            console.error('❌ CandlestickInterpreter analysis error:', error);
            return { signals: [], error: error.message };
        }
    }

    /**
     * Single candle pattern analizi
     */
    analyzeSingleCandlePatterns(ohlcData, srLevels, volumeHistory, trendDirection) {
        const patterns = [];
        const recentCandles = ohlcData.slice(-3); // Last 3 candles for context
        
        recentCandles.forEach((candle, index) => {
            const globalIndex = ohlcData.length - 3 + index;
            const volume = volumeHistory[globalIndex] || 1;
            
            // Analyze each candle for single patterns
            const candlePatterns = this.detectSinglePatterns(candle, volume, srLevels, trendDirection);
            patterns.push(...candlePatterns.map(p => ({ ...p, index: globalIndex, candle })));
        });
        
        return {
            patterns,
            patternCount: patterns.length,
            significantPatterns: patterns.filter(p => p.strength > 0.7),
            dominantPattern: this.selectDominantSinglePattern(patterns)
        };
    }

    /**
     * Multi-candle pattern analizi
     */
    analyzeMultiCandlePatterns(ohlcData, srLevels, volumeHistory, trendDirection) {
        const patterns = [];
        
        // 2-candle patterns
        for (let i = 1; i < ohlcData.length; i++) {
            const twoCandle = this.detectTwoCandlePatterns(
                ohlcData[i-1], 
                ohlcData[i], 
                volumeHistory.slice(i-1, i+1),
                trendDirection
            );
            if (twoCandle) {
                patterns.push({ ...twoCandle, endIndex: i, candles: [ohlcData[i-1], ohlcData[i]] });
            }
        }
        
        // 3-candle patterns
        for (let i = 2; i < ohlcData.length; i++) {
            const threeCandle = this.detectThreeCandlePatterns(
                ohlcData[i-2], 
                ohlcData[i-1], 
                ohlcData[i], 
                volumeHistory.slice(i-2, i+1),
                trendDirection
            );
            if (threeCandle) {
                patterns.push({ ...threeCandle, endIndex: i, candles: [ohlcData[i-2], ohlcData[i-1], ohlcData[i]] });
            }
        }
        
        return {
            patterns,
            patternCount: patterns.length,
            significantPatterns: patterns.filter(p => p.strength > 0.7),
            dominantPattern: this.selectDominantMultiPattern(patterns)
        };
    }

    /**
     * Single pattern detection
     */
    detectSinglePatterns(candle, volume, srLevels, trendDirection) {
        const { open, high, low, close } = candle;
        const body = Math.abs(close - open);
        const totalRange = high - low;
        const upperWick = high - Math.max(open, close);
        const lowerWick = Math.min(open, close) - low;
        
        const bodyPercent = body / totalRange;
        const upperWickRatio = upperWick / body;
        const lowerWickRatio = lowerWick / body;
        
        const patterns = [];
        
        // Doji
        if (this.isDoji(bodyPercent)) {
            const atKeyLevel = this.isAtKeyLevel(candle, srLevels);
            patterns.push({
                type: 'doji',
                sentiment: 'neutral',
                strength: atKeyLevel ? 0.8 : 0.6,
                significance: 'indecision',
                context: atKeyLevel ? 'key_level' : 'general',
                interpretation: 'Market indecision, potential reversal warning'
            });
        }
        
        // Hammer/Hanging Man
        if (this.isHammerType(bodyPercent, lowerWickRatio, upperWickRatio)) {
            const isHammer = trendDirection === 'bearish' || trendDirection === 'downtrend';
            const atSupport = this.isNearLevel(low, srLevels, 'support');
            
            patterns.push({
                type: isHammer ? 'hammer' : 'hanging_man',
                sentiment: isHammer ? 'bullish' : 'bearish',
                strength: atSupport ? 0.9 : 0.7,
                significance: 'reversal',
                context: atSupport ? 'key_support' : 'trend_context',
                interpretation: isHammer ? 'Bullish reversal signal' : 'Bearish reversal warning'
            });
        }
        
        // Shooting Star/Inverted Hammer
        if (this.isShootingStarType(bodyPercent, upperWickRatio, lowerWickRatio)) {
            const isShootingStar = trendDirection === 'bullish' || trendDirection === 'uptrend';
            const atResistance = this.isNearLevel(high, srLevels, 'resistance');
            
            patterns.push({
                type: isShootingStar ? 'shooting_star' : 'inverted_hammer',
                sentiment: isShootingStar ? 'bearish' : 'bullish',
                strength: atResistance ? 0.9 : 0.7,
                significance: 'reversal',
                context: atResistance ? 'key_resistance' : 'trend_context',
                interpretation: isShootingStar ? 'Bearish reversal signal' : 'Bullish reversal potential'
            });
        }
        
        // Marubozu
        if (this.isMarubozu(bodyPercent)) {
            const isBullish = close > open;
            patterns.push({
                type: isBullish ? 'bullish_marubozu' : 'bearish_marubozu',
                sentiment: isBullish ? 'bullish' : 'bearish',
                strength: 0.8,
                significance: 'strong_momentum',
                context: 'momentum',
                interpretation: `Strong ${isBullish ? 'bullish' : 'bearish'} momentum`
            });
        }
        
        return patterns;
    }

    /**
     * Two-candle pattern detection
     */
    detectTwoCandlePatterns(candle1, candle2, volumes, trendDirection) {
        // Bullish Engulfing
        if (this.isBullishEngulfing(candle1, candle2)) {
            return {
                type: 'bullish_engulfing',
                sentiment: 'bullish',
                strength: 0.9,
                significance: 'strong_reversal',
                interpretation: 'Strong bullish reversal signal'
            };
        }
        
        // Bearish Engulfing
        if (this.isBearishEngulfing(candle1, candle2)) {
            return {
                type: 'bearish_engulfing',
                sentiment: 'bearish',
                strength: 0.9,
                significance: 'strong_reversal',
                interpretation: 'Strong bearish reversal signal'
            };
        }
        
        // Bullish Harami
        if (this.isBullishHarami(candle1, candle2)) {
            return {
                type: 'bullish_harami',
                sentiment: 'bullish',
                strength: 0.6,
                significance: 'reversal_warning',
                interpretation: 'Potential bullish reversal, needs confirmation'
            };
        }
        
        // Bearish Harami
        if (this.isBearishHarami(candle1, candle2)) {
            return {
                type: 'bearish_harami',
                sentiment: 'bearish',
                strength: 0.6,
                significance: 'reversal_warning',
                interpretation: 'Potential bearish reversal, needs confirmation'
            };
        }
        
        // Piercing Line
        if (this.isPiercingLine(candle1, candle2)) {
            return {
                type: 'piercing_line',
                sentiment: 'bullish',
                strength: 0.7,
                significance: 'bullish_reversal',
                interpretation: 'Bullish reversal pattern'
            };
        }
        
        // Dark Cloud Cover
        if (this.isDarkCloudCover(candle1, candle2)) {
            return {
                type: 'dark_cloud_cover',
                sentiment: 'bearish',
                strength: 0.7,
                significance: 'bearish_reversal',
                interpretation: 'Bearish reversal pattern'
            };
        }
        
        return null;
    }

    /**
     * Three-candle pattern detection
     */
    detectThreeCandlePatterns(candle1, candle2, candle3, volumes, trendDirection) {
        // Morning Star
        if (this.isMorningStar(candle1, candle2, candle3)) {
            return {
                type: 'morning_star',
                sentiment: 'bullish',
                strength: 0.9,
                significance: 'strong_bullish_reversal',
                interpretation: 'Strong bullish reversal confirmation'
            };
        }
        
        // Evening Star
        if (this.isEveningStar(candle1, candle2, candle3)) {
            return {
                type: 'evening_star',
                sentiment: 'bearish',
                strength: 0.9,
                significance: 'strong_bearish_reversal',
                interpretation: 'Strong bearish reversal confirmation'
            };
        }
        
        // Three White Soldiers
        if (this.isThreeWhiteSoldiers(candle1, candle2, candle3)) {
            return {
                type: 'three_white_soldiers',
                sentiment: 'bullish',
                strength: 0.8,
                significance: 'strong_bullish_continuation',
                interpretation: 'Strong bullish momentum continuation'
            };
        }
        
        // Three Black Crows
        if (this.isThreeBlackCrows(candle1, candle2, candle3)) {
            return {
                type: 'three_black_crows',
                sentiment: 'bearish',
                strength: 0.8,
                significance: 'strong_bearish_continuation',
                interpretation: 'Strong bearish momentum continuation'
            };
        }
        
        return null;
    }

    /**
     * Pattern context analizi
     */
    analyzePatternContext(patterns, srLevels, trendDirection, trendStrength, priceActionSentiment) {
        const contextualPatterns = patterns.map(pattern => {
            let contextScore = pattern.strength;
            let contextFactors = [];
            
            // Key level context
            if (pattern.context && pattern.context.includes('key_')) {
                contextScore *= this.config.contextFactors.atKeyLevel;
                contextFactors.push('at_key_level');
            }
            
            // Trend context
            if (this.isPatternAlignedWithTrend(pattern, trendDirection)) {
                contextScore *= this.config.contextFactors.afterTrend;
                contextFactors.push('trend_aligned');
            } else if (this.isPatternCounterTrend(pattern, trendDirection)) {
                contextScore *= 1.1; // Slight bonus for counter-trend reversal patterns
                contextFactors.push('counter_trend_reversal');
            }
            
            // Price action alignment
            if (this.isPatternAlignedWithPriceAction(pattern, priceActionSentiment)) {
                contextScore *= 1.2;
                contextFactors.push('price_action_aligned');
            }
            
            // Trend strength factor
            if (trendStrength > 0.7 && pattern.significance.includes('reversal')) {
                contextScore *= 1.3; // Strong trends make reversal patterns more significant
                contextFactors.push('strong_trend_reversal');
            }
            
            return {
                ...pattern,
                contextScore: Math.min(contextScore, 1.0), // Cap at 1.0
                contextFactors,
                reliability: this.calculatePatternReliability(pattern, contextFactors)
            };
        });
        
        return {
            contextualPatterns,
            highReliabilityPatterns: contextualPatterns.filter(p => p.reliability > 0.8),
            averageReliability: contextualPatterns.reduce((sum, p) => sum + p.reliability, 0) / contextualPatterns.length
        };
    }

    /**
     * Pattern confirmation analizi
     */
    analyzePatternConfirmation(patterns, ohlcData, volumeHistory) {
        const confirmedPatterns = patterns.filter(pattern => {
            // Volume confirmation
            const hasVolumeConfirmation = this.checkVolumeConfirmation(pattern, volumeHistory);
            
            // Follow-through confirmation
            const hasFollowThrough = this.checkFollowThroughConfirmation(pattern, ohlcData);
            
            // Time confirmation
            const hasTimeConfirmation = this.checkTimeConfirmation(pattern);
            
            pattern.confirmationFactors = {
                volume: hasVolumeConfirmation,
                followThrough: hasFollowThrough,
                time: hasTimeConfirmation
            };
            
            pattern.confirmationScore = [hasVolumeConfirmation, hasFollowThrough, hasTimeConfirmation]
                .filter(Boolean).length / 3;
            
            return pattern.confirmationScore >= 0.5; // At least 50% confirmation
        });
        
        return {
            confirmedPatterns,
            confirmationRate: confirmedPatterns.length / patterns.length,
            stronglyConfirmedPatterns: confirmedPatterns.filter(p => p.confirmationScore >= 0.8)
        };
    }

    /**
     * Overall interpretation oluştur
     */
    generateOverallInterpretation(analyses) {
        const { singleCandles, multiCandles, context, confirmation, reliability, sequence } = analyses;
        
        // Collect all significant patterns
        const allSignificantPatterns = [
            ...(context.highReliabilityPatterns || []),
            ...(confirmation.stronglyConfirmedPatterns || [])
        ];
        
        // Determine dominant sentiment
        const sentiments = allSignificantPatterns.map(p => p.sentiment);
        const bullishCount = sentiments.filter(s => s === 'bullish').length;
        const bearishCount = sentiments.filter(s => s === 'bearish').length;
        
        let overallSentiment;
        let confidence;
        
        if (bullishCount > bearishCount) {
            overallSentiment = 'bullish';
            confidence = bullishCount / (bullishCount + bearishCount);
        } else if (bearishCount > bullishCount) {
            overallSentiment = 'bearish';
            confidence = bearishCount / (bullishCount + bearishCount);
        } else {
            overallSentiment = 'neutral';
            confidence = 0.5;
        }
        
        // Calculate strength
        const averageStrength = allSignificantPatterns.length > 0 ?
            allSignificantPatterns.reduce((sum, p) => sum + p.contextScore, 0) / allSignificantPatterns.length : 0.5;
        
        return {
            overall: overallSentiment,
            confidence,
            strength: averageStrength,
            significantPatterns: allSignificantPatterns,
            patternCount: allSignificantPatterns.length,
            interpretation: this.generateTextualInterpretation(overallSentiment, confidence, allSignificantPatterns),
            recommendations: this.generatePatternRecommendations(allSignificantPatterns, overallSentiment)
        };
    }

    /**
     * Helper Methods (pattern detection logic)
     */
    isDoji(bodyPercent) { return bodyPercent <= 0.1; }
    isHammerType(bodyPercent, lowerWickRatio, upperWickRatio) {
        return bodyPercent <= 0.3 && lowerWickRatio >= 2.0 && upperWickRatio <= 0.3;
    }
    isShootingStarType(bodyPercent, upperWickRatio, lowerWickRatio) {
        return bodyPercent <= 0.3 && upperWickRatio >= 2.0 && lowerWickRatio <= 0.3;
    }
    isMarubozu(bodyPercent) { return bodyPercent >= 0.95; }
    
    isBullishEngulfing(c1, c2) {
        return c1.close < c1.open && c2.close > c2.open && 
               c2.open <= c1.close && c2.close >= c1.open &&
               Math.abs(c2.close - c2.open) > Math.abs(c1.close - c1.open) * 1.05;
    }
    
    isBearishEngulfing(c1, c2) {
        return c1.close > c1.open && c2.close < c2.open && 
               c2.open >= c1.close && c2.close <= c1.open &&
               Math.abs(c2.close - c2.open) > Math.abs(c1.close - c1.open) * 1.05;
    }
    
    isBullishHarami(c1, c2) {
        return c1.close < c1.open && c2.close > c2.open &&
               c2.open > c1.close && c2.close < c1.open;
    }
    
    isBearishHarami(c1, c2) {
        return c1.close > c1.open && c2.close < c2.open &&
               c2.open < c1.close && c2.close > c1.open;
    }
    
    isPiercingLine(c1, c2) {
        if (c1.close >= c1.open || c2.close <= c2.open) return false;
        const midPoint = (c1.open + c1.close) / 2;
        return c2.open < c1.close && c2.close > midPoint && c2.close < c1.open;
    }
    
    isDarkCloudCover(c1, c2) {
        if (c1.close <= c1.open || c2.close >= c2.open) return false;
        const midPoint = (c1.open + c1.close) / 2;
        return c2.open > c1.close && c2.close < midPoint && c2.close > c1.open;
    }
    
    isMorningStar(c1, c2, c3) {
        return c1.close < c1.open && // First candle bearish
               Math.abs(c2.close - c2.open) < Math.abs(c1.close - c1.open) * 0.3 && // Small middle candle
               c3.close > c3.open && // Third candle bullish
               c3.close > (c1.open + c1.close) / 2; // Closes above midpoint of first candle
    }
    
    isEveningStar(c1, c2, c3) {
        return c1.close > c1.open && // First candle bullish
               Math.abs(c2.close - c2.open) < Math.abs(c1.close - c1.open) * 0.3 && // Small middle candle
               c3.close < c3.open && // Third candle bearish
               c3.close < (c1.open + c1.close) / 2; // Closes below midpoint of first candle
    }
    
    isThreeWhiteSoldiers(c1, c2, c3) {
        return c1.close > c1.open && c2.close > c2.open && c3.close > c3.open &&
               c2.close > c1.close && c3.close > c2.close &&
               c2.open > c1.open && c2.open < c1.close &&
               c3.open > c2.open && c3.open < c2.close;
    }
    
    isThreeBlackCrows(c1, c2, c3) {
        return c1.close < c1.open && c2.close < c2.open && c3.close < c3.open &&
               c2.close < c1.close && c3.close < c2.close &&
               c2.open < c1.open && c2.open > c1.close &&
               c3.open < c2.open && c3.open > c2.close;
    }

    // Additional helper methods (simplified)
    isAtKeyLevel(candle, srLevels) { return false; }
    isNearLevel(price, levels, type) { return false; }
    selectDominantSinglePattern(patterns) { return patterns[0] || null; }
    selectDominantMultiPattern(patterns) { return patterns[0] || null; }
    isPatternAlignedWithTrend(pattern, trend) { return pattern.sentiment === trend; }
    isPatternCounterTrend(pattern, trend) { return pattern.sentiment !== trend && pattern.significance.includes('reversal'); }
    isPatternAlignedWithPriceAction(pattern, priceAction) { return pattern.sentiment === priceAction; }
    calculatePatternReliability(pattern, factors) { return 0.7; }
    checkVolumeConfirmation(pattern, volumes) { return true; }
    checkFollowThroughConfirmation(pattern, ohlc) { return true; }
    checkTimeConfirmation(pattern) { return true; }
    analyzePatternReliability(patterns, symbol, timeframe) { return { reliablePatterns: patterns }; }
    analyzePatternSequence(ohlc, patterns) { return { sequence: 'normal' }; }
    generateTextualInterpretation(sentiment, confidence, patterns) { return `${sentiment} bias with ${confidence} confidence`; }
    generatePatternRecommendations(patterns, sentiment) { return [`Consider ${sentiment} bias based on candlestick patterns`]; }

    updatePatternTracking(symbol, interpretation, timestamp) {
        if (!this.patternHistory.has(symbol)) {
            this.patternHistory.set(symbol, []);
        }
        
        const history = this.patternHistory.get(symbol);
        history.push({
            timestamp,
            interpretation: interpretation.overall,
            confidence: interpretation.confidence,
            patterns: interpretation.significantPatterns
        });
        
        // Keep last 20 interpretations
        if (history.length > 20) {
            history.shift();
        }
    }

    generateCandlestickSignals(interpretation, reliability, confirmation) {
        const signals = [];
        
        if (interpretation.confidence > 0.7 && interpretation.patternCount > 0) {
            signals.push(this.createSignal(
                'candlestick-pattern',
                interpretation.confidence,
                {
                    variant: interpretation.overall,
                    riskLevel: interpretation.confidence > 0.8 ? 'low' : 'medium',
                    analysis: { interpretation, reliability, confirmation },
                    recommendations: interpretation.recommendations,
                    confirmationChain: [`candlestick_${interpretation.overall}`]
                }
            ));
        }
        
        return signals;
    }

    generateNotifications(interpretation, reliability) {
        return {
            grafikBeyni: {
                candlestickSentiment: interpretation.overall,
                confidence: interpretation.confidence,
                patternCount: interpretation.patternCount
            },
            priceActionAnalyzer: {
                candlestickAlignment: interpretation.overall,
                strength: interpretation.strength
            },
            formPatternRecognizer: {
                candlestickSupport: interpretation.overall,
                reliability: reliability.reliablePatterns?.length || 0
            },
            vivo: {
                candlestickSignal: interpretation.confidence > 0.8,
                direction: interpretation.overall
            }
        };
    }

    /**
     * Main interface function
     */
    async getCandlestickInterpretation(marketData) {
        const result = await this.analyze(marketData);
        return {
            sentiment: result.metadata?.interpretation?.overall || 'neutral',
            confidence: result.metadata?.interpretation?.confidence || 0.5,
            patterns: result.metadata?.interpretation?.significantPatterns || []
        };
    }
}

module.exports = CandlestickInterpreter;
