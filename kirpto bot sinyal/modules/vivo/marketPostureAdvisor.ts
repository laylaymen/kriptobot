/**
 * Market Posture Advisor - VIVO-01
 * Grafik Beyni + RiskNet + politika kapılarını birleştirip günün duruşunu ve Plan A/B/C önerilerini üretir
 * Operatöre onay soruları hazırlar
 */

import { EventEmitter } from 'events';

export type ISODate = string;
export type Level = "GREEN" | "AMBER" | "RED";
export type Posture = "RISK_ON" | "NEUTRAL" | "RISK_OFF";

export interface Policy {
    minTargetPct: number;           // >= 4
    whitelist: string[];            // 20-coin
    spot: { 
        targetPct: number; 
        equityThresholdUsd: number; 
    };
}

export interface RiskNetState {
    level: Level;                   // GB-70
    sentinel: "NORMAL" | "WATCH" | "SLOWDOWN" | "HALT_PARTIAL" | "CIRCUIT_BREAKER"; // GB-61/75
}

export interface WFParams {
    exec: { 
        limitOffsetBps: number; 
        twapMs: number; 
        iceberg: number; 
        childType: "LIMIT" | "IOC" | "POST_ONLY" | "MARKET";
    };
    trend?: { 
        atrK: number; 
        pyramid?: { 
            maxAdds: number; 
            addEveryPct: number; 
            sizePct: number; 
        };
    };
}

export interface LedgerSnap {
    equityUsd: number; 
    spotPct: number; 
    ddPct: number;
}

export interface Dominance {
    btcD: number;            // proxy
    ethRel: number;          // ETH vs BTC güç
    altRet: number;          // alt sepet 1d getiri
}

export interface ExposureGate {
    decision: "ALLOW" | "TRIM" | "REDUCE_ONLY" | "DENY";
    allowedNotionalUsd?: number;    // TRIM/ALLOW için
}
export type ExposureMap = Record<string, ExposureGate>;

export interface AnalyticsRow {
    expectedMovePct: number; // kapanmış bar
    R_multiple: number;      // ≥1.2 tercih
}
export type AnalyticsMap = Record<string, AnalyticsRow>;

// ---- VIVO-01 çıktıları ----
export interface VIVOPlan {
    id: "A" | "B" | "C"; 
    title: string;
    symbols: Array<Record<string, number>>; // {SYMBOL: notionalUsd}
    exec: WFParams["exec"];
    trend?: WFParams["trend"];
    spotTopup?: { 
        targetPct: number; 
        amountUsd: number; 
    } | null;
    notes?: string[];
    applicability?: {                              // VIVO-02 için erken işaretler
        whitelistOk: boolean; 
        minTargetOk: boolean; 
        exposureOk: boolean;
    };
}

export interface VIVOAsk { 
    q: string; 
    choices: string[]; 
    default: string; 
    timeoutSec: number; 
}

export interface VIVOOutput {
    asOf: ISODate; 
    posture: Posture; 
    plans: VIVOPlan[]; 
    ask: VIVOAsk[]; 
    audit: string[];
}

export interface StdError { 
    code: string; 
    message: string; 
    details?: Record<string, unknown>; 
    retriable?: boolean; 
}

export interface VIVO01Input {
    risk: RiskNetState;
    wf: WFParams;
    ledger: LedgerSnap;
    dominance: Dominance;
    policy: Policy;
    exposure: ExposureMap;
    analytics: AnalyticsMap;         // yalnız whitelist içinden kullanılacak
}

class MarketPostureAdvisor extends EventEmitter {
    private ver = "1.0.0";
    private src = "VIVO-01";
    private logger: any;
    private isInitialized: boolean = false;

    constructor() {
        super();
    }

    async initialize(logger: any): Promise<boolean> {
        try {
            this.logger = logger;
            this.logger.info('MarketPostureAdvisor initializing...');
            
            this.isInitialized = true;
            this.logger.info('MarketPostureAdvisor initialized successfully');
            return true;
        } catch (error) {
            this.logger.error('MarketPostureAdvisor initialization error:', error);
            return false;
        }
    }

    run(x: VIVO01Input): VIVOOutput | { error: StdError } {
        if (!this.isInitialized) {
            return this.err("NOT_INITIALIZED", "Module not initialized");
        }

        try {
            const valErr = this.validate(x);
            if (valErr) return this.err("VALIDATION_ERROR", valErr);

            const posture = this.decidePosture(x.risk);
            const plans = this.buildPlans(x, posture);
            const ask = this.buildQuestions(x, posture, plans);
            const out: VIVOOutput = {
                asOf: new Date().toISOString(),
                posture, 
                plans, 
                ask,
                audit: this.auditLines(x, posture, plans)
            };

            this.emit('vivo.posture', out);
            return out;
        } catch (e: any) {
            return this.err("VIVO01_FAILED", e?.message || "unknown", { stack: e?.stack });
        }
    }

    private validate(x: VIVO01Input): string | null {
        if (!x || !x.policy) return "policy missing";
        if ((x.policy.minTargetPct ?? 0) < 4) return "minTargetPct must be ≥ 4";
        if (!Array.isArray(x.policy.whitelist) || x.policy.whitelist.length === 0) return "whitelist empty";
        if (!x.ledger || !Number.isFinite(x.ledger.equityUsd) || x.ledger.equityUsd <= 0) return "equity invalid";
        return null;
    }

    private decidePosture(r: VIVO01Input["risk"]): Posture {
        if (r.sentinel !== "NORMAL" || r.level === "RED") return "RISK_OFF";
        if (r.level === "AMBER") return "NEUTRAL";
        return "RISK_ON";
    }

    private buildPlans(x: VIVO01Input, posture: Posture): VIVOPlan[] {
        const plans: VIVOPlan[] = [];
        
        // C) Nakit + Spot (her durumda öneri olarak bulunsun)
        plans.push(this.planSpot(x, posture));

        if (posture === "RISK_OFF") return plans; // yalnız Plan C

        // A) BTC+ETH Trend
        const planA = this.planTrendBluechips(x);
        if (planA) plans.unshift(planA); // A'yı başa koy

        // B) Alt Momentum Sepeti
        const planB = this.planAltBasket(x);
        if (planB) plans.splice(1, 0, planB);

        return plans;
    }

    private planTrendBluechips(x: VIVO01Input): VIVOPlan | null {
        const picks = this.pickSymbols(x, ["BTCUSDT", "ETHUSDT"]);
        if (picks.length === 0) return null;

        const exec = {
            ...x.wf.exec,
            twapMs: x.risk.level === "AMBER" ? x.wf.exec.twapMs + 200 : x.wf.exec.twapMs
        };
        
        return {
            id: "A", 
            title: "Trend Yakala: BTC+ETH",
            symbols: picks,
            exec, 
            trend: x.wf.trend ?? { 
                atrK: 2.8, 
                pyramid: { maxAdds: 2, addEveryPct: 5, sizePct: 0.33 } 
            },
            notes: this.notesFrom(x),
            applicability: { whitelistOk: true, minTargetOk: true, exposureOk: true }
        };
    }

    private planAltBasket(x: VIVO01Input): VIVOPlan | null {
        // whitelist'ten BTC/ETH hariç, uygun skorlu ilk 5–6
        const universe = x.policy.whitelist.filter(s => s !== "BTCUSDT" && s !== "ETHUSDT");
        const picks = this.pickSymbols(x, universe, { perSymbolFrac: 0.10, maxCount: 6 });
        if (picks.length === 0) return null;

        const exec = {
            ...x.wf.exec,
            limitOffsetBps: x.wf.exec.limitOffsetBps + 1,
            twapMs: x.wf.exec.twapMs + (x.risk.level === "AMBER" ? 300 : 100),
            iceberg: Math.max(0.10, (x.wf.exec.iceberg ?? 0.12) - 0.02)
        };
        
        return {
            id: "B", 
            title: "Alt Momentum Sepeti",
            symbols: picks, 
            exec, 
            trend: { 
                atrK: 2.6, 
                pyramid: { maxAdds: 1, addEveryPct: 5, sizePct: 0.5 } 
            },
            notes: this.notesFrom(x),
            applicability: { whitelistOk: true, minTargetOk: true, exposureOk: true }
        };
    }

    private planSpot(x: VIVO01Input, posture: Posture): VIVOPlan {
        const need = this.spotTopupAmount(x.policy.spot, x.ledger);
        return {
            id: "C", 
            title: "Nakit + Spot Top-Up",
            symbols: [],
            exec: x.wf.exec,
            spotTopup: need > 0 ? { 
                targetPct: x.policy.spot.targetPct, 
                amountUsd: Math.round(need) 
            } : null,
            notes: [ 
                posture === "RISK_OFF" ? 
                    "Risk-Kapalı: yeni giriş yok, reduce-only" : 
                    "Nötr/Risk-On: sınırlı giriş" 
            ],
            applicability: { whitelistOk: true, minTargetOk: true, exposureOk: true }
        };
    }

    private pickSymbols(
        x: VIVO01Input,
        pool: string[],
        opt: { perSymbolFrac?: number; maxCount?: number } = {}
    ): Array<Record<string, number>> {
        const frac = opt.perSymbolFrac ?? 0.25;           // equity * 0.25 * 0.2 = ~%5 varsayılan
        const maxN = opt.maxCount ?? 2;

        const chosen: Array<Record<string, number>> = [];
        for (const s of pool) {
            if (!x.policy.whitelist.includes(s)) continue;
            const an = x.analytics[s]; 
            if (!an) continue;
            if (an.expectedMovePct < x.policy.minTargetPct || (an.R_multiple ?? 0) < 1.2) continue;
            const gate = x.exposure[s]; 
            if (!gate || gate.decision === "DENY" || gate.decision === "REDUCE_ONLY") continue;

            const base = x.ledger.equityUsd * frac * 0.2;    // risk bütçesi ~%20 çarpanı
            const notional = gate.decision === "TRIM" ? (gate.allowedNotionalUsd ?? base) : base;
            if (notional <= 0) continue;

            chosen.push({ [s]: Math.round(notional) });
            if (chosen.length >= maxN) break;
        }
        return chosen;
    }

    private spotTopupAmount(spotPol: VIVO01Input["policy"]["spot"], led: VIVO01Input["ledger"]) {
        if (led.equityUsd < spotPol.equityThresholdUsd) {
            const target = Math.min(0.15, spotPol.targetPct * (led.equityUsd / spotPol.equityThresholdUsd));
            return Math.max(0, (target - (led.spotPct || 0))) * led.equityUsd;
        }
        if ((led.spotPct || 0) < spotPol.targetPct) {
            return (spotPol.targetPct - (led.spotPct || 0)) * led.equityUsd;
        }
        return 0;
    }

    private buildQuestions(_x: VIVO01Input, posture: Posture, plans: VIVOPlan[]): VIVOAsk[] {
        const ids = plans.map(p => p.id);
        const qs: VIVOAsk[] = [
            { q: "Plan seçimi?", choices: ids, default: ids[0], timeoutSec: 45 },
        ];
        if (posture !== "RISK_OFF") {
            qs.push({ 
                q: "Min +%4 hedef sağlanıyorsa uygulansın mı?", 
                choices: ["Evet", "Hayır"], 
                default: "Evet", 
                timeoutSec: 30 
            });
        }
        return qs;
    }

    private notesFrom(x: VIVO01Input): string[] {
        const n: string[] = [];
        if (x.risk.level === "AMBER") n.push("AMBER: TWAP +200–300ms, iceberg düşük");
        if (x.risk.sentinel !== "NORMAL") n.push(`Sentinel=${x.risk.sentinel}`);
        if (x.dominance.ethRel > 0 && x.dominance.btcD < 0.55) n.push("ETH güç > BTC; alt sepet destekli");
        return n;
    }

    private auditLines(x: VIVO01Input, posture: Posture, plans: VIVOPlan[]): string[] {
        return [
            `risk=${x.risk.level}/${x.risk.sentinel}`,
            `posture=${posture}`,
            `btcD=${x.dominance.btcD.toFixed(2)} ethRel=${x.dominance.ethRel.toFixed(2)} altRet=${x.dominance.altRet.toFixed(3)}`,
            `plans=${plans.map(p => p.id).join(",")}`
        ];
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
            name: 'MarketPostureAdvisor',
            version: this.ver,
            initialized: this.isInitialized
        };
    }

    async shutdown(): Promise<void> {
        try {
            this.logger?.info('MarketPostureAdvisor shutting down...');
            this.removeAllListeners();
            this.isInitialized = false;
            this.logger?.info('MarketPostureAdvisor shutdown complete');
        } catch (error) {
            this.logger?.error('MarketPostureAdvisor shutdown error:', error);
        }
    }
}

export default MarketPostureAdvisor;
