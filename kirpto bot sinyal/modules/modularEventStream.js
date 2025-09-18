/**
 * 🚀 Modular Event Stream - Kriptobot Event Bus System
 * Sistemler arası asenkron iletişim için merkezi event bus
 * 
 * Desteklenen Event Types:
 * - grafikBeyni.* (Teknik analiz sinyalleri)
 * - vivo.* (Sinyal routing ve execution)
 * - otobilinc.* (Psikolojik durum ve bias)
 * - livia.* (Sentiment ve emotional filtering)
 * - denetimAsistani.* (Monitoring ve alerting)
 */

const { EventEmitter } = require('events');

class ModularEventStream extends EventEmitter {
    constructor(config = {}) {
        super();
        
        this.config = {
            maxListeners: 100,
            enableLogging: true,
            enableMetrics: true,
            ...config
        };
        
        // Event metrics
        this.metrics = {
            totalEvents: 0,
            eventsByType: new Map(),
            eventsBySystem: new Map(),
            errorCount: 0,
            startTime: Date.now()
        };
        
        // Event history for debugging
        this.eventHistory = [];
        this.maxHistorySize = 1000;
        
        // System status tracking
        this.systemStatus = new Map([
            ['grafikBeyni', { ready: false, lastEvent: null }],
            ['vivo', { ready: false, lastEvent: null }],
            ['otobilinc', { ready: false, lastEvent: null }],
            ['livia', { ready: false, lastEvent: null }],
            ['denetimAsistani', { ready: false, lastEvent: null }]
        ]);
        
        this.setMaxListeners(this.config.maxListeners);
        this.setupErrorHandling();
        this.setupMetrics();
    }

    /**
     * Event yayınlama - tüm sistemler bu metodu kullanır
     */
    publishEvent(eventType, data, source = 'unknown') {
        try {
            const event = {
                type: eventType,
                data: data,
                source: source,
                timestamp: Date.now(),
                id: this.generateEventId()
            };

            // Metrics güncelle
            this.updateMetrics(event);
            
            // History'e ekle
            this.addToHistory(event);
            
            // System status güncelle
            this.updateSystemStatus(source, event);
            
            // Log
            if (this.config.enableLogging) {
                console.log(`📡 Event Bus: ${eventType} from ${source}`, data);
            }
            
            // Event'i yayınla
            this.emit(eventType, event);
            this.emit('*', event); // Wildcard listener'lar için
            
            return event.id;
            
        } catch (error) {
            this.metrics.errorCount++;
            console.error('Event Bus Publish Error:', error);
            this.emit('error', { type: 'publish_error', error, eventType, source });
            return null;
        }
    }

    /**
     * Event subscription - sistemler bu metodu kullanarak event'leri dinler
     */
    subscribeToEvent(eventPattern, callback, subscriberName = 'unknown') {
        try {
            const wrappedCallback = (event) => {
                try {
                    if (this.config.enableLogging) {
                        console.log(`📥 Event Bus: ${subscriberName} handling ${event.type}`);
                    }
                    callback(event);
                } catch (error) {
                    this.metrics.errorCount++;
                    console.error(`Event Handler Error in ${subscriberName}:`, error);
                    this.emit('error', { 
                        type: 'handler_error', 
                        error, 
                        subscriber: subscriberName, 
                        event 
                    });
                }
            };

            this.on(eventPattern, wrappedCallback);
            
            console.log(`✅ Event Bus: ${subscriberName} subscribed to ${eventPattern}`);
            return wrappedCallback;
            
        } catch (error) {
            this.metrics.errorCount++;
            console.error('Event Bus Subscribe Error:', error);
            return null;
        }
    }

    /**
     * System ready notification
     */
    systemReady(systemName, metadata = {}) {
        if (this.systemStatus.has(systemName)) {
            this.systemStatus.get(systemName).ready = true;
            this.publishEvent('system.ready', { system: systemName, metadata }, 'eventBus');
            console.log(`🟢 System Ready: ${systemName}`);
        }
    }

    /**
     * Cross-system event routing
     */
    routeToSystem(targetSystem, eventType, data, source) {
        const fullEventType = `${targetSystem}.${eventType}`;
        return this.publishEvent(fullEventType, data, source);
    }

    /**
     * Bulk event publishing
     */
    publishBulk(events) {
        const results = [];
        for (const event of events) {
            const result = this.publishEvent(event.type, event.data, event.source);
            results.push(result);
        }
        return results;
    }

    /**
     * Event pattern matching subscription
     */
    subscribeToPattern(pattern, callback, subscriberName = 'unknown') {
        // Pattern examples: "grafikBeyni.*", "*.signal", "vivo.execution.*"
        const wrappedCallback = (event) => {
            if (this.matchesPattern(event.type, pattern)) {
                callback(event);
            }
        };
        
        return this.subscribeToEvent('*', wrappedCallback, subscriberName);
    }

    /**
     * Helper methods
     */
    generateEventId() {
        return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }

    updateMetrics(event) {
        this.metrics.totalEvents++;
        
        // Event type metrics
        const typeCount = this.metrics.eventsByType.get(event.type) || 0;
        this.metrics.eventsByType.set(event.type, typeCount + 1);
        
        // System metrics
        const systemCount = this.metrics.eventsBySystem.get(event.source) || 0;
        this.metrics.eventsBySystem.set(event.source, systemCount + 1);
    }

    addToHistory(event) {
        this.eventHistory.push(event);
        if (this.eventHistory.length > this.maxHistorySize) {
            this.eventHistory.shift();
        }
    }

    updateSystemStatus(source, event) {
        if (this.systemStatus.has(source)) {
            this.systemStatus.get(source).lastEvent = event;
        }
    }

    matchesPattern(eventType, pattern) {
        const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
        return regex.test(eventType);
    }

    setupErrorHandling() {
        this.on('error', (errorEvent) => {
            console.error('🚨 Event Bus Error:', errorEvent);
        });
    }

    setupMetrics() {
        if (this.config.enableMetrics) {
            setInterval(() => {
                this.publishEvent('eventBus.metrics', this.getMetrics(), 'eventBus');
            }, 60000); // Her dakika metrics yayınla
        }
    }

    /**
     * Status ve metrics getter'lar
     */
    getMetrics() {
        const runtime = Date.now() - this.metrics.startTime;
        return {
            ...this.metrics,
            runtime: runtime,
            eventsPerSecond: this.metrics.totalEvents / (runtime / 1000),
            systems: Object.fromEntries(this.systemStatus)
        };
    }

    getSystemStatus() {
        return Object.fromEntries(this.systemStatus);
    }

    getEventHistory(limit = 50) {
        return this.eventHistory.slice(-limit);
    }

    /**
     * Debugging utilities
     */
    enableDebugMode() {
        this.subscribeToEvent('*', (event) => {
            console.log('🔍 DEBUG Event:', {
                type: event.type,
                source: event.source,
                timestamp: new Date(event.timestamp).toISOString(),
                data: event.data
            });
        }, 'debugger');
    }

    /**
     * Graceful shutdown
     */
    shutdown() {
        console.log('🔴 Event Bus shutting down...');
        this.publishEvent('eventBus.shutdown', this.getMetrics(), 'eventBus');
        this.removeAllListeners();
    }
}

// Singleton instance
const eventBus = new ModularEventStream({
    enableLogging: true,
    enableMetrics: true,
    maxListeners: 200
});

// Event type constants
const EVENT_TYPES = {
    // Grafik Beyni Events
    TECHNICAL_ANALYSIS: 'grafikBeyni.technical.analysis',
    PATTERN_DETECTED: 'grafikBeyni.pattern.detected',
    TREND_CHANGE: 'grafikBeyni.trend.change',
    SUPPORT_RESISTANCE: 'grafikBeyni.levels.update',
    
    // VIVO Events  
    SIGNAL_GENERATED: 'vivo.signal.generated',
    EXECUTION_ORDER: 'vivo.execution.order',
    RISK_ASSESSMENT: 'vivo.risk.assessment',
    POSITION_UPDATE: 'vivo.position.update',
    
    // Otobilinç Events
    BIAS_DETECTED: 'otobilinc.bias.detected',
    PSYCHOLOGICAL_STATE: 'otobilinc.psychology.state',
    OVERTRADING_WARNING: 'otobilinc.overtrading.warning',
    
    // LIVIA Events
    SENTIMENT_ANALYSIS: 'livia.sentiment.analysis',
    NEWS_IMPACT: 'livia.news.impact',
    EMOTIONAL_FILTER: 'livia.emotional.filter',
    
    // Denetim Asistanı Events
    MONITORING_ALERT: 'denetimAsistani.monitoring.alert',
    PERFORMANCE_REPORT: 'denetimAsistani.performance.report',
    INCIDENT_DETECTED: 'denetimAsistani.incident.detected',
    
    // System Events
    SYSTEM_READY: 'system.ready',
    ERROR: 'system.error',
    METRICS: 'eventBus.metrics'
};

module.exports = {
    ModularEventStream,
    eventBus,
    EVENT_TYPES
};