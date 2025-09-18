const GrafikBeyniModuleBase = require('../grafikBeyniModuleBase');

/**
 * Trend Line Constructor Module
 * Son mumların dip/tepe noktalarını analiz ederek trend çizgilerini çıkarır
 * Trendin eğimi, güven skoru, test sayısı ve sapma oranına göre geçerliliğini belirler
 * Diğer modüllerle birlikte çalışır: formasyon, trend, çıkış, giriş
 */
class TrendLineConstructor extends GrafikBeyniModuleBase {
    constructor() {
        super('trendLineConstructor');
        this.trendLineHistory = [];
        this.maxHistoryLength = 100;
        this.minTouchPoints = 3;
        this.maxDeviation = 0.025; // %2.5
    }

    async analyze(data) {
        try {
            const {
                ohlcv,
                lookbackPeriod = 40,
                minTouchPoints = this.minTouchPoints,
                maxDeviation = this.maxDeviation,
                timeFrame,
                currentPrice
            } = data;

            // Veri doğrulama
            if (!ohlcv || ohlcv.length < 10) {
                throw new Error('Missing required OHLCV data for trend line construction');
            }

            // Trend çizgilerini oluştur
            const upTrendLines = this.constructUpTrendLines(ohlcv, lookbackPeriod, minTouchPoints, maxDeviation);
            const downTrendLines = this.constructDownTrendLines(ohlcv, lookbackPeriod, minTouchPoints, maxDeviation);
            
            // Tüm trend çizgilerini birleştir ve skorla
            const allTrendLines = upTrendLines.concat(downTrendLines);
            const scoredTrendLines = this.scoreTrendLines(allTrendLines, ohlcv, currentPrice);
            
            // En güçlü trend çizgilerini seç
            const dominantTrendLines = this.selectDominantTrendLines(scoredTrendLines);

            const result = {
                trendLines: dominantTrendLines,
                trendLineCount: {
                    uptrend: upTrendLines.length,
                    downtrend: downTrendLines.length,
                    total: allTrendLines.length
                },
                dominantDirection: this.determineDominantDirection(dominantTrendLines),
                modularRecommendations: this.generateModularRecommendations(dominantTrendLines, currentPrice),
                alert: this.generateAlert(dominantTrendLines, currentPrice),
                metadata: {
                    analysisTimestamp: Date.now(),
                    lookbackPeriod: lookbackPeriod,
                    timeFrame: timeFrame,
                    constructionQuality: this.assessConstructionQuality(allTrendLines)
                }
            };

            // Trend line geçmişi güncelleme
            this.updateTrendLineHistory(dominantTrendLines);
            
            // Cache ve performance tracking
            this.updateCache(data, result);
            this.trackPerformance(Date.now(), dominantTrendLines.length > 0);

            return result;

        } catch (error) {
            this.handleError('TrendLineConstructor analysis failed', error, data);
            return this.getDefaultResult();
        }
    }

    constructUpTrendLines(ohlcv, lookbackPeriod, minTouchPoints, maxDeviation) {
        const trendLines = [];
        const candles = ohlcv.slice(-lookbackPeriod);
        
        // Dip noktalarını (swing lows) bul
        const swingLows = this.findSwingLows(candles);
        
        // Her swing low kombinasyonunu test et
        for (let i = 0; i < swingLows.length - 1; i++) {
            for (let j = i + 1; j < swingLows.length; j++) {
                const point1 = swingLows[i];
                const point2 = swingLows[j];
                
                // Trend çizgisi parametrelerini hesapla
                const slope = this.calculateSlope(point1, point2);
                const trendLine = this.extendTrendLine(point1, point2, candles.length);
                
                // Bu trend çizgisini test eden diğer noktaları bul
                const touchPoints = this.findTouchPoints(trendLine, candles, maxDeviation, 'uptrend');
                
                if (touchPoints.length >= minTouchPoints) {
                    const deviation = this.calculateDeviation(touchPoints, trendLine);
                    
                    trendLines.push({
                        type: 'uptrend',
                        points: [point1.price, point2.price, ...touchPoints.map(p => p.price)],
                        indices: [point1.index, point2.index, ...touchPoints.map(p => p.index)],
                        slope: slope,
                        length: j - i,
                        deviation: deviation,
                        touchCount: touchPoints.length + 2, // +2 for initial points
                        confidence: 0, // Will be calculated later
                        equation: trendLine
                    });
                }
            }
        }
        
        return trendLines;
    }

    constructDownTrendLines(ohlcv, lookbackPeriod, minTouchPoints, maxDeviation) {
        const trendLines = [];
        const candles = ohlcv.slice(-lookbackPeriod);
        
        // Tepe noktalarını (swing highs) bul
        const swingHighs = this.findSwingHighs(candles);
        
        // Her swing high kombinasyonunu test et
        for (let i = 0; i < swingHighs.length - 1; i++) {
            for (let j = i + 1; j < swingHighs.length; j++) {
                const point1 = swingHighs[i];
                const point2 = swingHighs[j];
                
                // Trend çizgisi parametrelerini hesapla
                const slope = this.calculateSlope(point1, point2);
                const trendLine = this.extendTrendLine(point1, point2, candles.length);
                
                // Bu trend çizgisini test eden diğer noktaları bul
                const touchPoints = this.findTouchPoints(trendLine, candles, maxDeviation, 'downtrend');
                
                if (touchPoints.length >= minTouchPoints) {
                    const deviation = this.calculateDeviation(touchPoints, trendLine);
                    
                    trendLines.push({
                        type: 'downtrend',
                        points: [point1.price, point2.price, ...touchPoints.map(p => p.price)],
                        indices: [point1.index, point2.index, ...touchPoints.map(p => p.index)],
                        slope: slope,
                        length: j - i,
                        deviation: deviation,
                        touchCount: touchPoints.length + 2,
                        confidence: 0,
                        equation: trendLine
                    });
                }
            }
        }
        
        return trendLines;
    }

    findSwingLows(candles) {
        const swingLows = [];
        const lookback = 2;
        
        for (let i = lookback; i < candles.length - lookback; i++) {
            const current = candles[i];
            let isSwingLow = true;
            
            // Önceki ve sonraki mumları kontrol et
            for (let j = i - lookback; j <= i + lookback; j++) {
                if (j !== i && candles[j].low <= current.low) {
                    isSwingLow = false;
                    break;
                }
            }
            
            if (isSwingLow) {
                swingLows.push({
                    index: i,
                    price: current.low,
                    timestamp: current.timestamp || i
                });
            }
        }
        
        return swingLows;
    }

    findSwingHighs(candles) {
        const swingHighs = [];
        const lookback = 2;
        
        for (let i = lookback; i < candles.length - lookback; i++) {
            const current = candles[i];
            let isSwingHigh = true;
            
            // Önceki ve sonraki mumları kontrol et
            for (let j = i - lookback; j <= i + lookback; j++) {
                if (j !== i && candles[j].high >= current.high) {
                    isSwingHigh = false;
                    break;
                }
            }
            
            if (isSwingHigh) {
                swingHighs.push({
                    index: i,
                    price: current.high,
                    timestamp: current.timestamp || i
                });
            }
        }
        
        return swingHighs;
    }

    calculateSlope(point1, point2) {
        const xDiff = point2.index - point1.index;
        const yDiff = point2.price - point1.price;
        return xDiff === 0 ? 0 : yDiff / xDiff;
    }

    extendTrendLine(point1, point2, totalLength) {
        const slope = this.calculateSlope(point1, point2);
        const intercept = point1.price - (slope * point1.index);
        
        return {
            slope: slope,
            intercept: intercept,
            getPrice: (index) => slope * index + intercept
        };
    }

    findTouchPoints(trendLine, candles, maxDeviation, trendType) {
        const touchPoints = [];
        
        for (let i = 0; i < candles.length; i++) {
            const expectedPrice = trendLine.getPrice(i);
            const candle = candles[i];
            
            let actualPrice;
            if (trendType === 'uptrend') {
                actualPrice = candle.low;
            } else {
                actualPrice = candle.high;
            }
            
            const deviation = Math.abs(actualPrice - expectedPrice) / expectedPrice;
            
            if (deviation <= maxDeviation) {
                touchPoints.push({
                    index: i,
                    price: actualPrice,
                    expectedPrice: expectedPrice,
                    deviation: deviation
                });
            }
        }
        
        return touchPoints;
    }

    calculateDeviation(touchPoints, trendLine) {
        if (touchPoints.length === 0) return 1;
        
        const deviations = touchPoints.map(point => point.deviation);
        return deviations.reduce((sum, dev) => sum + dev, 0) / deviations.length;
    }

    scoreTrendLines(trendLines, ohlcv, currentPrice) {
        return trendLines.map(trendLine => {
            let confidence = 0;
            
            // Touch count faktörü (en önemli)
            confidence += Math.min(trendLine.touchCount * 0.15, 0.5);
            
            // Deviation faktörü (düşük sapma = yüksek güven)
            confidence += (1 - trendLine.deviation / this.maxDeviation) * 0.2;
            
            // Length faktörü (daha uzun trend = daha güvenilir)
            confidence += Math.min(trendLine.length / 20, 1) * 0.15;
            
            // Slope faktörü (makul eğim)
            const absSlope = Math.abs(trendLine.slope);
            const slopeScore = absSlope > 0.001 && absSlope < 0.1 ? 1 : 0.5;
            confidence += slopeScore * 0.1;
            
            // Current price proximity
            const currentTrendPrice = trendLine.equation.getPrice(ohlcv.length - 1);
            const proximityScore = 1 - Math.min(Math.abs(currentPrice - currentTrendPrice) / currentPrice, 0.05) / 0.05;
            confidence += proximityScore * 0.05;
            
            trendLine.confidence = Math.min(1, confidence);
            return trendLine;
        });
    }

    selectDominantTrendLines(scoredTrendLines, maxLines = 5) {
        return scoredTrendLines
            .filter(trendLine => trendLine.confidence >= 0.6)
            .sort((a, b) => b.confidence - a.confidence)
            .slice(0, maxLines);
    }

    determineDominantDirection(trendLines) {
        if (trendLines.length === 0) return 'neutral';
        
        const uptrendCount = trendLines.filter(t => t.type === 'uptrend').length;
        const downtrendCount = trendLines.filter(t => t.type === 'downtrend').length;
        
        if (uptrendCount > downtrendCount) return 'uptrend';
        if (downtrendCount > uptrendCount) return 'downtrend';
        return 'sideways';
    }

    assessConstructionQuality(trendLines) {
        if (trendLines.length === 0) return 'poor';
        
        const avgConfidence = trendLines.reduce((sum, t) => sum + t.confidence, 0) / trendLines.length;
        const avgTouchCount = trendLines.reduce((sum, t) => sum + t.touchCount, 0) / trendLines.length;
        
        const qualityScore = avgConfidence * 0.7 + Math.min(avgTouchCount / 5, 1) * 0.3;
        
        if (qualityScore >= 0.8) return 'excellent';
        if (qualityScore >= 0.6) return 'good';
        if (qualityScore >= 0.4) return 'fair';
        return 'poor';
    }

    generateModularRecommendations(trendLines, currentPrice) {
        const recommendations = {
            trendConfidenceEvaluator: {
                injectConstructedTrend: trendLines.length > 0,
                trendData: trendLines.map(t => ({
                    type: t.type,
                    confidence: t.confidence,
                    slope: t.slope
                }))
            },
            formationCompletenessJudge: {
                useTrendLinesForSupportResistance: true,
                trendLineSupport: trendLines.filter(t => t.type === 'uptrend'),
                trendLineResistance: trendLines.filter(t => t.type === 'downtrend')
            },
            priceBreakoutDetector: {
                monitorTrendLineBreaks: true,
                criticalTrendLines: trendLines.filter(t => t.confidence >= 0.8)
            },
            supportResistanceScanner: {
                enhanceWithTrendLines: true,
                dynamicLevels: this.extractTrendLineLevels(trendLines, currentPrice)
            }
        };

        return recommendations;
    }

    extractTrendLineLevels(trendLines, currentPrice) {
        return trendLines.map(trendLine => {
            const currentLevel = trendLine.equation.getPrice(trendLine.indices[trendLine.indices.length - 1]);
            return {
                price: currentLevel,
                type: trendLine.type === 'uptrend' ? 'support' : 'resistance',
                confidence: trendLine.confidence,
                slope: trendLine.slope
            };
        });
    }

    generateAlert(trendLines, currentPrice) {
        if (trendLines.length === 0) {
            return "Güçlü trend çizgisi tespit edilemedi";
        }

        const strongTrendLines = trendLines.filter(t => t.confidence >= 0.8);
        const dominantDirection = this.determineDominantDirection(trendLines);

        if (strongTrendLines.length > 0) {
            const strongest = strongTrendLines[0];
            const currentTrendPrice = strongest.equation.getPrice(strongest.indices[strongest.indices.length - 1]);
            const distance = Math.abs(currentPrice - currentTrendPrice) / currentPrice * 100;

            if (distance < 1) {
                return `Güçlü ${strongest.type} çizgisine yakın (${distance.toFixed(2)}% mesafe)`;
            } else {
                return `${strongTrendLines.length} güçlü trend çizgisi tespit edildi - ${dominantDirection}`;
            }
        } else {
            return `${trendLines.length} trend çizgisi oluşturuldu - orta güven seviyesi`;
        }
    }

    updateTrendLineHistory(trendLines) {
        this.trendLineHistory.push({
            timestamp: Date.now(),
            trendLines: trendLines.map(t => ({
                type: t.type,
                confidence: t.confidence,
                touchCount: t.touchCount,
                slope: t.slope
            }))
        });

        // History limit kontrolü
        if (this.trendLineHistory.length > this.maxHistoryLength) {
            this.trendLineHistory = this.trendLineHistory.slice(-this.maxHistoryLength);
        }
    }

    getDefaultResult() {
        return {
            trendLines: [],
            trendLineCount: {
                uptrend: 0,
                downtrend: 0,
                total: 0
            },
            dominantDirection: 'neutral',
            modularRecommendations: {},
            alert: "Trend çizgisi oluşturulamadı",
            metadata: {
                error: true,
                analysisTimestamp: Date.now()
            }
        };
    }

    getModuleInfo() {
        return {
            name: 'TrendLineConstructor',
            version: '1.0.0',
            description: 'Otomatik trend çizgisi oluşturur ve güvenilirliklerini değerlendirir',
            inputs: [
                'ohlcv', 'lookbackPeriod', 'minTouchPoints', 'maxDeviation', 
                'timeFrame', 'currentPrice'
            ],
            outputs: [
                'trendLines', 'trendLineCount', 'dominantDirection', 
                'modularRecommendations', 'alert', 'metadata'
            ]
        };
    }
}

module.exports = TrendLineConstructor;
