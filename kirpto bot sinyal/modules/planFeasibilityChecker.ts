/**
 * Plan Feasibility Checker - VIVO-06
 * Plan(lar)ın icra edilebilirliğini hızlı ve deterministik şekilde skorlar
 * Başarısızlıklara gerekçe ve otomatik düzeltme önerileri üretir
 */

import { EventEmitter } from 'events';

export type Level = "GREEN" | "AMBER" | "RED";
export type Sentinel = "NORMAL" | "SLOWDOWN" | "HALT_PARTIAL" | "CIRCUIT_BREAKER";
export type Posture = "RISK_ON" | "NEUTRAL" | "RISK_OFF";
export type Side = "BUY" | "SELL";
export type ChildType = "LIMIT" | "IOC" | "POST_ONLY" | "MARKET";
export type VariantId = "AGGR" | "BAL" | "CONSV";

export interface BaseExec {
    limitOffsetBps: number;
    twapMs: number;
    iceberg: number;
    childType: ChildType;
}

export interface VariantPlan {
    id: "A" | "B" | "C";
    title: string;
    variant?: VariantId;
    symbols: Array<Record<string, number>>; // {SYMBOL: notionalUsd}
    exec: BaseExec;
    notes?: string[];
}

export interface AnalyticsRow {
    expectedMovePct: number;
    R_multiple: number;
}

export type AnalyticsMap = Record<string, AnalyticsRow>;

export interface ExchangeRule {
    symbol: string;
    tickSize: number;
    stepSize: number;
    minNotional: number;
    percent?: {
        up: number;
        down: number;
        refMins?: number;
    };
    maxPositionQty?: number;
    status?: "TRADING" | "HALT" | "BREAK";
    permissions?: string[]; // ["SPOT", ...]
}

export interface BookTicker {
    symbol: string;
    bid: number;
    ask: number;
    mid: number;
    asOf: string;
    refPrice?: number;
}

export interface ExposureGate {
    decision: "ALLOW" | "TRIM" | "REDUCE_ONLY" | "DENY";
    allowedNotionalUsd?: number;
    currentPositionQty?: number;
}

export interface Balances {
    // hızlı kontrol için (opsiyonel) toplam kullanılabilir quote USD eşleniği
    freeQuoteUsd?: number;
}

export interface Policy {
    whitelist: string[];
    minTargetPct: number; // ≥4
}

export interface RiskState {
    level: Level;
    sentinel: Sentinel;
    posture: Posture;
}

export interface FeasInput {
    plans: VariantPlan[];                  // VIVO-01 veya VIVO-05'ten
    analytics: AnalyticsMap;
    rules: Record<string, ExchangeRule>;
    tickers: Record<string, BookTicker>;
    exposure: Record<string, ExposureGate>;
    balances?: Balances;
    policy: Policy;
    risk: RiskState;
}

export interface ItemFinding {
    type:
        | "WHITELIST" | "TARGET_PCT" | "SYMBOL_STATUS" | "PERMISSIONS"
        | "DENY" | "REDUCE_ONLY" | "TRIM"
        | "MIN_NOTIONAL" | "PERCENT_PRICE" | "MAX_POSITION" | "BALANCE"
        | "SENTINEL"
        | "OK";
    severity: "INFO" | "WARN" | "ERROR";
    message: string;
    quickFix?: string; // öneri metni
}

export interface SymbolFeas {
    symbol: string;
    requestedNotionalUsd: number;
    estimatedPrice: number;
    estimatedQty: number;
    score: number; // 0..100
    findings: ItemFinding[];
    adjustedNotionalUsd?: number; // TRIM sonrası
}

export interface PlanFeas {
    planId: "A" | "B" | "C";
    variant?: VariantId;
    score: number; // 0..100 (sembol skorlarının weighted avg'i)
    symbols: SymbolFeas[];
    summaryFindings: ItemFinding[];
    recommend?: "OK" | "ADJUST" | "REJECT";
}

export interface FeasOutput {
    asOf: string;
    overallScore: number;
    plans: PlanFeas[];
}

export interface StdError {
    code: string;
    message: string;
    details?: Record<string, unknown>;
    retriable?: boolean;
}

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

class PlanFeasibilityChecker extends EventEmitter {
    private ver = "1.0.0";
    private src = "VIVO-06";
    private logger: any;
    private isInitialized: boolean = false;

    constructor() {
        super();
    }

    async initialize(logger: any): Promise<boolean> {
        try {
            this.logger = logger;
            this.logger.info('PlanFeasibilityChecker initializing...');
            
            this.isInitialized = true;
            this.logger.info('PlanFeasibilityChecker initialized successfully');
            return true;
        } catch (error) {
            this.logger.error('PlanFeasibilityChecker initialization error:', error);
            return false;
        }
    }

    run(x: FeasInput): FeasOutput | { error: StdError } {
        if (!this.isInitialized) {
            return this.err("NOT_INITIALIZED", "Module not initialized");
        }

        try {
            const v = this.validate(x);
            if (v) return this.err("VALIDATION_ERROR", v);

            const plans: PlanFeas[] = x.plans.map(p => this.checkPlan(x, p));
            const overall = Math.round(plans.reduce((a, b) => a + b.score, 0) / Math.max(1, plans.length));

            const out: FeasOutput = {
                asOf: new Date().toISOString(),
                overallScore: overall,
                plans
            };

            this.emit('vivo.feasibility', out);
            return out;

        } catch (e: any) {
            return this.err("FEAS_FAILED", e?.message || "unknown", { stack: e?.stack });
        }
    }

    private checkPlan(x: FeasInput, plan: VariantPlan): PlanFeas {
        const symFeas: SymbolFeas[] = [];
        for (const o of plan.symbols) {
            const s = Object.keys(o)[0];
            const notional = Object.values(o)[0] as number;
            symFeas.push(this.checkSymbol(x, s, notional, plan));
        }

        // Plan skor: notional ağırlıklı ortalama
        const totalNotional = symFeas.reduce((a, b) => a + b.requestedNotionalUsd, 0) || 1;
        let score = 0;
        for (const f of symFeas) {
            score += f.score * (f.requestedNotionalUsd / totalNotional);
        }
        score = Math.round(score);

        // Özet bulgular
        const summary: ItemFinding[] = [];
        if (x.risk.sentinel !== "NORMAL") {
            summary.push({
                type: "SENTINEL",
                severity: "ERROR",
                message: `Sentinel=${x.risk.sentinel}; yeni açılışlar önerilmez`,
                quickFix: "PlanC / reduce-only"
            });
        }
        if (score < 60) {
            summary.push({
                type: "BALANCE",
                severity: "WARN",
                message: "Plan skoru düşük; parametreleri korumacı yap",
                quickFix: "TWAP+200ms, iceberg+0.02, POST_ONLY"
            });
        }

        const recommend = score >= 80 ? "OK" : score >= 60 ? "ADJUST" : "REJECT";

        return {
            planId: plan.id,
            variant: plan.variant,
            score,
            symbols: symFeas,
            summaryFindings: summary,
            recommend
        };
    }

    private checkSymbol(x: FeasInput, symbol: string, notionalUsd: number, plan: VariantPlan): SymbolFeas {
        const findings: ItemFinding[] = [];
        let score = 100;

        // whitelist / target
        if (!x.policy.whitelist.includes(symbol)) {
            findings.push({
                type: "WHITELIST",
                severity: "ERROR",
                message: `${symbol} whitelist dışı`
            });
            score -= 100;
        }

        const an = x.analytics[symbol];
        if (!an || an.expectedMovePct < x.policy.minTargetPct || (an.R_multiple ?? 0) < 1.2) {
            findings.push({
                type: "TARGET_PCT",
                severity: "ERROR",
                message: `${symbol} +%${x.policy.minTargetPct} hedefi/R threshold karşılanmıyor`
            });
            score -= 40;
        }

        // risk/sentinel
        if (x.risk.sentinel !== "NORMAL") {
            findings.push({
                type: "SENTINEL",
                severity: "ERROR",
                message: `Sentinel=${x.risk.sentinel}`,
                quickFix: "Yeni açılış yok; reduce-only"
            });
            score -= 40;
        }

        const rule: ExchangeRule | undefined = x.rules[symbol];
        const tk: BookTicker | undefined = x.tickers[symbol];
        if (!rule || !tk) {
            findings.push({
                type: "SYMBOL_STATUS",
                severity: "ERROR",
                message: "rule/ticker eksik"
            });
            return this.buildSym(symbol, notionalUsd, tk?.mid ?? 0, 0, score, findings);
        }

        if (rule.status && rule.status !== "TRADING") {
            findings.push({
                type: "SYMBOL_STATUS",
                severity: "ERROR",
                message: `status=${rule.status}`
            });
            score -= 100;
        }

        if (rule.permissions && !rule.permissions.includes("SPOT")) {
            findings.push({
                type: "PERMISSIONS",
                severity: "WARN",
                message: `permissions=${rule.permissions?.join(",")}`
            });
            score -= 5;
        }

        // exposure
        const gate = x.exposure[symbol];
        if (!gate || gate.decision === "DENY") {
            findings.push({
                type: "DENY",
                severity: "ERROR",
                message: "EXPOSURE=DENY"
            });
            score -= 100;
        } else if (gate.decision === "REDUCE_ONLY") {
            findings.push({
                type: "REDUCE_ONLY",
                severity: "ERROR",
                message: "EXPOSURE=REDUCE_ONLY",
                quickFix: "Yeni açılış yerine kapama/trim"
            });
            score -= 50;
        } else if (gate.decision === "TRIM" && gate.allowedNotionalUsd !== undefined && notionalUsd > gate.allowedNotionalUsd) {
            findings.push({
                type: "TRIM",
                severity: "WARN",
                message: `notional>${gate.allowedNotionalUsd}`,
                quickFix: `${gate.allowedNotionalUsd} USD'ye düşür`
            });
            score -= 15;
            notionalUsd = gate.allowedNotionalUsd; // değerlendirmeyi trimlenmiş notional ile sürdür
        }

        // fiyat/qty kaba tahmin (VIVO-02 kesinleştirir)
        const side: Side = "BUY";
        const px = this.targetPrice(side, plan.exec.childType, plan.exec.limitOffsetBps, tk, rule);
        const qty = Math.floor((notionalUsd / px) / rule.stepSize) * rule.stepSize;
        const notion = px * qty;

        // minNotional
        if (notion < rule.minNotional) {
            findings.push({
                type: "MIN_NOTIONAL",
                severity: "ERROR",
                message: `$${notion.toFixed(2)} < minNotional $${rule.minNotional}`,
                quickFix: `notional↑ veya sembol atla`
            });
            score -= 30;
        }

        // percent-price bandı (uyarı)
        if (rule.percent) {
            const ref = tk.refPrice ?? tk.mid;
            const lo = ref * rule.percent.down;
            const hi = ref * rule.percent.up;
            if (px < lo || px > hi) {
                findings.push({
                    type: "PERCENT_PRICE",
                    severity: "WARN",
                    message: "Fiyat percent-price bandı dışında",
                    quickFix: "offset bps ayarla / POST_ONLY"
                });
                score -= 10;
            }
        }

        // max position (opsiyonel)
        if (rule.maxPositionQty !== undefined && (gate?.currentPositionQty ?? 0) + qty > rule.maxPositionQty) {
            findings.push({
                type: "MAX_POSITION",
                severity: "ERROR",
                message: "MAX_POSITION aşımı",
                quickFix: "qty↓ / reduce-only"
            });
            score -= 40;
        }

        // bakiye (opsiyonel)
        if (x.balances?.freeQuoteUsd !== undefined && notionalUsd > x.balances.freeQuoteUsd) {
            findings.push({
                type: "BALANCE",
                severity: "WARN",
                message: "free quote yetersiz",
                quickFix: "notional↓ / PlanC spot/nakit"
            });
            score -= 20;
        }

        // POST_ONLY önerisi (çapraz risk)
        if (plan.exec.childType === "POST_ONLY") {
            // güvenli tarafta kal; bilgi amaçlı not
            findings.push({
                type: "OK",
                severity: "INFO",
                message: "POST_ONLY: cross risk düşük"
            });
        }

        score = clamp(score, 0, 100);
        return this.buildSym(symbol, notionalUsd, px, qty, score, findings);
    }

    private targetPrice(side: Side, type: ChildType, offsetBps: number, t: BookTicker, r: ExchangeRule): number {
        const ofs = (offsetBps || 0) / 10_000;
        let base = side === "BUY" ? t.ask * (1 + ofs) : t.bid * (1 - ofs);
        if (type === "POST_ONLY") {
            base = side === "BUY" ? t.bid * (1 - Math.max(ofs, 0.0001)) : t.ask * (1 + Math.max(ofs, 0.0001));
        }
        // tick'e yuvarla
        const price = Math.round(base / r.tickSize) * r.tickSize;
        return price;
    }

    private buildSym(
        symbol: string,
        req: number,
        px: number,
        qty: number,
        score: number,
        findings: ItemFinding[]
    ): SymbolFeas {
        return {
            symbol,
            requestedNotionalUsd: req,
            estimatedPrice: px,
            estimatedQty: qty,
            score,
            findings
        };
    }

    private validate(x: FeasInput): string | null {
        if (!x || !Array.isArray(x.plans) || x.plans.length === 0) return "plans missing";
        if (!x.policy || (x.policy.minTargetPct ?? 0) < 4) return "policy.minTargetPct must be ≥ 4";
        if (!x.rules || !x.tickers || !x.exposure) return "rules/tickers/exposure missing";
        if (!x.risk) return "risk missing";
        return null;
    }

    private err(code: string, message: string, details?: any): { error: StdError } {
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
            name: 'PlanFeasibilityChecker',
            version: this.ver,
            initialized: this.isInitialized
        };
    }

    async shutdown(): Promise<void> {
        try {
            this.logger?.info('PlanFeasibilityChecker shutting down...');
            this.removeAllListeners();
            this.isInitialized = false;
            this.logger?.info('PlanFeasibilityChecker shutdown complete');
        } catch (error) {
            this.logger?.error('PlanFeasibilityChecker shutdown error:', error);
        }
    }
}

export default PlanFeasibilityChecker;
