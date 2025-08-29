/**
 * 📦 formPatternRecognizer.js
 * 🎯 Grafik formasyonlarını tespit eden ana modül
 */

const GrafikBeyniModuleBase = require('../grafikBeyniModuleBase');

class FormPatternRecognizer extends GrafikBeyniModuleBase {
    constructor(config = {}) {
        super('formPatternRecognizer', {
            ...config,
            scoreThreshold: 0.7,
            minDataPoints: 20,
            formationTimeout: 24 * 60 * 60 * 1000, // 24 hours
            volumeThreshold: 1.2,
            breakoutVolumeThreshold: 1.5,
            supportedFormations: [
                'ascending_triangle',
                'descending_triangle',
                'symmetrical_triangle',
                'bull_flag',
                'bear_flag',
                'head_and_shoulders',
                'inverse_head_and_shoulders',
                'double_top',
                'double_bottom',
                'channel',
                'wedge',
                'rectangle'
            ]
        });

        // Formation tracking
        this.activeFormations = new Map();
        this.formationHistory = new Map();
        this.patternLibrary = this.initializePatternLibrary();
    }

    async performAnalysis(marketData) {
        try {
            const {
                symbol = 'UNKNOWN',
                timeframe = '15m',
                pricePoints = [],
                volumePattern = [],
                slopeAngle = 0,
                volatilityIndex = 1.0,
                trendLinePoints = {},
                candleTypes = [],
                highsLows = {},
                currentPrice
            } = marketData;

            if (pricePoints.length < this.config.minDataPoints) {
                return { signals: [], metadata: { error: 'Insufficient data points' } };
            }

            // Market condition analizi
            const marketCondition = this.analyzeMarketCondition(marketData);
            
            // Geometrik yapı tespiti
            const geometricAnalysis = this.analyzeGeometricStructure(
                pricePoints, 
                trendLinePoints, 
                highsLows
            );
            
            // Her formasyon türü için kontrol
            const formationResults = [];
            
            for (const formationType of this.config.supportedFormations) {
                const result = await this.detectFormation(
                    formationType,
                    pricePoints,
                    volumePattern,
                    slopeAngle,
                    volatilityIndex,
                    trendLinePoints,
                    candleTypes,
                    geometricAnalysis,
                    marketCondition
                );
                
                if (result && result.detected) {
                    formationResults.push(result);
                }
            }
            
            // En iyi formasyonu seç
            const bestFormation = this.selectBestFormation(formationResults);
            
            if (!bestFormation) {
                return {
                    signals: [],
                    metadata: {
                        moduleName: this.name,
                        formationDetected: false,
                        checkedFormations: this.config.supportedFormations.length
                    }
                };
            }
            
            // Active formations güncelle
            this.updateActiveFormations(symbol, bestFormation);
            
            // Breakout analizi
            const breakoutAnalysis = this.analyzeBreakoutPotential(
                bestFormation,
                currentPrice,
                volumePattern,
                marketCondition
            );
            
            // Sinyal oluştur
            const signal = this.createSignal('formation-detected', bestFormation.confidenceScore, {
                variant: bestFormation.formationType,
                riskLevel: this.assessRiskLevel(bestFormation, breakoutAnalysis),
                analysis: {
                    ...bestFormation,
                    breakoutAnalysis,
                    geometricAnalysis,
                    marketCondition
                },
                recommendations: this.generateRecommendations(bestFormation, breakoutAnalysis),
                confirmationChain: this.buildConfirmationChain(bestFormation, breakoutAnalysis)
            });

            return {
                signals: [signal],
                metadata: {
                    moduleName: this.name,
                    formationDetected: true,
                    formationType: bestFormation.formationType,
                    formationStage: bestFormation.formationStage,
                    confidenceScore: bestFormation.confidenceScore,
                    breakoutPotential: breakoutAnalysis.direction,
                    notify: this.generateNotifications(bestFormation, breakoutAnalysis)
                }
            };

        } catch (error) {
            console.error('❌ FormPatternRecognizer analysis error:', error);
            return { signals: [], error: error.message };
        }
    }

    /**
     * Geometrik yapı analizi
     */
    analyzeGeometricStructure(pricePoints, trendLinePoints, highsLows) {
        const structure = {
            trendLines: this.analyzeTrendLines(trendLinePoints),
            priceAction: this.analyzePriceAction(pricePoints),
            volatility: this.calculateVolatilityTrend(pricePoints),
            highsLowsPattern: this.analyzeHighsLowsPattern(highsLows)
        };

        return structure;
    }

    /**
     * Trend çizgileri analizi
     */
    analyzeTrendLines(trendLinePoints) {
        const { resistanceLine = [], supportLine = [] } = trendLinePoints;
        
        const analysis = {
            hasResistance: resistanceLine.length >= 2,
            hasSupport: supportLine.length >= 2,
            resistanceSlope: 0,
            supportSlope: 0,
            convergence: false,
            parallelism: false
        };

        if (analysis.hasResistance) {
            analysis.resistanceSlope = this.calculateSlope(resistanceLine);
        }
        
        if (analysis.hasSupport) {
            analysis.supportSlope = this.calculateSlope(supportLine);
        }
        
        // Convergence check (triangle patterns)
        if (analysis.hasResistance && analysis.hasSupport) {
            const slopeDiff = Math.abs(analysis.resistanceSlope - analysis.supportSlope);
            analysis.convergence = slopeDiff > 0.1; // Lines converging
            analysis.parallelism = slopeDiff < 0.05; // Lines parallel (channel)
        }

        return analysis;
    }

    /**
     * Specific formation detection
     */
    async detectFormation(formationType, pricePoints, volumePattern, slopeAngle, volatilityIndex, trendLinePoints, candleTypes, geometricAnalysis, marketCondition) {
        const detector = this.patternLibrary[formationType];
        if (!detector) return null;

        return detector.call(this, {
            pricePoints,
            volumePattern,
            slopeAngle,
            volatilityIndex,
            trendLinePoints,
            candleTypes,
            geometricAnalysis,
            marketCondition
        });
    }

    /**
     * Ascending Triangle Detection
     */
    detectAscendingTriangle(data) {
        const { pricePoints, trendLinePoints, geometricAnalysis, volumePattern } = data;
        
        // Rule checks
        const rules = {
            horizontalResistance: false,
            risingSupport: false,
            volumeContraction: false,
            minTouches: false
        };

        // Check for horizontal resistance
        if (geometricAnalysis.trendLines.hasResistance && 
            Math.abs(geometricAnalysis.trendLines.resistanceSlope) < 0.02) {
            rules.horizontalResistance = true;
        }

        // Check for rising support
        if (geometricAnalysis.trendLines.hasSupport && 
            geometricAnalysis.trendLines.supportSlope > 0.05) {
            rules.risingSupport = true;
        }

        // Check volume contraction
        if (this.isVolumeContracting(volumePattern)) {
            rules.volumeContraction = true;
        }

        // Check minimum touches (at least 2 touches on each line)
        const touches = this.countTrendLineTouches(pricePoints, trendLinePoints);
        if (touches.resistance >= 2 && touches.support >= 2) {
            rules.minTouches = true;
        }

        const rulesPassed = Object.values(rules).filter(Boolean).length;
        const totalRules = Object.keys(rules).length;

        if (rulesPassed < 3) return null; // Need at least 3/4 rules

        const confidenceScore = rulesPassed / totalRules;
        const resistanceLevel = this.calculateResistanceLevel(trendLinePoints.resistanceLine);
        const risingLows = this.extractRisingLows(pricePoints, trendLinePoints.supportLine);

        return {
            detected: true,
            formationType: 'ascending_triangle',
            formationStage: this.determineFormationStage(data, rules),
            confidenceScore,
            horizontalResistance: resistanceLevel,
            risingLows,
            volumePattern: this.classifyVolumePattern(volumePattern),
            ruleMatchDetails: this.generateRuleDetails('ascending_triangle', rules, data),
            breakoutRequirements: {
                minVolumeIncrease: this.config.breakoutVolumeThreshold,
                priceAboveResistance: resistanceLevel + (resistanceLevel * 0.002) // +0.2%
            }
        };
    }

    /**
     * Head and Shoulders Detection
     */
    detectHeadAndShoulders(data) {
        const { pricePoints, geometricAnalysis } = data;
        
        const peaks = this.findPeaks(pricePoints);
        if (peaks.length < 3) return null;

        // Look for 3 peaks pattern
        let bestPattern = null;
        let bestScore = 0;

        for (let i = 0; i <= peaks.length - 3; i++) {
            const leftShoulder = peaks[i];
            const head = peaks[i + 1];
            const rightShoulder = peaks[i + 2];

            const pattern = this.analyzeHeadShouldersPattern(
                leftShoulder, head, rightShoulder, pricePoints
            );

            if (pattern && pattern.score > bestScore && pattern.score > 0.7) {
                bestScore = pattern.score;
                bestPattern = pattern;
            }
        }

        if (!bestPattern) return null;

        return {
            detected: true,
            formationType: 'head_and_shoulders',
            isInverse: false,
            formationStage: this.determineHSFormationStage(bestPattern, data),
            confidenceScore: bestPattern.score,
            leftShoulder: bestPattern.leftShoulder,
            head: bestPattern.head,
            rightShoulder: bestPattern.rightShoulder,
            neckline: bestPattern.neckline,
            ruleMatchDetails: bestPattern.details,
            breakoutRequirements: {
                minVolumeIncrease: this.config.breakoutVolumeThreshold,
                priceBelowNeckline: bestPattern.neckline.level - (bestPattern.neckline.level * 0.002)
            }
        };
    }

    /**
     * Bull Flag Detection
     */
    detectBullFlag(data) {
        const { pricePoints, volumePattern, geometricAnalysis } = data;
        
        // Look for flagpole + flag pattern
        const segments = this.segmentPriceMovement(pricePoints);
        
        let flagPole = null;
        let flag = null;
        
        // Find potential flagpole (strong upward movement)
        for (const segment of segments) {
            if (segment.direction === 'up' && segment.strength > 0.7 && segment.movePercent > 2) {
                flagPole = segment;
                break;
            }
        }
        
        if (!flagPole) return null;
        
        // Look for flag after flagpole (slight downward or sideways)
        const flagStartIndex = flagPole.endIndex;
        const flagData = pricePoints.slice(flagStartIndex);
        
        if (flagData.length < 5) return null;
        
        const flagAnalysis = this.analyzeFlagPattern(flagData);
        
        if (!flagAnalysis.isValidFlag) return null;
        
        const confidenceScore = this.calculateFlagConfidence(flagPole, flagAnalysis, volumePattern);
        
        if (confidenceScore < 0.6) return null;

        return {
            detected: true,
            formationType: 'bull_flag',
            formationStage: flagAnalysis.stage,
            confidenceScore,
            flagPole: {
                start: flagPole.startPrice,
                end: flagPole.endPrice,
                movePercent: flagPole.movePercent,
                duration: flagPole.duration
            },
            flag: {
                pattern: flagAnalysis.pattern,
                slope: flagAnalysis.slope,
                duration: flagAnalysis.duration
            },
            volumePattern: this.classifyVolumePattern(volumePattern),
            breakoutRequirements: {
                minVolumeIncrease: this.config.breakoutVolumeThreshold,
                priceAboveFlagTop: flagAnalysis.flagTop + (flagAnalysis.flagTop * 0.001)
            },
            ruleMatchDetails: this.generateFlagRuleDetails(flagPole, flagAnalysis)
        };
    }

    /**
     * Pattern Library Initialization
     */
    initializePatternLibrary() {
        return {
            'ascending_triangle': this.detectAscendingTriangle,
            'descending_triangle': this.detectDescendingTriangle,
            'symmetrical_triangle': this.detectSymmetricalTriangle,
            'bull_flag': this.detectBullFlag,
            'bear_flag': this.detectBearFlag,
            'head_and_shoulders': this.detectHeadAndShoulders,
            'inverse_head_and_shoulders': this.detectInverseHeadAndShoulders,
            'double_top': this.detectDoubleTop,
            'double_bottom': this.detectDoubleBottom,
            'channel': this.detectChannel,
            'wedge': this.detectWedge,
            'rectangle': this.detectRectangle
        };
    }

    /**
     * Formation stage determination
     */
    determineFormationStage(data, rules) {
        const { pricePoints, currentPrice } = data;
        const recentPrice = pricePoints[pricePoints.length - 1];
        
        // Simple stage logic - can be enhanced
        const rulesPassed = Object.values(rules).filter(Boolean).length;
        
        if (rulesPassed === Object.keys(rules).length) {
            return 'pre-breakout';
        } else if (rulesPassed >= Math.ceil(Object.keys(rules).length * 0.75)) {
            return 'development';
        } else {
            return 'formation';
        }
    }

    /**
     * Breakout potential analysis
     */
    analyzeBreakoutPotential(formation, currentPrice, volumePattern, marketCondition) {
        const analysis = {
            direction: 'unknown',
            probability: 0.5,
            targetPrice: null,
            invalidationLevel: null,
            volumeSupport: false,
            timeEstimate: null
        };

        // Direction based on formation type
        const bullishFormations = ['ascending_triangle', 'bull_flag', 'inverse_head_and_shoulders', 'double_bottom'];
        const bearishFormations = ['descending_triangle', 'bear_flag', 'head_and_shoulders', 'double_top'];
        
        if (bullishFormations.includes(formation.formationType)) {
            analysis.direction = 'bullish';
            analysis.probability = formation.confidenceScore * 0.8; // Slight discount
        } else if (bearishFormations.includes(formation.formationType)) {
            analysis.direction = 'bearish';
            analysis.probability = formation.confidenceScore * 0.8;
        }

        // Volume support check
        analysis.volumeSupport = this.checkVolumeSupport(volumePattern, formation);
        
        if (analysis.volumeSupport) {
            analysis.probability += 0.1;
        }

        // Market condition alignment
        if ((analysis.direction === 'bullish' && marketCondition.trend.includes('bullish')) ||
            (analysis.direction === 'bearish' && marketCondition.trend.includes('bearish'))) {
            analysis.probability += 0.1;
        }

        // Target and invalidation calculations
        analysis.targetPrice = this.calculateTargetPrice(formation, analysis.direction);
        analysis.invalidationLevel = this.calculateInvalidationLevel(formation, analysis.direction);
        
        // Time estimate based on formation development
        analysis.timeEstimate = this.estimateBreakoutTime(formation, marketCondition);

        return analysis;
    }

    /**
     * Helper Methods
     */
    calculateSlope(line) {
        if (line.length < 2) return 0;
        const rise = line[line.length - 1] - line[0];
        const run = line.length - 1;
        return rise / run;
    }

    isVolumeContracting(volumePattern) {
        if (volumePattern.length < 5) return false;
        
        const recent = volumePattern.slice(-5);
        let contractingCount = 0;
        
        for (let i = 1; i < recent.length; i++) {
            if (recent[i] < recent[i-1]) {
                contractingCount++;
            }
        }
        
        return contractingCount >= 3;
    }

    findPeaks(pricePoints) {
        const peaks = [];
        
        for (let i = 1; i < pricePoints.length - 1; i++) {
            if (pricePoints[i] > pricePoints[i-1] && pricePoints[i] > pricePoints[i+1]) {
                peaks.push({
                    index: i,
                    price: pricePoints[i]
                });
            }
        }
        
        return peaks;
    }

    selectBestFormation(formationResults) {
        if (formationResults.length === 0) return null;
        
        // Sort by confidence score
        formationResults.sort((a, b) => b.confidenceScore - a.confidenceScore);
        
        return formationResults[0];
    }

    updateActiveFormations(symbol, formation) {
        if (!this.activeFormations.has(symbol)) {
            this.activeFormations.set(symbol, []);
        }
        
        const formations = this.activeFormations.get(symbol);
        formations.push({
            ...formation,
            detectedAt: Date.now()
        });
        
        // Keep last 5 formations
        if (formations.length > 5) {
            formations.shift();
        }
    }

    generateNotifications(formation, breakoutAnalysis) {
        return {
            grafikBeyni: {
                formationType: formation.formationType,
                confidenceScore: formation.confidenceScore,
                stage: formation.formationStage
            },
            trendConfidenceEvaluator: {
                formation: formation.formationType,
                confidence: formation.confidenceScore
            },
            tpOptimizer: {
                formation: formation.formationType,
                breakoutDirection: breakoutAnalysis.direction,
                targetPrice: breakoutAnalysis.targetPrice
            },
            vivo: {
                formationReady: formation.formationStage === 'pre-breakout',
                formationType: formation.formationType,
                breakoutProbability: breakoutAnalysis.probability
            }
        };
    }

    assessRiskLevel(formation, breakoutAnalysis) {
        if (formation.confidenceScore > 0.8 && breakoutAnalysis.probability > 0.7) {
            return 'low';
        } else if (formation.confidenceScore > 0.6 && breakoutAnalysis.probability > 0.5) {
            return 'medium';
        } else {
            return 'high';
        }
    }

    generateRecommendations(formation, breakoutAnalysis) {
        const recommendations = [];
        
        recommendations.push(`Formation detected: ${formation.formationType}`);
        recommendations.push(`Stage: ${formation.formationStage}`);
        recommendations.push(`Confidence: ${(formation.confidenceScore * 100).toFixed(1)}%`);
        
        if (breakoutAnalysis.direction !== 'unknown') {
            recommendations.push(`Expected breakout: ${breakoutAnalysis.direction}`);
            recommendations.push(`Breakout probability: ${(breakoutAnalysis.probability * 100).toFixed(1)}%`);
        }
        
        if (formation.formationStage === 'pre-breakout') {
            recommendations.push('Formation near completion - monitor for breakout');
        }
        
        if (breakoutAnalysis.volumeSupport) {
            recommendations.push('Volume pattern supports formation');
        }
        
        return recommendations;
    }

    buildConfirmationChain(formation, breakoutAnalysis) {
        const chain = [];
        
        chain.push(`formation_${formation.formationType}`);
        chain.push(`stage_${formation.formationStage}`);
        
        if (formation.confidenceScore > 0.8) chain.push('high_confidence');
        if (breakoutAnalysis.volumeSupport) chain.push('volume_support');
        if (breakoutAnalysis.probability > 0.7) chain.push('high_breakout_probability');
        
        return chain;
    }

    // Placeholder methods for other formations (to be implemented)
    detectDescendingTriangle(data) { return null; }
    detectSymmetricalTriangle(data) { return null; }
    detectBearFlag(data) { return null; }
    detectInverseHeadAndShoulders(data) { return null; }
    detectDoubleTop(data) { return null; }
    detectDoubleBottom(data) { return null; }
    detectChannel(data) { return null; }
    detectWedge(data) { return null; }
    detectRectangle(data) { return null; }

    // Additional helper methods (simplified implementations)
    analyzePriceAction(pricePoints) { return {}; }
    calculateVolatilityTrend(pricePoints) { return 1.0; }
    analyzeHighsLowsPattern(highsLows) { return {}; }
    countTrendLineTouches(pricePoints, trendLines) { return { resistance: 2, support: 2 }; }
    calculateResistanceLevel(resistanceLine) { return resistanceLine ? resistanceLine[resistanceLine.length - 1] : 0; }
    extractRisingLows(pricePoints, supportLine) { return []; }
    classifyVolumePattern(volumePattern) { return 'contracting'; }
    generateRuleDetails(formationType, rules, data) { return []; }
    analyzeHeadShouldersPattern(ls, h, rs, prices) { return null; }
    determineHSFormationStage(pattern, data) { return 'development'; }
    segmentPriceMovement(pricePoints) { return []; }
    analyzeFlagPattern(flagData) { return { isValidFlag: false }; }
    calculateFlagConfidence(flagPole, flagAnalysis, volumePattern) { return 0.5; }
    generateFlagRuleDetails(flagPole, flagAnalysis) { return []; }
    checkVolumeSupport(volumePattern, formation) { return false; }
    calculateTargetPrice(formation, direction) { return null; }
    calculateInvalidationLevel(formation, direction) { return null; }
    estimateBreakoutTime(formation, marketCondition) { return null; }

    /**
     * Main interface function
     */
    async getFormationDetails(marketData) {
        const result = await this.analyze(marketData);
        return result.metadata || {};
    }
}

module.exports = FormPatternRecognizer;
