/**
 * Enhanced UMF Demo - Pipeline Testing
 */

const { UnifiedMarketFeed } = require('./kirpto bot sinyal/modules/unifiedMarketFeed');

async function runEnhancedDemo() {
    console.log('🚀 Starting Enhanced UMF Demo...\n');
    
    // Create UMF instance with enhanced pipeline
    const umf = new UnifiedMarketFeed({
        enableNormalization: true,
        enableEnrichment: true, 
        enableValidation: true,
        strictValidation: false,
        topicPrefix: 'market',
        topicVersion: 'v1',
        debug: true,
        maxEventsPerSecond: 10  // Conservative for demo
    });
    
    console.log('📊 Pipeline Configuration:');
    console.log('- Normalization: ✅');
    console.log('- Enrichment: ✅'); 
    console.log('- Validation: ✅');
    console.log('- Topic Prefix: market');
    console.log('- Version: v1\n');
    
    // Setup event listeners for enhanced topics
    console.log('🎧 Setting up enhanced topic listeners...\n');
    
    // Legacy compatibility test
    umf.subscribe('umf.candle.BTCUSDT.1m', (event) => {
        console.log('📈 Legacy Kline Event:', {
            symbol: event.symbol,
            close: event.c,
            volume: event.v,
            source: event.source
        });
    });
    
    // Enhanced topic listeners
    umf.subscribe('market.kline.BTCUSDT.1m.v1', (event) => {
        console.log('🔥 Enhanced Kline Event:', {
            symbol: event.symbol,
            close: event.c,
            volume: event.v,
            validated: event.validated,
            enriched: event.enriched,
            features: event.features ? 'Present' : 'None',
            rolling: event.rolling ? Object.keys(event.rolling) : 'None',
            messageId: event.messageId,
            schemaVersion: event.schemaVersion
        });
    });
    
    umf.subscribe('market.trades.BTCUSDT.v1', (event) => {
        console.log('💸 Enhanced Trade Event:', {
            symbol: event.symbol,
            price: event.price,
            qty: event.qty,
            tca: event.tca ? 'Present' : 'None',
            microstructure: event.microstructure ? 'Present' : 'None',
            validated: event.validated,
            enriched: event.enriched
        });
    });
    
    umf.subscribe('market.health.v1', (event) => {
        console.log('🏥 Health Event:', {
            latency: event.latency,
            throughput: event.throughput,
            slos: event.slos ? 'Present' : 'None'
        });
    });
    
    // Error handling
    umf.on('error', (error) => {
        console.error('❌ UMF Error:', error);
    });
    
    umf.on('event', (eventInfo) => {
        console.log(`📡 Event Published: ${eventInfo.topic} (${eventInfo.kind})`);
    });
    
    try {
        // Initialize pipeline
        console.log('🔄 Initializing enhanced pipeline...\n');
        
        await umf.timeSync();
        console.log('✅ Time synchronized\n');
        
        await umf.loadExchangeInfo(['BTCUSDT']);
        console.log('✅ Exchange info loaded\n');
        
        // Update normalizer with exchange rules
        const symbolInfo = umf.symbolInfo.get('BTCUSDT');
        if (symbolInfo) {
            umf.normalizer.updateExchangeRules('BTCUSDT', symbolInfo);
            console.log('✅ Normalizer rules updated\n');
        }
        
        // Start conservative streams
        console.log('🌊 Starting enhanced data streams...\n');
        umf.streamKlines('BTCUSDT', '1m');
        umf.streamAggTrades('BTCUSDT');
        
        // Monitor pipeline statistics
        setInterval(() => {
            const stats = umf.stats;
            const normStats = umf.normalizer.getStats();
            const enrichStats = umf.enricher.getStats();
            
            console.log('\n📊 Pipeline Statistics:');
            console.log(`Total Events: ${stats.totalEvents}`);
            console.log(`Pipeline - Normalized: ${stats.pipeline.normalized}, Enriched: ${stats.pipeline.enriched}, Published: ${stats.pipeline.published}, Dropped: ${stats.pipeline.dropped}`);
            console.log(`Errors: ${stats.errorsCount}, Duplicates: ${stats.duplicatesDropped}`);
            console.log(`Normalizer - Cache: ${normStats.dedupCacheSize}, Rules: ${normStats.rulesLoaded}`);
            console.log(`Enricher - Symbols: ${enrichStats.symbolsTracked}, Price Points: ${enrichStats.totalPricePoints}`);
            console.log('---');
        }, 30000);
        
        console.log('✅ Enhanced UMF Demo running successfully!');
        console.log('📈 Waiting for market data...\n');
        console.log('Press Ctrl+C to stop\n');
        
    } catch (error) {
        console.error('❌ Demo failed:', error.message);
        process.exit(1);
    }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
    console.log('\n🛑 Shutting down Enhanced UMF Demo...');
    process.exit(0);
});

// Run demo
runEnhancedDemo().catch(console.error);
