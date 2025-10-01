/**
 * LIVIA-52: Chaos Experiment Designer
 * Güvenli kaos deneylerini tasarla, planla, enjekte et, gözlemle
 * Resilience testing with chaos engineering principles
 * @version 1.0.0
 * @author LIVIA System
 */

const crypto = require('crypto');
const EventEmitter = require('events');

/**
 * @typedef {Object} ChaosExperimentConfig
 * @property {Object} safety - Safety configuration
 * @property {Object} blastRadius - Blast radius limits
 * @property {Object} tools - Chaos tools configuration
 * @property {Object} templates - Predefined experiment templates
 * @property {Object} scheduling - Experiment scheduling
 * @property {Object} observability - Monitoring and metrics
 */

/**
 * @typedef {Object} ChaosScenario
 * @property {string} scenarioId - Unique scenario identifier
 * @property {string} title - Human-readable title
 * @property {Object} targets - Target services/regions
 * @property {Array} stages - Experiment stages (ramp_up, steady, ramp_down)
 * @property {Array} tools - Chaos tools to use
 * @property {Object} blastRadius - Impact limitations
 * @property {Object} expected - Expected impact metrics
 */

/**
 * @typedef {Object} ExperimentGuards
 * @property {boolean} abortOnSloBreach - Abort on SLO breach
 * @property {boolean} abortOnCostHard - Abort on cost hard limit
 * @property {boolean} freezeCheck - Check release freeze status
 * @property {number} maxBlastRadiusPct - Maximum blast radius percentage
 * @property {Array} allowedTenants - Allowed tenant environments
 */

class ChaosExperimentDesigner extends EventEmitter {
    /**
     * Initialize Chaos Experiment Designer
     * @param {ChaosExperimentConfig} config - Designer configuration
     */
    constructor(config = {}) {
        super();
        this.name = 'ChaosExperimentDesigner';
        this.config = {
            safety: {
                maxBlastRadiusPct: 25,
                defaultAbortOnSloBreach: true,
                defaultAbortOnCostHard: true,
                allowedEnvs: ['staging', 'prod'],
                maxDurationMin: 120,
                cooldownMin: 60
            },
            blastRadius: {
                network: { maxLatencyMs: 1000, maxLossPct: 5 },
                cpu: { maxUsagePct: 80, maxThrottlePct: 50 },
                memory: { maxUsagePct: 85, maxLeakMB: 1024 },
                disk: { maxIoThrottlePct: 70, maxFillPct: 90 },
                pods: { maxKillPct: 30, maxConcurrentKills: 3 }
            },
            tools: {
                chaosmesh: { enabled: true, namespace: 'chaos-mesh' },
                litmus: { enabled: false, namespace: 'litmus' },
                toxiproxy: { enabled: true, port: 8474 },
                netem: { enabled: true, interface: 'eth0' },
                awsFis: { enabled: false, region: 'eu-central-1' }
            },
            templates: {
                network: {
                    latency: { baseMs: 100, jitterMs: 20, maxMs: 500 },
                    loss: { basePct: 0.1, maxPct: 2.0 },
                    jitter: { baseMs: 10, maxMs: 100 }
                },
                resource: {
                    cpu: { baseUsagePct: 50, maxUsagePct: 80 },
                    memory: { baseUsageMB: 512, maxUsageMB: 2048 },
                    disk: { baseIops: 1000, maxIops: 5000 }
                }
            },
            scheduling: {
                preferredHours: { start: 2, end: 6 }, // 02:00-06:00 local time
                forbiddenDays: ['monday', 'friday'], // Avoid Mon/Fri
                maxConcurrentExperiments: 3,
                minGapBetweenMin: 30
            },
            observability: {
                metricsInterval: 30000, // 30 seconds
                alertThresholds: {
                    p95DeltaMs: 500,
                    errorRateDelta: 1.0,
                    costDeltaUSD: 10.0
                },
                spans: ['chaos.plan', 'chaos.guard', 'chaos.inject', 'chaos.observe', 'chaos.score']
            },
            ...config
        };

        this.isInitialized = false;
        this.logger = null;
        this.eventBus = null;

        // Experiment state management
        this.scenarios = new Map(); // scenarioId -> scenario definition
        this.activeExperiments = new Map(); // expKey -> experiment state
        this.scheduledExperiments = new Map(); // expKey -> schedule info
        this.experimentHistory = []; // Recent experiment results
        
        // Guards and safety checks
        this.guardState = {
            releaseFreeze: 'thawed',
            activeIncidents: false,
            sloStatus: 'healthy',
            costStatus: 'normal',
            lastExperimentTime: null
        };

        // Performance tracking
        this.metrics = {
            experimentsTotal: 0,
            experimentsSuccessful: 0,
            experimentsFailed: 0,
            experimentsAborted: 0,
            averageDurationMin: 0,
            impactMetrics: {
                avgP95DeltaMs: 0,
                avgErrorRateDelta: 0,
                avgCostDeltaUSD: 0
            }
        };

        // Experiment states
        this.states = {
            PLANNED: 'PLANNED',
            SCHEDULED: 'SCHEDULED',
            GUARD_CHECK: 'GUARD_CHECK',
            INJECTING: 'INJECTING',
            OBSERVING: 'OBSERVING',
            RECOVERING: 'RECOVERING',
            COMPLETED: 'COMPLETED',
            ABORTED: 'ABORTED',
            FAILED: 'FAILED'
        };

        this.metricsInterval = null;
    }

    /**
     * Initialize the Chaos Experiment Designer
     * @param {Object} logger - Logger instance
     * @param {Object} eventBus - Event bus for communication
     * @returns {Promise<boolean>} Success status
     */
    async initialize(logger, eventBus) {
        try {
            this.logger = logger;
            this.eventBus = eventBus;
            this.logger.info(`${this.name} initializing...`);

            await this.loadPredefinedScenarios();
            await this.setupEventHandlers();
            await this.startMetricsReporting();
            await this.scheduleMaintenanceTasks();

            this.isInitialized = true;
            this.logger.info(`${this.name} initialized successfully`);
            return true;
        } catch (error) {
            this.logger.error(`${this.name} initialization failed:`, error);
            return false;
        }
    }

    /**
     * Load predefined chaos scenarios
     * @private
     */
    async loadPredefinedScenarios() {
        // Network latency scenarios
        this.registerScenario({
            scenarioId: 'net-latency-api-light',
            title: 'API Network Latency - Light Impact',
            targets: { serviceIds: ['api-gateway'], regions: ['eu-central'] },
            stages: [
                { name: 'ramp_up', durationSec: 180, params: { latencyMs: 100, jitterMs: 20 } },
                { name: 'steady', durationSec: 600, params: { latencyMs: 200, jitterMs: 50 } },
                { name: 'ramp_down', durationSec: 180, params: { latencyMs: 100, jitterMs: 20 } }
            ],
            tools: ['toxiproxy', 'tc-netem'],
            blastRadius: { trafficMaxPct: 15, tenants: ['sandbox', 'staging'] },
            expected: { p95MsDeltaMax: 150, errPctMaxDelta: 0.2 }
        });

        // CPU stress scenarios
        this.registerScenario({
            scenarioId: 'cpu-stress-moderate',
            title: 'CPU Stress - Moderate Load',
            targets: { serviceIds: ['data-processor'], regions: ['eu-central'] },
            stages: [
                { name: 'ramp_up', durationSec: 120, params: { cpuUsagePct: 40 } },
                { name: 'steady', durationSec: 480, params: { cpuUsagePct: 70 } },
                { name: 'ramp_down', durationSec: 120, params: { cpuUsagePct: 40 } }
            ],
            tools: ['chaosmesh', 'stress-ng'],
            blastRadius: { trafficMaxPct: 20, tenants: ['staging'] },
            expected: { p95MsDeltaMax: 200, errPctMaxDelta: 0.5 }
        });

        // Memory pressure scenarios
        this.registerScenario({
            scenarioId: 'memory-pressure-gradual',
            title: 'Memory Pressure - Gradual Increase',
            targets: { serviceIds: ['cache-service'], regions: ['eu-central'] },
            stages: [
                { name: 'ramp_up', durationSec: 300, params: { memoryUsageMB: 512 } },
                { name: 'steady', durationSec: 600, params: { memoryUsageMB: 1024 } },
                { name: 'ramp_down', durationSec: 300, params: { memoryUsageMB: 512 } }
            ],
            tools: ['chaosmesh'],
            blastRadius: { trafficMaxPct: 10, tenants: ['staging'] },
            expected: { p95MsDeltaMax: 100, errPctMaxDelta: 0.3 }
        });

        this.logger.info(`Loaded ${this.scenarios.size} predefined chaos scenarios`);
    }

    /**
     * Register a new chaos scenario
     * @param {ChaosScenario} scenario - Scenario definition
     */
    registerScenario(scenario) {
        // Validate scenario
        if (!this.validateScenario(scenario)) {
            throw new Error(`Invalid scenario: ${scenario.scenarioId}`);
        }

        this.scenarios.set(scenario.scenarioId, {
            ...scenario,
            registeredAt: new Date().toISOString(),
            hash: this.calculateScenarioHash(scenario)
        });

        if (this.eventBus) {
            this.eventBus.emit('chaos.catalog.registered', {
                event: 'chaos.catalog.registered',
                timestamp: new Date().toISOString(),
                ...scenario
            });
        }

        this.logger.info(`Chaos scenario registered: ${scenario.scenarioId}`);
    }

    /**
     * Setup event handlers
     * @private
     */
    async setupEventHandlers() {
        if (!this.eventBus) return;

        // Experiment requests
        this.eventBus.on('chaos.request', this.handleExperimentRequest.bind(this));
        this.eventBus.on('chaos.template.request', this.handleTemplateRequest.bind(this));
        this.eventBus.on('chaos.override.request', this.handleOverrideRequest.bind(this));

        // System state updates
        this.eventBus.on('release.freeze.state', this.handleFreezeTateUpdate.bind(this));
        this.eventBus.on('slo.guard.triggered', this.handleSloAlert.bind(this));
        this.eventBus.on('slo.guard.recovered', this.handleSloRecovery.bind(this));
        this.eventBus.on('cost.guard.triggered', this.handleCostAlert.bind(this));
        this.eventBus.on('cost.guard.recovered', this.handleCostRecovery.bind(this));

        this.logger.info('Chaos experiment event handlers registered');
    }

    /**
     * Handle experiment request
     * @param {Object} requestData - Experiment request
     * @private
     */
    async handleExperimentRequest(requestData) {
        try {
            const { scenarioId, env, schedule, seed, syntheticLoad, safety, notes } = requestData;
            
            // Validate scenario exists
            if (!this.scenarios.has(scenarioId)) {
                this.logger.error(`Unknown scenario: ${scenarioId}`);
                return;
            }

            const scenario = this.scenarios.get(scenarioId);
            const expKey = this.generateExperimentKey(scenarioId, schedule, seed);

            // Check if experiment already planned/running
            if (this.activeExperiments.has(expKey)) {
                this.logger.warn(`Experiment already active: ${expKey}`);
                return;
            }

            // Perform safety checks
            const guardCheck = await this.performGuardChecks(scenario, env, safety);
            if (!guardCheck.ok) {
                this.emitExperimentAlert('error', 'safety_check_failed', { 
                    expKey, 
                    scenarioId, 
                    reason: guardCheck.reason 
                });
                return;
            }

            // Create experiment plan
            const experimentPlan = {
                expKey: expKey,
                scenarioId: scenarioId,
                scenario: scenario,
                env: env,
                schedule: schedule,
                seed: seed,
                syntheticLoad: syntheticLoad || { enabled: false },
                safety: {
                    abortOnSloBreach: safety?.abortOnSloBreach ?? this.config.safety.defaultAbortOnSloBreach,
                    abortOnCostHard: safety?.abortOnCostHard ?? this.config.safety.defaultAbortOnCostHard,
                    freezeCheck: true,
                    ...safety
                },
                notes: notes || '',
                state: this.states.PLANNED,
                createdAt: new Date().toISOString(),
                hash: crypto.createHash('sha256').update(JSON.stringify({
                    scenarioId, env, schedule, seed, safety
                })).digest('hex')
            };

            // Store experiment
            this.activeExperiments.set(expKey, experimentPlan);

            // Schedule if needed
            if (schedule.at) {
                await this.scheduleExperiment(experimentPlan);
            } else {
                // Execute immediately
                await this.executeExperiment(expKey);
            }

            // Emit plan ready event
            this.eventBus.emit('chaos.plan.ready', {
                event: 'chaos.plan.ready',
                timestamp: new Date().toISOString(),
                expKey: expKey,
                scenarioId: scenarioId,
                env: env,
                stages: scenario.stages.map(s => s.name),
                tools: scenario.tools,
                blastRadius: scenario.blastRadius,
                guards: experimentPlan.safety,
                expectedImpact: scenario.expected,
                hash: experimentPlan.hash
            });

            this.logger.info(`Chaos experiment planned: ${expKey}`);

        } catch (error) {
            this.logger.error('Experiment request handling failed:', error);
        }
    }

    /**
     * Handle template request to generate experiment from template
     * @param {Object} templateData - Template request data
     * @private
     */
    async handleTemplateRequest(templateData) {
        try {
            const { kind, severity, durationMin, targets, constraints } = templateData;
            
            const templateScenario = this.generateFromTemplate(kind, severity, durationMin, targets, constraints);
            
            if (templateScenario) {
                this.registerScenario(templateScenario);
                this.logger.info(`Generated scenario from template: ${templateScenario.scenarioId}`);
            }

        } catch (error) {
            this.logger.error('Template request handling failed:', error);
        }
    }

    /**
     * Handle experiment override (pause/resume/abort)
     * @param {Object} overrideData - Override request data
     * @private
     */
    async handleOverrideRequest(overrideData) {
        try {
            const { action, reason, by } = overrideData;
            
            // Apply override to all active experiments
            for (const [expKey, experiment] of this.activeExperiments) {
                if (experiment.state === this.states.INJECTING || 
                    experiment.state === this.states.OBSERVING) {
                    
                    await this.applyOverride(expKey, action, reason, by);
                }
            }

        } catch (error) {
            this.logger.error('Override request handling failed:', error);
        }
    }

    /**
     * Perform safety guard checks before experiment
     * @param {ChaosScenario} scenario - Experiment scenario
     * @param {string} env - Target environment
     * @param {Object} safety - Safety configuration
     * @returns {Object} Guard check result
     * @private
     */
    async performGuardChecks(scenario, env, safety) {
        const checks = {
            releaseFreeze: this.guardState.releaseFreeze === 'thawed',
            activeIncident: !this.guardState.activeIncidents,
            rbac: true, // Simplified - implement proper RBAC
            sloBudgetOk: this.guardState.sloStatus === 'healthy',
            costBudgetOk: this.guardState.costStatus === 'normal',
            blastRadiusOk: this.validateBlastRadius(scenario.blastRadius),
            environmentOk: this.config.safety.allowedEnvs.includes(env),
            cooldownOk: this.checkCooldownPeriod()
        };

        const allOk = Object.values(checks).every(check => check === true);

        const guardSnapshot = {
            event: 'chaos.guard.snapshot',
            timestamp: new Date().toISOString(),
            status: allOk ? 'ok' : 'abort',
            checks: checks
        };

        if (this.eventBus) {
            this.eventBus.emit('chaos.guard.snapshot', guardSnapshot);
        }

        return {
            ok: allOk,
            reason: allOk ? null : this.getFailedCheckReasons(checks),
            checks: checks
        };
    }

    /**
     * Execute chaos experiment
     * @param {string} expKey - Experiment key
     * @private
     */
    async executeExperiment(expKey) {
        const experiment = this.activeExperiments.get(expKey);
        if (!experiment) return;

        try {
            experiment.state = this.states.GUARD_CHECK;
            experiment.startedAt = new Date().toISOString();

            // Final guard check
            const guardCheck = await this.performGuardChecks(
                experiment.scenario, 
                experiment.env, 
                experiment.safety
            );

            if (!guardCheck.ok) {
                experiment.state = this.states.ABORTED;
                experiment.endedAt = new Date().toISOString();
                experiment.abortReason = guardCheck.reason;
                this.metrics.experimentsAborted++;
                return;
            }

            // Start injection
            experiment.state = this.states.INJECTING;
            
            this.eventBus.emit('chaos.inject.started', {
                event: 'chaos.inject.started',
                timestamp: new Date().toISOString(),
                expKey: expKey,
                scenarioId: experiment.scenarioId,
                env: experiment.env,
                stages: experiment.scenario.stages.map(s => s.name),
                estimatedDurationMin: this.calculateTotalDuration(experiment.scenario.stages)
            });

            // Execute stages
            for (const stage of experiment.scenario.stages) {
                await this.executeStage(expKey, stage);
                
                // Check for abort conditions during execution
                if (await this.shouldAbortExperiment(expKey)) {
                    await this.abortExperiment(expKey, 'safety_breach');
                    return;
                }
            }

            // Complete experiment
            experiment.state = this.states.RECOVERING;
            await this.cleanupExperiment(expKey);
            
            experiment.state = this.states.COMPLETED;
            experiment.endedAt = new Date().toISOString();
            
            this.metrics.experimentsSuccessful++;
            this.recordExperimentResult(experiment);

            this.eventBus.emit('chaos.experiment.completed', {
                event: 'chaos.experiment.completed',
                timestamp: new Date().toISOString(),
                expKey: expKey,
                scenarioId: experiment.scenarioId,
                durationMin: this.calculateDuration(experiment.startedAt, experiment.endedAt),
                impact: await this.calculateImpactMetrics(expKey)
            });

            this.logger.info(`Chaos experiment completed: ${expKey}`);

        } catch (error) {
            experiment.state = this.states.FAILED;
            experiment.endedAt = new Date().toISOString();
            experiment.error = error.message;
            this.metrics.experimentsFailed++;
            
            this.logger.error(`Chaos experiment failed: ${expKey}`, error);
        }
    }

    /**
     * Execute individual experiment stage
     * @param {string} expKey - Experiment key
     * @param {Object} stage - Stage configuration
     * @private
     */
    async executeStage(expKey, stage) {
        const experiment = this.activeExperiments.get(expKey);
        if (!experiment) return;

        experiment.currentStage = stage.name;
        
        this.eventBus.emit('chaos.stage.started', {
            event: 'chaos.stage.started',
            timestamp: new Date().toISOString(),
            expKey: expKey,
            stage: stage.name,
            durationSec: stage.durationSec,
            params: stage.params
        });

        // Simulate stage execution (in real implementation, this would call chaos tools)
        await this.simulateStageExecution(stage);

        // Monitor impact during stage
        experiment.state = this.states.OBSERVING;
        await this.monitorStageImpact(expKey, stage);

        this.eventBus.emit('chaos.stage.completed', {
            event: 'chaos.stage.completed',
            timestamp: new Date().toISOString(),
            expKey: expKey,
            stage: stage.name,
            impact: await this.calculateStageImpact(expKey, stage)
        });
    }

    /**
     * Generate experiment from template
     * @param {string} kind - Experiment kind
     * @param {string} severity - Severity level
     * @param {number} durationMin - Duration in minutes
     * @param {Object} targets - Target configuration
     * @param {Object} constraints - Constraints
     * @returns {ChaosScenario} Generated scenario
     * @private
     */
    generateFromTemplate(kind, severity, durationMin, targets, constraints) {
        const scenarioId = `${kind}-${severity}-${Date.now()}`;
        const template = this.config.templates[kind];
        
        if (!template) {
            this.logger.error(`Unknown template kind: ${kind}`);
            return null;
        }

        const severityMultipliers = {
            low: 0.5,
            medium: 1.0,
            high: 1.5
        };

        const multiplier = severityMultipliers[severity] || 1.0;
        const totalDurationSec = durationMin * 60;
        const rampDurationSec = Math.min(totalDurationSec * 0.2, 300); // 20% or max 5min
        const steadyDurationSec = totalDurationSec - (2 * rampDurationSec);

        let stages = [];
        let params = {};

        switch (kind) {
            case 'network':
                params = {
                    latencyMs: Math.round(template.latency.baseMs * multiplier),
                    jitterMs: Math.round(template.latency.jitterMs * multiplier),
                    lossPct: Math.round(template.loss.basePct * multiplier * 100) / 100
                };
                break;
            case 'cpu':
                params = {
                    cpuUsagePct: Math.round(template.cpu.baseUsagePct * multiplier)
                };
                break;
            case 'memory':
                params = {
                    memoryUsageMB: Math.round(template.memory.baseUsageMB * multiplier)
                };
                break;
        }

        stages = [
            { name: 'ramp_up', durationSec: rampDurationSec, params: this.reduceParams(params, 0.5) },
            { name: 'steady', durationSec: steadyDurationSec, params: params },
            { name: 'ramp_down', durationSec: rampDurationSec, params: this.reduceParams(params, 0.5) }
        ];

        return {
            scenarioId: scenarioId,
            title: `${kind.toUpperCase()} ${severity} - Auto-generated`,
            targets: targets,
            stages: stages,
            tools: this.selectToolsForKind(kind),
            blastRadius: { trafficMaxPct: 15, tenants: ['staging'] },
            expected: {
                p95MsDeltaMax: constraints.p95MsMax || 400,
                errPctMaxDelta: constraints.errPctMax || 2.0
            }
        };
    }

    /**
     * Validate chaos scenario
     * @param {ChaosScenario} scenario - Scenario to validate
     * @returns {boolean} Validation result
     * @private
     */
    validateScenario(scenario) {
        const required = ['scenarioId', 'title', 'targets', 'stages', 'tools', 'blastRadius'];
        
        for (const field of required) {
            if (!scenario[field]) {
                this.logger.error(`Missing required field: ${field}`);
                return false;
            }
        }

        // Validate blast radius
        if (!this.validateBlastRadius(scenario.blastRadius)) {
            return false;
        }

        // Validate stages
        if (!Array.isArray(scenario.stages) || scenario.stages.length === 0) {
            this.logger.error('Scenario must have at least one stage');
            return false;
        }

        return true;
    }

    /**
     * Validate blast radius configuration
     * @param {Object} blastRadius - Blast radius config
     * @returns {boolean} Validation result
     * @private
     */
    validateBlastRadius(blastRadius) {
        if (blastRadius.trafficMaxPct > this.config.safety.maxBlastRadiusPct) {
            this.logger.error(`Blast radius too large: ${blastRadius.trafficMaxPct}% > ${this.config.safety.maxBlastRadiusPct}%`);
            return false;
        }

        return true;
    }

    /**
     * Check cooldown period between experiments
     * @returns {boolean} Cooldown check result
     * @private
     */
    checkCooldownPeriod() {
        if (!this.guardState.lastExperimentTime) return true;
        
        const now = Date.now();
        const lastExperiment = new Date(this.guardState.lastExperimentTime).getTime();
        const cooldownMs = this.config.safety.cooldownMin * 60 * 1000;
        
        return (now - lastExperiment) >= cooldownMs;
    }

    /**
     * Generate unique experiment key
     * @param {string} scenarioId - Scenario ID
     * @param {Object} schedule - Schedule info
     * @param {number} seed - Random seed
     * @returns {string} Experiment key
     * @private
     */
    generateExperimentKey(scenarioId, schedule, seed) {
        const timestamp = schedule.at || new Date().toISOString();
        const hash = crypto.createHash('md5')
            .update(`${scenarioId}:${timestamp}:${seed}`)
            .digest('hex')
            .substring(0, 8);
        
        return `${scenarioId}#${hash}`;
    }

    /**
     * Calculate scenario hash for integrity
     * @param {ChaosScenario} scenario - Scenario to hash
     * @returns {string} SHA256 hash
     * @private
     */
    calculateScenarioHash(scenario) {
        return crypto.createHash('sha256')
            .update(JSON.stringify(scenario))
            .digest('hex');
    }

    /**
     * Emit experiment-related alert
     * @param {string} level - Alert level
     * @param {string} message - Alert message
     * @param {Object} context - Alert context
     * @private
     */
    emitExperimentAlert(level, message, context = {}) {
        const alert = {
            event: 'chaos.experiment.alert',
            timestamp: new Date().toISOString(),
            level: level,
            message: message,
            context: context,
            source: this.name
        };

        if (this.eventBus) {
            this.eventBus.emit('system.alert', alert);
        }

        this.logger[level](`Chaos Experiment Alert [${level}]: ${message}`, context);
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
            event: 'chaos.experiment.metrics',
            timestamp: new Date().toISOString(),
            scenarios: this.scenarios.size,
            activeExperiments: this.activeExperiments.size,
            scheduledExperiments: this.scheduledExperiments.size,
            experimentsTotal: this.metrics.experimentsTotal,
            experimentsSuccessful: this.metrics.experimentsSuccessful,
            experimentsFailed: this.metrics.experimentsFailed,
            experimentsAborted: this.metrics.experimentsAborted,
            averageDurationMin: this.metrics.averageDurationMin,
            impactMetrics: this.metrics.impactMetrics,
            guardState: this.guardState
        };

        if (this.eventBus) {
            this.eventBus.emit('system.metrics', metrics);
        }

        this.logger.info('Chaos experiment metrics emitted', metrics);
    }

    /**
     * Utility methods for chaos experiment execution
     */

    // Simulate stage execution (placeholder for real chaos tool integration)
    async simulateStageExecution(stage) {
        return new Promise(resolve => {
            setTimeout(resolve, Math.min(stage.durationSec * 1000, 10000)); // Max 10s for simulation
        });
    }

    // Monitor stage impact (placeholder for real monitoring integration)
    async monitorStageImpact(expKey, stage) {
        // Simulate monitoring by waiting and collecting metrics
        return new Promise(resolve => {
            setTimeout(resolve, 1000);
        });
    }

    // Calculate impact metrics (placeholder)
    async calculateImpactMetrics(expKey) {
        return {
            p95DeltaMs: Math.random() * 200,
            errorRateDelta: Math.random() * 0.5,
            costDeltaUSD: Math.random() * 5
        };
    }

    // Calculate stage impact (placeholder)
    async calculateStageImpact(expKey, stage) {
        return this.calculateImpactMetrics(expKey);
    }

    // Calculate total duration of experiment
    calculateTotalDuration(stages) {
        return stages.reduce((total, stage) => total + stage.durationSec, 0) / 60; // in minutes
    }

    // Calculate duration between timestamps
    calculateDuration(startTime, endTime) {
        return Math.round((new Date(endTime) - new Date(startTime)) / 60000); // in minutes
    }

    // Check if experiment should be aborted
    async shouldAbortExperiment(expKey) {
        const experiment = this.activeExperiments.get(expKey);
        if (!experiment || !experiment.safety) return false;

        // Check various abort conditions
        if (experiment.safety.abortOnSloBreach && this.guardState.sloStatus !== 'healthy') {
            return true;
        }

        if (experiment.safety.abortOnCostHard && this.guardState.costStatus === 'critical') {
            return true;
        }

        if (experiment.safety.freezeCheck && this.guardState.releaseFreeze === 'frozen') {
            return true;
        }

        return false;
    }

    // Abort experiment
    async abortExperiment(expKey, reason) {
        const experiment = this.activeExperiments.get(expKey);
        if (!experiment) return;

        experiment.state = this.states.ABORTED;
        experiment.endedAt = new Date().toISOString();
        experiment.abortReason = reason;

        await this.cleanupExperiment(expKey);
        this.metrics.experimentsAborted++;

        this.eventBus.emit('chaos.experiment.aborted', {
            event: 'chaos.experiment.aborted',
            timestamp: new Date().toISOString(),
            expKey: expKey,
            reason: reason
        });

        this.logger.warn(`Chaos experiment aborted: ${expKey} (${reason})`);
    }

    // Cleanup experiment resources
    async cleanupExperiment(expKey) {
        // Placeholder for chaos tool cleanup
        this.logger.info(`Cleaning up experiment: ${expKey}`);
    }

    // Apply experiment override
    async applyOverride(expKey, action, reason, by) {
        const experiment = this.activeExperiments.get(expKey);
        if (!experiment) return;

        switch (action) {
            case 'abort':
                await this.abortExperiment(expKey, `manual_abort_by_${by}: ${reason}`);
                break;
            case 'pause':
                experiment.pausedAt = new Date().toISOString();
                experiment.pauseReason = reason;
                break;
            case 'resume':
                if (experiment.pausedAt) {
                    delete experiment.pausedAt;
                    delete experiment.pauseReason;
                }
                break;
        }

        this.logger.info(`Applied override ${action} to experiment ${expKey} by ${by}: ${reason}`);
    }

    // Reduce parameters for ramp phases
    reduceParams(params, factor) {
        const reduced = {};
        for (const [key, value] of Object.entries(params)) {
            if (typeof value === 'number') {
                reduced[key] = Math.round(value * factor);
            } else {
                reduced[key] = value;
            }
        }
        return reduced;
    }

    // Select appropriate tools for experiment kind
    selectToolsForKind(kind) {
        const toolMap = {
            network: ['toxiproxy', 'tc-netem'],
            cpu: ['chaosmesh', 'stress-ng'],
            memory: ['chaosmesh'],
            disk: ['chaosmesh', 'dd'],
            pods: ['chaosmesh'],
            dns: ['toxiproxy']
        };

        return toolMap[kind] || ['chaosmesh'];
    }

    // Record experiment result for analytics
    recordExperimentResult(experiment) {
        this.experimentHistory.push({
            expKey: experiment.expKey,
            scenarioId: experiment.scenarioId,
            env: experiment.env,
            state: experiment.state,
            startedAt: experiment.startedAt,
            endedAt: experiment.endedAt,
            durationMin: this.calculateDuration(experiment.startedAt, experiment.endedAt)
        });

        // Keep only last 100 results
        if (this.experimentHistory.length > 100) {
            this.experimentHistory = this.experimentHistory.slice(-100);
        }

        this.guardState.lastExperimentTime = experiment.endedAt;
    }

    // Get failed check reasons
    getFailedCheckReasons(checks) {
        const failedChecks = Object.entries(checks)
            .filter(([_, passed]) => !passed)
            .map(([check, _]) => check);
        
        return failedChecks.join(', ');
    }

    // Schedule experiment for later execution
    async scheduleExperiment(experimentPlan) {
        const scheduledTime = new Date(experimentPlan.schedule.at);
        const now = new Date();
        const delay = scheduledTime.getTime() - now.getTime();

        if (delay > 0) {
            setTimeout(async () => {
                await this.executeExperiment(experimentPlan.expKey);
            }, delay);

            this.scheduledExperiments.set(experimentPlan.expKey, {
                scheduledFor: experimentPlan.schedule.at,
                scheduledAt: new Date().toISOString()
            });

            this.logger.info(`Experiment scheduled: ${experimentPlan.expKey} for ${scheduledTime.toISOString()}`);
        }
    }

    // Schedule maintenance tasks
    async scheduleMaintenanceTasks() {
        // Clean up old experiment history every hour
        setInterval(() => {
            this.cleanupOldExperiments();
        }, 3600000); // 1 hour

        this.logger.info('Maintenance tasks scheduled');
    }

    // Cleanup old experiments
    cleanupOldExperiments() {
        const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000);
        
        for (const [expKey, experiment] of this.activeExperiments) {
            if (experiment.endedAt) {
                const endTime = new Date(experiment.endedAt).getTime();
                if (endTime < oneDayAgo) {
                    this.activeExperiments.delete(expKey);
                }
            }
        }

        this.logger.debug('Old experiments cleaned up');
    }

    /**
     * Handle system state updates
     */
    handleFreezeTateUpdate(freezeData) {
        this.guardState.releaseFreeze = freezeData.state;
        this.logger.info(`Release freeze state updated: ${freezeData.state}`);
    }

    handleSloAlert(sloData) {
        this.guardState.sloStatus = 'unhealthy';
        this.logger.warn(`SLO alert triggered: ${sloData.serviceId} - ${sloData.slo}`);
    }

    handleSloRecovery(sloData) {
        this.guardState.sloStatus = 'healthy';
        this.logger.info(`SLO recovered: ${sloData.serviceId} - ${sloData.slo}`);
    }

    handleCostAlert(costData) {
        this.guardState.costStatus = costData.severity === 'high' ? 'critical' : 'warning';
        this.logger.warn(`Cost alert triggered: ${costData.component} - ${costData.severity}`);
    }

    handleCostRecovery(costData) {
        this.guardState.costStatus = 'normal';
        this.logger.info(`Cost alert recovered: ${costData.component}`);
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
            scenarios: this.scenarios.size,
            activeExperiments: this.activeExperiments.size,
            scheduledExperiments: this.scheduledExperiments.size,
            guardState: this.guardState,
            metrics: this.metrics,
            config: this.config
        };
    }

    /**
     * Shutdown the module
     */
    async shutdown() {
        try {
            this.logger.info(`${this.name} shutting down...`);

            // Abort all active experiments
            for (const [expKey, experiment] of this.activeExperiments) {
                if (experiment.state === this.states.INJECTING || 
                    experiment.state === this.states.OBSERVING) {
                    await this.abortExperiment(expKey, 'system_shutdown');
                }
            }

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

module.exports = ChaosExperimentDesigner;