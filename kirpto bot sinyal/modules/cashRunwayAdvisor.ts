/**
 * VIVO-39 · cashRunwayAdvisor.ts
 * Spot/nakit akışını haftalık/aylık planla; %30 spot payı hedefi, 
 * çekme/yatırma/transfer tavsiyeleri üret.
 * Gelişmiş nakit akışı yönetimi ve runway optimizasyonu.
 */

import { EventEmitter } from "events";

// Input Event Types
export interface AccountCashflow {
  event: "account.cashflow";
  timestamp: string;
  inflowUSD: number;
  outflowUSD: number;
  netFlow: number;
  recurring: Array<{
    type: "inflow" | "outflow";
    amountUSD: number;
    frequency: "daily" | "weekly" | "monthly";
    nextDate: string;
    description: string;
  }>;
  holdings: {
    spotUSD: number;
    futuresUSD: number;
    totalUSD: number;
    availableUSD: number;
    lockedUSD: number;
  };
  projections: {
    next7d: number;
    next30d: number;
    next90d: number;
  };
}

export interface PortfolioExposure {
  event: "portfolio.exposure";
  timestamp: string;
  totalRiskPct: number;
  leverage: number;
  ddFromPeak: number;
  positions: Array<{
    symbol: string;
    side: "long" | "short";
    sizeUSD: number;
    riskPct: number;
    unrealizedPnlUSD: number;
  }>;
  margin: {
    usedUSD: number;
    availableUSD: number;
    maintenanceUSD: number;
    marginRatio: number;
  };
}

export interface DailyKPIs {
  event: "daily.kpis";
  timestamp: string;
  pf: number; // Profit factor
  winRate: number;
  avgR: number;
  sharpe: number;
  maxDD: number;
  totalTrades: number;
  grossPnlUSD: number;
  netPnlUSD: number;
  feesUSD: number;
  volatility: number;
}

export interface PolicySnapshot {
  event: "policy.snapshot";
  timestamp: string;
  risk: {
    maxPositionSize: number;
    maxDailyLoss: number;
    allowedVariants: string[];
    emergencyOnly: boolean;
    maxLeverage: number;
  };
  cash: {
    minSpotPct: number;
    maxSpotPct: number;
    emergencyBufferUSD: number;
    rebalanceThresholdPct: number;
  };
  operations: {
    autoTopupEnabled: boolean;
    autoWithdrawEnabled: boolean;
    maxTopupUSD: number;
    maxWithdrawUSD: number;
  };
}

// Output Event Types
export interface CashRunwayPlan {
  event: "cash.runway.plan";
  timestamp: string;
  horizonDays: number;
  currentRunwayDays: number;
  minUSD: number;
  targetSpotPct: number;
  currentSpotPct: number;
  actions: Array<{
    type: "topup" | "withdraw" | "rebalance" | "reduce_risk" | "increase_buffer";
    priority: "urgent" | "high" | "medium" | "low";
    amountUSD: number;
    targetDate: string;
    description: string;
    reasoning: string;
    constraints?: {
      maxAmount?: number;
      minAmount?: number;
      deadlineDate?: string;
    };
  }>;
  projections: {
    with_actions: {
      runwayDays: number;
      spotPct: number;
      bufferUSD: number;
    };
    without_actions: {
      runwayDays: number;
      spotPct: number;
      bufferUSD: number;
    };
  };
  warnings: string[];
  notes: string[];
  audit: {
    calculationMethod: string;
    assumptions: string[];
    riskFactors: string[];
  };
}

// Configuration
export interface CashRunwayConfig {
  targetSpotPct: number;
  minRunwayDays: number;
  ddGuardPct: number;
  pfFloor: number;
  bufferUSD: number;
  rebalance: {
    thresholdPct: number;
    minActionUSD: number;
    maxActionPct: number;
  };
  topup: {
    urgentThresholdDays: number;
    warningThresholdDays: number;
    defaultAmountUSD: number;
    maxAmountUSD: number;
  };
  withdraw: {
    excessThresholdPct: number;
    maxWithdrawPct: number;
    cooldownDays: number;
  };
  risk: {
    ddEmergencyPct: number;
    pfEmergencyFloor: number;
    leverageWarningThreshold: number;
  };
  tz: string;
}

// Internal state interfaces
interface CashflowState {
  currentCashflow: AccountCashflow | null;
  currentExposure: PortfolioExposure | null;
  currentKPIs: DailyKPIs | null;
  currentPolicy: PolicySnapshot | null;
  lastPlan: CashRunwayPlan | null;
  historicalRunway: Array<{ date: Date; runwayDays: number; spotPct: number; }>;
  recentActions: Array<{ date: Date; type: string; amountUSD: number; executed: boolean; }>;
  stats: {
    avgRunwayDays: number;
    avgSpotPct: number;
    topupCount: number;
    withdrawCount: number;
    rebalanceCount: number;
    lastCalculation: Date | null;
  };
}

export interface StdError { code:string; message:string; details?:Record<string,unknown>; retriable?:boolean; }

export class CashRunwayAdvisor extends EventEmitter {
  ver="1.0.0"; src="VIVO-39";
  private config: CashRunwayConfig;
  private state: CashflowState;
  private planInterval?: NodeJS.Timeout;

  constructor(config?: Partial<CashRunwayConfig>) {
    super();
    this.config = {
      targetSpotPct: 0.30,
      minRunwayDays: 30,
      ddGuardPct: 15,
      pfFloor: 1.25,
      bufferUSD: 500,
      rebalance: {
        thresholdPct: 5, // 5% deviation triggers rebalance
        minActionUSD: 100,
        maxActionPct: 20 // Max 20% of holdings per action
      },
      topup: {
        urgentThresholdDays: 7,
        warningThresholdDays: 14,
        defaultAmountUSD: 1000,
        maxAmountUSD: 10000
      },
      withdraw: {
        excessThresholdPct: 50, // 50% above target triggers withdraw
        maxWithdrawPct: 30,
        cooldownDays: 7
      },
      risk: {
        ddEmergencyPct: 20,
        pfEmergencyFloor: 1.0,
        leverageWarningThreshold: 3.0
      },
      tz: "Europe/Istanbul",
      ...config
    };

    this.state = {
      currentCashflow: null,
      currentExposure: null,
      currentKPIs: null,
      currentPolicy: null,
      lastPlan: null,
      historicalRunway: [],
      recentActions: [],
      stats: {
        avgRunwayDays: 0,
        avgSpotPct: 0,
        topupCount: 0,
        withdrawCount: 0,
        rebalanceCount: 0,
        lastCalculation: null
      }
    };

    this.setupPlanningInterval();
  }

  attach(bus: any, logger: any) {
    bus.on("account.cashflow", (data: any) => this.handleAccountCashflow(data, bus, logger));
    bus.on("portfolio.exposure", (data: any) => this.handlePortfolioExposure(data, bus, logger));
    bus.on("daily.kpis", (data: any) => this.handleDailyKPIs(data, bus, logger));
    bus.on("policy.snapshot", (data: any) => this.handlePolicySnapshot(data, logger));
  }

  private handleAccountCashflow(data: any, bus: any, logger: any): void {
    try {
      if (data.event !== "account.cashflow") return;
      
      this.state.currentCashflow = data as AccountCashflow;
      this.updateRunwayHistory();
      
      // Trigger planning calculation
      this.generateRunwayPlan(bus, logger);

    } catch (error: any) {
      if (logger) logger.error({ error: error.message }, "Account cashflow handling failed");
    }
  }

  private handlePortfolioExposure(data: any, bus: any, logger: any): void {
    try {
      if (data.event !== "portfolio.exposure") return;
      
      this.state.currentExposure = data as PortfolioExposure;
      
      // Trigger planning if we have critical risk changes
      if (data.ddFromPeak > this.config.ddGuardPct) {
        this.generateRunwayPlan(bus, logger);
      }

    } catch (error: any) {
      if (logger) logger.error({ error: error.message }, "Portfolio exposure handling failed");
    }
  }

  private handleDailyKPIs(data: any, bus: any, logger: any): void {
    try {
      if (data.event !== "daily.kpis") return;
      
      this.state.currentKPIs = data as DailyKPIs;
      
      // Trigger planning if performance is concerning
      if (data.pf < this.config.pfFloor) {
        this.generateRunwayPlan(bus, logger);
      }

    } catch (error: any) {
      if (logger) logger.error({ error: error.message }, "Daily KPIs handling failed");
    }
  }

  private handlePolicySnapshot(data: any, logger: any): void {
    try {
      if (data.event !== "policy.snapshot") return;
      
      this.state.currentPolicy = data as PolicySnapshot;

    } catch (error: any) {
      if (logger) logger.error({ error: error.message }, "Policy snapshot handling failed");
    }
  }

  private updateRunwayHistory(): void {
    if (!this.state.currentCashflow) return;

    const runwayDays = this.calculateCurrentRunway();
    const spotPct = this.calculateCurrentSpotPct();

    this.state.historicalRunway.push({
      date: new Date(),
      runwayDays,
      spotPct
    });

    // Keep only last 90 days
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 90);
    this.state.historicalRunway = this.state.historicalRunway.filter(h => h.date >= cutoff);

    // Update averages
    if (this.state.historicalRunway.length > 0) {
      this.state.stats.avgRunwayDays = this.state.historicalRunway.reduce((sum, h) => sum + h.runwayDays, 0) / this.state.historicalRunway.length;
      this.state.stats.avgSpotPct = this.state.historicalRunway.reduce((sum, h) => sum + h.spotPct, 0) / this.state.historicalRunway.length;
    }
  }

  private setupPlanningInterval(): void {
    // Generate plan every hour
    this.planInterval = setInterval(() => {
      if (this.state.currentCashflow) {
        this.generateRunwayPlan(null, null);
      }
    }, 60 * 60 * 1000);
  }

  private generateRunwayPlan(bus: any, logger: any): void {
    try {
      if (!this.state.currentCashflow) {
        if (logger) logger.warn("Cannot generate runway plan without cashflow data");
        return;
      }

      const currentRunwayDays = this.calculateCurrentRunway();
      const currentSpotPct = this.calculateCurrentSpotPct();
      const actions = this.calculateRequiredActions();
      const projections = this.calculateProjections(actions);
      const warnings = this.generateWarnings();
      const notes = this.generateNotes();

      const plan: CashRunwayPlan = {
        event: "cash.runway.plan",
        timestamp: new Date().toISOString(),
        horizonDays: this.config.minRunwayDays,
        currentRunwayDays,
        minUSD: this.config.bufferUSD,
        targetSpotPct: this.config.targetSpotPct,
        currentSpotPct,
        actions,
        projections,
        warnings,
        notes,
        audit: {
          calculationMethod: "linear_projection_with_recurring",
          assumptions: [
            "Current spending patterns continue",
            "Recurring flows maintain schedule",
            "Market conditions remain stable"
          ],
          riskFactors: this.identifyRiskFactors()
        }
      };

      this.state.lastPlan = plan;
      this.state.stats.lastCalculation = new Date();

      this.emit("cash.runway.plan", plan);
      if (bus) bus.emit("cash.runway.plan", plan);

      if (logger) logger.info({
        currentRunway: currentRunwayDays,
        targetSpot: this.config.targetSpotPct,
        currentSpot: currentSpotPct,
        actionsCount: actions.length,
        urgentActions: actions.filter(a => a.priority === "urgent").length
      }, "Cash runway plan generated");

    } catch (error: any) {
      if (logger) logger.error({ error: error.message }, "Runway plan generation failed");
    }
  }

  private calculateCurrentRunway(): number {
    if (!this.state.currentCashflow) return 0;

    const cashflow = this.state.currentCashflow;
    const availableCash = cashflow.holdings.spotUSD + cashflow.holdings.availableUSD;
    
    // Calculate daily outflow (including recurring)
    let dailyOutflow = Math.abs(cashflow.outflowUSD);
    
    // Add recurring outflows
    for (const recurring of cashflow.recurring) {
      if (recurring.type === "outflow") {
        const dailyAmount = this.convertToDaily(recurring.amountUSD, recurring.frequency);
        dailyOutflow += dailyAmount;
      }
    }

    if (dailyOutflow <= 0) return 9999; // Infinite runway if no outflow

    return Math.max(0, (availableCash - this.config.bufferUSD) / dailyOutflow);
  }

  private calculateCurrentSpotPct(): number {
    if (!this.state.currentCashflow) return 0;

    const cashflow = this.state.currentCashflow;
    const totalUSD = cashflow.holdings.totalUSD;
    
    if (totalUSD <= 0) return 0;
    
    return cashflow.holdings.spotUSD / totalUSD;
  }

  private convertToDaily(amount: number, frequency: "daily" | "weekly" | "monthly"): number {
    switch (frequency) {
      case "daily": return amount;
      case "weekly": return amount / 7;
      case "monthly": return amount / 30;
      default: return 0;
    }
  }

  private calculateRequiredActions(): Array<any> {
    const actions: Array<any> = [];
    
    if (!this.state.currentCashflow) return actions;

    const currentRunway = this.calculateCurrentRunway();
    const currentSpotPct = this.calculateCurrentSpotPct();
    const spotDeviation = Math.abs(currentSpotPct - this.config.targetSpotPct);

    // 1. Urgent runway issues
    if (currentRunway < this.config.topup.urgentThresholdDays) {
      const requiredUSD = this.calculateTopupAmount(currentRunway);
      actions.push({
        type: "topup",
        priority: "urgent",
        amountUSD: requiredUSD,
        targetDate: this.addDays(new Date(), 1).toISOString(),
        description: `Urgent topup required - runway critically low`,
        reasoning: `Current runway ${currentRunway.toFixed(1)} days < ${this.config.topup.urgentThresholdDays} day threshold`,
        constraints: {
          maxAmount: this.config.topup.maxAmountUSD,
          deadlineDate: this.addDays(new Date(), 2).toISOString()
        }
      });
    } else if (currentRunway < this.config.topup.warningThresholdDays) {
      const requiredUSD = this.calculateTopupAmount(currentRunway);
      actions.push({
        type: "topup",
        priority: "high",
        amountUSD: requiredUSD,
        targetDate: this.addDays(new Date(), 3).toISOString(),
        description: `Topup recommended - runway below warning threshold`,
        reasoning: `Current runway ${currentRunway.toFixed(1)} days < ${this.config.topup.warningThresholdDays} day threshold`
      });
    }

    // 2. Risk reduction due to drawdown
    if (this.state.currentExposure && this.state.currentExposure.ddFromPeak > this.config.ddGuardPct) {
      const riskReduction = Math.min(50, this.state.currentExposure.ddFromPeak * 2); // Percentage
      actions.push({
        type: "reduce_risk",
        priority: "high",
        amountUSD: 0, // Risk reduction, not cash amount
        targetDate: new Date().toISOString(),
        description: `Reduce risk exposure due to drawdown`,
        reasoning: `Current drawdown ${this.state.currentExposure.ddFromPeak.toFixed(1)}% > ${this.config.ddGuardPct}% threshold`,
        constraints: {
          maxAmount: riskReduction
        }
      });
    }

    // 3. Performance-based conservative actions
    if (this.state.currentKPIs && this.state.currentKPIs.pf < this.config.pfFloor) {
      actions.push({
        type: "increase_buffer",
        priority: "medium",
        amountUSD: this.config.bufferUSD,
        targetDate: this.addDays(new Date(), 7).toISOString(),
        description: `Increase cash buffer due to poor performance`,
        reasoning: `Profit factor ${this.state.currentKPIs.pf.toFixed(2)} < ${this.config.pfFloor} threshold`
      });
    }

    // 4. Spot percentage rebalancing
    if (spotDeviation > this.config.rebalance.thresholdPct / 100) {
      const rebalanceAmount = this.calculateRebalanceAmount(currentSpotPct);
      const isIncrease = currentSpotPct < this.config.targetSpotPct;
      
      actions.push({
        type: "rebalance",
        priority: "medium",
        amountUSD: Math.abs(rebalanceAmount),
        targetDate: this.addDays(new Date(), 5).toISOString(),
        description: `${isIncrease ? 'Increase' : 'Decrease'} spot allocation to target`,
        reasoning: `Current spot ${(currentSpotPct * 100).toFixed(1)}% vs target ${(this.config.targetSpotPct * 100).toFixed(1)}%`,
        constraints: {
          maxAmount: this.state.currentCashflow.holdings.totalUSD * this.config.rebalance.maxActionPct / 100
        }
      });
    }

    // 5. Excess cash withdrawal
    const excessThreshold = this.config.targetSpotPct * (1 + this.config.withdraw.excessThresholdPct / 100);
    if (currentSpotPct > excessThreshold && this.canWithdraw()) {
      const excessAmount = this.calculateExcessAmount(currentSpotPct);
      actions.push({
        type: "withdraw",
        priority: "low",
        amountUSD: excessAmount,
        targetDate: this.addDays(new Date(), 14).toISOString(),
        description: `Withdraw excess cash above target threshold`,
        reasoning: `Spot allocation ${(currentSpotPct * 100).toFixed(1)}% > ${(excessThreshold * 100).toFixed(1)}% excess threshold`,
        constraints: {
          maxAmount: this.state.currentCashflow.holdings.totalUSD * this.config.withdraw.maxWithdrawPct / 100
        }
      });
    }

    // Sort actions by priority
    const priorityOrder: Record<string, number> = { urgent: 4, high: 3, medium: 2, low: 1 };
    actions.sort((a, b) => (priorityOrder[b.priority] || 0) - (priorityOrder[a.priority] || 0));

    return actions;
  }

  private calculateTopupAmount(currentRunway: number): number {
    const shortfall = this.config.minRunwayDays - currentRunway;
    const dailyOutflow = this.getDailyOutflow();
    const requiredAmount = shortfall * dailyOutflow + this.config.bufferUSD;
    
    return Math.min(
      Math.max(requiredAmount, this.config.topup.defaultAmountUSD),
      this.config.topup.maxAmountUSD
    );
  }

  private calculateRebalanceAmount(currentSpotPct: number): number {
    if (!this.state.currentCashflow) return 0;

    const totalUSD = this.state.currentCashflow.holdings.totalUSD;
    const targetSpotUSD = totalUSD * this.config.targetSpotPct;
    const currentSpotUSD = this.state.currentCashflow.holdings.spotUSD;
    
    return targetSpotUSD - currentSpotUSD;
  }

  private calculateExcessAmount(currentSpotPct: number): number {
    if (!this.state.currentCashflow) return 0;

    const totalUSD = this.state.currentCashflow.holdings.totalUSD;
    const targetSpotUSD = totalUSD * this.config.targetSpotPct;
    const currentSpotUSD = this.state.currentCashflow.holdings.spotUSD;
    const excess = currentSpotUSD - targetSpotUSD;
    
    // Withdraw only portion of excess to avoid frequent adjustments
    return Math.max(0, excess * 0.5);
  }

  private getDailyOutflow(): number {
    if (!this.state.currentCashflow) return 0;

    let dailyOutflow = Math.abs(this.state.currentCashflow.outflowUSD);
    
    for (const recurring of this.state.currentCashflow.recurring) {
      if (recurring.type === "outflow") {
        dailyOutflow += this.convertToDaily(recurring.amountUSD, recurring.frequency);
      }
    }

    return Math.max(dailyOutflow, 10); // Minimum $10/day assumption
  }

  private canWithdraw(): boolean {
    // Check cooldown period
    const lastWithdraw = this.state.recentActions
      .filter(a => a.type === "withdraw")
      .sort((a, b) => b.date.getTime() - a.date.getTime())[0];

    if (lastWithdraw) {
      const daysSince = (Date.now() - lastWithdraw.date.getTime()) / (1000 * 60 * 60 * 24);
      if (daysSince < this.config.withdraw.cooldownDays) {
        return false;
      }
    }

    // Check policy permissions
    if (this.state.currentPolicy && !this.state.currentPolicy.operations.autoWithdrawEnabled) {
      return false;
    }

    return true;
  }

  private calculateProjections(actions: Array<any>): any {
    const withActions = this.projectWithActions(actions);
    const withoutActions = this.projectWithoutActions();

    return {
      with_actions: withActions,
      without_actions: withoutActions
    };
  }

  private projectWithActions(actions: Array<any>): any {
    let projectedSpotUSD = this.state.currentCashflow?.holdings.spotUSD || 0;
    let projectedTotalUSD = this.state.currentCashflow?.holdings.totalUSD || 0;

    for (const action of actions) {
      switch (action.type) {
        case "topup":
          projectedSpotUSD += action.amountUSD;
          projectedTotalUSD += action.amountUSD;
          break;
        case "withdraw":
          projectedSpotUSD -= action.amountUSD;
          projectedTotalUSD -= action.amountUSD;
          break;
        case "rebalance":
          // Rebalancing doesn't change total, just allocation
          break;
      }
    }

    const projectedSpotPct = projectedTotalUSD > 0 ? projectedSpotUSD / projectedTotalUSD : 0;
    const projectedRunwayDays = this.calculateProjectedRunway(projectedSpotUSD);

    return {
      runwayDays: projectedRunwayDays,
      spotPct: projectedSpotPct,
      bufferUSD: this.config.bufferUSD
    };
  }

  private projectWithoutActions(): any {
    const currentRunway = this.calculateCurrentRunway();
    const currentSpotPct = this.calculateCurrentSpotPct();

    return {
      runwayDays: currentRunway,
      spotPct: currentSpotPct,
      bufferUSD: this.config.bufferUSD
    };
  }

  private calculateProjectedRunway(projectedSpotUSD: number): number {
    const dailyOutflow = this.getDailyOutflow();
    if (dailyOutflow <= 0) return 9999;

    return Math.max(0, (projectedSpotUSD - this.config.bufferUSD) / dailyOutflow);
  }

  private generateWarnings(): string[] {
    const warnings: string[] = [];

    const currentRunway = this.calculateCurrentRunway();
    if (currentRunway < this.config.topup.urgentThresholdDays) {
      warnings.push(`Critical: Runway only ${currentRunway.toFixed(1)} days remaining`);
    }

    if (this.state.currentExposure && this.state.currentExposure.ddFromPeak > this.config.risk.ddEmergencyPct) {
      warnings.push(`Emergency: Drawdown ${this.state.currentExposure.ddFromPeak.toFixed(1)}% exceeds emergency threshold`);
    }

    if (this.state.currentKPIs && this.state.currentKPIs.pf < this.config.risk.pfEmergencyFloor) {
      warnings.push(`Emergency: Profit factor ${this.state.currentKPIs.pf.toFixed(2)} below emergency floor`);
    }

    if (this.state.currentExposure && this.state.currentExposure.leverage > this.config.risk.leverageWarningThreshold) {
      warnings.push(`Warning: Leverage ${this.state.currentExposure.leverage.toFixed(1)}x above warning threshold`);
    }

    return warnings;
  }

  private generateNotes(): string[] {
    const notes: string[] = [];

    if (this.state.historicalRunway.length > 7) {
      const recentAvg = this.state.historicalRunway.slice(-7).reduce((sum, h) => sum + h.runwayDays, 0) / 7;
      notes.push(`7-day average runway: ${recentAvg.toFixed(1)} days`);
    }

    if (this.state.currentCashflow && this.state.currentCashflow.recurring.length > 0) {
      const recurringInflow = this.state.currentCashflow.recurring
        .filter(r => r.type === "inflow")
        .reduce((sum, r) => sum + this.convertToDaily(r.amountUSD, r.frequency), 0);
      
      if (recurringInflow > 0) {
        notes.push(`Daily recurring inflow: $${recurringInflow.toFixed(2)}`);
      }
    }

    return notes;
  }

  private identifyRiskFactors(): string[] {
    const factors: string[] = [];

    if (this.state.currentExposure?.leverage && this.state.currentExposure.leverage > 2) {
      factors.push("High leverage exposure");
    }

    // Add more risk factor checks here as needed
    
    return factors;
  }

  private addDays(date: Date, days: number): Date {
    const result = new Date(date);
    result.setDate(result.getDate() + days);
    return result;
  }

  // Public methods
  getStatus(): any {
    return {
      currentRunway: this.calculateCurrentRunway(),
      currentSpotPct: this.calculateCurrentSpotPct(),
      lastPlan: this.state.lastPlan ? {
        timestamp: this.state.lastPlan.timestamp,
        actionsCount: this.state.lastPlan.actions.length,
        warningsCount: this.state.lastPlan.warnings.length
      } : null,
      stats: { ...this.state.stats },
      config: {
        targetSpotPct: this.config.targetSpotPct,
        minRunwayDays: this.config.minRunwayDays,
        bufferUSD: this.config.bufferUSD
      },
      historicalData: {
        dataPoints: this.state.historicalRunway.length,
        avgRunway: this.state.stats.avgRunwayDays,
        avgSpotPct: this.state.stats.avgSpotPct
      }
    };
  }

  updateConfig(updates: Partial<CashRunwayConfig>): void {
    this.config = { ...this.config, ...updates };
  }

  // Force plan generation (for testing)
  forceGeneratePlan(bus: any, logger: any): void {
    this.generateRunwayPlan(bus, logger);
  }

  // Get current plan without regeneration
  getCurrentPlan(): CashRunwayPlan | null {
    return this.state.lastPlan;
  }

  // Cleanup
  shutdown(): void {
    if (this.planInterval) {
      clearInterval(this.planInterval);
    }
  }
}
