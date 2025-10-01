/**
 * LIVIA-30: Context Aware Moral Limiter
 * Operatör eylemlerinde bilişsel önyargı ve bağlamsal faktörlere göre davranışsal fren uygulayan sistem
 */

const { z } = require('zod');
const EventEmitter = require('events');
const crypto = require('crypto');

// Input schemas
const ActionIntentSchema = z.object({
    event: z.literal('action.intent'),
    timestamp: z.string(),
    actionId: z.string(),
    kind: z.enum(['order.place', 'order.modify', 'policy.change', 'position.close']),
    scope: z.enum(['desk', 'symbol', 'global']),
    symbol: z.string().nullable(),
    payload: z.record(z.any())
}).strict();

const BiasSnapshotSchema = z.object({
    event: z.literal('bias.snapshot'),
    timestamp: z.string(),
    overconfidence: z.number().min(0).max(1),
    lossAversion: z.number().min(0).max(1),
    sunkCost: z.number().min(0).max(1),
    riskSeeking: z.number().min(0).max(1)
}).strict();

const FatigueScoreUpdatedSchema = z.object({
    event: z.literal('fatigue.score.updated'),
    timestamp: z.string(),
    scope: z.string(),
    operator: z.string(),
    fatigueScore: z.number().min(0).max(1)
}).strict();

const RecoveryScoreUpdatedSchema = z.object({
    event: z.literal('recovery.score.updated'),
    timestamp: z.string(),
    scope: z.string(),
    symbol: z.string(),
    recoveryIndex: z.number().min(0).max(1)
}).strict();

const CooldownPlanActivatedSchema = z.object({
    event: z.literal('cooldown.plan.activated'),
    timestamp: z.string(),
    cooldownKey: z.string(),
    effectiveUntil: z.string(),
    scope: z.string(),
    symbol: z.string().nullable()
}).strict();

const PnlWindowSchema = z.object({
    event: z.literal('pnl.window'),
    timestamp: z.string(),
    windowMin: z.number(),
    netUSD: z.number(),
    rrMedian: z.number()
}).strict();

const EthicsGateActivatedSchema = z.object({
    event: z.literal('ethics.gate.activated'),
    timestamp: z.string(),
    decision: z.enum(['allow_with_limits', 'block', 'halt'])
}).strict();

const MoralJustificationSubmittedSchema = z.object({
    event: z.literal('moral.justification.submitted'),
    timestamp: z.string(),
    actionId: z.string(),
    premortem: z.string(),
    checklist: z.record(z.any())
}).strict();

// Output schemas
const MoralNudgeProposedSchema = z.object({
    event: z.literal('moral.nudge.proposed'),
    timestamp: z.string(),
    actionId: z.string(),
    biasFlags: z.array(z.string()),
    message: z.string(),
    suggestedChanges: z.record(z.any()),
    ttlSec: z.number()
}).strict();

const MoralReflectionRequiredSchema = z.object({
    event: z.literal('moral.reflection.required'),
    timestamp: z.string(),
    actionId: z.string(),
    checklist: z.array(z.string()),
    premortemPrompt: z.string(),
    timeoutSec: z.number()
}).strict();

const MoralSoftblockSuggestedSchema = z.object({
    event: z.literal('moral.softblock.suggested'),
    timestamp: z.string(),
    actionId: z.string(),
    reasonCodes: z.array(z.string()),
    require: z.enum(['justification', 'approval']),
    cooldownHint: z.boolean()
}).strict();

const MoralPassSchema = z.object({
    event: z.literal('moral.pass'),
    timestamp: z.string(),
    actionId: z.string(),
    notes: z.string()
}).strict();

const MoralBlockDelegatedSchema = z.object({
    event: z.literal('moral.block.delegated'),
    timestamp: z.string(),
    actionId: z.string(),
    to: z.string(),
    reason: z.string()
}).strict();

class ContextAwareMoralLimiter extends EventEmitter {
    constructor(eventBus, logger, config = {}) {
        super();
        this.eventBus = eventBus;
        this.logger = logger;
        this.name = 'ContextAwareMoralLimiter';
        
        this.config = {
            i18n: { locale: 'tr-TR', tz: 'Europe/Istanbul' },
            weights: { bias: 0.4, fatigue: 0.2, recovery: 0.2, pnl: 0.2 },
            thresholds: {
                overconfidence: 0.7,
                riskSeeking: 0.55,
                fatigueHigh: 0.8,
                recoveryLow: 0.55,
                pnlDrawdownUSD: -300,
                requireReflectionScore: 0.65,
                escalateToEthicsScore: 0.85
            },
            nudgeLibrary: {
                overconfidence: [
                    { 
                        msg: "Son 24 saatte risk iştahı yüksek. Miktarı %30 azaltmayı dener misin?", 
                        change: { qtyFactor: 0.7 } 
                    }
                ],
                lossAversion: [
                    { 
                        msg: "Zararı telafi etme dürtüsüne dikkat. Varyantı 'balanced' seçebilirsin.", 
                        change: { variant: "balanced" } 
                    }
                ],
                riskSeeking: [
                    { 
                        msg: "Kayıp sonrası risk alma artıyor. Pozisyon limit faktörünü düşürelim mi?", 
                        change: { posLimitFactor: 0.8 } 
                    }
                ]
            },
            reflectionForm: {
                fields: ["maxLossUSD", "exitRule", "whyNow"],
                premortemPrompt: "Bu işlem neden kötü gidebilir? 3 sebep yaz."
            },
            integration: {
                cooldownHint: true,
                ethics: "LIVIA-26",
                dist: "LIVIA-22",
                redact: "LIVIA-21"
            },
            idempotencyTtlSec: 1800,
            ...config
        };

        this.state = {
            status: 'IDLE',
            contextData: {
                bias: { overconfidence: 0, lossAversion: 0, sunkCost: 0, riskSeeking: 0 },
                fatigue: new Map(),
                recovery: new Map(),
                pnl: { windowMin: 0, netUSD: 0, rrMedian: 1.0 },
                cooldown: new Map(),
                ethics: null
            },
            pendingActions: new Map(),
            assessmentHistory: new Map(),
            metrics: {
                nudges: 0,
                accepted: 0,
                softBlocks: 0,
                escalations: 0,
                avgAssessMs: 0,
                conversionRate: 0.0
            }
        };

        this.isInitialized = false;
    }

    async initialize() {
        try {
            this.logger.info(`${this.name} başlatılıyor...`);
            
            // Event listeners
            this.eventBus.on('action.intent', this.handleActionIntent.bind(this));
            this.eventBus.on('bias.snapshot', this.handleBiasSnapshot.bind(this));
            this.eventBus.on('fatigue.score.updated', this.handleFatigueScoreUpdated.bind(this));
            this.eventBus.on('recovery.score.updated', this.handleRecoveryScoreUpdated.bind(this));
            this.eventBus.on('cooldown.plan.activated', this.handleCooldownPlanActivated.bind(this));
            this.eventBus.on('pnl.window', this.handlePnlWindow.bind(this));
            this.eventBus.on('ethics.gate.activated', this.handleEthicsGateActivated.bind(this));
            this.eventBus.on('moral.justification.submitted', this.handleMoralJustificationSubmitted.bind(this));

            this.isInitialized = true;
            this.logger.info(`${this.name} başarıyla başlatıldı`);
            return true;
        } catch (error) {
            this.logger.error(`${this.name} başlatma hatası:`, error);
            return false;
        }
    }

    handleActionIntent(data) {
        try {
            const validated = ActionIntentSchema.parse(data);
            this.logger.info(`Action intent: ${validated.actionId} - ${validated.kind}`);
            this.assessAction(validated);
        } catch (error) {
            this.logger.error('Action intent validation error:', error);
            this.emitAlert('error', 'invalid_action_intent');
        }
    }

    handleBiasSnapshot(data) {
        try {
            const validated = BiasSnapshotSchema.parse(data);
            this.updateBiasData(validated);
        } catch (error) {
            this.logger.error('Bias snapshot validation error:', error);
        }
    }

    handleFatigueScoreUpdated(data) {
        try {
            const validated = FatigueScoreUpdatedSchema.parse(data);
            this.updateFatigueData(validated);
        } catch (error) {
            this.logger.error('Fatigue score validation error:', error);
        }
    }

    handleRecoveryScoreUpdated(data) {
        try {
            const validated = RecoveryScoreUpdatedSchema.parse(data);
            this.updateRecoveryData(validated);
        } catch (error) {
            this.logger.error('Recovery score validation error:', error);
        }
    }

    handleCooldownPlanActivated(data) {
        try {
            const validated = CooldownPlanActivatedSchema.parse(data);
            this.updateCooldownData(validated);
        } catch (error) {
            this.logger.error('Cooldown plan validation error:', error);
        }
    }

    handlePnlWindow(data) {
        try {
            const validated = PnlWindowSchema.parse(data);
            this.updatePnlData(validated);
        } catch (error) {
            this.logger.error('PnL window validation error:', error);
        }
    }

    handleEthicsGateActivated(data) {
        try {
            const validated = EthicsGateActivatedSchema.parse(data);
            this.updateEthicsData(validated);
        } catch (error) {
            this.logger.error('Ethics gate validation error:', error);
        }
    }

    handleMoralJustificationSubmitted(data) {
        try {
            const validated = MoralJustificationSubmittedSchema.parse(data);
            this.processJustification(validated);
        } catch (error) {
            this.logger.error('Moral justification validation error:', error);
        }
    }

    updateBiasData(biasData) {
        this.state.contextData.bias = {
            overconfidence: biasData.overconfidence,
            lossAversion: biasData.lossAversion,
            sunkCost: biasData.sunkCost,
            riskSeeking: biasData.riskSeeking,
            updatedAt: biasData.timestamp
        };
        
        this.logger.debug(`Bias data updated: overconfidence=${biasData.overconfidence.toFixed(2)}, riskSeeking=${biasData.riskSeeking.toFixed(2)}`);
    }

    updateFatigueData(fatigueData) {
        const key = `${fatigueData.scope}:${fatigueData.operator}`;
        this.state.contextData.fatigue.set(key, {
            score: fatigueData.fatigueScore,
            updatedAt: fatigueData.timestamp
        });
        
        this.logger.debug(`Fatigue data updated: ${key} = ${fatigueData.fatigueScore.toFixed(2)}`);
    }

    updateRecoveryData(recoveryData) {
        const key = `${recoveryData.scope}:${recoveryData.symbol}`;
        this.state.contextData.recovery.set(key, {
            index: recoveryData.recoveryIndex,
            updatedAt: recoveryData.timestamp
        });
        
        this.logger.debug(`Recovery data updated: ${key} = ${recoveryData.recoveryIndex.toFixed(2)}`);
    }

    updateCooldownData(cooldownData) {
        const key = cooldownData.scope + (cooldownData.symbol ? `:${cooldownData.symbol}` : '');
        this.state.contextData.cooldown.set(key, {
            cooldownKey: cooldownData.cooldownKey,
            effectiveUntil: cooldownData.effectiveUntil,
            updatedAt: cooldownData.timestamp
        });
        
        this.logger.debug(`Cooldown data updated: ${key} until ${cooldownData.effectiveUntil}`);
    }

    updatePnlData(pnlData) {
        this.state.contextData.pnl = {
            windowMin: pnlData.windowMin,
            netUSD: pnlData.netUSD,
            rrMedian: pnlData.rrMedian,
            updatedAt: pnlData.timestamp
        };
        
        this.logger.debug(`PnL data updated: ${pnlData.netUSD}USD, RR=${pnlData.rrMedian.toFixed(2)}`);
    }

    updateEthicsData(ethicsData) {
        this.state.contextData.ethics = {
            decision: ethicsData.decision,
            updatedAt: ethicsData.timestamp
        };
        
        this.logger.debug(`Ethics data updated: ${ethicsData.decision}`);
    }

    async assessAction(action) {
        const assessmentStartTime = Date.now();
        
        try {
            this.state.status = 'ASSESSING';
            
            // Generate moral key for idempotency
            const moralKey = this.generateMoralKey(action);
            
            if (this.state.assessmentHistory.has(moralKey)) {
                this.logger.info(`Action already assessed: ${moralKey}`);
                return;
            }
            
            // Calculate risk score
            const riskScore = this.calculateRiskScore(action);
            
            // Create assessment record
            const assessment = {
                actionId: action.actionId,
                moralKey,
                action,
                riskScore,
                timestamp: new Date().toISOString(),
                contextSnapshot: this.captureContextSnapshot(),
                decision: null,
                outcome: null
            };
            
            this.state.assessmentHistory.set(moralKey, assessment);
            this.state.pendingActions.set(action.actionId, assessment);
            
            // Make decision based on risk score
            const decision = this.makeDecision(riskScore, action, assessment);
            assessment.decision = decision;
            
            // Execute decision
            await this.executeDecision(decision, assessment);
            
            // Update metrics
            const assessmentTime = Date.now() - assessmentStartTime;
            this.updateAssessmentMetrics(assessmentTime);
            
        } catch (error) {
            this.logger.error(`Assessment error for action ${action.actionId}:`, error);
            this.emitAlert('error', 'assessment_failed');
        } finally {
            this.state.status = 'IDLE';
        }
    }

    calculateRiskScore(action) {
        const weights = this.config.weights;
        
        // Calculate individual factors
        const biasFactor = this.calculateBiasFactor();
        const fatigueFactor = this.calculateFatigueFactor(action);
        const recoveryFactor = this.calculateRecoveryFactor(action);
        const pnlFactor = this.calculatePnlFactor();
        
        // Weighted sum
        const riskScore = 
            weights.bias * biasFactor +
            weights.fatigue * fatigueFactor +
            weights.recovery * recoveryFactor +
            weights.pnl * pnlFactor;
        
        this.logger.debug(`Risk score calculated: ${riskScore.toFixed(3)} (bias=${biasFactor.toFixed(2)}, fatigue=${fatigueFactor.toFixed(2)}, recovery=${recoveryFactor.toFixed(2)}, pnl=${pnlFactor.toFixed(2)})`);
        
        return Math.max(0, Math.min(1, riskScore));
    }

    calculateBiasFactor() {
        const bias = this.state.contextData.bias;
        return Math.max(
            bias.overconfidence,
            bias.riskSeeking,
            bias.lossAversion,
            bias.sunkCost
        );
    }

    calculateFatigueFactor(action) {
        // Look for relevant fatigue data
        const scopeKey = `${action.scope}:*`;
        let maxFatigue = 0;
        
        for (const [key, fatigue] of this.state.contextData.fatigue.entries()) {
            if (key.startsWith(action.scope)) {
                maxFatigue = Math.max(maxFatigue, fatigue.score);
            }
        }
        
        return maxFatigue;
    }

    calculateRecoveryFactor(action) {
        if (!action.symbol) return 0;
        
        const recoveryKey = `symbol:${action.symbol}`;
        const recovery = this.state.contextData.recovery.get(recoveryKey);
        
        if (!recovery) return 0;
        
        // Lower recovery index = higher risk factor
        return 1 - recovery.index;
    }

    calculatePnlFactor() {
        const pnl = this.state.contextData.pnl;
        
        // Calculate drawdown factor
        const drawdownFactor = Math.max(0, Math.min(1, -pnl.netUSD / 500));
        
        // Calculate risk-reward factor
        const rrFactor = Math.max(0, Math.min(1, (1 - pnl.rrMedian) / 0.5));
        
        return drawdownFactor * rrFactor;
    }

    captureContextSnapshot() {
        return {
            bias: { ...this.state.contextData.bias },
            fatigue: Object.fromEntries(this.state.contextData.fatigue),
            recovery: Object.fromEntries(this.state.contextData.recovery),
            pnl: { ...this.state.contextData.pnl },
            cooldown: Object.fromEntries(this.state.contextData.cooldown),
            ethics: this.state.contextData.ethics ? { ...this.state.contextData.ethics } : null,
            capturedAt: new Date().toISOString()
        };
    }

    makeDecision(riskScore, action, assessment) {
        const thresholds = this.config.thresholds;
        
        // Check for active blocks
        if (this.hasActiveCooldown(action) || this.hasEthicsBlock()) {
            return {
                type: 'PASS_WITH_NOTE',
                reason: 'active_blocks',
                note: 'Aktif cooldown veya etik blok mevcut'
            };
        }
        
        // Escalate to ethics if score is very high
        if (riskScore >= thresholds.escalateToEthicsScore) {
            return {
                type: 'ESCALATE',
                reason: 'high_risk_score',
                target: this.config.integration.ethics
            };
        }
        
        // Require reflection if score is above threshold
        if (riskScore >= thresholds.requireReflectionScore) {
            return {
                type: 'REFLECT',
                reason: 'moderate_risk_score',
                requireSoftblock: true
            };
        }
        
        // Nudge if there are bias indicators
        const biasFlags = this.identifyBiasFlags(assessment.contextSnapshot);
        if (biasFlags.length > 0) {
            return {
                type: 'NUDGE',
                reason: 'bias_detected',
                biasFlags
            };
        }
        
        // Pass if no concerns
        return {
            type: 'PASS',
            reason: 'low_risk'
        };
    }

    hasActiveCooldown(action) {
        const now = new Date();
        
        for (const [key, cooldown] of this.state.contextData.cooldown.entries()) {
            const effectiveUntil = new Date(cooldown.effectiveUntil);
            
            if (effectiveUntil > now) {
                // Check if cooldown applies to this action
                if (key.includes(action.scope) || (action.symbol && key.includes(action.symbol))) {
                    return true;
                }
            }
        }
        
        return false;
    }

    hasEthicsBlock() {
        const ethics = this.state.contextData.ethics;
        return ethics && (ethics.decision === 'block' || ethics.decision === 'halt');
    }

    identifyBiasFlags(contextSnapshot) {
        const flags = [];
        const thresholds = this.config.thresholds;
        const bias = contextSnapshot.bias;
        
        if (bias.overconfidence >= thresholds.overconfidence) {
            flags.push('overconfidence');
        }
        
        if (bias.riskSeeking >= thresholds.riskSeeking) {
            flags.push('riskSeeking');
        }
        
        if (bias.lossAversion >= 0.6) { // Dynamic threshold
            flags.push('lossAversion');
        }
        
        if (bias.sunkCost >= 0.5) { // Dynamic threshold
            flags.push('sunkCost');
        }
        
        return flags;
    }

    async executeDecision(decision, assessment) {
        switch (decision.type) {
            case 'NUDGE':
                await this.executeNudge(decision, assessment);
                break;
            case 'REFLECT':
                await this.executeReflection(decision, assessment);
                break;
            case 'ESCALATE':
                await this.executeEscalation(decision, assessment);
                break;
            case 'PASS':
                await this.executePass(decision, assessment);
                break;
            case 'PASS_WITH_NOTE':
                await this.executePass(decision, assessment);
                break;
        }
    }

    async executeNudge(decision, assessment) {
        const nudge = this.generateNudge(decision.biasFlags, assessment);
        
        if (nudge) {
            this.emitNudgeProposed(assessment.actionId, nudge);
            this.state.metrics.nudges++;
            
            assessment.outcome = {
                type: 'nudge',
                nudge,
                timestamp: new Date().toISOString()
            };
        }
    }

    generateNudge(biasFlags, assessment) {
        const nudgeLib = this.config.nudgeLibrary;
        
        // Select nudge based on primary bias flag
        const primaryBias = biasFlags[0];
        const nudgeOptions = nudgeLib[primaryBias];
        
        if (!nudgeOptions || nudgeOptions.length === 0) {
            return null;
        }
        
        // Select first option (could be randomized)
        const selectedNudge = nudgeOptions[0];
        
        // Customize message based on context
        let message = selectedNudge.msg;
        const pnl = assessment.contextSnapshot.pnl;
        
        if (pnl.netUSD < 0) {
            message = message.replace('Son 24 saatte', `Son ${pnl.windowMin} dakikada net ${pnl.netUSD.toFixed(0)}$ ve`);
        }
        
        return {
            message,
            suggestedChanges: selectedNudge.change,
            biasFlags,
            ttlSec: 300
        };
    }

    async executeReflection(decision, assessment) {
        const reflectionForm = this.config.reflectionForm;
        
        this.emitReflectionRequired(assessment.actionId, reflectionForm);
        
        if (decision.requireSoftblock) {
            const reasonCodes = this.generateReasonCodes(assessment);
            this.emitSoftblockSuggested(assessment.actionId, reasonCodes);
            this.state.metrics.softBlocks++;
        }
        
        assessment.outcome = {
            type: 'reflection',
            requireSoftblock: decision.requireSoftblock,
            timestamp: new Date().toISOString()
        };
    }

    generateReasonCodes(assessment) {
        const codes = [];
        const context = assessment.contextSnapshot;
        
        const maxFatigue = Math.max(...Array.from(this.state.contextData.fatigue.values()).map(f => f.score));
        if (maxFatigue >= this.config.thresholds.fatigueHigh) {
            codes.push('fatigue_high');
        }
        
        if (assessment.action.symbol) {
            const recoveryKey = `symbol:${assessment.action.symbol}`;
            const recovery = this.state.contextData.recovery.get(recoveryKey);
            if (recovery && recovery.index <= this.config.thresholds.recoveryLow) {
                codes.push('recovery_low');
            }
        }
        
        if (context.pnl.netUSD <= this.config.thresholds.pnlDrawdownUSD) {
            codes.push('pnl_drawdown');
        }
        
        return codes;
    }

    async executeEscalation(decision, assessment) {
        this.emitBlockDelegated(assessment.actionId, decision.target, decision.reason);
        this.state.metrics.escalations++;
        
        assessment.outcome = {
            type: 'escalation',
            target: decision.target,
            reason: decision.reason,
            timestamp: new Date().toISOString()
        };
    }

    async executePass(decision, assessment) {
        const notes = decision.note || `Risk score: ${assessment.riskScore.toFixed(3)} - ${decision.reason}`;
        
        this.emitPass(assessment.actionId, notes);
        
        assessment.outcome = {
            type: 'pass',
            notes,
            timestamp: new Date().toISOString()
        };
        
        // Clean up pending action
        this.state.pendingActions.delete(assessment.actionId);
    }

    async processJustification(justification) {
        const pendingAction = this.state.pendingActions.get(justification.actionId);
        
        if (!pendingAction) {
            this.logger.warn(`No pending action found for justification: ${justification.actionId}`);
            return;
        }
        
        // Process justification through redaction service if available
        const redactedJustification = await this.redactJustification(justification);
        
        // Reassess with justification
        const reassessment = this.reassessWithJustification(pendingAction, redactedJustification);
        
        if (reassessment.decision === 'PASS') {
            // Apply any changes from original nudge
            const modifiedAction = this.applyNudgeChanges(pendingAction.action, pendingAction.outcome);
            
            this.emitPass(justification.actionId, `Justification accepted: ${reassessment.reason}`);
            this.state.metrics.accepted++;
            
            // Update conversion rate
            this.updateConversionRate();
        } else {
            // Still blocked, maintain current state
            this.logger.info(`Justification not sufficient for action: ${justification.actionId}`);
        }
        
        // Clean up
        this.state.pendingActions.delete(justification.actionId);
    }

    async redactJustification(justification) {
        // Send to redaction service if configured
        if (this.config.integration.redact) {
            const redactEvent = {
                event: 'redact.request',
                timestamp: new Date().toISOString(),
                profile: 'moral_justification',
                content: {
                    premortem: justification.premortem,
                    checklist: justification.checklist
                }
            };
            
            this.eventBus.emit('redact.request', redactEvent);
        }
        
        // For now, return as-is (real implementation would wait for redacted response)
        return justification;
    }

    reassessWithJustification(pendingAction, justification) {
        // Simple heuristic: if justification contains risk management terms, allow
        const riskTerms = ['stop', 'limit', 'exit', 'hedge', 'reduce', 'monitor'];
        const justificationText = justification.premortem.toLowerCase();
        
        const hasRiskManagement = riskTerms.some(term => justificationText.includes(term));
        
        if (hasRiskManagement && Object.keys(justification.checklist).length >= 2) {
            return {
                decision: 'PASS',
                reason: 'adequate_risk_management'
            };
        }
        
        return {
            decision: 'BLOCK',
            reason: 'insufficient_risk_management'
        };
    }

    applyNudgeChanges(action, outcome) {
        if (!outcome || outcome.type !== 'nudge' || !outcome.nudge.suggestedChanges) {
            return action;
        }
        
        const modifiedAction = {
            ...action,
            payload: {
                ...action.payload,
                ...outcome.nudge.suggestedChanges
            }
        };
        
        return modifiedAction;
    }

    generateMoralKey(action) {
        const keyData = {
            actionId: action.actionId,
            biasSnapshotHash: this.hashBiasSnapshot(),
            windowISO: new Date().toISOString().split('T')[0]
        };
        
        return 'moral:' + crypto
            .createHash('sha256')
            .update(JSON.stringify(keyData))
            .digest('hex')
            .substring(0, 16);
    }

    hashBiasSnapshot() {
        const bias = this.state.contextData.bias;
        const biasString = `${bias.overconfidence.toFixed(2)}-${bias.lossAversion.toFixed(2)}-${bias.sunkCost.toFixed(2)}-${bias.riskSeeking.toFixed(2)}`;
        
        return crypto
            .createHash('sha256')
            .update(biasString)
            .digest('hex')
            .substring(0, 8);
    }

    updateAssessmentMetrics(assessmentTimeMs) {
        const currentAvg = this.state.metrics.avgAssessMs;
        const totalAssessments = this.state.metrics.nudges + this.state.metrics.softBlocks + this.state.metrics.escalations;
        
        if (totalAssessments === 1) {
            this.state.metrics.avgAssessMs = assessmentTimeMs;
        } else {
            this.state.metrics.avgAssessMs = Math.round(
                (currentAvg * (totalAssessments - 1) + assessmentTimeMs) / totalAssessments
            );
        }
    }

    updateConversionRate() {
        const totalNudges = this.state.metrics.nudges;
        const accepted = this.state.metrics.accepted;
        
        this.state.metrics.conversionRate = totalNudges > 0 ? accepted / totalNudges : 0;
    }

    emitNudgeProposed(actionId, nudge) {
        const event = {
            event: 'moral.nudge.proposed',
            timestamp: new Date().toISOString(),
            actionId,
            biasFlags: nudge.biasFlags,
            message: nudge.message,
            suggestedChanges: nudge.suggestedChanges,
            ttlSec: nudge.ttlSec
        };
        
        this.eventBus.emit('moral.nudge.proposed', event);
    }

    emitReflectionRequired(actionId, reflectionForm) {
        const event = {
            event: 'moral.reflection.required',
            timestamp: new Date().toISOString(),
            actionId,
            checklist: reflectionForm.fields,
            premortemPrompt: reflectionForm.premortemPrompt,
            timeoutSec: 120
        };
        
        this.eventBus.emit('moral.reflection.required', event);
    }

    emitSoftblockSuggested(actionId, reasonCodes) {
        const event = {
            event: 'moral.softblock.suggested',
            timestamp: new Date().toISOString(),
            actionId,
            reasonCodes,
            require: 'justification',
            cooldownHint: this.config.integration.cooldownHint
        };
        
        this.eventBus.emit('moral.softblock.suggested', event);
        
        // Emit cooldown hint if configured
        if (this.config.integration.cooldownHint) {
            this.emitCooldownHint(actionId);
        }
    }

    emitCooldownHint(actionId) {
        const cooldownEvent = {
            event: 'cooldown.plan.proposed',
            timestamp: new Date().toISOString(),
            scope: 'desk',
            symbol: null,
            reason: 'moral_limiter_suggestion',
            context: { actionId }
        };
        
        this.eventBus.emit('cooldown.plan.proposed', cooldownEvent);
    }

    emitPass(actionId, notes) {
        const event = {
            event: 'moral.pass',
            timestamp: new Date().toISOString(),
            actionId,
            notes
        };
        
        this.eventBus.emit('moral.pass', event);
    }

    emitBlockDelegated(actionId, target, reason) {
        const event = {
            event: 'moral.block.delegated',
            timestamp: new Date().toISOString(),
            actionId,
            to: target,
            reason
        };
        
        this.eventBus.emit('moral.block.delegated', event);
    }

    emitMoralCard() {
        const recentNudges = this.state.metrics.nudges;
        const recentAccepted = this.state.metrics.accepted;
        
        if (recentNudges === 0) return;
        
        const event = {
            event: 'moral.card',
            timestamp: new Date().toISOString(),
            title: 'Davranışsal Fren Uygulandı',
            body: `${recentNudges} nudge • ${recentAccepted} kabul • sistem aktif`,
            severity: 'info',
            ttlSec: 600
        };
        
        this.eventBus.emit('moral.card', event);
    }

    emitAlert(level, message) {
        const event = {
            event: 'moral.alert',
            timestamp: new Date().toISOString(),
            level,
            message,
            context: {
                status: this.state.status,
                pendingActions: this.state.pendingActions.size,
                assessmentHistory: this.state.assessmentHistory.size
            }
        };

        this.eventBus.emit('moral.alert', event);
        this.logger.warn(`Moral alert: ${level} - ${message}`);
    }

    emitMetrics() {
        const event = {
            event: 'moral.metrics',
            timestamp: new Date().toISOString(),
            ...this.state.metrics,
            pendingActions: this.state.pendingActions.size,
            assessmentHistory: this.state.assessmentHistory.size,
            contextDataHealth: this.getContextDataHealth()
        };

        this.eventBus.emit('moral.metrics', event);
    }

    getContextDataHealth() {
        const now = new Date();
        const context = this.state.contextData;
        
        return {
            biasAge: context.bias.updatedAt ? 
                Math.round((now.getTime() - new Date(context.bias.updatedAt).getTime()) / 1000) : null,
            fatigueDataPoints: context.fatigue.size,
            recoveryDataPoints: context.recovery.size,
            activeCooldowns: Array.from(context.cooldown.values())
                .filter(cd => new Date(cd.effectiveUntil) > now).length,
            ethicsActive: context.ethics ? context.ethics.decision : null
        };
    }

    getStatus() {
        return {
            name: this.name,
            initialized: this.isInitialized,
            status: this.state.status,
            pendingActions: this.state.pendingActions.size,
            assessmentHistory: this.state.assessmentHistory.size,
            contextData: {
                bias: this.state.contextData.bias,
                fatigue: this.state.contextData.fatigue.size,
                recovery: this.state.contextData.recovery.size,
                cooldown: this.state.contextData.cooldown.size,
                ethics: this.state.contextData.ethics
            },
            metrics: this.state.metrics
        };
    }

    async shutdown() {
        try {
            this.logger.info(`${this.name} durduruluyor...`);
            
            // Process any remaining pending actions
            const pendingCount = this.state.pendingActions.size;
            if (pendingCount > 0) {
                this.logger.info(`Processing ${pendingCount} pending actions before shutdown`);
                
                for (const [actionId, assessment] of this.state.pendingActions.entries()) {
                    this.emitPass(actionId, 'System shutdown - auto-pass');
                }
            }
            
            // Emit final metrics and card
            this.emitMetrics();
            this.emitMoralCard();
            
            this.isInitialized = false;
            this.logger.info(`${this.name} başarıyla durduruldu`);
        } catch (error) {
            this.logger.error(`${this.name} durdurma hatası:`, error);
        }
    }
}

module.exports = ContextAwareMoralLimiter;