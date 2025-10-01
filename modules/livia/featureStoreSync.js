/**
 * LIVIA-46: Feature Store Sync
 * Online ve offline feature store'ların tutarlılığını izleme modülü
 * 
 * Bu modül feature store'lar arasındaki senkronizasyonu kontrol eder,
 * point-in-time correctness, training-serving skew ve data quality kontrolü yapar.
 */

const { eventBus } = require('../../kirpto bot sinyal/modules/modularEventStream');

class FeatureStoreSync {
    constructor(config = {}) {
        this.name = 'FeatureStoreSync';
        this.config = {
            enabled: true,
            storeTypes: ['online', 'offline'],
            syncIntervalMs: 300000, // 5 dakika
            maxSkewMinutes: 15,
            qualityThresholds: {
                missingDataRate: 0.05, // %5 maksimum eksik veri
                consistencyScore: 0.95, // %95 minimum tutarlılık
                freshnessHours: 6 // 6 saat maksimum gecikme
            },
            alertThresholds: {
                criticalSkew: 60, // 60 dakika kritik seviye
                dataInconsistency: 0.1 // %10 tutarsızlık
            },
            ...config
        };
        this.isInitialized = false;
        this.logger = null;
        this.featureStores = new Map();
        this.syncStatus = new Map();
        this.qualityMetrics = new Map();
        this.syncTimer = null;
    }

    /**
     * Modülü başlat
     */
    async initialize(logger) {
        try {
            this.logger = logger;
            this.logger.info(`${this.name} başlatılıyor...`);
            
            await this.setupFeatureStores();
            await this.setupEventListeners();
            await this.startSyncMonitoring();
            
            this.isInitialized = true;
            this.logger.info(`${this.name} başarıyla başlatıldı`);
            return true;
        } catch (error) {
            this.logger.error(`${this.name} başlatma hatası:`, error);
            return false;
        }
    }

    /**
     * Feature store'ları kurula
     */
    async setupFeatureStores() {
        // Feature store bağlantıları
        for (const storeType of this.config.storeTypes) {
            this.featureStores.set(storeType, {
                type: storeType,
                status: 'unknown',
                lastSync: null,
                features: new Map(),
                metadata: {
                    version: '1.0',
                    schema: 'feature_v1',
                    backend: storeType === 'online' ? 'redis' : 'parquet'
                }
            });
            
            this.syncStatus.set(storeType, {
                lastCheck: null,
                isHealthy: true,
                skewMinutes: 0,
                inconsistencyRate: 0,
                errorCount: 0
            });
        }
        
        this.logger.info(`${this.config.storeTypes.length} feature store kuruldu`);
    }

    /**
     * Event dinleyicileri kurulum
     */
    async setupEventListeners() {
        // Feature materialization events
        eventBus.on('feature.materialized', async (data) => {
            await this.handleFeatureMaterialized(data);
        });

        // Feature registration events
        eventBus.on('feature.registered', async (data) => {
            await this.handleFeatureRegistered(data);
        });

        // Sync request events
        eventBus.on('featureStore.syncRequest', async (data) => {
            await this.performSyncCheck(data);
        });

        // Quality check events
        eventBus.on('featureStore.qualityCheck', async (data) => {
            await this.performQualityCheck(data);
        });

        this.logger.info('Feature store sync event listeners kuruldu');
    }

    /**
     * Senkronizasyon izlemeyi başlat
     */
    async startSyncMonitoring() {
        this.syncTimer = setInterval(async () => {
            await this.performFullSyncCheck();
        }, this.config.syncIntervalMs);
        
        // İlk kontrolü hemen yap
        await this.performFullSyncCheck();
    }

    /**
     * Feature materialization eventi işle
     */
    async handleFeatureMaterialized(data) {
        try {
            const { id, namespace, store, asOf, count, missingPct } = data;
            
            if (!this.featureStores.has(store)) {
                this.logger.warn(`Bilinmeyen feature store: ${store}`);
                return;
            }

            const storeData = this.featureStores.get(store);
            storeData.features.set(id, {
                namespace,
                lastUpdate: asOf,
                recordCount: count,
                missingRate: missingPct || 0,
                timestamp: new Date().toISOString()
            });

            // Quality metrics güncelle
            await this.updateQualityMetrics(store, id, {
                missingRate: missingPct || 0,
                recordCount: count,
                lastUpdate: asOf
            });

            eventBus.emit('featureStore.updated', {
                store,
                featureId: id,
                status: 'materialized',
                source: this.name
            });

        } catch (error) {
            this.logger.error('Feature materialization işleme hatası:', error);
        }
    }

    /**
     * Feature registration eventi işle
     */
    async handleFeatureRegistered(data) {
        try {
            const { id, owner, version, source, ttlSec, dtype } = data;
            
            // Tüm store'larda bu feature'ı kaydet
            for (const [storeType, store] of this.featureStores) {
                if (!store.features.has(id)) {
                    store.features.set(id, {
                        registered: true,
                        owner,
                        version,
                        source,
                        ttlSec,
                        dtype,
                        registeredAt: new Date().toISOString()
                    });
                }
            }

            eventBus.emit('featureStore.featureRegistered', {
                featureId: id,
                version,
                stores: this.config.storeTypes,
                source: this.name
            });

        } catch (error) {
            this.logger.error('Feature registration işleme hatası:', error);
        }
    }

    /**
     * Tam senkronizasyon kontrolü yap
     */
    async performFullSyncCheck() {
        try {
            this.logger.info('Tam feature store senkronizasyon kontrolü başlatılıyor...');
            
            const results = {};
            
            for (const storeType of this.config.storeTypes) {
                results[storeType] = await this.checkStoreSync(storeType);
            }

            // Store'lar arası karşılaştırma
            if (this.config.storeTypes.length > 1) {
                results.crossStoreSync = await this.compareCrossStoreSync();
            }

            // Genel sağlık durumu
            const overallHealth = this.calculateOverallHealth(results);
            
            eventBus.emit('featureStore.syncCheckCompleted', {
                results,
                overallHealth,
                timestamp: new Date().toISOString(),
                source: this.name
            });

            // Kritik durumları raporla
            await this.checkCriticalIssues(results);

        } catch (error) {
            this.logger.error('Senkronizasyon kontrolü hatası:', error);
        }
    }

    /**
     * Tek store senkronizasyon kontrolü
     */
    async checkStoreSync(storeType) {
        const store = this.featureStores.get(storeType);
        const status = this.syncStatus.get(storeType);
        
        if (!store) {
            return { error: 'Store bulunamadı' };
        }

        const now = new Date();
        const checks = {
            featureCount: store.features.size,
            healthyFeatures: 0,
            expiredFeatures: 0,
            inconsistentFeatures: 0,
            avgSkewMinutes: 0,
            qualityScore: 0
        };

        let totalSkew = 0;
        let totalQuality = 0;

        for (const [featureId, feature] of store.features) {
            // TTL kontrolü
            if (feature.ttlSec && feature.lastUpdate) {
                const updateTime = new Date(feature.lastUpdate);
                const expiredTime = new Date(updateTime.getTime() + (feature.ttlSec * 1000));
                
                if (now > expiredTime) {
                    checks.expiredFeatures++;
                } else {
                    checks.healthyFeatures++;
                }
            }

            // Freshness kontrolü
            if (feature.lastUpdate) {
                const updateTime = new Date(feature.lastUpdate);
                const skewMinutes = (now - updateTime) / (1000 * 60);
                totalSkew += skewMinutes;
                
                if (skewMinutes > this.config.maxSkewMinutes) {
                    checks.inconsistentFeatures++;
                }
            }

            // Quality score
            const qualityScore = this.calculateFeatureQuality(feature);
            totalQuality += qualityScore;
        }

        checks.avgSkewMinutes = checks.featureCount > 0 ? totalSkew / checks.featureCount : 0;
        checks.qualityScore = checks.featureCount > 0 ? totalQuality / checks.featureCount : 0;

        // Status güncelle
        status.lastCheck = now.toISOString();
        status.skewMinutes = checks.avgSkewMinutes;
        status.inconsistencyRate = checks.featureCount > 0 ? checks.inconsistentFeatures / checks.featureCount : 0;
        status.isHealthy = checks.qualityScore >= this.config.qualityThresholds.consistencyScore;

        return checks;
    }

    /**
     * Store'lar arası senkronizasyon karşılaştırması
     */
    async compareCrossStoreSync() {
        if (this.config.storeTypes.length < 2) {
            return { status: 'single_store' };
        }

        const [store1Type, store2Type] = this.config.storeTypes;
        const store1 = this.featureStores.get(store1Type);
        const store2 = this.featureStores.get(store2Type);

        const comparison = {
            commonFeatures: 0,
            onlyInStore1: 0,
            onlyInStore2: 0,
            inconsistentFeatures: 0,
            consistencyScore: 0
        };

        const allFeatures = new Set([...store1.features.keys(), ...store2.features.keys()]);
        
        for (const featureId of allFeatures) {
            const inStore1 = store1.features.has(featureId);
            const inStore2 = store2.features.has(featureId);

            if (inStore1 && inStore2) {
                comparison.commonFeatures++;
                
                // Consistency check
                const feature1 = store1.features.get(featureId);
                const feature2 = store2.features.get(featureId);
                
                if (!this.areFeaturesConsistent(feature1, feature2)) {
                    comparison.inconsistentFeatures++;
                }
            } else if (inStore1) {
                comparison.onlyInStore1++;
            } else {
                comparison.onlyInStore2++;
            }
        }

        comparison.consistencyScore = comparison.commonFeatures > 0 ? 
            (comparison.commonFeatures - comparison.inconsistentFeatures) / comparison.commonFeatures : 0;

        return comparison;
    }

    /**
     * Feature'ların tutarlılığını kontrol et
     */
    areFeaturesConsistent(feature1, feature2) {
        // Version kontrolü
        if (feature1.version !== feature2.version) {
            return false;
        }

        // Timestamp skew kontrolü
        if (feature1.lastUpdate && feature2.lastUpdate) {
            const time1 = new Date(feature1.lastUpdate);
            const time2 = new Date(feature2.lastUpdate);
            const skewMs = Math.abs(time1 - time2);
            
            if (skewMs > this.config.maxSkewMinutes * 60 * 1000) {
                return false;
            }
        }

        return true;
    }

    /**
     * Feature kalite skoru hesapla
     */
    calculateFeatureQuality(feature) {
        let score = 1.0;

        // Missing data penalty
        if (feature.missingRate) {
            score -= feature.missingRate * 0.5;
        }

        // Freshness penalty
        if (feature.lastUpdate) {
            const now = new Date();
            const updateTime = new Date(feature.lastUpdate);
            const ageHours = (now - updateTime) / (1000 * 60 * 60);
            
            if (ageHours > this.config.qualityThresholds.freshnessHours) {
                score -= (ageHours - this.config.qualityThresholds.freshnessHours) * 0.01;
            }
        }

        return Math.max(score, 0);
    }

    /**
     * Quality metrics güncelle
     */
    async updateQualityMetrics(storeType, featureId, metrics) {
        const key = `${storeType}:${featureId}`;
        
        this.qualityMetrics.set(key, {
            ...metrics,
            qualityScore: this.calculateFeatureQuality(metrics),
            timestamp: new Date().toISOString()
        });
    }

    /**
     * Genel sağlık durumu hesapla
     */
    calculateOverallHealth(results) {
        let totalScore = 0;
        let storeCount = 0;

        for (const [storeType, result] of Object.entries(results)) {
            if (storeType !== 'crossStoreSync' && !result.error) {
                totalScore += result.qualityScore || 0;
                storeCount++;
            }
        }

        const avgScore = storeCount > 0 ? totalScore / storeCount : 0;

        return {
            score: avgScore,
            status: avgScore >= this.config.qualityThresholds.consistencyScore ? 'healthy' : 'degraded',
            stores: storeCount,
            crossStoreConsistency: results.crossStoreSync?.consistencyScore || null
        };
    }

    /**
     * Kritik durumları kontrol et
     */
    async checkCriticalIssues(results) {
        const issues = [];

        for (const [storeType, result] of Object.entries(results)) {
            if (storeType === 'crossStoreSync') continue;
            
            if (result.error) {
                issues.push({
                    severity: 'critical',
                    type: 'store_error',
                    store: storeType,
                    message: result.error
                });
            }

            if (result.avgSkewMinutes > this.config.alertThresholds.criticalSkew) {
                issues.push({
                    severity: 'critical',
                    type: 'data_skew',
                    store: storeType,
                    skewMinutes: result.avgSkewMinutes,
                    message: `Kritik veri gecikmesi: ${result.avgSkewMinutes} dakika`
                });
            }

            if (result.qualityScore < (1 - this.config.alertThresholds.dataInconsistency)) {
                issues.push({
                    severity: 'warning',
                    type: 'quality_degradation',
                    store: storeType,
                    qualityScore: result.qualityScore,
                    message: `Veri kalitesi düşük: ${(result.qualityScore * 100).toFixed(1)}%`
                });
            }
        }

        if (issues.length > 0) {
            eventBus.emit('featureStore.criticalIssues', {
                issues,
                timestamp: new Date().toISOString(),
                source: this.name
            });

            this.logger.warn(`${issues.length} kritik feature store sorunu tespit edildi`);
        }
    }

    /**
     * Spesifik sync kontrolü yap
     */
    async performSyncCheck(data) {
        try {
            const { storeType, featureId } = data;
            
            if (storeType) {
                const result = await this.checkStoreSync(storeType);
                eventBus.emit('featureStore.syncResult', {
                    storeType,
                    result,
                    source: this.name
                });
            } else {
                await this.performFullSyncCheck();
            }

        } catch (error) {
            this.logger.error('Sync check hatası:', error);
        }
    }

    /**
     * Kalite kontrolü yap
     */
    async performQualityCheck(data) {
        try {
            const { storeType, featureId } = data;
            const metrics = [];

            if (storeType && featureId) {
                // Spesifik feature kontrolü
                const key = `${storeType}:${featureId}`;
                if (this.qualityMetrics.has(key)) {
                    metrics.push({
                        storeType,
                        featureId,
                        ...this.qualityMetrics.get(key)
                    });
                }
            } else {
                // Tüm metrics
                for (const [key, metric] of this.qualityMetrics) {
                    const [store, feature] = key.split(':');
                    metrics.push({
                        storeType: store,
                        featureId: feature,
                        ...metric
                    });
                }
            }

            eventBus.emit('featureStore.qualityReport', {
                metrics,
                summary: {
                    totalFeatures: this.qualityMetrics.size,
                    avgQuality: this.calculateAverageQuality(),
                    stores: this.config.storeTypes
                },
                timestamp: new Date().toISOString(),
                source: this.name
            });

        } catch (error) {
            this.logger.error('Kalite kontrolü hatası:', error);
        }
    }

    /**
     * Ortalama kalite hesapla
     */
    calculateAverageQuality() {
        if (this.qualityMetrics.size === 0) return 0;
        
        let totalQuality = 0;
        for (const metric of this.qualityMetrics.values()) {
            totalQuality += metric.qualityScore || 0;
        }
        
        return totalQuality / this.qualityMetrics.size;
    }

    /**
     * Modül durumunu al
     */
    getStatus() {
        return {
            name: this.name,
            initialized: this.isInitialized,
            enabled: this.config.enabled,
            storeCount: this.featureStores.size,
            totalFeatures: Array.from(this.featureStores.values()).reduce((sum, store) => sum + store.features.size, 0),
            qualityMetrics: this.qualityMetrics.size,
            overallHealth: this.calculateAverageQuality()
        };
    }

    /**
     * Modülü durdur
     */
    async shutdown() {
        try {
            this.logger.info(`${this.name} durduruluyor...`);
            
            if (this.syncTimer) {
                clearInterval(this.syncTimer);
                this.syncTimer = null;
            }
            
            this.isInitialized = false;
            this.logger.info(`${this.name} başarıyla durduruldu`);
        } catch (error) {
            this.logger.error(`${this.name} durdurma hatası:`, error);
        }
    }
}

module.exports = { FeatureStoreSync };