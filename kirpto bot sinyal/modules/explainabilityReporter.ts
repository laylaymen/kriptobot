/**
 * Explainability Reporter - VIVO-07
 * Seçilen plan/varyantın neden seçildiğini, hangi kriterleri geçtiğini,
 * alternatiflerin neden elendiğini operatöre ve log sistemine açıklar
 */

import { EventEmitter } from 'events';

export type ISODate = string;
export type Posture = "RISK_ON" | "NEUTRAL" | "RISK_OFF";
export type Sentinel = "NORMAL" | "SLOWDOWN" | "HALT_PARTIAL" | "CIRCUIT_BREAKER";
export type VariantId = "AGGR" | "BAL" | "CONSV";
export type PlanId = "A" | "B" | "C";

export interface MemorySnapshot {
    asOf: ISODate;
    postureWeights: Record<Posture, number>;
    planWeights: Record<PlanId, number>;
    defaults: { defaultPlan: PlanId };
}

export interface VariantPlan {
    id: PlanId;
    title: string;
    variant?: VariantId;
    symbols: Array<Record<string, number>>; // {SYMBOL: notionalUsd}
    exec: {
        limitOffsetBps: number;
        twapMs: number;
        iceberg: number;
        childType: "LIMIT" | "IOC" | "POST_ONLY" | "MARKET";
    };
    riskHints?: string[];
    notes?: string[];
}

export interface VariantOutput {
    asOf: ISODate;
    variants: Record<PlanId, VariantPlan[]>;
}

export interface ItemFinding {
    type: string;     // "WHITELIST"|"TARGET_PCT"|... (VIVO-06)
    severity: "INFO" | "WARN" | "ERROR";
    message: string;
    quickFix?: string;
}

export interface SymbolFeas {
    symbol: string;
    requestedNotionalUsd: number;
    estimatedPrice: number;
    estimatedQty: number;
    score: number;             // 0..100
    findings: ItemFinding[];
}

export interface PlanFeas {
    planId: PlanId;
    variant?: VariantId;
    score: number;             // plan feasibility score 0..100
    symbols: SymbolFeas[];
    summaryFindings: ItemFinding[];
    recommend?: "OK" | "ADJUST" | "REJECT";
}

export interface FeasOutput {
    asOf: ISODate;
    overallScore: number;
    plans: PlanFeas[];
}

export interface OperatorResult {
    corrId?: string;
    selectedPlanId: PlanId;
    confirmations: Record<number, string>;  // 0: plan seçimi, 1: +%4 onayı vb.
    decidedBy: "OPERATOR" | "TIMEOUT_DEFAULT";
    decidedAt: ISODate;
}

export interface ActionBundle {
    asOf: ISODate;
    planId: PlanId;
    children: Array<{
        symbol: string;
        side: "BUY" | "SELL";
        type: string;
        price?: number;
        qty: number;
        reduceOnly?: boolean;
        postOnly?: boolean;
        meta?: {
            twapMs?: number;
            slice?: number;
            slices?: number;
            iceberg?: number;
            corrId?: string;
        };
    }>;
    comments?: string[];
}

// Rapor biçimi
export interface ExplainNode {
    label: string;
    value?: string | number;
    children?: ExplainNode[];
    severity?: "INFO" | "WARN" | "ERROR";
}

export interface ExplainCard {
    corrId: string;
    asOf: ISODate;
    header: {
        posture: Posture;
        sentinel: Sentinel;
        decidedBy: "OPERATOR" | "TIMEOUT_DEFAULT";
        selected: { planId: PlanId; variant?: VariantId; title?: string };
    };
    weights: {
        posture: Record<Posture, number>;
        plans: Record<PlanId, number>;
        defaultPlan: PlanId;
    };
    feasibility: {
        selectedScore: number;
        altScores: Array<{ planId: PlanId; variant?: VariantId; score: number }>;
        topFindings: ItemFinding[];
    };
    policyCompliance: ExplainNode[];   // whitelist / +%4 / exposure vs.
    execSummary?: {
        childCount: number;
        reduceOnlyRatio: number;
        postOnlyCount: number;
        notionalUsd: number;
    };
    whyTree: ExplainNode[];            // "neden seçildi?" ağacı
    nextSteps: string[];               // quick-fix / operatör aksiyonları
}

export interface ReporterInput {
    corrId: string;
    posture: Posture;
    sentinel: Sentinel;
}

export interface StdError {
    code: string;
    message: string;
    details?: Record<string, unknown>;
    retriable?: boolean;
}

class ExplainabilityReporter extends EventEmitter {
    private ver = "1.0.0";
    private src = "VIVO-07";
    private logger: any;
    private isInitialized: boolean = false;
    private seen = new Set<string>();
    private memory: MemorySnapshot | null = null;
    private variants: VariantOutput | null = null;
    private feas: FeasOutput | null = null;
    private lastSelection: OperatorResult | null = null;
    private lastActions: ActionBundle | null = null;

    constructor() {
        super();
    }

    async initialize(logger: any): Promise<boolean> {
        try {
            this.logger = logger;
            this.logger.info('ExplainabilityReporter initializing...');
            
            // Event listeners for data collection
            this.setupEventListeners();
            
            this.isInitialized = true;
            this.logger.info('ExplainabilityReporter initialized successfully');
            return true;
        } catch (error) {
            this.logger.error('ExplainabilityReporter initialization error:', error);
            return false;
        }
    }

    private setupEventListeners(): void {
        // Listen for data from other VIVO modules
        this.on('vivo.memory', (m: MemorySnapshot) => { this.memory = m; });
        this.on('vivo.variants', (v: VariantOutput) => { this.variants = v; });
        this.on('vivo.feasibility', (f: FeasOutput) => { this.feas = f; });
        this.on('vivo.operator.result', (r: OperatorResult) => { this.lastSelection = r; });
        this.on('ops.actions', (a: ActionBundle) => { this.lastActions = a; });
        this.on('vivo.explain.request', (req: ReporterInput) => this.safeBuild(req));
    }

    private safeBuild(req: ReporterInput): void {
        const res = this.build(req);
        if ("error" in (res as any)) {
            this.logger.error(res, "VIVO-07 build failed");
        } else {
            const card = res as ExplainCard;
            this.emit('vivo.explain.card', card);
            this.emit('audit.log', {
                asOf: card.asOf,
                ver: this.ver,
                src: this.src,
                payload: {
                    corrId: card.corrId,
                    selected: card.header.selected,
                    score: card.feasibility.selectedScore
                }
            });
        }
    }

    build(req: ReporterInput): ExplainCard | { error: StdError } {
        if (!this.isInitialized) {
            return this.err("NOT_INITIALIZED", "Module not initialized");
        }

        try {
            if (!req?.corrId) return this.err("VALIDATION_ERROR", "corrId missing");
            if (this.seen.has(req.corrId)) {
                return this.err("IDEMPOTENT", "corrId already explained", { corrId: req.corrId });
            }
            if (!this.memory || !this.variants || !this.feas || !this.lastSelection) {
                return this.err("STATE_MISSING", "memory/variants/feas/selection missing");
            }

            const selectedPlanId = this.lastSelection.selectedPlanId;
            const selVar = this.pickSelectedVariant(selectedPlanId);
            const feasSel = this.pickFeas(selectedPlanId, selVar?.variant);

            const card: ExplainCard = {
                corrId: req.corrId,
                asOf: new Date().toISOString(),
                header: {
                    posture: req.posture,
                    sentinel: req.sentinel,
                    decidedBy: this.lastSelection.decidedBy,
                    selected: {
                        planId: selectedPlanId,
                        variant: selVar?.variant,
                        title: selVar?.title
                    }
                },
                weights: {
                    posture: this.memory.postureWeights,
                    plans: this.memory.planWeights,
                    defaultPlan: this.memory.defaults.defaultPlan
                },
                feasibility: {
                    selectedScore: feasSel?.score ?? 0,
                    altScores: this.altScores(feasSel),
                    topFindings: this.topFindings(feasSel)
                },
                policyCompliance: this.policyNodes(selVar, feasSel),
                execSummary: this.execSummary(this.lastActions, selectedPlanId),
                whyTree: this.buildWhyTree(selVar, feasSel),
                nextSteps: this.suggestNext(selVar, feasSel, req.sentinel)
            };

            this.seen.add(req.corrId);
            return card;

        } catch (e: any) {
            return this.err("EXPLAIN_FAILED", e?.message || "unknown", { stack: e?.stack });
        }
    }

    // --- yardımcılar ---
    private pickSelectedVariant(planId: PlanId): VariantPlan | null {
        const arr = this.variants?.variants?.[planId] ?? [];
        // Operatör kartında varyant seçimi ayrıysa burada default: en yüksek feasibility skoru
        const bestFeas = this.feas?.plans
            ?.filter(p => p.planId === planId)
            .sort((a, b) => b.score - a.score)[0];
        if (bestFeas) {
            const vp = arr.find(v => v.variant === bestFeas.variant) || arr[0] || null;
            return vp || null;
        }
        return arr[0] || null;
    }

    private pickFeas(planId: PlanId, variant?: string | undefined | null): PlanFeas | null {
        const arr = this.feas?.plans?.filter(p => p.planId === planId) ?? [];
        if (!arr.length) return null;
        if (variant) return arr.find(p => p.variant === variant) || arr[0];
        return arr[0];
    }

    private altScores(sel: PlanFeas | null): Array<{
        planId: PlanId;
        variant?: VariantId;
        score: number;
    }> {
        if (!this.feas?.plans) return [];
        return this.feas.plans
            .filter(p => !sel || p !== sel)
            .map(p => ({ planId: p.planId, variant: p.variant, score: p.score }))
            .sort((a, b) => b.score - a.score)
            .slice(0, 4);
    }

    private topFindings(sel: PlanFeas | null): ItemFinding[] {
        if (!sel) return [];
        const combine = [...(sel.summaryFindings || [])];
        for (const s of sel.symbols) {
            const crit = s.findings.filter(f => f.severity !== "INFO");
            combine.push(...crit);
        }
        // Önce ERROR, sonra WARN; ilk 6
        return combine.sort((a, b) => {
            const rank = (x: ItemFinding) => x.severity === "ERROR" ? 2 : x.severity === "WARN" ? 1 : 0;
            return rank(b) - rank(a);
        }).slice(0, 6);
    }

    private policyNodes(vp: VariantPlan | null, sel: PlanFeas | null): ExplainNode[] {
        const out: ExplainNode[] = [];
        if (!vp || !sel) return out;

        const symSet = new Set(vp.symbols.map(o => Object.keys(o)[0]));
        // Whitelist/+%4 filtreleri VIVO-05 & VIVO-06'da uygulanmıştı; buradan özetleyelim:
        const rejected = this.feas?.plans
            .filter(p => p.planId === vp.id && p.variant === vp.variant)
            .flatMap(p => p.symbols)
            .filter(s => s.findings.some(f => f.type === "WHITELIST" || f.type === "TARGET_PCT")) || [];

        if (rejected.length) {
            out.push({
                label: "Politika Uyum Özeti",
                children: [
                    {
                        label: "Whitelist-dışı / +%4 altı sebebiyle elenen semboller",
                        value: rejected.map(x => x.symbol).join(", ") || "-",
                        severity: "WARN"
                    },
                    {
                        label: "Seçilen plandaki aktif semboller",
                        value: [...symSet].join(", ") || "-"
                    }
                ]
            });
        } else {
            out.push({ label: "Politika Uyum", value: "Tümü uygun", severity: "INFO" });
        }
        return out;
    }

    private execSummary(actions: ActionBundle | null, planId: PlanId) {
        if (!actions || actions.planId !== planId) return undefined;
        const n = actions.children.length;
        const reduceOnly = actions.children.filter(c => c.reduceOnly).length;
        const postOnly = actions.children.filter(c => c.postOnly).length;
        const notion = actions.children.reduce((a, c) => a + (c.price ?? 0) * c.qty, 0);
        return {
            childCount: n,
            reduceOnlyRatio: +(reduceOnly / Math.max(1, n)).toFixed(2),
            postOnlyCount: postOnly,
            notionalUsd: Math.round(notion)
        };
    }

    private buildWhyTree(vp: VariantPlan | null, sel: PlanFeas | null): ExplainNode[] {
        const nodes: ExplainNode[] = [];
        if (!vp || !sel) return nodes;

        nodes.push({
            label: "Seçim Kriterleri",
            children: [
                { label: "Feasibility Skoru", value: sel.score },
                { label: "Öneri", value: sel.recommend || "—" },
                { label: "Varyant", value: vp.variant || "—" },
                {
                    label: "Exec Parametreleri", children: [
                        { label: "childType", value: vp.exec.childType },
                        { label: "limitOffsetBps", value: vp.exec.limitOffsetBps },
                        { label: "twapMs", value: vp.exec.twapMs },
                        { label: "iceberg", value: vp.exec.iceberg }
                    ]
                }
            ]
        });

        // En kritik nedenler (ERROR/WARN)
        const crit = this.topFindings(sel);
        if (crit.length) {
            nodes.push({
                label: "Kritik Bulgular",
                children: crit.map(f => ({
                    label: f.type,
                    value: f.message + (f.quickFix ? ` | Fix: ${f.quickFix}` : ""),
                    severity: f.severity
                }))
            });
        }

        // Risk/sentinel ipuçları
        if (vp.riskHints?.length) {
            nodes.push({
                label: "Risk İpuçları",
                children: vp.riskHints.map(h => ({ label: "hint", value: h, severity: "WARN" }))
            });
        }
        return nodes;
    }

    private suggestNext(vp: VariantPlan | null, sel: PlanFeas | null, sentinel: string): string[] {
        const out: string[] = [];
        if (!vp || !sel) return out;

        if (sentinel !== "NORMAL") out.push("Sentinel aktif: Yeni açılışları durdur, yalnız reduce-only uygula.");
        if (sel.recommend === "ADJUST") out.push("Planı ayarla: TWAP +200ms, iceberg +0.02, gerekiyorsa POST_ONLY.");
        if (sel.recommend === "REJECT") out.push("Planı reddet: Plan C (nakit/spot) veya daha düşük notional ile yeniden dener.");

        // Sembollerde uyarı
        for (const s of sel.symbols) {
            const w = s.findings.find(f => f.type === "TRIM" || f.type === "MIN_NOTIONAL" || f.type === "PERCENT_PRICE");
            if (w) out.push(`${s.symbol}: ${w.message}${w.quickFix ? ` → ${w.quickFix}` : ""}`);
        }
        if (!out.length) out.push("Plan uygun: VIVO-02'ye aktar ve yürütmeyi izle.");
        return Array.from(new Set(out)).slice(0, 6);
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
            name: 'ExplainabilityReporter',
            version: this.ver,
            initialized: this.isInitialized,
            explainedCards: this.seen.size,
            dataStatus: {
                memory: !!this.memory,
                variants: !!this.variants,
                feasibility: !!this.feas,
                lastSelection: !!this.lastSelection,
                lastActions: !!this.lastActions
            }
        };
    }

    async shutdown(): Promise<void> {
        try {
            this.logger?.info('ExplainabilityReporter shutting down...');
            this.seen.clear();
            this.memory = null;
            this.variants = null;
            this.feas = null;
            this.lastSelection = null;
            this.lastActions = null;
            this.removeAllListeners();
            this.isInitialized = false;
            this.logger?.info('ExplainabilityReporter shutdown complete');
        } catch (error) {
            this.logger?.error('ExplainabilityReporter shutdown error:', error);
        }
    }
}

export default ExplainabilityReporter;
