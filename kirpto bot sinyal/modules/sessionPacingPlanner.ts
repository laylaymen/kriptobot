/**
 * VIVO-12 · sessionPacingPlanner.ts
 * Asia–EU–US seanslarında ve düşük likidite saatlerinde işlem frekansı ve risk bütçesini 
 * dinamik kotalarla düzenleyip, slipaj-şok anlarında yavaşlat/stop verebilen deterministik bir pacing katmanı
 */

import { EventEmitter } from "events";

// Types for VIVO-12
export type Sentinel = "NORMAL"|"SLOWDOWN"|"HALT_PARTIAL"|"CIRCUIT_BREAKER";
export type Posture  = "RISK_ON"|"NEUTRAL"|"RISK_OFF";

export interface SessionWindow {
  id: "ASIA"|"EU"|"US"|"LOW_LIQ";
  startUtc: string;   // "00:00"
  endUtc:   string;   // "08:00"
  weight: number;     // 0..1 temel likidite katsayısı (örn: EU=1, ASIA=0.8, LOW_LIQ=0.4)
}

export interface PacingPolicy {
  baseMaxNewPositions: number;  // seans başı
  baseChildPerMin: number;      // dakikada child emir üst sınırı
  baseRiskBudgetUsd: number;    // seans başı risk bütçesi
  slipBpSoft: number;           // yumuşak slipaj tavanı (bps)
  slipBpHard: number;           // sert tavan; aşılırsa slowdown/stop
  markoutBp5sSoft: number;      // 5s mark-out yumuşak eşik
  ewmaAlpha: number;            // 0.05..0.3
}

export interface LiquidityMetrics {
  asOf: string;
  wsLagMs: number;                 // WS consumer gecikmesi
  avgSpreadBp: number;             // whitelist ortalama
  l2DepthUsd: number;              // top-of-book±N price toplam
  msgRatePerSec: number;           // diff stream hızı
}

export interface TcaSnapshot {
  asOf: string;
  slipBpEWMA: number;              // realized bps (EWMA)
  markoutBp5sEWMA: number;         // 5s mark-out (EWMA)
}

export interface RiskState {
  level: "GREEN"|"AMBER"|"RED";
  sentinel: Sentinel;
  posture: Posture;
}

export interface RateLimitBudget {
  // borsa limitlerini aşmamak için muhafazakâr pay
  requestWeightPerMin: number;   // ör: 4800 (6000 limitin %80'i)
  ordersPer10s: number;          // ör: 80 (limit 100'ün %80'i)
}

export interface PacingInput {
  nowIso: string;
  sessionWindows: SessionWindow[];
  policy: PacingPolicy;
  risk: RiskState;
  liq: LiquidityMetrics;
  tca: TcaSnapshot;
  rate: RateLimitBudget;
}

export interface PacingPlan {
  asOf: string;
  sessionId: SessionWindow["id"];
  factors: { session:number; liq:number; risk:number; tca:number };
  maxNewPositions: number;
  maxChildPerMin: number;
  riskBudgetUsd: number;
  slipSoftBp: number;
  slipHardBp: number;
  reduceOnly: boolean;
  notes?: string[];
}

export interface StdError { code:string; message:string; details?:Record<string,unknown>; retriable?:boolean; }

const clamp = (x:number, lo:number, hi:number)=> Math.max(lo, Math.min(hi, x));
const toMin = (iso:string)=> new Date(iso).toISOString().slice(11,16); // "HH:MM" UTC

export class SessionPacingPlanner extends EventEmitter {
  ver="1.0.0"; src="VIVO-12";
  private last:PacingInput | null = null;

  attach(bus: any, logger: any){
    bus.on<PacingInput>("vivo.pacing.input", (x: any)=> this.safeRun(x, bus, logger));
    // periyodik tetik (1 dakikada bir yeniden üret)
    bus.on("clock.tick1m", ()=> { if (this.last) this.safeRun(this.last, bus, logger); });
  }

  safeRun(x:PacingInput, bus: any, logger: any){
    const res = this.run(x);
    if ("error" in (res as any)) {
      logger.error(res, "VIVO-12 failed");
    } else {
      const plan = res as PacingPlan;
      bus.emit<PacingPlan>("vivo.pacing.plan", plan);
      bus.emit("audit.log", { asOf:plan.asOf, ver:this.ver, src:this.src,
        payload:{ session:plan.sessionId, maxNew:plan.maxNewPositions, childPerMin:plan.maxChildPerMin, reduceOnly:plan.reduceOnly }});
      this.last = x;
    }
  }

  run(x:PacingInput): PacingPlan | { error: StdError } {
    try {
      const v = this.validate(x); if (v) return this.err("VALIDATION_ERROR", v);

      const session = this.pickSession(x.nowIso, x.sessionWindows);
      const fSession = session.weight;

      // likidite faktörü (0.4..1): spread↑, depth↓, wsLag↑ → düşür
      const fLiq = this.liqFactor(x);

      // risk/sentinel faktörü
      const { factor: fRisk, reduceOnly } = this.riskFactor(x);

      // TCA faktörü (slip/markout)
      const fTca = this.tcaFactor(x);

      const factor = clamp(fSession * fLiq * fRisk * fTca, 0, 1);

      // taban kotalar
      const baseNew = x.policy.baseMaxNewPositions;
      const baseChild = x.policy.baseChildPerMin;
      const baseRisk = x.policy.baseRiskBudgetUsd;

      // rate limit koruma: child-per-min üst sınırı
      const rlChildCap = Math.floor(Math.min(
        x.rate.requestWeightPerMin * 0.9, // muhafazakâr
        x.rate.ordersPer10s * 6 * 0.9     // 10s pencereden dakikaya
      ));

      const plan:PacingPlan = {
        asOf: new Date().toISOString(),
        sessionId: session.id,
        factors:{ session:fSession, liq:fLiq, risk:fRisk, tca:fTca },
        maxNewPositions: Math.max( reduceOnly ? 0 : Math.floor(baseNew * factor), 0 ),
        maxChildPerMin: Math.max( reduceOnly ? 5 : Math.floor(baseChild * factor), 0 ), // reduceOnly'da küçük bir teknik limit bırak
        riskBudgetUsd: Math.max( reduceOnly ? Math.floor(baseRisk*0.25) : Math.floor(baseRisk * factor), 0 ),
        slipSoftBp: Math.round(x.policy.slipBpSoft * (1/fTca)), // kötü TCA'da daha sıkı
        slipHardBp: x.policy.slipBpHard,
        reduceOnly,
        notes:[]
      };

      // rate limit üst sınırına uygula
      plan.maxChildPerMin = Math.min(plan.maxChildPerMin, rlChildCap);

      // notlar
      if (reduceOnly) plan.notes?.push("sentinel aktif: yeni pozisyon yok; reduce-only");
      if (fLiq<0.7)   plan.notes?.push("likidite zayıf: kota düşürüldü");
      if (fTca<0.7)   plan.notes?.push("TCA kötü: slipaj/mark-out nedeniyle yavaşlatıldı");

      return plan;

    } catch (e:any){
      return this.err("PACING_FAILED", e?.message||"unknown", { stack:e?.stack });
    }
  }

  private pickSession(nowIso:string, windows:SessionWindow[]): SessionWindow {
    const hhmm = toMin(nowIso); // UTC HH:MM
    const asMin = (s:string)=> Number(s.slice(0,2))*60 + Number(s.slice(3,5));
    const nowM = asMin(hhmm);

    // kapsayan pencere(ler)i bul; çakışma varsa weight en yüksek olanı seç
    const cand = windows.filter(w=>{
      const a=asMin(w.startUtc), b=asMin(w.endUtc);
      return a<=b ? (nowM>=a && nowM<b) : (nowM>=a || nowM<b); // gece devri
    });
    if (cand.length===0) return { id:"LOW_LIQ", startUtc:"00:00", endUtc:"23:59", weight:0.5 };
    return cand.sort((p,q)=> q.weight - p.weight)[0];
  }

  private liqFactor(x:PacingInput){
    // normalize: spread 2–20bp → 1..0.5, depth 50k–1M → 0.5..1, wsLag 0–400ms → 1..0.6
    const s = clamp(1 - (x.liq.avgSpreadBp-2)/(20-2)*0.5, 0.5, 1);
    const d = clamp((x.liq.l2DepthUsd-50_000)/(1_000_000-50_000), 0, 1)*0.5 + 0.5;
    const l = clamp(1 - (x.liq.wsLagMs/400)*0.4, 0.6, 1);
    return clamp(s * d * l, 0.4, 1);
  }

  private riskFactor(x:PacingInput){
    let f = 1, reduceOnly = false;
    if (x.risk.sentinel!=="NORMAL"){ f = 0; reduceOnly = true; }
    else if (x.risk.level==="RED"){ f = 0.4; }
    else if (x.risk.level==="AMBER"){ f = 0.7; }
    return { factor:f, reduceOnly };
  }

  private tcaFactor(x:PacingInput){
    let f = 1;
    if (x.tca.slipBpEWMA > x.policy.slipBpHard || x.tca.markoutBp5sEWMA > x.policy.markoutBp5sSoft*2){
      f = 0.2; // neredeyse stop
    } else if (x.tca.slipBpEWMA > x.policy.slipBpSoft || x.tca.markoutBp5sEWMA > x.policy.markoutBp5sSoft){
      f = 0.6; // slowdown
    }
    return f;
  }

  private validate(x:PacingInput): string | null {
    if (!x?.policy || !x?.risk || !x?.liq || !x?.tca || !x?.rate) return "missing fields";
    if ((x.policy.ewmaAlpha??0) <= 0 || x.policy.ewmaAlpha > 0.5) return "ewmaAlpha invalid";
    if (!Array.isArray(x.sessionWindows) || x.sessionWindows.length===0) return "session windows missing";
    return null;
  }

  private err(code:string, message:string, details?:any){
    const e = { code, message, details, retriable:false };
    return { error: e };
  }
}

// Örnek Konfig (24/7 kriptoda seans pencereleri)
export const SESSION_WINDOWS = [
  { id:"ASIA", startUtc:"00:00", endUtc:"08:00", weight:0.8 },
  { id:"EU",   startUtc:"07:00", endUtc:"15:30", weight:1.0 },
  { id:"US",   startUtc:"13:00", endUtc:"21:00", weight:0.95 },
  { id:"LOW_LIQ", startUtc:"21:00", endUtc:"00:00", weight:0.6 } // gece geç saatler
] as SessionWindow[];
