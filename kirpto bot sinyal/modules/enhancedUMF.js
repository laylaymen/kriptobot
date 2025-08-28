/**
 * Enhanced UMF - Production Quality Data Pipeline
 * 
 * Full Binance API support with all filters, validation, and quality controls
 * Integrates all production quality components
 */

const EventEmitter = require('events');
const WebSocket = require('ws');
const axios = require('axios');

// Import quality components
const { ExchangeRulesGuard } = require('./exchangeRulesGuard');
const { RateLimitOrchestrator } = require('./rateLimitOrchestrator');
const { OrderbookValidator } = require('./orderbookValidator');
const { RawDataStorage } = require('./rawDataStorage');
const { ClockSyncMonitor } = require('./clockSyncMonitor');

class EnhancedUMF extends EventEmitter {
    constructor(options = {}) {
        super();
        
        this.config = {
            baseUrl: options.baseUrl || 'https://api.binance.com',
            wsUrl: options.wsUrl || 'wss://stream.binance.com:9443/ws',
            schemaVersion: '2.0',
            enableValidation: options.enableValidation !== false,
            enableStorage: options.enableStorage !== false,
            enableOrderbook: options.enableOrderbook !== false,
            enableClockSync: options.enableClockSync !== false,
            symbols: options.symbols || ['BTCUSDT', 'ETHUSDT'],
            intervals: options.intervals || ['1m', '5m', '15m'],
            maxReconnectAttempts: options.maxReconnectAttempts || 5,
            reconnectDelayMs: options.reconnectDelayMs || 1000,
            heartbeatIntervalMs: options.heartbeatIntervalMs || 30000,
            ...options
        };
        
        // Initialize quality components
        this.rulesGuard = new ExchangeRulesGuard();
        this.rateLimiter = new RateLimitOrchestrator(options.rateLimiter);
        this.clockSync = this.config.enableClockSync ? new ClockSyncMonitor(options.clockSync) : null;
        this.dataStorage = this.config.enableStorage ? new RawDataStorage(options.storage) : null;
        
        // Orderbook validators by symbol
        this.orderbookValidators = new Map();
        
        // WebSocket connections
        this.connections = new Map();
        this.reconnectAttempts = new Map();
        
        // State tracking
        this.state = {
            isInitialized: false,
            connectionStates: new Map(),
            lastHeartbeat: Date.now(),
            sequenceNumbers: new Map(),
            globalSequence: 0
        };
        
        // Message deduplication
        this.messageCache = new Map(); // eventTime+id -> true
        this.maxCacheSize = 10000;
        
        // Statistics
        this.stats = {
            messagesReceived: 0,
            messagesPublished: 0,
            messagesDropped: 0,
            duplicatesDetected: 0,
            validationErrors: 0,
            connectionDrops: 0,
            resyncs: 0,
            startTime: Date.now(),
            bySymbol: new Map(),
            byType: new Map()
        };
        
        // Setup event handlers
        this.setupEventHandlers();
        
        console.log(`🚀 Enhanced UMF initialized (schema: ${this.config.schemaVersion})`);
    }

    /**
     * Initialize the UMF system
     */
    async initialize() {
        console.log(`🔧 Initializing Enhanced UMF...`);
        
        try {
            // 1. Start clock sync monitor
            if (this.clockSync) {
                this.clockSync.start();
                console.log(`✅ Clock sync monitor started`);
            }
            
            // 2. Load exchange rules
            console.log(`📋 Loading exchange rules...`);
            const exchangeInfo = await this.loadExchangeInfo();
            await this.rulesGuard.loadRules(exchangeInfo);
            console.log(`✅ Exchange rules loaded for ${this.rulesGuard.getStats().symbolCount} symbols`);
            
            // 3. Start data storage
            if (this.dataStorage) {
                console.log(`✅ Data storage ready`);
            }
            
            // 4. Initialize orderbook validators
            if (this.config.enableOrderbook) {
                await this.initializeOrderbooks();
            }
            
            // 5. Start market data streams
            await this.startMarketDataStreams();
            
            // 6. Start heartbeat
            this.startHeartbeat();
            
            this.state.isInitialized = true;
            console.log(`✅ Enhanced UMF initialization complete`);
            
            this.emit('initialized');
            
        } catch (error) {
            console.error(`❌ Failed to initialize Enhanced UMF:`, error);
            this.emit('error', error);
            throw error;
        }
    }

    /**
     * Load exchange info from Binance
     */
    async loadExchangeInfo() {
        try {
            const response = await this.rateLimiter.scheduleRequest({
                method: 'GET',
                url: `${this.config.baseUrl}/api/v3/exchangeInfo`,
                params: { symbols: JSON.stringify(this.config.symbols) }
            }, 'critical');
            
            return response.data;
            
        } catch (error) {
            console.error(`❌ Failed to load exchange info:`, error);
            throw error;
        }
    }

    /**
     * Initialize orderbook validators for symbols
     */
    async initializeOrderbooks() {
        console.log(`📖 Initializing orderbook validators...`);
        
        for (const symbol of this.config.symbols) {
            const validator = new OrderbookValidator(symbol, {
                baseUrl: this.config.baseUrl,
                wsUrl: this.config.wsUrl
            });
            
            // Setup event handlers
            validator.on('snapshot', (data) => this.handleOrderbookSnapshot(data));
            validator.on('update', (data) => this.handleOrderbookUpdate(data));
            validator.on('resync', (data) => this.handleOrderbookResync(data));
            validator.on('error', (error) => this.handleOrderbookError(symbol, error));
            
            this.orderbookValidators.set(symbol, validator);
            
            // Start validator
            await validator.start();
            console.log(`✅ Orderbook validator ready: ${symbol}`);
        }
    }

    /**
     * Start market data WebSocket streams
     */
    async startMarketDataStreams() {
        console.log(`📡 Starting market data streams...`);
        
        for (const symbol of this.config.symbols) {
            // Start kline streams for all intervals
            for (const interval of this.config.intervals) {
                this.startKlineStream(symbol, interval);
            }
            
            // Start trade stream
            this.startTradeStream(symbol);
            
            // Start ticker stream
            this.startTickerStream(symbol);
        }
        
        console.log(`✅ Market data streams started`);
    }

    /**
     * Start kline stream for symbol and interval
     */
    startKlineStream(symbol, interval) {
        const streamName = `${symbol.toLowerCase()}@kline_${interval}`;
        const connectionKey = `kline_${symbol}_${interval}`;
        
        this.startWebSocketConnection(connectionKey, streamName, (message) => {
            this.handleKlineMessage(symbol, interval, message);
        });
    }

    /**
     * Start trade stream for symbol
     */
    startTradeStream(symbol) {
        const streamName = `${symbol.toLowerCase()}@aggTrade`;
        const connectionKey = `trade_${symbol}`;
        
        this.startWebSocketConnection(connectionKey, streamName, (message) => {
            this.handleTradeMessage(symbol, message);
        });
    }

    /**
     * Start ticker stream for symbol
     */
    startTickerStream(symbol) {
        const streamName = `${symbol.toLowerCase()}@bookTicker`;
        const connectionKey = `ticker_${symbol}`;
        
        this.startWebSocketConnection(connectionKey, streamName, (message) => {
            this.handleTickerMessage(symbol, message);
        });
    }

    /**
     * Start WebSocket connection with auto-reconnect
     */
    startWebSocketConnection(connectionKey, streamName, messageHandler) {
        const wsUrl = `${this.config.wsUrl}/${streamName}`;
        
        console.log(`🔌 Connecting to stream: ${streamName}`);
        
        const ws = new WebSocket(wsUrl);
        
        ws.on('open', () => {
            console.log(`✅ Connected to stream: ${streamName}`);
            this.state.connectionStates.set(connectionKey, 'connected');
            this.reconnectAttempts.set(connectionKey, 0);
            this.emit('stream_connected', { connectionKey, streamName });
        });
        
        ws.on('message', (data) => {
            try {
                const message = JSON.parse(data);
                messageHandler(message);
                this.stats.messagesReceived++;
                
            } catch (error) {
                console.error(`❌ Failed to parse message from ${streamName}:`, error);
                this.stats.messagesDropped++;
            }
        });
        
        ws.on('close', (code, reason) => {
            console.warn(`⚠️ Stream disconnected: ${streamName}, code: ${code}`);
            this.state.connectionStates.set(connectionKey, 'disconnected');
            this.stats.connectionDrops++;
            
            this.emit('stream_disconnected', { connectionKey, streamName, code, reason });
            
            // Auto-reconnect
            this.scheduleReconnect(connectionKey, streamName, messageHandler);
        });
        
        ws.on('error', (error) => {
            console.error(`❌ Stream error: ${streamName}`, error);
            this.emit('stream_error', { connectionKey, streamName, error });
        });
        
        this.connections.set(connectionKey, ws);
    }

    /**
     * Schedule reconnection with exponential backoff
     */
    scheduleReconnect(connectionKey, streamName, messageHandler) {
        const attempts = this.reconnectAttempts.get(connectionKey) || 0;
        
        if (attempts >= this.config.maxReconnectAttempts) {
            console.error(`❌ Max reconnect attempts reached for ${streamName}`);
            this.emit('stream_failed', { connectionKey, streamName, attempts });
            return;
        }
        
        const delay = this.config.reconnectDelayMs * Math.pow(2, attempts);
        this.reconnectAttempts.set(connectionKey, attempts + 1);
        
        console.log(`🔄 Reconnecting to ${streamName} in ${delay}ms (attempt ${attempts + 1})`);
        
        setTimeout(() => {
            this.startWebSocketConnection(connectionKey, streamName, messageHandler);
        }, delay);
    }

    /**
     * Handle kline message
     */
    handleKlineMessage(symbol, interval, message) {
        const kline = message.k;
        const eventTime = message.E;
        
        // Check for duplicates
        const messageId = `${symbol}_kline_${kline.t}_${kline.T}`;
        if (this.isDuplicate(messageId)) return;
        
        // Create UMF kline event
        const umfEvent = {
            schema: 'UMF',
            version: this.config.schemaVersion,
            kind: 'kline',
            symbol,
            interval,
            source: 'binance',
            sourceTs: eventTime,
            ingestTs: Date.now(),
            processTs: Date.now(),
            driftMs: this.clockSync ? this.clockSync.getStatus().currentSkewMs : 0,
            rulesVersion: this.rulesGuard.getStats().rulesVersion,
            lineage: {
                sourceType: 'WS',
                channel: `${symbol.toLowerCase()}@kline_${interval}`,
                sequence: this.getNextSequence()
            },
            
            // Kline data
            openTime: kline.t,
            closeTime: kline.T,
            firstTradeId: kline.f,
            lastTradeId: kline.L,
            open: kline.o,
            high: kline.h,
            low: kline.l,
            close: kline.c,
            volume: kline.v,
            quoteAssetVolume: kline.q,
            numberOfTrades: kline.n,
            takerBuyBaseAssetVolume: kline.V,
            takerBuyQuoteAssetVolume: kline.Q,
            closed: kline.x
        };
        
        // Validate if enabled
        if (this.config.enableValidation) {
            try {
                this.validateKline(umfEvent);
            } catch (error) {
                this.handleValidationError('kline', symbol, error, umfEvent);
                return;
            }
        }
        
        // Store raw data
        if (this.dataStorage) {
            this.dataStorage.store(symbol, 'kline', message, {
                source: 'binance',
                sourceTimestamp: eventTime,
                sequence: umfEvent.lineage.sequence
            });
        }
        
        // Publish event
        this.publishEvent(`umf.kline.${symbol}.${interval}`, umfEvent);
        this.updateStats(symbol, 'kline');
    }

    /**
     * Handle trade message
     */
    handleTradeMessage(symbol, message) {
        const eventTime = message.E;
        
        // Check for duplicates
        const messageId = `${symbol}_trade_${message.a}_${message.T}`;
        if (this.isDuplicate(messageId)) return;
        
        // Create UMF trade event
        const umfEvent = {
            schema: 'UMF',
            version: this.config.schemaVersion,
            kind: 'trade',
            symbol,
            source: 'binance',
            sourceTs: eventTime,
            ingestTs: Date.now(),
            processTs: Date.now(),
            driftMs: this.clockSync ? this.clockSync.getStatus().currentSkewMs : 0,
            rulesVersion: this.rulesGuard.getStats().rulesVersion,
            lineage: {
                sourceType: 'WS',
                channel: `${symbol.toLowerCase()}@aggTrade`,
                sequence: this.getNextSequence()
            },
            
            // Trade data
            tradeId: message.a,
            price: message.p,
            quantity: message.q,
            quoteQuantity: message.p * message.q,
            time: message.T,
            isBuyerMaker: message.m,
            isBestMatch: true
        };
        
        // Store raw data
        if (this.dataStorage) {
            this.dataStorage.store(symbol, 'trade', message, {
                source: 'binance',
                sourceTimestamp: eventTime,
                sequence: umfEvent.lineage.sequence
            });
        }
        
        // Publish event
        this.publishEvent(`umf.trade.${symbol}`, umfEvent);
        this.updateStats(symbol, 'trade');
    }

    /**
     * Handle ticker message
     */
    handleTickerMessage(symbol, message) {
        const eventTime = message.E;
        
        // Check for duplicates
        const messageId = `${symbol}_ticker_${message.u}_${eventTime}`;
        if (this.isDuplicate(messageId)) return;
        
        // Create UMF ticker event
        const umfEvent = {
            schema: 'UMF',
            version: this.config.schemaVersion,
            kind: 'bookTicker',
            symbol,
            source: 'binance',
            sourceTs: eventTime,
            ingestTs: Date.now(),
            processTs: Date.now(),
            driftMs: this.clockSync ? this.clockSync.getStatus().currentSkewMs : 0,
            rulesVersion: this.rulesGuard.getStats().rulesVersion,
            lineage: {
                sourceType: 'WS',
                channel: `${symbol.toLowerCase()}@bookTicker`,
                sequence: this.getNextSequence()
            },
            
            // Ticker data
            updateId: message.u,
            bidPrice: message.b,
            bidQty: message.B,
            askPrice: message.a,
            askQty: message.A
        };
        
        // Store raw data
        if (this.dataStorage) {
            this.dataStorage.store(symbol, 'ticker', message, {
                source: 'binance',
                sourceTimestamp: eventTime,
                sequence: umfEvent.lineage.sequence
            });
        }
        
        // Publish event
        this.publishEvent(`umf.ticker.${symbol}`, umfEvent);
        this.updateStats(symbol, 'ticker');
    }

    /**
     * Handle orderbook snapshot
     */
    handleOrderbookSnapshot(data) {
        const umfEvent = {
            schema: 'UMF',
            version: this.config.schemaVersion,
            kind: 'depthSnapshot',
            symbol: data.symbol,
            source: 'binance',
            sourceTs: Date.now(),
            ingestTs: Date.now(),
            processTs: Date.now(),
            driftMs: this.clockSync ? this.clockSync.getStatus().currentSkewMs : 0,
            rulesVersion: this.rulesGuard.getStats().rulesVersion,
            lineage: {
                sourceType: 'REST',
                endpoint: '/api/v3/depth',
                sequence: this.getNextSequence()
            },
            
            // Snapshot data
            lastUpdateId: data.lastUpdateId,
            bids: data.bids,
            asks: data.asks
        };
        
        this.publishEvent(`umf.depth.${data.symbol}`, umfEvent);
        this.updateStats(data.symbol, 'depth');
    }

    /**
     * Handle orderbook update
     */
    handleOrderbookUpdate(data) {
        const umfEvent = {
            schema: 'UMF',
            version: this.config.schemaVersion,
            kind: 'depthUpdate',
            symbol: data.symbol,
            source: 'binance',
            sourceTs: data.eventTime,
            ingestTs: Date.now(),
            processTs: Date.now(),
            driftMs: this.clockSync ? this.clockSync.getStatus().currentSkewMs : 0,
            rulesVersion: this.rulesGuard.getStats().rulesVersion,
            lineage: {
                sourceType: 'WS',
                channel: `${data.symbol.toLowerCase()}@depth`,
                sequence: this.getNextSequence()
            },
            
            // Update data
            firstUpdateId: data.firstUpdateId,
            finalUpdateId: data.finalUpdateId,
            bids: data.bids,
            asks: data.asks
        };
        
        this.publishEvent(`umf.depth.${data.symbol}`, umfEvent);
    }

    /**
     * Handle orderbook resync
     */
    handleOrderbookResync(data) {
        this.stats.resyncs++;
        
        const errorEvent = {
            schema: 'UMF',
            version: this.config.schemaVersion,
            kind: 'error',
            symbol: data.symbol,
            source: 'binance',
            sourceTs: data.timestamp,
            ingestTs: Date.now(),
            processTs: Date.now(),
            lineage: {
                sourceType: 'SYSTEM',
                sequence: this.getNextSequence()
            },
            
            errorType: 'SEQUENCE_GAP',
            message: 'Orderbook sequence gap detected, resync triggered',
            details: data,
            recovery: 'RESYNC'
        };
        
        this.publishEvent(`umf.error.${data.symbol}`, errorEvent);
        console.warn(`📖 Orderbook resync: ${data.symbol}, reason: ${data.reason}`);
    }

    /**
     * Handle orderbook error
     */
    handleOrderbookError(symbol, error) {
        console.error(`❌ Orderbook error for ${symbol}:`, error);
        this.emit('orderbook_error', { symbol, error });
    }

    /**
     * Validate kline data
     */
    validateKline(kline) {
        const rules = this.rulesGuard.getSymbolRules(kline.symbol);
        if (!rules) return; // No rules available
        
        // Validate price format
        const prices = [kline.open, kline.high, kline.low, kline.close];
        for (const price of prices) {
            if (rules.priceFilter) {
                this.rulesGuard.assertPriceFilters(parseFloat(price), kline.symbol);
            }
        }
        
        // Validate volume format
        if (rules.lotSizeFilter) {
            this.rulesGuard.assertLotSizeFilters(parseFloat(kline.volume), kline.symbol);
        }
    }

    /**
     * Handle validation error
     */
    handleValidationError(type, symbol, error, data) {
        this.stats.validationErrors++;
        
        const errorEvent = {
            schema: 'UMF',
            version: this.config.schemaVersion,
            kind: 'error',
            symbol,
            source: 'binance',
            ingestTs: Date.now(),
            processTs: Date.now(),
            lineage: {
                sourceType: 'VALIDATION',
                sequence: this.getNextSequence()
            },
            
            errorType: 'VALIDATION',
            message: `Validation failed for ${type}: ${error.message}`,
            details: { originalData: data, validationError: error.message },
            recovery: 'SKIP'
        };
        
        this.publishEvent(`umf.error.${symbol}`, errorEvent);
        console.warn(`⚠️ Validation error for ${symbol} ${type}:`, error.message);
    }

    /**
     * Check for duplicate messages
     */
    isDuplicate(messageId) {
        if (this.messageCache.has(messageId)) {
            this.stats.duplicatesDetected++;
            return true;
        }
        
        // Add to cache
        this.messageCache.set(messageId, true);
        
        // Cleanup cache if too large
        if (this.messageCache.size > this.maxCacheSize) {
            const keysToDelete = Array.from(this.messageCache.keys()).slice(0, this.maxCacheSize / 2);
            keysToDelete.forEach(key => this.messageCache.delete(key));
        }
        
        return false;
    }

    /**
     * Get next sequence number
     */
    getNextSequence() {
        return ++this.state.globalSequence;
    }

    /**
     * Publish UMF event
     */
    publishEvent(topic, event) {
        this.emit(topic, event);
        this.emit('umf_event', { topic, event });
        this.stats.messagesPublished++;
    }

    /**
     * Update statistics
     */
    updateStats(symbol, type) {
        // Update by symbol
        if (!this.stats.bySymbol.has(symbol)) {
            this.stats.bySymbol.set(symbol, { total: 0, types: new Map() });
        }
        const symbolStats = this.stats.bySymbol.get(symbol);
        symbolStats.total++;
        symbolStats.types.set(type, (symbolStats.types.get(type) || 0) + 1);
        
        // Update by type
        this.stats.byType.set(type, (this.stats.byType.get(type) || 0) + 1);
    }

    /**
     * Setup event handlers
     */
    setupEventHandlers() {
        // Handle rate limiter events
        this.rateLimiter.on('rate_limit_hit', (data) => {
            console.warn(`🚦 Rate limit hit:`, data);
        });
        
        // Handle clock sync events
        if (this.clockSync) {
            this.clockSync.on('critical_skew', (data) => {
                console.error(`🚨 Critical clock skew detected:`, data);
                this.emit('critical_skew', data);
            });
            
            this.clockSync.on('sync_failure', (data) => {
                console.error(`🚨 Clock sync failure:`, data);
                this.emit('sync_failure', data);
            });
        }
    }

    /**
     * Start heartbeat
     */
    startHeartbeat() {
        setInterval(() => {
            this.state.lastHeartbeat = Date.now();
            
            const heartbeat = {
                schema: 'UMF',
                version: this.config.schemaVersion,
                kind: 'heartbeat',
                source: 'binance',
                timestamp: Date.now(),
                stats: this.getStats()
            };
            
            this.emit('umf.heartbeat', heartbeat);
        }, this.config.heartbeatIntervalMs);
    }

    /**
     * Get comprehensive statistics
     */
    getStats() {
        const runtime = Date.now() - this.stats.startTime;
        const runtimeMinutes = runtime / 60000;
        
        return {
            ...this.stats,
            runtime,
            runtimeMinutes,
            messagesPerMinute: this.stats.messagesReceived / runtimeMinutes,
            publishRate: this.stats.messagesPublished / runtimeMinutes,
            dropRate: (this.stats.messagesDropped / this.stats.messagesReceived) * 100 || 0,
            duplicateRate: (this.stats.duplicatesDetected / this.stats.messagesReceived) * 100 || 0,
            
            // Component stats
            rulesGuard: this.rulesGuard.getStats(),
            rateLimiter: this.rateLimiter.getStats(),
            clockSync: this.clockSync ? this.clockSync.getStats() : null,
            dataStorage: this.dataStorage ? this.dataStorage.getStats() : null,
            
            // Connection states
            connections: Object.fromEntries(this.state.connectionStates),
            orderbookValidators: Object.fromEntries(
                Array.from(this.orderbookValidators.entries()).map(([symbol, validator]) => [
                    symbol, validator.getStats()
                ])
            ),
            
            // Message stats by symbol and type
            bySymbol: Object.fromEntries(this.stats.bySymbol),
            byType: Object.fromEntries(this.stats.byType)
        };
    }

    /**
     * Stop Enhanced UMF
     */
    async stop() {
        console.log(`🛑 Stopping Enhanced UMF...`);
        
        // Stop WebSocket connections
        for (const [key, ws] of this.connections) {
            ws.close();
        }
        this.connections.clear();
        
        // Stop orderbook validators
        for (const [symbol, validator] of this.orderbookValidators) {
            validator.stop();
        }
        
        // Stop components
        if (this.clockSync) this.clockSync.stop();
        if (this.dataStorage) await this.dataStorage.stop();
        this.rateLimiter.stop();
        
        console.log(`✅ Enhanced UMF stopped`);
        this.emit('stopped');
    }
}

module.exports = { EnhancedUMF };
