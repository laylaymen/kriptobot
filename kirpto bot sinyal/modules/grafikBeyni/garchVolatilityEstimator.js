const GrafikBeyniModuleBase = require('../grafikBeyniModuleBase');

/**
 * GARCH Volatility Estimator Module
 * GARCH model ile volatilite tahmini ve clustering analizi
 * Volatility forecasting, regime detection ve risk metrics
 */
class GarchVolatilityEstimator extends GrafikBeyniModuleBase {
    constructor() {
        super('garchVolatilityEstimator');
        this.volatilityHistory = [];
        this.garchParameters = {
            alpha: 0.1,    // ARCH coefficient
            beta: 0.85,    // GARCH coefficient
            omega: 0.000001, // Constant term
            maxLag: 5      // Maximum lag for GARCH model
        };
        this.volatilityRegimes = {
            low: 0.15,
            moderate: 0.3,
            high: 0.5,
            extreme: 0.8
        };
        this.clusteringThresholds = {
            persistence: 0.7,
            clustering: 0.6,
            meanReversion: 0.5
        };
        this.maxHistorySize = 500;
        this.minObservations = 50;
        this.forecastHorizons = [1, 5, 10, 20]; // periods ahead
    }

    async analyze(data) {
        try {
            const {
                symbol,
                price,
                returns,
                volume,
                historicalPrices,
                timeframe,
                marketData,
                volatilityIndex,
                impliedVolatility,
                realizedVolatility,
                optionsData,
                macroEvents,
                newsFlow,
                liquidityMetrics,
                marketMicrostructure
            } = data;

            // Veri doğrulama
            if (!returns && !historicalPrices) {
                throw new Error('Missing price returns or historical data for GARCH analysis');
            }

            // Returns calculation if not provided
            const returnsSeries = returns || this.calculateReturns(historicalPrices);
            
            if (returnsSeries.length < this.minObservations) {
                throw new Error(`Insufficient data for GARCH modeling. Need at least ${this.minObservations} observations`);
            }

            // GARCH model estimation
            const garchModel = this.estimateGarchModel(returnsSeries);

            // Volatility forecasting
            const volatilityForecast = this.forecastVolatility(garchModel, returnsSeries);

            // Volatility clustering analysis
            const clusteringAnalysis = this.analyzeVolatilityClustering(returnsSeries, garchModel);

            // Regime detection
            const regimeAnalysis = this.detectVolatilityRegimes(returnsSeries, garchModel);

            // Persistence analysis
            const persistenceAnalysis = this.analyzePersistence(garchModel, returnsSeries);

            // Mean reversion analysis
            const meanReversionAnalysis = this.analyzeMeanReversion(returnsSeries, garchModel);

            // Volatility risk metrics
            const riskMetrics = this.calculateRiskMetrics(garchModel, volatilityForecast);

            // Model validation
            const modelValidation = this.validateModel(garchModel, returnsSeries);

            // Volatility surface analysis (if options data available)
            const volatilitySurface = optionsData ? this.analyzeVolatilitySurface(optionsData) : null;

            const result = {
                garchModel: garchModel,
                volatilityForecast: volatilityForecast,
                clusteringAnalysis: clusteringAnalysis,
                regimeAnalysis: regimeAnalysis,
                persistenceAnalysis: persistenceAnalysis,
                meanReversionAnalysis: meanReversionAnalysis,
                riskMetrics: riskMetrics,
                modelValidation: modelValidation,
                volatilitySurface: volatilitySurface,
                currentVolatility: this.calculateCurrentVolatility(returnsSeries),
                recommendations: this.generateRecommendations(garchModel, volatilityForecast, regimeAnalysis),
                alerts: this.generateAlerts(volatilityForecast, regimeAnalysis, riskMetrics),
                notes: this.generateNotes(garchModel, volatilityForecast, regimeAnalysis),
                metadata: {
                    analysisTimestamp: Date.now(),
                    symbol: symbol,
                    timeframe: timeframe,
                    observationCount: returnsSeries.length,
                    modelType: 'GARCH(1,1)',
                    forecastHorizon: Math.max(...this.forecastHorizons),
                    currentRegime: regimeAnalysis.currentRegime,
                    modelFit: modelValidation.goodnessOfFit
                }
            };

            // History güncelleme
            this.updateVolatilityHistory(result, data);

            // Cache ve performance tracking
            this.updateCache(data, result);
            this.trackPerformance(Date.now(), modelValidation.goodnessOfFit > 0.7);

            return result;

        } catch (error) {
            this.handleError('GarchVolatilityEstimator analysis failed', error, data);
            return this.getDefaultResult();
        }
    }

    calculateReturns(prices) {
        const returns = [];
        
        for (let i = 1; i < prices.length; i++) {
            const logReturn = Math.log(prices[i] / prices[i - 1]);
            returns.push(logReturn);
        }
        
        return returns;
    }

    estimateGarchModel(returns) {
        // Simplified GARCH(1,1) estimation using maximum likelihood
        const n = returns.length;
        
        // Initial parameter estimates
        let alpha = this.garchParameters.alpha;
        let beta = this.garchParameters.beta;
        let omega = this.garchParameters.omega;
        
        // Calculate unconditional variance
        const unconditionalVariance = this.calculateVariance(returns);
        
        // Initialize conditional variance series
        const conditionalVariances = new Array(n);
        conditionalVariances[0] = unconditionalVariance;
        
        // Iterative parameter estimation (simplified)
        for (let iter = 0; iter < 10; iter++) {
            // Update conditional variances
            for (let t = 1; t < n; t++) {
                conditionalVariances[t] = omega + 
                    alpha * Math.pow(returns[t - 1], 2) + 
                    beta * conditionalVariances[t - 1];
            }
            
            // Update parameters using gradient descent (simplified)
            const gradients = this.calculateGradients(returns, conditionalVariances, alpha, beta, omega);
            
            alpha = Math.max(0.01, Math.min(0.3, alpha - 0.01 * gradients.alpha));
            beta = Math.max(0.6, Math.min(0.98, beta - 0.01 * gradients.beta));
            omega = Math.max(0.000001, omega - 0.000001 * gradients.omega);
            
            // Ensure stationarity constraint: alpha + beta < 1
            if (alpha + beta >= 1) {
                const sum = alpha + beta;
                alpha = alpha / sum * 0.99;
                beta = beta / sum * 0.99;
            }
        }
        
        // Final conditional variance calculation
        for (let t = 1; t < n; t++) {
            conditionalVariances[t] = omega + 
                alpha * Math.pow(returns[t - 1], 2) + 
                beta * conditionalVariances[t - 1];
        }
        
        // Model statistics
        const logLikelihood = this.calculateLogLikelihood(returns, conditionalVariances);
        const aic = -2 * logLikelihood + 2 * 3; // 3 parameters
        const bic = -2 * logLikelihood + Math.log(n) * 3;
        
        return {
            parameters: { alpha, beta, omega },
            conditionalVariances: conditionalVariances,
            unconditionalVariance: unconditionalVariance,
            logLikelihood: logLikelihood,
            aic: aic,
            bic: bic,
            persistence: alpha + beta,
            halfLife: this.calculateHalfLife(alpha + beta),
            stationarity: alpha + beta < 1
        };
    }

    calculateGradients(returns, conditionalVariances, alpha, beta, omega) {
        // Simplified gradient calculation
        const n = returns.length;
        let gradAlpha = 0;
        let gradBeta = 0;
        let gradOmega = 0;
        
        for (let t = 1; t < n; t++) {
            const variance = conditionalVariances[t];
            const standardizedReturn = returns[t] / Math.sqrt(variance);
            const adjustment = (Math.pow(standardizedReturn, 2) - 1) / variance;
            
            gradAlpha += adjustment * Math.pow(returns[t - 1], 2);
            gradBeta += adjustment * conditionalVariances[t - 1];
            gradOmega += adjustment;
        }
        
        return {
            alpha: gradAlpha / n,
            beta: gradBeta / n,
            omega: gradOmega / n
        };
    }

    calculateLogLikelihood(returns, conditionalVariances) {
        let logLikelihood = 0;
        
        for (let t = 1; t < returns.length; t++) {
            const variance = conditionalVariances[t];
            if (variance > 0) {
                logLikelihood += -0.5 * Math.log(2 * Math.PI) - 
                               0.5 * Math.log(variance) - 
                               0.5 * Math.pow(returns[t], 2) / variance;
            }
        }
        
        return logLikelihood;
    }

    calculateHalfLife(persistence) {
        if (persistence >= 1) return Infinity;
        return Math.log(0.5) / Math.log(persistence);
    }

    forecastVolatility(garchModel, returns) {
        const { parameters, conditionalVariances } = garchModel;
        const { alpha, beta, omega } = parameters;
        
        const lastReturn = returns[returns.length - 1];
        const lastVariance = conditionalVariances[conditionalVariances.length - 1];
        const unconditionalVariance = garchModel.unconditionalVariance;
        
        const forecasts = [];
        
        for (const horizon of this.forecastHorizons) {
            let forecast;
            
            if (horizon === 1) {
                // One-step ahead forecast
                forecast = omega + alpha * Math.pow(lastReturn, 2) + beta * lastVariance;
            } else {
                // Multi-step ahead forecast
                const persistence = alpha + beta;
                if (persistence < 1) {
                    forecast = unconditionalVariance + 
                              Math.pow(persistence, horizon - 1) * 
                              (lastVariance - unconditionalVariance);
                } else {
                    forecast = lastVariance; // Non-stationary case
                }
            }
            
            forecasts.push({
                horizon: horizon,
                variance: forecast,
                volatility: Math.sqrt(forecast),
                annualizedVolatility: Math.sqrt(forecast * 252), // Assuming daily data
                confidence: this.calculateForecastConfidence(horizon, garchModel)
            });
        }
        
        return {
            forecasts: forecasts,
            summary: {
                nearTerm: forecasts[0],
                mediumTerm: forecasts[Math.floor(forecasts.length / 2)],
                longTerm: forecasts[forecasts.length - 1]
            },
            trend: this.determineForecastTrend(forecasts),
            uncertainty: this.calculateForecastUncertainty(forecasts, garchModel)
        };
    }

    analyzeVolatilityClustering(returns, garchModel) {
        const { conditionalVariances } = garchModel;
        const volatilities = conditionalVariances.map(v => Math.sqrt(v));
        
        // Calculate clustering measure
        const clusteringScore = this.calculateClusteringScore(volatilities);
        
        // Identify volatility clusters
        const clusters = this.identifyVolatilityClusters(volatilities);
        
        // Analyze cluster characteristics
        const clusterStats = this.analyzeClusterStatistics(clusters, volatilities);
        
        return {
            clusteringScore: clusteringScore,
            clusters: clusters,
            clusterStatistics: clusterStats,
            currentCluster: this.getCurrentCluster(clusters, volatilities.length - 1),
            clusteringLevel: this.classifyClusteringLevel(clusteringScore),
            predictedDuration: this.predictClusterDuration(clusters, volatilities)
        };
    }

    detectVolatilityRegimes(returns, garchModel) {
        const { conditionalVariances } = garchModel;
        const volatilities = conditionalVariances.map(v => Math.sqrt(v));
        
        // Regime classification
        const regimes = volatilities.map(vol => this.classifyVolatilityRegime(vol));
        
        // Regime transitions
        const transitions = this.detectRegimeTransitions(regimes);
        
        // Regime persistence
        const regimePersistence = this.calculateRegimePersistence(regimes);
        
        // Current regime analysis
        const currentRegime = regimes[regimes.length - 1];
        const regimeDuration = this.calculateCurrentRegimeDuration(regimes);
        
        return {
            regimes: regimes,
            currentRegime: currentRegime,
            regimeDuration: regimeDuration,
            transitions: transitions,
            persistence: regimePersistence,
            regimeStats: this.calculateRegimeStatistics(regimes, volatilities),
            transitionProbabilities: this.calculateTransitionProbabilities(transitions)
        };
    }

    analyzePersistence(garchModel, returns) {
        const { parameters } = garchModel;
        const persistence = parameters.alpha + parameters.beta;
        
        // Persistence classification
        let persistenceLevel = 'moderate';
        if (persistence > this.clusteringThresholds.persistence) {
            persistenceLevel = 'high';
        } else if (persistence < 0.5) {
            persistenceLevel = 'low';
        }
        
        // Impulse response analysis
        const impulseResponse = this.calculateImpulseResponse(garchModel);
        
        // Volatility half-life
        const halfLife = garchModel.halfLife;
        
        return {
            persistence: persistence,
            level: persistenceLevel,
            halfLife: halfLife,
            impulseResponse: impulseResponse,
            interpretation: this.interpretPersistence(persistence, halfLife),
            implications: this.getPersistenceImplications(persistenceLevel)
        };
    }

    analyzeMeanReversion(returns, garchModel) {
        const { unconditionalVariance, conditionalVariances } = garchModel;
        const currentVariance = conditionalVariances[conditionalVariances.length - 1];
        
        // Mean reversion speed
        const reversionSpeed = this.calculateReversionSpeed(garchModel);
        
        // Distance from long-term mean
        const distanceFromMean = Math.abs(currentVariance - unconditionalVariance) / unconditionalVariance;
        
        // Time to revert to mean
        const timeToRevert = this.calculateTimeToRevert(currentVariance, unconditionalVariance, reversionSpeed);
        
        // Mean reversion strength
        const reversionStrength = this.classifyReversionStrength(reversionSpeed);
        
        return {
            reversionSpeed: reversionSpeed,
            reversionStrength: reversionStrength,
            distanceFromMean: distanceFromMean,
            timeToRevert: timeToRevert,
            longTermMean: Math.sqrt(unconditionalVariance),
            currentLevel: Math.sqrt(currentVariance),
            reversionPressure: this.calculateReversionPressure(distanceFromMean, reversionSpeed)
        };
    }

    calculateRiskMetrics(garchModel, volatilityForecast) {
        const { conditionalVariances } = garchModel;
        const currentVolatility = Math.sqrt(conditionalVariances[conditionalVariances.length - 1]);
        
        // Value at Risk (VaR) estimates
        const var95 = this.calculateVaR(currentVolatility, 0.05);
        const var99 = this.calculateVaR(currentVolatility, 0.01);
        
        // Expected Shortfall (ES)
        const es95 = this.calculateExpectedShortfall(currentVolatility, 0.05);
        const es99 = this.calculateExpectedShortfall(currentVolatility, 0.01);
        
        // Risk-based volatility metrics
        const volatilityRisk = this.assessVolatilityRisk(volatilityForecast);
        
        // Dynamic risk measures
        const dynamicRisk = this.calculateDynamicRisk(garchModel);
        
        return {
            currentVolatility: currentVolatility,
            annualizedVolatility: currentVolatility * Math.sqrt(252),
            var95: var95,
            var99: var99,
            expectedShortfall95: es95,
            expectedShortfall99: es99,
            volatilityRisk: volatilityRisk,
            dynamicRisk: dynamicRisk,
            riskLevel: this.classifyRiskLevel(currentVolatility, volatilityRisk),
            recommendations: this.generateRiskRecommendations(volatilityRisk, dynamicRisk)
        };
    }

    validateModel(garchModel, returns) {
        const { conditionalVariances } = garchModel;
        
        // Standardized residuals
        const standardizedResiduals = returns.slice(1).map((ret, i) => 
            ret / Math.sqrt(conditionalVariances[i + 1])
        );
        
        // Ljung-Box test for standardized residuals
        const ljungBoxTest = this.ljungBoxTest(standardizedResiduals);
        
        // ARCH-LM test for remaining ARCH effects
        const archLMTest = this.archLMTest(standardizedResiduals);
        
        // Jarque-Bera test for normality
        const jarqueBeraTest = this.jarqueBeraTest(standardizedResiduals);
        
        // Model adequacy measures
        const adequacy = this.assessModelAdequacy(ljungBoxTest, archLMTest, jarqueBeraTest);
        
        // Goodness of fit
        const goodnessOfFit = this.calculateGoodnessOfFit(garchModel, returns);
        
        return {
            ljungBoxTest: ljungBoxTest,
            archLMTest: archLMTest,
            jarqueBeraTest: jarqueBeraTest,
            adequacy: adequacy,
            goodnessOfFit: goodnessOfFit,
            standardizedResiduals: standardizedResiduals.slice(-20), // Last 20 for inspection
            diagnostics: this.generateDiagnostics(adequacy, goodnessOfFit)
        };
    }

    analyzeVolatilitySurface(optionsData) {
        // Simplified volatility surface analysis
        const { strikes, maturities, impliedVolatilities } = optionsData;
        
        // Term structure analysis
        const termStructure = this.analyzeTermStructure(maturities, impliedVolatilities);
        
        // Skew analysis
        const skewAnalysis = this.analyzeVolatilitySkew(strikes, impliedVolatilities);
        
        // Surface characteristics
        const surfaceMetrics = this.calculateSurfaceMetrics(optionsData);
        
        return {
            termStructure: termStructure,
            skewAnalysis: skewAnalysis,
            surfaceMetrics: surfaceMetrics,
            marketExpectations: this.extractMarketExpectations(termStructure, skewAnalysis)
        };
    }

    calculateCurrentVolatility(returns) {
        const recentReturns = returns.slice(-20); // Last 20 observations
        const variance = this.calculateVariance(recentReturns);
        
        return {
            realized: Math.sqrt(variance),
            annualized: Math.sqrt(variance * 252),
            level: this.classifyVolatilityLevel(Math.sqrt(variance))
        };
    }

    generateRecommendations(garchModel, volatilityForecast, regimeAnalysis) {
        const recommendations = {};
        
        // VIVO recommendations
        if (regimeAnalysis.currentRegime === 'high' || regimeAnalysis.currentRegime === 'extreme') {
            recommendations.vivo = {
                volatilityAdjustment: 'increase',
                riskScaling: 'conservative',
                signalFiltering: 'enhanced'
            };
        } else if (regimeAnalysis.currentRegime === 'low') {
            recommendations.vivo = {
                volatilityAdjustment: 'normal',
                riskScaling: 'standard',
                signalFiltering: 'normal'
            };
        }
        
        // Risk management recommendations
        const persistence = garchModel.persistence;
        if (persistence > 0.9) {
            recommendations.riskManagement = {
                positionSizing: 'reduce',
                stopLoss: 'tighter',
                hedging: 'consider',
                timeHorizon: 'shorter'
            };
        }
        
        // Trading strategy recommendations
        const forecastTrend = volatilityForecast.trend;
        if (forecastTrend === 'increasing') {
            recommendations.trading = {
                strategy: 'volatility_expansion',
                instruments: 'options_favorable',
                timing: 'defensive'
            };
        } else if (forecastTrend === 'decreasing') {
            recommendations.trading = {
                strategy: 'trend_following',
                instruments: 'directional_favorable',
                timing: 'aggressive'
            };
        }
        
        return recommendations;
    }

    generateAlerts(volatilityForecast, regimeAnalysis, riskMetrics) {
        const alerts = [];
        
        // High volatility alert
        if (regimeAnalysis.currentRegime === 'extreme') {
            alerts.push({
                level: 'critical',
                message: 'Aşırı yüksek volatilite rejimi tespit edildi',
                action: 'Risk pozisyonlarını gözden geçir'
            });
        }
        
        // Volatility forecast alert
        const nearTermForecast = volatilityForecast.summary.nearTerm;
        if (nearTermForecast.annualizedVolatility > 0.8) {
            alerts.push({
                level: 'warning',
                message: 'Yüksek volatilite öngörülüyor',
                action: 'Pozisyon büyüklüklerini azalt'
            });
        }
        
        // Risk metric alert
        if (riskMetrics.riskLevel === 'high') {
            alerts.push({
                level: 'warning',
                message: 'Yüksek volatilite riski',
                action: 'Hedge stratejilerini değerlendir'
            });
        }
        
        return alerts;
    }

    generateNotes(garchModel, volatilityForecast, regimeAnalysis) {
        const notes = [];
        
        notes.push(`GARCH modeli: persistence=${garchModel.persistence.toFixed(3)}`);
        notes.push(`Mevcut rejim: ${regimeAnalysis.currentRegime}`);
        
        const nearTermVol = volatilityForecast.summary.nearTerm.annualizedVolatility;
        notes.push(`Kısa vadeli volatilite tahmini: ${(nearTermVol * 100).toFixed(1)}%`);
        
        if (garchModel.halfLife < Infinity) {
            notes.push(`Volatilite yarı-yaşam: ${garchModel.halfLife.toFixed(1)} gün`);
        }
        
        return notes.join('. ');
    }

    // Helper methods
    calculateVariance(returns) {
        const mean = returns.reduce((sum, ret) => sum + ret, 0) / returns.length;
        const variance = returns.reduce((sum, ret) => sum + Math.pow(ret - mean, 2), 0) / (returns.length - 1);
        return variance;
    }

    calculateClusteringScore(volatilities) {
        // Measure of volatility clustering using autocorrelation
        let autocorr = 0;
        const n = volatilities.length;
        
        for (let lag = 1; lag <= 5; lag++) {
            let correlation = 0;
            for (let t = lag; t < n; t++) {
                correlation += volatilities[t] * volatilities[t - lag];
            }
            autocorr += correlation / (n - lag);
        }
        
        return autocorr / 5; // Average autocorrelation
    }

    identifyVolatilityClusters(volatilities) {
        const clusters = [];
        let currentCluster = null;
        const threshold = this.calculateVolatilityThreshold(volatilities);
        
        for (let i = 0; i < volatilities.length; i++) {
            const isHighVol = volatilities[i] > threshold;
            
            if (isHighVol && !currentCluster) {
                currentCluster = { start: i, end: i, type: 'high' };
            } else if (isHighVol && currentCluster) {
                currentCluster.end = i;
            } else if (!isHighVol && currentCluster) {
                clusters.push(currentCluster);
                currentCluster = null;
            }
        }
        
        if (currentCluster) {
            clusters.push(currentCluster);
        }
        
        return clusters;
    }

    calculateVolatilityThreshold(volatilities) {
        const sorted = [...volatilities].sort((a, b) => a - b);
        return sorted[Math.floor(sorted.length * 0.75)]; // 75th percentile
    }

    analyzeClusterStatistics(clusters, volatilities) {
        return {
            count: clusters.length,
            averageDuration: clusters.reduce((sum, cluster) => sum + (cluster.end - cluster.start + 1), 0) / clusters.length,
            maxDuration: Math.max(...clusters.map(cluster => cluster.end - cluster.start + 1)),
            averageIntensity: clusters.reduce((sum, cluster) => {
                const clusterVols = volatilities.slice(cluster.start, cluster.end + 1);
                return sum + clusterVols.reduce((s, v) => s + v, 0) / clusterVols.length;
            }, 0) / clusters.length
        };
    }

    getCurrentCluster(clusters, currentIndex) {
        return clusters.find(cluster => currentIndex >= cluster.start && currentIndex <= cluster.end);
    }

    classifyClusteringLevel(clusteringScore) {
        if (clusteringScore > this.clusteringThresholds.clustering) return 'high';
        if (clusteringScore > 0.3) return 'moderate';
        return 'low';
    }

    predictClusterDuration(clusters, volatilities) {
        if (clusters.length === 0) return 0;
        
        const avgDuration = clusters.reduce((sum, cluster) => 
            sum + (cluster.end - cluster.start + 1), 0) / clusters.length;
        
        return Math.round(avgDuration);
    }

    classifyVolatilityRegime(volatility) {
        if (volatility > this.volatilityRegimes.extreme) return 'extreme';
        if (volatility > this.volatilityRegimes.high) return 'high';
        if (volatility > this.volatilityRegimes.moderate) return 'moderate';
        return 'low';
    }

    detectRegimeTransitions(regimes) {
        const transitions = [];
        
        for (let i = 1; i < regimes.length; i++) {
            if (regimes[i] !== regimes[i - 1]) {
                transitions.push({
                    from: regimes[i - 1],
                    to: regimes[i],
                    index: i,
                    type: this.classifyTransition(regimes[i - 1], regimes[i])
                });
            }
        }
        
        return transitions;
    }

    classifyTransition(fromRegime, toRegime) {
        const regimeOrder = ['low', 'moderate', 'high', 'extreme'];
        const fromIndex = regimeOrder.indexOf(fromRegime);
        const toIndex = regimeOrder.indexOf(toRegime);
        
        if (toIndex > fromIndex) return 'escalation';
        if (toIndex < fromIndex) return 'de-escalation';
        return 'neutral';
    }

    calculateRegimePersistence(regimes) {
        const persistences = {};
        let currentRegime = regimes[0];
        let duration = 1;
        
        for (let i = 1; i < regimes.length; i++) {
            if (regimes[i] === currentRegime) {
                duration++;
            } else {
                if (!persistences[currentRegime]) {
                    persistences[currentRegime] = [];
                }
                persistences[currentRegime].push(duration);
                currentRegime = regimes[i];
                duration = 1;
            }
        }
        
        // Add final regime
        if (!persistences[currentRegime]) {
            persistences[currentRegime] = [];
        }
        persistences[currentRegime].push(duration);
        
        // Calculate average persistence for each regime
        const avgPersistence = {};
        Object.keys(persistences).forEach(regime => {
            const durations = persistences[regime];
            avgPersistence[regime] = durations.reduce((sum, d) => sum + d, 0) / durations.length;
        });
        
        return avgPersistence;
    }

    calculateCurrentRegimeDuration(regimes) {
        const currentRegime = regimes[regimes.length - 1];
        let duration = 1;
        
        for (let i = regimes.length - 2; i >= 0; i--) {
            if (regimes[i] === currentRegime) {
                duration++;
            } else {
                break;
            }
        }
        
        return duration;
    }

    calculateRegimeStatistics(regimes, volatilities) {
        const stats = {};
        const regimeTypes = ['low', 'moderate', 'high', 'extreme'];
        
        regimeTypes.forEach(regime => {
            const indices = regimes.map((r, i) => r === regime ? i : -1).filter(i => i >= 0);
            if (indices.length > 0) {
                const regimeVolatilities = indices.map(i => volatilities[i]);
                stats[regime] = {
                    frequency: indices.length / regimes.length,
                    averageVolatility: regimeVolatilities.reduce((sum, v) => sum + v, 0) / regimeVolatilities.length,
                    maxVolatility: Math.max(...regimeVolatilities),
                    minVolatility: Math.min(...regimeVolatilities)
                };
            }
        });
        
        return stats;
    }

    calculateTransitionProbabilities(transitions) {
        const transitionMatrix = {};
        const regimeTypes = ['low', 'moderate', 'high', 'extreme'];
        
        // Initialize matrix
        regimeTypes.forEach(from => {
            transitionMatrix[from] = {};
            regimeTypes.forEach(to => {
                transitionMatrix[from][to] = 0;
            });
        });
        
        // Count transitions
        transitions.forEach(transition => {
            transitionMatrix[transition.from][transition.to]++;
        });
        
        // Convert to probabilities
        regimeTypes.forEach(from => {
            const total = Object.values(transitionMatrix[from]).reduce((sum, count) => sum + count, 0);
            if (total > 0) {
                regimeTypes.forEach(to => {
                    transitionMatrix[from][to] /= total;
                });
            }
        });
        
        return transitionMatrix;
    }

    calculateImpulseResponse(garchModel) {
        const { parameters } = garchModel;
        const { alpha, beta } = parameters;
        const persistence = alpha + beta;
        
        const horizons = [1, 5, 10, 20, 50];
        const response = horizons.map(h => {
            return Math.pow(persistence, h - 1);
        });
        
        return horizons.map((h, i) => ({ horizon: h, response: response[i] }));
    }

    interpretPersistence(persistence, halfLife) {
        if (persistence > 0.95) {
            return 'Very high persistence - volatility shocks have long-lasting effects';
        } else if (persistence > 0.8) {
            return 'High persistence - volatility clustering is significant';
        } else if (persistence > 0.6) {
            return 'Moderate persistence - some volatility clustering present';
        } else {
            return 'Low persistence - volatility shocks dissipate quickly';
        }
    }

    getPersistenceImplications(persistenceLevel) {
        const implications = {
            high: [
                'Volatility shocks persist for extended periods',
                'Higher predictability in volatility forecasts',
                'Risk management needs longer horizons'
            ],
            moderate: [
                'Moderate volatility clustering',
                'Balanced approach to risk management',
                'Standard forecasting horizons applicable'
            ],
            low: [
                'Quick return to long-term volatility',
                'Volatility shocks are temporary',
                'Shorter risk management horizons sufficient'
            ]
        };
        
        return implications[persistenceLevel] || implications.moderate;
    }

    calculateReversionSpeed(garchModel) {
        const persistence = garchModel.persistence;
        return 1 - persistence;
    }

    calculateTimeToRevert(currentVariance, unconditionalVariance, reversionSpeed) {
        const deviationRatio = currentVariance / unconditionalVariance;
        if (deviationRatio === 1) return 0;
        
        // Time for half the deviation to disappear
        return Math.log(0.5) / Math.log(1 - reversionSpeed);
    }

    classifyReversionStrength(reversionSpeed) {
        if (reversionSpeed > 0.5) return 'strong';
        if (reversionSpeed > 0.2) return 'moderate';
        return 'weak';
    }

    calculateReversionPressure(distanceFromMean, reversionSpeed) {
        return distanceFromMean * reversionSpeed;
    }

    calculateVaR(volatility, confidenceLevel) {
        // Assuming normal distribution
        const zScore = this.getZScore(confidenceLevel);
        return volatility * zScore;
    }

    calculateExpectedShortfall(volatility, confidenceLevel) {
        // Assuming normal distribution
        const zScore = this.getZScore(confidenceLevel);
        const density = Math.exp(-0.5 * zScore * zScore) / Math.sqrt(2 * Math.PI);
        return volatility * density / confidenceLevel;
    }

    getZScore(confidenceLevel) {
        // Critical values for normal distribution
        const criticalValues = {
            0.01: 2.326,
            0.05: 1.645,
            0.1: 1.282
        };
        
        return criticalValues[confidenceLevel] || 1.645;
    }

    assessVolatilityRisk(volatilityForecast) {
        const forecasts = volatilityForecast.forecasts;
        const maxVolatility = Math.max(...forecasts.map(f => f.annualizedVolatility));
        const volatilityIncrease = forecasts[forecasts.length - 1].annualizedVolatility / forecasts[0].annualizedVolatility;
        
        return {
            maxForecastVolatility: maxVolatility,
            volatilityIncrease: volatilityIncrease,
            riskLevel: maxVolatility > 1.0 ? 'high' : maxVolatility > 0.5 ? 'moderate' : 'low'
        };
    }

    calculateDynamicRisk(garchModel) {
        const persistence = garchModel.persistence;
        const unconditionalVol = Math.sqrt(garchModel.unconditionalVariance);
        const currentVol = Math.sqrt(garchModel.conditionalVariances[garchModel.conditionalVariances.length - 1]);
        
        return {
            persistence: persistence,
            currentVolatilityRatio: currentVol / unconditionalVol,
            riskAcceleration: persistence > 0.9 ? 'high' : persistence > 0.7 ? 'moderate' : 'low'
        };
    }

    classifyRiskLevel(currentVolatility, volatilityRisk) {
        const annualizedVol = currentVolatility * Math.sqrt(252);
        
        if (annualizedVol > 1.0 || volatilityRisk.riskLevel === 'high') return 'high';
        if (annualizedVol > 0.5 || volatilityRisk.riskLevel === 'moderate') return 'moderate';
        return 'low';
    }

    generateRiskRecommendations(volatilityRisk, dynamicRisk) {
        const recommendations = [];
        
        if (volatilityRisk.riskLevel === 'high') {
            recommendations.push('Pozisyon büyüklüklerini azalt');
            recommendations.push('Stop-loss seviyelerini daralt');
        }
        
        if (dynamicRisk.riskAcceleration === 'high') {
            recommendations.push('Volatilite hedge stratejilerini değerlendir');
            recommendations.push('Daha sık risk değerlendirmesi yap');
        }
        
        if (dynamicRisk.currentVolatilityRatio > 2) {
            recommendations.push('Ortalamaya dönüş stratejileri değerlendir');
        }
        
        return recommendations;
    }

    calculateForecastConfidence(horizon, garchModel) {
        // Confidence decreases with horizon and increases with model fit
        const baseConfidence = 0.8;
        const horizonPenalty = Math.min(horizon * 0.05, 0.4);
        const persistenceBonus = garchModel.persistence * 0.1;
        
        return Math.max(0.3, baseConfidence - horizonPenalty + persistenceBonus);
    }

    determineForecastTrend(forecasts) {
        const firstVol = forecasts[0].volatility;
        const lastVol = forecasts[forecasts.length - 1].volatility;
        
        if (lastVol > firstVol * 1.1) return 'increasing';
        if (lastVol < firstVol * 0.9) return 'decreasing';
        return 'stable';
    }

    calculateForecastUncertainty(forecasts, garchModel) {
        // Uncertainty increases with forecast horizon and decreases with persistence
        const maxHorizon = Math.max(...forecasts.map(f => f.horizon));
        const persistence = garchModel.persistence;
        
        const baseUncertainty = 0.2;
        const horizonEffect = maxHorizon * 0.02;
        const persistenceEffect = (1 - persistence) * 0.3;
        
        return Math.min(0.8, baseUncertainty + horizonEffect + persistenceEffect);
    }

    // Simplified statistical tests
    ljungBoxTest(residuals) {
        // Simplified Ljung-Box test for autocorrelation
        const n = residuals.length;
        const lags = 10;
        let statistic = 0;
        
        for (let k = 1; k <= lags; k++) {
            let autocorr = 0;
            for (let t = k; t < n; t++) {
                autocorr += residuals[t] * residuals[t - k];
            }
            autocorr /= (n - k);
            statistic += autocorr * autocorr / (n - k);
        }
        
        statistic *= n * (n + 2);
        
        return {
            statistic: statistic,
            pValue: 1 - this.chiSquareCDF(statistic, lags), // Simplified
            reject: statistic > 18.31 // Critical value for 10 degrees of freedom at 5%
        };
    }

    archLMTest(residuals) {
        // Simplified ARCH-LM test
        const n = residuals.length;
        const squaredResiduals = residuals.map(r => r * r);
        
        // Simple regression of squared residuals on lagged values
        let statistic = 0;
        for (let lag = 1; lag <= 5; lag++) {
            let correlation = 0;
            for (let t = lag; t < n; t++) {
                correlation += squaredResiduals[t] * squaredResiduals[t - lag];
            }
            statistic += correlation * correlation;
        }
        
        return {
            statistic: statistic / n,
            pValue: 0.5, // Simplified
            reject: statistic / n > 0.1
        };
    }

    jarqueBeraTest(residuals) {
        // Simplified Jarque-Bera test for normality
        const n = residuals.length;
        const mean = residuals.reduce((sum, r) => sum + r, 0) / n;
        const variance = residuals.reduce((sum, r) => sum + (r - mean) ** 2, 0) / n;
        const skewness = residuals.reduce((sum, r) => sum + (r - mean) ** 3, 0) / (n * variance ** 1.5);
        const kurtosis = residuals.reduce((sum, r) => sum + (r - mean) ** 4, 0) / (n * variance ** 2);
        
        const statistic = n * (skewness ** 2 / 6 + (kurtosis - 3) ** 2 / 24);
        
        return {
            statistic: statistic,
            skewness: skewness,
            kurtosis: kurtosis,
            pValue: 1 - this.chiSquareCDF(statistic, 2), // Simplified
            reject: statistic > 5.99 // Critical value for 2 degrees of freedom at 5%
        };
    }

    chiSquareCDF(x, df) {
        // Very simplified chi-square CDF approximation
        if (x <= 0) return 0;
        if (x > 20) return 1;
        return Math.min(1, x / (df + 5)); // Rough approximation
    }

    assessModelAdequacy(ljungBox, archLM, jarqueBera) {
        let score = 0;
        const issues = [];
        
        if (!ljungBox.reject) score += 1;
        else issues.push('Autocorrelation in residuals');
        
        if (!archLM.reject) score += 1;
        else issues.push('Remaining ARCH effects');
        
        if (!jarqueBera.reject) score += 1;
        else issues.push('Non-normal residuals');
        
        return {
            score: score / 3,
            level: score >= 2 ? 'adequate' : score >= 1 ? 'marginal' : 'inadequate',
            issues: issues
        };
    }

    calculateGoodnessOfFit(garchModel, returns) {
        // Simplified goodness of fit measure
        const { logLikelihood, aic, bic } = garchModel;
        const n = returns.length;
        
        // Pseudo R-squared
        const unconditionalLogLikelihood = this.calculateUnconditionalLogLikelihood(returns);
        const pseudoRSquared = 1 - logLikelihood / unconditionalLogLikelihood;
        
        return {
            logLikelihood: logLikelihood,
            aic: aic,
            bic: bic,
            pseudoRSquared: pseudoRSquared,
            fit: pseudoRSquared > 0.1 ? 'good' : pseudoRSquared > 0.05 ? 'fair' : 'poor'
        };
    }

    calculateUnconditionalLogLikelihood(returns) {
        const variance = this.calculateVariance(returns);
        let logLikelihood = 0;
        
        for (let t = 0; t < returns.length; t++) {
            logLikelihood += -0.5 * Math.log(2 * Math.PI) - 
                           0.5 * Math.log(variance) - 
                           0.5 * Math.pow(returns[t], 2) / variance;
        }
        
        return logLikelihood;
    }

    generateDiagnostics(adequacy, goodnessOfFit) {
        const diagnostics = [];
        
        if (adequacy.level === 'inadequate') {
            diagnostics.push('Model specification may need improvement');
        }
        
        if (goodnessOfFit.fit === 'poor') {
            diagnostics.push('Consider alternative GARCH specifications');
        }
        
        if (adequacy.issues.includes('Remaining ARCH effects')) {
            diagnostics.push('Higher order GARCH model may be needed');
        }
        
        return diagnostics;
    }

    analyzeTermStructure(maturities, impliedVolatilities) {
        // Simplified term structure analysis
        const structure = maturities.map((maturity, i) => ({
            maturity: maturity,
            impliedVolatility: impliedVolatilities[i]
        })).sort((a, b) => a.maturity - b.maturity);
        
        const slope = this.calculateTermStructureSlope(structure);
        const shape = this.classifyTermStructureShape(slope);
        
        return {
            structure: structure,
            slope: slope,
            shape: shape,
            contango: slope > 0,
            backwardation: slope < 0
        };
    }

    analyzeVolatilitySkew(strikes, impliedVolatilities) {
        // Simplified skew analysis
        const skewData = strikes.map((strike, i) => ({
            strike: strike,
            impliedVolatility: impliedVolatilities[i]
        })).sort((a, b) => a.strike - b.strike);
        
        const skew = this.calculateVolatilitySkew(skewData);
        
        return {
            skewData: skewData,
            skew: skew,
            interpretation: this.interpretSkew(skew)
        };
    }

    calculateTermStructureSlope(structure) {
        if (structure.length < 2) return 0;
        
        const n = structure.length;
        let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
        
        for (let i = 0; i < n; i++) {
            const x = structure[i].maturity;
            const y = structure[i].impliedVolatility;
            sumX += x;
            sumY += y;
            sumXY += x * y;
            sumX2 += x * x;
        }
        
        return (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    }

    classifyTermStructureShape(slope) {
        if (slope > 0.01) return 'upward_sloping';
        if (slope < -0.01) return 'downward_sloping';
        return 'flat';
    }

    calculateVolatilitySkew(skewData) {
        // Calculate skew as difference between put and call volatilities
        const n = skewData.length;
        if (n < 3) return 0;
        
        const lowStrike = skewData[0];
        const highStrike = skewData[n - 1];
        
        return lowStrike.impliedVolatility - highStrike.impliedVolatility;
    }

    interpretSkew(skew) {
        if (skew > 0.05) return 'negative_skew_high';
        if (skew > 0.02) return 'negative_skew_moderate';
        if (skew < -0.02) return 'positive_skew';
        return 'flat';
    }

    calculateSurfaceMetrics(optionsData) {
        return {
            averageImpliedVolatility: optionsData.impliedVolatilities.reduce((sum, iv) => sum + iv, 0) / optionsData.impliedVolatilities.length,
            volatilityRange: Math.max(...optionsData.impliedVolatilities) - Math.min(...optionsData.impliedVolatilities),
            surface: 'complex' // Simplified
        };
    }

    extractMarketExpectations(termStructure, skewAnalysis) {
        return {
            volatilityDirection: termStructure.shape === 'upward_sloping' ? 'increasing' : 
                               termStructure.shape === 'downward_sloping' ? 'decreasing' : 'stable',
            crashRisk: skewAnalysis.interpretation.includes('negative_skew') ? 'elevated' : 'normal',
            marketSentiment: this.inferMarketSentiment(termStructure, skewAnalysis)
        };
    }

    inferMarketSentiment(termStructure, skewAnalysis) {
        if (termStructure.shape === 'upward_sloping' && skewAnalysis.interpretation.includes('negative_skew')) {
            return 'cautious';
        } else if (termStructure.shape === 'downward_sloping') {
            return 'complacent';
        } else {
            return 'neutral';
        }
    }

    classifyVolatilityLevel(volatility) {
        const annualized = volatility * Math.sqrt(252);
        
        if (annualized > this.volatilityRegimes.extreme) return 'extreme';
        if (annualized > this.volatilityRegimes.high) return 'high';
        if (annualized > this.volatilityRegimes.moderate) return 'moderate';
        return 'low';
    }

    updateVolatilityHistory(result, data) {
        this.volatilityHistory.push({
            timestamp: Date.now(),
            volatility: result.currentVolatility.realized,
            regime: result.regimeAnalysis.currentRegime,
            persistence: result.garchModel.persistence,
            forecast: result.volatilityForecast.summary.nearTerm.volatility
        });

        if (this.volatilityHistory.length > this.maxHistorySize) {
            this.volatilityHistory = this.volatilityHistory.slice(-this.maxHistorySize);
        }
    }

    getDefaultResult() {
        return {
            garchModel: {
                parameters: { alpha: 0.1, beta: 0.85, omega: 0.000001 },
                conditionalVariances: [],
                unconditionalVariance: 0.01,
                logLikelihood: 0,
                aic: 0,
                bic: 0,
                persistence: 0.95,
                halfLife: 14,
                stationarity: true
            },
            volatilityForecast: {
                forecasts: [],
                summary: {
                    nearTerm: { volatility: 0.02, annualizedVolatility: 0.3 },
                    mediumTerm: { volatility: 0.02, annualizedVolatility: 0.3 },
                    longTerm: { volatility: 0.02, annualizedVolatility: 0.3 }
                },
                trend: 'stable',
                uncertainty: 0.3
            },
            clusteringAnalysis: {
                clusteringScore: 0.5,
                clusters: [],
                clusterStatistics: {},
                currentCluster: null,
                clusteringLevel: 'moderate',
                predictedDuration: 5
            },
            regimeAnalysis: {
                regimes: [],
                currentRegime: 'moderate',
                regimeDuration: 1,
                transitions: [],
                persistence: {},
                regimeStats: {},
                transitionProbabilities: {}
            },
            persistenceAnalysis: {
                persistence: 0.95,
                level: 'high',
                halfLife: 14,
                impulseResponse: [],
                interpretation: 'High persistence',
                implications: []
            },
            meanReversionAnalysis: {
                reversionSpeed: 0.05,
                reversionStrength: 'weak',
                distanceFromMean: 0.1,
                timeToRevert: 20,
                longTermMean: 0.02,
                currentLevel: 0.022,
                reversionPressure: 0.005
            },
            riskMetrics: {
                currentVolatility: 0.02,
                annualizedVolatility: 0.3,
                var95: 0.03,
                var99: 0.05,
                expectedShortfall95: 0.04,
                expectedShortfall99: 0.06,
                volatilityRisk: { riskLevel: 'moderate' },
                dynamicRisk: { riskAcceleration: 'moderate' },
                riskLevel: 'moderate',
                recommendations: []
            },
            modelValidation: {
                ljungBoxTest: { reject: false },
                archLMTest: { reject: false },
                jarqueBeraTest: { reject: false },
                adequacy: { level: 'adequate', score: 1, issues: [] },
                goodnessOfFit: { fit: 'good', pseudoRSquared: 0.15 },
                standardizedResiduals: [],
                diagnostics: []
            },
            volatilitySurface: null,
            currentVolatility: {
                realized: 0.02,
                annualized: 0.3,
                level: 'moderate'
            },
            recommendations: {},
            alerts: [],
            notes: "GARCH volatilite analizi yapılamadı - yetersiz veri",
            metadata: {
                error: true,
                analysisTimestamp: Date.now()
            }
        };
    }

    getModuleInfo() {
        return {
            name: 'GarchVolatilityEstimator',
            version: '1.0.0',
            description: 'GARCH model ile volatilite tahmini ve clustering analizi - Volatility forecasting, regime detection ve risk metrics',
            inputs: [
                'symbol', 'price', 'returns', 'volume', 'historicalPrices', 'timeframe',
                'marketData', 'volatilityIndex', 'impliedVolatility', 'realizedVolatility',
                'optionsData', 'macroEvents', 'newsFlow', 'liquidityMetrics', 'marketMicrostructure'
            ],
            outputs: [
                'garchModel', 'volatilityForecast', 'clusteringAnalysis', 'regimeAnalysis',
                'persistenceAnalysis', 'meanReversionAnalysis', 'riskMetrics', 'modelValidation',
                'volatilitySurface', 'currentVolatility', 'recommendations', 'alerts', 'notes', 'metadata'
            ]
        };
    }
}

module.exports = GarchVolatilityEstimator;
