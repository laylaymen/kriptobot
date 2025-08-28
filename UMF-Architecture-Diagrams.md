# Enhanced UMF - System Architecture & Data Flow

## 🏗️ High-Level Architecture

```mermaid
graph TB
    subgraph "External Data Sources"
        BinanceWS[Binance WebSocket]
        BinanceREST[Binance REST API]
    end
    
    subgraph "UMF Core Pipeline"
        UMF[UnifiedMarketFeed]
        Normalizer[EventNormalizer]
        Enricher[EventEnricher]
        Publisher[EventPublisher]
    end
    
    subgraph "Event Processing"
        Validator[Schema Validator]
        Deduplicator[Deduplicator]
        Throttler[Rate Throttler]
    end
    
    subgraph "Event Bus & Topics"
        EventBus[Event Bus]
        KlineTopic[market.kline.*.v1]
        TradeTopic[market.trades.*.v1]
        DepthTopic[market.depth.*.v1]
        HealthTopic[market.health.v1]
    end
    
    subgraph "Bot Modules (Consumers)"
        GB10[GB-10: Price Action]
        GB22[GB-22: Volume Analysis]
        GB36[GB-36: Order Flow]
        GB41[GB-41: Risk Management]
        GB42[GB-42: News Integration]
        GB60[GB-60: Position Management]
        Otobilinc[Otobilinç]
        VIVO[VIVO]
        LIVIA[LIVIA]
        Denetim[Denetim Asistanı]
    end
    
    BinanceWS --> UMF
    BinanceREST --> UMF
    UMF --> Normalizer
    Normalizer --> Enricher
    Enricher --> Validator
    Validator --> Deduplicator
    Deduplicator --> Throttler
    Throttler --> Publisher
    Publisher --> EventBus
    
    EventBus --> KlineTopic
    EventBus --> TradeTopic
    EventBus --> DepthTopic
    EventBus --> HealthTopic
    
    KlineTopic --> GB10
    KlineTopic --> GB22
    TradeTopic --> GB22
    TradeTopic --> GB36
    DepthTopic --> GB36
    HealthTopic --> GB41
    
    KlineTopic --> Otobilinc
    TradeTopic --> VIVO
    HealthTopic --> LIVIA
    HealthTopic --> Denetim
```

## 🔄 Data Processing Pipeline

```mermaid
sequenceDiagram
    participant Binance
    participant UMF
    participant Normalizer
    participant Enricher
    participant EventBus
    participant BotModule
    
    Binance->>UMF: Raw Market Data
    UMF->>UMF: Rate Limit Check
    UMF->>Normalizer: Process Raw Event
    
    Normalizer->>Normalizer: Schema Validation
    Normalizer->>Normalizer: Type Conversion
    Normalizer->>Normalizer: Deduplication
    Normalizer->>Normalizer: Sanity Checks
    
    Normalizer->>Enricher: Normalized Event
    
    Enricher->>Enricher: Calculate Rolling Metrics
    Enricher->>Enricher: Add Microstructure Features
    Enricher->>Enricher: Compute TCA Metrics
    Enricher->>Enricher: Generate Feature Vectors
    
    Enricher->>UMF: Enriched Event
    UMF->>UMF: Final Validation
    UMF->>UMF: Topic Generation
    UMF->>EventBus: Publish Event
    
    EventBus->>BotModule: Event Notification
    BotModule->>BotModule: Process Event
```

## 📊 Event Transformation Flow

```mermaid
graph LR
    subgraph "Input: Raw Binance Data"
        RawKline["{<br/>k: {<br/>  s: 'BTCUSDT',<br/>  o: '45000',<br/>  h: '45100',<br/>  l: '44950',<br/>  c: '45050'<br/>}<br/>}"]
    end
    
    subgraph "Stage 1: Normalization"
        NormKline["{<br/>kind: 'kline',<br/>symbol: 'BTCUSDT',<br/>o: 45000,<br/>h: 45100,<br/>l: 44950,<br/>c: 45050,<br/>validated: true<br/>}"]
    end
    
    subgraph "Stage 2: Enrichment"
        EnrichKline["{<br/>...normalized,<br/>rolling: {<br/>  '60s': { sma: 45025 }<br/>},<br/>features: {<br/>  rsi_14: 65<br/>},<br/>enriched: true<br/>}"]
    end
    
    subgraph "Stage 3: Publication"
        PubKline["Topic: market.kline.BTCUSDT.1m.v1<br/>{<br/>...enriched,<br/>publishTime: 1640995200000,<br/>messageId: 'abc123',<br/>schemaVersion: '1.0'<br/>}"]
    end
    
    RawKline --> NormKline
    NormKline --> EnrichKline
    EnrichKline --> PubKline
```

## 🎯 Module Subscription Matrix

| Bot Module | Kline | Trades | Depth | Ticker | Funding | Orders | Health |
|------------|-------|--------|-------|--------|---------|--------|--------|
| GB-10 (Price Action) | ✅ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ |
| GB-22 (Volume) | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| GB-36 (Order Flow) | ❌ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| GB-41 (Risk) | ✅ | ✅ | ✅ | ❌ | ✅ | ✅ | ✅ |
| GB-42 (News) | ✅ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ |
| GB-60 (Position) | ❌ | ✅ | ❌ | ❌ | ❌ | ✅ | ❌ |
| Otobilinç | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| VIVO | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ | ✅ |
| LIVIA | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| Denetim Asistanı | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |

## 🔧 Component Interaction Diagram

```mermaid
graph TB
    subgraph "Data Ingestion Layer"
        WS[WebSocket Streams]
        REST[REST API Calls]
        TimeSync[Time Synchronization]
    end
    
    subgraph "Processing Layer"
        subgraph "EventNormalizer"
            Parse[Parse & Validate]
            Convert[Type Conversion]
            Dedup[Deduplication]
            Sanitize[Sanity Checks]
        end
        
        subgraph "EventEnricher"
            Rolling[Rolling Metrics]
            Micro[Microstructure]
            TCA[TCA Analysis]
            Features[Feature Vectors]
        end
    end
    
    subgraph "Distribution Layer"
        Topics[Topic Generation]
        Throttle[Rate Throttling]
        Bus[Event Bus]
    end
    
    subgraph "State Management"
        Cache[Symbol Cache]
        History[Price History]
        Rules[Exchange Rules]
        Stats[Statistics]
    end
    
    WS --> Parse
    REST --> TimeSync
    Parse --> Convert
    Convert --> Dedup
    Dedup --> Sanitize
    
    Sanitize --> Rolling
    Rolling --> Micro
    Micro --> TCA
    TCA --> Features
    
    Features --> Topics
    Topics --> Throttle
    Throttle --> Bus
    
    Cache <--> Parse
    History <--> Rolling
    Rules <--> Convert
    Stats <--> Bus
```

## ⚡ Performance Optimization Flow

```mermaid
graph LR
    subgraph "Input Control"
        RateLimit[Rate Limiting]
        Backoff[Exponential Backoff]
        Cooldown[API Cooldown]
    end
    
    subgraph "Processing Optimization"
        Batch[Batch Processing]
        Cache[Smart Caching]
        Pipeline[Pipeline Parallelization]
    end
    
    subgraph "Output Control"
        Throttle[Event Throttling]
        Buffer[Event Buffering]
        Priority[Priority Queuing]
    end
    
    RateLimit --> Batch
    Backoff --> Cache
    Cooldown --> Pipeline
    
    Batch --> Throttle
    Cache --> Buffer
    Pipeline --> Priority
```

## 🏥 Health Monitoring Architecture

```mermaid
graph TB
    subgraph "Metrics Collection"
        Latency[Latency Tracking]
        Throughput[Throughput Monitoring]
        Errors[Error Rate Tracking]
        Memory[Memory Usage]
    end
    
    subgraph "SLO Evaluation"
        SLOLatency[Latency SLO<br/>< 100ms p95]
        SLOThroughput[Throughput SLO<br/>> 90% target]
        SLOErrors[Error Rate SLO<br/>< 1%]
        SLOUptime[Uptime SLO<br/>> 99.9%]
    end
    
    subgraph "Alerting"
        Breach[SLO Breach Detection]
        Alert[Alert Generation]
        Recovery[Recovery Actions]
    end
    
    Latency --> SLOLatency
    Throughput --> SLOThroughput
    Errors --> SLOErrors
    Memory --> SLOUptime
    
    SLOLatency --> Breach
    SLOThroughput --> Breach
    SLOErrors --> Breach
    SLOUptime --> Breach
    
    Breach --> Alert
    Alert --> Recovery
```

## 🔄 Deployment & Scaling Strategy

```mermaid
graph TB
    subgraph "Development"
        DevUMF[UMF Instance<br/>Single Symbol<br/>Basic Features]
    end
    
    subgraph "Staging"
        StageUMF[UMF Instance<br/>Multiple Symbols<br/>Full Features<br/>Conservative Limits]
    end
    
    subgraph "Production"
        ProdUMF1[UMF Primary<br/>Major Pairs<br/>Real-time]
        ProdUMF2[UMF Secondary<br/>Alt Coins<br/>Lower Priority]
        LoadBalancer[Load Balancer]
    end
    
    subgraph "Monitoring"
        Metrics[Metrics Collection]
        Dashboards[Grafana Dashboards]
        Alerts[Alert Manager]
    end
    
    DevUMF --> StageUMF
    StageUMF --> LoadBalancer
    LoadBalancer --> ProdUMF1
    LoadBalancer --> ProdUMF2
    
    ProdUMF1 --> Metrics
    ProdUMF2 --> Metrics
    Metrics --> Dashboards
    Metrics --> Alerts
```

## 🎛️ Configuration Management

```yaml
# config/development.yaml
umf:
  mode: conservative
  symbols: ['BTCUSDT']
  streams: ['kline_1m', 'trade']
  enableEnrichment: false
  maxEventsPerSecond: 10

# config/staging.yaml  
umf:
  mode: standard
  symbols: ['BTCUSDT', 'ETHUSDT']
  streams: ['kline_1m', 'kline_5m', 'trade']
  enableEnrichment: true
  maxEventsPerSecond: 50

# config/production.yaml
umf:
  mode: optimized
  symbols: ['BTCUSDT', 'ETHUSDT', 'ADAUSDT', 'BNBUSDT']
  streams: ['kline_1m', 'kline_5m', 'trade', 'depth']
  enableEnrichment: true
  enableTCA: true
  maxEventsPerSecond: 200
  rollingWindows: [60, 300, 900, 3600]
```
