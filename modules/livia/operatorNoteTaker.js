/**
 * LIVIA-10 · operatorNoteTaker.js
 * Operator not alıcısı - Sinyallerden insan okunur seans notları ve eylem maddeleri üretir
 * 
 * Amaç: Diyalog/işlem sırasında oluşan sinyallerden insan okunur seans notları ve eylem maddeleri 
 * üretmek; bunları Markdown dosyalarına güvenli şekilde yazmak ve UI'ya kart olarak yollamak.
 */

const { z } = require('zod');
const fs = require('fs').promises;
const path = require('path');
const { createHash } = require('crypto');
const { eventBus } = require('../../kirpto bot sinyal/modules/modularEventStream');
const { logInfo, logError, logEvent } = require('../../kirpto bot sinyal/logs/logger');

/**
 * 🔄 Input Event Schemas
 */
const DecisionRationaleSchema = z.object({
    event: z.literal('decision.rationale'),
    timestamp: z.string(),
    promptId: z.string(),
    decisionId: z.string(),
    accepted: z.boolean(),
    summary: z.string(),
    details: z.object({
        finalPlan: z.object({
            symbol: z.string(),
            exec: z.string().optional(),
            qty: z.number().optional(),
            rr: z.number().optional()
        }),
        why: z.array(z.string())
    }),
    biasContext: z.object({
        overconfidence: z.number()
    }).optional(),
    audit: z.object({
        eventId: z.string()
    })
});

const PolicyExplainSchema = z.object({
    event: z.literal('policy.explain'),
    timestamp: z.string(),
    kind: z.enum(['bounds', 'guard', 'variant', 'policy_change']),
    title: z.string().optional(),
    bullets: z.array(z.string()),
    citations: z.array(z.object({
        path: z.string(),
        version: z.string()
    })).optional(),
    context: z.object({
        symbol: z.string().optional(),
        guardMode: z.string().optional()
    }).optional()
});

const ApprovalPendingSchema = z.object({
    event: z.literal('approval.pending'),
    timestamp: z.string(),
    approvalKey: z.string(),
    action: z.string(),
    needed: z.object({
        quorum: z.number(),
        of: z.number()
    })
});

const ActionApprovedSchema = z.object({
    event: z.literal('action.approved'),
    timestamp: z.string(),
    action: z.string(),
    payload: z.record(z.any()),
    by: z.array(z.object({
        userId: z.string(),
        roles: z.array(z.string())
    }))
});

const IncidentStartedSchema = z.object({
    event: z.literal('incident.started'),
    timestamp: z.string(),
    id: z.string(),
    severity: z.enum(['high', 'medium', 'low']),
    title: z.string(),
    tags: z.array(z.string()).optional()
});

const IncidentClosedSchema = z.object({
    event: z.literal('incident.closed'),
    timestamp: z.string(),
    id: z.string(),
    resolution: z.string(),
    durationMin: z.number()
});

const TelemetryAnomalySignalSchema = z.object({
    event: z.literal('telemetry.anomaly.signal'),
    timestamp: z.string(),
    series: z.string(),
    kind: z.string(),
    severity: z.enum(['high', 'medium', 'low'])
});

const OperatorNoteAddSchema = z.object({
    event: z.literal('operator.note.add'),
    timestamp: z.string(),
    sessionId: z.string(),
    text: z.string(),
    auth: z.object({
        userId: z.string(),
        sig: z.string()
    })
});

/**
 * 📤 Output Event Schemas
 */
const OperatorNotesAppendSchema = z.object({
    event: z.literal('operator.notes.append'),
    timestamp: z.string(),
    sessionId: z.string(),
    lines: z.array(z.object({
        ts: z.string(),
        kind: z.enum(['decision', 'action', 'approval', 'incident', 'info']),
        text: z.string(),
        tags: z.array(z.string()),
        source: z.string(),
        noteKey: z.string(),
        due: z.string().optional(),
        owner: z.string().optional()
    })),
    audit: z.object({
        eventId: z.string(),
        producedBy: z.string(),
        producedAt: z.string()
    })
});

const NotesSessionMdSchema = z.object({
    event: z.literal('notes.session.md'),
    timestamp: z.string(),
    path: z.string(),
    sizeBytes: z.number(),
    summary: z.string()
});

const NotesDailyMdSchema = z.object({
    event: z.literal('notes.daily.md'),
    timestamp: z.string(),
    path: z.string(),
    summary: z.string(),
    counts: z.record(z.number())
});

const NotesCardSchema = z.object({
    event: z.literal('notes.card'),
    timestamp: z.string(),
    title: z.string(),
    body: z.string(),
    severity: z.enum(['info', 'warn', 'error']),
    ttlSec: z.number()
});

const NotesAlertSchema = z.object({
    event: z.literal('notes.alert'),
    timestamp: z.string(),
    level: z.enum(['info', 'warn', 'error']),
    message: z.string(),
    context: z.record(z.any()).optional()
});

const NotesMetricsSchema = z.object({
    event: z.literal('notes.metrics'),
    timestamp: z.string(),
    appends: z.number(),
    sessions: z.number(),
    dailyRollups: z.number(),
    avgAppendMs: z.number(),
    writeErrors: z.number(),
    dedupeRate: z.number(),
    byKind: z.record(z.number()).optional()
});

/**
 * 📝 Note Line Builder
 */
class NoteLineBuilder {
    constructor(config) {
        this.config = config;
    }

    /**
     * Build line from decision rationale
     */
    buildDecisionLine(event) {
        const plan = event.details.finalPlan;
        const status = event.accepted ? 'ONAY' : 'RED';
        
        let text = `PLAN ${status}: ${plan.symbol}`;
        
        if (plan.exec) {
            text += ` ${plan.exec.toUpperCase()}`;
        }
        
        if (event.summary.includes('qty')) {
            const qtyMatch = event.summary.match(/qty\s*([+\-]\d+%)/);
            if (qtyMatch) {
                text += ` + miktar ${qtyMatch[1]}`;
            }
        }
        
        if (plan.rr) {
            text += `; RR≈${plan.rr.toFixed(2)}`;
        }
        
        // Add main reason
        if (event.details.why && event.details.why.length > 0) {
            const mainReason = event.details.why[0];
            if (mainReason.includes('slip')) {
                text += '. Gerekçe: slip limiti aşıldı → LIMIT';
            } else if (mainReason.includes('spread')) {
                text += '. Gerekçe: spread yüksek → LIMIT';
            } else if (mainReason.includes('RR')) {
                text += '. Gerekçe: RR eşik altı';
            }
        }
        
        // Add bias context if available
        if (this.config.compose.includeBiasMini && event.biasContext) {
            text += ` (bias: OC=${event.biasContext.overconfidence.toFixed(2)})`;
        }
        
        return {
            kind: 'decision',
            text: this.truncateText(text),
            tags: this.generateTags(text, 'decision'),
            source: event.event
        };
    }

    /**
     * Build line from policy explain
     */
    buildPolicyLine(event) {
        const mainBullet = event.bullets[0] || 'Policy açıklaması';
        
        let text = mainBullet;
        
        // Add policy reference
        if (event.citations && event.citations.length > 0) {
            const citation = event.citations[0];
            text += ` (${citation.version}/${citation.path})`;
        }
        
        return {
            kind: 'info',
            text: this.truncateText(text),
            tags: this.generateTags(text, 'policy'),
            source: event.event
        };
    }

    /**
     * Build action line from policy explain
     */
    buildActionFromPolicy(event) {
        // Check if policy explain suggests an action
        const actionSuggestions = [
            { contains: 'LIMIT önerisi', action: 'Planı LIMIT ile yeniden değerlendir', owner: 'ops', hours: 4 },
            { contains: 'slip', action: 'Slip limitlerini gözden geçir', owner: 'policy-team', hours: 24 },
            { contains: 'spread', action: 'Spread toleransını kontrol et', owner: 'ops', hours: 8 }
        ];

        for (const suggestion of actionSuggestions) {
            if (event.bullets.some(bullet => bullet.includes(suggestion.contains))) {
                const due = new Date(Date.now() + suggestion.hours * 60 * 60 * 1000);
                
                return {
                    kind: 'action',
                    text: `EYLEM: ${suggestion.action}; sorumlu: ${suggestion.owner}; son tarih: ${this.formatDate(due)}.`,
                    tags: this.generateTags(suggestion.action, 'action'),
                    source: event.event,
                    due: due.toISOString(),
                    owner: suggestion.owner
                };
            }
        }
        
        return null;
    }

    /**
     * Build line from approval events
     */
    buildApprovalLine(event) {
        let text = '';
        
        if (event.event === 'approval.pending') {
            text = `Onay bekleniyor: ${event.action} (${event.needed.quorum}/${event.needed.of})`;
        } else if (event.event === 'action.approved') {
            const approver = event.by[0]?.userId || 'unknown';
            text = `Onaylandı: ${event.action} (${approver})`;
        }
        
        return {
            kind: 'approval',
            text: this.truncateText(text),
            tags: this.generateTags(text, 'approval'),
            source: event.event
        };
    }

    /**
     * Build line from incident events
     */
    buildIncidentLine(event) {
        let text = '';
        
        if (event.event === 'incident.started') {
            text = `OLAY BAŞLADI: ${event.title} (${event.severity})`;
            if (event.tags) {
                text += ` [${event.tags.join(', ')}]`;
            }
        } else if (event.event === 'incident.closed') {
            text = `OLAY KAPANDI: ${event.id} (${event.durationMin} dk) - ${event.resolution}`;
        }
        
        return {
            kind: 'incident',
            text: this.truncateText(text),
            tags: this.generateTags(text, 'incident'),
            source: event.event
        };
    }

    /**
     * Build line from anomaly signal
     */
    buildAnomalyLine(event) {
        const text = `${event.series} ${event.kind} (${event.severity})`;
        
        return {
            kind: 'info',
            text: this.truncateText(text),
            tags: this.generateTags(text, 'anomaly'),
            source: event.event
        };
    }

    /**
     * Build line from operator note
     */
    buildOperatorNoteLine(event) {
        const text = event.text;
        
        return {
            kind: 'info',
            text: this.truncateText(this.maskPII(text)),
            tags: this.generateTags(text, 'note'),
            source: event.event
        };
    }

    /**
     * Generate automatic tags
     */
    generateTags(text, baseKind) {
        const tags = [baseKind];
        const lowerText = text.toLowerCase();
        
        // Symbol detection
        const symbolMatch = text.match(/\b([A-Z]{3,4}USDT?)\b/);
        if (symbolMatch) {
            tags.push(symbolMatch[1].toLowerCase());
        }

        // Common terms
        const termMap = {
            'limit': 'limit',
            'twap': 'twap',
            'market': 'market',
            'slip': 'slip',
            'spread': 'spread',
            'rr': 'rr',
            'guard': 'guard',
            'onay': 'approval',
            'red': 'rejection',
            'olay': 'incident'
        };

        for (const [term, tag] of Object.entries(termMap)) {
            if (lowerText.includes(term)) {
                tags.push(tag);
            }
        }

        return tags.slice(0, 6); // Limit to 6 tags
    }

    /**
     * Truncate text to max length
     */
    truncateText(text) {
        if (text.length <= this.config.compose.maxLineLen) {
            return text;
        }

        const truncated = text.substring(0, this.config.compose.maxLineLen);
        const lastSpace = truncated.lastIndexOf(' ');
        
        if (lastSpace > truncated.length * 0.8) {
            return truncated.substring(0, lastSpace) + '...';
        }
        
        return truncated + '...';
    }

    /**
     * Mask PII in text
     */
    maskPII(text) {
        if (!this.config.pii.enabled) return text;
        
        let masked = text;
        
        // Phone numbers
        masked = masked.replace(/\b\d{3}-\d{3}-\d{4}\b/g, this.config.pii.maskWith);
        
        // Email addresses
        masked = masked.replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, this.config.pii.maskWith);
        
        return masked;
    }

    /**
     * Format date for Turkish locale
     */
    formatDate(date) {
        return date.toLocaleString('tr-TR', {
            timeZone: 'Europe/Istanbul',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        });
    }
}

/**
 * 📁 Markdown Writer - Atomic file operations
 */
class MarkdownWriter {
    constructor(config) {
        this.config = config;
        this.locks = new Map(); // path -> promise
    }

    /**
     * Append lines to session markdown file
     */
    async appendToSession(sessionId, lines) {
        const sessionPath = this.getSessionPath(sessionId);
        
        // Ensure directory exists
        await this.ensureDirectory(path.dirname(sessionPath));
        
        // Acquire lock for this file
        await this.acquireLock(sessionPath);
        
        try {
            // Check if file exists, create with header if not
            let fileExists = false;
            try {
                await fs.access(sessionPath);
                fileExists = true;
            } catch (error) {
                // File doesn't exist
            }

            if (!fileExists) {
                await this.createSessionFile(sessionPath, sessionId);
            }

            // Append lines
            const content = this.formatLines(lines);
            await fs.appendFile(sessionPath, content, 'utf8');
            
            // Get file stats
            const stats = await fs.stat(sessionPath);
            
            return {
                path: sessionPath,
                sizeBytes: stats.size
            };
            
        } finally {
            this.releaseLock(sessionPath);
        }
    }

    /**
     * Update daily markdown file
     */
    async updateDaily(date, summary, counts) {
        const dailyPath = this.getDailyPath(date);
        
        await this.ensureDirectory(path.dirname(dailyPath));
        await this.acquireLock(dailyPath);
        
        try {
            const content = this.formatDailySummary(date, summary, counts);
            await fs.writeFile(dailyPath, content, 'utf8');
            
            return {
                path: dailyPath,
                summary
            };
            
        } finally {
            this.releaseLock(dailyPath);
        }
    }

    /**
     * Get session file path
     */
    getSessionPath(sessionId) {
        const date = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
        const fileName = `${sessionId}.md`;
        return path.join(this.config.storage.rootDir, date, fileName);
    }

    /**
     * Get daily file path
     */
    getDailyPath(date) {
        const dateStr = date.toISOString().split('T')[0]; // YYYY-MM-DD
        return path.join(this.config.storage.rootDir, dateStr, 'Daily.md');
    }

    /**
     * Create session file with header
     */
    async createSessionFile(filePath, sessionId) {
        const symbol = this.extractSymbolFromSessionId(sessionId);
        const startTime = new Date().toISOString();
        
        const header = `---
sessionId: ${sessionId}
symbol: ${symbol || 'UNKNOWN'}
startedAt: ${startTime}
tags: [${symbol ? symbol.toLowerCase() : 'trading'}]
---

`;
        
        await fs.writeFile(filePath, header, 'utf8');
    }

    /**
     * Format lines for markdown
     */
    formatLines(lines) {
        let content = '';
        
        for (const line of lines) {
            const time = new Date(line.ts).toLocaleTimeString('tr-TR', {
                timeZone: 'Europe/Istanbul',
                hour: '2-digit',
                minute: '2-digit'
            });
            
            const kindHeader = this.getKindHeader(line.kind);
            content += `### ${time} ${kindHeader}\n`;
            content += `${line.text} {tags: ${line.tags.join(', ')}}\n\n`;
        }
        
        return content;
    }

    /**
     * Get header for line kind
     */
    getKindHeader(kind) {
        const headers = {
            decision: 'PLAN',
            action: 'ACTION',
            approval: 'ONAY',
            incident: 'OLAY',
            info: 'BİLGİ'
        };
        
        return headers[kind] || 'NOT';
    }

    /**
     * Format daily summary
     */
    formatDailySummary(date, summary, counts) {
        const dateStr = date.toLocaleDateString('tr-TR', {
            timeZone: 'Europe/Istanbul',
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });
        
        let content = `# Günlük Özet - ${dateStr}\n\n`;
        content += `${summary}\n\n`;
        
        content += `## İstatistikler\n\n`;
        for (const [kind, count] of Object.entries(counts)) {
            content += `- ${kind}: ${count}\n`;
        }
        
        content += `\n---\n*Otomatik oluşturuldu: ${new Date().toISOString()}*\n`;
        
        return content;
    }

    /**
     * Extract symbol from session ID
     */
    extractSymbolFromSessionId(sessionId) {
        const match = sessionId.match(/sess-([A-Z]{3,4}USDT?)-/);
        return match ? match[1] : null;
    }

    /**
     * Ensure directory exists
     */
    async ensureDirectory(dirPath) {
        try {
            await fs.mkdir(dirPath, { recursive: true });
        } catch (error) {
            if (error.code !== 'EEXIST') {
                throw error;
            }
        }
    }

    /**
     * Acquire file lock
     */
    async acquireLock(filePath) {
        if (this.locks.has(filePath)) {
            await this.locks.get(filePath);
        }
        
        const lockPromise = new Promise(resolve => {
            setTimeout(resolve, 0); // Immediate resolution for now
        });
        
        this.locks.set(filePath, lockPromise);
        await lockPromise;
    }

    /**
     * Release file lock
     */
    releaseLock(filePath) {
        this.locks.delete(filePath);
    }
}

/**
 * 🎯 LIVIA-10 Operator Note Taker Class
 */
class OperatorNoteTaker {
    constructor(config = {}) {
        this.name = 'OperatorNoteTaker';
        this.config = {
            i18n: { locale: 'tr-TR', tz: 'Europe/Istanbul', dateFmt: 'YYYY-MM-DD HH:mm' },
            storage: {
                rootDir: 'data/notes',
                sessionFilePattern: '{YYYY-MM-DD}/sess-{symbol}-{hash(promptId)}.md',
                dailyFilePattern: '{YYYY-MM-DD}/Daily.md',
                atomicWrite: true,
                lockTimeoutMs: 3000
            },
            compose: {
                maxLineLen: 160,
                includeBiasMini: true,
                includeCitations: true,
                tagRules: {
                    decision: ['decision', 'limit', 'twap', 'qty', 'rr'],
                    incident: ['incident', 'slip', 'latency', 'rollback'],
                    approval: ['approval', 'quorum', 'failover'],
                    action: ['action', 'owner', 'due']
                }
            },
            actionHeuristics: {
                fromPolicyExplain: [
                    { ifContains: ['LIMIT önerisi'], then: 'Planı LIMIT ile yeniden değerlendir', owner: 'ops', dueHours: 4 }
                ],
                fromDecision: [
                    { ifContains: ['RR<'], then: 'SL/TP parametreleri tekrar ayarla', owner: 'trader', dueHours: 2 }
                ],
                fromIncident: [
                    { always: true, then: 'Postmortem taslağını başlat', owner: 'ops', dueHours: 12 }
                ]
            },
            pii: {
                enabled: true,
                fields: ['text'],
                maskWith: '***'
            },
            rollup: {
                sessionToDaily: true,
                dailyRunAt: '18:05',
                emptyDayNote: 'Olay yok / normal operasyon.'
            },
            idempotencyTtlSec: 900,
            ...config
        };

        // State management
        this.state = {
            recentEvents: [], // Last 50 events for context
            idempotencyCache: new Map(), // noteKey -> timestamp
            stats: {
                appends: 0,
                sessions: 0,
                dailyRollups: 0,
                totalAppendMs: 0,
                writeErrors: 0,
                dedupeCount: 0,
                byKind: new Map()
            }
        };

        // Helper classes
        this.lineBuilder = new NoteLineBuilder(this.config);
        this.markdownWriter = new MarkdownWriter(this.config);

        this.isInitialized = false;
        this.logger = null;
    }

    /**
     * 🚀 Initialize the note taker
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
        const noteableEvents = [
            'decision.rationale',
            'policy.explain',
            'approval.pending',
            'action.approved',
            'incident.started',
            'incident.closed',
            'telemetry.anomaly.signal',
            'operator.note.add'
        ];

        noteableEvents.forEach(eventType => {
            eventBus.subscribeToEvent(eventType, (event) => {
                this.handleNoteableEvent(event.data, eventType);
            }, 'operatorNoteTaker');
        });
    }

    /**
     * 📝 Handle noteable events
     */
    async handleNoteableEvent(data, eventType) {
        const startTime = Date.now();
        
        try {
            // Track event for context
            this.trackEvent(data);
            
            // Generate lines from event
            const lines = await this.generateLines(data, eventType);
            
            if (lines.length === 0) {
                return; // Nothing to note
            }

            // Determine session ID
            const sessionId = this.determineSessionId(data, eventType);
            
            // Check idempotency
            const filteredLines = this.filterIdempotentLines(lines);
            
            if (filteredLines.length === 0) {
                this.state.stats.dedupeCount++;
                return; // All lines are duplicates
            }

            // Append to session file
            const sessionResult = await this.markdownWriter.appendToSession(sessionId, filteredLines);
            
            // Emit events
            await this.emitNotesAppend(sessionId, filteredLines);
            await this.emitSessionMd(sessionResult, sessionId);
            
            // Generate card for important events
            if (this.shouldGenerateCard(eventType, data)) {
                await this.emitCard(sessionId, filteredLines[0], data);
            }

            // Update stats
            const appendTime = Date.now() - startTime;
            this.updateStats(appendTime, filteredLines.length, eventType);

        } catch (error) {
            this.logger.error(`Note taking error (${eventType}):`, error);
            this.state.stats.writeErrors++;
            await this.emitAlert('error', 'write_failed', { eventType, error: error.message });
        }
    }

    /**
     * 📝 Generate lines from event
     */
    async generateLines(data, eventType) {
        const lines = [];
        
        try {
            switch (eventType) {
                case 'decision.rationale':
                    const rationale = DecisionRationaleSchema.parse(data);
                    const decisionLine = this.lineBuilder.buildDecisionLine(rationale);
                    if (decisionLine) {
                        lines.push(this.finalizeLineWithMetadata(decisionLine, rationale.timestamp));
                    }
                    break;
                    
                case 'policy.explain':
                    const policy = PolicyExplainSchema.parse(data);
                    const policyLine = this.lineBuilder.buildPolicyLine(policy);
                    if (policyLine) {
                        lines.push(this.finalizeLineWithMetadata(policyLine, policy.timestamp));
                    }
                    
                    // Check for action generation
                    const actionLine = this.lineBuilder.buildActionFromPolicy(policy);
                    if (actionLine) {
                        lines.push(this.finalizeLineWithMetadata(actionLine, policy.timestamp));
                    }
                    break;
                    
                case 'approval.pending':
                case 'action.approved':
                    const approval = eventType === 'approval.pending' ? 
                        ApprovalPendingSchema.parse(data) : 
                        ActionApprovedSchema.parse(data);
                    const approvalLine = this.lineBuilder.buildApprovalLine(approval);
                    if (approvalLine) {
                        lines.push(this.finalizeLineWithMetadata(approvalLine, approval.timestamp));
                    }
                    break;
                    
                case 'incident.started':
                case 'incident.closed':
                    const incident = eventType === 'incident.started' ?
                        IncidentStartedSchema.parse(data) :
                        IncidentClosedSchema.parse(data);
                    const incidentLine = this.lineBuilder.buildIncidentLine(incident);
                    if (incidentLine) {
                        lines.push(this.finalizeLineWithMetadata(incidentLine, incident.timestamp));
                    }
                    break;
                    
                case 'telemetry.anomaly.signal':
                    const anomaly = TelemetryAnomalySignalSchema.parse(data);
                    const anomalyLine = this.lineBuilder.buildAnomalyLine(anomaly);
                    if (anomalyLine) {
                        lines.push(this.finalizeLineWithMetadata(anomalyLine, anomaly.timestamp));
                    }
                    break;
                    
                case 'operator.note.add':
                    const note = OperatorNoteAddSchema.parse(data);
                    const noteLine = this.lineBuilder.buildOperatorNoteLine(note);
                    if (noteLine) {
                        lines.push(this.finalizeLineWithMetadata(noteLine, note.timestamp));
                    }
                    break;
            }
        } catch (error) {
            this.logger.error(`Line generation error (${eventType}):`, error);
        }
        
        return lines;
    }

    /**
     * 📋 Finalize line with metadata
     */
    finalizeLineWithMetadata(line, timestamp) {
        const noteKey = this.generateNoteKey(line.text, timestamp);
        
        return {
            ts: timestamp,
            kind: line.kind,
            text: line.text,
            tags: line.tags,
            source: line.source,
            noteKey,
            due: line.due,
            owner: line.owner
        };
    }

    /**
     * 🔑 Generate note key for idempotency
     */
    generateNoteKey(text, timestamp) {
        const normalized = text.toLowerCase().replace(/\s+/g, ' ').trim();
        const sessionDate = new Date(timestamp).toISOString().split('T')[0];
        const keyData = `${normalized}:${sessionDate}`;
        
        const hash = createHash('sha256').update(keyData).digest('hex');
        return `sha256:${hash.substring(0, 16)}`;
    }

    /**
     * 🔍 Filter idempotent lines
     */
    filterIdempotentLines(lines) {
        const now = Date.now();
        const ttlMs = this.config.idempotencyTtlSec * 1000;
        const filtered = [];
        
        for (const line of lines) {
            const cachedTime = this.state.idempotencyCache.get(line.noteKey);
            
            if (!cachedTime || (now - cachedTime) > ttlMs) {
                filtered.push(line);
                this.state.idempotencyCache.set(line.noteKey, now);
            }
        }
        
        return filtered;
    }

    /**
     * 🏷️ Determine session ID
     */
    determineSessionId(data, eventType) {
        // Try to extract from promptId
        if (data.promptId) {
            const symbol = this.extractSymbolFromEvent(data);
            const hash = createHash('md5').update(data.promptId).digest('hex').substring(0, 6);
            return `sess-${symbol || 'generic'}-${hash}`;
        }
        
        // Try to extract from sessionId
        if (data.sessionId) {
            return data.sessionId;
        }
        
        // Fallback to generic session
        const date = new Date().toISOString().split('T')[0];
        return `sess-generic-${date}`;
    }

    /**
     * 🏷️ Extract symbol from event
     */
    extractSymbolFromEvent(data) {
        if (data.details?.finalPlan?.symbol) {
            return data.details.finalPlan.symbol.replace('USDT', '');
        }
        
        if (data.context?.symbol) {
            return data.context.symbol.replace('USDT', '');
        }
        
        // Try to find symbol in text fields
        const textFields = [data.summary, data.title, data.text].filter(Boolean);
        for (const text of textFields) {
            const match = text.match(/\b([A-Z]{3,4})USDT?\b/);
            if (match) {
                return match[1];
            }
        }
        
        return null;
    }

    /**
     * 🎴 Should generate card for event
     */
    shouldGenerateCard(eventType, data) {
        const cardEvents = ['decision.rationale', 'incident.started', 'action.approved'];
        
        if (!cardEvents.includes(eventType)) {
            return false;
        }
        
        // Only generate card for accepted decisions
        if (eventType === 'decision.rationale' && !data.accepted) {
            return false;
        }
        
        return true;
    }

    /**
     * 📝 Track event for context
     */
    trackEvent(event) {
        this.state.recentEvents.push(event);
        
        // Keep only last 50 events
        if (this.state.recentEvents.length > 50) {
            this.state.recentEvents.shift();
        }
    }

    /**
     * 📤 Emit notes append event
     */
    async emitNotesAppend(sessionId, lines) {
        const notesAppend = {
            event: 'operator.notes.append',
            timestamp: new Date().toISOString(),
            sessionId,
            lines,
            audit: {
                eventId: `notes-${Date.now()}`,
                producedBy: 'livia-10',
                producedAt: new Date().toISOString()
            }
        };

        try {
            const validated = OperatorNotesAppendSchema.parse(notesAppend);
            eventBus.publishEvent('operator.notes.append', validated, 'operatorNoteTaker');
        } catch (error) {
            this.logger.error('Notes append emission error:', error);
        }
    }

    /**
     * 📤 Emit session md event
     */
    async emitSessionMd(sessionResult, sessionId) {
        const symbol = this.extractSymbolFromSessionId(sessionId);
        const summary = `${symbol || 'Generic'} seansı: ${this.state.stats.appends} not`;
        
        const sessionMd = {
            event: 'notes.session.md',
            timestamp: new Date().toISOString(),
            path: sessionResult.path,
            sizeBytes: sessionResult.sizeBytes,
            summary
        };

        try {
            const validated = NotesSessionMdSchema.parse(sessionMd);
            eventBus.publishEvent('notes.session.md', validated, 'operatorNoteTaker');
        } catch (error) {
            this.logger.error('Session md emission error:', error);
        }
    }

    /**
     * 🎴 Emit card for UI
     */
    async emitCard(sessionId, line, originalData) {
        let title = 'Seans notu güncellendi';
        let body = line.text;
        let severity = 'info';
        
        // Customize based on line kind
        switch (line.kind) {
            case 'decision':
                const symbol = this.extractSymbolFromSessionId(sessionId);
                title = `Seans notu güncellendi (${symbol || 'Plan'})`;
                severity = originalData.accepted ? 'info' : 'warn';
                break;
                
            case 'incident':
                title = 'Olay kaydedildi';
                severity = 'warn';
                break;
                
            case 'action':
                title = 'Eylem eklendi';
                body = `${line.text} (${line.owner})`;
                severity = 'info';
                break;
        }

        const card = {
            event: 'notes.card',
            timestamp: new Date().toISOString(),
            title,
            body: body.substring(0, 200), // Truncate for card
            severity,
            ttlSec: 180
        };

        try {
            const validated = NotesCardSchema.parse(card);
            eventBus.publishEvent('notes.card', validated, 'operatorNoteTaker');
        } catch (error) {
            this.logger.error('Card emission error:', error);
        }
    }

    /**
     * 🚨 Emit alert
     */
    async emitAlert(level, message, context = {}) {
        const alert = {
            event: 'notes.alert',
            timestamp: new Date().toISOString(),
            level,
            message,
            context
        };

        try {
            const validated = NotesAlertSchema.parse(alert);
            eventBus.publishEvent('notes.alert', validated, 'operatorNoteTaker');
        } catch (error) {
            this.logger.error('Alert emission error:', error);
        }
    }

    /**
     * 📊 Update statistics
     */
    updateStats(appendTimeMs, lineCount, eventType) {
        this.state.stats.appends++;
        this.state.stats.totalAppendMs += appendTimeMs;
        
        // Update by kind stats
        const current = this.state.stats.byKind.get(eventType) || 0;
        this.state.stats.byKind.set(eventType, current + lineCount);
    }

    /**
     * ⏱️ Start periodic tasks
     */
    startPeriodicTasks() {
        // Clean idempotency cache every 10 minutes
        setInterval(() => {
            this.cleanupIdempotency();
        }, 600000);

        // Daily rollup check every hour
        setInterval(() => {
            this.checkDailyRollup();
        }, 3600000);

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

        for (const [noteKey, timestamp] of this.state.idempotencyCache.entries()) {
            if (now - timestamp > ttlMs) {
                this.state.idempotencyCache.delete(noteKey);
                cleaned++;
            }
        }

        if (cleaned > 0) {
            this.logger.info(`Cleaned ${cleaned} idempotency entries`);
        }
    }

    /**
     * 📅 Check if daily rollup is needed
     */
    async checkDailyRollup() {
        const now = new Date();
        const [hour, minute] = this.config.rollup.dailyRunAt.split(':').map(Number);
        
        if (now.getHours() === hour && now.getMinutes() === minute) {
            await this.performDailyRollup(now);
        }
    }

    /**
     * 📅 Perform daily rollup
     */
    async performDailyRollup(date) {
        try {
            const counts = {};
            for (const [kind, count] of this.state.stats.byKind.entries()) {
                counts[kind] = count;
            }
            
            const totalEvents = Object.values(counts).reduce((sum, count) => sum + count, 0);
            const summary = totalEvents > 0 ? 
                `Günlük özet: ${totalEvents} olay işlendi` : 
                this.config.rollup.emptyDayNote;
            
            await this.markdownWriter.updateDaily(date, summary, counts);
            
            // Emit daily md event
            const dailyMd = {
                event: 'notes.daily.md',
                timestamp: new Date().toISOString(),
                path: this.markdownWriter.getDailyPath(date),
                summary,
                counts
            };

            const validated = NotesDailyMdSchema.parse(dailyMd);
            eventBus.publishEvent('notes.daily.md', validated, 'operatorNoteTaker');
            
            this.state.stats.dailyRollups++;
            this.logger.info(`Daily rollup completed: ${summary}`);
            
        } catch (error) {
            this.logger.error('Daily rollup error:', error);
            await this.emitAlert('error', 'daily_rollup_failed', { error: error.message });
        }
    }

    /**
     * 🏷️ Extract symbol from session ID
     */
    extractSymbolFromSessionId(sessionId) {
        const match = sessionId.match(/sess-([A-Z]{3,4})-/);
        return match ? match[1] : null;
    }

    /**
     * 📊 Emit metrics
     */
    emitMetrics() {
        const avgAppendMs = this.state.stats.appends > 0 ? 
            this.state.stats.totalAppendMs / this.state.stats.appends : 0;
        
        const dedupeRate = this.state.stats.appends > 0 ?
            this.state.stats.dedupeCount / (this.state.stats.appends + this.state.stats.dedupeCount) : 0;

        const byKind = {};
        for (const [kind, count] of this.state.stats.byKind.entries()) {
            byKind[kind] = count;
        }

        const metrics = {
            event: 'notes.metrics',
            timestamp: new Date().toISOString(),
            appends: this.state.stats.appends,
            sessions: 1, // TODO: track unique sessions
            dailyRollups: this.state.stats.dailyRollups,
            avgAppendMs: Number(avgAppendMs.toFixed(1)),
            writeErrors: this.state.stats.writeErrors,
            dedupeRate: Number(dedupeRate.toFixed(3)),
            byKind
        };

        try {
            const validated = NotesMetricsSchema.parse(metrics);
            eventBus.publishEvent('notes.metrics', validated, 'operatorNoteTaker');
        } catch (error) {
            this.logger.error('Metrics emission error:', error);
        }
    }

    /**
     * 📊 Get system status
     */
    getStatus() {
        return {
            name: this.name,
            initialized: this.isInitialized,
            recentEvents: this.state.recentEvents.length,
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
            
            // Clear caches
            this.state.recentEvents.length = 0;
            this.state.idempotencyCache.clear();
            this.state.stats.byKind.clear();
            
            this.isInitialized = false;
            this.logger.info(`${this.name} başarıyla kapatıldı`);
        } catch (error) {
            this.logger.error(`${this.name} kapatma hatası:`, error);
        }
    }
}

module.exports = {
    OperatorNoteTaker,
    operatorNoteTaker: new OperatorNoteTaker(),
    NoteLineBuilder,
    MarkdownWriter
};