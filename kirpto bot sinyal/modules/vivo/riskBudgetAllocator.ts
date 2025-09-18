/**
 * VIVO-13 · riskBudgetAllocator.ts
 * Seans bazında tanımlı risk bütçesini, canlı edge (PF/hit/R), volatilite ve korrelasyona göre 
 * adil, emniyetli ve yürütülebilir şekilde strateji/cluster/simgelere dağıtmak
 */

import { EventEmitter } from "events";

// Types for VIVO-13
export type Sentinel = "NORMAL"|"SLOWDOWN"|"HALT_PARTIAL"|"CIRCUIT_BREAKER";
export type Posture  = "RISK_ON"|"NEUTRAL"|"RISK_OFF";

export interface PacingPlan {
  asOf: string;
  sessionId: "ASIA"|"EU"|"US"|"LOW_LIQ";
  maxNewPositions: number;
  riskBudgetUsd: number;         // seanslık risk bütçesi (VIVO-12)
  reduceOnly: boolean;
}

export interface PolicyAlloc {
  whitelist: string[];
  minTargetPct: number;          // ≥ +4
  maxPerSymbolRiskPct: number;   // equity başına risk tavanı (örn. 0.8%)
  maxPerClusterRiskPct: number;  // equity başına cluster tavanı (örn. 2.5%)
  kellyLightFactor: number;      // 0.25 (¼ Kelly)
}

export interface PortfolioSnapshot {
  asOf: string;
  equityUsd: number;
  spotUsd: number;
  perpsNetUsd: number;
  exposureUsdBySymbol: Record<string, number>;   // mevcut maruz kalım (mutlak)
}

export interface TcaLite {
  slipBpEWMA: number;
  markoutBp5sEWMA: number;
}

export interface RiskState {
  level: "GREEN"|"AMBER"|"RED";
  sentinel: Sentinel;
  posture: Posture;
  lossStreak?: number;           // üst üste SL sayısı (LIVIA bildirir)
}

export interface ExchangeRule {
  symbol:string;
  tickSize:number;
  stepSize:number;
  minNotional:number;
  status?: "TRADING"|"HALT"|"BREAK";
}

export interface BookTicker { symbol:string; bid:number; ask:number; mid:number; asOf:string; }

/** Edge/Vol girişleri (Grafik Beyni + Denetim Asistanı) */
export interface SymbolStat {
  symbol: string;
  cluster: string;               // ör: "breakout", "meanreversion", "trend"
  pf: number;                    // profit factor (≤ 3 ile clamp)
  hit: number;                   // 0..1
  avgR: number;                  // ortalama R (kâr/zarar oranı, negatifte clamp)
  volAtrPct: number;             // ATR/Price (%)
  stopFrac: number;              // planlanan SL uzaklığı (fiyatın %'si, ör: 0.008)
}

export interface CorrelationMatrix {
  // sembol bazlı korelasyon (−1..1), simetrik, diyagonal 1
  symbols: string[];
  rho: number[][];
}

export interface AllocatorInput {
  corrId: string;
  pacing: PacingPlan;
  policy: PolicyAlloc;
  portfolio: PortfolioSnapshot;
  tca: TcaLite;
  risk: RiskState;
  stats: SymbolStat[];                  // yalnız whitelist içi ve uygun sinyaller
  corr: CorrelationMatrix;
  rules: Record<string, ExchangeRule>;
  tickers: Record<string, BookTicker>;
}

export interface RiskLeg {
  symbol: string;
  cluster: string;
  targetRiskUsd: number;               // $ risk (SL'e kadar kayıp)
  estNotionalUsd: number;              // tahmini notional (risk/stopFrac)
  kellyCapUsd: number;                 // Kelly-light tavanı
  reasons: string[];
}

export interface ClusterSum {
  cluster: string;
  riskUsd: number;
}

export interface RiskAllocPlan {
  asOf: string;
  sessionId: PacingPlan["sessionId"];
  corrId: string;
  reduceOnly: boolean;
  totalRiskUsd: number;                // fiilen dağıtılan risk
  legs: RiskLeg[];
  byCluster: ClusterSum[];
  notes?: string[];
}

export interface StdError { code:string; message:string; details?:Record<string,unknown>; retriable?:boolean; }

const clamp = (x:number, lo:number, hi:number)=> Math.max(lo, Math.min(hi, x));
const round = (x:number, n=2)=> Number(x.toFixed(n));

export class RiskBudgetAllocator extends EventEmitter {
  ver="1.0.0"; src="VIVO-13";
  private seen = new Set<string>();

  attach(bus: any, logger: any){
    bus.on("vivo.risk.alloc.input", (x: any)=> this.safeRun(x, bus, logger));
  }

  safeRun(x: AllocatorInput, bus: any, logger: any){
    const res = this.run(x);
    if ("error" in (res as any)) {
      logger.error(res, "VIVO-13 failed");
    } else {
      const plan = res as RiskAllocPlan;
      bus.emit("vivo.risk.alloc.plan", plan);
      // delta: hedef notional vs mevcut maruziyet → VIVO-02 için rehber
      const delta = this.toDelta(plan, x.portfolio.exposureUsdBySymbol);
      bus.emit("vivo.risk.alloc.delta", delta);
      bus.emit("audit.log", { asOf:plan.asOf, ver:this.ver, src:this.src,
        payload:{ session:plan.sessionId, totalRisk:plan.totalRiskUsd, legs:plan.legs.length, reduceOnly:plan.reduceOnly }});
    }
  }

  run(x: AllocatorInput): RiskAllocPlan | { error: StdError } {
    try {
      const v = this.validate(x); if (v) return this.err("VALIDATION_ERROR", v);
      if (this.seen.has(x.corrId)) return this.err("IDEMPOTENT","corrId already allocated",{corrId:x.corrId});
      const asOf = new Date().toISOString();

      // Sentinel → yeni risk yok, reduce-only plan
      if (x.pacing.reduceOnly || x.risk.sentinel!=="NORMAL"){
        const plan: RiskAllocPlan = { asOf, sessionId:x.pacing.sessionId, corrId:x.corrId,
          reduceOnly:true, totalRiskUsd:0, legs:[], byCluster:[], notes:["sentinel/reduce-only"] };
        this.seen.add(x.corrId);
        return plan;
      }

      // 1) uygun semboller
      const ok = this.eligible(x);

      // 2) skorlar
      const preW = ok.map(s=> ({ s, w: this.edgeScore(s) * this.volPenalty(s) }));
      // 3) corr penalty (tek iterasyon pragmatik)
      const withCorr = this.applyCorrPenalty(preW, x);

      // 4) damping (LIVIA)
      const damp = (x.risk.lossStreak ?? 0) >= 3 ? 0.5 : 1;
      for (const r of withCorr) r.w *= damp;

      // normalize
      const sumW = withCorr.reduce((a,b)=>a+b.w,0) || 1;
      const budget = Math.max(0, x.pacing.riskBudgetUsd);
      // 5) risk_i ve tavanlar
      const legs = [] as RiskLeg[];
      const clusterAgg: Record<string, number> = {};
      for (const r of withCorr){
        let riskUsd = budget * (r.w / sumW);
        const kCap = this.kellyCapUsd(r.s, x);
        riskUsd = Math.min(riskUsd, kCap);

        // cluster/ symbol tavanları
        const symCap = x.portfolio.equityUsd * x.policy.maxPerSymbolRiskPct;
        const clCap = x.portfolio.equityUsd * x.policy.maxPerClusterRiskPct;
        riskUsd = Math.min(riskUsd, symCap);

        // notional dönüşüm
        const px = x.tickers[r.s.symbol]?.mid;
        const rule = x.rules[r.s.symbol];
        if (!px || !rule || rule.status!=="TRADING") continue;

        const estNotional = riskUsd / Math.max(1e-6, r.s.stopFrac) ;
        const fitted = this.fitNotional(estNotional, px, rule);
        if (fitted < rule.minNotional) continue;

        // cluster kısıtı (post-check)
        const sumCl = (clusterAgg[r.s.cluster] || 0) + riskUsd;
        if (sumCl > clCap) continue;
        clusterAgg[r.s.cluster] = sumCl;

        legs.push({
          symbol:r.s.symbol, cluster:r.s.cluster,
          targetRiskUsd: round(riskUsd), estNotionalUsd: round(fitted),
          kellyCapUsd: round(kCap),
          reasons: this.reasons(r.s)
        });
      }

      const plan: RiskAllocPlan = {
        asOf, sessionId:x.pacing.sessionId, corrId:x.corrId,
        reduceOnly:false,
        totalRiskUsd: round(legs.reduce((a,b)=>a+b.targetRiskUsd,0)),
        legs,
        byCluster: Object.entries(clusterAgg).map(([cluster,riskUsd])=>({ cluster, riskUsd: round(riskUsd) })),
        notes:[]
      };
      this.seen.add(x.corrId);
      return plan;

    } catch (e:any){
      return this.err("ALLOC_FAILED", e?.message||"unknown", { stack:e?.stack });
    }
  }

  // --- yardımcılar ---

  private eligible(x: AllocatorInput){
    const w = new Set(x.policy.whitelist);
    return x.stats.filter(s=>{
      const ok = w.has(s.symbol) && (x.rules[s.symbol]?.status==="TRADING")
        && (s.stopFrac>0) && isFinite(s.stopFrac);
      return ok;
    });
  }

  private edgeScore(s: SymbolStat){
    const pf = clamp(s.pf, 1, 3);
    const hit = clamp(s.hit, 0.35, 0.75);
    const r = clamp(s.avgR, 0.2, 2);
    return pf * hit * r;
  }

  private volPenalty(s: SymbolStat){
    const v0 = 2.5; // ATR% ölçeği
    return 1 / Math.sqrt(1 + Math.pow(s.volAtrPct / v0, 2));
  }

  private applyCorrPenalty(pre: Array<{s:SymbolStat; w:number}>, x: AllocatorInput){
    const idx = new Map(x.corr.symbols.map((k,i)=>[k,i] as const));
    return pre.map(row=>{
      const i = idx.get(row.s.symbol); if (i===undefined) return row;
      let acc = 0;
      for (const other of pre){
        if (other.s.symbol===row.s.symbol) continue;
        const j = idx.get(other.s.symbol); if (j===undefined) continue;
        const rho = x.corr.rho[i][j];
        acc += Math.max(0, rho) * other.w; // yalnız pozitif korelasyonu cezalandır
      }
      const corrPenalty = 1 / Math.sqrt(1 + acc);
      return { s:row.s, w: row.w * corrPenalty };
    });
  }

  private kellyCapUsd(s: SymbolStat, x: AllocatorInput){
    // basitleştirilmiş Kelly ~ edge / variance; burada edgeScore ≈ getiri beklentisi proxy'si
    const edge = this.edgeScore(s);
    const varScale = Math.max(0.5, s.volAtrPct); // proxy
    const kelly = edge / (varScale*4); // kaba ölçek
    const kLight = x.policy.kellyLightFactor; // 0.25
    return Math.max(0, x.portfolio.equityUsd * kelly * kLight);
  }

  private fitNotional(targetUsd:number, px:number, rule:{ stepSize:number } & { minNotional:number }){
    // yalnız notional ve adım uyarlaması (fiyat/qty ayrışması VIVO-02'de yapılır)
    // stepSize → qty adımı; burada yalnız dolar notional'ı aşağı yuvarlıyoruz
    const notion = Math.floor(targetUsd / (rule.minNotional)) * rule.minNotional;
    return Math.max(rule.minNotional, Math.min(targetUsd, notion));
  }

  private reasons(s: SymbolStat): string[]{
    const arr: string[] = [];
    arr.push(`PF=${s.pf.toFixed(2)}`, `hit=${(s.hit*100).toFixed(0)}%`, `avgR=${s.avgR.toFixed(2)}`);
    arr.push(`ATR%=${s.volAtrPct.toFixed(2)}`, `SL=${(s.stopFrac*100).toFixed(2)}%`);
    return arr;
  }

  private toDelta(plan: RiskAllocPlan, current: Record<string,number>){
    // basit delta: hedef notional - mevcut notional (proxy olarak risk/stopFrac yok; VIVO-02 netleştirir)
    return {
      asOf: plan.asOf,
      corrId: plan.corrId,
      symbols: plan.legs.map(l=>{
        const cur = current[l.symbol] || 0;
        return { symbol:l.symbol, targetNotionalUsd:l.estNotionalUsd, currentUsd:cur, deltaUsd: round(l.estNotionalUsd - cur) };
      })
    };
  }

  private validate(x: AllocatorInput): string | null {
    if (!x?.corrId) return "corrId missing";
    if (!x?.pacing || !x?.portfolio || !x?.policy || !x?.stats || !x?.corr) return "missing fields";
    if ((x.policy.minTargetPct ?? 0) < 4) return "policy.minTargetPct must be ≥ 4";
    if (x.portfolio.equityUsd <= 0) return "equity invalid";
    return null;
  }

  private err(code:string, message:string, details?:any){
    const e = { code, message, details, retriable:false };
    return { error: e };
  }
}
