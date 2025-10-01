/**
 * LIVIA-47: KB Index Auto-tuner
 * Bilgi tabanı arama indekslerinin otomatik optimizasyon modülü
 * 
 * Bu modül vektör indeks parametrelerini, embedding boyutlarını,
 * hybrid search ağırlıklarını ve cache politikalarını otomatik ayarlar.
 */

const { eventBus } = require('../../kirpto bot sinyal/modules/modularEventStream');

class KBIndexAutotuner {
    constructor(config = {}) {
        this.name = 'KBIndexAutotuner';
        this.config = {
            enabled: true,
            profiles: ['global', 'tr', 'en', 'faq', 'code'],
            indexTypes: ['hnsw', 'ivf', 'ivf_pq'],
            embeddingDims: [256, 512, 768, 1024],
            optimizationIntervalMs: 3600000, // 1 saat
            performanceThresholds: {
                latencyMs: 200,
                qualityScore: 0.85,
                costPerQuery: 0.001
            },
            abTestConfig: {
                trafficSplit: 0.1, // %10 test trafiği
                minSamples: 1000,
                confidenceLevel: 0.95
            },
            ...config
        };
        this.isInitialized = false;
        this.logger = null;
        this.indexConfigs = new Map();
        this.performanceMetrics = new Map();
        this.optimizationHistory = new Map();
        this.abTests = new Map();
        this.tuningTimer = null;
    }

    /**
     * Modülü başlat
     */
    async initialize(logger) {
        try {
            this.logger = logger;
            this.logger.info(`${this.name} başlatılıyor...`);
            
            await this.setupIndexProfiles();
            await this.setupEventListeners();
            await this.startAutoTuning();
            
            this.isInitialized = true;
            this.logger.info(`${this.name} başarıyla başlatıldı`);
            return true;
        } catch (error) {
            this.logger.error(`${this.name} başlatma hatası:`, error);
            return false;
        }
    }

    /**
     * İndeks profillerini kurula
     */
    async setupIndexProfiles() {
        for (const profile of this.config.profiles) {
            this.indexConfigs.set(profile, {
                profile,
                currentConfig: this.getDefaultConfig(profile),
                candidates: [],
                performance: {
                    latencyMs: 0,
                    qualityScore: 0,
                    costPerQuery: 0,
                    throughput: 0
                },
                lastOptimization: null
            });
            
            this.performanceMetrics.set(profile, {
                queries: [],
                avgLatency: 0,
                avgQuality: 0,
                totalCost: 0,
                searchVolume: 0
            });
        }
        
        this.logger.info(`${this.config.profiles.length} indeks profili kuruldu`);
    }

    /**
     * Varsayılan config al
     */
    getDefaultConfig(profile) {
        const defaults = {
            indexType: 'hnsw',
            embeddingDim: 768,
            quantization: 'fp32',
            params: {
                hnsw: { M: 32, efSearch: 256 },
                ivf: { nlist: 4096, nprobe: 8 },
                pq: { m: 16, codeBits: 8 }
            },
            hybrid: { alpha: 0.35 }, // BM25 vs dense weight
            reranker: 'ce-small',
            topK: 50,
            cache: {
                enabled: true,
                ttlSec: 3600,
                maxSize: 10000
            }
        };

        // Profile özel ayarlar
        if (profile === 'faq') {
            defaults.hybrid.alpha = 0.6; // FAQ için daha çok BM25
            defaults.topK = 20;
        } else if (profile === 'code') {
            defaults.embeddingDim = 512; // Kod için daha küçük dim
            defaults.hybrid.alpha = 0.2; // Kod için daha çok semantic
        }

        return defaults;
    }

    /**
     * Event dinleyicileri kurulum
     */
    async setupEventListeners() {
        // Arama performans logları
        eventBus.on('search.query.logged', async (data) => {
            await this.logSearchPerformance(data);
        });

        // İndeks status güncellemeleri
        eventBus.on('kb.index.stats', async (data) => {
            await this.updateIndexStats(data);
        });

        // Optimizasyon istekleri
        eventBus.on('kb.optimize.request', async (data) => {
            await this.performOptimization(data);
        });

        // A/B test sonuçları
        eventBus.on('kb.abtest.result', async (data) => {
            await this.processABTestResult(data);
        });

        this.logger.info('KB index autotuner event listeners kuruldu');
    }

    /**
     * Otomatik tuning başlat
     */
    async startAutoTuning() {
        this.tuningTimer = setInterval(async () => {
            await this.performPeriodicOptimization();
        }, this.config.optimizationIntervalMs);
        
        // İlk optimizasyonu 5 dakika sonra yap
        setTimeout(async () => {
            await this.performPeriodicOptimization();
        }, 300000);
    }

    /**
     * Arama performansını logla
     */
    async logSearchPerformance(data) {
        try {
            const { namespace, profile, query, results, latencyMs, costUsd, clicks } = data;
            
            if (!this.performanceMetrics.has(profile)) {
                return;
            }

            const metrics = this.performanceMetrics.get(profile);
            const qualityScore = this.calculateQueryQuality(results, clicks);

            // Query log ekle
            metrics.queries.push({
                timestamp: new Date().toISOString(),
                query: query.q,
                latencyMs,
                costUsd,
                qualityScore,
                topK: results.topK,
                hybridAlpha: results.hybridAlpha,
                reranker: results.reranker
            });

            // Sliding window - son 1000 query tut
            if (metrics.queries.length > 1000) {
                metrics.queries.shift();
            }

            // Metrikleri güncelle
            this.updateAggregateMetrics(profile);

            // Performance threshold kontrolü
            if (latencyMs > this.config.performanceThresholds.latencyMs) {
                eventBus.emit('kb.performance.alert', {
                    profile,
                    issue: 'high_latency',
                    value: latencyMs,
                    threshold: this.config.performanceThresholds.latencyMs,
                    source: this.name
                });
            }

        } catch (error) {
            this.logger.error('Search performance logging hatası:', error);
        }
    }

    /**
     * Query kalitesi hesapla
     */
    calculateQueryQuality(results, clicks) {
        if (!clicks || clicks.length === 0) {
            return 0.5; // Varsayılan skor
        }

        // CTR ve dwell time bazlı kalite
        let qualityScore = 0;
        let totalClicks = clicks.length;
        
        clicks.forEach(click => {
            // Rank penalty (üstteki sonuçlar daha değerli)
            const rankBonus = 1 / Math.log2(click.rank + 1);
            
            // Dwell time bonus (uzun süre bakılan sonuçlar kaliteli)
            const dwellBonus = Math.min(click.dwellMs / 5000, 1); // 5 saniye max
            
            qualityScore += (rankBonus * dwellBonus) / totalClicks;
        });

        return Math.min(qualityScore, 1.0);
    }

    /**
     * Aggregate metrikleri güncelle
     */
    updateAggregateMetrics(profile) {
        const metrics = this.performanceMetrics.get(profile);
        
        if (metrics.queries.length === 0) return;

        metrics.avgLatency = metrics.queries.reduce((sum, q) => sum + q.latencyMs, 0) / metrics.queries.length;
        metrics.avgQuality = metrics.queries.reduce((sum, q) => sum + q.qualityScore, 0) / metrics.queries.length;
        metrics.totalCost = metrics.queries.reduce((sum, q) => sum + q.costUsd, 0);
        metrics.searchVolume = metrics.queries.length;
    }

    /**
     * İndeks statistics güncelle
     */
    async updateIndexStats(data) {
        try {
            const { namespace, profile, engine, params, docCount, memGB, buildMin } = data;
            
            if (!this.indexConfigs.has(profile)) {
                return;
            }

            const config = this.indexConfigs.get(profile);
            config.stats = {
                engine,
                params,
                docCount,
                memoryUsageGB: memGB,
                buildTimeMin: buildMin,
                lastUpdate: new Date().toISOString()
            };

        } catch (error) {
            this.logger.error('Index stats güncelleme hatası:', error);
        }
    }

    /**
     * Periyodik optimizasyon
     */
    async performPeriodicOptimization() {
        try {
            this.logger.info('Periyodik KB indeks optimizasyonu başlatılıyor...');
            
            for (const profile of this.config.profiles) {
                await this.optimizeProfile(profile);
            }

        } catch (error) {
            this.logger.error('Periyodik optimizasyon hatası:', error);
        }
    }

    /**
     * Profil optimizasyonu yap
     */
    async optimizeProfile(profile) {
        try {
            const config = this.indexConfigs.get(profile);
            const metrics = this.performanceMetrics.get(profile);

            if (!config || metrics.queries.length < 100) {
                this.logger.info(`${profile} profili için yeterli veri yok, optimizasyon atlanıyor`);
                return;
            }

            // Mevcut performansı değerlendir
            const currentPerformance = {
                latency: metrics.avgLatency,
                quality: metrics.avgQuality,
                cost: metrics.totalCost / metrics.searchVolume,
                score: this.calculatePerformanceScore(metrics)
            };

            // Optimizasyon adayları üret
            const candidates = await this.generateOptimizationCandidates(config.currentConfig, currentPerformance);

            // En iyi adayı seç
            const bestCandidate = this.selectBestCandidate(candidates, currentPerformance);

            if (bestCandidate && bestCandidate.expectedScore > currentPerformance.score * 1.05) {
                // %5'ten fazla iyileşme beklentisi varsa test et
                await this.startABTest(profile, bestCandidate);
            }

            // Optimizasyon geçmişi kaydet
            this.optimizationHistory.set(`${profile}-${Date.now()}`, {
                profile,
                currentPerformance,
                candidates: candidates.length,
                bestCandidate,
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            this.logger.error(`${profile} profil optimizasyonu hatası:`, error);
        }
    }

    /**
     * Optimizasyon adaylarını üret
     */
    async generateOptimizationCandidates(currentConfig, performance) {
        const candidates = [];

        // 1. Index type varyasyonları
        for (const indexType of this.config.indexTypes) {
            if (indexType !== currentConfig.indexType) {
                candidates.push({
                    ...currentConfig,
                    indexType,
                    reason: `Index type change: ${currentConfig.indexType} -> ${indexType}`
                });
            }
        }

        // 2. Embedding dimension optimizasyonu
        for (const dim of this.config.embeddingDims) {
            if (dim !== currentConfig.embeddingDim) {
                candidates.push({
                    ...currentConfig,
                    embeddingDim: dim,
                    reason: `Embedding dimension: ${currentConfig.embeddingDim} -> ${dim}`
                });
            }
        }

        // 3. Hybrid weight tuning
        if (performance.quality < 0.8) {
            // Kalite düşükse hybrid weight ayarla
            const newAlpha = Math.max(0.1, Math.min(0.9, currentConfig.hybrid.alpha + 0.1));
            candidates.push({
                ...currentConfig,
                hybrid: { alpha: newAlpha },
                reason: `Hybrid alpha adjustment: ${currentConfig.hybrid.alpha} -> ${newAlpha}`
            });
        }

        // 4. TopK optimizasyonu
        if (performance.latency > this.config.performanceThresholds.latencyMs) {
            // Latency yüksekse topK azalt
            const newTopK = Math.max(10, currentConfig.topK - 10);
            candidates.push({
                ...currentConfig,
                topK: newTopK,
                reason: `TopK reduction for latency: ${currentConfig.topK} -> ${newTopK}`
            });
        }

        // 5. Reranker optimizasyonu
        const rerankerOptions = ['null', 'ce-small', 'ce-large'];
        for (const reranker of rerankerOptions) {
            if (reranker !== currentConfig.reranker) {
                candidates.push({
                    ...currentConfig,
                    reranker,
                    reason: `Reranker change: ${currentConfig.reranker} -> ${reranker}`
                });
            }
        }

        // Her adaya beklenen performans skoru ata
        candidates.forEach(candidate => {
            candidate.expectedScore = this.estimatePerformanceScore(candidate, performance);
        });

        return candidates.sort((a, b) => b.expectedScore - a.expectedScore);
    }

    /**
     * Performans skoru hesapla
     */
    calculatePerformanceScore(metrics) {
        const latencyScore = Math.max(0, 1 - (metrics.avgLatency / 500)); // 500ms norm
        const qualityScore = metrics.avgQuality;
        const costScore = Math.max(0, 1 - (metrics.totalCost / metrics.searchVolume / 0.002)); // $0.002 norm

        return (latencyScore * 0.4 + qualityScore * 0.4 + costScore * 0.2);
    }

    /**
     * Tahmini performans skoru
     */
    estimatePerformanceScore(candidate, currentPerformance) {
        let estimatedScore = this.calculatePerformanceScore({
            avgLatency: currentPerformance.latency,
            avgQuality: currentPerformance.quality,
            totalCost: currentPerformance.cost * 100,
            searchVolume: 100
        });

        // Config değişikliklerine göre tahmini ayarlamalar
        if (candidate.embeddingDim < 768) {
            estimatedScore += 0.1; // Küçük dim -> hız artışı
        }
        
        if (candidate.indexType === 'ivf_pq') {
            estimatedScore += 0.05; // PQ -> memory tasarrufu
        }
        
        if (candidate.reranker === 'ce-large') {
            estimatedScore += 0.1; // Büyük reranker -> kalite artışı
            estimatedScore -= 0.05; // Ama latency artışı
        }

        return Math.min(estimatedScore, 1.0);
    }

    /**
     * En iyi adayı seç
     */
    selectBestCandidate(candidates, currentPerformance) {
        if (candidates.length === 0) return null;
        
        // Risk/reward analizi
        const scoredCandidates = candidates.map(candidate => ({
            ...candidate,
            riskScore: this.calculateRiskScore(candidate, currentPerformance),
            rewardScore: candidate.expectedScore - currentPerformance.score
        }));

        // En iyi risk/reward oranına sahip adayı seç
        return scoredCandidates.reduce((best, current) => {
            const bestRatio = best.rewardScore / (best.riskScore + 0.1);
            const currentRatio = current.rewardScore / (current.riskScore + 0.1);
            return currentRatio > bestRatio ? current : best;
        });
    }

    /**
     * Risk skoru hesapla
     */
    calculateRiskScore(candidate, currentPerformance) {
        let risk = 0.1; // Base risk

        // Büyük değişiklikler daha riskli
        if (candidate.indexType !== candidate.indexType) risk += 0.3;
        if (Math.abs(candidate.embeddingDim - 768) > 256) risk += 0.2;
        if (candidate.reranker === 'ce-large') risk += 0.1;

        return risk;
    }

    /**
     * A/B test başlat
     */
    async startABTest(profile, candidate) {
        try {
            const testId = `${profile}-${Date.now()}`;
            
            this.abTests.set(testId, {
                profile,
                candidate,
                control: this.indexConfigs.get(profile).currentConfig,
                startTime: new Date().toISOString(),
                status: 'running',
                samples: 0,
                results: {
                    control: { queries: [], avgScore: 0 },
                    treatment: { queries: [], avgScore: 0 }
                }
            });

            eventBus.emit('kb.abtest.started', {
                testId,
                profile,
                candidate: {
                    reason: candidate.reason,
                    expectedScore: candidate.expectedScore
                },
                trafficSplit: this.config.abTestConfig.trafficSplit,
                source: this.name
            });

            this.logger.info(`A/B test başlatıldı: ${testId} - ${candidate.reason}`);

        } catch (error) {
            this.logger.error('A/B test başlatma hatası:', error);
        }
    }

    /**
     * A/B test sonucunu işle
     */
    async processABTestResult(data) {
        try {
            const { testId, group, query, latencyMs, qualityScore } = data;
            
            if (!this.abTests.has(testId)) {
                return;
            }

            const test = this.abTests.get(testId);
            test.results[group].queries.push({
                latencyMs,
                qualityScore,
                timestamp: new Date().toISOString()
            });

            test.samples++;

            // Yeterli örnek toplandıysa analiz et
            if (test.samples >= this.config.abTestConfig.minSamples) {
                await this.analyzeABTest(testId);
            }

        } catch (error) {
            this.logger.error('A/B test sonuç işleme hatası:', error);
        }
    }

    /**
     * A/B test analizi
     */
    async analyzeABTest(testId) {
        try {
            const test = this.abTests.get(testId);
            
            // İstatistiksel analiz
            const controlScore = this.calculateGroupScore(test.results.control);
            const treatmentScore = this.calculateGroupScore(test.results.treatment);
            
            const improvement = (treatmentScore - controlScore) / controlScore;
            const significance = this.calculateSignificance(test.results.control, test.results.treatment);

            const decision = {
                winner: treatmentScore > controlScore ? 'treatment' : 'control',
                improvement,
                significance,
                confident: significance > this.config.abTestConfig.confidenceLevel
            };

            test.status = 'completed';
            test.decision = decision;

            // Karar ver
            if (decision.winner === 'treatment' && decision.confident) {
                await this.promoteCandidate(test.profile, test.candidate);
            }

            eventBus.emit('kb.abtest.completed', {
                testId,
                decision,
                controlScore,
                treatmentScore,
                source: this.name
            });

        } catch (error) {
            this.logger.error('A/B test analizi hatası:', error);
        }
    }

    /**
     * Grup skoru hesapla
     */
    calculateGroupScore(group) {
        if (group.queries.length === 0) return 0;
        
        const avgLatency = group.queries.reduce((sum, q) => sum + q.latencyMs, 0) / group.queries.length;
        const avgQuality = group.queries.reduce((sum, q) => sum + q.qualityScore, 0) / group.queries.length;
        
        return this.calculatePerformanceScore({
            avgLatency,
            avgQuality,
            totalCost: 0,
            searchVolume: 1
        });
    }

    /**
     * İstatistiksel anlamlılık hesapla
     */
    calculateSignificance(control, treatment) {
        // Basitleştirilmiş t-test
        if (control.queries.length < 30 || treatment.queries.length < 30) {
            return 0; // Yetersiz örnek
        }

        const controlScores = control.queries.map(q => q.qualityScore);
        const treatmentScores = treatment.queries.map(q => q.qualityScore);
        
        const controlMean = controlScores.reduce((a, b) => a + b, 0) / controlScores.length;
        const treatmentMean = treatmentScores.reduce((a, b) => a + b, 0) / treatmentScores.length;
        
        // Simplified significance (gerçek t-test daha karmaşık)
        const diff = Math.abs(treatmentMean - controlMean);
        return diff > 0.05 ? 0.95 : 0.5; // Basitleştirilmiş
    }

    /**
     * Adayı production'a al
     */
    async promoteCandidate(profile, candidate) {
        try {
            const config = this.indexConfigs.get(profile);
            const oldConfig = { ...config.currentConfig };
            
            config.currentConfig = { ...candidate };
            config.lastOptimization = new Date().toISOString();

            eventBus.emit('kb.config.promoted', {
                profile,
                oldConfig,
                newConfig: candidate,
                reason: candidate.reason,
                source: this.name
            });

            this.logger.info(`${profile} profili için yeni config aktif edildi: ${candidate.reason}`);

        } catch (error) {
            this.logger.error('Candidate promotion hatası:', error);
        }
    }

    /**
     * Manuel optimizasyon
     */
    async performOptimization(data) {
        try {
            const { profile } = data;
            
            if (profile) {
                await this.optimizeProfile(profile);
            } else {
                await this.performPeriodicOptimization();
            }

        } catch (error) {
            this.logger.error('Manuel optimizasyon hatası:', error);
        }
    }

    /**
     * Modül durumunu al
     */
    getStatus() {
        return {
            name: this.name,
            initialized: this.isInitialized,
            enabled: this.config.enabled,
            profiles: this.config.profiles.length,
            activeABTests: Array.from(this.abTests.values()).filter(t => t.status === 'running').length,
            optimizationHistory: this.optimizationHistory.size,
            totalQueries: Array.from(this.performanceMetrics.values()).reduce((sum, m) => sum + m.searchVolume, 0)
        };
    }

    /**
     * Modülü durdur
     */
    async shutdown() {
        try {
            this.logger.info(`${this.name} durduruluyor...`);
            
            if (this.tuningTimer) {
                clearInterval(this.tuningTimer);
                this.tuningTimer = null;
            }
            
            this.isInitialized = false;
            this.logger.info(`${this.name} başarıyla durduruldu`);
        } catch (error) {
            this.logger.error(`${this.name} durdurma hatası:`, error);
        }
    }
}

module.exports = { KBIndexAutotuner };