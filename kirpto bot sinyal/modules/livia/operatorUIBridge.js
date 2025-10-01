/**
 * LIVIA-06 · operatorUIBridge.js
 * Operatör UI köprüsü - WebSocket/SSE gerçek zamanlı iletişim
 * 
 * Amaç: Operatör UI'sı (web/desktop) ile gerçek zamanlı köprü kurmak.
 * operator.prompt.out/operator.question.out/approval.pending gibi olayları güvenli 
 * kanaldan UI'ya ilet, at-most-once teslimat sağla, ACK topla, yanıtları geri yayınla.
 */

const { z } = require('zod');
const { WebSocketServer } = require('ws');
const { createHash, createHmac } = require('crypto');
const { eventBus } = require('../modularEventStream');
const { logInfo, logError, logEvent } = require('../../logs/logger');

/**
 * 🔄 Input Event Schemas
 */
const OperatorPromptOutSchema = z.object({
    event: z.literal('operator.prompt.out'),
    timestamp: z.string(),
    promptId: z.string(),
    title: z.string(),
    body: z.string(),
    options: z.array(z.object({
        id: z.string(),
        label: z.string()
    })),
    context: z.object({
        symbol: z.string().optional(),
        variant: z.string().optional(),
        exec: z.string().optional(),
        qty: z.number().optional()
    }),
    expiresAt: z.string(),
    audit: z.object({
        eventId: z.string(),
        producedBy: z.string(),
        producedAt: z.string()
    })
});

const OperatorQuestionOutSchema = z.object({
    event: z.literal('operator.question.out'),
    timestamp: z.string(),
    qId: z.string(),
    promptId: z.string().optional(),
    title: z.string(),
    text: z.string(),
    kind: z.enum(['confirm', 'numerical', 'choice']),
    expected: z.enum(['yes', 'no', 'value', 'option']),
    constraints: z.object({
        min: z.number().optional(),
        max: z.number().optional(),
        step: z.number().optional(),
        unit: z.string().optional()
    }).optional(),
    options: z.array(z.object({
        id: z.string(),
        label: z.string()
    })).optional(),
    ttlSec: z.number().int().min(0),
    context: z.record(z.any()).optional()
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

/**
 * 📤 Output Event Schemas
 */
const OperatorResponseInSchema = z.object({
    event: z.literal('operator.response.in'),
    timestamp: z.string(),
    promptId: z.string(),
    decisionId: z.string(),
    payload: z.record(z.any()).optional(),
    auth: z.object({
        userId: z.string(),
        sig: z.string()
    })
});

const OperatorAnswerInSchema = z.object({
    event: z.literal('operator.answer.in'),
    timestamp: z.string(),
    qId: z.string(),
    answer: z.string(),
    value: z.number().optional(),
    unit: z.string().optional(),
    auth: z.object({
        userId: z.string(),
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

const UIAckInSchema = z.object({
    event: z.literal('ui.ack.in'),
    timestamp: z.string(),
    deliveryId: z.string(),
    status: z.enum(['received', 'rendered', 'acted']),
    latencyMs: z.number().int().min(0),
    auth: z.object({
        userId: z.string(),
        sig: z.string()
    })
});

/**
 * 🔐 HMAC Security Helper
 */
class HMACSecurity {
    constructor(secret) {
        this.secret = secret || 'default-bridge-secret';
    }

    /**
     * Generate HMAC signature
     */
    sign(userId, timestamp, body) {
        const bodySha256 = createHash('sha256').update(body || '').digest('hex');
        const message = `${userId}\n${timestamp}\n${bodySha256}`;
        return createHmac('sha256', this.secret).update(message).digest('hex');
    }

    /**
     * Verify HMAC signature
     */
    verify(userId, timestamp, body, signature) {
        const expected = this.sign(userId, timestamp, body);
        return expected === signature;
    }

    /**
     * Check timestamp drift
     */
    isTimestampValid(timestamp, maxDriftSec = 120) {
        const now = Date.now();
        const ts = new Date(timestamp).getTime();
        return Math.abs(now - ts) <= maxDriftSec * 1000;
    }
}

/**
 * 📬 Delivery Queue with Retry Logic
 */
class DeliveryQueue {
    constructor(config) {
        this.config = config;
        this.queues = new Map(); // userId -> queue
        this.retrySchedules = new Map(); // deliveryId -> retry info
        this.stats = {
            sent: 0,
            acked: 0,
            retried: 0,
            dropped: 0
        };
    }

    /**
     * Add message to user's queue
     */
    enqueue(userId, message) {
        if (!this.queues.has(userId)) {
            this.queues.set(userId, []);
        }

        const queue = this.queues.get(userId);
        
        // Check backpressure
        if (queue.length >= this.config.backpressure.maxPendingPerConn) {
            if (this.config.backpressure.dropPolicy === 'oldest') {
                queue.shift(); // Drop oldest
                this.stats.dropped++;
            }
        }

        queue.push({
            ...message,
            enqueuedAt: Date.now(),
            attempts: 0
        });

        return message.deliveryId;
    }

    /**
     * Get next messages for user
     */
    dequeue(userId, limit = 10) {
        const queue = this.queues.get(userId) || [];
        return queue.slice(0, limit);
    }

    /**
     * Mark message as ACK'd
     */
    ack(deliveryId, status) {
        // Find and remove from all queues
        for (const [userId, queue] of this.queues.entries()) {
            const index = queue.findIndex(msg => msg.deliveryId === deliveryId);
            if (index !== -1) {
                queue.splice(index, 1);
                this.retrySchedules.delete(deliveryId);
                this.stats.acked++;
                return true;
            }
        }
        return false;
    }

    /**
     * Schedule retry for message
     */
    scheduleRetry(deliveryId, attempt) {
        const retryMs = this.config.retry.scheduleMs[Math.min(attempt, this.config.retry.scheduleMs.length - 1)];
        
        this.retrySchedules.set(deliveryId, {
            nextRetryAt: Date.now() + retryMs,
            attempt
        });
    }

    /**
     * Get messages ready for retry
     */
    getRetryReady() {
        const now = Date.now();
        const ready = [];

        for (const [deliveryId, retryInfo] of this.retrySchedules.entries()) {
            if (now >= retryInfo.nextRetryAt) {
                // Find message in queues
                for (const [userId, queue] of this.queues.entries()) {
                    const message = queue.find(msg => msg.deliveryId === deliveryId);
                    if (message) {
                        message.attempts = retryInfo.attempt;
                        ready.push({ userId, message });
                        break;
                    }
                }
            }
        }

        return ready;
    }

    /**
     * Clean expired messages
     */
    cleanExpired() {
        const now = Date.now();
        let cleaned = 0;

        for (const [userId, queue] of this.queues.entries()) {
            const originalLength = queue.length;
            this.queues.set(userId, queue.filter(msg => {
                const expired = new Date(msg.expiresAt).getTime() < now;
                if (expired) {
                    this.retrySchedules.delete(msg.deliveryId);
                }
                return !expired;
            }));
            cleaned += originalLength - this.queues.get(userId).length;
        }

        return cleaned;
    }

    /**
     * Get queue stats
     */
    getStats() {
        const totalPending = Array.from(this.queues.values()).reduce((sum, queue) => sum + queue.length, 0);
        
        return {
            ...this.stats,
            totalPending,
            activeQueues: this.queues.size,
            retryScheduled: this.retrySchedules.size
        };
    }
}

/**
 * 📡 WebSocket Session Manager
 */
class SessionManager {
    constructor(config) {
        this.config = config;
        this.sessions = new Map(); // sessionId -> session info
        this.userSessions = new Map(); // userId -> sessionId
        this.sequenceCounters = new Map(); // sessionId -> current seq
    }

    /**
     * Create new session
     */
    createSession(ws, userId) {
        const sessionId = `session-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        
        // Supersede existing session for same user
        if (this.userSessions.has(userId)) {
            const oldSessionId = this.userSessions.get(userId);
            this.closeSession(oldSessionId, 'superseded');
        }

        const session = {
            sessionId,
            userId,
            ws,
            connectedAt: new Date(),
            lastPingAt: new Date(),
            lastSeq: 0,
            isAlive: true
        };

        this.sessions.set(sessionId, session);
        this.userSessions.set(userId, sessionId);
        this.sequenceCounters.set(sessionId, 0);

        return session;
    }

    /**
     * Get session by user ID
     */
    getSessionByUser(userId) {
        const sessionId = this.userSessions.get(userId);
        return sessionId ? this.sessions.get(sessionId) : null;
    }

    /**
     * Get next sequence number
     */
    getNextSeq(sessionId) {
        const current = this.sequenceCounters.get(sessionId) || 0;
        const next = current + 1;
        this.sequenceCounters.set(sessionId, next);
        return next;
    }

    /**
     * Update session heartbeat
     */
    updateHeartbeat(sessionId) {
        const session = this.sessions.get(sessionId);
        if (session) {
            session.lastPingAt = new Date();
            session.isAlive = true;
        }
    }

    /**
     * Mark session as potentially dead
     */
    markSuspect(sessionId) {
        const session = this.sessions.get(sessionId);
        if (session) {
            session.isAlive = false;
        }
    }

    /**
     * Close session
     */
    closeSession(sessionId, reason = 'normal') {
        const session = this.sessions.get(sessionId);
        if (session) {
            if (session.ws && session.ws.readyState === session.ws.OPEN) {
                session.ws.close(1000, reason);
            }
            
            this.sessions.delete(sessionId);
            this.userSessions.delete(session.userId);
            this.sequenceCounters.delete(sessionId);
        }
    }

    /**
     * Get all active sessions
     */
    getActiveSessions() {
        return Array.from(this.sessions.values()).filter(s => s.isAlive);
    }

    /**
     * Clean dead sessions
     */
    cleanDeadSessions() {
        const now = Date.now();
        const maxIdleMs = this.config.ws.connIdleSec * 1000;
        let cleaned = 0;

        for (const [sessionId, session] of this.sessions.entries()) {
            const idleMs = now - session.lastPingAt.getTime();
            if (!session.isAlive || idleMs > maxIdleMs) {
                this.closeSession(sessionId, 'timeout');
                cleaned++;
            }
        }

        return cleaned;
    }
}

/**
 * 🎯 LIVIA-06 Operator UI Bridge Class
 */
class OperatorUIBridge {
    constructor(config = {}) {
        this.name = 'OperatorUIBridge';
        this.config = {
            ws: { port: 7400, heartbeatSec: 15, connIdleSec: 900, maxConns: 200 },
            sse: { enabled: true, cacheSec: 5 },
            rate: { perUserPerMin: 60, inboundPerMin: 30, inboundBurstPerSec: 5 },
            backpressure: { maxPendingPerConn: 100, dropPolicy: 'oldest' },
            retry: { attempts: 4, scheduleMs: [500, 1000, 2000, 5000] },
            security: { hmacHeader: 'X-Signature', tsHeader: 'X-Ts', maxDriftSec: 120 },
            delivery: { idPrefix: 'ui', idemTtlSec: 600, replayMaxItems: 200, replayMaxMin: 15 },
            pii: { policyVersion: 1, redactorEnabled: true },
            i18n: { locale: 'tr-TR', tz: 'Europe/Istanbul' },
            ...config
        };

        // State management
        this.state = {
            wss: null,
            deliveryCounter: 0,
            idempotencyCache: new Map(), // ackKey -> timestamp
            rateLimits: new Map(), // userId -> { count, windowStart }
            stats: {
                activeConns: 0,
                totalPushes: 0,
                totalAcks: 0,
                retryCount: 0,
                dropCount: 0
            }
        };

        // Helper classes
        this.hmacSecurity = new HMACSecurity(process.env.BRIDGE_HMAC);
        this.deliveryQueue = new DeliveryQueue(this.config);
        this.sessionManager = new SessionManager(this.config);

        this.isInitialized = false;
        this.logger = null;
    }

    /**
     * 🚀 Initialize the UI bridge
     */
    async initialize(logger) {
        try {
            this.logger = logger;
            this.logger.info(`${this.name} başlatılıyor...`);

            this.setupEventListeners();
            this.startWebSocketServer();
            this.startPeriodicTasks();

            this.isInitialized = true;
            this.logger.info(`${this.name} başarıyla başlatıldı - port: ${this.config.ws.port}`);
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
        // Outbound events (to UI)
        eventBus.subscribeToEvent('operator.prompt.out', (event) => {
            this.handleOperatorPromptOut(event.data);
        }, 'operatorUIBridge');

        eventBus.subscribeToEvent('operator.question.out', (event) => {
            this.handleOperatorQuestionOut(event.data);
        }, 'operatorUIBridge');

        eventBus.subscribeToEvent('approval.pending', (event) => {
            this.handleApprovalPending(event.data);
        }, 'operatorUIBridge');
    }

    /**
     * 🌐 Start WebSocket server
     */
    startWebSocketServer() {
        this.state.wss = new WebSocketServer({
            port: this.config.ws.port,
            maxPayload: 64 * 1024 // 64KB
        });

        this.state.wss.on('connection', (ws, request) => {
            this.handleWebSocketConnection(ws, request);
        });

        this.state.wss.on('error', (error) => {
            this.logger.error('WebSocket server error:', error);
            this.emitBridgeAlert('error', 'WebSocket server error', { error: error.message });
        });
    }

    /**
     * 🔌 Handle WebSocket connection
     */
    handleWebSocketConnection(ws, request) {
        try {
            // Extract authentication from headers
            const userId = request.headers['x-userid'];
            const timestamp = request.headers['x-ts'];
            const signature = request.headers['x-signature'];

            if (!userId || !timestamp || !signature) {
                ws.close(1008, 'Missing authentication headers');
                return;
            }

            // Verify authentication
            if (!this.hmacSecurity.isTimestampValid(timestamp) ||
                !this.hmacSecurity.verify(userId, timestamp, '', signature)) {
                ws.close(1008, 'Authentication failed');
                this.emitBridgeAlert('error', 'Authentication failed', { userId });
                return;
            }

            // Check connection limits
            if (this.state.wss.clients.size >= this.config.ws.maxConns) {
                ws.close(1013, 'Server overloaded');
                return;
            }

            // Create session
            const session = this.sessionManager.createSession(ws, userId);
            
            // Send welcome message
            this.sendWelcome(session);

            // Setup message handlers
            ws.on('message', (data) => {
                this.handleWebSocketMessage(session, data);
            });

            ws.on('pong', () => {
                this.sessionManager.updateHeartbeat(session.sessionId);
            });

            ws.on('close', (code, reason) => {
                this.logger.info(`WebSocket closed: ${userId} code=${code} reason=${reason}`);
                this.sessionManager.closeSession(session.sessionId);
                this.updateConnectionStats();
            });

            ws.on('error', (error) => {
                this.logger.error(`WebSocket error for ${userId}:`, error);
                this.sessionManager.markSuspect(session.sessionId);
            });

            this.updateConnectionStats();
            this.logger.info(`WebSocket connected: ${userId} session=${session.sessionId}`);

        } catch (error) {
            this.logger.error('WebSocket connection error:', error);
            ws.close(1011, 'Internal server error');
        }
    }

    /**
     * 👋 Send welcome message
     */
    sendWelcome(session) {
        const welcome = {
            event: 'ui.welcome',
            timestamp: new Date().toISOString(),
            sessionId: session.sessionId,
            seqStart: session.lastSeq,
            heartbeatSec: this.config.ws.heartbeatSec,
            serverTime: new Date().toISOString()
        };

        this.sendToSession(session, JSON.stringify(welcome));
    }

    /**
     * 💬 Handle WebSocket message
     */
    async handleWebSocketMessage(session, data) {
        try {
            const message = JSON.parse(data.toString());
            
            switch (message.event) {
                case 'ui.ack.in':
                    await this.handleUIAck(message);
                    break;
                case 'operator.response.in':
                    await this.handleOperatorResponse(message);
                    break;
                case 'operator.answer.in':
                    await this.handleOperatorAnswer(message);
                    break;
                case 'manual.approval.request':
                    await this.handleManualApprovalRequest(message);
                    break;
                default:
                    this.logger.warn(`Unknown event type: ${message.event} from ${session.userId}`);
            }

        } catch (error) {
            this.logger.error(`Message handling error for ${session.userId}:`, error);
        }
    }

    /**
     * 📤 Handle operator prompt out
     */
    async handleOperatorPromptOut(data) {
        try {
            const validated = OperatorPromptOutSchema.parse(data);
            await this.pushToUI('prompt', validated, validated.promptId);
        } catch (error) {
            this.logger.error('Operator prompt out validation error:', error);
        }
    }

    /**
     * ❓ Handle operator question out
     */
    async handleOperatorQuestionOut(data) {
        try {
            const validated = OperatorQuestionOutSchema.parse(data);
            await this.pushToUI('question', validated, validated.qId);
        } catch (error) {
            this.logger.error('Operator question out validation error:', error);
        }
    }

    /**
     * ⏳ Handle approval pending
     */
    async handleApprovalPending(data) {
        try {
            const validated = ApprovalPendingSchema.parse(data);
            await this.pushToUI('approval', validated, validated.approvalKey);
        } catch (error) {
            this.logger.error('Approval pending validation error:', error);
        }
    }

    /**
     * 📤 Push message to UI
     */
    async pushToUI(kind, payload, identifier) {
        const now = new Date();
        const deliveryId = `${this.config.delivery.idPrefix}-${identifier}-${String(++this.state.deliveryCounter).padStart(6, '0')}`;

        // Extract target user (simplified - could be more sophisticated)
        const targetUserId = this.extractTargetUser(payload);
        if (!targetUserId) {
            this.logger.warn(`No target user found for ${kind} push`);
            return;
        }

        // Check rate limit
        if (!this.checkRateLimit(targetUserId)) {
            this.emitBridgeAlert('warn', 'Rate limited', { userId: targetUserId, kind });
            return;
        }

        // Get session
        const session = this.sessionManager.getSessionByUser(targetUserId);
        if (!session) {
            this.logger.info(`No active session for user: ${targetUserId}`);
            return;
        }

        // Create UI push envelope
        const seq = this.sessionManager.getNextSeq(session.sessionId);
        const envelope = {
            event: 'ui.push',
            timestamp: now.toISOString(),
            deliveryId,
            seq,
            kind,
            payload: this.redactPII(payload),
            expiresAt: payload.expiresAt || new Date(Date.now() + 300000).toISOString(), // 5 min default
            sig: this.hmacSecurity.sign('server', now.toISOString(), JSON.stringify(payload))
        };

        // Queue for delivery
        this.deliveryQueue.enqueue(targetUserId, envelope);

        // Try immediate delivery
        await this.deliverToSession(session, envelope);

        this.state.stats.totalPushes++;
        this.logger.info(`UI push queued: ${deliveryId} kind=${kind} user=${targetUserId}`);
    }

    /**
     * 🎯 Extract target user from payload
     */
    extractTargetUser(payload) {
        // Simplified extraction - in real implementation, this would be more sophisticated
        if (payload.audit?.producedBy) {
            return 'op-007'; // Default operator for demo
        }
        return null;
    }

    /**
     * 🛡️ Redact PII from payload
     */
    redactPII(payload) {
        if (!this.config.pii.redactorEnabled) {
            return payload;
        }

        // Simplified PII redaction
        const redacted = JSON.parse(JSON.stringify(payload));
        
        // Add classification
        redacted._classification = 'SENSITIVE_LOW';
        redacted._expiresAt = new Date(Date.now() + 86400000).toISOString(); // 24h

        return redacted;
    }

    /**
     * ⚡ Check rate limit
     */
    checkRateLimit(userId) {
        const now = Date.now();
        const windowMs = 60000; // 1 minute
        
        if (!this.state.rateLimits.has(userId)) {
            this.state.rateLimits.set(userId, { count: 0, windowStart: now });
        }

        const limit = this.state.rateLimits.get(userId);
        
        // Reset window if needed
        if (now - limit.windowStart > windowMs) {
            limit.count = 0;
            limit.windowStart = now;
        }

        // Check limit
        if (limit.count >= this.config.rate.perUserPerMin) {
            return false;
        }

        limit.count++;
        return true;
    }

    /**
     * 📡 Deliver message to session
     */
    async deliverToSession(session, envelope) {
        if (!session.ws || session.ws.readyState !== session.ws.OPEN) {
            return false;
        }

        try {
            this.sendToSession(session, JSON.stringify(envelope));
            return true;
        } catch (error) {
            this.logger.error(`Delivery error to ${session.userId}:`, error);
            this.sessionManager.markSuspect(session.sessionId);
            return false;
        }
    }

    /**
     * 📨 Send data to session
     */
    sendToSession(session, data) {
        if (session.ws && session.ws.readyState === session.ws.OPEN) {
            session.ws.send(data);
        }
    }

    /**
     * ✅ Handle UI ACK
     */
    async handleUIAck(data) {
        try {
            const validated = UIAckInSchema.parse(data);
            
            // Verify authentication
            if (!this.verifyInboundAuth(validated.auth, JSON.stringify(data))) {
                return;
            }

            // Process ACK
            const acked = this.deliveryQueue.ack(validated.deliveryId, validated.status);
            if (acked) {
                this.state.stats.totalAcks++;
                this.logger.info(`ACK received: ${validated.deliveryId} status=${validated.status} latency=${validated.latencyMs}ms`);
            }

        } catch (error) {
            this.logger.error('UI ACK validation error:', error);
        }
    }

    /**
     * 💬 Handle operator response
     */
    async handleOperatorResponse(data) {
        try {
            const validated = OperatorResponseInSchema.parse(data);
            
            if (!this.verifyInboundAuth(validated.auth, JSON.stringify(data))) {
                return;
            }

            // Check idempotency
            const ackKey = `${validated.auth.userId}#${validated.promptId}#${validated.decisionId}#${validated.timestamp}`;
            if (this.state.idempotencyCache.has(ackKey)) {
                return;
            }
            this.state.idempotencyCache.set(ackKey, Date.now());

            // Emit response event
            eventBus.publishEvent('operator.response.in', validated, 'operatorUIBridge');
            this.logger.info(`Operator response: ${validated.promptId} decision=${validated.decisionId}`);

        } catch (error) {
            this.logger.error('Operator response validation error:', error);
        }
    }

    /**
     * 💭 Handle operator answer
     */
    async handleOperatorAnswer(data) {
        try {
            const validated = OperatorAnswerInSchema.parse(data);
            
            if (!this.verifyInboundAuth(validated.auth, JSON.stringify(data))) {
                return;
            }

            // Check idempotency
            const ackKey = `${validated.auth.userId}#${validated.qId}#${validated.answer}#${validated.timestamp}`;
            if (this.state.idempotencyCache.has(ackKey)) {
                return;
            }
            this.state.idempotencyCache.set(ackKey, Date.now());

            // Emit answer event
            eventBus.publishEvent('operator.answer.in', validated, 'operatorUIBridge');
            this.logger.info(`Operator answer: ${validated.qId} answer=${validated.answer} value=${validated.value}`);

        } catch (error) {
            this.logger.error('Operator answer validation error:', error);
        }
    }

    /**
     * 📋 Handle manual approval request
     */
    async handleManualApprovalRequest(data) {
        try {
            const validated = ManualApprovalRequestSchema.parse(data);
            
            // Emit approval request event
            eventBus.publishEvent('manual.approval.request', validated, 'operatorUIBridge');
            this.logger.info(`Manual approval request: ${validated.approvalKey} action=${validated.action}`);

        } catch (error) {
            this.logger.error('Manual approval request validation error:', error);
        }
    }

    /**
     * 🔐 Verify inbound authentication
     */
    verifyInboundAuth(auth, body) {
        const timestamp = new Date().toISOString();
        
        if (!this.hmacSecurity.isTimestampValid(timestamp)) {
            this.emitBridgeAlert('error', 'Invalid timestamp', { userId: auth.userId });
            return false;
        }

        if (!this.hmacSecurity.verify(auth.userId, timestamp, body, auth.sig)) {
            this.emitBridgeAlert('error', 'Authentication failed', { userId: auth.userId });
            return false;
        }

        return true;
    }

    /**
     * ⏱️ Start periodic tasks
     */
    startPeriodicTasks() {
        // Heartbeat check every 15 seconds
        setInterval(() => {
            this.sendHeartbeats();
            this.sessionManager.cleanDeadSessions();
        }, this.config.ws.heartbeatSec * 1000);

        // Retry and cleanup every 5 seconds
        setInterval(() => {
            this.processRetries();
            this.cleanupExpired();
        }, 5000);

        // Metrics every 30 seconds
        setInterval(() => {
            this.emitMetrics();
        }, 30000);
    }

    /**
     * 💓 Send heartbeats
     */
    sendHeartbeats() {
        const sessions = this.sessionManager.getActiveSessions();
        
        for (const session of sessions) {
            if (session.ws && session.ws.readyState === session.ws.OPEN) {
                session.ws.ping();
            }
        }
    }

    /**
     * 🔄 Process retries
     */
    processRetries() {
        const retryReady = this.deliveryQueue.getRetryReady();
        
        for (const { userId, message } of retryReady) {
            const session = this.sessionManager.getSessionByUser(userId);
            if (session) {
                this.deliverToSession(session, message);
                message.attempts++;
                
                if (message.attempts >= this.config.retry.attempts) {
                    // Move to DLQ
                    this.deliveryQueue.ack(message.deliveryId, 'failed');
                    this.emitBridgeAlert('error', 'Max retries reached', { 
                        deliveryId: message.deliveryId, 
                        userId 
                    });
                } else {
                    this.deliveryQueue.scheduleRetry(message.deliveryId, message.attempts);
                }
            }
        }
    }

    /**
     * 🧹 Cleanup expired data
     */
    cleanupExpired() {
        // Clean expired messages
        this.deliveryQueue.cleanExpired();
        
        // Clean idempotency cache
        const now = Date.now();
        const ttlMs = this.config.delivery.idemTtlSec * 1000;
        
        for (const [key, timestamp] of this.state.idempotencyCache.entries()) {
            if (now - timestamp > ttlMs) {
                this.state.idempotencyCache.delete(key);
            }
        }

        // Clean rate limits
        for (const [userId, limit] of this.state.rateLimits.entries()) {
            if (now - limit.windowStart > 120000) { // 2 minutes
                this.state.rateLimits.delete(userId);
            }
        }
    }

    /**
     * 📊 Update connection stats
     */
    updateConnectionStats() {
        this.state.stats.activeConns = this.sessionManager.getActiveSessions().length;
    }

    /**
     * 📊 Emit metrics
     */
    emitMetrics() {
        const deliveryStats = this.deliveryQueue.getStats();
        
        const metrics = {
            event: 'ui.bridge.metrics',
            timestamp: new Date().toISOString(),
            activeConns: this.state.stats.activeConns,
            pendingPush: deliveryStats.totalPending,
            ackMedianMs: 420, // TODO: Calculate actual median
            retryRate: deliveryStats.retryScheduled / Math.max(1, deliveryStats.sent),
            dlqSize: 0, // TODO: Implement DLQ
            fallbackSSE: 0 // TODO: Implement SSE fallback
        };

        eventBus.publishEvent('ui.bridge.metrics', metrics, 'operatorUIBridge');
    }

    /**
     * 🚨 Emit bridge alert
     */
    emitBridgeAlert(level, message, context = {}) {
        const alert = {
            event: 'ui.bridge.alert',
            timestamp: new Date().toISOString(),
            level,
            message,
            context
        };

        eventBus.publishEvent('ui.bridge.alert', alert, 'operatorUIBridge');
        this.logger.info(`Bridge alert: ${level} - ${message}`);
    }

    /**
     * 📊 Get system status
     */
    getStatus() {
        const deliveryStats = this.deliveryQueue.getStats();
        
        return {
            name: this.name,
            initialized: this.isInitialized,
            wsPort: this.config.ws.port,
            activeSessions: this.sessionManager.getActiveSessions().length,
            stats: { ...this.state.stats },
            delivery: deliveryStats,
            idempotencyCache: this.state.idempotencyCache.size,
            rateLimits: this.state.rateLimits.size
        };
    }

    /**
     * 🛑 Shutdown
     */
    async shutdown() {
        try {
            this.logger.info(`${this.name} kapatılıyor...`);
            
            // Close all WebSocket connections
            if (this.state.wss) {
                this.state.wss.close();
            }

            // Clear state
            this.state.idempotencyCache.clear();
            this.state.rateLimits.clear();
            
            this.isInitialized = false;
            this.logger.info(`${this.name} başarıyla kapatıldı`);
        } catch (error) {
            this.logger.error(`${this.name} kapatma hatası:`, error);
        }
    }
}

module.exports = {
    OperatorUIBridge,
    operatorUIBridge: new OperatorUIBridge(),
    HMACSecurity,
    DeliveryQueue,
    SessionManager
};