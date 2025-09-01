const GrafikBeyniModuleBase = require('./grafikBeyniModuleBase');

/**
 * Trend Filter Module
 * Trend direction and strength filtering for signal validation
 * Uptrend/Downtrend kararına göre strateji yönü belirleme
 */
class TrendFilter extends GrafikBeyniModuleBase {
    constructor() {
        super('trendFilter');
        this.trendHistory = [];
        this.trendStrengthThresholds = {
            veryStrong: 0.8,
            strong: 0.6,
            moderate: 0.4,
            weak: 0.2
        };
        this.timeframes = ['1m', '5m', '15m', '1h', '4h', '1d'];
        this.maxHistorySize = 200;
        this.multiTimeframeWeights = {
            '1m': 0.1,
            '5m': 0.15,
            '15m': 0.2,
            '1h': 0.25,
            '4h': 0.2,
            '1d': 0.1
        };
    }

    async analyze(data) {
        try {
            const {
                price,
                ema20,
                ema50,
                ema200,
                sma20,
                sma50,
                sma200,
                adx,
                macd,
                rsi,
                volume,
                higherHighs,
                higherLows,
                lowerHighs,
                lowerLows,
                timeframe,
                multiTimeframeData,
                priceAction,
                momentum,
                volatility
            } = data;

            // Veri doğrulama
            if (!price || (!ema20 && !sma20)) {
                throw new Error('Missing required price and moving average data for trend filtering');
            }

            // Primary trend direction belirleme
            const primaryTrend = this.determinePrimaryTrend(data);

            // Trend strength hesaplama
            const trendStrength = this.calculateTrendStrength(data, primaryTrend);

            // Multi-timeframe trend analysis
            const multiTimeframeTrend = this.analyzeMultiTimeframeTrend(multiTimeframeData, timeframe);

            // Trend quality assessment
            const trendQuality = this.assessTrendQuality(data, primaryTrend, trendStrength);

            // Trend confirmation signals
            const confirmationSignals = this.analyzeConfirmationSignals(data, primaryTrend);

            // Trend momentum analysis
            const momentumAnalysis = this.analyzeTrendMomentum(data, primaryTrend);

            // Trend sustainability evaluation
            const sustainability = this.evaluateTrendSustainability(data, primaryTrend, trendStrength);

            // Filter decision - Ana karar
            const filterDecision = this.makeFilterDecision(primaryTrend, trendStrength, multiTimeframeTrend, trendQuality);

            // Strategy direction recommendation
            const strategyDirection = this.recommendStrategyDirection(filterDecision, primaryTrend, trendStrength);

            // Signal alignment check
            const signalAlignment = this.checkSignalAlignment(data, primaryTrend, filterDecision);

            const result = {
                primaryTrend: primaryTrend,
                trendStrength: trendStrength,
                multiTimeframeTrend: multiTimeframeTrend,
                trendQuality: trendQuality,
                confirmationSignals: confirmationSignals,
                momentumAnalysis: momentumAnalysis,
                sustainability: sustainability,
                filterDecision: filterDecision,
                strategyDirection: strategyDirection,
                signalAlignment: signalAlignment,
                recommendations: this.generateRecommendations(filterDecision, strategyDirection, data),
                notes: this.generateNotes(primaryTrend, trendStrength, filterDecision),
                metadata: {
                    analysisTimestamp: Date.now(),
                    timeframe: timeframe,
                    trendDuration: this.calculateTrendDuration(primaryTrend),
                    trendReliability: this.calculateTrendReliability(trendStrength, confirmationSignals),
                    nextReview: this.getNextReviewTime(timeframe),
                    historicalAccuracy: this.getHistoricalAccuracy(primaryTrend)
                }
            };

            // Trend history güncelleme
            this.updateTrendHistory(result, data);

            // Cache ve performance tracking
            this.updateCache(data, result);
            this.trackPerformance(Date.now(), filterDecision.action !== 'reject');

            return result;

        } catch (error) {
            this.handleError('TrendFilter analysis failed', error, data);
            return this.getDefaultResult();
        }
    }

    determinePrimaryTrend(data) {
        const {
            price,
            ema20,
            ema50,
            ema200,
            sma20,
            sma50,
            sma200,
            higherHighs,
            higherLows,
            lowerHighs,
            lowerLows
        } = data;

        let trendScore = 0;
        const factors = [];

        // Moving Average alignment
        if (ema20 && ema50 && ema200) {
            if (price > ema20 && ema20 > ema50 && ema50 > ema200) {
                trendScore += 3;
                factors.push('bullish_ema_alignment');
            } else if (price < ema20 && ema20 < ema50 && ema50 < ema200) {
                trendScore -= 3;
                factors.push('bearish_ema_alignment');
            } else if (price > ema20 && ema20 > ema50) {
                trendScore += 2;
                factors.push('short_term_bullish');
            } else if (price < ema20 && ema20 < ema50) {
                trendScore -= 2;
                factors.push('short_term_bearish');
            }
        }

        // SMA confirmation
        if (sma20 && sma50 && sma200) {
            if (sma20 > sma50 && sma50 > sma200) {
                trendScore += 2;
                factors.push('bullish_sma_confirmation');
            } else if (sma20 < sma50 && sma50 < sma200) {
                trendScore -= 2;
                factors.push('bearish_sma_confirmation');
            }
        }

        // Price structure analysis
        if (higherHighs && higherLows) {
            trendScore += 2;
            factors.push('bullish_price_structure');
        } else if (lowerHighs && lowerLows) {
            trendScore -= 2;
            factors.push('bearish_price_structure');
        }

        // Trend direction belirleme
        let direction = 'sideways';
        let confidence = 0.5;

        if (trendScore >= 4) {
            direction = 'uptrend';
            confidence = Math.min(0.9, 0.5 + (trendScore / 14));
        } else if (trendScore <= -4) {
            direction = 'downtrend';
            confidence = Math.min(0.9, 0.5 + (Math.abs(trendScore) / 14));
        } else if (trendScore >= 2) {
            direction = 'weak_uptrend';
            confidence = 0.6;
        } else if (trendScore <= -2) {
            direction = 'weak_downtrend';
            confidence = 0.6;
        }

        return {
            direction: direction,
            score: trendScore,
            confidence: confidence,
            factors: factors,
            strength: Math.abs(trendScore) / 7 // Normalize to 0-1
        };
    }

    calculateTrendStrength(data, primaryTrend) {
        const { adx, macd, momentum, volatility, volume } = data;

        let strengthScore = primaryTrend.strength * 10; // Base from primary trend

        // ADX contribution
        if (adx !== undefined) {
            if (adx > 25) strengthScore += 2;
            else if (adx > 20) strengthScore += 1;
            else if (adx < 15) strengthScore -= 1;
        }

        // MACD strength
        if (macd) {
            const macdStrength = Math.abs(macd.histogram || 0);
            if (macdStrength > 0.5) strengthScore += 1.5;
            else if (macdStrength > 0.2) strengthScore += 1;
        }

        // Momentum contribution
        if (momentum !== undefined) {
            strengthScore += Math.min(momentum * 2, 2);
        }

        // Volume confirmation
        if (volume && data.averageVolume) {
            const volumeRatio = volume / data.averageVolume;
            if (volumeRatio > 1.5) strengthScore += 1;
            else if (volumeRatio > 1.2) strengthScore += 0.5;
            else if (volumeRatio < 0.8) strengthScore -= 0.5;
        }

        // Volatility adjustment
        if (volatility !== undefined) {
            if (volatility > 2) strengthScore -= 1; // High volatility reduces trend clarity
            else if (volatility < 0.5) strengthScore += 0.5; // Low volatility helps trend
        }

        const normalizedStrength = Math.max(0, Math.min(1, strengthScore / 10));

        return {
            value: normalizedStrength,
            level: this.getTrendStrengthLevel(normalizedStrength),
            factors: this.identifyStrengthFactors(data, normalizedStrength),
            reliability: this.calculateStrengthReliability(data, normalizedStrength)
        };
    }

    analyzeMultiTimeframeTrend(multiTimeframeData, currentTimeframe) {
        if (!multiTimeframeData || Object.keys(multiTimeframeData).length === 0) {
            return { alignment: 'unknown', score: 0, conflicts: [] };
        }

        let alignmentScore = 0;
        const trends = {};
        const conflicts = [];

        // Her timeframe için trend belirle
        for (const [tf, data] of Object.entries(multiTimeframeData)) {
            const trend = this.determinePrimaryTrend(data);
            trends[tf] = trend;
            
            const weight = this.multiTimeframeWeights[tf] || 0.1;
            
            if (trend.direction === 'uptrend') {
                alignmentScore += weight * trend.confidence;
            } else if (trend.direction === 'downtrend') {
                alignmentScore -= weight * trend.confidence;
            }
            // sideways trend doesn't contribute to score
        }

        // Conflict detection
        const trendDirections = Object.values(trends).map(t => t.direction);
        const uniqueDirections = [...new Set(trendDirections)];
        
        if (uniqueDirections.length > 2) {
            conflicts.push('mixed_timeframe_signals');
        }

        // Higher timeframe dominance check
        const higherTimeframes = ['4h', '1d'];
        const lowerTimeframes = ['1m', '5m', '15m'];
        
        const higherTrends = higherTimeframes.map(tf => trends[tf]?.direction).filter(Boolean);
        const lowerTrends = lowerTimeframes.map(tf => trends[tf]?.direction).filter(Boolean);
        
        if (higherTrends.some(t => t === 'uptrend') && lowerTrends.some(t => t === 'downtrend')) {
            conflicts.push('higher_lower_timeframe_conflict');
        }

        let alignment = 'neutral';
        if (alignmentScore > 0.3) alignment = 'bullish';
        else if (alignmentScore < -0.3) alignment = 'bearish';

        return {
            alignment: alignment,
            score: alignmentScore,
            trends: trends,
            conflicts: conflicts,
            dominantTimeframe: this.findDominantTimeframe(trends),
            consistency: this.calculateTimeframeConsistency(trends)
        };
    }

    assessTrendQuality(data, primaryTrend, trendStrength) {
        const { price, volume, volatility, rsi } = data;

        let qualityScore = 7; // Base quality
        const qualityFactors = [];

        // Trend strength quality
        if (trendStrength.value > this.trendStrengthThresholds.strong) {
            qualityScore += 1.5;
            qualityFactors.push('strong_trend');
        } else if (trendStrength.value < this.trendStrengthThresholds.weak) {
            qualityScore -= 1.5;
            qualityFactors.push('weak_trend');
        }

        // Confidence quality
        if (primaryTrend.confidence > 0.8) {
            qualityScore += 1;
            qualityFactors.push('high_confidence');
        } else if (primaryTrend.confidence < 0.6) {
            qualityScore -= 1;
            qualityFactors.push('low_confidence');
        }

        // Volume quality
        if (volume && data.averageVolume) {
            const volumeRatio = volume / data.averageVolume;
            if (volumeRatio > 1.2) {
                qualityScore += 0.5;
                qualityFactors.push('volume_support');
            } else if (volumeRatio < 0.8) {
                qualityScore -= 0.5;
                qualityFactors.push('volume_weakness');
            }
        }

        // Volatility quality
        if (volatility !== undefined) {
            if (volatility > 3) {
                qualityScore -= 1;
                qualityFactors.push('high_volatility');
            } else if (volatility < 1) {
                qualityScore += 0.5;
                qualityFactors.push('stable_volatility');
            }
        }

        // RSI overbought/oversold check
        if (rsi !== undefined) {
            if ((primaryTrend.direction === 'uptrend' && rsi > 70) ||
                (primaryTrend.direction === 'downtrend' && rsi < 30)) {
                qualityScore -= 1;
                qualityFactors.push('overbought_oversold');
            }
        }

        const normalizedQuality = Math.max(1, Math.min(10, qualityScore));

        return {
            score: normalizedQuality,
            level: this.getTrendQualityLevel(normalizedQuality),
            factors: qualityFactors,
            recommendation: this.getQualityRecommendation(normalizedQuality)
        };
    }

    analyzeConfirmationSignals(data, primaryTrend) {
        const { macd, rsi, adx, volume, momentum } = data;

        const confirmations = [];
        const contradictions = [];
        let confirmationScore = 0;

        // MACD confirmation
        if (macd) {
            if (primaryTrend.direction === 'uptrend' && macd.line > macd.signal && macd.histogram > 0) {
                confirmations.push('macd_bullish');
                confirmationScore += 1;
            } else if (primaryTrend.direction === 'downtrend' && macd.line < macd.signal && macd.histogram < 0) {
                confirmations.push('macd_bearish');
                confirmationScore += 1;
            } else if (primaryTrend.direction !== 'sideways') {
                contradictions.push('macd_divergence');
                confirmationScore -= 0.5;
            }
        }

        // RSI confirmation
        if (rsi !== undefined) {
            if (primaryTrend.direction === 'uptrend' && rsi > 50 && rsi < 70) {
                confirmations.push('rsi_bullish');
                confirmationScore += 0.5;
            } else if (primaryTrend.direction === 'downtrend' && rsi < 50 && rsi > 30) {
                confirmations.push('rsi_bearish');
                confirmationScore += 0.5;
            }
        }

        // ADX confirmation
        if (adx !== undefined) {
            if (adx > 25) {
                confirmations.push('adx_strong_trend');
                confirmationScore += 1;
            } else if (adx < 20) {
                contradictions.push('adx_weak_trend');
                confirmationScore -= 0.5;
            }
        }

        // Volume confirmation
        if (volume && data.averageVolume) {
            const volumeRatio = volume / data.averageVolume;
            if (volumeRatio > 1.2) {
                confirmations.push('volume_support');
                confirmationScore += 0.5;
            } else if (volumeRatio < 0.8) {
                contradictions.push('volume_weakness');
                confirmationScore -= 0.5;
            }
        }

        // Momentum confirmation
        if (momentum !== undefined) {
            if ((primaryTrend.direction === 'uptrend' && momentum > 0.5) ||
                (primaryTrend.direction === 'downtrend' && momentum < -0.5)) {
                confirmations.push('momentum_aligned');
                confirmationScore += 0.5;
            } else if (momentum !== undefined) {
                contradictions.push('momentum_divergence');
                confirmationScore -= 0.5;
            }
        }

        return {
            confirmations: confirmations,
            contradictions: contradictions,
            score: confirmationScore,
            strength: this.getConfirmationStrength(confirmationScore),
            reliability: confirmations.length / (confirmations.length + contradictions.length + 1)
        };
    }

    analyzeTrendMomentum(data, primaryTrend) {
        const { momentum, macd, rsi, priceAction } = data;

        let momentumScore = 0;
        const momentumFactors = [];

        // Direct momentum
        if (momentum !== undefined) {
            momentumScore += momentum * 3;
            if (momentum > 0.7) momentumFactors.push('strong_positive_momentum');
            else if (momentum < -0.7) momentumFactors.push('strong_negative_momentum');
        }

        // MACD momentum
        if (macd && macd.histogram !== undefined) {
            const macdMomentum = macd.histogram;
            momentumScore += macdMomentum * 2;
            
            if (macdMomentum > 0.3) momentumFactors.push('macd_acceleration');
            else if (macdMomentum < -0.3) momentumFactors.push('macd_deceleration');
        }

        // RSI momentum (rate of change)
        if (data.rsiPrevious && rsi !== undefined) {
            const rsiChange = rsi - data.rsiPrevious;
            momentumScore += rsiChange / 20; // Scale down RSI change
            
            if (Math.abs(rsiChange) > 5) {
                momentumFactors.push('significant_rsi_change');
            }
        }

        // Price action momentum
        if (priceAction) {
            if (priceAction.trend === 'accelerating') {
                momentumScore += 1;
                momentumFactors.push('price_acceleration');
            } else if (priceAction.trend === 'decelerating') {
                momentumScore -= 1;
                momentumFactors.push('price_deceleration');
            }
        }

        return {
            score: momentumScore,
            level: this.getMomentumLevel(momentumScore),
            factors: momentumFactors,
            alignment: this.checkMomentumAlignment(momentumScore, primaryTrend),
            sustainability: this.assessMomentumSustainability(momentumScore, data)
        };
    }

    makeFilterDecision(primaryTrend, trendStrength, multiTimeframeTrend, trendQuality) {
        let decision = 'neutral';
        let confidence = 0.5;
        let action = 'wait';
        const reasons = [];

        // Primary trend weight
        let score = 0;
        
        if (primaryTrend.direction === 'uptrend') {
            score += 3 * primaryTrend.confidence;
            reasons.push('primary_uptrend');
        } else if (primaryTrend.direction === 'downtrend') {
            score -= 3 * primaryTrend.confidence;
            reasons.push('primary_downtrend');
        }

        // Trend strength weight
        if (trendStrength.value > this.trendStrengthThresholds.strong) {
            score += (score > 0 ? 2 : -2);
            reasons.push('strong_trend_confirmation');
        } else if (trendStrength.value < this.trendStrengthThresholds.weak) {
            score *= 0.5; // Reduce confidence for weak trends
            reasons.push('weak_trend_caution');
        }

        // Multi-timeframe weight
        if (multiTimeframeTrend.alignment === 'bullish') {
            score += 1.5;
            reasons.push('multi_timeframe_bullish');
        } else if (multiTimeframeTrend.alignment === 'bearish') {
            score -= 1.5;
            reasons.push('multi_timeframe_bearish');
        }

        // Quality weight
        if (trendQuality.score > 7) {
            score += 1;
            reasons.push('high_quality_trend');
        } else if (trendQuality.score < 4) {
            score -= 1;
            reasons.push('low_quality_trend');
        }

        // Decision logic
        if (score > 3) {
            decision = 'bullish';
            action = 'long_bias';
            confidence = Math.min(0.9, 0.6 + (score / 15));
        } else if (score < -3) {
            decision = 'bearish';
            action = 'short_bias';
            confidence = Math.min(0.9, 0.6 + (Math.abs(score) / 15));
        } else if (score > 1) {
            decision = 'weak_bullish';
            action = 'cautious_long';
            confidence = 0.6;
        } else if (score < -1) {
            decision = 'weak_bearish';
            action = 'cautious_short';
            confidence = 0.6;
        } else {
            decision = 'neutral';
            action = 'wait';
            confidence = 0.5;
        }

        // Conflict penalty
        if (multiTimeframeTrend.conflicts.length > 0) {
            confidence *= 0.8;
            reasons.push('timeframe_conflicts');
        }

        return {
            decision: decision,
            action: action,
            confidence: confidence,
            score: score,
            reasons: reasons
        };
    }

    recommendStrategyDirection(filterDecision, primaryTrend, trendStrength) {
        const { action, confidence } = filterDecision;
        
        let strategyType = 'neutral';
        let positionBias = 'none';
        let aggressiveness = 'moderate';

        switch (action) {
            case 'long_bias':
                strategyType = 'trend_following';
                positionBias = 'long';
                aggressiveness = trendStrength.value > this.trendStrengthThresholds.strong ? 'aggressive' : 'moderate';
                break;
                
            case 'short_bias':
                strategyType = 'trend_following';
                positionBias = 'short';
                aggressiveness = trendStrength.value > this.trendStrengthThresholds.strong ? 'aggressive' : 'moderate';
                break;
                
            case 'cautious_long':
                strategyType = 'cautious_trend';
                positionBias = 'long';
                aggressiveness = 'conservative';
                break;
                
            case 'cautious_short':
                strategyType = 'cautious_trend';
                positionBias = 'short';
                aggressiveness = 'conservative';
                break;
                
            default:
                strategyType = 'range_trading';
                positionBias = 'none';
                aggressiveness = 'conservative';
        }

        return {
            strategyType: strategyType,
            positionBias: positionBias,
            aggressiveness: aggressiveness,
            confidence: confidence,
            recommendation: this.getStrategyRecommendation(strategyType, positionBias, aggressiveness)
        };
    }

    generateRecommendations(filterDecision, strategyDirection, data) {
        const recommendations = {};

        // VIVO recommendations
        if (filterDecision.action === 'long_bias') {
            recommendations.vivo = 'prioritizeLongSignals';
        } else if (filterDecision.action === 'short_bias') {
            recommendations.vivo = 'prioritizeShortSignals';
        } else if (filterDecision.action === 'wait') {
            recommendations.vivo = 'requireStrongerConfirmation';
        }

        // Strategy manager recommendations
        recommendations.strategiesManager = {
            primaryStrategy: strategyDirection.strategyType,
            bias: strategyDirection.positionBias,
            aggressiveness: strategyDirection.aggressiveness
        };

        // Entry gatekeeper recommendations
        if (filterDecision.confidence > 0.8) {
            recommendations.entryGatekeeper = 'normalEntry';
        } else if (filterDecision.confidence > 0.6) {
            recommendations.entryGatekeeper = 'requireAdditionalConfirmation';
        } else {
            recommendations.entryGatekeeper = 'strictValidation';
        }

        // Risk management recommendations
        if (strategyDirection.aggressiveness === 'aggressive') {
            recommendations.riskManagement = 'optimizeForTrend';
        } else if (strategyDirection.aggressiveness === 'conservative') {
            recommendations.riskManagement = 'conservativeRisk';
        }

        return recommendations;
    }

    generateNotes(primaryTrend, trendStrength, filterDecision) {
        const notes = [];

        // Primary trend note
        if (primaryTrend.direction === 'uptrend') {
            notes.push(`Güçlü uptrend (Güven: ${(primaryTrend.confidence * 100).toFixed(0)}%)`);
        } else if (primaryTrend.direction === 'downtrend') {
            notes.push(`Güçlü downtrend (Güven: ${(primaryTrend.confidence * 100).toFixed(0)}%)`);
        } else {
            notes.push('Sideways trend - net yön belirsiz');
        }

        // Strength note
        if (trendStrength.value > this.trendStrengthThresholds.strong) {
            notes.push('Trend gücü yüksek');
        } else if (trendStrength.value < this.trendStrengthThresholds.weak) {
            notes.push('Trend gücü zayıf - dikkatli olun');
        }

        // Decision note
        if (filterDecision.action === 'long_bias') {
            notes.push('Long yönlü strateji öneriliyor');
        } else if (filterDecision.action === 'short_bias') {
            notes.push('Short yönlü strateji öneriliyor');
        } else {
            notes.push('Net yön belirsiz - bekleme öneriliyor');
        }

        return notes.join('. ');
    }

    // Helper methods
    getTrendStrengthLevel(strength) {
        if (strength >= this.trendStrengthThresholds.veryStrong) return 'very_strong';
        if (strength >= this.trendStrengthThresholds.strong) return 'strong';
        if (strength >= this.trendStrengthThresholds.moderate) return 'moderate';
        if (strength >= this.trendStrengthThresholds.weak) return 'weak';
        return 'very_weak';
    }

    updateTrendHistory(result, data) {
        this.trendHistory.push({
            timestamp: Date.now(),
            primaryTrend: result.primaryTrend.direction,
            trendStrength: result.trendStrength.value,
            filterDecision: result.filterDecision.action,
            confidence: result.filterDecision.confidence,
            timeframe: data.timeframe
        });

        if (this.trendHistory.length > this.maxHistorySize) {
            this.trendHistory = this.trendHistory.slice(-this.maxHistorySize);
        }
    }

    calculateTrendDuration(primaryTrend) {
        if (this.trendHistory.length < 2) return 0;

        const recentTrends = this.trendHistory.slice(-10);
        const currentDirection = primaryTrend.direction;
        
        let duration = 0;
        for (let i = recentTrends.length - 1; i >= 0; i--) {
            if (recentTrends[i].primaryTrend === currentDirection) {
                duration++;
            } else {
                break;
            }
        }

        return duration;
    }

    getDefaultResult() {
        return {
            primaryTrend: {
                direction: 'sideways',
                score: 0,
                confidence: 0.5,
                factors: [],
                strength: 0
            },
            trendStrength: {
                value: 0,
                level: 'very_weak',
                factors: [],
                reliability: 0
            },
            multiTimeframeTrend: {
                alignment: 'unknown',
                score: 0,
                trends: {},
                conflicts: [],
                dominantTimeframe: null,
                consistency: 0
            },
            trendQuality: {
                score: 5,
                level: 'moderate',
                factors: [],
                recommendation: 'use_caution'
            },
            confirmationSignals: {
                confirmations: [],
                contradictions: [],
                score: 0,
                strength: 'weak',
                reliability: 0
            },
            momentumAnalysis: {
                score: 0,
                level: 'neutral',
                factors: [],
                alignment: 'neutral',
                sustainability: 'unknown'
            },
            sustainability: null,
            filterDecision: {
                decision: 'neutral',
                action: 'wait',
                confidence: 0.5,
                score: 0,
                reasons: ['insufficient_data']
            },
            strategyDirection: {
                strategyType: 'neutral',
                positionBias: 'none',
                aggressiveness: 'conservative',
                confidence: 0.5,
                recommendation: 'wait_for_clear_trend'
            },
            signalAlignment: null,
            recommendations: {},
            notes: "Trend filtresi analizi yapılamadı - yetersiz veri",
            metadata: {
                error: true,
                analysisTimestamp: Date.now()
            }
        };
    }

    getModuleInfo() {
        return {
            name: 'TrendFilter',
            version: '1.0.0',
            description: 'Trend direction filtering ve strateji yönü belirleme',
            inputs: [
                'price', 'ema20', 'ema50', 'ema200', 'sma20', 'sma50', 'sma200',
                'adx', 'macd', 'rsi', 'volume', 'higherHighs', 'higherLows',
                'lowerHighs', 'lowerLows', 'timeframe', 'multiTimeframeData',
                'priceAction', 'momentum', 'volatility'
            ],
            outputs: [
                'primaryTrend', 'trendStrength', 'multiTimeframeTrend', 'trendQuality',
                'confirmationSignals', 'momentumAnalysis', 'sustainability',
                'filterDecision', 'strategyDirection', 'signalAlignment',
                'recommendations', 'notes', 'metadata'
            ]
        };
    }
}

module.exports = TrendFilter;
