const GrafikBeyniModuleBase = require('./grafikBeyniModuleBase');

/**
 * Frustration Driven Overtrader Module
 * Trader frustration ve overtrading pattern detection
 * Emotional trading patterns, revenge trading ve loss aversion analizi
 */
class FrustrationDrivenOvertrader extends GrafikBeyniModuleBase {
    constructor() {
        super('frustrationDrivenOvertrader');
        this.tradingHistory = [];
        this.emotionalStates = [];
        this.frustrationIndicators = {
            consecutiveLosses: 3,
            rapidTrading: 5, // trades in short time
            positionSizeIncrease: 1.5,
            averageWinLoss: 0.3,
            emotionalVolatility: 0.7
        };
        this.overtradingThresholds = {
            tradeFrequency: 10, // per hour
            positionTurnover: 0.8,
            riskExposure: 2.0,
            emotionalScore: 0.7
        };
        this.maxHistorySize = 500;
        this.analysisWindow = 24 * 60 * 60 * 1000; // 24 hours
    }

    async analyze(data) {
        try {
            const {
                symbol,
                price,
                volume,
                tradingActivity,
                userTradingHistory,
                marketConditions,
                volatility,
                newsFlow,
                sentimentData,
                timeframe,
                positionData,
                accountMetrics,
                behavioralSignals,
                marketPsychology,
                performanceMetrics,
                riskMetrics,
                emotionalIndicators
            } = data;

            // Veri doğrulama
            if (!tradingActivity && !userTradingHistory) {
                throw new Error('Missing trading activity data for frustration analysis');
            }

            // Trading pattern analysis
            const tradingPatterns = this.analyzeTradingPatterns(data);

            // Frustration level detection
            const frustrationLevel = this.detectFrustrationLevel(data);

            // Overtrading indicators
            const overtradingIndicators = this.analyzeOvertradingIndicators(data);

            // Emotional state analysis
            const emotionalState = this.analyzeEmotionalState(data);

            // Revenge trading detection
            const revengeTradingSignals = this.detectRevengeTradingSignals(data);

            // Loss aversion patterns
            const lossAversionPatterns = this.analyzeLossAversionPatterns(data);

            // Market condition impact
            const marketImpact = this.analyzeMarketConditionImpact(data);

            // Risk escalation analysis
            const riskEscalation = this.analyzeRiskEscalation(data);

            // Performance degradation assessment
            const performanceDegradation = this.assessPerformanceDegradation(data);

            // Overall overtrading assessment
            const overallAssessment = this.calculateOverallAssessment({
                tradingPatterns,
                frustrationLevel,
                overtradingIndicators,
                emotionalState,
                revengeTradingSignals,
                lossAversionPatterns,
                marketImpact,
                riskEscalation,
                performanceDegradation
            });

            const result = {
                overallAssessment: overallAssessment,
                tradingPatterns: tradingPatterns,
                frustrationLevel: frustrationLevel,
                overtradingIndicators: overtradingIndicators,
                emotionalState: emotionalState,
                revengeTradingSignals: revengeTradingSignals,
                lossAversionPatterns: lossAversionPatterns,
                marketImpact: marketImpact,
                riskEscalation: riskEscalation,
                performanceDegradation: performanceDegradation,
                interventionRecommendations: this.generateInterventionRecommendations(overallAssessment, data),
                preventiveStrategies: this.generatePreventiveStrategies(overallAssessment, data),
                alerts: this.generateAlerts(overallAssessment, data),
                notes: this.generateNotes(overallAssessment, frustrationLevel),
                metadata: {
                    analysisTimestamp: Date.now(),
                    symbol: symbol,
                    timeframe: timeframe,
                    frustrationLevel: frustrationLevel.level,
                    overtradingRisk: overallAssessment.riskLevel,
                    interventionRequired: overallAssessment.score > 0.7,
                    alertTriggered: overallAssessment.score > 0.6
                }
            };

            // History güncelleme
            this.updateAnalysisHistory(result, data);

            // Cache ve performance tracking
            this.updateCache(data, result);
            this.trackPerformance(Date.now(), overallAssessment.score > 0.5);

            return result;

        } catch (error) {
            this.handleError('FrustrationDrivenOvertrader analysis failed', error, data);
            return this.getDefaultResult();
        }
    }

    analyzeTradingPatterns(data) {
        const { tradingActivity, userTradingHistory, timeframe } = data;

        const patterns = {
            tradeFrequency: 0,
            sessionLength: 0,
            timeDistribution: {},
            consecutiveActivity: 0,
            tradingBursts: [],
            patternAnomalies: []
        };

        if (tradingActivity) {
            // Trade frequency analysis
            const recentTrades = this.getRecentTrades(tradingActivity, this.analysisWindow);
            patterns.tradeFrequency = recentTrades.length;

            // Trading bursts detection
            patterns.tradingBursts = this.detectTradingBursts(recentTrades);

            // Time distribution analysis
            patterns.timeDistribution = this.analyzeTimeDistribution(recentTrades);

            // Session length analysis
            if (recentTrades.length > 0) {
                const sessionStart = Math.min(...recentTrades.map(t => t.timestamp));
                const sessionEnd = Math.max(...recentTrades.map(t => t.timestamp));
                patterns.sessionLength = (sessionEnd - sessionStart) / (60 * 60 * 1000); // hours
            }

            // Consecutive activity detection
            patterns.consecutiveActivity = this.calculateConsecutiveActivity(recentTrades);

            // Pattern anomalies
            patterns.patternAnomalies = this.detectPatternAnomalies(recentTrades, data);
        }

        // Historical pattern comparison
        if (userTradingHistory) {
            patterns.historicalComparison = this.compareWithHistoricalPatterns(patterns, userTradingHistory);
        }

        return patterns;
    }

    detectFrustrationLevel(data) {
        const { performanceMetrics, tradingActivity, emotionalIndicators, marketConditions } = data;

        let frustrationScore = 0;
        const indicators = [];
        const factors = [];

        // Performance-based frustration
        if (performanceMetrics) {
            // Consecutive losses
            if (performanceMetrics.consecutiveLosses >= this.frustrationIndicators.consecutiveLosses) {
                frustrationScore += 0.3;
                indicators.push('consecutive_losses');
                factors.push(`${performanceMetrics.consecutiveLosses} ardışık zarar`);
            }

            // Win/Loss ratio
            if (performanceMetrics.winLossRatio < this.frustrationIndicators.averageWinLoss) {
                frustrationScore += 0.2;
                indicators.push('poor_win_loss_ratio');
                factors.push('Düşük kazanç/kayıp oranı');
            }

            // Drawdown levels
            if (performanceMetrics.currentDrawdown > 0.1) { // 10% drawdown
                frustrationScore += 0.25;
                indicators.push('significant_drawdown');
                factors.push('Önemli drawdown');
            }

            // Recent performance vs expectations
            if (performanceMetrics.recentPerformance < performanceMetrics.expectedPerformance * 0.5) {
                frustrationScore += 0.15;
                indicators.push('performance_disappointment');
                factors.push('Beklenti altı performans');
            }
        }

        // Emotional indicators
        if (emotionalIndicators) {
            if (emotionalIndicators.frustration > 0.6) {
                frustrationScore += 0.2;
                indicators.push('direct_frustration_signal');
                factors.push('Doğrudan frustration sinyali');
            }

            if (emotionalIndicators.impatience > 0.7) {
                frustrationScore += 0.15;
                indicators.push('impatience');
                factors.push('Sabırsızlık');
            }

            if (emotionalIndicators.anger > 0.5) {
                frustrationScore += 0.2;
                indicators.push('anger');
                factors.push('Öfke göstergeleri');
            }
        }

        // Trading behavior frustration signs
        if (tradingActivity) {
            const recentTrades = this.getRecentTrades(tradingActivity, this.analysisWindow);
            
            // Rapid trading after losses
            const rapidTradingAfterLoss = this.detectRapidTradingAfterLoss(recentTrades);
            if (rapidTradingAfterLoss) {
                frustrationScore += 0.2;
                indicators.push('rapid_trading_after_loss');
                factors.push('Zarar sonrası hızlı trading');
            }

            // Position size escalation
            const positionEscalation = this.detectPositionSizeEscalation(recentTrades);
            if (positionEscalation) {
                frustrationScore += 0.25;
                indicators.push('position_size_escalation');
                factors.push('Pozisyon büyüklük artışı');
            }
        }

        // Market condition frustration amplifiers
        if (marketConditions) {
            if (marketConditions.volatility > 0.8) {
                frustrationScore += 0.1;
                factors.push('Yüksek market volatilite');
            }

            if (marketConditions.trending === false) {
                frustrationScore += 0.1;
                factors.push('Sideways market');
            }
        }

        // Frustration level classification
        let level = 'low';
        if (frustrationScore > 0.7) level = 'extreme';
        else if (frustrationScore > 0.5) level = 'high';
        else if (frustrationScore > 0.3) level = 'moderate';

        return {
            score: Math.min(frustrationScore, 1),
            level: level,
            indicators: indicators,
            factors: factors,
            consecutive_losses: performanceMetrics?.consecutiveLosses || 0,
            current_drawdown: performanceMetrics?.currentDrawdown || 0,
            emotional_intensity: emotionalIndicators ? 
                (emotionalIndicators.frustration + emotionalIndicators.anger + emotionalIndicators.impatience) / 3 : 0
        };
    }

    analyzeOvertradingIndicators(data) {
        const { tradingActivity, accountMetrics, positionData, riskMetrics } = data;

        const indicators = {
            frequency: { score: 0, level: 'normal' },
            turnover: { score: 0, level: 'normal' },
            riskExposure: { score: 0, level: 'normal' },
            efficiency: { score: 0, level: 'normal' }
        };

        const recentTrades = tradingActivity ? this.getRecentTrades(tradingActivity, this.analysisWindow) : [];

        // Trading frequency analysis
        const tradesPerHour = recentTrades.length / 24; // Assuming 24-hour window
        if (tradesPerHour > this.overtradingThresholds.tradeFrequency) {
            indicators.frequency.score = Math.min(tradesPerHour / this.overtradingThresholds.tradeFrequency, 2);
            indicators.frequency.level = indicators.frequency.score > 1.5 ? 'extreme' : 'high';
        }

        // Portfolio turnover analysis
        if (accountMetrics && accountMetrics.portfolioTurnover) {
            if (accountMetrics.portfolioTurnover > this.overtradingThresholds.positionTurnover) {
                indicators.turnover.score = accountMetrics.portfolioTurnover / this.overtradingThresholds.positionTurnover;
                indicators.turnover.level = indicators.turnover.score > 1.5 ? 'extreme' : 'high';
            }
        }

        // Risk exposure analysis
        if (riskMetrics) {
            if (riskMetrics.totalExposure > this.overtradingThresholds.riskExposure) {
                indicators.riskExposure.score = riskMetrics.totalExposure / this.overtradingThresholds.riskExposure;
                indicators.riskExposure.level = indicators.riskExposure.score > 1.5 ? 'extreme' : 'high';
            }
        }

        // Trading efficiency analysis
        if (recentTrades.length > 0) {
            const profitableTrades = recentTrades.filter(t => t.pnl > 0).length;
            const efficiency = profitableTrades / recentTrades.length;
            
            if (efficiency < 0.3) { // Less than 30% profitable
                indicators.efficiency.score = (0.3 - efficiency) / 0.3;
                indicators.efficiency.level = indicators.efficiency.score > 0.7 ? 'poor' : 'below_average';
            }
        }

        // Overall overtrading score
        const overallScore = (
            indicators.frequency.score +
            indicators.turnover.score +
            indicators.riskExposure.score +
            indicators.efficiency.score
        ) / 4;

        return {
            indicators: indicators,
            overallScore: overallScore,
            level: overallScore > 1.5 ? 'extreme' : overallScore > 1 ? 'high' : overallScore > 0.5 ? 'moderate' : 'normal',
            tradesPerHour: tradesPerHour,
            totalTrades: recentTrades.length,
            efficiency: recentTrades.length > 0 ? recentTrades.filter(t => t.pnl > 0).length / recentTrades.length : 0
        };
    }

    analyzeEmotionalState(data) {
        const { emotionalIndicators, performanceMetrics, marketConditions, behavioralSignals } = data;

        const emotionalState = {
            primary: 'neutral',
            intensity: 0.5,
            volatility: 0,
            stability: 0.5,
            factors: []
        };

        let emotionalScore = 0;
        const emotions = {};

        if (emotionalIndicators) {
            // Primary emotions
            emotions.fear = emotionalIndicators.fear || 0;
            emotions.greed = emotionalIndicators.greed || 0;
            emotions.frustration = emotionalIndicators.frustration || 0;
            emotions.confidence = emotionalIndicators.confidence || 0.5;
            emotions.impatience = emotionalIndicators.impatience || 0;
            emotions.anger = emotionalIndicators.anger || 0;

            // Find primary emotion
            const primaryEmotion = Object.keys(emotions).reduce((a, b) => 
                emotions[a] > emotions[b] ? a : b
            );

            emotionalState.primary = primaryEmotion;
            emotionalState.intensity = emotions[primaryEmotion];

            // Emotional volatility
            const emotionValues = Object.values(emotions);
            const avgEmotion = emotionValues.reduce((sum, val) => sum + val, 0) / emotionValues.length;
            const variance = emotionValues.reduce((sum, val) => sum + Math.pow(val - avgEmotion, 2), 0) / emotionValues.length;
            emotionalState.volatility = Math.sqrt(variance);

            // Emotional stability
            emotionalState.stability = 1 - emotionalState.volatility;

            // High-risk emotional states
            if (emotions.frustration > 0.7 || emotions.anger > 0.6) {
                emotionalState.factors.push('Yüksek negatif duygu');
                emotionalScore += 0.3;
            }

            if (emotions.impatience > 0.7) {
                emotionalState.factors.push('Aşırı sabırsızlık');
                emotionalScore += 0.2;
            }

            if (emotions.greed > 0.8) {
                emotionalState.factors.push('Aşırı açgözlülük');
                emotionalScore += 0.2;
            }

            if (emotions.fear > 0.8) {
                emotionalState.factors.push('Aşırı korku');
                emotionalScore += 0.25;
            }
        }

        // Behavioral signals
        if (behavioralSignals) {
            if (behavioralSignals.impulsivity > 0.7) {
                emotionalState.factors.push('İmpulsif davranış');
                emotionalScore += 0.2;
            }

            if (behavioralSignals.riskSeeking > 0.8) {
                emotionalState.factors.push('Aşırı risk alma');
                emotionalScore += 0.15;
            }
        }

        // Performance impact on emotions
        if (performanceMetrics) {
            if (performanceMetrics.recentLosses > 3) {
                emotionalState.factors.push('Recent losses impacting emotions');
                emotionalScore += 0.1;
            }
        }

        return {
            ...emotionalState,
            riskScore: emotionalScore,
            emotions: emotions,
            riskLevel: emotionalScore > 0.7 ? 'high' : emotionalScore > 0.4 ? 'moderate' : 'low'
        };
    }

    detectRevengeTradingSignals(data) {
        const { tradingActivity, performanceMetrics } = data;

        const signals = {
            detected: false,
            strength: 'none',
            patterns: [],
            riskLevel: 'low'
        };

        if (!tradingActivity) return signals;

        const recentTrades = this.getRecentTrades(tradingActivity, this.analysisWindow);
        
        // Look for revenge trading patterns
        for (let i = 1; i < recentTrades.length; i++) {
            const currentTrade = recentTrades[i];
            const previousTrade = recentTrades[i - 1];

            // Pattern 1: Immediate larger position after loss
            if (previousTrade.pnl < 0 && currentTrade.size > previousTrade.size * 1.5) {
                const timeDiff = currentTrade.timestamp - previousTrade.timestamp;
                if (timeDiff < 5 * 60 * 1000) { // Within 5 minutes
                    signals.patterns.push('immediate_size_increase_after_loss');
                    signals.detected = true;
                }
            }

            // Pattern 2: Opposite direction after loss (if trend data available)
            if (previousTrade.pnl < 0 && currentTrade.direction !== previousTrade.direction) {
                const timeDiff = currentTrade.timestamp - previousTrade.timestamp;
                if (timeDiff < 10 * 60 * 1000) { // Within 10 minutes
                    signals.patterns.push('quick_direction_reversal_after_loss');
                    signals.detected = true;
                }
            }

            // Pattern 3: Multiple trades with increasing size after losses
            if (this.detectIncreasingPositionsAfterLosses(recentTrades, i)) {
                signals.patterns.push('escalating_positions_after_losses');
                signals.detected = true;
            }
        }

        // Pattern 4: Revenge trading session (multiple quick trades after significant loss)
        const significantLosses = recentTrades.filter(t => t.pnl < -1000); // Assuming significant loss threshold
        for (const loss of significantLosses) {
            const tradesAfterLoss = recentTrades.filter(t => 
                t.timestamp > loss.timestamp && 
                t.timestamp < loss.timestamp + 60 * 60 * 1000 // Within 1 hour
            );
            
            if (tradesAfterLoss.length > 5) {
                signals.patterns.push('revenge_trading_session');
                signals.detected = true;
            }
        }

        // Strength assessment
        if (signals.patterns.length >= 3) {
            signals.strength = 'strong';
            signals.riskLevel = 'high';
        } else if (signals.patterns.length >= 2) {
            signals.strength = 'moderate';
            signals.riskLevel = 'moderate';
        } else if (signals.patterns.length >= 1) {
            signals.strength = 'weak';
            signals.riskLevel = 'moderate';
        }

        return signals;
    }

    analyzeLossAversionPatterns(data) {
        const { tradingActivity, positionData } = data;

        const patterns = {
            detected: false,
            avgHoldTimeLoss: 0,
            avgHoldTimeProfit: 0,
            prematureExits: 0,
            extendedLosses: 0,
            riskLevel: 'low'
        };

        if (!tradingActivity) return patterns;

        const closedTrades = tradingActivity.filter(t => t.status === 'closed');
        
        if (closedTrades.length === 0) return patterns;

        const profitableTrades = closedTrades.filter(t => t.pnl > 0);
        const losingTrades = closedTrades.filter(t => t.pnl < 0);

        // Calculate average hold times
        if (profitableTrades.length > 0) {
            patterns.avgHoldTimeProfit = profitableTrades.reduce((sum, t) => 
                sum + (t.closeTime - t.openTime), 0) / profitableTrades.length;
        }

        if (losingTrades.length > 0) {
            patterns.avgHoldTimeLoss = losingTrades.reduce((sum, t) => 
                sum + (t.closeTime - t.openTime), 0) / losingTrades.length;
        }

        // Loss aversion detection
        if (patterns.avgHoldTimeLoss > patterns.avgHoldTimeProfit * 2) {
            patterns.detected = true;
            patterns.riskLevel = 'high';
        }

        // Premature profit-taking
        patterns.prematureExits = profitableTrades.filter(t => 
            (t.closeTime - t.openTime) < 5 * 60 * 1000 && // Less than 5 minutes
            t.pnl < t.maxUnrealizedPnl * 0.3 // Closed at less than 30% of max profit
        ).length;

        // Extended loss holding
        patterns.extendedLosses = losingTrades.filter(t => 
            (t.closeTime - t.openTime) > 60 * 60 * 1000 && // More than 1 hour
            t.pnl < t.minUnrealizedPnl * 0.8 // Loss extended beyond 80% of worst point
        ).length;

        return patterns;
    }

    analyzeMarketConditionImpact(data) {
        const { marketConditions, volatility, tradingActivity } = data;

        const impact = {
            volatilityImpact: 0,
            trendImpact: 0,
            newsImpact: 0,
            overallImpact: 0,
            factors: []
        };

        // Volatility impact on overtrading
        if (volatility) {
            if (volatility > 0.6) {
                impact.volatilityImpact = (volatility - 0.6) / 0.4; // Scale 0.6-1.0 to 0-1
                impact.factors.push('Yüksek volatilite overtrading teşvik ediyor');
            }
        }

        // Market trend impact
        if (marketConditions) {
            if (marketConditions.trending === false || marketConditions.direction === 'sideways') {
                impact.trendImpact = 0.6;
                impact.factors.push('Sideways market overtrading riski artırıyor');
            }
            
            if (marketConditions.uncertainty > 0.7) {
                impact.trendImpact += 0.3;
                impact.factors.push('Market belirsizliği');
            }
        }

        // News impact
        if (data.newsFlow && data.newsFlow.frequency > 0.8) {
            impact.newsImpact = 0.4;
            impact.factors.push('Yoğun haber akışı');
        }

        // Overall impact calculation
        impact.overallImpact = (impact.volatilityImpact + impact.trendImpact + impact.newsImpact) / 3;

        return impact;
    }

    analyzeRiskEscalation(data) {
        const { riskMetrics, tradingActivity, positionData } = data;

        const escalation = {
            detected: false,
            level: 'normal',
            patterns: [],
            riskIncreaseRate: 0,
            currentRiskLevel: 0
        };

        if (riskMetrics) {
            escalation.currentRiskLevel = riskMetrics.totalExposure || 0;

            // Historical risk progression
            if (riskMetrics.riskHistory && riskMetrics.riskHistory.length > 0) {
                const recentRisk = riskMetrics.riskHistory.slice(-5); // Last 5 data points
                
                if (recentRisk.length >= 2) {
                    const riskTrend = this.calculateTrend(recentRisk.map(r => r.value));
                    escalation.riskIncreaseRate = riskTrend;

                    if (riskTrend > 0.2) {
                        escalation.detected = true;
                        escalation.patterns.push('consistent_risk_increase');
                        escalation.level = riskTrend > 0.5 ? 'high' : 'moderate';
                    }
                }
            }
        }

        // Position size escalation
        if (tradingActivity) {
            const recentTrades = this.getRecentTrades(tradingActivity, this.analysisWindow);
            const positionSizes = recentTrades.map(t => t.size);
            
            if (positionSizes.length > 3) {
                const sizeTrend = this.calculateTrend(positionSizes);
                
                if (sizeTrend > 0.3) {
                    escalation.detected = true;
                    escalation.patterns.push('position_size_escalation');
                    escalation.level = 'high';
                }
            }
        }

        return escalation;
    }

    assessPerformanceDegradation(data) {
        const { performanceMetrics, tradingActivity } = data;

        const assessment = {
            detected: false,
            severity: 'none',
            metrics: {},
            factors: []
        };

        if (performanceMetrics) {
            // Sharpe ratio degradation
            if (performanceMetrics.sharpeRatio < 0.5) {
                assessment.detected = true;
                assessment.factors.push('Düşük Sharpe ratio');
                assessment.metrics.sharpeRatio = performanceMetrics.sharpeRatio;
            }

            // Win rate degradation
            if (performanceMetrics.winRate < 0.4) {
                assessment.detected = true;
                assessment.factors.push('Düşük kazanma oranı');
                assessment.metrics.winRate = performanceMetrics.winRate;
            }

            // Drawdown assessment
            if (performanceMetrics.currentDrawdown > 0.15) {
                assessment.detected = true;
                assessment.factors.push('Yüksek drawdown');
                assessment.metrics.drawdown = performanceMetrics.currentDrawdown;
                assessment.severity = 'high';
            } else if (performanceMetrics.currentDrawdown > 0.1) {
                assessment.severity = 'moderate';
            }

            // Performance vs market
            if (performanceMetrics.vsMarket < -0.1) {
                assessment.detected = true;
                assessment.factors.push('Market altında performans');
            }
        }

        // Trading efficiency degradation
        if (tradingActivity) {
            const recentTrades = this.getRecentTrades(tradingActivity, this.analysisWindow);
            const efficiency = this.calculateTradingEfficiency(recentTrades);
            
            if (efficiency < 0.3) {
                assessment.detected = true;
                assessment.factors.push('Trading efficiency düşük');
                assessment.metrics.efficiency = efficiency;
            }
        }

        return assessment;
    }

    calculateOverallAssessment(analyses) {
        const {
            tradingPatterns,
            frustrationLevel,
            overtradingIndicators,
            emotionalState,
            revengeTradingSignals,
            lossAversionPatterns,
            marketImpact,
            riskEscalation,
            performanceDegradation
        } = analyses;

        // Weighted scoring
        let overallScore = 0;
        const weights = {
            frustration: 0.25,
            overtrading: 0.2,
            emotional: 0.15,
            revenge: 0.15,
            lossAversion: 0.1,
            riskEscalation: 0.1,
            performance: 0.05
        };

        overallScore += frustrationLevel.score * weights.frustration;
        overallScore += overtradingIndicators.overallScore * weights.overtrading;
        overallScore += emotionalState.riskScore * weights.emotional;
        overallScore += (revengeTradingSignals.detected ? 0.8 : 0) * weights.revenge;
        overallScore += (lossAversionPatterns.detected ? 0.7 : 0) * weights.lossAversion;
        overallScore += (riskEscalation.detected ? 0.8 : 0) * weights.riskEscalation;
        overallScore += (performanceDegradation.detected ? 0.6 : 0) * weights.performance;

        // Market condition amplification
        overallScore *= (1 + marketImpact.overallImpact * 0.3);

        // Risk level classification
        let riskLevel = 'low';
        if (overallScore > 0.8) riskLevel = 'critical';
        else if (overallScore > 0.6) riskLevel = 'high';
        else if (overallScore > 0.4) riskLevel = 'moderate';

        // Primary concerns identification
        const concerns = [];
        if (frustrationLevel.score > 0.6) concerns.push('High frustration');
        if (overtradingIndicators.overallScore > 0.8) concerns.push('Overtrading');
        if (revengeTradingSignals.detected) concerns.push('Revenge trading');
        if (riskEscalation.detected) concerns.push('Risk escalation');

        return {
            score: Math.min(overallScore, 1),
            riskLevel: riskLevel,
            primaryConcerns: concerns,
            components: analyses,
            interventionRequired: overallScore > 0.7,
            urgency: overallScore > 0.8 ? 'immediate' : overallScore > 0.6 ? 'high' : 'normal'
        };
    }

    generateInterventionRecommendations(overallAssessment, data) {
        const recommendations = [];

        if (overallAssessment.riskLevel === 'critical') {
            recommendations.push({
                type: 'immediate_action',
                action: 'Tüm trading aktivitesini durdurun',
                priority: 'urgent',
                timeframe: 'immediate'
            });
        }

        if (overallAssessment.primaryConcerns.includes('High frustration')) {
            recommendations.push({
                type: 'emotional_management',
                action: 'Frustration management teknikleri uygulayın',
                priority: 'high',
                timeframe: '1-2 hours'
            });
        }

        if (overallAssessment.primaryConcerns.includes('Overtrading')) {
            recommendations.push({
                type: 'trading_limits',
                action: 'Günlük trade limitlerini uygulayın',
                priority: 'high',
                timeframe: 'immediate'
            });
        }

        if (overallAssessment.primaryConcerns.includes('Revenge trading')) {
            recommendations.push({
                type: 'behavior_modification',
                action: 'Revenge trading tetikleyicilerini tanımlayın ve önleyin',
                priority: 'high',
                timeframe: 'immediate'
            });
        }

        return recommendations;
    }

    generatePreventiveStrategies(overallAssessment, data) {
        const strategies = [];

        // Position sizing strategies
        strategies.push({
            type: 'position_sizing',
            strategy: 'Maximum position size limitlerini belirleyin',
            effectiveness: 'high'
        });

        // Time-based restrictions
        strategies.push({
            type: 'time_management',
            strategy: 'Trading session sürelerini sınırlayın',
            effectiveness: 'moderate'
        });

        // Emotional awareness
        strategies.push({
            type: 'emotional_awareness',
            strategy: 'Trading öncesi emotional check-in yapın',
            effectiveness: 'high'
        });

        // Performance tracking
        strategies.push({
            type: 'performance_tracking',
            strategy: 'Real-time performance monitoring',
            effectiveness: 'moderate'
        });

        return strategies;
    }

    generateAlerts(overallAssessment, data) {
        const alerts = [];

        if (overallAssessment.score > 0.8) {
            alerts.push({
                level: 'critical',
                message: 'Kritik overtrading riski - acil müdahale gerekli',
                action: 'Trading durdur'
            });
        } else if (overallAssessment.score > 0.6) {
            alerts.push({
                level: 'warning',
                message: 'Yüksek overtrading riski tespit edildi',
                action: 'Dikkatli trading'
            });
        }

        if (overallAssessment.primaryConcerns.includes('Revenge trading')) {
            alerts.push({
                level: 'warning',
                message: 'Revenge trading pattern tespit edildi',
                action: 'Emosioan cooling period'
            });
        }

        return alerts;
    }

    generateNotes(overallAssessment, frustrationLevel) {
        const notes = [];

        notes.push(`Overtrading riski: ${overallAssessment.riskLevel} (${(overallAssessment.score * 100).toFixed(0)}%)`);
        notes.push(`Frustration seviyesi: ${frustrationLevel.level}`);

        if (overallAssessment.primaryConcerns.length > 0) {
            notes.push(`Ana endişeler: ${overallAssessment.primaryConcerns.join(', ')}`);
        }

        if (overallAssessment.interventionRequired) {
            notes.push('Müdahale gerekli');
        }

        return notes.join('. ');
    }

    // Helper methods
    getRecentTrades(tradingActivity, timeWindow) {
        const cutoffTime = Date.now() - timeWindow;
        return tradingActivity.filter(trade => trade.timestamp > cutoffTime);
    }

    detectTradingBursts(trades) {
        const bursts = [];
        const burstThreshold = 3; // 3 trades in short time
        const timeWindow = 10 * 60 * 1000; // 10 minutes

        for (let i = 0; i < trades.length - burstThreshold + 1; i++) {
            const window = trades.slice(i, i + burstThreshold);
            const timespan = window[window.length - 1].timestamp - window[0].timestamp;
            
            if (timespan < timeWindow) {
                bursts.push({
                    startTime: window[0].timestamp,
                    endTime: window[window.length - 1].timestamp,
                    tradeCount: burstThreshold,
                    duration: timespan
                });
            }
        }

        return bursts;
    }

    analyzeTimeDistribution(trades) {
        const distribution = {};
        
        trades.forEach(trade => {
            const hour = new Date(trade.timestamp).getHours();
            distribution[hour] = (distribution[hour] || 0) + 1;
        });

        return distribution;
    }

    calculateConsecutiveActivity(trades) {
        let maxConsecutive = 0;
        let currentConsecutive = 0;
        const maxGap = 30 * 60 * 1000; // 30 minutes

        for (let i = 1; i < trades.length; i++) {
            const gap = trades[i].timestamp - trades[i-1].timestamp;
            
            if (gap < maxGap) {
                currentConsecutive++;
                maxConsecutive = Math.max(maxConsecutive, currentConsecutive);
            } else {
                currentConsecutive = 0;
            }
        }

        return maxConsecutive;
    }

    detectPatternAnomalies(trades, data) {
        const anomalies = [];

        // Unusual trading hours
        const lateNightTrades = trades.filter(t => {
            const hour = new Date(t.timestamp).getHours();
            return hour < 6 || hour > 23;
        });

        if (lateNightTrades.length > trades.length * 0.3) {
            anomalies.push('excessive_late_night_trading');
        }

        // Rapid sequence trading
        const rapidSequences = this.detectTradingBursts(trades);
        if (rapidSequences.length > 3) {
            anomalies.push('multiple_trading_bursts');
        }

        return anomalies;
    }

    compareWithHistoricalPatterns(currentPatterns, historicalData) {
        // Implementation for historical pattern comparison
        return {
            frequencyChange: 0,
            behaviorChange: 'stable',
            riskLevelChange: 'same'
        };
    }

    detectRapidTradingAfterLoss(trades) {
        for (let i = 1; i < trades.length; i++) {
            const current = trades[i];
            const previous = trades[i-1];
            
            if (previous.pnl < 0) {
                const timeDiff = current.timestamp - previous.timestamp;
                if (timeDiff < 2 * 60 * 1000) { // Within 2 minutes
                    return true;
                }
            }
        }
        return false;
    }

    detectPositionSizeEscalation(trades) {
        for (let i = 1; i < trades.length; i++) {
            const current = trades[i];
            const previous = trades[i-1];
            
            if (previous.pnl < 0 && current.size > previous.size * 1.5) {
                return true;
            }
        }
        return false;
    }

    detectIncreasingPositionsAfterLosses(trades, currentIndex) {
        if (currentIndex < 3) return false;
        
        const sequence = trades.slice(currentIndex - 3, currentIndex + 1);
        let increasingAfterLoss = 0;
        
        for (let i = 1; i < sequence.length; i++) {
            if (sequence[i-1].pnl < 0 && sequence[i].size > sequence[i-1].size) {
                increasingAfterLoss++;
            }
        }
        
        return increasingAfterLoss >= 2;
    }

    calculateTrend(values) {
        if (values.length < 2) return 0;
        
        const n = values.length;
        const sumX = (n - 1) * n / 2;
        const sumY = values.reduce((sum, val) => sum + val, 0);
        const sumXY = values.reduce((sum, val, i) => sum + val * i, 0);
        const sumX2 = (n - 1) * n * (2 * n - 1) / 6;
        
        const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
        return slope;
    }

    calculateTradingEfficiency(trades) {
        if (trades.length === 0) return 0;
        
        const profitableTrades = trades.filter(t => t.pnl > 0).length;
        return profitableTrades / trades.length;
    }

    updateAnalysisHistory(result, data) {
        this.tradingHistory.push({
            timestamp: Date.now(),
            overallScore: result.overallAssessment.score,
            riskLevel: result.overallAssessment.riskLevel,
            frustrationLevel: result.frustrationLevel.level,
            interventionRequired: result.overallAssessment.interventionRequired
        });

        this.emotionalStates.push({
            timestamp: Date.now(),
            primary: result.emotionalState.primary,
            intensity: result.emotionalState.intensity,
            volatility: result.emotionalState.volatility
        });

        // Limit history size
        if (this.tradingHistory.length > this.maxHistorySize) {
            this.tradingHistory = this.tradingHistory.slice(-this.maxHistorySize);
        }
        
        if (this.emotionalStates.length > this.maxHistorySize) {
            this.emotionalStates = this.emotionalStates.slice(-this.maxHistorySize);
        }
    }

    getDefaultResult() {
        return {
            overallAssessment: {
                score: 0,
                riskLevel: 'low',
                primaryConcerns: [],
                components: {},
                interventionRequired: false,
                urgency: 'normal'
            },
            tradingPatterns: {
                tradeFrequency: 0,
                sessionLength: 0,
                timeDistribution: {},
                consecutiveActivity: 0,
                tradingBursts: [],
                patternAnomalies: []
            },
            frustrationLevel: {
                score: 0,
                level: 'low',
                indicators: [],
                factors: [],
                consecutive_losses: 0,
                current_drawdown: 0,
                emotional_intensity: 0
            },
            overtradingIndicators: {
                indicators: {},
                overallScore: 0,
                level: 'normal',
                tradesPerHour: 0,
                totalTrades: 0,
                efficiency: 0
            },
            emotionalState: {
                primary: 'neutral',
                intensity: 0.5,
                volatility: 0,
                stability: 0.5,
                factors: [],
                riskScore: 0,
                emotions: {},
                riskLevel: 'low'
            },
            revengeTradingSignals: {
                detected: false,
                strength: 'none',
                patterns: [],
                riskLevel: 'low'
            },
            lossAversionPatterns: {
                detected: false,
                avgHoldTimeLoss: 0,
                avgHoldTimeProfit: 0,
                prematureExits: 0,
                extendedLosses: 0,
                riskLevel: 'low'
            },
            marketImpact: {
                volatilityImpact: 0,
                trendImpact: 0,
                newsImpact: 0,
                overallImpact: 0,
                factors: []
            },
            riskEscalation: {
                detected: false,
                level: 'normal',
                patterns: [],
                riskIncreaseRate: 0,
                currentRiskLevel: 0
            },
            performanceDegradation: {
                detected: false,
                severity: 'none',
                metrics: {},
                factors: []
            },
            interventionRecommendations: [],
            preventiveStrategies: [],
            alerts: [],
            notes: "Frustration driven overtrader analizi yapılamadı - yetersiz veri",
            metadata: {
                error: true,
                analysisTimestamp: Date.now()
            }
        };
    }

    getModuleInfo() {
        return {
            name: 'FrustrationDrivenOvertrader',
            version: '1.0.0',
            description: 'Trader frustration ve overtrading pattern detection - emotional trading patterns, revenge trading ve loss aversion analizi',
            inputs: [
                'symbol', 'price', 'volume', 'tradingActivity', 'userTradingHistory',
                'marketConditions', 'volatility', 'newsFlow', 'sentimentData', 'timeframe',
                'positionData', 'accountMetrics', 'behavioralSignals', 'marketPsychology',
                'performanceMetrics', 'riskMetrics', 'emotionalIndicators'
            ],
            outputs: [
                'overallAssessment', 'tradingPatterns', 'frustrationLevel', 'overtradingIndicators',
                'emotionalState', 'revengeTradingSignals', 'lossAversionPatterns', 'marketImpact',
                'riskEscalation', 'performanceDegradation', 'interventionRecommendations',
                'preventiveStrategies', 'alerts', 'notes', 'metadata'
            ]
        };
    }
}

module.exports = FrustrationDrivenOvertrader;
