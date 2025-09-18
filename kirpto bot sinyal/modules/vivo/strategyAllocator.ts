/**
 * Strategy Allocator - VIVO-02
 * VIVO-01'den gelen Plan A/B/C'yi borsa kuralları ve RiskNet kapıları ile uyuşacak şekilde
 * notional→fiyat→miktar kuantizasyonu yaparak icra edilebilir emir paketlerine dönüştürür
 */

import { EventEmitter } from 'events';

export type Side = "BUY" | "SELL";
export type ChildType = "LIMIT" | "IOC" | "POST_ONLY" | "MARKET";

export interface ExchangeRule {
    symbol: string;
    tickSize: number;     // PRICE_FILTER
    stepSize: number;     // LOT_SIZE
    minNotional: number;  // (MIN_)NOTIONAL
    percent?: {           // PERCENT_PRICE / BY_SIDE (opsiyonel)
        bidUp?: number; 
        bidDown?: number; 
        askUp?: number; 
        askDown?: number; 
        avgPriceMins?: number;
    };
}

export interface BookTicker {
    symbol: string;
    bid: number; 
    ask: number; 
    mid: number;
    asOf: string;
}

export interface ExposureGate {
    decision: "ALLOW" | "TRIM" | "REDUCE_ONLY" | "DENY";
    allowedNotionalUsd?: number;
    maxPositionQty?: number; // opsiyonel üst sınır
}

export interface ExecParams {
    limitOffsetBps: number;     // ör: 6
    twapMs: number;             // ör: 1400
    iceberg: number;            // [0..1] çocuk miktar oranı
    childType: ChildType;       // LIMIT/IOC/POST_ONLY/MARKET
}

export interface PlanSymbol {
    symbol: string;
    notionalUsd: number;
    side?: Side;                // yoksa varsayılan BUY
}

export interface PlanIn {
    id: "A" | "B" | "C";
    title: string;
    symbols: PlanSymbol[];
    exec: ExecParams;
    notes?: string[];
}

export interface AllocatorInput {
    plan: PlanIn;
    whitelist: string[];
    minTargetPct: number;         // ≥4 (savunma amaçlı tekrar doğrula)
    sentiment?: "NORMAL" | "SLOWDOWN" | "HALT_PARTIAL" | "CIRCUIT_BREAKER";
    exposure: Record<string, ExposureGate>;
    rules: Record<string, ExchangeRule>;
    tickers: Record<string, BookTicker>;
}

export interface ChildOrder {
    symbol: string;
    side: Side;
    type: ChildType;
    price?: number;               // MARKET/IOC için opsiyonel
    qty: number;
    tif?: "GTC" | "IOC" | "FOK";
    postOnly?: boolean;           // LIMIT_MAKER güvenliği için
    reduceOnly?: boolean;         // sentinel/position düşürme
    meta?: { 
        twapMs?: number; 
        iceberg?: number; 
        corrId?: string; 
    };
}

export interface ActionBundle {
    asOf: string;
    planId: "A" | "B" | "C";
    children: ChildOrder[];
    comments?: string[];
}

export interface AllocError { 
    code: string; 
    message: string; 
    details?: Record<string, unknown>; 
    retriable?: boolean; 
}

class StrategyAllocator extends EventEmitter {
    private ver = "1.0.0";
    private src = "VIVO-02";
    private logger: any;
    private isInitialized: boolean = false;

    constructor() {
        super();
    }

    async initialize(logger: any): Promise<boolean> {
        try {
            this.logger = logger;
            this.logger.info('StrategyAllocator initializing...');
            
            this.isInitialized = true;
            this.logger.info('StrategyAllocator initialized successfully');
            return true;
        } catch (error) {
            this.logger.error('StrategyAllocator initialization error:', error);
            return false;
        }
    }

    run(x: AllocatorInput): ActionBundle | { error: AllocError } {
        if (!this.isInitialized) {
            return this.err("NOT_INITIALIZED", "Module not initialized");
        }

        try {
            const v = this.validate(x); 
            if (v) return this.err("VALIDATION_ERROR", v);

            // Sentinel → reduce-only
            const reduceOnly = Boolean(x.sentiment && x.sentiment !== "NORMAL");

            const children: ChildOrder[] = [];
            for (const ps of x.plan.symbols) {
                const sym = ps.symbol.toUpperCase();
                if (!x.whitelist.includes(sym)) { 
                    this.logger.warn({ sym }, "non-whitelist skipped"); 
                    continue; 
                }

                const gate = x.exposure[sym];
                if (!gate || gate.decision === "DENY") { 
                    this.logger.warn({ sym }, "exposure deny"); 
                    continue; 
                }
                if (gate.decision === "REDUCE_ONLY" && !reduceOnly) {
                    // Plan long açmaya çalışıyorsa engelle; reduce-only ise sadece kapama/trim yapılmalı
                    this.logger.warn({ sym }, "exposure reduce-only blocks new opens"); 
                    continue;
                }

                const rules = x.rules[sym];  
                if (!rules) { 
                    this.logger.warn({ sym }, "missing rules"); 
                    continue; 
                }
                const tk = x.tickers[sym];   
                if (!tk || tk.bid <= 0 || tk.ask <= 0) { 
                    this.logger.warn({ sym }, "missing ticker"); 
                    continue; 
                }

                // Notional → price/qty kuantizasyonu
                const side: Side = ps.side ?? "BUY";
                const px = this.targetPrice(side, x.plan.exec.childType, x.plan.exec.limitOffsetBps, tk);
                const { price, qty, reason } = this.quantize(sym, side, px, ps.notionalUsd, rules);

                if (qty <= 0 || !Number.isFinite(price!)) { 
                    this.logger.warn({ sym, reason }, "quantize failed"); 
                    continue; 
                }

                // Exposure TRIM: notional üst sınırı geçilmesin
                if (gate.decision === "TRIM" && gate.allowedNotionalUsd && ps.notionalUsd > gate.allowedNotionalUsd) {
                    const scale = Math.max(0, gate.allowedNotionalUsd / ps.notionalUsd);
                    const adjQty = this.roundQty(qty * scale, rules.stepSize);
                    if (adjQty <= 0) { 
                        this.logger.warn({ sym }, "trim→zero qty"); 
                        continue; 
                    }
                    children.push(this.child(sym, side, x.plan.exec.childType, price!, adjQty, reduceOnly, x.plan.exec));
                    continue;
                }

                children.push(this.child(sym, side, x.plan.exec.childType, price!, qty, reduceOnly, x.plan.exec));
            }

            const bundle: ActionBundle = { 
                asOf: new Date().toISOString(), 
                planId: x.plan.id, 
                children, 
                comments: x.plan.notes ?? [] 
            };
            
            this.emit('ops.actions', bundle);
            return bundle;

        } catch (e: any) {
            return this.err("ALLOCATOR_FAILED", e?.message || "unknown", { stack: e?.stack });
        }
    }

    // --- Validasyon ---
    private validate(x: AllocatorInput): string | null {
        if (!x.plan || !Array.isArray(x.plan.symbols) || x.plan.symbols.length === 0) return "empty plan";
        if (!Array.isArray(x.whitelist) || x.whitelist.length === 0) return "empty whitelist";
        if ((x.minTargetPct ?? 0) < 4) return "minTargetPct must be ≥4";
        if (!x.rules || !x.tickers) return "missing rules/tickers";
        return null;
    }

    // --- Fiyat hedefi ---
    private targetPrice(side: Side, type: ChildType, offsetBps: number, t: BookTicker): number {
        const ofs = (offsetBps || 0) / 10_000;
        if (type === "MARKET") return side === "BUY" ? t.ask : t.bid;
        if (type === "IOC") return side === "BUY" ? t.ask * (1 + ofs) : t.bid * (1 - ofs);
        if (type === "POST_ONLY") return side === "BUY" ? t.bid * (1 - Math.max(ofs, 0.0001)) : t.ask * (1 + Math.max(ofs, 0.0001));
        // LIMIT
        return side === "BUY" ? t.ask * (1 + ofs) : t.bid * (1 - ofs);
    }

    // --- Kuantizasyon & filtreler ---
    private quantize(symbol: string, side: Side, rawPx: number, notionalUsd: number, r: ExchangeRule) {
        // PRICE_FILTER (tick) → price
        const price = this.roundPrice(rawPx, r.tickSize);
        // NOTIONAL
        const qty0 = notionalUsd / price;
        // LOT_SIZE (step)
        const qty = this.roundQty(qty0, r.stepSize);
        // MIN_NOTIONAL
        const notion = price * qty;
        if (notion < r.minNotional) {
            return { price, qty: 0, reason: `minNotional ${notion.toFixed(2)} < ${r.minNotional}` };
        }
        // PERCENT_PRICE_BY_SIDE (opsiyonel, fail-safe clamp)
        if (r.percent) {
            const up = side === "BUY" ? (r.percent.bidUp ?? r.percent.askUp) : (r.percent.askUp ?? r.percent.bidUp);
            const down = side === "BUY" ? (r.percent.bidDown ?? r.percent.askDown) : (r.percent.askDown ?? r.percent.bidDown);
            // Burada yalnızca uyarı üret; gerçek clamp için book ortalamasına ihtiyaç var (upper/lower bound)
            // (Üst katmanda engine reddederse fallback yapılır)
        }
        return { price, qty, reason: "ok" };
    }

    private roundPrice(x: number, tick: number) { 
        return Math.round(x / tick) * tick; 
    }
    
    private roundQty(x: number, step: number) { 
        return Math.floor(x / step) * step; 
    }

    private child(
        symbol: string, 
        side: Side, 
        type: ChildType, 
        price: number, 
        qty: number, 
        reduceOnly: boolean, 
        exec: any
    ): ChildOrder {
        const tif = type === "IOC" ? "IOC" : "GTC";
        const postOnly = (type === "POST_ONLY");
        return { 
            symbol, 
            side, 
            type, 
            price, 
            qty, 
            tif, 
            postOnly, 
            reduceOnly, 
            meta: { 
                twapMs: exec.twapMs, 
                iceberg: exec.iceberg 
            } 
        };
    }

    // --- Hata ---
    private err(code: string, message: string, details?: any): { error: AllocError } {
        const e = { code, message, details, retriable: false };
        this.logger?.error({ code, details }, message);
        this.emit('audit.log', { 
            asOf: new Date().toISOString(), 
            ver: this.ver, 
            src: this.src, 
            payload: { error: e } 
        });
        return { error: e };
    }

    /**
     * Get module status
     */
    getStatus(): any {
        return {
            name: 'StrategyAllocator',
            version: this.ver,
            initialized: this.isInitialized
        };
    }

    async shutdown(): Promise<void> {
        try {
            this.logger?.info('StrategyAllocator shutting down...');
            this.removeAllListeners();
            this.isInitialized = false;
            this.logger?.info('StrategyAllocator shutdown complete');
        } catch (error) {
            this.logger?.error('StrategyAllocator shutdown error:', error);
        }
    }
}

export default StrategyAllocator;
