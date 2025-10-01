/**
 * LIVIA-56: Query Safety Guard
 * Sorgu/cevap akışında güvenlik ve uygunluk katmanı
 * Amaç: PII redaksiyonu, toksisite/nefret kontrolü, grounding denetimi, consent yönetimi
 */

const crypto = require('crypto');
const { EventEmitter } = require('events');
const { trace, context, SpanStatusCode } = require('@opentelemetry/api');

class QuerySafetyGuard extends EventEmitter {
    constructor(config = {}) {
        super();
        
        this.name = 'QuerySafetyGuard';
        this.config = {
            enabled: true,
            locale: 'tr-TR',
            timezone: 'Europe/Istanbul',
            classifiers: {
                toxicity: { model: 'fasttox-v2', thresholds: { low: 0.3, high: 0.7 } },
                hate: { model: 'safety-multi-v1', thresholds: { block: 0.6 } },
                self_harm: { model: 'safety-multi-v1', thresholds: { block: 0.5 } },
                illicit: { model: 'intent-guard-v1', thresholds: { block: 0.7, contextual: 0.4 } },
                sexual: { model: 'safety-multi-v1', thresholds: { block: 0.6, filter: 0.4 } },
                extremism: { model: 'safety-multi-v1', thresholds: { block: 0.5 } }
            },
            pii: {
                enable: true,
                confidenceMin: 0.85,
                redactStyle: 'hash',
                patterns: ['tckn', 'iban_tr', 'email', 'phone_tr', 'address', 'credit_card']
            },
            grounding: {
                requireCitationsFor: ['stats', 'dates', 'medical', 'legal', 'finance'],
                minCitationCoveragePct: 60,
                hallucinationScoreThreshold: 0.65,
                entailmentModel: 'entail-nli-mini',
                numericClaimHeuristics: true
            },
            streaming: {
                cutoffOnViolation: true,
                graceTokens: 20,
                replaceWithSafeAltTemplate: 'İçerikte risk tespit edildi; güvenli özet: {safe_summary}.'
            },
            consent: {
                categories: ['medical', 'legal', 'financial', 'geolocation', 'biometric'],
                ttlSec: 600,
                templates: {
                    medical: 'Tıbbi içerik için bilgilendirme onayı veriyor musunuz? (E/H)',
                    legal: 'Hukuki bilgi için yönlendirici içerik sunacağım; onaylıyor musunuz? (E/H)',
                    financial: 'Finansal bilgi için yönlendirici içerik sunacağım; onaylıyor musunuz? (E/H)'
                }
            },
            disclaimers: {
                medical: 'Bu yanıt tıbbi tavsiye niteliği taşımaz; uzman konsültasyonu önerilir.',
                legal: 'Bu yanıt hukuki danışmanlık değildir; avukat görüşü alınması önerilir.',
                financial: 'Bu yanıt finansal tavsiye değildir; finansal danışman görüşü önerilir.'
            },
            categories: {
                toxicity: 'block',
                hate: 'block',
                violence: 'filter',
                self_harm: 'block',
                illicit: 'block',
                sexual: 'filter',
                extremism: 'block',
                medical: 'consent',
                legal: 'consent',
                financial: 'consent',
                political: 'disclaimer',
                privacy: 'strict'
            },
            idempotencyTtlSec: 900,
            ...config
        };
        
        // State management
        this.state = 'IDLE';
        this.activeGuards = new Map(); // Active safety checks
        this.piiPatterns = new Map();
        this.consentCache = new Map();
        this.metrics = {
            guarded: 0,
            blocked: 0,
            cutoffs: 0,
            redactions: 0,
            avgPrecheckMs: 0,
            p95ScanMs: 0,
            groundingCoverageAvg: 0,
            hallucinationRiskAvg: 0,
            consentRequests: 0,
            exceptions: 0
        };
        
        this.isInitialized = false;
        this.logger = null;
        this.tracer = trace.getTracer('livia-query-safety-guard');
        
        // FSM states
        this.states = ['IDLE', 'PRECHECK', 'AWAIT_CONSENT', 'GUARD', 'GROUNDING', 'STREAM_GUARD', 'FINALIZE', 'DONE', 'BLOCKED', 'CUTOFF', 'ALERT'];
        
        // Initialize PII patterns
        this.initializePIIPatterns();
    }

    async initialize(eventBus, logger) {
        try {
            this.eventBus = eventBus;
            this.logger = logger;
            this.logger.info(`${this.name} başlatılıyor...`);
            
            // Event listeners
            this.setupEventListeners();
            
            this.isInitialized = true;
            this.logger.info(`${this.name} başarıyla başlatıldı`);
            return true;
        } catch (error) {
            this.logger.error(`${this.name} başlatma hatası:`, error);
            return false;
        }
    }

    setupEventListeners() {
        // Query safety checks
        this.eventBus.on('query.request', this.handleQueryRequest.bind(this));
        this.eventBus.on('qo.stage.output', this.handleStageOutput.bind(this));
        this.eventBus.on('retrieval.docs.snapshot', this.handleDocsSnapshot.bind(this));
        
        // Policy updates
        this.eventBus.on('safety.policy.updated', this.handlePolicyUpdate.bind(this));
        this.eventBus.on('pii.lexicon.updated', this.handlePIILexiconUpdate.bind(this));
        this.eventBus.on('consent.policy.updated', this.handleConsentPolicyUpdate.bind(this));
        
        // User consent
        this.eventBus.on('user.consent.event', this.handleUserConsent.bind(this));
        
        // Safety exceptions
        this.eventBus.on('safety.exception.request', this.handleSafetyException.bind(this));
    }

    initializePIIPatterns() {
        const defaultPatterns = {
            tckn: /\b\d{11}\b/g,
            iban_tr: /\bTR\d{24}\b/g,
            phone_tr: /\b\+?90\d{10}\b/g,
            email: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
            credit_card: /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g
        };
        
        for (const [pattern, regex] of Object.entries(defaultPatterns)) {
            this.piiPatterns.set(pattern, regex);
        }
    }

    async handleQueryRequest(event) {
        const span = this.tracer.startSpan('safety.precheck');
        const startTime = Date.now();
        
        try {
            const queryId = event.id;
            const safetyKey = this.generateSafetyKey(event);
            
            // Idempotency check
            if (this.activeGuards.has(safetyKey)) {
                const cachedResult = this.activeGuards.get(safetyKey);
                span.setStatus({ code: SpanStatusCode.OK });
                span.end();
                return cachedResult;
            }
            
            // Initialize safety context
            const safetyContext = {
                queryId,
                safetyKey,
                text: event.text,
                lang: event.lang || 'auto',
                mode: event.mode || 'answer',
                startTime,
                state: 'PRECHECK',
                labels: {},
                redactions: [],
                consentNeeded: [],
                violations: []
            };
            
            this.activeGuards.set(safetyKey, safetyContext);
            
            // Run precheck
            const result = await this.runPrecheck(safetyContext, span);
            
            // Emit precheck result
            this.emit('safety.precheck.ready', {
                event: 'safety.precheck.ready',
                timestamp: new Date().toISOString(),
                id: queryId,
                labels: result.labels,
                action: result.action
            });
            
            // Update metrics
            this.metrics.avgPrecheckMs = ((this.metrics.avgPrecheckMs * this.metrics.guarded) + (Date.now() - startTime)) / (this.metrics.guarded + 1);
            this.metrics.guarded++;
            
            span.setStatus({ code: SpanStatusCode.OK });
            span.end();
            
            return result;
            
        } catch (error) {
            span.recordException(error);
            span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
            span.end();
            
            this.emit('safety.alert', {
                event: 'safety.alert',
                timestamp: new Date().toISOString(),
                level: 'error',
                message: error.message,
                queryId: event.id
            });
            
            throw error;
        }
    }

    async runPrecheck(safetyContext, span) {
        const { queryId, text } = safetyContext;
        
        // Classify content
        const classifications = await this.classifyContent(text, span);
        safetyContext.labels = classifications;
        
        // Check for violations
        let action = 'allow';
        const violations = [];
        
        for (const [category, score] of Object.entries(classifications)) {
            const categoryConfig = this.config.categories[category];
            const thresholds = this.config.classifiers[category]?.thresholds || {};
            
            if (categoryConfig === 'block' && score > (thresholds.block || 0.6)) {
                violations.push({ category, score, action: 'block' });
                action = 'block';
            } else if (categoryConfig === 'filter' && score > (thresholds.filter || 0.4)) {
                violations.push({ category, score, action: 'filter' });
                if (action === 'allow') action = 'filter';
            } else if (categoryConfig === 'consent') {
                const consentCategory = this.mapToConsentCategory(category);
                if (consentCategory && !this.hasConsent(queryId, consentCategory)) {
                    violations.push({ category, score, action: 'consent_needed' });
                    action = 'consent_needed';
                    safetyContext.consentNeeded.push(consentCategory);
                }
            }
        }
        
        safetyContext.violations = violations;
        
        // Handle violations
        if (action === 'block') {
            await this.blockQuery(safetyContext);
        } else if (action === 'consent_needed') {
            await this.requestConsent(safetyContext);
        }
        
        // PII detection and redaction
        const piiRedactions = await this.detectAndRedactPII(text);
        if (piiRedactions.length > 0) {
            safetyContext.redactions = piiRedactions;
            this.emit('safety.redaction.applied', {
                event: 'safety.redaction.applied',
                timestamp: new Date().toISOString(),
                id: queryId,
                areas: ['query'],
                redactions: piiRedactions
            });
        }
        
        return {
            action,
            labels: classifications,
            violations,
            redactions: piiRedactions
        };
    }

    async classifyContent(text, span) {
        const classifySpan = this.tracer.startSpan('safety.classify', { parent: span });
        
        try {
            // Mock implementation - in production, would call ML models
            const classifications = {};
            
            // Simple keyword-based classification for demo
            const lowerText = text.toLowerCase();
            
            // Toxicity
            const toxicWords = ['aptal', 'salak', 'gerizekalı'];
            classifications.toxicity = toxicWords.some(word => lowerText.includes(word)) ? 0.8 : 0.1;
            
            // Hate speech
            const hateWords = ['nefret', 'öldür', 'yok et'];
            classifications.hate = hateWords.some(word => lowerText.includes(word)) ? 0.7 : 0.05;
            
            // Self harm
            const selfHarmWords = ['intihar', 'kendine zarar', 'ölmek istiyorum'];
            classifications.self_harm = selfHarmWords.some(word => lowerText.includes(word)) ? 0.9 : 0.02;
            
            // Medical content
            const medicalWords = ['hastalık', 'ilaç', 'tedavi', 'doktor', 'tıp'];
            classifications.medical = medicalWords.some(word => lowerText.includes(word)) ? 0.8 : 0.1;
            
            // Legal content
            const legalWords = ['hukuk', 'avukat', 'dava', 'yasa', 'mahkeme'];
            classifications.legal = legalWords.some(word => lowerText.includes(word)) ? 0.8 : 0.1;
            
            // Financial content
            const financialWords = ['yatırım', 'borsa', 'kripto', 'bitcoin', 'para', 'finans'];
            classifications.financial = financialWords.some(word => lowerText.includes(word)) ? 0.8 : 0.1;
            
            classifySpan.setStatus({ code: SpanStatusCode.OK });
            return classifications;
            
        } catch (error) {
            classifySpan.recordException(error);
            classifySpan.setStatus({ code: SpanStatusCode.ERROR });
            throw error;
        } finally {
            classifySpan.end();
        }
    }

    async detectAndRedactPII(text) {
        const redactions = [];
        
        for (const [patternName, regex] of this.piiPatterns.entries()) {
            let match;
            while ((match = regex.exec(text)) !== null) {
                const originalValue = match[0];
                let redactedValue;
                
                switch (this.config.pii.redactStyle) {
                    case 'hash':
                        redactedValue = `hash:${crypto.createHash('md5').update(originalValue).digest('hex').substring(0, 8)}`;
                        break;
                    case 'mask':
                        redactedValue = '*'.repeat(originalValue.length);
                        break;
                    case 'drop':
                        redactedValue = '[REDACTED]';
                        break;
                    default:
                        redactedValue = `[${patternName.toUpperCase()}]`;
                }
                
                redactions.push({
                    kind: patternName,
                    from: originalValue,
                    to: redactedValue,
                    confidence: 0.95
                });
            }
        }
        
        this.metrics.redactions += redactions.length;
        return redactions;
    }

    async blockQuery(safetyContext) {
        const { queryId, violations } = safetyContext;
        
        safetyContext.state = 'BLOCKED';
        this.metrics.blocked++;
        
        const primaryViolation = violations.find(v => v.action === 'block');
        
        this.emit('safety.violation.blocked', {
            event: 'safety.violation.blocked',
            timestamp: new Date().toISOString(),
            id: queryId,
            category: primaryViolation.category,
            message: 'policy_blocked',
            httpStatus: 403
        });
    }

    async requestConsent(safetyContext) {
        const { queryId, consentNeeded } = safetyContext;
        
        safetyContext.state = 'AWAIT_CONSENT';
        
        for (const category of consentNeeded) {
            const template = this.config.consent.templates[category];
            if (template) {
                this.emit('safety.consent.request', {
                    event: 'safety.consent.request',
                    timestamp: new Date().toISOString(),
                    id: queryId,
                    category,
                    prompt: template,
                    ttlSec: this.config.consent.ttlSec
                });
                
                this.metrics.consentRequests++;
            }
        }
    }

    async handleStageOutput(event) {
        const span = this.tracer.startSpan('safety.stream.guard');
        
        try {
            const { id: queryId, stage, chunk } = event;
            
            if (!chunk || stage !== 'synthesize') {
                span.end();
                return;
            }
            
            // Stream content analysis
            const violations = await this.analyzeStreamChunk(chunk);
            
            if (violations.length > 0 && this.config.streaming.cutoffOnViolation) {
                await this.applyCutoff(queryId, violations);
            }
            
            span.setStatus({ code: SpanStatusCode.OK });
            
        } catch (error) {
            span.recordException(error);
            span.setStatus({ code: SpanStatusCode.ERROR });
        } finally {
            span.end();
        }
    }

    async analyzeStreamChunk(chunk) {
        // Simple stream analysis
        const violations = [];
        const lowerChunk = chunk.toLowerCase();
        
        // Check for emerging violations in stream
        if (lowerChunk.includes('tehlikeli') || lowerChunk.includes('zararlı')) {
            violations.push({
                type: 'toxicity',
                score: 0.8,
                reason: 'dangerous_content'
            });
        }
        
        return violations;
    }

    async applyCutoff(queryId, violations) {
        this.metrics.cutoffs++;
        
        const primaryViolation = violations[0];
        
        this.emit('safety.stream.guard', {
            event: 'safety.stream.guard',
            timestamp: new Date().toISOString(),
            id: queryId,
            action: 'cutoff',
            reason: primaryViolation.reason,
            graceTokens: this.config.streaming.graceTokens
        });
    }

    async handleDocsSnapshot(event) {
        // Analyze retrieved documents for safety
        const { docs } = event;
        
        for (const doc of docs) {
            if (doc.chunk?.text) {
                const piiRedactions = await this.detectAndRedactPII(doc.chunk.text);
                if (piiRedactions.length > 0) {
                    // Apply redactions to document
                    doc.chunk.redacted = true;
                    doc.chunk.redactions = piiRedactions;
                }
            }
        }
    }

    handlePolicyUpdate(event) {
        this.logger.info(`${this.name} politika güncelleniyor...`);
        
        const { categories, pii, grounding, streaming } = event;
        
        if (categories) Object.assign(this.config.categories, categories);
        if (pii) Object.assign(this.config.pii, pii);
        if (grounding) Object.assign(this.config.grounding, grounding);
        if (streaming) Object.assign(this.config.streaming, streaming);
    }

    handlePIILexiconUpdate(event) {
        const { patterns } = event;
        
        for (const pattern of patterns) {
            try {
                const regex = new RegExp(pattern.regex, 'g');
                this.piiPatterns.set(pattern.code, regex);
            } catch (error) {
                this.logger.error(`Invalid PII regex pattern ${pattern.code}:`, error);
            }
        }
    }

    handleConsentPolicyUpdate(event) {
        const { requiresConsent, templates } = event;
        
        if (requiresConsent) {
            this.config.consent.categories = requiresConsent;
        }
        
        if (templates) {
            Object.assign(this.config.consent.templates, templates);
        }
    }

    handleUserConsent(event) {
        const { category, given, expiresAt, by } = event;
        
        if (given) {
            this.consentCache.set(`${by}:${category}`, {
                given: true,
                expiresAt: new Date(expiresAt),
                timestamp: new Date()
            });
        }
    }

    handleSafetyException(event) {
        const { reason, scope, requester, ttlMin } = event;
        
        this.logger.warn(`Safety exception requested: ${reason} by ${requester}`);
        
        // Grant exception with limited scope and TTL
        const exceptionId = crypto.randomBytes(8).toString('hex');
        
        // Store exception (in production, would be in database)
        setTimeout(() => {
            this.logger.info(`Safety exception ${exceptionId} expired`);
        }, ttlMin * 60 * 1000);
        
        this.metrics.exceptions++;
    }

    // Utility methods
    generateSafetyKey(event) {
        const keyData = {
            text: event.text,
            mode: event.mode,
            timestamp: Math.floor(Date.now() / (this.config.idempotencyTtlSec * 1000))
        };
        return crypto.createHash('sha256').update(JSON.stringify(keyData)).digest('hex').substring(0, 16);
    }

    mapToConsentCategory(category) {
        const mapping = {
            medical: 'medical',
            legal: 'legal',
            financial: 'financial'
        };
        return mapping[category];
    }

    hasConsent(queryId, category) {
        // Check consent cache (simplified)
        for (const [key, consent] of this.consentCache.entries()) {
            if (key.endsWith(`:${category}`) && consent.given && consent.expiresAt > new Date()) {
                return true;
            }
        }
        return false;
    }

    async emitCard(queryId, title, body, severity = 'info') {
        this.emit('safety.card', {
            event: 'safety.card',
            timestamp: new Date().toISOString(),
            title,
            body,
            severity,
            ttlSec: 600
        });
    }

    async emitMetrics() {
        this.emit('safety.metrics', {
            event: 'safety.metrics',
            timestamp: new Date().toISOString(),
            ...this.metrics
        });
    }

    getStatus() {
        return {
            name: this.name,
            initialized: this.isInitialized,
            state: this.state,
            activeGuards: this.activeGuards.size,
            piiPatterns: this.piiPatterns.size,
            consentCache: this.consentCache.size,
            metrics: this.metrics,
            config: {
                enabled: this.config.enabled,
                locale: this.config.locale,
                timezone: this.config.timezone,
                piiEnabled: this.config.pii.enable,
                streamingEnabled: this.config.streaming.cutoffOnViolation
            }
        };
    }

    async shutdown() {
        try {
            this.logger.info(`${this.name} durduruluyor...`);
            
            // Clear active guards
            this.activeGuards.clear();
            this.consentCache.clear();
            
            this.isInitialized = false;
            this.logger.info(`${this.name} başarıyla durduruldu`);
        } catch (error) {
            this.logger.error(`${this.name} durdurma hatası:`, error);
        }
    }
}

module.exports = QuerySafetyGuard;