const GrafikBeyniModuleBase = require('./grafikBeyniModuleBase');

/**
 * Adaptive Scenario Builder Module
 * Market scenario modeling and adaptive strategy selection
 * Piyasa koşullarına göre senaryo kurgusu ve strateji adaptasyonu
 */
class AdaptiveScenarioBuilder extends GrafikBeyniModuleBase {
    constructor() {
        super('adaptiveScenarioBuilder');
        this.scenarioHistory = [];
        this.marketRegimes = {
            trending: { bull: [], bear: [] },
            ranging: { high: [], low: [] },
            volatile: { breakout: [], breakdown: [] },
            reversal: { bottom: [], top: [] }
        };
        this.adaptationThresholds = {
            regimeChange: 0.7,
            confidence: 0.6,
            volatility: 2.0,
            volume: 1.5
        };
        this.maxScenarioHistory = 100;
        this.scenarioWeights = {
            current: 0.4,
            recent: 0.3,
            historical: 0.2,
            forward: 0.1
        };
    }

    async analyze(data) {
        try {
            const {
                price,
                volume,
                volatility,
                trend,
                support,
                resistance,
                patterns,
                indicators,
                timeframe,
                marketStructure,
                sentiment,
                correlations,
                seasonality,
                newsImpact,
                liquidityLevels,
                orderBookDepth
            } = data;

            // Veri doğrulama
            if (!price || !volume) {
                throw new Error('Missing required price and volume data for scenario building');
            }

            // Current market regime identification
            const currentRegime = this.identifyMarketRegime(data);

            // Scenario construction
            const scenarios = this.buildMarketScenarios(data, currentRegime);

            // Probability assessment
            const probabilities = this.calculateScenarioProbabilities(scenarios, data);

            // Strategy adaptation recommendations
            const adaptations = this.generateStrategyAdaptations(scenarios, probabilities, currentRegime);

            // Risk scenario modeling
            const riskScenarios = this.buildRiskScenarios(data, scenarios);

            // Opportunity scenario modeling
            const opportunityScenarios = this.buildOpportunityScenarios(data, scenarios);

            // Adaptive parameter suggestions
            const adaptiveParameters = this.suggestAdaptiveParameters(scenarios, probabilities);

            // Trigger conditions for scenario switches
            const triggerConditions = this.defineTriggerConditions(scenarios, data);

            // Forward-looking scenario projection
            const forwardProjection = this.projectForwardScenarios(scenarios, data);

            // Adaptive decision framework
            const decisionFramework = this.buildDecisionFramework(scenarios, adaptations);

            const result = {
                currentRegime: currentRegime,
                scenarios: scenarios,
                probabilities: probabilities,
                adaptations: adaptations,
                riskScenarios: riskScenarios,
                opportunityScenarios: opportunityScenarios,
                adaptiveParameters: adaptiveParameters,
                triggerConditions: triggerConditions,
                forwardProjection: forwardProjection,
                decisionFramework: decisionFramework,
                recommendations: this.generateRecommendations(scenarios, adaptations, data),
                notes: this.generateNotes(currentRegime, scenarios, adaptations),
                metadata: {
                    analysisTimestamp: Date.now(),
                    timeframe: timeframe,
                    regimeStability: this.calculateRegimeStability(currentRegime),
                    adaptationConfidence: this.calculateAdaptationConfidence(adaptations),
                    scenarioCount: scenarios.length,
                    dominantScenario: this.findDominantScenario(scenarios, probabilities)
                }
            };

            // Scenario history güncelleme
            this.updateScenarioHistory(result, data);

            // Market regime tracking
            this.updateMarketRegimes(currentRegime, data);

            // Cache ve performance tracking
            this.updateCache(data, result);
            this.trackPerformance(Date.now(), scenarios.length > 0);

            return result;

        } catch (error) {
            this.handleError('AdaptiveScenarioBuilder analysis failed', error, data);
            return this.getDefaultResult();
        }
    }

    identifyMarketRegime(data) {
        const {
            price,
            volume,
            volatility,
            trend,
            patterns,
            indicators,
            marketStructure
        } = data;

        let regimeScore = {};
        const factors = [];

        // Trend analysis için regime
        if (trend) {
            if (trend.direction === 'uptrend' && trend.strength > 0.6) {
                regimeScore.trending_bull = (regimeScore.trending_bull || 0) + 3;
                factors.push('strong_bull_trend');
            } else if (trend.direction === 'downtrend' && trend.strength > 0.6) {
                regimeScore.trending_bear = (regimeScore.trending_bear || 0) + 3;
                factors.push('strong_bear_trend');
            } else if (trend.direction === 'sideways') {
                regimeScore.ranging = (regimeScore.ranging || 0) + 2;
                factors.push('sideways_movement');
            }
        }

        // Volatility analysis
        if (volatility !== undefined) {
            if (volatility > this.adaptationThresholds.volatility) {
                regimeScore.volatile = (regimeScore.volatile || 0) + 2;
                factors.push('high_volatility');
            } else if (volatility < 0.5) {
                regimeScore.ranging = (regimeScore.ranging || 0) + 1;
                factors.push('low_volatility');
            }
        }

        // Volume analysis
        if (volume && data.averageVolume) {
            const volumeRatio = volume / data.averageVolume;
            if (volumeRatio > this.adaptationThresholds.volume) {
                regimeScore.breakout = (regimeScore.breakout || 0) + 1.5;
                factors.push('high_volume');
            } else if (volumeRatio < 0.7) {
                regimeScore.ranging = (regimeScore.ranging || 0) + 1;
                factors.push('low_volume');
            }
        }

        // Pattern analysis
        if (patterns && patterns.length > 0) {
            patterns.forEach(pattern => {
                if (pattern.type === 'reversal') {
                    regimeScore.reversal = (regimeScore.reversal || 0) + pattern.confidence;
                    factors.push(`reversal_pattern_${pattern.name}`);
                } else if (pattern.type === 'continuation') {
                    regimeScore.trending = (regimeScore.trending || 0) + pattern.confidence;
                    factors.push(`continuation_pattern_${pattern.name}`);
                } else if (pattern.type === 'breakout') {
                    regimeScore.volatile = (regimeScore.volatile || 0) + pattern.confidence;
                    factors.push(`breakout_pattern_${pattern.name}`);
                }
            });
        }

        // Support/Resistance analysis
        if (data.support && data.resistance) {
            const supportDistance = Math.abs(price - data.support) / price;
            const resistanceDistance = Math.abs(price - data.resistance) / price;
            
            if (supportDistance < 0.01 || resistanceDistance < 0.01) {
                regimeScore.ranging = (regimeScore.ranging || 0) + 1.5;
                factors.push('near_support_resistance');
            }
        }

        // Market structure analysis
        if (marketStructure) {
            if (marketStructure.phase === 'accumulation') {
                regimeScore.ranging = (regimeScore.ranging || 0) + 1;
                factors.push('accumulation_phase');
            } else if (marketStructure.phase === 'distribution') {
                regimeScore.ranging = (regimeScore.ranging || 0) + 1;
                factors.push('distribution_phase');
            } else if (marketStructure.phase === 'markup') {
                regimeScore.trending_bull = (regimeScore.trending_bull || 0) + 2;
                factors.push('markup_phase');
            } else if (marketStructure.phase === 'markdown') {
                regimeScore.trending_bear = (regimeScore.trending_bear || 0) + 2;
                factors.push('markdown_phase');
            }
        }

        // Dominant regime belirleme
        const dominantRegime = Object.keys(regimeScore).reduce((a, b) => 
            regimeScore[a] > regimeScore[b] ? a : b
        );

        const confidence = regimeScore[dominantRegime] / 
                          Object.values(regimeScore).reduce((sum, score) => sum + score, 0);

        return {
            regime: dominantRegime,
            confidence: confidence,
            scores: regimeScore,
            factors: factors,
            stability: this.calculateRegimeStability(dominantRegime)
        };
    }

    buildMarketScenarios(data, currentRegime) {
        const scenarios = [];

        // Base scenario (current conditions continue)
        scenarios.push(this.buildBaseScenario(data, currentRegime));

        // Trend continuation scenarios
        if (currentRegime.regime.includes('trending')) {
            scenarios.push(this.buildTrendContinuationScenario(data, currentRegime));
            scenarios.push(this.buildTrendAccelerationScenario(data, currentRegime));
        }

        // Trend reversal scenarios
        scenarios.push(this.buildTrendReversalScenario(data, currentRegime));

        // Breakout scenarios
        if (currentRegime.regime === 'ranging' || data.support || data.resistance) {
            scenarios.push(this.buildBreakoutScenario(data, 'upward'));
            scenarios.push(this.buildBreakoutScenario(data, 'downward'));
        }

        // Volatility scenarios
        scenarios.push(this.buildVolatilityScenario(data, 'spike'));
        scenarios.push(this.buildVolatilityScenario(data, 'compression'));

        // Range scenarios
        if (data.support && data.resistance) {
            scenarios.push(this.buildRangeScenario(data));
        }

        // News impact scenarios
        if (data.newsImpact) {
            scenarios.push(this.buildNewsImpactScenario(data, 'positive'));
            scenarios.push(this.buildNewsImpactScenario(data, 'negative'));
        }

        // Liquidity scenarios
        if (data.liquidityLevels) {
            scenarios.push(this.buildLiquidityScenario(data, 'high'));
            scenarios.push(this.buildLiquidityScenario(data, 'low'));
        }

        return scenarios.map((scenario, index) => ({
            ...scenario,
            id: `scenario_${index + 1}`,
            timestamp: Date.now()
        }));
    }

    buildBaseScenario(data, currentRegime) {
        return {
            name: 'base_continuation',
            description: 'Mevcut piyasa koşulları devam ediyor',
            type: 'continuation',
            regime: currentRegime.regime,
            conditions: {
                priceDirection: 'sideways',
                volatilityChange: 'stable',
                volumeChange: 'normal',
                trendStrength: 'unchanged'
            },
            implications: {
                strategy: 'maintain_current',
                riskLevel: 'moderate',
                timeHorizon: 'short_term',
                confidence: currentRegime.confidence
            },
            triggers: [
                'no_significant_volume_change',
                'no_major_breakouts',
                'stable_indicators'
            ]
        };
    }

    buildTrendContinuationScenario(data, currentRegime) {
        const isBull = currentRegime.regime.includes('bull');
        
        return {
            name: 'trend_continuation',
            description: `${isBull ? 'Yükseliş' : 'Düşüş'} trendi güçlenerek devam ediyor`,
            type: 'continuation',
            regime: currentRegime.regime,
            conditions: {
                priceDirection: isBull ? 'upward' : 'downward',
                volatilityChange: 'moderate_increase',
                volumeChange: 'increase',
                trendStrength: 'strengthening'
            },
            implications: {
                strategy: 'trend_following',
                riskLevel: 'low_to_moderate',
                timeHorizon: 'medium_term',
                confidence: 0.7
            },
            triggers: [
                'volume_confirmation',
                'momentum_acceleration',
                'support_resistance_respect'
            ]
        };
    }

    buildTrendReversalScenario(data, currentRegime) {
        const currentDirection = currentRegime.regime.includes('bull') ? 'bull' : 'bear';
        const oppositeDirection = currentDirection === 'bull' ? 'bear' : 'bull';
        
        return {
            name: 'trend_reversal',
            description: `${currentDirection === 'bull' ? 'Yükseliş' : 'Düşüş'} trendi tersine dönüyor`,
            type: 'reversal',
            regime: `trending_${oppositeDirection}`,
            conditions: {
                priceDirection: oppositeDirection === 'bull' ? 'upward' : 'downward',
                volatilityChange: 'increase',
                volumeChange: 'significant_increase',
                trendStrength: 'weakening_then_reversing'
            },
            implications: {
                strategy: 'reversal_trading',
                riskLevel: 'high',
                timeHorizon: 'medium_term',
                confidence: 0.4
            },
            triggers: [
                'divergence_signals',
                'support_resistance_break',
                'momentum_reversal',
                'pattern_reversal_confirmation'
            ]
        };
    }

    buildBreakoutScenario(data, direction) {
        return {
            name: `breakout_${direction}`,
            description: `${direction === 'upward' ? 'Yukarı' : 'Aşağı'} yönlü breakout`,
            type: 'breakout',
            regime: 'volatile',
            conditions: {
                priceDirection: direction,
                volatilityChange: 'sharp_increase',
                volumeChange: 'explosion',
                trendStrength: 'emerging'
            },
            implications: {
                strategy: 'breakout_trading',
                riskLevel: 'high',
                timeHorizon: 'short_to_medium',
                confidence: 0.6
            },
            triggers: [
                `${direction === 'upward' ? 'resistance' : 'support'}_break`,
                'volume_spike',
                'momentum_surge',
                'pattern_completion'
            ]
        };
    }

    buildVolatilityScenario(data, type) {
        return {
            name: `volatility_${type}`,
            description: type === 'spike' ? 'Volatilite artışı' : 'Volatilite sıkışması',
            type: 'volatility',
            regime: type === 'spike' ? 'volatile' : 'ranging',
            conditions: {
                priceDirection: type === 'spike' ? 'erratic' : 'narrow',
                volatilityChange: type === 'spike' ? 'explosion' : 'compression',
                volumeChange: type === 'spike' ? 'increase' : 'decrease',
                trendStrength: type === 'spike' ? 'chaotic' : 'weak'
            },
            implications: {
                strategy: type === 'spike' ? 'risk_management' : 'range_trading',
                riskLevel: type === 'spike' ? 'very_high' : 'low',
                timeHorizon: 'short_term',
                confidence: 0.5
            },
            triggers: type === 'spike' ? [
                'news_events',
                'liquidity_crisis',
                'market_shock'
            ] : [
                'low_volume',
                'narrow_range',
                'decreasing_volatility'
            ]
        };
    }

    calculateScenarioProbabilities(scenarios, data) {
        const probabilities = {};
        
        scenarios.forEach(scenario => {
            let probability = 0.1; // Base probability
            
            // Current regime alignment
            if (scenario.regime === data.currentRegime?.regime) {
                probability += 0.3;
            }
            
            // Historical pattern matching
            const historicalMatch = this.calculateHistoricalMatch(scenario, data);
            probability += historicalMatch * 0.2;
            
            // Indicator alignment
            const indicatorAlignment = this.calculateIndicatorAlignment(scenario, data);
            probability += indicatorAlignment * 0.2;
            
            // Volume confirmation
            if (scenario.conditions.volumeChange === 'increase' && data.volume > data.averageVolume) {
                probability += 0.1;
            }
            
            // Pattern confirmation
            if (data.patterns) {
                const patternConfirmation = this.calculatePatternConfirmation(scenario, data.patterns);
                probability += patternConfirmation * 0.1;
            }
            
            // News impact
            if (data.newsImpact && scenario.triggers.includes('news_events')) {
                probability += data.newsImpact.intensity * 0.1;
            }
            
            probabilities[scenario.id] = Math.min(0.9, Math.max(0.05, probability));
        });
        
        // Normalize probabilities
        const total = Object.values(probabilities).reduce((sum, prob) => sum + prob, 0);
        Object.keys(probabilities).forEach(key => {
            probabilities[key] = probabilities[key] / total;
        });
        
        return probabilities;
    }

    generateStrategyAdaptations(scenarios, probabilities, currentRegime) {
        const adaptations = {
            primary: null,
            secondary: [],
            parameters: {},
            riskAdjustments: {},
            timeHorizonChanges: {}
        };

        // Dominant scenario belirleme
        const dominantScenarioId = Object.keys(probabilities).reduce((a, b) => 
            probabilities[a] > probabilities[b] ? a : b
        );
        const dominantScenario = scenarios.find(s => s.id === dominantScenarioId);

        // Primary adaptation
        adaptations.primary = {
            scenario: dominantScenario.name,
            strategy: dominantScenario.implications.strategy,
            confidence: probabilities[dominantScenarioId],
            reasoning: this.getAdaptationReasoning(dominantScenario, probabilities[dominantScenarioId])
        };

        // Secondary adaptations (high probability scenarios)
        Object.entries(probabilities)
            .filter(([id, prob]) => id !== dominantScenarioId && prob > 0.15)
            .forEach(([id, prob]) => {
                const scenario = scenarios.find(s => s.id === id);
                adaptations.secondary.push({
                    scenario: scenario.name,
                    strategy: scenario.implications.strategy,
                    probability: prob,
                    backup: true
                });
            });

        // Parameter adaptations
        adaptations.parameters = this.calculateParameterAdaptations(dominantScenario, probabilities);

        // Risk adjustments
        adaptations.riskAdjustments = this.calculateRiskAdjustments(scenarios, probabilities);

        // Time horizon changes
        adaptations.timeHorizonChanges = this.calculateTimeHorizonChanges(dominantScenario);

        return adaptations;
    }

    buildDecisionFramework(scenarios, adaptations) {
        return {
            primaryDecision: {
                action: this.getPrimaryAction(adaptations.primary),
                confidence: adaptations.primary.confidence,
                timeframe: adaptations.primary.scenario.implications?.timeHorizon
            },
            contingencyPlans: adaptations.secondary.map(sec => ({
                trigger: sec.scenario,
                action: this.getContingencyAction(sec),
                activation: sec.probability
            })),
            monitoringPoints: this.defineMonitoringPoints(scenarios),
            adaptationTriggers: this.defineAdaptationTriggers(scenarios),
            exitConditions: this.defineExitConditions(scenarios, adaptations)
        };
    }

    generateRecommendations(scenarios, adaptations, data) {
        const recommendations = {};

        // VIVO signal routing recommendations
        recommendations.vivo = {
            priorityDirection: adaptations.primary.strategy,
            signalFiltering: this.getSignalFilteringRecommendations(adaptations),
            confidenceThreshold: Math.max(0.6, adaptations.primary.confidence)
        };

        // Strategy manager recommendations
        recommendations.strategiesManager = {
            primaryStrategy: adaptations.primary.strategy,
            backupStrategies: adaptations.secondary.map(s => s.strategy),
            parameterAdjustments: adaptations.parameters,
            riskProfile: this.getRiskProfileRecommendation(adaptations)
        };

        // Risk management recommendations
        recommendations.riskManagement = {
            adjustments: adaptations.riskAdjustments,
            maxRisk: this.calculateMaxRiskRecommendation(adaptations),
            stopLossAdjustment: this.getStopLossAdjustmentRecommendation(adaptations)
        };

        // Entry gatekeeper recommendations
        recommendations.entryGatekeeper = {
            validationLevel: this.getValidationLevelRecommendation(adaptations),
            requiredConfirmations: this.getRequiredConfirmationsRecommendation(adaptations)
        };

        return recommendations;
    }

    generateNotes(currentRegime, scenarios, adaptations) {
        const notes = [];

        // Current regime note
        notes.push(`Piyasa rejimi: ${currentRegime.regime} (Güven: ${(currentRegime.confidence * 100).toFixed(0)}%)`);

        // Primary adaptation note
        if (adaptations.primary) {
            notes.push(`Ana strateji: ${adaptations.primary.strategy} (${(adaptations.primary.confidence * 100).toFixed(0)}% olasılık)`);
        }

        // Scenario count note
        notes.push(`${scenarios.length} senaryo analiz edildi`);

        // Risk level note
        const highRiskScenarios = scenarios.filter(s => s.implications.riskLevel === 'high' || s.implications.riskLevel === 'very_high');
        if (highRiskScenarios.length > 0) {
            notes.push(`${highRiskScenarios.length} yüksek riskli senaryo tespit edildi`);
        }

        return notes.join('. ');
    }

    updateScenarioHistory(result, data) {
        this.scenarioHistory.push({
            timestamp: Date.now(),
            regime: result.currentRegime.regime,
            scenarioCount: result.scenarios.length,
            primaryStrategy: result.adaptations.primary?.strategy,
            confidence: result.adaptations.primary?.confidence,
            timeframe: data.timeframe
        });

        if (this.scenarioHistory.length > this.maxScenarioHistory) {
            this.scenarioHistory = this.scenarioHistory.slice(-this.maxScenarioHistory);
        }
    }

    updateMarketRegimes(currentRegime, data) {
        const regimeType = currentRegime.regime;
        const regimeData = {
            timestamp: Date.now(),
            confidence: currentRegime.confidence,
            factors: currentRegime.factors,
            price: data.price,
            volume: data.volume,
            volatility: data.volatility
        };

        // Store regime data in appropriate category
        if (regimeType.includes('trending_bull')) {
            this.marketRegimes.trending.bull.push(regimeData);
        } else if (regimeType.includes('trending_bear')) {
            this.marketRegimes.trending.bear.push(regimeData);
        } else if (regimeType === 'ranging') {
            if (data.volatility > 1) {
                this.marketRegimes.ranging.high.push(regimeData);
            } else {
                this.marketRegimes.ranging.low.push(regimeData);
            }
        } else if (regimeType === 'volatile') {
            if (data.volume > data.averageVolume * 1.5) {
                this.marketRegimes.volatile.breakout.push(regimeData);
            } else {
                this.marketRegimes.volatile.breakdown.push(regimeData);
            }
        } else if (regimeType.includes('reversal')) {
            if (regimeType.includes('bottom')) {
                this.marketRegimes.reversal.bottom.push(regimeData);
            } else {
                this.marketRegimes.reversal.top.push(regimeData);
            }
        }

        // Limit history size for each regime
        Object.keys(this.marketRegimes).forEach(category => {
            Object.keys(this.marketRegimes[category]).forEach(subcategory => {
                if (this.marketRegimes[category][subcategory].length > 50) {
                    this.marketRegimes[category][subcategory] = 
                        this.marketRegimes[category][subcategory].slice(-50);
                }
            });
        });
    }

    // Helper methods
    calculateRegimeStability(currentRegime) {
        if (this.scenarioHistory.length < 5) return 0.5;

        const recentRegimes = this.scenarioHistory.slice(-10).map(h => h.regime);
        const stability = recentRegimes.filter(r => r === currentRegime).length / recentRegimes.length;
        
        return stability;
    }

    getDefaultResult() {
        return {
            currentRegime: {
                regime: 'unknown',
                confidence: 0.5,
                scores: {},
                factors: [],
                stability: 0
            },
            scenarios: [],
            probabilities: {},
            adaptations: {
                primary: null,
                secondary: [],
                parameters: {},
                riskAdjustments: {},
                timeHorizonChanges: {}
            },
            riskScenarios: [],
            opportunityScenarios: [],
            adaptiveParameters: {},
            triggerConditions: [],
            forwardProjection: null,
            decisionFramework: null,
            recommendations: {},
            notes: "Adaptive scenario builder analizi yapılamadı - yetersiz veri",
            metadata: {
                error: true,
                analysisTimestamp: Date.now()
            }
        };
    }

    getModuleInfo() {
        return {
            name: 'AdaptiveScenarioBuilder',
            version: '1.0.0',
            description: 'Market scenario modeling ve adaptive strategy selection',
            inputs: [
                'price', 'volume', 'volatility', 'trend', 'support', 'resistance',
                'patterns', 'indicators', 'timeframe', 'marketStructure', 'sentiment',
                'correlations', 'seasonality', 'newsImpact', 'liquidityLevels', 'orderBookDepth'
            ],
            outputs: [
                'currentRegime', 'scenarios', 'probabilities', 'adaptations',
                'riskScenarios', 'opportunityScenarios', 'adaptiveParameters',
                'triggerConditions', 'forwardProjection', 'decisionFramework',
                'recommendations', 'notes', 'metadata'
            ]
        };
    }
}

module.exports = AdaptiveScenarioBuilder;
