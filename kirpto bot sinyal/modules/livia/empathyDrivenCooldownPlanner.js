/**
 * LIVIA-16 · empathyDrivenCooldownPlanner.js
 * Empati bazlı cooldown planlayıcısı - duygusal stress işaretlerinden cooldown planları üretme
 */

const { z } = require('zod');
const { eventBus } = require('../modularEventStream');
const { logInfo, logError } = require('../../logs/logger');

// 🎯 Smart Schemas
const CooldownConfigSchema = z.object({
    thresholds: z.object({
        overconfidence: z.number().min(0).max(1).default(0.70),
        risk_seeking: z.number().min(0).max(1).default(0.60),
        loss_series_usd: z.number().negative().default(-250),
        loss_series_window_min: z.number().positive().default(45),
        overtrading_count_1h: z.number().positive().default(5),
        overtrading_loss_pct: z.number().min(0).max(1).default(0.5),
        emotional_surge_count_10m: z.number().positive().default(3)
    }).default({}),
    policyMatrix: z.record(z.string(), z.object({
        durationMin: z.number().positive(),
        signalRateMaxPer10m: z.number().min(0),
        positionLimitFactor: z.number().min(0).max(1)
    })).default({}),
    approval: z.object({
        requireFor: z.array(z.string()).default(['durationMin>=45', 'panic_mode']),
        gateway: z.string().default('LIVIA-05')
    }).default({})
});

const BiasAwarenessSchema = z.object({
    event: z.literal('bias.awareness'),
    timestamp: z.string(),
    operatorId: z.string().optional(),
    scores: z.object({
        overconfidence: z.number().min(0).max(1),
        loss_aversion: z.number().min(0).max(1),
        risk_seeking: z.number().min(0).max(1)
    }),
    window: z.string(),
    source: z.string()
});

const StressMetricsSchema = z.object({
    event: z.literal('operator.stress.metrics'),
    timestamp: z.string(),
    overtradingLoop: z.object({
        count1h: z.number(),
        lossPct: z.number().min(0).max(1)
    }).optional(),
    hesitation: z.object({
        missed: z.number(),
        rebounds: z.number()
    }).optional(),
    emotionalSurge: z.object({
        last10m: z.object({
            positions: z.number(),
            rsiVolMismatch: z.boolean()
        })
    }).optional()
});

const TradeLossSeriesSchema = z.object({
    event: z.literal('trade.loss.series'),
    timestamp: z.string(),
    sequence: z.array(z.object({
        id: z.string(),
        pnlUSD: z.number()
    })),
    window: z.string()
});

/**
 * 🧠 Smart Risk Scorer
 */
class SmartRiskScorer {
    constructor(config) {
        this.config = config;
        this.weights = {
            overconfidence: 0.3,
            risk_seeking: 0.2,
            loss_series: 0.25,
            overtrading: 0.15,
            emotional_surge: 0.1
        };
    }

    calculateRiskScore(signals) {
        let totalScore = 0;
        let activeSignals = [];

        // Overconfidence risk
        if (signals.bias && signals.bias.scores.overconfidence >= this.config.thresholds.overconfidence) {
            const score = signals.bias.scores.overconfidence * this.weights.overconfidence;
            totalScore += score;
            activeSignals.push({
                type: 'overconfidence',
                value: signals.bias.scores.overconfidence,
                score: score
            });
        }

        // Risk seeking
        if (signals.bias && signals.bias.scores.risk_seeking >= this.config.thresholds.risk_seeking) {
            const score = signals.bias.scores.risk_seeking * this.weights.risk_seeking;
            totalScore += score;
            activeSignals.push({
                type: 'risk_seeking',
                value: signals.bias.scores.risk_seeking,
                score: score
            });
        }

        // Loss series
        if (signals.lossRisk) {
            const score = signals.lossRisk.severity * this.weights.loss_series;
            totalScore += score;
            activeSignals.push({
                type: 'loss_series',
                value: signals.lossRisk.totalLossUSD,
                score: score
            });
        }

        // Overtrading
        if (signals.overtradingRisk) {
            const score = signals.overtradingRisk.severity * this.weights.overtrading;
            totalScore += score;
            activeSignals.push({
                type: 'overtrading',
                value: signals.overtradingRisk.count1h,
                score: score
            });
        }

        // Emotional surge
        if (signals.emotionalRisk) {
            const score = signals.emotionalRisk.severity * this.weights.emotional_surge;
            totalScore += score;
            activeSignals.push({
                type: 'emotional_surge',
                value: signals.emotionalRisk.positions,
                score: score
            });
        }

        return {
            totalScore,
            activeSignals,
            primaryReason: this.getPrimaryReason(activeSignals)
        };
    }

    getPrimaryReason(activeSignals) {
        if (activeSignals.length === 0) return null;
        
        // En yüksek skorlu sinyali bul
        const topSignal = activeSignals.reduce((max, signal) => 
            signal.score > max.score ? signal : max
        );

        return topSignal.type;
    }

    assessLossRisk(lossSeriesEvent) {
        if (!lossSeriesEvent || !lossSeriesEvent.sequence) return null;

        const totalLoss = lossSeriesEvent.sequence.reduce((sum, trade) => sum + trade.pnlUSD, 0);
        
        if (totalLoss <= this.config.thresholds.loss_series_usd) {
            const severity = Math.min(Math.abs(totalLoss) / Math.abs(this.config.thresholds.loss_series_usd), 1);
            return {
                severity,
                totalLossUSD: totalLoss,
                tradeCount: lossSeriesEvent.sequence.length
            };
        }
        
        return null;
    }

    assessOvertradingRisk(stressMetrics) {
        if (!stressMetrics || !stressMetrics.overtradingLoop) return null;

        const { count1h, lossPct } = stressMetrics.overtradingLoop;
        
        if (count1h >= this.config.thresholds.overtrading_count_1h && 
            lossPct >= this.config.thresholds.overtrading_loss_pct) {
            const severity = Math.min((count1h / this.config.thresholds.overtrading_count_1h) * 
                                    (lossPct / this.config.thresholds.overtrading_loss_pct), 1);
            return {
                severity,
                count1h,
                lossPct
            };
        }
        
        return null;
    }

    assessEmotionalRisk(stressMetrics) {
        if (!stressMetrics || !stressMetrics.emotionalSurge) return null;

        const { last10m } = stressMetrics.emotionalSurge;
        
        if (last10m.positions >= this.config.thresholds.emotional_surge_count_10m && 
            last10m.rsiVolMismatch) {
            const severity = Math.min(last10m.positions / this.config.thresholds.emotional_surge_count_10m, 1);
            return {
                severity,
                positions: last10m.positions,
                rsiVolMismatch: last10m.rsiVolMismatch
            };
        }
        
        return null;
    }
}

/**
 * 📋 Smart Plan Generator
 */
class SmartPlanGenerator {
    constructor(config) {
        this.config = config;
        this.defaultPolicies = {
            overconfidence: { durationMin: 30, signalRateMaxPer10m: 1, positionLimitFactor: 0.6 },
            risk_seeking: { durationMin: 25, signalRateMaxPer10m: 1, positionLimitFactor: 0.7 },
            loss_series: { durationMin: 25, signalRateMaxPer10m: 1, positionLimitFactor: 0.8 },
            overtrading: { durationMin: 45, signalRateMaxPer10m: 0, positionLimitFactor: 0.5 },
            emotional_surge: { durationMin: 30, signalRateMaxPer10m: 0, positionLimitFactor: 0.6 },
            panic_mode: { durationMin: 60, signalRateMaxPer10m: 0, positionLimitFactor: 0.4 }
        };
    }

    generatePlan(riskAssessment, guardMode = 'normal') {
        const { primaryReason, totalScore, activeSignals } = riskAssessment;
        
        if (!primaryReason) return null;

        // Base policy seç
        const basePolicy = this.config.policyMatrix[primaryReason] || 
                          this.defaultPolicies[primaryReason] || 
                          this.defaultPolicies.overconfidence;

        // Guard durumuna göre adjust et
        let adjustedPolicy = { ...basePolicy };
        
        if (guardMode === 'halt_entry' || guardMode === 'streams_panic') {
            adjustedPolicy.signalRateMaxPer10m = 0;
            adjustedPolicy.positionLimitFactor = Math.min(adjustedPolicy.positionLimitFactor, 0.3);
        } else if (guardMode === 'block_aggressive' || guardMode === 'slowdown') {
            adjustedPolicy.signalRateMaxPer10m = Math.min(adjustedPolicy.signalRateMaxPer10m, 1);
            adjustedPolicy.positionLimitFactor = Math.min(adjustedPolicy.positionLimitFactor, 0.7);
        }

        // Severity'ye göre fine-tune
        const severityMultiplier = Math.min(totalScore * 1.5, 2.0);
        adjustedPolicy.durationMin = Math.round(adjustedPolicy.durationMin * severityMultiplier);

        const plan = {
            scope: 'global', // Şimdilik global, ileride symbol-specific yapılabilir
            symbol: null,
            reasonCode: primaryReason,
            policy: adjustedPolicy,
            ttlSec: adjustedPolicy.durationMin * 60,
            confidence: totalScore,
            activeSignals: activeSignals.map(s => ({ type: s.type, value: s.value })),
            guardContext: guardMode !== 'normal' ? guardMode : null
        };

        return plan;
    }

    requiresApproval(plan) {
        const { policy, reasonCode } = plan;
        
        // Duration kontrolü
        if (policy.durationMin >= 45) return true;
        
        // Specific reason kontrolü
        if (this.config.approval.requireFor.includes(reasonCode)) return true;
        
        // Panic mode kontrolü
        if (reasonCode === 'panic_mode') return true;
        
        return false;
    }

    generateCooldownKey(plan) {
        const timestamp = new Date().toISOString();
        const keyParts = [
            plan.scope,
            plan.symbol || 'global',
            plan.reasonCode,
            timestamp.substring(0, 16) // YYYY-MM-DDTHH:MM precision
        ];
        
        return keyParts.join('#');
    }
}

/**
 * 🎯 LIVIA-16 Smart Empathy-Driven Cooldown Planner
 */
class EmpathyDrivenCooldownPlanner {
    constructor(config = {}) {
        this.name = 'EmpathyDrivenCooldownPlanner';
        this.config = CooldownConfigSchema.parse(config);
        
        this.riskScorer = new SmartRiskScorer(this.config);
        this.planGenerator = new SmartPlanGenerator(this.config);
        
        this.signalBuffer = {
            bias: null,
            stress: null,
            losses: null,
            guard: 'normal'
        };
        
        this.activePlans = new Map(); // cooldownKey -> plan
        this.stats = {
            plansProposed: 0,
            plansActivated: 0,
            plansExpired: 0,
            avgDurationMin: 0,
            reasonBreakdown: {}
        };
        
        this.sweepTimer = null;
        this.isInitialized = false;
        this.logger = null;
    }

    async initialize(logger) {
        try {
            this.logger = logger;
            this.logger.info(`${this.name} başlatılıyor...`);
            
            this.setupEventListeners();
            this.startSweepTimer();
            
            this.isInitialized = true;
            this.logger.info(`${this.name} başarıyla başlatıldı`);
            return true;
        } catch (error) {
            this.logger.error(`${this.name} hatası:`, error);
            return false;
        }
    }

    setupEventListeners() {
        // Bias awareness signals
        eventBus.subscribeToEvent('bias.awareness', (event) => {
            this.handleBiasAwareness(event.data);
        }, 'empathyDrivenCooldownPlanner');
        
        // Stress metrics
        eventBus.subscribeToEvent('operator.stress.metrics', (event) => {
            this.handleStressMetrics(event.data);
        }, 'empathyDrivenCooldownPlanner');
        
        // Loss series
        eventBus.subscribeToEvent('trade.loss.series', (event) => {
            this.handleLossSeries(event.data);
        }, 'empathyDrivenCooldownPlanner');
        
        // Guard mode changes
        eventBus.subscribeToEvent('guard.mode', (event) => {
            this.handleGuardMode(event.data);
        }, 'empathyDrivenCooldownPlanner');
        
        // Policy override requests
        eventBus.subscribeToEvent('policy.override.request', (event) => {
            this.handleOverrideRequest(event.data);
        }, 'empathyDrivenCooldownPlanner');
    }

    handleBiasAwareness(data) {
        try {
            const biasData = BiasAwarenessSchema.parse(data);
            this.signalBuffer.bias = biasData;
            
            this.evaluateRiskAndPlan();
            
        } catch (error) {
            this.logger.error('Bias awareness handle error:', error);
        }
    }

    handleStressMetrics(data) {
        try {
            const stressData = StressMetricsSchema.parse(data);
            this.signalBuffer.stress = stressData;
            
            this.evaluateRiskAndPlan();
            
        } catch (error) {
            this.logger.error('Stress metrics handle error:', error);
        }
    }

    handleLossSeries(data) {
        try {
            const lossData = TradeLossSeriesSchema.parse(data);
            this.signalBuffer.losses = lossData;
            
            this.evaluateRiskAndPlan();
            
        } catch (error) {
            this.logger.error('Loss series handle error:', error);
        }
    }

    handleGuardMode(data) {
        try {
            const guardMode = data.sentry || data.latency_slip || 'normal';
            this.signalBuffer.guard = guardMode;
            
            // Guard escalation durumunda hemen evaluate et
            if (guardMode !== 'normal') {
                this.evaluateRiskAndPlan();
            }
            
        } catch (error) {
            this.logger.error('Guard mode handle error:', error);
        }
    }

    handleOverrideRequest(data) {
        try {
            const { cooldownKey, requestedBy, rationale } = data;
            
            if (this.activePlans.has(cooldownKey)) {
                this.activePlans.delete(cooldownKey);
                
                this.emit('cooldown.override.applied', {
                    cooldownKey,
                    requestedBy,
                    rationale
                });
                
                this.logger.info(`Cooldown override applied: ${cooldownKey} by ${requestedBy}`);
            }
            
        } catch (error) {
            this.logger.error('Override request handle error:', error);
        }
    }

    evaluateRiskAndPlan() {
        try {
            // Signal'ları topla
            const signals = {
                bias: this.signalBuffer.bias,
                lossRisk: this.signalBuffer.losses ? 
                         this.riskScorer.assessLossRisk(this.signalBuffer.losses) : null,
                overtradingRisk: this.signalBuffer.stress ? 
                               this.riskScorer.assessOvertradingRisk(this.signalBuffer.stress) : null,
                emotionalRisk: this.signalBuffer.stress ? 
                             this.riskScorer.assessEmotionalRisk(this.signalBuffer.stress) : null
            };

            // Risk skorunu hesapla
            const riskAssessment = this.riskScorer.calculateRiskScore(signals);
            
            if (riskAssessment.totalScore < 0.3) {
                // Risk düşük, plan gereksiz
                return;
            }

            // Plan üret
            const plan = this.planGenerator.generatePlan(riskAssessment, this.signalBuffer.guard);
            
            if (!plan) return;

            // İdempotency kontrolü
            const cooldownKey = this.planGenerator.generateCooldownKey(plan);
            if (this.activePlans.has(cooldownKey)) {
                this.emit('cooldown.alert', {
                    level: 'info',
                    message: 'idem_duplicate',
                    context: { cooldownKey }
                });
                return;
            }

            // Plan öner
            this.proposePlan(plan, cooldownKey);
            
        } catch (error) {
            this.logger.error('Risk evaluation error:', error);
            this.emit('cooldown.alert', {
                level: 'error',
                message: 'evaluation_failed',
                context: { error: error.message }
            });
        }
    }

    proposePlan(plan, cooldownKey) {
        plan.cooldownKey = cooldownKey;
        
        // Stats güncelle
        this.stats.plansProposed++;
        this.stats.reasonBreakdown[plan.reasonCode] = 
            (this.stats.reasonBreakdown[plan.reasonCode] || 0) + 1;

        // Plan önerisini yayınla
        this.emit('cooldown.plan.proposed', {
            scope: plan.scope,
            symbol: plan.symbol,
            reasonCode: plan.reasonCode,
            policy: plan.policy,
            ttlSec: plan.ttlSec,
            confidence: plan.confidence,
            activeSignals: plan.activeSignals,
            guardContext: plan.guardContext
        });

        // Onay gerekiyor mu?
        if (this.planGenerator.requiresApproval(plan)) {
            this.requestApproval(plan);
        } else {
            this.activatePlan(plan);
        }
    }

    requestApproval(plan) {
        this.emit('approval.request', {
            gateway: this.config.approval.gateway,
            type: 'cooldown_plan',
            data: {
                cooldownKey: plan.cooldownKey,
                reasonCode: plan.reasonCode,
                durationMin: plan.policy.durationMin,
                rationale: this.generateRationale(plan)
            },
            callback: 'cooldown.approval.response'
        });
        
        this.logger.info(`Cooldown approval requested: ${plan.cooldownKey}`);
    }

    activatePlan(plan) {
        const now = new Date();
        const effectiveUntil = new Date(now.getTime() + (plan.ttlSec * 1000));
        
        plan.effectiveFrom = now.toISOString();
        plan.effectiveUntil = effectiveUntil.toISOString();
        plan.appliedBy = 'auto';
        
        // Aktif planlara ekle
        this.activePlans.set(plan.cooldownKey, plan);
        
        // Stats güncelle
        this.stats.plansActivated++;
        this.updateAvgDuration(plan.policy.durationMin);
        
        // Events yayınla
        this.emit('cooldown.plan.activated', {
            cooldownKey: plan.cooldownKey,
            effectiveFrom: plan.effectiveFrom,
            effectiveUntil: plan.effectiveUntil,
            appliedBy: plan.appliedBy,
            hash: this.generatePlanHash(plan)
        });
        
        this.emit('cooldown.card', {
            title: `Geçici Savunma — ${plan.scope}`,
            body: this.generateCardBody(plan),
            severity: this.calculateSeverity(plan),
            ttlSec: 600,
            links: [{ label: 'Detay', href: `app://cooldown/${plan.cooldownKey}` }]
        });
        
        this.logger.info(`Cooldown plan activated: ${plan.cooldownKey}`);
    }

    generateRationale(plan) {
        const reasonLabels = {
            overconfidence: 'Aşırı güven riski',
            risk_seeking: 'Risk alma eğilimi',
            loss_series: 'Ardışık zarar serisi',
            overtrading: 'Aşırı işlem riski',
            emotional_surge: 'Duygusal dalga',
            panic_mode: 'Panik modu'
        };
        
        const reasonLabel = reasonLabels[plan.reasonCode] || plan.reasonCode;
        const signals = plan.activeSignals.map(s => `${s.type}: ${s.value}`).join(', ');
        
        return `${reasonLabel} algılandı (${signals}). ${plan.policy.durationMin} dakika boyunca sinyal kısıtlaması öneriliyor.`;
    }

    generateCardBody(plan) {
        const reasonLabels = {
            overconfidence: 'Aşırı güven',
            risk_seeking: 'Risk alma',
            loss_series: 'Zarar serisi',
            overtrading: 'Aşırı işlem',
            emotional_surge: 'Duygusal dalga',
            panic_mode: 'Panik'
        };
        
        const reasonLabel = reasonLabels[plan.reasonCode] || plan.reasonCode;
        
        return `${reasonLabel} riski → ${plan.policy.durationMin} dk sinyal kısıtlaması. ` +
               `Max ${plan.policy.signalRateMaxPer10m}/10dk, pozisyon x${plan.policy.positionLimitFactor}.`;
    }

    calculateSeverity(plan) {
        if (plan.reasonCode === 'panic_mode' || plan.policy.durationMin >= 60) {
            return 'warn';
        }
        return 'info';
    }

    generatePlanHash(plan) {
        const crypto = require('crypto');
        const hashInput = JSON.stringify({
            scope: plan.scope,
            reasonCode: plan.reasonCode,
            policy: plan.policy,
            effectiveFrom: plan.effectiveFrom
        });
        return 'sha256:' + crypto.createHash('sha256').update(hashInput).digest('hex').substring(0, 16);
    }

    updateAvgDuration(durationMin) {
        this.stats.avgDurationMin = 
            (this.stats.avgDurationMin * (this.stats.plansActivated - 1) + durationMin) / 
            this.stats.plansActivated;
    }

    startSweepTimer() {
        // Her dakika expired planları temizle
        this.sweepTimer = setInterval(() => {
            this.sweepExpiredPlans();
        }, 60000);
    }

    sweepExpiredPlans() {
        const now = new Date().toISOString();
        
        for (const [cooldownKey, plan] of this.activePlans.entries()) {
            if (now >= plan.effectiveUntil) {
                this.activePlans.delete(cooldownKey);
                this.stats.plansExpired++;
                
                this.emit('cooldown.plan.expired', {
                    cooldownKey,
                    expiredAt: now,
                    originalDuration: plan.policy.durationMin
                });
                
                this.logger.info(`Cooldown plan expired: ${cooldownKey}`);
            }
        }
    }

    emit(eventType, data) {
        eventBus.publishEvent(eventType, {
            timestamp: new Date().toISOString(),
            source: this.name,
            ...data
        }, 'empathyDrivenCooldownPlanner');
    }

    getStatus() {
        return {
            name: this.name,
            initialized: this.isInitialized,
            activePlans: this.activePlans.size,
            signalBuffer: {
                hasBias: !!this.signalBuffer.bias,
                hasStress: !!this.signalBuffer.stress,
                hasLosses: !!this.signalBuffer.losses,
                guardMode: this.signalBuffer.guard
            },
            stats: this.stats
        };
    }

    async shutdown() {
        if (this.sweepTimer) {
            clearInterval(this.sweepTimer);
        }
        
        this.activePlans.clear();
        this.isInitialized = false;
        this.logger?.info(`${this.name} kapatıldı`);
    }
}

module.exports = {
    EmpathyDrivenCooldownPlanner,
    empathyDrivenCooldownPlanner: new EmpathyDrivenCooldownPlanner()
};