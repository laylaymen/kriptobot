/**
 * LIVIA-28: Runbook Auto Pilot
 * Postmortem ve bilgi tabanından öğrenilmiş runbook adımlarını yarı-otonom işleyen sistem
 */

const { z } = require('zod');
const EventEmitter = require('events');
const crypto = require('crypto');

// Input schemas
const RunbookTemplateUpdatedSchema = z.object({
    event: z.literal('runbook.template.updated'),
    timestamp: z.string(),
    runbookId: z.string(),
    title: z.string(),
    steps: z.array(z.object({
        id: z.string(),
        kind: z.string(),
        params: z.record(z.any())
    })),
    requiresApproval: z.array(z.string()).default([])
}).strict();

const IncidentStartedSchema = z.object({
    event: z.literal('incident.started'),
    timestamp: z.string(),
    id: z.string(),
    severity: z.enum(['low', 'medium', 'high', 'critical']),
    title: z.string()
}).strict();

const IncidentClosedSchema = z.object({
    event: z.literal('incident.closed'),
    timestamp: z.string(),
    id: z.string(),
    resolution: z.string(),
    durationMin: z.number()
}).strict();

const RunbookExecuteRequestSchema = z.object({
    event: z.literal('runbook.execute.request'),
    timestamp: z.string(),
    incidentId: z.string(),
    runbookId: z.string(),
    dryRun: z.boolean().default(false)
}).strict();

const ApprovalResultSchema = z.object({
    event: z.literal('approval.result'),
    timestamp: z.string(),
    ref: z.string(),
    decision: z.enum(['granted', 'rejected', 'timeout'])
}).strict();

// Output schemas
const RunbookExecPlannedSchema = z.object({
    event: z.literal('runbook.exec.planned'),
    timestamp: z.string(),
    execKey: z.string(),
    incidentId: z.string(),
    runbookId: z.string(),
    steps: z.array(z.string()),
    requiresApproval: z.array(z.string())
}).strict();

const RunbookExecStartedSchema = z.object({
    event: z.literal('runbook.exec.started'),
    timestamp: z.string(),
    execKey: z.string(),
    startedAt: z.string()
}).strict();

const RunbookStepProgressSchema = z.object({
    event: z.literal('runbook.step.progress'),
    timestamp: z.string(),
    execKey: z.string(),
    stepId: z.string(),
    status: z.enum(['ok', 'blocked', 'skipped']),
    details: z.string()
}).strict();

const RunbookStepBlockedSchema = z.object({
    event: z.literal('runbook.step.blocked'),
    timestamp: z.string(),
    execKey: z.string(),
    stepId: z.string(),
    reason: z.enum(['approval_required', 'ethics_denied', 'timeout']),
    next: z.enum(['await_approval', 'rollback'])
}).strict();

const RunbookExecCompletedSchema = z.object({
    event: z.literal('runbook.exec.completed'),
    timestamp: z.string(),
    execKey: z.string(),
    durationSec: z.number(),
    result: z.enum(['success', 'partial', 'failed'])
}).strict();

class RunbookAutoPilot extends EventEmitter {
    constructor(eventBus, logger, config = {}) {
        super();
        this.eventBus = eventBus;
        this.logger = logger;
        this.name = 'RunbookAutoPilot';
        
        this.config = {
            i18n: { locale: 'tr-TR', tz: 'Europe/Istanbul' },
            library: {
                'cooldown.plan': { bridge: 'L16' },
                'defense.gate': { bridge: 'L17' },
                'anchor.reset': { bridge: 'L18' },
                'policy.rollback': { bridge: 'L23' },
                'policy.publish': { bridge: 'L23' },
                'status.post': { bridge: 'L22' },
                'dist.notify': { bridge: 'L22' },
                'kb.index': { bridge: 'L24' },
                'cache.flush': { bridge: 'adapter' },
                'service.scale': { bridge: 'adapter' }
            },
            approvals: {
                gateway: 'LIVIA-05',
                requireFor: ['policy.rollback', 'policy.publish', 'service.scale>2x']
            },
            ethics: { gateway: 'LIVIA-26', enforce: true },
            execution: {
                concurrency: 1,
                stepTimeoutSec: 60,
                rollbackOnFail: true,
                dryRunDefault: false
            },
            redaction: { profile: 'generic' },
            idempotencyTtlSec: 86400,
            ...config
        };

        this.state = {
            status: 'IDLE',
            executions: new Map(),
            templates: new Map(),
            pendingApprovals: new Map(),
            metrics: {
                planned: 0,
                started: 0,
                completed: 0,
                failed: 0,
                p95StepMs: 0,
                blocked: 0,
                approvals: 0,
                avgDurationSec: 0
            }
        };

        this.bridges = new Map();
        this.isInitialized = false;
    }

    async initialize() {
        try {
            this.logger.info(`${this.name} başlatılıyor...`);
            
            // Event listeners
            this.eventBus.on('runbook.template.updated', this.handleRunbookTemplateUpdated.bind(this));
            this.eventBus.on('incident.started', this.handleIncidentStarted.bind(this));
            this.eventBus.on('incident.closed', this.handleIncidentClosed.bind(this));
            this.eventBus.on('runbook.execute.request', this.handleRunbookExecuteRequest.bind(this));
            this.eventBus.on('approval.result', this.handleApprovalResult.bind(this));

            // Initialize bridges
            this.initializeBridges();
            
            this.isInitialized = true;
            this.logger.info(`${this.name} başarıyla başlatıldı`);
            return true;
        } catch (error) {
            this.logger.error(`${this.name} başlatma hatası:`, error);
            return false;
        }
    }

    initializeBridges() {
        // Initialize bridge mappings for different step kinds
        for (const [stepKind, bridgeInfo] of Object.entries(this.config.library)) {
            this.bridges.set(stepKind, bridgeInfo);
            this.logger.info(`Bridge initialized: ${stepKind} -> ${bridgeInfo.bridge}`);
        }
    }

    handleRunbookTemplateUpdated(data) {
        try {
            const validated = RunbookTemplateUpdatedSchema.parse(data);
            this.logger.info(`Runbook template updated: ${validated.runbookId} - ${validated.title}`);
            this.storeTemplate(validated);
        } catch (error) {
            this.logger.error('Runbook template validation error:', error);
            this.emitAlert('error', 'invalid_template_update');
        }
    }

    handleIncidentStarted(data) {
        try {
            const validated = IncidentStartedSchema.parse(data);
            this.logger.info(`Incident started: ${validated.id} - ${validated.severity}`);
            
            // Look for applicable runbooks
            const applicableRunbooks = this.findApplicableRunbooks(validated);
            
            if (applicableRunbooks.length > 0) {
                this.logger.info(`Found ${applicableRunbooks.length} applicable runbooks for incident ${validated.id}`);
                // Auto-suggest the first matching runbook
                const suggestedRunbook = applicableRunbooks[0];
                this.suggestRunbookExecution(validated.id, suggestedRunbook.runbookId);
            }
        } catch (error) {
            this.logger.error('Incident started validation error:', error);
        }
    }

    handleIncidentClosed(data) {
        try {
            const validated = IncidentClosedSchema.parse(data);
            this.logger.info(`Incident closed: ${validated.id} - ${validated.resolution}`);
            
            // Clean up any running executions for this incident
            this.cleanupIncidentExecutions(validated.id);
        } catch (error) {
            this.logger.error('Incident closed validation error:', error);
        }
    }

    handleRunbookExecuteRequest(data) {
        try {
            const validated = RunbookExecuteRequestSchema.parse(data);
            this.logger.info(`Runbook execution request: ${validated.runbookId} for incident ${validated.incidentId}`);
            this.processExecutionRequest(validated);
        } catch (error) {
            this.logger.error('Runbook execute request validation error:', error);
            this.emitAlert('error', 'invalid_execute_request');
        }
    }

    handleApprovalResult(data) {
        try {
            const validated = ApprovalResultSchema.parse(data);
            this.logger.info(`Approval result: ${validated.ref} - ${validated.decision}`);
            this.processApprovalResult(validated);
        } catch (error) {
            this.logger.error('Approval result validation error:', error);
        }
    }

    storeTemplate(template) {
        this.state.templates.set(template.runbookId, {
            ...template,
            storedAt: new Date().toISOString()
        });
        
        this.logger.info(`Template stored: ${template.runbookId} (${template.steps.length} steps)`);
    }

    findApplicableRunbooks(incident) {
        const applicableRunbooks = [];
        
        for (const [runbookId, template] of this.state.templates.entries()) {
            // Simple matching based on incident severity and title keywords
            const isApplicable = this.evaluateRunbookApplicability(template, incident);
            
            if (isApplicable) {
                applicableRunbooks.push({
                    runbookId,
                    template,
                    score: this.calculateApplicabilityScore(template, incident)
                });
            }
        }
        
        // Sort by applicability score
        return applicableRunbooks.sort((a, b) => b.score - a.score);
    }

    evaluateRunbookApplicability(template, incident) {
        // Simple heuristic: check if template title contains keywords from incident
        const templateKeywords = template.title.toLowerCase().split(' ');
        const incidentKeywords = incident.title.toLowerCase().split(' ');
        
        const commonKeywords = templateKeywords.filter(keyword => 
            incidentKeywords.some(incKeyword => incKeyword.includes(keyword) || keyword.includes(incKeyword))
        );
        
        return commonKeywords.length > 0 || incident.severity === 'high' || incident.severity === 'critical';
    }

    calculateApplicabilityScore(template, incident) {
        let score = 0;
        
        // Severity matching
        if (incident.severity === 'critical') score += 10;
        if (incident.severity === 'high') score += 7;
        if (incident.severity === 'medium') score += 4;
        
        // Keyword matching
        const templateText = template.title.toLowerCase();
        const incidentText = incident.title.toLowerCase();
        
        const keywords = ['latency', 'slip', 'anomaly', 'feed', 'api', 'down', 'error'];
        keywords.forEach(keyword => {
            if (templateText.includes(keyword) && incidentText.includes(keyword)) {
                score += 5;
            }
        });
        
        return score;
    }

    suggestRunbookExecution(incidentId, runbookId) {
        const suggestionEvent = {
            event: 'runbook.suggestion',
            timestamp: new Date().toISOString(),
            incidentId,
            runbookId,
            reason: 'auto_suggested',
            confidence: 'medium'
        };
        
        this.eventBus.emit('runbook.suggestion', suggestionEvent);
        this.logger.info(`Runbook suggested: ${runbookId} for incident ${incidentId}`);
    }

    async processExecutionRequest(request) {
        const startTime = Date.now();
        
        try {
            this.state.status = 'PLANNING';
            
            // Generate execution key for idempotency
            const execKey = this.generateExecutionKey(request);
            
            if (this.state.executions.has(execKey)) {
                this.logger.info(`Execution already exists: ${execKey}`);
                this.resumeExecution(execKey);
                return;
            }
            
            // Get template
            const template = this.state.templates.get(request.runbookId);
            if (!template) {
                this.emitAlert('error', 'template_not_found');
                return;
            }
            
            // Create execution plan
            const execution = {
                execKey,
                incidentId: request.incidentId,
                runbookId: request.runbookId,
                template,
                dryRun: request.dryRun,
                status: 'PLANNED',
                currentStep: 0,
                startedAt: null,
                completedAt: null,
                steps: template.steps.map(step => ({
                    ...step,
                    status: 'pending',
                    startedAt: null,
                    completedAt: null,
                    result: null
                })),
                requiresApproval: template.requiresApproval || [],
                createdAt: new Date().toISOString()
            };
            
            this.state.executions.set(execKey, execution);
            
            // Emit planned event
            this.emitExecPlanned(execution);
            
            // Pre-flight checks
            const preflightResult = await this.performPreflightChecks(execution);
            if (!preflightResult.passed) {
                execution.status = 'FAILED';
                this.emitExecFailed(execution, preflightResult.reason);
                return;
            }
            
            // Start execution
            await this.startExecution(execution);
            
            // Update metrics
            this.state.metrics.planned++;
            
        } catch (error) {
            this.logger.error(`Execution processing error:`, error);
            this.emitAlert('error', 'execution_processing_failed');
        } finally {
            this.state.status = 'IDLE';
        }
    }

    generateExecutionKey(request) {
        const keyData = {
            incidentId: request.incidentId,
            runbookId: request.runbookId,
            startedAt: new Date().toISOString().split('T')[0] // Date only for daily idempotency
        };
        
        return 'exec:' + crypto
            .createHash('sha256')
            .update(JSON.stringify(keyData))
            .digest('hex')
            .substring(0, 16);
    }

    async performPreflightChecks(execution) {
        // Check RBAC permissions
        const rbacCheck = await this.checkRBACPermissions(execution);
        if (!rbacCheck.allowed) {
            return { passed: false, reason: 'rbac_denied' };
        }
        
        // Check ethics gateway if enforced
        if (this.config.ethics.enforce) {
            const ethicsCheck = await this.checkEthicsGateway(execution);
            if (!ethicsCheck.allowed) {
                return { passed: false, reason: 'ethics_denied' };
            }
        }
        
        // Check for resource conflicts
        const conflictCheck = await this.checkResourceConflicts(execution);
        if (!conflictCheck.passed) {
            return { passed: false, reason: 'resource_conflict' };
        }
        
        return { passed: true };
    }

    async checkRBACPermissions(execution) {
        // Simulate RBAC check
        const hasPermission = true; // In real implementation, check against user roles
        
        return {
            allowed: hasPermission,
            reason: hasPermission ? null : 'insufficient_permissions'
        };
    }

    async checkEthicsGateway(execution) {
        // Send to ethics gateway for review
        const ethicsRequest = {
            event: 'ethics.review.request',
            timestamp: new Date().toISOString(),
            actionType: 'runbook_execution',
            context: {
                runbookId: execution.runbookId,
                incidentId: execution.incidentId,
                stepsCount: execution.steps.length,
                requiresApproval: execution.requiresApproval.length
            }
        };
        
        this.eventBus.emit('ethics.review.request', ethicsRequest);
        
        // For now, assume allowed (real implementation would wait for response)
        return { allowed: true };
    }

    async checkResourceConflicts(execution) {
        // Check for concurrent executions that might conflict
        const concurrentExecutions = Array.from(this.state.executions.values())
            .filter(exec => exec.status === 'RUNNING' && exec.execKey !== execution.execKey);
        
        if (concurrentExecutions.length >= this.config.execution.concurrency) {
            return { passed: false, reason: 'concurrency_limit_reached' };
        }
        
        return { passed: true };
    }

    async startExecution(execution) {
        execution.status = 'RUNNING';
        execution.startedAt = new Date().toISOString();
        
        this.emitExecStarted(execution);
        this.state.metrics.started++;
        
        // Start executing steps
        this.executeNextStep(execution);
    }

    async executeNextStep(execution) {
        if (execution.currentStep >= execution.steps.length) {
            // All steps completed
            await this.completeExecution(execution, 'success');
            return;
        }
        
        const step = execution.steps[execution.currentStep];
        
        try {
            // Check if step requires approval
            if (execution.requiresApproval.includes(step.id)) {
                await this.requestStepApproval(execution, step);
                return; // Wait for approval
            }
            
            // Execute step
            await this.executeStep(execution, step);
            
        } catch (error) {
            this.logger.error(`Step execution error: ${step.id}`, error);
            
            if (this.config.execution.rollbackOnFail) {
                await this.rollbackExecution(execution);
            } else {
                await this.completeExecution(execution, 'failed');
            }
        }
    }

    async requestStepApproval(execution, step) {
        const approvalRef = `runbook:${execution.runbookId}:${step.id}`;
        
        // Mark step as waiting for approval
        step.status = 'waiting_approval';
        
        this.state.pendingApprovals.set(approvalRef, {
            execution,
            step,
            requestedAt: new Date().toISOString()
        });
        
        // Emit blocked event
        this.emitStepBlocked(execution, step, 'approval_required', 'await_approval');
        
        // Send approval request
        const approvalRequest = {
            event: 'approval.request',
            timestamp: new Date().toISOString(),
            ref: approvalRef,
            actionType: 'runbook_step',
            details: {
                runbookId: execution.runbookId,
                stepId: step.id,
                stepKind: step.kind,
                params: step.params,
                incidentId: execution.incidentId
            },
            timeoutSec: this.config.execution.stepTimeoutSec
        };
        
        this.eventBus.emit('approval.request', approvalRequest);
        this.state.metrics.approvals++;
        
        this.logger.info(`Approval requested for step: ${step.id} in execution ${execution.execKey}`);
    }

    async executeStep(execution, step) {
        const stepStartTime = Date.now();
        
        step.status = 'running';
        step.startedAt = new Date().toISOString();
        
        this.logger.info(`Executing step: ${step.id} (${step.kind})`);
        
        try {
            // Get bridge for step kind
            const bridge = this.bridges.get(step.kind);
            if (!bridge) {
                throw new Error(`No bridge found for step kind: ${step.kind}`);
            }
            
            // Execute step through bridge
            const result = await this.executeThroughBridge(bridge, step, execution);
            
            step.status = 'completed';
            step.completedAt = new Date().toISOString();
            step.result = result;
            
            // Emit progress
            this.emitStepProgress(execution, step, 'ok', `${step.kind} completed successfully`);
            
            // Update step timing metrics
            const stepDuration = Date.now() - stepStartTime;
            this.updateStepMetrics(stepDuration);
            
            // Move to next step
            execution.currentStep++;
            
            // Small delay before next step
            setTimeout(() => {
                this.executeNextStep(execution);
            }, 100);
            
        } catch (error) {
            step.status = 'failed';
            step.completedAt = new Date().toISOString();
            step.result = { error: error.message };
            
            this.emitStepProgress(execution, step, 'blocked', error.message);
            throw error;
        }
    }

    async executeThroughBridge(bridge, step, execution) {
        switch (bridge.bridge) {
            case 'L16': // cooldown
                return this.executeCooldownStep(step, execution);
            case 'L17': // defense gate
                return this.executeDefenseGateStep(step, execution);
            case 'L18': // anchor reset
                return this.executeAnchorResetStep(step, execution);
            case 'L22': // status/dist
                return this.executeDistributionStep(step, execution);
            case 'L23': // policy
                return this.executePolicyStep(step, execution);
            case 'L24': // knowledge
                return this.executeKnowledgeStep(step, execution);
            case 'adapter': // generic adapter
                return this.executeAdapterStep(step, execution);
            default:
                throw new Error(`Unknown bridge: ${bridge.bridge}`);
        }
    }

    async executeCooldownStep(step, execution) {
        const cooldownEvent = {
            event: 'cooldown.plan.proposed',
            timestamp: new Date().toISOString(),
            ...step.params,
            source: 'runbook',
            execKey: execution.execKey
        };
        
        this.eventBus.emit('cooldown.plan.proposed', cooldownEvent);
        
        return {
            action: 'cooldown.plan.proposed',
            params: step.params,
            timestamp: new Date().toISOString()
        };
    }

    async executeDefenseGateStep(step, execution) {
        const gateEvent = {
            event: 'defense.gate.proposed',
            timestamp: new Date().toISOString(),
            ...step.params,
            source: 'runbook',
            execKey: execution.execKey
        };
        
        this.eventBus.emit('defense.gate.proposed', gateEvent);
        
        return {
            action: 'defense.gate.proposed',
            params: step.params,
            timestamp: new Date().toISOString()
        };
    }

    async executeAnchorResetStep(step, execution) {
        const anchorEvent = {
            event: 'anchor.reset.proposed',
            timestamp: new Date().toISOString(),
            ...step.params,
            source: 'runbook',
            execKey: execution.execKey
        };
        
        this.eventBus.emit('anchor.reset.proposed', anchorEvent);
        
        return {
            action: 'anchor.reset.proposed',
            params: step.params,
            timestamp: new Date().toISOString()
        };
    }

    async executeDistributionStep(step, execution) {
        const distEvent = {
            event: step.kind, // 'status.post' or 'dist.notify'
            timestamp: new Date().toISOString(),
            ...step.params,
            source: 'runbook',
            execKey: execution.execKey
        };
        
        this.eventBus.emit(step.kind, distEvent);
        
        return {
            action: step.kind,
            params: step.params,
            timestamp: new Date().toISOString()
        };
    }

    async executePolicyStep(step, execution) {
        const policyEvent = {
            event: step.kind, // 'policy.rollback' or 'policy.publish'
            timestamp: new Date().toISOString(),
            ...step.params,
            source: 'runbook',
            execKey: execution.execKey
        };
        
        this.eventBus.emit(step.kind, policyEvent);
        
        return {
            action: step.kind,
            params: step.params,
            timestamp: new Date().toISOString()
        };
    }

    async executeKnowledgeStep(step, execution) {
        const kbEvent = {
            event: 'kb.index',
            timestamp: new Date().toISOString(),
            ...step.params,
            source: 'runbook',
            execKey: execution.execKey
        };
        
        this.eventBus.emit('kb.index', kbEvent);
        
        return {
            action: 'kb.index',
            params: step.params,
            timestamp: new Date().toISOString()
        };
    }

    async executeAdapterStep(step, execution) {
        // Generic adapter for cache.flush, service.scale etc.
        if (execution.dryRun) {
            this.logger.info(`DRY RUN: Would execute ${step.kind} with params:`, step.params);
            return {
                action: step.kind,
                params: step.params,
                dryRun: true,
                timestamp: new Date().toISOString()
            };
        }
        
        // Simulate adapter execution
        this.logger.info(`Executing adapter step: ${step.kind}`);
        
        return {
            action: step.kind,
            params: step.params,
            timestamp: new Date().toISOString()
        };
    }

    async processApprovalResult(approval) {
        const pendingApproval = this.state.pendingApprovals.get(approval.ref);
        
        if (!pendingApproval) {
            this.logger.warn(`No pending approval found for ref: ${approval.ref}`);
            return;
        }
        
        const { execution, step } = pendingApproval;
        
        this.state.pendingApprovals.delete(approval.ref);
        
        if (approval.decision === 'granted') {
            this.logger.info(`Approval granted for step: ${step.id}`);
            
            // Continue with step execution
            try {
                await this.executeStep(execution, step);
            } catch (error) {
                this.logger.error(`Post-approval execution error:`, error);
                if (this.config.execution.rollbackOnFail) {
                    await this.rollbackExecution(execution);
                } else {
                    await this.completeExecution(execution, 'failed');
                }
            }
        } else {
            this.logger.info(`Approval ${approval.decision} for step: ${step.id}`);
            
            step.status = 'skipped';
            step.result = { reason: `approval_${approval.decision}` };
            
            this.emitStepProgress(execution, step, 'skipped', `Approval ${approval.decision}`);
            
            if (approval.decision === 'rejected') {
                await this.rollbackExecution(execution);
            } else {
                // Timeout - continue to next step
                execution.currentStep++;
                this.executeNextStep(execution);
            }
        }
    }

    async rollbackExecution(execution) {
        this.logger.info(`Rolling back execution: ${execution.execKey}`);
        
        execution.status = 'ROLLING_BACK';
        
        // Implement rollback logic based on completed steps
        const completedSteps = execution.steps.filter(step => step.status === 'completed');
        
        for (const step of completedSteps.reverse()) {
            await this.rollbackStep(step, execution);
        }
        
        await this.completeExecution(execution, 'partial');
    }

    async rollbackStep(step, execution) {
        this.logger.info(`Rolling back step: ${step.id}`);
        
        // Emit rollback events based on step kind
        const rollbackEvent = {
            event: `${step.kind}.rollback`,
            timestamp: new Date().toISOString(),
            originalParams: step.params,
            execKey: execution.execKey
        };
        
        this.eventBus.emit(`${step.kind}.rollback`, rollbackEvent);
    }

    async completeExecution(execution, result) {
        execution.status = 'COMPLETED';
        execution.completedAt = new Date().toISOString();
        execution.result = result;
        
        const duration = new Date(execution.completedAt).getTime() - new Date(execution.startedAt).getTime();
        const durationSec = Math.floor(duration / 1000);
        
        // Emit completion event
        this.emitExecCompleted(execution, durationSec, result);
        
        // Update metrics
        if (result === 'success') {
            this.state.metrics.completed++;
        } else {
            this.state.metrics.failed++;
        }
        
        this.updateDurationMetrics(durationSec);
        
        // Generate and emit card
        this.emitRunbookCard(execution);
        
        this.logger.info(`Execution completed: ${execution.execKey} - ${result} (${durationSec}s)`);
    }

    resumeExecution(execKey) {
        const execution = this.state.executions.get(execKey);
        if (!execution) {
            this.logger.warn(`Cannot resume execution: ${execKey} not found`);
            return;
        }
        
        this.logger.info(`Resuming execution: ${execKey} at step ${execution.currentStep}`);
        
        if (execution.status === 'RUNNING') {
            this.executeNextStep(execution);
        }
    }

    cleanupIncidentExecutions(incidentId) {
        const executions = Array.from(this.state.executions.values())
            .filter(exec => exec.incidentId === incidentId);
        
        for (const execution of executions) {
            if (execution.status === 'RUNNING') {
                this.logger.info(`Stopping execution for closed incident: ${execution.execKey}`);
                execution.status = 'CANCELLED';
                execution.completedAt = new Date().toISOString();
            }
        }
    }

    emitExecPlanned(execution) {
        const event = {
            event: 'runbook.exec.planned',
            timestamp: new Date().toISOString(),
            execKey: execution.execKey,
            incidentId: execution.incidentId,
            runbookId: execution.runbookId,
            steps: execution.steps.map(step => step.id),
            requiresApproval: execution.requiresApproval
        };
        
        this.eventBus.emit('runbook.exec.planned', event);
    }

    emitExecStarted(execution) {
        const event = {
            event: 'runbook.exec.started',
            timestamp: new Date().toISOString(),
            execKey: execution.execKey,
            startedAt: execution.startedAt
        };
        
        this.eventBus.emit('runbook.exec.started', event);
    }

    emitStepProgress(execution, step, status, details) {
        const event = {
            event: 'runbook.step.progress',
            timestamp: new Date().toISOString(),
            execKey: execution.execKey,
            stepId: step.id,
            status,
            details
        };
        
        this.eventBus.emit('runbook.step.progress', event);
    }

    emitStepBlocked(execution, step, reason, next) {
        const event = {
            event: 'runbook.step.blocked',
            timestamp: new Date().toISOString(),
            execKey: execution.execKey,
            stepId: step.id,
            reason,
            next
        };
        
        this.eventBus.emit('runbook.step.blocked', event);
        this.state.metrics.blocked++;
    }

    emitExecCompleted(execution, durationSec, result) {
        const event = {
            event: 'runbook.exec.completed',
            timestamp: new Date().toISOString(),
            execKey: execution.execKey,
            durationSec,
            result
        };
        
        this.eventBus.emit('runbook.exec.completed', event);
    }

    emitExecFailed(execution, error) {
        const event = {
            event: 'runbook.exec.failed',
            timestamp: new Date().toISOString(),
            execKey: execution.execKey,
            error
        };
        
        this.eventBus.emit('runbook.exec.failed', event);
        this.state.metrics.failed++;
    }

    emitRunbookCard(execution) {
        const completedSteps = execution.steps.filter(step => step.status === 'completed').length;
        const totalSteps = execution.steps.length;
        
        let body = `${completedSteps}/${totalSteps} adım tamamlandı`;
        
        if (execution.result === 'success') {
            body += ' • başarıyla tamamlandı';
        } else if (execution.result === 'partial') {
            body += ' • kısmi başarı';
        } else if (execution.result === 'failed') {
            body += ' • başarısız';
        }
        
        const event = {
            event: 'runbook.card',
            timestamp: new Date().toISOString(),
            title: `Runbook Çalışıyor — ${execution.runbookId}`,
            body,
            severity: execution.result === 'success' ? 'info' : 'warn',
            ttlSec: 600
        };
        
        this.eventBus.emit('runbook.card', event);
    }

    updateStepMetrics(stepDurationMs) {
        const currentP95 = this.state.metrics.p95StepMs;
        const newP95 = currentP95 === 0 ? stepDurationMs : (currentP95 * 0.95 + stepDurationMs * 0.05);
        this.state.metrics.p95StepMs = Math.round(newP95);
    }

    updateDurationMetrics(durationSec) {
        const currentAvg = this.state.metrics.avgDurationSec;
        const totalCompleted = this.state.metrics.completed + this.state.metrics.failed;
        
        if (totalCompleted === 1) {
            this.state.metrics.avgDurationSec = durationSec;
        } else {
            this.state.metrics.avgDurationSec = Math.round(
                (currentAvg * (totalCompleted - 1) + durationSec) / totalCompleted
            );
        }
    }

    emitAlert(level, message) {
        const event = {
            event: 'runbook.alert',
            timestamp: new Date().toISOString(),
            level,
            message,
            context: {
                status: this.state.status,
                activeExecutions: Array.from(this.state.executions.values())
                    .filter(exec => exec.status === 'RUNNING').length,
                pendingApprovals: this.state.pendingApprovals.size
            }
        };

        this.eventBus.emit('runbook.alert', event);
        this.logger.warn(`Runbook alert: ${level} - ${message}`);
    }

    emitMetrics() {
        const event = {
            event: 'runbook.metrics',
            timestamp: new Date().toISOString(),
            ...this.state.metrics,
            templatesStored: this.state.templates.size,
            activeExecutions: Array.from(this.state.executions.values())
                .filter(exec => exec.status === 'RUNNING').length,
            pendingApprovals: this.state.pendingApprovals.size
        };

        this.eventBus.emit('runbook.metrics', event);
    }

    getStatus() {
        return {
            name: this.name,
            initialized: this.isInitialized,
            status: this.state.status,
            templates: this.state.templates.size,
            executions: this.state.executions.size,
            pendingApprovals: this.state.pendingApprovals.size,
            bridges: this.bridges.size,
            metrics: this.state.metrics
        };
    }

    async shutdown() {
        try {
            this.logger.info(`${this.name} durduruluyor...`);
            
            // Cancel running executions
            const runningExecutions = Array.from(this.state.executions.values())
                .filter(exec => exec.status === 'RUNNING');
            
            for (const execution of runningExecutions) {
                execution.status = 'CANCELLED';
                execution.completedAt = new Date().toISOString();
                this.logger.info(`Cancelled execution: ${execution.execKey}`);
            }
            
            // Emit final metrics
            this.emitMetrics();
            
            this.isInitialized = false;
            this.logger.info(`${this.name} başarıyla durduruldu`);
        } catch (error) {
            this.logger.error(`${this.name} durdurma hatası:`, error);
        }
    }
}

module.exports = RunbookAutoPilot;