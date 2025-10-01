/**
 * LIVIA-54: Traffic Shaper
 * Gerçek zamanlı trafik şekillendirme ve yük yönetimi
 * SLA-aware request admission, prioritization, and rate limiting
 * @version 1.0.0
 * @author LIVIA System
 */

const crypto = require('crypto');
const EventEmitter = require('events');

/**
 * @typedef {Object} TrafficShapeConfig
 * @property {Array} tiers - SLA tier configurations (gold, silver, bronze)
 * @property {Object} algorithms - Traffic shaping algorithms
 * @property {Object} targets - Performance and budget targets
 * @property {Object} fairness - Fair sharing configuration
 * @property {Object} controllers - PID and EWMA controller settings
 */

/**
 * @typedef {Object} SLATier
 * @property {string} name - Tier name (gold, silver, bronze)
 * @property {number} rpsMax - Maximum requests per second
 * @property {number} burst - Burst capacity
 * @property {number} concurrencyMax - Maximum concurrent requests
 * @property {number} queueMsMax - Maximum queue time
 * @property {number} deadlineMs - Request deadline
 * @property {number} wfqWeight - Weighted Fair Queuing weight
 * @property {string} dropPolicy - Drop policy when overloaded
 * @property {Object} degrade - Performance degradation settings
 */

/**
 * @typedef {Object} AdmissionDecision
 * @property {string} decision - admit, queue, shed
 * @property {number} queuePos - Position in queue (if queued)
 * @property {number} queueEtaMs - Estimated time in queue
 * @property {Object} appliedDegrade - Applied performance degradations
 * @property {string} rationale - Decision rationale
 */

class TrafficShaper extends EventEmitter {
    /**
     * Initialize Traffic Shaper
     * @param {TrafficShapeConfig} config - Shaper configuration
     */
    constructor(config = {}) {
        super();
        this.name = 'TrafficShaper';
        this.config = {
            tiers: [
                {
                    name: 'gold',
                    rpsMax: 120,
                    burst: 240,
                    concurrencyMax: 64,
                    queueMsMax: 250,
                    deadlineMs: 1200,
                    wfqWeight: 8,
                    dropPolicy: 'taildrop',
                    degrade: { 'kb.topKMax': 80, reranker: 'ce-small', maxTokens: 800 }
                },
                {
                    name: 'silver',
                    rpsMax: 80,
                    burst: 160,
                    concurrencyMax: 40,
                    queueMsMax: 350,
                    deadlineMs: 1400,
                    wfqWeight: 4,
                    dropPolicy: 'lifo-shed',
                    degrade: { 'kb.topKMax': 60, reranker: 'none', maxTokens: 600 }
                },
                {
                    name: 'bronze',
                    rpsMax: 40,
                    burst: 80,
                    concurrencyMax: 16,
                    queueMsMax: 400,
                    deadlineMs: 1600,
                    wfqWeight: 1,
                    dropPolicy: 'headroom-shed',
                    degrade: { 'kb.topKMax': 40, reranker: 'none', maxTokens: 400 }
                }
            ],
            algorithms: {
                rate: 'token_bucket',
                queue: 'wfq', // Weighted Fair Queuing
                scheduler: 'edf', // Earliest Deadline First / cbwfq
                controller: 'pid+ewma'
            },
            targets: {
                latencyP95Ms: 250,
                errorRatePctMax: 1.0,
                budgetUsdPerHour: 60
            },
            priorityOrder: ['incident', 'runbook', 'user:paying', 'user:trial', 'batch'],
            fairness: {
                tenantMinSharePct: 5,
                maxSharePctPerTenant: 60,
                agingSec: 45
            },
            controllers: {
                pid: {
                    kp: 0.6,  // Proportional gain
                    ki: 0.12, // Integral gain
                    kd: 0.04, // Derivative gain
                    targetP95Ms: 250,
                    updateIntervalMs: 5000
                },
                ewma: {
                    alpha: 0.3, // Smoothing factor
                    windowSec: 60
                }
            },
            ...config
        };

        this.isInitialized = false;
        this.logger = null;
        this.eventBus = null;

        // Traffic state management
        this.requestQueues = new Map(); // tier -> request queue
        this.tierStates = new Map(); // tier -> current state (rps, concurrency, etc.)
        this.tenantStats = new Map(); // tenant -> usage statistics
        this.pathConfigs = new Map(); // path -> specific configurations

        // Token bucket rate limiting
        this.tokenBuckets = new Map(); // tier+path -> bucket state
        
        // Active requests tracking
        this.activeRequests = new Map(); // requestId -> request context
        this.concurrencyCounters = new Map(); // tier+path -> current concurrency

        // PID Controller state
        this.pidControllers = new Map(); // path -> PID controller state
        this.ewmaFilters = new Map(); // path -> EWMA filter state

        // Performance tracking
        this.telemetryWindow = {
            start: Date.now(),
            requests: [],
            metrics: {
                latencyP95Ms: 0,
                latencyP50Ms: 0,
                errorPct: 0,
                queueDepth: 0,
                activeConcurrency: 0,
                rps: 0
            }
        };

        // System state
        this.systemState = {
            sloStatus: 'healthy',
            costStatus: 'normal',
            freezeStatus: 'thawed',
            mfrStatus: 'normal'
        };

        // Metrics
        this.metrics = {
            admitted: 0,
            queued: 0,
            shed: 0,
            avgQueueMs: 0,
            p95BeforeMs: 0,
            p95AfterMs: 0,
            errPctBefore: 0,
            errPctAfter: 0,
            budgetUsdPerHourBefore: 0,
            budgetUsdPerHourAfter: 0
        };

        this.metricsInterval = null;
        this.controllerInterval = null;
    }

    /**
     * Initialize the Traffic Shaper
     * @param {Object} logger - Logger instance
     * @param {Object} eventBus - Event bus for communication
     * @returns {Promise<boolean>} Success status
     */
    async initialize(logger, eventBus) {
        try {
            this.logger = logger;
            this.eventBus = eventBus;
            this.logger.info(`${this.name} initializing...`);

            await this.initializeTierStates();
            await this.initializeTokenBuckets();
            await this.initializePIDControllers();
            await this.setupEventHandlers();
            await this.startControllerLoop();
            await this.startMetricsReporting();

            this.isInitialized = true;
            this.logger.info(`${this.name} initialized successfully`);
            return true;
        } catch (error) {
            this.logger.error(`${this.name} initialization failed:`, error);
            return false;
        }
    }

    /**
     * Initialize tier states
     * @private
     */
    async initializeTierStates() {
        for (const tier of this.config.tiers) {
            this.tierStates.set(tier.name, {
                currentRps: 0,
                currentConcurrency: 0,
                queueDepth: 0,
                droppedCount: 0,
                lastUpdate: Date.now()
            });

            this.requestQueues.set(tier.name, []);
        }

        this.logger.info(`Initialized ${this.config.tiers.length} tier states`);
    }

    /**
     * Initialize token buckets for rate limiting
     * @private
     */
    async initializeTokenBuckets() {
        for (const tier of this.config.tiers) {
            const bucketKey = `${tier.name}:default`;
            this.tokenBuckets.set(bucketKey, {
                tokens: tier.burst, // Start with full burst capacity
                maxTokens: tier.burst,
                refillRate: tier.rpsMax, // tokens per second
                lastRefill: Date.now()
            });
        }

        this.logger.info(`Initialized ${this.tokenBuckets.size} token buckets`);
    }

    /**
     * Initialize PID controllers for each path
     * @private
     */
    async initializePIDControllers() {
        const defaultPaths = ['/search', '/answer', '/ingest'];
        
        for (const path of defaultPaths) {
            this.pidControllers.set(path, {
                target: this.config.controllers.pid.targetP95Ms,
                kp: this.config.controllers.pid.kp,
                ki: this.config.controllers.pid.ki,
                kd: this.config.controllers.pid.kd,
                integral: 0,
                lastError: 0,
                lastUpdate: Date.now(),
                output: 1.0 // Multiplier for rate limits
            });

            this.ewmaFilters.set(path, {
                alpha: this.config.controllers.ewma.alpha,
                value: this.config.targets.latencyP95Ms,
                initialized: false
            });
        }

        this.logger.info(`Initialized PID controllers for ${defaultPaths.length} paths`);
    }

    /**
     * Setup event handlers
     * @private
     */
    async setupEventHandlers() {
        if (!this.eventBus) return;

        // Traffic policy updates
        this.eventBus.on('shape.policy.updated', this.handlePolicyUpdate.bind(this));
        this.eventBus.on('shape.target.updated', this.handleTargetUpdate.bind(this));

        // Request admission
        this.eventBus.on('request.arrived', this.handleRequestArrival.bind(this));

        // Telemetry data
        this.eventBus.on('shape.signal.telemetry', this.handleTelemetryUpdate.bind(this));

        // System state updates
        this.eventBus.on('slo.guard.triggered', this.handleSloAlert.bind(this));
        this.eventBus.on('slo.guard.recovered', this.handleSloRecovery.bind(this));
        this.eventBus.on('cost.guard.triggered', this.handleCostAlert.bind(this));
        this.eventBus.on('cost.guard.recovered', this.handleCostRecovery.bind(this));
        this.eventBus.on('freeze.state.changed', this.handleFreezeStateChange.bind(this));
        this.eventBus.on('mrf.state.update', this.handleMRFStateUpdate.bind(this));

        this.logger.info('Traffic shaper event handlers registered');
    }

    /**
     * Handle incoming request for admission decision
     * @param {Object} requestData - Request data
     * @private
     */
    async handleRequestArrival(requestData) {
        try {
            const { id, svc, path, slaTier, tenant, subject, variant, importance, hints } = requestData;
            const arrivalTime = Date.now();

            // Determine SLA tier if not specified
            const tier = slaTier || this.determineTier(subject, importance);
            const tierConfig = this.config.tiers.find(t => t.name === tier);
            
            if (!tierConfig) {
                this.logger.error(`Unknown SLA tier: ${tier}`);
                return;
            }

            // Check rate limiting (token bucket)
            const rateLimitCheck = this.checkRateLimit(tier, path);
            if (!rateLimitCheck.allowed) {
                const decision = this.makeSheddingDecision(requestData, tierConfig, 'rate_limit');
                this.emitAdmissionDecision(requestData, decision);
                return;
            }

            // Check concurrency limits
            const concurrencyCheck = this.checkConcurrencyLimit(tier, path, tierConfig);
            if (!concurrencyCheck.allowed) {
                // Try to queue the request
                const queueDecision = this.attemptQueueing(requestData, tierConfig);
                this.emitAdmissionDecision(requestData, queueDecision);
                return;
            }

            // Check system-wide constraints
            const systemCheck = this.checkSystemConstraints(requestData, tierConfig);
            if (!systemCheck.allowed) {
                const decision = this.makeSheddingDecision(requestData, tierConfig, systemCheck.reason);
                this.emitAdmissionDecision(requestData, decision);
                return;
            }

            // Check fairness constraints
            const fairnessCheck = this.checkFairnessConstraints(tenant, tier);
            if (!fairnessCheck.allowed) {
                const queueDecision = this.attemptQueueing(requestData, tierConfig, 'fairness');
                this.emitAdmissionDecision(requestData, queueDecision);
                return;
            }

            // Determine if degradation is needed
            const degradation = this.determineDegradation(tierConfig, path);

            // Admit the request
            const admissionDecision = {
                decision: 'admit',
                queuePos: 0,
                queueEtaMs: 0,
                appliedDegrade: degradation,
                rationale: this.buildAdmissionRationale(tierConfig, 'normal_flow')
            };

            // Track the request
            this.trackAdmittedRequest(requestData, admissionDecision, arrivalTime);
            
            this.emitAdmissionDecision(requestData, admissionDecision);
            this.metrics.admitted++;

        } catch (error) {
            this.logger.error('Request arrival handling failed:', error);
        }
    }

    /**
     * Check rate limiting using token bucket algorithm
     * @param {string} tier - SLA tier
     * @param {string} path - Request path
     * @returns {Object} Rate limit check result
     * @private
     */
    checkRateLimit(tier, path) {
        const bucketKey = `${tier}:${path || 'default'}`;
        let bucket = this.tokenBuckets.get(bucketKey);
        
        if (!bucket) {
            // Create bucket for new path
            const tierConfig = this.config.tiers.find(t => t.name === tier);
            bucket = {
                tokens: tierConfig.burst,
                maxTokens: tierConfig.burst,
                refillRate: tierConfig.rpsMax,
                lastRefill: Date.now()
            };
            this.tokenBuckets.set(bucketKey, bucket);
        }

        // Refill tokens based on elapsed time
        const now = Date.now();
        const elapsed = (now - bucket.lastRefill) / 1000; // seconds
        const tokensToAdd = elapsed * bucket.refillRate;
        
        bucket.tokens = Math.min(bucket.maxTokens, bucket.tokens + tokensToAdd);
        bucket.lastRefill = now;

        // Check if token available
        if (bucket.tokens >= 1) {
            bucket.tokens -= 1;
            return { allowed: true, tokens: bucket.tokens };
        } else {
            return { allowed: false, tokens: bucket.tokens, waitMs: (1 / bucket.refillRate) * 1000 };
        }
    }

    /**
     * Check concurrency limits
     * @param {string} tier - SLA tier
     * @param {string} path - Request path
     * @param {Object} tierConfig - Tier configuration
     * @returns {Object} Concurrency check result
     * @private
     */
    checkConcurrencyLimit(tier, path, tierConfig) {
        const key = `${tier}:${path || 'default'}`;
        const currentConcurrency = this.concurrencyCounters.get(key) || 0;
        
        if (currentConcurrency >= tierConfig.concurrencyMax) {
            return { 
                allowed: false, 
                current: currentConcurrency, 
                max: tierConfig.concurrencyMax 
            };
        }

        return { allowed: true, current: currentConcurrency };
    }

    /**
     * Check system-wide constraints
     * @param {Object} requestData - Request data
     * @param {Object} tierConfig - Tier configuration
     * @returns {Object} System constraint check result
     * @private
     */
    checkSystemConstraints(requestData, tierConfig) {
        // Check if system is in freeze state
        if (this.systemState.freezeStatus === 'frozen') {
            return { allowed: false, reason: 'freeze_active' };
        }

        // Check if cost guard is active
        if (this.systemState.costStatus === 'critical') {
            return { allowed: false, reason: 'budget_guard' };
        }

        // Check SLO health for lower tier requests
        if (this.systemState.sloStatus === 'unhealthy' && tierConfig.name === 'bronze') {
            return { allowed: false, reason: 'slo_degraded' };
        }

        // Check MRF status
        if (this.systemState.mfrStatus === 'executing' && tierConfig.name !== 'gold') {
            return { allowed: false, reason: 'mrf_derate' };
        }

        return { allowed: true };
    }

    /**
     * Check fairness constraints
     * @param {string} tenant - Tenant identifier
     * @param {string} tier - SLA tier
     * @returns {Object} Fairness check result
     * @private
     */
    checkFairnessConstraints(tenant, tier) {
        if (!tenant) return { allowed: true };

        const tenantStats = this.tenantStats.get(tenant) || { 
            requestCount: 0, 
            lastReset: Date.now() 
        };

        // Calculate tenant's current share
        const totalRequests = Array.from(this.tenantStats.values())
            .reduce((sum, stats) => sum + stats.requestCount, 0);

        if (totalRequests === 0) return { allowed: true };

        const tenantShare = (tenantStats.requestCount / totalRequests) * 100;
        
        // Check maximum share constraint
        if (tenantShare > this.config.fairness.maxSharePctPerTenant) {
            return { 
                allowed: false, 
                reason: 'max_share_exceeded',
                currentShare: tenantShare 
            };
        }

        return { allowed: true, currentShare: tenantShare };
    }

    /**
     * Attempt to queue the request
     * @param {Object} requestData - Request data
     * @param {Object} tierConfig - Tier configuration
     * @param {string} reason - Queuing reason
     * @returns {AdmissionDecision} Queuing decision
     * @private
     */
    attemptQueueing(requestData, tierConfig, reason = 'concurrency_limit') {
        const queue = this.requestQueues.get(tierConfig.name);
        const queueDepth = queue.length;

        // Calculate estimated queue time
        const avgProcessingTime = this.calculateAvgProcessingTime(tierConfig.name);
        const queueEtaMs = queueDepth * avgProcessingTime;

        // Check if queue time exceeds maximum
        if (queueEtaMs > tierConfig.queueMsMax) {
            return this.makeSheddingDecision(requestData, tierConfig, 'queue_overflow');
        }

        // Add to queue with deadline
        const queueEntry = {
            ...requestData,
            queuedAt: Date.now(),
            deadline: Date.now() + tierConfig.deadlineMs,
            tier: tierConfig.name
        };

        queue.push(queueEntry);
        this.sortQueueByPriority(queue);

        this.metrics.queued++;

        return {
            decision: 'queue',
            queuePos: queue.findIndex(entry => entry.id === requestData.id) + 1,
            queueEtaMs: queueEtaMs,
            appliedDegrade: {},
            rationale: this.buildAdmissionRationale(tierConfig, reason)
        };
    }

    /**
     * Make shedding decision for rejected requests
     * @param {Object} requestData - Request data
     * @param {Object} tierConfig - Tier configuration
     * @param {string} reason - Shedding reason
     * @returns {AdmissionDecision} Shedding decision
     * @private
     */
    makeSheddingDecision(requestData, tierConfig, reason) {
        this.metrics.shed++;
        
        // Update tier state
        const tierState = this.tierStates.get(tierConfig.name);
        tierState.droppedCount++;

        // Calculate retry-after time based on tier and reason
        let retryAfterMs = 600; // Default 600ms
        
        switch (reason) {
            case 'rate_limit':
                retryAfterMs = 1000 / tierConfig.rpsMax; // Time for next token
                break;
            case 'queue_overflow':
                retryAfterMs = tierConfig.queueMsMax;
                break;
            case 'budget_guard':
                retryAfterMs = 5000; // 5 seconds for budget issues
                break;
        }

        // Emit shedding event
        this.eventBus.emit('shape.shed.event', {
            event: 'shape.shed.event',
            timestamp: new Date().toISOString(),
            id: requestData.id,
            tier: tierConfig.name,
            reason: reason,
            policy: 'graceful',
            retryAfterMs: retryAfterMs,
            advice: this.generateSheddingAdvice(tierConfig, reason)
        });

        return {
            decision: 'shed',
            queuePos: -1,
            queueEtaMs: -1,
            appliedDegrade: {},
            rationale: this.buildAdmissionRationale(tierConfig, reason)
        };
    }

    /**
     * Determine appropriate degradation for request
     * @param {Object} tierConfig - Tier configuration
     * @param {string} path - Request path
     * @returns {Object} Degradation configuration
     * @private
     */
    determineDegradation(tierConfig, path) {
        const baseDegradation = { ...tierConfig.degrade };
        
        // Apply additional degradation based on system state
        if (this.systemState.sloStatus === 'unhealthy') {
            // More aggressive degradation when SLO is unhealthy
            if (baseDegradation['kb.topKMax']) {
                baseDegradation['kb.topKMax'] = Math.max(20, baseDegradation['kb.topKMax'] - 20);
            }
            if (baseDegradation.maxTokens) {
                baseDegradation.maxTokens = Math.max(200, baseDegradation.maxTokens - 200);
            }
        }

        if (this.systemState.costStatus === 'warning') {
            // Cost-oriented degradation
            baseDegradation.reranker = 'none';
            if (baseDegradation['kb.topKMax']) {
                baseDegradation['kb.topKMax'] = Math.max(30, baseDegradation['kb.topKMax'] - 10);
            }
        }

        return baseDegradation;
    }

    /**
     * Track admitted request for concurrency and metrics
     * @param {Object} requestData - Request data
     * @param {AdmissionDecision} decision - Admission decision
     * @param {number} arrivalTime - Request arrival timestamp
     * @private
     */
    trackAdmittedRequest(requestData, decision, arrivalTime) {
        const { id, svc, path, slaTier, tenant } = requestData;
        const key = `${slaTier}:${path || 'default'}`;
        
        // Update concurrency counter
        const currentConcurrency = this.concurrencyCounters.get(key) || 0;
        this.concurrencyCounters.set(key, currentConcurrency + 1);

        // Track active request
        this.activeRequests.set(id, {
            ...requestData,
            admittedAt: arrivalTime,
            decision: decision,
            concurrencyKey: key
        });

        // Update tenant statistics
        if (tenant) {
            const tenantStats = this.tenantStats.get(tenant) || { 
                requestCount: 0, 
                lastReset: Date.now() 
            };
            tenantStats.requestCount++;
            this.tenantStats.set(tenant, tenantStats);
        }
    }

    /**
     * Handle telemetry updates for controller feedback
     * @param {Object} telemetryData - Telemetry data
     * @private
     */
    async handleTelemetryUpdate(telemetryData) {
        try {
            const { window, svc, path, latencyP95Ms, latencyP50Ms, errPct, queueDepth, activeConcurrency, rps } = telemetryData;

            // Update telemetry window
            this.telemetryWindow.metrics = {
                latencyP95Ms,
                latencyP50Ms,
                errPct,
                queueDepth,
                activeConcurrency,
                rps
            };

            // Update EWMA filter
            const ewmaFilter = this.ewmaFilters.get(path);
            if (ewmaFilter) {
                if (ewmaFilter.initialized) {
                    ewmaFilter.value = ewmaFilter.alpha * latencyP95Ms + (1 - ewmaFilter.alpha) * ewmaFilter.value;
                } else {
                    ewmaFilter.value = latencyP95Ms;
                    ewmaFilter.initialized = true;
                }
            }

            // Trigger controller update if needed
            this.updatePIDController(path, latencyP95Ms);

        } catch (error) {
            this.logger.error('Telemetry update handling failed:', error);
        }
    }

    /**
     * Update PID controller for path
     * @param {string} path - Request path
     * @param {number} currentLatency - Current P95 latency
     * @private
     */
    updatePIDController(path, currentLatency) {
        const controller = this.pidControllers.get(path);
        if (!controller) return;

        const now = Date.now();
        const dt = (now - controller.lastUpdate) / 1000; // seconds
        
        if (dt < 1) return; // Update at most once per second

        // Calculate error
        const error = currentLatency - controller.target;
        
        // Proportional term
        const proportional = controller.kp * error;
        
        // Integral term
        controller.integral += error * dt;
        const integral = controller.ki * controller.integral;
        
        // Derivative term
        const derivative = controller.kd * (error - controller.lastError) / dt;
        
        // PID output
        const pidOutput = proportional + integral + derivative;
        
        // Convert to rate multiplier (inverse relationship)
        // High latency -> reduce rate multiplier
        // Low latency -> increase rate multiplier
        const newOutput = Math.max(0.1, Math.min(2.0, 1.0 - (pidOutput / 1000)));
        
        controller.output = newOutput;
        controller.lastError = error;
        controller.lastUpdate = now;

        // Apply new rates to token buckets
        this.applyControllerOutput(path, newOutput);

        this.logger.debug(`PID controller update for ${path}: error=${error.toFixed(2)}, output=${newOutput.toFixed(3)}`);
    }

    /**
     * Apply controller output to adjust rates
     * @param {string} path - Request path
     * @param {number} multiplier - Rate multiplier
     * @private
     */
    applyControllerOutput(path, multiplier) {
        for (const tier of this.config.tiers) {
            const bucketKey = `${tier.name}:${path}`;
            const bucket = this.tokenBuckets.get(bucketKey);
            
            if (bucket) {
                // Adjust refill rate based on controller output
                bucket.refillRate = tier.rpsMax * multiplier;
                bucket.maxTokens = tier.burst * multiplier;
                
                // Ensure tokens don't exceed new max
                bucket.tokens = Math.min(bucket.tokens, bucket.maxTokens);
            }
        }

        // Emit rate update event
        this.eventBus.emit('shape.rate.updated', {
            event: 'shape.rate.updated',
            timestamp: new Date().toISOString(),
            svc: 'kb_api', // TODO: make dynamic
            path: path,
            rpsTarget: Math.round(this.config.tiers[0].rpsMax * multiplier),
            burst: Math.round(this.config.tiers[0].burst * multiplier),
            concurrencyLimit: this.config.tiers[0].concurrencyMax,
            controller: {
                p95TargetMs: this.config.controllers.pid.targetP95Ms,
                p95ObservedMs: this.telemetryWindow.metrics.latencyP95Ms,
                pid: {
                    p: this.config.controllers.pid.kp,
                    i: this.config.controllers.pid.ki,
                    d: this.config.controllers.pid.kd
                }
            }
        });
    }

    /**
     * Process queued requests
     * @private
     */
    async processQueues() {
        for (const [tierName, queue] of this.requestQueues) {
            if (queue.length === 0) continue;

            const tierConfig = this.config.tiers.find(t => t.name === tierName);
            if (!tierConfig) continue;

            // Check if we can process more requests from this tier
            const concurrencyKey = `${tierName}:default`;
            const currentConcurrency = this.concurrencyCounters.get(concurrencyKey) || 0;
            
            if (currentConcurrency >= tierConfig.concurrencyMax) {
                continue;
            }

            // Process requests in priority order
            while (queue.length > 0 && currentConcurrency < tierConfig.concurrencyMax) {
                const request = queue.shift();
                
                // Check if request has expired
                if (Date.now() > request.deadline) {
                    this.emitAdmissionDecision(request, this.makeSheddingDecision(request, tierConfig, 'deadline_violation'));
                    continue;
                }

                // Admit the request
                const degradation = this.determineDegradation(tierConfig, request.path);
                const admissionDecision = {
                    decision: 'admit',
                    queuePos: 0,
                    queueEtaMs: 0,
                    appliedDegrade: degradation,
                    rationale: this.buildAdmissionRationale(tierConfig, 'queue_processed')
                };

                this.trackAdmittedRequest(request, admissionDecision, request.queuedAt);
                this.emitAdmissionDecision(request, admissionDecision);
                this.metrics.admitted++;
            }
        }
    }

    /**
     * Emit admission decision
     * @param {Object} requestData - Request data
     * @param {AdmissionDecision} decision - Admission decision
     * @private
     */
    emitAdmissionDecision(requestData, decision) {
        this.eventBus.emit('shape.admission.decision', {
            event: 'shape.admission.decision',
            timestamp: new Date().toISOString(),
            id: requestData.id,
            svc: requestData.svc,
            tier: requestData.slaTier,
            tenant: requestData.tenant,
            ...decision
        });
    }

    /**
     * Utility methods
     */

    // Determine SLA tier based on user and importance
    determineTier(subject, importance) {
        if (importance === 'incident' || importance === 'runbook') {
            return 'gold';
        }
        
        if (subject && subject.includes('paying')) {
            return 'gold';
        }
        
        if (subject && subject.includes('trial')) {
            return 'silver';
        }
        
        if (importance === 'batch') {
            return 'bronze';
        }
        
        return 'silver'; // Default tier
    }

    // Calculate average processing time for tier
    calculateAvgProcessingTime(tier) {
        // Simplified calculation - in real implementation, use historical data
        const tierConfig = this.config.tiers.find(t => t.name === tier);
        return tierConfig ? tierConfig.deadlineMs / 3 : 400; // Assume 1/3 of deadline
    }

    // Sort queue by priority (WFQ + aging)
    sortQueueByPriority(queue) {
        const now = Date.now();
        
        queue.sort((a, b) => {
            const tierA = this.config.tiers.find(t => t.name === a.tier);
            const tierB = this.config.tiers.find(t => t.name === b.tier);
            
            // Apply aging factor
            const ageA = (now - a.queuedAt) / 1000; // seconds
            const ageB = (now - b.queuedAt) / 1000;
            
            const priorityA = tierA.wfqWeight + (ageA / this.config.fairness.agingSec);
            const priorityB = tierB.wfqWeight + (ageB / this.config.fairness.agingSec);
            
            return priorityB - priorityA; // Higher priority first
        });
    }

    // Build admission rationale text
    buildAdmissionRationale(tierConfig, reason) {
        const rationales = {
            normal_flow: `${tierConfig.name} tier normal admission`,
            concurrency_limit: `${tierConfig.name} concurrency limit reached, queued`,
            rate_limit: `${tierConfig.name} rate limit exceeded`,
            fairness: `tenant fairness constraint applied`,
            queue_overflow: `queue capacity exceeded for ${tierConfig.name}`,
            deadline_violation: `request deadline exceeded`,
            freeze_active: `system freeze active`,
            budget_guard: `cost budget guard triggered`,
            slo_degraded: `SLO degradation protection`,
            mrf_derate: `MRF derate mode active`,
            queue_processed: `processed from ${tierConfig.name} queue`
        };
        
        return rationales[reason] || `${reason} for ${tierConfig.name} tier`;
    }

    // Generate shedding advice
    generateSheddingAdvice(tierConfig, reason) {
        const advice = {
            use: tierConfig.name === 'bronze' ? 'background' : 'interactive',
            degrade: {}
        };
        
        if (reason === 'budget_guard') {
            advice.degrade['kb.topK'] = '≤30';
            advice.degrade.reranker = 'none';
        }
        
        if (reason === 'queue_overflow') {
            advice.degrade.maxTokens = '≤400';
        }
        
        return advice;
    }

    /**
     * System state handlers
     */
    handleSloAlert(sloData) {
        this.systemState.sloStatus = 'unhealthy';
        this.logger.warn(`SLO alert received: ${sloData.serviceId} - ${sloData.slo}`);
    }

    handleSloRecovery(sloData) {
        this.systemState.sloStatus = 'healthy';
        this.logger.info(`SLO recovered: ${sloData.serviceId} - ${sloData.slo}`);
    }

    handleCostAlert(costData) {
        this.systemState.costStatus = costData.severity;
        this.logger.warn(`Cost alert: ${costData.component} - ${costData.severity}`);
    }

    handleCostRecovery(costData) {
        this.systemState.costStatus = 'normal';
        this.logger.info(`Cost alert recovered: ${costData.component}`);
    }

    handleFreezeStateChange(freezeData) {
        this.systemState.freezeStatus = freezeData.state;
        this.logger.info(`Freeze state changed: ${freezeData.state}`);
    }

    handleMRFStateUpdate(mrfData) {
        this.systemState.mfrStatus = mrfData.phase;
        this.logger.info(`MRF state updated: ${mrfData.phase}`);
    }

    handlePolicyUpdate(policyData) {
        // Update tier configurations
        this.config.tiers = policyData.tiers;
        this.logger.info(`Traffic policy updated: ${policyData.policyId}`);
    }

    handleTargetUpdate(targetData) {
        // Update performance targets
        this.config.targets = { ...this.config.targets, ...targetData.targets };
        this.logger.info(`Traffic targets updated for ${targetData.serviceId}`);
    }

    /**
     * Start controller loop for queue processing and maintenance
     * @private
     */
    async startControllerLoop() {
        this.controllerInterval = setInterval(() => {
            this.processQueues();
            this.updateTelemetryWindow();
            this.performMaintenance();
        }, 1000); // Run every second
    }

    /**
     * Update telemetry window
     * @private
     */
    updateTelemetryWindow() {
        const now = Date.now();
        const windowMs = 60000; // 1 minute window
        
        // Clean old telemetry data
        this.telemetryWindow.requests = this.telemetryWindow.requests.filter(
            req => now - req.timestamp < windowMs
        );
        
        // Update queue snapshot
        const queueSnapshot = {
            event: 'shape.queue.snapshot',
            timestamp: new Date().toISOString(),
            tiers: {},
            tenants: [],
            drops: {}
        };

        for (const [tierName, queue] of this.requestQueues) {
            queueSnapshot.tiers[tierName] = queue.length;
            
            const tierState = this.tierStates.get(tierName);
            queueSnapshot.drops[tierName] = tierState.droppedCount;
        }

        // Tenant statistics
        const sortedTenants = Array.from(this.tenantStats.entries())
            .sort((a, b) => b[1].requestCount - a[1].requestCount)
            .slice(0, 10) // Top 10 tenants
            .map(([tenant, stats]) => [tenant, stats.requestCount]);
        
        queueSnapshot.tenants = sortedTenants;

        this.eventBus.emit('shape.queue.snapshot', queueSnapshot);
    }

    /**
     * Perform maintenance tasks
     * @private
     */
    performMaintenance() {
        // Reset tenant statistics periodically
        const now = Date.now();
        const resetInterval = 3600000; // 1 hour
        
        for (const [tenant, stats] of this.tenantStats) {
            if (now - stats.lastReset > resetInterval) {
                stats.requestCount = 0;
                stats.lastReset = now;
            }
        }

        // Clean completed requests
        for (const [requestId, requestContext] of this.activeRequests) {
            // In real implementation, you'd check if request is actually completed
            // For now, assume requests complete after 30 seconds
            if (now - requestContext.admittedAt > 30000) {
                // Decrement concurrency counter
                const key = requestContext.concurrencyKey;
                const currentCount = this.concurrencyCounters.get(key) || 0;
                this.concurrencyCounters.set(key, Math.max(0, currentCount - 1));
                
                this.activeRequests.delete(requestId);
            }
        }
    }

    /**
     * Start metrics reporting
     * @private
     */
    async startMetricsReporting() {
        this.metricsInterval = setInterval(() => {
            this.emitMetrics();
        }, 30000); // Every 30 seconds
    }

    /**
     * Emit performance metrics
     * @private
     */
    emitMetrics() {
        const metrics = {
            event: 'shape.metrics',
            timestamp: new Date().toISOString(),
            admitted: this.metrics.admitted,
            queued: this.metrics.queued,
            shed: this.metrics.shed,
            avgQueueMs: this.metrics.avgQueueMs,
            p95BeforeMs: this.metrics.p95BeforeMs,
            p95AfterMs: this.telemetryWindow.metrics.latencyP95Ms,
            errPctBefore: this.metrics.errPctBefore,
            errPctAfter: this.telemetryWindow.metrics.errPct,
            budgetUsdPerHourBefore: this.metrics.budgetUsdPerHourBefore,
            budgetUsdPerHourAfter: this.metrics.budgetUsdPerHourAfter
        };

        if (this.eventBus) {
            this.eventBus.emit('system.metrics', metrics);
        }

        this.logger.info('Traffic shaper metrics emitted', metrics);
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
            activeRequests: this.activeRequests.size,
            queueDepths: Object.fromEntries(
                Array.from(this.requestQueues.entries()).map(([tier, queue]) => [tier, queue.length])
            ),
            systemState: this.systemState,
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

            // Clear intervals
            if (this.metricsInterval) {
                clearInterval(this.metricsInterval);
            }
            if (this.controllerInterval) {
                clearInterval(this.controllerInterval);
            }

            this.isInitialized = false;
            this.logger.info(`${this.name} shutdown completed`);
        } catch (error) {
            this.logger.error(`${this.name} shutdown error:`, error);
        }
    }
}

module.exports = TrafficShaper;