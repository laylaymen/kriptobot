/**
 * Endpoint Failover Orchestrator - SG-04
 * Advanced multi-endpoint failover management with graceful switches and brownout support
 * Coordinates with ExchangeConnectivitySentry for intelligent endpoint selection
 */

import { EventEmitter } from 'events';

interface EndpointCatalog {
    primary: {
        id: string;
        url: string;
        region?: string;
    };
    secondary: Array<{
        id: string;
        url: string;
        region?: string;
        priority: number;
    }>;
    probe: {
        intervalMs: number;
        timeoutMs: number;
        jitterMs: number;
    };
}

interface SentryFailoverRecommendation {
    from: string;
    to: string;
    scoreFrom: number;
    scoreTo: number;
    reasonCodes: string[];
    timestamp: string;
}

interface SentryGuardDirective {
    mode: string;
    reasonCodes: string[];
    source: string;
}

interface ManualFailoverCommand {
    to: string; // endpoint id or "revert"
    reason: string;
    force?: boolean;
}

interface EndpointSwitchPlan {
    from: string;
    to: string;
    when: string;
    reasonCodes: string[];
    switchType: 'failover' | 'revert' | 'manual';
    canaryDurationMs?: number;
}

interface EndpointSwitched {
    from: string;
    to: string;
    success: boolean;
    latencyMs: number;
    timestamp: string;
    reasonCodes: string[];
}

interface EndpointHealthSnapshot {
    id: string;
    score: number;
    lastProbe: string;
    rttMs: number;
    failures: number;
    consecutiveFailures: number;
    status: 'healthy' | 'degraded' | 'unhealthy';
}

interface Config {
    minDwellSec: number;
    probe: {
        intervalMs: number;
        timeoutMs: number;
        jitterMs: number;
    };
    brownout: {
        maxStepPct: number;
        stepSec: number;
    };
    revertPolicy: string;
    maxConsecutiveFailures: number;
    canaryDurationMs: number;
    healthScoreThreshold: number;
    tz: string;
}

class EndpointFailoverOrchestrator extends EventEmitter {
    private config: Config;
    private logger: any;
    private isInitialized: boolean = false;
    
    // Endpoint management
    private currentEndpoint: string = '';
    private endpoints: Map<string, EndpointHealthSnapshot> = new Map();
    private lastSwitchTime: number = 0;
    private dwellStartTime: number = Date.now();
    
    // Probe management
    private probeIntervals: Map<string, NodeJS.Timeout> = new Map();
    private probeHistory: Map<string, number[]> = new Map();
    
    // Switch management
    private pendingSwitchPlan: EndpointSwitchPlan | null = null;
    private switchHistory: EndpointSwitched[] = [];
    private consecutiveSwitchFailures: number = 0;
    
    // Brownout state
    private brownoutState: {
        active: boolean;
        fromEndpoint: string;
        toEndpoint: string;
        currentStep: number;
        totalSteps: number;
        stepStartTime: number;
    } | null = null;

    constructor(config: Partial<Config> = {}) {
        super();
        this.config = {
            minDwellSec: 300,
            probe: {
                intervalMs: 3000,
                timeoutMs: 1500,
                jitterMs: 200
            },
            brownout: {
                maxStepPct: 50,
                stepSec: 30
            },
            revertPolicy: "prefer_primary_after_stable_10m",
            maxConsecutiveFailures: 3,
            canaryDurationMs: 30000,
            healthScoreThreshold: 0.7,
            tz: "Europe/Istanbul",
            ...config
        };
    }

    async initialize(logger: any): Promise<boolean> {
        try {
            this.logger = logger;
            this.logger.info('EndpointFailoverOrchestrator initializing...');
            
            this.isInitialized = true;
            this.logger.info('EndpointFailoverOrchestrator initialized successfully');
            return true;
        } catch (error) {
            this.logger.error('EndpointFailoverOrchestrator initialization error:', error);
            return false;
        }
    }

    /**
     * Process endpoint catalog update
     */
    async processEndpointCatalog(data: EndpointCatalog): Promise<void> {
        if (!this.isInitialized) return;

        try {
            // Initialize endpoints if not already done
            if (this.endpoints.size === 0) {
                await this.initializeEndpoints(data);
            }

            // Update probe configuration
            await this.updateProbeConfiguration(data.probe);

        } catch (error) {
            this.logger.error('EndpointFailoverOrchestrator catalog processing error:', error);
        }
    }

    /**
     * Process sentry failover recommendation
     */
    async processSentryRecommendation(data: SentryFailoverRecommendation): Promise<void> {
        if (!this.isInitialized) return;

        try {
            // Check if we can act on this recommendation
            if (!this.canCreateSwitchPlan()) {
                this.logger.debug('Cannot create switch plan due to dwell time or existing plan');
                return;
            }

            // Validate the recommendation
            if (!this.validateRecommendation(data)) {
                this.logger.warn('Invalid sentry recommendation', data);
                return;
            }

            // Create switch plan
            const plan = await this.createSwitchPlan(data);
            if (plan) {
                await this.executeSwitchPlan(plan);
            }

        } catch (error) {
            this.logger.error('EndpointFailoverOrchestrator recommendation processing error:', error);
        }
    }

    /**
     * Process sentry guard directive
     */
    async processSentryDirective(data: SentryGuardDirective): Promise<void> {
        if (!this.isInitialized) return;

        try {
            // In panic/degraded mode, be more conservative with switches
            if (data.mode === 'streams_panic' || data.mode === 'degraded') {
                if (this.brownoutState) {
                    // Pause brownout during sentry issues
                    this.logger.info('Pausing brownout due to sentry directive');
                }
            }

        } catch (error) {
            this.logger.error('EndpointFailoverOrchestrator directive processing error:', error);
        }
    }

    /**
     * Process manual failover command
     */
    async processManualCommand(data: ManualFailoverCommand): Promise<void> {
        if (!this.isInitialized) return;

        try {
            if (data.to === 'revert') {
                await this.revertToPrimary(data.reason);
            } else {
                await this.switchToEndpoint(data.to, data.reason, data.force);
            }

        } catch (error) {
            this.logger.error('EndpointFailoverOrchestrator manual command processing error:', error);
        }
    }

    private async initializeEndpoints(catalog: EndpointCatalog): Promise<void> {
        // Add primary endpoint
        this.endpoints.set(catalog.primary.id, {
            id: catalog.primary.id,
            score: 1.0,
            lastProbe: new Date().toISOString(),
            rttMs: 0,
            failures: 0,
            consecutiveFailures: 0,
            status: 'healthy'
        });

        // Add secondary endpoints
        for (const endpoint of catalog.secondary) {
            this.endpoints.set(endpoint.id, {
                id: endpoint.id,
                score: 0.8, // Default lower score for secondaries
                lastProbe: new Date().toISOString(),
                rttMs: 0,
                failures: 0,
                consecutiveFailures: 0,
                status: 'healthy'
            });
        }

        // Set current endpoint to primary if not set
        if (!this.currentEndpoint) {
            this.currentEndpoint = catalog.primary.id;
            this.dwellStartTime = Date.now();
        }

        // Start probing all endpoints
        await this.startProbing(catalog);
    }

    private async startProbing(catalog: EndpointCatalog): Promise<void> {
        const allEndpoints = [catalog.primary, ...catalog.secondary];
        
        for (const endpoint of allEndpoints) {
            await this.startEndpointProbe(endpoint.id, catalog.probe);
        }
    }

    private async startEndpointProbe(endpointId: string, probeConfig: any): Promise<void> {
        // Clear existing probe
        const existing = this.probeIntervals.get(endpointId);
        if (existing) {
            clearInterval(existing);
        }

        // Start new probe with jitter
        const jitter = Math.random() * probeConfig.jitterMs;
        const interval = probeConfig.intervalMs + jitter;

        const probeInterval = setInterval(async () => {
            await this.probeEndpoint(endpointId, probeConfig.timeoutMs);
        }, interval);

        this.probeIntervals.set(endpointId, probeInterval);
    }

    private async probeEndpoint(endpointId: string, timeoutMs: number): Promise<void> {
        const startTime = Date.now();
        let success = false;
        let rttMs = 0;

        try {
            // Simulate probe (in real implementation, would make actual HTTP request)
            await this.simulateProbe(endpointId, timeoutMs);
            success = true;
            rttMs = Date.now() - startTime;
        } catch (error) {
            success = false;
            rttMs = timeoutMs;
        }

        // Update endpoint health
        await this.updateEndpointHealth(endpointId, success, rttMs);
    }

    private async simulateProbe(endpointId: string, timeoutMs: number): Promise<void> {
        // Simulate network latency and potential failures
        const latency = Math.random() * 100 + 50; // 50-150ms
        const failureRate = 0.05; // 5% failure rate
        
        return new Promise((resolve, reject) => {
            setTimeout(() => {
                if (Math.random() < failureRate) {
                    reject(new Error('Probe failed'));
                } else {
                    resolve();
                }
            }, latency);
        });
    }

    private async updateEndpointHealth(endpointId: string, success: boolean, rttMs: number): Promise<void> {
        const endpoint = this.endpoints.get(endpointId);
        if (!endpoint) return;

        // Update RTT history
        let rttHistory = this.probeHistory.get(endpointId) || [];
        rttHistory.push(rttMs);
        if (rttHistory.length > 20) {
            rttHistory.shift();
        }
        this.probeHistory.set(endpointId, rttHistory);

        // Update endpoint stats
        endpoint.lastProbe = new Date().toISOString();
        endpoint.rttMs = rttMs;

        if (success) {
            endpoint.consecutiveFailures = 0;
            // Calculate score based on RTT and success rate
            const avgRtt = rttHistory.reduce((sum, rtt) => sum + rtt, 0) / rttHistory.length;
            endpoint.score = Math.max(0.1, Math.min(1.0, 1.0 - (avgRtt / 1000)));
        } else {
            endpoint.failures++;
            endpoint.consecutiveFailures++;
            endpoint.score = Math.max(0.0, endpoint.score - 0.2);
        }

        // Update status
        if (endpoint.consecutiveFailures >= this.config.maxConsecutiveFailures) {
            endpoint.status = 'unhealthy';
        } else if (endpoint.score < this.config.healthScoreThreshold) {
            endpoint.status = 'degraded';
        } else {
            endpoint.status = 'healthy';
        }

        // Emit health snapshot
        this.emit('endpoint.health.snapshot', { ...endpoint });

        // Check if current endpoint is failing
        if (endpointId === this.currentEndpoint && endpoint.status === 'unhealthy') {
            await this.handleCurrentEndpointFailure();
        }
    }

    private async handleCurrentEndpointFailure(): Promise<void> {
        this.logger.warn(`Current endpoint ${this.currentEndpoint} is unhealthy, looking for alternatives`);

        // Find best alternative endpoint
        const alternatives = Array.from(this.endpoints.values())
            .filter(ep => ep.id !== this.currentEndpoint && ep.status !== 'unhealthy')
            .sort((a, b) => b.score - a.score);

        if (alternatives.length > 0) {
            const best = alternatives[0];
            const recommendation: SentryFailoverRecommendation = {
                from: this.currentEndpoint,
                to: best.id,
                scoreFrom: this.endpoints.get(this.currentEndpoint)?.score || 0,
                scoreTo: best.score,
                reasonCodes: ['CURRENT_ENDPOINT_UNHEALTHY'],
                timestamp: new Date().toISOString()
            };

            await this.processSentryRecommendation(recommendation);
        } else {
            this.emit('sentry.alert', {
                level: 'error',
                message: 'No healthy endpoints available',
                context: { currentEndpoint: this.currentEndpoint }
            });
        }
    }

    private canCreateSwitchPlan(): boolean {
        const now = Date.now();
        const dwellAge = (now - this.dwellStartTime) / 1000;
        
        return dwellAge >= this.config.minDwellSec && 
               this.pendingSwitchPlan === null &&
               this.brownoutState === null;
    }

    private validateRecommendation(rec: SentryFailoverRecommendation): boolean {
        // Check that both endpoints exist
        if (!this.endpoints.has(rec.from) || !this.endpoints.has(rec.to)) {
            return false;
        }

        // Check that target endpoint is healthier
        const fromEndpoint = this.endpoints.get(rec.from)!;
        const toEndpoint = this.endpoints.get(rec.to)!;

        return toEndpoint.score > fromEndpoint.score && 
               toEndpoint.status !== 'unhealthy';
    }

    private async createSwitchPlan(rec: SentryFailoverRecommendation): Promise<EndpointSwitchPlan | null> {
        const plan: EndpointSwitchPlan = {
            from: rec.from,
            to: rec.to,
            when: new Date().toISOString(),
            reasonCodes: rec.reasonCodes,
            switchType: 'failover',
            canaryDurationMs: this.config.canaryDurationMs
        };

        this.pendingSwitchPlan = plan;
        this.emit('endpoint.switch.plan', plan);
        
        return plan;
    }

    private async executeSwitchPlan(plan: EndpointSwitchPlan): Promise<void> {
        const startTime = Date.now();
        let success = false;

        try {
            this.logger.info(`Executing switch plan: ${plan.from} -> ${plan.to}`, {
                reasonCodes: plan.reasonCodes
            });

            // Perform canary validation if specified
            if (plan.canaryDurationMs && plan.canaryDurationMs > 0) {
                success = await this.performCanarySwitch(plan);
            } else {
                success = await this.performDirectSwitch(plan);
            }

            const latencyMs = Date.now() - startTime;
            
            const switchResult: EndpointSwitched = {
                from: plan.from,
                to: plan.to,
                success,
                latencyMs,
                timestamp: new Date().toISOString(),
                reasonCodes: plan.reasonCodes
            };

            // Update state
            if (success) {
                this.currentEndpoint = plan.to;
                this.dwellStartTime = Date.now();
                this.lastSwitchTime = Date.now();
                this.consecutiveSwitchFailures = 0;
            } else {
                this.consecutiveSwitchFailures++;
            }

            // Store in history
            this.switchHistory.push(switchResult);
            if (this.switchHistory.length > 50) {
                this.switchHistory.shift();
            }

            this.emit('endpoint.switched', switchResult);

            if (this.consecutiveSwitchFailures >= this.config.maxConsecutiveFailures) {
                this.emit('sentry.alert', {
                    level: 'error',
                    message: `${this.consecutiveSwitchFailures} consecutive switch failures`,
                    context: { lastPlan: plan }
                });
            }

        } catch (error) {
            this.logger.error('Switch plan execution failed:', error);
            success = false;
        } finally {
            this.pendingSwitchPlan = null;
        }
    }

    private async performCanarySwitch(plan: EndpointSwitchPlan): Promise<boolean> {
        // Simulate canary testing (in real implementation would do partial traffic routing)
        this.logger.info(`Starting canary switch to ${plan.to} for ${plan.canaryDurationMs}ms`);
        
        return new Promise((resolve) => {
            setTimeout(() => {
                // Simulate canary success/failure
                const success = Math.random() > 0.1; // 90% success rate
                this.logger.info(`Canary switch ${success ? 'succeeded' : 'failed'}`);
                resolve(success);
            }, plan.canaryDurationMs);
        });
    }

    private async performDirectSwitch(plan: EndpointSwitchPlan): Promise<boolean> {
        // Simulate direct switch
        this.logger.info(`Performing direct switch to ${plan.to}`);
        
        // Simulate switch latency and potential failure
        const latency = Math.random() * 100 + 50;
        const success = Math.random() > 0.05; // 95% success rate
        
        await new Promise(resolve => setTimeout(resolve, latency));
        return success;
    }

    private async switchToEndpoint(endpointId: string, reason: string, force: boolean = false): Promise<void> {
        if (!this.endpoints.has(endpointId)) {
            throw new Error(`Unknown endpoint: ${endpointId}`);
        }

        if (!force && !this.canCreateSwitchPlan()) {
            throw new Error('Cannot switch now due to dwell time or pending operation');
        }

        const plan: EndpointSwitchPlan = {
            from: this.currentEndpoint,
            to: endpointId,
            when: new Date().toISOString(),
            reasonCodes: ['MANUAL_COMMAND', reason],
            switchType: 'manual'
        };

        await this.executeSwitchPlan(plan);
    }

    private async revertToPrimary(reason: string): Promise<void> {
        // Find primary endpoint (assuming it's the first one added)
        const primaryId = Array.from(this.endpoints.keys())[0];
        
        if (this.currentEndpoint === primaryId) {
            this.logger.info('Already on primary endpoint');
            return;
        }

        await this.switchToEndpoint(primaryId, `REVERT: ${reason}`, true);
    }

    private async updateProbeConfiguration(probeConfig: any): Promise<void> {
        // Restart probing with new configuration
        for (const [endpointId, interval] of this.probeIntervals.entries()) {
            clearInterval(interval);
            await this.startEndpointProbe(endpointId, probeConfig);
        }
    }

    /**
     * Get current endpoint information
     */
    getCurrentEndpoint(): string {
        return this.currentEndpoint;
    }

    /**
     * Get all endpoint health snapshots
     */
    getAllEndpointHealth(): EndpointHealthSnapshot[] {
        return Array.from(this.endpoints.values());
    }

    /**
     * Get switch history
     */
    getSwitchHistory(limit: number = 10): EndpointSwitched[] {
        return this.switchHistory.slice(-limit);
    }

    /**
     * Get module status
     */
    getStatus(): any {
        return {
            name: 'EndpointFailoverOrchestrator',
            initialized: this.isInitialized,
            currentEndpoint: this.currentEndpoint,
            totalEndpoints: this.endpoints.size,
            dwellAge: (Date.now() - this.dwellStartTime) / 1000,
            pendingSwitchPlan: this.pendingSwitchPlan !== null,
            consecutiveSwitchFailures: this.consecutiveSwitchFailures,
            brownoutActive: this.brownoutState !== null
        };
    }

    async shutdown(): Promise<void> {
        try {
            this.logger.info('EndpointFailoverOrchestrator shutting down...');
            
            // Clear all probe intervals
            for (const interval of this.probeIntervals.values()) {
                clearInterval(interval);
            }
            
            this.removeAllListeners();
            this.endpoints.clear();
            this.probeIntervals.clear();
            this.probeHistory.clear();
            this.switchHistory.length = 0;
            this.isInitialized = false;
            this.logger.info('EndpointFailoverOrchestrator shutdown complete');
        } catch (error) {
            this.logger.error('EndpointFailoverOrchestrator shutdown error:', error);
        }
    }
}

export default EndpointFailoverOrchestrator;
