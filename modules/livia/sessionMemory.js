/**
 * LIVIA-09 · sessionMemory.js
 * Seans hafızası - Kısa-vade karar slotlarını güvenli şekilde tutma ve yönetme
 * 
 * Amaç: Diyalogda geçen karar slotlarını (sembol, varyant, exec tercihi, slip toleransı vb.) 
 * güvenli biçimde tutmak, güncellemek, TTL ile uçurmak ve sorgulanınca geri vermek.
 * Kapsamlar: operatorId → (global | symbol | promptId)
 */

const { z } = require('zod');
const { createHash } = require('crypto');
const { eventBus } = require('../../kirpto bot sinyal/modules/modularEventStream');
const { logInfo, logError, logEvent } = require('../../kirpto bot sinyal/logs/logger');

/**
 * 🔄 Slot Model Schema
 */
const SlotsSchema = z.object({
    symbol: z.string().optional(),
    variant: z.enum(['base', 'aggressive', 'conservative']).optional(),
    execPref: z.enum(['market', 'limit', 'twap', 'iceberg', 'post_only']).optional(),
    slipTolBps: z.number().min(0).max(50).optional(),
    spreadTolBps: z.number().min(0).max(200).optional(),
    qtyPref: z.number().positive().optional(),
    qtyFactor: z.number().min(0.25).max(1.5).optional(),
    rrMin: z.number().min(1.0).max(5.0).optional(),
    slices: z.number().int().min(1).max(12).optional(),
    notes: z.string().max(240).optional()
});

/**
 * 🔄 Input Event Schemas
 */
const OperatorDecisionContextSchema = z.object({
    event: z.literal('operator.decision.context'),
    timestamp: z.string(),
    promptId: z.string(),
    symbol: z.string(),
    variant: z.string(),
    exec: z.string(),
    qty: z.number(),
    slBps: z.number().optional(),
    tpBps: z.number().optional()
});

const OperatorResponseInSchema = z.object({
    event: z.literal('operator.response.in'),
    timestamp: z.string(),
    promptId: z.string(),
    decisionId: z.string(),
    payload: z.object({
        note: z.string().optional(),
        exec: z.string().optional(),
        qtyFactor: z.number().optional()
    }),
    auth: z.object({
        userId: z.string(),
        roles: z.array(z.string()),
        sig: z.string()
    })
});

const OperatorAnswerInSchema = z.object({
    event: z.literal('operator.answer.in'),
    timestamp: z.string(),
    qId: z.string(),
    answer: z.string(),
    value: z.number().optional(),
    unit: z.string().nullable().optional(),
    auth: z.object({
        userId: z.string(),
        sig: z.string()
    })
});

const GuardQuestionResultSchema = z.object({
    event: z.literal('guard.question.result'),
    timestamp: z.string(),
    promptId: z.string(),
    recommendation: z.object({
        action: z.enum(['proceed', 'revise', 'block']),
        params: z.object({
            exec: z.string().optional(),
            qtyFactor: z.number().optional(),
            slices: z.number().optional()
        }).optional()
    }).optional()
});

const ConfirmationBoundsCheckSchema = z.object({
    event: z.literal('confirmation.bounds.check'),
    timestamp: z.string(),
    checkId: z.string(),
    symbol: z.string(),
    ok: z.boolean(),
    derived: z.object({
        rr: z.number().optional()
    }).optional()
});

const SessionMemoryUpsertSchema = z.object({
    event: z.literal('session.memory.upsert'),
    timestamp: z.string(),
    scope: z.enum(['global', 'symbol', 'dialog']),
    promptId: z.string().optional(),
    symbol: z.string().optional(),
    slots: SlotsSchema,
    auth: z.object({
        userId: z.string(),
        sig: z.string()
    })
});

const SessionMemoryGetSchema = z.object({
    event: z.literal('session.memory.get'),
    timestamp: z.string(),
    scope: z.enum(['auto', 'global', 'symbol', 'dialog']),
    promptId: z.string().optional(),
    symbol: z.string().optional(),
    keys: z.array(z.string()).optional(),
    auth: z.object({
        userId: z.string(),
        sig: z.string()
    })
});

const SessionMemoryClearSchema = z.object({
    event: z.literal('session.memory.clear'),
    timestamp: z.string(),
    scope: z.enum(['dialog', 'symbol', 'global']),
    promptId: z.string().optional(),
    symbol: z.string().optional(),
    keys: z.array(z.string()).optional(),
    auth: z.object({
        userId: z.string(),
        sig: z.string()
    })
});

/**
 * 📤 Output Event Schemas
 */
const SessionMemoryUpdatedSchema = z.object({
    event: z.literal('session.memory.updated'),
    timestamp: z.string(),
    operatorId: z.string(),
    scope: z.enum(['dialog', 'symbol', 'global']),
    promptId: z.string().optional(),
    symbol: z.string().optional(),
    slots: SlotsSchema,
    ttlSec: z.number(),
    audit: z.object({
        eventId: z.string(),
        producedBy: z.string(),
        producedAt: z.string()
    })
});

const SessionMemorySnapshotSchema = z.object({
    event: z.literal('session.memory.snapshot'),
    timestamp: z.string(),
    operatorId: z.string(),
    scopes: z.object({
        dialog: z.object({
            promptId: z.string(),
            slots: SlotsSchema
        }).optional(),
        symbol: z.record(z.object({
            slots: SlotsSchema
        })).optional(),
        global: z.object({
            slots: SlotsSchema
        }).optional()
    }),
    expiresAt: z.string()
});

const SessionMemoryQueryResultSchema = z.object({
    event: z.literal('session.memory.queryResult'),
    timestamp: z.string(),
    operatorId: z.string(),
    scopeUsed: z.string(),
    slots: SlotsSchema
});

const SessionMemoryAlertSchema = z.object({
    event: z.literal('session.memory.alert'),
    timestamp: z.string(),
    level: z.enum(['info', 'warn', 'error']),
    message: z.string(),
    context: z.record(z.any()).optional()
});

const SessionMemoryMetricsSchema = z.object({
    event: z.literal('session.memory.metrics'),
    timestamp: z.string(),
    upserts: z.number(),
    gets: z.number(),
    clears: z.number(),
    hitRate: z.number().min(0).max(1),
    gcEvictions: z.number(),
    avgLatencyMs: z.number(),
    byScope: z.record(z.number()).optional()
});

/**
 * 🗂️ Slot Extractor - Extract slots from events
 */
class SlotExtractor {
    constructor(config) {
        this.config = config;
    }

    /**
     * Extract slots from operator.decision.context
     */
    extractFromDecisionContext(event) {
        const slots = {};
        
        if (event.symbol) slots.symbol = event.symbol;
        if (event.variant) slots.variant = event.variant;
        if (event.exec) slots.execPref = event.exec;
        if (event.qty) slots.qtyPref = event.qty;
        
        return slots;
    }

    /**
     * Extract slots from operator.response.in
     */
    extractFromResponse(event) {
        const slots = {};
        
        if (event.payload.exec) slots.execPref = event.payload.exec;
        if (event.payload.qtyFactor) slots.qtyFactor = this.clampValue('qtyFactor', event.payload.qtyFactor);
        if (event.payload.note) slots.notes = this.truncateNotes(event.payload.note);
        
        return slots;
    }

    /**
     * Extract slots from operator.answer.in
     */
    extractFromAnswer(event) {
        const slots = {};
        
        if (event.value !== undefined && event.unit === 'bps') {
            slots.slipTolBps = this.clampValue('slipTolBps', Math.round(event.value));
        }
        
        return slots;
    }

    /**
     * Extract slots from guard.question.result
     */
    extractFromGuardResult(event) {
        const slots = {};
        
        if (event.recommendation?.params) {
            const params = event.recommendation.params;
            
            if (params.exec) slots.execPref = params.exec;
            if (params.qtyFactor) slots.qtyFactor = this.clampValue('qtyFactor', params.qtyFactor);
            if (params.slices) slots.slices = this.clampValue('slices', params.slices);
        }
        
        return slots;
    }

    /**
     * Extract slots from confirmation.bounds.check
     */
    extractFromBoundsCheck(event) {
        const slots = {};
        
        if (event.derived?.rr) {
            slots.rrMin = this.clampValue('rrMin', Math.floor(event.derived.rr * 10) / 10);
        }
        
        return slots;
    }

    /**
     * Clamp values to configured ranges
     */
    clampValue(key, value) {
        const clamps = this.config.merge.clamp;
        if (!clamps[key]) return value;
        
        const [min, max] = clamps[key];
        return Math.max(min, Math.min(max, value));
    }

    /**
     * Truncate and mask notes
     */
    truncateNotes(text) {
        if (!text) return undefined;
        
        // Basic PII masking (simplified)
        let masked = text.replace(/\b\d{3}-\d{3}-\d{4}\b/g, '***-***-****'); // phone
        masked = masked.replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, '***@***.***'); // email
        
        // Truncate to max length
        if (masked.length > this.config.limits.maxNotesLen) {
            masked = masked.substring(0, this.config.limits.maxNotesLen);
            
            // Try to cut at word boundary
            const lastSpace = masked.lastIndexOf(' ');
            if (lastSpace > masked.length * 0.8) {
                masked = masked.substring(0, lastSpace);
            }
        }
        
        return masked;
    }
}

/**
 * 🔗 Merge Engine - Handle slot merging with priority
 */
class MergeEngine {
    constructor(config) {
        this.config = config;
        this.priorityMap = new Map();
        
        // Build priority map (higher number = higher priority)
        config.merge.priority.forEach((eventType, index) => {
            this.priorityMap.set(eventType, index);
        });
    }

    /**
     * Merge new slots with existing slots
     */
    mergeSlots(existingSlots, newSlots, eventType) {
        const priority = this.priorityMap.get(eventType) || 0;
        const merged = { ...existingSlots };
        
        for (const [key, value] of Object.entries(newSlots)) {
            if (value === undefined || value === null) continue;
            
            // Check if we should override existing value
            if (!merged[key] || this.shouldOverride(merged[key], value, priority, key)) {
                merged[key] = value;
                
                // Add metadata about source
                if (!merged._meta) merged._meta = {};
                merged._meta[key] = { source: eventType, priority, timestamp: new Date().toISOString() };
            }
        }
        
        return merged;
    }

    /**
     * Determine if new value should override existing
     */
    shouldOverride(existing, newValue, newPriority, key) {
        if (!existing._meta || !existing._meta[key]) {
            return true; // No metadata, allow override
        }
        
        const existingPriority = existing._meta[key].priority || 0;
        
        if (newPriority > existingPriority) {
            return true; // Higher priority wins
        }
        
        if (newPriority === existingPriority && this.config.merge.lastWriteWins) {
            return true; // Same priority, last write wins
        }
        
        return false;
    }
}

/**
 * 📊 Memory Store - In-memory storage with TTL
 */
class MemoryStore {
    constructor(config) {
        this.config = config;
        this.storage = new Map(); // operatorId → scopes
        this.expirations = new Map(); // key → expireAt timestamp
    }

    /**
     * Get storage key
     */
    getKey(operatorId, scope, identifier = null) {
        let key = `${operatorId}:${scope}`;
        if (identifier) {
            key += `:${identifier}`;
        }
        return key;
    }

    /**
     * Store slots
     */
    set(operatorId, scope, identifier, slots, ttlSec) {
        const key = this.getKey(operatorId, scope, identifier);
        const expiresAt = Date.now() + (ttlSec * 1000);
        
        // Ensure operator storage exists
        if (!this.storage.has(operatorId)) {
            this.storage.set(operatorId, {
                global: {},
                symbol: new Map(),
                dialog: new Map()
            });
        }
        
        const operatorStorage = this.storage.get(operatorId);
        
        // Store in appropriate scope
        switch (scope) {
            case 'global':
                operatorStorage.global = { ...slots };
                break;
                
            case 'symbol':
                if (identifier) {
                    operatorStorage.symbol.set(identifier, { ...slots });
                }
                break;
                
            case 'dialog':
                if (identifier) {
                    operatorStorage.dialog.set(identifier, { ...slots });
                }
                break;
        }
        
        // Set expiration
        this.expirations.set(key, expiresAt);
        
        return ttlSec;
    }

    /**
     * Get slots with auto scope resolution
     */
    get(operatorId, scope, identifier = null, keys = null) {
        const operatorStorage = this.storage.get(operatorId);
        if (!operatorStorage) {
            return { slots: {}, scopeUsed: 'none' };
        }

        let result = {};
        let scopeUsed = '';

        if (scope === 'auto') {
            // Try dialog → symbol → global
            const scopes = ['dialog', 'symbol', 'global'];
            
            for (const currentScope of scopes) {
                const scopeResult = this.getFromScope(operatorStorage, currentScope, identifier);
                if (Object.keys(scopeResult).length > 0) {
                    result = { ...result, ...scopeResult };
                    scopeUsed += (scopeUsed ? '→' : '') + currentScope;
                }
            }
        } else {
            result = this.getFromScope(operatorStorage, scope, identifier);
            scopeUsed = scope;
        }

        // Filter by keys if specified
        if (keys && keys.length > 0) {
            const filtered = {};
            for (const key of keys) {
                if (result[key] !== undefined) {
                    filtered[key] = result[key];
                }
            }
            result = filtered;
        }

        // Clean metadata before returning
        const cleaned = { ...result };
        delete cleaned._meta;

        return { slots: cleaned, scopeUsed };
    }

    /**
     * Get slots from specific scope
     */
    getFromScope(operatorStorage, scope, identifier) {
        const key = identifier || '';
        
        switch (scope) {
            case 'global':
                return { ...operatorStorage.global };
                
            case 'symbol':
                if (identifier && operatorStorage.symbol.has(identifier)) {
                    return { ...operatorStorage.symbol.get(identifier) };
                }
                break;
                
            case 'dialog':
                if (identifier && operatorStorage.dialog.has(identifier)) {
                    return { ...operatorStorage.dialog.get(identifier) };
                }
                break;
        }
        
        return {};
    }

    /**
     * Clear slots
     */
    clear(operatorId, scope, identifier = null, keys = null) {
        const operatorStorage = this.storage.get(operatorId);
        if (!operatorStorage) return;

        switch (scope) {
            case 'global':
                if (keys) {
                    keys.forEach(key => delete operatorStorage.global[key]);
                } else {
                    operatorStorage.global = {};
                }
                break;
                
            case 'symbol':
                if (identifier) {
                    if (keys && operatorStorage.symbol.has(identifier)) {
                        const slots = operatorStorage.symbol.get(identifier);
                        keys.forEach(key => delete slots[key]);
                    } else {
                        operatorStorage.symbol.delete(identifier);
                    }
                }
                break;
                
            case 'dialog':
                if (identifier) {
                    if (keys && operatorStorage.dialog.has(identifier)) {
                        const slots = operatorStorage.dialog.get(identifier);
                        keys.forEach(key => delete slots[key]);
                    } else {
                        operatorStorage.dialog.delete(identifier);
                    }
                }
                break;
        }
        
        // Clear expiration
        const key = this.getKey(operatorId, scope, identifier);
        this.expirations.delete(key);
    }

    /**
     * Get snapshot of all data for operator
     */
    getSnapshot(operatorId) {
        const operatorStorage = this.storage.get(operatorId);
        if (!operatorStorage) return null;

        const scopes = {};
        
        // Global
        if (Object.keys(operatorStorage.global).length > 0) {
            scopes.global = { slots: { ...operatorStorage.global } };
        }
        
        // Symbol
        if (operatorStorage.symbol.size > 0) {
            scopes.symbol = {};
            for (const [symbol, slots] of operatorStorage.symbol.entries()) {
                scopes.symbol[symbol] = { slots: { ...slots } };
            }
        }
        
        // Dialog
        if (operatorStorage.dialog.size > 0) {
            const dialogEntries = Array.from(operatorStorage.dialog.entries());
            if (dialogEntries.length > 0) {
                const [promptId, slots] = dialogEntries[0]; // Get most recent
                scopes.dialog = {
                    promptId,
                    slots: { ...slots }
                };
            }
        }

        return scopes;
    }

    /**
     * Garbage collect expired entries
     */
    garbageCollect() {
        const now = Date.now();
        let evictions = 0;

        for (const [key, expiresAt] of this.expirations.entries()) {
            if (now >= expiresAt) {
                const [operatorId, scope, identifier] = key.split(':');
                this.clear(operatorId, scope, identifier);
                evictions++;
            }
        }

        return evictions;
    }

    /**
     * Get storage statistics
     */
    getStats() {
        const stats = {
            operators: this.storage.size,
            totalDialogs: 0,
            totalSymbols: 0,
            totalGlobals: 0
        };

        for (const operatorStorage of this.storage.values()) {
            stats.totalDialogs += operatorStorage.dialog.size;
            stats.totalSymbols += operatorStorage.symbol.size;
            if (Object.keys(operatorStorage.global).length > 0) {
                stats.totalGlobals++;
            }
        }

        return stats;
    }
}

/**
 * 🎯 LIVIA-09 Session Memory Class
 */
class SessionMemory {
    constructor(config = {}) {
        this.name = 'SessionMemory';
        this.config = {
            i18n: { locale: 'tr-TR', tz: 'Europe/Istanbul' },
            ttl: {
                dialogSec: 1800,   // 30 minutes
                symbolSec: 86400,  // 24 hours
                globalSec: 604800  // 7 days
            },
            limits: {
                maxSymbolsPerUser: 50,
                maxNotesLen: 240,
                maxSlotsPerScope: 20
            },
            merge: {
                priority: [
                    'operator.response.in',
                    'operator.answer.in',
                    'guard.question.result',
                    'confirmation.bounds.check',
                    'operator.decision.context'
                ],
                lastWriteWins: true,
                clamp: {
                    slipTolBps: [0, 50],
                    spreadTolBps: [0, 200],
                    qtyFactor: [0.25, 1.5],
                    rrMin: [1.0, 5.0],
                    slices: [1, 12]
                }
            },
            security: {
                verifySignature: true,
                rbac: {
                    read: ['trader', 'ops', 'policy'],
                    write: ['trader', 'ops']
                }
            },
            storage: {
                kind: 'inMemoryWithSnapshot',
                snapshotEverySec: 300,
                path: 'data/sessionMemory.json'
            },
            idempotencyTtlSec: 600,
            ...config
        };

        // State management
        this.state = {
            idempotencyCache: new Map(), // sourceHash -> timestamp
            stats: {
                upserts: 0,
                gets: 0,
                clears: 0,
                hits: 0,
                gcEvictions: 0,
                totalLatencyMs: 0,
                byScope: new Map()
            }
        };

        // Helper classes
        this.slotExtractor = new SlotExtractor(this.config);
        this.mergeEngine = new MergeEngine(this.config);
        this.memoryStore = new MemoryStore(this.config);

        this.isInitialized = false;
        this.logger = null;
    }

    /**
     * 🚀 Initialize the session memory
     */
    async initialize(logger) {
        try {
            this.logger = logger;
            this.logger.info(`${this.name} başlatılıyor...`);

            this.setupEventListeners();
            this.startPeriodicTasks();

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
        // Slot source events
        const slotSources = [
            'operator.decision.context',
            'operator.response.in',
            'operator.answer.in',
            'guard.question.result',
            'confirmation.bounds.check'
        ];

        slotSources.forEach(eventType => {
            eventBus.subscribeToEvent(eventType, (event) => {
                this.handleSlotSource(event.data, eventType);
            }, 'sessionMemory');
        });

        // Direct memory operations
        eventBus.subscribeToEvent('session.memory.upsert', (event) => {
            this.handleUpsert(event.data);
        }, 'sessionMemory');

        eventBus.subscribeToEvent('session.memory.get', (event) => {
            this.handleGet(event.data);
        }, 'sessionMemory');

        eventBus.subscribeToEvent('session.memory.clear', (event) => {
            this.handleClear(event.data);
        }, 'sessionMemory');
    }

    /**
     * 🎯 Handle slot source events
     */
    async handleSlotSource(data, eventType) {
        const startTime = Date.now();
        
        try {
            // Extract slots from event
            let slots = {};
            let operatorId = null;
            let scope = 'dialog';
            let identifier = null;

            switch (eventType) {
                case 'operator.decision.context':
                    const contextEvent = OperatorDecisionContextSchema.parse(data);
                    slots = this.slotExtractor.extractFromDecisionContext(contextEvent);
                    scope = 'dialog';
                    identifier = contextEvent.promptId;
                    operatorId = 'system'; // TODO: extract from context
                    break;
                    
                case 'operator.response.in':
                    const responseEvent = OperatorResponseInSchema.parse(data);
                    slots = this.slotExtractor.extractFromResponse(responseEvent);
                    scope = 'dialog';
                    identifier = responseEvent.promptId;
                    operatorId = responseEvent.auth.userId;
                    break;
                    
                case 'operator.answer.in':
                    const answerEvent = OperatorAnswerInSchema.parse(data);
                    slots = this.slotExtractor.extractFromAnswer(answerEvent);
                    scope = 'dialog';
                    identifier = answerEvent.qId.split('-')[0]; // Extract promptId
                    operatorId = answerEvent.auth.userId;
                    break;
                    
                case 'guard.question.result':
                    const guardEvent = GuardQuestionResultSchema.parse(data);
                    slots = this.slotExtractor.extractFromGuardResult(guardEvent);
                    scope = 'dialog';
                    identifier = guardEvent.promptId;
                    operatorId = 'system'; // TODO: extract from context
                    break;
                    
                case 'confirmation.bounds.check':
                    const boundsEvent = ConfirmationBoundsCheckSchema.parse(data);
                    slots = this.slotExtractor.extractFromBoundsCheck(boundsEvent);
                    scope = 'symbol';
                    identifier = boundsEvent.symbol;
                    operatorId = 'system'; // TODO: extract from context
                    break;
            }

            if (Object.keys(slots).length === 0 || !operatorId) {
                return; // Nothing to store
            }

            // Check idempotency
            const sourceHash = this.generateSourceHash(data, eventType);
            if (this.state.idempotencyCache.has(sourceHash)) {
                return;
            }

            // Store slots
            await this.upsertSlots(operatorId, scope, identifier, slots, eventType);
            
            // Mark as processed
            this.state.idempotencyCache.set(sourceHash, Date.now());

            // Update stats
            const latency = Date.now() - startTime;
            this.updateUpsertStats(latency, scope);

        } catch (error) {
            this.logger.error(`Slot source processing error (${eventType}):`, error);
        }
    }

    /**
     * 📝 Handle direct upsert
     */
    async handleUpsert(data) {
        const startTime = Date.now();
        
        try {
            const upsertEvent = SessionMemoryUpsertSchema.parse(data);
            
            // RBAC check
            if (!this.checkWritePermission(upsertEvent.auth.roles)) {
                await this.emitAlert('warn', 'rbac_forbidden', { scope: upsertEvent.scope });
                return;
            }

            const operatorId = upsertEvent.auth.userId;
            let identifier = null;
            
            switch (upsertEvent.scope) {
                case 'dialog':
                    identifier = upsertEvent.promptId;
                    break;
                case 'symbol':
                    identifier = upsertEvent.symbol;
                    break;
                case 'global':
                    // No identifier needed
                    break;
            }

            await this.upsertSlots(operatorId, upsertEvent.scope, identifier, upsertEvent.slots, 'session.memory.upsert');
            
            const latency = Date.now() - startTime;
            this.updateUpsertStats(latency, upsertEvent.scope);

        } catch (error) {
            this.logger.error('Upsert processing error:', error);
            await this.emitAlert('error', 'upsert_failed', { error: error.message });
        }
    }

    /**
     * 🔍 Handle get request
     */
    async handleGet(data) {
        const startTime = Date.now();
        
        try {
            const getEvent = SessionMemoryGetSchema.parse(data);
            
            // RBAC check
            if (!this.checkReadPermission(getEvent.auth.roles)) {
                await this.emitAlert('warn', 'rbac_forbidden', { operation: 'get' });
                return;
            }

            const operatorId = getEvent.auth.userId;
            let identifier = null;
            
            switch (getEvent.scope) {
                case 'dialog':
                case 'auto':
                    identifier = getEvent.promptId;
                    break;
                case 'symbol':
                    identifier = getEvent.symbol;
                    break;
                case 'global':
                    // No identifier needed
                    break;
            }

            const { slots, scopeUsed } = this.memoryStore.get(operatorId, getEvent.scope, identifier, getEvent.keys);
            
            // Emit result
            await this.emitQueryResult(operatorId, scopeUsed, slots);
            
            // Optionally emit snapshot
            const snapshot = this.memoryStore.getSnapshot(operatorId);
            if (snapshot) {
                await this.emitSnapshot(operatorId, snapshot);
            }

            const latency = Date.now() - startTime;
            this.updateGetStats(latency, Object.keys(slots).length > 0);

        } catch (error) {
            this.logger.error('Get processing error:', error);
            await this.emitAlert('error', 'get_failed', { error: error.message });
        }
    }

    /**
     * 🗑️ Handle clear request
     */
    async handleClear(data) {
        try {
            const clearEvent = SessionMemoryClearSchema.parse(data);
            
            // RBAC check
            if (!this.checkWritePermission(clearEvent.auth.roles)) {
                await this.emitAlert('warn', 'rbac_forbidden', { operation: 'clear' });
                return;
            }

            const operatorId = clearEvent.auth.userId;
            let identifier = null;
            
            switch (clearEvent.scope) {
                case 'dialog':
                    identifier = clearEvent.promptId;
                    break;
                case 'symbol':
                    identifier = clearEvent.symbol;
                    break;
                case 'global':
                    // No identifier needed
                    break;
            }

            this.memoryStore.clear(operatorId, clearEvent.scope, identifier, clearEvent.keys);
            
            // Emit updated event with cleared slots
            const clearedSlots = {};
            if (clearEvent.keys) {
                clearEvent.keys.forEach(key => {
                    clearedSlots[key] = null;
                });
            }

            await this.emitUpdated(operatorId, clearEvent.scope, identifier, clearedSlots, 0);
            await this.emitAlert('info', 'cleared', { scope: clearEvent.scope, keys: clearEvent.keys });

            this.state.stats.clears++;

        } catch (error) {
            this.logger.error('Clear processing error:', error);
            await this.emitAlert('error', 'clear_failed', { error: error.message });
        }
    }

    /**
     * 📝 Upsert slots with merging
     */
    async upsertSlots(operatorId, scope, identifier, newSlots, eventType) {
        // Get existing slots
        const { slots: existingSlots } = this.memoryStore.get(operatorId, scope, identifier);
        
        // Merge with existing
        const mergedSlots = this.mergeEngine.mergeSlots(existingSlots, newSlots, eventType);
        
        // Validate merged slots
        try {
            SlotsSchema.parse(mergedSlots);
        } catch (error) {
            await this.emitAlert('warn', 'invalid_slot', { error: error.message });
            return;
        }

        // Determine TTL
        const ttlSec = this.config.ttl[`${scope}Sec`] || this.config.ttl.dialogSec;
        
        // Store
        this.memoryStore.set(operatorId, scope, identifier, mergedSlots, ttlSec);
        
        // Emit updated event
        await this.emitUpdated(operatorId, scope, identifier, mergedSlots, ttlSec);
    }

    /**
     * 🔐 Check read permission
     */
    checkReadPermission(roles) {
        return this.config.security.rbac.read.some(role => roles.includes(role));
    }

    /**
     * 🔐 Check write permission
     */
    checkWritePermission(roles) {
        return this.config.security.rbac.write.some(role => roles.includes(role));
    }

    /**
     * 🎯 Generate source hash for idempotency
     */
    generateSourceHash(data, eventType) {
        const hashData = {
            eventType,
            timestamp: data.timestamp,
            content: JSON.stringify(data)
        };
        
        return createHash('md5').update(JSON.stringify(hashData)).digest('hex');
    }

    /**
     * 📤 Emit updated event
     */
    async emitUpdated(operatorId, scope, identifier, slots, ttlSec) {
        const updated = {
            event: 'session.memory.updated',
            timestamp: new Date().toISOString(),
            operatorId,
            scope,
            slots,
            ttlSec,
            audit: {
                eventId: `mem-${Date.now()}`,
                producedBy: 'livia-09',
                producedAt: new Date().toISOString()
            }
        };

        if (identifier) {
            if (scope === 'dialog') updated.promptId = identifier;
            if (scope === 'symbol') updated.symbol = identifier;
        }

        try {
            const validated = SessionMemoryUpdatedSchema.parse(updated);
            eventBus.publishEvent('session.memory.updated', validated, 'sessionMemory');
        } catch (error) {
            this.logger.error('Updated emission error:', error);
        }
    }

    /**
     * 📤 Emit query result
     */
    async emitQueryResult(operatorId, scopeUsed, slots) {
        const result = {
            event: 'session.memory.queryResult',
            timestamp: new Date().toISOString(),
            operatorId,
            scopeUsed,
            slots
        };

        try {
            const validated = SessionMemoryQueryResultSchema.parse(result);
            eventBus.publishEvent('session.memory.queryResult', validated, 'sessionMemory');
        } catch (error) {
            this.logger.error('Query result emission error:', error);
        }
    }

    /**
     * 📤 Emit snapshot
     */
    async emitSnapshot(operatorId, scopes) {
        const snapshot = {
            event: 'session.memory.snapshot',
            timestamp: new Date().toISOString(),
            operatorId,
            scopes,
            expiresAt: new Date(Date.now() + this.config.ttl.globalSec * 1000).toISOString()
        };

        try {
            const validated = SessionMemorySnapshotSchema.parse(snapshot);
            eventBus.publishEvent('session.memory.snapshot', validated, 'sessionMemory');
        } catch (error) {
            this.logger.error('Snapshot emission error:', error);
        }
    }

    /**
     * 🚨 Emit alert
     */
    async emitAlert(level, message, context = {}) {
        const alert = {
            event: 'session.memory.alert',
            timestamp: new Date().toISOString(),
            level,
            message,
            context
        };

        try {
            const validated = SessionMemoryAlertSchema.parse(alert);
            eventBus.publishEvent('session.memory.alert', validated, 'sessionMemory');
        } catch (error) {
            this.logger.error('Alert emission error:', error);
        }
    }

    /**
     * 📊 Update upsert statistics
     */
    updateUpsertStats(latencyMs, scope) {
        this.state.stats.upserts++;
        this.state.stats.totalLatencyMs += latencyMs;
        
        const current = this.state.stats.byScope.get(scope) || 0;
        this.state.stats.byScope.set(scope, current + 1);
    }

    /**
     * 📊 Update get statistics
     */
    updateGetStats(latencyMs, hit) {
        this.state.stats.gets++;
        this.state.stats.totalLatencyMs += latencyMs;
        
        if (hit) {
            this.state.stats.hits++;
        }
    }

    /**
     * ⏱️ Start periodic tasks
     */
    startPeriodicTasks() {
        // Garbage collection every 5 minutes
        setInterval(() => {
            const evictions = this.memoryStore.garbageCollect();
            if (evictions > 0) {
                this.state.stats.gcEvictions += evictions;
                this.logger.info(`Session memory GC: ${evictions} evictions`);
            }
        }, 300000);

        // Clean idempotency cache every 10 minutes
        setInterval(() => {
            this.cleanupIdempotency();
        }, 600000);

        // Emit metrics every 30 seconds
        setInterval(() => {
            this.emitMetrics();
        }, 30000);
    }

    /**
     * 🧹 Cleanup idempotency cache
     */
    cleanupIdempotency() {
        const now = Date.now();
        const ttlMs = this.config.idempotencyTtlSec * 1000;
        let cleaned = 0;

        for (const [hash, timestamp] of this.state.idempotencyCache.entries()) {
            if (now - timestamp > ttlMs) {
                this.state.idempotencyCache.delete(hash);
                cleaned++;
            }
        }

        if (cleaned > 0) {
            this.logger.info(`Cleaned ${cleaned} idempotency entries`);
        }
    }

    /**
     * 📊 Emit metrics
     */
    emitMetrics() {
        const avgLatencyMs = this.state.stats.upserts + this.state.stats.gets > 0 ?
            this.state.stats.totalLatencyMs / (this.state.stats.upserts + this.state.stats.gets) : 0;
        
        const hitRate = this.state.stats.gets > 0 ? 
            this.state.stats.hits / this.state.stats.gets : 0;

        const byScope = {};
        for (const [scope, count] of this.state.stats.byScope.entries()) {
            byScope[scope] = count;
        }

        const metrics = {
            event: 'session.memory.metrics',
            timestamp: new Date().toISOString(),
            upserts: this.state.stats.upserts,
            gets: this.state.stats.gets,
            clears: this.state.stats.clears,
            hitRate: Number(hitRate.toFixed(3)),
            gcEvictions: this.state.stats.gcEvictions,
            avgLatencyMs: Number(avgLatencyMs.toFixed(1)),
            byScope
        };

        try {
            const validated = SessionMemoryMetricsSchema.parse(metrics);
            eventBus.publishEvent('session.memory.metrics', validated, 'sessionMemory');
        } catch (error) {
            this.logger.error('Metrics emission error:', error);
        }
    }

    /**
     * 📊 Get system status
     */
    getStatus() {
        const storeStats = this.memoryStore.getStats();
        
        return {
            name: this.name,
            initialized: this.isInitialized,
            storage: storeStats,
            idempotencyCache: this.state.idempotencyCache.size,
            stats: { ...this.state.stats }
        };
    }

    /**
     * 🛑 Shutdown
     */
    async shutdown() {
        try {
            this.logger.info(`${this.name} kapatılıyor...`);
            
            // Clear all caches
            this.state.idempotencyCache.clear();
            this.state.stats.byScope.clear();
            
            this.isInitialized = false;
            this.logger.info(`${this.name} başarıyla kapatıldı`);
        } catch (error) {
            this.logger.error(`${this.name} kapatma hatası:`, error);
        }
    }
}

module.exports = {
    SessionMemory,
    sessionMemory: new SessionMemory(),
    SlotExtractor,
    MergeEngine,
    MemoryStore
};