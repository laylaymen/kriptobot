/**
 * LIVIA-32 · realtimeUptimeSLOGuard.js
 * Gerçek zamanlı uptime ve SLO koruma modülü
 */

class RealtimeUptimeSLOGuard {
    constructor(config = {}) {
        this.name = 'RealtimeUptimeSLOGuard';
        this.config = {
            enabled: true,
            i18n: { locale: 'tr-TR', tz: 'Europe/Istanbul' },
            services: {
                feed_ws: {
                    sloTargets: { uptime: 99.9, freshnessLagMsP95: 800 },
                    errorBudgetDays: 30,
                    windows: ['5m', '1h', '6h', '24h'],
                    burnThresholds: { '5m': 14.4, '1h': 6.0, '6h': 3.0, '24h': 1.0 },
                    actions: {
                        failover: { to: 'secondary' },
                        degrade: { drop: ['optional_metrics', 'low_priority_topics'] },
                        gate: { type: 'rate_limit', perMin: 60 }
                    }
                },
                order_api: {
                    sloTargets: { uptime: 99.95, latencyP95Ms: 900 },
                    errorBudgetDays: 30,
                    windows: ['5m', '1h', '6h', '24h'],
                    burnThresholds: { '5m': 10.0, '1h': 5.0, '6h': 2.5, '24h': 1.0 },
                    actions: {
                        circuit: { policy: 'open_on_5xx_spike' },
                        gate: { type: 'shed_load', dropPct: 0.2 },
                        degrade: { drop: ['advanced_routes'] }
                    }
                }
            },
            evaluation: {
                slideEverySec: 5,
                calcMode: 'fast_ewma',
                minSamplesPerWindow: 5,
                freshnessMetric: 'lagMs',
                availabilityFrom: { httpProbe: true, heartbeat: true, errorEvent: true, circuit: true }
            },
            integrations: {
                gate: 'LIVIA-17',
                cooldown: 'LIVIA-16',
                dist: 'LIVIA-22',
                digest: 'LIVIA-14',
                policy: 'LIVIA-23',
                ethics: 'LIVIA-26'
            },
            failover: {
                enable: true,
                prefer: 'secondary',
                autoFailback: true,
                guard: { minStableMin: 10, maxFailoverPerHour: 3 }
            },
            recovery: {
                stableAfterMin: 15,
                revertActions: ['gate', 'degrade'],
                recoveryTimeoutMin: 60
            },
            idempotencyTtlSec: 3600,
            ...config
        };
        this.isInitialized = false;
        this.logger = null;
        this.eventBus = null;
        this.state = 'IDLE';
        this.sloStore = new Map(); // Service SLO durumları
        this.windowStore = new Map(); // Pencere verileri
        this.actionStore = new Map(); // Aktif eylemler
        this.burnCalculator = null;
        this.aggregator = null;
    }

    async initialize(logger, eventBus) {
        try {
            this.logger = logger;
            this.eventBus = eventBus;
            this.logger.info(`${this.name} başlatılıyor...`);
            
            await this.setup();
            this.setupEventListeners();
            this.initializeComponents();
            
            this.isInitialized = true;
            this.logger.info(`${this.name} başarıyla başlatıldı`);
            return true;
        } catch (error) {
            this.logger.error(`${this.name} başlatma hatası:`, error);
            return false;
        }
    }

    async setup() {
        if (this.config.enabled) {
            await this.initializeSLOServices();
            this.logger.info(`${this.name} kurulumu tamamlandı`);
        }
    }

    setupEventListeners() {
        if (!this.eventBus) return;

        // Probe ve monitoring eventleri
        this.eventBus.on('probe.http.result', (data) => this.handleProbeResult(data));
        this.eventBus.on('feed.tick', (data) => this.handleFeedTick(data));
        this.eventBus.on('heartbeat.missed', (data) => this.handleHeartbeatMissed(data));
        this.eventBus.on('error.event', (data) => this.handleErrorEvent(data));
        this.eventBus.on('circuit.state', (data) => this.handleCircuitState(data));
        this.eventBus.on('failover.done', (data) => this.handleFailoverDone(data));
        this.eventBus.on('telemetry.slo.status', (data) => this.handleSLOStatus(data));
        
        // Timer event for sliding window evaluation
        setInterval(() => this.slideEvaluation(), this.config.evaluation.slideEverySec * 1000);
    }

    initializeComponents() {
        this.burnCalculator = new BurnRateCalculator(this.config);
        this.aggregator = new WindowAggregator(this.config);
        
        // Her servis için SLO durumunu başlat
        for (const [serviceId, serviceConfig] of Object.entries(this.config.services)) {
            this.sloStore.set(serviceId, {
                serviceId,
                config: serviceConfig,
                windows: new Map(),
                activeActions: new Set(),
                lastTrigger: null,
                lastRecovery: null,
                state: 'IDLE'
            });
        }
    }

    async process(data) {
        if (!this.isInitialized) {
            throw new Error(`${this.name} henüz başlatılmadı`);
        }

        try {
            const result = await this.processSLOGuard(data);
            return {
                success: true,
                data: result,
                timestamp: new Date().toISOString(),
                source: this.name
            };
        } catch (error) {
            this.logger.error(`${this.name} işlem hatası:`, error);
            return {
                success: false,
                error: error.message,
                timestamp: new Date().toISOString(),
                source: this.name
            };
        }
    }

    async processSLOGuard(data) {
        const guardKey = this.generateGuardKey(data);
        
        // Idempotency kontrolü
        if (this.actionStore.has(guardKey)) {
            const cached = this.actionStore.get(guardKey);
            if (Date.now() - cached.timestamp < this.config.idempotencyTtlSec * 1000) {
                return cached.result;
            }
        }

        const result = await this.evaluateAndAct(data);
        
        // Cache'e kaydet
        this.actionStore.set(guardKey, {
            result,
            timestamp: Date.now()
        });

        return result;
    }

    async evaluateAndAct(data) {
        const serviceId = data.serviceId;
        if (!this.sloStore.has(serviceId)) {
            return { action: 'unknown_service', serviceId };
        }

        const sloState = this.sloStore.get(serviceId);
        const serviceConfig = sloState.config;
        
        // Veriyi aggregate et
        await this.aggregateData(serviceId, data);
        
        // Burn rate hesapla
        const burnRates = this.calculateBurnRates(serviceId);
        
        // Trigger kontrolü
        const triggerResult = this.checkTriggers(serviceId, burnRates);
        
        if (triggerResult.shouldTrigger) {
            return await this.triggerActions(serviceId, triggerResult);
        }
        
        // Early warning kontrolü
        const warningResult = this.checkEarlyWarning(serviceId, burnRates);
        if (warningResult.shouldWarn) {
            return await this.triggerEarlyWarning(serviceId, warningResult);
        }
        
        // Recovery kontrolü
        const recoveryResult = this.checkRecovery(serviceId, burnRates);
        if (recoveryResult.shouldRecover) {
            return await this.triggerRecovery(serviceId, recoveryResult);
        }
        
        return { action: 'no_action', serviceId, burnRates };
    }

    async aggregateData(serviceId, data) {
        this.aggregator.addSample(serviceId, data);
        
        // Her pencere için aggregation güncelle
        const sloState = this.sloStore.get(serviceId);
        const windows = sloState.config.windows;
        
        for (const window of windows) {
            const windowData = this.aggregator.getWindowData(serviceId, window);
            sloState.windows.set(window, windowData);
        }
    }

    calculateBurnRates(serviceId) {
        const sloState = this.sloStore.get(serviceId);
        const burnRates = {};
        
        for (const [window, windowData] of sloState.windows.entries()) {
            const availability = this.calculateAvailability(windowData);
            const errorBudget = 1 - (sloState.config.sloTargets.uptime / 100);
            const burnRate = (1 - availability) / errorBudget;
            
            burnRates[window] = {
                availability: availability * 100,
                burnRate,
                threshold: sloState.config.burnThresholds[window]
            };
        }
        
        return burnRates;
    }

    calculateAvailability(windowData) {
        if (!windowData || windowData.totalSamples < this.config.evaluation.minSamplesPerWindow) {
            return 1.0; // Veri yetersizse optimistic
        }
        
        return windowData.okSamples / windowData.totalSamples;
    }

    checkTriggers(serviceId, burnRates) {
        const sloState = this.sloStore.get(serviceId);
        const triggeredWindows = [];
        
        for (const [window, burnData] of Object.entries(burnRates)) {
            if (burnData.burnRate >= burnData.threshold) {
                triggeredWindows.push(window);
            }
        }
        
        if (triggeredWindows.length > 0 && sloState.state !== 'TRIGGERED') {
            return {
                shouldTrigger: true,
                windows: triggeredWindows,
                burnRates,
                severity: this.calculateSeverity(triggeredWindows, burnRates)
            };
        }
        
        return { shouldTrigger: false };
    }

    checkEarlyWarning(serviceId, burnRates) {
        const shortestWindow = '5m';
        const burnData = burnRates[shortestWindow];
        
        if (burnData && burnData.burnRate >= (burnData.threshold * 0.5)) {
            return {
                shouldWarn: true,
                window: shortestWindow,
                burnRate: burnData.burnRate,
                threshold: burnData.threshold
            };
        }
        
        return { shouldWarn: false };
    }

    checkRecovery(serviceId, burnRates) {
        const sloState = this.sloStore.get(serviceId);
        
        if (sloState.state !== 'MONITOR' || !sloState.lastTrigger) {
            return { shouldRecover: false };
        }
        
        // Tüm burn rate'ler threshold altında mı?
        const allStable = Object.values(burnRates).every(burnData => 
            burnData.burnRate < burnData.threshold
        );
        
        if (allStable) {
            const stableTime = Date.now() - sloState.lastTrigger;
            const requiredStableTime = this.config.recovery.stableAfterMin * 60 * 1000;
            
            if (stableTime >= requiredStableTime) {
                return {
                    shouldRecover: true,
                    stableTimeMin: Math.round(stableTime / 60000),
                    burnRates
                };
            }
        }
        
        return { shouldRecover: false };
    }

    async triggerActions(serviceId, triggerResult) {
        const sloState = this.sloStore.get(serviceId);
        const serviceConfig = sloState.config;
        const actions = serviceConfig.actions;
        
        this.logger.warn(`SLO Guard triggered for ${serviceId}:`, triggerResult);
        
        // State update
        sloState.state = 'TRIGGERED';
        sloState.lastTrigger = Date.now();
        
        const actionPlan = {};
        const appliedActions = [];
        
        // Failover
        if (actions.failover && this.canFailover(serviceId)) {
            actionPlan.failover = actions.failover.to;
            appliedActions.push('failover');
            await this.applyFailover(serviceId, actions.failover);
        }
        
        // Degrade
        if (actions.degrade) {
            actionPlan.degrade = actions.degrade.drop;
            appliedActions.push('degrade');
            await this.applyDegrade(serviceId, actions.degrade);
        }
        
        // Gate (Rate limiting)
        if (actions.gate) {
            actionPlan.gate = actions.gate.type;
            appliedActions.push('gate');
            await this.applyGate(serviceId, actions.gate);
        }
        
        // Circuit breaker
        if (actions.circuit) {
            actionPlan.circuit = actions.circuit.policy;
            appliedActions.push('circuit');
            await this.applyCircuit(serviceId, actions.circuit);
        }
        
        sloState.activeActions = new Set(appliedActions);
        sloState.state = 'MONITOR';
        
        const result = {
            action: 'triggered',
            serviceId,
            slo: this.getSLOType(serviceId),
            windows: this.formatWindows(triggerResult.burnRates),
            trigger: 'multi_window_burn',
            actionPlan,
            severity: triggerResult.severity,
            hash: this.generateHash(serviceId, triggerResult)
        };
        
        // Events emit
        await this.emitTriggerEvents(result);
        
        return result;
    }

    async triggerEarlyWarning(serviceId, warningResult) {
        const result = {
            action: 'early_warning',
            serviceId,
            slo: this.getSLOType(serviceId),
            window: warningResult.window,
            burnRate: warningResult.burnRate,
            threshold: warningResult.threshold,
            hint: `If 1h burn > ${warningResult.threshold * 6}x threshold, trigger will fire.`
        };
        
        await this.emitEarlyWarning(result);
        return result;
    }

    async triggerRecovery(serviceId, recoveryResult) {
        const sloState = this.sloStore.get(serviceId);
        
        this.logger.info(`SLO Guard recovery for ${serviceId}:`, recoveryResult);
        
        const revertedActions = [];
        
        // Revert actions
        for (const action of sloState.activeActions) {
            await this.revertAction(serviceId, action);
            revertedActions.push(action);
        }
        
        // Failback
        let failback = null;
        if (this.config.failover.autoFailback && sloState.activeActions.has('failover')) {
            failback = 'primary';
            await this.applyFailback(serviceId);
        }
        
        sloState.activeActions.clear();
        sloState.state = 'IDLE';
        sloState.lastRecovery = Date.now();
        
        const result = {
            action: 'recovered',
            serviceId,
            slo: this.getSLOType(serviceId),
            since: new Date(sloState.lastTrigger).toISOString(),
            durationMin: Math.round((Date.now() - sloState.lastTrigger) / 60000),
            actionsReverted: revertedActions,
            failback
        };
        
        await this.emitRecoveryEvents(result);
        return result;
    }

    calculateSeverity(triggeredWindows, burnRates) {
        // Kısa pencereler yüksek burn → high severity
        if (triggeredWindows.includes('5m') || triggeredWindows.includes('1h')) {
            return 'high';
        }
        
        if (triggeredWindows.includes('6h')) {
            return 'medium';
        }
        
        return 'low';
    }

    canFailover(serviceId) {
        const now = Date.now();
        const oneHourAgo = now - (60 * 60 * 1000);
        
        // Son 1 saatteki failover sayısını kontrol et
        const recentFailovers = Array.from(this.actionStore.values())
            .filter(entry => 
                entry.timestamp > oneHourAgo && 
                entry.result.serviceId === serviceId &&
                entry.result.actionPlan?.failover
            ).length;
        
        return recentFailovers < this.config.failover.guard.maxFailoverPerHour;
    }

    async applyFailover(serviceId, failoverConfig) {
        if (this.eventBus) {
            this.eventBus.emit('slo.guard.failover', {
                event: 'slo.guard.failover',
                timestamp: new Date().toISOString(),
                serviceId,
                to: failoverConfig.to,
                reason: 'burn_rate_exceeded'
            });
        }
    }

    async applyDegrade(serviceId, degradeConfig) {
        if (this.eventBus) {
            this.eventBus.emit('slo.guard.degrade', {
                event: 'slo.guard.degrade',
                timestamp: new Date().toISOString(),
                serviceId,
                drop: degradeConfig.drop,
                reason: 'burn_rate_exceeded'
            });
        }
    }

    async applyGate(serviceId, gateConfig) {
        if (this.eventBus) {
            this.eventBus.emit('slo.guard.gate', {
                event: 'slo.guard.gate',
                timestamp: new Date().toISOString(),
                serviceId,
                type: gateConfig.type,
                config: gateConfig,
                reason: 'burn_rate_exceeded'
            });
        }
    }

    async applyCircuit(serviceId, circuitConfig) {
        if (this.eventBus) {
            this.eventBus.emit('slo.guard.circuit', {
                event: 'slo.guard.circuit',
                timestamp: new Date().toISOString(),
                serviceId,
                policy: circuitConfig.policy,
                reason: 'burn_rate_exceeded'
            });
        }
    }

    async revertAction(serviceId, action) {
        if (this.eventBus) {
            this.eventBus.emit('slo.guard.revert', {
                event: 'slo.guard.revert',
                timestamp: new Date().toISOString(),
                serviceId,
                action,
                reason: 'recovery_stable'
            });
        }
    }

    async applyFailback(serviceId) {
        if (this.eventBus) {
            this.eventBus.emit('slo.guard.failback', {
                event: 'slo.guard.failback',
                timestamp: new Date().toISOString(),
                serviceId,
                to: 'primary',
                reason: 'recovery_stable'
            });
        }
    }

    async slideEvaluation() {
        if (!this.isInitialized) return;
        
        for (const serviceId of this.sloStore.keys()) {
            try {
                await this.process({ serviceId, event: 'slide_eval', timestamp: new Date().toISOString() });
            } catch (error) {
                this.logger.error(`Slide evaluation error for ${serviceId}:`, error);
            }
        }
        
        await this.emitMetrics();
    }

    // Event Handlers
    handleProbeResult(data) {
        this.aggregator.addProbeResult(data.serviceId, {
            ok: data.ok,
            status: data.status,
            latencyMs: data.latencyMs,
            timestamp: data.timestamp
        });
    }

    handleFeedTick(data) {
        this.aggregator.addFeedTick(data.serviceId, {
            symbol: data.symbol,
            lagMs: data.lagMs,
            gapMs: data.gapMs,
            timestamp: data.timestamp
        });
    }

    handleHeartbeatMissed(data) {
        this.aggregator.addHeartbeatMissed(data.serviceId, {
            missedCount: data.missedCount,
            expectedEveryMs: data.expectedEveryMs,
            timestamp: data.timestamp
        });
    }

    handleErrorEvent(data) {
        this.aggregator.addErrorEvent(data.serviceId, {
            kind: data.kind,
            details: data.details,
            count: data.count,
            timestamp: data.timestamp
        });
    }

    handleCircuitState(data) {
        this.aggregator.addCircuitState(data.serviceId, {
            state: data.state,
            reason: data.reason,
            timestamp: data.timestamp
        });
    }

    handleFailoverDone(data) {
        this.logger.info(`Failover completed: ${data.serviceId} ${data.from} -> ${data.to}`);
    }

    handleSLOStatus(data) {
        // External telemetry SLO status
        this.logger.debug(`External SLO status: ${data.slo} -> ${data.state}`);
    }

    // Emit Events
    async emitTriggerEvents(result) {
        if (!this.eventBus) return;

        // Main trigger event
        this.eventBus.emit('slo.guard.triggered', {
            event: 'slo.guard.triggered',
            timestamp: new Date().toISOString(),
            ...result
        });

        // UI Card
        const card = this.createTriggerCard(result);
        this.eventBus.emit('slo.guard.card', card);
    }

    async emitEarlyWarning(result) {
        if (!this.eventBus) return;

        this.eventBus.emit('slo.guard.earlywarn', {
            event: 'slo.guard.earlywarn',
            timestamp: new Date().toISOString(),
            ...result
        });

        // Warning card
        const card = this.createWarningCard(result);
        this.eventBus.emit('slo.guard.card', card);
    }

    async emitRecoveryEvents(result) {
        if (!this.eventBus) return;

        this.eventBus.emit('slo.guard.recovered', {
            event: 'slo.guard.recovered',
            timestamp: new Date().toISOString(),
            ...result
        });

        // Recovery card
        const card = this.createRecoveryCard(result);
        this.eventBus.emit('slo.guard.card', card);
    }

    async emitMetrics() {
        if (!this.eventBus) return;

        const totalEvaluations = this.actionStore.size;
        const triggers = Array.from(this.actionStore.values())
            .filter(entry => entry.result.action === 'triggered').length;
        const recoveries = Array.from(this.actionStore.values())
            .filter(entry => entry.result.action === 'recovered').length;
        const earlyWarns = Array.from(this.actionStore.values())
            .filter(entry => entry.result.action === 'early_warning').length;

        this.eventBus.emit('slo.guard.metrics', {
            event: 'slo.guard.metrics',
            timestamp: new Date().toISOString(),
            evaluated: totalEvaluations,
            triggers,
            recoveries,
            earlyWarn: earlyWarns,
            p95EvalMs: 6.4, // Mock
            failovers: triggers, // Simplified
            gates: triggers,
            degrades: triggers
        });
    }

    createTriggerCard(result) {
        const actionSummary = Object.keys(result.actionPlan).join(' + ');
        
        return {
            event: 'slo.guard.card',
            timestamp: new Date().toISOString(),
            title: `SLO Guard — ${result.serviceId} (burn ${result.severity})`,
            body: `${actionSummary} • koruma devrede • gözlem sürüyor`,
            severity: result.severity === 'high' ? 'error' : 'warn',
            ttlSec: 600
        };
    }

    createWarningCard(result) {
        return {
            event: 'slo.guard.card',
            timestamp: new Date().toISOString(),
            title: `SLO Uyarı — ${result.serviceId}`,
            body: `${result.window} burn ${result.burnRate.toFixed(1)}× • eşik yaklaşıyor`,
            severity: 'warn',
            ttlSec: 300
        };
    }

    createRecoveryCard(result) {
        return {
            event: 'slo.guard.card',
            timestamp: new Date().toISOString(),
            title: `SLO Kurtarıldı — ${result.serviceId}`,
            body: `${result.durationMin}dk sonra normale döndü • eylemler kaldırıldı`,
            severity: 'info',
            ttlSec: 600
        };
    }

    // Utility methods
    generateGuardKey(data) {
        const crypto = require('crypto');
        const serviceId = data.serviceId || 'unknown';
        const triggerType = data.event || 'manual';
        const windowStartISO = new Date().toISOString().split(':')[0]; // Hour precision
        
        return crypto.createHash('sha256').update(`${serviceId}+${triggerType}+${windowStartISO}`).digest('hex').substring(0, 16);
    }

    generateHash(serviceId, triggerResult) {
        const crypto = require('crypto');
        const content = JSON.stringify({ serviceId, windows: triggerResult.windows, severity: triggerResult.severity });
        return crypto.createHash('sha256').update(content).digest('hex');
    }

    getSLOType(serviceId) {
        if (serviceId.includes('feed')) return 'uptime_feed';
        if (serviceId.includes('api')) return 'uptime_api';
        return 'uptime_generic';
    }

    formatWindows(burnRates) {
        const formatted = {};
        for (const [window, data] of Object.entries(burnRates)) {
            formatted[window] = {
                avail: Math.round(data.availability * 10) / 10,
                burn: Math.round(data.burnRate * 10) / 10
            };
        }
        return formatted;
    }

    async initializeSLOServices() {
        // Mock SLO services initialization
        this.logger.debug('SLO services initialized');
    }

    getStatus() {
        return {
            name: this.name,
            initialized: this.isInitialized,
            enabled: this.config.enabled,
            state: this.state,
            services: Array.from(this.sloStore.keys()),
            activeActions: Array.from(this.sloStore.values())
                .filter(slo => slo.activeActions.size > 0)
                .map(slo => ({ serviceId: slo.serviceId, actions: Array.from(slo.activeActions) })),
            config: this.config
        };
    }

    async shutdown() {
        try {
            this.logger.info(`${this.name} durduruluyor...`);
            
            this.sloStore.clear();
            this.windowStore.clear();
            this.actionStore.clear();
            
            this.isInitialized = false;
            this.logger.info(`${this.name} başarıyla durduruldu`);
        } catch (error) {
            this.logger.error(`${this.name} durdurma hatası:`, error);
        }
    }
}

// Helper Classes
class BurnRateCalculator {
    constructor(config) {
        this.config = config;
    }
}

class WindowAggregator {
    constructor(config) {
        this.config = config;
        this.samples = new Map();
    }

    addSample(serviceId, data) {
        if (!this.samples.has(serviceId)) {
            this.samples.set(serviceId, []);
        }
        
        this.samples.get(serviceId).push({
            ...data,
            timestamp: new Date(data.timestamp).getTime()
        });
        
        // Keep only recent samples
        this.cleanOldSamples(serviceId);
    }

    addProbeResult(serviceId, data) {
        this.addSample(serviceId, { type: 'probe', ok: data.ok, ...data });
    }

    addFeedTick(serviceId, data) {
        this.addSample(serviceId, { type: 'feed', ok: data.lagMs < 1000, ...data });
    }

    addHeartbeatMissed(serviceId, data) {
        this.addSample(serviceId, { type: 'heartbeat', ok: false, ...data });
    }

    addErrorEvent(serviceId, data) {
        this.addSample(serviceId, { type: 'error', ok: false, ...data });
    }

    addCircuitState(serviceId, data) {
        this.addSample(serviceId, { type: 'circuit', ok: data.state === 'closed', ...data });
    }

    getWindowData(serviceId, window) {
        const samples = this.samples.get(serviceId) || [];
        const windowMs = this.parseWindow(window);
        const cutoff = Date.now() - windowMs;
        
        const windowSamples = samples.filter(sample => sample.timestamp >= cutoff);
        
        return {
            totalSamples: windowSamples.length,
            okSamples: windowSamples.filter(sample => sample.ok).length,
            window,
            samples: windowSamples
        };
    }

    parseWindow(window) {
        const unit = window.slice(-1);
        const value = parseInt(window.slice(0, -1));
        
        switch (unit) {
            case 'm': return value * 60 * 1000;
            case 'h': return value * 60 * 60 * 1000;
            default: return 5 * 60 * 1000; // Default 5m
        }
    }

    cleanOldSamples(serviceId) {
        const samples = this.samples.get(serviceId) || [];
        const maxAge = 24 * 60 * 60 * 1000; // 24 hours
        const cutoff = Date.now() - maxAge;
        
        const filtered = samples.filter(sample => sample.timestamp >= cutoff);
        this.samples.set(serviceId, filtered);
    }
}

module.exports = RealtimeUptimeSLOGuard;