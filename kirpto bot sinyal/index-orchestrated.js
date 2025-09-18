/**
 * 🤖 Kriptobot Main Entry Point with Core Orchestrator
 * Unified Modular Framework (UMF) 2.0 ile orchestrator tabanlı başlangıç
 */

require('dotenv').config();
const { logError, logEvent, logInfo } = require('./logs/logger');
const { coreOrchestrator } = require('./modules/coreOrchestrator');
const { GrafikBeyniEventAdapter } = require('./modules/grafikBeyni/eventAdapter');
const { VivoEventAdapter } = require('./modules/vivo/eventAdapter');
const { eventBus } = require('./modules/modularEventStream');
const { decrypt } = require('./modules/envSecure');
const readline = require('readline');

// Global position tracking
global.ACTIVE_POSITION = {
    symbol: "BTCUSDT",
    type: "long",
    stopAbove: null,
    stopBelow: 41000,
    openedAt: 43500,
    leverage: 10,
};

/**
 * 🔐 Environment Variables Decryption
 */
async function loadDecryptedEnv() {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });
    
    const ask = (q) => new Promise((res) => rl.question(q, res));
    
    console.log('🔐 Şifreli environment variables çözülüyor...');
    const key = await ask('Şifre çözme anahtarını girin (hex): ');
    rl.close();

    // Decrypt all encrypted environment variables
    const encryptedVars = [
        'TELEGRAM_BOT_TOKEN',
        'TELEGRAM_CHAT_ID', 
        'BINANCE_API_KEY',
        'BINANCE_SECRET_KEY',
        'NEWS_API_KEY'
    ];

    encryptedVars.forEach(varName => {
        if (process.env[varName] && process.env[varName].startsWith('enc:')) {
            try {
                process.env[varName] = decrypt(process.env[varName].slice(4), key);
                console.log(`✅ ${varName} çözüldü`);
            } catch (error) {
                console.error(`❌ ${varName} çözülemedi:`, error.message);
            }
        }
    });

    console.log('🔐 Environment variables başarıyla çözüldü\n');
}

/**
 * 🎯 Real-time Trading Loop
 */
async function startTradingLoop() {
    const { fetchMultiTimeframe } = require("./modules/dataFetcher");
    const { evaluateStrategies } = require("./modules/strategiesManager");

    console.log('📈 Real-time trading loop başlatılıyor...');

    // İlk analiz
    try {
        const symbol = global.ACTIVE_POSITION.symbol;
        console.log(`🎯 İlk analiz: ${symbol}`);
        
        const candles = await fetchMultiTimeframe(symbol);
        await evaluateStrategies(symbol, candles, logEvent);
        
        console.log('✅ İlk analiz tamamlandı');
    } catch (error) {
        logError(error, "İlk analiz hatası");
    }

    // Ana trading döngüsü
    const tradingInterval = setInterval(async () => {
        try {
            const symbol = global.ACTIVE_POSITION.symbol;
            const candles = await fetchMultiTimeframe(symbol);
            
            // Event Bus üzerinden analiz verilerini paylaş
            eventBus.publishEvent('market.data.update', {
                symbol,
                candles,
                timestamp: Date.now()
            }, 'tradingLoop');
            
            await evaluateStrategies(symbol, candles, logEvent);
            
        } catch (error) {
            logError(error, "Trading loop hatası");
            
            // Event Bus üzerinden hata bildir
            eventBus.publishEvent('system.error', {
                source: 'tradingLoop',
                error: error.message,
                timestamp: Date.now()
            }, 'tradingLoop');
        }
    }, 30000); // 30 saniyede bir
    
    // Graceful shutdown için interval'i temizle
    process.on('SIGINT', () => {
        console.log('\n🛑 Trading loop durduruluyor...');
        clearInterval(tradingInterval);
    });

    return tradingInterval;
}

/**
 * 📊 System Event Listeners
 */
function setupEventListeners() {
    console.log('👂 System event listeners kuruluyor...');

    // System ready events
    eventBus.subscribeToEvent('system.ready', (event) => {
        console.log(`✅ System Ready: ${event.data.system}`);
    }, 'mainSystem');

    // Health monitoring
    eventBus.subscribeToEvent('system.health.report', (event) => {
        const report = event.data;
        const runningCount = Object.values(report.systems).filter(s => s.status === 'running').length;
        const totalCount = Object.keys(report.systems).length;
        
        if (runningCount < totalCount) {
            console.log(`⚠️ Health Warning: ${runningCount}/${totalCount} systems running`);
        }
    }, 'mainSystem');

    // Trading signals
    eventBus.subscribeToEvent('vivo.signal.generated', (event) => {
        console.log('🎯 Trading Signal:', {
            symbol: event.data.symbol,
            action: event.data.action,
            confidence: event.data.confidence
        });
        
        logEvent(JSON.stringify(event.data), "VIVO Signal Generated");
    }, 'mainSystem');

    // Market analysis
    eventBus.subscribeToEvent('grafikBeyni.technical.analysis', (event) => {
        console.log('📊 Technical Analysis:', {
            symbol: event.data.symbol,
            trend: event.data.trend,
            strength: event.data.strength
        });
        
        logEvent(JSON.stringify(event.data), "Grafik Beyni Analysis");
    }, 'mainSystem');

    console.log('✅ Event listeners kuruldu\n');
}

/**
 * 🚀 Main Application Startup
 */
async function main() {
    try {
        console.log('🤖 Kriptobot UMF 2.0 başlatılıyor...\n');

        // 1. Environment setup
        await loadDecryptedEnv();

        // 2. Event listeners setup
        setupEventListeners();

        // 3. Register system adapters
        console.log('📋 System adapters register ediliyor...');
        coreOrchestrator.registerSystemAdapter('grafikBeyni', GrafikBeyniEventAdapter);
        coreOrchestrator.registerSystemAdapter('vivo', VivoEventAdapter);
        console.log('✅ System adapters register edildi\n');

        // 4. Start core orchestrator
        console.log('🚀 Core Orchestrator başlatılıyor...');
        const systemStarted = await coreOrchestrator.startSystem();
        
        if (!systemStarted) {
            throw new Error('Core Orchestrator başlatılamadı');
        }

        console.log('✅ Core Orchestrator başarıyla başlatıldı\n');

        // 5. Wait for system stabilization
        console.log('⏳ Sistem stabilizasyonu bekleniyor (2 saniye)...');
        await new Promise(resolve => setTimeout(resolve, 2000));

        // 6. Start trading loop
        const tradingLoop = await startTradingLoop();

        // 7. System status logging
        setInterval(() => {
            const status = coreOrchestrator.getSystemStatus();
            const runningCount = Object.values(status.systems).filter(s => s.status === 'running').length;
            
            logInfo(`System Status: ${runningCount}/${Object.keys(status.systems).length} systems running, Uptime: ${status.metrics.uptime}ms`);
        }, 60000); // Her dakika system status logla

        console.log('🎉 Kriptobot başarıyla başlatıldı ve trading modunda!\n');
        console.log('📈 Real-time market analysis çalışıyor...');
        console.log('📱 Telegram notifications aktif...');
        console.log('🔄 30 saniyede bir analiz yapılıyor...\n');

    } catch (error) {
        console.error('🚨 Kriptobot başlatma hatası:', error);
        logError(error, "Main startup error");
        process.exit(1);
    }
}

/**
 * 🛡️ Error Handling & Graceful Shutdown
 */
process.on('uncaughtException', (error) => {
    console.error('🚨 Uncaught Exception:', error);
    logError(error, "uncaughtException");
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('🚨 Unhandled Rejection at:', promise, 'reason:', reason);
    logError(reason, "unhandledRejection");
    process.exit(1);
});

process.on('SIGINT', async () => {
    console.log('\n🛑 Kriptobot kapatılıyor...');
    
    try {
        await coreOrchestrator.stopSystem();
        console.log('✅ Kriptobot başarıyla kapatıldı');
        process.exit(0);
    } catch (error) {
        console.error('❌ Shutdown error:', error);
        process.exit(1);
    }
});

process.on('SIGTERM', async () => {
    console.log('🔄 SIGTERM alındı, graceful shutdown...');
    
    try {
        await coreOrchestrator.stopSystem();
        process.exit(0);
    } catch (error) {
        console.error('❌ SIGTERM shutdown error:', error);
        process.exit(1);
    }
});

// Start the application
main();