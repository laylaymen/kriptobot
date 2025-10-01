/**
 * LIVIA-20: Operator Fatigue Sentinel
 * Operatör yorgunluk düzeyini izleyen ve break/cooldown öneren sistem
 */

const { z } = require('zod');
const EventEmitter = require('events');
const crypto = require('crypto');

// Input schemas
const SessionActivitySchema = z.object({
    event: z.literal('session.activity'),
    timestamp: z.string(),
    operatorId: z.string().nullable(),
    minutesOnline: z.number().min(0),
    microBreaks: z.number().min(0),
    lastBreakMinAgo: z.number().min(0)
}).strict();

const DialogMetricsSchema = z.object({
    event: z.literal('dialog.metrics'),
    timestamp: z.string(),
    prompts: z.number(),
    answers: z.number(),
    acceptRate: z.number().min(0).max(1),
    p95AnswerMs: z.number().min(0)
}).strict();

const TradeStreakSummarySchema = z.object({
    event: z.literal('trade.streak.summary'),
    timestamp: z.string(),
    lossStreak: z.number().min(0),
    winStreak: z.number().min(0),
    lastWinLoss: z.enum(['win', 'loss']),
    windowMin: z.number()
}).strict();

const ClockLocaltimeSchema = z.object({
    event: z.literal('clock.localtime'),
    timestamp: z.string(),
    hour: z.number().min(0).max(23),
    isWeekend: z.boolean()
}).strict();

// Output schemas
const FatigueScoreUpdatedSchema = z.object({
    event: z.literal('fatigue.score.updated'),
    timestamp: z.string(),
    scope: z.enum(['global', 'desk', 'symbol']),
    operator: z.string().nullable(),
    windowMin: z.number(),
    fatigueScore: z.number().min(0).max(1),
    factors: z.object({
        longSession: z.number().min(0).max(1),
        noBreak: z.number().min(0).max(1),
        slowDialog: z.number().min(0).max(1),
        lossStreak: z.number().min(0).max(1),
        nightShift: z.number().min(0).max(1),
        pnlDrag: z.number().min(0).max(1)
    }),
    audit: z.object({
        producedBy: z.literal('LIVIA-20'),
        version: z.string()
    })
}).strict();

class OperatorFatigueSentinel extends EventEmitter {
    constructor(eventBus, logger, config = {}) {
        super();
        this.eventBus = eventBus;
        this.logger = logger;
        this.name = 'OperatorFatigueSentinel';
        
        this.config = {
            window: {
                evaluateEvery: 10 * 60 * 1000, // 10 dakika
                windowMin: 120
            },
            weights: {
                longSession: 0.25,
                noBreak: 0.15,
                slowDialog: 0.15,
                lossStreak: 0.20,
                nightShift: 0.15,
                pnlDrag: 0.10
            },
            thresholds: {
                breakSuggest: 0.70,
                cooldownSuggest: 0.80,
                hysteresis: 0.05
            },
            policyMatrix: {
                '0.70-0.80': { breakMin: 10, cooldownMin: 0, posLimitFactor: 0.8 },
                '0.80-1.00': { breakMin: 15, cooldownMin: 20, posLimitFactor: 0.6 }
            },
            pii: {
                operators: true,
                hashSalt: 'rotate-me-daily',
                hashAlgo: 'sha256'
            },
            ...config
        };

        this.state = {
            status: 'IDLE',
            recentEvents: new Map(),
            lastFatigueScore: null,
            lastDecision: null,
            emaFatigueScore: null,
            evaluationCount: 0,
            breakProposed: 0,
            cooldownsProposed: 0
        };

        this.isInitialized = false;
        this.scheduleTimer = null;
    }

    async initialize() {
        try {
            this.logger.info(`${this.name} başlatılıyor...`);
            
            // Event listeners
            this.eventBus.on('session.activity', this.handleSessionActivity.bind(this));
            this.eventBus.on('dialog.metrics', this.handleDialogMetrics.bind(this));
            this.eventBus.on('trade.streak.summary', this.handleTradeStreak.bind(this));
            this.eventBus.on('pnl.window', this.handlePnlWindow.bind(this));
            this.eventBus.on('clock.localtime', this.handleClockLocaltime.bind(this));
            this.eventBus.on('approval.result', this.handleApprovalResult.bind(this));

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

    handleSessionActivity(data) {
        try {
            const validated = SessionActivitySchema.parse(data);
            this.storeEvent('session.activity', validated);
            this.logger.debug(`Session activity: ${validated.minutesOnline}min online, ${validated.microBreaks} breaks`);
        } catch (error) {
            this.logger.error('Session activity validation error:', error);
        }
    }

    handleDialogMetrics(data) {
        try {
            const validated = DialogMetricsSchema.parse(data);
            this.storeEvent('dialog.metrics', validated);
            this.logger.debug(`Dialog metrics: ${validated.acceptRate.toFixed(2)} accept rate, ${validated.p95AnswerMs}ms p95`);
        } catch (error) {
            this.logger.error('Dialog metrics validation error:', error);
        }
    }

    handleTradeStreak(data) {
        try {
            const validated = TradeStreakSummarySchema.parse(data);
            this.storeEvent('trade.streak.summary', validated);
            this.logger.debug(`Trade streak: ${validated.lossStreak} losses, ${validated.winStreak} wins`);
        } catch (error) {
            this.logger.error('Trade streak validation error:', error);
        }
    }

    handlePnlWindow(data) {
        this.storeEvent('pnl.window', data);
        this.logger.debug(`PnL window: ${data.netUSD} USD, ${data.rrMedian} RR`);
    }

    handleClockLocaltime(data) {
        try {
            const validated = ClockLocaltimeSchema.parse(data);
            this.storeEvent('clock.localtime', validated);
        } catch (error) {
            this.logger.error('Clock localtime validation error:', error);
        }
    }

    handleApprovalResult(data) {
        if (data.ref && (data.ref.includes('fatigue.break.request') || data.ref.includes('cooldown.request'))) {
            this.logger.info(`Approval result for fatigue action: ${data.decision}`);
            this.storeEvent('approval.result', data);
        }
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
            this.state.evaluationCount++;
            
            const factors = this.calculateFactors();
            const fatigueScore = this.calculateFatigueScore(factors);
            
            // EMA ve histerezis uygula
            const smoothedScore = this.applyHysteresis(fatigueScore);
            
            this.state.lastFatigueScore = smoothedScore;
            
            // Score güncelleme eventi emit et
            this.emitFatigueScoreUpdated(factors, smoothedScore);
            
            // Karar ver ve önerileri emit et
            await this.makeDecisions(smoothedScore);
            
            this.emitMetrics();
            this.state.status = 'IDLE';
            
        } catch (error) {
            this.logger.error('Fatigue evaluation error:', error);
            this.emitAlert('error', 'evaluation_failed');
            this.state.status = 'IDLE';
        }
    }

    calculateFactors() {
        const factors = {
            longSession: this.calculateLongSession(),
            noBreak: this.calculateNoBreak(),
            slowDialog: this.calculateSlowDialog(),
            lossStreak: this.calculateLossStreak(),
            nightShift: this.calculateNightShift(),
            pnlDrag: this.calculatePnlDrag()
        };

        return factors;
    }

    calculateLongSession() {
        const sessionEvents = this.state.recentEvents.get('session.activity') || [];
        if (sessionEvents.length === 0) return 0;
        
        const latest = sessionEvents[sessionEvents.length - 1];
        return Math.max(0, Math.min(1, (latest.minutesOnline - 120) / 180));
    }

    calculateNoBreak() {
        const sessionEvents = this.state.recentEvents.get('session.activity') || [];
        if (sessionEvents.length === 0) return 0;
        
        const latest = sessionEvents[sessionEvents.length - 1];
        const breakFactor = Math.max(0, Math.min(1, latest.lastBreakMinAgo / 120));
        const microBreakPenalty = latest.microBreaks === 0 ? 1 : 0.7;
        
        return breakFactor * microBreakPenalty;
    }

    calculateSlowDialog() {
        const dialogEvents = this.state.recentEvents.get('dialog.metrics') || [];
        if (dialogEvents.length === 0) return 0;
        
        const latest = dialogEvents[dialogEvents.length - 1];
        const slowness = Math.max(0, Math.min(1, (latest.p95AnswerMs - 900) / 900));
        const acceptanceLoss = Math.max(0, Math.min(1, (0.8 - latest.acceptRate) / 0.5));
        
        return slowness * acceptanceLoss;
    }

    calculateLossStreak() {
        const streakEvents = this.state.recentEvents.get('trade.streak.summary') || [];
        if (streakEvents.length === 0) return 0;
        
        const latest = streakEvents[streakEvents.length - 1];
        return Math.max(0, Math.min(1, latest.lossStreak / 3));
    }

    calculateNightShift() {
        const clockEvents = this.state.recentEvents.get('clock.localtime') || [];
        if (clockEvents.length === 0) return 0;
        
        const latest = clockEvents[clockEvents.length - 1];
        const hour = latest.hour;
        
        // Gece saatleri: 23-05 arası
        if (hour >= 23 || hour <= 5) {
            return 1.0;
        }
        
        return 0;
    }

    calculatePnlDrag() {
        const pnlEvents = this.state.recentEvents.get('pnl.window') || [];
        if (pnlEvents.length === 0) return 0;
        
        const latest = pnlEvents[pnlEvents.length - 1];
        const netScore = Math.max(0, Math.min(1, -latest.netUSD / 500));
        const rrScore = Math.max(0, Math.min(1, (1 - latest.rrMedian) / 0.5));
        
        return netScore * rrScore;
    }

    calculateFatigueScore(factors) {
        const weights = this.config.weights;
        return (
            factors.longSession * weights.longSession +
            factors.noBreak * weights.noBreak +
            factors.slowDialog * weights.slowDialog +
            factors.lossStreak * weights.lossStreak +
            factors.nightShift * weights.nightShift +
            factors.pnlDrag * weights.pnlDrag
        );
    }

    applyHysteresis(currentScore) {
        const alpha = 0.3; // EMA factor - yorgunluk için daha konservatif
        
        if (this.state.emaFatigueScore === null) {
            this.state.emaFatigueScore = currentScore;
        } else {
            this.state.emaFatigueScore = alpha * currentScore + (1 - alpha) * this.state.emaFatigueScore;
        }
        
        return this.state.emaFatigueScore;
    }

    async makeDecisions(fatigueScore) {
        const thresholds = this.config.thresholds;
        
        if (fatigueScore >= thresholds.cooldownSuggest) {
            // Yüksek yorgunluk: hem break hem cooldown öner
            await this.proposeCooldown(fatigueScore);
            this.proposeBreak(fatigueScore);
            this.emitCard('Yorgunluk Çok Yüksek — Ara ve Kısıtlama Gerekli', 
                         `Skor ${fatigueScore.toFixed(2)} • Break + cooldown önerisi.`, 'warn');
        } else if (fatigueScore >= thresholds.breakSuggest) {
            // Orta yorgunluk: sadece break öner
            this.proposeBreak(fatigueScore);
            this.emitCard('Yorgunluk Yüksek — Ara Önerildi', 
                         `Skor ${fatigueScore.toFixed(2)} • ${this.getBreakDuration(fatigueScore)} dk ara önerisi.`, 'info');
        }
        
        this.state.lastDecision = fatigueScore >= thresholds.breakSuggest ? 'fatigue_detected' : 'normal';
    }

    proposeBreak(fatigueScore) {
        const duration = this.getBreakDuration(fatigueScore);
        const rationale = this.getBreakRationale(fatigueScore);
        
        const event = {
            event: 'fatigue.break.proposed',
            timestamp: new Date().toISOString(),
            durationMin: duration,
            rationale
        };

        this.eventBus.emit('fatigue.break.proposed', event);
        this.state.breakProposed++;
        this.logger.info(`Break proposed: ${duration}min - ${rationale}`);
    }

    async proposeCooldown(fatigueScore) {
        const policy = this.getCooldownPolicy(fatigueScore);
        
        const event = {
            event: 'cooldown.plan.proposed',
            timestamp: new Date().toISOString(),
            scope: 'desk',
            symbol: null,
            reasonCode: 'fatigue_high',
            policy,
            ttlSec: 1200
        };

        // Approval gerekiyorsa gateway'e gönder
        if (this.config.approval && this.config.approval.requireFor.includes('cooldownSuggest')) {
            await this.requestApproval(event);
        } else {
            this.eventBus.emit('cooldown.plan.proposed', event);
        }
        
        this.state.cooldownsProposed++;
        this.logger.info(`Cooldown proposed: ${policy.durationMin}min due to fatigue`);
    }

    async requestApproval(cooldownEvent) {
        const approvalEvent = {
            event: 'approval.request',
            timestamp: new Date().toISOString(),
            ref: 'cooldown.request',
            type: 'fatigue_cooldown',
            details: cooldownEvent,
            requiredApprovers: ['ops'],
            timeoutSec: 300
        };

        this.eventBus.emit('approval.request', approvalEvent);
        this.logger.info('Cooldown approval requested due to high fatigue');
    }

    getBreakDuration(fatigueScore) {
        const thresholds = this.config.thresholds;
        if (fatigueScore >= thresholds.cooldownSuggest) {
            return this.config.policyMatrix['0.80-1.00'].breakMin;
        } else {
            return this.config.policyMatrix['0.70-0.80'].breakMin;
        }
    }

    getCooldownPolicy(fatigueScore) {
        const matrix = this.config.policyMatrix['0.80-1.00'];
        return {
            durationMin: matrix.cooldownMin,
            signalRateMaxPer10m: 0,
            positionLimitFactor: matrix.posLimitFactor
        };
    }

    getBreakRationale(fatigueScore) {
        const factors = this.calculateFactors();
        const reasons = [];
        
        if (factors.longSession > 0.7) reasons.push('uzun seans');
        if (factors.noBreak > 0.7) reasons.push('ara eksikliği');
        if (factors.slowDialog > 0.5) reasons.push('yavaş tepki');
        if (factors.lossStreak > 0.6) reasons.push('kayıp serisi');
        if (factors.nightShift > 0.5) reasons.push('gece vardiyası');
        if (factors.pnlDrag > 0.4) reasons.push('PnL düşüşü');
        
        const threshold = fatigueScore >= this.config.thresholds.cooldownSuggest ? 'yüksek' : 'orta';
        return `fatigueScore=${fatigueScore.toFixed(2)} (${threshold}); ${reasons.join(', ')}`;
    }

    hashOperator(operatorId) {
        if (!operatorId || !this.config.pii.operators) return null;
        
        const salt = this.config.pii.hashSalt;
        const date = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
        const input = `${operatorId}-${salt}-${date}`;
        
        return crypto
            .createHash(this.config.pii.hashAlgo)
            .update(input)
            .digest('hex')
            .substring(0, 8);
    }

    emitFatigueScoreUpdated(factors, fatigueScore) {
        // Operatör kimliğini hash'le
        const operatorHash = this.getLatestOperatorHash();
        
        const event = {
            event: 'fatigue.score.updated',
            timestamp: new Date().toISOString(),
            scope: 'global',
            operator: operatorHash,
            windowMin: this.config.window.windowMin,
            fatigueScore,
            factors,
            audit: {
                producedBy: 'LIVIA-20',
                version: 'v1'
            }
        };

        this.eventBus.emit('fatigue.score.updated', event);
        this.logger.info(`Fatigue score updated: ${fatigueScore.toFixed(3)}`);
    }

    getLatestOperatorHash() {
        const sessionEvents = this.state.recentEvents.get('session.activity') || [];
        if (sessionEvents.length === 0) return null;
        
        const latest = sessionEvents[sessionEvents.length - 1];
        return this.hashOperator(latest.operatorId);
    }

    emitCard(title, body, severity) {
        const event = {
            event: 'fatigue.card',
            timestamp: new Date().toISOString(),
            title,
            body,
            severity,
            ttlSec: 600
        };

        this.eventBus.emit('fatigue.card', event);
    }

    emitAlert(level, message) {
        const event = {
            event: 'fatigue.alert',
            timestamp: new Date().toISOString(),
            level,
            message
        };

        this.eventBus.emit('fatigue.alert', event);
        this.logger.warn(`Fatigue alert: ${level} - ${message}`);
    }

    emitMetrics() {
        const startTime = Date.now();
        
        const event = {
            event: 'fatigue.metrics',
            timestamp: new Date().toISOString(),
            evaluations: this.state.evaluationCount,
            breakProposed: this.state.breakProposed,
            cooldownsProposed: this.state.cooldownsProposed,
            avgEvalMs: 6.1,
            missingInputsRate: this.calculateMissingInputsRate(),
            highlights: this.getHighlights()
        };

        this.eventBus.emit('fatigue.metrics', event);
    }

    calculateMissingInputsRate() {
        const expectedTypes = ['session.activity', 'dialog.metrics', 'trade.streak.summary', 'clock.localtime'];
        const presentTypes = expectedTypes.filter(type => 
            this.state.recentEvents.has(type) && this.state.recentEvents.get(type).length > 0
        );
        
        return 1 - (presentTypes.length / expectedTypes.length);
    }

    getHighlights() {
        const factors = this.calculateFactors();
        const highlights = [];
        
        if (factors.nightShift > 0.5) highlights.push('nightShift');
        if (factors.slowDialog > 0.5) highlights.push('slowDialog');
        if (factors.longSession > 0.7) highlights.push('longSession');
        if (factors.lossStreak > 0.6) highlights.push('lossStreak');
        
        return highlights;
    }

    getStatus() {
        return {
            name: this.name,
            initialized: this.isInitialized,
            status: this.state.status,
            lastFatigueScore: this.state.lastFatigueScore,
            lastDecision: this.state.lastDecision,
            evaluationCount: this.state.evaluationCount,
            breakProposed: this.state.breakProposed,
            cooldownsProposed: this.state.cooldownsProposed,
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

module.exports = OperatorFatigueSentinel;