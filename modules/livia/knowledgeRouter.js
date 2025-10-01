/**
 * LIVIA-07 · knowledgeRouter.js
 * Bilgi yönlendirici - RAG tabanlı politika/oyun kitabı/SSS sorgu sistemi
 * 
 * Amaç: Operatörün "Neden böyle oldu?/Politika ne diyor?/Oyun kitabı ne öneriyor?" 
 * tipi sorularını doğru belge ve pasaja yönlendirmek. Politika, oyun kitabı (playbook), 
 * SSS/FAQ ve senkronize KB içinden RAG yönlendirme yap; gerekirse çoklu pasaj ve özet dön.
 */

const { z } = require('zod');
const { createHash } = require('crypto');
const { eventBus } = require('../../kirpto bot sinyal/modules/modularEventStream');
const { logInfo, logError, logEvent } = require('../../kirpto bot sinyal/logs/logger');

/**
 * 🔄 Input Event Schemas
 */
const KnowledgeQuerySchema = z.object({
    event: z.literal('knowledge.query'),
    timestamp: z.string(),
    q: z.string().min(3),
    need: z.enum(['policy', 'playbook', 'faq', 'auto']),
    lang: z.enum(['tr', 'en']).optional(),
    context: z.object({
        symbol: z.string().optional(),
        guardMode: z.enum(['normal', 'slowdown', 'block_aggressive', 'halt_entry']).optional(),
        policyVersion: z.string().optional(),
        tags: z.array(z.string()).optional()
    }).optional(),
    prefs: z.object({
        maxPassages: z.number().int().min(1).max(5).optional(),
        maxCharsPerPassage: z.number().int().min(100).max(1000).optional(),
        citations: z.boolean().optional()
    }).optional(),
    auth: z.object({
        userId: z.string(),
        roles: z.array(z.string()),
        sig: z.string()
    })
});

const KBIndexSnapshotSchema = z.object({
    event: z.literal('kb.index.snapshot'),
    timestamp: z.string(),
    vectorReady: z.boolean(),
    stats: z.object({
        docs: z.number().int().min(0),
        chunks: z.number().int().min(0)
    })
});

const PolicySnapshotSchema = z.object({
    event: z.literal('policy.snapshot'),
    timestamp: z.string(),
    versionId: z.string(),
    effective: z.record(z.any())
});

/**
 * 📤 Output Event Schemas
 */
const KnowledgeRouteSelectSchema = z.object({
    event: z.literal('knowledge.route.select'),
    timestamp: z.string(),
    routeKey: z.string(),
    ok: z.boolean(),
    query: z.object({
        qNorm: z.string(),
        lang: z.string()
    }),
    top: z.array(z.object({
        docId: z.string(),
        source: z.string(),
        title: z.string(),
        score: z.number().min(0).max(1),
        passages: z.array(z.object({
            chunkId: z.string(),
            excerpt: z.string(),
            headings: z.array(z.string()),
            meta: z.record(z.any()).optional(),
            cit: z.object({
                href: z.string(),
                start: z.number().optional(),
                end: z.number().optional()
            })
        }))
    })),
    summary: z.string().optional(),
    audit: z.object({
        eventId: z.string(),
        producedBy: z.string(),
        producedAt: z.string()
    })
});

const KnowledgeRouteNohitSchema = z.object({
    event: z.literal('knowledge.route.nohit'),
    timestamp: z.string(),
    routeKey: z.string(),
    reason: z.enum(['low_score', 'not_allowed', 'empty_query', 'index_not_ready']),
    hint: z.string().optional()
});

/**
 * 🧠 Knowledge Document (Mock KB structure)
 */
class KnowledgeDocument {
    constructor(docData) {
        this.docId = docData.docId;
        this.source = docData.source;
        this.title = docData.title;
        this.version = docData.version;
        this.lang = docData.lang;
        this.tags = docData.tags || [];
        this.owners = docData.owners || [];
        this.visibility = docData.visibility || [];
        this.effective = docData.effective || {};
        this.chunks = docData.chunks || [];
        this.checksum = docData.checksum;
    }

    /**
     * Check if document is visible to user roles
     */
    isVisibleTo(userRoles) {
        if (this.visibility.length === 0) return true;
        return userRoles.some(role => this.visibility.includes(role));
    }

    /**
     * Get chunks matching query
     */
    getMatchingChunks(normalizedQuery, maxChunks = 2) {
        return this.chunks
            .filter(chunk => this.chunkMatches(chunk, normalizedQuery))
            .slice(0, maxChunks);
    }

    /**
     * Simple text matching for chunks
     */
    chunkMatches(chunk, query) {
        const chunkText = chunk.text.toLowerCase();
        const queryWords = query.toLowerCase().split(/\s+/);
        
        return queryWords.some(word => chunkText.includes(word));
    }
}

/**
 * 🔍 Text Normalizer
 */
class TextNormalizer {
    constructor(config) {
        this.config = config;
        this.stopwords = new Set(['bir', 'bu', 'şu', 'o', 'ne', 'neden', 'nasıl', 'kim', 'nerede', 'ne zaman']);
        this.synonyms = {
            'agresif': ['aggressive', 'saldırgan'],
            'muhafazakar': ['conservative', 'güvenli'],
            'slip': ['kayma', 'slipaj'],
            'spread': ['fark', 'yayılım']
        };
    }

    /**
     * Normalize query text
     */
    normalize(text) {
        if (!text) return '';
        
        // Lowercase and basic cleanup
        let normalized = text.toLowerCase()
            .replace(/[^\w\sıçğöşü]/gi, ' ')
            .replace(/\s+/g, ' ')
            .trim();

        // Remove stopwords
        const words = normalized.split(/\s+/)
            .filter(word => !this.stopwords.has(word));

        // Apply synonyms
        const expandedWords = [];
        for (const word of words) {
            expandedWords.push(word);
            if (this.synonyms[word]) {
                expandedWords.push(...this.synonyms[word]);
            }
        }

        return expandedWords.join(' ');
    }

    /**
     * Detect language (simplified)
     */
    detectLanguage(text) {
        const turkishChars = (text.match(/[ıçğöşü]/gi) || []).length;
        const englishChars = (text.match(/[a-z]/gi) || []).length;
        
        return turkishChars > englishChars * 0.1 ? 'tr' : 'en';
    }
}

/**
 * 🔗 Hybrid Search Engine
 */
class HybridSearchEngine {
    constructor(config) {
        this.config = config;
    }

    /**
     * Perform hybrid search (dense + sparse)
     */
    search(normalizedQuery, documents, filters = {}) {
        const candidates = this.filterDocuments(documents, filters);
        
        // Simplified scoring (in real implementation, would use embeddings + BM25)
        const scored = candidates.map(doc => ({
            doc,
            score: this.calculateScore(doc, normalizedQuery)
        }));

        // Sort by score and return top candidates
        return scored
            .sort((a, b) => b.score - a.score)
            .slice(0, this.config.retrieval.candidateK)
            .map(item => ({ ...item.doc, score: item.score }));
    }

    /**
     * Filter documents by source, visibility, etc.
     */
    filterDocuments(documents, filters) {
        return documents.filter(doc => {
            // Source filter
            if (filters.sources && !filters.sources.includes(doc.source)) {
                return false;
            }

            // Language filter
            if (filters.lang && doc.lang !== filters.lang) {
                return false;
            }

            // RBAC filter
            if (filters.userRoles && !doc.isVisibleTo(filters.userRoles)) {
                return false;
            }

            return true;
        });
    }

    /**
     * Calculate document relevance score
     */
    calculateScore(doc, query) {
        let score = 0;
        const queryWords = query.split(/\s+/);
        
        // Title matching
        const titleWords = doc.title.toLowerCase().split(/\s+/);
        const titleMatches = queryWords.filter(word => 
            titleWords.some(tword => tword.includes(word))
        ).length;
        score += titleMatches * 0.3;

        // Tag matching
        const tagMatches = queryWords.filter(word =>
            doc.tags.some(tag => tag.toLowerCase().includes(word))
        ).length;
        score += tagMatches * 0.25;

        // Content matching
        const contentText = doc.chunks.map(c => c.text).join(' ').toLowerCase();
        const contentMatches = queryWords.filter(word => 
            contentText.includes(word)
        ).length;
        score += contentMatches * 0.45;

        // Normalize to 0-1 range
        return Math.min(1, score / queryWords.length);
    }
}

/**
 * 📊 Reranker
 */
class Reranker {
    constructor(config) {
        this.config = config;
    }

    /**
     * Rerank documents with additional features
     */
    rerank(documents, query, context = {}) {
        return documents.map(doc => {
            const features = this.extractFeatures(doc, query, context);
            const rerankScore = this.computeRerankScore(features);
            
            return {
                ...doc,
                finalScore: Math.max(doc.score, rerankScore),
                features
            };
        }).sort((a, b) => b.finalScore - a.finalScore);
    }

    /**
     * Extract reranking features
     */
    extractFeatures(doc, query, context) {
        const queryWords = query.split(/\s+/);
        
        // Query-passage cosine (simplified)
        const queryCoverage = this.calculateQueryCoverage(doc, queryWords);
        
        // Tag overlap
        const tagOverlap = this.calculateTagOverlap(doc.tags, context.tags || []);
        
        // Policy path hit
        const policyPathHit = this.checkPolicyPathHit(doc, context);
        
        // Recency boost
        const recencyBoost = this.calculateRecencyBoost(doc, context);

        return {
            queryCoverage,
            tagOverlap,
            policyPathHit,
            recencyBoost
        };
    }

    /**
     * Compute final rerank score
     */
    computeRerankScore(features) {
        return (
            0.55 * features.queryCoverage +
            0.20 * features.tagOverlap +
            0.15 * features.policyPathHit +
            0.10 * features.recencyBoost
        );
    }

    /**
     * Calculate query coverage in document
     */
    calculateQueryCoverage(doc, queryWords) {
        const docText = doc.chunks.map(c => c.text).join(' ').toLowerCase();
        const matchedWords = queryWords.filter(word => docText.includes(word));
        return queryWords.length > 0 ? matchedWords.length / queryWords.length : 0;
    }

    /**
     * Calculate tag overlap (Jaccard similarity)
     */
    calculateTagOverlap(docTags, contextTags) {
        if (docTags.length === 0 && contextTags.length === 0) return 0;
        
        const intersection = docTags.filter(tag => contextTags.includes(tag)).length;
        const union = new Set([...docTags, ...contextTags]).size;
        
        return union > 0 ? intersection / union : 0;
    }

    /**
     * Check if document hits policy path
     */
    checkPolicyPathHit(doc, context) {
        if (doc.source !== 'policy' || !context.policyVersion) return 0;
        
        return doc.version === context.policyVersion ? 1 : 0.5;
    }

    /**
     * Calculate recency boost
     */
    calculateRecencyBoost(doc, context) {
        // Simplified recency calculation
        if (!doc.effective.from) return 0.5;
        
        const docDate = new Date(doc.effective.from);
        const now = new Date();
        const daysDiff = (now - docDate) / (1000 * 60 * 60 * 24);
        
        // Newer documents get higher score
        return Math.max(0, 1 - daysDiff / 365); // Decay over a year
    }
}

/**
 * 🎯 LIVIA-07 Knowledge Router Class
 */
class KnowledgeRouter {
    constructor(config = {}) {
        this.name = 'KnowledgeRouter';
        this.config = {
            i18n: { locale: 'tr-TR', tz: 'Europe/Istanbul', fallbackLang: 'tr' },
            retrieval: {
                candidateK: 24,
                filters: { bySource: ['policy', 'playbook', 'faq', 'kb'], byLang: ['tr', 'en'] },
                tagBoost: { aggressive: 0.15, guard: 0.12, slip: 0.10, spread: 0.08 },
                dense: { enabled: true, dim: 768, topK: 24, index: 'kb_vectors' },
                sparse: { enabled: true, bm25TopK: 30, k1: 1.2, b: 0.75 },
                fuse: { alphaDense: 0.6, betaSparse: 0.4, titleBoost: 0.05, pathBoost: 0.05 },
                rerank: { enabled: true, topK: 10, features: ['queryPassageCos', 'tagOverlap', 'policyExactPathHit'] },
                selectThreshold: 0.62,
                maxDocs: 2,
                maxPassagesPerDoc: 2
            },
            security: {
                rbac: {
                    policy: ['policy', 'ops', 'trader'],
                    playbook: ['ops', 'trader'],
                    faq: ['ops', 'trader', 'policy'],
                    kb: ['ops', 'trader', 'policy']
                },
                piiMask: true,
                allowlistSources: ['policy', 'playbook', 'faq', 'kb']
            },
            cache: { ttlSec: 600, maxEntries: 1000 },
            idempotencyTtlSec: 600,
            ...config
        };

        // State management
        this.state = {
            documents: new Map(), // docId -> KnowledgeDocument
            indexSnapshot: null,
            policySnapshot: null,
            cache: new Map(), // routeKey -> cached result
            idempotencyCache: new Map(), // routeKey -> timestamp
            stats: {
                queries: 0,
                nohits: 0,
                cacheHits: 0,
                avgRouteMs: 0,
                totalRouteMs: 0,
                bySource: new Map()
            }
        };

        // Helper classes
        this.textNormalizer = new TextNormalizer(this.config);
        this.hybridSearch = new HybridSearchEngine(this.config);
        this.reranker = new Reranker(this.config);

        // Mock knowledge base
        this.initializeMockKB();

        this.isInitialized = false;
        this.logger = null;
    }

    /**
     * 📚 Initialize mock knowledge base
     */
    initializeMockKB() {
        const mockDocs = [
            {
                docId: 'policy/variants@v42',
                source: 'policy',
                title: 'Variants v42',
                version: 'v42',
                lang: 'tr',
                tags: ['variants', 'aggressive', 'conservative'],
                visibility: ['policy', 'ops', 'trader'],
                effective: { from: '2025-08-01', to: null },
                chunks: [
                    {
                        chunkId: 'c7',
                        text: 'Agresif varyant, latency/slip guard "block_aggressive" iken devre dışı kalır. Bu durumda sadece conservative varyant kullanılabilir.',
                        headings: ['Variants', 'Aggressive'],
                        meta: { path: 'variants.aggressive', policyVersion: 'v42' }
                    }
                ],
                checksum: 'sha256:abc123'
            },
            {
                docId: 'playbook/guard-response@pb-12',
                source: 'playbook',
                title: 'Guard Response Playbook',
                version: 'pb-12',
                lang: 'tr',
                tags: ['guard', 'response', 'slip', 'latency'],
                visibility: ['ops', 'trader'],
                effective: { from: '2025-07-15', to: null },
                chunks: [
                    {
                        chunkId: 'c12',
                        text: 'Block_aggressive modunda öneri: conservative varyant + limit/twap ile giriş. Market emirlerinden kaçının.',
                        headings: ['Guard', 'Block Aggressive'],
                        meta: { scenario: 'high_slip', recommendation: 'conservative' }
                    }
                ],
                checksum: 'sha256:def456'
            },
            {
                docId: 'policy/limits@v42',
                source: 'policy',
                title: 'Limits v42',
                version: 'v42',
                lang: 'tr',
                tags: ['limits', 'slip', 'spread'],
                visibility: ['policy', 'ops', 'trader'],
                effective: { from: '2025-08-01', to: null },
                chunks: [
                    {
                        chunkId: 'c1',
                        text: 'Max slip 15bps olarak belirlendi. Daha yüksek slip beklentisi olan işlemler limit emirle yapılmalıdır.',
                        headings: ['Limits', 'Slip'],
                        meta: { path: 'limits.maxSlipBps', value: 15 }
                    },
                    {
                        chunkId: 'c2',
                        text: 'Max spread 80bps. Daha geniş spreadlerde market emir risklidir.',
                        headings: ['Limits', 'Spread'],
                        meta: { path: 'limits.maxSpreadBps', value: 80 }
                    }
                ],
                checksum: 'sha256:ghi789'
            }
        ];

        for (const docData of mockDocs) {
            const doc = new KnowledgeDocument(docData);
            this.state.documents.set(doc.docId, doc);
        }
    }

    /**
     * 🚀 Initialize the router
     */
    async initialize(logger) {
        try {
            this.logger = logger;
            this.logger.info(`${this.name} başlatılıyor...`);

            this.setupEventListeners();
            this.startPeriodicTasks();

            this.isInitialized = true;
            this.logger.info(`${this.name} başarıyla başlatıldı - ${this.state.documents.size} documents loaded`);
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
        // Main query handler
        eventBus.subscribeToEvent('knowledge.query', (event) => {
            this.handleKnowledgeQuery(event.data);
        }, 'knowledgeRouter');

        // State updates
        eventBus.subscribeToEvent('kb.index.snapshot', (event) => {
            this.handleKBIndexSnapshot(event.data);
        }, 'knowledgeRouter');

        eventBus.subscribeToEvent('policy.snapshot', (event) => {
            this.handlePolicySnapshot(event.data);
        }, 'knowledgeRouter');
    }

    /**
     * 🔍 Handle knowledge query
     */
    async handleKnowledgeQuery(data) {
        const startTime = Date.now();
        
        try {
            const validated = KnowledgeQuerySchema.parse(data);
            
            // Generate route key for idempotency
            const routeKey = this.generateRouteKey(validated);
            
            // Check idempotency
            if (this.state.idempotencyCache.has(routeKey)) {
                this.logger.info(`Skipping duplicate query: ${routeKey}`);
                return;
            }

            // Check cache
            const cached = this.state.cache.get(routeKey);
            if (cached && Date.now() - cached.timestamp < this.config.cache.ttlSec * 1000) {
                await this.emitCachedResult(cached.result, routeKey);
                this.state.stats.cacheHits++;
                return;
            }

            // Process query
            const result = await this.processQuery(validated, routeKey);
            
            // Cache result
            if (result.ok) {
                this.state.cache.set(routeKey, {
                    result,
                    timestamp: Date.now()
                });
            }

            // Mark as processed
            this.state.idempotencyCache.set(routeKey, Date.now());

            // Update stats
            const routeTime = Date.now() - startTime;
            this.updateStats(routeTime, result.ok);

        } catch (error) {
            this.logger.error('Knowledge query validation error:', error);
            await this.emitRouteAlert('error', 'Query validation failed', { error: error.message });
        }
    }

    /**
     * 🎯 Process knowledge query
     */
    async processQuery(query, routeKey) {
        // Validate auth and RBAC
        const authResult = this.validateAuth(query);
        if (!authResult.valid) {
            await this.emitNoHit(routeKey, authResult.reason, authResult.hint);
            return { ok: false };
        }

        // Normalize query
        const normalizedQuery = this.textNormalizer.normalize(query.q);
        if (!normalizedQuery || normalizedQuery.length < 3) {
            await this.emitNoHit(routeKey, 'empty_query', 'Sorguyu netleştir: örn. "max slip kaç bps?"');
            return { ok: false };
        }

        // Check index readiness
        if (!this.state.indexSnapshot?.vectorReady) {
            await this.emitNoHit(routeKey, 'index_not_ready', 'Bilgi tabanı henüz hazır değil');
            return { ok: false };
        }

        // Detect language
        const lang = query.lang || this.textNormalizer.detectLanguage(query.q);

        // Prepare search filters
        const filters = this.prepareSearchFilters(query, lang);

        // Perform hybrid search
        const candidates = this.hybridSearch.search(
            normalizedQuery, 
            Array.from(this.state.documents.values()), 
            filters
        );

        if (candidates.length === 0) {
            await this.emitNoHit(routeKey, 'low_score', 'İlgili belge bulunamadı');
            return { ok: false };
        }

        // Rerank if enabled
        let rankedCandidates = candidates;
        if (this.config.retrieval.rerank.enabled) {
            rankedCandidates = this.reranker.rerank(candidates, normalizedQuery, query.context);
        }

        // Filter by threshold and limits
        const selected = rankedCandidates
            .filter(doc => doc.finalScore >= this.config.retrieval.selectThreshold)
            .slice(0, this.config.retrieval.maxDocs);

        if (selected.length === 0) {
            await this.emitNoHit(routeKey, 'low_score', 'Bulunan sonuçlar yeterince alakalı değil');
            return { ok: false };
        }

        // Extract passages and build result
        const result = await this.buildResult(selected, normalizedQuery, lang, query, routeKey);
        
        // Emit result
        await this.emitRouteSelect(result);
        
        return result;
    }

    /**
     * 🔐 Validate auth and RBAC
     */
    validateAuth(query) {
        const { auth, need } = query;
        
        // Check roles for source access
        const sourcesToCheck = need === 'auto' ? 
            this.config.security.allowlistSources : 
            [need];

        for (const source of sourcesToCheck) {
            const allowedRoles = this.config.security.rbac[source] || [];
            const hasAccess = auth.roles.some(role => allowedRoles.includes(role));
            
            if (!hasAccess) {
                return {
                    valid: false,
                    reason: 'not_allowed',
                    hint: `${source} erişimi için yetki gerekli`
                };
            }
        }

        return { valid: true };
    }

    /**
     * 🔧 Prepare search filters
     */
    prepareSearchFilters(query, lang) {
        return {
            sources: query.need === 'auto' ? 
                this.config.security.allowlistSources : 
                [query.need],
            lang,
            userRoles: query.auth.roles
        };
    }

    /**
     * 📋 Build result from selected documents
     */
    async buildResult(selected, normalizedQuery, lang, query, routeKey) {
        const now = new Date();
        const top = [];

        for (const doc of selected) {
            const matchingChunks = doc.getMatchingChunks(normalizedQuery, this.config.retrieval.maxPassagesPerDoc);
            
            const passages = matchingChunks.map(chunk => ({
                chunkId: chunk.chunkId,
                excerpt: this.createExcerpt(chunk.text, query.prefs?.maxCharsPerPassage || 650),
                headings: chunk.headings || [],
                meta: chunk.meta,
                cit: {
                    href: `app://kb/${doc.docId}#${chunk.chunkId}`,
                    start: 0,
                    end: chunk.text.length
                }
            }));

            if (passages.length > 0) {
                top.push({
                    docId: doc.docId,
                    source: doc.source,
                    title: doc.title,
                    score: doc.finalScore || doc.score,
                    passages
                });
            }
        }

        // Generate summary for multi-source results
        const summary = this.generateSummary(top, query);

        return {
            event: 'knowledge.route.select',
            timestamp: now.toISOString(),
            routeKey,
            ok: true,
            query: {
                qNorm: normalizedQuery,
                lang
            },
            top,
            summary,
            audit: {
                eventId: `route-${Date.now()}`,
                producedBy: 'livia-07',
                producedAt: now.toISOString()
            }
        };
    }

    /**
     * ✂️ Create excerpt from text
     */
    createExcerpt(text, maxChars) {
        if (text.length <= maxChars) {
            return text;
        }

        // Try to cut at word boundary
        const truncated = text.substring(0, maxChars);
        const lastSpace = truncated.lastIndexOf(' ');
        
        if (lastSpace > maxChars * 0.8) {
            return truncated.substring(0, lastSpace) + '...';
        }
        
        return truncated + '...';
    }

    /**
     * 📝 Generate summary for multi-source results
     */
    generateSummary(topResults, query) {
        if (topResults.length <= 1) {
            return undefined;
        }

        const sources = topResults.map(r => r.source);
        const uniqueSources = [...new Set(sources)];
        
        if (uniqueSources.length > 1) {
            return `${uniqueSources.length} farklı kaynaktan ${topResults.length} ilgili belge bulundu. Politika ve oyun kitabı önerileri karşılaştırın.`;
        }

        return `${topResults.length} ilgili ${uniqueSources[0]} belgesi bulundu.`;
    }

    /**
     * 🎯 Generate route key for idempotency
     */
    generateRouteKey(query) {
        const keyData = {
            q: query.q,
            need: query.need,
            context: query.context,
            policyVersion: this.state.policySnapshot?.versionId
        };
        
        const hash = createHash('md5').update(JSON.stringify(keyData)).digest('hex');
        return `krun-${hash.substring(0, 8)}`;
    }

    /**
     * 📤 Emit route select result
     */
    async emitRouteSelect(result) {
        try {
            const validated = KnowledgeRouteSelectSchema.parse(result);
            eventBus.publishEvent('knowledge.route.select', validated, 'knowledgeRouter');
            
            this.logger.info(`Knowledge route: ${result.routeKey} found ${result.top.length} results`);
            
            // Update source stats
            for (const doc of result.top) {
                const current = this.state.stats.bySource.get(doc.source) || 0;
                this.state.stats.bySource.set(doc.source, current + 1);
            }
        } catch (error) {
            this.logger.error('Route select emission error:', error);
        }
    }

    /**
     * ❌ Emit no hit result
     */
    async emitNoHit(routeKey, reason, hint) {
        const noHit = {
            event: 'knowledge.route.nohit',
            timestamp: new Date().toISOString(),
            routeKey,
            reason,
            hint
        };

        try {
            const validated = KnowledgeRouteNohitSchema.parse(noHit);
            eventBus.publishEvent('knowledge.route.nohit', validated, 'knowledgeRouter');
            
            this.state.stats.nohits++;
            this.logger.info(`Knowledge no-hit: ${routeKey} reason=${reason}`);
        } catch (error) {
            this.logger.error('No-hit emission error:', error);
        }
    }

    /**
     * 📤 Emit cached result
     */
    async emitCachedResult(result, routeKey) {
        // Update audit timestamp for cached result
        const cachedResult = {
            ...result,
            timestamp: new Date().toISOString(),
            audit: {
                ...result.audit,
                producedAt: new Date().toISOString()
            }
        };

        await this.emitRouteSelect(cachedResult);
        this.logger.info(`Knowledge cache hit: ${routeKey}`);
    }

    /**
     * 🚨 Emit route alert
     */
    async emitRouteAlert(level, message, context = {}) {
        const alert = {
            event: 'knowledge.route.alert',
            timestamp: new Date().toISOString(),
            level,
            message,
            context
        };

        eventBus.publishEvent('knowledge.route.alert', alert, 'knowledgeRouter');
        this.logger.info(`Knowledge alert: ${level} - ${message}`);
    }

    /**
     * 📊 Update statistics
     */
    updateStats(routeTimeMs, success) {
        this.state.stats.queries++;
        this.state.stats.totalRouteMs += routeTimeMs;
        this.state.stats.avgRouteMs = this.state.stats.totalRouteMs / this.state.stats.queries;
        
        if (!success) {
            this.state.stats.nohits++;
        }
    }

    /**
     * 📊 Handle KB index snapshot
     */
    handleKBIndexSnapshot(data) {
        try {
            const validated = KBIndexSnapshotSchema.parse(data);
            this.state.indexSnapshot = validated;
            this.logger.info(`KB index snapshot: vectorReady=${validated.vectorReady} docs=${validated.stats.docs}`);
        } catch (error) {
            this.logger.error('KB index snapshot validation error:', error);
        }
    }

    /**
     * 📋 Handle policy snapshot
     */
    handlePolicySnapshot(data) {
        try {
            const validated = PolicySnapshotSchema.parse(data);
            this.state.policySnapshot = validated;
            this.logger.info(`Policy snapshot updated: ${validated.versionId}`);
        } catch (error) {
            this.logger.error('Policy snapshot validation error:', error);
        }
    }

    /**
     * ⏱️ Start periodic tasks
     */
    startPeriodicTasks() {
        // Clean cache and idempotency every 5 minutes
        setInterval(() => {
            this.cleanupCache();
            this.cleanupIdempotency();
        }, 300000);

        // Emit metrics every 30 seconds
        setInterval(() => {
            this.emitMetrics();
        }, 30000);
    }

    /**
     * 🧹 Cleanup cache
     */
    cleanupCache() {
        const now = Date.now();
        const ttlMs = this.config.cache.ttlSec * 1000;
        let cleaned = 0;

        for (const [key, entry] of this.state.cache.entries()) {
            if (now - entry.timestamp > ttlMs) {
                this.state.cache.delete(key);
                cleaned++;
            }
        }

        if (cleaned > 0) {
            this.logger.info(`Cleaned ${cleaned} cache entries`);
        }
    }

    /**
     * 🧹 Cleanup idempotency cache
     */
    cleanupIdempotency() {
        const now = Date.now();
        const ttlMs = this.config.idempotencyTtlSec * 1000;
        let cleaned = 0;

        for (const [key, timestamp] of this.state.idempotencyCache.entries()) {
            if (now - timestamp > ttlMs) {
                this.state.idempotencyCache.delete(key);
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
        const bySource = {};
        const totalBySource = Array.from(this.state.stats.bySource.values()).reduce((sum, count) => sum + count, 0);
        
        for (const [source, count] of this.state.stats.bySource.entries()) {
            bySource[source] = totalBySource > 0 ? count / totalBySource : 0;
        }

        const metrics = {
            event: 'knowledge.route.metrics',
            timestamp: new Date().toISOString(),
            queries: this.state.stats.queries,
            nohitRate: this.state.stats.queries > 0 ? this.state.stats.nohits / this.state.stats.queries : 0,
            avgRouteMs: Math.round(this.state.stats.avgRouteMs),
            denseUsed: this.config.retrieval.dense.enabled,
            rerankUsed: this.config.retrieval.rerank.enabled,
            cacheHitRate: this.state.stats.queries > 0 ? this.state.stats.cacheHits / this.state.stats.queries : 0,
            bySource
        };

        eventBus.publishEvent('knowledge.route.metrics', metrics, 'knowledgeRouter');
    }

    /**
     * 📊 Get system status
     */
    getStatus() {
        return {
            name: this.name,
            initialized: this.isInitialized,
            documents: this.state.documents.size,
            indexReady: this.state.indexSnapshot?.vectorReady || false,
            policyVersion: this.state.policySnapshot?.versionId,
            stats: { ...this.state.stats },
            cache: this.state.cache.size,
            idempotencyCache: this.state.idempotencyCache.size
        };
    }

    /**
     * 🛑 Shutdown
     */
    async shutdown() {
        try {
            this.logger.info(`${this.name} kapatılıyor...`);
            
            // Clear caches
            this.state.cache.clear();
            this.state.idempotencyCache.clear();
            this.state.stats.bySource.clear();
            
            this.isInitialized = false;
            this.logger.info(`${this.name} başarıyla kapatıldı`);
        } catch (error) {
            this.logger.error(`${this.name} kapatma hatası:`, error);
        }
    }
}

module.exports = {
    KnowledgeRouter,
    knowledgeRouter: new KnowledgeRouter(),
    KnowledgeDocument,
    TextNormalizer,
    HybridSearchEngine,
    Reranker
};