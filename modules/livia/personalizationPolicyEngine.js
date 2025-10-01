/**
 * LIVIA-59: Personalization Policy Engine
 * Kişiselleştirme politika motoru
 * Amaç: Tenant/rol/tier/bölge/dil bağlamına göre dinamik model/pipeline konfigürasyonu
 */

const crypto = require('crypto');
const { EventEmitter } = require('events');
const { trace, context, SpanStatusCode } = require('@opentelemetry/api');

class PersonalizationPolicyEngine extends EventEmitter {
    constructor(config = {}) {
        super();
        
        this.name = 'PersonalizationPolicyEngine';
        this.config = {
            enabled: true,
            locale: 'tr-TR',
            timezone: 'Europe/Istanbul',
            currency: 'USD',
            objectives: { quality: 0.5, latency: 0.25, cost: 0.25 },
            constraints: {
                latencyP95Ms: { max: 900, goldBonus: -100, bronzeRelax: +100 },
                costPerQueryUsd: { max: 0.015, bronzeHard: 0.008 },
                quality: { ndcg10Min: 0.50, mrr10Min: 0.55 }
            },
            fairness: {
                protectedAttributes: ['age', 'gender', 'religion', 'ethnicity'],
                noUse: true,
                proxyGuard: true,
                parityChecks: ['acceptRate', 'latencyP95', 'costUsd'],
                disparityTolerancePct: 10
            },
            segmentDSL: {
                ops: ['AND', 'OR', 'NOT'],
                fields: ['tier', 'region', 'locale', 'lang', 'channel', 'vertical', 'consent.personalization', 'doNotPersonalize'],
                comparators: ['>=', '=', 'in', 'matches']
            },
            defaults: {
                plan: 'P-vec-lite',
                reranker: 'ce-small',
                synthModel: 'gpt-m',
                caps: { 'kb.topK': 60, 'maxTokens': 700 },
                ui: { variant: 'default', locale: 'tr-TR', units: 'metric' }
            },
            dayparting: [
                { windowLocal: '09:00-18:00', boosts: { quality: +0.05 } },
                { windowLocal: '18:00-23:59', boosts: { latency: +0.05 } }
            ],
            ab: { enable: true, minSample: 500, guardrails: { p95MsMax: 950, costUsdMax: 0.016, ndcg10Min: 0.50 } },
            cache: { ttlSec: 900, keyBy: ['tenant', 'tier', 'region', 'locale', 'channel', 'policyHash'] },
            idempotencyTtlSec: 900,
            ...config
        };
        
        // State management
        this.state = 'IDLE';
        this.policies = new Map(); // Active policies
        this.tenantProfiles = new Map(); // Tenant configurations
        this.userPreferences = new Map(); // User preferences
        this.segmentRules = new Map(); // Segment DSL rules
        this.abExperiments = new Map(); // A/B experiments
        this.cache = new Map(); // Decision cache
        this.metrics = {
            decisions: 0,
            segmentsUsed: 0,
            abActive: false,
            avgScore: 0,
            avgP95Ms: 0,
            avgCostUsd: 0,
            quality: { ndcg10: 0, mrr10: 0 },
            fairnessOk: true,
            abAutoPaused: 0
        };
        
        this.isInitialized = false;
        this.logger = null;
        this.tracer = trace.getTracer('livia-personalization-policy-engine');
        
        // FSM states
        this.states = ['IDLE', 'READY', 'RESOLVE', 'CONSTRAIN', 'FAIRNESS', 'EMIT', 'ALERT'];
        
        this.initializeSegmentRules();
    }

    async initialize(eventBus, logger) {
        try {
            this.eventBus = eventBus;
            this.logger = logger;
            this.logger.info(`${this.name} başlatılıyor...`);
            
            // Event listeners
            this.setupEventListeners();
            
            this.isInitialized = true;
            this.logger.info(`${this.name} başarıyla başlatıldı`);
            return true;
        } catch (error) {
            this.logger.error(`${this.name} başlatma hatası:`, error);
            return false;
        }
    }

    setupEventListeners() {
        // Policy and profile updates
        this.eventBus.on('personalization.policy.updated', this.handlePolicyUpdate.bind(this));
        this.eventBus.on('tenant.profile.updated', this.handleTenantProfileUpdate.bind(this));
        this.eventBus.on('user.preference.updated', this.handleUserPreferenceUpdate.bind(this));
        
        // Context requests
        this.eventBus.on('context.request', this.handleContextRequest.bind(this));
        
        // System events
        this.eventBus.on('freeze.state.changed', this.handleFreezeStateChanged.bind(this));
        this.eventBus.on('slo.guard.triggered', this.handleSLOGuardTriggered.bind(this));
        this.eventBus.on('cost.guard.triggered', this.handleCostGuardTriggered.bind(this));
        
        // A/B experiment management
        this.eventBus.on('ab.experiment.registered', this.handleABExperimentRegistered.bind(this));
    }

    initializeSegmentRules() {
        // Default segment rules
        const defaultRules = [
            {
                id: 'gold-tr',
                condition: 'tier=gold AND region in [\'TR\',\'EU\'] AND lang in [\'tr\',\'auto\']',
                config: {
                    'qo.plan': 'P-hybrid-fast',
                    reranker: 'ce-small',
                    synthModel: 'gpt-m',
                    'ui.variant': 'gold-tr',
                    style: { locale: 'tr-TR', units: 'metric', currency: 'USD' }
                }
            },
            {
                id: 'bronze-lowcost',
                condition: 'tier=bronze OR channel=\'batch\'',
                config: {
                    'qo.plan': 'P-bm25-lowcost',
                    reranker: 'none',
                    synthModel: 'gpt-m',
                    caps: { maxTokens: 600, 'kb.topK': 50 }
                }
            },
            {
                id: 'do-not-personalize',
                condition: 'doNotPersonalize=true',
                config: {
                    'qo.plan': 'P-bm25-lowcost',
                    reranker: 'none',
                    synthModel: 'gpt-m',
                    caps: { maxTokens: 500, 'kb.topK': 30 }
                }
            }
        ];
        
        for (const rule of defaultRules) {
            this.segmentRules.set(rule.id, rule);
        }
    }

    async handleContextRequest(event) {
        const span = this.tracer.startSpan('personalization.decision');
        const startTime = Date.now();
        
        try {
            const { id: queryId, tenant, user, tier, region, locale, channel, mode, deadlineMs, hints } = event;
            
            // Generate personalization key
            const persKey = this.generatePersonalizationKey(event);
            
            // Idempotency check
            if (this.cache.has(persKey)) {
                const cachedDecision = this.cache.get(persKey);
                span.setStatus({ code: SpanStatusCode.OK });
                span.end();
                return cachedDecision;
            }
            
            // Initialize decision context
            const decisionContext = {
                queryId,
                persKey,
                tenant,
                user,
                tier,
                region,
                locale,
                channel,
                mode,
                deadlineMs,
                hints: hints || {},
                startTime,
                state: 'RESOLVE',
                segment: null,
                plan: null,
                constraints: {},
                reasoning: []
            };
            
            // Run decision pipeline
            const result = await this.runDecisionPipeline(decisionContext, span);
            
            // Cache result
            this.cache.set(persKey, result);
            this.scheduleCacheEviction(persKey);
            
            // Update metrics
            this.updateMetrics(decisionContext, startTime);
            
            span.setStatus({ code: SpanStatusCode.OK });
            span.end();
            
            return result;
            
        } catch (error) {
            span.recordException(error);
            span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
            span.end();
            
            this.emit('personalization.alert', {
                event: 'personalization.alert',
                timestamp: new Date().toISOString(),
                level: 'error',
                message: error.message,
                queryId: event.id
            });
            
            throw error;
        }
    }

    async runDecisionPipeline(context, span) {
        const { queryId } = context;
        
        try {
            // Resolve segment
            await this.resolveSegment(context, span);
            
            // Apply constraints
            await this.applyConstraints(context, span);
            
            // Check fairness
            await this.checkFairness(context, span);
            
            // Generate final decision
            const result = await this.generateDecision(context, span);
            
            return result;
            
        } catch (error) {
            this.logger.error(`Decision pipeline error for ${queryId}:`, error);
            throw error;
        }
    }

    async resolveSegment(context, span) {
        const resolveSpan = this.tracer.startSpan('personalization.resolve', { parent: span });
        
        try {
            context.state = 'RESOLVE';
            
            const { tenant, tier, region, locale, channel, user } = context;
            
            // Get tenant profile
            const tenantProfile = this.tenantProfiles.get(tenant) || {};
            
            // Get user preferences
            const userPrefs = this.userPreferences.get(user) || {};
            
            // Check do-not-personalize flag
            if (userPrefs.doNotPersonalize) {
                context.segment = 'do-not-personalize';
                context.reasoning.push('user opted out of personalization');
                const rule = this.segmentRules.get('do-not-personalize');
                context.plan = { ...this.config.defaults, ...rule.config };
                resolveSpan.setStatus({ code: SpanStatusCode.OK });
                return;
            }
            
            // Evaluate segment DSL rules
            const matchedSegment = this.evaluateSegmentRules({
                tier,
                region,
                locale,
                channel,
                vertical: tenantProfile.vertical,
                lang: locale === 'auto' ? 'auto' : locale.split('-')[0]
            });
            
            if (matchedSegment) {
                context.segment = matchedSegment.id;
                context.reasoning.push(`segmentDSL#${matchedSegment.id} matched`);
                context.plan = { ...this.config.defaults, ...matchedSegment.config };
            } else {
                context.segment = 'default';
                context.plan = { ...this.config.defaults };
                context.reasoning.push('no segment matched, using defaults');
            }
            
            // Apply dayparting adjustments
            const currentHour = new Date().getHours();
            for (const daypart of this.config.dayparting) {
                const [startHour, endHour] = daypart.windowLocal.split('-').map(t => parseInt(t.split(':')[0]));
                if (currentHour >= startHour && currentHour < endHour) {
                    // Apply boosts
                    if (daypart.boosts) {
                        context.reasoning.push(`dayparting: ${Object.keys(daypart.boosts).join(',')} boost applied`);
                    }
                    break;
                }
            }
            
            resolveSpan.setStatus({ code: SpanStatusCode.OK });
            
        } catch (error) {
            resolveSpan.recordException(error);
            resolveSpan.setStatus({ code: SpanStatusCode.ERROR });
            throw error;
        } finally {
            resolveSpan.end();
        }
    }

    evaluateSegmentRules(attributes) {
        // Simple rule evaluation (in production would use proper DSL parser)
        for (const rule of this.segmentRules.values()) {
            if (this.evaluateCondition(rule.condition, attributes)) {
                return rule;
            }
        }
        return null;
    }

    evaluateCondition(condition, attributes) {
        // Simple condition evaluation
        if (condition.includes('tier=gold') && attributes.tier === 'gold') {
            if (condition.includes('region in')) {
                return ['TR', 'EU'].includes(attributes.region);
            }
            return true;
        }
        
        if (condition.includes('tier=bronze') && attributes.tier === 'bronze') {
            return true;
        }
        
        if (condition.includes('channel=\'batch\'') && attributes.channel === 'batch') {
            return true;
        }
        
        if (condition.includes('doNotPersonalize=true') && attributes.doNotPersonalize) {
            return true;
        }
        
        return false;
    }

    async applyConstraints(context, span) {
        const constrainSpan = this.tracer.startSpan('personalization.constrain', { parent: span });
        
        try {
            context.state = 'CONSTRAIN';
            
            const { tier, deadlineMs, hints } = context;
            const constraints = { ...this.config.constraints };
            
            // Apply tier-specific adjustments
            if (tier === 'gold' && constraints.latencyP95Ms.goldBonus) {
                constraints.latencyP95Ms.max += constraints.latencyP95Ms.goldBonus;
            } else if (tier === 'bronze' && constraints.latencyP95Ms.bronzeRelax) {
                constraints.latencyP95Ms.max += constraints.latencyP95Ms.bronzeRelax;
            }
            
            // Apply deadline constraints
            if (deadlineMs) {
                constraints.latencyP95Ms.max = Math.min(constraints.latencyP95Ms.max, deadlineMs);
            }
            
            // Apply cost hints
            if (hints.costHardUsd) {
                constraints.costPerQueryUsd.max = Math.min(constraints.costPerQueryUsd.max, hints.costHardUsd);
            }
            
            // Check if plan meets constraints
            const planFeasible = this.checkPlanFeasibility(context.plan, constraints);
            
            if (!planFeasible) {
                // Degrade plan to meet constraints
                context.plan = this.degradePlan(context.plan, constraints);
                context.reasoning.push('plan degraded to meet constraints');
            }
            
            context.constraints = constraints;
            
            constrainSpan.setStatus({ code: SpanStatusCode.OK });
            
        } catch (error) {
            constrainSpan.recordException(error);
            constrainSpan.setStatus({ code: SpanStatusCode.ERROR });
            throw error;
        } finally {
            constrainSpan.end();
        }
    }

    checkPlanFeasibility(plan, constraints) {
        // Mock feasibility check - in production would estimate actual costs/latency
        const planCostEstimate = this.estimatePlanCost(plan);
        const planLatencyEstimate = this.estimatePlanLatency(plan);
        
        return (
            planCostEstimate <= constraints.costPerQueryUsd.max &&
            planLatencyEstimate <= constraints.latencyP95Ms.max
        );
    }

    estimatePlanCost(plan) {
        // Mock cost estimation
        const baseCost = 0.005;
        let multiplier = 1;
        
        if (plan['qo.plan'] === 'P-hybrid-fast') multiplier = 1.5;
        else if (plan['qo.plan'] === 'P-hybrid-quality') multiplier = 2.0;
        
        if (plan.reranker === 'ce-large') multiplier *= 1.3;
        else if (plan.reranker === 'ce-small') multiplier *= 1.1;
        
        if (plan.synthModel === 'gpt-l') multiplier *= 1.8;
        else if (plan.synthModel === 'gpt-m') multiplier *= 1.2;
        
        return baseCost * multiplier;
    }

    estimatePlanLatency(plan) {
        // Mock latency estimation
        let baseLatency = 300; // ms
        
        if (plan['qo.plan'] === 'P-hybrid-fast') baseLatency = 600;
        else if (plan['qo.plan'] === 'P-hybrid-quality') baseLatency = 1200;
        else if (plan['qo.plan'] === 'P-vec-lite') baseLatency = 400;
        else if (plan['qo.plan'] === 'P-bm25-lowcost') baseLatency = 250;
        
        if (plan.reranker === 'ce-large') baseLatency += 200;
        else if (plan.reranker === 'ce-small') baseLatency += 100;
        
        if (plan.synthModel === 'gpt-l') baseLatency += 300;
        else if (plan.synthModel === 'gpt-m') baseLatency += 150;
        
        return baseLatency;
    }

    degradePlan(plan, constraints) {
        const degradedPlan = { ...plan };
        
        // Reduce plan complexity to meet constraints
        if (this.estimatePlanCost(degradedPlan) > constraints.costPerQueryUsd.max) {
            // Downgrade components
            degradedPlan['qo.plan'] = 'P-bm25-lowcost';
            degradedPlan.reranker = 'none';
            degradedPlan.synthModel = 'gpt-m';
            
            if (degradedPlan.caps) {
                degradedPlan.caps.maxTokens = Math.min(degradedPlan.caps.maxTokens || 700, 500);
                degradedPlan.caps['kb.topK'] = Math.min(degradedPlan.caps['kb.topK'] || 60, 30);
            }
        }
        
        return degradedPlan;
    }

    async checkFairness(context, span) {
        const fairnessSpan = this.tracer.startSpan('personalization.fairness', { parent: span });
        
        try {
            context.state = 'FAIRNESS';
            
            // Mock fairness check - in production would check actual metrics
            const fairnessChecks = {
                proxyScan: { passed: true },
                parityCheck: { ok: true }
            };
            
            context.fairnessChecks = fairnessChecks;
            
            if (!fairnessChecks.proxyScan.passed || !fairnessChecks.parityCheck.ok) {
                context.plan = this.config.defaults; // Fall back to safe defaults
                context.reasoning.push('fairness violation, using safe defaults');
            }
            
            fairnessSpan.setStatus({ code: SpanStatusCode.OK });
            
        } catch (error) {
            fairnessSpan.recordException(error);
            fairnessSpan.setStatus({ code: SpanStatusCode.ERROR });
            throw error;
        } finally {
            fairnessSpan.end();
        }
    }

    async generateDecision(context, span) {
        const emitSpan = this.tracer.startSpan('personalization.emit', { parent: span });
        
        try {
            context.state = 'EMIT';
            
            const { queryId, segment, plan, constraints, reasoning } = context;
            
            // Create decision result
            const decision = {
                id: queryId,
                policyId: 'pers-v1',
                segment,
                plan,
                localization: {
                    locale: plan.style?.locale || this.config.locale,
                    units: plan.style?.units || 'metric',
                    currency: plan.style?.currency || this.config.currency
                },
                ui: {
                    variant: plan['ui.variant'] || this.config.defaults.ui.variant,
                    disclaimer: this.generateDisclaimer(context)
                },
                constraintsApplied: {
                    p95MsMax: constraints.latencyP95Ms.max,
                    costUsdMax: constraints.costPerQueryUsd.max,
                    ndcg10Min: constraints.quality.ndcg10Min
                },
                reasoning,
                hash: crypto.createHash('sha256').update(JSON.stringify({ segment, plan, constraints })).digest('hex')
            };
            
            // Emit decision
            this.emit('personalization.decision.ready', {
                event: 'personalization.decision.ready',
                timestamp: new Date().toISOString(),
                ...decision
            });
            
            // Emit hints to other services
            this.emitHints(context);
            
            // Emit UI assets
            this.emitUIAssets(context);
            
            // Update metrics and emit card
            this.emitCard(context);
            this.emitMetrics();
            
            emitSpan.setStatus({ code: SpanStatusCode.OK });
            return decision;
            
        } catch (error) {
            emitSpan.recordException(error);
            emitSpan.setStatus({ code: SpanStatusCode.ERROR });
            throw error;
        } finally {
            emitSpan.end();
        }
    }

    emitHints(context) {
        const { queryId, plan } = context;
        
        // Emit hints to Query Orchestrator
        this.emit('personalization.hint.qo', {
            event: 'personalization.hint.qo',
            timestamp: new Date().toISOString(),
            id: queryId,
            overrides: {
                plan: plan['qo.plan'],
                reranker: plan.reranker,
                synthModel: plan.synthModel
            },
            caps: plan.caps || {}
        });
        
        // Emit hints to Traffic Shaper
        this.emit('personalization.hint.shape', {
            event: 'personalization.hint.shape',
            timestamp: new Date().toISOString(),
            svc: 'kb_api',
            tier: context.tier,
            priorityBoost: context.tier === 'gold' ? 2 : 1,
            deadlineMs: context.deadlineMs || 1200
        });
    }

    emitUIAssets(context) {
        const { plan } = context;
        const variant = plan['ui.variant'] || 'default';
        
        this.emit('personalization.ui.assets', {
            event: 'personalization.ui.assets',
            timestamp: new Date().toISOString(),
            variantId: variant,
            strings: {
                greet: variant.includes('tr') ? 'Merhaba' : 'Hello',
                cta: variant.includes('tr') ? 'Devam' : 'Continue'
            },
            style: {
                dateFmt: variant.includes('tr') ? 'DD MMM YYYY' : 'MMM DD, YYYY',
                thousandsSep: variant.includes('tr') ? '.' : ','
            }
        });
    }

    generateDisclaimer(context) {
        // Generate appropriate disclaimer based on context
        const { tenant, plan } = context;
        const tenantProfile = this.tenantProfiles.get(tenant) || {};
        
        if (tenantProfile.vertical === 'finance') {
            return 'tr-finance';
        } else if (tenantProfile.vertical === 'health') {
            return 'tr-health';
        }
        
        return null;
    }

    // Event handlers
    handlePolicyUpdate(event) {
        this.logger.info(`${this.name} policy updating...`);
        
        const { objectives, constraints, fairness, segmentDSL, dayparting } = event;
        
        if (objectives) Object.assign(this.config.objectives, objectives);
        if (constraints) Object.assign(this.config.constraints, constraints);
        if (fairness) Object.assign(this.config.fairness, fairness);
        if (segmentDSL) this.updateSegmentRules(segmentDSL);
        if (dayparting) this.config.dayparting = dayparting;
        
        // Clear cache to force re-evaluation
        this.cache.clear();
    }

    updateSegmentRules(segmentDSL) {
        // Update segment rules from DSL - simplified implementation
        if (Array.isArray(segmentDSL)) {
            for (const rule of segmentDSL) {
                if (rule.if && rule.then) {
                    const ruleId = crypto.createHash('md5').update(rule.if).digest('hex').substring(0, 8);
                    this.segmentRules.set(ruleId, {
                        id: ruleId,
                        condition: rule.if,
                        config: rule.then
                    });
                }
            }
        }
    }

    handleTenantProfileUpdate(event) {
        const { tenant, region, locale, tier, channels, vertical, consent } = event;
        
        this.tenantProfiles.set(tenant, {
            region,
            locale,
            tier,
            channels,
            vertical,
            consent
        });
        
        this.logger.debug(`Tenant profile updated: ${tenant}`);
    }

    handleUserPreferenceUpdate(event) {
        const { user, tenant, locale, units, doNotPersonalize, topics } = event;
        
        this.userPreferences.set(user, {
            tenant,
            locale,
            units,
            doNotPersonalize,
            topics
        });
        
        this.logger.debug(`User preferences updated: ${user}`);
    }

    handleFreezeStateChanged(event) {
        const { state, scope, reason } = event;
        
        if (state === 'frozen') {
            this.logger.warn(`Freeze activated: ${scope} (${reason})`);
            // Don't change state, but log decisions without persisting
        } else {
            this.logger.info(`Freeze lifted: ${scope}`);
        }
    }

    handleSLOGuardTriggered(event) {
        const { serviceId, slo, severity } = event;
        
        if (severity === 'high') {
            // Adjust objectives to prioritize latency
            const adjustedObjectives = { ...this.config.objectives };
            adjustedObjectives.latency += 0.1;
            adjustedObjectives.quality -= 0.05;
            adjustedObjectives.cost -= 0.05;
            
            this.logger.warn(`SLO guard triggered, adjusting objectives: ${JSON.stringify(adjustedObjectives)}`);
        }
    }

    handleCostGuardTriggered(event) {
        const { component, severity } = event;
        
        if (severity === 'high') {
            // Adjust objectives to prioritize cost
            const adjustedObjectives = { ...this.config.objectives };
            adjustedObjectives.cost += 0.1;
            adjustedObjectives.quality -= 0.05;
            adjustedObjectives.latency -= 0.05;
            
            this.logger.warn(`Cost guard triggered, adjusting objectives: ${JSON.stringify(adjustedObjectives)}`);
        }
    }

    handleABExperimentRegistered(event) {
        const { expId, scope, arms, metrics, guardrails } = event;
        
        this.abExperiments.set(expId, {
            scope,
            arms,
            metrics,
            guardrails,
            active: true
        });
        
        this.metrics.abActive = true;
        this.logger.info(`A/B experiment registered: ${expId}`);
    }

    // Utility methods
    generatePersonalizationKey(event) {
        const keyData = {
            tenant: event.tenant,
            tier: event.tier,
            region: event.region,
            locale: event.locale,
            channel: event.channel,
            timestamp: Math.floor(Date.now() / (this.config.idempotencyTtlSec * 1000))
        };
        return crypto.createHash('sha256').update(JSON.stringify(keyData)).digest('hex').substring(0, 16);
    }

    scheduleCacheEviction(key) {
        setTimeout(() => {
            this.cache.delete(key);
        }, this.config.cache.ttlSec * 1000);
    }

    updateMetrics(context, startTime) {
        const duration = Date.now() - startTime;
        
        this.metrics.decisions++;
        this.metrics.segmentsUsed = context.segment !== 'default' ? this.metrics.segmentsUsed + 1 : this.metrics.segmentsUsed;
        this.metrics.avgP95Ms = (this.metrics.avgP95Ms * 0.9) + (duration * 0.1);
        this.metrics.avgCostUsd = (this.metrics.avgCostUsd * 0.9) + (this.estimatePlanCost(context.plan) * 0.1);
        this.metrics.fairnessOk = context.fairnessChecks?.parityCheck?.ok !== false;
    }

    emitCard(context) {
        const { segment, plan } = context;
        
        this.emit('personalization.card', {
            event: 'personalization.card',
            timestamp: new Date().toISOString(),
            title: `Kişiselleştirme Aktif — ${segment}`,
            body: `${plan['qo.plan']} • ${plan.reranker} • ${plan.synthModel} • p95≤${context.constraints.latencyP95Ms.max}ms • $≤${context.constraints.costPerQueryUsd.max}/sorgu.`,
            severity: 'info',
            ttlSec: 600
        });
    }

    emitMetrics() {
        this.emit('personalization.metrics', {
            event: 'personalization.metrics',
            timestamp: new Date().toISOString(),
            ...this.metrics
        });
    }

    getStatus() {
        return {
            name: this.name,
            initialized: this.isInitialized,
            state: this.state,
            policies: this.policies.size,
            tenantProfiles: this.tenantProfiles.size,
            userPreferences: this.userPreferences.size,
            segmentRules: this.segmentRules.size,
            abExperiments: this.abExperiments.size,
            cache: this.cache.size,
            metrics: this.metrics,
            config: {
                enabled: this.config.enabled,
                locale: this.config.locale,
                objectives: this.config.objectives,
                fairnessEnabled: this.config.fairness.noUse
            }
        };
    }

    async shutdown() {
        try {
            this.logger.info(`${this.name} durduruluyor...`);
            
            // Clear all data structures
            this.policies.clear();
            this.tenantProfiles.clear();
            this.userPreferences.clear();
            this.segmentRules.clear();
            this.abExperiments.clear();
            this.cache.clear();
            
            this.isInitialized = false;
            this.logger.info(`${this.name} başarıyla durduruldu`);
        } catch (error) {
            this.logger.error(`${this.name} durdurma hatası:`, error);
        }
    }
}

module.exports = PersonalizationPolicyEngine;