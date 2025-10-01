/**
 * LIVIA-04 · confirmationBounds.js
 * Sayısal sınırlar doğrulama ve otomatik düzeltme sistemi
 * 
 * Amaç: Operatörün onaylamak üzere olduğu planı sayısal sınırlar açısından doğrulamak
 * (slip, spread, RR, miktar, kaldıraç, maruziyet, guard/policy kısıtları).
 * İhlalde blok veya otomatik düzeltme önerisi üret; sonucu LIVIA-01'e geri bildir.
 */

const { z } = require('zod');
const { eventBus } = require('../../kirpto bot sinyal/modules/modularEventStream');
const { logInfo, logError, logEvent } = require('../../kirpto bot sinyal/logs/logger');

/**
 * 🔄 Input Event Schemas
 */
const OperatorDecisionContextSchema = z.object({
    event: z.literal('operator.decision.context'),
    timestamp: z.string(),
    checkId: z.string(),
    correlationId: z.string().optional(),
    symbol: z.string(),
    side: z.enum(['long', 'short']),
    variant: z.enum(['base', 'aggressive', 'conservative']),
    exec: z.enum(['market', 'limit', 'twap', 'iceberg', 'post_only']),
    qty: z.number().positive().finite(),
    mid: z.number().positive().finite(),
    slBps: z.number().min(0).finite(),
    tpBps: z.number().min(0).finite(),
    slices: z.number().int().min(1).default(1),
    notes: z.string().optional()
});

const PolicySnapshotSchema = z.object({
    event: z.literal('policy.snapshot'),
    timestamp: z.string(),
    variants: z.object({
        aggressive: z.boolean(),
        conservative: z.boolean()
    }),
    risk: z.object({
        riskPerTradePct: z.number().min(0),
        totalRiskPct: z.number().min(0),
        maxLeverage: z.number().min(1)
    }),
    limits: z.object({
        maxSlipBps: z.number().min(0),
        maxSpreadBps: z.number().min(0),
        minRR: z.number().min(0),
        maxQtyUSD: z.number().min(0),
        maxSymbolExposurePct: z.number().min(0),
        maxClusterExposurePct: z.number().min(0)
    })
});

const MarketRefsSchema = z.object({
    event: z.literal('market.refs'),
    timestamp: z.string(),
    symbol: z.string(),
    mid: z.number().positive().finite(),
    spreadBps: z.number().min(0).finite()
});

const LatencySlipGuardDirectiveSchema = z.object({
    event: z.literal('latency_slip.guard.directive'),
    timestamp: z.string(),
    mode: z.enum(['normal', 'slowdown', 'block_aggressive', 'halt_entry']),
    expiresAt: z.string(),
    reasonCodes: z.array(z.string())
});

const SentryGuardDirectiveSchema = z.object({
    event: z.literal('sentry.guard.directive'),
    timestamp: z.string(),
    mode: z.enum(['normal', 'degraded', 'streams_panic', 'halt_entry']),
    expiresAt: z.string()
});

const CostForecastUpdateSchema = z.object({
    event: z.literal('cost.forecast.update'),
    timestamp: z.string(),
    symbol: z.string(),
    expectedSlipBps: z.number().min(0).finite(),
    feeBps: z.object({
        taker: z.number().min(0),
        maker: z.number().min(0)
    })
});

const PortfolioExposureSchema = z.object({
    event: z.literal('portfolio.exposure'),
    timestamp: z.string(),
    equityUSD: z.number().positive().finite(),
    bySymbol: z.record(z.object({
        notionalUSD: z.number().min(0),
        cluster: z.string()
    })),
    byCluster: z.record(z.object({
        notionalUSD: z.number().min(0)
    })),
    totalNotionalUSD: z.number().min(0)
});

const QaTagsSchema = z.object({
    event: z.literal('qa.tags'),
    timestamp: z.string(),
    tags: z.array(z.string())
});

/**
 * 📤 Output Event Schemas
 */
const ConfirmationBoundsCheckSchema = z.object({
    event: z.literal('confirmation.bounds.check'),
    timestamp: z.string(),
    checkId: z.string(),
    correlationId: z.string().optional(),
    symbol: z.string(),
    ok: z.boolean(),
    severity: z.enum(['soft', 'hard']).optional(),
    violations: z.array(z.object({
        code: z.string(),
        got: z.number(),
        limit: z.number()
    })),
    derived: z.object({
        qtyUSD: z.number(),
        rr: z.number(),
        leverageEst: z.number(),
        expectedSlipBps: z.number()
    }),
    audit: z.object({
        eventId: z.string(),
        producedBy: z.string(),
        producedAt: z.string()
    })
});

const ConfirmationFixSuggestionSchema = z.object({
    event: z.literal('confirmation.fix.suggestion'),
    timestamp: z.string(),
    checkId: z.string(),
    recommendation: z.object({
        action: z.enum(['revise', 'block']),
        params: z.object({
            exec: z.string().optional(),
            qtyFactor: z.number().optional(),
            slTightenBps: z.number().optional(),
            slWidenBps: z.number().optional(),
            tpTightenBps: z.number().optional(),
            tpWidenBps: z.number().optional(),
            slices: z.number().optional(),
            variant: z.string().optional()
        }).optional()
    }),
    reasonCodes: z.array(z.string()),
    audit: z.object({
        eventId: z.string(),
        producedBy: z.string(),
        producedAt: z.string()
    })
});

/**
 * 🧮 Bounds Calculator
 */
class BoundsCalculator {
    constructor(config) {
        this.config = config;
    }

    /**
     * Calculate derived metrics
     */
    calculateDerived(decision, market, costForecast, portfolio) {
        const qtyUSD = decision.qty * decision.mid;
        const rr = decision.tpBps / decision.slBps;
        
        // Expected slip calculation
        const expectedSlipBps = this.calculateExpectedSlip(decision, market, costForecast);
        
        // Leverage estimation
        const leverageEst = this.calculateLeverage(qtyUSD, portfolio);

        return {
            qtyUSD,
            rr,
            leverageEst,
            expectedSlipBps
        };
    }

    /**
     * Calculate expected slip based on execution type
     */
    calculateExpectedSlip(decision, market, costForecast) {
        if (costForecast && costForecast.expectedSlipBps !== undefined) {
            return costForecast.expectedSlipBps;
        }

        const { exec } = decision;
        const spreadBps = market ? market.spreadBps : 50; // fallback
        const maxSlipBps = this.config.limitsDefaults.maxSlipBps;

        switch (exec) {
            case 'market':
                return Math.min(maxSlipBps * 1.2, spreadBps * 0.5 + 8);
            case 'limit':
            case 'post_only':
                return Math.min(Math.max(2, spreadBps * 0.2), maxSlipBps);
            case 'twap':
            case 'iceberg':
                return Math.max(3, spreadBps * 0.3);
            default:
                return maxSlipBps * 0.5;
        }
    }

    /**
     * Calculate estimated leverage
     */
    calculateLeverage(planNotionalUSD, portfolio) {
        if (!portfolio || !portfolio.equityUSD) {
            return (planNotionalUSD / this.config.riskModel.equityFallbackUSD);
        }

        const totalAfter = portfolio.totalNotionalUSD + planNotionalUSD;
        return totalAfter / portfolio.equityUSD;
    }

    /**
     * Calculate symbol exposure after trade
     */
    calculateSymbolExposure(decision, portfolio) {
        if (!portfolio || !portfolio.equityUSD) {
            return 0;
        }

        const qtyUSD = decision.qty * decision.mid;
        const current = portfolio.bySymbol[decision.symbol]?.notionalUSD || 0;
        const after = current + qtyUSD;
        
        return (after / portfolio.equityUSD) * 100;
    }

    /**
     * Calculate cluster exposure after trade
     */
    calculateClusterExposure(decision, portfolio) {
        if (!portfolio || !portfolio.equityUSD) {
            return 0;
        }

        const qtyUSD = decision.qty * decision.mid;
        const cluster = portfolio.bySymbol[decision.symbol]?.cluster;
        
        if (!cluster) {
            return 0;
        }

        const current = portfolio.byCluster[cluster]?.notionalUSD || 0;
        const after = current + qtyUSD;
        
        return (after / portfolio.equityUSD) * 100;
    }
}

/**
 * 🔧 Bounds Fixer - Generate revision suggestions
 */
class BoundsFixer {
    constructor(config) {
        this.config = config;
    }

    /**
     * Generate fix suggestion for violations
     */
    generateFixSuggestion(violations, checkId) {
        const fixes = this.config.fixes;
        const params = {};
        const reasonCodes = [];

        for (const violation of violations) {
            const fix = fixes[violation.code];
            if (fix) {
                Object.assign(params, fix);
                reasonCodes.push(this.getReasonForCode(violation.code));
            }
        }

        const action = Object.keys(params).length > 0 ? 'revise' : 'block';

        return {
            event: 'confirmation.fix.suggestion',
            timestamp: new Date().toISOString(),
            checkId,
            recommendation: {
                action,
                params: Object.keys(params).length > 0 ? params : undefined
            },
            reasonCodes,
            audit: {
                eventId: `fix-${Date.now()}`,
                producedBy: 'livia-04',
                producedAt: new Date().toISOString()
            }
        };
    }

    /**
     * Get human-readable reason for violation code
     */
    getReasonForCode(code) {
        const reasons = {
            'spread_gt_max': 'spread_wide_use_limit',
            'expected_slip_gt_max': 'slip_high_use_limit_slices',
            'min_rr_not_met': 'improve_rr',
            'qty_usd_gt_max': 'reduce_position_size',
            'symbol_exposure_gt_cap': 'reduce_symbol_exposure',
            'cluster_exposure_gt_cap': 'reduce_cluster_exposure',
            'guard_block_aggressive': 'slowdown_use_conservative',
            'guard_halt_entry': 'entry_blocked_by_guard',
            'leverage_gt_max': 'reduce_leverage'
        };

        return reasons[code] || code;
    }
}

/**
 * 🎯 LIVIA-04 Confirmation Bounds Class
 */
class ConfirmationBounds {
    constructor(config = {}) {
        this.name = 'ConfirmationBounds';
        this.config = {
            i18n: { locale: 'tr-TR', tz: 'Europe/Istanbul' },
            tighten: {
                onHighVolPct: 0.85,
                onDegradedPct: 0.85,
                onBlockAggressivePct: 0.75,
                aggressiveRelaxPct: 1.10
            },
            hardCodes: [
                'guard_halt_entry',
                'expected_slip_gt_max_x2',
                'symbol_exposure_gt_cap_x2',
                'leverage_gt_max'
            ],
            fixes: {
                'spread_gt_max': { exec: 'limit', postOnly: true },
                'expected_slip_gt_max': { exec: 'limit', qtyFactor: 0.75, slices: 3 },
                'min_rr_not_met': { slTightenBps: 5, tpWidenBps: 5 },
                'qty_usd_gt_max': { qtyFactor: 0.5 },
                'symbol_exposure_gt_cap': { qtyFactor: 0.5 },
                'cluster_exposure_gt_cap': { qtyFactor: 0.5 },
                'guard_block_aggressive': { exec: 'limit', variant: 'conservative' }
            },
            limitsDefaults: {
                maxSlipBps: 15,
                maxSpreadBps: 80,
                minRR: 1.2,
                maxQtyUSD: 25000,
                maxLeverage: 5,
                maxSymbolExposurePct: 1.0,
                maxClusterExposurePct: 1.5
            },
            riskModel: {
                equityFallbackUSD: 25000
            },
            idempotencyTtlSec: 300,
            ...config
        };

        // State management
        this.state = {
            lastSnapshots: {
                policy: null,
                market: new Map(), // symbol -> market data
                guards: {
                    latencySlip: null,
                    sentry: null
                },
                costForecast: new Map(), // symbol -> cost data
                portfolio: null,
                qaTags: null
            },
            idempotencyCache: new Map(), // checkId -> result
            stats: {
                checked: 0,
                okCount: 0,
                softFailCount: 0,
                hardFailCount: 0,
                violationCounts: new Map()
            }
        };

        // Helper classes
        this.boundsCalculator = new BoundsCalculator(this.config);
        this.boundsFixer = new BoundsFixer(this.config);

        this.isInitialized = false;
        this.logger = null;
    }

    /**
     * 🚀 Initialize the bounds checker
     */
    async initialize(logger) {
        try {
            this.logger = logger;
            this.logger.info(`${this.name} başlatılıyor...`);

            this.setupEventListeners();
            this.startPeriodicCleanup();

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
        // Main evaluation trigger
        eventBus.subscribeToEvent('operator.decision.context', (event) => {
            this.handleDecisionContext(event.data);
        }, 'confirmationBounds');

        // State updates
        eventBus.subscribeToEvent('policy.snapshot', (event) => {
            this.handlePolicySnapshot(event.data);
        }, 'confirmationBounds');

        eventBus.subscribeToEvent('market.refs', (event) => {
            this.handleMarketRefs(event.data);
        }, 'confirmationBounds');

        eventBus.subscribeToEvent('latency_slip.guard.directive', (event) => {
            this.handleLatencySlipGuard(event.data);
        }, 'confirmationBounds');

        eventBus.subscribeToEvent('sentry.guard.directive', (event) => {
            this.handleSentryGuard(event.data);
        }, 'confirmationBounds');

        eventBus.subscribeToEvent('cost.forecast.update', (event) => {
            this.handleCostForecastUpdate(event.data);
        }, 'confirmationBounds');

        eventBus.subscribeToEvent('portfolio.exposure', (event) => {
            this.handlePortfolioExposure(event.data);
        }, 'confirmationBounds');

        eventBus.subscribeToEvent('qa.tags', (event) => {
            this.handleQaTags(event.data);
        }, 'confirmationBounds');
    }

    /**
     * 🎯 Handle operator decision context (main evaluation)
     */
    async handleDecisionContext(data) {
        try {
            const validated = OperatorDecisionContextSchema.parse(data);
            
            // Check idempotency
            if (this.state.idempotencyCache.has(validated.checkId)) {
                this.logger.info(`Skipping duplicate check: ${validated.checkId}`);
                return;
            }

            // Evaluate bounds
            const result = await this.evaluateBounds(validated);
            
            // Cache result
            this.state.idempotencyCache.set(validated.checkId, {
                result,
                timestamp: new Date(),
                ttl: this.config.idempotencyTtlSec * 1000
            });

            // Emit results
            await this.emitBoundsCheck(result);
            
            if (!result.ok) {
                await this.emitFixSuggestion(result);
            }

            // Update stats
            this.updateStats(result);

        } catch (error) {
            this.logger.error('Decision context validation error:', error);
            await this.emitBoundsAlert('error', `Validation error: ${error.message}`, { checkId: data.checkId });
        }
    }

    /**
     * 📊 Evaluate bounds for a decision
     */
    async evaluateBounds(decision) {
        const now = new Date();
        
        // Get current state
        const policy = this.state.lastSnapshots.policy;
        const market = this.state.lastSnapshots.market.get(decision.symbol);
        const costForecast = this.state.lastSnapshots.costForecast.get(decision.symbol);
        const portfolio = this.state.lastSnapshots.portfolio;

        // Calculate derived metrics
        const derived = this.boundsCalculator.calculateDerived(decision, market, costForecast, portfolio);

        // Get effective limits (apply tightening)
        const effectiveLimits = this.getEffectiveLimits(decision, policy);

        // Check violations
        const violations = this.checkViolations(decision, derived, effectiveLimits, market, portfolio);

        // Determine result
        const hasHardViolations = violations.some(v => this.config.hardCodes.includes(v.code));
        const severity = hasHardViolations ? 'hard' : (violations.length > 0 ? 'soft' : undefined);

        return {
            event: 'confirmation.bounds.check',
            timestamp: now.toISOString(),
            checkId: decision.checkId,
            correlationId: decision.correlationId,
            symbol: decision.symbol,
            ok: violations.length === 0,
            severity,
            violations,
            derived,
            audit: {
                eventId: `bounds-${Date.now()}`,
                producedBy: 'livia-04',
                producedAt: now.toISOString()
            }
        };
    }

    /**
     * 🎛️ Get effective limits (apply tightening factors)
     */
    getEffectiveLimits(decision, policy) {
        const baseLimits = policy ? policy.limits : this.config.limitsDefaults;
        const guards = this.state.lastSnapshots.guards;
        const qaTags = this.state.lastSnapshots.qaTags;

        let factor = 1.0;

        // Apply tightening based on conditions
        if (qaTags && qaTags.tags.includes('highVol')) {
            factor *= this.config.tighten.onHighVolPct;
        }

        if (guards.sentry && guards.sentry.mode === 'degraded') {
            factor *= this.config.tighten.onDegradedPct;
        }

        if (guards.latencySlip && guards.latencySlip.mode === 'block_aggressive') {
            factor *= this.config.tighten.onBlockAggressivePct;
        }

        // Apply limits
        const effectiveLimits = {
            maxSlipBps: baseLimits.maxSlipBps * factor,
            maxSpreadBps: baseLimits.maxSpreadBps * factor,
            minRR: decision.variant === 'aggressive' ? 
                baseLimits.minRR * this.config.tighten.aggressiveRelaxPct : 
                baseLimits.minRR,
            maxQtyUSD: baseLimits.maxQtyUSD,
            maxLeverage: baseLimits.maxLeverage,
            maxSymbolExposurePct: baseLimits.maxSymbolExposurePct,
            maxClusterExposurePct: baseLimits.maxClusterExposurePct
        };

        return effectiveLimits;
    }

    /**
     * ⚠️ Check for violations
     */
    checkViolations(decision, derived, limits, market, portfolio) {
        const violations = [];

        // Guard checks
        const guards = this.state.lastSnapshots.guards;

        if (guards.sentry && guards.sentry.mode === 'halt_entry') {
            violations.push({ code: 'guard_halt_entry', got: 1, limit: 0 });
        }

        if (guards.latencySlip && 
            guards.latencySlip.mode === 'block_aggressive' && 
            decision.variant === 'aggressive') {
            violations.push({ code: 'guard_block_aggressive', got: 1, limit: 0 });
        }

        // Market condition checks
        if (market) {
            if (market.spreadBps > limits.maxSpreadBps) {
                violations.push({ 
                    code: 'spread_gt_max', 
                    got: market.spreadBps, 
                    limit: limits.maxSpreadBps 
                });
            }
        }

        if (derived.expectedSlipBps > limits.maxSlipBps) {
            violations.push({ 
                code: 'expected_slip_gt_max', 
                got: derived.expectedSlipBps, 
                limit: limits.maxSlipBps 
            });

            // Check for 2x violation (hard)
            if (derived.expectedSlipBps >= 2 * limits.maxSlipBps) {
                violations.push({ 
                    code: 'expected_slip_gt_max_x2', 
                    got: derived.expectedSlipBps, 
                    limit: 2 * limits.maxSlipBps 
                });
            }
        }

        // Plan quality checks
        if (derived.rr < limits.minRR) {
            violations.push({ 
                code: 'min_rr_not_met', 
                got: derived.rr, 
                limit: limits.minRR 
            });
        }

        // Quantity checks
        if (derived.qtyUSD > limits.maxQtyUSD) {
            violations.push({ 
                code: 'qty_usd_gt_max', 
                got: derived.qtyUSD, 
                limit: limits.maxQtyUSD 
            });
        }

        // Leverage checks
        if (derived.leverageEst > limits.maxLeverage) {
            violations.push({ 
                code: 'leverage_gt_max', 
                got: derived.leverageEst, 
                limit: limits.maxLeverage 
            });
        }

        // Exposure checks
        if (portfolio) {
            const symbolExposurePct = this.boundsCalculator.calculateSymbolExposure(decision, portfolio);
            if (symbolExposurePct > limits.maxSymbolExposurePct) {
                violations.push({ 
                    code: 'symbol_exposure_gt_cap', 
                    got: symbolExposurePct, 
                    limit: limits.maxSymbolExposurePct 
                });

                // Check for 2x violation (hard)
                if (symbolExposurePct >= 2 * limits.maxSymbolExposurePct) {
                    violations.push({ 
                        code: 'symbol_exposure_gt_cap_x2', 
                        got: symbolExposurePct, 
                        limit: 2 * limits.maxSymbolExposurePct 
                    });
                }
            }

            const clusterExposurePct = this.boundsCalculator.calculateClusterExposure(decision, portfolio);
            if (clusterExposurePct > limits.maxClusterExposurePct) {
                violations.push({ 
                    code: 'cluster_exposure_gt_cap', 
                    got: clusterExposurePct, 
                    limit: limits.maxClusterExposurePct 
                });
            }
        }

        return violations;
    }

    /**
     * 📤 Emit bounds check result
     */
    async emitBoundsCheck(result) {
        try {
            const validated = ConfirmationBoundsCheckSchema.parse(result);
            eventBus.publishEvent('confirmation.bounds.check', validated, 'confirmationBounds');
            
            this.logger.info(`Bounds check: ${result.checkId} ${result.symbol} ok=${result.ok} violations=${result.violations.length}`);
        } catch (error) {
            this.logger.error('Bounds check emission error:', error);
        }
    }

    /**
     * 🔧 Emit fix suggestion
     */
    async emitFixSuggestion(result) {
        try {
            const suggestion = this.boundsFixer.generateFixSuggestion(result.violations, result.checkId);
            const validated = ConfirmationFixSuggestionSchema.parse(suggestion);
            
            eventBus.publishEvent('confirmation.fix.suggestion', validated, 'confirmationBounds');
            
            this.logger.info(`Fix suggestion: ${result.checkId} action=${suggestion.recommendation.action}`);
        } catch (error) {
            this.logger.error('Fix suggestion emission error:', error);
        }
    }

    /**
     * 🚨 Emit bounds alert
     */
    async emitBoundsAlert(level, message, context = {}) {
        const alert = {
            event: 'bounds.alert',
            timestamp: new Date().toISOString(),
            level,
            message,
            context
        };

        eventBus.publishEvent('bounds.alert', alert, 'confirmationBounds');
        this.logger.info(`Bounds alert: ${level} - ${message}`);
    }

    /**
     * 📊 Update statistics
     */
    updateStats(result) {
        this.state.stats.checked++;
        
        if (result.ok) {
            this.state.stats.okCount++;
        } else if (result.severity === 'hard') {
            this.state.stats.hardFailCount++;
        } else {
            this.state.stats.softFailCount++;
        }

        // Count violations
        for (const violation of result.violations) {
            const current = this.state.stats.violationCounts.get(violation.code) || 0;
            this.state.stats.violationCounts.set(violation.code, current + 1);
        }
    }

    /**
     * 📋 Handle policy snapshot
     */
    handlePolicySnapshot(data) {
        try {
            const validated = PolicySnapshotSchema.parse(data);
            this.state.lastSnapshots.policy = validated;
            this.logger.info(`Policy snapshot updated`);
        } catch (error) {
            this.logger.error('Policy snapshot validation error:', error);
        }
    }

    /**
     * 📈 Handle market refs
     */
    handleMarketRefs(data) {
        try {
            const validated = MarketRefsSchema.parse(data);
            this.state.lastSnapshots.market.set(validated.symbol, validated);
            this.logger.info(`Market refs updated: ${validated.symbol} spread=${validated.spreadBps}bps`);
        } catch (error) {
            this.logger.error('Market refs validation error:', error);
        }
    }

    /**
     * ⚡ Handle latency slip guard
     */
    handleLatencySlipGuard(data) {
        try {
            const validated = LatencySlipGuardDirectiveSchema.parse(data);
            this.state.lastSnapshots.guards.latencySlip = validated;
            this.logger.info(`Latency slip guard: ${validated.mode}`);
        } catch (error) {
            this.logger.error('Latency slip guard validation error:', error);
        }
    }

    /**
     * 🛡️ Handle sentry guard
     */
    handleSentryGuard(data) {
        try {
            const validated = SentryGuardDirectiveSchema.parse(data);
            this.state.lastSnapshots.guards.sentry = validated;
            this.logger.info(`Sentry guard: ${validated.mode}`);
        } catch (error) {
            this.logger.error('Sentry guard validation error:', error);
        }
    }

    /**
     * 💰 Handle cost forecast
     */
    handleCostForecastUpdate(data) {
        try {
            const validated = CostForecastUpdateSchema.parse(data);
            this.state.lastSnapshots.costForecast.set(validated.symbol, validated);
            this.logger.info(`Cost forecast updated: ${validated.symbol} slip=${validated.expectedSlipBps}bps`);
        } catch (error) {
            this.logger.error('Cost forecast validation error:', error);
        }
    }

    /**
     * 📊 Handle portfolio exposure
     */
    handlePortfolioExposure(data) {
        try {
            const validated = PortfolioExposureSchema.parse(data);
            this.state.lastSnapshots.portfolio = validated;
            this.logger.info(`Portfolio exposure updated: equity=$${validated.equityUSD}`);
        } catch (error) {
            this.logger.error('Portfolio exposure validation error:', error);
        }
    }

    /**
     * 🏷️ Handle QA tags
     */
    handleQaTags(data) {
        try {
            const validated = QaTagsSchema.parse(data);
            this.state.lastSnapshots.qaTags = validated;
            this.logger.info(`QA tags updated: ${validated.tags.join(', ')}`);
        } catch (error) {
            this.logger.error('QA tags validation error:', error);
        }
    }

    /**
     * ⏱️ Start periodic cleanup
     */
    startPeriodicCleanup() {
        // Clean idempotency cache every 5 minutes
        setInterval(() => {
            const now = Date.now();
            for (const [checkId, entry] of this.state.idempotencyCache.entries()) {
                if (now - entry.timestamp.getTime() > entry.ttl) {
                    this.state.idempotencyCache.delete(checkId);
                }
            }

            // Emit metrics every 30 seconds
            this.emitMetrics();
        }, 30000);
    }

    /**
     * 📊 Emit metrics
     */
    emitMetrics() {
        const stats = this.state.stats;
        const okRate = stats.checked > 0 ? stats.okCount / stats.checked : 0;
        const autoReviseRate = stats.checked > 0 ? stats.softFailCount / stats.checked : 0;
        const blockRate = stats.checked > 0 ? stats.hardFailCount / stats.checked : 0;

        // Convert violation counts to object
        const topViolations = {};
        for (const [code, count] of stats.violationCounts.entries()) {
            topViolations[code] = count;
        }

        const metrics = {
            event: 'bounds.metrics',
            timestamp: new Date().toISOString(),
            checked: stats.checked,
            okRate,
            autoReviseRate,
            blockRate,
            topViolations
        };

        eventBus.publishEvent('bounds.metrics', metrics, 'confirmationBounds');
    }

    /**
     * 📊 Get system status
     */
    getStatus() {
        return {
            name: this.name,
            initialized: this.isInitialized,
            stats: { ...this.state.stats },
            snapshots: {
                policy: !!this.state.lastSnapshots.policy,
                market: this.state.lastSnapshots.market.size,
                guards: {
                    latencySlip: !!this.state.lastSnapshots.guards.latencySlip,
                    sentry: !!this.state.lastSnapshots.guards.sentry
                },
                costForecast: this.state.lastSnapshots.costForecast.size,
                portfolio: !!this.state.lastSnapshots.portfolio,
                qaTags: !!this.state.lastSnapshots.qaTags
            },
            idempotencyCache: this.state.idempotencyCache.size
        };
    }

    /**
     * 🛑 Shutdown
     */
    async shutdown() {
        try {
            this.logger.info(`${this.name} kapatılıyor...`);
            
            // Clear caches and state
            this.state.idempotencyCache.clear();
            this.state.lastSnapshots.market.clear();
            this.state.lastSnapshots.costForecast.clear();
            this.state.stats.violationCounts.clear();
            
            this.isInitialized = false;
            this.logger.info(`${this.name} başarıyla kapatıldı`);
        } catch (error) {
            this.logger.error(`${this.name} kapatma hatası:`, error);
        }
    }
}

module.exports = {
    ConfirmationBounds,
    confirmationBounds: new ConfirmationBounds(),
    BoundsCalculator,
    BoundsFixer
};