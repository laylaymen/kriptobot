/**
 * 🧠 Grafik Beyni Event Adapter
 * Grafik Beyni sisteminin Event Bus ile iletişim kurmasını sağlar
 */

const { eventBus, EVENT_TYPES } = require('../modularEventStream');

class GrafikBeyniEventAdapter {
    constructor() {
        this.systemName = 'grafikBeyni';
        this.isConnected = false;
        this.setupEventListeners();
    }

    /**
     * Grafik Beyni sistemini Event Bus'a bağla
     */
    connect() {
        if (!this.isConnected) {
            eventBus.systemReady(this.systemName, {
                version: '2.0',
                modules: 81,
                capabilities: ['technical_analysis', 'pattern_recognition', 'trend_detection']
            });
            this.isConnected = true;
            console.log('🧠 Grafik Beyni Event Bus\'a bağlandı');
        }
    }

    /**
     * Teknik analiz sonuçlarını yayınla
     */
    publishTechnicalAnalysis(symbol, analysis) {
        return eventBus.publishEvent(EVENT_TYPES.TECHNICAL_ANALYSIS, {
            symbol,
            timestamp: Date.now(),
            indicators: analysis.indicators,
            signals: analysis.signals,
            confidence: analysis.confidence,
            recommendations: analysis.recommendations
        }, this.systemName);
    }

    /**
     * Pattern tespit edildiğinde bildir
     */
    publishPatternDetected(symbol, pattern) {
        return eventBus.publishEvent(EVENT_TYPES.PATTERN_DETECTED, {
            symbol,
            pattern_type: pattern.type,
            confidence: pattern.confidence,
            timeframe: pattern.timeframe,
            action: pattern.action,
            target_levels: pattern.targets
        }, this.systemName);
    }

    /**
     * Trend değişikliği bildir
     */
    publishTrendChange(symbol, trendData) {
        return eventBus.publishEvent(EVENT_TYPES.TREND_CHANGE, {
            symbol,
            old_trend: trendData.oldTrend,
            new_trend: trendData.newTrend,
            strength: trendData.strength,
            confirmation_level: trendData.confirmation
        }, this.systemName);
    }

    /**
     * Support/Resistance seviyelerini güncelle
     */
    publishSupportResistanceUpdate(symbol, levels) {
        return eventBus.publishEvent(EVENT_TYPES.SUPPORT_RESISTANCE, {
            symbol,
            support_levels: levels.support,
            resistance_levels: levels.resistance,
            strength_scores: levels.strengths,
            last_update: Date.now()
        }, this.systemName);
    }

    /**
     * Event listener'ları kur
     */
    setupEventListeners() {
        // VIVO'dan gelen sinyal talepleri
        eventBus.subscribeToEvent('vivo.analysis.request', (event) => {
            this.handleAnalysisRequest(event.data);
        }, `${this.systemName}_adapter`);

        // LIVIA'dan gelen sentiment bilgileri
        eventBus.subscribeToEvent('livia.sentiment.analysis', (event) => {
            this.handleSentimentData(event.data);
        }, `${this.systemName}_adapter`);

        // Otobilinç'den gelen bias uyarıları
        eventBus.subscribeToEvent('otobilinc.bias.detected', (event) => {
            this.handleBiasWarning(event.data);
        }, `${this.systemName}_adapter`);
    }

    /**
     * VIVO'dan analiz talebini işle
     */
    handleAnalysisRequest(requestData) {
        console.log('🧠 Grafik Beyni: Analiz talebi alındı', requestData.symbol);
        // Burada gerçek analiz modülleri çağırılacak
        // Örnek: technicalIndicatorsEngine.getIndicators(requestData.symbol)
    }

    /**
     * LIVIA'dan sentiment verisini işle
     */
    handleSentimentData(sentimentData) {
        console.log('🧠 Grafik Beyni: Sentiment verisi alındı', sentimentData.sentiment);
        // Sentiment verisini teknik analizle birleştir
    }

    /**
     * Otobilinç'den bias uyarısını işle
     */
    handleBiasWarning(biasData) {
        console.log('🧠 Grafik Beyni: Bias uyarısı alındı', biasData.bias_type);
        // Bias'a göre analiz parametrelerini ayarla
    }

    /**
     * Adapter'ı kapat
     */
    disconnect() {
        this.isConnected = false;
        console.log('🧠 Grafik Beyni Event Bus bağlantısı kesildi');
    }
}

module.exports = { GrafikBeyniEventAdapter };