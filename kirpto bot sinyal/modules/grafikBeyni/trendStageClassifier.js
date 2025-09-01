const GrafikBeyniModuleBase = require('./grafikBeyniModuleBase');

/**
 * Trend Stage Classifier Module
 * Trend'in hangi aşamasında olduğunu belirler
 * Erken, orta, geç aşama trend analizi ve stage transition detection
 */
class TrendStageClassifier extends GrafikBeyniModuleBase {
    constructor() {
        super('trendStageClassifier');
        this.stageHistory = [];
        this.stageThresholds = {
            earlyStage: 0.3,
            midStage: 0.6,
            lateStage: 0.8,
            exhaustion: 0.9
        };
        this.indicators = {
            momentum: { weight: 0.25 },
            volume: { weight: 0.2 },
            volatility: { weight: 0.15 },
            participation: { weight: 0.15 },
            sentiment: { weight: 0.1 },
            timeElapsed: { weight: 0.15 }
        };
        this.maxHistorySize = 100;
        this.timeframes = ['5m', '15m', '1h', '4h', '1d'];
    }

    async analyze(data) {
        try {
            const {
                price,
                volume,
                trend,
                momentum,
                volatility,
                marketData,
                timeframe,
                historicalData,
                trendStartTime,
                priceTargets,
                supportResistance,
                sentimentData,
                newsFlow,
                participationMetrics,
                volumeProfile,
                breadthIndicators,
                cyclicalAnalysis
            } = data;

            // Veri doğrulama
            if (!price || !trend) {
                throw new Error('Missing required data for trend stage classification');
            }

            // Momentum stage analysis
            const momentumStage = this.analyzeMomentumStage(data);

            // Volume stage analysis
            const volumeStage = this.analyzeVolumeStage(data);

            // Time-based stage analysis
            const timeStage = this.analyzeTimeStage(data);

            // Price progression analysis
            const priceProgressionStage = this.analyzePriceProgression(data);

            // Participation breadth analysis
            const participationStage = this.analyzeParticipationStage(data);

            // Volatility lifecycle analysis
            const volatilityStage = this.analyzeVolatilityStage(data);

            // Sentiment evolution analysis
            const sentimentStage = this.analyzeSentimentStage(data);

            // News cycle stage analysis
            const newsCycleStage = this.analyzeNewsCycleStage(data);

            // Technical exhaustion signs
            const exhaustionAnalysis = this.analyzeExhaustionSigns(data);

            // Overall stage classification
            const overallStage = this.classifyOverallStage({
                momentumStage,
                volumeStage,
                timeStage,
                priceProgressionStage,
                participationStage,
                volatilityStage,
                sentimentStage,
                newsCycleStage,
                exhaustionAnalysis
            });

            // Stage transition probability
            const transitionProbability = this.calculateTransitionProbability(overallStage, data);

            // Stage duration estimation
            const durationEstimate = this.estimateStageDuration(overallStage, data);

            const result = {
                overallStage: overallStage,
                stageComponents: {
                    momentum: momentumStage,
                    volume: volumeStage,
                    time: timeStage,
                    priceProgression: priceProgressionStage,
                    participation: participationStage,
                    volatility: volatilityStage,
                    sentiment: sentimentStage,
                    newsCycle: newsCycleStage,
                    exhaustion: exhaustionAnalysis
                },
                transitionProbability: transitionProbability,
                durationEstimate: durationEstimate,
                stageCharacteristics: this.getStageCharacteristics(overallStage),
                tradingImplications: this.getTradingImplications(overallStage, data),
                recommendations: this.generateRecommendations(overallStage, transitionProbability, data),
                notes: this.generateNotes(overallStage, transitionProbability),
                metadata: {
                    analysisTimestamp: Date.now(),
                    timeframe: timeframe,
                    trendDirection: trend.direction,
                    currentStage: overallStage.stage,
                    stageConfidence: overallStage.confidence,
                    transitionRisk: transitionProbability.nextStage.probability > 0.6
                }
            };

            // Stage history güncelleme
            this.updateStageHistory(result, data);

            // Cache ve performance tracking
            this.updateCache(data, result);
            this.trackPerformance(Date.now(), overallStage.confidence > 0.7);

            return result;

        } catch (error) {
            this.handleError('TrendStageClassifier analysis failed', error, data);
            return this.getDefaultResult();
        }
    }

    analyzeMomentumStage(data) {
        const { momentum, trend, historicalData } = data;

        let stage = 'unknown';
        let confidence = 0.5;
        let score = 0;
        const factors = [];

        if (momentum) {
            // Momentum acceleration/deceleration
            if (momentum.acceleration !== undefined) {
                if (momentum.acceleration > 0.5) {
                    score += 0.3;
                    factors.push('Güçlü momentum ivmelenmesi');
                    stage = 'early';
                } else if (momentum.acceleration > 0) {
                    score += 0.2;
                    factors.push('Momentum ivmelenmesi');
                    stage = momentum.value > 0.6 ? 'mid' : 'early';
                } else if (momentum.acceleration < -0.3) {
                    score += 0.1;
                    factors.push('Momentum yavaşlaması');
                    stage = 'late';
                }
            }

            // Momentum strength
            if (momentum.value !== undefined) {
                if (momentum.value > 0.8) {
                    score += 0.2;
                    factors.push('Çok güçlü momentum');
                    stage = stage === 'unknown' ? 'mid' : stage;
                } else if (momentum.value > 0.6) {
                    score += 0.15;
                    factors.push('Güçlü momentum');
                    stage = stage === 'unknown' ? 'mid' : stage;
                } else if (momentum.value < 0.3) {
                    score += 0.1;
                    factors.push('Zayıf momentum');
                    stage = 'late';
                }
            }

            // Momentum divergence
            if (momentum.divergence) {
                score += 0.15;
                factors.push('Momentum divergence');
                stage = 'late';
            }

            confidence = Math.min(score * 2, 1);
        }

        // Historical momentum comparison
        if (historicalData && historicalData.momentum) {
            const currentVsHistorical = momentum.value / historicalData.momentum.average;
            
            if (currentVsHistorical > 1.5) {
                factors.push('Historik momentum üstünde');
                confidence += 0.1;
            } else if (currentVsHistorical < 0.5) {
                factors.push('Historik momentum altında');
                stage = 'late';
                confidence += 0.1;
            }
        }

        return {
            stage: stage,
            confidence: Math.min(confidence, 1),
            score: score,
            factors: factors,
            momentum: momentum?.value || 0,
            acceleration: momentum?.acceleration || 0,
            divergence: momentum?.divergence || false
        };
    }

    analyzeVolumeStage(data) {
        const { volume, averageVolume, volumeProfile, trend } = data;

        let stage = 'unknown';
        let confidence = 0.5;
        let score = 0;
        const factors = [];

        if (volume && averageVolume) {
            const volumeRatio = volume / averageVolume;

            // Volume strength analysis
            if (volumeRatio > 2) {
                score += 0.3;
                factors.push('Çok yüksek volume');
                stage = 'early';
                confidence += 0.2;
            } else if (volumeRatio > 1.5) {
                score += 0.2;
                factors.push('Yüksek volume');
                stage = 'mid';
                confidence += 0.15;
            } else if (volumeRatio < 0.7) {
                score += 0.1;
                factors.push('Düşük volume');
                stage = 'late';
                confidence += 0.1;
            }
        }

        // Volume profile analysis
        if (volumeProfile) {
            // Volume distribution
            if (volumeProfile.concentration > 0.7) {
                score += 0.15;
                factors.push('Volume konsantrasyonu');
                stage = stage === 'unknown' ? 'early' : stage;
            }

            // Volume at price levels
            if (volumeProfile.heavyVolumeLevels && volumeProfile.heavyVolumeLevels.length > 3) {
                score += 0.1;
                factors.push('Çoklu volume seviyeleri');
                stage = 'mid';
            }

            // Volume exhaustion
            if (volumeProfile.exhaustion) {
                score += 0.2;
                factors.push('Volume exhaustion');
                stage = 'late';
                confidence += 0.15;
            }
        }

        // Volume trend analysis
        if (data.volumeTrend) {
            if (data.volumeTrend.increasing && data.volumeTrend.strength > 0.6) {
                score += 0.15;
                factors.push('Artan volume trendi');
                stage = stage === 'unknown' ? 'early' : stage;
            } else if (data.volumeTrend.decreasing && data.volumeTrend.strength > 0.6) {
                score += 0.1;
                factors.push('Azalan volume trendi');
                stage = 'late';
            }
        }

        confidence = Math.min(score * 2, 1);

        return {
            stage: stage,
            confidence: confidence,
            score: score,
            factors: factors,
            volumeRatio: volume && averageVolume ? volume / averageVolume : 1,
            volumeStrength: this.classifyVolumeStrength(volume, averageVolume)
        };
    }

    analyzeTimeStage(data) {
        const { trendStartTime, timeframe, cyclicalAnalysis } = data;

        let stage = 'unknown';
        let confidence = 0.5;
        let score = 0;
        const factors = [];

        if (trendStartTime) {
            const currentTime = Date.now();
            const trendDuration = currentTime - trendStartTime;
            
            // Time-based stage classification
            const timeframeDurations = {
                '5m': 30 * 60 * 1000,    // 30 minutes
                '15m': 90 * 60 * 1000,   // 1.5 hours
                '1h': 6 * 60 * 60 * 1000, // 6 hours
                '4h': 24 * 60 * 60 * 1000, // 1 day
                '1d': 7 * 24 * 60 * 60 * 1000 // 1 week
            };

            const expectedDuration = timeframeDurations[timeframe] || timeframeDurations['1h'];
            const durationRatio = trendDuration / expectedDuration;

            if (durationRatio < 0.3) {
                stage = 'early';
                score += 0.3;
                factors.push('Trend başlangıç aşaması');
                confidence += 0.2;
            } else if (durationRatio < 0.7) {
                stage = 'mid';
                score += 0.2;
                factors.push('Trend orta aşama');
                confidence += 0.15;
            } else if (durationRatio < 1.2) {
                stage = 'late';
                score += 0.15;
                factors.push('Trend geç aşama');
                confidence += 0.1;
            } else {
                stage = 'exhaustion';
                score += 0.1;
                factors.push('Trend exhaustion aşaması');
                confidence += 0.15;
            }
        }

        // Cyclical analysis
        if (cyclicalAnalysis) {
            if (cyclicalAnalysis.phase === 'accumulation') {
                stage = 'early';
                factors.push('Accumulation phase');
                confidence += 0.1;
            } else if (cyclicalAnalysis.phase === 'markup') {
                stage = 'mid';
                factors.push('Markup phase');
                confidence += 0.1;
            } else if (cyclicalAnalysis.phase === 'distribution') {
                stage = 'late';
                factors.push('Distribution phase');
                confidence += 0.1;
            }
        }

        return {
            stage: stage,
            confidence: Math.min(confidence, 1),
            score: score,
            factors: factors,
            trendDuration: trendStartTime ? Date.now() - trendStartTime : 0,
            durationRatio: trendStartTime ? (Date.now() - trendStartTime) / (timeframeDurations[timeframe] || 3600000) : 0
        };
    }

    analyzePriceProgression(data) {
        const { price, priceTargets, supportResistance, trend } = data;

        let stage = 'unknown';
        let confidence = 0.5;
        let score = 0;
        const factors = [];

        // Price target progression
        if (priceTargets && priceTargets.length > 0) {
            const completedTargets = priceTargets.filter(target => 
                (trend.direction === 'up' && price >= target.price) ||
                (trend.direction === 'down' && price <= target.price)
            ).length;

            const targetCompletionRatio = completedTargets / priceTargets.length;

            if (targetCompletionRatio < 0.3) {
                stage = 'early';
                score += 0.3;
                factors.push(`${completedTargets}/${priceTargets.length} target tamamlandı`);
                confidence += 0.2;
            } else if (targetCompletionRatio < 0.7) {
                stage = 'mid';
                score += 0.2;
                factors.push('Hedeflerin yarısı tamamlandı');
                confidence += 0.15;
            } else {
                stage = 'late';
                score += 0.15;
                factors.push('Çoğu hedef tamamlandı');
                confidence += 0.1;
            }
        }

        // Support/Resistance interaction
        if (supportResistance) {
            const currentLevel = this.getCurrentSupportResistanceLevel(price, supportResistance);
            
            if (currentLevel) {
                const distanceFromLevel = Math.abs(price - currentLevel.price) / price;
                
                if (distanceFromLevel < 0.02) { // Within 2%
                    if (currentLevel.type === 'resistance') {
                        stage = 'late';
                        factors.push('Resistance seviyesinde');
                        confidence += 0.1;
                    } else {
                        stage = 'early';
                        factors.push('Support seviyesinde');
                        confidence += 0.1;
                    }
                }
            }
        }

        // Price movement efficiency
        if (data.priceEfficiency) {
            if (data.priceEfficiency > 0.8) {
                stage = stage === 'unknown' ? 'early' : stage;
                factors.push('Etkili fiyat hareketi');
                confidence += 0.1;
            } else if (data.priceEfficiency < 0.4) {
                stage = 'late';
                factors.push('Etkisiz fiyat hareketi');
                confidence += 0.1;
            }
        }

        return {
            stage: stage,
            confidence: Math.min(confidence, 1),
            score: score,
            factors: factors,
            targetCompletion: priceTargets ? 
                priceTargets.filter(t => 
                    (trend.direction === 'up' && price >= t.price) ||
                    (trend.direction === 'down' && price <= t.price)
                ).length / priceTargets.length : 0
        };
    }

    analyzeParticipationStage(data) {
        const { participationMetrics, breadthIndicators, marketData } = data;

        let stage = 'unknown';
        let confidence = 0.5;
        let score = 0;
        const factors = [];

        // Market breadth analysis
        if (breadthIndicators) {
            if (breadthIndicators.advanceDeclineRatio > 2) {
                stage = 'early';
                score += 0.3;
                factors.push('Geniş market katılımı');
                confidence += 0.2;
            } else if (breadthIndicators.advanceDeclineRatio > 1.2) {
                stage = 'mid';
                score += 0.2;
                factors.push('Orta market katılımı');
                confidence += 0.15;
            } else if (breadthIndicators.advanceDeclineRatio < 0.8) {
                stage = 'late';
                score += 0.1;
                factors.push('Zayıf market katılımı');
                confidence += 0.1;
            }

            // New highs/lows
            if (breadthIndicators.newHighs && breadthIndicators.newLows) {
                const highLowRatio = breadthIndicators.newHighs / (breadthIndicators.newLows || 1);
                
                if (highLowRatio > 3) {
                    stage = stage === 'unknown' ? 'early' : stage;
                    factors.push('Çok sayıda yeni yüksek');
                } else if (highLowRatio < 0.5) {
                    stage = 'late';
                    factors.push('Çok sayıda yeni düşük');
                }
            }
        }

        // Participation metrics
        if (participationMetrics) {
            if (participationMetrics.institutionalFlow > 0.6) {
                stage = stage === 'unknown' ? 'early' : stage;
                factors.push('Kurumsal katılım');
                confidence += 0.1;
            }

            if (participationMetrics.retailParticipation > 0.8) {
                stage = 'late';
                factors.push('Yüksek retail katılımı');
                confidence += 0.1;
            }

            // Smart money vs retail
            if (participationMetrics.smartMoneyRatio < 0.3) {
                stage = 'late';
                factors.push('Smart money çekilmesi');
                confidence += 0.15;
            }
        }

        return {
            stage: stage,
            confidence: Math.min(confidence, 1),
            score: score,
            factors: factors,
            breadthScore: breadthIndicators?.advanceDeclineRatio || 1,
            participationQuality: this.assessParticipationQuality(participationMetrics)
        };
    }

    analyzeVolatilityStage(data) {
        const { volatility, historicalData } = data;

        let stage = 'unknown';
        let confidence = 0.5;
        let score = 0;
        const factors = [];

        if (volatility) {
            // Volatility level analysis
            const volatilityLevel = volatility.current || volatility;
            
            if (historicalData && historicalData.volatility) {
                const volatilityRatio = volatilityLevel / historicalData.volatility.average;
                
                if (volatilityRatio > 1.5) {
                    stage = 'early';
                    score += 0.3;
                    factors.push('Yüksek volatilite');
                    confidence += 0.2;
                } else if (volatilityRatio > 1.2) {
                    stage = 'mid';
                    score += 0.2;
                    factors.push('Orta yüksek volatilite');
                    confidence += 0.15;
                } else if (volatilityRatio < 0.8) {
                    stage = 'late';
                    score += 0.15;
                    factors.push('Düşük volatilite');
                    confidence += 0.1;
                }
            }

            // Volatility trend
            if (volatility.trend) {
                if (volatility.trend === 'increasing') {
                    stage = stage === 'unknown' ? 'early' : stage;
                    factors.push('Artan volatilite');
                } else if (volatility.trend === 'decreasing') {
                    stage = 'late';
                    factors.push('Azalan volatilite');
                }
            }

            // Volatility clustering
            if (volatility.clustering && volatility.clustering > 0.6) {
                stage = 'mid';
                factors.push('Volatilite kümelenmesi');
                confidence += 0.1;
            }
        }

        return {
            stage: stage,
            confidence: Math.min(confidence, 1),
            score: score,
            factors: factors,
            volatilityLevel: volatility?.current || volatility || 0,
            volatilityTrend: volatility?.trend || 'unknown'
        };
    }

    analyzeSentimentStage(data) {
        const { sentimentData, marketData } = data;

        let stage = 'unknown';
        let confidence = 0.5;
        let score = 0;
        const factors = [];

        if (sentimentData) {
            // Fear & Greed analysis
            if (sentimentData.fearGreedIndex !== undefined) {
                if (sentimentData.fearGreedIndex < 25) {
                    stage = 'early';
                    score += 0.3;
                    factors.push('Extreme fear - contrarian opportunity');
                    confidence += 0.2;
                } else if (sentimentData.fearGreedIndex < 40) {
                    stage = 'early';
                    score += 0.2;
                    factors.push('Fear sentiment');
                    confidence += 0.15;
                } else if (sentimentData.fearGreedIndex > 75) {
                    stage = 'late';
                    score += 0.15;
                    factors.push('Extreme greed - caution');
                    confidence += 0.1;
                } else if (sentimentData.fearGreedIndex > 60) {
                    stage = 'mid';
                    score += 0.1;
                    factors.push('Greedy sentiment');
                    confidence += 0.1;
                }
            }

            // Social sentiment
            if (sentimentData.socialSentiment) {
                if (sentimentData.socialSentiment > 0.8) {
                    stage = 'late';
                    factors.push('Aşırı pozitif sosyal duyarlılık');
                } else if (sentimentData.socialSentiment < 0.2) {
                    stage = 'early';
                    factors.push('Aşırı negatif sosyal duyarlılık');
                }
            }

            // Sentiment divergence
            if (sentimentData.divergence) {
                stage = 'late';
                factors.push('Sentiment divergence');
                confidence += 0.15;
            }
        }

        return {
            stage: stage,
            confidence: Math.min(confidence, 1),
            score: score,
            factors: factors,
            fearGreedLevel: sentimentData?.fearGreedIndex || 50,
            sentimentTrend: sentimentData?.trend || 'neutral'
        };
    }

    analyzeNewsCycleStage(data) {
        const { newsFlow } = data;

        let stage = 'unknown';
        let confidence = 0.5;
        let score = 0;
        const factors = [];

        if (newsFlow) {
            // News sentiment analysis
            if (newsFlow.sentiment !== undefined) {
                if (newsFlow.sentiment > 0.6) {
                    stage = 'mid';
                    score += 0.2;
                    factors.push('Pozitif haber akışı');
                    confidence += 0.1;
                } else if (newsFlow.sentiment < -0.6) {
                    stage = 'early';
                    score += 0.2;
                    factors.push('Negatif haber akışı');
                    confidence += 0.1;
                }
            }

            // News frequency
            if (newsFlow.frequency > 0.8) {
                stage = 'late';
                factors.push('Yoğun haber akışı');
                confidence += 0.1;
            }

            // Major news impact
            if (newsFlow.majorNews && newsFlow.majorNews.length > 0) {
                const recentMajorNews = newsFlow.majorNews.filter(news => 
                    Date.now() - news.timestamp < 24 * 60 * 60 * 1000
                );
                
                if (recentMajorNews.length > 0) {
                    stage = 'early';
                    factors.push('Yakın zamanda major haber');
                    confidence += 0.15;
                }
            }

            // News cycle exhaustion
            if (newsFlow.exhaustion) {
                stage = 'late';
                factors.push('Haber döngüsü yorgunluğu');
                confidence += 0.1;
            }
        }

        return {
            stage: stage,
            confidence: Math.min(confidence, 1),
            score: score,
            factors: factors,
            newsSentiment: newsFlow?.sentiment || 0,
            newsFrequency: newsFlow?.frequency || 0
        };
    }

    analyzeExhaustionSigns(data) {
        const { price, volume, momentum, volatility, sentimentData } = data;

        let exhaustionScore = 0;
        const signs = [];
        let exhaustionDetected = false;

        // Volume exhaustion
        if (volume && data.averageVolume) {
            if (volume < data.averageVolume * 0.5) {
                exhaustionScore += 0.2;
                signs.push('Volume exhaustion');
            }
        }

        // Momentum exhaustion
        if (momentum && momentum.value < 0.3 && momentum.acceleration < -0.2) {
            exhaustionScore += 0.25;
            signs.push('Momentum exhaustion');
        }

        // Volatility exhaustion
        if (volatility && volatility.trend === 'decreasing' && volatility.current < 0.3) {
            exhaustionScore += 0.15;
            signs.push('Volatilite exhaustion');
        }

        // Sentiment exhaustion
        if (sentimentData && (sentimentData.fearGreedIndex > 85 || sentimentData.fearGreedIndex < 15)) {
            exhaustionScore += 0.2;
            signs.push('Sentiment extremes');
        }

        // Price action exhaustion
        if (data.priceActionSigns) {
            if (data.priceActionSigns.weakerHighs || data.priceActionSigns.weakerLows) {
                exhaustionScore += 0.2;
                signs.push('Zayıf fiyat aksiyonu');
            }
        }

        exhaustionDetected = exhaustionScore > 0.5;

        return {
            detected: exhaustionDetected,
            score: exhaustionScore,
            signs: signs,
            level: exhaustionScore > 0.7 ? 'high' : exhaustionScore > 0.4 ? 'moderate' : 'low'
        };
    }

    classifyOverallStage(stageComponents) {
        const stages = ['early', 'mid', 'late', 'exhaustion'];
        const stageScores = { early: 0, mid: 0, late: 0, exhaustion: 0 };
        const weights = this.indicators;

        // Weight-based scoring
        Object.keys(stageComponents).forEach(component => {
            const componentData = stageComponents[component];
            const weight = weights[component]?.weight || 0.1;
            
            if (componentData.stage && componentData.stage !== 'unknown') {
                stageScores[componentData.stage] += weight * componentData.confidence;
            }
        });

        // Handle exhaustion separately
        if (stageComponents.exhaustion && stageComponents.exhaustion.detected) {
            stageScores.exhaustion += stageComponents.exhaustion.score * 0.3;
        }

        // Find dominant stage
        const dominantStage = Object.keys(stageScores).reduce((a, b) => 
            stageScores[a] > stageScores[b] ? a : b
        );

        // Calculate overall confidence
        const totalScore = Object.values(stageScores).reduce((sum, score) => sum + score, 0);
        const confidence = totalScore > 0 ? stageScores[dominantStage] / totalScore : 0.5;

        // Generate supporting factors
        const supportingFactors = [];
        Object.keys(stageComponents).forEach(component => {
            const componentData = stageComponents[component];
            if (componentData.stage === dominantStage && componentData.factors) {
                supportingFactors.push(...componentData.factors.slice(0, 2));
            }
        });

        return {
            stage: dominantStage,
            confidence: confidence,
            scores: stageScores,
            supportingFactors: supportingFactors.slice(0, 5),
            componentCount: Object.keys(stageComponents).length,
            consensusStrength: confidence
        };
    }

    calculateTransitionProbability(overallStage, data) {
        const currentStage = overallStage.stage;
        const stageTransitions = {
            early: 'mid',
            mid: 'late',
            late: 'exhaustion',
            exhaustion: 'early' // Cycle restart
        };

        const nextStage = stageTransitions[currentStage];
        let transitionProbability = 0;

        // Base transition probability based on confidence
        transitionProbability = (1 - overallStage.confidence) * 0.5;

        // Time-based transition probability
        if (data.trendStartTime) {
            const trendDuration = Date.now() - data.trendStartTime;
            const expectedStageDuration = this.getExpectedStageDuration(currentStage, data.timeframe);
            
            const durationRatio = trendDuration / expectedStageDuration;
            if (durationRatio > 1) {
                transitionProbability += Math.min(durationRatio - 1, 0.5);
            }
        }

        // Technical indicators suggesting transition
        if (data.momentum && data.momentum.divergence) {
            transitionProbability += 0.2;
        }

        if (data.volume && data.averageVolume && data.volume < data.averageVolume * 0.6) {
            transitionProbability += 0.15;
        }

        return {
            currentStage: currentStage,
            nextStage: {
                stage: nextStage,
                probability: Math.min(transitionProbability, 0.9)
            },
            timeToTransition: this.estimateTimeToTransition(transitionProbability, data),
            catalysts: this.identifyTransitionCatalysts(currentStage, nextStage, data)
        };
    }

    estimateStageDuration(overallStage, data) {
        const currentStage = overallStage.stage;
        const baselineDuration = this.getExpectedStageDuration(currentStage, data.timeframe);
        
        // Adjust based on market conditions
        let adjustmentFactor = 1;

        if (data.volatility && data.volatility.current > 0.6) {
            adjustmentFactor *= 0.7; // High volatility shortens stages
        }

        if (data.volume && data.averageVolume && data.volume > data.averageVolume * 2) {
            adjustmentFactor *= 0.8; // High volume shortens stages
        }

        if (overallStage.confidence > 0.8) {
            adjustmentFactor *= 1.2; // High confidence extends stage
        }

        const estimatedDuration = baselineDuration * adjustmentFactor;

        return {
            baseline: baselineDuration,
            estimated: estimatedDuration,
            adjustmentFactor: adjustmentFactor,
            confidence: overallStage.confidence > 0.6 ? 'high' : 'moderate'
        };
    }

    getStageCharacteristics(overallStage) {
        const characteristics = {
            early: {
                volume: 'Increasing',
                momentum: 'Building',
                sentiment: 'Pessimistic to neutral',
                participation: 'Smart money',
                volatility: 'High',
                news: 'Contrarian signals'
            },
            mid: {
                volume: 'Sustained high',
                momentum: 'Strong',
                sentiment: 'Improving',
                participation: 'Broadening',
                volatility: 'Moderate to high',
                news: 'Positive flow'
            },
            late: {
                volume: 'Decreasing',
                momentum: 'Weakening',
                sentiment: 'Optimistic',
                participation: 'Retail heavy',
                volatility: 'Decreasing',
                news: 'Euphoric coverage'
            },
            exhaustion: {
                volume: 'Very low',
                momentum: 'Minimal',
                sentiment: 'Extreme',
                participation: 'Minimal quality',
                volatility: 'Very low',
                news: 'Saturation'
            }
        };

        return characteristics[overallStage.stage] || characteristics.mid;
    }

    getTradingImplications(overallStage, data) {
        const implications = {
            early: {
                strategy: 'Accumulation',
                risk: 'Moderate',
                timeHorizon: 'Medium to long',
                entryQuality: 'Excellent',
                stopLoss: 'Tight',
                targetExpectation: 'High'
            },
            mid: {
                strategy: 'Trend following',
                risk: 'Moderate',
                timeHorizon: 'Medium',
                entryQuality: 'Good',
                stopLoss: 'Normal',
                targetExpectation: 'Moderate'
            },
            late: {
                strategy: 'Profit taking',
                risk: 'High',
                timeHorizon: 'Short',
                entryQuality: 'Poor',
                stopLoss: 'Tight',
                targetExpectation: 'Limited'
            },
            exhaustion: {
                strategy: 'Exit/Short',
                risk: 'Very high',
                timeHorizon: 'Very short',
                entryQuality: 'Very poor',
                stopLoss: 'Very tight',
                targetExpectation: 'Minimal'
            }
        };

        return implications[overallStage.stage] || implications.mid;
    }

    generateRecommendations(overallStage, transitionProbability, data) {
        const recommendations = {};

        // VIVO recommendations
        if (overallStage.stage === 'early') {
            recommendations.vivo = {
                signalGeneration: 'aggressive',
                riskLevel: 'moderate',
                positionSizing: 'increased'
            };
        } else if (overallStage.stage === 'mid') {
            recommendations.vivo = {
                signalGeneration: 'normal',
                riskLevel: 'normal',
                positionSizing: 'normal'
            };
        } else if (overallStage.stage === 'late') {
            recommendations.vivo = {
                signalGeneration: 'cautious',
                riskLevel: 'high',
                positionSizing: 'reduced'
            };
        } else if (overallStage.stage === 'exhaustion') {
            recommendations.vivo = {
                signalGeneration: 'minimal',
                riskLevel: 'very_high',
                positionSizing: 'minimal'
            };
        }

        // Risk management
        recommendations.riskManagement = {
            stageAwareness: true,
            dynamicStopLoss: true,
            transitionMonitoring: transitionProbability.nextStage.probability > 0.6
        };

        // Monitoring recommendations
        recommendations.monitoring = {
            stageTransitionAlerts: true,
            exhaustionWarnings: overallStage.stage === 'late',
            frequencyAdjustment: overallStage.stage === 'exhaustion' ? 'increased' : 'normal'
        };

        return recommendations;
    }

    generateNotes(overallStage, transitionProbability) {
        const notes = [];

        notes.push(`Trend aşaması: ${overallStage.stage} (güven: ${(overallStage.confidence * 100).toFixed(0)}%)`);
        
        if (transitionProbability.nextStage.probability > 0.6) {
            notes.push(`${transitionProbability.nextStage.stage} aşamasına geçiş olasılığı yüksek`);
        }

        if (overallStage.supportingFactors.length > 0) {
            notes.push(`Destekleyici faktörler: ${overallStage.supportingFactors.slice(0, 2).join(', ')}`);
        }

        return notes.join('. ');
    }

    // Helper methods
    getCurrentSupportResistanceLevel(price, supportResistance) {
        if (!supportResistance || !supportResistance.levels) return null;

        return supportResistance.levels.find(level => 
            Math.abs(price - level.price) / price < 0.03
        );
    }

    classifyVolumeStrength(volume, averageVolume) {
        if (!volume || !averageVolume) return 'unknown';
        
        const ratio = volume / averageVolume;
        
        if (ratio > 2) return 'very_high';
        if (ratio > 1.5) return 'high';
        if (ratio > 1.2) return 'above_average';
        if (ratio > 0.8) return 'average';
        if (ratio > 0.5) return 'below_average';
        return 'low';
    }

    assessParticipationQuality(participationMetrics) {
        if (!participationMetrics) return 'unknown';

        let quality = 'average';
        let score = 0;

        if (participationMetrics.institutionalFlow > 0.6) score += 2;
        if (participationMetrics.smartMoneyRatio > 0.5) score += 2;
        if (participationMetrics.retailParticipation < 0.6) score += 1;

        if (score >= 4) quality = 'high';
        else if (score >= 2) quality = 'moderate';
        else quality = 'low';

        return quality;
    }

    getExpectedStageDuration(stage, timeframe) {
        const baseDurations = {
            early: { '5m': 15, '15m': 45, '1h': 180, '4h': 720, '1d': 4320 }, // minutes
            mid: { '5m': 30, '15m': 90, '1h': 360, '4h': 1440, '1d': 8640 },
            late: { '5m': 20, '15m': 60, '1h': 240, '4h': 960, '1d': 5760 },
            exhaustion: { '5m': 10, '15m': 30, '1h': 120, '4h': 480, '1d': 2880 }
        };

        return (baseDurations[stage] && baseDurations[stage][timeframe]) || 60; // Default to 1 hour
    }

    estimateTimeToTransition(transitionProbability, data) {
        if (transitionProbability < 0.3) return 'extended';
        if (transitionProbability < 0.6) return 'moderate';
        return 'imminent';
    }

    identifyTransitionCatalysts(currentStage, nextStage, data) {
        const catalysts = [];

        if (data.momentum && data.momentum.divergence) {
            catalysts.push('Momentum divergence');
        }

        if (data.volume && data.averageVolume && data.volume < data.averageVolume * 0.7) {
            catalysts.push('Volume düşüşü');
        }

        if (data.sentimentData && (data.sentimentData.fearGreedIndex > 80 || data.sentimentData.fearGreedIndex < 20)) {
            catalysts.push('Sentiment extremes');
        }

        return catalysts;
    }

    updateStageHistory(result, data) {
        this.stageHistory.push({
            timestamp: Date.now(),
            stage: result.overallStage.stage,
            confidence: result.overallStage.confidence,
            transitionProbability: result.transitionProbability.nextStage.probability,
            timeframe: data.timeframe
        });

        if (this.stageHistory.length > this.maxHistorySize) {
            this.stageHistory = this.stageHistory.slice(-this.maxHistorySize);
        }
    }

    getDefaultResult() {
        return {
            overallStage: {
                stage: 'unknown',
                confidence: 0.5,
                scores: { early: 0, mid: 0, late: 0, exhaustion: 0 },
                supportingFactors: [],
                componentCount: 0,
                consensusStrength: 0.5
            },
            stageComponents: {
                momentum: { stage: 'unknown', confidence: 0.5, score: 0, factors: [] },
                volume: { stage: 'unknown', confidence: 0.5, score: 0, factors: [] },
                time: { stage: 'unknown', confidence: 0.5, score: 0, factors: [] },
                priceProgression: { stage: 'unknown', confidence: 0.5, score: 0, factors: [] },
                participation: { stage: 'unknown', confidence: 0.5, score: 0, factors: [] },
                volatility: { stage: 'unknown', confidence: 0.5, score: 0, factors: [] },
                sentiment: { stage: 'unknown', confidence: 0.5, score: 0, factors: [] },
                newsCycle: { stage: 'unknown', confidence: 0.5, score: 0, factors: [] },
                exhaustion: { detected: false, score: 0, signs: [], level: 'low' }
            },
            transitionProbability: {
                currentStage: 'unknown',
                nextStage: { stage: 'unknown', probability: 0.5 },
                timeToTransition: 'unknown',
                catalysts: []
            },
            durationEstimate: {
                baseline: 60,
                estimated: 60,
                adjustmentFactor: 1,
                confidence: 'moderate'
            },
            stageCharacteristics: {},
            tradingImplications: {},
            recommendations: {},
            notes: "Trend stage classifier analizi yapılamadı - yetersiz veri",
            metadata: {
                error: true,
                analysisTimestamp: Date.now()
            }
        };
    }

    getModuleInfo() {
        return {
            name: 'TrendStageClassifier',
            version: '1.0.0',
            description: 'Trend\'in hangi aşamasında olduğunu belirler - erken, orta, geç aşama trend analizi ve stage transition detection',
            inputs: [
                'price', 'volume', 'trend', 'momentum', 'volatility', 'marketData',
                'timeframe', 'historicalData', 'trendStartTime', 'priceTargets',
                'supportResistance', 'sentimentData', 'newsFlow', 'participationMetrics',
                'volumeProfile', 'breadthIndicators', 'cyclicalAnalysis'
            ],
            outputs: [
                'overallStage', 'stageComponents', 'transitionProbability', 'durationEstimate',
                'stageCharacteristics', 'tradingImplications', 'recommendations', 'notes', 'metadata'
            ]
        };
    }
}

module.exports = TrendStageClassifier;
