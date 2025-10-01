/**
 * LIVIA Sistem Test ve Demo Script
 * LIVIA orchestrator ve modüllerini test eder
 */

const LIVIAOrchestrator = require('./modules/livia/liviaOrchestrator');
const { logInfo, logError } = require('./kirpto bot sinyal/logs/logger');

async function testLIVIA() {
    console.log('🚀 LIVIA Test Başlatılıyor...\n');
    
    try {
        // LIVIA Orchestrator'ı başlat
        const livia = new LIVIAOrchestrator({
            logLevel: 'info',
            modules: {
                actionApproval: { enabled: true, priority: 1 },
                biasMonitor: { enabled: true, priority: 2 },
                confirmationBounds: { enabled: true, priority: 1 },
                decisionWriter: { enabled: true, priority: 3 },
                guardEngine: { enabled: true, priority: 1 },
                knowledgeRouter: { enabled: true, priority: 2 }
            }
        });
        
        // Sistemı başlat
        console.log('📡 LIVIA Orchestrator başlatılıyor...');
        const initialized = await livia.initialize({
            info: (msg) => console.log(`ℹ️  ${msg}`),
            error: (msg) => console.log(`❌ ${msg}`),
            warn: (msg) => console.log(`⚠️  ${msg}`)
        });
        
        if (!initialized) {
            throw new Error('LIVIA başlatılamadı');
        }
        
        console.log('\n✅ LIVIA başarıyla başlatıldı!');
        
        // Sistem durumunu kontrol et
        const status = livia.getStatus();
        console.log('\n📊 Sistem Durumu:');
        console.log(`- Durum: ${status.systemStatus}`);
        console.log(`- Aktif Modüller: ${status.activeModules}`);
        console.log(`- Toplam Event: ${status.totalEvents}`);
        
        // Test senaryoları
        console.log('\n🧪 Test Senaryoları Başlatılıyor...\n');
        
        // Test 1: Operatör Kararı
        console.log('📋 Test 1: Operatör Kararı İşleme');
        const operatorDecision = {
            event: 'operator.decision.final',
            timestamp: new Date().toISOString(),
            promptId: 'test-prompt-001',
            decisionId: 'test-decision-001',
            accepted: true,
            rationale: 'Test amaçlı onay',
            context: {
                action: 'test_action',
                payload: { amount: 100 },
                approvalKey: 'test-key'
            },
            auth: {
                userId: 'test-user',
                role: 'operator'
            }
        };
        
        const result1 = await livia.process(operatorDecision);
        console.log('✅ Operatör kararı işlendi:', result1.success ? 'Başarılı' : 'Hata');
        
        // Test 2: Risk Algılama
        console.log('\n🚨 Test 2: Risk Algılama');
        const riskEvent = {
            event: 'risk.detected',
            timestamp: new Date().toISOString(),
            riskLevel: 'high',
            category: 'financial',
            details: 'Test risk algılama',
            action: 'immediate_attention'
        };
        
        const result2 = await livia.process(riskEvent);
        console.log('✅ Risk algılama işlendi:', result2.success ? 'Başarılı' : 'Hata');
        
        // Test 3: Sistem Eventi
        console.log('\n⚙️  Test 3: Sistem Eventi');
        const systemEvent = {
            event: 'system.status',
            timestamp: new Date().toISOString(),
            status: 'healthy',
            metrics: {
                cpu: 45,
                memory: 67,
                uptime: 1200
            }
        };
        
        const result3 = await livia.process(systemEvent);
        console.log('✅ Sistem eventi işlendi:', result3.success ? 'Başarılı' : 'Hata');
        
        // Son durum kontrolü
        console.log('\n📊 Test Sonrası Durum:');
        const finalStatus = livia.getStatus();
        console.log(`- Aktif Modüller: ${finalStatus.activeModules}`);
        console.log(`- Toplam Event: ${finalStatus.totalEvents}`);
        console.log(`- Son Sağlık Kontrolü: ${finalStatus.lastHealthCheck || 'Henüz yapılmadı'}`);
        
        // Modül sağlık durumları
        console.log('\n🏥 Modül Sağlık Durumları:');
        for (const [module, health] of Object.entries(finalStatus.moduleHealth)) {
            console.log(`- ${module}: ${health.status} (Son kontrol: ${health.lastCheck})`);
        }
        
        // Sistemi temizle
        console.log('\n🧹 Sistem temizleniyor...');
        await livia.shutdown();
        console.log('✅ LIVIA başarıyla durduruldu');
        
        console.log('\n🎉 LIVIA Test Tamamlandı! Tüm sistemler çalışıyor.\n');
        
    } catch (error) {
        console.error('\n❌ LIVIA Test Hatası:', error);
        process.exit(1);
    }
}

// Performance testi
async function performanceTest() {
    console.log('\n⚡ LIVIA Performance Test Başlatılıyor...\n');
    
    const livia = new LIVIAOrchestrator();
    await livia.initialize({
        info: () => {},
        error: (msg) => console.log(`❌ ${msg}`),
        warn: () => {}
    });
    
    const eventCount = 100;
    const startTime = Date.now();
    
    console.log(`📊 ${eventCount} event işleniyor...`);
    
    for (let i = 0; i < eventCount; i++) {
        await livia.process({
            event: 'operator.decision.final',
            timestamp: new Date().toISOString(),
            promptId: `perf-test-${i}`,
            decisionId: `perf-decision-${i}`,
            accepted: true,
            context: { action: 'perf_test', payload: { index: i } },
            auth: { userId: 'perf-user', role: 'operator' }
        });
    }
    
    const endTime = Date.now();
    const duration = endTime - startTime;
    const eventsPerSecond = (eventCount / duration) * 1000;
    
    console.log(`✅ Performance Test Tamamlandı:`);
    console.log(`- ${eventCount} event işlendi`);
    console.log(`- Süre: ${duration}ms`);
    console.log(`- Hız: ${eventsPerSecond.toFixed(2)} event/saniye`);
    
    await livia.shutdown();
}

// Test seçimi
async function runTests() {
    const testType = process.argv[2] || 'basic';
    
    switch (testType) {
        case 'basic':
            await testLIVIA();
            break;
        case 'performance':
            await performanceTest();
            break;
        case 'all':
            await testLIVIA();
            await performanceTest();
            break;
        default:
            console.log('Kullanım: node test-livia.js [basic|performance|all]');
            process.exit(1);
    }
}

// Script direkt çalıştırılırsa testi başlat
if (require.main === module) {
    runTests().catch(console.error);
}

module.exports = { testLIVIA, performanceTest };