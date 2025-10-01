/**
 * LIVIA-02 · guardQuestionEngine.ts
 * Risk yüksekken hedefli, kısa ve net sorular üretme sistemi
 * 
 * Amaç: Operasyonel risk/belirsizlik yüksekken operatörden net onay almak
 * Örnekler: highVol, degraded, failover, aggressive giriş, büyük qty, yüksek slip/spread
 */

const { z } = require('zod');
const { eventBus } = require('../modularEventStream');
const { logInfo, logError, logEvent } = require('../../logs/logger');

/**
 * 🔄 Input Event Schemas
 */
const OperatorDecisionContextSchema = z.object({
    event: z.literal('operator.decision.context'),
    timestamp: z.string(),
    promptId: z.string(),
    correlationId: z.string(),
    symbol: z.string(),
    variant: z.enum(['base', 'aggressive', 'conservative']),
    exec: z.enum(['market', 'limit', 'twap', 'iceberg']),
    qty: z.number(),
    riskUnitUSD: z.number(),
    slBps: z.number().optional(),
    tpBps: z.number().optional()
});

const GuardDirectiveSchema = z.object({
    event: z.string(),
    timestamp: z.string(),
    mode: z.enum(['normal', 'degraded', 'streams_panic', 'halt_entry', 'slowdown', 'block_aggressive']),
    expiresAt: z.string(),
    reasonCodes: z.array(z.string()).optional()
});

const MarketVolatilitySchema = z.object({
    event: z.literal('market.volatility.snapshot'),
    timestamp: z.string(),
    symbol: z.string(),
    atrBps: z.number(),
    spreadBps: z.number()
});

const OperatorAnswerSchema = z.object({
    event: z.literal('operator.answer.in'),
    timestamp: z.string(),
    qId: z.string(),
    answer: z.enum(['yes', 'no', 'value', 'option']),
    value: z.number().optional(),
    unit: z.enum(['bps', 'qty', 'bool', 'null']).optional(),
    auth: z.object({
        sig: z.string(),
        userId: z.string()
    })
});

/**
 * 📤 Output Event Schemas
 */
const OperatorQuestionSchema = z.object({
    event: z.literal('operator.question.out'),
    timestamp: z.string(),
    qId: z.string(),
    promptId: z.string(),
    title: z.string(),
    text: z.string(),
    kind: z.enum(['confirm', 'numerical', 'choice']),
    expected: z.enum(['yes', 'no', 'value', 'option']),
    constraints: z.object({
        min: z.number().optional(),
        max: z.number().optional(),
        step: z.number().optional(),
        unit: z.string().optional()
    }).optional(),
    options: z.array(z.object({
        id: z.string(),
        label: z.string()
    })).optional(),
    ttlSec: z.number(),
    context: z.object({
        symbol: z.string(),
        mode: z.string(),
        atrBps: z.number().optional(),
        spreadBps: z.number().optional()
    }),
    audit: z.object({
        eventId: z.string(),
        producedBy: z.string(),
        producedAt: z.string()
    })
});

const GuardQuestionResultSchema = z.object({
    event: z.literal('guard.question.result'),
    timestamp: z.string(),
    qId: z.string(),
    promptId: z.string(),
    ok: z.boolean(),
    reasons: z.array(z.string()),
    recommendation: z.object({
        action: z.enum(['block', 'revise', 'proceed']),
        params: z.object({
            qtyFactor: z.number().optional(),
            exec: z.string().optional(),
            slipBps: z.number().optional()
        }).optional()
    }),
    audit: z.object({
        eventId: z.string(),
        producedBy: z.string(),
        producedAt: z.string()
    })
});

/**
 * 🎯 LIVIA-02 Guard Question Engine Class
 */
class GuardQuestionEngine {
    constructor(config = {}) {
        this.name = 'GuardQuestionEngine';
        this.config = {
            i18n: { locale: 'tr-TR', tz: 'Europe/Istanbul' },
            
            // Belirsizlik puanı hesaplama ağırlıkları
            scoring: {
                weights: {
                    guardMode: 0.25,
                    vol: 0.20,
                    slipRisk: 0.20,
                    operatorScore: 0.15,
                    bias: 0.10,
                    correlation: 0.10
                },
                askThreshold: 0.40,
                hardBlockThreshold: 0.85
            },

            // Soru playbook'ları
            playbooks: {
                highVol: [
                    { 
                        kind: 'confirm', 
                        text: 'Volatilite yüksek. Agresif girişi geçici olarak devre dışı bırakmayı kabul ediyor musun?', 
                        expect: 'yes' 
                    },
                    { 
                        kind: 'choice', 
                        text: 'Yürütme tarzını seç: TWAP mı LIMIT mi?', 
                        expect: 'option', 
                        options: ['twap', 'limit'] 
                    }
                ],
                slipRisk: [
                    { 
                        kind: 'numerical', 
                        text: 'Slip toleransını bps cinsinden belirt (0–20).', 
                        expect: 'value', 
                        constraints: { min: 0, max: 20, step: 1, unit: 'bps' } 
                    }
                ],
                spreadWide: [
                    { 
                        kind: 'confirm', 
                        text: 'Spread geniş (~{spreadBps} bps). Devam etmek için LIMIT kullanmayı kabul ediyor musun?', 
                        expect: 'yes' 
                    }
                ],
                failover: [
                    { 
                        kind: 'confirm', 
                        text: 'Bağlantı bozuk (degraded). Failover önerisini onaylıyor musun?', 
                        expect: 'yes' 
                    }
                ],
                aggressive: [
                    { 
                        kind: 'confirm', 
                        text: 'Agresif varyant seçildi. Onaylıyor musun?', 
                        expect: 'yes' 
                    }
                ],
                qtyHigh: [
                    { 
                        kind: 'choice', 
                        text: 'Miktarı azaltalım mı?', 
                        expect: 'option', 
                        options: ['-25%', '-50%', 'Hayır'] 
                    }
                ]
            },

            rules: {
                blockOnNo: ['failover', 'aggressive'],
                numericalBounds: {
                    slipBps: { min: 0, max: 20 },
                    spreadBps: { min: 0, max: 120 },
                    qtyFactor: { min: 0.25, max: 1.0 }
                }
            },

            ttlSec: 90,
            idempotencyTtlSec: 300,
            ...config
        };

        // State management
        this.state = {
            openQuestions: new Map(),
            uncertaintyScores: new Map(),
            stats: { asked: 0, answered: 0, blocked: 0 }
        };

        // Context data
        this.currentContext = {
            decisionContext: null,
            guardDirective: null,
            marketVolatility: null,
            operatorScore: null,
            biasWeights: null,
            policySnapshot: null,
            qaTags: null
        };

        this.isInitialized = false;
        this.logger = null;
    }

    /**
     * 🚀 Initialize the engine
     */
    async initialize(logger) {
        try {
            this.logger = logger;
            this.logger.info(`${this.name} başlatılıyor...`);

            this.setupEventListeners();
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
     * 👂 Setup event listeners
     */
    setupEventListeners() {
        // Decision context trigger
        eventBus.subscribeToEvent('operator.decision.context', (event) => {
            this.handleDecisionContext(event.data);
        }, 'guardQuestionEngine');

        // Context building events
        eventBus.subscribeToEvent('sentry.guard.directive', (event) => {
            this.handleGuardDirective(event.data);
        }, 'guardQuestionEngine');

        eventBus.subscribeToEvent('latency_slip.guard.directive', (event) => {
            this.handleGuardDirective(event.data);
        }, 'guardQuestionEngine');

        eventBus.subscribeToEvent('market.volatility.snapshot', (event) => {
            this.handleMarketVolatility(event.data);
        }, 'guardQuestionEngine');

        eventBus.subscribeToEvent('operator.consistency.score', (event) => {
            this.handleOperatorScore(event.data);
        }, 'guardQuestionEngine');

        eventBus.subscribeToEvent('livia.bias.weights', (event) => {
            this.handleBiasWeights(event.data);
        }, 'guardQuestionEngine');

        eventBus.subscribeToEvent('policy.snapshot', (event) => {
            this.handlePolicySnapshot(event.data);
        }, 'guardQuestionEngine');

        eventBus.subscribeToEvent('qa.tags', (event) => {
            this.handleQaTags(event.data);
        }, 'guardQuestionEngine');

        // Operator answers
        eventBus.subscribeToEvent('operator.answer.in', (event) => {
            this.handleOperatorAnswer(event.data);
        }, 'guardQuestionEngine');
    }

    /**
     * 🎯 Handle decision context - main trigger
     */
    async handleDecisionContext(data) {
        try {
            const validated = OperatorDecisionContextSchema.parse(data);
            this.currentContext.decisionContext = validated;
            this.logger.info(`Decision context alındı: ${validated.symbol} ${validated.variant}/${validated.exec}`);
            
            // Process the decision context
            await this.processDecisionContext(validated);
        } catch (error) {
            this.logger.error('Decision context validation error:', error);
        }
    }

    /**
     * ⚡ Process decision context and determine if questions are needed
     */
    async processDecisionContext(context) {
        const { promptId, correlationId, symbol } = context;

        // Check idempotency
        if (this.state.openQuestions.has(promptId)) {
            this.logger.info(`Question already exists for prompt ${promptId}`);
            return;
        }

        // Calculate uncertainty score
        const uncertaintyScore = this.calculateUncertaintyScore(context);
        this.state.uncertaintyScores.set(promptId, uncertaintyScore);

        this.logger.info(`Uncertainty score for ${symbol}: ${uncertaintyScore.toFixed(3)}`);

        // Check if hard block
        if (uncertaintyScore >= this.config.scoring.hardBlockThreshold) {
            await this.emitHardBlock(promptId, correlationId, 'Yüksek risk seviyesi nedeniyle blok');
            return;
        }

        // Check if questions are needed
        if (uncertaintyScore >= this.config.scoring.askThreshold) {
            await this.planAndAskQuestions(context, uncertaintyScore);
        } else {
            await this.emitProceed(promptId, correlationId, 'Risk seviyesi uygun');
        }
    }

    /**
     * 📊 Calculate uncertainty score
     */
    calculateUncertaintyScore(context) {
        const weights = this.config.scoring.weights;
        let totalScore = 0;

        // Guard mode score
        const guardMode = this.currentContext.guardDirective?.mode || 'normal';
        const guardModeScore = this.getGuardModeScore(guardMode);
        totalScore += weights.guardMode * guardModeScore;

        // Volatility score
        const volScore = this.getVolatilityScore(context.symbol);
        totalScore += weights.vol * volScore;

        // Slip risk score
        const slipRiskScore = this.getSlipRiskScore();
        totalScore += weights.slipRisk * slipRiskScore;

        // Operator score adjustment
        const operatorScore = this.currentContext.operatorScore?.score0to1 || 0.5;
        const operatorScoreAdj = 1 - operatorScore;
        totalScore += weights.operatorScore * operatorScoreAdj;

        // Bias score
        const biasScore = this.getBiasScore();
        totalScore += weights.bias * biasScore;

        // Correlation score (simplified)
        const corrScore = 0; // Would be calculated from portfolio data
        totalScore += weights.correlation * corrScore;

        return Math.min(1, totalScore);
    }

    /**
     * 🛡️ Get guard mode score
     */
    getGuardModeScore(mode) {
        const scores = {
            'normal': 0.0,
            'slowdown': 0.4,
            'block_aggressive': 0.7,
            'halt_entry': 1.0,
            'degraded': 0.8,
            'streams_panic': 1.0
        };
        return scores[mode] || 0.5;
    }

    /**
     * 📈 Get volatility score
     */
    getVolatilityScore(symbol) {
        const volData = this.currentContext.marketVolatility;
        if (!volData || volData.symbol !== symbol) return 0.3;

        const atrNorm = Math.min(1, volData.atrBps / 100);
        const spreadNorm = Math.min(1, volData.spreadBps / 80);
        return (atrNorm + spreadNorm) / 2;
    }

    /**
     * 💨 Get slip risk score
     */
    getSlipRiskScore() {
        const guardMode = this.currentContext.guardDirective?.mode || 'normal';
        if (guardMode === 'slowdown' || guardMode === 'block_aggressive') {
            return 0.7;
        }
        return 0.2;
    }

    /**
     * 🧠 Get bias score
     */
    getBiasScore() {
        const biasWeights = this.currentContext.biasWeights;
        if (!biasWeights) return 0.5;

        const { overconfidence, riskSeeking } = biasWeights;
        return (overconfidence + riskSeeking) / 2;
    }

    /**
     * ❓ Plan and ask questions
     */
    async planAndAskQuestions(context, uncertaintyScore) {
        const questions = this.selectQuestions(context);
        
        if (questions.length === 0) {
            await this.emitProceed(context.promptId, context.correlationId, 'Ek soru gerekmiyor');
            return;
        }

        // Limit to max 2 questions
        const selectedQuestions = questions.slice(0, 2);
        
        // Start with first question
        await this.askQuestion(context, selectedQuestions[0], selectedQuestions);
    }

    /**
     * 🎯 Select appropriate questions based on context
     */
    selectQuestions(context) {
        const questions = [];
        const guardMode = this.currentContext.guardDirective?.mode || 'normal';
        const volData = this.currentContext.marketVolatility;
        const qaTags = this.currentContext.qaTags?.tags || [];

        // Priority order: guard > failover > spread > slip > aggressive > qty > highVol

        // Guard/slip questions
        if (guardMode === 'slowdown' || guardMode === 'block_aggressive') {
            questions.push(...this.config.playbooks.slipRisk);
        }

        // Failover questions
        if (guardMode === 'degraded' || guardMode === 'streams_panic') {
            questions.push(...this.config.playbooks.failover);
        }

        // Spread questions
        if (volData && volData.spreadBps > 80) {
            const spreadQuestion = this.config.playbooks.spreadWide[0];
            spreadQuestion.text = spreadQuestion.text.replace('{spreadBps}', volData.spreadBps);
            questions.push(spreadQuestion);
        }

        // Aggressive variant questions
        if (context.variant === 'aggressive') {
            questions.push(...this.config.playbooks.aggressive);
        }

        // Quantity questions
        if (context.riskUnitUSD > 1000) {
            questions.push(...this.config.playbooks.qtyHigh);
        }

        // High volatility questions
        if (qaTags.includes('highVol') || qaTags.includes('open-bar')) {
            questions.push(...this.config.playbooks.highVol);
        }

        return questions;
    }

    /**
     * ❓ Ask a specific question
     */
    async askQuestion(context, questionTemplate, remainingQuestions) {
        const qId = `q-${context.symbol.toLowerCase()}-${context.promptId}-${Date.now()}`;
        const now = new Date();
        const ttlSec = this.config.ttlSec;

        const question = {
            event: 'operator.question.out',
            timestamp: now.toISOString(),
            qId,
            promptId: context.promptId,
            title: this.getQuestionTitle(questionTemplate.kind),
            text: questionTemplate.text,
            kind: questionTemplate.kind,
            expected: questionTemplate.expect,
            constraints: questionTemplate.constraints,
            options: questionTemplate.options?.map((opt, idx) => ({
                id: `option-${idx}`,
                label: opt
            })),
            ttlSec,
            context: {
                symbol: context.symbol,
                mode: this.currentContext.guardDirective?.mode || 'normal',
                atrBps: this.currentContext.marketVolatility?.atrBps,
                spreadBps: this.currentContext.marketVolatility?.spreadBps
            },
            audit: {
                eventId: `audit-${Date.now()}`,
                producedBy: 'livia-02',
                producedAt: now.toISOString()
            }
        };

        // Store question state
        this.state.openQuestions.set(qId, {
            promptId: context.promptId,
            correlationId: context.correlationId,
            context,
            questionTemplate,
            remainingQuestions: remainingQuestions.slice(1),
            expiresAt: new Date(now.getTime() + ttlSec * 1000),
            createdAt: now
        });

        // Emit question
        eventBus.publishEvent('operator.question.out', question, 'guardQuestionEngine');
        
        this.state.stats.asked++;
        this.logger.info(`Question asked: ${qId} (${questionTemplate.kind})`);
    }

    /**
     * 📝 Get question title based on kind
     */
    getQuestionTitle(kind) {
        const titles = {
            'confirm': 'Onay Gerekli',
            'numerical': 'Değer Girişi',
            'choice': 'Seçim Yapın'
        };
        return titles[kind] || 'Soru';
    }

    /**
     * 💬 Handle operator answer
     */
    async handleOperatorAnswer(data) {
        try {
            const validated = OperatorAnswerSchema.parse(data);
            
            const questionData = this.state.openQuestions.get(validated.qId);
            if (!questionData) {
                this.logger.error(`Question not found: ${validated.qId}`);
                return;
            }

            // Check expiration
            if (new Date() > questionData.expiresAt) {
                await this.handleQuestionTimeout(validated.qId);
                return;
            }

            // Verify auth (simplified)
            if (!validated.auth.sig) {
                this.emitAlert('error', 'auth_failed', { qId: validated.qId });
                return;
            }

            // Validate answer
            const validation = this.validateAnswer(validated, questionData.questionTemplate);
            if (!validation.valid) {
                this.emitAlert('warn', 'invalid_answer', { 
                    qId: validated.qId, 
                    reason: validation.reason 
                });
                return;
            }

            // Process answer
            await this.processAnswer(validated, questionData);

        } catch (error) {
            this.logger.error('Operator answer handling error:', error);
        }
    }

    /**
     * ✅ Validate answer against constraints
     */
    validateAnswer(answer, questionTemplate) {
        const { kind, constraints } = questionTemplate;

        if (kind === 'numerical' && answer.answer === 'value') {
            if (!answer.value && answer.value !== 0) {
                return { valid: false, reason: 'missing_value' };
            }

            if (constraints) {
                if (constraints.min !== undefined && answer.value < constraints.min) {
                    return { valid: false, reason: 'below_minimum' };
                }
                if (constraints.max !== undefined && answer.value > constraints.max) {
                    return { valid: false, reason: 'above_maximum' };
                }
            }
        }

        return { valid: true };
    }

    /**
     * 🎯 Process valid answer
     */
    async processAnswer(answer, questionData) {
        const { qId } = answer;
        const { promptId, correlationId, questionTemplate, remainingQuestions } = questionData;

        // Score the answer
        const result = this.scoreAnswer(answer, questionTemplate);
        
        this.state.stats.answered++;
        this.logger.info(`Answer processed: ${qId} → ${result.ok ? 'OK' : 'BLOCK'}`);

        // Clean up current question
        this.state.openQuestions.delete(qId);

        // If answer indicates block, emit block result
        if (!result.ok) {
            await this.emitBlockResult(qId, promptId, correlationId, result.reasons, result.recommendation);
            this.state.stats.blocked++;
            return;
        }

        // If there are remaining questions, ask next one
        if (remainingQuestions.length > 0) {
            await this.askQuestion(questionData.context, remainingQuestions[0], remainingQuestions);
            return;
        }

        // All questions passed, emit proceed
        await this.emitProceedResult(qId, promptId, correlationId, result.recommendation);
    }

    /**
     * 📊 Score the answer and determine action
     */
    scoreAnswer(answer, questionTemplate) {
        const { kind } = questionTemplate;
        const blockOnNo = this.config.rules.blockOnNo;

        switch (kind) {
            case 'confirm':
                if (answer.answer === 'no') {
                    // Check if this question type should block on "no"
                    const shouldBlock = blockOnNo.some(type => 
                        questionTemplate.text.toLowerCase().includes(type)
                    );
                    
                    if (shouldBlock) {
                        return {
                            ok: false,
                            reasons: ['operator_declined'],
                            recommendation: { action: 'block' }
                        };
                    } else {
                        return {
                            ok: true,
                            reasons: ['operator_requested_modification'],
                            recommendation: { 
                                action: 'revise', 
                                params: { exec: 'limit' } 
                            }
                        };
                    }
                }
                break;

            case 'numerical':
                if (answer.answer === 'value') {
                    const bounds = this.config.rules.numericalBounds;
                    
                    // Example: slip tolerance
                    if (questionTemplate.text.includes('slip')) {
                        if (answer.value > 15) {
                            return {
                                ok: true,
                                reasons: ['high_slip_tolerance'],
                                recommendation: { 
                                    action: 'revise', 
                                    params: { exec: 'limit', slipBps: answer.value } 
                                }
                            };
                        }
                    }
                }
                break;

            case 'choice':
                if (answer.answer === 'option') {
                    // Handle quantity reduction choices
                    if (questionTemplate.text.includes('Miktarı')) {
                        const optionIndex = parseInt(answer.value) || 0;
                        const options = questionTemplate.options;
                        
                        if (options && options[optionIndex]) {
                            const choice = options[optionIndex];
                            
                            if (choice === '-25%') {
                                return {
                                    ok: true,
                                    reasons: ['quantity_reduction_requested'],
                                    recommendation: { 
                                        action: 'revise', 
                                        params: { qtyFactor: 0.75 } 
                                    }
                                };
                            } else if (choice === '-50%') {
                                return {
                                    ok: true,
                                    reasons: ['quantity_reduction_requested'],
                                    recommendation: { 
                                        action: 'revise', 
                                        params: { qtyFactor: 0.50 } 
                                    }
                                };
                            } else if (choice === 'Hayır') {
                                return {
                                    ok: true,
                                    reasons: ['no_quantity_change'],
                                    recommendation: { action: 'proceed' }
                                };
                            }
                        }
                    }
                }
                break;
        }

        // Default: proceed
        return {
            ok: true,
            reasons: ['operator_approved'],
            recommendation: { action: 'proceed' }
        };
    }

    /**
     * ⏰ Handle question timeout
     */
    async handleQuestionTimeout(qId) {
        const questionData = this.state.openQuestions.get(qId);
        if (!questionData) return;

        const { promptId, correlationId } = questionData;

        // Default to block on timeout
        await this.emitBlockResult(qId, promptId, correlationId, ['timeout'], { action: 'block' });
        
        this.state.openQuestions.delete(qId);
        this.state.stats.blocked++;

        this.emitAlert('info', 'timeout → conservative fallback', { qId });
        this.logger.info(`Question timeout: ${qId}`);
    }

    /**
     * 🚫 Emit hard block result
     */
    async emitHardBlock(promptId, correlationId, reason) {
        await this.emitBlockResult(`hard-block-${Date.now()}`, promptId, correlationId, ['hard_block'], { action: 'block' });
    }

    /**
     * 🚫 Emit block result
     */
    async emitBlockResult(qId, promptId, correlationId, reasons, recommendation) {
        const result = {
            event: 'guard.question.result',
            timestamp: new Date().toISOString(),
            qId,
            promptId,
            ok: false,
            reasons,
            recommendation,
            audit: {
                eventId: `audit-${Date.now()}`,
                producedBy: 'livia-02',
                producedAt: new Date().toISOString()
            }
        };

        eventBus.publishEvent('guard.question.result', result, 'guardQuestionEngine');
        this.logger.info(`Block result emitted: ${qId} → ${reasons.join(', ')}`);
    }

    /**
     * ✅ Emit proceed result
     */
    async emitProceed(promptId, correlationId, reason) {
        await this.emitProceedResult(`proceed-${Date.now()}`, promptId, correlationId, { action: 'proceed' });
    }

    /**
     * ✅ Emit proceed result
     */
    async emitProceedResult(qId, promptId, correlationId, recommendation) {
        const result = {
            event: 'guard.question.result',
            timestamp: new Date().toISOString(),
            qId,
            promptId,
            ok: true,
            reasons: ['approved'],
            recommendation,
            audit: {
                eventId: `audit-${Date.now()}`,
                producedBy: 'livia-02',
                producedAt: new Date().toISOString()
            }
        };

        eventBus.publishEvent('guard.question.result', result, 'guardQuestionEngine');
        this.logger.info(`Proceed result emitted: ${qId}`);
    }

    /**
     * 🚨 Emit alert
     */
    emitAlert(level, message, context) {
        const alert = {
            event: 'guard.question.alert',
            timestamp: new Date().toISOString(),
            level,
            message,
            context
        };

        eventBus.publishEvent('guard.question.alert', alert, 'guardQuestionEngine');
    }

    /**
     * 🔄 Handle context events
     */
    handleGuardDirective(data) {
        this.currentContext.guardDirective = data;
        this.logger.info(`Guard directive context: ${data.mode}`);
    }

    handleMarketVolatility(data) {
        this.currentContext.marketVolatility = data;
        this.logger.info(`Market volatility context: ${data.symbol} ATR=${data.atrBps}bps`);
    }

    handleOperatorScore(data) {
        this.currentContext.operatorScore = data;
        this.logger.info(`Operator score context: ${data.score0to1}`);
    }

    handleBiasWeights(data) {
        this.currentContext.biasWeights = data;
        this.logger.info(`Bias weights context updated`);
    }

    handlePolicySnapshot(data) {
        this.currentContext.policySnapshot = data;
        this.logger.info(`Policy snapshot context updated`);
    }

    handleQaTags(data) {
        this.currentContext.qaTags = data;
        this.logger.info(`QA tags context: ${data.tags?.join(', ')}`);
    }

    /**
     * ⏱️ Start timeout handler
     */
    startTimeoutHandler() {
        setInterval(() => {
            const now = new Date();
            
            for (const [qId, questionData] of this.state.openQuestions.entries()) {
                if (now > questionData.expiresAt) {
                    this.handleQuestionTimeout(qId);
                }
            }
        }, 5000);
    }

    /**
     * 📊 Get system status
     */
    getStatus() {
        return {
            name: this.name,
            initialized: this.isInitialized,
            openQuestions: this.state.openQuestions.size,
            stats: { ...this.state.stats },
            uncertaintyScores: Object.fromEntries(this.state.uncertaintyScores),
            contextData: {
                hasDecisionContext: !!this.currentContext.decisionContext,
                hasGuard: !!this.currentContext.guardDirective,
                hasVolatility: !!this.currentContext.marketVolatility,
                hasOperatorScore: !!this.currentContext.operatorScore
            }
        };
    }

    /**
     * 🛑 Shutdown
     */
    async shutdown() {
        try {
            this.logger.info(`${this.name} kapatılıyor...`);
            
            // Cancel open questions
            for (const [qId, questionData] of this.state.openQuestions.entries()) {
                await this.handleQuestionTimeout(qId);
            }
            
            this.isInitialized = false;
            this.logger.info(`${this.name} başarıyla kapatıldı`);
        } catch (error) {
            this.logger.error(`${this.name} kapatma hatası:`, error);
        }
    }
}

module.exports = {
    GuardQuestionEngine,
    guardQuestionEngine: new GuardQuestionEngine()
};