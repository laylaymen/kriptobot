/**
 * Uplift AB Engine - VIVO-09
 * Plan/varyant seçimini kontrollü deney kurgusuna bağlayıp (A/B/C),
 * canlı sonuçlardan uplift istatistiği üreterek VIVO'nun plan ağırlıklarını optimize eder
 */

import { EventEmitter } from 'events';

export type ISODate = string;
export type PlanId = "A" | "B" | "C";
export type VariantId = "AGGR" | "BAL" | "CONSV";
export type Posture = "RISK_ON" | "NEUTRAL" | "RISK_OFF";
export type Sentinel = "NORMAL" | "SLOWDOWN" | "HALT_PARTIAL" | "CIRCUIT_BREAKER";

export interface VariantPlan {
    id: PlanId;
    title: string;
    variant?: VariantId;
    symbols: Array<Record<string, number>>;
    exec: {
        limitOffsetBps: number;
        twapMs: number;
        iceberg: number;
        childType: "LIMIT" | "IOC" | "POST_ONLY" | "MARKET";
    };
}

export interface VariantOutput {
    asOf: ISODate;
    variants: Record<PlanId, VariantPlan[]>;
}

export interface OperatorResult {
    corrId?: string;
    selectedPlanId: PlanId;                 // Operatör seçimi (karttaki Plan)
    confirmations: Record<number, string>;   // 0: plan A/B/C, devamı evet/hayır vb.
    decidedBy: "OPERATOR" | "TIMEOUT_DEFAULT";
    decidedAt: ISODate;
}

export interface RiskState {
    level: "GREEN" | "AMBER" | "RED";
    sentinel: Sentinel;
    posture: Posture;
}

export interface AssignConfig {
    mode: "FIXED_SPLIT" | "EPS_GREEDY";     // sabit yüzdeler veya epsilon-greedy
    fixedSplit?: Record<VariantId, number>; // ör: {AGGR:0.3,BAL:0.5,CONSV:0.2}
    epsilon?: number;                       // 0.05..0.2 önerilir
    minPerArm?: number;                     // anlamlılık için min örnek
    corrPrefix?: string;                    // deney corr id ön eki
}

export interface AssignDecision {
    corrId: string;                // deney korelasyon id'si
    planId: PlanId;                // A/B/C planı
    variant: VariantId;            // seçilen varyant kolu
    decidedAt: ISODate;
    decidedBy: "ENGINE" | "OPERATOR_DEFAULT";
    exposureSeq: number;           // kolun maruz kaldığı örnek sayısı
}

export interface OutcomeIn {
    corrId: string;                // atama corrId
    planId: PlanId;
    variant?: VariantId;
    postureAtDecision: Posture;
    asOf: ISODate;
    pnlUsd: number;                // net realized PnL
    hit?: boolean;
    profitFactor?: number;
    rMultiple?: number;
    slippageBps?: number;
    markoutBp_5s?: number;
}

export interface ArmStat {
    n: number;
    sumPnl: number;
    hit: number;
    pfEWMA: number;
    meanPnl: number;
}

export interface LiftResult {
    baseline: VariantId;                 // karşılaştırma kolu (genelde BAL)
    compare: VariantId;                  // kıyaslanan kol
    upliftPnl: number;                   // mean pnl farkı (USD)
    upliftHit: number;                   // hit rate farkı (pp)
    pValue?: number;                     // opsiyonel hızlı z-test
    significant?: boolean;               // p<0.05 ?
}

export interface Snapshot {
    asOf: ISODate;
    arms: Record<VariantId, ArmStat>;
    lifts: LiftResult[];
}

export interface UpliftStore {
    load(): Promise<Snapshot | null>;
    save(s: Snapshot): Promise<void>;
}

export interface StdError {
    code: string;
    message: string;
    details?: Record<string, unknown>;
    retriable?: boolean;
}

const VARS: VariantId[] = ["AGGR", "BAL", "CONSV"];

class InMemoryStore implements UpliftStore {
    private snap: Snapshot | null = null;
    async load() { return this.snap; }
    async save(s: Snapshot) { this.snap = s; }
}

class UpliftABEngine extends EventEmitter {
    private ver = "1.0.0";
    private src = "VIVO-09";
    private logger: any;
    private isInitialized: boolean = false;
    private cfg: Required<AssignConfig>;
    private store: UpliftStore;
    private snap: Snapshot = {
        asOf: new Date().toISOString(),
        arms: {
            AGGR: { n: 0, sumPnl: 0, hit: 0, pfEWMA: 1, meanPnl: 0 },
            BAL: { n: 0, sumPnl: 0, hit: 0, pfEWMA: 1, meanPnl: 0 },
            CONSV: { n: 0, sumPnl: 0, hit: 0, pfEWMA: 1, meanPnl: 0 }
        },
        lifts: []
    };
    private lastVariants: VariantOutput | null = null;
    private lastOperator: OperatorResult | null = null;
    private lastRisk: RiskState = { level: "GREEN", sentinel: "NORMAL", posture: "NEUTRAL" };
    private seenCorr = new Set<string>();

    constructor(cfg?: Partial<AssignConfig>, store?: UpliftStore) {
        super();
        this.cfg = {
            mode: "EPS_GREEDY",
            epsilon: 0.1,
            fixedSplit: { AGGR: 0.33, BAL: 0.34, CONSV: 0.33 },
            minPerArm: 30,
            corrPrefix: "upl",
            ...cfg
        } as Required<AssignConfig>;
        this.store = store ?? new InMemoryStore();
    }

    async initialize(logger: any): Promise<boolean> {
        try {
            this.logger = logger;
            this.logger.info('UpliftABEngine initializing...');
            
            await this.setupEngine();
            
            this.isInitialized = true;
            this.logger.info('UpliftABEngine initialized successfully');
            return true;
        } catch (error) {
            this.logger.error('UpliftABEngine initialization error:', error);
            return false;
        }
    }

    async setupEngine(): Promise<void> {
        const saved = await this.store.load();
        if (saved) this.snap = saved;
        
        this.on('vivo.variants', (v: VariantOutput) => { this.lastVariants = v; });
        this.on('vivo.operator.result', (o: OperatorResult) => { this.lastOperator = o; });
        this.on('risk.state', (r: RiskState) => { this.lastRisk = r; });
        this.on('gb.tca', (o: OutcomeIn) => this.ingestOutcome(o).catch(e => this.logger.error(e, "VIVO-09 outcome")));
        this.on('vivo.uplift.request', () => this.safeAssign());
    }

    // --- ATAMA ---
    safeAssign(): void {
        const res = this.assign();
        if ("error" in (res as any)) {
            this.logger.error(res, "VIVO-09 assign failed");
        } else {
            const a = res as AssignDecision;
            this.emit('vivo.uplift.assign', a);
            this.emit('audit.log', {
                asOf: a.decidedAt,
                ver: this.ver,
                src: this.src,
                payload: {
                    msg: "assign",
                    corrId: a.corrId,
                    plan: a.planId,
                    var: a.variant
                }
            });
        }
    }

    assign(): AssignDecision | { error: StdError } {
        if (!this.isInitialized) {
            return this.err("NOT_INITIALIZED", "Module not initialized");
        }

        try {
            if (!this.lastOperator) {
                return this.err("MISSING_OPERATOR", "No operator decision available");
            }

            const planId = this.lastOperator.selectedPlanId;
            const corrId = `${this.cfg.corrPrefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

            if (this.seenCorr.has(corrId)) {
                return this.err("IDEMPOTENT", "corrId already assigned", { corrId });
            }

            // Sentinel kontrolü: NORMAL değilse sadece CONSV
            let variant: VariantId;
            let decidedBy: "ENGINE" | "OPERATOR_DEFAULT";

            if (this.lastRisk.sentinel !== "NORMAL") {
                variant = "CONSV";
                decidedBy = "OPERATOR_DEFAULT";
                this.logger.warn({ sentinel: this.lastRisk.sentinel }, "Non-normal sentinel, forcing CONSV variant");
            } else {
                // Normal atama algoritması
                variant = this.selectVariant();
                decidedBy = "ENGINE";
            }

            const exposureSeq = this.snap.arms[variant].n + 1;

            const decision: AssignDecision = {
                corrId,
                planId,
                variant,
                decidedAt: new Date().toISOString(),
                decidedBy,
                exposureSeq
            };

            this.seenCorr.add(corrId);
            return decision;

        } catch (e: any) {
            return this.err("ASSIGN_FAILED", e?.message || "unknown", { stack: e?.stack });
        }
    }

    private selectVariant(): VariantId {
        if (this.cfg.mode === "FIXED_SPLIT") {
            return this.selectByFixedSplit();
        } else {
            return this.selectByEpsGreedy();
        }
    }

    private selectByFixedSplit(): VariantId {
        const split = this.cfg.fixedSplit!;
        const totalExposure = Object.values(this.snap.arms).reduce((sum, arm) => sum + arm.n, 0);

        // Minimum örnek sayısına ulaşmamış kolları öncelikle seç
        for (const variant of VARS) {
            if (this.snap.arms[variant].n < this.cfg.minPerArm!) {
                return variant;
            }
        }

        // Normal split algoritması
        const random = Math.random();
        let cumulative = 0;
        for (const variant of VARS) {
            cumulative += split[variant];
            if (random <= cumulative) {
                return variant;
            }
        }

        return "BAL"; // fallback
    }

    private selectByEpsGreedy(): VariantId {
        const epsilon = this.cfg.epsilon!;

        // Minimum örnek sayısına ulaşmamış kolları öncelikle seç
        for (const variant of VARS) {
            if (this.snap.arms[variant].n < this.cfg.minPerArm!) {
                return variant;
            }
        }

        // Epsilon-greedy: ε olasılıkla random, 1-ε olasılıkla en iyiyi seç
        if (Math.random() < epsilon) {
            // Random exploration
            return VARS[Math.floor(Math.random() * VARS.length)];
        } else {
            // Greedy exploitation: en yüksek meanPnL
            let bestVariant: VariantId = "BAL";
            let bestMean = -Infinity;

            for (const variant of VARS) {
                if (this.snap.arms[variant].meanPnl > bestMean) {
                    bestMean = this.snap.arms[variant].meanPnl;
                    bestVariant = variant;
                }
            }

            return bestVariant;
        }
    }

    // --- SONUÇ TÜKETİMİ ---
    async ingestOutcome(outcome: OutcomeIn): Promise<void> {
        try {
            if (this.seenCorr.has(outcome.corrId + "-outcome")) {
                this.logger.warn({ corrId: outcome.corrId }, "Outcome already ingested");
                return;
            }

            const variant = outcome.variant;
            if (!variant || !VARS.includes(variant)) {
                this.logger.warn({ variant }, "Invalid variant in outcome");
                return;
            }

            // Update arm statistics
            const arm = this.snap.arms[variant];
            arm.n++;
            arm.sumPnl += outcome.pnlUsd;
            arm.meanPnl = arm.sumPnl / arm.n;

            if (outcome.hit !== undefined) {
                arm.hit += outcome.hit ? 1 : 0;
            }

            if (outcome.profitFactor !== undefined) {
                arm.pfEWMA = arm.pfEWMA * 0.9 + outcome.profitFactor * 0.1; // EWMA smoothing
            }

            // Update snapshot timestamp
            this.snap.asOf = new Date().toISOString();

            // Calculate uplift statistics
            this.updateLiftStats();

            // Save to persistent storage
            await this.store.save(this.snap);

            // Mark as processed
            this.seenCorr.add(outcome.corrId + "-outcome");

            // Emit events
            this.emit('vivo.uplift', outcome);
            this.emit('vivo.uplift.snapshot', this.snap);
            this.emit('audit.log', {
                asOf: new Date().toISOString(),
                ver: this.ver,
                src: this.src,
                payload: {
                    msg: "outcome",
                    corrId: outcome.corrId,
                    variant,
                    pnlUsd: outcome.pnlUsd
                }
            });

        } catch (error) {
            this.logger.error({ error, corrId: outcome.corrId }, "Failed to ingest outcome");
        }
    }

    private updateLiftStats(): void {
        const lifts: LiftResult[] = [];
        const baseline = "BAL"; // BAL as baseline

        for (const compare of VARS) {
            if (compare === baseline) continue;

            const baseArm = this.snap.arms[baseline];
            const compArm = this.snap.arms[compare];

            if (baseArm.n < 10 || compArm.n < 10) continue; // Not enough data

            const upliftPnl = compArm.meanPnl - baseArm.meanPnl;
            const upliftHit = (compArm.hit / Math.max(1, compArm.n)) - (baseArm.hit / Math.max(1, baseArm.n));

            // Simple z-test approximation (placeholder)
            const pooledVariance = Math.abs(upliftPnl) * 100; // Simplified
            const standardError = Math.sqrt(pooledVariance * (1/baseArm.n + 1/compArm.n));
            const zScore = standardError > 0 ? Math.abs(upliftPnl) / standardError : 0;
            const pValue = zScore > 1.96 ? 0.04 : 0.2; // Rough approximation

            lifts.push({
                baseline,
                compare,
                upliftPnl,
                upliftHit,
                pValue,
                significant: pValue < 0.05
            });
        }

        this.snap.lifts = lifts;
    }

    // --- Yardımcı fonksiyonlar ---
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
     * Get current experiment statistics
     */
    getSnapshot(): Snapshot {
        return { ...this.snap };
    }

    /**
     * Reset experiment data (use with caution)
     */
    async reset(): Promise<void> {
        this.snap = {
            asOf: new Date().toISOString(),
            arms: {
                AGGR: { n: 0, sumPnl: 0, hit: 0, pfEWMA: 1, meanPnl: 0 },
                BAL: { n: 0, sumPnl: 0, hit: 0, pfEWMA: 1, meanPnl: 0 },
                CONSV: { n: 0, sumPnl: 0, hit: 0, pfEWMA: 1, meanPnl: 0 }
            },
            lifts: []
        };
        this.seenCorr.clear();
        await this.store.save(this.snap);
        this.logger.info('Experiment data reset');
    }

    /**
     * Get module status
     */
    getStatus(): any {
        const totalExperiments = Object.values(this.snap.arms).reduce((sum, arm) => sum + arm.n, 0);
        return {
            name: 'UpliftABEngine',
            version: this.ver,
            initialized: this.isInitialized,
            mode: this.cfg.mode,
            totalExperiments,
            arms: this.snap.arms,
            significantLifts: this.snap.lifts.filter(l => l.significant).length,
            lastRisk: this.lastRisk
        };
    }

    async shutdown(): Promise<void> {
        try {
            this.logger?.info('UpliftABEngine shutting down...');
            await this.store.save(this.snap);
            this.seenCorr.clear();
            this.removeAllListeners();
            this.isInitialized = false;
            this.logger?.info('UpliftABEngine shutdown complete');
        } catch (error) {
            this.logger?.error('UpliftABEngine shutdown error:', error);
        }
    }
}

export default UpliftABEngine;
