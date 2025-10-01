/**
 * LIVIA-50 · Disaster Recovery Drills
 * Felaket kurtarma kabiliyetini sürekli kanıtlamak için otomatik drill sistemi
 */

const EventEmitter = require('events');

class DisasterRecoveryDrills extends EventEmitter {
    constructor(config = {}) {
        super();
        this.name = 'DisasterRecoveryDrills';
        this.config = {
            enabled: true,
            schedule: {
                cron: 'Sun 02:00', // Her pazar gece 02:00
                maxConcurrent: 1,
                autoSkipOnIncident: true
            },
            scenarios: [
                'region-blackout',
                'region-brownout', 
                'db-primary-loss',
                'network-partition',
                'dns-outage',
                'broker-fail',
                'object-store-unavail',
                'featurestore-high-lag'
            ],
            defaults: {
                RTOsec: 300,
                RPOsec: 30,
                stages: ['prewarm', 'inject', 'failover_execute', 'stabilize_verify', 'failback']
            },
            blastRadius: {
                trafficMaxPct: 25,
                tenants: ['sandbox', 'internal'],
                blockWrites: 'on_degrade'
            },
            guards: {
                freezeOnIncident: true,
                abortOnSloBreach: true,
                costBudgetUsdMaxPerHour: 100
            },
            syntheticLoad: {
                enabled: true,
                rps: 120,
                pattern: 'steady'
            },
            ...config
        };
        
        this.isInitialized = false;
        this.logger = null;
        this.eventBus = null;
        
        // Operational state
        this.state = {
            activeDrills: new Map(),
            drillHistory: [],
            lastDrillTs: null,
            scenarioCatalog: new Map(),
            guardChecks: {
                activeIncidents: false,
                changeFreeze: false,
                sloBudgetOk: true,
                costBudgetOk: true
            }
        };
        
        this.metrics = {
            drillsExecuted: 0,
            drillsPassed: 0,
            drillsFailed: 0,
            avgRTOsec: 0,
            avgRPOsec: 0,
            dataLossEvents: 0,
            abortedDrills: 0
        };
    }

    async initialize(logger, eventBus) {
        try {
            this.logger = logger;
            this.eventBus = eventBus;
            this.logger.info(`${this.name} başlatılıyor...`);
            
            await this.setupEventHandlers();
            await this.initializeScenarioCatalog();
            await this.schedulePeriodicDrills();
            
            this.isInitialized = true;
            this.logger.info(`${this.name} başarıyla başlatıldı`);
            return true;
        } catch (error) {
            this.logger.error(`${this.name} başlatma hatası:`, error);
            return false;
        }
    }

    async setupEventHandlers() {
        if (!this.eventBus) return;

        // Drill management events
        this.eventBus.on('drill.request', (data) => {
            this.handleDrillRequest(data);
        });
        
        this.eventBus.on('drill.cancel.request', (data) => {
            this.handleDrillCancelRequest(data);
        });
        
        // Chaos injection results
        this.eventBus.on('chaos.inject.result', (data) => {
            this.handleChaosInjectResult(data);
        });
        
        // MRF state updates
        this.eventBus.on('mrf.state.update', (data) => {
            this.handleMrfStateUpdate(data);
        });
        
        // Health monitoring
        this.eventBus.on('service.health.probe', (data) => {
            this.handleHealthProbe(data);
        });
        
        this.eventBus.on('datastore.replica.lag', (data) => {
            this.handleReplicaLag(data);
        });
        
        // Guard events
        this.eventBus.on('slo.guard.triggered', (data) => {
            this.handleSloGuardTriggered(data);
        });
        
        this.eventBus.on('cost.guard.triggered', (data) => {
            this.handleCostGuardTriggered(data);
        });
        
        this.eventBus.on('incident.started', (data) => {
            this.handleIncidentStarted(data);
        });
        
        this.eventBus.on('incident.closed', (data) => {
            this.handleIncidentClosed(data);
        });
    }

    async initializeScenarioCatalog() {
        // Register default DR drill scenarios
        const scenarios = [
            {
                scenarioId: 'region-blackout-eu',
                title: 'Region Blackout — EU → US failover',
                topology: 'active-passive',
                stages: this.config.defaults.stages,
                slo: { RTOsec: 300, RPOsec: 30 },
                blastRadius: { trafficMaxPct: 25, tenants: ['sandbox', 'internal'] },
                guards: { freezeOnIncident: true, abortOnSloBreach: true }
            },
            {
                scenarioId: 'db-primary-loss',
                title: 'Database Primary Loss — Promote Secondary',
                topology: 'active-passive',
                stages: ['prewarm', 'inject_db_failure', 'promote_secondary', 'verify', 'restore'],
                slo: { RTOsec: 180, RPOsec: 15 },
                blastRadius: { trafficMaxPct: 10, tenants: ['internal'] },
                guards: { freezeOnIncident: true, abortOnSloBreach: true }
            },
            {
                scenarioId: 'network-partition',
                title: 'Network Partition — Split Brain Prevention',
                topology: 'active-active',
                stages: ['prewarm', 'inject_partition', 'quorum_validation', 'fence_minority', 'verify'],
                slo: { RTOsec: 120, RPOsec: 10 },
                blastRadius: { trafficMaxPct: 15, tenants: ['sandbox'] },
                guards: { freezeOnIncident: true, abortOnSloBreach: true }
            }
        ];
        
        for (const scenario of scenarios) {
            this.state.scenarioCatalog.set(scenario.scenarioId, scenario);
            
            this.eventBus.emit('drill.catalog.registered', {
                event: 'drill.catalog.registered',
                timestamp: new Date().toISOString(),
                ...scenario,
                source: this.name
            });
        }
        
        this.logger.info(`Initialized ${scenarios.length} DR drill scenarios`);
    }

    async schedulePeriodicDrills() {
        // Simplified periodic scheduling - in production would use proper cron
        setInterval(async () => {
            await this.evaluateScheduledDrills();
        }, 24 * 60 * 60 * 1000); // Check daily
        
        this.logger.info('Periodic drill scheduling enabled');
    }

    async evaluateScheduledDrills() {
        if (!this.isInitialized) return;
        
        const now = new Date();
        const isSunday = now.getDay() === 0;
        const isNightlyWindow = now.getHours() >= 2 && now.getHours() <= 4;
        
        if (isSunday && isNightlyWindow && this.state.activeDrills.size === 0) {
            // Check if we should run a scheduled drill
            const lastDrill = this.state.lastDrillTs ? new Date(this.state.lastDrillTs) : null;
            const daysSinceLastDrill = lastDrill ? 
                (now.getTime() - lastDrill.getTime()) / (24 * 60 * 60 * 1000) : 999;
            
            if (daysSinceLastDrill >= 7) { // Weekly drills
                await this.triggerScheduledDrill();
            }
        }
    }

    async triggerScheduledDrill() {
        // Select a scenario based on rotation
        const scenarios = Array.from(this.state.scenarioCatalog.keys());
        const lastScenarioIndex = this.state.drillHistory.length > 0 ? 
            scenarios.indexOf(this.state.drillHistory[this.state.drillHistory.length - 1].scenarioId) : -1;
        const nextScenarioIndex = (lastScenarioIndex + 1) % scenarios.length;
        const scenarioId = scenarios[nextScenarioIndex];
        
        await this.handleDrillRequest({
            event: 'drill.request',
            timestamp: new Date().toISOString(),
            scenarioId,
            schedule: { 
                at: new Date().toISOString(),
                windowMin: 60 
            },
            env: 'prod',
            dryRun: false,
            syntheticLoad: this.config.syntheticLoad,
            evidenceProfile: 'internal',
            notes: 'Scheduled weekly DR drill'
        });
    }

    async handleDrillRequest(data) {
        if (!this.isInitialized) return;
        
        const { scenarioId, schedule, env, dryRun, syntheticLoad, notes } = data;
        
        this.logger.info(`DR drill requested: ${scenarioId}, env: ${env}, dryRun: ${dryRun}`);
        
        // Check guards before starting
        const guardResult = await this.evaluateGuards(scenarioId);
        if (!guardResult.ok) {
            this.logger.warn(`Drill blocked by guards: ${guardResult.reason}`);
            
            this.eventBus.emit('drill.alert', {
                event: 'drill.alert',
                timestamp: new Date().toISOString(),
                level: 'warn',
                message: 'guard_abort',
                context: { scenarioId, reason: guardResult.reason },
                source: this.name
            });
            return;
        }
        
        // Create drill execution plan
        const scenario = this.state.scenarioCatalog.get(scenarioId);
        if (!scenario) {
            this.logger.error(`Unknown drill scenario: ${scenarioId}`);
            return;
        }
        
        const drillKey = `${scenarioId}#${schedule.at}`;
        const drill = {
            drillKey,
            scenarioId,
            scenario,
            env,
            dryRun,
            syntheticLoad,
            notes,
            startedAt: new Date().toISOString(),
            currentStage: null,
            stageProgress: {},
            guards: guardResult.checks,
            results: {
                RTOsecObserved: null,
                RPOsecObserved: null,
                dataLossBytes: 0,
                score: null,
                findings: []
            }
        };
        
        this.state.activeDrills.set(drillKey, drill);
        
        // Emit drill plan
        this.eventBus.emit('drill.plan.ready', {
            event: 'drill.plan.ready',
            timestamp: new Date().toISOString(),
            drillKey,
            stages: scenario.stages,
            blastRadius: scenario.blastRadius,
            guards: scenario.guards,
            hash: this.hashObject(scenario),
            source: this.name
        });
        
        // Start drill execution
        await this.executeDrill(drill);
    }

    async evaluateGuards(scenarioId) {
        const checks = {
            changeFreeze: this.state.guardChecks.changeFreeze,
            activeIncident: this.state.guardChecks.activeIncidents,
            rbac: true, // Simplified - would check actual RBAC
            sloBudgetOk: this.state.guardChecks.sloBudgetOk,
            costBudgetOk: this.state.guardChecks.costBudgetOk
        };
        
        const blockers = Object.entries(checks)
            .filter(([key, value]) => !value)
            .map(([key]) => key);
        
        const ok = blockers.length === 0;
        const reason = blockers.length > 0 ? blockers.join(', ') : null;
        
        this.eventBus.emit('drill.guard.snapshot', {
            event: 'drill.guard.snapshot',
            timestamp: new Date().toISOString(),
            status: ok ? 'ok' : 'abort',
            checks,
            source: this.name
        });
        
        return { ok, reason, checks };
    }

    async executeDrill(drill) {
        this.logger.info(`Executing drill: ${drill.drillKey}`);
        
        try {
            this.eventBus.emit('drill.started', {
                event: 'drill.started',
                timestamp: new Date().toISOString(),
                scenarioId: drill.scenarioId,
                env: drill.env,
                syntheticLoad: drill.syntheticLoad,
                source: this.name
            });
            
            const drillStartTime = Date.now();
            
            // Execute each stage
            for (const stageName of drill.scenario.stages) {
                drill.currentStage = stageName;
                
                this.logger.info(`Executing drill stage: ${stageName}`);
                
                await this.executeDrillStage(drill, stageName);
                
                // Update progress
                const stageIndex = drill.scenario.stages.indexOf(stageName);
                const progressPct = Math.round(((stageIndex + 1) / drill.scenario.stages.length) * 100);
                
                this.eventBus.emit('drill.stage.progress', {
                    event: 'drill.stage.progress',
                    timestamp: new Date().toISOString(),
                    stage: stageName,
                    progressPct,
                    notes: drill.stageProgress[stageName]?.notes || '',
                    source: this.name
                });
                
                // Check guards between stages
                if (stageName !== drill.scenario.stages[drill.scenario.stages.length - 1]) {
                    const guardCheck = await this.evaluateGuards(drill.scenarioId);
                    if (!guardCheck.ok && this.config.guards.abortOnSloBreach) {
                        throw new Error(`Drill aborted due to guard failure: ${guardCheck.reason}`);
                    }
                }
            }
            
            // Calculate final results
            const drillDuration = Date.now() - drillStartTime;
            drill.results.RTOsecObserved = Math.round(drillDuration / 1000);
            drill.results.RPOsecObserved = drill.stageProgress.measured_rpo || 0;
            
            // Score the drill
            await this.scoreDrill(drill);
            
            // Generate findings
            await this.generateFindings(drill);
            
            // Mark as completed
            drill.completedAt = new Date().toISOString();
            drill.status = 'completed';
            
            this.metrics.drillsExecuted++;
            if (drill.results.score >= 70) {
                this.metrics.drillsPassed++;
            } else {
                this.metrics.drillsFailed++;
            }
            
            // Update metrics
            this.updateDrillMetrics(drill);
            
            // Generate report
            await this.generateDrillReport(drill);
            
            this.logger.info(`Drill completed successfully: ${drill.drillKey}, score: ${drill.results.score}`);
            
        } catch (error) {
            this.logger.error(`Drill execution failed: ${drill.drillKey}`, error);
            
            drill.status = 'failed';
            drill.error = error.message;
            this.metrics.abortedDrills++;
            
            this.eventBus.emit('drill.alert', {
                event: 'drill.alert',
                timestamp: new Date().toISOString(),
                level: 'error',
                message: 'drill_failed',
                context: { drillKey: drill.drillKey, error: error.message },
                source: this.name
            });
        } finally {
            // Move to history and cleanup
            this.state.drillHistory.push({
                ...drill,
                drillKey: drill.drillKey,
                scenarioId: drill.scenarioId,
                completedAt: drill.completedAt || new Date().toISOString(),
                status: drill.status || 'failed'
            });
            
            this.state.activeDrills.delete(drill.drillKey);
            this.state.lastDrillTs = new Date().toISOString();
        }
    }

    async executeDrillStage(drill, stageName) {
        const stageStart = Date.now();
        
        try {
            switch (stageName) {
                case 'prewarm':
                    await this.executePrewarmStage(drill);
                    break;
                    
                case 'inject':
                case 'inject_blackout':
                case 'inject_db_failure':
                case 'inject_partition':
                    await this.executeChaosInjectionStage(drill, stageName);
                    break;
                    
                case 'failover_execute':
                    await this.executeFailoverStage(drill);
                    break;
                    
                case 'stabilize_verify':
                case 'verify':
                    await this.executeVerificationStage(drill);
                    break;
                    
                case 'failback':
                case 'restore':
                    await this.executeFailbackStage(drill);
                    break;
                    
                default:
                    this.logger.warn(`Unknown drill stage: ${stageName}`);
            }
            
            const stageDuration = Date.now() - stageStart;
            drill.stageProgress[stageName] = {
                status: 'completed',
                durationMs: stageDuration,
                notes: `Completed in ${stageDuration}ms`
            };
            
        } catch (error) {
            drill.stageProgress[stageName] = {
                status: 'failed',
                error: error.message,
                notes: `Failed: ${error.message}`
            };
            throw error;
        }
    }

    async executePrewarmStage(drill) {
        // Start synthetic load generation
        if (drill.syntheticLoad?.enabled) {
            this.eventBus.emit('synthetic.load.started', {
                event: 'synthetic.load.started',
                timestamp: new Date().toISOString(),
                rps: drill.syntheticLoad.rps,
                pattern: drill.syntheticLoad.pattern,
                headers: { 'x-drill': 'true' },
                source: this.name
            });
        }
        
        // Wait for baseline establishment
        await this.sleep(10000);
    }

    async executeChaosInjectionStage(drill, stageName) {
        const injectionMap = {
            'inject_blackout': 'region_blackout',
            'inject_db_failure': 'db_primary_loss',
            'inject_partition': 'network_partition'
        };
        
        const injectionType = injectionMap[stageName] || 'custom';
        
        // Simulate chaos injection
        this.eventBus.emit('chaos.inject.request', {
            event: 'chaos.inject.request',
            timestamp: new Date().toISOString(),
            stage: stageName,
            tool: 'simulated',
            targets: drill.scenario.topology === 'active-passive' ? ['eu-central'] : ['eu-central', 'us-east'],
            durationSec: 90,
            dryRun: drill.dryRun,
            source: this.name
        });
        
        // Wait for injection to take effect
        await this.sleep(5000);
        
        // Simulate injection result
        this.eventBus.emit('chaos.inject.result', {
            event: 'chaos.inject.result',
            timestamp: new Date().toISOString(),
            stage: stageName,
            tool: 'simulated',
            success: true,
            details: { 
                targets: ['eu-central'], 
                durationSec: 90,
                injectionType
            },
            source: this.name
        });
    }

    async executeFailoverStage(drill) {
        // Trigger MRF failover through event
        this.eventBus.emit('failover.plan.request', {
            event: 'failover.plan.request',
            timestamp: new Date().toISOString(),
            reason: 'drill',
            targetRegion: 'us-east',
            scope: 'service',
            dryRun: drill.dryRun,
            source: this.name
        });
        
        // Wait for failover completion
        await this.sleep(15000);
    }

    async executeVerificationStage(drill) {
        // Measure current state
        const verificationStart = Date.now();
        
        // Simulate health checks
        await this.sleep(5000);
        
        const verificationDuration = Date.now() - verificationStart;
        
        // Generate verification snapshot
        this.eventBus.emit('drill.verify.snapshot', {
            event: 'drill.verify.snapshot',
            timestamp: new Date().toISOString(),
            RTOsecObserved: Math.round(verificationDuration / 1000),
            RPOsecObserved: 14, // Simulated
            dataLossBytes: 0,
            errPct: '<=1%',
            p95Ms: 118,
            brokerUnderReplicated: 0,
            status: 'pass',
            source: this.name
        });
        
        drill.stageProgress.measured_rpo = 14;
    }

    async executeFailbackStage(drill) {
        // Simulate failback process
        this.eventBus.emit('failback.plan.request', {
            event: 'failback.plan.request',
            timestamp: new Date().toISOString(),
            targetRegion: 'eu-central',
            reason: 'drill_completion',
            dryRun: drill.dryRun,
            source: this.name
        });
        
        await this.sleep(10000);
        
        // Stop synthetic load
        if (drill.syntheticLoad?.enabled) {
            this.eventBus.emit('synthetic.load.stopped', {
                event: 'synthetic.load.stopped',
                timestamp: new Date().toISOString(),
                source: this.name
            });
        }
    }

    async scoreDrill(drill) {
        const scenario = drill.scenario;
        const results = drill.results;
        
        // RTO scoring (30 points max)
        const rtoScore = Math.min(30, 
            30 * (scenario.slo.RTOsec / Math.max(results.RTOsecObserved, scenario.slo.RTOsec))
        );
        
        // RPO scoring (30 points max)
        const rpoScore = Math.min(30,
            30 * (scenario.slo.RPOsec / Math.max(results.RPOsecObserved || 1, scenario.slo.RPOsec))
        );
        
        // Runbook execution (20 points)
        const completedStages = Object.values(drill.stageProgress).filter(p => p.status === 'completed').length;
        const runbookScore = Math.round((completedStages / scenario.stages.length) * 20);
        
        // Observability (10 points) - simplified
        const observabilityScore = 10; // Assume good observability
        
        // Automation (10 points) - simplified
        const automationScore = drill.dryRun ? 5 : 10; // Less points for dry run
        
        const totalScore = Math.round(rtoScore + rpoScore + runbookScore + observabilityScore + automationScore);
        
        results.score = {
            total: totalScore,
            RTO: Math.round(rtoScore),
            RPO: Math.round(rpoScore),
            Runbook: runbookScore,
            Observability: observabilityScore,
            Automation: automationScore
        };
        
        results.level = totalScore >= 90 ? 'green' : (totalScore >= 70 ? 'yellow' : 'red');
        
        this.eventBus.emit('drill.scoring.ready', {
            event: 'drill.scoring.ready',
            timestamp: new Date().toISOString(),
            score: results.score,
            level: results.level,
            source: this.name
        });
    }

    async generateFindings(drill) {
        const findings = [];
        
        // Check for specific issues
        if (drill.results.RTOsecObserved > drill.scenario.slo.RTOsec) {
            findings.push({
                severity: 'high',
                title: 'RTO budget exceeded',
                action: `Optimize failover automation to meet ${drill.scenario.slo.RTOsec}s target`
            });
        }
        
        if (drill.results.RPOsecObserved > drill.scenario.slo.RPOsec) {
            findings.push({
                severity: 'medium',
                title: 'RPO budget exceeded',
                action: 'Improve replication lag monitoring and sync procedures'
            });
        }
        
        // Check stage durations
        const slowStages = Object.entries(drill.stageProgress)
            .filter(([stage, progress]) => progress.durationMs > 30000)
            .map(([stage]) => stage);
        
        if (slowStages.length > 0) {
            findings.push({
                severity: 'medium',
                title: `Slow drill stages: ${slowStages.join(', ')}`,
                action: 'Review and optimize slow stages for production readiness'
            });
        }
        
        drill.results.findings = findings;
        
        this.eventBus.emit('drill.findings.ready', {
            event: 'drill.findings.ready',
            timestamp: new Date().toISOString(),
            items: findings,
            source: this.name
        });
        
        // Generate remediation plan
        const tasks = findings.map((finding, index) => ({
            id: `rem-${index + 1}`,
            owner: finding.severity === 'high' ? 'resilience' : 'platform',
            desc: finding.action,
            etaDays: finding.severity === 'high' ? 3 : 7
        }));
        
        this.eventBus.emit('drill.remediation.plan.ready', {
            event: 'drill.remediation.plan.ready',
            timestamp: new Date().toISOString(),
            tasks,
            source: this.name
        });
    }

    async generateDrillReport(drill) {
        const reportPath = `data/drills/${new Date().toISOString().split('T')[0]}/${drill.scenarioId}/report.md`;
        
        const summary = `RTO ${drill.results.RTOsecObserved}s, RPO ${drill.results.RPOsecObserved}s, ` +
                       `data loss ${drill.results.dataLossBytes}, score ${drill.results.score.total}/100; ` +
                       `${drill.results.findings.length} findings`;
        
        this.eventBus.emit('drill.report.ready', {
            event: 'drill.report.ready',
            timestamp: new Date().toISOString(),
            path: reportPath,
            summary,
            hash: this.hashObject(drill.results),
            source: this.name
        });
        
        // Generate UI card
        this.eventBus.emit('drill.card', {
            event: 'drill.card',
            timestamp: new Date().toISOString(),
            title: `DR Drill Completed — ${drill.scenario.title}`,
            body: `RTO ${drill.results.RTOsecObserved}s • RPO ${drill.results.RPOsecObserved}s • ` +
                  `Score ${drill.results.score.total} • ${drill.results.dataLossBytes} data loss • ` +
                  `${drill.results.findings.length} findings`,
            severity: drill.results.level === 'red' ? 'warn' : 'info',
            ttlSec: 900,
            source: this.name
        });
    }

    updateDrillMetrics(drill) {
        // Update running averages
        const count = this.metrics.drillsExecuted;
        this.metrics.avgRTOsec = Math.round(
            (this.metrics.avgRTOsec * (count - 1) + drill.results.RTOsecObserved) / count
        );
        this.metrics.avgRPOsec = Math.round(
            (this.metrics.avgRPOsec * (count - 1) + drill.results.RPOsecObserved) / count
        );
        
        if (drill.results.dataLossBytes > 0) {
            this.metrics.dataLossEvents++;
        }
    }

    async handleDrillCancelRequest(data) {
        const { reason } = data;
        
        for (const [drillKey, drill] of this.state.activeDrills) {
            drill.status = 'cancelled';
            drill.cancelReason = reason;
            
            this.logger.info(`Drill cancelled: ${drillKey}, reason: ${reason}`);
            
            this.eventBus.emit('drill.alert', {
                event: 'drill.alert',
                timestamp: new Date().toISOString(),
                level: 'info',
                message: 'drill_cancelled',
                context: { drillKey, reason },
                source: this.name
            });
            
            this.state.activeDrills.delete(drillKey);
        }
    }

    async handleChaosInjectResult(data) {
        // Update active drills with chaos injection results
        for (const drill of this.state.activeDrills.values()) {
            if (drill.currentStage?.includes('inject')) {
                drill.stageProgress[drill.currentStage] = {
                    ...drill.stageProgress[drill.currentStage],
                    chaosResult: data
                };
            }
        }
    }

    async handleMrfStateUpdate(data) {
        // Track MRF progress during drills
        for (const drill of this.state.activeDrills.values()) {
            if (drill.currentStage === 'failover_execute') {
                drill.stageProgress[drill.currentStage] = {
                    ...drill.stageProgress[drill.currentStage],
                    mrfProgress: data.progressPct || 0,
                    mrfPhase: data.phase
                };
            }
        }
    }

    async handleHealthProbe(data) {
        // Monitor health during drills for verification
        for (const drill of this.state.activeDrills.values()) {
            if (drill.currentStage === 'stabilize_verify' || drill.currentStage === 'verify') {
                if (!drill.stageProgress[drill.currentStage]) {
                    drill.stageProgress[drill.currentStage] = {};
                }
                drill.stageProgress[drill.currentStage].healthProbes = 
                    drill.stageProgress[drill.currentStage].healthProbes || [];
                drill.stageProgress[drill.currentStage].healthProbes.push(data);
            }
        }
    }

    async handleReplicaLag(data) {
        // Track replication lag during drills for RPO measurement
        for (const drill of this.state.activeDrills.values()) {
            if (drill.stageProgress.measured_rpo === null || data.lagSec > drill.stageProgress.measured_rpo) {
                drill.stageProgress.measured_rpo = data.lagSec;
            }
        }
    }

    async handleSloGuardTriggered(data) {
        this.state.guardChecks.sloBudgetOk = false;
        
        // Check if we should abort active drills
        if (this.config.guards.abortOnSloBreach) {
            for (const drill of this.state.activeDrills.values()) {
                this.logger.warn(`Aborting drill ${drill.drillKey} due to SLO breach`);
                await this.handleDrillCancelRequest({ reason: 'slo_breach' });
            }
        }
    }

    async handleCostGuardTriggered(data) {
        this.state.guardChecks.costBudgetOk = false;
        
        if (data.deltaUSDPerHour > this.config.guards.costBudgetUsdMaxPerHour) {
            for (const drill of this.state.activeDrills.values()) {
                this.logger.warn(`Aborting drill ${drill.drillKey} due to cost budget breach`);
                await this.handleDrillCancelRequest({ reason: 'cost_budget_exceeded' });
            }
        }
    }

    async handleIncidentStarted(data) {
        this.state.guardChecks.activeIncidents = true;
        
        if (this.config.guards.freezeOnIncident) {
            for (const drill of this.state.activeDrills.values()) {
                this.logger.warn(`Aborting drill ${drill.drillKey} due to active incident: ${data.id}`);
                await this.handleDrillCancelRequest({ reason: 'active_incident' });
            }
        }
    }

    async handleIncidentClosed(data) {
        // Reset incident guard when all incidents are closed
        // In a real implementation, would check if ANY incidents are still active
        this.state.guardChecks.activeIncidents = false;
    }

    hashObject(obj) {
        // Simple hash function for objects
        return require('crypto').createHash('sha256')
            .update(JSON.stringify(obj))
            .digest('hex').substring(0, 16);
    }

    getStatus() {
        return {
            name: this.name,
            initialized: this.isInitialized,
            enabled: this.config.enabled,
            state: {
                activeDrills: this.state.activeDrills.size,
                totalScenarios: this.state.scenarioCatalog.size,
                lastDrill: this.state.lastDrillTs,
                guardChecks: this.state.guardChecks
            },
            metrics: this.metrics
        };
    }

    async getMetrics() {
        if (!this.isInitialized) return null;

        return {
            event: 'drill.metrics',
            timestamp: new Date().toISOString(),
            drills: this.metrics.drillsExecuted,
            passes: this.metrics.drillsPassed,
            fails: this.metrics.drillsFailed,
            avgRTOsec: this.metrics.avgRTOsec,
            avgRPOsec: this.metrics.avgRPOsec,
            dataLossBytes: this.metrics.dataLossEvents,
            aborts: this.metrics.abortedDrills,
            activeDrills: this.state.activeDrills.size,
            source: this.name
        };
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async shutdown() {
        try {
            this.logger.info(`${this.name} durduruluyor...`);
            
            // Cancel any active drills
            for (const drillKey of this.state.activeDrills.keys()) {
                await this.handleDrillCancelRequest({ reason: 'system_shutdown' });
            }
            
            this.isInitialized = false;
            this.removeAllListeners();
            this.logger.info(`${this.name} başarıyla durduruldu`);
        } catch (error) {
            this.logger.error(`${this.name} durdurma hatası:`, error);
        }
    }
}

module.exports = DisasterRecoveryDrills;