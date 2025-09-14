/**
 * Execution Fill Emulator - BR-04
 * Mimics real exchange matching behavior with maker/taker, queue effects, partial fills
 * Supports post_only/iceberg logic for realistic backtest/replay execution
 */

import { EventEmitter } from 'events';

interface OrderIntent {
    correlationId: string;
    symbol: string;
    side: 'buy' | 'sell';
    qty: number;
    mode: 'market' | 'limit' | 'post_only' | 'twap' | 'iceberg';
    price?: number;
    tif?: 'GTC' | 'IOC' | 'FOK';
    slices?: number; // For TWAP/iceberg
}

interface OrderPlan {
    planId: string;
    intent: OrderIntent;
    estimatedCost: number;
    estimatedSlipBps: number;
    estimatedFillTime: number;
}

interface MarketRefs {
    symbol: string;
    bid: number;
    ask: number;
    last: number;
    volume: number;
    timestamp: number;
}

interface OrderbookL2 {
    symbol: string;
    bids: Array<[number, number]>; // [price, size]
    asks: Array<[number, number]>;
    timestamp: number;
}

interface FeesSchedule {
    symbol: string;
    makerBps: number;
    takerBps: number;
    timestamp: number;
}

interface EmulatorPolicy {
    makerQueueAdvantage: number; // 0-1, likelihood of maker fill at touch
    postOnlyStrict: boolean;
    icebergRevealPct: number; // How much of iceberg to reveal per slice
    latencyVarianceMs: number;
}

interface OrderAck {
    event: 'order.ack';
    timestamp: string;
    correlationId: string;
    orderId: string;
    status: 'accepted' | 'rejected';
    reason?: string;
}

interface OrderFill {
    event: 'order.fill.partial' | 'order.fill.final';
    timestamp: string;
    correlationId: string;
    orderId: string;
    fillId: string;
    fillPrice: number;
    fillQty: number;
    remainingQty: number;
    side: 'buy' | 'sell';
    feeUSD: number;
    isMaker: boolean;
}

interface OrderReject {
    event: 'order.reject';
    timestamp: string;
    correlationId: string;
    reason: string;
    context: any;
}

interface OrderCostEstimate {
    event: 'order.costs.estimate';
    timestamp: string;
    correlationId: string;
    takerBp: number;
    makerBp: number;
    slipBps: number;
    feeUSD: number;
    expectedFillTime: number;
}

interface EmulatorMetrics {
    event: 'emulator.metrics';
    timestamp: string;
    fillLatencyMs: number;
    partialsPerOrder: number;
    makerShare: number; // % of fills that were maker
    avgSlipBps: number;
    rejectRate: number;
}

interface Config {
    queue: {
        baseMs: number; // Base latency for order processing
        depthUSD: number; // Reference depth for queue calculations
        makerAdv: number; // Maker advantage (0-1)
    };
    slip: {
        marketK: number; // Market order slip coefficient
        limitK: number; // Limit order slip coefficient  
        volToSlipCoeff: number; // Volume to slippage coefficient
    };
    iceberg: {
        minDisplayPct: number; // Minimum % to display per slice
    };
    postOnly: {
        strict: boolean; // Reject if price would cross spread
    };
    latency: {
        baseMs: number;
        varianceMs: number;
    };
    tz: string;
}

interface OrderState {
    orderId: string;
    intent: OrderIntent;
    remainingQty: number;
    avgFillPrice: number;
    totalFilled: number;
    status: 'pending' | 'partial' | 'filled' | 'rejected' | 'cancelled';
    isMaker: boolean;
    submitTime: number;
    lastFillTime?: number;
    slices?: Array<{
        price: number;
        qty: number;
        revealed: boolean;
    }>;
}

class ExecutionFillEmulator extends EventEmitter {
    private config: Config;
    private logger: any;
    private isInitialized: boolean = false;
    
    // Market data cache
    private marketRefs: Map<string, MarketRefs> = new Map();
    private orderbooks: Map<string, OrderbookL2> = new Map();
    private fees: Map<string, FeesSchedule> = new Map();
    
    // Emulator state
    private policy: EmulatorPolicy = {
        makerQueueAdvantage: 0.6,
        postOnlyStrict: true,
        icebergRevealPct: 0.15,
        latencyVarianceMs: 50
    };
    
    private activeOrders: Map<string, OrderState> = new Map();
    private orderCounter: number = 0;
    
    // Metrics
    private metrics = {
        totalOrders: 0,
        totalFills: 0,
        totalRejects: 0,
        avgFillLatency: 0,
        makerFills: 0,
        totalSlipBps: 0,
        windowStart: Date.now()
    };

    constructor(config: Partial<Config> = {}) {
        super();
        this.config = {
            queue: {
                baseMs: 200,
                depthUSD: 1e6,
                makerAdv: 0.6
            },
            slip: {
                marketK: 0.8,
                limitK: 0.25,
                volToSlipCoeff: 0.02
            },
            iceberg: {
                minDisplayPct: 0.15
            },
            postOnly: {
                strict: true
            },
            latency: {
                baseMs: 50,
                varianceMs: 25
            },
            tz: 'Europe/Istanbul',
            ...config
        };

        // Metrics emission
        setInterval(() => {
            this.emitMetrics();
        }, 60000);
    }

    async initialize(logger: any): Promise<boolean> {
        try {
            this.logger = logger;
            this.logger.info('ExecutionFillEmulator initializing...');
            
            this.isInitialized = true;
            this.logger.info('ExecutionFillEmulator initialized successfully');
            return true;
        } catch (error) {
            this.logger.error('ExecutionFillEmulator initialization error:', error);
            return false;
        }
    }

    /**
     * Process order intents
     */
    async processOrderIntent(data: OrderIntent): Promise<void> {
        if (!this.isInitialized) return;

        try {
            // Generate order ID
            const orderId = `EMU-${++this.orderCounter}-${Date.now()}`;
            
            // Validate order
            const validation = this.validateOrder(data);
            if (!validation.valid) {
                await this.emitReject(data.correlationId ?? 'unknown', validation.reason);
                return;
            }

            // Create order state
            const orderState: OrderState = {
                orderId,
                intent: data,
                remainingQty: data.qty,
                avgFillPrice: 0,
                totalFilled: 0,
                status: 'pending',
                isMaker: false,
                submitTime: Date.now()
            };

            // Handle special order types
            if (data.mode === 'iceberg') {
                orderState.slices = this.createIcebergSlices(data);
            }

            this.activeOrders.set(orderId, orderState);
            
            // Send acknowledgment
            await this.emitAck(data.correlationId, orderId, 'accepted');
            
            // Start fill simulation
            setTimeout(() => {
                this.simulateExecution(orderId);
            }, this.calculateProcessingLatency());

            this.metrics.totalOrders++;

        } catch (error) {
            this.logger.error('ExecutionFillEmulator order intent error:', error);
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            await this.emitReject(data.correlationId ?? 'unknown', `Processing error: ${errorMessage}`);
        }
    }

    /**
     * Process order plans for cost estimation
     */
    async processOrderPlan(data: OrderPlan): Promise<void> {
        if (!this.isInitialized) return;

        try {
            const estimate = this.estimateOrderCosts(data.intent);
            this.emit('order.costs.estimate', estimate);

        } catch (error) {
            this.logger.error('ExecutionFillEmulator order plan error:', error);
        }
    }

    /**
     * Process market data updates
     */
    async processMarketRefs(data: MarketRefs): Promise<void> {
        if (!this.isInitialized) return;

        this.marketRefs.set(data.symbol, data);
        
        // Check for fills on pending orders
        this.checkPendingOrders(data.symbol);
    }

    async processOrderbookL2(data: OrderbookL2): Promise<void> {
        if (!this.isInitialized) return;
        this.orderbooks.set(data.symbol, data);
    }

    async processFeesSchedule(data: FeesSchedule): Promise<void> {
        if (!this.isInitialized) return;
        this.fees.set(data.symbol, data);
    }

    /**
     * Process emulator policy updates
     */
    async processEmulatorPolicy(data: EmulatorPolicy): Promise<void> {
        if (!this.isInitialized) return;

        this.policy = { ...this.policy, ...data };
        this.logger.info('ExecutionFillEmulator policy updated:', this.policy);
    }

    private validateOrder(intent: OrderIntent): { valid: boolean; reason?: string } {
        const marketData = this.marketRefs.get(intent.symbol);
        if (!marketData) {
            return { valid: false, reason: 'No market data available' };
        }

        // Validate post_only orders
        if (intent.mode === 'post_only' && this.config.postOnly.strict) {
            const { bid, ask } = marketData;
            
            if (intent.side === 'buy' && intent.price && intent.price >= ask) {
                return { valid: false, reason: 'Post-only buy order would cross spread' };
            }
            
            if (intent.side === 'sell' && intent.price && intent.price <= bid) {
                return { valid: false, reason: 'Post-only sell order would cross spread' };
            }
        }

        // Validate quantity
        if (intent.qty <= 0) {
            return { valid: false, reason: 'Invalid quantity' };
        }

        // Validate limit price for limit orders
        if ((intent.mode === 'limit' || intent.mode === 'post_only') && !intent.price) {
            return { valid: false, reason: 'Limit/post-only orders require price' };
        }

        return { valid: true };
    }

    private createIcebergSlices(intent: OrderIntent): Array<{ price: number; qty: number; revealed: boolean }> {
        const sliceCount = intent.slices || Math.ceil(intent.qty / (intent.qty * this.policy.icebergRevealPct));
        const sliceSize = intent.qty / sliceCount;
        const slices = [];

        for (let i = 0; i < sliceCount; i++) {
            slices.push({
                price: intent.price || 0,
                qty: sliceSize,
                revealed: i === 0 // Only first slice is initially revealed
            });
        }

        return slices;
    }

    private async simulateExecution(orderId: string): Promise<void> {
        const orderState = this.activeOrders.get(orderId);
        if (!orderState || orderState.status !== 'pending') return;

        const intent = orderState.intent;
        const marketData = this.marketRefs.get(intent.symbol);
        if (!marketData) return;

        try {
            switch (intent.mode) {
                case 'market':
                    await this.executeMarketOrder(orderState, marketData);
                    break;
                case 'limit':
                    await this.executeLimitOrder(orderState, marketData);
                    break;
                case 'post_only':
                    await this.executePostOnlyOrder(orderState, marketData);
                    break;
                case 'iceberg':
                    await this.executeIcebergOrder(orderState, marketData);
                    break;
                case 'twap':
                    await this.executeTwapOrder(orderState, marketData);
                    break;
            }
        } catch (error) {
            this.logger.error(`ExecutionFillEmulator execution error for ${orderId}:`, error);
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            await this.emitReject(intent.correlationId ?? 'unknown', `Execution error: ${errorMessage}`);
            this.activeOrders.delete(orderId);
        }
    }

    private async executeMarketOrder(orderState: OrderState, marketData: MarketRefs): Promise<void> {
        const intent = orderState.intent;
        const isBuy = intent.side === 'buy';
        
        // Market orders fill immediately but with slippage
        const targetPrice = isBuy ? marketData.ask : marketData.bid;
        const slip = this.calculateMarketSlippage(intent.qty, marketData);
        const fillPrice = isBuy ? targetPrice * (1 + slip) : targetPrice * (1 - slip);
        
        orderState.isMaker = false; // Market orders are always taker
        
        await this.executeFill(orderState, fillPrice, intent.qty, true);
    }

    private async executeLimitOrder(orderState: OrderState, marketData: MarketRefs): Promise<void> {
        const intent = orderState.intent;
        const isBuy = intent.side === 'buy';
        const limitPrice = intent.price!;
        
        // Check if limit order can fill
        const canFill = isBuy ? limitPrice >= marketData.ask : limitPrice <= marketData.bid;
        
        if (canFill) {
            // Determine if maker or taker
            const isMaker = isBuy ? limitPrice < marketData.ask : limitPrice > marketData.bid;
            orderState.isMaker = isMaker;
            
            const fillPrice = isMaker ? limitPrice : (isBuy ? marketData.ask : marketData.bid);
            const fillQty = this.calculatePartialFillQty(orderState, marketData);
            
            await this.executeFill(orderState, fillPrice, fillQty, fillQty === orderState.remainingQty);
            
            // Schedule next fill if partial
            if (orderState.remainingQty > 0) {
                setTimeout(() => {
                    this.simulateExecution(orderState.orderId);
                }, this.calculateFillInterval());
            }
        } else {
            // Order remains pending, check again later
            setTimeout(() => {
                this.simulateExecution(orderState.orderId);
            }, this.calculateFillInterval());
        }
    }

    private async executePostOnlyOrder(orderState: OrderState, marketData: MarketRefs): Promise<void> {
        const intent = orderState.intent;
        const isBuy = intent.side === 'buy';
        const limitPrice = intent.price!;
        
        // Post-only orders only fill as maker
        const canFillAsMaker = isBuy ? limitPrice < marketData.ask : limitPrice > marketData.bid;
        
        if (canFillAsMaker && Math.random() < this.policy.makerQueueAdvantage) {
            orderState.isMaker = true;
            const fillQty = this.calculatePartialFillQty(orderState, marketData);
            
            await this.executeFill(orderState, limitPrice, fillQty, fillQty === orderState.remainingQty);
            
            if (orderState.remainingQty > 0) {
                setTimeout(() => {
                    this.simulateExecution(orderState.orderId);
                }, this.calculateFillInterval());
            }
        } else {
            // Wait for better opportunity
            setTimeout(() => {
                this.simulateExecution(orderState.orderId);
            }, this.calculateFillInterval());
        }
    }

    private async executeIcebergOrder(orderState: OrderState, marketData: MarketRefs): Promise<void> {
        if (!orderState.slices) return;
        
        // Find first revealed slice
        const revealedSlice = orderState.slices.find(s => s.revealed);
        if (!revealedSlice) return;
        
        // Execute as limit order for the revealed slice
        const tempIntent = { ...orderState.intent, qty: revealedSlice.qty, price: revealedSlice.price };
        const tempOrder = { ...orderState, intent: tempIntent, remainingQty: revealedSlice.qty };
        
        await this.executeLimitOrder(tempOrder, marketData);
        
        // If slice is filled, reveal next slice
        if (tempOrder.remainingQty === 0) {
            const nextSliceIndex = orderState.slices.findIndex(s => !s.revealed);
            if (nextSliceIndex >= 0) {
                orderState.slices[nextSliceIndex].revealed = true;
                setTimeout(() => {
                    this.simulateExecution(orderState.orderId);
                }, this.calculateFillInterval());
            } else {
                // All slices filled
                orderState.status = 'filled';
            }
        }
    }

    private async executeTwapOrder(orderState: OrderState, marketData: MarketRefs): Promise<void> {
        const intent = orderState.intent;
        const sliceQty = intent.qty / (intent.slices || 5);
        
        // Execute as market order for slice
        const tempIntent = { ...intent, qty: Math.min(sliceQty, orderState.remainingQty), mode: 'market' as const };
        const tempOrder = { ...orderState, intent: tempIntent };
        
        await this.executeMarketOrder(tempOrder, marketData);
        
        // Schedule next slice if remaining
        if (orderState.remainingQty > 0) {
            setTimeout(() => {
                this.simulateExecution(orderState.orderId);
            }, 5000); // 5 second intervals for TWAP
        }
    }

    private async executeFill(orderState: OrderState, fillPrice: number, fillQty: number, isFinal: boolean): Promise<void> {
        const intent = orderState.intent;
        const fees = this.fees.get(intent.symbol);
        const feeRate = orderState.isMaker ? (fees?.makerBps || 10) : (fees?.takerBps || 15);
        const feeUSD = (fillPrice * fillQty * feeRate) / 10000;
        
        // Update order state
        orderState.totalFilled += fillQty;
        orderState.remainingQty -= fillQty;
        orderState.avgFillPrice = ((orderState.avgFillPrice * (orderState.totalFilled - fillQty)) + (fillPrice * fillQty)) / orderState.totalFilled;
        orderState.lastFillTime = Date.now();
        
        if (isFinal || orderState.remainingQty <= 0) {
            orderState.status = 'filled';
            orderState.remainingQty = 0;
        } else {
            orderState.status = 'partial';
        }

        // Emit fill event
        const fillEvent: OrderFill = {
            event: isFinal ? 'order.fill.final' : 'order.fill.partial',
            timestamp: new Date().toISOString(),
            correlationId: intent.correlationId,
            orderId: orderState.orderId,
            fillId: `FILL-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            fillPrice,
            fillQty,
            remainingQty: orderState.remainingQty,
            side: intent.side,
            feeUSD,
            isMaker: orderState.isMaker
        };

        this.emit(fillEvent.event, fillEvent);

        // Update metrics
        this.metrics.totalFills++;
        if (orderState.isMaker) this.metrics.makerFills++;
        this.metrics.avgFillLatency = (this.metrics.avgFillLatency * (this.metrics.totalFills - 1) + 
                                     (Date.now() - orderState.submitTime)) / this.metrics.totalFills;

        // Calculate slippage for metrics
        const marketData = this.marketRefs.get(intent.symbol);
        if (marketData) {
            const expectedPrice = intent.side === 'buy' ? marketData.ask : marketData.bid;
            const slipBps = Math.abs(fillPrice - expectedPrice) / expectedPrice * 10000;
            this.metrics.totalSlipBps = (this.metrics.totalSlipBps * (this.metrics.totalFills - 1) + slipBps) / this.metrics.totalFills;
        }

        // Cleanup if final fill
        if (isFinal || orderState.remainingQty <= 0) {
            this.activeOrders.delete(orderState.orderId);
        }
    }

    private calculateMarketSlippage(qty: number, marketData: MarketRefs): number {
        const depthImpact = (qty * marketData.last) / this.config.queue.depthUSD;
        return depthImpact * this.config.slip.marketK;
    }

    private calculatePartialFillQty(orderState: OrderState, marketData: MarketRefs): number {
        // Simulate realistic partial fills based on order book depth
        const maxFillPct = 0.3 + Math.random() * 0.4; // 30-70% of remaining
        return Math.min(orderState.remainingQty, orderState.remainingQty * maxFillPct);
    }

    private calculateProcessingLatency(): number {
        return this.config.latency.baseMs + (Math.random() - 0.5) * this.config.latency.varianceMs;
    }

    private calculateFillInterval(): number {
        return this.config.queue.baseMs + Math.random() * this.config.queue.baseMs;
    }

    private checkPendingOrders(symbol: string): void {
        for (const [orderId, orderState] of this.activeOrders) {
            if (orderState.intent.symbol === symbol && orderState.status === 'pending') {
                setTimeout(() => {
                    this.simulateExecution(orderId);
                }, Math.random() * 100);
            }
        }
    }

    private estimateOrderCosts(intent: OrderIntent): OrderCostEstimate {
        const marketData = this.marketRefs.get(intent.symbol);
        const fees = this.fees.get(intent.symbol);
        
        if (!marketData) {
            return {
                event: 'order.costs.estimate',
                timestamp: new Date().toISOString(),
                correlationId: intent.correlationId,
                takerBp: 15,
                makerBp: 10,
                slipBps: 0,
                feeUSD: 0,
                expectedFillTime: 0
            };
        }

        const isBuy = intent.side === 'buy';
        const expectedPrice = intent.price || (isBuy ? marketData.ask : marketData.bid);
        const slip = intent.mode === 'market' ? this.calculateMarketSlippage(intent.qty, marketData) * 10000 : 0;
        
        const takerFee = fees?.takerBps || 15;
        const makerFee = fees?.makerBps || 10;
        const feeUSD = (expectedPrice * intent.qty * takerFee) / 10000;

        return {
            event: 'order.costs.estimate',
            timestamp: new Date().toISOString(),
            correlationId: intent.correlationId,
            takerBp: takerFee,
            makerBp: makerFee,
            slipBps: slip,
            feeUSD,
            expectedFillTime: this.estimateFillTime(intent)
        };
    }

    private estimateFillTime(intent: OrderIntent): number {
        switch (intent.mode) {
            case 'market': return this.config.latency.baseMs;
            case 'limit': return this.config.queue.baseMs * 2;
            case 'post_only': return this.config.queue.baseMs * 5;
            case 'iceberg': return this.config.queue.baseMs * (intent.slices || 5);
            case 'twap': return 5000 * (intent.slices || 5);
            default: return this.config.queue.baseMs;
        }
    }

    private async emitAck(correlationId: string, orderId: string, status: 'accepted' | 'rejected', reason?: string): Promise<void> {
        const ack: OrderAck = {
            event: 'order.ack',
            timestamp: new Date().toISOString(),
            correlationId,
            orderId,
            status,
            reason
        };

        this.emit('order.ack', ack);
    }

    private async emitReject(correlationId: string, reason: string, context?: any): Promise<void> {
        const reject: OrderReject = {
            event: 'order.reject',
            timestamp: new Date().toISOString(),
            correlationId,
            reason,
            context: context || {}
        };

        this.emit('order.reject', reject);
        this.metrics.totalRejects++;
    }

    private emitMetrics(): void {
        const totalFills = this.metrics.totalFills || 1;
        
        const metrics: EmulatorMetrics = {
            event: 'emulator.metrics',
            timestamp: new Date().toISOString(),
            fillLatencyMs: Math.round(this.metrics.avgFillLatency),
            partialsPerOrder: totalFills / Math.max(1, this.metrics.totalOrders - this.activeOrders.size),
            makerShare: this.metrics.makerFills / totalFills,
            avgSlipBps: Math.round(this.metrics.totalSlipBps),
            rejectRate: this.metrics.totalRejects / Math.max(1, this.metrics.totalOrders)
        };

        this.emit('emulator.metrics', metrics);

        // Reset counters for next window
        this.metrics = {
            totalOrders: 0,
            totalFills: 0,
            totalRejects: 0,
            avgFillLatency: 0,
            makerFills: 0,
            totalSlipBps: 0,
            windowStart: Date.now()
        };
    }

    /**
     * Get module status
     */
    getStatus(): any {
        return {
            name: 'ExecutionFillEmulator',
            initialized: this.isInitialized,
            activeOrders: this.activeOrders.size,
            marketDataSymbols: this.marketRefs.size,
            policy: this.policy,
            metrics: this.metrics
        };
    }

    async shutdown(): Promise<void> {
        try {
            this.logger.info('ExecutionFillEmulator shutting down...');
            
            // Cancel all active orders
            for (const [orderId, orderState] of this.activeOrders) {
                await this.emitReject(orderState.intent.correlationId, 'System shutdown');
            }
            
            this.activeOrders.clear();
            this.marketRefs.clear();
            this.orderbooks.clear();
            this.fees.clear();
            this.removeAllListeners();
            this.isInitialized = false;
            this.logger.info('ExecutionFillEmulator shutdown complete');
        } catch (error) {
            this.logger.error('ExecutionFillEmulator shutdown error:', error);
        }
    }
}

export default ExecutionFillEmulator;
