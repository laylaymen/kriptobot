# Enhanced UMF - Quick Reference Guide

## 🚀 Hızlı Başlangıç

### Temel Kullanım

```javascript
const { EnhancedUMF } = require('./kirpto bot sinyal/modules/enhancedUMF');

// Production configuration
const umf = new EnhancedUMF({
    symbols: ['BTCUSDT', 'ETHUSDT'],
    intervals: ['1m', '5m'],
    enableValidation: true,
    enableStorage: true,
    enableOrderbook: true,
    enableClockSync: true
});

await umf.initialize();

// Event listeners
umf.on('umf.kline.BTCUSDT.1m', (kline) => {
    console.log(`BTC Price: ${kline.close}`);
});

umf.on('umf.trade.BTCUSDT', (trade) => {
    console.log(`BTC Trade: ${trade.price} x ${trade.quantity}`);
});
```

## 📁 Dosya Yolları

### Ana Modüller
- **Enhanced UMF:** `./kirpto bot sinyal/modules/enhancedUMF.js`
- **Exchange Rules:** `./kirpto bot sinyal/modules/exchangeRulesGuard.js`
- **Rate Limiter:** `./kirpto bot sinyal/modules/rateLimitOrchestrator.js`
- **Orderbook Validator:** `./kirpto bot sinyal/modules/orderbookValidator.js`
- **Data Storage:** `./kirpto bot sinyal/modules/rawDataStorage.js`
- **Clock Sync:** `./kirpto bot sinyal/modules/clockSyncMonitor.js`

### Demo Dosyaları
- **Production Demo:** `./production-umf-demo.js`
- **Simple Demo:** `./simple-umf-demo.js`
- **Enhanced Demo:** `./enhanced-umf-demo.js`

### Tip Tanımları
- **Enhanced UMF Types:** `./kirpto bot sinyal/types/enhanced-umf.ts`
- **Basic UMF Types:** `./kirpto bot sinyal/types/umf.ts`

## 🔧 Konfigürasyon Örnekleri

### Minimal Configuration
```javascript
const umf = new EnhancedUMF({
    symbols: ['BTCUSDT'],
    intervals: ['1m']
});
```

### Production Configuration
```javascript
const umf = new EnhancedUMF({
    symbols: ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'ADAUSDT'],
    intervals: ['1m', '5m', '15m'],
    enableValidation: true,
    enableStorage: true,
    enableOrderbook: true,
    enableClockSync: true,
    
    rateLimiter: {
        requestWeight: { maxRequestsPerMinute: 1200 },
        minBackoff: 1000,
        maxBackoff: 60000
    },
    
    storage: {
        storageRoot: './data/production-umf',
        compression: true,
        compressionLevel: 6,
        partitionInterval: 'hourly'
    },
    
    clockSync: {
        maxSkewMs: 1000,
        warningSkewMs: 500,
        syncIntervalMs: 30000
    }
});
```

## 📊 Event Types

### Market Data Events
```javascript
// Kline events
umf.on('umf.kline.{SYMBOL}.{INTERVAL}', (kline) => {});

// Trade events  
umf.on('umf.trade.{SYMBOL}', (trade) => {});

// Ticker events
umf.on('umf.ticker.{SYMBOL}', (ticker) => {});

// Orderbook events
umf.on('umf.depth.{SYMBOL}', (depth) => {});
```

### System Events
```javascript
// Connection events
umf.on('stream_connected', (data) => {});
umf.on('stream_disconnected', (data) => {});

// Error events
umf.on('umf.error.{SYMBOL}', (error) => {});
umf.on('system_error', (error) => {});

// Quality events
umf.on('rate_limit_hit', (data) => {});
umf.on('critical_skew', (data) => {});
umf.on('orderbook_resync', (data) => {});
```

## 💾 Data Storage

### Reading Stored Data
```javascript
const storage = umf.dataStorage;

// Read specific time range
const data = await storage.read('BTCUSDT', 'kline', startTime, endTime);

// Replay data
storage.replay('BTCUSDT', 'kline', startTime, endTime, {
    speedMultiplier: 10,
    emitEvents: true
});

// Get features
const features = storage.getFeatures('BTCUSDT');
```

### Storage Directory Structure
```
data/production-umf/
├── BTCUSDT/
│   ├── kline/
│   │   └── 2025/08/28/kline_02.json.gz
│   ├── trade/
│   │   └── 2025/08/28/trade_02.json.gz
│   └── ticker/
│       └── 2025/08/28/ticker_02.json.gz
└── ETHUSDT/
    ├── kline/...
    ├── trade/...
    └── ticker/...
```

## 🛡️ Error Handling

### Comprehensive Error Catching
```javascript
// Validation errors
umf.on('umf.error.validation', (error) => {
    console.error(`Validation Error: ${error.message}`);
});

// Sequence gaps
umf.on('umf.error.BTCUSDT', (error) => {
    if (error.errorType === 'SEQUENCE_GAP') {
        console.log('Automatic resync triggered');
    }
});

// Rate limiting
umf.rateLimiter.on('rate_limit_hit', (data) => {
    console.warn(`Rate limit: ${data.limitType}`);
});

// Clock sync issues
if (umf.clockSync) {
    umf.clockSync.on('critical_skew', (data) => {
        console.error(`Clock skew: ${data.skewMs}ms`);
    });
}
```

## 📈 Statistics

### Getting System Stats
```javascript
const stats = umf.getStats();

console.log(`Messages/min: ${stats.messagesPerMinute}`);
console.log(`Drop rate: ${stats.dropRate}%`);
console.log(`Duplicate rate: ${stats.duplicateRate}%`);
console.log(`Validation errors: ${stats.validationErrors}`);

// Component-specific stats
console.log('Rate Limiter:', stats.rateLimiter);
console.log('Clock Sync:', stats.clockSync);
console.log('Data Storage:', stats.dataStorage);
console.log('Orderbook Validators:', stats.orderbookValidators);
```

## 🎛️ Advanced Features

### Custom Filters
```javascript
// Add custom validation
umf.rulesGuard.addCustomFilter('BTCUSDT', (data) => {
    return data.price > 0 && data.quantity > 0;
});

// Set custom rate limits
umf.rateLimiter.setCustomLimit('orderWeight', 100);
```

### Real-time Monitoring
```javascript
// Live dashboard data
setInterval(() => {
    const stats = umf.getStats();
    console.clear();
    console.log('Live Dashboard:', stats);
}, 5000);
```

## 🔧 Maintenance Commands

### Cleanup
```javascript
// Stop gracefully
await umf.stop();

// Clear storage
if (umf.dataStorage) {
    await umf.dataStorage.cleanup();
}
```

### Health Check
```javascript
// Check system health
const isHealthy = umf.clockSync?.getCurrentStatus().isHealthy;
const connectionCount = Object.keys(umf.getStats().connections).length;
const errorRate = umf.getStats().dropRate;

console.log(`System healthy: ${isHealthy && errorRate < 1}`);
```

---

**Not:** Tüm dosya yolları workspace root'undan relative olarak verilmiştir.  
**Demo çalıştırma:** `node production-umf-demo.js`
