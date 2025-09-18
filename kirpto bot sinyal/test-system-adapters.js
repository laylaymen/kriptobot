/**
 * 🧪 System Adapters Integration Test
 * Tüm sistem adapter'larının Event Bus ile çalışmasını test eder
 */

const { eventBus, EVENT_TYPES } = require('./modules/modularEventStream');
const { GrafikBeyniEventAdapter } = require('./modules/grafikBeyni/eventAdapter');
const { VivoEventAdapter } = require('./modules/vivo/eventAdapter');

console.log('🧪 System Adapters Integration Test Starting...\n');

// Adapter'ları oluştur
const grafikBeyniAdapter = new GrafikBeyniEventAdapter();
const vivoAdapter = new VivoEventAdapter();

// Sistemleri bağla
setTimeout(() => {
    console.log('🔌 Connecting systems to Event Bus...');
    grafikBeyniAdapter.connect();
    vivoAdapter.connect();
}, 500);

// Test scenario: Grafik Beyni analiz yapıp VIVO'ya sinyal gönderir
setTimeout(() => {
    console.log('\n📊 Test Scenario: Technical Analysis -> Signal Generation');
    
    // 1. Grafik Beyni teknik analiz yayınlar
    grafikBeyniAdapter.publishTechnicalAnalysis('BTCUSDT', {
        indicators: {
            ema9: 43250,
            ema21: 43180,
            rsi: 62,
            macd: { line: 120, signal: 80, histogram: 40 }
        },
        signals: ['bullish_ema_crossover', 'rsi_momentum'],
        confidence: 0.85,
        recommendations: {
            action: 'BUY',
            target: 44500,
            stop: 42800
        }
    });
    
}, 1500);

// Pattern detection test
setTimeout(() => {
    console.log('\n🔍 Test Scenario: Pattern Detection -> Signal Generation');
    
    // 2. Grafik Beyni pattern tespit eder
    grafikBeyniAdapter.publishPatternDetected('ETHUSDT', {
        type: 'ascending_triangle',
        confidence: 0.9,
        timeframe: '4h',
        action: 'BUY',
        targets: [2650, 2750, 2850],
        current_price: 2580,
        stop_level: 2520
    });
    
}, 2500);

// Risk assessment test
setTimeout(() => {
    console.log('\n⚠️ Test Scenario: Risk Assessment');
    
    // 3. VIVO risk değerlendirmesi yapar
    vivoAdapter.publishRiskAssessment({
        symbol: 'ADAUSDT',
        level: 'moderate',
        score: 0.6,
        maxSize: 0.03,
        leverage: 8,
        warnings: ['high_volatility', 'low_liquidity_hours']
    });
    
}, 3500);

// Position update test
setTimeout(() => {
    console.log('\n📈 Test Scenario: Position Updates');
    
    // 4. VIVO pozisyon güncellemesi
    vivoAdapter.publishPositionUpdate({
        symbol: 'BTCUSDT',
        side: 'LONG',
        size: 0.025,
        entryPrice: 43250,
        currentPrice: 43420,
        unrealizedPnl: 42.5,
        status: 'open'
    });
    
}, 4500);

// Test completion and metrics
setTimeout(() => {
    console.log('\n📈 System Adapters Test Results:');
    const metrics = eventBus.getMetrics();
    const status = eventBus.getSystemStatus();
    
    console.log(`📊 Total Events: ${metrics.totalEvents}`);
    console.log(`⚡ Events/sec: ${metrics.eventsPerSecond.toFixed(3)}`);
    console.log(`❌ Errors: ${metrics.errorCount}`);
    
    console.log('\n🏆 System Connection Status:');
    Object.entries(status).forEach(([system, info]) => {
        const icon = info.ready ? '🟢' : '🔴';
        const lastEventInfo = info.lastEvent ? ` (Last: ${info.lastEvent.type})` : '';
        console.log(`${icon} ${system}: ${info.ready ? 'CONNECTED' : 'DISCONNECTED'}${lastEventInfo}`);
    });
    
    console.log('\n📋 Event Types Distribution:');
    Array.from(metrics.eventsByType.entries()).forEach(([type, count]) => {
        console.log(`  ${type}: ${count} events`);
    });
    
    console.log('\n✅ System Adapters Integration Test Completed!');
    
    // Cleanup
    grafikBeyniAdapter.disconnect();
    vivoAdapter.disconnect();
    eventBus.shutdown();
    process.exit(0);
    
}, 6000);

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n🛑 Test interrupted. Shutting down...');
    grafikBeyniAdapter.disconnect();
    vivoAdapter.disconnect();
    eventBus.shutdown();
    process.exit(0);
});