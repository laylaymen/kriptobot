/**
 * Grafik Beyni - Confirmation Signal Bridge Module
 * 
 * Waits for multiple confirmations from different technical indicators before
 * sending strong signals to VIVO system. Acts as a quality filter that prevents
 * weak signals from reaching the trading system.
 */

const GrafikBeyniModuleBase = require('./grafikBeyniModuleBase');

class ConfirmationSignalBridge extends GrafikBeyniModuleBase {
    constructor() {
        super('confirmationSignalBridge');
        
        // Configuration for signal confirmation requirements
        this.config = {
            confirmationRequirements: {
                strong: {
                    minConfirmations: 3,      // At least 3 confirmations
                    requiredTypes: ['technical', 'momentum', 'volume'], // Must have all types
                    minConfidenceSum: 2.4,    // Sum of all confidences >= 2.4
                    timeWindowSeconds: 300    // All confirmations within 5 minutes
                },
                moderate: {
                    minConfirmations: 2,
                    requiredTypes: ['technical', 'momentum'], // At least tech + momentum
                    minConfidenceSum: 1.6,
                    timeWindowSeconds: 600    // 10 minutes
                },
                weak: {
                    minConfirmations: 1,
                    requiredTypes: ['technical'], // Just technical is enough
                    minConfidenceSum: 0.7,
                    timeWindowSeconds: 900    // 15 minutes
                }
            },
            signalWeights: {
                'pattern-breakout': 1.0,      // Formation breakouts
                'support-resistance': 0.9,    // S/R level interactions
                'momentum-confirmation': 0.8,  // RSI, MACD confirmations
                'volume-confirmation': 0.7,   // Volume analysis
                'trend-alignment': 0.8,       // Trend direction match
                'risk-reward': 0.6,           // Risk/reward validation
                'entry-zone': 0.5,            // Entry timing
                'false-breakout-filter': 0.9  // Breakout validity
            },
            vivoSignalTypes: {
                'STRONG_BUY': { minScore: 2.5, minConfirmations: 3 },
                'BUY': { minScore: 1.8, minConfirmations: 2 },
                'WEAK_BUY': { minScore: 1.2, minConfirmations: 2 },
                'STRONG_SELL': { minScore: 2.5, minConfirmations: 3 },
                'SELL': { minScore: 1.8, minConfirmations: 2 },
                'WEAK_SELL': { minScore: 1.2, minConfirmations: 2 },
                'HOLD': { minScore: 0.0, minConfirmations: 1 }
            },
            timeouts: {
                signalExpirySeconds: 1800,    // Signals expire after 30 minutes
                maxWaitTimeSeconds: 900       // Max wait for confirmations
            }
        };

        // Internal state
        this.pendingSignals = new Map();     // Signals awaiting confirmation
        this.confirmedSignals = new Map();   // Confirmed signals ready for VIVO
        this.signalHistory = [];             // Signal history for analysis
    }

    async analyze(data) {
        try {
            const startTime = Date.now();
            
            if (!this.validateInput(data)) {
                return this.createErrorOutput('Invalid input data for confirmation bridge');
            }

            // Clean up expired signals
            this.cleanupExpiredSignals();

            // Process new confirmation or signal
            let result;
            if (data.newSignal) {
                result = await this.processNewSignal(data.newSignal);
            } else if (data.confirmation) {
                result = await this.processConfirmation(data.confirmation);
            } else {
                result = await this.checkPendingSignals();
            }

            this.trackPerformance(startTime);
            return result;

        } catch (error) {
            this.logError('Confirmation signal bridge failed', error);
            return this.createErrorOutput(error.message);
        }
    }

    async processNewSignal(signalData) {
        const signalId = this.generateSignalId();
        const signal = {
            id: signalId,
            timestamp: Date.now(),
            symbol: signalData.symbol,
            direction: signalData.direction,
            strength: signalData.strength,
            source: signalData.source,
            confidence: signalData.confidence || 0.5,
            confirmations: [],
            metadata: signalData.metadata || {}
        };

        // Check if this signal is immediately strong enough
        const immediateConfirmation = this.checkImmediateConfirmation(signal);
        
        if (immediateConfirmation.isConfirmed) {
            // Strong enough to send immediately
            const vivoSignal = this.createVivoSignal(signal, immediateConfirmation);
            this.confirmedSignals.set(signalId, vivoSignal);
            this.addToHistory(signal, 'immediate-confirmation');
            
            return {
                signalId: signalId,
                status: 'confirmed',
                vivoSignal: vivoSignal,
                confirmationLevel: immediateConfirmation.level,
                confirmations: signal.confirmations,
                waitTime: 0,
                recommendation: 'send-to-vivo'
            };
        } else {
            // Needs additional confirmations
            this.pendingSignals.set(signalId, signal);
            this.addToHistory(signal, 'pending-confirmation');
            
            return {
                signalId: signalId,
                status: 'pending',
                requiredConfirmations: immediateConfirmation.required,
                currentConfirmations: signal.confirmations.length,
                timeRemaining: this.config.timeouts.maxWaitTimeSeconds,
                recommendation: 'wait-for-confirmation'
            };
        }
    }

    async processConfirmation(confirmationData) {
        const results = [];
        
        // Find signals that this confirmation could apply to
        for (const [signalId, signal] of this.pendingSignals) {
            if (this.isConfirmationRelevant(signal, confirmationData)) {
                // Add confirmation to signal
                signal.confirmations.push({
                    type: confirmationData.type,
                    confidence: confirmationData.confidence,
                    source: confirmationData.source,
                    timestamp: Date.now(),
                    data: confirmationData.data
                });

                // Check if signal is now confirmed
                const confirmationCheck = this.checkSignalConfirmation(signal);
                
                if (confirmationCheck.isConfirmed) {
                    // Signal is now confirmed
                    const vivoSignal = this.createVivoSignal(signal, confirmationCheck);
                    this.confirmedSignals.set(signalId, vivoSignal);
                    this.pendingSignals.delete(signalId);
                    this.addToHistory(signal, 'confirmed');
                    
                    results.push({
                        signalId: signalId,
                        status: 'confirmed',
                        vivoSignal: vivoSignal,
                        confirmationLevel: confirmationCheck.level,
                        totalConfirmations: signal.confirmations.length,
                        recommendation: 'send-to-vivo'
                    });
                } else {
                    results.push({
                        signalId: signalId,
                        status: 'still-pending',
                        requiredConfirmations: confirmationCheck.required,
                        currentConfirmations: signal.confirmations.length,
                        recommendation: 'continue-waiting'
                    });
                }
            }
        }

        if (results.length === 0) {
            return {
                status: 'no-matching-signals',
                confirmationType: confirmationData.type,
                pendingSignalsCount: this.pendingSignals.size,
                recommendation: 'confirmation-logged'
            };
        }

        return {
            status: 'confirmations-processed',
            results: results,
            totalPendingSignals: this.pendingSignals.size
        };
    }

    async checkPendingSignals() {
        const results = [];
        const expiredSignals = [];

        for (const [signalId, signal] of this.pendingSignals) {
            const age = Date.now() - signal.timestamp;
            
            if (age > this.config.timeouts.maxWaitTimeSeconds * 1000) {
                // Signal has expired
                expiredSignals.push(signalId);
                this.addToHistory(signal, 'expired');
            } else {
                // Check current confirmation status
                const confirmationCheck = this.checkSignalConfirmation(signal);
                results.push({
                    signalId: signalId,
                    status: 'pending',
                    age: age,
                    confirmationLevel: confirmationCheck.level,
                    currentConfirmations: signal.confirmations.length,
                    requiredConfirmations: confirmationCheck.required,
                    timeRemaining: this.config.timeouts.maxWaitTimeSeconds * 1000 - age
                });
            }
        }

        // Remove expired signals
        expiredSignals.forEach(signalId => {
            this.pendingSignals.delete(signalId);
        });

        return {
            status: 'pending-signals-checked',
            pendingSignals: results,
            expiredSignals: expiredSignals.length,
            totalPendingSignals: this.pendingSignals.size,
            totalConfirmedSignals: this.confirmedSignals.size
        };
    }

    checkImmediateConfirmation(signal) {
        const sourceWeight = this.config.signalWeights[signal.source] || 0.5;
        const score = signal.confidence * sourceWeight;
        
        // Check against VIVO signal requirements
        for (const [signalType, requirements] of Object.entries(this.config.vivoSignalTypes)) {
            if (score >= requirements.minScore && signal.confirmations.length >= requirements.minConfirmations) {
                return {
                    isConfirmed: true,
                    level: 'immediate',
                    signalType: signalType,
                    score: score,
                    required: requirements.minConfirmations
                };
            }
        }

        return {
            isConfirmed: false,
            level: 'insufficient',
            score: score,
            required: this.config.confirmationRequirements.weak.minConfirmations
        };
    }

    checkSignalConfirmation(signal) {
        const totalConfirmations = signal.confirmations.length;
        const confirmationTypes = new Set(signal.confirmations.map(c => c.type));
        const confidenceSum = signal.confirmations.reduce((sum, c) => sum + c.confidence, 0);
        
        // Add initial signal confidence
        const sourceWeight = this.config.signalWeights[signal.source] || 0.5;
        const totalScore = confidenceSum + (signal.confidence * sourceWeight);

        // Check strong confirmation
        const strong = this.config.confirmationRequirements.strong;
        if (totalConfirmations >= strong.minConfirmations &&
            totalScore >= strong.minConfidenceSum &&
            this.hasRequiredTypes(confirmationTypes, strong.requiredTypes)) {
            return {
                isConfirmed: true,
                level: 'strong',
                score: totalScore,
                required: strong.minConfirmations
            };
        }

        // Check moderate confirmation
        const moderate = this.config.confirmationRequirements.moderate;
        if (totalConfirmations >= moderate.minConfirmations &&
            totalScore >= moderate.minConfidenceSum &&
            this.hasRequiredTypes(confirmationTypes, moderate.requiredTypes)) {
            return {
                isConfirmed: true,
                level: 'moderate',
                score: totalScore,
                required: moderate.minConfirmations
            };
        }

        // Check weak confirmation
        const weak = this.config.confirmationRequirements.weak;
        if (totalConfirmations >= weak.minConfirmations &&
            totalScore >= weak.minConfidenceSum &&
            this.hasRequiredTypes(confirmationTypes, weak.requiredTypes)) {
            return {
                isConfirmed: true,
                level: 'weak',
                score: totalScore,
                required: weak.minConfirmations
            };
        }

        return {
            isConfirmed: false,
            level: 'insufficient',
            score: totalScore,
            required: weak.minConfirmations
        };
    }

    hasRequiredTypes(availableTypes, requiredTypes) {
        return requiredTypes.every(type => availableTypes.has(type));
    }

    isConfirmationRelevant(signal, confirmation) {
        // Check symbol match
        if (confirmation.symbol && confirmation.symbol !== signal.symbol) {
            return false;
        }

        // Check direction compatibility
        if (confirmation.direction && confirmation.direction !== signal.direction) {
            return false;
        }

        // Check time window
        const timeDiff = Date.now() - signal.timestamp;
        const maxTime = this.config.confirmationRequirements.strong.timeWindowSeconds * 1000;
        
        return timeDiff <= maxTime;
    }

    createVivoSignal(signal, confirmationData) {
        // Determine VIVO signal type based on score and confirmations
        let vivoSignalType = 'HOLD';
        
        for (const [signalType, requirements] of Object.entries(this.config.vivoSignalTypes)) {
            if (confirmationData.score >= requirements.minScore &&
                signal.confirmations.length >= requirements.minConfirmations) {
                vivoSignalType = signalType;
                break;
            }
        }

        return {
            id: signal.id,
            symbol: signal.symbol,
            type: vivoSignalType,
            direction: signal.direction,
            strength: confirmationData.level,
            confidence: confirmationData.score,
            timestamp: Date.now(),
            source: 'confirmation-bridge',
            metadata: {
                originalSignal: signal.source,
                confirmations: signal.confirmations.length,
                confirmationLevel: confirmationData.level,
                totalScore: confirmationData.score,
                waitTime: Date.now() - signal.timestamp
            },
            modularRecommendations: {
                VIVO: {
                    signalType: vivoSignalType,
                    confidence: confirmationData.score,
                    execute: true
                },
                riskRewardValidator: {
                    validateBeforeExecution: true,
                    requiredRatio: confirmationData.level === 'strong' ? 2.0 : 1.5
                },
                entryZoneClassifier: {
                    useConfirmedEntry: true,
                    confirmationStrength: confirmationData.level
                }
            }
        };
    }

    cleanupExpiredSignals() {
        const now = Date.now();
        const expiredThreshold = this.config.timeouts.signalExpirySeconds * 1000;

        // Clean pending signals
        for (const [signalId, signal] of this.pendingSignals) {
            if (now - signal.timestamp > expiredThreshold) {
                this.pendingSignals.delete(signalId);
                this.addToHistory(signal, 'expired');
            }
        }

        // Clean confirmed signals
        for (const [signalId, signal] of this.confirmedSignals) {
            if (now - signal.timestamp > expiredThreshold) {
                this.confirmedSignals.delete(signalId);
            }
        }
    }

    generateSignalId() {
        return `signal_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    addToHistory(signal, status) {
        this.signalHistory.push({
            signalId: signal.id,
            symbol: signal.symbol,
            direction: signal.direction,
            source: signal.source,
            status: status,
            timestamp: Date.now(),
            confirmations: signal.confirmations ? signal.confirmations.length : 0
        });

        // Keep only last 1000 entries
        if (this.signalHistory.length > 1000) {
            this.signalHistory.splice(0, 100);
        }
    }

    validateInput(data) {
        return data && (data.newSignal || data.confirmation || data.checkPending === true);
    }

    createErrorOutput(message) {
        return {
            status: 'error',
            error: message,
            pendingSignals: this.pendingSignals.size,
            confirmedSignals: this.confirmedSignals.size,
            recommendation: 'check-input-data'
        };
    }

    // Public methods for other modules
    getPendingSignalsCount() {
        return this.pendingSignals.size;
    }

    getConfirmedSignalsCount() {
        return this.confirmedSignals.size;
    }

    getSignalHistory(limit = 50) {
        return this.signalHistory.slice(-limit);
    }

    getSignalStats() {
        const history = this.signalHistory.slice(-100); // Last 100 signals
        const confirmed = history.filter(s => s.status === 'confirmed').length;
        const expired = history.filter(s => s.status === 'expired').length;
        
        return {
            totalProcessed: history.length,
            confirmedRate: history.length > 0 ? confirmed / history.length : 0,
            expiredRate: history.length > 0 ? expired / history.length : 0,
            currentPending: this.pendingSignals.size,
            currentConfirmed: this.confirmedSignals.size
        };
    }
}

module.exports = ConfirmationSignalBridge;
