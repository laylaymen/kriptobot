/**
 * LIVIA-19: Emotional Recovery Monitor
 * Savunma dönemi sonrası psikolojik toparlanma durumunu ölçen sistem
 */

const { z } = require('zod');
const EventEmitter = require('events');

// Input schemas
const CooldownExpiredSchema = z.object({
    event: z.literal('cooldown.expired'),
    timestamp: z.string(),
    cooldownKey: z.string(),
    scope: z.enum(['global', 'desk', 'symbol']),
    symbol: z.string().nullable(),
    reasonCode: z.enum(['overtrading', 'overconfidence', 'panic_mode'])
}).strict();

const DefenseGateExpiredSchema = z.object({
    event: z.literal('defense.gate.expired'),
    timestamp: z.string(),
    gateKey: z.string(),
    scope: z.enum(['global', 'desk', 'symbol']),
    symbol: z.string().nullable(),
    trigger: z.enum(['fomo', 'revenge', 'overconfidence', 'panic', 'guard_escalation'])
}).strict();

const BiasSnapshotSchema = z.object({
    event: z.literal('bias.snapshot'),
    timestamp: z.string(),
    scores: z.object({
        fomo: z.number().min(0).max(1),
        overconfidence: z.number().min(0).max(1),
        loss_aversion: z.number().min(0).max(1)
    })
}).strict();

const BiasTrendSchema = z.object({
    event: z.literal('bias.trend'),
    timestamp: z.string(),
    windowMin: z.number(),
    delta: z.object({
        fomo: z.number(),
        overconfidence: z.number(),
        loss_aversion: z.number()
    })
}).strict();

const GuardModeSchema = z.object({
    event: z.literal('guard.mode'),
    timestamp: z.string(),
    sentry: z.enum(['normal', 'degraded', 'streams_panic', 'halt_entry']),
    latency_slip: z.enum(['normal', 'slowdown', 'block_aggressive', 'halt_entry'])
}).strict();

// Output schemas
const RecoveryScoreUpdatedSchema = z.object({
    event: z.literal('recovery.score.updated'),
    timestamp: z.string(),
    scope: z.enum(['global', 'desk', 'symbol']),
    symbol: z.string().nullable(),
    windowMin: z.number(),
    recoveryIndex: z.number().min(0).max(1),
    factors: z.object({
        biasTrend: z.number().min(0).max(1),
        guardOk: z.number().min(0).max(1),
        sloOk: z.number().min(0).max(1),
        pnlWindow: z.number().min(0).max(1),
        streak: z.number().min(0).max(1),
        dialogQuality: z.number().min(0).max(1)
    }),
    audit: z.object({
        producedBy: z.literal('LIVIA-19'),
        version: z.string()
    })
}).strict();

class EmotionalRecoveryMonitor extends EventEmitter {
    constructor(eventBus, logger, config = {}) {
        super();
        this.eventBus = eventBus;
        this.logger = logger;
        this.name = 'EmotionalRecoveryMonitor';
        
        this.config = {
            window: {
                evaluateEvery: 5 * 60 * 1000, // 5 dakika
                windowMin: 120,
                minQuietAfterDefenseMin: 10
            },
            weights: {
                biasTrend: 0.30,
                guardOk: 0.15,
                sloOk: 0.10,
                pnlWindow: 0.20,
                streak: 0.15,
                dialogQuality: 0.10
            },
            thresholds: {
                ready: 0.70,
                hold: 0.55,
                hysteresis: 0.05
            },
            mapping: {
                indexToStage: [
                    { gte: 0.70, lt: 0.80, stage: 'ramp1' },
                    { gte: 0.80, lt: 0.90, stage: 'ramp2' },
                    { gte: 0.90, lt: 1.01, stage: 'full' }
                ]
            },
            ...config
        };

        this.state = {
            status: 'IDLE',
            recentEvents: new Map(),
            lastQuietTime: null,
            lastRecoveryIndex: null,
            lastDecision: null,
            emaRecoveryIndex: null
        };

        this.isInitialized = false;
        this.scheduleTimer = null;
    }

    async initialize() {
        try {
            this.logger.info(`${this.name} başlatılıyor...`);
            
            // Event listeners
            this.eventBus.on('cooldown.expired', this.handleCooldownExpired.bind(this));
            this.eventBus.on('defense.gate.expired', this.handleDefenseGateExpired.bind(this));
            this.eventBus.on('bias.snapshot', this.handleBiasSnapshot.bind(this));
            this.eventBus.on('bias.trend', this.handleBiasTrend.bind(this));
            this.eventBus.on('guard.mode', this.handleGuardMode.bind(this));
            this.eventBus.on('pnl.window', this.handlePnlWindow.bind(this));
            this.eventBus.on('trade.streak.summary', this.handleStreakSummary.bind(this));
            this.eventBus.on('dialog.metrics', this.handleDialogMetrics.bind(this));
            this.eventBus.on('telemetry.slo.status', this.handleSloStatus.bind(this));

            // Periyodik değerlendirme başlat
            this.startScheduler();
            
            this.isInitialized = true;
            this.logger.info(`${this.name} başarıyla başlatıldı`);
            return true;
        } catch (error) {
            this.logger.error(`${this.name} başlatma hatası:`, error);
            return false;
        }
    }

    startScheduler() {
        if (this.scheduleTimer) {
            clearInterval(this.scheduleTimer);
        }
        
        this.scheduleTimer = setInterval(() => {
            this.evaluate();
        }, this.config.window.evaluateEvery);
    }

    handleCooldownExpired(data) {
        try {
            const validated = CooldownExpiredSchema.parse(data);
            this.storeEvent('cooldown.expired', validated);
            this.state.lastQuietTime = new Date(validated.timestamp);
            this.logger.info(`Cooldown expired: ${validated.scope}/${validated.symbol}`);
            
            // Hemen değerlendirme tetikle
            setTimeout(() => this.evaluate(), 1000);
        } catch (error) {
            this.logger.error('Cooldown expired validation error:', error);
        }
    }

    handleDefenseGateExpired(data) {
        try {
            const validated = DefenseGateExpiredSchema.parse(data);
            this.storeEvent('defense.gate.expired', validated);
            this.state.lastQuietTime = new Date(validated.timestamp);
            this.logger.info(`Defense gate expired: ${validated.scope}/${validated.symbol}`);
            
            // Hemen değerlendirme tetikle
            setTimeout(() => this.evaluate(), 1000);
        } catch (error) {
            this.logger.error('Defense gate expired validation error:', error);
        }
    }

    handleBiasSnapshot(data) {
        try {
            const validated = BiasSnapshotSchema.parse(data);
            this.storeEvent('bias.snapshot', validated);
        } catch (error) {
            this.logger.error('Bias snapshot validation error:', error);
        }
    }

    handleBiasTrend(data) {
        try {
            const validated = BiasTrendSchema.parse(data);
            this.storeEvent('bias.trend', validated);
        } catch (error) {
            this.logger.error('Bias trend validation error:', error);
        }
    }

    handleGuardMode(data) {
        try {
            const validated = GuardModeSchema.parse(data);
            this.storeEvent('guard.mode', validated);
        } catch (error) {
            this.logger.error('Guard mode validation error:', error);
        }
    }

    handlePnlWindow(data) {
        this.storeEvent('pnl.window', data);
    }

    handleStreakSummary(data) {
        this.storeEvent('trade.streak.summary', data);
    }

    handleDialogMetrics(data) {
        this.storeEvent('dialog.metrics', data);
    }

    handleSloStatus(data) {
        this.storeEvent('telemetry.slo.status', data);
    }

    storeEvent(type, data) {
        const now = Date.now();
        const windowMs = this.config.window.windowMin * 60 * 1000;
        
        if (!this.state.recentEvents.has(type)) {
            this.state.recentEvents.set(type, []);
        }
        
        const events = this.state.recentEvents.get(type);
        events.push({ ...data, storedAt: now });
        
        // Eski eventleri temizle
        const cutoff = now - windowMs;
        this.state.recentEvents.set(type, events.filter(e => e.storedAt > cutoff));
    }

    async evaluate() {
        if (!this.isInitialized) return;

        try {
            this.state.status = 'EVALUATE';
            
            // Sessizlik kontrolü
            if (!this.isQuietPeriodSatisfied()) {
                this.emitAlert('info', 'quiet_period_not_satisfied');
                this.state.status = 'IDLE';
                return;
            }

            const factors = this.calculateFactors();
            const recoveryIndex = this.calculateRecoveryIndex(factors);
            
            // EMA ve histerezis uygula
            const smoothedIndex = this.applyHysteresis(recoveryIndex);
            
            this.state.lastRecoveryIndex = smoothedIndex;
            
            // Score güncelleme eventi emit et
            this.emitRecoveryScoreUpdated(factors, smoothedIndex);
            
            // Karar ver
            const decision = this.makeDecision(smoothedIndex);
            this.state.lastDecision = decision;
            
            if (decision === 'ready') {
                this.emitRecoveryReady(smoothedIndex);
            } else if (decision === 'hold') {
                this.emitRecoveryHold(smoothedIndex);
            }
            
            this.emitMetrics();
            this.state.status = 'IDLE';
            
        } catch (error) {
            this.logger.error('Recovery evaluation error:', error);
            this.emitAlert('error', 'evaluation_failed');
            this.state.status = 'IDLE';
        }
    }

    isQuietPeriodSatisfied() {
        if (!this.state.lastQuietTime) return true;
        
        const now = new Date();
        const quietMs = this.config.window.minQuietAfterDefenseMin * 60 * 1000;
        return (now - this.state.lastQuietTime) >= quietMs;
    }

    calculateFactors() {
        const factors = {
            biasTrend: this.calculateBiasTrend(),
            guardOk: this.calculateGuardOk(),
            sloOk: this.calculateSloOk(),
            pnlWindow: this.calculatePnlWindow(),
            streak: this.calculateStreak(),
            dialogQuality: this.calculateDialogQuality()
        };

        return factors;
    }

    calculateBiasTrend() {
        const trends = this.state.recentEvents.get('bias.trend') || [];
        if (trends.length === 0) return 0.5; // Neutral default
        
        const latest = trends[trends.length - 1];
        const avgDelta = (latest.delta.fomo + latest.delta.overconfidence + latest.delta.loss_aversion) / 3;
        
        // Negatif delta iyidir (bias azalması)
        return Math.max(0, Math.min(1, (-avgDelta + 0.2) / 0.4));
    }

    calculateGuardOk() {
        const guardEvents = this.state.recentEvents.get('guard.mode') || [];
        if (guardEvents.length === 0) return 0.5;
        
        const latest = guardEvents[guardEvents.length - 1];
        if (latest.sentry === 'normal' && latest.latency_slip === 'normal') {
            return 1.0;
        } else if (latest.sentry === 'degraded') {
            return 0.5;
        } else {
            return 0.0;
        }
    }

    calculateSloOk() {
        const sloEvents = this.state.recentEvents.get('telemetry.slo.status') || [];
        if (sloEvents.length === 0) return 0.5;
        
        const worst = sloEvents.reduce((acc, event) => {
            if (event.state === 'breach') return 'breach';
            if (event.state === 'at_risk' && acc !== 'breach') return 'at_risk';
            return acc;
        }, 'ok');
        
        switch (worst) {
            case 'ok': return 1.0;
            case 'at_risk': return 0.5;
            case 'breach': return 0.0;
            default: return 0.5;
        }
    }

    calculatePnlWindow() {
        const pnlEvents = this.state.recentEvents.get('pnl.window') || [];
        if (pnlEvents.length === 0) return 0.5;
        
        const latest = pnlEvents[pnlEvents.length - 1];
        const targetUSD = 1000; // Hedef PnL
        
        const netScore = this.sigmoid(latest.netUSD / targetUSD);
        const rrScore = Math.min(1, latest.rrMedian / 1.5);
        
        return Math.max(0, Math.min(1, 0.5 * netScore + 0.5 * rrScore));
    }

    calculateStreak() {
        const streakEvents = this.state.recentEvents.get('trade.streak.summary') || [];
        if (streakEvents.length === 0) return 0.5;
        
        const latest = streakEvents[streakEvents.length - 1];
        return Math.max(0, Math.min(1, (latest.winStreak - latest.lossStreak + 1) / 3));
    }

    calculateDialogQuality() {
        const dialogEvents = this.state.recentEvents.get('dialog.metrics') || [];
        if (dialogEvents.length === 0) return 0.5;
        
        const latest = dialogEvents[dialogEvents.length - 1];
        const acceptScore = latest.acceptRate || 0.5;
        const speedScore = Math.max(0, 1 - (latest.p95AnswerMs - 900) / 900);
        
        return Math.max(0, Math.min(1, 0.6 * acceptScore + 0.4 * speedScore));
    }

    calculateRecoveryIndex(factors) {
        const weights = this.config.weights;
        return (
            factors.biasTrend * weights.biasTrend +
            factors.guardOk * weights.guardOk +
            factors.sloOk * weights.sloOk +
            factors.pnlWindow * weights.pnlWindow +
            factors.streak * weights.streak +
            factors.dialogQuality * weights.dialogQuality
        );
    }

    applyHysteresis(currentIndex) {
        const alpha = 0.4; // EMA factor
        
        if (this.state.emaRecoveryIndex === null) {
            this.state.emaRecoveryIndex = currentIndex;
        } else {
            this.state.emaRecoveryIndex = alpha * currentIndex + (1 - alpha) * this.state.emaRecoveryIndex;
        }
        
        return this.state.emaRecoveryIndex;
    }

    makeDecision(recoveryIndex) {
        const thresholds = this.config.thresholds;
        const lastDecision = this.state.lastDecision;
        
        // Histerezis uygula
        if (lastDecision === 'hold' && recoveryIndex >= thresholds.ready + thresholds.hysteresis) {
            return 'ready';
        } else if (lastDecision === 'ready' && recoveryIndex < thresholds.ready - thresholds.hysteresis) {
            return 'hold';
        } else if (lastDecision === null) {
            return recoveryIndex >= thresholds.ready ? 'ready' : 'hold';
        }
        
        return lastDecision;
    }

    getSuggestedStage(recoveryIndex) {
        const mapping = this.config.mapping.indexToStage;
        for (const range of mapping) {
            if (recoveryIndex >= range.gte && recoveryIndex < range.lt) {
                return range.stage;
            }
        }
        return 'ramp1'; // Fallback
    }

    sigmoid(x) {
        return 1 / (1 + Math.exp(-x));
    }

    emitRecoveryScoreUpdated(factors, recoveryIndex) {
        const event = {
            event: 'recovery.score.updated',
            timestamp: new Date().toISOString(),
            scope: 'global',
            symbol: null,
            windowMin: this.config.window.windowMin,
            recoveryIndex,
            factors,
            audit: {
                producedBy: 'LIVIA-19',
                version: 'v1'
            }
        };

        this.eventBus.emit('recovery.score.updated', event);
        this.logger.info(`Recovery score updated: ${recoveryIndex.toFixed(3)}`);
    }

    emitRecoveryReady(recoveryIndex) {
        const stage = this.getSuggestedStage(recoveryIndex);
        const event = {
            event: 'recovery.ready',
            timestamp: new Date().toISOString(),
            scope: 'global',
            symbol: null,
            recoveryIndex,
            suggestedStage: stage,
            minHoldMin: 30
        };

        this.eventBus.emit('recovery.ready', event);
        this.logger.info(`Recovery ready: ${stage} (index: ${recoveryIndex.toFixed(3)})`);
        
        // Card emit
        this.emitCard(`Toparlanma Endeksi: ${recoveryIndex.toFixed(2)} — Hazır`, 
                     `Bias↓, guard=normal, öneri: ${stage} (min 30dk).`, 'info');
    }

    emitRecoveryHold(recoveryIndex) {
        const reasonCodes = this.getHoldReasons();
        const event = {
            event: 'recovery.hold',
            timestamp: new Date().toISOString(),
            scope: 'global',
            symbol: null,
            recoveryIndex,
            reasonCodes
        };

        this.eventBus.emit('recovery.hold', event);
        this.logger.info(`Recovery hold: ${reasonCodes.join(', ')} (index: ${recoveryIndex.toFixed(3)})`);
        
        // Düşük recovery için cooldown extension öner
        if (recoveryIndex < 0.5) {
            this.emitCooldownExtensionSuggestion();
        }
        
        // Card emit
        this.emitCard(`Toparlanma Endeksi: ${recoveryIndex.toFixed(2)} — Bekle`, 
                     `Nedenler: ${reasonCodes.join(', ')}. Normalleşme bekleniyor.`, 'warn');
    }

    getHoldReasons() {
        const reasons = [];
        const factors = this.calculateFactors();
        
        if (factors.biasTrend < 0.5) reasons.push('bias_high');
        if (factors.guardOk < 1.0) reasons.push('guard_not_normal');
        if (factors.pnlWindow < 0.5) reasons.push('pnl_nonpos');
        if (factors.streak < 0.4) reasons.push('weak_streak');
        
        return reasons.length > 0 ? reasons : ['recovery_low'];
    }

    emitCooldownExtensionSuggestion() {
        const event = {
            event: 'cooldown.extend.suggest',
            timestamp: new Date().toISOString(),
            scope: 'global',
            symbol: null,
            reason: 'recovery_low',
            proposed: {
                durationMin: 15,
                signalRateMaxPer10m: 0
            }
        };

        this.eventBus.emit('cooldown.extend.suggest', event);
        this.logger.info('Cooldown extension suggested due to low recovery');
    }

    emitCard(title, body, severity) {
        const event = {
            event: 'recovery.card',
            timestamp: new Date().toISOString(),
            title,
            body,
            severity,
            ttlSec: 600
        };

        this.eventBus.emit('recovery.card', event);
    }

    emitAlert(level, message) {
        const event = {
            event: 'recovery.alert',
            timestamp: new Date().toISOString(),
            level,
            message
        };

        this.eventBus.emit('recovery.alert', event);
        this.logger.warn(`Recovery alert: ${level} - ${message}`);
    }

    emitMetrics() {
        const event = {
            event: 'recovery.metrics',
            timestamp: new Date().toISOString(),
            evaluations: 1,
            readySignals: this.state.lastDecision === 'ready' ? 1 : 0,
            holds: this.state.lastDecision === 'hold' ? 1 : 0,
            avgEvalMs: 8.0,
            missingInputsRate: this.calculateMissingInputsRate()
        };

        this.eventBus.emit('recovery.metrics', event);
    }

    calculateMissingInputsRate() {
        const expectedTypes = ['bias.trend', 'guard.mode', 'pnl.window', 'trade.streak.summary'];
        const presentTypes = expectedTypes.filter(type => 
            this.state.recentEvents.has(type) && this.state.recentEvents.get(type).length > 0
        );
        
        return 1 - (presentTypes.length / expectedTypes.length);
    }

    getStatus() {
        return {
            name: this.name,
            initialized: this.isInitialized,
            status: this.state.status,
            lastRecoveryIndex: this.state.lastRecoveryIndex,
            lastDecision: this.state.lastDecision,
            recentEventsCounts: Object.fromEntries(
                Array.from(this.state.recentEvents.entries()).map(([type, events]) => [type, events.length])
            )
        };
    }

    async shutdown() {
        try {
            this.logger.info(`${this.name} durduruluyor...`);
            
            if (this.scheduleTimer) {
                clearInterval(this.scheduleTimer);
                this.scheduleTimer = null;
            }
            
            this.isInitialized = false;
            this.logger.info(`${this.name} başarıyla durduruldu`);
        } catch (error) {
            this.logger.error(`${this.name} durdurma hatası:`, error);
        }
    }
}

module.exports = EmotionalRecoveryMonitor;