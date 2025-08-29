/**
 * 📦 falseBreakFilter.js
 * 🎯 Sahte breakout'ları filtreleyen modül
 */

const GrafikBeyniModuleBase = require('../grafikBeyniModuleBase');

class FalseBreakFilter extends GrafikBeyniModuleBase {
    constructor(config = {}) {
        super('falseBreakFilter', {
            ...config,
            scoreThreshold: 0.6,
            minBreakoutDuration: 3, // Minimum periods for valid breakout
            maxRetracementPercent: 0.5, // 50% retracement = suspicious
            volumeConfirmationThreshold: 1.3, // 1.3x average volume needed
            timeConfirmationMinutes: 15, // Minimum time to hold breakout
            liquidityThreshold: 0.001, // Minimum liquidity for valid breakout
            whipsaw: {
                maxWhipsawsPerHour: 2,
                whipsawThreshold: 0.003, // 0.3% back and forth movement
                penaltyFactor: 0.3
            },
            marketConditions: {
                lowVolatility: { threshold: 0.01, suspicionBonus: 0.2 },
                highVolatility: { threshold: 0.05, suspicionPenalty: 0.1 },
                consolidation: { minPeriods: 10, suspicionBonus: 0.3 }
            }
        });

        // False break tracking
        this.falseBreakHistory = new Map();
        this.whipsawTracker = new Map();
        this.suspiciousPatterns = new Map();
        this.marketConditionCache = new Map();
    }

    async performAnalysis(marketData) {
        try {
            const {
                symbol = 'UNKNOWN',
                timeframe = '15m',
                priceHistory = [],
                volumeHistory = [],
                currentPrice,
                breakoutData = null,
                supportResistanceLevels = [],
                liquidityData = {},
                marketVolatility = 0.02,
                trendStrength = 0.5,
                candlePatterns = [],
                orderbook = {},
                timestamp = Date.now()
            } = marketData;

            if (!breakoutData || !breakoutData.detected) {
                return {
                    signals: [],
                    metadata: {
                        moduleName: this.name,
                        filterActive: false,
                        reason: 'No breakout to analyze'
                    }
                };
            }

            // Historical false break analizi
            const historicalAnalysis = this.analyzeHistoricalFalseBreaks(
                symbol,
                breakoutData,
                supportResistanceLevels
            );
            
            // Structural weakness tespiti
            const structuralAnalysis = this.analyzeStructuralWeakness(
                breakoutData,
                priceHistory,
                volumeHistory,
                supportResistanceLevels
            );
            
            // Market condition evaluation
            const marketConditionAnalysis = this.evaluateMarketConditions(
                marketVolatility,
                trendStrength,
                liquidityData,
                priceHistory
            );
            
            // Volume pattern analysis for authenticity
            const volumeAuthenticityCheck = this.checkVolumeAuthenticity(
                volumeHistory,
                breakoutData,
                liquidityData
            );
            
            // Price action validation
            const priceActionValidation = this.validatePriceAction(
                priceHistory,
                breakoutData,
                candlePatterns
            );
            
            // Whipsaw detection
            const whipsawAnalysis = this.detectWhipsawPattern(
                symbol,
                priceHistory,
                breakoutData,
                timestamp
            );
            
            // Orderbook manipulation check
            const manipulationCheck = this.checkOrderbookManipulation(
                orderbook,
                breakoutData,
                liquidityData
            );
            
            // Combine all analyses for final score
            const falseBreakProbability = this.calculateFalseBreakProbability({
                historical: historicalAnalysis,
                structural: structuralAnalysis,
                marketCondition: marketConditionAnalysis,
                volumeAuthenticity: volumeAuthenticityCheck,
                priceAction: priceActionValidation,
                whipsaw: whipsawAnalysis,
                manipulation: manipulationCheck
            });
            
            // Update tracking
            this.updateFalseBreakTracking(symbol, breakoutData, falseBreakProbability, timestamp);
            
            // Generate filtering decision
            const filterDecision = this.makeFilterDecision(
                falseBreakProbability,
                breakoutData,
                marketConditionAnalysis
            );
            
            // Create signals based on filter decision
            const signals = this.generateFilterSignals(
                filterDecision,
                falseBreakProbability,
                breakoutData
            );

            return {
                signals,
                metadata: {
                    moduleName: this.name,
                    filterActive: true,
                    falseBreakProbability: falseBreakProbability.overall,
                    filterDecision: filterDecision.action,
                    confidence: filterDecision.confidence,
                    analysisDetails: {
                        historical: historicalAnalysis,
                        structural: structuralAnalysis,
                        marketCondition: marketConditionAnalysis,
                        volumeAuthenticity: volumeAuthenticityCheck,
                        priceAction: priceActionValidation,
                        whipsaw: whipsawAnalysis,
                        manipulation: manipulationCheck
                    },
                    notify: this.generateNotifications(filterDecision, falseBreakProbability)
                }
            };

        } catch (error) {
            console.error('❌ FalseBreakFilter analysis error:', error);
            return { signals: [], error: error.message };
        }
    }

    /**
     * Historical false break analizi
     */
    analyzeHistoricalFalseBreaks(symbol, breakoutData, srLevels) {
        const history = this.falseBreakHistory.get(symbol) || [];
        
        const analysis = {
            recentFalseBreakRate: 0,
            levelSuccessRate: 1.0,
            patternSuccessRate: 1.0,
            timeOfDayBias: 0,
            suspicionScore: 0
        };
        
        if (history.length === 0) {
            return { ...analysis, suspicionScore: 0.3 }; // Neutral suspicion for no history
        }
        
        // Calculate recent false break rate (last 20 breakouts)
        const recentHistory = history.slice(-20);
        const falseBreaks = recentHistory.filter(h => h.wasFalse).length;
        analysis.recentFalseBreakRate = falseBreaks / recentHistory.length;
        
        // Level-specific success rate
        const levelType = breakoutData.type;
        const levelBreaks = recentHistory.filter(h => h.type === levelType);
        if (levelBreaks.length > 0) {
            const levelFalseBreaks = levelBreaks.filter(h => h.wasFalse).length;
            analysis.levelSuccessRate = 1 - (levelFalseBreaks / levelBreaks.length);
        }
        
        // Pattern-specific success rate
        const patternBreaks = recentHistory.filter(h => h.direction === breakoutData.direction);
        if (patternBreaks.length > 0) {
            const patternFalseBreaks = patternBreaks.filter(h => h.wasFalse).length;
            analysis.patternSuccessRate = 1 - (patternFalseBreaks / patternBreaks.length);
        }
        
        // Time of day bias (simplified)
        analysis.timeOfDayBias = this.calculateTimeOfDayBias(history, new Date());
        
        // Overall suspicion score
        analysis.suspicionScore = (
            analysis.recentFalseBreakRate * 0.4 +
            (1 - analysis.levelSuccessRate) * 0.3 +
            (1 - analysis.patternSuccessRate) * 0.2 +
            analysis.timeOfDayBias * 0.1
        );
        
        return analysis;
    }

    /**
     * Structural weakness analizi
     */
    analyzeStructuralWeakness(breakoutData, priceHistory, volumeHistory, srLevels) {
        const analysis = {
            weakVolume: false,
            quickReversal: false,
            insufficientMomentum: false,
            levelWeakness: false,
            suspicionScore: 0
        };
        
        // Volume weakness check
        const recentVolume = volumeHistory.slice(-3);
        const avgVolume = volumeHistory.slice(-20).reduce((a, b) => a + b, 0) / 20;
        const currentAvgVolume = recentVolume.reduce((a, b) => a + b, 0) / recentVolume.length;
        
        if (currentAvgVolume < avgVolume * this.config.volumeConfirmationThreshold) {
            analysis.weakVolume = true;
        }
        
        // Quick reversal check
        const recentPrices = priceHistory.slice(-this.config.minBreakoutDuration);
        const breakoutLevel = breakoutData.level;
        const maxRetracement = this.calculateMaxRetracement(recentPrices, breakoutLevel, breakoutData.direction);
        
        if (maxRetracement > this.config.maxRetracementPercent) {
            analysis.quickReversal = true;
        }
        
        // Momentum check
        const momentum = this.calculateBreakoutMomentum(priceHistory, breakoutData);
        if (momentum < 0.3) {
            analysis.insufficientMomentum = true;
        }
        
        // Level strength check
        const relevantLevel = this.findRelevantLevel(srLevels, breakoutData.level);
        if (relevantLevel && relevantLevel.strength < 0.5) {
            analysis.levelWeakness = true;
        }
        
        // Calculate suspicion score
        const weaknessCount = Object.values(analysis).filter(v => v === true).length;
        analysis.suspicionScore = weaknessCount * 0.25; // Each weakness adds 25%
        
        return analysis;
    }

    /**
     * Market condition evaluation
     */
    evaluateMarketConditions(volatility, trendStrength, liquidityData, priceHistory) {
        const analysis = {
            volatilityLevel: 'normal',
            liquidityLevel: 'normal',
            trendQuality: 'normal',
            consolidationPhase: false,
            suspicionScore: 0
        };
        
        // Volatility assessment
        if (volatility < this.config.marketConditions.lowVolatility.threshold) {
            analysis.volatilityLevel = 'low';
            analysis.suspicionScore += this.config.marketConditions.lowVolatility.suspicionBonus;
        } else if (volatility > this.config.marketConditions.highVolatility.threshold) {
            analysis.volatilityLevel = 'high';
            analysis.suspicionScore -= this.config.marketConditions.highVolatility.suspicionPenalty;
        }
        
        // Liquidity assessment
        const liquidityScore = this.assessLiquidity(liquidityData);
        if (liquidityScore < this.config.liquidityThreshold) {
            analysis.liquidityLevel = 'low';
            analysis.suspicionScore += 0.2;
        } else if (liquidityScore > 0.01) {
            analysis.liquidityLevel = 'high';
            analysis.suspicionScore -= 0.1;
        }
        
        // Trend quality
        if (trendStrength < 0.3) {
            analysis.trendQuality = 'weak';
            analysis.suspicionScore += 0.15;
        } else if (trendStrength > 0.7) {
            analysis.trendQuality = 'strong';
            analysis.suspicionScore -= 0.1;
        }
        
        // Consolidation phase detection
        const isConsolidating = this.detectConsolidationPhase(priceHistory);
        if (isConsolidating) {
            analysis.consolidationPhase = true;
            analysis.suspicionScore += this.config.marketConditions.consolidation.suspicionBonus;
        }
        
        // Normalize suspicion score
        analysis.suspicionScore = Math.max(0, Math.min(1, analysis.suspicionScore));
        
        return analysis;
    }

    /**
     * Volume authenticity kontrolü
     */
    checkVolumeAuthenticity(volumeHistory, breakoutData, liquidityData) {
        const analysis = {
            volumeProfile: 'normal',
            volumeSpikes: [],
            organicVolume: true,
            suspicionScore: 0
        };
        
        const avgVolume = volumeHistory.slice(-20).reduce((a, b) => a + b, 0) / 20;
        const breakoutVolume = volumeHistory[volumeHistory.length - 1];
        
        // Detect unusual volume spikes
        analysis.volumeSpikes = this.detectVolumeSpikes(volumeHistory, avgVolume);
        
        // Check if volume profile looks organic
        const volumeDistribution = this.analyzeVolumeDistribution(volumeHistory.slice(-10));
        analysis.organicVolume = this.isVolumeDistributionOrganic(volumeDistribution);
        
        // Volume profile classification
        const volumeRatio = breakoutVolume / avgVolume;
        if (volumeRatio > 5) {
            analysis.volumeProfile = 'explosive';
            analysis.suspicionScore += 0.3; // Very high volume can be manipulation
        } else if (volumeRatio > 2) {
            analysis.volumeProfile = 'strong';
            analysis.suspicionScore -= 0.1; // Good confirmation
        } else if (volumeRatio < 1.2) {
            analysis.volumeProfile = 'weak';
            analysis.suspicionScore += 0.4; // Weak volume is suspicious
        }
        
        // Check for pump-and-dump patterns
        if (this.detectPumpAndDumpPattern(volumeHistory)) {
            analysis.suspicionScore += 0.5;
        }
        
        if (!analysis.organicVolume) {
            analysis.suspicionScore += 0.3;
        }
        
        // Normalize
        analysis.suspicionScore = Math.max(0, Math.min(1, analysis.suspicionScore));
        
        return analysis;
    }

    /**
     * Price action validation
     */
    validatePriceAction(priceHistory, breakoutData, candlePatterns) {
        const analysis = {
            breakoutCandle: 'normal',
            followThrough: 'normal',
            gapBehavior: 'normal',
            reversalSignals: [],
            suspicionScore: 0
        };
        
        // Analyze breakout candle
        const breakoutCandle = this.analyzeBreakoutCandle(priceHistory, breakoutData);
        analysis.breakoutCandle = breakoutCandle.type;
        analysis.suspicionScore += breakoutCandle.suspicion;
        
        // Follow-through analysis
        const followThrough = this.analyzeFollowThrough(priceHistory, breakoutData);
        analysis.followThrough = followThrough.quality;
        analysis.suspicionScore += followThrough.suspicion;
        
        // Gap behavior
        const gapAnalysis = this.analyzeGapBehavior(priceHistory, breakoutData);
        analysis.gapBehavior = gapAnalysis.type;
        analysis.suspicionScore += gapAnalysis.suspicion;
        
        // Reversal signals in candle patterns
        analysis.reversalSignals = this.identifyReversalSignals(candlePatterns, breakoutData);
        analysis.suspicionScore += analysis.reversalSignals.length * 0.1;
        
        // Normalize
        analysis.suspicionScore = Math.max(0, Math.min(1, analysis.suspicionScore));
        
        return analysis;
    }

    /**
     * Whipsaw pattern tespiti
     */
    detectWhipsawPattern(symbol, priceHistory, breakoutData, timestamp) {
        const analysis = {
            whipsawDetected: false,
            whipsawCount: 0,
            timePattern: 'normal',
            suspicionScore: 0
        };
        
        // Get whipsaw history for symbol
        const whipsawHistory = this.whipsawTracker.get(symbol) || [];
        
        // Check for recent whipsaws
        const oneHourAgo = timestamp - (60 * 60 * 1000);
        const recentWhipsaws = whipsawHistory.filter(w => w.timestamp > oneHourAgo);
        analysis.whipsawCount = recentWhipsaws.length;
        
        // Detect current whipsaw
        const currentWhipsaw = this.isCurrentWhipsaw(priceHistory, breakoutData);
        if (currentWhipsaw) {
            analysis.whipsawDetected = true;
            analysis.suspicionScore += 0.4;
            
            // Add to tracker
            whipsawHistory.push({
                timestamp,
                level: breakoutData.level,
                direction: breakoutData.direction,
                magnitude: currentWhipsaw.magnitude
            });
            
            this.whipsawTracker.set(symbol, whipsawHistory);
        }
        
        // Penalty for multiple whipsaws
        if (analysis.whipsawCount >= this.config.whipsaw.maxWhipsawsPerHour) {
            analysis.suspicionScore += this.config.whipsaw.penaltyFactor;
        }
        
        // Time pattern analysis
        analysis.timePattern = this.analyzeWhipsawTimePattern(recentWhipsaws);
        
        return analysis;
    }

    /**
     * Orderbook manipulation kontrolü
     */
    checkOrderbookManipulation(orderbook, breakoutData, liquidityData) {
        const analysis = {
            wallRemoval: false,
            spoofing: false,
            liquidityDistortion: false,
            suspicionScore: 0
        };
        
        if (!orderbook.bids || !orderbook.asks) {
            return analysis;
        }
        
        // Check for wall removal (large orders disappearing at key levels)
        analysis.wallRemoval = this.detectWallRemoval(orderbook, breakoutData);
        if (analysis.wallRemoval) analysis.suspicionScore += 0.3;
        
        // Check for spoofing (fake orders)
        analysis.spoofing = this.detectSpoofing(orderbook);
        if (analysis.spoofing) analysis.suspicionScore += 0.4;
        
        // Check for liquidity distortion
        analysis.liquidityDistortion = this.detectLiquidityDistortion(orderbook, liquidityData);
        if (analysis.liquidityDistortion) analysis.suspicionScore += 0.2;
        
        return analysis;
    }

    /**
     * False break probability hesaplama
     */
    calculateFalseBreakProbability(analyses) {
        const weights = {
            historical: 0.25,
            structural: 0.25,
            marketCondition: 0.15,
            volumeAuthenticity: 0.15,
            priceAction: 0.10,
            whipsaw: 0.05,
            manipulation: 0.05
        };
        
        const overall = (
            analyses.historical.suspicionScore * weights.historical +
            analyses.structural.suspicionScore * weights.structural +
            analyses.marketCondition.suspicionScore * weights.marketCondition +
            analyses.volumeAuthenticity.suspicionScore * weights.volumeAuthenticity +
            analyses.priceAction.suspicionScore * weights.priceAction +
            analyses.whipsaw.suspicionScore * weights.whipsaw +
            analyses.manipulation.suspicionScore * weights.manipulation
        );
        
        return {
            overall: Math.max(0, Math.min(1, overall)),
            breakdown: {
                historical: analyses.historical.suspicionScore,
                structural: analyses.structural.suspicionScore,
                marketCondition: analyses.marketCondition.suspicionScore,
                volumeAuthenticity: analyses.volumeAuthenticity.suspicionScore,
                priceAction: analyses.priceAction.suspicionScore,
                whipsaw: analyses.whipsaw.suspicionScore,
                manipulation: analyses.manipulation.suspicionScore
            }
        };
    }

    /**
     * Filter decision oluştur
     */
    makeFilterDecision(falseBreakProbability, breakoutData, marketCondition) {
        const probability = falseBreakProbability.overall;
        
        let action, confidence;
        
        if (probability >= 0.8) {
            action = 'reject';
            confidence = 0.9;
        } else if (probability >= 0.6) {
            action = 'caution';
            confidence = 0.7;
        } else if (probability >= 0.4) {
            action = 'monitor';
            confidence = 0.6;
        } else {
            action = 'accept';
            confidence = 1 - probability;
        }
        
        // Adjust based on market conditions
        if (marketCondition.liquidityLevel === 'low' && action === 'accept') {
            action = 'monitor';
            confidence *= 0.8;
        }
        
        return {
            action,
            confidence,
            probability,
            reasoning: this.generateFilterReasoning(falseBreakProbability, action)
        };
    }

    /**
     * Filter sinyalleri oluştur
     */
    generateFilterSignals(filterDecision, falseBreakProbability, breakoutData) {
        const signals = [];
        
        if (filterDecision.action === 'reject') {
            signals.push(this.createSignal(
                'false-breakout-detected',
                falseBreakProbability.overall,
                {
                    variant: 'high_probability',
                    riskLevel: 'high',
                    analysis: { filterDecision, falseBreakProbability },
                    recommendations: ['Avoid trading this breakout', 'High false breakout probability'],
                    confirmationChain: ['false_breakout_high_prob']
                }
            ));
        } else if (filterDecision.action === 'caution') {
            signals.push(this.createSignal(
                'breakout-caution',
                1 - falseBreakProbability.overall,
                {
                    variant: 'moderate_risk',
                    riskLevel: 'medium',
                    analysis: { filterDecision, falseBreakProbability },
                    recommendations: ['Use smaller position size', 'Tight stop loss recommended'],
                    confirmationChain: ['false_breakout_moderate_prob']
                }
            ));
        } else if (filterDecision.action === 'accept') {
            signals.push(this.createSignal(
                'breakout-validated',
                filterDecision.confidence,
                {
                    variant: 'low_false_risk',
                    riskLevel: 'low',
                    analysis: { filterDecision, falseBreakProbability },
                    recommendations: ['Breakout appears genuine', 'False break risk is low'],
                    confirmationChain: ['false_breakout_low_prob']
                }
            ));
        }
        
        return signals;
    }

    /**
     * Helper Methods (simplified implementations)
     */
    calculateTimeOfDayBias(history, currentTime) { return 0.1; }
    calculateMaxRetracement(prices, level, direction) { return 0.2; }
    calculateBreakoutMomentum(prices, breakout) { return 0.6; }
    findRelevantLevel(levels, price) { return levels.find(l => Math.abs(l.price - price) < price * 0.001); }
    assessLiquidity(liquidityData) { return 0.005; }
    detectConsolidationPhase(prices) { return false; }
    detectVolumeSpikes(volumes, avgVolume) { return []; }
    analyzeVolumeDistribution(volumes) { return {}; }
    isVolumeDistributionOrganic(distribution) { return true; }
    detectPumpAndDumpPattern(volumes) { return false; }
    analyzeBreakoutCandle(prices, breakout) { return { type: 'normal', suspicion: 0.1 }; }
    analyzeFollowThrough(prices, breakout) { return { quality: 'normal', suspicion: 0.1 }; }
    analyzeGapBehavior(prices, breakout) { return { type: 'normal', suspicion: 0.1 }; }
    identifyReversalSignals(patterns, breakout) { return []; }
    isCurrentWhipsaw(prices, breakout) { return null; }
    analyzeWhipsawTimePattern(whipsaws) { return 'normal'; }
    detectWallRemoval(orderbook, breakout) { return false; }
    detectSpoofing(orderbook) { return false; }
    detectLiquidityDistortion(orderbook, liquidityData) { return false; }

    updateFalseBreakTracking(symbol, breakout, probability, timestamp) {
        if (!this.falseBreakHistory.has(symbol)) {
            this.falseBreakHistory.set(symbol, []);
        }
        
        const history = this.falseBreakHistory.get(symbol);
        history.push({
            timestamp,
            level: breakout.level,
            direction: breakout.direction,
            type: breakout.type,
            falseBreakProbability: probability.overall,
            wasFalse: false // Will be updated later by feedback system
        });
        
        // Keep last 50 breakouts
        if (history.length > 50) {
            history.shift();
        }
    }

    generateNotifications(filterDecision, falseBreakProbability) {
        return {
            grafikBeyni: {
                filterDecision: filterDecision.action,
                falseBreakProbability: falseBreakProbability.overall
            },
            volumeConfirmBreakout: {
                filterActive: true,
                decision: filterDecision.action
            },
            formPatternRecognizer: {
                breakoutValidation: filterDecision.action,
                confidence: filterDecision.confidence
            },
            vivo: {
                breakoutFiltered: filterDecision.action === 'reject',
                riskAdjustment: filterDecision.action === 'caution'
            }
        };
    }

    generateFilterReasoning(probability, action) {
        const reasons = [];
        
        const breakdown = probability.breakdown;
        
        if (breakdown.historical > 0.5) reasons.push('High historical false break rate');
        if (breakdown.structural > 0.5) reasons.push('Structural weaknesses detected');
        if (breakdown.volumeAuthenticity > 0.5) reasons.push('Suspicious volume pattern');
        if (breakdown.manipulation > 0.3) reasons.push('Potential manipulation detected');
        
        if (reasons.length === 0) {
            reasons.push('Breakout appears genuine');
        }
        
        return reasons;
    }

    /**
     * Main interface function
     */
    async validateBreakout(marketData) {
        const result = await this.analyze(marketData);
        return {
            valid: result.metadata?.filterDecision !== 'reject',
            confidence: result.metadata?.confidence || 0.5,
            action: result.metadata?.filterDecision || 'monitor'
        };
    }
}

module.exports = FalseBreakFilter;
