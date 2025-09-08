/**
 * Scenario Library Orchestrator - BR-03
 * Catalogs scenario templates and applies them to replay/sim with time schedules
 * Manages multi-stage scenarios and event injection
 */

import { EventEmitter } from 'events';

interface ScenarioStep {
    at: string; // "+10m" or "wall:2025-09-01T10:00" or "T+0:05:00"
    action: 'inject' | 'guard' | 'sentry' | 'cost' | 'market' | 'news' | 'fault';
    payload: {
        [key: string]: any;
    };
    description?: string;
    critical?: boolean;
}

interface ScenarioTemplate {
    id: string;
    name: string;
    description: string;
    steps: ScenarioStep[];
    tags: string[];
    duration?: string; // Expected duration like "30m"
    dangerous?: boolean; // Contains halt_entry or other risky actions
}

interface ScenarioCatalog {
    version: string;
    items: ScenarioTemplate[];
    metadata: {
        lastUpdated: string;
        totalScenarios: number;
        categories: string[];
    };
}

interface ScenarioBindings {
    symbols?: string[];
    tf?: 'M1' | 'M5' | 'M15' | 'H1';
    seed?: number;
    baseTime?: string; // ISO timestamp for wall time calculations
}

interface ScenarioRunRequest {
    event: 'scenario.run.request';
    timestamp: string;
    id?: string; // From catalog
    inline?: ScenarioTemplate; // Inline scenario definition
    bind: ScenarioBindings;
    target: 'replay' | 'sim';
    speed?: string;
    allowDangerous?: boolean;
}

interface ResolvedStep {
    ts: number; // Absolute timestamp
    originalAt: string;
    busEvent: {
        event: string;
        payload: any;
        target?: string;
    };
    stepIndex: number;
}

interface ScenarioRunPlan {
    event: 'scenario.run.plan';
    timestamp: string;
    scenarioId: string;
    name: string;
    stepsResolved: ResolvedStep[];
    effectiveTarget: 'replay' | 'sim';
    bindings: ScenarioBindings;
    totalDurationMs: number;
    dangerousSteps: number;
}

interface ScenarioRunStatus {
    event: 'scenario.run.status';
    timestamp: string;
    scenarioId: string;
    state: 'idle' | 'planned' | 'running' | 'paused' | 'completed' | 'failed' | 'aborted';
    progress: {
        completedSteps: number;
        totalSteps: number;
        currentStep?: ResolvedStep;
        nextStep?: ResolvedStep;
    };
    errors: Array<{
        stepIndex: number;
        error: string;
        timestamp: string;
    }>;
}

interface ScenarioMetrics {
    event: 'scenario.metrics';
    timestamp: string;
    scenarioId: string;
    executionTime: number;
    stepsExecuted: number;
    stepsFailed: number;
    avgStepLatencyMs: number;
    effectivenessScore: number; // 0-1 based on successful event delivery
}

interface ScenarioAlert {
    event: 'scenario.alert';
    timestamp: string;
    scenarioId: string;
    level: 'info' | 'warn' | 'error';
    message: string;
    context: any;
}

interface Config {
    defaults: {
        speed: string;
        tf: string;
    };
    guards: {
        allowDangerous: boolean;
        requireApproval: string[]; // Actions that need approval
    };
    timing: {
        maxStepDelayMs: number;
        resolutionMs: number; // Time resolution for step scheduling
    };
    catalog: {
        path: string;
        autoReload: boolean;
        validateOnLoad: boolean;
    };
    tz: string;
}

class ScenarioLibraryOrchestrator extends EventEmitter {
    private config: Config;
    private logger: any;
    private isInitialized: boolean = false;
    
    // Scenario state
    private catalog: ScenarioCatalog | null = null;
    private runningScenarios: Map<string, {
        plan: ScenarioRunPlan;
        status: ScenarioRunStatus;
        timer: NodeJS.Timeout | null;
        startTime: number;
    }> = new Map();
    
    // Built-in scenarios
    private builtInScenarios: ScenarioTemplate[] = [
        {
            id: 'news_shock_then_panic',
            name: 'News Shock followed by Panic Selling',
            description: 'Simulates major news event causing initial shock then cascading panic',
            steps: [
                {
                    at: '+0:00:00',
                    action: 'inject',
                    payload: { event: 'news.flash', severity: 'high', sentiment: 'negative' }
                },
                {
                    at: '+0:02:00',
                    action: 'market',
                    payload: { event: 'volatility.spike', factor: 2.5 }
                },
                {
                    at: '+0:05:00',
                    action: 'sentry',
                    payload: { event: 'sentry.mode.update', mode: 'panic' }
                },
                {
                    at: '+0:10:00',
                    action: 'guard',
                    payload: { event: 'latency_slip.guard.directive', action: 'block_aggressive' }
                },
                {
                    at: '+0:15:00',
                    action: 'cost',
                    payload: { event: 'cost.forecast.update', spreadMultiplier: 3.0 }
                }
            ],
            tags: ['news', 'volatility', 'panic'],
            duration: '20m',
            dangerous: false
        },
        {
            id: 'exchange_outage_cascade',
            name: 'Exchange Outage with Cascading Effects',
            description: 'Primary exchange goes down, triggering failover and increased latency',
            steps: [
                {
                    at: '+0:00:00',
                    action: 'fault',
                    payload: { event: 'exchange.connectivity.lost', exchange: 'primary' }
                },
                {
                    at: '+0:01:00',
                    action: 'guard',
                    payload: { event: 'exchange.failover.triggered', target: 'secondary' }
                },
                {
                    at: '+0:02:00',
                    action: 'market',
                    payload: { event: 'latency.spike', baseMs: 500, varianceMs: 200 }
                },
                {
                    at: '+0:05:00',
                    action: 'sentry',
                    payload: { event: 'sentry.threshold.update', latencyMs: 1000 }
                },
                {
                    at: '+0:30:00',
                    action: 'fault',
                    payload: { event: 'exchange.connectivity.restored', exchange: 'primary' }
                }
            ],
            tags: ['outage', 'failover', 'latency'],
            duration: '35m',
            dangerous: false
        },
        {
            id: 'liquidity_crisis_halt',
            name: 'Liquidity Crisis with Emergency Halt',
            description: 'Severe liquidity drain requiring emergency position halt',
            steps: [
                {
                    at: '+0:00:00',
                    action: 'market',
                    payload: { event: 'liquidity.drain', severity: 'critical' }
                },
                {
                    at: '+0:03:00',
                    action: 'cost',
                    payload: { event: 'slippage.explosion', factor: 5.0 }
                },
                {
                    at: '+0:05:00',
                    action: 'guard',
                    payload: { event: 'position.halt.emergency', reason: 'liquidity_crisis' },
                    critical: true
                }
            ],
            tags: ['liquidity', 'emergency', 'halt'],
            duration: '10m',
            dangerous: true
        }
    ];

    constructor(config: Partial<Config> = {}) {
        super();
        this.config = {
            defaults: {
                speed: '1',
                tf: 'M1'
            },
            guards: {
                allowDangerous: false,
                requireApproval: ['position.halt.emergency', 'system.shutdown']
            },
            timing: {
                maxStepDelayMs: 1000,
                resolutionMs: 100
            },
            catalog: {
                path: 'data/scenarios/catalog.json',
                autoReload: true,
                validateOnLoad: true
            },
            tz: 'Europe/Istanbul',
            ...config
        };
    }

    async initialize(logger: any): Promise<boolean> {
        try {
            this.logger = logger;
            this.logger.info('ScenarioLibraryOrchestrator initializing...');
            
            // Load scenario catalog
            await this.loadCatalog();
            
            this.isInitialized = true;
            this.logger.info('ScenarioLibraryOrchestrator initialized successfully');
            return true;
        } catch (error) {
            this.logger.error('ScenarioLibraryOrchestrator initialization error:', error);
            return false;
        }
    }

    /**
     * Process scenario catalog updates
     */
    async processCatalog(data: ScenarioCatalog): Promise<void> {
        if (!this.isInitialized) return;

        try {
            if (this.config.catalog.validateOnLoad) {
                this.validateCatalog(data);
            }

            this.catalog = data;
            this.logger.info(`ScenarioLibraryOrchestrator loaded catalog with ${data.items.length} scenarios`);

        } catch (error) {
            this.logger.error('ScenarioLibraryOrchestrator catalog processing error:', error);
            await this.emitAlert('error', `Failed to process catalog: ${error.message}`);
        }
    }

    /**
     * Process scenario run requests
     */
    async processRunRequest(data: ScenarioRunRequest): Promise<void> {
        if (!this.isInitialized) return;

        try {
            let scenario: ScenarioTemplate;

            // Get scenario from catalog or inline
            if (data.id) {
                scenario = this.findScenarioById(data.id);
                if (!scenario) {
                    throw new Error(`Scenario not found: ${data.id}`);
                }
            } else if (data.inline) {
                scenario = data.inline;
            } else {
                throw new Error('Either scenario id or inline scenario must be provided');
            }

            // Check dangerous actions
            if (scenario.dangerous && !data.allowDangerous) {
                const dangerousSteps = scenario.steps.filter(step => 
                    this.config.guards.requireApproval.includes(step.payload.event)
                );
                
                if (dangerousSteps.length > 0) {
                    throw new Error(`Scenario contains dangerous actions and allowDangerous=false: ${dangerousSteps.map(s => s.payload.event).join(', ')}`);
                }
            }

            // Create and resolve plan
            const plan = await this.createScenarioPlan(scenario, data);
            
            // Start scenario execution
            await this.startScenarioExecution(plan);

        } catch (error) {
            this.logger.error('ScenarioLibraryOrchestrator run request error:', error);
            await this.emitAlert('error', `Failed to start scenario: ${error.message}`);
        }
    }

    private async loadCatalog(): Promise<void> {
        try {
            // Initialize with built-in scenarios
            this.catalog = {
                version: '1.0.0',
                items: [...this.builtInScenarios],
                metadata: {
                    lastUpdated: new Date().toISOString(),
                    totalScenarios: this.builtInScenarios.length,
                    categories: [...new Set(this.builtInScenarios.flatMap(s => s.tags))]
                }
            };

            this.logger.info(`ScenarioLibraryOrchestrator loaded ${this.catalog.items.length} built-in scenarios`);
        } catch (error) {
            this.logger.warn('ScenarioLibraryOrchestrator catalog load warning:', error);
            // Fallback to built-in scenarios
            this.catalog = {
                version: '1.0.0',
                items: [...this.builtInScenarios],
                metadata: {
                    lastUpdated: new Date().toISOString(),
                    totalScenarios: this.builtInScenarios.length,
                    categories: ['news', 'volatility', 'outage', 'liquidity']
                }
            };
        }
    }

    private validateCatalog(catalog: ScenarioCatalog): void {
        if (!catalog.items || !Array.isArray(catalog.items)) {
            throw new Error('Invalid catalog: items must be an array');
        }

        for (const scenario of catalog.items) {
            if (!scenario.id || !scenario.name || !scenario.steps) {
                throw new Error(`Invalid scenario: ${scenario.id || 'unknown'}`);
            }

            for (const step of scenario.steps) {
                if (!step.at || !step.action || !step.payload) {
                    throw new Error(`Invalid step in scenario ${scenario.id}`);
                }
            }
        }
    }

    private findScenarioById(id: string): ScenarioTemplate | null {
        if (!this.catalog) return null;
        return this.catalog.items.find(s => s.id === id) || null;
    }

    private async createScenarioPlan(scenario: ScenarioTemplate, request: ScenarioRunRequest): Promise<ScenarioRunPlan> {
        const baseTime = request.bind.baseTime ? new Date(request.bind.baseTime).getTime() : Date.now();
        const resolvedSteps: ResolvedStep[] = [];

        for (let i = 0; i < scenario.steps.length; i++) {
            const step = scenario.steps[i];
            const absoluteTime = this.resolveStepTime(step.at, baseTime);
            
            // Convert step to bus event
            const busEvent = this.stepToBusEvent(step, request.bind, request.target);
            
            resolvedSteps.push({
                ts: absoluteTime,
                originalAt: step.at,
                busEvent,
                stepIndex: i
            });
        }

        // Sort steps by timestamp
        resolvedSteps.sort((a, b) => a.ts - b.ts);

        const plan: ScenarioRunPlan = {
            event: 'scenario.run.plan',
            timestamp: new Date().toISOString(),
            scenarioId: scenario.id,
            name: scenario.name,
            stepsResolved: resolvedSteps,
            effectiveTarget: request.target,
            bindings: request.bind,
            totalDurationMs: resolvedSteps.length > 0 ? resolvedSteps[resolvedSteps.length - 1].ts - baseTime : 0,
            dangerousSteps: scenario.steps.filter(s => 
                this.config.guards.requireApproval.includes(s.payload.event)
            ).length
        };

        this.emit('scenario.run.plan', plan);
        return plan;
    }

    private resolveStepTime(timeSpec: string, baseTime: number): number {
        // Handle relative time: "+10m", "+0:05:00", "T+0:05:00"
        if (timeSpec.startsWith('+') || timeSpec.startsWith('T+')) {
            const cleanSpec = timeSpec.replace('T+', '+').replace('+', '');
            return baseTime + this.parseTimeOffset(cleanSpec);
        }

        // Handle wall time: "wall:2025-09-01T10:00"
        if (timeSpec.startsWith('wall:')) {
            const wallTime = timeSpec.replace('wall:', '');
            return new Date(wallTime).getTime();
        }

        // Default to relative from base
        return baseTime + this.parseTimeOffset(timeSpec);
    }

    private parseTimeOffset(offset: string): number {
        // Support formats: "10m", "0:05:00", "1:30:45"
        if (offset.includes(':')) {
            const parts = offset.split(':').map(Number);
            if (parts.length === 2) {
                // mm:ss
                return (parts[0] * 60 + parts[1]) * 1000;
            } else if (parts.length === 3) {
                // hh:mm:ss
                return (parts[0] * 3600 + parts[1] * 60 + parts[2]) * 1000;
            }
        }

        // Simple format: "10m", "30s", "2h"
        const match = offset.match(/^(\d+)([smh])$/);
        if (match) {
            const value = parseInt(match[1]);
            const unit = match[2];
            switch (unit) {
                case 's': return value * 1000;
                case 'm': return value * 60 * 1000;
                case 'h': return value * 3600 * 1000;
            }
        }

        // Fallback: treat as milliseconds
        return parseInt(offset) || 0;
    }

    private stepToBusEvent(step: ScenarioStep, bindings: ScenarioBindings, target: string): any {
        const baseEvent = {
            event: step.payload.event || `scenario.${step.action}`,
            payload: { ...step.payload },
            target,
            timestamp: new Date().toISOString(),
            source: 'scenario'
        };

        // Apply bindings
        if (bindings.symbols && baseEvent.payload.symbol === undefined) {
            baseEvent.payload.symbols = bindings.symbols;
        }

        if (bindings.tf && baseEvent.payload.timeframe === undefined) {
            baseEvent.payload.timeframe = bindings.tf;
        }

        if (bindings.seed && baseEvent.payload.seed === undefined) {
            baseEvent.payload.seed = bindings.seed;
        }

        return baseEvent;
    }

    private async startScenarioExecution(plan: ScenarioRunPlan): Promise<void> {
        const scenarioId = plan.scenarioId;
        
        // Stop any existing scenario with same ID
        if (this.runningScenarios.has(scenarioId)) {
            await this.stopScenario(scenarioId);
        }

        const status: ScenarioRunStatus = {
            event: 'scenario.run.status',
            timestamp: new Date().toISOString(),
            scenarioId,
            state: 'running',
            progress: {
                completedSteps: 0,
                totalSteps: plan.stepsResolved.length,
                currentStep: plan.stepsResolved[0],
                nextStep: plan.stepsResolved.length > 1 ? plan.stepsResolved[1] : undefined
            },
            errors: []
        };

        // Schedule step execution
        const timer = this.scheduleSteps(plan, status);

        this.runningScenarios.set(scenarioId, {
            plan,
            status,
            timer,
            startTime: Date.now()
        });

        this.emit('scenario.run.status', status);
        await this.emitAlert('info', `Scenario started: ${plan.name}`);
    }

    private scheduleSteps(plan: ScenarioRunPlan, status: ScenarioRunStatus): NodeJS.Timeout {
        let currentStepIndex = 0;
        
        const executeNextStep = () => {
            if (currentStepIndex >= plan.stepsResolved.length) {
                this.completeScenario(plan.scenarioId);
                return;
            }

            const step = plan.stepsResolved[currentStepIndex];
            const now = Date.now();
            const delay = Math.max(0, step.ts - now);

            setTimeout(() => {
                this.executeStep(step, plan.scenarioId);
                currentStepIndex++;
                
                // Update status
                const runningScenario = this.runningScenarios.get(plan.scenarioId);
                if (runningScenario) {
                    runningScenario.status.progress.completedSteps = currentStepIndex;
                    runningScenario.status.progress.currentStep = plan.stepsResolved[currentStepIndex];
                    runningScenario.status.progress.nextStep = currentStepIndex + 1 < plan.stepsResolved.length 
                        ? plan.stepsResolved[currentStepIndex + 1] 
                        : undefined;
                    
                    this.emit('scenario.run.status', runningScenario.status);
                }

                executeNextStep();
            }, delay);
        };

        // Start execution
        setTimeout(executeNextStep, 0);
        
        // Return a dummy timer (actual scheduling is done recursively)
        return setTimeout(() => {}, 0);
    }

    private async executeStep(step: ResolvedStep, scenarioId: string): Promise<void> {
        try {
            // Emit the step event to the bus
            this.emit(step.busEvent.event, step.busEvent);
            
            this.logger.debug(`ScenarioLibraryOrchestrator executed step ${step.stepIndex}: ${step.busEvent.event}`);

        } catch (error) {
            this.logger.error(`ScenarioLibraryOrchestrator step execution error:`, error);
            
            const runningScenario = this.runningScenarios.get(scenarioId);
            if (runningScenario) {
                runningScenario.status.errors.push({
                    stepIndex: step.stepIndex,
                    error: error.message,
                    timestamp: new Date().toISOString()
                });
            }

            await this.emitAlert('error', `Step ${step.stepIndex} failed: ${error.message}`);
        }
    }

    private async completeScenario(scenarioId: string): Promise<void> {
        const runningScenario = this.runningScenarios.get(scenarioId);
        if (!runningScenario) return;

        runningScenario.status.state = 'completed';
        runningScenario.status.timestamp = new Date().toISOString();

        // Emit final status and metrics
        this.emit('scenario.run.status', runningScenario.status);
        
        const metrics: ScenarioMetrics = {
            event: 'scenario.metrics',
            timestamp: new Date().toISOString(),
            scenarioId,
            executionTime: Date.now() - runningScenario.startTime,
            stepsExecuted: runningScenario.status.progress.completedSteps,
            stepsFailed: runningScenario.status.errors.length,
            avgStepLatencyMs: 0, // Could be calculated if we track step timings
            effectivenessScore: 1 - (runningScenario.status.errors.length / runningScenario.plan.stepsResolved.length)
        };

        this.emit('scenario.metrics', metrics);

        // Cleanup
        if (runningScenario.timer) {
            clearTimeout(runningScenario.timer);
        }
        this.runningScenarios.delete(scenarioId);

        await this.emitAlert('info', `Scenario completed: ${runningScenario.plan.name}`);
    }

    private async stopScenario(scenarioId: string): Promise<void> {
        const runningScenario = this.runningScenarios.get(scenarioId);
        if (!runningScenario) return;

        runningScenario.status.state = 'aborted';
        runningScenario.status.timestamp = new Date().toISOString();

        if (runningScenario.timer) {
            clearTimeout(runningScenario.timer);
        }

        this.emit('scenario.run.status', runningScenario.status);
        this.runningScenarios.delete(scenarioId);

        await this.emitAlert('warn', `Scenario stopped: ${runningScenario.plan.name}`);
    }

    private async emitAlert(level: 'info' | 'warn' | 'error', message: string, context?: any): Promise<void> {
        const alert: ScenarioAlert = {
            event: 'scenario.alert',
            timestamp: new Date().toISOString(),
            scenarioId: '',
            level,
            message,
            context: context || {}
        };

        this.emit('scenario.alert', alert);
    }

    /**
     * Get list of available scenarios
     */
    getAvailableScenarios(): ScenarioTemplate[] {
        return this.catalog ? this.catalog.items : [];
    }

    /**
     * Get running scenarios
     */
    getRunningScenarios(): string[] {
        return Array.from(this.runningScenarios.keys());
    }

    /**
     * Get module status
     */
    getStatus(): any {
        return {
            name: 'ScenarioLibraryOrchestrator',
            initialized: this.isInitialized,
            catalogLoaded: !!this.catalog,
            availableScenarios: this.catalog?.items.length || 0,
            runningScenarios: this.runningScenarios.size,
            builtInScenarios: this.builtInScenarios.length
        };
    }

    async shutdown(): Promise<void> {
        try {
            this.logger.info('ScenarioLibraryOrchestrator shutting down...');
            
            // Stop all running scenarios
            for (const scenarioId of this.runningScenarios.keys()) {
                await this.stopScenario(scenarioId);
            }
            
            this.removeAllListeners();
            this.catalog = null;
            this.isInitialized = false;
            this.logger.info('ScenarioLibraryOrchestrator shutdown complete');
        } catch (error) {
            this.logger.error('ScenarioLibraryOrchestrator shutdown error:', error);
        }
    }
}

export default ScenarioLibraryOrchestrator;
