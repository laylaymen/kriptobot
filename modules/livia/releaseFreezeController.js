/**
 * LIVIA-51 · Release Freeze Controller
 * Üretimde riskli dönemlerde release/konfig değişikliklerini otomatik freeze/thaw etmek
 */

const EventEmitter = require('events');

class ReleaseFreezeController extends EventEmitter {
    constructor(config = {}) {
        super();
        this.name = 'ReleaseFreezeController';
        this.config = {
            enabled: true,
            freezeKinds: [
                'app_release',
                'infra_iac', 
                'feature_flag',
                'model_publish',
                'schema_migration',
                'policy_change'
            ],
            scopes: ['global', 'service', 'tenant', 'namespace'],
            defaultRules: [
                {
                    when: 'incident.severity>=high',
                    scope: 'global',
                    kind: ['app_release', 'infra_iac', 'feature_flag', 'model_publish'],
                    ttlMin: 180,
                    requiresApprovals: ['policy-lead'],
                    exceptions: ['hotfix:sev1', 'security:critical_patch']
                },
                {
                    when: 'slo.burnPct>5 OR cost.guard=hard',
                    scope: 'service',
                    kind: ['app_release', 'feature_flag', 'model_publish'],
                    ttlMin: 60,
                    requiresApprovals: ['sre-lead']
                },
                {
                    when: 'mrf.phase=execute OR drill.active=true',
                    scope: 'global',
                    kind: ['app_release', 'infra_iac', 'policy_change'],
                    ttlMin: 120,
                    requiresApprovals: ['ops-lead']
                }
            ],
            calendar: {
                blackoutPeriods: [
                    { name: 'yılbaşı-yoğun', from: '2025-12-30', to: '2026-01-03' },
                    { name: 'bayram-trafiği', pattern: 'holiday-periods' }
                ]
            },
            rbac: {
                freezeManagers: ['ops', 'policy', 'release'],
                approvers: ['policy-lead', 'sre-lead', 'ops-lead'],
                observers: ['developer', 'qa']
            },
            ...config
        };
        
        this.isInitialized = false;
        this.logger = null;
        this.eventBus = null;
        
        // Operational state
        this.state = {
            activeFreezes: new Map(), // freezeKey -> freeze object
            overrideRequests: new Map(), // reqId -> override request
            freezeRules: new Map(), // ruleId -> rule
            triggerStates: {
                incidents: new Map(), // incidentId -> incident
                sloGuards: new Map(), // serviceId -> guard state
                costGuards: new Map(), // component -> guard state
                mrfStates: new Map(), // region -> mrf state
                activeDrills: new Set(), // drillKeys
                auditWindows: new Set(), // audit profiles
                calendarBlackouts: new Set() // blackout names
            }
        };
        
        this.metrics = {
            freezesApplied: 0,
            freezesLifted: 0,
            changesBlocked: 0,
            overridesRequested: 0,
            overridesApproved: 0,
            overridesDenied: 0,
            avgFreezeDurationMin: 0
        };
    }

    async initialize(logger, eventBus) {
        try {
            this.logger = logger;
            this.eventBus = eventBus;
            this.logger.info(`${this.name} başlatılıyor...`);
            
            await this.setupEventHandlers();
            await this.loadDefaultRules();
            await this.checkInitialTriggers();
            
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

        // Policy updates
        this.eventBus.on('freeze.policy.updated', (data) => {
            this.handleFreezeRulesUpdate(data);
        });
        
        // Trigger events
        this.eventBus.on('incident.started', (data) => {
            this.handleIncidentStarted(data);
        });
        
        this.eventBus.on('incident.closed', (data) => {
            this.handleIncidentClosed(data);
        });
        
        this.eventBus.on('slo.guard.triggered', (data) => {
            this.handleSloGuardTriggered(data);
        });
        
        this.eventBus.on('slo.guard.recovered', (data) => {
            this.handleSloGuardRecovered(data);
        });
        
        this.eventBus.on('cost.guard.triggered', (data) => {
            this.handleCostGuardTriggered(data);
        });
        
        this.eventBus.on('cost.guard.recovered', (data) => {
            this.handleCostGuardRecovered(data);
        });
        
        this.eventBus.on('mrf.state.update', (data) => {
            this.handleMrfStateUpdate(data);
        });
        
        this.eventBus.on('drill.started', (data) => {
            this.handleDrillStarted(data);
        });
        
        this.eventBus.on('drill.ended', (data) => {
            this.handleDrillEnded(data);
        });
        
        this.eventBus.on('audit.window.opened', (data) => {
            this.handleAuditWindowOpened(data);
        });
        
        this.eventBus.on('audit.window.closed', (data) => {
            this.handleAuditWindowClosed(data);
        });
        
        this.eventBus.on('calendar.blackout.added', (data) => {
            this.handleCalendarBlackoutAdded(data);
        });
        
        this.eventBus.on('calendar.blackout.removed', (data) => {
            this.handleCalendarBlackoutRemoved(data);
        });
        
        // Change attempts
        this.eventBus.on('change.attempted', (data) => {
            this.handleChangeAttempted(data);
        });
        
        // Override management
        this.eventBus.on('freeze.override.request', (data) => {
            this.handleOverrideRequest(data);
        });
        
        this.eventBus.on('override.approval.updated', (data) => {
            this.handleOverrideApproval(data);
        });
        
        // Manual freeze requests
        this.eventBus.on('release.window.request', (data) => {
            this.handleReleaseWindowRequest(data);
        });
    }

    async loadDefaultRules() {
        for (const [index, rule] of this.config.defaultRules.entries()) {
            const ruleId = `default-${index}`;
            this.state.freezeRules.set(ruleId, {
                ...rule,
                ruleId,
                source: 'default',
                createdAt: new Date().toISOString()
            });
        }
        
        this.logger.info(`Loaded ${this.config.defaultRules.length} default freeze rules`);
    }

    async checkInitialTriggers() {
        // Check if any conditions are already active that should trigger freezes
        await this.evaluateAllRules();
    }

    async handleFreezeRulesUpdate(data) {
        const { policyId, rules } = data;
        
        // Update rules in state
        for (const [index, rule] of rules.entries()) {
            const ruleId = `${policyId}-${index}`;
            this.state.freezeRules.set(ruleId, {
                ...rule,
                ruleId,
                source: policyId,
                updatedAt: new Date().toISOString()
            });
        }
        
        this.logger.info(`Updated freeze rules from policy: ${policyId}`);
        
        // Re-evaluate all rules with new policy
        await this.evaluateAllRules();
    }

    async handleIncidentStarted(data) {
        const { id, severity, scope } = data;
        
        this.state.triggerStates.incidents.set(id, {
            id,
            severity,
            scope,
            startedAt: data.timestamp
        });
        
        this.logger.info(`Incident started: ${id} (${severity}), evaluating freeze rules`);
        
        // Evaluate rules that trigger on incidents
        await this.evaluateRulesForTrigger('incident', { severity, scope });
    }

    async handleIncidentClosed(data) {
        const { id } = data;
        
        this.state.triggerStates.incidents.delete(id);
        this.logger.info(`Incident closed: ${id}, re-evaluating freeze rules`);
        
        // Re-evaluate all rules since incident state changed
        await this.evaluateAllRules();
    }

    async handleSloGuardTriggered(data) {
        const { serviceId, slo, burnPct, severity } = data;
        
        this.state.triggerStates.sloGuards.set(serviceId, {
            serviceId,
            slo,
            burnPct,
            severity,
            triggeredAt: data.timestamp
        });
        
        this.logger.info(`SLO guard triggered: ${serviceId} (${slo}), burn: ${burnPct}%`);
        
        // Evaluate rules that trigger on SLO burn
        await this.evaluateRulesForTrigger('slo', { serviceId, burnPct, severity });
    }

    async handleSloGuardRecovered(data) {
        const { serviceId } = data;
        
        this.state.triggerStates.sloGuards.delete(serviceId);
        this.logger.info(`SLO guard recovered: ${serviceId}`);
        
        await this.evaluateAllRules();
    }

    async handleCostGuardTriggered(data) {
        const { component, severity, deltaUSDPerHour } = data;
        
        this.state.triggerStates.costGuards.set(component, {
            component,
            severity,
            deltaUSDPerHour,
            triggeredAt: data.timestamp
        });
        
        this.logger.info(`Cost guard triggered: ${component} (${severity}), delta: $${deltaUSDPerHour}/hr`);
        
        await this.evaluateRulesForTrigger('cost', { component, severity, deltaUSDPerHour });
    }

    async handleCostGuardRecovered(data) {
        const { component } = data;
        
        this.state.triggerStates.costGuards.delete(component);
        this.logger.info(`Cost guard recovered: ${component}`);
        
        await this.evaluateAllRules();
    }

    async handleMrfStateUpdate(data) {
        const { fromRegion, toRegion, phase } = data;
        const regionKey = `${fromRegion}->${toRegion}`;
        
        this.state.triggerStates.mrfStates.set(regionKey, {
            fromRegion,
            toRegion,
            phase,
            updatedAt: data.timestamp
        });
        
        this.logger.info(`MRF state update: ${regionKey}, phase: ${phase}`);
        
        if (phase === 'execute' || phase === 'stabilize') {
            await this.evaluateRulesForTrigger('mrf', { phase, regionKey });
        } else if (phase === 'completed' || phase === 'failed') {
            this.state.triggerStates.mrfStates.delete(regionKey);
            await this.evaluateAllRules();
        }
    }

    async handleDrillStarted(data) {
        const { scenarioId, env } = data;
        const drillKey = `${scenarioId}#${env}`;
        
        this.state.triggerStates.activeDrills.add(drillKey);
        this.logger.info(`Drill started: ${drillKey}`);
        
        await this.evaluateRulesForTrigger('drill', { scenarioId, env });
    }

    async handleDrillEnded(data) {
        const { scenarioId, env } = data;
        const drillKey = `${scenarioId}#${env}`;
        
        this.state.triggerStates.activeDrills.delete(drillKey);
        this.logger.info(`Drill ended: ${drillKey}`);
        
        await this.evaluateAllRules();
    }

    async handleAuditWindowOpened(data) {
        const { profile, strict } = data;
        
        this.state.triggerStates.auditWindows.add(profile);
        this.logger.info(`Audit window opened: ${profile} (strict: ${strict})`);
        
        if (strict) {
            await this.evaluateRulesForTrigger('audit', { profile, strict });
        }
    }

    async handleAuditWindowClosed(data) {
        const { profile } = data;
        
        this.state.triggerStates.auditWindows.delete(profile);
        this.logger.info(`Audit window closed: ${profile}`);
        
        await this.evaluateAllRules();
    }

    async handleCalendarBlackoutAdded(data) {
        const { name, kinds, scopes } = data;
        
        this.state.triggerStates.calendarBlackouts.add(name);
        this.logger.info(`Calendar blackout added: ${name}`);
        
        await this.evaluateRulesForTrigger('calendar', { name, kinds, scopes });
    }

    async handleCalendarBlackoutRemoved(data) {
        const { name } = data;
        
        this.state.triggerStates.calendarBlackouts.delete(name);
        this.logger.info(`Calendar blackout removed: ${name}`);
        
        await this.evaluateAllRules();
    }

    async evaluateAllRules() {
        for (const rule of this.state.freezeRules.values()) {
            await this.evaluateRule(rule);
        }
    }

    async evaluateRulesForTrigger(triggerType, context) {
        for (const rule of this.state.freezeRules.values()) {
            if (this.ruleMachesTriger(rule, triggerType, context)) {
                await this.evaluateRule(rule);
            }
        }
    }

    ruleMachesTriger(rule, triggerType, context) {
        const when = rule.when.toLowerCase();
        
        switch (triggerType) {
            case 'incident':
                return when.includes('incident') && 
                       this.checkSeverityCondition(when, context.severity);
            case 'slo':
                return when.includes('slo') && 
                       this.checkBurnPercentCondition(when, context.burnPct);
            case 'cost':
                return when.includes('cost') && when.includes('guard');
            case 'mrf':
                return when.includes('mrf') && context.phase === 'execute';
            case 'drill':
                return when.includes('drill') && when.includes('active');
            case 'audit':
                return when.includes('audit') && context.strict;
            case 'calendar':
                return when.includes('calendar') || when.includes('blackout');
            default:
                return false;
        }
    }

    checkSeverityCondition(condition, severity) {
        if (condition.includes('severity>=high')) {
            return ['high', 'critical'].includes(severity);
        }
        if (condition.includes('severity>=critical')) {
            return severity === 'critical';
        }
        return true;
    }

    checkBurnPercentCondition(condition, burnPct) {
        const match = condition.match(/burnPct>(\d+)/);
        if (match) {
            const threshold = parseInt(match[1]);
            return burnPct > threshold;
        }
        return false;
    }

    async evaluateRule(rule) {
        const shouldFreeze = await this.shouldRuleTriggerFreeze(rule);
        const freezeKey = this.generateFreezeKey(rule);
        const existingFreeze = this.state.activeFreezes.get(freezeKey);
        
        if (shouldFreeze && !existingFreeze) {
            // Apply new freeze
            await this.applyFreeze(rule, freezeKey);
        } else if (!shouldFreeze && existingFreeze) {
            // Lift existing freeze
            await this.liftFreeze(freezeKey, 'condition_resolved');
        } else if (shouldFreeze && existingFreeze) {
            // Extend existing freeze
            await this.extendFreeze(freezeKey, rule.ttlMin);
        }
    }

    async shouldRuleTriggerFreeze(rule) {
        const when = rule.when.toLowerCase();
        
        // Parse compound conditions (OR/AND)
        const orConditions = when.split(' or ').map(c => c.trim());
        
        for (const orCondition of orConditions) {
            const andConditions = orCondition.split(' and ').map(c => c.trim());
            let allAndConditionsMet = true;
            
            for (const condition of andConditions) {
                const conditionMet = await this.evaluateCondition(condition);
                if (!conditionMet) {
                    allAndConditionsMet = false;
                    break;
                }
            }
            
            if (allAndConditionsMet) {
                return true; // At least one OR branch is satisfied
            }
        }
        
        return false;
    }

    async evaluateCondition(condition) {
        condition = condition.toLowerCase().trim();
        
        // Incident conditions
        if (condition.includes('incident.severity')) {
            const severityMatch = condition.match(/incident\.severity>=(\w+)/);
            if (severityMatch) {
                const requiredSeverity = severityMatch[1];
                return Array.from(this.state.triggerStates.incidents.values())
                    .some(inc => this.checkSeverityCondition(condition, inc.severity));
            }
        }
        
        // SLO conditions
        if (condition.includes('slo.burnpct')) {
            const burnMatch = condition.match(/slo\.burnpct>(\d+)/);
            if (burnMatch) {
                const threshold = parseInt(burnMatch[1]);
                return Array.from(this.state.triggerStates.sloGuards.values())
                    .some(guard => guard.burnPct > threshold);
            }
        }
        
        // Cost conditions
        if (condition.includes('cost.guard')) {
            return this.state.triggerStates.costGuards.size > 0;
        }
        
        // MRF conditions
        if (condition.includes('mrf.phase=execute')) {
            return Array.from(this.state.triggerStates.mrfStates.values())
                .some(mrf => mrf.phase === 'execute');
        }
        
        // Drill conditions
        if (condition.includes('drill.active=true')) {
            return this.state.triggerStates.activeDrills.size > 0;
        }
        
        // Audit conditions
        if (condition.includes('audit.strict=true')) {
            return this.state.triggerStates.auditWindows.size > 0;
        }
        
        // Calendar conditions
        if (condition.includes('calendar.blackout=true')) {
            return this.state.triggerStates.calendarBlackouts.size > 0;
        }
        
        return false;
    }

    generateFreezeKey(rule) {
        const scope = rule.scope || 'global';
        const kind = Array.isArray(rule.kind) ? rule.kind.join(',') : rule.kind;
        const ruleId = rule.ruleId;
        
        return `freeze:${scope}:${kind}:${ruleId}`;
    }

    async applyFreeze(rule, freezeKey) {
        const freeze = {
            freezeKey,
            rule,
            scope: rule.scope,
            kind: rule.kind,
            reason: rule.when,
            appliedAt: new Date().toISOString(),
            expiresAt: this.calculateExpiryTime(rule.ttlMin),
            requiresApprovals: rule.requiresApprovals || [],
            exceptions: rule.exceptions || [],
            status: 'active'
        };
        
        this.state.activeFreezes.set(freezeKey, freeze);
        this.metrics.freezesApplied++;
        
        this.logger.info(`Applied freeze: ${freezeKey} (expires: ${freeze.expiresAt})`);
        
        this.eventBus.emit('freeze.applied', {
            event: 'freeze.applied',
            timestamp: new Date().toISOString(),
            freezeKey,
            scope: rule.scope,
            kind: rule.kind,
            reason: rule.when,
            expiresAt: freeze.expiresAt,
            requiresApprovals: rule.requiresApprovals,
            source: this.name
        });
        
        // Emit freeze card for UI
        this.eventBus.emit('freeze.card', {
            event: 'freeze.card',
            timestamp: new Date().toISOString(),
            title: `Release Freeze Active — ${rule.scope} ${Array.isArray(rule.kind) ? rule.kind.join(', ') : rule.kind}`,
            body: `Reason: ${rule.when} • Expires: ${freeze.expiresAt} • Approvals: ${rule.requiresApprovals?.join(', ') || 'None'}`,
            severity: 'warn',
            ttlSec: rule.ttlMin * 60,
            source: this.name
        });
    }

    async liftFreeze(freezeKey, reason) {
        const freeze = this.state.activeFreezes.get(freezeKey);
        if (!freeze) return;
        
        const duration = Date.now() - new Date(freeze.appliedAt).getTime();
        const durationMin = Math.round(duration / (60 * 1000));
        
        this.state.activeFreezes.delete(freezeKey);
        this.metrics.freezesLifted++;
        
        // Update average duration
        const count = this.metrics.freezesLifted;
        this.metrics.avgFreezeDurationMin = Math.round(
            (this.metrics.avgFreezeDurationMin * (count - 1) + durationMin) / count
        );
        
        this.logger.info(`Lifted freeze: ${freezeKey} (duration: ${durationMin}min, reason: ${reason})`);
        
        this.eventBus.emit('freeze.lifted', {
            event: 'freeze.lifted',
            timestamp: new Date().toISOString(),
            freezeKey,
            reason,
            durationMin,
            source: this.name
        });
    }

    async extendFreeze(freezeKey, additionalMinutes) {
        const freeze = this.state.activeFreezes.get(freezeKey);
        if (!freeze) return;
        
        const newExpiry = this.calculateExpiryTime(additionalMinutes, freeze.expiresAt);
        freeze.expiresAt = newExpiry;
        freeze.extendedAt = new Date().toISOString();
        
        this.logger.info(`Extended freeze: ${freezeKey} (new expiry: ${newExpiry})`);
        
        this.eventBus.emit('freeze.extended', {
            event: 'freeze.extended',
            timestamp: new Date().toISOString(),
            freezeKey,
            newExpiresAt: newExpiry,
            additionalMinutes,
            source: this.name
        });
    }

    calculateExpiryTime(ttlMin, baseTime = null) {
        const base = baseTime ? new Date(baseTime) : new Date();
        const expiry = new Date(base.getTime() + (ttlMin * 60 * 1000));
        return expiry.toISOString();
    }

    async handleChangeAttempted(data) {
        const { kind, scope, ref, actor } = data;
        
        // Check if change is frozen
        const blockingFreezes = this.findBlockingFreezes(kind, scope);
        
        if (blockingFreezes.length > 0) {
            this.metrics.changesBlocked++;
            
            this.logger.warn(`Change blocked by freeze: ${kind} @ ${scope}, actor: ${actor}`);
            
            this.eventBus.emit('change.blocked', {
                event: 'change.blocked',
                timestamp: new Date().toISOString(),
                kind,
                scope,
                ref,
                actor,
                blockingFreezes: blockingFreezes.map(f => f.freezeKey),
                source: this.name
            });
            
            // Generate helpful message for developer
            const freeze = blockingFreezes[0];
            this.eventBus.emit('change.blocked.card', {
                event: 'change.blocked.card',
                timestamp: new Date().toISOString(),
                title: `Change Blocked — ${kind} @ ${scope}`,
                body: `Release freeze active until ${freeze.expiresAt}. Reason: ${freeze.reason}. ` +
                      `Override options: ${freeze.requiresApprovals.join(', ') || 'Contact ops team'}`,
                severity: 'warn',
                ttlSec: 300,
                source: this.name
            });
        } else {
            this.eventBus.emit('change.allowed', {
                event: 'change.allowed',
                timestamp: new Date().toISOString(),
                kind,
                scope,
                ref,
                actor,
                source: this.name
            });
        }
    }

    findBlockingFreezes(kind, scope) {
        const blockingFreezes = [];
        
        for (const freeze of this.state.activeFreezes.values()) {
            if (freeze.status !== 'active') continue;
            
            // Check if freeze has expired
            if (new Date() > new Date(freeze.expiresAt)) {
                this.liftFreeze(freeze.freezeKey, 'expired');
                continue;
            }
            
            // Check scope match
            const scopeMatches = this.scopeMatches(freeze.scope, scope);
            if (!scopeMatches) continue;
            
            // Check kind match
            const freezeKinds = Array.isArray(freeze.kind) ? freeze.kind : [freeze.kind];
            const kindMatches = freezeKinds.includes(kind);
            if (!kindMatches) continue;
            
            blockingFreezes.push(freeze);
        }
        
        return blockingFreezes;
    }

    scopeMatches(freezeScope, changeScope) {
        // Global freezes affect everything
        if (freezeScope === 'global') return true;
        
        // Exact scope match
        if (freezeScope === changeScope) return true;
        
        // Hierarchical scope matching (simplified)
        if (freezeScope === 'service' && changeScope.startsWith('service:')) return true;
        if (freezeScope === 'tenant' && changeScope.startsWith('tenant:')) return true;
        if (freezeScope === 'namespace' && changeScope.startsWith('namespace:')) return true;
        
        return false;
    }

    async handleOverrideRequest(data) {
        const { action, kind, scope, reason, requester, changeRef, approvals } = data;
        const reqId = `ovr#${Date.now().toString(16)}`;
        
        const override = {
            reqId,
            action,
            kind,
            scope,
            reason,
            requester,
            changeRef,
            requestedAt: new Date().toISOString(),
            requiredApprovals: approvals || [],
            receivedApprovals: [],
            status: 'pending'
        };
        
        this.state.overrideRequests.set(reqId, override);
        this.metrics.overridesRequested++;
        
        this.logger.info(`Override requested: ${reqId} (${action} ${kind} @ ${scope})`);
        
        this.eventBus.emit('override.request.created', {
            event: 'override.request.created',
            timestamp: new Date().toISOString(),
            reqId,
            action,
            kind,
            scope,
            reason,
            requester,
            requiredApprovals: override.requiredApprovals,
            source: this.name
        });
        
        // If no approvals required, auto-approve
        if (override.requiredApprovals.length === 0) {
            await this.processOverride(override);
        }
    }

    async handleOverrideApproval(data) {
        const { reqId, approvedBy, state } = data;
        const override = this.state.overrideRequests.get(reqId);
        
        if (!override) {
            this.logger.warn(`Override request not found: ${reqId}`);
            return;
        }
        
        if (state === 'approved') {
            override.receivedApprovals.push({
                approver: approvedBy,
                approvedAt: new Date().toISOString()
            });
            
            this.logger.info(`Override approval received: ${reqId} from ${approvedBy}`);
            
            // Check if all required approvals received
            const requiredSet = new Set(override.requiredApprovals);
            const receivedSet = new Set(override.receivedApprovals.map(a => a.approver));
            const hasAllApprovals = override.requiredApprovals.every(req => receivedSet.has(req));
            
            if (hasAllApprovals) {
                override.status = 'approved';
                await this.processOverride(override);
            }
        } else if (state === 'rejected') {
            override.status = 'rejected';
            override.rejectedBy = approvedBy;
            override.rejectedAt = new Date().toISOString();
            
            this.metrics.overridesDenied++;
            
            this.logger.info(`Override rejected: ${reqId} by ${approvedBy}`);
            
            this.eventBus.emit('override.rejected', {
                event: 'override.rejected',
                timestamp: new Date().toISOString(),
                reqId,
                rejectedBy: approvedBy,
                source: this.name
            });
        }
    }

    async processOverride(override) {
        const { reqId, action, kind, scope } = override;
        
        try {
            switch (action) {
                case 'allow_single':
                    await this.allowSingleChange(override);
                    break;
                    
                case 'extend':
                    await this.extendMatchingFreezes(kind, scope, 60); // 1 hour extension
                    break;
                    
                case 'lift_now':
                    await this.liftMatchingFreezes(kind, scope, 'manual_override');
                    break;
                    
                default:
                    throw new Error(`Unknown override action: ${action}`);
            }
            
            override.status = 'processed';
            override.processedAt = new Date().toISOString();
            this.metrics.overridesApproved++;
            
            this.logger.info(`Override processed: ${reqId} (${action})`);
            
            this.eventBus.emit('override.processed', {
                event: 'override.processed',
                timestamp: new Date().toISOString(),
                reqId,
                action,
                source: this.name
            });
            
        } catch (error) {
            override.status = 'failed';
            override.error = error.message;
            
            this.logger.error(`Override processing failed: ${reqId}`, error);
            
            this.eventBus.emit('override.failed', {
                event: 'override.failed',
                timestamp: new Date().toISOString(),
                reqId,
                error: error.message,
                source: this.name
            });
        }
    }

    async allowSingleChange(override) {
        // Create temporary exception for this specific change
        const exceptionKey = `${override.kind}:${override.scope}:${override.changeRef?.pr || 'manual'}`;
        
        this.eventBus.emit('change.exception.granted', {
            event: 'change.exception.granted',
            timestamp: new Date().toISOString(),
            exceptionKey,
            kind: override.kind,
            scope: override.scope,
            changeRef: override.changeRef,
            requester: override.requester,
            ttlMin: 30, // 30 minute window
            source: this.name
        });
    }

    async extendMatchingFreezes(kind, scope, extensionMin) {
        for (const freeze of this.state.activeFreezes.values()) {
            if (this.scopeMatches(freeze.scope, scope)) {
                const freezeKinds = Array.isArray(freeze.kind) ? freeze.kind : [freeze.kind];
                if (freezeKinds.includes(kind)) {
                    await this.extendFreeze(freeze.freezeKey, extensionMin);
                }
            }
        }
    }

    async liftMatchingFreezes(kind, scope, reason) {
        const freezesToLift = [];
        
        for (const freeze of this.state.activeFreezes.values()) {
            if (this.scopeMatches(freeze.scope, scope)) {
                const freezeKinds = Array.isArray(freeze.kind) ? freeze.kind : [freeze.kind];
                if (freezeKinds.includes(kind)) {
                    freezesToLift.push(freeze.freezeKey);
                }
            }
        }
        
        for (const freezeKey of freezesToLift) {
            await this.liftFreeze(freezeKey, reason);
        }
    }

    async handleReleaseWindowRequest(data) {
        // Handle manual release window requests
        const { window, reason, requestedBy } = data;
        
        this.logger.info(`Release window requested: ${window.start} - ${window.end}`);
        
        // Create temporary freeze lift for the window
        this.eventBus.emit('release.window.granted', {
            event: 'release.window.granted',
            timestamp: new Date().toISOString(),
            window,
            reason,
            requestedBy,
            source: this.name
        });
    }

    getStatus() {
        const now = new Date();
        const activeFreezes = Array.from(this.state.activeFreezes.values());
        const expiredFreezes = activeFreezes.filter(f => new Date(f.expiresAt) <= now);
        
        // Clean up expired freezes
        for (const freeze of expiredFreezes) {
            this.liftFreeze(freeze.freezeKey, 'expired');
        }
        
        return {
            name: this.name,
            initialized: this.isInitialized,
            enabled: this.config.enabled,
            state: {
                activeFreezes: this.state.activeFreezes.size,
                pendingOverrides: Array.from(this.state.overrideRequests.values())
                    .filter(o => o.status === 'pending').length,
                triggerStates: {
                    incidents: this.state.triggerStates.incidents.size,
                    sloGuards: this.state.triggerStates.sloGuards.size,
                    costGuards: this.state.triggerStates.costGuards.size,
                    mrfStates: this.state.triggerStates.mrfStates.size,
                    activeDrills: this.state.triggerStates.activeDrills.size
                }
            },
            metrics: this.metrics
        };
    }

    async getMetrics() {
        if (!this.isInitialized) return null;

        return {
            event: 'freeze.metrics',
            timestamp: new Date().toISOString(),
            freezesApplied: this.metrics.freezesApplied,
            freezesLifted: this.metrics.freezesLifted,
            changesBlocked: this.metrics.changesBlocked,
            overridesRequested: this.metrics.overridesRequested,
            overridesApproved: this.metrics.overridesApproved,
            overridesDenied: this.metrics.overridesDenied,
            avgFreezeDurationMin: this.metrics.avgFreezeDurationMin,
            activeFreezes: this.state.activeFreezes.size,
            source: this.name
        };
    }

    async shutdown() {
        try {
            this.logger.info(`${this.name} durduruluyor...`);
            
            // Gracefully lift all active freezes
            for (const freezeKey of this.state.activeFreezes.keys()) {
                await this.liftFreeze(freezeKey, 'system_shutdown');
            }
            
            this.isInitialized = false;
            this.removeAllListeners();
            this.logger.info(`${this.name} başarıyla durduruldu`);
        } catch (error) {
            this.logger.error(`${this.name} durdurma hatası:`, error);
        }
    }
}

module.exports = ReleaseFreezeController;