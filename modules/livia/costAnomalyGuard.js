/**
 * LIVIA-53: Cost Anomaly Guard  
 * Gerçek zamanlı maliyet anomalisi tespiti ve otomatik müdahale
 * Automatic cost optimization with degradation ladder
 * @version 1.0.0
 * @author LIVIA System
 */

const crypto = require('crypto');
const EventEmitter = require('events');

/**
 * @typedef {Object} CostGuardConfig
 * @property {Object} budget - Budget limits and policies
 * @property {Object} detection - Anomaly detection configuration
 * @property {Object} actions - Available cost reduction actions
 * @property {Object} canary - Canary deployment settings
 * @property {Object} thresholds - Alert and action thresholds
 */

/**
 * @typedef {Object} CostAnomaly
 * @property {string} kind - Anomaly type (spike, drift, step_change, chg_point)
 * @property {number} value - Current cost value
 * @property {number} baseline - Expected baseline
 * @property {number} upliftPct - Percentage increase
 * @property {string} severity - Severity level (warn, high, critical)
 * @property {Object} rca - Root cause analysis
 */

/**
 * @typedef {Object} ActionPlan
 * @property {Array} ladder - Ordered list of cost reduction steps
 * @property {Object} canary - Canary deployment configuration
 * @property {Object} rollbackOn - Rollback conditions
 * @property {Object} expectedSavings - Expected cost savings
 */

class CostAnomalyGuard extends EventEmitter {
    /**
     * Initialize Cost Anomaly Guard
     * @param {CostGuardConfig} config - Guard configuration
     */
    constructor(config = {}) {
        super();
        this.name = 'CostAnomalyGuard';
        this.config = {
            budget: {
                window: '1h',
                currency: 'USD',
                limits: {
                    inference_usd_per_1k_req: 0.8,
                    search_stack_usd_per_1k_req: 0.5,
                    total_usd_per_hour: 60
                },
                hardGuards: {
                    total_usd_per_hour: 80
                },
                warningThresholds: {
                    total_usd_per_hour: 50
                }
            },
            detection: {
                windows: ['5m', '15m', '1h'],
                algorithms: ['ewma', 'z_score', 'isolation_forest'],
                thresholds: {
                    spike: { minUpliftPct: 30, minConfidence: 0.7 },
                    drift: { minUpliftPct: 15, minDuration: 900 }, // 15 minutes
                    step_change: { minUpliftPct: 25, minConfidence: 0.8 }
                },
                baselineWindow: '7d',
                sensitivity: 'medium' // low, medium, high
            },
            actions: {
                ladder: [
                    { step: 1, action: 'topK_reduce', params: { from: 100, to: 60 }, expectedSavePct: 22 },
                    { step: 2, action: 'reranker_downgrade', params: { from: 'ce-large', to: 'ce-small' }, expectedSavePct: 11 },
                    { step: 3, action: 'hybrid_alpha_reduce', params: { from: 0.6, to: 0.2 }, expectedSavePct: 6 },
                    { step: 4, action: 'cache_ttl_increase', params: { from: 300, to: 900 }, expectedSavePct: 5 },
                    { step: 5, action: 'quantization_enable', params: { precision: 'int8' }, expectedSavePct: 15 },
                    { step: 6, action: 'batch_size_increase', params: { multiplier: 2 }, expectedSavePct: 8 }
                ],
                canary: {
                    trafficPct: 10,
                    durationMin: 15,
                    monitoringMetrics: ['latency_p95', 'error_rate', 'quality_ndcg10']
                },
                rollbackConditions: {
                    slo_breach: true,
                    quality_drop_ndcg10_pct: -3.0,
                    error_rate_increase_pct: 2.0,
                    latency_p95_increase_pct: 25.0
                }
            },
            observability: {
                metricsInterval: 30000, // 30 seconds
                spanNames: ['cost.collect', 'cost.detect', 'cost.rca', 'cost.decide', 'cost.apply', 'cost.report'],
                alertLevels: ['info', 'warn', 'error']
            },
            ...config
        };

        this.isInitialized = false;
        this.logger = null;
        this.eventBus = null;

        // Cost tracking and anomaly detection
        this.costData = new Map(); // serviceId -> cost metrics
        this.baselines = new Map(); // serviceId+component -> baseline data
        this.activeAnomalies = new Map(); // guardKey -> anomaly data
        this.appliedActions = new Map(); // serviceId -> applied actions
        this.actionHistory = []; // Historical action outcomes

        // Detection state
        this.detectionState = {
            lastDetectionTime: null,
            anomaliesDetected: 0,
            actionsApplied: 0,
            rollbacksExecuted: 0,
            falsePositives: 0
        };

        // Price tracking
        this.priceTable = new Map(); // resource -> pricing info
        this.budgetPolicies = new Map(); // serviceId -> budget policy

        // Performance metrics
        this.metrics = {
            detections: 0,
            actionsApplied: 0,
            rollbacks: 0,
            avgDetectMs: 0,
            p95DetectMs: 0,
            avgSavingsPct: 0,
            totalSavingsUSD: 0
        };

        this.metricsInterval = null;
    }

    /**
     * Initialize the Cost Anomaly Guard
     * @param {Object} logger - Logger instance
     * @param {Object} eventBus - Event bus for communication
     * @returns {Promise<boolean>} Success status
     */
    async initialize(logger, eventBus) {
        try {
            this.logger = logger;
            this.eventBus = eventBus;
            this.logger.info(`${this.name} initializing...`);

            await this.loadPricingData();
            await this.loadBudgetPolicies();
            await this.setupEventHandlers();
            await this.startMetricsReporting();
            await this.initializeBaselines();

            this.isInitialized = true;
            this.logger.info(`${this.name} initialized successfully`);
            return true;
        } catch (error) {
            this.logger.error(`${this.name} initialization failed:`, error);
            return false;
        }
    }

    /**
     * Load pricing data for cost calculations
     * @private
     */
    async loadPricingData() {
        // Load initial pricing table
        const defaultPricing = [
            { resource: 'inference:gpt-4', unit: '1k_tokens', usd: 0.03 },
            { resource: 'inference:gpt-3.5', unit: '1k_tokens', usd: 0.002 },
            { resource: 'kb:hnsw_mem', unit: 'GB_hour', usd: 0.018 },
            { resource: 'kb:search_ops', unit: '1k_ops', usd: 0.15 },
            { resource: 'reranker:ce-large', unit: '1k_ops', usd: 0.08 },
            { resource: 'reranker:ce-small', unit: '1k_ops', usd: 0.02 },
            { resource: 'vector:storage', unit: 'GB_month', usd: 0.25 },
            { resource: 'egress:data', unit: 'GB', usd: 0.09 }
        ];

        for (const item of defaultPricing) {
            this.priceTable.set(item.resource, {
                unit: item.unit,
                usd: item.usd,
                effectiveAt: new Date().toISOString()
            });
        }

        this.logger.info(`Loaded ${this.priceTable.size} pricing entries`);
    }

    /**
     * Load budget policies for services
     * @private
     */
    async loadBudgetPolicies() {
        // Load default budget policies
        const defaultBudgets = [
            {
                serviceId: 'kb_api',
                window: '1h',
                limits: {
                    inference_usd_per_1k_req: 0.8,
                    search_stack_usd_per_1k_req: 0.5,
                    total_usd_per_hour: 60
                },
                hardGuards: { total_usd_per_hour: 80 }
            },
            {
                serviceId: 'answer_service',
                window: '1h',
                limits: {
                    inference_usd_per_1k_req: 1.2,
                    total_usd_per_hour: 45
                },
                hardGuards: { total_usd_per_hour: 60 }
            }
        ];

        for (const budget of defaultBudgets) {
            this.budgetPolicies.set(budget.serviceId, budget);
        }

        this.logger.info(`Loaded ${this.budgetPolicies.size} budget policies`);
    }

    /**
     * Setup event handlers
     * @private
     */
    async setupEventHandlers() {
        if (!this.eventBus) return;

        // Cost data inputs
        this.eventBus.on('cost.usage.sample', this.handleCostSample.bind(this));
        this.eventBus.on('cost.usage.rollup', this.handleCostRollup.bind(this));
        this.eventBus.on('price.table.updated', this.handlePriceUpdate.bind(this));
        this.eventBus.on('budget.policy.updated', this.handleBudgetUpdate.bind(this));

        // Configuration changes
        this.eventBus.on('config.change.applied', this.handleConfigChange.bind(this));
        this.eventBus.on('kb.tuning.promoted', this.handleTuningChange.bind(this));

        // System state
        this.eventBus.on('slo.guard.triggered', this.handleSloAlert.bind(this));
        this.eventBus.on('slo.guard.recovered', this.handleSloRecovery.bind(this));

        this.logger.info('Cost guard event handlers registered');
    }

    /**
     * Handle cost usage sample
     * @param {Object} sampleData - Cost sample data
     * @private
     */
    async handleCostSample(sampleData) {
        try {
            const { serviceId, component, unitCost, request, aux } = sampleData;
            
            // Store cost sample
            const key = `${serviceId}:${component}`;
            if (!this.costData.has(key)) {
                this.costData.set(key, {
                    samples: [],
                    rollups: [],
                    lastSample: null
                });
            }

            const costInfo = this.costData.get(key);
            costInfo.samples.push({
                timestamp: sampleData.timestamp,
                unitCost: unitCost,
                request: request,
                aux: aux
            });

            // Keep only recent samples (last hour)
            const oneHourAgo = Date.now() - 3600000;
            costInfo.samples = costInfo.samples.filter(s => 
                new Date(s.timestamp).getTime() > oneHourAgo
            );

            costInfo.lastSample = sampleData.timestamp;

        } catch (error) {
            this.logger.error('Cost sample handling failed:', error);
        }
    }

    /**
     * Handle cost usage rollup for anomaly detection
     * @param {Object} rollupData - Cost rollup data
     * @private
     */
    async handleCostRollup(rollupData) {
        try {
            const startTime = Date.now();
            
            const { serviceId, window, per1kReq, perHourUSD, reqRateRps } = rollupData;
            
            // Store rollup data
            const key = `${serviceId}:total`;
            if (!this.costData.has(key)) {
                this.costData.set(key, {
                    samples: [],
                    rollups: [],
                    lastRollup: null
                });
            }

            const costInfo = this.costData.get(key);
            costInfo.rollups.push({
                timestamp: rollupData.timestamp,
                window: window,
                per1kReq: per1kReq,
                perHourUSD: perHourUSD,
                reqRateRps: reqRateRps
            });

            // Keep only recent rollups (last 24 hours)
            const oneDayAgo = Date.now() - 86400000;
            costInfo.rollups = costInfo.rollups.filter(r => 
                new Date(r.timestamp).getTime() > oneDayAgo
            );

            costInfo.lastRollup = rollupData.timestamp;

            // Perform anomaly detection
            const anomaly = await this.detectCostAnomaly(serviceId, rollupData);
            if (anomaly) {
                await this.handleCostAnomaly(serviceId, anomaly);
            }

            // Update detection metrics
            const detectTime = Date.now() - startTime;
            this.updateDetectionMetrics(detectTime);

        } catch (error) {
            this.logger.error('Cost rollup handling failed:', error);
        }
    }

    /**
     * Detect cost anomalies in rollup data
     * @param {string} serviceId - Service identifier
     * @param {Object} rollupData - Cost rollup data
     * @returns {CostAnomaly|null} Detected anomaly or null
     * @private
     */
    async detectCostAnomaly(serviceId, rollupData) {
        const { per1kReq, perHourUSD } = rollupData;
        
        // Get baseline for comparison
        const baseline = await this.getBaseline(serviceId, 'total');
        if (!baseline) {
            // Not enough historical data
            return null;
        }

        // Check different cost components
        const totalCostAnomalies = this.checkCostComponent(
            per1kReq.total, 
            baseline.per1kReq, 
            'per1k_total'
        );

        const hourlyCostAnomalies = this.checkCostComponent(
            perHourUSD.total, 
            baseline.perHourUSD, 
            'hourly_total'
        );

        // Component-specific checks
        const inferenceCostAnomalies = this.checkCostComponent(
            per1kReq.inference, 
            baseline.per1kReq_inference || per1kReq.inference, 
            'per1k_inference'
        );

        // Select most significant anomaly
        const anomalies = [totalCostAnomalies, hourlyCostAnomalies, inferenceCostAnomalies]
            .filter(a => a !== null)
            .sort((a, b) => b.upliftPct - a.upliftPct);

        if (anomalies.length === 0) {
            return null;
        }

        const topAnomaly = anomalies[0];
        
        // Perform root cause analysis
        const rca = await this.performRootCauseAnalysis(serviceId, rollupData, topAnomaly);
        
        return {
            ...topAnomaly,
            serviceId: serviceId,
            component: topAnomaly.component || 'total',
            window: rollupData.window,
            rca: rca,
            detectedAt: new Date().toISOString()
        };
    }

    /**
     * Check individual cost component for anomalies
     * @param {number} current - Current cost value
     * @param {number} baseline - Baseline cost value
     * @param {string} component - Component name
     * @returns {Object|null} Anomaly data or null
     * @private
     */
    checkCostComponent(current, baseline, component) {
        if (!current || !baseline || baseline === 0) return null;

        const upliftPct = Math.round(((current - baseline) / baseline) * 100);
        const threshold = this.config.detection.thresholds.spike.minUpliftPct;

        if (upliftPct < threshold) return null;

        // Determine anomaly kind and severity
        let kind = 'spike';
        let severity = 'warn';

        if (upliftPct >= 50) {
            severity = 'critical';
        } else if (upliftPct >= 30) {
            severity = 'high';
        }

        // Check for step change vs spike
        if (this.isStepChange(component, current, baseline)) {
            kind = 'step_change';
        }

        return {
            kind: kind,
            value: current,
            baseline: baseline,
            upliftPct: upliftPct,
            severity: severity,
            component: component,
            confidence: this.calculateConfidence(upliftPct, kind)
        };
    }

    /**
     * Perform root cause analysis for cost anomaly
     * @param {string} serviceId - Service identifier
     * @param {Object} rollupData - Cost rollup data
     * @param {Object} anomaly - Detected anomaly
     * @returns {Object} Root cause analysis
     * @private
     */
    async performRootCauseAnalysis(serviceId, rollupData, anomaly) {
        const suspects = [];
        const confidence = [];

        // Check recent configuration changes
        const recentConfigChanges = await this.getRecentConfigChanges(serviceId);
        if (recentConfigChanges.length > 0) {
            suspects.push(...recentConfigChanges.map(c => `${c.key}↑`));
            confidence.push(0.8);
        }

        // Check KB tuning changes
        const recentTuningChanges = await this.getRecentTuningChanges(serviceId);
        if (recentTuningChanges.length > 0) {
            suspects.push(...recentTuningChanges.map(t => `tuning:${t.profile}`));
            confidence.push(0.7);
        }

        // Check traffic pattern changes
        const trafficIncrease = this.checkTrafficIncrease(rollupData);
        if (trafficIncrease) {
            suspects.push('traffic↑');
            confidence.push(0.6);
        }

        // Check A/B test variants
        const abVariants = this.checkABVariants(serviceId);
        if (abVariants) {
            suspects.push('A/B:B variant');
            confidence.push(0.5);
        }

        return {
            suspects: suspects.slice(0, 3), // Top 3 suspects
            confidence: confidence.length > 0 ? Math.max(...confidence) : 0.3,
            analysis: this.generateRCAText(suspects, anomaly)
        };
    }

    /**
     * Handle detected cost anomaly
     * @param {string} serviceId - Service identifier
     * @param {CostAnomaly} anomaly - Detected anomaly
     * @private
     */
    async handleCostAnomaly(serviceId, anomaly) {
        try {
            const guardKey = this.generateGuardKey(serviceId, anomaly);
            
            // Check if already handling this anomaly
            if (this.activeAnomalies.has(guardKey)) {
                return;
            }

            this.activeAnomalies.set(guardKey, anomaly);
            this.metrics.detections++;

            // Emit detection event
            this.eventBus.emit('cost.guard.triggered', {
                event: 'cost.guard.triggered',
                timestamp: new Date().toISOString(),
                serviceId: serviceId,
                component: anomaly.component,
                window: anomaly.window,
                severity: anomaly.severity,
                signal: {
                    kind: anomaly.kind,
                    value: anomaly.value,
                    baseline: anomaly.baseline,
                    upliftPct: `+${anomaly.upliftPct}%`
                },
                ruleId: `R-${anomaly.component}>baseline`,
                budget: await this.getBudgetLimits(serviceId, anomaly.component),
                rca: anomaly.rca
            });

            // Generate action plan if severity is high enough
            if (anomaly.severity === 'high' || anomaly.severity === 'critical') {
                const actionPlan = await this.generateActionPlan(serviceId, anomaly);
                await this.executeActionPlan(serviceId, actionPlan);
            }

            // Emit cost card for UI
            this.emitCostCard(serviceId, anomaly);

        } catch (error) {
            this.logger.error('Cost anomaly handling failed:', error);
        }
    }

    /**
     * Generate action plan for cost reduction
     * @param {string} serviceId - Service identifier
     * @param {CostAnomaly} anomaly - Detected anomaly
     * @returns {ActionPlan} Generated action plan
     * @private
     */
    async generateActionPlan(serviceId, anomaly) {
        const ladder = this.config.actions.ladder.slice(); // Copy default ladder
        
        // Customize ladder based on anomaly type and RCA
        if (anomaly.rca.suspects.includes('kb.topK↑')) {
            // Prioritize topK reduction
            ladder.sort((a, b) => {
                if (a.action === 'topK_reduce') return -1;
                if (b.action === 'topK_reduce') return 1;
                return 0;
            });
        }

        if (anomaly.rca.suspects.includes('reranker:ce-large')) {
            // Prioritize reranker downgrade
            ladder.sort((a, b) => {
                if (a.action === 'reranker_downgrade') return -1;
                if (b.action === 'reranker_downgrade') return 1;
                return 0;
            });
        }

        // Select steps based on severity
        let selectedSteps = ladder.slice(0, 2); // Default: first 2 steps
        if (anomaly.severity === 'critical') {
            selectedSteps = ladder.slice(0, 4); // More aggressive for critical
        }

        const actionPlan = {
            serviceId: serviceId,
            anomaly: anomaly,
            ladder: selectedSteps,
            canary: this.config.actions.canary,
            rollbackOn: this.config.actions.rollbackConditions,
            expectedSavings: selectedSteps.reduce((sum, step) => sum + step.expectedSavePct, 0),
            createdAt: new Date().toISOString()
        };

        // Emit action plan ready event
        this.eventBus.emit('cost.action.plan.ready', {
            event: 'cost.action.plan.ready',
            timestamp: new Date().toISOString(),
            serviceId: serviceId,
            component: anomaly.component,
            ladder: selectedSteps,
            canary: this.config.actions.canary,
            rollbackOn: this.config.actions.rollbackConditions
        });

        return actionPlan;
    }

    /**
     * Execute action plan with canary deployment
     * @param {string} serviceId - Service identifier
     * @param {ActionPlan} actionPlan - Action plan to execute
     * @private
     */
    async executeActionPlan(serviceId, actionPlan) {
        try {
            const appliedActions = this.appliedActions.get(serviceId) || [];

            for (const step of actionPlan.ladder) {
                // Check if action already applied
                if (appliedActions.some(a => a.action === step.action)) {
                    continue;
                }

                // Apply action via appropriate service
                const applyResult = await this.applyAction(serviceId, step);
                
                if (applyResult.status === 'ok') {
                    appliedActions.push({
                        ...step,
                        appliedAt: new Date().toISOString(),
                        status: 'applied'
                    });

                    this.appliedActions.set(serviceId, appliedActions);
                    this.metrics.actionsApplied++;

                    // Emit action applied event
                    this.eventBus.emit('cost.action.applied', {
                        event: 'cost.action.applied',
                        timestamp: new Date().toISOString(),
                        serviceId: serviceId,
                        step: step.step,
                        action: step.action,
                        to: step.params.to || step.params,
                        via: applyResult.via,
                        status: 'ok'
                    });

                    this.logger.info(`Applied cost action ${step.action} for ${serviceId}`);
                    
                    // Wait for canary period before next action
                    if (actionPlan.canary.durationMin > 0) {
                        await new Promise(resolve => 
                            setTimeout(resolve, actionPlan.canary.durationMin * 60000)
                        );
                        
                        // Check if rollback needed
                        const shouldRollback = await this.checkRollbackConditions(serviceId, actionPlan);
                        if (shouldRollback) {
                            await this.executeRollback(serviceId, step);
                            break;
                        }
                    }
                } else {
                    this.logger.error(`Failed to apply action ${step.action} for ${serviceId}:`, applyResult.error);
                }
            }

        } catch (error) {
            this.logger.error('Action plan execution failed:', error);
        }
    }

    /**
     * Apply individual cost reduction action
     * @param {string} serviceId - Service identifier
     * @param {Object} step - Action step to apply
     * @returns {Object} Application result
     * @private
     */
    async applyAction(serviceId, step) {
        try {
            const { action, params } = step;
            
            switch (action) {
                case 'topK_reduce':
                    // Apply via KB tuning service (LIVIA-47)
                    if (this.eventBus) {
                        this.eventBus.emit('kb.config.update', {
                            event: 'kb.config.update',
                            timestamp: new Date().toISOString(),
                            serviceId: serviceId,
                            config: { topK: params.to },
                            reason: 'cost_optimization'
                        });
                    }
                    return { status: 'ok', via: 'LIVIA-47' };

                case 'reranker_downgrade':
                    if (this.eventBus) {
                        this.eventBus.emit('kb.config.update', {
                            event: 'kb.config.update',
                            timestamp: new Date().toISOString(),
                            serviceId: serviceId,
                            config: { reranker: params.to },
                            reason: 'cost_optimization'
                        });
                    }
                    return { status: 'ok', via: 'LIVIA-47' };

                case 'cache_ttl_increase':
                    if (this.eventBus) {
                        this.eventBus.emit('cache.config.update', {
                            event: 'cache.config.update',
                            timestamp: new Date().toISOString(),
                            serviceId: serviceId,
                            config: { ttlSec: params.to },
                            reason: 'cost_optimization'
                        });
                    }
                    return { status: 'ok', via: 'LIVIA-35' };

                default:
                    return { status: 'error', error: `Unknown action: ${action}` };
            }

        } catch (error) {
            return { status: 'error', error: error.message };
        }
    }

    /**
     * Check if rollback conditions are met
     * @param {string} serviceId - Service identifier
     * @param {ActionPlan} actionPlan - Action plan being executed
     * @returns {boolean} Whether to rollback
     * @private
     */
    async checkRollbackConditions(serviceId, actionPlan) {
        const conditions = actionPlan.rollbackOn;
        
        // Check SLO breach
        if (conditions.slo_breach && this.hasActiveSloAlert(serviceId)) {
            this.logger.warn(`SLO breach detected for ${serviceId}, initiating rollback`);
            return true;
        }

        // In a real implementation, you would check other conditions like
        // quality drops, error rate increases, etc. via other LIVIA modules
        
        return false;
    }

    /**
     * Execute rollback of applied actions
     * @param {string} serviceId - Service identifier
     * @param {Object} step - Step to rollback
     * @private
     */
    async executeRollback(serviceId, step) {
        try {
            // Restore original configuration
            const originalParams = this.getOriginalParams(step);
            const rollbackStep = {
                ...step,
                params: originalParams
            };

            await this.applyAction(serviceId, rollbackStep);
            
            this.metrics.rollbacks++;
            
            this.eventBus.emit('cost.action.rollback', {
                event: 'cost.action.rollback',
                timestamp: new Date().toISOString(),
                serviceId: serviceId,
                action: step.action,
                reason: 'safety_conditions'
            });

            this.logger.info(`Rolled back action ${step.action} for ${serviceId}`);

        } catch (error) {
            this.logger.error('Rollback execution failed:', error);
        }
    }

    /**
     * Utility methods for cost guard operations
     */

    // Generate unique guard key for idempotency
    generateGuardKey(serviceId, anomaly) {
        const hash = crypto.createHash('md5')
            .update(`${serviceId}:${anomaly.component}:${anomaly.window}:${anomaly.kind}`)
            .digest('hex')
            .substring(0, 8);
        
        return `costguard-${serviceId}-${hash}`;
    }

    // Get baseline for cost comparison
    async getBaseline(serviceId, component) {
        const key = `${serviceId}:${component}`;
        const costInfo = this.costData.get(key);
        
        if (!costInfo || costInfo.rollups.length < 10) {
            return null; // Not enough data
        }

        // Calculate baseline from recent history (excluding last 2 data points to avoid bias)
        const recentRollups = costInfo.rollups.slice(0, -2);
        const per1kReqValues = recentRollups.map(r => r.per1kReq?.total || 0).filter(v => v > 0);
        const perHourUSDValues = recentRollups.map(r => r.perHourUSD?.total || 0).filter(v => v > 0);

        if (per1kReqValues.length === 0 && perHourUSDValues.length === 0) {
            return null;
        }

        return {
            per1kReq: this.calculateMedian(per1kReqValues),
            perHourUSD: this.calculateMedian(perHourUSDValues),
            per1kReq_inference: this.calculateMedian(recentRollups.map(r => r.per1kReq?.inference || 0)),
            calculatedAt: new Date().toISOString()
        };
    }

    // Calculate median value
    calculateMedian(values) {
        if (values.length === 0) return 0;
        const sorted = values.slice().sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        return sorted.length % 2 === 0 
            ? (sorted[mid - 1] + sorted[mid]) / 2 
            : sorted[mid];
    }

    // Check if anomaly is step change vs spike
    isStepChange(component, current, baseline) {
        // Simplified step change detection
        // In real implementation, this would analyze time series data
        return Math.abs(current - baseline) / baseline > 0.4;
    }

    // Calculate confidence score for anomaly
    calculateConfidence(upliftPct, kind) {
        let baseConfidence = 0.5;
        
        if (kind === 'spike' && upliftPct > 50) baseConfidence = 0.8;
        if (kind === 'step_change' && upliftPct > 30) baseConfidence = 0.9;
        
        return Math.min(baseConfidence + (upliftPct / 100) * 0.3, 1.0);
    }

    // Get recent configuration changes (placeholder)
    async getRecentConfigChanges(serviceId) {
        // In real implementation, this would query config change logs
        return [];
    }

    // Get recent tuning changes (placeholder)
    async getRecentTuningChanges(serviceId) {
        // In real implementation, this would query tuning change logs
        return [];
    }

    // Check for traffic increase
    checkTrafficIncrease(rollupData) {
        // Simplified traffic increase detection
        return rollupData.reqRateRps > 50; // Example threshold
    }

    // Check A/B test variants (placeholder)
    checkABVariants(serviceId) {
        // In real implementation, this would check A/B test configurations
        return false;
    }

    // Generate RCA text
    generateRCAText(suspects, anomaly) {
        if (suspects.length === 0) {
            return `Unexplained ${anomaly.kind} in ${anomaly.component} costs (+${anomaly.upliftPct}%)`;
        }
        
        return `Likely causes: ${suspects.join(', ')} → ${anomaly.kind} (+${anomaly.upliftPct}%)`;
    }

    // Get budget limits for service/component
    async getBudgetLimits(serviceId, component) {
        const policy = this.budgetPolicies.get(serviceId);
        if (!policy) {
            return { limit: 1.0, hard: 1.5 }; // Default limits
        }

        const componentKey = component.replace('per1k_', '').replace('hourly_', '');
        const limit = policy.limits[`${componentKey}_usd_per_1k_req`] || 
                     policy.limits[`${componentKey}_usd_per_hour`] || 
                     policy.limits.total_usd_per_hour;
        
        const hard = policy.hardGuards[`${componentKey}_usd_per_hour`] || 
                    policy.hardGuards.total_usd_per_hour;

        return { limit, hard };
    }

    // Check if service has active SLO alert
    hasActiveSloAlert(serviceId) {
        // In real implementation, this would check active SLO alerts
        return false;
    }

    // Get original parameters before optimization
    getOriginalParams(step) {
        switch (step.action) {
            case 'topK_reduce':
                return { to: step.params.from };
            case 'reranker_downgrade':
                return { to: step.params.from };
            case 'cache_ttl_increase':
                return { to: step.params.from };
            default:
                return {};
        }
    }

    // Emit cost card for UI
    emitCostCard(serviceId, anomaly) {
        this.eventBus.emit('cost.card', {
            event: 'cost.card',
            timestamp: new Date().toISOString(),
            title: `Maliyet Guard — ${serviceId} (${anomaly.component} +${anomaly.upliftPct}%/${anomaly.window})`,
            body: `${anomaly.rca.analysis}. Otomatik iyileştirme başlatıldı.`,
            severity: anomaly.severity,
            ttlSec: 600
        });
    }

    // Update detection metrics
    updateDetectionMetrics(detectTimeMs) {
        this.metrics.avgDetectMs = Math.round((this.metrics.avgDetectMs + detectTimeMs) / 2);
        if (detectTimeMs > this.metrics.p95DetectMs) {
            this.metrics.p95DetectMs = detectTimeMs;
        }
    }

    // Initialize baselines from historical data
    async initializeBaselines() {
        this.logger.info('Initializing cost baselines...');
        // In real implementation, this would load historical cost data
    }

    /**
     * Event handlers for external updates
     */
    handlePriceUpdate(priceData) {
        for (const item of priceData.items) {
            this.priceTable.set(item.resource, {
                unit: item.unit,
                usd: item.usd,
                effectiveAt: priceData.effectiveAt
            });
        }
        this.logger.info(`Updated pricing for ${priceData.items.length} resources`);
    }

    handleBudgetUpdate(budgetData) {
        this.budgetPolicies.set(budgetData.serviceId, budgetData);
        this.logger.info(`Updated budget policy for ${budgetData.serviceId}`);
    }

    handleConfigChange(configData) {
        // Track configuration changes for RCA
        this.logger.info(`Config change detected: ${configData.serviceId} - ${configData.change.key}`);
    }

    handleTuningChange(tuningData) {
        // Track tuning changes for RCA
        this.logger.info(`Tuning change detected: ${tuningData.namespace} - ${tuningData.profile}`);
    }

    handleSloAlert(sloData) {
        // Mark service as having SLO issues for rollback decisions
        this.logger.warn(`SLO alert for ${sloData.serviceId}: ${sloData.slo}`);
    }

    handleSloRecovery(sloData) {
        this.logger.info(`SLO recovered for ${sloData.serviceId}: ${sloData.slo}`);
    }

    /**
     * Start metrics reporting
     * @private
     */
    async startMetricsReporting() {
        this.metricsInterval = setInterval(() => {
            this.emitMetrics();
        }, this.config.observability.metricsInterval);
    }

    /**
     * Emit performance metrics
     * @private
     */
    emitMetrics() {
        const metrics = {
            event: 'cost.metrics',
            timestamp: new Date().toISOString(),
            detections: this.metrics.detections,
            actionsApplied: this.metrics.actionsApplied,
            rollbacks: this.metrics.rollbacks,
            avgDetectMs: this.metrics.avgDetectMs,
            p95DetectMs: this.metrics.p95DetectMs,
            avgSavingsPct: this.metrics.avgSavingsPct,
            totalSavingsUSD: this.metrics.totalSavingsUSD,
            activeAnomalies: this.activeAnomalies.size,
            servicesMonitored: this.costData.size
        };

        if (this.eventBus) {
            this.eventBus.emit('system.metrics', metrics);
        }

        this.logger.info('Cost guard metrics emitted', metrics);
    }

    /**
     * Get module status
     * @returns {Object} Current status
     */
    getStatus() {
        return {
            name: this.name,
            initialized: this.isInitialized,
            enabled: this.config.enabled,
            activeAnomalies: this.activeAnomalies.size,
            servicesMonitored: this.costData.size,
            appliedActions: Array.from(this.appliedActions.keys()).length,
            metrics: this.metrics,
            detectionState: this.detectionState,
            config: this.config
        };
    }

    /**
     * Shutdown the module
     */
    async shutdown() {
        try {
            this.logger.info(`${this.name} shutting down...`);

            // Clear intervals
            if (this.metricsInterval) {
                clearInterval(this.metricsInterval);
            }

            this.isInitialized = false;
            this.logger.info(`${this.name} shutdown completed`);
        } catch (error) {
            this.logger.error(`${this.name} shutdown error:`, error);
        }
    }
}

module.exports = CostAnomalyGuard;