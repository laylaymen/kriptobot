# GB-U0 · UnifiedMarketFeed (UMF) - CONSERVATIVE MODE

Binance ham verisini normalize edip tüm modüllere tek şema ile yayınlayan katman.

⚠️ **CONSERVATIVE MODE** - Rate limit koruması ile optimize edilmiş

## 🛡️ Conservative Mode Özellikleri

- **Rate Limit Koruması**: 800/1200 weight limit, 200ms request delay
- **Minimal API Kullanımı**: Orderbook disabled by default, reduced backfill
- **Slower Updates**: 1000ms orderbook updates, longer reconnection delays
- **Essential Data Only**: 5m, 15m intervals default, reduced symbol count
- **Auto-Protection**: Aggressive backoff, IP ban detection

## 🎯 Amaç

Binance REST/WS verilerini al, tek şemaya dönüştür, kalite kontrollerinden geçir, modüllere pub-sub ile dağıt.

## 📊 Çıktı Topic'leri

- `umf.candle.[symbol].[interval]` - OHLCV + indicators slot
- `umf.trade.[symbol]` - aggTrade/markPrice 
- `umf.book.[symbol]` - L2 merged, seq ok
- `umf.ticker.[symbol]` - bookTicker (best bid/ask)
- `umf.funding.[symbol]` - fundingRate, nextFundingTime, markPrice
- `umf.rules.[symbol]` - tick/lot/notional & timeInForce destekleri
- `umf.clock` - serverTime, driftMs

## 🚀 Hızlı Başlangıç (Conservative Mode)

### 1. Güvenli Temel Kullanım

```javascript
const { quickStart, bus } = require('./modules/unifiedMarketFeed');

// CONSERVATIVE MODE - Otomatik rate limit koruması
const umf = await quickStart(['BTCUSDT'], {
    intervals: ['5m'], // Minimal intervals
    enableTrades: true,
    enableTicker: true,
    enableOrderbook: false // API tasarrufu için kapalı
});

// Event dinle
bus.on('umf.candle.BTCUSDT.5m', (candle) => {
    console.log(`Safe candle: ${candle.c} @ ${new Date(candle.tsClose)}`);
});
```

### 2. Production-Ready Ayarlar

```javascript
const umf = await quickStart(['BTCUSDT', 'ETHUSDT'], {
    intervals: ['5m', '15m'], // Essential only
    enableTrades: true,
    enableTicker: true,
    enableOrderbook: false, // High API cost - disable
    enableFunding: false
});
```

### 3. Adapter Kullanımı

```javascript
const { TechnicalIndicatorsAdapter } = require('./modules/umfAdapters');

// Technical indicators için adapter
const techAdapter = new TechnicalIndicatorsAdapter('BTCUSDT', ['1m', '5m']);

// Indicator verilerini al
const indicators = techAdapter.getCurrentValues('1m');
console.log(`RSI: ${indicators.rsi}, SMA20: ${indicators.sma20}`);
```

## 📋 Veri Şemaları

### Candle (Mum) Verisi
```typescript
interface UMFCandle {
  kind: "candle";
  symbol: string;          // "BTCUSDT"
  interval: Interval;      // "1m", "5m", "15m", etc.
  tsOpen: number;          // Açılış zamanı
  tsClose: number;         // Kapanış zamanı
  o: string;               // Open price (decimal string)
  h: string;               // High price
  l: string;               // Low price
  c: string;               // Close price
  v: string;               // Volume
  qv?: string;             // Quote volume
  closed: boolean;         // Mum kapandı mı?
  sourceTs: number;        // Binance timestamp
  ingestTs: number;        // İşlenme zamanı
  driftMs: number;         // Zaman farkı
}
```

### Trade Verisi
```typescript
interface UMFTrade {
  kind: "trade";
  symbol: string;
  ts: number;              // Trade zamanı
  id: number;              // Trade ID
  px: string;              // Price
  qty: string;             // Quantity
  isBuyerMaker: boolean;   // Alıcı market maker mı?
}
```

### Orderbook L2 Verisi
```typescript
interface UMFBookL2 {
  kind: "book";
  symbol: string;
  lastUpdateId: number;
  bids: [string, string][]; // [[price, qty], ...]
  asks: [string, string][]; // [[price, qty], ...]
}
```

## 🔧 Özellikler

### ✅ Zaman Senkronu
- GET /api/v3/time → serverTime
- drift = serverTime - Date.now()
- |drift| > 100ms ise NTP uyarısı

### ✅ Kuralların Önbelleği
- GET /api/v3/exchangeInfo → symbol bazlı filter seti
- PRICE_FILTER, LOT_SIZE, NOTIONAL kontrolleri
- Rules hash üretimi

### ✅ Mumlar (Klines)
- WS: kline stream (1m…4h…)
- REST backfill ile ilk pencereyi doldur
- Closed/open mum ayrımı

### ✅ Trade Verisi
- WS: aggTrade stream
- Price, quantity, buyer maker flag

### ✅ Orderbook L2
- REST snapshot + WS diff merge
- Sequence kontrolü (U, u)
- Top 25 level yayını

### ✅ Best Bid/Ask Ticker
- WS: bookTicker stream
- Real-time spread tracking

### ✅ Validasyon & Normalizasyon
- Price/qty → decimal string
- Tick/lot snapping helper'ları
- NOTIONAL kontrolü

### ✅ Rate Limit & Retry
- REQUEST_WEIGHT sayaç
- 429 → jitter backoff
- Automatic reconnection

## 🧪 Test Etme

### Unit Test
```bash
cd "kirpto bot sinyal"
node modules/unifiedMarketFeed.test.js
```

### Demo Çalıştırma
```bash
cd "kirpto bot sinyal"
node ../umf-demo.js
```

### Quick Test
```javascript
const { runQuickTest } = require('./modules/unifiedMarketFeed.test');
await runQuickTest();
```

## 🔌 Mevcut Modüllerle Entegrasyon

### GB-10 · liquiditySweepDetector
```javascript
bus.on("umf.book.BTCUSDT", (book) => {
  // Liquidity sweep detection logic
});

bus.on("umf.trade.BTCUSDT", (trade) => {
  // Aggressive trade analysis
});
```

### GB-22 · fillQualityAuditor
```javascript
bus.on("umf.ticker.BTCUSDT", (ticker) => {
  // Mid price calculation
});

bus.on("umf.rules.BTCUSDT", (rules) => {
  // Validation rules cache
});
```

### GB-36/41/42 · Technical Indicators
```javascript
bus.on("umf.candle.BTCUSDT.15m", (candle) => {
  // RSI, MACD, BB calculation slot
});
```

### GB-60 · capitalAllocatorRL
```javascript
bus.on("umf.clock", (clock) => {
  // Latency monitoring
});

// Multi-symbol risk assessment
['BTCUSDT', 'ETHUSDT'].forEach(symbol => {
  bus.on(`umf.ticker.${symbol}`, handleRiskMetrics);
});
```

## 📈 Validation Helpers

```javascript
const { ValidationHelpers } = require('./modules/unifiedMarketFeed');

// Price snapping to tick size
const snappedPrice = ValidationHelpers.snapToTick('50123.456', '0.01');
// Returns: "50123.46"

// Quantity snapping to step size
const snappedQty = ValidationHelpers.snapToStep('1.23456', '0.001');
// Returns: "1.234"

// Notional value check
const isValid = ValidationHelpers.checkNotional('50000', '0.1', '10');
// Returns: true (50000 * 0.1 = 5000 > 10)

// Percent price check
const inRange = ValidationHelpers.checkPercentPrice('50000', '49000', '1.1', '0.9');
// Returns: true (49000 * 0.9 < 50000 < 49000 * 1.1)
```

## 🔄 Event Bus Pattern

```javascript
// Subscribe to events
bus.on('umf.candle.BTCUSDT.1m', (candle) => {
  console.log('New candle received');
});

// One-time subscription
bus.once('umf.rules.BTCUSDT', (rules) => {
  console.log('Rules loaded');
});

// Unsubscribe
const handler = (trade) => console.log('Trade');
bus.on('umf.trade.BTCUSDT', handler);
bus.off('umf.trade.BTCUSDT', handler);
```

## 🛠️ Konfigürasyon

### Environment Variables
```bash
# .env dosyasında
BINANCE_API_KEY=your_api_key_here
UMF_DEBUG=true  # Debug logları için
```

### Initialize Options
```javascript
const options = {
  intervals: ['1m', '5m', '15m', '1h', '4h', '1d'],
  enableTrades: true,
  enableTicker: true, 
  enableOrderbook: true,
  enableFunding: false, // Futures için true
  enableClock: true
};
```

## 📊 Monitoring

### Status Check
```javascript
const status = umf.getStatus();
console.log({
  isInitialized: status.isInitialized,
  activeStreams: status.activeStreams.length,
  driftMs: status.driftMs,
  requestWeight: status.requestWeight,
  symbolCount: status.symbolCount
});
```

### Performance Metrics
- Message throughput (msg/sec)
- Latency tracking (driftMs)
- WebSocket connection health
- Rate limit monitoring

## 🚨 Error Handling

### Connection Errors
- Automatic reconnection (5s delay)
- Exponential backoff for rate limits
- Sequence gap detection (orderbook)

### Data Quality
- Price/quantity validation
- Timestamp drift monitoring
- Missing field detection

## 🏗️ Architecture

```
Binance WS/REST
   ├─ timeSync() → umf.clock
   ├─ loadExchangeInfo() → umf.rules.*
   ├─ streamKlines() → umf.candle.*.*
   ├─ streamAggTrades() → umf.trade.*
   ├─ bookSnapshot()+bookDiff() → umf.book.*
   ├─ streamBookTicker() → umf.ticker.*
   └─ streamFunding() → umf.funding.*
                ↓
         Event Bus (Node.js EventEmitter)
                ↓
    GB-10, GB-22, GB-36, GB-41, GB-42, GB-60...
```

## 📚 Type Definitions

TypeScript type dosyaları: `types/umf.ts`

```typescript
import { UMFCandle, UMFTrade, UMFBookL2 } from './types/umf';

// Type-safe event handlers
const candleHandler: (candle: UMFCandle) => void = (candle) => {
  // TypeScript support
};
```

## 🐛 Troubleshooting

### Yaygın Problemler

1. **Time Drift > 100ms**
   - NTP sync kontrolü yapın
   - Network latency'yi kontrol edin

2. **Rate Limit Errors**
   - API key limitlerini kontrol edin
   - Request frequency'yi azaltın

3. **WebSocket Disconnections**
   - Network stability kontrol edin
   - Auto-reconnection loglarını kontrol edin

4. **Sequence Gaps (Orderbook)**
   - Network packet loss olabilir
   - Snapshot refresh otomatik yapılır

### Debug Mode
```bash
UMF_DEBUG=true node index.js
```

## 🔮 Gelecek Geliştirmeler

- [ ] Redis Streams/Kafka entegrasyonu
- [ ] Multi-exchange support (Coinbase, Kraken)
- [ ] Advanced orderbook analytics
- [ ] Historical data replay
- [ ] Performance optimization
- [ ] Circuit breaker pattern
- [ ] Metrics dashboard

## 📄 License

Bu proje kriptobot ana projesi ile aynı lisansa sahiptir.

---

**Başarı Kriteri**: GB-10/22/36/41/42/52/53/54/59/60 gibi modüller UMF şemasını tüketerek tek satır adapter ile çalışmalı.
