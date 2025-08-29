/**
 * 📦 supportResistanceMapper.js
 * 🎯 Destek ve direnç seviyelerini haritalayan modül
 */

const GrafikBeyniModuleBase = require('../grafikBeyniModuleBase');

class SupportResistanceMapper extends GrafikBeyniModuleBase {
    constructor(config = {}) {
        super('supportResistanceMapper', {
            ...config,
            scoreThreshold: 0.65,
            minTouchCount: 2,
            maxTouchDeviation: 0.002, // %0.2 deviation allowed
            proximityThreshold: 0.001, // %0.1 proximity for level clustering
            timeDecayFactor: 0.95, // Daily decay factor for old levels
            volumeWeightFactor: 1.5, // Volume impact on level strength
            minLevelStrength: 0.5,
            maxLevelsToTrack: 10,
            levelTypes: ['support', 'resistance', 'dynamic_support', 'dynamic_resistance'],
            timeframes: ['5m', '15m', '1h', '4h', '1d']
        });

        // Level tracking
        this.activeLevels = new Map();
        this.levelHistory = new Map();
        this.dynamicLevels = new Map(); // Moving averages as dynamic S/R
        this.levelClusters = new Map();
    }

    async performAnalysis(marketData) {
        try {
            const {
                symbol = 'UNKNOWN',
                timeframe = '15m',
                priceHistory = [],
                volumeHistory = [],
                currentPrice,
                highsLows = {},
                movingAverages = {},
                orderbook = {},
                recentSwings = [],
                priceAction = {},
                timestamp = Date.now()
            } = marketData;

            if (priceHistory.length < 20) {
                return { signals: [], metadata: { error: 'Insufficient price history' } };
            }

            // Historical S/R level detection
            const historicalLevels = this.detectHistoricalLevels(
                priceHistory, 
                volumeHistory, 
                highsLows, 
                recentSwings
            );
            
            // Dynamic S/R from moving averages
            const dynamicLevels = this.identifyDynamicLevels(
                movingAverages, 
                currentPrice, 
                priceAction
            );
            
            // Orderbook-based immediate S/R
            const orderbookLevels = this.analyzeOrderbookLevels(orderbook, currentPrice);
            
            // Merge and cluster levels
            const allLevels = [...historicalLevels, ...dynamicLevels, ...orderbookLevels];
            const clusteredLevels = this.clusterLevels(allLevels);
            
            // Test level strength with recent price action
            const validatedLevels = this.validateLevelStrength(
                clusteredLevels, 
                priceHistory.slice(-50), // Last 50 periods
                volumeHistory.slice(-50),
                currentPrice
            );
            
            // Update tracking maps
            this.updateLevelTracking(symbol, validatedLevels, timestamp);
            
            // Proximity analysis - current price vs levels
            const proximityAnalysis = this.analyzeProximity(currentPrice, validatedLevels);
            
            // Breakout/bounce probability calculation
            const levelInteractions = this.analyzeLevelInteractions(
                validatedLevels,
                currentPrice,
                priceAction,
                volumeHistory.slice(-10)
            );
            
            // Generate primary signal
            const primarySignal = this.generatePrimarySignal(
                proximityAnalysis,
                levelInteractions,
                validatedLevels
            );
            
            const signals = primarySignal ? [primarySignal] : [];
            
            // Add level-specific signals
            const levelSignals = this.generateLevelSignals(validatedLevels, currentPrice);
            signals.push(...levelSignals);

            return {
                signals,
                metadata: {
                    moduleName: this.name,
                    levelsDetected: validatedLevels.length,
                    nearestSupport: proximityAnalysis.nearestSupport,
                    nearestResistance: proximityAnalysis.nearestResistance,
                    levelMap: this.createLevelMap(validatedLevels),
                    proximityAnalysis,
                    levelInteractions,
                    notify: this.generateNotifications(proximityAnalysis, levelInteractions)
                }
            };

        } catch (error) {
            console.error('❌ SupportResistanceMapper analysis error:', error);
            return { signals: [], error: error.message };
        }
    }

    /**
     * Historical seviye tespiti
     */
    detectHistoricalLevels(priceHistory, volumeHistory, highsLows, recentSwings) {
        const levels = [];
        
        // Swing highs/lows analysis
        const swingLevels = this.analyzeSwingLevels(recentSwings, volumeHistory);
        levels.push(...swingLevels);
        
        // Psychological levels (round numbers)
        const psychologicalLevels = this.identifyPsychologicalLevels(priceHistory);
        levels.push(...psychologicalLevels);
        
        // Volume-weighted levels
        const volumeLevels = this.detectVolumeLevels(priceHistory, volumeHistory);
        levels.push(...volumeLevels);
        
        // Previous highs/lows as S/R
        const historicalHL = this.extractHistoricalHighsLows(highsLows);
        levels.push(...historicalHL);
        
        return levels;
    }

    /**
     * Swing seviyeleri analizi
     */
    analyzeSwingLevels(recentSwings, volumeHistory) {
        const levels = [];
        
        recentSwings.forEach((swing, index) => {
            if (!swing.price || !swing.type) return;
            
            const volumeAtSwing = volumeHistory[swing.index] || 1;
            const baseStrength = this.calculateSwingStrength(swing, recentSwings);
            const volumeBoost = Math.min(volumeAtSwing / this.getAverageVolume(volumeHistory), 2);
            
            levels.push({
                price: swing.price,
                type: swing.type === 'high' ? 'resistance' : 'support',
                strength: baseStrength * volumeBoost,
                source: 'swing',
                timestamp: swing.timestamp || Date.now(),
                touchCount: 1,
                volume: volumeAtSwing,
                metadata: {
                    swingMagnitude: swing.magnitude,
                    retracement: swing.retracement
                }
            });
        });
        
        return levels;
    }

    /**
     * Psikolojik seviyeler (yuvarlak sayılar)
     */
    identifyPsychologicalLevels(priceHistory) {
        const levels = [];
        const priceRange = {
            min: Math.min(...priceHistory),
            max: Math.max(...priceHistory)
        };
        
        // Determine appropriate round number intervals
        const avgPrice = (priceRange.min + priceRange.max) / 2;
        let interval;
        
        if (avgPrice < 1) {
            interval = 0.1; // For small altcoins
        } else if (avgPrice < 10) {
            interval = 1;
        } else if (avgPrice < 100) {
            interval = 10;
        } else if (avgPrice < 1000) {
            interval = 100;
        } else {
            interval = 1000;
        }
        
        // Generate psychological levels within price range
        const startLevel = Math.floor(priceRange.min / interval) * interval;
        const endLevel = Math.ceil(priceRange.max / interval) * interval;
        
        for (let level = startLevel; level <= endLevel; level += interval) {
            if (level >= priceRange.min && level <= priceRange.max) {
                const touchCount = this.countPriceTouches(priceHistory, level);
                
                if (touchCount >= this.config.minTouchCount) {
                    levels.push({
                        price: level,
                        type: this.determineLevelType(level, priceHistory),
                        strength: this.calculatePsychologicalStrength(level, touchCount, avgPrice),
                        source: 'psychological',
                        timestamp: Date.now(),
                        touchCount,
                        volume: this.getAverageVolumeAtLevel(priceHistory, level),
                        metadata: {
                            interval,
                            significance: this.assessPsychologicalSignificance(level, interval)
                        }
                    });
                }
            }
        }
        
        return levels;
    }

    /**
     * Volume-based seviye tespiti
     */
    detectVolumeLevels(priceHistory, volumeHistory) {
        const levels = [];
        const volumeWeightedPrices = [];
        
        // Calculate VWAP clusters
        for (let i = 0; i < priceHistory.length; i++) {
            const volume = volumeHistory[i] || 1;
            if (volume > this.getAverageVolume(volumeHistory) * 1.5) {
                volumeWeightedPrices.push({
                    price: priceHistory[i],
                    volume,
                    index: i
                });
            }
        }
        
        // Cluster high volume prices
        const clusters = this.clusterHighVolumePrices(volumeWeightedPrices);
        
        clusters.forEach(cluster => {
            const avgPrice = cluster.prices.reduce((sum, p) => sum + p, 0) / cluster.prices.length;
            const totalVolume = cluster.volumes.reduce((sum, v) => sum + v, 0);
            
            levels.push({
                price: avgPrice,
                type: this.determineLevelType(avgPrice, priceHistory),
                strength: this.calculateVolumeBasedStrength(totalVolume, cluster.prices.length),
                source: 'volume',
                timestamp: Date.now(),
                touchCount: cluster.prices.length,
                volume: totalVolume,
                metadata: {
                    clusterSize: cluster.prices.length,
                    volumeConcentration: totalVolume / cluster.prices.length
                }
            });
        });
        
        return levels;
    }

    /**
     * Dynamic seviyeler (hareketli ortalamalar)
     */
    identifyDynamicLevels(movingAverages, currentPrice, priceAction) {
        const levels = [];
        
        const significantMAs = ['ema20', 'ema50', 'ema200', 'sma50', 'sma200'];
        
        significantMAs.forEach(maType => {
            const maValue = movingAverages[maType];
            if (!maValue) return;
            
            const distanceFromPrice = Math.abs(currentPrice - maValue) / currentPrice;
            
            // Only consider MAs that are close enough to be relevant
            if (distanceFromPrice <= 0.05) { // Within 5%
                const level = {
                    price: maValue,
                    type: currentPrice > maValue ? 'dynamic_support' : 'dynamic_resistance',
                    strength: this.calculateMAStrength(maType, distanceFromPrice, priceAction),
                    source: 'moving_average',
                    timestamp: Date.now(),
                    touchCount: this.estimateMATouches(maType),
                    volume: 0, // N/A for dynamic levels
                    metadata: {
                        maType,
                        period: this.extractMAPeriod(maType),
                        distancePercent: distanceFromPrice * 100
                    }
                };
                
                levels.push(level);
            }
        });
        
        return levels;
    }

    /**
     * Orderbook analizi
     */
    analyzeOrderbookLevels(orderbook, currentPrice) {
        const levels = [];
        
        if (!orderbook.bids || !orderbook.asks) return levels;
        
        // Large bid/ask levels
        const significantBids = this.findSignificantOrderbookLevels(orderbook.bids, 'support');
        const significantAsks = this.findSignificantOrderbookLevels(orderbook.asks, 'resistance');
        
        [...significantBids, ...significantAsks].forEach(level => {
            const distanceFromPrice = Math.abs(currentPrice - level.price) / currentPrice;
            
            // Only consider levels within 2% of current price
            if (distanceFromPrice <= 0.02) {
                levels.push({
                    price: level.price,
                    type: level.type,
                    strength: this.calculateOrderbookStrength(level.volume, level.orders),
                    source: 'orderbook',
                    timestamp: Date.now(),
                    touchCount: 0, // Fresh orderbook data
                    volume: level.volume,
                    metadata: {
                        orderCount: level.orders,
                        distancePercent: distanceFromPrice * 100,
                        immediate: true
                    }
                });
            }
        });
        
        return levels;
    }

    /**
     * Seviyeleri kümeleme
     */
    clusterLevels(levels) {
        if (levels.length === 0) return [];
        
        // Sort by price
        levels.sort((a, b) => a.price - b.price);
        
        const clusters = [];
        let currentCluster = [levels[0]];
        
        for (let i = 1; i < levels.length; i++) {
            const currentLevel = levels[i];
            const clusterAvgPrice = currentCluster.reduce((sum, l) => sum + l.price, 0) / currentCluster.length;
            
            const distance = Math.abs(currentLevel.price - clusterAvgPrice) / clusterAvgPrice;
            
            if (distance <= this.config.proximityThreshold) {
                currentCluster.push(currentLevel);
            } else {
                // Finalize current cluster
                if (currentCluster.length > 0) {
                    clusters.push(this.createClusteredLevel(currentCluster));
                }
                currentCluster = [currentLevel];
            }
        }
        
        // Add last cluster
        if (currentCluster.length > 0) {
            clusters.push(this.createClusteredLevel(currentCluster));
        }
        
        return clusters;
    }

    /**
     * Clustered level oluştur
     */
    createClusteredLevel(levelGroup) {
        const avgPrice = levelGroup.reduce((sum, l) => sum + l.price, 0) / levelGroup.length;
        const totalStrength = levelGroup.reduce((sum, l) => sum + l.strength, 0);
        const totalTouches = levelGroup.reduce((sum, l) => sum + l.touchCount, 0);
        const totalVolume = levelGroup.reduce((sum, l) => sum + l.volume, 0);
        
        // Determine type by majority
        const typeCount = {};
        levelGroup.forEach(level => {
            typeCount[level.type] = (typeCount[level.type] || 0) + 1;
        });
        const dominantType = Object.keys(typeCount).reduce((a, b) => 
            typeCount[a] > typeCount[b] ? a : b
        );
        
        return {
            price: avgPrice,
            type: dominantType,
            strength: totalStrength / levelGroup.length, // Average strength
            source: 'clustered',
            timestamp: Math.max(...levelGroup.map(l => l.timestamp)),
            touchCount: totalTouches,
            volume: totalVolume,
            metadata: {
                clusterSize: levelGroup.length,
                sources: levelGroup.map(l => l.source),
                priceRange: {
                    min: Math.min(...levelGroup.map(l => l.price)),
                    max: Math.max(...levelGroup.map(l => l.price))
                }
            }
        };
    }

    /**
     * Seviye güçlerini doğrula
     */
    validateLevelStrength(levels, recentPrices, recentVolumes, currentPrice) {
        return levels.map(level => {
            // Test level with recent price action
            const recentTouches = this.countRecentTouches(recentPrices, level.price);
            const bounceRate = this.calculateBounceRate(recentPrices, level.price, level.type);
            const volumeSupport = this.calculateVolumeSupport(recentPrices, recentVolumes, level.price);
            
            // Time decay adjustment
            const age = Date.now() - level.timestamp;
            const timeDecay = Math.pow(this.config.timeDecayFactor, age / (24 * 60 * 60 * 1000));
            
            // Adjust strength
            let adjustedStrength = level.strength * timeDecay;
            adjustedStrength += recentTouches * 0.1; // Bonus for recent touches
            adjustedStrength += bounceRate * 0.2; // Bonus for successful bounces
            adjustedStrength += volumeSupport * 0.15; // Volume confirmation
            
            return {
                ...level,
                strength: Math.min(adjustedStrength, 1.0),
                validationMetrics: {
                    recentTouches,
                    bounceRate,
                    volumeSupport,
                    timeDecay,
                    originalStrength: level.strength
                }
            };
        }).filter(level => level.strength >= this.config.minLevelStrength);
    }

    /**
     * Proximity analizi
     */
    analyzeProximity(currentPrice, levels) {
        const supportLevels = levels.filter(l => 
            l.type.includes('support') && l.price < currentPrice
        ).sort((a, b) => b.price - a.price); // Closest first
        
        const resistanceLevels = levels.filter(l => 
            l.type.includes('resistance') && l.price > currentPrice
        ).sort((a, b) => a.price - b.price); // Closest first
        
        const analysis = {
            nearestSupport: supportLevels[0] || null,
            nearestResistance: resistanceLevels[0] || null,
            supportDistance: null,
            resistanceDistance: null,
            inRange: false,
            rangeType: null
        };
        
        if (analysis.nearestSupport) {
            analysis.supportDistance = (currentPrice - analysis.nearestSupport.price) / currentPrice;
        }
        
        if (analysis.nearestResistance) {
            analysis.resistanceDistance = (analysis.nearestResistance.price - currentPrice) / currentPrice;
        }
        
        // Check if price is in a defined range
        if (analysis.nearestSupport && analysis.nearestResistance) {
            const rangeSize = analysis.resistanceDistance + analysis.supportDistance;
            if (rangeSize <= 0.05) { // Within 5% range
                analysis.inRange = true;
                analysis.rangeType = this.classifyRange(rangeSize, analysis.nearestSupport, analysis.nearestResistance);
            }
        }
        
        return analysis;
    }

    /**
     * Level etkileşim analizi
     */
    analyzeLevelInteractions(levels, currentPrice, priceAction, recentVolumes) {
        const interactions = [];
        
        levels.forEach(level => {
            const distance = Math.abs(currentPrice - level.price) / currentPrice;
            
            if (distance <= 0.01) { // Within 1% - immediate interaction
                const interaction = this.analyzeImmediateInteraction(
                    level, currentPrice, priceAction, recentVolumes
                );
                if (interaction) interactions.push(interaction);
            } else if (distance <= 0.03) { // Within 3% - approaching
                const interaction = this.analyzeApproachingInteraction(
                    level, currentPrice, priceAction
                );
                if (interaction) interactions.push(interaction);
            }
        });
        
        return interactions;
    }

    /**
     * Primary sinyal oluştur
     */
    generatePrimarySignal(proximityAnalysis, levelInteractions, levels) {
        const { nearestSupport, nearestResistance, inRange } = proximityAnalysis;
        
        let signalType = null;
        let score = 0.5;
        let metadata = {};
        
        if (inRange && nearestSupport && nearestResistance) {
            signalType = 'range-bound';
            score = Math.min(nearestSupport.strength, nearestResistance.strength);
            metadata = {
                range: {
                    support: nearestSupport.price,
                    resistance: nearestResistance.price,
                    size: (nearestResistance.price - nearestSupport.price) / nearestSupport.price
                }
            };
        } else if (levelInteractions.length > 0) {
            const strongestInteraction = levelInteractions.reduce((max, current) =>
                current.probability > max.probability ? current : max
            );
            
            signalType = `level-${strongestInteraction.expectedAction}`;
            score = strongestInteraction.probability;
            metadata = { interaction: strongestInteraction };
        }
        
        if (!signalType) return null;
        
        return this.createSignal(signalType, score, {
            variant: signalType,
            riskLevel: this.assessRiskLevel(score, metadata),
            analysis: {
                proximityAnalysis,
                levelInteractions,
                supportResistanceMap: this.createLevelMap(levels)
            },
            recommendations: this.generateRecommendations(signalType, metadata),
            confirmationChain: this.buildConfirmationChain(signalType, score)
        });
    }

    /**
     * Helper Methods (simplified implementations)
     */
    calculateSwingStrength(swing, allSwings) { return 0.7; }
    getAverageVolume(volumeHistory) { 
        return volumeHistory.reduce((sum, v) => sum + v, 0) / volumeHistory.length; 
    }
    countPriceTouches(priceHistory, level) {
        return priceHistory.filter(price => 
            Math.abs(price - level) / level <= this.config.maxTouchDeviation
        ).length;
    }
    determineLevelType(price, priceHistory) {
        const recentPrices = priceHistory.slice(-10);
        const avgRecent = recentPrices.reduce((sum, p) => sum + p, 0) / recentPrices.length;
        return price > avgRecent ? 'resistance' : 'support';
    }
    calculatePsychologicalStrength(level, touchCount, avgPrice) {
        return Math.min(touchCount / 5, 1.0) * 0.7; // Max 70% for psychological
    }
    getAverageVolumeAtLevel(priceHistory, level) { return 1000; }
    assessPsychologicalSignificance(level, interval) { return 'medium'; }
    clusterHighVolumePrices(volumePrices) { return []; }
    calculateVolumeBasedStrength(volume, count) { return 0.8; }
    calculateMAStrength(maType, distance, priceAction) { return 0.6; }
    estimateMATouches(maType) { return 3; }
    extractMAPeriod(maType) { return parseInt(maType.replace(/[^\d]/g, '')) || 20; }
    findSignificantOrderbookLevels(orders, type) { return []; }
    calculateOrderbookStrength(volume, orders) { return 0.5; }
    countRecentTouches(prices, level) { return 1; }
    calculateBounceRate(prices, level, type) { return 0.6; }
    calculateVolumeSupport(prices, volumes, level) { return 0.5; }
    classifyRange(size, support, resistance) { return 'tight'; }
    analyzeImmediateInteraction(level, price, action, volumes) { return null; }
    analyzeApproachingInteraction(level, price, action) { return null; }
    createLevelMap(levels) {
        return levels.map(l => ({
            price: l.price,
            type: l.type,
            strength: l.strength
        }));
    }

    updateLevelTracking(symbol, levels, timestamp) {
        this.activeLevels.set(symbol, levels);
    }

    generateLevelSignals(levels, currentPrice) {
        return []; // Simplified
    }

    generateNotifications(proximityAnalysis, levelInteractions) {
        return {
            grafikBeyni: {
                nearestSupport: proximityAnalysis.nearestSupport?.price,
                nearestResistance: proximityAnalysis.nearestResistance?.price,
                inRange: proximityAnalysis.inRange
            },
            tpOptimizer: {
                supportLevel: proximityAnalysis.nearestSupport?.price,
                resistanceLevel: proximityAnalysis.nearestResistance?.price
            },
            formPatternRecognizer: {
                keyLevels: [proximityAnalysis.nearestSupport, proximityAnalysis.nearestResistance].filter(Boolean)
            },
            vivo: {
                levelInteractionActive: levelInteractions.length > 0,
                rangeTrading: proximityAnalysis.inRange
            }
        };
    }

    assessRiskLevel(score, metadata) {
        if (score > 0.7) return 'low';
        if (score > 0.5) return 'medium';
        return 'high';
    }

    generateRecommendations(signalType, metadata) {
        const recommendations = [];
        
        if (signalType === 'range-bound') {
            recommendations.push('Price trading in defined range');
            recommendations.push(`Support: ${metadata.range?.support}`);
            recommendations.push(`Resistance: ${metadata.range?.resistance}`);
        }
        
        return recommendations;
    }

    buildConfirmationChain(signalType, score) {
        const chain = [`sr_${signalType}`];
        if (score > 0.7) chain.push('high_confidence');
        return chain;
    }

    /**
     * Main interface function
     */
    async getSupportResistanceLevels(marketData) {
        const result = await this.analyze(marketData);
        return result.metadata?.levelMap || [];
    }
}

module.exports = SupportResistanceMapper;
