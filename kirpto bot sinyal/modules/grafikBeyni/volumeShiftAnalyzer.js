const GrafikBeyniModuleBase = require('../grafikBeyniModuleBase');

/**
 * Volume Shift Analyzer Module
 * Ani hacim artışı, düşüşü, spike, yoğunlaşma, boşalma gibi hareketleri analiz eder
 * Formasyonun gerçekten güçlü mü yoksa çöp mü olduğunu değerlendirir
 */
class VolumeShiftAnalyzer extends GrafikBeyniModuleBase {
    constructor() {
        super('volumeShiftAnalyzer');
        this.volumeHistory = [];
        this.spikeThresholds = {
            mild: 1.5,
            moderate: 2.0,
            strong: 3.0,
            extreme: 5.0
        };
        this.maxHistoryLength = 100;
    }

    async analyze(data) {
        try {
            const {
                volumeSeries,
                averageVolume,
                priceAction,
                formationType,
                breakoutBarVolume,
                volumeMomentum,
                timeToEvent,
                ohlcv,
                currentPrice
            } = data;

            // Veri doğrulama
            if (!volumeSeries || !averageVolume || volumeSeries.length < 3) {
                throw new Error('Missing required volume data for analysis');
            }

            // Volume shift detection
            const volumeShift = this.detectVolumeShift(data);
            
            // Volume strength hesaplama
            const volumeStrength = this.calculateVolumeStrength(data);
            
            // Breakout confirmation analysis
            const breakoutAnalysis = this.analyzeBreakoutVolume(data);
            
            // Shift type belirleme
            const shiftType = this.determineShiftType(data, volumeShift, breakoutAnalysis);

            const result = {
                volumeShiftDetected: volumeShift.detected,
                shiftType,
                volumeStrength,
                volumeSpike: this.detectVolumeSpike(data),
                breakoutConfirmation: breakoutAnalysis,
                modularRecommendations: this.generateModularRecommendations(volumeStrength, shiftType, breakoutAnalysis),
                alert: this.generateAlert(volumeStrength, shiftType, volumeShift),
                metadata: {
                    analysisTimestamp: Date.now(),
                    volumeMetrics: this.calculateVolumeMetrics(data),
                    trapRisk: this.assessTrapRisk(data),
                    liquidityZoneFlag: this.checkLiquidityZone(data)
                }
            };

            // Volume geçmişi güncelleme
            this.updateVolumeHistory(data);
            
            // Cache ve performance tracking
            this.updateCache(data, result);
            this.trackPerformance(Date.now(), volumeShift.detected);

            return result;

        } catch (error) {
            this.handleError('VolumeShiftAnalyzer analysis failed', error, data);
            return this.getDefaultResult();
        }
    }

    detectVolumeShift(data) {
        const { volumeSeries, averageVolume, timeToEvent } = data;
        
        if (volumeSeries.length < 5) {
            return { detected: false, intensity: 0 };
        }

        const recentVolumes = volumeSeries.slice(-5);
        const currentVolume = recentVolumes[recentVolumes.length - 1];
        const previousVolume = recentVolumes[recentVolumes.length - 2];
        
        // Ani artış/azalış hesaplama
        const volumeChange = (currentVolume - previousVolume) / previousVolume;
        const avgRatio = currentVolume / averageVolume;
        
        // Shift detection kriterleri
        const suddenIncrease = volumeChange > 0.5 && avgRatio > 1.5;
        const suddenDecrease = volumeChange < -0.4 && avgRatio < 0.6;
        const gradualBuild = this.detectGradualBuild(recentVolumes, averageVolume);
        
        return {
            detected: suddenIncrease || suddenDecrease || gradualBuild,
            type: suddenIncrease ? 'spike' : suddenDecrease ? 'collapse' : gradualBuild ? 'gradual' : 'none',
            intensity: Math.abs(volumeChange),
            avgRatio: avgRatio,
            timeProximity: timeToEvent
        };
    }

    detectGradualBuild(volumes, avgVolume) {
        if (volumes.length < 4) return false;
        
        // Son 4 mumda sürekli artış var mı?
        let consecutiveIncrease = 0;
        for (let i = 1; i < volumes.length; i++) {
            if (volumes[i] > volumes[i-1]) {
                consecutiveIncrease++;
            }
        }
        
        const lastVolume = volumes[volumes.length - 1];
        return consecutiveIncrease >= 3 && lastVolume > avgVolume * 1.3;
    }

    calculateVolumeStrength(data) {
        const { breakoutBarVolume, averageVolume, volumeMomentum, volumeSeries } = data;
        
        if (!breakoutBarVolume || !averageVolume) {
            return this.calculateAlternativeStrength(data);
        }

        // Base calculation
        const volumeRatio = breakoutBarVolume / averageVolume;
        const momentumComponent = volumeMomentum || this.calculateMomentum(volumeSeries);
        
        let strength = (volumeRatio * 0.6) + (momentumComponent * 0.4);
        
        // Normalize to 0-1 range
        strength = Math.min(1, strength / 5); // 5x average volume = max strength
        
        // Adjustments based on context
        strength = this.applyContextualAdjustments(strength, data);
        
        return Math.max(0, Math.min(1, strength));
    }

    calculateAlternativeStrength(data) {
        const { volumeSeries, averageVolume } = data;
        
        if (!volumeSeries || volumeSeries.length < 3) return 0;
        
        const currentVolume = volumeSeries[volumeSeries.length - 1];
        const momentum = this.calculateMomentum(volumeSeries);
        
        return Math.min(1, (currentVolume / averageVolume * 0.7 + momentum * 0.3) / 3);
    }

    calculateMomentum(volumeSeries) {
        if (!volumeSeries || volumeSeries.length < 3) return 0;
        
        const recent = volumeSeries.slice(-3);
        let momentum = 0;
        
        for (let i = 1; i < recent.length; i++) {
            const change = (recent[i] - recent[i-1]) / recent[i-1];
            momentum += change;
        }
        
        return momentum / (recent.length - 1);
    }

    applyContextualAdjustments(baseStrength, data) {
        const { formationType, priceAction, timeToEvent } = data;
        let adjustedStrength = baseStrength;
        
        // Formation type adjustment
        if (formationType === 'ascending-triangle' || formationType === 'bullish-flag') {
            adjustedStrength *= 1.1; // Bullish patterns benefit more from volume
        } else if (formationType === 'descending-triangle' || formationType === 'bearish-flag') {
            adjustedStrength *= 1.05;
        }
        
        // Price action context
        if (priceAction === 'breakout') {
            adjustedStrength *= 1.15; // Breakout volume more significant
        } else if (priceAction === 'consolidation') {
            adjustedStrength *= 0.9; // Lower volume expected during consolidation
        }
        
        // Time proximity factor
        if (timeToEvent && timeToEvent < 5) {
            adjustedStrength *= 1.1; // Higher weight if near event
        }
        
        return adjustedStrength;
    }

    analyzeBreakoutVolume(data) {
        const { priceAction, breakoutBarVolume, averageVolume, formationType } = data;
        
        if (priceAction !== 'breakout' || !breakoutBarVolume) {
            return { confirmed: false, strength: 0 };
        }
        
        const volumeRatio = breakoutBarVolume / averageVolume;
        
        // Breakout confirmation thresholds
        const thresholds = {
            weak: 1.2,
            moderate: 1.8,
            strong: 2.5,
            exceptional: 4.0
        };
        
        let confirmationLevel = 'none';
        if (volumeRatio >= thresholds.exceptional) confirmationLevel = 'exceptional';
        else if (volumeRatio >= thresholds.strong) confirmationLevel = 'strong';
        else if (volumeRatio >= thresholds.moderate) confirmationLevel = 'moderate';
        else if (volumeRatio >= thresholds.weak) confirmationLevel = 'weak';
        
        return {
            confirmed: volumeRatio >= thresholds.weak,
            strength: Math.min(1, volumeRatio / thresholds.exceptional),
            level: confirmationLevel,
            volumeRatio: volumeRatio,
            formationSupport: this.checkFormationVolumeSupport(formationType, volumeRatio)
        };
    }

    checkFormationVolumeSupport(formationType, volumeRatio) {
        const supportLevels = {
            'ascending-triangle': 1.5,
            'descending-triangle': 1.3,
            'symmetrical-triangle': 1.8,
            'bullish-flag': 1.4,
            'bearish-flag': 1.2,
            'head-shoulders': 2.0,
            'cup-handle': 1.6
        };
        
        const requiredRatio = supportLevels[formationType] || 1.5;
        return volumeRatio >= requiredRatio;
    }

    determineShiftType(data, volumeShift, breakoutAnalysis) {
        const { priceAction, formationType } = data;
        
        if (breakoutAnalysis.confirmed && priceAction === 'breakout') {
            return 'breakout-confirmation';
        }
        
        if (volumeShift.type === 'spike' && !breakoutAnalysis.confirmed) {
            return 'pump-attempt';
        }
        
        if (volumeShift.type === 'collapse') {
            return 'sell-off';
        }
        
        if (volumeShift.type === 'gradual' && priceAction === 'consolidation') {
            return 'accumulation';
        }
        
        if (volumeShift.detected && volumeShift.intensity > 0.3) {
            return 'momentum-shift';
        }
        
        return 'normal-flow';
    }

    detectVolumeSpike(data) {
        const { volumeSeries, averageVolume } = data;
        
        if (!volumeSeries || volumeSeries.length === 0) return null;
        
        const currentVolume = volumeSeries[volumeSeries.length - 1];
        const ratio = currentVolume / averageVolume;
        
        let spikeLevel = 'none';
        if (ratio >= this.spikeThresholds.extreme) spikeLevel = 'extreme';
        else if (ratio >= this.spikeThresholds.strong) spikeLevel = 'strong';
        else if (ratio >= this.spikeThresholds.moderate) spikeLevel = 'moderate';
        else if (ratio >= this.spikeThresholds.mild) spikeLevel = 'mild';
        
        return {
            detected: ratio >= this.spikeThresholds.mild,
            level: spikeLevel,
            ratio: ratio,
            riskFlag: ratio >= this.spikeThresholds.extreme // Extreme spike = potential manipulation
        };
    }

    calculateVolumeMetrics(data) {
        const { volumeSeries, averageVolume, ohlcv } = data;
        
        return {
            volumeStandardDeviation: this.calculateStandardDeviation(volumeSeries),
            volumeTrend: this.calculateVolumeTrend(volumeSeries),
            priceVolumeCorrelation: this.calculatePriceVolumeCorrelation(ohlcv),
            volumeEfficiency: this.calculateVolumeEfficiency(data)
        };
    }

    calculateStandardDeviation(volumes) {
        if (!volumes || volumes.length < 2) return 0;
        
        const mean = volumes.reduce((sum, vol) => sum + vol, 0) / volumes.length;
        const variance = volumes.reduce((sum, vol) => sum + Math.pow(vol - mean, 2), 0) / volumes.length;
        return Math.sqrt(variance);
    }

    calculateVolumeTrend(volumes) {
        if (!volumes || volumes.length < 5) return 0;
        
        const recentAvg = volumes.slice(-3).reduce((sum, vol) => sum + vol, 0) / 3;
        const olderAvg = volumes.slice(-6, -3).reduce((sum, vol) => sum + vol, 0) / 3;
        
        return (recentAvg - olderAvg) / olderAvg;
    }

    calculatePriceVolumeCorrelation(ohlcv) {
        if (!ohlcv || ohlcv.length < 5) return 0;
        
        const prices = ohlcv.map(candle => candle.close);
        const volumes = ohlcv.map(candle => candle.volume);
        
        return this.pearsonCorrelation(prices, volumes);
    }

    pearsonCorrelation(x, y) {
        if (x.length !== y.length || x.length < 2) return 0;
        
        const n = x.length;
        const sumX = x.reduce((sum, val) => sum + val, 0);
        const sumY = y.reduce((sum, val) => sum + val, 0);
        const sumXY = x.reduce((sum, val, i) => sum + val * y[i], 0);
        const sumX2 = x.reduce((sum, val) => sum + val * val, 0);
        const sumY2 = y.reduce((sum, val) => sum + val * val, 0);
        
        const numerator = n * sumXY - sumX * sumY;
        const denominator = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));
        
        return denominator === 0 ? 0 : numerator / denominator;
    }

    calculateVolumeEfficiency(data) {
        const { volumeSeries, ohlcv } = data;
        
        if (!ohlcv || ohlcv.length < 3) return 0;
        
        // Price movement vs volume efficiency
        const priceRange = Math.abs(ohlcv[ohlcv.length - 1].close - ohlcv[0].close);
        const totalVolume = volumeSeries.reduce((sum, vol) => sum + vol, 0);
        
        return totalVolume > 0 ? priceRange / totalVolume : 0;
    }

    assessTrapRisk(data) {
        const { volumeSeries, priceAction, formationType, averageVolume } = data;
        
        const currentVolume = volumeSeries[volumeSeries.length - 1];
        const volumeRatio = currentVolume / averageVolume;
        
        // High volume without proper formation = potential trap
        const highVolumeNoFormation = volumeRatio > 3.0 && !formationType;
        const extremeSpikeWithoutBreakout = volumeRatio > 5.0 && priceAction !== 'breakout';
        
        return {
            riskLevel: highVolumeNoFormation || extremeSpikeWithoutBreakout ? 'high' : 'low',
            factors: {
                highVolumeNoFormation,
                extremeSpikeWithoutBreakout,
                volumeRatio
            }
        };
    }

    checkLiquidityZone(data) {
        const { volumeSeries, averageVolume, currentPrice, ohlcv } = data;
        
        if (!ohlcv || ohlcv.length < 10) return false;
        
        const currentVolume = volumeSeries[volumeSeries.length - 1];
        const recentHighVolume = currentVolume > averageVolume * 2.0;
        
        // Check if current price is near previous high volume areas
        const volumeZones = this.identifyVolumeZones(ohlcv);
        const nearVolumeZone = volumeZones.some(zone => 
            Math.abs(currentPrice - zone.price) / currentPrice < 0.01
        );
        
        return recentHighVolume && nearVolumeZone;
    }

    identifyVolumeZones(ohlcv) {
        const zones = [];
        const lookback = Math.min(20, ohlcv.length);
        
        for (let i = ohlcv.length - lookback; i < ohlcv.length; i++) {
            const candle = ohlcv[i];
            if (candle.volume > this.getAverageVolume(ohlcv, i) * 1.8) {
                zones.push({
                    price: candle.close,
                    volume: candle.volume,
                    timestamp: i
                });
            }
        }
        
        return zones;
    }

    getAverageVolume(ohlcv, endIndex) {
        const start = Math.max(0, endIndex - 10);
        const volumes = ohlcv.slice(start, endIndex).map(c => c.volume);
        return volumes.reduce((sum, vol) => sum + vol, 0) / volumes.length;
    }

    generateModularRecommendations(volumeStrength, shiftType, breakoutAnalysis) {
        const recommendations = {
            confirmationSignalBridge: {
                confidenceBoost: volumeStrength >= 0.75 ? 0.07 : 0,
                volumeConfirmation: breakoutAnalysis.confirmed,
                strengthLevel: volumeStrength
            },
            tpOptimizer: {
                allowAggressiveTP: volumeStrength >= 0.8 && breakoutAnalysis.confirmed,
                volumeSupport: shiftType === 'breakout-confirmation',
                adjustTPBasedOnVolume: true
            },
            riskToRewardValidator: {
                validateWithVolume: true,
                volumeStrength: volumeStrength,
                volumeRiskAdjustment: shiftType === 'pump-attempt' ? 0.2 : 0
            },
            coreOrchestrator: {
                volumeOverride: volumeStrength >= 0.9,
                blockOnWeakVolume: volumeStrength < 0.3 && shiftType !== 'normal-flow'
            }
        };

        // Trap risk durumunda özel öneriler
        if (shiftType === 'pump-attempt') {
            recommendations.coreOrchestrator.trapRiskWarning = true;
            recommendations.coreOrchestrator.requireStrongerConfirmation = true;
        }

        return recommendations;
    }

    generateAlert(volumeStrength, shiftType, volumeShift) {
        if (shiftType === 'breakout-confirmation' && volumeStrength >= 0.8) {
            return "Hacim artışı kırılımı destekliyor — sinyal güçleniyor";
        } else if (shiftType === 'pump-attempt') {
            return "⚠️ Ani hacim artışı tespit edildi — pump/dump riski";
        } else if (shiftType === 'sell-off') {
            return "Hacim çöküşü — satış baskısı artıyor";
        } else if (shiftType === 'accumulation') {
            return "Kademeli hacim artışı — birikim devam ediyor";
        } else if (volumeStrength >= 0.75) {
            return "Güçlü hacim desteği tespit edildi";
        } else if (volumeStrength < 0.3) {
            return "⚠️ Zayıf hacim — sinyal güvenilirliği düşük";
        } else {
            return "Hacim analizi tamamlandı — normal akış";
        }
    }

    updateVolumeHistory(data) {
        const { volumeSeries, averageVolume } = data;
        
        if (volumeSeries && volumeSeries.length > 0) {
            this.volumeHistory.push({
                timestamp: Date.now(),
                volume: volumeSeries[volumeSeries.length - 1],
                averageVolume: averageVolume,
                ratio: volumeSeries[volumeSeries.length - 1] / averageVolume
            });
            
            // History limit kontrolü
            if (this.volumeHistory.length > this.maxHistoryLength) {
                this.volumeHistory = this.volumeHistory.slice(-this.maxHistoryLength);
            }
        }
    }

    getDefaultResult() {
        return {
            volumeShiftDetected: false,
            shiftType: 'normal-flow',
            volumeStrength: 0,
            volumeSpike: null,
            breakoutConfirmation: { confirmed: false, strength: 0 },
            modularRecommendations: {},
            alert: "Hacim analizi yapılamadı",
            metadata: {
                error: true,
                analysisTimestamp: Date.now()
            }
        };
    }

    getModuleInfo() {
        return {
            name: 'VolumeShiftAnalyzer',
            version: '1.0.0',
            description: 'Ani hacim değişimlerini analiz eder ve formasyonun güçlülüğünü değerlendirir',
            inputs: [
                'volumeSeries', 'averageVolume', 'priceAction', 'formationType',
                'breakoutBarVolume', 'volumeMomentum', 'timeToEvent', 'ohlcv'
            ],
            outputs: [
                'volumeShiftDetected', 'shiftType', 'volumeStrength', 'volumeSpike',
                'breakoutConfirmation', 'modularRecommendations', 'alert', 'metadata'
            ]
        };
    }
}

module.exports = VolumeShiftAnalyzer;
