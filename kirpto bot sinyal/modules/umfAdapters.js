/**
 * UMF Adapter Examples
 * 
 * Mevcut GB-xx modüllerinin UMF şemasını tüketmesi için adapter örnekleri
 */

const { bus } = require('./unifiedMarketFeed');

/**
 * GB-10 · liquiditySweepDetector.js için UMF Adapter
 * 
 * Sadece L2 orderbook ve trade verilerini kullanır
 */
class LiquiditySweepAdapter {
    constructor(symbol = 'BTCUSDT') {
        this.symbol = symbol;
        this.lastBook = null;
        this.recentTrades = [];
        this.sweepThreshold = 0.02; // %2 fiyat hareketi
        
        this.initializeStreams();
    }

    initializeStreams() {
        // Orderbook dinle
        bus.on(`umf.book.${this.symbol}`, (book) => {
            this.onBookUpdate(book);
        });

        // Trade dinle
        bus.on(`umf.trade.${this.symbol}`, (trade) => {
            this.onTradeUpdate(trade);
        });

        console.log(`🔍 LiquiditySweepDetector initialized for ${this.symbol}`);
    }

    onBookUpdate(book) {
        if (!this.lastBook) {
            this.lastBook = book;
            return;
        }

        // Liquidity sweep detection logic
        const currentSpread = this.calculateSpread(book);
        const lastSpread = this.calculateSpread(this.lastBook);
        
        if (currentSpread > lastSpread * 1.5) {
            console.log(`⚡ Potential liquidity sweep detected: spread widened ${((currentSpread/lastSpread - 1) * 100).toFixed(2)}%`);
        }

        this.lastBook = book;
    }

    onTradeUpdate(trade) {
        this.recentTrades.push(trade);
        
        // Keep last 100 trades
        if (this.recentTrades.length > 100) {
            this.recentTrades.shift();
        }

        // Check for aggressive trades
        if (this.recentTrades.length >= 10) {
            const aggressiveRatio = this.calculateAggressiveRatio();
            if (aggressiveRatio > 0.8) {
                console.log(`🚀 High aggressive trading detected: ${(aggressiveRatio * 100).toFixed(1)}%`);
            }
        }
    }

    calculateSpread(book) {
        if (!book.bids[0] || !book.asks[0]) return 0;
        const bid = parseFloat(book.bids[0][0]);
        const ask = parseFloat(book.asks[0][0]);
        return (ask - bid) / bid;
    }

    calculateAggressiveRatio() {
        const recent = this.recentTrades.slice(-10);
        const aggressive = recent.filter(t => !t.isBuyerMaker).length;
        return aggressive / recent.length;
    }
}

/**
 * GB-22 · fillQualityAuditor.js için UMF Adapter
 * 
 * Rules, ticker ve trade verilerini kullanarak slippage hesaplar
 */
class FillQualityAdapter {
    constructor(symbol = 'BTCUSDT') {
        this.symbol = symbol;
        this.rules = null;
        this.lastTicker = null;
        this.fills = [];
        
        this.initializeStreams();
    }

    initializeStreams() {
        // Rules dinle
        bus.on(`umf.rules.${this.symbol}`, (rules) => {
            this.rules = rules;
            console.log(`📋 Rules updated for ${this.symbol}`);
        });

        // Ticker dinle  
        bus.on(`umf.ticker.${this.symbol}`, (ticker) => {
            this.lastTicker = ticker;
        });

        // Trade dinle
        bus.on(`umf.trade.${this.symbol}`, (trade) => {
            this.auditFill(trade);
        });

        console.log(`🎯 FillQualityAuditor initialized for ${this.symbol}`);
    }

    auditFill(trade) {
        if (!this.lastTicker || !this.rules) return;

        const midPrice = (parseFloat(this.lastTicker.bidPx) + parseFloat(this.lastTicker.askPx)) / 2;
        const fillPrice = parseFloat(trade.px);
        const slippage = Math.abs(fillPrice - midPrice) / midPrice;

        const quality = {
            timestamp: trade.ts,
            fillPrice,
            midPrice,
            slippage: slippage * 100, // percentage
            side: trade.isBuyerMaker ? 'SELL' : 'BUY',
            quantity: parseFloat(trade.qty),
            notional: fillPrice * parseFloat(trade.qty)
        };

        // Slippage quality assessment
        if (slippage > 0.001) { // 0.1%
            console.log(`⚠️ High slippage detected: ${(slippage * 100).toFixed(3)}% on ${trade.qty} ${this.symbol}`);
        }

        // Notional check
        const minNotional = this.rules.filters.notional?.min;
        if (minNotional && quality.notional < parseFloat(minNotional)) {
            console.log(`❌ Below minimum notional: ${quality.notional} < ${minNotional}`);
        }

        this.fills.push(quality);
        
        // Keep last 1000 fills
        if (this.fills.length > 1000) {
            this.fills.shift();
        }
    }

    getQualityReport() {
        if (this.fills.length === 0) return null;

        const avgSlippage = this.fills.reduce((sum, f) => sum + f.slippage, 0) / this.fills.length;
        const maxSlippage = Math.max(...this.fills.map(f => f.slippage));
        const totalVolume = this.fills.reduce((sum, f) => sum + f.notional, 0);

        return {
            fillCount: this.fills.length,
            avgSlippage: avgSlippage.toFixed(4),
            maxSlippage: maxSlippage.toFixed(4),
            totalVolume: totalVolume.toFixed(2),
            period: this.fills.length > 0 ? this.fills[this.fills.length - 1].timestamp - this.fills[0].timestamp : 0
        };
    }
}

/**
 * GB-36/41/42 · Technical Indicators için UMF Adapter
 * 
 * Kline verilerini kullanarak teknik göstergeleri hesaplar
 */
class TechnicalIndicatorsAdapter {
    constructor(symbol = 'BTCUSDT', intervals = ['1m', '5m', '15m']) {
        this.symbol = symbol;
        this.intervals = intervals;
        this.candles = {};
        this.indicators = {};
        
        // Her interval için data structure
        intervals.forEach(interval => {
            this.candles[interval] = [];
            this.indicators[interval] = {};
        });
        
        this.initializeStreams();
    }

    initializeStreams() {
        this.intervals.forEach(interval => {
            bus.on(`umf.candle.${this.symbol}.${interval}`, (candle) => {
                this.onCandleUpdate(candle);
            });
        });

        console.log(`📈 TechnicalIndicators initialized for ${this.symbol} [${this.intervals.join(', ')}]`);
    }

    onCandleUpdate(candle) {
        const { interval } = candle;
        
        // Candle ekle veya güncelle
        const candleArray = this.candles[interval];
        const lastCandle = candleArray[candleArray.length - 1];
        
        if (lastCandle && lastCandle.tsOpen === candle.tsOpen) {
            // Mevcut mumu güncelle
            candleArray[candleArray.length - 1] = candle;
        } else {
            // Yeni mum ekle
            candleArray.push(candle);
        }

        // Maximum 1000 mum sakla
        if (candleArray.length > 1000) {
            candleArray.shift();
        }

        // Sadece kapalı mumlar için hesapla
        if (candle.closed && candleArray.length >= 20) {
            this.calculateIndicators(interval);
        }
    }

    calculateIndicators(interval) {
        const candles = this.candles[interval];
        const closes = candles.map(c => parseFloat(c.c));
        const highs = candles.map(c => parseFloat(c.h));
        const lows = candles.map(c => parseFloat(c.l));
        const volumes = candles.map(c => parseFloat(c.v));

        const indicators = this.indicators[interval];

        // Simple Moving Average (20 period)
        if (closes.length >= 20) {
            const sma20 = closes.slice(-20).reduce((a, b) => a + b) / 20;
            indicators.sma20 = sma20;
        }

        // RSI (14 period)
        if (closes.length >= 15) {
            indicators.rsi14 = this.calculateRSI(closes, 14);
        }

        // MACD
        if (closes.length >= 26) {
            indicators.macd = this.calculateMACD(closes);
        }

        // Bollinger Bands
        if (closes.length >= 20) {
            indicators.bb = this.calculateBollingerBands(closes, 20, 2);
        }

        // Volume weighted average price (VWAP) - daily
        if (interval === '1m' || interval === '5m') {
            indicators.vwap = this.calculateVWAP(candles);
        }

        console.log(`📊 ${this.symbol} ${interval} indicators updated: RSI=${indicators.rsi14?.toFixed(2)}, SMA20=${indicators.sma20?.toFixed(2)}`);

        // Sinyal kontrolü
        this.checkSignals(interval, indicators);
    }

    calculateRSI(closes, period = 14) {
        if (closes.length < period + 1) return null;

        const changes = [];
        for (let i = 1; i < closes.length; i++) {
            changes.push(closes[i] - closes[i - 1]);
        }

        const gains = changes.map(c => c > 0 ? c : 0);
        const losses = changes.map(c => c < 0 ? Math.abs(c) : 0);

        const avgGain = gains.slice(-period).reduce((a, b) => a + b) / period;
        const avgLoss = losses.slice(-period).reduce((a, b) => a + b) / period;

        if (avgLoss === 0) return 100;
        const rs = avgGain / avgLoss;
        return 100 - (100 / (1 + rs));
    }

    calculateMACD(closes) {
        const ema12 = this.calculateEMA(closes, 12);
        const ema26 = this.calculateEMA(closes, 26);
        const macdLine = ema12 - ema26;
        
        // Signal line hesabı için basitleştirilmiş
        return {
            line: macdLine,
            signal: macdLine * 0.9, // Basitleştirilmiş
            histogram: macdLine * 0.1
        };
    }

    calculateEMA(closes, period) {
        const multiplier = 2 / (period + 1);
        let ema = closes[0];
        
        for (let i = 1; i < closes.length; i++) {
            ema = (closes[i] * multiplier) + (ema * (1 - multiplier));
        }
        
        return ema;
    }

    calculateBollingerBands(closes, period = 20, multiplier = 2) {
        const recentCloses = closes.slice(-period);
        const sma = recentCloses.reduce((a, b) => a + b) / period;
        
        const variance = recentCloses.reduce((sum, price) => sum + Math.pow(price - sma, 2), 0) / period;
        const stdDev = Math.sqrt(variance);
        
        return {
            upper: sma + (stdDev * multiplier),
            middle: sma,
            lower: sma - (stdDev * multiplier),
            width: (stdDev * multiplier * 2) / sma
        };
    }

    calculateVWAP(candles) {
        let totalVolume = 0;
        let totalVolumePrice = 0;
        
        candles.forEach(candle => {
            const typical = (parseFloat(candle.h) + parseFloat(candle.l) + parseFloat(candle.c)) / 3;
            const volume = parseFloat(candle.v);
            
            totalVolumePrice += typical * volume;
            totalVolume += volume;
        });
        
        return totalVolume > 0 ? totalVolumePrice / totalVolume : 0;
    }

    checkSignals(interval, indicators) {
        const signals = [];

        // RSI oversold/overbought
        if (indicators.rsi14) {
            if (indicators.rsi14 < 30) signals.push(`RSI Oversold: ${indicators.rsi14.toFixed(2)}`);
            if (indicators.rsi14 > 70) signals.push(`RSI Overbought: ${indicators.rsi14.toFixed(2)}`);
        }

        // Bollinger Bands
        if (indicators.bb && this.candles[interval].length > 0) {
            const lastPrice = parseFloat(this.candles[interval][this.candles[interval].length - 1].c);
            if (lastPrice <= indicators.bb.lower) signals.push('BB Lower Band Touch');
            if (lastPrice >= indicators.bb.upper) signals.push('BB Upper Band Touch');
        }

        if (signals.length > 0) {
            console.log(`🚨 ${this.symbol} ${interval} Signals: ${signals.join(', ')}`);
        }
    }

    getIndicators(interval) {
        return this.indicators[interval] || {};
    }

    getCurrentValues(interval) {
        const indicators = this.indicators[interval];
        const candles = this.candles[interval];
        
        if (!indicators || candles.length === 0) return null;

        const lastCandle = candles[candles.length - 1];
        
        return {
            timestamp: lastCandle.tsClose,
            price: parseFloat(lastCandle.c),
            volume: parseFloat(lastCandle.v),
            rsi: indicators.rsi14,
            sma20: indicators.sma20,
            macd: indicators.macd,
            bb: indicators.bb,
            vwap: indicators.vwap
        };
    }
}

/**
 * GB-60 · capitalAllocatorRL.js için UMF Adapter
 * 
 * Tüm market verilerini kullanarak risk/reward hesapları yapar
 */
class CapitalAllocationAdapter {
    constructor(symbols = ['BTCUSDT', 'ETHUSDT']) {
        this.symbols = symbols;
        this.marketData = {};
        this.riskMetrics = {};
        this.clockData = null;
        
        this.initializeStreams();
    }

    initializeStreams() {
        // Clock dinle (latency tracking)
        bus.on('umf.clock', (clock) => {
            this.clockData = clock;
            this.checkSystemHealth();
        });

        this.symbols.forEach(symbol => {
            this.marketData[symbol] = {
                ticker: null,
                book: null,
                funding: null,
                rules: null,
                trades: []
            };

            // Her symbol için tüm stream'leri dinle
            bus.on(`umf.ticker.${symbol}`, (ticker) => {
                this.marketData[symbol].ticker = ticker;
                this.updateRiskMetrics(symbol);
            });

            bus.on(`umf.book.${symbol}`, (book) => {
                this.marketData[symbol].book = book;
                this.calculateLiquidityScore(symbol);
            });

            bus.on(`umf.funding.${symbol}`, (funding) => {
                this.marketData[symbol].funding = funding;
            });

            bus.on(`umf.rules.${symbol}`, (rules) => {
                this.marketData[symbol].rules = rules;
            });

            bus.on(`umf.trade.${symbol}`, (trade) => {
                const trades = this.marketData[symbol].trades;
                trades.push(trade);
                if (trades.length > 100) trades.shift();
            });
        });

        console.log(`💰 CapitalAllocator initialized for ${this.symbols.length} symbols`);
    }

    updateRiskMetrics(symbol) {
        const data = this.marketData[symbol];
        if (!data.ticker || !data.book) return;

        const spread = parseFloat(data.ticker.askPx) - parseFloat(data.ticker.bidPx);
        const midPrice = (parseFloat(data.ticker.askPx) + parseFloat(data.ticker.bidPx)) / 2;
        const spreadPct = (spread / midPrice) * 100;

        this.riskMetrics[symbol] = {
            spreadPct,
            liquidityScore: this.calculateLiquidityScore(symbol),
            volatilityScore: this.calculateVolatilityScore(symbol),
            lastUpdate: Date.now()
        };
    }

    calculateLiquidityScore(symbol) {
        const book = this.marketData[symbol].book;
        if (!book || book.bids.length === 0 || book.asks.length === 0) return 0;

        // Top 5 level liquidity depth
        const bidDepth = book.bids.slice(0, 5).reduce((sum, [px, qty]) => sum + parseFloat(qty), 0);
        const askDepth = book.asks.slice(0, 5).reduce((sum, [px, qty]) => sum + parseFloat(qty), 0);
        
        return Math.min(bidDepth, askDepth); // Conservative liquidity
    }

    calculateVolatilityScore(symbol) {
        const trades = this.marketData[symbol].trades;
        if (trades.length < 10) return 0;

        const prices = trades.slice(-20).map(t => parseFloat(t.px));
        const returns = [];
        
        for (let i = 1; i < prices.length; i++) {
            returns.push((prices[i] - prices[i-1]) / prices[i-1]);
        }

        // Standard deviation of returns
        const mean = returns.reduce((a, b) => a + b) / returns.length;
        const variance = returns.reduce((sum, ret) => sum + Math.pow(ret - mean, 2), 0) / returns.length;
        
        return Math.sqrt(variance);
    }

    checkSystemHealth() {
        if (!this.clockData) return;

        const healthMetrics = {
            latency: Math.abs(this.clockData.driftMs),
            dataAge: Date.now() - this.clockData.ingestTs,
            activeSymbols: Object.keys(this.marketData).length
        };

        if (healthMetrics.latency > 500) {
            console.log(`⚠️ High latency detected: ${healthMetrics.latency}ms`);
        }

        if (healthMetrics.dataAge > 5000) {
            console.log(`⚠️ Stale data detected: ${healthMetrics.dataAge}ms old`);
        }
    }

    getAllocationRecommendation() {
        const recommendations = {};

        this.symbols.forEach(symbol => {
            const risk = this.riskMetrics[symbol];
            if (!risk) return;

            let score = 100; // Base score
            
            // Penalize high spread
            score -= risk.spreadPct * 10;
            
            // Reward high liquidity
            score += Math.min(risk.liquidityScore / 10, 20);
            
            // Penalize high volatility
            score -= risk.volatilityScore * 1000;

            recommendations[symbol] = {
                score: Math.max(0, Math.min(100, score)),
                risk: risk.spreadPct + risk.volatilityScore * 100,
                liquidity: risk.liquidityScore,
                lastUpdate: risk.lastUpdate
            };
        });

        return recommendations;
    }
}

// Export adapters
module.exports = {
    LiquiditySweepAdapter,
    FillQualityAdapter,
    TechnicalIndicatorsAdapter,
    CapitalAllocationAdapter
};

// CLI test için quick start
if (require.main === module) {
    console.log('🧪 Testing UMF Adapters...');
    
    const { quickStart } = require('./unifiedMarketFeed');
    
    quickStart(['BTCUSDT'], {
        intervals: ['1m', '5m'],
        enableTrades: true,
        enableTicker: true,
        enableOrderbook: true
    }).then(() => {
        // Start adapters
        new LiquiditySweepAdapter('BTCUSDT');
        new FillQualityAdapter('BTCUSDT');
        new TechnicalIndicatorsAdapter('BTCUSDT', ['1m', '5m']);
        new CapitalAllocationAdapter(['BTCUSDT']);
        
        console.log('✅ All adapters initialized and listening...');
    });
}
