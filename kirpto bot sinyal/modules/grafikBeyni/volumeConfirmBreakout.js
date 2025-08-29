/**
 * 📦 volumeConfirmBreakout.js
 * 🎯 Volume ile breakout doğrulaması yapan modül
 */

const GrafikBeyniModuleBase = require('../grafikBeyniModuleBase');

class VolumeConfirmBreakout extends GrafikBeyniModuleBase {
    constructor(config = {}) {
        super('volumeConfirmBreakout', {
            ...config,
            scoreThreshold: 0.7,
            minVolumeMultiplier: 1.5, // Minimum 1.5x average volume for confirmation
            strongVolumeMultiplier: 2.5, // 2.5x+ for strong confirmation
            volumeDecayPeriods: 5, // Look back 5 periods for volume comparison
            breakoutPriceThreshold: 0.002, // 0.2% price movement for breakout
            sustainedBreakoutPeriods: 3, // Periods to maintain breakout
            volumePatterns: {
                'accumulation': { minPeriods: 10, volumeRatio: 0.8 },
                'distribution': { minPeriods: 8, volumeRatio: 1.2 },
                'climax': { volumeMultiplier: 3.0, sustainPeriods: 2 },
                'confirmation': { volumeMultiplier: 1.5, priceConfirm: true }
            }
        });

        // Breakout tracking
        this.activeBreakouts = new Map();
        this.volumeProfileCache = new Map();
        this.breakoutHistory = new Map();
    }

    async performAnalysis(marketData) {
        try {
            const {
                symbol = 'UNKNOWN',
                timeframe = '15m',
                priceHistory = [],
                volumeHistory = [],
                currentPrice,
                currentVolume,
                recentHigh,
                recentLow,
                supportResistanceLevels = [],
                formationBreakout = null,
                trendDirection = 'neutral',
                candlePatterns = [],
                timestamp = Date.now()
            } = marketData;

            if (priceHistory.length < 20 || volumeHistory.length < 20) {
                return { signals: [], metadata: { error: 'Insufficient data for volume analysis' } };
            }

            // Volume profil analizi
            const volumeProfile = this.analyzeVolumeProfile(volumeHistory, priceHistory);
            
            // Breakout tespiti
            const breakoutDetection = this.detectBreakouts(
                priceHistory,
                volumeHistory,
                currentPrice,
                supportResistanceLevels,
                formationBreakout
            );
            
            // Volume pattern analizi
            const volumePatternAnalysis = this.analyzeVolumePatterns(
                volumeHistory,
                priceHistory
            );
            
            // Confirmation strength hesaplama
            const confirmationAnalysis = this.analyzeConfirmationStrength(
                breakoutDetection,
                volumeProfile,
                volumePatternAnalysis,
                currentVolume
            );
            
            // Sustained breakout kontrolü
            const sustainabilityCheck = this.checkBreakoutSustainability(
                breakoutDetection,
                priceHistory.slice(-this.config.sustainedBreakoutPeriods),
                volumeHistory.slice(-this.config.sustainedBreakoutPeriods)
            );
            
            // False breakout risk assessment
            const falseBreakoutRisk = this.assessFalseBreakoutRisk(
                breakoutDetection,
                volumeProfile,
                trendDirection,
                candlePatterns
            );
            
            // Update tracking
            this.updateBreakoutTracking(symbol, breakoutDetection, timestamp);
            
            // Generate signals based on analysis
            const signals = this.generateBreakoutSignals(
                breakoutDetection,
                confirmationAnalysis,
                sustainabilityCheck,
                falseBreakoutRisk
            );

            return {
                signals,
                metadata: {
                    moduleName: this.name,
                    breakoutDetected: breakoutDetection.detected,
                    breakoutDirection: breakoutDetection.direction,
                    volumeConfirmation: confirmationAnalysis.level,
                    confirmationScore: confirmationAnalysis.score,
                    volumeProfile,
                    sustainabilityCheck,
                    falseBreakoutRisk,
                    volumePatterns: volumePatternAnalysis,
                    notify: this.generateNotifications(breakoutDetection, confirmationAnalysis)
                }
            };

        } catch (error) {
            console.error('❌ VolumeConfirmBreakout analysis error:', error);
            return { signals: [], error: error.message };
        }
    }

    /**
     * Volume profil analizi
     */
    analyzeVolumeProfile(volumeHistory, priceHistory) {
        const profile = {
            averageVolume: this.calculateAverageVolume(volumeHistory),
            recentAverageVolume: this.calculateRecentAverageVolume(volumeHistory),
            volumeTrend: this.analyzeVolumeTrend(volumeHistory),
            volumeDistribution: this.analyzeVolumeDistribution(volumeHistory, priceHistory),
            currentVolumeRatio: null,
            volumeSpikes: this.identifyVolumeSpikes(volumeHistory),
            volumeDivergence: this.checkVolumeDivergence(volumeHistory, priceHistory)
        };

        const currentVolume = volumeHistory[volumeHistory.length - 1];
        profile.currentVolumeRatio = currentVolume / profile.averageVolume;

        return profile;
    }

    /**
     * Breakout tespiti
     */
    detectBreakouts(priceHistory, volumeHistory, currentPrice, srLevels, formationBreakout) {
        const breakouts = [];
        
        // Level-based breakouts
        const levelBreakouts = this.detectLevelBreakouts(
            priceHistory, 
            currentPrice, 
            srLevels
        );
        breakouts.push(...levelBreakouts);
        
        // Formation-based breakouts
        if (formationBreakout) {
            const formationBreakoutDetail = this.analyzeFormationBreakout(
                formationBreakout,
                priceHistory,
                volumeHistory
            );
            if (formationBreakoutDetail) {
                breakouts.push(formationBreakoutDetail);
            }
        }
        
        // Price action breakouts
        const priceActionBreakouts = this.detectPriceActionBreakouts(priceHistory);
        breakouts.push(...priceActionBreakouts);
        
        // Return most significant breakout
        const primaryBreakout = this.selectPrimaryBreakout(breakouts);
        
        return primaryBreakout || {
            detected: false,
            direction: 'none',
            type: 'none',
            strength: 0,
            level: null
        };
    }

    /**
     * Level-based breakout tespiti
     */
    detectLevelBreakouts(priceHistory, currentPrice, srLevels) {
        const breakouts = [];
        const recentPrices = priceHistory.slice(-5);
        const previousPrice = priceHistory[priceHistory.length - 2];
        
        srLevels.forEach(level => {
            const levelPrice = level.price;
            const threshold = levelPrice * this.config.breakoutPriceThreshold;
            
            // Resistance breakout (bullish)
            if (level.type.includes('resistance')) {
                if (previousPrice <= levelPrice && currentPrice > levelPrice + threshold) {
                    breakouts.push({
                        detected: true,
                        direction: 'bullish',
                        type: 'resistance_breakout',
                        level: levelPrice,
                        strength: level.strength || 0.5,
                        priceMove: (currentPrice - levelPrice) / levelPrice,
                        metadata: {
                            levelType: level.type,
                            levelSource: level.source,
                            touchCount: level.touchCount
                        }
                    });
                }
            }
            
            // Support breakdown (bearish)
            if (level.type.includes('support')) {
                if (previousPrice >= levelPrice && currentPrice < levelPrice - threshold) {
                    breakouts.push({
                        detected: true,
                        direction: 'bearish',
                        type: 'support_breakdown',
                        level: levelPrice,
                        strength: level.strength || 0.5,
                        priceMove: (levelPrice - currentPrice) / levelPrice,
                        metadata: {
                            levelType: level.type,
                            levelSource: level.source,
                            touchCount: level.touchCount
                        }
                    });
                }
            }
        });
        
        return breakouts;
    }

    /**
     * Volume pattern analizi
     */
    analyzeVolumePatterns(volumeHistory, priceHistory) {
        const patterns = {
            accumulation: this.detectAccumulationPattern(volumeHistory, priceHistory),
            distribution: this.detectDistributionPattern(volumeHistory, priceHistory),
            climax: this.detectClimaxPattern(volumeHistory, priceHistory),
            exhaustion: this.detectExhaustionPattern(volumeHistory, priceHistory),
            confirmation: this.detectConfirmationPattern(volumeHistory, priceHistory)
        };

        // Overall pattern classification
        const dominantPattern = this.classifyDominantVolumePattern(patterns);
        
        return {
            ...patterns,
            dominantPattern,
            patternStrength: this.calculatePatternStrength(patterns)
        };
    }

    /**
     * Accumulation pattern detection
     */
    detectAccumulationPattern(volumeHistory, priceHistory) {
        const config = this.config.volumePatterns.accumulation;
        const period = Math.min(config.minPeriods, volumeHistory.length);
        
        const recentVolumes = volumeHistory.slice(-period);
        const recentPrices = priceHistory.slice(-period);
        
        // Low volume with sideways price action
        const avgVolume = this.calculateAverageVolume(volumeHistory.slice(-period * 2, -period));
        const currentAvgVolume = this.calculateAverageVolume(recentVolumes);
        
        const volumeRatio = currentAvgVolume / avgVolume;
        const priceVolatility = this.calculateVolatility(recentPrices);
        
        const isAccumulation = volumeRatio <= config.volumeRatio && priceVolatility < 0.02;
        
        return {
            detected: isAccumulation,
            strength: isAccumulation ? Math.min(1 - volumeRatio, 1) : 0,
            duration: isAccumulation ? period : 0,
            characteristics: {
                volumeRatio,
                priceVolatility,
                avgVolume: currentAvgVolume
            }
        };
    }

    /**
     * Distribution pattern detection
     */
    detectDistributionPattern(volumeHistory, priceHistory) {
        const config = this.config.volumePatterns.distribution;
        const period = Math.min(config.minPeriods, volumeHistory.length);
        
        const recentVolumes = volumeHistory.slice(-period);
        const recentPrices = priceHistory.slice(-period);
        
        // High volume with sideways/declining price
        const avgVolume = this.calculateAverageVolume(volumeHistory.slice(-period * 2, -period));
        const currentAvgVolume = this.calculateAverageVolume(recentVolumes);
        
        const volumeRatio = currentAvgVolume / avgVolume;
        const priceDirection = this.calculatePriceDirection(recentPrices);
        
        const isDistribution = volumeRatio >= config.volumeRatio && priceDirection <= 0;
        
        return {
            detected: isDistribution,
            strength: isDistribution ? Math.min(volumeRatio / 2, 1) : 0,
            duration: isDistribution ? period : 0,
            characteristics: {
                volumeRatio,
                priceDirection,
                avgVolume: currentAvgVolume
            }
        };
    }

    /**
     * Confirmation strength analizi
     */
    analyzeConfirmationStrength(breakoutDetection, volumeProfile, volumePatterns, currentVolume) {
        if (!breakoutDetection.detected) {
            return {
                level: 'none',
                score: 0,
                factors: {}
            };
        }

        const factors = {
            volumeMultiplier: volumeProfile.currentVolumeRatio,
            volumeTrend: volumeProfile.volumeTrend.direction === 'increasing' ? 0.2 : -0.1,
            patternSupport: this.assessPatternSupport(volumePatterns, breakoutDetection.direction),
            breakoutStrength: breakoutDetection.strength,
            priceMovement: Math.min(breakoutDetection.priceMove * 10, 0.3) // Cap at 30%
        };

        // Calculate overall score
        let score = 0.3; // Base score
        
        // Volume multiplier impact (most important)
        if (factors.volumeMultiplier >= this.config.strongVolumeMultiplier) {
            score += 0.4; // Strong volume
        } else if (factors.volumeMultiplier >= this.config.minVolumeMultiplier) {
            score += 0.2; // Adequate volume
        } else {
            score -= 0.2; // Weak volume
        }
        
        // Add other factors
        score += factors.volumeTrend;
        score += factors.patternSupport;
        score += factors.breakoutStrength * 0.2;
        score += factors.priceMovement;
        
        // Normalize score
        score = Math.max(0, Math.min(1, score));
        
        // Determine confirmation level
        let level;
        if (score >= 0.8) level = 'strong';
        else if (score >= 0.6) level = 'moderate';
        else if (score >= 0.4) level = 'weak';
        else level = 'none';

        return {
            level,
            score,
            factors
        };
    }

    /**
     * Breakout sustainability kontrolü
     */
    checkBreakoutSustainability(breakoutDetection, recentPrices, recentVolumes) {
        if (!breakoutDetection.detected) {
            return {
                sustainable: false,
                confidence: 0,
                factors: {}
            };
        }

        const factors = {
            priceConsistency: this.checkPriceConsistency(recentPrices, breakoutDetection),
            volumeDecay: this.checkVolumeDecay(recentVolumes),
            momentum: this.calculateMomentum(recentPrices),
            retracements: this.analyzeRetracements(recentPrices, breakoutDetection.level)
        };

        // Calculate sustainability confidence
        let confidence = 0.5; // Base confidence
        
        confidence += factors.priceConsistency * 0.3;
        confidence += (1 - factors.volumeDecay) * 0.2; // Less decay = more sustainable
        confidence += factors.momentum * 0.2;
        confidence += (1 - factors.retracements) * 0.3; // Fewer retracements = more sustainable
        
        confidence = Math.max(0, Math.min(1, confidence));
        
        const sustainable = confidence >= 0.6;

        return {
            sustainable,
            confidence,
            factors
        };
    }

    /**
     * False breakout risk değerlendirmesi
     */
    assessFalseBreakoutRisk(breakoutDetection, volumeProfile, trendDirection, candlePatterns) {
        if (!breakoutDetection.detected) {
            return {
                risk: 'none',
                score: 0,
                factors: {}
            };
        }

        const factors = {
            volumeWeakness: volumeProfile.currentVolumeRatio < this.config.minVolumeMultiplier,
            trendAlignment: this.checkTrendAlignment(breakoutDetection.direction, trendDirection),
            candleReversal: this.checkReversalCandlePatterns(candlePatterns),
            quickReversal: this.checkQuickReversal(breakoutDetection),
            historicalFakeouts: this.getHistoricalFakeoutRate(breakoutDetection.type)
        };

        // Calculate risk score
        let riskScore = 0.2; // Base risk
        
        if (factors.volumeWeakness) riskScore += 0.3;
        if (!factors.trendAlignment) riskScore += 0.2;
        if (factors.candleReversal) riskScore += 0.2;
        if (factors.quickReversal) riskScore += 0.1;
        riskScore += factors.historicalFakeouts * 0.2;
        
        riskScore = Math.max(0, Math.min(1, riskScore));
        
        // Determine risk level
        let risk;
        if (riskScore >= 0.7) risk = 'high';
        else if (riskScore >= 0.5) risk = 'medium';
        else if (riskScore >= 0.3) risk = 'low';
        else risk = 'minimal';

        return {
            risk,
            score: riskScore,
            factors
        };
    }

    /**
     * Breakout sinyalleri oluştur
     */
    generateBreakoutSignals(breakoutDetection, confirmationAnalysis, sustainabilityCheck, falseBreakoutRisk) {
        const signals = [];
        
        if (!breakoutDetection.detected) return signals;
        
        // Primary breakout signal
        const primarySignal = this.createSignal(
            'volume-confirmed-breakout',
            confirmationAnalysis.score,
            {
                variant: `${breakoutDetection.direction}_${breakoutDetection.type}`,
                riskLevel: this.calculateRiskLevel(confirmationAnalysis, falseBreakoutRisk),
                analysis: {
                    breakout: breakoutDetection,
                    confirmation: confirmationAnalysis,
                    sustainability: sustainabilityCheck,
                    falseBreakoutRisk
                },
                recommendations: this.generateBreakoutRecommendations(
                    breakoutDetection,
                    confirmationAnalysis,
                    sustainabilityCheck
                ),
                confirmationChain: this.buildBreakoutConfirmationChain(
                    breakoutDetection,
                    confirmationAnalysis
                )
            }
        );
        
        signals.push(primarySignal);
        
        // Add warning signals if needed
        if (falseBreakoutRisk.risk === 'high') {
            const warningSignal = this.createSignal(
                'false-breakout-warning',
                falseBreakoutRisk.score,
                {
                    variant: 'high_risk',
                    riskLevel: 'high',
                    analysis: { falseBreakoutRisk },
                    recommendations: ['Caution: High false breakout risk detected'],
                    confirmationChain: ['false_breakout_risk']
                }
            );
            signals.push(warningSignal);
        }
        
        return signals;
    }

    /**
     * Helper Methods
     */
    calculateAverageVolume(volumeHistory) {
        return volumeHistory.reduce((sum, vol) => sum + vol, 0) / volumeHistory.length;
    }

    calculateRecentAverageVolume(volumeHistory) {
        const recent = volumeHistory.slice(-this.config.volumeDecayPeriods);
        return this.calculateAverageVolume(recent);
    }

    analyzeVolumeTrend(volumeHistory) {
        const recent = volumeHistory.slice(-10);
        const firstHalf = recent.slice(0, 5);
        const secondHalf = recent.slice(5);
        
        const firstAvg = this.calculateAverageVolume(firstHalf);
        const secondAvg = this.calculateAverageVolume(secondHalf);
        
        const change = (secondAvg - firstAvg) / firstAvg;
        
        return {
            direction: change > 0.1 ? 'increasing' : change < -0.1 ? 'decreasing' : 'stable',
            magnitude: Math.abs(change),
            change
        };
    }

    analyzeVolumeDistribution(volumeHistory, priceHistory) {
        // Simplified volume distribution analysis
        return {
            highVolumePercentage: 0.3,
            mediumVolumePercentage: 0.4,
            lowVolumePercentage: 0.3
        };
    }

    identifyVolumeSpikes(volumeHistory) {
        const avgVolume = this.calculateAverageVolume(volumeHistory);
        const spikes = [];
        
        volumeHistory.forEach((volume, index) => {
            if (volume > avgVolume * 2) {
                spikes.push({
                    index,
                    volume,
                    multiplier: volume / avgVolume
                });
            }
        });
        
        return spikes;
    }

    checkVolumeDivergence(volumeHistory, priceHistory) {
        // Simplified divergence check
        return {
            detected: false,
            type: 'none',
            strength: 0
        };
    }

    selectPrimaryBreakout(breakouts) {
        if (breakouts.length === 0) return null;
        
        // Sort by strength and return strongest
        return breakouts.sort((a, b) => b.strength - a.strength)[0];
    }

    calculateVolatility(prices) {
        if (prices.length < 2) return 0;
        
        const returns = [];
        for (let i = 1; i < prices.length; i++) {
            returns.push((prices[i] - prices[i-1]) / prices[i-1]);
        }
        
        const avgReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length;
        const variance = returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length;
        
        return Math.sqrt(variance);
    }

    calculatePriceDirection(prices) {
        if (prices.length < 2) return 0;
        return (prices[prices.length - 1] - prices[0]) / prices[0];
    }

    updateBreakoutTracking(symbol, breakout, timestamp) {
        if (!this.activeBreakouts.has(symbol)) {
            this.activeBreakouts.set(symbol, []);
        }
        
        const breakouts = this.activeBreakouts.get(symbol);
        if (breakout.detected) {
            breakouts.push({
                ...breakout,
                timestamp
            });
            
            // Keep last 5 breakouts
            if (breakouts.length > 5) {
                breakouts.shift();
            }
        }
    }

    generateNotifications(breakoutDetection, confirmationAnalysis) {
        if (!breakoutDetection.detected) return {};
        
        return {
            grafikBeyni: {
                breakoutDetected: true,
                direction: breakoutDetection.direction,
                confirmationLevel: confirmationAnalysis.level
            },
            formPatternRecognizer: {
                breakoutConfirmed: confirmationAnalysis.level !== 'none',
                volumeSupport: confirmationAnalysis.score > 0.6
            },
            tpOptimizer: {
                breakoutDirection: breakoutDetection.direction,
                volumeConfirmation: confirmationAnalysis.level
            },
            exitTimingAdvisor: {
                breakoutActive: true,
                sustainability: confirmationAnalysis.score
            },
            vivo: {
                breakoutAlert: confirmationAnalysis.level === 'strong',
                direction: breakoutDetection.direction
            }
        };
    }

    calculateRiskLevel(confirmation, falseBreakoutRisk) {
        if (confirmation.level === 'strong' && falseBreakoutRisk.risk === 'minimal') {
            return 'low';
        } else if (confirmation.level === 'moderate' && falseBreakoutRisk.risk === 'low') {
            return 'medium';
        } else {
            return 'high';
        }
    }

    generateBreakoutRecommendations(breakout, confirmation, sustainability) {
        const recommendations = [];
        
        recommendations.push(`${breakout.direction} breakout detected`);
        recommendations.push(`Volume confirmation: ${confirmation.level}`);
        recommendations.push(`Breakout type: ${breakout.type}`);
        
        if (sustainability.sustainable) {
            recommendations.push('Breakout appears sustainable');
        } else {
            recommendations.push('Monitor for breakout sustainability');
        }
        
        return recommendations;
    }

    buildBreakoutConfirmationChain(breakout, confirmation) {
        const chain = [];
        
        chain.push(`breakout_${breakout.direction}`);
        chain.push(`volume_${confirmation.level}`);
        chain.push(`type_${breakout.type}`);
        
        if (confirmation.score > 0.7) chain.push('high_confidence');
        
        return chain;
    }

    // Additional helper methods (simplified)
    analyzeFormationBreakout(formation, prices, volumes) { return null; }
    detectPriceActionBreakouts(prices) { return []; }
    detectClimaxPattern(volumes, prices) { return { detected: false }; }
    detectExhaustionPattern(volumes, prices) { return { detected: false }; }
    detectConfirmationPattern(volumes, prices) { return { detected: false }; }
    classifyDominantVolumePattern(patterns) { return 'none'; }
    calculatePatternStrength(patterns) { return 0.5; }
    assessPatternSupport(patterns, direction) { return 0.1; }
    checkPriceConsistency(prices, breakout) { return 0.7; }
    checkVolumeDecay(volumes) { return 0.3; }
    calculateMomentum(prices) { return 0.6; }
    analyzeRetracements(prices, level) { return 0.2; }
    checkTrendAlignment(breakoutDir, trendDir) { return true; }
    checkReversalCandlePatterns(patterns) { return false; }
    checkQuickReversal(breakout) { return false; }
    getHistoricalFakeoutRate(type) { return 0.3; }

    /**
     * Main interface function
     */
    async getVolumeConfirmation(marketData) {
        const result = await this.analyze(marketData);
        return {
            confirmed: result.metadata?.breakoutDetected || false,
            confirmationLevel: result.metadata?.volumeConfirmation || 'none',
            score: result.metadata?.confirmationScore || 0
        };
    }
}

module.exports = VolumeConfirmBreakout;
