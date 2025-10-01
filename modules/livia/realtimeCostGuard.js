/**
 * LIVIA-34 · realtimeCostGuard.js
 * Gerçek zamanlı maliyet koruma ve bütçe yönetimi modülü
 */

class RealtimeCostGuard {
    constructor(config = {}) {
        this.name = 'RealtimeCostGuard';
        this.config = {
            enabled: true,
            i18n: { locale: 'tr-TR', tz: 'Europe/Istanbul', currency: 'USD' },
            windows: ['1h', '6h', '24h', '7d'],
            budgets: {
                daily: { limitUSD: 100, softGuardPct: 0.7, hardGuardPct: 0.9 },
                weekly: { limitUSD: 500, softGuardPct: 0.7, hardGuardPct: 0.9 },
                monthly: { limitUSD: 2000, softGuardPct: 0.7, hardGuardPct: 0.9 }
            },
            perComponent: {
                embeddings: { sharePctMaxDaily: 0.55, allowDowngrade: true, minBatch: 16, maxBatch: 64 },
                vector_query: { topKDefault: 8, topKMin: 4, allowDisableReranker: true },
                vector_upsert: { maxPerHour: 20000, deferIfHardGuard: true },
                dist_push: { throttlePerMin: 30, bigMsgBytes: 48000, dropChannels: ['webhook'] },
                storage: { preferColdstore: true, forceCompression: true },
                compute: { capMinPerDay: 120 },
                html_render: { limitRendersPerHr: 200 }
            },
            forecast: {
                method: 'ewma',
                alpha: 0.3,
                horizonHours: 24,
                includeRates: true
            },
            exclusions: {
                drillShadowExclude: true,
                namespaces: ['kb_default']
            },
            actions: {
                downgrade: { embeddings: { model: 'text-embedding-3-small' } },
                reduce: { 'kb.topK': 6, 'bm25K': 30 },
                disable: { reranker: true },
                batch: { 'embeddings.batch': 32 },
                deferJobs: ['kb.reindex', 'sim.run'],
                throttle: { 'dist.push.perMin': 20 }
            },
            integrations: {
                dist: 'LIVIA-22',
                kb: 'LIVIA-24',
                housekeeping: 'LIVIA-31',
                policy: 'LIVIA-23',
                ethics: 'LIVIA-26'
            },
            evaluation: {
                slideEverySec: 5,
                minSamplesPerWindow: 3,
                currency: 'USD',
                rateFallback: { defaultPricePerUnit: 0.0 }
            },
            idempotencyTtlSec: 3600,
            ...config
        };
        this.isInitialized = false;
        this.logger = null;
        this.eventBus = null;
        this.state = 'IDLE';
        this.costStore = new Map(); // Maliyet verileri
        this.budgetStore = new Map(); // Bütçe limitleri
        this.actionStore = new Map(); // Aktif aksiyonlar
        this.rateStore = new Map(); // Provider fiyat oranları
        this.forecastEngine = null;
        this.aggregator = null;
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
            await this.initializeBudgets();
            await this.initializeRates();
            this.logger.info(`${this.name} kurulumu tamamlandı`);
        }
    }

    setupEventListeners() {
        if (!this.eventBus) return;

        // Maliyet ve kullanım eventleri
        this.eventBus.on('billing.usage.sample', (data) => this.handleUsageSample(data));
        this.eventBus.on('billing.estimate.update', (data) => this.handleEstimateUpdate(data));
        this.eventBus.on('provider.rate.update', (data) => this.handleRateUpdate(data));
        this.eventBus.on('budget.config.updated', (data) => this.handleBudgetUpdate(data));
        this.eventBus.on('job.cost.estimate', (data) => this.handleJobEstimate(data));
        this.eventBus.on('dist.sent', (data) => this.handleDistSent(data));
        this.eventBus.on('kb.query.executed', (data) => this.handleKBQuery(data));
        
        // Timer for sliding evaluation
        setInterval(() => this.slideEvaluation(), this.config.evaluation.slideEverySec * 1000);
    }

    initializeComponents() {
        this.forecastEngine = new CostForecastEngine(this.config.forecast);
        this.aggregator = new CostAggregator(this.config);
        
        // Initialize default budgets
        for (const [period, budget] of Object.entries(this.config.budgets)) {
            this.budgetStore.set(`global_${period}`, {
                scope: 'global',
                period,
                limitUSD: budget.limitUSD,
                softGuardPct: budget.softGuardPct,
                hardGuardPct: budget.hardGuardPct,
                component: '*'
            });
        }
    }

    async process(data) {
        if (!this.isInitialized) {
            throw new Error(`${this.name} henüz başlatılmadı`);
        }

        try {
            const result = await this.processCostGuard(data);
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

    async processCostGuard(data) {
        const guardKey = this.generateGuardKey(data);
        
        // Idempotency kontrolü
        if (this.actionStore.has(guardKey)) {
            const cached = this.actionStore.get(guardKey);
            if (Date.now() - cached.timestamp < this.config.idempotencyTtlSec * 1000) {
                return cached.result;
            }
        }

        const result = await this.advanceFSM(data);
        
        // Cache'e kaydet
        this.actionStore.set(guardKey, {
            result,
            timestamp: Date.now()
        });

        return result;
    }

    async advanceFSM(data) {
        switch (this.state) {
            case 'IDLE':
                return await this.handleIdleState(data);
            case 'EVAL':
                return await this.handleEvalState(data);
            case 'TRIGGER':
                return await this.handleTriggerState(data);
            case 'MONITOR':
                return await this.handleMonitorState(data);
            case 'RECOVER':
                return await this.handleRecoverState(data);
            default:
                this.state = 'IDLE';
                return { action: 'state_reset', state: this.state };
        }
    }

    async handleIdleState(data) {
        if (data.event === 'slide_eval' || this.shouldEvaluate(data)) {
            this.state = 'EVAL';
            return await this.evaluateCosts(data);
        }
        
        return { action: 'no_action', state: this.state };
    }

    async handleEvalState(data) {
        const evaluation = await this.performCostEvaluation(data);
        
        if (evaluation.shouldTrigger) {
            this.state = 'TRIGGER';
            return await this.triggerCostActions(evaluation);
        } else if (evaluation.shouldWarn) {
            return await this.triggerEarlyWarning(evaluation);
        } else if (evaluation.shouldRecover) {
            this.state = 'RECOVER';
            return await this.recoverFromActions(evaluation);
        }
        
        this.state = 'IDLE';
        return { action: 'evaluation_complete', evaluation };
    }

    async handleTriggerState(data) {
        const actionResult = await this.enforceActions(data);
        
        if (actionResult.success) {
            this.state = 'MONITOR';
            return actionResult;
        } else {
            this.state = 'IDLE';
            await this.emitAlert('error', 'enforce_failed', actionResult);
            return actionResult;
        }
    }

    async handleMonitorState(data) {
        const monitoring = await this.monitorCostRecovery(data);
        
        if (monitoring.isStable) {
            this.state = 'RECOVER';
            return await this.recoverFromActions(monitoring);
        }
        
        return { action: 'monitoring', monitoring };
    }

    async handleRecoverState(data) {
        const recovery = await this.performRecovery(data);
        this.state = 'IDLE';
        return recovery;
    }

    async evaluateCosts(data) {
        // Tüm bileşenler için maliyet değerlendirmesi
        const components = ['embeddings', 'vector_query', 'vector_upsert', 'dist_push', 'storage', 'compute', 'html_render'];
        const evaluations = {};
        
        for (const component of components) {
            evaluations[component] = await this.evaluateComponent(component);
        }
        
        return { action: 'costs_evaluated', evaluations };
    }

    async evaluateComponent(component) {
        const spend = this.aggregator.getSpend(component, this.config.windows);
        const burns = this.calculateBurnRates(component, spend);
        const forecast = this.forecastEngine.predict(component, spend);
        
        return {
            component,
            spend,
            burns,
            forecast,
            triggers: this.evaluateTriggers(component, burns, forecast)
        };
    }

    async performCostEvaluation(data) {
        const globalEval = await this.evaluateComponent('*');
        const componentEvals = {};
        
        // Bileşen bazında değerlendirme
        for (const component of Object.keys(this.config.perComponent)) {
            componentEvals[component] = await this.evaluateComponent(component);
        }
        
        // Trigger koşullarını kontrol et
        const shouldTrigger = this.checkTriggerConditions(globalEval, componentEvals);
        const shouldWarn = this.checkWarningConditions(globalEval, componentEvals);
        const shouldRecover = this.checkRecoveryConditions(globalEval, componentEvals);
        
        return {
            global: globalEval,
            components: componentEvals,
            shouldTrigger,
            shouldWarn,
            shouldRecover
        };
    }

    calculateBurnRates(component, spend) {
        const burns = {};
        const budgets = this.getBudgetsForComponent(component);
        
        for (const [window, spendData] of Object.entries(spend)) {
            const budget = budgets.find(b => this.windowMatchesPeriod(window, b.period));
            if (budget) {
                burns[window] = {
                    spendUSD: spendData.total || 0,
                    limitUSD: budget.limitUSD,
                    burnPct: budget.limitUSD > 0 ? (spendData.total || 0) / budget.limitUSD : 0,
                    softGuard: budget.limitUSD * budget.softGuardPct,
                    hardGuard: budget.limitUSD * budget.hardGuardPct
                };
            }
        }
        
        return burns;
    }

    checkTriggerConditions(globalEval, componentEvals) {
        // Hard guard aşım kontrolü
        for (const [window, burn] of Object.entries(globalEval.burns)) {
            if (burn.spendUSD >= burn.hardGuard) {
                return {
                    trigger: 'hard_guard_cross',
                    component: '*',
                    window,
                    severity: 'high'
                };
            }
        }
        
        // Forecast breach kontrolü
        if (globalEval.forecast.willBreachHard) {
            return {
                trigger: 'forecast_breach',
                component: '*',
                severity: 'medium'
            };
        }
        
        // Rate spike kontrolü
        for (const [component, evaluation] of Object.entries(componentEvals)) {
            if (evaluation.triggers.rateSpike) {
                return {
                    trigger: 'rate_spike',
                    component,
                    severity: 'medium'
                };
            }
        }
        
        return false;
    }

    checkWarningConditions(globalEval, componentEvals) {
        // Soft guard yaklaşım kontrolü
        for (const [window, burn] of Object.entries(globalEval.burns)) {
            if (burn.spendUSD >= burn.softGuard && burn.spendUSD < burn.hardGuard) {
                return {
                    warning: 'soft_guard_approach',
                    component: '*',
                    window,
                    burnPct: burn.burnPct
                };
            }
        }
        
        return false;
    }

    checkRecoveryConditions(globalEval, componentEvals) {
        // Aktif aksiyonlar varsa ve burn düştüyse
        const activeActions = this.getActiveActions();
        if (activeActions.length === 0) return false;
        
        for (const [window, burn] of Object.entries(globalEval.burns)) {
            if (burn.spendUSD < burn.softGuard) {
                return {
                    recovery: 'burn_normalized',
                    activeActions
                };
            }
        }
        
        return false;
    }

    async triggerCostActions(evaluation) {
        const actionPlan = this.createActionPlan(evaluation);
        const appliedActions = [];
        
        try {
            // Downgrade actions
            if (actionPlan.downgrade) {
                await this.applyDowngrade(actionPlan.downgrade);
                appliedActions.push('downgrade');
            }
            
            // Reduce actions
            if (actionPlan.reduce) {
                await this.applyReduce(actionPlan.reduce);
                appliedActions.push('reduce');
            }
            
            // Disable actions
            if (actionPlan.disable) {
                await this.applyDisable(actionPlan.disable);
                appliedActions.push('disable');
            }
            
            // Batch optimization
            if (actionPlan.batch) {
                await this.applyBatch(actionPlan.batch);
                appliedActions.push('batch');
            }
            
            // Defer jobs
            if (actionPlan.deferJobs) {
                await this.applyDeferJobs(actionPlan.deferJobs);
                appliedActions.push('defer');
            }
            
            // Throttle
            if (actionPlan.throttle) {
                await this.applyThrottle(actionPlan.throttle);
                appliedActions.push('throttle');
            }
            
            const result = {
                action: 'cost_guard_triggered',
                scope: evaluation.shouldTrigger.component === '*' ? 'global' : 'component',
                component: evaluation.shouldTrigger.component,
                trigger: evaluation.shouldTrigger.trigger,
                actionPlan,
                appliedActions,
                severity: evaluation.shouldTrigger.severity,
                hash: this.generateHash(evaluation)
            };
            
            await this.emitTriggerEvents(result);
            return result;
            
        } catch (error) {
            this.logger.error('Cost action application failed:', error);
            await this.emitAlert('error', 'enforce_failed', { error: error.message });
            return { action: 'trigger_failed', error: error.message };
        }
    }

    async triggerEarlyWarning(evaluation) {
        const warning = evaluation.shouldWarn;
        
        const result = {
            action: 'early_warning',
            scope: 'global',
            component: warning.component,
            warning: warning.warning,
            windows: this.formatBurnWindows(evaluation.global.burns),
            hint: this.generateSavingsHint(warning)
        };
        
        await this.emitEarlyWarning(result);
        return result;
    }

    createActionPlan(evaluation) {
        const plan = {};
        const trigger = evaluation.shouldTrigger;
        const componentConfig = this.config.perComponent[trigger.component] || {};
        
        // Severity'ye göre aksiyon şiddeti
        if (trigger.severity === 'high') {
            // Agresif aksiyonlar
            if (componentConfig.allowDowngrade) {
                plan.downgrade = this.config.actions.downgrade;
            }
            plan.reduce = this.config.actions.reduce;
            plan.disable = this.config.actions.disable;
            plan.deferJobs = this.config.actions.deferJobs;
        } else if (trigger.severity === 'medium') {
            // Orta düzey aksiyonlar
            plan.reduce = this.config.actions.reduce;
            plan.batch = this.config.actions.batch;
            if (trigger.trigger === 'rate_spike') {
                plan.throttle = this.config.actions.throttle;
            }
        }
        
        return plan;
    }

    async applyDowngrade(downgradeConfig) {
        if (this.eventBus) {
            this.eventBus.emit('cost.action.downgrade', {
                event: 'cost.action.downgrade',
                timestamp: new Date().toISOString(),
                config: downgradeConfig,
                reason: 'cost_guard_triggered'
            });
        }
    }

    async applyReduce(reduceConfig) {
        if (this.eventBus) {
            this.eventBus.emit('cost.action.reduce', {
                event: 'cost.action.reduce',
                timestamp: new Date().toISOString(),
                config: reduceConfig,
                reason: 'cost_guard_triggered'
            });
        }
    }

    async applyDisable(disableConfig) {
        if (this.eventBus) {
            this.eventBus.emit('cost.action.disable', {
                event: 'cost.action.disable',
                timestamp: new Date().toISOString(),
                config: disableConfig,
                reason: 'cost_guard_triggered'
            });
        }
    }

    async applyBatch(batchConfig) {
        if (this.eventBus) {
            this.eventBus.emit('cost.action.batch', {
                event: 'cost.action.batch',
                timestamp: new Date().toISOString(),
                config: batchConfig,
                reason: 'cost_guard_triggered'
            });
        }
    }

    async applyDeferJobs(deferConfig) {
        if (this.eventBus) {
            this.eventBus.emit('cost.action.defer', {
                event: 'cost.action.defer',
                timestamp: new Date().toISOString(),
                jobs: deferConfig,
                reason: 'cost_guard_triggered'
            });
        }
    }

    async applyThrottle(throttleConfig) {
        if (this.eventBus) {
            this.eventBus.emit('cost.action.throttle', {
                event: 'cost.action.throttle',
                timestamp: new Date().toISOString(),
                config: throttleConfig,
                reason: 'cost_guard_triggered'
            });
        }
    }

    async recoverFromActions(evaluation) {
        const activeActions = this.getActiveActions();
        const revertedActions = [];
        const resumedJobs = [];
        
        for (const action of activeActions) {
            try {
                await this.revertAction(action);
                revertedActions.push(action.type);
                
                if (action.type === 'defer' && action.jobs) {
                    resumedJobs.push(...action.jobs);
                }
            } catch (error) {
                this.logger.error(`Failed to revert action ${action.type}:`, error);
            }
        }
        
        const result = {
            action: 'cost_guard_recovered',
            scope: 'global',
            component: '*',
            since: this.getLastTriggerTime(),
            durationMin: this.calculateRecoveryDuration(),
            actionsReverted: revertedActions,
            jobsResumed: resumedJobs
        };
        
        await this.emitRecoveryEvents(result);
        return result;
    }

    async revertAction(action) {
        if (this.eventBus) {
            this.eventBus.emit('cost.action.revert', {
                event: 'cost.action.revert',
                timestamp: new Date().toISOString(),
                action: action.type,
                config: action.config,
                reason: 'cost_guard_recovered'
            });
        }
    }

    // Event Handlers
    handleUsageSample(data) {
        // DRILL/SHADOW hariç tut
        if (this.config.exclusions.drillShadowExclude && 
            (data.tags?.DRILL || data.tags?.SHADOW)) {
            return;
        }
        
        const rate = this.rateStore.get(`${data.provider}_${data.component}`) || data.pricePerUnit;
        const cost = data.qty * rate;
        
        this.aggregator.addUsageSample({
            component: data.component,
            provider: data.provider,
            cost,
            qty: data.qty,
            unit: data.unit,
            timestamp: data.timestamp
        });
    }

    handleEstimateUpdate(data) {
        this.aggregator.addEstimate({
            component: data.component,
            provider: data.provider,
            window: data.window,
            estimateUSD: data.estimateUSD,
            method: data.method,
            timestamp: data.timestamp
        });
    }

    handleRateUpdate(data) {
        const key = `${data.provider}_${data.component}`;
        this.rateStore.set(key, {
            provider: data.provider,
            component: data.component,
            unit: data.unit,
            pricePerUnit: data.pricePerUnit,
            currency: data.currency,
            updatedAt: data.timestamp
        });
    }

    handleBudgetUpdate(data) {
        const key = `${data.scope}_${data.period}_${data.component}`;
        this.budgetStore.set(key, {
            scope: data.scope,
            period: data.period,
            component: data.component,
            limitUSD: data.limitUSD,
            softGuardPct: data.softGuardPct,
            hardGuardPct: data.hardGuardPct,
            symbol: data.symbol,
            updatedAt: data.timestamp
        });
    }

    handleJobEstimate(data) {
        // Job maliyet tahmini - defer kararı için
        this.logger.debug(`Job cost estimate: ${data.job} -> $${data.expectedUSD}`);
    }

    handleDistSent(data) {
        // Distribution maliyeti (yaklaşık)
        const estimatedCost = data.bytes * 0.000001; // Mock rate
        this.aggregator.addUsageSample({
            component: 'dist_push',
            provider: 'local',
            cost: estimatedCost,
            qty: data.messages,
            unit: 'messages',
            timestamp: data.timestamp
        });
    }

    handleKBQuery(data) {
        // KB query maliyeti (vector/lexical)
        const baseCost = data.mode === 'vector' ? 0.001 : 0.0001;
        const rerankerCost = data.reranker ? 0.0005 : 0;
        const totalCost = baseCost + rerankerCost;
        
        this.aggregator.addUsageSample({
            component: 'vector_query',
            provider: 'local',
            cost: totalCost,
            qty: 1,
            unit: 'query',
            timestamp: data.timestamp
        });
    }

    async slideEvaluation() {
        if (!this.isInitialized) return;
        
        try {
            await this.process({ 
                event: 'slide_eval', 
                timestamp: new Date().toISOString() 
            });
            
            await this.emitMetrics();
        } catch (error) {
            this.logger.error('Slide evaluation error:', error);
        }
    }

    // Emit events
    async emitTriggerEvents(result) {
        if (!this.eventBus) return;

        this.eventBus.emit('cost.guard.triggered', {
            event: 'cost.guard.triggered',
            timestamp: new Date().toISOString(),
            ...result
        });

        const card = this.createTriggerCard(result);
        this.eventBus.emit('cost.guard.card', card);
    }

    async emitEarlyWarning(result) {
        if (!this.eventBus) return;

        this.eventBus.emit('cost.guard.earlywarn', {
            event: 'cost.guard.earlywarn',
            timestamp: new Date().toISOString(),
            ...result
        });
    }

    async emitRecoveryEvents(result) {
        if (!this.eventBus) return;

        this.eventBus.emit('cost.guard.recovered', {
            event: 'cost.guard.recovered',
            timestamp: new Date().toISOString(),
            ...result
        });
    }

    async emitMetrics() {
        if (!this.eventBus) return;

        const actions = Array.from(this.actionStore.values());
        const triggers = actions.filter(a => a.result.action === 'cost_guard_triggered').length;
        const recoveries = actions.filter(a => a.result.action === 'cost_guard_recovered').length;
        const earlyWarns = actions.filter(a => a.result.action === 'early_warning').length;

        this.eventBus.emit('cost.guard.metrics', {
            event: 'cost.guard.metrics',
            timestamp: new Date().toISOString(),
            evaluated: actions.length,
            triggers,
            recoveries,
            earlyWarn: earlyWarns,
            p95EvalMs: 6.2, // Mock
            savingsUSD: 28.4, // Mock
            jobsDeferred: 2, // Mock
            actions: {
                downgrade: 2,
                reduce: 3,
                disable: 2,
                batch: 2,
                throttle: 1
            }
        });
    }

    async emitAlert(level, message, context = {}) {
        if (!this.eventBus) return;

        this.eventBus.emit('cost.guard.alert', {
            event: 'cost.guard.alert',
            timestamp: new Date().toISOString(),
            level,
            message,
            context
        });
    }

    createTriggerCard(result) {
        const actionSummary = result.appliedActions.join(' + ');
        
        return {
            event: 'cost.guard.card',
            timestamp: new Date().toISOString(),
            title: `Maliyet Guard — ${result.component} (${result.trigger})`,
            body: `${actionSummary} uygulandı • maliyet düşürme devrede`,
            severity: result.severity === 'high' ? 'error' : 'warn',
            ttlSec: 900
        };
    }

    // Utility methods
    generateGuardKey(data) {
        const crypto = require('crypto');
        const scope = data.scope || 'global';
        const component = data.component || '*';
        const trigger = data.trigger || 'eval';
        const windowStartISO = new Date().toISOString().split(':')[0]; // Hour precision
        
        return crypto.createHash('sha256').update(`${scope}+${component}+${trigger}+${windowStartISO}`).digest('hex').substring(0, 16);
    }

    generateHash(data) {
        const crypto = require('crypto');
        return crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex');
    }

    shouldEvaluate(data) {
        return ['billing.usage.sample', 'billing.estimate.update', 'provider.rate.update'].includes(data.event);
    }

    getBudgetsForComponent(component) {
        const budgets = [];
        for (const [key, budget] of this.budgetStore.entries()) {
            if (budget.component === '*' || budget.component === component) {
                budgets.push(budget);
            }
        }
        return budgets;
    }

    windowMatchesPeriod(window, period) {
        const windowMap = {
            '24h': 'daily',
            '7d': 'weekly',
            '30d': 'monthly'
        };
        return windowMap[window] === period;
    }

    getActiveActions() {
        // Mock active actions
        return [];
    }

    getLastTriggerTime() {
        return new Date(Date.now() - 26 * 60 * 1000).toISOString(); // 26 minutes ago
    }

    calculateRecoveryDuration() {
        return 26; // minutes
    }

    formatBurnWindows(burns) {
        const formatted = {};
        for (const [window, data] of Object.entries(burns)) {
            formatted[window] = {
                spendUSD: Math.round(data.spendUSD * 100) / 100,
                burnPct: Math.round(data.burnPct * 1000) / 10
            };
        }
        return formatted;
    }

    generateSavingsHint(warning) {
        return `topK=8→6 ve reranker kapatma ile %28 düşüş öngörülüyor.`;
    }

    async initializeBudgets() {
        // Load default budgets
        this.logger.debug('Default budgets initialized');
    }

    async initializeRates() {
        // Load default rates
        const defaultRates = {
            'openai_embeddings': 0.0000005,
            'local_vector_query': 0.001,
            'local_dist_push': 0.0001
        };
        
        for (const [key, rate] of Object.entries(defaultRates)) {
            this.rateStore.set(key, { pricePerUnit: rate });
        }
    }

    getStatus() {
        return {
            name: this.name,
            initialized: this.isInitialized,
            enabled: this.config.enabled,
            state: this.state,
            budgets: this.budgetStore.size,
            rates: this.rateStore.size,
            actions: this.actionStore.size,
            config: this.config
        };
    }

    async shutdown() {
        try {
            this.logger.info(`${this.name} durduruluyor...`);
            
            this.costStore.clear();
            this.budgetStore.clear();
            this.actionStore.clear();
            this.rateStore.clear();
            
            this.isInitialized = false;
            this.logger.info(`${this.name} başarıyla durduruldu`);
        } catch (error) {
            this.logger.error(`${this.name} durdurma hatası:`, error);
        }
    }
}

// Helper Classes
class CostForecastEngine {
    constructor(config) {
        this.config = config;
    }

    predict(component, spend) {
        // Mock EWMA forecast
        return {
            willBreachSoft: false,
            willBreachHard: false,
            projectedSpend: 95.5,
            confidence: 0.85
        };
    }
}

class CostAggregator {
    constructor(config) {
        this.config = config;
        this.samples = new Map();
    }

    addUsageSample(sample) {
        const key = sample.component;
        if (!this.samples.has(key)) {
            this.samples.set(key, []);
        }
        this.samples.get(key).push({
            ...sample,
            timestamp: new Date(sample.timestamp).getTime()
        });
    }

    addEstimate(estimate) {
        // Add estimate to samples
        this.addUsageSample({
            component: estimate.component,
            cost: estimate.estimateUSD,
            timestamp: estimate.timestamp
        });
    }

    getSpend(component, windows) {
        const samples = this.samples.get(component) || [];
        const spend = {};
        
        for (const window of windows) {
            const windowMs = this.parseWindow(window);
            const cutoff = Date.now() - windowMs;
            const windowSamples = samples.filter(s => s.timestamp >= cutoff);
            
            spend[window] = {
                total: windowSamples.reduce((sum, s) => sum + (s.cost || 0), 0),
                count: windowSamples.length
            };
        }
        
        return spend;
    }

    parseWindow(window) {
        const unit = window.slice(-1);
        const value = parseInt(window.slice(0, -1));
        
        switch (unit) {
            case 'h': return value * 60 * 60 * 1000;
            case 'd': return value * 24 * 60 * 60 * 1000;
            default: return 60 * 60 * 1000; // Default 1h
        }
    }
}

module.exports = RealtimeCostGuard;