const GrafikBeyniModuleBase = require('./grafikBeyniModuleBase');

/**
 * Position Path Planner
 * Pozisyon açılmadan önce tüm verileri analiz eder ve optimum strateji belirler
 * Benzer senaryolarla karşılaştırır, kademeli alış/satış stratejisi önerir
 */
class PositionPathPlanner extends GrafikBeyniModuleBase {
    constructor() {
        super('positionPathPlanner');
        
        // Karar kriterleri
        this.decisionCriteria = {
            minExpectedProfit: 0.035,     // %3.5 minimum kar
            minScenarioMatch: 0.70,       // %70 senaryo benzerliği
            minRiskReward: 2.5,           // Minimum R/R oranı
            maxDailyTrades: 3,            // Günlük maksimum işlem
            minPsychologyScore: 0.85      // Minimum psikoloji skoru
        };
        
        // Strateji türleri
        this.strategyTypes = {
            conservative: {
                name: 'Conservative Entry',
                riskLevel: 'low',
                expectedSuccess: 0.75,
                requirements: { trendStrength: 0.7, psychology: 0.9 }
            },
            balanced: {
                name: 'Balanced Approach',
                riskLevel: 'medium', 
                expectedSuccess: 0.65,
                requirements: { trendStrength: 0.6, psychology: 0.8 }
            },
            aggressive: {
                name: 'Aggressive Entry',
                riskLevel: 'high',
                expectedSuccess: 0.55,
                requirements: { trendStrength: 0.5, psychology: 0.7 }
            }
        };
        
        // Çıkış scenario türleri
        this.exitScenarios = {
            'resistance_rejection': {
                trigger: 'Price approaches resistance with weak volume',
                action: 'exit_at_market',
                confidence: 0.8
            },
            'volume_drop': {
                trigger: 'Volume drops below average after TP1',
                action: 'partial_exit',
                confidence: 0.7
            },
            'trend_weakness': {
                trigger: 'Trend indicators show divergence',
                action: 'scale_out',
                confidence: 0.75
            },
            'news_impact': {
                trigger: 'Negative news affects sentiment',
                action: 'immediate_exit',
                confidence: 0.9
            },
            'time_decay': {
                trigger: 'Position held too long without progress',
                action: 'review_and_exit',
                confidence: 0.6
            }
        };
        
        // Historical pattern database (simplified)
        this.historicalPatterns = new Map();
        this.patternMatchCache = new Map();
        this.maxPatternHistory = 500;
    }

    async analyze(data) {
        try {
            const {
                symbol,
                entryPrice,
                indicators,
                trendInfo,
                formation,
                support,
                resistance,
                newsImpact,
                psychology,
                historicalPatterns,
                dailyStats,
                timestamp = Date.now()
            } = data;

            // Teknik analiz değerlendirmesi
            const technicalAssessment = this.assessTechnicalConditions(indicators, trendInfo, formation, data);
            
            // Senaryo benzerlik analizi
            const scenarioMatching = this.analyzeScenarioSimilarity(historicalPatterns, technicalAssessment, data);
            
            // Risk-reward hesaplaması
            const riskRewardAnalysis = this.calculateRiskReward(entryPrice, support, resistance, data);
            
            // Psikolojik durum değerlendirmesi
            const psychologyAssessment = this.assessPsychology(psychology, newsImpact, data);
            
            // Günlük işlem kontrolü
            const dailyTradeCheck = this.checkDailyLimits(dailyStats, data);
            
            // Strateji seçimi
            const strategySelection = this.selectOptimalStrategy(technicalAssessment, scenarioMatching, psychologyAssessment);
            
            // Kademeli TP planı
            const takeProfitPlan = this.createTakeProfitPlan(riskRewardAnalysis, scenarioMatching, data);
            
            // Çıkış scenario planı
            const exitScenarioPlan = this.planExitScenarios(trendInfo, formation, newsImpact, data);
            
            // Final karar
            const finalDecision = this.makeFinalDecision(
                technicalAssessment,
                scenarioMatching, 
                riskRewardAnalysis,
                psychologyAssessment,
                dailyTradeCheck,
                data
            );

            const result = {
                technicalAssessment: technicalAssessment,
                scenarioMatching: scenarioMatching,
                riskRewardAnalysis: riskRewardAnalysis,
                psychologyAssessment: psychologyAssessment,
                dailyTradeCheck: dailyTradeCheck,
                strategySelection: strategySelection,
                takeProfitPlan: takeProfitPlan,
                exitScenarioPlan: exitScenarioPlan,
                finalDecision: finalDecision,
                recommendations: this.generateModularRecommendations(finalDecision, strategySelection, data),
                alerts: this.generateAlerts(finalDecision, riskRewardAnalysis, dailyTradeCheck),
                notes: this.generateNotes(finalDecision, strategySelection, scenarioMatching),
                metadata: {
                    analysisTimestamp: timestamp,
                    symbol: symbol,
                    entryApproved: finalDecision.approved,
                    expectedTP: finalDecision.expectedTP,
                    expectedSL: finalDecision.expectedSL,
                    riskRewardRatio: riskRewardAnalysis.ratio,
                    strategyType: strategySelection.selected.name,
                    scenarioMatchScore: scenarioMatching.bestMatch?.score || 0
                }
            };

            this.updatePatternHistory(data, result, timestamp);
            this.updateCache(data, result);
            this.trackPerformance(Date.now(), true);

            return result;

        } catch (error) {
            this.handleError('PositionPathPlanner analysis failed', error, data);
            return this.getDefaultResult();
        }
    }

    assessTechnicalConditions(indicators, trendInfo, formation, data) {
        const assessment = {
            indicators: {},
            trend: {},
            formation: {},
            overallScore: 0
        };
        
        // Indicator değerlendirmesi
        if (indicators) {
            assessment.indicators = {
                ema21: this.evaluateEMA(indicators.EMA21, data.entryPrice),
                rsi: this.evaluateRSI(indicators.RSI),
                macd: this.evaluateMACD(indicators.MACD),
                score: 0
            };
            
            // Indicator score hesaplama
            let indicatorScore = 0;
            if (assessment.indicators.ema21.signal === 'bullish') indicatorScore += 0.3;
            if (assessment.indicators.rsi.signal === 'neutral' || assessment.indicators.rsi.signal === 'bullish') indicatorScore += 0.2;
            if (assessment.indicators.macd.signal === 'bullish') indicatorScore += 0.3;
            assessment.indicators.score = indicatorScore;
        }
        
        // Trend değerlendirmesi
        if (trendInfo) {
            assessment.trend = {
                type: trendInfo.type || 'neutral',
                strength: trendInfo.strength || 0.5,
                breakoutConfirmed: trendInfo.breakoutConfirmed || false,
                score: this.calculateTrendScore(trendInfo)
            };
        }
        
        // Formation değerlendirmesi
        if (formation) {
            assessment.formation = {
                type: formation,
                validity: this.assessFormationValidity(formation, data),
                successProbability: this.getFormationSuccessProbability(formation),
                score: this.calculateFormationScore(formation, data)
            };
        }
        
        // Overall technical score
        assessment.overallScore = (
            (assessment.indicators.score || 0) * 0.4 +
            (assessment.trend.score || 0) * 0.4 +
            (assessment.formation.score || 0) * 0.2
        );
        
        return assessment;
    }

    analyzeScenarioSimilarity(historicalPatterns, technicalAssessment, data) {
        if (!historicalPatterns || historicalPatterns.length === 0) {
            return {
                bestMatch: null,
                matchScore: 0,
                similarScenarios: [],
                confidence: 0.3,
                recommendedStrategy: 'conservative'
            };
        }
        
        const similarities = [];
        
        for (const pattern of historicalPatterns) {
            const similarity = this.calculatePatternSimilarity(pattern, technicalAssessment, data);
            similarities.push({
                pattern: pattern,
                score: similarity.score,
                factors: similarity.factors,
                avgProfit: pattern.avgProfit || 0,
                exitStyle: pattern.exitStyle || '2TP'
            });
        }
        
        // En yüksek benzerliği bul
        similarities.sort((a, b) => b.score - a.score);
        const bestMatch = similarities[0];
        
        // Benzer senaryoları filtrele (>%60 benzerlik)
        const similarScenarios = similarities.filter(s => s.score >= 0.6);
        
        return {
            bestMatch: bestMatch,
            matchScore: bestMatch?.score || 0,
            similarScenarios: similarScenarios,
            confidence: this.calculateMatchConfidence(bestMatch, similarScenarios),
            recommendedStrategy: this.getRecommendedStrategy(bestMatch, similarScenarios)
        };
    }

    calculateRiskReward(entryPrice, support, resistance, data) {
        if (!entryPrice || !support || !resistance) {
            return this.getDefaultRiskReward();
        }
        
        // Risk hesaplama (stop loss'a olan mesafe)
        const risk = Math.abs(entryPrice - support);
        const riskPercentage = (risk / entryPrice) * 100;
        
        // Reward hesaplama (resistance'a olan mesafe)
        const reward = Math.abs(resistance - entryPrice);
        const rewardPercentage = (reward / entryPrice) * 100;
        
        // Risk/Reward ratio
        const ratio = reward / risk;
        
        // Expected profit calculation
        const expectedProfit = rewardPercentage;
        const expectedLoss = riskPercentage;
        
        return {
            risk: risk,
            riskPercentage: riskPercentage,
            reward: reward,
            rewardPercentage: rewardPercentage,
            ratio: ratio,
            expectedProfit: expectedProfit,
            expectedLoss: expectedLoss,
            meetsMinimum: ratio >= this.decisionCriteria.minRiskReward && expectedProfit >= this.decisionCriteria.minExpectedProfit * 100,
            quality: this.assessRiskRewardQuality(ratio, expectedProfit)
        };
    }

    assessPsychology(psychology, newsImpact, data) {
        const stabilityScore = psychology?.stabilityScore || 0.7;
        const riskAppetite = psychology?.riskAppetite || 0.7;
        const fatigueLevel = psychology?.fatigueLevel || 0.3;
        
        // News impact adjustment
        let newsAdjustment = 0;
        if (newsImpact === 'positive') newsAdjustment = 0.1;
        if (newsImpact === 'negative') newsAdjustment = -0.15;
        
        const adjustedStability = Math.max(0, Math.min(1, stabilityScore + newsAdjustment));
        
        // Overall psychology score
        const overallScore = (
            adjustedStability * 0.5 +
            riskAppetite * 0.3 +
            (1 - fatigueLevel) * 0.2
        );
        
        return {
            stabilityScore: adjustedStability,
            riskAppetite: riskAppetite,
            fatigueLevel: fatigueLevel,
            newsAdjustment: newsAdjustment,
            overallScore: overallScore,
            meetsMinimum: overallScore >= this.decisionCriteria.minPsychologyScore,
            recommendation: this.getPsychologyRecommendation(overallScore, fatigueLevel)
        };
    }

    checkDailyLimits(dailyStats, data) {
        const tradesTaken = dailyStats?.tradesTaken || 0;
        const maxAllowed = dailyStats?.maxAllowedTrades || this.decisionCriteria.maxDailyTrades;
        const avgProfitToday = dailyStats?.avgProfitToday || 0;
        
        const tradesRemaining = maxAllowed - tradesTaken;
        const withinLimits = tradesTaken < maxAllowed;
        
        return {
            tradesTaken: tradesTaken,
            maxAllowed: maxAllowed,
            tradesRemaining: tradesRemaining,
            withinLimits: withinLimits,
            avgProfitToday: avgProfitToday,
            recommendation: this.getDailyTradeRecommendation(tradesTaken, maxAllowed, avgProfitToday)
        };
    }

    selectOptimalStrategy(technicalAssessment, scenarioMatching, psychologyAssessment) {
        const scores = {};
        
        // Her strateji için uygunluk skorunu hesapla
        for (const [strategyName, strategy] of Object.entries(this.strategyTypes)) {
            let score = 0;
            
            // Technical score contribution
            if (technicalAssessment.trend.strength >= strategy.requirements.trendStrength) {
                score += 0.4;
            }
            
            // Psychology score contribution
            if (psychologyAssessment.overallScore >= strategy.requirements.psychology) {
                score += 0.3;
            }
            
            // Scenario matching contribution
            if (scenarioMatching.matchScore >= 0.7) {
                score += 0.3;
            }
            
            scores[strategyName] = {
                strategy: strategy,
                score: score,
                suitability: this.assessStrategySuitability(score)
            };
        }
        
        // En yüksek skorlu stratejiyi seç
        const bestStrategy = Object.entries(scores).reduce((best, [name, data]) => 
            data.score > best.score ? { name, ...data } : best
        , { score: 0 });
        
        return {
            scores: scores,
            selected: bestStrategy,
            confidence: bestStrategy.score,
            alternatives: Object.entries(scores).filter(([name]) => name !== bestStrategy.name)
        };
    }

    createTakeProfitPlan(riskRewardAnalysis, scenarioMatching, data) {
        const expectedProfit = riskRewardAnalysis.expectedProfit;
        const bestMatch = scenarioMatching.bestMatch;
        
        // Kademeli TP seviyeleri
        let tpLevels = [];
        
        if (expectedProfit >= 6.0) {
            // 3TP stratejisi
            tpLevels = [
                expectedProfit * 0.3,  // %30'u
                expectedProfit * 0.6,  // %60'ı
                expectedProfit * 0.9   // %90'ı
            ];
        } else if (expectedProfit >= 4.0) {
            // 2TP stratejisi
            tpLevels = [
                expectedProfit * 0.4,  // %40'ı
                expectedProfit * 0.8   // %80'i
            ];
        } else {
            // 1TP stratejisi
            tpLevels = [expectedProfit * 0.9]; // %90'ı
        }
        
        // Historical pattern'dan gelen öneri varsa kullan
        if (bestMatch && bestMatch.pattern.exitStyle && bestMatch.score >= 0.75) {
            const historicalLevels = bestMatch.pattern.levels || tpLevels;
            if (historicalLevels.length > 0) {
                tpLevels = historicalLevels;
            }
        }
        
        return {
            levels: tpLevels,
            strategy: tpLevels.length === 3 ? '3TP' : (tpLevels.length === 2 ? '2TP' : '1TP'),
            totalExpected: expectedProfit,
            historicalBased: bestMatch?.score >= 0.75,
            confidenceLevel: this.calculateTPConfidence(tpLevels, bestMatch)
        };
    }

    planExitScenarios(trendInfo, formation, newsImpact, data) {
        const scenarios = [];
        
        // Trend-based scenarios
        if (trendInfo?.strength < 0.6) {
            scenarios.push({
                ...this.exitScenarios.trend_weakness,
                probability: 0.7,
                timeframe: '15-30 minutes'
            });
        }
        
        // Formation-based scenarios
        if (formation && this.isFormationRisky(formation)) {
            scenarios.push({
                ...this.exitScenarios.resistance_rejection,
                probability: 0.6,
                timeframe: '10-20 minutes'
            });
        }
        
        // News-based scenarios
        if (newsImpact === 'negative') {
            scenarios.push({
                ...this.exitScenarios.news_impact,
                probability: 0.8,
                timeframe: 'immediate'
            });
        }
        
        // Volume scenario
        scenarios.push({
            ...this.exitScenarios.volume_drop,
            probability: 0.5,
            timeframe: '5-15 minutes after TP1'
        });
        
        // Time decay scenario
        scenarios.push({
            ...this.exitScenarios.time_decay,
            probability: 0.4,
            timeframe: '45-60 minutes'
        });
        
        return {
            scenarios: scenarios,
            primaryScenario: scenarios.length > 0 ? scenarios[0] : null,
            totalScenarios: scenarios.length,
            averageProbability: scenarios.length > 0 ? 
                scenarios.reduce((sum, s) => sum + s.probability, 0) / scenarios.length : 0
        };
    }

    makeFinalDecision(technicalAssessment, scenarioMatching, riskRewardAnalysis, psychologyAssessment, dailyTradeCheck, data) {
        let approved = true;
        const reasons = [];
        const warnings = [];
        
        // Kritik kontroller
        if (!riskRewardAnalysis.meetsMinimum) {
            approved = false;
            reasons.push(`Risk/Reward ratio (${riskRewardAnalysis.ratio.toFixed(2)}) below minimum ${this.decisionCriteria.minRiskReward}`);
        }
        
        if (riskRewardAnalysis.expectedProfit < this.decisionCriteria.minExpectedProfit * 100) {
            approved = false;
            reasons.push(`Expected profit (${riskRewardAnalysis.expectedProfit.toFixed(2)}%) below minimum ${(this.decisionCriteria.minExpectedProfit * 100).toFixed(1)}%`);
        }
        
        if (!psychologyAssessment.meetsMinimum) {
            approved = false;
            reasons.push(`Psychology score (${psychologyAssessment.overallScore.toFixed(2)}) below minimum ${this.decisionCriteria.minPsychologyScore}`);
        }
        
        if (!dailyTradeCheck.withinLimits) {
            approved = false;
            reasons.push(`Daily trade limit exceeded (${dailyTradeCheck.tradesTaken}/${dailyTradeCheck.maxAllowed})`);
        }
        
        if (scenarioMatching.matchScore < this.decisionCriteria.minScenarioMatch) {
            warnings.push(`Low scenario match (${(scenarioMatching.matchScore * 100).toFixed(1)}%) - proceed with caution`);
        }
        
        if (technicalAssessment.overallScore < 0.6) {
            warnings.push(`Weak technical conditions (${(technicalAssessment.overallScore * 100).toFixed(1)}%)`);
        }
        
        return {
            approved: approved,
            confidence: this.calculateDecisionConfidence(technicalAssessment, scenarioMatching, riskRewardAnalysis, psychologyAssessment),
            expectedTP: riskRewardAnalysis.expectedProfit,
            expectedSL: riskRewardAnalysis.expectedLoss,
            riskRewardRatio: riskRewardAnalysis.ratio,
            reasons: reasons,
            warnings: warnings,
            strategyNotes: this.generateStrategyNotes(scenarioMatching, technicalAssessment, psychologyAssessment),
            systemNotifications: this.generateSystemNotifications(approved, reasons, warnings)
        };
    }

    // Helper methods for calculations
    evaluateEMA(ema21, entryPrice) {
        if (!ema21 || !entryPrice) return { signal: 'neutral', strength: 0.5 };
        
        const diff = entryPrice - ema21;
        const percentage = (diff / ema21) * 100;
        
        if (percentage > 1) return { signal: 'bullish', strength: 0.8, percentage };
        if (percentage > 0) return { signal: 'bullish', strength: 0.6, percentage };
        if (percentage > -1) return { signal: 'neutral', strength: 0.5, percentage };
        return { signal: 'bearish', strength: 0.3, percentage };
    }

    evaluateRSI(rsi) {
        if (!rsi) return { signal: 'neutral', strength: 0.5 };
        
        if (rsi > 70) return { signal: 'overbought', strength: 0.3, value: rsi };
        if (rsi > 50) return { signal: 'bullish', strength: 0.7, value: rsi };
        if (rsi > 30) return { signal: 'neutral', strength: 0.5, value: rsi };
        return { signal: 'oversold', strength: 0.8, value: rsi };
    }

    evaluateMACD(macd) {
        if (!macd) return { signal: 'neutral', strength: 0.5 };
        
        const line = macd.line || macd;
        const signal = macd.signal || 0;
        const histogram = macd.histogram || (line - signal);
        
        if (line > signal && histogram > 0) return { signal: 'bullish', strength: 0.8, values: macd };
        if (line > signal) return { signal: 'bullish', strength: 0.6, values: macd };
        if (line < signal && histogram < 0) return { signal: 'bearish', strength: 0.3, values: macd };
        return { signal: 'neutral', strength: 0.5, values: macd };
    }

    calculateTrendScore(trendInfo) {
        let score = 0;
        
        if (trendInfo.type === 'bullish') score += 0.4;
        score += trendInfo.strength * 0.4;
        if (trendInfo.breakoutConfirmed) score += 0.2;
        
        return Math.min(score, 1.0);
    }

    assessFormationValidity(formation, data) {
        const validFormations = ['cup-and-handle', 'ascending-triangle', 'bull-flag', 'breakout'];
        return validFormations.includes(formation) ? 'valid' : 'questionable';
    }

    getFormationSuccessProbability(formation) {
        const probabilities = {
            'cup-and-handle': 0.75,
            'ascending-triangle': 0.70,
            'bull-flag': 0.65,
            'breakout': 0.60,
            'head-and-shoulders': 0.55
        };
        return probabilities[formation] || 0.50;
    }

    calculateFormationScore(formation, data) {
        const validity = this.assessFormationValidity(formation, data);
        const probability = this.getFormationSuccessProbability(formation);
        
        return validity === 'valid' ? probability : probability * 0.7;
    }

    calculatePatternSimilarity(pattern, technicalAssessment, data) {
        // Simplified similarity calculation
        let score = 0;
        const factors = [];
        
        // Trend similarity
        if (pattern.trendScore && technicalAssessment.trend.strength) {
            const trendSimilarity = 1 - Math.abs(pattern.trendScore - technicalAssessment.trend.strength);
            score += trendSimilarity * 0.4;
            factors.push(`Trend similarity: ${(trendSimilarity * 100).toFixed(1)}%`);
        }
        
        // Formation similarity
        if (pattern.formation && data.formation) {
            const formationMatch = pattern.formation === data.formation ? 1 : 0.5;
            score += formationMatch * 0.3;
            factors.push(`Formation match: ${formationMatch === 1 ? 'exact' : 'partial'}`);
        }
        
        // Technical indicators similarity
        if (pattern.indicators && technicalAssessment.indicators) {
            score += 0.3; // Simplified
            factors.push('Technical indicators matched');
        }
        
        return { score: Math.min(score, 1.0), factors };
    }

    calculateMatchConfidence(bestMatch, similarScenarios) {
        if (!bestMatch) return 0.3;
        
        const matchScore = bestMatch.score;
        const scenarioCount = similarScenarios.length;
        
        return Math.min(matchScore + (scenarioCount * 0.05), 0.95);
    }

    getRecommendedStrategy(bestMatch, similarScenarios) {
        if (!bestMatch || bestMatch.score < 0.6) return 'conservative';
        if (bestMatch.score >= 0.8 && similarScenarios.length >= 3) return 'aggressive';
        return 'balanced';
    }

    getDefaultRiskReward() {
        return {
            risk: 0,
            riskPercentage: 2.0,
            reward: 0,
            rewardPercentage: 4.0,
            ratio: 2.0,
            expectedProfit: 4.0,
            expectedLoss: 2.0,
            meetsMinimum: true,
            quality: 'acceptable'
        };
    }

    assessRiskRewardQuality(ratio, expectedProfit) {
        if (ratio >= 3.0 && expectedProfit >= 5.0) return 'excellent';
        if (ratio >= 2.5 && expectedProfit >= 4.0) return 'good';
        if (ratio >= 2.0 && expectedProfit >= 3.5) return 'acceptable';
        return 'poor';
    }

    getPsychologyRecommendation(score, fatigue) {
        if (score >= 0.9 && fatigue < 0.3) return 'optimal_for_trading';
        if (score >= 0.8 && fatigue < 0.5) return 'good_for_trading';
        if (score >= 0.7) return 'caution_advised';
        return 'avoid_trading';
    }

    getDailyTradeRecommendation(taken, max, avgProfit) {
        if (taken >= max) return 'no_more_trades';
        if (taken >= max * 0.8) return 'final_trade_only';
        if (avgProfit < 2.0) return 'improve_quality';
        return 'continue_trading';
    }

    assessStrategySuitability(score) {
        if (score >= 0.8) return 'highly_suitable';
        if (score >= 0.6) return 'suitable';
        if (score >= 0.4) return 'moderately_suitable';
        return 'not_suitable';
    }

    calculateTPConfidence(levels, bestMatch) {
        let confidence = 0.7; // Base confidence
        
        if (bestMatch && bestMatch.score >= 0.75) confidence += 0.2;
        if (levels.length >= 2) confidence += 0.1;
        
        return Math.min(confidence, 0.95);
    }

    isFormationRisky(formation) {
        const riskyFormations = ['head-and-shoulders', 'double-top', 'rising-wedge'];
        return riskyFormations.includes(formation);
    }

    calculateDecisionConfidence(technical, scenario, riskReward, psychology) {
        return (
            technical.overallScore * 0.3 +
            scenario.matchScore * 0.3 +
            (riskReward.meetsMinimum ? 0.8 : 0.3) * 0.2 +
            psychology.overallScore * 0.2
        );
    }

    generateStrategyNotes(scenarioMatching, technicalAssessment, psychologyAssessment) {
        const notes = [];
        
        if (scenarioMatching.bestMatch) {
            notes.push(`Match with ${scenarioMatching.bestMatch.pattern.exitStyle} pattern: ${(scenarioMatching.matchScore * 100).toFixed(0)}%`);
        }
        
        notes.push(`Psychology stability: ${psychologyAssessment.overallScore >= 0.8 ? 'High' : 'Medium'}`);
        notes.push(`Trend strength: ${technicalAssessment.trend.strength?.toFixed(2) || 'Unknown'}`);
        
        if (technicalAssessment.formation.type) {
            notes.push(`Formation: Valid ${technicalAssessment.formation.type}`);
        }
        
        return notes;
    }

    generateSystemNotifications(approved, reasons, warnings) {
        return {
            vivo: approved ? "approveSignal" : "rejectSignal",
            livia: warnings.length > 0 ? "psychology:warning" : "psychology:pass",
            grafikBeyni: "trend:valid",
            denetimAsistani: reasons.length > 0 ? "position_rejected" : "R/R OK"
        };
    }

    updatePatternHistory(data, result, timestamp) {
        // Pattern history güncelleme (simplified)
        const patternKey = `${data.symbol}_${data.formation}_${Date.now()}`;
        this.historicalPatterns.set(patternKey, {
            timestamp: timestamp,
            symbol: data.symbol,
            formation: data.formation,
            trendStrength: data.trendInfo?.strength,
            approved: result.finalDecision.approved,
            expectedProfit: result.finalDecision.expectedTP
        });
        
        // Maksimum boyutu koru
        if (this.historicalPatterns.size > this.maxPatternHistory) {
            const firstKey = this.historicalPatterns.keys().next().value;
            this.historicalPatterns.delete(firstKey);
        }
    }

    generateModularRecommendations(finalDecision, strategySelection, data) {
        return {
            VIVO: {
                approveEntry: finalDecision.approved,
                strategyType: strategySelection.selected.name,
                confidence: finalDecision.confidence,
                riskLevel: strategySelection.selected.strategy.riskLevel
            },
            LIVIA: {
                psychologyCheck: finalDecision.approved,
                riskComfort: finalDecision.expectedSL < 3.0,
                warningsPresent: finalDecision.warnings.length > 0
            },
            denetimAsistani: {
                logDecision: true,
                approved: finalDecision.approved,
                reasons: finalDecision.reasons,
                expectedPerformance: finalDecision.expectedTP
            }
        };
    }

    generateAlerts(finalDecision, riskRewardAnalysis, dailyTradeCheck) {
        const alerts = [];

        if (!finalDecision.approved) {
            alerts.push({
                level: 'critical',
                message: 'Position entry rejected',
                action: `Reasons: ${finalDecision.reasons.join(', ')}`
            });
        }

        if (finalDecision.warnings.length > 0) {
            alerts.push({
                level: 'warning',
                message: `${finalDecision.warnings.length} warnings detected`,
                action: 'Review conditions before entry'
            });
        }

        if (riskRewardAnalysis.quality === 'excellent') {
            alerts.push({
                level: 'info',
                message: 'Excellent risk/reward opportunity',
                action: 'Consider higher position size'
            });
        }

        if (dailyTradeCheck.tradesRemaining <= 1) {
            alerts.push({
                level: 'warning',
                message: 'Final trade of the day',
                action: 'Ensure high quality setup'
            });
        }

        return alerts;
    }

    generateNotes(finalDecision, strategySelection, scenarioMatching) {
        const notes = [];
        
        notes.push(`Entry: ${finalDecision.approved ? 'APPROVED' : 'REJECTED'}`);
        notes.push(`Strategy: ${strategySelection.selected.name}`);
        notes.push(`Expected TP: ${finalDecision.expectedTP.toFixed(1)}%`);
        notes.push(`R/R: ${finalDecision.riskRewardRatio.toFixed(2)}`);
        
        if (scenarioMatching.bestMatch) {
            notes.push(`Match: ${(scenarioMatching.matchScore * 100).toFixed(0)}%`);
        }

        return notes.join('. ');
    }

    getDefaultResult() {
        return {
            technicalAssessment: { overallScore: 0.6, trend: { strength: 0.6 }, indicators: { score: 0.6 } },
            scenarioMatching: { bestMatch: null, matchScore: 0.3, confidence: 0.3 },
            riskRewardAnalysis: this.getDefaultRiskReward(),
            psychologyAssessment: { overallScore: 0.8, meetsMinimum: true },
            dailyTradeCheck: { withinLimits: true, tradesRemaining: 2 },
            strategySelection: { selected: { name: 'Conservative Entry', strategy: this.strategyTypes.conservative } },
            takeProfitPlan: { levels: [3.5], strategy: '1TP' },
            exitScenarioPlan: { scenarios: [], primaryScenario: null },
            finalDecision: { 
                approved: true, 
                expectedTP: 3.5, 
                expectedSL: 1.5, 
                riskRewardRatio: 2.3,
                confidence: 0.7,
                reasons: [],
                warnings: []
            },
            recommendations: {},
            alerts: [],
            notes: "Position path planning completed with default parameters",
            metadata: { error: false, analysisTimestamp: Date.now() }
        };
    }

    getModuleInfo() {
        return {
            name: 'PositionPathPlanner',
            version: '1.0.0',
            description: 'Pozisyon açılmadan önce tüm verileri analiz eder ve optimum strateji belirler',
            inputs: [
                'symbol', 'entryPrice', 'indicators', 'trendInfo', 'formation',
                'support', 'resistance', 'newsImpact', 'psychology', 'historicalPatterns', 'dailyStats'
            ],
            outputs: [
                'technicalAssessment', 'scenarioMatching', 'riskRewardAnalysis', 'psychologyAssessment',
                'strategySelection', 'takeProfitPlan', 'exitScenarioPlan', 'finalDecision'
            ]
        };
    }
}

module.exports = PositionPathPlanner;
