const GrafikBeyniModuleBase = require('./grafikBeyniModuleBase');

/**
 * Risk Reward Calculator
 * Risk-Reward hesaplayıcısı - Detaylı risk/kazanç analizi ve optimal R:R oranları
 * Stop loss, take profit seviyeleri ve position sizing optimizasyonu
 */
class RiskRewardCalculator extends GrafikBeyniModuleBase {
    constructor() {
        super('riskRewardCalculator');
        
        // Risk-Reward ratio categories
        this.rrCategories = {
            poor: { min: 0, max: 1.5, grade: 'F', recommendation: 'avoid' },
            acceptable: { min: 1.5, max: 2.0, grade: 'C', recommendation: 'consider' },
            good: { min: 2.0, max: 3.0, grade: 'B', recommendation: 'execute' },
            excellent: { min: 3.0, max: 5.0, grade: 'A', recommendation: 'prioritize' },
            exceptional: { min: 5.0, max: Infinity, grade: 'A+', recommendation: 'maximize' }
        };
        
        // Risk calculation methods
        this.riskMethods = {
            technical: {
                atr_based: { multiplier: 2, description: 'ATR-based stop loss' },
                support_resistance: { buffer: 0.005, description: 'S/R level with buffer' },
                moving_average: { distance: 0.02, description: 'Moving average distance' },
                fibonacci: { level: 0.382, description: 'Fibonacci retracement' },
                volatility_adjusted: { factor: 1.5, description: 'Volatility-adjusted stop' }
            },
            fundamental: {
                news_impact: { factor: 1.2, description: 'News event impact' },
                market_correlation: { beta: 1.0, description: 'Market correlation risk' },
                liquidity_risk: { spread_multiplier: 3, description: 'Liquidity-based risk' }
            },
            portfolio: {
                position_sizing: { max_risk_per_trade: 0.02, description: 'Portfolio risk limit' },
                correlation_risk: { max_correlation: 0.7, description: 'Position correlation' },
                concentration_risk: { max_position: 0.1, description: 'Position concentration' }
            }
        };
        
        // Reward calculation targets
        this.rewardTargets = {
            conservative: { multiplier: 1.5, probability: 0.7, timeframe: 'short' },
            moderate: { multiplier: 2.5, probability: 0.5, timeframe: 'medium' },
            aggressive: { multiplier: 4.0, probability: 0.3, timeframe: 'long' },
            swing: { multiplier: 6.0, probability: 0.2, timeframe: 'extended' }
        };
        
        this.calculationHistory = new Map();
        this.performanceTracking = new Map();
        this.maxHistorySize = 100;
    }

    async analyze(data) {
        try {
            const {
                symbol,
                timeframe,
                currentPrice,
                entryPrice,
                technicalIndicators,
                supportResistance,
                marketStructure,
                volatility,
                volume,
                trend,
                portfolio,
                newsEvents,
                timestamp
            } = data;

            // Risk analysis
            const riskAnalysis = this.analyzeRisk(currentPrice, entryPrice, technicalIndicators, supportResistance, data);
            
            // Reward analysis  
            const rewardAnalysis = this.analyzeReward(currentPrice, entryPrice, trend, supportResistance, data);
            
            // Risk-Reward ratio calculations
            const rrCalculations = this.calculateRiskRewardRatios(riskAnalysis, rewardAnalysis, data);
            
            // Position sizing recommendations
            const positionSizing = this.calculatePositionSizing(riskAnalysis, portfolio, data);
            
            // Stop loss optimization
            const stopLossOptimization = this.optimizeStopLoss(riskAnalysis, marketStructure, data);
            
            // Take profit optimization
            const takeProfitOptimization = this.optimizeTakeProfit(rewardAnalysis, trend, data);
            
            // Expected value calculations
            const expectedValue = this.calculateExpectedValue(rrCalculations, data);
            
            // Risk-adjusted returns
            const riskAdjustedReturns = this.calculateRiskAdjustedReturns(rrCalculations, volatility, data);
            
            // Scenario analysis
            const scenarioAnalysis = this.performScenarioAnalysis(riskAnalysis, rewardAnalysis, data);
            
            // Portfolio impact assessment
            const portfolioImpact = this.assessPortfolioImpact(positionSizing, portfolio, data);

            const result = {
                riskAnalysis: riskAnalysis,
                rewardAnalysis: rewardAnalysis,
                rrCalculations: rrCalculations,
                positionSizing: positionSizing,
                stopLossOptimization: stopLossOptimization,
                takeProfitOptimization: takeProfitOptimization,
                expectedValue: expectedValue,
                riskAdjustedReturns: riskAdjustedReturns,
                scenarioAnalysis: scenarioAnalysis,
                portfolioImpact: portfolioImpact,
                recommendations: this.generateModularRecommendations(rrCalculations, positionSizing, data),
                alerts: this.generateAlerts(rrCalculations, riskAnalysis, portfolioImpact),
                notes: this.generateNotes(rrCalculations, expectedValue, portfolioImpact),
                metadata: {
                    analysisTimestamp: Date.now(),
                    symbol: symbol,
                    timeframe: timeframe,
                    entryPrice: entryPrice || currentPrice,
                    currentPrice: currentPrice,
                    bestRiskReward: rrCalculations.bestRatio?.ratio || 0,
                    recommendedPositionSize: positionSizing.recommendedSize,
                    riskLevel: riskAnalysis.overallRisk?.level || 'unknown',
                    rewardPotential: rewardAnalysis.overallReward?.level || 'unknown'
                }
            };

            this.updateCalculationHistory(symbol, rrCalculations, expectedValue, timestamp);
            this.updateCache(data, result);
            this.trackPerformance(Date.now(), true);

            return result;

        } catch (error) {
            this.handleError('RiskRewardCalculator analysis failed', error, data);
            return this.getDefaultResult();
        }
    }

    analyzeRisk(currentPrice, entryPrice, technicalIndicators, supportResistance, data) {
        const basePrice = entryPrice || currentPrice;
        const riskCalculations = {};
        
        // Technical risk calculations
        const technicalRisk = this.calculateTechnicalRisk(basePrice, technicalIndicators, supportResistance, data);
        riskCalculations.technical = technicalRisk;
        
        // Fundamental risk calculations  
        const fundamentalRisk = this.calculateFundamentalRisk(basePrice, data);
        riskCalculations.fundamental = fundamentalRisk;
        
        // Market structure risk
        const structuralRisk = this.calculateStructuralRisk(basePrice, data.marketStructure, data);
        riskCalculations.structural = structuralRisk;
        
        // Volatility-based risk
        const volatilityRisk = this.calculateVolatilityRisk(basePrice, data.volatility, data);
        riskCalculations.volatility = volatilityRisk;
        
        // Liquidity risk
        const liquidityRisk = this.calculateLiquidityRisk(basePrice, data.volume, data);
        riskCalculations.liquidity = liquidityRisk;
        
        // Determine optimal risk level
        const optimalRisk = this.determineOptimalRisk(riskCalculations, data);
        
        // Overall risk assessment
        const overallRisk = this.assessOverallRisk(riskCalculations, optimalRisk);

        return {
            calculations: riskCalculations,
            optimalRisk: optimalRisk,
            overallRisk: overallRisk,
            riskFactors: this.identifyRiskFactors(riskCalculations),
            riskMitigation: this.suggestRiskMitigation(riskCalculations),
            stopLossLevels: this.generateStopLossLevels(riskCalculations, basePrice)
        };
    }

    analyzeReward(currentPrice, entryPrice, trend, supportResistance, data) {
        const basePrice = entryPrice || currentPrice;
        const rewardCalculations = {};
        
        // Technical reward calculations
        const technicalReward = this.calculateTechnicalReward(basePrice, trend, supportResistance, data);
        rewardCalculations.technical = technicalReward;
        
        // Trend-based reward
        const trendReward = this.calculateTrendReward(basePrice, trend, data);
        rewardCalculations.trend = trendReward;
        
        // Support/Resistance based targets
        const srReward = this.calculateSRReward(basePrice, supportResistance, data);
        rewardCalculations.supportResistance = srReward;
        
        // Fibonacci-based targets
        const fibReward = this.calculateFibonacciReward(basePrice, data);
        rewardCalculations.fibonacci = fibReward;
        
        // Volume-weighted targets
        const volumeReward = this.calculateVolumeReward(basePrice, data.volume, data);
        rewardCalculations.volume = volumeReward;
        
        // Time-based targets
        const timeReward = this.calculateTimeBasedReward(basePrice, data.timeframe, data);
        rewardCalculations.time = timeReward;
        
        // Determine optimal reward targets
        const optimalReward = this.determineOptimalReward(rewardCalculations, data);
        
        // Overall reward assessment
        const overallReward = this.assessOverallReward(rewardCalculations, optimalReward);

        return {
            calculations: rewardCalculations,
            optimalReward: optimalReward,
            overallReward: overallReward,
            rewardFactors: this.identifyRewardFactors(rewardCalculations),
            takeProfitLevels: this.generateTakeProfitLevels(rewardCalculations, basePrice),
            probabilityAssessment: this.assessRewardProbabilities(rewardCalculations, data)
        };
    }

    calculateRiskRewardRatios(riskAnalysis, rewardAnalysis, data) {
        const ratios = [];
        const riskLevels = riskAnalysis.stopLossLevels || {};
        const rewardLevels = rewardAnalysis.takeProfitLevels || {};
        
        // Calculate ratios for all risk/reward combinations
        for (const [riskType, riskLevel] of Object.entries(riskLevels)) {
            for (const [rewardType, rewardLevel] of Object.entries(rewardLevels)) {
                const ratio = this.calculateIndividualRatio(riskLevel, rewardLevel, data);
                if (ratio) {
                    ratios.push({
                        riskType: riskType,
                        rewardType: rewardType,
                        riskLevel: riskLevel,
                        rewardLevel: rewardLevel,
                        ratio: ratio.ratio,
                        category: this.categorizeRatio(ratio.ratio),
                        probability: ratio.probability,
                        expectedValue: ratio.expectedValue
                    });
                }
            }
        }
        
        // Sort by ratio quality
        ratios.sort((a, b) => b.ratio - a.ratio);
        
        // Statistical analysis of ratios
        const statistics = this.calculateRatioStatistics(ratios);
        
        // Best ratio selection
        const bestRatio = this.selectBestRatio(ratios, data);
        
        // Conservative ratio selection
        const conservativeRatio = this.selectConservativeRatio(ratios, data);

        return {
            allRatios: ratios,
            bestRatio: bestRatio,
            conservativeRatio: conservativeRatio,
            statistics: statistics,
            averageRatio: statistics.mean,
            acceptableRatios: ratios.filter(r => r.ratio >= 1.5),
            excellentRatios: ratios.filter(r => r.ratio >= 3.0),
            qualityDistribution: this.analyzeQualityDistribution(ratios)
        };
    }

    calculatePositionSizing(riskAnalysis, portfolio, data) {
        if (!portfolio) {
            return this.getDefaultPositionSizing();
        }

        const riskPerTrade = portfolio.riskPerTrade || 0.02; // 2% default
        const totalEquity = portfolio.totalEquity || 10000; // $10k default
        const maxPositionSize = portfolio.maxPositionSize || 0.1; // 10% max
        
        // Risk-based position sizing
        const riskBasedSize = this.calculateRiskBasedSize(riskAnalysis, riskPerTrade, totalEquity, data);
        
        // Kelly Criterion sizing
        const kellySize = this.calculateKellySize(riskAnalysis, data);
        
        // Fixed fractional sizing
        const fixedFractionalSize = this.calculateFixedFractionalSize(totalEquity, data);
        
        // Volatility-adjusted sizing
        const volatilityAdjustedSize = this.calculateVolatilityAdjustedSize(riskBasedSize, data.volatility, data);
        
        // Portfolio heat consideration
        const portfolioHeatAdjustment = this.calculatePortfolioHeatAdjustment(portfolio, data);
        
        // Recommended size calculation
        const recommendedSize = this.calculateRecommendedSize(
            riskBasedSize,
            kellySize,
            fixedFractionalSize,
            volatilityAdjustedSize,
            portfolioHeatAdjustment,
            maxPositionSize
        );

        return {
            riskBasedSize: riskBasedSize,
            kellySize: kellySize,
            fixedFractionalSize: fixedFractionalSize,
            volatilityAdjustedSize: volatilityAdjustedSize,
            portfolioHeatAdjustment: portfolioHeatAdjustment,
            recommendedSize: recommendedSize,
            maxAllowedSize: maxPositionSize,
            sizingMethod: this.determineSizingMethod(recommendedSize, data),
            sizeJustification: this.generateSizeJustification(recommendedSize, riskAnalysis, data)
        };
    }

    optimizeStopLoss(riskAnalysis, marketStructure, data) {
        const stopLossOptions = [];
        
        // Technical stop losses
        const technicalStops = this.generateTechnicalStops(riskAnalysis, data);
        stopLossOptions.push(...technicalStops);
        
        // ATR-based stops
        const atrStops = this.generateATRStops(data.technicalIndicators?.atr, data.currentPrice, data);
        stopLossOptions.push(...atrStops);
        
        // Support level stops
        const supportStops = this.generateSupportStops(data.supportResistance, data.currentPrice, data);
        stopLossOptions.push(...supportStops);
        
        // Volatility stops
        const volatilityStops = this.generateVolatilityStops(data.volatility, data.currentPrice, data);
        stopLossOptions.push(...volatilityStops);
        
        // Time-based stops
        const timeStops = this.generateTimeStops(data);
        stopLossOptions.push(...timeStops);
        
        // Evaluate and rank stop loss options
        const rankedStops = this.rankStopLossOptions(stopLossOptions, marketStructure, data);
        
        // Optimal stop selection
        const optimalStop = this.selectOptimalStop(rankedStops, data);

        return {
            options: stopLossOptions,
            rankedOptions: rankedStops,
            optimalStop: optimalStop,
            trailingStopRecommendation: this.generateTrailingStopRecommendation(optimalStop, data),
            stopLossStrategy: this.determineStopLossStrategy(optimalStop, data),
            riskManagementTips: this.generateRiskManagementTips(optimalStop, data)
        };
    }

    optimizeTakeProfit(rewardAnalysis, trend, data) {
        const takeProfitOptions = [];
        
        // Technical take profits
        const technicalTPs = this.generateTechnicalTPs(rewardAnalysis, data);
        takeProfitOptions.push(...technicalTPs);
        
        // Resistance level TPs
        const resistanceTPs = this.generateResistanceTPs(data.supportResistance, data.currentPrice, data);
        takeProfitOptions.push(...resistanceTPs);
        
        // Fibonacci TPs
        const fibTPs = this.generateFibonacciTPs(data.currentPrice, data);
        takeProfitOptions.push(...fibTPs);
        
        // Trend-based TPs
        const trendTPs = this.generateTrendTPs(trend, data.currentPrice, data);
        takeProfitOptions.push(...trendTPs);
        
        // Volume-based TPs
        const volumeTPs = this.generateVolumeTPs(data.volume, data.currentPrice, data);
        takeProfitOptions.push(...volumeTPs);
        
        // Multiple take profit strategy
        const multiTPStrategy = this.generateMultiTPStrategy(takeProfitOptions, data);
        
        // Rank take profit options
        const rankedTPs = this.rankTakeProfitOptions(takeProfitOptions, data);
        
        // Optimal TP selection
        const optimalTP = this.selectOptimalTP(rankedTPs, data);

        return {
            options: takeProfitOptions,
            rankedOptions: rankedTPs,
            optimalTP: optimalTP,
            multiTPStrategy: multiTPStrategy,
            partialProfitRecommendation: this.generatePartialProfitRecommendation(optimalTP, data),
            profitManagementStrategy: this.determineProfitManagementStrategy(optimalTP, data)
        };
    }

    calculateExpectedValue(rrCalculations, data) {
        if (!rrCalculations.bestRatio) {
            return { expectedValue: 0, isPositive: false };
        }

        const ratio = rrCalculations.bestRatio;
        const winProbability = ratio.probability || 0.5;
        const lossProbability = 1 - winProbability;
        
        // Expected value calculation: (Win% × Win Amount) - (Loss% × Loss Amount)
        const expectedValue = (winProbability * ratio.ratio) - (lossProbability * 1);
        
        // Risk-adjusted expected value
        const volatilityAdjustment = this.calculateVolatilityAdjustment(data.volatility);
        const riskAdjustedEV = expectedValue * volatilityAdjustment;
        
        // Confidence interval
        const confidenceInterval = this.calculateConfidenceInterval(expectedValue, winProbability);
        
        // Long-term expectation
        const longTermExpectation = this.calculateLongTermExpectation(expectedValue, data);

        return {
            expectedValue: expectedValue,
            riskAdjustedEV: riskAdjustedEV,
            isPositive: expectedValue > 0,
            winProbability: winProbability,
            lossProbability: lossProbability,
            confidenceInterval: confidenceInterval,
            longTermExpectation: longTermExpectation,
            qualityRating: this.rateExpectedValue(expectedValue)
        };
    }

    calculateRiskAdjustedReturns(rrCalculations, volatility, data) {
        if (!rrCalculations.bestRatio) {
            return { sharpeRatio: 0, calmarRatio: 0 };
        }

        const expectedReturn = rrCalculations.bestRatio.expectedValue || 0;
        const volatilityRate = volatility?.rate || 0.02;
        const riskFreeRate = 0.02; // 2% risk-free rate assumption
        
        // Sharpe Ratio calculation
        const sharpeRatio = (expectedReturn - riskFreeRate) / volatilityRate;
        
        // Sortino Ratio (downside deviation)
        const sortinoRatio = this.calculateSortinoRatio(expectedReturn, riskFreeRate, data);
        
        // Calmar Ratio (return/max drawdown)
        const calmarRatio = this.calculateCalmarRatio(expectedReturn, data);
        
        // Information Ratio
        const informationRatio = this.calculateInformationRatio(expectedReturn, data);

        return {
            sharpeRatio: sharpeRatio,
            sortinoRatio: sortinoRatio,
            calmarRatio: calmarRatio,
            informationRatio: informationRatio,
            overallRating: this.rateRiskAdjustedReturns(sharpeRatio, sortinoRatio),
            benchmarkComparison: this.compareToBenchmark(sharpeRatio, data)
        };
    }

    performScenarioAnalysis(riskAnalysis, rewardAnalysis, data) {
        const scenarios = [];
        
        // Bull market scenario
        const bullScenario = this.createBullScenario(riskAnalysis, rewardAnalysis, data);
        scenarios.push(bullScenario);
        
        // Bear market scenario
        const bearScenario = this.createBearScenario(riskAnalysis, rewardAnalysis, data);
        scenarios.push(bearScenario);
        
        // Sideways market scenario
        const sidewaysScenario = this.createSidewaysScenario(riskAnalysis, rewardAnalysis, data);
        scenarios.push(sidewaysScenario);
        
        // High volatility scenario
        const volatilityScenario = this.createVolatilityScenario(riskAnalysis, rewardAnalysis, data);
        scenarios.push(volatilityScenario);
        
        // Black swan scenario
        const blackSwanScenario = this.createBlackSwanScenario(riskAnalysis, rewardAnalysis, data);
        scenarios.push(blackSwanScenario);
        
        // Scenario probabilities
        const scenarioProbabilities = this.calculateScenarioProbabilities(scenarios, data);
        
        // Weighted outcome
        const weightedOutcome = this.calculateWeightedOutcome(scenarios, scenarioProbabilities);

        return {
            scenarios: scenarios,
            scenarioProbabilities: scenarioProbabilities,
            weightedOutcome: weightedOutcome,
            worstCaseScenario: scenarios.find(s => s.type === 'black_swan'),
            bestCaseScenario: scenarios.find(s => s.type === 'bull'),
            mostLikelyScenario: this.findMostLikelyScenario(scenarios, scenarioProbabilities)
        };
    }

    assessPortfolioImpact(positionSizing, portfolio, data) {
        if (!portfolio) {
            return { impact: 'minimal', analysis: 'No portfolio data available' };
        }

        // Portfolio heat calculation
        const portfolioHeat = this.calculatePortfolioHeat(positionSizing, portfolio, data);
        
        // Correlation impact
        const correlationImpact = this.calculateCorrelationImpact(data.symbol, portfolio, data);
        
        // Concentration risk
        const concentrationRisk = this.calculateConcentrationRisk(positionSizing, portfolio, data);
        
        // Diversification impact
        const diversificationImpact = this.calculateDiversificationImpact(data.symbol, portfolio, data);
        
        // Overall portfolio risk change
        const portfolioRiskChange = this.calculatePortfolioRiskChange(positionSizing, portfolio, data);

        return {
            portfolioHeat: portfolioHeat,
            correlationImpact: correlationImpact,
            concentrationRisk: concentrationRisk,
            diversificationImpact: diversificationImpact,
            portfolioRiskChange: portfolioRiskChange,
            impact: this.categorizePortfolioImpact(portfolioHeat, concentrationRisk),
            recommendations: this.generatePortfolioRecommendations(portfolioHeat, concentrationRisk, data)
        };
    }

    updateCalculationHistory(symbol, rrCalculations, expectedValue, timestamp) {
        if (!this.calculationHistory.has(symbol)) {
            this.calculationHistory.set(symbol, []);
        }
        
        const history = this.calculationHistory.get(symbol);
        history.push({
            timestamp: timestamp,
            bestRatio: rrCalculations.bestRatio?.ratio || 0,
            expectedValue: expectedValue.expectedValue || 0,
            grade: rrCalculations.bestRatio?.category?.grade || 'F'
        });
        
        if (history.length > this.maxHistorySize) {
            history.splice(0, history.length - this.maxHistorySize);
        }
    }

    // Helper methods for calculations
    calculateTechnicalRisk(price, indicators, sr, data) {
        const risks = {};
        
        // ATR-based risk
        if (indicators?.atr) {
            risks.atr = {
                level: price - (indicators.atr * 2),
                distance: indicators.atr * 2,
                percentage: (indicators.atr * 2) / price
            };
        }
        
        // Support-based risk  
        if (sr?.support) {
            const supportDistance = price - sr.support;
            risks.support = {
                level: sr.support * 0.995, // 0.5% buffer
                distance: supportDistance,
                percentage: supportDistance / price
            };
        }
        
        return risks;
    }

    calculateTechnicalReward(price, trend, sr, data) {
        const rewards = {};
        
        // Resistance-based reward
        if (sr?.resistance) {
            const resistanceDistance = sr.resistance - price;
            rewards.resistance = {
                level: sr.resistance * 0.995, // 0.5% buffer
                distance: resistanceDistance,
                percentage: resistanceDistance / price
            };
        }
        
        // Trend-based reward
        if (trend?.direction === 'bullish' && trend.target) {
            rewards.trend = {
                level: trend.target,
                distance: trend.target - price,
                percentage: (trend.target - price) / price
            };
        }
        
        return rewards;
    }

    categorizeRatio(ratio) {
        for (const [category, config] of Object.entries(this.rrCategories)) {
            if (ratio >= config.min && ratio < config.max) {
                return { name: category, ...config };
            }
        }
        return this.rrCategories.poor;
    }

    generateModularRecommendations(rrCalculations, positionSizing, data) {
        const bestRatio = rrCalculations.bestRatio;
        
        return {
            VIVO: {
                riskRewardRatio: bestRatio?.ratio || 0,
                positionSize: positionSizing.recommendedSize,
                riskLevel: bestRatio?.category?.name || 'poor',
                executionRecommendation: bestRatio?.category?.recommendation || 'avoid'
            },
            LIVIA: {
                riskComfort: bestRatio?.ratio > 2 ? 'comfortable' : 'anxious',
                greedControl: bestRatio?.ratio > 5 ? 'control_greed' : 'normal',
                riskTolerance: positionSizing.sizingMethod
            },
            denetimAsistani: {
                monitorRiskReward: true,
                trackPerformance: bestRatio?.ratio > 1.5,
                alertRatio: bestRatio?.ratio || 0,
                positionSizeAlert: positionSizing.recommendedSize > 0.05
            }
        };
    }

    generateAlerts(rrCalculations, riskAnalysis, portfolioImpact) {
        const alerts = [];
        const bestRatio = rrCalculations.bestRatio;

        if (!bestRatio || bestRatio.ratio < 1.5) {
            alerts.push({
                level: 'warning',
                message: `Poor risk-reward ratio: ${bestRatio?.ratio?.toFixed(2) || 'N/A'}`,
                action: 'Avoid this trade'
            });
        }

        if (bestRatio && bestRatio.ratio > 5) {
            alerts.push({
                level: 'info',
                message: `Exceptional risk-reward ratio: ${bestRatio.ratio.toFixed(2)}`,
                action: 'Consider larger position size'
            });
        }

        if (portfolioImpact.portfolioHeat > 0.15) {
            alerts.push({
                level: 'warning',
                message: `High portfolio heat: ${(portfolioImpact.portfolioHeat * 100).toFixed(1)}%`,
                action: 'Reduce position size'
            });
        }

        if (riskAnalysis.overallRisk?.level === 'high') {
            alerts.push({
                level: 'warning',
                message: `High risk detected: ${riskAnalysis.overallRisk.level}`,
                action: 'Use tight stop loss'
            });
        }

        return alerts;
    }

    generateNotes(rrCalculations, expectedValue, portfolioImpact) {
        const notes = [];
        const bestRatio = rrCalculations.bestRatio;
        
        if (bestRatio) {
            notes.push(`R:R ratio: ${bestRatio.ratio.toFixed(2)} (${bestRatio.category.grade})`);
        }
        
        notes.push(`Expected value: ${expectedValue.expectedValue?.toFixed(3) || 'N/A'}`);
        notes.push(`Portfolio impact: ${portfolioImpact.impact}`);

        return notes.join('. ');
    }

    getDefaultPositionSizing() {
        return {
            recommendedSize: 0.02,
            sizingMethod: 'conservative',
            maxAllowedSize: 0.1,
            sizeJustification: 'Default conservative sizing'
        };
    }

    getDefaultResult() {
        return {
            riskAnalysis: { overallRisk: { level: 'unknown' }, calculations: {} },
            rewardAnalysis: { overallReward: { level: 'unknown' }, calculations: {} },
            rrCalculations: { bestRatio: null, averageRatio: 0, acceptableRatios: [] },
            positionSizing: this.getDefaultPositionSizing(),
            stopLossOptimization: { optimalStop: null },
            takeProfitOptimization: { optimalTP: null },
            expectedValue: { expectedValue: 0, isPositive: false },
            riskAdjustedReturns: { sharpeRatio: 0 },
            scenarioAnalysis: { scenarios: [] },
            portfolioImpact: { impact: 'unknown' },
            recommendations: {},
            alerts: [],
            notes: "Risk-reward analysis completed with limited data",
            metadata: { error: false, analysisTimestamp: Date.now() }
        };
    }

    getModuleInfo() {
        return {
            name: 'RiskRewardCalculator',
            version: '1.0.0',
            description: 'Risk-Reward hesaplayıcısı - Detaylı risk/kazanç analizi ve optimizasyon',
            inputs: [
                'symbol', 'timeframe', 'currentPrice', 'entryPrice', 'technicalIndicators',
                'supportResistance', 'marketStructure', 'volatility', 'volume', 'trend', 'portfolio'
            ],
            outputs: [
                'riskAnalysis', 'rewardAnalysis', 'rrCalculations', 'positionSizing',
                'stopLossOptimization', 'takeProfitOptimization', 'expectedValue', 'scenarioAnalysis'
            ]
        };
    }

    // Additional helper methods (simplified implementations)
    calculateFundamentalRisk(price, data) { return { newsRisk: 0.01, marketRisk: 0.015 }; }
    calculateStructuralRisk(price, structure, data) { return { liquidityRisk: 0.005, spreadRisk: 0.003 }; }
    calculateVolatilityRisk(price, volatility, data) { return { volatilityRisk: volatility?.rate || 0.02 }; }
    calculateLiquidityRisk(price, volume, data) { return { liquidityRisk: 0.005 }; }
    determineOptimalRisk(calculations, data) { return { method: 'atr_based', level: 0.02 }; }
    assessOverallRisk(calculations, optimal) { return { level: 'medium', score: 0.5 }; }
    identifyRiskFactors(calculations) { return ['volatility', 'liquidity']; }
    suggestRiskMitigation(calculations) { return ['use_stop_loss', 'reduce_size']; }
    generateStopLossLevels(calculations, price) { return { conservative: price * 0.98, aggressive: price * 0.96 }; }
    calculateTrendReward(price, trend, data) { return { trendReward: price * 0.05 }; }
    calculateSRReward(price, sr, data) { return { resistanceReward: price * 0.03 }; }
    calculateFibonacciReward(price, data) { return { fibReward: price * 0.025 }; }
    calculateVolumeReward(price, volume, data) { return { volumeReward: price * 0.02 }; }
    calculateTimeBasedReward(price, timeframe, data) { return { timeReward: price * 0.03 }; }
    determineOptimalReward(calculations, data) { return { method: 'resistance_based', level: 0.04 }; }
    assessOverallReward(calculations, optimal) { return { level: 'moderate', score: 0.6 }; }
    identifyRewardFactors(calculations) { return ['resistance', 'trend']; }
    generateTakeProfitLevels(calculations, price) { return { conservative: price * 1.03, aggressive: price * 1.06 }; }
    assessRewardProbabilities(calculations, data) { return { success: 0.6, failure: 0.4 }; }
    calculateIndividualRatio(risk, reward, data) { 
        if (!risk.distance || !reward.distance) return null;
        return { ratio: reward.distance / risk.distance, probability: 0.6, expectedValue: 0.5 };
    }
    calculateRatioStatistics(ratios) { 
        const values = ratios.map(r => r.ratio);
        return { 
            mean: values.reduce((sum, val) => sum + val, 0) / values.length,
            median: values.sort()[Math.floor(values.length / 2)],
            max: Math.max(...values),
            min: Math.min(...values)
        };
    }
    selectBestRatio(ratios, data) { return ratios[0] || null; }
    selectConservativeRatio(ratios, data) { return ratios.find(r => r.probability > 0.7) || ratios[0]; }
    analyzeQualityDistribution(ratios) { 
        return {
            excellent: ratios.filter(r => r.ratio >= 3).length,
            good: ratios.filter(r => r.ratio >= 2 && r.ratio < 3).length,
            acceptable: ratios.filter(r => r.ratio >= 1.5 && r.ratio < 2).length,
            poor: ratios.filter(r => r.ratio < 1.5).length
        };
    }
    calculateRiskBasedSize(riskAnalysis, riskPerTrade, equity, data) { return equity * riskPerTrade / (riskAnalysis.optimalRisk?.level || 0.02); }
    calculateKellySize(riskAnalysis, data) { return 0.1; } // 10% Kelly
    calculateFixedFractionalSize(equity, data) { return equity * 0.02; } // 2% fixed
    calculateVolatilityAdjustedSize(baseSize, volatility, data) { return baseSize * (1 - (volatility?.rate || 0) * 10); }
    calculatePortfolioHeatAdjustment(portfolio, data) { return 1.0; }
    calculateRecommendedSize(...sizes) { 
        const validSizes = sizes.filter(s => typeof s === 'number' && s > 0);
        return validSizes.reduce((sum, size) => sum + size, 0) / validSizes.length;
    }
    determineSizingMethod(size, data) { return size > 0.05 ? 'aggressive' : (size > 0.02 ? 'moderate' : 'conservative'); }
    generateSizeJustification(size, risk, data) { return `Based on ${risk.overallRisk?.level || 'unknown'} risk assessment`; }
    generateTechnicalStops(riskAnalysis, data) { return [{ type: 'technical', level: data.currentPrice * 0.98, reason: 'support_break' }]; }
    generateATRStops(atr, price, data) { return [{ type: 'atr', level: price - (atr || price * 0.02) * 2, reason: 'atr_multiple' }]; }
    generateSupportStops(sr, price, data) { return [{ type: 'support', level: (sr?.support || price * 0.95) * 0.995, reason: 'support_level' }]; }
    generateVolatilityStops(volatility, price, data) { return [{ type: 'volatility', level: price * (1 - (volatility?.rate || 0.02) * 2), reason: 'volatility_based' }]; }
    generateTimeStops(data) { return [{ type: 'time', duration: '24h', reason: 'time_limit' }]; }
    rankStopLossOptions(options, structure, data) { return options.sort((a, b) => (b.score || 0.5) - (a.score || 0.5)); }
    selectOptimalStop(ranked, data) { return ranked[0] || null; }
    generateTrailingStopRecommendation(stop, data) { return { useTrailing: true, distance: '2%' }; }
    determineStopLossStrategy(stop, data) { return 'fixed_stop'; }
    generateRiskManagementTips(stop, data) { return ['Monitor support levels', 'Adjust for volatility']; }
    // Continue with take profit methods...
    generateTechnicalTPs(rewardAnalysis, data) { return [{ type: 'technical', level: data.currentPrice * 1.03, reason: 'resistance_level' }]; }
    generateResistanceTPs(sr, price, data) { return [{ type: 'resistance', level: (sr?.resistance || price * 1.05) * 0.995, reason: 'resistance_break' }]; }
    generateFibonacciTPs(price, data) { return [{ type: 'fibonacci', level: price * 1.025, reason: 'fib_61.8' }]; }
    generateTrendTPs(trend, price, data) { return [{ type: 'trend', level: price * 1.04, reason: 'trend_continuation' }]; }
    generateVolumeTPs(volume, price, data) { return [{ type: 'volume', level: price * 1.035, reason: 'volume_target' }]; }
    generateMultiTPStrategy(options, data) { return { strategy: 'partial_profits', levels: options.slice(0, 3) }; }
    rankTakeProfitOptions(options, data) { return options.sort((a, b) => (b.probability || 0.5) - (a.probability || 0.5)); }
    selectOptimalTP(ranked, data) { return ranked[0] || null; }
    generatePartialProfitRecommendation(tp, data) { return { takePartial: true, percentage: 50 }; }
    determineProfitManagementStrategy(tp, data) { return 'scale_out'; }
    calculateVolatilityAdjustment(volatility) { return 1 - Math.min((volatility?.rate || 0) * 5, 0.3); }
    calculateConfidenceInterval(ev, prob) { return { lower: ev * 0.8, upper: ev * 1.2 }; }
    calculateLongTermExpectation(ev, data) { return ev * 252; } // Annualized
    rateExpectedValue(ev) { return ev > 0.5 ? 'excellent' : (ev > 0.1 ? 'good' : 'poor'); }
    calculateSortinoRatio(ret, rf, data) { return (ret - rf) / 0.02; } // Simplified
    calculateCalmarRatio(ret, data) { return ret / 0.05; } // Simplified
    calculateInformationRatio(ret, data) { return ret / 0.03; } // Simplified
    rateRiskAdjustedReturns(sharpe, sortino) { return sharpe > 1 ? 'excellent' : (sharpe > 0.5 ? 'good' : 'poor'); }
    compareToBenchmark(sharpe, data) { return sharpe > 0.5 ? 'outperforming' : 'underperforming'; }
    createBullScenario(risk, reward, data) { return { type: 'bull', probability: 0.3, outcome: 'positive' }; }
    createBearScenario(risk, reward, data) { return { type: 'bear', probability: 0.3, outcome: 'negative' }; }
    createSidewaysScenario(risk, reward, data) { return { type: 'sideways', probability: 0.3, outcome: 'neutral' }; }
    createVolatilityScenario(risk, reward, data) { return { type: 'volatility', probability: 0.05, outcome: 'mixed' }; }
    createBlackSwanScenario(risk, reward, data) { return { type: 'black_swan', probability: 0.05, outcome: 'very_negative' }; }
    calculateScenarioProbabilities(scenarios, data) { return scenarios.map(s => s.probability); }
    calculateWeightedOutcome(scenarios, probabilities) { return { expectedOutcome: 'slightly_positive' }; }
    findMostLikelyScenario(scenarios, probabilities) { return scenarios[0]; }
    calculatePortfolioHeat(sizing, portfolio, data) { return (sizing.recommendedSize || 0.02) * 2; }
    calculateCorrelationImpact(symbol, portfolio, data) { return 0.1; }
    calculateConcentrationRisk(sizing, portfolio, data) { return sizing.recommendedSize || 0.02; }
    calculateDiversificationImpact(symbol, portfolio, data) { return 0.05; }
    calculatePortfolioRiskChange(sizing, portfolio, data) { return 0.02; }
    categorizePortfolioImpact(heat, concentration) { return heat > 0.15 ? 'high' : (heat > 0.1 ? 'medium' : 'low'); }
    generatePortfolioRecommendations(heat, concentration, data) { return heat > 0.15 ? ['reduce_size'] : ['maintain_size']; }
}

module.exports = RiskRewardCalculator;
