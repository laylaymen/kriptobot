/**
 * Simple UMF Demo - Basit Test
 */

const { SimpleUMF } = require('./kirpto bot sinyal/modules/simpleUMF');

async function runSimpleDemo() {
    console.log('🚀 Simple UMF Demo Starting...\n');
    
    // Create simple UMF instance
    const umf = new SimpleUMF({
        symbols: ['BTCUSDT'],
        streams: ['kline_1m', 'trade'],
        debug: true
    });
    
    // Set up event listeners
    console.log('🎧 Setting up event listeners...\n');
    
    // Legacy format listener
    umf.subscribe('umf.candle.BTCUSDT.1m', (event) => {
        console.log('📈 Legacy Kline:', {
            symbol: event.symbol,
            close: event.close,
            volume: event.volume,
            closed: event.closed
        });
    });
    
    // New format listener
    umf.subscribe('market.kline.BTCUSDT.1m.v1', (event) => {
        console.log('🔥 Enhanced Kline:', {
            symbol: event.symbol,
            close: event.close,
            volume: event.volume,
            validated: event.validated
        });
    });
    
    // Trade listeners
    umf.subscribe('umf.trade.BTCUSDT', (event) => {
        console.log('💸 Legacy Trade:', {
            symbol: event.symbol,
            price: event.price,
            quantity: event.quantity
        });
    });
    
    umf.subscribe('market.trades.BTCUSDT.v1', (event) => {
        console.log('🔥 Enhanced Trade:', {
            symbol: event.symbol,
            price: event.price,
            quantity: event.quantity,
            validated: event.validated
        });
    });
    
    // Clock events
    umf.subscribe('umf.clock', (event) => {
        console.log('🕐 Clock sync:', {
            drift: event.driftMs + 'ms'
        });
    });
    
    try {
        // Start the simple UMF
        await umf.start();
        
        console.log('✅ Demo running! Press Ctrl+C to stop\n');
        
        // Show stats every 30 seconds
        setInterval(() => {
            const stats = umf.getStats();
            console.log('\n📊 Demo Stats:');
            console.log(`- Total events: ${stats.totalEvents}`);
            console.log(`- Events/sec: ${stats.eventsPerSecond.toFixed(1)}`);
            console.log(`- Errors: ${stats.errors}`);
            console.log(`- Runtime: ${stats.runtime}s`);
            console.log(`- Active streams: ${stats.activeStreams}`);
            console.log('---\n');
        }, 30000);
        
    } catch (error) {
        console.error('❌ Demo failed:', error.message);
        process.exit(1);
    }
}

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n🛑 Demo stopping...');
    process.exit(0);
});

// Run demo
runSimpleDemo().catch(console.error);
