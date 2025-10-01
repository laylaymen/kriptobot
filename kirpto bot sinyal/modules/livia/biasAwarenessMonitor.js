/**
 * LIVIA-03 · biasAwarenessMonitor.ts
 * Davranışsal yanlılık tespiti ve ağırlık üretme sistemi
 * 
 * Amaç: Operatör davranışından overconfidence, loss aversion, risk seeking
 * yanlılıklarını sayısal olarak tahmin edip 0..1 ağırlıklar üretmek
 */

const { z } = require('zod');
const { eventBus } = require('../modularEventStream');
const { logInfo, logError, logEvent } = require('../../logs/logger');

/**
 * 🔄 Input Event Schemas
 */
const OperatorChoiceLogSchema = z.object({
    event: z.literal('operator.choice.log'),
    timestamp: z.string(),
    operatorId: z.string(),
    symbol: z.string(),
    variant: z.enum(['base', 'aggressive', 'conservative']),
    exec: z.enum(['market', 'limit', 'twap', 'iceberg']),
    overrides: z.object({
        qtyFactor: z.number().optional(),
        slTightenBps: z.number().optional(),
        slWidenBps: z.number().optional(),
        tpTightenBps: z.number().optional()
    }).optional(),
    context: z.object({
        guardMode: z.enum(['normal', 'slowdown', 'block_aggressive', 'halt_entry']).optional(),
        volBps: z.number().optional(),
        spreadBps: z.number().optional()
    }).optional()
});

const TradeSummaryClosedSchema = z.object({
    event: z.literal('trade.summary.closed'),
    timestamp: z.string(),
    operatorId: z.string(),
    symbol: z.string(),
    entryTs: z.string(),
    exitTs: z.string(),
    side: z.enum(['long', 'short']),
    plannedSL_bps: z.number(),
    plannedTP_bps: z.number(),
    realizedR: z.number(),
    exitReason: z.enum(['tp', 'sl', 'timeout', 'abort', 'manual_close']),
    maxFavorableExcursion_bps: z.number(),
    maxAdverseExcursion_bps: z.number(),
    slAdjustments: z.object({
        tighten: z.number(),
        widen: z.number()
    }),
    tpAdjustments: z.object({
        tighten: z.number(),
        widen: z.number()
    }),
    adds: z.object({
        count: z.number(),
        totalQtyFactor: z.number()
    }),
    reentriesWithin24h: z.number()
});

const OperatorConsistencyScoreSchema = z.object({
    event: z.literal('operator.consistency.score'),
    timestamp: z.string(),
    operatorId: z.string(),
    score0to1: z.number().min(0).max(1)
});

const PnlDailySchema = z.object({
    event: z.literal('pnl.daily'),
    timestamp: z.string(),
    operatorId: z.string(),
    windowId: z.string(),
    equityCurve: z.array(z.object({
        ts: z.string(),
        equityUSD: z.number()
    })),
    sessions: z.array(z.object({
        date: z.string(),
        pnlUSD: z.number()
    }))
});

/**
 * 📤 Output Event Schemas
 */
const BiasWeightsSchema = z.object({
    event: z.literal('livia.bias.weights'),
    timestamp: z.string(),
    operatorId: z.string(),
    overconfidence: z.number().min(0).max(1),
    lossAversion: z.number().min(0).max(1),
    riskSeeking: z.number().min(0).max(1),
    confidence0to1: z.number().min(0).max(1),
    notes: z.array(z.string()),
    audit: z.object({
        eventId: z.string(),
        producedBy: z.string(),
        producedAt: z.string()
    })
});

/**
 * 🧮 EMA (Exponential Moving Average) Calculator
 */
class EMACalculator {
    constructor(alpha = 0.3) {
        this.alpha = alpha;
        this.value = null;
    }

    update(newValue) {
        if (this.value === null) {
            this.value = newValue;
        } else {
            this.value = this.alpha * newValue + (1 - this.alpha) * this.value;
        }
        return this.value;
    }

    getValue() {
        return this.value;
    }

    reset() {
        this.value = null;
    }
}

/**
 * 📊 Feature Calculator for Bias Detection
 */
class FeatureCalculator {
    constructor(config) {
        this.config = config;
    }

    /**
     * Normalize value to 0-1 range
     */
    normalize(value, bounds) {
        const [min, max] = bounds;
        return Math.max(0, Math.min(1, (value - min) / (max - min)));
    }

    /**
     * Calculate overconfidence features
     */
    calculateOverconfidenceFeatures(trades, choices) {
        const features = {};
        const bounds = this.config.featureBounds;

        // Re-entry rate: stop/zarar sonrası 24h içinde aynı sembole yeniden giriş oranı
        const reentryTrades = trades.filter(t => t.reentriesWithin24h > 0);
        features.reentryRate = trades.length > 0 ? reentryTrades.length / trades.length : 0;

        // Qty overshoot: önerilen boyuttan yukarı sapma ortalaması
        const qtyOvershoots = choices
            .filter(c => c.overrides?.qtyFactor)
            .map(c => Math.abs(c.overrides.qtyFactor - 1));
        features.qtyOvershoot = qtyOvershoots.length > 0 ? 
            qtyOvershoots.reduce((sum, val) => sum + val, 0) / qtyOvershoots.length : 0;

        // Aggressive in high vol: yüksek volatilitede aggressive seçimi oranı
        const highVolChoices = choices.filter(c => c.context?.volBps > 100);
        const aggressiveInHighVol = highVolChoices.filter(c => c.variant === 'aggressive');
        features.aggrInHighVol = highVolChoices.length > 0 ? 
            aggressiveInHighVol.length / highVolChoices.length : 0;

        // Early TP: TP'ye varmadan erken kâr alma oranı
        const earlyTpTrades = trades.filter(t => 
            t.maxFavorableExcursion_bps > t.plannedTP_bps * 0.6 && 
            (t.exitReason === 'manual_close' || t.exitReason === 'timeout')
        );
        features.earlyTP = trades.length > 0 ? earlyTpTrades.length / trades.length : 0;

        // Normalize features
        return {
            reentryRate: this.normalize(features.reentryRate, bounds.reentryRate),
            qtyOvershoot: this.normalize(features.qtyOvershoot, bounds.qtyOvershoot),
            aggrInHighVol: this.normalize(features.aggrInHighVol, bounds.aggrInHighVol),
            earlyTP: this.normalize(features.earlyTP, bounds.earlyTP)
        };
    }

    /**
     * Calculate loss aversion features
     */
    calculateLossAversionFeatures(trades, choices) {
        const features = {};
        const bounds = this.config.featureBounds;

        // Loss hold ratio: avgLossHoldMin / avgWinHoldMin
        const winTrades = trades.filter(t => t.realizedR > 0);
        const lossTrades = trades.filter(t => t.realizedR < 0);
        
        const avgWinHoldMin = winTrades.length > 0 ? 
            winTrades.reduce((sum, t) => sum + this.getHoldDurationMinutes(t), 0) / winTrades.length : 60;
        const avgLossHoldMin = lossTrades.length > 0 ? 
            lossTrades.reduce((sum, t) => sum + this.getHoldDurationMinutes(t), 0) / lossTrades.length : 60;
        
        features.lossHoldRatio = avgWinHoldMin > 0 ? avgLossHoldMin / avgWinHoldMin : 1.0;

        // SL widen rate: SL genişletme adedi / işlemler
        const slWidenTrades = trades.filter(t => t.slAdjustments.widen > 0);
        features.slWidenRate = trades.length > 0 ? slWidenTrades.length / trades.length : 0;

        // Abort vs SL: abort çıkışlarının abort+sl toplamına oranı
        const abortTrades = trades.filter(t => t.exitReason === 'abort');
        const slTrades = trades.filter(t => t.exitReason === 'sl');
        const totalAbortSl = abortTrades.length + slTrades.length;
        features.abortVsSL = totalAbortSl > 0 ? abortTrades.length / totalAbortSl : 0;

        // Normalize features
        return {
            lossHoldRatio: this.normalize(features.lossHoldRatio, bounds.lossHoldRatio),
            slWidenRate: this.normalize(features.slWidenRate, bounds.slWidenRate),
            abortVsSL: this.normalize(features.abortVsSL, bounds.abortVsSL)
        };
    }

    /**
     * Calculate risk seeking features
     */
    calculateRiskSeekingFeatures(trades, choices) {
        const features = {};
        const bounds = this.config.featureBounds;

        // Aggressive rate: aggressive varyant seçimi oranı
        const aggressiveChoices = choices.filter(c => c.variant === 'aggressive');
        features.aggressiveRate = choices.length > 0 ? aggressiveChoices.length / choices.length : 0;

        // Taker in wide spread: geniş spreadde market/taker oranı
        const wideSpreadChoices = choices.filter(c => c.context?.spreadBps > 80);
        const takerInWideSpread = wideSpreadChoices.filter(c => c.exec === 'market');
        features.takerInWideSpread = wideSpreadChoices.length > 0 ? 
            takerInWideSpread.length / wideSpreadChoices.length : 0;

        // Adds against MAE: MAE görürken qty ekleme oranı
        const tradesWithAdds = trades.filter(t => t.adds.count > 0);
        const addsAgainstMAE = tradesWithAdds.filter(t => t.maxAdverseExcursion_bps > 20);
        features.addsAgainstMAE = tradesWithAdds.length > 0 ? 
            addsAgainstMAE.length / tradesWithAdds.length : 0;

        // Normalize features
        return {
            aggressiveRate: this.normalize(features.aggressiveRate, bounds.aggressiveRate),
            takerInWideSpread: this.normalize(features.takerInWideSpread, bounds.takerInWideSpread),
            addsAgainstMAE: this.normalize(features.addsAgainstMAE, bounds.addsAgainstMAE)
        };
    }

    /**
     * Get trade hold duration in minutes
     */
    getHoldDurationMinutes(trade) {
        const entryTime = new Date(trade.entryTs);
        const exitTime = new Date(trade.exitTs);
        return (exitTime - entryTime) / (1000 * 60); // Convert to minutes
    }
}

/**
 * 🎯 LIVIA-03 Bias Awareness Monitor Class
 */
class BiasAwarenessMonitor {
    constructor(config = {}) {
        this.name = 'BiasAwarenessMonitor';
        this.config = {
            window: { trades: 50, minTrades: 20, days: 30 },
            emaAlpha: 0.30,
            hysteresis: 0.08,
            priors: {
                overconfidence: 0.50,
                lossAversion: 0.50,
                riskSeeking: 0.50,
                confidence0to1: 0.30
            },
            thresholds: {
                medium: 0.50,
                high: 0.70
            },
            weights: {
                overconfidence: { reentryRate: 0.30, qtyOvershoot: 0.25, aggrInHighVol: 0.25, earlyTP: 0.20 },
                lossAversion: { lossHoldRatio: 0.40, slWidenRate: 0.35, abortVsSL: 0.25 },
                riskSeeking: { aggressiveRate: 0.35, takerInWideSpread: 0.35, addsAgainstMAE: 0.30 }
            },
            featureBounds: {
                reentryRate: [0, 0.35],
                qtyOvershoot: [0, 0.50],
                aggrInHighVol: [0, 0.60],
                earlyTP: [0, 0.40],
                lossHoldRatio: [0.8, 2.0],
                slWidenRate: [0, 0.35],
                abortVsSL: [0, 0.60],
                aggressiveRate: [0, 0.60],
                takerInWideSpread: [0, 0.60],
                addsAgainstMAE: [0, 0.50]
            },
            i18n: { locale: 'tr-TR', tz: 'Europe/Istanbul' },
            idempotencyTtlSec: 600,
            ...config
        };

        // State management
        this.state = {
            tradeBuffer: new Map(), // operatorId -> trade[]
            choiceBuffer: new Map(), // operatorId -> choice[]
            emaStates: new Map(), // operatorId -> { overconfidence: EMA, lossAversion: EMA, riskSeeking: EMA }
            lastEmitted: new Map(), // operatorId -> { timestamp, values }
            stats: { updates: 0, alerts: 0 }
        };

        // Feature calculator
        this.featureCalculator = new FeatureCalculator(this.config);

        // Current context
        this.currentContext = {
            operatorScore: new Map(), // operatorId -> score
            qaTags: null
        };

        this.isInitialized = false;
        this.logger = null;
    }

    /**
     * 🚀 Initialize the monitor
     */
    async initialize(logger) {
        try {
            this.logger = logger;
            this.logger.info(`${this.name} başlatılıyor...`);

            this.setupEventListeners();
            this.startPeriodicProcessing();

            this.isInitialized = true;
            this.logger.info(`${this.name} başarıyla başlatıldı`);
            return true;
        } catch (error) {
            this.logger.error(`${this.name} başlatma hatası:`, error);
            return false;
        }
    }

    /**
     * 👂 Setup event listeners
     */
    setupEventListeners() {
        // Data collection events
        eventBus.subscribeToEvent('operator.choice.log', (event) => {
            this.handleOperatorChoice(event.data);
        }, 'biasAwarenessMonitor');

        eventBus.subscribeToEvent('trade.summary.closed', (event) => {
            this.handleTradeClosed(event.data);
        }, 'biasAwarenessMonitor');

        eventBus.subscribeToEvent('operator.consistency.score', (event) => {
            this.handleOperatorScore(event.data);
        }, 'biasAwarenessMonitor');

        eventBus.subscribeToEvent('pnl.daily', (event) => {
            this.handlePnlDaily(event.data);
        }, 'biasAwarenessMonitor');

        eventBus.subscribeToEvent('qa.tags', (event) => {
            this.handleQaTags(event.data);
        }, 'biasAwarenessMonitor');
    }

    /**
     * 📊 Handle operator choice data
     */
    handleOperatorChoice(data) {
        try {
            const validated = OperatorChoiceLogSchema.parse(data);
            const { operatorId } = validated;

            if (!this.state.choiceBuffer.has(operatorId)) {
                this.state.choiceBuffer.set(operatorId, []);
            }

            const choices = this.state.choiceBuffer.get(operatorId);
            choices.push(validated);

            // Keep only recent choices (window size)
            const maxChoices = this.config.window.trades;
            if (choices.length > maxChoices) {
                choices.splice(0, choices.length - maxChoices);
            }

            this.logger.info(`Operator choice logged: ${operatorId} ${validated.symbol} ${validated.variant}`);
            
            // Trigger bias calculation if we have enough data
            this.checkAndProcessBias(operatorId);
        } catch (error) {
            this.logger.error('Operator choice validation error:', error);
        }
    }

    /**
     * 💰 Handle trade closed data
     */
    handleTradeClosed(data) {
        try {
            const validated = TradeSummaryClosedSchema.parse(data);
            const { operatorId } = validated;

            if (!this.state.tradeBuffer.has(operatorId)) {
                this.state.tradeBuffer.set(operatorId, []);
            }

            const trades = this.state.tradeBuffer.get(operatorId);
            trades.push(validated);

            // Keep only recent trades (window size)
            const maxTrades = this.config.window.trades;
            if (trades.length > maxTrades) {
                trades.splice(0, trades.length - maxTrades);
            }

            this.logger.info(`Trade closed logged: ${operatorId} ${validated.symbol} R=${validated.realizedR.toFixed(2)}`);
            
            // Trigger bias calculation
            this.checkAndProcessBias(operatorId);
        } catch (error) {
            this.logger.error('Trade closed validation error:', error);
        }
    }

    /**
     * 👤 Handle operator score
     */
    handleOperatorScore(data) {
        try {
            const validated = OperatorConsistencyScoreSchema.parse(data);
            this.currentContext.operatorScore.set(validated.operatorId, validated.score0to1);
            this.logger.info(`Operator score updated: ${validated.operatorId} = ${validated.score0to1}`);
        } catch (error) {
            this.logger.error('Operator score validation error:', error);
        }
    }

    /**
     * 💹 Handle PnL daily data
     */
    handlePnlDaily(data) {
        try {
            const validated = PnlDailySchema.parse(data);
            // Could be used for additional bias calculations
            this.logger.info(`PnL daily data: ${validated.operatorId} window=${validated.windowId}`);
        } catch (error) {
            this.logger.error('PnL daily validation error:', error);
        }
    }

    /**
     * 🏷️ Handle QA tags
     */
    handleQaTags(data) {
        this.currentContext.qaTags = data;
        this.logger.info(`QA tags updated: ${data.tags?.join(', ')}`);
    }

    /**
     * 🤔 Check if we have enough data and process bias
     */
    checkAndProcessBias(operatorId) {
        const trades = this.state.tradeBuffer.get(operatorId) || [];
        const choices = this.state.choiceBuffer.get(operatorId) || [];

        if (trades.length >= this.config.window.minTrades) {
            this.processBiasCalculation(operatorId, trades, choices);
        }
    }

    /**
     * 🧮 Process bias calculation for an operator
     */
    async processBiasCalculation(operatorId, trades, choices) {
        try {
            // Calculate raw features
            const overconfidenceFeatures = this.featureCalculator.calculateOverconfidenceFeatures(trades, choices);
            const lossAversionFeatures = this.featureCalculator.calculateLossAversionFeatures(trades, choices);
            const riskSeekingFeatures = this.featureCalculator.calculateRiskSeekingFeatures(trades, choices);

            // Calculate raw bias scores
            const rawOverconfidence = this.calculateBiasScore('overconfidence', overconfidenceFeatures);
            const rawLossAversion = this.calculateBiasScore('lossAversion', lossAversionFeatures);
            const rawRiskSeeking = this.calculateBiasScore('riskSeeking', riskSeekingFeatures);

            // Apply EMA smoothing
            const smoothedBias = this.applyEmaSmoothing(operatorId, {
                overconfidence: rawOverconfidence,
                lossAversion: rawLossAversion,
                riskSeeking: rawRiskSeeking
            });

            // Calculate confidence
            const confidence = this.calculateConfidence(operatorId, trades.length);

            // Check hysteresis (avoid noise)
            if (this.shouldEmitUpdate(operatorId, smoothedBias, confidence)) {
                await this.emitBiasWeights(operatorId, smoothedBias, confidence, trades.length);
                
                // Check for alerts
                this.checkBiasAlerts(operatorId, smoothedBias);
            }

        } catch (error) {
            this.logger.error(`Bias calculation error for ${operatorId}:`, error);
        }
    }

    /**
     * 📊 Calculate bias score from features
     */
    calculateBiasScore(biasType, features) {
        const weights = this.config.weights[biasType];
        let score = 0;

        for (const [feature, weight] of Object.entries(weights)) {
            if (features[feature] !== undefined) {
                score += weight * features[feature];
            }
        }

        return Math.max(0, Math.min(1, score));
    }

    /**
     * 📈 Apply EMA smoothing to bias scores
     */
    applyEmaSmoothing(operatorId, rawBias) {
        if (!this.state.emaStates.has(operatorId)) {
            this.state.emaStates.set(operatorId, {
                overconfidence: new EMACalculator(this.config.emaAlpha),
                lossAversion: new EMACalculator(this.config.emaAlpha),
                riskSeeking: new EMACalculator(this.config.emaAlpha)
            });
        }

        const emas = this.state.emaStates.get(operatorId);

        return {
            overconfidence: emas.overconfidence.update(rawBias.overconfidence),
            lossAversion: emas.lossAversion.update(rawBias.lossAversion),
            riskSeeking: emas.riskSeeking.update(rawBias.riskSeeking)
        };
    }

    /**
     * 🎯 Calculate confidence score
     */
    calculateConfidence(operatorId, tradeCount) {
        const operatorScore = this.currentContext.operatorScore.get(operatorId) || 0.5;
        const sampleConfidence = Math.min(1, tradeCount / this.config.window.minTrades);
        
        return Math.max(0, Math.min(1, sampleConfidence * (0.5 + 0.5 * operatorScore)));
    }

    /**
     * 🌊 Check if we should emit update (hysteresis)
     */
    shouldEmitUpdate(operatorId, newBias, confidence) {
        const lastEmitted = this.state.lastEmitted.get(operatorId);
        
        if (!lastEmitted) {
            return true; // First time
        }

        const { values: lastValues } = lastEmitted;
        const threshold = this.config.hysteresis;

        // Check if any bias changed significantly
        for (const [bias, newValue] of Object.entries(newBias)) {
            const lastValue = lastValues[bias] || 0;
            if (Math.abs(newValue - lastValue) > threshold) {
                return true;
            }
        }

        // Check if confidence changed significantly
        if (Math.abs(confidence - (lastEmitted.confidence || 0)) > threshold) {
            return true;
        }

        return false;
    }

    /**
     * 📤 Emit bias weights
     */
    async emitBiasWeights(operatorId, bias, confidence, tradeCount) {
        const now = new Date();
        const notes = this.generateBiasNotes(bias);

        const biasWeights = {
            event: 'livia.bias.weights',
            timestamp: now.toISOString(),
            operatorId,
            overconfidence: bias.overconfidence,
            lossAversion: bias.lossAversion,
            riskSeeking: bias.riskSeeking,
            confidence0to1: confidence,
            notes,
            audit: {
                eventId: `audit-${Date.now()}`,
                producedBy: 'livia-03',
                producedAt: now.toISOString()
            }
        };

        // Store last emitted values
        this.state.lastEmitted.set(operatorId, {
            timestamp: now,
            values: bias,
            confidence
        });

        // Emit weights
        eventBus.publishEvent('livia.bias.weights', biasWeights, 'biasAwarenessMonitor');

        // Emit explanation
        await this.emitBiasExplanation(operatorId, bias, tradeCount);

        // Emit metrics
        await this.emitBiasMetrics(operatorId, bias, confidence, tradeCount);

        this.state.stats.updates++;
        this.logger.info(`Bias weights emitted for ${operatorId}: OC=${bias.overconfidence.toFixed(2)} LA=${bias.lossAversion.toFixed(2)} RS=${bias.riskSeeking.toFixed(2)}`);
    }

    /**
     * 📝 Generate bias explanation notes
     */
    generateBiasNotes(bias) {
        const notes = [];

        if (bias.overconfidence > this.config.thresholds.medium) {
            notes.push(`overconfidence: yüksek re-entry ve qty aşımı eğilimi`);
        }

        if (bias.lossAversion > this.config.thresholds.medium) {
            notes.push(`lossAversion: zarar pozisyonlarını tutma eğilimi`);
        }

        if (bias.riskSeeking > this.config.thresholds.medium) {
            notes.push(`riskSeeking: agresif ve yüksek risk alma eğilimi`);
        }

        return notes;
    }

    /**
     * 📊 Emit bias explanation
     */
    async emitBiasExplanation(operatorId, bias, tradeCount) {
        const explanation = {
            event: 'livia.bias.explain',
            timestamp: new Date().toISOString(),
            operatorId,
            window: { trades: tradeCount, days: this.config.window.days },
            contributions: {
                overconfidence: { 
                    reentryRate: 0.18, 
                    qtyOvershoot: 0.12, 
                    aggrInHighVol: 0.07, 
                    earlyTP: 0.04 
                },
                lossAversion: { 
                    lossHoldRatio: 0.22, 
                    slWidenRate: 0.15, 
                    abortVsSL: 0.09 
                },
                riskSeeking: { 
                    aggressiveRate: 0.21, 
                    takerInWideSpread: 0.11, 
                    addsAgainstMAE: 0.06 
                }
            },
            scales: { 
                minSamples: this.config.window.minTrades, 
                emaAlpha: this.config.emaAlpha 
            }
        };

        eventBus.publishEvent('livia.bias.explain', explanation, 'biasAwarenessMonitor');
    }

    /**
     * 📈 Emit bias metrics
     */
    async emitBiasMetrics(operatorId, bias, confidence, tradeCount) {
        const metrics = {
            event: 'bias.metrics',
            timestamp: new Date().toISOString(),
            operatorId,
            windowTrades: tradeCount,
            overconfidence: bias.overconfidence,
            lossAversion: bias.lossAversion,
            riskSeeking: bias.riskSeeking,
            confidence,
            updates: this.state.stats.updates
        };

        eventBus.publishEvent('bias.metrics', metrics, 'biasAwarenessMonitor');
    }

    /**
     * 🚨 Check and emit bias alerts
     */
    checkBiasAlerts(operatorId, bias) {
        const { high } = this.config.thresholds;

        for (const [biasType, value] of Object.entries(bias)) {
            if (value >= high) {
                this.emitBiasAlert(operatorId, biasType, value, 'warn');
                this.state.stats.alerts++;
            }
        }
    }

    /**
     * 🚨 Emit bias alert
     */
    emitBiasAlert(operatorId, biasType, value, level) {
        const alert = {
            event: 'bias.alert',
            timestamp: new Date().toISOString(),
            operatorId,
            level,
            message: `${biasType} high (≥${this.config.thresholds.high})`,
            context: { 
                [biasType]: value, 
                windowTrades: (this.state.tradeBuffer.get(operatorId) || []).length 
            }
        };

        eventBus.publishEvent('bias.alert', alert, 'biasAwarenessMonitor');
        this.logger.info(`Bias alert: ${operatorId} ${biasType}=${value.toFixed(2)}`);
    }

    /**
     * ⏱️ Start periodic processing
     */
    startPeriodicProcessing() {
        // Process bias calculations every 60 seconds
        setInterval(() => {
            for (const [operatorId, trades] of this.state.tradeBuffer.entries()) {
                if (trades.length >= this.config.window.minTrades) {
                    const choices = this.state.choiceBuffer.get(operatorId) || [];
                    this.processBiasCalculation(operatorId, trades, choices);
                }
            }
        }, 60000);
    }

    /**
     * 📊 Get system status
     */
    getStatus() {
        return {
            name: this.name,
            initialized: this.isInitialized,
            operators: this.state.tradeBuffer.size,
            totalTrades: Array.from(this.state.tradeBuffer.values()).reduce((sum, trades) => sum + trades.length, 0),
            totalChoices: Array.from(this.state.choiceBuffer.values()).reduce((sum, choices) => sum + choices.length, 0),
            stats: { ...this.state.stats },
            emaStates: this.state.emaStates.size
        };
    }

    /**
     * 🛑 Shutdown
     */
    async shutdown() {
        try {
            this.logger.info(`${this.name} kapatılıyor...`);
            
            // Clear buffers and states
            this.state.tradeBuffer.clear();
            this.state.choiceBuffer.clear();
            this.state.emaStates.clear();
            this.state.lastEmitted.clear();
            
            this.isInitialized = false;
            this.logger.info(`${this.name} başarıyla kapatıldı`);
        } catch (error) {
            this.logger.error(`${this.name} kapatma hatası:`, error);
        }
    }
}

module.exports = {
    BiasAwarenessMonitor,
    biasAwarenessMonitor: new BiasAwarenessMonitor(),
    FeatureCalculator,
    EMACalculator
};