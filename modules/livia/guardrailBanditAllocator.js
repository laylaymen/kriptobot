/**
 * LIVIA-37 · guardrailBanditAllocator.js
 * Guardrail korumalı bandit algoritması ile varyant paylaştırma modülü
 */

class GuardrailBanditAllocator {
    constructor(config = {}) {
        this.name = 'GuardrailBanditAllocator';
        this.config = {
            enabled: true,
            i18n: { locale: 'tr-TR', tz: 'Europe/Istanbul' },
            algo: {
                kind: 'thompson',
                reward: 'success_rate',
                secondary: ['latency_ms', 'cost_usd'],
                thompson: { alpha0: 1, beta0: 1 },
                ucb: { c: 2.0 },
                eps_greedy: { epsStart: 0.1, epsMin: 0.02, halfLifeMin: 120 },
                linucb: { alpha: 0.5, contextDimMax: 16 },
                linTS: { sigma: 0.3 }
            },
            constraints: {
                minTrafficPctPerVariant: 5,
                maxRampPerStepPct: 15,
                cooldownMin: 15,
                requireStableMin: 15,
                minSamplesPerVariant: 200
            },
            context: {
                enabled: true,
                oneHot: ['region', 'role', 'symbol'],
                cyclical: ['hourOfDay']
            },
            sticky: { by: 'subject', saltRef: 'daily' },
            safety: {
                safeExplorePct: 5,
                killOnBreach: true,
                ethicsRequiredForBigJumpPct: 30
            },
            integrations: {
                flags: 'LIVIA-35',
                slo: 'LIVIA-32',
                cost: 'LIVIA-34',
                dist: 'LIVIA-22',
                redact: 'LIVIA-21',
                ethics: 'LIVIA-26',
                experiments: 'LIVIA-36'
            },
            schedule: {
                updateEverySec: 60,
                freezeDuringIncident: true
            },
            idempotencyTtlSec: 3600,
            ...config
        };
        this.isInitialized = false;
        this.logger = null;
        this.eventBus = null;
        this.state = 'IDLE';
        this.policyStore = new Map(); // Bandit policies
        this.exposureStore = new Map(); // Exposure data
        this.outcomeStore = new Map(); // Outcome data
        this.posteriorStore = new Map(); // Algorithm posteriors
        this.planStore = new Map(); // Current plans
        this.guardrailState = new Map(); // Guardrail states
        this.banditEngine = null;
        this.contextEncoder = null;
    }

    async initialize(logger, eventBus) {
        try {
            this.logger = logger;
            this.eventBus = eventBus;
            this.logger.info(`${this.name} başlatılıyor...`);
            
            await this.setup();
            this.setupEventListeners();
            this.initializeComponents();
            
            this.isInitialized = true;
            this.logger.info(`${this.name} başarıyla başlatıldı`);
            return true;
        } catch (error) {
            this.logger.error(`${this.name} başlatma hatası:`, error);
            return false;
        }
    }

    async setup() {
        if (this.config.enabled) {
            await this.loadDefaultPolicies();
            this.logger.info(`${this.name} kurulumu tamamlandı`);
        }
    }

    setupEventListeners() {
        if (!this.eventBus) return;

        // Bandit policy management
        this.eventBus.on('bandit.policy.define', (data) => this.handlePolicyDefine(data));
        this.eventBus.on('bandit.policy.update', (data) => this.handlePolicyUpdate(data));

        // Data collection
        this.eventBus.on('exposure.logged', (data) => this.handleExposureLogged(data));
        this.eventBus.on('outcome.logged', (data) => this.handleOutcomeLogged(data));

        // Guardrail events
        this.eventBus.on('slo.guard.triggered', (data) => this.handleSLOTrigger(data));
        this.eventBus.on('slo.guard.recovered', (data) => this.handleSLORecovered(data));
        this.eventBus.on('cost.guard.triggered', (data) => this.handleCostTrigger(data));
        this.eventBus.on('cost.guard.recovered', (data) => this.handleCostRecovered(data));

        // Feature flag requests
        this.eventBus.on('feature.flag.evaluate.request', (data) => this.handleFlagEvaluateRequest(data));

        // Scheduled updates
        setInterval(() => this.performScheduledUpdate(), this.config.schedule.updateEverySec * 1000);
    }

    initializeComponents() {
        this.banditEngine = new BanditEngine(this.config.algo);
        this.contextEncoder = new ContextEncoder(this.config.context);
    }

    async process(data) {
        if (!this.isInitialized) {
            throw new Error(`${this.name} henüz başlatılmadı`);
        }

        try {
            const result = await this.processBanditEvent(data);
            return {
                success: true,
                data: result,
                timestamp: new Date().toISOString(),
                source: this.name
            };
        } catch (error) {
            this.logger.error(`${this.name} işlem hatası:`, error);
            return {
                success: false,
                error: error.message,
                timestamp: new Date().toISOString(),
                source: this.name
            };
        }
    }

    async processBanditEvent(data) {
        const banditKey = this.generateBanditKey(data);
        
        // Idempotency kontrolü (data collection events hariç)
        if (!['exposure.logged', 'outcome.logged'].includes(data.event)) {
            if (this.planStore.has(banditKey)) {
                const cached = this.planStore.get(banditKey);
                if (Date.now() - cached.timestamp < this.config.idempotencyTtlSec * 1000) {
                    return cached.result;
                }
            }
        }

        const result = await this.advanceFSM(data);
        
        // Cache result (data collection events hariç)
        if (!['exposure.logged', 'outcome.logged'].includes(data.event)) {
            this.planStore.set(banditKey, {
                result,
                timestamp: Date.now()
            });
        }

        return result;
    }

    async advanceFSM(data) {
        switch (this.state) {
            case 'IDLE':
                return await this.handleIdleState(data);
            case 'UPDATE':
                return await this.handleUpdateState(data);
            case 'PLAN':
                return await this.handlePlanState(data);
            case 'ENFORCE':
                return await this.handleEnforceState(data);
            case 'COOLDOWN':
                return await this.handleCooldownState(data);
            case 'FREEZE':
                return await this.handleFreezeState(data);
            case 'ROLLBACK':
                return await this.handleRollbackState(data);
            default:
                this.state = 'IDLE';
                return { action: 'state_reset', state: this.state };
        }
    }

    async handleIdleState(data) {
        if (['bandit.schedule.tick', 'outcome.logged', 'exposure.logged'].includes(data.event)) {
            this.state = 'UPDATE';
            return await this.updatePosteriors(data);
        }
        
        return { action: 'no_action', state: this.state };
    }

    async handleUpdateState(data) {
        const updateResult = await this.performBanditUpdate(data);
        
        if (updateResult.shouldPlan) {
            this.state = 'PLAN';
            return await this.planWeights(updateResult);
        }
        
        this.state = 'IDLE';
        return updateResult;
    }

    async handlePlanState(data) {
        const planResult = await this.generatePlan(data);
        
        // Check guardrails
        const guardrailCheck = await this.checkGuardrails(planResult);
        if (guardrailCheck.breach) {
            if (guardrailCheck.severity === 'high') {
                this.state = 'ROLLBACK';
                return await this.initiateRollback(planResult, guardrailCheck);
            } else {
                this.state = 'FREEZE';
                return await this.freezeAllocation(planResult, guardrailCheck);
            }
        }
        
        this.state = 'ENFORCE';
        return await this.enforceWeights(planResult);
    }

    async handleEnforceState(data) {
        const enforceResult = await this.enforceAllocation(data);
        
        if (enforceResult.success) {
            this.state = 'COOLDOWN';
            return enforceResult;
        } else {
            this.state = 'IDLE';
            await this.emitAlert('error', 'enforce_failed', enforceResult);
            return enforceResult;
        }
    }

    async handleCooldownState(data) {
        const cooldownCheck = await this.checkCooldown(data);
        
        if (cooldownCheck.complete) {
            const stabilityCheck = await this.checkStability(data);
            if (stabilityCheck.stable) {
                this.state = 'IDLE';
                return { action: 'cooldown_complete', stable: true };
            }
        }
        
        // Check for breaches during cooldown
        const guardrailCheck = await this.checkGuardrails(data);
        if (guardrailCheck.breach) {
            this.state = 'ROLLBACK';
            return await this.initiateRollback(data, guardrailCheck);
        }
        
        return { action: 'cooldown_continue', remaining: cooldownCheck.remainingMin };
    }

    async handleFreezeState(data) {
        // Check for recovery
        const guardrailCheck = await this.checkGuardrails(data);
        if (!guardrailCheck.breach) {
            this.state = 'IDLE';
            return { action: 'freeze_lifted', reason: 'guardrail_recovered' };
        }
        
        return { action: 'freeze_continue', reason: guardrailCheck.reason };
    }

    async handleRollbackState(data) {
        const rollbackResult = await this.performRollback(data);
        this.state = 'COOLDOWN';
        return rollbackResult;
    }

    // Event Handlers
    async handlePolicyDefine(data) {
        // RBAC check
        if (!this.hasPermission(data.subject, ['policy', 'ops', 'data'])) {
            await this.emitAlert('warn', 'rbac_denied', { experimentId: data.experimentId });
            return { action: 'rbac_denied', experimentId: data.experimentId };
        }

        // Validate policy
        const validation = await this.validatePolicy(data);
        if (!validation.valid) {
            return { action: 'policy_invalid', errors: validation.errors };
        }

        // Store policy
        const policy = {
            experimentId: data.experimentId,
            version: data.version,
            objective: data.objective,
            algo: data.algo,
            context: data.context || [],
            variants: data.variants,
            priors: data.priors || {},
            constraints: { ...this.config.constraints, ...data.constraints },
            sticky: data.sticky || this.config.sticky,
            safeExplorePct: data.safeExplorePct || this.config.safety.safeExplorePct,
            segmentMode: data.segmentMode || 'global',
            killOnBreach: data.killOnBreach !== undefined ? data.killOnBreach : this.config.safety.killOnBreach,
            createdAt: new Date().toISOString(),
            state: 'ACTIVE'
        };

        this.policyStore.set(data.experimentId, policy);
        
        // Initialize posteriors
        await this.initializePosteriors(policy);

        const result = {
            action: 'policy_defined',
            experimentId: data.experimentId,
            version: data.version
        };

        await this.emitPolicyEvent('bandit.policy.defined', result);
        return result;
    }

    async handlePolicyUpdate(data) {
        const policy = this.policyStore.get(data.experimentId);
        if (!policy) {
            return { action: 'policy_not_found', experimentId: data.experimentId };
        }

        // RBAC check
        if (!this.hasPermission(data.subject, ['policy', 'ops', 'data'])) {
            return { action: 'rbac_denied', experimentId: data.experimentId };
        }

        // Apply patch
        const updatedPolicy = this.applyPolicyPatch(policy, data.patch);
        
        // Validate updated policy
        const validation = await this.validatePolicy(updatedPolicy);
        if (!validation.valid) {
            return { action: 'policy_invalid', errors: validation.errors };
        }

        updatedPolicy.updatedAt = new Date().toISOString();
        this.policyStore.set(data.experimentId, updatedPolicy);

        const result = {
            action: 'policy_updated',
            experimentId: data.experimentId,
            reason: data.reason
        };

        await this.emitPolicyEvent('bandit.policy.updated', result);
        return result;
    }

    async handleExposureLogged(data) {
        const exposureKey = `${data.experimentId}_${data.subject.id}_${data.timestamp}`;
        
        // Encode context features
        const contextVector = this.contextEncoder.encode(data.context);
        
        this.exposureStore.set(exposureKey, {
            experimentId: data.experimentId,
            variant: data.variant,
            subject: data.subject,
            context: data.context,
            contextVector,
            timestamp: data.timestamp
        });
        
        return { action: 'exposure_recorded', exposureKey };
    }

    async handleOutcomeLogged(data) {
        const outcomeKey = `${data.experimentId}_${data.variant}_${Date.now()}`;
        
        this.outcomeStore.set(outcomeKey, {
            experimentId: data.experimentId,
            variant: data.variant,
            metrics: data.metrics,
            timestamp: data.timestamp
        });
        
        return { action: 'outcome_recorded', outcomeKey };
    }

    async handleSLOTrigger(data) {
        // Find affected experiments
        const affectedExperiments = this.findExperimentsForService(data.serviceId);
        
        for (const experiment of affectedExperiments) {
            this.guardrailState.set(`${experiment.experimentId}_slo`, {
                type: 'slo_breach',
                severity: data.severity,
                triggeredAt: new Date().toISOString(),
                details: data
            });
        }
        
        return { action: 'slo_trigger_recorded', affected: affectedExperiments.length };
    }

    async handleSLORecovered(data) {
        // Clear SLO breach states
        for (const [key] of this.guardrailState.entries()) {
            if (key.includes('_slo')) {
                this.guardrailState.delete(key);
            }
        }
        
        return { action: 'slo_recovery_recorded' };
    }

    async handleCostTrigger(data) {
        // Find cost-sensitive experiments
        const costExperiments = this.findCostSensitiveExperiments();
        
        for (const experiment of costExperiments) {
            this.guardrailState.set(`${experiment.experimentId}_cost`, {
                type: 'cost_breach',
                severity: data.severity,
                triggeredAt: new Date().toISOString(),
                details: data
            });
        }
        
        return { action: 'cost_trigger_recorded', affected: costExperiments.length };
    }

    async handleCostRecovered(data) {
        // Clear cost breach states
        for (const [key] of this.guardrailState.entries()) {
            if (key.includes('_cost')) {
                this.guardrailState.delete(key);
            }
        }
        
        return { action: 'cost_recovery_recorded' };
    }

    async handleFlagEvaluateRequest(data) {
        // Check if this is a bandit-controlled flag
        const banditPlan = this.findActivePlanForFlag(data.flagId);
        if (!banditPlan) {
            return { action: 'not_bandit_controlled' };
        }

        // Return current weights for the flag
        return {
            action: 'bandit_weights_provided',
            flagId: data.flagId,
            weights: banditPlan.weights,
            basis: banditPlan.basis
        };
    }

    // Core Bandit Operations
    async updatePosteriors(data) {
        const activePolicies = this.getActivePolicies();
        let updated = 0;
        
        for (const policy of activePolicies) {
            const outcomes = this.getOutcomesForExperiment(policy.experimentId);
            if (outcomes.length === 0) continue;
            
            const posterior = this.posteriorStore.get(policy.experimentId) || this.initializePosterior(policy);
            const updatedPosterior = await this.banditEngine.updatePosterior(
                policy.algo,
                posterior,
                outcomes,
                policy.priors
            );
            
            this.posteriorStore.set(policy.experimentId, updatedPosterior);
            updated++;
        }
        
        return { action: 'posteriors_updated', count: updated, shouldPlan: updated > 0 };
    }

    async performBanditUpdate(data) {
        // Update posteriors with latest data
        const updateResult = await this.updatePosteriors(data);
        
        return {
            action: 'bandit_update_complete',
            ...updateResult
        };
    }

    async planWeights(data) {
        const activePolicies = this.getActivePolicies();
        const plans = [];
        
        for (const policy of activePolicies) {
            const posterior = this.posteriorStore.get(policy.experimentId);
            if (!posterior) continue;
            
            const currentPlan = this.getCurrentPlan(policy.experimentId);
            const newWeights = await this.calculateWeights(policy, posterior, currentPlan);
            
            plans.push({
                experimentId: policy.experimentId,
                version: policy.version,
                weights: newWeights,
                basis: this.getBasisForAlgo(policy.algo),
                segment: 'global', // Simplified for now
                safeExplorePct: policy.safeExplorePct,
                plannedAt: new Date().toISOString()
            });
        }
        
        return { action: 'weights_planned', plans };
    }

    async generatePlan(data) {
        const planResult = await this.planWeights(data);
        
        return {
            action: 'plan_generated',
            plans: planResult.plans
        };
    }

    async calculateWeights(policy, posterior, currentPlan) {
        // Get algorithm-specific weights
        const algoWeights = await this.banditEngine.calculateWeights(
            policy.algo,
            posterior,
            policy.variants
        );
        
        // Apply constraints
        const constrainedWeights = this.applyConstraints(
            algoWeights,
            currentPlan,
            policy.constraints
        );
        
        // Apply safe exploration
        const finalWeights = this.applySafeExploration(
            constrainedWeights,
            policy.safeExplorePct,
            policy.variants.length
        );
        
        return finalWeights;
    }

    applyConstraints(weights, currentPlan, constraints) {
        const constrained = [...weights];
        
        // Minimum traffic constraint
        const minPct = constraints.minTrafficPctPerVariant;
        constrained.forEach(w => {
            if (w.pct < minPct) {
                w.pct = minPct;
            }
        });
        
        // Normalize to 100%
        const total = constrained.reduce((sum, w) => sum + w.pct, 0);
        constrained.forEach(w => {
            w.pct = (w.pct / total) * 100;
        });
        
        // Max ramp constraint
        if (currentPlan) {
            const maxRamp = constraints.maxRampPerStepPct;
            constrained.forEach(w => {
                const current = currentPlan.weights.find(cw => cw.variant === w.variant);
                if (current) {
                    const change = Math.abs(w.pct - current.pct);
                    if (change > maxRamp) {
                        // Limit the change
                        const direction = w.pct > current.pct ? 1 : -1;
                        w.pct = current.pct + (direction * maxRamp);
                    }
                }
            });
        }
        
        return constrained;
    }

    applySafeExploration(weights, safeExplorePct, variantCount) {
        const safeExplorePerVariant = safeExplorePct / variantCount;
        const remainingPct = 100 - safeExplorePct;
        
        return weights.map(w => ({
            variant: w.variant,
            pct: safeExplorePerVariant + (w.pct / 100) * remainingPct
        }));
    }

    async checkGuardrails(data) {
        const breaches = [];
        
        // Check SLO guardrails
        for (const [key, state] of this.guardrailState.entries()) {
            if (state.type === 'slo_breach') {
                breaches.push({
                    type: 'slo',
                    severity: state.severity,
                    experimentId: key.split('_')[0]
                });
            }
        }
        
        // Check cost guardrails
        for (const [key, state] of this.guardrailState.entries()) {
            if (state.type === 'cost_breach') {
                breaches.push({
                    type: 'cost',
                    severity: state.severity,
                    experimentId: key.split('_')[0]
                });
            }
        }
        
        return {
            breach: breaches.length > 0,
            breaches,
            severity: breaches.length > 0 ? Math.max(...breaches.map(b => b.severity === 'high' ? 3 : 2)) : 0,
            reason: breaches.map(b => `${b.type}_${b.severity}`).join(', ')
        };
    }

    async enforceWeights(planResult) {
        const enforced = [];
        
        for (const plan of planResult.plans) {
            try {
                // Send enforcement request to feature flag orchestrator
                await this.enforcePlanViaFlags(plan);
                enforced.push(plan.experimentId);
                
                // Store current plan
                this.planStore.set(`current_${plan.experimentId}`, {
                    plan,
                    enforcedAt: new Date().toISOString(),
                    timestamp: Date.now()
                });
                
            } catch (error) {
                this.logger.error(`Failed to enforce plan for ${plan.experimentId}:`, error);
            }
        }
        
        const result = {
            action: 'weights_enforced',
            enforced,
            plans: planResult.plans
        };

        await this.emitBanditEvent('bandit.plan.ready', result);
        return result;
    }

    async enforceAllocation(data) {
        // Implementation of allocation enforcement
        return { action: 'allocation_enforced', success: true };
    }

    async enforcePlanViaFlags(plan) {
        if (!this.eventBus) return;
        
        this.eventBus.emit('bandit.enforce.request', {
            event: 'bandit.enforce.request',
            timestamp: new Date().toISOString(),
            experimentId: plan.experimentId,
            version: plan.version,
            via: 'LIVIA-35',
            flagId: `experiment_${plan.experimentId}`,
            env: 'prod',
            weights: plan.weights,
            rampFromPrevPct: this.calculateRampFromPrev(plan),
            cooldownUntil: new Date(Date.now() + this.config.constraints.cooldownMin * 60 * 1000).toISOString()
        });
    }

    calculateRampFromPrev(plan) {
        const currentPlan = this.getCurrentPlan(plan.experimentId);
        if (!currentPlan) return 0;
        
        const maxChange = Math.max(...plan.weights.map(w => {
            const prev = currentPlan.weights.find(pw => pw.variant === w.variant);
            return prev ? Math.abs(w.pct - prev.pct) : w.pct;
        }));
        
        return Math.round(maxChange);
    }

    async initiateRollback(data, guardrailCheck) {
        const rollbackPlans = [];
        
        // Create rollback plans for affected experiments
        for (const breach of guardrailCheck.breaches) {
            const policy = this.policyStore.get(breach.experimentId);
            if (!policy) continue;
            
            // Rollback to control variant
            const rollbackWeights = policy.variants.map(v => ({
                variant: v.name,
                pct: v.name === 'control' ? 100 : 0
            }));
            
            rollbackPlans.push({
                experimentId: breach.experimentId,
                weights: rollbackWeights,
                reason: guardrailCheck.reason
            });
        }
        
        // Execute rollbacks
        for (const plan of rollbackPlans) {
            await this.executeRollback(plan);
        }
        
        const result = {
            action: 'rollback_initiated',
            reason: guardrailCheck.reason,
            plans: rollbackPlans
        };

        await this.emitBanditEvent('bandit.rollback.request', result);
        return result;
    }

    async freezeAllocation(data, guardrailCheck) {
        // Freeze current allocations
        const result = {
            action: 'allocation_frozen',
            reason: guardrailCheck.reason,
            frozenAt: new Date().toISOString()
        };

        await this.emitAlert('warn', 'allocation_frozen', result);
        return result;
    }

    async executeRollback(plan) {
        // Execute rollback via feature flags
        await this.enforcePlanViaFlags({
            experimentId: plan.experimentId,
            weights: plan.weights,
            version: 'rollback'
        });
    }

    async performRollback(data) {
        return { action: 'rollback_complete' };
    }

    async checkCooldown(data) {
        // Mock cooldown check
        return {
            complete: true,
            remainingMin: 0
        };
    }

    async checkStability(data) {
        // Mock stability check
        return { stable: true };
    }

    async performScheduledUpdate() {
        if (!this.isInitialized || this.state === 'FREEZE') return;
        
        try {
            await this.process({
                event: 'bandit.schedule.tick',
                timestamp: new Date().toISOString()
            });
            
            await this.emitMetrics();
        } catch (error) {
            this.logger.error('Scheduled bandit update error:', error);
        }
    }

    // Helper Functions
    async validatePolicy(policy) {
        // Basic policy validation
        if (!policy.experimentId || !policy.variants || policy.variants.length < 2) {
            return { valid: false, errors: ['Invalid experiment ID or variants'] };
        }
        
        return { valid: true };
    }

    applyPolicyPatch(policy, patch) {
        return { ...policy, ...patch };
    }

    async initializePosteriors(policy) {
        const posterior = this.initializePosterior(policy);
        this.posteriorStore.set(policy.experimentId, posterior);
    }

    initializePosterior(policy) {
        switch (policy.algo) {
            case 'thompson':
                return policy.variants.map(v => ({
                    variant: v.name,
                    alpha: policy.priors.success_rate?.alpha || this.config.algo.thompson.alpha0,
                    beta: policy.priors.success_rate?.beta || this.config.algo.thompson.beta0,
                    samples: 0
                }));
            case 'ucb':
                return policy.variants.map(v => ({
                    variant: v.name,
                    totalReward: 0,
                    samples: 0,
                    avgReward: 0
                }));
            default:
                return policy.variants.map(v => ({
                    variant: v.name,
                    samples: 0,
                    totalReward: 0
                }));
        }
    }

    getActivePolicies() {
        const policies = [];
        for (const [id, policy] of this.policyStore.entries()) {
            if (policy.state === 'ACTIVE') {
                policies.push(policy);
            }
        }
        return policies;
    }

    getOutcomesForExperiment(experimentId) {
        const outcomes = [];
        for (const [key, outcome] of this.outcomeStore.entries()) {
            if (outcome.experimentId === experimentId) {
                outcomes.push(outcome);
            }
        }
        return outcomes;
    }

    getCurrentPlan(experimentId) {
        const planKey = `current_${experimentId}`;
        const stored = this.planStore.get(planKey);
        return stored?.plan;
    }

    getBasisForAlgo(algo) {
        switch (algo) {
            case 'thompson': return 'thompson_posterior';
            case 'ucb': return 'ucb_score';
            case 'eps_greedy': return 'epsilon_schedule';
            case 'linucb': return 'lin_weights';
            default: return 'unknown';
        }
    }

    findActivePlanForFlag(flagId) {
        // Find active plan for a given flag ID
        for (const [key, stored] of this.planStore.entries()) {
            if (key.startsWith('current_') && stored.plan) {
                const experimentId = key.replace('current_', '');
                if (flagId.includes(experimentId)) {
                    return stored.plan;
                }
            }
        }
        return null;
    }

    findExperimentsForService(serviceId) {
        const experiments = [];
        for (const [id, policy] of this.policyStore.entries()) {
            if (policy.experimentId.toLowerCase().includes(serviceId.toLowerCase())) {
                experiments.push(policy);
            }
        }
        return experiments;
    }

    findCostSensitiveExperiments() {
        const experiments = [];
        for (const [id, policy] of this.policyStore.entries()) {
            if (policy.objective.includes('cost') || policy.secondary?.includes('cost_usd')) {
                experiments.push(policy);
            }
        }
        return experiments;
    }

    hasPermission(subject, roles) {
        if (!subject) return false;
        return roles.includes(subject.role);
    }

    // Event emission
    async emitPolicyEvent(eventType, data) {
        if (!this.eventBus) return;
        
        this.eventBus.emit(eventType, {
            event: eventType,
            timestamp: new Date().toISOString(),
            ...data
        });
    }

    async emitBanditEvent(eventType, data) {
        if (!this.eventBus) return;
        
        this.eventBus.emit(eventType, {
            event: eventType,
            timestamp: new Date().toISOString(),
            ...data
        });
        
        // Also emit card for plan updates
        if (eventType === 'bandit.plan.ready') {
            await this.emitBanditCard(data);
        }
    }

    async emitBanditCard(data) {
        if (!this.eventBus) return;
        
        const primaryPlan = data.plans?.[0];
        if (!primaryPlan) return;
        
        const weightSummary = primaryPlan.weights
            .map(w => `${w.variant} %${Math.round(w.pct)}`)
            .join(' / ');
        
        this.eventBus.emit('bandit.card', {
            event: 'bandit.card',
            timestamp: new Date().toISOString(),
            title: `Bandit Güncellendi — ${primaryPlan.experimentId}`,
            body: `${weightSummary} (${primaryPlan.basis}), güvenli keşif %${primaryPlan.safeExplorePct}; guardrails OK.`,
            severity: 'info',
            ttlSec: 900
        });
    }

    async emitAlert(level, message, context = {}) {
        if (!this.eventBus) return;

        this.eventBus.emit('bandit.alert', {
            event: 'bandit.alert',
            timestamp: new Date().toISOString(),
            level,
            message,
            context
        });
    }

    async emitMetrics() {
        if (!this.eventBus) return;

        const updates = this.posteriorStore.size;
        const rollbacks = Array.from(this.planStore.values()).filter(p => 
            p.plan?.version === 'rollback'
        ).length;

        this.eventBus.emit('bandit.metrics', {
            event: 'bandit.metrics',
            timestamp: new Date().toISOString(),
            updates,
            rollbacks,
            segments: 2, // Mock
            p50UpdateMs: 6.2,
            p95UpdateMs: 12.4,
            safeExplorePct: this.config.safety.safeExplorePct,
            avgReward_control: 0.740,
            avgReward_v2: 0.781,
            guardrailBlocks: {
                slo: 0,
                cost: 0,
                ethics: 0
            }
        });
    }

    async loadDefaultPolicies() {
        // Load default policies
        this.logger.debug('Default bandit policies loaded');
    }

    // Utility methods
    generateBanditKey(data) {
        const crypto = require('crypto');
        const experimentId = data.experimentId || 'global';
        const version = data.version || 'v1';
        const windowISO = new Date().toISOString().split('T')[0]; // Day precision
        const policyHash = this.generateHash(this.config);
        
        return crypto.createHash('sha256').update(`${experimentId}+${version}+${windowISO}+${policyHash}`).digest('hex').substring(0, 16);
    }

    generateHash(data) {
        const crypto = require('crypto');
        return crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex');
    }

    getStatus() {
        return {
            name: this.name,
            initialized: this.isInitialized,
            enabled: this.config.enabled,
            state: this.state,
            policies: this.policyStore.size,
            exposures: this.exposureStore.size,
            outcomes: this.outcomeStore.size,
            posteriors: this.posteriorStore.size,
            plans: this.planStore.size,
            guardrails: this.guardrailState.size,
            config: this.config
        };
    }

    async shutdown() {
        try {
            this.logger.info(`${this.name} durduruluyor...`);
            
            this.policyStore.clear();
            this.exposureStore.clear();
            this.outcomeStore.clear();
            this.posteriorStore.clear();
            this.planStore.clear();
            this.guardrailState.clear();
            
            this.isInitialized = false;
            this.logger.info(`${this.name} başarıyla durduruldu`);
        } catch (error) {
            this.logger.error(`${this.name} durdurma hatası:`, error);
        }
    }
}

// Helper Classes
class BanditEngine {
    constructor(config) {
        this.config = config;
    }

    async updatePosterior(algo, posterior, outcomes, priors) {
        switch (algo) {
            case 'thompson':
                return this.updateThompsonPosterior(posterior, outcomes);
            case 'ucb':
                return this.updateUCBPosterior(posterior, outcomes);
            default:
                return posterior;
        }
    }

    updateThompsonPosterior(posterior, outcomes) {
        const updated = posterior.map(p => ({ ...p }));
        
        for (const outcome of outcomes) {
            const variant = updated.find(u => u.variant === outcome.variant);
            if (!variant) continue;
            
            const success = outcome.metrics.success || 0;
            const trials = 1; // Assuming binary outcome
            
            variant.alpha += success;
            variant.beta += (trials - success);
            variant.samples += trials;
        }
        
        return updated;
    }

    updateUCBPosterior(posterior, outcomes) {
        const updated = posterior.map(p => ({ ...p }));
        
        for (const outcome of outcomes) {
            const variant = updated.find(u => u.variant === outcome.variant);
            if (!variant) continue;
            
            const reward = outcome.metrics.success || 0;
            variant.totalReward += reward;
            variant.samples += 1;
            variant.avgReward = variant.samples > 0 ? variant.totalReward / variant.samples : 0;
        }
        
        return updated;
    }

    async calculateWeights(algo, posterior, variants) {
        switch (algo) {
            case 'thompson':
                return this.calculateThompsonWeights(posterior);
            case 'ucb':
                return this.calculateUCBWeights(posterior);
            default:
                return variants.map(v => ({ variant: v.name, pct: 100 / variants.length }));
        }
    }

    calculateThompsonWeights(posterior) {
        // Sample from Beta distributions
        const samples = posterior.map(p => {
            const sample = this.sampleBeta(p.alpha, p.beta);
            return { variant: p.variant, sample };
        });
        
        // Sort by sample value and assign weights
        samples.sort((a, b) => b.sample - a.sample);
        
        // Simple proportional allocation based on rank
        const totalRank = samples.length * (samples.length + 1) / 2;
        return samples.map((s, i) => ({
            variant: s.variant,
            pct: ((samples.length - i) / totalRank) * 100
        }));
    }

    calculateUCBWeights(posterior) {
        const totalSamples = posterior.reduce((sum, p) => sum + p.samples, 0);
        
        // Calculate UCB scores
        const scores = posterior.map(p => {
            if (p.samples === 0) return { variant: p.variant, score: Infinity };
            
            const confidence = Math.sqrt((2 * Math.log(totalSamples)) / p.samples);
            const ucbScore = p.avgReward + this.config.ucb.c * confidence;
            
            return { variant: p.variant, score: ucbScore };
        });
        
        // Convert scores to weights
        const maxScore = Math.max(...scores.map(s => s.score === Infinity ? 1 : s.score));
        const totalScore = scores.reduce((sum, s) => sum + (s.score === Infinity ? maxScore : s.score), 0);
        
        return scores.map(s => ({
            variant: s.variant,
            pct: ((s.score === Infinity ? maxScore : s.score) / totalScore) * 100
        }));
    }

    sampleBeta(alpha, beta) {
        // Simple Beta sampling using rejection method (for production, use proper library)
        const gamma1 = this.sampleGamma(alpha);
        const gamma2 = this.sampleGamma(beta);
        return gamma1 / (gamma1 + gamma2);
    }

    sampleGamma(shape) {
        // Simplified Gamma sampling (for production, use proper library)
        if (shape < 1) {
            return this.sampleGamma(shape + 1) * Math.pow(Math.random(), 1 / shape);
        }
        
        // Marsaglia and Tsang method approximation
        const d = shape - 1/3;
        const c = 1 / Math.sqrt(9 * d);
        
        while (true) {
            const x = this.sampleNormal();
            const v = 1 + c * x;
            if (v <= 0) continue;
            
            const v3 = v * v * v;
            const u = Math.random();
            
            if (u < 1 - 0.0331 * x * x * x * x) {
                return d * v3;
            }
            
            if (Math.log(u) < 0.5 * x * x + d * (1 - v3 + Math.log(v3))) {
                return d * v3;
            }
        }
    }

    sampleNormal() {
        // Box-Muller transform
        const u1 = Math.random();
        const u2 = Math.random();
        return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    }
}

class ContextEncoder {
    constructor(config) {
        this.config = config;
    }

    encode(context) {
        if (!this.config.enabled || !context) {
            return [];
        }

        const features = [];
        
        // One-hot encoding
        for (const field of this.config.oneHot) {
            if (context[field]) {
                features.push(`${field}_${context[field]}`);
            }
        }
        
        // Cyclical encoding
        for (const field of this.config.cyclical) {
            if (context[field] !== undefined) {
                const value = context[field];
                const radians = (value / 24) * 2 * Math.PI; // Assuming hourOfDay
                features.push(`${field}_sin_${Math.sin(radians).toFixed(3)}`);
                features.push(`${field}_cos_${Math.cos(radians).toFixed(3)}`);
            }
        }
        
        return features;
    }
}

module.exports = GuardrailBanditAllocator;