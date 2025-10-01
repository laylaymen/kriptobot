/**
 * LIVIA-17 · reactiveDefenseGate.js
 * Reaktif savunma kapısı - FOMO/intikam/panik sonrası anlık sinyal kısıtlama ve variant bloklaması
 */

const { z } = require('zod');
const { eventBus } = require('../modularEventStream');
const { logInfo, logError } = require('../../logs/logger');

// 🎯 Smart Schemas
const DefenseConfigSchema = z.object({
    thresholds: z.object({
        fomo: z.number().min(0).max(1).default(0.70),
        overconfidence: z.number().min(0).max(1).default(0.65),
        revenge_followup_sec: z.number().positive().default(120)
    }).default({}),
    policyMatrix: z.record(z.string(), z.object({
        durationSec: z.number().positive(),
        signalRateMaxPer2m: z.number().min(0),
        blockVariants: z.array(z.string())
    })).default({}),
    approval: z.object({
        requireFor: z.array(z.string()).default(['panic', 'revenge', 'durationSec>=1200']),
        gateway: z.string().default('LIVIA-05')
    }).default({})
});

const EmotionTriggerSchema = z.object({
    event: z.literal('emotion.trigger'),
    timestamp: z.string(),
    trigger: z.enum(['fomo', 'revenge', 'overconfidence', 'panic']),
    confidence: z.number().min(0).max(1),
    source: z.string(),
    symbol: z.string().optional()
});

const TradeExecutedSchema = z.object({
    event: z.literal('trade.executed'),
    timestamp: z.string(),
    id: z.string(),
    side: z.enum(['buy', 'sell']),
    symbol: z.string(),
    pnlUSD: z.number(),
    context: z.object({
        variant: z.enum(['aggressive', 'balanced', 'conservative']).optional()
    }).optional()
});

const GuardEscalationSchema = z.object({
    event: z.literal('guard.escalation'),
    timestamp: z.string(),
    from: z.string(),
    to: z.string(),
    reason: z.string(),
    symbol: z.string().optional()
});

/**
 * 🎯 Smart Trigger Detector
 */
class SmartTriggerDetector {
    constructor(config) {
        this.config = config;
        this.recentTrades = new Map(); // symbol -> [trades]
        this.recentLosses = new Map(); // symbol -> last loss timestamp
    }

    detectTrigger(emotionEvent, biasSnapshot, recentTrades = []) {
        const triggers = [];

        // Direct emotion trigger
        if (emotionEvent) {
            const trigger = this.validateEmotionTrigger(emotionEvent);
            if (trigger) triggers.push(trigger);
        }

        // Bias-based triggers
        if (biasSnapshot) {
            const biasTriggers = this.detectBiasTriggers(biasSnapshot);
            triggers.push(...biasTriggers);
        }

        // Revenge pattern detection
        const revengeTrigger = this.detectRevengePattern(recentTrades);
        if (revengeTrigger) triggers.push(revengeTrigger);

        return this.selectPrimaryTrigger(triggers);
    }

    validateEmotionTrigger(emotionEvent) {
        try {
            const validated = EmotionTriggerSchema.parse(emotionEvent);
            
            // Threshold kontrolü
            const threshold = this.config.thresholds[validated.trigger];
            if (threshold && validated.confidence >= threshold) {
                return {
                    type: validated.trigger,
                    confidence: validated.confidence,
                    source: 'emotion.trigger',
                    symbol: validated.symbol,
                    context: { directTrigger: true }
                };
            }
        } catch (error) {
            // Validation failed, ignore
        }
        
        return null;
    }

    detectBiasTriggers(biasSnapshot) {
        const triggers = [];
        
        if (biasSnapshot.scores) {
            // FOMO detection
            if (biasSnapshot.scores.fomo >= this.config.thresholds.fomo) {
                triggers.push({
                    type: 'fomo',
                    confidence: biasSnapshot.scores.fomo,
                    source: 'bias.snapshot',
                    symbol: null,
                    context: { biasScore: biasSnapshot.scores.fomo }
                });
            }

            // Overconfidence detection
            if (biasSnapshot.scores.overconfidence >= this.config.thresholds.overconfidence) {
                triggers.push({
                    type: 'overconfidence',
                    confidence: biasSnapshot.scores.overconfidence,
                    source: 'bias.snapshot',
                    symbol: null,
                    context: { biasScore: biasSnapshot.scores.overconfidence }
                });
            }
        }
        
        return triggers;
    }

    detectRevengePattern(recentTrades) {
        if (!Array.isArray(recentTrades) || recentTrades.length < 2) return null;

        const now = Date.now();
        const revengeWindowMs = this.config.thresholds.revenge_followup_sec * 1000;

        // Son iki trade'i kontrol et
        const lastTrade = recentTrades[recentTrades.length - 1];
        const prevTrade = recentTrades[recentTrades.length - 2];

        try {
            const lastTradeTime = new Date(lastTrade.timestamp).getTime();
            const prevTradeTime = new Date(prevTrade.timestamp).getTime();

            // Önceki trade zarar ve sonraki trade kısa sürede mi?
            if (prevTrade.pnlUSD < 0 && 
                (lastTradeTime - prevTradeTime) <= revengeWindowMs) {
                
                return {
                    type: 'revenge',
                    confidence: 0.8, // Revenge pattern için sabit confidence
                    source: 'trade.pattern',
                    symbol: lastTrade.symbol,
                    context: {
                        prevLossUSD: prevTrade.pnlUSD,
                        timeDiffSec: Math.round((lastTradeTime - prevTradeTime) / 1000)
                    }
                };
            }
        } catch (error) {
            // Timestamp parse error, ignore
        }

        return null;
    }

    selectPrimaryTrigger(triggers) {
        if (triggers.length === 0) return null;

        // Panic en yüksek öncelik, sonra revenge, sonra confidence'a göre
        const priorityOrder = ['panic', 'revenge', 'overconfidence', 'fomo'];
        
        for (const priority of priorityOrder) {
            const trigger = triggers.find(t => t.type === priority);
            if (trigger) return trigger;
        }

        // Priority'de olmayan varsa en yüksek confidence'lıyı seç
        return triggers.reduce((max, trigger) => 
            trigger.confidence > max.confidence ? trigger : max
        );
    }

    updateTradeHistory(tradeEvent) {
        try {
            const trade = TradeExecutedSchema.parse(tradeEvent);
            const symbol = trade.symbol;
            
            if (!this.recentTrades.has(symbol)) {
                this.recentTrades.set(symbol, []);
            }
            
            const trades = this.recentTrades.get(symbol);
            trades.push(trade);
            
            // Son 10 trade'i tut
            if (trades.length > 10) {
                trades.shift();
            }
            
            // Loss timestamp güncelle
            if (trade.pnlUSD < 0) {
                this.recentLosses.set(symbol, Date.now());
            }
            
        } catch (error) {
            // Trade validation failed, ignore
        }
    }

    getRecentTrades(symbol) {
        return this.recentTrades.get(symbol) || [];
    }
}

/**
 * 🛡️ Smart Gate Generator
 */
class SmartGateGenerator {
    constructor(config) {
        this.config = config;
        this.defaultPolicies = {
            fomo: { durationSec: 600, signalRateMaxPer2m: 1, blockVariants: ['aggressive'] },
            overconfidence: { durationSec: 900, signalRateMaxPer2m: 1, blockVariants: ['aggressive', 'balanced'] },
            revenge: { durationSec: 1200, signalRateMaxPer2m: 0, blockVariants: ['*'] },
            panic: { durationSec: 1800, signalRateMaxPer2m: 0, blockVariants: ['*'] },
            guard_escalation: { durationSec: 600, signalRateMaxPer2m: 0, blockVariants: ['aggressive'] }
        };
    }

    generateGate(trigger, guardState = 'normal') {
        if (!trigger) return null;

        // Base policy seç
        const basePolicy = this.config.policyMatrix[trigger.type] || 
                          this.defaultPolicies[trigger.type] || 
                          this.defaultPolicies.fomo;

        // Guard durumuna göre adjust et
        let adjustedPolicy = { ...basePolicy };
        
        if (guardState === 'halt_entry' || guardState === 'streams_panic') {
            adjustedPolicy.signalRateMaxPer2m = 0;
            adjustedPolicy.blockVariants = ['*'];
        } else if (guardState === 'block_aggressive' || guardState === 'slowdown') {
            adjustedPolicy.signalRateMaxPer2m = Math.min(adjustedPolicy.signalRateMaxPer2m, 1);
            if (!adjustedPolicy.blockVariants.includes('aggressive')) {
                adjustedPolicy.blockVariants = [...adjustedPolicy.blockVariants, 'aggressive'];
            }
        }

        // Confidence'a göre fine-tune
        const confidenceMultiplier = Math.min(trigger.confidence * 1.5, 2.0);
        adjustedPolicy.durationSec = Math.round(adjustedPolicy.durationSec * confidenceMultiplier);

        const gate = {
            scope: trigger.symbol ? 'symbol' : 'global',
            symbol: trigger.symbol,
            trigger: trigger.type,
            policy: adjustedPolicy,
            ttlSec: adjustedPolicy.durationSec,
            confidence: trigger.confidence,
            triggerSource: trigger.source,
            triggerContext: trigger.context,
            guardContext: guardState !== 'normal' ? guardState : null
        };

        return gate;
    }

    requiresApproval(gate) {
        const { policy, trigger } = gate;
        
        // Duration kontrolü
        if (policy.durationSec >= 1200) return true;
        
        // Specific trigger kontrolü
        if (this.config.approval.requireFor.includes(trigger)) return true;
        
        return false;
    }

    generateGateKey(gate) {
        const timestamp = new Date().toISOString();
        const keyParts = [
            gate.scope,
            gate.symbol || 'global',
            gate.trigger,
            timestamp.substring(0, 16) // YYYY-MM-DDTHH:MM precision
        ];
        
        return keyParts.join('#');
    }

    mergeGates(existingGate, newGate) {
        // Daha uzun süre
        const durationSec = Math.max(existingGate.policy.durationSec, newGate.policy.durationSec);
        
        // Daha düşük sinyal oranı
        const signalRateMaxPer2m = Math.min(
            existingGate.policy.signalRateMaxPer2m, 
            newGate.policy.signalRateMaxPer2m
        );
        
        // Block variant'ları birleştir
        const existingBlocks = new Set(existingGate.policy.blockVariants);
        const newBlocks = new Set(newGate.policy.blockVariants);
        const blockVariants = [...new Set([...existingBlocks, ...newBlocks])];
        
        // Eğer herhangi biri '*' ise, hepsi bloklu
        if (blockVariants.includes('*')) {
            blockVariants.length = 0;
            blockVariants.push('*');
        }

        return {
            ...existingGate,
            policy: {
                durationSec,
                signalRateMaxPer2m,
                blockVariants
            },
            ttlSec: durationSec,
            confidence: Math.max(existingGate.confidence, newGate.confidence),
            merged: true,
            mergedWith: newGate.trigger
        };
    }
}

/**
 * 🎯 LIVIA-17 Smart Reactive Defense Gate
 */
class ReactiveDefenseGate {
    constructor(config = {}) {
        this.name = 'ReactiveDefenseGate';
        this.config = DefenseConfigSchema.parse(config);
        
        this.triggerDetector = new SmartTriggerDetector(this.config);
        this.gateGenerator = new SmartGateGenerator(this.config);
        
        this.guardState = 'normal';
        this.activeGates = new Map(); // gateKey -> gate
        this.stats = {
            gatesProposed: 0,
            gatesActivated: 0,
            gatesExpired: 0,
            gatesMerged: 0,
            avgActiveSec: 0,
            triggerBreakdown: {}
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
        // Emotion triggers
        eventBus.subscribeToEvent('emotion.trigger', (event) => {
            this.handleEmotionTrigger(event.data);
        }, 'reactiveDefenseGate');
        
        // Trade executed (revenge pattern detection)
        eventBus.subscribeToEvent('trade.executed', (event) => {
            this.handleTradeExecuted(event.data);
        }, 'reactiveDefenseGate');
        
        // Guard escalation
        eventBus.subscribeToEvent('guard.escalation', (event) => {
            this.handleGuardEscalation(event.data);
        }, 'reactiveDefenseGate');
        
        // Bias snapshots
        eventBus.subscribeToEvent('bias.snapshot', (event) => {
            this.handleBiasSnapshot(event.data);
        }, 'reactiveDefenseGate');
        
        // Policy override requests
        eventBus.subscribeToEvent('policy.override.request', (event) => {
            this.handleOverrideRequest(event.data);
        }, 'reactiveDefenseGate');
    }

    handleEmotionTrigger(data) {
        try {
            const trigger = this.triggerDetector.detectTrigger(data, null, []);
            if (trigger) {
                this.evaluateAndCreateGate(trigger);
            }
        } catch (error) {
            this.logger.error('Emotion trigger handle error:', error);
        }
    }

    handleTradeExecuted(data) {
        try {
            // Trade history'yi güncelle
            this.triggerDetector.updateTradeHistory(data);
            
            // Revenge pattern kontrol et
            const recentTrades = this.triggerDetector.getRecentTrades(data.symbol);
            const trigger = this.triggerDetector.detectTrigger(null, null, recentTrades);
            
            if (trigger) {
                this.evaluateAndCreateGate(trigger);
            }
        } catch (error) {
            this.logger.error('Trade executed handle error:', error);
        }
    }

    handleGuardEscalation(data) {
        try {
            const escalationTrigger = {
                type: 'guard_escalation',
                confidence: 0.9, // Guard escalation için yüksek confidence
                source: 'guard.escalation',
                symbol: data.symbol,
                context: {
                    from: data.from,
                    to: data.to,
                    reason: data.reason
                }
            };
            
            this.guardState = data.to;
            this.evaluateAndCreateGate(escalationTrigger);
            
        } catch (error) {
            this.logger.error('Guard escalation handle error:', error);
        }
    }

    handleBiasSnapshot(data) {
        try {
            const trigger = this.triggerDetector.detectTrigger(null, data, []);
            if (trigger) {
                this.evaluateAndCreateGate(trigger);
            }
        } catch (error) {
            this.logger.error('Bias snapshot handle error:', error);
        }
    }

    handleOverrideRequest(data) {
        try {
            const { gateKey, requestedBy, rationale } = data;
            
            if (this.activeGates.has(gateKey)) {
                this.activeGates.delete(gateKey);
                
                this.emit('defense.override.applied', {
                    gateKey,
                    requestedBy,
                    rationale
                });
                
                this.logger.info(`Defense gate override applied: ${gateKey} by ${requestedBy}`);
            }
            
        } catch (error) {
            this.logger.error('Override request handle error:', error);
        }
    }

    evaluateAndCreateGate(trigger) {
        try {
            // Gate üret
            const gate = this.gateGenerator.generateGate(trigger, this.guardState);
            if (!gate) return;

            // İdempotency ve merge kontrolü
            const gateKey = this.gateGenerator.generateGateKey(gate);
            const existingGate = this.findConflictingGate(gate);
            
            if (existingGate) {
                // Merge existing gate
                const mergedGate = this.gateGenerator.mergeGates(existingGate, gate);
                this.updateExistingGate(existingGate.gateKey, mergedGate);
                this.stats.gatesMerged++;
                return;
            }

            // Yeni gate öner
            this.proposeGate(gate, gateKey);
            
        } catch (error) {
            this.logger.error('Gate evaluation error:', error);
            this.emit('defense.alert', {
                level: 'error',
                message: 'evaluation_failed',
                context: { error: error.message }
            });
        }
    }

    findConflictingGate(newGate) {
        for (const [gateKey, existingGate] of this.activeGates.entries()) {
            // Aynı scope ve symbol/global için çakışma var mı?
            if (existingGate.scope === newGate.scope && 
                existingGate.symbol === newGate.symbol) {
                return { ...existingGate, gateKey };
            }
        }
        return null;
    }

    updateExistingGate(gateKey, mergedGate) {
        this.activeGates.set(gateKey, mergedGate);
        
        this.emit('defense.gate.merged', {
            gateKey,
            mergedWith: mergedGate.mergedWith,
            newPolicy: mergedGate.policy,
            newTtl: mergedGate.ttlSec
        });
        
        this.logger.info(`Defense gate merged: ${gateKey} with ${mergedGate.mergedWith}`);
    }

    proposeGate(gate, gateKey) {
        gate.gateKey = gateKey;
        
        // Stats güncelle
        this.stats.gatesProposed++;
        this.stats.triggerBreakdown[gate.trigger] = 
            (this.stats.triggerBreakdown[gate.trigger] || 0) + 1;

        // Gate önerisini yayınla
        this.emit('defense.gate.proposed', {
            scope: gate.scope,
            symbol: gate.symbol,
            trigger: gate.trigger,
            policy: gate.policy,
            ttlSec: gate.ttlSec,
            confidence: gate.confidence,
            triggerSource: gate.triggerSource,
            triggerContext: gate.triggerContext,
            guardContext: gate.guardContext
        });

        // Onay gerekiyor mu?
        if (this.gateGenerator.requiresApproval(gate)) {
            this.requestApproval(gate);
        } else {
            this.activateGate(gate);
        }
    }

    requestApproval(gate) {
        this.emit('approval.request', {
            gateway: this.config.approval.gateway,
            type: 'defense_gate',
            data: {
                gateKey: gate.gateKey,
                trigger: gate.trigger,
                durationSec: gate.policy.durationSec,
                rationale: this.generateRationale(gate)
            },
            callback: 'defense.approval.response'
        });
        
        this.logger.info(`Defense gate approval requested: ${gate.gateKey}`);
    }

    activateGate(gate) {
        const now = new Date();
        const effectiveUntil = new Date(now.getTime() + (gate.ttlSec * 1000));
        
        gate.effectiveFrom = now.toISOString();
        gate.effectiveUntil = effectiveUntil.toISOString();
        gate.appliedBy = 'auto';
        
        // Aktif gate'lere ekle
        this.activeGates.set(gate.gateKey, gate);
        
        // Stats güncelle
        this.stats.gatesActivated++;
        this.updateAvgActiveDuration(gate.policy.durationSec);
        
        // Events yayınla
        this.emit('defense.gate.activated', {
            gateKey: gate.gateKey,
            effectiveFrom: gate.effectiveFrom,
            effectiveUntil: gate.effectiveUntil,
            appliedBy: gate.appliedBy,
            hash: this.generateGateHash(gate)
        });
        
        this.emit('defense.card', {
            title: `Reaktif Savunma — ${gate.scope}`,
            body: this.generateCardBody(gate),
            severity: this.calculateSeverity(gate),
            ttlSec: 600,
            links: [{ label: 'Detay', href: `app://defense/${gate.gateKey}` }]
        });
        
        this.logger.info(`Defense gate activated: ${gate.gateKey}`);
    }

    generateRationale(gate) {
        const triggerLabels = {
            fomo: 'FOMO riski',
            revenge: 'İntikam işlemi',
            overconfidence: 'Aşırı güven',
            panic: 'Panik durumu',
            guard_escalation: 'Guard escalation'
        };
        
        const triggerLabel = triggerLabels[gate.trigger] || gate.trigger;
        const blockedVariants = gate.policy.blockVariants.join(', ');
        
        return `${triggerLabel} algılandı. ${gate.policy.durationSec}s boyunca 2dk'da max ${gate.policy.signalRateMaxPer2m} sinyal, [${blockedVariants}] varyantları bloklu.`;
    }

    generateCardBody(gate) {
        const triggerLabels = {
            fomo: 'FOMO',
            revenge: 'İntikam',
            overconfidence: 'Aşırı güven',
            panic: 'Panik',
            guard_escalation: 'Guard'
        };
        
        const triggerLabel = triggerLabels[gate.trigger] || gate.trigger;
        const blockedVariants = gate.policy.blockVariants.includes('*') ? 
                               'tüm varyantlar' : 
                               gate.policy.blockVariants.join(',');
        
        return `${triggerLabel} sonrası ${gate.policy.durationSec}s kısıtlama: ` +
               `2dk'da max ${gate.policy.signalRateMaxPer2m} sinyal; ${blockedVariants} kapalı.`;
    }

    calculateSeverity(gate) {
        if (gate.trigger === 'panic' || gate.policy.durationSec >= 1200) {
            return 'warn';
        }
        return 'info';
    }

    generateGateHash(gate) {
        const crypto = require('crypto');
        const hashInput = JSON.stringify({
            scope: gate.scope,
            trigger: gate.trigger,
            policy: gate.policy,
            effectiveFrom: gate.effectiveFrom
        });
        return 'sha256:' + crypto.createHash('sha256').update(hashInput).digest('hex').substring(0, 16);
    }

    updateAvgActiveDuration(durationSec) {
        this.stats.avgActiveSec = 
            (this.stats.avgActiveSec * (this.stats.gatesActivated - 1) + durationSec) / 
            this.stats.gatesActivated;
    }

    startSweepTimer() {
        // Her 30 saniyede expired gate'leri temizle
        this.sweepTimer = setInterval(() => {
            this.sweepExpiredGates();
        }, 30000);
    }

    sweepExpiredGates() {
        const now = new Date().toISOString();
        
        for (const [gateKey, gate] of this.activeGates.entries()) {
            if (now >= gate.effectiveUntil) {
                this.activeGates.delete(gateKey);
                this.stats.gatesExpired++;
                
                this.emit('defense.gate.expired', {
                    gateKey,
                    expiredAt: now,
                    originalDuration: gate.policy.durationSec
                });
                
                this.logger.info(`Defense gate expired: ${gateKey}`);
            }
        }
    }

    emit(eventType, data) {
        eventBus.publishEvent(eventType, {
            timestamp: new Date().toISOString(),
            source: this.name,
            ...data
        }, 'reactiveDefenseGate');
    }

    getStatus() {
        return {
            name: this.name,
            initialized: this.isInitialized,
            activeGates: this.activeGates.size,
            guardState: this.guardState,
            stats: this.stats
        };
    }

    async shutdown() {
        if (this.sweepTimer) {
            clearInterval(this.sweepTimer);
        }
        
        this.activeGates.clear();
        this.isInitialized = false;
        this.logger?.info(`${this.name} kapatıldı`);
    }
}

module.exports = {
    ReactiveDefenseGate,
    reactiveDefenseGate: new ReactiveDefenseGate()
};