const GrafikBeyniModuleBase = require('../grafikBeyniModuleBase');

/**
 * Support Resistance Scanner Module
 * Son fiyat hareketlerine göre destek ve direnç bölgelerini dinamik olarak tanımlar
 * Bu seviyelere yakınlık, test sayısı, hacim etkileşimi ve fiyat tepkisini analiz eder
 * "Bu çizgi güçlü mü yoksa kırılmaya hazır mı?" bilgisini verir
 */
class SupportResistanceScanner extends GrafikBeyniModuleBase {
    constructor() {
        super('supportResistanceScanner');
        this.levelHistory = new Map();
        this.maxHistoryLength = 200;
        this.proximityThreshold = 0.01; // %1 yakınlık
        this.minTouchCount = 2;
    }

    async analyze(data) {
        try {
            const {
                ohlcv,
                timeFrame,
                price,
                recentTouches,
                volumeProfile,
                lookbackPeriod = 50
            } = data;

            // Veri doğrulama
            if (!ohlcv || !price || ohlcv.length < 10) {
                throw new Error('Missing required data for support/resistance analysis');
            }

            // Destek ve direnç seviyelerini belirle
            const supportLevels = this.identifySupportLevels(ohlcv, volumeProfile, lookbackPeriod);
            const resistanceLevels = this.identifyResistanceLevels(ohlcv, volumeProfile, lookbackPeriod);

            // Seviye gücünü hesapla
            const supportStrengths = this.calculateLevelStrengths(supportLevels, ohlcv, volumeProfile, 'support');
            const resistanceStrengths = this.calculateLevelStrengths(resistanceLevels, ohlcv, volumeProfile, 'resistance');

            // Mevcut fiyat pozisyonunu analiz et
            const proximityAnalysis = this.analyzeProximity(price, supportLevels, resistanceLevels);
            
            // Dominant zone belirleme
            const dominantZone = this.determineDominantZone(price, supportLevels, resistanceLevels, supportStrengths, resistanceStrengths);

            const result = {
                supportZones: this.filterSignificantLevels(supportLevels, supportStrengths),
                resistanceZones: this.filterSignificantLevels(resistanceLevels, resistanceStrengths),
                currentProximity: proximityAnalysis.proximity,
                dominantZone: dominantZone,
                zoneStrength: this.combineStrengths(supportStrengths, resistanceStrengths),
                modularRecommendations: this.generateModularRecommendations(proximityAnalysis, dominantZone, supportStrengths, resistanceStrengths),
                alert: this.generateAlert(proximityAnalysis, dominantZone),
                metadata: {
                    analysisTimestamp: Date.now(),
                    totalLevelsFound: supportLevels.length + resistanceLevels.length,
                    strongLevels: this.countStrongLevels(supportStrengths, resistanceStrengths),
                    timeFrame: timeFrame,
                    lookbackPeriod: lookbackPeriod
                }
            };

            // Level geçmişi güncelleme
            this.updateLevelHistory(supportLevels.concat(resistanceLevels));
            
            // Cache ve performance tracking
            this.updateCache(data, result);
            this.trackPerformance(Date.now(), result.supportZones.length + result.resistanceZones.length > 0);

            return result;

        } catch (error) {
            this.handleError('SupportResistanceScanner analysis failed', error, data);
            return this.getDefaultResult();
        }
    }

    identifySupportLevels(ohlcv, volumeProfile, lookbackPeriod) {
        const supports = [];
        const candles = ohlcv.slice(-lookbackPeriod);
        
        // Pivot low noktalarını bul
        for (let i = 2; i < candles.length - 2; i++) {
            const current = candles[i];
            const isLocalLow = this.isLocalLow(candles, i);
            
            if (isLocalLow) {
                const level = {
                    price: current.low,
                    timestamp: i,
                    type: 'support',
                    touchCount: 1,
                    volume: current.volume,
                    strength: 0
                };
                
                // Yakın seviyeleri birleştir
                const existingLevel = this.findNearbyLevel(supports, level.price);
                if (existingLevel) {
                    existingLevel.touchCount++;
                    existingLevel.volume += level.volume;
                    existingLevel.price = (existingLevel.price + level.price) / 2; // Ortalama al
                } else {
                    supports.push(level);
                }
            }
        }

        // Volume profile ile güçlendir
        if (volumeProfile) {
            this.enhanceWithVolumeProfile(supports, volumeProfile, 'support');
        }

        return supports;
    }

    identifyResistanceLevels(ohlcv, volumeProfile, lookbackPeriod) {
        const resistances = [];
        const candles = ohlcv.slice(-lookbackPeriod);
        
        // Pivot high noktalarını bul
        for (let i = 2; i < candles.length - 2; i++) {
            const current = candles[i];
            const isLocalHigh = this.isLocalHigh(candles, i);
            
            if (isLocalHigh) {
                const level = {
                    price: current.high,
                    timestamp: i,
                    type: 'resistance',
                    touchCount: 1,
                    volume: current.volume,
                    strength: 0
                };
                
                // Yakın seviyeleri birleştir
                const existingLevel = this.findNearbyLevel(resistances, level.price);
                if (existingLevel) {
                    existingLevel.touchCount++;
                    existingLevel.volume += level.volume;
                    existingLevel.price = (existingLevel.price + level.price) / 2; // Ortalama al
                } else {
                    resistances.push(level);
                }
            }
        }

        // Volume profile ile güçlendir
        if (volumeProfile) {
            this.enhanceWithVolumeProfile(resistances, volumeProfile, 'resistance');
        }

        return resistances;
    }

    isLocalLow(candles, index) {
        const current = candles[index];
        const prev2 = candles[index - 2];
        const prev1 = candles[index - 1];
        const next1 = candles[index + 1];
        const next2 = candles[index + 2];
        
        return current.low <= prev2.low && 
               current.low <= prev1.low && 
               current.low <= next1.low && 
               current.low <= next2.low;
    }

    isLocalHigh(candles, index) {
        const current = candles[index];
        const prev2 = candles[index - 2];
        const prev1 = candles[index - 1];
        const next1 = candles[index + 1];
        const next2 = candles[index + 2];
        
        return current.high >= prev2.high && 
               current.high >= prev1.high && 
               current.high >= next1.high && 
               current.high >= next2.high;
    }

    findNearbyLevel(levels, price) {
        return levels.find(level => 
            Math.abs(level.price - price) / price < this.proximityThreshold
        );
    }

    enhanceWithVolumeProfile(levels, volumeProfile, type) {
        if (!volumeProfile || !volumeProfile.levels) return;
        
        for (const level of levels) {
            // Yakın volume profile noktalarını bul
            for (const [priceStr, volume] of Object.entries(volumeProfile.levels)) {
                const profilePrice = parseFloat(priceStr);
                const distance = Math.abs(level.price - profilePrice) / level.price;
                
                if (distance < this.proximityThreshold) {
                    level.volume += volume;
                    level.volumeProfile = true;
                }
            }
        }
    }

    calculateLevelStrengths(levels, ohlcv, volumeProfile, type) {
        const strengths = {};
        
        for (const level of levels) {
            let strength = 0;
            
            // Touch count faktörü (en önemli)
            strength += Math.min(level.touchCount * 0.2, 0.6);
            
            // Volume faktörü
            const avgVolume = this.calculateAverageVolume(ohlcv);
            const volumeRatio = level.volume / avgVolume;
            strength += Math.min(volumeRatio * 0.1, 0.3);
            
            // Volume profile desteği
            if (level.volumeProfile) {
                strength += 0.15;
            }
            
            // Price rejection quality (fitil analizi)
            const rejectionQuality = this.analyzeRejectionQuality(level, ohlcv);
            strength += rejectionQuality * 0.2;
            
            // Historical success rate
            const historicalSuccess = this.getHistoricalSuccess(level);
            strength += historicalSuccess * 0.1;
            
            // Recency bonus (son zamanlarda test edildiyse)
            const recencyBonus = this.calculateRecencyBonus(level);
            strength += recencyBonus * 0.05;

            strengths[level.price] = Math.min(1, strength);
        }
        
        return strengths;
    }

    calculateAverageVolume(ohlcv) {
        const volumes = ohlcv.map(candle => candle.volume);
        return volumes.reduce((sum, vol) => sum + vol, 0) / volumes.length;
    }

    analyzeRejectionQuality(level, ohlcv) {
        let rejectionScore = 0;
        const tolerance = level.price * this.proximityThreshold;
        
        for (const candle of ohlcv.slice(-20)) { // Son 20 mum
            if (level.type === 'support') {
                // Support seviyesinde güçlü fitil var mı?
                if (candle.low <= level.price + tolerance && candle.close > candle.low * 1.005) {
                    const wickLength = candle.close - candle.low;
                    const bodyLength = Math.abs(candle.close - candle.open);
                    if (wickLength > bodyLength * 1.5) {
                        rejectionScore += 0.2;
                    }
                }
            } else {
                // Resistance seviyesinde güçlü fitil var mı?
                if (candle.high >= level.price - tolerance && candle.close < candle.high * 0.995) {
                    const wickLength = candle.high - candle.close;
                    const bodyLength = Math.abs(candle.close - candle.open);
                    if (wickLength > bodyLength * 1.5) {
                        rejectionScore += 0.2;
                    }
                }
            }
        }
        
        return Math.min(1, rejectionScore);
    }

    getHistoricalSuccess(level) {
        const levelKey = Math.round(level.price * 100) / 100; // 2 decimal precision
        const history = this.levelHistory.get(levelKey);
        
        if (!history || history.tests < 3) return 0;
        
        return history.successes / history.tests;
    }

    calculateRecencyBonus(level) {
        const timeSinceTouch = Date.now() - (level.timestamp * 60000); // Assume timestamp is in minutes
        const hoursAgo = timeSinceTouch / (1000 * 60 * 60);
        
        if (hoursAgo < 4) return 1.0;      // Son 4 saat
        if (hoursAgo < 12) return 0.7;     // Son 12 saat
        if (hoursAgo < 24) return 0.4;     // Son 24 saat
        if (hoursAgo < 72) return 0.2;     // Son 3 gün
        return 0;
    }

    analyzeProximity(currentPrice, supportLevels, resistanceLevels) {
        let nearestSupport = null;
        let nearestResistance = null;
        let minSupportDistance = Infinity;
        let minResistanceDistance = Infinity;
        
        // En yakın support bul
        for (const support of supportLevels) {
            if (support.price < currentPrice) {
                const distance = Math.abs(currentPrice - support.price) / currentPrice;
                if (distance < minSupportDistance) {
                    minSupportDistance = distance;
                    nearestSupport = support;
                }
            }
        }
        
        // En yakın resistance bul
        for (const resistance of resistanceLevels) {
            if (resistance.price > currentPrice) {
                const distance = Math.abs(resistance.price - currentPrice) / currentPrice;
                if (distance < minResistanceDistance) {
                    minResistanceDistance = distance;
                    nearestResistance = resistance;
                }
            }
        }
        
        // Proximity durumu belirle
        let proximity = 'neutral';
        if (nearestResistance && minResistanceDistance < this.proximityThreshold) {
            proximity = 'nearResistance';
        } else if (nearestSupport && minSupportDistance < this.proximityThreshold) {
            proximity = 'nearSupport';
        } else if (minResistanceDistance < minSupportDistance) {
            proximity = 'approachingResistance';
        } else {
            proximity = 'approachingSupport';
        }
        
        return {
            proximity,
            nearestSupport,
            nearestResistance,
            supportDistance: minSupportDistance,
            resistanceDistance: minResistanceDistance
        };
    }

    determineDominantZone(price, supportLevels, resistanceLevels, supportStrengths, resistanceStrengths) {
        // En güçlü seviyeleri bul
        let strongestSupport = null;
        let strongestResistance = null;
        let maxSupportStrength = 0;
        let maxResistanceStrength = 0;
        
        for (const support of supportLevels) {
            const strength = supportStrengths[support.price] || 0;
            if (strength > maxSupportStrength) {
                maxSupportStrength = strength;
                strongestSupport = support;
            }
        }
        
        for (const resistance of resistanceLevels) {
            const strength = resistanceStrengths[resistance.price] || 0;
            if (strength > maxResistanceStrength) {
                maxResistanceStrength = strength;
                strongestResistance = resistance;
            }
        }
        
        // Dominant zone belirleme
        if (maxResistanceStrength > maxSupportStrength) {
            return 'resistance';
        } else if (maxSupportStrength > maxResistanceStrength) {
            return 'support';
        } else {
            return 'balanced';
        }
    }

    filterSignificantLevels(levels, strengths, minStrength = 0.4) {
        return levels
            .filter(level => (strengths[level.price] || 0) >= minStrength)
            .map(level => level.price)
            .sort((a, b) => (strengths[b] || 0) - (strengths[a] || 0));
    }

    combineStrengths(supportStrengths, resistanceStrengths) {
        return { ...supportStrengths, ...resistanceStrengths };
    }

    countStrongLevels(supportStrengths, resistanceStrengths, threshold = 0.7) {
        const allStrengths = Object.values(supportStrengths).concat(Object.values(resistanceStrengths));
        return allStrengths.filter(strength => strength >= threshold).length;
    }

    generateModularRecommendations(proximityAnalysis, dominantZone, supportStrengths, resistanceStrengths) {
        const recommendations = {
            tpOptimizer: {
                finalTPshouldConsiderResistance: proximityAnalysis.proximity === 'nearResistance' || dominantZone === 'resistance',
                supportBasedSL: proximityAnalysis.proximity === 'nearSupport',
                levelData: {
                    nearestResistance: proximityAnalysis.nearestResistance?.price,
                    nearestSupport: proximityAnalysis.nearestSupport?.price
                }
            },
            riskToRewardValidator: {
                adjustBasedOnZone: true,
                proximityRisk: proximityAnalysis.proximity === 'nearResistance' ? 'high' : 'low',
                supportBuffer: proximityAnalysis.nearestSupport?.price,
                resistanceBuffer: proximityAnalysis.nearestResistance?.price
            },
            exitTimingAdvisor: {
                watchForRejection: proximityAnalysis.proximity === 'nearResistance',
                supportLevel: proximityAnalysis.nearestSupport?.price,
                resistanceLevel: proximityAnalysis.nearestResistance?.price
            },
            priceBreakoutDetector: {
                keyLevelsToWatch: this.getKeyLevels(supportStrengths, resistanceStrengths),
                breakoutThreshold: this.getBreakoutThreshold(proximityAnalysis)
            }
        };

        return recommendations;
    }

    getKeyLevels(supportStrengths, resistanceStrengths) {
        const strongLevels = [];
        
        for (const [price, strength] of Object.entries(supportStrengths)) {
            if (strength >= 0.7) {
                strongLevels.push({ price: parseFloat(price), type: 'support', strength });
            }
        }
        
        for (const [price, strength] of Object.entries(resistanceStrengths)) {
            if (strength >= 0.7) {
                strongLevels.push({ price: parseFloat(price), type: 'resistance', strength });
            }
        }
        
        return strongLevels.sort((a, b) => b.strength - a.strength);
    }

    getBreakoutThreshold(proximityAnalysis) {
        if (proximityAnalysis.proximity === 'nearResistance') {
            return proximityAnalysis.nearestResistance?.price;
        } else if (proximityAnalysis.proximity === 'nearSupport') {
            return proximityAnalysis.nearestSupport?.price;
        }
        return null;
    }

    generateAlert(proximityAnalysis, dominantZone) {
        const { proximity, nearestSupport, nearestResistance } = proximityAnalysis;
        
        if (proximity === 'nearResistance') {
            return `Güçlü direnç seviyesine yaklaşıyor (${nearestResistance?.price?.toFixed(4)})`;
        } else if (proximity === 'nearSupport') {
            return `Önemli destek seviyesinde (${nearestSupport?.price?.toFixed(4)})`;
        } else if (proximity === 'approachingResistance') {
            return "Direnç seviyesine yaklaşıyor — izleme devam";
        } else if (proximity === 'approachingSupport') {
            return "Destek seviyesine yaklaşıyor — fırsat izleniyor";
        } else {
            return `Destek/direnç analizi tamamlandı — ${dominantZone} baskın`;
        }
    }

    updateLevelHistory(levels) {
        for (const level of levels) {
            const levelKey = Math.round(level.price * 100) / 100;
            
            if (!this.levelHistory.has(levelKey)) {
                this.levelHistory.set(levelKey, {
                    tests: 0,
                    successes: 0,
                    lastSeen: Date.now()
                });
            }
            
            const history = this.levelHistory.get(levelKey);
            history.tests++;
            history.lastSeen = Date.now();
            
            // Cleanup old levels
            if (this.levelHistory.size > this.maxHistoryLength) {
                const oldestKey = Array.from(this.levelHistory.entries())
                    .sort((a, b) => a[1].lastSeen - b[1].lastSeen)[0][0];
                this.levelHistory.delete(oldestKey);
            }
        }
    }

    getDefaultResult() {
        return {
            supportZones: [],
            resistanceZones: [],
            currentProximity: 'neutral',
            dominantZone: 'balanced',
            zoneStrength: {},
            modularRecommendations: {},
            alert: "Destek/direnç analizi yapılamadı",
            metadata: {
                error: true,
                analysisTimestamp: Date.now()
            }
        };
    }

    getModuleInfo() {
        return {
            name: 'SupportResistanceScanner',
            version: '1.0.0',
            description: 'Dinamik destek ve direnç seviyelerini tespit eder ve güçlülüklerini değerlendirir',
            inputs: [
                'ohlcv', 'timeFrame', 'price', 'recentTouches', 
                'volumeProfile', 'lookbackPeriod'
            ],
            outputs: [
                'supportZones', 'resistanceZones', 'currentProximity', 'dominantZone',
                'zoneStrength', 'modularRecommendations', 'alert', 'metadata'
            ]
        };
    }
}

module.exports = SupportResistanceScanner;
