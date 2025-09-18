// technicalIndicatorsEngine.js
// GELİŞMİŞ Teknik Göstergeler Motoru - Ek modüller.txt prompt'una göre geliştirildi
// Binance verilerinden EMA, RSI, MACD, Bollinger, ATR, VWAP hesaplama
// Modüler ve cache'li sistem ile tüm Grafik Beyni modüllerine veri sağlama

const axios = require('axios');
const technicalindicators = require('technicalindicators');

/**
 * Enhanced Technical Indicators Engine
 * Gelişmiş teknik gösterge motoru - Ek modüller.txt'deki prompt'a göre implementasyon
 */
class TechnicalIndicatorsEngine {
    constructor() {
        this.moduleName = 'technicalIndicatorsEngine';
        this.cache = new Map();
        this.cacheExpiry = 60 * 1000; // 1 dakika cache
        this.binanceBaseUrl = 'https://api.binance.com/api/v3';
        this.retryLimit = 3;
        this.requestTimeout = 10000;
        
        // Indicator parameters (ek modüller.txt'den)
        this.indicators = {
            ema: {
                periods: [9, 21, 50, 200],
                smoothing: 2
            },
            rsi: {
                period: 14,
                overbought: 70,
                oversold: 30
            },
            macd: {
                fastPeriod: 12,
                slowPeriod: 26,
                signalPeriod: 9
            },
            bollinger: {
                period: 20,
                stdDev: 2.0
            },
            atr: {
                period: 14
            },
            vwap: {
                resetDaily: true
            }
        };
        
        this.performanceMetrics = {
            requests: 0,
            cacheHits: 0,
            cacheMisses: 0,
            errors: 0,
            avgResponseTime: 0
        };
    }

    /**
     * Ana gösterge hesaplama fonksiyonu - ek modüller.txt formatında
     */
    async getIndicators(symbol, interval = '5m', limit = 200) {
        const startTime = Date.now();
        
        try {
            // Cache kontrolü
            const cacheKey = `${symbol}_${interval}`;
            const cached = this.getCachedData(cacheKey);
            
            if (cached) {
                this.performanceMetrics.cacheHits++;
                return cached;
            }
            
            this.performanceMetrics.cacheMisses++;
            
            // Binance'den veri çekme (retry ile)
            const ohlcvData = await this.fetchOHLCVDataWithRetry(symbol, interval, limit);
            
            if (!ohlcvData || ohlcvData.length < 50) {
                throw new Error(`Insufficient data for ${symbol} ${interval}`);
            }
            
            // OHLCV verilerini parse etme
            const parsedData = this.parseOHLCVData(ohlcvData);
            
            // Göstergeleri hesaplama
            const indicators = await this.calculateAllIndicators(parsedData);
            
            // Sonucu ek modüller.txt formatında formatlama
            const result = this.formatResultAsSpecified(symbol, interval, indicators, parsedData);
            
            // Cache'e kaydetme
            this.setCachedData(cacheKey, result);
            
            // Performance tracking
            this.updatePerformanceMetrics(startTime);
            
            return result;
            
        } catch (error) {
            this.performanceMetrics.errors++;
            console.warn(`TechnicalIndicatorsEngine error for ${symbol} ${interval}:`, error.message);
            return this.getDefaultIndicatorResult(symbol, interval, error.message);
        }
    }

    /**
     * Binance API'den retry mekanizması ile veri çekme
     */
    async fetchOHLCVDataWithRetry(symbol, interval, limit) {
        const url = `${this.binanceBaseUrl}/klines`;
        const params = {
            symbol: symbol.toUpperCase(),
            interval: interval,
            limit: limit
        };
        
        for (let attempt = 1; attempt <= this.retryLimit; attempt++) {
            try {
                const response = await axios.get(url, {
                    params: params,
                    timeout: this.requestTimeout
                });
                
                this.performanceMetrics.requests++;
                return response.data;
                
            } catch (error) {
                console.warn(`Binance API attempt ${attempt}/${this.retryLimit} failed:`, error.message);
                
                if (attempt === this.retryLimit) {
                    throw new Error(`Binance API failed after ${this.retryLimit} attempts: ${error.message}`);
                }
                
                // Exponential backoff
                await this.delay(Math.pow(2, attempt) * 1000);
            }
        }
    }

    /**
     * OHLCV verilerini parse etme
     */
    parseOHLCVData(rawData) {
        const parsed = {
            timestamps: [],
            opens: [],
            highs: [],
            lows: [],
            closes: [],
            volumes: [],
            typicalPrices: []
        };
        
        rawData.forEach(candle => {
            const timestamp = parseInt(candle[0]);
            const open = parseFloat(candle[1]);
            const high = parseFloat(candle[2]);
            const low = parseFloat(candle[3]);
            const close = parseFloat(candle[4]);
            const volume = parseFloat(candle[5]);
            
            // Validity check
            if (this.isValidOHLCV(open, high, low, close, volume)) {
                parsed.timestamps.push(timestamp);
                parsed.opens.push(open);
                parsed.highs.push(high);
                parsed.lows.push(low);
                parsed.closes.push(close);
                parsed.volumes.push(volume);
                
                // Typical price for VWAP
                const typicalPrice = (high + low + close) / 3;
                parsed.typicalPrices.push(typicalPrice);
            }
        });
        
        return parsed;
    }

    /**
     * Tüm göstergeleri hesaplama
     */
    async calculateAllIndicators(data) {
        const indicators = {};
        
        try {
            // EMA hesaplamaları (9, 21, 50, 200)
            this.indicators.ema.periods.forEach(period => {
                const emaResult = technicalindicators.EMA.calculate({ 
                    period: period, 
                    values: data.closes 
                });
                indicators[`ema${period}`] = emaResult.length > 0 ? 
                    emaResult[emaResult.length - 1] : null;
            });
            
            // RSI hesaplama (14)
            const rsiResult = technicalindicators.RSI.calculate({ 
                period: this.indicators.rsi.period, 
                values: data.closes 
            });
            indicators.rsi14 = rsiResult.length > 0 ? rsiResult[rsiResult.length - 1] : null;
            
            // MACD hesaplama (12, 26, 9)
            const macdResult = technicalindicators.MACD.calculate({
                values: data.closes,
                fastPeriod: this.indicators.macd.fastPeriod,
                slowPeriod: this.indicators.macd.slowPeriod,
                signalPeriod: this.indicators.macd.signalPeriod,
                SimpleMAOscillator: false,
                SimpleMASignal: false
            });
            
            if (macdResult.length > 0) {
                const lastMacd = macdResult[macdResult.length - 1];
                indicators.macd = {
                    line: lastMacd.MACD || 0,
                    signal: lastMacd.signal || 0,
                    histogram: lastMacd.histogram || 0
                };
            } else {
                indicators.macd = { line: 0, signal: 0, histogram: 0 };
            }
            
            // Bollinger Bands hesaplama (20, 2.0 std)
            const bollingerResult = technicalindicators.BollingerBands.calculate({
                period: this.indicators.bollinger.period,
                values: data.closes,
                stdDev: this.indicators.bollinger.stdDev
            });
            
            if (bollingerResult.length > 0) {
                const lastBollinger = bollingerResult[bollingerResult.length - 1];
                indicators.bollinger = {
                    upper: lastBollinger.upper || 0,
                    middle: lastBollinger.middle || 0,
                    lower: lastBollinger.lower || 0
                };
            } else {
                indicators.bollinger = { upper: 0, middle: 0, lower: 0 };
            }
            
            // ATR hesaplama (14)
            const atrResult = technicalindicators.ATR.calculate({
                period: this.indicators.atr.period,
                high: data.highs,
                low: data.lows,
                close: data.closes
            });
            indicators.atr14 = atrResult.length > 0 ? atrResult[atrResult.length - 1] : null;
            
            // VWAP hesaplama (günlük hacim ağırlıklı ortalama fiyat)
            indicators.vwap = this.calculateVWAP(data.typicalPrices, data.volumes);
            
        } catch (error) {
            console.error('Indicator calculation error:', error.message);
        }
        
        return indicators;
    }

    /**
     * VWAP hesaplama (manuel implementation)
     */
    calculateVWAP(typicalPrices, volumes) {
        if (typicalPrices.length !== volumes.length || typicalPrices.length === 0) {
            return null;
        }
        
        let totalTPV = 0; // Total Typical Price * Volume
        let totalVolume = 0;
        
        for (let i = 0; i < typicalPrices.length; i++) {
            totalTPV += typicalPrices[i] * volumes[i];
            totalVolume += volumes[i];
        }
        
        return totalVolume > 0 ? totalTPV / totalVolume : null;
    }

    /**
     * Sonucu ek modüller.txt'deki format'a göre formatlama
     */
    formatResultAsSpecified(symbol, interval, indicators, data) {
        return {
            symbol: symbol.toUpperCase(),
            interval: interval,
            timestamp: Date.now(),
            indicators: {
                ema9: this.safeIndicatorValue(indicators.ema9),
                ema21: this.safeIndicatorValue(indicators.ema21),
                ema50: this.safeIndicatorValue(indicators.ema50),
                ema200: this.safeIndicatorValue(indicators.ema200),
                rsi14: this.safeIndicatorValue(indicators.rsi14),
                macd: {
                    line: this.safeIndicatorValue(indicators.macd?.line),
                    signal: this.safeIndicatorValue(indicators.macd?.signal),
                    histogram: this.safeIndicatorValue(indicators.macd?.histogram)
                },
                bollinger: {
                    upper: this.safeIndicatorValue(indicators.bollinger?.upper),
                    middle: this.safeIndicatorValue(indicators.bollinger?.middle),
                    lower: this.safeIndicatorValue(indicators.bollinger?.lower)
                },
                atr14: this.safeIndicatorValue(indicators.atr14),
                vwap: this.safeIndicatorValue(indicators.vwap)
            },
            isValid: this.validateIndicators(indicators),
            metadata: {
                dataPoints: data.closes.length,
                calculationTime: Date.now(),
                cacheStatus: 'fresh',
                performanceMetrics: this.performanceMetrics
            }
        };
    }

    /**
     * NaN-safe default değer verme
     */
    safeIndicatorValue(value) {
        if (value === null || value === undefined || isNaN(value)) {
            return 0.0;
        }
        return parseFloat(value.toFixed(8));
    }

    /**
     * Göstergeler geçerli mi kontrolü
     */
    validateIndicators(indicators) {
        const requiredIndicators = ['ema21', 'rsi14', 'macd'];
        
        return requiredIndicators.every(indicator => {
            if (indicator === 'macd') {
                return indicators.macd && 
                       typeof indicators.macd.line === 'number' &&
                       !isNaN(indicators.macd.line);
            }
            return indicators[indicator] !== null && 
                   indicators[indicator] !== undefined && 
                   !isNaN(indicators[indicator]);
        });
    }

    // Cache management
    getCachedData(key) {
        const cached = this.cache.get(key);
        if (cached && (Date.now() - cached.timestamp) < this.cacheExpiry) {
            return cached.data;
        }
        this.cache.delete(key);
        return null;
    }

    setCachedData(key, data) {
        this.cache.set(key, {
            data: data,
            timestamp: Date.now()
        });
    }

    // Utility methods
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    isValidOHLCV(open, high, low, close, volume) {
        return open > 0 && high > 0 && low > 0 && close > 0 && volume >= 0 &&
               high >= Math.max(open, close) && low <= Math.min(open, close);
    }

    updatePerformanceMetrics(startTime) {
        const responseTime = Date.now() - startTime;
        this.performanceMetrics.avgResponseTime = 
            (this.performanceMetrics.avgResponseTime + responseTime) / 2;
    }

    getDefaultIndicatorResult(symbol, interval, errorMessage) {
        return {
            symbol: symbol.toUpperCase(),
            interval: interval,
            timestamp: Date.now(),
            indicators: {
                ema9: 0.0, ema21: 0.0, ema50: 0.0, ema200: 0.0,
                rsi14: 0.0,
                macd: { line: 0.0, signal: 0.0, histogram: 0.0 },
                bollinger: { upper: 0.0, middle: 0.0, lower: 0.0 },
                atr14: 0.0,
                vwap: 0.0
            },
            isValid: false,
            error: errorMessage,
            metadata: {
                dataPoints: 0,
                calculationTime: Date.now(),
                cacheStatus: 'error',
                performanceMetrics: this.performanceMetrics
            }
        };
    }

    getModuleInfo() {
        return {
            name: 'TechnicalIndicatorsEngine',
            version: '2.0.0',
            description: 'GELİŞMİŞ Teknik Göstergeler Motoru - Ek modüller.txt prompt\'una göre geliştirildi',
            supportedIndicators: ['EMA(9,21,50,200)', 'RSI(14)', 'MACD(12,26,9)', 'Bollinger(20,2.0)', 'ATR(14)', 'VWAP'],
            cacheExpiry: this.cacheExpiry / 1000 + 's',
            performanceMetrics: this.performanceMetrics
        };
    }
}

// Singleton instance oluşturma
const technicalIndicatorsEngine = new TechnicalIndicatorsEngine();

// Legacy function compatibility
async function getIndicators(symbol, interval) {
    return await technicalIndicatorsEngine.getIndicators(symbol, interval);
}

module.exports = { 
    TechnicalIndicatorsEngine,
    getIndicators,
    // Legacy exports
    technicalIndicatorsEngine
}; 