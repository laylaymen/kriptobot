/**
 * 🧪 Real-time System Test (No Encryption)
 * Core Orchestrator ile tam sistem testini şifresiz yapar
 */

const { coreOrchestrator } = require('./modules/coreOrchestrator');
const { GrafikBeyniEventAdapter } = require('./modules/grafikBeyni/eventAdapter');
const { VivoEventAdapter } = require('./modules/vivo/eventAdapter');
const { eventBus } = require('./modules/modularEventStream');
const { logError, logEvent, logInfo } = require('./logs/logger');

// Mock environment variables for testing
process.env.TELEGRAM_BOT_TOKEN = 'test_token';
process.env.TELEGRAM_CHAT_ID = 'test_chat_id';
process.env.BINANCE_API_KEY = 'test_api_key';
process.env.BINANCE_SECRET_KEY = 'test_secret_key';
process.env.NEWS_API_KEY = 'test_news_key';

// Global test position
global.ACTIVE_POSITION = {
    symbol: "BTCUSDT",
    type: "long",
    stopAbove: null,
    stopBelow: 41000,
    openedAt: 43500,
    leverage: 10,
};

console.log('🧪 Real-time System Test başlatılıyor...\n');

/**
 * 📊 System Event Listeners
 */
function setupEventListeners() {
    console.log('👂 Event listeners kuruluyor...');

    // System ready events
    eventBus.subscribeToEvent('system.ready', (event) => {
        console.log(`✅ System Ready: ${event.data.system}`);
    }, 'testSystem');

    // Orchestrator ready
    eventBus.subscribeToEvent('system.orchestrator.ready', (event) => {
        console.log('🎯 Orchestrator Ready:', {
            systems: event.data.systems.length,
            startupTime: event.data.startupTime + 'ms'
        });
    }, 'testSystem');

    // Health monitoring
    eventBus.subscribeToEvent('system.health.report', (event) => {
        const report = event.data;
        const runningCount = Object.values(report.systems).filter(s => s.status === 'running').length;
        console.log(`❤️ Health: ${runningCount}/${Object.keys(report.systems).length} systems running`);
    }, 'testSystem');

    // Trading signals
    eventBus.subscribeToEvent('vivo.signal.generated', (event) => {
        console.log('🎯 Trading Signal:', {
            symbol: event.data.symbol,
            action: event.data.action,
            confidence: event.data.confidence
        });
    }, 'testSystem');

    // Technical analysis
    eventBus.subscribeToEvent('grafikBeyni.technical.analysis', (event) => {
        console.log('📊 Technical Analysis:', {
            symbol: event.data.symbol,
            signal: event.data.signal,
            confidence: event.data.confidence
        });
    }, 'testSystem');

    // Market data updates
    eventBus.subscribeToEvent('market.data.update', (event) => {
        console.log('📈 Market Data:', {
            symbol: event.data.symbol,
            timestamp: new Date(event.data.timestamp).toLocaleTimeString()
        });
    }, 'testSystem');

    console.log('✅ Event listeners kuruldu\n');
}

/**
 * 🎯 Mock Trading Loop
 */
async function startMockTradingLoop() {
    console.log('📈 Mock trading loop başlatılıyor...');

    let counter = 0;
    const maxIterations = 5; // 5 iterasyon için test

    const tradingInterval = setInterval(() => {
        counter++;
        
        console.log(`\n🔄 Trading Iteration ${counter}/${maxIterations}`);
        
        // Mock market data
        const mockData = {
            symbol: global.ACTIVE_POSITION.symbol,
            price: 43500 + (Math.random() - 0.5) * 1000,
            volume: Math.random() * 1000000,
            timestamp: Date.now()
        };

        // Publish market update
        eventBus.publishEvent('market.data.update', mockData, 'mockTradingLoop');

        // Mock technical analysis signal
        if (Math.random() > 0.5) {
            eventBus.publishEvent('grafikBeyni.technical.analysis', {
                symbol: mockData.symbol,
                signal: Math.random() > 0.5 ? 'BUY' : 'SELL',
                confidence: 0.7 + Math.random() * 0.3,
                price: mockData.price,
                timestamp: mockData.timestamp
            }, 'mockGrafikBeyni');
        }

        // Durur 5 iterasyon sonra
        if (counter >= maxIterations) {
            console.log('\n✅ Mock trading loop tamamlandı');
            clearInterval(tradingInterval);
            
            // Test'i bitir
            setTimeout(async () => {
                console.log('\n🔄 Test tamamlandı, sistem kapatılıyor...');
                await shutdown();
            }, 2000);
        }
        
    }, 3000); // 3 saniyede bir
    
    return tradingInterval;
}

/**
 * 🛑 Graceful Shutdown
 */
async function shutdown() {
    try {
        console.log('🛑 Sistem kapatılıyor...');
        await coreOrchestrator.stopSystem();
        console.log('✅ Sistem başarıyla kapatıldı');
        
        // Final status
        const finalStatus = coreOrchestrator.getSystemStatus();
        console.log(`🏃 Final Status: Running = ${finalStatus.isRunning}`);
        
        console.log('\n🎉 Real-time System Test Successfully Completed!');
        process.exit(0);
    } catch (error) {
        console.error('❌ Shutdown error:', error);
        process.exit(1);
    }
}

/**
 * 🚀 Main Test Function
 */
async function runRealTimeTest() {
    try {
        // 1. Setup event listeners
        setupEventListeners();

        // 2. Register system adapters
        console.log('📋 System adapters register ediliyor...');
        coreOrchestrator.registerSystemAdapter('grafikBeyni', GrafikBeyniEventAdapter);
        coreOrchestrator.registerSystemAdapter('vivo', VivoEventAdapter);
        console.log('✅ System adapters register edildi\n');

        // 3. Start core orchestrator
        console.log('🚀 Core Orchestrator başlatılıyor...');
        const systemStarted = await coreOrchestrator.startSystem();
        
        if (!systemStarted) {
            throw new Error('Core Orchestrator başlatılamadı');
        }

        console.log('✅ Core Orchestrator başarıyla başlatıldı\n');

        // 4. Wait for stabilization
        console.log('⏳ Sistem stabilizasyonu (2 saniye)...');
        await new Promise(resolve => setTimeout(resolve, 2000));

        // 5. Show system status
        const status = coreOrchestrator.getSystemStatus();
        console.log('📊 System Status:');
        console.log(`🏃 Running: ${status.isRunning}`);
        console.log(`📈 Progress: ${status.startupProgress.toFixed(1)}%`);
        console.log(`⏱️ Uptime: ${status.metrics.uptime}ms`);
        
        Object.entries(status.systems).forEach(([name, system]) => {
            const icon = system.status === 'running' ? '🟢' : '🔴';
            console.log(`${icon} ${name}: ${system.status.toUpperCase()}`);
        });

        // 6. Start mock trading loop
        console.log('\n🎯 Mock trading loop başlatılıyor...');
        await startMockTradingLoop();

    } catch (error) {
        console.error('🚨 Real-time test error:', error);
        process.exit(1);
    }
}

// Error handling
process.on('uncaughtException', (error) => {
    console.error('🚨 Uncaught Exception:', error);
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('🚨 Unhandled Rejection:', reason);
    process.exit(1);
});

process.on('SIGINT', async () => {
    console.log('\n🛑 Test interrupted...');
    await shutdown();
});

// Run the test
runRealTimeTest();