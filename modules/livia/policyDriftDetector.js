/**
 * LIVIA-63: Policy Drift Detector
 * Politika sapma tespit sistemi
 * Amaç: Tüm kritik politika/konfig yüzeylerinde drift tespit, risk skorla, düzeltme planı öner
 */

const crypto = require('crypto');
const { EventEmitter } = require('events');
const { trace, context, SpanStatusCode } = require('@opentelemetry/api');

class PolicyDriftDetector extends EventEmitter {
    constructor(config = {}) {
        super();
        
        this.name = 'PolicyDriftDetector';
        this.config = {
            enabled: true,
            locale: 'tr-TR',
            timezone: 'Europe/Istanbul',
            surfaces: ['qo', 'safety', 'fresh', 'cost', 'slo', 'release', 'rbac', 'feature', 'connector', 'infra'],
            diff: {
                numericTolerance: { relPct: 1.0, abs: 0.0001 },
                unorderedSets: true,
                caseInsensitiveKeys: true,
                semanticEquivalence: { enable: true, nlpModel: 'spec-sim-mini', threshold: 0.92 },
                ignorePaths: ['/metadata/updatedAt', '/comments/*', '/notes/*']
            },
            scoring: {
                baseWeightBySurface: { safety: 0.35, qo: 0.2, release: 0.15, rbac: 0.1, fresh: 0.08, cost: 0.06, slo: 0.06 },
                blastRadiusWeights: { global: 1.0, tenant: 0.6, service: 0.7, feature: 0.4 },
                severityMap: { low: 0.2, med: 0.5, high: 0.8 },
                contextMods: { sloBurn: { lt2: 0, lt5: 0.05, gte5: 0.1 }, costHigh: 0.05 },
                thresholds: { warn: 0.6, block: 0.8 }
            },
            simulate: {
                method: 'counterfactual-replay',
                minSamples: 1000,
                ci: 'bootstrapB=200',
                clipW: 10,
                guardrails: { p95MsMax: 900, ndcg10Min: 0.50, safetyNoWorse: true }
            },
            proposals: {
                actions: ['fix', 'roll_back', 'roll_forward', 'guardrail', 'document'],
                prefer: 'roll_back_if_risk≥high_else_fix',
                requireApprovalFor: ['env=prod', 'risk≥med'],
                maxAutoChangesPerDay: 3
            },
            apply: {
                via: 'LIVIA-45 (canary) + L62 (runbook) when needed',
                canary: { trafficPct: 10, durationMin: 20, promoteIf: 'guardrails_ok' },
                rollbackCriteria: { ndcgDropPct: 3.0, p95RiseMs: 80, safetyEvent: true }
            },
            schedule: { cron: '*/15 * * * *' }, // 15 dakikada bir tarama
            cache: { ttlSec: 600, keyBy: ['target', 'env', 'baselineHash'] },
            idempotencyTtlSec: 1800,
            ...config
        };
        
        // State management
        this.state = 'IDLE';
        this.baselines = new Map(); // Baseline snapshots
        this.runtimeSnapshots = new Map(); // Runtime snapshots
        this.driftResults = new Map(); // Drift detection results
        this.changeIntents = new Map(); // Declared change intents
        this.experiments = new Map(); // A/B experiments
        this.proposals = new Map(); // Drift fix proposals
        this.systemMetrics = new Map(); // SLO/cost context
        this.cache = new Map(); // Detection cache
        this.metrics = {
            targetsScanned: 0,
            driftFound: 0,
            autoFixed: 0,
            blocked: 0,
            avgDiffMs: 0,
            avgScore: 0,
            proposals: 0,
            applied: 0,
            rolledBack: 0
        };
        
        this.isInitialized = false;
        this.logger = null;
        this.tracer = trace.getTracer('livia-policy-drift-detector');
        
        // FSM states
        this.states = ['IDLE', 'DIFF', 'SCORE', 'SIMULATE', 'PROPOSE', 'APPLY', 'EVALUATE', 'REPORT', 'PARK', 'AWAIT_APPROVAL'];
        
        this.initializeScheduler();
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
        // Baseline and runtime snapshots
        this.eventBus.on('baseline.snapshot.registered', this.handleBaselineSnapshot.bind(this));
        this.eventBus.on('runtime.snapshot.captured', this.handleRuntimeSnapshot.bind(this));
        
        // Change management
        this.eventBus.on('change.intent.declared', this.handleChangeIntent.bind(this));
        this.eventBus.on('freeze.state.changed', this.handleFreezeStateChanged.bind(this));
        this.eventBus.on('policy.guardrails', this.handlePolicyGuardrails.bind(this));
        
        // Context metrics
        this.eventBus.on('slo.window.metrics', this.handleSLOMetrics.bind(this));
        this.eventBus.on('cost.window.metrics', this.handleCostMetrics.bind(this));
        this.eventBus.on('ab.experiment.registered', this.handleABExperiment.bind(this));
        
        // Manual triggers
        this.eventBus.on('drift.scan.trigger', this.handleScanTrigger.bind(this));
    }

    initializeScheduler() {
        // Mock scheduler - in production would use proper cron
        if (this.config.enabled) {
            setInterval(() => {
                this.performScheduledScan();
            }, 15 * 60 * 1000); // 15 minutes
        }
    }

    async handleBaselineSnapshot(event) {
        const span = this.tracer.startSpan('drift.baseline.register');
        
        try {
            const { target, version, specHash, specUrl, spec } = event;
            
            const baseline = {
                target,
                version,
                specHash,
                specUrl,
                spec,
                timestamp: event.timestamp,
                registered: true
            };
            
            const baselineKey = `${target}:${version}`;
            this.baselines.set(baselineKey, baseline);
            
            this.logger.info(`Baseline registered: ${target} v${version}`);
            
            // Check if we have matching runtime snapshot for drift detection
            await this.checkForDriftOpportunity(target);
            
            span.setStatus({ code: SpanStatusCode.OK });
            
        } catch (error) {
            span.recordException(error);
            span.setStatus({ code: SpanStatusCode.ERROR });
            throw error;
        } finally {
            span.end();
        }
    }

    async handleRuntimeSnapshot(event) {
        const span = this.tracer.startSpan('drift.runtime.capture');
        
        try {
            const { target, env, source, specHash, spec } = event;
            
            const runtime = {
                target,
                env,
                source,
                specHash,
                spec,
                timestamp: event.timestamp,
                captured: true
            };
            
            const runtimeKey = `${target}:${env}`;
            this.runtimeSnapshots.set(runtimeKey, runtime);
            
            this.logger.info(`Runtime snapshot captured: ${target} (${env})`);
            
            // Check for drift opportunity
            await this.checkForDriftOpportunity(target, env);
            
            span.setStatus({ code: SpanStatusCode.OK });
            
        } catch (error) {
            span.recordException(error);
            span.setStatus({ code: SpanStatusCode.ERROR });
            throw error;
        } finally {
            span.end();
        }
    }

    async checkForDriftOpportunity(target, env = 'prod') {
        // Check if we have both baseline and runtime for drift detection
        const baseline = this.getLatestBaseline(target);
        const runtime = this.runtimeSnapshots.get(`${target}:${env}`);
        
        if (baseline && runtime) {
            await this.triggerDriftDetection(target, env, baseline, runtime);
        }
    }

    getLatestBaseline(target) {
        // Get the latest baseline for target
        const targetBaselines = Array.from(this.baselines.values())
            .filter(b => b.target === target)
            .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        
        return targetBaselines[0] || null;
    }

    async triggerDriftDetection(target, env, baseline, runtime) {
        const span = this.tracer.startSpan('drift.detection.trigger');
        
        try {
            this.state = 'DIFF';
            
            const driftKey = this.generateDriftKey(target, env, baseline.specHash);
            
            // Idempotency check
            if (this.cache.has(driftKey)) {
                span.setStatus({ code: SpanStatusCode.OK });
                return;
            }
            
            // Run drift detection pipeline
            const result = await this.runDriftDetectionPipeline(target, env, baseline, runtime, driftKey);
            
            // Cache result
            this.cache.set(driftKey, result);
            this.scheduleCacheEviction(driftKey);
            
            span.setStatus({ code: SpanStatusCode.OK });
            
        } catch (error) {
            span.recordException(error);
            span.setStatus({ code: SpanStatusCode.ERROR });
            throw error;
        } finally {
            span.end();
        }
    }

    async runDriftDetectionPipeline(target, env, baseline, runtime, driftKey) {
        const context = {
            target,
            env,
            baseline,
            runtime,
            driftKey,
            startTime: Date.now(),
            state: 'DIFF'
        };
        
        try {
            // Diff analysis
            const diffResult = await this.performDiff(context);
            
            if (diffResult.changes.length === 0) {
                // No drift detected
                this.state = 'IDLE';
                return { noDrift: true };
            }
            
            // Risk scoring
            this.state = 'SCORE';
            const scoreResult = await this.performScoring(context, diffResult);
            
            // Check if we need to proceed based on risk score
            if (scoreResult.riskScore < this.config.scoring.thresholds.warn) {
                this.state = 'REPORT';
                await this.emitLowRiskReport(context, diffResult, scoreResult);
                this.state = 'IDLE';
                return { lowRisk: true };
            }
            
            // Impact simulation
            this.state = 'SIMULATE';
            const simulationResult = await this.performSimulation(context, diffResult);
            
            // Generate proposals
            this.state = 'PROPOSE';
            const proposals = await this.generateProposals(context, diffResult, scoreResult, simulationResult);
            
            // Handle freeze or approval requirements
            if (this.isFrozen() || this.requiresApproval(scoreResult, env)) {
                this.state = 'PARK';
                await this.parkProposal(context, proposals);
            } else {
                this.state = 'APPLY';
                await this.applyProposals(context, proposals);
            }
            
            this.state = 'REPORT';
            await this.emitFinalReport(context, diffResult, scoreResult, proposals);
            
            this.state = 'IDLE';
            return { processed: true };
            
        } catch (error) {
            this.logger.error(`Drift detection pipeline error: ${error.message}`);
            throw error;
        }
    }

    async performDiff(context) {
        const diffSpan = this.tracer.startSpan('drift.diff', { parent: context.span });
        
        try {
            const { baseline, runtime } = context;
            
            // Perform structured diff
            const changes = this.calculateStructuralDiff(baseline.spec, runtime.spec);
            
            // Check semantic equivalence
            const semanticEquivalence = await this.checkSemanticEquivalence(baseline.spec, runtime.spec);
            
            const diffResult = {
                baselineVersion: baseline.version,
                changes,
                semanticEquivalence,
                hash: crypto.createHash('sha256').update(JSON.stringify(changes)).digest('hex')
            };
            
            // Emit diff result
            this.emit('drift.diff.ready', {
                event: 'drift.diff.ready',
                timestamp: new Date().toISOString(),
                target: context.target,
                env: context.env,
                ...diffResult
            });
            
            diffSpan.setStatus({ code: SpanStatusCode.OK });
            return diffResult;
            
        } catch (error) {
            diffSpan.recordException(error);
            diffSpan.setStatus({ code: SpanStatusCode.ERROR });
            throw error;
        } finally {
            diffSpan.end();
        }
    }

    calculateStructuralDiff(baseline, runtime) {
        // Simplified structural diff implementation
        const changes = [];
        
        // Compare JSON objects recursively
        this.compareObjects(baseline, runtime, '', changes);
        
        return changes;
    }

    compareObjects(baseline, runtime, path, changes) {
        // Recursive object comparison
        if (typeof baseline !== typeof runtime) {
            changes.push({
                path,
                from: baseline,
                to: runtime,
                kind: 'type_change'
            });
            return;
        }
        
        if (typeof baseline === 'object' && baseline !== null) {
            // Compare object properties
            const baseKeys = new Set(Object.keys(baseline));
            const runtimeKeys = new Set(Object.keys(runtime));
            
            // Check for added/removed keys
            for (const key of runtimeKeys) {
                if (!baseKeys.has(key)) {
                    changes.push({
                        path: `${path}/${key}`,
                        from: undefined,
                        to: runtime[key],
                        kind: 'added'
                    });
                }
            }
            
            for (const key of baseKeys) {
                if (!runtimeKeys.has(key)) {
                    changes.push({
                        path: `${path}/${key}`,
                        from: baseline[key],
                        to: undefined,
                        kind: 'removed'
                    });
                } else {
                    // Recursively compare existing keys
                    this.compareObjects(baseline[key], runtime[key], `${path}/${key}`, changes);
                }
            }
        } else if (baseline !== runtime) {
            // Primitive value difference
            const kind = typeof baseline === 'number' ? 'numeric' : 'value';
            
            // Check numeric tolerance
            if (kind === 'numeric') {
                const relDiff = Math.abs(baseline - runtime) / Math.abs(baseline);
                const absDiff = Math.abs(baseline - runtime);
                
                if (relDiff > this.config.diff.numericTolerance.relPct / 100 &&
                    absDiff > this.config.diff.numericTolerance.abs) {
                    changes.push({
                        path,
                        from: baseline,
                        to: runtime,
                        kind
                    });
                }
            } else {
                changes.push({
                    path,
                    from: baseline,
                    to: runtime,
                    kind
                });
            }
        }
    }

    async checkSemanticEquivalence(baseline, runtime) {
        // Mock semantic equivalence check
        // In production would use NLP model to check if configs are semantically equivalent
        return {
            notes: 'mock_check',
            ok: false // Assume not equivalent for now
        };
    }

    async performScoring(context, diffResult) {
        const scoreSpan = this.tracer.startSpan('drift.score');
        
        try {
            const { target, env } = context;
            
            // Calculate base risk score
            const surfaceWeight = this.config.scoring.baseWeightBySurface[target] || 0.1;
            const blastRadius = this.determineBlastRadius(target, diffResult.changes);
            const blastWeight = this.config.scoring.blastRadiusWeights[blastRadius] || 1.0;
            const severity = this.determineSeverity(diffResult.changes);
            const severityWeight = this.config.scoring.severityMap[severity] || 0.5;
            
            let riskScore = surfaceWeight * blastWeight * severityWeight;
            
            // Apply context modifiers
            const sloContext = this.getLatestSLOMetrics();
            const costContext = this.getLatestCostMetrics();
            
            if (sloContext && sloContext.burnPct >= 5) {
                riskScore += this.config.scoring.contextMods.sloBurn.gte5;
            } else if (sloContext && sloContext.burnPct >= 2) {
                riskScore += this.config.scoring.contextMods.sloBurn.lt5;
            }
            
            if (costContext && costContext.avgUsdPerQuery > 0.015) {
                riskScore += this.config.scoring.contextMods.costHigh;
            }
            
            // Check for change intent overlap
            const changeIntentOverlap = this.checkChangeIntentOverlap(target, diffResult.changes);
            if (changeIntentOverlap) {
                riskScore *= 0.7; // Reduce risk if change was intended
            }
            
            // Determine status
            let status = 'low';
            if (riskScore >= this.config.scoring.thresholds.block) {
                status = 'block';
            } else if (riskScore >= this.config.scoring.thresholds.warn) {
                status = 'warn';
            }
            
            const scoreResult = {
                riskScore,
                factors: {
                    surface: target,
                    blastRadius,
                    severity,
                    sloContext,
                    costContext,
                    changeIntentOverlap
                },
                status
            };
            
            // Emit score result
            this.emit('drift.score.snapshot', {
                event: 'drift.score.snapshot',
                timestamp: new Date().toISOString(),
                target: context.target,
                env: context.env,
                ...scoreResult
            });
            
            scoreSpan.setStatus({ code: SpanStatusCode.OK });
            return scoreResult;
            
        } catch (error) {
            scoreSpan.recordException(error);
            scoreSpan.setStatus({ code: SpanStatusCode.ERROR });
            throw error;
        } finally {
            scoreSpan.end();
        }
    }

    determineBlastRadius(target, changes) {
        // Determine blast radius based on target and changes
        if (target === 'safety' || target === 'rbac') {
            return 'global';
        } else if (target === 'qo' || target === 'slo') {
            return 'service';
        } else if (target === 'feature') {
            return 'feature';
        } else {
            return 'tenant';
        }
    }

    determineSeverity(changes) {
        // Determine severity based on changes
        const criticalPaths = ['/pii/', '/grounding/', '/categories/', '/safety/'];
        
        for (const change of changes) {
            if (criticalPaths.some(path => change.path.includes(path))) {
                return 'high';
            }
        }
        
        if (changes.length > 5) {
            return 'med';
        }
        
        return 'low';
    }

    checkChangeIntentOverlap(target, changes) {
        // Check if changes overlap with declared change intents
        const recentIntents = Array.from(this.changeIntents.values())
            .filter(intent => 
                intent.target === target && 
                Date.now() - new Date(intent.timestamp).getTime() < 3600000 // 1 hour
            );
        
        return recentIntents.length > 0;
    }

    async performSimulation(context, diffResult) {
        const simSpan = this.tracer.startSpan('drift.simulate');
        
        try {
            const { target } = context;
            
            // Mock counterfactual simulation
            const estimates = {};
            
            if (target === 'safety') {
                estimates.toxicityIncidents = '+0.4pp [CI 0.1,0.8]';
                estimates.acceptRate = '+0.2pp [CI -0.1,0.5]';
                estimates.costUsd = '+0.0002';
            } else if (target === 'qo') {
                estimates.p95Ms = '+15ms [CI 8,25]';
                estimates.ndcg10 = '-0.02pp [CI -0.05,0.01]';
                estimates.costUsd = '-0.001';
            }
            
            const simulationResult = {
                method: this.config.simulate.method,
                estimates
            };
            
            // Emit simulation result
            this.emit('drift.impact.simulation', {
                event: 'drift.impact.simulation',
                timestamp: new Date().toISOString(),
                target: context.target,
                env: context.env,
                ...simulationResult
            });
            
            simSpan.setStatus({ code: SpanStatusCode.OK });
            return simulationResult;
            
        } catch (error) {
            simSpan.recordException(error);
            simSpan.setStatus({ code: SpanStatusCode.ERROR });
            throw error;
        } finally {
            simSpan.end();
        }
    }

    async generateProposals(context, diffResult, scoreResult, simulationResult) {
        const proposeSpan = this.tracer.startSpan('drift.propose');
        
        try {
            const { target, env } = context;
            const actions = [];
            
            // Determine action based on risk score and preferences
            if (scoreResult.riskScore >= this.config.scoring.thresholds.block) {
                // High risk - rollback immediately
                actions.push({
                    type: 'roll_back',
                    paths: diffResult.changes.map(c => c.path),
                    toBaseline: diffResult.baselineVersion
                });
                
                actions.push({
                    type: 'guardrail',
                    rule: `requireApprovalFor:${target}.high`
                });
            } else if (scoreResult.riskScore >= this.config.scoring.thresholds.warn) {
                // Medium risk - fix or rollback with approval
                actions.push({
                    type: 'fix',
                    paths: diffResult.changes.map(c => c.path),
                    strategy: 'targeted'
                });
            } else {
                // Low risk - document
                actions.push({
                    type: 'document',
                    changes: diffResult.changes.length,
                    impact: 'minimal'
                });
            }
            
            const proposal = {
                target,
                env,
                actions,
                recommendation: scoreResult.riskScore >= this.config.scoring.thresholds.warn ? 
                    'canary_10pct_20min_then_promote_if_ok' : 'document_only',
                needsApproval: this.requiresApproval(scoreResult, env)
            };
            
            // Emit proposal
            this.emit('drift.proposal.ready', {
                event: 'drift.proposal.ready',
                timestamp: new Date().toISOString(),
                ...proposal
            });
            
            this.metrics.proposals++;
            
            proposeSpan.setStatus({ code: SpanStatusCode.OK });
            return proposal;
            
        } catch (error) {
            proposeSpan.recordException(error);
            proposeSpan.setStatus({ code: SpanStatusCode.ERROR });
            throw error;
        } finally {
            proposeSpan.end();
        }
    }

    requiresApproval(scoreResult, env) {
        // Check if proposal requires approval
        return env === 'prod' || scoreResult.riskScore >= this.config.scoring.thresholds.warn;
    }

    async parkProposal(context, proposal) {
        // Park proposal due to freeze or approval requirement
        this.logger.warn(`Proposal parked: ${context.target} (${context.env})`);
        
        if (proposal.needsApproval) {
            this.emit('drift.approval.request', {
                event: 'drift.approval.request',
                timestamp: new Date().toISOString(),
                driftKey: context.driftKey,
                proposal,
                needed: ['ops_lead'],
                ttlSec: 1800
            });
        }
    }

    async applyProposals(context, proposal) {
        // Apply drift fix proposals
        const applySpan = this.tracer.startSpan('drift.apply');
        
        try {
            const { target, env } = context;
            
            // Mock application - in production would integrate with actual systems
            this.emit('drift.apply.started', {
                event: 'drift.apply.started',
                timestamp: new Date().toISOString(),
                target,
                env,
                mode: 'canary',
                trafficPct: this.config.apply.canary.trafficPct,
                durationMin: this.config.apply.canary.durationMin,
                owner: 'policy#drift-detector'
            });
            
            // Schedule evaluation
            this.scheduleApplyEvaluation(context.driftKey, target, env);
            
            this.metrics.applied++;
            
            applySpan.setStatus({ code: SpanStatusCode.OK });
            
        } catch (error) {
            applySpan.recordException(error);
            applySpan.setStatus({ code: SpanStatusCode.ERROR });
            throw error;
        } finally {
            applySpan.end();
        }
    }

    scheduleApplyEvaluation(driftKey, target, env) {
        const durationMs = this.config.apply.canary.durationMin * 60 * 1000;
        
        setTimeout(() => {
            this.evaluateApply(driftKey, target, env);
        }, durationMs);
    }

    async evaluateApply(driftKey, target, env) {
        // Mock evaluation
        const result = 'promote'; // Could be 'promote', 'rollback', 'extend'
        
        this.emit('drift.apply.evaluation', {
            event: 'drift.apply.evaluation',
            timestamp: new Date().toISOString(),
            target,
            result,
            guardrails: this.config.simulate.guardrails
        });
    }

    // Event handlers
    async handleChangeIntent(event) {
        const { ticket, actor, target, diff, window } = event;
        
        this.changeIntents.set(ticket, {
            ticket,
            actor,
            target,
            diff,
            window,
            timestamp: event.timestamp
        });
        
        this.logger.info(`Change intent declared: ${ticket} (${target})`);
    }

    async handleFreezeStateChanged(event) {
        const { state, scope, reason } = event;
        
        if (state === 'frozen') {
            this.logger.warn(`Freeze activated: ${scope} (${reason})`);
        } else {
            this.logger.info(`Freeze lifted: ${scope}`);
        }
    }

    async handlePolicyGuardrails(event) {
        const { constraints } = event;
        
        // Update guardrails configuration
        Object.assign(this.config.proposals, constraints);
        this.logger.info('Policy guardrails updated');
    }

    async handleSLOMetrics(event) {
        const { serviceId, window, p95Ms, errPct, burnPct } = event;
        
        this.systemMetrics.set(`slo:${serviceId}:${window}`, {
            serviceId,
            window,
            p95Ms,
            errPct,
            burnPct,
            timestamp: event.timestamp
        });
    }

    async handleCostMetrics(event) {
        const { window, avgUsdPerQuery } = event;
        
        this.systemMetrics.set(`cost:${window}`, {
            window,
            avgUsdPerQuery,
            timestamp: event.timestamp
        });
    }

    async handleABExperiment(event) {
        const { expId, scope, arms } = event;
        
        this.experiments.set(expId, {
            expId,
            scope,
            arms,
            timestamp: event.timestamp
        });
        
        this.logger.info(`A/B experiment registered: ${expId}`);
    }

    async handleScanTrigger(event) {
        this.logger.info('Manual drift scan triggered');
        await this.performScheduledScan();
    }

    async performScheduledScan() {
        if (!this.isInitialized) return;
        
        this.logger.info('Performing scheduled drift scan');
        
        // Scan all configured surfaces
        for (const surface of this.config.surfaces) {
            try {
                await this.scanSurface(surface);
            } catch (error) {
                this.logger.error(`Error scanning surface ${surface}:`, error);
            }
        }
        
        this.metrics.targetsScanned = this.config.surfaces.length;
        this.emitMetrics();
    }

    async scanSurface(surface) {
        // Check if we have baseline and runtime for this surface
        const baseline = this.getLatestBaseline(surface);
        const runtime = this.runtimeSnapshots.get(`${surface}:prod`);
        
        if (baseline && runtime) {
            await this.triggerDriftDetection(surface, 'prod', baseline, runtime);
        }
    }

    // Utility methods
    generateDriftKey(target, env, baselineHash) {
        const keyData = {
            target,
            env,
            baselineHash,
            timestamp: Math.floor(Date.now() / (this.config.idempotencyTtlSec * 1000))
        };
        return crypto.createHash('sha256').update(JSON.stringify(keyData)).digest('hex').substring(0, 16);
    }

    scheduleCacheEviction(key) {
        setTimeout(() => {
            this.cache.delete(key);
        }, this.config.cache.ttlSec * 1000);
    }

    getLatestSLOMetrics() {
        const sloMetrics = Array.from(this.systemMetrics.values())
            .filter(m => m.serviceId)
            .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        
        return sloMetrics[0] || null;
    }

    getLatestCostMetrics() {
        const costMetrics = Array.from(this.systemMetrics.values())
            .filter(m => m.avgUsdPerQuery !== undefined)
            .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        
        return costMetrics[0] || null;
    }

    isFrozen() {
        // Check if system is frozen - mock implementation
        return false;
    }

    async emitLowRiskReport(context, diffResult, scoreResult) {
        this.emitCard(context, 'info', 'Düşük Risk Drift', `${diffResult.changes.length} değişiklik tespit edildi, risk düşük`);
    }

    async emitFinalReport(context, diffResult, scoreResult, proposals) {
        const reportPath = `data/drift/${new Date().toISOString().split('T')[0]}/${context.env}/report.md`;
        
        this.emit('drift.report.ready', {
            event: 'drift.report.ready',
            timestamp: new Date().toISOString(),
            path: reportPath,
            summary: `${context.target} yüzeyinde ${diffResult.changes.length} drift; öneri: ${proposals.actions[0]?.type}`,
            hash: crypto.createHash('sha256').update(JSON.stringify({ diffResult, scoreResult, proposals })).digest('hex')
        });
        
        // Emit card based on risk level
        const severity = scoreResult.status === 'block' ? 'error' : 
                        scoreResult.status === 'warn' ? 'warn' : 'info';
        
        this.emitCard(context, severity, 
            `Policy Drift — ${context.target} (risk: ${scoreResult.status}) • ${context.env}`,
            `${diffResult.changes.length} alan baseline'dan saptı • öneri: ${proposals.actions[0]?.type}`);
    }

    emitCard(context, severity, title, body) {
        this.emit('drift.card', {
            event: 'drift.card',
            timestamp: new Date().toISOString(),
            title,
            body,
            severity,
            ttlSec: 600
        });
    }

    emitMetrics() {
        this.emit('drift.metrics', {
            event: 'drift.metrics',
            timestamp: new Date().toISOString(),
            ...this.metrics
        });
    }

    getStatus() {
        return {
            name: this.name,
            initialized: this.isInitialized,
            state: this.state,
            baselines: this.baselines.size,
            runtimeSnapshots: this.runtimeSnapshots.size,
            driftResults: this.driftResults.size,
            changeIntents: this.changeIntents.size,
            experiments: this.experiments.size,
            proposals: this.proposals.size,
            systemMetrics: this.systemMetrics.size,
            cache: this.cache.size,
            metrics: this.metrics,
            config: {
                enabled: this.config.enabled,
                surfaces: this.config.surfaces,
                scanInterval: this.config.schedule.cron
            }
        };
    }

    async shutdown() {
        try {
            this.logger.info(`${this.name} durduruluyor...`);
            
            // Clear all data structures
            this.baselines.clear();
            this.runtimeSnapshots.clear();
            this.driftResults.clear();
            this.changeIntents.clear();
            this.experiments.clear();
            this.proposals.clear();
            this.systemMetrics.clear();
            this.cache.clear();
            
            this.isInitialized = false;
            this.logger.info(`${this.name} başarıyla durduruldu`);
        } catch (error) {
            this.logger.error(`${this.name} durdurma hatası:`, error);
        }
    }
}

module.exports = PolicyDriftDetector;