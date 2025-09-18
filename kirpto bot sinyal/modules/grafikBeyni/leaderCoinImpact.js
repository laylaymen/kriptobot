const GrafikBeyniModuleBase = require('../grafikBeyniModuleBase');

/**
 * Leader Coin Impact Module
 * Bitcoin ve market leader coin'lerin impact analysis
 * BTC dominance, leader coin movements ve market sürüklenme analizi
 */
class LeaderCoinImpact extends GrafikBeyniModuleBase {
    constructor() {
        super('leaderCoinImpact');
        this.leaderCoins = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT'];
        this.dominanceHistory = [];
        this.correlationHistory = [];
        this.impactThresholds = {
            btcDominanceShift: 0.02,
            leaderMovement: 0.03,
            correlationBreak: 0.3,
            impactMagnitude: 0.5
        };
        this.timeframes = ['1m', '5m', '15m', '1h', '4h', '1d'];
        this.maxHistorySize = 200;
    }

    async analyze(data) {
        try {
            const {
                symbol,
                price,
                volume,
                marketData,
                btcData,
                ethData,
                leaderCoinData,
                dominanceData,
                correlationMatrix,
                marketCap,
                timeframe,
                historicalData,
                flowData,
                sentimentData,
                newsFlow,
                macroData
            } = data;

            // Veri doğrulama
            if (!symbol || !price) {
                throw new Error('Missing required data for leader coin impact analysis');
            }

            // BTC dominance analysis
            const btcDominanceAnalysis = this.analyzeBTCDominance(data);

            // Leader coin movement detection
            const leaderMovementAnalysis = this.analyzeLeaderMovements(data);

            // Cross-correlation analysis
            const correlationAnalysis = this.analyzeCrossCorrelations(data);

            // Market leadership assessment
            const leadershipAnalysis = this.assessMarketLeadership(data);

            // Impact magnitude calculation
            const impactMagnitude = this.calculateImpactMagnitude(data);

            // Contagion effect analysis
            const contagionAnalysis = this.analyzeContagionEffects(data);

            // Decoupling detection
            const decouplingAnalysis = this.analyzeDecoupling(data);

            // Flow impact assessment
            const flowImpactAnalysis = this.analyzeFlowImpact(data);

            // Market regime detection
            const regimeAnalysis = this.analyzeMarketRegime(data);

            // Overall impact assessment
            const overallImpact = this.calculateOverallImpact({
                btcDominanceAnalysis,
                leaderMovementAnalysis,
                correlationAnalysis,
                leadershipAnalysis,
                impactMagnitude,
                contagionAnalysis,
                decouplingAnalysis,
                flowImpactAnalysis,
                regimeAnalysis
            });

            const result = {
                overallImpact: overallImpact,
                btcDominance: btcDominanceAnalysis,
                leaderMovements: leaderMovementAnalysis,
                correlations: correlationAnalysis,
                leadership: leadershipAnalysis,
                impactMagnitude: impactMagnitude,
                contagionEffects: contagionAnalysis,
                decoupling: decouplingAnalysis,
                flowImpact: flowImpactAnalysis,
                marketRegime: regimeAnalysis,
                recommendations: this.generateRecommendations(overallImpact, data),
                signals: this.generateSignals(overallImpact, data),
                notes: this.generateNotes(overallImpact, data),
                metadata: {
                    analysisTimestamp: Date.now(),
                    symbol: symbol,
                    timeframe: timeframe,
                    leaderCoinsAnalyzed: this.leaderCoins,
                    impactLevel: overallImpact.level,
                    impactScore: overallImpact.score,
                    strongImpact: overallImpact.score > 0.7
                }
            };

            // History güncelleme
            this.updateAnalysisHistory(result, data);

            // Cache ve performance tracking
            this.updateCache(data, result);
            this.trackPerformance(Date.now(), overallImpact.score > 0.5);

            return result;

        } catch (error) {
            this.handleError('LeaderCoinImpact analysis failed', error, data);
            return this.getDefaultResult();
        }
    }

    analyzeBTCDominance(data) {
        const { dominanceData, btcData, marketData } = data;

        let analysis = {
            current: 0,
            change: 0,
            trend: 'neutral',
            significance: 'low',
            factors: [],
            impact: 'minimal'
        };

        if (dominanceData) {
            analysis.current = dominanceData.btcDominance || 0;
            analysis.change = dominanceData.dominanceChange || 0;

            // Dominance shift analysis
            if (Math.abs(analysis.change) > this.impactThresholds.btcDominanceShift) {
                if (analysis.change > 0) {
                    analysis.trend = 'increasing';
                    analysis.significance = 'high';
                    analysis.factors.push('BTC dominance artışı');
                    analysis.impact = 'negative_for_alts';
                } else {
                    analysis.trend = 'decreasing';
                    analysis.significance = 'high';
                    analysis.factors.push('BTC dominance azalışı');
                    analysis.impact = 'positive_for_alts';
                }
            }

            // Historical dominance levels
            if (dominanceData.historicalRange) {
                const { min, max, average } = dominanceData.historicalRange;
                const currentPosition = (analysis.current - min) / (max - min);
                
                if (currentPosition > 0.8) {
                    analysis.factors.push('Dominance historik yüksek seviyelerde');
                    analysis.impact = 'strong_negative_for_alts';
                } else if (currentPosition < 0.2) {
                    analysis.factors.push('Dominance historik düşük seviyelerde');
                    analysis.impact = 'strong_positive_for_alts';
                }
            }
        }

        // BTC price action impact
        if (btcData && btcData.priceChange) {
            const btcPriceChange = Math.abs(btcData.priceChange);
            
            if (btcPriceChange > this.impactThresholds.leaderMovement) {
                analysis.factors.push(`BTC ${(btcPriceChange * 100).toFixed(1)}% hareket`);
                analysis.significance = 'high';
                
                if (btcData.priceChange > 0) {
                    analysis.impact = analysis.impact === 'minimal' ? 'positive' : analysis.impact;
                } else {
                    analysis.impact = analysis.impact === 'minimal' ? 'negative' : analysis.impact;
                }
            }
        }

        return analysis;
    }

    analyzeLeaderMovements(data) {
        const { leaderCoinData, btcData, ethData } = data;
        
        const movements = [];
        let overallImpact = 0;

        // BTC movement analysis
        if (btcData) {
            const btcImpact = this.analyzeIndividualLeaderMovement('BTC', btcData);
            movements.push(btcImpact);
            overallImpact += btcImpact.impactScore * 0.5; // BTC has 50% weight
        }

        // ETH movement analysis
        if (ethData) {
            const ethImpact = this.analyzeIndividualLeaderMovement('ETH', ethData);
            movements.push(ethImpact);
            overallImpact += ethImpact.impactScore * 0.3; // ETH has 30% weight
        }

        // Other leader coins
        if (leaderCoinData) {
            Object.keys(leaderCoinData).forEach(coin => {
                if (coin !== 'BTCUSDT' && coin !== 'ETHUSDT') {
                    const coinImpact = this.analyzeIndividualLeaderMovement(coin, leaderCoinData[coin]);
                    movements.push(coinImpact);
                    overallImpact += coinImpact.impactScore * 0.1; // Other coins have 10% weight each
                }
            });
        }

        // Movement synchronization analysis
        const synchronization = this.analyzeSynchronization(movements);

        return {
            movements: movements,
            overallImpact: overallImpact,
            synchronization: synchronization,
            leaderCount: movements.length,
            strongMovements: movements.filter(m => m.strength === 'strong').length,
            direction: this.getOverallDirection(movements),
            magnitude: this.getOverallMagnitude(movements)
        };
    }

    analyzeIndividualLeaderMovement(coin, coinData) {
        const {
            priceChange,
            volume,
            volumeChange,
            volatility,
            momentum,
            breakout
        } = coinData;

        let impactScore = 0;
        const factors = [];
        let strength = 'weak';
        let direction = 'neutral';

        // Price movement impact
        if (priceChange !== undefined) {
            const absPriceChange = Math.abs(priceChange);
            
            if (absPriceChange > this.impactThresholds.leaderMovement) {
                impactScore += absPriceChange * 2; // Amplify impact
                factors.push(`${(absPriceChange * 100).toFixed(1)}% fiyat hareketi`);
                strength = absPriceChange > 0.05 ? 'strong' : 'moderate';
                direction = priceChange > 0 ? 'bullish' : 'bearish';
            }
        }

        // Volume confirmation
        if (volumeChange && volumeChange > 0.5) {
            impactScore += 0.2;
            factors.push('Yüksek volume konfirmasyonu');
        }

        // Breakout detection
        if (breakout && breakout.confirmed) {
            impactScore += 0.3;
            factors.push('Breakout konfirmasyonu');
            strength = 'strong';
        }

        // Momentum analysis
        if (momentum && Math.abs(momentum) > 0.6) {
            impactScore += 0.1;
            factors.push('Güçlü momentum');
        }

        return {
            coin: coin,
            impactScore: Math.min(impactScore, 1),
            strength: strength,
            direction: direction,
            factors: factors,
            priceChange: priceChange,
            volumeConfirmation: volumeChange > 0.5,
            breakoutConfirmed: breakout?.confirmed || false
        };
    }

    analyzeCrossCorrelations(data) {
        const { correlationMatrix, symbol } = data;
        
        if (!correlationMatrix) {
            return { correlations: {}, averageCorrelation: 0.5, regime: 'normal' };
        }

        const correlations = {};
        let totalCorrelation = 0;
        let correlationCount = 0;

        // BTC correlation
        if (correlationMatrix.BTC !== undefined) {
            correlations.BTC = correlationMatrix.BTC;
            totalCorrelation += Math.abs(correlationMatrix.BTC);
            correlationCount++;
        }

        // ETH correlation
        if (correlationMatrix.ETH !== undefined) {
            correlations.ETH = correlationMatrix.ETH;
            totalCorrelation += Math.abs(correlationMatrix.ETH);
            correlationCount++;
        }

        // Other leader correlations
        this.leaderCoins.forEach(leader => {
            if (correlationMatrix[leader] !== undefined && leader !== symbol) {
                correlations[leader] = correlationMatrix[leader];
                totalCorrelation += Math.abs(correlationMatrix[leader]);
                correlationCount++;
            }
        });

        const averageCorrelation = correlationCount > 0 ? totalCorrelation / correlationCount : 0.5;

        // Correlation regime detection
        let regime = 'normal';
        if (averageCorrelation > 0.8) {
            regime = 'high_correlation';
        } else if (averageCorrelation < this.impactThresholds.correlationBreak) {
            regime = 'decoupled';
        }

        // Correlation breakdown detection
        const breakdowns = [];
        Object.keys(correlations).forEach(leader => {
            if (Math.abs(correlations[leader]) < this.impactThresholds.correlationBreak) {
                breakdowns.push(leader);
            }
        });

        return {
            correlations: correlations,
            averageCorrelation: averageCorrelation,
            regime: regime,
            breakdowns: breakdowns,
            decouplingDetected: breakdowns.length > 0,
            strongCorrelation: averageCorrelation > 0.7
        };
    }

    assessMarketLeadership(data) {
        const { symbol, marketData, leaderCoinData, volume, priceChange } = data;

        const assessment = {
            isLeader: false,
            leadershipScore: 0,
            leadershipType: 'follower',
            factors: []
        };

        // Volume leadership
        if (marketData && marketData.totalVolume) {
            const volumeShare = volume / marketData.totalVolume;
            
            if (volumeShare > 0.05) { // 5% of total volume
                assessment.leadershipScore += 0.3;
                assessment.factors.push('Yüksek volume payı');
            }
        }

        // Price leadership (first mover)
        if (leaderCoinData && priceChange) {
            const leaderMovements = Object.values(leaderCoinData);
            const avgLeaderChange = leaderMovements.reduce((sum, data) => 
                sum + (data.priceChange || 0), 0) / leaderMovements.length;
            
            if (Math.abs(priceChange) > Math.abs(avgLeaderChange) * 1.2) {
                assessment.leadershipScore += 0.2;
                assessment.factors.push('Leader coin\'lerden önce hareket');
            }
        }

        // Market cap leadership
        if (data.marketCap && data.marketCap.rank <= 10) {
            assessment.leadershipScore += 0.2;
            assessment.factors.push('Top 10 market cap');
        }

        // News leadership
        if (data.newsFlow && data.newsFlow.mentionFrequency > 0.7) {
            assessment.leadershipScore += 0.1;
            assessment.factors.push('Yüksek haber akışı');
        }

        // Social sentiment leadership
        if (data.socialSentiment && data.socialSentiment.influence > 0.6) {
            assessment.leadershipScore += 0.1;
            assessment.factors.push('Sosyal medya etkisi');
        }

        // Leadership classification
        if (assessment.leadershipScore > 0.6) {
            assessment.isLeader = true;
            assessment.leadershipType = 'strong_leader';
        } else if (assessment.leadershipScore > 0.4) {
            assessment.leadershipType = 'emerging_leader';
        } else if (assessment.leadershipScore > 0.2) {
            assessment.leadershipType = 'weak_leader';
        }

        return assessment;
    }

    calculateImpactMagnitude(data) {
        const { symbol, priceChange, volume, marketData, correlationMatrix } = data;

        let magnitude = 0;
        const factors = [];

        // Direct price impact
        if (priceChange) {
            magnitude += Math.abs(priceChange) * 0.4;
            if (Math.abs(priceChange) > 0.05) {
                factors.push('Güçlü fiyat hareketi');
            }
        }

        // Volume amplification
        if (volume && marketData?.averageVolume) {
            const volumeRatio = volume / marketData.averageVolume;
            if (volumeRatio > 2) {
                magnitude += 0.2;
                factors.push('Volume amplifikasyonu');
            }
        }

        // Correlation multiplier
        if (correlationMatrix) {
            const avgCorrelation = this.calculateAverageCorrelation(correlationMatrix, symbol);
            magnitude *= (1 + avgCorrelation * 0.5); // Up to 50% amplification
            
            if (avgCorrelation > 0.7) {
                factors.push('Yüksek korelasyon amplifikasyonu');
            }
        }

        // Market cap weight
        if (data.marketCap && data.marketCap.weight) {
            magnitude *= (1 + data.marketCap.weight * 0.3);
            
            if (data.marketCap.weight > 0.1) {
                factors.push('Market cap ağırlık etkisi');
            }
        }

        return {
            magnitude: Math.min(magnitude, 2), // Cap at 2x
            factors: factors,
            level: magnitude > 1 ? 'high' : magnitude > 0.5 ? 'moderate' : 'low'
        };
    }

    analyzeContagionEffects(data) {
        const { correlationMatrix, marketData, flowData } = data;

        const effects = {
            contagionRisk: 0,
            spreadProbability: 0,
            affectedSectors: [],
            timeToSpread: 0,
            factors: []
        };

        // Correlation-based contagion
        if (correlationMatrix) {
            const highCorrelations = Object.values(correlationMatrix)
                .filter(corr => Math.abs(corr) > 0.7).length;
            
            effects.contagionRisk += highCorrelations * 0.1;
            
            if (highCorrelations > 5) {
                effects.factors.push('Yüksek cross-asset korelasyon');
            }
        }

        // Flow-based contagion
        if (flowData && flowData.sellPressure > 0.7) {
            effects.contagionRisk += 0.2;
            effects.factors.push('Satış baskısı yayılımı');
        }

        // Market regime contagion
        if (marketData && marketData.regime === 'risk_off') {
            effects.contagionRisk += 0.3;
            effects.factors.push('Risk-off regime etkisi');
        }

        // Calculate spread probability
        effects.spreadProbability = Math.min(effects.contagionRisk * 1.2, 1);

        // Estimate time to spread
        if (effects.contagionRisk > 0.5) {
            effects.timeToSpread = Math.max(5 - effects.contagionRisk * 10, 1); // 1-5 minutes
        }

        return effects;
    }

    analyzeDecoupling(data) {
        const { correlationMatrix, symbol, priceChange, btcData, ethData } = data;

        const decoupling = {
            detected: false,
            strength: 'none',
            fromBTC: false,
            fromETH: false,
            fromMarket: false,
            factors: [],
            score: 0
        };

        if (!correlationMatrix) return decoupling;

        // BTC decoupling
        if (correlationMatrix.BTC !== undefined && Math.abs(correlationMatrix.BTC) < this.impactThresholds.correlationBreak) {
            decoupling.fromBTC = true;
            decoupling.detected = true;
            decoupling.score += 0.4;
            decoupling.factors.push('BTC\'den decoupling');
        }

        // ETH decoupling
        if (correlationMatrix.ETH !== undefined && Math.abs(correlationMatrix.ETH) < this.impactThresholds.correlationBreak) {
            decoupling.fromETH = true;
            decoupling.detected = true;
            decoupling.score += 0.3;
            decoupling.factors.push('ETH\'den decoupling');
        }

        // Market decoupling
        const avgCorrelation = this.calculateAverageCorrelation(correlationMatrix, symbol);
        if (avgCorrelation < this.impactThresholds.correlationBreak) {
            decoupling.fromMarket = true;
            decoupling.detected = true;
            decoupling.score += 0.3;
            decoupling.factors.push('Genel market\'ten decoupling');
        }

        // Directional decoupling
        if (btcData && priceChange && btcData.priceChange) {
            if ((priceChange > 0 && btcData.priceChange < 0) || 
                (priceChange < 0 && btcData.priceChange > 0)) {
                decoupling.score += 0.2;
                decoupling.factors.push('BTC ile ters yönlü hareket');
            }
        }

        // Strength classification
        if (decoupling.score > 0.7) {
            decoupling.strength = 'strong';
        } else if (decoupling.score > 0.4) {
            decoupling.strength = 'moderate';
        } else if (decoupling.score > 0.2) {
            decoupling.strength = 'weak';
        }

        return decoupling;
    }

    analyzeFlowImpact(data) {
        const { flowData, btcData, marketData } = data;

        const flowImpact = {
            btcFlowImpact: 0,
            marketFlowImpact: 0,
            flowDirection: 'neutral',
            flowStrength: 'weak',
            factors: []
        };

        if (!flowData) return flowImpact;

        // BTC flow impact
        if (btcData && btcData.flowData) {
            const btcFlowRatio = btcData.flowData.netFlow / (btcData.flowData.totalFlow || 1);
            flowImpact.btcFlowImpact = Math.abs(btcFlowRatio);
            
            if (Math.abs(btcFlowRatio) > 0.3) {
                flowImpact.factors.push('BTC flow etkisi');
            }
        }

        // Market flow impact
        if (marketData && marketData.flowData) {
            const marketFlowRatio = marketData.flowData.netFlow / (marketData.flowData.totalFlow || 1);
            flowImpact.marketFlowImpact = Math.abs(marketFlowRatio);
            
            if (Math.abs(marketFlowRatio) > 0.3) {
                flowImpact.factors.push('Market flow etkisi');
            }
        }

        // Overall flow direction
        const netFlow = flowData.buyFlow - flowData.sellFlow;
        const totalFlow = flowData.buyFlow + flowData.sellFlow;
        const flowRatio = totalFlow > 0 ? netFlow / totalFlow : 0;

        if (flowRatio > 0.2) {
            flowImpact.flowDirection = 'bullish';
        } else if (flowRatio < -0.2) {
            flowImpact.flowDirection = 'bearish';
        }

        // Flow strength
        if (Math.abs(flowRatio) > 0.5) {
            flowImpact.flowStrength = 'strong';
        } else if (Math.abs(flowRatio) > 0.3) {
            flowImpact.flowStrength = 'moderate';
        }

        return flowImpact;
    }

    analyzeMarketRegime(data) {
        const { marketData, btcData, dominanceData, macroData } = data;

        const regime = {
            current: 'normal',
            confidence: 0.5,
            factors: [],
            leaderInfluence: 'moderate',
            expectedBehavior: 'follow_leaders'
        };

        // BTC dominance regime
        if (dominanceData) {
            if (dominanceData.btcDominance > 0.6) {
                regime.current = 'btc_dominance';
                regime.leaderInfluence = 'strong';
                regime.factors.push('BTC dominance rejimi');
                regime.confidence += 0.2;
            } else if (dominanceData.btcDominance < 0.4) {
                regime.current = 'alt_season';
                regime.leaderInfluence = 'weak';
                regime.expectedBehavior = 'independent_movement';
                regime.factors.push('Alt season rejimi');
                regime.confidence += 0.2;
            }
        }

        // Market sentiment regime
        if (marketData && marketData.sentiment) {
            if (marketData.sentiment.fear > 0.7) {
                regime.current = 'fear';
                regime.leaderInfluence = 'very_strong';
                regime.expectedBehavior = 'strong_correlation';
                regime.factors.push('Korku rejimi');
                regime.confidence += 0.2;
            } else if (marketData.sentiment.greed > 0.7) {
                regime.current = 'greed';
                regime.leaderInfluence = 'weak';
                regime.expectedBehavior = 'divergent_movement';
                regime.factors.push('Açgözlülük rejimi');
                regime.confidence += 0.2;
            }
        }

        // Macro regime
        if (macroData) {
            if (macroData.riskOff) {
                regime.current = 'risk_off';
                regime.leaderInfluence = 'very_strong';
                regime.expectedBehavior = 'flight_to_quality';
                regime.factors.push('Risk-off makro ortam');
                regime.confidence += 0.1;
            }
        }

        return regime;
    }

    calculateOverallImpact(analyses) {
        const {
            btcDominanceAnalysis,
            leaderMovementAnalysis,
            correlationAnalysis,
            leadershipAnalysis,
            impactMagnitude,
            contagionAnalysis,
            decouplingAnalysis,
            flowImpactAnalysis,
            regimeAnalysis
        } = analyses;

        let impactScore = 0;
        let impactDirection = 'neutral';
        const factors = [];

        // BTC dominance impact (25% weight)
        if (btcDominanceAnalysis.significance === 'high') {
            impactScore += 0.25;
            factors.push('BTC dominance etkisi');
            
            if (btcDominanceAnalysis.impact.includes('negative')) {
                impactDirection = impactDirection === 'neutral' ? 'bearish' : impactDirection;
            } else if (btcDominanceAnalysis.impact.includes('positive')) {
                impactDirection = impactDirection === 'neutral' ? 'bullish' : impactDirection;
            }
        }

        // Leader movements impact (30% weight)
        impactScore += leaderMovementAnalysis.overallImpact * 0.3;
        if (leaderMovementAnalysis.strongMovements > 0) {
            factors.push(`${leaderMovementAnalysis.strongMovements} güçlü leader hareketi`);
        }

        // Correlation impact (15% weight)
        if (correlationAnalysis.regime === 'high_correlation') {
            impactScore += 0.15;
            factors.push('Yüksek korelasyon rejimi');
        } else if (correlationAnalysis.regime === 'decoupled') {
            impactScore += 0.1;
            factors.push('Decoupling etkisi');
        }

        // Leadership impact (10% weight)
        impactScore += leadershipAnalysis.leadershipScore * 0.1;
        if (leadershipAnalysis.isLeader) {
            factors.push('Market leadership');
        }

        // Magnitude amplification (20% weight)
        impactScore *= (1 + impactMagnitude.magnitude * 0.2);

        // Decoupling adjustment
        if (decouplingAnalysis.detected) {
            impactScore *= (1 - decouplingAnalysis.score * 0.3); // Reduce impact by up to 30%
            factors.push('Decoupling etkisi');
        }

        // Regime adjustment
        if (regimeAnalysis.leaderInfluence === 'very_strong') {
            impactScore *= 1.2;
        } else if (regimeAnalysis.leaderInfluence === 'weak') {
            impactScore *= 0.8;
        }

        // Impact level classification
        let level = 'minimal';
        if (impactScore > 0.8) level = 'very_high';
        else if (impactScore > 0.6) level = 'high';
        else if (impactScore > 0.4) level = 'moderate';
        else if (impactScore > 0.2) level = 'low';

        return {
            score: Math.min(impactScore, 1),
            level: level,
            direction: impactDirection,
            factors: factors,
            components: analyses,
            confidence: this.calculateConfidence(analyses)
        };
    }

    generateRecommendations(overallImpact, data) {
        const recommendations = {};

        // VIVO recommendations
        if (overallImpact.level === 'very_high' || overallImpact.level === 'high') {
            recommendations.vivo = {
                signalWeight: 'high',
                leaderCorrelationWeight: 0.8,
                btcCorrelationAdjustment: true
            };
        } else if (overallImpact.level === 'moderate') {
            recommendations.vivo = {
                signalWeight: 'moderate',
                leaderCorrelationWeight: 0.6,
                btcCorrelationAdjustment: true
            };
        } else {
            recommendations.vivo = {
                signalWeight: 'normal',
                leaderCorrelationWeight: 0.4,
                btcCorrelationAdjustment: false
            };
        }

        // Trading strategy recommendations
        if (overallImpact.direction === 'bullish') {
            recommendations.trading = {
                bias: 'bullish',
                entryStrategy: 'follow_leaders',
                stopLossAdjustment: 'normal'
            };
        } else if (overallImpact.direction === 'bearish') {
            recommendations.trading = {
                bias: 'bearish',
                entryStrategy: 'wait_for_leader_confirmation',
                stopLossAdjustment: 'tighter'
            };
        }

        // Risk management
        recommendations.riskManagement = {
            correlationAdjustment: overallImpact.score > 0.6,
            leaderWatchList: this.leaderCoins,
            hedgingRequired: overallImpact.level === 'very_high'
        };

        return recommendations;
    }

    generateSignals(overallImpact, data) {
        const signals = [];

        if (overallImpact.level === 'very_high') {
            signals.push({
                type: 'leader_impact_alert',
                strength: 'strong',
                message: 'Çok yüksek leader coin etkisi tespit edildi'
            });
        }

        if (overallImpact.direction !== 'neutral') {
            signals.push({
                type: 'directional_impact',
                direction: overallImpact.direction,
                strength: overallImpact.level,
                message: `Leader coin'ler ${overallImpact.direction} yönlü etki gösteriyor`
            });
        }

        return signals;
    }

    generateNotes(overallImpact, data) {
        const notes = [];

        notes.push(`Leader coin etkisi: ${overallImpact.level} (${(overallImpact.score * 100).toFixed(0)}%)`);
        
        if (overallImpact.direction !== 'neutral') {
            notes.push(`Yön: ${overallImpact.direction}`);
        }

        if (overallImpact.factors.length > 0) {
            notes.push(`Faktörler: ${overallImpact.factors.slice(0, 3).join(', ')}`);
        }

        return notes.join('. ');
    }

    // Helper methods
    analyzeSynchronization(movements) {
        if (movements.length < 2) return { score: 0, type: 'insufficient_data' };

        const directions = movements.map(m => m.direction);
        const bullishCount = directions.filter(d => d === 'bullish').length;
        const bearishCount = directions.filter(d => d === 'bearish').length;
        const totalCount = directions.length;

        const synchronizationScore = Math.max(bullishCount, bearishCount) / totalCount;

        let type = 'mixed';
        if (synchronizationScore > 0.8) {
            type = bullishCount > bearishCount ? 'strong_bullish_sync' : 'strong_bearish_sync';
        } else if (synchronizationScore > 0.6) {
            type = bullishCount > bearishCount ? 'moderate_bullish_sync' : 'moderate_bearish_sync';
        }

        return {
            score: synchronizationScore,
            type: type,
            bullishCount: bullishCount,
            bearishCount: bearishCount
        };
    }

    getOverallDirection(movements) {
        const directions = movements.map(m => m.direction);
        const bullish = directions.filter(d => d === 'bullish').length;
        const bearish = directions.filter(d => d === 'bearish').length;

        if (bullish > bearish * 1.5) return 'bullish';
        if (bearish > bullish * 1.5) return 'bearish';
        return 'mixed';
    }

    getOverallMagnitude(movements) {
        const totalMagnitude = movements.reduce((sum, m) => sum + m.impactScore, 0);
        return totalMagnitude / movements.length;
    }

    calculateAverageCorrelation(correlationMatrix, excludeSymbol) {
        const correlations = Object.keys(correlationMatrix)
            .filter(key => key !== excludeSymbol)
            .map(key => Math.abs(correlationMatrix[key]));
        
        return correlations.length > 0 ? 
            correlations.reduce((sum, corr) => sum + corr, 0) / correlations.length : 0.5;
    }

    calculateConfidence(analyses) {
        let confidence = 0.5;
        
        if (analyses.correlationAnalysis.strongCorrelation) confidence += 0.2;
        if (analyses.leaderMovementAnalysis.strongMovements > 1) confidence += 0.2;
        if (analyses.btcDominanceAnalysis.significance === 'high') confidence += 0.1;
        
        return Math.min(confidence, 1);
    }

    updateAnalysisHistory(result, data) {
        this.dominanceHistory.push({
            timestamp: Date.now(),
            dominance: result.btcDominance.current,
            change: result.btcDominance.change,
            impactLevel: result.overallImpact.level
        });

        this.correlationHistory.push({
            timestamp: Date.now(),
            averageCorrelation: result.correlations.averageCorrelation,
            regime: result.correlations.regime,
            symbol: data.symbol
        });

        // Limit history size
        if (this.dominanceHistory.length > this.maxHistorySize) {
            this.dominanceHistory = this.dominanceHistory.slice(-this.maxHistorySize);
        }
        
        if (this.correlationHistory.length > this.maxHistorySize) {
            this.correlationHistory = this.correlationHistory.slice(-this.maxHistorySize);
        }
    }

    getDefaultResult() {
        return {
            overallImpact: {
                score: 0,
                level: 'minimal',
                direction: 'neutral',
                factors: [],
                components: {},
                confidence: 0.5
            },
            btcDominance: {
                current: 0.5,
                change: 0,
                trend: 'neutral',
                significance: 'low',
                factors: [],
                impact: 'minimal'
            },
            leaderMovements: {
                movements: [],
                overallImpact: 0,
                synchronization: { score: 0, type: 'insufficient_data' },
                leaderCount: 0,
                strongMovements: 0,
                direction: 'neutral',
                magnitude: 0
            },
            correlations: {
                correlations: {},
                averageCorrelation: 0.5,
                regime: 'normal',
                breakdowns: [],
                decouplingDetected: false,
                strongCorrelation: false
            },
            leadership: {
                isLeader: false,
                leadershipScore: 0,
                leadershipType: 'follower',
                factors: []
            },
            impactMagnitude: {
                magnitude: 0,
                factors: [],
                level: 'low'
            },
            contagionEffects: {
                contagionRisk: 0,
                spreadProbability: 0,
                affectedSectors: [],
                timeToSpread: 0,
                factors: []
            },
            decoupling: {
                detected: false,
                strength: 'none',
                fromBTC: false,
                fromETH: false,
                fromMarket: false,
                factors: [],
                score: 0
            },
            flowImpact: {
                btcFlowImpact: 0,
                marketFlowImpact: 0,
                flowDirection: 'neutral',
                flowStrength: 'weak',
                factors: []
            },
            marketRegime: {
                current: 'normal',
                confidence: 0.5,
                factors: [],
                leaderInfluence: 'moderate',
                expectedBehavior: 'follow_leaders'
            },
            recommendations: {},
            signals: [],
            notes: "Leader coin impact analizi yapılamadı - yetersiz veri",
            metadata: {
                error: true,
                analysisTimestamp: Date.now()
            }
        };
    }

    getModuleInfo() {
        return {
            name: 'LeaderCoinImpact',
            version: '1.0.0',
            description: 'Bitcoin ve market leader coin\'lerin impact analysis - BTC dominance, leader coin movements ve market sürüklenme analizi',
            inputs: [
                'symbol', 'price', 'volume', 'marketData', 'btcData', 'ethData',
                'leaderCoinData', 'dominanceData', 'correlationMatrix', 'marketCap',
                'timeframe', 'historicalData', 'flowData', 'sentimentData', 'newsFlow', 'macroData'
            ],
            outputs: [
                'overallImpact', 'btcDominance', 'leaderMovements', 'correlations',
                'leadership', 'impactMagnitude', 'contagionEffects', 'decoupling',
                'flowImpact', 'marketRegime', 'recommendations', 'signals', 'notes', 'metadata'
            ]
        };
    }
}

module.exports = LeaderCoinImpact;
