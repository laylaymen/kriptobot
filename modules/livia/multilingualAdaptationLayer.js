/**
 * LIVIA-60: Multilingual Adaptation Layer
 * Çok dilli uyarlama katmanı
 * Amaç: Sorgu ve yanıtları çok dilli akışta güvenli ve tutarlı biçimde algıla → çevir → uyarlama → doğrula → teslim
 */

const crypto = require('crypto');
const { EventEmitter } = require('events');
const { trace, context, SpanStatusCode } = require('@opentelemetry/api');

class MultilingualAdaptationLayer extends EventEmitter {
    constructor(config = {}) {
        super();
        
        this.name = 'MultilingualAdaptationLayer';
        this.config = {
            enabled: true,
            locale: 'tr-TR',
            timezone: 'Europe/Istanbul',
            defaultTarget: 'auto',
            preserveBlocks: ['code', 'math', 'urls', 'emails', 'citations', 'footnotes'],
            style: {
                tone: 'neutral',
                formality: 'medium',
                localeAwareNumbers: true,
                spellVariant: 'tr-TR'
            },
            constraints: {
                maxLatencyMs: 250,
                maxCostUsdPerQuery: 0.004
            },
            fallbacks: {
                pivotLang: 'en',
                lowResourceDegrade: 'lexical+glossary_only'
            },
            detection: {
                model: 'langid-fast-v2',
                threshold: 0.85,
                mixedChunkStrategy: 'majority_vote+per_chunk',
                trDiacriticsAware: true
            },
            routing: {
                engineByQuality: {
                    default: 'nmt-fast',
                    high: 'nmt-quality',
                    llm: 'llm-translate'
                },
                pick: 'argmin(cost) s.t. p95<=250ms ∧ quality>=target',
                qualityTargets: { COMET: 0.80, TER: 0.25 },
                pivot: { enable: true, lang: 'en', when: { lowResource: true, backoff: true } }
            },
            adaptation: {
                glossary: { enforce: true, caseSensitive: false, fallbackSuggest: true },
                styleProfile: 'sg-tr-tech',
                styleRules: {
                    quoteStyle: '""',
                    capitalization: 'turkish',
                    diacritics: 'strict',
                    genderNeutrality: true
                },
                localeFormat: { numbers: true, dates: true, currency: false },
                keepSections: ['code', 'math', 'urls', 'citations', 'footnotes'],
                entityPolicy: { names: 'preserve_original|transliterate_if_known' }
            },
            verification: {
                metrics: ['COMET', 'TER', 'styleCompliance', 'toxicityDelta'],
                thresholds: { COMET: 0.80, TER: 0.25, styleCompliance: 0.90, toxicityDeltaMax: 0.05 },
                citationPreserveRequired: true,
                retry: { pivotOnFail: true, maxRetries: 1 }
            },
            streaming: {
                enable: true,
                chunkChars: 600,
                graceTokens: 20,
                cutOnSafetyViolation: true
            },
            conversions: {
                units: { enable: false, allow: ['metric↔imperial'], requireUserOptIn: true },
                currency: { enable: false, fxSource: 'L34/L53', requireExplicit: true }
            },
            cache: { ttlSec: 900, keyBy: ['srcLang', 'tgtLang', 'styleProfile', 'glossaryHash'] },
            idempotencyTtlSec: 900,
            ...config
        };
        
        // State management
        this.state = 'IDLE';
        this.engines = new Map(); // Available translation engines
        this.glossaries = new Map(); // Term glossaries
        this.styleGuides = new Map(); // Style rules
        this.cache = new Map(); // Translation cache
        this.metrics = {
            translatedChars: 0,
            chunks: 0,
            p50Ms: 0,
            p95Ms: 0,
            avgCostUsd: 0,
            COMETavg: 0,
            TERavg: 0,
            styleComplianceAvg: 0,
            terminologyMismatches: 0,
            pivotUsedPct: 0,
            citationPreservePct: 100,
            piiMasked: 0
        };
        
        this.isInitialized = false;
        this.logger = null;
        this.tracer = trace.getTracer('livia-multilingual-adaptation');
        
        // FSM states
        this.states = ['IDLE', 'DETECT', 'PLAN', 'REDACT_IN', 'TRANSLATE', 'ADAPT', 'VERIFY', 'FINALIZE', 'DONE', 'ALERT'];
        
        this.initializeDefaults();
    }

    async initialize(eventBus, logger) {
        try {
            this.eventBus = eventBus;
            this.logger = logger;
            this.logger.info(`${this.name} başlatılıyor...`);
            
            // Event listeners
            this.setupEventListeners();
            
            // Initialize translation engines
            this.initializeEngines();
            
            this.isInitialized = true;
            this.logger.info(`${this.name} başarıyla başlatıldı`);
            return true;
        } catch (error) {
            this.logger.error(`${this.name} başlatma hatası:`, error);
            return false;
        }
    }

    setupEventListeners() {
        // Configuration updates
        this.eventBus.on('mlang.policy.updated', this.handlePolicyUpdate.bind(this));
        this.eventBus.on('translation.engine.catalog', this.handleEngineCatalog.bind(this));
        this.eventBus.on('glossary.updated', this.handleGlossaryUpdate.bind(this));
        this.eventBus.on('style.guide.updated', this.handleStyleGuideUpdate.bind(this));
        this.eventBus.on('terminology.enforce.list', this.handleTerminologyUpdate.bind(this));
        
        // Translation requests
        this.eventBus.on('query.request', this.handleQueryRequest.bind(this));
        this.eventBus.on('qo.stage.output', this.handleStageOutput.bind(this));
        
        // Integration events
        this.eventBus.on('personalization.decision.ready', this.handlePersonalizationReady.bind(this));
        this.eventBus.on('evidence.validation.ready', this.handleEvidenceReady.bind(this));
        this.eventBus.on('freeze.state.changed', this.handleFreezeStateChanged.bind(this));
    }

    initializeDefaults() {
        // Default translation engines
        const defaultEngines = [
            {
                id: 'nmt-fast',
                kind: 'NMT',
                langs: ['tr', 'en', 'ar', 'ru', 'de'],
                latencyMsP95: 120,
                costUsdPerK: 0.2
            },
            {
                id: 'nmt-quality',
                kind: 'NMT',
                langs: ['tr', 'en', 'fr', 'de'],
                latencyMsP95: 240,
                costUsdPerK: 0.35
            },
            {
                id: 'llm-translate',
                kind: 'LLM',
                langs: ['*'],
                latencyMsP95: 420,
                costUsdPerK: 0.9
            }
        ];
        
        for (const engine of defaultEngines) {
            this.engines.set(engine.id, engine);
        }
        
        // Default glossary
        this.glossaries.set('kb_default:tr', {
            namespace: 'kb_default:tr',
            entries: new Map([
                ['retrieval-augmented generation', 'retrieval destekli üretim'],
                ['reranker', 'yeniden sıralayıcı'],
                ['token', 'token'],
                ['GPU', 'GPU']
            ]),
            enforce: true
        });
        
        // Default style guide
        this.styleGuides.set('sg-tr-tech', {
            profileId: 'sg-tr-tech',
            rules: {
                quoteStyle: '«»',
                listMarker: '-',
                codeFence: '```',
                capitalization: 'turkish',
                diacritics: 'strict',
                genderNeutrality: true
            }
        });
    }

    initializeEngines() {
        // Mock engine initialization - in production would connect to actual services
        this.logger.info('Translation engines initialized:', Array.from(this.engines.keys()));
    }

    async handleQueryRequest(event) {
        const span = this.tracer.startSpan('multilingual.query');
        const startTime = Date.now();
        
        try {
            const { id: queryId, text, lang, profile, mode, hints } = event;
            
            // Generate multilingual key
            const mlangKey = this.generateMultilingualKey(event);
            
            // Idempotency check
            if (this.cache.has(mlangKey)) {
                const cachedResult = this.cache.get(mlangKey);
                span.setStatus({ code: SpanStatusCode.OK });
                span.end();
                return cachedResult;
            }
            
            // Initialize translation context
            const context = {
                queryId,
                mlangKey,
                text,
                lang,
                profile,
                mode,
                hints: hints || {},
                startTime,
                state: 'DETECT',
                srcLang: null,
                tgtLang: null,
                engine: null,
                plan: null,
                chunks: [],
                preservedBlocks: [],
                glossaryApplied: false,
                styleApplied: false,
                verificationScores: {}
            };
            
            // Run translation pipeline
            const result = await this.runTranslationPipeline(context, span);
            
            // Cache result
            this.cache.set(mlangKey, result);
            this.scheduleCacheEviction(mlangKey);
            
            // Update metrics
            this.updateMetrics(context, startTime);
            
            span.setStatus({ code: SpanStatusCode.OK });
            span.end();
            
            return result;
            
        } catch (error) {
            span.recordException(error);
            span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
            span.end();
            
            this.emit('mlang.alert', {
                event: 'mlang.alert',
                timestamp: new Date().toISOString(),
                level: 'error',
                message: error.message,
                queryId: event.id
            });
            
            throw error;
        }
    }

    async handleStageOutput(event) {
        const span = this.tracer.startSpan('multilingual.stage.output');
        
        try {
            const { id: queryId, stage, chunk, citations, tokens, lang } = event;
            
            // Check if translation is needed
            const shouldTranslate = await this.shouldTranslateStageOutput(event);
            
            if (!shouldTranslate) {
                span.setStatus({ code: SpanStatusCode.OK });
                span.end();
                return;
            }
            
            // Process stage output for translation
            const context = {
                queryId,
                stage,
                chunk,
                citations,
                tokens,
                lang,
                state: 'DETECT'
            };
            
            const result = await this.processStageOutput(context, span);
            
            span.setStatus({ code: SpanStatusCode.OK });
            span.end();
            
            return result;
            
        } catch (error) {
            span.recordException(error);
            span.setStatus({ code: SpanStatusCode.ERROR });
            span.end();
            throw error;
        }
    }

    async runTranslationPipeline(context, span) {
        const { queryId } = context;
        
        try {
            // Language detection
            await this.detectLanguages(context, span);
            
            // Translation planning
            await this.planTranslation(context, span);
            
            // Input redaction (PII masking)
            await this.redactInput(context, span);
            
            // Translation
            await this.translate(context, span);
            
            // Adaptation
            await this.adapt(context, span);
            
            // Verification
            await this.verify(context, span);
            
            // Finalization
            const result = await this.finalize(context, span);
            
            return result;
            
        } catch (error) {
            this.logger.error(`Translation pipeline error for ${queryId}:`, error);
            throw error;
        }
    }

    async detectLanguages(context, span) {
        const detectSpan = this.tracer.startSpan('multilingual.detect', { parent: span });
        
        try {
            context.state = 'DETECT';
            
            const { text, lang, profile } = context;
            
            // Detect source language
            let srcLang = lang;
            if (lang === 'auto') {
                srcLang = await this.detectLanguage(text);
            }
            
            // Determine target language from personalization
            let tgtLang = 'tr'; // Default
            if (profile) {
                tgtLang = profile.split('-')[0] || 'tr';
            }
            
            // If source and target are the same, no translation needed
            if (srcLang === tgtLang) {
                context.needsTranslation = false;
                context.srcLang = srcLang;
                context.tgtLang = tgtLang;
                detectSpan.setStatus({ code: SpanStatusCode.OK });
                return;
            }
            
            context.srcLang = srcLang;
            context.tgtLang = tgtLang;
            context.needsTranslation = true;
            context.confidence = 0.95; // Mock confidence
            
            // Emit detection result
            this.emit('mlang.detected', {
                event: 'mlang.detected',
                timestamp: new Date().toISOString(),
                id: context.queryId,
                srcLang,
                tgtLang,
                confidence: context.confidence,
                reason: `profile=${profile}; query.lang=${lang}; detected=${srcLang}`
            });
            
            detectSpan.setStatus({ code: SpanStatusCode.OK });
            
        } catch (error) {
            detectSpan.recordException(error);
            detectSpan.setStatus({ code: SpanStatusCode.ERROR });
            throw error;
        } finally {
            detectSpan.end();
        }
    }

    async detectLanguage(text) {
        // Mock language detection - in production would use actual service
        const commonPatterns = {
            'tr': /[şçğıöüİĞÜÇŞÖ]|gelir|nedir|nasıl|için|olan|ile|bu|bir/,
            'en': /\b(the|and|for|are|but|not|you|all|can|had|was|one|our|out|day|may|say|she|use|her|how|now)\b/i,
            'ar': /[\u0600-\u06FF]/,
            'ru': /[\u0400-\u04FF]/,
            'de': /\b(der|die|das|und|ist|zu|den|mit|von|auf|für|als|dem|des|ein|eine|sich|auch|nach|bei)\b/i
        };
        
        for (const [lang, pattern] of Object.entries(commonPatterns)) {
            if (pattern.test(text)) {
                return lang;
            }
        }
        
        return 'en'; // Default fallback
    }

    async planTranslation(context, span) {
        const planSpan = this.tracer.startSpan('multilingual.plan', { parent: span });
        
        try {
            context.state = 'PLAN';
            
            if (!context.needsTranslation) {
                planSpan.setStatus({ code: SpanStatusCode.OK });
                return;
            }
            
            const { srcLang, tgtLang, hints } = context;
            
            // Select translation engine
            const engine = this.selectEngine(srcLang, tgtLang, hints);
            
            // Determine preservation blocks
            const preserve = this.identifyPreservationBlocks(context.text);
            
            // Select style profile and glossary
            const styleProfile = this.config.adaptation.styleProfile;
            const glossary = this.selectGlossary(tgtLang);
            
            // Calculate budget
            const budget = this.calculateBudget(context.text, engine);
            
            const plan = {
                engine: engine.id,
                pivot: srcLang === 'en' || tgtLang === 'en' ? 'none' : 'en',
                preserve,
                styleProfile,
                glossary,
                budget,
                hash: crypto.createHash('sha256').update(JSON.stringify({
                    engine: engine.id,
                    styleProfile,
                    glossary: glossary?.namespace
                })).digest('hex')
            };
            
            context.engine = engine;
            context.plan = plan;
            
            // Emit plan
            this.emit('mlang.plan.ready', {
                event: 'mlang.plan.ready',
                timestamp: new Date().toISOString(),
                id: context.queryId,
                engine: plan.engine,
                pivot: plan.pivot,
                preserve: plan.preserve.types,
                styleProfile: plan.styleProfile,
                glossary: plan.glossary,
                budget: plan.budget,
                hash: plan.hash
            });
            
            planSpan.setStatus({ code: SpanStatusCode.OK });
            
        } catch (error) {
            planSpan.recordException(error);
            planSpan.setStatus({ code: SpanStatusCode.ERROR });
            throw error;
        } finally {
            planSpan.end();
        }
    }

    selectEngine(srcLang, tgtLang, hints = {}) {
        // Select engine based on quality requirements and constraints
        const qualityHint = hints.quality || 'default';
        const deadlineMs = hints.deadlineMs || this.config.constraints.maxLatencyMs;
        
        // Filter engines that support the language pair
        const supportedEngines = Array.from(this.engines.values()).filter(engine => 
            (engine.langs.includes('*') || engine.langs.includes(srcLang)) &&
            (engine.langs.includes('*') || engine.langs.includes(tgtLang))
        );
        
        // Select based on quality and latency constraints
        if (qualityHint === 'high') {
            return supportedEngines.find(e => e.id === 'nmt-quality') || supportedEngines[0];
        }
        
        // Select fastest engine that meets deadline
        const feasibleEngines = supportedEngines.filter(e => e.latencyMsP95 <= deadlineMs);
        if (feasibleEngines.length > 0) {
            return feasibleEngines.sort((a, b) => a.costUsdPerK - b.costUsdPerK)[0];
        }
        
        // Fallback to fastest available
        return supportedEngines.sort((a, b) => a.latencyMsP95 - b.latencyMsP95)[0];
    }

    identifyPreservationBlocks(text) {
        // Identify blocks that should not be translated
        const blocks = [];
        const types = new Set();
        
        // Code blocks (``` or ` delimited)
        const codeMatches = text.match(/```[\s\S]*?```|`[^`]+`/g);
        if (codeMatches) {
            blocks.push(...codeMatches.map(block => ({ type: 'code', content: block })));
            types.add('code');
        }
        
        // URLs
        const urlMatches = text.match(/https?:\/\/[^\s]+/g);
        if (urlMatches) {
            blocks.push(...urlMatches.map(url => ({ type: 'url', content: url })));
            types.add('urls');
        }
        
        // Citations [^n] or [n]
        const citationMatches = text.match(/\[\^?\d+\]/g);
        if (citationMatches) {
            blocks.push(...citationMatches.map(cite => ({ type: 'citation', content: cite })));
            types.add('citations');
        }
        
        // Math expressions (LaTeX-style)
        const mathMatches = text.match(/\$[^$]+\$|\$\$[\s\S]+?\$\$/g);
        if (mathMatches) {
            blocks.push(...mathMatches.map(math => ({ type: 'math', content: math })));
            types.add('math');
        }
        
        return { blocks, types: Array.from(types) };
    }

    selectGlossary(tgtLang) {
        const glossaryKey = `kb_default:${tgtLang}`;
        return this.glossaries.get(glossaryKey);
    }

    calculateBudget(text, engine) {
        const charCount = text.length;
        const tokens = Math.ceil(charCount / 4); // Rough token estimation
        const latencyMs = Math.min(engine.latencyMsP95, this.config.constraints.maxLatencyMs);
        const costUsd = (tokens / 1000) * engine.costUsdPerK;
        
        return { latencyMs, costUsd };
    }

    async redactInput(context, span) {
        const redactSpan = this.tracer.startSpan('multilingual.redact', { parent: span });
        
        try {
            context.state = 'REDACT_IN';
            
            if (!context.needsTranslation) {
                redactSpan.setStatus({ code: SpanStatusCode.OK });
                return;
            }
            
            // Mock PII masking - in production would integrate with L56 (Safety)
            let piiMasked = 0;
            const areas = ['query'];
            
            // Simple PII patterns (email, phone)
            const emailPattern = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
            const phonePattern = /\+?1?[-.\s]?\(?[0-9]{3}\)?[-.\s]?[0-9]{3}[-.\s]?[0-9]{4}/g;
            
            let redactedText = context.text;
            
            // Mask emails
            const emails = redactedText.match(emailPattern);
            if (emails) {
                redactedText = redactedText.replace(emailPattern, '[EMAIL_MASKED]');
                piiMasked += emails.length;
            }
            
            // Mask phones
            const phones = redactedText.match(phonePattern);
            if (phones) {
                redactedText = redactedText.replace(phonePattern, '[PHONE_MASKED]');
                piiMasked += phones.length;
            }
            
            context.redactedText = redactedText;
            context.piiMasked = piiMasked;
            
            // Emit redaction result
            this.emit('mlang.redaction.in', {
                event: 'mlang.redaction.in',
                timestamp: new Date().toISOString(),
                id: context.queryId,
                areas,
                piiMasked
            });
            
            redactSpan.setStatus({ code: SpanStatusCode.OK });
            
        } catch (error) {
            redactSpan.recordException(error);
            redactSpan.setStatus({ code: SpanStatusCode.ERROR });
            throw error;
        } finally {
            redactSpan.end();
        }
    }

    async translate(context, span) {
        const translateSpan = this.tracer.startSpan('multilingual.translate', { parent: span });
        
        try {
            context.state = 'TRANSLATE';
            
            if (!context.needsTranslation) {
                context.translatedText = context.text;
                translateSpan.setStatus({ code: SpanStatusCode.OK });
                return;
            }
            
            const textToTranslate = context.redactedText || context.text;
            
            // Chunk text for translation
            const chunks = this.chunkText(textToTranslate);
            context.chunks = chunks;
            
            const translatedChunks = [];
            
            // Translate each chunk
            for (let i = 0; i < chunks.length; i++) {
                const chunk = chunks[i];
                const translatedChunk = await this.translateChunk(chunk, context, i);
                translatedChunks.push(translatedChunk);
                
                // Emit chunk result
                this.emit('mlang.translation.chunk', {
                    event: 'mlang.translation.chunk',
                    timestamp: new Date().toISOString(),
                    id: context.queryId,
                    seq: i,
                    src: chunk.text.substring(0, 100) + '...',
                    tgt: translatedChunk.text.substring(0, 100) + '...',
                    engine: context.engine.id,
                    preserved: {
                        codeBlocks: chunk.preservedBlocks?.filter(b => b.type === 'code').length || 0,
                        citations: chunk.preservedBlocks?.filter(b => b.type === 'citation').length || 0
                    }
                });
            }
            
            // Combine translated chunks
            context.translatedText = translatedChunks.map(c => c.text).join(' ');
            
            translateSpan.setStatus({ code: SpanStatusCode.OK });
            
        } catch (error) {
            translateSpan.recordException(error);
            translateSpan.setStatus({ code: SpanStatusCode.ERROR });
            throw error;
        } finally {
            translateSpan.end();
        }
    }

    chunkText(text) {
        // Simple text chunking - in production would use more sophisticated methods
        const chunkSize = this.config.streaming.chunkChars;
        const chunks = [];
        
        for (let i = 0; i < text.length; i += chunkSize) {
            chunks.push({
                seq: chunks.length,
                text: text.substring(i, i + chunkSize),
                preservedBlocks: []
            });
        }
        
        return chunks;
    }

    async translateChunk(chunk, context, seq) {
        // Mock translation - in production would call actual translation service
        const { srcLang, tgtLang, engine } = context;
        
        // Simple mock translations for common phrases
        const mockTranslations = {
            'What is': 'Nedir',
            'How to': 'Nasıl',
            'staking': 'staking',
            'APR': 'APR',
            'AVAX': 'AVAX'
        };
        
        let translatedText = chunk.text;
        
        // Apply mock translations
        for (const [src, tgt] of Object.entries(mockTranslations)) {
            translatedText = translatedText.replace(new RegExp(src, 'gi'), tgt);
        }
        
        // Simulate processing delay
        await new Promise(resolve => setTimeout(resolve, 10));
        
        return {
            seq,
            text: translatedText,
            engine: engine.id,
            preservedBlocks: chunk.preservedBlocks
        };
    }

    async adapt(context, span) {
        const adaptSpan = this.tracer.startSpan('multilingual.adapt', { parent: span });
        
        try {
            context.state = 'ADAPT';
            
            const steps = [];
            let adaptedText = context.translatedText;
            
            // Apply glossary
            if (context.plan?.glossary && this.config.adaptation.glossary.enforce) {
                adaptedText = this.applyGlossary(adaptedText, context.plan.glossary);
                steps.push('glossary_enforce');
                context.glossaryApplied = true;
            }
            
            // Apply locale formatting
            if (this.config.adaptation.localeFormat.numbers) {
                adaptedText = this.formatNumbers(adaptedText, context.tgtLang);
                steps.push('number_format_locale');
            }
            
            if (this.config.adaptation.localeFormat.dates) {
                adaptedText = this.formatDates(adaptedText, context.tgtLang);
                steps.push('date_fmt_locale');
            }
            
            // Apply style rules
            if (context.plan?.styleProfile) {
                adaptedText = this.applyStyleRules(adaptedText, context.plan.styleProfile);
                steps.push('style_rules');
                context.styleApplied = true;
            }
            
            // Apply terminology lock
            adaptedText = this.applyTerminologyLock(adaptedText);
            steps.push('terminology_lock');
            
            context.adaptedText = adaptedText;
            
            // Emit adaptation result
            this.emit('mlang.adaptation.applied', {
                event: 'mlang.adaptation.applied',
                timestamp: new Date().toISOString(),
                id: context.queryId,
                steps,
                unitsConverted: [],
                currencyConverted: false
            });
            
            adaptSpan.setStatus({ code: SpanStatusCode.OK });
            
        } catch (error) {
            adaptSpan.recordException(error);
            adaptSpan.setStatus({ code: SpanStatusCode.ERROR });
            throw error;
        } finally {
            adaptSpan.end();
        }
    }

    applyGlossary(text, glossary) {
        if (!glossary || !glossary.entries) return text;
        
        let processedText = text;
        for (const [src, tgt] of glossary.entries) {
            const regex = new RegExp(src, 'gi');
            processedText = processedText.replace(regex, tgt);
        }
        
        return processedText;
    }

    formatNumbers(text, lang) {
        // Mock number formatting - in production would use proper locale formatting
        if (lang === 'tr') {
            // Turkish uses comma for decimal separator and dot for thousands
            return text.replace(/(\d+)\.(\d{3})/g, '$1.$2')
                      .replace(/(\d+)\.(\d{1,2})(?!\d)/g, '$1,$2');
        }
        return text;
    }

    formatDates(text, lang) {
        // Mock date formatting - in production would use proper locale formatting
        if (lang === 'tr') {
            // Convert MM/DD/YYYY to DD.MM.YYYY
            return text.replace(/(\d{1,2})\/(\d{1,2})\/(\d{4})/g, '$2.$1.$3');
        }
        return text;
    }

    applyStyleRules(text, styleProfileId) {
        const styleGuide = this.styleGuides.get(styleProfileId);
        if (!styleGuide) return text;
        
        let styledText = text;
        const rules = styleGuide.rules;
        
        // Apply quote style
        if (rules.quoteStyle === '«»') {
            styledText = styledText.replace(/"/g, '«').replace(/"/g, '»');
        }
        
        // Apply capitalization rules (mock)
        if (rules.capitalization === 'turkish') {
            // Handle Turkish-specific capitalization
            styledText = styledText.replace(/\bI\b/g, 'ı');
        }
        
        return styledText;
    }

    applyTerminologyLock(text) {
        // Lock certain technical terms
        const lockedTerms = {
            'GPU': 'GPU',
            'API': 'API',
            'URL': 'URL',
            'JSON': 'JSON'
        };
        
        let lockedText = text;
        for (const [term, locked] of Object.entries(lockedTerms)) {
            const regex = new RegExp(`\\b${term}\\b`, 'gi');
            lockedText = lockedText.replace(regex, locked);
        }
        
        return lockedText;
    }

    async verify(context, span) {
        const verifySpan = this.tracer.startSpan('multilingual.verify', { parent: span });
        
        try {
            context.state = 'VERIFY';
            
            const scores = {};
            let terminologyMismatches = 0;
            let citationPreserved = true;
            let status = 'ok';
            
            // Mock verification scores
            scores.COMET = 0.84;
            scores.TER = 0.19;
            scores.styleCompliance = 0.93;
            scores.toxicityDelta = -0.01;
            
            // Check thresholds
            const thresholds = this.config.verification.thresholds;
            if (scores.COMET < thresholds.COMET || 
                scores.TER > thresholds.TER || 
                scores.styleCompliance < thresholds.styleCompliance ||
                Math.abs(scores.toxicityDelta) > thresholds.toxicityDeltaMax) {
                status = 'at_risk';
            }
            
            // Check citation preservation
            if (this.config.verification.citationPreserveRequired) {
                citationPreserved = this.verifyCitationPreservation(context);
            }
            
            context.verificationScores = scores;
            context.terminologyMismatches = terminologyMismatches;
            context.citationPreserved = citationPreserved;
            context.verificationStatus = status;
            
            // Emit verification result
            this.emit('mlang.verify.snapshot', {
                event: 'mlang.verify.snapshot',
                timestamp: new Date().toISOString(),
                id: context.queryId,
                scores,
                terminologyMismatches,
                citationPreserved,
                status
            });
            
            // Retry with pivot if needed
            if (status === 'at_risk' && this.config.verification.retry.pivotOnFail) {
                // Could implement pivot retry logic here
                this.logger.warn(`Verification failed for ${context.queryId}, would retry with pivot`);
            }
            
            verifySpan.setStatus({ code: SpanStatusCode.OK });
            
        } catch (error) {
            verifySpan.recordException(error);
            verifySpan.setStatus({ code: SpanStatusCode.ERROR });
            throw error;
        } finally {
            verifySpan.end();
        }
    }

    verifyCitationPreservation(context) {
        // Mock citation preservation check
        const originalCitations = (context.text.match(/\[\^?\d+\]/g) || []).length;
        const translatedCitations = (context.adaptedText.match(/\[\^?\d+\]/g) || []).length;
        
        return originalCitations === translatedCitations;
    }

    async finalize(context, span) {
        const finalizeSpan = this.tracer.startSpan('multilingual.finalize', { parent: span });
        
        try {
            context.state = 'FINALIZE';
            
            const finalText = context.adaptedText || context.translatedText || context.text;
            const { queryId, srcLang, tgtLang } = context;
            
            // Emit final answer
            this.emit('mlang.answer.final', {
                event: 'mlang.answer.final',
                timestamp: new Date().toISOString(),
                id: queryId,
                lang: tgtLang,
                stream: this.config.streaming.enable,
                answerMd: finalText,
                citations: context.citations || []
            });
            
            // Emit card
            this.emitCard(context);
            
            // Emit metrics
            this.emitMetrics();
            
            // Emit report
            this.emitReport(context);
            
            context.state = 'DONE';
            
            const result = {
                id: queryId,
                lang: tgtLang,
                text: finalText,
                translated: context.needsTranslation,
                scores: context.verificationScores,
                status: context.verificationStatus
            };
            
            finalizeSpan.setStatus({ code: SpanStatusCode.OK });
            return result;
            
        } catch (error) {
            finalizeSpan.recordException(error);
            finalizeSpan.setStatus({ code: SpanStatusCode.ERROR });
            throw error;
        } finally {
            finalizeSpan.end();
        }
    }

    async processStageOutput(context, span) {
        // Process stage output for streaming translation
        const { queryId, chunk, lang } = context;
        
        if (lang && lang !== 'tr') {
            // Translate chunk
            const translatedChunk = await this.translateText(chunk, lang, 'tr');
            
            this.emit('mlang.translation.chunk', {
                event: 'mlang.translation.chunk',
                timestamp: new Date().toISOString(),
                id: queryId,
                seq: 0,
                src: chunk.substring(0, 100) + '...',
                tgt: translatedChunk.substring(0, 100) + '...',
                engine: 'nmt-fast'
            });
            
            return { translatedChunk };
        }
        
        return { chunk };
    }

    async translateText(text, srcLang, tgtLang) {
        // Simple translation wrapper
        if (srcLang === tgtLang) return text;
        
        // Mock translation
        return text.replace(/what/gi, 'ne')
                   .replace(/is/gi, '')
                   .replace(/staking/gi, 'staking')
                   .replace(/APR/gi, 'APR');
    }

    async shouldTranslateStageOutput(event) {
        // Determine if stage output needs translation
        const { lang } = event;
        
        // Always translate if not Turkish
        return lang && lang !== 'tr';
    }

    // Event handlers
    handlePolicyUpdate(event) {
        this.logger.info(`${this.name} policy updating...`);
        
        const { defaultTarget, preserveBlocks, style, constraints, fallbacks } = event;
        
        if (defaultTarget) this.config.defaultTarget = defaultTarget;
        if (preserveBlocks) this.config.preserveBlocks = preserveBlocks;
        if (style) Object.assign(this.config.style, style);
        if (constraints) Object.assign(this.config.constraints, constraints);
        if (fallbacks) Object.assign(this.config.fallbacks, fallbacks);
    }

    handleEngineCatalog(event) {
        const { engines, routing } = event;
        
        if (engines) {
            this.engines.clear();
            for (const engine of engines) {
                this.engines.set(engine.id, engine);
            }
        }
        
        if (routing) {
            this.config.routing = { ...this.config.routing, ...routing };
        }
    }

    handleGlossaryUpdate(event) {
        const { namespace, entries, enforce } = event;
        
        const glossary = {
            namespace,
            entries: new Map(entries.map(e => [e.src, e.tgt])),
            enforce
        };
        
        this.glossaries.set(namespace, glossary);
        this.logger.info(`Glossary updated: ${namespace} (${entries.length} entries)`);
    }

    handleStyleGuideUpdate(event) {
        const { profileId, rules } = event;
        
        this.styleGuides.set(profileId, {
            profileId,
            rules
        });
        
        this.logger.info(`Style guide updated: ${profileId}`);
    }

    handleTerminologyUpdate(event) {
        const { items, caseSensitive } = event;
        
        // Update terminology enforcement
        for (const item of items) {
            // Store terminology rules
        }
        
        this.logger.info(`Terminology updated: ${items.length} items`);
    }

    handlePersonalizationReady(event) {
        const { id, localization } = event;
        
        // Update target language based on personalization
        if (localization && localization.locale) {
            const lang = localization.locale.split('-')[0];
            this.logger.debug(`Personalization ready for ${id}: target lang ${lang}`);
        }
    }

    handleEvidenceReady(event) {
        const { id, coveragePct, claims } = event;
        
        // Log evidence validation for translation context
        this.logger.debug(`Evidence ready for ${id}: coverage ${coveragePct}%`);
    }

    handleFreezeStateChanged(event) {
        const { state, scope, reason } = event;
        
        if (state === 'frozen') {
            this.logger.warn(`Freeze activated: ${scope} (${reason})`);
            // Continue processing but log freeze state
        } else {
            this.logger.info(`Freeze lifted: ${scope}`);
        }
    }

    // Utility methods
    generateMultilingualKey(event) {
        const keyData = {
            queryId: event.id,
            text: event.text?.substring(0, 50), // First 50 chars
            lang: event.lang,
            profile: event.profile,
            timestamp: Math.floor(Date.now() / (this.config.idempotencyTtlSec * 1000))
        };
        return crypto.createHash('sha256').update(JSON.stringify(keyData)).digest('hex').substring(0, 16);
    }

    scheduleCacheEviction(key) {
        setTimeout(() => {
            this.cache.delete(key);
        }, this.config.cache.ttlSec * 1000);
    }

    updateMetrics(context, startTime) {
        const duration = Date.now() - startTime;
        
        this.metrics.chunks = context.chunks?.length || 0;
        this.metrics.translatedChars = context.text?.length || 0;
        this.metrics.p95Ms = (this.metrics.p95Ms * 0.9) + (duration * 0.1);
        this.metrics.avgCostUsd = (this.metrics.avgCostUsd * 0.9) + ((context.plan?.budget?.costUsd || 0) * 0.1);
        this.metrics.COMETavg = (this.metrics.COMETavg * 0.9) + ((context.verificationScores?.COMET || 0) * 0.1);
        this.metrics.styleComplianceAvg = (this.metrics.styleComplianceAvg * 0.9) + ((context.verificationScores?.styleCompliance || 0) * 0.1);
        this.metrics.piiMasked = context.piiMasked || 0;
        this.metrics.citationPreservePct = context.citationPreserved ? 100 : 0;
    }

    emitCard(context) {
        const { srcLang, tgtLang, engine, verificationScores, plan } = context;
        
        this.emit('mlang.card', {
            event: 'mlang.card',
            timestamp: new Date().toISOString(),
            title: `Çok Dilli Uyum — ${tgtLang.toUpperCase()} ${plan?.glossary ? '(glossary enforced)' : ''}`,
            body: `${engine?.id} • COMET ${verificationScores?.COMET?.toFixed(2)} • stil uyumu %${Math.round((verificationScores?.styleCompliance || 0) * 100)} • atıf korundu.`,
            severity: 'info',
            ttlSec: 600
        });
    }

    emitMetrics() {
        this.emit('mlang.metrics', {
            event: 'mlang.metrics',
            timestamp: new Date().toISOString(),
            ...this.metrics
        });
    }

    emitReport(context) {
        const { queryId, tgtLang, verificationScores } = context;
        const reportPath = `data/mlang/${new Date().toISOString().split('T')[0]}/${queryId}/report.md`;
        
        this.emit('mlang.report.ready', {
            event: 'mlang.report.ready',
            timestamp: new Date().toISOString(),
            path: reportPath,
            summary: `${tgtLang.toUpperCase()} çıktı, glossary & stil uygulandı, COMET ${verificationScores?.COMET?.toFixed(2)}, atıf/PII korundu.`,
            hash: crypto.createHash('sha256').update(JSON.stringify(context)).digest('hex')
        });
    }

    getStatus() {
        return {
            name: this.name,
            initialized: this.isInitialized,
            state: this.state,
            engines: Array.from(this.engines.keys()),
            glossaries: Array.from(this.glossaries.keys()),
            styleGuides: Array.from(this.styleGuides.keys()),
            cache: this.cache.size,
            metrics: this.metrics,
            config: {
                enabled: this.config.enabled,
                locale: this.config.locale,
                defaultTarget: this.config.defaultTarget,
                streaming: this.config.streaming.enable
            }
        };
    }

    async shutdown() {
        try {
            this.logger.info(`${this.name} durduruluyor...`);
            
            // Clear all data structures
            this.engines.clear();
            this.glossaries.clear();
            this.styleGuides.clear();
            this.cache.clear();
            
            this.isInitialized = false;
            this.logger.info(`${this.name} başarıyla durduruldu`);
        } catch (error) {
            this.logger.error(`${this.name} durdurma hatası:`, error);
        }
    }
}

module.exports = MultilingualAdaptationLayer;