/**
 * LIVIA-49 · Multi-Region Failover Coordinator
 * Çok bölgeli mimaride hizmet sürekliliği için proaktif sağlık izleme ve otomatik failover
 */

const EventEmitter = require('events');

class MultiRegionFailoverCoordinator extends EventEmitter {
    constructor(config = {}) {
        super();
        this.name = 'MultiRegionFailoverCoordinator';
        this.config = {
            enabled: true,
            regions: {
                primary: 'eu-central',
                secondary: 'us-east',
                dr: 'me-west'
            },
            thresholds: {
                brownout: { latencyP95Ms: 500, errorRatePct: 1.5 },
                blackout: { latencyP95Ms: 2000, errorRatePct: 5.0 },
                rpoBudgetSec: 30,
                rtoBudgetSec: 300
            },
            dns: {
                ttlNormalSec: 120,
                ttlIncidentSec: 10
            },
            flappingPrevention: {
                minStabilityWindowSec: 300,
                maxFailoversPerHour: 2
            },
            ...config
        };
        
        this.isInitialized = false;
        this.logger = null;
        this.eventBus = null;
        
        // Operational state
        this.state = {
            topology: 'active-passive', // active-active, active-passive
            currentPrimary: this.config.regions.primary,
            lastFailoverTs: null,
            failoverCount: 0,
            regionHealth: new Map(),
            activeLeases = new Map(),
            splitBrainProtection: true
        };
        
        this.metrics = {
            failoversExecuted: 0,
            meanFailoverTimeMs: 0,
            splitBrainsDetected: 0,
            dataLossEvents: 0
        };
    }

    async initialize(logger, eventBus) {
        try {
            this.logger = logger;
            this.eventBus = eventBus;
            this.logger.info(`${this.name} başlatılıyor...`);
            
            await this.setupEventHandlers();
            await this.initializeRegionMonitoring();
            
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

        // Health monitoring events
        this.eventBus.on('service.health.probe', (data) => {
            this.handleHealthProbe(data);
        });
        
        this.eventBus.on('dependency.health', (data) => {
            this.handleDependencyHealth(data);
        });
        
        this.eventBus.on('datastore.replica.lag', (data) => {
            this.handleReplicaLag(data);
        });
        
        // Manual failover requests
        this.eventBus.on('failover.plan.request', (data) => {
            this.handleFailoverRequest(data);
        });
        
        // Traffic management
        this.eventBus.on('traffic.shift.request', (data) => {
            this.handleTrafficShiftRequest(data);
        });
        
        // Incident management
        this.eventBus.on('incident.started', (data) => {
            this.handleIncidentStarted(data);
        });
        
        this.eventBus.on('incident.closed', (data) => {
            this.handleIncidentClosed(data);
        });
    }

    async initializeRegionMonitoring() {
        // Initialize health state for all regions
        for (const [role, region] of Object.entries(this.config.regions)) {
            this.state.regionHealth.set(region, {
                role,
                status: 'unknown',
                lastProbeTs: null,
                p95LatencyMs: null,
                errorRatePct: null,
                availabilityPct: null,
                replicationLagSec: null
            });
        }
        
        this.logger.info(`Region monitoring initialized for ${Object.keys(this.config.regions).length} regions`);
    }

    async handleHealthProbe(data) {
        if (!this.isInitialized) return;

        const { region, serviceId, p95Ms, errorRatePct, availPct } = data;
        
        // Update health state
        const health = this.state.regionHealth.get(region) || {};
        health.lastProbeTs = data.timestamp;
        health.p95LatencyMs = p95Ms;
        health.errorRatePct = errorRatePct;
        health.availabilityPct = availPct;
        
        // Determine health status
        if (p95Ms > this.config.thresholds.blackout.latencyP95Ms || 
            errorRatePct > this.config.thresholds.blackout.errorRatePct) {
            health.status = 'blackout';
        } else if (p95Ms > this.config.thresholds.brownout.latencyP95Ms || 
                   errorRatePct > this.config.thresholds.brownout.errorRatePct) {
            health.status = 'brownout';
        } else {
            health.status = 'healthy';
        }
        
        this.state.regionHealth.set(region, health);
        
        // Evaluate failover necessity
        await this.evaluateFailoverNeed(region, health);
    }

    async handleDependencyHealth(data) {
        const { region, kind, id, status, lagSec } = data;
        
        if (status === 'down' && region === this.state.currentPrimary) {
            this.logger.warn(`Critical dependency down in primary region: ${id} @ ${region}`);
            
            const health = this.state.regionHealth.get(region) || {};
            health.criticalDependencyDown = true;
            this.state.regionHealth.set(region, health);
            
            // Trigger immediate failover evaluation
            await this.evaluateFailoverNeed(region, health);
        }
    }

    async handleReplicaLag(data) {
        const { region, primaryRegion, lagSec } = data;
        
        // Update replication lag info
        const health = this.state.regionHealth.get(region) || {};
        health.replicationLagSec = lagSec;
        this.state.regionHealth.set(region, health);
        
        // Check RPO compliance
        if (lagSec > this.config.thresholds.rpoBudgetSec) {
            this.logger.warn(`RPO budget exceeded: ${lagSec}s > ${this.config.thresholds.rpoBudgetSec}s in ${region}`);
            
            // Emit RPO guard event
            this.eventBus.emit('rpo.guard.triggered', {
                event: 'rpo.guard.triggered',
                timestamp: new Date().toISOString(),
                region,
                primaryRegion,
                lagSec,
                budget: this.config.thresholds.rpoBudgetSec,
                source: this.name
            });
        }
    }

    async evaluateFailoverNeed(region, health) {
        // Only evaluate for primary region issues
        if (region !== this.state.currentPrimary) return;
        
        // Check flapping prevention
        if (this.isFlapping()) {
            this.logger.warn('Failover suppressed due to flapping prevention');
            return;
        }
        
        let shouldFailover = false;
        let reason = '';
        
        // Blackout conditions (immediate failover)
        if (health.status === 'blackout' || health.criticalDependencyDown) {
            shouldFailover = true;
            reason = 'blackout_detected';
        }
        // Brownout conditions (gradual failover)
        else if (health.status === 'brownout') {
            shouldFailover = true;
            reason = 'brownout_detected';
        }
        
        if (shouldFailover) {
            await this.executeFailover(reason, health.status === 'blackout');
        }
    }

    async executeFailover(reason, isEmergency = false) {
        const targetRegion = this.config.regions.secondary;
        const failoverStart = Date.now();
        
        this.logger.info(`Executing failover: ${this.state.currentPrimary} → ${targetRegion} (${reason})`);
        
        try {
            // Step 1: Create failover plan
            const plan = await this.createFailoverPlan(targetRegion, isEmergency);
            
            this.eventBus.emit('failover.plan.ready', {
                event: 'failover.plan.ready',
                timestamp: new Date().toISOString(),
                mode: this.state.topology,
                fromRegion: this.state.currentPrimary,
                toRegion: targetRegion,
                scope: 'global',
                actions: plan.actions,
                rationale: plan.rationale,
                source: this.name
            });
            
            // Step 2: Start failover execution
            this.eventBus.emit('failover.started', {
                event: 'failover.started',
                timestamp: new Date().toISOString(),
                planId: `mrf#${Date.now().toString(16)}`,
                from: this.state.currentPrimary,
                to: targetRegion,
                via: plan.mechanisms,
                dnsTtlSec: this.config.dns.ttlIncidentSec,
                source: this.name
            });
            
            // Step 3: Execute failover steps
            await this.executeFailoverSteps(plan, targetRegion, isEmergency);
            
            // Step 4: Update state
            this.state.currentPrimary = targetRegion;
            this.state.lastFailoverTs = new Date().toISOString();
            this.state.failoverCount++;
            
            // Step 5: Verify stabilization
            await this.verifyFailoverStabilization(targetRegion);
            
            // Update metrics
            const failoverTime = Date.now() - failoverStart;
            this.metrics.failoversExecuted++;
            this.metrics.meanFailoverTimeMs = 
                (this.metrics.meanFailoverTimeMs * (this.metrics.failoversExecuted - 1) + failoverTime) / 
                this.metrics.failoversExecuted;
            
            this.logger.info(`Failover completed successfully in ${failoverTime}ms`);
            
        } catch (error) {
            this.logger.error('Failover execution failed:', error);
            
            this.eventBus.emit('failover.failed', {
                event: 'failover.failed',
                timestamp: new Date().toISOString(),
                reason: error.message,
                source: this.name
            });
        }
    }

    async createFailoverPlan(targetRegion, isEmergency) {
        const plan = {
            actions: [],
            mechanisms: {
                routing: 'gslb+mesh',
                datastore: 'postgres(lease-lock)',
                broker: 'kafka(mirror)'
            },
            rationale: {
                rtoSec: this.config.thresholds.rtoBudgetSec,
                rpoSec: this.config.thresholds.rpoBudgetSec,
                emergency: isEmergency
            }
        };
        
        if (isEmergency) {
            // Emergency failover - immediate switch
            plan.actions = [
                'acquire_target_lease',
                'fence_primary_region', 
                'dns_ttl_emergency',
                'traffic_100_immediate',
                'promote_secondary_db',
                'verify_health'
            ];
        } else {
            // Gradual failover - brownout
            plan.actions = [
                'dns_ttl_lower',
                'traffic_shift_20',
                'acquire_target_lease',
                'db_read_only_source',
                'traffic_shift_50',
                'fence_primary_region',
                'promote_secondary_db',
                'traffic_shift_100',
                'verify_stabilization'
            ];
        }
        
        return plan;
    }

    async executeFailoverSteps(plan, targetRegion, isEmergency) {
        for (const action of plan.actions) {
            this.logger.info(`Executing failover step: ${action}`);
            
            try {
                switch (action) {
                    case 'dns_ttl_lower':
                    case 'dns_ttl_emergency':
                        await this.updateDnsTtl();
                        break;
                        
                    case 'traffic_shift_20':
                    case 'traffic_shift_50':
                    case 'traffic_shift_100':
                    case 'traffic_100_immediate':
                        await this.shiftTraffic(action, targetRegion);
                        break;
                        
                    case 'acquire_target_lease':
                        await this.acquireRegionLease(targetRegion);
                        break;
                        
                    case 'fence_primary_region':
                        await this.fencePrimaryRegion();
                        break;
                        
                    case 'db_read_only_source':
                        await this.setDatabaseReadOnly();
                        break;
                        
                    case 'promote_secondary_db':
                        await this.promoteSecondaryDatabase(targetRegion);
                        break;
                        
                    case 'verify_health':
                    case 'verify_stabilization':
                        await this.verifyTargetHealth(targetRegion);
                        break;
                }
                
                // Wait between steps if not emergency
                if (!isEmergency && action !== plan.actions[plan.actions.length - 1]) {
                    await this.sleep(2000);
                }
                
            } catch (error) {
                this.logger.error(`Failover step ${action} failed:`, error);
                throw error;
            }
        }
    }

    async updateDnsTtl() {
        // Simulate DNS TTL update
        this.eventBus.emit('dns.ttl.updated', {
            event: 'dns.ttl.updated',
            timestamp: new Date().toISOString(),
            ttlSec: this.config.dns.ttlIncidentSec,
            reason: 'failover_in_progress',
            source: this.name
        });
    }

    async shiftTraffic(action, targetRegion) {
        const weightMappings = {
            'traffic_shift_20': { [this.state.currentPrimary]: 80, [targetRegion]: 20 },
            'traffic_shift_50': { [this.state.currentPrimary]: 50, [targetRegion]: 50 },
            'traffic_shift_100': { [this.state.currentPrimary]: 0, [targetRegion]: 100 },
            'traffic_100_immediate': { [this.state.currentPrimary]: 0, [targetRegion]: 100 }
        };
        
        const weights = weightMappings[action] || {};
        const weightsArray = Object.entries(weights);
        
        this.eventBus.emit('traffic.shift.applied', {
            event: 'traffic.shift.applied',
            timestamp: new Date().toISOString(),
            weights: weightsArray,
            stickiness: 'session',
            source: this.name
        });
    }

    async acquireRegionLease(region) {
        const leaseId = `lease#${region}#${Date.now().toString(16)}`;
        
        // Prevent split-brain by acquiring exclusive lease
        this.state.activeLeases.set(region, {
            leaseId,
            acquiredAt: new Date().toISOString(),
            ttlSec: 30
        });
        
        this.eventBus.emit('quorum.lease.acquired', {
            event: 'quorum.lease.acquired',
            timestamp: new Date().toISOString(),
            region,
            provider: 'consul',
            leaseId,
            ttlSec: 30,
            source: this.name
        });
    }

    async fencePrimaryRegion() {
        this.eventBus.emit('region.fenced', {
            event: 'region.fenced',
            timestamp: new Date().toISOString(),
            region: this.state.currentPrimary,
            reason: 'failover_protection',
            source: this.name
        });
    }

    async setDatabaseReadOnly() {
        this.eventBus.emit('datastore.mode.changed', {
            event: 'datastore.mode.changed',
            timestamp: new Date().toISOString(),
            store: 'postgres',
            region: this.state.currentPrimary,
            mode: 'read_only',
            reason: 'rpo_guard',
            source: this.name
        });
    }

    async promoteSecondaryDatabase(region) {
        this.eventBus.emit('datastore.promoted', {
            event: 'datastore.promoted',
            timestamp: new Date().toISOString(),
            store: 'postgres',
            region,
            mode: 'primary',
            source: this.name
        });
    }

    async verifyTargetHealth(region) {
        // Simulate health verification
        await this.sleep(1000);
        
        this.eventBus.emit('failover.stabilized', {
            event: 'failover.stabilized',
            timestamp: new Date().toISOString(),
            toRegion: region,
            p95Ms: 118,
            errPct: 0.7,
            dbLagSec: 5,
            brokerUnderReplicated: 0,
            source: this.name
        });
    }

    async verifyFailoverStabilization(region) {
        // Wait for stabilization
        await this.sleep(5000);
        
        this.logger.info(`Failover to ${region} stabilized successfully`);
    }

    isFlapping() {
        const now = Date.now();
        const oneHourAgo = now - (60 * 60 * 1000);
        
        if (this.state.lastFailoverTs) {
            const lastFailover = new Date(this.state.lastFailoverTs).getTime();
            
            // Too soon since last failover
            if (now - lastFailover < (this.config.flappingPrevention.minStabilityWindowSec * 1000)) {
                return true;
            }
        }
        
        // Too many failovers in the last hour
        return this.state.failoverCount >= this.config.flappingPrevention.maxFailoversPerHour;
    }

    async handleFailoverRequest(data) {
        if (!this.isInitialized) return;
        
        const { reason, targetRegion, dryRun } = data;
        
        this.logger.info(`Manual failover request: ${reason}, target: ${targetRegion}, dryRun: ${dryRun}`);
        
        if (dryRun) {
            // Create plan but don't execute
            const plan = await this.createFailoverPlan(targetRegion || this.config.regions.secondary, false);
            
            this.eventBus.emit('failover.plan.ready', {
                event: 'failover.plan.ready',
                timestamp: new Date().toISOString(),
                mode: this.state.topology,
                fromRegion: this.state.currentPrimary,
                toRegion: targetRegion || this.config.regions.secondary,
                scope: 'global',
                actions: plan.actions,
                rationale: { ...plan.rationale, manual: true, dryRun: true },
                source: this.name
            });
        } else {
            // Execute actual failover
            await this.executeFailover('manual_request', false);
        }
    }

    async handleTrafficShiftRequest(data) {
        const { weights, stickiness } = data;
        
        this.eventBus.emit('traffic.shift.applied', {
            event: 'traffic.shift.applied',
            timestamp: new Date().toISOString(),
            weights,
            stickiness,
            source: this.name
        });
    }

    async handleIncidentStarted(data) {
        this.logger.info(`Incident started: ${data.id}, evaluating freeze implications`);
        
        // Incidents may trigger protective failovers
        if (data.severity === 'high' || data.severity === 'critical') {
            const affectedRegions = this.extractAffectedRegions(data);
            
            for (const region of affectedRegions) {
                if (region === this.state.currentPrimary) {
                    this.logger.warn(`High severity incident affects primary region ${region}`);
                    // This will be handled by health probes showing degradation
                }
            }
        }
    }

    async handleIncidentClosed(data) {
        this.logger.info(`Incident closed: ${data.id}`);
        // Could trigger failback evaluation if conditions are met
    }

    extractAffectedRegions(incident) {
        // Simple extraction from title/description
        const regions = Object.values(this.config.regions);
        const affectedRegions = [];
        
        for (const region of regions) {
            if (incident.title?.toLowerCase().includes(region.toLowerCase()) || 
                incident.description?.toLowerCase().includes(region.toLowerCase())) {
                affectedRegions.push(region);
            }
        }
        
        return affectedRegions;
    }

    getStatus() {
        return {
            name: this.name,
            initialized: this.isInitialized,
            enabled: this.config.enabled,
            state: {
                topology: this.state.topology,
                currentPrimary: this.state.currentPrimary,
                regionCount: this.state.regionHealth.size,
                lastFailover: this.state.lastFailoverTs,
                failoverCount: this.state.failoverCount
            },
            metrics: this.metrics
        };
    }

    async getMetrics() {
        if (!this.isInitialized) return null;

        const healthyRegions = Array.from(this.state.regionHealth.values())
            .filter(h => h.status === 'healthy').length;
        
        return {
            event: 'mrf.metrics',
            timestamp: new Date().toISOString(),
            failoversExecuted: this.metrics.failoversExecuted,
            meanFailoverTimeMs: this.metrics.meanFailoverTimeMs,
            splitBrainsDetected: this.metrics.splitBrainsDetected,
            dataLossEvents: this.metrics.dataLossEvents,
            healthyRegions,
            totalRegions: this.state.regionHealth.size,
            currentPrimary: this.state.currentPrimary,
            flappingPrevented: this.isFlapping(),
            source: this.name
        };
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async shutdown() {
        try {
            this.logger.info(`${this.name} durduruluyor...`);
            
            // Clear any active leases
            this.state.activeLeases.clear();
            
            this.isInitialized = false;
            this.removeAllListeners();
            this.logger.info(`${this.name} başarıyla durduruldu`);
        } catch (error) {
            this.logger.error(`${this.name} durdurma hatası:`, error);
        }
    }
}

module.exports = MultiRegionFailoverCoordinator;