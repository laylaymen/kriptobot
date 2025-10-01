/**
 * LIVIA-58: Knowledge Freshness Guard
 * Bilgi kaynakları tazelik koruyucu sistemi
 * Amaç: Kaynak tazeliğini izleyip bayat risk düşürme, otomatik recrawl/reindex
 */

const crypto = require('crypto');
const { EventEmitter } = require('events');
const { trace, context, SpanStatusCode } = require('@opentelemetry/api');

class KnowledgeFreshnessGuard extends EventEmitter {
    constructor(config = {}) {
        super();
        
        this.name = 'KnowledgeFreshnessGuard';
        this.config = {
            enabled: true,
            locale: 'tr-TR',
            timezone: 'Europe/Istanbul',
            ttlDaysBySourceType: {
                news: 2,
                pricing: 1,
                market: 1,
                docs: 90,
                faq: 30,
                regulatory: 7,
                changelog: 14
            },
            criticalDomains: ['pricing', 'market', 'status', 'incident', 'release_notes'],
            recrawlBudget: {
                maxRequestsPerHour: 300,
                maxBytesPerDayMB: 800
            },
            reindex: {
                minChangePctForRebuild: 3,
                canaryTrafficPct: 10,
                promoteAfterMin: 20,
                rollbackOn: { ndcgDropPct: 3.0, p95RiseMs: 80 }
            },
            stalenessThreshold: {
                warnScore: 0.6,
                blockScore: 0.8
            },
            scoring: {
                weights: { age: 0.35, lag: 0.25, ttl: 0.25, volatility: 0.10, coverage: 0.05 },
                normalize: { maxAgeDays: 365, maxLagSec: 7200 },
                volatilityTable: {
                    pricing: 0.9,
                    market: 0.8,
                    news: 0.7,
                    docs: 0.2,
                    faq: 0.1
                }
            },
            recrawl: {
                schedulerCron: '*/15 * * * *',
                deltaPreferred: true,
                backoff: { baseSec: 60, maxSec: 1800 },
                budget: { maxRequestsPerHour: 300, maxBytesPerDayMB: 800 },
                robotsRespect: true
            },
            pingTargets: {
                pricing: { enable: true, timeoutMs: 1500 },
                status: { enable: true, timeoutMs: 1500 },
                market: { enable: true, timeoutMs: 1500 },
                custom: { enable: true }
            },
            querySensitivity: {
                classifier: 'temporal-intent-v1',
                labels: {
                    high: ['today', 'now', 'son dakika', 'bugün', 'şimdi', 'aylık oran', 'APR', 'fiyat']
                },
                default: 'auto',
                escalateIf: ['pricing', 'market', 'incident', 'release_notes']
            },
            retrievalHints: {
                boostRecentAlpha: 0.25,
                sinceDays: 7,
                demoteOnlyIfTtlExceeded: true,
                preferSourcesWeight: 1.2
            },
            idempotencyTtlSec: 1800,
            ...config
        };
        
        // State management
        this.state = 'IDLE';
        this.sources = new Map(); // Source tracking
        this.jobQueue = new Map(); // Pending recrawl/reindex jobs
        this.snapshots = new Map(); // Freshness snapshots
        this.metrics = {
            snapshots: 0,
            avgScore: 0,
            atRisk: 0,
            stale: 0,
            recrawls: 0,
            reindexes: 0,
            canaryPromotes: 0,
            avgCrawlMs: 0,
            avgIndexMs: 0,
            pingOkPct: 100,
            budgetUsePct: 0
        };
        
        this.isInitialized = false;
        this.logger = null;
        this.tracer = trace.getTracer('livia-knowledge-freshness-guard');
        
        // FSM states
        this.states = ['IDLE', 'SCORE', 'PLAN_AT_RISK', 'PLAN_BLOCK', 'PLAN_ONLY', 'APPLY', 'PING', 'EMIT_HINTS', 'EMIT', 'ALERT'];
    }

    async initialize(eventBus, logger) {
        try {
            this.eventBus = eventBus;
            this.logger = logger;
            this.logger.info(`${this.name} başlatılıyor...`);
            
            // Event listeners
            this.setupEventListeners();
            
            // Initialize scheduler
            this.initializeScheduler();
            
            this.isInitialized = true;
            this.logger.info(`${this.name} başarıyla başlatıldı`);
            return true;
        } catch (error) {
            this.logger.error(`${this.name} başlatma hatası:`, error);
            return false;
        }
    }

    setupEventListeners() {
        // Knowledge lifecycle events
        this.eventBus.on('knowledge.source.registered', this.handleSourceRegistered.bind(this));
        this.eventBus.on('knowledge.crawl.finished', this.handleCrawlFinished.bind(this));
        this.eventBus.on('knowledge.ingest.finished', this.handleIngestFinished.bind(this));
        this.eventBus.on('index.build.completed', this.handleIndexCompleted.bind(this));
        this.eventBus.on('fsync.lag.snapshot', this.handleFsyncLag.bind(this));
        
        // Query events
        this.eventBus.on('qo.query.context', this.handleQueryContext.bind(this));
        
        // Ping events
        this.eventBus.on('knowledge.ping.request', this.handlePingRequest.bind(this));
        this.eventBus.on('knowledge.ping.result', this.handlePingResult.bind(this));
        
        // System events
        this.eventBus.on('change.log.published', this.handleChangeLogPublished.bind(this));
        this.eventBus.on('freeze.state.changed', this.handleFreezeStateChanged.bind(this));
        
        // Policy updates
        this.eventBus.on('freshness.policy.updated', this.handlePolicyUpdate.bind(this));
    }

    initializeScheduler() {
        // Set up periodic freshness checks
        this.schedulerInterval = setInterval(() => {
            if (this.isInitialized && this.config.enabled) {
                this.runFreshnessCheck();
            }
        }, 15 * 60 * 1000); // Every 15 minutes
    }

    async runFreshnessCheck() {
        const span = this.tracer.startSpan('freshness.check');
        
        try {
            // Generate freshness snapshot
            await this.generateFreshnessSnapshot(span);
            
            span.setStatus({ code: SpanStatusCode.OK });
            
        } catch (error) {
            span.recordException(error);
            span.setStatus({ code: SpanStatusCode.ERROR });
            this.logger.error('Freshness check failed:', error);
        } finally {
            span.end();
        }
    }

    async generateFreshnessSnapshot(span) {
        const scoreSpan = this.tracer.startSpan('freshness.score', { parent: span });
        
        try {
            this.state = 'SCORE';
            
            const namespace = 'kb_default';
            const now = new Date();
            
            // Calculate freshness score
            const scoreResult = await this.calculateFreshnessScore(namespace, now);
            
            // Determine status and actions
            const { score, components, topStale, indexLagSec } = scoreResult;
            let status = 'ok';
            
            if (score >= this.config.stalenessThreshold.blockScore) {
                status = 'stale';
                this.state = 'PLAN_BLOCK';
            } else if (score >= this.config.stalenessThreshold.warnScore) {
                status = 'at_risk';
                this.state = 'PLAN_AT_RISK';
            }
            
            // Create snapshot
            const snapshot = {
                event: 'freshness.snapshot',
                timestamp: now.toISOString(),
                namespace,
                score: Math.round(score * 100) / 100,
                components,
                topStale,
                indexLagSec,
                status
            };
            
            this.snapshots.set(namespace, snapshot);
            this.emit('freshness.snapshot', snapshot);
            
            // Handle risk if needed
            if (status !== 'ok') {
                await this.handleStaleRisk(namespace, score, status, scoreSpan);
            }
            
            // Update metrics
            this.updateMetrics(snapshot);
            
            scoreSpan.setStatus({ code: SpanStatusCode.OK });
            
        } catch (error) {
            scoreSpan.recordException(error);
            scoreSpan.setStatus({ code: SpanStatusCode.ERROR });
            throw error;
        } finally {
            scoreSpan.end();
        }
    }

    async calculateFreshnessScore(namespace, now) {
        // Mock implementation - in production, would query actual data sources
        const sources = Array.from(this.sources.values());
        const weights = this.config.scoring.weights;
        
        let totalScore = 0;
        let ageComponent = 0;
        let lagComponent = 0;
        let ttlComponent = 0;
        let volatilityAdj = 0;
        let coverageAdj = 0;
        
        const topStale = [];
        
        // Calculate components for each source
        for (const source of sources) {
            const ageDays = source.lastUpdate ? (now - new Date(source.lastUpdate)) / (1000 * 60 * 60 * 24) : 30;
            const ttlDays = this.config.ttlDaysBySourceType[source.type] || 30;
            const volatility = this.config.scoring.volatilityTable[source.type] || 0.5;
            
            // Age score (0-1, higher is worse)
            const ageScore = Math.min(ageDays / this.config.scoring.normalize.maxAgeDays, 1);
            
            // TTL breach (binary)
            const ttlScore = ageDays > ttlDays ? 1 : 0;
            
            // Lag score (based on processing delays)
            const lagSec = source.lagSec || 0;
            const lagScore = Math.min(lagSec / this.config.scoring.normalize.maxLagSec, 1);
            
            // Source-level score
            const sourceScore = (
                weights.age * ageScore +
                weights.lag * lagScore +
                weights.ttl * ttlScore +
                weights.volatility * volatility
            );
            
            totalScore += sourceScore;
            ageComponent += ageScore;
            lagComponent += lagScore;
            ttlComponent += ttlScore;
            volatilityAdj += volatility;
            
            // Track stale sources
            if (ttlScore > 0) {
                topStale.push({
                    sourceId: source.id,
                    ageDays: Math.round(ageDays),
                    ttlDays
                });
            }
        }
        
        // Normalize by number of sources
        const numSources = Math.max(sources.length, 1);
        const avgScore = totalScore / numSources;
        
        // Critical domain coverage adjustment
        const criticalSourcesCount = sources.filter(s => 
            this.config.criticalDomains.includes(s.type)
        ).length;
        
        if (criticalSourcesCount < this.config.criticalDomains.length) {
            coverageAdj = -0.1; // Penalty for missing critical sources
        }
        
        const finalScore = Math.max(0, Math.min(1, avgScore + coverageAdj));
        
        return {
            score: finalScore,
            components: {
                ageScore: Math.round(ageComponent / numSources * 100) / 100,
                lagScore: Math.round(lagComponent / numSources * 100) / 100,
                ttlScore: Math.round(ttlComponent / numSources * 100) / 100,
                volatilityAdj: Math.round(volatilityAdj / numSources * 100) / 100,
                coverageAdj: Math.round(coverageAdj * 100) / 100
            },
            topStale: topStale.slice(0, 5), // Top 5 stale sources
            indexLagSec: 420 // Mock index lag
        };
    }

    async handleStaleRisk(namespace, score, status, span) {
        const riskSpan = this.tracer.startSpan('freshness.stale_risk', { parent: span });
        
        try {
            const severity = status === 'stale' ? 'high' : 'warn';
            const reason = score >= this.config.stalenessThreshold.blockScore ? 
                'ttl_exceeded' : 'index_lag';
            
            // Emit stale risk event
            this.emit('stale.risk.triggered', {
                event: 'stale.risk.triggered',
                timestamp: new Date().toISOString(),
                namespace,
                severity,
                reason,
                score: Math.round(score * 100) / 100,
                hints: {
                    boostRecent: true,
                    forcePing: this.config.criticalDomains.includes('pricing') ? 'pricing' : null
                }
            });
            
            // Plan remediation actions
            await this.planRemediation(namespace, severity, riskSpan);
            
            riskSpan.setStatus({ code: SpanStatusCode.OK });
            
        } catch (error) {
            riskSpan.recordException(error);
            riskSpan.setStatus({ code: SpanStatusCode.ERROR });
            throw error;
        } finally {
            riskSpan.end();
        }
    }

    async planRemediation(namespace, severity, span) {
        const planSpan = this.tracer.startSpan('freshness.plan_remediation', { parent: span });
        
        try {
            // Schedule recrawl for stale sources
            const staleSources = Array.from(this.sources.values())
                .filter(s => this.isSourceStale(s));
            
            for (const source of staleSources.slice(0, 3)) { // Limit to 3 sources per batch
                await this.scheduleRecrawl(source);
            }
            
            // Schedule reindex if significant changes
            if (staleSources.length >= 2) {
                await this.scheduleReindex(namespace);
            }
            
            // Send retrieval hints to query orchestrator
            await this.sendRetrievalHints(namespace);
            
            planSpan.setStatus({ code: SpanStatusCode.OK });
            
        } catch (error) {
            planSpan.recordException(error);
            planSpan.setStatus({ code: SpanStatusCode.ERROR });
            throw error;
        } finally {
            planSpan.end();
        }
    }

    async scheduleRecrawl(source) {
        const jobId = `recrawl-${source.id}-${Date.now()}`;
        
        // Check budget constraints
        if (!this.checkRecrawlBudget()) {
            this.logger.warn(`Recrawl budget exceeded, skipping ${source.id}`);
            return;
        }
        
        const job = {
            id: jobId,
            sourceId: source.id,
            mode: this.config.recrawl.deltaPreferred ? 'delta' : 'full',
            eta: new Date(Date.now() + 5 * 60 * 1000).toISOString(), // 5 minutes from now
            budget: {
                req: 120,
                bytesMB: 70
            }
        };
        
        this.jobQueue.set(jobId, job);
        
        this.emit('recrawl.scheduled', {
            event: 'recrawl.scheduled',
            timestamp: new Date().toISOString(),
            ...job
        });
        
        this.metrics.recrawls++;
    }

    async scheduleReindex(namespace) {
        const indexId = `ivf-pq-384-np16-${new Date().toISOString().split('T')[0]}-canary`;
        
        const job = {
            namespace,
            indexId,
            canaryTrafficPct: this.config.reindex.canaryTrafficPct,
            promoteAfterMin: this.config.reindex.promoteAfterMin
        };
        
        this.emit('reindex.scheduled', {
            event: 'reindex.scheduled',
            timestamp: new Date().toISOString(),
            ...job
        });
        
        this.metrics.reindexes++;
    }

    async sendRetrievalHints(namespace) {
        const hints = {
            event: 'qo.retrieval.boost.hint',
            timestamp: new Date().toISOString(),
            namespace,
            actions: [
                {
                    type: 'boost_recent',
                    alpha: this.config.retrievalHints.boostRecentAlpha,
                    sinceDays: this.config.retrievalHints.sinceDays
                },
                {
                    type: 'demote_stale',
                    ttlExceededOnly: this.config.retrievalHints.demoteOnlyIfTtlExceeded
                },
                {
                    type: 'prefer_sources',
                    ids: this.config.criticalDomains.map(domain => `src#${domain}`),
                    weight: this.config.retrievalHints.preferSourcesWeight
                }
            ]
        };
        
        this.emit('qo.retrieval.boost.hint', hints);
    }

    // Event handlers
    handleSourceRegistered(event) {
        const { sourceId, type, fetch, updateHint } = event;
        
        this.sources.set(sourceId, {
            id: sourceId,
            type,
            fetch,
            updateHint,
            lastUpdate: null,
            lagSec: 0,
            registered: new Date().toISOString()
        });
        
        this.logger.debug(`Knowledge source registered: ${sourceId} (${type})`);
    }

    handleCrawlFinished(event) {
        const { sourceId, fetchedDocs, bytesMB, latestDocAt, etag } = event;
        
        const source = this.sources.get(sourceId);
        if (source) {
            source.lastUpdate = latestDocAt;
            source.fetchedDocs = fetchedDocs;
            source.etag = etag;
            
            // Update crawl metrics
            this.metrics.avgCrawlMs = (this.metrics.avgCrawlMs * 0.9) + (8200 * 0.1); // Mock timing
        }
        
        this.logger.debug(`Crawl finished for ${sourceId}: ${fetchedDocs} docs, ${bytesMB}MB`);
    }

    handleIngestFinished(event) {
        const { sourceId, normalizedDocs, watermark } = event;
        
        const source = this.sources.get(sourceId);
        if (source) {
            source.watermark = watermark;
            source.normalizedDocs = normalizedDocs;
        }
        
        this.logger.debug(`Ingest finished for ${sourceId}: ${normalizedDocs} docs`);
    }

    handleIndexCompleted(event) {
        const { namespace, indexId, lagSec, sizeGB } = event;
        
        // Update index lag for sources
        for (const source of this.sources.values()) {
            source.lagSec = lagSec;
        }
        
        // Update index metrics
        this.metrics.avgIndexMs = (this.metrics.avgIndexMs * 0.9) + (92000 * 0.1); // Mock timing
        
        this.logger.debug(`Index build completed: ${indexId}, lag ${lagSec}s, size ${sizeGB}GB`);
    }

    handleFsyncLag(event) {
        const { namespace, lagSec, queueDepth } = event;
        
        // Update lag information
        for (const source of this.sources.values()) {
            source.lagSec = Math.max(source.lagSec || 0, lagSec);
        }
        
        this.logger.debug(`Fsync lag: ${lagSec}s, queue depth: ${queueDepth}`);
    }

    handleQueryContext(event) {
        const { id: queryId, text, timeSensitivity } = event;
        
        // Check if query is time-sensitive
        const isTimeSensitive = this.classifyQuerySensitivity(text, timeSensitivity);
        
        if (isTimeSensitive) {
            // Trigger immediate freshness check for critical domains
            this.triggerPingForQuery(queryId, text);
        }
    }

    classifyQuerySensitivity(text, explicitSensitivity) {
        if (explicitSensitivity === 'high') return true;
        
        const lowerText = text.toLowerCase();
        const highSensitivityKeywords = this.config.querySensitivity.labels.high;
        
        return highSensitivityKeywords.some(keyword => lowerText.includes(keyword));
    }

    async triggerPingForQuery(queryId, text) {
        // Determine which targets to ping based on query
        const targets = [];
        
        if (text.includes('fiyat') || text.includes('APR') || text.includes('oran')) {
            targets.push('pricing');
        }
        
        if (text.includes('piyasa') || text.includes('market')) {
            targets.push('market');
        }
        
        // Trigger pings
        for (const target of targets) {
            this.emit('knowledge.ping.request', {
                event: 'knowledge.ping.request',
                timestamp: new Date().toISOString(),
                target,
                args: this.extractPingArgs(text, target)
            });
        }
    }

    extractPingArgs(text, target) {
        // Extract arguments for ping based on target and query text
        const args = {};
        
        if (target === 'pricing') {
            // Try to extract symbol/pair from query
            const symbols = ['AVAX', 'BTC', 'ETH', 'BNB'];
            const foundSymbol = symbols.find(symbol => text.toUpperCase().includes(symbol));
            
            if (foundSymbol) {
                args.symbol = foundSymbol;
                args.pair = 'USDT';
            }
        }
        
        return args;
    }

    handlePingRequest(event) {
        // Log ping request
        this.logger.debug(`Ping requested for ${event.target}:`, event.args);
    }

    handlePingResult(event) {
        const { target, ok, ageSec, provider } = event;
        
        // Update ping metrics
        if (ok) {
            this.metrics.pingOkPct = (this.metrics.pingOkPct * 0.95) + (100 * 0.05);
        } else {
            this.metrics.pingOkPct = (this.metrics.pingOkPct * 0.95) + (0 * 0.05);
        }
        
        this.logger.debug(`Ping result for ${target}: ${ok ? 'OK' : 'FAIL'}, age ${ageSec}s`);
    }

    handleChangeLogPublished(event) {
        const { sourceId, version, notes } = event;
        
        // Update source information
        const source = this.sources.get(sourceId);
        if (source) {
            source.version = version;
            source.lastChangeLog = event.timestamp;
        }
        
        this.logger.info(`Change log published for ${sourceId}: ${version}`);
    }

    handleFreezeStateChanged(event) {
        const { state, scope, reason } = event;
        
        if (state === 'frozen') {
            this.state = 'PLAN_ONLY';
            this.logger.warn(`Freeze activated: ${scope} (${reason})`);
        } else {
            this.state = 'IDLE';
            this.logger.info(`Freeze lifted: ${scope}`);
        }
    }

    handlePolicyUpdate(event) {
        this.logger.info(`${this.name} policy updating...`);
        
        const { ttlDaysBySourceType, criticalDomains, recrawlBudget, stalenessThreshold } = event;
        
        if (ttlDaysBySourceType) Object.assign(this.config.ttlDaysBySourceType, ttlDaysBySourceType);
        if (criticalDomains) this.config.criticalDomains = criticalDomains;
        if (recrawlBudget) Object.assign(this.config.recrawlBudget, recrawlBudget);
        if (stalenessThreshold) Object.assign(this.config.stalenessThreshold, stalenessThreshold);
    }

    // Utility methods
    isSourceStale(source) {
        if (!source.lastUpdate) return true;
        
        const ageDays = (Date.now() - new Date(source.lastUpdate).getTime()) / (1000 * 60 * 60 * 24);
        const ttlDays = this.config.ttlDaysBySourceType[source.type] || 30;
        
        return ageDays > ttlDays;
    }

    checkRecrawlBudget() {
        // Simple budget check - in production would track actual usage
        this.metrics.budgetUsePct = Math.min(this.metrics.budgetUsePct + 5, 100);
        return this.metrics.budgetUsePct < 90;
    }

    updateMetrics(snapshot) {
        this.metrics.snapshots++;
        this.metrics.avgScore = (this.metrics.avgScore * 0.9) + (snapshot.score * 0.1);
        
        if (snapshot.status === 'at_risk') this.metrics.atRisk++;
        if (snapshot.status === 'stale') this.metrics.stale++;
        
        // Emit metrics
        this.emit('freshness.metrics', {
            event: 'freshness.metrics',
            timestamp: new Date().toISOString(),
            ...this.metrics
        });
    }

    emitCard(title, body, severity = 'info') {
        this.emit('freshness.card', {
            event: 'freshness.card',
            timestamp: new Date().toISOString(),
            title,
            body,
            severity,
            ttlSec: 600
        });
    }

    getStatus() {
        return {
            name: this.name,
            initialized: this.isInitialized,
            state: this.state,
            sources: this.sources.size,
            jobQueue: this.jobQueue.size,
            snapshots: this.snapshots.size,
            metrics: this.metrics,
            config: {
                enabled: this.config.enabled,
                locale: this.config.locale,
                timezone: this.config.timezone,
                criticalDomains: this.config.criticalDomains,
                stalenessThresholds: this.config.stalenessThreshold
            }
        };
    }

    async shutdown() {
        try {
            this.logger.info(`${this.name} durduruluyor...`);
            
            // Clear scheduler
            if (this.schedulerInterval) {
                clearInterval(this.schedulerInterval);
            }
            
            // Clear data structures
            this.sources.clear();
            this.jobQueue.clear();
            this.snapshots.clear();
            
            this.isInitialized = false;
            this.logger.info(`${this.name} başarıyla durduruldu`);
        } catch (error) {
            this.logger.error(`${this.name} durdurma hatası:`, error);
        }
    }
}

module.exports = KnowledgeFreshnessGuard;