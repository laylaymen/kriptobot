/**
 * Enhanced UMF Event Schema - Production Ready
 * 
 * Comprehensive type definitions for normalize→enrich→publish pipeline
 */

export type MarketType = 'spot' | 'umPerp' | 'cmPerp';
export type TimeFrame = '1s' | '1m' | '3m' | '5m' | '15m' | '30m' | '1h' | '2h' | '4h' | '6h' | '8h' | '12h' | '1d' | '3d' | '1w' | '1M';
export type OrderStatus = 'NEW' | 'PARTIALLY_FILLED' | 'FILLED' | 'CANCELED' | 'PENDING_CANCEL' | 'REJECTED' | 'EXPIRED';
export type OrderSide = 'BUY' | 'SELL';
export type OrderType = 'LIMIT' | 'MARKET' | 'STOP_LOSS' | 'STOP_LOSS_LIMIT' | 'TAKE_PROFIT' | 'TAKE_PROFIT_LIMIT';

// Base event interface - all UMF events inherit from this
export interface BaseEvent {
  symbol: string;
  marketType: MarketType;
  eventTime: number;        // Exchange timestamp (E field)
  ingestTime: number;       // System ingestion time
  latencyMs: number;        // ingestTime - eventTime
  clockSkewMs?: number;     // serverTime - systemTime
  schemaVersion: '1.0';
  source: 'binance';
  sequence?: number;        // Global sequence number
  correlationId?: string;   // For tracing
}

// Enhanced Kline with enrichment slots
export interface KlineEvent extends BaseEvent {
  kind: 'kline';
  tf: TimeFrame;
  tsOpen: number;
  tsClose: number;
  o: number;                // Open price (validated)
  h: number;                // High price
  l: number;                // Low price  
  c: number;                // Close price
  v: number;                // Base volume
  quoteV: number;           // Quote volume
  closed: boolean;
  trades: number;           // Trade count
  
  // Enrichment fields (calculated)
  ema9?: number;
  ema20?: number;
  ema50?: number;
  ema200?: number;
  rsi14?: number;
  atr14?: number;
  vwap?: number;
  vwap5m?: number;
  vwap15m?: number;
  realizedVol5m?: number;
  realizedVol1h?: number;
  garchProxy?: number;
  
  // Validation flags
  validated: boolean;
  validationErrors?: string[];
}

// Enhanced Trade with enrichment
export interface TradeEvent extends BaseEvent {
  kind: 'trade';
  id: number;
  price: number;            // Validated price
  qty: number;              // Validated quantity
  quoteQty: number;         // price * qty
  isBuyerMaker: boolean;
  tradeTime: number;
  
  // Enrichment fields
  preTradeMid?: number;     // Mid price before trade
  postTradeMid1s?: number;  // Mid price 1s after
  postTradeMid5s?: number;  // Mid price 5s after
  modeledSlippage?: number; // Predicted slippage
  realizedSlippage?: number;// Actual slippage vs mid
  impactBps?: number;       // Market impact in bps
  
  // TCA fields
  tcaWindow?: string;       // TCA measurement window
  eventWindowId?: string;   // For news correlation
  
  // Validation
  validated: boolean;
  compositeFillId?: string; // orderId + tradeId + updateId
}

// Enhanced OrderBook with microstructure metrics
export interface DepthEvent extends BaseEvent {
  kind: 'depth';
  lastUpdateId: number;
  snapshotVersion?: number;
  bids: [number, number][]; // [price, qty] - validated
  asks: [number, number][]; // [price, qty] - validated
  
  // Enrichment - microstructure metrics
  midPrice?: number;
  spread?: number;
  spreadBps?: number;
  topN?: number;            // Number of levels included
  imbalance?: number;       // bidVol/(bidVol+askVol) [0..1]
  bidVolume?: number;       // Total bid volume
  askVolume?: number;       // Total ask volume
  queueDepletionRate?: number; // Order flow metric
  
  // Health metrics
  gapDetected?: boolean;
  lastReconcile?: number;   // Last snapshot refresh time
  
  // Validation
  validated: boolean;
  crossedBook?: boolean;    // Bid >= Ask error
}

// Enhanced Ticker
export interface TickerEvent extends BaseEvent {
  kind: 'ticker';
  bidPx: number;
  bidSz: number;
  askPx: number;
  askSz: number;
  
  // Enrichment
  midPrice: number;         // (bid + ask) / 2
  spread: number;           // ask - bid
  spreadBps: number;        // spread / mid * 10000
  
  validated: boolean;
}

// Funding Rate (Futures)
export interface FundingEvent extends BaseEvent {
  kind: 'funding';
  markPrice: number;
  indexPrice?: number;
  fundingRate: number;
  nextFundingTime: number;
  predictedFundingRate?: number;
  realizedFunding?: number;  // Accumulated funding
  
  validated: boolean;
}

// Account/Order updates
export interface OrderEvent extends BaseEvent {
  kind: 'order';
  orderId: number;
  clientOrderId: string;
  status: OrderStatus;
  side: OrderSide;
  type: OrderType;
  origQty: number;
  execQty: number;
  price: number;
  stopPrice?: number;
  avgPrice?: number;
  commission?: number;
  commissionAsset?: string;
  
  // Position tracking
  realizedPnl?: number;
  positionSide?: 'LONG' | 'SHORT' | 'BOTH';
  
  validated: boolean;
  compositeFillId?: string;
}

// Rules/Exchange Info
export interface RulesEvent extends BaseEvent {
  kind: 'rules';
  status: string;
  baseAsset: string;
  quoteAsset: string;
  contractSize?: number;    // For futures
  multiplier?: number;      // For CM futures
  
  filters: {
    priceFilter: {
      minPrice: number;
      maxPrice: number;
      tickSize: number;
    };
    lotSizeFilter: {
      minQty: number;
      maxQty: number;
      stepSize: number;
    };
    notionalFilter: {
      minNotional: number;
      maxNotional?: number;
      avgPriceMins?: number;
    };
    percentPriceFilter?: {
      multiplierUp: number;
      multiplierDown: number;
      avgPriceMins: number;
    };
  };
  
  validated: boolean;
  rulesHash: string;
}

// Clock sync
export interface ClockEvent extends BaseEvent {
  kind: 'clock';
  serverTime: number;
  systemTime: number;
  driftMs: number;
  roundTripMs?: number;
  ntpSync?: boolean;
}

// Health/SLA metrics
export interface HealthEvent extends BaseEvent {
  kind: 'health';
  component: string;       // 'websocket' | 'rest' | 'normalizer' | 'enricher'
  metric: string;          // 'lag' | 'errors' | 'throughput'
  value: number;
  p50?: number;
  p95?: number;
  p99?: number;
  sloBreached?: boolean;
}

// Union type for all events
export type UMFEvent = 
  | KlineEvent 
  | TradeEvent 
  | DepthEvent 
  | TickerEvent 
  | FundingEvent 
  | OrderEvent 
  | RulesEvent 
  | ClockEvent 
  | HealthEvent;

// Topic routing patterns
export type TopicPattern = 
  | `market.kline.v1.${string}.${TimeFrame}`
  | `market.trades.v1.${string}`
  | `market.depth.v1.${string}`
  | `market.ticker.v1.${string}`
  | `perp.funding.v1.${string}`
  | `account.orders.v1.${string}`
  | `account.fills.v1.${string}`
  | `system.health.v1`
  | `system.clock.v1`;

// Validation result
export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  normalizedEvent?: UMFEvent;
}

// Enrichment context
export interface EnrichmentContext {
  symbol: string;
  marketType: MarketType;
  priceHistory: number[];   // Recent prices for calculations
  volumeHistory: number[];  // Recent volumes
  tradeHistory: TradeEvent[]; // Recent trades
  lastTicker?: TickerEvent;
  exchangeRules?: RulesEvent;
  
  // Rolling calculations state
  emaState: Record<string, number>;
  rsiState: { gains: number[]; losses: number[] };
  atrState: { tr: number[] };
  vwapState: { totalPxVol: number; totalVol: number; startTime: number };
}

// Feature store schema
export interface FeatureVector {
  symbol: string;
  timestamp: number;
  
  // Price features
  price: number;
  priceChange1m: number;
  priceChange5m: number;
  priceChange15m: number;
  
  // Volume features
  volume: number;
  volumeChange1m: number;
  relativeVolume: number;   // vs 20-period average
  
  // Technical features
  rsi14: number;
  ema20: number;
  ema50: number;
  atr14: number;
  vwap: number;
  
  // Microstructure features
  spread: number;
  imbalance: number;
  depthRatio: number;       // bid depth / ask depth
  
  // Volatility features
  realizedVol5m: number;
  realizedVol1h: number;
  garchProxy: number;
  
  // News/event features
  eventWindowId?: string;
  newsImpact?: number;
  
  // Quality metrics
  dataQuality: number;      // 0-1 completeness score
  latency: number;          // Data freshness
}

// SLO/SLA definitions
export interface SLODefinition {
  metric: string;
  target: number;
  threshold: number;
  windowMs: number;
}

export const DEFAULT_SLOS: SLODefinition[] = [
  { metric: 'websocket_lag_p95', target: 100, threshold: 500, windowMs: 60000 },
  { metric: 'normalization_errors', target: 0.01, threshold: 0.05, windowMs: 300000 },
  { metric: 'enrichment_lag_p50', target: 10, threshold: 50, windowMs: 60000 },
  { metric: 'data_completeness', target: 0.99, threshold: 0.95, windowMs: 300000 }
];

// Error types
export class ValidationError extends Error {
  constructor(
    message: string,
    public symbol: string,
    public field: string,
    public value: any,
    public rule: string
  ) {
    super(message);
    this.name = 'ValidationError';
  }
}

export class EnrichmentError extends Error {
  constructor(
    message: string,
    public symbol: string,
    public enricher: string,
    public data?: any
  ) {
    super(message);
    this.name = 'EnrichmentError';
  }
}

export class StateError extends Error {
  constructor(
    message: string,
    public component: string,
    public operation: string,
    public data?: any
  ) {
    super(message);
    this.name = 'StateError';
  }
}

// Configuration interfaces
export interface NormalizerConfig {
  validatePrices: boolean;
  validateQuantities: boolean;
  validateNotional: boolean;
  strictValidation: boolean;
  dropInvalidEvents: boolean;
  maxClockSkew: number;     // ms
  dedupWindowMs: number;
}

export interface EnricherConfig {
  enableTechnicalIndicators: boolean;
  enableMicrostructure: boolean;
  enableTCA: boolean;
  rollingWindowSizes: number[];
  featureCalculationIntervals: TimeFrame[];
  maxHistoryLength: number;
}

export interface RouterConfig {
  topics: Record<string, TopicPattern>;
  enableColdStorage: boolean;
  parquetConfig?: {
    partitionBy: 'date' | 'symbol' | 'both';
    compressionType: 'snappy' | 'gzip' | 'lz4';
    batchSize: number;
  };
  enableFeatureStore: boolean;
  sloConfig: SLODefinition[];
}
