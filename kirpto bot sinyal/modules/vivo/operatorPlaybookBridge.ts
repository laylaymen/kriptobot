/**
 * VIVO-15 · operatorPlaybookBridge.ts
 * Uçtan uca sistemin önerdiği tüm operasyonel aksiyonları tek yerde kartlaştırıp operatörden emin onay almak;
 * onay/ret/partial/timeout kararlarını güvenli ve izlenebilir şekilde VIVO-02'ye iletmek
 */

import { EventEmitter } from "events";

// Types for VIVO-15
export type Sentinel = "NORMAL"|"SLOWDOWN"|"HALT_PARTIAL"|"CIRCUIT_BREAKER";
export type Posture  = "RISK_ON"|"NEUTRAL"|"RISK_OFF";

export interface RiskState {
  level: "GREEN"|"AMBER"|"RED";
  sentinel: Sentinel;
  posture: Posture;
}

export type Origin =
  | "UPLIFT"        // VIVO-09 uplift assign sonrası yürütme varyantı
  | "SPOT_REBAL"    // VIVO-11 cashSpotAllocator legs
  | "PACING"        // VIVO-12 pacing throttles (bilgilendirme)
  | "RISK_ALLOC"    // VIVO-13 riskBudgetAllocator legs
  | "DRIFT_FIX";    // VIVO-14 driftGuard actions

export type ActionKind = "OPEN"|"INCREASE"|"REDUCE"|"TRIM"|"TOP_UP"|"CANCEL_REPLACE"|"SWITCH_CHILD"|"WAIT_RETRY";

export interface ActionProposal {
  origin: Origin;
  corrId: string;            // sürecin korelasyon id'si
  legId: string;             // alt-bacak id'si (symbol#index)
  symbol: string;
  side: "BUY"|"SELL";
  kind: ActionKind;
  notionalUsd: number;       // etkilenecek notional
  execHint?: {
    childType: "LIMIT"|"IOC"|"POST_ONLY"|"MARKET";
    limitOffsetBps?: number;
    twapMs?: number;
    iceberg?: number;
    reduceOnly?: boolean;
    postOnly?: boolean;
  };
  reasons?: string[];
}

export type CardSeverity = "INFO"|"WARN"|"CRITICAL";

export interface PlaybookCard {
  cardId: string;                // deterministic: `${origin}|${corrId}|${legId}`
  origin: Origin;
  title: string;                 // kart başlığı
  severity: CardSeverity;
  proposals: ActionProposal[];   // 1..N öneri
  meta: {
    risk: RiskState;
    expiresAt: string;           // timeout için ISO
    createdAt: string;
    sessionId?: "ASIA"|"EU"|"US"|"LOW_LIQ";
    paceHint?: { maxChildPerMin:number };
  };
}

export interface OperatorDecision {
  cardId: string;
  decidedAt: string;
  decidedBy: "OPERATOR"|"TIMEOUT_DEFAULT";
  decisionSeq: number;           // aynı cardId'ye birden fazla partial varsa artar
  choice: "ACCEPT_ALL"|"REJECT_ALL"|"PARTIAL";
  acceptLegs?: Array<{ legId:string }>;  // PARTIAL için
  notes?: string;
}

export interface BridgePolicy {
  timeoutMs: number;              // 8000..20000
  reduceOnlyOnSentinel: boolean;  // true
  maxProposalsPerCard: number;    // 20
  groupBySymbol: boolean;         // kartta grupla
}

export interface ApplyCommand {
  cardId: string;
  seq: number;
  corrId: string;
  legId: string;
  symbol: string;
  side: "BUY"|"SELL";
  kind: ActionKind;
  notionalUsd: number;
  execHint?: ActionProposal["execHint"];
  acceptedBy: "OPERATOR"|"TIMEOUT_DEFAULT";
}

export interface StdError { code:string; message:string; details?:Record<string,unknown>; retriable?:boolean; }

const nowISO = ()=> new Date().toISOString();

export class OperatorPlaybookBridge extends EventEmitter {
  ver="1.0.0"; src="VIVO-15";
  private policy: Required<BridgePolicy>;
  private risk: RiskState = { level:"GREEN", sentinel:"NORMAL", posture:"NEUTRAL" };
  private pending = new Map<string, PlaybookCard>();   // cardId -> card
  private decided = new Set<string>();                 // cardId#seq

  constructor(p?: Partial<BridgePolicy>){
    super();
    this.policy = {
      timeoutMs: 12000,
      reduceOnlyOnSentinel: true,
      maxProposalsPerCard: 20,
      groupBySymbol: true,
      ...p
    };
  }

  attach(bus: any, logger: any){
    // kaynak akışlar
    bus.on("vivo.driftguard.action", (a: any)=> this.ingest([a], "DRIFT_FIX", bus, logger));
    bus.on("vivo.rebalance.suggest", (plan: any)=> {
      const arr: ActionProposal[] = (plan?.legs||[]).map((l:any, i:number)=>({
        origin:"SPOT_REBAL", corrId: plan.asOf, legId:`${l.symbol}#${i}`,
        symbol:l.symbol, side:l.side, kind: l.side==="BUY"?"INCREASE":"TRIM",
        notionalUsd:l.notionalUsd, execHint:l.execHint, reasons:l.reasons
      }));
      this.ingest(arr, "SPOT_REBAL", bus, logger);
    });
    bus.on("vivo.risk.alloc.plan", (plan: any)=> {
      const arr: ActionProposal[] = (plan?.legs||[]).map((l:any, i:number)=>({
        origin:"RISK_ALLOC", corrId: plan.corrId, legId:`${l.symbol}#${i}`,
        symbol:l.symbol, side: l.targetRiskUsd>=0?"BUY":"SELL",
        kind: l.targetRiskUsd>=0?"OPEN":"REDUCE",
        notionalUsd: Math.abs(l.estNotionalUsd),
        execHint:{ childType:"LIMIT", limitOffsetBps:6, twapMs:1400, iceberg:0.12 },
        reasons:l.reasons
      }));
      this.ingest(arr, "RISK_ALLOC", bus, logger);
    });
    // risk/pacing
    bus.on("risk.state", (r: any)=> this.risk = r);
    // operatör girişi
    bus.on("vivo.operator.input", (d: any)=> this.onDecision(d, bus, logger));
  }

  /** Önerileri kartlaştırır ve yayınlar */
  ingest(proposals: ActionProposal[], origin?: string, bus?: any, logger?: any){
    try{
      if (!proposals?.length) return;
      // sentinel filtresi
      const filtered = this.filterBySentinel(proposals);

      // grupla
      const groups = this.policy.groupBySymbol
        ? this.groupBy(filtered, p=> `${p.origin}|${p.corrId}|${p.symbol}`)
        : this.groupBy(filtered, p=> `${p.origin}|${p.corrId}|${p.legId}`);

      for (const [key, arr] of groups.entries()){
        if (!arr.length) continue;
        const cardId = this.policy.groupBySymbol ? `${arr[0].origin}|${arr[0].corrId}|${arr[0].symbol}` : `${arr[0].origin}|${arr[0].corrId}|${arr[0].legId}`;
        if (this.pending.has(cardId)) continue; // idempotent

        const severity = this.pickSeverity(arr);
        const card: PlaybookCard = {
          cardId,
          origin: arr[0].origin,
          title: this.makeTitle(arr),
          severity,
          proposals: arr.slice(0, this.policy.maxProposalsPerCard),
          meta:{
            risk: this.risk,
            createdAt: nowISO(),
            expiresAt: new Date(Date.now()+this.policy.timeoutMs).toISOString()
          }
        };
        this.pending.set(cardId, card);
        if (bus) {
          bus.emit("vivo.operator.card", card);
          bus.emit("audit.log", { asOf: card.meta.createdAt, ver:this.ver, src:this.src, payload:{ msg:"card", cardId, n:card.proposals.length, severity }});
        }

        // timeout planla
        setTimeout(()=> this.onTimeout(cardId, bus, logger), this.policy.timeoutMs);
      }
    } catch(e:any){
      if (logger) logger.error({e}, "VIVO-15 ingest failed");
    }
  }

  private filterBySentinel(arr: ActionProposal[]){
    if (!this.policy.reduceOnlyOnSentinel) return arr;
    if (this.risk.sentinel==="NORMAL") return arr;
    // sentinel aktif → yeni risk içerenler (OPEN/INCREASE/TOP_UP) düşer
    return arr.filter(p=> !["OPEN","INCREASE","TOP_UP"].includes(p.kind));
  }

  private groupBy<T>(arr:T[], key:(t:T)=>string){
    const m = new Map<string,T[]>();
    for (const x of arr){ const k = key(x); (m.get(k) || m.set(k,[]).get(k)!).push(x); }
    return m;
  }

  private pickSeverity(arr: ActionProposal[]): "INFO"|"WARN"|"CRITICAL"{
    const hasReduce = arr.some(a=> ["TRIM","REDUCE"].includes(a.kind));
    const hasOpen   = arr.some(a=> ["OPEN","INCREASE","TOP_UP"].includes(a.kind));
    if (this.risk.sentinel!=="NORMAL") return "CRITICAL";
    if (hasReduce && hasOpen) return "WARN";
    return "INFO";
  }

  private makeTitle(arr: ActionProposal[]){
    const s = arr[0].symbol ?? arr[0].origin;
    const kinds = Array.from(new Set(arr.map(a=>a.kind))).join(",");
    return `${s} · ${kinds}`;
  }

  /** Operatör kararı (VIVO-03) */
  onDecision(d: OperatorDecision, bus?: any, logger?: any){
    try{
      const card = this.pending.get(d.cardId); if (!card) return;
      const sig = `${d.cardId}#${d.decisionSeq}`;
      if (this.decided.has(sig)) return; // idempotent

      const accepted = new Set( (d.choice==="PARTIAL" ? (d.acceptLegs||[]).map(x=>x.legId) : card.proposals.map(p=>p.legId)) );
      const cmds: ApplyCommand[] = [];

      if (d.choice==="REJECT_ALL"){
        // hiçbir şey yayma, sadece audit
      } else {
        for (const p of card.proposals){
          if (d.choice==="PARTIAL" && !accepted.has(p.legId)) continue;
          cmds.push({
            cardId: card.cardId, seq: d.decisionSeq,
            corrId: p.corrId, legId: p.legId, symbol: p.symbol,
            side: p.side, kind: p.kind, notionalUsd: p.notionalUsd,
            execHint: p.execHint, acceptedBy: d.decidedBy
          });
        }
      }

      // publish
      if (bus && cmds.length){
        for (const c of cmds) bus.emit("vivo.apply.command", c);
      }
      if (bus) {
        bus.emit("vivo.operator.decision", d);
        bus.emit("audit.log", { asOf: nowISO(), ver:this.ver, src:this.src,
          payload:{ msg:"decision", cardId:d.cardId, choice:d.choice, seq:d.decisionSeq, cmds:cmds.length }});
      }

      // kartı kapat
      this.pending.delete(d.cardId);
      this.decided.add(sig);

    } catch(e:any){
      if (logger) logger.error({e}, "VIVO-15 decision failed");
    }
  }

  /** Timeout → korumacı default */
  private onTimeout(cardId:string, bus?: any, logger?: any){
    const card = this.pending.get(cardId); if (!card) return;
    // yeni risk içeriyorsa REJECT, yalnız reduce-only içeriyorsa ACCEPT
    const hasNewRisk = card.proposals.some(p=> ["OPEN","INCREASE","TOP_UP"].includes(p.kind));
    const d: OperatorDecision = {
      cardId, decidedAt: nowISO(), decidedBy:"TIMEOUT_DEFAULT", decisionSeq: 0,
      choice: hasNewRisk ? "REJECT_ALL" : "ACCEPT_ALL",
      notes: "auto-timeout default"
    };
    this.onDecision(d, bus, logger);
  }
}
