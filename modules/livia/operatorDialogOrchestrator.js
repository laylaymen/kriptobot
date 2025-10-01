/**
 * LIVIA-01 · operatorDialogOrchestrator.ts
 * Operatöre tek, bağlamlı "öneri kartı" gösterme ve onay/ret alma sistemi
 * 
 * Amaç: VIVO, Portföy, Sentry/Guard ve Policy sinyallerini harmanlayarak
 * operatöre kontekstli onay kartı sunmak ve kararını almak
 */

const { z } = require('zod');
const { eventBus } = require('../../kirpto bot sinyal/modules/modularEventStream');
const { logInfo, logError, logEvent } = require('../../kirpto bot sinyal/logs/logger');

/**
 * 🔄 Input Event Schemas
 */
const CompositionPlaybookChoiceSchema = z.object({
    event: z.literal('composition.playbook.choice'),
    timestamp: z.string(),
    symbol: z.string(),
    timeframe: z.string(),
    playbookId: z.string(),
    variant: z.enum(['base', 'aggressive', 'conservative']),
    exec: z.enum(['market', 'limit', 'twap', 'iceberg']),
    params: z.object({
        offsetBps: z.number().optional()
    }).optional(),
    constraints: z.object({
        postOnly: z.boolean().optional()
    }).optional(),
    reasonCodes: z.array(z.string()).optional()
});

const PositionSizeSuggestionSchema = z.object({
    event: z.literal('position.size.suggestion'),
    timestamp: z.string(),
    correlationId: z.string(),
    symbol: z.string(),
    riskUnitUSD: z.number(),
    qty: z.number(),
    maxNotional: z.number(),
    reasonCodes: z.array(z.string()).optional()
});

const VariantSuggestionSchema = z.object({
    event: z.literal('variant.suggestion'),
    timestamp: z.string(),
    suggested: z.enum(['base', 'aggressive', 'conservative']),
    confidence0to1: z.number().min(0).max(1),
    reasons: z.array(z.string()).optional()
});

const GuardDirectiveSchema = z.object({
    event: z.string(),
    timestamp: z.string(),
    mode: z.enum(['normal', 'degraded', 'streams_panic', 'halt_entry', 'slowdown', 'block_aggressive']),
    expiresAt: z.string(),
    reasonCodes: z.array(z.string()).optional()
});

const OperatorResponseSchema = z.object({
    event: z.literal('operator.response.in'),
    timestamp: z.string(),
    promptId: z.string(),
    decisionId: z.string(),
    payload: z.object({
        note: z.string().optional()
    }).optional(),
    auth: z.object({
        sig: z.string(),
        userId: z.string()
    })
});

/**
 * 📤 Output Event Schemas
 */
const OperatorPromptSchema = z.object({
    event: z.literal('operator.prompt.out'),
    timestamp: z.string(),
    promptId: z.string(),
    title: z.string(),
    body: z.string(),
    options: z.array(z.object({
        id: z.string(),
        label: z.string(),
        actionHint: z.string()
    })),
    context: z.object({
        symbol: z.string(),
        variant: z.string(),
        tuned: z.string().optional(),
        exec: z.string(),
        qty: z.number(),
        riskUnitUSD: z.number(),
        guard: z.string()
    }),
    expiresAt: z.string(),
    audit: z.object({
        eventId: z.string(),
        producedBy: z.string(),
        producedAt: z.string()
    })
});

const OperatorDecisionFinalSchema = z.object({
    event: z.literal('operator.decision.final'),
    timestamp: z.string(),
    promptId: z.string(),
    decisionId: z.string(),
    accepted: z.boolean(),
    rationale: z.string(),
    ttlSec: z.number(),
    context: z.object({
        correlationId: z.string(),
        symbol: z.string()
    }),
    audit: z.object({
        eventId: z.string(),
        producedBy: z.string(),
        producedAt: z.string()
    })
});

/**
 * 🎯 LIVIA-01 Operator Dialog Orchestrator Class
 */
class OperatorDialogOrchestrator {
    constructor(config = {}) {
        this.name = 'OperatorDialogOrchestrator';
        this.config = {
            style: { maxChars: 500, bullets: true, showReasons: true },
            rules: {
                requireConfirmFor: ['aggressive', 'halt_entry', 'failover'],
                minScoreForSelfApprove: 0.70,
                blockIfGuard: ['halt_entry']
            },
            timeouts: { promptSec: 90, idleCloseSec: 300 },
            i18n: { locale: 'tr-TR', tz: 'Europe/Istanbul' },
            security: { verifyOperatorAuth: true, hmacHeader: 'X-Signature' },
            idempotencyTtlSec: 300,
            ...config
        };

        // Dialog state management
        this.state = {
            openPrompts: new Map(),
            lastDecisionByCorrelationId: new Map(),
            stats: { opens: 0, accepts: 0, rejects: 0, timeouts: 0 }
        };

        // Context accumulator
        this.currentContext = {
            playbookChoice: null,
            positionSuggestion: null,
            variantSuggestion: null,
            guardDirective: null,
            operatorScore: null,
            biasWeights: null,
            policySnapshot: null,
            qaTags: null
        };

        this.isInitialized = false;
        this.logger = null;
    }

    /**
     * 🚀 Initialize the orchestrator
     */
    async initialize(logger) {
        try {
            this.logger = logger;
            this.logger.info(`${this.name} başlatılıyor...`);

            // Subscribe to input events
            this.setupEventListeners();

            // Start timeout handler
            this.startTimeoutHandler();

            this.isInitialized = true;
            this.logger.info(`${this.name} başarıyla başlatıldı`);
            return true;
        } catch (error) {
            this.logger.error(`${this.name} başlatma hatası:`, error);
            return false;
        }
    }

    /**
     * 👂 Setup event listeners for incoming data
     */
    setupEventListeners() {
        // Context building events
        eventBus.subscribeToEvent('composition.playbook.choice', (event) => {
            this.handlePlaybookChoice(event.data);
        }, 'operatorDialogOrchestrator');

        eventBus.subscribeToEvent('position.size.suggestion', (event) => {
            this.handlePositionSuggestion(event.data);
        }, 'operatorDialogOrchestrator');

        eventBus.subscribeToEvent('variant.suggestion', (event) => {
            this.handleVariantSuggestion(event.data);
        }, 'operatorDialogOrchestrator');

        eventBus.subscribeToEvent('signal.variant.tuned', (event) => {
            this.handleVariantTuned(event.data);
        }, 'operatorDialogOrchestrator');

        eventBus.subscribeToEvent('sentry.guard.directive', (event) => {
            this.handleGuardDirective(event.data);
        }, 'operatorDialogOrchestrator');

        eventBus.subscribeToEvent('latency_slip.guard.directive', (event) => {
            this.handleGuardDirective(event.data);
        }, 'operatorDialogOrchestrator');

        eventBus.subscribeToEvent('operator.consistency.score', (event) => {
            this.handleOperatorScore(event.data);
        }, 'operatorDialogOrchestrator');

        eventBus.subscribeToEvent('livia.bias.weights', (event) => {
            this.handleBiasWeights(event.data);
        }, 'operatorDialogOrchestrator');

        eventBus.subscribeToEvent('policy.snapshot', (event) => {
            this.handlePolicySnapshot(event.data);
        }, 'operatorDialogOrchestrator');

        eventBus.subscribeToEvent('qa.tags', (event) => {
            this.handleQaTags(event.data);
        }, 'operatorDialogOrchestrator');

        // Operator response
        eventBus.subscribeToEvent('operator.response.in', (event) => {
            this.handleOperatorResponse(event.data);
        }, 'operatorDialogOrchestrator');
    }

    /**
     * 📊 Handle playbook choice context
     */
    handlePlaybookChoice(data) {
        try {
            const validated = CompositionPlaybookChoiceSchema.parse(data);
            this.currentContext.playbookChoice = validated;
            this.logger.info(`Playbook choice context alındı: ${validated.symbol} ${validated.variant}/${validated.exec}`);
            
            // Check if we have enough context to make a decision
            this.checkAndProcessDecision();
        } catch (error) {
            this.logger.error('Playbook choice validation error:', error);
        }
    }

    /**
     * 💰 Handle position size suggestion context
     */
    handlePositionSuggestion(data) {
        try {
            const validated = PositionSizeSuggestionSchema.parse(data);
            this.currentContext.positionSuggestion = validated;
            this.logger.info(`Position size context alındı: ${validated.symbol} qty=${validated.qty}`);
            
            this.checkAndProcessDecision();
        } catch (error) {
            this.logger.error('Position suggestion validation error:', error);
        }
    }

    /**
     * 🎯 Handle variant suggestion context
     */
    handleVariantSuggestion(data) {
        try {
            const validated = VariantSuggestionSchema.parse(data);
            this.currentContext.variantSuggestion = validated;
            this.logger.info(`Variant suggestion context alındı: ${validated.suggested} (confidence: ${validated.confidence0to1})`);
            
            this.checkAndProcessDecision();
        } catch (error) {
            this.logger.error('Variant suggestion validation error:', error);
        }
    }

    /**
     * 🔄 Handle variant tuned context
     */
    handleVariantTuned(data) {
        try {
            this.currentContext.variantTuned = data;
            this.logger.info(`Variant tuned context alındı: ${data.base} → ${data.adjusted}`);
            
            this.checkAndProcessDecision();
        } catch (error) {
            this.logger.error('Variant tuned validation error:', error);
        }
    }

    /**
     * 🛡️ Handle guard directive context
     */
    handleGuardDirective(data) {
        try {
            const validated = GuardDirectiveSchema.parse(data);
            this.currentContext.guardDirective = validated;
            this.logger.info(`Guard directive context alındı: ${validated.mode}`);
            
            this.checkAndProcessDecision();
        } catch (error) {
            this.logger.error('Guard directive validation error:', error);
        }
    }

    /**
     * 👤 Handle operator score context
     */
    handleOperatorScore(data) {
        this.currentContext.operatorScore = data;
        this.logger.info(`Operator score context alındı: ${data.score0to1}`);
    }

    /**
     * 🧠 Handle bias weights context
     */
    handleBiasWeights(data) {
        this.currentContext.biasWeights = data;
        this.logger.info(`Bias weights context alındı`);
    }

    /**
     * 📋 Handle policy snapshot context
     */
    handlePolicySnapshot(data) {
        this.currentContext.policySnapshot = data;
        this.logger.info(`Policy snapshot context alındı`);
    }

    /**
     * 🏷️ Handle QA tags context
     */
    handleQaTags(data) {
        this.currentContext.qaTags = data;
        this.logger.info(`QA tags context alındı: ${data.tags?.join(', ')}`);
    }

    /**
     * 🤔 Check if we have enough context to make a decision
     */
    checkAndProcessDecision() {
        const { playbookChoice, positionSuggestion } = this.currentContext;
        
        if (!playbookChoice || !positionSuggestion) {
            return; // Need at least these two
        }

        const correlationId = positionSuggestion.correlationId;
        
        // Check idempotency
        if (this.state.lastDecisionByCorrelationId.has(correlationId)) {
            this.logger.info(`Decision already exists for correlation ${correlationId}`);
            return;
        }

        this.processDecision(correlationId);
    }

    /**
     * ⚡ Process the decision logic
     */
    async processDecision(correlationId) {
        try {
            const context = this.buildDecisionContext();
            
            // Check if confirmation is required
            const requiresConfirmation = this.checkConfirmationRequired(context);
            
            if (!requiresConfirmation && this.canSelfApprove(context)) {
                // Self-approve
                await this.emitFinalDecision(correlationId, 'self-approved', true, 'Otomatik onay');
                return;
            }

            // Generate operator prompt
            await this.generateOperatorPrompt(correlationId, context);

        } catch (error) {
            this.logger.error('Decision processing error:', error);
            
            // Fallback to conservative decision
            await this.emitFinalDecision(correlationId, 'error-fallback', false, 'Sistem hatası nedeniyle reddedildi');
        }
    }

    /**
     * 🏗️ Build decision context from accumulated data
     */
    buildDecisionContext() {
        const { playbookChoice, positionSuggestion, variantSuggestion, variantTuned, guardDirective } = this.currentContext;
        
        return {
            symbol: playbookChoice.symbol,
            variant: playbookChoice.variant,
            tuned: variantTuned?.adjusted || variantSuggestion?.suggested || playbookChoice.variant,
            exec: playbookChoice.exec,
            qty: positionSuggestion.qty,
            riskUnitUSD: positionSuggestion.riskUnitUSD,
            guard: guardDirective?.mode || 'normal',
            confidence: variantSuggestion?.confidence0to1 || 0.5,
            reasonCodes: [...(playbookChoice.reasonCodes || []), ...(positionSuggestion.reasonCodes || [])],
            qaTags: this.currentContext.qaTags?.tags || []
        };
    }

    /**
     * ❓ Check if confirmation is required
     */
    checkConfirmationRequired(context) {
        const { rules } = this.config;
        
        // Check variant requirements
        if (rules.requireConfirmFor.includes(context.variant)) {
            return true;
        }

        // Check guard mode
        if (rules.blockIfGuard.includes(context.guard)) {
            return true;
        }

        // Check high-risk conditions
        if (context.guard === 'degraded' || context.guard === 'streams_panic') {
            return true;
        }

        return false;
    }

    /**
     * ✅ Check if self-approval is possible
     */
    canSelfApprove(context) {
        const operatorScore = this.currentContext.operatorScore?.score0to1 || 0;
        const { rules } = this.config;
        
        // Check operator consistency score
        if (operatorScore < rules.minScoreForSelfApprove) {
            return false;
        }

        // Check if guard blocks self-approval
        if (rules.blockIfGuard.includes(context.guard)) {
            return false;
        }

        // Check risk level
        if (context.riskUnitUSD > 1000) { // High risk threshold
            return false;
        }

        return true;
    }

    /**
     * 📝 Generate operator prompt
     */
    async generateOperatorPrompt(correlationId, context) {
        const promptId = `dlg-${context.symbol.toLowerCase()}-${Date.now()}`;
        const now = new Date();
        const expiresAt = new Date(now.getTime() + this.config.timeouts.promptSec * 1000);

        const title = `${context.symbol} — ${context.variant}/${context.exec.toUpperCase()} önerisi`;
        
        const body = this.formatPromptBody(context);
        
        const options = this.generatePromptOptions(context);

        const promptEvent = {
            event: 'operator.prompt.out',
            timestamp: now.toISOString(),
            promptId,
            title,
            body,
            options,
            context: {
                symbol: context.symbol,
                variant: context.variant,
                tuned: context.tuned,
                exec: context.exec,
                qty: context.qty,
                riskUnitUSD: context.riskUnitUSD,
                guard: context.guard
            },
            expiresAt: expiresAt.toISOString(),
            audit: {
                eventId: `audit-${Date.now()}`,
                producedBy: 'livia-01',
                producedAt: now.toISOString()
            }
        };

        // Store prompt in state
        this.state.openPrompts.set(promptId, {
            correlationId,
            context,
            expiresAt,
            createdAt: now
        });

        // Emit prompt
        eventBus.publishEvent('operator.prompt.out', promptEvent, 'operatorDialogOrchestrator');
        
        this.state.stats.opens++;
        this.logger.info(`Operator prompt oluşturuldu: ${promptId}`);
    }

    /**
     * 📄 Format prompt body text
     */
    formatPromptBody(context) {
        const lines = [];
        
        lines.push(`• Varyant: ${context.variant} → ${context.tuned}`);
        lines.push(`• Yürütme: ${context.exec.toUpperCase()}`);
        lines.push(`• Miktar: ~${context.qty.toFixed(2)} (${context.riskUnitUSD} USD risk)`);
        
        if (context.qaTags.length > 0) {
            lines.push(`• QA/Guard: ${context.qaTags.join(', ')} / ${context.guard}`);
        } else {
            lines.push(`• Guard: ${context.guard}`);
        }
        
        if (context.reasonCodes.length > 0) {
            lines.push(`• Nedenler: ${context.reasonCodes.slice(0, 3).join(', ')}`);
        }

        return lines.join('\n');
    }

    /**
     * 🎛️ Generate prompt options
     */
    generatePromptOptions(context) {
        const options = [
            { id: 'opt-1', label: 'Uygula', actionHint: 'commit_plan' }
        ];

        // Add quantity reduction option if qty is high
        if (context.riskUnitUSD > 500) {
            options.push({ id: 'opt-2', label: 'Miktarı %25 azalt', actionHint: 'revise_qty' });
        }

        options.push({ id: 'opt-3', label: 'İptal', actionHint: 'abort' });

        return options;
    }

    /**
     * 💬 Handle operator response
     */
    async handleOperatorResponse(data) {
        try {
            const validated = OperatorResponseSchema.parse(data);
            
            // Find corresponding prompt
            const promptData = this.state.openPrompts.get(validated.promptId);
            if (!promptData) {
                this.logger.error(`Prompt not found: ${validated.promptId}`);
                return;
            }

            // Check expiration
            if (new Date() > promptData.expiresAt) {
                this.logger.error(`Prompt expired: ${validated.promptId}`);
                await this.handleTimeout(validated.promptId);
                return;
            }

            // Verify auth (simplified for now)
            if (this.config.security.verifyOperatorAuth && !validated.auth.sig) {
                this.logger.error(`Auth verification failed for prompt: ${validated.promptId}`);
                
                eventBus.publishEvent('dialog.alert', {
                    event: 'dialog.alert',
                    timestamp: new Date().toISOString(),
                    level: 'error',
                    message: 'auth_failed',
                    context: { promptId: validated.promptId }
                }, 'operatorDialogOrchestrator');
                return;
            }

            // Process decision
            await this.processOperatorDecision(validated, promptData);

        } catch (error) {
            this.logger.error('Operator response handling error:', error);
        }
    }

    /**
     * 🎯 Process operator decision
     */
    async processOperatorDecision(response, promptData) {
        const { promptId, decisionId, payload } = response;
        const { correlationId, context } = promptData;

        let accepted = false;
        let rationale = '';

        switch (decisionId) {
            case 'opt-1': // Uygula
                accepted = true;
                rationale = 'Operatör onayladı';
                break;
                
            case 'opt-2': // Miktarı %25 azalt
                accepted = true;
                rationale = 'Miktar %25 azaltılarak onaylandı';
                // Here you would also emit a quantity revision event
                break;
                
            case 'opt-3': // İptal
                accepted = false;
                rationale = 'Operatör iptal etti';
                break;
                
            default:
                if (payload?.note) {
                    accepted = true;
                    rationale = `Özel not: ${payload.note}`;
                } else {
                    accepted = false;
                    rationale = 'Bilinmeyen karar';
                }
        }

        await this.emitFinalDecision(correlationId, decisionId, accepted, rationale);
        
        // Clean up
        this.state.openPrompts.delete(promptId);
        
        // Update stats
        if (accepted) {
            this.state.stats.accepts++;
        } else {
            this.state.stats.rejects++;
        }

        this.logger.info(`Operator decision processed: ${promptId} → ${accepted ? 'ACCEPTED' : 'REJECTED'}`);
    }

    /**
     * ⏰ Handle timeout
     */
    async handleTimeout(promptId) {
        const promptData = this.state.openPrompts.get(promptId);
        if (!promptData) return;

        const { correlationId } = promptData;

        // Conservative fallback
        await this.emitFinalDecision(correlationId, 'timeout', false, 'Zaman aşımı nedeniyle reddedildi');
        
        // Clean up
        this.state.openPrompts.delete(promptId);
        this.state.stats.timeouts++;

        // Emit alert
        eventBus.publishEvent('dialog.alert', {
            event: 'dialog.alert',
            timestamp: new Date().toISOString(),
            level: 'info',
            message: 'timeout → conservative fallback',
            context: { promptId }
        }, 'operatorDialogOrchestrator');

        this.logger.info(`Prompt timeout handled: ${promptId}`);
    }

    /**
     * 📤 Emit final decision
     */
    async emitFinalDecision(correlationId, decisionId, accepted, rationale) {
        const now = new Date();
        const ttlSec = 120;

        const decision = {
            event: 'operator.decision.final',
            timestamp: now.toISOString(),
            promptId: correlationId,
            decisionId,
            accepted,
            rationale,
            ttlSec,
            context: {
                correlationId,
                symbol: this.currentContext.playbookChoice?.symbol || 'UNKNOWN'
            },
            audit: {
                eventId: `audit-${Date.now()}`,
                producedBy: 'livia-01',
                producedAt: now.toISOString()
            }
        };

        // Store decision
        this.state.lastDecisionByCorrelationId.set(correlationId, decision);

        // Emit decision
        eventBus.publishEvent('operator.decision.final', decision, 'operatorDialogOrchestrator');
        
        this.logger.info(`Final decision emitted: ${correlationId} → ${accepted ? 'ACCEPTED' : 'REJECTED'}`);
    }

    /**
     * ⏱️ Start timeout handler
     */
    startTimeoutHandler() {
        setInterval(() => {
            const now = new Date();
            
            for (const [promptId, promptData] of this.state.openPrompts.entries()) {
                if (now > promptData.expiresAt) {
                    this.handleTimeout(promptId);
                }
            }
        }, 5000); // Check every 5 seconds
    }

    /**
     * 📊 Get system status
     */
    getStatus() {
        return {
            name: this.name,
            initialized: this.isInitialized,
            openPrompts: this.state.openPrompts.size,
            stats: { ...this.state.stats },
            contextData: {
                hasPlaybook: !!this.currentContext.playbookChoice,
                hasPosition: !!this.currentContext.positionSuggestion,
                hasVariant: !!this.currentContext.variantSuggestion,
                hasGuard: !!this.currentContext.guardDirective
            }
        };
    }

    /**
     * 🛑 Shutdown
     */
    async shutdown() {
        try {
            this.logger.info(`${this.name} kapatılıyor...`);
            
            // Cancel open prompts
            for (const [promptId, promptData] of this.state.openPrompts.entries()) {
                await this.handleTimeout(promptId);
            }
            
            this.isInitialized = false;
            this.logger.info(`${this.name} başarıyla kapatıldı`);
        } catch (error) {
            this.logger.error(`${this.name} kapatma hatası:`, error);
        }
    }
}

module.exports = {
    OperatorDialogOrchestrator,
    operatorDialogOrchestrator: new OperatorDialogOrchestrator()
};