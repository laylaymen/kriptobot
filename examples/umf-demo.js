/**
 * UMF Quick Start Example
 * 
 * UnifiedMarketFeed modülünü hızlıca başlatmak ve test etmek için örnek
 */

const { quickStart, bus } = require('./kirpto bot sinyal/modules/unifiedMarketFeed');
const { 
    LiquiditySweepAdapter, 
    FillQualityAdapter, 
    TechnicalIndicatorsAdapter, 
    CapitalAllocationAdapter 
} = require('./kirpto bot sinyal/modules/umfAdapters');

class UMFDemo {
    constructor() {
        this.umf = null;
        this.adapters = {};
        this.stats = {
            messagesReceived: 0,
            startTime: Date.now(),
            symbols: []
        };
    }

    async start() {
        console.log('🚀 Starting UnifiedMarketFeed Demo...');
        console.log('==========================================');

        try {
            // 1. UMF'yi başlat
            await this.initializeUMF();
            
            // 2. Adapter'ları başlat
            await this.initializeAdapters();
            
            // 3. Monitoring başlat
            this.startMonitoring();
            
            // 4. Demo senaryoları
            this.runDemoScenarios();
            
        } catch (error) {
            console.error('❌ Demo failed:', error.message);
            process.exit(1);
        }
    }

    async initializeUMF() {
        console.log('📡 Initializing UnifiedMarketFeed (CONSERVATIVE MODE)...');
        
        const symbols = ['BTCUSDT']; // Single symbol for demo
        const options = {
            intervals: ['5m'], // Single interval only
            enableTrades: true,
            enableTicker: true,
            enableOrderbook: false, // Disabled to save API calls
            enableFunding: false,
            enableClock: true
        };

        this.umf = await quickStart(symbols, options);
        this.stats.symbols = symbols;
        
        console.log(`✅ UMF initialized for ${symbols.length} symbol(s) - CONSERVATIVE`);
        console.log(`   Symbols: ${symbols.join(', ')}`);
        console.log(`   Intervals: ${options.intervals.join(', ')}`);
        console.log(`   ⚠️ Orderbook disabled to prevent rate limits`);
    }

    async initializeAdapters() {
        console.log('🔧 Initializing adapters (CONSERVATIVE)...');
        
        // Single symbol için minimal adapter'lar
        const symbol = this.stats.symbols[0]; // BTCUSDT
        this.adapters[symbol] = {
            technicalIndicators: new TechnicalIndicatorsAdapter(symbol, ['5m']), // Single interval
        };

        console.log(`✅ Minimal adapters initialized for ${symbol}`);
    }

    startMonitoring() {
        console.log('📊 Starting monitoring...');
        
        // Genel mesaj sayacı
        const originalEmit = bus.emit;
        bus.emit = (topic, ...args) => {
            this.stats.messagesReceived++;
            return originalEmit.call(bus, topic, ...args);
        };

        // Her 30 saniyede stats yazdır
        setInterval(() => {
            this.printStats();
        }, 30000);

        // İlk stats 10 saniye sonra
        setTimeout(() => {
            this.printStats();
        }, 10000);
    }

    runDemoScenarios() {
        console.log('🎭 Running demo scenarios...');
        
        // Scenario 1: Basic data flow test
        setTimeout(() => {
            console.log('\n📈 Scenario 1: Testing data flow...');
            this.testDataFlow();
        }, 5000);

        // Scenario 2: Technical indicators
        setTimeout(() => {
            console.log('\n📊 Scenario 2: Technical indicators check...');
            this.testTechnicalIndicators();
        }, 15000);

        // Scenario 3: Risk metrics
        setTimeout(() => {
            console.log('\n💰 Scenario 3: Risk metrics evaluation...');
            this.testRiskMetrics();
        }, 25000);

        // Scenario 4: Fill quality analysis
        setTimeout(() => {
            console.log('\n🎯 Scenario 4: Fill quality analysis...');
            this.testFillQuality();
        }, 35000);
    }

    testDataFlow() {
        let receivedCandles = 0;
        let receivedTrades = 0;
        let receivedTickers = 0;

        const timeout = setTimeout(() => {
            console.log(`📊 Data Flow Results (10s) - CONSERVATIVE:`);
            console.log(`   Candles: ${receivedCandles}`);
            console.log(`   Trades: ${receivedTrades}`);
            console.log(`   Tickers: ${receivedTickers}`);
            console.log(`   📖 Orderbook: DISABLED (saves API calls)`);
            
            if (receivedCandles > 0 && receivedTrades > 0) {
                console.log('✅ Data flow test PASSED');
            } else {
                console.log('⚠️ Data flow test - low activity (normal in conservative mode)');
            }
        }, 10000);

        // Temporary listeners - only for enabled streams
        const candleHandler = () => receivedCandles++;
        const tradeHandler = () => receivedTrades++;
        const tickerHandler = () => receivedTickers++;

        bus.on('umf.candle.BTCUSDT.5m', candleHandler);
        bus.on('umf.trade.BTCUSDT', tradeHandler);
        bus.on('umf.ticker.BTCUSDT', tickerHandler);

        // Cleanup after test
        setTimeout(() => {
            bus.off('umf.candle.BTCUSDT.5m', candleHandler);
            bus.off('umf.trade.BTCUSDT', tradeHandler);
            bus.off('umf.ticker.BTCUSDT', tickerHandler);
        }, 10000);
    }

    testTechnicalIndicators() {
        const symbol = 'BTCUSDT';
        const adapter = this.adapters[symbol]?.technicalIndicators;
        
        if (!adapter) {
            console.log('❌ Technical indicators adapter not found');
            return;
        }

        const indicators5m = adapter.getCurrentValues('5m');

        console.log(`📈 ${symbol} Technical Indicators (CONSERVATIVE):`);
        
        if (indicators5m) {
            console.log(`   5m: Price=${indicators5m.price?.toFixed(2)}, RSI=${indicators5m.rsi?.toFixed(2)}, SMA20=${indicators5m.sma20?.toFixed(2)}`);
            console.log('✅ Technical indicators test PASSED');
        } else {
            console.log('⚠️ Technical indicators - insufficient data (normal, need more time)');
        }
    }

    testRiskMetrics() {
        const allocator = this.adapters.capitalAllocator;
        
        if (!allocator) {
            console.log('❌ Capital allocator not found');
            return;
        }

        const recommendations = allocator.getAllocationRecommendation();
        
        console.log('💰 Capital Allocation Recommendations:');
        
        Object.entries(recommendations).forEach(([symbol, rec]) => {
            console.log(`   ${symbol}: Score=${rec.score.toFixed(1)}, Risk=${rec.risk.toFixed(4)}, Liquidity=${rec.liquidity.toFixed(2)}`);
        });

        if (Object.keys(recommendations).length > 0) {
            console.log('✅ Risk metrics test PASSED');
        } else {
            console.log('❌ Risk metrics test FAILED');
        }
    }

    testFillQuality() {
        const symbol = 'BTCUSDT';
        const adapter = this.adapters[symbol]?.fillQuality;
        
        if (!adapter) {
            console.log('❌ Fill quality adapter not found');
            return;
        }

        const report = adapter.getQualityReport();
        
        if (report) {
            console.log(`🎯 ${symbol} Fill Quality Report:`);
            console.log(`   Fills: ${report.fillCount}`);
            console.log(`   Avg Slippage: ${report.avgSlippage}%`);
            console.log(`   Max Slippage: ${report.maxSlippage}%`);
            console.log(`   Total Volume: $${report.totalVolume}`);
            console.log('✅ Fill quality test PASSED');
        } else {
            console.log('❌ Fill quality test FAILED - no fills recorded');
        }
    }

    printStats() {
        const elapsed = (Date.now() - this.stats.startTime) / 1000;
        const msgPerSec = (this.stats.messagesReceived / elapsed).toFixed(1);
        const status = this.umf.getStatus();

        console.log('\n📊 UMF Demo Statistics');
        console.log('========================');
        console.log(`Runtime: ${elapsed.toFixed(0)}s`);
        console.log(`Messages: ${this.stats.messagesReceived} (${msgPerSec}/sec)`);
        console.log(`Active Streams: ${status.activeStreams.length}`);
        console.log(`Clock Drift: ${status.driftMs}ms`);
        console.log(`Request Weight: ${status.requestWeight}/1200`);
        console.log(`Symbols: ${status.symbolCount}`);
        console.log('========================\n');
    }

    async shutdown() {
        console.log('\n🛑 Shutting down demo...');
        
        if (this.umf) {
            this.umf.shutdown();
        }
        
        console.log('✅ Demo shutdown complete');
        process.exit(0);
    }
}

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('\n🛑 Received SIGINT, shutting down...');
    if (global.demo) {
        await global.demo.shutdown();
    } else {
        process.exit(0);
    }
});

process.on('SIGTERM', async () => {
    console.log('\n🛑 Received SIGTERM, shutting down...');
    if (global.demo) {
        await global.demo.shutdown();
    } else {
        process.exit(0);
    }
});

// CLI runner
if (require.main === module) {
    const demo = new UMFDemo();
    global.demo = demo; // Global reference for cleanup
    
    demo.start().catch(error => {
        console.error('❌ Demo crashed:', error);
        process.exit(1);
    });
}

module.exports = UMFDemo;
