/**
 * 🧪 Core Orchestrator Integration Test
 * Central Orchestrator'ın sistem koordinasyonunu test eder
 */

const { coreOrchestrator } = require('./modules/coreOrchestrator');
const { GrafikBeyniEventAdapter } = require('./modules/grafikBeyni/eventAdapter');
const { VivoEventAdapter } = require('./modules/vivo/eventAdapter');
const { eventBus } = require('./modules/modularEventStream');

console.log('🧪 Core Orchestrator Integration Test Starting...\n');

async function runOrchestratorTest() {
    try {
        // 1. System adapter'larını register et
        console.log('📋 Registering system adapters...');
        
        coreOrchestrator.registerSystemAdapter('grafikBeyni', GrafikBeyniEventAdapter);
        coreOrchestrator.registerSystemAdapter('vivo', VivoEventAdapter);
        
        console.log('✅ System adapters registered\n');

        // 2. Event listener'ları kur
        console.log('👂 Setting up event listeners...');
        
        eventBus.subscribeToEvent('system.orchestrator.ready', (event) => {
            console.log('🎯 Orchestrator Ready Event:', {
                systems: event.data.systems.length,
                startupTime: event.data.startupTime + 'ms',
                version: event.data.version
            });
        }, 'testListener');

        eventBus.subscribeToEvent('system.health.report', (event) => {
            const report = event.data;
            const runningCount = Object.values(report.systems).filter(s => s.status === 'running').length;
            console.log(`❤️ Health Check: ${runningCount}/${Object.keys(report.systems).length} systems running`);
        }, 'testListener');

        eventBus.subscribeToEvent('system.ready', (event) => {
            console.log(`✅ System Ready: ${event.data.system}`);
        }, 'testListener');

        console.log('✅ Event listeners setup complete\n');

        // 3. Sistema başlat
        console.log('🚀 Starting Kriptobot system...');
        const startSuccess = await coreOrchestrator.startSystem();
        
        if (startSuccess) {
            console.log('✅ System startup completed!\n');
            
            // 4. System status kontrol et
            console.log('📊 System Status Check:');
            const status = coreOrchestrator.getSystemStatus();
            
            console.log(`🏃 Is Running: ${status.isRunning}`);
            console.log(`📈 Startup Progress: ${status.startupProgress.toFixed(1)}%`);
            console.log(`⏱️ Uptime: ${status.metrics.uptime}ms`);
            console.log(`❌ System Errors: ${status.metrics.systemErrors}`);
            
            console.log('\n🏆 System States:');
            Object.entries(status.systems).forEach(([name, system]) => {
                const icon = system.status === 'running' ? '🟢' : 
                           system.status === 'error' ? '🔴' : '🟡';
                console.log(`${icon} ${name}: ${system.status.toUpperCase()}`);
            });

            // 5. Health report al
            console.log('\n❤️ Health Report:');
            const healthReport = coreOrchestrator.getHealthReport();
            console.log(`📊 Total Systems: ${Object.keys(healthReport.orchestrator.systems).length}`);
            console.log(`🔄 Event Bus Ready: ${healthReport.eventBus ? 'YES' : 'NO'}`);

            // 6. Test inter-system communication
            console.log('\n📡 Testing inter-system communication...');
            
            // Grafik Beyni'nden bir analiz event'i gönder
            setTimeout(() => {
                eventBus.publishEvent('grafikBeyni.technical.analysis', {
                    symbol: 'BTCUSDT',
                    signal: 'STRONG_BUY',
                    confidence: 0.92,
                    source: 'orchestrator_test'
                }, 'testSystem');
            }, 1000);

            // 7. 5 saniye bekleyip sistemi kapat
            setTimeout(async () => {
                console.log('\n🔄 Testing system shutdown...');
                
                const stopSuccess = await coreOrchestrator.stopSystem();
                if (stopSuccess) {
                    console.log('✅ System shutdown completed!');
                    
                    // Final status check
                    const finalStatus = coreOrchestrator.getSystemStatus();
                    console.log(`🏃 Is Running: ${finalStatus.isRunning}`);
                    
                    console.log('\n🎉 Core Orchestrator Test Completed Successfully!');
                } else {
                    console.log('❌ System shutdown failed');
                }
                
                process.exit(0);
            }, 5000);

        } else {
            console.log('❌ System startup failed');
            process.exit(1);
        }

    } catch (error) {
        console.error('🚨 Test Error:', error);
        process.exit(1);
    }
}

// Error handling
process.on('uncaughtException', (error) => {
    console.error('🚨 Uncaught Exception:', error);
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('🚨 Unhandled Rejection at:', promise, 'reason:', reason);
    process.exit(1);
});

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('\n🛑 Test interrupted. Shutting down...');
    try {
        await coreOrchestrator.stopSystem();
    } catch (error) {
        console.error('Shutdown error:', error);
    }
    process.exit(0);
});

// Run the test
runOrchestratorTest();