/**
 * LIVIA-58: Freshness Validator
 * Tazlik doğrulayıcı
 * Amaç: Veri ve analiz sonuçlarının tazliğini doğrular
 */

const crypto = require('crypto');
const { EventEmitter } = require('events');
const { trace, context, SpanStatusCode } = require('@opentelemetry/api');

class FreshnessValidator extends EventEmitter {
    constructor(config = {}) {
        super();
        
        this.name = 'FreshnessValidator';
        this.config = {
            enabled: true,
            locale: 'tr-TR',
            timezone: 'Europe/Istanbul',
            thresholds: {
                realtime: 30, // 30 seconds
                neartime: 300, // 5 minutes
                batch: 3600, // 1 hour
                archived: 86400 // 24 hours
            },
            ...config
        };
        
        this.state = 'IDLE';
        this.freshnessCache = new Map();
        this.validationRules = new Map();
        this.metrics = { validated: 0, expired: 0, avgAge: 0 };
        
        this.isInitialized = false;
        this.logger = null;
        this.tracer = trace.getTracer('livia-freshness-validator');
    }

    async initialize(eventBus, logger) {
        try {
            this.eventBus = eventBus;
            this.logger = logger;
            this.logger.info(`${this.name} başlatılıyor...`);
            
            this.setupEventListeners();
            this.setupValidationRules();
            
            this.isInitialized = true;
            this.logger.info(`${this.name} başarıyla başlatıldı`);
            return true;
        } catch (error) {
            this.logger.error(`${this.name} başlatma hatası:`, error);
            return false;
        }
    }

    setupEventListeners() {
        this.eventBus.on('data.freshness.validate', this.handleFreshnessValidateRequest.bind(this));
        this.eventBus.on('analysis.age.check', this.handleAnalysisAgeCheck.bind(this));
    }

    setupValidationRules() {
        this.validationRules.set('price_data', this.config.thresholds.realtime);
        this.validationRules.set('volume_data', this.config.thresholds.realtime);
        this.validationRules.set('technical_analysis', this.config.thresholds.neartime);
        this.validationRules.set('news_data', this.config.thresholds.batch);
        this.validationRules.set('sentiment_analysis', this.config.thresholds.batch);
    }

    async handleFreshnessValidateRequest(event) {
        const span = this.tracer.startSpan('freshness.validate');
        
        try {
            const { data, dataType, requestId } = event;
            
            const freshnessResult = await this.validateFreshness(data, dataType);
            
            this.emit('freshness.validation.result', {
                event: 'freshness.validation.result',
                timestamp: new Date().toISOString(),
                requestId,
                dataType,
                age: freshnessResult.age,
                threshold: freshnessResult.threshold,
                fresh: freshnessResult.fresh,
                expires: freshnessResult.expires
            });
            
            this.metrics.validated++;
            if (!freshnessResult.fresh) {
                this.metrics.expired++;
            }
            this.metrics.avgAge = (this.metrics.avgAge + freshnessResult.age) / 2;
            
            span.setStatus({ code: SpanStatusCode.OK });
            
        } catch (error) {
            span.recordException(error);
            span.setStatus({ code: SpanStatusCode.ERROR });
            throw error;
        } finally {
            span.end();
        }
    }

    async validateFreshness(data, dataType) {
        const now = Date.now();
        const dataTimestamp = data.timestamp || now;
        const age = (now - dataTimestamp) / 1000; // age in seconds
        
        const threshold = this.validationRules.get(dataType) || this.config.thresholds.batch;
        const fresh = age <= threshold;
        const expires = new Date(dataTimestamp + (threshold * 1000));
        
        return {
            age,
            threshold,
            fresh,
            expires: expires.toISOString()
        };
    }

    async handleAnalysisAgeCheck(event) {
        const span = this.tracer.startSpan('analysis.age.check');
        
        try {
            const { analysisId, createdAt } = event;
            
            const now = Date.now();
            const age = (now - new Date(createdAt).getTime()) / 1000;
            
            this.emit('analysis.age.result', {
                event: 'analysis.age.result',
                timestamp: new Date().toISOString(),
                analysisId,
                age,
                fresh: age <= this.config.thresholds.neartime
            });
            
            span.setStatus({ code: SpanStatusCode.OK });
            
        } catch (error) {
            span.recordException(error);
            span.setStatus({ code: SpanStatusCode.ERROR });
            throw error;
        } finally {
            span.end();
        }
    }

    getStatus() {
        return {
            name: this.name,
            initialized: this.isInitialized,
            state: this.state,
            freshnessCache: this.freshnessCache.size,
            validationRules: Object.fromEntries(this.validationRules),
            metrics: this.metrics,
            config: {
                enabled: this.config.enabled,
                thresholds: this.config.thresholds
            }
        };
    }

    async shutdown() {
        try {
            this.logger.info(`${this.name} durduruluyor...`);
            this.freshnessCache.clear();
            this.validationRules.clear();
            this.isInitialized = false;
            this.logger.info(`${this.name} başarıyla durduruldu`);
        } catch (error) {
            this.logger.error(`${this.name} durdurma hatası:`, error);
        }
    }
}

module.exports = FreshnessValidator;