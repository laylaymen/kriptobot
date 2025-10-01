/**
 * LIVIA-08 · decisionRationaleWriter.js
 * Karar gerekçe yazıcısı - Verilen/çekilen kararlar için denetlenebilir kısa gerekçe üretir
 * 
 * Amaç: "kim, neyi, neden, hangi koşullarda" özetini tek kart ve audit-ready JSON olarak yayınla.
 * Kaynaklar: Orchestrator promptu, Guard Q&A, Bounds kontroller, Policy açıklayıcı, Onay kapısı
 */

const { z } = require('zod');
const { createHash } = require('crypto');
const { eventBus } = require('../modularEventStream');
const { logInfo, logError, logEvent } = require('../../logs/logger');

/**
 * 🔄 Input Event Schemas
 */
const OperatorPromptOutSchema = z.object({
    event: z.literal('operator.prompt.out'),
    timestamp: z.string(),
    promptId: z.string(),
    title: z.string(),
    context: z.object({
        symbol: z.string(),
        variant: z.string(),
        exec: z.string(),
        qty: z.number(),
        riskUnitUSD: z.number().optional()
    })
});

const GuardQuestionResultSchema = z.object({
    event: z.literal('guard.question.result'),
    timestamp: z.string(),
    promptId: z.string(),
    ok: z.boolean(),
    reasons: z.array(z.string()).optional(),
    recommendation: z.object({
        action: z.enum(['proceed', 'revise', 'block']),
        params: z.record(z.any()).optional()
    }).optional()
});

const ConfirmationBoundsCheckSchema = z.object({
    event: z.literal('confirmation.bounds.check'),
    timestamp: z.string(),
    checkId: z.string(),
    symbol: z.string(),
    ok: z.boolean(),
    severity: z.enum(['soft', 'hard']).optional(),
    violations: z.array(z.object({
        code: z.string(),
        got: z.number(),
        limit: z.number()
    })).optional(),
    derived: z.object({
        rr: z.number().optional(),
        qtyUSD: z.number().optional()
    }).optional()
});

const PolicyExplainSchema = z.object({
    event: z.literal('policy.explain'),
    timestamp: z.string(),
    explainKey: z.string(),
    kind: z.string(),
    bullets: z.array(z.string()),
    citations: z.array(z.object({
        path: z.string(),
        version: z.string(),
        href: z.string()
    })).optional()
});

const OperatorDecisionFinalSchema = z.object({
    event: z.literal('operator.decision.final'),
    timestamp: z.string(),
    promptId: z.string(),
    decisionId: z.string(),
    accepted: z.boolean(),
    rationale: z.string().optional(),
    ttlSec: z.number().optional(),
    context: z.object({
        action: z.string(),
        symbol: z.string(),
        variant: z.string().optional(),
        exec: z.string().optional(),
        qty: z.number().optional()
    })
});

const ActionApprovedSchema = z.object({
    event: z.literal('action.approved'),
    timestamp: z.string(),
    approvalKey: z.string(),
    action: z.string(),
    payload: z.record(z.any()),
    by: z.array(z.object({
        userId: z.string(),
        roles: z.array(z.string()),
        ts: z.string()
    }))
});

const BiasWeightsSchema = z.object({
    event: z.literal('livia.bias.weights'),
    timestamp: z.string(),
    operatorId: z.string(),
    overconfidence: z.number().min(0).max(1),
    lossAversion: z.number().min(0).max(1),
    riskSeeking: z.number().min(0).max(1),
    confidence0to1: z.number().min(0).max(1)
});

/**
 * 📤 Output Event Schemas
 */
const DecisionRationaleSchema = z.object({
    event: z.literal('decision.rationale'),
    timestamp: z.string(),
    decisionKey: z.string(),
    promptId: z.string(),
    decisionId: z.string(),
    accepted: z.boolean(),
    summary: z.string().max(400),
    details: z.object({
        finalPlan: z.object({
            symbol: z.string(),
            variant: z.string().optional(),
            exec: z.string().optional(),
            qty: z.number().optional(),
            rr: z.number().optional()
        }),
        why: z.array(z.string()),
        notes: z.array(z.string()).optional()
    }),
    sources: z.array(z.object({
        ref: z.string(),
        id: z.string()
    })),
    citations: z.array(z.object({
        path: z.string(),
        version: z.string(),
        href: z.string()
    })).optional(),
    biasContext: z.object({
        overconfidence: z.number(),
        lossAversion: z.number(),
        riskSeeking: z.number(),
        confidence: z.number()
    }).optional(),
    audit: z.object({
        eventId: z.string(),
        prevEventIdHash: z.string().optional(),
        producedBy: z.string(),
        producedAt: z.string()
    })
});

const DecisionRationaleCardSchema = z.object({
    event: z.literal('decision.rationale.card'),
    timestamp: z.string(),
    title: z.string(),
    body: z.string().max(280),
    links: z.array(z.object({
        label: z.string(),
        href: z.string()
    })).optional(),
    ttlSec: z.number().optional(),
    severity: z.enum(['info', 'warn', 'error']).optional()
});

const DecisionRationaleMetricsSchema = z.object({
    event: z.literal('decision.rationale.metrics'),
    timestamp: z.string(),
    emitted: z.number(),
    avgComposeMs: z.number(),
    withCitationsRate: z.number().min(0).max(1),
    byOutcome: z.record(z.number())
});

/**
 * 📝 Text Template Engine
 */
class TextTemplateEngine {
    constructor(config) {
        this.config = config;
        this.violationTemplates = {
            expected_slip_gt_max: 'Slip p95 ${got}>${limit} bps.',
            spread_gt_max: 'Spread ${got}>${limit} bps.',
            min_rr_not_met: 'RR ${got}<${limit}.',
            qty_usd_gt_max: 'Miktar ${gotUSD}$>${limitUSD}$.',
            leverage_gt_max: 'Kaldıraç ${lev}>${maxLev}.'
        };
        
        this.guardTemplates = {
            slowdown: 'Guard=slowdown: agresif kısıtları etkin.',
            block_aggressive: 'Guard=block_aggressive: agresif kapalı.',
            halt_entry: 'Guard=halt_entry: giriş yok.'
        };
        
        this.outcomeTemplates = {
            accepted: 'PLAN ONAY',
            rejected: 'PLAN RED',
            fallback: 'PLAN FALLBACK'
        };
    }

    /**
     * Generate summary text
     */
    generateSummary(decision, context) {
        const outcome = this.outcomeTemplates[decision.accepted ? 'accepted' : 'rejected'];
        let summary = `${outcome}: `;

        // Add execution details
        if (decision.context.exec && decision.context.qty) {
            const execName = decision.context.exec.toUpperCase();
            summary += `${execName}`;
            
            if (context.qtyFactor && context.qtyFactor !== 1) {
                const pct = Math.round((context.qtyFactor - 1) * 100);
                summary += ` + qty ${pct > 0 ? '+' : ''}${pct}%`;
            }
            summary += '. ';
        }

        // Add violation details
        if (context.violations && context.violations.length > 0) {
            const mainViolation = context.violations[0];
            const template = this.violationTemplates[mainViolation.code];
            if (template) {
                summary += this.interpolateTemplate(template, mainViolation);
                summary += ' ';
            }
        }

        // Add solution
        if (context.recommendation?.action === 'revise') {
            const params = context.recommendation.params || {};
            if (params.exec) {
                summary += `${params.exec.toUpperCase()}`;
                if (params.qtyFactor) {
                    const pct = Math.round((params.qtyFactor - 1) * 100);
                    summary += ` + miktar ${pct}%`;
                }
                summary += ' ile maliyet düşürme';
            }
        }

        // Add RR if available
        if (context.derived?.rr) {
            summary += `; RR≈${context.derived.rr.toFixed(2)} uygun`;
        }

        summary += '.';

        return this.truncateText(summary, this.config.style.maxSummaryChars);
    }

    /**
     * Generate why array
     */
    generateWhy(context) {
        const why = [];

        // Hard violations first
        if (context.violations) {
            const hardViolations = context.violations.filter(v => context.severity === 'hard');
            const softViolations = context.violations.filter(v => context.severity !== 'hard');
            
            [...hardViolations, ...softViolations].slice(0, 2).forEach(violation => {
                const template = this.violationTemplates[violation.code];
                if (template) {
                    why.push(`Bounds: ${this.interpolateTemplate(template, violation)}`);
                }
            });
        }

        // Guard restrictions
        if (context.guardMode && context.guardMode !== 'normal') {
            const template = this.guardTemplates[context.guardMode];
            if (template) {
                why.push(`Guard: ${template}`);
            }
        }

        // GQE recommendation
        if (context.recommendation) {
            let recText = `GQE: ${context.recommendation.action}`;
            if (context.recommendation.params) {
                const params = context.recommendation.params;
                const paramParts = [];
                if (params.exec) paramParts.push(`exec=${params.exec}`);
                if (params.qtyFactor) paramParts.push(`qty×${params.qtyFactor}`);
                if (params.slices) paramParts.push(`slices=${params.slices}`);
                if (paramParts.length > 0) {
                    recText += ` → ${paramParts.join(', ')}`;
                }
            }
            why.push(recText);
        }

        // Policy reference
        if (context.policyVersion) {
            why.push(`Policy ${context.policyVersion}: limits/variants`);
        }

        return why.slice(0, this.config.style.bulletsMax || 3);
    }

    /**
     * Generate card title
     */
    generateCardTitle(decision, context) {
        if (!decision.accepted) {
            return 'Plan reddi — Neden geçmedi?';
        }

        const execName = decision.context.exec?.toUpperCase();
        const hasQtyChange = context.qtyFactor && context.qtyFactor !== 1;
        
        if (execName && hasQtyChange) {
            const pct = Math.round((context.qtyFactor - 1) * 100);
            return `Neden ${execName} + miktar ${pct}%?`;
        } else if (execName) {
            return `Neden ${execName}?`;
        }

        return 'Neden bu plan?';
    }

    /**
     * Generate card body
     */
    generateCardBody(decision, context) {
        let body = '';

        // Main violation
        if (context.violations && context.violations.length > 0) {
            const mainViolation = context.violations[0];
            const template = this.violationTemplates[mainViolation.code];
            if (template) {
                body += this.interpolateTemplate(template, mainViolation) + ' ';
            }
        }

        // Solution
        if (context.recommendation?.action === 'revise') {
            const params = context.recommendation.params || {};
            if (params.exec) {
                body += `${params.exec.toUpperCase()}`;
                if (params.qtyFactor) {
                    body += ` + parçalama`;
                }
                body += ' ile maliyet azaltıldı';
            }
        }

        // RR status
        if (context.derived?.rr) {
            body += `; RR≈${context.derived.rr.toFixed(2)} uygun`;
        }

        body += '.';

        return this.truncateText(body, this.config.style.maxCardChars);
    }

    /**
     * Interpolate template with values
     */
    interpolateTemplate(template, values) {
        return template.replace(/\$\{(\w+)\}/g, (match, key) => {
            return values[key] !== undefined ? values[key] : match;
        });
    }

    /**
     * Truncate text at sentence boundary
     */
    truncateText(text, maxChars) {
        if (text.length <= maxChars) {
            return text;
        }

        const truncated = text.substring(0, maxChars);
        const lastSentence = truncated.lastIndexOf('.');
        
        if (lastSentence > maxChars * 0.7) {
            return truncated.substring(0, lastSentence + 1);
        }
        
        return truncated + '...';
    }
}

/**
 * 📊 Source Collector
 */
class SourceCollector {
    constructor(config) {
        this.config = config;
        this.collectWindowSec = 60; // 60 seconds
    }

    /**
     * Collect related events for a prompt/decision
     */
    collectSources(promptId, decisionTimestamp, events) {
        const windowStart = new Date(decisionTimestamp).getTime() - (this.collectWindowSec * 1000);
        const windowEnd = new Date(decisionTimestamp).getTime();

        const sources = {};
        const context = {};

        for (const event of events) {
            const eventTime = new Date(event.timestamp).getTime();
            
            // Check if event is within time window
            if (eventTime < windowStart || eventTime > windowEnd) {
                continue;
            }

            // Check if event relates to this prompt
            if (event.promptId && event.promptId !== promptId) {
                continue;
            }

            // Collect by event type
            switch (event.event) {
                case 'operator.prompt.out':
                    sources.prompt = event;
                    context.title = event.title;
                    break;
                    
                case 'guard.question.result':
                    sources.guard = event;
                    context.recommendation = event.recommendation;
                    break;
                    
                case 'confirmation.bounds.check':
                    sources.bounds = event;
                    context.violations = event.violations;
                    context.severity = event.severity;
                    context.derived = event.derived;
                    break;
                    
                case 'policy.explain':
                    sources.policy = event;
                    context.policyBullets = event.bullets;
                    context.policyCitations = event.citations;
                    break;
                    
                case 'action.approved':
                case 'action.rejected':
                    sources.approval = event;
                    context.approvalStatus = event.event;
                    break;
                    
                case 'livia.bias.weights':
                    sources.bias = event;
                    context.biasWeights = {
                        overconfidence: event.overconfidence,
                        lossAversion: event.lossAversion,
                        riskSeeking: event.riskSeeking,
                        confidence: event.confidence0to1
                    };
                    break;
            }
        }

        return { sources, context };
    }

    /**
     * Extract qty factor from guard recommendation
     */
    extractQtyFactor(context) {
        if (context.recommendation?.params?.qtyFactor) {
            return context.recommendation.params.qtyFactor;
        }
        return 1;
    }

    /**
     * Extract policy version from context
     */
    extractPolicyVersion(context) {
        if (context.policyCitations && context.policyCitations.length > 0) {
            return context.policyCitations[0].version;
        }
        return null;
    }
}

/**
 * 🔗 Hash Chain Manager
 */
class HashChainManager {
    constructor() {
        this.lastEventIdHash = null;
    }

    /**
     * Generate event ID hash
     */
    generateEventIdHash(eventId) {
        return createHash('sha256').update(eventId).digest('hex').substring(0, 16);
    }

    /**
     * Get previous hash for chaining
     */
    getPrevHash() {
        return this.lastEventIdHash;
    }

    /**
     * Update chain with new hash
     */
    updateChain(eventId) {
        this.lastEventIdHash = this.generateEventIdHash(eventId);
    }
}

/**
 * 🎯 LIVIA-08 Decision Rationale Writer Class
 */
class DecisionRationaleWriter {
    constructor(config = {}) {
        this.name = 'DecisionRationaleWriter';
        this.config = {
            i18n: { locale: 'tr-TR', tz: 'Europe/Istanbul' },
            style: {
                maxSummaryChars: 400,
                maxCardChars: 280,
                bulletsMax: 3,
                includeNumbers: true,
                includeBiasContext: true,
                redactPII: true
            },
            mapping: {
                violations: {
                    expected_slip_gt_max: 'Slip p95 ${got}>${limit} bps.',
                    spread_gt_max: 'Spread ${got}>${limit} bps.',
                    min_rr_not_met: 'RR ${got}<${limit}.'
                },
                guards: {
                    slowdown: 'Guard=slowdown: agresif kısıtları etkin.',
                    block_aggressive: 'Guard=block_aggressive: agresif kapalı.',
                    halt_entry: 'Guard=halt_entry: giriş yok.'
                },
                outcomes: {
                    accepted: 'PLAN ONAY',
                    rejected: 'PLAN RED',
                    fallback: 'PLAN FALLBACK'
                }
            },
            chain: { includePrevHash: true },
            idempotencyTtlSec: 900,
            ...config
        };

        // State management
        this.state = {
            recentEvents: [], // Last 100 events for source collection
            idempotencyCache: new Map(), // decisionKey -> timestamp
            stats: {
                emitted: 0,
                avgComposeMs: 0,
                totalComposeMs: 0,
                withCitationsRate: 0,
                citationCount: 0,
                byOutcome: new Map()
            }
        };

        // Helper classes
        this.templateEngine = new TextTemplateEngine(this.config);
        this.sourceCollector = new SourceCollector(this.config);
        this.hashChain = new HashChainManager();

        this.isInitialized = false;
        this.logger = null;
    }

    /**
     * 🚀 Initialize the writer
     */
    async initialize(logger) {
        try {
            this.logger = logger;
            this.logger.info(`${this.name} başlatılıyor...`);

            this.setupEventListeners();
            this.startPeriodicTasks();

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
        // Track all relevant events for source collection
        const relevantEvents = [
            'operator.prompt.out',
            'guard.question.result',
            'confirmation.bounds.check',
            'policy.explain',
            'action.approved',
            'action.rejected',
            'livia.bias.weights'
        ];

        relevantEvents.forEach(eventType => {
            eventBus.subscribeToEvent(eventType, (event) => {
                this.trackEvent(event.data);
            }, 'decisionRationaleWriter');
        });

        // Main trigger: operator.decision.final
        eventBus.subscribeToEvent('operator.decision.final', (event) => {
            this.handleDecisionFinal(event.data);
        }, 'decisionRationaleWriter');
    }

    /**
     * 📝 Track events for source collection
     */
    trackEvent(event) {
        this.state.recentEvents.push(event);
        
        // Keep only last 100 events
        if (this.state.recentEvents.length > 100) {
            this.state.recentEvents.shift();
        }
    }

    /**
     * 🎯 Handle decision final event
     */
    async handleDecisionFinal(data) {
        const startTime = Date.now();
        
        try {
            const decision = OperatorDecisionFinalSchema.parse(data);
            
            // Generate decision key for idempotency
            const decisionKey = this.generateDecisionKey(decision);
            
            // Check idempotency
            if (this.state.idempotencyCache.has(decisionKey)) {
                this.logger.info(`Skipping duplicate decision: ${decisionKey}`);
                return;
            }

            // Collect sources and context
            const { sources, context } = this.sourceCollector.collectSources(
                decision.promptId,
                decision.timestamp,
                this.state.recentEvents
            );

            // Add qty factor from context
            context.qtyFactor = this.sourceCollector.extractQtyFactor(context);
            context.policyVersion = this.sourceCollector.extractPolicyVersion(context);

            // Process decision
            const result = await this.processDecision(decision, sources, context, decisionKey);
            
            // Mark as processed
            this.state.idempotencyCache.set(decisionKey, Date.now());

            // Update stats
            const composeTime = Date.now() - startTime;
            this.updateStats(composeTime, result);

        } catch (error) {
            this.logger.error('Decision final processing error:', error);
            await this.emitAlert('error', 'Decision processing failed', { error: error.message });
        }
    }

    /**
     * ⚙️ Process decision and generate rationale
     */
    async processDecision(decision, sources, context, decisionKey) {
        const now = new Date();
        
        // Generate summary
        const summary = this.templateEngine.generateSummary(decision, context);
        
        // Generate details
        const finalPlan = {
            symbol: decision.context.symbol,
            variant: decision.context.variant,
            exec: decision.context.exec,
            qty: decision.context.qty
        };
        
        if (context.derived?.rr) {
            finalPlan.rr = context.derived.rr;
        }

        const why = this.templateEngine.generateWhy(context);
        const notes = decision.rationale ? [decision.rationale] : undefined;

        // Generate sources array
        const sourcesArray = this.buildSourcesArray(sources);
        
        // Extract citations
        const citations = context.policyCitations || [];

        // Bias context
        const biasContext = this.config.style.includeBiasContext ? context.biasWeights : undefined;

        // Generate audit info
        const eventId = `rationale-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
        const audit = {
            eventId,
            producedBy: 'livia-08',
            producedAt: now.toISOString()
        };

        if (this.config.chain.includePrevHash) {
            audit.prevEventIdHash = this.hashChain.getPrevHash();
        }

        // Build rationale
        const rationale = {
            event: 'decision.rationale',
            timestamp: now.toISOString(),
            decisionKey,
            promptId: decision.promptId,
            decisionId: decision.decisionId,
            accepted: decision.accepted,
            summary,
            details: {
                finalPlan,
                why,
                notes
            },
            sources: sourcesArray,
            citations: citations.length > 0 ? citations : undefined,
            biasContext,
            audit
        };

        // Emit rationale
        await this.emitRationale(rationale);

        // Generate and emit card if accepted
        if (decision.accepted) {
            await this.emitCard(decision, context, citations);
        }

        // Update hash chain
        this.hashChain.updateChain(eventId);

        return {
            hasCitations: citations.length > 0,
            outcome: decision.accepted ? 'accepted' : 'rejected'
        };
    }

    /**
     * 📋 Build sources array from collected sources
     */
    buildSourcesArray(sources) {
        const sourcesArray = [];
        
        if (sources.guard) {
            sourcesArray.push({
                ref: 'guard.question.result',
                id: sources.guard.promptId || 'unknown'
            });
        }
        
        if (sources.bounds) {
            sourcesArray.push({
                ref: 'confirmation.bounds.check',
                id: sources.bounds.checkId || 'unknown'
            });
        }
        
        if (sources.policy) {
            sourcesArray.push({
                ref: 'policy.explain',
                id: sources.policy.explainKey || 'unknown'
            });
        }
        
        if (sources.approval) {
            sourcesArray.push({
                ref: sources.approval.event,
                id: sources.approval.approvalKey || 'unknown'
            });
        }

        return sourcesArray;
    }

    /**
     * 🎯 Generate decision key for idempotency
     */
    generateDecisionKey(decision) {
        const keyData = {
            promptId: decision.promptId,
            decisionId: decision.decisionId,
            context: decision.context
        };
        
        const hash = createHash('md5').update(JSON.stringify(keyData)).digest('hex');
        return `dr#${decision.promptId}#${decision.decisionId}#${hash.substring(0, 4)}`;
    }

    /**
     * 📤 Emit rationale
     */
    async emitRationale(rationale) {
        try {
            const validated = DecisionRationaleSchema.parse(rationale);
            eventBus.publishEvent('decision.rationale', validated, 'decisionRationaleWriter');
            
            this.logger.info(`Decision rationale: ${rationale.decisionKey} ${rationale.accepted ? 'accepted' : 'rejected'}`);
        } catch (error) {
            this.logger.error('Rationale emission error:', error);
        }
    }

    /**
     * 🎴 Emit card for UI
     */
    async emitCard(decision, context, citations) {
        const title = this.templateEngine.generateCardTitle(decision, context);
        const body = this.templateEngine.generateCardBody(decision, context);
        
        const links = citations.length > 0 ? 
            citations.slice(0, 1).map(c => ({
                label: `Policy ${c.version} – ${c.path}`,
                href: c.href
            })) : 
            undefined;

        const card = {
            event: 'decision.rationale.card',
            timestamp: new Date().toISOString(),
            title,
            body,
            links,
            ttlSec: 180,
            severity: decision.accepted ? 'info' : 'warn'
        };

        try {
            const validated = DecisionRationaleCardSchema.parse(card);
            eventBus.publishEvent('decision.rationale.card', validated, 'decisionRationaleWriter');
            
            this.logger.info(`Decision card: ${title}`);
        } catch (error) {
            this.logger.error('Card emission error:', error);
        }
    }

    /**
     * 🚨 Emit alert
     */
    async emitAlert(level, message, context = {}) {
        const alert = {
            event: 'decision.rationale.alert',
            timestamp: new Date().toISOString(),
            level,
            message,
            context
        };

        eventBus.publishEvent('decision.rationale.alert', alert, 'decisionRationaleWriter');
        this.logger.info(`Decision rationale alert: ${level} - ${message}`);
    }

    /**
     * 📊 Update statistics
     */
    updateStats(composeTimeMs, result) {
        this.state.stats.emitted++;
        this.state.stats.totalComposeMs += composeTimeMs;
        this.state.stats.avgComposeMs = this.state.stats.totalComposeMs / this.state.stats.emitted;
        
        if (result.hasCitations) {
            this.state.stats.citationCount++;
        }
        
        this.state.stats.withCitationsRate = this.state.stats.citationCount / this.state.stats.emitted;
        
        // Update outcome stats
        const current = this.state.stats.byOutcome.get(result.outcome) || 0;
        this.state.stats.byOutcome.set(result.outcome, current + 1);
    }

    /**
     * ⏱️ Start periodic tasks
     */
    startPeriodicTasks() {
        // Clean idempotency cache every 5 minutes
        setInterval(() => {
            this.cleanupIdempotency();
        }, 300000);

        // Emit metrics every 30 seconds
        setInterval(() => {
            this.emitMetrics();
        }, 30000);
    }

    /**
     * 🧹 Cleanup idempotency cache
     */
    cleanupIdempotency() {
        const now = Date.now();
        const ttlMs = this.config.idempotencyTtlSec * 1000;
        let cleaned = 0;

        for (const [key, timestamp] of this.state.idempotencyCache.entries()) {
            if (now - timestamp > ttlMs) {
                this.state.idempotencyCache.delete(key);
                cleaned++;
            }
        }

        if (cleaned > 0) {
            this.logger.info(`Cleaned ${cleaned} idempotency entries`);
        }
    }

    /**
     * 📊 Emit metrics
     */
    emitMetrics() {
        const byOutcome = {};
        for (const [outcome, count] of this.state.stats.byOutcome.entries()) {
            byOutcome[outcome] = count;
        }

        const metrics = {
            event: 'decision.rationale.metrics',
            timestamp: new Date().toISOString(),
            emitted: this.state.stats.emitted,
            avgComposeMs: Math.round(this.state.stats.avgComposeMs),
            withCitationsRate: Number(this.state.stats.withCitationsRate.toFixed(3)),
            byOutcome
        };

        try {
            const validated = DecisionRationaleMetricsSchema.parse(metrics);
            eventBus.publishEvent('decision.rationale.metrics', validated, 'decisionRationaleWriter');
        } catch (error) {
            this.logger.error('Metrics emission error:', error);
        }
    }

    /**
     * 📊 Get system status
     */
    getStatus() {
        return {
            name: this.name,
            initialized: this.isInitialized,
            recentEvents: this.state.recentEvents.length,
            idempotencyCache: this.state.idempotencyCache.size,
            stats: { ...this.state.stats },
            lastEventHash: this.hashChain.lastEventIdHash
        };
    }

    /**
     * 🛑 Shutdown
     */
    async shutdown() {
        try {
            this.logger.info(`${this.name} kapatılıyor...`);
            
            // Clear caches
            this.state.recentEvents.length = 0;
            this.state.idempotencyCache.clear();
            this.state.stats.byOutcome.clear();
            
            this.isInitialized = false;
            this.logger.info(`${this.name} başarıyla kapatıldı`);
        } catch (error) {
            this.logger.error(`${this.name} kapatma hatası:`, error);
        }
    }
}

module.exports = {
    DecisionRationaleWriter,
    decisionRationaleWriter: new DecisionRationaleWriter(),
    TextTemplateEngine,
    SourceCollector,
    HashChainManager
};