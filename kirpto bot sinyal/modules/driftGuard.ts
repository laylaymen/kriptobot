/**
 * VIVO-14 · driftGuard.ts
 * Tahsis edilen hedef notional/risk ile canlı gerçekleşen maruziyet arasındaki sapmayı (drift) 
 * dakikalık döngüde ölçmek ve otomatik düzeltme eylem planı üretmek
 */

import { EventEmitter } from "events";

// Types for VIVO-14
export type Sentinel = "NORMAL"|"SLOWDOWN"|"HALT_PARTIAL"|"CIRCUIT_BREAKER";
export type Posture  = "RISK_ON"|"NEUTRAL"|"RISK_OFF";
export type Side     = "BUY"|"SELL";
export type ChildType= "LIMIT"|"IOC"|"POST_ONLY"|"MARKET";

export interface PacingPlan {
  asOf: string;
  sessionId: "ASIA"|"EU"|"US"|"LOW_LIQ";
  maxChildPerMin: number;
  reduceOnly: boolean;
}

export interface RiskAllocPlanLeg {
  symbol: string;
  cluster: string;
  targetRiskUsd: number;
  estNotionalUsd: number;     // hedef notional (VIVO-13)
  reasons: string[];
}

export interface RiskAllocPlan {
  asOf: string;
  sessionId: PacingPlan["sessionId"];
  corrId: string;
  reduceOnly: boolean;
  legs: RiskAllocPlanLeg[];
}

export interface PortfolioExposure {
  asOf: string;
  bySymbolUsd: Record<string, number>; // gerçekleşen notional proxy (abs)
}

export interface ExecReport {
  // child emirler için özet rapor (VIVO-02 → router)
  orderId: string;
  symbol: string;
  side: Side;
  childType: ChildType;
  status: "NEW"|"PARTIALLY_FILLED"|"FILLED"|"CANCELED"|"REJECTED"|"EXPIRED";
  reason?: "POST_ONLY_REJECT"|"PERCENT_PRICE"|"INSUFFICIENT_BAL"|"MAX_POSITION"|"UNKNOWN";
  filledNotionalUsd?: number;
  ts: string;
  corrId?: string;
  legId?: string;
}

export interface ExchangeRule {
  symbol:string;
  tickSize:number;
  stepSize:number;
  minNotional:number;
  status?: "TRADING"|"HALT"|"BREAK";
  percent?: { up:number; down:number; refMins?:number };
  maxPositionQty?: number;
}

export interface BookTicker { symbol:string; bid:number; ask:number; mid:number; asOf:string; }

export interface RiskState {
  level: "GREEN"|"AMBER"|"RED";
  sentinel: Sentinel;
  posture: Posture;
}

export interface DriftPolicy {
  driftTolerancePct: number;   // 0.05 = ±5%
  minActionUsd: number;        // 25
  maxTopUpRetries: number;     // 3
  widenOffsetBps: number;      // +4..8 bps
  iocFailoverMs: number;       // 1200..3000
}

export interface GuardInput {
  plan: RiskAllocPlan;                         // hedefler
  exposure: PortfolioExposure;                 // gerçekleşen
  pacing: PacingPlan;                          // child/min ve reduceOnly
  risk: RiskState;
  rules: Record<string, ExchangeRule>;
  tickers: Record<string, BookTicker>;
  policy: DriftPolicy;
}

export type ActionKind = "TOP_UP"|"TRIM"|"CANCEL_REPLACE"|"SWITCH_CHILD"|"WAIT_RETRY"|"NOOP";

export interface DriftAction {
  corrId: string;
  legId: string;               // symbol+index
  symbol: string;
  side: Side;                  // hedef yön (topUp=plan.side varsayımı)
  kind: ActionKind;
  deltaNotionalUsd: number;    // tamamlanacak/azaltılacak dolar
  execHint: {
    childType: ChildType;
    limitOffsetBps: number;
    twapMs: number;
    iceberg: number;
    reduceOnly?: boolean;
    postOnly?: boolean;
  };
  reasons: string[];           // "underfill 12%", "post_only_reject x3", "percent_price band"
}

export interface DriftPlan {
  asOf: string;
  corrId: string;
  actions: DriftAction[];
  notes?: string[];
}

export interface StdError { code:string; message:string; details?:Record<string,unknown>; retriable?:boolean; }

const clamp = (x:number, lo:number, hi:number)=> Math.max(lo, Math.min(hi, x));
const round = (x:number, n=2)=> Number(x.toFixed(n));

interface LegState {
  retries: number;
  postOnlyRejects: number;
  lastChildType?: "LIMIT"|"IOC"|"POST_ONLY"|"MARKET";
}

export class DriftGuard extends EventEmitter {
  ver="1.0.0"; src="VIVO-14";
  private legState = new Map<string, LegState>(); // key: corrId|legId

  attach(bus: any, logger: any){
    bus.on("vivo.drift.input", (x: any)=> this.safeRun(x, bus, logger));
    bus.on("router.exec.report", (r: any)=> this.trackExec(r));
  }

  private key(corrId:string, legId:string){ return `${corrId}|${legId}`; }

  private trackExec(r: ExecReport){
    if (!r?.corrId || !r?.legId) return;
    const k = this.key(r.corrId, r.legId);
    const st = this.legState.get(k) ?? { retries:0, postOnlyRejects:0 };

    if (r.status === "REJECTED" && r.reason === "POST_ONLY_REJECT") {
      st.postOnlyRejects++;
    } else if (["EXPIRED", "CANCELED"].includes(r.status)) {
      st.retries++;
    }
    st.lastChildType = r.childType;
    this.legState.set(k, st);
  }

  safeRun(x: GuardInput, bus: any, logger: any){
    const res = this.run(x);
    if ("error" in (res as any)) {
      logger.error(res, "VIVO-14 failed");
    } else {
      const plan = res as DriftPlan;
      bus.emit("vivo.driftguard.plan", plan);
      // her action ayrı event
      for (const act of plan.actions) {
        bus.emit("vivo.driftguard.action", act);
      }
      bus.emit("audit.log", { asOf:plan.asOf, ver:this.ver, src:this.src,
        payload:{ corrId:plan.corrId, actionCount:plan.actions.length }});
    }
  }

  run(x: GuardInput): DriftPlan | { error: StdError } {
    try {
      const v = this.validate(x); if (v) return this.err("VALIDATION_ERROR", v);

      const asOf = new Date().toISOString();
      const actions: DriftAction[] = [];

      // her leg için drift check
      for (let i = 0; i < x.plan.legs.length; i++) {
        const leg = x.plan.legs[i];
        const legId = `${leg.symbol}_${i}`;
        const k = this.key(x.plan.corrId, legId);
        const state = this.legState.get(k) ?? { retries:0, postOnlyRejects:0 };

        const target = leg.estNotionalUsd;
        const current = x.exposure.bySymbolUsd[leg.symbol] ?? 0;
        const delta = target - current;
        const absDelta = Math.abs(delta);

        // tolerans kontrolü
        const tolerance = Math.max(x.policy.minActionUsd, target * x.policy.driftTolerancePct);
        if (absDelta < tolerance) {
          // NOOP - tolerans içinde
          continue;
        }

        // sentinel kontrolü - reduce-only modda sadece TRIM
        if (x.risk.sentinel !== "NORMAL" && delta > 0) {
          continue; // TOP_UP yapmayız
        }

        // action türü belirleme
        let kind: ActionKind = "NOOP";
        let side: Side = "BUY";
        let deltaNotional = 0;

        if (delta > 0) {
          // TOP_UP gerekli
          kind = "TOP_UP";
          side = "BUY"; // varsayım: spot alımı
          deltaNotional = delta;
        } else {
          // TRIM gerekli  
          kind = "TRIM";
          side = "SELL";
          deltaNotional = Math.abs(delta);
        }

        // execution hint determination based on state
        let hint = this.getExecHint(state, x, leg.symbol);
        
        // failure handling - action type adjustment
        if (state.postOnlyRejects >= 3) {
          kind = "CANCEL_REPLACE";
          hint = { ...hint, childType: "LIMIT", limitOffsetBps: hint.limitOffsetBps + x.policy.widenOffsetBps };
        } else if (state.retries >= 2 && state.lastChildType === "LIMIT") {
          kind = "SWITCH_CHILD";
          hint = { ...hint, childType: "IOC" };
        }

        const reasons: string[] = [];
        if (delta > 0) reasons.push(`underfill ${((absDelta/target)*100).toFixed(1)}%`);
        if (delta < 0) reasons.push(`overfill ${((absDelta/target)*100).toFixed(1)}%`);
        if (state.postOnlyRejects > 0) reasons.push(`post_only_reject x${state.postOnlyRejects}`);
        if (state.retries > 0) reasons.push(`retries x${state.retries}`);

        const action: DriftAction = {
          corrId: x.plan.corrId,
          legId,
          symbol: leg.symbol,
          side,
          kind,
          deltaNotionalUsd: round(deltaNotional),
          execHint: hint,
          reasons
        };

        actions.push(action);

        // rate limiting - max actions per minute check
        if (actions.length >= x.pacing.maxChildPerMin) {
          break;
        }
      }

      const plan: DriftPlan = {
        asOf,
        corrId: x.plan.corrId,
        actions,
        notes: []
      };

      if (x.risk.sentinel !== "NORMAL") {
        plan.notes?.push("sentinel active: reduce-only mode");
      }

      return plan;

    } catch (e: any) {
      return this.err("DRIFT_FAILED", e?.message || "unknown", { stack: e?.stack });
    }
  }

  private getExecHint(state: LegState, x: GuardInput, symbol: string): {
    childType: ChildType;
    limitOffsetBps: number;
    twapMs: number;
    iceberg: number;
    reduceOnly?: boolean;
    postOnly?: boolean;
  } {
    const rule = x.rules[symbol];
    const risk = x.risk;
    
    let childType: ChildType = "POST_ONLY";
    let limitOffsetBps = 2;
    let twapMs = 1200;
    let iceberg = 0.12;

    // risk level adjustments
    if (risk.level === "AMBER") {
      twapMs = 1600;
      iceberg = 0.16;
      limitOffsetBps = 4;
    } else if (risk.level === "RED") {
      twapMs = 2000;
      iceberg = 0.20;
      limitOffsetBps = 6;
      childType = "LIMIT"; // daha az agresif
    }

    // failure adjustments
    if (state.postOnlyRejects >= 2) {
      childType = "LIMIT";
      limitOffsetBps += 2;
    }

    return {
      childType,
      limitOffsetBps,
      twapMs,
      iceberg,
      reduceOnly: x.pacing.reduceOnly,
      postOnly: childType === "POST_ONLY"
    };
  }

  private validate(x: GuardInput): string | null {
    if (!x?.plan || !x?.exposure || !x?.pacing || !x?.risk || !x?.policy) return "missing fields";
    if (!x?.rules || !x?.tickers) return "missing exchange data";
    if ((x.policy.driftTolerancePct ?? 0) <= 0) return "driftTolerancePct must be > 0";
    if ((x.policy.minActionUsd ?? 0) <= 0) return "minActionUsd must be > 0";
    return null;
  }

  private err(code: string, message: string, details?: any) {
    const e = { code, message, details, retriable: false };
    return { error: e };
  }
}
