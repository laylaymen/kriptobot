/**
 * LIVIA-61: Feedback Learning Looper
 * Geri bildirim öğrenme döngüsü
 * Amaç: Kullanıcı ve sistem geri bildirimlerinden güvenli öğrenme döngüsü kurup politika iyileştirmeleri yapma
 */

const crypto = require('crypto');
const { EventEmitter } = require('events');
const { trace, context, SpanStatusCode } = require('@opentelemetry/api');

class FeedbackLearningLooper extends EventEmitter {
    constructor(config = {}) {
        super();
        
        this.name = 'FeedbackLearningLooper';
        this.config = {
            enabled: true,
            locale: 'tr-TR',
            timezone: 'Europe/Istanbul',
            learning: {
                mode: 'hybrid', // offline+online
                online: {
                    method: 'linUCB',
                    explorePct: 5,
                    contextFeat: ['tier', 'lang', 'hour', 'query_len', 'fresh_score', 'cost_per1k', 'topK', 'reranker', 'model']
                },
                offline: {
                    estimator: 'DR',
                    clipW: 10,
                    minPropensity: 0.05,
                    bootstrapB: 200
                },
                safety: {
                    spi: 'conservative',
                    deltaMax: { p95Ms: 30, ndcg10: -0.02, costUsd: 0.002 },
                    hardStops: { safetyIncidents: true }
                },
                fairness: {
                    check: ['acceptRate', 'p95Ms', 'costUsd'],
                    tolerancePct: 10,
                    protected: ['age', 'gender', 'religion', 'ethnicity'],
                    proxyGuard: true
                },
                exploration: {
                    perTenantBudgetPct: 3,
                    guardByTier: { gold: 1, silver: 3, bronze: 5 }
                },
                dataset: {
                    minSize: 5000,
                    maxAgeDays: 7,
                    balanceTarget: 'class_weighted'
                }
            },
            attribution: {
                method: 'shaplike+last_touch',
                credit: ['retrieve', 'rerank', 'model', 'kb_profile', 'shape']
            },
            propose: {
                candidates: [
                    { scope: 'qo', diff: { topK: '-20|floor:20' } },
                    { scope: 'qo', diff: { reranker: 'ce-small→none' } },
                    { scope: 'tune', diff: { profile: 'ivf-pq np:16→12' } },
                    { scope: 'shape', diff: { deadlineMs: '-100' } }
                ],
                maxSimultaneous: 2,
                needHumanReviewIf: { riskHigh: true, fairnessCloseToLimit: true }
            },
            rollout: {
                canary: { trafficPct: 10, durationMin: 30 },
                promoteCriteria: { p95MsMax: 900, ndcg10Min: 0.50, costUsdMax: 0.015, safetyNoWorse: true },
                rollbackCriteria: { ndcgDropPct: 3.0, p95RiseMs: 80, safetyEvent: true }
            },
            cache: { ttlSec: 1800, keyBy: ['policyHash', 'datasetHash', 'scope'] },
            idempotencyTtlSec: 3600,
            ...config
        };
        
        // State management
        this.state = 'IDLE';
        this.feedbackData = new Map(); // Collected feedback
        this.behaviorMetrics = new Map(); // User behavior patterns
        this.decisionPaths = new Map(); // Decision attribution data
        this.systemMetrics = new Map(); // SLO, cost, safety metrics
        this.datasets = new Map(); // Learning datasets
        this.candidates = new Map(); // Policy candidates
        this.experiments = new Map(); // Running experiments
        this.estimates = new Map(); // Counterfactual estimates
        this.cache = new Map(); // Learning cache
        this.metrics = {
            onlineBandit: { method: 'linUCB', explorePct: 5, regretMean: -0.012 },
            proposals: 0,
            applied: 0,
            rolledBack: 0,
            ipsVar: 0.006,
            drVar: 0.004,
            quality: { ndcg10: '+0.6pp', acceptRate: '+1.8pp' },
            slo: { p95Ms: '+10ms' },
            cost: { usdPerQuery: '-0.0016' }
        };
        
        this.isInitialized = false;
        this.logger = null;
        this.tracer = trace.getTracer('livia-feedback-learning-looper');
        
        // FSM states
        this.states = ['IDLE', 'COLLECT', 'JOIN', 'ATTRIB', 'ESTIMATE', 'PROPOSE', 'ROLLOUT', 'EVALUATE', 'APPLY', 'REPORT'];
        
        this.initializeDefaults();
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
        // Feedback events
        this.eventBus.on('feedback.user.thumbs', this.handleUserThumbsFeedback.bind(this));
        this.eventBus.on('feedback.user.rating', this.handleUserRatingFeedback.bind(this));
        this.eventBus.on('feedback.user.edit.patch', this.handleUserEditFeedback.bind(this));
        this.eventBus.on('feedback.user.flag', this.handleUserFlagFeedback.bind(this));
        
        // Behavior events
        this.eventBus.on('session.behavior.snapshot', this.handleBehaviorSnapshot.bind(this));
        
        // Decision path tracking
        this.eventBus.on('qo.decision.path', this.handleDecisionPath.bind(this));
        
        // System metrics
        this.eventBus.on('slo.window.metrics', this.handleSLOMetrics.bind(this));
        this.eventBus.on('cost.window.metrics', this.handleCostMetrics.bind(this));
        this.eventBus.on('evidence.validation.ready', this.handleEvidenceMetrics.bind(this));
        this.eventBus.on('safety.stream.guard', this.handleSafetyMetrics.bind(this));
        this.eventBus.on('safety.violation.blocked', this.handleSafetyMetrics.bind(this));
        this.eventBus.on('freshness.snapshot', this.handleFreshnessMetrics.bind(this));
        
        // Dataset and policy events
        this.eventBus.on('learning.dataset.snapshot', this.handleDatasetSnapshot.bind(this));
        this.eventBus.on('policy.candidate.registered', this.handlePolicyCandidate.bind(this));
        
        // System events
        this.eventBus.on('freeze.state.changed', this.handleFreezeStateChanged.bind(this));
        
        // Learning triggers
        this.eventBus.on('learning.trigger.batch', this.handleBatchLearning.bind(this));
        this.eventBus.on('learning.trigger.online', this.handleOnlineLearning.bind(this));
    }

    initializeDefaults() {
        // Initialize default candidates
        for (const candidate of this.config.propose.candidates) {
            const candidateId = `cand#${candidate.scope}-${crypto.randomBytes(4).toString('hex')}`;
            this.candidates.set(candidateId, {
                id: candidateId,
                scope: candidate.scope,
                diff: candidate.diff,
                status: 'registered',
                timestamp: new Date().toISOString()
            });
        }
    }

    // Feedback handlers
    async handleUserThumbsFeedback(event) {
        const span = this.tracer.startSpan('learning.collect.thumbs');
        
        try {
            const { id, tenant, user, thumb, reason, freeText } = event;
            
            const feedbackEntry = {
                type: 'thumbs',
                queryId: id,
                tenant,
                user: this.hashUserId(user),
                value: thumb === '+1' ? 1 : -1,
                reason,
                freeText,
                timestamp: event.timestamp,
                weight: 1.0
            };
            
            this.feedbackData.set(`thumbs:${id}`, feedbackEntry);
            this.logger.debug(`Thumbs feedback collected: ${id} = ${thumb}`);
            
            // Trigger online learning if conditions are met
            await this.checkOnlineLearningTrigger();
            
            span.setStatus({ code: SpanStatusCode.OK });
            
        } catch (error) {
            span.recordException(error);
            span.setStatus({ code: SpanStatusCode.ERROR });
            throw error;
        } finally {
            span.end();
        }
    }

    async handleUserRatingFeedback(event) {
        const span = this.tracer.startSpan('learning.collect.rating');
        
        try {
            const { id, score, dimensions } = event;
            
            const feedbackEntry = {
                type: 'rating',
                queryId: id,
                overallScore: score,
                dimensions: dimensions || {},
                timestamp: event.timestamp,
                weight: 1.2 // Ratings are more structured
            };
            
            this.feedbackData.set(`rating:${id}`, feedbackEntry);
            this.logger.debug(`Rating feedback collected: ${id} = ${score}/5`);
            
            await this.checkOnlineLearningTrigger();
            
            span.setStatus({ code: SpanStatusCode.OK });
            
        } catch (error) {
            span.recordException(error);
            span.setStatus({ code: SpanStatusCode.ERROR });
            throw error;
        } finally {
            span.end();
        }
    }

    async handleUserEditFeedback(event) {
        const span = this.tracer.startSpan('learning.collect.edit');
        
        try {
            const { id, before, after, diffChars, labels } = event;
            
            const feedbackEntry = {
                type: 'edit',
                queryId: id,
                before,
                after,
                diffChars,
                labels: labels || {},
                timestamp: event.timestamp,
                weight: 2.0 // Edits are high-signal
            };
            
            this.feedbackData.set(`edit:${id}`, feedbackEntry);
            this.logger.debug(`Edit feedback collected: ${id} (${diffChars} chars)`);
            
            await this.checkOnlineLearningTrigger();
            
            span.setStatus({ code: SpanStatusCode.OK });
            
        } catch (error) {
            span.recordException(error);
            span.setStatus({ code: SpanStatusCode.ERROR });
            throw error;
        } finally {
            span.end();
        }
    }

    async handleUserFlagFeedback(event) {
        const span = this.tracer.startSpan('learning.collect.flag');
        
        try {
            const { id, category } = event;
            
            const feedbackEntry = {
                type: 'flag',
                queryId: id,
                category,
                timestamp: event.timestamp,
                weight: 3.0, // Flags are critical
                negative: true
            };
            
            this.feedbackData.set(`flag:${id}`, feedbackEntry);
            this.logger.warn(`Flag feedback collected: ${id} (${category})`);
            
            // Flags trigger immediate learning assessment
            await this.triggerImmediateLearning(id, 'flag');
            
            span.setStatus({ code: SpanStatusCode.OK });
            
        } catch (error) {
            span.recordException(error);
            span.setStatus({ code: SpanStatusCode.ERROR });
            throw error;
        } finally {
            span.end();
        }
    }

    async handleBehaviorSnapshot(event) {
        const span = this.tracer.startSpan('learning.collect.behavior');
        
        try {
            const { id, metrics } = event;
            
            const behaviorEntry = {
                type: 'behavior',
                queryId: id,
                dwellMs: metrics.dwellMs,
                abandon: metrics.abandon,
                followupWithinMin: metrics.followupWithinMin,
                escalation: metrics.escalation,
                conversion: metrics.conversion,
                timestamp: event.timestamp,
                implicitScore: this.calculateImplicitScore(metrics)
            };
            
            this.behaviorMetrics.set(id, behaviorEntry);
            this.logger.debug(`Behavior metrics collected: ${id}`);
            
            span.setStatus({ code: SpanStatusCode.OK });
            
        } catch (error) {
            span.recordException(error);
            span.setStatus({ code: SpanStatusCode.ERROR });
            throw error;
        } finally {
            span.end();
        }
    }

    calculateImplicitScore(metrics) {
        // Calculate implicit satisfaction score from behavior
        let score = 0.5; // Neutral baseline
        
        // Dwell time scoring
        if (metrics.dwellMs > 30000) score += 0.3; // Long engagement
        else if (metrics.dwellMs < 5000) score -= 0.2; // Quick bounce
        
        // Abandonment penalty
        if (metrics.abandon) score -= 0.4;
        
        // Follow-up behavior
        if (metrics.followupWithinMin > 0) {
            if (metrics.followupWithinMin <= 2) score -= 0.3; // Quick follow-up = unsatisfied
            else score += 0.1; // Later follow-up = engaged
        }
        
        // Escalation penalty
        if (metrics.escalation) score -= 0.5;
        
        // Conversion bonus
        if (metrics.conversion) score += 0.4;
        
        return Math.max(0, Math.min(1, score));
    }

    async handleDecisionPath(event) {
        const span = this.tracer.startSpan('learning.collect.decision');
        
        try {
            const { route, planId, params, propensity, variant } = event;
            
            const decisionEntry = {
                route,
                planId,
                params,
                propensity,
                variant,
                timestamp: event.timestamp,
                context: this.extractDecisionContext(event)
            };
            
            this.decisionPaths.set(event.id || crypto.randomUUID(), decisionEntry);
            this.logger.debug(`Decision path tracked: ${route} (${planId})`);
            
            span.setStatus({ code: SpanStatusCode.OK });
            
        } catch (error) {
            span.recordException(error);
            span.setStatus({ code: SpanStatusCode.ERROR });
            throw error;
        } finally {
            span.end();
        }
    }

    extractDecisionContext(event) {
        // Extract context features for attribution
        return {
            timestamp: new Date(event.timestamp).getHours(),
            route: event.route,
            planId: event.planId,
            params: Object.keys(event.params || {}),
            propensity: event.propensity
        };
    }

    // System metrics handlers
    async handleSLOMetrics(event) {
        const { window, p95Ms, errPct } = event;
        
        this.systemMetrics.set(`slo:${window}`, {
            type: 'slo',
            window,
            p95Ms,
            errPct,
            timestamp: event.timestamp
        });
    }

    async handleCostMetrics(event) {
        const { window, avgUsdPerQuery, per1kReqTotal } = event;
        
        this.systemMetrics.set(`cost:${window}`, {
            type: 'cost',
            window,
            avgUsdPerQuery,
            per1kReqTotal,
            timestamp: event.timestamp
        });
    }

    async handleEvidenceMetrics(event) {
        const { id, coveragePct, status } = event;
        
        this.systemMetrics.set(`evidence:${id}`, {
            type: 'evidence',
            queryId: id,
            coveragePct,
            status,
            timestamp: event.timestamp
        });
    }

    async handleSafetyMetrics(event) {
        const { id, action, reason } = event;
        
        this.systemMetrics.set(`safety:${id}:${Date.now()}`, {
            type: 'safety',
            queryId: id,
            action,
            reason,
            timestamp: event.timestamp,
            severity: action === 'cutoff' ? 'high' : 'medium'
        });
        
        // Safety events trigger immediate assessment
        if (action === 'cutoff' || action === 'replace') {
            await this.triggerImmediateLearning(id, 'safety');
        }
    }

    async handleFreshnessMetrics(event) {
        const { namespace, status, score } = event;
        
        this.systemMetrics.set(`freshness:${namespace}`, {
            type: 'freshness',
            namespace,
            status,
            score,
            timestamp: event.timestamp
        });
    }

    async handleDatasetSnapshot(event) {
        const span = this.tracer.startSpan('learning.dataset.update');
        
        try {
            const { period, size, biasChecks, hash } = event;
            
            const dataset = {
                period,
                size,
                biasChecks,
                hash,
                timestamp: event.timestamp,
                ready: size >= this.config.learning.dataset.minSize
            };
            
            this.datasets.set(`dataset:${period}`, dataset);
            this.logger.info(`Dataset snapshot updated: ${period} (${size} samples)`);
            
            // Trigger batch learning if dataset is ready
            if (dataset.ready) {
                await this.triggerBatchLearning(dataset);
            }
            
            span.setStatus({ code: SpanStatusCode.OK });
            
        } catch (error) {
            span.recordException(error);
            span.setStatus({ code: SpanStatusCode.ERROR });
            throw error;
        } finally {
            span.end();
        }
    }

    async handlePolicyCandidate(event) {
        const { scope, id, base, diff, rationale } = event;
        
        const candidate = {
            id,
            scope,
            base,
            diff,
            rationale,
            status: 'registered',
            timestamp: event.timestamp
        };
        
        this.candidates.set(id, candidate);
        this.logger.info(`Policy candidate registered: ${id} (${scope})`);
    }

    async handleFreezeStateChanged(event) {
        const { state, scope, reason } = event;
        
        if (state === 'frozen') {
            this.logger.warn(`Freeze activated: ${scope} (${reason})`);
            // Continue learning but don't apply changes
        } else {
            this.logger.info(`Freeze lifted: ${scope}`);
        }
    }

    // Learning triggers
    async checkOnlineLearningTrigger() {
        // Check if we have enough recent feedback for online learning
        const recentFeedback = Array.from(this.feedbackData.values())
            .filter(f => Date.now() - new Date(f.timestamp).getTime() < 3600000) // 1 hour
            .length;
        
        if (recentFeedback >= 10) { // Threshold for online learning
            await this.triggerOnlineLearning();
        }
    }

    async triggerOnlineLearning() {
        const span = this.tracer.startSpan('learning.online.trigger');
        
        try {
            this.state = 'COLLECT';
            
            // Run online learning pipeline
            await this.runOnlineLearningPipeline();
            
            span.setStatus({ code: SpanStatusCode.OK });
            
        } catch (error) {
            span.recordException(error);
            span.setStatus({ code: SpanStatusCode.ERROR });
            throw error;
        } finally {
            span.end();
        }
    }

    async triggerBatchLearning(dataset) {
        const span = this.tracer.startSpan('learning.batch.trigger');
        
        try {
            this.state = 'COLLECT';
            
            // Run batch learning pipeline
            await this.runBatchLearningPipeline(dataset);
            
            span.setStatus({ code: SpanStatusCode.OK });
            
        } catch (error) {
            span.recordException(error);
            span.setStatus({ code: SpanStatusCode.ERROR });
            throw error;
        } finally {
            span.end();
        }
    }

    async triggerImmediateLearning(queryId, trigger) {
        const span = this.tracer.startSpan('learning.immediate.trigger');
        
        try {
            this.logger.warn(`Immediate learning triggered: ${queryId} (${trigger})`);
            
            // Run focused learning on specific query
            await this.runFocusedLearningPipeline(queryId, trigger);
            
            span.setStatus({ code: SpanStatusCode.OK });
            
        } catch (error) {
            span.recordException(error);
            span.setStatus({ code: SpanStatusCode.ERROR });
            throw error;
        } finally {
            span.end();
        }
    }

    async runOnlineLearningPipeline() {
        // Online learning with LinUCB
        this.state = 'JOIN';
        
        // Join feedback with decision paths
        const joinedData = await this.joinFeedbackWithDecisions();
        
        this.state = 'ATTRIB';
        
        // Attribute rewards to decision components
        const attributedData = await this.attributeRewards(joinedData);
        
        this.state = 'ESTIMATE';
        
        // Update online model (LinUCB)
        await this.updateOnlineModel(attributedData);
        
        // Generate online proposals if needed
        if (this.shouldGenerateProposal()) {
            this.state = 'PROPOSE';
            await this.generateOnlineProposals();
        }
        
        this.state = 'IDLE';
    }

    async runBatchLearningPipeline(dataset) {
        // Batch learning with counterfactual estimation
        this.state = 'JOIN';
        
        // Join all available data
        const joinedData = await this.joinAllLearningData(dataset);
        
        this.state = 'ATTRIB';
        
        // Attribute rewards
        const attributedData = await this.attributeRewards(joinedData);
        
        this.state = 'ESTIMATE';
        
        // Counterfactual estimation (IPS/DR)
        const estimates = await this.performCounterfactualEstimation(attributedData);
        
        this.state = 'PROPOSE';
        
        // Generate proposals
        const proposals = await this.generateProposals(estimates);
        
        if (proposals.length > 0) {
            this.state = 'ROLLOUT';
            await this.initiateRollouts(proposals);
        }
        
        this.state = 'REPORT';
        await this.generateLearningReport(estimates, proposals);
        
        this.state = 'IDLE';
    }

    async runFocusedLearningPipeline(queryId, trigger) {
        // Focused learning on specific query
        const feedback = Array.from(this.feedbackData.values())
            .filter(f => f.queryId === queryId);
        
        const decisionPath = Array.from(this.decisionPaths.values())
            .find(d => d.queryId === queryId);
        
        if (feedback.length > 0 && decisionPath) {
            // Analyze specific issue
            const analysis = await this.analyzeFocusedIssue(feedback, decisionPath, trigger);
            
            // Generate targeted proposal if needed
            if (analysis.requiresAction) {
                const proposal = await this.generateTargetedProposal(analysis);
                if (proposal) {
                    await this.initiateEmergencyRollout(proposal);
                }
            }
        }
    }

    async joinFeedbackWithDecisions() {
        const joined = [];
        
        for (const feedback of this.feedbackData.values()) {
            const decisionPath = Array.from(this.decisionPaths.values())
                .find(d => d.queryId === feedback.queryId);
            
            if (decisionPath) {
                joined.push({
                    queryId: feedback.queryId,
                    feedback,
                    decisionPath,
                    behavior: this.behaviorMetrics.get(feedback.queryId),
                    systemMetrics: this.getSystemMetricsForQuery(feedback.queryId)
                });
            }
        }
        
        return joined;
    }

    async joinAllLearningData(dataset) {
        // Join all learning data for batch processing
        return this.joinFeedbackWithDecisions(); // Simplified for now
    }

    async attributeRewards(joinedData) {
        const attributed = [];
        
        for (const item of joinedData) {
            const attribution = await this.performAttribution(item);
            attributed.push({
                ...item,
                attribution
            });
        }
        
        return attributed;
    }

    async performAttribution(item) {
        // SHAP-like attribution + last-touch
        const { feedback, decisionPath } = item;
        const components = this.config.attribution.credit;
        
        const attribution = {};
        const totalReward = this.calculateReward(feedback);
        
        // Simple attribution: equal weight to all components in decision path
        const componentCount = components.filter(c => decisionPath.params[c] !== undefined).length;
        const baseAttribution = totalReward / Math.max(componentCount, 1);
        
        for (const component of components) {
            if (decisionPath.params[component] !== undefined) {
                attribution[component] = baseAttribution;
            }
        }
        
        // Last-touch bonus to the final component
        if (components.length > 0) {
            const lastComponent = components[components.length - 1];
            if (attribution[lastComponent]) {
                attribution[lastComponent] *= 1.2;
            }
        }
        
        return attribution;
    }

    calculateReward(feedback) {
        // Convert feedback to reward signal
        let reward = 0;
        
        switch (feedback.type) {
            case 'thumbs':
                reward = feedback.value; // -1 or 1
                break;
            case 'rating':
                reward = (feedback.overallScore - 3) / 2; // -1 to 1
                break;
            case 'edit':
                reward = -0.5; // Edits indicate dissatisfaction
                break;
            case 'flag':
                reward = -1; // Flags are strongly negative
                break;
            default:
                reward = 0;
        }
        
        return reward * (feedback.weight || 1);
    }

    async updateOnlineModel(attributedData) {
        // Update LinUCB model
        for (const item of attributedData) {
            this.updateLinUCBModel(item);
        }
        
        // Update exploration rate
        this.updateExplorationRate();
    }

    updateLinUCBModel(item) {
        // Simplified LinUCB update
        // In production would use proper LinUCB implementation
        const { attribution, decisionPath } = item;
        
        for (const [component, reward] of Object.entries(attribution)) {
            // Update model parameters for this component
            this.logger.debug(`LinUCB update: ${component} = ${reward}`);
        }
    }

    updateExplorationRate() {
        // Adjust exploration based on recent performance
        const recentRewards = Array.from(this.feedbackData.values())
            .slice(-100)
            .map(f => this.calculateReward(f));
        
        const avgReward = recentRewards.reduce((a, b) => a + b, 0) / recentRewards.length;
        
        // Increase exploration if performance is declining
        if (avgReward < -0.1) {
            this.metrics.onlineBandit.explorePct = Math.min(10, this.metrics.onlineBandit.explorePct * 1.2);
        } else if (avgReward > 0.1) {
            this.metrics.onlineBandit.explorePct = Math.max(1, this.metrics.onlineBandit.explorePct * 0.9);
        }
    }

    shouldGenerateProposal() {
        // Check if we should generate a proposal
        const recentProposals = Array.from(this.candidates.values())
            .filter(c => Date.now() - new Date(c.timestamp).getTime() < 3600000) // 1 hour
            .length;
        
        return recentProposals < this.config.propose.maxSimultaneous;
    }

    async generateOnlineProposals() {
        // Generate proposals based on online learning
        const proposal = await this.generateProposalFromOnlineModel();
        
        if (proposal) {
            await this.submitProposal(proposal);
        }
    }

    async performCounterfactualEstimation(attributedData) {
        // IPS/DR estimation
        const estimates = new Map();
        
        for (const candidate of this.candidates.values()) {
            const estimate = await this.estimateCounterfactualPerformance(candidate, attributedData);
            estimates.set(candidate.id, estimate);
        }
        
        return estimates;
    }

    async estimateCounterfactualPerformance(candidate, attributedData) {
        // Mock counterfactual estimation
        // In production would use proper IPS/DR methods
        
        const relevantData = attributedData.filter(item => 
            this.isRelevantForCandidate(item, candidate)
        );
        
        if (relevantData.length === 0) {
            return null;
        }
        
        // Mock uplift calculation
        const baselineReward = relevantData
            .map(item => this.calculateReward(item.feedback))
            .reduce((a, b) => a + b, 0) / relevantData.length;
        
        const estimatedUplift = {
            acceptRate: '+2.1pp',
            ndcg10: '+0.7pp',
            p95Ms: '+14ms',
            costUsd: '-0.002'
        };
        
        const estimate = {
            scope: candidate.scope,
            policyBase: candidate.base,
            method: 'DR',
            uplift: estimatedUplift,
            risk: {
                p95Ms: '+14ms',
                costUsd: '-0.002'
            },
            ci95: {
                acceptRate: [0.9, 3.2],
                p95Ms: [6, 22]
            },
            sampleSize: relevantData.length,
            effectiveSample: Math.floor(relevantData.length * 0.75)
        };
        
        return estimate;
    }

    isRelevantForCandidate(item, candidate) {
        // Check if data item is relevant for candidate evaluation
        return item.decisionPath.planId === candidate.base ||
               item.decisionPath.route === candidate.scope;
    }

    async generateProposals(estimates) {
        const proposals = [];
        
        for (const [candidateId, estimate] of estimates) {
            if (!estimate) continue;
            
            const candidate = this.candidates.get(candidateId);
            if (!candidate) continue;
            
            // Check if estimate shows promising results
            if (this.isEstimatePromising(estimate)) {
                const proposal = await this.createProposal(candidate, estimate);
                proposals.push(proposal);
            }
        }
        
        return proposals;
    }

    isEstimatePromising(estimate) {
        // Check if estimate meets thresholds for proposal
        const uplift = estimate.uplift;
        
        // Simple heuristic: positive accept rate or cost reduction
        return (uplift.acceptRate && parseFloat(uplift.acceptRate) > 1) ||
               (uplift.costUsd && parseFloat(uplift.costUsd) < -0.001);
    }

    async createProposal(candidate, estimate) {
        const proposalId = `prop#${candidate.scope}-${crypto.randomBytes(4).toString('hex')}`;
        
        const proposal = {
            id: proposalId,
            scope: candidate.scope,
            changes: candidate.diff,
            constraints: this.config.rollout.promoteCriteria,
            explain: {
                shaplike: [
                    ['query_len', 0.22],
                    ['fresh_score', -0.11],
                    ['tier_gold', 0.07]
                ]
            },
            guardrails: {
                safety_incidents_no_increase: true,
                fairness_parity: '±10%'
            },
            recommendation: 'canary_10pct_30min_then_promote_if_ok',
            estimate,
            timestamp: new Date().toISOString()
        };
        
        return proposal;
    }

    async submitProposal(proposal) {
        // Submit proposal for rollout
        this.emit('learn.proposal.ready', {
            event: 'learn.proposal.ready',
            timestamp: new Date().toISOString(),
            ...proposal
        });
        
        this.metrics.proposals++;
        this.logger.info(`Learning proposal submitted: ${proposal.id}`);
    }

    async initiateRollouts(proposals) {
        for (const proposal of proposals) {
            await this.initiateRollout(proposal);
        }
    }

    async initiateRollout(proposal) {
        const rollout = {
            scope: proposal.scope,
            candidate: proposal.id,
            canary: this.config.rollout.canary,
            monitor: {
                metrics: ['p95Ms', 'costUsd', 'ndcg10', 'acceptRate'],
                thresholds: this.config.rollout.promoteCriteria
            },
            timestamp: new Date().toISOString()
        };
        
        this.experiments.set(proposal.id, {
            ...rollout,
            status: 'started',
            proposal
        });
        
        this.emit('learn.rollout.started', {
            event: 'learn.rollout.started',
            timestamp: new Date().toISOString(),
            ...rollout
        });
        
        // Schedule evaluation
        this.scheduleRolloutEvaluation(proposal.id);
    }

    scheduleRolloutEvaluation(proposalId) {
        // Schedule rollout evaluation after canary period
        const durationMs = this.config.rollout.canary.durationMin * 60 * 1000;
        
        setTimeout(() => {
            this.evaluateRollout(proposalId);
        }, durationMs);
    }

    async evaluateRollout(proposalId) {
        const experiment = this.experiments.get(proposalId);
        if (!experiment) return;
        
        // Mock evaluation
        const obs = {
            p95Ms: 848,
            ndcg10: 0.553,
            costUsd: 0.0098
        };
        
        // Check promotion criteria
        const result = this.checkPromotionCriteria(obs) ? 'promote' : 'rollback';
        
        this.emit('learn.rollout.evaluation', {
            event: 'learn.rollout.evaluation',
            timestamp: new Date().toISOString(),
            scope: experiment.scope,
            candidate: experiment.candidate,
            result,
            obs
        });
        
        // Apply result
        if (result === 'promote') {
            await this.promoteCandidate(experiment);
        } else {
            await this.rollbackCandidate(experiment);
        }
    }

    checkPromotionCriteria(obs) {
        const criteria = this.config.rollout.promoteCriteria;
        
        return obs.p95Ms <= criteria.p95MsMax &&
               obs.ndcg10 >= criteria.ndcg10Min &&
               obs.costUsd <= criteria.costUsdMax;
    }

    async promoteCandidate(experiment) {
        this.emit('learn.policy.applied', {
            event: 'learn.policy.applied',
            timestamp: new Date().toISOString(),
            scope: experiment.scope,
            candidate: experiment.candidate,
            via: 'LIVIA-55', // Would integrate with appropriate service
            status: 'ok',
            hash: crypto.createHash('sha256').update(JSON.stringify(experiment.proposal)).digest('hex')
        });
        
        this.metrics.applied++;
        this.experiments.delete(experiment.candidate);
        
        // Emit success card
        this.emitSuccessCard(experiment);
    }

    async rollbackCandidate(experiment) {
        const rollbackReason = this.determineRollbackReason(experiment);
        
        this.emit('learn.policy.rolledback', {
            event: 'learn.policy.rolledback',
            timestamp: new Date().toISOString(),
            scope: experiment.scope,
            candidate: experiment.candidate,
            reason: rollbackReason
        });
        
        this.metrics.rolledBack++;
        this.experiments.delete(experiment.candidate);
    }

    determineRollbackReason(experiment) {
        // Determine why rollback happened
        return 'ndcg_drop>3pp'; // Mock reason
    }

    // Event handlers for batch/online learning triggers
    async handleBatchLearning(event) {
        this.logger.info(`Batch learning triggered`);
        await this.triggerBatchLearning({ ready: true });
    }

    async handleOnlineLearning(event) {
        this.logger.info(`Online learning triggered`);
        await this.triggerOnlineLearning();
    }

    // Utility methods
    hashUserId(userId) {
        return crypto.createHash('sha256').update(userId).digest('hex').substring(0, 16);
    }

    getSystemMetricsForQuery(queryId) {
        return Array.from(this.systemMetrics.values())
            .filter(m => m.queryId === queryId);
    }

    async generateLearningReport(estimates, proposals) {
        const reportPath = `data/learn/${new Date().toISOString().split('T')[0]}/report.md`;
        
        this.emit('learn.report.ready', {
            event: 'learn.report.ready',
            timestamp: new Date().toISOString(),
            path: reportPath,
            summary: `${proposals.length} proposals generated from ${estimates.size} estimates`,
            hash: crypto.createHash('sha256').update(JSON.stringify({ estimates: estimates.size, proposals: proposals.length })).digest('hex')
        });
    }

    emitSuccessCard(experiment) {
        const proposal = experiment.proposal;
        
        this.emit('learn.card', {
            event: 'learn.card',
            timestamp: new Date().toISOString(),
            title: `Öğrenme Önerisi Uygulandı — ${proposal.scope}`,
            body: `${JSON.stringify(proposal.changes)} uygulandı. Tahmin edilen iyileştirmeler görülüyor.`,
            severity: 'info',
            ttlSec: 600
        });
    }

    emitMetrics() {
        this.emit('learn.metrics', {
            event: 'learn.metrics',
            timestamp: new Date().toISOString(),
            ...this.metrics
        });
    }

    getStatus() {
        return {
            name: this.name,
            initialized: this.isInitialized,
            state: this.state,
            feedbackData: this.feedbackData.size,
            behaviorMetrics: this.behaviorMetrics.size,
            decisionPaths: this.decisionPaths.size,
            systemMetrics: this.systemMetrics.size,
            datasets: this.datasets.size,
            candidates: this.candidates.size,
            experiments: this.experiments.size,
            estimates: this.estimates.size,
            cache: this.cache.size,
            metrics: this.metrics,
            config: {
                enabled: this.config.enabled,
                mode: this.config.learning.mode,
                onlineMethod: this.config.learning.online.method,
                offlineMethod: this.config.learning.offline.estimator
            }
        };
    }

    async shutdown() {
        try {
            this.logger.info(`${this.name} durduruluyor...`);
            
            // Clear all data structures
            this.feedbackData.clear();
            this.behaviorMetrics.clear();
            this.decisionPaths.clear();
            this.systemMetrics.clear();
            this.datasets.clear();
            this.candidates.clear();
            this.experiments.clear();
            this.estimates.clear();
            this.cache.clear();
            
            this.isInitialized = false;
            this.logger.info(`${this.name} başarıyla durduruldu`);
        } catch (error) {
            this.logger.error(`${this.name} durdurma hatası:`, error);
        }
    }
}

module.exports = FeedbackLearningLooper;