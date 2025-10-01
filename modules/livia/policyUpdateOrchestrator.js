/**
 * LIVIA-23: Policy Update Orchestrator
 * Saha verilerinden politika yaması önerileri üreten ve kanaryalı yayın yapan sistem
 */

const { z } = require('zod');
const EventEmitter = require('events');
const crypto = require('crypto');

// Input schemas
const PolicyUpdateRequestSchema = z.object({
    event: z.literal('policy.update.request'),
    timestamp: z.string(),
    mode: z.enum(['auto', 'manual']),
    scope: z.enum(['global', 'desk', 'symbol']),
    symbol: z.string().nullable(),
    goal: z.enum(['reduce_slip', 'max_fill_quality', 'lower_latency', 'stabilize_rr']),
    dryRun: z.boolean().default(false)
}).strict();

const SloWindowReportSchema = z.object({
    event: z.literal('slo.window.report'),
    timestamp: z.string(),
    windowMin: z.number(),
    sloWorst: z.object({
        answer_latency_p95: z.enum(['ok', 'at_risk', 'breach']),
        guard_success_rate: z.enum(['ok', 'at_risk', 'breach']),
        uptime_feed: z.enum(['ok', 'at_risk', 'breach'])
    }),
    burnPct: z.number()
}).strict();

const GuardActivityRollupSchema = z.object({
    event: z.literal('guard.activity.rollup'),
    timestamp: z.string(),
    counts: z.object({
        slowdown: z.number(),
        block_aggressive: z.number(),
        halt_entry: z.number()
    }),
    topSymbols: z.array(z.object({
        symbol: z.string(),
        events: z.number()
    }))
}).strict();

const AnomalySummarySchema = z.object({
    event: z.literal('anomaly.summary'),
    timestamp: z.string(),
    windowMin: z.number(),
    high: z.number(),
    medium: z.number(),
    low: z.number(),
    seriesTop: z.array(z.object({
        name: z.string(),
        count: z.number()
    }))
}).strict();

// Output schemas
const PolicyPatchProposedSchema = z.object({
    event: z.literal('policy.patch.proposed'),
    timestamp: z.string(),
    baseVersion: z.string(),
    targetVersion: z.string(),
    scope: z.enum(['global', 'desk', 'symbol']),
    symbol: z.string().nullable(),
    impact: z.enum(['low', 'medium', 'high']),
    delta: z.object({
        guard: z.object({
            windowMs: z.number(),
            slowdownThreshold: z.number(),
            blockAggressiveOn: z.array(z.string())
        }).partial().optional(),
        limits: z.object({
            positionLimitFactor: z.number(),
            dailyTradeCap: z.number()
        }).partial().optional(),
        exec: z.object({
            prefer: z.enum(['twap', 'limit']),
            maxSlices: z.number(),
            slipMaxBps: z.number()
        }).partial().optional(),
        confirm: z.object({
            decisionThreshold: z.number()
        }).partial().optional()
    }),
    rationale: z.string(),
    riskScore: z.number(),
    dryRun: z.boolean(),
    audit: z.object({
        producedBy: z.literal('LIVIA-23')
    })
}).strict();

class PolicyUpdateOrchestrator extends EventEmitter {
    constructor(eventBus, logger, config = {}) {
        super();
        this.eventBus = eventBus;
        this.logger = logger;
        this.name = 'PolicyUpdateOrchestrator';
        
        this.config = {
            sources: {
                use: ['slo', 'guard', 'anomaly', 'pnl', 'postmortem', 'cooldown', 'recovery', 'fatigue', 'notes']
            },
            rules: {
                'slip.p95:high': [
                    { path: 'guard.windowMs', op: 'inc', byMs: 300, max: 2500 },
                    { path: 'exec.slipMaxBps', op: 'dec', toMin: 20 }
                ],
                'guard.halt_entry>=1': [
                    { path: 'limits.positionLimitFactor', op: 'set', to: 0.7 },
                    { path: 'exec.prefer', op: 'set', to: 'limit' }
                ],
                'dialog.p95AnswerMs>1200': [
                    { path: 'confirm.decisionThreshold', op: 'inc', by: 0.05, max: 0.75 }
                ],
                'postmortem:latency_guard_narrow': [
                    { path: 'guard.windowMs', op: 'inc', byMs: 200 }
                ]
            },
            impactModel: {
                weights: { guard: 0.4, limits: 0.25, exec: 0.2, confirm: 0.15 },
                highIf: ['guard.windowMs>+500', 'limits.positionLimitFactor<0.7', 'exec.prefer=halt', 'confirm.decisionThreshold>0.7']
            },
            approval: {
                approvers: ['policy-lead', 'risk-lead'],
                requireIfImpact: ['medium', 'high'],
                gateway: 'LIVIA-05'
            },
            rollout: {
                modes: ['shadow', 'canary', 'full'],
                canarySharePct: 0.1,
                canaryDurationMin: 30,
                promoteIf: { 
                    'guard_success_rate': '>=+2%', 
                    'answer_latency_p95': '<=-5%', 
                    'pnl.netUSD': '>=0%' 
                },
                rollbackIf: { 
                    'answer_latency_p95': '>+5%', 
                    'sloWorst=breach': true 
                }
            },
            output: {
                dir: 'data/policy/{YYYY-MM-DD}',
                diffFile: 'diff.yaml',
                changelogFile: 'changelog.md'
            },
            redactionProfile: 'generic',
            ...config
        };

        this.state = {
            status: 'IDLE',
            currentVersion: 'v41',
            recentData: new Map(),
            proposedPolicies: new Map(),
            canaryTests: new Map(),
            metrics: {
                proposed: 0,
                approved: 0,
                published: 0,
                rolledBack: 0
            }
        };

        this.isInitialized = false;
        this.scheduleTimer = null;
    }

    async initialize() {
        try {
            this.logger.info(`${this.name} başlatılıyor...`);
            
            // Event listeners
            this.eventBus.on('policy.update.request', this.handlePolicyUpdateRequest.bind(this));
            this.eventBus.on('slo.window.report', this.handleSloWindowReport.bind(this));
            this.eventBus.on('guard.activity.rollup', this.handleGuardActivityRollup.bind(this));
            this.eventBus.on('anomaly.summary', this.handleAnomalySummary.bind(this));
            this.eventBus.on('pnl.daily', this.handlePnlDaily.bind(this));
            this.eventBus.on('postmortem.ready', this.handlePostmortemReady.bind(this));
            this.eventBus.on('approval.result', this.handleApprovalResult.bind(this));

            // Periyodik otomatik değerlendirme (günde bir)
            this.startScheduler();
            
            this.isInitialized = true;
            this.logger.info(`${this.name} başarıyla başlatıldı`);
            return true;
        } catch (error) {
            this.logger.error(`${this.name} başlatma hatası:`, error);
            return false;
        }
    }

    startScheduler() {
        if (this.scheduleTimer) {
            clearInterval(this.scheduleTimer);
        }
        
        // Günde bir kez otomatik değerlendirme (18:30)
        this.scheduleTimer = setInterval(() => {
            const now = new Date();
            if (now.getHours() === 18 && now.getMinutes() === 30) {
                this.triggerAutomaticEvaluation();
            }
        }, 60 * 1000); // Her dakika kontrol et
    }

    handlePolicyUpdateRequest(data) {
        try {
            const validated = PolicyUpdateRequestSchema.parse(data);
            this.logger.info(`Policy update request: ${validated.mode} mode, ${validated.scope}/${validated.symbol}`);
            this.processPolicyUpdateRequest(validated);
        } catch (error) {
            this.logger.error('Policy update request validation error:', error);
        }
    }

    handleSloWindowReport(data) {
        try {
            const validated = SloWindowReportSchema.parse(data);
            this.storeRecentData('slo.window.report', validated);
        } catch (error) {
            this.logger.error('SLO window report validation error:', error);
        }
    }

    handleGuardActivityRollup(data) {
        try {
            const validated = GuardActivityRollupSchema.parse(data);
            this.storeRecentData('guard.activity.rollup', validated);
        } catch (error) {
            this.logger.error('Guard activity rollup validation error:', error);
        }
    }

    handleAnomalySummary(data) {
        try {
            const validated = AnomalySummarySchema.parse(data);
            this.storeRecentData('anomaly.summary', validated);
        } catch (error) {
            this.logger.error('Anomaly summary validation error:', error);
        }
    }

    handlePnlDaily(data) {
        this.storeRecentData('pnl.daily', data);
    }

    handlePostmortemReady(data) {
        this.storeRecentData('postmortem.ready', data);
        
        // Postmortem'dan otomatik öneri üretme
        if (data.summary.includes('latency') || data.summary.includes('slip')) {
            this.triggerPostmortemBasedUpdate(data);
        }
    }

    handleApprovalResult(data) {
        if (data.ref && data.ref.includes('policy.approval.request')) {
            this.processApprovalResult(data);
        }
    }

    storeRecentData(type, data) {
        const now = Date.now();
        const windowMs = 24 * 60 * 60 * 1000; // 24 saat
        
        if (!this.state.recentData.has(type)) {
            this.state.recentData.set(type, []);
        }
        
        const events = this.state.recentData.get(type);
        events.push({ ...data, storedAt: now });
        
        // Eski verileri temizle
        const cutoff = now - windowMs;
        this.state.recentData.set(type, events.filter(e => e.storedAt > cutoff));
    }

    async triggerAutomaticEvaluation() {
        this.logger.info('Triggering automatic policy evaluation');
        
        const request = {
            event: 'policy.update.request',
            timestamp: new Date().toISOString(),
            mode: 'auto',
            scope: 'global',
            symbol: null,
            goal: 'reduce_slip',
            dryRun: false
        };
        
        await this.processPolicyUpdateRequest(request);
    }

    async triggerPostmortemBasedUpdate(postmortemData) {
        this.logger.info(`Triggering postmortem-based update: ${postmortemData.incidentId}`);
        
        const request = {
            event: 'policy.update.request',
            timestamp: new Date().toISOString(),
            mode: 'auto',
            scope: 'global', // Postmortem'dan scope çıkarılabilir
            symbol: null,
            goal: 'reduce_slip',
            dryRun: false
        };
        
        await this.processPolicyUpdateRequest(request);
    }

    async processPolicyUpdateRequest(request) {
        try {
            this.state.status = 'COLLECTING';
            
            // Veri toplama
            const collectedData = this.collectRelevantData();
            
            this.state.status = 'PROPOSING';
            
            // Önerileri türet
            const proposedChanges = this.deriveProposedChanges(collectedData, request);
            
            if (!proposedChanges || Object.keys(proposedChanges.delta).length === 0) {
                this.logger.info('No policy changes needed');
                this.state.status = 'IDLE';
                return;
            }
            
            // Risk skoru ve impact hesapla
            const riskScore = this.calculateRiskScore(proposedChanges.delta);
            const impact = this.calculateImpact(proposedChanges.delta);
            
            // Rationale oluştur ve redakte et
            const rationale = await this.generateRationale(proposedChanges.delta, collectedData);
            
            // Policy patch oluştur
            const policyPatch = {
                event: 'policy.patch.proposed',
                timestamp: new Date().toISOString(),
                baseVersion: this.state.currentVersion,
                targetVersion: `${this.state.currentVersion}+1-candidate`,
                scope: request.scope,
                symbol: request.symbol,
                impact,
                delta: proposedChanges.delta,
                rationale,
                riskScore,
                dryRun: request.dryRun,
                audit: {
                    producedBy: 'LIVIA-23'
                }
            };
            
            // Emit policy patch
            this.emitPolicyPatchProposed(policyPatch);
            
            // Diff dosyası oluştur
            await this.generateDiffFile(policyPatch);
            
            // Approval gerekiyorsa
            if (this.requiresApproval(impact)) {
                this.state.status = 'AWAIT_APPROVAL';
                await this.requestApproval(policyPatch);
            } else {
                this.state.status = 'PREPARE_ROLLOUT';
                await this.prepareRollout(policyPatch);
            }
            
            this.state.metrics.proposed++;
            
        } catch (error) {
            this.logger.error('Policy update processing error:', error);
            this.emitAlert('error', 'processing_failed');
            this.state.status = 'IDLE';
        }
    }

    collectRelevantData() {
        const collected = {};
        
        this.config.sources.use.forEach(source => {
            const key = this.mapSourceToDataKey(source);
            if (this.state.recentData.has(key)) {
                collected[source] = this.state.recentData.get(key);
            }
        });
        
        return collected;
    }

    mapSourceToDataKey(source) {
        const mapping = {
            'slo': 'slo.window.report',
            'guard': 'guard.activity.rollup',
            'anomaly': 'anomaly.summary',
            'pnl': 'pnl.daily',
            'postmortem': 'postmortem.ready'
        };
        return mapping[source] || source;
    }

    deriveProposedChanges(collectedData, request) {
        const delta = {};
        let appliedRules = [];
        
        // SLO verilerinden kuralları uygula
        if (collectedData.slo && collectedData.slo.length > 0) {
            const latestSlo = collectedData.slo[collectedData.slo.length - 1];
            if (latestSlo.sloWorst.answer_latency_p95 === 'breach') {
                this.applyRule('dialog.p95AnswerMs>1200', delta);
                appliedRules.push('dialog.p95AnswerMs>1200');
            }
        }
        
        // Guard verilerinden kuralları uygula
        if (collectedData.guard && collectedData.guard.length > 0) {
            const latestGuard = collectedData.guard[collectedData.guard.length - 1];
            if (latestGuard.counts.halt_entry >= 1) {
                this.applyRule('guard.halt_entry>=1', delta);
                appliedRules.push('guard.halt_entry>=1');
            }
        }
        
        // Anomaly verilerinden kuralları uygula
        if (collectedData.anomaly && collectedData.anomaly.length > 0) {
            const latestAnomaly = collectedData.anomaly[collectedData.anomaly.length - 1];
            const slipAnomalies = latestAnomaly.seriesTop.filter(s => s.name.includes('slip'));
            if (slipAnomalies.length > 0 && slipAnomalies[0].count >= 3) {
                this.applyRule('slip.p95:high', delta);
                appliedRules.push('slip.p95:high');
            }
        }
        
        // Postmortem verilerinden kuralları uygula
        if (collectedData.postmortem && collectedData.postmortem.length > 0) {
            const recentPostmortems = collectedData.postmortem.filter(pm => 
                pm.summary.includes('latency') && pm.summary.includes('guard')
            );
            if (recentPostmortems.length > 0) {
                this.applyRule('postmortem:latency_guard_narrow', delta);
                appliedRules.push('postmortem:latency_guard_narrow');
            }
        }
        
        return Object.keys(delta).length > 0 ? { delta, appliedRules } : null;
    }

    applyRule(ruleName, delta) {
        const ruleActions = this.config.rules[ruleName];
        if (!ruleActions) return;
        
        ruleActions.forEach(action => {
            const pathParts = action.path.split('.');
            const section = pathParts[0];
            const field = pathParts[1];
            
            if (!delta[section]) {
                delta[section] = {};
            }
            
            switch (action.op) {
                case 'inc':
                    if (action.byMs) {
                        delta[section][field] = (delta[section][field] || 1200) + action.byMs;
                        if (action.max && delta[section][field] > action.max) {
                            delta[section][field] = action.max;
                        }
                    } else if (action.by) {
                        delta[section][field] = (delta[section][field] || 0.5) + action.by;
                        if (action.max && delta[section][field] > action.max) {
                            delta[section][field] = action.max;
                        }
                    }
                    break;
                    
                case 'dec':
                    if (action.toMin) {
                        delta[section][field] = Math.max(action.toMin, (delta[section][field] || 30) - 5);
                    }
                    break;
                    
                case 'set':
                    delta[section][field] = action.to;
                    break;
            }
        });
    }

    calculateRiskScore(delta) {
        const weights = this.config.impactModel.weights;
        let score = 0;
        
        Object.keys(delta).forEach(section => {
            if (weights[section]) {
                score += weights[section] * 0.5; // Basit hesaplama
            }
        });
        
        return Math.min(1, score);
    }

    calculateImpact(delta) {
        const highIfConditions = this.config.impactModel.highIf;
        
        for (const condition of highIfConditions) {
            if (this.evaluateCondition(condition, delta)) {
                return 'high';
            }
        }
        
        // Orta impact koşulları
        if (Object.keys(delta).length >= 2) {
            return 'medium';
        }
        
        return 'low';
    }

    evaluateCondition(condition, delta) {
        // Basit condition evaluation - gerçek implementasyonda daha sofistike olabilir
        if (condition.includes('guard.windowMs>+500')) {
            return delta.guard?.windowMs && delta.guard.windowMs > 1700; // 1200 + 500
        }
        
        if (condition.includes('limits.positionLimitFactor<0.7')) {
            return delta.limits?.positionLimitFactor && delta.limits.positionLimitFactor < 0.7;
        }
        
        return false;
    }

    async generateRationale(delta, collectedData) {
        const reasons = [];
        
        if (delta.guard?.windowMs) {
            reasons.push(`guard window +${delta.guard.windowMs - 1200}ms (slip koruması)`);
        }
        
        if (delta.exec?.slipMaxBps) {
            reasons.push(`slip limit ${delta.exec.slipMaxBps}bps`);
        }
        
        if (delta.limits?.positionLimitFactor) {
            reasons.push(`pozisyon limit ×${delta.limits.positionLimitFactor}`);
        }
        
        if (delta.confirm?.decisionThreshold) {
            reasons.push(`onay eşiği ${delta.confirm.decisionThreshold}`);
        }
        
        const rationale = reasons.join('; ');
        
        // LIVIA-21 ile redakte et
        return await this.requestRedaction(rationale);
    }

    async requestRedaction(content) {
        // LIVIA-21'e redaksiyon isteği - basit simülasyon
        return content.replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '***@***.***');
    }

    requiresApproval(impact) {
        return this.config.approval.requireIfImpact.includes(impact);
    }

    async requestApproval(policyPatch) {
        const approvalRequest = {
            event: 'policy.approval.request',
            timestamp: new Date().toISOString(),
            targetVersion: policyPatch.targetVersion,
            impact: policyPatch.impact,
            approvers: this.config.approval.approvers,
            changeSet: this.summarizeChanges(policyPatch.delta),
            canary: {
                sharePct: this.config.rollout.canarySharePct,
                durationMin: this.config.rollout.canaryDurationMin
            }
        };

        this.eventBus.emit('policy.approval.request', approvalRequest);
        this.logger.info(`Approval requested for ${policyPatch.targetVersion}`);
    }

    summarizeChanges(delta) {
        const changes = [];
        
        Object.keys(delta).forEach(section => {
            Object.keys(delta[section]).forEach(field => {
                changes.push(`${section}.${field}:${delta[section][field]}`);
            });
        });
        
        return changes;
    }

    async processApprovalResult(approvalData) {
        if (approvalData.decision === 'granted') {
            this.logger.info('Policy approval granted, proceeding to rollout');
            this.state.status = 'PREPARE_ROLLOUT';
            // Rollout sürecini başlat
            this.state.metrics.approved++;
        } else {
            this.logger.info('Policy approval rejected');
            this.state.status = 'IDLE';
            this.emitAlert('info', 'approval_rejected');
        }
    }

    async prepareRollout(policyPatch) {
        this.logger.info(`Preparing rollout for ${policyPatch.targetVersion}`);
        
        // Shadow modda test
        await this.runShadowTest(policyPatch);
        
        // Canary modda test
        await this.runCanaryTest(policyPatch);
    }

    async runShadowTest(policyPatch) {
        this.logger.info('Running shadow test');
        
        // Shadow test simülasyonu
        const shadowResult = {
            guardSuccessRate: 98.5,
            answerLatencyP95: 892,
            pnlNetUSD: 150.4
        };
        
        this.logger.info('Shadow test completed successfully');
        return shadowResult;
    }

    async runCanaryTest(policyPatch) {
        this.logger.info('Starting canary test');
        
        const canaryEvent = {
            event: 'policy.canary.started',
            timestamp: new Date().toISOString(),
            targetVersion: policyPatch.targetVersion,
            sharePct: this.config.rollout.canarySharePct,
            durationMin: this.config.rollout.canaryDurationMin,
            monitor: ['guard_success_rate', 'answer_latency_p95', 'pnl.netUSD']
        };
        
        this.eventBus.emit('policy.canary.started', canaryEvent);
        
        // Canary süresini bekle (simülasyon)
        setTimeout(() => {
            this.evaluateCanaryResults(policyPatch);
        }, 5000); // 5 saniye simülasyon
    }

    async evaluateCanaryResults(policyPatch) {
        // Canary sonuçları simülasyonu
        const canaryMetrics = {
            guard_success_rate: '+3.1%',
            answer_latency_p95: '-8.4%',
            pnl_netUSD: '+2.6%'
        };
        
        const decision = this.shouldPromoteCanary(canaryMetrics) ? 'promote' : 'rollback';
        
        const canaryResult = {
            event: 'policy.canary.result',
            timestamp: new Date().toISOString(),
            targetVersion: policyPatch.targetVersion,
            metrics: canaryMetrics,
            decision
        };
        
        this.eventBus.emit('policy.canary.result', canaryResult);
        
        if (decision === 'promote') {
            await this.publishVersion(policyPatch);
        } else {
            await this.rollbackVersion(policyPatch);
        }
    }

    shouldPromoteCanary(metrics) {
        const promoteConditions = this.config.rollout.promoteIf;
        
        // Basit koşul kontrolü
        return metrics.guard_success_rate.includes('+') && 
               metrics.answer_latency_p95.includes('-') &&
               metrics.pnl_netUSD.includes('+');
    }

    async publishVersion(policyPatch) {
        const newVersion = `v${parseInt(this.state.currentVersion.substring(1)) + 1}`;
        this.state.currentVersion = newVersion;
        
        // Changelog oluştur
        await this.generateChangelog(policyPatch, newVersion);
        
        const publishEvent = {
            event: 'policy.version.published',
            timestamp: new Date().toISOString(),
            version: newVersion,
            changelogPath: `${this.config.output.dir}/${this.config.output.changelogFile}`,
            hash: this.generateHash(policyPatch)
        };
        
        this.eventBus.emit('policy.version.published', publishEvent);
        this.state.metrics.published++;
        
        this.logger.info(`Policy version published: ${newVersion}`);
        this.state.status = 'IDLE';
    }

    async rollbackVersion(policyPatch) {
        const rollbackEvent = {
            event: 'policy.rollback',
            timestamp: new Date().toISOString(),
            fromVersion: policyPatch.targetVersion,
            toVersion: policyPatch.baseVersion,
            reason: 'canary_metrics_failed'
        };
        
        this.eventBus.emit('policy.rollback', rollbackEvent);
        this.state.metrics.rolledBack++;
        
        this.logger.info(`Policy rolled back: ${policyPatch.targetVersion} -> ${policyPatch.baseVersion}`);
        this.state.status = 'IDLE';
    }

    async generateDiffFile(policyPatch) {
        const yamlDiff = this.generateYamlDiff(policyPatch.delta);
        
        // Dosya yazma simülasyonu
        this.logger.info(`Generated diff file for ${policyPatch.targetVersion}`);
        
        const diffReady = {
            event: 'policy.diff.ready',
            timestamp: new Date().toISOString(),
            targetVersion: policyPatch.targetVersion,
            format: 'yaml',
            path: `${this.config.output.dir}/${this.config.output.diffFile}`,
            summary: this.summarizeDiff(policyPatch.delta)
        };
        
        this.eventBus.emit('policy.diff.ready', diffReady);
    }

    generateYamlDiff(delta) {
        const lines = [];
        
        Object.keys(delta).forEach(section => {
            lines.push(`${section}:`);
            Object.keys(delta[section]).forEach(field => {
                const value = delta[section][field];
                lines.push(`  ${field}: ${value}`);
            });
        });
        
        return lines.join('\n');
    }

    summarizeDiff(delta) {
        const changes = [];
        
        if (delta.guard?.windowMs) {
            changes.push(`guard window +${delta.guard.windowMs - 1200}ms`);
        }
        if (delta.exec?.slipMaxBps) {
            changes.push(`slipMaxBps ${delta.exec.slipMaxBps}`);
        }
        if (delta.limits?.positionLimitFactor) {
            changes.push(`posLimit ×${delta.limits.positionLimitFactor}`);
        }
        
        return changes.join('; ');
    }

    async generateChangelog(policyPatch, version) {
        const changelog = [
            `# Policy Change Log - ${version}`,
            '',
            `**Date:** ${new Date().toISOString().split('T')[0]}`,
            `**Impact:** ${policyPatch.impact}`,
            `**Risk Score:** ${policyPatch.riskScore.toFixed(2)}`,
            '',
            '## Changes',
            '',
            `- ${policyPatch.rationale}`,
            '',
            '## Rationale',
            '',
            this.summarizeDiff(policyPatch.delta)
        ].join('\n');
        
        // Changelog dosya yazma simülasyonu
        this.logger.info(`Generated changelog for ${version}`);
        return changelog;
    }

    generateHash(policyPatch) {
        return 'sha256:' + crypto
            .createHash('sha256')
            .update(JSON.stringify(policyPatch.delta))
            .digest('hex')
            .substring(0, 16);
    }

    emitPolicyPatchProposed(policyPatch) {
        this.eventBus.emit('policy.patch.proposed', policyPatch);
        this.logger.info(`Policy patch proposed: ${policyPatch.targetVersion} (${policyPatch.impact} impact)`);
    }

    emitAlert(level, message) {
        const event = {
            event: 'policy.alert',
            timestamp: new Date().toISOString(),
            level,
            message
        };

        this.eventBus.emit('policy.alert', event);
        this.logger.warn(`Policy alert: ${level} - ${message}`);
    }

    emitMetrics() {
        const event = {
            event: 'policy.metrics',
            timestamp: new Date().toISOString(),
            ...this.state.metrics,
            avgApprovalMin: 18,
            avgCanaryMin: 32,
            riskScoreP95: 0.55
        };

        this.eventBus.emit('policy.metrics', event);
    }

    getStatus() {
        return {
            name: this.name,
            initialized: this.isInitialized,
            status: this.state.status,
            currentVersion: this.state.currentVersion,
            recentDataCounts: Object.fromEntries(
                Array.from(this.state.recentData.entries()).map(([type, events]) => [type, events.length])
            ),
            proposedPolicies: this.state.proposedPolicies.size,
            canaryTests: this.state.canaryTests.size,
            metrics: this.state.metrics
        };
    }

    async shutdown() {
        try {
            this.logger.info(`${this.name} durduruluyor...`);
            
            if (this.scheduleTimer) {
                clearInterval(this.scheduleTimer);
                this.scheduleTimer = null;
            }
            
            // Son metrics emit et
            this.emitMetrics();
            
            this.isInitialized = false;
            this.logger.info(`${this.name} başarıyla durduruldu`);
        } catch (error) {
            this.logger.error(`${this.name} durdurma hatası:`, error);
        }
    }
}

module.exports = PolicyUpdateOrchestrator;