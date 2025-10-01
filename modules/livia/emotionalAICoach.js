/**
 * LIVIA-40: Emotional AI Coach
 * Trader'ların duygusal durumlarını analiz ederek kişiselleştirilmiş coaching ve rehberlik sağlar.
 * Psikolojik destek, duygusal düzenleme ve performans gelişimi için AI destekli rehberlik.
 */

const { z } = require('zod');
const { eventBus } = require('../../kirpto bot sinyal/modules/modularEventStream');
const { logInfo, logError, logEvent } = require('../../kirpto bot sinyal/logs/logger');

// Input Schemas
const EmotionalStateAssessmentSchema = z.object({
    event: z.literal('emotional.state.assessment'),
    timestamp: z.string(),
    userId: z.string(),
    sessionId: z.string(),
    emotionalData: z.object({
        currentEmotion: z.enum(['fear', 'greed', 'fomo', 'anxiety', 'confidence', 'euphoria', 'despair', 'calm', 'anger', 'excitement']),
        intensity: z.number().min(0).max(1),
        duration: z.number(), // minutes
        triggers: z.array(z.string()),
        physicalSigns: z.array(z.enum(['rapid_clicking', 'hesitation', 'impulsive_actions', 'analysis_paralysis'])),
        tradingContext: z.object({
            recentPnL: z.number(),
            positionsOpen: z.number(),
            marketCondition: z.enum(['volatile', 'trending', 'ranging', 'news_driven']),
            timeOfDay: z.string(),
            tradingHours: z.number()
        })
    }),
    historicalPatterns: z.array(z.object({
        emotion: z.string(),
        outcome: z.enum(['positive', 'negative', 'neutral']),
        timestamp: z.string(),
        context: z.string()
    })).optional()
}).strict();

const CoachingRequestSchema = z.object({
    event: z.literal('coaching.request'),
    timestamp: z.string(),
    userId: z.string(),
    requestType: z.enum(['immediate_support', 'session_review', 'strategy_guidance', 'emotional_regulation', 'performance_analysis']),
    context: z.object({
        currentSituation: z.string(),
        emotionalState: z.string(),
        urgencyLevel: z.enum(['low', 'medium', 'high', 'critical']),
        preferredStyle: z.enum(['supportive', 'analytical', 'directive', 'collaborative']),
        specificConcerns: z.array(z.string())
    }),
    sessionData: z.object({
        tradesCount: z.number(),
        winRate: z.number(),
        avgHoldTime: z.number(),
        emotionalVolatility: z.number()
    }).optional()
}).strict();

// Output Schemas
const CoachingResponseSchema = z.object({
    event: z.literal('coaching.response'),
    timestamp: z.string(),
    userId: z.string(),
    sessionId: z.string(),
    coaching: z.object({
        primaryMessage: z.string(),
        actionItems: z.array(z.object({
            action: z.string(),
            priority: z.enum(['immediate', 'short_term', 'long_term']),
            expectedBenefit: z.string(),
            difficulty: z.enum(['easy', 'moderate', 'challenging'])
        })),
        emotionalGuidance: z.object({
            technique: z.enum(['breathing', 'mindfulness', 'reframing', 'grounding', 'visualization']),
            instructions: z.string(),
            duration: z.number(), // minutes
            frequency: z.string()
        }),
        strategicAdvice: z.object({
            suggestion: z.string(),
            reasoning: z.string(),
            riskLevel: z.enum(['low', 'medium', 'high']),
            timeframe: z.string()
        })
    }),
    personalization: z.object({
        tone: z.enum(['encouraging', 'analytical', 'firm', 'gentle']),
        communicationStyle: z.string(),
        culturalConsiderations: z.string().optional(),
        learningPreferences: z.array(z.string())
    }),
    followUp: z.object({
        checkInTime: z.string(),
        metricsToTrack: z.array(z.string()),
        nextSessionSuggestion: z.string(),
        homeworkTasks: z.array(z.string())
    }),
    analytics: z.object({
        emotionalTrend: z.enum(['improving', 'stable', 'declining', 'volatile']),
        progressScore: z.number().min(0).max(1),
        areasOfGrowth: z.array(z.string()),
        strengthsToLeverage: z.array(z.string())
    })
}).strict();

const PersonalityProfileSchema = z.object({
    event: z.literal('personality.profile.update'),
    timestamp: z.string(),
    userId: z.string(),
    profile: z.object({
        tradingPersonality: z.enum(['conservative', 'aggressive', 'balanced', 'analytical', 'intuitive']),
        riskTolerance: z.number().min(0).max(1),
        emotionalPatterns: z.record(z.number()),
        copingMechanisms: z.array(z.string()),
        stressors: z.array(z.string()),
        motivations: z.array(z.string()),
        learningStyle: z.enum(['visual', 'auditory', 'kinesthetic', 'reading']),
        communicationPreferences: z.object({
            directness: z.number().min(0).max(1),
            supportiveness: z.number().min(0).max(1),
            analyticalDepth: z.number().min(0).max(1)
        })
    }),
    confidence: z.number().min(0).max(1),
    lastUpdated: z.string()
}).strict();

/**
 * AI-Powered Emotional Intelligence Engine
 */
class EmotionalIntelligenceEngine {
    constructor() {
        this.emotionModels = new Map();
        this.personalityProfiles = new Map();
        this.coachingStrategies = new Map();
        this.isInitialized = false;
        
        // Emotional regulation techniques database
        this.techniques = {
            breathing: {
                '4-7-8': 'Inhale for 4, hold for 7, exhale for 8 seconds',
                'box_breathing': 'Inhale 4, hold 4, exhale 4, hold 4 seconds',
                'belly_breathing': 'Deep diaphragmatic breathing for 5 minutes'
            },
            mindfulness: {
                'present_moment': 'Focus on current market observation without judgment',
                'body_scan': 'Notice physical tension and consciously relax',
                'thought_labeling': 'Label thoughts as "planning", "worrying", or "analyzing"'
            },
            reframing: {
                'loss_learning': 'What can this loss teach me about the market?',
                'opportunity_focus': 'Where is the opportunity in this challenge?',
                'process_over_outcome': 'Focus on following the process, not the result'
            },
            grounding: {
                '5-4-3-2-1': 'Notice 5 things you see, 4 you hear, 3 you feel, 2 you smell, 1 you taste',
                'feet_on_floor': 'Feel your feet on the ground and breathe deeply',
                'object_focus': 'Focus intensely on one object for 2 minutes'
            },
            visualization: {
                'successful_trade': 'Visualize executing a perfect trade with calm confidence',
                'safe_space': 'Imagine a place where you feel completely secure and calm',
                'future_success': 'See yourself as the successful trader you want to become'
            }
        };
        
        // Coaching frameworks
        this.frameworks = {
            GROW: ['Goal', 'Reality', 'Options', 'Way Forward'],
            CLEAR: ['Contracting', 'Listening', 'Exploring', 'Action', 'Review'],
            OSKAR: ['Outcome', 'Scaling', 'Know-how', 'Affirm', 'Review']
        };
    }

    initialize() {
        this.initializeEmotionModels();
        this.initializeCoachingStrategies();
        this.isInitialized = true;
    }

    initializeEmotionModels() {
        // Simplified emotion recognition models
        this.emotionModels.set('fear', {
            triggers: ['large_loss', 'volatility_spike', 'news_negative'],
            physicalSigns: ['hesitation', 'analysis_paralysis'],
            interventions: ['breathing', 'grounding', 'reframing']
        });
        
        this.emotionModels.set('greed', {
            triggers: ['winning_streak', 'fomo', 'big_gain'],
            physicalSigns: ['rapid_clicking', 'impulsive_actions'],
            interventions: ['mindfulness', 'grounding', 'visualization']
        });
        
        this.emotionModels.set('anxiety', {
            triggers: ['uncertainty', 'position_size', 'time_pressure'],
            physicalSigns: ['rapid_clicking', 'hesitation'],
            interventions: ['breathing', 'mindfulness', 'grounding']
        });
    }

    initializeCoachingStrategies() {
        this.coachingStrategies.set('conservative', {
            approach: 'supportive',
            focus: ['risk_management', 'patience', 'gradual_growth'],
            communication: 'gentle and reassuring'
        });
        
        this.coachingStrategies.set('aggressive', {
            approach: 'directive',
            focus: ['discipline', 'risk_control', 'emotional_regulation'],
            communication: 'firm but supportive'
        });
        
        this.coachingStrategies.set('analytical', {
            approach: 'collaborative',
            focus: ['data_driven_decisions', 'systematic_approach', 'continuous_learning'],
            communication: 'detailed and logical'
        });
    }

    /**
     * Analyze emotional state and generate insights
     */
    analyzeEmotionalState(emotionalData) {
        const { currentEmotion, intensity, triggers, tradingContext } = emotionalData;
        
        // Get emotion model
        const emotionModel = this.emotionModels.get(currentEmotion) || {};
        
        // Analyze intensity and context
        const riskLevel = this.assessEmotionalRisk(currentEmotion, intensity, tradingContext);
        
        // Identify patterns
        const patterns = this.identifyEmotionalPatterns(emotionalData);
        
        // Generate insights
        return {
            primaryConcern: this.identifyPrimaryConcern(emotionalData),
            riskLevel,
            recommendedInterventions: emotionModel.interventions || ['mindfulness'],
            patterns,
            urgency: this.calculateUrgency(riskLevel, intensity, tradingContext)
        };
    }

    assessEmotionalRisk(emotion, intensity, context) {
        let riskScore = intensity;
        
        // High-risk emotions
        if (['fear', 'greed', 'fomo', 'euphoria', 'despair'].includes(emotion)) {
            riskScore *= 1.5;
        }
        
        // Context factors
        if (context.recentPnL < -1000) riskScore *= 1.3;
        if (context.positionsOpen > 5) riskScore *= 1.2;
        if (context.tradingHours > 8) riskScore *= 1.1;
        
        if (riskScore > 0.8) return 'critical';
        if (riskScore > 0.6) return 'high';
        if (riskScore > 0.4) return 'medium';
        return 'low';
    }

    identifyPrimaryConcern(emotionalData) {
        const { currentEmotion, triggers, tradingContext } = emotionalData;
        
        if (tradingContext.recentPnL < -500) return 'loss_management';
        if (currentEmotion === 'fomo') return 'impulse_control';
        if (triggers.includes('volatility')) return 'uncertainty_tolerance';
        if (tradingContext.tradingHours > 6) return 'fatigue_management';
        
        return 'emotional_regulation';
    }

    identifyEmotionalPatterns(emotionalData) {
        // Simplified pattern recognition
        const patterns = [];
        
        if (emotionalData.intensity > 0.7) {
            patterns.push('high_intensity_episodes');
        }
        
        if (emotionalData.triggers.length > 2) {
            patterns.push('multiple_trigger_sensitivity');
        }
        
        return patterns;
    }

    calculateUrgency(riskLevel, intensity, context) {
        if (riskLevel === 'critical' || intensity > 0.9) return 'critical';
        if (riskLevel === 'high' || context.positionsOpen > 3) return 'high';
        if (riskLevel === 'medium') return 'medium';
        return 'low';
    }

    /**
     * Generate personalized coaching response
     */
    generateCoachingResponse(userId, insights, requestContext, personalityProfile) {
        const coachingStrategy = this.selectCoachingStrategy(personalityProfile, insights);
        
        return {
            primaryMessage: this.craftPrimaryMessage(insights, coachingStrategy),
            actionItems: this.generateActionItems(insights, coachingStrategy),
            emotionalGuidance: this.selectEmotionalTechnique(insights),
            strategicAdvice: this.generateStrategicAdvice(insights, requestContext),
            personalization: this.personalizeResponse(personalityProfile, coachingStrategy),
            followUp: this.planFollowUp(insights, requestContext)
        };
    }

    selectCoachingStrategy(profile, insights) {
        if (!profile) return this.coachingStrategies.get('balanced') || {};
        
        const personality = profile.tradingPersonality;
        return this.coachingStrategies.get(personality) || this.coachingStrategies.get('balanced') || {};
    }

    craftPrimaryMessage(insights, strategy) {
        const concern = insights.primaryConcern;
        const riskLevel = insights.riskLevel;
        
        const messages = {
            loss_management: {
                low: "Kayıplar trading'in doğal bir parçası. Bu durumu öğrenme fırsatına çevirelim.",
                medium: "Son kayıpların seni etkilediğini görüyorum. Birlikte bu durumu analiz edelim.",
                high: "Kayıpların duygusal yük oluşturmuş. Önce sakinleşmeye odaklanalım.",
                critical: "Şu anda duygusal olarak zorlu bir dönemdesin. Acil duygusal destek gerekiyor."
            },
            impulse_control: {
                low: "FOMO hissini fark ettiğin için tebrikler. Bu farkındalık çok değerli.",
                medium: "FOMO duygusunu yönetmeye odaklanalım. Sistematik yaklaşım gerekiyor.",
                high: "İmpulsif davranışlar riski artırıyor. Dur, nefes al, değerlendir.",
                critical: "Kontrolü kaybetme riski var. Hemen trading'i durdur ve nefes al."
            },
            uncertainty_tolerance: {
                low: "Belirsizlik her trader'ın karşılaştığı durum. Bunu nasıl yönetebiliriz?",
                medium: "Belirsizlikle başa çıkma stratejilerin geliştirilmeli. Birlikte çalışalım.",
                high: "Belirsizlik seni çok etkiliyor. Odak noktanı kontrol edebileceklerinde topla.",
                critical: "Belirsizlik panik yaratıyor. Acil grounding teknikleri gerekiyor."
            },
            fatigue_management: {
                low: "Uzun trading saatleri yorgunluk yaratmış. Mola zamanı gelmiş.",
                medium: "Mental yorgunluk performansını etkiliyor. Dinlenme stratejisi gerekli.",
                high: "Yorgunluk riskli kararlar aldırıyor. Trading'i durdur, dinlen.",
                critical: "Aşırı yorgunluk kritik seviyede. Hemen trading'i bırak ve dinlen."
            }
        };
        
        return messages[concern]?.[riskLevel] || "Duygusal durumunu desteklemek için buradayım.";
    }

    generateActionItems(insights, strategy) {
        const items = [];
        
        switch (insights.primaryConcern) {
            case 'loss_management':
                items.push({
                    action: 'Son 3 kaybın detaylı analizini yap',
                    priority: 'immediate',
                    expectedBenefit: 'Kayıp nedenlerini anlamak',
                    difficulty: 'moderate'
                });
                break;
                
            case 'impulse_control':
                items.push({
                    action: '10 dakika bekleme kuralı uygula',
                    priority: 'immediate',
                    expectedBenefit: 'İmpulsif kararları azaltmak',
                    difficulty: 'easy'
                });
                break;
                
            case 'uncertainty_tolerance':
                items.push({
                    action: 'Kontrol edemediğin faktörleri listele',
                    priority: 'short_term',
                    expectedBenefit: 'Odağı kontrol edilebilirlere çevirmek',
                    difficulty: 'moderate'
                });
                break;
        }
        
        return items;
    }

    selectEmotionalTechnique(insights) {
        const emotion = insights.primaryConcern;
        const riskLevel = insights.riskLevel;
        
        // High urgency situations need immediate techniques
        if (riskLevel === 'critical') {
            return {
                technique: 'breathing',
                instructions: this.techniques.breathing['4-7-8'],
                duration: 5,
                frequency: 'Şimdi ve gerektiğinde'
            };
        }
        
        // Select based on primary concern
        const techniqueMap = {
            loss_management: 'reframing',
            impulse_control: 'grounding',
            uncertainty_tolerance: 'mindfulness',
            fatigue_management: 'breathing'
        };
        
        const selectedTechnique = techniqueMap[emotion] || 'mindfulness';
        const techniques = this.techniques[selectedTechnique];
        const techniqueKey = Object.keys(techniques)[0];
        
        return {
            technique: selectedTechnique,
            instructions: techniques[techniqueKey],
            duration: selectedTechnique === 'breathing' ? 5 : 10,
            frequency: 'Günde 2-3 kez'
        };
    }

    generateStrategicAdvice(insights, context) {
        const advice = {
            loss_management: {
                suggestion: 'Position boyutunu %50 azalt ve risk yönetim kurallarını gözden geçir',
                reasoning: 'Duygusal stres altındayken daha küçük pozisyonlar daha iyi kontrol sağlar',
                riskLevel: 'low',
                timeframe: 'Bu hafta'
            },
            impulse_control: {
                suggestion: 'Her işlem öncesi 5 dakikalık analiz check-list\'i uygula',
                reasoning: 'Sistematik yaklaşım impulsif kararları önler',
                riskLevel: 'medium',
                timeframe: 'Hemen başla'
            },
            uncertainty_tolerance: {
                suggestion: 'Sadece yüksek probabilite setup\'larında işlem yap',
                reasoning: 'Belirsizlik zamanlarında seçici olmak daha güvenli',
                riskLevel: 'low',
                timeframe: 'Bu hafta'
            },
            fatigue_management: {
                suggestion: '2 saat trading sonrası 30 dakika mola al',
                reasoning: 'Mental yorgunluk hata oranını artırır',
                riskLevel: 'medium',
                timeframe: 'Hemen uygula'
            }
        };
        
        return advice[insights.primaryConcern] || advice.loss_management;
    }

    personalizeResponse(profile, strategy) {
        if (!profile) {
            return {
                tone: 'encouraging',
                communicationStyle: 'Destekleyici ve anlayışlı',
                learningPreferences: ['görsel', 'deneyimsel']
            };
        }
        
        const prefs = profile.communicationPreferences || {};
        
        return {
            tone: prefs.supportiveness > 0.7 ? 'gentle' : 
                  prefs.directness > 0.7 ? 'firm' : 'encouraging',
            communicationStyle: `${prefs.analyticalDepth > 0.5 ? 'Detaylı' : 'Basit'} ve ${prefs.directness > 0.5 ? 'direkt' : 'nazik'}`,
            learningPreferences: [profile.learningStyle || 'visual', 'practical']
        };
    }

    planFollowUp(insights, context) {
        const urgency = insights.urgency;
        
        const followUpTimes = {
            critical: '2 saat içinde',
            high: '24 saat içinde',
            medium: '3 gün içinde',
            low: '1 hafta içinde'
        };
        
        return {
            checkInTime: followUpTimes[urgency],
            metricsToTrack: ['duygusal durum', 'trading performansı', 'teknik uygulama'],
            nextSessionSuggestion: `${urgency === 'critical' ? 'Acil' : 'Planlı'} coaching seansı`,
            homeworkTasks: ['Günlük duygusal check-in', 'Seçilen tekniği uygula', 'Trading günlüğü tut']
        };
    }

    /**
     * Update personality profile based on interactions
     */
    updatePersonalityProfile(userId, emotionalData, responseEffectiveness) {
        let profile = this.personalityProfiles.get(userId) || this.createDefaultProfile();
        
        // Update emotional patterns
        const emotion = emotionalData.currentEmotion;
        if (!profile.emotionalPatterns[emotion]) {
            profile.emotionalPatterns[emotion] = 0;
        }
        profile.emotionalPatterns[emotion] += emotionalData.intensity;
        
        // Update based on response effectiveness
        if (responseEffectiveness > 0.7) {
            // Current approach is working
            profile.confidence = Math.min(1, profile.confidence + 0.1);
        } else if (responseEffectiveness < 0.3) {
            // Need to adjust approach
            profile.confidence = Math.max(0, profile.confidence - 0.05);
        }
        
        profile.lastUpdated = new Date().toISOString();
        this.personalityProfiles.set(userId, profile);
        
        return profile;
    }

    createDefaultProfile() {
        return {
            tradingPersonality: 'balanced',
            riskTolerance: 0.5,
            emotionalPatterns: {},
            copingMechanisms: [],
            stressors: [],
            motivations: [],
            learningStyle: 'visual',
            communicationPreferences: {
                directness: 0.5,
                supportiveness: 0.7,
                analyticalDepth: 0.5
            }
        };
    }
}

/**
 * LIVIA-40 Emotional AI Coach Class
 */
class EmotionalAICoach {
    constructor(config = {}) {
        this.name = 'EmotionalAICoach';
        this.config = {
            enabled: true,
            maxSessionLength: 3600000, // 1 hour
            emergencyResponseTime: 300000, // 5 minutes
            followUpIntervals: {
                critical: 7200000, // 2 hours
                high: 86400000, // 24 hours
                medium: 259200000, // 3 days
                low: 604800000 // 1 week
            },
            ...config
        };

        this.state = {
            activeSessions: new Map(), // sessionId -> session data
            userProfiles: new Map(), // userId -> personality profile
            coachingHistory: new Map(), // userId -> coaching history
            emergencyFlags: new Map(), // userId -> emergency status
            performanceMetrics: new Map(), // userId -> metrics
            followUpQueue: new Map() // userId -> follow-up data
        };

        this.emotionalEngine = new EmotionalIntelligenceEngine();
        this.isInitialized = false;
        this.logger = null;

        // Session management
        this.activeSessions = new Map();
        this.sessionTimeout = 30 * 60 * 1000; // 30 minutes
    }

    /**
     * Initialize the Emotional AI Coach
     */
    async initialize(logger) {
        try {
            this.logger = logger;
            this.logger.info(`${this.name} başlatılıyor...`);

            // Initialize emotional intelligence engine
            this.emotionalEngine.initialize();

            // Setup event listeners
            this.setupEventListeners();

            // Start session monitoring
            this.startSessionMonitoring();

            // Start follow-up scheduler
            this.startFollowUpScheduler();

            this.isInitialized = true;
            this.logger.info(`${this.name} başarıyla başlatıldı`);
            return true;
        } catch (error) {
            this.logger.error(`${this.name} başlatma hatası:`, error);
            return false;
        }
    }

    /**
     * Setup event listeners
     */
    setupEventListeners() {
        eventBus.subscribeToEvent('emotional.state.assessment', (data) => {
            this.handleEmotionalStateAssessment(data);
        }, 'emotionalAICoach');

        eventBus.subscribeToEvent('coaching.request', (data) => {
            this.handleCoachingRequest(data);
        }, 'emotionalAICoach');

        eventBus.subscribeToEvent('trading.session.start', (data) => {
            this.handleTradingSessionStart(data);
        }, 'emotionalAICoach');

        eventBus.subscribeToEvent('trading.session.end', (data) => {
            this.handleTradingSessionEnd(data);
        }, 'emotionalAICoach');
    }

    /**
     * Handle emotional state assessment
     */
    async handleEmotionalStateAssessment(data) {
        try {
            const validated = EmotionalStateAssessmentSchema.parse(data);
            
            // Analyze emotional state
            const insights = this.emotionalEngine.analyzeEmotionalState(validated.emotionalData);
            
            // Check for emergency intervention
            if (insights.urgency === 'critical') {
                await this.handleEmergencyIntervention(validated.userId, insights);
            }
            
            // Update user profile
            const profile = this.emotionalEngine.updatePersonalityProfile(
                validated.userId, 
                validated.emotionalData,
                0.5 // Default effectiveness
            );
            
            // Store assessment
            this.storeEmotionalAssessment(validated.userId, validated, insights);
            
            this.logger.info(`Emotional assessment completed for user ${validated.userId}: ${insights.riskLevel} risk`);

        } catch (error) {
            this.logger.error('Emotional state assessment handling error:', error);
        }
    }

    /**
     * Handle coaching request
     */
    async handleCoachingRequest(data) {
        try {
            const validated = CoachingRequestSchema.parse(data);
            const sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            
            // Create session
            this.state.activeSessions.set(sessionId, {
                ...validated,
                sessionId,
                startTime: new Date().toISOString(),
                status: 'active'
            });
            
            // Get user profile
            const profile = this.state.userProfiles.get(validated.userId);
            
            // Generate insights (simulate emotional analysis)
            const insights = this.generateInsights(validated);
            
            // Generate coaching response
            const coaching = this.emotionalEngine.generateCoachingResponse(
                validated.userId,
                insights,
                validated.context,
                profile
            );
            
            // Create response
            const response = {
                event: 'coaching.response',
                timestamp: new Date().toISOString(),
                userId: validated.userId,
                sessionId,
                coaching,
                personalization: coaching.personalization,
                followUp: coaching.followUp,
                analytics: this.generateAnalytics(validated.userId, insights)
            };
            
            // Publish response
            eventBus.publishEvent('coaching.response', response, 'emotionalAICoach');
            
            // Store session
            this.storeCoachingSession(validated.userId, sessionId, response);
            
            this.logger.info(`Coaching response generated for user ${validated.userId}, session ${sessionId}`);

        } catch (error) {
            this.logger.error('Coaching request handling error:', error);
        }
    }

    generateInsights(requestData) {
        // Simulate emotional analysis based on request
        const urgencyMapping = {
            critical: 'critical',
            high: 'high',
            medium: 'medium',
            low: 'low'
        };
        
        const concernMapping = {
            immediate_support: 'emotional_regulation',
            session_review: 'performance_analysis',
            strategy_guidance: 'uncertainty_tolerance',
            emotional_regulation: 'impulse_control',
            performance_analysis: 'loss_management'
        };
        
        return {
            primaryConcern: concernMapping[requestData.requestType] || 'emotional_regulation',
            riskLevel: urgencyMapping[requestData.context.urgencyLevel] || 'medium',
            recommendedInterventions: ['mindfulness', 'breathing'],
            patterns: ['stress_response'],
            urgency: requestData.context.urgencyLevel
        };
    }

    generateAnalytics(userId, insights) {
        const history = this.state.coachingHistory.get(userId) || [];
        
        return {
            emotionalTrend: this.calculateEmotionalTrend(history),
            progressScore: this.calculateProgressScore(history),
            areasOfGrowth: ['emotional_regulation', 'risk_management'],
            strengthsToLeverage: ['analytical_thinking', 'persistence']
        };
    }

    calculateEmotionalTrend(history) {
        if (history.length < 3) return 'stable';
        
        const recent = history.slice(-3);
        const riskLevels = recent.map(h => h.riskLevel);
        
        if (riskLevels.every(r => ['low', 'medium'].includes(r))) return 'improving';
        if (riskLevels.some(r => r === 'critical')) return 'declining';
        
        return 'stable';
    }

    calculateProgressScore(history) {
        if (history.length === 0) return 0.5;
        
        const recentSessions = history.slice(-5);
        const improvementScore = recentSessions.reduce((score, session) => {
            return score + (session.effectiveness || 0.5);
        }, 0) / recentSessions.length;
        
        return Math.min(1, improvementScore);
    }

    /**
     * Handle emergency intervention
     */
    async handleEmergencyIntervention(userId, insights) {
        this.state.emergencyFlags.set(userId, {
            timestamp: new Date().toISOString(),
            severity: insights.riskLevel,
            reason: insights.primaryConcern,
            status: 'active'
        });
        
        // Send immediate emergency coaching
        const emergencyCoaching = {
            event: 'coaching.emergency',
            timestamp: new Date().toISOString(),
            userId,
            message: 'ACİL DURUM: Şu anda duygusal olarak zor bir durumdasın. Derhal trading\'i durdur ve nefes almaya odaklan.',
            immediateActions: [
                'Tüm pozisyonları kapat',
                '4-7-8 nefes tekniğini uygula',
                'Bilgisayardan uzaklaş',
                'Destekleyici birini ara'
            ],
            followUpIn: 300000 // 5 minutes
        };
        
        eventBus.publishEvent('coaching.emergency', emergencyCoaching, 'emotionalAICoach');
        
        this.logger.warn(`Emergency intervention triggered for user ${userId}: ${insights.primaryConcern}`);
    }

    /**
     * Handle trading session start
     */
    handleTradingSessionStart(data) {
        if (data.userId) {
            const sessionStart = {
                event: 'coaching.session.start',
                timestamp: new Date().toISOString(),
                userId: data.userId,
                message: 'Trading seansın başlıyor. Duygusal durumunu takip edeceğim.',
                reminders: [
                    'Risk yönetim kurallarını hatırla',
                    'Duygusal değişimleri fark et',
                    'Gerektiğinde mola ver'
                ]
            };
            
            eventBus.publishEvent('coaching.session.start', sessionStart, 'emotionalAICoach');
        }
    }

    /**
     * Handle trading session end
     */
    handleTradingSessionEnd(data) {
        if (data.userId) {
            const sessionEnd = {
                event: 'coaching.session.end',
                timestamp: new Date().toISOString(),
                userId: data.userId,
                message: 'Trading seansın sona erdi. Performansını değerlendirelim.',
                reflection: [
                    'Hangi duygular hissettin?',
                    'Hangi kararlardan memnunsun?',
                    'Neyi farklı yapabilirdin?'
                ],
                nextSteps: 'Seansı analiz et ve öğrendiklerini not al'
            };
            
            eventBus.publishEvent('coaching.session.end', sessionEnd, 'emotionalAICoach');
        }
    }

    storeEmotionalAssessment(userId, assessment, insights) {
        if (!this.state.coachingHistory.has(userId)) {
            this.state.coachingHistory.set(userId, []);
        }
        
        const history = this.state.coachingHistory.get(userId);
        history.push({
            timestamp: assessment.timestamp,
            type: 'assessment',
            emotion: assessment.emotionalData.currentEmotion,
            intensity: assessment.emotionalData.intensity,
            riskLevel: insights.riskLevel,
            primaryConcern: insights.primaryConcern
        });
        
        // Limit history size
        if (history.length > 100) {
            history.shift();
        }
        
        this.state.coachingHistory.set(userId, history);
    }

    storeCoachingSession(userId, sessionId, response) {
        if (!this.state.coachingHistory.has(userId)) {
            this.state.coachingHistory.set(userId, []);
        }
        
        const history = this.state.coachingHistory.get(userId);
        history.push({
            timestamp: response.timestamp,
            type: 'coaching',
            sessionId,
            effectiveness: Math.random() * 0.5 + 0.5, // Simulated effectiveness
            followUpScheduled: response.followUp.checkInTime
        });
        
        this.state.coachingHistory.set(userId, history);
    }

    startSessionMonitoring() {
        setInterval(() => {
            this.cleanupExpiredSessions();
        }, 300000); // Every 5 minutes
    }

    cleanupExpiredSessions() {
        const now = Date.now();
        const expired = [];
        
        for (const [sessionId, session] of this.state.activeSessions.entries()) {
            const sessionAge = now - new Date(session.startTime).getTime();
            if (sessionAge > this.sessionTimeout) {
                expired.push(sessionId);
            }
        }
        
        expired.forEach(sessionId => {
            this.state.activeSessions.delete(sessionId);
        });
        
        if (expired.length > 0) {
            this.logger.info(`Cleaned up ${expired.length} expired coaching sessions`);
        }
    }

    startFollowUpScheduler() {
        setInterval(() => {
            this.processFollowUps();
        }, 600000); // Every 10 minutes
    }

    processFollowUps() {
        const now = Date.now();
        
        for (const [userId, followUp] of this.state.followUpQueue.entries()) {
            const followUpTime = new Date(followUp.scheduledTime).getTime();
            
            if (now >= followUpTime) {
                this.sendFollowUp(userId, followUp);
                this.state.followUpQueue.delete(userId);
            }
        }
    }

    sendFollowUp(userId, followUpData) {
        const followUpMessage = {
            event: 'coaching.followup',
            timestamp: new Date().toISOString(),
            userId,
            message: 'Merhaba! Duygusal durumun nasıl? Son coaching seansından sonra neler yaşadın?',
            checkInQuestions: [
                'Önerilen teknikleri uyguladın mı?',
                'Duygusal durumun nasıl?',
                'Trading performansında değişiklik var mı?'
            ],
            scheduledTime: followUpData.scheduledTime
        };
        
        eventBus.publishEvent('coaching.followup', followUpMessage, 'emotionalAICoach');
        this.logger.info(`Follow-up sent to user ${userId}`);
    }

    /**
     * Main processing function
     */
    async process(data) {
        if (!this.isInitialized) {
            throw new Error(`${this.name} henüz başlatılmadı`);
        }

        try {
            if (data.event === 'emotional.state.assessment') {
                await this.handleEmotionalStateAssessment(data);
            } else if (data.event === 'coaching.request') {
                await this.handleCoachingRequest(data);
            } else if (data.event === 'trading.session.start') {
                this.handleTradingSessionStart(data);
            } else if (data.event === 'trading.session.end') {
                this.handleTradingSessionEnd(data);
            }

            return {
                success: true,
                data: {
                    processed: true,
                    activeSessions: this.state.activeSessions.size,
                    activeUsers: this.state.userProfiles.size,
                    emergencyFlags: this.state.emergencyFlags.size
                },
                timestamp: new Date().toISOString(),
                source: this.name
            };
        } catch (error) {
            this.logger.error(`${this.name} işlem hatası:`, error);
            return {
                success: false,
                error: error.message,
                timestamp: new Date().toISOString(),
                source: this.name
            };
        }
    }

    /**
     * Get module status
     */
    getStatus() {
        return {
            name: this.name,
            initialized: this.isInitialized,
            enabled: this.config.enabled,
            activeSessions: this.state.activeSessions.size,
            userProfiles: this.state.userProfiles.size,
            emergencyFlags: this.state.emergencyFlags.size,
            followUpQueue: this.state.followUpQueue.size,
            emotionalEngine: {
                initialized: this.emotionalEngine.isInitialized,
                techniques: Object.keys(this.emotionalEngine.techniques).length,
                strategies: this.emotionalEngine.coachingStrategies.size
            }
        };
    }

    /**
     * Shutdown
     */
    async shutdown() {
        try {
            this.logger.info(`${this.name} durduruluyor...`);
            
            // Clear all state
            this.state.activeSessions.clear();
            this.state.userProfiles.clear();
            this.state.coachingHistory.clear();
            this.state.emergencyFlags.clear();
            this.state.performanceMetrics.clear();
            this.state.followUpQueue.clear();
            
            this.isInitialized = false;
            this.logger.info(`${this.name} başarıyla durduruldu`);
        } catch (error) {
            this.logger.error(`${this.name} durdurma hatası:`, error);
        }
    }
}

module.exports = {
    EmotionalAICoach,
    emotionalAICoach: new EmotionalAICoach(),
    EmotionalIntelligenceEngine
};