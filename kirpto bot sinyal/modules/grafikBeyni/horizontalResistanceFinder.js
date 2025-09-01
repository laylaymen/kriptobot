const GrafikBeyniModuleBase = require('./grafikBeyniModuleBase');

/**
 * Horizontal Resistance Finder Module
 * Yatay direnç bulucu - Horizontal resistance level detection and validation
 * Systematic identification and strength assessment of horizontal resistance levels
 */
class HorizontalResistanceFinder extends GrafikBeyniModuleBase {
    constructor() {
        super('horizontalResistanceFinder');
        this.resistanceHistory = [];
        this.detectedLevels = [];
        this.analysisParams = {
            minTouchPoints: 3,          // Minimum touch points for valid resistance
            maxLookbackPeriods: 100,    // Maximum periods to look back
            priceTolerancePercent: 0.3, // Price tolerance for grouping (0.3%)
            strengthThreshold: 0.6,     // Minimum strength for significant resistance
            timeDecayFactor: 0.95,      // Time decay for older levels
            volumeWeight: 0.3,          // Weight for volume confirmation
            rejectionWeight: 0.4,       // Weight for rejection strength
            persistenceWeight: 0.3      // Weight for time persistence
        };
        this.resistanceTypes = {
            PSYCHOLOGICAL: 'psychological',    // Round numbers, major levels
            TECHNICAL: 'technical',           // Previous highs, pattern levels
            DYNAMIC: 'dynamic',               // Moving averages, trend lines
            INSTITUTIONAL: 'institutional'     // Large order levels
        };
        this.maxHistorySize = 200;
        this.learningRate = 0.1;
        this.confidenceThreshold = 0.7;
    }

    async analyze(data) {
        try {
            const {
                symbol,
                priceData,
                volumeData,
                highs,
                lows,
                timeframe,
                ohlcData,
                movingAverages,
                orderFlowData,
                liquidityLevels,
                marketMicrostructure,
                institutionalFlow,
                supportResistanceLevels,
                psychologicalLevels,
                volatilityData,
                sessionData,
                newsImpact,
                marketConditions
            } = data;

            // Veri doğrulama
            if (!priceData || !highs || priceData.length < 20) {
                throw new Error('Insufficient data for horizontal resistance detection');
            }

            // Candidate resistance level detection
            const candidateResistanceDetection = this.detectCandidateResistanceLevels(priceData, highs, 
                                                                                     ohlcData, timeframe);

            // Touch point analysis for each candidate
            const touchPointAnalysis = this.analyzeTouchPoints(candidateResistanceDetection.candidates,
                                                              priceData, volumeData, ohlcData);

            // Resistance strength calculation
            const resistanceStrengthCalculation = this.calculateResistanceStrength(touchPointAnalysis,
                                                                                  volumeData,
                                                                                  orderFlowData);

            // Rejection analysis
            const rejectionAnalysis = this.analyzeRejections(touchPointAnalysis, ohlcData, volumeData);

            // Time persistence validation
            const timePersistenceValidation = this.validateTimePersistence(touchPointAnalysis, timeframe);

            // Volume confirmation analysis
            const volumeConfirmationAnalysis = this.analyzeVolumeConfirmation(touchPointAnalysis,
                                                                             volumeData,
                                                                             rejectionAnalysis);

            // Psychological level assessment
            const psychologicalLevelAssessment = this.assessPsychologicalLevels(touchPointAnalysis,
                                                                               psychologicalLevels);

            // Dynamic resistance analysis
            const dynamicResistanceAnalysis = this.analyzeDynamicResistance(touchPointAnalysis,
                                                                           movingAverages,
                                                                           priceData);

            // Institutional level detection
            const institutionalLevelDetection = this.detectInstitutionalLevels(touchPointAnalysis,
                                                                              orderFlowData,
                                                                              liquidityLevels);

            // Resistance classification
            const resistanceClassification = this.classifyResistanceLevels(touchPointAnalysis,
                                                                          psychologicalLevelAssessment,
                                                                          dynamicResistanceAnalysis,
                                                                          institutionalLevelDetection);

            // Level validation and filtering
            const levelValidationAndFiltering = this.validateAndFilterLevels(resistanceClassification,
                                                                            resistanceStrengthCalculation,
                                                                            timePersistenceValidation);

            // Breakout probability assessment
            const breakoutProbabilityAssessment = this.assessBreakoutProbability(levelValidationAndFiltering,
                                                                                marketConditions,
                                                                                volatilityData);

            // Current level status analysis
            const currentLevelStatusAnalysis = this.analyzeCurrentLevelStatus(levelValidationAndFiltering,
                                                                             priceData,
                                                                             volumeData);

            const result = {
                candidateResistanceDetection: candidateResistanceDetection,
                touchPointAnalysis: touchPointAnalysis,
                resistanceStrengthCalculation: resistanceStrengthCalculation,
                rejectionAnalysis: rejectionAnalysis,
                timePersistenceValidation: timePersistenceValidation,
                volumeConfirmationAnalysis: volumeConfirmationAnalysis,
                psychologicalLevelAssessment: psychologicalLevelAssessment,
                dynamicResistanceAnalysis: dynamicResistanceAnalysis,
                institutionalLevelDetection: institutionalLevelDetection,
                resistanceClassification: resistanceClassification,
                levelValidationAndFiltering: levelValidationAndFiltering,
                breakoutProbabilityAssessment: breakoutProbabilityAssessment,
                currentLevelStatusAnalysis: currentLevelStatusAnalysis,
                validResistanceLevels: this.extractValidLevels(levelValidationAndFiltering),
                nearestResistance: this.findNearestResistance(levelValidationAndFiltering, priceData),
                strongestResistance: this.findStrongestResistance(levelValidationAndFiltering),
                recommendations: this.generateRecommendations(levelValidationAndFiltering, 
                                                           currentLevelStatusAnalysis,
                                                           breakoutProbabilityAssessment),
                alerts: this.generateAlerts(levelValidationAndFiltering, currentLevelStatusAnalysis),
                notes: this.generateNotes(levelValidationAndFiltering, resistanceClassification),
                metadata: {
                    analysisTimestamp: Date.now(),
                    symbol: symbol,
                    timeframe: timeframe,
                    resistanceLevelsFound: levelValidationAndFiltering.validLevels.length,
                    strongestLevel: this.findStrongestResistance(levelValidationAndFiltering)?.price || 0,
                    nearestLevel: this.findNearestResistance(levelValidationAndFiltering, priceData)?.price || 0,
                    overallStrength: this.calculateOverallStrength(levelValidationAndFiltering)
                }
            };

            // History güncelleme
            this.updateResistanceHistory(result, data);

            // Cache ve performance tracking
            this.updateCache(data, result);
            this.trackPerformance(Date.now(), result.validResistanceLevels.length > 0);

            return result;

        } catch (error) {
            this.handleError('HorizontalResistanceFinder analysis failed', error, data);
            return this.getDefaultResult();
        }
    }

    detectCandidateResistanceLevels(priceData, highs, ohlcData, timeframe) {
        const candidates = [];
        const lookbackPeriod = Math.min(this.analysisParams.maxLookbackPeriods, priceData.length);
        const recentData = priceData.slice(-lookbackPeriod);
        const recentHighs = highs.slice(-lookbackPeriod);

        // Method 1: Local highs detection
        const localHighsCandidates = this.detectLocalHighsResistance(recentHighs, recentData);
        candidates.push(...localHighsCandidates);

        // Method 2: Price clustering analysis
        const clusteringCandidates = this.detectPriceClusteringResistance(recentHighs);
        candidates.push(...clusteringCandidates);

        // Method 3: Rejection point analysis
        const rejectionCandidates = this.detectRejectionPointResistance(ohlcData, recentData);
        candidates.push(...rejectionCandidates);

        // Method 4: Round number analysis
        const roundNumberCandidates = this.detectRoundNumberResistance(recentData);
        candidates.push(...roundNumberCandidates);

        // Merge and deduplicate candidates
        const mergedCandidates = this.mergeSimilarCandidates(candidates);

        return {
            candidates: mergedCandidates,
            detectionMethods: {
                localHighs: localHighsCandidates.length,
                clustering: clusteringCandidates.length,
                rejections: rejectionCandidates.length,
                roundNumbers: roundNumberCandidates.length
            },
            totalCandidates: mergedCandidates.length,
            lookbackPeriod: lookbackPeriod
        };
    }

    detectLocalHighsResistance(highs, priceData) {
        const candidates = [];
        const significantHighs = this.findSignificantHighs(highs);

        significantHighs.forEach(high => {
            candidates.push({
                price: high.price,
                firstTouch: high.index,
                detectionMethod: 'local_highs',
                significance: this.calculateHighSignificance(high, highs),
                strength: 0.5 // Will be calculated later
            });
        });

        return candidates;
    }

    detectPriceClusteringResistance(highs) {
        const candidates = [];
        const tolerance = this.analysisParams.priceTolerancePercent / 100;
        
        // Group similar price levels
        const priceClusters = this.clusterSimilarPrices(highs, tolerance);
        
        priceClusters.forEach(cluster => {
            if (cluster.points.length >= 2) {
                candidates.push({
                    price: cluster.centerPrice,
                    firstTouch: Math.min(...cluster.points.map(p => p.index)),
                    detectionMethod: 'price_clustering',
                    clusterSize: cluster.points.length,
                    strength: Math.min(1.0, cluster.points.length * 0.2)
                });
            }
        });

        return candidates;
    }

    detectRejectionPointResistance(ohlcData, priceData) {
        const candidates = [];
        
        if (!ohlcData || ohlcData.length < 10) return candidates;

        const recentOhlc = ohlcData.slice(-this.analysisParams.maxLookbackPeriods);
        
        recentOhlc.forEach((candle, index) => {
            // Look for candles with long upper wicks (rejection)
            const wickSize = candle.high - Math.max(candle.open, candle.close);
            const bodySize = Math.abs(candle.close - candle.open);
            const wickToBodyRatio = bodySize > 0 ? wickSize / bodySize : 5;

            if (wickToBodyRatio >= 1.5 && wickSize > (candle.high * 0.005)) { // Minimum 0.5% wick
                candidates.push({
                    price: candle.high,
                    firstTouch: index,
                    detectionMethod: 'rejection_point',
                    rejectionStrength: wickToBodyRatio,
                    strength: Math.min(1.0, wickToBodyRatio * 0.2)
                });
            }
        });

        return candidates;
    }

    detectRoundNumberResistance(priceData) {
        const candidates = [];
        const currentPrice = priceData[priceData.length - 1];
        
        // Generate round number levels around current price
        const roundLevels = this.generateRoundNumberLevels(currentPrice);
        
        roundLevels.forEach(level => {
            // Check if price has approached this level recently
            const hasApproached = this.checkPriceApproach(level, priceData);
            
            if (hasApproached) {
                candidates.push({
                    price: level,
                    firstTouch: hasApproached.firstIndex,
                    detectionMethod: 'round_number',
                    psychologicalStrength: this.calculatePsychologicalStrength(level),
                    strength: 0.6 // Psychological levels have inherent strength
                });
            }
        });

        return candidates;
    }

    analyzeTouchPoints(candidates, priceData, volumeData, ohlcData) {
        const analysis = {};
        const tolerance = this.analysisParams.priceTolerancePercent / 100;

        candidates.forEach((candidate, index) => {
            const touchPoints = this.findTouchPointsForLevel(candidate.price, priceData, 
                                                           ohlcData, tolerance);
            const volumeAtTouches = this.getVolumeAtTouchPoints(touchPoints, volumeData);
            
            analysis[index] = {
                level: candidate,
                touchPoints: touchPoints,
                touchCount: touchPoints.length,
                volumeAtTouches: volumeAtTouches,
                averageVolume: this.calculateAverage(volumeAtTouches),
                touchQuality: this.assessTouchQuality(touchPoints, candidate.price),
                timeSpan: this.calculateTouchTimeSpan(touchPoints),
                lastTouch: touchPoints.length > 0 ? Math.max(...touchPoints.map(t => t.index)) : -1
            };
        });

        return analysis;
    }

    calculateResistanceStrength(touchPointAnalysis, volumeData, orderFlowData) {
        const strengthAnalysis = {};

        Object.keys(touchPointAnalysis).forEach(key => {
            const analysis = touchPointAnalysis[key];
            let strength = 0;

            // Touch count factor (40%)
            const touchFactor = Math.min(1.0, analysis.touchCount / 5) * 0.4;
            strength += touchFactor;

            // Volume confirmation factor (30%)
            if (volumeData && analysis.averageVolume > 0) {
                const avgMarketVolume = this.calculateAverage(volumeData.slice(-50));
                const volumeFactor = Math.min(1.0, analysis.averageVolume / avgMarketVolume) * 0.3;
                strength += volumeFactor;
            }

            // Touch quality factor (20%)
            const qualityFactor = analysis.touchQuality * 0.2;
            strength += qualityFactor;

            // Time persistence factor (10%)
            const timeFactor = Math.min(1.0, analysis.timeSpan / 50) * 0.1;
            strength += timeFactor;

            strengthAnalysis[key] = {
                overallStrength: strength,
                touchFactor: touchFactor,
                volumeFactor: volumeData ? analysis.averageVolume : 0,
                qualityFactor: qualityFactor,
                timeFactor: timeFactor,
                strengthCategory: this.categorizeStrength(strength)
            };
        });

        return strengthAnalysis;
    }

    analyzeRejections(touchPointAnalysis, ohlcData, volumeData) {
        const rejectionAnalysis = {};

        Object.keys(touchPointAnalysis).forEach(key => {
            const analysis = touchPointAnalysis[key];
            const rejections = [];

            analysis.touchPoints.forEach(touch => {
                if (ohlcData && ohlcData[touch.index]) {
                    const candle = ohlcData[touch.index];
                    const rejectionStrength = this.calculateRejectionStrength(candle, analysis.level.price);
                    
                    if (rejectionStrength > 0.3) { // Significant rejection
                        rejections.push({
                            index: touch.index,
                            strength: rejectionStrength,
                            volume: volumeData ? volumeData[touch.index] : 0,
                            wickSize: candle.high - Math.max(candle.open, candle.close),
                            bodySize: Math.abs(candle.close - candle.open)
                        });
                    }
                }
            });

            rejectionAnalysis[key] = {
                rejections: rejections,
                rejectionCount: rejections.length,
                averageRejectionStrength: rejections.length > 0 ? 
                    this.calculateAverage(rejections.map(r => r.strength)) : 0,
                strongestRejection: rejections.length > 0 ? 
                    Math.max(...rejections.map(r => r.strength)) : 0,
                rejectionScore: this.calculateRejectionScore(rejections)
            };
        });

        return rejectionAnalysis;
    }

    validateTimePersistence(touchPointAnalysis, timeframe) {
        const persistenceValidation = {};

        Object.keys(touchPointAnalysis).forEach(key => {
            const analysis = touchPointAnalysis[key];
            
            if (analysis.touchPoints.length < 2) {
                persistenceValidation[key] = {
                    isValid: false,
                    persistenceScore: 0,
                    ageInPeriods: 0
                };
                return;
            }

            const firstTouch = Math.min(...analysis.touchPoints.map(t => t.index));
            const lastTouch = Math.max(...analysis.touchPoints.map(t => t.index));
            const ageInPeriods = lastTouch - firstTouch;
            
            // Apply time decay
            const decayFactor = Math.pow(this.analysisParams.timeDecayFactor, 
                                       analysis.touchPoints.length - lastTouch);
            
            const persistenceScore = Math.min(1.0, (ageInPeriods / 20) * decayFactor);
            
            persistenceValidation[key] = {
                isValid: ageInPeriods >= 5 && persistenceScore > 0.3,
                persistenceScore: persistenceScore,
                ageInPeriods: ageInPeriods,
                decayFactor: decayFactor,
                firstTouch: firstTouch,
                lastTouch: lastTouch
            };
        });

        return persistenceValidation;
    }

    analyzeVolumeConfirmation(touchPointAnalysis, volumeData, rejectionAnalysis) {
        const volumeConfirmation = {};

        if (!volumeData) {
            return this.getDefaultVolumeConfirmation(touchPointAnalysis);
        }

        Object.keys(touchPointAnalysis).forEach(key => {
            const analysis = touchPointAnalysis[key];
            const rejections = rejectionAnalysis[key];

            // Calculate volume spike at resistance touches
            const volumeSpikes = this.calculateVolumeSpikes(analysis.touchPoints, volumeData);
            
            // Volume trend during rejections
            const rejectionVolumeTrend = this.calculateRejectionVolumeTrend(rejections.rejections, volumeData);
            
            volumeConfirmation[key] = {
                volumeSpikes: volumeSpikes,
                spikeCount: volumeSpikes.filter(spike => spike.ratio > 1.5).length,
                averageSpikeRatio: this.calculateAverage(volumeSpikes.map(s => s.ratio)),
                rejectionVolumeTrend: rejectionVolumeTrend,
                volumeConfirmationScore: this.calculateVolumeConfirmationScore(volumeSpikes, rejectionVolumeTrend),
                hasVolumeConfirmation: volumeSpikes.filter(spike => spike.ratio > 1.5).length >= 2
            };
        });

        return volumeConfirmation;
    }

    classifyResistanceLevels(touchPointAnalysis, psychologicalAssessment, dynamicAnalysis, institutionalDetection) {
        const classification = {};

        Object.keys(touchPointAnalysis).forEach(key => {
            const level = touchPointAnalysis[key].level;
            const types = [];

            // Technical classification
            if (level.detectionMethod === 'local_highs' || level.detectionMethod === 'rejection_point') {
                types.push(this.resistanceTypes.TECHNICAL);
            }

            // Psychological classification
            if (level.detectionMethod === 'round_number' || 
                (psychologicalAssessment[key] && psychologicalAssessment[key].isPsychological)) {
                types.push(this.resistanceTypes.PSYCHOLOGICAL);
            }

            // Dynamic classification
            if (dynamicAnalysis[key] && dynamicAnalysis[key].isDynamic) {
                types.push(this.resistanceTypes.DYNAMIC);
            }

            // Institutional classification
            if (institutionalDetection[key] && institutionalDetection[key].isInstitutional) {
                types.push(this.resistanceTypes.INSTITUTIONAL);
            }

            classification[key] = {
                level: level,
                types: types,
                primaryType: types[0] || this.resistanceTypes.TECHNICAL,
                typeStrengths: this.calculateTypeStrengths(types, touchPointAnalysis[key]),
                overallClassification: this.determineOverallClassification(types, touchPointAnalysis[key])
            };
        });

        return classification;
    }

    validateAndFilterLevels(classification, strengthCalculation, persistenceValidation) {
        const validLevels = [];
        const filteredLevels = [];

        Object.keys(classification).forEach(key => {
            const level = classification[key];
            const strength = strengthCalculation[key];
            const persistence = persistenceValidation[key];

            // Validation criteria
            const isStrengthValid = strength.overallStrength >= this.analysisParams.strengthThreshold;
            const isPersistenceValid = persistence.isValid;
            const hasMinimumTouches = level.level.touchCount >= this.analysisParams.minTouchPoints;

            const isValid = isStrengthValid && isPersistenceValid && hasMinimumTouches;

            const levelData = {
                ...level,
                strength: strength,
                persistence: persistence,
                isValid: isValid,
                validationScore: this.calculateValidationScore(strength, persistence, level.level.touchCount)
            };

            if (isValid) {
                validLevels.push(levelData);
            } else {
                filteredLevels.push({
                    ...levelData,
                    rejectionReasons: this.identifyRejectionReasons(isStrengthValid, isPersistenceValid, hasMinimumTouches)
                });
            }
        });

        return {
            validLevels: validLevels.sort((a, b) => b.strength.overallStrength - a.strength.overallStrength),
            filteredLevels: filteredLevels,
            validationSummary: {
                totalLevels: validLevels.length + filteredLevels.length,
                validLevels: validLevels.length,
                strongLevels: validLevels.filter(l => l.strength.overallStrength > 0.8).length,
                moderateLevels: validLevels.filter(l => l.strength.overallStrength > 0.6 && l.strength.overallStrength <= 0.8).length
            }
        };
    }

    findNearestResistance(validationResults, priceData) {
        if (!validationResults.validLevels || validationResults.validLevels.length === 0) {
            return null;
        }

        const currentPrice = priceData[priceData.length - 1];
        let nearest = null;
        let minDistance = Infinity;

        validationResults.validLevels.forEach(level => {
            if (level.level.price > currentPrice) { // Only levels above current price
                const distance = level.level.price - currentPrice;
                if (distance < minDistance) {
                    minDistance = distance;
                    nearest = level;
                }
            }
        });

        return nearest ? {
            ...nearest,
            distanceFromPrice: minDistance,
            distancePercentage: (minDistance / currentPrice) * 100
        } : null;
    }

    findStrongestResistance(validationResults) {
        if (!validationResults.validLevels || validationResults.validLevels.length === 0) {
            return null;
        }

        return validationResults.validLevels.reduce((strongest, current) => {
            return current.strength.overallStrength > strongest.strength.overallStrength ? current : strongest;
        });
    }

    generateRecommendations(validationResults, currentLevelStatus, breakoutProbability) {
        const recommendations = {};

        if (validationResults.validLevels.length > 0) {
            const nearest = this.findNearestResistance(validationResults, [currentLevelStatus.currentPrice]);
            const strongest = this.findStrongestResistance(validationResults);

            if (nearest && nearest.distancePercentage < 2) { // Within 2%
                recommendations.immediate = {
                    action: 'monitor_resistance_approach',
                    level: nearest.level.price,
                    distance: nearest.distancePercentage,
                    strength: nearest.strength.overallStrength,
                    suggestion: 'Yaklaşan dirençte dikkatli ol'
                };
            }

            if (strongest && strongest.strength.overallStrength > 0.8) {
                recommendations.strategic = {
                    action: 'respect_strong_resistance',
                    level: strongest.level.price,
                    strength: strongest.strength.overallStrength,
                    suggestion: 'Güçlü direnç seviyesi - çok dikkatli yaklaş'
                };
            }
        }

        return recommendations;
    }

    generateAlerts(validationResults, currentLevelStatus) {
        const alerts = [];

        if (validationResults.validLevels.length > 0) {
            const validCount = validationResults.validLevels.length;
            const strongCount = validationResults.validLevels.filter(l => l.strength.overallStrength > 0.8).length;

            alerts.push({
                level: 'info',
                message: `${validCount} geçerli yatay direnç seviyesi tespit edildi`,
                details: `${strongCount} güçlü seviye`
            });

            if (strongCount > 2) {
                alerts.push({
                    level: 'warning',
                    message: 'Çoklu güçlü direnç seviyesi mevcut',
                    action: 'Dikkatli pozisyon al'
                });
            }
        }

        return alerts;
    }

    generateNotes(validationResults, classification) {
        const notes = [];

        if (validationResults.validLevels.length > 0) {
            notes.push(`${validationResults.validLevels.length} geçerli yatay direnç seviyesi`);
            
            const typeCount = this.countLevelTypes(classification);
            Object.keys(typeCount).forEach(type => {
                if (typeCount[type] > 0) {
                    notes.push(`${typeCount[type]} ${type} seviye`);
                }
            });
        } else {
            notes.push('Geçerli yatay direnç seviyesi bulunamadı');
        }

        return notes.join('. ');
    }

    // Helper methods
    mergeSimilarCandidates(candidates) {
        const tolerance = this.analysisParams.priceTolerancePercent / 100;
        const merged = [];
        const used = new Set();

        candidates.forEach((candidate, i) => {
            if (used.has(i)) return;

            const similar = [candidate];
            used.add(i);

            candidates.forEach((other, j) => {
                if (i !== j && !used.has(j)) {
                    const priceDiff = Math.abs(candidate.price - other.price) / candidate.price;
                    if (priceDiff <= tolerance) {
                        similar.push(other);
                        used.add(j);
                    }
                }
            });

            // Merge similar candidates
            const mergedCandidate = {
                price: this.calculateAverage(similar.map(s => s.price)),
                firstTouch: Math.min(...similar.map(s => s.firstTouch)),
                detectionMethod: 'merged',
                originalMethods: similar.map(s => s.detectionMethod),
                strength: Math.max(...similar.map(s => s.strength || 0))
            };

            merged.push(mergedCandidate);
        });

        return merged;
    }

    findTouchPointsForLevel(targetPrice, priceData, ohlcData, tolerance) {
        const touchPoints = [];

        priceData.forEach((price, index) => {
            const priceDiff = Math.abs(price - targetPrice) / targetPrice;
            
            if (priceDiff <= tolerance) {
                touchPoints.push({
                    index: index,
                    price: price,
                    distance: priceDiff,
                    type: 'close'
                });
            }

            // Also check OHLC data if available
            if (ohlcData && ohlcData[index]) {
                const candle = ohlcData[index];
                ['high', 'low', 'open'].forEach(priceType => {
                    const ohlcPrice = candle[priceType];
                    const ohlcDiff = Math.abs(ohlcPrice - targetPrice) / targetPrice;
                    
                    if (ohlcDiff <= tolerance) {
                        touchPoints.push({
                            index: index,
                            price: ohlcPrice,
                            distance: ohlcDiff,
                            type: priceType
                        });
                    }
                });
            }
        });

        // Remove duplicates and sort by index
        const uniqueTouchPoints = touchPoints.filter((touch, index, array) => 
            array.findIndex(t => t.index === touch.index) === index
        ).sort((a, b) => a.index - b.index);

        return uniqueTouchPoints;
    }

    updateResistanceHistory(result, data) {
        this.resistanceHistory.push({
            timestamp: Date.now(),
            resistanceLevelsFound: result.metadata.resistanceLevelsFound,
            strongestLevel: result.metadata.strongestLevel,
            nearestLevel: result.metadata.nearestLevel,
            overallStrength: result.metadata.overallStrength
        });

        if (this.resistanceHistory.length > this.maxHistorySize) {
            this.resistanceHistory = this.resistanceHistory.slice(-this.maxHistorySize);
        }
    }

    getDefaultResult() {
        return {
            candidateResistanceDetection: {
                candidates: [],
                detectionMethods: { localHighs: 0, clustering: 0, rejections: 0, roundNumbers: 0 },
                totalCandidates: 0,
                lookbackPeriod: 0
            },
            touchPointAnalysis: {},
            resistanceStrengthCalculation: {},
            rejectionAnalysis: {},
            timePersistenceValidation: {},
            volumeConfirmationAnalysis: {},
            psychologicalLevelAssessment: {},
            dynamicResistanceAnalysis: {},
            institutionalLevelDetection: {},
            resistanceClassification: {},
            levelValidationAndFiltering: {
                validLevels: [],
                filteredLevels: [],
                validationSummary: { totalLevels: 0, validLevels: 0, strongLevels: 0, moderateLevels: 0 }
            },
            breakoutProbabilityAssessment: {},
            currentLevelStatusAnalysis: {},
            validResistanceLevels: [],
            nearestResistance: null,
            strongestResistance: null,
            recommendations: {},
            alerts: [],
            notes: "Yatay direnç analizi yapılamadı - yetersiz veri",
            metadata: {
                error: true,
                analysisTimestamp: Date.now(),
                resistanceLevelsFound: 0,
                strongestLevel: 0,
                nearestLevel: 0,
                overallStrength: 0
            }
        };
    }

    getModuleInfo() {
        return {
            name: 'HorizontalResistanceFinder',
            version: '1.0.0',
            description: 'Yatay direnç bulucu - Horizontal resistance level detection and validation - Systematic identification and strength assessment of horizontal resistance levels',
            inputs: [
                'symbol', 'priceData', 'volumeData', 'highs', 'lows', 'timeframe', 'ohlcData',
                'movingAverages', 'orderFlowData', 'liquidityLevels', 'marketMicrostructure',
                'institutionalFlow', 'supportResistanceLevels', 'psychologicalLevels',
                'volatilityData', 'sessionData', 'newsImpact', 'marketConditions'
            ],
            outputs: [
                'candidateResistanceDetection', 'touchPointAnalysis', 'resistanceStrengthCalculation',
                'rejectionAnalysis', 'timePersistenceValidation', 'volumeConfirmationAnalysis',
                'psychologicalLevelAssessment', 'dynamicResistanceAnalysis', 'institutionalLevelDetection',
                'resistanceClassification', 'levelValidationAndFiltering', 'breakoutProbabilityAssessment',
                'currentLevelStatusAnalysis', 'validResistanceLevels', 'nearestResistance',
                'strongestResistance', 'recommendations', 'alerts', 'notes', 'metadata'
            ]
        };
    }
}

module.exports = HorizontalResistanceFinder;
