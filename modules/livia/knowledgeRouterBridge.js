/**
 * LIVIA-24: Knowledge Router Bridge
 * Bilgi sistemleri arası köprü - farklı bilgi kaynakları arasında köprü kuran sistem
 */

const { z } = require('zod');
const EventEmitter = require('events');

// Input schemas
const KnowledgeFetchRequestSchema = z.object({
    event: z.literal('knowledge.fetch.request'),
    timestamp: z.string(),
    requestId: z.string(),
    requestorId: z.string(),
    scope: z.enum(['trading', 'compliance', 'technical', 'operational', 'emergency']),
    query: z.string(),
    priority: z.enum(['low', 'normal', 'high', 'urgent']),
    context: z.object({
        symbol: z.string().optional(),
        timeframe: z.string().optional(),
        strategy: z.string().optional(),
        incident: z.string().optional()
    }).optional(),
    requiredSources: z.array(z.string()).optional(),
    format: z.enum(['summary', 'detailed', 'raw']).default('summary')
}).strict();

const KnowledgeUpdateNotificationSchema = z.object({
    event: z.literal('knowledge.update.notification'),
    timestamp: z.string(),
    source: z.string(),
    updateType: z.enum(['new', 'updated', 'deprecated', 'removed']),
    knowledgeType: z.enum(['strategy', 'pattern', 'config', 'procedure', 'alert']),
    affectedQueries: z.array(z.string()).optional(),
    invalidateCache: z.boolean().default(false)
}).strict();

const SourceHealthUpdateSchema = z.object({
    event: z.literal('source.health.update'),
    timestamp: z.string(),
    source: z.string(),
    status: z.enum(['healthy', 'degraded', 'offline']),
    latencyMs: z.number(),
    errorRate: z.number(),
    lastSuccessTime: z.string().optional()
}).strict();

// Output schemas
const KnowledgeResponseSchema = z.object({
    event: z.literal('knowledge.response'),
    timestamp: z.string(),
    requestId: z.string(),
    success: z.boolean(),
    data: z.object({
        query: z.string(),
        results: z.array(z.object({
            source: z.string(),
            relevance: z.number(),
            content: z.any(),
            lastUpdated: z.string(),
            confidence: z.number()
        })),
        aggregated: z.object({
            summary: z.string(),
            recommendations: z.array(z.string()),
            confidence: z.number(),
            sources: z.array(z.string())
        }).optional()
    }).optional(),
    error: z.string().optional(),
    metrics: z.object({
        totalMs: z.number(),
        sourceCount: z.number(),
        cacheHit: z.boolean()
    })
}).strict();

class KnowledgeRouterBridge extends EventEmitter {
    constructor(eventBus, logger, config = {}) {
        super();
        this.eventBus = eventBus;
        this.logger = logger;
        this.name = 'KnowledgeRouterBridge';
        
        this.config = {
            sources: {
                'trading-kb': {
                    type: 'internal',
                    endpoint: '/api/knowledge/trading',
                    weight: 0.8,
                    cacheValidMin: 15,
                    timeoutMs: 2000
                },
                'compliance-db': {
                    type: 'database',
                    endpoint: 'compliance.db',
                    weight: 0.9,
                    cacheValidMin: 60,
                    timeoutMs: 3000
                },
                'external-docs': {
                    type: 'external',
                    endpoint: 'https://docs.api.com',
                    weight: 0.6,
                    cacheValidMin: 120,
                    timeoutMs: 5000
                },
                'procedure-vault': {
                    type: 'vault',
                    endpoint: '/vault/procedures',
                    weight: 0.7,
                    cacheValidMin: 30,
                    timeoutMs: 1500
                },
                'incident-logs': {
                    type: 'logs',
                    endpoint: '/logs/incidents',
                    weight: 0.5,
                    cacheValidMin: 5,
                    timeoutMs: 1000
                }
            },
            routing: {
                'trading': ['trading-kb', 'external-docs'],
                'compliance': ['compliance-db', 'procedure-vault'],
                'technical': ['trading-kb', 'external-docs', 'incident-logs'],
                'operational': ['procedure-vault', 'incident-logs'],
                'emergency': ['incident-logs', 'procedure-vault', 'compliance-db']
            },
            aggregation: {
                minSources: 2,
                minConfidence: 0.6,
                timeoutMs: 8000,
                retryCount: 2
            },
            cache: {
                maxEntries: 1000,
                defaultTtlMin: 30,
                priorityMultiplier: {
                    'low': 1,
                    'normal': 0.8,
                    'high': 0.5,
                    'urgent': 0.1
                }
            },
            circuit: {
                failureThreshold: 5,
                timeoutThreshold: 10000,
                resetTimeoutMs: 30000
            },
            ...config
        };

        this.state = {
            sourceHealth: new Map(),
            circuitBreakers: new Map(),
            cache: new Map(),
            activeRequests: new Map(),
            metrics: {
                requests: 0,
                cacheHits: 0,
                sourceErrors: 0,
                avgResponseMs: 0
            }
        };

        this.isInitialized = false;
        this.healthCheckInterval = null;
    }

    async initialize() {
        try {
            this.logger.info(`${this.name} başlatılıyor...`);
            
            // Event listeners
            this.eventBus.on('knowledge.fetch.request', this.handleKnowledgeFetchRequest.bind(this));
            this.eventBus.on('knowledge.update.notification', this.handleKnowledgeUpdateNotification.bind(this));
            this.eventBus.on('source.health.update', this.handleSourceHealthUpdate.bind(this));

            // Source health initialization
            this.initializeSourceHealth();
            
            // Circuit breaker initialization
            this.initializeCircuitBreakers();
            
            // Health check scheduler
            this.startHealthCheckScheduler();
            
            // Cache cleanup scheduler
            this.startCacheCleanupScheduler();
            
            this.isInitialized = true;
            this.logger.info(`${this.name} başarıyla başlatıldı`);
            return true;
        } catch (error) {
            this.logger.error(`${this.name} başlatma hatası:`, error);
            return false;
        }
    }

    initializeSourceHealth() {
        Object.keys(this.config.sources).forEach(source => {
            this.state.sourceHealth.set(source, {
                status: 'healthy',
                latencyMs: 0,
                errorRate: 0,
                lastCheck: new Date().toISOString(),
                consecutiveErrors: 0
            });
        });
    }

    initializeCircuitBreakers() {
        Object.keys(this.config.sources).forEach(source => {
            this.state.circuitBreakers.set(source, {
                state: 'closed', // closed, open, half-open
                failureCount: 0,
                lastFailure: null,
                nextAttempt: null
            });
        });
    }

    startHealthCheckScheduler() {
        this.healthCheckInterval = setInterval(() => {
            this.performHealthChecks();
        }, 60000); // Her dakika health check
    }

    startCacheCleanupScheduler() {
        setInterval(() => {
            this.cleanupExpiredCache();
        }, 300000); // 5 dakikada bir cache temizliği
    }

    handleKnowledgeFetchRequest(data) {
        try {
            const validated = KnowledgeFetchRequestSchema.parse(data);
            this.logger.info(`Knowledge fetch request: ${validated.scope}/${validated.query} (${validated.priority})`);
            this.processKnowledgeFetchRequest(validated);
        } catch (error) {
            this.logger.error('Knowledge fetch request validation error:', error);
            this.sendErrorResponse(data.requestId, 'Invalid request format');
        }
    }

    handleKnowledgeUpdateNotification(data) {
        try {
            const validated = KnowledgeUpdateNotificationSchema.parse(data);
            this.processKnowledgeUpdateNotification(validated);
        } catch (error) {
            this.logger.error('Knowledge update notification validation error:', error);
        }
    }

    handleSourceHealthUpdate(data) {
        try {
            const validated = SourceHealthUpdateSchema.parse(data);
            this.updateSourceHealth(validated);
        } catch (error) {
            this.logger.error('Source health update validation error:', error);
        }
    }

    async processKnowledgeFetchRequest(request) {
        const startTime = Date.now();
        
        try {
            // Cache kontrolü
            const cacheKey = this.generateCacheKey(request);
            const cachedResult = this.getCachedResult(cacheKey, request.priority);
            
            if (cachedResult) {
                this.logger.info(`Cache hit for request: ${request.requestId}`);
                this.sendCachedResponse(request, cachedResult, startTime);
                this.state.metrics.cacheHits++;
                return;
            }
            
            // Aktif request tracking
            this.state.activeRequests.set(request.requestId, {
                startTime,
                request,
                status: 'processing'
            });
            
            // Route sources
            const targetSources = this.routeToSources(request.scope, request.requiredSources);
            
            // Paralel source queries
            const sourcePromises = targetSources.map(source => 
                this.querySource(source, request)
            );
            
            // Timeout ile result collection
            const timeoutMs = this.config.aggregation.timeoutMs;
            const results = await Promise.allSettled(
                sourcePromises.map(p => this.withTimeout(p, timeoutMs))
            );
            
            // Results processing
            const successfulResults = this.extractSuccessfulResults(results, targetSources);
            const aggregatedData = await this.aggregateResults(successfulResults, request);
            
            // Cache storage
            if (aggregatedData.confidence >= this.config.aggregation.minConfidence) {
                this.cacheResult(cacheKey, aggregatedData, request.priority);
            }
            
            // Response emission
            this.sendSuccessResponse(request, aggregatedData, startTime);
            
        } catch (error) {
            this.logger.error(`Knowledge fetch error for ${request.requestId}:`, error);
            this.sendErrorResponse(request.requestId, error.message, startTime);
        } finally {
            this.state.activeRequests.delete(request.requestId);
            this.state.metrics.requests++;
            this.updateAverageResponseTime(Date.now() - startTime);
        }
    }

    routeToSources(scope, requiredSources) {
        if (requiredSources && requiredSources.length > 0) {
            return requiredSources.filter(source => this.isSourceAvailable(source));
        }
        
        const routedSources = this.config.routing[scope] || [];
        return routedSources.filter(source => this.isSourceAvailable(source));
    }

    isSourceAvailable(source) {
        const health = this.state.sourceHealth.get(source);
        const circuit = this.state.circuitBreakers.get(source);
        
        if (!health || !circuit) return false;
        
        // Circuit breaker check
        if (circuit.state === 'open') {
            if (Date.now() > circuit.nextAttempt) {
                circuit.state = 'half-open';
                this.logger.info(`Circuit breaker half-open for source: ${source}`);
            } else {
                return false;
            }
        }
        
        // Health check
        return health.status !== 'offline';
    }

    async querySource(source, request) {
        const sourceConfig = this.config.sources[source];
        const circuit = this.state.circuitBreakers.get(source);
        
        try {
            const startTime = Date.now();
            
            // Source-specific query logic
            const result = await this.performSourceQuery(source, request, sourceConfig);
            
            const latency = Date.now() - startTime;
            this.updateSourceMetrics(source, latency, true);
            
            // Circuit breaker success handling
            if (circuit.state === 'half-open') {
                circuit.state = 'closed';
                circuit.failureCount = 0;
                this.logger.info(`Circuit breaker closed for source: ${source}`);
            }
            
            return {
                source,
                success: true,
                data: result,
                latency,
                timestamp: new Date().toISOString()
            };
            
        } catch (error) {
            this.logger.error(`Source query error for ${source}:`, error);
            this.updateSourceMetrics(source, 0, false);
            this.handleSourceFailure(source, error);
            
            return {
                source,
                success: false,
                error: error.message,
                timestamp: new Date().toISOString()
            };
        }
    }

    async performSourceQuery(source, request, sourceConfig) {
        // Source type'a göre query logic
        switch (sourceConfig.type) {
            case 'internal':
                return await this.queryInternalSource(source, request, sourceConfig);
            case 'database':
                return await this.queryDatabaseSource(source, request, sourceConfig);
            case 'external':
                return await this.queryExternalSource(source, request, sourceConfig);
            case 'vault':
                return await this.queryVaultSource(source, request, sourceConfig);
            case 'logs':
                return await this.queryLogsSource(source, request, sourceConfig);
            default:
                throw new Error(`Unknown source type: ${sourceConfig.type}`);
        }
    }

    async queryInternalSource(source, request, config) {
        // Internal knowledge base query simulation
        const mockResults = {
            'trading-kb': {
                content: `Trading strategy for ${request.query}`,
                confidence: 0.85,
                lastUpdated: new Date().toISOString(),
                metadata: { source: 'internal-kb', version: 'v2.1' }
            }
        };
        
        await this.simulateNetworkDelay(config.timeoutMs * 0.3);
        return mockResults[source] || { content: 'No data found', confidence: 0.1 };
    }

    async queryDatabaseSource(source, request, config) {
        // Database query simulation
        await this.simulateNetworkDelay(config.timeoutMs * 0.4);
        
        return {
            content: `Compliance data for ${request.query}`,
            confidence: 0.9,
            lastUpdated: new Date().toISOString(),
            metadata: { source: 'compliance-db', recordCount: 42 }
        };
    }

    async queryExternalSource(source, request, config) {
        // External API query simulation
        await this.simulateNetworkDelay(config.timeoutMs * 0.6);
        
        return {
            content: `External documentation for ${request.query}`,
            confidence: 0.7,
            lastUpdated: new Date().toISOString(),
            metadata: { source: 'external-api', apiVersion: 'v1.0' }
        };
    }

    async queryVaultSource(source, request, config) {
        // Vault query simulation
        await this.simulateNetworkDelay(config.timeoutMs * 0.2);
        
        return {
            content: `Procedure documents for ${request.query}`,
            confidence: 0.8,
            lastUpdated: new Date().toISOString(),
            metadata: { source: 'vault', accessLevel: 'L2' }
        };
    }

    async queryLogsSource(source, request, config) {
        // Logs query simulation
        await this.simulateNetworkDelay(config.timeoutMs * 0.15);
        
        return {
            content: `Incident logs related to ${request.query}`,
            confidence: 0.6,
            lastUpdated: new Date().toISOString(),
            metadata: { source: 'logs', logCount: 127 }
        };
    }

    async simulateNetworkDelay(maxMs) {
        const delay = Math.random() * maxMs;
        return new Promise(resolve => setTimeout(resolve, delay));
    }

    async withTimeout(promise, timeoutMs) {
        return Promise.race([
            promise,
            new Promise((_, reject) => 
                setTimeout(() => reject(new Error('Query timeout')), timeoutMs)
            )
        ]);
    }

    extractSuccessfulResults(results, sources) {
        const successful = [];
        
        results.forEach((result, index) => {
            if (result.status === 'fulfilled' && result.value.success) {
                successful.push({
                    source: sources[index],
                    ...result.value.data,
                    relevance: this.calculateRelevance(result.value.data, sources[index])
                });
            }
        });
        
        return successful;
    }

    calculateRelevance(data, source) {
        const baseRelevance = this.config.sources[source]?.weight || 0.5;
        const confidenceBoost = data.confidence || 0.5;
        
        return Math.min(1, baseRelevance * 0.7 + confidenceBoost * 0.3);
    }

    async aggregateResults(results, request) {
        if (results.length === 0) {
            return {
                summary: 'No relevant information found',
                recommendations: [],
                confidence: 0,
                sources: []
            };
        }
        
        // Sort by relevance
        results.sort((a, b) => b.relevance - a.relevance);
        
        // Aggregate content
        const summary = await this.generateSummary(results, request);
        const recommendations = this.generateRecommendations(results, request);
        const confidence = this.calculateAggregatedConfidence(results);
        const sources = results.map(r => r.source);
        
        return {
            query: request.query,
            results,
            aggregated: {
                summary,
                recommendations,
                confidence,
                sources
            }
        };
    }

    async generateSummary(results, request) {
        // Basit summary generation - gerçek implementasyonda NLP kullanılabilir
        const topResults = results.slice(0, 3);
        const summaryParts = topResults.map(r => 
            `${r.source}: ${r.content?.substring(0, 100)}...`
        );
        
        return `Query: "${request.query}"\n\n${summaryParts.join('\n\n')}`;
    }

    generateRecommendations(results, request) {
        const recommendations = [];
        
        // Priority-based recommendations
        if (request.priority === 'urgent') {
            recommendations.push('Immediate action may be required');
        }
        
        // Source-based recommendations
        const hasCompliance = results.some(r => r.source.includes('compliance'));
        if (hasCompliance) {
            recommendations.push('Check compliance requirements');
        }
        
        const hasIncident = results.some(r => r.source.includes('incident'));
        if (hasIncident) {
            recommendations.push('Review related incident reports');
        }
        
        return recommendations;
    }

    calculateAggregatedConfidence(results) {
        if (results.length === 0) return 0;
        
        const weightedSum = results.reduce((sum, result) => {
            return sum + (result.confidence * result.relevance);
        }, 0);
        
        const weightSum = results.reduce((sum, result) => sum + result.relevance, 0);
        
        return weightSum > 0 ? weightedSum / weightSum : 0;
    }

    generateCacheKey(request) {
        const keyParts = [
            request.scope,
            request.query,
            request.format,
            JSON.stringify(request.context || {}),
            JSON.stringify(request.requiredSources || [])
        ];
        
        return keyParts.join('|');
    }

    getCachedResult(cacheKey, priority) {
        const cached = this.state.cache.get(cacheKey);
        if (!cached) return null;
        
        const now = Date.now();
        const ttlMs = this.calculateCacheTtl(priority) * 60 * 1000;
        
        if (now - cached.timestamp > ttlMs) {
            this.state.cache.delete(cacheKey);
            return null;
        }
        
        return cached.data;
    }

    cacheResult(cacheKey, data, priority) {
        const cacheEntry = {
            data,
            timestamp: Date.now(),
            priority,
            hits: 0
        };
        
        this.state.cache.set(cacheKey, cacheEntry);
        
        // Cache size management
        if (this.state.cache.size > this.config.cache.maxEntries) {
            this.evictLeastUsedCache();
        }
    }

    calculateCacheTtl(priority) {
        const baseTtl = this.config.cache.defaultTtlMin;
        const multiplier = this.config.cache.priorityMultiplier[priority] || 1;
        return baseTtl * multiplier;
    }

    evictLeastUsedCache() {
        let leastUsed = null;
        let minHits = Infinity;
        
        for (const [key, entry] of this.state.cache.entries()) {
            if (entry.hits < minHits) {
                minHits = entry.hits;
                leastUsed = key;
            }
        }
        
        if (leastUsed) {
            this.state.cache.delete(leastUsed);
        }
    }

    cleanupExpiredCache() {
        const now = Date.now();
        const expiredKeys = [];
        
        for (const [key, entry] of this.state.cache.entries()) {
            const ttlMs = this.calculateCacheTtl(entry.priority) * 60 * 1000;
            if (now - entry.timestamp > ttlMs) {
                expiredKeys.push(key);
            }
        }
        
        expiredKeys.forEach(key => this.state.cache.delete(key));
        
        if (expiredKeys.length > 0) {
            this.logger.info(`Cleaned up ${expiredKeys.length} expired cache entries`);
        }
    }

    processKnowledgeUpdateNotification(notification) {
        this.logger.info(`Knowledge update: ${notification.source} - ${notification.updateType}`);
        
        if (notification.invalidateCache) {
            this.invalidateRelatedCache(notification);
        }
        
        // Source health update
        if (notification.updateType === 'new' || notification.updateType === 'updated') {
            const health = this.state.sourceHealth.get(notification.source);
            if (health) {
                health.lastCheck = notification.timestamp;
            }
        }
    }

    invalidateRelatedCache(notification) {
        const keysToInvalidate = [];
        
        for (const [key, entry] of this.state.cache.entries()) {
            if (notification.affectedQueries) {
                const matchesQuery = notification.affectedQueries.some(query => 
                    key.includes(query)
                );
                if (matchesQuery) {
                    keysToInvalidate.push(key);
                }
            } else if (key.includes(notification.source)) {
                keysToInvalidate.push(key);
            }
        }
        
        keysToInvalidate.forEach(key => this.state.cache.delete(key));
        this.logger.info(`Invalidated ${keysToInvalidate.length} cache entries`);
    }

    updateSourceHealth(healthUpdate) {
        const current = this.state.sourceHealth.get(healthUpdate.source);
        if (!current) return;
        
        current.status = healthUpdate.status;
        current.latencyMs = healthUpdate.latencyMs;
        current.errorRate = healthUpdate.errorRate;
        current.lastCheck = healthUpdate.timestamp;
        
        this.logger.info(`Source health updated: ${healthUpdate.source} - ${healthUpdate.status}`);
    }

    updateSourceMetrics(source, latency, success) {
        const health = this.state.sourceHealth.get(source);
        if (!health) return;
        
        health.latencyMs = latency;
        health.lastCheck = new Date().toISOString();
        
        if (success) {
            health.consecutiveErrors = 0;
        } else {
            health.consecutiveErrors++;
            this.state.metrics.sourceErrors++;
        }
    }

    handleSourceFailure(source, error) {
        const circuit = this.state.circuitBreakers.get(source);
        if (!circuit) return;
        
        circuit.failureCount++;
        circuit.lastFailure = new Date().toISOString();
        
        // Circuit breaker opening logic
        if (circuit.failureCount >= this.config.circuit.failureThreshold) {
            circuit.state = 'open';
            circuit.nextAttempt = Date.now() + this.config.circuit.resetTimeoutMs;
            
            this.logger.warn(`Circuit breaker opened for source: ${source}`);
            this.emitAlert('warning', `Source ${source} circuit breaker opened`);
        }
    }

    async performHealthChecks() {
        for (const [source, config] of Object.entries(this.config.sources)) {
            try {
                const healthCheck = await this.checkSourceHealth(source, config);
                this.updateSourceHealthFromCheck(source, healthCheck);
            } catch (error) {
                this.logger.error(`Health check failed for ${source}:`, error);
                this.markSourceUnhealthy(source);
            }
        }
    }

    async checkSourceHealth(source, config) {
        // Basit health check simulation
        const latency = Math.random() * config.timeoutMs * 0.5;
        const isHealthy = Math.random() > 0.1; // %90 healthy
        
        return {
            status: isHealthy ? 'healthy' : 'degraded',
            latencyMs: latency,
            errorRate: isHealthy ? 0 : 0.15,
            timestamp: new Date().toISOString()
        };
    }

    updateSourceHealthFromCheck(source, healthCheck) {
        const health = this.state.sourceHealth.get(source);
        if (health) {
            Object.assign(health, healthCheck);
        }
    }

    markSourceUnhealthy(source) {
        const health = this.state.sourceHealth.get(source);
        if (health) {
            health.status = 'offline';
            health.consecutiveErrors++;
            health.lastCheck = new Date().toISOString();
        }
    }

    updateAverageResponseTime(responseTime) {
        const currentAvg = this.state.metrics.avgResponseMs;
        const requestCount = this.state.metrics.requests + 1;
        
        this.state.metrics.avgResponseMs = 
            (currentAvg * this.state.metrics.requests + responseTime) / requestCount;
    }

    sendSuccessResponse(request, aggregatedData, startTime) {
        const response = {
            event: 'knowledge.response',
            timestamp: new Date().toISOString(),
            requestId: request.requestId,
            success: true,
            data: aggregatedData,
            metrics: {
                totalMs: Date.now() - startTime,
                sourceCount: aggregatedData.results?.length || 0,
                cacheHit: false
            }
        };

        this.eventBus.emit('knowledge.response', response);
        this.logger.info(`Knowledge response sent for ${request.requestId} (${response.metrics.totalMs}ms)`);
    }

    sendCachedResponse(request, cachedData, startTime) {
        const response = {
            event: 'knowledge.response',
            timestamp: new Date().toISOString(),
            requestId: request.requestId,
            success: true,
            data: cachedData,
            metrics: {
                totalMs: Date.now() - startTime,
                sourceCount: cachedData.results?.length || 0,
                cacheHit: true
            }
        };

        this.eventBus.emit('knowledge.response', response);
        this.logger.info(`Cached knowledge response sent for ${request.requestId}`);
    }

    sendErrorResponse(requestId, errorMessage, startTime = Date.now()) {
        const response = {
            event: 'knowledge.response',
            timestamp: new Date().toISOString(),
            requestId,
            success: false,
            error: errorMessage,
            metrics: {
                totalMs: Date.now() - startTime,
                sourceCount: 0,
                cacheHit: false
            }
        };

        this.eventBus.emit('knowledge.response', response);
        this.logger.error(`Knowledge error response sent for ${requestId}: ${errorMessage}`);
    }

    emitAlert(level, message) {
        const event = {
            event: 'knowledge.alert',
            timestamp: new Date().toISOString(),
            level,
            message,
            sourceHealth: Object.fromEntries(this.state.sourceHealth),
            circuitBreakers: Object.fromEntries(this.state.circuitBreakers)
        };

        this.eventBus.emit('knowledge.alert', event);
        this.logger.warn(`Knowledge alert: ${level} - ${message}`);
    }

    emitMetrics() {
        const event = {
            event: 'knowledge.metrics',
            timestamp: new Date().toISOString(),
            ...this.state.metrics,
            activeRequests: this.state.activeRequests.size,
            cacheEntries: this.state.cache.size,
            cacheHitRate: this.state.metrics.requests > 0 ? 
                (this.state.metrics.cacheHits / this.state.metrics.requests) : 0,
            sourceHealthSummary: this.getSourceHealthSummary()
        };

        this.eventBus.emit('knowledge.metrics', event);
    }

    getSourceHealthSummary() {
        const summary = { healthy: 0, degraded: 0, offline: 0 };
        
        for (const health of this.state.sourceHealth.values()) {
            summary[health.status]++;
        }
        
        return summary;
    }

    getStatus() {
        return {
            name: this.name,
            initialized: this.isInitialized,
            activeRequests: this.state.activeRequests.size,
            cacheEntries: this.state.cache.size,
            sourceHealth: Object.fromEntries(this.state.sourceHealth),
            circuitBreakers: Object.fromEntries(this.state.circuitBreakers),
            metrics: {
                ...this.state.metrics,
                cacheHitRate: this.state.metrics.requests > 0 ? 
                    (this.state.metrics.cacheHits / this.state.metrics.requests) : 0
            }
        };
    }

    async shutdown() {
        try {
            this.logger.info(`${this.name} durduruluyor...`);
            
            if (this.healthCheckInterval) {
                clearInterval(this.healthCheckInterval);
                this.healthCheckInterval = null;
            }
            
            // Active requests'i abort et
            for (const [requestId, request] of this.state.activeRequests.entries()) {
                this.sendErrorResponse(requestId, 'System shutdown');
            }
            this.state.activeRequests.clear();
            
            // Son metrics emit et
            this.emitMetrics();
            
            this.isInitialized = false;
            this.logger.info(`${this.name} başarıyla durduruldu`);
        } catch (error) {
            this.logger.error(`${this.name} durdurma hatası:`, error);
        }
    }
}

module.exports = KnowledgeRouterBridge;