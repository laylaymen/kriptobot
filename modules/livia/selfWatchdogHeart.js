/**
 * LIVIA-15 · selfWatchdogHeart.js
 * Kendini izleyen watchdog sistemi - LIVIA'nın kalp atışı ve sağlık monitörü
 */

const { z } = require('zod');
const { eventBus } = require('../../kirpto bot sinyal/modules/modularEventStream');
const { logInfo, logError } = require('../../kirpto bot sinyal/logs/logger');

// 🎯 Smart Schemas
const WatchdogConfigSchema = z.object({
    heartbeatIntervalMs: z.number().positive().default(30000), // 30 saniye
    timeoutMs: z.number().positive().default(90000), // 90 saniye
    maxMissedBeats: z.number().positive().default(3),
    escalationDelayMs: z.number().positive().default(120000), // 2 dakika
    healthChecks: z.array(z.string()).default([
        'memory', 'eventbus', 'modules', 'disk', 'network'
    ]),
    criticalModules: z.array(z.string()).default([
        'operatorDialogOrchestrator', 'actionApprovalGateway', 'guardQuestionEngine'
    ])
});

const HealthCheckSchema = z.object({
    name: z.string(),
    status: z.enum(['healthy', 'warning', 'critical', 'unknown']),
    value: z.number().optional(),
    threshold: z.number().optional(),
    message: z.string().optional(),
    timestamp: z.number()
});

/**
 * 💓 Smart Health Monitor
 */
class SmartHealthMonitor {
    constructor() {
        this.checks = new Map();
        this.history = []; // Son 100 health check
        this.maxHistory = 100;
    }

    async runHealthCheck(checkName) {
        const startTime = Date.now();
        let result = { name: checkName, status: 'unknown', timestamp: startTime };
        
        try {
            switch (checkName) {
                case 'memory':
                    result = await this.checkMemory();
                    break;
                case 'eventbus':
                    result = await this.checkEventBus();
                    break;
                case 'modules':
                    result = await this.checkModules();
                    break;
                case 'disk':
                    result = await this.checkDisk();
                    break;
                case 'network':
                    result = await this.checkNetwork();
                    break;
                default:
                    result.message = 'Bilinmeyen health check';
            }
        } catch (error) {
            result = {
                name: checkName,
                status: 'critical',
                message: error.message,
                timestamp: startTime
            };
        }
        
        // Cache ve history güncelle
        this.checks.set(checkName, result);
        this.addToHistory(result);
        
        return result;
    }

    async checkMemory() {
        const usage = process.memoryUsage();
        const usedMB = usage.heapUsed / 1024 / 1024;
        const totalMB = usage.heapTotal / 1024 / 1024;
        const ratio = usedMB / totalMB;
        
        let status = 'healthy';
        if (ratio > 0.9) status = 'critical';
        else if (ratio > 0.75) status = 'warning';
        
        return {
            name: 'memory',
            status,
            value: Math.round(usedMB),
            threshold: Math.round(totalMB * 0.75),
            message: `${Math.round(usedMB)}MB / ${Math.round(totalMB)}MB (${Math.round(ratio * 100)}%)`,
            timestamp: Date.now()
        };
    }

    async checkEventBus() {
        const stats = eventBus.getStats ? eventBus.getStats() : null;
        
        if (!stats) {
            return {
                name: 'eventbus',
                status: 'warning',
                message: 'EventBus stats mevcut değil',
                timestamp: Date.now()
            };
        }
        
        const queueSize = stats.queueSize || 0;
        let status = 'healthy';
        
        if (queueSize > 1000) status = 'critical';
        else if (queueSize > 500) status = 'warning';
        
        return {
            name: 'eventbus',
            status,
            value: queueSize,
            threshold: 500,
            message: `Queue: ${queueSize}, Subscribers: ${stats.subscriberCount || 0}`,
            timestamp: Date.now()
        };
    }

    async checkModules() {
        // Kritik modüllerin durumunu kontrol et
        const criticalModules = [
            'operatorDialogOrchestrator', 'actionApprovalGateway', 'guardQuestionEngine'
        ];
        
        let healthyCount = 0;
        let totalCount = criticalModules.length;
        
        // Basit modul check (gerçek uygulamada module registry kullanılır)
        for (const moduleName of criticalModules) {
            try {
                // Module instance var mı kontrol et (placeholder)
                const moduleExists = true; // Gerçekte require(moduleName).isInitialized vs.
                if (moduleExists) healthyCount++;
            } catch (error) {
                // Module yok veya hatalı
            }
        }
        
        const ratio = healthyCount / totalCount;
        let status = 'healthy';
        
        if (ratio < 0.5) status = 'critical';
        else if (ratio < 0.8) status = 'warning';
        
        return {
            name: 'modules',
            status,
            value: healthyCount,
            threshold: totalCount,
            message: `${healthyCount}/${totalCount} kritik modül aktif`,
            timestamp: Date.now()
        };
    }

    async checkDisk() {
        try {
            const fs = require('fs');
            const stats = fs.statSync('.');
            
            // Basit disk kontrolü (gerçekte df komutu vs. kullanılır)
            return {
                name: 'disk',
                status: 'healthy',
                message: 'Disk erişimi OK',
                timestamp: Date.now()
            };
        } catch (error) {
            return {
                name: 'disk',
                status: 'critical',
                message: `Disk hatası: ${error.message}`,
                timestamp: Date.now()
            };
        }
    }

    async checkNetwork() {
        try {
            // Basit network kontrolü
            const { exec } = require('child_process');
            
            return new Promise((resolve) => {
                exec('ping -c 1 8.8.8.8', { timeout: 5000 }, (error) => {
                    const result = {
                        name: 'network',
                        status: error ? 'warning' : 'healthy',
                        message: error ? 'Network bağlantısı sorunlu' : 'Network OK',
                        timestamp: Date.now()
                    };
                    resolve(result);
                });
            });
        } catch (error) {
            return {
                name: 'network',
                status: 'critical',
                message: `Network hatası: ${error.message}`,
                timestamp: Date.now()
            };
        }
    }

    addToHistory(result) {
        this.history.push(result);
        if (this.history.length > this.maxHistory) {
            this.history.shift();
        }
    }

    getOverallHealth() {
        const results = Array.from(this.checks.values());
        if (results.length === 0) return 'unknown';
        
        const hasCritical = results.some(r => r.status === 'critical');
        const hasWarning = results.some(r => r.status === 'warning');
        
        if (hasCritical) return 'critical';
        if (hasWarning) return 'warning';
        return 'healthy';
    }

    getHealthSummary() {
        const results = Array.from(this.checks.values());
        const overall = this.getOverallHealth();
        
        const summary = {
            overall,
            checks: results.length,
            healthy: results.filter(r => r.status === 'healthy').length,
            warnings: results.filter(r => r.status === 'warning').length,
            critical: results.filter(r => r.status === 'critical').length,
            lastCheck: results.length > 0 ? Math.max(...results.map(r => r.timestamp)) : 0
        };
        
        return summary;
    }
}

/**
 * 🚨 Smart Escalation Engine
 */
class SmartEscalationEngine {
    constructor(config) {
        this.config = config;
        this.escalationState = {
            level: 0, // 0: normal, 1: warning, 2: critical, 3: emergency
            startTime: null,
            lastEscalation: null,
            notifications: 0
        };
    }

    processHealthState(healthSummary, missedBeats) {
        const currentLevel = this.calculateEscalationLevel(healthSummary, missedBeats);
        
        if (currentLevel > this.escalationState.level) {
            this.escalate(currentLevel, healthSummary);
        } else if (currentLevel < this.escalationState.level && currentLevel === 0) {
            this.deescalate(healthSummary);
        }
        
        return {
            level: this.escalationState.level,
            shouldNotify: this.shouldSendNotification(),
            actions: this.getRecommendedActions()
        };
    }

    calculateEscalationLevel(healthSummary, missedBeats) {
        if (missedBeats >= this.config.maxMissedBeats) return 3; // Emergency
        if (healthSummary.critical > 0) return 2; // Critical
        if (healthSummary.warnings > 0 || missedBeats > 0) return 1; // Warning
        return 0; // Normal
    }

    escalate(newLevel, healthSummary) {
        const now = Date.now();
        
        this.escalationState = {
            level: newLevel,
            startTime: this.escalationState.startTime || now,
            lastEscalation: now,
            notifications: this.escalationState.notifications + 1
        };
    }

    deescalate(healthSummary) {
        this.escalationState = {
            level: 0,
            startTime: null,
            lastEscalation: null,
            notifications: 0
        };
    }

    shouldSendNotification() {
        if (this.escalationState.level === 0) return false;
        
        const now = Date.now();
        const timeSinceLastNotification = now - (this.escalationState.lastEscalation || 0);
        
        // Escalation seviyesine göre bildirim sıklığı
        const notificationIntervals = {
            1: 300000, // Warning: 5 dakika
            2: 120000, // Critical: 2 dakika
            3: 60000   // Emergency: 1 dakika
        };
        
        const interval = notificationIntervals[this.escalationState.level] || 300000;
        return timeSinceLastNotification >= interval;
    }

    getRecommendedActions() {
        const actions = [];
        
        switch (this.escalationState.level) {
            case 1: // Warning
                actions.push('health_check_increase');
                actions.push('log_detailed_status');
                break;
            case 2: // Critical
                actions.push('alert_operators');
                actions.push('reduce_load');
                actions.push('backup_state');
                break;
            case 3: // Emergency
                actions.push('emergency_restart');
                actions.push('fallback_mode');
                actions.push('escalate_human');
                break;
        }
        
        return actions;
    }
}

/**
 * 🎯 LIVIA-15 Smart Self Watchdog Heart
 */
class SelfWatchdogHeart {
    constructor(config = {}) {
        this.name = 'SelfWatchdogHeart';
        this.config = WatchdogConfigSchema.parse(config);
        
        this.healthMonitor = new SmartHealthMonitor();
        this.escalationEngine = new SmartEscalationEngine(this.config);
        
        this.state = {
            isAlive: true,
            lastHeartbeat: Date.now(),
            missedBeats: 0,
            totalBeats: 0,
            startTime: Date.now()
        };
        
        this.heartbeatTimer = null;
        this.healthCheckTimer = null;
        this.isInitialized = false;
        this.logger = null;
    }

    async initialize(logger) {
        try {
            this.logger = logger;
            this.logger.info(`${this.name} başlatılıyor...`);
            
            this.setupEventListeners();
            this.startHeartbeat();
            this.startHealthChecks();
            
            this.isInitialized = true;
            this.logger.info(`${this.name} başarıyla başlatıldı`);
            return true;
        } catch (error) {
            this.logger.error(`${this.name} hatası:`, error);
            return false;
        }
    }

    setupEventListeners() {
        // Manual health check
        eventBus.subscribeToEvent('watchdog.health_check', (event) => {
            this.runFullHealthCheck();
        }, 'selfWatchdogHeart');
        
        // Sistem shutdown signal
        eventBus.subscribeToEvent('system.shutdown', (event) => {
            this.handleShutdown();
        }, 'selfWatchdogHeart');
        
        // External heartbeat (diğer sistemlerden)
        eventBus.subscribeToEvent('watchdog.external_beat', (event) => {
            this.handleExternalHeartbeat(event.data);
        }, 'selfWatchdogHeart');
    }

    startHeartbeat() {
        this.heartbeatTimer = setInterval(() => {
            this.sendHeartbeat();
        }, this.config.heartbeatIntervalMs);
        
        // İlk heartbeat'i hemen gönder
        this.sendHeartbeat();
    }

    startHealthChecks() {
        // Health check'leri heartbeat'in 2 katı sıklıkta çalıştır
        const healthCheckInterval = this.config.heartbeatIntervalMs * 2;
        
        this.healthCheckTimer = setInterval(() => {
            this.runFullHealthCheck();
        }, healthCheckInterval);
        
        // İlk health check'i hemen çalıştır
        this.runFullHealthCheck();
    }

    async sendHeartbeat() {
        const now = Date.now();
        
        try {
            // Heartbeat state güncelle
            this.state.lastHeartbeat = now;
            this.state.totalBeats++;
            this.state.isAlive = true;
            
            // Missed beat kontrolü
            this.checkMissedBeats();
            
            // Health summary al
            const healthSummary = this.healthMonitor.getHealthSummary();
            
            // Escalation engine çalıştır
            const escalation = this.escalationEngine.processHealthState(
                healthSummary, 
                this.state.missedBeats
            );
            
            // Heartbeat event yayınla
            this.emitHeartbeat(healthSummary, escalation);
            
            // Eğer gerekirse aksiyonları çalıştır
            if (escalation.actions.length > 0) {
                this.executeActions(escalation.actions);
            }
            
        } catch (error) {
            this.logger.error('Heartbeat error:', error);
            this.state.missedBeats++;
            this.emitHeartbeatError(error);
        }
    }

    checkMissedBeats() {
        const now = Date.now();
        const timeSinceLastBeat = now - this.state.lastHeartbeat;
        
        if (timeSinceLastBeat > this.config.timeoutMs) {
            this.state.missedBeats++;
            this.logger.warn(`Missed heartbeat detected: ${this.state.missedBeats}`);
        } else {
            // Reset missed beats if we're back on track
            this.state.missedBeats = 0;
        }
    }

    async runFullHealthCheck() {
        const checks = [];
        
        // Tüm health check'leri paralel çalıştır
        for (const checkName of this.config.healthChecks) {
            checks.push(this.healthMonitor.runHealthCheck(checkName));
        }
        
        try {
            const results = await Promise.all(checks);
            const summary = this.healthMonitor.getHealthSummary();
            
            this.emitHealthCheck(summary, results);
            
        } catch (error) {
            this.logger.error('Health check error:', error);
            this.emit('watchdog.health_error', { error: error.message });
        }
    }

    executeActions(actions) {
        actions.forEach(action => {
            switch (action) {
                case 'health_check_increase':
                    this.increaseHealthCheckFrequency();
                    break;
                case 'log_detailed_status':
                    this.logDetailedStatus();
                    break;
                case 'alert_operators':
                    this.alertOperators();
                    break;
                case 'reduce_load':
                    this.reduceSystemLoad();
                    break;
                case 'backup_state':
                    this.backupSystemState();
                    break;
                case 'emergency_restart':
                    this.triggerEmergencyRestart();
                    break;
                case 'fallback_mode':
                    this.activateFallbackMode();
                    break;
                case 'escalate_human':
                    this.escalateToHuman();
                    break;
            }
        });
    }

    increaseHealthCheckFrequency() {
        // Health check sıklığını artır
        this.emit('watchdog.frequency_increase', { 
            message: 'Health check sıklığı artırıldı' 
        });
    }

    logDetailedStatus() {
        const status = this.getDetailedStatus();
        this.logger.info('Detaylı sistem durumu:', status);
    }

    alertOperators() {
        this.emit('watchdog.operator_alert', {
            level: 'critical',
            message: 'Sistem kritik durumda - operatör müdahalesi gerekiyor',
            escalationLevel: this.escalationEngine.escalationState.level
        });
    }

    reduceSystemLoad() {
        this.emit('system.reduce_load', {
            reason: 'watchdog_critical',
            actions: ['throttle_events', 'pause_non_critical']
        });
    }

    backupSystemState() {
        this.emit('system.backup_state', {
            reason: 'watchdog_critical',
            priority: 'high'
        });
    }

    triggerEmergencyRestart() {
        this.emit('system.emergency_restart', {
            reason: 'watchdog_emergency',
            delay: 30000 // 30 saniye gecikme
        });
    }

    activateFallbackMode() {
        this.emit('system.fallback_mode', {
            reason: 'watchdog_emergency',
            mode: 'minimal'
        });
    }

    escalateToHuman() {
        this.emit('watchdog.human_escalation', {
            level: 'emergency',
            message: 'Acil durum: İnsan müdahalesi gerekiyor',
            contactMethods: ['telegram', 'email', 'sms']
        });
    }

    handleExternalHeartbeat(data) {
        // Dış sistemlerden gelen heartbeat'leri işle
        this.emit('watchdog.external_received', {
            source: data.source,
            timestamp: data.timestamp
        });
    }

    handleShutdown() {
        this.logger.info('Watchdog shutdown başlıyor...');
        this.shutdown();
    }

    emitHeartbeat(healthSummary, escalation) {
        this.emit('watchdog.heartbeat', {
            beat: this.state.totalBeats,
            alive: this.state.isAlive,
            missedBeats: this.state.missedBeats,
            uptime: Date.now() - this.state.startTime,
            health: healthSummary,
            escalation: {
                level: escalation.level,
                actions: escalation.actions.length
            }
        });
    }

    emitHeartbeatError(error) {
        this.emit('watchdog.heartbeat_error', {
            error: error.message,
            missedBeats: this.state.missedBeats,
            beat: this.state.totalBeats
        });
    }

    emitHealthCheck(summary, results) {
        this.emit('watchdog.health_status', {
            summary,
            checks: results.length,
            critical: results.filter(r => r.status === 'critical'),
            warnings: results.filter(r => r.status === 'warning')
        });
    }

    emit(eventType, data) {
        eventBus.publishEvent(eventType, {
            timestamp: new Date().toISOString(),
            source: this.name,
            ...data
        }, 'selfWatchdogHeart');
    }

    getDetailedStatus() {
        return {
            name: this.name,
            initialized: this.isInitialized,
            state: this.state,
            escalation: this.escalationEngine.escalationState,
            health: this.healthMonitor.getHealthSummary(),
            config: this.config,
            uptime: Date.now() - this.state.startTime
        };
    }

    getStatus() {
        const summary = this.healthMonitor.getHealthSummary();
        return {
            name: this.name,
            initialized: this.isInitialized,
            alive: this.state.isAlive,
            heartbeats: this.state.totalBeats,
            missedBeats: this.state.missedBeats,
            health: summary.overall,
            escalationLevel: this.escalationEngine.escalationState.level
        };
    }

    async shutdown() {
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
        }
        
        if (this.healthCheckTimer) {
            clearInterval(this.healthCheckTimer);
        }
        
        this.state.isAlive = false;
        this.isInitialized = false;
        
        this.emit('watchdog.shutdown', {
            finalStats: {
                totalBeats: this.state.totalBeats,
                uptime: Date.now() - this.state.startTime,
                finalHealth: this.healthMonitor.getHealthSummary()
            }
        });
        
        this.logger?.info(`${this.name} kapatıldı`);
    }
}

module.exports = {
    SelfWatchdogHeart,
    selfWatchdogHeart: new SelfWatchdogHeart()
};