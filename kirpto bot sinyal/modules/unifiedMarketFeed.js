/**
 * GB-U0 · unifiedMarketFeed.js
 * 
 * Binance ham verisini normalize edip tüm modüllere tek şema ile yayınlayan katman
 * 
 * Amaç: Binance REST/WS verilerini al, tek şemaya dönüştür, kalite kontrollerinden geçir, 
 * modüllere pub-sub ile dağıt.
 * 
 * Çıktı topic'leri:
 * - umf.candle.[symbol].[interval] 
 * - umf.trade.[symbol]
 * - umf.book.[symbol] 
 * - umf.ticker.[symbol]
 * - umf.funding.[symbol]
 * - umf.rules.[symbol]
 * - umf.clock
 */

const EventEmitter = require('events');
const crypto = require('crypto');
const WebSocket = require('ws');
const axios = require('axios');
const { EventNormalizer } = require('./eventNormalizer');
const { EventEnricher } = require('./eventEnricher');

// Basit pub-sub için EventEmitter
const bus = new EventEmitter();
bus.setMaxListeners(100); // Çok sayıda modül dinleyebilir

// Binance endpoints
const REST_BASE = "https://api.binance.com";
const WS_BASE = "wss://stream.binance.com:9443/ws";

// Global state
let driftMs = 0;
let rulesHash = "";
let exchangeRules = {};

// Rate limiting - CONSERVATIVE SETTINGS
let requestWeight = 0;
let lastResetTime = Date.now();
const WEIGHT_LIMIT = 800; // Conservative limit (instead of 1200)
const RESET_INTERVAL = 60000; // 1 minute
const REQUEST_DELAY = 200; // 200ms delay between requests

class UnifiedMarketFeed extends EventEmitter {
    constructor(config = {}) {
        super();
        
        this.config = {
            // Enhanced pipeline settings
            enableNormalization: true,
            enableEnrichment: true,
            enableValidation: true,
            strictValidation: false,
            dropInvalidEvents: false,
            
            // Topic naming for pub-sub
            topicPrefix: 'market',
            topicVersion: 'v1',
            
            // Data flow control
            enableThrottling: true,
            maxEventsPerSecond: 50,
            enableDeduplication: true,
            
            // Debug
            debug: process.env.UMF_DEBUG === 'true',
            
            ...config
        };
        
        // Initialize pipeline components
        this.normalizer = new EventNormalizer({
            validatePrices: this.config.enableValidation,
            validateQuantities: this.config.enableValidation,
            strictValidation: this.config.strictValidation,
            dropInvalidEvents: this.config.dropInvalidEvents,
            dedupWindowMs: 10000
        });
        
        this.enricher = new EventEnricher({
            enableRollingMetrics: this.config.enableEnrichment,
            enableMicrostructure: this.config.enableEnrichment,
            enableTCA: this.config.enableEnrichment,
            enableFeatureVectors: this.config.enableEnrichment,
            rollingWindows: [60, 300, 900], // 1m, 5m, 15m
            maxHistoryItems: 5000
        });
        
        // Stream management
        this.activeStreams = new Map();
        this.orderbookStates = new Map();
        this.isInitialized = false;
        
        // Event processing
        this.seenEvents = new Set();
        this.lastEmitTime = 0;
        
        // Statistics with enhanced pipeline metrics
        this.stats = {
            totalEvents: 0,
            duplicatesDropped: 0,
            errorsCount: 0,
            pipeline: {
                normalized: 0,
                enriched: 0,
                published: 0,
                dropped: 0
            }
        };
        
        // Symbol metadata cache
        this.symbolInfo = new Map();
    }

    /**
     * Zaman senkronu - Binance server time ile local time arasındaki farkı hesapla
     */
    async timeSync() {
        try {
            const startTime = Date.now();
            const response = await this.makeRestRequest('/api/v3/time');
            const endTime = Date.now();
            const roundTripTime = endTime - startTime;
            
            const serverTime = response.data.serverTime;
            driftMs = serverTime - (startTime + roundTripTime / 2);
            
            if (Math.abs(driftMs) > 100) {
                console.warn(`⚠️ Time drift detected: ${driftMs}ms. Consider NTP sync.`);
            }

            this.publish("umf.clock", {
                serverTime,
                localTime: Date.now(),
                driftMs,
                roundTripMs: roundTripTime
            });

            console.log(`🕐 Time synced. Drift: ${driftMs}ms`);
            return driftMs;
        } catch (error) {
            console.error('❌ Time sync failed:', error.message);
            throw error;
        }
    }

    /**
     * Exchange info yükle ve kuralları önbelleğe al
     */
    async loadExchangeInfo(symbols = []) {
        try {
            const params = symbols.length > 0 ? { symbols: JSON.stringify(symbols) } : {};
            const response = await this.makeRestRequest('/api/v3/exchangeInfo', params);
            
            const rules = {};
            
            response.data.symbols.forEach(symbolInfo => {
                const symbol = symbolInfo.symbol;
                const filters = this.parseFilters(symbolInfo.filters);
                
                rules[symbol] = {
                    kind: "rules",
                    symbol,
                    status: symbolInfo.status,
                    baseAsset: symbolInfo.baseAsset,
                    quoteAsset: symbolInfo.quoteAsset,
                    filters,
                    orderTypes: symbolInfo.orderTypes || [],
                    timeInForce: symbolInfo.timeInForce || [],
                    permissions: symbolInfo.permissions || []
                };
            });

            // Rules hash oluştur
            const rulesStr = JSON.stringify(rules);
            rulesHash = crypto.createHash('md5').update(rulesStr).digest('hex');
            exchangeRules = rules;

            // Her symbol için rules yayınla
            Object.values(rules).forEach(rule => {
                rule.rulesVersion = rulesHash;
                this.publish(`umf.rules.${rule.symbol}`, rule);
            });

            console.log(`📋 Exchange rules loaded for ${Object.keys(rules).length} symbols. Hash: ${rulesHash.substring(0, 8)}`);
            return rules;
        } catch (error) {
            console.error('❌ Failed to load exchange info:', error.message);
            throw error;
        }
    }

    /**
     * Binance filter'larını parse et
     */
    parseFilters(filters) {
        const result = {};

        const findFilter = (type) => filters.find(f => f.filterType === type);

        const priceFilter = findFilter('PRICE_FILTER');
        if (priceFilter) {
            result.price = {
                min: priceFilter.minPrice,
                max: priceFilter.maxPrice,
                tick: priceFilter.tickSize
            };
        }

        const lotFilter = findFilter('LOT_SIZE');
        if (lotFilter) {
            result.lot = {
                min: lotFilter.minQty,
                max: lotFilter.maxQty,
                step: lotFilter.stepSize
            };
        }

        const notionalFilter = findFilter('NOTIONAL') || findFilter('MIN_NOTIONAL');
        if (notionalFilter) {
            result.notional = {
                min: notionalFilter.minNotional,
                max: notionalFilter.maxNotional,
                avgPriceMins: notionalFilter.avgPriceMins
            };
        }

        const percentPriceFilter = findFilter('PERCENT_PRICE');
        if (percentPriceFilter) {
            result.percentPrice = {
                up: percentPriceFilter.multiplierUp,
                down: percentPriceFilter.multiplierDown,
                avgPriceMins: percentPriceFilter.avgPriceMins
            };
        }

        const percentPriceBySideFilter = findFilter('PERCENT_PRICE_BY_SIDE');
        if (percentPriceBySideFilter) {
            result.percentPriceBySide = {
                bidUp: percentPriceBySideFilter.bidMultiplierUp,
                bidDown: percentPriceBySideFilter.bidMultiplierDown,
                askUp: percentPriceBySideFilter.askMultiplierUp,
                askDown: percentPriceBySideFilter.askMultiplierDown,
                avgPriceMins: percentPriceBySideFilter.avgPriceMins
            };
        }

        return result;
    }

    /**
     * Rate limit kontrolü ile REST request - CONSERVATIVE MODE
     */
    async makeRestRequest(endpoint, params = {}, weight = 1) {
        // Delay between requests
        await new Promise(resolve => setTimeout(resolve, REQUEST_DELAY));
        
        // Rate limit check
        const now = Date.now();
        if (now - lastResetTime > RESET_INTERVAL) {
            requestWeight = 0;
            lastResetTime = now;
        }

        if (requestWeight + weight > WEIGHT_LIMIT) {
            const waitTime = RESET_INTERVAL - (now - lastResetTime) + 1000; // Extra 1s buffer
            console.warn(`⏳ Rate limit approaching. Waiting ${Math.round(waitTime/1000)}s`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
            requestWeight = 0;
            lastResetTime = Date.now();
        }

        try {
            const response = await axios.get(`${REST_BASE}${endpoint}`, { 
                params,
                timeout: 15000, // Increased timeout
                headers: {
                    'X-MBX-APIKEY': process.env.BINANCE_API_KEY || ''
                }
            });
            
            requestWeight += weight;
            
            // Log weight usage for monitoring
            if (requestWeight > WEIGHT_LIMIT * 0.7) {
                console.warn(`⚠️ High API usage: ${requestWeight}/${WEIGHT_LIMIT}`);
            }
            
            return response;
        } catch (error) {
            if (error.response?.status === 429) {
                // Aggressive backoff for rate limits
                const retryAfter = parseInt(error.response.headers['retry-after']) || 60;
                const jitter = Math.random() * 5000; // 0-5s jitter
                const backoffTime = (retryAfter * 1000) + jitter + 10000; // Extra 10s buffer
                
                console.warn(`🔄 Rate limited. Backing off for ${Math.round(backoffTime/1000)}s`);
                await new Promise(resolve => setTimeout(resolve, backoffTime));
                
                // Reset weight and try once more
                requestWeight = 0;
                lastResetTime = Date.now();
                return this.makeRestRequest(endpoint, params, weight);
            }
            
            if (error.response?.status === 418) {
                console.error(`🚫 IP temporarily banned. Status: ${error.response.status}`);
                throw new Error(`Binance IP ban detected. Wait before retrying.`);
            }
            
            throw error;
        }
    }

    /**
     * Mesaj yayınlama helper'ı
     */
    publish(topic, payload) {
        const message = {
            ...payload,
            source: "binance",
            ingestTs: Date.now(),
            driftMs,
            rulesVersion: rulesHash
        };

        bus.emit(topic, message);
        
        // Debug için
        if (process.env.UMF_DEBUG === 'true') {
            console.log(`📡 Published ${topic}:`, JSON.stringify(message).substring(0, 200) + '...');
        }
    }

    /**
     * Enhanced Event Processing Pipeline
     * normalize → enrich → validate → publish
     */
    async processRawEvent(rawEvent, symbol) {
        try {
            this.stats.totalEvents++;
            
            // Step 1: Normalize
            const symbolMeta = this.symbolInfo.get(symbol);
            const serverTime = Date.now() + driftMs;
            
            const normalizedEvent = this.normalizer.normalize(rawEvent, symbolMeta, serverTime);
            if (!normalizedEvent) {
                this.stats.pipeline.dropped++;
                return; // Event was filtered/dropped
            }
            
            this.stats.pipeline.normalized++;
            
            // Step 2: Enrich
            let enrichedEvent = normalizedEvent;
            if (this.config.enableEnrichment) {
                enrichedEvent = await this.enricher.enrich(normalizedEvent);
                this.stats.pipeline.enriched++;
            }
            
            // Step 3: Validate and publish
            if (this.validateAndPublish(enrichedEvent)) {
                this.stats.pipeline.published++;
            }
            
        } catch (error) {
            console.error('❌ Pipeline processing error:', error.message);
            this.stats.errorsCount++;
            
            // Emit error event for monitoring
            this.emit('error', {
                type: 'pipeline_error',
                symbol,
                error: error.message,
                timestamp: Date.now()
            });
        }
    }

    /**
     * Validate event and publish to appropriate topic
     */
    validateAndPublish(event) {
        try {
            // Generate topic name based on enhanced schema
            const topic = this.generateTopicName(event);
            
            // Throttling check
            if (this.config.enableThrottling && !this.checkThrottle()) {
                return false;
            }
            
            // Deduplication check
            if (this.config.enableDeduplication && this.isDuplicate(event)) {
                this.stats.duplicatesDropped++;
                return false;
            }
            
            // Publish event
            this.publishEnhanced(topic, event);
            
            return true;
            
        } catch (error) {
            console.error('❌ Validation/publish error:', error.message);
            return false;
        }
    }

    /**
     * Generate topic name based on enhanced event schema
     */
    generateTopicName(event) {
        const { kind, symbol, tf } = event;
        const prefix = this.config.topicPrefix;
        const version = this.config.topicVersion;
        
        switch (kind) {
            case 'kline':
                return `${prefix}.kline.${symbol}.${tf}.${version}`;
            case 'trade':
                return `${prefix}.trades.${symbol}.${version}`;
            case 'depth':
                return `${prefix}.depth.${symbol}.${version}`;
            case 'ticker':
                return `${prefix}.ticker.${symbol}.${version}`;
            case 'funding':
                return `${prefix}.funding.${symbol}.${version}`;
            case 'order':
                return `${prefix}.orders.${symbol}.${version}`;
            case 'rules':
                return `${prefix}.rules.${symbol}.${version}`;
            case 'clock':
                return `${prefix}.clock.${version}`;
            case 'health':
                return `${prefix}.health.${version}`;
            default:
                return `${prefix}.unknown.${symbol}.${version}`;
        }
    }

    /**
     * Enhanced publish with metadata
     */
    publishEnhanced(topic, event) {
        const enhancedMessage = {
            ...event,
            publishTime: Date.now(),
            publishTopic: topic,
            messageId: this.generateMessageId(),
            schemaVersion: event.schemaVersion || '1.0'
        };
        
        // Emit to event bus
        bus.emit(topic, enhancedMessage);
        
        // Also emit generic event for monitoring
        this.emit('event', {
            topic,
            event: enhancedMessage,
            kind: event.kind
        });
        
        // Debug logging (if enabled)
        if (this.config.debug) {
            console.log(`📡 Published ${topic}:`, JSON.stringify(enhancedMessage).substring(0, 200) + '...');
        }
    }

    /**
     * Check throttling limits
     */
    checkThrottle() {
        const now = Date.now();
        
        if (now - this.lastEmitTime < (1000 / this.config.maxEventsPerSecond)) {
            return false; // Too fast
        }
        
        this.lastEmitTime = now;
        return true;
    }

    /**
     * Check for duplicate events
     */
    isDuplicate(event) {
        const key = this.generateEventKey(event);
        
        if (this.seenEvents.has(key)) {
            return true;
        }
        
        // Add to seen events with TTL
        this.seenEvents.add(key);
        
        // Cleanup old entries periodically
        if (this.seenEvents.size > 10000) {
            this.seenEvents.clear();
        }
        
        return false;
    }

    /**
     * Generate unique event key for deduplication
     */
    generateEventKey(event) {
        const keyData = {
            kind: event.kind,
            symbol: event.symbol,
            eventTime: event.eventTime,
            sequence: event.sequence
        };
        
        return crypto.createHash('md5')
            .update(JSON.stringify(keyData))
            .digest('hex');
    }

    /**
     * Generate unique message ID
     */
    generateMessageId() {
        return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * Kline (mum) verilerini stream et - CONSERVATIVE MODE
     */
    async streamKlines(symbol, interval) {
        const streamKey = `kline_${symbol}_${interval}`;
        
        if (this.activeStreams.has(streamKey)) {
            console.warn(`⚠️ Stream already active: ${streamKey}`);
            return;
        }

        try {
            // CONSERVATIVE: Skip backfill for frequently used intervals to save API calls
            if (!['1s', '1m'].includes(interval)) {
                await this.backfillKlines(symbol, interval, 20); // Reduced to 20 candles
            } else {
                console.log(`⚡ Skipping backfill for ${interval} to conserve API calls`);
            }

            // Add delay before WebSocket to avoid hammering
            await new Promise(resolve => setTimeout(resolve, 500));

            // WebSocket stream başlat
            const channel = `${symbol.toLowerCase()}@kline_${interval}`;
            const ws = new WebSocket(`${WS_BASE}/${channel}`);
            
            ws.on('open', () => {
                console.log(`📈 Kline stream started: ${symbol} ${interval}`);
            });

            ws.on('message', async (data) => {
                try {
                    const rawMessage = JSON.parse(data.toString());
                    
                    // Process through enhanced pipeline
                    await this.processRawEvent(rawMessage, symbol);
                    
                } catch (error) {
                    console.error('❌ Kline parse error:', error.message);
                    this.stats.errorsCount++;
                }
            });

            ws.on('error', (error) => {
                console.error(`❌ Kline stream error (${symbol} ${interval}):`, error.message);
                this.activeStreams.delete(streamKey);
            });

            ws.on('close', () => {
                console.log(`📉 Kline stream closed: ${symbol} ${interval}`);
                this.activeStreams.delete(streamKey);
                
                // Conservative auto-reconnect - longer delay
                setTimeout(() => {
                    console.log(`🔄 Reconnecting kline stream: ${symbol} ${interval}`);
                    this.streamKlines(symbol, interval);
                }, 10000); // Increased to 10 seconds
            });

            this.activeStreams.set(streamKey, ws);
            return ws;
        } catch (error) {
            console.error(`❌ Failed to start kline stream ${symbol} ${interval}:`, error.message);
            throw error;
        }
    }

    /**
     * REST ile geçmiş mum verilerini al - CONSERVATIVE BACKFILL
     */
    async backfillKlines(symbol, interval, limit = 50) { // Reduced from 100 to 50
        try {
            console.log(`📊 Backfilling ${limit} ${interval} candles for ${symbol}...`);
            
            const response = await this.makeRestRequest('/api/v3/klines', {
                symbol: symbol.toUpperCase(),
                interval,
                limit
            }, 2); // Higher weight for klines

            const klines = response.data;
            
            for (const kline of klines) {
                const candleData = {
                    kind: "candle",
                    symbol: symbol.toUpperCase(),
                    interval,
                    tsOpen: kline[0],
                    tsClose: kline[6],
                    o: kline[1],
                    h: kline[2],
                    l: kline[3],
                    c: kline[4],
                    v: kline[5],
                    qv: kline[7],
                    closed: true, // Historical data is always closed
                    sourceTs: kline[0],
                    trades: kline[8]
                };

                this.publish(`umf.candle.${symbol.toUpperCase()}.${interval}`, candleData);
            }

            console.log(`✅ Backfilled ${klines.length} ${interval} candles for ${symbol}`);
        } catch (error) {
            console.error(`❌ Backfill failed for ${symbol} ${interval}:`, error.message);
            // Don't throw - continue with WebSocket even if backfill fails
        }
    }

    /**
     * Aggregate trade stream
     */
    streamAggTrades(symbol) {
        const streamKey = `aggTrade_${symbol}`;
        
        if (this.activeStreams.has(streamKey)) {
            console.warn(`⚠️ Stream already active: ${streamKey}`);
            return;
        }

        const channel = `${symbol.toLowerCase()}@aggTrade`;
        const ws = new WebSocket(`${WS_BASE}/${channel}`);
        
        ws.on('open', () => {
            console.log(`💰 AggTrade stream started: ${symbol}`);
        });

        ws.on('message', (data) => {
            try {
                const trade = JSON.parse(data.toString());
                
                const tradeData = {
                    kind: "trade",
                    symbol: symbol.toUpperCase(),
                    ts: trade.T,
                    id: trade.a,
                    px: trade.p,
                    qty: trade.q,
                    isBuyerMaker: trade.m,
                    sourceTs: trade.E
                };

                this.publish(`umf.trade.${symbol.toUpperCase()}`, tradeData);
            } catch (error) {
                console.error('❌ AggTrade parse error:', error.message);
            }
        });

        ws.on('error', (error) => {
            console.error(`❌ AggTrade stream error (${symbol}):`, error.message);
            this.activeStreams.delete(streamKey);
        });

        ws.on('close', () => {
            console.log(`💸 AggTrade stream closed: ${symbol}`);
            this.activeStreams.delete(streamKey);
            
            // Auto-reconnect
            setTimeout(() => {
                console.log(`🔄 Reconnecting aggTrade stream: ${symbol}`);
                this.streamAggTrades(symbol);
            }, 5000);
        });

        this.activeStreams.set(streamKey, ws);
        return ws;
    }

    /**
     * Book ticker stream (best bid/ask)
     */
    streamBookTicker(symbol) {
        const streamKey = `bookTicker_${symbol}`;
        
        if (this.activeStreams.has(streamKey)) {
            console.warn(`⚠️ Stream already active: ${streamKey}`);
            return;
        }

        const channel = `${symbol.toLowerCase()}@bookTicker`;
        const ws = new WebSocket(`${WS_BASE}/${channel}`);
        
        ws.on('open', () => {
            console.log(`📊 BookTicker stream started: ${symbol}`);
        });

        ws.on('message', (data) => {
            try {
                const ticker = JSON.parse(data.toString());
                
                const tickerData = {
                    kind: "ticker",
                    symbol: symbol.toUpperCase(),
                    ts: ticker.u,
                    bidPx: ticker.b,
                    bidSz: ticker.B,
                    askPx: ticker.a,
                    askSz: ticker.A,
                    sourceTs: ticker.E || Date.now()
                };

                this.publish(`umf.ticker.${symbol.toUpperCase()}`, tickerData);
            } catch (error) {
                console.error('❌ BookTicker parse error:', error.message);
            }
        });

        ws.on('error', (error) => {
            console.error(`❌ BookTicker stream error (${symbol}):`, error.message);
            this.activeStreams.delete(streamKey);
        });

        ws.on('close', () => {
            console.log(`📋 BookTicker stream closed: ${symbol}`);
            this.activeStreams.delete(streamKey);
            
            // Auto-reconnect
            setTimeout(() => {
                console.log(`🔄 Reconnecting bookTicker stream: ${symbol}`);
                this.streamBookTicker(symbol);
            }, 5000);
        });

        this.activeStreams.set(streamKey, ws);
        return ws;
    }

    /**
     * Orderbook L2 depth stream with snapshot + diffs - CONSERVATIVE MODE
     */
    async streamOrderbookL2(symbol, limit = 100) { // Reduced from 500 to 100
        const streamKey = `depth_${symbol}`;
        
        if (this.activeStreams.has(streamKey)) {
            console.warn(`⚠️ Stream already active: ${streamKey}`);
            return;
        }

        try {
            console.log(`📖 Starting conservative orderbook stream for ${symbol}...`);
            
            // 1. İlk snapshot al - reduced limit
            const snapshot = await this.makeRestRequest('/api/v3/depth', {
                symbol: symbol.toUpperCase(),
                limit: 100 // Reduced from 1000 to 100
            }, 5); // Conservative weight

            let lastUpdateId = snapshot.data.lastUpdateId;
            const bids = new Map();
            const asks = new Map();

            // Snapshot'ı state'e yükle
            snapshot.data.bids.forEach(([price, qty]) => {
                if (parseFloat(qty) > 0) bids.set(price, qty);
            });
            snapshot.data.asks.forEach(([price, qty]) => {
                if (parseFloat(qty) > 0) asks.set(price, qty);
            });

            // İlk L2 data yayınla
            this.publishOrderbook(symbol, bids, asks, lastUpdateId);

            // Add delay before WebSocket
            await new Promise(resolve => setTimeout(resolve, 1000));

            // 2. Diff stream başlat - slower updates
            const channel = `${symbol.toLowerCase()}@depth@1000ms`; // Changed from 100ms to 1000ms
            const ws = new WebSocket(`${WS_BASE}/${channel}`);
            
            ws.on('open', () => {
                console.log(`📖 Orderbook L2 stream started: ${symbol} (conservative mode)`);
            });

            ws.on('message', (data) => {
                try {
                    const diff = JSON.parse(data.toString());
                    
                    // Sequence check
                    if (diff.u <= lastUpdateId) {
                        return; // Eski mesaj, atla
                    }
                    
                    if (diff.U !== lastUpdateId + 1) {
                        console.warn(`⚠️ Orderbook gap detected for ${symbol}. Ignoring for now.`);
                        // Conservative: don't refresh snapshot immediately, just log
                        return;
                    }

                    lastUpdateId = diff.u;

                    // Bid updates
                    diff.b.forEach(([price, qty]) => {
                        if (parseFloat(qty) === 0) {
                            bids.delete(price);
                        } else {
                            bids.set(price, qty);
                        }
                    });

                    // Ask updates  
                    diff.a.forEach(([price, qty]) => {
                        if (parseFloat(qty) === 0) {
                            asks.delete(price);
                        } else {
                            asks.set(price, qty);
                        }
                    });

                    // Güncellenmiş orderbook yayınla
                    this.publishOrderbook(symbol, bids, asks, lastUpdateId, diff.E);

                } catch (error) {
                    console.error('❌ Orderbook diff parse error:', error.message);
                }
            });

            ws.on('error', (error) => {
                console.error(`❌ Orderbook stream error (${symbol}):`, error.message);
                this.activeStreams.delete(streamKey);
            });

            ws.on('close', () => {
                console.log(`📕 Orderbook stream closed: ${symbol}`);
                this.activeStreams.delete(streamKey);
                
                // Conservative auto-reconnect - much longer delay
                setTimeout(() => {
                    console.log(`🔄 Reconnecting orderbook stream: ${symbol}`);
                    this.streamOrderbookL2(symbol, limit);
                }, 15000); // Increased to 15 seconds
            });

            this.activeStreams.set(streamKey, ws);
            this.orderbookStates.set(symbol, { bids, asks, lastUpdateId });
            
            return ws;
        } catch (error) {
            console.error(`❌ Failed to start orderbook stream ${symbol}:`, error.message);
            // Don't throw in conservative mode
            return null;
        }
    }

    /**
     * Orderbook data yayınla
     */
    publishOrderbook(symbol, bids, asks, lastUpdateId, sourceTs = null) {
        // Top N levels al ve sırala
        const topBids = Array.from(bids.entries())
            .sort((a, b) => parseFloat(b[0]) - parseFloat(a[0]))
            .slice(0, 25);
            
        const topAsks = Array.from(asks.entries())
            .sort((a, b) => parseFloat(a[0]) - parseFloat(b[0]))
            .slice(0, 25);

        const bookData = {
            kind: "book",
            symbol: symbol.toUpperCase(),
            lastUpdateId,
            bids: topBids,
            asks: topAsks,
            sourceTs: sourceTs || Date.now()
        };

        this.publish(`umf.book.${symbol.toUpperCase()}`, bookData);
    }

    /**
     * Mark price ve funding rate stream (futures için)
     */
    streamFunding(symbol) {
        const streamKey = `markPrice_${symbol}`;
        
        if (this.activeStreams.has(streamKey)) {
            console.warn(`⚠️ Stream already active: ${streamKey}`);
            return;
        }

        const channel = `${symbol.toLowerCase()}@markPrice@1s`;
        const ws = new WebSocket(`${WS_BASE}/${channel}`);
        
        ws.on('open', () => {
            console.log(`💱 Funding stream started: ${symbol}`);
        });

        ws.on('message', (data) => {
            try {
                const funding = JSON.parse(data.toString());
                
                const fundingData = {
                    kind: "funding",
                    symbol: symbol.toUpperCase(),
                    ts: funding.E,
                    markPrice: funding.p,
                    indexPrice: funding.i,
                    fundingRate: funding.r,
                    nextFundingTime: funding.T,
                    sourceTs: funding.E
                };

                this.publish(`umf.funding.${symbol.toUpperCase()}`, fundingData);
            } catch (error) {
                console.error('❌ Funding parse error:', error.message);
            }
        });

        ws.on('error', (error) => {
            console.error(`❌ Funding stream error (${symbol}):`, error.message);
            this.activeStreams.delete(streamKey);
        });

        ws.on('close', () => {
            console.log(`💸 Funding stream closed: ${symbol}`);
            this.activeStreams.delete(streamKey);
            
            // Auto-reconnect
            setTimeout(() => {
                console.log(`🔄 Reconnecting funding stream: ${symbol}`);
                this.streamFunding(symbol);
            }, 5000);
        });

        this.activeStreams.set(streamKey, ws);
        return ws;
    }

    /**
     * Tüm stream'leri başlat - CONSERVATIVE MODE
     */
    async initialize(symbols, options = {}) {
        const {
            intervals = ['5m', '15m'], // Reduced default intervals
            enableTrades = true,
            enableTicker = true,
            enableOrderbook = false, // Disabled by default (high API cost)
            enableFunding = false,
            enableClock = true
        } = options;

        try {
            console.log('🚀 Initializing UnifiedMarketFeed (CONSERVATIVE MODE)...');

            // 1. Time sync
            if (enableClock) {
                await this.timeSync();
                // Her 60 saniyede time sync yap (reduced frequency)
                setInterval(() => this.timeSync(), 60000);
            }

            // 2. Exchange info yükle
            console.log(`📋 Loading exchange info for ${symbols.length} symbols...`);
            await this.loadExchangeInfo(symbols);

            // Add delay between major operations
            await new Promise(resolve => setTimeout(resolve, 2000));

            // 3. Stream'leri başlat - CONSERVATIVE
            for (const symbol of symbols) {
                console.log(`🔄 Setting up streams for ${symbol}...`);
                
                // Klines - only essential intervals
                for (const interval of intervals) {
                    await new Promise(resolve => setTimeout(resolve, 1000)); // 1s delay between intervals
                    this.streamKlines(symbol, interval);
                }

                // Trades
                if (enableTrades) {
                    await new Promise(resolve => setTimeout(resolve, 500));
                    this.streamAggTrades(symbol);
                }

                // Ticker
                if (enableTicker) {
                    await new Promise(resolve => setTimeout(resolve, 500));
                    this.streamBookTicker(symbol);
                }

                // Orderbook - only if explicitly enabled
                if (enableOrderbook) {
                    console.log(`⚠️ Orderbook enabled for ${symbol} - high API usage!`);
                    await new Promise(resolve => setTimeout(resolve, 2000)); // Extra delay
                    await this.streamOrderbookL2(symbol);
                }

                // Funding (futures için)
                if (enableFunding) {
                    await new Promise(resolve => setTimeout(resolve, 500));
                    this.streamFunding(symbol);
                }

                // Delay between symbols to avoid overwhelming
                if (symbols.indexOf(symbol) < symbols.length - 1) {
                    await new Promise(resolve => setTimeout(resolve, 3000)); // 3s between symbols
                }
            }

            this.isInitialized = true;
            console.log(`✅ UnifiedMarketFeed initialized for ${symbols.length} symbols (CONSERVATIVE)`);
            console.log(`📊 Active streams: ${this.activeStreams.size}`);
            console.log(`⚡ API weight used: ${requestWeight}/${WEIGHT_LIMIT}`);

        } catch (error) {
            console.error('❌ UMF initialization failed:', error.message);
            throw error;
        }
    }

    /**
     * Tüm stream'leri kapat
     */
    shutdown() {
        console.log('🛑 Shutting down UnifiedMarketFeed...');
        
        for (const [key, ws] of this.activeStreams) {
            ws.close();
        }
        
        this.activeStreams.clear();
        this.orderbookStates.clear();
        
        console.log('✅ UnifiedMarketFeed shutdown complete');
    }

    /**
     * Stream durumlarını rapor et
     */
    getStatus() {
        return {
            isInitialized: this.isInitialized,
            activeStreams: Array.from(this.activeStreams.keys()),
            driftMs,
            rulesHash: rulesHash.substring(0, 8),
            requestWeight,
            symbolCount: Object.keys(exchangeRules).length
        };
    }
}

// Validation helpers
const ValidationHelpers = {
    /**
     * Price'ı tick size'a snap et
     */
    snapToTick(price, tickSize) {
        const p = parseFloat(price);
        const tick = parseFloat(tickSize);
        const decimals = Math.max(0, (tickSize.split('.')[1] || '').length);
        return (Math.round(p / tick) * tick).toFixed(decimals);
    },

    /**
     * Quantity'yi step size'a snap et
     */
    snapToStep(qty, stepSize) {
        const q = parseFloat(qty);
        const step = parseFloat(stepSize);
        const decimals = Math.max(0, (stepSize.split('.')[1] || '').length);
        return (Math.floor(q / step) * step).toFixed(decimals);
    },

    /**
     * Notional value kontrolü
     */
    checkNotional(price, qty, minNotional, maxNotional = null) {
        const notional = parseFloat(price) * parseFloat(qty);
        if (minNotional && notional < parseFloat(minNotional)) return false;
        if (maxNotional && notional > parseFloat(maxNotional)) return false;
        return true;
    },

    /**
     * Percent price kontrolü
     */
    checkPercentPrice(price, avgPrice, multiplierUp, multiplierDown) {
        const p = parseFloat(price);
        const avg = parseFloat(avgPrice);
        const up = parseFloat(multiplierUp);
        const down = parseFloat(multiplierDown);
        
        return p <= avg * up && p >= avg * down;
    }
};

// Export
module.exports = {
    UnifiedMarketFeed,
    bus,
    ValidationHelpers
};

// Singleton instance (opsiyonel)
let umfInstance = null;
module.exports.getInstance = () => {
    if (!umfInstance) {
        umfInstance = new UnifiedMarketFeed();
    }
    return umfInstance;
};

// Event listener helper
module.exports.on = (topic, handler) => bus.on(topic, handler);
module.exports.once = (topic, handler) => bus.once(topic, handler);
module.exports.off = (topic, handler) => bus.off(topic, handler);

// Quick start helper - CONSERVATIVE DEFAULTS
module.exports.quickStart = async (symbols, options = {}) => {
    const umf = module.exports.getInstance();
    
    // Conservative defaults
    const conservativeOptions = {
        intervals: ['5m', '15m'], // Essential intervals only
        enableTrades: true,
        enableTicker: true,
        enableOrderbook: false,  // Disabled to save API calls
        enableFunding: false,
        enableClock: true,
        ...options // Allow overrides
    };
    
    console.log('🛡️ Starting UMF in CONSERVATIVE mode...');
    console.log(`📊 Symbols: ${symbols.join(', ')}`);
    console.log(`⏱️ Intervals: ${conservativeOptions.intervals.join(', ')}`);
    console.log(`📖 Orderbook: ${conservativeOptions.enableOrderbook ? 'ON' : 'OFF (saves API)'}`);
    
    await umf.initialize(symbols, conservativeOptions);
    return umf;
};
