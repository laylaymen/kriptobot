const GrafikBeyniModuleBase = require('./grafikBeyniModuleBase');

/**
 * Re-Entry Pattern Matcher Module
 * Daha önce çıkılan bir pozisyonun ardından, aynı formasyonun benzer bir yapıda 
 * yeniden oluşup oluşmadığını analiz eder
 * Trend gücü, formasyon benzerliği, haber desteği ve psikolojik uygunluğu kontrol eder
 */
class ReEntryPatternMatcher extends GrafikBeyniModuleBase {
    constructor() {
        super('reEntryPatternMatcher');
        this.exitHistory = [];
        this.patternHistory = [];
        this.maxHistoryLength = 50;
        this.similarityThreshold = 0.70;
        this.reentryWindow = 4 * 60 * 60 * 1000; // 4 saat
    }

    async analyze(data) {
        try {
            const {
                previousExitReason,
                trendStrength,
                priceActionBias,
                newBreakoutConfirmed,
                formation,
                formationSimilarityScore,
                psychologyStability,
                currentPrice,
                timeFromLastExit,
                previousFormation,
                previousExitPrice,
                newsSupport,
                volumeConfirmation
            } = data;

            // Veri doğrulama
            if (!previousExitReason || !formation || trendStrength === undefined) {
                throw new Error('Missing required data for re-entry pattern matching');
            }

            // Pattern similarity analizi
            const patternSimilarity = this.analyzePatternSimilarity(data);
            
            // Trend continuation kontrolü
            const trendContinuation = this.analyzeTrendContinuation(data);
            
            // Market conditions assessment
            const marketConditions = this.assessMarketConditions(data);
            
            // Re-entry confidence hesaplama
            const confidenceScore = this.calculateReentryConfidence({
                patternSimilarity,
                trendContinuation,
                marketConditions,
                ...data
            });

            // Re-entry trigger belirleme
            const reentryTrigger = this.determineReentryTrigger(data, confidenceScore);

            const result = {
                reEntryPossible: confidenceScore >= 0.75,
                confidenceScore,
                reEntryTrigger: reentryTrigger,
                patternSimilarity: patternSimilarity,
                trendContinuation: trendContinuation,
                marketConditions: marketConditions,
                modularRecommendations: this.generateModularRecommendations(confidenceScore, reentryTrigger, data),
                alert: this.generateAlert(confidenceScore, reentryTrigger, formation),
                metadata: {
                    analysisTimestamp: Date.now(),
                    timeFromLastExit: timeFromLastExit,
                    reentryWindow: this.reentryWindow,
                    previousPattern: previousFormation,
                    currentPattern: formation
                }
            };

            // Exit ve pattern geçmişi güncelleme
            this.updatePatternHistory(data, result);
            
            // Cache ve performance tracking
            this.updateCache(data, result);
            this.trackPerformance(Date.now(), result.reEntryPossible);

            return result;

        } catch (error) {
            this.handleError('ReEntryPatternMatcher analysis failed', error, data);
            return this.getDefaultResult();
        }
    }

    analyzePatternSimilarity(data) {
        const {
            formation,
            previousFormation,
            formationSimilarityScore,
            priceActionBias,
            currentPrice,
            previousExitPrice
        } = data;

        // Temel formasyon eşleşmesi
        const baseMatch = formation === previousFormation ? 1.0 : this.calculateCrossPatternSimilarity(formation, previousFormation);
        
        // Similarity score integration
        const similarityScore = formationSimilarityScore || this.calculateFormationSimilarity(data);
        
        // Price action bias consistency
        const biasConsistency = this.analyzeBiasConsistency(data);
        
        // Price level proximity (aynı price level'da mı oluşuyor?)
        const priceLevelSimilarity = this.calculatePriceLevelSimilarity(currentPrice, previousExitPrice);

        return {
            baseMatch: baseMatch,
            similarityScore: similarityScore,
            biasConsistency: biasConsistency,
            priceLevelSimilarity: priceLevelSimilarity,
            overallSimilarity: (baseMatch * 0.4 + similarityScore * 0.3 + biasConsistency * 0.2 + priceLevelSimilarity * 0.1)
        };
    }

    calculateCrossPatternSimilarity(current, previous) {
        // Pattern aileleri tanımlama
        const bullishPatterns = ['ascending-triangle', 'bullish-flag', 'cup-handle', 'inverse-head-shoulders'];
        const bearishPatterns = ['descending-triangle', 'bearish-flag', 'head-shoulders'];
        const neutralPatterns = ['symmetrical-triangle', 'rectangle', 'wedge'];

        const getCurrentFamily = (pattern) => {
            if (bullishPatterns.includes(pattern)) return 'bullish';
            if (bearishPatterns.includes(pattern)) return 'bearish';
            return 'neutral';
        };

        const currentFamily = getCurrentFamily(current);
        const previousFamily = getCurrentFamily(previous);

        if (currentFamily === previousFamily) {
            return 0.7; // Aynı aile, farklı pattern
        } else {
            return 0.3; // Farklı aile
        }
    }

    calculateFormationSimilarity(data) {
        const { formation, previousFormation } = data;
        
        // Bu fonksiyon gerçek implementasyonda daha detaylı pattern matching yapacak
        // Şimdilik basit string benzerliği
        if (formation === previousFormation) {
            return 1.0;
        }
        
        // Levenshtein distance benzeri basit similarity
        const similarity = 1 - (this.calculateStringDistance(formation, previousFormation) / Math.max(formation.length, previousFormation.length));
        return Math.max(0, similarity);
    }

    calculateStringDistance(str1, str2) {
        const matrix = [];
        
        for (let i = 0; i <= str2.length; i++) {
            matrix[i] = [i];
        }
        
        for (let j = 0; j <= str1.length; j++) {
            matrix[0][j] = j;
        }
        
        for (let i = 1; i <= str2.length; i++) {
            for (let j = 1; j <= str1.length; j++) {
                if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
                    matrix[i][j] = matrix[i - 1][j - 1];
                } else {
                    matrix[i][j] = Math.min(
                        matrix[i - 1][j - 1] + 1,
                        matrix[i][j - 1] + 1,
                        matrix[i - 1][j] + 1
                    );
                }
            }
        }
        
        return matrix[str2.length][str1.length];
    }

    analyzeBiasConsistency(data) {
        const { priceActionBias, previousFormation, formation } = data;
        
        // Pattern ve bias uyumu kontrolü
        const expectedBias = this.getExpectedBiasFromPattern(formation);
        const previousExpectedBias = this.getExpectedBiasFromPattern(previousFormation);
        
        let consistency = 0;
        
        // Current pattern bias consistency
        if (priceActionBias === expectedBias) {
            consistency += 0.5;
        }
        
        // Previous pattern bias consistency
        if (expectedBias === previousExpectedBias) {
            consistency += 0.5;
        }
        
        return consistency;
    }

    getExpectedBiasFromPattern(pattern) {
        const bullishPatterns = ['ascending-triangle', 'bullish-flag', 'cup-handle', 'inverse-head-shoulders'];
        const bearishPatterns = ['descending-triangle', 'bearish-flag', 'head-shoulders'];
        
        if (bullishPatterns.includes(pattern)) return 'bullish';
        if (bearishPatterns.includes(pattern)) return 'bearish';
        return 'neutral';
    }

    calculatePriceLevelSimilarity(currentPrice, previousExitPrice) {
        if (!currentPrice || !previousExitPrice) return 0;
        
        const priceDifference = Math.abs(currentPrice - previousExitPrice) / previousExitPrice;
        
        // %5 içinde aynı seviye kabul edilir
        if (priceDifference <= 0.05) return 1.0;
        if (priceDifference <= 0.10) return 0.7;
        if (priceDifference <= 0.15) return 0.4;
        return 0.1;
    }

    analyzeTrendContinuation(data) {
        const { trendStrength, priceActionBias, newBreakoutConfirmed, timeFromLastExit } = data;
        
        // Trend strength validation
        const trendValid = trendStrength >= 0.65;
        
        // Bias direction consistency
        const biasConsistent = priceActionBias === this.getExpectedBiasFromPattern(data.formation);
        
        // Breakout confirmation
        const breakoutConfirmed = newBreakoutConfirmed === true;
        
        // Time window validation (henüz çok erken değil mi?)
        const timeAppropriate = timeFromLastExit ? timeFromLastExit >= 30 * 60 * 1000 : true; // 30 dk minimum
        
        return {
            trendValid: trendValid,
            biasConsistent: biasConsistent,
            breakoutConfirmed: breakoutConfirmed,
            timeAppropriate: timeAppropriate,
            overallContinuation: (trendValid && biasConsistent && breakoutConfirmed && timeAppropriate)
        };
    }

    assessMarketConditions(data) {
        const { psychologyStability, newsSupport, volumeConfirmation, timeFromLastExit } = data;
        
        // Psychology stability check
        const psychologyGood = psychologyStability >= 0.75;
        
        // News support
        const newsPositive = newsSupport === 'positive' || newsSupport === 'neutral';
        
        // Volume confirmation
        const volumeGood = volumeConfirmation === true;
        
        // Time window check (çok uzun da geçmemiş mi?)
        const timeWindow = timeFromLastExit ? timeFromLastExit <= this.reentryWindow : true;
        
        return {
            psychologyGood: psychologyGood,
            newsPositive: newsPositive,
            volumeGood: volumeGood,
            timeWindow: timeWindow,
            overallConditions: (psychologyGood && newsPositive && volumeGood && timeWindow)
        };
    }

    calculateReentryConfidence(params) {
        const {
            patternSimilarity,
            trendContinuation,
            marketConditions,
            trendStrength,
            formationSimilarityScore,
            psychologyStability
        } = params;

        let confidence = 0;

        // Pattern similarity (en önemli faktör)
        confidence += patternSimilarity.overallSimilarity * 0.35;

        // Trend continuation
        confidence += (trendContinuation.overallContinuation ? 0.25 : 0);

        // Market conditions
        confidence += (marketConditions.overallConditions ? 0.20 : 0);

        // Individual factor bonuses
        if (trendStrength >= 0.80) confidence += 0.10;
        if (formationSimilarityScore >= 0.85) confidence += 0.05;
        if (psychologyStability >= 0.85) confidence += 0.05;

        return Math.max(0, Math.min(1, confidence));
    }

    determineReentryTrigger(data, confidenceScore) {
        const { trendStrength, formationSimilarityScore, newBreakoutConfirmed } = data;
        
        if (confidenceScore >= 0.85) {
            if (newBreakoutConfirmed && trendStrength >= 0.80) {
                return 'trendContinuation+breakoutConfirmation';
            } else if (formationSimilarityScore >= 0.80) {
                return 'highPatternSimilarity';
            } else {
                return 'strongOverallConditions';
            }
        } else if (confidenceScore >= 0.75) {
            return 'moderateConfidence';
        } else {
            return 'insufficientConditions';
        }
    }

    generateModularRecommendations(confidenceScore, trigger, data) {
        const recommendations = {
            confirmationSignalBridge: {
                requireExtraConfirmation: confidenceScore < 0.85,
                confidenceModifier: confidenceScore >= 0.80 ? 0.05 : -0.05,
                reentryMode: true
            },
            tpOptimizer: {
                recalculateTP: confidenceScore >= 0.75,
                useConservativeTP: confidenceScore < 0.85,
                reentryTPStrategy: trigger
            },
            riskToRewardValidator: {
                adjustForReentry: true,
                reentryRiskMultiplier: confidenceScore < 0.80 ? 1.2 : 1.0
            },
            otobilinc: {
                monitorImpulse: confidenceScore < 0.85,
                reentryPsychologyCheck: true
            }
        };

        // Düşük confidence durumunda bloke önerileri
        if (confidenceScore < 0.60) {
            recommendations.coreOrchestrator = {
                blockReentry: true,
                reason: 'Insufficient pattern similarity and market conditions'
            };
        }

        return recommendations;
    }

    generateAlert(confidenceScore, trigger, formation) {
        if (confidenceScore >= 0.85) {
            return `Aynı formasyon tipi (${formation}) yeniden oluştu. Yeniden giriş için ortam uygun.`;
        } else if (confidenceScore >= 0.75) {
            return `${formation} formasyonu benzer pattern gösteriyor - re-entry değerlendiriliyor`;
        } else if (trigger === 'insufficientConditions') {
            return "Pattern benzerliği zayıf - re-entry için koşullar henüz uygun değil";
        } else {
            return "Re-entry pattern analizi tamamlandı - izleme devam ediyor";
        }
    }

    updatePatternHistory(data, result) {
        this.patternHistory.push({
            timestamp: Date.now(),
            formation: data.formation,
            previousFormation: data.previousFormation,
            confidenceScore: result.confidenceScore,
            reentryPossible: result.reEntryPossible,
            trigger: result.reEntryTrigger
        });

        // History limit kontrolü
        if (this.patternHistory.length > this.maxHistoryLength) {
            this.patternHistory = this.patternHistory.slice(-this.maxHistoryLength);
        }
    }

    getRecentPatternHistory(timeWindow = 24 * 60 * 60 * 1000) {
        const cutoff = Date.now() - timeWindow;
        return this.patternHistory.filter(entry => entry.timestamp >= cutoff);
    }

    getDefaultResult() {
        return {
            reEntryPossible: false,
            confidenceScore: 0,
            reEntryTrigger: 'insufficientConditions',
            patternSimilarity: null,
            trendContinuation: null,
            marketConditions: null,
            modularRecommendations: {},
            alert: "Re-entry pattern analizi yapılamadı",
            metadata: {
                error: true,
                analysisTimestamp: Date.now()
            }
        };
    }

    getModuleInfo() {
        return {
            name: 'ReEntryPatternMatcher',
            version: '1.0.0',
            description: 'Önceki pozisyon sonrası benzer pattern oluşumunu analiz eder ve re-entry önerir',
            inputs: [
                'previousExitReason', 'trendStrength', 'priceActionBias', 'newBreakoutConfirmed',
                'formation', 'formationSimilarityScore', 'psychologyStability', 'currentPrice',
                'timeFromLastExit', 'previousFormation', 'previousExitPrice'
            ],
            outputs: [
                'reEntryPossible', 'confidenceScore', 'reEntryTrigger', 'patternSimilarity',
                'trendContinuation', 'marketConditions', 'modularRecommendations', 'alert', 'metadata'
            ]
        };
    }
}

module.exports = ReEntryPatternMatcher;
