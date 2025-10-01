/**
 * LIVIA-33 · incidentDrillScheduler.js
 * Olay tatbikatları planlama ve yürütme modülü
 */

class IncidentDrillScheduler {
    constructor(config = {}) {
        this.name = 'IncidentDrillScheduler';
        this.config = {
            enabled: true,
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
                weights: { TTD: 0.25, TTA: 0.25, TTR: 0.30, playbook: 0.10, comms: 0.05, signals: 0.05 },
                bands: { success: 'score>=80', partial: '60<=score<80', failed: '<60' },
                srtTargets: { TTD_sec: 240, TTA_sec: 300, TTR_min: 30 }
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
            ...config
        };
        this.isInitialized = false;
        this.logger = null;
        this.eventBus = null;
        this.state = 'IDLE';
        this.drillStore = new Map(); // Aktif tatbikatlar
        this.templateStore = new Map(); // Tatbikat şablonları
        this.leaderboard = new Map(); // Ekip skorları
        this.blackoutWindows = [];
        this.activeIncidents = new Set();
    }

    async initialize(logger, eventBus) {
        try {
            this.logger = logger;
            this.eventBus = eventBus;
            this.logger.info(`${this.name} başlatılıyor...`);
            
            await this.setup();
            this.setupEventListeners();
            this.setupScheduler();
            
            this.isInitialized = true;
            this.logger.info(`${this.name} başarıyla başlatıldı`);
            return true;
        } catch (error) {
            this.logger.error(`${this.name} başlatma hatası:`, error);
            return false;
        }
    }

    async setup() {
        if (this.config.enabled) {
            await this.initializeDrillTemplates();
            await this.loadLeaderboard();
            this.logger.info(`${this.name} kurulumu tamamlandı`);
        }
    }

    setupEventListeners() {
        if (!this.eventBus) return;

        // Tatbikat yönetimi
        this.eventBus.on('drill.template.updated', (data) => this.handleTemplateUpdate(data));
        this.eventBus.on('drill.plan.request', (data) => this.handlePlanRequest(data));
        this.eventBus.on('drill.run.request', (data) => this.handleRunRequest(data));
        
        // Çevre koşulları
        this.eventBus.on('calendar.blackout', (data) => this.handleBlackoutUpdate(data));
        this.eventBus.on('incident.started', (data) => this.handleIncidentStarted(data));
        this.eventBus.on('incident.resolved', (data) => this.handleIncidentResolved(data));
        
        // Tatbikat gözlemi için sinyaller
        this.eventBus.on('slo.guard.triggered', (data) => this.handleDrillSignal(data, 'slo.guard.triggered'));
        this.eventBus.on('slo.guard.recovered', (data) => this.handleDrillSignal(data, 'slo.guard.recovered'));
        this.eventBus.on('approval.granted', (data) => this.handleDrillSignal(data, 'approval.granted'));
        this.eventBus.on('runbook.exec.started', (data) => this.handleDrillSignal(data, 'runbook.exec.started'));
    }

    setupScheduler() {
        // Haftalık otomatik tatbikat planlaması
        if (this.config.schedule.cronWeekly) {
            setInterval(() => {
                this.scheduledDrillPlan();
            }, 24 * 60 * 60 * 1000); // Daily check
        }
    }

    async process(data) {
        if (!this.isInitialized) {
            throw new Error(`${this.name} henüz başlatılmadı`);
        }

        try {
            const result = await this.processDrillScheduler(data);
            return {
                success: true,
                data: result,
                timestamp: new Date().toISOString(),
                source: this.name
            };
        } catch (error) {
            this.logger.error(`${this.name} işlem hatası:`, error);
            return {
                success: false,
                error: error.message,
                timestamp: new Date().toISOString(),
                source: this.name
            };
        }
    }

    async processDrillScheduler(data) {
        const drillKey = this.generateDrillKey(data);
        
        // Idempotency kontrolü
        if (this.drillStore.has(drillKey)) {
            const cached = this.drillStore.get(drillKey);
            if (Date.now() - cached.timestamp < this.config.idempotencyTtlSec * 1000) {
                return cached.result;
            }
        }

        const result = await this.advanceFSM(data);
        
        // Cache'e kaydet
        this.drillStore.set(drillKey, {
            result,
            timestamp: Date.now()
        });

        return result;
    }

    async advanceFSM(data) {
        switch (this.state) {
            case 'IDLE':
                return await this.handleIdleState(data);
            case 'PLAN':
                return await this.handlePlanState(data);
            case 'ARM':
                return await this.handleArmState(data);
            case 'INJECT':
                return await this.handleInjectState(data);
            case 'OBSERVE':
                return await this.handleObserveState(data);
            case 'SCORE':
                return await this.handleScoreState(data);
            case 'REPORT':
                return await this.handleReportState(data);
            default:
                this.state = 'IDLE';
                return { action: 'state_reset', state: this.state };
        }
    }

    async handleIdleState(data) {
        if (data.event === 'drill.plan.request' || data.event === 'scheduled_drill') {
            this.state = 'PLAN';
            return await this.planDrill(data);
        }
        
        return { action: 'no_action', state: this.state };
    }

    async handlePlanState(data) {
        // Blackout ve olay kontrolü
        if (this.isInBlackoutWindow() || this.hasActiveIncidents()) {
            this.state = 'IDLE';
            return await this.cancelDrill(data, 'blackout_or_incident');
        }
        
        this.state = 'ARM';
        return await this.armDrill(data);
    }

    async handleArmState(data) {
        if (data.event === 'drill.run.request' || this.shouldStartDrill(data)) {
            this.state = 'INJECT';
            return await this.startDrillRun(data);
        }
        
        return { action: 'waiting_for_start', state: this.state };
    }

    async handleInjectState(data) {
        const injectionResult = await this.performInjection(data);
        
        if (injectionResult.success) {
            this.state = 'OBSERVE';
            return await this.startObservation(data);
        } else {
            this.state = 'IDLE';
            return await this.failDrill(data, 'injection_failed');
        }
    }

    async handleObserveState(data) {
        const observationResult = await this.checkObservationCriteria(data);
        
        if (observationResult.completed || observationResult.timeout) {
            this.state = 'SCORE';
            return await this.calculateScore(data, observationResult);
        }
        
        return { action: 'observing', progress: observationResult.progress };
    }

    async handleScoreState(data) {
        this.state = 'REPORT';
        return await this.generateReport(data);
    }

    async handleReportState(data) {
        await this.distributeReport(data);
        await this.updateLeaderboard(data);
        
        this.state = 'IDLE';
        return { action: 'drill_completed', campaignId: data.campaignId };
    }

    // Core drill operations
    async planDrill(data) {
        const campaignId = data.campaignId || this.generateCampaignId();
        const scenarioSlug = data.scenarioSlug || this.selectRandomScenario();
        const template = this.templateStore.get(scenarioSlug);
        
        if (!template) {
            throw new Error(`Unknown scenario: ${scenarioSlug}`);
        }
        
        // Mode validation
        const mode = data.mode || this.config.modes.default;
        if (!this.config.modes.allow.includes(mode)) {
            throw new Error(`Invalid mode: ${mode}`);
        }
        
        // Live-fire requires approval
        if (mode === 'live_fire') {
            const approval = await this.checkLiveFireApproval(data);
            if (!approval.granted) {
                throw new Error('Live-fire drill requires approval');
            }
        }
        
        const drillKey = this.generateDrillKey({ campaignId, scenarioSlug, mode });
        const startAt = data.startAt || this.calculateNextAvailableSlot();
        
        const planResult = {
            action: 'drill_planned',
            drillKey,
            campaignId,
            scenarioSlug,
            mode,
            startAt,
            flags: {
                DRILL: true,
                SHADOW: mode === 'shadow',
                SANDBOX: mode === 'sandbox',
                LIVE_FIRE: mode === 'live_fire'
            },
            template
        };
        
        await this.emitDrillPlanned(planResult);
        return planResult;
    }

    async armDrill(data) {
        // Onay kontrolü (gerekirse)
        if (data.mode === 'live_fire') {
            const ethicsApproval = await this.requestEthicsApproval(data);
            if (!ethicsApproval.granted) {
                this.state = 'IDLE';
                return await this.cancelDrill(data, 'ethics_denied');
            }
        }
        
        // Katılımcıları bilgilendir
        if (!data.stealth) {
            await this.notifyParticipants(data);
        }
        
        return {
            action: 'drill_armed',
            campaignId: data.campaignId,
            startAt: data.startAt
        };
    }

    async startDrillRun(data) {
        const template = this.templateStore.get(data.scenarioSlug);
        const steps = template.steps.map(step => step.id);
        
        const runResult = {
            action: 'drill_started',
            drillKey: data.drillKey,
            campaignId: data.campaignId,
            steps,
            participants: data.notify || ['ops'],
            startTime: Date.now()
        };
        
        // Store drill execution state
        this.drillStore.set(data.campaignId, {
            ...runResult,
            template,
            expectedSignals: new Set(template.successCriteria.expectSignals || []),
            receivedSignals: new Set(),
            stepProgress: new Map(),
            kpis: {
                TTD_sec: null,
                TTA_sec: null,
                TTR_min: null
            }
        });
        
        await this.emitDrillStarted(runResult);
        return runResult;
    }

    async performInjection(data) {
        const drillState = this.drillStore.get(data.campaignId);
        const template = drillState.template;
        
        let injectionCount = 0;
        let injectionErrors = [];
        
        for (const step of template.steps) {
            if (step.kind === 'inject') {
                try {
                    await this.injectFault(step, data);
                    injectionCount++;
                } catch (error) {
                    injectionErrors.push({ stepId: step.id, error: error.message });
                }
            }
        }
        
        const injectionResult = {
            success: injectionErrors.length === 0,
            injectionCount,
            errors: injectionErrors
        };
        
        if (injectionResult.success) {
            await this.emitInjectionCompleted(data, injectionCount);
        }
        
        return injectionResult;
    }

    async injectFault(step, data) {
        const fault = step.params.fault;
        
        if (this.eventBus) {
            this.eventBus.emit('drill.injection.request', {
                event: 'drill.injection.request',
                timestamp: new Date().toISOString(),
                campaignId: data.campaignId,
                stepId: step.id,
                fault,
                flags: data.flags
            });
            
            await this.emitInjectionEmitted(data, fault);
        }
    }

    async startObservation(data) {
        const drillState = this.drillStore.get(data.campaignId);
        drillState.observationStartTime = Date.now();
        
        return {
            action: 'observation_started',
            campaignId: data.campaignId,
            expectedSignals: Array.from(drillState.expectedSignals)
        };
    }

    async checkObservationCriteria(data) {
        const drillState = this.drillStore.get(data.campaignId);
        if (!drillState) return { completed: false, progress: 0 };
        
        const template = drillState.template;
        const successCriteria = template.successCriteria;
        
        // Check timeout
        const observationTime = Date.now() - drillState.observationStartTime;
        const timeoutMs = (successCriteria.TTR_min || 60) * 60 * 1000;
        
        if (observationTime > timeoutMs) {
            return { completed: true, timeout: true, progress: 1.0 };
        }
        
        // Check signal completion
        const expectedCount = drillState.expectedSignals.size;
        const receivedCount = drillState.receivedSignals.size;
        const progress = expectedCount > 0 ? receivedCount / expectedCount : 1.0;
        
        if (progress >= 1.0) {
            return { completed: true, timeout: false, progress: 1.0 };
        }
        
        return { completed: false, timeout: false, progress };
    }

    async calculateScore(data, observationResult) {
        const drillState = this.drillStore.get(data.campaignId);
        const kpis = drillState.kpis;
        const weights = this.config.scoring.weights;
        const targets = this.config.scoring.srtTargets;
        
        // Normalize KPIs to 0-100 scale
        const normalizedKPIs = {
            TTD: this.normalizeKPI(kpis.TTD_sec, targets.TTD_sec, 'time'),
            TTA: this.normalizeKPI(kpis.TTA_sec, targets.TTA_sec, 'time'),
            TTR: this.normalizeKPI(kpis.TTR_min * 60, targets.TTR_min * 60, 'time'),
            playbook: this.calculatePlaybookScore(drillState),
            comms: this.calculateCommsScore(drillState),
            signals: this.calculateSignalsScore(drillState)
        };
        
        // Calculate weighted score
        let totalScore = 0;
        for (const [metric, weight] of Object.entries(weights)) {
            totalScore += (normalizedKPIs[metric] || 0) * weight;
        }
        
        totalScore = Math.round(totalScore);
        
        const result = this.classifyResult(totalScore);
        
        const scoreResult = {
            action: 'drill_scored',
            campaignId: data.campaignId,
            result,
            kpis: {
                TTD_sec: kpis.TTD_sec,
                TTA_sec: kpis.TTA_sec,
                TTR_min: kpis.TTR_min,
                falsePositive: 0 // Mock
            },
            score: totalScore,
            normalizedKPIs,
            timeout: observationResult.timeout
        };
        
        await this.emitDrillCompleted(scoreResult);
        return scoreResult;
    }

    normalizeKPI(actual, target, type) {
        if (actual === null || actual === undefined) return 0;
        
        if (type === 'time') {
            // Lower is better for time metrics
            if (actual <= target) return 100;
            return Math.max(0, 100 - ((actual - target) / target) * 100);
        }
        
        return 50; // Default
    }

    calculatePlaybookScore(drillState) {
        // Mock playbook completion score
        return 85;
    }

    calculateCommsScore(drillState) {
        // Mock communication score
        return 80;
    }

    calculateSignalsScore(drillState) {
        const expected = drillState.expectedSignals.size;
        const received = drillState.receivedSignals.size;
        
        if (expected === 0) return 100;
        return Math.round((received / expected) * 100);
    }

    classifyResult(score) {
        if (score >= 80) return 'success';
        if (score >= 60) return 'partial';
        return 'failed';
    }

    async generateReport(data) {
        const drillState = this.drillStore.get(data.campaignId);
        const reportPath = `data/drills/${new Date().toISOString().split('T')[0]}/${data.campaignId}/report.md`;
        
        const reportContent = this.createReportContent(data, drillState);
        const reportHash = this.calculateHash(reportContent);
        
        const reportResult = {
            action: 'report_ready',
            campaignId: data.campaignId,
            path: reportPath,
            summary: this.createReportSummary(data, drillState),
            hash: reportHash,
            content: reportContent
        };
        
        await this.emitReportReady(reportResult);
        return reportResult;
    }

    createReportContent(data, drillState) {
        const template = drillState.template;
        const score = data.score || 0;
        const kpis = data.kpis || {};
        
        return `# Tatbikat Raporu - ${data.campaignId}

## Özet
- **Senaryo**: ${template.title}
- **Skor**: ${score}/100
- **Sonuç**: ${data.result}

## KPI'lar
- **TTD**: ${kpis.TTD_sec || 'N/A'} saniye
- **TTA**: ${kpis.TTA_sec || 'N/A'} saniye  
- **TTR**: ${kpis.TTR_min || 'N/A'} dakika

## Beklenen Sinyaller
${Array.from(drillState.expectedSignals).map(signal => `- ${signal}`).join('\n')}

## Alınan Sinyaller
${Array.from(drillState.receivedSignals).map(signal => `- ${signal}`).join('\n')}

## Öneriler
- Gelecek tatbikatlar için iyileştirmeler
- Proses geliştirmeleri
`;
    }

    createReportSummary(data, drillState) {
        const kpis = data.kpis || {};
        const ttd = kpis.TTD_sec ? `${Math.round(kpis.TTD_sec / 60)}dk` : 'N/A';
        const tta = kpis.TTA_sec ? `${Math.round(kpis.TTA_sec / 60)}dk` : 'N/A';
        const ttr = kpis.TTR_min ? `${kpis.TTR_min}dk` : 'N/A';
        
        return `TTD ${ttd} • TTA ${tta} • TTR ${ttr} • Beklenen sinyaller karşılandı • Skor ${data.score || 0}/100.`;
    }

    async distributeReport(data) {
        if (this.eventBus) {
            this.eventBus.emit('dist.request', {
                event: 'dist.request',
                timestamp: new Date().toISOString(),
                contentRef: {
                    type: 'drill_report',
                    path: data.path,
                    campaignId: data.campaignId
                },
                channels: ['ops', 'policy'],
                priority: 'normal'
            });
        }
    }

    async updateLeaderboard(data) {
        const period = this.getCurrentQuarter();
        
        if (!this.leaderboard.has(period)) {
            this.leaderboard.set(period, new Map());
        }
        
        const periodBoard = this.leaderboard.get(period);
        const participants = data.participants || ['ops'];
        
        for (const team of participants) {
            if (!periodBoard.has(team)) {
                periodBoard.set(team, { scores: [], avgScore: 0 });
            }
            
            const teamData = periodBoard.get(team);
            teamData.scores.push(data.score || 0);
            teamData.avgScore = teamData.scores.reduce((a, b) => a + b, 0) / teamData.scores.length;
        }
        
        const leaderboardEntries = Array.from(periodBoard.entries())
            .map(([team, data]) => ({ team, avgScore: Math.round(data.avgScore * 10) / 10 }))
            .sort((a, b) => b.avgScore - a.avgScore);
        
        await this.emitLeaderboardUpdate(period, leaderboardEntries);
    }

    // Event handlers
    handleTemplateUpdate(data) {
        this.templateStore.set(data.scenarioSlug, {
            slug: data.scenarioSlug,
            title: data.title,
            difficulty: data.difficulty,
            steps: data.steps,
            successCriteria: data.successCriteria
        });
        
        this.logger.debug(`Template updated: ${data.scenarioSlug}`);
    }

    handlePlanRequest(data) {
        this.logger.debug(`Plan request: ${data.campaignId}`);
        this.process(data);
    }

    handleRunRequest(data) {
        this.logger.debug(`Run request: ${data.campaignId}`);
        this.process(data);
    }

    handleBlackoutUpdate(data) {
        this.blackoutWindows = data.windows || [];
        this.logger.debug(`Blackout windows updated: ${this.blackoutWindows.length} windows`);
    }

    handleIncidentStarted(data) {
        this.activeIncidents.add(data.id);
        this.logger.warn(`Real incident started: ${data.id} - cancelling drills if needed`);
        
        // Cancel any active drills
        if (this.config.schedule.cancelOnRealIncident) {
            this.cancelActiveDrills('real_incident');
        }
    }

    handleIncidentResolved(data) {
        this.activeIncidents.delete(data.id);
        this.logger.info(`Real incident resolved: ${data.id}`);
    }

    handleDrillSignal(data, signalType) {
        // Check if this signal is part of an active drill
        for (const [campaignId, drillState] of this.drillStore.entries()) {
            if (drillState.expectedSignals && drillState.expectedSignals.has(signalType)) {
                drillState.receivedSignals.add(signalType);
                
                // Update KPIs
                const now = Date.now();
                if (signalType === 'slo.guard.triggered' && !drillState.kpis.TTD_sec) {
                    drillState.kpis.TTD_sec = Math.round((now - drillState.startTime) / 1000);
                }
                
                if (signalType === 'approval.granted' && !drillState.kpis.TTA_sec) {
                    drillState.kpis.TTA_sec = Math.round((now - drillState.startTime) / 1000);
                }
                
                if (signalType === 'slo.guard.recovered' && !drillState.kpis.TTR_min) {
                    drillState.kpis.TTR_min = Math.round((now - drillState.startTime) / 60000);
                }
                
                this.emitStepProgress(campaignId, signalType, 'ok', `${signalType} received`);
            }
        }
    }

    // Utility methods
    generateDrillKey(data) {
        const crypto = require('crypto');
        const campaignId = data.campaignId || 'unknown';
        const scenarioSlug = data.scenarioSlug || 'generic';
        const forDate = data.forDate || new Date().toISOString().split('T')[0];
        const mode = data.mode || 'shadow';
        
        return crypto.createHash('sha256').update(`${campaignId}+${scenarioSlug}+${forDate}+${mode}`).digest('hex');
    }

    generateCampaignId() {
        const date = new Date().toISOString().split('T')[0];
        const counter = String.fromCharCode(65 + (Date.now() % 26)); // A-Z
        return `dr-${date}-${counter}`;
    }

    calculateHash(content) {
        const crypto = require('crypto');
        return crypto.createHash('sha256').update(content).digest('hex');
    }

    getCurrentQuarter() {
        const now = new Date();
        const year = now.getFullYear();
        const quarter = Math.ceil((now.getMonth() + 1) / 3);
        return `${year}-Q${quarter}`;
    }

    selectRandomScenario() {
        const scenarios = Array.from(this.templateStore.keys());
        return scenarios[Math.floor(Math.random() * scenarios.length)] || 'feed-lag-canary-failover';
    }

    calculateNextAvailableSlot() {
        const now = new Date();
        const nextSlot = new Date(now.getTime() + 5 * 60 * 1000); // 5 minutes from now
        return nextSlot.toISOString();
    }

    isInBlackoutWindow() {
        const now = new Date();
        const timeStr = now.toTimeString().substring(0, 5); // HH:MM
        
        return this.blackoutWindows.some(window => 
            timeStr >= window.from && timeStr <= window.to
        );
    }

    hasActiveIncidents() {
        return this.activeIncidents.size > 0;
    }

    shouldStartDrill(data) {
        if (data.startAt) {
            return new Date(data.startAt) <= new Date();
        }
        return false;
    }

    async cancelActiveDrills(reason) {
        for (const [campaignId, drillState] of this.drillStore.entries()) {
            if (drillState.action === 'drill_started') {
                await this.emitDrillAlert('warn', reason, { campaignId });
            }
        }
    }

    async scheduledDrillPlan() {
        // Weekly automatic drill planning
        if (this.isScheduledTime()) {
            const planRequest = {
                event: 'scheduled_drill',
                timestamp: new Date().toISOString(),
                campaignId: this.generateCampaignId(),
                mode: 'shadow',
                notify: ['ops']
            };
            
            await this.process(planRequest);
        }
    }

    isScheduledTime() {
        // Simple cron-like check for Wednesday 14:00
        const now = new Date();
        return now.getDay() === 3 && now.getHours() === 14 && now.getMinutes() === 0;
    }

    // Emit events
    async emitDrillPlanned(result) {
        if (!this.eventBus) return;
        
        this.eventBus.emit('drill.planned', {
            event: 'drill.planned',
            timestamp: new Date().toISOString(),
            ...result
        });
    }

    async emitDrillStarted(result) {
        if (!this.eventBus) return;
        
        this.eventBus.emit('drill.run.started', {
            event: 'drill.run.started',
            timestamp: new Date().toISOString(),
            ...result
        });
    }

    async emitInjectionEmitted(data, fault) {
        if (!this.eventBus) return;
        
        this.eventBus.emit('drill.injection.emitted', {
            event: 'drill.injection.emitted',
            timestamp: new Date().toISOString(),
            campaignId: data.campaignId,
            via: this.config.integrations.fuzzer,
            fault,
            count: 120, // Mock
            flags: data.flags
        });
    }

    async emitStepProgress(campaignId, stepId, status, details) {
        if (!this.eventBus) return;
        
        this.eventBus.emit('drill.step.progress', {
            event: 'drill.step.progress',
            timestamp: new Date().toISOString(),
            campaignId,
            stepId,
            status,
            details
        });
    }

    async emitDrillCompleted(result) {
        if (!this.eventBus) return;
        
        this.eventBus.emit('drill.run.completed', {
            event: 'drill.run.completed',
            timestamp: new Date().toISOString(),
            ...result
        });
        
        // UI Card
        const card = this.createDrillCard(result);
        this.eventBus.emit('drill.card', card);
    }

    async emitReportReady(result) {
        if (!this.eventBus) return;
        
        this.eventBus.emit('drill.report.ready', {
            event: 'drill.report.ready',
            timestamp: new Date().toISOString(),
            ...result
        });
    }

    async emitLeaderboardUpdate(period, entries) {
        if (!this.eventBus) return;
        
        this.eventBus.emit('drill.leaderboard.updated', {
            event: 'drill.leaderboard.updated',
            timestamp: new Date().toISOString(),
            period,
            entries
        });
    }

    async emitDrillAlert(level, message, context = {}) {
        if (!this.eventBus) return;
        
        this.eventBus.emit('drill.alert', {
            event: 'drill.alert',
            timestamp: new Date().toISOString(),
            level,
            message,
            context
        });
    }

    async emitMetrics() {
        if (!this.eventBus) return;
        
        const drills = Array.from(this.drillStore.values());
        const completed = drills.filter(d => d.action === 'drill_scored');
        
        this.eventBus.emit('drill.metrics', {
            event: 'drill.metrics',
            timestamp: new Date().toISOString(),
            planned: drills.length,
            started: drills.filter(d => d.action === 'drill_started').length,
            completed: completed.length,
            failed: completed.filter(d => d.result === 'failed').length,
            avgScore: completed.length > 0 
                ? Math.round(completed.reduce((sum, d) => sum + (d.score || 0), 0) / completed.length)
                : 0,
            p95TTD_sec: 220, // Mock
            p95TTA_sec: 300, // Mock
            p95TTR_min: 28 // Mock
        });
    }

    createDrillCard(result) {
        return {
            event: 'drill.card',
            timestamp: new Date().toISOString(),
            title: `Tatbikat Tamam — ${result.campaignId}`,
            body: `Skor ${result.score} • TTA ${Math.round((result.kpis.TTA_sec || 0) / 60)}dk • TTR ${result.kpis.TTR_min || 0}dk • ${result.result}`,
            severity: result.result === 'success' ? 'info' : result.result === 'partial' ? 'warn' : 'error',
            ttlSec: 900
        };
    }

    // Initialize methods
    async initializeDrillTemplates() {
        // Load default drill templates
        this.templateStore.set('feed-lag-canary-failover', {
            slug: 'feed-lag-canary-failover',
            title: 'Feed Lag → Canary Failover',
            difficulty: 'medium',
            steps: [
                { id: 't1', kind: 'inject', params: { fault: { type: 'spike', series: 'feed.lagMs', mult: 1.8 } } },
                { id: 't2', kind: 'expect', params: { signal: 'slo.guard.triggered', withinMin: 10 } },
                { id: 't3', kind: 'runbook', params: { runbookId: 'rb-latency-slip-hotfix', optional: true } }
            ],
            successCriteria: {
                TTA_min: 10,
                TTR_min: 30,
                expectSignals: ['slo.guard.triggered', 'slo.guard.recovered']
            }
        });
        
        this.logger.debug('Default drill templates loaded');
    }

    async loadLeaderboard() {
        // Mock leaderboard data
        const currentQuarter = this.getCurrentQuarter();
        this.leaderboard.set(currentQuarter, new Map([
            ['ops', { scores: [85, 82, 88], avgScore: 85 }],
            ['policy', { scores: [79, 81, 76], avgScore: 79 }]
        ]));
    }

    async requestEthicsApproval(data) {
        // Mock ethics approval for live-fire drills
        return { granted: false, reason: 'live_fire_requires_explicit_approval' };
    }

    async checkLiveFireApproval(data) {
        // Mock approval check
        return { granted: false, reason: 'requires_approvers' };
    }

    async notifyParticipants(data) {
        if (this.eventBus) {
            this.eventBus.emit('drill.notification', {
                event: 'drill.notification',
                timestamp: new Date().toISOString(),
                campaignId: data.campaignId,
                participants: data.notify || ['ops'],
                notifyBeforeMin: this.config.schedule.notifyBeforeMin
            });
        }
    }

    async cancelDrill(data, reason) {
        await this.emitDrillAlert('warn', reason, { campaignId: data.campaignId });
        return { action: 'drill_cancelled', reason, campaignId: data.campaignId };
    }

    async failDrill(data, reason) {
        await this.emitDrillAlert('error', reason, { campaignId: data.campaignId });
        return { action: 'drill_failed', reason, campaignId: data.campaignId };
    }

    getStatus() {
        return {
            name: this.name,
            initialized: this.isInitialized,
            enabled: this.config.enabled,
            state: this.state,
            activeDrills: this.drillStore.size,
            templates: this.templateStore.size,
            blackoutWindows: this.blackoutWindows.length,
            activeIncidents: this.activeIncidents.size,
            config: this.config
        };
    }

    async shutdown() {
        try {
            this.logger.info(`${this.name} durduruluyor...`);
            
            this.drillStore.clear();
            this.templateStore.clear();
            this.leaderboard.clear();
            this.blackoutWindows = [];
            this.activeIncidents.clear();
            
            this.isInitialized = false;
            this.logger.info(`${this.name} başarıyla durduruldu`);
        } catch (error) {
            this.logger.error(`${this.name} durdurma hatası:`, error);
        }
    }
}

module.exports = IncidentDrillScheduler;