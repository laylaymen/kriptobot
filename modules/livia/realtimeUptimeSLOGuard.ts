/**
 * LIVIA-32: Realtime Uptime SLO Guard
 * Canlı besleme/servislerin uptime & tazelik SLO'larını anlık izleyip burn-rate üzerinden erken uyarı ve otomatik koruma uygular
 */

import { z } from 'zod';
import { EventEmitter } from 'events';
import crypto from 'crypto';

// Input schemas
const ProbeHttpResultSchema = z.object({
    event: z.literal('probe.http.result'),
    timestamp: z.string(),
    serviceId: z.enum(['order_api', 'auth_api', 'kb_api', 'feed_ws', 'feed_rest']),
    endpoint: z.string(),
    ok: z.boolean(),
    status: z.number(),
    latencyMs: z.number()
}).strict();

const FeedTickSchema = z.object({
    event: z.literal('feed.tick'),
    timestamp: z.string(),
    serviceId: z.string(),
    symbol: z.string(),
    lagMs: z.number(),
    gapMs: z.number()
}).strict();

const HeartbeatMissedSchema = z.object({
    event: z.literal('heartbeat.missed'),
    timestamp: z.string(),
    serviceId: z.string(),
    missedCount: z.number(),
    expectedEveryMs: z.number()
}).strict();

const ErrorEventSchema = z.object({
    event: z.literal('error.event'),
    timestamp: z.string(),
    serviceId: z.string(),
    kind: z.enum(['5xx', 'timeout', 'circuit_open']),
    details: z.string(),
    count: z.number()
}).strict();

const CircuitStateSchema = z.object({
    event: z.literal('circuit.state'),
    timestamp: z.string(),
    serviceId: z.string(),
    state: z.enum(['open', 'half_open', 'closed']),
    reason: z.string()
}).strict();

const FailoverDoneSchema = z.object({
    event: z.literal('failover.done'),
    timestamp: z.string(),
    serviceId: z.string(),
    from: z.string(),
    to: z.string(),
    latencyImpactMs: z.number()
}).strict();

const TelemetrySloStatusSchema = z.object({
    event: z.literal('telemetry.slo.status'),
    timestamp: z.string(),
    slo: z.enum(['uptime_feed', 'uptime_order_api', 'data_freshness', 'latency_p95']),
    state: z.enum(['ok', 'at_risk', 'breach']),
    window: z.enum(['5m', '1h', '6h', '24h']),
    burnPct: z.number()
}).strict();

// Output schemas
const SloGuardTriggeredSchema = z.object({
    event: z.literal('slo.guard.triggered'),
    timestamp: z.string(),
    serviceId: z.string(),
    slo: z.string(),
    windows: z.record(z.object({
        avail: z.number(),
        burn: z.number()
    })),
    trigger: z.string(),
    actionPlan: z.object({
        failover: z.string().optional(),
        degrade: z.array(z.string()).optional(),
        gate: z.string().optional()
    }),
    severity: z.enum(['high', 'medium', 'low']),
    hash: z.string()
}).strict();

const SloGuardRecoveredSchema = z.object({
    event: z.literal('slo.guard.recovered'),
    timestamp: z.string(),
    serviceId: z.string(),
    slo: z.string(),
    since: z.string(),
    durationMin: z.number(),
    actionsReverted: z.array(z.string()),
    failback: z.string().optional()
}).strict();

const SloGuardEarlyWarnSchema = z.object({
    event: z.literal('slo.guard.earlywarn'),
    timestamp: z.string(),
    serviceId: z.string(),
    slo: z.string(),
    windows: z.record(z.object({
        avail: z.number(),
        burn: z.number()
    })),
    hint: z.string()
}).strict();

const SloGuardCardSchema = z.object({
    event: z.literal('slo.guard.card'),
    timestamp: z.string(),
    title: z.string(),
    body: z.string(),
    severity: z.enum(['info', 'warn', 'error']),
    ttlSec: z.number()
}).strict();

const SloGuardAlertSchema = z.object({
    event: z.literal('slo.guard.alert'),
    timestamp: z.string(),
    level: z.enum(['info', 'warn', 'error']),
    message: z.string()
}).strict();

const SloGuardMetricsSchema = z.object({
    event: z.literal('slo.guard.metrics'),
    timestamp: z.string(),
    evaluated: z.number(),
    triggers: z.number(),
    recoveries: z.number(),
    earlyWarn: z.number(),
    p95EvalMs: z.number(),
    failovers: z.number(),
    gates: z.number(),
    degrades: z.number()
}).strict();

type WindowKey = '5m' | '1h' | '6h' | '24h';
type ServiceState = 'IDLE' | 'EVAL' | 'TRIGGER' | 'ENFORCE' | 'MONITOR' | 'RECOVER';

interface WindowMetrics {
    totalSamples: number;
    okSamples: number;
    errorSamples: number;
    latencySum: number;
    latencyP95: number;
    lagSum: number;
    lagP95: number;
    freshnessMiss: number;
    firstSampleTime: number;
    lastSampleTime: number;
}

interface ServiceSLO {
    serviceId: string;
    sloTargets: {
        uptime: number;
        freshnessLagMsP95?: number;
        latencyP95Ms?: number;
    };
    errorBudgetDays: number;
    windows: WindowKey[];
    burnThresholds: Record<WindowKey, number>;
    actions: {
        failover?: { to: string };
        degrade?: { drop: string[] };
        gate?: { type: string; perMin?: number; dropPct?: number };
        circuit?: { policy: string };
    };
}

interface ActiveAction {
    type: 'failover' | 'degrade' | 'gate' | 'circuit';
    appliedAt: string;
    params: any;
    guardKey: string;
}

interface ServiceMetrics {
    windows: Map<WindowKey, WindowMetrics>;
    state: ServiceState;
    lastEval: string;
    activeActions: Map<string, ActiveAction>;
    triggerCount: number;
    recoveryCount: number;
    earlyWarnCount: number;
    stableMinutes: number;
    stableSince?: string;
}

class RealtimeUptimeSLOGuard extends EventEmitter {
    private eventBus: any;
    private logger: any;
    private name: string = 'RealtimeUptimeSLOGuard';
    private config: any;
    private state: {
        status: string;
        services: Map<string, ServiceMetrics>;
        evaluationCount: number;
        totalTriggers: number;
        totalRecoveries: number;
        totalEarlyWarns: number;
        p95EvalMs: number;
        lastEvalTimes: number[];
        sloConfigs: Map<string, ServiceSLO>;
        activeGuards: Map<string, string>; // guardKey -> serviceId
    };
    private isInitialized: boolean = false;

    constructor(eventBus: any, logger: any, config: any = {}) {
        super();
        this.eventBus = eventBus;
        this.logger = logger;
        
        this.config = {
            i18n: { locale: 'tr-TR', tz: 'Europe/Istanbul' },
            services: {
                feed_ws: {
                    sloTargets: { uptime: 99.9, freshnessLagMsP95: 800 },
                    errorBudgetDays: 30,
                    windows: ['5m', '1h', '6h', '24h'] as WindowKey[],
                    burnThresholds: { '5m': 14.4, '1h': 6.0, '6h': 3.0, '24h': 1.0 },
                    actions: {
                        failover: { to: 'secondary' },
                        degrade: { drop: ['optional_metrics', 'low_priority_topics'] },
                        gate: { type: 'rate_limit', perMin: 60 }
                    }
                },
                order_api: {
                    sloTargets: { uptime: 99.95, latencyP95Ms: 900 },
                    errorBudgetDays: 30,
                    windows: ['5m', '1h', '6h', '24h'] as WindowKey[],
                    burnThresholds: { '5m': 10.0, '1h': 5.0, '6h': 2.5, '24h': 1.0 },
                    actions: {
                        circuit: { policy: 'open_on_5xx_spike' },
                        gate: { type: 'shed_load', dropPct: 0.2 },
                        degrade: { drop: ['advanced_routes'] }
                    }
                }
            },
            evaluation: {
                slideEverySec: 5,
                calcMode: 'fast_ewma',
                minSamplesPerWindow: 5,
                freshnessMetric: 'lagMs',
                availabilityFrom: { httpProbe: true, heartbeat: true, errorEvent: true, circuit: true }
            },
            integrations: {
                gate: 'LIVIA-17',
                cooldown: 'LIVIA-16',
                dist: 'LIVIA-22',
                digest: 'LIVIA-14',
                policy: 'LIVIA-23',
                ethics: 'LIVIA-26'
            },
            failover: {
                enable: true,
                prefer: 'secondary',
                autoFailback: true,
                guard: { minStableMin: 10, maxFailoverPerHour: 3 }
            },
            recovery: {
                stableAfterMin: 15,
                revertActions: ['gate', 'degrade'],
                recoveryTimeoutMin: 60
            },
            idempotencyTtlSec: 3600,
            ...config
        };

        this.state = {
            status: 'IDLE',
            services: new Map(),
            evaluationCount: 0,
            totalTriggers: 0,
            totalRecoveries: 0,
            totalEarlyWarns: 0,
            p95EvalMs: 0,
            lastEvalTimes: [],
            sloConfigs: new Map(),
            activeGuards: new Map()
        };
    }

    async initialize(): Promise<boolean> {
        try {
            this.logger.info(`${this.name} başlatılıyor...`);
            
            // Event listeners
            this.eventBus.on('probe.http.result', this.handleProbeHttpResult.bind(this));
            this.eventBus.on('feed.tick', this.handleFeedTick.bind(this));
            this.eventBus.on('heartbeat.missed', this.handleHeartbeatMissed.bind(this));
            this.eventBus.on('error.event', this.handleErrorEvent.bind(this));
            this.eventBus.on('circuit.state', this.handleCircuitState.bind(this));
            this.eventBus.on('failover.done', this.handleFailoverDone.bind(this));
            this.eventBus.on('telemetry.slo.status', this.handleTelemetrySloStatus.bind(this));

            // Initialize SLO configurations
            this.initializeSloConfigs();
            
            // Initialize service metrics
            this.initializeServiceMetrics();
            
            // Start periodic evaluation
            this.startPeriodicEvaluation();
            
            this.isInitialized = true;
            this.logger.info(`${this.name} başarıyla başlatıldı`);
            return true;
        } catch (error) {
            this.logger.error(`${this.name} başlatma hatası:`, error);
            return false;
        }
    }

    private initializeSloConfigs(): void {
        for (const [serviceId, config] of Object.entries(this.config.services)) {
            this.state.sloConfigs.set(serviceId, {
                ...config as ServiceSLO,
                serviceId
            });
        }
        
        this.logger.info(`Initialized SLO configs for ${this.state.sloConfigs.size} services`);
    }

    private initializeServiceMetrics(): void {
        for (const serviceId of this.state.sloConfigs.keys()) {
            const windows = new Map<WindowKey, WindowMetrics>();
            
            const sloConfig = this.state.sloConfigs.get(serviceId)!;
            for (const window of sloConfig.windows) {
                windows.set(window, this.createEmptyWindowMetrics());
            }
            
            this.state.services.set(serviceId, {
                windows,
                state: 'IDLE',
                lastEval: new Date().toISOString(),
                activeActions: new Map(),
                triggerCount: 0,
                recoveryCount: 0,
                earlyWarnCount: 0,
                stableMinutes: 0
            });
        }
        
        this.logger.info(`Initialized metrics for ${this.state.services.size} services`);
    }

    private createEmptyWindowMetrics(): WindowMetrics {
        return {
            totalSamples: 0,
            okSamples: 0,
            errorSamples: 0,
            latencySum: 0,
            latencyP95: 0,
            lagSum: 0,
            lagP95: 0,
            freshnessMiss: 0,
            firstSampleTime: 0,
            lastSampleTime: 0
        };
    }

    private startPeriodicEvaluation(): void {
        const intervalMs = this.config.evaluation.slideEverySec * 1000;
        
        setInterval(() => {
            this.evaluateAllServices();
        }, intervalMs);
        
        this.logger.info(`Started periodic evaluation every ${this.config.evaluation.slideEverySec}s`);
    }

    private handleProbeHttpResult(data: any): void {
        try {
            const validated = ProbeHttpResultSchema.parse(data);
            this.recordSample(validated.serviceId, 'probe', {
                ok: validated.ok,
                latencyMs: validated.latencyMs,
                timestamp: validated.timestamp
            });
        } catch (error) {
            this.logger.error('Probe HTTP result validation error:', error);
        }
    }

    private handleFeedTick(data: any): void {
        try {
            const validated = FeedTickSchema.parse(data);
            this.recordSample(validated.serviceId, 'feed', {
                ok: true,
                lagMs: validated.lagMs,
                gapMs: validated.gapMs,
                timestamp: validated.timestamp
            });
        } catch (error) {
            this.logger.error('Feed tick validation error:', error);
        }
    }

    private handleHeartbeatMissed(data: any): void {
        try {
            const validated = HeartbeatMissedSchema.parse(data);
            this.recordSample(validated.serviceId, 'heartbeat', {
                ok: false,
                missedCount: validated.missedCount,
                timestamp: validated.timestamp
            });
        } catch (error) {
            this.logger.error('Heartbeat missed validation error:', error);
        }
    }

    private handleErrorEvent(data: any): void {
        try {
            const validated = ErrorEventSchema.parse(data);
            this.recordSample(validated.serviceId, 'error', {
                ok: false,
                kind: validated.kind,
                count: validated.count,
                timestamp: validated.timestamp
            });
        } catch (error) {
            this.logger.error('Error event validation error:', error);
        }
    }

    private handleCircuitState(data: any): void {
        try {
            const validated = CircuitStateSchema.parse(data);
            this.recordSample(validated.serviceId, 'circuit', {
                ok: validated.state === 'closed',
                state: validated.state,
                reason: validated.reason,
                timestamp: validated.timestamp
            });
        } catch (error) {
            this.logger.error('Circuit state validation error:', error);
        }
    }

    private handleFailoverDone(data: any): void {
        try {
            const validated = FailoverDoneSchema.parse(data);
            this.logger.info(`Failover completed: ${validated.serviceId} ${validated.from} → ${validated.to}`);
            
            // Update active actions
            const serviceMetrics = this.state.services.get(validated.serviceId);
            if (serviceMetrics) {
                serviceMetrics.activeActions.set('failover', {
                    type: 'failover',
                    appliedAt: validated.timestamp,
                    params: { from: validated.from, to: validated.to },
                    guardKey: this.generateGuardKey(validated.serviceId, 'failover', validated.timestamp)
                });
            }
        } catch (error) {
            this.logger.error('Failover done validation error:', error);
        }
    }

    private handleTelemetrySloStatus(data: any): void {
        try {
            const validated = TelemetrySloStatusSchema.parse(data);
            this.logger.debug(`SLO status update: ${validated.slo} - ${validated.state} (${validated.burnPct}% burn)`);
        } catch (error) {
            this.logger.error('Telemetry SLO status validation error:', error);
        }
    }

    private recordSample(serviceId: string, source: string, sample: any): void {
        const serviceMetrics = this.state.services.get(serviceId);
        if (!serviceMetrics) {
            this.logger.warn(`Unknown service: ${serviceId}`);
            return;
        }

        const now = Date.now();
        const sloConfig = this.state.sloConfigs.get(serviceId)!;

        // Update all windows for this service
        for (const window of sloConfig.windows) {
            const windowMetrics = serviceMetrics.windows.get(window)!;
            this.updateWindowMetrics(windowMetrics, sample, window, now);
        }

        this.logger.debug(`Sample recorded for ${serviceId} from ${source}: ${JSON.stringify(sample)}`);
    }

    private updateWindowMetrics(metrics: WindowMetrics, sample: any, window: WindowKey, now: number): void {
        // Simple sliding window implementation
        const windowMs = this.getWindowDurationMs(window);
        
        // Initialize if first sample
        if (metrics.firstSampleTime === 0) {
            metrics.firstSampleTime = now;
        }
        
        metrics.lastSampleTime = now;
        metrics.totalSamples++;
        
        if (sample.ok) {
            metrics.okSamples++;
        } else {
            metrics.errorSamples++;
        }
        
        // Update latency metrics
        if (sample.latencyMs !== undefined) {
            metrics.latencySum += sample.latencyMs;
            // Simplified P95 calculation (in real implementation, use histogram)
            metrics.latencyP95 = Math.max(metrics.latencyP95, sample.latencyMs);
        }
        
        // Update lag/freshness metrics
        if (sample.lagMs !== undefined) {
            metrics.lagSum += sample.lagMs;
            metrics.lagP95 = Math.max(metrics.lagP95, sample.lagMs);
            
            // Check freshness threshold
            const sloConfig = this.state.sloConfigs.get(sample.serviceId);
            if (sloConfig && sloConfig.sloTargets.freshnessLagMsP95) {
                if (sample.lagMs > sloConfig.sloTargets.freshnessLagMsP95) {
                    metrics.freshnessMiss++;
                }
            }
        }
        
        // Cleanup old samples (simplified - in real implementation, use circular buffer)
        const cutoffTime = now - windowMs;
        if (metrics.firstSampleTime < cutoffTime) {
            // Reset metrics periodically to approximate sliding window
            if (metrics.totalSamples > 1000) {
                this.resetWindowMetrics(metrics);
            }
        }
    }

    private getWindowDurationMs(window: WindowKey): number {
        const durations = {
            '5m': 5 * 60 * 1000,
            '1h': 60 * 60 * 1000,
            '6h': 6 * 60 * 60 * 1000,
            '24h': 24 * 60 * 60 * 1000
        };
        return durations[window];
    }

    private resetWindowMetrics(metrics: WindowMetrics): void {
        // Keep some history to maintain approximation
        metrics.totalSamples = Math.floor(metrics.totalSamples * 0.1);
        metrics.okSamples = Math.floor(metrics.okSamples * 0.1);
        metrics.errorSamples = Math.floor(metrics.errorSamples * 0.1);
        metrics.latencySum = metrics.latencySum * 0.1;
        metrics.lagSum = metrics.lagSum * 0.1;
        metrics.freshnessMiss = Math.floor(metrics.freshnessMiss * 0.1);
        metrics.firstSampleTime = Date.now();
    }

    private evaluateAllServices(): void {
        const evalStartTime = Date.now();
        
        for (const [serviceId, serviceMetrics] of this.state.services) {
            try {
                this.evaluateService(serviceId, serviceMetrics);
            } catch (error) {
                this.logger.error(`Service evaluation error for ${serviceId}:`, error);
                this.emitAlert('error', `service_eval_failed: ${serviceId}`);
            }
        }
        
        // Update evaluation metrics
        const evalTime = Date.now() - evalStartTime;
        this.updateEvalMetrics(evalTime);
        this.state.evaluationCount++;
        
        // Emit periodic metrics
        if (this.state.evaluationCount % 60 === 0) { // Every 5 minutes
            this.emitMetrics();
        }
    }

    private evaluateService(serviceId: string, serviceMetrics: ServiceMetrics): void {
        const sloConfig = this.state.sloConfigs.get(serviceId)!;
        const now = new Date().toISOString();
        
        // Advance FSM state
        const newState = this.advanceServiceState(serviceId, serviceMetrics, sloConfig, now);
        
        if (newState !== serviceMetrics.state) {
            this.logger.info(`Service ${serviceId} state: ${serviceMetrics.state} → ${newState}`);
            serviceMetrics.state = newState;
        }
        
        serviceMetrics.lastEval = now;
    }

    private advanceServiceState(serviceId: string, metrics: ServiceMetrics, config: ServiceSLO, now: string): ServiceState {
        const currentState = metrics.state;
        
        switch (currentState) {
            case 'IDLE':
                // Check if we should evaluate
                const evaluation = this.evaluateBurnRates(serviceId, metrics, config);
                if (evaluation.shouldTrigger) {
                    this.handleTrigger(serviceId, metrics, config, evaluation, now);
                    return 'TRIGGER';
                } else if (evaluation.shouldWarn) {
                    this.handleEarlyWarn(serviceId, metrics, config, evaluation, now);
                    return 'IDLE'; // Stay in IDLE for early warnings
                }
                return 'IDLE';
                
            case 'TRIGGER':
                // Move to enforce actions
                return 'ENFORCE';
                
            case 'ENFORCE':
                // Apply actions and move to monitor
                this.enforceActions(serviceId, metrics, config, now);
                return 'MONITOR';
                
            case 'MONITOR':
                // Check if we should recover
                const isStable = this.checkStability(serviceId, metrics, config);
                if (isStable) {
                    return 'RECOVER';
                }
                
                // Check for recovery timeout
                const timeoutExceeded = this.checkRecoveryTimeout(metrics, config);
                if (timeoutExceeded) {
                    this.emitAlert('error', 'recovery_timeout');
                    return 'IDLE'; // Reset to avoid infinite loop
                }
                
                return 'MONITOR';
                
            case 'RECOVER':
                // Revert actions and return to idle
                this.recoverService(serviceId, metrics, config, now);
                return 'IDLE';
                
            default:
                return 'IDLE';
        }
    }

    private evaluateBurnRates(serviceId: string, metrics: ServiceMetrics, config: ServiceSLO): {
        shouldTrigger: boolean;
        shouldWarn: boolean;
        windows: Record<string, { avail: number; burn: number }>;
        triggerReason?: string;
    } {
        const windows: Record<string, { avail: number; burn: number }> = {};
        let shouldTrigger = false;
        let shouldWarn = false;
        let triggerReason = '';
        
        const errorBudget = 1 - (config.sloTargets.uptime / 100);
        
        for (const window of config.windows) {
            const windowMetrics = metrics.windows.get(window)!;
            
            // Calculate availability
            let availability = 0;
            if (windowMetrics.totalSamples >= this.config.evaluation.minSamplesPerWindow) {
                availability = windowMetrics.okSamples / windowMetrics.totalSamples;
                
                // Check freshness impact
                if (config.sloTargets.freshnessLagMsP95 && windowMetrics.freshnessMiss > 0) {
                    const freshnessPenalty = windowMetrics.freshnessMiss / windowMetrics.totalSamples;
                    availability = Math.max(0, availability - freshnessPenalty);
                }
            }
            
            // Calculate burn rate
            const burnRate = errorBudget > 0 ? (1 - availability) / errorBudget : 0;
            
            windows[window] = {
                avail: Math.round(availability * 10000) / 100, // Percentage with 2 decimals
                burn: Math.round(burnRate * 100) / 100
            };
            
            // Check thresholds
            const threshold = config.burnThresholds[window];
            if (burnRate >= threshold) {
                shouldTrigger = true;
                triggerReason = `multi_window_burn`;
            }
            
            // Early warning for fastest window
            if (window === '5m' && burnRate >= threshold * 0.5) {
                shouldWarn = true;
            }
        }
        
        return { shouldTrigger, shouldWarn, windows, triggerReason };
    }

    private handleTrigger(serviceId: string, metrics: ServiceMetrics, config: ServiceSLO, evaluation: any, now: string): void {
        const guardKey = this.generateGuardKey(serviceId, 'trigger', now);
        
        // Check idempotency
        if (this.state.activeGuards.has(guardKey)) {
            this.logger.info(`Trigger already active for ${serviceId}: ${guardKey}`);
            return;
        }
        
        // Plan actions
        const actionPlan = this.planActions(config);
        
        // Emit trigger event
        this.emitSloGuardTriggered(serviceId, config, evaluation.windows, evaluation.triggerReason!, actionPlan, guardKey);
        
        // Update metrics
        metrics.triggerCount++;
        this.state.totalTriggers++;
        this.state.activeGuards.set(guardKey, serviceId);
        
        // Emit card
        this.emitSloGuardCard(serviceId, config, actionPlan, 'warn');
        
        this.logger.warn(`SLO trigger for ${serviceId}: ${evaluation.triggerReason}`);
    }

    private handleEarlyWarn(serviceId: string, metrics: ServiceMetrics, config: ServiceSLO, evaluation: any, now: string): void {
        // Emit early warning
        this.emitSloGuardEarlyWarn(serviceId, config, evaluation.windows);
        
        // Update metrics
        metrics.earlyWarnCount++;
        this.state.totalEarlyWarns++;
        
        // Emit info card
        this.emitSloGuardCard(serviceId, config, {}, 'info', 'Early Warning');
        
        this.logger.info(`SLO early warning for ${serviceId}`);
    }

    private planActions(config: ServiceSLO): any {
        const actionPlan: any = {};
        
        if (config.actions.failover) {
            actionPlan.failover = config.actions.failover.to;
        }
        
        if (config.actions.degrade) {
            actionPlan.degrade = config.actions.degrade.drop;
        }
        
        if (config.actions.gate) {
            actionPlan.gate = config.actions.gate.type;
        }
        
        return actionPlan;
    }

    private enforceActions(serviceId: string, metrics: ServiceMetrics, config: ServiceSLO, now: string): void {
        // Integrate with other LIVIA modules
        if (config.actions.failover) {
            this.requestFailover(serviceId, config.actions.failover, now);
        }
        
        if (config.actions.degrade) {
            this.requestDegrade(serviceId, config.actions.degrade, now);
        }
        
        if (config.actions.gate) {
            this.requestGate(serviceId, config.actions.gate, now);
        }
        
        if (config.actions.circuit) {
            this.requestCircuit(serviceId, config.actions.circuit, now);
        }
        
        this.logger.info(`Actions enforced for ${serviceId}`);
    }

    private requestFailover(serviceId: string, failoverConfig: any, now: string): void {
        const failoverEvent = {
            event: 'failover.request',
            timestamp: now,
            serviceId,
            to: failoverConfig.to,
            reason: 'slo_burn_rate',
            requestedBy: 'slo_guard'
        };
        
        this.eventBus.emit('failover.request', failoverEvent);
    }

    private requestDegrade(serviceId: string, degradeConfig: any, now: string): void {
        const degradeEvent = {
            event: 'degrade.request',
            timestamp: now,
            serviceId,
            drop: degradeConfig.drop,
            reason: 'slo_burn_rate',
            requestedBy: 'slo_guard'
        };
        
        this.eventBus.emit('degrade.request', degradeEvent);
    }

    private requestGate(serviceId: string, gateConfig: any, now: string): void {
        const gateEvent = {
            event: 'gate.request',
            timestamp: now,
            serviceId,
            type: gateConfig.type,
            params: gateConfig,
            reason: 'slo_burn_rate',
            requestedBy: 'slo_guard'
        };
        
        this.eventBus.emit('gate.request', gateEvent);
    }

    private requestCircuit(serviceId: string, circuitConfig: any, now: string): void {
        const circuitEvent = {
            event: 'circuit.request',
            timestamp: now,
            serviceId,
            policy: circuitConfig.policy,
            reason: 'slo_burn_rate',
            requestedBy: 'slo_guard'
        };
        
        this.eventBus.emit('circuit.request', circuitEvent);
    }

    private checkStability(serviceId: string, metrics: ServiceMetrics, config: ServiceSLO): boolean {
        const now = Date.now();
        const stableThresholdMs = this.config.recovery.stableAfterMin * 60 * 1000;
        
        // Check if all burn rates are below threshold
        const evaluation = this.evaluateBurnRates(serviceId, metrics, config);
        if (evaluation.shouldTrigger) {
            // Reset stability tracking
            metrics.stableMinutes = 0;
            metrics.stableSince = undefined;
            return false;
        }
        
        // Start tracking stability
        if (!metrics.stableSince) {
            metrics.stableSince = new Date().toISOString();
            metrics.stableMinutes = 0;
        }
        
        // Update stable minutes
        const stableSinceMs = new Date(metrics.stableSince).getTime();
        metrics.stableMinutes = Math.floor((now - stableSinceMs) / (60 * 1000));
        
        return metrics.stableMinutes >= this.config.recovery.stableAfterMin;
    }

    private checkRecoveryTimeout(metrics: ServiceMetrics, config: ServiceSLO): boolean {
        if (!metrics.stableSince) return false;
        
        const now = Date.now();
        const stableSinceMs = new Date(metrics.stableSince).getTime();
        const timeoutMs = this.config.recovery.recoveryTimeoutMin * 60 * 1000;
        
        return (now - stableSinceMs) > timeoutMs;
    }

    private recoverService(serviceId: string, metrics: ServiceMetrics, config: ServiceSLO, now: string): void {
        const recoveryStartTime = metrics.stableSince!;
        const durationMin = metrics.stableMinutes;
        
        // Revert actions
        const actionsReverted: string[] = [];
        
        for (const actionType of this.config.recovery.revertActions) {
            const action = metrics.activeActions.get(actionType);
            if (action) {
                this.revertAction(serviceId, action, now);
                actionsReverted.push(actionType);
                metrics.activeActions.delete(actionType);
            }
        }
        
        // Check for failback
        let failback: string | undefined;
        const failoverAction = metrics.activeActions.get('failover');
        if (failoverAction && this.config.failover.autoFailback) {
            this.requestFailback(serviceId, failoverAction, now);
            failback = 'primary';
            metrics.activeActions.delete('failover');
        }
        
        // Emit recovery event
        this.emitSloGuardRecovered(serviceId, config, recoveryStartTime, durationMin, actionsReverted, failback);
        
        // Update metrics
        metrics.recoveryCount++;
        this.state.totalRecoveries++;
        
        // Reset stability tracking
        metrics.stableMinutes = 0;
        metrics.stableSince = undefined;
        
        // Clear active guards
        for (const [guardKey, guardServiceId] of this.state.activeGuards.entries()) {
            if (guardServiceId === serviceId) {
                this.state.activeGuards.delete(guardKey);
            }
        }
        
        this.logger.info(`Service ${serviceId} recovered after ${durationMin} minutes`);
    }

    private revertAction(serviceId: string, action: ActiveAction, now: string): void {
        const revertEvent = {
            event: `${action.type}.revert`,
            timestamp: now,
            serviceId,
            originalAction: action.params,
            reason: 'slo_recovery',
            requestedBy: 'slo_guard'
        };
        
        this.eventBus.emit(`${action.type}.revert`, revertEvent);
    }

    private requestFailback(serviceId: string, failoverAction: ActiveAction, now: string): void {
        const failbackEvent = {
            event: 'failback.request',
            timestamp: now,
            serviceId,
            to: 'primary',
            from: failoverAction.params.to,
            reason: 'slo_recovery',
            requestedBy: 'slo_guard'
        };
        
        this.eventBus.emit('failback.request', failbackEvent);
    }

    private generateGuardKey(serviceId: string, triggerType: string, timestamp: string): string {
        const windowStartISO = this.getWindowStart(timestamp);
        const keyData = `${serviceId}:${triggerType}:${windowStartISO}`;
        
        return 'slo_guard:' + crypto
            .createHash('sha256')
            .update(keyData)
            .digest('hex')
            .substring(0, 16);
    }

    private getWindowStart(timestamp: string): string {
        const date = new Date(timestamp);
        // Round down to 5-minute window
        date.setSeconds(0, 0);
        date.setMinutes(Math.floor(date.getMinutes() / 5) * 5);
        return date.toISOString();
    }

    private updateEvalMetrics(evalTimeMs: number): void {
        this.state.lastEvalTimes.push(evalTimeMs);
        
        // Keep only last 100 measurements
        if (this.state.lastEvalTimes.length > 100) {
            this.state.lastEvalTimes.shift();
        }
        
        // Calculate P95
        const sorted = [...this.state.lastEvalTimes].sort((a, b) => a - b);
        const p95Index = Math.floor(sorted.length * 0.95);
        this.state.p95EvalMs = sorted[p95Index] || 0;
    }

    private emitSloGuardTriggered(serviceId: string, config: ServiceSLO, windows: any, trigger: string, actionPlan: any, guardKey: string): void {
        const event = {
            event: 'slo.guard.triggered',
            timestamp: new Date().toISOString(),
            serviceId,
            slo: `uptime_${serviceId}`,
            windows,
            trigger,
            actionPlan,
            severity: 'high' as const,
            hash: guardKey
        };
        
        this.eventBus.emit('slo.guard.triggered', event);
    }

    private emitSloGuardRecovered(serviceId: string, config: ServiceSLO, since: string, durationMin: number, actionsReverted: string[], failback?: string): void {
        const event = {
            event: 'slo.guard.recovered',
            timestamp: new Date().toISOString(),
            serviceId,
            slo: `uptime_${serviceId}`,
            since,
            durationMin,
            actionsReverted,
            failback
        };
        
        this.eventBus.emit('slo.guard.recovered', event);
    }

    private emitSloGuardEarlyWarn(serviceId: string, config: ServiceSLO, windows: any): void {
        const event = {
            event: 'slo.guard.earlywarn',
            timestamp: new Date().toISOString(),
            serviceId,
            slo: `uptime_${serviceId}`,
            windows,
            hint: 'If 1h burn > 6x threshold, trigger will fire.'
        };
        
        this.eventBus.emit('slo.guard.earlywarn', event);
    }

    private emitSloGuardCard(serviceId: string, config: ServiceSLO, actionPlan: any, severity: 'info' | 'warn' | 'error', prefix: string = 'SLO Guard'): void {
        const actions = Object.keys(actionPlan);
        const actionsText = actions.length > 0 ? 
            `${actions.join(', ')} uygulandı` : 
            'İzleme devam ediyor';
        
        const event = {
            event: 'slo.guard.card',
            timestamp: new Date().toISOString(),
            title: `${prefix} — ${serviceId}`,
            body: `${actionsText}; gözlem sürüyor.`,
            severity,
            ttlSec: 600
        };
        
        this.eventBus.emit('slo.guard.card', event);
    }

    private emitAlert(level: 'info' | 'warn' | 'error', message: string): void {
        const event = {
            event: 'slo.guard.alert',
            timestamp: new Date().toISOString(),
            level,
            message
        };

        this.eventBus.emit('slo.guard.alert', event);
        this.logger.warn(`SLO Guard alert: ${level} - ${message}`);
    }

    private emitMetrics(): void {
        const event = {
            event: 'slo.guard.metrics',
            timestamp: new Date().toISOString(),
            evaluated: this.state.evaluationCount,
            triggers: this.state.totalTriggers,
            recoveries: this.state.totalRecoveries,
            earlyWarn: this.state.totalEarlyWarns,
            p95EvalMs: this.state.p95EvalMs,
            failovers: this.countActiveActions('failover'),
            gates: this.countActiveActions('gate'),
            degrades: this.countActiveActions('degrade')
        };

        this.eventBus.emit('slo.guard.metrics', event);
    }

    private countActiveActions(actionType: string): number {
        let count = 0;
        for (const serviceMetrics of this.state.services.values()) {
            if (serviceMetrics.activeActions.has(actionType)) {
                count++;
            }
        }
        return count;
    }

    getStatus(): any {
        return {
            name: this.name,
            initialized: this.isInitialized,
            status: this.state.status,
            services: Object.fromEntries(
                Array.from(this.state.services.entries()).map(([serviceId, metrics]) => [
                    serviceId,
                    {
                        state: metrics.state,
                        triggerCount: metrics.triggerCount,
                        recoveryCount: metrics.recoveryCount,
                        earlyWarnCount: metrics.earlyWarnCount,
                        activeActions: Array.from(metrics.activeActions.keys()),
                        stableMinutes: metrics.stableMinutes
                    }
                ])
            ),
            metrics: {
                evaluationCount: this.state.evaluationCount,
                totalTriggers: this.state.totalTriggers,
                totalRecoveries: this.state.totalRecoveries,
                totalEarlyWarns: this.state.totalEarlyWarns,
                p95EvalMs: this.state.p95EvalMs,
                activeGuards: this.state.activeGuards.size
            }
        };
    }

    async shutdown(): Promise<void> {
        try {
            this.logger.info(`${this.name} durduruluyor...`);
            
            // Emit final metrics
            this.emitMetrics();
            
            // Log summary
            this.logger.info(`SLO Guard summary: ${this.state.totalTriggers} triggers, ${this.state.totalRecoveries} recoveries`);
            
            this.isInitialized = false;
            this.logger.info(`${this.name} başarıyla durduruldu`);
        } catch (error) {
            this.logger.error(`${this.name} durdurma hatası:`, error);
        }
    }
}

export default RealtimeUptimeSLOGuard;