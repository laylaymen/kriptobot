const GrafikBeyniModuleBase = require('./grafikBeyniModuleBase');

/**
 * Psychological Check Gate Module
 * Psikolojik durum kapısı - Trading öncesi psikolojik hazırlık kontrolü
 * 10 soruluk Evet/Hayır sistemi ile kullanıcı mental durumu testi
 */
class PsychCheckGate extends GrafikBeyniModuleBase {
    constructor() {
        super('psychCheckGate');
        this.questions = [
            {
                id: 1,
                question: "Son 10 dakikada SL aldın mı?",
                type: "risk",
                riskWeight: 3,
                correctAnswer: "Hayır"
            },
            {
                id: 2,
                question: "Kendini şu an sakin ve net düşünen biri olarak görüyor musun?",
                type: "mental_state",
                riskWeight: 2,
                correctAnswer: "Evet"
            },
            {
                id: 3,
                question: "Bu işleme girmekte teknik bir gerekçen var mı?",
                type: "technical_basis",
                riskWeight: 3,
                correctAnswer: "Evet"
            },
            {
                id: 4,
                question: "Bu pozisyon seni heyecanlandırıyor mu (fazla)?",
                type: "emotional_control",
                riskWeight: 2,
                correctAnswer: "Hayır"
            },
            {
                id: 5,
                question: "Kâr alma konusunda hâlâ net misin?",
                type: "exit_plan",
                riskWeight: 2,
                correctAnswer: "Evet"
            },
            {
                id: 6,
                question: "Bu işlem seni zarardan kurtarmak için mi yapılıyor?",
                type: "revenge_trading",
                riskWeight: 3,
                correctAnswer: "Hayır"
            },
            {
                id: 7,
                question: "Son işleminden sonra kendine kızdın mı?",
                type: "emotional_state",
                riskWeight: 2,
                correctAnswer: "Hayır"
            },
            {
                id: 8,
                question: "Bu pozisyonun büyüklüğü seni korkutuyor mu?",
                type: "position_sizing",
                riskWeight: 3,
                correctAnswer: "Hayır"
            },
            {
                id: 9,
                question: "Şu an 'bu sefer kesin olacak' diye düşündün mü?",
                type: "overconfidence",
                riskWeight: 3,
                correctAnswer: "Hayır"
            },
            {
                id: 10,
                question: "Dünkü planına sadık mısın?",
                type: "plan_adherence",
                riskWeight: 2,
                correctAnswer: "Evet"
            }
        ];
        
        this.riskThreshold = 3; // 3 veya daha fazla kırmızı cevap = risk
        this.delayTime = 3 * 60 * 1000; // 3 dakika gecikme (milisaniye)
        this.testHistory = [];
        this.maxHistorySize = 100;
        
        this.riskCategories = {
            low: { min: 0, max: 2, action: 'proceed', color: 'green' },
            medium: { min: 3, max: 5, action: 'delay', color: 'yellow' },
            high: { min: 6, max: 10, action: 'block', color: 'red' }
        };
        
        this.systemActions = {
            proceed: {
                delay: 0,
                liviaAction: null,
                vivoAction: null,
                logLevel: 'info'
            },
            delay: {
                delay: this.delayTime,
                liviaAction: 'emotional_pressure',
                vivoAction: 'signal_suppression_suggestion',
                logLevel: 'warning'
            },
            block: {
                delay: this.delayTime * 2,
                liviaAction: 'strong_emotional_pressure',
                vivoAction: 'signal_block',
                logLevel: 'critical'
            }
        };
    }

    async analyze(data) {
        try {
            const {
                symbol,
                userAnswers,
                currentSession,
                recentTrades,
                plannedTrade,
                timeframe,
                marketConditions,
                userProfile,
                sessionData,
                emotionalState,
                riskTolerance,
                tradingHistory
            } = data;

            // Input validation
            if (!userAnswers || !Array.isArray(userAnswers) || userAnswers.length !== 10) {
                throw new Error('Invalid user answers - exactly 10 answers required');
            }

            // Evaluate answers
            const answerEvaluation = this.evaluateAnswers(userAnswers);
            
            // Calculate psychological risk score
            const psychologicalRiskScore = this.calculatePsychologicalRisk(answerEvaluation, data);
            
            // Determine risk category
            const riskCategory = this.determineRiskCategory(psychologicalRiskScore.totalRiskPoints);
            
            // Generate system actions
            const systemActions = this.generateSystemActions(riskCategory, psychologicalRiskScore);
            
            // Analyze psychological patterns
            const psychologicalPatterns = this.analyzePsychologicalPatterns(answerEvaluation, data);
            
            // Generate personalized recommendations
            const personalizedRecommendations = this.generatePersonalizedRecommendations(
                answerEvaluation, psychologicalRiskScore, riskCategory, data
            );
            
            // Create session assessment
            const sessionAssessment = this.createSessionAssessment(
                answerEvaluation, psychologicalRiskScore, riskCategory, data
            );
            
            // Mental state analysis
            const mentalStateAnalysis = this.analyzeMentalState(answerEvaluation, data);
            
            // Trading readiness evaluation
            const tradingReadinessEvaluation = this.evaluateTradingReadiness(
                psychologicalRiskScore, mentalStateAnalysis, data
            );

            const result = {
                answerEvaluation: answerEvaluation,
                psychologicalRiskScore: psychologicalRiskScore,
                riskCategory: riskCategory,
                systemActions: systemActions,
                psychologicalPatterns: psychologicalPatterns,
                personalizedRecommendations: personalizedRecommendations,
                sessionAssessment: sessionAssessment,
                mentalStateAnalysis: mentalStateAnalysis,
                tradingReadinessEvaluation: tradingReadinessEvaluation,
                gateDecision: this.makeGateDecision(riskCategory, tradingReadinessEvaluation),
                recommendations: this.generateModularRecommendations(riskCategory, systemActions, data),
                alerts: this.generateAlerts(riskCategory, psychologicalRiskScore, systemActions),
                notes: this.generateNotes(answerEvaluation, riskCategory, systemActions),
                metadata: {
                    analysisTimestamp: Date.now(),
                    symbol: symbol,
                    totalQuestions: this.questions.length,
                    riskPoints: psychologicalRiskScore.totalRiskPoints,
                    riskLevel: riskCategory.action,
                    delayRecommended: systemActions.delay > 0,
                    testDuration: this.calculateTestDuration(data),
                    sessionId: currentSession?.id || 'unknown'
                }
            };

            // Update test history
            this.updateTestHistory(result, data);

            // Cache ve performance tracking
            this.updateCache(data, result);
            this.trackPerformance(Date.now(), true);

            return result;

        } catch (error) {
            this.handleError('PsychCheckGate analysis failed', error, data);
            return this.getDefaultResult();
        }
    }

    evaluateAnswers(userAnswers) {
        const evaluation = {
            answers: [],
            riskAnswers: [],
            correctAnswers: 0,
            riskPoints: 0,
            categoryBreakdown: {}
        };

        this.questions.forEach((question, index) => {
            const userAnswer = userAnswers[index];
            const isCorrect = userAnswer === question.correctAnswer;
            const isRisk = !isCorrect;
            
            const answerEval = {
                questionId: question.id,
                question: question.question,
                userAnswer: userAnswer,
                correctAnswer: question.correctAnswer,
                isCorrect: isCorrect,
                isRisk: isRisk,
                riskWeight: question.riskWeight,
                type: question.type,
                riskContribution: isRisk ? question.riskWeight : 0
            };

            evaluation.answers.push(answerEval);
            
            if (isRisk) {
                evaluation.riskAnswers.push(answerEval);
                evaluation.riskPoints += question.riskWeight;
            } else {
                evaluation.correctAnswers++;
            }

            // Category breakdown
            if (!evaluation.categoryBreakdown[question.type]) {
                evaluation.categoryBreakdown[question.type] = {
                    total: 0,
                    correct: 0,
                    risk: 0,
                    riskPoints: 0
                };
            }
            
            evaluation.categoryBreakdown[question.type].total++;
            if (isCorrect) {
                evaluation.categoryBreakdown[question.type].correct++;
            } else {
                evaluation.categoryBreakdown[question.type].risk++;
                evaluation.categoryBreakdown[question.type].riskPoints += question.riskWeight;
            }
        });

        return evaluation;
    }

    calculatePsychologicalRisk(answerEvaluation, data) {
        const baseRiskPoints = answerEvaluation.riskPoints;
        const riskAnswerCount = answerEvaluation.riskAnswers.length;
        
        // Context-based risk adjustments
        let contextAdjustment = 0;
        
        // Recent trading performance adjustment
        if (data.recentTrades && data.recentTrades.length > 0) {
            const recentLosses = data.recentTrades.filter(trade => trade.result === 'loss').length;
            const recentLossRate = recentLosses / data.recentTrades.length;
            
            if (recentLossRate > 0.6) {
                contextAdjustment += 2; // High recent loss rate
            }
        }
        
        // Market volatility adjustment
        if (data.marketConditions && data.marketConditions.volatility === 'high') {
            contextAdjustment += 1;
        }
        
        // Session fatigue adjustment
        if (data.sessionData && data.sessionData.tradingDuration > 240) { // 4+ hours
            contextAdjustment += 1;
        }

        const adjustedRiskPoints = baseRiskPoints + contextAdjustment;
        const riskPercentage = (adjustedRiskPoints / (this.questions.length * 3)) * 100; // Max possible: 30 points
        
        return {
            baseRiskPoints: baseRiskPoints,
            contextAdjustment: contextAdjustment,
            totalRiskPoints: adjustedRiskPoints,
            riskAnswerCount: riskAnswerCount,
            riskPercentage: riskPercentage,
            riskFactors: this.identifyRiskFactors(answerEvaluation, data),
            strengthFactors: this.identifyStrengthFactors(answerEvaluation, data)
        };
    }

    determineRiskCategory(totalRiskPoints) {
        for (const [category, config] of Object.entries(this.riskCategories)) {
            if (totalRiskPoints >= config.min && totalRiskPoints <= config.max) {
                return {
                    level: category,
                    action: config.action,
                    color: config.color,
                    config: config,
                    description: this.getRiskCategoryDescription(category)
                };
            }
        }
        
        // Fallback to high risk
        return {
            level: 'high',
            action: 'block',
            color: 'red',
            config: this.riskCategories.high,
            description: this.getRiskCategoryDescription('high')
        };
    }

    generateSystemActions(riskCategory, psychologicalRiskScore) {
        const baseActions = this.systemActions[riskCategory.action];
        
        return {
            gateAction: riskCategory.action,
            delayTime: baseActions.delay,
            liviaIntegration: {
                action: baseActions.liviaAction,
                intensity: this.calculateEmotionalIntensity(psychologicalRiskScore),
                message: this.generateLiviaMessage(riskCategory, psychologicalRiskScore)
            },
            vivoIntegration: {
                action: baseActions.vivoAction,
                suppressionLevel: this.calculateSuppressionLevel(psychologicalRiskScore),
                recommendation: this.generateVivoRecommendation(riskCategory, psychologicalRiskScore)
            },
            denetimAsistaniLog: {
                logLevel: baseActions.logLevel,
                tag: 'decisionBiasDetected',
                details: {
                    riskPoints: psychologicalRiskScore.totalRiskPoints,
                    riskCategory: riskCategory.level,
                    timestamp: Date.now()
                }
            },
            immediateActions: this.generateImmediateActions(riskCategory, psychologicalRiskScore)
        };
    }

    makeGateDecision(riskCategory, tradingReadinessEvaluation) {
        const decision = {
            allowed: riskCategory.action === 'proceed',
            delayRequired: riskCategory.action === 'delay',
            blocked: riskCategory.action === 'block',
            confidence: this.calculateDecisionConfidence(riskCategory, tradingReadinessEvaluation),
            reasoning: this.generateDecisionReasoning(riskCategory, tradingReadinessEvaluation),
            alternatives: this.generateAlternatives(riskCategory, tradingReadinessEvaluation)
        };

        return decision;
    }

    generateModularRecommendations(riskCategory, systemActions, data) {
        return {
            LIVIA: {
                emotionalState: riskCategory.level,
                actionRequired: systemActions.liviaIntegration.action,
                intensity: systemActions.liviaIntegration.intensity,
                suppressEmotionalTrades: riskCategory.action !== 'proceed'
            },
            VIVO: {
                signalSuppression: systemActions.vivoIntegration.action,
                suppressionLevel: systemActions.vivoIntegration.suppressionLevel,
                delayRecommendation: systemActions.delayTime,
                allowTrading: riskCategory.action === 'proceed'
            },
            denetimAsistani: {
                logEntry: systemActions.denetimAsistaniLog,
                monitorUser: riskCategory.action !== 'proceed',
                alertLevel: riskCategory.level
            },
            otobilinc: {
                psychologicalProfile: riskCategory.level,
                biasPrevention: riskCategory.action !== 'proceed',
                recommendedBreak: systemActions.delayTime > 0
            }
        };
    }

    generateAlerts(riskCategory, psychologicalRiskScore, systemActions) {
        const alerts = [];

        if (riskCategory.action === 'delay') {
            alerts.push({
                level: 'warning',
                message: `Psikolojik risk tespit edildi - ${systemActions.delayTime / 60000} dakika bekleme öneriliyor`,
                action: 'Psikolojik durumu iyileştir ve tekrar dene',
                riskPoints: psychologicalRiskScore.totalRiskPoints
            });
        }

        if (riskCategory.action === 'block') {
            alerts.push({
                level: 'critical',
                message: 'Yüksek psikolojik risk - Trading önerilmiyor',
                action: 'Dinlen, analiz yap ve daha sonra tekrar dene',
                riskPoints: psychologicalRiskScore.totalRiskPoints
            });
        }

        if (psychologicalRiskScore.riskFactors.length > 3) {
            alerts.push({
                level: 'info',
                message: `${psychologicalRiskScore.riskFactors.length} risk faktörü tespit edildi`,
                action: 'Risk faktörlerini gözden geçir'
            });
        }

        return alerts;
    }

    generateNotes(answerEvaluation, riskCategory, systemActions) {
        const notes = [];

        notes.push(`${answerEvaluation.correctAnswers}/10 doğru cevap`);
        notes.push(`${answerEvaluation.riskAnswers.length} risk cevabı`);
        notes.push(`Risk seviyesi: ${riskCategory.level}`);
        notes.push(`Önerilen aksiyon: ${riskCategory.action}`);

        if (systemActions.delayTime > 0) {
            notes.push(`${systemActions.delayTime / 60000} dakika bekleme öneriliyor`);
        }

        const strongestRiskCategory = this.findStrongestRiskCategory(answerEvaluation);
        if (strongestRiskCategory) {
            notes.push(`En yüksek risk alanı: ${strongestRiskCategory}`);
        }

        return notes.join('. ');
    }

    // Helper methods
    identifyRiskFactors(answerEvaluation, data) {
        const riskFactors = [];
        
        answerEvaluation.riskAnswers.forEach(answer => {
            riskFactors.push({
                factor: answer.type,
                question: answer.question,
                severity: answer.riskWeight,
                description: this.getRiskFactorDescription(answer.type)
            });
        });

        return riskFactors;
    }

    updateTestHistory(result, data) {
        this.testHistory.push({
            timestamp: Date.now(),
            symbol: data.symbol,
            riskPoints: result.psychologicalRiskScore.totalRiskPoints,
            riskCategory: result.riskCategory.level,
            gateDecision: result.gateDecision.allowed,
            userAnswers: result.answerEvaluation.answers.map(a => ({
                questionId: a.questionId,
                userAnswer: a.userAnswer,
                isRisk: a.isRisk
            }))
        });

        if (this.testHistory.length > this.maxHistorySize) {
            this.testHistory = this.testHistory.slice(-this.maxHistorySize);
        }
    }

    getDefaultResult() {
        return {
            answerEvaluation: {
                answers: [],
                riskAnswers: [],
                correctAnswers: 0,
                riskPoints: 0,
                categoryBreakdown: {}
            },
            psychologicalRiskScore: {
                baseRiskPoints: 0,
                contextAdjustment: 0,
                totalRiskPoints: 0,
                riskAnswerCount: 0,
                riskPercentage: 0,
                riskFactors: [],
                strengthFactors: []
            },
            riskCategory: {
                level: 'unknown',
                action: 'block',
                color: 'red',
                description: 'Test başarısız'
            },
            systemActions: {
                gateAction: 'block',
                delayTime: this.delayTime,
                liviaIntegration: { action: null, intensity: 0, message: '' },
                vivoIntegration: { action: null, suppressionLevel: 0, recommendation: '' },
                denetimAsistaniLog: { logLevel: 'error', tag: 'testFailed', details: {} },
                immediateActions: []
            },
            gateDecision: {
                allowed: false,
                delayRequired: true,
                blocked: true,
                confidence: 0,
                reasoning: 'Psikolojik test başarısız',
                alternatives: []
            },
            recommendations: {},
            alerts: [{
                level: 'error',
                message: 'Psikolojik test tamamlanamadı',
                action: 'Test tekrar denenmelidir'
            }],
            notes: "Psikolojik durum testi tamamlanamadı - teknik hata",
            metadata: {
                error: true,
                analysisTimestamp: Date.now(),
                totalQuestions: this.questions.length,
                riskPoints: 0,
                riskLevel: 'unknown',
                delayRecommended: true,
                testDuration: 0,
                sessionId: 'error'
            }
        };
    }

    getModuleInfo() {
        return {
            name: 'PsychCheckGate',
            version: '1.0.0',
            description: 'Psikolojik durum kapısı - Trading öncesi psikolojik hazırlık kontrolü - 10 soruluk Evet/Hayır sistemi ile kullanıcı mental durumu testi',
            inputs: [
                'symbol', 'userAnswers', 'currentSession', 'recentTrades', 'plannedTrade',
                'timeframe', 'marketConditions', 'userProfile', 'sessionData', 'emotionalState',
                'riskTolerance', 'tradingHistory'
            ],
            outputs: [
                'answerEvaluation', 'psychologicalRiskScore', 'riskCategory', 'systemActions',
                'psychologicalPatterns', 'personalizedRecommendations', 'sessionAssessment',
                'mentalStateAnalysis', 'tradingReadinessEvaluation', 'gateDecision',
                'recommendations', 'alerts', 'notes', 'metadata'
            ]
        };
    }
}

module.exports = PsychCheckGate;
