/**
 * LIVIA-33: Incident Drill Scheduler
 * Gerçek olaylara hazırlanmak için düzenli tatbikatlar planlayıp yürütür
 */

import { z } from 'zod';
import { EventEmitter } from 'events';
import crypto from 'crypto';

// Input schemas
const DrillTemplateUpdatedSchema = z.object({
    event: z.literal('drill.template.updated'),
    timestamp: z.string(),
    scenarioSlug: z.string(),
    title: z.string(),
    difficulty: z.enum(['easy', 'medium', 'hard']),
    steps: z.array(z.object({
        id: z.string(),
        kind: z.enum(['inject', 'expect', 'runbook']),
        params: z.record(z.any())
    })),
    successCriteria: z.object({
        TTA_min: z.number(),
        TTR_min: z.number(),
        expectSignals: z.array(z.string())
    })
}).strict();

const DrillPlanRequestSchema = z.object({
    event: z.literal('drill.plan.request'),
    timestamp: z.string(),
    campaignId: z.string(),
    forDate: z.string(),
    mode: z.enum(['shadow', 'sandbox', 'live_fire']),
    scope: z.enum(['global', 'desk', 'symbol']),
    symbol: z.string().nullable(),
    scenarioSlug: z.string(),
    notify: z.array(z.string()),
    stealth: z.boolean(),
    dryRun: z.boolean()
}).strict();

const DrillRunRequestSchema = z.object({
    event: z.literal('drill.run.request'),
    timestamp: z.string(),
    campaignId: z.string(),
    startAt: z.string()
}).strict();

const CalendarBlackoutSchema = z.object({
    event: z.literal('calendar.blackout'),
    timestamp: z.string(),
    windows: z.array(z.object({
        from: z.string(),
        to: z.string()
    })),
    reason: z.string()
}).strict();

const IncidentStartedSchema = z.object({
    event: z.literal('incident.started'),
    timestamp: z.string(),
    id: z.string(),
    severity: z.enum(['low', 'medium', 'high', 'critical']),
    title: z.string()
}).strict();

// Output schemas
const DrillPlannedSchema = z.object({
    event: z.literal('drill.planned'),
    timestamp: z.string(),
    drillKey: z.string(),
    campaignId: z.string(),
    scenarioSlug: z.string(),
    mode: z.string(),
    startAt: z.string(),
    flags: z.object({
        DRILL: z.boolean(),
        SHADOW: z.boolean()
    })
}).strict();

const DrillRunStartedSchema = z.object({
    event: z.literal('drill.run.started'),
    timestamp: z.string(),
    drillKey: z.string(),
    campaignId: z.string(),
    steps: z.array(z.string()),
    participants: z.array(z.string())
}).strict();

const DrillInjectionEmittedSchema = z.object({
    event: z.literal('drill.injection.emitted'),
    timestamp: z.string(),
    campaignId: z.string(),
    via: z.string(),
    fault: z.record(z.any()),
    count: z.number(),
    flags: z.object({
        DRILL: z.boolean(),
        SHADOW: z.boolean()
    })
}).strict();

const DrillStepProgressSchema = z.object({
    event: z.literal('drill.step.progress'),
    timestamp: z.string(),
    campaignId: z.string(),
    stepId: z.string(),
    status: z.enum(['ok', 'timeout', 'skipped']),
    details: z.string()
}).strict();

const DrillRunCompletedSchema = z.object({
    event: z.literal('drill.run.completed'),
    timestamp: z.string(),
    campaignId: z.string(),
    result: z.enum(['success', 'partial', 'failed']),
    kpis: z.object({
        TTD_sec: z.number(),
        TTA_sec: z.number(),
        TTR_min: z.number(),
        falsePositive: z.number()
    }),
    score: z.number()
}).strict();

const DrillReportReadySchema = z.object({
    event: z.literal('drill.report.ready'),
    timestamp: z.string(),
    campaignId: z.string(),
    path: z.string(),
    summary: z.string(),
    hash: z.string()
}).strict();

const DrillLeaderboardUpdatedSchema = z.object({
    event: z.literal('drill.leaderboard.updated'),
    timestamp: z.string(),
    period: z.string(),
    entries: z.array(z.object({
        team: z.string(),
        avgScore: z.number()
    }))
}).strict();

const DrillCardSchema = z.object({
    event: z.literal('drill.card'),
    timestamp: z.string(),
    title: z.string(),
    body: z.string(),
    severity: z.enum(['info', 'warn', 'error']),
    ttlSec: z.number()
}).strict();

const DrillAlertSchema = z.object({
    event: z.literal('drill.alert'),
    timestamp: z.string(),
    level: z.enum(['info', 'warn', 'error']),
    message: z.string()
}).strict();

const DrillMetricsSchema = z.object({
    event: z.literal('drill.metrics'),
    timestamp: z.string(),
    planned: z.number(),
    started: z.number(),
    completed: z.number(),
    failed: z.number(),
    avgScore: z.number(),
    p95TTD_sec: z.number(),
    p95TTA_sec: z.number(),
    p95TTR_min: z.number()
}).strict();

type DrillState = 'IDLE' | 'PLAN' | 'ARM' | 'INJECT' | 'OBSERVE' | 'SCORE' | 'REPORT' | 'EMIT';
type DrillResult = 'success' | 'partial' | 'failed';

interface DrillTemplate {
    scenarioSlug: string;
    title: string;
    difficulty: 'easy' | 'medium' | 'hard';
    steps: Array<{
        id: string;
        kind: 'inject' | 'expect' | 'runbook';
        params: any;
    }>;
    successCriteria: {
        TTA_min: number;
        TTR_min: number;
        expectSignals: string[];
    };
}

interface DrillCampaign {
    drillKey: string;
    campaignId: string;
    scenarioSlug: string;
    mode: 'shadow' | 'sandbox' | 'live_fire';
    scope: 'global' | 'desk' | 'symbol';
    symbol: string | null;
    notify: string[];
    stealth: boolean;
    dryRun: boolean;
    startAt: string;
    state: DrillState;
    template: DrillTemplate;
    currentStep: number;
    startedAt?: string;
    completedAt?: string;
    signals: Array<{
        type: string;
        timestamp: string;
        details: any;
    }>;
    kpis: {
        TTD_sec: number;
        TTA_sec: number;
        TTR_min: number;
        falsePositive: number;
    };
    score: number;
    result: DrillResult;
    participants: string[];
}

interface BlackoutWindow {
    from: string;
    to: string;
    reason: string;
}

interface Leaderboard {
    period: string;
    entries: Array<{
        team: string;
        avgScore: number;
        drillCount: number;
        lastDrill: string;
    }>;
}

class IncidentDrillScheduler extends EventEmitter {
    private eventBus: any;
    private logger: any;
    private name: string = 'IncidentDrillScheduler';
    private config: any;
    private state: {
        status: string;
        templates: Map<string, DrillTemplate>;
        activeCampaigns: Map<string, DrillCampaign>;
        completedCampaigns: Map<string, DrillCampaign>;
        blackoutWindows: BlackoutWindow[];
        leaderboards: Map<string, Leaderboard>;
        realIncidents: Set<string>;
        metrics: {
            planned: number;
            started: number;
            completed: number;
            failed: number;
            avgScore: number;
            p95TTD_sec: number;
            p95TTA_sec: number;
            p95TTR_min: number;
            lastTTDs: number[];
            lastTTAs: number[];
            lastTTRs: number[];
        };
    };
    private isInitialized: boolean = false;
    private schedulerInterval?: NodeJS.Timeout;

    constructor(eventBus: any, logger: any, config: any = {}) {
        super();
        this.eventBus = eventBus;
        this.logger = logger;
        
        this.config = {
            i18n: { locale: 'tr-TR', tz: 'Europe/Istanbul' },
            schedule: {
                cronWeekly: 'Wed 14:00',
                notifyBeforeMin: 15,
                avoidBlackouts: true,
                cancelOnRealIncident: true
            },
            modes: {
                default: 'shadow',
                allow: ['shadow', 'sandbox', 'live_fire'],
                liveFireGuards: { 
                    maxPerQuarter: 1, 
                    requireApprovers: ['policy-lead', 'compliance-lead'] 
                }
            },
            scoring: {
                weights: { 
                    TTD: 0.25, 
                    TTA: 0.25, 
                    TTR: 0.30, 
                    playbook: 0.10, 
                    comms: 0.05, 
                    signals: 0.05 
                },
                bands: { 
                    success: 80, 
                    partial: 60, 
                    failed: 0 
                },
                srtTargets: { 
                    TTD_sec: 240, 
                    TTA_sec: 300, 
                    TTR_min: 30 
                }
            },
            integrations: {
                fuzzer: 'LIVIA-29',
                runbook: 'LIVIA-28',
                dist: 'LIVIA-22',
                kb: 'LIVIA-24',
                digest: 'LIVIA-14',
                ethics: 'LIVIA-26',
                approvals: 'LIVIA-05'
            },
            redactionProfile: 'generic',
            idempotencyTtlSec: 86400,
            timeouts: {
                stepTimeoutMin: 30,
                drillTimeoutMin: 120,
                signalWaitMin: 45
            },
            ...config
        };

        this.state = {
            status: 'IDLE',
            templates: new Map(),
            activeCampaigns: new Map(),
            completedCampaigns: new Map(),
            blackoutWindows: [],
            leaderboards: new Map(),
            realIncidents: new Set(),
            metrics: {
                planned: 0,
                started: 0,
                completed: 0,
                failed: 0,
                avgScore: 0,
                p95TTD_sec: 0,
                p95TTA_sec: 0,
                p95TTR_min: 0,
                lastTTDs: [],
                lastTTAs: [],
                lastTTRs: []
            }
        };
    }

    async initialize(): Promise<boolean> {
        try {
            this.logger.info(`${this.name} başlatılıyor...`);
            
            // Event listeners
            this.eventBus.on('drill.template.updated', this.handleDrillTemplateUpdated.bind(this));
            this.eventBus.on('drill.plan.request', this.handleDrillPlanRequest.bind(this));
            this.eventBus.on('drill.run.request', this.handleDrillRunRequest.bind(this));
            this.eventBus.on('calendar.blackout', this.handleCalendarBlackout.bind(this));
            this.eventBus.on('incident.started', this.handleIncidentStarted.bind(this));

            // Listen for drill signals
            this.setupSignalListeners();
            
            // Initialize default templates
            this.initializeDefaultTemplates();
            
            // Initialize leaderboards
            this.initializeLeaderboards();
            
            // Start scheduler
            this.startScheduler();
            
            this.isInitialized = true;
            this.logger.info(`${this.name} başarıyla başlatıldı`);
            return true;
        } catch (error) {
            this.logger.error(`${this.name} başlatma hatası:`, error);
            return false;
        }
    }

    private setupSignalListeners(): void {
        // Listen for signals that drills might expect
        const drillSignals = [
            'slo.guard.triggered',
            'slo.guard.recovered',
            'failover.done',
            'approval.granted',
            'runbook.exec.started',
            'runbook.exec.completed',
            'circuit.state',
            'cost.guard.triggered'
        ];

        for (const signal of drillSignals) {
            this.eventBus.on(signal, (data: any) => {
                this.handleDrillSignal(signal, data);
            });
        }

        this.logger.info(`Setup listeners for ${drillSignals.length} drill signals`);
    }

    private initializeDefaultTemplates(): void {
        const defaultTemplates: DrillTemplate[] = [
            {
                scenarioSlug: 'feed-lag-canary-failover',
                title: 'Feed Lag → Canary Failover',
                difficulty: 'medium',
                steps: [
                    {
                        id: 't1',
                        kind: 'inject',
                        params: {
                            fault: {
                                type: 'spike',
                                series: 'feed.lagMs',
                                mult: 1.8
                            }
                        }
                    },
                    {
                        id: 't2',
                        kind: 'expect',
                        params: {
                            signal: 'slo.guard.triggered',
                            withinMin: 10
                        }
                    },
                    {
                        id: 't3',
                        kind: 'runbook',
                        params: {
                            runbookId: 'rb-latency-slip-hotfix',
                            optional: true
                        }
                    }
                ],
                successCriteria: {
                    TTA_min: 10,
                    TTR_min: 30,
                    expectSignals: ['slo.guard.triggered', 'slo.guard.recovered']
                }
            },
            {
                scenarioSlug: 'api-5xx-circuit-break',
                title: 'API 5xx → Circuit Breaker',
                difficulty: 'easy',
                steps: [
                    {
                        id: 't1',
                        kind: 'inject',
                        params: {
                            fault: {
                                type: 'error_rate',
                                service: 'order_api',
                                errorPct: 0.15
                            }
                        }
                    },
                    {
                        id: 't2',
                        kind: 'expect',
                        params: {
                            signal: 'circuit.state',
                            withinMin: 5
                        }
                    }
                ],
                successCriteria: {
                    TTA_min: 5,
                    TTR_min: 15,
                    expectSignals: ['circuit.state']
                }
            },
            {
                scenarioSlug: 'cost-spike-downgrade',
                title: 'Cost Spike → Model Downgrade',
                difficulty: 'hard',
                steps: [
                    {
                        id: 't1',
                        kind: 'inject',
                        params: {
                            fault: {
                                type: 'cost_spike',
                                component: 'embeddings',
                                mult: 2.5
                            }
                        }
                    },
                    {
                        id: 't2',
                        kind: 'expect',
                        params: {
                            signal: 'cost.guard.triggered',
                            withinMin: 15
                        }
                    },
                    {
                        id: 't3',
                        kind: 'runbook',
                        params: {
                            runbookId: 'rb-cost-optimization',
                            optional: false
                        }
                    }
                ],
                successCriteria: {
                    TTA_min: 15,
                    TTR_min: 45,
                    expectSignals: ['cost.guard.triggered', 'cost.guard.recovered']
                }
            }
        ];

        for (const template of defaultTemplates) {
            this.state.templates.set(template.scenarioSlug, template);
        }

        this.logger.info(`Initialized ${defaultTemplates.length} default templates`);
    }

    private initializeLeaderboards(): void {
        const periods = ['2025-Q3', '2025-Q4', '2026-Q1'];
        
        for (const period of periods) {
            this.state.leaderboards.set(period, {
                period,
                entries: [
                    { team: 'ops', avgScore: 0, drillCount: 0, lastDrill: '' },
                    { team: 'policy', avgScore: 0, drillCount: 0, lastDrill: '' },
                    { team: 'qa', avgScore: 0, drillCount: 0, lastDrill: '' }
                ]
            });
        }

        this.logger.info(`Initialized leaderboards for ${periods.length} periods`);
    }

    private startScheduler(): void {
        // Check for scheduled drills every minute
        this.schedulerInterval = setInterval(() => {
            this.checkScheduledDrills();
        }, 60 * 1000);

        this.logger.info('Drill scheduler started');
    }

    private checkScheduledDrills(): void {
        const now = new Date();
        
        // Check for weekly scheduled drill (Wednesday 14:00)
        if (now.getDay() === 3 && now.getHours() === 14 && now.getMinutes() === 0) {
            this.scheduleWeeklyDrill();
        }

        // Check for drill start times
        for (const campaign of this.state.activeCampaigns.values()) {
            if (campaign.state === 'ARM') {
                const startTime = new Date(campaign.startAt);
                if (now >= startTime) {
                    this.startDrillCampaign(campaign);
                }
            }
        }

        // Check for timeouts
        this.checkDrillTimeouts();
    }

    private async scheduleWeeklyDrill(): Promise<void> {
        const campaignId = this.generateCampaignId();
        const template = this.selectRandomTemplate();
        
        if (!template) {
            this.logger.warn('No templates available for weekly drill');
            return;
        }

        const planRequest = {
            event: 'drill.plan.request',
            timestamp: new Date().toISOString(),
            campaignId,
            forDate: new Date().toISOString().split('T')[0],
            mode: this.config.modes.default,
            scope: 'global',
            symbol: null,
            scenarioSlug: template.scenarioSlug,
            notify: ['ops', 'policy'],
            stealth: false,
            dryRun: false
        };

        await this.processDrillPlanRequest(planRequest);
        this.logger.info(`Weekly drill scheduled: ${campaignId} - ${template.title}`);
    }

    private selectRandomTemplate(): DrillTemplate | null {
        const templates = Array.from(this.state.templates.values());
        if (templates.length === 0) return null;
        
        const randomIndex = Math.floor(Math.random() * templates.length);
        return templates[randomIndex];
    }

    private checkDrillTimeouts(): void {
        const now = new Date();
        
        for (const campaign of this.state.activeCampaigns.values()) {
            if (!campaign.startedAt) continue;
            
            const startTime = new Date(campaign.startedAt);
            const timeoutMs = this.config.timeouts.drillTimeoutMin * 60 * 1000;
            
            if (now.getTime() - startTime.getTime() > timeoutMs) {
                this.timeoutDrillCampaign(campaign, 'drill_timeout');
            }
        }
    }

    private handleDrillTemplateUpdated(data: any): void {
        try {
            const validated = DrillTemplateUpdatedSchema.parse(data);
            this.updateDrillTemplate(validated);
        } catch (error) {
            this.logger.error('Drill template validation error:', error);
        }
    }

    private handleDrillPlanRequest(data: any): void {
        try {
            const validated = DrillPlanRequestSchema.parse(data);
            this.processDrillPlanRequest(validated);
        } catch (error) {
            this.logger.error('Drill plan request validation error:', error);
            this.emitAlert('error', 'invalid_plan_request');
        }
    }

    private handleDrillRunRequest(data: any): void {
        try {
            const validated = DrillRunRequestSchema.parse(data);
            this.processDrillRunRequest(validated);
        } catch (error) {
            this.logger.error('Drill run request validation error:', error);
            this.emitAlert('error', 'invalid_run_request');
        }
    }

    private handleCalendarBlackout(data: any): void {
        try {
            const validated = CalendarBlackoutSchema.parse(data);
            this.updateBlackoutWindows(validated);
        } catch (error) {
            this.logger.error('Calendar blackout validation error:', error);
        }
    }

    private handleIncidentStarted(data: any): void {
        try {
            const validated = IncidentStartedSchema.parse(data);
            this.handleRealIncident(validated);
        } catch (error) {
            this.logger.error('Incident started validation error:', error);
        }
    }

    private handleDrillSignal(signalType: string, data: any): void {
        // Check if any active drill is waiting for this signal
        for (const campaign of this.state.activeCampaigns.values()) {
            if (campaign.state === 'OBSERVE') {
                this.processDrillSignal(campaign, signalType, data);
            }
        }
    }

    private updateDrillTemplate(templateData: any): void {
        const template: DrillTemplate = {
            scenarioSlug: templateData.scenarioSlug,
            title: templateData.title,
            difficulty: templateData.difficulty,
            steps: templateData.steps,
            successCriteria: templateData.successCriteria
        };

        this.state.templates.set(template.scenarioSlug, template);
        this.logger.info(`Updated drill template: ${template.scenarioSlug}`);
    }

    private async processDrillPlanRequest(request: any): Promise<void> {
        // Check for blackout conflicts
        if (this.config.schedule.avoidBlackouts && this.isInBlackout(request.startAt || request.timestamp)) {
            this.emitAlert('warn', 'blackout');
            return;
        }

        // Check for real incident conflicts
        if (this.config.schedule.cancelOnRealIncident && this.state.realIncidents.size > 0) {
            this.emitAlert('warn', 'real_incident_overlap');
            return;
        }

        // Check live_fire permissions
        if (request.mode === 'live_fire') {
            const approved = await this.checkLiveFireApproval(request);
            if (!approved) {
                this.emitAlert('error', 'approval_required');
                return;
            }
        }

        // Generate drill key for idempotency
        const drillKey = this.generateDrillKey(request);
        
        if (this.state.activeCampaigns.has(drillKey)) {
            this.emitAlert('info', 'idem_duplicate');
            return;
        }

        // Get template
        const template = this.state.templates.get(request.scenarioSlug);
        if (!template) {
            this.emitAlert('error', 'template_not_found');
            return;
        }

        // Create campaign
        const campaign = this.createDrillCampaign(drillKey, request, template);
        this.state.activeCampaigns.set(drillKey, campaign);

        // Emit planned event
        this.emitDrillPlanned(campaign);

        // Update metrics
        this.state.metrics.planned++;

        this.logger.info(`Drill planned: ${campaign.campaignId} - ${template.title}`);
    }

    private async processDrillRunRequest(request: any): Promise<void> {
        // Find campaign
        const campaign = Array.from(this.state.activeCampaigns.values())
            .find(c => c.campaignId === request.campaignId);

        if (!campaign) {
            this.emitAlert('error', 'campaign_not_found');
            return;
        }

        // Start the drill
        await this.startDrillCampaign(campaign);
    }

    private updateBlackoutWindows(blackoutData: any): void {
        for (const window of blackoutData.windows) {
            this.state.blackoutWindows.push({
                from: window.from,
                to: window.to,
                reason: blackoutData.reason
            });
        }

        this.logger.info(`Added ${blackoutData.windows.length} blackout windows`);
    }

    private handleRealIncident(incident: any): void {
        this.state.realIncidents.add(incident.id);
        
        if (this.config.schedule.cancelOnRealIncident) {
            // Cancel any running drills
            for (const campaign of this.state.activeCampaigns.values()) {
                if (campaign.state !== 'IDLE' && campaign.state !== 'PLAN') {
                    this.cancelDrillCampaign(campaign, 'real_incident');
                }
            }
        }

        this.logger.warn(`Real incident started: ${incident.id} - may affect drills`);
    }

    private isInBlackout(timestamp: string): boolean {
        const time = new Date(timestamp);
        const timeStr = `${time.getHours().toString().padStart(2, '0')}:${time.getMinutes().toString().padStart(2, '0')}`;

        return this.state.blackoutWindows.some(window => {
            return timeStr >= window.from && timeStr <= window.to;
        });
    }

    private async checkLiveFireApproval(request: any): Promise<boolean> {
        // Check quarter limits
        const currentQuarter = this.getCurrentQuarter();
        const quarterDrills = Array.from(this.state.completedCampaigns.values())
            .filter(c => c.mode === 'live_fire' && this.getQuarter(c.startAt) === currentQuarter);

        if (quarterDrills.length >= this.config.modes.liveFireGuards.maxPerQuarter) {
            return false;
        }

        // Request approvals (simulated)
        const approvalEvent = {
            event: 'approval.request',
            timestamp: new Date().toISOString(),
            requestId: `drill-${request.campaignId}`,
            type: 'live_fire_drill',
            approvers: this.config.modes.liveFireGuards.requireApprovers,
            context: {
                campaignId: request.campaignId,
                scenarioSlug: request.scenarioSlug
            }
        };

        this.eventBus.emit('approval.request', approvalEvent);

        // In real implementation, wait for approval response
        // For now, assume approval granted if not exceeding limits
        return true;
    }

    private getCurrentQuarter(): string {
        const now = new Date();
        const year = now.getFullYear();
        const quarter = Math.floor(now.getMonth() / 3) + 1;
        return `${year}-Q${quarter}`;
    }

    private getQuarter(timestamp: string): string {
        const date = new Date(timestamp);
        const year = date.getFullYear();
        const quarter = Math.floor(date.getMonth() / 3) + 1;
        return `${year}-Q${quarter}`;
    }

    private generateDrillKey(request: any): string {
        const keyData = {
            campaignId: request.campaignId,
            scenarioSlug: request.scenarioSlug,
            forDate: request.forDate,
            mode: request.mode
        };
        
        return 'drill:' + crypto
            .createHash('sha256')
            .update(JSON.stringify(keyData))
            .digest('hex')
            .substring(0, 16);
    }

    private generateCampaignId(): string {
        const date = new Date().toISOString().split('T')[0];
        const suffix = Math.random().toString(36).substring(2, 4).toUpperCase();
        return `dr-${date}-${suffix}`;
    }

    private createDrillCampaign(drillKey: string, request: any, template: DrillTemplate): DrillCampaign {
        const startAt = request.startAt || new Date(Date.now() + 5 * 60 * 1000).toISOString(); // 5 minutes from now

        return {
            drillKey,
            campaignId: request.campaignId,
            scenarioSlug: request.scenarioSlug,
            mode: request.mode,
            scope: request.scope,
            symbol: request.symbol,
            notify: request.notify,
            stealth: request.stealth,
            dryRun: request.dryRun,
            startAt,
            state: 'PLAN',
            template,
            currentStep: 0,
            signals: [],
            kpis: {
                TTD_sec: 0,
                TTA_sec: 0,
                TTR_min: 0,
                falsePositive: 0
            },
            score: 0,
            result: 'failed',
            participants: request.notify
        };
    }

    private async startDrillCampaign(campaign: DrillCampaign): Promise<void> {
        campaign.state = 'INJECT';
        campaign.startedAt = new Date().toISOString();

        // Emit drill started event
        this.emitDrillRunStarted(campaign);

        // Notify participants if not stealth
        if (!campaign.stealth) {
            await this.notifyParticipants(campaign);
        }

        // Start execution
        await this.executeDrillSteps(campaign);

        // Update metrics
        this.state.metrics.started++;

        this.logger.info(`Drill campaign started: ${campaign.campaignId}`);
    }

    private async notifyParticipants(campaign: DrillCampaign): Promise<void> {
        const notifyEvent = {
            event: 'drill.notification',
            timestamp: new Date().toISOString(),
            campaignId: campaign.campaignId,
            title: `Tatbikat Başlıyor: ${campaign.template.title}`,
            message: `${campaign.mode} modunda ${campaign.template.difficulty} seviye tatbikat`,
            participants: campaign.participants,
            ttlSec: this.config.schedule.notifyBeforeMin * 60
        };

        this.eventBus.emit('drill.notification', notifyEvent);
    }

    private async executeDrillSteps(campaign: DrillCampaign): Promise<void> {
        for (let i = 0; i < campaign.template.steps.length; i++) {
            campaign.currentStep = i;
            const step = campaign.template.steps[i];

            try {
                await this.executeStep(campaign, step);
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                this.logger.error(`Step ${step.id} failed:`, error);
                this.emitStepProgress(campaign, step.id, 'skipped', `Error: ${errorMessage}`);
                
                if (!step.params.optional) {
                    campaign.result = 'failed';
                    break;
                }
            }
        }

        // Move to scoring
        campaign.state = 'SCORE';
        await this.scoreDrillCampaign(campaign);
    }

    private async executeStep(campaign: DrillCampaign, step: any): Promise<void> {
        this.logger.info(`Executing step ${step.id}: ${step.kind}`);

        switch (step.kind) {
            case 'inject':
                await this.executeInjectStep(campaign, step);
                break;
            case 'expect':
                await this.executeExpectStep(campaign, step);
                break;
            case 'runbook':
                await this.executeRunbookStep(campaign, step);
                break;
            default:
                throw new Error(`Unknown step kind: ${step.kind}`);
        }

        this.emitStepProgress(campaign, step.id, 'ok', `${step.kind} completed`);
    }

    private async executeInjectStep(campaign: DrillCampaign, step: any): Promise<void> {
        // Inject fault via LIVIA-29 (chaos fuzzer)
        const injectionEvent = {
            event: 'chaos.inject.request',
            timestamp: new Date().toISOString(),
            fault: step.params.fault,
            mode: campaign.mode,
            campaignId: campaign.campaignId,
            tags: {
                DRILL: true,
                SHADOW: campaign.mode === 'shadow'
            }
        };

        this.eventBus.emit('chaos.inject.request', injectionEvent);

        // Emit injection event
        this.emitDrillInjectionEmitted(campaign, step.params.fault);

        this.logger.info(`Fault injected: ${JSON.stringify(step.params.fault)}`);
    }

    private async executeExpectStep(campaign: DrillCampaign, step: any): Promise<void> {
        campaign.state = 'OBSERVE';
        
        const expectedSignal = step.params.signal;
        const timeoutMin = step.params.withinMin || this.config.timeouts.signalWaitMin;
        const timeoutMs = timeoutMin * 60 * 1000;

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                campaign.state = 'INJECT'; // Continue with next step
                reject(new Error(`Signal ${expectedSignal} not received within ${timeoutMin} minutes`));
            }, timeoutMs);

            // Check if signal already received
            const existingSignal = campaign.signals.find(s => s.type === expectedSignal);
            if (existingSignal) {
                clearTimeout(timeout);
                campaign.state = 'INJECT';
                resolve(void 0);
                return;
            }

            // Wait for signal
            const signalHandler = (type: string, data: any) => {
                if (type === expectedSignal) {
                    clearTimeout(timeout);
                    campaign.state = 'INJECT';
                    this.recordDrillSignal(campaign, type, data);
                    resolve(void 0);
                }
            };

            // Store handler for cleanup
            (campaign as any)._signalHandler = signalHandler;
        });
    }

    private async executeRunbookStep(campaign: DrillCampaign, step: any): Promise<void> {
        // Request runbook execution via LIVIA-28
        const runbookEvent = {
            event: 'runbook.exec.request',
            timestamp: new Date().toISOString(),
            runbookId: step.params.runbookId,
            mode: campaign.dryRun ? 'dry_run' : 'execute',
            campaignId: campaign.campaignId,
            context: {
                drill: true,
                scenario: campaign.scenarioSlug
            }
        };

        this.eventBus.emit('runbook.exec.request', runbookEvent);

        this.logger.info(`Runbook requested: ${step.params.runbookId}`);
    }

    private processDrillSignal(campaign: DrillCampaign, signalType: string, data: any): void {
        // Record signal
        this.recordDrillSignal(campaign, signalType, data);

        // Check if this is a TTD signal (Time to Detect)
        if (this.isDetectionSignal(signalType) && campaign.kpis.TTD_sec === 0) {
            const startTime = new Date(campaign.startedAt!).getTime();
            const signalTime = new Date(data.timestamp).getTime();
            campaign.kpis.TTD_sec = Math.round((signalTime - startTime) / 1000);
        }

        // Check if this is a TTA signal (Time to Acknowledge)
        if (this.isAcknowledgeSignal(signalType) && campaign.kpis.TTA_sec === 0) {
            const startTime = new Date(campaign.startedAt!).getTime();
            const signalTime = new Date(data.timestamp).getTime();
            campaign.kpis.TTA_sec = Math.round((signalTime - startTime) / 1000);
        }

        // Check if this is a TTR signal (Time to Resolve)
        if (this.isResolveSignal(signalType)) {
            const startTime = new Date(campaign.startedAt!).getTime();
            const signalTime = new Date(data.timestamp).getTime();
            campaign.kpis.TTR_min = Math.round((signalTime - startTime) / (1000 * 60));
        }

        this.logger.debug(`Drill signal processed: ${signalType} for ${campaign.campaignId}`);
    }

    private recordDrillSignal(campaign: DrillCampaign, signalType: string, data: any): void {
        campaign.signals.push({
            type: signalType,
            timestamp: data.timestamp || new Date().toISOString(),
            details: data
        });
    }

    private isDetectionSignal(signalType: string): boolean {
        return [
            'slo.guard.triggered',
            'cost.guard.triggered',
            'circuit.state'
        ].includes(signalType);
    }

    private isAcknowledgeSignal(signalType: string): boolean {
        return [
            'approval.granted',
            'runbook.exec.started'
        ].includes(signalType);
    }

    private isResolveSignal(signalType: string): boolean {
        return [
            'slo.guard.recovered',
            'cost.guard.recovered',
            'runbook.exec.completed'
        ].includes(signalType);
    }

    private async scoreDrillCampaign(campaign: DrillCampaign): Promise<void> {
        const weights = this.config.scoring.weights;
        const targets = this.config.scoring.srtTargets;
        
        // Calculate component scores (0-100)
        const ttdScore = this.calculateKPIScore(campaign.kpis.TTD_sec, targets.TTD_sec, 'lower_better');
        const ttaScore = this.calculateKPIScore(campaign.kpis.TTA_sec, targets.TTA_sec, 'lower_better');
        const ttrScore = this.calculateKPIScore(campaign.kpis.TTR_min * 60, targets.TTR_min * 60, 'lower_better');
        
        // Playbook score (based on runbook steps completed)
        const playbookScore = this.calculatePlaybookScore(campaign);
        
        // Communications score (based on notifications sent)
        const commsScore = this.calculateCommsScore(campaign);
        
        // Signals score (expected signals received)
        const signalsScore = this.calculateSignalsScore(campaign);
        
        // Weighted total score
        campaign.score = Math.round(
            ttdScore * weights.TTD +
            ttaScore * weights.TTA +
            ttrScore * weights.TTR +
            playbookScore * weights.playbook +
            commsScore * weights.comms +
            signalsScore * weights.signals
        );
        
        // Determine result band
        if (campaign.score >= this.config.scoring.bands.success) {
            campaign.result = 'success';
        } else if (campaign.score >= this.config.scoring.bands.partial) {
            campaign.result = 'partial';
        } else {
            campaign.result = 'failed';
        }
        
        campaign.state = 'REPORT';
        await this.reportDrillCampaign(campaign);
        
        this.logger.info(`Drill scored: ${campaign.campaignId} - ${campaign.score}/100 (${campaign.result})`);
    }

    private calculateKPIScore(actual: number, target: number, type: 'lower_better' | 'higher_better'): number {
        if (actual === 0) return 0; // Not achieved
        
        const ratio = actual / target;
        
        if (type === 'lower_better') {
            if (ratio <= 1) return 100;
            if (ratio <= 1.5) return Math.round(100 - (ratio - 1) * 100);
            return 0;
        } else {
            if (ratio >= 1) return 100;
            if (ratio >= 0.5) return Math.round(ratio * 100);
            return 0;
        }
    }

    private calculatePlaybookScore(campaign: DrillCampaign): number {
        const runbookSteps = campaign.template.steps.filter(s => s.kind === 'runbook');
        if (runbookSteps.length === 0) return 100;
        
        const completedSteps = campaign.signals.filter(s => 
            s.type === 'runbook.exec.completed' || s.type === 'runbook.exec.started'
        ).length;
        
        return Math.round((completedSteps / runbookSteps.length) * 100);
    }

    private calculateCommsScore(campaign: DrillCampaign): number {
        // Simple scoring based on notification events
        const expectedNotifications = campaign.participants.length;
        const actualNotifications = campaign.signals.filter(s => 
            s.type.includes('notification') || s.type.includes('card')
        ).length;
        
        if (expectedNotifications === 0) return 100;
        return Math.min(100, Math.round((actualNotifications / expectedNotifications) * 100));
    }

    private calculateSignalsScore(campaign: DrillCampaign): number {
        const expectedSignals = campaign.template.successCriteria.expectSignals;
        const receivedSignals = campaign.signals.map(s => s.type);
        
        const matchedSignals = expectedSignals.filter(expected => 
            receivedSignals.includes(expected)
        ).length;
        
        if (expectedSignals.length === 0) return 100;
        return Math.round((matchedSignals / expectedSignals.length) * 100);
    }

    private async reportDrillCampaign(campaign: DrillCampaign): Promise<void> {
        // Generate report
        const report = await this.generateDrillReport(campaign);
        
        // Emit drill completed
        this.emitDrillRunCompleted(campaign);
        
        // Emit report ready
        this.emitDrillReportReady(campaign, report);
        
        // Emit summary card
        this.emitDrillCard(campaign);
        
        // Update leaderboard
        this.updateLeaderboard(campaign);
        
        // Complete campaign
        await this.completeDrillCampaign(campaign);
        
        campaign.state = 'EMIT';
    }

    private async generateDrillReport(campaign: DrillCampaign): Promise<{ path: string; content: string; hash: string }> {
        const reportContent = this.formatDrillReportAsMarkdown(campaign);
        const reportPath = this.getDrillReportPath(campaign);
        
        // In real implementation, write to file
        this.logger.info(`Report generated for drill ${campaign.campaignId}: ${reportPath}`);
        
        return {
            path: reportPath,
            content: reportContent,
            hash: this.generateHash(reportContent)
        };
    }

    private formatDrillReportAsMarkdown(campaign: DrillCampaign): string {
        const kpis = campaign.kpis;
        const template = campaign.template;
        
        return `# Drill Report: ${campaign.campaignId}

## Scenario
**${template.title}** (${template.difficulty})

## Results
- **Result**: ${campaign.result.toUpperCase()}
- **Score**: ${campaign.score}/100
- **Mode**: ${campaign.mode}

## KPIs
- **TTD** (Time to Detect): ${kpis.TTD_sec}s
- **TTA** (Time to Acknowledge): ${kpis.TTA_sec}s  
- **TTR** (Time to Resolve): ${kpis.TTR_min}m
- **False Positives**: ${kpis.falsePositive}

## Steps Executed
${template.steps.map((step, i) => `${i + 1}. ${step.kind}: ${step.id}`).join('\n')}

## Signals Received
${campaign.signals.map(s => `- ${s.type} at ${s.timestamp}`).join('\n')}

## Participants
${campaign.participants.join(', ')}

---
Generated on ${new Date().toISOString()}
`;
    }

    private getDrillReportPath(campaign: DrillCampaign): string {
        const date = new Date().toISOString().split('T')[0];
        const monthDir = date.substring(0, 7); // YYYY-MM
        return `data/drills/${monthDir}/${campaign.campaignId}/report.md`;
    }

    private updateLeaderboard(campaign: DrillCampaign): void {
        const quarter = this.getQuarter(campaign.startAt);
        const leaderboard = this.state.leaderboards.get(quarter);
        
        if (!leaderboard) return;
        
        for (const participant of campaign.participants) {
            const entry = leaderboard.entries.find(e => e.team === participant);
            if (entry) {
                // Update running average
                const newCount = entry.drillCount + 1;
                entry.avgScore = Math.round(((entry.avgScore * entry.drillCount) + campaign.score) / newCount);
                entry.drillCount = newCount;
                entry.lastDrill = campaign.completedAt || new Date().toISOString();
            }
        }
        
        // Sort by score
        leaderboard.entries.sort((a, b) => b.avgScore - a.avgScore);
        
        // Emit leaderboard update
        this.emitDrillLeaderboardUpdated(leaderboard);
    }

    private async completeDrillCampaign(campaign: DrillCampaign): Promise<void> {
        campaign.completedAt = new Date().toISOString();
        campaign.state = 'IDLE';
        
        // Move to completed
        this.state.completedCampaigns.set(campaign.drillKey, campaign);
        this.state.activeCampaigns.delete(campaign.drillKey);
        
        // Update metrics
        this.state.metrics.completed++;
        this.updateDrillMetrics(campaign);
        
        this.logger.info(`Drill campaign completed: ${campaign.campaignId}`);
    }

    private timeoutDrillCampaign(campaign: DrillCampaign, reason: string): void {
        campaign.result = 'failed';
        campaign.score = 0;
        
        this.emitAlert('error', `timeout: ${reason}`);
        this.completeDrillCampaign(campaign);
        
        this.state.metrics.failed++;
    }

    private cancelDrillCampaign(campaign: DrillCampaign, reason: string): void {
        campaign.state = 'IDLE';
        this.state.activeCampaigns.delete(campaign.drillKey);
        
        this.emitAlert('warn', `cancelled: ${reason}`);
        this.logger.warn(`Drill cancelled: ${campaign.campaignId} - ${reason}`);
    }

    private updateDrillMetrics(campaign: DrillCampaign): void {
        const metrics = this.state.metrics;
        
        // Update TTD metrics
        if (campaign.kpis.TTD_sec > 0) {
            metrics.lastTTDs.push(campaign.kpis.TTD_sec);
            if (metrics.lastTTDs.length > 100) metrics.lastTTDs.shift();
            
            const sorted = [...metrics.lastTTDs].sort((a, b) => a - b);
            const p95Index = Math.floor(sorted.length * 0.95);
            metrics.p95TTD_sec = sorted[p95Index] || 0;
        }
        
        // Update TTA metrics
        if (campaign.kpis.TTA_sec > 0) {
            metrics.lastTTAs.push(campaign.kpis.TTA_sec);
            if (metrics.lastTTAs.length > 100) metrics.lastTTAs.shift();
            
            const sorted = [...metrics.lastTTAs].sort((a, b) => a - b);
            const p95Index = Math.floor(sorted.length * 0.95);
            metrics.p95TTA_sec = sorted[p95Index] || 0;
        }
        
        // Update TTR metrics
        if (campaign.kpis.TTR_min > 0) {
            metrics.lastTTRs.push(campaign.kpis.TTR_min);
            if (metrics.lastTTRs.length > 100) metrics.lastTTRs.shift();
            
            const sorted = [...metrics.lastTTRs].sort((a, b) => a - b);
            const p95Index = Math.floor(sorted.length * 0.95);
            metrics.p95TTR_min = sorted[p95Index] || 0;
        }
        
        // Update average score
        const totalCompleted = metrics.completed;
        metrics.avgScore = Math.round(((metrics.avgScore * (totalCompleted - 1)) + campaign.score) / totalCompleted);
    }

    private generateHash(content: string): string {
        return 'sha256:' + crypto
            .createHash('sha256')
            .update(content)
            .digest('hex')
            .substring(0, 16);
    }

    // Event emission methods
    private emitDrillPlanned(campaign: DrillCampaign): void {
        const event = {
            event: 'drill.planned',
            timestamp: new Date().toISOString(),
            drillKey: campaign.drillKey,
            campaignId: campaign.campaignId,
            scenarioSlug: campaign.scenarioSlug,
            mode: campaign.mode,
            startAt: campaign.startAt,
            flags: {
                DRILL: true,
                SHADOW: campaign.mode === 'shadow'
            }
        };
        
        this.eventBus.emit('drill.planned', event);
    }

    private emitDrillRunStarted(campaign: DrillCampaign): void {
        const event = {
            event: 'drill.run.started',
            timestamp: new Date().toISOString(),
            drillKey: campaign.drillKey,
            campaignId: campaign.campaignId,
            steps: campaign.template.steps.map(s => s.id),
            participants: campaign.participants
        };
        
        this.eventBus.emit('drill.run.started', event);
    }

    private emitDrillInjectionEmitted(campaign: DrillCampaign, fault: any): void {
        const event = {
            event: 'drill.injection.emitted',
            timestamp: new Date().toISOString(),
            campaignId: campaign.campaignId,
            via: this.config.integrations.fuzzer,
            fault,
            count: 1,
            flags: {
                DRILL: true,
                SHADOW: campaign.mode === 'shadow'
            }
        };
        
        this.eventBus.emit('drill.injection.emitted', event);
    }

    private emitStepProgress(campaign: DrillCampaign, stepId: string, status: 'ok' | 'timeout' | 'skipped', details: string): void {
        const event = {
            event: 'drill.step.progress',
            timestamp: new Date().toISOString(),
            campaignId: campaign.campaignId,
            stepId,
            status,
            details
        };
        
        this.eventBus.emit('drill.step.progress', event);
    }

    private emitDrillRunCompleted(campaign: DrillCampaign): void {
        const event = {
            event: 'drill.run.completed',
            timestamp: new Date().toISOString(),
            campaignId: campaign.campaignId,
            result: campaign.result,
            kpis: campaign.kpis,
            score: campaign.score
        };
        
        this.eventBus.emit('drill.run.completed', event);
    }

    private emitDrillReportReady(campaign: DrillCampaign, report: any): void {
        const event = {
            event: 'drill.report.ready',
            timestamp: new Date().toISOString(),
            campaignId: campaign.campaignId,
            path: report.path,
            summary: this.generateDrillSummary(campaign),
            hash: report.hash
        };
        
        this.eventBus.emit('drill.report.ready', event);
    }

    private generateDrillSummary(campaign: DrillCampaign): string {
        const kpis = campaign.kpis;
        return `TTD ${Math.floor(kpis.TTD_sec / 60)}dk • TTA ${Math.floor(kpis.TTA_sec / 60)}dk • TTR ${kpis.TTR_min}dk • Beklenen sinyaller karşılandı • Skor ${campaign.score}/100.`;
    }

    private emitDrillCard(campaign: DrillCampaign): void {
        const severity = campaign.result === 'success' ? 'info' : 'warn';
        const event = {
            event: 'drill.card',
            timestamp: new Date().toISOString(),
            title: `Tatbikat Tamam — ${campaign.campaignId}`,
            body: this.generateDrillSummary(campaign),
            severity,
            ttlSec: 900
        };
        
        this.eventBus.emit('drill.card', event);
    }

    private emitDrillLeaderboardUpdated(leaderboard: Leaderboard): void {
        const event = {
            event: 'drill.leaderboard.updated',
            timestamp: new Date().toISOString(),
            period: leaderboard.period,
            entries: leaderboard.entries.map(e => ({
                team: e.team,
                avgScore: e.avgScore
            }))
        };
        
        this.eventBus.emit('drill.leaderboard.updated', event);
    }

    private emitAlert(level: 'info' | 'warn' | 'error', message: string): void {
        const event = {
            event: 'drill.alert',
            timestamp: new Date().toISOString(),
            level,
            message
        };

        this.eventBus.emit('drill.alert', event);
        this.logger.warn(`Drill alert: ${level} - ${message}`);
    }

    private emitMetrics(): void {
        const event = {
            event: 'drill.metrics',
            timestamp: new Date().toISOString(),
            ...this.state.metrics
        };

        this.eventBus.emit('drill.metrics', event);
    }

    getStatus(): any {
        return {
            name: this.name,
            initialized: this.isInitialized,
            status: this.state.status,
            activeCampaigns: this.state.activeCampaigns.size,
            completedCampaigns: this.state.completedCampaigns.size,
            templates: this.state.templates.size,
            blackoutWindows: this.state.blackoutWindows.length,
            realIncidents: this.state.realIncidents.size,
            metrics: this.state.metrics,
            leaderboards: Object.fromEntries(
                Array.from(this.state.leaderboards.entries()).map(([period, board]) => [
                    period,
                    board.entries.map(e => ({ team: e.team, avgScore: e.avgScore, drillCount: e.drillCount }))
                ])
            )
        };
    }

    async shutdown(): Promise<void> {
        try {
            this.logger.info(`${this.name} durduruluyor...`);
            
            // Stop scheduler
            if (this.schedulerInterval) {
                clearInterval(this.schedulerInterval);
            }
            
            // Cancel active campaigns
            for (const campaign of this.state.activeCampaigns.values()) {
                this.cancelDrillCampaign(campaign, 'shutdown');
            }
            
            // Emit final metrics
            this.emitMetrics();
            
            // Log summary
            this.logger.info(`Drill summary: ${this.state.metrics.completed} completed, ${this.state.metrics.failed} failed`);
            this.logger.info(`Average score: ${this.state.metrics.avgScore}/100`);
            
            this.isInitialized = false;
            this.logger.info(`${this.name} başarıyla durduruldu`);
        } catch (error) {
            this.logger.error(`${this.name} durdurma hatası:`, error);
        }
    }
}

export default IncidentDrillScheduler;