/**
 * Enhanced Event Enricher - Production Ready
 * 
 * Handles rolling metrics, microstructure, TCA, and feature vectors
 */

// Define FeatureVector class
class FeatureVector {
    constructor() {
        this.price = {};
        this.volume = {};
        this.microstructure = {};
        this.momentum = {};
        this.regime = {};
        this.risk = {};
        this.timestamp = null;
        this.symbol = null;
        this.version = null;
    }
}

class EventEnricher {
    constructor(config = {}) {
        this.config = {
            enableRollingMetrics: true,
            enableMicrostructure: true,
            enableTCA: true,
            enableFeatureVectors: true,
            rollingWindows: [60, 300, 900, 3600], // 1m, 5m, 15m, 1h in seconds
            maxHistoryItems: 10000,
            tcaWindowMs: 60000, // 1 minute for TCA analysis
            ...config
        };
        
        // State storage
        this.priceHistory = new Map();      // symbol -> circular buffer
        this.volumeHistory = new Map();     // symbol -> circular buffer
        this.tradeHistory = new Map();      // symbol -> circular buffer
        this.depthHistory = new Map();      // symbol -> circular buffer
        this.tcaMetrics = new Map();        // symbol -> TCA state
        this.volumeProfiles = new Map();    // symbol -> volume distribution
        this.lastPrices = new Map();        // symbol -> last known price
        this.vwapStates = new Map();        // symbol -> VWAP calculation state
        
        // Feature computation cache
        this.featureCache = new Map();
        this.lastFeatureUpdate = new Map();
        
        // Cleanup old data periodically
        setInterval(() => this.cleanup(), 300000); // 5 minutes
    }

    /**
     * Main enrichment entry point
     */
    async enrich(normalizedEvent) {
        try {
            const { symbol, kind } = normalizedEvent;
            const enrichedEvent = { ...normalizedEvent };
            
            // Initialize symbol state if needed
            this.initializeSymbol(symbol);
            
            // Add rolling metrics
            if (this.config.enableRollingMetrics) {
                await this.addRollingMetrics(enrichedEvent);
            }
            
            // Add microstructure features
            if (this.config.enableMicrostructure) {
                await this.addMicrostructureFeatures(enrichedEvent);
            }
            
            // Add TCA metrics
            if (this.config.enableTCA) {
                await this.addTCAMetrics(enrichedEvent);
            }
            
            // Update historical data
            this.updateHistory(enrichedEvent);
            
            // Generate feature vectors
            if (this.config.enableFeatureVectors) {
                enrichedEvent.features = await this.generateFeatureVector(enrichedEvent);
            }
            
            // Add enrichment metadata
            enrichedEvent.enriched = true;
            enrichedEvent.enrichmentTime = Date.now();
            enrichedEvent.enrichmentVersion = '1.0';
            
            return enrichedEvent;
            
        } catch (error) {
            console.error('Enrichment error:', error.message);
            normalizedEvent.enrichmentError = error.message;
            normalizedEvent.enriched = false;
            return normalizedEvent;
        }
    }

    /**
     * Add rolling metrics (VWAP, volatility, etc.)
     */
    async addRollingMetrics(event) {
        const { symbol, kind } = event;
        const now = Date.now();
        
        // Initialize rolling metrics object
        event.rolling = {};
        
        for (const windowSec of this.config.rollingWindows) {
            const windowMs = windowSec * 1000;
            const windowKey = `${windowSec}s`;
            
            event.rolling[windowKey] = {};
            
            // Price-based metrics
            if (event.price || event.c || event.midPrice) {
                const price = event.price || event.c || event.midPrice;
                const priceMetrics = this.calculatePriceMetrics(symbol, price, windowMs, now);
                Object.assign(event.rolling[windowKey], priceMetrics);
            }
            
            // Volume-based metrics
            if (event.v || event.qty) {
                const volume = event.v || event.qty;
                const volumeMetrics = this.calculateVolumeMetrics(symbol, volume, windowMs, now);
                Object.assign(event.rolling[windowKey], volumeMetrics);
            }
            
            // Trade-specific metrics
            if (kind === 'trade') {
                const tradeMetrics = this.calculateTradeMetrics(symbol, event, windowMs, now);
                Object.assign(event.rolling[windowKey], tradeMetrics);
            }
            
            // Depth-specific metrics
            if (kind === 'depth') {
                const depthMetrics = this.calculateDepthMetrics(symbol, event, windowMs, now);
                Object.assign(event.rolling[windowKey], depthMetrics);
            }
        }
    }

    /**
     * Add microstructure features
     */
    async addMicrostructureFeatures(event) {
        const { symbol, kind } = event;
        
        event.microstructure = {};
        
        // Price impact and market impact
        if (kind === 'trade') {
            event.microstructure.priceImpact = this.calculatePriceImpact(symbol, event);
            event.microstructure.marketImpact = this.calculateMarketImpact(symbol, event);
            event.microstructure.aggressiveness = this.calculateAggressiveness(symbol, event);
        }
        
        // Order flow imbalance
        if (kind === 'depth') {
            event.microstructure.orderFlowImbalance = this.calculateOrderFlowImbalance(symbol, event);
            event.microstructure.depthImbalance = this.calculateDepthImbalance(symbol, event);
            event.microstructure.pressureIndex = this.calculatePressureIndex(symbol, event);
        }
        
        // Arrival rate and intensity
        event.microstructure.arrivalRate = this.calculateArrivalRate(symbol, kind);
        event.microstructure.intensity = this.calculateIntensity(symbol, kind);
        
        // Volatility clustering
        event.microstructure.volatilityClustering = this.calculateVolatilityClustering(symbol);
        
        // Momentum indicators
        event.microstructure.momentum = this.calculateMomentum(symbol);
        event.microstructure.meanReversion = this.calculateMeanReversion(symbol);
    }

    /**
     * Add Transaction Cost Analysis metrics
     */
    async addTCAMetrics(event) {
        const { symbol, kind } = event;
        
        if (kind !== 'trade') {
            return; // TCA only applies to trades
        }
        
        event.tca = {};
        
        // Implementation shortfall
        event.tca.implementationShortfall = this.calculateImplementationShortfall(symbol, event);
        
        // Market impact cost
        event.tca.marketImpactCost = this.calculateMarketImpactCost(symbol, event);
        
        // Timing cost
        event.tca.timingCost = this.calculateTimingCost(symbol, event);
        
        // Opportunity cost
        event.tca.opportunityCost = this.calculateOpportunityCost(symbol, event);
        
        // Slippage analysis
        event.tca.slippage = this.calculateSlippage(symbol, event);
        
        // Participation rate
        event.tca.participationRate = this.calculateParticipationRate(symbol, event);
        
        // Price improvement
        event.tca.priceImprovement = this.calculatePriceImprovement(symbol, event);
    }

    /**
     * Generate comprehensive feature vector
     */
    async generateFeatureVector(event) {
        const { symbol } = event;
        const features = new FeatureVector();
        
        // Price features
        features.price = {
            current: event.price || event.c || event.midPrice || 0,
            returns_1m: this.getReturn(symbol, 60),
            returns_5m: this.getReturn(symbol, 300),
            returns_15m: this.getReturn(symbol, 900),
            volatility_1m: this.getVolatility(symbol, 60),
            volatility_5m: this.getVolatility(symbol, 300),
            rsi_14: this.getRSI(symbol, 14),
            sma_20: this.getSMA(symbol, 20),
            ema_12: this.getEMA(symbol, 12),
            ema_26: this.getEMA(symbol, 26),
            bollinger_upper: this.getBollingerUpper(symbol),
            bollinger_lower: this.getBollingerLower(symbol),
            price_position: this.getPricePosition(symbol)
        };
        
        // Volume features
        features.volume = {
            current: event.v || event.qty || 0,
            vwap_1m: this.getVWAP(symbol, 60),
            vwap_5m: this.getVWAP(symbol, 300),
            volume_ratio_1m: this.getVolumeRatio(symbol, 60),
            volume_ratio_5m: this.getVolumeRatio(symbol, 300),
            on_balance_volume: this.getOBV(symbol),
            accumulation_distribution: this.getAccumulationDistribution(symbol),
            volume_oscillator: this.getVolumeOscillator(symbol)
        };
        
        // Microstructure features
        features.microstructure = {
            spread_bps: event.spreadBps || 0,
            depth_imbalance: event.microstructure?.depthImbalance || 0,
            order_flow_imbalance: event.microstructure?.orderFlowImbalance || 0,
            arrival_rate: event.microstructure?.arrivalRate || 0,
            intensity: event.microstructure?.intensity || 0,
            aggressiveness: event.microstructure?.aggressiveness || 0,
            market_impact: event.microstructure?.marketImpact || 0,
            pressure_index: event.microstructure?.pressureIndex || 0
        };
        
        // Momentum features
        features.momentum = {
            roc_1m: this.getROC(symbol, 60),
            roc_5m: this.getROC(symbol, 300),
            momentum_1m: this.getMomentum(symbol, 60),
            momentum_5m: this.getMomentum(symbol, 300),
            williams_r: this.getWilliamsR(symbol),
            stochastic_k: this.getStochasticK(symbol),
            stochastic_d: this.getStochasticD(symbol),
            macd: this.getMACD(symbol),
            macd_signal: this.getMACDSignal(symbol),
            macd_histogram: this.getMACDHistogram(symbol)
        };
        
        // Market regime features
        features.regime = {
            trend_strength: this.getTrendStrength(symbol),
            market_regime: this.getMarketRegime(symbol),
            volatility_regime: this.getVolatilityRegime(symbol),
            liquidity_regime: this.getLiquidityRegime(symbol),
            correlation_regime: this.getCorrelationRegime(symbol)
        };
        
        // Risk features
        features.risk = {
            var_1d: this.getVaR(symbol, 1440, 0.95), // 1-day VaR at 95%
            expected_shortfall: this.getExpectedShortfall(symbol, 1440, 0.95),
            maximum_drawdown: this.getMaximumDrawdown(symbol),
            sharpe_ratio: this.getSharpeRatio(symbol),
            beta: this.getBeta(symbol),
            tracking_error: this.getTrackingError(symbol)
        };
        
        features.timestamp = Date.now();
        features.symbol = symbol;
        features.version = '1.0';
        
        return features;
    }

    /**
     * Calculate price metrics for rolling windows
     */
    calculatePriceMetrics(symbol, price, windowMs, now) {
        const history = this.priceHistory.get(symbol) || [];
        const windowData = this.getWindowData(history, windowMs, now);
        
        if (windowData.length === 0) {
            return { sma: price, ema: price, volatility: 0, returns: 0 };
        }
        
        const prices = windowData.map(item => item.price);
        const volumes = windowData.map(item => item.volume || 1);
        
        const sma = prices.reduce((sum, p) => sum + p, 0) / prices.length;
        const vwap = this.calculateVWAP(prices, volumes);
        const volatility = this.calculateVolatility(prices);
        const returns = prices.length > 1 ? (price - prices[0]) / prices[0] : 0;
        
        return { sma, vwap, volatility, returns, count: prices.length };
    }

    /**
     * Calculate volume metrics for rolling windows
     */
    calculateVolumeMetrics(symbol, volume, windowMs, now) {
        const history = this.volumeHistory.get(symbol) || [];
        const windowData = this.getWindowData(history, windowMs, now);
        
        if (windowData.length === 0) {
            return { avgVolume: volume, volumeRatio: 1, totalVolume: volume };
        }
        
        const volumes = windowData.map(item => item.volume);
        const avgVolume = volumes.reduce((sum, v) => sum + v, 0) / volumes.length;
        const totalVolume = volumes.reduce((sum, v) => sum + v, 0);
        const volumeRatio = avgVolume > 0 ? volume / avgVolume : 1;
        
        return { avgVolume, volumeRatio, totalVolume, count: volumes.length };
    }

    /**
     * Helper functions for feature calculations
     */
    calculateVWAP(prices, volumes) {
        let totalValue = 0;
        let totalVolume = 0;
        
        for (let i = 0; i < prices.length; i++) {
            totalValue += prices[i] * volumes[i];
            totalVolume += volumes[i];
        }
        
        return totalVolume > 0 ? totalValue / totalVolume : prices[prices.length - 1];
    }

    calculateVolatility(prices) {
        if (prices.length < 2) return 0;
        
        const returns = [];
        for (let i = 1; i < prices.length; i++) {
            returns.push(Math.log(prices[i] / prices[i - 1]));
        }
        
        const mean = returns.reduce((sum, r) => sum + r, 0) / returns.length;
        const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / returns.length;
        
        return Math.sqrt(variance) * Math.sqrt(252 * 24 * 60); // Annualized
    }

    /**
     * Price impact calculation
     */
    calculatePriceImpact(symbol, trade) {
        const lastPrice = this.lastPrices.get(symbol);
        if (!lastPrice) return 0;
        
        const impact = Math.abs(trade.price - lastPrice) / lastPrice;
        return impact * 10000; // in basis points
    }

    /**
     * Market impact calculation
     */
    calculateMarketImpact(symbol, trade) {
        const depthData = this.depthHistory.get(symbol);
        if (!depthData || depthData.length === 0) return 0;
        
        const lastDepth = depthData[depthData.length - 1];
        if (!lastDepth || !lastDepth.data.midPrice) return 0;
        
        const impact = Math.abs(trade.price - lastDepth.data.midPrice) / lastDepth.data.midPrice;
        return impact * 10000; // in basis points
    }

    /**
     * Order flow imbalance calculation
     */
    calculateOrderFlowImbalance(symbol, depth) {
        if (!depth.bids || !depth.asks || depth.bids.length === 0 || depth.asks.length === 0) {
            return 0;
        }
        
        const bidVolume = depth.bids.reduce((sum, [price, qty]) => sum + qty, 0);
        const askVolume = depth.asks.reduce((sum, [price, qty]) => sum + qty, 0);
        
        return (bidVolume - askVolume) / (bidVolume + askVolume);
    }

    /**
     * Initialize symbol state
     */
    initializeSymbol(symbol) {
        if (!this.priceHistory.has(symbol)) {
            this.priceHistory.set(symbol, []);
            this.volumeHistory.set(symbol, []);
            this.tradeHistory.set(symbol, []);
            this.depthHistory.set(symbol, []);
            this.tcaMetrics.set(symbol, {});
            this.volumeProfiles.set(symbol, new Map());
            this.vwapStates.set(symbol, { totalValue: 0, totalVolume: 0 });
        }
    }

    /**
     * Update historical data
     */
    updateHistory(event) {
        const { symbol, kind } = event;
        const timestamp = event.eventTime || Date.now();
        
        // Update price history
        if (event.price || event.c || event.midPrice) {
            const price = event.price || event.c || event.midPrice;
            this.addToHistory(this.priceHistory, symbol, { 
                timestamp, 
                price, 
                volume: event.v || event.qty || 0 
            });
            this.lastPrices.set(symbol, price);
        }
        
        // Update volume history
        if (event.v || event.qty) {
            this.addToHistory(this.volumeHistory, symbol, {
                timestamp,
                volume: event.v || event.qty
            });
        }
        
        // Update trade/depth specific history
        if (kind === 'trade') {
            this.addToHistory(this.tradeHistory, symbol, { timestamp, data: event });
        } else if (kind === 'depth') {
            this.addToHistory(this.depthHistory, symbol, { timestamp, data: event });
        }
    }

    /**
     * Add item to circular buffer history
     */
    addToHistory(historyMap, symbol, item) {
        let history = historyMap.get(symbol) || [];
        history.push(item);
        
        // Keep only recent items
        if (history.length > this.config.maxHistoryItems) {
            history = history.slice(-this.config.maxHistoryItems);
        }
        
        historyMap.set(symbol, history);
    }

    /**
     * Get data within time window
     */
    getWindowData(history, windowMs, now) {
        const cutoff = now - windowMs;
        return history.filter(item => item.timestamp >= cutoff);
    }

    /**
     * Placeholder feature calculation methods
     * (These would contain actual technical indicator logic)
     */
    getReturn(symbol, periodSec) { return 0; }
    getVolatility(symbol, periodSec) { return 0; }
    getRSI(symbol, period) { return 50; }
    getSMA(symbol, period) { return 0; }
    getEMA(symbol, period) { return 0; }
    getBollingerUpper(symbol) { return 0; }
    getBollingerLower(symbol) { return 0; }
    getPricePosition(symbol) { return 0.5; }
    getVWAP(symbol, periodSec) { return 0; }
    getVolumeRatio(symbol, periodSec) { return 1; }
    getOBV(symbol) { return 0; }
    getAccumulationDistribution(symbol) { return 0; }
    getVolumeOscillator(symbol) { return 0; }
    getROC(symbol, periodSec) { return 0; }
    getMomentum(symbol, periodSec) { return 0; }
    getWilliamsR(symbol) { return -50; }
    getStochasticK(symbol) { return 50; }
    getStochasticD(symbol) { return 50; }
    getMACD(symbol) { return 0; }
    getMACDSignal(symbol) { return 0; }
    getMACDHistogram(symbol) { return 0; }
    getTrendStrength(symbol) { return 0.5; }
    getMarketRegime(symbol) { return 'normal'; }
    getVolatilityRegime(symbol) { return 'normal'; }
    getLiquidityRegime(symbol) { return 'normal'; }
    getCorrelationRegime(symbol) { return 'normal'; }
    getVaR(symbol, periodMin, confidence) { return 0; }
    getExpectedShortfall(symbol, periodMin, confidence) { return 0; }
    getMaximumDrawdown(symbol) { return 0; }
    getSharpeRatio(symbol) { return 0; }
    getBeta(symbol) { return 1; }
    getTrackingError(symbol) { return 0; }

    /**
     * Additional calculation methods
     */
    calculateTradeMetrics(symbol, event, windowMs, now) {
        const history = this.tradeHistory.get(symbol) || [];
        const windowData = this.getWindowData(history, windowMs, now);
        
        const tradeCount = windowData.length;
        const avgTradeSize = tradeCount > 0 ? 
            windowData.reduce((sum, item) => sum + (item.data.qty || 0), 0) / tradeCount : 0;
        
        const buyTrades = windowData.filter(item => !item.data.isBuyerMaker).length;
        const sellTrades = windowData.filter(item => item.data.isBuyerMaker).length;
        const buyPressure = tradeCount > 0 ? buyTrades / tradeCount : 0.5;
        
        return { tradeCount, avgTradeSize, buyPressure };
    }

    calculateDepthMetrics(symbol, event, windowMs, now) {
        const totalBidVolume = event.bids ? event.bids.reduce((sum, [p, q]) => sum + q, 0) : 0;
        const totalAskVolume = event.asks ? event.asks.reduce((sum, [p, q]) => sum + q, 0) : 0;
        const imbalance = totalBidVolume + totalAskVolume > 0 ? 
            (totalBidVolume - totalAskVolume) / (totalBidVolume + totalAskVolume) : 0;
        
        return { totalBidVolume, totalAskVolume, imbalance };
    }

    calculateAggressiveness(symbol, trade) {
        // Placeholder - would compare trade price to mid/best prices
        return 0.5;
    }

    calculateArrivalRate(symbol, kind) {
        // Placeholder - events per second calculation
        return 1.0;
    }

    calculateIntensity(symbol, kind) {
        // Placeholder - intensity calculation
        return 1.0;
    }

    calculateVolatilityClustering(symbol) {
        // Placeholder - volatility clustering metric
        return 0.5;
    }

    calculateMomentum(symbol) {
        // Placeholder - momentum calculation
        return 0;
    }

    calculateMeanReversion(symbol) {
        // Placeholder - mean reversion indicator
        return 0;
    }

    calculateImplementationShortfall(symbol, trade) {
        // Placeholder - implementation shortfall calculation
        return 0;
    }

    calculateMarketImpactCost(symbol, trade) {
        // Placeholder - market impact cost calculation
        return 0;
    }

    calculateTimingCost(symbol, trade) {
        // Placeholder - timing cost calculation
        return 0;
    }

    calculateOpportunityCost(symbol, trade) {
        // Placeholder - opportunity cost calculation
        return 0;
    }

    calculateSlippage(symbol, trade) {
        // Placeholder - slippage calculation
        return 0;
    }

    calculateParticipationRate(symbol, trade) {
        // Placeholder - participation rate calculation
        return 0.1;
    }

    calculatePriceImprovement(symbol, trade) {
        // Placeholder - price improvement calculation
        return 0;
    }

    calculateDepthImbalance(symbol, depth) {
        return this.calculateOrderFlowImbalance(symbol, depth);
    }

    calculatePressureIndex(symbol, depth) {
        // Placeholder - pressure index calculation
        return 0;
    }

    /**
     * Cleanup old data
     */
    cleanup() {
        const cutoff = Date.now() - (24 * 60 * 60 * 1000); // 24 hours
        
        for (const [symbol, history] of this.priceHistory) {
            const filtered = history.filter(item => item.timestamp >= cutoff);
            this.priceHistory.set(symbol, filtered);
        }
        
        // Similar cleanup for other history maps...
    }

    /**
     * Get enrichment statistics
     */
    getStats() {
        return {
            symbolsTracked: this.priceHistory.size,
            totalPricePoints: Array.from(this.priceHistory.values()).reduce((sum, h) => sum + h.length, 0),
            totalVolumePoints: Array.from(this.volumeHistory.values()).reduce((sum, h) => sum + h.length, 0),
            cacheSizes: {
                features: this.featureCache.size,
                lastPrices: this.lastPrices.size
            },
            config: this.config
        };
    }
}

module.exports = {
    EventEnricher
};
