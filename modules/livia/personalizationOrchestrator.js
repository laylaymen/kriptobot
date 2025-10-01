/**
 * LIVIA-59: Personalization Orchestrator
 * Kişiselleştirme orkestratörü
 * Amaç: Kullanıcı tercihlerini ve davranışlarını takip ederek kişiselleştirilmiş deneyimler sunar
 */

const crypto = require('crypto');
const { EventEmitter } = require('events');
const { trace, context, SpanStatusCode } = require('@opentelemetry/api');

class PersonalizationOrchestrator extends EventEmitter {
    constructor(config = {}) {
        super();
        
        this.name = 'PersonalizationOrchestrator';
        this.config = {
            enabled: true,
            locale: 'tr-TR',
            timezone: 'Europe/Istanbul',
            personalization: {
                learningRate: 0.1,
                memoryDepth: 100,
                adaptationThreshold: 0.6,
                privacyMode: 'strict'
            },
            ...config
        };
        
        this.state = 'IDLE';
        this.userProfiles = new Map();
        this.behaviorPatterns = new Map();
        this.preferences = new Map();
        this.metrics = { profiles: 0, adaptations: 0, accuracy: 0 };
        
        this.isInitialized = false;
        this.logger = null;
        this.tracer = trace.getTracer('livia-personalization-orchestrator');
    }

    async initialize(eventBus, logger) {
        try {
            this.eventBus = eventBus;
            this.logger = logger;
            this.logger.info(`${this.name} başlatılıyor...`);
            
            this.setupEventListeners();
            this.initializeDefaultProfiles();
            
            this.isInitialized = true;
            this.logger.info(`${this.name} başarıyla başlatıldı`);
            return true;
        } catch (error) {
            this.logger.error(`${this.name} başlatma hatası:`, error);
            return false;
        }
    }

    setupEventListeners() {
        this.eventBus.on('user.behavior.track', this.handleBehaviorTrack.bind(this));
        this.eventBus.on('personalization.request', this.handlePersonalizationRequest.bind(this));
        this.eventBus.on('preference.update', this.handlePreferenceUpdate.bind(this));
    }

    initializeDefaultProfiles() {
        // Conservative trader profile
        this.userProfiles.set('conservative', {
            riskTolerance: 0.3,
            timeHorizon: 'long',
            preferredAssets: ['BTC', 'ETH'],
            notificationFrequency: 'low',
            analysisDepth: 'detailed'
        });
        
        // Aggressive trader profile
        this.userProfiles.set('aggressive', {
            riskTolerance: 0.8,
            timeHorizon: 'short',
            preferredAssets: ['ALTCOINS'],
            notificationFrequency: 'high',
            analysisDepth: 'quick'
        });
        
        // Balanced trader profile
        this.userProfiles.set('balanced', {
            riskTolerance: 0.5,
            timeHorizon: 'medium',
            preferredAssets: ['BTC', 'ETH', 'ALTCOINS'],
            notificationFrequency: 'medium',
            analysisDepth: 'moderate'
        });
    }

    async handleBehaviorTrack(event) {
        const span = this.tracer.startSpan('behavior.track');
        
        try {
            const { userId, action, context } = event;
            
            await this.trackUserBehavior(userId, action, context);
            
            this.emit('behavior.tracked', {
                event: 'behavior.tracked',
                timestamp: new Date().toISOString(),
                userId,
                action,
                patterns: this.behaviorPatterns.get(userId) || []
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

    async trackUserBehavior(userId, action, context) {
        if (!this.behaviorPatterns.has(userId)) {
            this.behaviorPatterns.set(userId, []);
        }
        
        const patterns = this.behaviorPatterns.get(userId);
        patterns.push({
            action,
            context,
            timestamp: new Date().toISOString()
        });
        
        // Keep only recent behaviors
        if (patterns.length > this.config.personalization.memoryDepth) {
            patterns.shift();
        }
        
        // Update user profile based on behavior
        await this.updateProfileFromBehavior(userId, patterns);
    }

    async updateProfileFromBehavior(userId, patterns) {
        if (!this.userProfiles.has(userId)) {
            // Create new profile based on behavior analysis
            const profile = await this.analyzeUserBehavior(patterns);
            this.userProfiles.set(userId, profile);
            this.metrics.profiles++;
        } else {
            // Adapt existing profile
            const currentProfile = this.userProfiles.get(userId);
            const adaptedProfile = await this.adaptProfile(currentProfile, patterns);
            this.userProfiles.set(userId, adaptedProfile);
            this.metrics.adaptations++;
        }
    }

    async analyzeUserBehavior(patterns) {
        // Mock behavior analysis
        const riskActions = patterns.filter(p => p.action.includes('risk')).length;
        const totalActions = patterns.length;
        
        const riskTolerance = totalActions > 0 ? riskActions / totalActions : 0.5;
        
        return {
            riskTolerance,
            timeHorizon: riskTolerance > 0.6 ? 'short' : 'medium',
            preferredAssets: ['BTC', 'ETH'],
            notificationFrequency: 'medium',
            analysisDepth: 'moderate',
            createdAt: new Date().toISOString()
        };
    }

    async adaptProfile(currentProfile, patterns) {
        // Simple adaptation logic
        const recentPatterns = patterns.slice(-10);
        const riskActions = recentPatterns.filter(p => p.action.includes('risk')).length;
        const adaptationFactor = this.config.personalization.learningRate;
        
        const newRiskTolerance = currentProfile.riskTolerance + 
            (adaptationFactor * (riskActions / recentPatterns.length - currentProfile.riskTolerance));
        
        return {
            ...currentProfile,
            riskTolerance: Math.max(0, Math.min(1, newRiskTolerance)),
            updatedAt: new Date().toISOString()
        };
    }

    async handlePersonalizationRequest(event) {
        const span = this.tracer.startSpan('personalization.request');
        
        try {
            const { userId, requestType, requestId } = event;
            
            const personalizedResponse = await this.generatePersonalizedResponse(userId, requestType);
            
            this.emit('personalization.response', {
                event: 'personalization.response',
                timestamp: new Date().toISOString(),
                requestId,
                userId,
                response: personalizedResponse
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

    async generatePersonalizedResponse(userId, requestType) {
        const profile = this.userProfiles.get(userId) || this.userProfiles.get('balanced');
        
        return {
            riskLevel: profile.riskTolerance,
            recommendedAssets: profile.preferredAssets,
            analysisStyle: profile.analysisDepth,
            notificationSettings: profile.notificationFrequency,
            adaptedAt: new Date().toISOString()
        };
    }

    getStatus() {
        return {
            name: this.name,
            initialized: this.isInitialized,
            state: this.state,
            userProfiles: this.userProfiles.size,
            behaviorPatterns: this.behaviorPatterns.size,
            preferences: this.preferences.size,
            metrics: this.metrics,
            config: {
                enabled: this.config.enabled,
                personalization: this.config.personalization
            }
        };
    }

    async shutdown() {
        try {
            this.logger.info(`${this.name} durduruluyor...`);
            this.userProfiles.clear();
            this.behaviorPatterns.clear();
            this.preferences.clear();
            this.isInitialized = false;
            this.logger.info(`${this.name} başarıyla durduruldu`);
        } catch (error) {
            this.logger.error(`${this.name} durdurma hatası:`, error);
        }
    }
}

module.exports = PersonalizationOrchestrator;