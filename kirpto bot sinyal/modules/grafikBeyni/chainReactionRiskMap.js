const GrafikBeyniModuleBase = require('../grafikBeyniModuleBase');

/**
 * Chain Reaction Risk Map Module
 * Zincirleme risk haritalaması ve risk yayılım analizi
 * Risk cascade modeling, contagion effects, systemic risk assessment
 */
class ChainReactionRiskMap extends GrafikBeyniModuleBase {
    constructor() {
        super('chainReactionRiskMap');
        this.riskNetwork = new Map();
        this.cascadeHistory = [];
        this.riskThresholds = {
            low: 0.2,
            moderate: 0.4,
            high: 0.6,
            critical: 0.8,
            systemic: 0.9
        };
        this.contagionFactors = {
            correlation: 0.3,      // Price correlation impact
            liquidity: 0.25,       // Liquidity coupling
            sentiment: 0.2,        // Sentiment transmission
            structure: 0.15,       // Market structure
            macro: 0.1            // Macro environment
        };
        this.propagationDelays = {
            immediate: 0,          // 0 periods
            short: 1,              // 1 period
            medium: 5,             // 5 periods  
            long: 20               // 20 periods
        };
        this.networkDepth = 3;     // Maximum cascade depth
        this.maxHistorySize = 200;
        this.minObservations = 50;
    }

    async analyze(data) {
        try {
            const {
                symbol,
                price,
                historicalPrices,
                volume,
                timeframe,
                marketData,
                correlationMatrix,
                liquidityMetrics,
                sentimentData,
                macroEnvironment,
                systemicIndicators,
                crossAssetData,
                volatilityData,
                flowData,
                newsEvents,
                marketMicrostructure,
                riskFactors
            } = data;

            // Veri doğrulama
            if (!historicalPrices || historicalPrices.length < this.minObservations) {
                throw new Error('Insufficient data for chain reaction risk analysis');
            }

            // Risk network construction
            const riskNetwork = this.buildRiskNetwork(data, correlationMatrix, crossAssetData);

            // Current risk assessment
            const currentRiskProfile = this.assessCurrentRisk(price, historicalPrices, marketData, 
                                                            riskFactors);

            // Cascade scenario modeling
            const cascadeScenarios = this.modelCascadeScenarios(riskNetwork, currentRiskProfile, 
                                                              systemicIndicators);

            // Contagion pathway analysis
            const contagionPathways = this.analyzeContagionPathways(riskNetwork, cascadeScenarios);

            // Risk amplification analysis
            const amplificationAnalysis = this.analyzeRiskAmplification(riskNetwork, 
                                                                       currentRiskProfile, flowData);

            // Systemic risk indicators
            const systemicRiskAnalysis = this.analyzeSystemicRisk(riskNetwork, cascadeScenarios, 
                                                                systemicIndicators);

            // Cascade timing analysis
            const timingAnalysis = this.analyzeCascadeTiming(cascadeScenarios, contagionPathways);

            // Risk mitigation pathways
            const mitigationAnalysis = this.analyzeMitigationPathways(riskNetwork, cascadeScenarios);

            // Early warning system
            const earlyWarningSystem = this.buildEarlyWarningSystem(riskNetwork, 
                                                                   currentRiskProfile, 
                                                                   systemicRiskAnalysis);

            // Network resilience analysis
            const resilienceAnalysis = this.analyzeNetworkResilience(riskNetwork, cascadeScenarios);

            // Dynamic risk mapping
            const dynamicRiskMap = this.createDynamicRiskMap(riskNetwork, currentRiskProfile, 
                                                           cascadeScenarios);

            const result = {
                riskNetwork: riskNetwork,
                currentRiskProfile: currentRiskProfile,
                cascadeScenarios: cascadeScenarios,
                contagionPathways: contagionPathways,
                amplificationAnalysis: amplificationAnalysis,
                systemicRiskAnalysis: systemicRiskAnalysis,
                timingAnalysis: timingAnalysis,
                mitigationAnalysis: mitigationAnalysis,
                earlyWarningSystem: earlyWarningSystem,
                resilienceAnalysis: resilienceAnalysis,
                dynamicRiskMap: dynamicRiskMap,
                currentStatus: this.getCurrentStatus(currentRiskProfile, systemicRiskAnalysis),
                recommendations: this.generateRecommendations(cascadeScenarios, mitigationAnalysis, 
                                                            currentRiskProfile),
                alerts: this.generateAlerts(earlyWarningSystem, systemicRiskAnalysis, 
                                          currentRiskProfile),
                notes: this.generateNotes(riskNetwork, cascadeScenarios, systemicRiskAnalysis),
                metadata: {
                    analysisTimestamp: Date.now(),
                    symbol: symbol,
                    timeframe: timeframe,
                    networkSize: riskNetwork.nodes.length,
                    cascadeCount: cascadeScenarios.length,
                    riskLevel: currentRiskProfile.level,
                    systemicRisk: systemicRiskAnalysis.level,
                    networkResilience: resilienceAnalysis.score
                }
            };

            // History güncelleme
            this.updateCascadeHistory(result, data);

            // Cache ve performance tracking
            this.updateCache(data, result);
            this.trackPerformance(Date.now(), systemicRiskAnalysis.accuracy > 0.7);

            return result;

        } catch (error) {
            this.handleError('ChainReactionRiskMap analysis failed', error, data);
            return this.getDefaultResult();
        }
    }

    buildRiskNetwork(data, correlationMatrix, crossAssetData) {
        const nodes = [];
        const edges = [];
        
        // Primary node (current asset)
        const primaryNode = {
            id: data.symbol,
            type: 'primary',
            riskScore: this.calculateNodeRiskScore(data),
            liquidity: data.liquidityMetrics?.score || 0.5,
            volatility: data.volatilityData?.current || 0.2,
            sentiment: data.sentimentData?.overall || 0.5,
            systemicImportance: this.calculateSystemicImportance(data)
        };
        nodes.push(primaryNode);
        
        // Connected nodes from cross-asset data
        if (crossAssetData) {
            crossAssetData.forEach(asset => {
                const node = {
                    id: asset.symbol,
                    type: 'connected',
                    riskScore: this.calculateNodeRiskScore(asset),
                    liquidity: asset.liquidity || 0.5,
                    volatility: asset.volatility || 0.2,
                    sentiment: asset.sentiment || 0.5,
                    systemicImportance: this.calculateSystemicImportance(asset)
                };
                nodes.push(node);
                
                // Create edge if correlation exists
                if (correlationMatrix && correlationMatrix[data.symbol] && 
                    correlationMatrix[data.symbol][asset.symbol]) {
                    
                    const correlation = correlationMatrix[data.symbol][asset.symbol];
                    const edge = {
                        from: data.symbol,
                        to: asset.symbol,
                        weight: Math.abs(correlation),
                        type: correlation > 0 ? 'positive' : 'negative',
                        contagionRisk: this.calculateContagionRisk(primaryNode, node, correlation)
                    };
                    edges.push(edge);
                }
            });
        }
        
        // Network metrics
        const networkMetrics = this.calculateNetworkMetrics(nodes, edges);
        
        return {
            nodes: nodes,
            edges: edges,
            metrics: networkMetrics,
            centralityScores: this.calculateCentralityScores(nodes, edges),
            clusteringCoefficient: this.calculateClusteringCoefficient(nodes, edges)
        };
    }

    assessCurrentRisk(price, historicalPrices, marketData, riskFactors) {
        // Price risk assessment
        const priceRisk = this.assessPriceRisk(price, historicalPrices);
        
        // Volume risk
        const volumeRisk = this.assessVolumeRisk(marketData?.volume, historicalPrices);
        
        // Liquidity risk
        const liquidityRisk = this.assessLiquidityRisk(marketData?.liquidity);
        
        // Volatility risk
        const volatilityRisk = this.assessVolatilityRisk(historicalPrices);
        
        // External risk factors
        const externalRisk = this.assessExternalRisk(riskFactors);
        
        // Aggregate risk score
        const aggregateRisk = this.calculateAggregateRisk({
            price: priceRisk,
            volume: volumeRisk,
            liquidity: liquidityRisk,
            volatility: volatilityRisk,
            external: externalRisk
        });
        
        return {
            components: {
                price: priceRisk,
                volume: volumeRisk,
                liquidity: liquidityRisk,
                volatility: volatilityRisk,
                external: externalRisk
            },
            aggregate: aggregateRisk,
            level: this.classifyRiskLevel(aggregateRisk),
            trend: this.calculateRiskTrend(historicalPrices),
            confidence: this.calculateRiskConfidence(aggregateRisk)
        };
    }

    modelCascadeScenarios(riskNetwork, currentRiskProfile, systemicIndicators) {
        const scenarios = [];
        
        // Mild stress scenario
        scenarios.push(this.createCascadeScenario('mild_stress', riskNetwork, 
                                                 currentRiskProfile, 0.3));
        
        // Moderate stress scenario
        scenarios.push(this.createCascadeScenario('moderate_stress', riskNetwork, 
                                                 currentRiskProfile, 0.5));
        
        // Severe stress scenario  
        scenarios.push(this.createCascadeScenario('severe_stress', riskNetwork, 
                                                 currentRiskProfile, 0.7));
        
        // Systemic crisis scenario
        scenarios.push(this.createCascadeScenario('systemic_crisis', riskNetwork, 
                                                 currentRiskProfile, 0.9));
        
        // Custom scenarios based on systemic indicators
        if (systemicIndicators) {
            const customScenario = this.createCustomScenario(riskNetwork, 
                                                            currentRiskProfile, 
                                                            systemicIndicators);
            scenarios.push(customScenario);
        }
        
        return scenarios;
    }

    createCascadeScenario(scenarioType, riskNetwork, currentRiskProfile, stressLevel) {
        const cascadeSteps = [];
        const affectedNodes = new Set();
        
        // Initial shock
        const initialShock = {
            step: 0,
            trigger: 'external_shock',
            intensity: stressLevel,
            affectedNodes: [riskNetwork.nodes[0].id], // Primary node
            riskIncrease: stressLevel * 0.5
        };
        cascadeSteps.push(initialShock);
        affectedNodes.add(riskNetwork.nodes[0].id);
        
        // Propagation through network
        for (let step = 1; step <= this.networkDepth; step++) {
            const propagationStep = this.simulatePropagationStep(
                riskNetwork, affectedNodes, stressLevel, step
            );
            
            if (propagationStep.affectedNodes.length > 0) {
                cascadeSteps.push(propagationStep);
                propagationStep.affectedNodes.forEach(nodeId => affectedNodes.add(nodeId));
            } else {
                break; // No further propagation
            }
        }
        
        // Calculate scenario metrics
        const scenarioMetrics = this.calculateScenarioMetrics(cascadeSteps, riskNetwork);
        
        return {
            type: scenarioType,
            stressLevel: stressLevel,
            cascadeSteps: cascadeSteps,
            metrics: scenarioMetrics,
            totalAffectedNodes: affectedNodes.size,
            maxDepth: cascadeSteps.length,
            systemicImpact: this.calculateSystemicImpact(scenarioMetrics, riskNetwork)
        };
    }

    simulatePropagationStep(riskNetwork, currentlyAffected, stressLevel, step) {
        const newlyAffected = [];
        const propagationDelay = this.propagationDelays.short;
        
        // Find edges from currently affected nodes
        const propagationEdges = riskNetwork.edges.filter(edge => 
            currentlyAffected.has(edge.from) && !currentlyAffected.has(edge.to)
        );
        
        propagationEdges.forEach(edge => {
            const contagionProbability = this.calculateContagionProbability(
                edge, stressLevel, step
            );
            
            if (contagionProbability > 0.3) { // Threshold for propagation
                newlyAffected.push(edge.to);
            }
        });
        
        return {
            step: step,
            trigger: 'contagion',
            delay: propagationDelay,
            affectedNodes: newlyAffected,
            riskIncrease: stressLevel * Math.pow(0.8, step), // Diminishing effect
            contagionProbabilities: propagationEdges.map(edge => ({
                from: edge.from,
                to: edge.to,
                probability: this.calculateContagionProbability(edge, stressLevel, step)
            }))
        };
    }

    analyzeContagionPathways(riskNetwork, cascadeScenarios) {
        const pathways = [];
        
        cascadeScenarios.forEach(scenario => {
            const scenarioPathways = this.extractPathwaysFromScenario(scenario, riskNetwork);
            pathways.push(...scenarioPathways);
        });
        
        // Pathway analysis
        const pathwayAnalysis = this.analyzePathwayCharacteristics(pathways);
        
        // Critical pathways identification
        const criticalPathways = this.identifyCriticalPathways(pathways, pathwayAnalysis);
        
        return {
            pathways: pathways,
            analysis: pathwayAnalysis,
            criticalPathways: criticalPathways,
            vulnerabilities: this.identifyPathwayVulnerabilities(pathways),
            chokePoints: this.identifyChokePoints(pathways, riskNetwork)
        };
    }

    analyzeRiskAmplification(riskNetwork, currentRiskProfile, flowData) {
        const amplificationFactors = [];
        
        // Leverage amplification
        amplificationFactors.push({
            type: 'leverage',
            factor: this.calculateLeverageAmplification(flowData),
            impact: 'multiplicative'
        });
        
        // Liquidity amplification
        amplificationFactors.push({
            type: 'liquidity',
            factor: this.calculateLiquidityAmplification(riskNetwork),
            impact: 'exponential'
        });
        
        // Sentiment amplification
        amplificationFactors.push({
            type: 'sentiment',
            factor: this.calculateSentimentAmplification(riskNetwork),
            impact: 'viral'
        });
        
        // Network amplification
        amplificationFactors.push({
            type: 'network',
            factor: this.calculateNetworkAmplification(riskNetwork),
            impact: 'cascading'
        });
        
        // Overall amplification score
        const overallAmplification = this.calculateOverallAmplification(amplificationFactors);
        
        return {
            factors: amplificationFactors,
            overallAmplification: overallAmplification,
            amplificationLevel: this.classifyAmplificationLevel(overallAmplification),
            riskMultiplier: this.calculateRiskMultiplier(amplificationFactors),
            dampingMechanisms: this.identifyDampingMechanisms(riskNetwork)
        };
    }

    analyzeSystemicRisk(riskNetwork, cascadeScenarios, systemicIndicators) {
        // Systemic risk indicators
        const indicators = {
            networkConnectedness: this.calculateNetworkConnectedness(riskNetwork),
            concentrationRisk: this.calculateConcentrationRisk(riskNetwork),
            correlationRisk: this.calculateCorrelationRisk(riskNetwork),
            liquidityRisk: this.calculateSystemicLiquidityRisk(riskNetwork),
            volatilitySpillover: this.calculateVolatilitySpillover(riskNetwork)
        };
        
        // External systemic indicators
        if (systemicIndicators) {
            indicators.external = this.incorporateExternalIndicators(systemicIndicators);
        }
        
        // Systemic risk score
        const systemicRiskScore = this.calculateSystemicRiskScore(indicators);
        
        // Risk level classification
        const riskLevel = this.classifySystemicRiskLevel(systemicRiskScore);
        
        // Systemic scenarios probability
        const scenarioProbabilities = this.calculateScenarioProbabilities(cascadeScenarios, indicators);
        
        return {
            indicators: indicators,
            systemicRiskScore: systemicRiskScore,
            level: riskLevel,
            scenarioProbabilities: scenarioProbabilities,
            vulnerabilities: this.identifySystemicVulnerabilities(indicators),
            riskFactors: this.identifySystemicRiskFactors(indicators),
            accuracy: this.calculateSystemicRiskAccuracy(indicators)
        };
    }

    analyzeCascadeTiming(cascadeScenarios, contagionPathways) {
        const timingAnalysis = {};
        
        cascadeScenarios.forEach(scenario => {
            const scenarioTiming = {
                initialDelay: 0,
                propagationSpeed: this.calculatePropagationSpeed(scenario),
                totalDuration: this.calculateTotalDuration(scenario),
                criticalTimings: this.identifyCriticalTimings(scenario)
            };
            
            timingAnalysis[scenario.type] = scenarioTiming;
        });
        
        // Pathway timing analysis
        const pathwayTiming = this.analyzePathwayTiming(contagionPathways);
        
        return {
            scenarioTiming: timingAnalysis,
            pathwayTiming: pathwayTiming,
            averagePropagationSpeed: this.calculateAveragePropagationSpeed(timingAnalysis),
            criticalTimeWindows: this.identifyCriticalTimeWindows(timingAnalysis)
        };
    }

    analyzeMitigationPathways(riskNetwork, cascadeScenarios) {
        const mitigationStrategies = [];
        
        // Network-based mitigation
        mitigationStrategies.push({
            type: 'network_isolation',
            strategy: this.designNetworkIsolationStrategy(riskNetwork),
            effectiveness: this.calculateMitigationEffectiveness(riskNetwork, 'isolation')
        });
        
        // Liquidity-based mitigation
        mitigationStrategies.push({
            type: 'liquidity_injection',
            strategy: this.designLiquidityMitigationStrategy(riskNetwork),
            effectiveness: this.calculateMitigationEffectiveness(riskNetwork, 'liquidity')
        });
        
        // Volatility-based mitigation
        mitigationStrategies.push({
            type: 'volatility_control',
            strategy: this.designVolatilityMitigationStrategy(riskNetwork),
            effectiveness: this.calculateMitigationEffectiveness(riskNetwork, 'volatility')
        });
        
        // Scenario-specific mitigation
        cascadeScenarios.forEach(scenario => {
            const scenarioMitigation = this.designScenarioMitigation(scenario, riskNetwork);
            mitigationStrategies.push(scenarioMitigation);
        });
        
        return {
            strategies: mitigationStrategies,
            optimalStrategy: this.selectOptimalMitigationStrategy(mitigationStrategies),
            mitigationPriorities: this.calculateMitigationPriorities(mitigationStrategies),
            costBenefitAnalysis: this.performCostBenefitAnalysis(mitigationStrategies)
        };
    }

    buildEarlyWarningSystem(riskNetwork, currentRiskProfile, systemicRiskAnalysis) {
        // Warning indicators
        const indicators = {
            networkStress: this.calculateNetworkStressIndicator(riskNetwork),
            correlationSpike: this.calculateCorrelationSpikeIndicator(riskNetwork),
            liquidityDry: this.calculateLiquidityDryIndicator(riskNetwork),
            volatilityCluster: this.calculateVolatilityClusterIndicator(riskNetwork),
            sentimentExtreme: this.calculateSentimentExtremeIndicator(riskNetwork)
        };
        
        // Warning levels
        const warningLevels = this.calculateWarningLevels(indicators, currentRiskProfile);
        
        // Alert triggers
        const alertTriggers = this.defineAlertTriggers(indicators, systemicRiskAnalysis);
        
        return {
            indicators: indicators,
            warningLevels: warningLevels,
            alertTriggers: alertTriggers,
            currentStatus: this.determineCurrentWarningStatus(warningLevels),
            recommendations: this.generateWarningRecommendations(warningLevels, alertTriggers)
        };
    }

    analyzeNetworkResilience(riskNetwork, cascadeScenarios) {
        // Resilience metrics
        const resilience = {
            connectivity: this.calculateConnectivityResilience(riskNetwork),
            redundancy: this.calculateRedundancyResilience(riskNetwork),
            adaptability: this.calculateAdaptabilityResilience(riskNetwork),
            recovery: this.calculateRecoveryResilience(cascadeScenarios)
        };
        
        // Overall resilience score
        const overallResilience = this.calculateOverallResilience(resilience);
        
        // Stress testing
        const stressTestResults = this.performNetworkStressTest(riskNetwork, cascadeScenarios);
        
        return {
            metrics: resilience,
            overallScore: overallResilience,
            resilienceLevel: this.classifyResilienceLevel(overallResilience),
            stressTestResults: stressTestResults,
            improvementAreas: this.identifyResilienceImprovementAreas(resilience),
            strengthAreas: this.identifyResilienceStrengthAreas(resilience)
        };
    }

    createDynamicRiskMap(riskNetwork, currentRiskProfile, cascadeScenarios) {
        return {
            riskHeatMap: this.generateRiskHeatMap(riskNetwork, currentRiskProfile),
            cascadeFlowMap: this.generateCascadeFlowMap(cascadeScenarios),
            vulnerabilityMap: this.generateVulnerabilityMap(riskNetwork),
            timeEvolutionMap: this.generateTimeEvolutionMap(cascadeScenarios),
            interactionMap: this.generateInteractionMap(riskNetwork)
        };
    }

    getCurrentStatus(currentRiskProfile, systemicRiskAnalysis) {
        return {
            riskLevel: currentRiskProfile.level,
            riskScore: currentRiskProfile.aggregate,
            systemicRisk: systemicRiskAnalysis.level,
            riskTrend: currentRiskProfile.trend,
            cascadeRisk: this.assessCascadeRisk(currentRiskProfile, systemicRiskAnalysis),
            alertLevel: this.determineAlertLevel(currentRiskProfile, systemicRiskAnalysis)
        };
    }

    // Helper methods for calculations
    calculateNodeRiskScore(nodeData) {
        const factors = {
            volatility: nodeData.volatilityData?.current || 0.2,
            liquidity: 1 - (nodeData.liquidityMetrics?.score || 0.5),
            sentiment: Math.abs((nodeData.sentimentData?.overall || 0.5) - 0.5) * 2,
            volume: nodeData.volume ? this.normalizeVolume(nodeData.volume) : 0.3
        };
        
        return Object.values(factors).reduce((sum, factor) => sum + factor, 0) / Object.keys(factors).length;
    }

    calculateSystemicImportance(nodeData) {
        // Simplified systemic importance calculation
        const marketCap = nodeData.marketCap || 1;
        const volume = nodeData.volume || 1;
        const connections = nodeData.connections || 1;
        
        return Math.log(marketCap * volume * connections) / 20; // Normalized
    }

    calculateContagionRisk(node1, node2, correlation) {
        const riskDifferential = Math.abs(node1.riskScore - node2.riskScore);
        const liquidityFactor = Math.min(node1.liquidity, node2.liquidity);
        const correlationFactor = Math.abs(correlation);
        
        return (riskDifferential + (1 - liquidityFactor) + correlationFactor) / 3;
    }

    calculateNetworkMetrics(nodes, edges) {
        return {
            nodeCount: nodes.length,
            edgeCount: edges.length,
            density: edges.length / (nodes.length * (nodes.length - 1) / 2),
            averageDegree: (2 * edges.length) / nodes.length,
            maxRiskScore: Math.max(...nodes.map(n => n.riskScore)),
            averageRiskScore: nodes.reduce((sum, n) => sum + n.riskScore, 0) / nodes.length
        };
    }

    calculateCentralityScores(nodes, edges) {
        const centrality = {};
        
        nodes.forEach(node => {
            const degree = edges.filter(e => e.from === node.id || e.to === node.id).length;
            centrality[node.id] = degree / (nodes.length - 1);
        });
        
        return centrality;
    }

    calculateClusteringCoefficient(nodes, edges) {
        // Simplified clustering coefficient
        let totalClustering = 0;
        
        nodes.forEach(node => {
            const neighbors = this.getNeighbors(node.id, edges);
            if (neighbors.length < 2) return;
            
            const possibleConnections = neighbors.length * (neighbors.length - 1) / 2;
            const actualConnections = this.countNeighborConnections(neighbors, edges);
            
            totalClustering += actualConnections / possibleConnections;
        });
        
        return totalClustering / nodes.length;
    }

    getNeighbors(nodeId, edges) {
        const neighbors = [];
        edges.forEach(edge => {
            if (edge.from === nodeId) neighbors.push(edge.to);
            if (edge.to === nodeId) neighbors.push(edge.from);
        });
        return [...new Set(neighbors)];
    }

    countNeighborConnections(neighbors, edges) {
        let count = 0;
        for (let i = 0; i < neighbors.length; i++) {
            for (let j = i + 1; j < neighbors.length; j++) {
                const connected = edges.some(e => 
                    (e.from === neighbors[i] && e.to === neighbors[j]) ||
                    (e.from === neighbors[j] && e.to === neighbors[i])
                );
                if (connected) count++;
            }
        }
        return count;
    }

    assessPriceRisk(price, historicalPrices) {
        const recentPrices = historicalPrices.slice(-20);
        const volatility = this.calculateVolatility(recentPrices);
        const deviation = this.calculatePriceDeviation(price, recentPrices);
        
        return Math.min(1, (volatility + Math.abs(deviation)) / 2);
    }

    assessVolumeRisk(currentVolume, historicalPrices) {
        if (!currentVolume) return 0.3;
        
        // Would need historical volume data
        const averageVolume = currentVolume; // Simplified
        const volumeRatio = currentVolume / averageVolume;
        
        return Math.abs(Math.log(volumeRatio)) / 3; // Normalized log ratio
    }

    assessLiquidityRisk(liquidityMetrics) {
        if (!liquidityMetrics) return 0.5;
        
        return 1 - liquidityMetrics.score; // Higher score = lower risk
    }

    assessVolatilityRisk(historicalPrices) {
        const volatility = this.calculateVolatility(historicalPrices.slice(-20));
        return Math.min(1, volatility / 0.5); // Normalized to 50% max volatility
    }

    assessExternalRisk(riskFactors) {
        if (!riskFactors) return 0.3;
        
        return Object.values(riskFactors).reduce((sum, factor) => sum + factor, 0) / 
               Object.keys(riskFactors).length;
    }

    calculateAggregateRisk(riskComponents) {
        const weights = {
            price: 0.25,
            volume: 0.15,
            liquidity: 0.25,
            volatility: 0.20,
            external: 0.15
        };
        
        return Object.keys(riskComponents).reduce((sum, component) => {
            return sum + (riskComponents[component] * weights[component]);
        }, 0);
    }

    classifyRiskLevel(riskScore) {
        if (riskScore >= this.riskThresholds.systemic) return 'systemic';
        if (riskScore >= this.riskThresholds.critical) return 'critical';
        if (riskScore >= this.riskThresholds.high) return 'high';
        if (riskScore >= this.riskThresholds.moderate) return 'moderate';
        return 'low';
    }

    calculateVolatility(prices) {
        if (prices.length < 2) return 0;
        
        const returns = [];
        for (let i = 1; i < prices.length; i++) {
            returns.push(Math.log(prices[i] / prices[i - 1]));
        }
        
        const mean = returns.reduce((sum, r) => sum + r, 0) / returns.length;
        const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / returns.length;
        
        return Math.sqrt(variance);
    }

    calculatePriceDeviation(currentPrice, historicalPrices) {
        const average = historicalPrices.reduce((sum, p) => sum + p, 0) / historicalPrices.length;
        return (currentPrice - average) / average;
    }

    normalizeVolume(volume) {
        // Simplified volume normalization
        return Math.min(1, volume / 1000000); // Assuming 1M is high volume
    }

    generateRecommendations(cascadeScenarios, mitigationAnalysis, currentRiskProfile) {
        const recommendations = {};
        
        // Risk level recommendations
        if (currentRiskProfile.level === 'critical' || currentRiskProfile.level === 'systemic') {
            recommendations.immediate = {
                action: 'reduce_exposure',
                urgency: 'high',
                reason: 'critical_risk_levels'
            };
        }
        
        // Cascade scenario recommendations
        const highProbabilityScenarios = cascadeScenarios.filter(s => s.metrics.probability > 0.3);
        if (highProbabilityScenarios.length > 0) {
            recommendations.cascade = {
                action: 'implement_cascade_protection',
                scenarios: highProbabilityScenarios.map(s => s.type),
                priority: 'high'
            };
        }
        
        // Mitigation recommendations
        if (mitigationAnalysis.optimalStrategy) {
            recommendations.mitigation = {
                action: 'implement_mitigation',
                strategy: mitigationAnalysis.optimalStrategy.type,
                effectiveness: mitigationAnalysis.optimalStrategy.effectiveness
            };
        }
        
        return recommendations;
    }

    generateAlerts(earlyWarningSystem, systemicRiskAnalysis, currentRiskProfile) {
        const alerts = [];
        
        // Early warning alerts
        if (earlyWarningSystem.currentStatus === 'warning' || 
            earlyWarningSystem.currentStatus === 'critical') {
            alerts.push({
                level: 'warning',
                message: 'Erken uyarı sistemi tetiklendi',
                action: 'Risk seviyelerini gözden geçir'
            });
        }
        
        // Systemic risk alert
        if (systemicRiskAnalysis.level === 'critical' || systemicRiskAnalysis.level === 'systemic') {
            alerts.push({
                level: 'critical',
                message: 'Yüksek sistemik risk tespit edildi',
                action: 'Acil risk yönetimi tedbirleri al'
            });
        }
        
        // Risk trend alert
        if (currentRiskProfile.trend === 'increasing') {
            alerts.push({
                level: 'info',
                message: 'Risk seviyesi artış eğiliminde',
                action: 'Risk izlemeyi artır'
            });
        }
        
        return alerts;
    }

    generateNotes(riskNetwork, cascadeScenarios, systemicRiskAnalysis) {
        const notes = [];
        
        notes.push(`Risk ağı: ${riskNetwork.nodes.length} düğüm, ${riskNetwork.edges.length} bağlantı`);
        notes.push(`Cascade senaryoları: ${cascadeScenarios.length} senaryo`);
        notes.push(`Sistemik risk seviyesi: ${systemicRiskAnalysis.level}`);
        
        const highRiskScenarios = cascadeScenarios.filter(s => s.systemicImpact > 0.7);
        if (highRiskScenarios.length > 0) {
            notes.push(`Yüksek etkili ${highRiskScenarios.length} cascade senaryosu`);
        }
        
        return notes.join('. ');
    }

    updateCascadeHistory(result, data) {
        this.cascadeHistory.push({
            timestamp: Date.now(),
            riskLevel: result.currentRiskProfile.level,
            systemicRisk: result.systemicRiskAnalysis.level,
            cascadeCount: result.cascadeScenarios.length,
            networkSize: result.riskNetwork.nodes.length
        });

        if (this.cascadeHistory.length > this.maxHistorySize) {
            this.cascadeHistory = this.cascadeHistory.slice(-this.maxHistorySize);
        }
    }

    getDefaultResult() {
        return {
            riskNetwork: {
                nodes: [],
                edges: [],
                metrics: { nodeCount: 0, edgeCount: 0, density: 0, averageDegree: 0 },
                centralityScores: {},
                clusteringCoefficient: 0
            },
            currentRiskProfile: {
                components: {
                    price: 0.3,
                    volume: 0.3,
                    liquidity: 0.3,
                    volatility: 0.3,
                    external: 0.3
                },
                aggregate: 0.3,
                level: 'moderate',
                trend: 'stable',
                confidence: 0.5
            },
            cascadeScenarios: [],
            contagionPathways: {
                pathways: [],
                analysis: {},
                criticalPathways: [],
                vulnerabilities: [],
                chokePoints: []
            },
            amplificationAnalysis: {
                factors: [],
                overallAmplification: 1,
                amplificationLevel: 'moderate',
                riskMultiplier: 1,
                dampingMechanisms: []
            },
            systemicRiskAnalysis: {
                indicators: {},
                systemicRiskScore: 0.3,
                level: 'moderate',
                scenarioProbabilities: {},
                vulnerabilities: [],
                riskFactors: [],
                accuracy: 0.5
            },
            timingAnalysis: {
                scenarioTiming: {},
                pathwayTiming: {},
                averagePropagationSpeed: 0.5,
                criticalTimeWindows: []
            },
            mitigationAnalysis: {
                strategies: [],
                optimalStrategy: null,
                mitigationPriorities: [],
                costBenefitAnalysis: {}
            },
            earlyWarningSystem: {
                indicators: {},
                warningLevels: {},
                alertTriggers: {},
                currentStatus: 'normal',
                recommendations: []
            },
            resilienceAnalysis: {
                metrics: {},
                overallScore: 0.5,
                resilienceLevel: 'moderate',
                stressTestResults: {},
                improvementAreas: [],
                strengthAreas: []
            },
            dynamicRiskMap: {
                riskHeatMap: {},
                cascadeFlowMap: {},
                vulnerabilityMap: {},
                timeEvolutionMap: {},
                interactionMap: {}
            },
            currentStatus: {
                riskLevel: 'moderate',
                riskScore: 0.3,
                systemicRisk: 'moderate',
                riskTrend: 'stable',
                cascadeRisk: 'low',
                alertLevel: 'normal'
            },
            recommendations: {},
            alerts: [],
            notes: "Zincirleme risk analizi yapılamadı - yetersiz veri",
            metadata: {
                error: true,
                analysisTimestamp: Date.now()
            }
        };
    }

    getModuleInfo() {
        return {
            name: 'ChainReactionRiskMap',
            version: '1.0.0',
            description: 'Zincirleme risk haritalaması ve risk yayılım analizi - Risk cascade modeling, contagion effects, systemic risk assessment',
            inputs: [
                'symbol', 'price', 'historicalPrices', 'volume', 'timeframe', 'marketData',
                'correlationMatrix', 'liquidityMetrics', 'sentimentData', 'macroEnvironment',
                'systemicIndicators', 'crossAssetData', 'volatilityData', 'flowData',
                'newsEvents', 'marketMicrostructure', 'riskFactors'
            ],
            outputs: [
                'riskNetwork', 'currentRiskProfile', 'cascadeScenarios', 'contagionPathways',
                'amplificationAnalysis', 'systemicRiskAnalysis', 'timingAnalysis', 'mitigationAnalysis',
                'earlyWarningSystem', 'resilienceAnalysis', 'dynamicRiskMap', 'currentStatus',
                'recommendations', 'alerts', 'notes', 'metadata'
            ]
        };
    }
}

module.exports = ChainReactionRiskMap;
