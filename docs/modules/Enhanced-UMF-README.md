# Enhanced UMF - Repository Structure & Topic Naming

## 🏗️ Repository Structure

```
kirpto bot sinyal/
├── modules/
│   ├── unifiedMarketFeed.js          # Main UMF orchestrator
│   ├── eventNormalizer.js            # normalize-core: Raw data → Normalized events
│   ├── eventEnricher.js              # enrich-core: Add features, metrics, TCA
│   ├── umfAdapters.js                # Module-specific adapters
│   └── umfHealthMonitor.js           # Health & SLO monitoring (planned)
├── types/
│   ├── umf.ts                        # Legacy types (backward compatibility)
│   └── enhanced-umf.ts               # Enhanced event schema & types
├── tests/
│   ├── unifiedMarketFeed.test.js     # Main UMF tests
│   ├── eventNormalizer.test.js       # Normalization tests (planned)
│   └── eventEnricher.test.js         # Enrichment tests (planned)
├── umf-demo.js                       # Demo runner
├── umf-integration.js                # Integration helper for main bot
└── UMF-README.md                     # Documentation
```

## 📡 Topic Naming Convention

### Event Topics (Enhanced Schema)
```
market.kline.{SYMBOL}.{TIMEFRAME}.v1
market.trades.{SYMBOL}.v1
market.depth.{SYMBOL}.v1
market.ticker.{SYMBOL}.v1
market.funding.{SYMBOL}.v1
market.orders.{SYMBOL}.v1
market.rules.{SYMBOL}.v1
market.clock.v1
market.health.v1
```

### Legacy Topics (Backward Compatibility)
```
umf.candle.{SYMBOL}.{INTERVAL}
umf.trade.{SYMBOL}
umf.book.{SYMBOL}
umf.ticker.{SYMBOL}
umf.funding.{SYMBOL}
umf.rules.{SYMBOL}
umf.clock
```

## 🔄 Data Flow Pipeline

```
┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│   Binance   │───▶│ Normalizer  │───▶│  Enricher   │───▶│  Publisher  │
│  Raw Data   │    │             │    │             │    │             │
└─────────────┘    └─────────────┘    └─────────────┘    └─────────────┘
       │                   │                   │                   │
       ▼                   ▼                   ▼                   ▼
┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│ WebSocket   │    │ Schema      │    │ Rolling     │    │ Event Bus   │
│ REST API    │    │ Validation  │    │ Metrics     │    │ Topics      │
│ Market Data │    │ Type Safety │    │ Features    │    │ Pub/Sub     │
│             │    │ Dedup       │    │ TCA         │    │             │
└─────────────┘    └─────────────┘    └─────────────┘    └─────────────┘
```

## 🎯 Module Consumption

### Bot Modules (GB-series)
```javascript
// GB-10: Price Action Analysis
umf.subscribe('market.kline.BTCUSDT.1m.v1', (event) => {
    const { o, h, l, c, v, features } = event;
    // Technical analysis with enriched features
});

// GB-22: Volume Analysis  
umf.subscribe('market.trades.BTCUSDT.v1', (event) => {
    const { qty, microstructure, tca } = event;
    // Volume pattern recognition
});

// GB-36: Order Flow Analysis
umf.subscribe('market.depth.BTCUSDT.v1', (event) => {
    const { bids, asks, imbalance, pressureIndex } = event;
    // Order book analysis
});

// GB-41: Risk Management
umf.subscribe('market.health.v1', (event) => {
    const { slos, latency, errorRate } = event;
    // System health monitoring
});

// GB-42: News Integration
umf.subscribe('market.funding.BTCUSDT.v1', (event) => {
    const { fundingRate, markPrice } = event;
    // Funding rate arbitrage
});

// GB-60: Position Management
umf.subscribe('market.orders.BTCUSDT.v1', (event) => {
    const { fills, slippage, priceImprovement } = event;
    // Order execution analytics
});
```

### Otobilinç (Psychological Analysis)
```javascript
// Monitor sentiment from order flow
umf.subscribe('market.trades.+.v1', (event) => {
    const { aggressiveness, buyPressure } = event.microstructure;
    // Market sentiment analysis
});
```

### VIVO (Signal Routing) 
```javascript
// Route signals based on enriched data
umf.subscribe('market.kline.+.+.v1', (event) => {
    const { momentum, volatility, regime } = event.features;
    // Signal strength assessment
});
```

### LIVIA (Emotional Filtering)
```javascript
// Filter based on market conditions
umf.subscribe('market.health.v1', (event) => {
    const { volatilityRegime, liquidityRegime } = event;
    // Risk adjustment based on regime
});
```

### Denetim Asistanı (Monitoring)
```javascript
// Comprehensive monitoring
umf.subscribe('market.health.v1', (event) => {
    const { slos, metrics, alerts } = event;
    // Performance tracking & alerting
});
```

## 🔧 Configuration

### Conservative Mode (Default)
```javascript
const umf = new UnifiedMarketFeed({
    symbols: ['BTCUSDT'],
    streams: ['kline_1m', 'trade'],
    includeOrderBook: false,
    enableEnrichment: true,
    enableValidation: true,
    maxEventsPerSecond: 50,
    topicPrefix: 'market',
    topicVersion: 'v1'
});
```

### Advanced Mode (Full Features)
```javascript
const umf = new UnifiedMarketFeed({
    symbols: ['BTCUSDT', 'ETHUSDT', 'ADAUSDT'],
    streams: ['kline_1m', 'kline_5m', 'trade', 'depth'],
    includeOrderBook: true,
    depthLevel: 20,
    enableEnrichment: true,
    enableTCA: true,
    enableFeatureVectors: true,
    strictValidation: true,
    maxEventsPerSecond: 100,
    rollingWindows: [60, 300, 900, 3600]
});
```

## 🚀 Usage Examples

### 1. Start UMF with Enhanced Pipeline
```javascript
const { UnifiedMarketFeed } = require('./modules/unifiedMarketFeed');

const umf = new UnifiedMarketFeed();
await umf.timeSync();
await umf.loadExchangeInfo(['BTCUSDT']);
umf.streamKlines('BTCUSDT', '1m');
umf.streamAggTrades('BTCUSDT');
```

### 2. Subscribe to Enhanced Events
```javascript
// Subscribe to enriched kline data
umf.subscribe('market.kline.BTCUSDT.1m.v1', (event) => {
    console.log('Enriched Kline:', {
        price: event.c,
        volume: event.v,
        features: event.features,
        rolling: event.rolling,
        microstructure: event.microstructure,
        validated: event.validated,
        enriched: event.enriched
    });
});

// Subscribe to trade analytics
umf.subscribe('market.trades.BTCUSDT.v1', (event) => {
    console.log('Trade Analytics:', {
        price: event.price,
        qty: event.qty,
        tca: event.tca,
        marketImpact: event.microstructure.marketImpact,
        aggressiveness: event.microstructure.aggressiveness
    });
});
```

### 3. Monitor System Health
```javascript
umf.subscribe('market.health.v1', (event) => {
    console.log('System Health:', {
        latency: event.latency,
        throughput: event.throughput,
        errorRate: event.errorRate,
        slos: event.slos
    });
});
```

## 📊 Event Schema Examples

### Enriched Kline Event
```typescript
{
    kind: 'kline',
    symbol: 'BTCUSDT',
    tf: '1m',
    o: 45000,
    h: 45100,
    l: 44950,
    c: 45050,
    v: 123.45,
    
    // Enrichment
    rolling: {
        '60s': { sma: 45025, volatility: 0.02, returns: 0.001 },
        '300s': { sma: 45000, volatility: 0.025, returns: 0.002 }
    },
    features: {
        price: { rsi_14: 65, sma_20: 44980, bollinger_upper: 45200 },
        momentum: { roc_1m: 0.001, macd: 12.5 },
        regime: { trend_strength: 0.7, volatility_regime: 'normal' }
    },
    
    // Metadata
    validated: true,
    enriched: true,
    publishTime: 1640995200000,
    messageId: '1640995200000-abc123',
    schemaVersion: '1.0'
}
```

### Trade Analytics Event
```typescript
{
    kind: 'trade',
    symbol: 'BTCUSDT',
    price: 45050,
    qty: 0.1,
    
    // TCA Analysis
    tca: {
        implementationShortfall: 0.001,
        marketImpactCost: 0.0005,
        slippage: 0.0002,
        participationRate: 0.05
    },
    
    // Microstructure
    microstructure: {
        priceImpact: 0.01,
        aggressiveness: 0.8,
        marketImpact: 0.005
    },
    
    validated: true,
    enriched: true,
    schemaVersion: '1.0'
}
```

## ⚡ Performance & Scaling

- **Conservative Mode**: <50 events/sec, minimal CPU/memory
- **Production Mode**: <200 events/sec, moderate resources  
- **High-Frequency Mode**: <1000 events/sec, optimized for latency
- **Rate Limiting**: Built-in protection against API bans
- **Deduplication**: Automatic duplicate event filtering
- **Validation**: Configurable data quality checks
- **Enrichment**: Modular feature engineering pipeline

## 🔐 Security & Reliability

- **Rate Limiting**: Conservative API usage to prevent bans
- **Error Handling**: Comprehensive error capture & recovery
- **Health Monitoring**: SLO tracking & alerting
- **Data Validation**: Schema validation & type safety
- **Backoff & Retry**: Exponential backoff for failed requests
- **Connection Management**: Auto-reconnect with circuit breaker

## 🎛️ Monitoring & Observability

```javascript
// Get pipeline statistics
const stats = umf.getStats();
console.log({
    totalEvents: stats.totalEvents,
    pipeline: {
        normalized: stats.pipeline.normalized,
        enriched: stats.pipeline.enriched,
        published: stats.pipeline.published,
        dropped: stats.pipeline.dropped
    },
    errorRate: stats.errorsCount / stats.totalEvents,
    duplicateRate: stats.duplicatesDropped / stats.totalEvents
});

// Get normalizer statistics
const normStats = umf.normalizer.getStats();
console.log({
    totalEvents: normStats.totalEvents,
    dedupCacheSize: normStats.dedupCacheSize,
    rulesLoaded: normStats.rulesLoaded
});

// Get enricher statistics  
const enrichStats = umf.enricher.getStats();
console.log({
    symbolsTracked: enrichStats.symbolsTracked,
    totalPricePoints: enrichStats.totalPricePoints,
    cacheSizes: enrichStats.cacheSizes
});
```
