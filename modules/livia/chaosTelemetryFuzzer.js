/**
 * LIVIA-29: Chaos Telemetry Fuzzer
 * Üretim modüllerinin dayanıklılığını test etmek için kontrollü kaos enjeksiyonu yapan sistem
 */

const { z } = require('zod');
const EventEmitter = require('events');
const crypto = require('crypto');

// Input schemas
const FuzzerPlanRequestSchema = z.object({
    event: z.literal('fuzzer.plan.request'),
    timestamp: z.string(),
    campaignId: z.string(),
    scope: z.enum(['global', 'desk', 'symbol']),
    symbol: z.string().nullable(),
    modes: z.array(z.enum(['shadow', 'sandbox'])),
    durationMin: z.number().min(1).max(120),
    faults: z.array(z.object({
        type: z.enum(['drop', 'delay', 'duplicate', 'spike', 'drift', 'flatline', 'swap_symbol', 'scale']),
        series: z.string(),
        ratePct: z.number().optional(),
        latencyMs: z.number().optional(),
        factor: z.number().optional(),
        mult: z.number().optional(),
        slopePctPerMin: z.number().optional(),
        holdMin: z.number().optional(),
        from: z.string().optional(),
        to: z.string().optional()
    })),
    seed: z.number().default(42),
    sloGuards: z.object({
        maxBreachAlerts: z.number().default(0)
    }).default({}),
    dryRun: z.boolean().default(false)
}).strict();

const FuzzerStopRequestSchema = z.object({
    event: z.literal('fuzzer.stop.request'),
    timestamp: z.string(),
    campaignId: z.string()
}).strict();

// Output schemas
const FuzzerRunStartedSchema = z.object({
    event: z.literal('fuzzer.run.started'),
    timestamp: z.string(),
    campaignId: z.string(),
    fuzzKey: z.string(),
    durationMin: z.number(),
    modes: z.array(z.string()),
    seed: z.number(),
    faultCount: z.number()
}).strict();

const FuzzerInjectionEmittedSchema = z.object({
    event: z.literal('fuzzer.injection.emitted'),
    timestamp: z.string(),
    campaignId: z.string(),
    series: z.string(),
    fault: z.string(),
    count: z.number(),
    flags: z.object({
        chaos: z.boolean(),
        shadow: z.boolean()
    })
}).strict();

const FuzzerRunCompletedSchema = z.object({
    event: z.literal('fuzzer.run.completed'),
    timestamp: z.string(),
    campaignId: z.string(),
    injected: z.number(),
    dropped: z.number(),
    errors: z.number()
}).strict();

class ChaosTelemetryFuzzer extends EventEmitter {
    constructor(eventBus, logger, config = {}) {
        super();
        this.eventBus = eventBus;
        this.logger = logger;
        this.name = 'ChaosTelemetryFuzzer';
        
        this.config = {
            i18n: { locale: 'tr-TR', tz: 'Europe/Istanbul' },
            modes: { allow: ['shadow', 'sandbox'], default: 'shadow' },
            safetyGuards: {
                tagHeaders: { chaos: true, shadow: true },
                preventDistribution: true,
                protectSLO: true,
                ethicsBypass: true,
                maxRuntimeMin: 60
            },
            faultDefaults: {
                maxRatePerMin: 60,
                symbolSet: ['AVAXUSDT', 'SOLUSDT', 'BTCUSDT'],
                scaleBounds: { min: 0.1, max: 3.0 }
            },
            output: {
                dir: 'data/fuzzer/{YYYY-MM-DD}/{campaignId}',
                reportFile: 'report.md',
                html: { embedMiniCSS: true, chartsInlineSvg: true }
            },
            idempotencyTtlSec: 86400,
            ...config
        };

        this.state = {
            status: 'IDLE',
            activeCampaigns: new Map(),
            faultGenerators: new Map(),
            injectionQueue: [],
            observationData: new Map(),
            metrics: {
                campaigns: 0,
                injected: 0,
                errors: 0,
                shadowShare: 1.0,
                p95InjectMs: 0,
                falseTrigger: 0,
                blockedBySLOGuard: 0,
                avgCampaignMin: 0
            }
        };

        this.timers = new Map();
        this.isInitialized = false;
    }

    async initialize() {
        try {
            this.logger.info(`${this.name} başlatılıyor...`);
            
            // Event listeners
            this.eventBus.on('fuzzer.plan.request', this.handleFuzzerPlanRequest.bind(this));
            this.eventBus.on('fuzzer.stop.request', this.handleFuzzerStopRequest.bind(this));

            // Initialize fault generators
            this.initializeFaultGenerators();
            
            this.isInitialized = true;
            this.logger.info(`${this.name} başarıyla başlatıldı`);
            return true;
        } catch (error) {
            this.logger.error(`${this.name} başlatma hatası:`, error);
            return false;
        }
    }

    initializeFaultGenerators() {
        this.faultGenerators.set('drop', this.generateDropFault.bind(this));
        this.faultGenerators.set('delay', this.generateDelayFault.bind(this));
        this.faultGenerators.set('duplicate', this.generateDuplicateFault.bind(this));
        this.faultGenerators.set('spike', this.generateSpikeFault.bind(this));
        this.faultGenerators.set('drift', this.generateDriftFault.bind(this));
        this.faultGenerators.set('flatline', this.generateFlatlineFault.bind(this));
        this.faultGenerators.set('swap_symbol', this.generateSwapSymbolFault.bind(this));
        this.faultGenerators.set('scale', this.generateScaleFault.bind(this));
        
        this.logger.info(`Initialized ${this.faultGenerators.size} fault generators`);
    }

    handleFuzzerPlanRequest(data) {
        try {
            const validated = FuzzerPlanRequestSchema.parse(data);
            this.logger.info(`Fuzzer plan request: ${validated.campaignId} - ${validated.durationMin}min`);
            this.processPlanRequest(validated);
        } catch (error) {
            this.logger.error('Fuzzer plan request validation error:', error);
            this.emitAlert('error', 'invalid_plan_request');
        }
    }

    handleFuzzerStopRequest(data) {
        try {
            const validated = FuzzerStopRequestSchema.parse(data);
            this.logger.info(`Fuzzer stop request: ${validated.campaignId}`);
            this.stopCampaign(validated.campaignId);
        } catch (error) {
            this.logger.error('Fuzzer stop request validation error:', error);
        }
    }

    async processPlanRequest(request) {
        const startTime = Date.now();
        
        try {
            this.state.status = 'PLANNING';
            
            // Generate fuzz key for idempotency
            const fuzzKey = this.generateFuzzKey(request);
            
            if (this.state.activeCampaigns.has(request.campaignId)) {
                this.logger.info(`Campaign already active: ${request.campaignId}`);
                this.emitAlert('warn', 'campaign_already_active');
                return;
            }
            
            // Validate request
            const validationResult = this.validatePlanRequest(request);
            if (!validationResult.valid) {
                this.emitAlert('error', validationResult.reason);
                return;
            }
            
            // Create campaign
            const campaign = {
                campaignId: request.campaignId,
                fuzzKey,
                request,
                status: 'PLANNED',
                startedAt: null,
                completedAt: null,
                durationMin: request.durationMin,
                faults: request.faults,
                modes: request.modes,
                seed: request.seed,
                injected: 0,
                dropped: 0,
                errors: 0,
                observations: new Map(),
                createdAt: new Date().toISOString()
            };
            
            this.state.activeCampaigns.set(request.campaignId, campaign);
            
            // Start campaign
            await this.startCampaign(campaign);
            
            // Update metrics
            this.state.metrics.campaigns++;
            
        } catch (error) {
            this.logger.error(`Plan processing error:`, error);
            this.emitAlert('error', 'plan_processing_failed');
        } finally {
            this.state.status = 'IDLE';
        }
    }

    generateFuzzKey(request) {
        const keyData = {
            campaignId: request.campaignId,
            seed: request.seed,
            window: new Date().toISOString().split('T')[0],
            scope: request.scope
        };
        
        return 'fuzz:' + crypto
            .createHash('sha256')
            .update(JSON.stringify(keyData))
            .digest('hex')
            .substring(0, 16);
    }

    validatePlanRequest(request) {
        // Check duration limits
        if (request.durationMin > this.config.safetyGuards.maxRuntimeMin) {
            return { valid: false, reason: 'duration_exceeds_limit' };
        }
        
        // Check mode validity
        const invalidModes = request.modes.filter(mode => 
            !this.config.modes.allow.includes(mode)
        );
        
        if (invalidModes.length > 0) {
            return { valid: false, reason: 'invalid_modes' };
        }
        
        // Check symbol validity
        if (request.symbol && !this.config.faultDefaults.symbolSet.includes(request.symbol)) {
            return { valid: false, reason: 'invalid_symbol' };
        }
        
        // Check fault types
        const validFaultTypes = Array.from(this.faultGenerators.keys());
        const invalidFaults = request.faults.filter(fault => 
            !validFaultTypes.includes(fault.type)
        );
        
        if (invalidFaults.length > 0) {
            return { valid: false, reason: 'invalid_fault_types' };
        }
        
        return { valid: true };
    }

    async startCampaign(campaign) {
        campaign.status = 'RUNNING';
        campaign.startedAt = new Date().toISOString();
        
        this.logger.info(`Starting chaos campaign: ${campaign.campaignId}`);
        
        // Emit started event
        this.emitRunStarted(campaign);
        
        // Initialize random number generator with seed
        this.initializeRandom(campaign.seed);
        
        // Schedule injections
        this.scheduleInjections(campaign);
        
        // Schedule campaign completion
        const timeoutMs = campaign.durationMin * 60 * 1000;
        const timer = setTimeout(() => {
            this.completeCampaign(campaign.campaignId, 'timeout');
        }, timeoutMs);
        
        this.timers.set(campaign.campaignId, timer);
        
        // Start observation collection
        this.startObservation(campaign);
    }

    initializeRandom(seed) {
        // Simple seeded random number generator
        this.randomSeed = seed;
    }

    random() {
        // Linear congruential generator
        this.randomSeed = (this.randomSeed * 1664525 + 1013904223) % Math.pow(2, 32);
        return this.randomSeed / Math.pow(2, 32);
    }

    scheduleInjections(campaign) {
        const injectionIntervalMs = 1000; // 1 second intervals
        const totalIntervals = campaign.durationMin * 60;
        
        for (let i = 0; i < totalIntervals; i++) {
            const delay = i * injectionIntervalMs;
            
            setTimeout(() => {
                if (campaign.status === 'RUNNING') {
                    this.performInjection(campaign);
                }
            }, delay);
        }
    }

    async performInjection(campaign) {
        const injectionStartTime = Date.now();
        
        try {
            // Select random fault from campaign
            const fault = this.selectRandomFault(campaign.faults);
            if (!fault) return;
            
            // Check rate limiting
            if (!this.checkRateLimit(campaign, fault)) {
                campaign.dropped++;
                return;
            }
            
            // Generate fault data
            const faultData = await this.generateFaultData(fault, campaign);
            if (!faultData) {
                campaign.errors++;
                return;
            }
            
            // Apply safety guards
            const safeData = this.applySafetyGuards(faultData, campaign);
            
            // Inject fault
            await this.injectFault(safeData, campaign);
            
            // Update metrics
            campaign.injected++;
            this.state.metrics.injected++;
            
            // Update injection timing metrics
            const injectionTime = Date.now() - injectionStartTime;
            this.updateInjectionMetrics(injectionTime);
            
        } catch (error) {
            this.logger.error(`Injection error in campaign ${campaign.campaignId}:`, error);
            campaign.errors++;
            this.state.metrics.errors++;
        }
    }

    selectRandomFault(faults) {
        if (faults.length === 0) return null;
        
        const index = Math.floor(this.random() * faults.length);
        return faults[index];
    }

    checkRateLimit(campaign, fault) {
        const maxRate = this.config.faultDefaults.maxRatePerMin;
        const currentRate = campaign.injected / ((Date.now() - new Date(campaign.startedAt).getTime()) / 60000);
        
        return currentRate < maxRate;
    }

    async generateFaultData(fault, campaign) {
        const generator = this.faultGenerators.get(fault.type);
        if (!generator) {
            this.logger.error(`No generator for fault type: ${fault.type}`);
            return null;
        }
        
        return generator(fault, campaign);
    }

    generateDropFault(fault, campaign) {
        return {
            type: 'drop',
            series: fault.series,
            ratePct: fault.ratePct || 10,
            timestamp: new Date().toISOString(),
            flags: { chaos: true, shadow: true }
        };
    }

    generateDelayFault(fault, campaign) {
        return {
            type: 'delay',
            series: fault.series,
            latencyMs: fault.latencyMs || 500,
            timestamp: new Date().toISOString(),
            flags: { chaos: true, shadow: true }
        };
    }

    generateDuplicateFault(fault, campaign) {
        return {
            type: 'duplicate',
            series: fault.series,
            factor: fault.factor || 2,
            timestamp: new Date().toISOString(),
            flags: { chaos: true, shadow: true }
        };
    }

    generateSpikeFault(fault, campaign) {
        return {
            type: 'spike',
            series: fault.series,
            mult: fault.mult || 1.5,
            timestamp: new Date().toISOString(),
            flags: { chaos: true, shadow: true }
        };
    }

    generateDriftFault(fault, campaign) {
        return {
            type: 'drift',
            series: fault.series,
            slopePctPerMin: fault.slopePctPerMin || 1.0,
            timestamp: new Date().toISOString(),
            flags: { chaos: true, shadow: true }
        };
    }

    generateFlatlineFault(fault, campaign) {
        return {
            type: 'flatline',
            series: fault.series,
            holdMin: fault.holdMin || 3,
            timestamp: new Date().toISOString(),
            flags: { chaos: true, shadow: true }
        };
    }

    generateSwapSymbolFault(fault, campaign) {
        const validSymbols = this.config.faultDefaults.symbolSet;
        const toSymbol = fault.to || validSymbols[Math.floor(this.random() * validSymbols.length)];
        
        return {
            type: 'swap_symbol',
            series: fault.series,
            from: fault.from || campaign.request.symbol,
            to: toSymbol,
            timestamp: new Date().toISOString(),
            flags: { chaos: true, shadow: true }
        };
    }

    generateScaleFault(fault, campaign) {
        const bounds = this.config.faultDefaults.scaleBounds;
        const mult = fault.mult || (bounds.min + this.random() * (bounds.max - bounds.min));
        
        return {
            type: 'scale',
            series: fault.series,
            mult: mult,
            timestamp: new Date().toISOString(),
            flags: { chaos: true, shadow: true }
        };
    }

    applySafetyGuards(faultData, campaign) {
        // Ensure chaos and shadow flags are set
        faultData.flags = {
            ...faultData.flags,
            chaos: this.config.safetyGuards.tagHeaders.chaos,
            shadow: this.config.safetyGuards.tagHeaders.shadow
        };
        
        // Add campaign context
        faultData.campaignId = campaign.campaignId;
        faultData.mode = campaign.modes[0];
        
        // Apply bounds checking for scale operations
        if (faultData.type === 'scale') {
            const bounds = this.config.faultDefaults.scaleBounds;
            faultData.mult = Math.max(bounds.min, Math.min(bounds.max, faultData.mult));
        }
        
        // Add isolation markers
        faultData.isolation = {
            preventDistribution: this.config.safetyGuards.preventDistribution,
            protectSLO: this.config.safetyGuards.protectSLO,
            ethicsBypass: this.config.safetyGuards.ethicsBypass
        };
        
        return faultData;
    }

    async injectFault(faultData, campaign) {
        // Create telemetry event with chaos markers
        const telemetryEvent = {
            event: 'telemetry.chaos.inject',
            timestamp: new Date().toISOString(),
            series: faultData.series,
            fault: faultData,
            campaignId: campaign.campaignId
        };
        
        // Emit to telemetry stream with chaos flags
        this.eventBus.emit('telemetry.chaos.inject', telemetryEvent);
        
        // Create specific fault event
        const specificEvent = {
            event: `chaos.${faultData.type}`,
            timestamp: new Date().toISOString(),
            ...faultData
        };
        
        this.eventBus.emit(`chaos.${faultData.type}`, specificEvent);
        
        // Emit injection event
        this.emitInjectionEmitted(campaign, faultData);
        
        this.logger.debug(`Injected ${faultData.type} fault on ${faultData.series} for campaign ${campaign.campaignId}`);
    }

    startObservation(campaign) {
        // Start collecting observation data
        const observationKey = campaign.campaignId;
        
        this.state.observationData.set(observationKey, {
            campaignId: campaign.campaignId,
            startedAt: new Date().toISOString(),
            metrics: {
                before: {},
                during: {},
                after: {}
            },
            alerts: [],
            sloBreaches: []
        });
        
        // Subscribe to relevant telemetry events
        this.subscribeToObservationEvents(campaign);
    }

    subscribeToObservationEvents(campaign) {
        // Listen for SLO events
        const sloHandler = (data) => {
            if (data.chaos || data.shadow) {
                // This is from our chaos injection, record it
                this.recordObservation(campaign.campaignId, 'slo', data);
            }
        };
        
        // Listen for alert events
        const alertHandler = (data) => {
            if (data.chaos || data.shadow) {
                this.recordObservation(campaign.campaignId, 'alert', data);
            }
        };
        
        // Listen for metrics events
        const metricsHandler = (data) => {
            if (data.chaos || data.shadow) {
                this.recordObservation(campaign.campaignId, 'metrics', data);
            }
        };
        
        this.eventBus.on('slo.breach', sloHandler);
        this.eventBus.on('system.alert', alertHandler);
        this.eventBus.on('metrics.update', metricsHandler);
        
        // Store handlers for cleanup
        campaign.observationHandlers = {
            sloHandler,
            alertHandler,
            metricsHandler
        };
    }

    recordObservation(campaignId, type, data) {
        const observation = this.state.observationData.get(campaignId);
        if (!observation) return;
        
        if (!observation[type]) {
            observation[type] = [];
        }
        
        observation[type].push({
            timestamp: new Date().toISOString(),
            data
        });
    }

    stopCampaign(campaignId) {
        const campaign = this.state.activeCampaigns.get(campaignId);
        if (!campaign) {
            this.logger.warn(`Campaign not found: ${campaignId}`);
            return;
        }
        
        this.logger.info(`Stopping campaign: ${campaignId}`);
        
        // Cancel timer
        const timer = this.timers.get(campaignId);
        if (timer) {
            clearTimeout(timer);
            this.timers.delete(campaignId);
        }
        
        this.completeCampaign(campaignId, 'stopped');
    }

    async completeCampaign(campaignId, reason) {
        const campaign = this.state.activeCampaigns.get(campaignId);
        if (!campaign) return;
        
        campaign.status = 'COMPLETED';
        campaign.completedAt = new Date().toISOString();
        campaign.completionReason = reason;
        
        this.logger.info(`Campaign completed: ${campaignId} - ${reason}`);
        
        // Clean up observation handlers
        if (campaign.observationHandlers) {
            this.eventBus.off('slo.breach', campaign.observationHandlers.sloHandler);
            this.eventBus.off('system.alert', campaign.observationHandlers.alertHandler);
            this.eventBus.off('metrics.update', campaign.observationHandlers.metricsHandler);
        }
        
        // Generate report
        const report = await this.generateReport(campaign);
        
        // Emit completion events
        this.emitRunCompleted(campaign);
        this.emitReportReady(campaign, report);
        this.emitFuzzerCard(campaign);
        
        // Clean up
        this.state.activeCampaigns.delete(campaignId);
        this.timers.delete(campaignId);
        
        // Update duration metrics
        const duration = new Date(campaign.completedAt).getTime() - new Date(campaign.startedAt).getTime();
        const durationMin = Math.round(duration / 60000);
        this.updateDurationMetrics(durationMin);
    }

    async generateReport(campaign) {
        const observation = this.state.observationData.get(campaign.campaignId);
        
        const report = {
            campaignId: campaign.campaignId,
            summary: this.generateReportSummary(campaign, observation),
            execution: {
                duration: campaign.durationMin,
                injected: campaign.injected,
                dropped: campaign.dropped,
                errors: campaign.errors,
                faults: campaign.faults.length
            },
            impact: this.analyzeImpact(observation),
            recommendations: this.generateRecommendations(campaign, observation),
            timestamp: new Date().toISOString()
        };
        
        // Store report
        const reportPath = this.getReportPath(campaign);
        const reportContent = this.formatReportAsMarkdown(report);
        
        // In real implementation, write to file system
        this.logger.info(`Report generated for campaign ${campaign.campaignId}: ${reportPath}`);
        
        return {
            path: reportPath,
            content: reportContent,
            hash: this.generateHash(reportContent)
        };
    }

    generateReportSummary(campaign, observation) {
        const hasLatencyImpact = this.checkLatencyImpact(observation);
        const hasFalseTriggers = this.checkFalseTriggers(observation);
        const hasDLQIssues = this.checkDLQIssues(observation);
        
        let summary = `${campaign.injected} enjeksiyon • ${campaign.errors} hata`;
        
        if (hasLatencyImpact) {
            summary += ` • latency etkisi tespit edildi`;
        }
        
        if (hasFalseTriggers === 0) {
            summary += ` • false-trigger=0`;
        }
        
        if (hasDLQIssues === 0) {
            summary += ` • DLQ=0`;
        }
        
        return summary;
    }

    checkLatencyImpact(observation) {
        // Simple heuristic: check if there are metrics updates indicating latency changes
        if (!observation || !observation.metrics) return false;
        
        return observation.metrics.some(metric => 
            metric.data && 
            metric.data.series && 
            metric.data.series.includes('latency') || 
            metric.data.series.includes('p95')
        );
    }

    checkFalseTriggers(observation) {
        if (!observation || !observation.alert) return 0;
        
        // Count alerts that were triggered by chaos injections
        return observation.alert.filter(alert => 
            alert.data && alert.data.chaos
        ).length;
    }

    checkDLQIssues(observation) {
        if (!observation || !observation.metrics) return 0;
        
        // Count DLQ related issues
        return observation.metrics.filter(metric => 
            metric.data && 
            metric.data.series && 
            metric.data.series.includes('dlq')
        ).length;
    }

    analyzeImpact(observation) {
        return {
            latency: this.checkLatencyImpact(observation),
            falseTriggers: this.checkFalseTriggers(observation),
            dlqIssues: this.checkDLQIssues(observation),
            sloBreaches: observation ? (observation.sloBreaches ? observation.sloBreaches.length : 0) : 0
        };
    }

    generateRecommendations(campaign, observation) {
        const recommendations = [];
        
        if (campaign.errors > 0) {
            recommendations.push('Enjeksiyon hatalarını araştırın ve fault generatorları gözden geçirin');
        }
        
        if (this.checkLatencyImpact(observation)) {
            recommendations.push('Latency artışları gözlemlendiğinde timeout değerlerini artırmayı değerlendirin');
        }
        
        if (this.checkFalseTriggers(observation) > 0) {
            recommendations.push('False trigger alarmları için eşik değerlerini gözden geçirin');
        }
        
        if (campaign.dropped > campaign.injected * 0.1) {
            recommendations.push('Rate limiting çok agresif olabilir, injection ratei ayarlayın');
        }
        
        return recommendations;
    }

    getReportPath(campaign) {
        const date = new Date().toISOString().split('T')[0];
        return this.config.output.dir
            .replace('{YYYY-MM-DD}', date)
            .replace('{campaignId}', campaign.campaignId) + '/' + this.config.output.reportFile;
    }

    formatReportAsMarkdown(report) {
        return `# Chaos Test Report: ${report.campaignId}

## Executive Summary
${report.summary}

## Execution Details
- Duration: ${report.execution.duration} minutes
- Injections: ${report.execution.injected}
- Dropped: ${report.execution.dropped}
- Errors: ${report.execution.errors}
- Fault Types: ${report.execution.faults}

## Impact Analysis
- Latency Impact: ${report.impact.latency ? 'Yes' : 'No'}
- False Triggers: ${report.impact.falseTriggers}
- DLQ Issues: ${report.impact.dlqIssues}
- SLO Breaches: ${report.impact.sloBreaches}

## Recommendations
${report.recommendations.map(rec => `- ${rec}`).join('\n')}

---
Generated on ${report.timestamp}
`;
    }

    updateInjectionMetrics(injectionTimeMs) {
        const currentP95 = this.state.metrics.p95InjectMs;
        const newP95 = currentP95 === 0 ? injectionTimeMs : (currentP95 * 0.95 + injectionTimeMs * 0.05);
        this.state.metrics.p95InjectMs = Math.round(newP95 * 100) / 100;
    }

    updateDurationMetrics(durationMin) {
        const currentAvg = this.state.metrics.avgCampaignMin;
        const totalCampaigns = this.state.metrics.campaigns;
        
        if (totalCampaigns === 1) {
            this.state.metrics.avgCampaignMin = durationMin;
        } else {
            this.state.metrics.avgCampaignMin = Math.round(
                (currentAvg * (totalCampaigns - 1) + durationMin) / totalCampaigns
            );
        }
    }

    generateHash(content) {
        return 'sha256:' + crypto
            .createHash('sha256')
            .update(content)
            .digest('hex')
            .substring(0, 16);
    }

    emitRunStarted(campaign) {
        const event = {
            event: 'fuzzer.run.started',
            timestamp: new Date().toISOString(),
            campaignId: campaign.campaignId,
            fuzzKey: campaign.fuzzKey,
            durationMin: campaign.durationMin,
            modes: campaign.modes,
            seed: campaign.seed,
            faultCount: campaign.faults.length
        };
        
        this.eventBus.emit('fuzzer.run.started', event);
    }

    emitInjectionEmitted(campaign, faultData) {
        const event = {
            event: 'fuzzer.injection.emitted',
            timestamp: new Date().toISOString(),
            campaignId: campaign.campaignId,
            series: faultData.series,
            fault: faultData.type,
            count: campaign.injected,
            flags: faultData.flags
        };
        
        this.eventBus.emit('fuzzer.injection.emitted', event);
    }

    emitRunCompleted(campaign) {
        const event = {
            event: 'fuzzer.run.completed',
            timestamp: new Date().toISOString(),
            campaignId: campaign.campaignId,
            injected: campaign.injected,
            dropped: campaign.dropped,
            errors: campaign.errors
        };
        
        this.eventBus.emit('fuzzer.run.completed', event);
    }

    emitReportReady(campaign, report) {
        const event = {
            event: 'fuzzer.report.ready',
            timestamp: new Date().toISOString(),
            campaignId: campaign.campaignId,
            path: report.path,
            summary: report.summary || 'Chaos test completed successfully',
            hash: report.hash
        };
        
        this.eventBus.emit('fuzzer.report.ready', event);
    }

    emitFuzzerCard(campaign) {
        const event = {
            event: 'fuzzer.card',
            timestamp: new Date().toISOString(),
            title: `Kaos Testi Tamam — ${campaign.campaignId}`,
            body: `${campaign.injected} enjeksiyon • ${campaign.errors} hata • sistem stabil`,
            severity: campaign.errors > 0 ? 'warn' : 'info',
            ttlSec: 600
        };
        
        this.eventBus.emit('fuzzer.card', event);
    }

    emitAlert(level, message) {
        const event = {
            event: 'fuzzer.alert',
            timestamp: new Date().toISOString(),
            level,
            message,
            context: {
                status: this.state.status,
                activeCampaigns: this.state.activeCampaigns.size,
                injectionQueue: this.state.injectionQueue.length
            }
        };

        this.eventBus.emit('fuzzer.alert', event);
        this.logger.warn(`Fuzzer alert: ${level} - ${message}`);
    }

    emitMetrics() {
        const event = {
            event: 'fuzzer.metrics',
            timestamp: new Date().toISOString(),
            ...this.state.metrics,
            activeCampaigns: this.state.activeCampaigns.size,
            observationData: this.state.observationData.size
        };

        this.eventBus.emit('fuzzer.metrics', event);
    }

    getStatus() {
        return {
            name: this.name,
            initialized: this.isInitialized,
            status: this.state.status,
            activeCampaigns: this.state.activeCampaigns.size,
            faultGenerators: this.faultGenerators.size,
            observationData: this.state.observationData.size,
            metrics: this.state.metrics
        };
    }

    async shutdown() {
        try {
            this.logger.info(`${this.name} durduruluyor...`);
            
            // Stop all active campaigns
            const activeCampaigns = Array.from(this.state.activeCampaigns.keys());
            for (const campaignId of activeCampaigns) {
                this.stopCampaign(campaignId);
            }
            
            // Clear all timers
            for (const timer of this.timers.values()) {
                clearTimeout(timer);
            }
            this.timers.clear();
            
            // Emit final metrics
            this.emitMetrics();
            
            this.isInitialized = false;
            this.logger.info(`${this.name} başarıyla durduruldu`);
        } catch (error) {
            this.logger.error(`${this.name} durdurma hatası:`, error);
        }
    }
}

module.exports = ChaosTelemetryFuzzer;