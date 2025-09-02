const GrafikBeyniModuleBase = require('./grafikBeyniModuleBase');

/**
 * Teyit Zinciri Bias Guard Module
 * Confirmation bias'ı tespit eden ve koruyan sistem
 * Bias detection, confirmation chains, decision quality assessment
 */
class TeyitZinciriBiasGuard extends GrafikBeyniModuleBase {
    constructor() {
        super('teyitZinciriBiasGuard');
        this.biasHistory = [];
        this.confirmationChains = [];
        this.biasThresholds = {
            mild: 0.3,
            moderate: 0.5,
            strong: 0.7,
            extreme: 0.9
        };
        this.biasTypes = {
            confirmation: 'confirmation_bias',
            anchoring: 'anchoring_bias',
            availability: 'availability_bias',
            recency: 'recency_bias',
            overconfidence: 'overconfidence_bias',
            hindsight: 'hindsight_bias'
        };
        this.evidenceWeights = {
            technical: 0.25,
            fundamental: 0.25,
            sentiment: 0.2,
            macro: 0.15,
            news: 0.15
        };
        this.chainDepth = 5;          // Maximum confirmation chain depth
        this.lookbackWindow = 50;     // Analysis window
        this.maxHistorySize = 300;
        this.minEvidencePoints = 3;
    }

    async analyze(data) {
        try {
            const {
                symbol,
                currentAnalysis,
                historicalAnalyses,
                technicalSignals,
                fundamentalData,
                sentimentData,
                newsData,
                macroData,
                userDecisions,
                systemDecisions,
                performanceData,
                marketFeedback,
                alternativeViews,
                contradictoryEvidence,
                timeframe,
                confidence
            } = data;

            // Veri doğrulama
            if (!currentAnalysis || !historicalAnalyses || historicalAnalyses.length < this.minEvidencePoints) {
                throw new Error('Insufficient data for bias detection analysis');
            }

            // Evidence categorization
            const evidenceAnalysis = this.categorizeEvidence(data);

            // Confirmation bias detection
            const confirmationBiasAnalysis = this.detectConfirmationBias(currentAnalysis, 
                                                                        historicalAnalyses, 
                                                                        evidenceAnalysis);

            // Multiple bias types analysis
            const multipleBiasAnalysis = this.analyzeMultipleBiasTypes(data, evidenceAnalysis);

            // Confirmation chain analysis
            const confirmationChainAnalysis = this.analyzeConfirmationChains(currentAnalysis,
                                                                           historicalAnalyses,
                                                                           evidenceAnalysis);

            // Evidence quality assessment
            const evidenceQualityAnalysis = this.assessEvidenceQuality(evidenceAnalysis, 
                                                                      alternativeViews,
                                                                      contradictoryEvidence);

            // Decision quality analysis
            const decisionQualityAnalysis = this.analyzeDecisionQuality(userDecisions,
                                                                       systemDecisions,
                                                                       performanceData,
                                                                       evidenceAnalysis);

            // Bias pattern recognition
            const biasPatternAnalysis = this.recognizeBiasPatterns(historicalAnalyses, 
                                                                  evidenceAnalysis,
                                                                  performanceData);

            // Counter-evidence analysis
            const counterEvidenceAnalysis = this.analyzeCounterEvidence(currentAnalysis,
                                                                       contradictoryEvidence,
                                                                       alternativeViews);

            // Cognitive load assessment
            const cognitiveLoadAnalysis = this.assessCognitiveLoad(data, evidenceAnalysis);

            // Bias mitigation recommendations
            const mitigationRecommendations = this.generateMitigationRecommendations(
                confirmationBiasAnalysis,
                multipleBiasAnalysis,
                evidenceQualityAnalysis
            );

            // Debiasing techniques
            const debiasingTechniques = this.suggestDebiasingTechniques(multipleBiasAnalysis,
                                                                       biasPatternAnalysis);

            const result = {
                evidenceAnalysis: evidenceAnalysis,
                confirmationBiasAnalysis: confirmationBiasAnalysis,
                multipleBiasAnalysis: multipleBiasAnalysis,
                confirmationChainAnalysis: confirmationChainAnalysis,
                evidenceQualityAnalysis: evidenceQualityAnalysis,
                decisionQualityAnalysis: decisionQualityAnalysis,
                biasPatternAnalysis: biasPatternAnalysis,
                counterEvidenceAnalysis: counterEvidenceAnalysis,
                cognitiveLoadAnalysis: cognitiveLoadAnalysis,
                mitigationRecommendations: mitigationRecommendations,
                debiasingTechniques: debiasingTechniques,
                currentStatus: this.getCurrentStatus(confirmationBiasAnalysis, multipleBiasAnalysis),
                recommendations: this.generateRecommendations(confirmationBiasAnalysis, 
                                                            evidenceQualityAnalysis,
                                                            mitigationRecommendations),
                alerts: this.generateAlerts(confirmationBiasAnalysis, multipleBiasAnalysis, 
                                          evidenceQualityAnalysis),
                notes: this.generateNotes(confirmationBiasAnalysis, evidenceQualityAnalysis, 
                                        decisionQualityAnalysis),
                metadata: {
                    analysisTimestamp: Date.now(),
                    symbol: symbol,
                    timeframe: timeframe,
                    evidenceCount: evidenceAnalysis.totalEvidence,
                    biasLevel: confirmationBiasAnalysis.level,
                    decisionQuality: decisionQualityAnalysis.score,
                    chainDepth: confirmationChainAnalysis.maxDepth,
                    mitigationUrgency: mitigationRecommendations.urgency
                }
            };

            // History güncelleme
            this.updateBiasHistory(result, data);

            // Cache ve performance tracking
            this.updateCache(data, result);
            this.trackPerformance(Date.now(), decisionQualityAnalysis.score > 0.7);

            return result;

        } catch (error) {
            this.handleError('TeyitZinciriBiasGuard analysis failed', error, data);
            return this.getDefaultResult();
        }
    }

    categorizeEvidence(data) {
        const evidenceCategories = {
            technical: [],
            fundamental: [],
            sentiment: [],
            macro: [],
            news: []
        };

        // Technical evidence
        if (data.technicalSignals) {
            evidenceCategories.technical = this.extractTechnicalEvidence(data.technicalSignals);
        }

        // Fundamental evidence
        if (data.fundamentalData) {
            evidenceCategories.fundamental = this.extractFundamentalEvidence(data.fundamentalData);
        }

        // Sentiment evidence
        if (data.sentimentData) {
            evidenceCategories.sentiment = this.extractSentimentEvidence(data.sentimentData);
        }

        // Macro evidence
        if (data.macroData) {
            evidenceCategories.macro = this.extractMacroEvidence(data.macroData);
        }

        // News evidence
        if (data.newsData) {
            evidenceCategories.news = this.extractNewsEvidence(data.newsData);
        }

        // Evidence statistics
        const evidenceStats = this.calculateEvidenceStatistics(evidenceCategories);

        // Evidence balance analysis
        const evidenceBalance = this.analyzeEvidenceBalance(evidenceCategories);

        return {
            categories: evidenceCategories,
            statistics: evidenceStats,
            balance: evidenceBalance,
            totalEvidence: evidenceStats.total,
            dominantCategory: evidenceStats.dominant,
            evidenceQuality: this.assessOverallEvidenceQuality(evidenceCategories)
        };
    }

    detectConfirmationBias(currentAnalysis, historicalAnalyses, evidenceAnalysis) {
        // Analyze consistency in analysis direction
        const analysisConsistency = this.analyzeAnalysisConsistency(currentAnalysis, historicalAnalyses);

        // Evidence selection bias
        const evidenceSelectionBias = this.detectEvidenceSelectionBias(evidenceAnalysis);

        // Information filtering bias
        const informationFilteringBias = this.detectInformationFilteringBias(evidenceAnalysis);

        // Confirmation seeking pattern
        const confirmationSeekingPattern = this.detectConfirmationSeekingPattern(historicalAnalyses);

        // Disconfirming evidence avoidance
        const disconfirmingAvoidance = this.detectDisconfirmingAvoidance(evidenceAnalysis, 
                                                                        historicalAnalyses);

        // Overall confirmation bias score
        const confirmationBiasScore = this.calculateConfirmationBiasScore({
            analysisConsistency,
            evidenceSelectionBias,
            informationFilteringBias,
            confirmationSeekingPattern,
            disconfirmingAvoidance
        });

        // Bias level classification
        const biasLevel = this.classifyBiasLevel(confirmationBiasScore);

        return {
            components: {
                analysisConsistency: analysisConsistency,
                evidenceSelectionBias: evidenceSelectionBias,
                informationFilteringBias: informationFilteringBias,
                confirmationSeekingPattern: confirmationSeekingPattern,
                disconfirmingAvoidance: disconfirmingAvoidance
            },
            score: confirmationBiasScore,
            level: biasLevel,
            confidence: this.calculateBiasConfidence(confirmationBiasScore),
            riskFactor: this.calculateBiasRiskFactor(biasLevel),
            mitigationUrgency: this.calculateMitigationUrgency(biasLevel)
        };
    }

    analyzeMultipleBiasTypes(data, evidenceAnalysis) {
        const biasAnalyses = {};

        // Anchoring bias
        biasAnalyses.anchoring = this.detectAnchoringBias(data.currentAnalysis, 
                                                         data.historicalAnalyses);

        // Availability bias
        biasAnalyses.availability = this.detectAvailabilityBias(evidenceAnalysis, 
                                                               data.newsData);

        // Recency bias
        biasAnalyses.recency = this.detectRecencyBias(data.historicalAnalyses, 
                                                     evidenceAnalysis);

        // Overconfidence bias
        biasAnalyses.overconfidence = this.detectOverconfidenceBias(data.confidence, 
                                                                   data.performanceData);

        // Hindsight bias
        biasAnalyses.hindsight = this.detectHindsightBias(data.historicalAnalyses, 
                                                         data.performanceData);

        // Bias interaction analysis
        const biasInteractions = this.analyzeBiasInteractions(biasAnalyses);

        // Composite bias score
        const compositeBiasScore = this.calculateCompositeBiasScore(biasAnalyses);

        return {
            individual: biasAnalyses,
            interactions: biasInteractions,
            compositeScore: compositeBiasScore,
            dominantBias: this.identifyDominantBias(biasAnalyses),
            biasCluster: this.identifyBiasCluster(biasAnalyses),
            severityLevel: this.classifyBiasSeverity(compositeBiasScore)
        };
    }

    analyzeConfirmationChains(currentAnalysis, historicalAnalyses, evidenceAnalysis) {
        const chains = [];

        // Build confirmation chains
        for (let depth = 1; depth <= this.chainDepth; depth++) {
            const chain = this.buildConfirmationChain(currentAnalysis, historicalAnalyses, 
                                                     evidenceAnalysis, depth);
            if (chain) {
                chains.push(chain);
            }
        }

        // Chain characteristics analysis
        const chainCharacteristics = this.analyzeChainCharacteristics(chains);

        // Chain strength analysis
        const chainStrength = this.analyzeChainStrength(chains, evidenceAnalysis);

        // Chain vulnerability analysis
        const chainVulnerabilities = this.analyzeChainVulnerabilities(chains);

        return {
            chains: chains,
            characteristics: chainCharacteristics,
            strength: chainStrength,
            vulnerabilities: chainVulnerabilities,
            maxDepth: chains.length > 0 ? Math.max(...chains.map(c => c.depth)) : 0,
            averageStrength: chains.length > 0 ? 
                           chains.reduce((sum, c) => sum + c.strength, 0) / chains.length : 0,
            riskLevel: this.assessChainRiskLevel(chainCharacteristics, chainStrength)
        };
    }

    assessEvidenceQuality(evidenceAnalysis, alternativeViews, contradictoryEvidence) {
        // Individual category quality
        const categoryQualities = {};
        Object.keys(evidenceAnalysis.categories).forEach(category => {
            categoryQualities[category] = this.assessCategoryEvidenceQuality(
                evidenceAnalysis.categories[category]
            );
        });

        // Evidence diversity assessment
        const diversityAssessment = this.assessEvidenceDiversity(evidenceAnalysis);

        // Alternative view integration
        const alternativeViewIntegration = this.assessAlternativeViewIntegration(alternativeViews);

        // Contradictory evidence handling
        const contradictoryEvidenceHandling = this.assessContradictoryEvidenceHandling(
            contradictoryEvidence
        );

        // Source reliability assessment
        const sourceReliability = this.assessSourceReliability(evidenceAnalysis);

        // Overall evidence quality score
        const overallQuality = this.calculateOverallEvidenceQuality({
            categoryQualities,
            diversityAssessment,
            alternativeViewIntegration,
            contradictoryEvidenceHandling,
            sourceReliability
        });

        return {
            categoryQualities: categoryQualities,
            diversity: diversityAssessment,
            alternativeViews: alternativeViewIntegration,
            contradictoryHandling: contradictoryEvidenceHandling,
            sourceReliability: sourceReliability,
            overallScore: overallQuality,
            qualityLevel: this.classifyEvidenceQuality(overallQuality),
            improvementAreas: this.identifyEvidenceImprovementAreas(categoryQualities),
            qualityRisk: this.assessEvidenceQualityRisk(overallQuality)
        };
    }

    analyzeDecisionQuality(userDecisions, systemDecisions, performanceData, evidenceAnalysis) {
        // Decision consistency analysis
        const decisionConsistency = this.analyzeDecisionConsistency(userDecisions, systemDecisions);

        // Evidence-decision alignment
        const evidenceDecisionAlignment = this.analyzeEvidenceDecisionAlignment(
            userDecisions, systemDecisions, evidenceAnalysis
        );

        // Performance correlation
        const performanceCorrelation = this.analyzePerformanceCorrelation(
            userDecisions, systemDecisions, performanceData
        );

        // Decision timing quality
        const timingQuality = this.analyzeDecisionTimingQuality(userDecisions, systemDecisions);

        // Decision confidence calibration
        const confidenceCalibration = this.analyzeConfidenceCalibration(
            userDecisions, systemDecisions, performanceData
        );

        // Overall decision quality score
        const decisionQualityScore = this.calculateDecisionQualityScore({
            decisionConsistency,
            evidenceDecisionAlignment,
            performanceCorrelation,
            timingQuality,
            confidenceCalibration
        });

        return {
            components: {
                consistency: decisionConsistency,
                evidenceAlignment: evidenceDecisionAlignment,
                performanceCorrelation: performanceCorrelation,
                timing: timingQuality,
                confidenceCalibration: confidenceCalibration
            },
            score: decisionQualityScore,
            qualityLevel: this.classifyDecisionQuality(decisionQualityScore),
            improvementAreas: this.identifyDecisionImprovementAreas(decisionQualityScore),
            qualityTrend: this.analyzeDecisionQualityTrend(userDecisions, systemDecisions)
        };
    }

    recognizeBiasPatterns(historicalAnalyses, evidenceAnalysis, performanceData) {
        // Temporal bias patterns
        const temporalPatterns = this.identifyTemporalBiasPatterns(historicalAnalyses);

        // Performance-related bias patterns
        const performancePatterns = this.identifyPerformanceBiasPatterns(historicalAnalyses,
                                                                        performanceData);

        // Evidence-based bias patterns
        const evidencePatterns = this.identifyEvidenceBiasPatterns(evidenceAnalysis,
                                                                  historicalAnalyses);

        // Cyclical bias patterns
        const cyclicalPatterns = this.identifyCyclicalBiasPatterns(historicalAnalyses);

        // Pattern strength assessment
        const patternStrength = this.assessBiasPatternStrength([
            ...temporalPatterns,
            ...performancePatterns,
            ...evidencePatterns,
            ...cyclicalPatterns
        ]);

        return {
            temporal: temporalPatterns,
            performance: performancePatterns,
            evidence: evidencePatterns,
            cyclical: cyclicalPatterns,
            strength: patternStrength,
            dominantPattern: this.identifyDominantBiasPattern(patternStrength),
            patternRisk: this.assessBiasPatternRisk(patternStrength)
        };
    }

    analyzeCounterEvidence(currentAnalysis, contradictoryEvidence, alternativeViews) {
        // Counter-evidence availability
        const counterEvidenceAvailability = this.assessCounterEvidenceAvailability(
            contradictoryEvidence
        );

        // Alternative view consideration
        const alternativeViewConsideration = this.assessAlternativeViewConsideration(
            alternativeViews, currentAnalysis
        );

        // Disconfirming evidence integration
        const disconfirmingIntegration = this.assessDisconfirmingEvidenceIntegration(
            contradictoryEvidence, currentAnalysis
        );

        // Devil's advocate analysis
        const devilsAdvocateAnalysis = this.performDevilsAdvocateAnalysis(
            currentAnalysis, contradictoryEvidence, alternativeViews
        );

        return {
            availability: counterEvidenceAvailability,
            alternativeViews: alternativeViewConsideration,
            disconfirmingIntegration: disconfirmingIntegration,
            devilsAdvocate: devilsAdvocateAnalysis,
            counterArgumentStrength: this.calculateCounterArgumentStrength(contradictoryEvidence),
            balanceScore: this.calculateEvidenceBalanceScore(contradictoryEvidence, currentAnalysis)
        };
    }

    assessCognitiveLoad(data, evidenceAnalysis) {
        // Information complexity
        const informationComplexity = this.assessInformationComplexity(evidenceAnalysis);

        // Decision pressure
        const decisionPressure = this.assessDecisionPressure(data);

        // Cognitive resource allocation
        const resourceAllocation = this.assessCognitiveResourceAllocation(evidenceAnalysis);

        // Mental fatigue indicators
        const fatigueIndicators = this.assessMentalFatigueIndicators(data);

        // Overall cognitive load
        const cognitiveLoad = this.calculateCognitiveLoad({
            informationComplexity,
            decisionPressure,
            resourceAllocation,
            fatigueIndicators
        });

        return {
            complexity: informationComplexity,
            pressure: decisionPressure,
            resourceAllocation: resourceAllocation,
            fatigue: fatigueIndicators,
            overallLoad: cognitiveLoad,
            loadLevel: this.classifyCognitiveLoad(cognitiveLoad),
            biasRisk: this.calculateCognitiveLoadBiasRisk(cognitiveLoad)
        };
    }

    generateMitigationRecommendations(confirmationBiasAnalysis, multipleBiasAnalysis, evidenceQualityAnalysis) {
        const recommendations = [];

        // Confirmation bias mitigation
        if (confirmationBiasAnalysis.level !== 'mild') {
            recommendations.push({
                type: 'confirmation_bias',
                urgency: confirmationBiasAnalysis.mitigationUrgency,
                techniques: this.getConfirmationBiasMitigationTechniques(confirmationBiasAnalysis)
            });
        }

        // Multiple bias mitigation
        Object.keys(multipleBiasAnalysis.individual).forEach(biasType => {
            const bias = multipleBiasAnalysis.individual[biasType];
            if (bias.score > this.biasThresholds.moderate) {
                recommendations.push({
                    type: biasType,
                    urgency: this.calculateBiasUrgency(bias.score),
                    techniques: this.getBiasMitigationTechniques(biasType, bias.score)
                });
            }
        });

        // Evidence quality improvement
        if (evidenceQualityAnalysis.overallScore < 0.6) {
            recommendations.push({
                type: 'evidence_quality',
                urgency: 'high',
                techniques: this.getEvidenceQualityImprovementTechniques(evidenceQualityAnalysis)
            });
        }

        return {
            recommendations: recommendations,
            urgency: this.calculateOverallMitigationUrgency(recommendations),
            priorityOrder: this.prioritizeMitigationRecommendations(recommendations),
            implementationGuide: this.createImplementationGuide(recommendations)
        };
    }

    suggestDebiasingTechniques(multipleBiasAnalysis, biasPatternAnalysis) {
        const techniques = {
            cognitive: [],
            procedural: [],
            environmental: [],
            social: []
        };

        // Cognitive debiasing techniques
        techniques.cognitive = this.getCognitiveDebiasingTechniques(multipleBiasAnalysis);

        // Procedural debiasing techniques  
        techniques.procedural = this.getProceduralDebiasingTechniques(biasPatternAnalysis);

        // Environmental debiasing techniques
        techniques.environmental = this.getEnvironmentalDebiasingTechniques(multipleBiasAnalysis);

        // Social debiasing techniques
        techniques.social = this.getSocialDebiasingTechniques(multipleBiasAnalysis);

        return {
            techniques: techniques,
            recommendedCombination: this.recommendTechniqueCombination(techniques, multipleBiasAnalysis),
            effectiveness: this.assessTechniqueEffectiveness(techniques, multipleBiasAnalysis),
            implementationOrder: this.orderTechniqueImplementation(techniques)
        };
    }

    getCurrentStatus(confirmationBiasAnalysis, multipleBiasAnalysis) {
        return {
            confirmationBiasLevel: confirmationBiasAnalysis.level,
            confirmationBiasScore: confirmationBiasAnalysis.score,
            dominantBias: multipleBiasAnalysis.dominantBias,
            compositeBiasScore: multipleBiasAnalysis.compositeScore,
            biasRiskLevel: this.calculateOverallBiasRisk(confirmationBiasAnalysis, multipleBiasAnalysis),
            decisionRisk: this.calculateDecisionRisk(confirmationBiasAnalysis, multipleBiasAnalysis),
            mitigationNeeded: this.assessMitigationNeed(confirmationBiasAnalysis, multipleBiasAnalysis)
        };
    }

    // Helper methods for various calculations
    extractTechnicalEvidence(technicalSignals) {
        return technicalSignals.map(signal => ({
            type: 'technical',
            signal: signal.name,
            direction: signal.direction,
            strength: signal.strength,
            confidence: signal.confidence,
            weight: this.evidenceWeights.technical
        }));
    }

    extractFundamentalEvidence(fundamentalData) {
        const evidence = [];
        Object.keys(fundamentalData).forEach(metric => {
            evidence.push({
                type: 'fundamental',
                metric: metric,
                value: fundamentalData[metric],
                weight: this.evidenceWeights.fundamental
            });
        });
        return evidence;
    }

    extractSentimentEvidence(sentimentData) {
        return [{
            type: 'sentiment',
            value: sentimentData.overall,
            strength: sentimentData.strength,
            confidence: sentimentData.confidence,
            weight: this.evidenceWeights.sentiment
        }];
    }

    extractMacroEvidence(macroData) {
        const evidence = [];
        Object.keys(macroData).forEach(indicator => {
            evidence.push({
                type: 'macro',
                indicator: indicator,
                value: macroData[indicator],
                weight: this.evidenceWeights.macro
            });
        });
        return evidence;
    }

    extractNewsEvidence(newsData) {
        return newsData.map(news => ({
            type: 'news',
            sentiment: news.sentiment,
            impact: news.impact,
            credibility: news.credibility,
            weight: this.evidenceWeights.news
        }));
    }

    calculateEvidenceStatistics(evidenceCategories) {
        const stats = {};
        let total = 0;
        let dominantCategory = null;
        let maxCount = 0;

        Object.keys(evidenceCategories).forEach(category => {
            const count = evidenceCategories[category].length;
            stats[category] = count;
            total += count;

            if (count > maxCount) {
                maxCount = count;
                dominantCategory = category;
            }
        });

        return {
            ...stats,
            total: total,
            dominant: dominantCategory,
            diversity: Object.keys(evidenceCategories).filter(cat => 
                evidenceCategories[cat].length > 0).length
        };
    }

    analyzeEvidenceBalance(evidenceCategories) {
        const counts = Object.values(evidenceCategories).map(cat => cat.length);
        if (counts.length === 0) return { balanced: false, imbalance: 1 };

        const total = counts.reduce((sum, count) => sum + count, 0);
        if (total === 0) return { balanced: false, imbalance: 1 };

        const expectedRatio = 1 / counts.length;
        const actualRatios = counts.map(count => count / total);
        
        const imbalance = actualRatios.reduce((sum, ratio) => 
            sum + Math.abs(ratio - expectedRatio), 0) / 2;

        return {
            balanced: imbalance < 0.3,
            imbalance: imbalance,
            distribution: actualRatios
        };
    }

    assessOverallEvidenceQuality(evidenceCategories) {
        let totalQuality = 0;
        let totalWeight = 0;

        Object.keys(evidenceCategories).forEach(category => {
            const categoryEvidence = evidenceCategories[category];
            if (categoryEvidence.length > 0) {
                const categoryQuality = this.assessCategoryEvidenceQuality(categoryEvidence);
                const categoryWeight = this.evidenceWeights[category] || 0.1;
                
                totalQuality += categoryQuality * categoryWeight;
                totalWeight += categoryWeight;
            }
        });

        return totalWeight > 0 ? totalQuality / totalWeight : 0.5;
    }

    assessCategoryEvidenceQuality(categoryEvidence) {
        if (categoryEvidence.length === 0) return 0;

        const qualities = categoryEvidence.map(evidence => {
            let quality = 0.5; // Base quality
            
            if (evidence.confidence) quality += evidence.confidence * 0.3;
            if (evidence.strength) quality += evidence.strength * 0.2;
            
            return Math.min(1, quality);
        });

        return qualities.reduce((sum, q) => sum + q, 0) / qualities.length;
    }

    analyzeAnalysisConsistency(currentAnalysis, historicalAnalyses) {
        const recentAnalyses = historicalAnalyses.slice(-10);
        if (recentAnalyses.length === 0) return 0.5;

        const currentDirection = currentAnalysis.direction || 'neutral';
        const consistentAnalyses = recentAnalyses.filter(analysis => 
            analysis.direction === currentDirection).length;

        const consistencyRatio = consistentAnalyses / recentAnalyses.length;
        
        return {
            ratio: consistencyRatio,
            level: this.classifyConsistencyLevel(consistencyRatio),
            biasRisk: consistencyRatio > 0.8 ? 'high' : consistencyRatio > 0.6 ? 'moderate' : 'low'
        };
    }

    detectEvidenceSelectionBias(evidenceAnalysis) {
        const balance = evidenceAnalysis.balance;
        const dominantCategory = evidenceAnalysis.dominantCategory;
        
        // Check if evidence is heavily skewed towards one category
        const selectionBias = balance.imbalance;
        
        return {
            score: selectionBias,
            dominantCategory: dominantCategory,
            level: this.classifySelectionBiasLevel(selectionBias),
            biasRisk: selectionBias > 0.5 ? 'high' : selectionBias > 0.3 ? 'moderate' : 'low'
        };
    }

    detectInformationFilteringBias(evidenceAnalysis) {
        // Assess if information is being filtered based on confirmation
        const totalEvidence = evidenceAnalysis.totalEvidence;
        const diversity = evidenceAnalysis.statistics.diversity;
        
        // Low diversity with high total evidence suggests filtering
        const expectedDiversity = Math.min(5, totalEvidence); // Max 5 categories
        const diversityRatio = diversity / expectedDiversity;
        
        const filteringBias = 1 - diversityRatio;
        
        return {
            score: filteringBias,
            diversityRatio: diversityRatio,
            level: this.classifyFilteringBiasLevel(filteringBias),
            biasRisk: filteringBias > 0.4 ? 'high' : filteringBias > 0.2 ? 'moderate' : 'low'
        };
    }

    detectConfirmationSeekingPattern(historicalAnalyses) {
        // Look for patterns where analysis direction remains unchanged despite new information
        if (historicalAnalyses.length < 5) return { score: 0.5, pattern: 'insufficient_data' };

        let unchanged = 0;
        for (let i = 1; i < historicalAnalyses.length; i++) {
            if (historicalAnalyses[i].direction === historicalAnalyses[i-1].direction) {
                unchanged++;
            }
        }

        const seekingScore = unchanged / (historicalAnalyses.length - 1);
        
        return {
            score: seekingScore,
            pattern: this.classifySeekingPattern(seekingScore),
            biasRisk: seekingScore > 0.7 ? 'high' : seekingScore > 0.5 ? 'moderate' : 'low'
        };
    }

    detectDisconfirmingAvoidance(evidenceAnalysis, historicalAnalyses) {
        // Assess tendency to avoid disconfirming evidence
        const balance = evidenceAnalysis.balance;
        const imbalance = balance.imbalance;
        
        // High imbalance suggests possible avoidance of contrary evidence
        const avoidanceScore = imbalance;
        
        return {
            score: avoidanceScore,
            level: this.classifyAvoidanceLevel(avoidanceScore),
            biasRisk: avoidanceScore > 0.6 ? 'high' : avoidanceScore > 0.4 ? 'moderate' : 'low'
        };
    }

    calculateConfirmationBiasScore(components) {
        const weights = {
            analysisConsistency: 0.25,
            evidenceSelectionBias: 0.25,
            informationFilteringBias: 0.2,
            confirmationSeekingPattern: 0.15,
            disconfirmingAvoidance: 0.15
        };

        let totalScore = 0;
        Object.keys(components).forEach(component => {
            const componentScore = typeof components[component] === 'object' ? 
                                 components[component].score : components[component];
            totalScore += componentScore * weights[component];
        });

        return totalScore;
    }

    classifyBiasLevel(biasScore) {
        if (biasScore >= this.biasThresholds.extreme) return 'extreme';
        if (biasScore >= this.biasThresholds.strong) return 'strong';
        if (biasScore >= this.biasThresholds.moderate) return 'moderate';
        if (biasScore >= this.biasThresholds.mild) return 'mild';
        return 'minimal';
    }

    calculateBiasConfidence(biasScore) {
        // Confidence is higher for extreme values (both high and low bias)
        const distanceFromNeutral = Math.abs(biasScore - 0.5);
        return 0.5 + distanceFromNeutral;
    }

    calculateBiasRiskFactor(biasLevel) {
        const riskFactors = {
            minimal: 1.0,
            mild: 1.2,
            moderate: 1.5,
            strong: 2.0,
            extreme: 3.0
        };
        
        return riskFactors[biasLevel] || 1.0;
    }

    calculateMitigationUrgency(biasLevel) {
        const urgencyLevels = {
            minimal: 'low',
            mild: 'low',
            moderate: 'medium',
            strong: 'high',
            extreme: 'critical'
        };
        
        return urgencyLevels[biasLevel] || 'low';
    }

    generateRecommendations(confirmationBiasAnalysis, evidenceQualityAnalysis, mitigationRecommendations) {
        const recommendations = {};

        // Bias mitigation recommendations
        if (confirmationBiasAnalysis.level !== 'minimal') {
            recommendations.bias = {
                action: 'implement_bias_mitigation',
                urgency: mitigationRecommendations.urgency,
                techniques: mitigationRecommendations.priorityOrder.slice(0, 3)
            };
        }

        // Evidence quality recommendations
        if (evidenceQualityAnalysis.overallScore < 0.7) {
            recommendations.evidence = {
                action: 'improve_evidence_quality',
                areas: evidenceQualityAnalysis.improvementAreas,
                priority: 'high'
            };
        }

        // Decision process recommendations
        if (confirmationBiasAnalysis.score > 0.6) {
            recommendations.process = {
                action: 'implement_structured_decision_process',
                focus: 'counter_evidence_integration',
                tools: ['devils_advocate', 'red_team_analysis', 'pre_mortem']
            };
        }

        return recommendations;
    }

    generateAlerts(confirmationBiasAnalysis, multipleBiasAnalysis, evidenceQualityAnalysis) {
        const alerts = [];

        // High confirmation bias alert
        if (confirmationBiasAnalysis.level === 'strong' || confirmationBiasAnalysis.level === 'extreme') {
            alerts.push({
                level: 'critical',
                message: 'Yüksek seviyede confirmation bias tespit edildi',
                action: 'Karar sürecini gözden geçir ve alternatif görüşleri değerlendir'
            });
        }

        // Multiple bias alert
        if (multipleBiasAnalysis.compositeBiasScore > 0.7) {
            alerts.push({
                level: 'warning',
                message: 'Birden fazla bias türü tespit edildi',
                action: 'Kapsamlı bias mitigation stratejisi uygula'
            });
        }

        // Poor evidence quality alert
        if (evidenceQualityAnalysis.overallScore < 0.5) {
            alerts.push({
                level: 'warning',
                message: 'Düşük kaliteli kanıt analizi',
                action: 'Kanıt toplama sürecini iyileştir'
            });
        }

        return alerts;
    }

    generateNotes(confirmationBiasAnalysis, evidenceQualityAnalysis, decisionQualityAnalysis) {
        const notes = [];

        notes.push(`Confirmation bias seviyesi: ${confirmationBiasAnalysis.level} (${(confirmationBiasAnalysis.score * 100).toFixed(1)}%)`);
        notes.push(`Kanıt kalitesi: ${(evidenceQualityAnalysis.overallScore * 100).toFixed(1)}%`);
        notes.push(`Karar kalitesi: ${(decisionQualityAnalysis.score * 100).toFixed(1)}%`);

        if (confirmationBiasAnalysis.mitigationUrgency === 'critical') {
            notes.push('Acil bias mitigation gerekli');
        }

        return notes.join('. ');
    }

    updateBiasHistory(result, data) {
        this.biasHistory.push({
            timestamp: Date.now(),
            confirmationBiasLevel: result.confirmationBiasAnalysis.level,
            confirmationBiasScore: result.confirmationBiasAnalysis.score,
            evidenceQuality: result.evidenceQualityAnalysis.overallScore,
            decisionQuality: result.decisionQualityAnalysis.score
        });

        if (this.biasHistory.length > this.maxHistorySize) {
            this.biasHistory = this.biasHistory.slice(-this.maxHistorySize);
        }
    }

    getDefaultResult() {
        return {
            evidenceAnalysis: {
                categories: { technical: [], fundamental: [], sentiment: [], macro: [], news: [] },
                statistics: { total: 0, dominant: null, diversity: 0 },
                balance: { balanced: false, imbalance: 1 },
                totalEvidence: 0,
                dominantCategory: null,
                evidenceQuality: 0.5
            },
            confirmationBiasAnalysis: {
                components: {
                    analysisConsistency: { ratio: 0.5, level: 'moderate', biasRisk: 'moderate' },
                    evidenceSelectionBias: { score: 0.5, level: 'moderate', biasRisk: 'moderate' },
                    informationFilteringBias: { score: 0.5, level: 'moderate', biasRisk: 'moderate' },
                    confirmationSeekingPattern: { score: 0.5, pattern: 'moderate', biasRisk: 'moderate' },
                    disconfirmingAvoidance: { score: 0.5, level: 'moderate', biasRisk: 'moderate' }
                },
                score: 0.5,
                level: 'moderate',
                confidence: 0.5,
                riskFactor: 1.5,
                mitigationUrgency: 'medium'
            },
            multipleBiasAnalysis: {
                individual: {},
                interactions: {},
                compositeScore: 0.5,
                dominantBias: null,
                biasCluster: [],
                severityLevel: 'moderate'
            },
            confirmationChainAnalysis: {
                chains: [],
                characteristics: {},
                strength: 0.5,
                vulnerabilities: [],
                maxDepth: 0,
                averageStrength: 0.5,
                riskLevel: 'moderate'
            },
            evidenceQualityAnalysis: {
                categoryQualities: {},
                diversity: 0.5,
                alternativeViews: 0.5,
                contradictoryHandling: 0.5,
                sourceReliability: 0.5,
                overallScore: 0.5,
                qualityLevel: 'moderate',
                improvementAreas: [],
                qualityRisk: 'moderate'
            },
            decisionQualityAnalysis: {
                components: {
                    consistency: 0.5,
                    evidenceAlignment: 0.5,
                    performanceCorrelation: 0.5,
                    timing: 0.5,
                    confidenceCalibration: 0.5
                },
                score: 0.5,
                qualityLevel: 'moderate',
                improvementAreas: [],
                qualityTrend: 'stable'
            },
            biasPatternAnalysis: {
                temporal: [],
                performance: [],
                evidence: [],
                cyclical: [],
                strength: 0.5,
                dominantPattern: null,
                patternRisk: 'moderate'
            },
            counterEvidenceAnalysis: {
                availability: 0.5,
                alternativeViews: 0.5,
                disconfirmingIntegration: 0.5,
                devilsAdvocate: {},
                counterArgumentStrength: 0.5,
                balanceScore: 0.5
            },
            cognitiveLoadAnalysis: {
                complexity: 0.5,
                pressure: 0.5,
                resourceAllocation: 0.5,
                fatigue: 0.5,
                overallLoad: 0.5,
                loadLevel: 'moderate',
                biasRisk: 'moderate'
            },
            mitigationRecommendations: {
                recommendations: [],
                urgency: 'medium',
                priorityOrder: [],
                implementationGuide: {}
            },
            debiasingTechniques: {
                techniques: { cognitive: [], procedural: [], environmental: [], social: [] },
                recommendedCombination: [],
                effectiveness: {},
                implementationOrder: []
            },
            currentStatus: {
                confirmationBiasLevel: 'moderate',
                confirmationBiasScore: 0.5,
                dominantBias: null,
                compositeBiasScore: 0.5,
                biasRiskLevel: 'moderate',
                decisionRisk: 'moderate',
                mitigationNeeded: true
            },
            recommendations: {},
            alerts: [],
            notes: "Bias analizi yapılamadı - yetersiz veri",
            metadata: {
                error: true,
                analysisTimestamp: Date.now()
            }
        };
    }

    getModuleInfo() {
        return {
            name: 'TeyitZinciriBiasGuard',
            version: '1.0.0',
            description: 'Confirmation bias\'ı tespit eden ve koruyan sistem - Bias detection, confirmation chains, decision quality assessment',
            inputs: [
                'symbol', 'currentAnalysis', 'historicalAnalyses', 'technicalSignals', 'fundamentalData',
                'sentimentData', 'newsData', 'macroData', 'userDecisions', 'systemDecisions',
                'performanceData', 'marketFeedback', 'alternativeViews', 'contradictoryEvidence',
                'timeframe', 'confidence'
            ],
            outputs: [
                'evidenceAnalysis', 'confirmationBiasAnalysis', 'multipleBiasAnalysis', 'confirmationChainAnalysis',
                'evidenceQualityAnalysis', 'decisionQualityAnalysis', 'biasPatternAnalysis', 'counterEvidenceAnalysis',
                'cognitiveLoadAnalysis', 'mitigationRecommendations', 'debiasingTechniques', 'currentStatus',
                'recommendations', 'alerts', 'notes', 'metadata'
            ]
        };
    }
}

module.exports = TeyitZinciriBiasGuard;
