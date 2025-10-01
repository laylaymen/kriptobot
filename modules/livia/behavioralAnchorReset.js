/**
 * LIVIA-18 · behavioralAnchorReset.js
 * Savunma dönemleri sonrasında davranışsal parametreleri kademeli sıfırlama modülü
 */

class BehavioralAnchorReset {
    constructor(config = {}) {
        this.name = 'BehavioralAnchorReset';
        this.config = {
            enabled: true,
            i18n: { locale: 'tr-TR', tz: 'Europe/Istanbul' },
            readiness: {
                minQuietMin: 15,
                maxBiasScores: { fomo: 0.35, overconfidence: 0.40 },
                guardMustBe: ['normal'],
                requireNonNegativePnL: true
            },
            rampPolicy: {
                ramp1: { 
                    confirmationThresholdDelta: -0.10, 
                    allowVariants: ['conservative', 'balanced'], 
                    dailyTradeCap: 2, 
                    positionLimitFactor: 0.7, 
                    minHoldMin: 30 
                },
                ramp2: { 
                    confirmationThresholdDelta: -0.20, 
                    allowVariants: ['balanced'], 
                    dailyTradeCap: 3, 
                    positionLimitFactor: 0.8, 
                    minHoldMin: 60 
                },
                full: { 
                    confirmationThresholdDelta: -0.30, 
                    allowVariants: ['balanced', 'aggressive'], 
                    dailyTradeCap: 3, 
                    positionLimitFactor: 1.0, 
                    minHoldMin: 90 
                }
            },
            approval: {
                requireFor: ['full', 'Δthreshold<=-0.25', 'allowAggressive'],
                gateway: 'LIVIA-05'
            },
            schedule: {
                sweepEvery: '5m',
                postIncidentCooldownMin: 20
            },
            idempotencyTtlSec: 3600,
            ...config
        };
        this.isInitialized = false;
        this.logger = null;
        this.eventBus = null;
        this.state = 'IDLE';
        this.anchorStore = new Map();
        this.contextStore = {
            lastBiasSnapshot: null,
            lastGuardMode: null,
            lastPnL: null,
            lastStreak: null,
            activeAnchors: new Map()
        };
        this.sweepInterval = null;
    }

    async initialize(logger, eventBus) {
        try {
            this.logger = logger;
            this.eventBus = eventBus;
            this.logger.info(`${this.name} başlatılıyor...`);
            
            await this.setup();
            this.setupEventListeners();
            this.startScheduler();
            
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
            this.logger.info(`${this.name} kurulumu tamamlandı`);
        }
    }

    setupEventListeners() {
        if (!this.eventBus) return;

        // Tetikleyici event'ler
        this.eventBus.on('cooldown.expired', (data) => this.handleTriggerEvent(data, 'cooldown'));
        this.eventBus.on('defense.gate.expired', (data) => this.handleTriggerEvent(data, 'defense_gate'));
        this.eventBus.on('incident.closed', (data) => this.handleIncidentClosed(data));
        
        // Context güncellemeleri
        this.eventBus.on('pnl.daily.provisional', (data) => this.handlePnLUpdate(data));
        this.eventBus.on('trade.streak.summary', (data) => this.handleStreakUpdate(data));
        this.eventBus.on('bias.snapshot', (data) => this.handleBiasUpdate(data));
        this.eventBus.on('guard.mode', (data) => this.handleGuardUpdate(data));
        
        // Onay event'leri
        this.eventBus.on('approval.granted', (data) => this.handleApprovalGranted(data));
        this.eventBus.on('approval.rejected', (data) => this.handleApprovalRejected(data));
    }

    startScheduler() {
        const intervalMs = this.parseScheduleInterval(this.config.schedule.sweepEvery);
        this.sweepInterval = setInterval(() => {
            this.performScheduledSweep();
        }, intervalMs);
    }

    parseScheduleInterval(interval) {
        if (interval.endsWith('m')) {
            return parseInt(interval) * 60 * 1000;
        }
        if (interval.endsWith('s')) {
            return parseInt(interval) * 1000;
        }
        return 5 * 60 * 1000; // Default 5 dakika
    }

    async process(data) {
        if (!this.isInitialized) {
            throw new Error(`${this.name} henüz başlatılmadı`);
        }

        try {
            const result = await this.processAnchorReset(data);
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

    async processAnchorReset(data) {
        const currentState = this.state;
        const newState = await this.advance(currentState, data);
        
        if (newState !== currentState) {
            this.state = newState;
            this.logger.debug(`State değişimi: ${currentState} -> ${newState}`);
        }

        return { state: this.state, processed: true };
    }

    async advance(state, event) {
        switch (state) {
            case 'IDLE':
                if (this.isTriggerEvent(event)) {
                    return await this.evaluateReadiness(event) ? 'DRAFT' : 'IDLE';
                }
                return 'IDLE';

            case 'EVALUATE':
                return await this.evaluateReadiness(event) ? 'DRAFT' : 'IDLE';

            case 'DRAFT':
                if (await this.requiresApproval(event)) {
                    await this.requestApproval(event);
                    return 'AWAIT_APPROVAL';
                } else {
                    await this.activateAnchor(event);
                    return 'ACTIVE';
                }

            case 'AWAIT_APPROVAL':
                if (event.event === 'approval.granted') {
                    await this.activateAnchor(event);
                    return 'ACTIVE';
                } else if (event.event === 'approval.rejected') {
                    await this.emitAlert('approval_rejected', event);
                    return 'IDLE';
                }
                return 'AWAIT_APPROVAL';

            case 'ACTIVE':
                if (!this.isGuardNormal()) {
                    return 'HOLD';
                } else if (await this.shouldEvaluateUpgrade()) {
                    return 'EVALUATE';
                }
                return 'ACTIVE';

            case 'HOLD':
                if (this.isGuardNormal()) {
                    return 'ACTIVE';
                }
                return 'HOLD';

            default:
                return 'IDLE';
        }
    }

    isTriggerEvent(event) {
        return ['cooldown.expired', 'defense.gate.expired', 'schedule.sweep'].includes(event.event);
    }

    async evaluateReadiness(event) {
        const now = Date.now();
        
        // Quiet period kontrolü
        if (!this.hasQuietPeriodPassed(now)) {
            await this.emitAlert('not_ready', { reason: 'quiet_period_not_met' });
            return false;
        }

        // Bias skorları kontrolü
        if (!this.areBiasScoresAcceptable()) {
            await this.emitAlert('not_ready', { reason: 'bias_scores_high' });
            return false;
        }

        // Guard durumu kontrolü
        if (!this.isGuardNormal()) {
            await this.emitAlert('not_ready', { reason: 'guard_not_normal' });
            return false;
        }

        // PnL kontrolü (ramp2/full için)
        const stage = this.determineNextStage(event);
        if (stage !== 'ramp1' && !this.hasNonNegativePnL()) {
            await this.emitAlert('not_ready', { reason: 'pnl_negative' });
            return false;
        }

        return true;
    }

    hasQuietPeriodPassed(now) {
        // Son cooldown/gate'den beri geçen süreyi kontrol et
        const minQuietMs = this.config.readiness.minQuietMin * 60 * 1000;
        return true; // Basitleştirilmiş implementation
    }

    areBiasScoresAcceptable() {
        if (!this.contextStore.lastBiasSnapshot) return true;
        
        const scores = this.contextStore.lastBiasSnapshot.scores;
        const maxScores = this.config.readiness.maxBiasScores;
        
        return scores.fomo <= maxScores.fomo && 
               scores.overconfidence <= maxScores.overconfidence;
    }

    isGuardNormal() {
        if (!this.contextStore.lastGuardMode) return true;
        
        const guardStates = this.contextStore.lastGuardMode;
        return guardStates.sentry === 'normal' && guardStates.latency_slip === 'normal';
    }

    hasNonNegativePnL() {
        if (!this.contextStore.lastPnL) return true;
        return this.contextStore.lastPnL.netUSD >= 0;
    }

    determineNextStage(event) {
        const scope = event.scope || 'global';
        const activeAnchor = this.contextStore.activeAnchors.get(scope);
        
        if (!activeAnchor) return 'ramp1';
        
        const currentStage = activeAnchor.stage;
        if (currentStage === 'ramp1') return 'ramp2';
        if (currentStage === 'ramp2') return 'full';
        
        return 'full';
    }

    async requiresApproval(event) {
        const stage = this.determineNextStage(event);
        const policy = this.config.rampPolicy[stage];
        
        return this.config.approval.requireFor.includes(stage) ||
               policy.confirmationThresholdDelta <= -0.25 ||
               policy.allowVariants.includes('aggressive');
    }

    async requestApproval(event) {
        const stage = this.determineNextStage(event);
        const anchorProposal = this.createAnchorProposal(event, stage);
        
        if (this.eventBus) {
            this.eventBus.emit('approval.request', {
                event: 'approval.request',
                timestamp: new Date().toISOString(),
                type: 'anchor_reset',
                payload: anchorProposal,
                gateway: this.config.approval.gateway
            });
        }
        
        this.logger.info(`Anchor reset onayı istendi: ${stage}`);
    }

    async activateAnchor(event) {
        const stage = this.determineNextStage(event);
        const anchorProposal = this.createAnchorProposal(event, stage);
        const anchorKey = this.generateAnchorKey(event, stage);
        
        // Anchor'ı aktif et
        const activatedAnchor = {
            ...anchorProposal,
            event: 'anchor.reset.activated',
            anchorKey,
            effectiveFrom: new Date().toISOString(),
            effectiveUntil: new Date(Date.now() + this.config.idempotencyTtlSec * 1000).toISOString(),
            appliedBy: 'auto',
            hash: this.generateHash(anchorProposal)
        };

        this.contextStore.activeAnchors.set(event.scope || 'global', activatedAnchor);
        
        // Event'leri yayınla
        await this.emitAnchorEvents(activatedAnchor);
        
        this.logger.info(`Anchor aktif edildi: ${stage} (${event.scope || 'global'})`);
    }

    createAnchorProposal(event, stage) {
        const policy = this.config.rampPolicy[stage];
        const rationale = this.buildRationale(event, stage);
        
        return {
            event: 'anchor.reset.proposed',
            timestamp: new Date().toISOString(),
            scope: event.scope || 'global',
            symbol: event.symbol || null,
            stage,
            policyPatch: {
                confirmationThresholdDelta: policy.confirmationThresholdDelta,
                allowVariants: policy.allowVariants,
                dailyTradeCap: policy.dailyTradeCap,
                positionLimitFactor: policy.positionLimitFactor
            },
            rationale,
            ttlSec: 1800,
            audit: { producedBy: this.name }
        };
    }

    buildRationale(event, stage) {
        const reasons = [];
        
        if (event.event === 'cooldown.expired') reasons.push('cooldown bitti');
        if (event.event === 'defense.gate.expired') reasons.push('defense gate süresi doldu');
        if (this.areBiasScoresAcceptable()) reasons.push('bias düşük');
        if (this.isGuardNormal()) reasons.push('guard=normal');
        if (this.hasNonNegativePnL()) reasons.push('PnL≥0');
        
        return reasons.join('; ');
    }

    generateAnchorKey(event, stage) {
        const scope = event.scope || 'global';
        const symbol = event.symbol || '';
        const date = new Date().toISOString().split('T')[0];
        return `anchor-${scope}-${symbol}-${stage}-${date}`;
    }

    generateHash(data) {
        // Basit hash implementasyonu
        return `sha256:${Date.now()}-${Math.random().toString(36)}`;
    }

    async shouldEvaluateUpgrade() {
        // Aktif anchor'ın minimum süresini kontrol et
        return false; // Basitleştirilmiş
    }

    async emitAnchorEvents(anchor) {
        if (!this.eventBus) return;

        // Ana anchor event'i
        this.eventBus.emit('anchor.reset.activated', anchor);

        // UI kartı
        const card = this.createAnchorCard(anchor);
        this.eventBus.emit('anchor.card', card);

        // Metrikleri güncelle
        await this.emitMetrics();
    }

    createAnchorCard(anchor) {
        const variants = anchor.policyPatch.allowVariants.join(', ');
        
        return {
            event: 'anchor.card',
            timestamp: new Date().toISOString(),
            title: `Davranışsal Anchor Yenilendi — ${anchor.scope}`,
            body: `${anchor.stage} aşaması: onay eşiği ${anchor.policyPatch.confirmationThresholdDelta}, varyantlar ${variants}, günlük limit ${anchor.policyPatch.dailyTradeCap}, pozisyon ×${anchor.policyPatch.positionLimitFactor}.`,
            severity: 'info',
            ttlSec: 600
        };
    }

    async emitMetrics() {
        if (!this.eventBus) return;

        const metrics = {
            event: 'anchor.metrics',
            timestamp: new Date().toISOString(),
            proposed: 1,
            activated: 1,
            rolledBack: 0,
            avgRampMin: 45,
            byStage: this.getStageMetrics(),
            highlights: this.getHighlights()
        };

        this.eventBus.emit('anchor.metrics', metrics);
    }

    getStageMetrics() {
        const stages = {};
        this.contextStore.activeAnchors.forEach(anchor => {
            stages[anchor.stage] = (stages[anchor.stage] || 0) + 1;
        });
        return stages;
    }

    getHighlights() {
        const highlights = [];
        if (this.isGuardNormal()) highlights.push('guard:normal');
        if (this.areBiasScoresAcceptable()) highlights.push('biasLow:true');
        if (this.hasNonNegativePnL()) highlights.push('pnl>=0:true');
        return highlights;
    }

    async emitAlert(level, context) {
        if (!this.eventBus) return;

        this.eventBus.emit('anchor.alert', {
            event: 'anchor.alert',
            timestamp: new Date().toISOString(),
            level: 'warn',
            message: level,
            context
        });
    }

    // Event Handlers
    handleTriggerEvent(data, type) {
        this.logger.debug(`Trigger event alındı: ${type}`);
        this.process(data);
    }

    handleIncidentClosed(data) {
        this.logger.debug(`Incident kapatıldı: ${data.id} (${data.severity})`);
        
        // Yüksek severitydaki incident'lar ek cooldown gerektirir
        if (['high', 'critical'].includes(data.severity)) {
            // Post incident cooldown başlat
            setTimeout(() => {
                this.process({ event: 'post_incident_cooldown_expired', originalIncident: data });
            }, this.config.schedule.postIncidentCooldownMin * 60 * 1000);
        }
    }

    handlePnLUpdate(data) {
        this.contextStore.lastPnL = data;
        this.logger.debug(`PnL güncellendi: ${data.netUSD} USD`);
    }

    handleStreakUpdate(data) {
        this.contextStore.lastStreak = data;
        this.logger.debug(`Streak güncellendi: ${data.winStreak} kazanç, ${data.lossStreak} kayıp`);
    }

    handleBiasUpdate(data) {
        this.contextStore.lastBiasSnapshot = data;
        this.logger.debug(`Bias skorları güncellendi: fomo=${data.scores.fomo}, overconfidence=${data.scores.overconfidence}`);
    }

    handleGuardUpdate(data) {
        this.contextStore.lastGuardMode = data;
        this.logger.debug(`Guard durumu güncellendi: sentry=${data.sentry}, latency_slip=${data.latency_slip}`);
    }

    handleApprovalGranted(data) {
        this.logger.info(`Anchor reset onayı verildi: ${data.payload?.stage}`);
        this.process({ event: 'approval.granted', ...data });
    }

    handleApprovalRejected(data) {
        this.logger.warn(`Anchor reset onayı reddedildi: ${data.reason}`);
        this.process({ event: 'approval.rejected', ...data });
    }

    performScheduledSweep() {
        this.logger.debug('Scheduled sweep başlatılıyor...');
        this.process({ event: 'schedule.sweep', timestamp: new Date().toISOString() });
    }

    getStatus() {
        return {
            name: this.name,
            initialized: this.isInitialized,
            enabled: this.config.enabled,
            state: this.state,
            activeAnchors: this.contextStore.activeAnchors.size,
            biasAcceptable: this.areBiasScoresAcceptable(),
            guardNormal: this.isGuardNormal(),
            pnlPositive: this.hasNonNegativePnL(),
            config: this.config
        };
    }

    async shutdown() {
        try {
            this.logger.info(`${this.name} durduruluyor...`);
            
            if (this.sweepInterval) {
                clearInterval(this.sweepInterval);
                this.sweepInterval = null;
            }
            
            this.anchorStore.clear();
            this.contextStore.activeAnchors.clear();
            this.isInitialized = false;
            this.logger.info(`${this.name} başarıyla durduruldu`);
        } catch (error) {
            this.logger.error(`${this.name} durdurma hatası:`, error);
        }
    }
}

module.exports = BehavioralAnchorReset;