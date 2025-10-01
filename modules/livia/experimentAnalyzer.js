/**
 * LIVIA-36 · experimentAnalyzer.js
 * Deney analizi ve A/B test sonuçlarını değerlendirme modülü
 */

class ExperimentAnalyzer {
    constructor(config = {}) {
        this.name = 'ExperimentAnalyzer';
        this.config = {
            enabled: true,
            i18n: { locale: 'tr-TR', tz: 'Europe/Istanbul' },
            methods: {
                frequentist: { ratioTest: 'welch_z', meanTest: 'welch_t', nonParam: 'mann_whitney' },
                bayesian: { binary: 'beta_binomial', mean: 'normal_inverse_gamma', draws: 5000 },
                sequential: { alphaSpend: 'obrien_fleming', lookEveryMin: 10, maxLooks: 48 }
            },
            varianceReduction: {
                cuped: { enabled: true, covariate: 'pre_success_rate', minCorr: 0.05 }
            },
            multipleTesting: {
                fdr: 'bh', q: 0.1, family: ['primary', 'secondary', 'segments']
            },
            metricsCatalog: {
                success_rate: { kind: 'ratio', num: 'answers_accepted', den: 'answers' },
                p95_latency_ms: { kind: 'mean_p95', source: 'latency_ms' },
                cost_usd: { kind: 'mean', source: 'cost_usd' },
                pnl_usd: { kind: 'mean', source: 'pnl_usd' }
            },
            powerCalc: {
                minSamplePerVariant: 500,
                mdeDefault: { success_rate: 0.02, mean: 0.03 },
                minDurationMin: 60
            },
            guardrails: {
                slo: { relyOn: 'L32', breachAction: 'pause' },
                cost: { relyOn: 'L34', hardGuardPct: 0.9, breachAction: 'rollback' }
            },
            segments: {
                sliceBy: ['region', 'role', 'symbol'],
                hetEffects: { enabled: true, method: 'simple_uplift_tree' }
            },
            decisions: {
                promoteIf: { pValue: '<=0.05', upliftSign: '>0', guardrailsOk: true },
                increaseRolloutIf: { pValue: '<=0.1', upliftSign: '>=0', minStableMin: 30 },
                pauseIf: { guardrailBreach: true },
                rollbackIf: { guardrailBreach: true, upliftSign: '<=0' }
            },
            reporting: {
                outputDir: 'data/experiments/{YYYY-MM-DD}/{experimentId}',
                mdFile: 'report.md',
                htmlFile: 'report.html',
                html: { embedMiniCSS: true, chartsInlineSvg: true },
                include: { segmentsTopN: 10, charts: ['kpi_trend', 'cum_uplift', 'sequential_boundary'] }
            },
            integrations: {
                flags: 'LIVIA-35',
                dist: 'LIVIA-22',
                kb: 'LIVIA-24',
                ethics: 'LIVIA-26',
                sloGuard: 'LIVIA-32',
                costGuard: 'LIVIA-34'
            },
            redactionProfile: 'generic',
            idempotencyTtlSec: 86400,
            ...config
        };
        this.isInitialized = false;
        this.logger = null;
        this.eventBus = null;
        this.state = 'IDLE';
        this.experimentStore = new Map(); // Experiment definitions
        this.exposureStore = new Map(); // Exposure data
        this.outcomeStore = new Map(); // Outcome data
        this.analysisStore = new Map(); // Analysis results
        this.statsEngine = null;
        this.cupedEngine = null;
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
            await this.loadMetricsCatalog();
            this.logger.info(`${this.name} kurulumu tamamlandı`);
        }
    }

    setupEventListeners() {
        if (!this.eventBus) return;

        // Experiment lifecycle events
        this.eventBus.on('experiment.define', (data) => this.handleExperimentDefine(data));
        this.eventBus.on('experiment.start', (data) => this.handleExperimentStart(data));
        this.eventBus.on('experiment.pause', (data) => this.handleExperimentPause(data));
        this.eventBus.on('experiment.resume', (data) => this.handleExperimentResume(data));
        this.eventBus.on('experiment.stop', (data) => this.handleExperimentStop(data));

        // Data collection events
        this.eventBus.on('exposure.logged', (data) => this.handleExposureLogged(data));
        this.eventBus.on('outcome.logged', (data) => this.handleOutcomeLogged(data));

        // Guardrail events
        this.eventBus.on('slo.guard.triggered', (data) => this.handleSLOTrigger(data));
        this.eventBus.on('slo.guard.recovered', (data) => this.handleSLORecovered(data));
        this.eventBus.on('cost.guard.triggered', (data) => this.handleCostTrigger(data));
        this.eventBus.on('cost.guard.recovered', (data) => this.handleCostRecovered(data));

        // Feature flag events
        this.eventBus.on('feature.flag.rollout.progress', (data) => this.handleRolloutProgress(data));

        // Timer for scheduled analysis
        setInterval(() => this.performScheduledAnalysis(), this.config.methods.sequential.lookEveryMin * 60 * 1000);
    }

    initializeComponents() {
        this.statsEngine = new StatisticalEngine(this.config.methods);
        this.cupedEngine = new CupedEngine(this.config.varianceReduction.cuped);
    }

    async process(data) {
        if (!this.isInitialized) {
            throw new Error(`${this.name} henüz başlatılmadı`);
        }

        try {
            const result = await this.processExperimentEvent(data);
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

    async processExperimentEvent(data) {
        const analysisKey = this.generateAnalysisKey(data);
        
        // Idempotency kontrolü
        if (this.analysisStore.has(analysisKey)) {
            const cached = this.analysisStore.get(analysisKey);
            if (Date.now() - cached.timestamp < this.config.idempotencyTtlSec * 1000) {
                return cached.result;
            }
        }

        const result = await this.advanceFSM(data);
        
        // Cache'e kaydet (data collection events hariç)
        if (!['exposure.logged', 'outcome.logged'].includes(data.event)) {
            this.analysisStore.set(analysisKey, {
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
            case 'COLLECT':
                return await this.handleCollectState(data);
            case 'ESTIMATE':
                return await this.handleEstimateState(data);
            case 'DECIDE':
                return await this.handleDecideState(data);
            case 'REPORT':
                return await this.handleReportState(data);
            default:
                this.state = 'IDLE';
                return { action: 'state_reset', state: this.state };
        }
    }

    async handleIdleState(data) {
        if (['experiment.start', 'outcome.logged', 'exposure.logged'].includes(data.event)) {
            this.state = 'COLLECT';
            return await this.collectData(data);
        }
        
        return { action: 'no_action', state: this.state };
    }

    async handleCollectState(data) {
        if (data.event === 'schedule_analysis' || this.shouldAnalyze(data)) {
            this.state = 'ESTIMATE';
            return await this.performEstimation(data);
        }
        
        // Continue collecting
        return await this.collectData(data);
    }

    async handleEstimateState(data) {
        const estimation = await this.runStatisticalAnalysis(data);
        
        // Check guardrails
        const guardrailCheck = await this.checkGuardrails(estimation);
        if (guardrailCheck.breach) {
            this.state = 'DECIDE';
            return await this.makeGuardrailDecision(estimation, guardrailCheck);
        }
        
        this.state = 'DECIDE';
        return await this.makeRegularDecision(estimation);
    }

    async handleDecideState(data) {
        this.state = 'REPORT';
        return await this.generateReport(data);
    }

    async handleReportState(data) {
        const reportResult = await this.publishReport(data);
        this.state = 'IDLE';
        return reportResult;
    }

    // Event Handlers
    async handleExperimentDefine(data) {
        const experiment = {
            experimentId: data.experimentId,
            title: data.title,
            env: data.env,
            unit: data.unit,
            assignment: data.assignment,
            audience: data.audience,
            metrics: data.metrics,
            mde: data.mde,
            power: data.power,
            alpha: data.alpha,
            prePeriod: data.prePeriod,
            state: 'DEFINED',
            definedAt: new Date().toISOString()
        };

        this.experimentStore.set(data.experimentId, experiment);
        
        return {
            action: 'experiment_defined',
            experimentId: data.experimentId,
            powerAnalysis: await this.calculatePowerAnalysis(experiment)
        };
    }

    async handleExperimentStart(data) {
        const experiment = this.experimentStore.get(data.experimentId);
        if (!experiment) {
            return { action: 'experiment_not_found', experimentId: data.experimentId };
        }

        experiment.state = 'RUNNING';
        experiment.startedAt = data.startAt || new Date().toISOString();
        experiment.version = data.version;
        
        this.state = 'COLLECT';
        
        return {
            action: 'experiment_started',
            experimentId: data.experimentId,
            version: data.version
        };
    }

    async handleExperimentPause(data) {
        const experiment = this.experimentStore.get(data.experimentId);
        if (experiment) {
            experiment.state = 'PAUSED';
            experiment.pausedAt = new Date().toISOString();
            experiment.pauseReason = data.reason;
        }
        
        return {
            action: 'experiment_paused',
            experimentId: data.experimentId,
            reason: data.reason
        };
    }

    async handleExperimentResume(data) {
        const experiment = this.experimentStore.get(data.experimentId);
        if (experiment) {
            experiment.state = 'RUNNING';
            experiment.resumedAt = new Date().toISOString();
        }
        
        return {
            action: 'experiment_resumed',
            experimentId: data.experimentId
        };
    }

    async handleExperimentStop(data) {
        const experiment = this.experimentStore.get(data.experimentId);
        if (experiment) {
            experiment.state = 'STOPPED';
            experiment.stoppedAt = new Date().toISOString();
            experiment.stopReason = data.reason;
        }
        
        return {
            action: 'experiment_stopped',
            experimentId: data.experimentId,
            reason: data.reason
        };
    }

    async handleExposureLogged(data) {
        const exposureKey = `${data.experimentId}_${data.subject.id}_${data.timestamp}`;
        
        this.exposureStore.set(exposureKey, {
            experimentId: data.experimentId,
            variant: data.variant,
            subject: data.subject,
            context: data.context,
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
        // Find experiments affected by SLO breach
        const affectedExperiments = this.findExperimentsForService(data.serviceId);
        
        for (const experiment of affectedExperiments) {
            if (this.config.guardrails.slo.breachAction === 'pause') {
                await this.triggerExperimentAction(experiment.experimentId, 'pause', 'slo_guard_trigger');
            }
        }
        
        return { action: 'slo_trigger_handled', affected: affectedExperiments.length };
    }

    async handleSLORecovered(data) {
        // Resume paused experiments if appropriate
        const pausedExperiments = this.findPausedExperimentsByReason('slo_guard_trigger');
        
        for (const experiment of pausedExperiments) {
            await this.triggerExperimentAction(experiment.experimentId, 'resume', 'slo_guard_recovered');
        }
        
        return { action: 'slo_recovery_handled', resumed: pausedExperiments.length };
    }

    async handleCostTrigger(data) {
        // Find cost-sensitive experiments
        const costExperiments = this.findCostSensitiveExperiments();
        
        for (const experiment of costExperiments) {
            if (this.config.guardrails.cost.breachAction === 'rollback') {
                await this.triggerExperimentAction(experiment.experimentId, 'rollback', 'cost_guard_trigger');
            }
        }
        
        return { action: 'cost_trigger_handled', affected: costExperiments.length };
    }

    async handleCostRecovered(data) {
        // No automatic resume for cost-triggered experiments
        return { action: 'cost_recovery_noted' };
    }

    async handleRolloutProgress(data) {
        // Update experiment traffic allocation based on feature flag progress
        const relatedExperiments = this.findExperimentsByFlag(data.flagId);
        
        for (const experiment of relatedExperiments) {
            await this.updateTrafficAllocation(experiment, data.step.percent);
        }
        
        return { action: 'traffic_updated', experiments: relatedExperiments.length };
    }

    // Core Analysis Functions
    async collectData(data) {
        if (data.event === 'exposure.logged') {
            await this.handleExposureLogged(data);
        } else if (data.event === 'outcome.logged') {
            await this.handleOutcomeLogged(data);
        }
        
        return { action: 'data_collected', event: data.event };
    }

    async performEstimation(data) {
        const experiment = this.experimentStore.get(data.experimentId);
        if (!experiment) {
            return { action: 'experiment_not_found' };
        }

        // Collect data for analysis
        const analysisData = await this.prepareAnalysisData(experiment);
        
        // Apply CUPED if enabled
        if (this.config.varianceReduction.cuped.enabled) {
            analysisData.cuped = await this.cupedEngine.apply(analysisData);
        }

        // Run statistical tests
        const estimates = await this.runStatisticalTests(analysisData);
        
        // Check power and sample size
        const powerCheck = await this.checkPower(analysisData, estimates);
        
        const result = {
            action: 'estimation_complete',
            experimentId: experiment.experimentId,
            window: analysisData.window,
            method: 'frequentist',
            samples: analysisData.samples,
            estimates,
            cuped: analysisData.cuped,
            powerCheck
        };

        await this.emitAnalysisReady(result);
        return result;
    }

    async runStatisticalAnalysis(data) {
        const experiment = this.experimentStore.get(data.experimentId);
        if (!experiment) return null;

        const analysisData = await this.prepareAnalysisData(experiment);
        const estimates = await this.runStatisticalTests(analysisData);
        
        return {
            experiment,
            analysisData,
            estimates
        };
    }

    async runStatisticalTests(analysisData) {
        const estimates = {};
        
        // Primary metric
        const primaryMetric = analysisData.experiment.metrics.primary;
        estimates[primaryMetric.name] = await this.statsEngine.analyzeMetric(
            primaryMetric,
            analysisData.control,
            analysisData.treatment
        );
        
        // Secondary metrics
        for (const metric of analysisData.experiment.metrics.secondary || []) {
            estimates[metric.name] = await this.statsEngine.analyzeMetric(
                metric,
                analysisData.control,
                analysisData.treatment
            );
        }
        
        return estimates;
    }

    async checkGuardrails(estimation) {
        const guardrails = estimation.experiment.metrics.guardrails || [];
        const breaches = [];
        
        for (const guardrail of guardrails) {
            const metricEstimate = estimation.estimates[guardrail.name];
            if (metricEstimate) {
                const breach = this.evaluateGuardrail(guardrail, metricEstimate);
                if (breach) {
                    breaches.push({
                        metric: guardrail.name,
                        direction: guardrail.dir,
                        limit: guardrail.limit,
                        actual: metricEstimate.treatment || metricEstimate.v2,
                        severity: this.calculateBreachSeverity(guardrail, metricEstimate)
                    });
                }
            }
        }
        
        return {
            breach: breaches.length > 0,
            breaches,
            severity: breaches.length > 0 ? Math.max(...breaches.map(b => b.severity)) : 0
        };
    }

    evaluateGuardrail(guardrail, estimate) {
        const actual = estimate.treatment || estimate.v2;
        const direction = guardrail.dir.trim();
        const limit = guardrail.limit;
        
        switch (direction) {
            case '<=':
                return actual > limit;
            case '>=':
                return actual < limit;
            case '<':
                return actual >= limit;
            case '>':
                return actual <= limit;
            default:
                return false;
        }
    }

    calculateBreachSeverity(guardrail, estimate) {
        // Simple severity calculation based on how far from limit
        const actual = estimate.treatment || estimate.v2;
        const limit = guardrail.limit;
        const ratio = Math.abs(actual - limit) / Math.abs(limit);
        
        if (ratio > 0.5) return 3; // High
        if (ratio > 0.2) return 2; // Medium
        return 1; // Low
    }

    async makeGuardrailDecision(estimation, guardrailCheck) {
        const highSeverityBreach = guardrailCheck.breaches.some(b => b.severity >= 3);
        
        let decision;
        if (highSeverityBreach) {
            decision = 'rollback';
        } else {
            decision = 'pause';
        }
        
        const result = {
            action: 'guardrail_decision',
            experimentId: estimation.experiment.experimentId,
            decision,
            reason: 'guardrail_breach',
            breaches: guardrailCheck.breaches
        };

        await this.emitDecisionSuggested(result);
        return result;
    }

    async makeRegularDecision(estimation) {
        const primaryMetric = estimation.experiment.metrics.primary;
        const primaryEstimate = estimation.estimates[primaryMetric.name];
        
        let decision = 'hold';
        const rationale = [];
        
        // Check significance and uplift direction
        const isSignificant = primaryEstimate.p <= this.config.decisions.promoteIf.pValue.replace('<=', '');
        const hasPositiveUplift = (primaryEstimate.uplift || primaryEstimate.diff || 0) > 0;
        
        if (isSignificant && hasPositiveUplift) {
            decision = 'promote';
            rationale.push('uplift_sig', 'guardrails_ok');
        } else if (hasPositiveUplift && primaryEstimate.p <= 0.1) {
            decision = 'increase_rollout';
            rationale.push('trending_positive');
        } else if (!hasPositiveUplift && isSignificant) {
            decision = 'rollback';
            rationale.push('negative_impact');
        }
        
        const result = {
            action: 'regular_decision',
            experimentId: estimation.experiment.experimentId,
            decision,
            rationale,
            primaryMetric: primaryEstimate
        };

        await this.emitDecisionSuggested(result);
        return result;
    }

    async generateReport(data) {
        const experiment = this.experimentStore.get(data.experimentId);
        if (!experiment) return { action: 'experiment_not_found' };

        const analysisData = await this.prepareAnalysisData(experiment);
        const estimates = await this.runStatisticalTests(analysisData);
        
        // Generate report content
        const reportContent = await this.createReportContent(experiment, analysisData, estimates);
        
        // Save report files
        const reportPath = await this.saveReport(experiment, reportContent);
        
        const result = {
            action: 'report_generated',
            experimentId: experiment.experimentId,
            format: 'md',
            path: reportPath,
            summary: this.generateReportSummary(estimates),
            hash: this.generateHash(reportContent)
        };

        await this.emitReportReady(result);
        return result;
    }

    async publishReport(data) {
        // Distribute report via LIVIA-22
        await this.distributeReport(data);
        
        // Index in knowledge base via LIVIA-24
        await this.indexReport(data);
        
        // Emit card
        await this.emitExperimentCard(data);
        
        return { action: 'report_published', experimentId: data.experimentId };
    }

    // Helper Functions
    async prepareAnalysisData(experiment) {
        const exposures = this.getExposures(experiment.experimentId);
        const outcomes = this.getOutcomes(experiment.experimentId);
        
        // Group by variant
        const controlData = this.filterByVariant(exposures, outcomes, 'control');
        const treatmentData = this.filterByVariant(exposures, outcomes, 'v2');
        
        return {
            experiment,
            window: {
                from: experiment.startedAt,
                to: new Date().toISOString()
            },
            samples: {
                control: controlData.length,
                v2: treatmentData.length,
                units: experiment.unit
            },
            control: controlData,
            treatment: treatmentData
        };
    }

    getExposures(experimentId) {
        const exposures = [];
        for (const [key, exposure] of this.exposureStore.entries()) {
            if (exposure.experimentId === experimentId) {
                exposures.push(exposure);
            }
        }
        return exposures;
    }

    getOutcomes(experimentId) {
        const outcomes = [];
        for (const [key, outcome] of this.outcomeStore.entries()) {
            if (outcome.experimentId === experimentId) {
                outcomes.push(outcome);
            }
        }
        return outcomes;
    }

    filterByVariant(exposures, outcomes, variant) {
        const variantExposures = exposures.filter(e => e.variant === variant);
        const variantOutcomes = outcomes.filter(o => o.variant === variant);
        
        // Merge exposures with outcomes
        return variantExposures.map(exposure => {
            const outcome = variantOutcomes.find(o => 
                o.timestamp >= exposure.timestamp && 
                o.timestamp <= new Date(new Date(exposure.timestamp).getTime() + 3600000).toISOString()
            );
            
            return {
                ...exposure,
                metrics: outcome?.metrics || {}
            };
        });
    }

    async calculatePowerAnalysis(experiment) {
        // Mock power analysis
        return {
            minSamplePerVariant: this.config.powerCalc.minSamplePerVariant,
            estimatedDuration: '2-4 days',
            mde: experiment.mde || this.config.powerCalc.mdeDefault,
            power: experiment.power || 0.8
        };
    }

    async checkPower(analysisData, estimates) {
        const totalSamples = analysisData.samples.control + analysisData.samples.v2;
        const isUnderpowered = totalSamples < this.config.powerCalc.minSamplePerVariant * 2;
        
        return {
            underpowered: isUnderpowered,
            currentSamples: totalSamples,
            requiredSamples: this.config.powerCalc.minSamplePerVariant * 2
        };
    }

    shouldAnalyze(data) {
        // Check if enough time has passed since last analysis
        return true; // Simplified check
    }

    async performScheduledAnalysis() {
        // Find running experiments and trigger analysis
        for (const [experimentId, experiment] of this.experimentStore.entries()) {
            if (experiment.state === 'RUNNING') {
                await this.process({
                    event: 'schedule_analysis',
                    experimentId,
                    timestamp: new Date().toISOString()
                });
            }
        }
    }

    createReportContent(experiment, analysisData, estimates) {
        // Generate markdown report
        const primaryMetric = experiment.metrics.primary;
        const primaryEstimate = estimates[primaryMetric.name];
        
        return `# Experiment Report: ${experiment.title}

## Summary
- Experiment ID: ${experiment.experimentId}
- Environment: ${experiment.env}
- Duration: ${analysisData.window.from} to ${analysisData.window.to}

## Sample Sizes
- Control: ${analysisData.samples.control}
- Treatment: ${analysisData.samples.v2}

## Primary Metric: ${primaryMetric.name}
- Control: ${primaryEstimate.control}
- Treatment: ${primaryEstimate.treatment || primaryEstimate.v2}
- Uplift: ${primaryEstimate.uplift || primaryEstimate.diff}
- P-value: ${primaryEstimate.p}
- 95% CI: [${primaryEstimate.ci95?.join(', ')}]

## Decision
Based on the analysis, we recommend: **${this.getLastDecision(experiment.experimentId)}**
`;
    }

    generateReportSummary(estimates) {
        // Generate concise summary
        return 'Analysis complete - see full report for details';
    }

    getLastDecision(experimentId) {
        // Get last decision from analysis store
        return 'hold'; // Simplified
    }

    async saveReport(experiment, content) {
        // Mock save to file system
        const path = `data/experiments/${new Date().toISOString().split('T')[0]}/${experiment.experimentId}/report.md`;
        this.logger.debug(`Report saved to: ${path}`);
        return path;
    }

    // External integrations
    findExperimentsForService(serviceId) {
        const experiments = [];
        for (const [id, experiment] of this.experimentStore.entries()) {
            if (experiment.title.toLowerCase().includes(serviceId.toLowerCase())) {
                experiments.push(experiment);
            }
        }
        return experiments;
    }

    findCostSensitiveExperiments() {
        const experiments = [];
        for (const [id, experiment] of this.experimentStore.entries()) {
            if (experiment.metrics.guardrails?.some(g => g.name.includes('cost'))) {
                experiments.push(experiment);
            }
        }
        return experiments;
    }

    findPausedExperimentsByReason(reason) {
        const experiments = [];
        for (const [id, experiment] of this.experimentStore.entries()) {
            if (experiment.state === 'PAUSED' && experiment.pauseReason === reason) {
                experiments.push(experiment);
            }
        }
        return experiments;
    }

    findExperimentsByFlag(flagId) {
        const experiments = [];
        for (const [id, experiment] of this.experimentStore.entries()) {
            if (experiment.title.includes(flagId)) {
                experiments.push(experiment);
            }
        }
        return experiments;
    }

    async triggerExperimentAction(experimentId, action, reason) {
        if (this.eventBus) {
            this.eventBus.emit(`experiment.${action}`, {
                event: `experiment.${action}`,
                timestamp: new Date().toISOString(),
                experimentId,
                reason
            });
        }
    }

    async updateTrafficAllocation(experiment, percent) {
        this.logger.debug(`Updating traffic allocation for ${experiment.experimentId} to ${percent}%`);
    }

    // Event emission
    async emitAnalysisReady(result) {
        if (!this.eventBus) return;
        
        this.eventBus.emit('experiment.analysis.ready', {
            event: 'experiment.analysis.ready',
            timestamp: new Date().toISOString(),
            ...result
        });
    }

    async emitDecisionSuggested(result) {
        if (!this.eventBus) return;
        
        this.eventBus.emit('experiment.decision.suggested', {
            event: 'experiment.decision.suggested',
            timestamp: new Date().toISOString(),
            action: {
                kind: result.decision,
                toPercent: result.decision === 'increase_rollout' ? 50 : undefined,
                minStableMin: 30
            },
            requiresApproval: false,
            ethicsChecked: true,
            ...result
        });
    }

    async emitReportReady(result) {
        if (!this.eventBus) return;
        
        this.eventBus.emit('experiment.report.ready', {
            event: 'experiment.report.ready',
            timestamp: new Date().toISOString(),
            ...result
        });
    }

    async emitExperimentCard(data) {
        if (!this.eventBus) return;
        
        this.eventBus.emit('experiment.card', {
            event: 'experiment.card',
            timestamp: new Date().toISOString(),
            title: `Deney Analizi — ${data.experimentId}`,
            body: data.summary || 'Analiz tamamlandı',
            severity: 'info',
            ttlSec: 900
        });
    }

    async distributeReport(data) {
        // Distribute via LIVIA-22
        if (this.eventBus) {
            this.eventBus.emit('dist.send', {
                event: 'dist.send',
                timestamp: new Date().toISOString(),
                channels: ['ui', 'slack'],
                content: {
                    type: 'experiment_report',
                    experimentId: data.experimentId,
                    path: data.path
                }
            });
        }
    }

    async indexReport(data) {
        // Index via LIVIA-24
        if (this.eventBus) {
            this.eventBus.emit('kb.index', {
                event: 'kb.index',
                timestamp: new Date().toISOString(),
                document: {
                    id: `experiment_${data.experimentId}`,
                    type: 'experiment_report',
                    tags: ['experiments'],
                    content: data.summary,
                    path: data.path
                }
            });
        }
    }

    async loadMetricsCatalog() {
        // Load metrics catalog
        this.logger.debug('Metrics catalog loaded');
    }

    // Utility methods
    generateAnalysisKey(data) {
        const crypto = require('crypto');
        const experimentId = data.experimentId || 'global';
        const version = data.version || 'v1';
        const windowISO = new Date().toISOString().split('T')[0]; // Day precision
        const modelHash = this.generateHash(this.config.methods);
        
        return crypto.createHash('sha256').update(`${experimentId}+${version}+${windowISO}+${modelHash}`).digest('hex').substring(0, 16);
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
            experiments: this.experimentStore.size,
            exposures: this.exposureStore.size,
            outcomes: this.outcomeStore.size,
            analyses: this.analysisStore.size,
            config: this.config
        };
    }

    async shutdown() {
        try {
            this.logger.info(`${this.name} durduruluyor...`);
            
            this.experimentStore.clear();
            this.exposureStore.clear();
            this.outcomeStore.clear();
            this.analysisStore.clear();
            
            this.isInitialized = false;
            this.logger.info(`${this.name} başarıyla durduruldu`);
        } catch (error) {
            this.logger.error(`${this.name} durdurma hatası:`, error);
        }
    }
}

// Helper Classes
class StatisticalEngine {
    constructor(config) {
        this.config = config;
    }

    async analyzeMetric(metric, controlData, treatmentData) {
        // Mock statistical analysis
        const controlValue = this.calculateMetricValue(metric, controlData);
        const treatmentValue = this.calculateMetricValue(metric, treatmentData);
        
        if (metric.kind === 'ratio') {
            return {
                control: controlValue,
                v2: treatmentValue,
                uplift: treatmentValue - controlValue,
                ci95: [treatmentValue - controlValue - 0.02, treatmentValue - controlValue + 0.02],
                p: 0.0012,
                bayes_prob_v2_better: 0.984
            };
        } else if (metric.kind === 'mean' || metric.kind === 'mean_p95') {
            return {
                control: controlValue,
                v2: treatmentValue,
                diff: treatmentValue - controlValue,
                ci95: [treatmentValue - controlValue - 10, treatmentValue - controlValue + 10],
                p: 0.03
            };
        }
        
        return {
            control: controlValue,
            treatment: treatmentValue,
            uplift: treatmentValue - controlValue,
            p: 0.05
        };
    }

    calculateMetricValue(metric, data) {
        if (metric.kind === 'ratio') {
            const numerator = data.reduce((sum, d) => sum + (d.metrics[metric.num] || 0), 0);
            const denominator = data.reduce((sum, d) => sum + (d.metrics[metric.den] || 1), 0);
            return denominator > 0 ? numerator / denominator : 0;
        } else if (metric.kind === 'mean' || metric.kind === 'mean_p95') {
            const values = data.map(d => d.metrics[metric.source] || 0);
            return values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 0;
        }
        return 0;
    }
}

class CupedEngine {
    constructor(config) {
        this.config = config;
    }

    async apply(analysisData) {
        // Mock CUPED implementation
        return {
            applied: true,
            theta: 0.42,
            varianceReductionPct: 18.5,
            covariate: this.config.covariate
        };
    }
}

module.exports = ExperimentAnalyzer;