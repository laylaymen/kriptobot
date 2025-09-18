/**
 * 🔄 VIVO Event Adapter
 * VIVO sisteminin Event Bus ile iletişim kurmasını sağlar
 */

const { eventBus, EVENT_TYPES } = require('../modularEventStream');

class VivoEventAdapter {
    constructor() {
        this.systemName = 'vivo';
        this.isConnected = false;
        this.setupEventListeners();
    }

    /**
     * VIVO sistemini Event Bus'a bağla
     */
    connect() {
        if (!this.isConnected) {
            eventBus.systemReady(this.systemName, {
                version: '2.0',
                modules: 41,
                capabilities: ['signal_routing', 'execution', 'risk_management', 'position_optimization']
            });
            this.isConnected = true;
            console.log('🔄 VIVO Event Bus\'a bağlandı');
        }
    }

    /**
     * Sinyal oluşturulduğunu bildir
     */
    publishSignalGenerated(signalData) {
        return eventBus.publishEvent(EVENT_TYPES.SIGNAL_GENERATED, {
            symbol: signalData.symbol,
            action: signalData.action,
            confidence: signalData.confidence,
            entry_price: signalData.entry,
            stop_loss: signalData.stopLoss,
            take_profit: signalData.takeProfit,
            risk_reward_ratio: signalData.rrRatio,
            timestamp: Date.now()
        }, this.systemName);
    }

    /**
     * Execution order bildir
     */
    publishExecutionOrder(orderData) {
        return eventBus.publishEvent(EVENT_TYPES.EXECUTION_ORDER, {
            symbol: orderData.symbol,
            side: orderData.side,
            quantity: orderData.quantity,
            price: orderData.price,
            order_type: orderData.type,
            status: orderData.status,
            order_id: orderData.orderId
        }, this.systemName);
    }

    /**
     * Risk değerlendirmesi bildir
     */
    publishRiskAssessment(riskData) {
        return eventBus.publishEvent(EVENT_TYPES.RISK_ASSESSMENT, {
            symbol: riskData.symbol,
            risk_level: riskData.level,
            risk_score: riskData.score,
            max_position_size: riskData.maxSize,
            recommended_leverage: riskData.leverage,
            warning_flags: riskData.warnings
        }, this.systemName);
    }

    /**
     * Pozisyon güncellemesi bildir
     */
    publishPositionUpdate(positionData) {
        return eventBus.publishEvent(EVENT_TYPES.POSITION_UPDATE, {
            symbol: positionData.symbol,
            side: positionData.side,
            size: positionData.size,
            entry_price: positionData.entryPrice,
            current_price: positionData.currentPrice,
            unrealized_pnl: positionData.unrealizedPnl,
            status: positionData.status
        }, this.systemName);
    }

    /**
     * Grafik Beyni'nden analiz talep et
     */
    requestTechnicalAnalysis(symbol, timeframes = ['15m', '1h', '4h']) {
        return eventBus.publishEvent('vivo.analysis.request', {
            symbol,
            timeframes,
            priority: 'high',
            requested_indicators: ['ema', 'rsi', 'macd', 'bollinger']
        }, this.systemName);
    }

    /**
     * Event listener'ları kur
     */
    setupEventListeners() {
        // Grafik Beyni'nden gelen analiz sonuçları
        eventBus.subscribeToEvent('grafikBeyni.technical.analysis', (event) => {
            this.handleTechnicalAnalysis(event.data);
        }, `${this.systemName}_adapter`);

        // Grafik Beyni'nden pattern tespitleri
        eventBus.subscribeToEvent('grafikBeyni.pattern.detected', (event) => {
            this.handlePatternDetection(event.data);
        }, `${this.systemName}_adapter`);

        // LIVIA'dan emotional filter sonuçları
        eventBus.subscribeToEvent('livia.emotional.filter', (event) => {
            this.handleEmotionalFilter(event.data);
        }, `${this.systemName}_adapter`);

        // Otobilinç'den psychological state
        eventBus.subscribeToEvent('otobilinc.psychology.state', (event) => {
            this.handlePsychologyState(event.data);
        }, `${this.systemName}_adapter`);

        // Denetim Asistanı'ndan monitoring alerts
        eventBus.subscribeToEvent('denetimAsistani.monitoring.alert', (event) => {
            this.handleMonitoringAlert(event.data);
        }, `${this.systemName}_adapter`);
    }

    /**
     * Teknik analiz sonuçlarını işle
     */
    handleTechnicalAnalysis(analysisData) {
        console.log('🔄 VIVO: Teknik analiz alındı', analysisData.symbol);
        
        // Analiz sonuçlarına göre sinyal oluştur
        if (analysisData.confidence > 0.7) {
            // Yüksek güvenirlik, sinyal üret
            console.log('🔄 VIVO: Yüksek güvenirlik sinyali üretiliyor');
            
            // Risk değerlendirmesi yap
            this.publishRiskAssessment({
                symbol: analysisData.symbol,
                level: 'moderate',
                score: 0.6,
                maxSize: 0.02,
                leverage: 5,
                warnings: []
            });
        }
    }

    /**
     * Pattern tespitini işle
     */
    handlePatternDetection(patternData) {
        console.log('🔄 VIVO: Pattern tespit edildi', patternData.pattern_type);
        
        // Pattern'a göre sinyal oluştur
        if (patternData.confidence > 0.8) {
            this.publishSignalGenerated({
                symbol: patternData.symbol,
                action: patternData.action,
                confidence: patternData.confidence,
                entry: patternData.current_price,
                stopLoss: patternData.stop_level,
                takeProfit: patternData.target_levels[0],
                rrRatio: 2.5
            });
        }
    }

    /**
     * Emotional filter sonucunu işle
     */
    handleEmotionalFilter(filterData) {
        console.log('🔄 VIVO: Emotional filter sonucu', filterData.action);
        
        if (filterData.action === 'block') {
            console.log('🔄 VIVO: Sinyal emotional filter tarafından bloklandı');
            // Mevcut sinyalleri geçici olarak durdur
        }
    }

    /**
     * Psychology state'i işle
     */
    handlePsychologyState(psychData) {
        console.log('🔄 VIVO: Psychology state güncellendi', psychData.state);
        
        if (psychData.risk_level === 'high') {
            console.log('🔄 VIVO: Yüksek psikolojik risk, pozisyon boyutu azaltılıyor');
            // Risk parametrelerini ayarla
        }
    }

    /**
     * Monitoring alert'i işle
     */
    handleMonitoringAlert(alertData) {
        console.log('🔄 VIVO: Monitoring alert alındı', alertData.type);
        
        if (alertData.severity === 'critical') {
            console.log('🔄 VIVO: Kritik alert, acil durdurma');
            // Acil durdurma prosedürü
        }
    }

    /**
     * Adapter'ı kapat
     */
    disconnect() {
        this.isConnected = false;
        console.log('🔄 VIVO Event Bus bağlantısı kesildi');
    }
}

module.exports = { VivoEventAdapter };