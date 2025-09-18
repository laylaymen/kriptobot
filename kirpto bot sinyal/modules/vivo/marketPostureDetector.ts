/**
 * VIVO-22 · marketPostureDetector.ts
 * Market postür belirleyici - bull/bear/sideways market regime detection ve trading ayarları.
 * Advanced market regime classification with adaptive trading parameter adjustment.
 */

import { EventEmitter } from "events";

// Types for VIVO-22
export interface MarketData {
  symbol: string;
  price: number;
  volume: number;
  timestamp: string;
  timeframe: "1m"|"5m"|"15m"|"1h"|"4h"|"1d";
}

export interface MarketPosture {
  symbol: string;
  regime: "bull_strong"|"bull_weak"|"bear_strong"|"bear_weak"|"sideways_tight"|"sideways_loose"|"volatile"|"quiet";
  confidence: number;          // 0..1
  
  // Trend metrics
  trend: {
    direction: "up"|"down"|"sideways";
    strength: number;           // 0..1
    duration: number;           // bars/periods in current trend
    slope: number;              // price change per period
    consistency: number;        // 0..1 how consistent the trend is
  };
  
  // Volatility metrics
  volatility: {
    regime: "low"|"medium"|"high"|"extreme";
    atr: number;                // Average True Range
    atrNormalized: number;      // ATR / price ratio
    realizedVol: number;        // historical volatility
    volRank: number;            // 0..1 percentile
    expanding: boolean;         // volatility increasing
  };
  
  // Volume characteristics
  volume: {
    trend: "increasing"|"decreasing"|"stable";
    profile: "accumulation"|"distribution"|"rotation"|"breakout";
    volumeMA: number;           // volume moving average
    volumeRatio: number;        // current vs average
    volumeBreakout: boolean;    // volume spike detected
  };
  
  // Support/Resistance context
  structure: {
    nearSupport: boolean;
    nearResistance: boolean;
    supportDistance: number;    // % away from support
    resistanceDistance: number; // % away from resistance
    rangeHigh: number;
    rangeLow: number;
    rangePosition: number;      // 0..1 position within range
  };
  
  // Market momentum
  momentum: {
    shortTerm: number;          // 1-5 periods momentum
    mediumTerm: number;         // 5-20 periods momentum
    longTerm: number;           // 20-50 periods momentum
    rsi: number;                // RSI indicator
    macdSignal: "bullish"|"bearish"|"neutral";
    divergence: "bullish"|"bearish"|"none";
  };
  
  // Regime classification metadata
  meta: {
    lastRegimeChange: string;
    regimeDuration: number;     // how long in current regime
    previousRegime: string;
    regimeStability: number;    // 0..1 how stable the regime is
    transitionProbability: number; // 0..1 probability of regime change
  };
  
  timestamp: string;
}

export interface TradingAdjustments {
  symbol: string;
  currentRegime: string;
  
  // Position sizing adjustments
  positionSizing: {
    sizeMultiplier: number;     // multiply base size by this
    maxPositionsInRegime: number;
    riskReductionFactor: number; // reduce risk in uncertain conditions
  };
  
  // Entry/Exit adjustments
  entries: {
    aggressiveness: "conservative"|"normal"|"aggressive";
    entryTypes: string[];       // preferred order types for this regime
    timingBias: "early"|"normal"|"late";
    confirmationRequired: boolean;
  };
  
  exits: {
    takeProfitMultiplier: number; // adjust TP distances
    stopLossMultiplier: number;   // adjust SL distances
    trailingStops: boolean;
    quickExitConditions: string[];
  };
  
  // Risk management adjustments
  riskManagement: {
    correlationLimits: "tight"|"normal"|"relaxed";
    portfolioHeatLimit: number;   // % of portfolio at risk
    maxDrawdownTolerance: number;
    hedgingRecommended: boolean;
  };
  
  // Strategy preferences
  strategies: {
    preferred: string[];          // strategies that work well in this regime
    avoid: string[];             // strategies to avoid
    adaptations: Record<string, any>; // specific strategy adjustments
  };
  
  // Time-based adjustments
  timing: {
    sessionBias: "asia"|"europe"|"us"|"overlap"|"any";
    timeOfDayPreference: string[];
    avoidPeriods: string[];      // times to avoid trading
  };
  
  validUntil: string;
  lastUpdate: string;
}

export interface PostureConfig {
  // Regime detection parameters
  trendLookback: number;           // 20 periods for trend analysis
  volatilityLookback: number;      // 14 periods for volatility
  volumeLookback: number;          // 10 periods for volume analysis
  
  // Trend thresholds
  strongTrendThreshold: number;    // 0.7
  weakTrendThreshold: number;      // 0.3
  sidewaysThreshold: number;       // 0.2
  
  // Volatility thresholds
  lowVolThreshold: number;         // 0.3 percentile
  mediumVolThreshold: number;      // 0.7 percentile
  highVolThreshold: number;        // 0.9 percentile
  
  // Volume thresholds
  volumeBreakoutThreshold: number; // 2.0 (2x average volume)
  volumeTrendThreshold: number;    // 0.3
  
  // Confidence calculation
  minConfidence: number;           // 0.5
  maxConfidence: number;           // 0.95
  confidenceDecayPeriods: number;  // 5 periods without confirmation
  
  // Regime stability
  minRegimeDuration: number;       // 3 periods minimum
  regimeChangeThreshold: number;   // 0.8 confidence to change regime
  
  // Adjustment parameters
  conservativeMultiplier: number;  // 0.7
  aggressiveMultiplier: number;    // 1.3
  volatileReduction: number;       // 0.5
  uncertaintyReduction: number;    // 0.6
}

export interface StdError { code:string; message:string; details?:Record<string,unknown>; retriable?:boolean; }

const clamp = (x:number, lo:number, hi:number)=> Math.max(lo, Math.min(hi, x));

export class MarketPostureDetector extends EventEmitter {
  ver="1.0.0"; src="VIVO-22";
  private config: PostureConfig;
  private marketHistory = new Map<string, MarketData[]>();
  private currentPostures = new Map<string, MarketPosture>();
  private adjustmentCache = new Map<string, TradingAdjustments>();

  constructor(config?: Partial<PostureConfig>) {
    super();
    this.config = {
      trendLookback: 20,
      volatilityLookback: 14,
      volumeLookback: 10,
      strongTrendThreshold: 0.7,
      weakTrendThreshold: 0.3,
      sidewaysThreshold: 0.2,
      lowVolThreshold: 0.3,
      mediumVolThreshold: 0.7,
      highVolThreshold: 0.9,
      volumeBreakoutThreshold: 2.0,
      volumeTrendThreshold: 0.3,
      minConfidence: 0.5,
      maxConfidence: 0.95,
      confidenceDecayPeriods: 5,
      minRegimeDuration: 3,
      regimeChangeThreshold: 0.8,
      conservativeMultiplier: 0.7,
      aggressiveMultiplier: 1.3,
      volatileReduction: 0.5,
      uncertaintyReduction: 0.6,
      ...config
    };
  }

  attach(bus: any, logger: any) {
    // Market data updates
    bus.on("market.data.update", (data: any) => this.processMarketData(data, bus, logger));
    bus.on("market.candle.close", (candle: any) => this.processCandle(candle, bus, logger));
    
    // Requests for posture/adjustments
    bus.on("market.posture.request", (request: any) => this.handlePostureRequest(request, bus));
    bus.on("trading.adjustments.request", (request: any) => this.handleAdjustmentsRequest(request, bus));
    
    // Periodic regime validation
    setInterval(() => this.validateRegimes(bus, logger), 60000); // every minute
    
    // Cleanup old data
    setInterval(() => this.cleanupOldData(), 300000); // every 5 minutes
  }

  private processMarketData(data: MarketData, bus: any, logger: any) {
    try {
      // Add to history
      if (!this.marketHistory.has(data.symbol)) {
        this.marketHistory.set(data.symbol, []);
      }

      const history = this.marketHistory.get(data.symbol)!;
      history.push(data);

      // Keep manageable history size
      if (history.length > 200) {
        history.splice(0, history.length - 200);
      }

      // Need minimum data for analysis
      if (history.length < this.config.trendLookback) {
        return;
      }

      // Analyze market posture
      const posture = this.analyzeMarketPosture(data.symbol, history);
      
      // Check for regime change
      const previousPosture = this.currentPostures.get(data.symbol);
      const regimeChanged = this.isRegimeChange(previousPosture, posture);

      if (regimeChanged || !previousPosture) {
        this.currentPostures.set(data.symbol, posture);
        
        // Generate trading adjustments
        const adjustments = this.generateTradingAdjustments(posture);
        this.adjustmentCache.set(data.symbol, adjustments);

        // Emit updates
        bus.emit("market.posture.update", posture);
        bus.emit("trading.adjustments.update", adjustments);

        if (regimeChanged && logger) {
          logger.info({
            symbol: data.symbol,
            previousRegime: previousPosture?.regime,
            newRegime: posture.regime,
            confidence: posture.confidence
          }, "VIVO-22 market regime change detected");
        }
      }

    } catch (e: any) {
      if (logger) logger.error({ e }, "VIVO-22 processMarketData failed");
    }
  }

  private processCandle(candle: any, bus: any, logger: any) {
    const marketData: MarketData = {
      symbol: candle.symbol,
      price: candle.close,
      volume: candle.volume,
      timestamp: candle.closeTime,
      timeframe: candle.timeframe || "1h"
    };

    this.processMarketData(marketData, bus, logger);
  }

  private analyzeMarketPosture(symbol: string, history: MarketData[]): MarketPosture {
    const latest = history[history.length - 1];
    
    // Calculate trend metrics
    const trendMetrics = this.calculateTrendMetrics(history);
    
    // Calculate volatility metrics
    const volatilityMetrics = this.calculateVolatilityMetrics(history);
    
    // Calculate volume metrics
    const volumeMetrics = this.calculateVolumeMetrics(history);
    
    // Calculate structure metrics
    const structureMetrics = this.calculateStructureMetrics(history);
    
    // Calculate momentum metrics
    const momentumMetrics = this.calculateMomentumMetrics(history);
    
    // Classify regime
    const regimeInfo = this.classifyRegime(trendMetrics, volatilityMetrics, volumeMetrics, momentumMetrics);
    
    // Calculate metadata
    const previousPosture = this.currentPostures.get(symbol);
    const metaInfo = this.calculateRegimeMetadata(regimeInfo.regime, previousPosture);

    return {
      symbol,
      regime: regimeInfo.regime,
      confidence: regimeInfo.confidence,
      trend: trendMetrics,
      volatility: volatilityMetrics,
      volume: volumeMetrics,
      structure: structureMetrics,
      momentum: momentumMetrics,
      meta: metaInfo,
      timestamp: latest.timestamp
    };
  }

  private calculateTrendMetrics(history: MarketData[]): MarketPosture['trend'] {
    const prices = history.map(d => d.price);
    const lookback = Math.min(this.config.trendLookback, history.length);
    const recent = prices.slice(-lookback);

    // Linear regression for trend
    const x = Array.from({length: recent.length}, (_, i) => i);
    const y = recent;
    
    const n = recent.length;
    const sumX = x.reduce((a, b) => a + b, 0);
    const sumY = y.reduce((a, b) => a + b, 0);
    const sumXY = x.reduce((sum, xi, i) => sum + xi * y[i], 0);
    const sumXX = x.reduce((sum, xi) => sum + xi * xi, 0);
    
    const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
    const intercept = (sumY - slope * sumX) / n;
    
    // R-squared for trend strength
    const yMean = sumY / n;
    const ssRes = y.reduce((sum, yi, i) => {
      const predicted = slope * x[i] + intercept;
      return sum + Math.pow(yi - predicted, 2);
    }, 0);
    const ssTot = y.reduce((sum, yi) => sum + Math.pow(yi - yMean, 2), 0);
    const rSquared = 1 - (ssRes / ssTot);
    
    // Determine direction and strength
    const direction = slope > 0 ? "up" : slope < 0 ? "down" : "sideways";
    const strength = Math.abs(slope) / recent[0] * 100; // percentage slope
    const normalizedStrength = clamp(rSquared, 0, 1);
    
    // Calculate trend duration
    let duration = 1;
    const currentDirection = direction;
    for (let i = recent.length - 2; i >= 0; i--) {
      const prevSlope = (recent[i + 1] - recent[i]) / recent[i];
      const prevDirection = prevSlope > 0 ? "up" : prevSlope < 0 ? "down" : "sideways";
      if (prevDirection === currentDirection) {
        duration++;
      } else {
        break;
      }
    }

    // Consistency measure
    let consistency = 0;
    if (direction !== "sideways") {
      const directionalMoves = recent.slice(1).filter((price, i) => {
        const prevPrice = recent[i];
        return direction === "up" ? price > prevPrice : price < prevPrice;
      }).length;
      consistency = directionalMoves / (recent.length - 1);
    }

    return {
      direction,
      strength: normalizedStrength,
      duration,
      slope,
      consistency
    };
  }

  private calculateVolatilityMetrics(history: MarketData[]): MarketPosture['volatility'] {
    const prices = history.map(d => d.price);
    const lookback = Math.min(this.config.volatilityLookback, history.length);
    const recent = prices.slice(-lookback);

    // ATR calculation (simplified)
    let atrSum = 0;
    for (let i = 1; i < recent.length; i++) {
      const tr = Math.abs(recent[i] - recent[i - 1]);
      atrSum += tr;
    }
    const atr = atrSum / (recent.length - 1);
    const atrNormalized = atr / recent[recent.length - 1];

    // Realized volatility
    const returns = recent.slice(1).map((price, i) => Math.log(price / recent[i]));
    const meanReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((sum, ret) => sum + Math.pow(ret - meanReturn, 2), 0) / returns.length;
    const realizedVol = Math.sqrt(variance * 252); // annualized

    // Volatility rank (percentile vs historical)
    const allPrices = history.map(d => d.price);
    const allVols: number[] = [];
    for (let i = lookback; i < allPrices.length; i++) {
      const slice = allPrices.slice(i - lookback, i);
      let sliceAtr = 0;
      for (let j = 1; j < slice.length; j++) {
        sliceAtr += Math.abs(slice[j] - slice[j - 1]);
      }
      allVols.push(sliceAtr / (slice.length - 1));
    }
    
    const sortedVols = [...allVols].sort((a, b) => a - b);
    const volRank = allVols.length > 0 ? 
      sortedVols.findIndex(v => v >= atr) / sortedVols.length : 0.5;

    // Volatility regime classification
    let regime: "low"|"medium"|"high"|"extreme";
    if (volRank < this.config.lowVolThreshold) regime = "low";
    else if (volRank < this.config.mediumVolThreshold) regime = "medium";
    else if (volRank < this.config.highVolThreshold) regime = "high";
    else regime = "extreme";

    // Check if volatility is expanding
    const recentVol = recent.slice(-5);
    const earlierVol = recent.slice(-10, -5);
    const recentAvgVol = this.calculateAverageVolatility(recentVol);
    const earlierAvgVol = this.calculateAverageVolatility(earlierVol);
    const expanding = recentAvgVol > earlierAvgVol * 1.2;

    return {
      regime,
      atr,
      atrNormalized,
      realizedVol,
      volRank,
      expanding
    };
  }

  private calculateAverageVolatility(prices: number[]): number {
    if (prices.length < 2) return 0;
    let sum = 0;
    for (let i = 1; i < prices.length; i++) {
      sum += Math.abs(prices[i] - prices[i - 1]);
    }
    return sum / (prices.length - 1);
  }

  private calculateVolumeMetrics(history: MarketData[]): MarketPosture['volume'] {
    const volumes = history.map(d => d.volume);
    const lookback = Math.min(this.config.volumeLookback, history.length);
    const recent = volumes.slice(-lookback);

    // Volume moving average
    const volumeMA = recent.reduce((a, b) => a + b, 0) / recent.length;
    const currentVolume = recent[recent.length - 1];
    const volumeRatio = currentVolume / volumeMA;

    // Volume trend
    const earlyVolumes = recent.slice(0, Math.floor(recent.length / 2));
    const lateVolumes = recent.slice(Math.floor(recent.length / 2));
    const earlyAvg = earlyVolumes.reduce((a, b) => a + b, 0) / earlyVolumes.length;
    const lateAvg = lateVolumes.reduce((a, b) => a + b, 0) / lateVolumes.length;
    
    let trend: "increasing"|"decreasing"|"stable";
    const volumeChange = (lateAvg - earlyAvg) / earlyAvg;
    if (volumeChange > this.config.volumeTrendThreshold) trend = "increasing";
    else if (volumeChange < -this.config.volumeTrendThreshold) trend = "decreasing";
    else trend = "stable";

    // Volume breakout detection
    const volumeBreakout = volumeRatio > this.config.volumeBreakoutThreshold;

    // Volume profile classification (simplified)
    let profile: "accumulation"|"distribution"|"rotation"|"breakout";
    if (volumeBreakout) profile = "breakout";
    else if (trend === "increasing" && volumeRatio > 1.2) profile = "accumulation";
    else if (trend === "decreasing" && volumeRatio < 0.8) profile = "distribution";
    else profile = "rotation";

    return {
      trend,
      profile,
      volumeMA,
      volumeRatio,
      volumeBreakout
    };
  }

  private calculateStructureMetrics(history: MarketData[]): MarketPosture['structure'] {
    const prices = history.map(d => d.price);
    const currentPrice = prices[prices.length - 1];
    
    // Find recent highs and lows (simplified S/R)
    const lookback = Math.min(50, history.length);
    const recent = prices.slice(-lookback);
    
    const rangeHigh = Math.max(...recent);
    const rangeLow = Math.min(...recent);
    const rangeSize = rangeHigh - rangeLow;
    
    // Support/Resistance proximity
    const supportDistance = ((currentPrice - rangeLow) / rangeLow) * 100;
    const resistanceDistance = ((rangeHigh - currentPrice) / currentPrice) * 100;
    
    const nearSupport = supportDistance < 2; // within 2%
    const nearResistance = resistanceDistance < 2; // within 2%
    
    // Position within range
    const rangePosition = rangeSize > 0 ? (currentPrice - rangeLow) / rangeSize : 0.5;

    return {
      nearSupport,
      nearResistance,
      supportDistance,
      resistanceDistance,
      rangeHigh,
      rangeLow,
      rangePosition
    };
  }

  private calculateMomentumMetrics(history: MarketData[]): MarketPosture['momentum'] {
    const prices = history.map(d => d.price);
    const currentPrice = prices[prices.length - 1];

    // Short, medium, long term momentum
    const periods = [5, 20, 50];
    const momentums = periods.map(period => {
      if (prices.length < period + 1) return 0;
      const oldPrice = prices[prices.length - period - 1];
      return ((currentPrice - oldPrice) / oldPrice) * 100;
    });

    // RSI calculation (simplified)
    const rsiPeriod = 14;
    let rsi = 50; // default neutral
    if (prices.length >= rsiPeriod + 1) {
      const changes = prices.slice(-rsiPeriod - 1).map((price, i, arr) => 
        i > 0 ? price - arr[i - 1] : 0
      ).slice(1);
      
      const gains = changes.filter(c => c > 0);
      const losses = changes.filter(c => c < 0).map(c => Math.abs(c));
      
      const avgGain = gains.length > 0 ? gains.reduce((a, b) => a + b, 0) / gains.length : 0;
      const avgLoss = losses.length > 0 ? losses.reduce((a, b) => a + b, 0) / losses.length : 0;
      
      if (avgLoss > 0) {
        const rs = avgGain / avgLoss;
        rsi = 100 - (100 / (1 + rs));
      }
    }

    // MACD signal (simplified)
    let macdSignal: "bullish"|"bearish"|"neutral" = "neutral";
    if (momentums[0] > momentums[1] && momentums[1] > 0) macdSignal = "bullish";
    else if (momentums[0] < momentums[1] && momentums[1] < 0) macdSignal = "bearish";

    // Divergence detection (simplified)
    const divergence = "none"; // Would need more complex price/momentum analysis

    return {
      shortTerm: momentums[0],
      mediumTerm: momentums[1],
      longTerm: momentums[2],
      rsi,
      macdSignal,
      divergence
    };
  }

  private classifyRegime(
    trend: MarketPosture['trend'], 
    volatility: MarketPosture['volatility'], 
    volume: MarketPosture['volume'], 
    momentum: MarketPosture['momentum']
  ): {regime: MarketPosture['regime'], confidence: number} {
    
    let regime: MarketPosture['regime'];
    let confidence = this.config.minConfidence;

    // Primary classification based on trend and volatility
    if (trend.direction === "up") {
      if (trend.strength > this.config.strongTrendThreshold) {
        regime = "bull_strong";
        confidence = Math.min(this.config.maxConfidence, trend.strength + 0.1);
      } else if (trend.strength > this.config.weakTrendThreshold) {
        regime = "bull_weak";
        confidence = trend.strength;
      } else {
        regime = "sideways_loose";
        confidence = this.config.minConfidence;
      }
    } else if (trend.direction === "down") {
      if (trend.strength > this.config.strongTrendThreshold) {
        regime = "bear_strong";
        confidence = Math.min(this.config.maxConfidence, trend.strength + 0.1);
      } else if (trend.strength > this.config.weakTrendThreshold) {
        regime = "bear_weak";
        confidence = trend.strength;
      } else {
        regime = "sideways_loose";
        confidence = this.config.minConfidence;
      }
    } else {
      // Sideways market
      if (volatility.regime === "low") {
        regime = "sideways_tight";
      } else {
        regime = "sideways_loose";
      }
      confidence = this.config.minConfidence + 0.1;
    }

    // Adjust for volatility extremes
    if (volatility.regime === "extreme") {
      regime = "volatile";
      confidence = Math.max(confidence, 0.7);
    } else if (volatility.regime === "low" && volume.trend === "decreasing") {
      regime = "quiet";
      confidence = Math.max(confidence, 0.6);
    }

    // Confirmation from momentum
    if (momentum.macdSignal === "bullish" && (regime === "bull_strong" || regime === "bull_weak")) {
      confidence += 0.1;
    } else if (momentum.macdSignal === "bearish" && (regime === "bear_strong" || regime === "bear_weak")) {
      confidence += 0.1;
    }

    // Volume confirmation
    if (volume.volumeBreakout && (regime.includes("bull") || regime.includes("bear"))) {
      confidence += 0.1;
    }

    // Consistency bonus
    if (trend.consistency > 0.7) {
      confidence += 0.1;
    }

    confidence = clamp(confidence, this.config.minConfidence, this.config.maxConfidence);

    return { regime, confidence };
  }

  private calculateRegimeMetadata(regime: string, previousPosture?: MarketPosture): MarketPosture['meta'] {
    const now = new Date().toISOString();
    
    if (!previousPosture) {
      return {
        lastRegimeChange: now,
        regimeDuration: 1,
        previousRegime: "unknown",
        regimeStability: 0.5,
        transitionProbability: 0.2
      };
    }

    const regimeChanged = previousPosture.regime !== regime;
    const regimeDuration = regimeChanged ? 1 : previousPosture.meta.regimeDuration + 1;
    
    // Stability increases with duration, decreases with volatility
    const regimeStability = Math.min(0.95, 
      0.3 + (regimeDuration * 0.1) + (previousPosture.confidence * 0.4)
    );

    // Transition probability based on regime age and stability
    let transitionProbability = 0.1;
    if (regimeDuration > 20) transitionProbability += 0.2; // Old regimes more likely to change
    if (regimeStability < 0.5) transitionProbability += 0.3; // Unstable regimes
    if (previousPosture.volatility.expanding) transitionProbability += 0.2; // Expanding volatility

    return {
      lastRegimeChange: regimeChanged ? now : previousPosture.meta.lastRegimeChange,
      regimeDuration,
      previousRegime: regimeChanged ? previousPosture.regime : previousPosture.meta.previousRegime,
      regimeStability,
      transitionProbability: clamp(transitionProbability, 0.05, 0.8)
    };
  }

  private isRegimeChange(previous?: MarketPosture, current?: MarketPosture): boolean {
    if (!previous || !current) return true;
    
    // Need sufficient confidence and minimum duration for regime change
    return previous.regime !== current.regime && 
           current.confidence > this.config.regimeChangeThreshold &&
           previous.meta.regimeDuration >= this.config.minRegimeDuration;
  }

  private generateTradingAdjustments(posture: MarketPosture): TradingAdjustments {
    const regime = posture.regime;
    const confidence = posture.confidence;
    
    // Base adjustments for each regime
    const baseAdjustments = this.getBaseAdjustments(regime);
    
    // Confidence-based scaling
    const confidenceMultiplier = 0.5 + (confidence * 0.5); // 0.5-1.0 range
    
    // Volatility adjustments
    const volAdjustment = this.getVolatilityAdjustment(posture.volatility.regime);
    
    // Final position sizing
    const finalSizeMultiplier = baseAdjustments.sizeMultiplier * confidenceMultiplier * volAdjustment;

    return {
      symbol: posture.symbol,
      currentRegime: regime,
      positionSizing: {
        sizeMultiplier: clamp(finalSizeMultiplier, 0.2, 2.0),
        maxPositionsInRegime: baseAdjustments.maxPositions,
        riskReductionFactor: baseAdjustments.riskReduction
      },
      entries: {
        aggressiveness: this.getEntryAggressiveness(regime, confidence),
        entryTypes: this.getPreferredEntryTypes(regime),
        timingBias: this.getTimingBias(regime),
        confirmationRequired: confidence < 0.7
      },
      exits: {
        takeProfitMultiplier: baseAdjustments.tpMultiplier,
        stopLossMultiplier: baseAdjustments.slMultiplier,
        trailingStops: regime.includes("strong"),
        quickExitConditions: this.getQuickExitConditions(regime)
      },
      riskManagement: {
        correlationLimits: confidence > 0.8 ? "relaxed" : "tight",
        portfolioHeatLimit: baseAdjustments.portfolioHeatLimit,
        maxDrawdownTolerance: baseAdjustments.maxDrawdown,
        hedgingRecommended: regime === "volatile" || confidence < 0.6
      },
      strategies: {
        preferred: this.getPreferredStrategies(regime),
        avoid: this.getAvoidedStrategies(regime),
        adaptations: this.getStrategyAdaptations(regime, posture)
      },
      timing: {
        sessionBias: "any",
        timeOfDayPreference: this.getTimePreferences(regime),
        avoidPeriods: this.getAvoidPeriods(regime)
      },
      validUntil: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // 24 hours
      lastUpdate: new Date().toISOString()
    };
  }

  private getBaseAdjustments(regime: string) {
    const adjustments = {
      bull_strong: { sizeMultiplier: 1.3, maxPositions: 8, riskReduction: 1.0, tpMultiplier: 1.2, slMultiplier: 1.0, portfolioHeatLimit: 15, maxDrawdown: 0.08 },
      bull_weak: { sizeMultiplier: 1.1, maxPositions: 6, riskReduction: 0.9, tpMultiplier: 1.0, slMultiplier: 0.9, portfolioHeatLimit: 12, maxDrawdown: 0.06 },
      bear_strong: { sizeMultiplier: 1.2, maxPositions: 6, riskReduction: 0.8, tpMultiplier: 1.1, slMultiplier: 0.9, portfolioHeatLimit: 10, maxDrawdown: 0.05 },
      bear_weak: { sizeMultiplier: 1.0, maxPositions: 5, riskReduction: 0.8, tpMultiplier: 1.0, slMultiplier: 0.9, portfolioHeatLimit: 8, maxDrawdown: 0.05 },
      sideways_tight: { sizeMultiplier: 0.8, maxPositions: 4, riskReduction: 0.7, tpMultiplier: 0.8, slMultiplier: 1.1, portfolioHeatLimit: 6, maxDrawdown: 0.04 },
      sideways_loose: { sizeMultiplier: 0.9, maxPositions: 5, riskReduction: 0.8, tpMultiplier: 0.9, slMultiplier: 1.0, portfolioHeatLimit: 8, maxDrawdown: 0.05 },
      volatile: { sizeMultiplier: 0.6, maxPositions: 3, riskReduction: 0.5, tpMultiplier: 0.7, slMultiplier: 1.2, portfolioHeatLimit: 5, maxDrawdown: 0.03 },
      quiet: { sizeMultiplier: 1.1, maxPositions: 6, riskReduction: 0.9, tpMultiplier: 1.0, slMultiplier: 0.8, portfolioHeatLimit: 10, maxDrawdown: 0.06 }
    };

    return adjustments[regime as keyof typeof adjustments] || adjustments.sideways_loose;
  }

  private getVolatilityAdjustment(volRegime: string): number {
    switch (volRegime) {
      case "low": return 1.1;
      case "medium": return 1.0;
      case "high": return 0.8;
      case "extreme": return 0.5;
      default: return 1.0;
    }
  }

  private getEntryAggressiveness(regime: string, confidence: number): "conservative"|"normal"|"aggressive" {
    if (confidence < 0.6) return "conservative";
    if (regime.includes("strong") && confidence > 0.8) return "aggressive";
    return "normal";
  }

  private getPreferredEntryTypes(regime: string): string[] {
    if (regime.includes("strong")) return ["stop_market", "market"];
    if (regime.includes("sideways")) return ["limit", "stop_limit"];
    if (regime === "volatile") return ["limit"];
    return ["limit", "stop_market"];
  }

  private getTimingBias(regime: string): "early"|"normal"|"late" {
    if (regime.includes("strong")) return "early";
    if (regime === "volatile") return "late";
    return "normal";
  }

  private getQuickExitConditions(regime: string): string[] {
    const conditions: string[] = [];
    if (regime === "volatile") conditions.push("volatility_spike");
    if (regime.includes("weak")) conditions.push("momentum_failure");
    if (regime.includes("sideways")) conditions.push("range_break");
    return conditions;
  }

  private getPreferredStrategies(regime: string): string[] {
    const strategies = {
      bull_strong: ["trend_following", "momentum", "breakout"],
      bull_weak: ["pullback", "support_bounce", "trend_following"],
      bear_strong: ["short_trend", "momentum", "breakdown"],
      bear_weak: ["resistance_rejection", "short_pullback"],
      sideways_tight: ["range_trading", "mean_reversion"],
      sideways_loose: ["range_trading", "scalping"],
      volatile: ["scalping", "news_trading"],
      quiet: ["range_trading", "carry"]
    };

    return strategies[regime as keyof typeof strategies] || ["range_trading"];
  }

  private getAvoidedStrategies(regime: string): string[] {
    const avoided = {
      bull_strong: ["mean_reversion", "short_bias"],
      bull_weak: ["aggressive_breakout"],
      bear_strong: ["buy_dip", "long_bias"],
      bear_weak: ["aggressive_breakdown"],
      sideways_tight: ["trend_following", "momentum"],
      sideways_loose: ["strong_momentum"],
      volatile: ["carry", "low_volatility"],
      quiet: ["breakout", "momentum"]
    };

    return avoided[regime as keyof typeof avoided] || [];
  }

  private getStrategyAdaptations(regime: string, posture: MarketPosture): Record<string, any> {
    return {
      trend_strength_requirement: regime.includes("strong") ? 0.5 : 0.7,
      volatility_filter: posture.volatility.regime === "extreme",
      volume_confirmation: regime.includes("breakout"),
      rsi_overbought: regime.includes("bull") ? 80 : 70,
      rsi_oversold: regime.includes("bear") ? 20 : 30
    };
  }

  private getTimePreferences(regime: string): string[] {
    if (regime === "volatile") return ["news_hours", "overlap_sessions"];
    if (regime === "quiet") return ["asian_session"];
    return ["london_session", "ny_session"];
  }

  private getAvoidPeriods(regime: string): string[] {
    const avoid: string[] = [];
    if (regime === "quiet") avoid.push("news_releases");
    if (regime === "volatile") avoid.push("low_liquidity_hours");
    return avoid;
  }

  private handlePostureRequest(request: any, bus: any) {
    const posture = this.currentPostures.get(request.symbol);
    bus.emit("market.posture.response", {
      requestId: request.requestId,
      symbol: request.symbol,
      posture: posture || null,
      timestamp: new Date().toISOString()
    });
  }

  private handleAdjustmentsRequest(request: any, bus: any) {
    const adjustments = this.adjustmentCache.get(request.symbol);
    bus.emit("trading.adjustments.response", {
      requestId: request.requestId,
      symbol: request.symbol,
      adjustments: adjustments || null,
      timestamp: new Date().toISOString()
    });
  }

  private validateRegimes(bus: any, logger: any) {
    for (const [symbol, posture] of this.currentPostures.entries()) {
      // Check if posture is stale
      const age = Date.now() - new Date(posture.timestamp).getTime();
      if (age > 300000) { // 5 minutes
        if (logger) {
          logger.warn({ symbol, age }, "VIVO-22 stale market posture detected");
        }
      }

      // Emit periodic updates
      bus.emit("market.posture.periodic", posture);
    }
  }

  private cleanupOldData() {
    const cutoff = Date.now() - (24 * 60 * 60 * 1000); // 24 hours

    for (const [symbol, history] of this.marketHistory.entries()) {
      const filtered = history.filter(d => new Date(d.timestamp).getTime() > cutoff);
      this.marketHistory.set(symbol, filtered);
    }
  }

  // Public methods for external access
  getCurrentPosture(symbol: string): MarketPosture | null {
    return this.currentPostures.get(symbol) || null;
  }

  getTradingAdjustments(symbol: string): TradingAdjustments | null {
    return this.adjustmentCache.get(symbol) || null;
  }

  getAllPostures(): Map<string, MarketPosture> {
    return new Map(this.currentPostures);
  }

  getStatus(): any {
    return {
      config: this.config,
      symbolsTracked: this.marketHistory.size,
      activePostures: this.currentPostures.size,
      adjustmentsGenerated: this.adjustmentCache.size,
      totalDataPoints: Array.from(this.marketHistory.values()).reduce((sum, h) => sum + h.length, 0),
      regimeDistribution: this.getRegimeDistribution()
    };
  }

  private getRegimeDistribution(): Record<string, number> {
    const distribution: Record<string, number> = {};
    for (const posture of this.currentPostures.values()) {
      distribution[posture.regime] = (distribution[posture.regime] || 0) + 1;
    }
    return distribution;
  }

  updateConfig(updates: Partial<PostureConfig>): void {
    this.config = { ...this.config, ...updates };
  }

  forceRegimeUpdate(symbol: string): void {
    const history = this.marketHistory.get(symbol);
    if (history && history.length > 0) {
      const posture = this.analyzeMarketPosture(symbol, history);
      this.currentPostures.set(symbol, posture);
      
      const adjustments = this.generateTradingAdjustments(posture);
      this.adjustmentCache.set(symbol, adjustments);
      
      this.emit("forced.regime.update", { symbol, posture, adjustments });
    }
  }
}
