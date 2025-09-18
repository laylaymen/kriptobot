/**
 * 🎯 Core Orchestrator - Kriptobot Merkezi Sistem Koordinatörü
 * Tüm sistemlerin lifecycle'ını yönetir ve koordine eder
 * 
 * Sorumlulukları:
 * - System startup/shutdown sequence
 * - Dependency management
 * - Health monitoring
 * - Error handling ve recovery
 * - Configuration management
 * - Performance optimization
 */

const { eventBus, EVENT_TYPES } = require('./modularEventStream');
const { logError, logEvent, logInfo } = require('../logs/logger');

class CoreOrchestrator {
    constructor(config = {}) {
        this.config = {
            startupTimeout: 30000, // 30 saniye
            shutdownTimeout: 10000, // 10 saniye
            healthCheckInterval: 60000, // 1 dakika
            maxRetries: 3,
            enableAutoRecovery: true,
            ...config
        };

        // Sistem durumu tracking
        this.systemStates = new Map([
            ['eventBus', { status: 'stopped', priority: 1, dependencies: [] }],
            ['dataInfrastructure', { status: 'stopped', priority: 2, dependencies: ['eventBus'] }],
            ['grafikBeyni', { status: 'stopped', priority: 3, dependencies: ['eventBus', 'dataInfrastructure'] }],
            ['otobilinc', { status: 'stopped', priority: 4, dependencies: ['eventBus', 'grafikBeyni'] }],
            ['livia', { status: 'stopped', priority: 5, dependencies: ['eventBus', 'grafikBeyni'] }],
            ['vivo', { status: 'stopped', priority: 6, dependencies: ['eventBus', 'grafikBeyni', 'otobilinc', 'livia'] }],
            ['denetimAsistani', { status: 'stopped', priority: 7, dependencies: ['eventBus', 'vivo'] }]
        ]);

        // System adapters registry
        this.systemAdapters = new Map();
        this.systemInstances = new Map();

        // Orchestrator state
        this.isRunning = false;
        this.startupProgress = 0;
        this.healthCheckTimer = null;
        this.retryCount = new Map();

        // Performance metrics
        this.metrics = {
            startTime: null,
            uptime: 0,
            systemErrors: 0,
            recoveryAttempts: 0,
            lastHealthCheck: null
        };

        this.setupEventListeners();
    }

    /**
     * Ana sistem başlatma sequence'ı
     */
    async startSystem() {
        if (this.isRunning) {
            logInfo('Sistem zaten çalışıyor', 'CoreOrchestrator');
            return true;
        }

        logInfo('🚀 Kriptobot sistemini başlatıyor...', 'CoreOrchestrator');
        this.metrics.startTime = Date.now();
        this.isRunning = true;

        try {
            // 1. Event Bus başlat
            await this.startEventBus();

            // 2. Dependency sırasına göre sistemleri başlat
            const startupOrder = this.calculateStartupOrder();
            
            for (const systemName of startupOrder) {
                await this.startSystem_internal(systemName);
                this.startupProgress = (startupOrder.indexOf(systemName) + 1) / startupOrder.length * 100;
                
                logInfo(`✅ ${systemName} başlatıldı (${this.startupProgress.toFixed(1)}%)`, 'CoreOrchestrator');
            }

            // 3. Health monitoring başlat
            this.startHealthMonitoring();

            // 4. System ready notification
            eventBus.publishEvent('system.orchestrator.ready', {
                systems: Array.from(this.systemStates.keys()),
                startupTime: Date.now() - this.metrics.startTime,
                version: '1.0.0'
            }, 'coreOrchestrator');

            logInfo('🎉 Kriptobot sistemi başarıyla başlatıldı!', 'CoreOrchestrator');
            return true;

        } catch (error) {
            logError(error, 'CoreOrchestrator Startup');
            await this.handleStartupError(error);
            return false;
        }
    }

    /**
     * Sistem kapatma sequence'ı
     */
    async stopSystem() {
        if (!this.isRunning) {
            logInfo('Sistem zaten durmuş', 'CoreOrchestrator');
            return true;
        }

        logInfo('🔄 Kriptobot sistemini kapatıyor...', 'CoreOrchestrator');

        try {
            // 1. Health monitoring durdur
            this.stopHealthMonitoring();

            // 2. Ters dependency sırasına göre sistemleri kapat
            const shutdownOrder = this.calculateStartupOrder().reverse();
            
            for (const systemName of shutdownOrder) {
                await this.stopSystem_internal(systemName);
                logInfo(`🔴 ${systemName} kapatıldı`, 'CoreOrchestrator');
            }

            // 3. Event Bus'ı kapat
            await this.stopEventBus();

            this.isRunning = false;
            logInfo('✅ Kriptobot sistemi başarıyla kapatıldı', 'CoreOrchestrator');
            return true;

        } catch (error) {
            logError(error, 'CoreOrchestrator Shutdown');
            return false;
        }
    }

    /**
     * Sistem adapter'ı register etme
     */
    registerSystemAdapter(systemName, adapterClass, config = {}) {
        try {
            const adapter = new adapterClass(config);
            this.systemAdapters.set(systemName, adapter);
            this.systemInstances.set(systemName, null);
            
            logInfo(`📋 ${systemName} adapter'ı register edildi`, 'CoreOrchestrator');
            return true;
        } catch (error) {
            logError(error, `CoreOrchestrator Register ${systemName}`);
            return false;
        }
    }

    /**
     * Dependency sırasına göre startup order hesapla
     */
    calculateStartupOrder() {
        const order = [];
        const visited = new Set();
        const visiting = new Set();

        const visit = (systemName) => {
            if (visiting.has(systemName)) {
                throw new Error(`Circular dependency detected: ${systemName}`);
            }
            if (visited.has(systemName)) return;

            visiting.add(systemName);
            const system = this.systemStates.get(systemName);
            
            if (system && system.dependencies) {
                for (const dep of system.dependencies) {
                    visit(dep);
                }
            }

            visiting.delete(systemName);
            visited.add(systemName);
            order.push(systemName);
        };

        // Priority sırasına göre sistemleri işle
        const sortedSystems = Array.from(this.systemStates.entries())
            .sort(([,a], [,b]) => a.priority - b.priority)
            .map(([name]) => name);

        for (const systemName of sortedSystems) {
            visit(systemName);
        }

        return order;
    }

    /**
     * Tek bir sistemi başlatma
     */
    async startSystem_internal(systemName) {
        const system = this.systemStates.get(systemName);
        if (!system) {
            throw new Error(`Unknown system: ${systemName}`);
        }

        if (system.status === 'running') {
            return true;
        }

        // Dependencies kontrolü
        for (const dep of system.dependencies) {
            const depSystem = this.systemStates.get(dep);
            if (!depSystem || depSystem.status !== 'running') {
                throw new Error(`Dependency ${dep} not ready for ${systemName}`);
            }
        }

        try {
            system.status = 'starting';
            
            // System-specific startup logic
            switch (systemName) {
                case 'eventBus':
                    // Already started
                    break;
                case 'dataInfrastructure':
                    await this.startDataInfrastructure();
                    break;
                case 'grafikBeyni':
                    await this.startGrafikBeyni();
                    break;
                case 'otobilinc':
                    await this.startOtobilinc();
                    break;
                case 'livia':
                    await this.startLivia();
                    break;
                case 'vivo':
                    await this.startVivo();
                    break;
                case 'denetimAsistani':
                    await this.startDenetimAsistani();
                    break;
                default:
                    logInfo(`Generic startup for ${systemName}`, 'CoreOrchestrator');
            }

            system.status = 'running';
            system.lastStarted = Date.now();
            
            // Reset retry count on successful start
            this.retryCount.delete(systemName);
            
            return true;

        } catch (error) {
            system.status = 'error';
            system.lastError = error.message;
            
            // Retry logic
            const retries = this.retryCount.get(systemName) || 0;
            if (retries < this.config.maxRetries) {
                this.retryCount.set(systemName, retries + 1);
                logInfo(`🔄 ${systemName} retry ${retries + 1}/${this.config.maxRetries}`, 'CoreOrchestrator');
                
                await new Promise(resolve => setTimeout(resolve, 2000 * (retries + 1))); // Exponential backoff
                return await this.startSystem_internal(systemName);
            }
            
            throw error;
        }
    }

    /**
     * Sistem-specific başlatma methodları
     */
    async startEventBus() {
        // Event Bus zaten ModularEventStream singleton olarak çalışıyor
        this.systemStates.get('eventBus').status = 'running';
        logInfo('📡 Event Bus başlatıldı', 'CoreOrchestrator');
    }

    async startDataInfrastructure() {
        // Data fetcher, UMF, storage sistemleri
        logInfo('💾 Data Infrastructure başlatılıyor', 'CoreOrchestrator');
        // Burada dataFetcher, unifiedMarketFeed vb. başlatılacak
    }

    async startGrafikBeyni() {
        const adapter = this.systemAdapters.get('grafikBeyni');
        if (adapter) {
            adapter.connect();
            logInfo('🧠 Grafik Beyni başlatıldı', 'CoreOrchestrator');
        }
    }

    async startOtobilinc() {
        const adapter = this.systemAdapters.get('otobilinc');
        if (adapter) {
            // adapter.connect();
            logInfo('🧠 Otobilinç başlatıldı', 'CoreOrchestrator');
        }
    }

    async startLivia() {
        const adapter = this.systemAdapters.get('livia');
        if (adapter) {
            // adapter.connect();
            logInfo('💭 LIVIA başlatıldı', 'CoreOrchestrator');
        }
    }

    async startVivo() {
        const adapter = this.systemAdapters.get('vivo');
        if (adapter) {
            adapter.connect();
            logInfo('🔄 VIVO başlatıldı', 'CoreOrchestrator');
        }
    }

    async startDenetimAsistani() {
        const adapter = this.systemAdapters.get('denetimAsistani');
        if (adapter) {
            // adapter.connect();
            logInfo('🔍 Denetim Asistanı başlatıldı', 'CoreOrchestrator');
        }
    }

    /**
     * Tek bir sistemi durdurma
     */
    async stopSystem_internal(systemName) {
        const system = this.systemStates.get(systemName);
        if (!system || system.status !== 'running') {
            return true;
        }

        try {
            system.status = 'stopping';
            
            const adapter = this.systemAdapters.get(systemName);
            if (adapter && adapter.disconnect) {
                adapter.disconnect();
            }

            system.status = 'stopped';
            return true;

        } catch (error) {
            logError(error, `CoreOrchestrator Stop ${systemName}`);
            system.status = 'error';
            return false;
        }
    }

    async stopEventBus() {
        // Event Bus graceful shutdown
        this.systemStates.get('eventBus').status = 'stopped';
        logInfo('📡 Event Bus kapatıldı', 'CoreOrchestrator');
    }

    /**
     * Health monitoring
     */
    startHealthMonitoring() {
        this.healthCheckTimer = setInterval(async () => {
            await this.performHealthCheck();
        }, this.config.healthCheckInterval);
        
        logInfo('❤️ Health monitoring başlatıldı', 'CoreOrchestrator');
    }

    stopHealthMonitoring() {
        if (this.healthCheckTimer) {
            clearInterval(this.healthCheckTimer);
            this.healthCheckTimer = null;
            logInfo('❤️ Health monitoring durduruldu', 'CoreOrchestrator');
        }
    }

    async performHealthCheck() {
        this.metrics.lastHealthCheck = Date.now();
        this.metrics.uptime = Date.now() - this.metrics.startTime;

        const healthReport = {
            timestamp: Date.now(),
            uptime: this.metrics.uptime,
            systems: {}
        };

        for (const [systemName, system] of this.systemStates) {
            healthReport.systems[systemName] = {
                status: system.status,
                lastStarted: system.lastStarted,
                lastError: system.lastError
            };
        }

        eventBus.publishEvent('system.health.report', healthReport, 'coreOrchestrator');
        
        // Auto-recovery logic
        if (this.config.enableAutoRecovery) {
            await this.checkAutoRecovery();
        }
    }

    async checkAutoRecovery() {
        for (const [systemName, system] of this.systemStates) {
            if (system.status === 'error' && systemName !== 'eventBus') {
                logInfo(`🔧 Auto-recovery attempt for ${systemName}`, 'CoreOrchestrator');
                this.metrics.recoveryAttempts++;
                
                try {
                    await this.startSystem_internal(systemName);
                    logInfo(`✅ Auto-recovery successful for ${systemName}`, 'CoreOrchestrator');
                } catch (error) {
                    logError(error, `Auto-recovery failed for ${systemName}`);
                }
            }
        }
    }

    /**
     * Event listener setup
     */
    setupEventListeners() {
        // System error handling
        eventBus.subscribeToEvent('system.error', (event) => {
            this.handleSystemError(event.data);
        }, 'coreOrchestrator');

        // System ready notifications
        eventBus.subscribeToEvent('system.ready', (event) => {
            logInfo(`System ready: ${event.data.system}`, 'CoreOrchestrator');
        }, 'coreOrchestrator');
    }

    async handleSystemError(errorData) {
        this.metrics.systemErrors++;
        logError(errorData, 'System Error Detected');

        if (this.config.enableAutoRecovery) {
            // Implement error-specific recovery logic
        }
    }

    async handleStartupError(error) {
        logError(error, 'Startup Error');
        
        // Cleanup partial startup
        for (const [systemName, system] of this.systemStates) {
            if (system.status === 'starting' || system.status === 'running') {
                await this.stopSystem_internal(systemName);
            }
        }
        
        this.isRunning = false;
    }

    /**
     * Status ve metrics getters
     */
    getSystemStatus() {
        const status = {
            isRunning: this.isRunning,
            startupProgress: this.startupProgress,
            metrics: this.metrics,
            systems: Object.fromEntries(this.systemStates)
        };
        
        return status;
    }

    getHealthReport() {
        return {
            timestamp: Date.now(),
            orchestrator: this.getSystemStatus(),
            eventBus: eventBus.getSystemStatus()
        };
    }

    /**
     * Graceful shutdown
     */
    async gracefulShutdown() {
        logInfo('🛑 Graceful shutdown başlatıldı', 'CoreOrchestrator');
        
        try {
            await this.stopSystem();
            process.exit(0);
        } catch (error) {
            logError(error, 'Graceful Shutdown');
            process.exit(1);
        }
    }
}

// Singleton instance
const coreOrchestrator = new CoreOrchestrator();

// Process signal handlers
process.on('SIGINT', () => {
    console.log('\n🛑 SIGINT received. Initiating graceful shutdown...');
    coreOrchestrator.gracefulShutdown();
});

process.on('SIGTERM', () => {
    console.log('\n🛑 SIGTERM received. Initiating graceful shutdown...');
    coreOrchestrator.gracefulShutdown();
});

module.exports = { CoreOrchestrator, coreOrchestrator };