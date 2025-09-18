/**
 * Exec Guardrail Bridge - VIVO-08
 * VIVO-02'nin önerdiği ops.actions.proposed paketini feasibility/findings + sentinel + policy 
 * sinyallerine göre guardrail'lerden geçirip güvenli ops.actions olarak yayınlar
 */

import { EventEmitter } from 'events';

export type Sentinel = "NORMAL" | "SLOWDOWN" | "HALT_PARTIAL" | "CIRCUIT_BREAKER";
export type Level = "GREEN" | "AMBER" | "RED";
export type PlanId = "A" | "B" | "C";

export interface RiskState {
    level: Level;
    sentinel: Sentinel;
}

export interface ItemFinding {
    type: string;                 // "TRIM" | "REDUCE_ONLY" | "DENY" | "PERCENT_PRICE" | ...
    severity: "INFO" | "WARN" | "ERROR";
    message: string;
    quickFix?: string;
}

export interface SymbolFeas {
    symbol: string;
    requestedNotionalUsd: number;
    estimatedPrice: number;
    estimatedQty: number;
    score: number;                 // 0..100
    findings: ItemFinding[];
    adjustedNotionalUsd?: number;  // VIVO-06 önerisi
}

export interface PlanFeas {
    planId: PlanId;
    variant?: "AGGR" | "BAL" | "CONSV";
    score: number;
    symbols: SymbolFeas[];
    summaryFindings: ItemFinding[];
    recommend?: "OK" | "ADJUST" | "REJECT";
}

export interface FeasOutput {
    asOf: string;
    overallScore: number;
    plans: PlanFeas[];
}

export interface ActionChild {
    symbol: string;
    side: "BUY" | "SELL";
    type: "LIMIT" | "MARKET" | "POST_ONLY" | "IOC";
    price?: number;
    qty: number;
    reduceOnly?: boolean;
    postOnly?: boolean;
    meta?: {
        twapMs?: number;
        iceberg?: number;
        slice?: number;
        slices?: number;
        corrId?: string;
    };
}

export interface ActionBundle {
    asOf: string;
    planId: PlanId;
    corrId?: string;
    children: ActionChild[];
    comments?: string[];
}

export interface GuardrailConfig {
    twapBumpMs: number;          // SLOWDOWN/HIGH-RISK için eklenecek min TWAP (örn 200–400ms)
    icebergBump: number;         // 0.02–0.05 arası ek parça
    maxIceberg: number;          // 0.5
    notionalTrimRatio: number;   // TRIM uyarısında % kesinti (örn 0.85)
    enforcePostOnly: boolean;    // yavaşlama modunda post-only zorlansın mı?
}

export interface GuardrailReport {
    corrId?: string;
    planId: PlanId;
    before: ActionBundle;
    after: ActionBundle;
    changes: string[];           // insan-okur özet
    blockedSymbols: string[];    // tamamen engellenen semboller
    mode: "NORMAL" | "SLOWDOWN" | "REDUCE_ONLY";
}

export interface ExecGuardrailInput {
    risk: RiskState;
    feas: FeasOutput;
    proposed: ActionBundle;      // VIVO-02 üretti
    cfg?: Partial<GuardrailConfig>;
}

export interface StdError {
    code: string;
    message: string;
    details?: Record<string, unknown>;
    retriable?: boolean;
}

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

class ExecGuardrailBridge extends EventEmitter {
    private ver = "1.0.0";
    private src = "VIVO-08";
    private logger: any;
    private isInitialized: boolean = false;
    private feas: FeasOutput | null = null;
    private lastRisk: RiskState | null = null;
    private seenCorr = new Set<string>();
    private cfg: GuardrailConfig = {
        twapBumpMs: 300,
        icebergBump: 0.03,
        maxIceberg: 0.5,
        notionalTrimRatio: 0.85,
        enforcePostOnly: true
    };

    constructor() {
        super();
    }

    async initialize(logger: any): Promise<boolean> {
        try {
            this.logger = logger;
            this.logger.info('ExecGuardrailBridge initializing...');
            
            this.setupEventListeners();
            
            this.isInitialized = true;
            this.logger.info('ExecGuardrailBridge initialized successfully');
            return true;
        } catch (error) {
            this.logger.error('ExecGuardrailBridge initialization error:', error);
            return false;
        }
    }

    private setupEventListeners(): void {
        this.on('vivo.feasibility', (f: FeasOutput) => { this.feas = f; });
        this.on('risk.state', (r: RiskState) => { this.lastRisk = r; });
        this.on('ops.actions.proposed', (ab: ActionBundle) => this.safeGuard({
            risk: this.lastRisk!,
            feas: this.feas!,
            proposed: ab
        }));
    }

    /** Dışarıdan manuel tetikleme için */
    safeGuard(x: ExecGuardrailInput): void {
        const res = this.run(x);
        if ("error" in (res as any)) {
            this.logger.error(res, "VIVO-08 guard failed");
            this.emit('audit.log', {
                asOf: new Date().toISOString(),
                ver: this.ver,
                src: this.src,
                payload: { error: res }
            });
        } else {
            const rep = res as GuardrailReport;
            this.emit('ops.actions', rep.after);
            this.emit('ops.guardrail.report', rep);
            this.emit('audit.log', {
                asOf: new Date().toISOString(),
                ver: this.ver,
                src: this.src,
                payload: {
                    corrId: rep.corrId,
                    mode: rep.mode,
                    changes: rep.changes.slice(0, 6)
                }
            });
        }
    }

    run(x: ExecGuardrailInput): GuardrailReport | { error: StdError } {
        if (!this.isInitialized) {
            return this.err("NOT_INITIALIZED", "Module not initialized");
        }

        try {
            const v = this.validate(x);
            if (v) return this.err("VALIDATION_ERROR", v);
            
            const corr = x.proposed.corrId ?? `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            if (this.seenCorr.has(corr)) {
                return this.err("IDEMPOTENT", "corrId already processed", { corrId: corr });
            }

            const before = this.deepClone(x.proposed);
            const after: ActionBundle = this.deepClone(x.proposed);

            const planFeas = this.pickPlanFeas(x.feas, after.planId);
            const mode = this.applyGuards(after, planFeas, x);
            this.seenCorr.add(corr);

            return {
                corrId: corr,
                planId: after.planId,
                before,
                after,
                changes: this.diffSummary(before, after),
                blockedSymbols: this.getBlockedSymbols(after, before),
                mode
            };

        } catch (e: any) {
            return this.err("GUARD_FAILED", e?.message || "unknown", { stack: e?.stack });
        }
    }

    private applyGuards(
        after: ActionBundle,
        pf: PlanFeas | null,
        x: ExecGuardrailInput
    ): "NORMAL" | "SLOWDOWN" | "REDUCE_ONLY" {
        const risk = x.risk;
        let mode: "NORMAL" | "SLOWDOWN" | "REDUCE_ONLY" = "NORMAL";

        // 0) Sentinel sert kurallar
        if (risk.sentinel === "CIRCUIT_BREAKER" || risk.sentinel === "HALT_PARTIAL") {
            mode = "REDUCE_ONLY";
            // yeni açılışları kaldır; kalanları reduce-only'a çevir
            after.children = after.children.filter(c => c.reduceOnly || c.side === "SELL"); // BUY açılışı at
            for (const c of after.children) {
                c.reduceOnly = true;
                c.postOnly = true;
                if (c.type === "LIMIT") c.type = "POST_ONLY";
            }
            return mode;
        }
        
        if (risk.sentinel === "SLOWDOWN") {
            mode = "SLOWDOWN";
            for (const c of after.children) {
                if (this.cfg.enforcePostOnly) {
                    c.postOnly = true;
                    if (c.type === "LIMIT") c.type = "POST_ONLY";
                }
                c.meta = c.meta || {};
                c.meta.twapMs = (c.meta.twapMs ?? 0) + this.cfg.twapBumpMs;
                c.meta.iceberg = clamp(
                    (c.meta.iceberg ?? 0.1) + this.cfg.icebergBump,
                    0.05,
                    this.cfg.maxIceberg
                );
            }
        }

        // 1) Feasibility bulguları
        if (pf) {
            // Sembol bazlı quick-fix
            for (const sym of pf.symbols) {
                const has = (t: string) => sym.findings.some(f => f.type === t);
                const hardDeny = has("DENY") || has("WHITELIST") || has("TARGET_PCT") || 
                                has("SYMBOL_STATUS") || has("REDUCE_ONLY");
                const warnTrim = has("TRIM");
                const warnBand = has("PERCENT_PRICE");
                const minNotionalErr = has("MIN_NOTIONAL");

                for (const c of after.children.filter(c => c.symbol === sym.symbol)) {
                    if (hardDeny) {
                        // yeni girişleri kaldır; reduce-only varsa bırak
                        if (!c.reduceOnly) {
                            c.qty = 0; // VIVO-02 kuantize ederken 0'ları drop edecek
                        }
                        c.postOnly = true;
                    } else {
                        // quick-fix'ler
                        if (warnTrim) {
                            c.qty = c.qty * this.cfg.notionalTrimRatio; // notional ~ qty * price
                        }
                        if (warnBand) {
                            c.postOnly = true;
                            c.meta = c.meta || {};
                            c.meta.twapMs = (c.meta.twapMs ?? 0) + Math.floor(this.cfg.twapBumpMs / 2);
                        }
                        if (minNotionalErr) {
                            // minNotional fail: güvenli tarafta sembolü kaldırıyoruz (iyimserliği önle)
                            c.qty = 0;
                        }
                    }
                }
            }

            // Plan önerisi "REJECT" ise varsayılan konservatif: yalnız reduce-only bırak
            if (pf.recommend === "REJECT") {
                mode = mode === "SLOWDOWN" ? "SLOWDOWN" : "REDUCE_ONLY";
                after.children = after.children.filter(c => c.reduceOnly || c.side === "SELL");
                for (const c of after.children) {
                    c.reduceOnly = true;
                    c.postOnly = true;
                    if (c.type === "LIMIT") c.type = "POST_ONLY";
                }
            }
        }

        // 2) Temizlik: qty<=0 olanları at
        after.children = after.children.filter(c => (c.qty ?? 0) > 0);

        return mode;
    }

    private pickPlanFeas(feas: FeasOutput, planId: PlanId): PlanFeas | null {
        if (!feas?.plans?.length) return null;
        const arr = feas.plans.filter(p => p.planId === planId);
        if (!arr.length) return null;
        // en yüksek skorlu varyantı seç
        return arr.sort((a, b) => b.score - a.score)[0];
    }

    private validate(x: ExecGuardrailInput): string | null {
        if (!x?.proposed || !Array.isArray(x.proposed.children)) {
            return "proposed actions missing/invalid";
        }
        if (!x?.risk) return "risk state missing";
        if (!x?.feas || !Array.isArray(x.feas.plans)) return "feas missing";
        return null;
    }

    // ------- yardımcılar
    private deepClone<T>(o: T): T {
        return JSON.parse(JSON.stringify(o));
    }

    private diffSummary(a: ActionBundle, b: ActionBundle): string[] {
        const lines: string[] = [];
        const key = (c: ActionChild) => `${c.symbol}:${c.side}:${c.type}`;
        const idxA = new Map(a.children.map((c, i) => [key(c), { i, c }]));
        const idxB = new Map(b.children.map((c, i) => [key(c), { i, c }]));
        
        for (const [k, { c }] of idxA) {
            if (!idxB.has(k)) lines.push(`DROP ${k}`);
        }
        
        for (const [k, { c }] of idxB) {
            if (!idxA.has(k)) {
                lines.push(`ADD ${k} qty=${c.qty}`);
                continue;
            }
            const prev = idxA.get(k)!.c;
            if ((prev.qty ?? 0) !== (c.qty ?? 0)) lines.push(`QTY ${k}: ${prev.qty}→${c.qty}`);
            if (!!prev.postOnly !== !!c.postOnly) lines.push(`POST_ONLY ${k}: ${!!prev.postOnly}→${!!c.postOnly}`);
            if (!!prev.reduceOnly !== !!c.reduceOnly) lines.push(`REDUCE_ONLY ${k}: ${!!prev.reduceOnly}→${!!c.reduceOnly}`);
            
            const pT = prev.meta?.twapMs ?? 0, nT = c.meta?.twapMs ?? 0;
            if (pT !== nT) lines.push(`TWAP ${k}: ${pT}→${nT}`);
            
            const pI = prev.meta?.iceberg ?? 0, nI = c.meta?.iceberg ?? 0;
            if (pI !== nI) lines.push(`ICEBERG ${k}: ${pI}→${nI}`);
        }
        return lines.slice(0, 20);
    }

    private getBlockedSymbols(after: ActionBundle, before: ActionBundle): string[] {
        const setB = new Set(before.children.map(c => c.symbol + ":" + c.side));
        const setA = new Set(after.children.map(c => c.symbol + ":" + c.side));
        return [...setB]
            .filter(k => !setA.has(k))
            .slice(0, 20)
            .map(s => s.split(":")[0]);
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
            name: 'ExecGuardrailBridge',
            version: this.ver,
            initialized: this.isInitialized,
            processedActions: this.seenCorr.size,
            config: this.cfg,
            lastRiskState: this.lastRisk,
            hasFeasibilityData: !!this.feas
        };
    }

    async shutdown(): Promise<void> {
        try {
            this.logger?.info('ExecGuardrailBridge shutting down...');
            this.seenCorr.clear();
            this.feas = null;
            this.lastRisk = null;
            this.removeAllListeners();
            this.isInitialized = false;
            this.logger?.info('ExecGuardrailBridge shutdown complete');
        } catch (error) {
            this.logger?.error('ExecGuardrailBridge shutdown error:', error);
        }
    }
}

export default ExecGuardrailBridge;
