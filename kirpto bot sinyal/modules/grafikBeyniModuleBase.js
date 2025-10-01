/**
 * 🧠 Grafik Beyni - Base Module Class
 * Tüm Grafik Beyni modülleri bu base class'tan türer
 */

class GrafikBeyniModuleBase {
    constructor(name, config = {}) {
        this.name = name;
        this.config = {
            enabled: true,
            scoreThreshold: 0.5,
            maxSignalsPerAnalysis: 5,
            validationWindow: 3, // Son 3 sinyal için validation
            cacheEnabled: true,
            cacheDuration: 60000, // 1 dakika
            ...config
        };
        
        // Modül durumu
        this.isInitialized = false;
        this.lastAnalysis = null;
        this.signalHistory = [];
        this.cache = new Map();
        this.performance = {
            totalAnalyses: 0,
            totalSignals: 0,
            avgExecutionTime: 0,
            successRate: 0,
            lastValidation: null
        };
        
        this.initialize();
    }
    
    /**
     * Modül initialization - override edilebilir
     */
    initialize() {
        console.log(`🔧 Initializing module: ${this.name}`);
        this.isInitialized = true;
    }
    
    /**
     * Ana analiz fonksiyonu - her modül implement etmeli
     */
    async analyze(marketData) {
        if (!this.isInitialized) {
            throw new Error(`Module ${this.name} not initialized`);
        }
        
        const startTime = Date.now();
        
        try {
            // Cache kontrolü
            if (this.config.cacheEnabled) {
                const cached = this.getCachedResult(marketData);
                if (cached) {
                    return cached;
                }
            }
            
            // Asıl analiz - subclass implement etmeli
            const analysisResult = await this.performAnalysis(marketData);
            
            // Performans güncelleme
            const executionTime = Date.now() - startTime;
            this.updatePerformance(executionTime, analysisResult);
            
            // Cache'e kaydet
            if (this.config.cacheEnabled && analysisResult) {
                this.setCachedResult(marketData, analysisResult);
            }
            
            // Sinyal geçmişine ekle
            if (analysisResult && analysisResult.signals) {
                this.addToSignalHistory(analysisResult.signals);
            }
            
            this.lastAnalysis = {
                timestamp: Date.now(),
                result: analysisResult,
                executionTime
            };
            
            return analysisResult;
            
        } catch (error) {
            console.error(`❌ Analysis error in ${this.name}:`, error);
            return {
                signals: [],
                error: error.message,
                metadata: {
                    moduleName: this.name,
                    timestamp: Date.now(),
                    failed: true
                }
            };
        }
    }
    
    /**
     * Asıl analiz implementasyonu - override edilmeli
     */
    async performAnalysis(marketData) {
        throw new Error(`Module ${this.name} must implement performAnalysis() method`);
    }
    
    /**
     * Standart sinyal oluşturma helper'ı
     */
    createSignal(type, score, options = {}) {
        return {
            sinyalTipi: type,
            skor: Math.max(0, Math.min(1, score)),
            varyant: options.variant || 'default',
            teyitZinciri: options.confirmationChain || [],
            kullanıcıUyumu: options.userAlignment || 0.5,
            
            // Ek alanlar
            timestamp: Date.now(),
            marketCondition: options.marketCondition || 'unknown',
            riskLevel: options.riskLevel || 'medium',
            timeframe: options.timeframe || '15m',
            confidence: options.confidence || score,
            
            // Modül specific data
            sourceModule: this.name,
            analysis: options.analysis || {},
            recommendations: options.recommendations || [],
            
            // Debugging
            debugInfo: options.debugInfo || {}
        };
    }
    
    /**
     * Market condition helper
     */
    analyzeMarketCondition(marketData) {
        if (!marketData || !marketData.indicators) {
            return {
                trend: 'unknown',
                momentum: 'neutral',
                volatility: 'normal',
                strength: 0.5
            };
        }
        
        const indicators = marketData.indicators;
        
        // Trend analizi
        let trend = 'sideways';
        if (indicators.ema9 && indicators.ema21) {
            if (indicators.ema9 > indicators.ema21) {
                trend = indicators.ema21 > (indicators.ema50 || indicators.ema21) ? 'strong_bullish' : 'bullish';
            } else {
                trend = indicators.ema21 < (indicators.ema50 || indicators.ema21) ? 'strong_bearish' : 'bearish';
            }
        }
        
        // Momentum analizi
        let momentum = 'neutral';
        if (indicators.rsi14) {
            if (indicators.rsi14 > 70) momentum = 'overbought';
            else if (indicators.rsi14 < 30) momentum = 'oversold';
            else if (indicators.rsi14 > 60) momentum = 'bullish';
            else if (indicators.rsi14 < 40) momentum = 'bearish';
        }
        
        // Volatilite analizi
        let volatility = 'normal';
        if (indicators.atr14 && marketData.price) {
            const atrRatio = indicators.atr14 / marketData.price;
            if (atrRatio > 0.03) volatility = 'high';
            else if (atrRatio < 0.01) volatility = 'low';
        }
        
        return {
            trend,
            momentum,
            volatility,
            strength: this.calculateTrendStrength(indicators)
        };
    }
    
    /**
     * Trend gücü hesaplama
     */
    calculateTrendStrength(indicators) {
        let strength = 0.5;
        
        // EMA alignment
        if (indicators.ema9 && indicators.ema21 && indicators.ema50) {
            if ((indicators.ema9 > indicators.ema21 && indicators.ema21 > indicators.ema50) ||
                (indicators.ema9 < indicators.ema21 && indicators.ema21 < indicators.ema50)) {
                strength += 0.2;
            }
        }
        
        // MACD confirmation
        if (indicators.macd && indicators.macd.line && indicators.macd.signal) {
            if ((indicators.macd.line > indicators.macd.signal && indicators.ema9 > indicators.ema21) ||
                (indicators.macd.line < indicators.macd.signal && indicators.ema9 < indicators.ema21)) {
                strength += 0.2;
            }
        }
        
        // Volume confirmation
        if (indicators.volume && indicators.avgVolume) {
            if (indicators.volume > indicators.avgVolume * 1.2) {
                strength += 0.1;
            }
        }
        
        return Math.max(0, Math.min(1, strength));
    }
    
    /**
     * Cache işlemleri
     */
    getCachedResult(marketData) {
        if (!this.config.cacheEnabled) return null;
        
        const cacheKey = this.generateCacheKey(marketData);
        const cached = this.cache.get(cacheKey);
        
        if (cached && (Date.now() - cached.timestamp) < this.config.cacheDuration) {
            return cached.result;
        }
        
        return null;
    }
    
    cacheResult(marketData, result) {
        this.setCachedResult(marketData, result);
    }

    setCachedResult(marketData, result) {
        if (!this.config.cacheEnabled) return;
        
        const cacheKey = this.generateCacheKey(marketData);
        this.cache.set(cacheKey, {
            result,
            timestamp: Date.now()
        });
        
        // Cache temizliği
        if (this.cache.size > 100) {
            const oldestKey = this.cache.keys().next().value;
            this.cache.delete(oldestKey);
        }
    }
    
    /**
     * Performance tracking helper
     */
    trackPerformance(startTime) {
        const executionTime = Date.now() - startTime;
        this.updatePerformance(executionTime);
    }
    
    /**
     * Error handling helper  
     */
    handleError(operation, error) {
        const errorMsg = `${this.name} ${operation} failed: ${error.message}`;
        if (this.logError) {
            this.logError(errorMsg, error);
        } else {
            console.error(errorMsg, error);
        }
        
        return this.createErrorOutput(error.message);
    }
    
    /**
     * Result formatting helper
     */
    formatResult(analysisResult, signals = []) {
        return {
            success: true,
            analysis: analysisResult,
            signals,
            timestamp: Date.now(),
            sourceModule: this.name,
            executionTime: Date.now() - (this.lastAnalysis?.startTime || Date.now())
        };
    }
    
    /**
     * Error output helper
     */
    createErrorOutput(errorMessage) {
        return {
            success: false,
            error: errorMessage,
            analysis: null,
            signals: [],
            timestamp: Date.now(),
            sourceModule: this.name
        };
    }

    generateCacheKey(marketData) {
        // Basit cache key generation
        return `${marketData.symbol || 'unknown'}_${Math.floor(Date.now() / this.config.cacheDuration)}`;
    }
    
    /**
     * Sinyal geçmişi yönetimi
     */
    addToSignalHistory(signals) {
        signals.forEach(signal => {
            this.signalHistory.push({
                ...signal,
                addedAt: Date.now()
            });
        });
        
        // Son 50 sinyali tut
        if (this.signalHistory.length > 50) {
            this.signalHistory = this.signalHistory.slice(-50);
        }
    }
    
    /**
     * Son sinyalleri doğrulama - override edilebilir
     */
    async validateRecentSignals() {
        const recentSignals = this.signalHistory.slice(-this.config.validationWindow);
        
        if (recentSignals.length === 0) {
            return {
                successRate: 0,
                totalValidated: 0,
                averageScore: 0,
                timestamp: Date.now()
            };
        }
        
        // Basit validation - subclass daha gelişmiş implement edebilir
        let successfulSignals = 0;
        let totalScore = 0;
        
        recentSignals.forEach(signal => {
            totalScore += signal.skor;
            // Skor > 0.6 ise başarılı sayalım
            if (signal.skor > 0.6) {
                successfulSignals++;
            }
        });
        
        const validation = {
            successRate: successfulSignals / recentSignals.length,
            totalValidated: recentSignals.length,
            averageScore: totalScore / recentSignals.length,
            timestamp: Date.now()
        };
        
        this.performance.lastValidation = validation;
        this.performance.successRate = validation.successRate;
        
        return validation;
    }
    
    /**
     * Performans güncelleme
     */
    updatePerformance(executionTime, result) {
        this.performance.totalAnalyses++;
        
        if (result && result.signals) {
            this.performance.totalSignals += result.signals.length;
        }
        
        // EMA ile ortalama execution time
        if (this.performance.avgExecutionTime === 0) {
            this.performance.avgExecutionTime = executionTime;
        } else {
            this.performance.avgExecutionTime = 
                (this.performance.avgExecutionTime * 0.8) + (executionTime * 0.2);
        }
    }
    
    /**
     * Modül istatistikleri
     */
    getStats() {
        return {
            name: this.name,
            isInitialized: this.isInitialized,
            config: this.config,
            performance: this.performance,
            lastAnalysis: this.lastAnalysis ? {
                timestamp: this.lastAnalysis.timestamp,
                executionTime: this.lastAnalysis.executionTime,
                signalCount: this.lastAnalysis.result?.signals?.length || 0
            } : null,
            signalHistoryCount: this.signalHistory.length,
            cacheSize: this.cache.size
        };
    }
    
    /**
     * Temizlik
     */
    cleanup() {
        this.cache.clear();
        this.signalHistory = [];
        this.lastAnalysis = null;
        console.log(`🧹 Module ${this.name} cleaned up`);
    }
}

module.exports = GrafikBeyniModuleBase;
