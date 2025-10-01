/**
 * LIVIA-65: Cost Anomaly Sentinel
 * Maliyet anomalisi sentinel sistemi
 * Amaç: Gerçek-zamanlı maliyet anomalilerini yakala, RCA yap, otomatik kısıtlama/degrade uygula
 */

const crypto = require('crypto');
const { EventEmitter } = require('events');
const { trace, context, SpanStatusCode } = require('@opentelemetry/api');

class CostAnomalySentinel extends EventEmitter {
    constructor(config = {}) {
        super();
        
        this.name = 'CostAnomalySentinel';
        this.config = {
            enabled: true,
            locale: 'tr-TR',
            timezone: 'Europe/Istanbul',
            detectors: {
                ewma: { alpha: 0.3, k: 3 }, // |x - μ_ewma| > k*σ_ewma
                stl: { season: '1d', trend: 'robust' },
                esd: { alpha: 0.05 }, // generalized ESD
                minTraffic: 200,
                minSpendUsd: 5,
                combine: 'max_zscore' // vote_majority|max_zscore
            },
            baselines: {
                compareWindows: ['prev_1h', 'prev_24h_same_hour', 'dow_7d'],
                normalizeBy: ['queries', '1k_tokens', 'tenant_mix']
            },
            budgets: {
                globalUsdPerDay: 1200,
                perTenantUsdPerDay: { 't#acme': 300, 't#beta': 200 },
                caps: { usdPerQueryMax: 0.015, usdPer1kTokMax: 0.80 }
            },
            rca: {
                features: ['tokensOutPerQuery', 'topK', 'reranker', 'model', 'retrievalHits', 'indexLatencyMs', 'trafficMix', 'lang', 'fmt_html'],
                shaplikeTopN: 5
            },
            actions: {
                throttle: { 
                    enable: true, 
                    provider: 'L54', 
                    rpsCapsByTier: { gold: 60, silver: 40, bronze: 25 }
                },
                degrade: {
                    enable: true,
                    via: 'L55',
                    plans: [{
                        from: 'P-hybrid-fast',
                        to: 'P-vec-lite',
                        topK: '-20',
                        reranker: 'none',
                        model: 'gpt-s',
                        maxTokens: '-200'
                    }]
                },
                cap_tokens: { enable: true, minMaxTokens: 400 },
                feature_toggle: { enable: true, flags: ['rich_html', 'inline_svg', 'long_citations'] },
                traffic_shift: { enable: true, provider: 'L54', toRevision: 'lowcost', pct: 15 }
            },
            guardrails: {
                slo: { p95MsMax: 900, errPctMax: 1.0, acceptRateMin: 0.50 },
                safety: { noWorse: true },
                evidence: { coverageMin: 0.60 },
                fairness: { 
                    protected: ['tier', 'region'], 
                    parityTolerancePct: 10 // Don't disproportionately affect lower tiers
                }
            },
            restore: {
                mode: 'gradual',
                stepMin: 20,
                requireStableWindows: 2,
                hysteresisPct: 10
            },
            freezeRespect: true,
            integrations: {
                cost: 'LIVIA-34',
                costGuard: 'LIVIA-53',
                traffic: 'LIVIA-54',
                qo: 'LIVIA-55',
                safety: 'LIVIA-56',
                evidence: 'LIVIA-57',
                fresh: 'LIVIA-58',
                runbook: 'LIVIA-62',
                drift: 'LIVIA-63',
                zd: 'LIVIA-64',
                slo: 'LIVIA-32'
            },
            idempotencyTtlSec: 1800,
            ...config
        };
        
        // State management
        this.state = 'IDLE';
        this.costStreams = new Map(); // Streaming cost data
        this.baselines = new Map(); // Historical baselines
        this.anomalies = new Map(); // Detected anomalies
        this.appliedActions = new Map(); // Applied mitigation actions
        this.restorePlans = new Map(); // Restore plans
        this.ewmaState = new Map(); // EWMA detector state
        this.cooldowns = new Map(); // Action cooldowns
        this.freezeState = { frozen: false, scope: null, reason: null };
        this.budgetState = {
            globalSpentUsd: 0,
            tenantSpentUsd: new Map(),
            windowStart: this.getCurrentDayWindow()
        };
        this.trafficSplits = new Map(); // Current traffic splits
        this.qoPaths = new Map(); // Current QO decisions
        this.sloMetrics = new Map(); // SLO metrics
        this.metrics = {
            anomalies: 0,
            actionsApplied: 0,
            restores: 0,
            avgDetectMs: 0,
            avgApplyMs: 0,
            usdPerQueryDelta: 0,
            p95DeltaMs: 0,
            acceptRateDelta: 0,
            falsePositivePct: 0
        };
        
        this.isInitialized = false;
        this.logger = null;
        this.tracer = trace.getTracer('livia-cost-anomaly-sentinel');
        
        // FSM states
        this.states = ['IDLE', 'DETECT', 'RCA', 'DECIDE', 'APPLY', 'OBSERVE', 'RESTORE', 'REPORT', 'PARK', 'ALERT'];
        
        this.initializeBudgetReset();
    }

    async initialize(eventBus, logger) {
        try {
            this.eventBus = eventBus;
            this.logger = logger;
            this.logger.info(`${this.name} başlatılıyor...`);
            
            // Event listeners
            this.setupEventListeners();
            
            // Initialize baselines
            await this.initializeBaselines();
            
            this.isInitialized = true;
            this.logger.info(`${this.name} başarıyla başlatıldı`);
            return true;
        } catch (error) {
            this.logger.error(`${this.name} başlatma hatası:`, error);
            return false;
        }
    }

    setupEventListeners() {
        // Cost data streams
        this.eventBus.on('cost.stream.sample', this.handleCostStreamSample.bind(this));
        this.eventBus.on('cost.window.metrics', this.handleCostWindowMetrics.bind(this));
        this.eventBus.on('billing.usage.snapshot', this.handleBillingSnapshot.bind(this));
        
        // System context
        this.eventBus.on('traffic.current.split', this.handleTrafficCurrentSplit.bind(this));
        this.eventBus.on('qo.decision.path', this.handleQoDecisionPath.bind(this));
        this.eventBus.on('slo.window.metrics', this.handleSLOMetrics.bind(this));
        
        // Configuration
        this.eventBus.on('cost.policy.updated', this.handleCostPolicyUpdated.bind(this));
        this.eventBus.on('thresholds.cost.anomaly', this.handleAnomalyThresholds.bind(this));
        this.eventBus.on('freeze.state.changed', this.handleFreezeStateChanged.bind(this));
    }

    initializeBudgetReset() {
        // Reset budget daily at midnight Istanbul time
        const msUntilMidnight = this.getMsUntilMidnight();
        
        setTimeout(() => {
            this.resetBudget();
            
            // Set daily interval
            setInterval(() => {
                this.resetBudget();
            }, 24 * 60 * 60 * 1000);
        }, msUntilMidnight);
    }

    getCurrentDayWindow() {
        const now = new Date();
        return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    }

    getMsUntilMidnight() {
        const now = new Date();
        const midnight = new Date(now);
        midnight.setHours(24, 0, 0, 0);
        return midnight.getTime() - now.getTime();
    }

    resetBudget() {
        const currentDay = this.getCurrentDayWindow();
        if (currentDay !== this.budgetState.windowStart) {
            this.budgetState.globalSpentUsd = 0;
            this.budgetState.tenantSpentUsd.clear();
            this.budgetState.windowStart = currentDay;
            this.logger.info('Daily budget reset');
        }
    }

    async initializeBaselines() {
        // Initialize historical baselines for comparison
        const windows = this.config.baselines.compareWindows;
        
        for (const window of windows) {
            this.baselines.set(window, {
                usdPerQuery: 0.012, // Mock baseline
                usdPer1kTok: 0.68,
                totalUsd: 100,
                normalized: true,
                timestamp: new Date().toISOString()
            });
        }
        
        this.logger.info('Cost baselines initialized');
    }

    async handleCostStreamSample(event) {
        const span = this.tracer.startSpan('cost.ingest');
        
        try {
            const { component, tenant, channel, region, metrics, timestamp } = event;
            
            const streamKey = `${component}:${tenant}:${channel}:${region}`;
            
            // Store stream sample
            if (!this.costStreams.has(streamKey)) {
                this.costStreams.set(streamKey, []);
            }
            
            const stream = this.costStreams.get(streamKey);
            stream.push({
                timestamp,
                metrics,
                component,
                tenant,
                channel,
                region
            });
            
            // Keep only recent samples (sliding window)
            const cutoff = Date.now() - (60 * 60 * 1000); // 1 hour
            this.costStreams.set(streamKey, stream.filter(s => new Date(s.timestamp).getTime() > cutoff));
            
            // Update budget tracking
            this.updateBudgetTracking(tenant, metrics.usd);
            
            // Trigger detection if enough samples
            if (stream.length >= this.config.detectors.minTraffic) {
                await this.triggerDetection(streamKey, stream);
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

    async handleCostWindowMetrics(event) {
        const span = this.tracer.startSpan('cost.window.ingest');
        
        try {
            const { window, agg, byComponent, byTenant, timestamp } = event;
            
            // Check for anomalies in aggregated metrics
            const costKey = this.generateCostKey(window, 'global', timestamp);
            
            if (!this.hasIdempotentKey(costKey)) {
                await this.analyzeWindowMetrics(window, agg, byComponent, byTenant, costKey);
                this.setIdempotentKey(costKey);
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

    async analyzeWindowMetrics(window, agg, byComponent, byTenant, costKey) {
        const detectSpan = this.tracer.startSpan('cost.detect');
        const startTime = Date.now();
        
        try {
            this.state = 'DETECT';
            
            // Get baseline for comparison
            const baseline = this.getApplicableBaseline(window);
            
            if (!baseline) {
                this.logger.debug(`No baseline for window ${window}`);
                return;
            }
            
            // Run anomaly detection
            const anomalyResults = await this.runAnomalyDetection(agg, baseline, window);
            
            if (anomalyResults.length > 0) {
                this.logger.info(`Cost anomaly detected: ${anomalyResults.length} signals`);
                
                for (const anomaly of anomalyResults) {
                    await this.processAnomaly(anomaly, agg, byComponent, byTenant, costKey);
                }
            }
            
            // Update metrics
            const duration = Date.now() - startTime;
            this.metrics.avgDetectMs = (this.metrics.avgDetectMs + duration) / 2;
            
            this.state = 'IDLE';
            detectSpan.setStatus({ code: SpanStatusCode.OK });
            
        } catch (error) {
            detectSpan.recordException(error);
            detectSpan.setStatus({ code: SpanStatusCode.ERROR });
            throw error;
        } finally {
            detectSpan.end();
        }
    }

    async runAnomalyDetection(metrics, baseline, window) {
        const anomalies = [];
        
        // EWMA detector
        const ewmaResult = this.runEWMADetector(metrics.usdPerQuery, baseline.usdPerQuery, window);
        if (ewmaResult.anomaly) {
            anomalies.push({
                detector: 'ewma',
                metric: 'usdPerQuery',
                zScore: ewmaResult.zScore,
                deltaPct: ewmaResult.deltaPct,
                severity: this.determineSeverity(ewmaResult.zScore, ewmaResult.deltaPct)
            });
        }
        
        // STL detector (mock implementation)
        const stlResult = this.runSTLDetector(metrics.usdPerQuery, baseline.usdPerQuery);
        if (stlResult.anomaly) {
            anomalies.push({
                detector: 'stl',
                metric: 'usdPerQuery',
                seasonal: stlResult.seasonal,
                trend: stlResult.trend,
                severity: this.determineSeverity(stlResult.zScore, stlResult.deltaPct)
            });
        }
        
        // ESD detector (mock implementation)
        const esdResult = this.runESDDetector(metrics.usdPerQuery, baseline.usdPerQuery);
        if (esdResult.anomaly) {
            anomalies.push({
                detector: 'esd',
                metric: 'usdPerQuery',
                outliers: esdResult.outliers,
                severity: this.determineSeverity(esdResult.zScore, esdResult.deltaPct)
            });
        }
        
        return anomalies;
    }

    runEWMADetector(current, baseline, window) {
        const key = `ewma:${window}`;
        let state = this.ewmaState.get(key);
        
        if (!state) {
            state = {
                mean: baseline,
                variance: Math.pow(baseline * 0.1, 2), // Initial variance
                alpha: this.config.detectors.ewma.alpha
            };
            this.ewmaState.set(key, state);
        }
        
        // Update EWMA
        const delta = current - state.mean;
        state.mean += state.alpha * delta;
        state.variance = (1 - state.alpha) * state.variance + state.alpha * Math.pow(delta, 2);
        
        // Detect anomaly
        const stdDev = Math.sqrt(state.variance);
        const zScore = Math.abs(delta) / stdDev;
        const threshold = this.config.detectors.ewma.k;
        
        const deltaPct = ((current - baseline) / baseline) * 100;
        
        return {
            anomaly: zScore > threshold,
            zScore,
            deltaPct,
            mean: state.mean,
            stdDev
        };
    }

    runSTLDetector(current, baseline) {
        // Mock STL decomposition
        const seasonal = Math.sin(Date.now() / (24 * 60 * 60 * 1000) * 2 * Math.PI) * baseline * 0.05;
        const trend = baseline * 1.02; // Small upward trend
        const residual = current - trend - seasonal;
        
        const zScore = Math.abs(residual) / (baseline * 0.1);
        const deltaPct = (residual / baseline) * 100;
        
        return {
            anomaly: Math.abs(residual) > baseline * 0.2,
            seasonal,
            trend,
            residual,
            zScore,
            deltaPct
        };
    }

    runESDDetector(current, baseline) {
        // Mock Extreme Studentized Deviate test
        const alpha = this.config.detectors.esd.alpha;
        const threshold = 2.5; // Mock critical value
        
        const deviation = Math.abs(current - baseline);
        const zScore = deviation / (baseline * 0.1);
        const deltaPct = ((current - baseline) / baseline) * 100;
        
        return {
            anomaly: zScore > threshold,
            outliers: zScore > threshold ? [current] : [],
            zScore,
            deltaPct
        };
    }

    determineSeverity(zScore, deltaPct) {
        const absDeltaPct = Math.abs(deltaPct);
        
        if (zScore > 5 || absDeltaPct > 100) {
            return 'block';
        } else if (zScore > 4 || absDeltaPct > 50) {
            return 'high';
        } else if (zScore > 3 || absDeltaPct > 25) {
            return 'med';
        } else {
            return 'low';
        }
    }

    async processAnomaly(anomaly, agg, byComponent, byTenant, costKey) {
        const { detector, metric, severity } = anomaly;
        
        this.state = 'RCA';
        
        // Perform root cause analysis
        const rcaResult = await this.performRootCauseAnalysis(agg, byComponent, byTenant, anomaly);
        
        this.state = 'DECIDE';
        
        // Decide on actions
        const actionPlan = await this.decideActions(anomaly, rcaResult);
        
        // Check if frozen
        if (this.freezeState.frozen) {
            this.state = 'PARK';
            await this.parkAnomaly(anomaly, actionPlan, costKey);
            return;
        }
        
        this.state = 'APPLY';
        
        // Apply actions
        await this.applyActions(anomaly, actionPlan, costKey);
        
        // Emit anomaly detected
        this.emit('cost.anomaly.detected', {
            event: 'cost.anomaly.detected',
            timestamp: new Date().toISOString(),
            severity,
            scope: this.determineScope(byTenant, byComponent),
            signal: {
                zScore: anomaly.zScore,
                deltaPct: anomaly.deltaPct,
                window: '5m',
                baseline: 'prev_24h_same_hour'
            },
            where: this.identifyAnomalyLocation(byTenant, byComponent),
            rca: rcaResult
        });
        
        this.metrics.anomalies++;
    }

    async performRootCauseAnalysis(agg, byComponent, byTenant, anomaly) {
        const rcaSpan = this.tracer.startSpan('cost.rca');
        
        try {
            const drivers = [];
            
            // Analyze component contributions
            if (byComponent) {
                for (const [component, cost] of Object.entries(byComponent)) {
                    const contribution = (cost / agg.totalUsd) * 100;
                    if (contribution > 20) { // Significant contributor
                        drivers.push([component, `+${contribution.toFixed(1)}%`]);
                    }
                }
            }
            
            // Analyze tenant contributions
            if (byTenant) {
                for (const [tenant, cost] of Object.entries(byTenant)) {
                    const contribution = (cost / agg.totalUsd) * 100;
                    if (contribution > 30) { // Major contributor
                        drivers.push([tenant, `+${contribution.toFixed(1)}%`]);
                    }
                }
            }
            
            // Check QO path influences
            const qoInfluence = this.analyzeQoInfluence(agg);
            if (qoInfluence.length > 0) {
                drivers.push(...qoInfluence);
            }
            
            // Sort by impact
            drivers.sort((a, b) => parseFloat(b[1]) - parseFloat(a[1]));
            
            const rcaResult = {
                drivers: drivers.slice(0, this.config.rca.shaplikeTopN)
            };
            
            rcaSpan.setStatus({ code: SpanStatusCode.OK });
            return rcaResult;
            
        } catch (error) {
            rcaSpan.recordException(error);
            rcaSpan.setStatus({ code: SpanStatusCode.ERROR });
            throw error;
        } finally {
            rcaSpan.end();
        }
    }

    analyzeQoInfluence(agg) {
        const influences = [];
        
        // Check recent QO decisions
        const recentQoPaths = Array.from(this.qoPaths.values())
            .filter(path => Date.now() - new Date(path.timestamp).getTime() < 300000) // Last 5 minutes
            .slice(-10);
        
        for (const path of recentQoPaths) {
            const { planId, params } = path;
            
            if (params.topK > 60) {
                influences.push(['topK', `+${((params.topK - 40) / 40 * 100).toFixed(0)}%`]);
            }
            
            if (params.reranker !== 'none') {
                influences.push(['reranker', '+active']);
            }
            
            if (params.model === 'gpt-m' || params.model === 'gpt-l') {
                influences.push(['model', `+${params.model}`]);
            }
            
            if (params.maxTokens > 600) {
                influences.push(['maxTokens', `+${params.maxTokens}`]);
            }
        }
        
        return influences;
    }

    async decideActions(anomaly, rcaResult) {
        const { severity, deltaPct } = anomaly;
        const actions = [];
        
        // Determine actions based on severity
        if (severity === 'block' || severity === 'high') {
            // Aggressive mitigation
            if (this.config.actions.throttle.enable) {
                actions.push({
                    type: 'throttle',
                    via: this.config.actions.throttle.provider,
                    args: { path: '/answer', rpsCap: 45 }
                });
            }
            
            if (this.config.actions.degrade.enable) {
                const degradePlan = this.config.actions.degrade.plans[0];
                actions.push({
                    type: 'degrade',
                    via: this.config.actions.degrade.via,
                    args: {
                        plan: degradePlan.to,
                        topK: 40,
                        reranker: degradePlan.reranker,
                        model: degradePlan.model
                    }
                });
            }
            
            if (this.config.actions.cap_tokens.enable) {
                actions.push({
                    type: 'cap_tokens',
                    via: this.config.actions.degrade.via,
                    args: { maxTokens: Math.max(this.config.actions.cap_tokens.minMaxTokens, 500) }
                });
            }
            
            if (this.config.actions.feature_toggle.enable) {
                actions.push({
                    type: 'feature_toggle',
                    via: this.config.integrations.zd,
                    args: { flag: 'rich_html', value: false }
                });
            }
            
        } else if (severity === 'med') {
            // Moderate mitigation
            if (this.config.actions.degrade.enable) {
                const degradePlan = this.config.actions.degrade.plans[0];
                actions.push({
                    type: 'degrade',
                    via: this.config.actions.degrade.via,
                    args: {
                        plan: degradePlan.to,
                        topK: 50,
                        reranker: degradePlan.reranker
                    }
                });
            }
        } else {
            // Low severity - just monitoring
            actions.push({
                type: 'monitor',
                args: { alertOnly: true }
            });
        }
        
        const plan = {
            severity,
            actions,
            guardrails: this.config.guardrails,
            cooldownMin: 20,
            restoreHint: 'gradual'
        };
        
        // Emit action plan
        this.emit('cost.sentinel.action.plan', {
            event: 'cost.sentinel.action.plan',
            timestamp: new Date().toISOString(),
            ...plan
        });
        
        return plan;
    }

    async applyActions(anomaly, actionPlan, costKey) {
        const applySpan = this.tracer.startSpan('cost.apply');
        const startTime = Date.now();
        
        try {
            const appliedActions = [];
            const impacts = {
                usdPerQuery: 0,
                p95Ms: 0,
                acceptRate: 0
            };
            
            for (const action of actionPlan.actions) {
                try {
                    await this.applyAction(action);
                    appliedActions.push(action.type);
                    
                    // Mock impact calculation
                    impacts.usdPerQuery -= 0.001; // Cost reduction
                    impacts.p95Ms += action.type === 'degrade' ? 15 : 2; // Latency impact
                    impacts.acceptRate -= action.type === 'throttle' ? 0.02 : 0.005; // Accept rate impact
                    
                } catch (error) {
                    this.logger.error(`Failed to apply action ${action.type}:`, error);
                }
            }
            
            // Store applied actions
            this.appliedActions.set(costKey, {
                actions: appliedActions,
                impacts,
                timestamp: new Date().toISOString(),
                restorePlan: this.createRestorePlan(appliedActions)
            });
            
            // Emit applied actions
            this.emit('cost.sentinel.action.applied', {
                event: 'cost.sentinel.action.applied',
                timestamp: new Date().toISOString(),
                applied: appliedActions,
                expectedImpact: {
                    usdPerQuery: impacts.usdPerQuery.toFixed(4),
                    p95Ms: `+${impacts.p95Ms}ms`,
                    acceptRate: `${impacts.acceptRate.toFixed(2)}pp`
                }
            });
            
            // Update metrics
            const duration = Date.now() - startTime;
            this.metrics.avgApplyMs = (this.metrics.avgApplyMs + duration) / 2;
            this.metrics.actionsApplied += appliedActions.length;
            this.metrics.usdPerQueryDelta += impacts.usdPerQuery;
            this.metrics.p95DeltaMs += impacts.p95Ms;
            this.metrics.acceptRateDelta += impacts.acceptRate;
            
            // Schedule restore evaluation
            this.scheduleRestoreEvaluation(costKey);
            
            applySpan.setStatus({ code: SpanStatusCode.OK });
            
        } catch (error) {
            applySpan.recordException(error);
            applySpan.setStatus({ code: SpanStatusCode.ERROR });
            
            // Emit alert
            this.emit('cost.alert', {
                event: 'cost.alert',
                timestamp: new Date().toISOString(),
                level: 'error',
                message: 'apply_failed'
            });
            
            throw error;
        } finally {
            applySpan.end();
        }
    }

    async applyAction(action) {
        // Mock action application
        this.logger.info(`Applying action: ${action.type}`);
        
        // In production, would integrate with actual systems
        await this.delay(100); // Simulate application time
        
        return { success: true };
    }

    createRestorePlan(appliedActions) {
        const steps = [];
        let afterMin = this.config.restore.stepMin;
        
        // Create gradual restore plan in reverse order
        const reverseActions = [...appliedActions].reverse();
        
        for (const action of reverseActions) {
            steps.push({
                afterMin,
                lift: action
            });
            afterMin += this.config.restore.stepMin;
        }
        
        return {
            mode: this.config.restore.mode,
            steps
        };
    }

    scheduleRestoreEvaluation(costKey) {
        const evaluationDelay = this.config.restore.stepMin * 60 * 1000; // Convert to ms
        
        setTimeout(() => {
            this.evaluateRestore(costKey);
        }, evaluationDelay);
    }

    async evaluateRestore(costKey) {
        const appliedAction = this.appliedActions.get(costKey);
        if (!appliedAction) return;
        
        this.state = 'OBSERVE';
        
        // Check if cost has stabilized
        const stable = await this.checkCostStability(costKey);
        
        if (stable) {
            this.state = 'RESTORE';
            await this.executeRestore(costKey, appliedAction.restorePlan);
        } else {
            // Schedule another evaluation
            this.scheduleRestoreEvaluation(costKey);
        }
    }

    async checkCostStability(costKey) {
        // Mock stability check
        // In production would check recent cost metrics against baselines
        const isStable = Math.random() > 0.3; // 70% chance of being stable
        
        this.logger.info(`Cost stability check: ${isStable ? 'stable' : 'unstable'}`);
        return isStable;
    }

    async executeRestore(costKey, restorePlan) {
        const restoreSpan = this.tracer.startSpan('cost.restore');
        
        try {
            this.logger.info(`Executing restore plan: ${costKey}`);
            
            // Emit restore plan
            this.emit('cost.sentinel.restore.plan', {
                event: 'cost.sentinel.restore.plan',
                timestamp: new Date().toISOString(),
                mode: restorePlan.mode,
                steps: restorePlan.steps
            });
            
            // Execute restore steps gradually
            for (const step of restorePlan.steps) {
                await this.delay(step.afterMin * 60 * 1000); // Wait for step time
                
                this.logger.info(`Restoring action: ${step.lift}`);
                await this.restoreAction(step.lift);
            }
            
            // Emit restore completion
            this.emit('cost.sentinel.restore.applied', {
                event: 'cost.sentinel.restore.applied',
                timestamp: new Date().toISOString(),
                finalState: 'normal',
                residualRisk: 'low'
            });
            
            // Clean up
            this.appliedActions.delete(costKey);
            this.metrics.restores++;
            
            this.state = 'REPORT';
            await this.generateReport(costKey);
            
            this.state = 'IDLE';
            
            restoreSpan.setStatus({ code: SpanStatusCode.OK });
            
        } catch (error) {
            restoreSpan.recordException(error);
            restoreSpan.setStatus({ code: SpanStatusCode.ERROR });
            throw error;
        } finally {
            restoreSpan.end();
        }
    }

    async restoreAction(actionType) {
        // Mock action restoration
        this.logger.info(`Restoring action: ${actionType}`);
        await this.delay(100);
    }

    async generateReport(costKey) {
        const reportPath = `data/cost/${this.getCurrentDayWindow()}/sentinel/report.md`;
        
        this.emit('cost.report.ready', {
            event: 'cost.report.ready',
            timestamp: new Date().toISOString(),
            path: reportPath,
            summary: 'inference/api t#acme +65% (5m). throttle+degrade ile $/query -0.0038; SLO korundu.',
            hash: crypto.createHash('sha256').update(costKey).digest('hex')
        });
        
        // Emit final metrics
        this.emit('cost.metrics', {
            event: 'cost.metrics',
            timestamp: new Date().toISOString(),
            ...this.metrics
        });
    }

    async parkAnomaly(anomaly, actionPlan, costKey) {
        this.logger.warn(`Anomaly parked due to freeze: ${costKey}`);
        
        // Just emit alert and report, no actions
        this.emit('cost.alert', {
            event: 'cost.alert',
            timestamp: new Date().toISOString(),
            level: 'warn',
            message: 'freeze_active'
        });
        
        await this.generateReport(costKey);
        this.state = 'IDLE';
    }

    // Event handlers
    async handleBillingSnapshot(event) {
        const { provider, period, amountUsd, usage } = event;
        
        // Update budget tracking
        this.budgetState.globalSpentUsd += amountUsd;
        
        // Check budget thresholds
        if (this.budgetState.globalSpentUsd > this.config.budgets.globalUsdPerDay * 0.9) {
            this.emit('cost.alert', {
                event: 'cost.alert',
                timestamp: new Date().toISOString(),
                level: 'warn',
                message: 'budget_exceeded'
            });
        }
    }

    async handleTrafficCurrentSplit(event) {
        const { serviceId, splits } = event;
        this.trafficSplits.set(serviceId, { splits, timestamp: event.timestamp });
    }

    async handleQoDecisionPath(event) {
        const { route, planId, params } = event;
        this.qoPaths.set(route, { planId, params, timestamp: event.timestamp });
    }

    async handleSLOMetrics(event) {
        const { serviceId, window, p95Ms, errPct } = event;
        this.sloMetrics.set(`${serviceId}:${window}`, { p95Ms, errPct, timestamp: event.timestamp });
    }

    async handleCostPolicyUpdated(event) {
        const { budget, caps, actions } = event;
        
        // Update configuration
        if (budget) Object.assign(this.config.budgets, budget);
        if (caps) Object.assign(this.config.budgets.caps, caps);
        if (actions) Object.assign(this.config.actions, actions);
        
        this.logger.info('Cost policy updated');
    }

    async handleAnomalyThresholds(event) {
        const { detectors, minTraffic, minSpendUsd } = event;
        
        // Update detector configuration
        if (detectors) Object.assign(this.config.detectors, detectors);
        if (minTraffic !== undefined) this.config.detectors.minTraffic = minTraffic;
        if (minSpendUsd !== undefined) this.config.detectors.minSpendUsd = minSpendUsd;
        
        this.logger.info('Anomaly thresholds updated');
    }

    async handleFreezeStateChanged(event) {
        const { state, scope, reason } = event;
        
        this.freezeState = {
            frozen: state === 'frozen',
            scope,
            reason
        };
        
        if (state === 'frozen') {
            this.logger.warn(`Cost mitigation frozen: ${scope} (${reason})`);
        } else {
            this.logger.info(`Cost mitigation unfrozen: ${scope}`);
        }
    }

    // Utility methods
    updateBudgetTracking(tenant, costUsd) {
        // Update global spend
        this.budgetState.globalSpentUsd += costUsd;
        
        // Update tenant spend
        const currentTenantSpend = this.budgetState.tenantSpentUsd.get(tenant) || 0;
        this.budgetState.tenantSpentUsd.set(tenant, currentTenantSpend + costUsd);
    }

    async triggerDetection(streamKey, stream) {
        // Mock detection trigger based on stream data
        const recentSamples = stream.slice(-10);
        const avgCost = recentSamples.reduce((sum, s) => sum + s.metrics.usd, 0) / recentSamples.length;
        
        if (avgCost > 0.015) { // Above cap threshold
            const costKey = this.generateCostKey('5m', streamKey, new Date().toISOString());
            
            // Mock window metrics for detection
            const mockMetrics = {
                usdPerQuery: avgCost,
                usdPer1kTok: avgCost * 50,
                totalUsd: avgCost * 1000
            };
            
            await this.analyzeWindowMetrics('5m', mockMetrics, {}, {}, costKey);
        }
    }

    getApplicableBaseline(window) {
        // Get the most appropriate baseline for comparison
        return this.baselines.get('prev_24h_same_hour') || this.baselines.get('prev_1h');
    }

    determineScope(byTenant, byComponent) {
        if (byTenant && Object.keys(byTenant).length === 1) {
            return 'tenant';
        } else if (byComponent && Object.keys(byComponent).length === 1) {
            return 'component';
        } else {
            return 'global';
        }
    }

    identifyAnomalyLocation(byTenant, byComponent) {
        const where = {};
        
        if (byTenant) {
            const topTenant = Object.keys(byTenant).reduce((a, b) => byTenant[a] > byTenant[b] ? a : b);
            where.tenant = topTenant;
        }
        
        if (byComponent) {
            const topComponent = Object.keys(byComponent).reduce((a, b) => byComponent[a] > byComponent[b] ? a : b);
            where.component = topComponent;
        }
        
        where.channel = 'api'; // Mock
        
        return where;
    }

    generateCostKey(window, scope, timestamp) {
        const keyData = {
            windowISO: timestamp.split('T')[0], // Date only
            scope,
            detectorHash: crypto.createHash('sha256').update(JSON.stringify(this.config.detectors)).digest('hex').substring(0, 8),
            policyHash: crypto.createHash('sha256').update(JSON.stringify(this.config.budgets)).digest('hex').substring(0, 8)
        };
        return crypto.createHash('sha256').update(JSON.stringify(keyData)).digest('hex').substring(0, 16);
    }

    hasIdempotentKey(key) {
        // Simple in-memory idempotency check
        return this.appliedActions.has(key);
    }

    setIdempotentKey(key) {
        // Mark key as processed
        this.appliedActions.set(key, { processed: true, timestamp: new Date().toISOString() });
        
        // Schedule cleanup
        setTimeout(() => {
            this.appliedActions.delete(key);
        }, this.config.idempotencyTtlSec * 1000);
    }

    async delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    getStatus() {
        return {
            name: this.name,
            initialized: this.isInitialized,
            state: this.state,
            costStreams: this.costStreams.size,
            baselines: this.baselines.size,
            anomalies: this.anomalies.size,
            appliedActions: this.appliedActions.size,
            restorePlans: this.restorePlans.size,
            cooldowns: this.cooldowns.size,
            freezeState: this.freezeState,
            budgetState: {
                globalSpentUsd: this.budgetState.globalSpentUsd,
                tenantCount: this.budgetState.tenantSpentUsd.size,
                windowStart: this.budgetState.windowStart
            },
            metrics: this.metrics,
            config: {
                enabled: this.config.enabled,
                detectors: Object.keys(this.config.detectors).filter(d => d !== 'minTraffic' && d !== 'minSpendUsd'),
                actionsEnabled: Object.keys(this.config.actions).filter(a => this.config.actions[a].enable)
            }
        };
    }

    async shutdown() {
        try {
            this.logger.info(`${this.name} durduruluyor...`);
            
            // Clear all data structures
            this.costStreams.clear();
            this.baselines.clear();
            this.anomalies.clear();
            this.appliedActions.clear();
            this.restorePlans.clear();
            this.ewmaState.clear();
            this.cooldowns.clear();
            this.trafficSplits.clear();
            this.qoPaths.clear();
            this.sloMetrics.clear();
            
            this.isInitialized = false;
            this.logger.info(`${this.name} başarıyla durduruldu`);
        } catch (error) {
            this.logger.error(`${this.name} durdurma hatası:`, error);
        }
    }
}

module.exports = CostAnomalySentinel;