/**
 * LIVIA-55: Query Orchestrator
 * Ana sorgu işleme orkestratörü: plan seçimi, retrieve, rerank, synthesize, degrade
 * Amaç: Sorgu akışını yöneterek optimum plan seçimi, retrieval, reranking ve sentez süreçlerini koordine et
 */

const crypto = require('crypto');
const { EventEmitter } = require('events');
const { trace, context, SpanStatusCode } = require('@opentelemetry/api');

class QueryOrchestrator extends EventEmitter {
    constructor(config = {}) {
        super();
        
        this.name = 'QueryOrchestrator';
        this.config = {
            enabled: true,
            locale: 'tr-TR',
            timezone: 'Europe/Istanbul',
            planner: {
                catalog: [
                    {
                        id: 'P-hybrid-fast',
                        steps: ['parse', 'expand', 'retrieve', 'rerank', 'synthesize', 'finalize'],
                        budget: { latencyMs: 900, costUsd: 0.015 },
                        defaults: { topK: 60, reranker: 'ce-small', reasoner: 'gpt-m', maxTokens: 700 }
                    },
                    {
                        id: 'P-vec-lite',
                        steps: ['parse', 'retrieve.vec', 'synthesize', 'finalize'],
                        budget: { latencyMs: 600, costUsd: 0.008 },
                        defaults: { topK: 40, reasoner: 'gpt-m' }
                    },
                    {
                        id: 'P-bm25-lowcost',
                        steps: ['parse', 'retrieve.bm25', 'synthesize', 'finalize'],
                        budget: { latencyMs: 700, costUsd: 0.004 },
                        defaults: { bm25TopK: 80, reasoner: 'gpt-m' }
                    },
                    {
                        id: 'P-hybrid-quality',
                        steps: ['parse', 'expand', 'retrieve', 'rerank(ce-large)', 'synthesize(gpt-l)', 'finalize'],
                        budget: { latencyMs: 1400, costUsd: 0.03 },
                        defaults: { topK: 100, maxTokens: 900 }
                    }
                ],
                policy: 'argmin(cost) s.t. p95<=deadline ∧ quality>=target'
            },
            degrade: {
                when: {
                    p95Ms: { warn: 900, breach: 1100 },
                    costUsd: { warn: 0.015, breach: 0.02 }
                },
                steps: [
                    { action: 'topK_dec', step: 20, floor: 20 },
                    { action: 'reranker_switch', order: ['ce-large', 'ce-small', 'none'] },
                    { action: 'reasoner_switch', order: ['gpt-l', 'gpt-m'] },
                    { action: 'maxTokens_dec', step: 100, floor: 400 },
                    { action: 'expand_off' }
                ],
                qualityGuard: { ndcg10DropMaxPct: 3.0 }
            },
            caches: {
                query: { kind: 'lfu', maxItems: 10000, ttlSec: 7200, bloom: true },
                passage: { kind: 'lru', maxItems: 50000, ttlSec: 86400 },
                rerank: { kind: 'lru', maxItems: 20000, ttlSec: 14400 },
                answer: { kind: 'kvstore', ttlSec: 10800, keyBy: 'qKey+topDocsHash+model' }
            },
            retrieval: {
                vector: { topK: 80, ef: 64, timeoutMs: 250, prefetch: true },
                bm25: { topK: 80, timeoutMs: 200 },
                hybrid: { alpha: 0.35, merge: 'RRf' },
                diversity: { method: 'mmr', lambda: 0.7 }
            },
            rerank: { model: 'ce-small', truncateTopK: 20, timeoutMs: 300 },
            synthesize: {
                models: { fast: 'gpt-m', quality: 'gpt-l' },
                guardrails: { pii: true, toxicity: true, jailbreak: true },
                streaming: true,
                maxTokens: 700,
                citationStyle: 'compact'
            },
            qualityTargets: { 'ndcg@10': 0.52, 'mrr@10': 0.58 },
            idempotencyTtlSec: 600,
            ...config
        };
        
        // State management
        this.state = 'IDLE';
        this.queries = new Map(); // Active queries
        this.cache = new Map();
        this.metrics = {
            qps: 0,
            p50Ms: 0,
            p95Ms: 0,
            avgCostUsd: 0,
            cacheHitPct: { query: 0, passage: 0, answer: 0 },
            quality: { 'ndcg@10': 0, 'mrr@10': 0 },
            degradeStepsApplied: 0
        };
        
        this.isInitialized = false;
        this.logger = null;
        this.tracer = trace.getTracer('livia-query-orchestrator');
        
        // FSM states
        this.states = ['IDLE', 'PARSE', 'PLAN', 'RETRIEVE', 'RERANK', 'SYNTH', 'FINALIZE', 'DONE', 'DEGRADE', 'ALERT'];
    }

    async initialize(eventBus, logger) {
        try {
            this.eventBus = eventBus;
            this.logger = logger;
            this.logger.info(`${this.name} başlatılıyor...`);
            
            // Event listeners
            this.setupEventListeners();
            
            // Initialize caches
            this.initializeCaches();
            
            this.isInitialized = true;
            this.logger.info(`${this.name} başarıyla başlatıldı`);
            return true;
        } catch (error) {
            this.logger.error(`${this.name} başlatma hatası:`, error);
            return false;
        }
    }

    setupEventListeners() {
        // Query request handler
        this.eventBus.on('query.request', this.handleQueryRequest.bind(this));
        
        // Configuration updates
        this.eventBus.on('qo.config.updated', this.handleConfigUpdate.bind(this));
        
        // Degrade triggers
        this.eventBus.on('qo.degrade.trigger', this.handleDegradeTrigger.bind(this));
    }

    initializeCaches() {
        this.cache.set('query', new Map());
        this.cache.set('passage', new Map());
        this.cache.set('answer', new Map());
    }

    async handleQueryRequest(event) {
        const span = this.tracer.startSpan('query.orchestrator.process');
        
        try {
            const queryId = event.id || this.generateQueryId();
            const startTime = Date.now();
            
            // Idempotency check
            const idempotencyKey = this.generateIdempotencyKey(event);
            if (this.cache.get('query').has(idempotencyKey)) {
                const cachedResult = this.cache.get('query').get(idempotencyKey);
                span.setStatus({ code: SpanStatusCode.OK });
                span.end();
                
                this.emit('qo.cache', {
                    event: 'qo.cache',
                    timestamp: new Date().toISOString(),
                    type: 'hit',
                    key: idempotencyKey,
                    queryId
                });
                
                return cachedResult;
            }
            
            // Initialize query context
            const queryContext = {
                id: queryId,
                query: event.query,
                tier: event.tier || 'standard',
                deadline: event.deadline || 1000,
                budget: event.budget || 0.015,
                startTime,
                state: 'PARSE',
                plan: null,
                results: null,
                metrics: {}
            };
            
            this.queries.set(queryId, queryContext);
            
            // Start FSM processing
            const result = await this.processQuery(queryContext, span);
            
            // Cache result
            this.cache.get('query').set(idempotencyKey, result);
            this.scheduleCache('query', idempotencyKey, this.config.idempotencyTtlSec);
            
            span.setStatus({ code: SpanStatusCode.OK });
            span.end();
            
            return result;
            
        } catch (error) {
            span.recordException(error);
            span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
            span.end();
            
            this.emit('qo.alert', {
                event: 'qo.alert',
                timestamp: new Date().toISOString(),
                level: 'error',
                message: error.message,
                queryId: event.id
            });
            
            throw error;
        }
    }

    async processQuery(queryContext, span) {
        const { id: queryId } = queryContext;
        
        try {
            // Parse phase
            await this.parseQuery(queryContext, span);
            
            // Plan selection
            await this.selectPlan(queryContext, span);
            
            // Execute plan steps
            for (const step of queryContext.plan.steps) {
                await this.executeStep(queryContext, step, span);
                
                // Check degradation triggers
                await this.checkDegradation(queryContext);
            }
            
            // Finalize and emit result
            const result = await this.finalizeQuery(queryContext, span);
            
            // Update metrics
            this.updateMetrics(queryContext);
            
            // Emit events
            this.emit('qo.trace.ready', {
                event: 'qo.trace.ready',
                timestamp: new Date().toISOString(),
                id: queryId,
                spans: queryContext.spans || [],
                tokenUsage: queryContext.tokenUsage || {}
            });
            
            this.emit('query.result.ready', {
                event: 'query.result.ready',
                timestamp: new Date().toISOString(),
                id: queryId,
                mode: 'answer',
                stream: true,
                topDocs: result.topDocs || [],
                answerMd: result.answer || '',
                citations: result.citations || [],
                guardrails: result.guardrails || { pii: 'ok', toxicity: 'ok' },
                hash: this.hashResult(result)
            });
            
            return result;
            
        } catch (error) {
            this.logger.error(`Query processing error for ${queryId}:`, error);
            throw error;
        } finally {
            this.queries.delete(queryId);
        }
    }

    async parseQuery(queryContext, span) {
        const parseSpan = this.tracer.startSpan('query.parse', { parent: span });
        
        try {
            // Language detection and intent analysis
            const parseResult = {
                language: this.detectLanguage(queryContext.query),
                intent: this.analyzeIntent(queryContext.query),
                needsTools: this.needsToolAccess(queryContext.query)
            };
            
            queryContext.parseResult = parseResult;
            queryContext.state = 'PLAN';
            
            parseSpan.setStatus({ code: SpanStatusCode.OK });
            
        } catch (error) {
            parseSpan.recordException(error);
            parseSpan.setStatus({ code: SpanStatusCode.ERROR });
            throw error;
        } finally {
            parseSpan.end();
        }
    }

    async selectPlan(queryContext, span) {
        const planSpan = this.tracer.startSpan('query.plan', { parent: span });
        
        try {
            // Select optimal plan based on budget, deadline, and quality targets
            const selectedPlan = this.selectOptimalPlan(
                queryContext.deadline,
                queryContext.budget,
                queryContext.tier
            );
            
            queryContext.plan = selectedPlan;
            queryContext.state = 'RETRIEVE';
            
            this.emit('qo.decision', {
                event: 'qo.decision',
                timestamp: new Date().toISOString(),
                queryId: queryContext.id,
                planId: selectedPlan.id,
                reason: 'budget_optimal'
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

    async executeStep(queryContext, step, span) {
        const stepSpan = this.tracer.startSpan(`query.${step}`, { parent: span });
        
        try {
            switch (step) {
                case 'expand':
                    await this.expandQuery(queryContext);
                    break;
                case 'retrieve':
                    await this.retrieveDocuments(queryContext);
                    break;
                case 'retrieve.vec':
                    await this.retrieveVector(queryContext);
                    break;
                case 'retrieve.bm25':
                    await this.retrieveBM25(queryContext);
                    break;
                case 'rerank':
                    await this.rerankDocuments(queryContext);
                    break;
                case 'synthesize':
                    await this.synthesizeAnswer(queryContext);
                    break;
            }
            
            stepSpan.setStatus({ code: SpanStatusCode.OK });
            
        } catch (error) {
            stepSpan.recordException(error);
            stepSpan.setStatus({ code: SpanStatusCode.ERROR });
            throw error;
        } finally {
            stepSpan.end();
        }
    }

    async finalizeQuery(queryContext, span) {
        const finalizeSpan = this.tracer.startSpan('query.finalize', { parent: span });
        
        try {
            queryContext.state = 'DONE';
            
            const result = {
                answer: queryContext.answer || '',
                topDocs: queryContext.topDocs || [],
                citations: queryContext.citations || [],
                guardrails: queryContext.guardrails || {},
                metrics: {
                    latencyMs: Date.now() - queryContext.startTime,
                    cost: queryContext.cost || 0,
                    quality: queryContext.quality || {}
                }
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

    // Plan selection logic
    selectOptimalPlan(deadline, budget, tier) {
        const suitablePlans = this.config.planner.catalog.filter(plan => 
            plan.budget.latencyMs <= deadline && plan.budget.costUsd <= budget
        );
        
        if (suitablePlans.length === 0) {
            // Fallback to cheapest plan
            return this.config.planner.catalog.reduce((min, plan) => 
                plan.budget.costUsd < min.budget.costUsd ? plan : min
            );
        }
        
        // Select plan with best quality/cost ratio
        return suitablePlans.reduce((best, plan) => {
            const bestRatio = this.calculateQualityRatio(best);
            const planRatio = this.calculateQualityRatio(plan);
            return planRatio > bestRatio ? plan : best;
        });
    }

    calculateQualityRatio(plan) {
        // Simple heuristic: more steps generally mean better quality
        const qualityScore = plan.steps.length;
        return qualityScore / plan.budget.costUsd;
    }

    // Degradation handling
    async checkDegradation(queryContext) {
        const currentLatency = Date.now() - queryContext.startTime;
        const currentCost = queryContext.cost || 0;
        
        if (currentLatency > this.config.degrade.when.p95Ms.breach ||
            currentCost > this.config.degrade.when.costUsd.breach) {
            
            await this.applyDegradation(queryContext);
        }
    }

    async applyDegradation(queryContext) {
        this.logger.warn(`Applying degradation for query ${queryContext.id}`);
        
        for (const step of this.config.degrade.steps) {
            switch (step.action) {
                case 'topK_dec':
                    if (queryContext.plan.defaults.topK > step.floor) {
                        queryContext.plan.defaults.topK -= step.step;
                    }
                    break;
                case 'reranker_switch':
                    // Switch to next cheaper reranker
                    break;
                case 'reasoner_switch':
                    // Switch to faster model
                    break;
                case 'maxTokens_dec':
                    if (queryContext.plan.defaults.maxTokens > step.floor) {
                        queryContext.plan.defaults.maxTokens -= step.step;
                    }
                    break;
            }
        }
        
        this.emit('qo.degrade', {
            event: 'qo.degrade',
            timestamp: new Date().toISOString(),
            queryId: queryContext.id,
            actions: this.config.degrade.steps
        });
    }

    // Utility methods
    generateQueryId() {
        return `q#${crypto.randomBytes(6).toString('hex')}`;
    }

    generateIdempotencyKey(event) {
        const keyData = {
            query: event.query,
            tier: event.tier,
            timestamp: Math.floor(Date.now() / (this.config.idempotencyTtlSec * 1000))
        };
        return crypto.createHash('sha256').update(JSON.stringify(keyData)).digest('hex').substring(0, 16);
    }

    detectLanguage(query) {
        // Simple language detection
        const turkishChars = /[çğıöşü]/i;
        return turkishChars.test(query) ? 'tr' : 'en';
    }

    analyzeIntent(query) {
        // Basic intent analysis
        if (query.includes('?')) return 'question';
        if (query.includes('hesapla') || query.includes('calculate')) return 'calculation';
        return 'general';
    }

    needsToolAccess(query) {
        const toolKeywords = ['hesapla', 'calculate', 'web', 'arama', 'search'];
        return toolKeywords.some(keyword => query.toLowerCase().includes(keyword));
    }

    hashResult(result) {
        return crypto.createHash('sha256').update(JSON.stringify(result)).digest('hex');
    }

    scheduleCache(cacheType, key, ttlSec) {
        setTimeout(() => {
            this.cache.get(cacheType).delete(key);
        }, ttlSec * 1000);
    }

    updateMetrics(queryContext) {
        const latency = Date.now() - queryContext.startTime;
        // Update internal metrics
        this.metrics.qps = Math.min(this.metrics.qps + 0.1, 100);
        this.metrics.p95Ms = Math.max(this.metrics.p95Ms * 0.95, latency);
        this.metrics.avgCostUsd = (this.metrics.avgCostUsd * 0.9) + ((queryContext.cost || 0) * 0.1);
        
        // Emit metrics
        this.emit('qo.metrics', {
            event: 'qo.metrics',
            timestamp: new Date().toISOString(),
            ...this.metrics
        });
    }

    // Mock implementations for missing methods
    async expandQuery(queryContext) {
        // Placeholder for query expansion
        queryContext.expanded = true;
    }

    async retrieveDocuments(queryContext) {
        // Placeholder for hybrid retrieval
        queryContext.topDocs = [
            { id: 'doc#1', score: 0.82 },
            { id: 'doc#2', score: 0.75 }
        ];
    }

    async retrieveVector(queryContext) {
        // Placeholder for vector retrieval
        queryContext.topDocs = [
            { id: 'doc#1', score: 0.85 },
            { id: 'doc#3', score: 0.70 }
        ];
    }

    async retrieveBM25(queryContext) {
        // Placeholder for BM25 retrieval
        queryContext.topDocs = [
            { id: 'doc#2', score: 0.78 },
            { id: 'doc#4', score: 0.65 }
        ];
    }

    async rerankDocuments(queryContext) {
        // Placeholder for reranking
        if (queryContext.topDocs) {
            queryContext.topDocs = queryContext.topDocs.slice(0, this.config.rerank.truncateTopK);
        }
    }

    async synthesizeAnswer(queryContext) {
        // Placeholder for answer synthesis
        queryContext.answer = 'Generated answer based on retrieved documents';
        queryContext.citations = queryContext.topDocs ? queryContext.topDocs.map(doc => doc.id) : [];
        queryContext.guardrails = { pii: 'ok', toxicity: 'ok' };
    }

    handleConfigUpdate(event) {
        this.logger.info(`${this.name} konfigürasyonu güncelleniyor...`);
        Object.assign(this.config, event.config);
        
        this.emit('qo.config.applied', {
            event: 'qo.config.applied',
            timestamp: new Date().toISOString(),
            config: event.config
        });
    }

    handleDegradeTrigger(event) {
        this.logger.warn(`${this.name} degradasyon tetiklendi:`, event);
        // Apply immediate degradation
        this.applyGlobalDegradation(event);
    }

    async applyGlobalDegradation(event) {
        // Apply degradation to all active queries
        for (const [queryId, queryContext] of this.queries.entries()) {
            await this.applyDegradation(queryContext);
        }
    }

    getStatus() {
        return {
            name: this.name,
            initialized: this.isInitialized,
            state: this.state,
            activeQueries: this.queries.size,
            cacheStats: {
                query: this.cache.get('query').size,
                passage: this.cache.get('passage').size,
                answer: this.cache.get('answer').size
            },
            metrics: this.metrics,
            config: {
                enabled: this.config.enabled,
                locale: this.config.locale,
                timezone: this.config.timezone
            }
        };
    }

    async shutdown() {
        try {
            this.logger.info(`${this.name} durduruluyor...`);
            
            // Wait for active queries to complete or timeout
            const shutdownPromises = Array.from(this.queries.values()).map(queryContext => 
                new Promise(resolve => setTimeout(resolve, 5000)) // 5s timeout
            );
            
            await Promise.allSettled(shutdownPromises);
            
            // Clear caches
            this.cache.clear();
            this.queries.clear();
            
            this.isInitialized = false;
            this.logger.info(`${this.name} başarıyla durduruldu`);
        } catch (error) {
            this.logger.error(`${this.name} durdurma hatası:`, error);
        }
    }
}

module.exports = QueryOrchestrator;