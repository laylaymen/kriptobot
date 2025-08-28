/**
 * L2 Orderbook Snapshot + Diff Validator
 * 
 * Manages orderbook state with sequence gap detection and automatic resync
 * Implements Binance orderbook best practices
 */

const WebSocket = require('ws');
const axios = require('axios');
const EventEmitter = require('events');

class OrderbookValidator extends EventEmitter {
    constructor(symbol, options = {}) {
        super();
        
        this.symbol = symbol;
        this.baseUrl = options.baseUrl || 'https://api.binance.com';
        this.wsUrl = options.wsUrl || 'wss://stream.binance.com:9443/ws';
        
        // Orderbook state
        this.lastUpdateId = 0;
        this.bids = new Map(); // price -> quantity
        this.asks = new Map(); // price -> quantity
        this.isReady = false;
        
        // Sequence tracking
        this.expectedSequence = 0;
        this.sequenceGaps = 0;
        this.lastResyncTime = 0;
        
        // Buffer for messages received before snapshot
        this.messageBuffer = [];
        this.maxBufferSize = options.maxBufferSize || 1000;
        
        // Configuration
        this.config = {
            depthLimit: options.depthLimit || 1000,
            updateSpeed: options.updateSpeed || '100ms', // 100ms, 1000ms
            maxSequenceGap: options.maxSequenceGap || 10,
            resyncThresholdMs: options.resyncThresholdMs || 60000, // 1 minute
            checksumInterval: options.checksumInterval || 30000, // 30 seconds
            autoReconnect: options.autoReconnect !== false,
            ...options
        };
        
        // Statistics
        this.stats = {
            snapshotRequests: 0,
            updatesReceived: 0,
            updatesApplied: 0,
            sequenceGaps: 0,
            resyncs: 0,
            checksumMismatches: 0,
            connectionDrops: 0,
            startTime: Date.now()
        };
        
        this.ws = null;
        this.checksumTimer = null;
        this.heartbeatTimer = null;
    }

    /**
     * Start the orderbook validator
     */
    async start() {
        console.log(`📖 Starting orderbook validator for ${this.symbol}`);
        
        try {
            // 1. Get initial snapshot
            await this.getSnapshot();
            
            // 2. Start WebSocket for updates
            this.startWebSocket();
            
            // 3. Start periodic checksum validation
            if (this.config.checksumInterval > 0) {
                this.startChecksumValidation();
            }
            
            console.log(`✅ Orderbook validator ready for ${this.symbol}`);
            this.emit('ready');
            
        } catch (error) {
            console.error(`❌ Failed to start orderbook validator for ${this.symbol}:`, error);
            this.emit('error', error);
        }
    }

    /**
     * Stop the validator
     */
    stop() {
        console.log(`🛑 Stopping orderbook validator for ${this.symbol}`);
        
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
        
        if (this.checksumTimer) {
            clearInterval(this.checksumTimer);
            this.checksumTimer = null;
        }
        
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = null;
        }
        
        this.isReady = false;
        this.emit('stopped');
    }

    /**
     * Get orderbook snapshot from REST API
     */
    async getSnapshot() {
        const startTime = Date.now();
        console.log(`📸 Getting orderbook snapshot for ${this.symbol}`);
        
        try {
            const response = await axios.get(`${this.baseUrl}/api/v3/depth`, {
                params: {
                    symbol: this.symbol,
                    limit: this.config.depthLimit
                },
                timeout: 10000
            });
            
            const data = response.data;
            this.lastUpdateId = data.lastUpdateId;
            
            // Clear existing orderbook
            this.bids.clear();
            this.asks.clear();
            
            // Load bids and asks
            data.bids.forEach(([price, quantity]) => {
                if (parseFloat(quantity) > 0) {
                    this.bids.set(price, quantity);
                }
            });
            
            data.asks.forEach(([price, quantity]) => {
                if (parseFloat(quantity) > 0) {
                    this.asks.set(price, quantity);
                }
            });
            
            this.stats.snapshotRequests++;
            this.isReady = true;
            
            const latency = Date.now() - startTime;
            console.log(`✅ Snapshot loaded: ${this.bids.size} bids, ${this.asks.size} asks, lastUpdateId: ${this.lastUpdateId}, latency: ${latency}ms`);
            
            // Process buffered messages
            this.processMessageBuffer();
            
            this.emit('snapshot', {
                symbol: this.symbol,
                lastUpdateId: this.lastUpdateId,
                bids: this.getTopBids(25),
                asks: this.getTopAsks(25),
                latencyMs: latency
            });
            
        } catch (error) {
            this.stats.snapshotRequests++;
            console.error(`❌ Failed to get snapshot for ${this.symbol}:`, error.message);
            throw error;
        }
    }

    /**
     * Start WebSocket connection for depth updates
     */
    startWebSocket() {
        const streamName = `${this.symbol.toLowerCase()}@depth@${this.config.updateSpeed}`;
        const wsUrl = `${this.wsUrl}/${streamName}`;
        
        console.log(`🔄 Connecting to depth stream: ${streamName}`);
        
        this.ws = new WebSocket(wsUrl);
        
        this.ws.on('open', () => {
            console.log(`✅ Depth stream connected: ${this.symbol}`);
            this.emit('connected');
        });
        
        this.ws.on('message', (data) => {
            try {
                const message = JSON.parse(data);
                this.handleDepthUpdate(message);
            } catch (error) {
                console.error(`❌ Failed to parse depth update for ${this.symbol}:`, error);
                this.emit('error', error);
            }
        });
        
        this.ws.on('close', (code, reason) => {
            console.warn(`⚠️ Depth stream closed: ${this.symbol}, code: ${code}, reason: ${reason}`);
            this.stats.connectionDrops++;
            this.emit('disconnected', { code, reason });
            
            if (this.config.autoReconnect) {
                setTimeout(() => {
                    if (!this.ws || this.ws.readyState === WebSocket.CLOSED) {
                        console.log(`🔄 Reconnecting depth stream: ${this.symbol}`);
                        this.startWebSocket();
                    }
                }, 1000);
            }
        });
        
        this.ws.on('error', (error) => {
            console.error(`❌ Depth stream error for ${this.symbol}:`, error);
            this.emit('error', error);
        });
    }

    /**
     * Handle depth update message
     */
    handleDepthUpdate(message) {
        const { E: eventTime, U: firstUpdateId, u: finalUpdateId, b: bids, a: asks } = message;
        
        this.stats.updatesReceived++;
        
        // If not ready, buffer the message
        if (!this.isReady) {
            if (this.messageBuffer.length < this.maxBufferSize) {
                this.messageBuffer.push(message);
            }
            return;
        }
        
        // Check sequence integrity
        if (!this.isSequenceValid(firstUpdateId, finalUpdateId)) {
            return; // Will trigger resync
        }
        
        // Apply updates
        this.applyDepthUpdate(bids, asks);
        this.lastUpdateId = finalUpdateId;
        this.stats.updatesApplied++;
        
        // Emit update event
        this.emit('update', {
            symbol: this.symbol,
            eventTime,
            firstUpdateId,
            finalUpdateId,
            bids: this.getTopBids(25),
            asks: this.getTopAsks(25),
            bidCount: this.bids.size,
            askCount: this.asks.size
        });
    }

    /**
     * Check if update sequence is valid
     */
    isSequenceValid(firstUpdateId, finalUpdateId) {
        // First update after snapshot
        if (this.lastUpdateId === 0) {
            return true;
        }
        
        // Check for sequence gap
        if (firstUpdateId !== this.lastUpdateId + 1) {
            this.sequenceGaps++;
            this.stats.sequenceGaps++;
            
            console.warn(`⚠️ Sequence gap detected for ${this.symbol}: expected ${this.lastUpdateId + 1}, got ${firstUpdateId}`);
            
            // If gap is too large or recent resync, trigger resync
            const gap = firstUpdateId - this.lastUpdateId - 1;
            const timeSinceLastResync = Date.now() - this.lastResyncTime;
            
            if (gap > this.config.maxSequenceGap || timeSinceLastResync < this.config.resyncThresholdMs) {
                console.warn(`🔄 Triggering resync for ${this.symbol} (gap: ${gap}, time since last resync: ${timeSinceLastResync}ms)`);
                this.triggerResync();
                return false;
            }
        }
        
        return true;
    }

    /**
     * Apply depth update to orderbook
     */
    applyDepthUpdate(bids, asks) {
        // Update bids
        bids.forEach(([price, quantity]) => {
            const qty = parseFloat(quantity);
            if (qty === 0) {
                this.bids.delete(price);
            } else {
                this.bids.set(price, quantity);
            }
        });
        
        // Update asks
        asks.forEach(([price, quantity]) => {
            const qty = parseFloat(quantity);
            if (qty === 0) {
                this.asks.delete(price);
            } else {
                this.asks.set(price, quantity);
            }
        });
    }

    /**
     * Process buffered messages after snapshot
     */
    processMessageBuffer() {
        if (this.messageBuffer.length === 0) return;
        
        console.log(`📦 Processing ${this.messageBuffer.length} buffered messages for ${this.symbol}`);
        
        // Sort by update ID to ensure correct order
        this.messageBuffer.sort((a, b) => a.U - b.U);
        
        let processed = 0;
        for (const message of this.messageBuffer) {
            if (message.u <= this.lastUpdateId) {
                // Skip old messages
                continue;
            }
            
            if (message.U === this.lastUpdateId + 1) {
                this.handleDepthUpdate(message);
                processed++;
            }
        }
        
        console.log(`✅ Processed ${processed} buffered messages for ${this.symbol}`);
        this.messageBuffer = [];
    }

    /**
     * Trigger orderbook resync
     */
    async triggerResync() {
        console.log(`🔄 Triggering orderbook resync for ${this.symbol}`);
        
        this.isReady = false;
        this.lastResyncTime = Date.now();
        this.stats.resyncs++;
        
        try {
            await this.getSnapshot();
            this.emit('resync', {
                symbol: this.symbol,
                reason: 'sequence_gap',
                timestamp: this.lastResyncTime
            });
        } catch (error) {
            console.error(`❌ Resync failed for ${this.symbol}:`, error);
            this.emit('error', error);
        }
    }

    /**
     * Start periodic checksum validation
     */
    startChecksumValidation() {
        this.checksumTimer = setInterval(() => {
            this.validateChecksum();
        }, this.config.checksumInterval);
    }

    /**
     * Validate orderbook checksum (basic implementation)
     */
    async validateChecksum() {
        try {
            // Get fresh snapshot for comparison
            const response = await axios.get(`${this.baseUrl}/api/v3/depth`, {
                params: {
                    symbol: this.symbol,
                    limit: 100
                },
                timeout: 5000
            });
            
            const serverBids = new Map(response.data.bids);
            const serverAsks = new Map(response.data.asks);
            
            // Compare top 10 levels
            const localTopBids = this.getTopBids(10);
            const localTopAsks = this.getTopAsks(10);
            
            let mismatchCount = 0;
            
            // Check bids
            for (let i = 0; i < Math.min(localTopBids.length, 10); i++) {
                const [price, quantity] = localTopBids[i];
                const serverQuantity = serverBids.get(price);
                
                if (!serverQuantity || Math.abs(parseFloat(quantity) - parseFloat(serverQuantity)) > 1e-8) {
                    mismatchCount++;
                }
            }
            
            // Check asks
            for (let i = 0; i < Math.min(localTopAsks.length, 10); i++) {
                const [price, quantity] = localTopAsks[i];
                const serverQuantity = serverAsks.get(price);
                
                if (!serverQuantity || Math.abs(parseFloat(quantity) - parseFloat(serverQuantity)) > 1e-8) {
                    mismatchCount++;
                }
            }
            
            if (mismatchCount > 2) {
                this.stats.checksumMismatches++;
                console.warn(`⚠️ Checksum mismatch for ${this.symbol}: ${mismatchCount} mismatched levels`);
                
                this.emit('checksum_mismatch', {
                    symbol: this.symbol,
                    mismatchCount,
                    timestamp: Date.now()
                });
                
                // Trigger resync if too many mismatches
                if (mismatchCount > 5) {
                    await this.triggerResync();
                }
            }
            
        } catch (error) {
            console.error(`❌ Checksum validation failed for ${this.symbol}:`, error.message);
        }
    }

    /**
     * Get top N bids (sorted by price descending)
     */
    getTopBids(n = 25) {
        return Array.from(this.bids.entries())
            .sort((a, b) => parseFloat(b[0]) - parseFloat(a[0]))
            .slice(0, n);
    }

    /**
     * Get top N asks (sorted by price ascending)
     */
    getTopAsks(n = 25) {
        return Array.from(this.asks.entries())
            .sort((a, b) => parseFloat(a[0]) - parseFloat(b[0]))
            .slice(0, n);
    }

    /**
     * Get current spread
     */
    getSpread() {
        const topBid = this.getTopBids(1)[0];
        const topAsk = this.getTopAsks(1)[0];
        
        if (!topBid || !topAsk) return null;
        
        const bidPrice = parseFloat(topBid[0]);
        const askPrice = parseFloat(topAsk[0]);
        const spread = askPrice - bidPrice;
        const spreadBps = (spread / bidPrice) * 10000;
        
        return {
            bid: bidPrice,
            ask: askPrice,
            spread,
            spreadBps
        };
    }

    /**
     * Get validator statistics
     */
    getStats() {
        const runtime = Date.now() - this.stats.startTime;
        const runtimeMinutes = runtime / 60000;
        
        return {
            ...this.stats,
            symbol: this.symbol,
            runtime,
            runtimeMinutes,
            updatesPerMinute: this.stats.updatesReceived / runtimeMinutes,
            successRate: this.stats.updatesApplied / this.stats.updatesReceived * 100,
            bidLevels: this.bids.size,
            askLevels: this.asks.size,
            lastUpdateId: this.lastUpdateId,
            isReady: this.isReady,
            spread: this.getSpread()
        };
    }
}

module.exports = { OrderbookValidator };
