/**
 * LIVIA-05 · actionApprovalGateway.js
 * Eylem onay kapısı - dual-control, quorum, RBAC, TTL sistemi
 * 
 * Amaç: Operatör/otomat kararlarını tek kapıdan geçirmek. Riskli eylemler için 
 * dual-control / quorum, RBAC (rol yetkisi), TTL, gerekçelendirme, bypass (acil durum) 
 * ve geri alma (revoke/rollback) mantığı uygular.
 */

const { z } = require('zod');
const { eventBus } = require('../../kirpto bot sinyal/modules/modularEventStream');
const { logInfo, logError, logEvent } = require('../../kirpto bot sinyal/logs/logger');

/**
 * 🔄 Input Event Schemas
 */
const OperatorDecisionFinalSchema = z.object({
    event: z.literal('operator.decision.final'),
    timestamp: z.string(),
    promptId: z.string(),
    decisionId: z.string(),
    accepted: z.boolean(),
    rationale: z.string().optional(),
    ttlSec: z.number().int().min(0).optional(),
    context: z.object({
        action: z.string(),
        payload: z.record(z.any()),
        approvalKey: z.string()
    }),
    auth: z.object({
        userId: z.string(),
        roles: z.array(z.string()),
        sig: z.string()
    })
});

const ManualApprovalRequestSchema = z.object({
    event: z.literal('manual.approval.request'),
    timestamp: z.string(),
    approvalKey: z.string(),
    action: z.string(),
    payload: z.record(z.any()),
    requestedBy: z.object({
        userId: z.string(),
        roles: z.array(z.string()),
        sig: z.string()
    }),
    reason: z.string()
});

const PolicySnapshotSchema = z.object({
    event: z.literal('policy.snapshot'),
    timestamp: z.string(),
    roles: z.record(z.array(z.string())), // role -> allowed actions
    approvalProfiles: z.record(z.object({
        type: z.enum(['single', 'dual', 'quorum']),
        quorum: z.number().int().min(1).optional(),
        of: z.number().int().min(1).optional(),
        ttlSec: z.number().int().min(0),
        reasonMinChars: z.number().int().min(0).optional(),
        allowlist: z.array(z.string()).optional(),
        roles: z.array(z.string()).optional()
    }))
});

const SentryGuardDirectiveSchema = z.object({
    event: z.literal('sentry.guard.directive'),
    timestamp: z.string(),
    mode: z.enum(['normal', 'degraded', 'streams_panic', 'halt_entry']),
    expiresAt: z.string()
});

const ConfirmationBoundsCheckSchema = z.object({
    event: z.literal('confirmation.bounds.check'),
    timestamp: z.string(),
    checkId: z.string(),
    ok: z.boolean(),
    severity: z.enum(['soft', 'hard']).optional(),
    violations: z.array(z.any())
});

const RiskIncidentEmergencyStopSchema = z.object({
    event: z.literal('risk.incident.emergency_stop'),
    timestamp: z.string(),
    active: z.boolean(),
    reason: z.string()
});

/**
 * 📤 Output Event Schemas
 */
const ActionApprovedSchema = z.object({
    event: z.literal('action.approved'),
    timestamp: z.string(),
    approvalKey: z.string(),
    action: z.string(),
    payload: z.record(z.any()),
    ttlSec: z.number().int().min(0),
    by: z.array(z.object({
        userId: z.string(),
        roles: z.array(z.string()),
        ts: z.string()
    })),
    chain: z.object({
        required: z.string(),
        collected: z.number().int().min(0)
    }),
    reason: z.string(),
    audit: z.object({
        eventId: z.string(),
        producedBy: z.string(),
        producedAt: z.string()
    })
});

const ActionRejectedSchema = z.object({
    event: z.literal('action.rejected'),
    timestamp: z.string(),
    approvalKey: z.string(),
    action: z.string(),
    reasons: z.array(z.string()),
    by: z.array(z.object({
        userId: z.string(),
        roles: z.array(z.string()),
        ts: z.string()
    })),
    audit: z.object({
        eventId: z.string(),
        producedBy: z.string(),
        producedAt: z.string()
    })
});

const ApprovalPendingSchema = z.object({
    event: z.literal('approval.pending'),
    timestamp: z.string(),
    approvalKey: z.string(),
    action: z.string(),
    needed: z.object({
        quorum: z.number().int().min(1),
        of: z.number().int().min(1)
    }),
    received: z.array(z.object({
        userId: z.string(),
        roles: z.array(z.string()),
        ts: z.string()
    })),
    expiresAt: z.string()
});

const ApprovalRevokedSchema = z.object({
    event: z.literal('approval.revoked'),
    timestamp: z.string(),
    approvalKey: z.string(),
    reason: z.enum(['ttl_expired', 'manual_revoke', 'superseded']),
    rollback: z.object({
        event: z.string(),
        params: z.record(z.any())
    }).optional()
});

/**
 * 🔐 RBAC (Role-Based Access Control) Helper
 */
class RBACController {
    constructor(config) {
        this.config = config;
    }

    /**
     * Check if user has permission for action
     */
    hasPermission(userRoles, action, policyRoles) {
        if (!policyRoles || !userRoles || !Array.isArray(userRoles)) {
            return false;
        }

        for (const role of userRoles) {
            const allowedActions = policyRoles[role] || [];
            if (allowedActions.includes(action)) {
                return true;
            }
        }

        return false;
    }

    /**
     * Verify signature (simplified)
     */
    verifySignature(auth) {
        if (!this.config.security.verifySignature) {
            return true;
        }

        // TODO: Implement actual signature verification
        // For now, just check that signature exists
        return auth.sig && auth.sig.length > 0;
    }
}

/**
 * ⛓️ Approval Chain Builder
 */
class ApprovalChainBuilder {
    constructor() {
        this.chains = new Map(); // approvalKey -> chain state
    }

    /**
     * Initialize or get approval chain
     */
    getOrCreateChain(approvalKey, profile, initiator) {
        if (!this.chains.has(approvalKey)) {
            this.chains.set(approvalKey, {
                approvalKey,
                profile,
                approvers: [],
                created: new Date(),
                expiresAt: new Date(Date.now() + profile.ttlSec * 1000)
            });
        }

        const chain = this.chains.get(approvalKey);
        
        // Add initiator if not already present
        if (!chain.approvers.find(a => a.userId === initiator.userId)) {
            chain.approvers.push({
                userId: initiator.userId,
                roles: initiator.roles,
                ts: new Date().toISOString()
            });
        }

        return chain;
    }

    /**
     * Add approval to chain
     */
    addApproval(approvalKey, approver) {
        const chain = this.chains.get(approvalKey);
        if (!chain) {
            return null;
        }

        // Check if user already approved
        if (chain.approvers.find(a => a.userId === approver.userId)) {
            return chain; // Already approved by this user
        }

        chain.approvers.push({
            userId: approver.userId,
            roles: approver.roles,
            ts: new Date().toISOString()
        });

        return chain;
    }

    /**
     * Check if chain is complete
     */
    isChainComplete(chain) {
        const { profile } = chain;
        
        switch (profile.type) {
            case 'single':
                return chain.approvers.length >= 1;
            case 'dual':
                return chain.approvers.length >= (profile.quorum || 2);
            case 'quorum':
                return chain.approvers.length >= (profile.quorum || 2);
            default:
                return false;
        }
    }

    /**
     * Check if chain is expired
     */
    isChainExpired(chain) {
        return new Date() > chain.expiresAt;
    }

    /**
     * Remove chain
     */
    removeChain(approvalKey) {
        this.chains.delete(approvalKey);
    }

    /**
     * Get all chains
     */
    getAllChains() {
        return Array.from(this.chains.values());
    }
}

/**
 * 🚦 Allowlist Validator
 */
class AllowlistValidator {
    constructor(config) {
        this.config = config;
    }

    /**
     * Validate action against allowlist
     */
    validate(action, payload, allowlists) {
        if (action === 'failover') {
            const target = payload.to;
            const allowlist = allowlists?.failover || this.config.defaults.allowlist.failover || [];
            
            if (allowlist.length > 0 && !allowlist.includes(target)) {
                return {
                    valid: false,
                    reason: 'allowlist_violation',
                    details: `Target ${target} not in allowlist`
                };
            }
        }

        return { valid: true };
    }
}

/**
 * 🎯 LIVIA-05 Action Approval Gateway Class
 */
class ActionApprovalGateway {
    constructor(config = {}) {
        this.name = 'ActionApprovalGateway';
        this.config = {
            i18n: { locale: 'tr-TR', tz: 'Europe/Istanbul' },
            defaults: {
                profiles: {
                    dual: { type: 'dual', quorum: 2, of: 2, ttlSec: 300 },
                    single: { type: 'single', ttlSec: 600, reasonMinChars: 20 },
                    quorum: { type: 'quorum', quorum: 2, of: 3, ttlSec: 600 }
                },
                allowlist: { failover: [] }
            },
            rules: {
                requireFreshBounds: ['aggressive_overrides'],
                forbidWhenSentry: { 'halt_entry': [], 'failover': [] },
                minReasonChars: 20
            },
            idempotencyTtlSec: 600,
            pendingTtlSec: 600,
            revokeOnTtlExpire: true,
            security: { verifySignature: true, requireRole: true },
            ...config
        };

        // State management
        this.state = {
            policy: null,
            sentryMode: 'normal',
            emergencyStop: { active: false, reason: '' },
            lastBoundsCheck: new Map(), // checkId -> bounds result
            idempotencyCache: new Map(), // approvalKey -> result
            stats: {
                pending: 0,
                approved: 0,
                rejected: 0,
                revoked: 0,
                byAction: new Map()
            },
            lastMetricsEmit: 0 // Metrics throttling
        };

        // Helper classes
        this.rbac = new RBACController(this.config);
        this.chainBuilder = new ApprovalChainBuilder();
        this.allowlistValidator = new AllowlistValidator(this.config);

        this.isInitialized = false;
        this.logger = null;
    }

    /**
     * 🚀 Initialize the gateway
     */
    async initialize(logger) {
        try {
            this.logger = logger;
            this.logger.info(`${this.name} başlatılıyor...`);

            this.setupEventListeners();
            this.startPeriodicProcessing();

            this.isInitialized = true;
            this.logger.info(`${this.name} başarıyla başlatıldı`);
            return true;
        } catch (error) {
            this.logger.error(`${this.name} başlatma hatası:`, error);
            return false;
        }
    }

    /**
     * 👂 Setup event listeners
     */
    setupEventListeners() {
        // Approval requests
        eventBus.subscribeToEvent('operator.decision.final', (event) => {
            this.handleOperatorDecisionFinal(event.data);
        }, 'actionApprovalGateway');

        eventBus.subscribeToEvent('manual.approval.request', (event) => {
            this.handleManualApprovalRequest(event.data);
        }, 'actionApprovalGateway');

        // State updates
        eventBus.subscribeToEvent('policy.snapshot', (event) => {
            this.handlePolicySnapshot(event.data);
        }, 'actionApprovalGateway');

        eventBus.subscribeToEvent('sentry.guard.directive', (event) => {
            this.handleSentryGuardDirective(event.data);
        }, 'actionApprovalGateway');

        eventBus.subscribeToEvent('confirmation.bounds.check', (event) => {
            this.handleConfirmationBoundsCheck(event.data);
        }, 'actionApprovalGateway');

        eventBus.subscribeToEvent('risk.incident.emergency_stop', (event) => {
            this.handleRiskIncidentEmergencyStop(event.data);
        }, 'actionApprovalGateway');
    }

    /**
     * 🎯 Handle operator decision final
     */
    async handleOperatorDecisionFinal(data) {
        try {
            const validated = OperatorDecisionFinalSchema.parse(data);
            
            if (!validated.accepted) {
                this.logger.info(`Decision rejected by operator: ${validated.promptId}`);
                return;
            }

            await this.processApprovalRequest({
                approvalKey: validated.context.approvalKey,
                action: validated.context.action,
                payload: validated.context.payload,
                requestedBy: validated.auth,
                reason: validated.rationale || 'Operator decision',
                ttlSec: validated.ttlSec
            });

        } catch (error) {
            this.logger.error('Operator decision final validation error:', error);
        }
    }

    /**
     * 📋 Handle manual approval request
     */
    async handleManualApprovalRequest(data) {
        try {
            const validated = ManualApprovalRequestSchema.parse(data);
            
            await this.processApprovalRequest({
                approvalKey: validated.approvalKey,
                action: validated.action,
                payload: validated.payload,
                requestedBy: validated.requestedBy,
                reason: validated.reason
            });

        } catch (error) {
            this.logger.error('Manual approval request validation error:', error);
        }
    }

    /**
     * ⚡ Process approval request (main logic)
     */
    async processApprovalRequest(request) {
        const { approvalKey, action, payload, requestedBy, reason, ttlSec } = request;

        // Check idempotency
        if (this.state.idempotencyCache.has(approvalKey)) {
            this.logger.info(`Skipping duplicate approval request: ${approvalKey}`);
            return;
        }

        try {
            // Validate RBAC
            const rbacResult = this.validateRBAC(requestedBy, action);
            if (!rbacResult.valid) {
                await this.rejectApproval(approvalKey, action, [rbacResult.reason], [requestedBy]);
                return;
            }

            // Get approval profile
            const profile = this.getApprovalProfile(action, ttlSec);
            if (!profile) {
                await this.rejectApproval(approvalKey, action, ['unknown_action'], [requestedBy]);
                return;
            }

            // Validate reason length
            if (profile.reasonMinChars && reason.length < profile.reasonMinChars) {
                await this.rejectApproval(approvalKey, action, ['reason_too_short'], [requestedBy]);
                return;
            }

            // Check bounds requirement
            const boundsResult = this.validateBoundsRequirement(action);
            if (!boundsResult.valid) {
                await this.rejectApproval(approvalKey, action, [boundsResult.reason], [requestedBy]);
                return;
            }

            // Check allowlist
            const allowlistResult = this.allowlistValidator.validate(action, payload, 
                this.state.policy?.allowlists);
            if (!allowlistResult.valid) {
                await this.emitApprovalAlert('error', allowlistResult.details, { approvalKey, action });
                await this.rejectApproval(approvalKey, action, [allowlistResult.reason], [requestedBy]);
                return;
            }

            // Check emergency bypass
            const bypassResult = this.checkEmergencyBypass(action, payload);
            if (bypassResult.bypass) {
                await this.approveAction(approvalKey, action, payload, [requestedBy], profile, reason, bypassResult.reason);
                await this.emitApprovalAlert('warn', 'emergency_bypass', { approvalKey, action });
                return;
            }

            // Handle approval chain
            await this.handleApprovalChain(approvalKey, action, payload, requestedBy, profile, reason);

        } catch (error) {
            this.logger.error(`Approval processing error for ${approvalKey}:`, error);
            await this.rejectApproval(approvalKey, action, ['internal_error'], [requestedBy]);
        }
    }

    /**
     * 🔐 Validate RBAC
     */
    validateRBAC(user, action) {
        if (!this.rbac.verifySignature(user)) {
            return { valid: false, reason: 'signature_invalid' };
        }

        if (!this.rbac.hasPermission(user.roles, action, this.state.policy?.roles)) {
            return { valid: false, reason: 'rbac_forbidden' };
        }

        return { valid: true };
    }

    /**
     * 📋 Get approval profile for action
     */
    getApprovalProfile(action, customTtlSec) {
        let profile = this.state.policy?.approvalProfiles?.[action];
        
        if (!profile) {
            // Use defaults based on action type
            if (action === 'halt_entry' || action === 'failover') {
                profile = { ...this.config.defaults.profiles.dual };
            } else if (action === 'aggressive_overrides') {
                profile = { ...this.config.defaults.profiles.single };
            } else if (action === 'risk_limit_change') {
                profile = { ...this.config.defaults.profiles.quorum };
            } else {
                return null;
            }
        } else {
            profile = { ...profile }; // Clone to avoid mutation
        }

        // Override TTL if custom provided
        if (customTtlSec !== undefined) {
            profile.ttlSec = customTtlSec;
        }

        return profile;
    }

    /**
     * 🎯 Validate bounds requirement
     */
    validateBoundsRequirement(action) {
        if (!this.config.rules.requireFreshBounds.includes(action)) {
            return { valid: true };
        }

        // Check if we have a recent bounds check that passed
        const recentBounds = Array.from(this.state.lastBoundsCheck.values())
            .filter(bounds => bounds.timestamp > Date.now() - 300000) // 5 minutes
            .find(bounds => bounds.ok);

        if (!recentBounds) {
            return { valid: false, reason: 'bounds_not_ok' };
        }

        return { valid: true };
    }

    /**
     * 🚨 Check emergency bypass
     */
    checkEmergencyBypass(action, payload) {
        if (this.state.emergencyStop.active && 
            action === 'halt_entry' && 
            payload.scope === 'global') {
            return { 
                bypass: true, 
                reason: `Emergency stop: ${this.state.emergencyStop.reason}` 
            };
        }

        return { bypass: false };
    }

    /**
     * ⛓️ Handle approval chain logic
     */
    async handleApprovalChain(approvalKey, action, payload, requester, profile, reason) {
        const chain = this.chainBuilder.getOrCreateChain(approvalKey, profile, requester);

        if (profile.type === 'single') {
            // Single approval is sufficient
            await this.approveAction(approvalKey, action, payload, chain.approvers, profile, reason);
        } else {
            // Multi-approval required
            if (this.chainBuilder.isChainComplete(chain)) {
                await this.approveAction(approvalKey, action, payload, chain.approvers, profile, reason);
            } else {
                await this.emitApprovalPending(approvalKey, action, chain, profile);
            }
        }
    }

    /**
     * ✅ Approve action
     */
    async approveAction(approvalKey, action, payload, approvers, profile, reason, customReason) {
        const now = new Date();
        const ttlSec = profile.ttlSec || 300;

        const approval = {
            event: 'action.approved',
            timestamp: now.toISOString(),
            approvalKey,
            action,
            payload,
            ttlSec,
            by: approvers,
            chain: {
                required: `${profile.type}(${profile.quorum || 1}/${profile.of || 1})`,
                collected: approvers.length
            },
            reason: customReason || reason,
            audit: {
                eventId: `approval-${Date.now()}`,
                producedBy: 'livia-05',
                producedAt: now.toISOString()
            }
        };

        // Cache result
        this.state.idempotencyCache.set(approvalKey, {
            result: approval,
            timestamp: now,
            ttl: this.config.idempotencyTtlSec * 1000
        });

        // Emit approval
        eventBus.publishEvent('action.approved', approval, 'actionApprovalGateway');

        // Clean up chain
        this.chainBuilder.removeChain(approvalKey);

        // Update stats
        this.state.stats.approved++;
        this.updateActionStats(action);

        this.logger.info(`Action approved: ${approvalKey} by ${approvers.length} approver(s)`);

        // Schedule revocation if enabled
        if (this.config.revokeOnTtlExpire && ttlSec > 0) {
            setTimeout(() => {
                this.revokeApproval(approvalKey, 'ttl_expired');
            }, ttlSec * 1000);
        }
    }

    /**
     * ❌ Reject approval
     */
    async rejectApproval(approvalKey, action, reasons, approvers) {
        const now = new Date();

        const rejection = {
            event: 'action.rejected',
            timestamp: now.toISOString(),
            approvalKey,
            action,
            reasons,
            by: approvers,
            audit: {
                eventId: `rejection-${Date.now()}`,
                producedBy: 'livia-05',
                producedAt: now.toISOString()
            }
        };

        // Cache result
        this.state.idempotencyCache.set(approvalKey, {
            result: rejection,
            timestamp: now,
            ttl: this.config.idempotencyTtlSec * 1000
        });

        // Emit rejection
        eventBus.publishEvent('action.rejected', rejection, 'actionApprovalGateway');

        // Clean up chain
        this.chainBuilder.removeChain(approvalKey);

        // Update stats
        this.state.stats.rejected++;
        this.updateActionStats(action);

        this.logger.info(`Action rejected: ${approvalKey} reasons: ${reasons.join(', ')}`);
    }

    /**
     * ⏳ Emit approval pending
     */
    async emitApprovalPending(approvalKey, action, chain, profile) {
        const pending = {
            event: 'approval.pending',
            timestamp: new Date().toISOString(),
            approvalKey,
            action,
            needed: {
                quorum: profile.quorum || 2,
                of: profile.of || 2
            },
            received: chain.approvers,
            expiresAt: chain.expiresAt.toISOString()
        };

        eventBus.publishEvent('approval.pending', pending, 'actionApprovalGateway');
        
        this.state.stats.pending++;
        this.logger.info(`Approval pending: ${approvalKey} ${chain.approvers.length}/${profile.quorum || 2}`);
    }

    /**
     * 🔄 Revoke approval
     */
    async revokeApproval(approvalKey, reason, rollbackEvent) {
        const revocation = {
            event: 'approval.revoked',
            timestamp: new Date().toISOString(),
            approvalKey,
            reason,
            rollback: rollbackEvent
        };

        eventBus.publishEvent('approval.revoked', revocation, 'actionApprovalGateway');
        
        // Clean up
        this.chainBuilder.removeChain(approvalKey);
        this.state.idempotencyCache.delete(approvalKey);
        
        this.state.stats.revoked++;
        this.logger.info(`Approval revoked: ${approvalKey} reason: ${reason}`);
    }

    /**
     * 🚨 Emit approval alert
     */
    async emitApprovalAlert(level, message, context = {}) {
        const alert = {
            event: 'approval.alert',
            timestamp: new Date().toISOString(),
            level,
            message,
            context
        };

        eventBus.publishEvent('approval.alert', alert, 'actionApprovalGateway');
        this.logger.info(`Approval alert: ${level} - ${message}`);
    }

    /**
     * 📊 Update action statistics
     */
    updateActionStats(action) {
        const current = this.state.stats.byAction.get(action) || 0;
        this.state.stats.byAction.set(action, current + 1);
    }

    /**
     * 📋 Handle policy snapshot
     */
    handlePolicySnapshot(data) {
        try {
            const validated = PolicySnapshotSchema.parse(data);
            this.state.policy = validated;
            this.logger.info(`Policy snapshot updated`);
        } catch (error) {
            this.logger.error('Policy snapshot validation error:', error);
        }
    }

    /**
     * 🛡️ Handle sentry guard directive
     */
    handleSentryGuardDirective(data) {
        try {
            const validated = SentryGuardDirectiveSchema.parse(data);
            this.state.sentryMode = validated.mode;
            this.logger.info(`Sentry mode updated: ${validated.mode}`);
        } catch (error) {
            this.logger.error('Sentry guard directive validation error:', error);
        }
    }

    /**
     * ✅ Handle confirmation bounds check
     */
    handleConfirmationBoundsCheck(data) {
        try {
            const validated = ConfirmationBoundsCheckSchema.parse(data);
            this.state.lastBoundsCheck.set(validated.checkId, {
                ...validated,
                timestamp: Date.now()
            });
            this.logger.info(`Bounds check result: ${validated.checkId} ok=${validated.ok}`);
        } catch (error) {
            this.logger.error('Confirmation bounds check validation error:', error);
        }
    }

    /**
     * 🚨 Handle risk incident emergency stop
     */
    handleRiskIncidentEmergencyStop(data) {
        try {
            const validated = RiskIncidentEmergencyStopSchema.parse(data);
            this.state.emergencyStop = {
                active: validated.active,
                reason: validated.reason
            };
            this.logger.info(`Emergency stop: ${validated.active} - ${validated.reason}`);
        } catch (error) {
            this.logger.error('Risk incident emergency stop validation error:', error);
        }
    }

    /**
     * ⏱️ Start periodic processing
     */
    startPeriodicProcessing() {
        // Check for expired chains every 60 seconds instead of 30
        this.periodicInterval = setInterval(() => {
            this.checkExpiredChains();
            this.cleanupIdempotencyCache();
            this.emitMetrics();
        }, 60000); // Reduced frequency
    }

    /**
     * ⏰ Check for expired approval chains
     */
    checkExpiredChains() {
        const now = new Date();
        const chains = this.chainBuilder.getAllChains();

        for (const chain of chains) {
            if (this.chainBuilder.isChainExpired(chain)) {
                this.rejectApproval(
                    chain.approvalKey, 
                    'unknown', 
                    ['insufficient_quorum'], 
                    chain.approvers
                );
            }
        }
    }

    /**
     * 🧹 Clean up idempotency cache
     */
    cleanupIdempotencyCache() {
        const now = Date.now();
        for (const [key, entry] of this.state.idempotencyCache.entries()) {
            if (now - entry.timestamp.getTime() > entry.ttl) {
                this.state.idempotencyCache.delete(key);
            }
        }
    }

    /**
     * 📊 Emit metrics
     */
    emitMetrics() {
        const now = Date.now();
        
        // Throttle metrics to once per minute maximum
        if (now - this.state.lastMetricsEmit < 60000) {
            return;
        }
        
        this.state.lastMetricsEmit = now;
        
        const byAction = {};
        for (const [action, count] of this.state.stats.byAction.entries()) {
            byAction[action] = count;
        }

        const metrics = {
            event: 'approval.metrics',
            timestamp: new Date().toISOString(),
            pending: this.chainBuilder.getAllChains().length,
            approved: this.state.stats.approved,
            rejected: this.state.stats.rejected,
            revoked: this.state.stats.revoked,
            avgLeadTimeSec: 42, // TODO: Calculate actual average
            byAction
        };

        eventBus.publishEvent('approval.metrics', metrics, 'actionApprovalGateway');
    }

    /**
     * 📊 Get system status
     */
    getStatus() {
        return {
            name: this.name,
            initialized: this.isInitialized,
            policy: !!this.state.policy,
            sentryMode: this.state.sentryMode,
            emergencyStop: this.state.emergencyStop,
            stats: { ...this.state.stats },
            chains: this.chainBuilder.getAllChains().length,
            idempotencyCache: this.state.idempotencyCache.size,
            boundsChecks: this.state.lastBoundsCheck.size
        };
    }

    /**
     * 🛑 Shutdown
     */
    async shutdown() {
        try {
            this.logger.info(`${this.name} kapatılıyor...`);
            
            // Stop periodic processing
            if (this.periodicInterval) {
                clearInterval(this.periodicInterval);
                this.periodicInterval = null;
            }
            
            // Clear state
            this.state.idempotencyCache.clear();
            this.state.lastBoundsCheck.clear();
            this.state.stats.byAction.clear();
            
            this.isInitialized = false;
            this.logger.info(`${this.name} başarıyla kapatıldı`);
        } catch (error) {
            this.logger.error(`${this.name} kapatma hatası:`, error);
        }
    }
}

module.exports = {
    ActionApprovalGateway,
    actionApprovalGateway: new ActionApprovalGateway(),
    RBACController,
    ApprovalChainBuilder,
    AllowlistValidator
};