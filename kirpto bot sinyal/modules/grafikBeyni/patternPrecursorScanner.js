const GrafikBeyniModuleBase = require('../grafikBeyniModuleBase');

/**
 * Pattern Precursor Scanner Module
 * Early pattern formation detection ve precursor signal identification
 * Pattern oluşumunun öncül sinyallerini tespit etme
 */
class PatternPrecursorScanner extends GrafikBeyniModuleBase {
    constructor() {
        super('patternPrecursorScanner');
        this.precursorHistory = [];
        this.patternLibrary = this.initializePatternLibrary();
        this.precursorThresholds = {
            confidence: 0.6,
            formation: 0.4,
            volume: 1.2,
            timeframe: 3 // minimum bars for pattern development
        };
        this.maxHistorySize = 200;
        this.scanningDepth = 20; // bars to look back for precursors
    }

    async analyze(data) {
        try {
            const {
                candlesticks,
                volume,
                price,
                highs,
                lows,
                opens,
                closes,
                timeframe,
                indicators,
                support,
                resistance,
                trendDirection,
                volatility,
                momentum,
                orderBookDepth,
                liquidityLevels
            } = data;

            // Veri doğrulama
            if (!candlesticks || candlesticks.length < this.scanningDepth) {
                throw new Error('Insufficient candlestick data for pattern precursor scanning');
            }

            // Pattern precursor detection
            const precursors = this.detectPatternPrecursors(data);

            // Formation probability assessment
            const formationProbabilities = this.calculateFormationProbabilities(precursors, data);

            // Time-to-completion estimation
            const completionEstimates = this.estimateCompletionTimes(precursors, data);

            // Support/Resistance interaction analysis
            const srInteractions = this.analyzeSRInteractions(precursors, data);

            // Volume precursor analysis
            const volumePrecursors = this.analyzeVolumePrecursors(data);

            // Price action precursors
            const priceActionPrecursors = this.analyzePriceActionPrecursors(data);

            // Market structure precursors
            const structurePrecursors = this.analyzeStructurePrecursors(data);

            // Multi-timeframe precursor validation
            const multiTimeframeValidation = this.validateMultiTimeframePrecursors(precursors, data);

            // Early warning system
            const earlyWarnings = this.generateEarlyWarnings(precursors, formationProbabilities);

            // Pattern evolution tracking
            const evolutionTracking = this.trackPatternEvolution(precursors);

            const result = {
                precursors: precursors,
                formationProbabilities: formationProbabilities,
                completionEstimates: completionEstimates,
                srInteractions: srInteractions,
                volumePrecursors: volumePrecursors,
                priceActionPrecursors: priceActionPrecursors,
                structurePrecursors: structurePrecursors,
                multiTimeframeValidation: multiTimeframeValidation,
                earlyWarnings: earlyWarnings,
                evolutionTracking: evolutionTracking,
                recommendations: this.generateRecommendations(precursors, formationProbabilities, data),
                notes: this.generateNotes(precursors, earlyWarnings),
                metadata: {
                    analysisTimestamp: Date.now(),
                    timeframe: timeframe,
                    scannedBars: candlesticks.length,
                    detectedPrecursors: precursors.length,
                    highProbabilityFormations: formationProbabilities.filter(fp => fp.probability > 0.7).length,
                    scanningDepth: this.scanningDepth
                }
            };

            // Precursor history güncelleme
            this.updatePrecursorHistory(result, data);

            // Cache ve performance tracking
            this.updateCache(data, result);
            this.trackPerformance(Date.now(), precursors.length > 0);

            return result;

        } catch (error) {
            this.handleError('PatternPrecursorScanner analysis failed', error, data);
            return this.getDefaultResult();
        }
    }

    initializePatternLibrary() {
        return {
            triangles: {
                ascending: {
                    precursors: ['higher_lows', 'resistance_test', 'volume_decline'],
                    formation: { minBars: 5, maxBars: 30 },
                    completion: ['resistance_break', 'volume_spike']
                },
                descending: {
                    precursors: ['lower_highs', 'support_test', 'volume_decline'],
                    formation: { minBars: 5, maxBars: 30 },
                    completion: ['support_break', 'volume_spike']
                },
                symmetrical: {
                    precursors: ['converging_trendlines', 'volume_decline', 'squeeze'],
                    formation: { minBars: 7, maxBars: 25 },
                    completion: ['trendline_break', 'volume_expansion']
                }
            },
            headAndShoulders: {
                regular: {
                    precursors: ['left_shoulder', 'head_formation', 'right_shoulder_start'],
                    formation: { minBars: 10, maxBars: 40 },
                    completion: ['neckline_break', 'volume_confirmation']
                },
                inverse: {
                    precursors: ['left_shoulder_low', 'head_low', 'right_shoulder_low_start'],
                    formation: { minBars: 10, maxBars: 40 },
                    completion: ['neckline_break_up', 'volume_confirmation']
                }
            },
            doubleTop: {
                precursors: ['first_peak', 'pullback', 'second_peak_approach'],
                formation: { minBars: 8, maxBars: 35 },
                completion: ['second_peak_rejection', 'support_break']
            },
            doubleBottom: {
                precursors: ['first_bottom', 'bounce', 'second_bottom_approach'],
                formation: { minBars: 8, maxBars: 35 },
                completion: ['second_bottom_hold', 'resistance_break']
            },
            flags: {
                bull: {
                    precursors: ['strong_move_up', 'consolidation_start', 'volume_decline'],
                    formation: { minBars: 3, maxBars: 15 },
                    completion: ['upper_flag_break', 'volume_return']
                },
                bear: {
                    precursors: ['strong_move_down', 'consolidation_start', 'volume_decline'],
                    formation: { minBars: 3, maxBars: 15 },
                    completion: ['lower_flag_break', 'volume_return']
                }
            },
            wedges: {
                rising: {
                    precursors: ['rising_support', 'rising_resistance', 'convergence'],
                    formation: { minBars: 8, maxBars: 25 },
                    completion: ['support_break', 'volume_spike']
                },
                falling: {
                    precursors: ['falling_support', 'falling_resistance', 'convergence'],
                    formation: { minBars: 8, maxBars: 25 },
                    completion: ['resistance_break', 'volume_spike']
                }
            },
            cupAndHandle: {
                precursors: ['cup_formation', 'handle_start', 'volume_pattern'],
                formation: { minBars: 15, maxBars: 60 },
                completion: ['handle_break', 'volume_confirmation']
            }
        };
    }

    detectPatternPrecursors(data) {
        const { candlesticks, volume, support, resistance } = data;
        const precursors = [];

        // Her pattern type için precursor tarama
        Object.keys(this.patternLibrary).forEach(patternCategory => {
            Object.keys(this.patternLibrary[patternCategory]).forEach(patternType => {
                const pattern = this.patternLibrary[patternCategory][patternType];
                const detection = this.scanForPrecursors(pattern, patternCategory, patternType, data);
                
                if (detection.found) {
                    precursors.push({
                        category: patternCategory,
                        type: patternType,
                        precursorType: detection.precursorType,
                        confidence: detection.confidence,
                        formation: detection.formation,
                        characteristics: detection.characteristics,
                        timeframe: data.timeframe,
                        detected: Date.now(),
                        expectedCompletion: detection.expectedCompletion,
                        riskReward: detection.riskReward
                    });
                }
            });
        });

        // Generic precursor patterns
        const genericPrecursors = this.detectGenericPrecursors(data);
        precursors.push(...genericPrecursors);

        // Sort by confidence
        return precursors.sort((a, b) => b.confidence - a.confidence);
    }

    scanForPrecursors(pattern, category, type, data) {
        const { candlesticks, volume, support, resistance } = data;
        
        let confidence = 0;
        let formation = 0;
        const characteristics = [];
        let found = false;
        let precursorType = 'none';

        // Triangle precursors
        if (category === 'triangles') {
            const triangleDetection = this.detectTrianglePrecursors(pattern, type, data);
            if (triangleDetection.found) {
                found = true;
                confidence = triangleDetection.confidence;
                formation = triangleDetection.formation;
                precursorType = triangleDetection.type;
                characteristics.push(...triangleDetection.characteristics);
            }
        }

        // Head and Shoulders precursors
        else if (category === 'headAndShoulders') {
            const hsDetection = this.detectHeadShouldersPrecursors(pattern, type, data);
            if (hsDetection.found) {
                found = true;
                confidence = hsDetection.confidence;
                formation = hsDetection.formation;
                precursorType = hsDetection.type;
                characteristics.push(...hsDetection.characteristics);
            }
        }

        // Double Top/Bottom precursors
        else if (category === 'doubleTop' || category === 'doubleBottom') {
            const doubleDetection = this.detectDoublePrecursors(pattern, category, data);
            if (doubleDetection.found) {
                found = true;
                confidence = doubleDetection.confidence;
                formation = doubleDetection.formation;
                precursorType = doubleDetection.type;
                characteristics.push(...doubleDetection.characteristics);
            }
        }

        // Flag precursors
        else if (category === 'flags') {
            const flagDetection = this.detectFlagPrecursors(pattern, type, data);
            if (flagDetection.found) {
                found = true;
                confidence = flagDetection.confidence;
                formation = flagDetection.formation;
                precursorType = flagDetection.type;
                characteristics.push(...flagDetection.characteristics);
            }
        }

        // Wedge precursors
        else if (category === 'wedges') {
            const wedgeDetection = this.detectWedgePrecursors(pattern, type, data);
            if (wedgeDetection.found) {
                found = true;
                confidence = wedgeDetection.confidence;
                formation = wedgeDetection.formation;
                precursorType = wedgeDetection.type;
                characteristics.push(...wedgeDetection.characteristics);
            }
        }

        // Cup and Handle precursors
        else if (category === 'cupAndHandle') {
            const cupDetection = this.detectCupHandlePrecursors(pattern, data);
            if (cupDetection.found) {
                found = true;
                confidence = cupDetection.confidence;
                formation = cupDetection.formation;
                precursorType = cupDetection.type;
                characteristics.push(...cupDetection.characteristics);
            }
        }

        return {
            found: found,
            confidence: confidence,
            formation: formation,
            precursorType: precursorType,
            characteristics: characteristics,
            expectedCompletion: this.calculateExpectedCompletion(pattern, formation),
            riskReward: this.calculateRiskReward(category, type, data)
        };
    }

    detectTrianglePrecursors(pattern, type, data) {
        const { candlesticks, volume } = data;
        let found = false;
        let confidence = 0;
        let formation = 0;
        const characteristics = [];

        if (type === 'ascending') {
            // Ascending triangle: higher lows + horizontal resistance
            const higherLows = this.detectHigherLows(candlesticks);
            const horizontalResistance = this.detectHorizontalResistance(candlesticks);
            
            if (higherLows.found && horizontalResistance.found) {
                found = true;
                confidence = (higherLows.confidence + horizontalResistance.confidence) / 2;
                formation = Math.min(higherLows.formation, horizontalResistance.formation);
                characteristics.push('higher_lows_pattern', 'horizontal_resistance');
                
                // Volume analysis
                const volumeDecline = this.detectVolumeDecline(volume, candlesticks);
                if (volumeDecline.found) {
                    confidence += 0.1;
                    characteristics.push('volume_decline');
                }
            }
        }
        
        else if (type === 'descending') {
            // Descending triangle: lower highs + horizontal support
            const lowerHighs = this.detectLowerHighs(candlesticks);
            const horizontalSupport = this.detectHorizontalSupport(candlesticks);
            
            if (lowerHighs.found && horizontalSupport.found) {
                found = true;
                confidence = (lowerHighs.confidence + horizontalSupport.confidence) / 2;
                formation = Math.min(lowerHighs.formation, horizontalSupport.formation);
                characteristics.push('lower_highs_pattern', 'horizontal_support');
                
                const volumeDecline = this.detectVolumeDecline(volume, candlesticks);
                if (volumeDecline.found) {
                    confidence += 0.1;
                    characteristics.push('volume_decline');
                }
            }
        }
        
        else if (type === 'symmetrical') {
            // Symmetrical triangle: converging trendlines
            const convergingLines = this.detectConvergingTrendlines(candlesticks);
            
            if (convergingLines.found) {
                found = true;
                confidence = convergingLines.confidence;
                formation = convergingLines.formation;
                characteristics.push('converging_trendlines');
                
                const volumeDecline = this.detectVolumeDecline(volume, candlesticks);
                if (volumeDecline.found) {
                    confidence += 0.1;
                    characteristics.push('volume_decline');
                }
                
                // Squeeze detection
                const squeeze = this.detectVolatilitySqueeze(candlesticks);
                if (squeeze.found) {
                    confidence += 0.1;
                    characteristics.push('volatility_squeeze');
                }
            }
        }

        return {
            found: found,
            confidence: Math.min(0.95, confidence),
            formation: formation,
            type: `${type}_triangle_precursor`,
            characteristics: characteristics
        };
    }

    detectHeadShouldersPrecursors(pattern, type, data) {
        const { candlesticks } = data;
        let found = false;
        let confidence = 0;
        let formation = 0;
        const characteristics = [];

        if (type === 'regular') {
            // Head and Shoulders: left shoulder -> head -> right shoulder forming
            const shoulderHead = this.detectShoulderHeadPattern(candlesticks, 'regular');
            
            if (shoulderHead.found) {
                found = true;
                confidence = shoulderHead.confidence;
                formation = shoulderHead.formation;
                characteristics.push(...shoulderHead.characteristics);
                
                // Neckline analysis
                const neckline = this.detectNecklineFormation(candlesticks, 'regular');
                if (neckline.found) {
                    confidence += 0.1;
                    characteristics.push('neckline_formation');
                }
            }
        }
        
        else if (type === 'inverse') {
            // Inverse Head and Shoulders
            const shoulderHead = this.detectShoulderHeadPattern(candlesticks, 'inverse');
            
            if (shoulderHead.found) {
                found = true;
                confidence = shoulderHead.confidence;
                formation = shoulderHead.formation;
                characteristics.push(...shoulderHead.characteristics);
                
                const neckline = this.detectNecklineFormation(candlesticks, 'inverse');
                if (neckline.found) {
                    confidence += 0.1;
                    characteristics.push('neckline_formation');
                }
            }
        }

        return {
            found: found,
            confidence: Math.min(0.95, confidence),
            formation: formation,
            type: `${type}_head_shoulders_precursor`,
            characteristics: characteristics
        };
    }

    detectDoublePrecursors(pattern, category, data) {
        const { candlesticks } = data;
        let found = false;
        let confidence = 0;
        let formation = 0;
        const characteristics = [];

        if (category === 'doubleTop') {
            // Double Top: first peak -> pullback -> approaching second peak
            const firstPeak = this.detectFirstPeak(candlesticks);
            const pullback = this.detectPullbackAfterPeak(candlesticks);
            
            if (firstPeak.found && pullback.found) {
                found = true;
                confidence = (firstPeak.confidence + pullback.confidence) / 2;
                formation = Math.max(firstPeak.formation, pullback.formation);
                characteristics.push('first_peak_identified', 'pullback_completed');
                
                // Second peak approach detection
                const secondPeakApproach = this.detectSecondPeakApproach(candlesticks, firstPeak.level);
                if (secondPeakApproach.found) {
                    confidence += 0.15;
                    characteristics.push('second_peak_approach');
                }
            }
        }
        
        else if (category === 'doubleBottom') {
            // Double Bottom: first bottom -> bounce -> approaching second bottom
            const firstBottom = this.detectFirstBottom(candlesticks);
            const bounce = this.detectBounceAfterBottom(candlesticks);
            
            if (firstBottom.found && bounce.found) {
                found = true;
                confidence = (firstBottom.confidence + bounce.confidence) / 2;
                formation = Math.max(firstBottom.formation, bounce.formation);
                characteristics.push('first_bottom_identified', 'bounce_completed');
                
                const secondBottomApproach = this.detectSecondBottomApproach(candlesticks, firstBottom.level);
                if (secondBottomApproach.found) {
                    confidence += 0.15;
                    characteristics.push('second_bottom_approach');
                }
            }
        }

        return {
            found: found,
            confidence: Math.min(0.95, confidence),
            formation: formation,
            type: `${category}_precursor`,
            characteristics: characteristics
        };
    }

    detectFlagPrecursors(pattern, type, data) {
        const { candlesticks, volume } = data;
        let found = false;
        let confidence = 0;
        let formation = 0;
        const characteristics = [];

        // Strong initial move detection
        const strongMove = this.detectStrongMove(candlesticks, type === 'bull' ? 'up' : 'down');
        
        if (strongMove.found) {
            // Consolidation phase detection
            const consolidation = this.detectConsolidationPhase(candlesticks, strongMove.endIndex);
            
            if (consolidation.found) {
                found = true;
                confidence = (strongMove.confidence + consolidation.confidence) / 2;
                formation = consolidation.formation;
                characteristics.push('strong_initial_move', 'consolidation_phase');
                
                // Volume pattern analysis
                const volumeDecline = this.detectVolumeDeclineDuringConsolidation(volume, consolidation.startIndex);
                if (volumeDecline.found) {
                    confidence += 0.1;
                    characteristics.push('volume_decline_consolidation');
                }
                
                // Flag shape detection
                const flagShape = this.detectFlagShape(candlesticks, consolidation.startIndex, type);
                if (flagShape.found) {
                    confidence += 0.15;
                    characteristics.push('flag_shape_forming');
                }
            }
        }

        return {
            found: found,
            confidence: Math.min(0.95, confidence),
            formation: formation,
            type: `${type}_flag_precursor`,
            characteristics: characteristics
        };
    }

    calculateFormationProbabilities(precursors, data) {
        return precursors.map(precursor => {
            let probability = precursor.confidence;
            
            // Formation stage adjustment
            probability += precursor.formation * 0.2;
            
            // Volume confirmation
            if (precursor.characteristics.includes('volume_decline') || 
                precursor.characteristics.includes('volume_confirmation')) {
                probability += 0.1;
            }
            
            // Support/Resistance proximity
            if (data.support || data.resistance) {
                const proximity = this.calculateSRProximity(precursor, data);
                probability += proximity * 0.1;
            }
            
            // Timeframe consistency
            const timeframeScore = this.calculateTimeframeConsistency(precursor, data);
            probability += timeframeScore * 0.1;
            
            // Historical success rate
            const historicalRate = this.getHistoricalSuccessRate(precursor.category, precursor.type);
            probability = (probability * 0.7) + (historicalRate * 0.3);
            
            return {
                precursorId: `${precursor.category}_${precursor.type}`,
                patternType: `${precursor.category}_${precursor.type}`,
                probability: Math.min(0.95, Math.max(0.05, probability)),
                confidence: precursor.confidence,
                formation: precursor.formation,
                timeToCompletion: precursor.expectedCompletion,
                riskReward: precursor.riskReward
            };
        });
    }

    generateEarlyWarnings(precursors, formationProbabilities) {
        const warnings = [];
        
        // High probability formation warnings
        formationProbabilities.forEach(fp => {
            if (fp.probability > 0.7) {
                warnings.push({
                    type: 'high_probability_formation',
                    pattern: fp.patternType,
                    probability: fp.probability,
                    message: `Yüksek olasılıklı ${fp.patternType} pattern formasyonu tespit edildi`,
                    urgency: 'high',
                    timeframe: fp.timeToCompletion
                });
            }
        });
        
        // Imminent completion warnings
        precursors.forEach(precursor => {
            if (precursor.formation > 0.8) {
                warnings.push({
                    type: 'imminent_completion',
                    pattern: `${precursor.category}_${precursor.type}`,
                    formation: precursor.formation,
                    message: `${precursor.category} ${precursor.type} pattern tamamlanmak üzere`,
                    urgency: 'medium',
                    timeframe: 'short'
                });
            }
        });
        
        // Volume anomaly warnings
        precursors.forEach(precursor => {
            if (precursor.characteristics.includes('volume_spike') || 
                precursor.characteristics.includes('volume_confirmation')) {
                warnings.push({
                    type: 'volume_confirmation',
                    pattern: `${precursor.category}_${precursor.type}`,
                    message: `Volume konfirmasyonu ile pattern güçleniyor`,
                    urgency: 'medium',
                    timeframe: 'immediate'
                });
            }
        });
        
        return warnings.sort((a, b) => {
            const urgencyOrder = { high: 3, medium: 2, low: 1 };
            return urgencyOrder[b.urgency] - urgencyOrder[a.urgency];
        });
    }

    generateRecommendations(precursors, formationProbabilities, data) {
        const recommendations = {};

        // VIVO signal routing recommendations
        const highProbPatterns = formationProbabilities.filter(fp => fp.probability > 0.6);
        if (highProbPatterns.length > 0) {
            recommendations.vivo = {
                watchPatterns: highProbPatterns.map(p => p.patternType),
                signalSensitivity: 'increased',
                confirmationRequired: 'pattern_completion'
            };
        }

        // Pattern completion monitoring
        recommendations.patternMonitoring = {
            activePatterns: precursors.map(p => ({
                pattern: `${p.category}_${p.type}`,
                formation: p.formation,
                monitoringPoints: this.getMonitoringPoints(p)
            })),
            alertThresholds: {
                formationThreshold: 0.8,
                probabilityThreshold: 0.7
            }
        };

        // Entry timing recommendations
        const nearCompletionPatterns = precursors.filter(p => p.formation > 0.7);
        if (nearCompletionPatterns.length > 0) {
            recommendations.entryTiming = {
                prepareForEntry: nearCompletionPatterns.map(p => `${p.category}_${p.type}`),
                triggerConditions: nearCompletionPatterns.map(p => this.getTriggerConditions(p)),
                timeframe: 'prepare'
            };
        }

        // Risk management recommendations
        recommendations.riskManagement = {
            patternStops: precursors.map(p => ({
                pattern: `${p.category}_${p.type}`,
                stopLevel: this.calculatePatternStopLevel(p, data),
                riskReward: p.riskReward
            })),
            positionSizing: this.getPositionSizingRecommendation(formationProbabilities)
        };

        return recommendations;
    }

    generateNotes(precursors, earlyWarnings) {
        const notes = [];

        // Precursor count note
        if (precursors.length > 0) {
            notes.push(`${precursors.length} pattern precursor tespit edildi`);
        }

        // High formation patterns
        const highFormation = precursors.filter(p => p.formation > 0.7);
        if (highFormation.length > 0) {
            notes.push(`${highFormation.length} pattern tamamlanmaya yakın`);
        }

        // Early warnings summary
        const highUrgencyWarnings = earlyWarnings.filter(w => w.urgency === 'high');
        if (highUrgencyWarnings.length > 0) {
            notes.push(`${highUrgencyWarnings.length} yüksek öncelikli uyarı`);
        }

        // Pattern types summary
        const patternTypes = [...new Set(precursors.map(p => p.category))];
        if (patternTypes.length > 0) {
            notes.push(`Tespit edilen pattern kategorileri: ${patternTypes.join(', ')}`);
        }

        return notes.join('. ') || 'Pattern precursor analizi tamamlandı';
    }

    updatePrecursorHistory(result, data) {
        this.precursorHistory.push({
            timestamp: Date.now(),
            precursorCount: result.precursors.length,
            highProbabilityCount: result.formationProbabilities.filter(fp => fp.probability > 0.7).length,
            warningCount: result.earlyWarnings.length,
            timeframe: data.timeframe
        });

        if (this.precursorHistory.length > this.maxHistorySize) {
            this.precursorHistory = this.precursorHistory.slice(-this.maxHistorySize);
        }
    }

    // Helper methods
    detectHigherLows(candlesticks) {
        // Implementation for detecting higher lows pattern
        return { found: false, confidence: 0, formation: 0 };
    }

    detectHorizontalResistance(candlesticks) {
        // Implementation for detecting horizontal resistance
        return { found: false, confidence: 0, formation: 0 };
    }

    getDefaultResult() {
        return {
            precursors: [],
            formationProbabilities: [],
            completionEstimates: [],
            srInteractions: null,
            volumePrecursors: null,
            priceActionPrecursors: null,
            structurePrecursors: null,
            multiTimeframeValidation: null,
            earlyWarnings: [],
            evolutionTracking: null,
            recommendations: {},
            notes: "Pattern precursor scanner analizi yapılamadı - yetersiz veri",
            metadata: {
                error: true,
                analysisTimestamp: Date.now()
            }
        };
    }

    getModuleInfo() {
        return {
            name: 'PatternPrecursorScanner',
            version: '1.0.0',
            description: 'Early pattern formation detection ve precursor signal identification',
            inputs: [
                'candlesticks', 'volume', 'price', 'highs', 'lows', 'opens', 'closes',
                'timeframe', 'indicators', 'support', 'resistance', 'trendDirection',
                'volatility', 'momentum', 'orderBookDepth', 'liquidityLevels'
            ],
            outputs: [
                'precursors', 'formationProbabilities', 'completionEstimates',
                'srInteractions', 'volumePrecursors', 'priceActionPrecursors',
                'structurePrecursors', 'multiTimeframeValidation', 'earlyWarnings',
                'evolutionTracking', 'recommendations', 'notes', 'metadata'
            ]
        };
    }
}

module.exports = PatternPrecursorScanner;
