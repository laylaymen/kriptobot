const GrafikBeyniModuleBase = require('../grafikBeyniModuleBase');

/**
 * VAP Zone Detector Module
 * Volume At Price (VAP) analizi yaparak kritik hacim bölgelerini tespit eder
 * Fiyat seviyelerindeki hacim dağılımını analiz ederek destek/direnç ve giriş-çıkış noktalarını belirler
 */
class VapZoneDetector extends GrafikBeyniModuleBase {
    constructor() {
        super('vapZoneDetector');
        this.vapHistory = new Map(); // price -> volume mapping
        this.volumeClusters = [];
        this.significantZones = [];
        this.maxHistoryPeriods = 24; // 24 saatlik veri
        this.volumeThresholdPercentage = 0.15; // %15 üzeri hacim için significant zone
    }

    async analyze(data) {
        try {
            const {
                priceLevel,
                volumeAtPrice,
                timeframe,
                totalVolume24h,
                currentPrice,
                priceRange,
                tickSize,
                marketDepth,
                tradingSession,
                volatility,
                marketCap
            } = data;

            // Veri doğrulama
            if (!priceLevel || !volumeAtPrice || !totalVolume24h) {
                throw new Error('Missing required VAP data for analysis');
            }

            // VAP verilerini güncelle
            this.updateVapData(priceLevel, volumeAtPrice, timeframe);

            // Volume cluster analizi
            const volumeClusters = this.identifyVolumeClusters();

            // Significant VAP zones belirleme
            const significantZones = this.identifySignificantZones(totalVolume24h);

            // Current price ile VAP zones karşılaştırması
            const priceVapRelation = this.analyzePriceVapRelation(currentPrice, significantZones);

            // Support/Resistance level tespiti
            const supportResistanceLevels = this.identifySupportResistanceLevels(significantZones, currentPrice);

            // Volume profile analizi
            const volumeProfile = this.calculateVolumeProfile(priceRange);

            // Value area calculation (70% of volume)
            const valueArea = this.calculateValueArea(volumeClusters, totalVolume24h);

            // Point of Control (POC) - En yüksek hacimli fiyat seviyesi
            const pointOfControl = this.findPointOfControl(volumeClusters);

            // Market efficiency analizi
            const marketEfficiency = this.analyzeMarketEfficiency(volumeClusters, priceRange);

            // Giriş-çıkış seviye önerileri
            const entryExitLevels = this.generateEntryExitLevels(significantZones, currentPrice, priceVapRelation);

            // Recommendations oluşturma
            const recommendations = this.generateRecommendations(priceVapRelation, significantZones, valueArea);

            const result = {
                significantZones: significantZones,
                volumeClusters: volumeClusters.slice(0, 10), // Top 10 cluster
                priceVapRelation: priceVapRelation,
                supportResistanceLevels: supportResistanceLevels,
                volumeProfile: volumeProfile,
                valueArea: valueArea,
                pointOfControl: pointOfControl,
                marketEfficiency: marketEfficiency,
                entryExitLevels: entryExitLevels,
                recommendations: recommendations,
                notes: this.generateNotes(priceVapRelation, significantZones, valueArea),
                metadata: {
                    analysisTimestamp: Date.now(),
                    totalVolumeAnalyzed: totalVolume24h,
                    priceRangeCoverage: this.calculatePriceRangeCoverage(priceRange),
                    volumeDistribution: this.analyzeVolumeDistribution(volumeClusters),
                    zoneStrength: this.calculateZoneStrength(significantZones)
                }
            };

            // Significant zones güncelleme
            this.significantZones = significantZones;

            // Cache ve performance tracking
            this.updateCache(data, result);
            this.trackPerformance(Date.now(), significantZones.length > 0);

            return result;

        } catch (error) {
            this.handleError('VapZoneDetector analysis failed', error, data);
            return this.getDefaultResult();
        }
    }

    updateVapData(priceLevel, volumeAtPrice, timeframe) {
        const now = Date.now();
        const key = this.createPriceKey(priceLevel);

        if (!this.vapHistory.has(key)) {
            this.vapHistory.set(key, {
                totalVolume: 0,
                periods: [],
                firstSeen: now,
                lastUpdated: now
            });
        }

        const vapData = this.vapHistory.get(key);
        vapData.totalVolume += volumeAtPrice;
        vapData.periods.push({
            timestamp: now,
            volume: volumeAtPrice,
            timeframe: timeframe
        });
        vapData.lastUpdated = now;

        // Eski verileri temizle (24 saatten eski)
        const cutoff = now - (this.maxHistoryPeriods * 60 * 60 * 1000);
        vapData.periods = vapData.periods.filter(period => period.timestamp >= cutoff);

        // Total volume'u yeniden hesapla
        vapData.totalVolume = vapData.periods.reduce((sum, period) => sum + period.volume, 0);

        // Eğer hiç veri kalmadıysa entry'i sil
        if (vapData.periods.length === 0) {
            this.vapHistory.delete(key);
        }
    }

    createPriceKey(priceLevel) {
        // Fiyatı belirli bir precision'a yuvarla (tick size'a göre)
        return Math.round(priceLevel * 10000) / 10000;
    }

    identifyVolumeClusters() {
        const clusters = [];

        // VAP history'den cluster oluştur
        for (const [priceKey, vapData] of this.vapHistory.entries()) {
            clusters.push({
                price: priceKey,
                volume: vapData.totalVolume,
                periods: vapData.periods.length,
                intensity: vapData.totalVolume / vapData.periods.length,
                firstSeen: vapData.firstSeen,
                lastUpdated: vapData.lastUpdated
            });
        }

        // Volume'a göre sırala (en yüksek önce)
        clusters.sort((a, b) => b.volume - a.volume);

        return clusters;
    }

    identifySignificantZones(totalVolume24h) {
        const clusters = this.identifyVolumeClusters();
        const significantZones = [];
        const threshold = totalVolume24h * this.volumeThresholdPercentage;

        for (const cluster of clusters) {
            if (cluster.volume >= threshold) {
                const zone = {
                    centerPrice: cluster.price,
                    volume: cluster.volume,
                    volumePercentage: (cluster.volume / totalVolume24h) * 100,
                    intensity: cluster.intensity,
                    periods: cluster.periods,
                    zoneType: this.determineZoneType(cluster, totalVolume24h),
                    strength: this.calculateZoneStrength(cluster, totalVolume24h),
                    priceRange: this.calculateZonePriceRange(cluster.price, cluster.volume),
                    lastActivity: cluster.lastUpdated
                };

                significantZones.push(zone);
            }
        }

        // Strength'e göre sırala
        significantZones.sort((a, b) => b.strength - a.strength);

        return significantZones.slice(0, 15); // Top 15 zone
    }

    determineZoneType(cluster, totalVolume24h) {
        const volumePercentage = (cluster.volume / totalVolume24h) * 100;
        const intensity = cluster.intensity;

        if (volumePercentage >= 25) {
            return 'major_level';
        } else if (volumePercentage >= 20) {
            return 'strong_level';
        } else if (volumePercentage >= 15) {
            return 'significant_level';
        } else if (intensity > cluster.volume / 5) {
            return 'high_intensity_zone';
        } else {
            return 'moderate_level';
        }
    }

    calculateZoneStrength(cluster, totalVolume24h) {
        const volumeWeight = (cluster.volume / totalVolume24h) * 100;
        const intensityWeight = Math.min(cluster.intensity / 10000, 10); // Cap at 10
        const persistenceWeight = Math.min(cluster.periods / 24, 5); // Cap at 5

        return volumeWeight * 0.6 + intensityWeight * 0.3 + persistenceWeight * 0.1;
    }

    calculateZonePriceRange(centerPrice, volume) {
        // Volume'a göre zone genişliği hesapla
        const baseRange = centerPrice * 0.001; // %0.1 base range
        const volumeMultiplier = Math.log10(volume / 1000 + 1); // Log scale
        const range = baseRange * volumeMultiplier;

        return {
            upper: centerPrice + range,
            lower: centerPrice - range,
            width: range * 2
        };
    }

    analyzePriceVapRelation(currentPrice, significantZones) {
        let nearestZone = null;
        let minDistance = Infinity;
        let pricePosition = 'neutral';
        let distancePercentage = 0;

        // En yakın zone'u bul
        for (const zone of significantZones) {
            const distance = Math.abs(currentPrice - zone.centerPrice);
            if (distance < minDistance) {
                minDistance = distance;
                nearestZone = zone;
            }
        }

        if (nearestZone) {
            distancePercentage = (minDistance / currentPrice) * 100;

            // Zone içinde mi kontrol et
            if (currentPrice >= nearestZone.priceRange.lower && 
                currentPrice <= nearestZone.priceRange.upper) {
                pricePosition = 'inside_zone';
            } else if (currentPrice > nearestZone.centerPrice) {
                pricePosition = 'above_zone';
            } else {
                pricePosition = 'below_zone';
            }
        }

        // Support/Resistance seviyeleri belirleme
        const supportLevels = significantZones.filter(zone => zone.centerPrice < currentPrice);
        const resistanceLevels = significantZones.filter(zone => zone.centerPrice > currentPrice);

        return {
            nearestZone: nearestZone,
            distance: minDistance,
            distancePercentage: distancePercentage,
            pricePosition: pricePosition,
            supportLevels: supportLevels.slice(0, 3), // Top 3 support
            resistanceLevels: resistanceLevels.slice(0, 3), // Top 3 resistance
            zoneInteraction: this.analyzeZoneInteraction(currentPrice, nearestZone)
        };
    }

    analyzeZoneInteraction(currentPrice, nearestZone) {
        if (!nearestZone) return 'no_interaction';

        const priceRange = nearestZone.priceRange;
        const centerPrice = nearestZone.centerPrice;

        if (currentPrice >= priceRange.lower && currentPrice <= priceRange.upper) {
            if (Math.abs(currentPrice - centerPrice) / centerPrice < 0.001) {
                return 'direct_interaction';
            } else {
                return 'zone_interaction';
            }
        } else if (Math.abs(currentPrice - centerPrice) / centerPrice < 0.005) {
            return 'approaching_zone';
        } else {
            return 'distant_from_zone';
        }
    }

    identifySupportResistanceLevels(significantZones, currentPrice) {
        const levels = {
            support: [],
            resistance: []
        };

        for (const zone of significantZones) {
            const level = {
                price: zone.centerPrice,
                strength: zone.strength,
                volume: zone.volume,
                zoneType: zone.zoneType,
                priceRange: zone.priceRange,
                distance: Math.abs(currentPrice - zone.centerPrice),
                distancePercentage: (Math.abs(currentPrice - zone.centerPrice) / currentPrice) * 100
            };

            if (zone.centerPrice < currentPrice) {
                levels.support.push(level);
            } else if (zone.centerPrice > currentPrice) {
                levels.resistance.push(level);
            }
        }

        // Distance'a göre sırala (en yakın önce)
        levels.support.sort((a, b) => a.distance - b.distance);
        levels.resistance.sort((a, b) => a.distance - b.distance);

        return {
            support: levels.support.slice(0, 5),
            resistance: levels.resistance.slice(0, 5),
            nearestSupport: levels.support[0] || null,
            nearestResistance: levels.resistance[0] || null
        };
    }

    calculateVolumeProfile(priceRange) {
        if (!priceRange || !priceRange.high || !priceRange.low) {
            return { distribution: [], profileType: 'unknown' };
        }

        const bins = 20; // 20 bin'e böl
        const binSize = (priceRange.high - priceRange.low) / bins;
        const distribution = new Array(bins).fill(0);

        // Her price level'ı uygun bin'e yerleştir
        for (const [priceKey, vapData] of this.vapHistory.entries()) {
            const price = parseFloat(priceKey);
            if (price >= priceRange.low && price <= priceRange.high) {
                const binIndex = Math.min(
                    Math.floor((price - priceRange.low) / binSize),
                    bins - 1
                );
                distribution[binIndex] += vapData.totalVolume;
            }
        }

        // Profile type belirleme
        const profileType = this.determineProfileType(distribution);

        return {
            distribution: distribution.map((volume, index) => ({
                priceLevel: priceRange.low + (index * binSize),
                volume: volume,
                percentage: (volume / distribution.reduce((a, b) => a + b, 1)) * 100
            })),
            profileType: profileType,
            binSize: binSize
        };
    }

    determineProfileType(distribution) {
        const maxIndex = distribution.indexOf(Math.max(...distribution));
        const total = distribution.reduce((a, b) => a + b, 0);
        const topThird = distribution.slice(Math.floor(distribution.length * 2/3));
        const bottomThird = distribution.slice(0, Math.floor(distribution.length / 3));
        
        const topThirdVolume = topThird.reduce((a, b) => a + b, 0);
        const bottomThirdVolume = bottomThird.reduce((a, b) => a + b, 0);

        if (maxIndex < distribution.length / 3) {
            return 'bottom_heavy'; // Bottom'da yoğunluk
        } else if (maxIndex > distribution.length * 2/3) {
            return 'top_heavy'; // Top'da yoğunluk
        } else if (topThirdVolume > total * 0.4) {
            return 'uptrend_profile'; // Yukarı trend profili
        } else if (bottomThirdVolume > total * 0.4) {
            return 'downtrend_profile'; // Aşağı trend profili
        } else {
            return 'balanced'; // Dengeli dağılım
        }
    }

    calculateValueArea(volumeClusters, totalVolume24h) {
        const sortedClusters = [...volumeClusters].sort((a, b) => b.volume - a.volume);
        let accumulatedVolume = 0;
        const targetVolume = totalVolume24h * 0.7; // %70 of total volume
        const valueAreaClusters = [];

        for (const cluster of sortedClusters) {
            if (accumulatedVolume < targetVolume) {
                valueAreaClusters.push(cluster);
                accumulatedVolume += cluster.volume;
            } else {
                break;
            }
        }

        if (valueAreaClusters.length === 0) {
            return { high: 0, low: 0, volume: 0, clusters: [] };
        }

        const prices = valueAreaClusters.map(c => c.price);
        const valueAreaHigh = Math.max(...prices);
        const valueAreaLow = Math.min(...prices);

        return {
            high: valueAreaHigh,
            low: valueAreaLow,
            volume: accumulatedVolume,
            clusters: valueAreaClusters,
            width: valueAreaHigh - valueAreaLow,
            widthPercentage: ((valueAreaHigh - valueAreaLow) / valueAreaLow) * 100
        };
    }

    findPointOfControl(volumeClusters) {
        if (volumeClusters.length === 0) {
            return null;
        }

        const poc = volumeClusters.reduce((max, cluster) => 
            cluster.volume > max.volume ? cluster : max
        );

        return {
            price: poc.price,
            volume: poc.volume,
            intensity: poc.intensity,
            periods: poc.periods,
            significance: 'point_of_control'
        };
    }

    analyzeMarketEfficiency(volumeClusters, priceRange) {
        if (!priceRange || volumeClusters.length === 0) {
            return { efficiency: 'unknown', score: 0 };
        }

        const totalVolume = volumeClusters.reduce((sum, cluster) => sum + cluster.volume, 0);
        const priceSpread = priceRange.high - priceRange.low;
        const volumePerPriceUnit = totalVolume / priceSpread;

        // Volume distribution efficiency
        const concentrationRatio = this.calculateConcentrationRatio(volumeClusters);
        
        // Price discovery efficiency
        const priceDiscoveryScore = this.calculatePriceDiscoveryScore(volumeClusters, priceRange);

        let efficiency = 'moderate';
        let score = 5;

        if (concentrationRatio > 0.7 && priceDiscoveryScore > 7) {
            efficiency = 'high';
            score = 8;
        } else if (concentrationRatio < 0.3 || priceDiscoveryScore < 3) {
            efficiency = 'low';
            score = 2;
        }

        return {
            efficiency: efficiency,
            score: score,
            concentrationRatio: concentrationRatio,
            priceDiscoveryScore: priceDiscoveryScore,
            volumePerPriceUnit: volumePerPriceUnit
        };
    }

    calculateConcentrationRatio(volumeClusters) {
        if (volumeClusters.length === 0) return 0;

        const totalVolume = volumeClusters.reduce((sum, cluster) => sum + cluster.volume, 0);
        const top5Volume = volumeClusters.slice(0, 5).reduce((sum, cluster) => sum + cluster.volume, 0);

        return top5Volume / totalVolume;
    }

    calculatePriceDiscoveryScore(volumeClusters, priceRange) {
        // Price discovery efficiency based on volume distribution across price range
        const priceSpread = priceRange.high - priceRange.low;
        const clusters = volumeClusters.length;
        const averageGap = priceSpread / clusters;

        // Lower gaps = better price discovery
        if (averageGap < priceSpread * 0.01) return 9; // %1'den az gap
        if (averageGap < priceSpread * 0.02) return 7; // %2'den az gap
        if (averageGap < priceSpread * 0.05) return 5; // %5'den az gap
        return 3;
    }

    generateEntryExitLevels(significantZones, currentPrice, priceVapRelation) {
        const levels = {
            entryLevels: [],
            exitLevels: [],
            stopLossLevels: [],
            takeProfitLevels: []
        };

        // Entry levels - Strong VAP zones yakınları
        for (const zone of significantZones.slice(0, 5)) {
            if (zone.strength > 15 && zone.zoneType !== 'moderate_level') {
                const distance = Math.abs(currentPrice - zone.centerPrice);
                const distancePercentage = (distance / currentPrice) * 100;

                if (distancePercentage < 5) { // %5 içinde
                    levels.entryLevels.push({
                        price: zone.centerPrice,
                        confidence: Math.min(zone.strength / 20, 1),
                        type: zone.zoneType,
                        direction: currentPrice > zone.centerPrice ? 'support_bounce' : 'resistance_break'
                    });
                }
            }
        }

        // Exit levels - Major resistance/support levels
        const { nearestSupport, nearestResistance } = priceVapRelation;
        
        if (nearestResistance) {
            levels.exitLevels.push({
                price: nearestResistance.price,
                type: 'resistance_exit',
                confidence: Math.min(nearestResistance.strength / 25, 1)
            });
        }

        if (nearestSupport) {
            levels.stopLossLevels.push({
                price: nearestSupport.price,
                type: 'support_stop',
                confidence: Math.min(nearestSupport.strength / 25, 1)
            });
        }

        return levels;
    }

    generateRecommendations(priceVapRelation, significantZones, valueArea) {
        const recommendations = {};

        // Zone position based recommendations
        if (priceVapRelation.pricePosition === 'inside_zone') {
            recommendations.entryGatekeeper = 'waitForZoneBreak';
            recommendations.tpOptimizer = 'setConservativeTP';
        } else if (priceVapRelation.pricePosition === 'approaching_zone') {
            recommendations.entryGatekeeper = 'prepareForZoneReaction';
            recommendations.vivo = 'increaseZoneAwareness';
        }

        // Value area recommendations
        if (valueArea.width && valueArea.widthPercentage > 5) {
            recommendations.riskToRewardValidator = 'adjustForVolumeProfile';
            recommendations.exitTimingAdvisor = 'considerValueAreaLimits';
        }

        // Strong zone presence
        const strongZones = significantZones.filter(zone => zone.strength > 20);
        if (strongZones.length > 3) {
            recommendations.supportResistanceMapper = 'useVAPLevels';
            recommendations.formationIdentifier = 'validateWithVAP';
        }

        return recommendations;
    }

    generateNotes(priceVapRelation, significantZones, valueArea) {
        const notes = [];

        if (priceVapRelation.nearestZone) {
            const distance = priceVapRelation.distancePercentage.toFixed(2);
            notes.push(`En yakın VAP zone: %${distance} mesafede (${priceVapRelation.nearestZone.zoneType})`);
        }

        if (significantZones.length > 5) {
            notes.push(`${significantZones.length} adet significant VAP zone tespit edildi`);
        }

        if (valueArea.widthPercentage > 10) {
            notes.push(`Geniş value area (%${valueArea.widthPercentage.toFixed(1)}) - düşük volatilite`);
        }

        const majorLevels = significantZones.filter(zone => zone.zoneType === 'major_level').length;
        if (majorLevels > 2) {
            notes.push(`${majorLevels} adet major VAP level - güçlü destek/direnç yapısı`);
        }

        return notes.join('. ');
    }

    calculatePriceRangeCoverage(priceRange) {
        if (!priceRange) return 0;
        
        const spread = priceRange.high - priceRange.low;
        const coveredLevels = Array.from(this.vapHistory.keys())
            .filter(price => price >= priceRange.low && price <= priceRange.high)
            .length;

        return {
            spread: spread,
            coveredLevels: coveredLevels,
            coverage: coveredLevels / (spread * 10000) // Rough coverage estimate
        };
    }

    analyzeVolumeDistribution(volumeClusters) {
        if (volumeClusters.length === 0) return { type: 'unknown' };

        const totalVolume = volumeClusters.reduce((sum, cluster) => sum + cluster.volume, 0);
        const top10Percentage = volumeClusters.slice(0, 10)
            .reduce((sum, cluster) => sum + cluster.volume, 0) / totalVolume;

        if (top10Percentage > 0.8) {
            return { type: 'concentrated', concentration: top10Percentage };
        } else if (top10Percentage > 0.6) {
            return { type: 'moderate', concentration: top10Percentage };
        } else {
            return { type: 'distributed', concentration: top10Percentage };
        }
    }

    getDefaultResult() {
        return {
            significantZones: [],
            volumeClusters: [],
            priceVapRelation: {
                nearestZone: null,
                distance: 0,
                distancePercentage: 0,
                pricePosition: 'neutral',
                supportLevels: [],
                resistanceLevels: [],
                zoneInteraction: 'no_interaction'
            },
            supportResistanceLevels: {
                support: [],
                resistance: [],
                nearestSupport: null,
                nearestResistance: null
            },
            volumeProfile: { distribution: [], profileType: 'unknown' },
            valueArea: { high: 0, low: 0, volume: 0, clusters: [] },
            pointOfControl: null,
            marketEfficiency: { efficiency: 'unknown', score: 0 },
            entryExitLevels: {
                entryLevels: [],
                exitLevels: [],
                stopLossLevels: [],
                takeProfitLevels: []
            },
            recommendations: {},
            notes: "VAP zone analizi yapılamadı - yetersiz veri",
            metadata: {
                error: true,
                analysisTimestamp: Date.now()
            }
        };
    }

    getModuleInfo() {
        return {
            name: 'VapZoneDetector',
            version: '1.0.0',
            description: 'Volume At Price analizi ve kritik hacim bölgesi tespiti',
            inputs: [
                'priceLevel', 'volumeAtPrice', 'timeframe', 'totalVolume24h',
                'currentPrice', 'priceRange', 'tickSize', 'marketDepth',
                'tradingSession', 'volatility', 'marketCap'
            ],
            outputs: [
                'significantZones', 'volumeClusters', 'priceVapRelation',
                'supportResistanceLevels', 'volumeProfile', 'valueArea',
                'pointOfControl', 'marketEfficiency', 'entryExitLevels',
                'recommendations', 'notes', 'metadata'
            ]
        };
    }
}

module.exports = VapZoneDetector;
