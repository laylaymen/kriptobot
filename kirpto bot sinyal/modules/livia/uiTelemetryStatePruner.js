/**
 * LIVIA-14 · uiTelemetryStatePruner.js
 * UI telemetri state temizleyici - Hafıza ve disk alanı optimizasyonu
 */

const { z } = require('zod');
const fs = require('fs').promises;
const path = require('path');
const { eventBus } = require('../modularEventStream');
const { logInfo, logError } = require('../../logs/logger');

// 🎯 Smart Schemas
const PruneConfigSchema = z.object({
    policy: z.enum(['lru', 'fifo', 'priority', 'adaptive']).default('adaptive'),
    maxMemMb: z.number().positive().default(128),
    maxAgeMs: z.number().positive().default(3600000), // 1 saat
    maxRecords: z.number().positive().default(10000),
    criticalRatio: z.number().min(0).max(1).default(0.85),
    adaptiveWeights: z.object({
        age: z.number().default(0.4),
        frequency: z.number().default(0.3),
        priority: z.number().default(0.2),
        size: z.number().default(0.1)
    }).default({})
});

const TelemetryRecordSchema = z.object({
    id: z.string(),
    event: z.string(),
    timestamp: z.number(),
    size: z.number(),
    priority: z.number().min(1).max(10).default(5),
    data: z.any()
});

/**
 * 📊 Smart LRU Cache with Priority
 */
class SmartLRUCache {
    constructor(maxSize = 10000) {
        this.cache = new Map();
        this.maxSize = maxSize;
        this.accessCounts = new Map();
        this.priorities = new Map();
        this.totalSize = 0;
    }

    get(key) {
        const item = this.cache.get(key);
        if (item) {
            // Access count güncelle
            this.accessCounts.set(key, (this.accessCounts.get(key) || 0) + 1);
            
            // LRU için sona taşı
            this.cache.delete(key);
            this.cache.set(key, item);
        }
        return item;
    }

    set(key, value, priority = 5) {
        // Eğer anahtar zaten varsa güncelle
        if (this.cache.has(key)) {
            const oldValue = this.cache.get(key);
            this.totalSize = this.totalSize - (oldValue.size || 0) + (value.size || 0);
            this.cache.set(key, value);
            this.priorities.set(key, priority);
            return;
        }

        // Yeni kayıt ekle
        this.cache.set(key, value);
        this.priorities.set(key, priority);
        this.accessCounts.set(key, 1);
        this.totalSize += value.size || 0;

        // Gerekirse temizle
        this.prune();
    }

    delete(key) {
        const item = this.cache.get(key);
        if (item) {
            this.cache.delete(key);
            this.accessCounts.delete(key);
            this.priorities.delete(key);
            this.totalSize -= item.size || 0;
            return true;
        }
        return false;
    }

    prune() {
        if (this.cache.size <= this.maxSize) return;

        // Öncelik + erişim sayısı + yaş bazlı sıralama
        const entries = Array.from(this.cache.entries()).map(([key, value]) => ({
            key,
            value,
            priority: this.priorities.get(key) || 5,
            accessCount: this.accessCounts.get(key) || 1,
            age: Date.now() - (value.timestamp || 0)
        }));

        entries.sort((a, b) => {
            // Önce öncelik, sonra erişim, sonra yaş
            const priorityDiff = b.priority - a.priority;
            if (priorityDiff !== 0) return priorityDiff;
            
            const accessDiff = b.accessCount - a.accessCount;
            if (accessDiff !== 0) return accessDiff;
            
            return a.age - b.age; // Yeni olanlar kalır
        });

        // Alt %20'yi sil
        const toDelete = Math.floor(this.cache.size * 0.2);
        const victimKeys = entries.slice(-toDelete).map(e => e.key);
        
        victimKeys.forEach(key => this.delete(key));
    }

    getStats() {
        return {
            size: this.cache.size,
            maxSize: this.maxSize,
            totalSizeMb: (this.totalSize / 1024 / 1024).toFixed(2),
            avgPriority: Array.from(this.priorities.values()).reduce((a, b) => a + b, 0) / this.priorities.size || 0,
            avgAccessCount: Array.from(this.accessCounts.values()).reduce((a, b) => a + b, 0) / this.accessCounts.size || 0
        };
    }

    clear() {
        this.cache.clear();
        this.accessCounts.clear();
        this.priorities.clear();
        this.totalSize = 0;
    }
}

/**
 * 🧹 Adaptive Pruner Engine
 */
class AdaptivePruner {
    constructor(config) {
        this.config = config;
        this.weights = config.adaptiveWeights;
    }

    calculateScore(record, currentTime) {
        const age = currentTime - record.timestamp;
        const ageMs = Math.min(age, this.config.maxAgeMs);
        
        // Normalize etmek için [0,1] aralığına çevir
        const ageScore = 1 - (ageMs / this.config.maxAgeMs);
        const priorityScore = (record.priority - 1) / 9; // 1-10 → 0-1
        const sizeScore = 1 - Math.min(record.size / (1024 * 1024), 1); // MB cinsinden, büyük dosyalar düşük skor
        const frequencyScore = 0.5; // Bu örnekte sabit, gerçekte access count kullanılır
        
        return (
            this.weights.age * ageScore +
            this.weights.priority * priorityScore +
            this.weights.size * sizeScore +
            this.weights.frequency * frequencyScore
        );
    }

    selectVictims(records, targetCount) {
        const currentTime = Date.now();
        
        const scoredRecords = records.map(record => ({
            ...record,
            score: this.calculateScore(record, currentTime)
        }));
        
        // En düşük skorlular silinecek
        scoredRecords.sort((a, b) => a.score - b.score);
        
        return scoredRecords.slice(0, targetCount).map(r => r.id);
    }
}

/**
 * 🎯 LIVIA-14 Smart UI Telemetry State Pruner
 */
class UITelemetryStatePruner {
    constructor(config = {}) {
        this.name = 'UITelemetryStatePruner';
        this.config = PruneConfigSchema.parse(config);
        
        this.memoryStore = new SmartLRUCache(this.config.maxRecords);
        this.diskStore = new Map(); // Disk dosya referansları
        this.pruner = new AdaptivePruner(this.config);
        
        this.stats = {
            totalPruned: 0,
            memoryPruned: 0,
            diskPruned: 0,
            bytesFreed: 0,
            lastPruneMs: 0,
            avgPruneTimeMs: 0
        };
        
        this.pruneTimer = null;
        this.isInitialized = false;
        this.logger = null;
    }

    async initialize(logger) {
        try {
            this.logger = logger;
            this.logger.info(`${this.name} başlatılıyor...`);
            
            this.setupEventListeners();
            this.startPeriodicPrune();
            
            this.isInitialized = true;
            this.logger.info(`${this.name} başarıyla başlatıldı`);
            return true;
        } catch (error) {
            this.logger.error(`${this.name} hatası:`, error);
            return false;
        }
    }

    setupEventListeners() {
        // UI telemetri eventlerini dinle
        eventBus.subscribeToEvent('uiBridge.', (event) => {
            this.handleUITelemetry(event.data);
        }, 'uiTelemetryStatePruner');
        
        // Manual prune komutu
        eventBus.subscribeToEvent('pruner.run', (event) => {
            this.handlePruneRequest(event.data);
        }, 'uiTelemetryStatePruner');
        
        // Memory pressure alarm
        eventBus.subscribeToEvent('system.memory_pressure', (event) => {
            this.handleMemoryPressure(event.data);
        }, 'uiTelemetryStatePruner');
    }

    handleUITelemetry(data) {
        try {
            const record = {
                id: data.id || this.generateId(),
                event: data.event || 'ui.unknown',
                timestamp: data.timestamp ? new Date(data.timestamp).getTime() : Date.now(),
                size: this.estimateSize(data),
                priority: this.calculatePriority(data),
                data: data
            };
            
            const validRecord = TelemetryRecordSchema.parse(record);
            this.memoryStore.set(validRecord.id, validRecord, validRecord.priority);
            
            // Kritik seviye kontrolü
            this.checkCriticalLevel();
            
        } catch (error) {
            this.logger.error('UI telemetry handle error:', error);
        }
    }

    generateId() {
        return `ui-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }

    estimateSize(data) {
        try {
            return JSON.stringify(data).length;
        } catch {
            return 1024; // Default 1KB
        }
    }

    calculatePriority(data) {
        // UI event tipine göre öncelik
        if (data.event?.includes('error')) return 9;
        if (data.event?.includes('connection')) return 8;
        if (data.event?.includes('latency')) return 7;
        if (data.event?.includes('message')) return 5;
        if (data.event?.includes('heartbeat')) return 3;
        return 5; // Default
    }

    checkCriticalLevel() {
        const stats = this.memoryStore.getStats();
        const memoryRatio = stats.size / this.config.maxRecords;
        
        if (memoryRatio >= this.config.criticalRatio) {
            this.logger.warn(`Memory kritik seviye: ${(memoryRatio * 100).toFixed(1)}%`);
            this.runPrune('critical');
        }
    }

    startPeriodicPrune() {
        // Her 5 dakikada bir kontrol et
        this.pruneTimer = setInterval(() => {
            this.runPrune('periodic');
        }, 300000);
    }

    async handlePruneRequest(data) {
        const reason = data.reason || 'manual';
        await this.runPrune(reason);
    }

    async handleMemoryPressure(data) {
        const severity = data.severity || 'medium';
        
        if (severity === 'high') {
            // Agresif temizlik - %50 sil
            await this.runAggressivePrune();
        } else {
            await this.runPrune('memory_pressure');
        }
    }

    async runPrune(reason = 'periodic') {
        const startTime = Date.now();
        
        try {
            const initialStats = this.memoryStore.getStats();
            let prunedCount = 0;
            let freedBytes = 0;
            
            // Memory prune
            const memoryResult = await this.pruneMemory(reason);
            prunedCount += memoryResult.count;
            freedBytes += memoryResult.bytes;
            
            // Disk prune (eğer varsa)
            const diskResult = await this.pruneDisk(reason);
            prunedCount += diskResult.count;
            freedBytes += diskResult.bytes;
            
            // Stats güncelle
            const pruneTime = Date.now() - startTime;
            this.updateStats(prunedCount, memoryResult.count, diskResult.count, freedBytes, pruneTime);
            
            // Event yayınla
            this.emitPruneResult(reason, {
                pruned: prunedCount,
                freedMb: (freedBytes / 1024 / 1024).toFixed(2),
                durationMs: pruneTime,
                beforeSize: initialStats.size,
                afterSize: this.memoryStore.getStats().size
            });
            
        } catch (error) {
            this.logger.error('Prune error:', error);
            this.emit('pruner.error', { error: error.message, reason });
        }
    }

    async pruneMemory(reason) {
        const records = Array.from(this.memoryStore.cache.values());
        const currentTime = Date.now();
        
        let toDelete = [];
        let freedBytes = 0;
        
        if (reason === 'critical') {
            // Kritik durumda %30 sil
            const targetCount = Math.floor(records.length * 0.3);
            toDelete = this.pruner.selectVictims(records, targetCount);
        } else {
            // Normal temizlik - eski ve düşük öncelikli
            toDelete = records
                .filter(r => {
                    const age = currentTime - r.timestamp;
                    return age > this.config.maxAgeMs || r.priority <= 3;
                })
                .map(r => r.id);
        }
        
        toDelete.forEach(id => {
            const record = this.memoryStore.cache.get(id);
            if (record) {
                freedBytes += record.size || 0;
                this.memoryStore.delete(id);
            }
        });
        
        return { count: toDelete.length, bytes: freedBytes };
    }

    async pruneDisk(reason) {
        // Bu örnekte disk store basit tutuldu
        // Gerçek uygulamada log dosyaları, cache dosyaları vs. silinir
        
        let deletedFiles = 0;
        let freedBytes = 0;
        
        const filesToCheck = Array.from(this.diskStore.keys());
        
        for (const filePath of filesToCheck) {
            try {
                const stats = await fs.stat(filePath);
                const ageMs = Date.now() - stats.mtime.getTime();
                
                if (ageMs > this.config.maxAgeMs * 2) { // Disk için 2x uzun tutma
                    await fs.unlink(filePath);
                    this.diskStore.delete(filePath);
                    deletedFiles++;
                    freedBytes += stats.size;
                }
            } catch (error) {
                // Dosya yoksa veya erişim hatası
                this.diskStore.delete(filePath);
            }
        }
        
        return { count: deletedFiles, bytes: freedBytes };
    }

    async runAggressivePrune() {
        const records = Array.from(this.memoryStore.cache.values());
        const targetCount = Math.floor(records.length * 0.5); // %50 sil
        
        const toDelete = this.pruner.selectVictims(records, targetCount);
        let freedBytes = 0;
        
        toDelete.forEach(id => {
            const record = this.memoryStore.cache.get(id);
            if (record) {
                freedBytes += record.size || 0;
                this.memoryStore.delete(id);
            }
        });
        
        this.emit('pruner.aggressive', {
            deleted: toDelete.length,
            freedMb: (freedBytes / 1024 / 1024).toFixed(2)
        });
    }

    updateStats(totalPruned, memoryPruned, diskPruned, bytesFreed, pruneTime) {
        this.stats.totalPruned += totalPruned;
        this.stats.memoryPruned += memoryPruned;
        this.stats.diskPruned += diskPruned;
        this.stats.bytesFreed += bytesFreed;
        this.stats.lastPruneMs = pruneTime;
        this.stats.avgPruneTimeMs = (this.stats.avgPruneTimeMs + pruneTime) / 2;
    }

    emitPruneResult(reason, result) {
        this.emit('pruner.completed', {
            reason,
            result,
            memoryStats: this.memoryStore.getStats(),
            globalStats: this.stats
        });
        
        // Kısa bildirim
        if (result.pruned > 0) {
            this.emit('pruner.alert', {
                level: 'info',
                message: `Temizlik: ${result.pruned} kayıt, ${result.freedMb}MB`,
                reason
            });
        }
    }

    emit(eventType, data) {
        eventBus.publishEvent(eventType, {
            timestamp: new Date().toISOString(),
            source: this.name,
            ...data
        }, 'uiTelemetryStatePruner');
    }

    getStatus() {
        return {
            name: this.name,
            initialized: this.isInitialized,
            config: this.config,
            memoryStats: this.memoryStore.getStats(),
            diskStoreSize: this.diskStore.size,
            stats: this.stats
        };
    }

    async shutdown() {
        if (this.pruneTimer) {
            clearInterval(this.pruneTimer);
        }
        
        this.memoryStore.clear();
        this.diskStore.clear();
        this.isInitialized = false;
        this.logger?.info(`${this.name} kapatıldı`);
    }
}

module.exports = {
    UITelemetryStatePruner,
    uiTelemetryStatePruner: new UITelemetryStatePruner()
};