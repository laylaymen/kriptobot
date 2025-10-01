/**
 * LIVIA-34: News Reaction Router
 * Haber verisi + duygu analizi çıktısını alır, sistemlere sinyal yönlendirir.
 * Her sistemin kendi durumuna göre otomatik karar alması için sinyal yönlendirir.
 */

/**
 * Enhanced News Reaction Router Module
 * Haber ve duygu analizi verilerini sistemlere yönlendirir
 * Ek modüller.txt prompt'una göre implementasyon
 */
class NewsReactionRouter {
    constructor() {
        this.moduleName = 'newsReactionRouter';
        
        // System mapping - hangi haber kategorisi hangi sistemleri etkiler
        this.systemMappings = {
            // ETF/Onay haberleri
            approval: {
                positive: {
                    'Grafik Beyni': ['reflexivePatternTracker', 'volatilityClampFilter'],
                    'VIVO': ['variantEvaluator', 'signalConfirmationBoost'],
                    'Denetim Asistanı': ['macroDisruptionLog'],
                    'Otobilinç': ['normalMonitoring']
                },
                negative: {
                    'LIVIA': ['emotionalDefenseLauncher'],
                    'Grafik Beyni': ['falseBreakFilter'],
                    'Denetim Asistanı': ['macroDisruptionLog']
                }
            },
            
            // Hack/güvenlik haberleri
            hack: {
                positive: {
                    'Denetim Asistanı': ['strategyIntegrityEvaluator']
                },
                negative: {
                    'LIVIA': ['emergencyHoldActivator', 'contextSuppressionTrigger'],
                    'Grafik Beyni': ['falseBreakFilter', 'collapseRiskDetector'],
                    'VIVO': ['signalSuppressionMode'],
                    'Otobilinç': ['riskAwareness'],
                    'Denetim Asistanı': ['macroDisruptionLog', 'emergencyLog']
                }
            },
            
            // Regulation/yasal haberleri
            regulation: {
                positive: {
                    'Grafik Beyni': ['adaptiveScenarioBuilder'],
                    'VIVO': ['signalConfirmationBoost'],
                    'Denetim Asistanı': ['strategyIntegrityEvaluator']
                },
                negative: {
                    'LIVIA': ['contextSuppressionTrigger', 'emotionalDefenseLauncher'],
                    'Grafik Beyni': ['falseBreakFilter', 'cautionsAnalysis'],
                    'VIVO': ['aggressiveStrategySuppression'],
                    'Denetim Asistanı': ['macroDisruptionLog']
                }
            },
            
            // Makro/ekonomik haberler
            macro: {
                positive: {
                    'Grafik Beyni': ['adaptiveScenarioBuilder', 'trendFilter'],
                    'Otobilinç': ['confidenceBoost'],
                    'Denetim Asistanı': ['macroDisruptionLog']
                },
                negative: {
                    'Grafik Beyni': ['adaptiveScenarioBuilder', 'riskScaler'],
                    'LIVIA': ['contextSuppressionTrigger'],
                    'Otobilinç': ['cautiousMode'],
                    'Denetim Asistanı': ['macroDisruptionLog']
                }
            },
            
            // Price/volatility haberleri
            price_jump: {
                positive: {
                    'Grafik Beyni': ['reflexivePatternTracker', 'volatilityClampFilter'],
                    'VIVO': ['signalConfirmationBoost'],
                    'Otobilinç': ['volatilityPreparation']
                },
                negative: {
                    'LIVIA': ['emotionalDefenseLauncher'],
                    'Grafik Beyni': ['falseBreakFilter', 'volatilityClampFilter'],
                    'VIVO': ['cautionsSignalMode']
                }
            }
        };
        
        // Action types
        this.actionTypes = {
            activate: 'Modülü aktif et',
            suppress: 'Modülü bastır',
            boost: 'Modülü güçlendir',
            halt: 'Modülü durdur',
            log: 'Olayı kaydet',
            monitor: 'İzleme modu',
            alert: 'Uyarı ver',
            prepare: 'Hazırlık modu'
        };
        
        // Routing history
        this.routingHistory = [];
        this.maxHistorySize = 50;
        
        // Performance metrics
        this.performanceMetrics = {
            totalRoutings: 0,
            positiveRoutings: 0,
            negativeRoutings: 0,
            systemActivations: {},
            avgRoutingTime: 0,
            emergencyHalts: 0
        };
        
        this.lastRouting = null;
    }

    /**
     * Ana routing fonksiyonu - ek modüller.txt format'ında
     */
    route(newsData, sentimentData) {
        const startTime = Date.now();
        
        try {
            // Input validation
            if (!newsData || !sentimentData) {
                throw new Error('Invalid input data for routing');
            }
            
            // Ana routing analizi
            const routingDecision = this.analyzeRoutingRequirements(newsData, sentimentData);
            
            // Sistem routing'leri oluştur
            const systemRoutes = this.generateSystemRoutes(routingDecision);
            
            // Emergency check
            const emergencyRoutes = this.checkEmergencyConditions(newsData, sentimentData);
            
            // Final routing package
            const routingPackage = {
                timestamp: Date.now(),
                newsTitle: newsData.title || 'Unknown',
                impactCategory: newsData.impactCategory || 'unknown',
                sentimentTag: sentimentData.sentimentTag || 'neutral',
                sentimentScore: sentimentData.sentimentScore || 0,
                routingDecision: routingDecision,
                route: [...systemRoutes, ...emergencyRoutes],
                metadata: {
                    routingTime: Date.now() - startTime,
                    affectedSystems: this.getAffectedSystems(systemRoutes),
                    totalActions: systemRoutes.length + emergencyRoutes.length,
                    riskLevel: this.calculateRiskLevel(newsData, sentimentData),
                    confidence: this.calculateRoutingConfidence(routingDecision)
                }
            };
            
            // History ve metrics güncelleme
            this.updateRoutingHistory(routingPackage);
            this.updatePerformanceMetrics(routingPackage, startTime);
            this.lastRouting = routingPackage;
            
            // Denetim Asistanı'na log gönder
            this.logToAssistant(routingPackage);
            
            return routingPackage;
            
        } catch (error) {
            console.error('News routing error:', error.message);
            return this.getDefaultRouting(newsData, sentimentData, error.message);
        }
    }

    /**
     * Routing gereksinimlerini analiz et
     */
    analyzeRoutingRequirements(newsData, sentimentData) {
        const impactCategory = newsData.impactCategory || 'unknown';
        const sentimentTag = sentimentData.sentimentTag || 'neutral';
        const sentimentScore = sentimentData.sentimentScore || 0;
        
        // Routing mantığı
        const routingLogic = {
            category: impactCategory,
            sentiment: sentimentTag,
            intensity: this.calculateIntensity(sentimentScore),
            urgency: this.calculateUrgency(newsData, sentimentData),
            systemPriority: this.calculateSystemPriority(impactCategory, sentimentTag)
        };
        
        return routingLogic;
    }

    /**
     * Sistem routing'lerini oluştur
     */
    generateSystemRoutes(routingDecision) {
        const routes = [];
        const category = routingDecision.category;
        const sentiment = routingDecision.sentiment;
        
        // İlgili sistemleri ve modülleri bul
        const systemMapping = this.systemMappings[category];
        if (!systemMapping) {
            // Bilinmeyen kategori için default routing
            return this.getDefaultSystemRoutes(routingDecision);
        }
        
        const sentimentMapping = systemMapping[sentiment];
        if (!sentimentMapping) {
            return [];
        }
        
        // Her sistem için routing oluştur
        Object.entries(sentimentMapping).forEach(([system, modules]) => {
            modules.forEach(module => {
                const action = this.determineAction(routingDecision, system, module);
                
                routes.push({
                    system: system,
                    module: module,
                    action: action,
                    priority: this.calculatePriority(system, action, routingDecision.urgency),
                    reason: `${category} - ${sentiment} impact`,
                    parameters: this.getActionParameters(action, routingDecision)
                });
            });
        });
        
        // Priority'ye göre sırala
        return routes.sort((a, b) => b.priority - a.priority);
    }

    /**
     * Emergency durumları kontrol et
     */
    checkEmergencyConditions(newsData, sentimentData) {
        const emergencyRoutes = [];
        
        // Kritik negatif haber kontrolü
        if (sentimentData.sentimentScore < -0.8) {
            emergencyRoutes.push({
                system: 'LIVIA',
                module: 'emergencyHoldActivator',
                action: 'halt',
                priority: 100,
                reason: 'Critical negative sentiment detected',
                emergency: true,
                parameters: {
                    duration: '15min',
                    alertLevel: 'critical'
                }
            });
            
            this.performanceMetrics.emergencyHalts++;
        }
        
        // Hack/security emergency
        const keywords = (newsData.title + ' ' + newsData.description).toLowerCase();
        if (keywords.includes('hack') || keywords.includes('exploit') || keywords.includes('stolen')) {
            emergencyRoutes.push({
                system: 'Grafik Beyni',
                module: 'collapseRiskDetector',
                action: 'activate',
                priority: 95,
                reason: 'Security incident detected',
                emergency: true,
                parameters: {
                    alertLevel: 'high',
                    monitoringMode: 'intensive'
                }
            });
        }
        
        // Volatilite spike emergency
        if (newsData.impactCategory === 'price_jump' && Math.abs(sentimentData.sentimentScore) > 0.7) {
            emergencyRoutes.push({
                system: 'Grafik Beyni',
                module: 'reflexivePatternTracker',
                action: 'prepare',
                priority: 90,
                reason: 'High volatility spike expected',
                emergency: true,
                parameters: {
                    prepareFor: 'volatilitySpike',
                    timeWindow: '30min'
                }
            });
        }
        
        return emergencyRoutes;
    }

    /**
     * Action type belirleme
     */
    determineAction(routingDecision, system, module) {
        const sentiment = routingDecision.sentiment;
        const intensity = routingDecision.intensity;
        
        // LIVIA sisteminde genelde suppress/halt
        if (system === 'LIVIA') {
            return sentiment === 'negative' ? 'activate' : 'monitor';
        }
        
        // Grafik Beyni'nde analiz modları
        if (system === 'Grafik Beyni') {
            if (sentiment === 'negative') {
                return intensity === 'high' ? 'activate' : 'monitor';
            } else {
                return 'boost';
            }
        }
        
        // VIVO sisteminde sinyal kontrol
        if (system === 'VIVO') {
            return sentiment === 'positive' ? 'boost' : 'suppress';
        }
        
        // Denetim Asistanı her zaman log
        if (system === 'Denetim Asistanı') {
            return 'log';
        }
        
        // Default
        return sentiment === 'positive' ? 'activate' : 'monitor';
    }

    /**
     * Intensity hesaplama
     */
    calculateIntensity(sentimentScore) {
        const absScore = Math.abs(sentimentScore);
        
        if (absScore > 0.8) return 'very_high';
        if (absScore > 0.6) return 'high';
        if (absScore > 0.4) return 'moderate';
        if (absScore > 0.2) return 'low';
        return 'minimal';
    }

    /**
     * Urgency hesaplama
     */
    calculateUrgency(newsData, sentimentData) {
        let urgency = 0;
        
        // Sentiment etkisi
        urgency += Math.abs(sentimentData.sentimentScore) * 50;
        
        // Kategori etkisi
        const highUrgencyCategories = ['hack', 'regulation', 'approval'];
        if (highUrgencyCategories.includes(newsData.impactCategory)) {
            urgency += 30;
        }
        
        // Keywords etkisi
        const urgentKeywords = ['emergency', 'immediate', 'breaking', 'critical'];
        const text = (newsData.title + ' ' + newsData.description).toLowerCase();
        urgentKeywords.forEach(keyword => {
            if (text.includes(keyword)) urgency += 20;
        });
        
        return Math.min(100, urgency);
    }

    /**
     * Sistem priority hesaplama
     */
    calculateSystemPriority(category, sentiment) {
        const priorities = {
            'LIVIA': sentiment === 'negative' ? 95 : 40,
            'Grafik Beyni': 80,
            'VIVO': sentiment === 'positive' ? 85 : 60,
            'Otobilinç': 70,
            'Denetim Asistanı': 90
        };
        
        return priorities;
    }

    /**
     * Action priority hesaplama
     */
    calculatePriority(system, action, urgency) {
        const basePriority = this.calculateSystemPriority('unknown', 'neutral')[system] || 50;
        const actionMultiplier = {
            'halt': 1.0,
            'activate': 0.9,
            'boost': 0.8,
            'suppress': 0.7,
            'monitor': 0.5,
            'log': 0.4
        };
        
        const multiplier = actionMultiplier[action] || 0.5;
        const urgencyBonus = urgency * 0.3;
        
        return Math.round(basePriority * multiplier + urgencyBonus);
    }

    /**
     * Action parameters oluşturma
     */
    getActionParameters(action, routingDecision) {
        const baseParams = {
            category: routingDecision.category,
            sentiment: routingDecision.sentiment,
            intensity: routingDecision.intensity,
            urgency: routingDecision.urgency
        };
        
        switch (action) {
            case 'activate':
                return { ...baseParams, mode: 'active', duration: '30min' };
            case 'suppress':
                return { ...baseParams, level: 'moderate', duration: '15min' };
            case 'boost':
                return { ...baseParams, multiplier: 1.5, duration: '20min' };
            case 'halt':
                return { ...baseParams, emergency: true, duration: '10min' };
            case 'monitor':
                return { ...baseParams, level: 'passive', continuous: true };
            case 'log':
                return { ...baseParams, logLevel: 'info', permanent: true };
            default:
                return baseParams;
        }
    }

    /**
     * Risk level hesaplama
     */
    calculateRiskLevel(newsData, sentimentData) {
        const sentimentRisk = Math.abs(sentimentData.sentimentScore) * 50;
        
        const categoryRisk = {
            'hack': 90,
            'regulation': 70,
            'approval': 40,
            'macro': 60,
            'price_jump': 80
        };
        
        const catRisk = categoryRisk[newsData.impactCategory] || 30;
        
        return Math.min(100, (sentimentRisk + catRisk) / 2);
    }

    /**
     * Routing confidence hesaplama
     */
    calculateRoutingConfidence(routingDecision) {
        let confidence = 0.5; // Base confidence
        
        // Kategori biliniyorsa confidence artır
        if (this.systemMappings[routingDecision.category]) {
            confidence += 0.3;
        }
        
        // Yüksek urgency = yüksek confidence
        confidence += (routingDecision.urgency / 100) * 0.2;
        
        return Math.min(1, confidence);
    }

    /**
     * Etkilenen sistemleri bul
     */
    getAffectedSystems(routes) {
        const systems = new Set();
        routes.forEach(route => systems.add(route.system));
        return Array.from(systems);
    }

    /**
     * Default routing (fallback)
     */
    getDefaultSystemRoutes(routingDecision) {
        return [
            {
                system: 'Denetim Asistanı',
                module: 'macroDisruptionLog',
                action: 'log',
                priority: 50,
                reason: 'Unknown category fallback',
                parameters: { logLevel: 'warning', category: 'unknown' }
            }
        ];
    }

    /**
     * Denetim Asistanı'na log gönder
     */
    logToAssistant(routingPackage) {
        const logData = {
            timestamp: routingPackage.timestamp,
            event: 'news_routing',
            newsTitle: routingPackage.newsTitle,
            impactCategory: routingPackage.impactCategory,
            sentimentTag: routingPackage.sentimentTag,
            sentimentScore: routingPackage.sentimentScore,
            totalActions: routingPackage.metadata.totalActions,
            affectedSystems: routingPackage.metadata.affectedSystems,
            riskLevel: routingPackage.metadata.riskLevel,
            emergencyActions: routingPackage.route.filter(r => r.emergency).length
        };
        
        // Log'u konsola yaz (gerçek implementasyonda Denetim Asistanı modülüne gönderilir)
        console.log('News Routing Log:', JSON.stringify(logData, null, 2));
    }

    /**
     * Batch routing (çoklu haber)
     */
    routeBatch(newsDataArray, sentimentDataArray) {
        if (newsDataArray.length !== sentimentDataArray.length) {
            throw new Error('News and sentiment data arrays must have same length');
        }
        
        const batchResults = [];
        let totalRoutings = 0;
        let emergencyRoutings = 0;
        
        for (let i = 0; i < newsDataArray.length; i++) {
            const routing = this.route(newsDataArray[i], sentimentDataArray[i]);
            batchResults.push(routing);
            totalRoutings++;
            
            if (routing.route.some(r => r.emergency)) {
                emergencyRoutings++;
            }
        }
        
        return {
            individual: batchResults,
            aggregate: {
                totalRoutings: totalRoutings,
                emergencyRoutings: emergencyRoutings,
                avgRiskLevel: batchResults.reduce((sum, r) => sum + r.metadata.riskLevel, 0) / totalRoutings,
                mostAffectedSystem: this.getMostAffectedSystem(batchResults),
                overallImpact: this.calculateOverallImpact(batchResults)
            }
        };
    }

    // Helper methods
    getMostAffectedSystem(routings) {
        const systemCounts = {};
        
        routings.forEach(routing => {
            routing.metadata.affectedSystems.forEach(system => {
                systemCounts[system] = (systemCounts[system] || 0) + 1;
            });
        });
        
        return Object.keys(systemCounts).reduce((a, b) => 
            systemCounts[a] > systemCounts[b] ? a : b
        );
    }

    calculateOverallImpact(routings) {
        const avgRisk = routings.reduce((sum, r) => sum + r.metadata.riskLevel, 0) / routings.length;
        
        if (avgRisk > 80) return 'critical';
        if (avgRisk > 60) return 'high';
        if (avgRisk > 40) return 'moderate';
        if (avgRisk > 20) return 'low';
        return 'minimal';
    }

    updateRoutingHistory(routingPackage) {
        this.routingHistory.push({
            timestamp: routingPackage.timestamp,
            category: routingPackage.impactCategory,
            sentiment: routingPackage.sentimentTag,
            totalActions: routingPackage.metadata.totalActions,
            riskLevel: routingPackage.metadata.riskLevel,
            affectedSystems: routingPackage.metadata.affectedSystems.length
        });
        
        if (this.routingHistory.length > this.maxHistorySize) {
            this.routingHistory = this.routingHistory.slice(-this.maxHistorySize);
        }
    }

    updatePerformanceMetrics(routingPackage, startTime) {
        this.performanceMetrics.totalRoutings++;
        this.performanceMetrics.avgRoutingTime = 
            (this.performanceMetrics.avgRoutingTime + (Date.now() - startTime)) / 2;
        
        if (routingPackage.sentimentTag === 'positive') {
            this.performanceMetrics.positiveRoutings++;
        } else if (routingPackage.sentimentTag === 'negative') {
            this.performanceMetrics.negativeRoutings++;
        }
        
        // Sistem aktivasyon sayaçları
        routingPackage.metadata.affectedSystems.forEach(system => {
            this.performanceMetrics.systemActivations[system] = 
                (this.performanceMetrics.systemActivations[system] || 0) + 1;
        });
    }

    getDefaultRouting(newsData, sentimentData, errorMessage) {
        return {
            timestamp: Date.now(),
            newsTitle: newsData?.title || 'Unknown',
            impactCategory: newsData?.impactCategory || 'unknown',
            sentimentTag: sentimentData?.sentimentTag || 'neutral',
            sentimentScore: sentimentData?.sentimentScore || 0,
            route: [
                {
                    system: 'Denetim Asistanı',
                    module: 'macroDisruptionLog',
                    action: 'log',
                    priority: 50,
                    reason: 'Routing error fallback',
                    parameters: { error: errorMessage }
                }
            ],
            error: errorMessage,
            metadata: {
                routingTime: 0,
                affectedSystems: ['Denetim Asistanı'],
                totalActions: 1,
                riskLevel: 0,
                confidence: 0
            }
        };
    }

    // Public API methods
    getLatestNewsRouting() {
        return this.lastRouting;
    }

    getRoutingHistory(limit = 10) {
        return this.routingHistory.slice(-limit);
    }

    getPerformanceMetrics() {
        return {
            ...this.performanceMetrics,
            historySize: this.routingHistory.length,
            uptime: Date.now() - (this.performanceMetrics.startTime || Date.now())
        };
    }

    getModuleInfo() {
        return {
            name: 'NewsReactionRouter',
            version: '2.0.0',
            description: 'GELİŞMİŞ haber reaction routing - Ek modüller.txt prompt\'una göre geliştirildi',
            supportedSystems: Object.keys(this.systemMappings.approval?.positive || {}),
            supportedActions: Object.keys(this.actionTypes),
            performanceMetrics: this.getPerformanceMetrics()
        };
    }
}

// Singleton instance oluşturma
const newsReactionRouter = new NewsReactionRouter();

// Legacy function compatibility
function routeNewsImpact(newsData, sentimentData) {
    return newsReactionRouter.route(newsData, sentimentData);
}

function getLatestNewsRouting() {
    return newsReactionRouter.getLatestNewsRouting();
}

module.exports = {
    NewsReactionRouter,
    newsReactionRouter,
    routeNewsImpact,
    getLatestNewsRouting
};
