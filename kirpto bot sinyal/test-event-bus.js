/**
 * 🧪 Event Bus Integration Test
 * Tüm sistemlerin event bus ile iletişimini test eder
 */

const { eventBus, EVENT_TYPES } = require('./modules/modularEventStream');

console.log('🚀 Event Bus Integration Test Starting...\n');

// Test duration (5 seconds)
const TEST_DURATION = 5000;

// Test sistemleri hazır olarak işaretle
setTimeout(() => {
    eventBus.systemReady('grafikBeyni', { version: '1.0', modules: 81 });
}, 500);

setTimeout(() => {
    eventBus.systemReady('vivo', { version: '1.0', modules: 41 });
}, 1000);

setTimeout(() => {
    eventBus.systemReady('otobilinc', { version: '1.0', modules: 5 });
}, 1500);

setTimeout(() => {
    eventBus.systemReady('livia', { version: '1.0', modules: 4 });
}, 2000);

setTimeout(() => {
    eventBus.systemReady('denetimAsistani', { version: '1.0', modules: 4 });
}, 2500);

// Cross-system event simulation
setTimeout(() => {
    console.log('\n📊 Simulating cross-system events...');
    
    // Grafik Beyni -> VIVO signal
    eventBus.publishEvent(EVENT_TYPES.TECHNICAL_ANALYSIS, {
        symbol: 'BTCUSDT',
        signal: 'BUY',
        confidence: 0.85,
        indicators: { ema: 'bullish', rsi: 45 }
    }, 'grafikBeyni');
    
    // LIVIA sentiment filtering  
    eventBus.publishEvent(EVENT_TYPES.SENTIMENT_ANALYSIS, {
        sentiment: 'positive',
        score: 0.7,
        news_impact: 'moderate'
    }, 'livia');
    
    // Otobilinç bias check
    eventBus.publishEvent(EVENT_TYPES.BIAS_DETECTED, {
        bias_type: 'confirmation_bias',
        risk_level: 'low',
        action: 'proceed'
    }, 'otobilinc');
    
}, 3000);

// Event listeners for each system
eventBus.subscribeToEvent('grafikBeyni.*', (event) => {
    console.log(`🧠 Grafik Beyni Event: ${event.type}`);
}, 'testListener');

eventBus.subscribeToEvent('vivo.*', (event) => {
    console.log(`🔄 VIVO Event: ${event.type}`);
}, 'testListener');

eventBus.subscribeToEvent('livia.*', (event) => {
    console.log(`💭 LIVIA Event: ${event.type}`);
}, 'testListener');

eventBus.subscribeToEvent('otobilinc.*', (event) => {
    console.log(`🧠 Otobilinç Event: ${event.type}`);
}, 'testListener');

eventBus.subscribeToEvent('denetimAsistani.*', (event) => {
    console.log(`🔍 Denetim Asistanı Event: ${event.type}`);
}, 'testListener');

eventBus.subscribeToEvent('system.ready', (event) => {
    console.log(`✅ System Ready: ${event.data.system}`);
}, 'testListener');

// Test completion
setTimeout(() => {
    console.log('\n📈 Event Bus Integration Test Results:');
    const metrics = eventBus.getMetrics();
    const status = eventBus.getSystemStatus();
    
    console.log(`📊 Total Events: ${metrics.totalEvents}`);
    console.log(`⚡ Events/sec: ${metrics.eventsPerSecond.toFixed(3)}`);
    console.log(`❌ Errors: ${metrics.errorCount}`);
    
    console.log('\n🏆 System Status:');
    Object.entries(status).forEach(([system, info]) => {
        const icon = info.ready ? '🟢' : '🔴';
        console.log(`${icon} ${system}: ${info.ready ? 'READY' : 'NOT READY'}`);
    });
    
    console.log('\n✅ Event Bus Integration Test Completed!');
    eventBus.shutdown();
    process.exit(0);
    
}, TEST_DURATION);

// Graceful shutdown on Ctrl+C
process.on('SIGINT', () => {
    console.log('\n🛑 Test interrupted. Shutting down...');
    eventBus.shutdown();
    process.exit(0);
});