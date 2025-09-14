/**
 * VIVO-11 · spotCashAllocator.ts
 * Toplam özsermaye (equity), bakiye ve piyasa koşullarına göre hedef spot payını korumak (%30 kuralı), 
 * whitelist & +%4 politika eşiğine uyan sembollerle rebalans alış/satış planı üretmek
 */

import { EventEmitter } from "events";
// import { bus } from "../core/bus";
// import { logger } from "../core/logger";

// Temporary logger implementation
const logger = {
  info: (msg: string, ...args: any[]) => console.log(`[INFO] ${msg}`, ...args),
  warn: (msg: string, ...args: any[]) => console.warn(`[WARN] ${msg}`, ...args),
  error: (msg: string | object, details?: string) => {
    if (typeof msg === 'string') {
      console.error(`[ERROR] ${msg}`, details);
    } else {
      console.error(`[ERROR]`, msg, details);
    }
  },
  debug: (msg: string, ...args: any[]) => console.debug(`[DEBUG] ${msg}`, ...args)
};

// Mock bus implementation
const bus = {
  on: <T = any>(event: string, handler: (data: T) => void) => {
    console.log(`[BUS] Registered handler for: ${event}`);
  },
  emit: <T = any>(event: string, data?: T) => {
    console.log(`[BUS] Emitted: ${event}`, data);
  }
};

// Types for VIVO-11
export type ISODate = string;
export type Sentinel = "NORMAL"|"SLOWDOWN"|"HALT_PARTIAL"|"CIRCUIT_BREAKER";
export type Level = "GREEN"|"AMBER"|"RED";

export interface Policy {
  whitelist: string[];
  minTargetPct: number;           // ≥ 4 (yüzde)
  spot: { targetPct: number; equityThresholdUsd: number }; // ör: 0.30 ve 100_000
}

export interface AccountSnapshot {
  asOf: ISODate;
  equityUsd: number;              // toplam (spot+usdt+PNL)
  balances: Array<{ asset:string; free:number; locked:number }>;
}

export interface PriceMap {
  [symbol: string]: number;       // SYMBOL mid/last (USD cinsinden)
}

export interface AnalyticsRow { expectedMovePct:number; R_multiple:number; }
export type AnalyticsMap = Record<string, AnalyticsRow>;

export interface ExchangeRule {
  symbol:string; tickSize:number; stepSize:number; minNotional:number;
  percent?: { up:number; down:number; refMins?:number };
}

export interface RiskState { level:Level; sentinel:Sentinel; }

export interface RebalanceLeg {
  symbol: string;
  side: "BUY"|"SELL";
  notionalUsd: number;            // hedef notional (işlem büyüklüğü)
  estPrice: number;
  estQty: number;                 // stepSize'a yaklaşık yuvarlanmış (kesin VIVO-02'de)
  reason: string;                 // "reach_target", "reduce_only", "trim_overflow"
}

export interface RebalancePlan {
  corrId: string;
  asOf: ISODate;
  targetSpotUsd: number;
  currentSpotUsd: number;
  diffUsd: number;                // + ise alım, − ise satım ihtiyacı
  legs: RebalanceLeg[];
  execHints: { twapMs:number; iceberg:number; childType:"LIMIT"|"POST_ONLY";
               postOnlyForBuy?: boolean; slices?: number; };
  mode: "NORMAL"|"REDUCE_ONLY";   // sentinel'e göre
}

export interface AllocInput {
  policy: Policy;
  account: AccountSnapshot;
  prices: PriceMap;               // {"BTCUSDT":65000,...}
  analytics: AnalyticsMap;        // +%4 ve R eşiği için
  rules: Record<string, ExchangeRule>;
  risk: RiskState;
  // evren ve yönlendirme
  candidates?: string[];          // opsiyonel, yoksa policy.whitelist
  dominanceTilt?: Record<string, number>; // {"BTCUSDT":1.2,"ETHUSDT":1.1,...} ağırlık çarpanları
}

export interface AllocOutput extends RebalancePlan {}

export interface StdError { code:string; message:string; details?:Record<string,unknown>; retriable?:boolean; }

const clamp = (x:number, lo:number, hi:number)=> Math.max(lo, Math.min(hi, x));
const sum = (a:number[], z=0)=> a.reduce((x,y)=>x+y, z);

export class SpotCashAllocator extends EventEmitter {
  ver="1.0.0"; src="VIVO-11";
  private seen = new Set<string>();

  attach(){
    bus.on<AllocInput>("vivo.spot.request", (inp: AllocInput) => this.safeRun(inp));
  }

  safeRun(inp: AllocInput){
    const out = this.run(inp);
    if ("error" in (out as any)) {
      logger.error(out, "VIVO-11 failed");
    } else {
      const plan = out as AllocOutput;
      bus.emit<AllocOutput>("vivo.spot.rebalance", plan);
      bus.emit("ops.actions.suggest", this.toOpsActions(plan));
      bus.emit("audit.log", { asOf:plan.asOf, ver:this.ver, src:this.src,
        payload:{ target:plan.targetSpotUsd, current:plan.currentSpotUsd, diff:plan.diffUsd, legs:plan.legs.length }});
    }
  }

  run(inp: AllocInput): AllocOutput | { error: StdError } {
    try{
      const v = this.validate(inp); if (v) return this.err("VALIDATION_ERROR", v);

      const now = new Date().toISOString();
      const corrId = `spot-${Date.now()}`;
      if (this.seen.has(corrId)) return this.err("IDEMPOTENT","duplicate corrId");
      this.seen.add(corrId);

      const wl = new Set((inp.candidates && inp.candidates.length? inp.candidates: inp.policy.whitelist));
      const prices = inp.prices;

      // 1) Hedef spot
      const threshold = inp.policy.spot.equityThresholdUsd;
      const basePct   = inp.policy.spot.targetPct;
      const targetPct = inp.account.equityUsd >= threshold ? basePct : basePct*0.5;
      const targetSpotUsd = Math.round(inp.account.equityUsd * targetPct);

      // 2) Mevcut spot USD
      const isStable = (a:string)=> a==="USDT" || a==="BUSD" || a==="FDUSD" || a==="USDC";
      const spotAssets = inp.account.balances.filter(b=> !isStable(b.asset));
      let currentSpotUsd = 0;
      for (const b of spotAssets){
        const sym = `${b.asset}USDT`;
        const px = prices[sym] ?? 0;
        currentSpotUsd += px * (b.free + b.locked);
      }
      currentSpotUsd = Math.round(currentSpotUsd);

      const diffUsd = Math.round(targetSpotUsd - currentSpotUsd);
      const mode = (inp.risk.sentinel==="NORMAL") ? "NORMAL" : "REDUCE_ONLY";

      // 3) Uygun semboller (politika + analytics)
      const pool = Array.from(wl).filter(s=>{
        const an = inp.analytics[s];
        return !!an && an.expectedMovePct >= inp.policy.minTargetPct && (an.R_multiple??0) >= 1.2;
      });

      // 4) Ağırlıklar
      const weights = this.normalizeWeights(pool, inp.dominanceTilt);

      // 5) Leg üretimi
      const legs: RebalanceLeg[] = [];
      if (diffUsd > 0 && mode==="NORMAL"){
        // BUY paylaştır
        for (const s of pool){
          const alloc = Math.max(0, Math.round(diffUsd * (weights[s]||0)));
          if (alloc<=0) continue;
          const leg = this.mkLeg("BUY", s, alloc, prices[s], inp.rules[s], "reach_target");
          if (leg) legs.push(leg);
        }
      } else if (diffUsd < 0) {
        // SELL: en büyük USD değerli varlıklardan başlayarak azalt
        const valued = spotAssets
          .map(b=>({ symbol:`${b.asset}USDT`, usd:(prices[`${b.asset}USDT`]||0)*(b.free+b.locked), qty:(b.free+b.locked) }))
          .filter(x=> wl.has(x.symbol));
        valued.sort((a,b)=>b.usd-a.usd);

        let remain = Math.abs(diffUsd);
        for (const v of valued){
          if (remain<=0) break;
          const cut = Math.min(v.usd, remain);
          const leg = this.mkLeg("SELL", v.symbol, Math.round(cut), prices[v.symbol], inp.rules[v.symbol], "reduce_only");
          if (leg){ legs.push(leg); remain -= cut; }
        }
      }
      // MIN_NOTIONAL altındaki parçaları ele
      const filtered = legs.filter(l=> l.notionalUsd >= (inp.rules[l.symbol]?.minNotional ?? 10));

      // 6) Exec ipuçları (AMBER → korumacı)
      const hints = {
        twapMs: (inp.risk.level==="AMBER") ? 1600 : 1200,
        iceberg: (inp.risk.level==="AMBER") ? 0.16 : 0.12,
        childType: "LIMIT" as const,
        postOnlyForBuy: true,
        slices: Math.min(10, Math.max(2, Math.floor(filtered.length/2)+2))
      };

      const plan: RebalancePlan = {
        corrId, asOf: now,
        targetSpotUsd, currentSpotUsd, diffUsd,
        legs: filtered,
        execHints: hints,
        mode
      };
      return plan;

    } catch(e:any){
      return this.err("ALLOC_FAILED", e?.message||"unknown", { stack:e?.stack });
    }
  }

  private mkLeg(side:"BUY"|"SELL", symbol:string, notional:number, price:number|undefined, rule:ExchangeRule|undefined, reason:string): RebalanceLeg | null {
    if (!price || !rule) return null;
    const qty = Math.floor((notional / price) / rule.stepSize) * rule.stepSize;
    if (qty <= 0) return null;
    return { symbol, side, notionalUsd:notional, estPrice:price, estQty:qty, reason };
  }

  private normalizeWeights(pool:string[], tilt?:Record<string,number>){
    if (!pool.length) return {} as Record<string,number>;
    const raw = pool.map(s=> Math.max(0, tilt?.[s] ?? 1));
    const tot = sum(raw, 0) || 1;
    const out: Record<string,number> = {};
    pool.forEach((s,i)=> out[s] = raw[i]/tot);
    return out;
  }

  private validate(x: AllocInput): string | null {
    if (!x?.policy || !x?.account || !x?.prices || !x?.analytics || !x?.rules || !x?.risk) return "missing fields";
    if ((x.policy.minTargetPct??0) < 4) return "policy.minTargetPct must be ≥ 4";
    if (!Array.isArray(x.account.balances)) return "account.balances invalid";
    return null;
  }

  private err(code:string, message:string, details?:any){
    const e = { code, message, details, retriable:false };
    logger.error({ code, details }, message);
    bus.emit("audit.log", { asOf:new Date().toISOString(), ver:this.ver, src:this.src, payload:{ error:e }});
    return { error: e };
  }

  private toOpsActions(plan: RebalancePlan){
    // VIVO-02'nin çocuk emir üretmesi için minimal öneri formatı
    const children = plan.legs.map(l=>({
      symbol:l.symbol,
      side:l.side,
      type: plan.execHints.childType,
      qty:l.estQty,
      reduceOnly: (plan.mode==="REDUCE_ONLY" || l.side==="SELL") ? true : false,
      postOnly: (l.side==="BUY" && plan.execHints.postOnlyForBuy) ? true : false,
      meta:{ twapMs:plan.execHints.twapMs, iceberg:plan.execHints.iceberg, slices:plan.execHints.slices }
    }));
    return { asOf:plan.asOf, planId:"C", children, comments:[`spot target ${plan.targetSpotUsd} / diff ${plan.diffUsd}`] };
  }
}
