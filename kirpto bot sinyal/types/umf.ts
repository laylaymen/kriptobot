/**
 * TypeScript type definitions for UnifiedMarketFeed
 * 
 * Bu dosya UMF şemalarını tanımlar ve modüller arası type safety sağlar
 */

export type Interval = 
  | "1s" | "1m" | "3m" | "5m" | "15m" | "30m" 
  | "1h" | "2h" | "4h" | "6h" | "8h" | "12h" 
  | "1d" | "3d" | "1w" | "1M";

export type OrderSide = "BUY" | "SELL";
export type OrderType = "LIMIT" | "MARKET" | "STOP_LOSS" | "STOP_LOSS_LIMIT" | "TAKE_PROFIT" | "TAKE_PROFIT_LIMIT";
export type TimeInForce = "GTC" | "IOC" | "FOK";

// Base interface - tüm UMF mesajlarının ortak alanları
export interface UMFBase {
  symbol: string;          // "BTCUSDT"
  source: "binance";       // Kaynak borsa
  ingestTs: number;        // Modül tarafından işlenme zamanı (Date.now())
  sourceTs?: number;       // Borsadan gelen orijinal timestamp
  driftMs?: number;        // Server time - local time farkı
  rulesVersion?: string;   // Exchange rules hash'i
}

// Mum (Kline) verisi
export interface UMFCandle extends UMFBase {
  kind: "candle";
  interval: Interval;
  tsOpen: number;          // Mumun açılış zamanı
  tsClose: number;         // Mumun kapanış zamanı  
  o: string;               // Open price (decimal string)
  h: string;               // High price
  l: string;               // Low price
  c: string;               // Close price
  v: string;               // Volume (base asset)
  qv?: string;             // Quote volume
  closed: boolean;         // Mum kapandı mı?
  trades?: number;         // İşlem sayısı
}

// Trade verisi
export interface UMFTrade extends UMFBase {
  kind: "trade";
  ts: number;              // Trade zamanı
  id: number;              // Trade ID
  px: string;              // Price (decimal string)
  qty: string;             // Quantity
  isBuyerMaker: boolean;   // Buyer market maker mı?
}

// Orderbook L2 verisi
export interface UMFBookL2 extends UMFBase {
  kind: "book";
  lastUpdateId: number;    // Son update ID
  bids: [string, string][]; // [[price, qty], ...] - en iyi teklifler önce
  asks: [string, string][]; // [[price, qty], ...] - en iyi satışlar önce
}

// Best bid/ask ticker
export interface UMFTicker extends UMFBase {
  kind: "ticker";
  ts: number;
  bidPx: string;           // En iyi alış fiyatı
  bidSz: string;           // En iyi alış miktarı
  askPx: string;           // En iyi satış fiyatı
  askSz: string;           // En iyi satış miktarı
}

// Funding rate ve mark price (futures)
export interface UMFFunding extends UMFBase {
  kind: "funding";
  ts: number;
  markPrice: string;       // Mark price
  indexPrice?: string;     // Index price
  fundingRate: string;     // Mevcut funding rate
  nextFundingTime?: number; // Sonraki funding zamanı
}

// Exchange rules ve filter'lar
export interface UMFRules extends UMFBase {
  kind: "rules";
  status: string;          // "TRADING" vs "BREAK"
  baseAsset: string;       // "BTC"
  quoteAsset: string;      // "USDT"
  filters: {
    price?: {
      min: string;         // Minimum price
      max: string;         // Maximum price  
      tick: string;        // Price tick size
    };
    lot?: {
      min: string;         // Minimum quantity
      max: string;         // Maximum quantity
      step: string;        // Quantity step size
    };
    notional?: {
      min?: string;        // Minimum notional value
      max?: string;        // Maximum notional value
      avgPriceMins?: number; // Average price minutes
    };
    percentPrice?: {
      up: string;          // Multiplier up
      down: string;        // Multiplier down
      avgPriceMins: number;
    };
    percentPriceBySide?: {
      bidUp: string;
      bidDown: string;
      askUp: string;
      askDown: string;
      avgPriceMins: number;
    };
  };
  orderTypes: OrderType[];
  timeInForce: TimeInForce[];
  permissions: string[];   // ["SPOT"], ["MARGIN"], etc.
}

// Clock sync verisi
export interface UMFClock extends UMFBase {
  kind: "clock";
  serverTime: number;      // Binance server time
  localTime: number;       // Local machine time
  driftMs: number;         // Fark (ms)
  roundTripMs?: number;    // Round trip latency
}

// Union type - tüm UMF mesaj tipleri
export type UMFMessage = 
  | UMFCandle 
  | UMFTrade 
  | UMFBookL2 
  | UMFTicker 
  | UMFFunding 
  | UMFRules 
  | UMFClock;

// Topic patterns
export type UMFTopic = 
  | `umf.candle.${string}.${Interval}`
  | `umf.trade.${string}`
  | `umf.book.${string}`
  | `umf.ticker.${string}`
  | `umf.funding.${string}`
  | `umf.rules.${string}`
  | "umf.clock";

// Event handler types
export type UMFHandler<T extends UMFMessage> = (message: T) => void;

// Initialize options
export interface UMFInitOptions {
  intervals?: Interval[];
  enableTrades?: boolean;
  enableTicker?: boolean;
  enableOrderbook?: boolean;
  enableFunding?: boolean;
  enableClock?: boolean;
}

// Stream status
export interface UMFStatus {
  isInitialized: boolean;
  activeStreams: string[];
  driftMs: number;
  rulesHash: string;
  requestWeight: number;
  symbolCount: number;
}

// Validation helpers types
export interface ValidationHelpers {
  snapToTick(price: string, tickSize: string): string;
  snapToStep(qty: string, stepSize: string): string;
  checkNotional(price: string, qty: string, minNotional: string, maxNotional?: string): boolean;
  checkPercentPrice(price: string, avgPrice: string, multiplierUp: string, multiplierDown: string): boolean;
}

// UMF sınıfı interface
export interface IUnifiedMarketFeed {
  timeSync(): Promise<number>;
  loadExchangeInfo(symbols?: string[]): Promise<Record<string, UMFRules>>;
  streamKlines(symbol: string, interval: Interval): Promise<WebSocket>;
  streamAggTrades(symbol: string): WebSocket;
  streamBookTicker(symbol: string): WebSocket;
  streamOrderbookL2(symbol: string, limit?: number): Promise<WebSocket>;
  streamFunding(symbol: string): WebSocket;
  initialize(symbols: string[], options?: UMFInitOptions): Promise<void>;
  shutdown(): void;
  getStatus(): UMFStatus;
}

// Event bus interface
export interface UMFEventBus {
  on<T extends UMFMessage>(topic: string, handler: UMFHandler<T>): void;
  once<T extends UMFMessage>(topic: string, handler: UMFHandler<T>): void;
  off<T extends UMFMessage>(topic: string, handler: UMFHandler<T>): void;
  emit(topic: string, message: UMFMessage): boolean;
}

// Modül export interface
export interface UMFModule {
  UnifiedMarketFeed: new () => IUnifiedMarketFeed;
  bus: UMFEventBus;
  ValidationHelpers: ValidationHelpers;
  getInstance(): IUnifiedMarketFeed;
  on<T extends UMFMessage>(topic: string, handler: UMFHandler<T>): void;
  once<T extends UMFMessage>(topic: string, handler: UMFHandler<T>): void;
  off<T extends UMFMessage>(topic: string, handler: UMFHandler<T>): void;
  quickStart(symbols: string[], options?: UMFInitOptions): Promise<IUnifiedMarketFeed>;
}

// Örnek kullanım type'ları

// Kline handler örneği
export type CandleHandler = (candle: UMFCandle) => void;

// Trade handler örneği  
export type TradeHandler = (trade: UMFTrade) => void;

// Book handler örneği
export type BookHandler = (book: UMFBookL2) => void;

// Ticker handler örneği
export type TickerHandler = (ticker: UMFTicker) => void;

// Multi-handler type
export interface UMFHandlers {
  onCandle?: CandleHandler;
  onTrade?: TradeHandler;
  onBook?: BookHandler;
  onTicker?: TickerHandler;
  onFunding?: (funding: UMFFunding) => void;
  onRules?: (rules: UMFRules) => void;
  onClock?: (clock: UMFClock) => void;
}

// Symbol config
export interface SymbolConfig {
  symbol: string;
  intervals: Interval[];
  enableTrades: boolean;
  enableTicker: boolean;
  enableOrderbook: boolean;
  enableFunding: boolean;
}

// Market data aggregation
export interface MarketSnapshot {
  symbol: string;
  timestamp: number;
  candles: Record<Interval, UMFCandle>;
  lastTrade?: UMFTrade;
  book?: UMFBookL2;
  ticker?: UMFTicker;
  funding?: UMFFunding;
  rules?: UMFRules;
}

// Error types
export class UMFError extends Error {
  constructor(
    message: string,
    public code: string,
    public symbol?: string,
    public data?: any
  ) {
    super(message);
    this.name = 'UMFError';
  }
}

export class UMFTimeoutError extends UMFError {
  constructor(symbol: string, operation: string) {
    super(`Timeout in ${operation} for ${symbol}`, 'TIMEOUT', symbol);
  }
}

export class UMFRateLimitError extends UMFError {
  constructor(message: string) {
    super(message, 'RATE_LIMIT');
  }
}

export class UMFSequenceError extends UMFError {
  constructor(symbol: string, expected: number, received: number) {
    super(`Sequence error for ${symbol}: expected ${expected}, got ${received}`, 'SEQUENCE', symbol, { expected, received });
  }
}
